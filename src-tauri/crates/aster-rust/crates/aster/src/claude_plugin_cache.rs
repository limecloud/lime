use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudePluginCacheEntry {
    pub plugin_id: String,
    pub plugin_name: String,
    pub marketplace: String,
    pub root: PathBuf,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ClaudePluginCacheResolution {
    pub plugins: Vec<ClaudePluginCacheEntry>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EnabledClaudePluginsResolution {
    pub plugin_ids: BTreeSet<String>,
    pub skipped: Vec<String>,
}

pub fn resolve_enabled_claude_plugin_ids(
    workspace_root: Option<&Path>,
    home_dir: Option<&Path>,
) -> EnabledClaudePluginsResolution {
    let Some(home_dir) = home_dir else {
        return EnabledClaudePluginsResolution::default();
    };

    let mut merged = BTreeMap::<String, bool>::new();
    let mut skipped = Vec::new();
    let mut settings_paths = vec![
        home_dir.join(".claude").join("settings.json"),
        home_dir.join(".claude").join("settings.local.json"),
    ];

    if let Some(workspace_root) = workspace_root {
        settings_paths.push(workspace_root.join(".claude").join("settings.json"));
        settings_paths.push(workspace_root.join(".claude").join("settings.local.json"));
    }

    for path in settings_paths {
        merge_enabled_plugins_from_settings(&path, &mut merged, &mut skipped);
    }

    EnabledClaudePluginsResolution {
        plugin_ids: merged
            .into_iter()
            .filter_map(|(plugin_id, enabled)| enabled.then_some(plugin_id))
            .collect(),
        skipped,
    }
}

pub fn resolve_claude_plugin_cache_entries(
    workspace_root: Option<&Path>,
    home_dir: Option<&Path>,
) -> ClaudePluginCacheResolution {
    let Some(home_dir) = home_dir else {
        return ClaudePluginCacheResolution::default();
    };

    let enabled_plugins = resolve_enabled_claude_plugin_ids(workspace_root, Some(home_dir));
    let mut resolution = ClaudePluginCacheResolution {
        plugins: Vec::new(),
        skipped: enabled_plugins.skipped,
    };
    if let Some(reason) = detect_managed_plugin_policy_gap(home_dir) {
        resolution.skipped.push(reason);
    }

    for plugin_id in enabled_plugins.plugin_ids {
        let parsed = match parse_cached_plugin_id(&plugin_id) {
            Ok(parsed) => parsed,
            Err(reason) => {
                resolution.skipped.push(format!("{plugin_id}: {reason}"));
                continue;
            }
        };

        let versioned_plugin_cache_dir = home_dir
            .join(".claude")
            .join("plugins")
            .join("cache")
            .join(sanitize_plugin_cache_path_component(&parsed.marketplace))
            .join(sanitize_plugin_cache_path_component(&parsed.plugin_name));
        let legacy_plugin_cache_dir = home_dir
            .join(".claude")
            .join("plugins")
            .join("cache")
            .join(sanitize_plugin_cache_path_component(&parsed.plugin_name));

        let Some(root) =
            resolve_cached_plugin_root(&versioned_plugin_cache_dir, &legacy_plugin_cache_dir)
        else {
            resolution.skipped.push(format!(
                "{plugin_id}: 未找到可用插件缓存目录（versioned/legacy 均缺失）"
            ));
            continue;
        };

        resolution.plugins.push(ClaudePluginCacheEntry {
            plugin_id,
            plugin_name: parsed.plugin_name,
            marketplace: parsed.marketplace,
            root,
        });
    }

    resolution.plugins.sort_by(|left, right| {
        left.plugin_id
            .cmp(&right.plugin_id)
            .then_with(|| left.root.cmp(&right.root))
    });
    resolution
}

pub fn resolve_cached_plugin_manifest_path(plugin_root: &Path) -> Option<PathBuf> {
    let primary_manifest_path = plugin_root.join(".claude-plugin").join("plugin.json");
    if primary_manifest_path.exists() {
        return Some(primary_manifest_path);
    }

    let legacy_manifest_path = plugin_root.join("plugin.json");
    legacy_manifest_path
        .exists()
        .then_some(legacy_manifest_path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeManifestRelativePathKind {
    Any,
    JsonFile,
}

pub fn load_cached_plugin_manifest_json(
    plugin_root: &Path,
) -> Result<Option<(PathBuf, serde_json::Value)>, String> {
    let Some(manifest_path) = resolve_cached_plugin_manifest_path(plugin_root) else {
        return Ok(None);
    };
    let content = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "plugin manifest 读取失败 ({}): {}",
            manifest_path.display(),
            error
        )
    })?;
    let manifest = serde_json::from_str::<serde_json::Value>(&content).map_err(|error| {
        format!(
            "plugin manifest 解析失败 ({}): {}",
            manifest_path.display(),
            error
        )
    })?;

    if !manifest.is_object() {
        return Err(format!(
            "plugin manifest 必须是 JSON object ({})",
            manifest_path.display()
        ));
    }

    Ok(Some((manifest_path, manifest)))
}

pub fn validate_claude_manifest_relative_path(
    relative_path: &str,
    kind: ClaudeManifestRelativePathKind,
) -> Result<&str, String> {
    if relative_path.is_empty() {
        return Err("路径不能为空".to_string());
    }

    if !relative_path.starts_with("./") {
        return Err("路径必须以 ./ 开头".to_string());
    }

    if matches!(kind, ClaudeManifestRelativePathKind::JsonFile) && !relative_path.ends_with(".json")
    {
        return Err("路径必须指向 .json 文件".to_string());
    }

    Ok(relative_path)
}

pub fn resolve_claude_manifest_relative_path(
    plugin_root: &Path,
    relative_path: &str,
    kind: ClaudeManifestRelativePathKind,
) -> Result<PathBuf, String> {
    let relative_path = validate_claude_manifest_relative_path(relative_path, kind)?;
    Ok(plugin_root.join(relative_path))
}

const MANAGED_PLUGIN_POLICY_KEYS: &[&str] = &[
    "enabledPlugins",
    "extraKnownMarketplaces",
    "strictKnownMarketplaces",
    "blockedMarketplaces",
];

fn build_builtin_plugin_unsupported_reason() -> String {
    "@builtin 当前缺少独立的 builtin plugin registry/current 宿主，不能回退为 marketplace cache plugin 或其他 builtin surface".to_string()
}

fn merge_enabled_plugins_from_settings(
    path: &Path,
    merged: &mut BTreeMap<String, bool>,
    skipped: &mut Vec<String>,
) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) else {
        skipped.push(format!("{}: enabledPlugins 配置解析失败", path.display()));
        return;
    };
    let Some(enabled_plugins) = settings
        .get("enabledPlugins")
        .and_then(serde_json::Value::as_object)
    else {
        return;
    };

    for (plugin_id, enabled) in enabled_plugins {
        if let Some(enabled) = enabled.as_bool() {
            merged.insert(plugin_id.clone(), enabled);
        }
    }
}

