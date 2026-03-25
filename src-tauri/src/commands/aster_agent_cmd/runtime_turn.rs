use super::*;
use aster::session::TurnContextOverride;
use lime_agent::AgentEvent as RuntimeAgentEvent;

const ARTIFACT_DOCUMENT_REPAIRED_WARNING_CODE: &str = "artifact_document_repaired";
const ARTIFACT_DOCUMENT_FAILED_WARNING_CODE: &str = "artifact_document_failed";
const ARTIFACT_DOCUMENT_PERSIST_FAILED_WARNING_CODE: &str = "artifact_document_persist_failed";

fn emit_runtime_side_event(
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    event: RuntimeAgentEvent,
) {
    {
        let mut recorder = match timeline_recorder.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        if let Err(error) = recorder.record_runtime_event(app, event_name, &event, workspace_root) {
            tracing::warn!(
                "[AsterAgent] 记录 Artifact 运行时事件失败（已降级继续）: {}",
                error
            );
        }
    }

    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!("[AsterAgent] 发送 Artifact 运行时事件失败: {}", error);
    }
}

fn summarize_artifact_document_issues(issues: &[String]) -> String {
    let parts = issues
        .iter()
        .map(|issue| issue.trim())
        .filter(|issue| !issue.is_empty())
        .take(3)
        .collect::<Vec<_>>();

    if parts.is_empty() {
        "结构已按最小可用方案落盘。".to_string()
    } else {
        parts.join("；")
    }
}

