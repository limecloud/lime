//! 自动记忆服务
//!
//! 提供自动记忆目录定位、入口索引读取与笔记更新能力。

use chrono::{DateTime, Local, NaiveDateTime, Utc};
use lime_core::app_paths;
use lime_core::config::{MemoryAutoConfig, MemoryConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const MEMDIR_README_FILE_NAME: &str = "README.md";
const MEMORY_ENTRYPOINT_FALLBACK: &str = "MEMORY.md";
const MEMDIR_PROVIDER_NAME: &str = "memdir";
const MEMDIR_INDEX_MAX_DEPTH: usize = 4;
const MEMDIR_ENTRY_NOTE_LIMIT: usize = 12;
const MEMDIR_TYPE_README_SECTION_LIMIT: usize = 6;
const PROJECT_RELATIVE_DATE_TERMS: &[&str] = &[
    "今天",
    "明天",
    "昨天",
    "后天",
    "今晚",
    "今早",
    "本周",
    "下周",
    "上周",
    "本月",
    "下个月",
    "上个月",
    "本季度",
    "下季度",
    "上季度",
];
const PROJECT_RELATIVE_DATE_ASCII_TERMS: &[&str] = &[
    "today",
    "tomorrow",
    "yesterday",
    "tonight",
    "this week",
    "next week",
    "last week",
    "this month",
    "next month",
    "last month",
    "this quarter",
    "next quarter",
    "last quarter",
];

/// memdir 四类记忆
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemdirMemoryType {
    User,
    Feedback,
    Project,
    Reference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AutoMemoryProviderKind {
    Memdir,
}

impl AutoMemoryProviderKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Memdir => MEMDIR_PROVIDER_NAME,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct MemdirProvider;

impl MemdirProvider {
    fn provider_name(self) -> &'static str {
        AutoMemoryProviderKind::Memdir.as_str()
    }

    fn validate_note(
        self,
        note: &str,
        memory_type: Option<MemdirMemoryType>,
    ) -> Result<(), String> {
        let Some(memory_type) = memory_type else {
            return Ok(());
        };

        if matches!(
            memory_type,
            MemdirMemoryType::Feedback | MemdirMemoryType::Project
        ) {
            ensure_structured_memdir_note(note, memory_type)?;
        }

        if memory_type == MemdirMemoryType::Project {
            ensure_absolute_project_dates(note)?;
        }

        Ok(())
    }

    fn build_index_item(
        self,
        title: String,
        relative_path: String,
        path: &Path,
    ) -> AutoMemoryIndexItem {
        AutoMemoryIndexItem {
            title,
            memory_type: infer_memdir_memory_type(&relative_path),
            provider: Some(self.provider_name().to_string()),
            updated_at: read_path_updated_at(path),
            relative_path,
            exists: path.is_file(),
            summary: read_item_summary(path),
        }
    }
}

impl MemdirMemoryType {
    fn directory_name(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Feedback => "feedback",
            Self::Project => "project",
            Self::Reference => "reference",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::User => "用户记忆",
            Self::Feedback => "反馈记忆",
            Self::Project => "项目记忆",
            Self::Reference => "参考记忆",
        }
    }

    fn starter_description(self) -> &'static str {
        match self {
            Self::User => "记录用户角色、背景、长期偏好与协作方式，帮助 Lime 调整回答和协作节奏。",
            Self::Feedback => {
                "记录被反复确认的做事规则、纠偏建议与成功经验，避免同样的问题反复出现。"
            }
            Self::Project => {
                "记录项目背景、时间点、约束、动机与团队分工，补足代码之外的重要上下文。"
            }
            Self::Reference => {
                "记录外部文档、工单、监控、知识库与系统入口，帮助后续快速定位事实源。"
            }
        }
    }

    fn starter_examples(self) -> &'static [&'static str] {
        match self {
            Self::User => &[
                "用户熟悉哪些技术或业务背景",
                "用户偏好的沟通方式与解释深浅",
                "长期有效的合作习惯",
            ],
            Self::Feedback => &[
                "不要做的事与明确避坑规则",
                "被验证有效的实现或协作方式",
                "适用范围与触发条件",
            ],
            Self::Project => &[
                "当前主线、冻结窗口和里程碑",
                "为什么要做这件事",
                "当前团队分工和协作关系",
            ],
            Self::Reference => &[
                "文档、工单、监控看板入口",
                "外部系统的真实事实源",
                "需要回查的知识库位置",
            ],
        }
    }
}

/// memdir 脚手架文件结果
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemdirScaffoldFile {
    pub key: String,
    pub path: String,
    pub status: String,
}

/// memdir 脚手架响应
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemdirScaffoldResult {
    pub root_dir: String,
    pub entrypoint: String,
    pub created_parent_dir: bool,
    pub files: Vec<MemdirScaffoldFile>,
}

/// memdir 整理结果
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemdirCleanupResult {
    pub root_dir: String,
    pub entrypoint: String,
    pub scanned_files: u32,
    pub updated_files: u32,
    pub removed_duplicate_links: u32,
    pub dropped_missing_links: u32,
    pub removed_duplicate_notes: u32,
    pub trimmed_notes: u32,
    pub curated_topic_files: u32,
}

