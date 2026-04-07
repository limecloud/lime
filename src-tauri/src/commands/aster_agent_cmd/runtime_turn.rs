use super::*;
use aster::session::TurnContextOverride;
use lime_agent::AgentEvent as RuntimeAgentEvent;
use lime_core::workspace::WorkspaceSettings;

const ARTIFACT_DOCUMENT_REPAIRED_WARNING_CODE: &str = "artifact_document_repaired";
const ARTIFACT_DOCUMENT_FAILED_WARNING_CODE: &str = "artifact_document_failed";
const ARTIFACT_DOCUMENT_PERSIST_FAILED_WARNING_CODE: &str = "artifact_document_persist_failed";
const AUTO_CONTEXT_COMPACTION_EVENT_PREFIX: &str = "agent_context_compaction_auto_internal";
const AUTO_CONTEXT_COMPACTION_FAILED_WARNING_CODE: &str = "context_compaction_auto_failed";
const CONTEXT_COMPACTION_NOT_NEEDED_WARNING_CODE: &str = "context_compaction_not_needed";
const LIME_RUNTIME_METADATA_KEY: &str = "lime_runtime";
const LIME_RUNTIME_AUTO_COMPACT_KEY: &str = "auto_compact";

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

fn build_artifact_document_warning_message(
    status: &str,
    fallback_used: bool,
    issues: &[String],
) -> String {
    if status == "failed" {
        return "结构化文稿未完整生成，已保留一份可继续编辑的恢复稿。".to_string();
    }

    if fallback_used
        || issues
            .iter()
            .any(|issue| issue.contains("Markdown 正文自动恢复"))
    {
        return "已根据正文整理出一份可继续编辑的草稿。".to_string();
    }

    if issues
        .iter()
        .any(|issue| issue.contains("不完整的 ArtifactDocument JSON"))
    {
        return "已补全文稿结构，可继续查看和编辑。".to_string();
    }

    "已整理为可继续编辑的文稿。".to_string()
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

pub(crate) fn merge_turn_context_with_workspace_auto_compaction(
    turn_context: Option<TurnContextOverride>,
    workspace_settings: &WorkspaceSettings,
) -> Option<TurnContextOverride> {
    if workspace_settings.auto_compact {
        return turn_context;
    }

    let mut turn_context = turn_context.unwrap_or_default();
    let runtime_metadata = turn_context
        .metadata
        .entry(LIME_RUNTIME_METADATA_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !runtime_metadata.is_object() {
        *runtime_metadata = serde_json::Value::Object(serde_json::Map::new());
    }
    if let serde_json::Value::Object(runtime_metadata_map) = runtime_metadata {
        runtime_metadata_map.insert(
            LIME_RUNTIME_AUTO_COMPACT_KEY.to_string(),
            serde_json::Value::Bool(false),
        );
    }

    Some(turn_context)
}

fn normalize_runtime_turn_request_metadata(
    request: &mut AsterChatRequest,
    session_recent_theme: Option<&str>,
    session_recent_session_mode: Option<&str>,
    session_recent_gate_key: Option<&str>,
    session_recent_run_title: Option<&str>,
    session_recent_content_id: Option<&str>,
) {
    request.metadata = crate::services::artifact_request_metadata_service::
        normalize_request_metadata_with_artifact_defaults(
            request.metadata.take(),
            session_recent_theme,
            session_recent_session_mode,
            session_recent_gate_key,
            session_recent_run_title,
            session_recent_content_id,
        );
}

pub(crate) fn resolve_workspace_id_from_sources(
    request_workspace_id: Option<String>,
    session_workspace_id: Option<String>,
) -> Option<String> {
    normalize_optional_text(request_workspace_id)
        .or_else(|| normalize_optional_text(session_workspace_id))
}

fn resolve_runtime_turn_workspace_id(
    db: &DbConnection,
    request: &AsterChatRequest,
) -> Result<String, String> {
    if let Some(workspace_id) =
        resolve_workspace_id_from_sources(Some(request.workspace_id.clone()), None)
    {
        return Ok(workspace_id);
    }

    let session_workspace_id =
        AsterAgentWrapper::get_session_sync(db, &request.session_id)?.workspace_id;

    resolve_workspace_id_from_sources(None, session_workspace_id)
        .ok_or_else(|| "workspace_id 必填，请先选择项目工作区".to_string())
}

pub(crate) fn resolve_request_web_search_preference_from_sources(
    request_web_search: Option<bool>,
    request_metadata: Option<&serde_json::Value>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
) -> Option<bool> {
    request_web_search.or_else(|| {
        resolve_recent_preference_from_sources(
            request_metadata,
            &["web_search_enabled", "webSearchEnabled"],
            session_recent_preferences.map(|preferences| preferences.web_search),
        )
    })
}

fn resolve_runtime_access_mode_from_request(
    request: &AsterChatRequest,
) -> Option<lime_agent::SessionExecutionRuntimeAccessMode> {
    lime_agent::SessionExecutionRuntimeAccessMode::from_runtime_policies(
        request.approval_policy.as_deref(),
        request.sandbox_policy.as_deref(),
    )
    .or_else(|| {
        let access_mode =
            extract_harness_string(request.metadata.as_ref(), &["access_mode", "accessMode"]);
        lime_agent::SessionExecutionRuntimeAccessMode::from_access_mode_text(access_mode.as_deref())
    })
}

fn backfill_runtime_access_policies(request: &mut AsterChatRequest) {
    let Some(access_mode) = resolve_runtime_access_mode_from_request(request) else {
        return;
    };

    if request.approval_policy.is_none() {
        request.approval_policy = Some(access_mode.approval_policy().to_string());
    }
    if request.sandbox_policy.is_none() {
        request.sandbox_policy = Some(access_mode.sandbox_policy().to_string());
    }
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
    db: &DbConnection,
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

            if let Err(error) =
                crate::services::artifact_document_service::sync_persisted_artifact_document_to_content(
                    db,
                    request_metadata,
                    &persisted,
                )
            {
                tracing::warn!(
                    "[AsterAgent] ArtifactDocument 已落盘，但同步内容版本状态失败: {}",
                    error
                );
            }

            if persisted.repaired || persisted.status == "failed" {
                let (code, prefix) = if persisted.status == "failed" {
                    (
                        ARTIFACT_DOCUMENT_FAILED_WARNING_CODE,
                        "ArtifactDocument 已落盘",
                    )
                } else {
                    (
                        ARTIFACT_DOCUMENT_REPAIRED_WARNING_CODE,
                        "ArtifactDocument 已落盘",
                    )
                };
                let detail = build_artifact_document_warning_message(
                    persisted.status.as_str(),
                    persisted.fallback_used,
                    &persisted.issues,
                );
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
    ensure_runtime_support_tools_registered(state, mcp_manager).await?;
    let request_session_id = request.session_id.clone();
    let mcp_runtime_prepare_future = async {
        let (_start_ok, start_fail) = ensure_lime_mcp_servers_running(db, mcp_manager).await;
        let (_mcp_ok, mcp_fail) = inject_mcp_extensions(state, mcp_manager).await;
        (start_fail, mcp_fail)
    };
    let session_recent_runtime_context_future =
        resolve_session_recent_runtime_context(&request_session_id);

    let should_resolve_session_recent_harness_context = extract_harness_string(
        request.metadata.as_ref(),
        &["theme", "harness_theme", "harnessTheme"],
    )
    .is_none()
        || extract_harness_string(request.metadata.as_ref(), &["session_mode", "sessionMode"])
            .is_none()
        || extract_harness_string(request.metadata.as_ref(), &["gate_key", "gateKey"]).is_none()
        || extract_harness_string(
            request.metadata.as_ref(),
            &["run_title", "runTitle", "title"],
        )
        .is_none()
        || extract_harness_string(request.metadata.as_ref(), &["content_id", "contentId"])
            .is_none();
    let provider_config_future =
        resolve_runtime_request_provider_config(app, db, api_key_provider_service, &request);
    let session_recent_harness_context_future = async {
        if should_resolve_session_recent_harness_context {
            resolve_session_recent_harness_context(&request.session_id).await
        } else {
            Ok(SessionRecentHarnessContext::default())
        }
    };
    let (resolved_provider_config, session_recent_harness_context) = tokio::try_join!(
        provider_config_future,
        session_recent_harness_context_future
    )?;
    if let Some(resolved_provider_config) = resolved_provider_config {
        request.provider_config = Some(resolved_provider_config);
    }
    normalize_runtime_turn_request_metadata(
        &mut request,
        session_recent_harness_context.theme.as_deref(),
        session_recent_harness_context.session_mode.as_deref(),
        session_recent_harness_context.gate_key.as_deref(),
        session_recent_harness_context.run_title.as_deref(),
        session_recent_harness_context.content_id.as_deref(),
    );
    backfill_runtime_access_policies(&mut request);

    // 直接使用前端传递的 session_id
    // LimeSessionStore 会在 add_message 时自动创建不存在的 session
    // 同时 get_session 也会自动创建不存在的 session
    let session_id = &request.session_id;

    let workspace_id = match resolve_runtime_turn_workspace_id(db, &request) {
        Ok(workspace_id) => workspace_id,
        Err(message) => {
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };

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
    let resolved_turn_id = request
        .turn_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request.metadata = prepare_image_skill_launch_request_metadata(
        Path::new(&workspace_root),
        session_id,
        &resolved_turn_id,
        request.metadata.as_ref(),
        request.images.as_deref(),
    );
    request.metadata = prepare_broadcast_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata =
        prepare_resource_search_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_research_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_report_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_deep_search_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_site_search_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_pdf_read_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata =
        prepare_presentation_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_form_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_summary_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_translation_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_analysis_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_typesetting_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_webpage_skill_launch_request_metadata(request.metadata.as_ref());
    request.metadata = prepare_service_scene_launch_request_metadata(request.metadata.as_ref());
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

    let ((start_fail, mcp_fail), session_recent_runtime_context) = tokio::join!(
        mcp_runtime_prepare_future,
        session_recent_runtime_context_future
    );

    if start_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP server 自动启动失败 ({} 失败)，后续可用工具可能不完整",
            start_fail
        );
    }
    if mcp_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP extension 注入失败 ({} 失败)，Agent 可能无法使用某些 MCP 工具",
            mcp_fail
        );
    }

    let SessionRecentRuntimeContext {
        preferences: session_recent_preferences,
        team_selection: session_recent_team_selection,
    } = session_recent_runtime_context?;
    let runtime_chat_mode = resolve_runtime_chat_mode(request.metadata.as_ref());
    let mode_default_web_search = default_web_search_enabled_for_chat_mode(runtime_chat_mode);
    let resolved_request_web_search = resolve_request_web_search_preference_from_sources(
        request.web_search,
        request.metadata.as_ref(),
        session_recent_preferences.as_ref(),
    );
    let (request_web_search, request_search_mode) =
        apply_browser_requirement_to_request_tool_policy(
            request.metadata.as_ref(),
            resolved_request_web_search,
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
        .set_approval_policy(request.approval_policy.clone())
        .set_sandbox_policy(request.sandbox_policy.clone())
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

    let prompt_with_image_skill_launch = merge_system_prompt_with_image_skill_launch(
        prompt_with_artifact,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ImageSkillLaunch,
        prompt_with_image_skill_launch.clone(),
    );

    let prompt_with_cover_skill_launch = merge_system_prompt_with_cover_skill_launch(
        prompt_with_image_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::CoverSkillLaunch,
        prompt_with_cover_skill_launch.clone(),
    );

    let prompt_with_video_skill_launch = merge_system_prompt_with_video_skill_launch(
        prompt_with_cover_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::VideoSkillLaunch,
        prompt_with_video_skill_launch.clone(),
    );

    let prompt_with_broadcast_skill_launch = merge_system_prompt_with_broadcast_skill_launch(
        prompt_with_video_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::BroadcastSkillLaunch,
        prompt_with_broadcast_skill_launch.clone(),
    );

    let prompt_with_resource_search_skill_launch =
        merge_system_prompt_with_resource_search_skill_launch(
            prompt_with_broadcast_skill_launch,
            request.metadata.as_ref(),
        );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ResourceSearchSkillLaunch,
        prompt_with_resource_search_skill_launch.clone(),
    );

    let prompt_with_research_skill_launch = merge_system_prompt_with_research_skill_launch(
        prompt_with_resource_search_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ResearchSkillLaunch,
        prompt_with_research_skill_launch.clone(),
    );

    let prompt_with_report_skill_launch = merge_system_prompt_with_report_skill_launch(
        prompt_with_research_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ReportSkillLaunch,
        prompt_with_report_skill_launch.clone(),
    );

    let prompt_with_deep_search_skill_launch = merge_system_prompt_with_deep_search_skill_launch(
        prompt_with_report_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::DeepSearchSkillLaunch,
        prompt_with_deep_search_skill_launch.clone(),
    );

    let prompt_with_site_search_skill_launch = merge_system_prompt_with_site_search_skill_launch(
        prompt_with_deep_search_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::SiteSearchSkillLaunch,
        prompt_with_site_search_skill_launch.clone(),
    );

    let prompt_with_pdf_read_skill_launch = merge_system_prompt_with_pdf_read_skill_launch(
        prompt_with_site_search_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::PdfReadSkillLaunch,
        prompt_with_pdf_read_skill_launch.clone(),
    );

    let prompt_with_presentation_skill_launch = merge_system_prompt_with_presentation_skill_launch(
        prompt_with_pdf_read_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::PresentationSkillLaunch,
        prompt_with_presentation_skill_launch.clone(),
    );

    let prompt_with_form_skill_launch = merge_system_prompt_with_form_skill_launch(
        prompt_with_presentation_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::FormSkillLaunch,
        prompt_with_form_skill_launch.clone(),
    );

    let prompt_with_summary_skill_launch = merge_system_prompt_with_summary_skill_launch(
        prompt_with_form_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::SummarySkillLaunch,
        prompt_with_summary_skill_launch.clone(),
    );

    let prompt_with_translation_skill_launch = merge_system_prompt_with_translation_skill_launch(
        prompt_with_summary_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::TranslationSkillLaunch,
        prompt_with_translation_skill_launch.clone(),
    );

    let prompt_with_analysis_skill_launch = merge_system_prompt_with_analysis_skill_launch(
        prompt_with_translation_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::AnalysisSkillLaunch,
        prompt_with_analysis_skill_launch.clone(),
    );

    let prompt_with_transcription_skill_launch =
        merge_system_prompt_with_transcription_skill_launch(
            prompt_with_analysis_skill_launch,
            request.metadata.as_ref(),
        );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::TranscriptionSkillLaunch,
        prompt_with_transcription_skill_launch.clone(),
    );

    let prompt_with_url_parse_skill_launch = merge_system_prompt_with_url_parse_skill_launch(
        prompt_with_transcription_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::UrlParseSkillLaunch,
        prompt_with_url_parse_skill_launch.clone(),
    );

    let prompt_with_typesetting_skill_launch = merge_system_prompt_with_typesetting_skill_launch(
        prompt_with_url_parse_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::TypesettingSkillLaunch,
        prompt_with_typesetting_skill_launch.clone(),
    );

    let prompt_with_webpage_skill_launch = merge_system_prompt_with_webpage_skill_launch(
        prompt_with_typesetting_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::WebpageSkillLaunch,
        prompt_with_webpage_skill_launch.clone(),
    );

    let prompt_with_service_skill_launch = merge_system_prompt_with_service_skill_launch(
        prompt_with_webpage_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ServiceSkillLaunch,
        prompt_with_service_skill_launch.clone(),
    );

    let prompt_with_elicitation = merge_system_prompt_with_elicitation_context(
        prompt_with_service_skill_launch,
        request.metadata.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::Elicitation,
        prompt_with_elicitation.clone(),
    );

    let prompt_with_team_preference = merge_system_prompt_with_team_preference(
        prompt_with_elicitation,
        request.metadata.as_ref(),
        session_recent_team_selection.as_ref(),
        resolve_recent_preference_from_sources(
            request.metadata.as_ref(),
            &["subagent_mode_enabled", "subagentModeEnabled"],
            session_recent_preferences
                .as_ref()
                .map(|preferences| preferences.subagent),
        )
        .unwrap_or(false),
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
    maybe_auto_compact_runtime_session_before_turn(
        app,
        state,
        db,
        session_id,
        &request.event_name,
        &workspace.settings,
    )
    .await?;
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
    let request_metadata = request.metadata.clone();
    sync_browser_assist_runtime_hint(session_id, request_metadata.as_ref()).await;
    let service_skill_preload =
        preload_service_skill_launch_execution(db, request_metadata.as_ref())
            .await
            .map_err(|error| format!("站点技能预执行失败: {error}"))?;
    let system_prompt = merge_system_prompt_with_service_skill_launch_preload(
        system_prompt,
        service_skill_preload.as_ref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ServiceSkillLaunchPreload,
        system_prompt.clone(),
    );
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
        session_recent_preferences.as_ref(),
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
    if let Some(preload) = service_skill_preload.as_ref() {
        run_start_metadata.insert(
            "service_skill_launch_preload".to_string(),
            serde_json::json!({
                "executed": true,
                "adapter_name": preload.request.adapter_name,
                "ok": preload.result.ok,
                "error_code": preload.result.error_code,
                "saved_content_id": preload
                    .result
                    .saved_content
                    .as_ref()
                    .map(|content| content.content_id.clone()),
            }),
        );
    }
    let run_start_metadata_for_finalize = run_start_metadata.clone();
    let timeline_recorder = Arc::new(Mutex::new(AgentTimelineRecorder::create(
        db.clone(),
        turn_state.thread_id.clone(),
        turn_state.turn_id.clone(),
        request.message.clone(),
    )?));
    let workspace_settings = workspace.settings.clone();
    let runtime_status_session_config = {
        let mut session_config_builder = SessionConfigBuilder::new(session_id)
            .thread_id(turn_state.thread_id.clone())
            .turn_id(turn_state.turn_id.clone());
        let turn_context = merge_turn_context_with_workspace_auto_compaction(
            merge_turn_context_with_artifact_output_schema(
                turn_input_envelope.turn_context_override(),
                request_metadata.as_ref(),
            ),
            &workspace_settings,
        );
        if let Some(turn_context) = turn_context {
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
        session_recent_preferences.as_ref(),
    )
    .await?;
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
        let turn_context = merge_turn_context_with_workspace_auto_compaction(
            merge_turn_context_with_artifact_output_schema(
                turn_input_envelope_for_session.turn_context_override(),
                request_metadata_for_session.as_ref(),
            ),
            &workspace_settings,
        );
        if let Some(turn_context) = turn_context {
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
                            db,
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
                                db,
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
            let usage = resolve_runtime_message_usage(session_id).await;
            if let Some(ref usage) = usage {
                if let Err(error) = persist_latest_assistant_message_usage(db, session_id, usage) {
                    tracing::warn!(
                        "[AsterAgent] 持久化消息 usage 失败（已降级继续）: {}",
                        error
                    );
                }
            }
            let done_event = RuntimeAgentEvent::FinalDone { usage };
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

fn resolve_runtime_message_usage_from_session(
    session: &aster::session::Session,
) -> Option<lime_agent::AgentTokenUsage> {
    match (session.input_tokens, session.output_tokens) {
        (Some(input_tokens), Some(output_tokens)) if input_tokens >= 0 && output_tokens >= 0 => {
            Some(lime_agent::AgentTokenUsage {
                input_tokens: input_tokens as u32,
                output_tokens: output_tokens as u32,
            })
        }
        _ => None,
    }
}

async fn resolve_runtime_message_usage(session_id: &str) -> Option<lime_agent::AgentTokenUsage> {
    let session = read_session(session_id, false, "读取会话 token 统计失败")
        .await
        .ok()?;
    resolve_runtime_message_usage_from_session(&session)
}

fn persist_latest_assistant_message_usage(
    db: &DbConnection,
    session_id: &str,
    usage: &lime_agent::AgentTokenUsage,
) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|error| format!("更新消息 usage 时数据库锁定失败: {error}"))?;
    lime_core::database::agent_session_repository::update_latest_assistant_message_usage(
        &conn,
        session_id,
        usage.input_tokens,
        usage.output_tokens,
    )?;
    Ok(())
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeSessionCompactionTrigger {
    Manual,
    Auto,
}

impl RuntimeSessionCompactionTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Auto => "auto",
        }
    }

    fn start_detail(self) -> &'static str {
        match self {
            Self::Manual => "系统正在将较早消息整理为摘要，以释放上下文窗口。",
            Self::Auto => "检测到会话历史已接近上限，系统正在自动整理较早消息以释放上下文窗口。",
        }
    }

    fn completed_detail(self) -> &'static str {
        match self {
            Self::Manual => "较早消息已替换为摘要，后续回复会基于压缩后的上下文继续。",
            Self::Auto => "较早消息已自动替换为摘要，本轮回复会基于压缩后的上下文继续。",
        }
    }
}

