use super::*;
use crate::commands::modality_runtime_contracts::{
    browser_control_required_capabilities, browser_control_runtime_contract,
    BROWSER_CONTROL_CONTRACT_KEY, BROWSER_CONTROL_MODALITY, BROWSER_CONTROL_ROUTING_SLOT,
};

pub(crate) const BROWSER_PROFILE_KEY_ENV_KEYS: &[&str] =
    &["LIME_BROWSER_PROFILE_KEY", "PROXYCAST_BROWSER_PROFILE_KEY"];
pub(crate) const BROWSER_ASSIST_ALLOW_PATTERN: &str = "mcp__lime-browser__*";
const BROWSER_ASSIST_DENY_PATTERNS: &[&str] = &["mcp__playwright__*", "browser_*", "playwright*"];

static BROWSER_ASSIST_RUNTIME_HINTS: OnceLock<
    tokio::sync::RwLock<HashMap<String, BrowserAssistRuntimeHint>>,
> = OnceLock::new();

fn shared_browser_assist_runtime_hints(
) -> &'static tokio::sync::RwLock<HashMap<String, BrowserAssistRuntimeHint>> {
    BROWSER_ASSIST_RUNTIME_HINTS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BrowserAssistModalityRuntimeContract {
    pub(crate) contract_key: String,
    pub(crate) modality: String,
    pub(crate) required_capabilities: Vec<String>,
    pub(crate) routing_slot: String,
    pub(crate) runtime_contract: serde_json::Value,
    pub(crate) entry_source: Option<String>,
}

