use crate::tool_io::truncate_chars;
use rmcp::model::ServerNotification;
use serde_json::Value;
use std::collections::HashMap;

const TOOL_NOTIFICATION_MAX_DELTA_CHARS: usize = 1_200;

const MCP_LOG_PROCESS_METADATA_KEYS: &[&str] = &[
    "processId",
    "process_id",
    "toolId",
    "tool_id",
    "toolName",
    "tool_name",
    "executionProcessStatus",
    "execution_process_status",
    "executionProcessControlStatus",
    "execution_process_control_status",
    "stdinWritable",
    "stdin_writable",
    "executionSurface",
    "execution_surface",
    "outputSequence",
    "output_sequence",
    "outputKind",
    "output_kind",
    "outputBytes",
    "output_bytes",
    "outputOmittedBytes",
    "output_omitted_bytes",
    "outputTruncated",
    "output_truncated",
    "exit_code",
    "elapsedMs",
    "elapsed_ms",
    "command",
    "cwd",
    "failure",
    "phase",
];

#[derive(Debug, Clone, PartialEq)]
pub struct ToolNotificationProgressProjection {
    pub message: Option<String>,
    pub progress: Option<f64>,
    pub total: Option<f64>,
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum McpNotificationProjection {
    ToolProgress {
        tool_id: String,
        progress: ToolNotificationProgressProjection,
    },
    ToolOutputDelta {
        tool_id: String,
        delta: String,
        output_kind: Option<String>,
        metadata: Option<HashMap<String, Value>>,
    },
}

fn truncate_notification_text(text: impl Into<String>) -> String {
    let text = text.into();
    let (mut limited, truncated) = truncate_chars(&text, TOOL_NOTIFICATION_MAX_DELTA_CHARS);
    if truncated {
        limited.push_str("\n\n[event_converter] 工具流式通知已截断");
    }
    limited
}

fn metadata_with_kind(kind: &str) -> HashMap<String, Value> {
    let mut metadata = HashMap::new();
    metadata.insert(
        "notification_kind".to_string(),
        Value::String(kind.to_string()),
    );
    metadata
}

fn value_to_notification_text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return truncate_notification_text(text);
    }
    if let Some(object) = value.as_object() {
        for key in ["delta", "text", "message", "output"] {
            if let Some(text) = object.get(key).and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    return truncate_notification_text(text);
                }
            }
        }
        if MCP_LOG_PROCESS_METADATA_KEYS
            .iter()
            .any(|key| object.contains_key(*key))
        {
            return String::new();
        }
    }

    truncate_notification_text(serde_json::to_string(value).unwrap_or_else(|_| value.to_string()))
}

fn maybe_text_from_custom_notification_params(params: Option<&Value>) -> Option<String> {
    let params = params?;
    if let Some(text) = params.as_str() {
        return Some(truncate_notification_text(text));
    }

    let object = params.as_object()?;
    for key in ["delta", "text", "message", "output"] {
        if let Some(value) = object.get(key).and_then(Value::as_str) {
            let text = value.trim();
            if !text.is_empty() {
                return Some(truncate_notification_text(text));
            }
        }
    }

    None
}

fn merge_mcp_log_process_metadata(metadata: &mut HashMap<String, Value>, data: &Value) {
    let Some(object) = data.as_object() else {
        return;
    };
    for key in MCP_LOG_PROCESS_METADATA_KEYS {
        if let Some(value) = object.get(*key) {
            metadata.insert((*key).to_string(), value.clone());
        }
    }
}

