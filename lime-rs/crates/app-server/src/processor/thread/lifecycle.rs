use super::*;
use std::path::Path;

impl RequestProcessor {
    pub(in crate::processor) async fn handle_thread_start_v2(
        &self,
        params: Option<serde_json::Value>,
        connection_request_id: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadStartParams = parse_params(params)?;
        let cwd = crate::RuntimeCore::resolve_working_directory(params.cwd.as_deref())
            .map_err(to_jsonrpc_error)?;
        let (thread_defaults, thread_config) = defaults::read_thread_defaults(
            self.runtime.app_config_path(),
            Path::new(&cwd),
            params.config.as_ref(),
            self.runtime
                .read_config_requirements()
                .map_err(to_jsonrpc_error)?
                .as_ref(),
        )?;
        validate_dynamic_tools(params.dynamic_tools.as_deref())?;
        let host_connection = dynamic_tools::host_connection(
            params.dynamic_tools.as_deref(),
            connection_request_id.as_ref(),
        )?;
        if let Some(project_id) = params.project_id.as_deref() {
            self.ensure_project_exists(project_id, "thread/start")
                .await?;
        }
        let selection = self
            .runtime
            .resolve_thread_start_model_selection(
                params.model.as_deref(),
                params.model_provider.as_deref(),
                params.service_tier.clone(),
            )
            .await
            .map_err(|error| match error {
                crate::RuntimeCoreError::InvalidRequest(message) => invalid_params(message),
                other => to_jsonrpc_error(other),
            })?;
        let model = selection.model;
        let model_provider = selection.model_provider;
        let service_tier = selection.service_tier;
        let approvals_reviewer = params.approvals_reviewer.unwrap_or_default();
        let workspace_roots =
            crate::RuntimeCore::resolve_workspace_roots(params.runtime_workspace_roots.as_deref())
                .map_err(to_jsonrpc_error)?;
        let history_mode = params.history_mode.clone().unwrap_or_default();
        let environments = self
            .normalize_environment_selections(params.environments.clone())
            .await?;
        let environment_world_state = self
            .environment_world_state_snapshot(environments.as_deref())
            .await;
        let permission_policy = crate::permission_profile::permission_profile_policy(
            &thread_config,
            Some(&cwd),
            tool_runtime::sandbox::SandboxBackendPlatform::current(),
        )
        .map_err(invalid_params)?;
        let explicit_sandbox = params.sandbox.is_some()
            || params
                .config
                .as_ref()
                .is_some_and(|values| values.contains_key("sandbox_mode"));
        let active_permission_profile = if explicit_sandbox && params.permissions.is_none() {
            None
        } else {
            resolve_permission_profile_for_request(
                &permission_policy,
                params.permissions.as_deref(),
            )
            .map_err(invalid_params)?
            .map(|profile| {
                if params.sandbox.is_some() {
                    Err(invalid_params(
                        "permissions cannot be combined with sandbox",
                    ))
                } else {
                    Ok(profile)
                }
            })
            .transpose()?
        };
        let source = "appServer";
        let thread_id = Uuid::now_v7().to_string();
        let session_id = thread_id.clone();
        let mut metadata = json!({
            "providerSelector": model_provider.clone(),
            "providerName": model_provider.clone(),
            "modelName": model.clone(),
            "workingDir": cwd.clone(),
            "historyMode": history_mode,
            "source": source,
            "threadSource": params.thread_source,
            "projectId": params.project_id,
            "ephemeral": params.ephemeral.unwrap_or(false),
            "serviceTier": service_tier,
            "approvalsReviewer": approvals_reviewer,
            "permissions": active_permission_profile
                .as_ref()
                .map(|profile| profile.id.clone()),
            "activePermissionProfile": active_permission_profile
                .as_ref()
                .map(|profile| json!({ "id": profile.id })),
            "config": params.config,
            "baseInstructions": params.base_instructions,
            "developerInstructions": params.developer_instructions,
            "personality": params.personality,
            "sessionStartSource": params.session_start_source,
            "environments": environments.clone(),
            "dynamicTools": params.dynamic_tools,
            "selectedCapabilityRoots": params.selected_capability_roots,
            "allowProviderModelFallback": params.allow_provider_model_fallback,
            "experimentalRawEvents": params.experimental_raw_events,
            "cliVersion": env!("CARGO_PKG_VERSION"),
        });
        metadata
            .as_object_mut()
            .expect("thread/start metadata object")
            .extend(thread_defaults);
        if let Some(approval) = params.approval_policy {
            metadata["approvalPolicy"] = approval;
        }
        if let Some(sandbox) = params.sandbox {
            metadata["sandboxPolicy"] = sandbox;
            metadata["sandboxNetworkAccess"] = json!(false);
        }
        if let Some(roots) = workspace_roots {
            metadata["runtimeWorkspaceRoots"] = json!(roots);
        }
        if let Some(profile) = active_permission_profile.clone() {
            metadata["sandboxNetworkAccess"] = json!(false);
            apply_resolved_permission_profile_to_metadata(
                metadata
                    .as_object_mut()
                    .expect("thread/start metadata object"),
                profile,
            )
            .map_err(invalid_params)?;
        }
        if metadata.get("webSearchMode").is_none() {
            metadata["webSearchMode"] = json!(agent_protocol::WebSearchMode::for_sandbox(
                metadata
                    .get("sandboxPolicy")
                    .and_then(serde_json::Value::as_str),
            ));
        }
        if !environment_world_state.is_empty() {
            metadata["environmentWorldState"] = serde_json::to_value(&environment_world_state)
                .map_err(|error| {
                    invalid_params(format!("invalid Environment world-state: {error}"))
                })?;
        }
        let start_params = AgentSessionStartParams {
            session_id: Some(session_id.clone()),
            thread_id: Some(thread_id.clone()),
            app_id: "agent-chat".to_string(),
            workspace_id: None,
            business_object_ref: Some(BusinessObjectRef {
                kind: "agent.thread".to_string(),
                id: thread_id.clone(),
                title: params.service_name.clone(),
                uri: None,
                metadata: Some(metadata.clone()),
            }),
            locale: None,
        };
        self.runtime
            .preflight_thread_start(&start_params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.runtime
            .start_session(start_params)
            .map_err(to_jsonrpc_error)?;
        self.runtime.spawn_memory_stage1_startup(session_id.clone());
        self.record_environment_selections(&thread_id, environments.as_deref());
        self.append_environment_world_state(
            &session_id,
            Some(environments.as_deref().unwrap_or_default()),
        )
        .map_err(to_jsonrpc_error)?;
        let thread = self
            .runtime
            .read_thread(agent_protocol::thread::ThreadReadParams {
                thread_id: agent_protocol::ThreadId::new(thread_id),
                turns_view: agent_protocol::ThreadTurnsView::NotLoaded,
            })
            .await
            .map_err(to_jsonrpc_error)?;
        let thread = project_thread_read_response(thread)?.thread;
        self.watch_thread_skills(&thread).await;
        let thread_started = JsonRpcNotification::new(
            "thread/started",
            Some(serde_json::json!({ "thread": thread.clone() })),
        );
        let environment_notifications = self
            .environment_selection_notifications(&thread.id, environments.as_deref())
            .await;
        if let Some(connection_id) = host_connection {
            let tools = params.dynamic_tools.as_deref().unwrap_or_default();
            self.bind_dynamic_tools(&thread.id, connection_id, tools, tools, false)
                .await?;
        }
        dispatch_result(ThreadStartResponse {
            thread,
            model,
            model_provider,
            service_tier: metadata_optional_string(&metadata, "serviceTier"),
            cwd,
            runtime_workspace_roots: metadata_string_array(&metadata, "runtimeWorkspaceRoots"),
            instruction_sources: Vec::new(),
            approval_policy: metadata
                .get("approvalPolicy")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            approvals_reviewer,
            sandbox: metadata
                .get("sandbox")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            active_permission_profile: metadata
                .get("activePermissionProfile")
                .filter(|value| !value.is_null())
                .cloned(),
            reasoning_effort: metadata_optional_string(&metadata, "reasoningEffort"),
            multi_agent_mode: agent_protocol::MultiAgentMode::default(),
        })
        .map(|dispatch| {
            dispatch
                .with_notification(thread_started)
                .with_notifications(environment_notifications)
        })
    }

    pub(in crate::processor) async fn handle_thread_resume_v2(
        &self,
        params: Option<serde_json::Value>,
        connection_request_id: Option<ConnectionRequestId>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ThreadResumeParams = parse_params(params)?;
        validate_thread_resume_params(&params)?;
        validate_dynamic_tools(params.dynamic_tools.as_deref())?;
        let host_connection = dynamic_tools::host_connection(
            params.dynamic_tools.as_deref(),
            connection_request_id.as_ref(),
        )?;
        let thread_id = required_thread_resume_value(&params.thread_id, "threadId")?;
        let resumed = self
            .runtime
            .resume_thread(agent_protocol::ThreadId::new(thread_id.clone()))
            .await
            .map_err(to_jsonrpc_error)?;
        if resumed.thread.archived {
            return Err(invalid_request(format!(
                "thread/resume cannot resume archived thread {thread_id}"
            )));
        }

        let session_id = resumed.thread.session_id.to_string();
        let active_turn_id = resumed
            .active_turn_id
            .as_ref()
            .map(agent_protocol::TurnId::as_str);
        let mut metadata_only =
            project_thread_read_response(agent_protocol::thread::ThreadReadResponse {
                thread: resumed.thread,
            })?
            .thread;
        normalize_thread_resume_snapshot(&mut metadata_only, active_turn_id);
        if matches!(metadata_only.history_mode, ThreadHistoryMode::Paginated) {
            if !params.exclude_turns {
                return Err(invalid_request(
                    "thread/resume requires excludeTurns=true for paginated history",
                ));
            }
            if params.initial_turns_page.is_some() {
                return Err(invalid_request(
                    "thread/resume initialTurnsPage is not supported for paginated history",
                ));
            }
        }

        let mut thread = if params.exclude_turns {
            metadata_only
        } else {
            let response = self
                .runtime
                .read_thread(agent_protocol::thread::ThreadReadParams {
                    thread_id: agent_protocol::ThreadId::new(thread_id.clone()),
                    turns_view: agent_protocol::ThreadTurnsView::Full,
                })
                .await
                .map_err(to_jsonrpc_error)?;
            project_thread_read_response(response)?.thread
        };
        normalize_thread_resume_snapshot(&mut thread, active_turn_id);
        let mut initial_turns_page = self
            .build_thread_resume_initial_turns_page(&thread_id, params.initial_turns_page.as_ref())
            .await?;
        if let Some(page) = initial_turns_page.as_mut() {
            normalize_resume_turns(&mut page.data, active_turn_id);
        }
        let (turns_backwards_cursor, items_backwards_cursor) =
            if matches!(thread.history_mode, ThreadHistoryMode::Paginated) {
                self.runtime
                    .paginated_resume_backwards_cursors(agent_protocol::ThreadId::new(
                        thread_id.clone(),
                    ))
                    .await
                    .map_err(to_jsonrpc_error)?
            } else {
                (None, None)
            };
        let metadata = thread.extra.as_ref().unwrap_or(&serde_json::Value::Null);
        let model = required_metadata_string(metadata, &["modelName", "model"], "model")?;
        let model_provider = required_thread_resume_value(&thread.model_provider, "modelProvider")?;
        let environments =
            super::super::turn_environment::persisted_environment_selections(metadata)?;
        let environments = self.normalize_environment_selections(environments).await?;
        self.record_environment_selections(&thread.id, environments.as_deref());
        let environment_notifications = self
            .environment_selection_notifications(&thread.id, environments.as_deref())
            .await;

        if let Some(connection_id) = host_connection {
            let frozen: Vec<app_server_protocol::protocol::v2::DynamicToolSpec> =
                serde_json::from_value(
                    metadata
                        .get("dynamicTools")
                        .filter(|value| !value.is_null())
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                )
                .map_err(|error| {
                    invalid_request(format!("invalid frozen dynamic tools: {error}"))
                })?;
            self.bind_dynamic_tools(
                &thread_id,
                connection_id,
                &frozen,
                params.dynamic_tools.as_deref().unwrap_or_default(),
                active_turn_id.is_some(),
            )
            .await?;
        }

        self.watch_thread_skills(&thread).await;
        let response = dispatch_result(ThreadResumeResponse {
            service_tier: metadata_optional_string(metadata, "serviceTier"),
            cwd: thread.cwd.to_string_lossy().to_string(),
            runtime_workspace_roots: metadata_string_array(metadata, "runtimeWorkspaceRoots"),
            instruction_sources: metadata_string_array(metadata, "instructionSources"),
            approval_policy: metadata_value(metadata, "approvalPolicy"),
            approvals_reviewer: agent_protocol::ApprovalsReviewer::parse(
                metadata.get("approvalsReviewer"),
            )
            .map_err(invalid_request)?
            .unwrap_or_default(),
            sandbox: metadata_value(metadata, "sandbox"),
            active_permission_profile: metadata
                .get("activePermissionProfile")
                .filter(|value| !value.is_null())
                .cloned(),
            reasoning_effort: metadata_optional_string(metadata, "reasoningEffort"),
            multi_agent_mode: agent_protocol::MultiAgentMode::default(),
            initial_turns_page,
            turns_backwards_cursor,
            items_backwards_cursor,
            thread,
            model,
            model_provider,
        })?;
        if active_turn_id.is_none() {
            self.runtime
                .maybe_start_thread_goal_if_idle(&session_id, self.runtime_host_context())
                .await;
            self.runtime
                .wake_thread_queue_if_idle(&thread_id, self.runtime_host_context());
        }
        Ok(response.with_notifications(environment_notifications))
    }

    async fn build_thread_resume_initial_turns_page(
        &self,
        thread_id: &str,
        params: Option<&app_server_protocol::protocol::v2::ThreadResumeInitialTurnsPageParams>,
    ) -> Result<Option<TurnsPage>, JsonRpcError> {
        let Some(params) = params else {
            return Ok(None);
        };
        let response = self
            .runtime
            .list_thread_turns(lower_thread_turns_list_params(&ThreadTurnsListParams {
                thread_id: thread_id.to_string(),
                cursor: None,
                limit: Some(params.limit.unwrap_or(25).clamp(1, 100)),
                sort_direction: Some(params.sort_direction.unwrap_or(SortDirection::Desc)),
                items_view: Some(params.items_view.unwrap_or(TurnItemsView::Summary)),
            })?)
            .await
            .map_err(to_jsonrpc_error)?;
        let response = project_thread_turns_list_response(response)?;
        Ok(Some(TurnsPage {
            data: response.data,
            next_cursor: response.next_cursor,
            backwards_cursor: response.backwards_cursor,
        }))
    }
}