fn detect_managed_plugin_policy_gap(home_dir: &Path) -> Option<String> {
    let policy_paths = [
        home_dir.join(".aster").join("managed_settings.yaml"),
        home_dir.join(".aster").join("policy.yaml"),
    ];

    for path in policy_paths {
        let Some(keys) = extract_managed_plugin_policy_keys(&path) else {
            continue;
        };
        if keys.is_empty() {
            continue;
        }
        let key_list = keys.into_iter().collect::<Vec<_>>().join(", ");
        return Some(format!(
            "{}: 检测到 Claude 风格 managed plugin policy keys [{}]，但当前 runtime 尚未接入 policySettings/plugin loader current 宿主，已忽略",
            path.display(),
            key_list
        ));
    }

    None
}

fn extract_managed_plugin_policy_keys(path: &Path) -> Option<BTreeSet<&'static str>> {
    let content = fs::read_to_string(path).ok()?;
    let parsed = serde_yaml::from_str::<serde_yaml::Value>(&content).ok()?;
    let root = parsed.as_mapping()?;
    let mut keys = BTreeSet::new();

    collect_managed_plugin_policy_keys(root, &mut keys);
    for scope_key in ["defaults", "enforced"] {
        let Some(scope_value) = root.get(serde_yaml::Value::String(scope_key.to_string())) else {
            continue;
        };
        let Some(scope_map) = scope_value.as_mapping() else {
            continue;
        };
        collect_managed_plugin_policy_keys(scope_map, &mut keys);
    }

    Some(keys)
}

