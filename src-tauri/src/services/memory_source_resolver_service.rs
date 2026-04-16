//! 记忆来源解析服务
//!
//! 将配置中的记忆来源（AGENTS、规则、自动记忆等）统一解析为可观察结果与可注入提示词片段。

use crate::services::auto_memory_service::{
    get_auto_memory_index, infer_memdir_memory_type, resolve_auto_memory_root, MemdirMemoryType,
};
use crate::services::memory_import_parser_service::{parse_memory_file, MemoryImportParseOptions};
use crate::services::memory_rules_loader_service::load_rules;
use chrono::{DateTime, Utc};
use lime_agent::{
    resolve_durable_memory_root, to_virtual_memory_path, DURABLE_MEMORY_VIRTUAL_ROOT,
};
#[cfg(test)]
use lime_agent::{LEGACY_DURABLE_MEMORY_ROOT_ENV, LIME_DURABLE_MEMORY_ROOT_ENV};
use lime_core::app_paths;
use lime_core::config::{Config, MemoryConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const DURABLE_MEMORY_MAX_DEPTH: usize = 4;
const DURABLE_MEMORY_MAX_FILES: usize = 64;
const AUTO_MEMORY_LINKED_ITEM_LIMIT: usize = 8;
const AUTO_MEMORY_LINKED_ITEM_LINE_LIMIT: usize = 40;

/// 单个来源解析结果
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EffectiveMemorySource {
    /// 来源类型：managed_policy/project/user/local/rule/auto_memory/additional
    pub kind: String,
    /// 归属来源桶：managed/user/project/local/rules/auto/durable/additional
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_bucket: Option<String>,
    /// 当前命中的 provider 标识；memdir 主链会显式写入 `memdir`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// memdir 条目类型
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_type: Option<MemdirMemoryType>,
    /// 最近更新时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    /// 来源路径
    pub path: String,
    /// 文件或目录是否存在
    pub exists: bool,
    /// 是否被实际加载
    pub loaded: bool,
    /// 内容行数（目录类来源为 0）
    pub line_count: u32,
    /// 导入展开后额外包含的文件数
    pub import_count: u32,
    /// 告警信息
    pub warnings: Vec<String>,
    /// 预览（最多 300 字）
    pub preview: Option<String>,
}

/// 来源解析总览
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EffectiveMemorySourcesResponse {
    pub working_dir: String,
    pub total_sources: u32,
    pub loaded_sources: u32,
    pub follow_imports: bool,
    pub import_max_depth: u8,
    pub sources: Vec<EffectiveMemorySource>,
}

/// 内部解析结果（包含可注入片段）
#[derive(Debug, Clone)]
pub struct MemorySourceResolution {
    pub response: EffectiveMemorySourcesResponse,
    pub prompt_segments: Vec<String>,
    pub prompt_sources: Vec<MemoryPromptSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryPromptSegment {
    pub title: String,
    pub path: String,
    pub content: String,
}

/// 解析有效记忆来源
pub fn resolve_effective_sources(
    config: &Config,
    working_dir: &Path,
    active_relative_path: Option<&str>,
) -> MemorySourceResolution {
    let memory = &config.memory;
    let options = MemoryImportParseOptions {
        follow_imports: memory.resolve.follow_imports,
        max_depth: memory.resolve.import_max_depth as usize,
    };

    let mut sources = Vec::new();
    let mut prompt_segments = Vec::new();
    let mut prompt_sources = Vec::new();
    let mut seen = HashSet::new();

    // 1. managed policy
    let managed_policy_path = memory
        .sources
        .managed_policy_path
        .as_deref()
        .map(|v| expand_path(v, Some(working_dir)))
        .unwrap_or_else(default_managed_policy_path);
    resolve_file_source(
        "managed_policy",
        &managed_policy_path,
        true,
        &options,
        &mut seen,
        &mut sources,
        &mut prompt_segments,
        &mut prompt_sources,
    );

    // 2. user memory
    let user_memory_path = memory
        .sources
        .user_memory_path
        .as_deref()
        .map(|v| expand_path(v, Some(working_dir)))
        .unwrap_or_else(default_user_memory_path);
    resolve_file_source(
        "user_memory",
        &user_memory_path,
        true,
        &options,
        &mut seen,
        &mut sources,
        &mut prompt_segments,
        &mut prompt_sources,
    );

    // 3. cross-thread durable memory (`/memories/...`)
    resolve_durable_memory_sources(
        memory,
        &options,
        &mut seen,
        &mut sources,
        &mut prompt_segments,
        &mut prompt_sources,
    );

    // 4. project hierarchy memory + rules
    let ancestors = collect_ancestor_dirs(working_dir);
    for rel in &memory.sources.project_memory_paths {
        for candidate in resolve_project_relative_candidates(working_dir, &ancestors, rel) {
            resolve_file_source(
                "project_memory",
                &candidate,
                false,
                &options,
                &mut seen,
                &mut sources,
                &mut prompt_segments,
                &mut prompt_sources,
            );
        }
    }

    if let Some(project_local_rel) = memory
        .sources
        .project_local_memory_path
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        for candidate in
            resolve_project_relative_candidates(working_dir, &ancestors, project_local_rel)
        {
            resolve_file_source(
                "project_local",
                &candidate,
                false,
                &options,
                &mut seen,
                &mut sources,
                &mut prompt_segments,
                &mut prompt_sources,
            );
        }
    }

    for ancestor in &ancestors {
        for rel in &memory.sources.project_rule_dirs {
            if rel.trim().is_empty() {
                continue;
            }
            let rule_dir = ancestor.join(rel);
            resolve_rule_sources(
                &rule_dir,
                active_relative_path,
                false,
                &mut seen,
                &mut sources,
                &mut prompt_segments,
                &mut prompt_sources,
            );
        }
    }

    // 5. additional directories
    if memory.resolve.load_additional_dirs_memory {
        for additional in &memory.resolve.additional_dirs {
            let additional_dir = expand_path(additional, Some(working_dir));
            for rel in &memory.sources.project_memory_paths {
                if rel.trim().is_empty() {
                    continue;
                }
                let candidate = additional_dir.join(rel);
                resolve_file_source(
                    "additional_memory",
                    &candidate,
                    false,
                    &options,
                    &mut seen,
                    &mut sources,
                    &mut prompt_segments,
                    &mut prompt_sources,
                );
            }
            for rel in &memory.sources.project_rule_dirs {
                if rel.trim().is_empty() {
                    continue;
                }
                let rule_dir = additional_dir.join(rel);
                resolve_rule_sources(
                    &rule_dir,
                    active_relative_path,
                    false,
                    &mut seen,
                    &mut sources,
                    &mut prompt_segments,
                    &mut prompt_sources,
                );
            }
        }
    }

    // 6. auto memory
    resolve_auto_memory_source(
        memory,
        working_dir,
        &mut sources,
        &mut prompt_segments,
        &mut prompt_sources,
        &mut seen,
    );

    let loaded_sources = sources.iter().filter(|s| s.loaded).count() as u32;
    let response = EffectiveMemorySourcesResponse {
        working_dir: working_dir.to_string_lossy().to_string(),
        total_sources: sources.len() as u32,
        loaded_sources,
        follow_imports: options.follow_imports,
        import_max_depth: options.max_depth as u8,
        sources,
    };

    MemorySourceResolution {
        response,
        prompt_segments,
        prompt_sources,
    }
}

/// 构建可注入到 system prompt 的记忆来源片段
pub fn build_memory_sources_prompt(
    config: &Config,
    working_dir: &Path,
    active_relative_path: Option<&str>,
    max_chars: usize,
) -> Option<String> {
    build_memory_sources_prompt_with_options(
        config,
        working_dir,
        active_relative_path,
        max_chars,
        false,
    )
}

pub fn build_memory_sources_prompt_with_options(
    config: &Config,
    working_dir: &Path,
    active_relative_path: Option<&str>,
    max_chars: usize,
    skip_runtime_agents_overlap: bool,
) -> Option<String> {
    let resolution = resolve_effective_sources(config, working_dir, active_relative_path);
    if resolution.prompt_sources.is_empty() {
        return None;
    }

    let mut output = String::from("【记忆来源补充指令】\n");
    output.push_str("以下内容来自配置化记忆来源，请优先遵循：\n");
    let runtime_agent_paths = if skip_runtime_agents_overlap {
        runtime_agent_overlap_paths(working_dir)
    } else {
        HashSet::new()
    };

    let mut used = 0usize;
    for segment in resolution.prompt_sources {
        if should_skip_runtime_agent_overlap(&segment, &runtime_agent_paths) {
            continue;
        }
        let rendered = format!(
            "### {} ({})\n{}",
            segment.title, segment.path, segment.content
        );
        if rendered.trim().is_empty() {
            continue;
        }
        if used >= max_chars {
            break;
        }
        let remaining = max_chars.saturating_sub(used);
        let clipped = clip_text(&rendered, remaining);
        if clipped.trim().is_empty() {
            continue;
        }
        output.push('\n');
        output.push_str(&clipped);
        output.push('\n');
        used += clipped.chars().count();
    }

    if used == 0 {
        None
    } else {
        Some(output.trim().to_string())
    }
}

fn build_effective_memory_source(
    kind: &str,
    path: String,
    exists: bool,
    loaded: bool,
    line_count: u32,
    import_count: u32,
    warnings: Vec<String>,
    preview: Option<String>,
    updated_at: Option<i64>,
    memory_type: Option<MemdirMemoryType>,
) -> EffectiveMemorySource {
    EffectiveMemorySource {
        kind: kind.to_string(),
        source_bucket: source_bucket_for_kind(kind).map(str::to_string),
        provider: provider_for_kind(kind).map(str::to_string),
        memory_type,
        updated_at,
        path,
        exists,
        loaded,
        line_count,
        import_count,
        warnings,
        preview,
    }
}

fn source_bucket_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "managed_policy" => Some("managed"),
        "user_memory" => Some("user"),
        "project_memory" | "workspace_agents" => Some("project"),
        "project_local" => Some("local"),
        "project_rule" | "project_rules" => Some("rules"),
        "auto_memory" | "auto_memory_item" => Some("auto"),
        "durable_memory" => Some("durable"),
        "additional_memory" => Some("additional"),
        _ => None,
    }
}

