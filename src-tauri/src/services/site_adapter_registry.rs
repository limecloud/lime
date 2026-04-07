use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

const BUNDLED_ADAPTER_RELATIVE_DIR: &str = "resources/site-adapters/bundled";
const IMPORTED_ADAPTER_RELATIVE_DIR: &str = "site-adapters/imported";
const SERVER_SYNCED_ADAPTER_RELATIVE_DIR: &str = "site-adapters/server-synced";
const BUNDLED_INDEX_FALLBACK: &str =
    include_str!("../../resources/site-adapters/bundled/index.json");
const DEFAULT_REGISTRY_VERSION: u32 = 1;

static TEMPLATE_TOKEN_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*(urlencode))?\s*\}\}")
        .expect("site adapter entry template regex should compile")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SiteAdapterArgType {
    String,
    Integer,
}

impl SiteAdapterArgType {
    pub fn schema_type(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Integer => "integer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SiteAdapterSourceKind {
    Bundled,
    Imported,
    ServerSynced,
}

impl SiteAdapterSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::Imported => "imported",
            Self::ServerSynced => "server_synced",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SiteAdapterArgSpec {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub arg_type: SiteAdapterArgType,
    pub example: Option<Value>,
}

#[derive(Debug, Clone)]
pub enum SiteAdapterEntrySpec {
    FixedUrl { url: String },
    UrlTemplate { template: String },
    Builder { id: String },
}

#[derive(Debug, Clone)]
pub struct SiteAdapterSpec {
    pub name: String,
    pub domain: String,
    pub description: String,
    pub read_only: bool,
    pub capabilities: Vec<String>,
    pub args: Vec<SiteAdapterArgSpec>,
    pub example: String,
    pub auth_hint: Option<String>,
    pub entry: SiteAdapterEntrySpec,
    pub script: String,
    pub source_kind: SiteAdapterSourceKind,
    pub source_version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SiteAdapterRegistryDocument {
    #[serde(default = "default_registry_version", alias = "registryVersion")]
    registry_version: u32,
    #[serde(default, alias = "catalogVersion", alias = "version")]
    catalog_version: Option<String>,
    #[serde(default, alias = "tenantId")]
    tenant_id: Option<String>,
    #[serde(default, alias = "syncedAt")]
    synced_at: Option<String>,
    adapters: Vec<SiteAdapterManifestEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SiteAdapterManifestEntry {
    name: String,
    domain: String,
    description: String,
    #[serde(default = "default_read_only", alias = "readOnly")]
    read_only: bool,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    args: Vec<SiteAdapterArgManifest>,
    example: String,
    #[serde(default, alias = "authHint")]
    auth_hint: Option<String>,
    entry: SiteAdapterEntryManifest,
    #[serde(default, alias = "scriptFile")]
    script_file: String,
    #[serde(default)]
    script: Option<String>,
    #[serde(default, alias = "sourceVersion")]
    source_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SiteAdapterArgManifest {
    name: String,
    description: String,
    required: bool,
    #[serde(alias = "argType")]
    arg_type: SiteAdapterArgTypeManifest,
    #[serde(default)]
    example: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SiteAdapterArgTypeManifest {
    String,
    Integer,
}

impl From<SiteAdapterArgTypeManifest> for SiteAdapterArgType {
    fn from(value: SiteAdapterArgTypeManifest) -> Self {
        match value {
            SiteAdapterArgTypeManifest::String => Self::String,
            SiteAdapterArgTypeManifest::Integer => Self::Integer,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SiteAdapterEntryManifest {
    FixedUrl { url: String },
    UrlTemplate { template: String },
    Builder { id: String },
}

impl From<SiteAdapterEntryManifest> for SiteAdapterEntrySpec {
    fn from(value: SiteAdapterEntryManifest) -> Self {
        match value {
            SiteAdapterEntryManifest::FixedUrl { url } => Self::FixedUrl { url },
            SiteAdapterEntryManifest::UrlTemplate { template } => Self::UrlTemplate { template },
            SiteAdapterEntryManifest::Builder { id } => Self::Builder { id },
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SiteAdapterCatalogStatus {
    pub exists: bool,
    pub source_kind: String,
    pub registry_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_at: Option<String>,
    pub adapter_count: usize,
}

#[derive(Debug, Deserialize)]
struct SiteAdapterCatalogBootstrapDocument {
    #[serde(default = "default_registry_version", alias = "registryVersion")]
    registry_version: u32,
    #[serde(default, alias = "catalogVersion", alias = "version")]
    catalog_version: Option<String>,
    #[serde(default, alias = "tenantId")]
    tenant_id: Option<String>,
    #[serde(default, alias = "syncedAt")]
    synced_at: Option<String>,
    adapters: Vec<SiteAdapterCatalogBootstrapEntry>,
}

#[derive(Debug, Deserialize)]
struct SiteAdapterCatalogBootstrapEntry {
    name: String,
    domain: String,
    description: String,
    #[serde(default = "default_read_only", alias = "readOnly")]
    read_only: bool,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    args: Vec<SiteAdapterArgManifest>,
    example: String,
    #[serde(default, alias = "authHint")]
    auth_hint: Option<String>,
    entry: SiteAdapterEntryManifest,
    #[serde(default, alias = "sourceVersion")]
    source_version: Option<String>,
    #[serde(default)]
    script: Option<String>,
}

pub fn normalize_site_adapter_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn load_site_adapter_specs() -> Result<Vec<SiteAdapterSpec>, String> {
    let mut merged = BTreeMap::new();
    for spec in load_imported_site_adapters()? {
        merged.insert(normalize_site_adapter_name(&spec.name), spec);
    }
    for spec in load_bundled_site_adapters()? {
        merged.insert(normalize_site_adapter_name(&spec.name), spec);
    }
    for spec in load_server_synced_site_adapters()? {
        merged.insert(normalize_site_adapter_name(&spec.name), spec);
    }
    Ok(merged.into_values().collect())
}

pub fn find_site_adapter_spec(name: &str) -> Result<Option<SiteAdapterSpec>, String> {
    let normalized = normalize_site_adapter_name(name);
    let adapters = load_site_adapter_specs()?;
    Ok(adapters
        .into_iter()
        .find(|spec| normalize_site_adapter_name(&spec.name) == normalized))
}

pub fn get_site_adapter_catalog_status() -> Result<SiteAdapterCatalogStatus, String> {
    let server_synced = get_site_adapter_catalog_status_from_dir(
        resolve_server_synced_adapter_dir(),
        SiteAdapterSourceKind::ServerSynced,
    )?;
    if server_synced.exists {
        return Ok(server_synced);
    }

    let imported = get_site_adapter_catalog_status_from_dir(
        resolve_imported_adapter_dir(),
        SiteAdapterSourceKind::Imported,
    )?;
    if imported.exists {
        return Ok(imported);
    }

    Ok(empty_site_adapter_catalog_status(
        SiteAdapterSourceKind::Bundled,
        None,
    ))
}

pub fn apply_site_adapter_catalog_bootstrap(
    payload: &Value,
) -> Result<SiteAdapterCatalogStatus, String> {
    let Some(dir) = resolve_server_synced_adapter_dir() else {
        return Err("无法解析站点适配器缓存目录".to_string());
    };
    apply_site_adapter_catalog_bootstrap_to_dir(&dir, payload)
}

pub fn clear_site_adapter_catalog_cache() -> Result<SiteAdapterCatalogStatus, String> {
    clear_site_adapter_catalog_cache_at_dir(resolve_server_synced_adapter_dir())?;
    clear_site_adapter_catalog_cache_at_dir(resolve_imported_adapter_dir())?;
    get_site_adapter_catalog_status()
}

pub fn build_entry_url(
    spec: &SiteAdapterSpec,
    args: &Map<String, Value>,
) -> Result<String, String> {
    match &spec.entry {
        SiteAdapterEntrySpec::FixedUrl { url } => Ok(url.clone()),
        SiteAdapterEntrySpec::UrlTemplate { template } => render_entry_template(template, args),
        SiteAdapterEntrySpec::Builder { id } => build_entry_url_with_builder(id, args),
    }
}

fn load_bundled_site_adapters() -> Result<Vec<SiteAdapterSpec>, String> {
    if let Some(dir) = resolve_bundled_adapter_dir() {
        return load_site_adapters_from_dir(&dir, SiteAdapterSourceKind::Bundled);
    }

    load_site_adapters_from_embedded_index(SiteAdapterSourceKind::Bundled)
}

fn load_server_synced_site_adapters() -> Result<Vec<SiteAdapterSpec>, String> {
    let Some(dir) = resolve_server_synced_adapter_dir() else {
        return Ok(Vec::new());
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }
    load_site_adapters_from_dir(&dir, SiteAdapterSourceKind::ServerSynced)
}

fn load_imported_site_adapters() -> Result<Vec<SiteAdapterSpec>, String> {
    let Some(dir) = resolve_imported_adapter_dir() else {
        return Ok(Vec::new());
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }
    load_site_adapters_from_dir(&dir, SiteAdapterSourceKind::Imported)
}

fn get_site_adapter_catalog_status_from_dir(
    dir: Option<PathBuf>,
    source_kind: SiteAdapterSourceKind,
) -> Result<SiteAdapterCatalogStatus, String> {
    let Some(dir) = dir else {
        return Ok(empty_site_adapter_catalog_status(source_kind, None));
    };

    let index_path = dir.join("index.json");
    if !index_path.exists() {
        return Ok(empty_site_adapter_catalog_status(source_kind, Some(dir)));
    }

    let content = fs::read_to_string(&index_path)
        .map_err(|error| format!("读取站点适配器索引失败 {}: {error}", index_path.display()))?;
    let document: SiteAdapterRegistryDocument = serde_json::from_str(&content)
        .map_err(|error| format!("解析站点适配器索引失败: {error}"))?;

    Ok(SiteAdapterCatalogStatus {
        exists: true,
        source_kind: source_kind.as_str().to_string(),
        registry_version: document.registry_version,
        directory: Some(dir.display().to_string()),
        catalog_version: document.catalog_version,
        tenant_id: document.tenant_id,
        synced_at: document.synced_at,
        adapter_count: document.adapters.len(),
    })
}

fn apply_site_adapter_catalog_bootstrap_to_dir(
    dir: &Path,
    payload: &Value,
) -> Result<SiteAdapterCatalogStatus, String> {
    let catalog_value = extract_site_adapter_catalog_from_bootstrap_payload(payload)
        .ok_or_else(|| "payload 中未找到 siteAdapterCatalog".to_string())?;
    let document = parse_site_adapter_catalog_bootstrap_document(catalog_value)?;
    write_server_synced_catalog_to_dir(dir, document)?;
    get_site_adapter_catalog_status_from_dir(
        Some(dir.to_path_buf()),
        SiteAdapterSourceKind::ServerSynced,
    )
}

fn clear_site_adapter_catalog_cache_at_dir(
    dir: Option<PathBuf>,
) -> Result<SiteAdapterCatalogStatus, String> {
    let directory = dir.as_ref().map(|value| value.display().to_string());
    let Some(dir) = dir else {
        return Ok(SiteAdapterCatalogStatus {
            exists: false,
            source_kind: SiteAdapterSourceKind::ServerSynced.as_str().to_string(),
            registry_version: default_registry_version(),
            directory,
            catalog_version: None,
            tenant_id: None,
            synced_at: None,
            adapter_count: 0,
        });
    };

    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|error| format!("清理站点适配器缓存失败 {}: {error}", dir.display()))?;
    }

    get_site_adapter_catalog_status_from_dir(Some(dir), SiteAdapterSourceKind::ServerSynced)
}

fn empty_site_adapter_catalog_status(
    source_kind: SiteAdapterSourceKind,
    dir: Option<PathBuf>,
) -> SiteAdapterCatalogStatus {
    SiteAdapterCatalogStatus {
        exists: false,
        source_kind: source_kind.as_str().to_string(),
        registry_version: default_registry_version(),
        directory: dir.map(|value| value.display().to_string()),
        catalog_version: None,
        tenant_id: None,
        synced_at: None,
        adapter_count: 0,
    }
}

fn load_site_adapters_from_dir(
    dir: &Path,
    source_kind: SiteAdapterSourceKind,
) -> Result<Vec<SiteAdapterSpec>, String> {
    let index_path = dir.join("index.json");
    let content = fs::read_to_string(&index_path)
        .map_err(|error| format!("读取站点适配器索引失败 {}: {error}", index_path.display()))?;
    load_site_adapters_from_str(&content, Some(dir), source_kind)
}

fn load_site_adapters_from_embedded_index(
    source_kind: SiteAdapterSourceKind,
) -> Result<Vec<SiteAdapterSpec>, String> {
    load_site_adapters_from_str(BUNDLED_INDEX_FALLBACK, None, source_kind)
}

fn load_site_adapters_from_str(
    content: &str,
    dir: Option<&Path>,
    source_kind: SiteAdapterSourceKind,
) -> Result<Vec<SiteAdapterSpec>, String> {
    let document: SiteAdapterRegistryDocument = serde_json::from_str(content)
        .map_err(|error| format!("解析站点适配器索引失败: {error}"))?;

    document
        .adapters
        .into_iter()
        .map(|entry| manifest_entry_to_spec(normalize_manifest_entry(entry), dir, source_kind))
        .collect()
}

fn manifest_entry_to_spec(
    entry: SiteAdapterManifestEntry,
    dir: Option<&Path>,
    source_kind: SiteAdapterSourceKind,
) -> Result<SiteAdapterSpec, String> {
    let script = resolve_manifest_entry_script(&entry, dir, source_kind)?;

    Ok(SiteAdapterSpec {
        name: entry.name,
        domain: entry.domain,
        description: entry.description,
        read_only: entry.read_only,
        capabilities: entry.capabilities,
        args: entry
            .args
            .into_iter()
            .map(|arg| SiteAdapterArgSpec {
                name: arg.name,
                description: arg.description,
                required: arg.required,
                arg_type: arg.arg_type.into(),
                example: arg.example,
            })
            .collect(),
        example: entry.example,
        auth_hint: entry.auth_hint,
        entry: entry.entry.into(),
        script,
        source_kind,
        source_version: entry.source_version,
    })
}

fn resolve_manifest_entry_script(
    entry: &SiteAdapterManifestEntry,
    dir: Option<&Path>,
    source_kind: SiteAdapterSourceKind,
) -> Result<String, String> {
    if let Some(base_dir) = dir {
        if let Some(script_file) = normalize_optional_text(Some(entry.script_file.clone())) {
            let script_path = base_dir.join(&script_file);
            match fs::read_to_string(&script_path) {
                Ok(content) => return Ok(content),
                Err(error) if should_allow_bundled_script_fallback(source_kind) => {
                    if let Some(script) = try_load_bundled_fallback_script(&entry.name)? {
                        return Ok(script);
                    }
                    return Err(format!(
                        "读取站点适配器脚本失败 {}: {error}",
                        script_path.display()
                    ));
                }
                Err(error) => {
                    return Err(format!(
                        "读取站点适配器脚本失败 {}: {error}",
                        script_path.display()
                    ));
                }
            }
        }

        if let Some(script) = entry
            .script
            .as_ref()
            .and_then(|value| normalize_optional_text(Some(value.clone())))
        {
            return Ok(script);
        }

        if should_allow_bundled_script_fallback(source_kind) {
            if let Some(script) = try_load_bundled_fallback_script(&entry.name)? {
                return Ok(script);
            }
        }

        return Err(format!("站点适配器 {} 缺少 script", entry.name));
    }

    if let Some(script) = entry
        .script
        .as_ref()
        .and_then(|value| normalize_optional_text(Some(value.clone())))
    {
        return Ok(script);
    }

    if let Some(script_file) = normalize_optional_text(Some(entry.script_file.clone())) {
        return load_embedded_bundled_script(&script_file).map(|value| value.to_string());
    }

    if let Some(script) = try_load_bundled_fallback_script(&entry.name)? {
        return Ok(script);
    }

    Err(format!("站点适配器 {} 缺少 script", entry.name))
}

fn should_allow_bundled_script_fallback(source_kind: SiteAdapterSourceKind) -> bool {
    !matches!(source_kind, SiteAdapterSourceKind::Bundled)
}

fn try_load_bundled_fallback_script(adapter_name: &str) -> Result<Option<String>, String> {
    let Some(bundled_manifest) = find_embedded_bundled_manifest_entry(adapter_name)? else {
        return Ok(None);
    };
    Ok(Some(
        load_embedded_bundled_script(&bundled_manifest.script_file)?.to_string(),
    ))
}

fn normalize_manifest_entry(mut entry: SiteAdapterManifestEntry) -> SiteAdapterManifestEntry {
    if should_upgrade_legacy_github_search_entry(&entry) {
        entry.entry = SiteAdapterEntryManifest::UrlTemplate {
            template: "https://github.com/search?q={{query|urlencode}}&type=repositories"
                .to_string(),
        };
    }

    entry
}

fn should_upgrade_legacy_github_search_entry(entry: &SiteAdapterManifestEntry) -> bool {
    if normalize_site_adapter_name(&entry.name) != "github/search" {
        return false;
    }

    let has_query_arg = entry.args.iter().any(|arg| {
        arg.name == "query" && matches!(arg.arg_type, SiteAdapterArgTypeManifest::String)
    });
    if !has_query_arg {
        return false;
    }

    matches!(
        &entry.entry,
        SiteAdapterEntryManifest::FixedUrl { url }
            if normalize_fixed_url(url) == "https://github.com/search"
    )
}

fn normalize_fixed_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn extract_site_adapter_catalog_from_bootstrap_payload<'a>(
    payload: &'a Value,
) -> Option<&'a Value> {
    if looks_like_site_adapter_catalog_document(payload) {
        return Some(payload);
    }

    let record = payload.as_object()?;

    for key in [
        "siteAdapterCatalog",
        "site_adapter_catalog",
        "bootstrap",
        "data",
    ] {
        if let Some(nested) = record.get(key) {
            if let Some(found) = extract_site_adapter_catalog_from_bootstrap_payload(nested) {
                return Some(found);
            }
        }
    }

    None
}

fn looks_like_site_adapter_catalog_document(payload: &Value) -> bool {
    payload
        .as_object()
        .and_then(|record| record.get("adapters"))
        .is_some_and(Value::is_array)
}

fn parse_site_adapter_catalog_bootstrap_document(
    payload: &Value,
) -> Result<SiteAdapterCatalogBootstrapDocument, String> {
    serde_json::from_value::<SiteAdapterCatalogBootstrapDocument>(payload.clone())
        .map_err(|error| format!("解析站点适配器 bootstrap payload 失败: {error}"))
}

fn write_server_synced_catalog_to_dir(
    dir: &Path,
    payload: SiteAdapterCatalogBootstrapDocument,
) -> Result<(), String> {
    if dir.exists() {
        fs::remove_dir_all(dir)
            .map_err(|error| format!("清理旧站点适配器目录失败 {}: {error}", dir.display()))?;
    }
    fs::create_dir_all(dir.join("scripts"))
        .map_err(|error| format!("创建站点适配器目录失败 {}: {error}", dir.display()))?;

    let mut seen_names = BTreeSet::new();
    let mut adapters = Vec::with_capacity(payload.adapters.len());
    for entry in payload.adapters {
        let normalized_name = normalize_site_adapter_name(&entry.name);
        if normalized_name.is_empty() {
            return Err("站点适配器 name 不能为空".to_string());
        }
        if !seen_names.insert(normalized_name) {
            return Err(format!("站点适配器重复: {}", entry.name));
        }

        let script = resolve_server_synced_entry_script(&entry)?;
        let script_file = build_server_synced_script_file(&entry.name);
        let script_path = dir.join(&script_file);
        if let Some(parent) = script_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("创建站点适配器脚本目录失败 {}: {error}", parent.display())
            })?;
        }
        fs::write(&script_path, script).map_err(|error| {
            format!("写入站点适配器脚本失败 {}: {error}", script_path.display())
        })?;

        adapters.push(normalize_manifest_entry(SiteAdapterManifestEntry {
            name: normalize_required_text(&entry.name, "name")?,
            domain: normalize_required_text(&entry.domain, "domain")?,
            description: normalize_required_text(&entry.description, "description")?,
            read_only: entry.read_only,
            capabilities: entry.capabilities,
            args: entry.args,
            example: normalize_required_text(&entry.example, "example")?,
            auth_hint: normalize_optional_text(entry.auth_hint),
            entry: entry.entry,
            script_file,
            script: None,
            source_version: normalize_optional_text(entry.source_version),
        }));
    }

    let document = SiteAdapterRegistryDocument {
        registry_version: if payload.registry_version == 0 {
            default_registry_version()
        } else {
            payload.registry_version
        },
        catalog_version: normalize_optional_text(payload.catalog_version),
        tenant_id: normalize_optional_text(payload.tenant_id),
        synced_at: normalize_optional_text(payload.synced_at),
        adapters,
    };
    let index_path = dir.join("index.json");
    let content = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("序列化站点适配器索引失败: {error}"))?;
    fs::write(&index_path, content)
        .map_err(|error| format!("写入站点适配器索引失败 {}: {error}", index_path.display()))
}

fn resolve_server_synced_entry_script(
    entry: &SiteAdapterCatalogBootstrapEntry,
) -> Result<String, String> {
    if let Some(script) = entry
        .script
        .as_ref()
        .and_then(|value| normalize_optional_text(Some(value.clone())))
    {
        return Ok(script);
    }

    let bundled_manifest = find_embedded_bundled_manifest_entry(&entry.name)?.ok_or_else(|| {
        format!(
            "站点适配器 {} 缺少 script，且未命中 bundled 回退",
            entry.name
        )
    })?;
    load_embedded_bundled_script(&bundled_manifest.script_file).map(|value| value.to_string())
}

fn find_embedded_bundled_manifest_entry(
    adapter_name: &str,
) -> Result<Option<SiteAdapterManifestEntry>, String> {
    let document: SiteAdapterRegistryDocument = serde_json::from_str(BUNDLED_INDEX_FALLBACK)
        .map_err(|error| format!("解析内置站点适配器索引失败: {error}"))?;
    let normalized_name = normalize_site_adapter_name(adapter_name);

    Ok(document
        .adapters
        .into_iter()
        .find(|entry| normalize_site_adapter_name(&entry.name) == normalized_name))
}

fn load_embedded_bundled_script(script_file: &str) -> Result<&'static str, String> {
    match script_file {
        "scripts/36kr-newsflash.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/36kr-newsflash.js"
        )),
        "scripts/bilibili-search.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/bilibili-search.js"
        )),
        "scripts/github-issues.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/github-issues.js"
        )),
        "scripts/github-search.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/github-search.js"
        )),
        "scripts/linux-do-categories.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/linux-do-categories.js"
        )),
        "scripts/linux-do-hot.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/linux-do-hot.js"
        )),
        "scripts/smzdm-search.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/smzdm-search.js"
        )),
        "scripts/yahoo-finance-quote.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/yahoo-finance-quote.js"
        )),
        "scripts/x-article-export.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/x-article-export.js"
        )),
        "scripts/zhihu-hot.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/zhihu-hot.js"
        )),
        "scripts/zhihu-search.js" => Ok(include_str!(
            "../../resources/site-adapters/bundled/scripts/zhihu-search.js"
        )),
        _ => Err(format!("未注册的 bundled 适配器脚本: {script_file}")),
    }
}