#[derive(Debug, Clone, Default)]
struct MemdirCleanupStats {
    scanned_files: u32,
    updated_files: u32,
    removed_duplicate_links: u32,
    dropped_missing_links: u32,
    removed_duplicate_notes: u32,
    trimmed_notes: u32,
    curated_topic_files: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TimestampedNoteLine {
    timestamp: String,
    note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TimestampedSection {
    timestamp: String,
    content: String,
}

/// 自动记忆索引项
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoMemoryIndexItem {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_type: Option<MemdirMemoryType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    pub relative_path: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// 自动记忆索引响应
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoMemoryIndexResponse {
    pub enabled: bool,
    pub root_dir: String,
    pub entrypoint: String,
    pub max_loaded_lines: u32,
    pub entry_exists: bool,
    pub total_lines: u32,
    pub preview_lines: Vec<String>,
    pub items: Vec<AutoMemoryIndexItem>,
}

/// 读取自动记忆索引
pub fn get_auto_memory_index(
    memory_config: &MemoryConfig,
    working_dir: &Path,
) -> Result<AutoMemoryIndexResponse, String> {
    let provider = MemdirProvider;
    let auto = &memory_config.auto;
    let root_dir = resolve_auto_memory_root(working_dir, auto);
    let entry_name = auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        MEMORY_ENTRYPOINT_FALLBACK
    } else {
        entry_name
    };
    let entry_path = root_dir.join(entry_name);

    let mut response = AutoMemoryIndexResponse {
        enabled: auto.enabled,
        root_dir: root_dir.to_string_lossy().to_string(),
        entrypoint: entry_name.to_string(),
        max_loaded_lines: auto.max_loaded_lines,
        entry_exists: entry_path.is_file(),
        total_lines: 0,
        preview_lines: Vec::new(),
        items: Vec::new(),
    };

    if !entry_path.is_file() {
        return Ok(response);
    }

    let raw = fs::read_to_string(&entry_path)
        .map_err(|e| format!("读取自动记忆入口失败 {}: {e}", entry_path.display()))?;
    let lines: Vec<String> = raw.lines().map(|s| s.to_string()).collect();
    response.total_lines = lines.len() as u32;
    response.preview_lines = lines
        .iter()
        .take(auto.max_loaded_lines as usize)
        .cloned()
        .collect();
    response.items = parse_index_items(&lines, &root_dir, &root_dir, provider);

    Ok(response)
}

/// 更新自动记忆笔记
pub fn update_auto_memory_note(
    memory_config: &MemoryConfig,
    working_dir: &Path,
    note: &str,
    topic: Option<&str>,
    memory_type: Option<MemdirMemoryType>,
) -> Result<AutoMemoryIndexResponse, String> {
    let trimmed_note = note.trim();
    if trimmed_note.is_empty() {
        return Err("note 不能为空".to_string());
    }
    let provider = MemdirProvider;
    provider.validate_note(trimmed_note, memory_type)?;

    let auto = &memory_config.auto;
    let root_dir = resolve_auto_memory_root(working_dir, auto);
    fs::create_dir_all(&root_dir)
        .map_err(|e| format!("创建自动记忆目录失败 {}: {e}", root_dir.display()))?;

    let entry_name = auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        MEMORY_ENTRYPOINT_FALLBACK
    } else {
        entry_name
    };
    let entry_path = root_dir.join(entry_name);

    if let Some(kind) = memory_type {
        ensure_memdir_entrypoint(&entry_path)?;

        let type_readme_path = root_dir
            .join(kind.directory_name())
            .join(MEMDIR_README_FILE_NAME);
        ensure_memdir_type_readme(&type_readme_path, kind)?;
        ensure_entry_link(
            &entry_path,
            kind.display_name(),
            &format!("{}/{}", kind.directory_name(), MEMDIR_README_FILE_NAME),
        )?;

        if let Some(topic_name) = topic.map(str::trim).filter(|v| !v.is_empty()) {
            let topic_file = normalize_topic_filename(topic_name);
            let topic_path = root_dir.join(kind.directory_name()).join(&topic_file);
            upsert_topic_note(&topic_path, topic_name, trimmed_note)?;
            ensure_entry_link(&type_readme_path, topic_name, &topic_file)?;
        } else {
            append_topic_note(&type_readme_path, kind.display_name(), trimmed_note)?;
            let mut cleanup_stats = MemdirCleanupStats::default();
            cleanup_type_readme_file(&type_readme_path, &root_dir, kind, &mut cleanup_stats)?;
        }
    } else if let Some(topic_name) = topic.map(str::trim).filter(|v| !v.is_empty()) {
        let topic_file = normalize_topic_filename(topic_name);
        let topic_path = root_dir.join(&topic_file);
        append_topic_note(&topic_path, topic_name, trimmed_note)?;
        ensure_entry_link(&entry_path, topic_name, &topic_file)?;
    } else {
        append_entry_note(&entry_path, trimmed_note)?;
    }

    get_auto_memory_index(memory_config, working_dir)
}

/// 整理 memdir：去重索引、裁剪 README 历史段落，并把 topic note 收口为当前版本。
pub fn cleanup_memdir(
    memory_config: &MemoryConfig,
    working_dir: &Path,
) -> Result<MemdirCleanupResult, String> {
    let auto = &memory_config.auto;
    let root_dir = resolve_auto_memory_root(working_dir, auto);
    let entry_name = auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        MEMORY_ENTRYPOINT_FALLBACK
    } else {
        entry_name
    };
    let entry_path = root_dir.join(entry_name);
    let mut stats = MemdirCleanupStats::default();

    if entry_path.is_file() {
        cleanup_entrypoint_file(&entry_path, &root_dir, &mut stats)?;
    }

    for kind in [
        MemdirMemoryType::User,
        MemdirMemoryType::Feedback,
        MemdirMemoryType::Project,
        MemdirMemoryType::Reference,
    ] {
        let dir_path = root_dir.join(kind.directory_name());
        let readme_path = dir_path.join(MEMDIR_README_FILE_NAME);
        if readme_path.is_file() {
            cleanup_type_readme_file(&readme_path, &root_dir, kind, &mut stats)?;
        }
        cleanup_topic_directory(&dir_path, &entry_path, &mut stats)?;
    }

    cleanup_topic_directory(&root_dir, &entry_path, &mut stats)?;

