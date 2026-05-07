use super::session_runtime::delete_runtime_session_internal_with_runtime;
use super::*;
use lime_agent::AgentEvent as RuntimeAgentEvent;
use lime_core::workspace::WorkspaceSettings;
use tauri::Manager;

/// 统一运行时：删除会话。
#[tauri::command]
pub async fn agent_runtime_delete_session(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<(), String> {
    let trimmed_session_id = session_id.trim().to_string();
    let _ = state.cancel_session(&trimmed_session_id).await;
    let _ = clear_runtime_queue_service(&app, &trimmed_session_id).await;
    delete_runtime_session_internal_with_runtime(
        db.inner(),
        state.inner(),
        app.state::<crate::mcp::McpManagerState>().inner(),
        &trimmed_session_id,
    )
    .await
}

/// 确认权限请求
#[derive(Debug, Deserialize)]
struct ConfirmRequest {
    request_id: String,
    confirmed: bool,
    #[allow(dead_code)]
    response: Option<String>,
}

async fn confirm_runtime_action_internal(
    state: &AsterAgentState,
    request: ConfirmRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 确认请求: id={}, confirmed={}",
        request.request_id,
        request.confirmed
    );

    let permission = if request.confirmed {
        Permission::AllowOnce
    } else {
        Permission::DenyOnce
    };

    let confirmation = PermissionConfirmation {
        principal_type: PrincipalType::Tool,
        permission,
    };

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;
    agent
        .handle_confirmation(request.request_id.clone(), confirmation)
        .await;

    Ok(())
}

/// Elicitation 回填请求
#[derive(Debug, Deserialize)]
struct SubmitElicitationResponseRequest {
    request_id: String,
    user_data: serde_json::Value,
    #[serde(default)]
    metadata: Option<serde_json::Value>,
    #[serde(default)]
    action_scope: Option<ActionRequiredScope>,
}

pub(crate) fn validate_elicitation_submission(
    session_id: &str,
    request_id: &str,
) -> Result<String, String> {
    let trimmed_session_id = session_id.trim().to_string();
    if trimmed_session_id.is_empty() {
        return Err("session_id 不能为空".to_string());
    }
    if request_id.trim().is_empty() {
        return Err("request_id 不能为空".to_string());
    }
    Ok(trimmed_session_id)
}

pub(crate) fn build_action_resume_runtime_status() -> AgentRuntimeStatus {
    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "已提交补充信息，继续执行中".to_string(),
        detail: "补充信息已回填到当前执行链路，正在恢复后续步骤。".to_string(),
        checkpoints: vec![
            "补充信息已确认".to_string(),
            "已唤醒当前执行链路".to_string(),
            "等待下一条执行事件".to_string(),
        ],
        metadata: None,
    }
}

fn emit_action_resume_runtime_status(app: &AppHandle, event_name: &str) {
    if event_name.trim().is_empty() {
        return;
    }

    let event = RuntimeAgentEvent::RuntimeStatus {
        status: build_action_resume_runtime_status(),
    };
    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!(
            "[AsterAgent] 发送 action resume runtime_status 失败: event_name={}, error={}",
            event_name,
            error
        );
    }
}

fn build_permission_confirmation_response(
    request: &AgentRuntimeRespondActionRequest,
) -> serde_json::Value {
    serde_json::json!({
        "confirmed": request.confirmed,
        "response": request.response,
        "userData": request.user_data,
        "source": "runtime_permission_confirmation",
    })
}

fn build_user_lock_capability_response(
    request: &AgentRuntimeRespondActionRequest,
) -> serde_json::Value {
    serde_json::json!({
        "confirmed": request.confirmed,
        "response": request.response,
        "userData": request.user_data,
        "source": "runtime_user_lock_capability_confirmation",
    })
}

fn complete_runtime_request_user_input_item(
    app: &AppHandle,
    event_name: Option<&str>,
    db: &DbConnection,
    request_id: &str,
    response: serde_json::Value,
    request_kind_label: &str,
    validate_request_id: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let mut item = {
        let conn = lime_core::database::lock_db(db)?;
        lime_core::database::dao::agent_timeline::AgentTimelineDao::get_item(&conn, request_id)
            .map_err(|error| format!("读取{request_kind_label}失败: {error}"))?
            .ok_or_else(|| format!("{request_kind_label}不存在: {request_id}"))?
    };

    let lime_core::database::dao::agent_timeline::AgentThreadItemPayload::RequestUserInput {
        request_id,
        action_type,
        prompt,
        questions,
        ..
    } = item.payload
    else {
        return Err(format!(
            "{request_kind_label}不是 RequestUserInput，拒绝写回"
        ));
    };

    validate_request_id(&request_id)?;

    let now = chrono::Utc::now().to_rfc3339();
    item.status = lime_core::database::dao::agent_timeline::AgentThreadItemStatus::Completed;
    item.completed_at = Some(now.clone());
    item.updated_at = now;
    item.payload =
        lime_core::database::dao::agent_timeline::AgentThreadItemPayload::RequestUserInput {
            request_id,
            action_type,
            prompt,
            questions,
            response: Some(response),
        };

    {
        let conn = lime_core::database::lock_db(db)?;
        lime_core::database::dao::agent_timeline::AgentTimelineDao::upsert_item(&conn, &item)
            .map_err(|error| format!("写回{request_kind_label}失败: {error}"))?;
    }

    if let Some(event_name) = event_name.filter(|value| !value.trim().is_empty()) {
        if let Err(error) = app.emit(
            event_name,
            &RuntimeAgentEvent::ItemCompleted { item: item.clone() },
        ) {
            tracing::warn!(
                "[AsterAgent] 发送{}完成事件失败: event_name={}, error={}",
                request_kind_label,
                event_name,
                error
            );
        }
        emit_action_resume_runtime_status(app, event_name);
    }

    Ok(())
}

