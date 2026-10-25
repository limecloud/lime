use super::{
    action_response, current_agent_runtime_config_metadata, initialize_runtime_database,
    mcp_bridges, merge_route_model_metadata, plugin_hooks,
    request_context::{
        effective_runtime_options_for_turn, request_tool_policy_from_request,
        runtime_request_from_request, session_config_from_request_with_plugins_and_orchestrator,
        session_scope_from_request,
    },
    tool_events, tool_inventory, RuntimeBackend,
};
use crate::runtime::ToolInventoryReadRequest;
use crate::{
    ActionRespondRequest, AppDataSource, CancelExecutionRequest, ExecutionBackend,
    ExecutionRequest, RuntimeCoreError, RuntimeEvent, RuntimeEventSink, RuntimeHostContext,
};
use agent_runtime::action_required::{ActionTerminalStatus, PendingActionRestoreOutcome};
use agent_runtime::session_loop::RuntimeSessionInputHandle;
use agent_runtime::turn_executor::TurnProviderConfiguration;
use async_trait::async_trait;
use lime_agent::{
    build_agent_turn_context, run_direct_text_generation_with_db,
    AgentTurnContextConfigurationRequest, DirectTextGenerationRequest,
    ModelRouteProviderConfiguration,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

struct PolicyMemoryProvider<'a> {
    backend: &'a RuntimeBackend,
    policy: &'a dyn crate::memory_store::MemorySourcePolicy,
}

#[async_trait]
impl crate::MemoryStageOneProvider for PolicyMemoryProvider<'_> {
    async fn source_eligible(
        &self,
        source_thread_id: Option<&str>,
    ) -> Result<bool, RuntimeCoreError> {
        self.policy.source_eligible(source_thread_id).await
    }

    async fn sample(
        &self,
        request: crate::MemoryStageOneProviderRequest,
    ) -> Result<String, RuntimeCoreError> {
        crate::MemoryStageOneProvider::sample(self.backend, request).await
    }
}

#[async_trait]
impl crate::MemoryStageOneProvider for RuntimeBackend {
    async fn sample(
        &self,
        request: crate::MemoryStageOneProviderRequest,
    ) -> Result<String, RuntimeCoreError> {
        sample_memory_stage(
            self,
            request.provider,
            request.model,
            request.reasoning_effort,
            request.service_tier,
            request.api_version,
            request.route_protocol,
            request.credential_ref,
            request.cwd,
            request.output_schema,
            request.session_id,
            request.thread_id,
            request.turn_id,
            request.system_prompt,
            request.user_prompt,
            "memory stage-1 route is missing provider or model",
        )
        .await
    }
}

async fn sample_memory_stage(
    backend: &RuntimeBackend,
    provider: String,
    model: String,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    api_version: Option<String>,
    route_protocol: app_server_protocol::ProtocolKind,
    credential_ref: Option<String>,
    cwd: Option<std::path::PathBuf>,
    output_schema: serde_json::Value,
    session_id: String,
    thread_id: String,
    turn_id: String,
    system_prompt: String,
    user_prompt: String,
    missing_route_message: &str,
) -> Result<String, RuntimeCoreError> {
    if provider.trim().is_empty() || model.trim().is_empty() {
        return Err(RuntimeCoreError::Backend(missing_route_message.to_string()));
    }
    let db = initialize_runtime_database(backend.db.as_ref())?;
    let turn_context = build_agent_turn_context(AgentTurnContextConfigurationRequest {
        cwd,
        model: Some(model.clone()),
        effort: reasoning_effort.clone(),
        output_schema: Some(output_schema),
        ..Default::default()
    });
    let route_configuration = ModelRouteProviderConfiguration {
        turn_provider: TurnProviderConfiguration::from_model_selection(
            provider,
            model,
            reasoning_effort,
        ),
        service_tier,
        api_version,
        route_protocol: Some(route_protocol),
        credential_ref,
        direct_provider_config: None,
        auth: model_provider::runtime_provider::RuntimeProviderAuth::ApiKey,
    };
    let result = run_direct_text_generation_with_db(
        &backend.agent_state,
        DirectTextGenerationRequest {
            session_id,
            thread_id,
            turn_id,
            system_prompt,
            user_prompt,
            turn_context,
            provider_configuration: Some(route_configuration),
        },
        &db,
    )
    .await
    .map_err(RuntimeCoreError::Backend)?;
    Ok(result.text)
}

