//! Agent 会话存储服务
//!
//! 提供会话创建、列表查询、详情查询能力。
//! 数据来源为 ProxyCast 数据库（AgentDao）。

use chrono::Utc;
use proxycast_core::agent::types::{AgentMessage, AgentSession, ContentPart, MessageContent};
use proxycast_core::database::dao::agent::AgentDao;
use proxycast_core::database::DbConnection;
use proxycast_core::workspace::WorkspaceManager;
use uuid::Uuid;

use crate::event_converter::{TauriMessage, TauriMessageContent};
use crate::tool_io_offload::{
    build_history_tool_io_eviction_plan_for_model, force_offload_plain_tool_output_for_history,
    force_offload_tool_arguments_for_history, maybe_offload_plain_tool_output,
    maybe_offload_tool_arguments,
};

/// 会话信息（简化版）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages_count: usize,
    pub execution_strategy: Option<String>,
}

/// 会话详情（包含消息）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionDetail {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<TauriMessage>,
    pub execution_strategy: Option<String>,
}

/// 解析会话 working_dir（优先入参，其次 workspace_id）
fn resolve_session_working_dir(
    db: &DbConnection,
    working_dir: Option<String>,
    workspace_id: String,
) -> Result<Option<String>, String> {
    if let Some(path) = working_dir {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let manager = WorkspaceManager::new(db.clone());
    if let Some(workspace) = manager.get(&workspace_id)? {
        return Ok(Some(workspace.root_path.to_string_lossy().to_string()));
    }

    Err(format!("Workspace 不存在: {}", workspace_id))
}

fn normalize_execution_strategy(execution_strategy: Option<String>) -> String {
    match execution_strategy.as_deref() {
        Some("code_orchestrated") => "code_orchestrated".to_string(),
        Some("auto") => "auto".to_string(),
        _ => "react".to_string(),
    }
}

/// 创建新会话
pub fn create_session_sync(
    db: &DbConnection,
    name: Option<String>,
    working_dir: Option<String>,
    workspace_id: String,
    execution_strategy: Option<String>,
) -> Result<String, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let session_name = name.unwrap_or_else(|| "新对话".to_string());
    let session_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    drop(conn);

    let resolved_working_dir = resolve_session_working_dir(db, working_dir, workspace_id)?;
    let normalized_execution_strategy = normalize_execution_strategy(execution_strategy);

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let session = AgentSession {
        id: session_id.clone(),
        model: "agent:default".to_string(),
        messages: Vec::new(),
        system_prompt: None,
        title: Some(session_name),
        working_dir: resolved_working_dir,
        execution_strategy: Some(normalized_execution_strategy),
        created_at: now.clone(),
        updated_at: now,
    };

    AgentDao::create_session(&conn, &session).map_err(|e| format!("创建会话失败: {e}"))?;

    Ok(session_id)
}

/// 列出所有会话
pub fn list_sessions_sync(db: &DbConnection) -> Result<Vec<SessionInfo>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let sessions = AgentDao::list_sessions(&conn).map_err(|e| format!("获取会话列表失败: {e}"))?;

    Ok(sessions
        .into_iter()
        .map(|session| {
            let messages_count = AgentDao::get_message_count(&conn, &session.id).unwrap_or(0);
            SessionInfo {
                id: session.id,
                name: session.title.unwrap_or_else(|| "未命名".to_string()),
                created_at: chrono::DateTime::parse_from_rfc3339(&session.created_at)
                    .map(|dt| dt.timestamp())
                    .unwrap_or(0),
                updated_at: chrono::DateTime::parse_from_rfc3339(&session.updated_at)
                    .map(|dt| dt.timestamp())
                    .unwrap_or(0),
                messages_count,
                execution_strategy: session.execution_strategy,
            }
        })
        .collect())
}