fn merge_turn_context_with_artifact_output_schema(
    turn_context: Option<TurnContextOverride>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<TurnContextOverride> {
    crate::services::artifact_output_schema_service::merge_turn_context_with_artifact_output_schema(
        turn_context,
        request_metadata,
    )
}

fn should_skip_artifact_document_autopersist(
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    final_text_output: &str,
) -> bool {
    if final_text_output.trim().is_empty() {
        return true;
    }

    let observation = match run_observation.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    // 只允许根据运行期 artifact observation 决定是否跳过 autopersist，
    // 不再从最终文本中的 `<write_file>` 片段反推 artifact 状态。
    !observation.artifact_paths.is_empty()
}

fn maybe_persist_artifact_document_after_stream(
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    workspace_root: &str,
    workspace_id: &str,
    thread_id: &str,
    turn_id: &str,
    request_metadata: Option<&serde_json::Value>,
    final_text_output: &str,
) {
    if !crate::services::artifact_document_service::should_attempt_artifact_document_autopersist(
        request_metadata,
    ) {
        return;
    }
    if should_skip_artifact_document_autopersist(run_observation, final_text_output) {
        return;
    }

    let persist_params =
        crate::services::artifact_document_service::ArtifactDocumentPersistParams {
            workspace_root: PathBuf::from(workspace_root),
            workspace_id: Some(workspace_id.to_string()),
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
            request_metadata: request_metadata.cloned(),
        };

    match crate::services::artifact_document_service::persist_artifact_document_from_text(
        final_text_output,
        &persist_params,
    ) {
        Ok(persisted) => {
            {
                let mut observation = match run_observation.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                observation.record_artifact_path(persisted.relative_path.clone(), request_metadata);
            }

            emit_runtime_side_event(
                app,
                event_name,
                timeline_recorder,
                workspace_root,
                RuntimeAgentEvent::ArtifactSnapshot {
                    artifact: lime_agent::AgentArtifactSignal {
                        artifact_id: persisted.artifact_id.clone(),
                        file_path: persisted.relative_path.clone(),
                        content: Some(persisted.serialized_document.clone()),
                        metadata: Some(
                            persisted
                                .snapshot_metadata
                                .iter()
                                .map(|(key, value)| (key.clone(), value.clone()))
                                .collect(),
                        ),
                    },
                },
            );

            if persisted.repaired || persisted.status == "failed" {
                let (code, prefix) = if persisted.status == "failed" {
                    (
                        ARTIFACT_DOCUMENT_FAILED_WARNING_CODE,
                        "ArtifactDocument 未通过完整校验，已以失败态文档落盘",
                    )
                } else {
                    (
                        ARTIFACT_DOCUMENT_REPAIRED_WARNING_CODE,
                        "ArtifactDocument 已自动修复后落盘",
                    )
                };
                let detail = summarize_artifact_document_issues(&persisted.issues);
                emit_runtime_side_event(
                    app,
                    event_name,
                    timeline_recorder,
                    workspace_root,
                    RuntimeAgentEvent::Warning {
                        code: Some(code.to_string()),
                        message: format!("{prefix}: {detail}"),
                    },
                );
            }
        }
        Err(error) => {
            emit_runtime_side_event(
                app,
                event_name,
                timeline_recorder,
                workspace_root,
                RuntimeAgentEvent::Warning {
                    code: Some(ARTIFACT_DOCUMENT_PERSIST_FAILED_WARNING_CODE.to_string()),
                    message: format!("ArtifactDocument 自动落盘失败，已保留消息区结果：{error}"),
                },
            );
        }
    }
}

async fn execute_aster_chat_request(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    mut request: AsterChatRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 发送流式消息: session={}, event={}",
        request.session_id,
        request.event_name
    );

    // 确保 Agent 已初始化（使用带数据库的版本，注入 SessionStore）
    let is_init = state.is_initialized().await;
    tracing::warn!("[AsterAgent] Agent 初始化状态: {}", is_init);
    if !is_init {
        tracing::warn!("[AsterAgent] Agent 未初始化，开始初始化...");
        state.init_agent_with_db(db).await?;
        tracing::warn!("[AsterAgent] Agent 初始化完成");
    } else {
        tracing::warn!("[AsterAgent] Agent 已初始化，检查 session_store...");
        // 检查 session_store 是否存在
        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        if let Some(agent) = guard.as_ref() {
            let has_store = agent.session_store().is_some();
            tracing::warn!("[AsterAgent] session_store 存在: {}", has_store);
        }
    }
    ensure_tool_search_tool_registered(state).await?;

    if let Some(resolved_provider_config) =
        resolve_runtime_request_provider_config(app, db, api_key_provider_service, &request).await?
    {
        request.provider_config = Some(resolved_provider_config);
    }

    // 直接使用前端传递的 session_id
    // LimeSessionStore 会在 add_message 时自动创建不存在的 session
    // 同时 get_session 也会自动创建不存在的 session
    let session_id = &request.session_id;

    let workspace_id = request.workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        let message = "workspace_id 必填，请先选择项目工作区".to_string();
        logs.write()
            .await
            .add("error", &format!("[AsterAgent] {}", message));
        return Err(message);
    }

    let manager = WorkspaceManager::new(db.clone());
    let workspace = match manager.get(&workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            let message = format!("Workspace 不存在: {workspace_id}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
        Err(error) => {
            let message = format!("读取 workspace 失败: {error}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let ensured = match ensure_workspace_ready_with_auto_relocate(&manager, &workspace) {
        Ok(result) => result,
        Err(message) => {
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let workspace_root = ensured.root_path.to_string_lossy().to_string();
    let runtime_config = config_manager.config();
    apply_web_search_runtime_env(&runtime_config);
    let auto_continue_config = request
        .auto_continue
        .clone()
        .map(AutoContinuePayload::normalized);
    let auto_continue_enabled = auto_continue_config
        .as_ref()
        .map(|config| config.enabled)
        .unwrap_or(false);
    if let Some(config) = auto_continue_config
        .as_ref()
        .filter(|config| config.enabled)
    {
        tracing::info!(
            "[AsterAgent] 自动续写策略已启用: source={:?}, fast_mode={}, continuation_length={}, sensitivity={}",
            config.source,
            config.fast_mode_enabled,
            config.continuation_length,
            config.sensitivity
        );
    }

    if ensured.repaired {
        let warning_message = ensured.warning.unwrap_or_else(|| {
            format!(
                "检测到工作区目录缺失，已自动创建并继续执行: {}",
                workspace_root
            )
        });
        logs.write()
            .await
            .add("warn", &format!("[AsterAgent] {}", warning_message));
        let warning_event = RuntimeAgentEvent::Warning {
            code: Some(WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE.to_string()),
            message: warning_message,
        };
        if let Err(error) = app.emit(&request.event_name, &warning_event) {
            tracing::error!("[AsterAgent] 发送工作区自动恢复提醒失败: {}", error);
        }
    }

    let mut session_state_snapshot = SessionStateSnapshot::from_persisted_metadata(
        session_id,
        AsterAgentWrapper::get_persisted_session_metadata_sync(db, session_id)?,
    );

    if session_state_snapshot.needs_working_dir_update(&workspace_root) {
        tracing::info!(
            "[AsterAgent] workspace 变更，自动更新 session working_dir: {} -> {}",
            session_state_snapshot.working_dir().unwrap_or_default(),
            workspace_root
        );
        AsterAgentWrapper::update_session_working_dir_sync(db, session_id, &workspace_root)?;
        session_state_snapshot =
            session_state_snapshot.with_working_dir(Some(workspace_root.clone()));
    }

    // 启动并注入 MCP extensions 到 Aster Agent
    let (_start_ok, start_fail) = ensure_lime_mcp_servers_running(db, mcp_manager).await;
    if start_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP server 自动启动失败 ({} 失败)，后续可用工具可能不完整",
            start_fail
        );
    }

    let (_mcp_ok, mcp_fail) = inject_mcp_extensions(state, mcp_manager).await;
    if mcp_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP extension 注入失败 ({} 失败)，Agent 可能无法使用某些 MCP 工具",
            mcp_fail
        );
    }

    let runtime_chat_mode = resolve_runtime_chat_mode(request.metadata.as_ref());
    let mode_default_web_search = default_web_search_enabled_for_chat_mode(runtime_chat_mode);
    let (request_web_search, request_search_mode) =
        apply_browser_requirement_to_request_tool_policy(
            request.metadata.as_ref(),
            request.web_search,
            request.search_mode,
        );

    // 构建请求级工具策略：
    // - web_search=true 默认只表示“允许搜索”
    // - 仅显式 search_mode=required 时才强制预搜索
    let request_tool_policy = resolve_request_tool_policy_with_mode(
        request_web_search,
        request_search_mode,
        mode_default_web_search,
    );
    tracing::info!(
        "[AsterAgent][WebSearchGuard] session={}, chat_mode={:?}, request_web_search={:?}, request_search_mode={:?}, effective_request_web_search={:?}, effective_request_search_mode={:?}, mode_default_web_search={}, effective_web_search={}, search_mode={}",
        session_id,
        runtime_chat_mode,
        request.web_search,
        request.search_mode,
        request_web_search,
        request_search_mode,
        mode_default_web_search,
        request_tool_policy.effective_web_search,
        request_tool_policy.search_mode.as_str()
    );

    let include_context_trace = runtime_config.memory.enabled;
    let has_persisted_session = session_state_snapshot.has_persisted_session();
    tracing::info!(
        "[AsterAgent] session_state_snapshot={}",
        serde_json::to_string(&session_state_snapshot).unwrap_or_else(|_| "{}".to_string())
    );
    let mut turn_input_builder = TurnInputEnvelopeBuilder::new(session_id, workspace_id.as_str());
    turn_input_builder
        .set_project_id(request.project_id.clone())
        .set_has_persisted_session(has_persisted_session)
        .set_request_tool_policy(Some(TurnRequestToolPolicySnapshot::from(
            &request_tool_policy,
        )))
        .set_working_dir(Some(workspace_root.clone()))
        .set_effective_user_message(request.message.clone())
        .set_include_context_trace(include_context_trace)
        .set_turn_context_metadata_from_value(request.metadata.as_ref());

    // 构建 system_prompt：优先使用项目上下文，其次使用 session 的 system_prompt
    // 同时读取会话已持久化的 execution_strategy
    let persisted_strategy =
        AsterExecutionStrategy::from_db_value(session_state_snapshot.execution_strategy());
    let session_prompt = if let Some(prompt) = session_state_snapshot.system_prompt() {
        tracing::debug!(
            "[AsterAgent] 找到 session，system_prompt: {:?}",
            Some(prompt.len())
        );
        Some(prompt.to_string())
    } else {
        if !session_state_snapshot.has_persisted_session() {
            tracing::debug!("[AsterAgent] Lime 数据库中未找到 session: {}", session_id);
        }
        None
    };

    let project_prompt = if let Some(ref project_id) = request.project_id {
        match AsterAgentState::build_project_system_prompt(db, project_id) {
            Ok(prompt) => {
                tracing::info!(
                    "[AsterAgent] 已加载项目上下文: project_id={}, prompt_len={}",
                    project_id,
                    prompt.len()
                );
                Some(prompt)
            }
            Err(e) => {
                tracing::warn!(
                    "[AsterAgent] 加载项目上下文失败: {}, 继续使用 session prompt",
                    e
                );
                None
            }
        }
    } else {
        None
    };

    let (resolved_prompt, system_prompt_source) = if let Some(project_prompt) = project_prompt {
        (Some(project_prompt), TurnSystemPromptSource::Project)
    } else if let Some(session_prompt) = session_prompt {
        (Some(session_prompt), TurnSystemPromptSource::Session)
    } else if let Some(ref frontend_prompt) = request.system_prompt {
        if !frontend_prompt.trim().is_empty() {
            tracing::info!(
                "[AsterAgent] 使用前端传入的 system_prompt, len={}",
                frontend_prompt.len()
            );
            (
                Some(frontend_prompt.clone()),
                TurnSystemPromptSource::Frontend,
            )
        } else {
            (None, TurnSystemPromptSource::None)
        }
    } else {
        (None, TurnSystemPromptSource::None)
    };
    turn_input_builder.set_base_system_prompt(system_prompt_source, resolved_prompt.clone());

    let prompt_with_runtime_agents =
        merge_system_prompt_with_runtime_agents(resolved_prompt, Some(Path::new(&workspace_root)));
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::RuntimeAgents,
        prompt_with_runtime_agents.clone(),
    );

    let prompt_with_memory = merge_system_prompt_with_memory_context(
        prompt_with_runtime_agents,
        &runtime_config,
        MemoryPromptContext::with_working_dir(Path::new(&workspace_root)),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::Memory,
        prompt_with_memory.clone(),
    );

    let prompt_with_web_search =
        merge_system_prompt_with_web_search(prompt_with_memory, &runtime_config);
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::WebSearch,
        prompt_with_web_search.clone(),
    );

    let prompt_with_request_policy =
        merge_system_prompt_with_request_tool_policy(prompt_with_web_search, &request_tool_policy);
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::RequestToolPolicy,
        prompt_with_request_policy.clone(),
    );

    let prompt_with_artifact = merge_system_prompt_with_artifact_context(
        prompt_with_request_policy,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::Artifact,
        prompt_with_artifact.clone(),
    );

    let prompt_with_elicitation = merge_system_prompt_with_elicitation_context(
        prompt_with_artifact,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::Elicitation,
        prompt_with_elicitation.clone(),
    );

    let prompt_with_team_preference = merge_system_prompt_with_team_preference(
        prompt_with_elicitation,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::TeamPreference,
        prompt_with_team_preference.clone(),
    );

    let system_prompt = merge_system_prompt_with_auto_continue(
        prompt_with_team_preference,
        auto_continue_config.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::AutoContinue,
        system_prompt.clone(),
    );

    let requested_strategy = request.execution_strategy.unwrap_or(persisted_strategy);
    let effective_strategy = requested_strategy.effective_for_message(&request.message);
    turn_input_builder
        .set_requested_execution_strategy(Some(requested_strategy.as_db_value().to_string()))
        .set_effective_execution_strategy(Some(effective_strategy.as_db_value().to_string()));

    if let Some(explicit_strategy) = request.execution_strategy {
        if has_persisted_session {
            if let Err(error) = AsterAgentWrapper::update_session_execution_strategy_sync(
                db,
                session_id,
                explicit_strategy.as_db_value(),
            ) {
                tracing::warn!(
                    "[AsterAgent] 更新会话执行策略失败: session={}, strategy={}, error={}",
                    session_id,
                    explicit_strategy.as_db_value(),
                    error
                );
            }
        }
    }

    tracing::info!(
        "[AsterAgent] 执行策略: requested={:?}, effective={:?}",
        requested_strategy,
        effective_strategy
    );

    // 如果提供了 Provider 配置，则配置 Provider
    if let Some(provider_config) = &request.provider_config {
        tracing::info!(
            "[AsterAgent] 收到 provider_config: provider_id={:?}, provider_name={}, model_name={}, has_api_key={}, base_url={:?}",
            provider_config.provider_id,
            provider_config.provider_name,
            provider_config.model_name,
            provider_config.api_key.is_some(),
            provider_config.base_url
        );
        let config = ProviderConfig {
            provider_name: provider_config.provider_name.clone(),
            provider_selector: provider_config
                .provider_id
                .clone()
                .or_else(|| Some(provider_config.provider_name.clone())),
            model_name: provider_config.model_name.clone(),
            api_key: provider_config.api_key.clone(),
            base_url: provider_config.base_url.clone(),
            credential_uuid: None,
            force_responses_api: false,
            credential_path: None,
        };
        // 如果前端提供了 api_key，直接使用；否则从凭证池选择凭证
        if provider_config.api_key.is_some() {
            state.configure_provider(config, session_id, db).await?;
            let provider_selector = provider_config
                .provider_id
                .as_deref()
                .unwrap_or(&provider_config.provider_name);
            persist_session_provider_routing(session_id, provider_selector).await?;
        } else {
            // 没有 api_key，使用凭证池（优先 provider_id，其次 provider_name）
            let provider_selector = provider_config
                .provider_id
                .as_deref()
                .unwrap_or(&provider_config.provider_name);
            state
                .configure_provider_from_pool(
                    db,
                    provider_selector,
                    &provider_config.model_name,
                    session_id,
                )
                .await?;
            persist_session_provider_routing(session_id, provider_selector).await?;
        }
    }

    // 检查 Provider 是否已配置
    if !state.is_provider_configured().await {
        return Err("Provider 未配置，请先调用 aster_agent_configure_provider".to_string());
    }
    let effective_provider_config = state.get_provider_config().await;
    let provider_routing_snapshot =
        effective_provider_config
            .as_ref()
            .map(|config| TurnProviderRoutingSnapshot {
                provider_name: config.provider_name.clone(),
                provider_selector: config.provider_selector.clone(),
                model_name: config.model_name.clone(),
                credential_uuid: config.credential_uuid.clone(),
                configured_from_request: request.provider_config.is_some(),
                used_inline_api_key: request
                    .provider_config
                    .as_ref()
                    .and_then(|config| config.api_key.as_ref())
                    .is_some(),
            });
    turn_input_builder.set_provider_routing(provider_routing_snapshot.clone());
    let provider_continuation_capability = effective_provider_config
        .as_ref()
        .map(|config| config.provider_continuation_capability())
        .unwrap_or(ProviderContinuationCapability::HistoryReplayOnly);
    let configured_provider_continuation_state = effective_provider_config
        .as_ref()
        .map(|config| config.provider_continuation_state())
        .unwrap_or_else(ProviderContinuationState::history_replay_only);
    let restored_provider_continuation_state = load_previous_provider_continuation_state(
        db,
        session_id,
        provider_routing_snapshot.as_ref(),
        provider_continuation_capability,
    );
    let provider_continuation_state = if matches!(
        restored_provider_continuation_state,
        ProviderContinuationState::HistoryReplayOnly
    ) {
        configured_provider_continuation_state
    } else {
        tracing::info!(
            "[AsterAgent] 恢复上一条 terminal run 的 provider continuation: session_id={}, kind={}",
            session_id,
            restored_provider_continuation_state.kind()
        );
        restored_provider_continuation_state
    };
    turn_input_builder
        .set_provider_continuation_capability(provider_continuation_capability)
        .set_provider_continuation(provider_continuation_state);

    let sandbox_outcome = apply_workspace_sandbox_permissions(
        state,
        config_manager,
        db,
        api_key_provider_service,
        logs,
        mcp_manager,
        automation_state,
        app,
        session_id,
        request.metadata.as_ref(),
        &workspace_root,
        runtime_chat_mode,
        requested_strategy,
    )
    .await
    .map_err(|e| format!("注入 workspace 安全策略失败: {e}"))?;

    match sandbox_outcome {
        WorkspaceSandboxApplyOutcome::Applied { sandbox_type } => {
            tracing::info!(
                "[AsterAgent] 已启用 workspace 本地 sandbox: root={}, type={}",
                workspace_root,
                sandbox_type
            );
        }
        WorkspaceSandboxApplyOutcome::DisabledByConfig => {
            tracing::info!(
                "[AsterAgent] workspace 本地 sandbox 已关闭，继续使用普通执行模式: root={}",
                workspace_root
            );
        }
        WorkspaceSandboxApplyOutcome::UnavailableFallback {
            warning_message,
            notify_user,
        } => {
            tracing::warn!(
                "[AsterAgent] workspace 本地 sandbox 不可用，已降级为普通执行: root={}, warning={}",
                workspace_root,
                warning_message
            );
            if notify_user {
                let warning_event = RuntimeAgentEvent::Warning {
                    code: Some(WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE.to_string()),
                    message: warning_message,
                };
                if let Err(e) = app.emit(&request.event_name, &warning_event) {
                    tracing::error!("[AsterAgent] 发送 sandbox 降级提醒失败: {}", e);
                }
            }
        }
    }

    let tracker = ExecutionTracker::new(db.clone());
    let cancel_token = state.create_cancel_token(session_id).await;
    let auto_continue_metadata = auto_continue_config.clone();
    request.metadata = crate::services::artifact_request_metadata_service::
        normalize_request_metadata_with_artifact_defaults(request.metadata.take());
    let request_metadata = request.metadata.clone();
    sync_browser_assist_runtime_hint(session_id, request_metadata.as_ref()).await;
    let model_skill_tool_enabled = should_enable_model_skill_tool(request_metadata.as_ref());
    let run_observation = Arc::new(Mutex::new(ChatRunObservation::default()));
    let run_observation_for_finalize = run_observation.clone();

    let agent_arc = state.get_agent_arc();
    let runtime_snapshot = {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        match agent.runtime_snapshot(session_id).await {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 提交 turn 前读取 runtime snapshot 失败: session_id={}, error={}",
                    session_id,
                    error
                );
                None
            }
        }
    };
    let runtime_projection_snapshot =
        RuntimeProjectionSnapshot::from_snapshot(session_id, runtime_snapshot.as_ref());
    tracing::info!(
        "[AsterAgent] runtime_projection_snapshot={}",
        serde_json::to_string(&runtime_projection_snapshot).unwrap_or_else(|_| "{}".to_string())
    );
    let resolved_thread_id = runtime_projection_snapshot
        .primary_thread_id()
        .map(str::to_string)
        .unwrap_or_else(|| session_id.to_string());
    let resolved_turn_id = request
        .turn_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let turn_state = TurnState::new(
        session_id,
        workspace_id.as_str(),
        resolved_thread_id.clone(),
        resolved_turn_id.clone(),
        requested_strategy.as_db_value(),
        effective_strategy.as_db_value(),
        TurnRequestToolPolicySnapshot::from(&request_tool_policy),
        include_context_trace,
        runtime_chat_mode_label(runtime_chat_mode),
    );
    tracing::info!(
        "[AsterAgent] turn_state={}",
        serde_json::to_string(&turn_state).unwrap_or_else(|_| "{}".to_string())
    );
    turn_input_builder
        .set_thread_id(turn_state.thread_id.clone())
        .set_turn_id(turn_state.turn_id.clone());
    let turn_input_envelope = turn_input_builder.build();
    let turn_input_diagnostics = turn_input_envelope.diagnostics_snapshot();
    tracing::info!(
        "[AsterAgent] turn_input_envelope={}",
        serde_json::to_string(&turn_input_diagnostics).unwrap_or_else(|_| "{}".to_string())
    );

    let mut run_start_metadata = build_chat_run_metadata_base(
        &request,
        workspace_id.as_str(),
        effective_strategy,
        &request_tool_policy,
        auto_continue_enabled,
        auto_continue_metadata.as_ref(),
    );
    if let Ok(session_state_value) = serde_json::to_value(&session_state_snapshot) {
        run_start_metadata.insert("session_state".to_string(), session_state_value);
    }
    if let Ok(runtime_projection_value) = serde_json::to_value(&runtime_projection_snapshot) {
        run_start_metadata.insert("runtime_projection".to_string(), runtime_projection_value);
    }
    if let Ok(turn_state_value) = serde_json::to_value(&turn_state) {
        run_start_metadata.insert("turn_state".to_string(), turn_state_value);
    }
    if let Ok(turn_input_value) = serde_json::to_value(&turn_input_diagnostics) {
        run_start_metadata.insert("turn_input".to_string(), turn_input_value);
    }
    let run_start_metadata_for_finalize = run_start_metadata.clone();
    let timeline_recorder = Arc::new(Mutex::new(AgentTimelineRecorder::create(
        db.clone(),
        turn_state.thread_id.clone(),
        turn_state.turn_id.clone(),
        request.message.clone(),
    )?));
    let runtime_status_session_config = {
        let mut session_config_builder = SessionConfigBuilder::new(session_id)
            .thread_id(turn_state.thread_id.clone())
            .turn_id(turn_state.turn_id.clone());
        if let Some(turn_context) = merge_turn_context_with_artifact_output_schema(
            turn_input_envelope.turn_context_override(),
            request_metadata.as_ref(),
        ) {
            session_config_builder = session_config_builder.turn_context(turn_context);
        }
        session_config_builder.build()
    };

    {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        if let Err(error) = agent
            .ensure_runtime_turn_initialized(
                &runtime_status_session_config,
                Some(request.message.clone()),
            )
            .await
        {
            tracing::warn!(
                "[AsterAgent] 初始化 runtime turn 失败，后续降级继续: {}",
                error
            );
        }
    }

    // 获取 Agent Arc 并保持 guard 在整个流处理期间存活
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;

    let (initial_runtime_status, decided_runtime_status) = build_turn_runtime_statuses(
        &request,
        effective_strategy,
        &request_tool_policy,
        request
            .provider_config
            .as_ref()
            .map(|config| config.model_name.as_str()),
    );
    for status in [initial_runtime_status, decided_runtime_status] {
        emit_runtime_status_with_projection(
            agent,
            app,
            &request.event_name,
            &timeline_recorder,
            workspace_root.as_str(),
            &runtime_status_session_config,
            status,
        )
        .await;
    }
    let resolved_thread_id_for_session = turn_state.thread_id.clone();
    let resolved_turn_id_for_session = turn_state.turn_id.clone();
    let turn_input_envelope_for_session = turn_input_envelope.clone();
    let request_metadata_for_session = request_metadata.clone();

    let build_session_config = || {
        let mut session_config_builder = SessionConfigBuilder::new(session_id)
            .thread_id(resolved_thread_id_for_session.clone())
            .turn_id(resolved_turn_id_for_session.clone());
        if let Some(prompt) = turn_input_envelope_for_session.system_prompt() {
            session_config_builder = session_config_builder.system_prompt(prompt.to_string());
        }
        if let Some(turn_context) = merge_turn_context_with_artifact_output_schema(
            turn_input_envelope_for_session.turn_context_override(),
            request_metadata_for_session.as_ref(),
        ) {
            session_config_builder = session_config_builder.turn_context(turn_context);
        }
        session_config_builder = session_config_builder
            .include_context_trace(turn_input_envelope_for_session.include_context_trace());
        session_config_builder.build()
    };

    lime_agent::tools::set_skill_tool_session_access(session_id, model_skill_tool_enabled);
    let final_result = tracker
        .with_run_custom(
            RunSource::Chat,
            Some("agent_runtime_submit_turn".to_string()),
            Some(session_id.to_string()),
            Some(serde_json::Value::Object(run_start_metadata.clone())),
            async {
                let mut added_code_execution = false;
                if effective_strategy == AsterExecutionStrategy::CodeOrchestrated {
                    added_code_execution = ensure_code_execution_extension_enabled(agent).await?;
                }

                let primary_result = stream_reply_once(
                    agent,
                    app,
                    &request.event_name,
                    build_runtime_user_message(&request.message, request.images.as_deref()),
                    Some(Path::new(&workspace_root)),
                    build_session_config(),
                    cancel_token.clone(),
                    &request_tool_policy,
                    {
                        let run_observation = run_observation.clone();
                        let app = app.clone();
                        let event_name = request.event_name.clone();
                        let timeline_recorder = timeline_recorder.clone();
                        let workspace_root = workspace_root.clone();
                        let request_metadata = request_metadata.clone();
                        let provider_continuation_capability = provider_continuation_capability;
                        move |event| {
                            let mut observation = match run_observation.lock() {
                                Ok(guard) => guard,
                                Err(error) => {
                                    tracing::warn!(
                                        "[AsterAgent] run observation lock poisoned，继续复用内部状态"
                                    );
                                    error.into_inner()
                                }
                            };
                            observation.record_event(
                                event,
                                workspace_root.as_str(),
                                request_metadata.as_ref(),
                                provider_continuation_capability,
                            );
                            let mut recorder = match timeline_recorder.lock() {
                                Ok(guard) => guard,
                                Err(error) => error.into_inner(),
                            };
                            if let Err(error) = recorder.record_runtime_event(
                                &app,
                                &event_name,
                                event,
                                workspace_root.as_str(),
                            ) {
                                tracing::warn!(
                                    "[AsterAgent] 记录时间线事件失败（已降级继续）: {}",
                                    error
                                );
                            }
                        }
                    },
                )
                .await;

                let run_result: Result<(), String> = match primary_result {
                    Ok(execution) => {
                        maybe_persist_artifact_document_after_stream(
                            &app,
                            &request.event_name,
                            &timeline_recorder,
                            &run_observation,
                            workspace_root.as_str(),
                            workspace_id.as_str(),
                            turn_state.thread_id.as_str(),
                            turn_state.turn_id.as_str(),
                            request_metadata.as_ref(),
                            execution.text_output.as_str(),
                        );
                        Ok(())
                    }
                    Err(primary_error)
                        if effective_strategy == AsterExecutionStrategy::CodeOrchestrated
                            && should_fallback_to_react_from_code_orchestrated(&primary_error) =>
                    {
                        tracing::warn!(
                            "[AsterAgent] 编排模式执行失败，自动降级到 ReAct: {}",
                            primary_error.message
                        );
                        if added_code_execution {
                            if let Err(e) =
                                agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await
                            {
                                tracing::warn!(
                                    "[AsterAgent] 降级前移除 code_execution 扩展失败: {}",
                                    e
                                );
                            }
                            added_code_execution = false;
                        }
                        stream_reply_once(
                            agent,
                            &app,
                            &request.event_name,
                            build_runtime_user_message(
                                &request.message,
                                request.images.as_deref(),
                            ),
                            Some(Path::new(&workspace_root)),
                            build_session_config(),
                            cancel_token.clone(),
                            &request_tool_policy,
                            {
                                let run_observation = run_observation.clone();
                                let app = app.clone();
                                let event_name = request.event_name.clone();
                                let timeline_recorder = timeline_recorder.clone();
                                let workspace_root = workspace_root.clone();
                                let request_metadata = request_metadata.clone();
                                let provider_continuation_capability =
                                    provider_continuation_capability;
                                move |event| {
                                    let mut observation = match run_observation.lock() {
                                        Ok(guard) => guard,
                                        Err(error) => {
                                            tracing::warn!(
                                                "[AsterAgent] run observation lock poisoned，继续复用内部状态"
                                            );
                                            error.into_inner()
                                        }
                                    };
                                    observation.record_event(
                                        event,
                                        workspace_root.as_str(),
                                        request_metadata.as_ref(),
                                        provider_continuation_capability,
                                    );
                                    let mut recorder = match timeline_recorder.lock() {
                                        Ok(guard) => guard,
                                        Err(error) => error.into_inner(),
                                    };
                                    if let Err(error) = recorder.record_runtime_event(
                                        &app,
                                        &event_name,
                                        event,
                                        workspace_root.as_str(),
                                    ) {
                                        tracing::warn!(
                                            "[AsterAgent] 记录时间线事件失败（已降级继续）: {}",
                                            error
                                        );
                                    }
                                }
                            },
                        )
                        .await
                        .map(|execution| {
                            maybe_persist_artifact_document_after_stream(
                                &app,
                                &request.event_name,
                                &timeline_recorder,
                                &run_observation,
                                workspace_root.as_str(),
                                workspace_id.as_str(),
                                turn_state.thread_id.as_str(),
                                turn_state.turn_id.as_str(),
                                request_metadata.as_ref(),
                                execution.text_output.as_str(),
                            );
                        })
                        .map_err(|fallback_err| fallback_err.message)
                    }
                    Err(primary_error) => Err(primary_error.message),
                };

                if added_code_execution {
                    if let Err(e) = agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await {
                        tracing::warn!(
                            "[AsterAgent] 移除 code_execution 扩展失败，后续会话可能继续保留编排模式: {}",
                            e
                        );
                    }
                }

                run_result
            },
            move |result| {
                let observation = match run_observation_for_finalize.lock() {
                    Ok(guard) => guard.clone(),
                    Err(error) => {
                        tracing::warn!(
                            "[AsterAgent] finalize run metadata 时 observation lock 已 poisoned"
                        );
                        error.into_inner().clone()
                    }
                };
                let metadata =
                    build_chat_run_finish_metadata(&run_start_metadata_for_finalize, &observation);

                match result {
                    Ok(_) => RunFinishDecision {
                        status: lime_core::database::dao::agent_run::AgentRunStatus::Success,
                        error_code: None,
                        error_message: None,
                        metadata: Some(metadata),
                    },
                    Err(err) => RunFinishDecision {
                        status: lime_core::database::dao::agent_run::AgentRunStatus::Error,
                        error_code: Some("chat_stream_failed".to_string()),
                        error_message: Some(err.clone()),
                        metadata: Some(metadata),
                    },
                }
            },
        )
        .await;
    lime_agent::tools::clear_skill_tool_session_access(session_id);

    match final_result {
        Ok(()) => {
            complete_runtime_status_projection(
                agent,
                app,
                &request.event_name,
                &timeline_recorder,
                workspace_root.as_str(),
                &runtime_status_session_config,
            )
            .await;
            {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                if let Err(error) = recorder.complete_turn_success(app, &request.event_name) {
                    tracing::warn!("[AsterAgent] 完成 turn 时间线失败（已降级继续）: {}", error);
                }
            }
            let done_event = RuntimeAgentEvent::FinalDone { usage: None };
            if let Err(e) = app.emit(&request.event_name, &done_event) {
                tracing::error!("[AsterAgent] 发送完成事件失败: {}", e);
            }
            emit_subagent_status_changed_events(app, session_id).await;
        }
        Err(e) => {
            complete_runtime_status_projection(
                agent,
                app,
                &request.event_name,
                &timeline_recorder,
                workspace_root.as_str(),
                &runtime_status_session_config,
            )
            .await;
            {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                if let Err(timeline_error) = recorder.fail_turn(app, &request.event_name, &e) {
                    tracing::warn!(
                        "[AsterAgent] 记录失败 turn 时间线失败（已降级继续）: {}",
                        timeline_error
                    );
                }
            }
            let error_event = RuntimeAgentEvent::Error { message: e.clone() };
            if let Err(emit_err) = app.emit(&request.event_name, &error_event) {
                tracing::error!("[AsterAgent] 发送错误事件失败: {}", emit_err);
            }
            emit_subagent_status_changed_events(app, session_id).await;
            state.remove_cancel_token(session_id).await;
            return Err(e);
        }
    }

    // 清理取消令牌
    state.remove_cancel_token(session_id).await;

    Ok(())
}