fn provider_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "auto_memory" | "auto_memory_item" => Some("memdir"),
        _ => None,
    }
}

fn memory_type_for_kind(kind: &str, path: &str) -> Option<MemdirMemoryType> {
    match kind {
        "auto_memory" | "auto_memory_item" => infer_memdir_memory_type(path),
        _ => None,
    }
}

fn read_path_updated_at(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Utc>::from(modified).timestamp_millis())
}

fn runtime_agent_overlap_paths(working_dir: &Path) -> HashSet<PathBuf> {
    let mut paths = HashSet::new();
    paths.insert(normalize_path(&app_paths::best_effort_user_memory_path()));
    paths.insert(normalize_path(
        &app_paths::resolve_workspace_runtime_agents_path(working_dir),
    ));
    paths
}

fn should_skip_runtime_agent_overlap(
    segment: &MemoryPromptSegment,
    runtime_agent_paths: &HashSet<PathBuf>,
) -> bool {
    if runtime_agent_paths.is_empty() {
        return false;
    }
    runtime_agent_paths.contains(&normalize_path(Path::new(&segment.path)))
}

fn resolve_file_source(
    kind: &str,
    file_path: &Path,
    include_missing: bool,
    options: &MemoryImportParseOptions,
    seen: &mut HashSet<PathBuf>,
    output: &mut Vec<EffectiveMemorySource>,
    prompt_segments: &mut Vec<String>,
    prompt_sources: &mut Vec<MemoryPromptSegment>,
) {
    resolve_file_source_with_display_path(
        kind,
        file_path,
        None,
        include_missing,
        options,
        seen,
        output,
        prompt_segments,
        prompt_sources,
    );
}