    Ok(MemdirCleanupResult {
        root_dir: root_dir.to_string_lossy().to_string(),
        entrypoint: entry_name.to_string(),
        scanned_files: stats.scanned_files,
        updated_files: stats.updated_files,
        removed_duplicate_links: stats.removed_duplicate_links,
        dropped_missing_links: stats.dropped_missing_links,
        removed_duplicate_notes: stats.removed_duplicate_notes,
        trimmed_notes: stats.trimmed_notes,
        curated_topic_files: stats.curated_topic_files,
    })
}

/// 初始化 memdir 套件
pub fn scaffold_memdir(
    memory_config: &MemoryConfig,
    working_dir: &Path,
    overwrite: bool,
) -> Result<MemdirScaffoldResult, String> {
    let auto = &memory_config.auto;
    let root_dir = resolve_auto_memory_root(working_dir, auto);
    let created_parent_dir = !root_dir.exists();
    fs::create_dir_all(&root_dir)
        .map_err(|e| format!("创建 memdir 根目录失败 {}: {e}", root_dir.display()))?;

    let entry_name = auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        MEMORY_ENTRYPOINT_FALLBACK
    } else {
        entry_name
    };
    let entry_path = root_dir.join(entry_name);

    let mut files = vec![MemdirScaffoldFile {
        key: "entrypoint".to_string(),
        path: entry_path.to_string_lossy().to_string(),
        status: write_scaffold_file(&entry_path, &render_memdir_entrypoint(), overwrite)?,
    }];

    for kind in [
        MemdirMemoryType::User,
        MemdirMemoryType::Feedback,
        MemdirMemoryType::Project,
        MemdirMemoryType::Reference,
    ] {
        let readme_path = root_dir
            .join(kind.directory_name())
            .join(MEMDIR_README_FILE_NAME);
        files.push(MemdirScaffoldFile {
            key: kind.directory_name().to_string(),
            path: readme_path.to_string_lossy().to_string(),
            status: write_scaffold_file(&readme_path, &render_memdir_type_readme(kind), overwrite)?,
        });
    }

    Ok(MemdirScaffoldResult {
        root_dir: root_dir.to_string_lossy().to_string(),
        entrypoint: entry_name.to_string(),
        created_parent_dir,
        files,
    })
}

/// 解析自动记忆根目录
pub fn resolve_auto_memory_root(working_dir: &Path, auto: &MemoryAutoConfig) -> PathBuf {
    if let Some(custom_root) = auto.root_dir.as_deref().map(str::trim) {
        if !custom_root.is_empty() {
            return expand_path(custom_root, Some(working_dir));
        }
    }

    let project_anchor = find_git_root(working_dir).unwrap_or_else(|| working_dir.to_path_buf());
    let slug = project_anchor
        .to_string_lossy()
        .replace(['\\', '/', ':', ' '], "_")
        .trim_matches('_')
        .to_string();
    let project_slug = if slug.is_empty() {
        "default".to_string()
    } else {
        slug
    };

    app_paths::best_effort_runtime_subdir("projects")
        .join(project_slug)
        .join("memory")
}

fn parse_index_items(
    lines: &[String],
    root_dir: &Path,
    base_dir: &Path,
    provider: MemdirProvider,
) -> Vec<AutoMemoryIndexItem> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    collect_index_items(
        lines, root_dir, base_dir, provider, 0, &mut seen, &mut items,
    );
    items
}

fn collect_index_items(
    lines: &[String],
    root_dir: &Path,
    base_dir: &Path,
    provider: MemdirProvider,
    depth: usize,
    seen: &mut HashSet<String>,
    items: &mut Vec<AutoMemoryIndexItem>,
) {
    if depth > MEMDIR_INDEX_MAX_DEPTH {
        return;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Markdown link: - [title](path)
        if let Some((title, raw_target)) = parse_markdown_link(trimmed) {
            let Some((relative_path, path)) =
                resolve_memdir_target(&raw_target, root_dir, base_dir)
            else {
                continue;
            };
            if !seen.insert(relative_path.clone()) {
                continue;
            }
            items.push(provider.build_index_item(title, relative_path.clone(), &path));
            collect_nested_index_items(&path, root_dir, provider, depth + 1, seen, items);
            continue;
        }

        // import 风格：@topic.md
        if let Some(import_target) = trimmed.strip_prefix('@') {
            let Some((relative_path, path)) =
                resolve_memdir_target(import_target.trim(), root_dir, base_dir)
            else {
                continue;
            };
            if !seen.insert(relative_path.clone()) {
                continue;
            }
            items.push(provider.build_index_item(
                relative_path.clone(),
                relative_path.clone(),
                &path,
            ));
            collect_nested_index_items(&path, root_dir, provider, depth + 1, seen, items);
        }
    }
}

fn read_item_summary(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("- [")
            || trimmed.starts_with("* [")
            || trimmed.starts_with('@')
            || is_structured_section_line(trimmed)
        {
            continue;
        }
        let summary = trimmed
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .trim();
        return Some(clip_summary(summary, 120));
    }
    None
}

fn parse_markdown_link(line: &str) -> Option<(String, String)> {
    let cleaned = line
        .trim_start_matches("- ")
        .trim_start_matches("* ")
        .trim();
    let title_start = cleaned.find('[')?;
    let title_end = cleaned[title_start + 1..].find(']')? + title_start + 1;
    let path_start = cleaned[title_end + 1..].find('(')? + title_end + 1;
    let path_end = cleaned[path_start + 1..].find(')')? + path_start + 1;

    let title = cleaned[title_start + 1..title_end].trim().to_string();
    let path = cleaned[path_start + 1..path_end].trim().to_string();
    if title.is_empty() || path.is_empty() {
        return None;
    }
    Some((title, path))
}

