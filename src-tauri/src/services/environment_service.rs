use proxycast_core::config::{Config, EnvironmentVariableOverride, WebSearchProvider};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

const CONFIGURED_NAMESPACE: &str = "configured_environment";
const WEB_SEARCH_NAMESPACE: &str = "web_search_runtime";
const MAX_SHELL_IMPORT_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_PREVIEW_KEYS: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "COMSPEC",
    "TMPDIR",
    "TMP",
    "TEMP",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
];
const DERIVED_PREVIEW_KEYS: &[&str] = &[
    "WEB_SEARCH_PROVIDER",
    "WEB_SEARCH_PROVIDER_PRIORITY",
    "TAVILY_API_KEY",
    "BING_SEARCH_API_KEY",
    "GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID",
];

static APPLIED_ENV_REGISTRY: OnceLock<Mutex<HashMap<String, BTreeSet<String>>>> = OnceLock::new();
static BASELINE_ENV_REGISTRY: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellImportPreview {
    pub enabled: bool,
    pub status: String,
    pub message: String,
    pub imported_count: usize,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPreviewEntry {
    pub key: String,
    pub value: String,
    pub masked_value: String,
    pub source: String,
    pub source_label: String,
    pub sensitive: bool,
    #[serde(default)]
    pub overridden_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPreview {
    pub shell_import: ShellImportPreview,
    pub entries: Vec<EnvironmentPreviewEntry>,
}

#[derive(Debug, Clone)]
struct ShellImportResult {
    env: BTreeMap<String, String>,
    preview: ShellImportPreview,
}

#[derive(Debug, Clone)]
struct EffectiveEnvironmentResolution {
    env: BTreeMap<String, String>,
    shell_import: ShellImportPreview,
    sources: HashMap<String, String>,
    overridden_sources: HashMap<String, Vec<String>>,
}

fn managed_registry() -> &'static Mutex<HashMap<String, BTreeSet<String>>> {
    APPLIED_ENV_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn baseline_registry() -> &'static Mutex<HashMap<String, Option<String>>> {
    BASELINE_ENV_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn is_sensitive_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    upper.contains("KEY")
        || upper.contains("TOKEN")
        || upper.contains("SECRET")
        || upper.contains("PASSWORD")
        || upper.contains("AUTH")
}

fn mask_value(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 {
        return "••••••".to_string();
    }

    let prefix: String = chars.iter().take(3).collect();
    let suffix: String = chars
        .iter()
        .skip(chars.len().saturating_sub(2))
        .copied()
        .collect();
    format!("{prefix}••••••{suffix}")
}

fn normalize_override_entry(entry: &EnvironmentVariableOverride) -> Option<(String, String)> {
    if !entry.enabled {
        return None;
    }

    let key = entry.key.trim();
    if !is_valid_env_key(key) {
        return None;
    }

    Some((key.to_string(), entry.value.clone()))
}

pub fn collect_configured_override_env(config: &Config) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for entry in &config.environment.variables {
        if let Some((key, value)) = normalize_override_entry(entry) {
            env.insert(key, value);
        }
    }
    env
}