fn collect_managed_plugin_policy_keys(
    mapping: &serde_yaml::Mapping,
    keys: &mut BTreeSet<&'static str>,
) {
    for candidate in MANAGED_PLUGIN_POLICY_KEYS {
        if mapping.contains_key(serde_yaml::Value::String((*candidate).to_string())) {
            keys.insert(*candidate);
        }
    }
}

struct ParsedPluginId {
    plugin_name: String,
    marketplace: String,
}

fn parse_cached_plugin_id(plugin_id: &str) -> Result<ParsedPluginId, String> {
    let Some((plugin_name, marketplace)) = plugin_id.rsplit_once('@') else {
        return Err("不是 plugin@marketplace current 插件标识".to_string());
    };

    let plugin_name = plugin_name.trim();
    let marketplace = marketplace.trim();

    if plugin_name.is_empty() || marketplace.is_empty() {
        return Err("不是 plugin@marketplace current 插件标识".to_string());
    }

    if marketplace.eq_ignore_ascii_case("builtin") {
        return Err(build_builtin_plugin_unsupported_reason());
    }

    Ok(ParsedPluginId {
        plugin_name: plugin_name.to_string(),
        marketplace: marketplace.to_string(),
    })
}

fn sanitize_plugin_cache_path_component(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn resolve_cached_plugin_root(
    versioned_plugin_cache_dir: &Path,
    legacy_plugin_cache_dir: &Path,
) -> Option<PathBuf> {
    if let Some(root) = resolve_latest_versioned_plugin_root(versioned_plugin_cache_dir) {
        return Some(root);
    }

    legacy_plugin_cache_dir
        .is_dir()
        .then_some(legacy_plugin_cache_dir.to_path_buf())
}

fn resolve_latest_versioned_plugin_root(plugin_cache_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(plugin_cache_dir).ok()?;
    let mut candidates = entries
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| compare_cached_plugin_version_dirs(left, right));
    candidates.into_iter().next()
}