fn collect_nested_index_items(
    path: &Path,
    root_dir: &Path,
    provider: MemdirProvider,
    depth: usize,
    seen: &mut HashSet<String>,
    items: &mut Vec<AutoMemoryIndexItem>,
) {
    if depth > MEMDIR_INDEX_MAX_DEPTH || !path.is_file() || !is_memdir_index_candidate(path) {
        return;
    }
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };
    let lines: Vec<String> = raw.lines().map(|line| line.to_string()).collect();
    let base_dir = path.parent().unwrap_or(root_dir);
    collect_index_items(&lines, root_dir, base_dir, provider, depth, seen, items);
}

fn resolve_memdir_target(
    target: &str,
    root_dir: &Path,
    base_dir: &Path,
) -> Option<(String, PathBuf)> {
    let trimmed = target.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.contains("://")
        || trimmed.contains("..")
        || Path::new(trimmed).is_absolute()
    {
        return None;
    }

    let path = base_dir.join(trimmed);
    let relative_path = path
        .strip_prefix(root_dir)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    if relative_path.is_empty() {
        return None;
    }
    Some((relative_path, path))
}

fn is_memdir_index_candidate(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdx") | Some("txt")
    )
}

pub(crate) fn infer_memdir_memory_type(relative_path: &str) -> Option<MemdirMemoryType> {
    let head = relative_path.replace('\\', "/");
    let head = head.split('/').next()?.trim();
    match head {
        "user" => Some(MemdirMemoryType::User),
        "feedback" => Some(MemdirMemoryType::Feedback),
        "project" => Some(MemdirMemoryType::Project),
        "reference" => Some(MemdirMemoryType::Reference),
        _ => None,
    }
}

fn read_path_updated_at(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Utc>::from(modified).timestamp_millis())
}

fn ensure_structured_memdir_note(note: &str, memory_type: MemdirMemoryType) -> Result<(), String> {
    if !note_has_section(note, &["why", "为什么", "原因"]) {
        return Err(format!(
            "{} 需要包含 `Why:` 段落，说明这条记忆为什么成立。",
            memory_type.display_name()
        ));
    }

    if !note_has_section(note, &["how to apply", "如何使用", "如何应用"]) {
        return Err(format!(
            "{} 需要包含 `How to apply:` 段落，说明后续应如何使用这条记忆。",
            memory_type.display_name()
        ));
    }

    Ok(())
}

fn note_has_section(note: &str, headings: &[&str]) -> bool {
    note.lines().any(|line| {
        let normalized = normalize_structured_line(line);
        headings
            .iter()
            .any(|heading| normalized.starts_with(&heading.to_ascii_lowercase()))
    })
}

fn normalize_structured_line(line: &str) -> String {
    line.trim()
        .trim_start_matches(|ch: char| matches!(ch, '#' | '-' | '*' | ' ' | '\t'))
        .replace('：', ":")
        .to_ascii_lowercase()
}

fn is_structured_section_line(line: &str) -> bool {
    let normalized = normalize_structured_line(line);
    normalized.starts_with("why")
        || normalized.starts_with("为什么")
        || normalized.starts_with("原因")
        || normalized.starts_with("how to apply")
        || normalized.starts_with("如何使用")
        || normalized.starts_with("如何应用")
}

fn ensure_absolute_project_dates(note: &str) -> Result<(), String> {
    if let Some(term) = find_relative_date_term(note) {
        return Err(format!(
            "项目记忆不能使用相对时间词“{term}”，请改成绝对日期，例如 `{}` 或 `{}`。",
            Local::now().format("%Y-%m-%d"),
            Local::now().format("%Y-%m-%d %H:%M")
        ));
    }
    Ok(())
}

fn find_relative_date_term(note: &str) -> Option<&'static str> {
    let normalized_ascii = note.replace('：', ":").to_ascii_lowercase();
    for term in PROJECT_RELATIVE_DATE_TERMS {
        if note.contains(term) {
            return Some(term);
        }
    }
    for term in PROJECT_RELATIVE_DATE_ASCII_TERMS {
        if contains_ascii_phrase(&normalized_ascii, term) {
            return Some(term);
        }
    }
    None
}

fn contains_ascii_phrase(text: &str, phrase: &str) -> bool {
    if phrase.is_empty() {
        return false;
    }

    let mut search_start = 0usize;
    while let Some(offset) = text[search_start..].find(phrase) {
        let start = search_start + offset;
        let end = start + phrase.len();
        let before = text[..start].chars().next_back();
        let after = text[end..].chars().next();
        let before_ok = before.map(|ch| !is_ascii_word_char(ch)).unwrap_or(true);
        let after_ok = after.map(|ch| !is_ascii_word_char(ch)).unwrap_or(true);
        if before_ok && after_ok {
            return true;
        }
        search_start = end;
    }
    false
}

fn is_ascii_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn append_entry_note(entry_path: &Path, note: &str) -> Result<(), String> {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("- [{timestamp}] {note}\n");
    let mut existing = if entry_path.is_file() {
        fs::read_to_string(entry_path)
            .map_err(|e| format!("读取 MEMORY 入口失败 {}: {e}", entry_path.display()))?
    } else {
        render_memdir_entrypoint()
    };
    if !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&line);
    let normalized =
        normalize_entrypoint_content(&existing, entry_path.parent().unwrap_or(entry_path))?;
    fs::write(entry_path, normalized)
        .map_err(|e| format!("写入 MEMORY 入口失败 {}: {e}", entry_path.display()))
}

fn append_topic_note(topic_path: &Path, topic_name: &str, note: &str) -> Result<(), String> {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let mut content = if topic_path.is_file() {
        fs::read_to_string(topic_path)
            .map_err(|e| format!("读取主题记忆失败 {}: {e}", topic_path.display()))?
    } else {
        format!("# {topic_name}\n\n")
    };
    if !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&format!("## {timestamp}\n\n{note}\n\n"));
    fs::write(topic_path, content)
        .map_err(|e| format!("写入主题记忆失败 {}: {e}", topic_path.display()))
}

