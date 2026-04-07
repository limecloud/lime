use crate::commands::webview_cmd::{
    close_cdp_session_global, ensure_managed_chrome_profile_global, list_cdp_targets_global,
    open_cdp_session_global, shared_browser_runtime, BrowserSessionStateRequest,
    ListCdpTargetsRequest, OpenCdpSessionRequest,
};
use crate::content::{ContentCreateRequest, ContentManager, ContentType, ContentUpdateRequest};
use crate::database::{lock_db, DbConnection};
use crate::services::site_adapter_registry::{
    build_entry_url, find_site_adapter_spec, load_site_adapter_specs, normalize_site_adapter_name,
    SiteAdapterArgType, SiteAdapterSpec,
};
use crate::workspace::WorkspaceManager;
use base64::Engine;
use lime_browser_runtime::{CdpSessionState, CdpTargetInfo};
use lime_core::database::dao::browser_profile::{
    BrowserProfileDao, BrowserProfileRecord, BrowserProfileTransportKind,
};
use lime_server::chrome_bridge::{
    self, ChromeBridgeCommandRequest, ChromeBridgeCommandResult, ChromeBridgeObserverSnapshot,
};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use url::Url;

const DEFAULT_PROFILE_KEY: &str = "default";
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MIN_ADAPTER_EVALUATE_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const EXPLICIT_PROJECT_SAVE_SOURCE: &str = "explicit_project";
const EXPLICIT_CONTENT_SAVE_SOURCE: &str = "explicit_content";
const SITE_EXPORTS_ROOT_DIR: &str = "exports";
const MARKDOWN_BUNDLE_EXPORT_KIND: &str = "markdown_bundle";
const MARKDOWN_BUNDLE_IMAGE_DIR: &str = "images";