fn build_queued_turn_preview(message: &str) -> String {
    let compact = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return "空白输入".to_string();
    }

    let preview = compact.chars().take(80).collect::<String>();
    if compact.chars().count() > 80 {
        format!("{preview}...")
    } else {
        preview
    }
}

async fn update_compaction_session_metrics(
    session_config: &aster::agents::SessionConfig,
    usage: &aster::providers::base::ProviderUsage,
) -> Result<(), String> {
    let session = read_session(&session_config.id, false, "读取会话 token 统计失败").await?;

    let update = build_compaction_session_metrics_update(&session, session_config, usage);
    persist_compaction_session_metrics_update(&session_config.id, &update).await
}

fn build_compaction_session_metrics_update(
    session: &aster::session::Session,
    session_config: &aster::agents::SessionConfig,
    usage: &aster::providers::base::ProviderUsage,
) -> CompactionSessionMetricsUpdate {
    let schedule_id = session_config
        .schedule_id
        .clone()
        .or(session.schedule_id.clone());

    let accumulate = |current: Option<i32>, delta: Option<i32>| match (current, delta) {
        (Some(lhs), Some(rhs)) => Some(lhs + rhs),
        _ => current.or(delta),
    };

    let accumulated_total = accumulate(session.accumulated_total_tokens, usage.usage.total_tokens);
    let accumulated_input = accumulate(session.accumulated_input_tokens, usage.usage.input_tokens);
    let accumulated_output =
        accumulate(session.accumulated_output_tokens, usage.usage.output_tokens);

    let current_window_tokens = usage
        .usage
        .output_tokens
        .or(usage.usage.total_tokens)
        .unwrap_or(0);

    CompactionSessionMetricsUpdate {
        schedule_id,
        current_window_tokens,
        accumulated_total_tokens: accumulated_total,
        accumulated_input_tokens: accumulated_input,
        accumulated_output_tokens: accumulated_output,
    }
}

