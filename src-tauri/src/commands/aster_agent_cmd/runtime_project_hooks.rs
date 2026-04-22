use super::*;
use crate::agent_tools::catalog::mcp_extension_runtime_name;
use aster::agents::PermissionRequestHookDecision;
use aster::claude_plugin_cache::{
    load_cached_plugin_manifest_json, resolve_claude_manifest_relative_path,
    resolve_claude_plugin_cache_entries, ClaudeManifestRelativePathKind,
};
#[cfg(test)]
use aster::hooks::{
    get_matching_session_hooks, run_hooks_with_registry, run_pre_compact_hooks_with_registry,
    run_session_end_hooks_with_registry, run_user_prompt_submit_hooks_with_registry,
};
use aster::hooks::{
    is_blocked, load_project_hooks_to_registry, run_hooks_with_registry_and_context,
    run_pre_compact_hooks_with_registry_and_context,
    run_session_end_hooks_with_registry_and_context, run_session_start_hooks_with_registry,
    run_session_start_hooks_with_registry_and_context,
    run_user_prompt_submit_hooks_with_registry_and_context, CompactTrigger, FrontmatterHooks,
    HookEvent, HookInput, HookRegistry, HookResult, HookRuntimeContext, McpHookConfig,
    SessionEndReason, SessionHookRegistrationReport, SessionSource,
};
use rmcp::model::{CallToolRequestParam, CallToolResult, Content, ErrorData, RawContent};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

pub(crate) fn load_runtime_project_hook_registry(
    workspace_root: &str,
) -> Result<Arc<HookRegistry>, String> {
    let trimmed_workspace_root = workspace_root.trim();
    if trimmed_workspace_root.is_empty() {
        return Err("workspace_root 不能为空".to_string());
    }

    load_runtime_project_hook_registry_with_home(
        Path::new(trimmed_workspace_root),
        dirs::home_dir().as_deref(),
    )
}

fn load_runtime_project_hook_registry_with_home(
    workspace_root: &Path,
    home_dir: Option<&Path>,
) -> Result<Arc<HookRegistry>, String> {
    let registry = Arc::new(HookRegistry::new());
    load_project_hooks_to_registry(workspace_root, &registry)?;

    if let Some(home_dir) = home_dir {
        let report =
            load_runtime_plugin_hook_registry(workspace_root, home_dir, Arc::as_ref(&registry));
        if !report.skipped.is_empty() {
            tracing::warn!(
                "[AsterAgent] plugin hooks 部分跳过: {}",
                report.skipped.join(" | ")
            );
        }
        if report.registered > 0 {
            tracing::info!(
                "[AsterAgent] 已加载 plugin hooks: plugins={}, files={}, inline_specs={}, registered={}",
                report.plugins,
                report.files,
                report.inline_specs,
                report.registered
            );
        }
    }

    Ok(registry)
}

#[derive(Debug, Default)]
struct RuntimePluginHookLoadReport {
    plugins: usize,
    files: usize,
    inline_specs: usize,
    registered: usize,
    skipped: Vec<String>,
}

#[derive(Debug, Clone)]
enum PluginManifestHookEntry {
    Path { source: String, path: PathBuf },
    Inline(serde_json::Value),
}

fn load_runtime_plugin_hook_registry(
    workspace_root: &Path,
    home_dir: &Path,
    registry: &HookRegistry,
) -> RuntimePluginHookLoadReport {
    let resolved_plugins =
        resolve_claude_plugin_cache_entries(Some(workspace_root), Some(home_dir));
    let mut report = RuntimePluginHookLoadReport {
        plugins: resolved_plugins.plugins.len(),
        files: 0,
        inline_specs: 0,
        registered: 0,
        skipped: resolved_plugins.skipped,
    };

    for plugin in resolved_plugins.plugins {
        load_plugin_hooks_from_cached_root(&plugin.plugin_id, &plugin.root, registry, &mut report);
    }

    report
}

fn load_plugin_hooks_from_cached_root(
    plugin_id: &str,
    plugin_root: &Path,
    registry: &HookRegistry,
    report: &mut RuntimePluginHookLoadReport,
) {
    let manifest_hook_entries = match load_cached_plugin_manifest_json(plugin_root) {
        Ok(Some((_manifest_path, manifest))) => match manifest.get("hooks") {
            Some(hooks_spec) => match resolve_plugin_manifest_hook_entries(plugin_root, hooks_spec)
            {
                Ok(entries) => entries,
                Err(error) => {
                    report.skipped.push(format!("{plugin_id}: {error}"));
                    return;
                }
            },
            None => Vec::new(),
        },
        Ok(None) => Vec::new(),
        Err(error) => {
            report.skipped.push(format!("{plugin_id}: {error}"));
            return;
        }
    };

    let mut loaded_hook_files = HashSet::<PathBuf>::new();
    let standard_hooks_path = plugin_root.join("hooks").join("hooks.json");
    load_plugin_hook_file(
        plugin_id,
        &standard_hooks_path,
        None,
        true,
        registry,
        &mut loaded_hook_files,
        report,
    );

    for entry in manifest_hook_entries {
        match entry {
            PluginManifestHookEntry::Path { source, path } => load_plugin_hook_file(
                plugin_id,
                &path,
                Some(source.as_str()),
                false,
                registry,
                &mut loaded_hook_files,
                report,
            ),
            PluginManifestHookEntry::Inline(hooks_spec) => {
                report.inline_specs += 1;
                register_plugin_hook_settings(
                    plugin_id,
                    &format!("{plugin_id} manifest.hooks"),
                    &hooks_spec,
                    registry,
                    report,
                );
            }
        }
    }
}

fn resolve_plugin_manifest_hook_entries(
    plugin_root: &Path,
    hooks_spec: &serde_json::Value,
) -> Result<Vec<PluginManifestHookEntry>, String> {
    match hooks_spec {
        serde_json::Value::String(relative_path) => Ok(vec![PluginManifestHookEntry::Path {
            source: relative_path.clone(),
            path: resolve_claude_manifest_relative_path(
                plugin_root,
                relative_path,
                ClaudeManifestRelativePathKind::JsonFile,
            )
            .map_err(|error| format!("manifest.hooks 路径无效（{}）：{}", relative_path, error))?,
        }]),
        serde_json::Value::Array(entries) => {
            let mut resolved = Vec::new();
            for entry in entries {
                resolved.extend(resolve_plugin_manifest_hook_entries(plugin_root, entry)?);
            }
            Ok(resolved)
        }
        serde_json::Value::Object(_) => {
            Ok(vec![PluginManifestHookEntry::Inline(hooks_spec.clone())])
        }
        _ => Err("manifest.hooks 只能是 ./json 路径、hooks object 或其数组".to_string()),
    }
}

fn load_plugin_hook_file(
    plugin_id: &str,
    hook_path: &Path,
    source_label: Option<&str>,
    missing_is_ok: bool,
    registry: &HookRegistry,
    loaded_hook_files: &mut HashSet<PathBuf>,
    report: &mut RuntimePluginHookLoadReport,
) {
    if !hook_path.exists() {
        if !missing_is_ok {
            report.skipped.push(format!(
                "{plugin_id}: hook 文件不存在 ({})",
                hook_path.display()
            ));
        }
        return;
    }

    let normalized_path = hook_path
        .canonicalize()
        .unwrap_or_else(|_| hook_path.to_path_buf());
    if !loaded_hook_files.insert(normalized_path.clone()) {
        let source_label = source_label
            .map(std::borrow::ToOwned::to_owned)
            .unwrap_or_else(|| hook_path.display().to_string());
        report.skipped.push(format!(
            "{plugin_id}: Duplicate hooks file detected: {} resolves to already-loaded file {}. The standard hooks/hooks.json is loaded automatically, so manifest.hooks should only reference additional hook files.",
            source_label,
            normalized_path.display()
        ));
        return;
    }

    let Ok(content) = fs::read_to_string(hook_path) else {
        report.skipped.push(format!(
            "{plugin_id}: 读取 hook 文件失败 ({})",
            hook_path.display()
        ));
        return;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
        report.skipped.push(format!(
            "{plugin_id}: hook 文件 JSON 解析失败 ({})",
            hook_path.display()
        ));
        return;
    };

    let hook_settings = parsed
        .get("hooks")
        .cloned()
        .unwrap_or_else(|| parsed.clone());
    report.files += 1;
    register_plugin_hook_settings(
        plugin_id,
        normalized_path.to_string_lossy().as_ref(),
        &hook_settings,
        registry,
        report,
    );
}

fn register_plugin_hook_settings(
    plugin_id: &str,
    source_label: &str,
    hook_settings: &serde_json::Value,
    registry: &HookRegistry,
    report: &mut RuntimePluginHookLoadReport,
) {
    let Ok(frontmatter_hooks) = parse_supported_frontmatter_hooks(hook_settings) else {
        report
            .skipped
            .push(format!("{plugin_id}: hooks 配置无效 ({source_label})"));
        return;
    };

    let registration_report = register_frontmatter_hooks_to_registry(registry, &frontmatter_hooks);
    report.registered += registration_report.registered;
    report.skipped.extend(
        registration_report
            .skipped
            .into_iter()
            .map(|item| format!("{plugin_id}: {item} ({source_label})")),
    );
}