fn resolve_bundled_adapter_dir() -> Option<PathBuf> {
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/site-adapters/bundled");
    if dev_dir.exists() {
        return Some(dev_dir);
    }

    resolve_packaged_resource_root()
        .map(|root| root.join(BUNDLED_ADAPTER_RELATIVE_DIR))
        .filter(|dir| dir.exists())
}

fn resolve_server_synced_adapter_dir() -> Option<PathBuf> {
    lime_core::app_paths::preferred_data_dir()
        .ok()
        .map(|root| root.join(SERVER_SYNCED_ADAPTER_RELATIVE_DIR))
}

pub(crate) fn resolve_imported_adapter_dir() -> Option<PathBuf> {
    lime_core::app_paths::preferred_data_dir()
        .ok()
        .map(|root| root.join(IMPORTED_ADAPTER_RELATIVE_DIR))
}

fn resolve_packaged_resource_root() -> Option<PathBuf> {
    let mut path = std::env::current_exe().ok()?;
    path.pop();

    #[cfg(target_os = "macos")]
    {
        path.pop();
        path.push("Resources");
    }

    Some(path)
}

fn build_server_synced_script_file(adapter_name: &str) -> String {
    let file_name = sanitize_path_segment(adapter_name);
    format!("scripts/{file_name}.js")
}