pub(crate) async fn compact_runtime_session_internal(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    request: AgentRuntimeCompactSessionRequest,
) -> Result<(), String> {
    let session_id = normalize_required_text(&request.session_id, "session_id")?;
    let event_name = normalize_required_text(&request.event_name, "event_name")?;
    let cancel_token = state.create_cancel_token(&session_id).await;
    let agent_arc = state.get_agent_arc();

    let runtime_snapshot = {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        match agent.runtime_snapshot(&session_id).await {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 压缩上下文前读取 runtime snapshot 失败，继续使用 session 默认线程: session_id={}, error={}",
                    session_id,
                    error
                );
                None
            }
        }
    };
    let runtime_projection_snapshot =
        RuntimeProjectionSnapshot::from_snapshot(&session_id, runtime_snapshot.as_ref());
    let resolved_thread_id = runtime_projection_snapshot
        .primary_thread_id()
        .map(str::to_string)
        .unwrap_or_else(|| session_id.clone());
    let resolved_turn_id = Uuid::new_v4().to_string();
    let timeline_recorder = Arc::new(Mutex::new(AgentTimelineRecorder::create(
        db.clone(),
        resolved_thread_id.clone(),
        resolved_turn_id.clone(),
        "压缩上下文",
    )?));
    let session_config = SessionConfigBuilder::new(&session_id)
        .thread_id(resolved_thread_id)
        .turn_id(resolved_turn_id)
        .build();

    let final_result: Result<(), String> = {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        let turn = agent
            .ensure_runtime_turn_initialized(&session_config, Some("压缩上下文".to_string()))
            .await
            .map_err(|error| format!("初始化压缩 turn 失败: {error}"))?;
        for event in lime_agent::project_runtime_event(AgentEvent::TurnStarted { turn }) {
            {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                if let Err(error) = recorder.record_runtime_event(app, &event_name, &event, "") {
                    tracing::warn!(
                        "[AsterAgent] 记录压缩时间线事件失败（已降级继续）: {}",
                        error
                    );
                }
            }
            if let Err(error) = app.emit(&event_name, &event) {
                tracing::error!("[AsterAgent] 发送压缩事件失败: {}", error);
            }
        }

        let compaction_turn_id = session_config
            .turn_id
            .clone()
            .unwrap_or_else(|| session_id.clone());
        let compaction_item_id = format!("context_compaction:{compaction_turn_id}");
        let start_event = RuntimeAgentEvent::ContextCompactionStarted {
            item_id: compaction_item_id.clone(),
            trigger: "manual".to_string(),
            detail: Some("系统正在将较早消息整理为摘要，以释放上下文窗口。".to_string()),
        };
        {
            let mut recorder = match timeline_recorder.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            if let Err(error) = recorder.record_runtime_event(app, &event_name, &start_event, "") {
                tracing::warn!(
                    "[AsterAgent] 记录压缩开始时间线失败（已降级继续）: {}",
                    error
                );
            }
        }
        if let Err(error) = app.emit(&event_name, &start_event) {
            tracing::error!("[AsterAgent] 发送压缩开始事件失败: {}", error);
        }

        let session = read_session(&session_id, true, "读取会话失败").await?;
        let conversation = session
            .conversation
            .ok_or_else(|| "Session has no conversation".to_string())?;
        let provider = agent
            .provider()
            .await
            .map_err(|error| format!("读取 provider 失败: {error}"))?;
        let (compacted_conversation, usage) =
            aster::context_mgmt::compact_messages(provider.as_ref(), &conversation, true)
                .await
                .map_err(|error| format!("压缩上下文失败: {error}"))?;
        replace_session_conversation(&session_id, &compacted_conversation, "写回压缩后的会话")
            .await?;
        update_compaction_session_metrics(&session_config, &usage).await?;

        let completed_event = RuntimeAgentEvent::ContextCompactionCompleted {
            item_id: compaction_item_id,
            trigger: "manual".to_string(),
            detail: Some("较早消息已替换为摘要，后续回复会基于压缩后的上下文继续。".to_string()),
        };
        {
            let mut recorder = match timeline_recorder.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            if let Err(error) =
                recorder.record_runtime_event(app, &event_name, &completed_event, "")
            {
                tracing::warn!(
                    "[AsterAgent] 记录压缩完成时间线失败（已降级继续）: {}",
                    error
                );
            }
        }
        if let Err(error) = app.emit(&event_name, &completed_event) {
            tracing::error!("[AsterAgent] 发送压缩完成事件失败: {}", error);
        }

        Ok(())
    };

    match final_result {
        Ok(()) => {
            let mut recorder = match timeline_recorder.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            if let Err(error) = recorder.complete_turn_success(app, &event_name) {
                tracing::warn!(
                    "[AsterAgent] 完成压缩 turn 时间线失败（已降级继续）: {}",
                    error
                );
            }
            let done_event = RuntimeAgentEvent::FinalDone { usage: None };
            if let Err(error) = app.emit(&event_name, &done_event) {
                tracing::error!("[AsterAgent] 发送压缩完成事件失败: {}", error);
            }
        }
        Err(error) => {
            {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                if let Err(timeline_error) = recorder.fail_turn(app, &event_name, &error) {
                    tracing::warn!(
                        "[AsterAgent] 记录压缩失败 turn 时间线失败（已降级继续）: {}",
                        timeline_error
                    );
                }
                let error_event = RuntimeAgentEvent::Error {
                    message: error.clone(),
                };
                if let Err(emit_error) = app.emit(&event_name, &error_event) {
                    tracing::error!("[AsterAgent] 发送压缩错误事件失败: {}", emit_error);
                }
            }
            state.remove_cancel_token(&session_id).await;
            return Err(error);
        }
    }

    drop(cancel_token);
    state.remove_cancel_token(&session_id).await;
    Ok(())
}