pub fn build_web_search_runtime_env(config: &Config) -> BTreeMap<String, String> {
    let web_search = &config.web_search;
    let mut env = BTreeMap::new();

    env.insert(
        "WEB_SEARCH_PROVIDER".to_string(),
        match web_search.provider {
            WebSearchProvider::Tavily => "tavily",
            WebSearchProvider::MultiSearchEngine => "multi_search_engine",
            WebSearchProvider::DuckduckgoInstant => "duckduckgo_instant",
            WebSearchProvider::BingSearchApi => "bing_search_api",
            WebSearchProvider::GoogleCustomSearch => "google_custom_search",
        }
        .to_string(),
    );

    let mut provider_priority = Vec::new();
    let mut push_unique = |value: &str| {
        if !provider_priority.iter().any(|current| current == value) {
            provider_priority.push(value.to_string());
        }
    };

    push_unique(env["WEB_SEARCH_PROVIDER"].as_str());
    for provider in &web_search.provider_priority {
        push_unique(match provider {
            WebSearchProvider::Tavily => "tavily",
            WebSearchProvider::MultiSearchEngine => "multi_search_engine",
            WebSearchProvider::DuckduckgoInstant => "duckduckgo_instant",
            WebSearchProvider::BingSearchApi => "bing_search_api",
            WebSearchProvider::GoogleCustomSearch => "google_custom_search",
        });
    }
    for provider in [
        "tavily",
        "multi_search_engine",
        "bing_search_api",
        "google_custom_search",
        "duckduckgo_instant",
    ] {
        push_unique(provider);
    }
    env.insert(
        "WEB_SEARCH_PROVIDER_PRIORITY".to_string(),
        provider_priority.join(","),
    );

    let insert_trimmed =
        |target: &mut BTreeMap<String, String>, key: &str, value: &Option<String>| {
            if let Some(trimmed) = value
                .as_ref()
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
            {
                target.insert(key.to_string(), trimmed.to_string());
            }
        };

    insert_trimmed(&mut env, "TAVILY_API_KEY", &web_search.tavily_api_key);
    insert_trimmed(
        &mut env,
        "BING_SEARCH_API_KEY",
        &web_search.bing_search_api_key,
    );
    insert_trimmed(
        &mut env,
        "GOOGLE_SEARCH_API_KEY",
        &web_search.google_search_api_key,
    );
    insert_trimmed(
        &mut env,
        "GOOGLE_SEARCH_ENGINE_ID",
        &web_search.google_search_engine_id,
    );

    let engines = web_search
        .multi_search
        .engines
        .iter()
        .filter_map(|entry| {
            let name = entry.name.trim();
            let template = entry.url_template.trim();
            if name.is_empty() || template.is_empty() || !template.contains("{query}") {
                return None;
            }
            Some(serde_json::json!({
                "name": name,
                "url_template": template,
                "enabled": entry.enabled,
            }))
        })
        .collect::<Vec<_>>();

    let valid_engine_names: std::collections::HashSet<String> = engines
        .iter()
        .filter_map(|engine| engine.get("name").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .collect();

    let multi_search_priority = if web_search.multi_search.priority.is_empty() {
        valid_engine_names.iter().cloned().collect::<Vec<_>>()
    } else {
        web_search
            .multi_search
            .priority
            .iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty() && valid_engine_names.contains(name))
            .collect::<Vec<_>>()
    };

    let multi_search_config = serde_json::json!({
        "priority": multi_search_priority,
        "engines": engines,
        "max_results_per_engine": web_search.multi_search.max_results_per_engine,
        "max_total_results": web_search.multi_search.max_total_results,
        "timeout_ms": web_search.multi_search.timeout_ms,
    });

    if let Ok(raw) = serde_json::to_string(&multi_search_config) {
        env.insert("MULTI_SEARCH_ENGINE_CONFIG_JSON".to_string(), raw);
    }

    env
}

fn upsert_source(
    sources: &mut HashMap<String, String>,
    overridden_sources: &mut HashMap<String, Vec<String>>,
    key: &str,
    source: &str,
) {
    if let Some(previous) = sources.insert(key.to_string(), source.to_string()) {
        overridden_sources
            .entry(key.to_string())
            .or_default()
            .push(previous);
    }
}

async fn import_shell_environment(config: &Config) -> ShellImportResult {
    if !config.environment.shell_import.enabled {
        return ShellImportResult {
            env: BTreeMap::new(),
            preview: ShellImportPreview {
                enabled: false,
                status: "disabled".to_string(),
                message: "已关闭 Shell 环境导入，仅使用当前进程环境与显式覆盖。".to_string(),
                imported_count: 0,
                duration_ms: None,
            },
        };
    }

    let timeout_ms = config
        .environment
        .shell_import
        .timeout_ms
        .clamp(100, MAX_SHELL_IMPORT_TIMEOUT_MS);
    let started_at = Instant::now();

    let output = timeout(
        Duration::from_millis(timeout_ms),
        read_shell_environment_output(),
    )
    .await;
    match output {
        Ok(Ok(raw)) => {
            let env = parse_environment_output(&raw);
            let duration_ms = started_at.elapsed().as_millis() as u64;
            ShellImportResult {
                preview: ShellImportPreview {
                    enabled: true,
                    status: "ok".to_string(),
                    message: format!("已导入 Shell 环境，共 {} 个变量。", env.len()),
                    imported_count: env.len(),
                    duration_ms: Some(duration_ms),
                },
                env,
            }
        }
        Ok(Err(error)) => ShellImportResult {
            env: BTreeMap::new(),
            preview: ShellImportPreview {
                enabled: true,
                status: "error".to_string(),
                message: format!("Shell 环境导入失败：{error}"),
                imported_count: 0,
                duration_ms: Some(started_at.elapsed().as_millis() as u64),
            },
        },
        Err(_) => ShellImportResult {
            env: BTreeMap::new(),
            preview: ShellImportPreview {
                enabled: true,
                status: "timeout".to_string(),
                message: format!(
                    "Shell 环境导入超时（{} ms），已回退为仅使用显式覆盖。",
                    timeout_ms
                ),
                imported_count: 0,
                duration_ms: Some(timeout_ms),
            },
        },
    }
}