fn sanitize_path_segment(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    let mut last_was_dash = false;

    for ch in value.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if matches!(ch, '/' | '\\' | '-' | '_' | ' ') {
            Some('-')
        } else {
            None
        };

        let Some(next_char) = normalized else {
            continue;
        };
        if next_char == '-' {
            if last_was_dash {
                continue;
            }
            last_was_dash = true;
            sanitized.push(next_char);
            continue;
        }

        last_was_dash = false;
        sanitized.push(next_char);
    }

    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "adapter".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_required_text(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("站点适配器字段 {field} 不能为空"));
    }
    Ok(normalized.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let normalized = item.trim();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized.to_string())
        }
    })
}

fn render_entry_template(template: &str, args: &Map<String, Value>) -> Result<String, String> {
    let mut missing_arg = None::<String>;
    let rendered = TEMPLATE_TOKEN_REGEX.replace_all(template, |captures: &regex::Captures<'_>| {
        let arg_name = captures
            .get(1)
            .map(|value| value.as_str())
            .unwrap_or_default();
        let Some(raw_value) = args.get(arg_name) else {
            missing_arg = Some(arg_name.to_string());
            return String::new();
        };

        let string_value = match value_to_url_token(raw_value) {
            Some(value) => value,
            None => {
                missing_arg = Some(arg_name.to_string());
                return String::new();
            }
        };

        match captures.get(2).map(|value| value.as_str()) {
            Some("urlencode") => urlencoding::encode(&string_value).into_owned(),
            _ => string_value,
        }
    });

    if let Some(arg_name) = missing_arg {
        return Err(format!("缺少入口 URL 所需参数: {arg_name}"));
    }

    Ok(rendered.into_owned())
}