fn complete_runtime_permission_confirmation_request(
    app: &AppHandle,
    event_name: Option<&str>,
    db: &DbConnection,
    request: &AgentRuntimeRespondActionRequest,
) -> Result<(), String> {
    complete_runtime_request_user_input_item(
        app,
        event_name,
        db,
        &request.request_id,
        build_permission_confirmation_response(request),
        "权限确认请求",
        |request_id| {
            if is_runtime_permission_confirmation_request_id(request_id) {
                Ok(())
            } else {
                Err("请求 ID 不是运行时权限确认请求，拒绝写回".to_string())
            }
        },
    )
}

fn complete_runtime_user_lock_capability_request(
    app: &AppHandle,
    event_name: Option<&str>,
    db: &DbConnection,
    request: &AgentRuntimeRespondActionRequest,
) -> Result<(), String> {
    complete_runtime_request_user_input_item(
        app,
        event_name,
        db,
        &request.request_id,
        build_user_lock_capability_response(request),
        "模型锁定能力确认请求",
        |request_id| {
            if is_runtime_user_lock_capability_request_id(request_id) {
                Ok(())
            } else {
                Err("请求 ID 不是运行时模型锁定能力确认请求，拒绝写回".to_string())
            }
        },
    )
}

fn complete_runtime_ask_or_elicitation_request(
    app: &AppHandle,
    event_name: Option<&str>,
    db: &DbConnection,
    request: &AgentRuntimeRespondActionRequest,
    submitted_user_data: serde_json::Value,
) -> Result<(), String> {
    complete_runtime_request_user_input_item(
        app,
        event_name,
        db,
        &request.request_id,
        serde_json::json!({
            "confirmed": request.confirmed,
            "response": request.response,
            "userData": submitted_user_data,
            "metadata": request.metadata,
            "source": "runtime_request_user_input",
        }),
        "补充信息请求",
        |_| Ok(()),
    )
}

async fn load_runtime_workspace_settings_or_default(
    db: &DbConnection,
    session_id: &str,
) -> WorkspaceSettings {
    let detail = match AsterAgentWrapper::get_runtime_session_detail(db, session_id).await {
        Ok(detail) => detail,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 读取 elicitation 所属 workspace 失败，已降级使用默认设置: session_id={}, error={}",
                session_id,
                error
            );
            return WorkspaceSettings::default();
        }
    };

    let Some(workspace_id) = detail
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return WorkspaceSettings::default();
    };

    let manager = WorkspaceManager::new(db.clone());
    let workspace_id = workspace_id.to_string();
    match manager.get(&workspace_id) {
        Ok(Some(workspace)) => workspace.settings,
        Ok(None) => {
            tracing::warn!(
                "[AsterAgent] elicitation 所属 workspace 不存在，已降级使用默认设置: session_id={}, workspace_id={}",
                session_id,
                workspace_id
            );
            WorkspaceSettings::default()
        }
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 读取 elicitation 所属 workspace 设置失败，已降级使用默认设置: session_id={}, workspace_id={}, error={}",
                session_id,
                workspace_id,
                error
            );
            WorkspaceSettings::default()
        }
    }
}

pub(crate) fn build_runtime_action_session_config(
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
    workspace_settings: &WorkspaceSettings,
) -> aster::agents::SessionConfig {
    let mut session_config_builder =
        SessionConfigBuilder::new(session_id).include_context_trace(true);
    if let Some(prompt) = merge_system_prompt_with_elicitation_context(None, request_metadata) {
        session_config_builder = session_config_builder.system_prompt(prompt);
    }
    let turn_context = super::runtime_turn::build_runtime_turn_context_snapshot(
        request_metadata,
        workspace_settings,
    );
    if turn_context.output_schema.is_some() || !turn_context.metadata.is_empty() {
        session_config_builder = session_config_builder.turn_context(turn_context);
    }
    session_config_builder.build()
}