#[derive(Debug, Clone, Serialize)]
pub struct SiteAdapterArgumentDefinition {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub arg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteAdapterDefinition {
    pub name: String,
    pub domain: String,
    pub description: String,
    pub read_only: bool,
    pub capabilities: Vec<String>,
    pub input_schema: Value,
    pub example_args: Value,
    pub example: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteAdapterRecommendation {
    pub adapter: SiteAdapterDefinition,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub entry_url: String,
    pub score: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SiteAdapterLaunchReadinessRequest {
    pub adapter_name: String,
    #[serde(default)]
    pub profile_key: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SiteAdapterLaunchReadinessStatus {
    Ready,
    RequiresBrowserRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteAdapterLaunchReadinessResult {
    pub status: SiteAdapterLaunchReadinessStatus,
    pub adapter: String,
    pub domain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunSiteAdapterRequest {
    pub adapter_name: String,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub profile_key: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub content_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub save_title: Option<String>,
    #[serde(default)]
    pub require_attached_session: Option<bool>,
    #[serde(default)]
    pub skill_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteAdapterRunResult {
    pub ok: bool,
    pub adapter: String,
    pub domain: String,
    pub profile_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub entry_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_content: Option<SavedSiteAdapterContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save_skipped_project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save_skipped_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save_error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveSiteAdapterResultRequest {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub content_id: Option<String>,
    #[serde(default)]
    pub save_title: Option<String>,
    pub run_request: RunSiteAdapterRequest,
    pub result: SiteAdapterRunResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSiteAdapterContent {
    pub content_id: String,
    pub project_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_relative_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images_relative_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_count: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
struct MarkdownBundleImageExport {
    url: String,
    #[serde(default)]
    alt: Option<String>,
    #[serde(default)]
    suggested_file_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct MarkdownBundleExport {
    #[serde(rename = "export_kind")]
    _export_kind: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    markdown: String,
    #[serde(default)]
    images: Vec<MarkdownBundleImageExport>,
}

#[derive(Debug, Clone)]
struct MaterializedMarkdownBundle {
    title: String,
    markdown: String,
    bundle_relative_dir: String,
    markdown_relative_path: String,
    images_relative_dir: String,
    meta_relative_path: String,
    image_count: usize,
    source_url: Option<String>,
    author: Option<String>,
    published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SavedMarkdownBundleImageRecord {
    original_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested_file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    markdown_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    download_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SavedMarkdownBundleMeta {
    export_kind: String,
    adapter_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    skill_title: Option<String>,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    entry_url: String,
    exported_at: String,
    bundle_relative_dir: String,
    markdown_relative_path: String,
    images_relative_dir: String,
    meta_relative_path: String,
    image_count: usize,
    images: Vec<SavedMarkdownBundleImageRecord>,
}

#[derive(Debug, Clone)]
struct AdapterExecutionState {
    session_id: Option<String>,
    target_id: Option<String>,
    source_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExistingSessionTabRecord {
    id: String,
    index: i64,
    url: Option<String>,
    active: bool,
}

#[derive(Debug, Clone)]
struct ExistingSessionRecommendationContext {
    profile_key: String,
    current_url: Option<String>,
    tabs: Vec<ExistingSessionTabRecord>,
}

#[derive(Debug, Clone)]
struct SiteAdapterRecommendationCandidate {
    reason: String,
    profile_key: Option<String>,
    target_id: Option<String>,
    score: u32,
}

#[derive(Debug, Clone)]
struct SiteAdapterAttachedLaunchCandidate {
    profile_key: String,
    target_id: Option<String>,
    current_url_matches: bool,
    saved_existing_session: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SiteAdapterTransportRoute {
    ManagedCdp,
    ExistingSession,
}

const ADAPTER_HELPERS_SCRIPT: &str = r#"
const helpers = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  text: (value) => {
    const text = value?.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  },
  absoluteUrl: (value) => {
    try {
      return new URL(value, location.href).toString();
    } catch {
      return "";
    }
  },
  uniqueBy: (items, getKey) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = getKey(item);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  },
  waitFor: async (test, timeoutMs = 12000, intervalMs = 250) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = await test();
      if (value) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  },
  take: (items, limit) => items.slice(0, Math.max(1, limit)),
  number: (value, fallbackValue) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  },
  looksLikeLoginWall: () => {
    const text = (document.body?.textContent || "").slice(0, 4000);
    return /(登录|登入|sign in|log in|继续访问|验证你是人类|扫码登录)/i.test(text);
  },
};
"#;

pub fn list_site_adapters() -> Vec<SiteAdapterDefinition> {
    load_site_adapter_specs()
        .map(|adapters| {
            adapters
                .iter()
                .map(build_adapter_definition)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub fn search_site_adapters(query: &str) -> Vec<SiteAdapterDefinition> {
    let normalized = query.trim().to_ascii_lowercase();
    let Ok(adapters) = load_site_adapter_specs() else {
        return Vec::new();
    };

    adapters
        .iter()
        .filter(|spec| {
            normalized.is_empty()
                || spec.name.to_ascii_lowercase().contains(&normalized)
                || spec.domain.to_ascii_lowercase().contains(&normalized)
                || spec.description.to_ascii_lowercase().contains(&normalized)
                || spec
                    .capabilities
                    .iter()
                    .any(|value| value.to_ascii_lowercase().contains(&normalized))
        })
        .map(build_adapter_definition)
        .collect()
}

pub fn get_site_adapter(name: &str) -> Option<SiteAdapterDefinition> {
    find_site_adapter_spec(name)
        .ok()
        .flatten()
        .map(|spec| build_adapter_definition(&spec))
}

pub async fn recommend_site_adapters(
    db: &DbConnection,
    limit: Option<usize>,
) -> Result<Vec<SiteAdapterRecommendation>, String> {
    let specs = load_site_adapter_specs()?;
    let profiles = load_active_browser_profiles(db)?;
    let attached_contexts = load_existing_session_recommendation_contexts(&profiles).await;

    Ok(rank_site_adapter_recommendations(
        &specs,
        &profiles,
        &attached_contexts,
        limit,
    ))
}

pub async fn get_site_adapter_launch_readiness(
    db: &DbConnection,
    request: SiteAdapterLaunchReadinessRequest,
) -> Result<SiteAdapterLaunchReadinessResult, String> {
    let normalized_name = normalize_site_adapter_name(&request.adapter_name);
    let spec = find_site_adapter_spec(&normalized_name)?
        .ok_or_else(|| "未找到对应的站点适配器".to_string())?;

    resolve_site_adapter_launch_readiness_for_spec(
        db,
        &spec,
        request.profile_key.as_deref(),
        request.target_id.as_deref(),
    )
    .await
}

pub fn build_site_result_document_title(adapter_name: &str, custom_title: Option<&str>) -> String {
    let normalized_custom_title = custom_title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if let Some(title) = normalized_custom_title {
        return title;
    }

    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S");
    format!("站点采集 {adapter_name} {timestamp}")
}

pub fn build_site_result_document_body(
    adapter: &SiteAdapterDefinition,
    request: &RunSiteAdapterRequest,
    result: &SiteAdapterRunResult,
) -> String {
    let mut lines = vec![
        "# 站点采集结果".to_string(),
        String::new(),
        format!("- 生成时间：{}", chrono::Utc::now().to_rfc3339()),
        format!("- 适配器：{}", adapter.name),
        format!("- 站点域名：{}", adapter.domain),
        format!("- 浏览器资料：{}", result.profile_key),
        format!("- 执行状态：{}", if result.ok { "成功" } else { "失败" }),
        format!("- 入口页面：{}", result.entry_url),
    ];

    if let Some(source_kind) = adapter.source_kind.as_deref() {
        lines.push(format!("- 脚本来源：{source_kind}"));
    }
    if let Some(source_version) = adapter.source_version.as_deref() {
        lines.push(format!("- 脚本版本：{source_version}"));
    }
    if let Some(source_url) = result.source_url.as_deref() {
        lines.push(format!("- 来源页面：{source_url}"));
    }
    if let Some(error_code) = result.error_code.as_deref() {
        lines.push(format!("- 错误码：{error_code}"));
    }
    if let Some(error_message) = result.error_message.as_deref() {
        lines.push(format!("- 错误信息：{error_message}"));
    }

    lines.extend([
        String::new(),
        "## 适配器说明".to_string(),
        String::new(),
        adapter.description.clone(),
        String::new(),
        "## 执行参数".to_string(),
        String::new(),
        "```json".to_string(),
        serde_json::to_string_pretty(&request.args).unwrap_or_else(|_| request.args.to_string()),
        "```".to_string(),
        String::new(),
        "## 结构化结果".to_string(),
        String::new(),
        "```json".to_string(),
        serde_json::to_string_pretty(
            &result
                .data
                .clone()
                .unwrap_or_else(|| serde_json::json!(result)),
        )
        .unwrap_or_else(|_| {
            result
                .data
                .clone()
                .unwrap_or_else(|| serde_json::json!(result))
                .to_string()
        }),
        "```".to_string(),
    ]);

    if let Some(auth_hint) = result.auth_hint.as_deref() {
        lines.extend([
            String::new(),
            "## 登录提示".to_string(),
            String::new(),
            auth_hint.to_string(),
        ]);
    }

    lines.join("\n")
}

fn block_on_site_capability_future<F, T>(future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        return tokio::task::block_in_place(|| handle.block_on(future));
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .map_err(|error| format!("创建站点保存 Runtime 失败: {error}"))?;
    runtime.block_on(future)
}

fn trim_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_markdown_bundle_export(
    result: &SiteAdapterRunResult,
) -> Result<Option<MarkdownBundleExport>, String> {
    let Some(data) = result.data.as_ref() else {
        return Ok(None);
    };
    let Some(export_kind) = data.get("export_kind").and_then(Value::as_str) else {
        return Ok(None);
    };
    if export_kind != MARKDOWN_BUNDLE_EXPORT_KIND {
        return Ok(None);
    }

    let export: MarkdownBundleExport = serde_json::from_value(data.clone())
        .map_err(|error| format!("解析 markdown bundle 结果失败: {error}"))?;
    if export.markdown.trim().is_empty() {
        return Err("markdown bundle 结果缺少正文 markdown".to_string());
    }

    Ok(Some(export))
}

fn sanitize_export_segment(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    let mut last_was_dash = false;

    for ch in value.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if matches!(ch, '/' | '\\' | '-' | '_' | ' ' | '.') {
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
        "export".to_string()
    } else {
        trimmed.to_string()
    }
}

fn extract_last_path_segment(raw_url: Option<&str>) -> Option<String> {
    let url = Url::parse(raw_url?).ok()?;
    url.path_segments()
        .and_then(|mut segments| segments.next_back().map(ToString::to_string))
        .and_then(|value| trim_optional_text(Some(value.as_str())))
}

fn resolve_markdown_bundle_title(
    request: &RunSiteAdapterRequest,
    adapter: &SiteAdapterDefinition,
    export: &MarkdownBundleExport,
) -> String {
    trim_optional_text(request.save_title.as_deref())
        .or_else(|| trim_optional_text(export.title.as_deref()))
        .or_else(|| trim_optional_text(request.skill_title.as_deref()))
        .unwrap_or_else(|| build_site_result_document_title(&adapter.name, None))
}

fn resolve_markdown_bundle_slug(title: &str, export: &MarkdownBundleExport) -> String {
    let title_slug = sanitize_export_segment(title);
    if title_slug != "export" {
        return title_slug;
    }

    extract_last_path_segment(export.source_url.as_deref())
        .map(|value| sanitize_export_segment(&value))
        .filter(|value| value != "export")
        .unwrap_or_else(|| "article-export".to_string())
}

fn first_non_empty_markdown_line(value: &str) -> Option<&str> {
    value.lines().map(str::trim).find(|line| !line.is_empty())
}

fn markdown_heading_matches_title(markdown: &str, title: &str) -> bool {
    let normalized_title = title.trim();
    if normalized_title.is_empty() {
        return false;
    }

    let Some(first_line) = first_non_empty_markdown_line(markdown) else {
        return false;
    };
    if first_line == normalized_title {
        return true;
    }

    first_line
        .strip_prefix('#')
        .map(str::trim)
        .is_some_and(|line| line == normalized_title)
}

fn build_markdown_bundle_document_body(
    title: &str,
    export: &MarkdownBundleExport,
    markdown_body: &str,
) -> String {
    let mut lines = Vec::new();
    let normalized_body = markdown_body.trim();

    if !markdown_heading_matches_title(normalized_body, title) {
        lines.push(format!("# {title}"));
        lines.push(String::new());
    }

    let mut metadata_lines = Vec::new();
    if let Some(author) = trim_optional_text(export.author.as_deref()) {
        metadata_lines.push(format!("> 作者：{author}"));
    }
    if let Some(published_at) = trim_optional_text(export.published_at.as_deref()) {
        metadata_lines.push(format!("> 发布时间：{published_at}"));
    }
    if let Some(source_url) = trim_optional_text(export.source_url.as_deref()) {
        metadata_lines.push(format!("> 原文链接：{source_url}"));
    }
    if !metadata_lines.is_empty() {
        lines.extend(metadata_lines);
        lines.push(String::new());
    }

    lines.push(normalized_body.to_string());
    lines.join("\n")
}

fn normalize_bundle_file_name_segment(value: &str) -> Option<String> {
    let mut sanitized = String::with_capacity(value.len());
    let mut last_was_dash = false;

    for ch in value.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if matches!(ch, '-' | '_' | ' ') {
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
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_extension_from_file_name(value: &str) -> Option<String> {
    Path::new(value)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 12)
        .map(|value| value.to_ascii_lowercase())
}

fn extract_extension_from_url(raw_url: &str) -> Option<String> {
    let url = Url::parse(raw_url).ok()?;
    if let Some(format) = url
        .query_pairs()
        .find_map(|(key, value)| (key == "format").then_some(value.into_owned()))
        .and_then(|value| trim_optional_text(Some(value.as_str())))
    {
        return Some(format.to_ascii_lowercase());
    }

    url.path_segments()
        .and_then(|mut segments| segments.next_back().map(ToString::to_string))
        .and_then(|value| extract_extension_from_file_name(&value))
}

fn extension_from_content_type(content_type: Option<&str>) -> Option<&'static str> {
    match content_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
    {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn build_markdown_bundle_image_file_name(
    index: usize,
    image: &MarkdownBundleImageExport,
    content_type: Option<&str>,
    used_file_names: &mut HashSet<String>,
) -> String {
    let suggested = trim_optional_text(image.suggested_file_name.as_deref());
    let suggested_stem = suggested
        .as_deref()
        .and_then(|value| Path::new(value).file_stem().and_then(|stem| stem.to_str()))
        .and_then(normalize_bundle_file_name_segment);
    let fallback_stem = extract_last_path_segment(Some(image.url.as_str()))
        .as_deref()
        .and_then(|value| Path::new(value).file_stem().and_then(|stem| stem.to_str()))
        .and_then(normalize_bundle_file_name_segment);
    let stem = suggested_stem
        .or(fallback_stem)
        .unwrap_or_else(|| format!("image-{}", index + 1));
    let extension = suggested
        .as_deref()
        .and_then(extract_extension_from_file_name)
        .or_else(|| extract_extension_from_url(&image.url))
        .or_else(|| extension_from_content_type(content_type).map(ToString::to_string))
        .unwrap_or_else(|| "jpg".to_string());

    let mut file_name = format!("{stem}.{extension}");
    if used_file_names.insert(file_name.clone()) {
        return file_name;
    }

    let mut duplicate_index = 2usize;
    loop {
        file_name = format!("{stem}-{duplicate_index}.{extension}");
        if used_file_names.insert(file_name.clone()) {
            return file_name;
        }
        duplicate_index += 1;
    }
}

fn path_to_forward_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn relative_path_from(base: &Path, target: &Path) -> Result<String, String> {
    let relative = target
        .strip_prefix(base)
        .map_err(|error| format!("无法构建相对路径: {error}"))?;
    Ok(path_to_forward_slashes(relative))
}

fn allocate_markdown_bundle_export_dir(base_dir: &Path, slug: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(base_dir)
        .map_err(|error| format!("创建导出目录失败 {}: {error}", base_dir.display()))?;

    for index in 1usize.. {
        let candidate = if index == 1 {
            base_dir.join(slug)
        } else {
            base_dir.join(format!("{slug}-{index}"))
        };
        if candidate.exists() {
            continue;
        }
        fs::create_dir_all(&candidate)
            .map_err(|error| format!("创建导出资源包失败 {}: {error}", candidate.display()))?;
        return Ok(candidate);
    }

    Err("无法创建唯一的导出目录".to_string())
}

async fn download_markdown_bundle_image(
    client: &reqwest::Client,
    image_url: &str,
) -> Result<(Vec<u8>, Option<String>), String> {
    if image_url.starts_with("data:") {
        return decode_markdown_bundle_data_url(image_url);
    }

    let response = client
        .get(image_url)
        .send()
        .await
        .map_err(|error| format!("下载图片失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载图片失败: HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取图片内容失败: {error}"))?;

    Ok((bytes.to_vec(), content_type))
}

fn decode_markdown_bundle_data_url(image_url: &str) -> Result<(Vec<u8>, Option<String>), String> {
    let (header, payload) = image_url
        .split_once(',')
        .ok_or_else(|| "data URL 格式不正确".to_string())?;
    if !header.starts_with("data:") {
        return Err("仅支持 http(s) 或 data URL".to_string());
    }

    let meta = &header[5..];
    let mut mime_type: Option<String> = None;
    let mut is_base64 = false;
    if !meta.is_empty() {
        let mut parts = meta.split(';');
        if let Some(first) = parts.next() {
            mime_type = trim_optional_text(Some(first));
        }
        is_base64 = parts.any(|part| part.eq_ignore_ascii_case("base64"));
    }
    if !is_base64 {
        return Err("暂不支持非 base64 的 data URL".to_string());
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|error| format!("解码 data URL 失败: {error}"))?;
    Ok((decoded, mime_type))
}

fn build_markdown_bundle_metadata_map(bundle: &MaterializedMarkdownBundle) -> Map<String, Value> {
    let mut metadata = Map::new();
    metadata.insert(
        "siteAdapterExportKind".to_string(),
        Value::String(MARKDOWN_BUNDLE_EXPORT_KIND.to_string()),
    );
    metadata.insert(
        "siteAdapterBundleRelativeDir".to_string(),
        Value::String(bundle.bundle_relative_dir.clone()),
    );
    metadata.insert(
        "siteAdapterBundleMarkdownPath".to_string(),
        Value::String(bundle.markdown_relative_path.clone()),
    );
    metadata.insert(
        "siteAdapterBundleImagesDir".to_string(),
        Value::String(bundle.images_relative_dir.clone()),
    );
    metadata.insert(
        "siteAdapterBundleMetaPath".to_string(),
        Value::String(bundle.meta_relative_path.clone()),
    );
    metadata.insert(
        "siteAdapterImageCount".to_string(),
        Value::Number(serde_json::Number::from(bundle.image_count as u64)),
    );
    metadata.insert(
        "siteAdapterAuthor".to_string(),
        bundle
            .author
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata.insert(
        "siteAdapterPublishedAt".to_string(),
        bundle
            .published_at
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata.insert(
        "siteAdapterSourceUrl".to_string(),
        bundle
            .source_url
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata
}

fn resolve_workspace_root_path(db: &DbConnection, project_id: &str) -> Option<String> {
    WorkspaceManager::new(db.clone())
        .get(&project_id.to_string())
        .ok()
        .flatten()
        .map(|workspace| workspace.root_path.to_string_lossy().to_string())
}

fn build_saved_site_adapter_content(
    db: &DbConnection,
    content_id: &str,
    project_id: &str,
    title: &str,
    bundle: Option<&MaterializedMarkdownBundle>,
) -> SavedSiteAdapterContent {
    SavedSiteAdapterContent {
        content_id: content_id.to_string(),
        project_id: project_id.to_string(),
        title: title.to_string(),
        project_root_path: resolve_workspace_root_path(db, project_id),
        bundle_relative_dir: bundle.map(|value| value.bundle_relative_dir.clone()),
        markdown_relative_path: bundle.map(|value| value.markdown_relative_path.clone()),
        images_relative_dir: bundle.map(|value| value.images_relative_dir.clone()),
        meta_relative_path: bundle.map(|value| value.meta_relative_path.clone()),
        image_count: bundle.map(|value| value.image_count),
    }
}

fn materialize_markdown_bundle(
    db: &DbConnection,
    project_id: &str,
    adapter: &SiteAdapterDefinition,
    request: &RunSiteAdapterRequest,
    result: &SiteAdapterRunResult,
    export: &MarkdownBundleExport,
) -> Result<MaterializedMarkdownBundle, String> {
    let workspace = WorkspaceManager::new(db.clone())
        .get(&project_id.to_string())?
        .ok_or_else(|| format!("未找到目标项目: {project_id}"))?;
    let workspace_root = workspace.root_path;
    fs::create_dir_all(&workspace_root)
        .map_err(|error| format!("创建项目目录失败 {}: {error}", workspace_root.display()))?;

    let bundle_title = resolve_markdown_bundle_title(request, adapter, export);
    let bundle_slug = resolve_markdown_bundle_slug(&bundle_title, export);
    let adapter_dir = workspace_root
        .join(SITE_EXPORTS_ROOT_DIR)
        .join(sanitize_export_segment(&adapter.name));
    let bundle_dir = allocate_markdown_bundle_export_dir(&adapter_dir, &bundle_slug)?;
    let images_dir = bundle_dir.join(MARKDOWN_BUNDLE_IMAGE_DIR);
    fs::create_dir_all(&images_dir)
        .map_err(|error| format!("创建图片目录失败 {}: {error}", images_dir.display()))?;

    let source_url = trim_optional_text(export.source_url.as_deref())
        .or_else(|| trim_optional_text(result.source_url.as_deref()));
    let author = trim_optional_text(export.author.as_deref());
    let published_at = trim_optional_text(export.published_at.as_deref());

    let adapter_name = adapter.name.clone();
    let skill_title = trim_optional_text(request.skill_title.as_deref());
    let original_title = trim_optional_text(export.title.as_deref());
    let entry_url = result.entry_url.clone();

    let (rewritten_markdown, image_records) = block_on_site_capability_future(async {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 LimeSiteAdapter/1.0")
            .build()
            .map_err(|error| format!("创建图片下载客户端失败: {error}"))?;
        let mut markdown = export.markdown.trim().to_string();
        let mut records = Vec::new();
        let mut used_file_names = HashSet::new();

        for (index, image) in export.images.iter().enumerate() {
            let image_url = image.url.trim();
            if image_url.is_empty() {
                continue;
            }

            match download_markdown_bundle_image(&client, image_url).await {
                Ok((bytes, content_type)) => {
                    let file_name = build_markdown_bundle_image_file_name(
                        index,
                        image,
                        content_type.as_deref(),
                        &mut used_file_names,
                    );
                    let image_path = images_dir.join(&file_name);
                    fs::write(&image_path, bytes).map_err(|error| {
                        format!("写入图片失败 {}: {error}", image_path.display())
                    })?;
                    let markdown_path = path_to_forward_slashes(
                        Path::new(MARKDOWN_BUNDLE_IMAGE_DIR)
                            .join(&file_name)
                            .as_path(),
                    );
                    let project_relative_path = relative_path_from(&workspace_root, &image_path)?;
                    markdown = markdown.replace(image_url, &markdown_path);
                    records.push(SavedMarkdownBundleImageRecord {
                        original_url: image_url.to_string(),
                        alt: trim_optional_text(image.alt.as_deref()),
                        suggested_file_name: trim_optional_text(
                            image.suggested_file_name.as_deref(),
                        ),
                        markdown_path: Some(markdown_path),
                        project_relative_path: Some(project_relative_path),
                        download_error: None,
                    });
                }
                Err(error) => {
                    records.push(SavedMarkdownBundleImageRecord {
                        original_url: image_url.to_string(),
                        alt: trim_optional_text(image.alt.as_deref()),
                        suggested_file_name: trim_optional_text(
                            image.suggested_file_name.as_deref(),
                        ),
                        markdown_path: None,
                        project_relative_path: None,
                        download_error: Some(error),
                    });
                }
            }
        }

        Ok((markdown, records))
    })?;

    let final_markdown =
        build_markdown_bundle_document_body(&bundle_title, export, &rewritten_markdown);
    let markdown_path = bundle_dir.join("index.md");
    fs::write(&markdown_path, &final_markdown)
        .map_err(|error| format!("写入 Markdown 失败 {}: {error}", markdown_path.display()))?;
    let markdown_relative_path = relative_path_from(&workspace_root, &markdown_path)?;
    let bundle_relative_dir = relative_path_from(&workspace_root, &bundle_dir)?;
    let images_relative_dir = relative_path_from(&workspace_root, &images_dir)?;
    let meta_path = bundle_dir.join("meta.json");
    let meta_relative_path = relative_path_from(&workspace_root, &meta_path)?;

    let metadata = SavedMarkdownBundleMeta {
        export_kind: MARKDOWN_BUNDLE_EXPORT_KIND.to_string(),
        adapter_name,
        skill_title,
        title: bundle_title.clone(),
        original_title,
        source_url: source_url.clone(),
        author: author.clone(),
        published_at: published_at.clone(),
        entry_url,
        exported_at: chrono::Utc::now().to_rfc3339(),
        bundle_relative_dir: bundle_relative_dir.clone(),
        markdown_relative_path: markdown_relative_path.clone(),
        images_relative_dir: images_relative_dir.clone(),
        meta_relative_path: meta_relative_path.clone(),
        image_count: image_records
            .iter()
            .filter(|record| record.project_relative_path.is_some())
            .count(),
        images: image_records,
    };
    let metadata_bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| format!("序列化导出元数据失败: {error}"))?;
    fs::write(&meta_path, metadata_bytes)
        .map_err(|error| format!("写入导出元数据失败 {}: {error}", meta_path.display()))?;

    Ok(MaterializedMarkdownBundle {
        title: bundle_title,
        markdown: final_markdown,
        bundle_relative_dir,
        markdown_relative_path,
        images_relative_dir,
        meta_relative_path,
        image_count: metadata.image_count,
        source_url,
        author,
        published_at,
    })
}

pub fn save_site_result_to_project(
    db: &DbConnection,
    project_id: &str,
    save_title: Option<&str>,
    adapter: &SiteAdapterDefinition,
    request: &RunSiteAdapterRequest,
    result: &SiteAdapterRunResult,
) -> Result<SavedSiteAdapterContent, String> {
    let normalized_project_id = project_id.trim();
    if normalized_project_id.is_empty() {
        return Err("project_id 不能为空".to_string());
    }

    if let Some(export) = parse_markdown_bundle_export(result)? {
        let mut request_with_save_title = request.clone();
        if let Some(title) = trim_optional_text(save_title) {
            request_with_save_title.save_title = Some(title);
        }
        let bundle = materialize_markdown_bundle(
            db,
            normalized_project_id,
            adapter,
            &request_with_save_title,
            result,
            &export,
        )?;
        let mut metadata = build_site_result_metadata_map(adapter, result, true);
        metadata.extend(build_markdown_bundle_metadata_map(&bundle));
        let manager = ContentManager::new(db.clone());
        let content = manager
            .create(ContentCreateRequest {
                project_id: normalized_project_id.to_string(),
                title: bundle.title.clone(),
                content_type: Some(ContentType::Document),
                order: None,
                body: Some(bundle.markdown.clone()),
                metadata: Some(Value::Object(metadata)),
            })
            .map_err(|error| format!("保存 Markdown 资源包到项目失败: {error}"))?;

        return Ok(build_saved_site_adapter_content(
            db,
            &content.id,
            &content.project_id,
            &content.title,
            Some(&bundle),
        ));
    }

    let manager = ContentManager::new(db.clone());
    let title = build_site_result_document_title(&adapter.name, save_title);
    let body = build_site_result_document_body(adapter, request, result);
    let metadata = Value::Object(build_site_result_metadata_map(adapter, result, true));
    let content = manager
        .create(ContentCreateRequest {
            project_id: normalized_project_id.to_string(),
            title: title.clone(),
            content_type: Some(ContentType::Document),
            order: None,
            body: Some(body),
            metadata: Some(metadata),
        })
        .map_err(|error| format!("保存站点结果到项目失败: {error}"))?;

    Ok(build_saved_site_adapter_content(
        db,
        &content.id,
        &content.project_id,
        &title,
        None,
    ))
}

pub fn save_site_result_to_content(
    db: &DbConnection,
    content_id: &str,
    adapter: &SiteAdapterDefinition,
    request: &RunSiteAdapterRequest,
    result: &SiteAdapterRunResult,
) -> Result<SavedSiteAdapterContent, String> {
    let normalized_content_id = content_id.trim();
    if normalized_content_id.is_empty() {
        return Err("content_id 不能为空".to_string());
    }

    let manager = ContentManager::new(db.clone());
    let Some(existing_content) = manager.get(&normalized_content_id.to_string())? else {
        return Err(format!("未找到要写回的内容: {normalized_content_id}"));
    };

    let mut metadata = existing_content
        .metadata
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    metadata.extend(build_site_result_metadata_map(adapter, result, false));
    if let Some(export) = parse_markdown_bundle_export(result)? {
        let bundle = materialize_markdown_bundle(
            db,
            &existing_content.project_id,
            adapter,
            request,
            result,
            &export,
        )?;
        metadata.extend(build_markdown_bundle_metadata_map(&bundle));
        let updated = manager.update(
            &normalized_content_id.to_string(),
            ContentUpdateRequest {
                body: Some(bundle.markdown.clone()),
                metadata: Some(Value::Object(metadata)),
                ..Default::default()
            },
        )?;

        return Ok(build_saved_site_adapter_content(
            db,
            &updated.id,
            &updated.project_id,
            &updated.title,
            Some(&bundle),
        ));
    }

    let body = build_site_result_document_body(adapter, request, result);

    let updated = manager.update(
        &normalized_content_id.to_string(),
        ContentUpdateRequest {
            body: Some(body),
            metadata: Some(Value::Object(metadata)),
            ..Default::default()
        },
    )?;

    Ok(build_saved_site_adapter_content(
        db,
        &updated.id,
        &updated.project_id,
        &updated.title,
        None,
    ))
}

pub fn save_existing_site_result_to_project(
    db: &DbConnection,
    request: SaveSiteAdapterResultRequest,
) -> Result<SavedSiteAdapterContent, String> {
    if !request.result.ok {
        return Err("仅支持保存成功的站点结果".to_string());
    }

    let adapter_name = normalize_site_adapter_name(&request.run_request.adapter_name);
    let adapter =
        get_site_adapter(&adapter_name).ok_or_else(|| "未找到对应的站点适配器".to_string())?;
    if let Some(content_id) = normalize_optional_content_id(request.content_id.as_deref()) {
        return save_site_result_to_content(
            db,
            &content_id,
            &adapter,
            &request.run_request,
            &request.result,
        );
    }

    let project_id = normalize_optional_project_id(request.project_id.as_deref())
        .ok_or_else(|| "project_id 或 content_id 至少提供一个".to_string())?;
    save_site_result_to_project(
        db,
        &project_id,
        request.save_title.as_deref(),
        &adapter,
        &request.run_request,
        &request.result,
    )
}

pub async fn run_site_adapter_with_optional_save(
    db: &DbConnection,
    request: RunSiteAdapterRequest,
) -> SiteAdapterRunResult {
    let result = run_site_adapter(db, request.clone()).await;
    attach_requested_site_result_save(db, &request, result)
}

pub async fn run_site_adapter(
    db: &DbConnection,
    request: RunSiteAdapterRequest,
) -> SiteAdapterRunResult {
    let normalized_name = normalize_site_adapter_name(&request.adapter_name);
    let requested_profile_key = resolve_requested_profile_key(request.profile_key.as_deref());
    let spec = match find_site_adapter_spec(&normalized_name) {
        Ok(Some(spec)) => spec,
        Ok(None) => {
            return SiteAdapterRunResult {
                ok: false,
                adapter: normalized_name,
                domain: String::new(),
                profile_key: requested_profile_key.clone(),
                session_id: None,
                target_id: None,
                entry_url: String::new(),
                source_url: None,
                data: None,
                error_code: Some("adapter_not_found".to_string()),
                error_message: Some("未找到对应的站点适配器".to_string()),
                auth_hint: None,
                report_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            };
        }
        Err(error) => {
            return SiteAdapterRunResult {
                ok: false,
                adapter: normalized_name,
                domain: String::new(),
                profile_key: requested_profile_key.clone(),
                session_id: None,
                target_id: None,
                entry_url: String::new(),
                source_url: None,
                data: None,
                error_code: Some("internal_error".to_string()),
                error_message: Some(error),
                auth_hint: None,
                report_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            };
        }
    };

    let args = match normalize_adapter_args(request.args) {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                &spec,
                requested_profile_key.clone(),
                None,
                None,
                String::new(),
                "invalid_args",
                &error,
            );
        }
    };

    if let Err(error) = validate_adapter_args(&spec, &args) {
        return build_error_result(
            &spec,
            requested_profile_key.clone(),
            None,
            None,
            String::new(),
            "invalid_args",
            &error,
        );
    }

    let entry_url = match build_entry_url(&spec, &args) {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                &spec,
                requested_profile_key.clone(),
                None,
                None,
                String::new(),
                "invalid_args",
                &error,
            );
        }
    };

    let attached_session_readiness = if request.require_attached_session.unwrap_or(false) {
        match resolve_site_adapter_launch_readiness_for_spec(
            db,
            &spec,
            request.profile_key.as_deref(),
            request.target_id.as_deref(),
        )
        .await
        {
            Ok(result) => {
                if result.status != SiteAdapterLaunchReadinessStatus::Ready {
                    return build_error_result(
                        &spec,
                        result
                            .profile_key
                            .clone()
                            .unwrap_or_else(|| requested_profile_key.clone()),
                        None,
                        result.target_id.clone(),
                        entry_url,
                        "attached_session_required",
                        &result.message,
                    );
                }
                Some(result)
            }
            Err(error) => {
                return build_error_result(
                    &spec,
                    requested_profile_key.clone(),
                    None,
                    None,
                    entry_url,
                    "internal_error",
                    &error,
                );
            }
        }
    } else {
        None
    };

    let resolved_request_profile_key = attached_session_readiness
        .as_ref()
        .and_then(|result| result.profile_key.as_deref())
        .or(request.profile_key.as_deref());
    let profile_key =
        match resolve_effective_profile_key(db, resolved_request_profile_key, &spec.domain).await {
            Ok(value) => value,
            Err(error) => {
                return build_error_result(
                    &spec,
                    requested_profile_key,
                    None,
                    None,
                    entry_url,
                    "internal_error",
                    &error,
                );
            }
        };

    let transport_route = match resolve_transport_route(db, &profile_key).await {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                &spec,
                profile_key,
                None,
                None,
                entry_url,
                "internal_error",
                &error,
            );
        }
    };
    if request.require_attached_session.unwrap_or(false)
        && transport_route != SiteAdapterTransportRoute::ExistingSession
    {
        return build_error_result(
            &spec,
            profile_key,
            None,
            attached_session_readiness
                .as_ref()
                .and_then(|result| result.target_id.clone()),
            entry_url,
            "attached_session_required",
            "当前执行链路没有附着到真实浏览器会话，请先去浏览器工作台连接目标站点后重试。",
        );
    }

    let timeout_ms = normalize_timeout_ms(request.timeout_ms);
    let resolved_target_id = attached_session_readiness
        .and_then(|result| result.target_id)
        .or_else(|| normalize_requested_target_id(request.target_id.as_deref()));

    match transport_route {
        SiteAdapterTransportRoute::ExistingSession => {
            run_existing_session_adapter(
                &spec,
                profile_key,
                resolved_target_id,
                entry_url,
                timeout_ms,
                args,
            )
            .await
        }
        SiteAdapterTransportRoute::ManagedCdp => {
            let wrapped_script = match build_wrapped_adapter_script(&spec.script, &args) {
                Ok(value) => value,
                Err(error) => {
                    return build_error_result(
                        &spec,
                        profile_key,
                        None,
                        None,
                        entry_url,
                        "internal_error",
                        &format!("构造适配器脚本失败: {error}"),
                    );
                }
            };
            run_managed_cdp_adapter(
                db,
                &spec,
                profile_key,
                resolved_target_id,
                entry_url,
                timeout_ms,
                wrapped_script,
            )
            .await
        }
    }
}

fn build_adapter_definition(spec: &SiteAdapterSpec) -> SiteAdapterDefinition {
    SiteAdapterDefinition {
        name: spec.name.clone(),
        domain: spec.domain.clone(),
        description: spec.description.clone(),
        read_only: spec.read_only,
        capabilities: spec.capabilities.clone(),
        input_schema: build_input_schema(&spec.args),
        example_args: build_example_args(&spec.args),
        example: spec.example.clone(),
        auth_hint: spec.auth_hint.clone(),
        source_kind: Some(spec.source_kind.as_str().to_string()),
        source_version: spec.source_version.clone(),
    }
}

fn build_input_schema(
    args: &[crate::services::site_adapter_registry::SiteAdapterArgSpec],
) -> Value {
    let mut required = Vec::new();
    let mut properties = Map::new();
    for arg in args {
        if arg.required {
            required.push(Value::String(arg.name.clone()));
        }
        let mut property = Map::new();
        property.insert(
            "type".to_string(),
            Value::String(arg.arg_type.schema_type().to_string()),
        );
        property.insert(
            "description".to_string(),
            Value::String(arg.description.clone()),
        );
        if let Some(example) = arg.example.clone() {
            property.insert("example".to_string(), example);
        }
        properties.insert(arg.name.clone(), Value::Object(property));
    }

    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": true,
    })
}

fn build_example_args(
    args: &[crate::services::site_adapter_registry::SiteAdapterArgSpec],
) -> Value {
    let mut object = Map::new();
    for arg in args {
        if let Some(example) = arg.example.clone() {
            object.insert(arg.name.clone(), example);
        }
    }
    Value::Object(object)
}

fn normalize_adapter_args(value: Value) -> Result<Map<String, Value>, String> {
    match value {
        Value::Null => Ok(Map::new()),
        Value::Object(map) => Ok(map),
        _ => Err("args 必须是 JSON object".to_string()),
    }
}

fn validate_adapter_args(spec: &SiteAdapterSpec, args: &Map<String, Value>) -> Result<(), String> {
    for arg in &spec.args {
        let value = args.get(&arg.name);
        if arg.required && value.is_none() {
            return Err(format!("缺少必填参数: {}", arg.name));
        }
        if let Some(value) = value {
            let valid = match arg.arg_type {
                SiteAdapterArgType::String => value.is_string(),
                SiteAdapterArgType::Integer => value.as_i64().is_some() || value.as_u64().is_some(),
            };
            if !valid {
                return Err(format!(
                    "参数 {} 类型不正确，期望 {}",
                    arg.name,
                    arg.arg_type.schema_type()
                ));
            }
        }
    }
    Ok(())
}

fn normalize_requested_profile_key(profile_key: Option<&str>) -> Option<String> {
    profile_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_requested_target_id(target_id: Option<&str>) -> Option<String> {
    target_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn resolve_requested_profile_key(profile_key: Option<&str>) -> String {
    normalize_requested_profile_key(profile_key).unwrap_or_else(|| DEFAULT_PROFILE_KEY.to_string())
}

fn load_active_browser_profiles(db: &DbConnection) -> Result<Vec<BrowserProfileRecord>, String> {
    let conn = lock_db(db)?;
    BrowserProfileDao::list(&conn, false).map_err(|error| format!("读取浏览器资料失败: {error}"))
}

fn site_scope_matches_domain(site_scope: Option<&str>, adapter_domain: &str) -> bool {
    let Some(scope) = site_scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
    else {
        return false;
    };
    let normalized_domain = adapter_domain.trim().to_ascii_lowercase();
    normalized_domain == scope
        || normalized_domain.ends_with(&format!(".{scope}"))
        || scope.ends_with(&format!(".{normalized_domain}"))
}

fn select_preferred_site_profile_key(
    profiles: &[BrowserProfileRecord],
    adapter_domain: &str,
    observer_matching_profile_keys: &HashSet<String>,
    attached_profile_keys: &HashSet<String>,
) -> Option<String> {
    let attached_existing_session_matching_page = profiles.iter().find(|profile| {
        profile.transport_kind == BrowserProfileTransportKind::ExistingSession
            && observer_matching_profile_keys.contains(&profile.profile_key)
    });
    if let Some(profile) = attached_existing_session_matching_page {
        return Some(profile.profile_key.clone());
    }

    let attached_existing_session_matching_scope = profiles.iter().find(|profile| {
        profile.transport_kind == BrowserProfileTransportKind::ExistingSession
            && attached_profile_keys.contains(&profile.profile_key)
            && site_scope_matches_domain(profile.site_scope.as_deref(), adapter_domain)
    });
    if let Some(profile) = attached_existing_session_matching_scope {
        return Some(profile.profile_key.clone());
    }

    let attached_existing_session_generic = profiles.iter().find(|profile| {
        profile.transport_kind == BrowserProfileTransportKind::ExistingSession
            && attached_profile_keys.contains(&profile.profile_key)
            && profile
                .site_scope
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
    });
    if let Some(profile) = attached_existing_session_generic {
        return Some(profile.profile_key.clone());
    }

    let managed_matching_profile = profiles.iter().find(|profile| {
        profile.transport_kind == BrowserProfileTransportKind::ManagedCdp
            && site_scope_matches_domain(profile.site_scope.as_deref(), adapter_domain)
    });
    if let Some(profile) = managed_matching_profile {
        return Some(profile.profile_key.clone());
    }

    let any_matching_profile = profiles
        .iter()
        .find(|profile| site_scope_matches_domain(profile.site_scope.as_deref(), adapter_domain));
    if let Some(profile) = any_matching_profile {
        return Some(profile.profile_key.clone());
    }

    let default_profile = profiles
        .iter()
        .find(|profile| profile.profile_key == DEFAULT_PROFILE_KEY);
    if let Some(profile) = default_profile {
        return Some(profile.profile_key.clone());
    }

    let managed_profile = profiles
        .iter()
        .find(|profile| profile.transport_kind == BrowserProfileTransportKind::ManagedCdp);
    if let Some(profile) = managed_profile {
        return Some(profile.profile_key.clone());
    }

    profiles.first().map(|profile| profile.profile_key.clone())
}

fn observer_matches_site_domain(
    observer: &ChromeBridgeObserverSnapshot,
    adapter_domain: &str,
) -> bool {
    observer
        .last_page_info
        .as_ref()
        .and_then(|page| page.url.as_deref())
        .and_then(parse_url_host)
        .is_some_and(|host| site_scope_matches_domain(Some(host.as_str()), adapter_domain))
}

fn select_observer_only_profile_key(
    profiles: &[BrowserProfileRecord],
    observers: &[ChromeBridgeObserverSnapshot],
    adapter_domain: &str,
) -> Option<String> {
    let registered_profile_keys = profiles
        .iter()
        .map(|profile| profile.profile_key.as_str())
        .collect::<HashSet<_>>();

    observers
        .iter()
        .filter(|observer| !registered_profile_keys.contains(observer.profile_key.as_str()))
        .find(|observer| observer_matches_site_domain(observer, adapter_domain))
        .or_else(|| {
            observers
                .iter()
                .filter(|observer| !registered_profile_keys.contains(observer.profile_key.as_str()))
                .next()
        })
        .map(|observer| observer.profile_key.clone())
}

fn select_auto_profile_key(
    profiles: &[BrowserProfileRecord],
    observers: &[ChromeBridgeObserverSnapshot],
    adapter_domain: &str,
) -> Option<String> {
    let observer_matching_profile_keys = observers
        .iter()
        .filter(|observer| observer_matches_site_domain(observer, adapter_domain))
        .map(|observer| observer.profile_key.clone())
        .collect::<HashSet<_>>();
    let attached_profile_keys = observers
        .iter()
        .map(|observer| observer.profile_key.clone())
        .collect::<HashSet<_>>();

    let selected_saved_profile_key = select_preferred_site_profile_key(
        profiles,
        adapter_domain,
        &observer_matching_profile_keys,
        &attached_profile_keys,
    );
    let observer_only_profile_key =
        select_observer_only_profile_key(profiles, observers, adapter_domain);

    let selected_saved_transport = selected_saved_profile_key
        .as_deref()
        .and_then(|profile_key| {
            profiles
                .iter()
                .find(|profile| profile.profile_key == profile_key)
                .map(|profile| profile.transport_kind)
        });

    if observer_only_profile_key.is_some()
        && selected_saved_transport != Some(BrowserProfileTransportKind::ExistingSession)
    {
        return observer_only_profile_key;
    }

    selected_saved_profile_key
}

async fn resolve_effective_profile_key(
    db: &DbConnection,
    profile_key: Option<&str>,
    adapter_domain: &str,
) -> Result<String, String> {
    if let Some(profile_key) = normalize_requested_profile_key(profile_key) {
        return Ok(profile_key);
    }

    let profiles = load_active_browser_profiles(db)?;
    let observers = chrome_bridge::chrome_bridge_hub()
        .get_status_snapshot()
        .await
        .observers
        .into_iter()
        .collect::<Vec<_>>();

    Ok(
        select_auto_profile_key(&profiles, &observers, adapter_domain)
            .unwrap_or_else(|| DEFAULT_PROFILE_KEY.to_string()),
    )
}

fn build_site_adapter_launch_readiness_result(
    status: SiteAdapterLaunchReadinessStatus,
    spec: &SiteAdapterSpec,
    profile_key: Option<String>,
    target_id: Option<String>,
    message: impl Into<String>,
) -> SiteAdapterLaunchReadinessResult {
    let report_hint = match status {
        SiteAdapterLaunchReadinessStatus::Ready => None,
        SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime => {
            build_site_adapter_report_hint("attached_session_required")
        }
    };

    SiteAdapterLaunchReadinessResult {
        status,
        adapter: spec.name.clone(),
        domain: spec.domain.clone(),
        profile_key,
        target_id,
        message: message.into(),
        report_hint,
    }
}

fn build_site_adapter_attached_session_required_message(spec: &SiteAdapterSpec) -> String {
    format!(
        "当前没有检测到已附着到真实浏览器的 {} 页面，请先去浏览器工作台连接浏览器并打开目标页面。",
        spec.domain
    )
}

fn build_site_adapter_attached_session_missing_target_message(spec: &SiteAdapterSpec) -> String {
    format!(
        "已检测到真实浏览器会话，但当前没有命中 {} 的目标标签页；请先打开目标页面后再回到 Claw 执行。",
        spec.domain
    )
}

fn build_site_adapter_attached_session_auto_open_message(spec: &SiteAdapterSpec) -> String {
    format!(
        "已检测到真实浏览器会话，执行时会自动打开 {} 的目标页面并继续运行。",
        spec.domain
    )
}

fn build_site_adapter_attached_session_ready_message(spec: &SiteAdapterSpec) -> String {
    format!(
        "已检测到 {} 的真实浏览器页面，Claw 可以直接复用当前会话执行。",
        spec.domain
    )
}

async fn resolve_site_adapter_launch_readiness_for_spec(
    db: &DbConnection,
    spec: &SiteAdapterSpec,
    profile_key: Option<&str>,
    target_id: Option<&str>,
) -> Result<SiteAdapterLaunchReadinessResult, String> {
    let normalized_profile_key = normalize_requested_profile_key(profile_key);
    let normalized_target_id = normalize_requested_target_id(target_id);
    let profiles = load_active_browser_profiles(db)?;
    let status_snapshot = chrome_bridge::chrome_bridge_hub()
        .get_status_snapshot()
        .await;

    if let Some(requested_profile_key) = normalized_profile_key.clone() {
        let transport = load_profile_transport(db, &requested_profile_key)?;
        if transport == Some(BrowserProfileTransportKind::ManagedCdp) {
            return Ok(build_site_adapter_launch_readiness_result(
                SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime,
                spec,
                Some(requested_profile_key),
                normalized_target_id,
                "当前资料属于 Lime 托管浏览器，不允许在 Claw 内静默接管执行；请改走浏览器工作台。",
            ));
        }

        let observer = status_snapshot
            .observers
            .iter()
            .find(|item| item.profile_key == requested_profile_key);
        if observer.is_none() {
            return Ok(build_site_adapter_launch_readiness_result(
                SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime,
                spec,
                Some(requested_profile_key),
                normalized_target_id,
                build_site_adapter_attached_session_required_message(spec),
            ));
        }

        if let Some(explicit_target_id) = normalized_target_id.clone() {
            return Ok(build_site_adapter_launch_readiness_result(
                SiteAdapterLaunchReadinessStatus::Ready,
                spec,
                Some(requested_profile_key),
                Some(explicit_target_id),
                build_site_adapter_attached_session_ready_message(spec),
            ));
        }

        let tabs = match load_existing_session_tabs(&requested_profile_key).await {
            Ok(result) => result,
            Err(error) => {
                tracing::debug!(
                    "[site_capability] readiness 读取 existing_session 标签页失败: profile_key={}, error={}",
                    requested_profile_key,
                    error
                );
                Vec::new()
            }
        };
        let selected_target = select_existing_session_target(&tabs, &spec.domain).map(|tab| tab.id);
        let has_selected_target = selected_target.is_some();
        let can_auto_open_target = status_snapshot.control_count > 0;
        let is_ready = has_selected_target || can_auto_open_target;

        return Ok(build_site_adapter_launch_readiness_result(
            if is_ready {
                SiteAdapterLaunchReadinessStatus::Ready
            } else {
                SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime
            },
            spec,
            Some(requested_profile_key),
            selected_target,
            if is_ready {
                if has_selected_target {
                    build_site_adapter_attached_session_ready_message(spec)
                } else {
                    build_site_adapter_attached_session_auto_open_message(spec)
                }
            } else {
                build_site_adapter_attached_session_missing_target_message(spec)
            },
        ));
    }

    let mut attached_candidates = Vec::new();
    for observer in &status_snapshot.observers {
        let transport = profiles
            .iter()
            .find(|profile| profile.profile_key == observer.profile_key)
            .map(|profile| profile.transport_kind);
        if transport == Some(BrowserProfileTransportKind::ManagedCdp) {
            continue;
        }

        let tabs = match load_existing_session_tabs(&observer.profile_key).await {
            Ok(result) => result,
            Err(error) => {
                tracing::debug!(
                    "[site_capability] readiness 读取自动附着标签页失败: profile_key={}, error={}",
                    observer.profile_key,
                    error
                );
                Vec::new()
            }
        };
        let selected_target = select_existing_session_target(&tabs, &spec.domain).map(|tab| tab.id);

        attached_candidates.push(SiteAdapterAttachedLaunchCandidate {
            profile_key: observer.profile_key.clone(),
            target_id: selected_target,
            current_url_matches: observer_matches_site_domain(observer, &spec.domain),
            saved_existing_session: transport == Some(BrowserProfileTransportKind::ExistingSession),
        });
    }

    if let Some(candidate) = attached_candidates.into_iter().max_by_key(|item| {
        (
            item.target_id.is_some(),
            item.current_url_matches,
            item.saved_existing_session,
        )
    }) {
        let can_auto_open_target = status_snapshot.control_count > 0;
        let is_ready = candidate.target_id.is_some() || can_auto_open_target;
        return Ok(build_site_adapter_launch_readiness_result(
            if is_ready {
                SiteAdapterLaunchReadinessStatus::Ready
            } else {
                SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime
            },
            spec,
            Some(candidate.profile_key),
            candidate.target_id,
            if is_ready {
                if candidate.current_url_matches {
                    build_site_adapter_attached_session_ready_message(spec)
                } else {
                    build_site_adapter_attached_session_auto_open_message(spec)
                }
            } else {
                build_site_adapter_attached_session_missing_target_message(spec)
            },
        ));
    }

    Ok(build_site_adapter_launch_readiness_result(
        SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime,
        spec,
        None,
        None,
        build_site_adapter_attached_session_required_message(spec),
    ))
}

fn resolve_transport_route_from_state(
    profile_transport: Option<BrowserProfileTransportKind>,
    has_attached_observer: bool,
) -> SiteAdapterTransportRoute {
    match profile_transport {
        Some(BrowserProfileTransportKind::ExistingSession) => {
            SiteAdapterTransportRoute::ExistingSession
        }
        Some(_) => SiteAdapterTransportRoute::ManagedCdp,
        None if has_attached_observer => SiteAdapterTransportRoute::ExistingSession,
        None => SiteAdapterTransportRoute::ManagedCdp,
    }
}

async fn resolve_transport_route(
    db: &DbConnection,
    profile_key: &str,
) -> Result<SiteAdapterTransportRoute, String> {
    let profile_transport = load_profile_transport(db, profile_key)?;
    let has_attached_observer = profile_transport.is_none()
        && chrome_bridge::chrome_bridge_hub()
            .get_status_snapshot()
            .await
            .observers
            .iter()
            .any(|observer| observer.profile_key == profile_key);

    Ok(resolve_transport_route_from_state(
        profile_transport,
        has_attached_observer,
    ))
}

fn load_profile_transport(
    db: &DbConnection,
    profile_key: &str,
) -> Result<Option<BrowserProfileTransportKind>, String> {
    let conn = lock_db(db)?;
    let profile = BrowserProfileDao::get_by_profile_key(&conn, profile_key)
        .map_err(|error| format!("读取浏览器资料失败: {error}"))?;
    Ok(profile
        .filter(|record| record.archived_at.is_none())
        .map(|record| record.transport_kind))
}

fn parse_existing_session_tabs(data: Option<Value>) -> Vec<ExistingSessionTabRecord> {
    let Some(data) = data else {
        return Vec::new();
    };
    let raw_tabs = data.get("tabs").and_then(Value::as_array).or_else(|| {
        data.get("data")
            .and_then(|value| value.get("tabs"))
            .and_then(Value::as_array)
    });
    let Some(raw_tabs) = raw_tabs else {
        return Vec::new();
    };

    raw_tabs
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let id = value_to_string(object.get("id")?)?;
            Some(ExistingSessionTabRecord {
                id,
                index: object.get("index").and_then(Value::as_i64).unwrap_or(0),
                url: object
                    .get("url")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string),
                active: object
                    .get("active")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

fn tab_matches_domain(tab: &ExistingSessionTabRecord, domain: &str) -> bool {
    let Some(url) = tab.url.as_deref() else {
        return false;
    };
    let Some(host) = parse_url_host(url) else {
        return false;
    };
    site_scope_matches_domain(Some(host.as_str()), domain)
}

fn select_existing_session_target(
    tabs: &[ExistingSessionTabRecord],
    domain: &str,
) -> Option<ExistingSessionTabRecord> {
    tabs.iter()
        .filter(|tab| tab_matches_domain(tab, domain))
        .max_by_key(|tab| (tab.active, -tab.index))
        .cloned()
}

fn select_existing_session_navigation_seed(
    tabs: &[ExistingSessionTabRecord],
) -> Option<ExistingSessionTabRecord> {
    tabs.iter()
        .max_by_key(|tab| (tab.active, -tab.index))
        .cloned()
}

fn build_recommendation_entry_url(spec: &SiteAdapterSpec) -> String {
    let example_args = match build_example_args(&spec.args) {
        Value::Object(map) => map,
        _ => Map::new(),
    };

    build_entry_url(spec, &example_args)
        .unwrap_or_else(|_| format!("https://{}", spec.domain.trim_matches('/')))
}

fn is_priority_site_adapter(spec: &SiteAdapterSpec) -> bool {
    const PRIORITY_DOMAINS: &[&str] = &[
        "github.com",
        "www.zhihu.com",
        "search.bilibili.com",
        "www.36kr.com",
    ];
    const PRIORITY_CAPABILITIES: &[&str] = &[
        "research",
        "search",
        "newsflash",
        "hot",
        "feed",
        "issues",
        "repository",
        "video",
    ];

    PRIORITY_DOMAINS
        .iter()
        .any(|domain| site_scope_matches_domain(Some(domain), &spec.domain))
        || spec.capabilities.iter().any(|capability| {
            PRIORITY_CAPABILITIES
                .iter()
                .any(|expected| capability.eq_ignore_ascii_case(expected))
        })
}

fn select_site_scope_recommendation_profile<'a>(
    profiles: &'a [BrowserProfileRecord],
    domain: &str,
    attached_profile_keys: &HashSet<String>,
) -> Option<&'a BrowserProfileRecord> {
    profiles
        .iter()
        .find(|profile| {
            profile.transport_kind == BrowserProfileTransportKind::ExistingSession
                && attached_profile_keys.contains(&profile.profile_key)
                && site_scope_matches_domain(profile.site_scope.as_deref(), domain)
        })
        .or_else(|| {
            profiles.iter().find(|profile| {
                profile.transport_kind == BrowserProfileTransportKind::ManagedCdp
                    && site_scope_matches_domain(profile.site_scope.as_deref(), domain)
            })
        })
        .or_else(|| {
            profiles
                .iter()
                .find(|profile| site_scope_matches_domain(profile.site_scope.as_deref(), domain))
        })
}

fn build_site_adapter_recommendation_candidate(
    spec: &SiteAdapterSpec,
    profiles: &[BrowserProfileRecord],
    attached_contexts: &[ExistingSessionRecommendationContext],
    attached_profile_keys: &HashSet<String>,
) -> SiteAdapterRecommendationCandidate {
    for profile in profiles
        .iter()
        .filter(|profile| profile.transport_kind == BrowserProfileTransportKind::ExistingSession)
    {
        let Some(context) = attached_contexts
            .iter()
            .find(|context| context.profile_key == profile.profile_key)
        else {
            continue;
        };
        let Some(current_host) = context.current_url.as_deref().and_then(parse_url_host) else {
            continue;
        };
        if !site_scope_matches_domain(Some(current_host.as_str()), &spec.domain) {
            continue;
        }

        return SiteAdapterRecommendationCandidate {
            reason: format!(
                "已检测到资料 {} 当前停留在 {}，可直接复用已连接的 Chrome 上下文。",
                profile.name, spec.domain
            ),
            profile_key: Some(profile.profile_key.clone()),
            target_id: select_existing_session_target(&context.tabs, &spec.domain)
                .map(|tab| tab.id),
            score: 100,
        };
    }

    for profile in profiles
        .iter()
        .filter(|profile| profile.transport_kind == BrowserProfileTransportKind::ExistingSession)
    {
        let Some(context) = attached_contexts
            .iter()
            .find(|context| context.profile_key == profile.profile_key)
        else {
            continue;
        };
        let Some(target) = select_existing_session_target(&context.tabs, &spec.domain) else {
            continue;
        };

        return SiteAdapterRecommendationCandidate {
            reason: format!(
                "已检测到资料 {} 的已连接标签页命中 {}，优先复用现有登录态。",
                profile.name, spec.domain
            ),
            profile_key: Some(profile.profile_key.clone()),
            target_id: Some(target.id),
            score: 90,
        };
    }

    if let Some(profile) =
        select_site_scope_recommendation_profile(profiles, &spec.domain, attached_profile_keys)
    {
        let score = if profile.transport_kind == BrowserProfileTransportKind::ManagedCdp {
            70
        } else {
            75
        };
        return SiteAdapterRecommendationCandidate {
            reason: format!(
                "资料 {} 已绑定站点范围 {}，可优先作为该适配器的执行上下文。",
                profile.name,
                profile
                    .site_scope
                    .as_deref()
                    .unwrap_or(spec.domain.as_str())
            ),
            profile_key: Some(profile.profile_key.clone()),
            target_id: None,
            score,
        };
    }

    let observer_matching_profile_keys = HashSet::new();
    let fallback_profile_key = select_preferred_site_profile_key(
        profiles,
        &spec.domain,
        &observer_matching_profile_keys,
        attached_profile_keys,
    );
    let fallback_profile = fallback_profile_key.as_ref().and_then(|profile_key| {
        profiles
            .iter()
            .find(|profile| profile.profile_key == *profile_key)
    });

    if is_priority_site_adapter(spec) {
        return SiteAdapterRecommendationCandidate {
            reason: fallback_profile
                .map(|profile| {
                    format!(
                        "当前没有直接命中的站点上下文，但 {} 适合研究采集，可先使用资料 {}。",
                        spec.name, profile.name
                    )
                })
                .unwrap_or_else(|| {
                    "当前没有直接命中的站点上下文，但该适配器仍适合作为研究候选。".to_string()
                }),
            profile_key: fallback_profile_key,
            target_id: None,
            score: 45,
        };
    }

    SiteAdapterRecommendationCandidate {
        reason: fallback_profile
            .map(|profile| {
                format!(
                    "当前未检测到更强上下文，保留为可用候选；默认推荐资料 {}。",
                    profile.name
                )
            })
            .unwrap_or_else(|| "当前未检测到可复用的浏览器上下文，保留为可用候选。".to_string()),
        profile_key: fallback_profile_key,
        target_id: None,
        score: 20,
    }
}

fn rank_site_adapter_recommendations(
    specs: &[SiteAdapterSpec],
    profiles: &[BrowserProfileRecord],
    attached_contexts: &[ExistingSessionRecommendationContext],
    limit: Option<usize>,
) -> Vec<SiteAdapterRecommendation> {
    let attached_profile_keys = attached_contexts
        .iter()
        .map(|context| context.profile_key.clone())
        .collect::<HashSet<_>>();

    let mut recommendations = specs
        .iter()
        .map(|spec| {
            let candidate = build_site_adapter_recommendation_candidate(
                spec,
                profiles,
                attached_contexts,
                &attached_profile_keys,
            );
            SiteAdapterRecommendation {
                adapter: build_adapter_definition(spec),
                reason: candidate.reason,
                profile_key: candidate.profile_key,
                target_id: candidate.target_id,
                entry_url: build_recommendation_entry_url(spec),
                score: candidate.score,
            }
        })
        .collect::<Vec<_>>();

    recommendations.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.adapter.name.cmp(&right.adapter.name))
    });

    if let Some(limit) = limit {
        recommendations.truncate(limit.min(recommendations.len()));
    }

    recommendations
}

async fn load_existing_session_tabs(
    profile_key: &str,
) -> Result<Vec<ExistingSessionTabRecord>, String> {
    let result = execute_bridge_adapter_command(ChromeBridgeCommandRequest {
        profile_key: Some(profile_key.to_string()),
        command: "list_tabs".to_string(),
        target: None,
        text: None,
        url: None,
        payload: None,
        wait_for_page_info: false,
        timeout_ms: Some(DEFAULT_TIMEOUT_MS),
    })
    .await?;

    Ok(parse_existing_session_tabs(result.data))
}

async fn load_existing_session_recommendation_contexts(
    profiles: &[BrowserProfileRecord],
) -> Vec<ExistingSessionRecommendationContext> {
    let status_snapshot = chrome_bridge::chrome_bridge_hub()
        .get_status_snapshot()
        .await;
    let mut contexts = Vec::new();

    for profile in profiles
        .iter()
        .filter(|profile| profile.transport_kind == BrowserProfileTransportKind::ExistingSession)
    {
        let Some(observer) = status_snapshot
            .observers
            .iter()
            .find(|observer| observer.profile_key == profile.profile_key)
        else {
            continue;
        };

        let tabs = match load_existing_session_tabs(&profile.profile_key).await {
            Ok(result) => result,
            Err(error) => {
                tracing::debug!(
                    "[site_capability] 读取 existing_session 推荐上下文标签页失败: profile_key={}, error={}",
                    profile.profile_key,
                    error
                );
                Vec::new()
            }
        };
        contexts.push(ExistingSessionRecommendationContext {
            profile_key: profile.profile_key.clone(),
            current_url: observer
                .last_page_info
                .as_ref()
                .and_then(|page| page.url.as_ref().map(ToString::to_string)),
            tabs,
        });
    }

    contexts
}

fn classify_existing_session_target_error(error: &str) -> &'static str {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("标签页") || normalized.contains("tab") || normalized.contains("target")
    {
        "no_matching_context"
    } else {
        "site_unreachable"
    }
}

async fn run_existing_session_adapter(
    spec: &SiteAdapterSpec,
    profile_key: String,
    target_id: Option<String>,
    entry_url: String,
    timeout_ms: u64,
    args: Map<String, Value>,
) -> SiteAdapterRunResult {
    let selected_target = if let Some(explicit_target_id) = target_id
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(ExistingSessionTabRecord {
            id: explicit_target_id,
            index: 0,
            url: None,
            active: true,
        })
    } else {
        let tabs = match load_existing_session_tabs(&profile_key).await {
            Ok(result) => result,
            Err(error) => {
                return build_error_result(
                    spec,
                    profile_key,
                    None,
                    None,
                    entry_url,
                    "site_unreachable",
                    &format!("读取当前 Chrome 标签页失败: {error}"),
                );
            }
        };
        select_existing_session_target(&tabs, &spec.domain)
    };

    let should_skip_navigation = selected_target
        .as_ref()
        .and_then(|target| target.url.as_deref())
        .map(|current_url| url_matches_expected_entry(current_url, &entry_url))
        .unwrap_or(false);
    let mut bridged_target_id = selected_target.as_ref().map(|target| target.id.clone());
    let latest_source_url = if should_skip_navigation {
        selected_target
            .as_ref()
            .and_then(|target| target.url.clone())
    } else {
        let navigation_result = match execute_bridge_adapter_command(ChromeBridgeCommandRequest {
            profile_key: Some(profile_key.clone()),
            command: "open_url".to_string(),
            target: bridged_target_id.clone(),
            text: None,
            url: Some(entry_url.clone()),
            payload: None,
            wait_for_page_info: true,
            timeout_ms: Some(timeout_ms),
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                return build_error_result(
                    spec,
                    profile_key,
                    None,
                    bridged_target_id,
                    entry_url,
                    classify_existing_session_target_error(&error),
                    &format!("当前 Chrome 导航失败: {error}"),
                );
            }
        };

        bridged_target_id = navigation_result
            .data
            .as_ref()
            .and_then(|data| data.get("tab_id"))
            .and_then(value_to_string)
            .or(bridged_target_id.clone());
        if bridged_target_id.is_none() {
            bridged_target_id = load_existing_session_tabs(&profile_key)
                .await
                .ok()
                .and_then(|tabs| {
                    select_existing_session_target(&tabs, &spec.domain)
                        .or_else(|| select_existing_session_navigation_seed(&tabs))
                })
                .map(|tab| tab.id);
        }
        navigation_result
            .page_info
            .as_ref()
            .and_then(|page| page.url.clone())
            .or_else(|| {
                selected_target
                    .as_ref()
                    .and_then(|target| target.url.clone())
            })
    };

    let adapter_output = match execute_bridge_adapter_command(ChromeBridgeCommandRequest {
        profile_key: Some(profile_key.clone()),
        command: "run_adapter".to_string(),
        target: bridged_target_id.clone(),
        text: None,
        url: None,
        payload: Some(json!({
            "adapter_name": spec.name,
            "args": Value::Object(args),
        })),
        wait_for_page_info: false,
        timeout_ms: Some(normalize_adapter_evaluate_timeout_ms(timeout_ms)),
    })
    .await
    {
        Ok(result) => result.data.unwrap_or(Value::Null),
        Err(error) => {
            return build_error_result(
                spec,
                profile_key,
                None,
                bridged_target_id,
                entry_url,
                "adapter_runtime_error",
                &error,
            );
        }
    };

    normalize_adapter_output(
        spec,
        profile_key,
        entry_url,
        AdapterExecutionState {
            session_id: None,
            target_id: bridged_target_id,
            source_url: latest_source_url,
        },
        adapter_output,
    )
}

async fn run_managed_cdp_adapter(
    db: &DbConnection,
    spec: &SiteAdapterSpec,
    profile_key: String,
    target_id: Option<String>,
    entry_url: String,
    timeout_ms: u64,
    wrapped_script: String,
) -> SiteAdapterRunResult {
    let _ = db;

    if let Err(error) =
        ensure_managed_chrome_profile_global(profile_key.clone(), Some(entry_url.clone())).await
    {
        return build_error_result(
            spec,
            profile_key,
            None,
            None,
            entry_url,
            "site_unreachable",
            &format!("启动浏览器资料失败: {error}"),
        );
    }

    let target_id = match resolve_target_id(&profile_key, &spec.domain, target_id.as_deref()).await
    {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                spec,
                profile_key,
                None,
                None,
                entry_url,
                "site_unreachable",
                &error,
            );
        }
    };

    let session = match ensure_runtime_session_for_target(&profile_key, target_id.as_deref()).await
    {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                spec,
                profile_key,
                None,
                target_id,
                entry_url,
                "site_unreachable",
                &format!("建立浏览器会话失败: {error}"),
            );
        }
    };

    let runtime = shared_browser_runtime();
    let previous_url = session.last_page_info.as_ref().map(|page| page.url.clone());
    let navigated_session = match runtime
        .execute_action(
            &session.session_id,
            "navigate",
            json!({
                "action": "goto",
                "url": entry_url,
                "timeout_ms": timeout_ms,
            }),
        )
        .await
    {
        Ok(_) => {
            let refreshed_session = runtime
                .refresh_page_info(&session.session_id)
                .await
                .unwrap_or(session.clone());
            wait_for_navigation_settle(&runtime, refreshed_session, &entry_url, timeout_ms).await
        }
        Err(error) => {
            if !looks_like_navigation_timeout_error(&error) {
                return build_error_result(
                    spec,
                    profile_key,
                    Some(session.session_id),
                    Some(session.target_id),
                    entry_url,
                    "site_unreachable",
                    &format!("导航站点失败: {error}"),
                );
            }

            let refreshed_session = runtime
                .refresh_page_info(&session.session_id)
                .await
                .unwrap_or(session.clone());
            let settled_session =
                wait_for_navigation_settle(&runtime, refreshed_session, &entry_url, timeout_ms)
                    .await;
            let recovered_url = settled_session
                .last_page_info
                .as_ref()
                .map(|page| page.url.as_str());
            if !navigation_reached_expected_page(recovered_url, previous_url.as_deref(), &entry_url)
            {
                return build_error_result(
                    spec,
                    profile_key,
                    Some(session.session_id),
                    Some(session.target_id),
                    entry_url,
                    "site_unreachable",
                    &format!("导航站点失败: {error}"),
                );
            }

            tracing::warn!(
                "[site_capability] 导航命令超时后继续复查页面状态并恢复执行: profile_key={}, entry_url={}",
                profile_key,
                entry_url
            );
            settled_session
        }
    };

    let adapter_output = match evaluate_session_script(
        &navigated_session.session_id,
        &wrapped_script,
        normalize_adapter_evaluate_timeout_ms(timeout_ms),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                spec,
                profile_key,
                Some(navigated_session.session_id),
                Some(navigated_session.target_id),
                entry_url,
                "adapter_runtime_error",
                &error,
            );
        }
    };

