use super::*;

#[path = "tool_runtime/browser_tools.rs"]
mod browser_tools;
#[path = "tool_runtime/creation_tools.rs"]
mod creation_tools;
#[path = "tool_runtime/lime_cli_runtime.rs"]
mod lime_cli_runtime;
#[path = "tool_runtime/mcp_resource_tools.rs"]
mod mcp_resource_tools;
#[path = "tool_runtime/media_cli_bridge.rs"]
pub(crate) mod media_cli_bridge;
#[path = "tool_runtime/resource_search_tools.rs"]
mod resource_search_tools;
#[path = "tool_runtime/search_bridge.rs"]
pub(crate) mod search_bridge;
#[path = "tool_runtime/service_skill_tools.rs"]
mod service_skill_tools;
#[path = "tool_runtime/site_tools.rs"]
mod site_tools;
#[path = "tool_runtime/social_tools.rs"]
pub(crate) mod social_tools;
#[path = "tool_runtime/subagent_tools.rs"]
mod subagent_tools;
#[path = "tool_runtime/workspace_tools.rs"]
mod workspace_tools;

pub(crate) use browser_tools::ensure_browser_mcp_tools_registered;
#[allow(unused_imports)]
pub(crate) use browser_tools::LimeBrowserMcpTool;
pub(crate) use creation_tools::ensure_creation_task_tools_registered;
pub(crate) use mcp_resource_tools::ensure_mcp_resource_tools_registered;
#[allow(unused_imports)]
pub(crate) use mcp_resource_tools::{ListMcpResourcesBridgeTool, ReadMcpResourceBridgeTool};
pub(crate) use search_bridge::ensure_tool_search_tool_registered;
#[cfg(test)]
pub(crate) use search_bridge::register_tool_search_tool_to_registry;
#[allow(unused_imports)]
pub(crate) use search_bridge::ToolSearchBridgeTool;
#[allow(unused_imports)]
pub(crate) use service_skill_tools::LimeRunServiceSkillTool;
pub(crate) use social_tools::ensure_social_image_tool_registered;
pub(crate) use social_tools::social_generate_cover_image_cmd;
#[allow(unused_imports)]
pub(crate) use social_tools::SocialGenerateCoverImageTool;
#[cfg(test)]
pub(crate) use subagent_tools::extract_runtime_subagent_result_text;
use workspace_tools::WorkspaceSandboxedBashTool;
#[cfg(test)]
pub(crate) use workspace_tools::{
    encode_tool_result_for_harness_observability, normalize_params_for_durable_memory_support,
    normalize_shell_command_params, normalize_workspace_tool_permission_behavior,
};

async fn resolve_agent_registry(
    state: &AsterAgentState,
) -> Result<
    (
        Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
        Option<Arc<aster::agents::extension_manager::ExtensionManager>>,
    ),
    String,
> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    let extension_manager = agent.extension_manager.clone();
    drop(guard);
    Ok((registry_arc, Some(extension_manager)))
}

fn unregister_named_tools(registry: &mut aster::tools::ToolRegistry, tool_names: &[&str]) {
    for tool_name in tool_names {
        registry.unregister(tool_name);
    }
}

fn sync_workspace_mode_native_tool_surface(
    registry: &mut aster::tools::ToolRegistry,
    surface: WorkspaceToolSurface,
    db: DbConnection,
    api_key_provider_service: Arc<ApiKeyProviderService>,
    app_handle: AppHandle,
    config_manager: Arc<GlobalConfigManager>,
) {
    if surface.browser_assist {
        browser_tools::register_browser_mcp_tools_to_registry(registry, db.clone());
        site_tools::register_site_tools_to_registry(registry, db.clone());
    } else {
        browser_tools::unregister_browser_mcp_tools_from_registry(registry);
        site_tools::unregister_site_tools_from_registry(registry);
    }

    if surface.workbench {
        social_tools::register_social_image_tool_to_registry(registry, config_manager);
        resource_search_tools::register_resource_search_tools_to_registry(
            registry,
            app_handle.clone(),
        );
        service_skill_tools::register_service_skill_tools_to_registry(registry);
        creation_tools::register_creation_task_tools_to_registry(
            registry,
            db,
            api_key_provider_service,
            app_handle,
        );
    } else {
        let workbench_tools = workbench_tool_names();
        unregister_named_tools(registry, &workbench_tools);
        service_skill_tools::unregister_service_skill_tools_from_registry(registry);
    }
}