/// 获取会话详情
pub fn get_session_sync(db: &DbConnection, session_id: &str) -> Result<SessionDetail, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let session = AgentDao::get_session(&conn, session_id)
        .map_err(|e| format!("获取会话失败: {e}"))?
        .ok_or_else(|| format!("会话不存在: {session_id}"))?;

    let messages =
        AgentDao::get_messages(&conn, session_id).map_err(|e| format!("获取消息失败: {e}"))?;

    let tauri_messages = convert_agent_messages(&messages, Some(session.model.as_str()));

    tracing::debug!(
        "[SessionStore] 会话消息转换完成: session_id={}, messages_count={}",
        session_id,
        tauri_messages.len()
    );

    Ok(SessionDetail {
        id: session.id,
        name: session.title.unwrap_or_else(|| "未命名".to_string()),
        created_at: chrono::DateTime::parse_from_rfc3339(&session.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        updated_at: chrono::DateTime::parse_from_rfc3339(&session.updated_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        messages: tauri_messages,
        execution_strategy: session.execution_strategy,
    })
}

/// 重命名会话
pub fn rename_session_sync(db: &DbConnection, session_id: &str, name: &str) -> Result<(), String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("会话名称不能为空".to_string());
    }

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    AgentDao::update_title(&conn, session_id, trimmed_name)
        .map_err(|e| format!("更新会话标题失败: {e}"))?;

    let now = Utc::now().to_rfc3339();
    AgentDao::update_session_time(&conn, session_id, &now)
        .map_err(|e| format!("更新会话时间失败: {e}"))?;

    Ok(())
}

/// 删除会话
pub fn delete_session_sync(db: &DbConnection, session_id: &str) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    AgentDao::delete_session(&conn, session_id).map_err(|e| format!("删除会话失败: {e}"))?;
    Ok(())
}

fn parse_tool_call_arguments(arguments: &str) -> serde_json::Value {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return serde_json::json!({});
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .unwrap_or_else(|_| serde_json::json!({ "raw": arguments }))
}

fn parse_data_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    let payload = trimmed.strip_prefix("data:")?;
    let (meta, data) = payload.split_once(',')?;
    if data.trim().is_empty() {
        return None;
    }

    let mut segments = meta.split(';');
    let mime_type = segments.next().unwrap_or_default().trim();
    let has_base64 = segments.any(|segment| segment.eq_ignore_ascii_case("base64"));

    if !has_base64 {
        return None;
    }

    let normalized_mime = if mime_type.is_empty() {
        "application/octet-stream".to_string()
    } else {
        mime_type.to_string()
    };

    Some((normalized_mime, data.trim().to_string()))
}

fn convert_image_part(image_url: &str) -> Option<TauriMessageContent> {
    let normalized = image_url.trim();
    if normalized.is_empty() {
        return None;
    }

    if let Some((mime_type, data)) = parse_data_url(normalized) {
        return Some(TauriMessageContent::Image { mime_type, data });
    }

    if normalized.starts_with("data:") {
        return Some(TauriMessageContent::Text {
            text: "[图片消息]".to_string(),
        });
    }

    Some(TauriMessageContent::Text {
        text: format!("![image]({normalized})"),
    })
}

/// 将 AgentMessage 转换为 TauriMessage
fn convert_agent_messages(
    messages: &[AgentMessage],
    model_name: Option<&str>,
) -> Vec<TauriMessage> {
    let eviction_plan = build_history_tool_io_eviction_plan_for_model(messages, model_name);
    messages
        .iter()
        .map(|message| convert_agent_message(message, &eviction_plan))
        .collect()
}