fn upsert_topic_note(topic_path: &Path, topic_name: &str, note: &str) -> Result<(), String> {
    let display_title = read_markdown_h1(topic_path)
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| topic_name.trim().to_string());
    if let Some(parent) = topic_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建主题记忆目录失败 {}: {e}", parent.display()))?;
    }
    fs::write(topic_path, render_topic_note(&display_title, note))
        .map_err(|e| format!("写入主题记忆失败 {}: {e}", topic_path.display()))
}

fn ensure_entry_link(entry_path: &Path, topic_name: &str, topic_file: &str) -> Result<(), String> {
    let mut content = if entry_path.is_file() {
        fs::read_to_string(entry_path)
            .map_err(|e| format!("读取 MEMORY 入口失败 {}: {e}", entry_path.display()))?
    } else {
        render_memdir_entrypoint()
    };
    let marker = format!("({topic_file})");
    if !content.contains(&marker) {
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&format!("- [{topic_name}]({topic_file})\n"));
    }
    fs::write(entry_path, content)
        .map_err(|e| format!("写入 MEMORY 入口失败 {}: {e}", entry_path.display()))
}

fn ensure_memdir_entrypoint(entry_path: &Path) -> Result<(), String> {
    if entry_path.is_file() {
        return Ok(());
    }
    write_scaffold_file(entry_path, &render_memdir_entrypoint(), false).map(|_| ())
}

fn ensure_memdir_type_readme(path: &Path, memory_type: MemdirMemoryType) -> Result<(), String> {
    if path.is_file() {
        return Ok(());
    }
    write_scaffold_file(path, &render_memdir_type_readme(memory_type), false).map(|_| ())
}

fn write_scaffold_file(path: &Path, content: &str, overwrite: bool) -> Result<String, String> {
    let existed = path.is_file();
    if existed && !overwrite {
        return Ok("exists".to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }

    fs::write(path, content).map_err(|e| format!("写入脚手架文件失败 {}: {e}", path.display()))?;
    Ok(if existed {
        "overwritten".to_string()
    } else {
        "created".to_string()
    })
}

fn render_memdir_entrypoint() -> String {
    [
        "# Lime memdir",
        "",
        "这个目录承接 Lime 的文件化记忆。优先记录不容易从当前仓库、Git 历史或外部系统直接推导的长期信息。",
        "",
        "## 入口索引",
        "- [用户记忆](user/README.md)",
        "- [反馈记忆](feedback/README.md)",
        "- [项目记忆](project/README.md)",
        "- [参考记忆](reference/README.md)",
        "",
        "## 写入建议",
        "- `user`：用户背景、长期偏好、沟通方式",
        "- `feedback`：被反复确认的做事规则、纠偏与成功经验",
        "- `project`：项目背景、时间点、动机与协作关系",
        "- `reference`：外部文档、工单、监控与知识库入口",
        "",
        "## 不要写进记忆",
        "- 能从代码、规则、目录结构直接读取的事实",
        "- Git 历史、一次性调试过程和短期待办",
        "- 当前会话里的临时上下文和工作摘录",
        "",
        "## 读取守则",
        "- 用户明确要求回忆、检查或记住时，先读这个目录",
        "- 记忆和当前事实冲突时，以最新代码、文件和外部资源为准",
        "- Team shadow 由运行时单独维护，这里主要承接可版本化的长期记忆",
        "",
    ]
    .join("\n")
}

fn render_memdir_type_readme(memory_type: MemdirMemoryType) -> String {
    let mut lines = vec![
        format!("# {}", memory_type.display_name()),
        "".to_string(),
        memory_type.starter_description().to_string(),
        "".to_string(),
        "## 建议记录".to_string(),
    ];

    for item in memory_type.starter_examples() {
        lines.push(format!("- {item}"));
    }

    lines.extend(["".to_string(), "## 条目".to_string(), "".to_string()]);

    lines.join("\n")
}

fn render_topic_note(title: &str, note: &str) -> String {
    format!("# {}\n\n{}\n", title.trim(), note.trim())
}

fn clip_summary(value: &str, max_chars: usize) -> String {
    let normalized = value.trim();
    if normalized.chars().count() <= max_chars {
        return normalized.to_string();
    }
    normalized.chars().take(max_chars - 1).collect::<String>() + "…"
}

fn normalize_topic_filename(topic: &str) -> String {
    let lowered = topic.trim().to_lowercase();
    let mut slug = String::with_capacity(lowered.len() + 3);
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
        } else if ch == '-' || ch == '_' || ch == ' ' {
            slug.push('-');
        }
    }
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "notes.md".to_string()
    } else if slug.ends_with(".md") {
        slug.to_string()
    } else {
        format!("{slug}.md")
    }
}

fn cleanup_entrypoint_file(
    path: &Path,
    root_dir: &Path,
    stats: &mut MemdirCleanupStats,
) -> Result<(), String> {
    cleanup_file_with_transform(path, stats, |raw, current_path, cleanup_stats| {
        normalize_entrypoint_content_with_stats(
            raw,
            current_path.parent().unwrap_or(root_dir),
            cleanup_stats,
        )
    })
}

fn cleanup_type_readme_file(
    path: &Path,
    root_dir: &Path,
    memory_type: MemdirMemoryType,
    stats: &mut MemdirCleanupStats,
) -> Result<(), String> {
    cleanup_file_with_transform(path, stats, |raw, current_path, cleanup_stats| {
        normalize_type_readme_content(
            raw,
            current_path.parent().unwrap_or(root_dir),
            memory_type,
            cleanup_stats,
        )
    })
}

