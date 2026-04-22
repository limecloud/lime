use aster::claude_plugin_cache::{
    load_cached_plugin_manifest_json, resolve_claude_manifest_relative_path,
    resolve_claude_plugin_cache_entries, ClaudeManifestRelativePathKind,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const RUNTIME_PLUGIN_AGENT_TYPES_PROMPT_MARKER: &str = "【Plugin Agent Types】";
const UNSUPPORTED_PLUGIN_AGENT_FIELDS: &[&str] =
    &["skills", "memory", "effort", "maxTurns", "max_turns"];
const UPSTREAM_IGNORED_PLUGIN_AGENT_FIELDS: &[&str] = &["permissionMode", "hooks", "mcpServers"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimePluginAgentDefinition {
    pub agent_type: String,
    pub when_to_use: String,
    pub system_prompt: String,
    pub model: Option<String>,
    pub background: bool,
    pub isolation: Option<String>,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub plugin_id: String,
    pub plugin_name: String,
    pub source_file: PathBuf,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct RuntimePluginAgentCatalog {
    agents: Vec<RuntimePluginAgentDefinition>,
    skipped: Vec<String>,
    skipped_agent_types: HashMap<String, String>,
    enabled_plugin_names: HashSet<String>,
}

#[derive(Debug, Clone)]
enum PluginAgentFileSpec {
    AutoDetectDefault,
    Explicit(Vec<PathBuf>),
}

pub(crate) fn merge_system_prompt_with_runtime_plugin_agents(
    base_prompt: Option<String>,
    workspace_root: &Path,
    home_dir: Option<&Path>,
) -> Option<String> {
    let runtime_prompt = build_runtime_plugin_agents_prompt_with_home(workspace_root, home_dir);
    match (base_prompt, runtime_prompt) {
        (Some(base), Some(runtime)) => {
            if base.contains(RUNTIME_PLUGIN_AGENT_TYPES_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(runtime)
            } else {
                Some(format!("{base}\n\n{runtime}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(runtime)) => Some(runtime),
        (None, None) => None,
    }
}

pub(crate) fn resolve_requested_runtime_plugin_agent_definition(
    requested_agent_type: Option<&str>,
    workspace_root: &Path,
    home_dir: Option<&Path>,
) -> Result<Option<RuntimePluginAgentDefinition>, String> {
    let requested_agent_type = requested_agent_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let Some(requested_agent_type) = requested_agent_type else {
        return Ok(None);
    };

    let catalog = load_runtime_plugin_agent_catalog_with_home(workspace_root, home_dir);
    if let Some(agent) = catalog
        .agents
        .iter()
        .find(|agent| agent.agent_type == requested_agent_type)
        .cloned()
    {
        return Ok(Some(agent));
    }

    if let Some(reason) = catalog.skipped_agent_types.get(&requested_agent_type) {
        return Err(format!(
            "plugin agent `{requested_agent_type}` 当前未加载: {reason}"
        ));
    }

    if let Some((plugin_name, _)) = requested_agent_type.split_once(':') {
        if catalog.enabled_plugin_names.contains(plugin_name) {
            return Err(format!(
                "plugin agent `{requested_agent_type}` 不存在于当前启用插件的 current registry 中"
            ));
        }
    }

    Ok(None)
}

fn build_runtime_plugin_agents_prompt_with_home(
    workspace_root: &Path,
    home_dir: Option<&Path>,
) -> Option<String> {
    let catalog = load_runtime_plugin_agent_catalog_with_home(workspace_root, home_dir);
    if !catalog.skipped.is_empty() {
        tracing::warn!(
            "[AsterAgent] plugin agents 部分跳过: {}",
            catalog.skipped.join(" | ")
        );
    }
    if catalog.agents.is_empty() {
        return None;
    }

    let rendered_agents = catalog
        .agents
        .iter()
        .map(render_runtime_plugin_agent_line)
        .collect::<Vec<_>>();

    Some(format!(
        "{RUNTIME_PLUGIN_AGENT_TYPES_PROMPT_MARKER}\n以下 agent types 来自当前 workspace 可见且已启用的 Claude plugin cache。只有下面这些类型会被当前 Lime runtime 当成真实 plugin agent definition 处理：\n{}",
        rendered_agents.join("\n")
    ))
}

fn load_runtime_plugin_agent_catalog_with_home(
    workspace_root: &Path,
    home_dir: Option<&Path>,
) -> RuntimePluginAgentCatalog {
    let resolution = resolve_claude_plugin_cache_entries(Some(workspace_root), home_dir);
    let mut catalog = RuntimePluginAgentCatalog {
        skipped: resolution.skipped,
        ..RuntimePluginAgentCatalog::default()
    };

    for plugin in resolution.plugins {
        catalog
            .enabled_plugin_names
            .insert(plugin.plugin_name.clone());
        load_plugin_agents_from_cached_root(
            &plugin.plugin_id,
            &plugin.plugin_name,
            &plugin.root,
            &mut catalog,
        );
    }

    catalog
        .agents
        .sort_by(|left, right| left.agent_type.cmp(&right.agent_type));
    catalog
}

fn load_plugin_agents_from_cached_root(
    plugin_id: &str,
    plugin_name: &str,
    plugin_root: &Path,
    catalog: &mut RuntimePluginAgentCatalog,
) {
    let (agent_files, plugin_skipped) = collect_plugin_agent_files_with_report(plugin_root);
    catalog.skipped.extend(
        plugin_skipped
            .into_iter()
            .map(|reason| format!("{plugin_id}: {reason}")),
    );

    let mut loaded_files = HashSet::<PathBuf>::new();
    for (agent_path, namespace) in agent_files {
        let normalized = agent_path
            .canonicalize()
            .unwrap_or_else(|_| agent_path.clone());
        if !loaded_files.insert(normalized) {
            continue;
        }

        match load_plugin_agent_from_file(
            plugin_id,
            plugin_name,
            plugin_root,
            &agent_path,
            &namespace,
        ) {
            Ok(agent) => catalog.agents.push(agent),
            Err((agent_type, reason)) => {
                if let Some(agent_type) = agent_type {
                    catalog
                        .skipped_agent_types
                        .entry(agent_type)
                        .or_insert_with(|| reason.clone());
                }
                catalog.skipped.push(format!("{plugin_id}: {reason}"));
            }
        }
    }
}

fn collect_plugin_agent_files_with_report(
    plugin_root: &Path,
) -> (Vec<(PathBuf, Vec<String>)>, Vec<String>) {
    let mut skipped = Vec::new();
    let file_spec = match resolve_plugin_agent_file_spec(plugin_root) {
        Ok(spec) => spec,
        Err(error) => return (Vec::new(), vec![error]),
    };

    let mut files = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();
    match file_spec {
        PluginAgentFileSpec::AutoDetectDefault => {
            let default_agents_path = plugin_root.join("agents");
            if default_agents_path.exists() {
                collect_markdown_files_with_namespace(
                    &default_agents_path,
                    &mut Vec::new(),
                    &mut files,
                    &mut seen,
                );
            }
        }
        PluginAgentFileSpec::Explicit(paths) => {
            for path in paths {
                if !path.exists() {
                    skipped.push(format!("manifest.agents 路径不存在 ({})", path.display()));
                    continue;
                }
                let normalized = path.canonicalize().unwrap_or_else(|_| path.clone());
                if seen.insert(normalized) {
                    files.push((path, Vec::new()));
                }
            }
        }
    }

    files.sort_by(|left, right| left.0.cmp(&right.0));
    (files, skipped)
}

fn resolve_plugin_agent_file_spec(plugin_root: &Path) -> Result<PluginAgentFileSpec, String> {
    let Some((_manifest_path, manifest)) = load_cached_plugin_manifest_json(plugin_root)? else {
        return Ok(PluginAgentFileSpec::AutoDetectDefault);
    };
    let Some(agents_value) = manifest.get("agents") else {
        return Ok(PluginAgentFileSpec::AutoDetectDefault);
    };

    Ok(PluginAgentFileSpec::Explicit(
        resolve_explicit_plugin_agent_files(plugin_root, agents_value)?,
    ))
}

fn resolve_explicit_plugin_agent_files(
    plugin_root: &Path,
    agents_value: &serde_json::Value,
) -> Result<Vec<PathBuf>, String> {
    match agents_value {
        serde_json::Value::String(relative_path) => Ok(vec![resolve_plugin_relative_agent_file(
            plugin_root,
            relative_path,
        )?]),
        serde_json::Value::Array(paths) => paths
            .iter()
            .map(|value| {
                let Some(relative_path) = value.as_str() else {
                    return Err("manifest.agents 只能是 string 或 string[]".to_string());
                };
                resolve_plugin_relative_agent_file(plugin_root, relative_path)
            })
            .collect(),
        _ => Err("manifest.agents 只能是 string 或 string[]".to_string()),
    }
}

fn resolve_plugin_relative_agent_file(
    plugin_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    resolve_claude_manifest_relative_path(
        plugin_root,
        relative_path,
        ClaudeManifestRelativePathKind::MarkdownFile,
    )
    .map_err(|error| format!("manifest.agents 路径无效（{}）：{}", relative_path, error))
}

fn collect_markdown_files_with_namespace(
    dir: &Path,
    namespace: &mut Vec<String>,
    files: &mut Vec<(PathBuf, Vec<String>)>,
    seen: &mut HashSet<PathBuf>,
) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    let mut entries = read_dir.flatten().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            namespace.push(name.to_string());
            collect_markdown_files_with_namespace(&path, namespace, files, seen);
            namespace.pop();
            continue;
        }
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
            continue;
        }

        let normalized = path.canonicalize().unwrap_or_else(|_| path.clone());
        if seen.insert(normalized) {
            files.push((path, namespace.clone()));
        }
    }
}

fn load_plugin_agent_from_file(
    plugin_id: &str,
    plugin_name: &str,
    plugin_root: &Path,
    agent_path: &Path,
    namespace: &[String],
) -> Result<RuntimePluginAgentDefinition, (Option<String>, String)> {
    let content = fs::read_to_string(agent_path).map_err(|error| {
        (
            None,
            format!(
                "读取 plugin agent 失败 ({}): {}",
                agent_path.display(),
                error
            ),
        )
    })?;
    let (frontmatter, body) = parse_plugin_agent_frontmatter(&content).map_err(|error| {
        (
            Some(build_plugin_agent_type(
                plugin_name,
                namespace,
                file_stem_or_unknown(agent_path),
            )),
            format!(
                "解析 plugin agent frontmatter 失败 ({}): {error}",
                agent_path.display()
            ),
        )
    })?;

    let base_name = frontmatter_string_value(&frontmatter, &["name"])
        .unwrap_or_else(|| file_stem_or_unknown(agent_path));
    let agent_type = build_plugin_agent_type(plugin_name, namespace, base_name.clone());

    let unsupported_fields = UNSUPPORTED_PLUGIN_AGENT_FIELDS
        .iter()
        .copied()
        .filter(|field| frontmatter_contains_key(&frontmatter, field))
        .collect::<Vec<_>>();
    if !unsupported_fields.is_empty() {
        return Err((
            Some(agent_type),
            format!(
                "plugin agent `{}` 包含当前 Lime runtime 还没有 honest host 的字段: {}",
                agent_path.display(),
                unsupported_fields.join(", ")
            ),
        ));
    }

    let model = parse_plugin_agent_model(&frontmatter).map_err(|error| {
        (
            Some(agent_type.clone()),
            format!(
                "plugin agent `{}` model 无效: {error}",
                agent_path.display()
            ),
        )
    })?;
    let background = parse_plugin_agent_background(&frontmatter);
    let isolation = parse_plugin_agent_isolation(&frontmatter);
    let allowed_tools = parse_plugin_agent_tool_list(&frontmatter, "tools").map_err(|error| {
        (
            Some(agent_type.clone()),
            format!(
                "plugin agent `{}` tools 无效: {error}",
                agent_path.display()
            ),
        )
    })?;
    let disallowed_tools =
        parse_plugin_agent_tool_list(&frontmatter, "disallowedTools").map_err(|error| {
            (
                Some(agent_type.clone()),
                format!(
                    "plugin agent `{}` disallowedTools 无效: {error}",
                    agent_path.display()
                ),
            )
        })?;

    let system_prompt = substitute_plugin_root_placeholder(body.trim(), plugin_root);
    if contains_unsupported_plugin_user_config_placeholder(&system_prompt) {
        return Err((
            Some(agent_type),
            format!(
                "plugin agent `{}` 使用了 `${{user_config.*}}` 占位符，但 Lime 当前没有对应宿主",
                agent_path.display()
            ),
        ));
    }

    let when_to_use =
        frontmatter_string_value(&frontmatter, &["description", "when-to-use", "when_to_use"])
            .unwrap_or_else(|| format!("Agent from {plugin_name} plugin"));

    for ignored_field in UPSTREAM_IGNORED_PLUGIN_AGENT_FIELDS {
        if frontmatter_contains_key(&frontmatter, ignored_field) {
            tracing::warn!(
                "[AsterAgent] plugin agent {} 设置了 `{}`；按 upstream 语义该字段会被忽略",
                agent_path.display(),
                ignored_field
            );
        }
    }

    Ok(RuntimePluginAgentDefinition {
        agent_type,
        when_to_use,
        system_prompt,
        model,
        background,
        isolation,
        allowed_tools,
        disallowed_tools,
        plugin_id: plugin_id.to_string(),
        plugin_name: plugin_name.to_string(),
        source_file: agent_path.to_path_buf(),
    })
}

fn parse_plugin_agent_frontmatter(content: &str) -> Result<(serde_yaml::Mapping, String), String> {
    let regex = regex::Regex::new(r"^---\s*\n([\s\S]*?)---\s*\n?")
        .map_err(|error| format!("frontmatter regex 初始化失败: {error}"))?;
    let Some(captures) = regex.captures(content) else {
        return Ok((serde_yaml::Mapping::new(), content.to_string()));
    };

    let yaml = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(yaml)
        .map_err(|error| format!("YAML 解析失败: {error}"))?;
    let mapping = parsed
        .as_mapping()
        .cloned()
        .ok_or_else(|| "frontmatter 顶层必须是 object".to_string())?;
    let body_start = captures.get(0).map(|m| m.end()).unwrap_or(0);
    let body = content.get(body_start..).unwrap_or_default().to_string();

    Ok((mapping, body))
}

fn frontmatter_contains_key(mapping: &serde_yaml::Mapping, key: &str) -> bool {
    mapping.contains_key(serde_yaml::Value::String(key.to_string()))
}

fn frontmatter_value<'a>(
    mapping: &'a serde_yaml::Mapping,
    keys: &[&str],
) -> Option<&'a serde_yaml::Value> {
    keys.iter()
        .find_map(|key| mapping.get(serde_yaml::Value::String((*key).to_string())))
}

fn frontmatter_string_value(mapping: &serde_yaml::Mapping, keys: &[&str]) -> Option<String> {
    frontmatter_value(mapping, keys)
        .and_then(serde_yaml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_plugin_agent_model(mapping: &serde_yaml::Mapping) -> Result<Option<String>, String> {
    let Some(value) = frontmatter_value(mapping, &["model"]) else {
        return Ok(None);
    };
    let Some(model) = value.as_str() else {
        return Err("必须是非空 string".to_string());
    };
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("inherit") {
        return Ok(None);
    }
    Ok(Some(trimmed.to_string()))
}

fn parse_plugin_agent_background(mapping: &serde_yaml::Mapping) -> bool {
    match frontmatter_value(mapping, &["background"]) {
        Some(serde_yaml::Value::Bool(true)) => true,
        Some(serde_yaml::Value::String(value)) => value.trim() == "true",
        _ => false,
    }
}

fn parse_plugin_agent_isolation(mapping: &serde_yaml::Mapping) -> Option<String> {
    match frontmatter_value(mapping, &["isolation"]) {
        Some(serde_yaml::Value::String(value)) if value.trim() == "worktree" => {
            Some("worktree".to_string())
        }
        _ => None,
    }
}

fn parse_plugin_agent_tool_list(
    mapping: &serde_yaml::Mapping,
    field_name: &str,
) -> Result<Vec<String>, String> {
    let Some(value) = frontmatter_value(mapping, &[field_name]) else {
        return Ok(Vec::new());
    };

    let values = match value {
        serde_yaml::Value::String(text) => text
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>(),
        serde_yaml::Value::Sequence(items) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .ok_or_else(|| format!("字段 `{field_name}` 必须是 string 或 string[]"))
            })
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(format!("字段 `{field_name}` 必须是 string 或 string[]"));
        }
    };

    Ok(normalize_unique_strings(values))
}

