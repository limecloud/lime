use crate::conversation::message::{ActionRequiredScope, Message};
use crate::tools::{
    base::Tool,
    context::{ToolContext, ToolResult},
    error::ToolError,
};
use crate::user_message_manager::UserMessageManager;
use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const SEND_USER_MESSAGE_TOOL_NAME: &str = "SendUserMessage";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SendUserMessageStatus {
    Normal,
    Proactive,
}

#[derive(Debug, Clone, Deserialize)]
struct SendUserMessageInput {
    message: String,
    #[serde(default)]
    attachments: Vec<String>,
    status: SendUserMessageStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UserAttachment {
    path: String,
    size: u64,
    is_image: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SendUserMessageOutput {
    message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<UserAttachment>,
    sent_at: String,
}

pub struct SendUserMessageTool;

impl SendUserMessageTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SendUserMessageTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for SendUserMessageTool {
    fn name(&self) -> &str {
        SEND_USER_MESSAGE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "向用户发送一条主可见消息。适合回复用户、汇报进度或主动提醒；工具结果只返回“已送达”提示，不把正文重新回灌到 agent 上下文。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "要发给用户的消息正文，支持 Markdown。"
                },
                "attachments": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选附件路径。支持绝对路径和相对当前 working directory 的路径。"
                },
                "status": {
                    "type": "string",
                    "enum": ["normal", "proactive"],
                    "description": "\"normal\" 表示回应用户刚刚的请求；\"proactive\" 表示主动推送状态更新或后台结果。"
                }
            },
            "required": ["message", "status"],
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: SendUserMessageInput = serde_json::from_value(params).map_err(|error| {
            ToolError::invalid_params(format!("SendUserMessage 参数无效: {error}"))
        })?;

        let message = input.message.trim();
        if message.is_empty() {
            return Err(ToolError::invalid_params(
                "SendUserMessage.message 不能为空",
            ));
        }

        let attachments = resolve_attachments(&context.working_directory, &input.attachments)?;
        let delivered_text = render_user_visible_message(message, &attachments);
        let scope = current_scope(context);
        UserMessageManager::global()
            .enqueue_scoped(
                scope,
                Message::assistant().with_text(delivered_text).user_only(),
            )
            .await;

        let output = SendUserMessageOutput {
            message: message.to_string(),
            attachments,
            sent_at: Utc::now().to_rfc3339(),
        };
        let result_message = render_tool_result_message(output.attachments.len());

        Ok(ToolResult::success(result_message)
            .with_metadata("message", json!(output.message))
            .with_metadata("attachments", json!(output.attachments))
            .with_metadata("sentAt", json!(output.sent_at))
            .with_metadata("status", json!(input.status)))
    }
}

fn current_scope(context: &ToolContext) -> ActionRequiredScope {
    crate::session_context::current_action_scope().unwrap_or_else(|| {
        let session_id = crate::session_context::current_session_id().or_else(|| {
            (!context.session_id.trim().is_empty()).then(|| context.session_id.clone())
        });
        ActionRequiredScope {
            session_id: session_id.clone(),
            thread_id: session_id,
            turn_id: None,
        }
    })
}

fn resolve_attachments(
    working_directory: &Path,
    attachments: &[String],
) -> Result<Vec<UserAttachment>, ToolError> {
    attachments
        .iter()
        .map(|raw_path| {
            let trimmed = raw_path.trim();
            if trimmed.is_empty() {
                return Err(ToolError::invalid_params(
                    "attachments 里不能包含空路径".to_string(),
                ));
            }

            let resolved_path = resolve_attachment_path(working_directory, trimmed);
            let metadata = std::fs::metadata(&resolved_path).map_err(|error| {
                ToolError::execution_failed(format!(
                    "读取附件失败 ({}): {error}",
                    resolved_path.display()
                ))
            })?;
            if !metadata.is_file() {
                return Err(ToolError::invalid_params(format!(
                    "附件必须是文件: {}",
                    resolved_path.display()
                )));
            }

            Ok(UserAttachment {
                path: resolved_path.display().to_string(),
                size: metadata.len(),
                is_image: is_image_path(&resolved_path),
                file_uuid: None,
            })
        })
        .collect()
}

fn resolve_attachment_path(working_directory: &Path, raw_path: &str) -> PathBuf {
    let path = PathBuf::from(raw_path);
    if path.is_absolute() {
        path
    } else {
        working_directory.join(path)
    }
}

fn render_user_visible_message(message: &str, attachments: &[UserAttachment]) -> String {
    if attachments.is_empty() {
        return message.to_string();
    }

    let attachment_lines = attachments
        .iter()
        .map(|attachment| format!("- {}", attachment.path))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{message}\n\n附件:\n{attachment_lines}")
}

fn render_tool_result_message(attachment_count: usize) -> String {
    if attachment_count == 0 {
        "Message delivered to user.".to_string()
    } else {
        format!("Message delivered to user. ({attachment_count} attachment(s) included)")
    }
}

fn is_image_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()),
        Some(ext)
            if matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" | "avif"
            )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn send_user_message_enqueues_user_only_message_and_serializes_output(
    ) -> anyhow::Result<()> {
        let temp_dir = tempfile::tempdir()?;
        let attachment_path = temp_dir.path().join("note.txt");
        std::fs::write(&attachment_path, "hello")?;

        let scope = ActionRequiredScope {
            session_id: Some("session-send-user-message".to_string()),
            thread_id: Some("thread-send-user-message".to_string()),
            turn_id: Some("turn-send-user-message".to_string()),
        };

        let result = crate::session_context::with_action_scope(scope.clone(), async {
            SendUserMessageTool::new()
                .execute(
                    json!({
                        "message": "处理完成",
                        "attachments": [attachment_path.display().to_string()],
                        "status": "proactive"
                    }),
                    &ToolContext::new(temp_dir.path().to_path_buf())
                        .with_session_id("session-send-user-message"),
                )
                .await
        })
        .await?;

        assert!(result.success);
        let drained = UserMessageManager::global()
            .drain_messages_for_scope(&scope)
            .await;
        assert_eq!(drained.len(), 1);
        assert!(drained[0].is_user_visible());
        assert!(!drained[0].is_agent_visible());
        assert!(drained[0].as_concat_text().contains("处理完成"));
        assert!(drained[0]
            .as_concat_text()
            .contains(&attachment_path.display().to_string()));
        let output = result
            .output
            .as_deref()
            .expect("SendUserMessage should emit a delivery summary");
        assert_eq!(
            output,
            "Message delivered to user. (1 attachment(s) included)"
        );
        assert!(!output.contains("处理完成"));
        assert!(!output.contains(&attachment_path.display().to_string()));
        assert_eq!(result.metadata.get("message"), Some(&json!("处理完成")));
        assert_eq!(result.metadata.get("status"), Some(&json!("proactive")));
        assert!(result.metadata.contains_key("sentAt"));

        Ok(())
    }

    #[test]
    fn resolve_attachments_rejects_missing_files() {
        let temp_dir = TempDir::new().unwrap();
        let error = resolve_attachments(temp_dir.path(), &["missing.txt".to_string()])
            .expect_err("missing attachment should fail");
        assert!(error.to_string().contains("读取附件失败"));
    }
}