/// 为指定工作区生成本地 sandbox 权限模板
pub(crate) async fn apply_workspace_sandbox_permissions(
    state: &AsterAgentState,
    config_manager: &GlobalConfigManagerState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    app_handle: &AppHandle,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
    workspace_root: &str,
    runtime_chat_mode: RuntimeChatMode,
    execution_strategy: AsterExecutionStrategy,
) -> Result<WorkspaceSandboxApplyOutcome, String> {
    let workspace_root = workspace_root.trim();
    if workspace_root.is_empty() {
        return Err("workspace 根目录为空".to_string());
    }

    let sandbox_policy = resolve_workspace_sandbox_policy(config_manager);
    let auto_mode = execution_strategy == AsterExecutionStrategy::Auto;
    let current_config = config_manager.config();
    let execution_policy_input = ToolExecutionResolverInput {
        persisted_policy: Some(&current_config.agent.tool_execution),
        request_metadata,
    };
    let lock_service_skill_launch_to_site_tools =
        should_lock_service_skill_launch_to_site_tools(request_metadata);
    let tool_surface = WorkspaceToolSurface {
        workbench: runtime_chat_mode == RuntimeChatMode::Workbench,
        browser_assist: is_browser_assist_enabled(request_metadata),
    };
    let mut sandboxed_bash_tool: Option<WorkspaceSandboxedBashTool> = None;
    let apply_outcome = if !sandbox_policy.enabled {
        WorkspaceSandboxApplyOutcome::DisabledByConfig
    } else {
        match WorkspaceSandboxedBashTool::new(
            workspace_root,
            should_auto_approve_tool_warnings("Bash", auto_mode, execution_policy_input),
            app_handle.clone(),
        ) {
            Ok(tool) => {
                let sandbox_type = tool.sandbox_type().to_string();
                sandboxed_bash_tool = Some(tool);
                WorkspaceSandboxApplyOutcome::Applied { sandbox_type }
            }
            Err(reason) => {
                if sandbox_policy.strict {
                    return Err(format!(
                        "workspace 本地 sandbox 严格模式已启用，初始化失败: {reason}"
                    ));
                }
                WorkspaceSandboxApplyOutcome::UnavailableFallback {
                    warning_message: build_workspace_sandbox_warning_message(&reason),
                    notify_user: sandbox_policy.notify_on_fallback,
                }
            }
        }
    };

    let mut permissions =
        build_workspace_execution_permissions(WorkspaceExecutionPermissionInput {
            surface: tool_surface,
            workspace_root,
            auto_mode,
            execution_policy_input,
        });

    if tool_surface.browser_assist && !lock_service_skill_launch_to_site_tools {
        for tool_name in browser_tools::browser_mcp_tool_names() {
            permissions.push(ToolPermission {
                tool: tool_name,
                allowed: true,
                priority: 88,
                conditions: Vec::new(),
                parameter_restrictions: Vec::new(),
                scope: PermissionScope::Session,
                reason: Some("允许浏览器 MCP 兼容工具".to_string()),
                expires_at: None,
                metadata: HashMap::new(),
            });
        }
    }

    append_browser_assist_session_permissions(&mut permissions, session_id, request_metadata);
    append_image_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_cover_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_video_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_broadcast_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_resource_search_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_research_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_deep_search_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_report_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_site_search_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_pdf_read_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_presentation_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_form_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_summary_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_translation_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_analysis_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_transcription_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_url_parse_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_typesetting_skill_launch_session_permissions(
        &mut permissions,
        session_id,
        request_metadata,
    );
    append_webpage_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);
    append_service_skill_launch_session_permissions(&mut permissions, session_id, request_metadata);

    let (registry_arc, _) = resolve_agent_registry(state).await?;
    let mut registry = registry_arc.write().await;
    let mut permission_manager = ToolPermissionManager::new(None);
    for permission in permissions {
        permission_manager.add_permission(permission, PermissionScope::Session);
    }
    registry.set_permission_manager(Arc::new(permission_manager));

    let task_manager = shared_task_manager();
    workspace_tools::register_workspace_runtime_tools(
        &mut registry,
        task_manager,
        should_auto_approve_tool_warnings("Bash", auto_mode, execution_policy_input),
        app_handle.clone(),
        sandboxed_bash_tool,
    );

    let subagent_runtime = SubagentControlRuntime::new(
        app_handle.clone(),
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    subagent_tools::register_subagent_runtime_tools(&mut registry, subagent_runtime);

    sync_workspace_mode_native_tool_surface(
        &mut registry,
        tool_surface,
        db.clone(),
        api_key_provider_service.0.clone(),
        app_handle.clone(),
        config_manager.0.clone(),
    );
    workspace_tools::wrap_registry_native_tools_for_workspace_runtime(&mut registry);
    prune_image_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_cover_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_video_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_broadcast_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_resource_search_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_research_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_deep_search_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_report_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_site_search_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_pdf_read_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_presentation_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_form_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_summary_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_translation_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_analysis_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_transcription_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_url_parse_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_typesetting_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);
    prune_webpage_skill_launch_detour_tools_from_registry(&mut registry, request_metadata);

    Ok(apply_outcome)
}

pub(crate) async fn ensure_runtime_support_tools_registered(
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    ensure_tool_search_tool_registered(state).await?;
    ensure_mcp_resource_tools_registered(state, mcp_manager).await?;
    Ok(())
}

/// 图片输入
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInput {
    pub data: String,
    pub media_type: String,
}