pub(super) async fn preflight_thread_settings_route(
    backend: &RuntimeBackend,
    session: &app_server_protocol::AgentSession,
    settings: &app_server_protocol::protocol::v2::ThreadSettings,
) -> Result<(), RuntimeCoreError> {
    let mut runtime_options = app_server_protocol::RuntimeOptions::default();
    let runtime_request = runtime_options.runtime_request_mut();
    runtime_request.provider_preference = Some(settings.model_provider.clone());
    runtime_request.model_preference = Some(settings.model.clone());
    runtime_request.reasoning_effort = settings.effort.clone();
    runtime_request.service_tier = settings.service_tier.clone();
    let request = ExecutionRequest {
        host: RuntimeHostContext::default(),
        session: session.clone(),
        turn: app_server_protocol::AgentTurn {
            turn_id: "thread-settings-preflight".to_string(),
            session_id: session.session_id.clone(),
            thread_id: session.thread_id.clone(),
            status: app_server_protocol::AgentTurnStatus::Accepted,
            started_at: None,
            completed_at: None,
        },
        forked_from_thread_id: None,
        is_root_agent: false,
        input: agent_runtime::reply_input::RuntimeReplyInput::text(
            "thread settings route preflight",
        ),
        runtime_options: Some(runtime_options),
        expected_output: None,
        structured_output: None,
        output_schema: None,
        event_name: None,
        queued_turn_id: None,
        queue_if_busy: false,
        skip_pre_submit_resume: false,
        agent_control_gateway: None,
        command_publisher: None,
        rollout_budget_reminder_source: None,
        mid_turn_compaction_commit: None,
        internal_agent_policy: None,
    };
    let route = backend.resolve_turn_route(&request).await?;
    if let Some(failure) = route.resolution.resolved_route.failure.as_ref() {
        return Err(super::runtime_error_from_route_failure(
            &session.session_id,
            &route.selection,
            failure,
        ));
    }
    if route.selection.provider != settings.model_provider
        || route.selection.model != settings.model
    {
        return Err(RuntimeCoreError::RouteRejected {
            session_id: session.session_id.clone(),
            provider: Some(settings.model_provider.clone()),
            model: Some(settings.model.clone()),
            category: app_server_protocol::RouteFailureCategory::NoCandidate,
            reason_code: "model_switch_fallback_not_allowed".to_string(),
        });
    }
    if settings.effort.is_some() && route.selection.reasoning_effort != settings.effort {
        return Err(RuntimeCoreError::RouteRejected {
            session_id: session.session_id.clone(),
            provider: Some(settings.model_provider.clone()),
            model: Some(settings.model.clone()),
            category: app_server_protocol::RouteFailureCategory::CapabilityGap,
            reason_code: "reasoning_effort_unsupported".to_string(),
        });
    }
    if let Some(service_tier) = settings.service_tier.as_deref() {
        if !route_supports_service_tier(&route.resolution.decision_payload, service_tier) {
            return Err(RuntimeCoreError::RouteRejected {
                session_id: session.session_id.clone(),
                provider: Some(settings.model_provider.clone()),
                model: Some(settings.model.clone()),
                category: app_server_protocol::RouteFailureCategory::CapabilityGap,
                reason_code: "service_tier_unsupported".to_string(),
            });
        }
    }
    Ok(())
}

fn route_supports_service_tier(decision_payload: &Value, requested: &str) -> bool {
    [
        "/modelRegistry/model/service_tiers",
        "/modelRegistry/model/serviceTiers",
    ]
    .into_iter()
    .find_map(|pointer| decision_payload.pointer(pointer).and_then(Value::as_array))
    .is_some_and(|tiers| {
        tiers.iter().any(|tier| {
            tier.as_str()
                .or_else(|| tier.get("id").and_then(Value::as_str))
                .is_some_and(|id| id == requested)
        })
    })
}