fn build_entry_url_with_builder(id: &str, args: &Map<String, Value>) -> Result<String, String> {
    match id {
        "github_issues" => build_github_issues_url(args),
        "x_article_export" => build_x_article_export_url(args),
        _ => Err(format!("不支持的入口构造器: {id}")),
    }
}

fn build_github_issues_url(args: &Map<String, Value>) -> Result<String, String> {
    let repo = get_required_string_arg(args, "repo")?;
    let query = get_optional_string_arg(args, "query");
    let state = get_optional_string_arg(args, "state");

    let mut query_parts = Vec::new();
    if let Some(value) = query {
        query_parts.push(value);
    }
    if let Some(value) = state {
        match value.as_str() {
            "open" | "closed" => query_parts.push(format!("state:{value}")),
            "all" => {}
            _ => return Err("state 仅支持 open / closed / all".to_string()),
        }
    }

    if query_parts.is_empty() {
        Ok(format!("https://github.com/{repo}/issues"))
    } else {
        Ok(format!(
            "https://github.com/{repo}/issues?q={}",
            urlencoding::encode(&query_parts.join(" "))
        ))
    }
}

fn build_x_article_export_url(args: &Map<String, Value>) -> Result<String, String> {
    let raw_url = get_required_string_arg(args, "url")?;
    let parsed =
        Url::parse(&raw_url).map_err(|error| format!("url 不是合法的站点链接: {error}"))?;
    let hostname = parsed
        .host_str()
        .map(|value| value.trim().to_ascii_lowercase())
        .ok_or_else(|| "url 缺少域名".to_string())?;
    if hostname != "x.com" && hostname != "www.x.com" && hostname != "twitter.com" {
        return Err("url 必须指向 x.com 或 twitter.com".to_string());
    }
    if !parsed.path().contains("/article/") {
        return Err("url 必须是 X 长文 article 链接".to_string());
    }

    Ok(parsed.to_string())
}