fn compare_cached_plugin_version_dirs(left: &Path, right: &Path) -> std::cmp::Ordering {
    let left_name = left
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let right_name = right
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    match (
        parse_cached_plugin_version(left_name),
        parse_cached_plugin_version(right_name),
    ) {
        (Some(left_version), Some(right_version)) => right_version
            .cmp(&left_version)
            .then_with(|| right_name.cmp(left_name)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => right_name.cmp(left_name),
    }
}

fn parse_cached_plugin_version(value: &str) -> Option<(u64, u64, u64)> {
    let normalized = value.trim().trim_start_matches('v');
    let normalized = normalized.split('-').next().unwrap_or(normalized);
    let mut parts = normalized.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_enabled_plugin_settings(
        root: &Path,
        file_name: &str,
        enabled_plugins: serde_json::Value,
    ) {
        let claude_dir = root.join(".claude");
        fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");
        fs::write(
            claude_dir.join(file_name),
            serde_json::to_string_pretty(&serde_json::json!({
                "enabledPlugins": enabled_plugins
            }))
            .expect("序列化 enabledPlugins 失败"),
        )
        .expect("写入 enabledPlugins 配置失败");
    }

    fn write_cached_plugin(home_root: &Path, plugin_name: &str, marketplace: &str, version: &str) {
        fs::create_dir_all(
            home_root
                .join(".claude")
                .join("plugins")
                .join("cache")
                .join(marketplace)
                .join(plugin_name)
                .join(version),
        )
        .expect("创建 plugin cache 目录失败");
    }

    fn write_legacy_cached_plugin(home_root: &Path, plugin_name: &str) {
        fs::create_dir_all(
            home_root
                .join(".claude")
                .join("plugins")
                .join("cache")
                .join(plugin_name),
        )
        .expect("创建 legacy plugin cache 目录失败");
    }

    fn write_aster_managed_settings(home_root: &Path, content: &str) {
        let aster_dir = home_root.join(".aster");
        fs::create_dir_all(&aster_dir).expect("创建 .aster 目录失败");
        fs::write(aster_dir.join("managed_settings.yaml"), content)
            .expect("写入 managed_settings.yaml 失败");
    }

    #[test]
    fn resolve_enabled_claude_plugin_ids_should_merge_home_workspace_and_local_settings() {
        let home = TempDir::new().expect("create temp home");
        let workspace = TempDir::new().expect("create temp workspace");

        write_enabled_plugin_settings(
            home.path(),
            "settings.json",
            serde_json::json!({
                "alpha@demo-market": true,
                "beta@demo-market": false
            }),
        );
        write_enabled_plugin_settings(
            home.path(),
            "settings.local.json",
            serde_json::json!({
                "beta@demo-market": true
            }),
        );
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.json",
            serde_json::json!({
                "alpha@demo-market": false
            }),
        );
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.local.json",
            serde_json::json!({
                "gamma@demo-market": true
            }),
        );

        let resolution =
            resolve_enabled_claude_plugin_ids(Some(workspace.path()), Some(home.path()));

        assert_eq!(
            resolution.plugin_ids,
            BTreeSet::from([
                "beta@demo-market".to_string(),
                "gamma@demo-market".to_string()
            ])
        );
        assert!(resolution.skipped.is_empty());
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_choose_latest_version_directory() {
        let home = TempDir::new().expect("create temp home");
        let workspace = TempDir::new().expect("create temp workspace");
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.local.json",
            serde_json::json!({
                "ranker@demo-market": true
            }),
        );

        write_cached_plugin(home.path(), "ranker", "demo-market", "v1.2.0");
        write_cached_plugin(home.path(), "ranker", "demo-market", "v1.10.0");
        write_cached_plugin(home.path(), "ranker", "demo-market", "latest");

        let resolution =
            resolve_claude_plugin_cache_entries(Some(workspace.path()), Some(home.path()));

        assert_eq!(resolution.plugins.len(), 1);
        assert_eq!(resolution.plugins[0].plugin_id, "ranker@demo-market");
        assert_eq!(
            resolution.plugins[0]
                .root
                .file_name()
                .and_then(|value| value.to_str()),
            Some("v1.10.0")
        );
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_fallback_to_legacy_cache_directory() {
        let home = TempDir::new().expect("create temp home");
        let workspace = TempDir::new().expect("create temp workspace");
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.local.json",
            serde_json::json!({
                "ranker@demo-market": true
            }),
        );

        write_legacy_cached_plugin(home.path(), "ranker");

        let resolution =
            resolve_claude_plugin_cache_entries(Some(workspace.path()), Some(home.path()));

        assert_eq!(resolution.plugins.len(), 1);
        assert_eq!(resolution.plugins[0].plugin_id, "ranker@demo-market");
        assert_eq!(
            resolution.plugins[0].root,
            home.path()
                .join(".claude")
                .join("plugins")
                .join("cache")
                .join("ranker")
        );
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_prefer_versioned_directory_over_legacy_cache() {
        let home = TempDir::new().expect("create temp home");
        let workspace = TempDir::new().expect("create temp workspace");
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.local.json",
            serde_json::json!({
                "ranker@demo-market": true
            }),
        );

        write_cached_plugin(home.path(), "ranker", "demo-market", "v1.10.0");
        write_legacy_cached_plugin(home.path(), "ranker");

        let resolution =
            resolve_claude_plugin_cache_entries(Some(workspace.path()), Some(home.path()));

        assert_eq!(resolution.plugins.len(), 1);
        assert_eq!(resolution.plugins[0].plugin_id, "ranker@demo-market");
        assert_eq!(
            resolution.plugins[0].root,
            home.path()
                .join(".claude")
                .join("plugins")
                .join("cache")
                .join("demo-market")
                .join("ranker")
                .join("v1.10.0")
        );
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_use_sanitized_cache_path_components() {
        let home = TempDir::new().expect("create temp home");
        let workspace = TempDir::new().expect("create temp workspace");
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.local.json",
            serde_json::json!({
                "@scope/ranker@demo.market": true
            }),
        );

        write_cached_plugin(home.path(), "-scope-ranker", "demo-market", "v1.2.3");

        let resolution =
            resolve_claude_plugin_cache_entries(Some(workspace.path()), Some(home.path()));

        assert_eq!(resolution.plugins.len(), 1);
        assert_eq!(resolution.plugins[0].plugin_id, "@scope/ranker@demo.market");
        assert_eq!(
            resolution.plugins[0].root,
            home.path()
                .join(".claude")
                .join("plugins")
                .join("cache")
                .join("demo-market")
                .join("-scope-ranker")
                .join("v1.2.3")
        );
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_mark_builtin_as_gap() {
        let home = TempDir::new().expect("create temp home");
        let workspace = TempDir::new().expect("create temp workspace");
        write_enabled_plugin_settings(
            workspace.path(),
            "settings.local.json",
            serde_json::json!({
                "capture@builtin": true
            }),
        );

        let resolution =
            resolve_claude_plugin_cache_entries(Some(workspace.path()), Some(home.path()));

        assert!(resolution.plugins.is_empty());
        assert_eq!(resolution.skipped.len(), 1);
        assert!(resolution.skipped[0].contains("capture@builtin"));
        assert!(resolution.skipped[0].contains("builtin plugin registry"));
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_mark_managed_plugin_policy_as_gap() {
        let home = TempDir::new().expect("create temp home");
        write_aster_managed_settings(
            home.path(),
            r#"
defaults:
  enabledPlugins:
    capture@claude-code-marketplace: true
enforced:
  strictKnownMarketplaces:
    - claude-code-marketplace
"#,
        );

        let resolution = resolve_claude_plugin_cache_entries(None, Some(home.path()));

        assert!(resolution.plugins.is_empty());
        assert_eq!(resolution.skipped.len(), 1);
        assert!(resolution.skipped[0].contains("managed_settings.yaml"));
        assert!(resolution.skipped[0].contains("enabledPlugins"));
        assert!(resolution.skipped[0].contains("strictKnownMarketplaces"));
        assert!(resolution.skipped[0].contains("current 宿主"));
    }

    #[test]
    fn resolve_claude_plugin_cache_entries_should_ignore_unrelated_managed_settings() {
        let home = TempDir::new().expect("create temp home");
        write_aster_managed_settings(
            home.path(),
            r#"
disabled_features:
  - browser
allowed_tools:
  - Read
"#,
        );

        let resolution = resolve_claude_plugin_cache_entries(None, Some(home.path()));

        assert!(resolution.plugins.is_empty());
        assert!(resolution.skipped.is_empty());
    }

    #[test]
    fn load_cached_plugin_manifest_json_should_reject_non_object_manifest() {
        let root = TempDir::new().expect("create temp root");
        let plugin_root = root.path().join("plugin-root");
        fs::create_dir_all(plugin_root.join(".claude-plugin")).expect("创建 manifest 目录失败");
        fs::write(
            plugin_root.join(".claude-plugin").join("plugin.json"),
            "\"not-an-object\"",
        )
        .expect("写入 manifest 失败");

        let error =
            load_cached_plugin_manifest_json(&plugin_root).expect_err("非 object manifest 应报错");
        assert!(error.contains("plugin manifest 必须是 JSON object"));
    }

    #[test]
    fn validate_claude_manifest_relative_path_should_require_dot_slash_and_json_suffix() {
        assert_eq!(
            validate_claude_manifest_relative_path(
                "./skills/writer",
                ClaudeManifestRelativePathKind::Any,
            )
            .expect("应接受 Claude 风格相对路径"),
            "./skills/writer"
        );
        assert!(
            validate_claude_manifest_relative_path(
                "skills/writer",
                ClaudeManifestRelativePathKind::Any,
            )
            .is_err(),
            "缺少 ./ 前缀应被拒绝"
        );
        assert!(
            validate_claude_manifest_relative_path(
                "./hooks/extra-hooks",
                ClaudeManifestRelativePathKind::JsonFile,
            )
            .is_err(),
            "hooks 路径必须指向 json 文件"
        );
    }
}