pub fn project_mcp_notification(
    tool_id: impl Into<String>,
    notification: ServerNotification,
) -> Vec<McpNotificationProjection> {
    let tool_id = tool_id.into();
    match notification {
        ServerNotification::ProgressNotification(notification) => {
            let mut metadata = metadata_with_kind("mcp_progress");
            metadata.insert(
                "progress_token".to_string(),
                serde_json::to_value(&notification.params.progress_token).unwrap_or(Value::Null),
            );

            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: notification.params.message.map(truncate_notification_text),
                    progress: Some(notification.params.progress),
                    total: notification.params.total,
                    metadata: Some(metadata),
                },
            }]
        }
        ServerNotification::LoggingMessageNotification(notification) => {
            let mut metadata = metadata_with_kind("mcp_log");
            metadata.insert(
                "level".to_string(),
                serde_json::to_value(notification.params.level)
                    .unwrap_or_else(|_| Value::String(format!("{:?}", notification.params.level))),
            );
            if let Some(logger) = notification.params.logger {
                metadata.insert("logger".to_string(), Value::String(logger));
            }
            merge_mcp_log_process_metadata(&mut metadata, &notification.params.data);

            vec![McpNotificationProjection::ToolOutputDelta {
                tool_id,
                delta: value_to_notification_text(&notification.params.data),
                output_kind: Some("log".to_string()),
                metadata: Some(metadata),
            }]
        }
        ServerNotification::CancelledNotification(notification) => {
            let mut metadata = metadata_with_kind("mcp_cancelled");
            metadata.insert(
                "request_id".to_string(),
                serde_json::to_value(&notification.params.request_id).unwrap_or(Value::Null),
            );
            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: notification
                        .params
                        .reason
                        .map(truncate_notification_text)
                        .or_else(|| Some("工具请求已取消".to_string())),
                    progress: None,
                    total: None,
                    metadata: Some(metadata),
                },
            }]
        }
        ServerNotification::ResourceUpdatedNotification(notification) => {
            let mut metadata = metadata_with_kind("mcp_resource_updated");
            metadata.insert(
                "uri".to_string(),
                Value::String(notification.params.uri.clone()),
            );
            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: Some(truncate_notification_text(format!(
                        "资源已更新：{}",
                        notification.params.uri
                    ))),
                    progress: None,
                    total: None,
                    metadata: Some(metadata),
                },
            }]
        }
        ServerNotification::ResourceListChangedNotification(_) => {
            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: Some("工具服务资源列表已更新".to_string()),
                    progress: None,
                    total: None,
                    metadata: Some(metadata_with_kind("mcp_resources_changed")),
                },
            }]
        }
        ServerNotification::ToolListChangedNotification(_) => {
            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: Some("工具服务能力列表已更新".to_string()),
                    progress: None,
                    total: None,
                    metadata: Some(metadata_with_kind("mcp_tools_changed")),
                },
            }]
        }
        ServerNotification::PromptListChangedNotification(_) => {
            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: Some("工具服务提示词列表已更新".to_string()),
                    progress: None,
                    total: None,
                    metadata: Some(metadata_with_kind("mcp_prompts_changed")),
                },
            }]
        }
        // URL elicitation is not advertised by the current form-only client.
        // Its completion cannot complete a tool or resolve a pending form.
        ServerNotification::ElicitationCompletionNotification(_) => Vec::new(),
        ServerNotification::CustomNotification(notification) => {
            let mut metadata = metadata_with_kind("mcp_custom");
            metadata.insert(
                "method".to_string(),
                Value::String(notification.method.clone()),
            );
            if let Some(delta) =
                maybe_text_from_custom_notification_params(notification.params.as_ref())
            {
                return vec![McpNotificationProjection::ToolOutputDelta {
                    tool_id,
                    delta,
                    output_kind: Some("custom".to_string()),
                    metadata: Some(metadata),
                }];
            }

            vec![McpNotificationProjection::ToolProgress {
                tool_id,
                progress: ToolNotificationProgressProjection {
                    message: Some(truncate_notification_text(format!(
                        "收到工具通知：{}",
                        notification.method
                    ))),
                    progress: None,
                    total: None,
                    metadata: Some(metadata),
                },
            }]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{
        LoggingLevel, LoggingMessageNotification, LoggingMessageNotificationParam, NumberOrString,
        ProgressNotification, ProgressNotificationParam, ProgressToken,
    };

    #[test]
    fn url_elicitation_completion_does_not_project_tool_progress_or_output() {
        let notification = serde_json::from_value(serde_json::json!({
            "method": "notifications/elicitation/complete",
            "params": { "elicitationId": "url-1" }
        }))
        .expect("URL elicitation completion");
        assert!(project_mcp_notification("tool-1", notification).is_empty());
    }

    #[test]
    fn project_progress_notification_should_keep_progress_metadata() {
        let events = project_mcp_notification(
            "tool-1",
            ServerNotification::ProgressNotification(ProgressNotification::new(
                ProgressNotificationParam {
                    progress_token: ProgressToken(NumberOrString::Number(7)),
                    progress: 2.0,
                    total: Some(4.0),
                    message: Some("正在处理第 2 项".to_string()),
                },
            )),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            McpNotificationProjection::ToolProgress { tool_id, progress } => {
                assert_eq!(tool_id, "tool-1");
                assert_eq!(progress.message.as_deref(), Some("正在处理第 2 项"));
                assert_eq!(progress.progress, Some(2.0));
                assert_eq!(progress.total, Some(4.0));
                assert_eq!(
                    progress
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("notification_kind"))
                        .and_then(Value::as_str),
                    Some("mcp_progress")
                );
            }
            other => panic!("expected progress projection, got {other:?}"),
        }
    }

    #[test]
    fn project_log_notification_should_preserve_process_metadata() {
        let events = project_mcp_notification(
            "tool-1",
            ServerNotification::LoggingMessageNotification(LoggingMessageNotification::new(
                LoggingMessageNotificationParam {
                    level: LoggingLevel::Info,
                    logger: Some("runner".to_string()),
                    data: serde_json::json!({
                        "message": "已生成一段工具输出",
                        "processId": "process-tool-1",
                        "executionProcessStatus": "running",
                        "executionProcessControlStatus": "registered",
                        "executionSurface": "live_process",
                        "stdinWritable": true,
                        "outputSequence": 3,
                        "outputKind": "stdout"
                    }),
                },
            )),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            McpNotificationProjection::ToolOutputDelta {
                tool_id,
                delta,
                output_kind,
                metadata,
            } => {
                assert_eq!(tool_id, "tool-1");
                assert!(delta.contains("已生成一段工具输出"));
                assert_eq!(output_kind.as_deref(), Some("log"));
                assert_eq!(
                    metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("notification_kind"))
                        .and_then(Value::as_str),
                    Some("mcp_log")
                );
                assert_eq!(
                    metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("processId"))
                        .and_then(Value::as_str),
                    Some("process-tool-1")
                );
                assert_eq!(
                    metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("stdinWritable"))
                        .and_then(Value::as_bool),
                    Some(true)
                );
                assert_eq!(
                    metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("outputSequence"))
                        .and_then(Value::as_u64),
                    Some(3)
                );
            }
            other => panic!("expected output delta projection, got {other:?}"),
        }
    }

    #[test]
    fn project_metadata_only_log_should_not_render_json_as_delta() {
        let events = project_mcp_notification(
            "tool-1",
            ServerNotification::LoggingMessageNotification(LoggingMessageNotification::new(
                LoggingMessageNotificationParam {
                    level: LoggingLevel::Info,
                    logger: Some("runner".to_string()),
                    data: serde_json::json!({
                        "message": "",
                        "delta": "",
                        "processId": "process-tool-1",
                        "executionProcessStatus": "started",
                        "executionProcessControlStatus": "registered",
                        "executionSurface": "live_process",
                        "stdinWritable": true,
                        "phase": "started"
                    }),
                },
            )),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            McpNotificationProjection::ToolOutputDelta {
                delta, metadata, ..
            } => {
                assert!(delta.is_empty());
                assert_eq!(
                    metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("phase"))
                        .and_then(Value::as_str),
                    Some("started")
                );
            }
            other => panic!("expected metadata-only output delta, got {other:?}"),
        }
    }
}