pub(crate) fn build_runtime_action_user_data(
    request: &AgentRuntimeRespondActionRequest,
) -> serde_json::Value {
    if let Some(user_data) = request.user_data.clone() {
        return user_data;
    }

    if !request.confirmed {
        return serde_json::Value::String(String::new());
    }

    let Some(response) = request.response.as_ref() else {
        return serde_json::Value::String(String::new());
    };
    let trimmed = response.trim();
    if trimmed.is_empty() {
        return serde_json::Value::String(String::new());
    }

    serde_json::from_str(trimmed).unwrap_or_else(|_| serde_json::Value::String(trimmed.to_string()))
}

pub(crate) fn build_runtime_action_scope(
    request: &AgentRuntimeRespondActionRequest,
) -> Option<ActionRequiredScope> {
    let Some(scope) = request.action_scope.as_ref() else {
        return None;
    };

    let session_id = normalize_optional_text(scope.session_id.clone());
    let thread_id = normalize_optional_text(scope.thread_id.clone());
    let turn_id = normalize_optional_text(scope.turn_id.clone());

    if session_id.is_none() && thread_id.is_none() && turn_id.is_none() {
        return None;
    }

    Some(ActionRequiredScope {
        session_id,
        thread_id,
        turn_id,
    })
}

/// 统一运行时：响应工具确认 / ask / elicitation。
#[tauri::command]
pub async fn agent_runtime_respond_action(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: AgentRuntimeRespondActionRequest,
) -> Result<(), String> {
    if is_runtime_permission_confirmation_request_id(&request.request_id) {
        return complete_runtime_permission_confirmation_request(
            &app,
            normalize_optional_text(request.event_name.clone()).as_deref(),
            db.inner(),
            &request,
        );
    }
    if is_runtime_user_lock_capability_request_id(&request.request_id) {
        return complete_runtime_user_lock_capability_request(
            &app,
            normalize_optional_text(request.event_name.clone()).as_deref(),
            db.inner(),
            &request,
        );
    }

    match request.action_type {
        AgentRuntimeActionType::ToolConfirmation => {
            confirm_runtime_action_internal(
                state.inner(),
                ConfirmRequest {
                    request_id: request.request_id.clone(),
                    confirmed: request.confirmed,
                    response: request.response.clone(),
                },
            )
            .await
        }
        AgentRuntimeActionType::AskUser | AgentRuntimeActionType::Elicitation => {
            let user_data = build_runtime_action_user_data(&request);
            let action_scope = build_runtime_action_scope(&request);
            let resume_event_name = normalize_optional_text(request.event_name.clone());
            let submitted_user_data = user_data.clone();
            submit_runtime_elicitation_response_internal(
                state.inner(),
                db.inner(),
                request.session_id.clone(),
                SubmitElicitationResponseRequest {
                    request_id: request.request_id.clone(),
                    user_data,
                    metadata: request.metadata.clone(),
                    action_scope,
                },
            )
            .await?;

            complete_runtime_ask_or_elicitation_request(
                &app,
                resume_event_name.as_deref(),
                db.inner(),
                &request,
                submitted_user_data,
            )
        }
    }
}

async fn submit_runtime_elicitation_response_internal(
    state: &AsterAgentState,
    db: &DbConnection,
    session_id: String,
    request: SubmitElicitationResponseRequest,
) -> Result<(), String> {
    let session_id = validate_elicitation_submission(&session_id, &request.request_id)?;

    tracing::info!(
        "[AsterAgent] 提交 elicitation 响应: session={}, request_id={}, action_scope={}",
        session_id,
        request.request_id,
        serde_json::to_string(&request.action_scope).unwrap_or_else(|_| "null".to_string())
    );

    let message = Message::user().with_content(MessageContent::ActionRequired(ActionRequired {
        data: ActionRequiredData::ElicitationResponse {
            id: request.request_id.clone(),
            user_data: request.user_data,
        },
        scope: request.action_scope,
    }));

    let workspace_settings = load_runtime_workspace_settings_or_default(db, &session_id).await;
    let session_config = build_runtime_action_session_config(
        &session_id,
        request.metadata.as_ref(),
        &workspace_settings,
    );

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;

    let mut stream = agent
        .reply(message, session_config, None)
        .await
        .map_err(|e| format!("提交 elicitation 响应失败: {e}"))?;

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(AgentEvent::Message(message)) => {
                let text = message.as_concat_text();
                if text.contains("Failed to submit elicitation response")
                    || text.contains("Request not found")
                {
                    return Err(format!("提交 elicitation 响应失败: {text}"));
                }
            }
            Ok(_) => {}
            Err(e) => {
                return Err(format!("提交 elicitation 响应失败: {e}"));
            }
        }
    }

    Ok(())
}
