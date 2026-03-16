use super::{args_or_default, get_db};
use crate::database::dao::agent::AgentDao;
use crate::dev_bridge::DevBridgeState;
use proxycast_core::agent::types::AgentSession;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

fn get_session_id(args: &JsonValue) -> String {
    args["session_id"]
        .as_str()
        .or_else(|| args["sessionId"].as_str())
        .unwrap_or("")
        .to_string()
}

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "agent_create_session" => {
            let args = args_or_default(args);
            let provider_type = args["provider_type"].as_str().unwrap_or("").to_string();
            let model = args["model"].as_str().map(|value| value.to_string());
            let system_prompt = args["system_prompt"]
                .as_str()
                .map(|value| value.to_string());
            let execution_strategy = args["execution_strategy"]
                .as_str()
                .map(|value| value.to_string())
                .or_else(|| {
                    args["executionStrategy"]
                        .as_str()
                        .map(|value| value.to_string())
                })
                .unwrap_or_else(|| "react".to_string());

            let db = get_db(state)?;
            let session_id = uuid::Uuid::new_v4().to_string();
            let model_name = model
                .clone()
                .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
            let now = chrono::Utc::now().to_rfc3339();
            let session = AgentSession {
                id: session_id.clone(),
                model: model_name.clone(),
                messages: Vec::new(),
                system_prompt,
                title: None,
                working_dir: None,
                execution_strategy: Some(execution_strategy.clone()),
                created_at: now.clone(),
                updated_at: now,
            };

            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            AgentDao::create_session(&conn, &session).map_err(|e| format!("创建会话失败: {e}"))?;

            serde_json::json!({
                "session_id": session_id,
                "credential_name": "ProxyCast",
                "credential_uuid": null,
                "provider_type": provider_type,
                "model": model_name,
                "execution_strategy": execution_strategy
            })
        }
        "agent_list_sessions" => {
            let db = get_db(state)?;
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            let sessions =
                AgentDao::list_sessions(&conn).map_err(|e| format!("获取会话列表失败: {e}"))?;

            let result: Vec<JsonValue> = sessions
                .into_iter()
                .map(|session| {
                    let messages_count =
                        AgentDao::get_message_count(&conn, &session.id).unwrap_or(0);
                    serde_json::json!({
                        "session_id": session.id,
                        "provider_type": "aster",
                        "model": session.model,
                        "created_at": session.created_at,
                        "last_activity": session.updated_at,
                        "messages_count": messages_count
                    })
                })
                .collect();

            serde_json::json!(result)
        }
        "agent_get_session" => {
            let args = args_or_default(args);
            let session_id = get_session_id(&args);
            let db = get_db(state)?;
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            let session = AgentDao::get_session(&conn, &session_id)
                .map_err(|e| format!("获取会话失败: {e}"))?
                .ok_or("会话不存在")?;
            let messages_count = AgentDao::get_message_count(&conn, &session_id).unwrap_or(0);

            serde_json::json!({
                "session_id": session.id,
                "provider_type": "aster",
                "model": session.model,
                "created_at": session.created_at,
                "last_activity": session.updated_at,
                "messages_count": messages_count
            })
        }
        "agent_delete_session" => {
            let args = args_or_default(args);
            let session_id = get_session_id(&args);
            let db = get_db(state)?;
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            AgentDao::delete_session(&conn, &session_id)
                .map_err(|e| format!("删除会话失败: {e}"))?;
            serde_json::json!({ "success": true })
        }
        "agent_get_session_messages" => {
            let args = args_or_default(args);
            let session_id = get_session_id(&args);
            let db = get_db(state)?;
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            serde_json::to_value(
                AgentDao::get_messages(&conn, &session_id)
                    .map_err(|e| format!("获取消息失败: {e}"))?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