#[async_trait]
impl ExecutionBackend for RuntimeBackend {
    async fn compact_context(
        &self,
        request: ExecutionRequest,
        history: crate::ProviderTurnHistory,
        cancellation: CancellationToken,
    ) -> Result<String, RuntimeCoreError> {
        self.summarize_context(request, history, cancellation).await
    }

    fn requires_provider_selection(&self) -> bool {
        true
    }

    fn has_live_session_responses(&self) -> bool {
        true
    }

    fn set_app_data_source(
        &self,
        app_data_source: Arc<dyn AppDataSource>,
    ) -> Result<(), RuntimeCoreError> {
        let mut guard = self.app_data_source.write().map_err(|_| {
            RuntimeCoreError::Backend("memory tool app data source lock poisoned".to_string())
        })?;
        *guard = Some(app_data_source);
        Ok(())
    }

    fn set_current_time_gateway(
        &self,
        gateway: Arc<dyn tool_runtime::current_time::CurrentTimeGateway>,
    ) -> Result<(), RuntimeCoreError> {
        let mut guard = self.current_time_gateway.write().map_err(|_| {
            RuntimeCoreError::Backend("current-time gateway lock poisoned".to_string())
        })?;
        *guard = Some(gateway);
        Ok(())
    }

    fn set_computer_use_gateway(
        &self,
        gateway: Arc<dyn tool_runtime::computer_use::ComputerUseGateway>,
    ) -> Result<(), RuntimeCoreError> {
        *self.computer_use_gateway.write().map_err(|_| {
            RuntimeCoreError::Backend("Computer Use gateway lock poisoned".into())
        })? = Some(gateway);
        Ok(())
    }

    fn set_filesystem_gateway(
        &self,
        gateway: Arc<dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway>,
    ) -> Result<(), RuntimeCoreError> {
        self.agent_state
            .install_filesystem_gateway(gateway)
            .map_err(RuntimeCoreError::Backend)
    }

    fn effective_turn_runtime_options(
        &self,
        request: &ExecutionRequest,
        first_sampling_turn: bool,
    ) -> Option<app_server_protocol::RuntimeOptions> {
        effective_runtime_options_for_turn(request, first_sampling_turn)
            .or_else(|| request.runtime_options.clone())
    }

    async fn preflight_turn(
        &self,
        request: &ExecutionRequest,
        first_sampling_turn: bool,
    ) -> Result<(), RuntimeCoreError> {
        self.prepare_turn_route(request, first_sampling_turn)
            .await
            .map(|_| ())
    }

    async fn preflight_thread_settings(
        &self,
        session: &app_server_protocol::AgentSession,
        settings: &app_server_protocol::protocol::v2::ThreadSettings,
    ) -> Result<(), RuntimeCoreError> {
        self.preflight_thread_settings_route(session, settings)
            .await
    }

    async fn prepare_turn_runtime_options(
        &self,
        request: &ExecutionRequest,
        first_sampling_turn: bool,
    ) -> Result<Option<app_server_protocol::RuntimeOptions>, RuntimeCoreError> {
        self.prepare_turn_route(request, first_sampling_turn).await
    }

    async fn start_turn(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.handle_turn_start(request, sink).await
    }

    async fn run_memory_stage1(
        &self,
        root: app_server_protocol::MemoryStoreRootParams,
        version: crate::MemoryStageOneVersion,
        route: crate::MemoryStageOneRoute,
        data_source: Arc<dyn AppDataSource>,
        source_policy: &dyn crate::memory_store::MemorySourcePolicy,
    ) -> Result<crate::MemoryStageOneRunResult, RuntimeCoreError> {
        data_source
            .run_memory_stage1(
                root,
                version,
                route,
                &PolicyMemoryProvider {
                    backend: self,
                    policy: source_policy,
                },
            )
            .await
    }