fn resolve_file_source_with_display_path(
    kind: &str,
    file_path: &Path,
    display_path: Option<&str>,
    include_missing: bool,
    options: &MemoryImportParseOptions,
    seen: &mut HashSet<PathBuf>,
    output: &mut Vec<EffectiveMemorySource>,
    prompt_segments: &mut Vec<String>,
    prompt_sources: &mut Vec<MemoryPromptSegment>,
) {
    let normalized = normalize_path(file_path);
    if !seen.insert(normalized.clone()) {
        return;
    }
    let display_path = display_path
        .map(str::to_string)
        .unwrap_or_else(|| normalized.to_string_lossy().to_string());

    if !normalized.exists() || !normalized.is_file() {
        if !include_missing {
            return;
        }
        output.push(build_effective_memory_source(
            kind,
            display_path,
            false,
            false,
            0,
            0,
            Vec::new(),
            None,
            None,
            None,
        ));
        return;
    }

    match parse_memory_file(&normalized, options) {
        Ok(parsed) => {
            let content = parsed.content.trim().to_string();
            let preview = if content.is_empty() {
                None
            } else {
                Some(clip_text(&content, 300))
            };

            let loaded = !content.is_empty();
            let line_count = if loaded {
                content.lines().count() as u32
            } else {
                0
            };

            output.push(build_effective_memory_source(
                kind,
                display_path.clone(),
                true,
                loaded,
                line_count,
                parsed.imported_files.len() as u32,
                parsed.warnings.clone(),
                preview,
                read_path_updated_at(&normalized),
                memory_type_for_kind(kind, display_path.as_str()),
            ));

            if loaded {
                prompt_segments.push(format!("### {} ({})\n{}", kind, display_path, content));
                prompt_sources.push(MemoryPromptSegment {
                    title: kind.to_string(),
                    path: display_path,
                    content,
                });
            }
        }
        Err(err) => {
            output.push(build_effective_memory_source(
                kind,
                display_path,
                true,
                false,
                0,
                0,
                vec![err],
                None,
                read_path_updated_at(&normalized),
                memory_type_for_kind(kind, normalized.to_string_lossy().as_ref()),
            ));
        }
    }
}