    let latest_session = runtime
        .refresh_page_info(&navigated_session.session_id)
        .await
        .unwrap_or(navigated_session);

    normalize_adapter_output(
        spec,
        profile_key,
        entry_url,
        AdapterExecutionState {
            session_id: Some(latest_session.session_id),
            target_id: Some(latest_session.target_id),
            source_url: latest_session
                .last_page_info
                .as_ref()
                .map(|page| page.url.clone()),
        },
        adapter_output,
    )
}

async fn execute_bridge_adapter_command(
    request: ChromeBridgeCommandRequest,
) -> Result<ChromeBridgeCommandResult, String> {
    let result = chrome_bridge::chrome_bridge_hub()
        .execute_api_command(request)
        .await?;
    if result.success {
        Ok(result)
    } else {
        Err(result
            .error
            .or(result.message)
            .unwrap_or_else(|| "Chrome 执行失败".to_string()))
    }
}

async fn resolve_target_id(
    profile_key: &str,
    domain: &str,
    requested_target_id: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(target_id) = requested_target_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(target_id.to_string()));
    }

    let targets = list_cdp_targets_global(ListCdpTargetsRequest {
        profile_key: Some(profile_key.to_string()),
    })
    .await?;

    Ok(find_target_for_domain(&targets, domain)
        .or_else(|| {
            targets
                .iter()
                .find(|target| target.target_type == "page")
                .map(|target| target.id.clone())
        })
        .or_else(|| targets.first().map(|target| target.id.clone())))
}