impl BrowserAssistModalityRuntimeContract {
    pub(crate) fn metadata_value(&self) -> serde_json::Value {
        serde_json::json!({
            "contractKey": self.contract_key,
            "modality": self.modality,
            "requiredCapabilities": self.required_capabilities,
            "routingSlot": self.routing_slot,
            "runtimeContract": self.runtime_contract,
            "entrySource": self.entry_source,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BrowserAssistRuntimeHint {
    pub(crate) profile_key: String,
    pub(crate) preferred_backend: Option<BrowserBackendType>,
    pub(crate) auto_launch: bool,
    pub(crate) launch_url: Option<String>,
    pub(crate) modality_runtime_contract: Option<BrowserAssistModalityRuntimeContract>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserTaskRequirement {
    Optional,
    Required,
    RequiredWithUserStep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeChatMode {
    Agent,
    Workbench,
    General,
}

pub(crate) fn parse_browser_backend_hint(value: &str) -> Option<BrowserBackendType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "aster_compat" => Some(BrowserBackendType::AsterCompat),
        "lime_extension_bridge" => Some(BrowserBackendType::LimeExtensionBridge),
        "cdp_direct" => Some(BrowserBackendType::CdpDirect),
        _ => None,
    }
}

fn extract_browser_assist_string(
    browser_assist: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_browser_assist_string_array(
    browser_assist: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Vec<String> {
    keys.iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_browser_assist_value(
    browser_assist: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<serde_json::Value> {
    keys.iter()
        .filter_map(|key| browser_assist.get(*key))
        .find(|value| value.is_object())
        .cloned()
}

pub(crate) fn extract_browser_assist_modality_runtime_contract(
    request_metadata: Option<&serde_json::Value>,
) -> Option<BrowserAssistModalityRuntimeContract> {
    let browser_assist =
        extract_harness_nested_object(request_metadata, &["browser_assist", "browserAssist"])?;
    let contract_key = extract_browser_assist_string(
        browser_assist,
        &["modality_contract_key", "modalityContractKey"],
    )?;
    if contract_key != BROWSER_CONTROL_CONTRACT_KEY {
        return None;
    }

    let required_capabilities = {
        let values = extract_browser_assist_string_array(
            browser_assist,
            &["required_capabilities", "requiredCapabilities"],
        );
        if values.is_empty() {
            browser_control_required_capabilities()
        } else {
            values
        }
    };

    Some(BrowserAssistModalityRuntimeContract {
        contract_key,
        modality: extract_browser_assist_string(browser_assist, &["modality"])
            .unwrap_or_else(|| BROWSER_CONTROL_MODALITY.to_string()),
        required_capabilities,
        routing_slot: extract_browser_assist_string(
            browser_assist,
            &["routing_slot", "routingSlot"],
        )
        .unwrap_or_else(|| BROWSER_CONTROL_ROUTING_SLOT.to_string()),
        runtime_contract: extract_browser_assist_value(
            browser_assist,
            &["runtime_contract", "runtimeContract"],
        )
        .unwrap_or_else(browser_control_runtime_contract),
        entry_source: extract_browser_assist_string(
            browser_assist,
            &["entry_source", "entrySource"],
        ),
    })
}

pub(crate) fn extract_browser_assist_runtime_hint(
    request_metadata: Option<&serde_json::Value>,
) -> Option<BrowserAssistRuntimeHint> {
    let browser_assist =
        extract_harness_nested_object(request_metadata, &["browser_assist", "browserAssist"])?;
    let profile_key = ["profile_key", "profileKey"]
        .iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let preferred_backend = ["preferred_backend", "preferredBackend"]
        .iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_str)
        .and_then(parse_browser_backend_hint);
    let auto_launch = ["auto_launch", "autoLaunch"]
        .iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_bool)
        .unwrap_or(false);
    let launch_url = ["launch_url", "launchUrl", "url"]
        .iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Some(BrowserAssistRuntimeHint {
        profile_key,
        preferred_backend,
        auto_launch,
        launch_url,
        modality_runtime_contract: extract_browser_assist_modality_runtime_contract(
            request_metadata,
        ),
    })
}

pub(crate) fn is_browser_assist_enabled(request_metadata: Option<&serde_json::Value>) -> bool {
    let Some(browser_assist) =
        extract_harness_nested_object(request_metadata, &["browser_assist", "browserAssist"])
    else {
        return false;
    };

    if let Some(enabled) = ["enabled", "is_enabled", "isEnabled"]
        .iter()
        .filter_map(|key| browser_assist.get(*key))
        .find_map(serde_json::Value::as_bool)
    {
        return enabled;
    }

    extract_browser_assist_runtime_hint(request_metadata).is_some() || !browser_assist.is_empty()
}

pub(crate) fn extract_browser_task_requirement(
    request_metadata: Option<&serde_json::Value>,
) -> Option<BrowserTaskRequirement> {
    match extract_harness_string(
        request_metadata,
        &["browser_requirement", "browserRequirement"],
    )
    .as_deref()
    {
        Some("optional") => Some(BrowserTaskRequirement::Optional),
        Some("required") => Some(BrowserTaskRequirement::Required),
        Some("required_with_user_step") => Some(BrowserTaskRequirement::RequiredWithUserStep),
        _ => None,
    }
}

pub(crate) fn apply_browser_requirement_to_request_tool_policy(
    request_metadata: Option<&serde_json::Value>,
    request_web_search: Option<bool>,
    request_search_mode: Option<RequestToolPolicyMode>,
) -> (Option<bool>, Option<RequestToolPolicyMode>) {
    match extract_browser_task_requirement(request_metadata) {
        Some(BrowserTaskRequirement::Required | BrowserTaskRequirement::RequiredWithUserStep) => {
            (Some(false), Some(RequestToolPolicyMode::Disabled))
        }
        _ => (request_web_search, request_search_mode),
    }
}

fn build_session_scoped_permission_conditions(session_id: &str) -> Vec<PermissionCondition> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Vec::new();
    }

    vec![PermissionCondition {
        condition_type: ConditionType::Session,
        field: Some("session_id".to_string()),
        operator: ConditionOperator::Equals,
        value: serde_json::json!(session_id),
        validator: None,
        description: Some("仅对当前聊天会话生效".to_string()),
    }]
}

pub(crate) fn append_browser_assist_session_permissions(
    permissions: &mut Vec<ToolPermission>,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    if !is_browser_assist_enabled(request_metadata) {
        return;
    }

    let conditions = build_session_scoped_permission_conditions(session_id);
    permissions.push(ToolPermission {
        tool: BROWSER_ASSIST_ALLOW_PATTERN.to_string(),
        allowed: true,
        priority: 1100,
        conditions: conditions.clone(),
        parameter_restrictions: Vec::new(),
        scope: PermissionScope::Session,
        reason: Some(
            "Browser Assist 会话已启用：网页任务应统一走 Lime 浏览器运行时工具".to_string(),
        ),
        expires_at: None,
        metadata: HashMap::new(),
    });

    for pattern in BROWSER_ASSIST_DENY_PATTERNS {
        permissions.push(ToolPermission {
            tool: (*pattern).to_string(),
            allowed: false,
            priority: 1200,
            conditions: conditions.clone(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(
                "Browser Assist 会话禁止回退到 Playwright 浏览器工具；请改用 mcp__lime-browser__*，以便右侧画布附着实时浏览器会话"
                    .to_string(),
            ),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }
}

pub(crate) async fn sync_browser_assist_runtime_hint(
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    let mut hints = shared_browser_assist_runtime_hints().write().await;
    if let Some(hint) = extract_browser_assist_runtime_hint(request_metadata) {
        hints.insert(session_id.to_string(), hint);
    } else {
        hints.remove(session_id);
    }
}

pub(crate) async fn get_browser_assist_runtime_hint(
    session_id: &str,
) -> Option<BrowserAssistRuntimeHint> {
    shared_browser_assist_runtime_hints()
        .read()
        .await
        .get(session_id)
        .cloned()
}

pub(crate) fn resolve_runtime_chat_mode(
    request_metadata: Option<&serde_json::Value>,
) -> RuntimeChatMode {
    if let Some(chat_mode) = extract_harness_string(request_metadata, &["chat_mode", "chatMode"]) {
        match chat_mode.as_str() {
            "general" => return RuntimeChatMode::General,
            "workbench" => return RuntimeChatMode::Workbench,
            _ => {}
        }
    }

    match extract_harness_string(request_metadata, &["theme", "harness_theme"]).as_deref() {
        Some("general") => RuntimeChatMode::General,
        _ => RuntimeChatMode::Agent,
    }
}

pub(crate) fn runtime_chat_mode_label(mode: RuntimeChatMode) -> &'static str {
    match mode {
        RuntimeChatMode::Agent => "agent",
        RuntimeChatMode::Workbench => "workbench",
        RuntimeChatMode::General => "general",
    }
}

pub(crate) fn default_web_search_enabled_for_chat_mode(_chat_mode: RuntimeChatMode) -> bool {
    false
}

pub(crate) fn should_enable_model_skill_tool(request_metadata: Option<&serde_json::Value>) -> bool {
    if let Some(explicit) = extract_harness_bool(
        request_metadata,
        &["allow_model_skills", "allowModelSkills"],
    ) {
        return explicit;
    }

    matches!(
        extract_harness_string(request_metadata, &["session_mode", "sessionMode"]).as_deref(),
        Some("general_workbench") | Some("theme_workbench")
    )
}