fn build_auto_context_compaction_event_name(session_id: &str) -> String {
    format!(
        "{AUTO_CONTEXT_COMPACTION_EVENT_PREFIX}_{session_id}_{}",
        Uuid::new_v4()
    )
}

async fn ensure_compaction_agent_initialized(
    state: &AsterAgentState,
    db: &DbConnection,
) -> Result<(), String> {
    state.init_agent_with_db(db).await
}

fn resolve_context_compaction_conversation<'a>(
    session: &'a aster::session::Session,
) -> Result<Option<&'a aster::conversation::Conversation>, String> {
    let conversation = session
        .conversation
        .as_ref()
        .ok_or_else(|| "当前会话上下文尚未准备完成，请稍后再试".to_string())?;
    if session.message_count < 2 || conversation.messages().len() < 2 {
        return Ok(None);
    }
    Ok(Some(conversation))
}

fn emit_context_compaction_skip(app: &AppHandle, event_name: &str, message: &str) {
    let warning_event = RuntimeAgentEvent::Warning {
        code: Some(CONTEXT_COMPACTION_NOT_NEEDED_WARNING_CODE.to_string()),
        message: message.to_string(),
    };
    if let Err(error) = app.emit(event_name, &warning_event) {
        tracing::warn!("[AsterAgent] 发送压缩跳过提醒失败: {}", error);
    }

    let done_event = RuntimeAgentEvent::FinalDone { usage: None };
    if let Err(error) = app.emit(event_name, &done_event) {
        tracing::warn!("[AsterAgent] 发送压缩跳过完成事件失败: {}", error);
    }
}