fn get_required_string_arg(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    get_optional_string_arg(args, key).ok_or_else(|| format!("参数 {key} 不能为空"))
}

fn get_optional_string_arg(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn value_to_url_token(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .map(ToString::to_string)
        .or_else(|| value.as_i64().map(|raw| raw.to_string()))
        .or_else(|| value.as_u64().map(|raw| raw.to_string()))
}

fn default_read_only() -> bool {
    true
}

fn default_registry_version() -> u32 {
    DEFAULT_REGISTRY_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::site_adapter_import_service::{
        compile_imported_yaml_adapter_bundle, persist_compiled_imported_adapters,
        ImportedYamlCompileOptions,
    };
    use tempfile::tempdir;

    const REAL_WORLD_IMPORTED_ADAPTER_BUNDLE_FIXTURE: &str =
        include_str!("../../tests/fixtures/site-adapters/imported-real-world-bundle.yaml");

    #[test]
    fn should_load_bundled_registry_from_resources() {
        let adapters = load_bundled_site_adapters().expect("bundled adapters should load");
        assert!(adapters
            .iter()
            .any(|adapter| adapter.name == "github/search"));
        let github = adapters
            .iter()
            .find(|adapter| adapter.name == "github/search")
            .expect("github/search should exist");
        assert_eq!(github.source_kind, SiteAdapterSourceKind::Bundled);
        assert_eq!(github.source_version.as_deref(), Some("2026-03-25"));
        assert!(github.script.contains("a.v-align-middle"));
    }

    #[test]
    fn should_load_selected_bundled_market_finance_and_community_adapters_from_embedded_index() {
        let adapters = load_site_adapters_from_embedded_index(SiteAdapterSourceKind::Bundled)
            .expect("embedded bundled adapters should load");

        let linux_do_hot = adapters
            .iter()
            .find(|adapter| adapter.name == "linux-do/hot")
            .expect("linux-do/hot should exist");
        assert_eq!(linux_do_hot.source_kind, SiteAdapterSourceKind::Bundled);
        assert_eq!(linux_do_hot.source_version.as_deref(), Some("2026-03-28"));
        assert!(matches!(
            linux_do_hot.entry,
            SiteAdapterEntrySpec::FixedUrl { ref url } if url == "https://linux.do"
        ));
        assert_eq!(
            linux_do_hot.auth_hint.as_deref(),
            Some("请先在浏览器中登录 linux.do，再重试该命令。")
        );
        assert!(linux_do_hot.script.contains("/top.json?period="));

        let linux_do_categories = adapters
            .iter()
            .find(|adapter| adapter.name == "linux-do/categories")
            .expect("linux-do/categories should exist");
        assert_eq!(
            linux_do_categories.source_kind,
            SiteAdapterSourceKind::Bundled
        );
        assert_eq!(
            linux_do_categories.source_version.as_deref(),
            Some("2026-03-28")
        );
        assert!(matches!(
            linux_do_categories.entry,
            SiteAdapterEntrySpec::FixedUrl { ref url } if url == "https://linux.do"
        ));
        assert!(linux_do_categories.script.contains("/categories.json"));

        let yahoo = adapters
            .iter()
            .find(|adapter| adapter.name == "yahoo-finance/quote")
            .expect("yahoo-finance/quote should exist");
        assert_eq!(yahoo.source_kind, SiteAdapterSourceKind::Bundled);
        assert_eq!(yahoo.source_version.as_deref(), Some("2026-03-28"));
        assert!(matches!(
            yahoo.entry,
            SiteAdapterEntrySpec::UrlTemplate { ref template }
                if template == "https://finance.yahoo.com/quote/{{symbol|urlencode}}/"
        ));
        assert!(yahoo.script.contains("query1.finance.yahoo.com"));

        let smzdm = adapters
            .iter()
            .find(|adapter| adapter.name == "smzdm/search")
            .expect("smzdm/search should exist");
        assert_eq!(smzdm.source_kind, SiteAdapterSourceKind::Bundled);
        assert_eq!(smzdm.source_version.as_deref(), Some("2026-03-28"));
        assert!(matches!(
            smzdm.entry,
            SiteAdapterEntrySpec::UrlTemplate { ref template }
                if template == "https://search.smzdm.com/?c=home&s={{query|urlencode}}&v=b"
        ));
        assert!(smzdm.script.contains("li.feed-row-wide"));

        let x_article = adapters
            .iter()
            .find(|adapter| adapter.name == "x/article-export")
            .expect("x/article-export should exist");
        assert_eq!(x_article.source_kind, SiteAdapterSourceKind::Bundled);
        assert_eq!(x_article.source_version.as_deref(), Some("2026-04-07"));
        assert!(matches!(
            x_article.entry,
            SiteAdapterEntrySpec::Builder { ref id } if id == "x_article_export"
        ));
        assert!(x_article.script.contains("markdown_bundle"));
    }

    #[test]
    fn should_render_url_template_with_urlencode() {
        let spec = SiteAdapterSpec {
            name: "github/search".to_string(),
            domain: "github.com".to_string(),
            description: String::new(),
            read_only: true,
            capabilities: Vec::new(),
            args: Vec::new(),
            example: String::new(),
            auth_hint: None,
            entry: SiteAdapterEntrySpec::UrlTemplate {
                template: "https://github.com/search?q={{query|urlencode}}".to_string(),
            },
            script: String::new(),
            source_kind: SiteAdapterSourceKind::Bundled,
            source_version: None,
        };
        let mut args = Map::new();
        args.insert(
            "query".to_string(),
            Value::String("model context protocol".to_string()),
        );

        let url = build_entry_url(&spec, &args).expect("template url should render");
        assert_eq!(
            url,
            "https://github.com/search?q=model%20context%20protocol"
        );
    }

    #[test]
    fn should_allow_server_synced_adapters_to_override_bundled_name() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let dir = temp_dir.path();
        fs::create_dir_all(dir.join("scripts")).expect("scripts dir should exist");
        fs::write(
            dir.join("index.json"),
            r#"
            {
              "adapters": [
                {
                  "name": "github/search",
                  "domain": "github.com",
                  "description": "server synced",
                  "read_only": true,
                  "capabilities": ["search"],
                  "args": [],
                  "example": "github/search {}",
                  "entry": {
                    "kind": "fixed_url",
                    "url": "https://github.com/search"
                  },
                  "script_file": "scripts/github-search.js",
                  "source_version": "sync-1"
                }
              ]
            }
            "#,
        )
        .expect("index should write");
        fs::write(
            dir.join("scripts/github-search.js"),
            "async () => ({ ok: true })",
        )
        .expect("script should write");

        let adapters = load_site_adapters_from_dir(dir, SiteAdapterSourceKind::ServerSynced)
            .expect("server synced adapters should load");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "github/search");
        assert_eq!(adapters[0].source_kind, SiteAdapterSourceKind::ServerSynced);
        assert_eq!(adapters[0].source_version.as_deref(), Some("sync-1"));
    }

    #[test]
    fn should_build_x_article_export_url_with_builder() {
        let mut args = Map::new();
        args.insert(
            "url".to_string(),
            Value::String("https://x.com/GoogleCloudTech/article/2033953579824758855".to_string()),
        );

        let url = build_entry_url_with_builder("x_article_export", &args)
            .expect("x article builder should accept article url");
        assert_eq!(
            url,
            "https://x.com/GoogleCloudTech/article/2033953579824758855"
        );
    }

    #[test]
    fn should_reject_non_article_url_for_x_article_export_builder() {
        let mut args = Map::new();
        args.insert(
            "url".to_string(),
            Value::String("https://x.com/GoogleCloudTech/status/123".to_string()),
        );

        let error = build_entry_url_with_builder("x_article_export", &args)
            .expect_err("non-article url should be rejected");
        assert!(error.contains("article"));
    }

    #[test]
    fn should_load_imported_adapters_from_imported_catalog() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let dir = temp_dir.path();
        fs::create_dir_all(dir.join("scripts")).expect("scripts dir should exist");
        fs::write(
            dir.join("index.json"),
            r#"
            {
              "catalog_version": "imported-catalog-1",
              "adapters": [
                {
                  "name": "reddit/hot",
                  "domain": "www.reddit.com",
                  "description": "imported reddit hot",
                  "read_only": true,
                  "capabilities": ["research", "hot"],
                  "args": [],
                  "example": "reddit/hot {}",
                  "entry": {
                    "kind": "fixed_url",
                    "url": "https://www.reddit.com"
                  },
                  "script_file": "scripts/reddit-hot.js",
                  "source_version": "imported-1"
                }
              ]
            }
            "#,
        )
        .expect("index should write");
        fs::write(
            dir.join("scripts/reddit-hot.js"),
            "async () => ({ ok: true, data: { items: [] } })",
        )
        .expect("script should write");

        let adapters = load_site_adapters_from_dir(dir, SiteAdapterSourceKind::Imported)
            .expect("imported adapters should load");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "reddit/hot");
        assert_eq!(adapters[0].source_kind, SiteAdapterSourceKind::Imported);
        assert_eq!(adapters[0].source_version.as_deref(), Some("imported-1"));
    }

    #[test]
    fn should_load_real_world_imported_bundle_persisted_by_import_service() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let adapters = compile_imported_yaml_adapter_bundle(
            REAL_WORLD_IMPORTED_ADAPTER_BUNDLE_FIXTURE,
            &ImportedYamlCompileOptions {
                read_only: true,
                source_version: Some("fixture-real-world".to_string()),
            },
        )
        .expect("real world bundle should compile");

        let persist_result = persist_compiled_imported_adapters(
            temp_dir.path(),
            &adapters,
            Some("fixture-imported-catalog".to_string()),
        )
        .expect("real world bundle should persist");
        assert_eq!(persist_result.adapter_count, 5);

        let status = get_site_adapter_catalog_status_from_dir(
            Some(temp_dir.path().to_path_buf()),
            SiteAdapterSourceKind::Imported,
        )
        .expect("imported catalog status should load");
        assert!(status.exists);
        assert_eq!(status.source_kind, "imported");
        assert_eq!(
            status.catalog_version.as_deref(),
            Some("fixture-imported-catalog")
        );
        assert_eq!(status.adapter_count, 5);

        let loaded = load_site_adapters_from_dir(temp_dir.path(), SiteAdapterSourceKind::Imported)
            .expect("imported adapters should load");
        assert_eq!(loaded.len(), 5);

        let yahoo_quote = loaded
            .iter()
            .find(|adapter| adapter.name == "yahoo-finance/quote")
            .expect("yahoo-finance/quote should exist");
        assert_eq!(yahoo_quote.source_kind, SiteAdapterSourceKind::Imported);
        assert_eq!(
            yahoo_quote.source_version.as_deref(),
            Some("fixture-real-world")
        );
        assert!(matches!(
            yahoo_quote.entry,
            SiteAdapterEntrySpec::UrlTemplate { ref template }
                if template == "https://finance.yahoo.com/quote/{{symbol|urlencode}}/"
        ));
        assert_eq!(
            yahoo_quote.auth_hint.as_deref(),
            Some("该适配器依赖已有浏览器上下文，必要时请先在目标站点完成登录。")
        );

        let smzdm_search = loaded
            .iter()
            .find(|adapter| adapter.name == "smzdm/search")
            .expect("smzdm/search should exist");
        assert!(smzdm_search.capabilities.contains(&"search".to_string()));
    }

    #[test]
    fn should_upgrade_legacy_server_synced_github_search_fixed_url_to_template() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let dir = temp_dir.path();
        fs::create_dir_all(dir.join("scripts")).expect("scripts dir should exist");
        fs::write(
            dir.join("index.json"),
            r#"
            {
              "adapters": [
                {
                  "name": "github/search",
                  "domain": "github.com",
                  "description": "server synced",
                  "read_only": true,
                  "capabilities": ["search"],
                  "args": [
                    {
                      "name": "query",
                      "description": "搜索关键词",
                      "required": true,
                      "arg_type": "string",
                      "example": "mcp"
                    }
                  ],
                  "example": "github/search {\"query\":\"mcp\"}",
                  "entry": {
                    "kind": "fixed_url",
                    "url": "https://github.com/search"
                  },
                  "script_file": "scripts/github-search.js",
                  "source_version": "sync-legacy"
                }
              ]
            }
            "#,
        )
        .expect("index should write");
        fs::write(
            dir.join("scripts/github-search.js"),
            "async () => ({ ok: true })",
        )
        .expect("script should write");

        let adapters = load_site_adapters_from_dir(dir, SiteAdapterSourceKind::ServerSynced)
            .expect("server synced adapters should load");
        let github = adapters
            .iter()
            .find(|adapter| adapter.name == "github/search")
            .expect("github/search should exist");

        let mut args = Map::new();
        args.insert("query".to_string(), Value::String("mcp".to_string()));

        let url = build_entry_url(github, &args).expect("entry url should build");
        assert_eq!(url, "https://github.com/search?q=mcp&type=repositories");
    }

    #[test]
    fn should_extract_site_adapter_catalog_from_nested_bootstrap_payload() {
        let payload = serde_json::json!({
            "data": {
                "bootstrap": {
                    "siteAdapterCatalog": {
                        "catalogVersion": "tenant-sync-1",
                        "adapters": []
                    }
                }
            }
        });

        let extracted = extract_site_adapter_catalog_from_bootstrap_payload(&payload)
            .expect("nested catalog should extract");
        assert_eq!(
            extracted["catalogVersion"],
            Value::String("tenant-sync-1".to_string())
        );
    }

    #[test]
    fn should_persist_server_synced_bootstrap_catalog_with_inline_scripts() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let payload = serde_json::json!({
            "bootstrap": {
                "siteAdapterCatalog": {
                    "catalogVersion": "tenant-sync-1",
                    "tenantId": "tenant-demo",
                    "syncedAt": "2026-03-25T10:00:00.000Z",
                    "adapters": [
                        {
                            "name": "github/search",
                            "domain": "github.com",
                            "description": "server synced github search",
                            "read_only": true,
                            "capabilities": ["search"],
                            "args": [],
                            "example": "github/search {\"query\":\"lime\"}",
                            "entry": {
                                "kind": "fixed_url",
                                "url": "https://github.com/search"
                            },
                            "script": "async () => ({ items: [] })",
                            "sourceVersion": "tenant-sync-1"
                        }
                    ]
                }
            }
        });

        let status = apply_site_adapter_catalog_bootstrap_to_dir(temp_dir.path(), &payload)
            .expect("bootstrap catalog should persist");
        assert_eq!(
            status,
            SiteAdapterCatalogStatus {
                exists: true,
                source_kind: "server_synced".to_string(),
                registry_version: 1,
                directory: Some(temp_dir.path().display().to_string()),
                catalog_version: Some("tenant-sync-1".to_string()),
                tenant_id: Some("tenant-demo".to_string()),
                synced_at: Some("2026-03-25T10:00:00.000Z".to_string()),
                adapter_count: 1,
            }
        );

        let index_content = fs::read_to_string(temp_dir.path().join("index.json"))
            .expect("index.json should exist");
        assert!(index_content.contains("\"catalog_version\": \"tenant-sync-1\""));
        assert!(index_content.contains("\"script_file\": \"scripts/github-search.js\""));

        let script_content = fs::read_to_string(temp_dir.path().join("scripts/github-search.js"))
            .expect("script file should exist");
        assert_eq!(script_content, "async () => ({ items: [] })");

        let adapters =
            load_site_adapters_from_dir(temp_dir.path(), SiteAdapterSourceKind::ServerSynced)
                .expect("persisted adapters should load");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "github/search");
        assert_eq!(adapters[0].source_version.as_deref(), Some("tenant-sync-1"));
    }

    #[test]
    fn should_persist_server_synced_bootstrap_catalog_with_bundled_script_fallback() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let payload = serde_json::json!({
            "siteAdapterCatalog": {
                "registryVersion": 1,
                "catalogVersion": "tenant-sync-2",
                "tenantId": "tenant-demo",
                "syncedAt": "2026-03-28T10:00:00.000Z",
                "adapters": [
                    {
                        "name": "github/search",
                        "domain": "github.com",
                        "description": "server synced github search",
                        "readOnly": true,
                        "capabilities": ["search"],
                        "args": [
                            {
                                "name": "query",
                                "description": "搜索关键词",
                                "required": true,
                                "argType": "string",
                                "example": "lime"
                            }
                        ],
                        "example": "github/search {\"query\":\"lime\"}",
                        "entry": {
                            "kind": "url_template",
                            "template": "https://github.com/search?q={{query|urlencode}}&type=repositories"
                        },
                        "sourceVersion": "tenant-sync-2"
                    }
                ]
            }
        });

        let status = apply_site_adapter_catalog_bootstrap_to_dir(temp_dir.path(), &payload)
            .expect("bootstrap catalog should persist with bundled fallback");
        assert!(status.exists);
        assert_eq!(status.catalog_version.as_deref(), Some("tenant-sync-2"));

        let script_content = fs::read_to_string(temp_dir.path().join("scripts/github-search.js"))
            .expect("fallback bundled script should be written");
        assert!(script_content.contains("helpers.uniqueBy"));

        let adapters =
            load_site_adapters_from_dir(temp_dir.path(), SiteAdapterSourceKind::ServerSynced)
                .expect("persisted adapters should load");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "github/search");
        assert_eq!(adapters[0].source_version.as_deref(), Some("tenant-sync-2"));
        assert_eq!(adapters[0].source_kind, SiteAdapterSourceKind::ServerSynced);
    }

    #[test]
    fn should_load_legacy_server_synced_catalog_without_script_file_by_falling_back_to_bundled() {
        let temp_dir = tempdir().expect("temp dir should exist");
        fs::write(
            temp_dir.path().join("index.json"),
            serde_json::json!({
                "registry_version": 1,
                "catalog_version": "tenant-sync-legacy",
                "adapters": [
                    {
                        "name": "github/search",
                        "domain": "github.com",
                        "description": "legacy server synced github search",
                        "read_only": true,
                        "capabilities": ["search"],
                        "args": [],
                        "example": "github/search {\"query\":\"lime\"}",
                        "entry": {
                            "kind": "fixed_url",
                            "url": "https://github.com/search"
                        }
                    }
                ]
            })
            .to_string(),
        )
        .expect("index.json should write");

        let adapters =
            load_site_adapters_from_dir(temp_dir.path(), SiteAdapterSourceKind::ServerSynced)
                .expect("legacy adapters should load with bundled fallback");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "github/search");
        assert_eq!(adapters[0].source_kind, SiteAdapterSourceKind::ServerSynced);
        assert!(adapters[0].script.contains("a.v-align-middle"));
    }

    #[test]
    fn should_load_legacy_server_synced_catalog_inline_script_without_script_file() {
        let temp_dir = tempdir().expect("temp dir should exist");
        fs::write(
            temp_dir.path().join("index.json"),
            serde_json::json!({
                "registry_version": 1,
                "catalog_version": "tenant-sync-inline",
                "adapters": [
                    {
                        "name": "github/search",
                        "domain": "github.com",
                        "description": "legacy inline github search",
                        "read_only": true,
                        "capabilities": ["search"],
                        "args": [],
                        "example": "github/search {\"query\":\"lime\"}",
                        "entry": {
                            "kind": "fixed_url",
                            "url": "https://github.com/search"
                        },
                        "script": "async () => ({ items: [{ title: \"inline\" }] })"
                    }
                ]
            })
            .to_string(),
        )
        .expect("index.json should write");

        let adapters =
            load_site_adapters_from_dir(temp_dir.path(), SiteAdapterSourceKind::ServerSynced)
                .expect("legacy adapters should load with inline script");
        assert_eq!(adapters.len(), 1);
        assert_eq!(
            adapters[0].script,
            "async () => ({ items: [{ title: \"inline\" }] })"
        );
    }

    #[test]
    fn should_fallback_to_bundled_when_server_synced_script_file_is_missing() {
        let temp_dir = tempdir().expect("temp dir should exist");
        fs::create_dir_all(temp_dir.path().join("scripts")).expect("scripts dir should exist");
        fs::write(
            temp_dir.path().join("index.json"),
            serde_json::json!({
                "registry_version": 1,
                "catalog_version": "tenant-sync-missing-file",
                "adapters": [
                    {
                        "name": "github/search",
                        "domain": "github.com",
                        "description": "missing file github search",
                        "read_only": true,
                        "capabilities": ["search"],
                        "args": [],
                        "example": "github/search {\"query\":\"lime\"}",
                        "entry": {
                            "kind": "fixed_url",
                            "url": "https://github.com/search"
                        },
                        "script_file": "scripts/missing.js"
                    }
                ]
            })
            .to_string(),
        )
        .expect("index.json should write");

        let adapters =
            load_site_adapters_from_dir(temp_dir.path(), SiteAdapterSourceKind::ServerSynced)
                .expect("legacy adapters should load with bundled fallback");
        assert_eq!(adapters.len(), 1);
        assert!(adapters[0].script.contains("a.v-align-middle"));
    }

    #[test]
    fn should_clear_server_synced_catalog_cache() {
        let temp_dir = tempdir().expect("temp dir should exist");
        let payload = serde_json::json!({
            "siteAdapterCatalog": {
                "catalogVersion": "tenant-sync-1",
                "adapters": [
                    {
                        "name": "zhihu/hot",
                        "domain": "www.zhihu.com",
                        "description": "server synced zhihu hot",
                        "read_only": true,
                        "capabilities": ["hot"],
                        "args": [],
                        "example": "zhihu/hot {}",
                        "entry": {
                            "kind": "fixed_url",
                            "url": "https://www.zhihu.com/hot"
                        },
                        "script": "async () => ({ items: [] })"
                    }
                ]
            }
        });
        apply_site_adapter_catalog_bootstrap_to_dir(temp_dir.path(), &payload)
            .expect("bootstrap catalog should persist");

        let status = clear_site_adapter_catalog_cache_at_dir(Some(temp_dir.path().to_path_buf()))
            .expect("cache should clear");
        assert!(!status.exists);
        assert_eq!(status.adapter_count, 0);
        assert!(!temp_dir.path().exists());
    }

    #[test]
    fn should_build_github_issues_url_with_state_filter() {
        let mut args = Map::new();
        args.insert(
            "repo".to_string(),
            Value::String("rust-lang/rust".to_string()),
        );
        args.insert(
            "query".to_string(),
            Value::String("borrow checker".to_string()),
        );
        args.insert("state".to_string(), Value::String("open".to_string()));

        let url = build_entry_url_with_builder("github_issues", &args)
            .expect("github issues url should build");
        assert!(url.contains("rust-lang/rust/issues"));
        assert!(url.contains("borrow%20checker"));
        assert!(url.contains("state%3Aopen"));
    }
}