fn find_target_for_domain(targets: &[CdpTargetInfo], domain: &str) -> Option<String> {
    targets.iter().find_map(|target| {
        let hostname = Url::parse(&target.url)
            .ok()
            .and_then(|url| url.host_str().map(ToString::to_string))?;
        if hostname == domain || hostname.ends_with(&format!(".{domain}")) {
            Some(target.id.clone())
        } else {
            None
        }
    })
}

async fn ensure_runtime_session_for_target(
    profile_key: &str,
    target_id: Option<&str>,
) -> Result<CdpSessionState, String> {
    let runtime = shared_browser_runtime();
    if let Some(existing) = runtime.find_session_by_profile_key(profile_key).await {
        if target_id.is_none() || Some(existing.target_id.as_str()) == target_id {
            return Ok(existing);
        }
        let _ = close_cdp_session_global(BrowserSessionStateRequest {
            session_id: existing.session_id,
        })
        .await?;
    }

    open_cdp_session_global(OpenCdpSessionRequest {
        profile_key: profile_key.to_string(),
        target_id: target_id.map(ToString::to_string),
        environment_preset_id: None,
        environment_preset_name: None,
    })
    .await
}

fn normalize_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS)
}

fn normalize_optional_project_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_optional_content_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn build_site_result_metadata_map(
    adapter: &SiteAdapterDefinition,
    result: &SiteAdapterRunResult,
    include_resource_kind: bool,
) -> Map<String, Value> {
    let mut metadata = Map::new();
    if include_resource_kind {
        metadata.insert(
            "resourceKind".to_string(),
            Value::String("document".to_string()),
        );
    }
    metadata.insert(
        "siteAdapterName".to_string(),
        Value::String(adapter.name.clone()),
    );
    metadata.insert(
        "siteAdapterDomain".to_string(),
        Value::String(adapter.domain.clone()),
    );
    metadata.insert(
        "siteAdapterProfileKey".to_string(),
        Value::String(result.profile_key.clone()),
    );
    metadata.insert(
        "siteAdapterEntryUrl".to_string(),
        Value::String(result.entry_url.clone()),
    );
    metadata.insert(
        "siteAdapterSourceUrl".to_string(),
        result
            .source_url
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata.insert(
        "siteAdapterSourceKind".to_string(),
        adapter
            .source_kind
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata.insert(
        "siteAdapterSourceVersion".to_string(),
        adapter
            .source_version
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata.insert(
        "siteAdapterReportHint".to_string(),
        result
            .report_hint
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    metadata
}

fn resolve_project_id_from_content(db: &DbConnection, content_id: &str) -> Option<String> {
    ContentManager::new(db.clone())
        .get(&content_id.to_string())
        .ok()
        .flatten()
        .map(|content| content.project_id)
}

fn attach_requested_site_result_save(
    db: &DbConnection,
    request: &RunSiteAdapterRequest,
    mut result: SiteAdapterRunResult,
) -> SiteAdapterRunResult {
    let content_id = normalize_optional_content_id(request.content_id.as_deref());
    let project_id = normalize_optional_project_id(request.project_id.as_deref());
    let save_source = if content_id.is_some() {
        EXPLICIT_CONTENT_SAVE_SOURCE
    } else if project_id.is_some() {
        EXPLICIT_PROJECT_SAVE_SOURCE
    } else {
        return result;
    };

    if !result.ok {
        result.save_skipped_project_id = project_id.clone().or_else(|| {
            content_id
                .as_deref()
                .and_then(|value| resolve_project_id_from_content(db, value))
        });
        result.save_skipped_by = Some(save_source.to_string());
        return result;
    }

    let adapter_name = normalize_site_adapter_name(&request.adapter_name);
    let Some(adapter) = get_site_adapter(&adapter_name) else {
        result.save_skipped_project_id = project_id.clone().or_else(|| {
            content_id
                .as_deref()
                .and_then(|value| resolve_project_id_from_content(db, value))
        });
        result.save_skipped_by = Some(save_source.to_string());
        result.save_error_message = Some("未找到对应的站点适配器".to_string());
        return result;
    };

    let save_result = if let Some(content_id) = content_id.as_deref() {
        save_site_result_to_content(db, content_id, &adapter, request, &result)
    } else if let Some(project_id) = project_id.as_deref() {
        save_site_result_to_project(
            db,
            project_id,
            request.save_title.as_deref(),
            &adapter,
            request,
            &result,
        )
    } else {
        Err("project_id 或 content_id 至少提供一个".to_string())
    };

    match save_result {
        Ok(saved_content) => {
            result.saved_project_id = Some(saved_content.project_id.clone());
            result.saved_content = Some(saved_content);
            result.saved_by = Some(save_source.to_string());
        }
        Err(error) => {
            result.save_skipped_project_id = project_id.clone().or_else(|| {
                content_id
                    .as_deref()
                    .and_then(|value| resolve_project_id_from_content(db, value))
            });
            result.save_skipped_by = Some(save_source.to_string());
            result.save_error_message = Some(error);
        }
    }

    result
}

fn normalize_adapter_evaluate_timeout_ms(timeout_ms: u64) -> u64 {
    timeout_ms
        .max(MIN_ADAPTER_EVALUATE_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS)
}

fn build_wrapped_adapter_script(
    adapter_script: &str,
    args: &Map<String, Value>,
) -> Result<String, String> {
    let args_literal = serde_json::to_string(&Value::Object(args.clone()))
        .map_err(|error| format!("编码适配器参数失败: {error}"))?;

    Ok(format!(
        r#"
(async () => {{
  const args = {args_literal};
  {helpers}
  const adapter = {adapter};
  try {{
    const result = await adapter(args, helpers);
    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "ok")) {{
      if (result.ok === false && !result.error_code) {{
        return {{
          ...result,
          error_code: helpers.looksLikeLoginWall()
            ? "auth_required"
            : "adapter_runtime_error",
        }};
      }}
      return result;
    }}
    return {{
      ok: true,
      data: result ?? null,
      source_url: location.href,
    }};
  }} catch (error) {{
    const loginWall = helpers.looksLikeLoginWall();
    return {{
      ok: false,
      error_code: loginWall ? "auth_required" : "adapter_runtime_error",
      error_message: error?.message || String(error),
      source_url: location.href,
    }};
  }}
}})()
"#,
        args_literal = args_literal,
        helpers = ADAPTER_HELPERS_SCRIPT,
        adapter = adapter_script,
    ))
}

async fn evaluate_session_script(
    session_id: &str,
    expression: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let response = shared_browser_runtime()
        .send_command(
            session_id,
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true,
            }),
            timeout_ms,
        )
        .await?;

    if let Some(exception) = response.get("exceptionDetails") {
        return Err(format!("页面脚本执行失败: {exception}"));
    }

    let result = response.get("result").cloned().unwrap_or(Value::Null);
    Ok(result.get("value").cloned().unwrap_or(result))
}