fn cleanup_topic_directory(
    dir_path: &Path,
    entry_path: &Path,
    stats: &mut MemdirCleanupStats,
) -> Result<(), String> {
    if !dir_path.is_dir() {
        return Ok(());
    }

    let mut entries = fs::read_dir(dir_path)
        .map_err(|e| format!("读取 memdir 目录失败 {}: {e}", dir_path.display()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() || !is_memdir_index_candidate(&path) {
            continue;
        }
        if path == entry_path {
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value == MEMDIR_README_FILE_NAME)
            .unwrap_or(false)
        {
            continue;
        }
        cleanup_topic_file(&path, stats)?;
    }

    Ok(())
}

fn cleanup_topic_file(path: &Path, stats: &mut MemdirCleanupStats) -> Result<(), String> {
    cleanup_file_with_transform(path, stats, |raw, current_path, cleanup_stats| {
        normalize_topic_content(raw, current_path, cleanup_stats)
    })
}

fn cleanup_file_with_transform<F>(
    path: &Path,
    stats: &mut MemdirCleanupStats,
    transform: F,
) -> Result<(), String>
where
    F: FnOnce(&str, &Path, &mut MemdirCleanupStats) -> Result<String, String>,
{
    stats.scanned_files += 1;
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("读取 memdir 文件失败 {}: {e}", path.display()))?;
    let normalized = transform(&raw, path, stats)?;
    if normalized != raw {
        fs::write(path, normalized)
            .map_err(|e| format!("写入 memdir 文件失败 {}: {e}", path.display()))?;
        stats.updated_files += 1;
    }
    Ok(())
}

fn normalize_entrypoint_content(raw: &str, base_dir: &Path) -> Result<String, String> {
    normalize_entrypoint_content_with_stats(raw, base_dir, &mut MemdirCleanupStats::default())
}

fn normalize_entrypoint_content_with_stats(
    raw: &str,
    base_dir: &Path,
    stats: &mut MemdirCleanupStats,
) -> Result<String, String> {
    let mut static_lines = Vec::new();
    let mut timestamped_notes = Vec::new();
    let mut seen_links = HashSet::new();

    for line in raw.lines() {
        if let Some((link_target, exists)) = resolve_existing_memdir_link(line, base_dir) {
            if !exists {
                stats.dropped_missing_links += 1;
                continue;
            }
            if !seen_links.insert(link_target) {
                stats.removed_duplicate_links += 1;
                continue;
            }
            static_lines.push(line.to_string());
            continue;
        }
        if let Some(note_line) = parse_timestamped_note_line(line) {
            timestamped_notes.push(note_line);
            continue;
        }
        static_lines.push(line.to_string());
    }

    let kept_notes = dedupe_and_trim_timestamped_note_lines(timestamped_notes, stats);
    if !kept_notes.is_empty() {
        trim_trailing_blank_lines(&mut static_lines);
        if !static_lines.is_empty() {
            static_lines.push(String::new());
        }
        static_lines.extend(kept_notes.into_iter().map(|note| note.render()));
    }

    Ok(render_markdown_lines(static_lines))
}

fn normalize_type_readme_content(
    raw: &str,
    base_dir: &Path,
    memory_type: MemdirMemoryType,
    stats: &mut MemdirCleanupStats,
) -> Result<String, String> {
    let (body_lines, sections) = split_timestamped_sections(raw);
    let normalized_body = normalize_index_body_lines(
        body_lines,
        base_dir,
        stats,
        Some(render_memdir_type_readme(memory_type)),
    )?;
    let kept_sections = dedupe_and_trim_sections(sections, MEMDIR_TYPE_README_SECTION_LIMIT, stats);
    let mut lines: Vec<String> = normalized_body
        .lines()
        .map(|line| line.to_string())
        .collect();
    if !kept_sections.is_empty() {
        trim_trailing_blank_lines(&mut lines);
        if !lines.is_empty() {
            lines.push(String::new());
        }
        for (index, section) in kept_sections.into_iter().enumerate() {
            if index > 0 {
                lines.push(String::new());
            }
            lines.push(format!("## {}", section.timestamp));
            lines.push(String::new());
            lines.extend(section.content.lines().map(|line| line.to_string()));
        }
    }
    Ok(render_markdown_lines(lines))
}

fn normalize_topic_content(
    raw: &str,
    path: &Path,
    stats: &mut MemdirCleanupStats,
) -> Result<String, String> {
    let (_, sections) = split_timestamped_sections(raw);
    if !sections.is_empty() {
        let latest = sections
            .last()
            .map(|section| section.content.trim())
            .filter(|content| !content.is_empty())
            .unwrap_or("");
        let title = resolve_topic_display_title(raw, path);
        let normalized = if latest.is_empty() {
            format!("# {}\n", title)
        } else {
            render_topic_note(&title, latest)
        };
        if normalized != raw {
            stats.curated_topic_files += 1;
        }
        return Ok(normalized);
    }

    let title = resolve_topic_display_title(raw, path);
    let content_without_title = extract_topic_body_without_heading(raw);
    if content_without_title.trim().is_empty() {
        return Ok(format!("# {}\n", title));
    }

    let mut lines = vec![format!("# {}", title), String::new()];
    lines.extend(content_without_title.lines().map(|line| line.to_string()));
    Ok(render_markdown_lines(lines))
}

fn normalize_index_body_lines(
    lines: Vec<String>,
    base_dir: &Path,
    stats: &mut MemdirCleanupStats,
    fallback_content: Option<String>,
) -> Result<String, String> {
    let mut output = Vec::new();
    let mut seen_links = HashSet::new();
    for line in lines {
        if let Some((link_target, exists)) = resolve_existing_memdir_link(&line, base_dir) {
            if !exists {
                stats.dropped_missing_links += 1;
                continue;
            }
            if !seen_links.insert(link_target) {
                stats.removed_duplicate_links += 1;
                continue;
            }
        }
        output.push(line);
    }
    trim_trailing_blank_lines(&mut output);
    let rendered = render_markdown_lines(output);
    if rendered.trim().is_empty() {
        return Ok(fallback_content.unwrap_or_default());
    }
    Ok(rendered)
}