fn parse_supported_frontmatter_hooks(
    value: &serde_json::Value,
) -> Result<FrontmatterHooks, String> {
    let Some(object) = value.as_object() else {
        return Err("hooks 必须是 object".to_string());
    };

    let filtered = object
        .iter()
        .filter(|(event_name, _)| parse_supported_hook_event(event_name).is_some())
        .map(|(event_name, hook_value)| (event_name.clone(), hook_value.clone()))
        .collect::<serde_json::Map<_, _>>();

    serde_json::from_value(serde_json::Value::Object(filtered))
        .map_err(|error| format!("解析 hooks 失败: {error}"))
}

fn parse_supported_hook_event(event_name: &str) -> Option<HookEvent> {
    serde_json::from_value::<HookEvent>(serde_json::Value::String(event_name.to_string())).ok()
}

fn register_frontmatter_hooks_to_registry(
    registry: &HookRegistry,
    hooks: &FrontmatterHooks,
) -> SessionHookRegistrationReport {
    let mut report = SessionHookRegistrationReport::default();

    for (event, matchers) in hooks {
        for matcher in matchers {
            for hook in &matcher.hooks {
                match hook.to_registration(matcher.matcher.as_deref()) {
                    Ok(registration) => {
                        registry.register(*event, registration.config);
                        report.registered += 1;
                    }
                    Err(error) => report.skipped.push(format!("{event}: {error}")),
                }
            }
        }
    }

    report
}

