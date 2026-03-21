use super::*;

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
    delete_runtime_session_internal(db.inner(), &trimmed_session_id).await
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

pub(crate) fn build_action_resume_runtime_status() -> TauriRuntimeStatus {
    TauriRuntimeStatus {
        phase: "routing".to_string(),
        title: "已提交补充信息，继续执行中".to_string(),
        detail: "补充信息已回填到当前执行链路，正在恢复后续步骤。".to_string(),
        checkpoints: vec![
            "补充信息已确认".to_string(),
            "已唤醒当前执行链路".to_string(),
            "等待下一条执行事件".to_string(),
        ],
    }
}

fn emit_action_resume_runtime_status(app: &AppHandle, event_name: &str) {
    if event_name.trim().is_empty() {
        return;
    }

    let event = TauriAgentEvent::RuntimeStatus {
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

/// 统一运行时：响应工具确认 / ask / elicitation。
#[tauri::command]
pub async fn agent_runtime_respond_action(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    request: AgentRuntimeRespondActionRequest,
) -> Result<(), String> {
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
            let resume_event_name = normalize_optional_text(request.event_name.clone());
            submit_runtime_elicitation_response_internal(
                state.inner(),
                request.session_id.clone(),
                SubmitElicitationResponseRequest {
                    request_id: request.request_id.clone(),
                    user_data,
                    metadata: request.metadata.clone(),
                },
            )
            .await
            .map(|_| {
                if let Some(event_name) = resume_event_name.as_deref() {
                    emit_action_resume_runtime_status(&app, event_name);
                }
            })
        }
    }
}

async fn submit_runtime_elicitation_response_internal(
    state: &AsterAgentState,
    session_id: String,
    request: SubmitElicitationResponseRequest,
) -> Result<(), String> {
    let session_id = validate_elicitation_submission(&session_id, &request.request_id)?;

    tracing::info!(
        "[AsterAgent] 提交 elicitation 响应: session={}, request_id={}",
        session_id,
        request.request_id
    );

    let message =
        Message::user().with_content(MessageContent::action_required_elicitation_response(
            request.request_id.clone(),
            request.user_data,
        ));

    let mut session_config_builder =
        SessionConfigBuilder::new(&session_id).include_context_trace(true);
    if let Some(prompt) =
        merge_system_prompt_with_elicitation_context(None, request.metadata.as_ref())
    {
        session_config_builder = session_config_builder.system_prompt(prompt);
    }
    let session_config = session_config_builder.build();

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