    async fn resolve_memory_stage1_route(
        &self,
        session: &app_server_protocol::AgentSession,
    ) -> Result<crate::MemoryStageOneRoute, RuntimeCoreError> {
        let metadata = session
            .business_object_ref
            .as_ref()
            .and_then(|reference| reference.metadata.as_ref());
        let route_snapshot = metadata.and_then(|value| value.get("agentControlRoute"));
        let mut runtime_options = app_server_protocol::RuntimeOptions::default();
        let runtime_request = runtime_options.runtime_request_mut();
        runtime_request.provider_preference = route_snapshot
            .and_then(|route| route.get("providerPreference"))
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string)
            .or_else(|| super::metadata_string(metadata, &["providerSelector", "providerName"]));
        runtime_request.model_preference = route_snapshot
            .and_then(|route| route.get("modelPreference"))
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string)
            .or_else(|| super::metadata_string(metadata, &["modelName", "model"]));
        runtime_request.reasoning_effort = route_snapshot
            .and_then(|route| route.pointer("/providerConfig/reasoningEffort"))
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string)
            .or_else(|| super::metadata_string(metadata, &["reasoningEffort", "reasoning_effort"]));
        runtime_request.service_tier = route_snapshot
            .and_then(|route| route.get("serviceTier"))
            .and_then(serde_json::Value::as_str)
            .map(ToString::to_string)
            .or_else(|| super::metadata_string(metadata, &["serviceTier", "service_tier"]));
        runtime_request.working_dir =
            super::metadata_string(metadata, &["workingDir", "working_dir"]);
        if let Some(route_snapshot) = route_snapshot {
            runtime_request.provider_config = Some(app_server_protocol::RuntimeProviderConfig {
                provider_id: route_snapshot
                    .pointer("/providerConfig/providerId")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string),
                provider_name: route_snapshot
                    .pointer("/providerConfig/providerName")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string),
                model_name: route_snapshot
                    .pointer("/providerConfig/modelName")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string),
                ..Default::default()
            });
            runtime_request.metadata = Some(serde_json::json!({
                "agentControlRoute": route_snapshot.clone(),
            }));
        }

        let turn_id = format!("memory-stage1-route-{}", session.session_id);
        let request = ExecutionRequest {
            host: crate::RuntimeHostContext::default(),
            session: session.clone(),
            turn: app_server_protocol::AgentTurn {
                turn_id,
                session_id: session.session_id.clone(),
                thread_id: session.thread_id.clone(),
                status: app_server_protocol::AgentTurnStatus::Accepted,
                started_at: None,
                completed_at: None,
            },
            forked_from_thread_id: None,
            is_root_agent: false,
            input: agent_runtime::reply_input::RuntimeReplyInput::text(
                "memory stage-1 route readiness",
            ),
            runtime_options: Some(runtime_options),
            expected_output: None,
            structured_output: None,
            output_schema: None,
            event_name: None,
            queued_turn_id: None,
            queue_if_busy: false,
            skip_pre_submit_resume: false,
            agent_control_gateway: None,
            command_publisher: None,
            rollout_budget_reminder_source: None,
            mid_turn_compaction_commit: None,
            internal_agent_policy: None,
        };
        let route = self.resolve_turn_route(&request).await?;
        if let Some(failure) = route.resolution.resolved_route.failure.as_ref() {
            return Err(super::runtime_error_from_route_failure(
                &session.session_id,
                &route.selection,
                failure,
            ));
        }
        Ok(crate::MemoryStageOneRoute {
            session_id: session.session_id.clone(),
            thread_id: session.thread_id.clone(),
            provider: route.selection.provider,
            model: route.selection.model,
            reasoning_effort: route.selection.reasoning_effort,
            service_tier: super::service_tier_from_request(&request),
            api_version: route.resolution.resolved_route.endpoint.api_version.clone(),
            route_protocol: route.resolution.resolved_route.protocol,
            credential_ref: route.resolution.resolved_route.auth.credential_ref,
            cwd: request
                .runtime_request()
                .and_then(|runtime| runtime.working_dir.as_deref())
                .map(std::path::PathBuf::from),
        })
    }

    async fn start_turn_with_provider_history(
        &self,
        request: ExecutionRequest,
        provider_history: crate::runtime::provider_history::ProviderTurnHistory,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.handle_turn_start_with_provider_history(request, provider_history, None, None, sink)
            .await
    }

    async fn start_turn_with_provider_history_and_session_input(
        &self,
        request: ExecutionRequest,
        provider_history: crate::runtime::provider_history::ProviderTurnHistory,
        pending_input: Option<RuntimeSessionInputHandle>,
        cancellation_token: Option<CancellationToken>,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.handle_turn_start_with_provider_history(
            request,
            provider_history,
            pending_input,
            cancellation_token,
            sink,
        )
        .await
    }

    async fn run_interrupt_hooks(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        let route = self.resolve_turn_route(&request).await?;
        if let Some(failure) = route.resolution.resolved_route.failure.as_ref() {
            tracing::warn!(
                session_id = %request.session.session_id,
                turn_id = %request.turn.turn_id,
                ?failure,
                "skipping Interrupt hooks because the turn route is unavailable"
            );
            return Ok(());
        }
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        let host_request = runtime_request_from_request(&request);
        let scope = session_scope_from_request(&request)?;
        let request_tool_policy = request_tool_policy_from_request(host_request.as_ref());
        let mut session_config = session_config_from_request_with_plugins_and_orchestrator(
            &request,
            host_request.as_ref(),
            &scope,
            &route.selection,
            &request_tool_policy,
            merge_route_model_metadata(
                current_agent_runtime_config_metadata(),
                route.resolution.decision_payload.get("modelRegistry"),
            ),
            &[],
            &[],
        );
        session_config.plugin_hook_source = if request.internal_agent_policy.is_some() {
            None
        } else {
            plugin_hooks::source(self.current_app_data_source()?)
        };
        if request.internal_agent_policy.is_none() {
            if let Err(error) = mcp_bridges::ensure_thread_mcp_runtime_if_available(
                &self.agent_state,
                &self.app_data_source,
                &scope.session_id,
                &scope.thread_id,
            )
            .await
            {
                tracing::warn!(
                    session_id = %scope.session_id,
                    thread_id = %scope.thread_id,
                    %error,
                    "MCP runtime unavailable while running Interrupt hooks"
                );
            }
        }
        let working_directory = session_config
            .turn_context
            .as_ref()
            .and_then(|context| context.cwd.clone())
            .or_else(|| {
                host_request
                    .as_ref()
                    .and_then(|request| request.working_dir.as_deref())
                    .map(std::path::PathBuf::from)
            })
            .unwrap_or_else(|| {
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
            });
        for event in lime_agent::run_interrupt_hooks(
            self.agent_state.clone(),
            &session_config,
            working_directory,
        )
        .await
        {
            for runtime_event in
                tool_events::runtime_events_from_agent_event_with_soul_style(&event, None)?
            {
                sink.emit(runtime_event)?;
            }
        }
        Ok(())
    }

    async fn cancel_turn(
        &self,
        request: CancelExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.agent_state
            .cancel_session(&request.session.session_id)
            .await;
        sink.emit(RuntimeEvent::new(
            "turn.canceled",
            json!({ "backend": "runtime" }),
        ))
    }

    async fn drain_turn(&self, request: &CancelExecutionRequest) -> Result<(), RuntimeCoreError> {
        self.agent_state
            .cancel_session(&request.session.session_id)
            .await;
        self.agent_state
            .cancel_turn_processes(&request.session.thread_id, &request.turn.turn_id)
            .await
            .map_err(|error| RuntimeCoreError::Backend(error.message().to_string()))
    }

    async fn close_session(
        &self,
        session_id: &str,
        thread_id: &str,
    ) -> Result<(), RuntimeCoreError> {
        self.agent_state.cancel_session(session_id).await;
        self.agent_state
            .terminate_all_processes(thread_id)
            .await
            .map_err(|error| RuntimeCoreError::Backend(error.message().to_string()))?;
        self.agent_state.close_provider_session(session_id).await;
        self.agent_state
            .close_mcp_runtime(session_id, thread_id)
            .await;
        Ok(())
    }

    async fn invalidate_mcp_runtimes(&self) {
        self.agent_state.clear_mcp_runtimes().await;
    }

    async fn respond_action(
        &self,
        request: ActionRespondRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        action_response::validate_action_scope(&request)?;
        if !self
            .agent_state
            .contains_pending_action(&request.request_id)
            .await
        {
            let descriptor = request.pending_action_descriptor.clone().ok_or_else(|| {
                action_response_error("action_descriptor_invalid", &request.request_id)
            })?;
            let outcomes = self
                .agent_state
                .restore_pending_action_descriptors([descriptor])
                .await;
            match outcomes.as_slice() {
                [PendingActionRestoreOutcome::Restored]
                | [PendingActionRestoreOutcome::AlreadyPresent] => {}
                [PendingActionRestoreOutcome::Expired] => {
                    return Err(action_response_error("action_expired", &request.request_id));
                }
                [PendingActionRestoreOutcome::Terminal] => {
                    let code = match self
                        .agent_state
                        .terminal_action_status(&request.request_id)
                        .await
                    {
                        Some(ActionTerminalStatus::NotResumable) => "action_not_resumable",
                        Some(ActionTerminalStatus::ContinuationClosed) => {
                            "action_continuation_closed"
                        }
                        Some(ActionTerminalStatus::Expired) => "action_expired",
                        Some(ActionTerminalStatus::Canceled) => "action_canceled",
                        Some(ActionTerminalStatus::Resolved) => "action_already_resolved",
                        None => "action_terminal",
                    };
                    return Err(action_response_error(code, &request.request_id));
                }
                [PendingActionRestoreOutcome::Invalid] | _ => {
                    return Err(action_response_error(
                        "action_descriptor_invalid",
                        &request.request_id,
                    ));
                }
            }
        }
        match action_response::handle_action_response(&self.agent_state, &request).await? {
            action_response::ActionResponseOutcome::Resolved => {
                sink.emit(action_response::action_resolved_event(&request))
            }
            action_response::ActionResponseOutcome::Canceled => {
                sink.emit(action_response::action_canceled_event(&request))
            }
        }
    }

    async fn resolve_permission_action(
        &self,
        request: &crate::PermissionRespondRequest,
    ) -> Result<(), RuntimeCoreError> {
        let scope = lime_agent::AgentActionRequiredScope::from_parts(
            Some(request.session_id.clone()),
            Some(request.thread_id.clone()),
            Some(request.turn_id.clone()),
        )
        .ok_or_else(|| RuntimeCoreError::ActionResponse {
            code: "action_scope_missing".to_string(),
            request_id: request.request_id.clone(),
        })?;
        self.agent_state
            .resolve_permission_action(&request.session_id, &request.request_id, Some(scope))
            .await
            .map_err(|error| RuntimeCoreError::ActionResponse {
                code: error.code().to_string(),
                request_id: error.request_id().to_string(),
            })
    }

    async fn read_tool_inventory(
        &self,
        request: ToolInventoryReadRequest,
    ) -> Result<Value, RuntimeCoreError> {
        self.register_current_native_tools_if_available().await?;
        let app_data_source = self
            .app_data_source
            .read()
            .map_err(|_| {
                RuntimeCoreError::Backend(
                    "tool inventory app data source lock poisoned".to_string(),
                )
            })?
            .clone();
        tool_inventory::read_tool_inventory(
            &self.agent_state,
            request,
            current_agent_runtime_config_metadata(),
            app_data_source,
        )
        .await
    }

    async fn read_mcp_runtime_resource(
        &self,
        session_id: &str,
        thread_id: &str,
        server: &str,
        uri: &str,
        meta: Option<Value>,
    ) -> Result<app_server_protocol::protocol::v2::McpServerResourceReadResponse, RuntimeCoreError>
    {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        mcp_bridges::ensure_thread_mcp_runtime_if_available(
            &self.agent_state,
            &self.app_data_source,
            session_id,
            thread_id,
        )
        .await?;
        let content = self
            .agent_state
            .read_mcp_resource_with_meta(session_id, thread_id, server, uri, meta)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        lower_mcp_resource_content(content)
    }

    async fn read_mcp_runtime_resource_for_origin(
        &self,
        session_id: &str,
        thread_id: &str,
        server: &str,
        origin: &lime_mcp::McpResourceOrigin,
    ) -> Result<app_server_protocol::protocol::v2::McpServerResourceReadResponse, RuntimeCoreError>
    {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        mcp_bridges::ensure_thread_mcp_runtime_if_available(
            &self.agent_state,
            &self.app_data_source,
            session_id,
            thread_id,
        )
        .await?;
        let content = self
            .agent_state
            .read_mcp_resource_for_origin(session_id, thread_id, server, origin)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        lower_mcp_resource_content(content)
    }

    async fn call_mcp_runtime_tool(
        &self,
        session_id: &str,
        thread_id: &str,
        server: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<lime_mcp::McpToolResult, RuntimeCoreError> {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        mcp_bridges::ensure_thread_mcp_runtime_if_available(
            &self.agent_state,
            &self.app_data_source,
            session_id,
            thread_id,
        )
        .await?;
        self.agent_state
            .call_mcp_tool(session_id, thread_id, server, tool, arguments)
            .await
            .map_err(RuntimeCoreError::Backend)
    }

    async fn subscribe_mcp_runtime_events(
        &self,
        session_id: &str,
        thread_id: &str,
    ) -> Result<tokio::sync::broadcast::Receiver<lime_mcp::McpServerNotification>, RuntimeCoreError>
    {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        mcp_bridges::ensure_thread_mcp_runtime_if_available(
            &self.agent_state,
            &self.app_data_source,
            session_id,
            thread_id,
        )
        .await?;
        self.agent_state
            .subscribe_mcp_server_notifications(session_id, thread_id)
            .await
            .map_err(RuntimeCoreError::Backend)
    }

    async fn open_mcp_runtime_event_stream(
        &self,
        session_id: &str,
        thread_id: &str,
        server: &str,
        name: &str,
        arguments: serde_json::Value,
        meta: Option<serde_json::Value>,
    ) -> Result<lime_mcp::McpEventStream, RuntimeCoreError> {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        mcp_bridges::ensure_thread_mcp_runtime_if_available(
            &self.agent_state,
            &self.app_data_source,
            session_id,
            thread_id,
        )
        .await?;
        self.agent_state
            .open_mcp_event_stream(session_id, thread_id, server, name, arguments, meta)
            .await
            .map_err(RuntimeCoreError::Backend)
    }

    async fn has_mcp_runtime_server(
        &self,
        session_id: &str,
        thread_id: &str,
        server: &str,
    ) -> Result<bool, RuntimeCoreError> {
        let db = initialize_runtime_database(self.db.as_ref())?;
        self.ensure_agent_initialized(&db).await?;
        mcp_bridges::ensure_thread_mcp_runtime_if_available(
            &self.agent_state,
            &self.app_data_source,
            session_id,
            thread_id,
        )
        .await?;
        self.agent_state
            .has_mcp_server(session_id, thread_id, server)
            .await
            .map_err(RuntimeCoreError::Backend)
    }
}