fn resolve_durable_memory_sources(
    memory_config: &MemoryConfig,
    options: &MemoryImportParseOptions,
    seen: &mut HashSet<PathBuf>,
    output: &mut Vec<EffectiveMemorySource>,
    prompt_segments: &mut Vec<String>,
    prompt_sources: &mut Vec<MemoryPromptSegment>,
) {
    let root = match resolve_durable_memory_root() {
        Ok(path) => path,
        Err(err) => {
            output.push(build_effective_memory_source(
                "durable_memory",
                DURABLE_MEMORY_VIRTUAL_ROOT.to_string(),
                false,
                false,
                0,
                0,
                vec![format!("解析 durable memory 根目录失败: {err}")],
                None,
                None,
                None,
            ));
            return;
        }
    };

    let files = match collect_durable_memory_files(
        &root,
        DURABLE_MEMORY_MAX_DEPTH,
        DURABLE_MEMORY_MAX_FILES,
    ) {
        Ok(files) => files,
        Err(err) => {
            output.push(build_effective_memory_source(
                "durable_memory",
                DURABLE_MEMORY_VIRTUAL_ROOT.to_string(),
                root.exists(),
                false,
                0,
                0,
                vec![format!("扫描 durable memory 文件失败: {err}")],
                None,
                read_path_updated_at(&root),
                None,
            ));
            return;
        }
    };

    if files.is_empty() {
        let warnings = if memory_config.enabled {
            vec!["尚未创建 durable memory 文件，可通过 `/memories/...` 路径写入".to_string()]
        } else {
            vec!["记忆功能已关闭".to_string()]
        };
        output.push(build_effective_memory_source(
            "durable_memory",
            DURABLE_MEMORY_VIRTUAL_ROOT.to_string(),
            root.exists(),
            false,
            0,
            0,
            warnings,
            None,
            read_path_updated_at(&root),
            None,
        ));
        return;
    }

    for file_path in files {
        let display_path = to_virtual_memory_path(&file_path)
            .ok()
            .flatten()
            .unwrap_or_else(|| file_path.to_string_lossy().to_string());
        resolve_file_source_with_display_path(
            "durable_memory",
            &file_path,
            Some(&display_path),
            false,
            options,
            seen,
            output,
            prompt_segments,
            prompt_sources,
        );
    }
}

fn resolve_rule_sources(
    rule_dir: &Path,
    active_relative_path: Option<&str>,
    include_missing: bool,
    seen: &mut HashSet<PathBuf>,
    output: &mut Vec<EffectiveMemorySource>,
    prompt_segments: &mut Vec<String>,
    prompt_sources: &mut Vec<MemoryPromptSegment>,
) {
    let normalized = normalize_path(rule_dir);
    let dir_key = normalized.join("__rules_dir__");
    if !seen.insert(dir_key) {
        return;
    }

    if !normalized.exists() || !normalized.is_dir() {
        if !include_missing {
            return;
        }
        output.push(build_effective_memory_source(
            "project_rules",
            normalized.to_string_lossy().to_string(),
            false,
            false,
            0,
            0,
            Vec::new(),
            None,
            None,
            None,
        ));
        return;
    }

    let rules = load_rules(&normalized, active_relative_path);
    if rules.is_empty() {
        if !include_missing {
            return;
        }
        output.push(build_effective_memory_source(
            "project_rules",
            normalized.to_string_lossy().to_string(),
            true,
            false,
            0,
            0,
            vec!["规则目录存在，但未发现可用规则".to_string()],
            None,
            read_path_updated_at(&normalized),
            None,
        ));
        return;
    }

    for rule in rules {
        let normalized_rule = normalize_path(&rule.path);
        if !seen.insert(normalized_rule.clone()) {
            continue;
        }

        let loaded = rule.matched && !rule.content.trim().is_empty();
        let mut warnings = Vec::new();
        if !rule.matched && !rule.path_patterns.is_empty() {
            warnings.push(format!(
                "规则 paths 未命中: {}",
                rule.path_patterns.join(", ")
            ));
        }
        output.push(build_effective_memory_source(
            "project_rule",
            normalized_rule.to_string_lossy().to_string(),
            true,
            loaded,
            if loaded {
                rule.content.lines().count() as u32
            } else {
                0
            },
            0,
            warnings,
            if loaded {
                Some(clip_text(&rule.content, 300))
            } else {
                None
            },
            read_path_updated_at(&normalized_rule),
            None,
        ));

        if loaded {
            prompt_segments.push(format!(
                "### 规则: {} ({})\n{}",
                rule.title,
                normalized_rule.display(),
                rule.content
            ));
            prompt_sources.push(MemoryPromptSegment {
                title: format!("规则: {}", rule.title),
                path: normalized_rule.to_string_lossy().to_string(),
                content: rule.content,
            });
        }
    }
}