fn extract_subagent_parent_session_id(metadata: Option<&serde_json::Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("subagent"))
        .and_then(serde_json::Value::as_object)
        .and_then(|subagent| {
            subagent
                .get("parent_session_id")
                .or_else(|| subagent.get("parentSessionId"))
        })
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

async fn resolve_team_runtime_provider_group_for_request(request: &AsterChatRequest) -> String {
    if let Some(provider_config) = request.provider_config.as_ref() {
        if let Some(provider_selector) = provider_config
            .provider_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            return normalize_team_runtime_provider_group(provider_selector);
        }
        return normalize_team_runtime_provider_group(&provider_config.provider_name);
    }

    match read_session(&request.session_id, false, "读取 provider 会话上下文失败").await {
        Ok(session) => {
            let provider_selector = resolve_session_provider_selector(&session)
                .or_else(|| normalize_optional_text(session.provider_name.clone()));
            provider_selector
                .map(|value| normalize_team_runtime_provider_group(&value))
                .unwrap_or_else(|| "default".to_string())
        }
        Err(_) => "default".to_string(),
    }
}

fn should_apply_provider_runtime_guard(provider_group: &str) -> bool {
    resolve_provider_runtime_parallel_budget(provider_group).is_some()
}

fn build_provider_runtime_guard_lease_id(request: &AsterChatRequest) -> String {
    format!("provider-runtime-guard:{}", request.session_id)
}