fn lower_mcp_resource_content(
    content: lime_mcp::McpResourceContent,
) -> Result<app_server_protocol::protocol::v2::McpServerResourceReadResponse, RuntimeCoreError> {
    let content = match (content.text, content.blob) {
        (Some(text), None) => Some(
            app_server_protocol::protocol::v2::McpServerResourceContent::Text {
                uri: content.uri,
                mime_type: content.mime_type,
                text,
                meta: content.meta,
            },
        ),
        (None, Some(blob)) => Some(
            app_server_protocol::protocol::v2::McpServerResourceContent::Blob {
                uri: content.uri,
                mime_type: content.mime_type,
                blob,
                meta: content.meta,
            },
        ),
        (None, None) => None,
        (Some(_), Some(_)) => {
            return Err(RuntimeCoreError::Backend(
                "MCP resource response contained both text and blob".to_string(),
            ));
        }
    };
    Ok(
        app_server_protocol::protocol::v2::McpServerResourceReadResponse {
            contents: content.into_iter().collect(),
            origin_call_id: None,
        },
    )
}

fn action_response_error(code: &str, request_id: &str) -> RuntimeCoreError {
    RuntimeCoreError::ActionResponse {
        code: code.to_string(),
        request_id: request_id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::route_supports_service_tier;
    use serde_json::json;

    #[test]
    fn service_tier_preflight_uses_exact_catalog_ids() {
        let decision = json!({
            "modelRegistry": {
                "model": {
                    "service_tiers": [
                        {"id": "priority", "name": "Priority"},
                        "flex"
                    ]
                }
            }
        });

        assert!(route_supports_service_tier(&decision, "priority"));
        assert!(route_supports_service_tier(&decision, "flex"));
        assert!(!route_supports_service_tier(&decision, "default"));
        assert!(!route_supports_service_tier(&json!({}), "priority"));
    }
}