async fn should_auto_compact_runtime_session(
    provider: &dyn aster::providers::base::Provider,
    session: &aster::session::Session,
    workspace_settings: &WorkspaceSettings,
    threshold_override: Option<f64>,
) -> Result<bool, String> {
    if !workspace_settings.auto_compact {
        return Ok(false);
    }

    let Some(conversation) = session.conversation.as_ref() else {
        return Ok(false);
    };
    if session.message_count < 2 || conversation.messages().len() < 2 {
        return Ok(false);
    }

    aster::context_mgmt::check_if_compaction_needed(
        provider,
        conversation,
        threshold_override,
        session,
    )
    .await
    .map_err(|error| format!("检查自动压缩阈值失败: {error}"))
}

async fn maybe_auto_compact_runtime_session_before_turn(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    session_id: &str,
    request_event_name: &str,
    workspace_settings: &WorkspaceSettings,
) -> Result<(), String> {
    let session = read_session(session_id, true, "读取自动压缩会话失败").await?;
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;
    let provider = agent
        .provider()
        .await
        .map_err(|error| format!("读取自动压缩 provider 失败: {error}"))?;
    if !should_auto_compact_runtime_session(provider.as_ref(), &session, workspace_settings, None)
        .await?
    {
        return Ok(());
    }

    let auto_event_name = build_auto_context_compaction_event_name(session_id);
    if let Err(error) = compact_runtime_session_with_trigger(
        app,
        state,
        db,
        session_id.to_string(),
        auto_event_name,
        RuntimeSessionCompactionTrigger::Auto,
    )
    .await
    {
        tracing::warn!(
            "[AsterAgent] 自动压缩上下文失败，已降级继续当前 turn: session_id={}, error={}",
            session_id,
            error
        );
        let warning_event = RuntimeAgentEvent::Warning {
            code: Some(AUTO_CONTEXT_COMPACTION_FAILED_WARNING_CODE.to_string()),
            message: format!("自动压缩上下文失败，已继续当前请求：{error}"),
        };
        if let Err(emit_error) = app.emit(request_event_name, &warning_event) {
            tracing::warn!("[AsterAgent] 发送自动压缩失败提醒失败: {}", emit_error);
        }
    }

    Ok(())
}