fn build_provider_runtime_status_metadata(
    snapshot: &ProviderRuntimeGovernorSnapshot,
) -> std::collections::HashMap<String, serde_json::Value> {
    let mut metadata = std::collections::HashMap::new();
    metadata.insert(
        "concurrency_phase".to_string(),
        serde_json::Value::String(snapshot.provider_phase.clone()),
    );
    metadata.insert(
        "concurrency_scope".to_string(),
        serde_json::Value::String("provider_global".to_string()),
    );
    metadata.insert(
        "concurrency_active_count".to_string(),
        serde_json::Value::Number(snapshot.provider_active_count.into()),
    );
    metadata.insert(
        "concurrency_queued_count".to_string(),
        serde_json::Value::Number(snapshot.provider_queued_count.into()),
    );
    metadata.insert(
        "concurrency_budget".to_string(),
        serde_json::Value::Number(snapshot.provider_parallel_budget.into()),
    );
    metadata.insert(
        "provider_concurrency_group".to_string(),
        serde_json::Value::String(snapshot.provider_concurrency_group.clone()),
    );
    metadata.insert(
        "provider_parallel_budget".to_string(),
        serde_json::Value::Number(snapshot.provider_parallel_budget.into()),
    );
    if let Some(queue_reason) = snapshot.queue_reason.as_ref() {
        metadata.insert(
            "queue_reason".to_string(),
            serde_json::Value::String(queue_reason.clone()),
        );
    }
    metadata.insert(
        "retryable_overload".to_string(),
        serde_json::Value::Bool(snapshot.retryable_overload),
    );
    metadata
}