fn build_runtime_project_hook_context(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> HookRuntimeContext {
    let db = db.clone();
    let state = state.clone();
    let mcp_manager = mcp_manager.clone();

    HookRuntimeContext::new().with_mcp_executor(Arc::new(move |hook, input| {
        let db = db.clone();
        let state = state.clone();
        let mcp_manager = mcp_manager.clone();
        Box::pin(async move {
            dispatch_runtime_mcp_hook(&db, &state, &mcp_manager, &hook, &input).await
        })
    }))
}

async fn resolve_runtime_hook_extension_manager(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<Arc<aster::agents::extension_manager::ExtensionManager>, String> {
    if !state.is_initialized().await {
        state.init_agent_with_db(db).await?;
    }

    let (_start_ok, start_fail) = ensure_lime_mcp_servers_running(db, mcp_manager).await;
    let (_inject_ok, inject_fail) = inject_mcp_extensions(state, mcp_manager).await;

    if start_fail > 0 {
        tracing::warn!(
            "[AsterAgent] MCP hook 预热时有 {} 个 server 启动失败，结果可能不完整",
            start_fail
        );
    }
    if inject_fail > 0 {
        tracing::warn!(
            "[AsterAgent] MCP hook 预热时有 {} 个 extension 注入失败，结果可能不完整",
            inject_fail
        );
    }

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent 未初始化，无法执行 MCP hook")?;
    Ok(agent.extension_manager.clone())
}

fn build_runtime_mcp_tool_call(hook: &McpHookConfig) -> Result<CallToolRequestParam, String> {
    let server = hook.server.trim();
    if server.is_empty() {
        return Err("MCP hook 缺少 server".to_string());
    }

    let tool = hook.tool.trim();
    if tool.is_empty() {
        return Err("MCP hook 缺少 tool".to_string());
    }

    let arguments = match hook.tool_args.clone().unwrap_or(serde_json::Value::Null) {
        serde_json::Value::Null => None,
        serde_json::Value::Object(map) => Some(map),
        _ => {
            return Err("MCP hook 的 tool_args 必须是 JSON object 或 null".to_string());
        }
    };

    Ok(CallToolRequestParam {
        name: format!("{}__{}", mcp_extension_runtime_name(server), tool).into(),
        arguments,
    })
}

fn parse_mcp_hook_blocked_payload(value: &serde_json::Value) -> Option<String> {
    if value.get("blocked").and_then(serde_json::Value::as_bool) != Some(true) {
        return None;
    }

    Some(
        value
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Blocked by MCP hook")
            .to_string(),
    )
}

fn parse_mcp_hook_blocked_text(text: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| parse_mcp_hook_blocked_payload(&value))
}

fn serialize_mcp_hook_content(content: &Content) -> Option<String> {
    match &content.raw {
        RawContent::Text(text) => Some(text.text.clone()),
        RawContent::Image(image) => Some(format!("[image:{}]", image.mime_type)),
        RawContent::Audio(audio) => Some(format!("[audio:{}]", audio.mime_type)),
        RawContent::Resource(resource) => match &resource.resource {
            rmcp::model::ResourceContents::TextResourceContents { uri, text, .. } => {
                Some(format!("{uri}\n{text}"))
            }
            rmcp::model::ResourceContents::BlobResourceContents { uri, .. } => {
                Some(format!("[resource:{uri}]"))
            }
        },
        RawContent::ResourceLink(link) => Some(format!("{} ({})", link.name, link.uri)),
    }
}

fn convert_runtime_mcp_call_result(result: CallToolResult) -> HookResult {
    if let Some(message) = result
        .structured_content
        .as_ref()
        .and_then(parse_mcp_hook_blocked_payload)
    {
        return HookResult::blocked(message);
    }

    if let Some(message) = result
        .content
        .iter()
        .filter_map(|content| content.as_text())
        .find_map(|text| parse_mcp_hook_blocked_text(&text.text))
    {
        return HookResult::blocked(message);
    }

    let mut output_parts = result
        .content
        .iter()
        .filter_map(serialize_mcp_hook_content)
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();

    if let Some(structured) = result.structured_content.as_ref() {
        let structured_text = structured.to_string();
        if !structured_text.trim().is_empty() {
            output_parts.push(structured_text);
        }
    }

    let output = (!output_parts.is_empty()).then(|| output_parts.join("\n\n"));

    if result.is_error == Some(true) {
        return HookResult::failure(output.unwrap_or_else(|| "MCP hook 返回错误结果".to_string()));
    }

    HookResult::success(output)
}

fn convert_runtime_mcp_call_error(error: ErrorData) -> HookResult {
    HookResult::failure(error.to_string())
}

async fn dispatch_runtime_mcp_hook(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    hook: &McpHookConfig,
    _input: &aster::hooks::HookInput,
) -> HookResult {
    let tool_call = match build_runtime_mcp_tool_call(hook) {
        Ok(tool_call) => tool_call,
        Err(error) => return HookResult::failure(error),
    };

    let extension_manager =
        match resolve_runtime_hook_extension_manager(db, state, mcp_manager).await {
            Ok(manager) => manager,
            Err(error) => return HookResult::failure(format!("MCP hook 初始化失败: {error}")),
        };

    let dispatched = match extension_manager
        .dispatch_tool_call(tool_call, CancellationToken::default())
        .await
    {
        Ok(result) => result,
        Err(error) => return HookResult::failure(format!("MCP hook 调用失败: {error}")),
    };

    match dispatched.result.await {
        Ok(result) => convert_runtime_mcp_call_result(result),
        Err(error) => convert_runtime_mcp_call_error(error),
    }
}

fn log_runtime_project_hook_results(event_name: &str, results: &[HookResult]) {
    for result in results {
        if result.blocked {
            tracing::warn!(
                "[AsterAgent] {} hook 返回 blocked，但当前入口不会因此中断: {}",
                event_name,
                result.block_message.as_deref().unwrap_or("未提供阻止原因")
            );
            continue;
        }

        if !result.success {
            tracing::warn!(
                "[AsterAgent] {} hook 执行失败: {}",
                event_name,
                result.error.as_deref().unwrap_or("未知错误")
            );
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeStopHookContinuationRequest {
    stop_reason: Option<String>,
}

fn parse_runtime_stop_hook_continuation_request(
    results: &[HookResult],
) -> Option<RuntimeStopHookContinuationRequest> {
    for result in results {
        let Some(output) = result.output.as_deref() else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(output) else {
            continue;
        };
        if json.get("continue").and_then(serde_json::Value::as_bool) != Some(false) {
            continue;
        }

        let stop_reason = json
            .get("stopReason")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        return Some(RuntimeStopHookContinuationRequest { stop_reason });
    }

    None
}

fn build_runtime_stop_hook_unsupported_warning_message(
    request: &RuntimeStopHookContinuationRequest,
) -> String {
    let stop_reason_suffix = request
        .stop_reason
        .as_deref()
        .map(|reason| format!(" (stopReason={reason})"))
        .unwrap_or_default();

    format!(
        "Stop hook 请求 continue=false{stop_reason_suffix}，但 Lime 当前 runtime 仍无与 Claude Code 等价的 continuation gate；本次只记录，不会阻断 turn 收尾"
    )
}

fn log_runtime_stop_hook_results(results: &[HookResult]) -> Option<String> {
    log_runtime_project_hook_results("Stop", results);

    if let Some(request) = parse_runtime_stop_hook_continuation_request(results) {
        let message = build_runtime_stop_hook_unsupported_warning_message(&request);
        tracing::warn!("[AsterAgent] {}", message);
        return Some(message);
    }

    None
}

fn build_runtime_session_start_unsupported_warning_message(
    source: SessionSource,
) -> Option<String> {
    let source_label = match source {
        SessionSource::Startup | SessionSource::Compact => return None,
        SessionSource::Resume => "resume",
        SessionSource::Clear => "clear",
    };

    Some(format!(
        "SessionStart hook 请求 source={source_label}，但 Lime 当前 runtime 只有 create_session(startup) 与 compact 的 honest host；本次不会执行这类 lifecycle hook"
    ))
}

fn build_runtime_session_end_unsupported_warning_message(
    reason: SessionEndReason,
) -> Option<String> {
    let reason_label = match reason {
        SessionEndReason::Other => return None,
        SessionEndReason::Clear => "clear",
        SessionEndReason::Logout => "logout",
        SessionEndReason::PromptInputExit => "prompt_input_exit",
    };

    Some(format!(
        "SessionEnd hook 请求 reason={reason_label}，但 Lime 当前 runtime 只有 delete_session -> other 的 honest host；本次不会执行这类 lifecycle hook"
    ))
}

#[derive(Debug, Clone, PartialEq)]
struct RuntimePermissionRequestHookRequest {
    decision: PermissionRequestHookDecision,
    updated_permissions_requested: bool,
    interrupt_requested: bool,
}

fn log_runtime_permission_request_hook_results(
    results: &[HookResult],
    _request: Option<&RuntimePermissionRequestHookRequest>,
) {
    for result in results {
        if result.blocked {
            tracing::warn!(
                "[AsterAgent] PermissionRequest hook 返回 blocked，但当前入口只认 allow/deny JSON: {}",
                result.block_message.as_deref().unwrap_or("未提供阻止原因")
            );
            continue;
        }

        if !result.success {
            tracing::warn!(
                "[AsterAgent] PermissionRequest hook 执行失败: {}",
                result.error.as_deref().unwrap_or("未知错误")
            );
        }
    }
}

fn parse_runtime_permission_request_hook_request(
    results: &[HookResult],
) -> Option<RuntimePermissionRequestHookRequest> {
    for result in results {
        let Some(output) = result.output.as_deref() else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(output) else {
            continue;
        };
        let Some(decision) = json.get("decision").and_then(serde_json::Value::as_str) else {
            continue;
        };

        match decision {
            "allow" => {
                let updated_input = match json.get("updatedInput") {
                    Some(serde_json::Value::Object(value)) => Some(value.clone()),
                    Some(_) => {
                        tracing::warn!(
                            "[AsterAgent] PermissionRequest hook 的 updatedInput 必须是 object，已忽略该 decision"
                        );
                        continue;
                    }
                    None => None,
                };
                return Some(RuntimePermissionRequestHookRequest {
                    decision: PermissionRequestHookDecision::Allow { updated_input },
                    updated_permissions_requested: json.get("updatedPermissions").is_some(),
                    interrupt_requested: false,
                });
            }
            "deny" => {
                let message = json
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string);
                let interrupt_requested = match json.get("interrupt") {
                    Some(serde_json::Value::Bool(value)) => *value,
                    Some(_) => {
                        tracing::warn!(
                            "[AsterAgent] PermissionRequest hook 的 interrupt 必须是 boolean，已忽略该字段"
                        );
                        false
                    }
                    None => false,
                };
                return Some(RuntimePermissionRequestHookRequest {
                    decision: PermissionRequestHookDecision::Deny { message },
                    updated_permissions_requested: false,
                    interrupt_requested,
                });
            }
            _ => continue,
        }
    }

    None
}

fn build_runtime_permission_request_interrupt_reason(message: Option<&str>) -> String {
    let detail = message.map(str::trim).filter(|value| !value.is_empty());
    match detail {
        Some(detail) => format!("PermissionRequest hook 请求中断当前执行：{detail}"),
        None => "PermissionRequest hook 请求中断当前执行".to_string(),
    }
}

fn should_fallback_to_native_permission_approval(
    request: &RuntimePermissionRequestHookRequest,
) -> bool {
    request.updated_permissions_requested
        && matches!(
            request.decision,
            PermissionRequestHookDecision::Allow { .. }
        )
}

fn normalize_runtime_permission_request_hook_request(
    request: Option<RuntimePermissionRequestHookRequest>,
) -> Option<RuntimePermissionRequestHookRequest> {
    let request = request?;
    if should_fallback_to_native_permission_approval(&request) {
        tracing::warn!(
            "[AsterAgent] PermissionRequest hook 请求 allow + updatedPermissions，但 Lime 当前 runtime 仍无与 Claude Code 等价的 permission update host；为避免假对齐，本次回退到原生审批流，不执行 hook allow，也不会应用 updatedInput/updatedPermissions"
        );
        return None;
    }

    Some(request)
}

async fn apply_runtime_permission_request_hook_side_effects(
    state: &AsterAgentState,
    session_id: &str,
    request: &RuntimePermissionRequestHookRequest,
) {
    if !request.interrupt_requested {
        return;
    }

    let cancelled = state.cancel_session(session_id).await;
    if !cancelled {
        tracing::warn!(
            "[AsterAgent] PermissionRequest hook 请求 interrupt=true，但当前 session 未找到可取消的 turn token；本次不会中断当前执行"
        );
        return;
    }

    let reason = match &request.decision {
        PermissionRequestHookDecision::Deny { message } => {
            build_runtime_permission_request_interrupt_reason(message.as_deref())
        }
        PermissionRequestHookDecision::Allow { .. } => {
            "PermissionRequest hook 请求中断当前执行".to_string()
        }
    };
    let _ = state
        .record_interrupt_request(session_id, "hook", &reason)
        .await;
}

#[cfg(test)]
pub(crate) async fn enforce_runtime_turn_user_prompt_submit_hooks(
    prompt: &str,
    session_id: &str,
    workspace_root: &str,
) -> Result<(), String> {
    let registry = load_runtime_project_hook_registry(workspace_root)?;
    let (allowed, message) =
        run_user_prompt_submit_hooks_with_registry(prompt, Some(session_id.to_string()), &registry)
            .await;
    if allowed {
        return Ok(());
    }

    Err(format!(
        "UserPromptSubmit hook 已阻止本次提交：{}",
        message.unwrap_or_else(|| "未提供阻止原因".to_string())
    ))
}

pub(crate) async fn enforce_runtime_turn_user_prompt_submit_hooks_with_runtime(
    prompt: &str,
    session_id: &str,
    workspace_root: &str,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    let registry = load_runtime_project_hook_registry(workspace_root)?;
    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let (allowed, message) = run_user_prompt_submit_hooks_with_registry_and_context(
        prompt,
        Some(session_id.to_string()),
        &registry,
        &runtime,
    )
    .await;
    if allowed {
        return Ok(());
    }

    Err(format!(
        "UserPromptSubmit hook 已阻止本次提交：{}",
        message.unwrap_or_else(|| "未提供阻止原因".to_string())
    ))
}

#[cfg(test)]
pub(crate) async fn decide_runtime_permission_request_project_hooks(
    session_id: &str,
    workspace_root: &str,
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: &str,
    permission_mode: Option<String>,
) -> Result<Option<PermissionRequestHookDecision>, String> {
    let registry = load_runtime_project_hook_registry(workspace_root)
        .map_err(|error| format!("加载 PermissionRequest project hooks 失败: {error}"))?;
    let results = run_hooks_with_registry(
        HookInput {
            event: Some(HookEvent::PermissionRequest),
            tool_name: Some(tool_name.to_string()),
            tool_input,
            tool_use_id: Some(tool_use_id.to_string()),
            session_id: Some(session_id.to_string()),
            permission_mode,
            ..Default::default()
        },
        &registry,
    )
    .await;
    let request = normalize_runtime_permission_request_hook_request(
        parse_runtime_permission_request_hook_request(&results),
    );
    log_runtime_permission_request_hook_results(&results, request.as_ref());
    Ok(request.map(|value| value.decision))
}

pub(crate) async fn decide_runtime_permission_request_project_hooks_with_runtime(
    session_id: &str,
    workspace_root: &str,
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: &str,
    permission_mode: Option<String>,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<Option<PermissionRequestHookDecision>, String> {
    let registry = load_runtime_project_hook_registry(workspace_root)
        .map_err(|error| format!("加载 PermissionRequest project hooks 失败: {error}"))?;
    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let results = run_hooks_with_registry_and_context(
        HookInput {
            event: Some(HookEvent::PermissionRequest),
            tool_name: Some(tool_name.to_string()),
            tool_input,
            tool_use_id: Some(tool_use_id.to_string()),
            session_id: Some(session_id.to_string()),
            permission_mode,
            ..Default::default()
        },
        &registry,
        &runtime,
    )
    .await;
    let request = normalize_runtime_permission_request_hook_request(
        parse_runtime_permission_request_hook_request(&results),
    );
    log_runtime_permission_request_hook_results(&results, request.as_ref());
    if let Some(request) = request.as_ref() {
        apply_runtime_permission_request_hook_side_effects(state, session_id, request).await;
    }
    Ok(request.map(|value| value.decision))
}

#[cfg(test)]
pub(crate) async fn enforce_runtime_pre_compact_project_hooks(
    session_id: &str,
    workspace_root: &str,
    current_tokens: Option<u64>,
    trigger: CompactTrigger,
) -> Result<(), String> {
    let registry = load_runtime_project_hook_registry(workspace_root)
        .map_err(|error| format!("加载 PreCompact project hooks 失败: {error}"))?;
    let results = run_pre_compact_hooks_with_registry(
        Some(session_id.to_string()),
        current_tokens,
        Some(trigger),
        &registry,
    )
    .await;
    log_runtime_project_hook_results("PreCompact", &results);
    let (blocked, message) = is_blocked(&results);
    if !blocked {
        return Ok(());
    }

    Err(format!(
        "PreCompact hook 已阻止本次压缩：{}",
        message.unwrap_or_else(|| "未提供阻止原因".to_string())
    ))
}

pub(crate) async fn enforce_runtime_pre_compact_project_hooks_with_runtime(
    session_id: &str,
    workspace_root: &str,
    current_tokens: Option<u64>,
    trigger: CompactTrigger,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    let registry = load_runtime_project_hook_registry(workspace_root)
        .map_err(|error| format!("加载 PreCompact project hooks 失败: {error}"))?;
    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let results = run_pre_compact_hooks_with_registry_and_context(
        Some(session_id.to_string()),
        current_tokens,
        Some(trigger),
        &registry,
        &runtime,
    )
    .await;
    log_runtime_project_hook_results("PreCompact", &results);
    let (blocked, message) = is_blocked(&results);
    if !blocked {
        return Ok(());
    }

    Err(format!(
        "PreCompact hook 已阻止本次压缩：{}",
        message.unwrap_or_else(|| "未提供阻止原因".to_string())
    ))
}

pub(crate) async fn run_runtime_session_start_project_hooks(
    session_id: &str,
    workspace_root: &str,
    source: SessionSource,
) {
    if let Some(message) = build_runtime_session_start_unsupported_warning_message(source) {
        tracing::warn!("[AsterAgent] {}", message);
        return;
    }

    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 SessionStart project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return;
        }
    };

    let results =
        run_session_start_hooks_with_registry(session_id.to_string(), Some(source), &registry)
            .await;
    log_runtime_project_hook_results("SessionStart", &results);
}

pub(crate) async fn run_runtime_session_start_project_hooks_with_runtime(
    session_id: &str,
    workspace_root: &str,
    source: SessionSource,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) {
    if let Some(message) = build_runtime_session_start_unsupported_warning_message(source) {
        tracing::warn!("[AsterAgent] {}", message);
        return;
    }

    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 SessionStart project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return;
        }
    };

    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let results = run_session_start_hooks_with_registry_and_context(
        session_id.to_string(),
        Some(source),
        &registry,
        &runtime,
    )
    .await;
    log_runtime_project_hook_results("SessionStart", &results);
}