async fn read_shell_environment_output() -> Result<Vec<u8>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-ChildItem Env: | ForEach-Object { "{0}={1}" -f $_.Name, $_.Value }"#;
        for shell in ["pwsh", "powershell"] {
            let mut command = Command::new(shell);
            let output = command
                .arg("-NoLogo")
                .arg("-Command")
                .arg(script)
                .output()
                .await;

            match output {
                Ok(result) if result.status.success() => return Ok(result.stdout),
                Ok(_) => continue,
                Err(_) => continue,
            }
        }
        Err("未找到可用的 PowerShell 解释器。".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "/bin/zsh".to_string());

        for args in [vec!["-lic", "env -0"], vec!["-lc", "env -0"]] {
            let mut command = Command::new(&shell);
            let output = command.args(&args).output().await;
            match output {
                Ok(result) if result.status.success() => return Ok(result.stdout),
                Ok(_) => continue,
                Err(_) => continue,
            }
        }

        Err(format!("无法使用 Shell `{shell}` 读取环境变量。"))
    }
}

fn parse_environment_output(raw: &[u8]) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    let text = String::from_utf8_lossy(raw);
    let segments = if text.contains('\0') {
        text.split('\0').map(str::to_string).collect::<Vec<_>>()
    } else {
        text.lines().map(str::to_string).collect::<Vec<_>>()
    };

    for line in segments {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if !is_valid_env_key(key.trim()) {
            continue;
        }
        env.insert(key.trim().to_string(), value.to_string());
    }

    env
}

async fn resolve_effective_environment(config: &Config) -> EffectiveEnvironmentResolution {
    let shell_import = import_shell_environment(config).await;
    let override_env = collect_configured_override_env(config);
    let derived_web_search_env = build_web_search_runtime_env(config);
    let mut env = BTreeMap::new();
    let mut sources = HashMap::new();
    let mut overridden_sources = HashMap::new();

    for (key, value) in &shell_import.env {
        env.insert(key.clone(), value.clone());
        upsert_source(&mut sources, &mut overridden_sources, key, "shell_import");
    }

    for (key, value) in &derived_web_search_env {
        if override_env.contains_key(key) {
            overridden_sources
                .entry(key.clone())
                .or_default()
                .push("web_search".to_string());
            continue;
        }
        env.insert(key.clone(), value.clone());
        upsert_source(&mut sources, &mut overridden_sources, key, "web_search");
    }

    for (key, value) in &override_env {
        env.insert(key.clone(), value.clone());
        upsert_source(&mut sources, &mut overridden_sources, key, "override");
    }

    EffectiveEnvironmentResolution {
        env,
        shell_import: shell_import.preview,
        sources,
        overridden_sources,
    }
}