fn normalize_adapter_output(
    spec: &SiteAdapterSpec,
    profile_key: String,
    entry_url: String,
    execution_state: AdapterExecutionState,
    adapter_output: Value,
) -> SiteAdapterRunResult {
    let source_url = adapter_output
        .get("source_url")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or(execution_state.source_url);

    let ok = adapter_output
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let data = adapter_output.get("data").cloned().or_else(|| {
        if ok {
            Some(adapter_output.clone())
        } else {
            None
        }
    });
    let raw_error_code = adapter_output
        .get("error_code")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let error_message = adapter_output
        .get("error_message")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let error_code = if ok {
        None
    } else {
        normalize_site_adapter_error_code(raw_error_code.as_deref(), error_message.as_deref())
            .or_else(|| Some("adapter_runtime_error".to_string()))
    };
    let auth_hint = adapter_output
        .get("auth_hint")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| spec.auth_hint.clone());
    let report_hint = error_code
        .as_deref()
        .and_then(build_site_adapter_report_hint);

    SiteAdapterRunResult {
        ok,
        adapter: spec.name.clone(),
        domain: spec.domain.clone(),
        profile_key,
        session_id: execution_state.session_id,
        target_id: execution_state.target_id,
        entry_url,
        source_url,
        data,
        error_code,
        error_message,
        auth_hint,
        report_hint,
        saved_content: None,
        saved_project_id: None,
        saved_by: None,
        save_skipped_project_id: None,
        save_skipped_by: None,
        save_error_message: None,
    }
}