#[cfg(test)]
pub(crate) async fn run_runtime_stop_project_hooks(
    session_id: &str,
    workspace_root: &str,
    stop_hook_active: bool,
    last_assistant_message: Option<&str>,
) -> Option<String> {
    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 Stop project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return None;
        }
    };

    let results = run_hooks_with_registry(
        HookInput {
            event: Some(HookEvent::Stop),
            session_id: Some(session_id.to_string()),
            stop_hook_active: Some(stop_hook_active),
            last_assistant_message: last_assistant_message
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            ..Default::default()
        },
        &registry,
    )
    .await;
    log_runtime_stop_hook_results(&results)
}

pub(crate) async fn run_runtime_stop_project_hooks_with_runtime(
    session_id: &str,
    workspace_root: &str,
    stop_hook_active: bool,
    last_assistant_message: Option<&str>,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Option<String> {
    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 Stop project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return None;
        }
    };

    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let results = run_hooks_with_registry_and_context(
        HookInput {
            event: Some(HookEvent::Stop),
            session_id: Some(session_id.to_string()),
            stop_hook_active: Some(stop_hook_active),
            last_assistant_message: last_assistant_message
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            ..Default::default()
        },
        &registry,
        &runtime,
    )
    .await;
    log_runtime_stop_hook_results(&results)
}

#[cfg(test)]
pub(crate) async fn run_runtime_session_end_project_hooks(
    session_id: &str,
    workspace_root: &str,
    reason: SessionEndReason,
) {
    if let Some(message) = build_runtime_session_end_unsupported_warning_message(reason) {
        tracing::warn!("[AsterAgent] {}", message);
        return;
    }

    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 SessionEnd project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return;
        }
    };

    let results =
        run_session_end_hooks_with_registry(session_id.to_string(), Some(reason), &registry).await;
    log_runtime_project_hook_results("SessionEnd", &results);
}

pub(crate) async fn run_runtime_session_end_project_hooks_with_runtime(
    session_id: &str,
    workspace_root: &str,
    reason: SessionEndReason,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) {
    if let Some(message) = build_runtime_session_end_unsupported_warning_message(reason) {
        tracing::warn!("[AsterAgent] {}", message);
        return;
    }

    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 SessionEnd project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return;
        }
    };

    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let results = run_session_end_hooks_with_registry_and_context(
        session_id.to_string(),
        Some(reason),
        &registry,
        &runtime,
    )
    .await;
    log_runtime_project_hook_results("SessionEnd", &results);
}

pub(crate) fn resolve_runtime_project_hook_workspace_root(
    db: &DbConnection,
    session_id: &str,
) -> Result<String, String> {
    let detail = AsterAgentWrapper::get_session_sync(db, session_id)?;

    if let Some(workspace_id) = detail
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let manager = WorkspaceManager::new(db.clone());
        let workspace_id = workspace_id.to_string();
        match manager.get(&workspace_id) {
            Ok(Some(workspace)) => {
                match ensure_workspace_ready_with_auto_relocate(&manager, &workspace) {
                    Ok(ensured) => {
                        return Ok(ensured.root_path.to_string_lossy().to_string());
                    }
                    Err(error) => {
                        tracing::warn!(
                            "[AsterAgent] 解析 project hooks workspace_root 失败，准备回退 working_dir: session_id={}, workspace_id={}, error={}",
                            session_id,
                            workspace_id,
                            error
                        );
                    }
                }
            }
            Ok(None) => {
                tracing::warn!(
                    "[AsterAgent] project hooks 所属 workspace 不存在，准备回退 working_dir: session_id={}, workspace_id={}",
                    session_id,
                    workspace_id
                );
            }
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 读取 project hooks 所属 workspace 失败，准备回退 working_dir: session_id={}, workspace_id={}, error={}",
                    session_id,
                    workspace_id,
                    error
                );
            }
        }
    }

    detail
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("SessionStart project hooks 缺少可用 workspace_root: {session_id}"))
}

#[cfg(test)]
pub(crate) async fn run_runtime_session_start_project_hooks_for_session(
    db: &DbConnection,
    session_id: &str,
    source: SessionSource,
) {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 SessionStart project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };

    run_runtime_session_start_project_hooks(session_id, &workspace_root, source).await;
}

#[cfg(test)]
pub(crate) async fn run_runtime_stop_project_hooks_for_session(
    db: &DbConnection,
    session_id: &str,
    stop_hook_active: bool,
    last_assistant_message: Option<&str>,
) -> Option<String> {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 Stop project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return None;
        }
    };

    run_runtime_stop_project_hooks(
        session_id,
        &workspace_root,
        stop_hook_active,
        last_assistant_message,
    )
    .await
}

#[cfg(test)]
pub(crate) async fn run_runtime_session_end_project_hooks_for_session(
    db: &DbConnection,
    session_id: &str,
    reason: SessionEndReason,
) {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 SessionEnd project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };

    run_runtime_session_end_project_hooks(session_id, &workspace_root, reason).await;
}

#[cfg(test)]
pub(crate) async fn enforce_runtime_pre_compact_project_hooks_for_session(
    db: &DbConnection,
    session_id: &str,
    current_tokens: Option<u64>,
    trigger: CompactTrigger,
) -> Result<(), String> {
    let workspace_root = resolve_runtime_project_hook_workspace_root(db, session_id)
        .map_err(|error| format!("解析 PreCompact project hooks workspace_root 失败: {error}"))?;

    enforce_runtime_pre_compact_project_hooks(session_id, &workspace_root, current_tokens, trigger)
        .await
}

pub(crate) async fn enforce_runtime_pre_compact_project_hooks_for_session_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    session_id: &str,
    current_tokens: Option<u64>,
    trigger: CompactTrigger,
) -> Result<(), String> {
    let workspace_root = resolve_runtime_project_hook_workspace_root(db, session_id)
        .map_err(|error| format!("解析 PreCompact project hooks workspace_root 失败: {error}"))?;

    enforce_runtime_pre_compact_project_hooks_with_runtime(
        session_id,
        &workspace_root,
        current_tokens,
        trigger,
        db,
        state,
        mcp_manager,
    )
    .await
}

pub(crate) async fn decide_runtime_permission_request_project_hooks_for_session_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    session_id: &str,
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: &str,
    permission_mode: Option<String>,
) -> Result<Option<PermissionRequestHookDecision>, String> {
    let workspace_root =
        resolve_runtime_project_hook_workspace_root(db, session_id).map_err(|error| {
            format!("解析 PermissionRequest project hooks workspace_root 失败: {error}")
        })?;

    decide_runtime_permission_request_project_hooks_with_runtime(
        session_id,
        &workspace_root,
        tool_name,
        tool_input,
        tool_use_id,
        permission_mode,
        db,
        state,
        mcp_manager,
    )
    .await
}