fn resolve_existing_memdir_link(line: &str, base_dir: &Path) -> Option<(String, bool)> {
    let Some((_, raw_target)) = parse_markdown_link(line.trim()) else {
        return None;
    };
    let target = raw_target.trim();
    if target.is_empty()
        || target.starts_with('#')
        || target.contains("://")
        || target.contains("..")
        || Path::new(target).is_absolute()
    {
        return None;
    }
    let path = base_dir.join(target);
    let relative_path = target.replace('\\', "/");
    Some((relative_path, path.exists()))
}

fn split_timestamped_sections(raw: &str) -> (Vec<String>, Vec<TimestampedSection>) {
    let mut body_lines = Vec::new();
    let mut sections = Vec::new();
    let mut current_timestamp: Option<String> = None;
    let mut current_lines = Vec::new();

    for line in raw.lines() {
        if let Some(timestamp) = parse_timestamp_heading(line) {
            if let Some(previous_timestamp) = current_timestamp.take() {
                sections.push(TimestampedSection {
                    timestamp: previous_timestamp,
                    content: current_lines.join("\n").trim().to_string(),
                });
                current_lines.clear();
            }
            current_timestamp = Some(timestamp);
            continue;
        }

        if current_timestamp.is_some() {
            current_lines.push(line.to_string());
        } else {
            body_lines.push(line.to_string());
        }
    }

    if let Some(timestamp) = current_timestamp {
        sections.push(TimestampedSection {
            timestamp,
            content: current_lines.join("\n").trim().to_string(),
        });
    }

    (body_lines, sections)
}

fn parse_timestamp_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let value = trimmed.strip_prefix("## ")?;
    NaiveDateTime::parse_from_str(value.trim(), "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|_| value.trim().to_string())
}

fn parse_timestamped_note_line(line: &str) -> Option<TimestampedNoteLine> {
    let trimmed = line.trim();
    let remainder = trimmed.strip_prefix("- [")?;
    let closing = remainder.find("] ")?;
    let timestamp = &remainder[..closing];
    NaiveDateTime::parse_from_str(timestamp.trim(), "%Y-%m-%d %H:%M:%S").ok()?;
    let note = remainder[closing + 2..].trim();
    if note.is_empty() {
        return None;
    }
    Some(TimestampedNoteLine {
        timestamp: timestamp.trim().to_string(),
        note: note.to_string(),
    })
}

fn dedupe_and_trim_timestamped_note_lines(
    notes: Vec<TimestampedNoteLine>,
    stats: &mut MemdirCleanupStats,
) -> Vec<TimestampedNoteLine> {
    let original_len = notes.len();
    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    for note in notes.into_iter().rev() {
        if seen.insert(note.note.clone()) {
            kept.push(note);
        }
    }
    kept.reverse();
    stats.removed_duplicate_notes += original_len.saturating_sub(kept.len()) as u32;
    if kept.len() > MEMDIR_ENTRY_NOTE_LIMIT {
        stats.trimmed_notes += kept.len().saturating_sub(MEMDIR_ENTRY_NOTE_LIMIT) as u32;
        kept = kept.split_off(kept.len() - MEMDIR_ENTRY_NOTE_LIMIT);
    }
    kept
}

fn dedupe_and_trim_sections(
    sections: Vec<TimestampedSection>,
    limit: usize,
    stats: &mut MemdirCleanupStats,
) -> Vec<TimestampedSection> {
    let original_len = sections.len();
    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    for section in sections.into_iter().rev() {
        if section.content.trim().is_empty() {
            stats.trimmed_notes += 1;
            continue;
        }
        if seen.insert(section.content.clone()) {
            kept.push(section);
        }
    }
    kept.reverse();
    stats.removed_duplicate_notes += original_len.saturating_sub(kept.len()) as u32;
    if kept.len() > limit {
        stats.trimmed_notes += kept.len().saturating_sub(limit) as u32;
        kept = kept.split_off(kept.len() - limit);
    }
    kept
}

fn render_markdown_lines(lines: Vec<String>) -> String {
    let mut output = Vec::new();
    let mut previous_blank = false;
    for line in lines {
        let is_blank = line.trim().is_empty();
        if is_blank && previous_blank {
            continue;
        }
        output.push(if is_blank {
            String::new()
        } else {
            line.trim_end().to_string()
        });
        previous_blank = is_blank;
    }
    trim_trailing_blank_lines(&mut output);
    if output.is_empty() {
        String::new()
    } else {
        format!("{}\n", output.join("\n"))
    }
}

fn trim_trailing_blank_lines(lines: &mut Vec<String>) {
    while lines
        .last()
        .map(|line| line.trim().is_empty())
        .unwrap_or(false)
    {
        lines.pop();
    }
}

fn resolve_topic_display_title(raw: &str, path: &Path) -> String {
    read_markdown_h1_from_raw(raw)
        .filter(|title| !title.trim().is_empty())
        .or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "记忆条目".to_string())
}

fn read_markdown_h1(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    read_markdown_h1_from_raw(&raw)
}

fn read_markdown_h1_from_raw(raw: &str) -> Option<String> {
    raw.lines()
        .find_map(|line| line.trim().strip_prefix("# "))
        .map(|title| title.trim().to_string())
}

fn extract_topic_body_without_heading(raw: &str) -> String {
    let mut lines = raw.lines();
    if lines
        .next()
        .map(|line| line.trim().starts_with("# "))
        .unwrap_or(false)
    {
        lines.collect::<Vec<_>>().join("\n").trim().to_string()
    } else {
        raw.trim().to_string()
    }
}

impl TimestampedNoteLine {
    fn render(self) -> String {
        format!("- [{}] {}", self.timestamp, self.note)
    }
}