fn build_provider_waiting_runtime_status(
    snapshot: &ProviderRuntimeGovernorSnapshot,
    is_team_member: bool,
) -> AgentRuntimeStatus {
    let target_label = if is_team_member {
        "这位协作成员"
    } else {
        "这条请求"
    };
    let mut checkpoints = vec![format!(
        "当前服务仅同时处理 {} 条此类请求",
        snapshot.provider_parallel_budget
    )];
    if snapshot.provider_active_count > 0 {
        checkpoints.push(format!(
            "前面还有 {} 条请求正在处理",
            snapshot.provider_active_count
        ));
    }
    if snapshot.provider_queued_count > 0 {
        checkpoints.push(format!(
            "还有 {} 条请求在等待顺序处理",
            snapshot.provider_queued_count
        ));
    }

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "当前服务较忙，稍后开始处理".to_string(),
        detail: snapshot
            .queue_reason
            .clone()
            .unwrap_or_else(|| format!("为了保证稳定性，{target_label}会在前一项完成后自动继续。")),
        checkpoints,
        metadata: Some(build_provider_runtime_status_metadata(snapshot)),
    }
}

fn build_provider_running_runtime_status(
    snapshot: &ProviderRuntimeGovernorSnapshot,
    is_team_member: bool,
) -> AgentRuntimeStatus {
    let detail = if is_team_member {
        "已轮到这位协作成员，系统会按更稳妥的节奏继续处理。".to_string()
    } else {
        "已轮到这条请求，系统会按更稳妥的节奏开始处理。".to_string()
    };

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: if is_team_member {
            "协作成员开始处理".to_string()
        } else {
            "开始处理这条请求".to_string()
        },
        detail,
        checkpoints: vec![
            format!("当前服务同时处理上限 {}", snapshot.provider_parallel_budget),
            "系统会继续保持稳妥处理，尽量避免直接失败".to_string(),
        ],
        metadata: Some(build_provider_runtime_status_metadata(snapshot)),
    }
}

fn build_team_runtime_status_metadata(
    snapshot: &TeamRuntimeGovernorSnapshot,
) -> std::collections::HashMap<String, serde_json::Value> {
    let mut metadata = std::collections::HashMap::new();
    metadata.insert(
        "team_phase".to_string(),
        serde_json::Value::String(snapshot.team_phase.clone()),
    );
    metadata.insert(
        "team_parallel_budget".to_string(),
        serde_json::Value::Number(snapshot.team_parallel_budget.into()),
    );
    metadata.insert(
        "team_active_count".to_string(),
        serde_json::Value::Number(snapshot.team_active_count.into()),
    );
    metadata.insert(
        "team_queued_count".to_string(),
        serde_json::Value::Number(snapshot.team_queued_count.into()),
    );
    metadata.insert(
        "provider_concurrency_group".to_string(),
        serde_json::Value::String(snapshot.provider_concurrency_group.clone()),
    );
    metadata.insert(
        "provider_parallel_budget".to_string(),
        serde_json::Value::Number(snapshot.provider_parallel_budget.into()),
    );
    if let Some(queue_reason) = snapshot.queue_reason.as_ref() {
        metadata.insert(
            "queue_reason".to_string(),
            serde_json::Value::String(queue_reason.clone()),
        );
    }
    metadata.insert(
        "retryable_overload".to_string(),
        serde_json::Value::Bool(snapshot.retryable_overload),
    );
    metadata
}

fn build_team_waiting_runtime_status(snapshot: &TeamRuntimeGovernorSnapshot) -> AgentRuntimeStatus {
    let mut checkpoints = vec![format!(
        "当前已有 {}/{} 位协作成员在处理",
        snapshot.team_active_count, snapshot.team_parallel_budget
    )];
    if snapshot.team_queued_count > 0 {
        checkpoints.push(format!(
            "还有 {} 位协作成员在等待执行",
            snapshot.team_queued_count
        ));
    }
    if snapshot.provider_parallel_budget == 1 {
        checkpoints.push("当前服务较忙，已切换为更稳妥的顺序处理".to_string());
    }

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "等待执行窗口".to_string(),
        detail: snapshot
            .queue_reason
            .clone()
            .unwrap_or_else(|| "系统正在安排可用的处理窗口，稍后会自动继续。".to_string()),
        checkpoints,
        metadata: Some(build_team_runtime_status_metadata(snapshot)),
    }
}

fn build_team_running_runtime_status(snapshot: &TeamRuntimeGovernorSnapshot) -> AgentRuntimeStatus {
    let mut checkpoints = vec![format!(
        "当前并发预算 {}/{}",
        snapshot.team_active_count, snapshot.team_parallel_budget
    )];
    if snapshot.provider_parallel_budget == 1 {
        checkpoints.push("当前服务使用稳妥处理模式".to_string());
    }

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "开始处理".to_string(),
        detail: "已获得可用执行窗口，这位协作成员正在接手当前任务。".to_string(),
        checkpoints,
        metadata: Some(build_team_runtime_status_metadata(snapshot)),
    }
}

fn emit_transient_runtime_status(app: &AppHandle, event_name: &str, status: AgentRuntimeStatus) {
    if event_name.trim().is_empty() {
        return;
    }
    let event = RuntimeAgentEvent::RuntimeStatus { status };
    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!(
            "[AsterAgent] 发送 team runtime 状态失败: event_name={}, error={}",
            event_name,
            error
        );
    }
}

async fn execute_queued_request_with_team_runtime_governor(
    context: &crate::agent::runtime_queue_service::AgentRuntimeQueueContext,
    request: AsterChatRequest,
) -> Result<(), String> {
    let request_session_id = request.session_id.clone();
    let provider_group = resolve_team_runtime_provider_group_for_request(&request).await;
    let parent_session_id = extract_subagent_parent_session_id(request.metadata.as_ref());
    let is_team_member = parent_session_id.is_some();
    let provider_guard_lease_id = build_provider_runtime_guard_lease_id(&request);
    let provider_guard_permit = if should_apply_provider_runtime_guard(&provider_group) {
        if let Some(waiting_snapshot) =
            preview_provider_runtime_wait_snapshot(&provider_group).await
        {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_provider_waiting_runtime_status(&waiting_snapshot, is_team_member),
            );
            if is_team_member {
                emit_subagent_status_changed_events(&context.app, &request_session_id).await;
            }
        }

        let permit = acquire_provider_runtime_permit(
            provider_guard_lease_id.clone(),
            provider_group.clone(),
        )
        .await;
        if let Some(running_snapshot) =
            snapshot_provider_runtime_lease(&provider_guard_lease_id).await
        {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_provider_running_runtime_status(&running_snapshot, is_team_member),
            );
        }
        if is_team_member {
            emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        }
        Some(permit)
    } else {
        None
    };

    let result = if let Some(parent_session_id) = parent_session_id {
        if let Some(waiting_snapshot) =
            preview_team_runtime_wait_snapshot(&parent_session_id, &provider_group).await
        {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_team_waiting_runtime_status(&waiting_snapshot),
            );
            emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        }

        let permit = acquire_team_runtime_permit(
            request_session_id.clone(),
            parent_session_id,
            provider_group,
        )
        .await;
        if let Some(running_snapshot) = snapshot_team_runtime_session(&request_session_id).await {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_team_running_runtime_status(&running_snapshot),
            );
        }
        emit_subagent_status_changed_events(&context.app, &request_session_id).await;

        let result = execute_aster_chat_request(
            &context.app,
            &context.state,
            &context.db,
            &context.api_key_provider_service,
            &context.logs,
            &context.config_manager,
            &context.mcp_manager,
            &context.automation_state,
            request.clone(),
        )
        .await;

        release_team_runtime_permit(permit).await;
        emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        result
    } else {
        execute_aster_chat_request(
            &context.app,
            &context.state,
            &context.db,
            &context.api_key_provider_service,
            &context.logs,
            &context.config_manager,
            &context.mcp_manager,
            &context.automation_state,
            request,
        )
        .await
    };

    if let Some(permit) = provider_guard_permit {
        release_provider_runtime_permit(permit).await;
        if is_team_member {
            emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        }
    }
    result
}