pub(crate) async fn run_runtime_session_start_project_hooks_for_session_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    session_id: &str,
    source: SessionSource,
) {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 SessionStart project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };

    run_runtime_session_start_project_hooks_with_runtime(
        session_id,
        &workspace_root,
        source,
        db,
        state,
        mcp_manager,
    )
    .await;
}

pub(crate) async fn run_runtime_stop_project_hooks_for_session_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    session_id: &str,
    stop_hook_active: bool,
    last_assistant_message: Option<&str>,
) -> Option<String> {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 Stop project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return None;
        }
    };

    run_runtime_stop_project_hooks_with_runtime(
        session_id,
        &workspace_root,
        stop_hook_active,
        last_assistant_message,
        db,
        state,
        mcp_manager,
    )
    .await
}

pub(crate) async fn run_runtime_session_end_project_hooks_for_session_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    session_id: &str,
    reason: SessionEndReason,
) {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 SessionEnd project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };

    run_runtime_session_end_project_hooks_with_runtime(
        session_id,
        &workspace_root,
        reason,
        db,
        state,
        mcp_manager,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::runtime_test_support::shared_aster_runtime_test_root;
    use aster::hooks::{
        clear_session_hooks, register_session_frontmatter_hooks, FrontmatterCommandHookConfig,
        FrontmatterHookCommand, FrontmatterHookMatcher, FrontmatterHooks, HookEvent,
    };
    use aster::session::{
        delete_managed_session, initialize_shared_session_runtime_with_root,
        is_global_session_store_set,
    };
    use lime_core::database::schema::create_tables;
    use lime_services::aster_session_store::LimeSessionStore;
    use rmcp::model::Content;
    use rusqlite::Connection;
    use std::collections::HashMap;
    use tokio::sync::OnceCell;

    async fn ensure_runtime_project_hooks_test_manager() {
        static INIT: OnceCell<()> = OnceCell::const_new();

        INIT.get_or_init(|| async {
            if is_global_session_store_set() {
                return;
            }

            let conn = Connection::open_in_memory().expect("创建内存数据库失败");
            create_tables(&conn).expect("初始化表结构失败");

            let runtime_root = shared_aster_runtime_test_root();
            std::fs::create_dir_all(&runtime_root).expect("创建 runtime 测试目录失败");

            let session_store = Arc::new(LimeSessionStore::new(Arc::new(Mutex::new(conn))));
            initialize_shared_session_runtime_with_root(runtime_root, Some(session_store))
                .await
                .expect("初始化测试 session manager 失败");
        })
        .await;
    }

    fn write_session_start_capture_hook(workspace_root: &Path, output_path: &Path) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {
                        "type": "command",
                        "command": "cat > \"$HOOK_OUTPUT_PATH\"",
                        "blocking": true,
                        "env": {
                            "HOOK_OUTPUT_PATH": output_path.to_string_lossy().to_string(),
                        }
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_session_end_capture_hook(workspace_root: &Path, output_path: &Path) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let settings = serde_json::json!({
            "hooks": {
                "SessionEnd": [
                    {
                        "type": "command",
                        "command": "cat > \"$HOOK_OUTPUT_PATH\"",
                        "blocking": true,
                        "env": {
                            "HOOK_OUTPUT_PATH": output_path.to_string_lossy().to_string(),
                        }
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_stop_capture_hook(workspace_root: &Path, output_path: &Path) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let settings = serde_json::json!({
            "hooks": {
                "Stop": [
                    {
                        "type": "command",
                        "command": "cat > \"$HOOK_OUTPUT_PATH\"",
                        "blocking": true,
                        "env": {
                            "HOOK_OUTPUT_PATH": output_path.to_string_lossy().to_string(),
                        }
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_stop_continuation_hook(workspace_root: &Path, stop_reason: Option<&str>) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let mut payload = serde_json::Map::new();
        payload.insert("continue".to_string(), serde_json::Value::Bool(false));
        if let Some(stop_reason) = stop_reason {
            payload.insert(
                "stopReason".to_string(),
                serde_json::Value::String(stop_reason.to_string()),
            );
        }
        let output = serde_json::Value::Object(payload).to_string();

        let settings = serde_json::json!({
            "hooks": {
                "Stop": [
                    {
                        "type": "command",
                        "command": format!("printf '%s' '{}'", output.replace('\'', "'\\''")),
                        "blocking": true,
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_pre_compact_capture_hook(workspace_root: &Path, output_path: &Path) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let settings = serde_json::json!({
            "hooks": {
                "PreCompact": [
                    {
                        "type": "command",
                        "command": "cat > \"$HOOK_OUTPUT_PATH\"",
                        "blocking": true,
                        "env": {
                            "HOOK_OUTPUT_PATH": output_path.to_string_lossy().to_string(),
                        }
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_blocking_pre_compact_hook(workspace_root: &Path, message: &str) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let blocking_payload = serde_json::json!({
            "blocked": true,
            "message": message,
        })
        .to_string();
        let settings = serde_json::json!({
            "hooks": {
                "PreCompact": [
                    {
                        "type": "command",
                        "command": format!("printf '%s' '{blocking_payload}'; exit 2"),
                        "blocking": true,
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_permission_request_capture_hook(
        workspace_root: &Path,
        output_path: &Path,
        decision: &str,
        message: Option<&str>,
        updated_input: Option<serde_json::Value>,
        updated_permissions: Option<serde_json::Value>,
        interrupt: Option<bool>,
    ) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let mut payload = serde_json::Map::new();
        payload.insert(
            "decision".to_string(),
            serde_json::Value::String(decision.to_string()),
        );
        if let Some(message) = message {
            payload.insert(
                "message".to_string(),
                serde_json::Value::String(message.to_string()),
            );
        }
        if let Some(updated_input) = updated_input {
            payload.insert("updatedInput".to_string(), updated_input);
        }
        if let Some(updated_permissions) = updated_permissions {
            payload.insert("updatedPermissions".to_string(), updated_permissions);
        }
        if let Some(interrupt) = interrupt {
            payload.insert("interrupt".to_string(), serde_json::Value::Bool(interrupt));
        }

        let decision_payload = serde_json::Value::Object(payload).to_string();

        let settings = serde_json::json!({
            "hooks": {
                "PermissionRequest": [
                    {
                        "type": "command",
                        "command": format!(
                            "cat > \"$HOOK_OUTPUT_PATH\"; printf '%s' '{}'",
                            decision_payload.replace('\'', "'\\''"),
                        ),
                        "blocking": true,
                        "env": {
                            "HOOK_OUTPUT_PATH": output_path.to_string_lossy().to_string(),
                        }
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    fn write_enabled_plugin_settings(home_root: &Path, plugin_id: &str) {
        let claude_dir = home_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 home .claude 目录失败");
        let settings = serde_json::json!({
            "enabledPlugins": {
                plugin_id: true
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 plugin settings 失败"),
        )
        .expect("写入 plugin settings 失败");
    }

    fn write_plugin_at_root(
        plugin_root: &Path,
        manifest: serde_json::Value,
        standard_hooks: Option<serde_json::Value>,
    ) {
        write_plugin_at_root_with_manifest_path(
            plugin_root,
            &plugin_root.join(".claude-plugin").join("plugin.json"),
            manifest,
            standard_hooks,
        );
    }

    fn write_plugin_at_root_with_manifest_path(
        plugin_root: &Path,
        manifest_path: &Path,
        manifest: serde_json::Value,
        standard_hooks: Option<serde_json::Value>,
    ) {
        if let Some(parent) = manifest_path.parent() {
            std::fs::create_dir_all(parent).expect("创建 plugin manifest 目录失败");
        }
        std::fs::write(
            manifest_path,
            serde_json::to_string_pretty(&manifest).expect("序列化 plugin manifest 失败"),
        )
        .expect("写入 plugin manifest 失败");

        if let Some(standard_hooks) = standard_hooks {
            std::fs::create_dir_all(plugin_root.join("hooks")).expect("创建 hooks 目录失败");
            std::fs::write(
                plugin_root.join("hooks").join("hooks.json"),
                serde_json::to_string_pretty(&standard_hooks)
                    .expect("序列化 standard plugin hooks 失败"),
            )
            .expect("写入 standard plugin hooks 失败");
        }
    }

    fn write_cached_plugin(
        home_root: &Path,
        plugin_name: &str,
        marketplace: &str,
        version: &str,
        manifest: serde_json::Value,
        standard_hooks: Option<serde_json::Value>,
    ) -> PathBuf {
        let plugin_root = home_root
            .join(".claude")
            .join("plugins")
            .join("cache")
            .join(marketplace)
            .join(plugin_name)
            .join(version);
        write_plugin_at_root(&plugin_root, manifest, standard_hooks);
        plugin_root
    }

    fn write_cached_plugin_with_legacy_manifest(
        home_root: &Path,
        plugin_name: &str,
        marketplace: &str,
        version: &str,
        manifest: serde_json::Value,
        standard_hooks: Option<serde_json::Value>,
    ) -> PathBuf {
        let plugin_root = home_root
            .join(".claude")
            .join("plugins")
            .join("cache")
            .join(marketplace)
            .join(plugin_name)
            .join(version);
        write_plugin_at_root_with_manifest_path(
            &plugin_root,
            &plugin_root.join("plugin.json"),
            manifest,
            standard_hooks,
        );
        plugin_root
    }

    fn write_legacy_cached_plugin(
        home_root: &Path,
        plugin_name: &str,
        manifest: serde_json::Value,
        standard_hooks: Option<serde_json::Value>,
    ) -> PathBuf {
        let plugin_root = home_root
            .join(".claude")
            .join("plugins")
            .join("cache")
            .join(plugin_name);
        write_plugin_at_root(&plugin_root, manifest, standard_hooks);
        plugin_root
    }

    fn shell_quote(path: &Path) -> String {
        format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
    }

    #[tokio::test]
    async fn run_runtime_session_start_project_hooks_for_session_should_use_workspace_root_for_compact_source(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-start-compact.json");
        write_session_start_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime Project Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Project Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        run_runtime_session_start_project_hooks_for_session(
            &db,
            &session_id,
            SessionSource::Compact,
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 hook 输入"),
        )
        .expect("hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("SessionStart")
        );
        assert_eq!(
            hook_input.get("source").and_then(serde_json::Value::as_str),
            Some("compact")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[test]
    fn build_runtime_session_start_unsupported_warning_message_should_allow_only_current_sources() {
        assert_eq!(
            build_runtime_session_start_unsupported_warning_message(SessionSource::Startup),
            None
        );
        assert_eq!(
            build_runtime_session_start_unsupported_warning_message(SessionSource::Compact),
            None
        );
        assert!(
            build_runtime_session_start_unsupported_warning_message(SessionSource::Resume)
                .expect("resume 应提示 unsupported")
                .contains("source=resume")
        );
        assert!(
            build_runtime_session_start_unsupported_warning_message(SessionSource::Clear)
                .expect("clear 应提示 unsupported")
                .contains("source=clear")
        );
    }

    #[tokio::test]
    async fn run_runtime_session_start_project_hooks_for_session_should_skip_unsupported_resume_source(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("session-start-resume-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-start-resume.json");
        write_session_start_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime SessionStart Resume Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime SessionStart Resume Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        run_runtime_session_start_project_hooks_for_session(
            &db,
            &session_id,
            SessionSource::Resume,
        )
        .await;

        assert!(
            !hook_output_path.exists(),
            "unsupported SessionStart resume 不应执行任何 hook"
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn run_runtime_session_start_project_hooks_for_session_should_fallback_to_working_dir_when_workspace_missing(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("working-dir-fallback");
        std::fs::create_dir_all(&workspace_root).expect("创建 working_dir 目录失败");
        let hook_output_path = temp_dir.path().join("session-start-working-dir.json");
        write_session_start_capture_hook(&workspace_root, &hook_output_path);

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Project Hook WorkingDir Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            "workspace-missing".to_string(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        run_runtime_session_start_project_hooks_for_session(
            &db,
            &session_id,
            SessionSource::Compact,
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 fallback hook 输入"),
        )
        .expect("fallback hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("source").and_then(serde_json::Value::as_str),
            Some("compact")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn run_runtime_session_start_project_hooks_for_session_should_merge_session_skill_hooks()
    {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("session-skill-hooks-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-skill-hook.json");

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime Session Skill Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Session Skill Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let mut hooks: FrontmatterHooks = HashMap::new();
        hooks.insert(
            HookEvent::SessionStart,
            vec![FrontmatterHookMatcher {
                matcher: None,
                hooks: vec![FrontmatterHookCommand::Command(
                    FrontmatterCommandHookConfig {
                        command: format!("cat > {}", shell_quote(&hook_output_path)),
                        timeout: None,
                        once: false,
                        shell: None,
                        if_condition: None,
                        status_message: None,
                        async_mode: false,
                        async_rewake: false,
                    },
                )],
            }],
        );

        let report = register_session_frontmatter_hooks(&session_id, &hooks);
        assert_eq!(report.registered, 1);
        assert!(report.skipped.is_empty());

        run_runtime_session_start_project_hooks_for_session(
            &db,
            &session_id,
            SessionSource::Compact,
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 session hook 输入"),
        )
        .expect("session hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("source").and_then(serde_json::Value::as_str),
            Some("compact")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        clear_session_hooks(&session_id);
        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn run_runtime_stop_project_hooks_for_session_should_pass_last_assistant_message_and_flag(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("stop-hook-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("stop-hook-input.json");
        write_stop_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime Stop Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Stop Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        run_runtime_stop_project_hooks_for_session(
            &db,
            &session_id,
            false,
            Some("本回合最后一条 assistant 消息"),
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 Stop hook 输入"),
        )
        .expect("Stop hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("Stop")
        );
        assert_eq!(
            hook_input
                .get("stop_hook_active")
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            hook_input
                .get("last_assistant_message")
                .and_then(serde_json::Value::as_str),
            Some("本回合最后一条 assistant 消息")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn run_runtime_stop_project_hooks_for_session_should_detect_unsupported_continue_false_request(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("stop-hook-continuation-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        write_stop_continuation_hook(&workspace_root, Some("hook asked to stop continuation"));

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime Stop Continuation Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Stop Continuation Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let registry = load_runtime_project_hook_registry(&workspace_root.to_string_lossy())
            .expect("应能加载 stop continuation hook registry");
        let results = run_hooks_with_registry(
            HookInput {
                event: Some(HookEvent::Stop),
                session_id: Some(session_id.clone()),
                stop_hook_active: Some(false),
                last_assistant_message: Some("最后一条消息".to_string()),
                ..Default::default()
            },
            &registry,
        )
        .await;

        assert_eq!(
            parse_runtime_stop_hook_continuation_request(&results),
            Some(RuntimeStopHookContinuationRequest {
                stop_reason: Some("hook asked to stop continuation".to_string()),
            })
        );

        let warning_message = run_runtime_stop_project_hooks_for_session(
            &db,
            &session_id,
            false,
            Some("最后一条消息"),
        )
        .await;
        assert_eq!(
            warning_message,
            Some(build_runtime_stop_hook_unsupported_warning_message(
                &RuntimeStopHookContinuationRequest {
                    stop_reason: Some("hook asked to stop continuation".to_string()),
                }
            ))
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn run_runtime_session_end_project_hooks_for_session_should_pass_reason_and_clear_session_hooks(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("session-end-hook-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-end-hook-input.json");
        write_session_end_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime SessionEnd Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime SessionEnd Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let mut hooks: FrontmatterHooks = HashMap::new();
        hooks.insert(
            HookEvent::SessionEnd,
            vec![FrontmatterHookMatcher {
                matcher: None,
                hooks: vec![FrontmatterHookCommand::Command(
                    FrontmatterCommandHookConfig {
                        command: "printf 'session-end-inline'".to_string(),
                        timeout: None,
                        once: false,
                        shell: None,
                        if_condition: None,
                        status_message: None,
                        async_mode: false,
                        async_rewake: false,
                    },
                )],
            }],
        );
        let report = register_session_frontmatter_hooks(&session_id, &hooks);
        assert_eq!(report.registered, 1);
        assert!(report.skipped.is_empty());
        assert_eq!(
            get_matching_session_hooks(&session_id, HookEvent::SessionEnd, None).len(),
            1
        );

        run_runtime_session_end_project_hooks_for_session(
            &db,
            &session_id,
            SessionEndReason::Other,
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 SessionEnd hook 输入"),
        )
        .expect("SessionEnd hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("SessionEnd")
        );
        assert_eq!(
            hook_input.get("reason").and_then(serde_json::Value::as_str),
            Some("other")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );
        assert!(get_matching_session_hooks(&session_id, HookEvent::SessionEnd, None).is_empty());

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[test]
    fn build_runtime_session_end_unsupported_warning_message_should_allow_only_other_reason() {
        assert_eq!(
            build_runtime_session_end_unsupported_warning_message(SessionEndReason::Other),
            None
        );
        assert!(
            build_runtime_session_end_unsupported_warning_message(SessionEndReason::Clear)
                .expect("clear 应提示 unsupported")
                .contains("reason=clear")
        );
        assert!(
            build_runtime_session_end_unsupported_warning_message(SessionEndReason::Logout)
                .expect("logout 应提示 unsupported")
                .contains("reason=logout")
        );
        assert!(build_runtime_session_end_unsupported_warning_message(
            SessionEndReason::PromptInputExit
        )
        .expect("prompt_input_exit 应提示 unsupported")
        .contains("reason=prompt_input_exit"));
    }

    #[tokio::test]
    async fn run_runtime_session_end_project_hooks_for_session_should_skip_unsupported_clear_reason(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("session-end-clear-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-end-clear.json");
        write_session_end_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime SessionEnd Clear Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime SessionEnd Clear Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let mut hooks: FrontmatterHooks = HashMap::new();
        hooks.insert(
            HookEvent::SessionEnd,
            vec![FrontmatterHookMatcher {
                matcher: None,
                hooks: vec![FrontmatterHookCommand::Command(
                    FrontmatterCommandHookConfig {
                        command: "printf 'session-end-inline'".to_string(),
                        timeout: None,
                        once: false,
                        shell: None,
                        if_condition: None,
                        status_message: None,
                        async_mode: false,
                        async_rewake: false,
                    },
                )],
            }],
        );
        let report = register_session_frontmatter_hooks(&session_id, &hooks);
        assert_eq!(report.registered, 1);

        run_runtime_session_end_project_hooks_for_session(
            &db,
            &session_id,
            SessionEndReason::Clear,
        )
        .await;

        assert!(
            !hook_output_path.exists(),
            "unsupported SessionEnd clear 不应执行任何 hook"
        );
        assert_eq!(
            get_matching_session_hooks(&session_id, HookEvent::SessionEnd, None).len(),
            1,
            "unsupported SessionEnd clear 不应清空 session hooks"
        );

        clear_session_hooks(&session_id);
        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn enforce_runtime_pre_compact_project_hooks_for_session_should_pass_trigger_and_tokens()
    {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("pre-compact-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("pre-compact-input.json");
        write_pre_compact_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PreCompact Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PreCompact Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        enforce_runtime_pre_compact_project_hooks_for_session(
            &db,
            &session_id,
            Some(321),
            CompactTrigger::Manual,
        )
        .await
        .expect("PreCompact hook 不应阻止本次压缩");

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 PreCompact hook 输入"),
        )
        .expect("PreCompact hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("PreCompact")
        );
        assert_eq!(
            hook_input
                .get("trigger")
                .and_then(serde_json::Value::as_str),
            Some("manual")
        );
        assert_eq!(
            hook_input
                .get("current_tokens")
                .and_then(serde_json::Value::as_u64),
            Some(321)
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn enforce_runtime_pre_compact_project_hooks_for_session_should_block_when_hook_blocks() {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("pre-compact-block-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        write_blocking_pre_compact_hook(&workspace_root, "need preserve this context");

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PreCompact Blocking Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PreCompact Blocking Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let error = enforce_runtime_pre_compact_project_hooks_for_session(
            &db,
            &session_id,
            Some(512),
            CompactTrigger::Auto,
        )
        .await
        .expect_err("阻塞型 PreCompact hook 应阻止本次压缩");

        assert!(error.contains("PreCompact hook 已阻止本次压缩"));
        assert!(error.contains("need preserve this context"));

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn decide_runtime_permission_request_project_hooks_for_session_should_capture_permission_mode_and_allow(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("permission-request-allow-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("permission-request-input.json");
        write_permission_request_capture_hook(
            &workspace_root,
            &hook_output_path,
            "allow",
            None,
            None,
            None,
            None,
        );

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PermissionRequest Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PermissionRequest Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let decision = decide_runtime_permission_request_project_hooks(
            &session_id,
            &workspace_root.to_string_lossy(),
            "Bash",
            Some(serde_json::json!({
                "command": "rm -rf tmp"
            })),
            "req-permission-allow",
            Some("default".to_string()),
        )
        .await
        .expect("PermissionRequest hook 执行不应失败");

        assert_eq!(
            decision,
            Some(PermissionRequestHookDecision::Allow {
                updated_input: None
            })
        );

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path)
                .expect("应能读取 PermissionRequest hook 输入"),
        )
        .expect("PermissionRequest hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("PermissionRequest")
        );
        assert_eq!(
            hook_input
                .get("permission_mode")
                .and_then(serde_json::Value::as_str),
            Some("default")
        );
        assert_eq!(
            hook_input
                .get("tool_use_id")
                .and_then(serde_json::Value::as_str),
            Some("req-permission-allow")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn decide_runtime_permission_request_project_hooks_for_session_should_return_updated_input_on_allow(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir
            .path()
            .join("permission-request-updated-input-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir
            .path()
            .join("permission-request-updated-input.json");
        write_permission_request_capture_hook(
            &workspace_root,
            &hook_output_path,
            "allow",
            None,
            Some(serde_json::json!({
                "command": "echo updated by hook",
                "timeout": 1200
            })),
            None,
            None,
        );

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PermissionRequest UpdatedInput Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PermissionRequest UpdatedInput Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let decision = decide_runtime_permission_request_project_hooks(
            &session_id,
            &workspace_root.to_string_lossy(),
            "Bash",
            Some(serde_json::json!({
                "command": "echo original"
            })),
            "req-permission-updated-input",
            Some("default".to_string()),
        )
        .await
        .expect("PermissionRequest updatedInput hook 执行不应失败");

        assert_eq!(
            decision,
            Some(PermissionRequestHookDecision::Allow {
                updated_input: Some({
                    let mut updated_input = serde_json::Map::new();
                    updated_input.insert(
                        "command".to_string(),
                        serde_json::Value::String("echo updated by hook".to_string()),
                    );
                    updated_input.insert(
                        "timeout".to_string(),
                        serde_json::Value::Number(serde_json::Number::from(1200)),
                    );
                    updated_input
                }),
            })
        );

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path)
                .expect("应能读取 PermissionRequest updatedInput hook 输入"),
        )
        .expect("PermissionRequest updatedInput hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("PermissionRequest")
        );
        assert_eq!(
            hook_input
                .get("tool_use_id")
                .and_then(serde_json::Value::as_str),
            Some("req-permission-updated-input")
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn decide_runtime_permission_request_project_hooks_for_session_should_return_deny_message(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("permission-request-deny-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("permission-request-deny.json");
        write_permission_request_capture_hook(
            &workspace_root,
            &hook_output_path,
            "deny",
            Some("need manual review"),
            None,
            None,
            None,
        );

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PermissionRequest Deny Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PermissionRequest Deny Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let decision = decide_runtime_permission_request_project_hooks(
            &session_id,
            &workspace_root.to_string_lossy(),
            "Bash",
            Some(serde_json::json!({
                "command": "git push"
            })),
            "req-permission-deny",
            Some("default".to_string()),
        )
        .await
        .expect("PermissionRequest deny hook 执行不应失败");

        assert_eq!(
            decision,
            Some(PermissionRequestHookDecision::Deny {
                message: Some("need manual review".to_string()),
            })
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn decide_runtime_permission_request_project_hooks_should_fallback_to_native_approval_when_allow_requests_updated_permissions(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir
            .path()
            .join("permission-request-updated-permissions-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir
            .path()
            .join("permission-request-updated-permissions.json");
        write_permission_request_capture_hook(
            &workspace_root,
            &hook_output_path,
            "allow",
            None,
            Some(serde_json::json!({
                "command": "echo rewritten but unsupported"
            })),
            Some(serde_json::json!([
                {
                    "type": "setMode",
                    "mode": "acceptEdits",
                    "destination": "session"
                }
            ])),
            None,
        );

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PermissionRequest UpdatedPermissions Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PermissionRequest UpdatedPermissions Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let decision = decide_runtime_permission_request_project_hooks(
            &session_id,
            &workspace_root.to_string_lossy(),
            "Bash",
            Some(serde_json::json!({
                "command": "echo original"
            })),
            "req-permission-updated-permissions",
            Some("default".to_string()),
        )
        .await
        .expect("PermissionRequest updatedPermissions hook 执行不应失败");

        assert_eq!(decision, None);

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[test]
    fn parse_runtime_permission_request_hook_request_should_detect_updated_permissions_request() {
        let results = vec![HookResult::success(Some(
            serde_json::json!({
                "decision": "allow",
                "updatedPermissions": [
                    {
                        "type": "setMode",
                        "mode": "acceptEdits",
                        "destination": "session"
                    }
                ]
            })
            .to_string(),
        ))];

        assert_eq!(
            parse_runtime_permission_request_hook_request(&results),
            Some(RuntimePermissionRequestHookRequest {
                decision: PermissionRequestHookDecision::Allow {
                    updated_input: None,
                },
                updated_permissions_requested: true,
                interrupt_requested: false,
            })
        );
    }

    #[tokio::test]
    async fn decide_runtime_permission_request_project_hooks_with_runtime_should_interrupt_session_on_deny_interrupt_true(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir
            .path()
            .join("permission-request-interrupt-workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("permission-request-interrupt.json");
        write_permission_request_capture_hook(
            &workspace_root,
            &hook_output_path,
            "deny",
            Some("stop this turn"),
            None,
            None,
            Some(true),
        );

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime PermissionRequest Interrupt Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime PermissionRequest Interrupt Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        let state = AsterAgentState::new();
        let cancel_token = state.create_cancel_token(&session_id).await;
        let mcp_manager: McpManagerState = Arc::new(tokio::sync::Mutex::new(
            crate::mcp::McpClientManager::new(None),
        ));

        let decision = decide_runtime_permission_request_project_hooks_with_runtime(
            &session_id,
            &workspace_root.to_string_lossy(),
            "Bash",
            Some(serde_json::json!({
                "command": "sleep 5"
            })),
            "req-permission-interrupt",
            Some("default".to_string()),
            &db,
            &state,
            &mcp_manager,
        )
        .await
        .expect("PermissionRequest interrupt hook 执行不应失败");

        assert_eq!(
            decision,
            Some(PermissionRequestHookDecision::Deny {
                message: Some("stop this turn".to_string()),
            })
        );
        assert!(cancel_token.is_cancelled());

        let interrupt_marker = state
            .get_interrupt_marker(&session_id)
            .await
            .expect("应记录 PermissionRequest hook interrupt marker");
        assert_eq!(interrupt_marker.source, "hook");
        assert_eq!(
            interrupt_marker.reason,
            "PermissionRequest hook 请求中断当前执行：stop this turn"
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn load_runtime_project_hook_registry_should_include_enabled_plugin_session_start_hooks()
    {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let workspace_root = temp_workspace.path();
        let output_path = temp_workspace.path().join("plugin-session-start.json");
        let plugin_id = "capture-start@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "capture-start",
            "demo-market",
            "1.2.3",
            serde_json::json!({
                "name": "capture-start",
                "version": "1.2.3"
            }),
            Some(serde_json::json!({
                "description": "capture session start",
                "hooks": {
                    "SessionStart": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": format!("cat > {}", shell_quote(&output_path))
                                }
                            ]
                        }
                    ]
                }
            })),
        );

        let registry =
            load_runtime_project_hook_registry_with_home(workspace_root, Some(temp_home.path()))
                .expect("加载 runtime hook registry 失败");
        assert_eq!(registry.count_for_event(HookEvent::SessionStart), 1);

        let results = run_session_start_hooks_with_registry(
            "plugin-session-start".to_string(),
            Some(SessionSource::Startup),
            &registry,
        )
        .await;
        assert_eq!(results.len(), 1);

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&output_path)
                .expect("应能读取 plugin session start hook 输出"),
        )
        .expect("plugin session start hook 输出应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("SessionStart")
        );
        assert_eq!(
            hook_input.get("source").and_then(serde_json::Value::as_str),
            Some("startup")
        );
    }

    #[tokio::test]
    async fn load_runtime_project_hook_registry_should_include_manifest_inline_plugin_user_prompt_hooks(
    ) {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let plugin_id = "prompt-guard@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "prompt-guard",
            "demo-market",
            "2.0.0",
            serde_json::json!({
                "name": "prompt-guard",
                "version": "2.0.0",
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"plugin hook blocked\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            }),
            None,
        );

        let registry = load_runtime_project_hook_registry_with_home(
            temp_workspace.path(),
            Some(temp_home.path()),
        )
        .expect("加载 runtime hook registry 失败");
        assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 1);

        let (allowed, message) = run_user_prompt_submit_hooks_with_registry(
            "please block".trim(),
            Some("plugin-user-prompt-session".to_string()),
            &registry,
        )
        .await;
        assert!(!allowed);
        assert_eq!(message.as_deref(), Some("plugin hook blocked"));
    }

    #[test]
    fn load_runtime_plugin_hook_registry_should_require_dot_slash_manifest_hook_paths() {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let plugin_id = "strict-hook-guard@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        let plugin_root = write_cached_plugin(
            temp_home.path(),
            "strict-hook-guard",
            "demo-market",
            "2.0.0",
            serde_json::json!({
                "name": "strict-hook-guard",
                "version": "2.0.0",
                "hooks": "extra-hooks.json"
            }),
            Some(serde_json::json!({
                "description": "standard hooks should not load when manifest path syntax is invalid",
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"should not load\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            })),
        );
        std::fs::write(
            plugin_root.join("extra-hooks.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"also should not load\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            }))
            .expect("序列化 extra hooks 失败"),
        )
        .expect("写入 extra hooks 失败");

        let registry = HookRegistry::new();
        let report =
            load_runtime_plugin_hook_registry(temp_workspace.path(), temp_home.path(), &registry);

        assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 0);
        assert_eq!(report.registered, 0);
        assert!(
            report
                .skipped
                .iter()
                .any(|item| item.contains("manifest.hooks 路径无效（extra-hooks.json）")),
            "应显式报告缺少 ./ 前缀的 manifest.hooks 路径"
        );
    }

    #[test]
    fn load_runtime_plugin_hook_registry_should_reject_invalid_manifest_commands_before_standard_hooks(
    ) {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let plugin_id = "invalid-command-hook-guard@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "invalid-command-hook-guard",
            "demo-market",
            "2.0.0",
            serde_json::json!({
                "name": "invalid-command-hook-guard",
                "version": "2.0.0",
                "commands": {
                    "about": {
                        "source": "./commands/about.md",
                        "content": "# about"
                    }
                }
            }),
            Some(serde_json::json!({
                "description": "standard hooks should not load when manifest.commands is invalid",
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"should not load\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            })),
        );

        let registry = HookRegistry::new();
        let report =
            load_runtime_plugin_hook_registry(temp_workspace.path(), temp_home.path(), &registry);

        assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 0);
        assert_eq!(report.registered, 0);
        assert!(
            report
                .skipped
                .iter()
                .any(|item| item.contains("manifest.commands[about]")),
            "manifest 其它字段非法时，也应阻断 standard hooks current 加载"
        );
    }

    #[test]
    fn load_runtime_plugin_hook_registry_should_report_duplicate_manifest_hook_files() {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let plugin_id = "duplicate-hook-guard@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin(
            temp_home.path(),
            "duplicate-hook-guard",
            "demo-market",
            "2.0.0",
            serde_json::json!({
                "name": "duplicate-hook-guard",
                "version": "2.0.0",
                "hooks": "./hooks/hooks.json"
            }),
            Some(serde_json::json!({
                "description": "standard hooks",
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"duplicate hook blocked\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            })),
        );

        let registry = HookRegistry::new();
        let report =
            load_runtime_plugin_hook_registry(temp_workspace.path(), temp_home.path(), &registry);

        assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 1);
        assert_eq!(report.registered, 1);
        assert!(
            report
                .skipped
                .iter()
                .any(|item| item.contains("Duplicate hooks file detected: ./hooks/hooks.json")),
            "manifest.hooks 指回 standard hooks/hooks.json 时应显式记为 duplicate"
        );
    }

    #[tokio::test]
    async fn load_runtime_project_hook_registry_should_include_legacy_cached_plugin_user_prompt_hooks(
    ) {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let plugin_id = "legacy-guard@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_legacy_cached_plugin(
            temp_home.path(),
            "legacy-guard",
            serde_json::json!({
                "name": "legacy-guard",
                "version": "0.9.0",
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"legacy plugin hook blocked\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            }),
            None,
        );

        let registry = load_runtime_project_hook_registry_with_home(
            temp_workspace.path(),
            Some(temp_home.path()),
        )
        .expect("加载 runtime hook registry 失败");
        assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 1);

        let (allowed, message) = run_user_prompt_submit_hooks_with_registry(
            "please block via legacy cache",
            Some("plugin-user-prompt-legacy-session".to_string()),
            &registry,
        )
        .await;
        assert!(!allowed);
        assert_eq!(message.as_deref(), Some("legacy plugin hook blocked"));
    }

    #[tokio::test]
    async fn load_runtime_project_hook_registry_should_include_legacy_manifest_plugin_user_prompt_hooks(
    ) {
        let temp_home = tempfile::TempDir::new().expect("create temp home");
        let temp_workspace = tempfile::TempDir::new().expect("create temp workspace");
        let plugin_id = "legacy-manifest-guard@demo-market";

        write_enabled_plugin_settings(temp_home.path(), plugin_id);
        write_cached_plugin_with_legacy_manifest(
            temp_home.path(),
            "legacy-manifest-guard",
            "demo-market",
            "1.0.0",
            serde_json::json!({
                "name": "legacy-manifest-guard",
                "version": "1.0.0",
                "hooks": {
                    "UserPromptSubmit": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "printf '%s' '{\"blocked\":true,\"message\":\"legacy manifest plugin hook blocked\"}'; exit 2"
                                }
                            ]
                        }
                    ]
                }
            }),
            None,
        );

        let registry = load_runtime_project_hook_registry_with_home(
            temp_workspace.path(),
            Some(temp_home.path()),
        )
        .expect("加载 runtime hook registry 失败");
        assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 1);

        let (allowed, message) = run_user_prompt_submit_hooks_with_registry(
            "please block via legacy manifest",
            Some("plugin-user-prompt-legacy-manifest-session".to_string()),
            &registry,
        )
        .await;
        assert!(!allowed);
        assert_eq!(
            message.as_deref(),
            Some("legacy manifest plugin hook blocked")
        );
    }

    #[test]
    fn convert_runtime_mcp_call_result_should_block_from_structured_content() {
        let result = CallToolResult {
            content: vec![Content::text("ignored".to_string())],
            structured_content: Some(serde_json::json!({
                "blocked": true,
                "message": "blocked by structured payload"
            })),
            is_error: Some(false),
            meta: None,
        };

        let converted = convert_runtime_mcp_call_result(result);

        assert!(converted.blocked);
        assert_eq!(
            converted.block_message.as_deref(),
            Some("blocked by structured payload")
        );
    }

    #[test]
    fn convert_runtime_mcp_call_result_should_join_text_and_structured_output() {
        let result = CallToolResult {
            content: vec![Content::text("hello".to_string())],
            structured_content: Some(serde_json::json!({
                "answer": "world"
            })),
            is_error: Some(false),
            meta: None,
        };

        let converted = convert_runtime_mcp_call_result(result);

        assert!(converted.success);
        assert_eq!(
            converted.output.as_deref(),
            Some("hello\n\n{\"answer\":\"world\"}")
        );
    }
}