fn expand_path(path: &str, working_dir: Option<&Path>) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(path.trim_start_matches("~/"));
        }
    }

    let p = PathBuf::from(path);
    if p.is_absolute() {
        return p;
    }

    if let Some(base) = working_dir {
        return base.join(p);
    }
    p
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn should_create_entry_when_update_note_without_topic() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let result = update_auto_memory_note(&cfg, tmp.path(), "记下这个偏好", None, None)
            .expect("update note");
        assert!(result.entry_exists);
        assert!(!result.preview_lines.is_empty());
    }

    #[test]
    fn should_add_topic_and_index_link() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let result = update_auto_memory_note(&cfg, tmp.path(), "pnpm only", Some("workflow"), None)
            .expect("update topic note");
        assert!(result
            .items
            .iter()
            .any(|item| item.relative_path == "workflow.md"));
    }

    #[test]
    fn should_scaffold_memdir_bundle() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let result = scaffold_memdir(&cfg, tmp.path(), false).expect("scaffold memdir");
        assert_eq!(result.files.len(), 5);
        assert!(tmp.path().join("MEMORY.md").is_file());
        assert!(tmp.path().join("project/README.md").is_file());
    }

    #[test]
    fn should_write_typed_memdir_note() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let result = update_auto_memory_note(
            &cfg,
            tmp.path(),
            "Why:\n- 用户多次确认先给结论可以减少沟通往返。\n\nHow to apply:\n- 每次先写结论，再补证据和风险。",
            Some("collaboration"),
            Some(MemdirMemoryType::Feedback),
        )
        .expect("update typed note");
        assert!(tmp.path().join("feedback/README.md").is_file());
        assert!(tmp.path().join("feedback/collaboration.md").is_file());
        assert!(result
            .items
            .iter()
            .any(|item| item.relative_path == "feedback/README.md"));
        assert!(result
            .items
            .iter()
            .any(|item| item.relative_path == "feedback/collaboration.md"
                && item.memory_type == Some(MemdirMemoryType::Feedback)
                && item.provider.as_deref() == Some(MEMDIR_PROVIDER_NAME)
                && item.updated_at.is_some()));
    }

    #[test]
    fn should_upsert_typed_topic_note_instead_of_appending_history() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        update_auto_memory_note(
            &cfg,
            tmp.path(),
            "Why:\n- 旧规则会造成锁文件漂移。\n\nHow to apply:\n- 一律使用 pnpm。",
            Some("workflow"),
            Some(MemdirMemoryType::Feedback),
        )
        .expect("write first note");

        update_auto_memory_note(
            &cfg,
            tmp.path(),
            "Why:\n- 新规则已经被团队再次确认。\n\nHow to apply:\n- 继续使用 pnpm，并在 CI 拒绝 npm lock。",
            Some("workflow"),
            Some(MemdirMemoryType::Feedback),
        )
        .expect("write second note");

        let raw = fs::read_to_string(tmp.path().join("feedback/workflow.md"))
            .expect("read workflow topic");
        assert!(raw.contains("新规则已经被团队再次确认"));
        assert!(!raw.contains("旧规则会造成锁文件漂移"));
        assert_eq!(raw.matches("# workflow").count(), 1);
        assert!(!raw.contains("## 20"));
    }

    #[test]
    fn should_cleanup_memdir_and_trim_duplicate_entry_notes() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        scaffold_memdir(&cfg, tmp.path(), false).expect("scaffold memdir");
        fs::write(
            tmp.path().join("MEMORY.md"),
            [
                "# Lime memdir",
                "",
                "## 入口索引",
                "- [反馈记忆](feedback/README.md)",
                "- [反馈记忆](feedback/README.md)",
                "",
                "- [2026-04-15 10:00:00] 保持 pnpm only",
                "- [2026-04-15 10:05:00] 保持 pnpm only",
                "",
            ]
            .join("\n"),
        )
        .expect("write entrypoint");
        fs::write(
            tmp.path().join("feedback/workflow.md"),
            [
                "# workflow",
                "",
                "## 2026-04-15 09:00:00",
                "",
                "Why:\n- 旧规则",
                "",
                "## 2026-04-15 11:00:00",
                "",
                "Why:\n- 新规则\n\nHow to apply:\n- 使用 pnpm",
                "",
            ]
            .join("\n"),
        )
        .expect("write workflow topic");

        let result = cleanup_memdir(&cfg, tmp.path()).expect("cleanup memdir");
        let entry_raw =
            fs::read_to_string(tmp.path().join("MEMORY.md")).expect("read normalized entrypoint");
        let topic_raw = fs::read_to_string(tmp.path().join("feedback/workflow.md"))
            .expect("read normalized topic");

        assert!(result.updated_files >= 2);
        assert!(result.removed_duplicate_links >= 1);
        assert!(result.removed_duplicate_notes >= 1);
        assert!(result.curated_topic_files >= 1);
        assert_eq!(entry_raw.matches("(feedback/README.md)").count(), 1);
        assert_eq!(entry_raw.matches("保持 pnpm only").count(), 1);
        assert!(topic_raw.contains("新规则"));
        assert!(!topic_raw.contains("旧规则"));
        assert!(!topic_raw.contains("## 2026-04-15"));
    }

    #[test]
    fn should_reject_unstructured_feedback_memdir_note() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let error = update_auto_memory_note(
            &cfg,
            tmp.path(),
            "保持 pnpm only",
            Some("workflow"),
            Some(MemdirMemoryType::Feedback),
        )
        .expect_err("feedback note should be rejected");

        assert!(error.contains("Why:"));
    }

    #[test]
    fn should_reject_project_memdir_note_with_relative_dates() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let error = update_auto_memory_note(
            &cfg,
            tmp.path(),
            "Why:\n- 冻结窗口影响发版路径。\n\nHow to apply:\n- 明天开始不要再改协议。",
            Some("release-window"),
            Some(MemdirMemoryType::Project),
        )
        .expect_err("project note with relative date should be rejected");

        assert!(error.contains("绝对日期"));
    }
}
