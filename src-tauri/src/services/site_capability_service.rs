use crate::commands::webview_cmd::{
    close_cdp_session_global, ensure_managed_chrome_profile_global, list_cdp_targets_global,
    open_cdp_session_global, shared_browser_runtime, BrowserSessionStateRequest,
    ListCdpTargetsRequest, OpenCdpSessionRequest,
};
use crate::content::{ContentCreateRequest, ContentManager, ContentType};
use crate::database::{lock_db, DbConnection};
use crate::services::site_adapter_registry::{
    build_entry_url, find_site_adapter_spec, load_site_adapter_specs, normalize_site_adapter_name,
    SiteAdapterArgType, SiteAdapterSpec,
};
use lime_browser_runtime::{CdpSessionState, CdpTargetInfo};
use lime_core::database::dao::browser_profile::{BrowserProfileDao, BrowserProfileTransportKind};
use lime_server::chrome_bridge::{self, ChromeBridgeCommandRequest, ChromeBridgeCommandResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};
use url::Url;

const DEFAULT_PROFILE_KEY: &str = "default";
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MIN_ADAPTER_EVALUATE_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const EXPLICIT_PROJECT_SAVE_SOURCE: &str = "explicit_project";

#[derive(Debug, Clone, Serialize)]
pub struct SiteAdapterArgumentDefinition {
    pub name: String,
    pub description: String,
    pub required: bool,
    pub arg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
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
    pub project_id: Option<String>,
    #[serde(default)]
    pub save_title: Option<String>,
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
    pub project_id: String,
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
}

#[derive(Debug, Clone)]
struct AdapterExecutionState {
    session_id: Option<String>,
    target_id: Option<String>,
    source_url: Option<String>,
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

    let manager = ContentManager::new(db.clone());
    let title = build_site_result_document_title(&adapter.name, save_title);
    let body = build_site_result_document_body(adapter, request, result);
    let metadata = serde_json::json!({
        "resourceKind": "document",
        "siteAdapterName": adapter.name,
        "siteAdapterDomain": adapter.domain,
        "siteAdapterProfileKey": result.profile_key,
        "siteAdapterEntryUrl": result.entry_url,
        "siteAdapterSourceUrl": result.source_url,
        "siteAdapterSourceKind": adapter.source_kind,
        "siteAdapterSourceVersion": adapter.source_version,
    });
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

