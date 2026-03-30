use super::*;
use lime_core::database::dao::browser_profile::BrowserProfileTransportKind;

#[derive(Debug, Clone)]
pub(crate) struct LimeBrowserMcpTool {
    tool_name: String,
    action_name: String,
    description: String,
    input_schema: serde_json::Value,
    db: DbConnection,
}

impl LimeBrowserMcpTool {
    fn new(
        tool_name: String,
        action_name: String,
        description: String,
        input_schema: serde_json::Value,
        db: DbConnection,
    ) -> Self {
        Self {
            tool_name,
            action_name,
            description,
            input_schema,
            db,
        }
    }

    fn parse_backend(params: &serde_json::Value) -> Option<BrowserBackendType> {
        let raw = params.get("backend")?.as_str()?.trim().to_ascii_lowercase();
        parse_browser_backend_hint(&raw)
    }

    fn supports_cdp_direct_action(action_name: &str) -> bool {
        matches!(
            action_name.trim().to_ascii_lowercase().as_str(),
            "tabs_context_mcp"
                | "tabs_create_mcp"
                | "navigate"
                | "find"
                | "computer"
                | "javascript"
                | "javascript_tool"
                | "click"
                | "type"
                | "form_input"
                | "scroll"
                | "scroll_page"
                | "refresh_page"
                | "go_back"
                | "go_forward"
                | "get_page_info"
                | "read_page"
                | "get_page_text"
                | "read_console_messages"
                | "read_network_requests"
        )
    }

    pub(crate) fn resolve_backend(
        action_name: &str,
        params: &serde_json::Value,
        session_hint: Option<&BrowserAssistRuntimeHint>,
    ) -> Option<BrowserBackendType> {
        if let Some(explicit_backend) = Self::parse_backend(params) {
            return Some(explicit_backend);
        }

        match session_hint.and_then(|hint| hint.preferred_backend.clone()) {
            Some(BrowserBackendType::CdpDirect)
                if !Self::supports_cdp_direct_action(action_name) =>
            {
                None
            }
            other => other,
        }
    }

    fn extract_profile_key(params: &serde_json::Value, context: &ToolContext) -> Option<String> {
        if let Some(value) = params.get("profile_key").and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        context
            .environment
            .get(BROWSER_PROFILE_KEY_ENV_KEYS[0])
            .cloned()
            .or_else(|| {
                context
                    .environment
                    .get(BROWSER_PROFILE_KEY_ENV_KEYS[1])
                    .cloned()
            })
    }

    fn extract_launch_url(action_name: &str, params: &serde_json::Value) -> Option<String> {
        let normalized = action_name.trim().to_ascii_lowercase();
        if normalized == "navigate"
            || normalized.ends_with("navigate")
            || normalized == "tabs_create_mcp"
            || normalized.ends_with("tabs_create_mcp")
            || normalized == "open_url"
            || normalized.ends_with("open_url")
        {
            return params
                .get("url")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
        }
        None
    }

    fn load_profile_transport_kind(
        db: &DbConnection,
        profile_key: &str,
    ) -> Option<BrowserProfileTransportKind> {
        let conn = db.lock().ok()?;
        crate::services::browser_profile_service::get_browser_profile_by_key(&conn, profile_key)
            .ok()
            .flatten()
            .map(|profile| profile.transport_kind)
    }

    pub(crate) fn should_auto_launch_managed_browser(
        resolved_backend: Option<BrowserBackendType>,
        session_hint: Option<&BrowserAssistRuntimeHint>,
        profile_transport: Option<BrowserProfileTransportKind>,
    ) -> bool {
        if !session_hint.is_some_and(|hint| hint.auto_launch) {
            return false;
        }

        if matches!(
            profile_transport,
            Some(BrowserProfileTransportKind::ExistingSession)
        ) {
            return false;
        }

        if matches!(
            resolved_backend,
            Some(BrowserBackendType::LimeExtensionBridge)
        ) {
            return false;
        }

        if matches!(
            session_hint.and_then(|hint| hint.preferred_backend.clone()),
            Some(BrowserBackendType::LimeExtensionBridge)
        ) {
            return false;
        }

        true
    }
}