fn resolve_auto_memory_source(
    memory_config: &MemoryConfig,
    working_dir: &Path,
    output: &mut Vec<EffectiveMemorySource>,
    prompt_segments: &mut Vec<String>,
    prompt_sources: &mut Vec<MemoryPromptSegment>,
    seen: &mut HashSet<PathBuf>,
) {
    let auto_root = resolve_auto_memory_root(working_dir, &memory_config.auto);
    let entry_name = memory_config.auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        "MEMORY.md"
    } else {
        entry_name
    };
    let entry_display_path = auto_root.join(entry_name);
    let entry_path = normalize_path(&entry_display_path);
    if !seen.insert(entry_path.clone()) {
        return;
    }

    let index = get_auto_memory_index(memory_config, working_dir);
    match index {
        Ok(idx) => {
            let loaded = idx.entry_exists && !idx.preview_lines.is_empty();
            output.push(build_effective_memory_source(
                "auto_memory",
                entry_display_path.to_string_lossy().to_string(),
                idx.entry_exists,
                loaded,
                idx.total_lines,
                idx.items.len() as u32,
                if !memory_config.auto.enabled {
                    vec!["自动记忆已关闭".to_string()]
                } else {
                    Vec::new()
                },
                if loaded {
                    Some(clip_text(&idx.preview_lines.join("\n"), 300))
                } else {
                    None
                },
                read_path_updated_at(&entry_path),
                None,
            ));

            if loaded {
                prompt_segments.push(format!(
                    "### auto_memory ({})\n{}",
                    entry_display_path.display(),
                    idx.preview_lines.join("\n")
                ));
                prompt_sources.push(MemoryPromptSegment {
                    title: "auto_memory".to_string(),
                    path: entry_display_path.to_string_lossy().to_string(),
                    content: idx.preview_lines.join("\n"),
                });

                let sorted_items = sort_auto_memory_prompt_items(&idx.items);
                for item in sorted_items.iter().take(AUTO_MEMORY_LINKED_ITEM_LIMIT) {
                    let item_display_path = auto_root.join(&item.relative_path);
                    let item_path = normalize_path(&item_display_path);
                    if !seen.insert(item_path.clone()) {
                        continue;
                    }

                    let Ok(content) = fs::read_to_string(&item_path) else {
                        output.push(build_effective_memory_source(
                            "auto_memory_item",
                            item_display_path.to_string_lossy().to_string(),
                            item.exists,
                            false,
                            0,
                            0,
                            vec![format!(
                                "读取 memdir 条目失败: {}",
                                item_display_path.display()
                            )],
                            None,
                            item.updated_at,
                            item.memory_type,
                        ));
                        continue;
                    };

                    let preview_lines = content
                        .lines()
                        .take(AUTO_MEMORY_LINKED_ITEM_LINE_LIMIT)
                        .map(|line| line.to_string())
                        .collect::<Vec<_>>();
                    let item_loaded = !preview_lines.is_empty();

                    output.push(build_effective_memory_source(
                        "auto_memory_item",
                        item_display_path.to_string_lossy().to_string(),
                        item.exists,
                        item_loaded,
                        content.lines().count() as u32,
                        0,
                        Vec::new(),
                        if item_loaded {
                            Some(clip_text(&preview_lines.join("\n"), 300))
                        } else {
                            None
                        },
                        item.updated_at.or_else(|| read_path_updated_at(&item_path)),
                        item.memory_type,
                    ));

                    if item_loaded {
                        prompt_segments.push(format!(
                            "### auto_memory_item ({})\n{}",
                            item_display_path.display(),
                            preview_lines.join("\n")
                        ));
                        prompt_sources.push(MemoryPromptSegment {
                            title: format!("auto_memory_item: {}", item.title),
                            path: item_display_path.to_string_lossy().to_string(),
                            content: preview_lines.join("\n"),
                        });
                    }
                }
            }
        }
        Err(err) => {
            output.push(build_effective_memory_source(
                "auto_memory",
                entry_display_path.to_string_lossy().to_string(),
                entry_path.exists(),
                false,
                0,
                0,
                vec![err],
                None,
                read_path_updated_at(&entry_path),
                None,
            ));
        }
    }
}