pub(crate) fn build_queued_turn_task(
    mut request: AsterChatRequest,
) -> Result<QueuedTurnTask<serde_json::Value>, String> {
    let queued_turn_id = request
        .queued_turn_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request.queued_turn_id = Some(queued_turn_id.clone());

    let image_count = request
        .images
        .as_ref()
        .map(|images| images.len())
        .unwrap_or(0);
    let payload =
        serde_json::to_value(&request).map_err(|e| format!("序列化排队 turn 失败: {e}"))?;

    Ok(QueuedTurnTask {
        queued_turn_id,
        session_id: request.session_id.clone(),
        event_name: request.event_name.clone(),
        message_preview: build_queued_turn_preview(&request.message),
        message_text: request.message.clone(),
        created_at: chrono::Utc::now().timestamp_millis(),
        image_count,
        payload,
    })
}

fn deserialize_queued_turn_request(payload: serde_json::Value) -> Result<AsterChatRequest, String> {
    serde_json::from_value(payload).map_err(|e| format!("反序列化排队 turn 失败: {e}"))
}

pub(crate) fn build_runtime_queue_executor() -> RuntimeQueueExecutor {
    Arc::new(|context, payload| {
        async move {
            let request = deserialize_queued_turn_request(payload)?;
            execute_queued_request_with_team_runtime_governor(&context, request).await
        }
        .boxed()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::providers::base::{ProviderUsage, Usage};
    use aster::session::{
        initialize_shared_session_runtime_with_root, is_global_session_store_set, SessionManager,
        SessionType,
    };
    use lime_core::database::schema::create_tables;
    use lime_services::aster_session_store::LimeSessionStore;
    use rusqlite::Connection;
    use std::fs;
    use tokio::sync::OnceCell;

    async fn ensure_runtime_turn_test_session_manager() {
        static INIT: OnceCell<()> = OnceCell::const_new();

        INIT.get_or_init(|| async {
            if is_global_session_store_set() {
                return;
            }

            let conn = Connection::open_in_memory().expect("创建内存数据库失败");
            create_tables(&conn).expect("初始化表结构失败");

            let runtime_root =
                std::env::temp_dir().join(format!("lime-runtime-turn-tests-{}", Uuid::new_v4()));
            fs::create_dir_all(&runtime_root).expect("创建 runtime 测试目录失败");

            let session_store = Arc::new(LimeSessionStore::new(Arc::new(Mutex::new(conn))));
            initialize_shared_session_runtime_with_root(runtime_root, Some(session_store))
                .await
                .expect("初始化测试 session manager 失败");
        })
        .await;
    }

    #[tokio::test]
    async fn update_compaction_session_metrics_should_move_summary_tokens_to_current_window() {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "压缩统计测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .schedule_id(Some("job-before".to_string()))
            .total_tokens(Some(90))
            .input_tokens(Some(60))
            .output_tokens(Some(30))
            .accumulated_total_tokens(Some(300))
            .accumulated_input_tokens(Some(200))
            .accumulated_output_tokens(Some(100))
            .apply()
            .await
            .expect("预置 token 统计失败");

        let mut session_config = SessionConfigBuilder::new(&session.id).build();
        session_config.schedule_id = Some("job-compact".to_string());

        let usage = ProviderUsage::new(
            "gpt-4.1".to_string(),
            Usage::new(Some(120), Some(45), Some(165)),
        );

        update_compaction_session_metrics(&session_config, &usage)
            .await
            .expect("更新压缩 token 统计失败");

        let updated = SessionManager::get_session(&session.id, false)
            .await
            .expect("读取更新后的会话失败");

        assert_eq!(updated.schedule_id.as_deref(), Some("job-compact"));
        assert_eq!(updated.total_tokens, Some(45));
        assert_eq!(updated.input_tokens, Some(45));
        assert_eq!(updated.output_tokens, Some(0));
        assert_eq!(updated.accumulated_total_tokens, Some(465));
        assert_eq!(updated.accumulated_input_tokens, Some(320));
        assert_eq!(updated.accumulated_output_tokens, Some(145));

        SessionManager::delete_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn update_compaction_session_metrics_should_reset_current_window_when_usage_tokens_missing(
    ) {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "压缩统计缺字段测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .schedule_id(Some("job-before".to_string()))
            .total_tokens(Some(180))
            .input_tokens(Some(120))
            .output_tokens(Some(60))
            .accumulated_total_tokens(Some(700))
            .accumulated_input_tokens(Some(500))
            .accumulated_output_tokens(Some(200))
            .apply()
            .await
            .expect("预置 token 统计失败");

        let mut session_config = SessionConfigBuilder::new(&session.id).build();
        session_config.schedule_id = Some("job-compact-missing".to_string());

        let usage = ProviderUsage::new("gpt-4.1".to_string(), Usage::default());

        update_compaction_session_metrics(&session_config, &usage)
            .await
            .expect("更新压缩 token 统计失败");

        let updated = SessionManager::get_session(&session.id, false)
            .await
            .expect("读取更新后的会话失败");

        assert_eq!(updated.schedule_id.as_deref(), Some("job-compact-missing"));
        assert_eq!(updated.total_tokens, Some(0));
        assert_eq!(updated.input_tokens, Some(0));
        assert_eq!(updated.output_tokens, Some(0));
        assert_eq!(updated.accumulated_total_tokens, Some(700));
        assert_eq!(updated.accumulated_input_tokens, Some(500));
        assert_eq!(updated.accumulated_output_tokens, Some(200));

        SessionManager::delete_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn update_compaction_session_metrics_should_preserve_existing_schedule_id_when_request_is_empty(
    ) {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "压缩统计保留任务测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .schedule_id(Some("job-existing".to_string()))
            .total_tokens(Some(20))
            .input_tokens(Some(10))
            .output_tokens(Some(10))
            .accumulated_total_tokens(Some(200))
            .accumulated_input_tokens(Some(120))
            .accumulated_output_tokens(Some(80))
            .apply()
            .await
            .expect("预置 token 统计失败");

        let session_config = SessionConfigBuilder::new(&session.id).build();
        let usage = ProviderUsage::new(
            "gpt-4.1".to_string(),
            Usage::new(Some(30), Some(15), Some(45)),
        );

        update_compaction_session_metrics(&session_config, &usage)
            .await
            .expect("更新压缩 token 统计失败");

        let updated = SessionManager::get_session(&session.id, false)
            .await
            .expect("读取更新后的会话失败");

        assert_eq!(updated.schedule_id.as_deref(), Some("job-existing"));
        assert_eq!(updated.total_tokens, Some(15));
        assert_eq!(updated.input_tokens, Some(15));
        assert_eq!(updated.output_tokens, Some(0));
        assert_eq!(updated.accumulated_total_tokens, Some(245));
        assert_eq!(updated.accumulated_input_tokens, Some(150));
        assert_eq!(updated.accumulated_output_tokens, Some(95));

        SessionManager::delete_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[test]
    fn should_skip_artifact_document_autopersist_when_output_is_empty() {
        let observation = Arc::new(Mutex::new(ChatRunObservation::default()));

        assert!(should_skip_artifact_document_autopersist(
            &observation,
            "   \n  "
        ));
    }

    #[test]
    fn should_skip_artifact_document_autopersist_when_runtime_observation_has_artifacts() {
        let observation = Arc::new(Mutex::new(ChatRunObservation::default()));
        observation
            .lock()
            .expect("lock observation")
            .record_artifact_path("social-posts/demo.md".to_string(), None);

        assert!(should_skip_artifact_document_autopersist(
            &observation,
            "普通正文输出"
        ));
    }

    #[test]
    fn should_not_skip_artifact_document_autopersist_based_on_write_file_text_only() {
        let observation = Arc::new(Mutex::new(ChatRunObservation::default()));

        assert!(!should_skip_artifact_document_autopersist(
            &observation,
            "<write_file path=\"social-posts/demo.md\">内容</write_file>"
        ));
    }
}