fn normalize_unique_strings(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    normalized
}

fn substitute_plugin_root_placeholder(body: &str, plugin_root: &Path) -> String {
    body.replace(
        "${CLAUDE_PLUGIN_ROOT}",
        plugin_root.to_string_lossy().as_ref(),
    )
}

fn contains_unsupported_plugin_user_config_placeholder(body: &str) -> bool {
    body.contains("${user_config.")
}

fn file_stem_or_unknown(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

fn build_plugin_agent_type(plugin_name: &str, namespace: &[String], base_name: String) -> String {
    let mut parts = Vec::with_capacity(namespace.len() + 2);
    parts.push(plugin_name.to_string());
    parts.extend(namespace.iter().cloned());
    parts.push(base_name);
    parts.join(":")
}

fn render_runtime_plugin_agent_line(agent: &RuntimePluginAgentDefinition) -> String {
    format!(
        "- {}: {} (Tools: {})",
        agent.agent_type,
        agent.when_to_use,
        render_runtime_plugin_agent_tools(agent)
    )
}

fn render_runtime_plugin_agent_tools(agent: &RuntimePluginAgentDefinition) -> String {
    let has_allowlist = !agent.allowed_tools.is_empty();
    let has_denylist = !agent.disallowed_tools.is_empty();
    if has_allowlist && has_denylist {
        let deny_set = agent.disallowed_tools.iter().collect::<HashSet<_>>();
        let effective = agent
            .allowed_tools
            .iter()
            .filter(|tool| !deny_set.contains(*tool))
            .cloned()
            .collect::<Vec<_>>();
        return if effective.is_empty() {
            "None".to_string()
        } else {
            effective.join(", ")
        };
    }
    if has_allowlist {
        return agent.allowed_tools.join(", ");
    }
    if has_denylist {
        return format!("All tools except {}", agent.disallowed_tools.join(", "));
    }
    "All tools".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_enabled_plugin_settings(home_root: &Path, plugin_id: &str) {
        let settings_dir = home_root.join(".claude");
        std::fs::create_dir_all(&settings_dir).expect("创建 settings 目录失败");
        std::fs::write(
            settings_dir.join("settings.json"),
            serde_json::json!({
                "enabledPlugins": {
                    plugin_id: true
                }
            })
            .to_string(),
        )
        .expect("写入 enabledPlugins 失败");
    }

    fn write_cached_plugin(
        home_root: &Path,
        marketplace: &str,
        plugin_name: &str,
        manifest: serde_json::Value,
        agent_files: &[(&str, &str)],
    ) -> PathBuf {
        let plugin_root = home_root
            .join(".claude")
            .join("plugins")
            .join("cache")
            .join(marketplace)
            .join(plugin_name)
            .join("0.0.1");
        std::fs::create_dir_all(plugin_root.join(".claude-plugin"))
            .expect("创建 plugin manifest 目录失败");
        std::fs::write(
            plugin_root.join(".claude-plugin").join("plugin.json"),
            serde_json::to_string(&manifest).expect("manifest json"),
        )
        .expect("写入 plugin manifest 失败");

        for (relative_path, content) in agent_files {
            let target = plugin_root.join(relative_path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).expect("创建 agent 目录失败");
            }
            std::fs::write(target, content).expect("写入 agent 文件失败");
        }

        plugin_root
    }

    #[test]
    fn load_runtime_plugin_agent_catalog_should_load_supported_agents_and_skip_unsupported_fields()
    {
        let temp_home = TempDir::new().expect("创建 home tempdir 失败");
        let temp_workspace = TempDir::new().expect("创建 workspace tempdir 失败");
        let plugin_id = "research-kit@market";
        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "market",
            "research-kit",
            serde_json::json!({ "name": "research-kit" }),
            &[
                (
                    "agents/reviewer.md",
                    r#"---
description: 审查当前实现
background: true
isolation: worktree
tools:
  - Read
  - Bash
disallowedTools:
  - WebSearch
model: gpt-5.4
---
你是插件里的 reviewer agent。
"#,
                ),
                (
                    "agents/unsupported.md",
                    r#"---
description: 需要 memory
memory: project
---
This one should be skipped.
"#,
                ),
            ],
        );

        let catalog = load_runtime_plugin_agent_catalog_with_home(
            temp_workspace.path(),
            Some(temp_home.path()),
        );

        assert_eq!(catalog.agents.len(), 1);
        assert_eq!(catalog.agents[0].agent_type, "research-kit:reviewer");
        assert_eq!(catalog.agents[0].model.as_deref(), Some("gpt-5.4"));
        assert!(catalog.agents[0].background);
        assert_eq!(catalog.agents[0].isolation.as_deref(), Some("worktree"));
        assert_eq!(catalog.agents[0].allowed_tools, vec!["Read", "Bash"]);
        assert_eq!(catalog.agents[0].disallowed_tools, vec!["WebSearch"]);
        assert!(catalog
            .skipped_agent_types
            .contains_key("research-kit:unsupported"));
    }

    #[test]
    fn resolve_requested_runtime_plugin_agent_definition_should_fail_closed_for_skipped_agent() {
        let temp_home = TempDir::new().expect("创建 home tempdir 失败");
        let temp_workspace = TempDir::new().expect("创建 workspace tempdir 失败");
        let plugin_id = "research-kit@market";
        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "market",
            "research-kit",
            serde_json::json!({ "name": "research-kit" }),
            &[(
                "agents/reviewer.md",
                r#"---
description: 需要 skill names
skills:
  - planner
---
This one should be skipped.
"#,
            )],
        );

        let error = resolve_requested_runtime_plugin_agent_definition(
            Some("research-kit:reviewer"),
            temp_workspace.path(),
            Some(temp_home.path()),
        )
        .expect_err("unsupported plugin agent should fail closed");

        assert!(error.contains("未加载"));
        assert!(error.contains("skills"));
    }

    #[test]
    fn merge_system_prompt_with_runtime_plugin_agents_should_render_available_agent_types() {
        let temp_home = TempDir::new().expect("创建 home tempdir 失败");
        let temp_workspace = TempDir::new().expect("创建 workspace tempdir 失败");
        let plugin_id = "research-kit@market";
        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "market",
            "research-kit",
            serde_json::json!({ "name": "research-kit" }),
            &[(
                "agents/reviewer.md",
                r#"---
description: 审查当前实现
tools:
  - Read
---
你是插件里的 reviewer agent。
"#,
            )],
        );
        let merged = merge_system_prompt_with_runtime_plugin_agents(
            Some("base prompt".to_string()),
            temp_workspace.path(),
            Some(temp_home.path()),
        )
        .expect("merged prompt should exist");

        assert!(merged.contains(RUNTIME_PLUGIN_AGENT_TYPES_PROMPT_MARKER));
        assert!(merged.contains("research-kit:reviewer"));
        assert!(merged.contains("Tools: Read"));
    }

    #[test]
    fn load_plugin_agent_from_file_should_substitute_plugin_root_placeholder() {
        let temp_plugin = TempDir::new().expect("创建 plugin tempdir 失败");
        let agent_path = temp_plugin.path().join("agents").join("reviewer.md");
        std::fs::create_dir_all(agent_path.parent().expect("agent parent"))
            .expect("创建 agent 目录失败");
        std::fs::write(
            &agent_path,
            r#"---
description: rooted
---
Root is ${CLAUDE_PLUGIN_ROOT}
"#,
        )
        .expect("写入 agent 文件失败");

        let agent = load_plugin_agent_from_file(
            "research-kit@market",
            "research-kit",
            temp_plugin.path(),
            &agent_path,
            &[],
        )
        .expect("agent should load");

        assert!(agent
            .system_prompt
            .contains(temp_plugin.path().to_string_lossy().as_ref()));
    }
}