fn sort_auto_memory_prompt_items(
    items: &[crate::services::auto_memory_service::AutoMemoryIndexItem],
) -> Vec<crate::services::auto_memory_service::AutoMemoryIndexItem> {
    let mut sorted = items.to_vec();
    sorted.sort_by(|left, right| {
        auto_memory_prompt_item_rank(left)
            .cmp(&auto_memory_prompt_item_rank(right))
            .then_with(|| {
                right
                    .updated_at
                    .unwrap_or_default()
                    .cmp(&left.updated_at.unwrap_or_default())
            })
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    sorted
}

fn auto_memory_prompt_item_rank(
    item: &crate::services::auto_memory_service::AutoMemoryIndexItem,
) -> usize {
    let is_readme = item.relative_path.ends_with("/README.md")
        || item.relative_path.ends_with("/README.markdown")
        || item.relative_path.ends_with("/README.mdx")
        || item.relative_path.eq_ignore_ascii_case("README.md");
    match (item.memory_type.is_some(), is_readme) {
        (true, false) => 0,
        (true, true) => 1,
        (false, false) => 2,
        (false, true) => 3,
    }
}

fn collect_durable_memory_files(
    root: &Path,
    max_depth: usize,
    max_files: usize,
) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_durable_memory_files_recursive(root, 0, max_depth, max_files, &mut files)?;
    files.sort_by(|left, right| durable_memory_sort_key(left).cmp(&durable_memory_sort_key(right)));
    Ok(files)
}

fn collect_durable_memory_files_recursive(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    max_files: usize,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if depth > max_depth || output.len() >= max_files || !dir.exists() {
        return Ok(());
    }

    let mut entries = fs::read_dir(dir)
        .map_err(|e| format!("读取目录失败 {}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.path().cmp(&right.path()));

    for entry in entries {
        if output.len() >= max_files {
            break;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            collect_durable_memory_files_recursive(&path, depth + 1, max_depth, max_files, output)?;
            continue;
        }

        if file_type.is_file() && is_durable_memory_candidate_file(&path) {
            output.push(path);
        }
    }

    Ok(())
}

fn is_durable_memory_candidate_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("md")
            | Some("markdown")
            | Some("mdx")
            | Some("txt")
            | Some("json")
            | Some("yaml")
            | Some("yml")
            | Some("toml")
    )
}

fn durable_memory_sort_key(path: &Path) -> (u8, String) {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let priority = match file_name.as_str() {
        "memory.md" | "memory.mdx" | "memory.txt" => 0,
        "preferences.md" | "preferences.json" | "preferences.toml" => 1,
        "project.md" | "project.json" | "project.toml" => 2,
        _ => 10,
    };

    (priority, path.to_string_lossy().to_string())
}

fn collect_ancestor_dirs(start: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = if start.is_file() {
        start
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    } else {
        start.to_path_buf()
    };
    let project_root = find_git_root(&current);
    let home_dir = dirs::home_dir();
    let mut depth = 0usize;

    loop {
        dirs.push(current.clone());
        if let Some(root) = project_root.as_ref() {
            if &current == root {
                break;
            }
        }
        if let Some(home) = home_dir.as_ref() {
            if &current == home {
                break;
            }
        }
        // 兜底保护，避免跨层级扫描过深导致来源列表爆炸
        if depth >= 12 {
            break;
        }
        if !current.pop() {
            break;
        }
        depth += 1;
    }

    dirs
}

fn expand_path(path: &str, working_dir: Option<&Path>) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(trimmed.trim_start_matches("~/"));
        }
    }

    let p = PathBuf::from(trimmed);
    if p.is_absolute() {
        return p;
    }

    if let Some(base) = working_dir {
        return base.join(p);
    }
    p
}

fn default_user_memory_path() -> PathBuf {
    app_paths::resolve_user_memory_path()
        .unwrap_or_else(|_| app_paths::best_effort_user_memory_path())
}

fn default_managed_policy_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        return PathBuf::from("/Library/Application Support/Lime/AGENTS.md");
    }
    #[cfg(target_os = "linux")]
    {
        return PathBuf::from("/etc/lime/AGENTS.md");
    }
    #[cfg(target_os = "windows")]
    {
        return PathBuf::from("C:/Program Files/Lime/AGENTS.md");
    }
    #[allow(unreachable_code)]
    PathBuf::from("/etc/lime/AGENTS.md")
}

fn normalize_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn resolve_project_relative_candidates(
    working_dir: &Path,
    ancestors: &[PathBuf],
    relative_path: &str,
) -> Vec<PathBuf> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if is_workspace_local_instruction_path(trimmed) {
        return vec![working_dir.join(trimmed)];
    }

    ancestors
        .iter()
        .map(|ancestor| ancestor.join(trimmed))
        .collect()
}

fn is_workspace_local_instruction_path(relative_path: &str) -> bool {
    let normalized = relative_path.trim_start_matches("./").replace('\\', "/");
    normalized.starts_with(".lime/")
}