#[async_trait]
impl Tool for LimeBrowserMcpTool {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        self.input_schema.clone()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(90))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let session_hint = get_browser_assist_runtime_hint(&_context.session_id).await;
        let backend = Self::resolve_backend(&self.action_name, &params, session_hint.as_ref());
        let profile_key = Self::extract_profile_key(&params, _context)
            .or_else(|| session_hint.as_ref().map(|hint| hint.profile_key.clone()));
        if let (Some(hint), Some(profile_key)) = (session_hint.as_ref(), profile_key.as_ref()) {
            let profile_transport =
                Self::load_profile_transport_kind(&self.db, profile_key.as_str());
            if Self::should_auto_launch_managed_browser(
                backend.clone(),
                Some(hint),
                profile_transport,
            ) {
                let launch_url = Self::extract_launch_url(&self.action_name, &params)
                    .or_else(|| hint.launch_url.clone());
                ensure_managed_chrome_profile_global(profile_key.clone(), launch_url)
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!("自动启动浏览器协助会话失败: {error}"))
                    })?;
            }
        }
        let timeout_ms = params.get("timeout_ms").and_then(|v| v.as_u64());
        let request = BrowserActionRequest {
            profile_key,
            backend,
            action: self.action_name.clone(),
            args: params,
            timeout_ms,
        };

        let result = browser_execute_action_global(self.db.clone(), request)
            .await
            .map_err(|e| ToolError::execution_failed(format!("浏览器动作执行失败: {e}")))?;

        let payload = serde_json::to_string_pretty(&result)
            .unwrap_or_else(|_| format!("{{\"success\": {}}}", result.success));
        let browser_session_metadata = if result.session_id.is_some() {
            result
                .data
                .as_ref()
                .and_then(|value| value.get("browser_session"))
                .cloned()
                .or_else(|| {
                    Some(serde_json::json!({
                        "session_id": result.session_id.clone(),
                        "target_id": result.target_id.clone(),
                    }))
                })
        } else {
            None
        };

        if result.success {
            let mut tool_result = ToolResult::success(payload)
                .with_metadata("tool_family", serde_json::json!("browser"))
                .with_metadata("action", serde_json::json!(self.action_name))
                .with_metadata(
                    "selected_backend",
                    serde_json::json!(result.backend.clone()),
                )
                .with_metadata("attempt_count", serde_json::json!(result.attempts.len()))
                .with_metadata("attempts", serde_json::json!(result.attempts.clone()))
                .with_metadata("result", serde_json::json!(result.clone()));
            if let Some(browser_session) = browser_session_metadata {
                tool_result = tool_result.with_metadata("browser_session", browser_session);
            }
            Ok(tool_result)
        } else {
            let mut tool_result = ToolResult::error(
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| "浏览器动作执行失败".to_string()),
            )
            .with_metadata("tool_family", serde_json::json!("browser"))
            .with_metadata("action", serde_json::json!(self.action_name))
            .with_metadata(
                "selected_backend",
                serde_json::json!(result.backend.clone()),
            )
            .with_metadata("attempts", serde_json::json!(result.attempts.clone()))
            .with_metadata("result", serde_json::json!(result.clone()));
            if let Some(browser_session) = browser_session_metadata {
                tool_result = tool_result.with_metadata("browser_session", browser_session);
            }
            Ok(tool_result)
        }
    }
}

pub(super) fn browser_mcp_tool_names() -> Vec<String> {
    let mut names = Vec::new();
    for tool in get_chrome_mcp_tools() {
        names.push(format!("{}{}", browser_runtime_tool_prefix(), tool.name));
    }
    names
}

pub(super) fn register_browser_mcp_tools_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    db: DbConnection,
) {
    let tool_defs = get_chrome_mcp_tools();
    for tool_def in tool_defs {
        for prefix in ["mcp__lime-browser__"] {
            let full_name = format!("{prefix}{}", tool_def.name);
            if registry.contains(&full_name) {
                continue;
            }
            let tool = LimeBrowserMcpTool::new(
                full_name,
                tool_def.name.clone(),
                tool_def.description.clone(),
                tool_def.input_schema.clone(),
                db.clone(),
            );
            registry.register(Box::new(tool));
        }
    }
}

pub(super) fn unregister_browser_mcp_tools_from_registry(
    registry: &mut aster::tools::ToolRegistry,
) {
    for tool_name in browser_mcp_tool_names() {
        registry.unregister(&tool_name);
    }
}

pub(crate) async fn ensure_browser_mcp_tools_registered(
    state: &AsterAgentState,
    db: &DbConnection,
) -> Result<(), String> {
    let (registry_arc, extension_manager) = resolve_agent_registry(state).await?;
    let mut registry = registry_arc.write().await;
    register_browser_mcp_tools_to_registry(&mut registry, db.clone());
    search_bridge::register_tool_search_tool_to_registry(
        &mut registry,
        registry_arc.clone(),
        extension_manager,
    );
    Ok(())
}