async fn wait_for_navigation_settle(
    runtime: &lime_browser_runtime::BrowserRuntimeManager,
    session: CdpSessionState,
    entry_url: &str,
    timeout_ms: u64,
) -> CdpSessionState {
    let previous_url = session.last_page_info.as_ref().map(|page| page.url.clone());
    let max_wait_ms = timeout_ms.clamp(1_000, 8_000);
    let started_at = Instant::now();
    let mut latest_session = session;

    loop {
        let current_url = latest_session
            .last_page_info
            .as_ref()
            .map(|page| page.url.as_str());
        if navigation_reached_expected_page(current_url, previous_url.as_deref(), entry_url) {
            return latest_session;
        }

        if started_at.elapsed() >= Duration::from_millis(max_wait_ms) {
            return latest_session;
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
        latest_session = runtime
            .refresh_page_info(&latest_session.session_id)
            .await
            .unwrap_or(latest_session);
    }
}

fn navigation_reached_expected_page(
    current_url: Option<&str>,
    previous_url: Option<&str>,
    entry_url: &str,
) -> bool {
    let Some(current_url) = current_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };

    if url_matches_expected_entry(current_url, entry_url) {
        return true;
    }

    let Some(expected_host) = parse_url_host(entry_url) else {
        return false;
    };
    let Some(current_host) = parse_url_host(current_url) else {
        return false;
    };
    if current_host != expected_host {
        return false;
    }

    let Some(previous_url) = previous_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };

    current_url != previous_url
}

fn url_matches_expected_entry(current_url: &str, entry_url: &str) -> bool {
    let Ok(current) = Url::parse(current_url) else {
        return false;
    };
    let Ok(expected) = Url::parse(entry_url) else {
        return false;
    };

    if current.host_str().map(str::to_ascii_lowercase)
        != expected.host_str().map(str::to_ascii_lowercase)
    {
        return false;
    }

    if normalize_url_path(current.path()) != normalize_url_path(expected.path()) {
        return false;
    }

    let current_query = current.query_pairs().collect::<Vec<_>>();
    expected
        .query_pairs()
        .all(|(expected_key, expected_value)| {
            current_query.iter().any(|(current_key, current_value)| {
                current_key == &expected_key && current_value == &expected_value
            })
        })
}

fn parse_url_host(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()?
        .host_str()
        .map(|value| value.to_ascii_lowercase())
}

fn looks_like_auth_required_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("sign in")
        || normalized.contains("log in")
        || normalized.contains("登录")
        || normalized.contains("登入")
        || normalized.contains("扫码")
        || normalized.contains("验证你是人类")
}

fn looks_like_no_matching_context_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("标签页")
        || normalized.contains("tab")
        || normalized.contains("target")
        || normalized.contains("上下文")
}

fn looks_like_attached_session_required_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("附着")
        || normalized.contains("真实浏览器")
        || normalized.contains("浏览器工作台")
        || normalized.contains("attached session")
}

fn normalize_site_adapter_error_code(
    error_code: Option<&str>,
    error_message: Option<&str>,
) -> Option<String> {
    let normalized_message = error_message
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let normalized_code = error_code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());

    if normalized_code.as_deref() == Some("auth_required")
        || looks_like_auth_required_message(normalized_message)
    {
        return Some("auth_required".to_string());
    }

    if matches!(
        normalized_code.as_deref(),
        Some("attached_session_required")
    ) || looks_like_attached_session_required_message(normalized_message)
    {
        return Some("attached_session_required".to_string());
    }

    if matches!(
        normalized_code.as_deref(),
        Some("target_not_found") | Some("no_matching_context")
    ) || looks_like_no_matching_context_message(normalized_message)
    {
        return Some("no_matching_context".to_string());
    }

    if matches!(
        normalized_code.as_deref(),
        Some("adapter_failed") | Some("adapter_runtime_error")
    ) {
        return Some("adapter_runtime_error".to_string());
    }

    normalized_code.or_else(|| {
        if normalized_message.is_empty() {
            None
        } else {
            Some("adapter_runtime_error".to_string())
        }
    })
}

fn looks_like_navigation_timeout_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("page.navigate")
        && (normalized.contains("timeout") || error.contains("超时"))
}

fn build_site_adapter_report_hint(error_code: &str) -> Option<String> {
    match error_code {
        "attached_session_required" => Some(
            "Claw 不会在后台偷偷启动浏览器；请先进入浏览器工作台连接真实浏览器并打开目标站点页面，再返回 Claw 重试。"
                .to_string(),
        ),
        "auth_required" => Some(
            "请先确认当前浏览器资料已经登录目标站点，再重试；如果仍失败，请附上当前页面 URL 和登录状态。"
                .to_string(),
        ),
        "no_matching_context" => Some(
            "请先在当前浏览器里打开目标站点页面，或手动传入 profile_key / target_id 后重试。"
                .to_string(),
        ),
        "adapter_runtime_error" => Some(
            "站点页面结构可能已经变化；请保留当前页面 URL、执行参数和错误信息后反馈给 Lime。"
                .to_string(),
        ),
        "site_unreachable" => Some(
            "目标站点可能加载较慢、发生重定向，或当前网络暂时不可达；请先确认入口 URL 能正常打开，必要时增大 timeout_ms 后重试。"
                .to_string(),
        ),
        _ => None,
    }
}

fn normalize_url_path(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/"
    } else {
        trimmed
    }
}