    Ok(SavedSiteAdapterContent {
        content_id: content.id,
        project_id: content.project_id,
        title,
    })
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
    save_site_result_to_project(
        db,
        &request.project_id,
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
    let spec = match find_site_adapter_spec(&normalized_name) {
        Ok(Some(spec)) => spec,
        Ok(None) => {
            return SiteAdapterRunResult {
                ok: false,
                adapter: normalized_name,
                domain: String::new(),
                profile_key: resolve_requested_profile_key(request.profile_key.as_deref()),
                session_id: None,
                target_id: None,
                entry_url: String::new(),
                source_url: None,
                data: None,
                error_code: Some("adapter_not_found".to_string()),
                error_message: Some("未找到对应的站点适配器".to_string()),
                auth_hint: None,
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
                profile_key: resolve_requested_profile_key(request.profile_key.as_deref()),
                session_id: None,
                target_id: None,
                entry_url: String::new(),
                source_url: None,
                data: None,
                error_code: Some("internal_error".to_string()),
                error_message: Some(error),
                auth_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            };
        }
    };

    let profile_key = resolve_requested_profile_key(request.profile_key.as_deref());
    let args = match normalize_adapter_args(request.args) {
        Ok(value) => value,
        Err(error) => {
            return build_error_result(
                &spec,
                profile_key,
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
            profile_key,
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
                profile_key,
                None,
                None,
                String::new(),
                "invalid_args",
                &error,
            );
        }
    };

    let transport_route = match resolve_transport_route(db, &profile_key) {
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
    let timeout_ms = normalize_timeout_ms(request.timeout_ms);

    match transport_route {
        SiteAdapterTransportRoute::ExistingSession => {
            run_existing_session_adapter(
                &spec,
                profile_key,
                request.target_id,
                entry_url,
                timeout_ms,
                wrapped_script,
            )
            .await
        }
        SiteAdapterTransportRoute::ManagedCdp => {
            run_managed_cdp_adapter(
                db,
                &spec,
                profile_key,
                request.target_id,
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

fn resolve_requested_profile_key(profile_key: Option<&str>) -> String {
    profile_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PROFILE_KEY)
        .to_string()
}

fn resolve_transport_route(
    db: &DbConnection,
    profile_key: &str,
) -> Result<SiteAdapterTransportRoute, String> {
    match load_profile_transport(db, profile_key)? {
        Some(BrowserProfileTransportKind::ExistingSession) => {
            Ok(SiteAdapterTransportRoute::ExistingSession)
        }
        _ => Ok(SiteAdapterTransportRoute::ManagedCdp),
    }
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

async fn run_existing_session_adapter(
    spec: &SiteAdapterSpec,
    profile_key: String,
    target_id: Option<String>,
    entry_url: String,
    timeout_ms: u64,
    wrapped_script: String,
) -> SiteAdapterRunResult {
    let navigation_result = match execute_bridge_adapter_command(ChromeBridgeCommandRequest {
        profile_key: Some(profile_key.clone()),
        command: "open_url".to_string(),
        target: target_id.clone(),
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
                target_id,
                entry_url,
                "site_unreachable",
                &format!("当前 Chrome 导航失败: {error}"),
            );
        }
    };

    let bridged_target_id = navigation_result
        .data
        .as_ref()
        .and_then(|data| data.get("tab_id"))
        .and_then(value_to_string)
        .or(target_id.clone());
    let latest_source_url = navigation_result
        .page_info
        .as_ref()
        .and_then(|page| page.url.clone());

    let adapter_output = match execute_bridge_adapter_command(ChromeBridgeCommandRequest {
        profile_key: Some(profile_key.clone()),
        command: "run_adapter".to_string(),
        target: bridged_target_id.clone(),
        text: None,
        url: None,
        payload: Some(json!({
            "script": wrapped_script,
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
                "adapter_failed",
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
    if let Err(error) = runtime
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
    let refreshed_session =
        wait_for_navigation_settle(&runtime, refreshed_session, &entry_url, timeout_ms).await;

    let adapter_output = match evaluate_session_script(
        &refreshed_session.session_id,
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
                Some(refreshed_session.session_id),
                Some(refreshed_session.target_id),
                entry_url,
                "adapter_failed",
                &error,
            );
        }
    };

    let latest_session = runtime
        .refresh_page_info(&refreshed_session.session_id)
        .await
        .unwrap_or(refreshed_session);

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

fn attach_requested_site_result_save(
    db: &DbConnection,
    request: &RunSiteAdapterRequest,
    mut result: SiteAdapterRunResult,
) -> SiteAdapterRunResult {
    let Some(project_id) = normalize_optional_project_id(request.project_id.as_deref()) else {
        return result;
    };

    if !result.ok {
        result.save_skipped_project_id = Some(project_id);
        result.save_skipped_by = Some(EXPLICIT_PROJECT_SAVE_SOURCE.to_string());
        return result;
    }

    let adapter_name = normalize_site_adapter_name(&request.adapter_name);
    let Some(adapter) = get_site_adapter(&adapter_name) else {
        result.save_skipped_project_id = Some(project_id);
        result.save_skipped_by = Some(EXPLICIT_PROJECT_SAVE_SOURCE.to_string());
        result.save_error_message = Some("未找到对应的站点适配器".to_string());
        return result;
    };

    match save_site_result_to_project(
        db,
        &project_id,
        request.save_title.as_deref(),
        &adapter,
        request,
        &result,
    ) {
        Ok(saved_content) => {
            result.saved_content = Some(saved_content);
            result.saved_project_id = Some(project_id);
            result.saved_by = Some(EXPLICIT_PROJECT_SAVE_SOURCE.to_string());
        }
        Err(error) => {
            result.save_skipped_project_id = Some(project_id);
            result.save_skipped_by = Some(EXPLICIT_PROJECT_SAVE_SOURCE.to_string());
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
      return result;
    }}
    return {{
      ok: true,
      data: result ?? null,
      source_url: location.href,
    }};
  }} catch (error) {{
    return {{
      ok: false,
      error_code: "adapter_failed",
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
    let error_code = adapter_output
        .get("error_code")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let error_message = adapter_output
        .get("error_message")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let auth_hint = adapter_output
        .get("auth_hint")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| spec.auth_hint.clone());

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
        error_code: Some(error_code.to_string()),
        error_message: Some(error_message.to_string()),
        auth_hint: spec.auth_hint.clone(),
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
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

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
        let github = adapters
            .into_iter()
            .find(|adapter| adapter.name == "github/search")
            .expect("github/search should exist");
        assert_eq!(
            github.example_args["query"],
            Value::String("AI Agent".to_string())
        );
        assert_eq!(github.example_args["limit"], Value::from(5));
        assert_eq!(github.source_kind.as_deref(), Some("bundled"));
    }

    #[test]
    fn should_search_site_adapters_by_keyword() {
        let adapters = search_site_adapters("issue");
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "github/issues");
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
    fn should_save_existing_site_result_to_project_as_document() {
        let db = setup_test_db();
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "站点采集项目".to_string(),
                workspace_root.path().join("site-capability-project"),
                WorkspaceType::Document,
            )
            .expect("创建测试项目失败");
        let request = SaveSiteAdapterResultRequest {
            project_id: workspace.id.clone(),
            save_title: Some("GitHub MCP 搜索结果".to_string()),
            run_request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp","limit":5}),
                profile_key: Some("general_browser_assist".to_string()),
                target_id: Some("target-1".to_string()),
                timeout_ms: Some(20_000),
                project_id: None,
                save_title: None,
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
        assert_eq!(
            content
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("siteAdapterSourceKind")),
            Some(&serde_json::json!("bundled"))
        );
    }

    #[test]
    fn should_reject_saving_failed_site_result() {
        let db = setup_test_db();
        let request = SaveSiteAdapterResultRequest {
            project_id: "project-1".to_string(),
            save_title: None,
            run_request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({"query":"mcp"}),
                profile_key: Some("general_browser_assist".to_string()),
                target_id: None,
                timeout_ms: None,
                project_id: None,
                save_title: None,
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
                WorkspaceType::Document,
            )
            .expect("创建测试项目失败");
        let request = RunSiteAdapterRequest {
            adapter_name: "github/search".to_string(),
            args: serde_json::json!({"query":"mcp","limit":5}),
            profile_key: Some("general_browser_assist".to_string()),
            target_id: Some("target-1".to_string()),
            timeout_ms: Some(20_000),
            project_id: Some(workspace.id.clone()),
            save_title: Some("自动保存的 GitHub MCP 搜索结果".to_string()),
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
            project_id: Some("project-1".to_string()),
            save_title: None,
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
                project_id: None,
                save_title: None,
            },
        )
        .await;

        assert!(!result.ok);
        assert_ne!(
            result.error_code.as_deref(),
            Some("unsupported_profile_transport")
        );
        assert_eq!(result.error_code.as_deref(), Some("site_unreachable"));
        assert!(
            result
                .error_message
                .unwrap_or_default()
                .contains("Chrome observer")
                || result.auth_hint.unwrap_or_default().contains("GitHub")
        );
    }
}