fn find_git_root(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn clip_text(text: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut chars = text.chars();
    let clipped: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{clipped}...")
    } else {
        clipped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    fn durable_memory_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct DurableMemoryEnvGuard {
        previous: Option<OsString>,
    }

    impl DurableMemoryEnvGuard {
        fn set(path: &Path) -> Self {
            let previous = lime_core::env_compat::var_os(&[
                LIME_DURABLE_MEMORY_ROOT_ENV,
                LEGACY_DURABLE_MEMORY_ROOT_ENV,
            ]);
            std::env::set_var(LIME_DURABLE_MEMORY_ROOT_ENV, path.as_os_str());
            std::env::remove_var(LEGACY_DURABLE_MEMORY_ROOT_ENV);
            Self { previous }
        }
    }

    impl Drop for DurableMemoryEnvGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.previous {
                std::env::set_var(LIME_DURABLE_MEMORY_ROOT_ENV, value);
            } else {
                std::env::remove_var(LIME_DURABLE_MEMORY_ROOT_ENV);
            }
            std::env::remove_var(LEGACY_DURABLE_MEMORY_ROOT_ENV);
        }
    }

    #[test]
    fn should_resolve_project_memory_and_rules() {
        let tmp = TempDir::new().expect("create temp dir");
        let root = tmp.path();
        fs::create_dir_all(root.join(".agents/rules")).expect("create rules");
        fs::create_dir_all(root.join(".lime")).expect("create .lime dir");
        fs::write(root.join(".lime/AGENTS.md"), "# 项目记忆\n- use rust").expect("write agents");
        fs::write(root.join(".agents/rules/general.md"), "# 规则\n- KISS").expect("write rule");

        let mut cfg = Config::default();
        cfg.memory.enabled = true;
        cfg.memory.sources.project_memory_paths = vec![".lime/AGENTS.md".to_string()];
        cfg.memory.sources.project_rule_dirs = vec![".agents/rules".to_string()];
        cfg.memory.resolve.follow_imports = true;
        cfg.memory.resolve.import_max_depth = 3;

        let resolved = resolve_effective_sources(&cfg, root, Some("src/main.rs"));
        assert!(resolved.response.total_sources > 0);
        assert!(resolved.response.loaded_sources > 0);
        assert!(!resolved.prompt_segments.is_empty());
    }

    #[test]
    fn should_support_additional_dirs_when_enabled() {
        let tmp = TempDir::new().expect("create temp dir");
        let root = tmp.path().join("main");
        let ext = tmp.path().join("extra");
        fs::create_dir_all(&root).expect("create main");
        fs::create_dir_all(&ext).expect("create extra");
        fs::create_dir_all(ext.join(".lime")).expect("create extra .lime");
        fs::write(ext.join(".lime/AGENTS.md"), "extra memory").expect("write extra agents");

        let mut cfg = Config::default();
        cfg.memory.enabled = true;
        cfg.memory.sources.project_memory_paths = vec![".lime/AGENTS.md".to_string()];
        cfg.memory.resolve.load_additional_dirs_memory = true;
        cfg.memory.resolve.additional_dirs = vec![ext.to_string_lossy().to_string()];

        let resolved = resolve_effective_sources(&cfg, &root, None);
        let has_additional_loaded = resolved
            .response
            .sources
            .iter()
            .any(|s| s.kind == "additional_memory" && s.loaded);
        assert!(has_additional_loaded);
    }

    #[test]
    fn should_resolve_durable_memory_sources_with_virtual_paths() {
        let _env_lock = durable_memory_env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        fs::create_dir_all(tmp.path().join("team")).expect("create subdir");
        fs::write(tmp.path().join("MEMORY.md"), "# 长期记忆\n- 始终先给结论")
            .expect("write durable memory");
        fs::write(
            tmp.path().join("team/preferences.md"),
            "# 团队偏好\n- 保持 KISS",
        )
        .expect("write nested durable memory");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let mut cfg = Config::default();
        cfg.memory.enabled = true;
        cfg.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        cfg.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        cfg.memory.sources.project_memory_paths = Vec::new();
        cfg.memory.sources.project_rule_dirs = Vec::new();

        let resolved = resolve_effective_sources(&cfg, Path::new("."), None);
        assert!(resolved
            .response
            .sources
            .iter()
            .any(|source| source.kind == "durable_memory"
                && source.path == "/memories/MEMORY.md"
                && source.loaded));
        assert!(resolved
            .response
            .sources
            .iter()
            .any(|source| source.kind == "durable_memory"
                && source.path == "/memories/team/preferences.md"
                && source.loaded));
        assert!(resolved
            .prompt_segments
            .iter()
            .any(|segment| segment.contains("/memories/MEMORY.md")));
    }

    #[test]
    fn should_resolve_memdir_topic_items_with_provider_metadata() {
        let _env_lock = durable_memory_env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let empty_durable_root = tmp.path().join("durable-empty");
        fs::create_dir_all(&empty_durable_root).expect("create empty durable root");
        let _durable_guard = DurableMemoryEnvGuard::set(&empty_durable_root);

        let mut cfg = Config::default();
        cfg.memory.enabled = true;
        cfg.memory.auto.enabled = true;
        cfg.memory.auto.root_dir = Some(tmp.path().join("memdir").to_string_lossy().to_string());
        cfg.memory.auto.entrypoint = "MEMORY.md".to_string();
        cfg.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        cfg.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        cfg.memory.sources.project_memory_paths = Vec::new();
        cfg.memory.sources.project_rule_dirs = Vec::new();

        crate::services::auto_memory_service::scaffold_memdir(&cfg.memory, tmp.path(), false)
            .expect("scaffold memdir");
        crate::services::auto_memory_service::update_auto_memory_note(
            &cfg.memory,
            tmp.path(),
            "Why:\n- 团队多次确认 pnpm only 可以避免锁文件漂移。\n\nHow to apply:\n- 涉及依赖安装时默认使用 pnpm，并保留锁文件。",
            Some("workflow"),
            Some(MemdirMemoryType::Feedback),
        )
        .expect("write feedback note");

        let resolved = resolve_effective_sources(&cfg, tmp.path(), None);
        let auto_root = tmp.path().join("memdir");
        let entry_path = auto_root.join("MEMORY.md").to_string_lossy().to_string();
        let topic_path = auto_root
            .join("feedback/workflow.md")
            .to_string_lossy()
            .to_string();

        assert!(resolved.response.sources.iter().any(|source| {
            source.kind == "auto_memory"
                && source.source_bucket.as_deref() == Some("auto")
                && source.provider.as_deref() == Some("memdir")
                && source.updated_at.is_some()
                && source.path == entry_path
        }));

        assert!(resolved.response.sources.iter().any(|source| {
            source.kind == "auto_memory_item"
                && source.path == topic_path
                && source.loaded
                && source.source_bucket.as_deref() == Some("auto")
                && source.provider.as_deref() == Some("memdir")
                && source.memory_type == Some(MemdirMemoryType::Feedback)
                && source.updated_at.is_some()
        }));

        assert!(resolved
            .prompt_segments
            .iter()
            .any(|segment| segment.contains("pnpm only")));
    }

    #[test]
    fn should_prioritize_specific_memdir_topic_before_type_readme_in_prompt_sources() {
        let _env_lock = durable_memory_env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let empty_durable_root = tmp.path().join("durable-empty");
        fs::create_dir_all(&empty_durable_root).expect("create empty durable root");
        let _durable_guard = DurableMemoryEnvGuard::set(&empty_durable_root);

        let mut cfg = Config::default();
        cfg.memory.enabled = true;
        cfg.memory.auto.enabled = true;
        cfg.memory.auto.root_dir = Some(tmp.path().join("memdir").to_string_lossy().to_string());
        cfg.memory.auto.entrypoint = "MEMORY.md".to_string();
        cfg.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        cfg.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        cfg.memory.sources.project_memory_paths = Vec::new();
        cfg.memory.sources.project_rule_dirs = Vec::new();

        crate::services::auto_memory_service::scaffold_memdir(&cfg.memory, tmp.path(), false)
            .expect("scaffold memdir");
        crate::services::auto_memory_service::update_auto_memory_note(
            &cfg.memory,
            tmp.path(),
            "Why:\n- 团队多次确认 pnpm only 可以避免锁文件漂移。\n\nHow to apply:\n- 涉及依赖安装时默认使用 pnpm，并保留锁文件。",
            Some("workflow"),
            Some(MemdirMemoryType::Feedback),
        )
        .expect("write feedback note");

        let resolved = resolve_effective_sources(&cfg, tmp.path(), None);
        let first_item = resolved
            .prompt_sources
            .iter()
            .find(|source| source.title.starts_with("auto_memory_item:"))
            .expect("find first auto memory item");

        assert!(first_item.path.ends_with("feedback/workflow.md"));
    }

    #[test]
    fn workspace_local_instruction_path_should_not_walk_ancestors() {
        let _env_lock = durable_memory_env_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let project_root = tmp.path().join("repo");
        let nested = project_root.join("workspace");
        let empty_durable_root = tmp.path().join("durable-empty");
        fs::create_dir_all(project_root.join(".git")).expect("create git marker");
        fs::create_dir_all(project_root.join(".lime")).expect("create root .lime");
        fs::create_dir_all(nested.join(".lime")).expect("create nested .lime");
        fs::create_dir_all(&empty_durable_root).expect("create empty durable root");
        fs::write(project_root.join(".lime/AGENTS.md"), "root agents").expect("write root agents");
        fs::write(nested.join(".lime/AGENTS.md"), "workspace agents")
            .expect("write workspace agents");
        let _durable_guard = DurableMemoryEnvGuard::set(&empty_durable_root);

        let mut cfg = Config::default();
        cfg.memory.enabled = true;
        cfg.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        cfg.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        cfg.memory.sources.project_memory_paths = vec![".lime/AGENTS.md".to_string()];

        let resolved = resolve_effective_sources(&cfg, &nested, None);
        let loaded_sources: Vec<&EffectiveMemorySource> = resolved
            .response
            .sources
            .iter()
            .filter(|source| source.kind == "project_memory" && source.loaded)
            .collect();

        assert_eq!(loaded_sources.len(), 1);
        assert!(loaded_sources[0].path.ends_with(".lime/AGENTS.md"));
        assert_eq!(resolved.prompt_segments.len(), 1);
        assert!(resolved.prompt_segments[0].contains("workspace agents"));
        assert!(!resolved.prompt_segments[0].contains("root agents"));
    }
}