fn build_error_result(
    spec: &SiteAdapterSpec,
    profile_key: String,
    session_id: Option<String>,
    target_id: Option<String>,
    entry_url: String,
    error_code: &str,
    error_message: &str,
) -> SiteAdapterRunResult {
    let normalized_error_code =
        normalize_site_adapter_error_code(Some(error_code), Some(error_message))
            .unwrap_or_else(|| error_code.to_string());
    SiteAdapterRunResult {
        ok: false,
        adapter: spec.name.clone(),
        domain: spec.domain.clone(),
        profile_key,
        session_id,
        target_id,
        entry_url,
        source_url: None,
        data: None,
        error_code: Some(normalized_error_code.clone()),
        error_message: Some(error_message.to_string()),
        auth_hint: spec.auth_hint.clone(),
        report_hint: build_site_adapter_report_hint(&normalized_error_code),
        saved_content: None,
        saved_project_id: None,
        saved_by: None,
        save_skipped_project_id: None,
        save_skipped_by: None,
        save_error_message: None,
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(ToString::to_string)
        .or_else(|| value.as_i64().map(|raw| raw.to_string()))
        .or_else(|| value.as_u64().map(|raw| raw.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{ContentManager, ContentType};
    use crate::database::schema::create_tables;
    use crate::workspace::{WorkspaceManager, WorkspaceType};
    use lime_core::database::dao::browser_profile::UpsertBrowserProfileInput;
    use lime_server::chrome_bridge::ObserverCommandResultPayload;
    use rusqlite::Connection;
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;
    use tokio::sync::mpsc;

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn should_list_site_adapters_with_example_args() {
        let adapters = list_site_adapters();
        assert!(adapters
            .iter()
            .any(|adapter| adapter.name == "github/search"));
        let expected = get_site_adapter("github/search").expect("github/search should resolve");
        let github = adapters
            .into_iter()
            .find(|adapter| adapter.name == "github/search")
            .expect("github/search should exist");
        assert_eq!(github.example_args, expected.example_args);
        assert_eq!(github.source_kind, expected.source_kind);
        assert_eq!(github.source_version, expected.source_version);
        assert!(github
            .example_args
            .get("query")
            .and_then(Value::as_str)
            .is_some());
    }

    #[test]
    fn should_expose_selected_bundled_market_finance_and_community_adapters() {
        let linux_do_hot = get_site_adapter("linux-do/hot").expect("linux-do/hot should resolve");
        assert_eq!(linux_do_hot.source_kind.as_deref(), Some("bundled"));
        assert_eq!(linux_do_hot.source_version.as_deref(), Some("2026-03-28"));
        assert_eq!(
            linux_do_hot
                .example_args
                .get("period")
                .and_then(Value::as_str),
            Some("weekly")
        );
        assert_eq!(
            linux_do_hot
                .example_args
                .get("limit")
                .and_then(Value::as_i64),
            Some(10)
        );

        let linux_do_categories =
            get_site_adapter("linux-do/categories").expect("linux-do/categories should resolve");
        assert_eq!(linux_do_categories.source_kind.as_deref(), Some("bundled"));
        assert_eq!(
            linux_do_categories.source_version.as_deref(),
            Some("2026-03-28")
        );
        assert_eq!(
            linux_do_categories
                .example_args
                .get("limit")
                .and_then(Value::as_i64),
            Some(10)
        );

        let yahoo =
            get_site_adapter("yahoo-finance/quote").expect("yahoo-finance/quote should resolve");
        assert_eq!(yahoo.source_kind.as_deref(), Some("bundled"));
        assert_eq!(yahoo.source_version.as_deref(), Some("2026-03-28"));
        assert_eq!(
            yahoo.example_args.get("symbol").and_then(Value::as_str),
            Some("AAPL")
        );

        let smzdm = get_site_adapter("smzdm/search").expect("smzdm/search should resolve");
        assert_eq!(smzdm.source_kind.as_deref(), Some("bundled"));
        assert_eq!(smzdm.source_version.as_deref(), Some("2026-03-28"));
        assert_eq!(
            smzdm.example_args.get("query").and_then(Value::as_str),
            Some("Mac mini")
        );
        assert_eq!(
            smzdm.example_args.get("limit").and_then(Value::as_i64),
            Some(5)
        );
    }

    #[test]
    fn should_search_site_adapters_by_keyword() {
        let adapters = search_site_adapters("issue");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "github/issues");
    }

    #[test]
    fn should_search_selected_bundled_adapters_by_domain_and_capability() {
        let community = search_site_adapters("linux.do");
        assert!(community
            .iter()
            .any(|adapter| adapter.name == "linux-do/hot"));
        assert!(community
            .iter()
            .any(|adapter| adapter.name == "linux-do/categories"));

        let finance = search_site_adapters("finance");
        assert!(finance
            .iter()
            .any(|adapter| adapter.name == "yahoo-finance/quote"));

        let deals = search_site_adapters("deals");
        assert!(deals.iter().any(|adapter| adapter.name == "smzdm/search"));
    }

    #[test]
    fn should_prefer_attached_existing_session_profile_for_matching_site() {
        let attached_profile_keys = HashSet::from(["research_attach".to_string()]);
        let profiles = vec![
            BrowserProfileRecord {
                id: "managed-1".to_string(),
                profile_key: "general_browser_assist".to_string(),
                name: "通用资料".to_string(),
                description: None,
                site_scope: Some("github.com".to_string()),
                launch_url: Some("https://github.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
                profile_dir: "/tmp/managed".to_string(),
                managed_profile_dir: Some("/tmp/managed".to_string()),
                created_at: "2026-03-26T00:00:00Z".to_string(),
                updated_at: "2026-03-26T00:00:00Z".to_string(),
                last_used_at: None,
                archived_at: None,
            },
            BrowserProfileRecord {
                id: "existing-1".to_string(),
                profile_key: "research_attach".to_string(),
                name: "研究附着".to_string(),
                description: None,
                site_scope: None,
                launch_url: Some("https://github.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ExistingSession,
                profile_dir: String::new(),
                managed_profile_dir: None,
                created_at: "2026-03-26T00:00:00Z".to_string(),
                updated_at: "2026-03-26T00:00:00Z".to_string(),
                last_used_at: None,
                archived_at: None,
            },
        ];

        let selected = select_preferred_site_profile_key(
            &profiles,
            "github.com",
            &HashSet::new(),
            &attached_profile_keys,
        );

        assert_eq!(selected.as_deref(), Some("research_attach"));
    }

    #[test]
    fn should_fall_back_to_matching_managed_profile_when_existing_session_is_not_attached() {
        let profiles = vec![
            BrowserProfileRecord {
                id: "existing-1".to_string(),
                profile_key: "research_attach".to_string(),
                name: "研究附着".to_string(),
                description: None,
                site_scope: Some("github.com".to_string()),
                launch_url: Some("https://github.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ExistingSession,
                profile_dir: String::new(),
                managed_profile_dir: None,
                created_at: "2026-03-26T00:00:00Z".to_string(),
                updated_at: "2026-03-26T00:00:00Z".to_string(),
                last_used_at: None,
                archived_at: None,
            },
            BrowserProfileRecord {
                id: "managed-1".to_string(),
                profile_key: "general_browser_assist".to_string(),
                name: "通用资料".to_string(),
                description: None,
                site_scope: Some("github.com".to_string()),
                launch_url: Some("https://github.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
                profile_dir: "/tmp/managed".to_string(),
                managed_profile_dir: Some("/tmp/managed".to_string()),
                created_at: "2026-03-26T00:00:00Z".to_string(),
                updated_at: "2026-03-26T00:00:00Z".to_string(),
                last_used_at: None,
                archived_at: None,
            },
        ];

        let selected = select_preferred_site_profile_key(
            &profiles,
            "github.com",
            &HashSet::new(),
            &HashSet::new(),
        );

        assert_eq!(selected.as_deref(), Some("general_browser_assist"));
    }

    #[test]
    fn should_prefer_observer_only_profile_before_managed_profile() {
        let profiles = vec![BrowserProfileRecord {
            id: "managed-1".to_string(),
            profile_key: "general_browser_assist".to_string(),
            name: "通用资料".to_string(),
            description: None,
            site_scope: Some("github.com".to_string()),
            launch_url: Some("https://github.com".to_string()),
            transport_kind: BrowserProfileTransportKind::ManagedCdp,
            profile_dir: "/tmp/managed".to_string(),
            managed_profile_dir: Some("/tmp/managed".to_string()),
            created_at: "2026-03-26T00:00:00Z".to_string(),
            updated_at: "2026-03-26T00:00:00Z".to_string(),
            last_used_at: None,
            archived_at: None,
        }];
        let observers = vec![ChromeBridgeObserverSnapshot {
            client_id: "observer-1".to_string(),
            profile_key: "live_browser".to_string(),
            connected_at: "2026-03-26T00:00:00Z".to_string(),
            user_agent: Some("Chrome".to_string()),
            last_heartbeat_at: Some("2026-03-26T00:00:01Z".to_string()),
            last_page_info: Some(chrome_bridge::ChromeBridgePageInfo {
                title: Some("GitHub".to_string()),
                url: Some("https://github.com/trending".to_string()),
                markdown: "GitHub".to_string(),
                updated_at: "2026-03-26T00:00:01Z".to_string(),
            }),
        }];

        let selected = select_auto_profile_key(&profiles, &observers, "github.com");

        assert_eq!(selected.as_deref(), Some("live_browser"));
    }

    #[test]
    fn should_route_observer_only_profile_as_existing_session() {
        assert_eq!(
            resolve_transport_route_from_state(None, true),
            SiteAdapterTransportRoute::ExistingSession
        );
        assert_eq!(
            resolve_transport_route_from_state(Some(BrowserProfileTransportKind::ManagedCdp), true,),
            SiteAdapterTransportRoute::ManagedCdp
        );
    }

    #[test]
    fn should_select_matching_existing_session_tab_before_active_non_matching_tab() {
        let selected = select_existing_session_target(
            &[
                ExistingSessionTabRecord {
                    id: "tab-1".to_string(),
                    index: 0,
                    url: Some("https://www.36kr.com/newsflashes".to_string()),
                    active: true,
                },
                ExistingSessionTabRecord {
                    id: "tab-2".to_string(),
                    index: 1,
                    url: Some(
                        "https://github.com/search?q=model%20context%20protocol&type=repositories"
                            .to_string(),
                    ),
                    active: false,
                },
            ],
            "github.com",
        )
        .expect("应该选中匹配域名的标签页");

        assert_eq!(selected.id, "tab-2");
    }

    #[test]
    fn should_ignore_non_matching_existing_session_tabs() {
        let selected = select_existing_session_target(
            &[ExistingSessionTabRecord {
                id: "tab-1".to_string(),
                index: 0,
                url: Some("https://outlook.live.com/mail/".to_string()),
                active: true,
            }],
            "x.com",
        );

        assert!(selected.is_none());
    }

    #[tokio::test]
    async fn should_mark_attached_observer_as_ready_when_control_can_auto_open_target_page() {
        let db = setup_test_db();
        let spec = find_site_adapter_spec("x/article-export")
            .expect("registry should load")
            .expect("x adapter should exist");
        let hub = chrome_bridge::chrome_bridge_hub();
        let observer_client_id = format!("observer-test-{}", uuid::Uuid::new_v4());
        let control_client_id = format!("control-test-{}", uuid::Uuid::new_v4());
        let (observer_tx, mut observer_rx) = mpsc::unbounded_channel::<String>();
        let (control_tx, _control_rx) = mpsc::unbounded_channel::<String>();

        hub.register_observer(
            observer_client_id.clone(),
            Some("default".to_string()),
            Some("Chrome".to_string()),
            observer_tx,
        )
        .await;
        hub.register_control(
            control_client_id.clone(),
            Some("Chrome".to_string()),
            control_tx,
        )
        .await;
        hub.handle_observer_page_info_update(
            &observer_client_id,
            "# Outlook\nURL: https://outlook.live.com/mail/".to_string(),
        )
        .await;

        let hub_for_task = hub.clone();
        let observer_client_id_for_task = observer_client_id.clone();
        let responder = tokio::spawn(async move {
            let message = observer_rx.recv().await.expect("应收到 list_tabs 命令");
            let payload: Value = serde_json::from_str(&message).expect("命令消息应是合法 JSON");
            let data = payload
                .get("data")
                .and_then(Value::as_object)
                .expect("命令消息应包含 data");
            assert_eq!(
                data.get("command").and_then(Value::as_str),
                Some("list_tabs")
            );
            let request_id = data
                .get("requestId")
                .and_then(Value::as_str)
                .expect("应包含 requestId")
                .to_string();
            hub_for_task
                .handle_observer_command_result(
                    &observer_client_id_for_task,
                    ObserverCommandResultPayload {
                        request_id,
                        status: "success".to_string(),
                        message: Some("ok".to_string()),
                        error: None,
                        data: Some(json!({
                            "tabs": [
                                {
                                    "id": "outlook-tab",
                                    "index": 0,
                                    "url": "https://outlook.live.com/mail/",
                                    "active": true
                                }
                            ]
                        })),
                    },
                )
                .await;
        });

        let readiness =
            resolve_site_adapter_launch_readiness_for_spec(&db, &spec, Some("default"), None)
                .await
                .expect("readiness should resolve");

        responder.await.expect("bridge responder should finish");
        hub.unregister_observer(&observer_client_id).await;
        hub.unregister_control(&control_client_id).await;

        assert_eq!(readiness.status, SiteAdapterLaunchReadinessStatus::Ready);
        assert_eq!(readiness.profile_key.as_deref(), Some("default"));
        assert_eq!(readiness.target_id, None);
        assert!(readiness.message.contains("自动打开"));
    }

    #[test]
    fn should_rank_observer_context_before_scope_only_recommendations() {
        let github = find_site_adapter_spec("github/search")
            .expect("registry should load")
            .expect("github spec should exist");
        let zhihu = find_site_adapter_spec("zhihu/search")
            .expect("registry should load")
            .expect("zhihu spec should exist");
        let profiles = vec![
            BrowserProfileRecord {
                id: "existing-1".to_string(),
                profile_key: "research_attach".to_string(),
                name: "研究附着".to_string(),
                description: None,
                site_scope: None,
                launch_url: Some("https://github.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ExistingSession,
                profile_dir: String::new(),
                managed_profile_dir: None,
                created_at: "2026-03-26T00:00:00Z".to_string(),
                updated_at: "2026-03-26T00:00:00Z".to_string(),
                last_used_at: None,
                archived_at: None,
            },
            BrowserProfileRecord {
                id: "managed-1".to_string(),
                profile_key: "zhihu_scope".to_string(),
                name: "知乎资料".to_string(),
                description: None,
                site_scope: Some("www.zhihu.com".to_string()),
                launch_url: Some("https://www.zhihu.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
                profile_dir: "/tmp/managed".to_string(),
                managed_profile_dir: Some("/tmp/managed".to_string()),
                created_at: "2026-03-26T00:00:00Z".to_string(),
                updated_at: "2026-03-26T00:00:00Z".to_string(),
                last_used_at: None,
                archived_at: None,
            },
        ];
        let attached_contexts = vec![ExistingSessionRecommendationContext {
            profile_key: "research_attach".to_string(),
            current_url: Some(
                "https://github.com/search?q=model%20context%20protocol&type=repositories"
                    .to_string(),
            ),
            tabs: vec![ExistingSessionTabRecord {
                id: "tab-github".to_string(),
                index: 0,
                url: Some(
                    "https://github.com/search?q=model%20context%20protocol&type=repositories"
                        .to_string(),
                ),
                active: true,
            }],
        }];

        let recommendations = rank_site_adapter_recommendations(
            &[github, zhihu],
            &profiles,
            &attached_contexts,
            Some(2),
        );

        assert_eq!(recommendations.len(), 2);
        assert_eq!(recommendations[0].adapter.name, "github/search");
        assert_eq!(
            recommendations[0].profile_key.as_deref(),
            Some("research_attach")
        );
        assert_eq!(recommendations[0].target_id.as_deref(), Some("tab-github"));
        assert!(recommendations[0].score > recommendations[1].score);
    }

    #[test]
    fn should_fall_back_to_site_scope_recommendation_without_observer_context() {
        let spec = find_site_adapter_spec("zhihu/search")
            .expect("registry should load")
            .expect("zhihu spec should exist");
        let profiles = vec![BrowserProfileRecord {
            id: "managed-1".to_string(),
            profile_key: "zhihu_scope".to_string(),
            name: "知乎资料".to_string(),
            description: None,
            site_scope: Some("www.zhihu.com".to_string()),
            launch_url: Some("https://www.zhihu.com".to_string()),
            transport_kind: BrowserProfileTransportKind::ManagedCdp,
            profile_dir: "/tmp/managed".to_string(),
            managed_profile_dir: Some("/tmp/managed".to_string()),
            created_at: "2026-03-26T00:00:00Z".to_string(),
            updated_at: "2026-03-26T00:00:00Z".to_string(),
            last_used_at: None,
            archived_at: None,
        }];
        let attached_profile_keys = HashSet::new();

        let candidate = build_site_adapter_recommendation_candidate(
            &spec,
            &profiles,
            &[],
            &attached_profile_keys,
        );

        assert_eq!(candidate.profile_key.as_deref(), Some("zhihu_scope"));
        assert_eq!(candidate.target_id, None);
        assert_eq!(candidate.score, 70);
        assert!(candidate.reason.contains("已绑定站点范围"));
    }

    #[test]
    fn should_normalize_runtime_error_and_report_hint() {
        let spec = find_site_adapter_spec("github/search")
            .expect("registry should load")
            .expect("github spec should exist");

        let result = normalize_adapter_output(
            &spec,
            "general_browser_assist".to_string(),
            "https://github.com/search?q=mcp&type=repositories".to_string(),
            AdapterExecutionState {
                session_id: Some("session-1".to_string()),
                target_id: Some("target-1".to_string()),
                source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
            },
            serde_json::json!({
                "ok": false,
                "error_message": "页面脚本执行失败",
            }),
        );

        assert_eq!(result.error_code.as_deref(), Some("adapter_runtime_error"));
        assert!(result.report_hint.is_some());
    }

    #[test]
    fn should_reject_missing_required_arg() {
        let spec = find_site_adapter_spec("github/search")
            .expect("registry should load")
            .expect("spec exists");
        let error = validate_adapter_args(&spec, &Map::new()).unwrap_err();
        assert!(error.contains("query"));
    }

    #[test]
    fn should_normalize_timeout_range() {
        assert_eq!(normalize_timeout_ms(Some(500)), 1_000);
        assert_eq!(normalize_timeout_ms(Some(200_000)), MAX_TIMEOUT_MS);
        assert_eq!(normalize_timeout_ms(None), DEFAULT_TIMEOUT_MS);
    }

    #[test]
    fn should_keep_adapter_evaluate_timeout_above_minimum() {
        assert_eq!(normalize_adapter_evaluate_timeout_ms(5_000), 30_000);
        assert_eq!(normalize_adapter_evaluate_timeout_ms(45_000), 45_000);
        assert_eq!(
            normalize_adapter_evaluate_timeout_ms(200_000),
            MAX_TIMEOUT_MS
        );
    }

    #[test]
    fn should_detect_navigation_when_url_matches_expected_query() {
        assert!(navigation_reached_expected_page(
            Some("https://github.com/search?type=repositories&q=model%20context%20protocol"),
            Some("https://www.36kr.com/newsflashes"),
            "https://github.com/search?q=model%20context%20protocol&type=repositories",
        ));
    }

    #[test]
    fn should_detect_navigation_when_host_changes_from_previous_page() {
        assert!(navigation_reached_expected_page(
            Some("https://search.bilibili.com/all?keyword=AI%20Agent"),
            Some("https://www.36kr.com/newsflashes"),
            "https://search.bilibili.com/all?keyword=AI%20Agent",
        ));
    }

    #[test]
    fn should_not_accept_stale_page_on_same_host() {
        assert!(!navigation_reached_expected_page(
            Some("https://github.com/search?q=old&type=repositories"),
            Some("https://github.com/search?q=old&type=repositories"),
            "https://github.com/search?q=new&type=repositories",
        ));
    }

    #[test]
    fn should_detect_navigation_timeout_error_from_cdp_message() {
        assert!(looks_like_navigation_timeout_error(
            "导航站点失败: CDP 命令超时: Page.navigate"
        ));
        assert!(looks_like_navigation_timeout_error(
            "CDP command timeout: Page.navigate"
        ));
        assert!(!looks_like_navigation_timeout_error(
            "CDP 命令超时: Runtime.evaluate"
        ));
    }

    #[test]
    fn should_build_site_unreachable_report_hint() {
        let hint = build_site_adapter_report_hint("site_unreachable")
            .expect("site_unreachable 应返回提示");
        assert!(hint.contains("timeout_ms"));
    }

    #[test]
    fn should_build_attached_session_required_report_hint() {
        let hint = build_site_adapter_report_hint("attached_session_required")
            .expect("attached_session_required 应返回提示");
        assert!(hint.contains("不会在后台偷偷启动浏览器"));
    }

    #[tokio::test]
    async fn should_report_requires_browser_runtime_when_no_attached_session_exists() {
        let db = setup_test_db();

        let readiness = get_site_adapter_launch_readiness(
            &db,
            SiteAdapterLaunchReadinessRequest {
                adapter_name: "github/search".to_string(),
                profile_key: None,
                target_id: None,
            },
        )
        .await
        .expect("readiness should resolve");

        assert_eq!(
            readiness.status,
            SiteAdapterLaunchReadinessStatus::RequiresBrowserRuntime
        );
        assert!(readiness.message.contains("浏览器工作台"));
    }

    #[tokio::test]
    async fn should_block_managed_profile_when_attached_session_is_required() {
        let db = setup_test_db();
        {
            let conn = lock_db(&db).expect("lock db should succeed");
            BrowserProfileDao::upsert(
                &conn,
                &UpsertBrowserProfileInput {
                    id: None,
                    profile_key: "managed-github".to_string(),
                    name: "托管 GitHub".to_string(),
                    description: Some("托管浏览器".to_string()),
                    site_scope: Some("github.com".to_string()),
                    launch_url: Some("https://github.com".to_string()),
                    transport_kind: BrowserProfileTransportKind::ManagedCdp,
                    profile_dir: "/tmp/managed-github".to_string(),
                    managed_profile_dir: Some("/tmp/managed-github".to_string()),
                },
            )
            .expect("managed profile should save");
        }

        let result = run_site_adapter(
            &db,
            RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp"}),
                profile_key: Some("managed-github".to_string()),
                target_id: None,
                timeout_ms: Some(5_000),
                content_id: None,
                project_id: None,
                save_title: None,
                require_attached_session: Some(true),
                skill_title: Some("GitHub 仓库线索检索".to_string()),
            },
        )
        .await;

        assert!(!result.ok);
        assert_eq!(
            result.error_code.as_deref(),
            Some("attached_session_required")
        );
    }

    #[test]
    fn should_save_existing_site_result_to_project_as_document() {
        let db = setup_test_db();
        let active_adapter = get_site_adapter("github/search").expect("github/search should exist");
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "站点采集项目".to_string(),
                workspace_root.path().join("site-capability-project"),
                WorkspaceType::General,
            )
            .expect("创建测试项目失败");
        let request = SaveSiteAdapterResultRequest {
            project_id: Some(workspace.id.clone()),
            content_id: None,
            save_title: Some("GitHub MCP 搜索结果".to_string()),
            run_request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp","limit":5}),
                profile_key: Some("general_browser_assist".to_string()),
                target_id: Some("target-1".to_string()),
                timeout_ms: Some(20_000),
                content_id: None,
                project_id: None,
                save_title: None,
                require_attached_session: None,
                skill_title: None,
            },
            result: SiteAdapterRunResult {
                ok: true,
                adapter: "github/search".to_string(),
                domain: "github.com".to_string(),
                profile_key: "general_browser_assist".to_string(),
                session_id: Some("session-1".to_string()),
                target_id: Some("target-1".to_string()),
                entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
                source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
                data: Some(serde_json::json!({
                    "items": [
                        {"title": "modelcontextprotocol/servers"}
                    ]
                })),
                error_code: None,
                error_message: None,
                auth_hint: Some("请先登录 GitHub。".to_string()),
                report_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let saved_content =
            save_existing_site_result_to_project(&db, request).expect("保存站点结果到项目失败");
        let manager = ContentManager::new(db);
        let content = manager
            .get(&saved_content.content_id)
            .expect("读取内容失败")
            .expect("内容应存在");

        assert_eq!(content.project_id, workspace.id);
        assert_eq!(content.title, "GitHub MCP 搜索结果");
        assert_eq!(content.content_type, ContentType::Document);
        assert!(content.body.contains("# 站点采集结果"));
        assert!(content.body.contains("\"query\": \"mcp\""));
        assert!(content.body.contains("modelcontextprotocol/servers"));
        assert_eq!(
            content
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("siteAdapterName")),
            Some(&serde_json::json!("github/search"))
        );
        let actual_source_kind = content
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("siteAdapterSourceKind"))
            .cloned();
        let expected_source_kind = active_adapter.source_kind.clone().map(Value::String);
        assert_eq!(actual_source_kind, expected_source_kind);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn should_save_markdown_bundle_site_result_to_project_resources() {
        let db = setup_test_db();
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "X 长文项目".to_string(),
                workspace_root.path().join("x-article-export-project"),
                WorkspaceType::General,
            )
            .expect("创建测试项目失败");
        let image_url = "data:image/png;base64,iVBORw0KGgo=".to_string();
        let adapter = get_site_adapter("x/article-export").expect("x/article-export should exist");
        let request = SaveSiteAdapterResultRequest {
            project_id: Some(workspace.id.clone()),
            content_id: None,
            save_title: None,
            run_request: RunSiteAdapterRequest {
                adapter_name: "x/article-export".to_string(),
                args: serde_json::json!({
                    "url": "https://x.com/GoogleCloudTech/article/2033953579824758855"
                }),
                profile_key: Some("general_browser_assist".to_string()),
                target_id: Some("target-1".to_string()),
                timeout_ms: Some(20_000),
                content_id: None,
                project_id: None,
                save_title: None,
                require_attached_session: Some(true),
                skill_title: Some("X 文章转存".to_string()),
            },
            result: SiteAdapterRunResult {
                ok: true,
                adapter: "x/article-export".to_string(),
                domain: "x.com".to_string(),
                profile_key: "general_browser_assist".to_string(),
                session_id: Some("session-1".to_string()),
                target_id: Some("target-1".to_string()),
                entry_url: "https://x.com/GoogleCloudTech/article/2033953579824758855".to_string(),
                source_url: Some(
                    "https://x.com/GoogleCloudTech/article/2033953579824758855".to_string(),
                ),
                data: Some(serde_json::json!({
                    "export_kind": "markdown_bundle",
                    "title": "Google Cloud Agent2Agent 协议简介",
                    "source_url": "https://x.com/GoogleCloudTech/article/2033953579824758855",
                    "author": "Google Cloud Tech",
                    "published_at": "2026-04-07T08:00:00.000Z",
                    "markdown": format!(
                        "这是一篇测试长文。\n\n![封面图]({image_url})\n\n结尾总结。"
                    ),
                    "images": [
                        {
                            "url": image_url,
                            "alt": "封面图",
                            "suggested_file_name": "cover-image.png"
                        }
                    ]
                })),
                error_code: None,
                error_message: None,
                auth_hint: None,
                report_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let saved_content =
            save_existing_site_result_to_project(&db, request).expect("应保存 Markdown 资源包");
        let manager = ContentManager::new(db.clone());
        let content = manager
            .get(&saved_content.content_id)
            .expect("读取内容失败")
            .expect("内容应存在");

        assert_eq!(saved_content.project_id, workspace.id);
        assert_eq!(saved_content.title, "Google Cloud Agent2Agent 协议简介");
        assert_eq!(
            saved_content.project_root_path.as_deref(),
            Some(workspace.root_path.to_string_lossy().as_ref())
        );
        assert_eq!(content.title, "Google Cloud Agent2Agent 协议简介");
        assert!(content.body.contains("images/"));
        assert!(!content.body.contains("data:image"));

        let metadata = content.metadata.as_ref().expect("应写入 metadata");
        assert_eq!(
            metadata.get("siteAdapterExportKind"),
            Some(&serde_json::json!("markdown_bundle"))
        );
        assert_eq!(
            metadata.get("siteAdapterImageCount"),
            Some(&serde_json::json!(1))
        );

        let bundle_dir = metadata
            .get("siteAdapterBundleRelativeDir")
            .and_then(Value::as_str)
            .expect("应记录 bundle 相对目录");
        let markdown_path = metadata
            .get("siteAdapterBundleMarkdownPath")
            .and_then(Value::as_str)
            .expect("应记录 markdown 相对路径");
        assert_eq!(
            saved_content.markdown_relative_path.as_deref(),
            Some(markdown_path)
        );
        let meta_path = metadata
            .get("siteAdapterBundleMetaPath")
            .and_then(Value::as_str)
            .expect("应记录 meta 相对路径");
        assert_eq!(
            saved_content.meta_relative_path.as_deref(),
            Some(meta_path)
        );
        assert_eq!(
            saved_content.bundle_relative_dir.as_deref(),
            Some(bundle_dir)
        );
        let images_relative_dir = metadata
            .get("siteAdapterBundleImagesDir")
            .and_then(Value::as_str)
            .expect("应记录图片目录相对路径");
        assert_eq!(
            saved_content.images_relative_dir.as_deref(),
            Some(images_relative_dir)
        );
        assert_eq!(saved_content.image_count, Some(1));

        let exported_markdown = std::fs::read_to_string(workspace.root_path.join(markdown_path))
            .expect("导出的 Markdown 应存在");
        let exported_meta = std::fs::read_to_string(workspace.root_path.join(meta_path))
            .expect("导出的 meta.json 应存在");
        let image_dir = workspace.root_path.join(bundle_dir).join("images");
        let image_entries = std::fs::read_dir(&image_dir)
            .expect("图片目录应存在")
            .collect::<Result<Vec<_>, _>>()
            .expect("读取图片目录失败");

        assert!(workspace.root_path.join(bundle_dir).exists());
        assert_eq!(image_entries.len(), 1);
        let exported_image_name = image_entries[0]
            .path()
            .file_name()
            .and_then(|value| value.to_str())
            .expect("图片文件名应存在")
            .to_string();
        assert!(exported_markdown.contains(&format!("images/{exported_image_name}")));
        assert!(!exported_markdown.contains("data:image"));
        assert!(exported_meta.contains("\"export_kind\": \"markdown_bundle\""));
        assert!(exported_meta.contains(&exported_image_name));
        let expected_source_kind = adapter.source_kind.clone().map(Value::String);
        assert_eq!(
            metadata.get("siteAdapterName"),
            Some(&serde_json::json!("x/article-export"))
        );
        assert_eq!(
            metadata.get("siteAdapterSourceKind"),
            expected_source_kind.as_ref()
        );
    }

    #[test]
    fn should_reject_saving_failed_site_result() {
        let db = setup_test_db();
        let request = SaveSiteAdapterResultRequest {
            project_id: Some("project-1".to_string()),
            content_id: None,
            save_title: None,
            run_request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp"}),
                profile_key: Some("general_browser_assist".to_string()),
                target_id: None,
                timeout_ms: None,
                content_id: None,
                project_id: None,
                save_title: None,
                require_attached_session: None,
                skill_title: None,
            },
            result: SiteAdapterRunResult {
                ok: false,
                adapter: "github/search".to_string(),
                domain: "github.com".to_string(),
                profile_key: "general_browser_assist".to_string(),
                session_id: None,
                target_id: None,
                entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
                source_url: None,
                data: None,
                error_code: Some("adapter_failed".to_string()),
                error_message: Some("mock error".to_string()),
                auth_hint: None,
                report_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let error =
            save_existing_site_result_to_project(&db, request).expect_err("失败结果不应允许保存");
        assert!(error.contains("仅支持保存成功"));
    }

    #[test]
    fn should_attach_saved_content_when_run_request_includes_project_id() {
        let db = setup_test_db();
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "站点采集项目".to_string(),
                workspace_root
                    .path()
                    .join("site-capability-auto-save-project"),
                WorkspaceType::General,
            )
            .expect("创建测试项目失败");
        let request = RunSiteAdapterRequest {
            adapter_name: "github/search".to_string(),
            args: serde_json::json!({"query":"mcp","limit":5}),
            profile_key: Some("general_browser_assist".to_string()),
            target_id: Some("target-1".to_string()),
            timeout_ms: Some(20_000),
            content_id: None,
            project_id: Some(workspace.id.clone()),
            save_title: Some("自动保存的 GitHub MCP 搜索结果".to_string()),
            require_attached_session: None,
            skill_title: None,
        };
        let result = SiteAdapterRunResult {
            ok: true,
            adapter: "github/search".to_string(),
            domain: "github.com".to_string(),
            profile_key: "general_browser_assist".to_string(),
            session_id: Some("session-1".to_string()),
            target_id: Some("target-1".to_string()),
            entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
            source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
            data: Some(serde_json::json!({
                "items": [
                    {"title": "modelcontextprotocol/servers"}
                ]
            })),
            error_code: None,
            error_message: None,
            auth_hint: Some("请先登录 GitHub。".to_string()),
            report_hint: None,
            saved_content: None,
            saved_project_id: None,
            saved_by: None,
            save_skipped_project_id: None,
            save_skipped_by: None,
            save_error_message: None,
        };

        let saved_result = attach_requested_site_result_save(&db, &request, result);
        let manager = ContentManager::new(db);
        let saved_content = saved_result.saved_content.as_ref().expect("应写入保存结果");
        let content = manager
            .get(&saved_content.content_id)
            .expect("读取内容失败")
            .expect("内容应存在");

        assert_eq!(
            saved_result.saved_project_id.as_deref(),
            Some(workspace.id.as_str())
        );
        assert_eq!(
            saved_result.saved_by.as_deref(),
            Some(EXPLICIT_PROJECT_SAVE_SOURCE)
        );
        assert_eq!(saved_result.save_error_message, None);
        assert_eq!(
            saved_content.project_root_path.as_deref(),
            Some(workspace.root_path.to_string_lossy().as_ref())
        );
        assert_eq!(content.project_id, workspace.id);
        assert_eq!(content.title, "自动保存的 GitHub MCP 搜索结果");
    }

    #[test]
    fn should_mark_save_skipped_when_project_save_is_requested_for_failed_run() {
        let db = setup_test_db();
        let request = RunSiteAdapterRequest {
            adapter_name: "github/search".to_string(),
            args: serde_json::json!({"query":"mcp"}),
            profile_key: Some("general_browser_assist".to_string()),
            target_id: None,
            timeout_ms: None,
            content_id: None,
            project_id: Some("project-1".to_string()),
            save_title: None,
            require_attached_session: None,
            skill_title: None,
        };
        let result = SiteAdapterRunResult {
            ok: false,
            adapter: "github/search".to_string(),
            domain: "github.com".to_string(),
            profile_key: "general_browser_assist".to_string(),
            session_id: None,
            target_id: None,
            entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
            source_url: None,
            data: None,
            error_code: Some("adapter_failed".to_string()),
            error_message: Some("mock error".to_string()),
            auth_hint: None,
            report_hint: None,
            saved_content: None,
            saved_project_id: None,
            saved_by: None,
            save_skipped_project_id: None,
            save_skipped_by: None,
            save_error_message: None,
        };

        let saved_result = attach_requested_site_result_save(&db, &request, result);

        assert!(saved_result.saved_content.is_none());
        assert_eq!(
            saved_result.save_skipped_project_id.as_deref(),
            Some("project-1")
        );
        assert_eq!(
            saved_result.save_skipped_by.as_deref(),
            Some(EXPLICIT_PROJECT_SAVE_SOURCE)
        );
    }

    #[tokio::test]
    async fn should_route_existing_session_without_transport_block_error() {
        let db = setup_test_db();
        {
            let conn = lock_db(&db).expect("lock db should succeed");
            BrowserProfileDao::upsert(
                &conn,
                &UpsertBrowserProfileInput {
                    id: None,
                    profile_key: "weibo_attach".to_string(),
                    name: "微博附着".to_string(),
                    description: Some("附着当前 Chrome".to_string()),
                    site_scope: Some("weibo.com".to_string()),
                    launch_url: Some("https://weibo.com".to_string()),
                    transport_kind: BrowserProfileTransportKind::ExistingSession,
                    profile_dir: String::new(),
                    managed_profile_dir: None,
                },
            )
            .expect("existing_session profile should save");
        }

        let result = run_site_adapter(
            &db,
            RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp"}),
                profile_key: Some("weibo_attach".to_string()),
                target_id: None,
                timeout_ms: Some(5_000),
                content_id: None,
                project_id: None,
                save_title: None,
                require_attached_session: None,
                skill_title: None,
            },
        )
        .await;

        assert!(!result.ok);
        assert_ne!(
            result.error_code.as_deref(),
            Some("unsupported_profile_transport")
        );
        assert_eq!(result.error_code.as_deref(), Some("no_matching_context"));
        assert!(
            result
                .error_message
                .unwrap_or_default()
                .contains("Chrome observer")
                || result.auth_hint.unwrap_or_default().contains("GitHub")
        );
    }

    #[test]
    fn should_save_existing_site_result_to_current_content() {
        let db = setup_test_db();
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "站点采集项目".to_string(),
                workspace_root
                    .path()
                    .join("site-capability-current-content-project"),
                WorkspaceType::General,
            )
            .expect("创建测试项目失败");
        let manager = ContentManager::new(db.clone());
        let existing = manager
            .create(ContentCreateRequest {
                project_id: workspace.id.clone(),
                title: "当前主稿".to_string(),
                content_type: Some(ContentType::Document),
                order: None,
                body: Some("旧内容".to_string()),
                metadata: Some(serde_json::json!({
                    "artifactKind": "roadmap",
                    "siteAdapterName": "legacy/adapter"
                })),
            })
            .expect("创建测试内容失败");

        let request = SaveSiteAdapterResultRequest {
            project_id: None,
            content_id: Some(existing.id.clone()),
            save_title: Some("这个标题不应覆盖当前主稿".to_string()),
            run_request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp","limit":5}),
                profile_key: Some("general_browser_assist".to_string()),
                target_id: Some("target-1".to_string()),
                timeout_ms: Some(20_000),
                content_id: Some(existing.id.clone()),
                project_id: None,
                save_title: Some("不会用于当前主稿".to_string()),
                require_attached_session: None,
                skill_title: None,
            },
            result: SiteAdapterRunResult {
                ok: true,
                adapter: "github/search".to_string(),
                domain: "github.com".to_string(),
                profile_key: "general_browser_assist".to_string(),
                session_id: Some("session-1".to_string()),
                target_id: Some("target-1".to_string()),
                entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
                source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
                data: Some(serde_json::json!({
                    "items": [
                        {"title": "modelcontextprotocol/servers"}
                    ]
                })),
                error_code: None,
                error_message: None,
                auth_hint: Some("请先登录 GitHub。".to_string()),
                report_hint: Some("建议继续筛选 star > 1000 的仓库。".to_string()),
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let saved_content =
            save_existing_site_result_to_project(&db, request).expect("应写回当前主稿内容");
        let updated = manager
            .get(&existing.id)
            .expect("读取内容失败")
            .expect("内容应存在");

        assert_eq!(saved_content.content_id, existing.id);
        assert_eq!(saved_content.project_id, workspace.id);
        assert_eq!(saved_content.title, "当前主稿");
        assert_eq!(updated.title, "当前主稿");
        assert!(updated.body.contains("# 站点采集结果"));
        assert_eq!(
            updated
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("artifactKind")),
            Some(&serde_json::json!("roadmap"))
        );
        assert_eq!(
            updated
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("siteAdapterName")),
            Some(&serde_json::json!("github/search"))
        );
        assert_eq!(
            updated
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("siteAdapterReportHint")),
            Some(&serde_json::json!("建议继续筛选 star > 1000 的仓库。"))
        );
    }

    #[test]
    fn should_attach_saved_content_when_run_request_includes_content_id() {
        let db = setup_test_db();
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "站点采集项目".to_string(),
                workspace_root
                    .path()
                    .join("site-capability-current-content-auto-save"),
                WorkspaceType::General,
            )
            .expect("创建测试项目失败");
        let manager = ContentManager::new(db.clone());
        let existing = manager
            .create(ContentCreateRequest {
                project_id: workspace.id.clone(),
                title: "当前主稿".to_string(),
                content_type: Some(ContentType::Document),
                order: None,
                body: Some("旧内容".to_string()),
                metadata: Some(serde_json::json!({
                    "artifactKind": "roadmap"
                })),
            })
            .expect("创建测试内容失败");

        let request = RunSiteAdapterRequest {
            adapter_name: "github/search".to_string(),
            args: serde_json::json!({"query":"mcp","limit":5}),
            profile_key: Some("general_browser_assist".to_string()),
            target_id: Some("target-1".to_string()),
            timeout_ms: Some(20_000),
            content_id: Some(existing.id.clone()),
            project_id: None,
            save_title: Some("不应覆盖当前主稿标题".to_string()),
            require_attached_session: None,
            skill_title: None,
        };
        let result = SiteAdapterRunResult {
            ok: true,
            adapter: "github/search".to_string(),
            domain: "github.com".to_string(),
            profile_key: "general_browser_assist".to_string(),
            session_id: Some("session-1".to_string()),
            target_id: Some("target-1".to_string()),
            entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
            source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
            data: Some(serde_json::json!({
                "items": [
                    {"title": "modelcontextprotocol/servers"}
                ]
            })),
            error_code: None,
            error_message: None,
            auth_hint: Some("请先登录 GitHub。".to_string()),
            report_hint: None,
            saved_content: None,
            saved_project_id: None,
            saved_by: None,
            save_skipped_project_id: None,
            save_skipped_by: None,
            save_error_message: None,
        };

        let saved_result = attach_requested_site_result_save(&db, &request, result);
        let updated = manager
            .get(&existing.id)
            .expect("读取内容失败")
            .expect("内容应存在");

        assert_eq!(
            saved_result
                .saved_content
                .as_ref()
                .map(|content| content.content_id.as_str()),
            Some(existing.id.as_str())
        );
        assert_eq!(
            saved_result.saved_project_id.as_deref(),
            Some(workspace.id.as_str())
        );
        assert_eq!(
            saved_result.saved_by.as_deref(),
            Some(EXPLICIT_CONTENT_SAVE_SOURCE)
        );
        assert_eq!(updated.title, "当前主稿");
        assert!(updated.body.contains("# 站点采集结果"));
    }
}