fn convert_agent_message(
    message: &AgentMessage,
    eviction_plan: &crate::tool_io_offload::HistoryToolIoEvictionPlan,
) -> TauriMessage {
    let mut content = match &message.content {
        MessageContent::Text(text) => {
            if text.trim().is_empty() {
                Vec::new()
            } else {
                vec![TauriMessageContent::Text { text: text.clone() }]
            }
        }
        MessageContent::Parts(parts) => parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text { text } => {
                    if text.trim().is_empty() {
                        None
                    } else {
                        Some(TauriMessageContent::Text { text: text.clone() })
                    }
                }
                ContentPart::ImageUrl { image_url } => convert_image_part(&image_url.url),
            })
            .collect(),
    };

    // 添加 reasoning_content 作为 thinking 类型
    if let Some(reasoning) = &message.reasoning_content {
        content.insert(
            0,
            TauriMessageContent::Thinking {
                text: reasoning.clone(),
            },
        );
    }

    if let Some(tool_calls) = &message.tool_calls {
        for call in tool_calls {
            let parsed_arguments = parse_tool_call_arguments(&call.function.arguments);
            let arguments = if eviction_plan.request_ids.contains(&call.id) {
                force_offload_tool_arguments_for_history(&call.id, &parsed_arguments)
            } else {
                maybe_offload_tool_arguments(&call.id, &parsed_arguments)
            };
            content.push(TauriMessageContent::ToolRequest {
                id: call.id.clone(),
                tool_name: call.function.name.clone(),
                arguments,
            });
        }
    }

    if let Some(tool_call_id) = &message.tool_call_id {
        let tool_output = message.content.as_text();
        let offloaded = if eviction_plan.response_ids.contains(tool_call_id) {
            force_offload_plain_tool_output_for_history(tool_call_id, &tool_output, None)
        } else {
            maybe_offload_plain_tool_output(tool_call_id, &tool_output, None)
        };

        // tool/user 的工具结果协议消息都不应作为普通文本重复渲染。
        if message.role.eq_ignore_ascii_case("tool") || message.role.eq_ignore_ascii_case("user") {
            content.retain(|part| !matches!(part, TauriMessageContent::Text { .. }));
        }

        content.push(TauriMessageContent::ToolResponse {
            id: tool_call_id.clone(),
            success: true,
            output: offloaded.output,
            error: None,
            images: None,
            metadata: if offloaded.metadata.is_empty() {
                None
            } else {
                Some(offloaded.metadata)
            },
        });
    }

    let timestamp = chrono::DateTime::parse_from_rfc3339(&message.timestamp)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);

    let result = TauriMessage {
        id: None,
        role: message.role.clone(),
        content,
        timestamp,
    };

    // 调试日志
    tracing::debug!(
        "[SessionStore] 转换消息: role={}, content_items={}",
        result.role,
        result.content.len()
    );

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::agent::types::{FunctionCall, ImageUrl, ToolCall};
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        values: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvGuard {
        fn set(entries: &[(&'static str, OsString)]) -> Self {
            let mut values = Vec::new();
            for (key, value) in entries {
                values.push((*key, std::env::var_os(key)));
                std::env::set_var(key, value);
            }
            Self { values }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, previous) in self.values.drain(..) {
                if let Some(value) = previous {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    #[test]
    fn parse_tool_call_arguments_should_parse_json_or_keep_raw() {
        let parsed = parse_tool_call_arguments(r#"{"path":"./a.txt"}"#);
        assert_eq!(parsed["path"], serde_json::json!("./a.txt"));

        let fallback = parse_tool_call_arguments("not-json");
        assert_eq!(fallback["raw"], serde_json::json!("not-json"));
    }

    #[test]
    fn convert_agent_message_should_preserve_tool_request_and_response() {
        let assistant = AgentMessage {
            role: "assistant".to_string(),
            content: MessageContent::Text("".to_string()),
            timestamp: "2026-02-19T13:00:00Z".to_string(),
            tool_calls: Some(vec![ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "Write".to_string(),
                    arguments: r#"{"path":"./a.txt"}"#.to_string(),
                },
            }]),
            tool_call_id: None,
            reasoning_content: None,
        };

        let assistant_converted = convert_agent_message(
            &assistant,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(assistant_converted.content.iter().any(|part| {
            matches!(
                part,
                TauriMessageContent::ToolRequest { id, tool_name, .. }
                    if id == "call-1" && tool_name == "Write"
            )
        }));

        let tool = AgentMessage {
            role: "tool".to_string(),
            content: MessageContent::Text("写入成功".to_string()),
            timestamp: "2026-02-19T13:00:01Z".to_string(),
            tool_calls: None,
            tool_call_id: Some("call-1".to_string()),
            reasoning_content: None,
        };

        let tool_converted = convert_agent_message(
            &tool,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(!tool_converted
            .content
            .iter()
            .any(|part| matches!(part, TauriMessageContent::Text { .. })));
        assert!(tool_converted.content.iter().any(|part| {
            matches!(
                part,
                TauriMessageContent::ToolResponse { id, output, .. }
                    if id == "call-1" && output == "写入成功"
            )
        }));
    }

    #[test]
    fn convert_agent_message_should_keep_image_parts_for_history() {
        let user_with_image = AgentMessage {
            role: "user".to_string(),
            content: MessageContent::Parts(vec![
                ContentPart::Text {
                    text: "参考图".to_string(),
                },
                ContentPart::ImageUrl {
                    image_url: ImageUrl {
                        url: "data:image/png;base64,aGVsbG8=".to_string(),
                        detail: None,
                    },
                },
            ]),
            timestamp: "2026-02-19T13:00:02Z".to_string(),
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
        };

        let converted = convert_agent_message(
            &user_with_image,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(converted.content.iter().any(|part| {
            matches!(
                part,
                TauriMessageContent::Image { mime_type, data }
                    if mime_type == "image/png" && data == "aGVsbG8="
            )
        }));
        assert!(converted
            .content
            .iter()
            .any(|part| matches!(part, TauriMessageContent::Text { text } if text == "参考图")));
    }

    #[test]
    fn convert_agent_message_should_not_render_user_tool_response_as_plain_text() {
        let user_tool_response = AgentMessage {
            role: "user".to_string(),
            content: MessageContent::Text("任务已完成".to_string()),
            timestamp: "2026-02-19T13:00:03Z".to_string(),
            tool_calls: None,
            tool_call_id: Some("call-2".to_string()),
            reasoning_content: None,
        };

        let converted = convert_agent_message(
            &user_tool_response,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(!converted
            .content
            .iter()
            .any(|part| matches!(part, TauriMessageContent::Text { .. })));
        assert!(converted.content.iter().any(|part| {
            matches!(
                part,
                TauriMessageContent::ToolResponse { id, output, .. }
                    if id == "call-2" && output == "任务已完成"
            )
        }));
    }

    #[test]
    fn convert_agent_messages_should_force_offload_old_large_tool_calls_under_context_pressure() {
        let _lock = env_lock().lock().expect("lock env");
        let _env = EnvGuard::set(&[
            (
                crate::tool_io_offload::PROXYCAST_TOOL_TOKEN_LIMIT_BEFORE_EVICT_ENV,
                OsString::from("50"),
            ),
            (
                crate::tool_io_offload::PROXYCAST_CONTEXT_MAX_INPUT_TOKENS_ENV,
                OsString::from("600"),
            ),
            (
                crate::tool_io_offload::PROXYCAST_CONTEXT_WINDOW_TRIGGER_RATIO_ENV,
                OsString::from("0.5"),
            ),
            (
                crate::tool_io_offload::PROXYCAST_CONTEXT_KEEP_RECENT_MESSAGES_ENV,
                OsString::from("1"),
            ),
        ]);

        let messages = vec![
            AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text(String::new()),
                timestamp: "2026-03-11T00:00:00Z".to_string(),
                tool_calls: Some(vec![ToolCall {
                    id: "call-history-1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "Write".to_string(),
                        arguments: serde_json::json!({
                            "path": "docs/huge.md",
                            "content": "token ".repeat(220),
                        })
                        .to_string(),
                    },
                }]),
                tool_call_id: None,
                reasoning_content: None,
            },
            AgentMessage {
                role: "user".to_string(),
                content: MessageContent::Text("token ".repeat(320)),
                timestamp: "2026-03-11T00:00:01Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
            AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text("最近一条消息".to_string()),
                timestamp: "2026-03-11T00:00:02Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        ];

        let converted = convert_agent_messages(&messages, Some("gpt-4"));
        let first = converted.first().expect("first message");
        let request = first
            .content
            .iter()
            .find_map(|part| match part {
                TauriMessageContent::ToolRequest { arguments, .. } => Some(arguments),
                _ => None,
            })
            .expect("tool request");

        let record = request
            .as_object()
            .expect("offloaded request should be object");
        assert!(record.contains_key(crate::tool_io_offload::PROXYCAST_TOOL_ARGUMENTS_OFFLOAD_KEY));
    }
}