pub async fn build_environment_preview(config: &Config) -> EnvironmentPreview {
    let resolution = resolve_effective_environment(config).await;
    let configured_keys = collect_configured_override_env(config)
        .into_keys()
        .collect::<BTreeSet<_>>();
    let derived_keys = build_web_search_runtime_env(config)
        .into_keys()
        .filter(|key| {
            DERIVED_PREVIEW_KEYS
                .iter()
                .any(|candidate| candidate == key)
        })
        .collect::<BTreeSet<_>>();
    let mut preview_keys = BTreeSet::new();

    preview_keys.extend(configured_keys);
    preview_keys.extend(derived_keys);
    preview_keys.extend(
        DEFAULT_PREVIEW_KEYS
            .iter()
            .filter(|key| resolution.env.contains_key(**key))
            .map(|key| key.to_string()),
    );

    let entries = preview_keys
        .into_iter()
        .filter_map(|key| {
            let value = resolution.env.get(&key)?.to_string();
            let source = resolution
                .sources
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "process".to_string());
            let source_label = match source.as_str() {
                "override" => "环境变量覆盖",
                "shell_import" => "Shell 环境导入",
                "web_search" => "网络搜索配置",
                _ => "当前进程环境",
            }
            .to_string();
            let sensitive = is_sensitive_key(&key);
            Some(EnvironmentPreviewEntry {
                key: key.clone(),
                masked_value: if sensitive {
                    mask_value(&value)
                } else {
                    value.clone()
                },
                value,
                source,
                source_label,
                sensitive,
                overridden_sources: resolution
                    .overridden_sources
                    .get(&key)
                    .cloned()
                    .unwrap_or_default(),
            })
        })
        .collect();

    EnvironmentPreview {
        shell_import: resolution.shell_import,
        entries,
    }
}

pub async fn apply_configured_environment(config: &Config) {
    let shell_import = import_shell_environment(config).await;
    let mut env = shell_import.env;
    for (key, value) in collect_configured_override_env(config) {
        env.insert(key, value);
    }
    apply_environment_namespace(CONFIGURED_NAMESPACE, &env);
}

pub fn apply_web_search_environment(config: &Config) {
    let override_keys = collect_configured_override_env(config)
        .into_keys()
        .collect::<BTreeSet<_>>();
    let mut env = build_web_search_runtime_env(config);
    env.retain(|key, _| !override_keys.contains(key));
    apply_environment_namespace(WEB_SEARCH_NAMESPACE, &env);
}

pub fn apply_environment_namespace(namespace: &str, env: &BTreeMap<String, String>) {
    let registry = managed_registry();
    let mut registry = match registry.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let baseline_registry = baseline_registry();
    let mut baseline_registry = match baseline_registry.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let next_keys = env.keys().cloned().collect::<BTreeSet<_>>();
    let previous_keys = registry
        .insert(namespace.to_string(), next_keys.clone())
        .unwrap_or_default();

    for key in previous_keys.difference(&next_keys) {
        if let Some(Some(original)) = baseline_registry.get(key) {
            std::env::set_var(key, original);
        } else {
            std::env::remove_var(key);
        }
    }

    for (key, value) in env {
        baseline_registry
            .entry(key.clone())
            .or_insert_with(|| std::env::var(key).ok());
        std::env::set_var(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::config::{
        Config, MultiSearchEngineEntryConfig, SearchEngine, WebSearchConfig,
    };

    #[tokio::test]
    async fn environment_preview_prefers_explicit_override_over_web_search() {
        let mut config = Config::default();
        config.environment.variables = vec![EnvironmentVariableOverride {
            key: "TAVILY_API_KEY".to_string(),
            value: "override-key".to_string(),
            enabled: true,
        }];
        config.web_search = WebSearchConfig {
            engine: SearchEngine::Google,
            provider: WebSearchProvider::Tavily,
            provider_priority: vec![],
            tavily_api_key: Some("search-key".to_string()),
            bing_search_api_key: None,
            google_search_api_key: None,
            google_search_engine_id: None,
            multi_search: Default::default(),
        };

        let preview = build_environment_preview(&config).await;
        let entry = preview
            .entries
            .iter()
            .find(|item| item.key == "TAVILY_API_KEY")
            .expect("should contain TAVILY_API_KEY");

        assert_eq!(entry.value, "override-key");
        assert_eq!(entry.source, "override");
        assert!(entry
            .overridden_sources
            .iter()
            .any(|item| item == "web_search"));
    }

    #[test]
    fn build_web_search_runtime_env_contains_serialized_multi_search_config() {
        let mut config = Config::default();
        config.web_search.provider = WebSearchProvider::MultiSearchEngine;
        config.web_search.multi_search.engines = vec![MultiSearchEngineEntryConfig {
            name: "google".to_string(),
            url_template: "https://www.google.com/search?q={query}".to_string(),
            enabled: true,
        }];

        let env = build_web_search_runtime_env(&config);
        assert_eq!(
            env.get("WEB_SEARCH_PROVIDER").map(String::as_str),
            Some("multi_search_engine")
        );
        assert!(env.contains_key("MULTI_SEARCH_ENGINE_CONFIG_JSON"));
    }
}