async fn compact_runtime_session_with_trigger(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    session_id: String,
    event_name: String,
    trigger: RuntimeSessionCompactionTrigger,
) -> Result<(), String> {
    ensure_compaction_agent_initialized(state, db).await?;

    let session = read_session(&session_id, true, "读取会话失败").await?;
    let Some(conversation) = resolve_context_compaction_conversation(&session)? else {
        if trigger == RuntimeSessionCompactionTrigger::Manual {
            emit_context_compaction_skip(app, &event_name, "当前会话还没有足够的历史可压缩");
        }
        return Ok(());
    };

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
            trigger: trigger.as_str().to_string(),
            detail: Some(trigger.start_detail().to_string()),
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

        let provider = agent
            .provider()
            .await
            .map_err(|error| format!("读取 provider 失败: {error}"))?;
        let (compacted_conversation, usage) =
            aster::context_mgmt::compact_messages(provider.as_ref(), conversation, true)
                .await
                .map_err(|error| format!("压缩上下文失败: {error}"))?;
        replace_session_conversation(&session_id, &compacted_conversation, "写回压缩后的会话")
            .await?;
        update_compaction_session_metrics(&session_config, &usage).await?;

        let completed_event = RuntimeAgentEvent::ContextCompactionCompleted {
            item_id: compaction_item_id,
            trigger: trigger.as_str().to_string(),
            detail: Some(trigger.completed_detail().to_string()),
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

pub(crate) async fn compact_runtime_session_internal(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    request: AgentRuntimeCompactSessionRequest,
) -> Result<(), String> {
    let session_id = normalize_required_text(&request.session_id, "session_id")?;
    let event_name = normalize_required_text(&request.event_name, "event_name")?;
    compact_runtime_session_with_trigger(
        app,
        state,
        db,
        session_id,
        event_name,
        RuntimeSessionCompactionTrigger::Manual,
    )
    .await
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
    use aster::conversation::message::Message;
    use aster::model::ModelConfig;
    use aster::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
    use aster::providers::errors::ProviderError;
    use aster::session::{
        initialize_shared_session_runtime_with_root, is_global_session_store_set, SessionManager,
        SessionType,
    };
    use async_trait::async_trait;
    use lime_core::database::schema::create_tables;
    use lime_services::aster_session_store::LimeSessionStore;
    use rmcp::model::Tool;
    use rusqlite::Connection;
    use serde_json::{json, Value};
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

    #[derive(Clone)]
    struct AutoCompactThresholdTestProvider {
        context_limit: Option<usize>,
    }

    impl AutoCompactThresholdTestProvider {
        fn new(context_limit: Option<usize>) -> Self {
            Self { context_limit }
        }
    }

    #[async_trait]
    impl Provider for AutoCompactThresholdTestProvider {
        fn metadata() -> ProviderMetadata {
            ProviderMetadata::new(
                "auto-compact-threshold-test",
                "Auto Compact Threshold Test",
                "用于测试自动压缩阈值判断的 provider",
                "auto-compact-threshold-test-model",
                vec!["auto-compact-threshold-test-model"],
                "",
                vec![],
            )
        }

        fn get_name(&self) -> &str {
            "auto-compact-threshold-test"
        }

        async fn complete_with_model(
            &self,
            _model_config: &ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            Err(ProviderError::ExecutionError(
                "测试不应调用 complete_with_model".to_string(),
            ))
        }

        fn get_model_config(&self) -> ModelConfig {
            ModelConfig {
                model_name: "auto-compact-threshold-test-model".to_string(),
                context_limit: self.context_limit,
                temperature: None,
                max_tokens: None,
                toolshim: false,
                toolshim_model: None,
                fast_model: None,
            }
        }
    }

    fn build_auto_compaction_test_session(total_tokens: Option<i32>) -> aster::session::Session {
        let conversation = aster::conversation::Conversation::new_unvalidated(vec![
            Message::user().with_text("第一条用户消息"),
            Message::assistant().with_text("第一条助手回复"),
        ]);

        aster::session::Session {
            conversation: Some(conversation),
            message_count: 2,
            total_tokens,
            ..aster::session::Session::default()
        }
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_enable_artifact_prompt_before_turn_build() {
        let mut request = AsterChatRequest {
            message: "请基于目标先生成一版演示提纲".to_string(),
            session_id: "session-artifact".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-artifact".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench",
                    "content_id": "content-1"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        let raw_prompt = merge_system_prompt_with_artifact_context(
            Some("基础系统提示".to_string()),
            request.metadata.as_ref(),
        )
        .expect("raw prompt");
        assert!(!raw_prompt.contains("【Artifact 交付策略】"));

        normalize_runtime_turn_request_metadata(&mut request, None, None, None, None, None);

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/artifact/artifact_mode")
                .and_then(Value::as_str),
            Some("draft")
        );

        let prompt = merge_system_prompt_with_artifact_context(
            Some("基础系统提示".to_string()),
            Some(normalized_metadata),
        )
        .expect("normalized prompt");
        assert!(prompt.contains("【Artifact 交付策略】"));
        assert!(prompt.contains("【Artifact Stage 2 合同】"));
        assert!(prompt.contains("artifact:content-1"));

        let mut turn_input_builder =
            TurnInputEnvelopeBuilder::new(&request.session_id, &request.workspace_id);
        turn_input_builder
            .set_base_system_prompt(
                TurnSystemPromptSource::Frontend,
                Some("基础系统提示".to_string()),
            )
            .set_turn_context_metadata_from_value(request.metadata.as_ref())
            .set_effective_user_message(&request.message)
            .apply_prompt_stage(TurnPromptAugmentationStageKind::Artifact, Some(prompt));

        let envelope = turn_input_builder.build();
        let diagnostics = envelope.diagnostics_snapshot();
        let turn_context = envelope.turn_context_override().expect("turn context");

        assert!(diagnostics.has_turn_context_metadata);
        assert!(diagnostics
            .turn_context_metadata_keys
            .contains(&"artifact".to_string()));
        assert_eq!(
            turn_context
                .metadata
                .get("artifact")
                .and_then(|artifact| artifact.get("artifact_stage"))
                .and_then(Value::as_str),
            Some("stage2")
        );
    }

    #[test]
    fn service_skill_launch_stage_should_preserve_simple_user_message_and_force_site_run_first() {
        let user_message = "请帮我使用 GitHub 查一下 AI Agent 项目";
        let metadata = json!({
            "harness": {
                "browser_assist": {
                    "enabled": true,
                    "profile_key": "attached-github",
                },
                "service_skill_launch": {
                    "kind": "site_adapter",
                    "skill_title": "GitHub 仓库线索检索",
                    "adapter_name": "github/search",
                    "args": {
                        "query": "AI Agent",
                        "limit": 10
                    },
                    "save_mode": "current_content",
                    "content_id": "content-1",
                    "project_id": "project-1",
                    "launch_readiness": {
                        "status": "ready",
                        "message": "已检测到 github.com 的真实浏览器页面。",
                        "target_id": "tab-github"
                    }
                }
            }
        });

        let prompt_with_web_search =
            Some("基础系统提示\n- 如果需要可使用 WebSearch 补充信息。".to_string());
        let prompt_with_service_skill_launch = merge_system_prompt_with_service_skill_launch(
            prompt_with_web_search.clone(),
            Some(&metadata),
        )
        .expect("service skill prompt");

        let mut turn_input_builder =
            TurnInputEnvelopeBuilder::new("session-service-skill", "workspace-service-skill");
        turn_input_builder
            .set_base_system_prompt(
                TurnSystemPromptSource::Frontend,
                Some("基础系统提示".to_string()),
            )
            .set_turn_context_metadata_from_value(Some(&metadata))
            .set_effective_user_message(user_message)
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::WebSearch,
                prompt_with_web_search,
            )
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::ServiceSkillLaunch,
                Some(prompt_with_service_skill_launch.clone()),
            );

        let envelope = turn_input_builder.build();
        let diagnostics = envelope.diagnostics_snapshot();
        let final_prompt = envelope.system_prompt().expect("final prompt");
        let service_skill_stage = diagnostics
            .prompt_augmentation_stages
            .iter()
            .find(|stage| stage.stage == TurnPromptAugmentationStageKind::ServiceSkillLaunch)
            .expect("service skill stage");

        assert_eq!(
            diagnostics.effective_user_message_len,
            user_message.chars().count()
        );
        assert!(diagnostics.has_turn_context_metadata);
        assert!(diagnostics
            .turn_context_metadata_keys
            .contains(&"harness".to_string()));
        assert!(service_skill_stage.changed);
        assert!(final_prompt.contains(SERVICE_SKILL_LAUNCH_PROMPT_MARKER));
        assert!(final_prompt.contains("第一步优先调用 lime_site_run"));
        assert!(final_prompt.contains("不要先用 WebSearch、research、webReader"));
        assert!(final_prompt.contains("不要直接调用 mcp__lime-browser__browser_navigate"));
        assert!(final_prompt.contains("第一工具调用示例(lime_site_run 参数 JSON)"));
        assert!(final_prompt.contains("profile_key=attached-github"));
        assert!(final_prompt.contains("target_id=tab-github"));
        assert!(final_prompt.contains("\"adapter_name\":\"github/search\""));
        assert!(final_prompt.contains("attached_session_required、no_matching_context"));
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_backfill_content_id_from_session_runtime() {
        let mut request = AsterChatRequest {
            message: "继续完善当前文档".to_string(),
            session_id: "session-artifact-content-fallback".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-artifact".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        normalize_runtime_turn_request_metadata(
            &mut request,
            Some("general"),
            Some("general_workbench"),
            None,
            None,
            Some("content-from-session"),
        );

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/harness/theme")
                .and_then(Value::as_str),
            Some("general")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/session_mode")
                .and_then(Value::as_str),
            Some("general_workbench")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/content_id")
                .and_then(Value::as_str),
            Some("content-from-session")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/artifact/artifact_request_id")
                .and_then(Value::as_str),
            Some("artifact:content-from-session")
        );
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_backfill_theme_and_session_mode_from_session_runtime(
    ) {
        let mut request = AsterChatRequest {
            message: "继续推进当前工作区编排".to_string(),
            session_id: "session-artifact-theme-fallback".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-artifact".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "content_id": "content-from-session"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        normalize_runtime_turn_request_metadata(
            &mut request,
            Some("general"),
            Some("general_workbench"),
            None,
            None,
            Some("content-from-session"),
        );

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/harness/theme")
                .and_then(Value::as_str),
            Some("general")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/session_mode")
                .and_then(Value::as_str),
            Some("general_workbench")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/content_id")
                .and_then(Value::as_str),
            Some("content-from-session")
        );
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_backfill_gate_key_and_run_title_from_session_runtime(
    ) {
        let mut request = AsterChatRequest {
            message: "继续当前社媒运行".to_string(),
            session_id: "session-social-gate-fallback".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-general-fallback".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench",
                    "content_id": "content-social-1"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        normalize_runtime_turn_request_metadata(
            &mut request,
            Some("general"),
            Some("general_workbench"),
            Some("write_mode"),
            Some("社媒初稿"),
            Some("content-social-1"),
        );

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/harness/gate_key")
                .and_then(Value::as_str),
            Some("write_mode")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/run_title")
                .and_then(Value::as_str),
            Some("社媒初稿")
        );
    }

    #[test]
    fn backfill_runtime_access_policies_should_derive_from_legacy_harness_access_mode() {
        let mut request = AsterChatRequest {
            message: "继续执行".to_string(),
            session_id: "session-access-legacy".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-access".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "access_mode": "full-access"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        backfill_runtime_access_policies(&mut request);

        assert_eq!(request.approval_policy.as_deref(), Some("never"));
        assert_eq!(
            request.sandbox_policy.as_deref(),
            Some("danger-full-access")
        );
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

    #[tokio::test]
    async fn should_auto_compact_runtime_session_when_workspace_pref_enabled_and_context_threshold_exceeded(
    ) {
        let provider = AutoCompactThresholdTestProvider::new(Some(1_000));
        let session = build_auto_compaction_test_session(Some(900));

        assert!(should_auto_compact_runtime_session(
            &provider,
            &session,
            &WorkspaceSettings::default(),
            Some(0.8),
        )
        .await
        .expect("检查自动压缩阈值失败"));
    }

    #[tokio::test]
    async fn should_not_auto_compact_runtime_session_when_workspace_pref_disabled() {
        let provider = AutoCompactThresholdTestProvider::new(Some(1_000));
        let session = build_auto_compaction_test_session(Some(900));
        let workspace_settings = WorkspaceSettings {
            auto_compact: false,
            ..WorkspaceSettings::default()
        };

        assert!(!should_auto_compact_runtime_session(
            &provider,
            &session,
            &workspace_settings,
            Some(0.8),
        )
        .await
        .expect("检查自动压缩阈值失败"));
    }

    #[tokio::test]
    async fn should_not_auto_compact_runtime_session_when_context_threshold_not_exceeded() {
        let provider = AutoCompactThresholdTestProvider::new(Some(1_000));
        let session = build_auto_compaction_test_session(Some(700));

        assert!(!should_auto_compact_runtime_session(
            &provider,
            &session,
            &WorkspaceSettings::default(),
            Some(0.8),
        )
        .await
        .expect("检查自动压缩阈值失败"));
    }

    #[test]
    fn should_inject_turn_context_metadata_when_workspace_auto_compaction_disabled() {
        let merged = merge_turn_context_with_workspace_auto_compaction(
            Some(TurnContextOverride::default()),
            &WorkspaceSettings {
                auto_compact: false,
                ..WorkspaceSettings::default()
            },
        )
        .expect("应返回 turn context");

        assert_eq!(
            merged
                .metadata
                .get(LIME_RUNTIME_METADATA_KEY)
                .and_then(|value| value.get(LIME_RUNTIME_AUTO_COMPACT_KEY))
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn should_keep_turn_context_unchanged_when_workspace_auto_compaction_enabled() {
        assert!(merge_turn_context_with_workspace_auto_compaction(
            None,
            &WorkspaceSettings::default()
        )
        .is_none());
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
            .record_artifact_path("content-posts/demo.md".to_string(), None);

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
            "<write_file path=\"content-posts/demo.md\">内容</write_file>"
        ));
    }
}
