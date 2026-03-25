//! Agent Task Executor
//!
//! 负责执行调度任务。

use super::types::ScheduledTask;
use aster::conversation::message::Message;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use lime_agent::credential_bridge::CredentialBridge;
#[cfg(test)]
use lime_agent::request_tool_policy::REQUEST_TOOL_POLICY_MARKER;
use lime_agent::request_tool_policy::{
    merge_system_prompt_with_request_tool_policy, resolve_request_tool_policy,
    stream_message_reply_with_policy,
};
use lime_agent::{merge_system_prompt_with_runtime_agents, AsterAgentState, SessionConfigBuilder};
use lime_core::database::DbConnection;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

/// 任务执行器 Trait
#[async_trait]
pub trait TaskExecutor: Send + Sync {
    /// 执行任务
    ///
    /// # 参数
    /// - `task`: 要执行的任务
    /// - `db`: 数据库连接
    ///
    /// # 返回
    /// - 成功返回执行结果（JSON 格式）
    /// - 失败返回错误信息
    async fn execute(
        &self,
        task: &ScheduledTask,
        db: &DbConnection,
    ) -> Result<serde_json::Value, String>;
}

/// Agent 任务执行器
///
/// 通过 CredentialBridge 选择凭证，调用 Aster Agent 执行任务
pub struct AgentExecutor {
    credential_bridge: Arc<CredentialBridge>,
}

impl AgentExecutor {
    /// 创建新的执行器实例
    pub fn new() -> Self {
        Self {
            credential_bridge: Arc::new(CredentialBridge::new()),
        }
    }

    /// 使用自定义的 CredentialBridge 创建执行器
    pub fn with_credential_bridge(credential_bridge: Arc<CredentialBridge>) -> Self {
        Self { credential_bridge }
    }
}

impl Default for AgentExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TaskInputBlock {
    Text { text: String },
    Media(TaskInputMedia),
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct TaskInputMedia {
    media_type: String,
    source_type: TaskInputSourceType,
    path_or_data: String,
    #[serde(default)]
    mime_type: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TaskInputSourceType {
    LocalPath,
    DataUrl,
}

#[async_trait]
impl TaskExecutor for AgentExecutor {
    async fn execute(
        &self,
        task: &ScheduledTask,
        db: &DbConnection,
    ) -> Result<serde_json::Value, String> {
        tracing::info!(
            "[AgentExecutor] 开始执行任务: {} (类型: {}, provider: {}, model: {})",
            task.name,
            task.task_type,
            task.provider_type,
            task.model
        );

        // 1. 从凭证池选择凭证
        let aster_config = self
            .credential_bridge
            .select_and_configure(db, &task.provider_type, &task.model)
            .await
            .map_err(|e| format!("选择凭证失败: {e}"))?;

        tracing::info!(
            "[AgentExecutor] 已选择凭证: {} (provider: {}, model: {})",
            aster_config.credential_uuid,
            aster_config.provider_name,
            aster_config.model_name
        );

        // 2. 根据任务类型执行不同的操作
        let result = match task.task_type.as_str() {
            "agent_chat" => {
                // 执行 Agent 对话任务
                self.execute_agent_chat(task, db, &aster_config).await?
            }
            "scheduled_report" => {
                // 执行定时报告任务
                self.execute_scheduled_report(task, db, &aster_config)
                    .await?
            }
            _ => {
                return Err(format!("不支持的任务类型: {}", task.task_type));
            }
        };

        // 3. 标记凭证为健康
        if let Err(e) = self.credential_bridge.mark_healthy(
            db,
            &aster_config.credential_uuid,
            Some(&task.model),
        ) {
            tracing::warn!("[AgentExecutor] 标记凭证健康失败: {}", e);
        }

        tracing::info!("[AgentExecutor] 任务执行成功: {}", task.name);
        Ok(result)
    }
}

impl AgentExecutor {
    fn resolve_agent_session_id(task: &ScheduledTask) -> String {
        task.params
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| id.to_string())
            .unwrap_or_else(|| format!("scheduler-agent-chat-{}", task.id))
    }

    fn resolve_bool_param(task: &ScheduledTask, key: &str) -> Option<bool> {
        let value = task.params.get(key)?;
        match value {
            Value::Bool(flag) => Some(*flag),
            Value::String(raw) => match raw.trim().to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" | "on" => Some(true),
                "false" | "0" | "no" | "off" => Some(false),
                _ => None,
            },
            Value::Number(number) => number.as_i64().map(|v| v != 0),
            _ => None,
        }
    }

    fn resolve_system_prompt(task: &ScheduledTask) -> Option<String> {
        task.params
            .get("system_prompt")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
    }

    fn resolve_prompt_text(task: &ScheduledTask) -> Option<String> {
        task.params
            .get("raw_message")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .or_else(|| {
                task.params
                    .get("prompt")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| value.to_string())
            })
    }

    fn resolve_inputs(task: &ScheduledTask) -> Result<Vec<TaskInputBlock>, String> {
        let Some(value) = task.params.get("inputs") else {
            return Ok(Vec::new());
        };
        if value.is_null() {
            return Ok(Vec::new());
        }
        serde_json::from_value::<Vec<TaskInputBlock>>(value.clone())
            .map_err(|error| format!("解析 inputs 失败: {error}"))
    }

    fn build_user_message(
        prompt_text: Option<&str>,
        inputs: &[TaskInputBlock],
    ) -> Result<Message, String> {
        let mut message = Message::user();
        let mut text_segments = inputs
            .iter()
            .filter_map(|input| match input {
                TaskInputBlock::Text { text } => {
                    let trimmed = text.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                }
                TaskInputBlock::Media(_) => None,
            })
            .collect::<Vec<_>>();

        if text_segments.is_empty() {
            if let Some(prompt) = prompt_text.map(str::trim).filter(|value| !value.is_empty()) {
                text_segments.push(prompt.to_string());
            }
        }

        for text in text_segments {
            message = message.with_text(text);
        }

        for input in inputs {
            if let TaskInputBlock::Media(media) = input {
                message = Self::append_media_input(message, media)?;
            }
        }

        if message.content.is_empty() {
            return Err("缺少可执行的 prompt 或 inputs".to_string());
        }

        Ok(message)
    }

    fn append_media_input(message: Message, media: &TaskInputMedia) -> Result<Message, String> {
        if !Self::is_image_media(media) {
            return Ok(message.with_text(Self::build_attachment_description(media)));
        }

        let (data, mime_type) = Self::resolve_image_payload(media)?;
        Ok(message.with_image(data, mime_type))
    }

    fn is_image_media(media: &TaskInputMedia) -> bool {
        media
            .media_type
            .trim()
            .to_ascii_lowercase()
            .starts_with("image")
            || media
                .mime_type
                .as_deref()
                .map(str::trim)
                .map(|value| value.to_ascii_lowercase().starts_with("image/"))
                .unwrap_or(false)
    }

    fn build_attachment_description(media: &TaskInputMedia) -> String {
        let mut description = format!("[附件: type={}]", media.media_type.trim());
        if let Some(file_name) = media
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            description.push_str(&format!(" file={file_name}"));
        }
        if let Some(mime_type) = media
            .mime_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            description.push_str(&format!(" mime={mime_type}"));
        }
        description
    }

    fn resolve_image_payload(media: &TaskInputMedia) -> Result<(String, String), String> {
        match media.source_type {
            TaskInputSourceType::LocalPath => {
                let path = media.path_or_data.trim();
                if path.is_empty() {
                    return Err("图片输入缺少本地路径".to_string());
                }
                let bytes = std::fs::read(path)
                    .map_err(|error| format!("读取图片失败 path={path}: {error}"))?;
                let mime_type = media
                    .mime_type
                    .clone()
                    .filter(|value| value.trim().starts_with("image/"))
                    .or_else(|| Self::guess_image_mime_from_path(path))
                    .unwrap_or_else(|| "image/png".to_string());
                Ok((BASE64_STANDARD.encode(bytes), mime_type))
            }
            TaskInputSourceType::DataUrl => Self::parse_data_url_image(media),
        }
    }

    fn parse_data_url_image(media: &TaskInputMedia) -> Result<(String, String), String> {
        let data_url = media.path_or_data.trim();
        if let Some((header, data)) = data_url.split_once(',') {
            if let Some(rest) = header.strip_prefix("data:") {
                let mut segments = rest.split(';');
                let mime_type = segments.next().unwrap_or("image/png").trim();
                let is_base64 =
                    segments.any(|segment| segment.trim().eq_ignore_ascii_case("base64"));
                if !is_base64 {
                    return Err("暂不支持非 base64 的 data URL 图片输入".to_string());
                }
                if !mime_type.starts_with("image/") {
                    return Err(format!("不支持的图片 MIME 类型: {mime_type}"));
                }
                if data.trim().is_empty() {
                    return Err("图片 data URL 缺少数据体".to_string());
                }
                return Ok((data.trim().to_string(), mime_type.to_string()));
            }
        }

        let mime_type = media
            .mime_type
            .clone()
            .filter(|value| value.trim().starts_with("image/"))
            .unwrap_or_else(|| "image/png".to_string());
        if media.path_or_data.trim().is_empty() {
            return Err("图片 data URL 为空".to_string());
        }
        Ok((media.path_or_data.trim().to_string(), mime_type))
    }

    fn guess_image_mime_from_path(path: &str) -> Option<String> {
        let extension = std::path::Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.trim().to_ascii_lowercase())?;
        match extension.as_str() {
            "png" => Some("image/png".to_string()),
            "jpg" | "jpeg" => Some("image/jpeg".to_string()),
            "gif" => Some("image/gif".to_string()),
            "webp" => Some("image/webp".to_string()),
            "bmp" => Some("image/bmp".to_string()),
            "svg" => Some("image/svg+xml".to_string()),
            _ => None,
        }
    }

    /// 执行 Agent 对话任务
    async fn execute_agent_chat(
        &self,
        task: &ScheduledTask,
        db: &DbConnection,
        _aster_config: &lime_agent::credential_bridge::AsterProviderConfig,
    ) -> Result<serde_json::Value, String> {
        let prompt_text = Self::resolve_prompt_text(task);
        let inputs = Self::resolve_inputs(task)?;
        let user_message = Self::build_user_message(prompt_text.as_deref(), &inputs)?;

        tracing::info!(
            "[AgentExecutor] 执行 Agent 对话: text_chars={} input_blocks={} has_image={}",
            user_message.as_concat_text().chars().count(),
            inputs.len(),
            inputs.iter().any(
                |input| matches!(input, TaskInputBlock::Media(media) if Self::is_image_media(media))
            )
        );

        let response_prompt = prompt_text
            .clone()
            .unwrap_or_else(|| user_message.as_concat_text());
        let session_id = Self::resolve_agent_session_id(task);
        let request_tool_policy =
            resolve_request_tool_policy(Self::resolve_bool_param(task, "web_search"), false);
        let merged_system_prompt = merge_system_prompt_with_request_tool_policy(
            merge_system_prompt_with_runtime_agents(Self::resolve_system_prompt(task), None),
            &request_tool_policy,
        );
        // 对齐主对话入口：执行前刷新一次 Skills 注册，避免运行期安装/更新后不可见。
        AsterAgentState::reload_lime_skills();
        tracing::info!(
            "[AgentExecutor] agent_chat 会话策略: session={} web_search={} system_prompt={}",
            session_id,
            request_tool_policy.effective_web_search,
            if merged_system_prompt.is_some() {
                "provided"
            } else {
                "none"
            }
        );

        let state = AsterAgentState::new();
        state
            .configure_provider_from_pool(db, &task.provider_type, &task.model, &session_id)
            .await
            .map_err(|e| format!("配置 Agent Provider 失败: {e}"))?;

        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or_else(|| "Agent 未初始化".to_string())?;
        let available_tools = {
            let registry = agent.tool_registry().read().await;
            registry
                .get_definitions()
                .iter()
                .map(|definition| definition.name.clone())
                .collect::<Vec<_>>()
        };
        tracing::info!(
            "[AgentExecutor] 当前可用工具({}): {}",
            available_tools.len(),
            available_tools.join(", ")
        );

        let mut session_builder = SessionConfigBuilder::new(&session_id);
        if let Some(system_prompt) = merged_system_prompt {
            session_builder = session_builder.system_prompt(system_prompt);
        }
        let session_config = session_builder.build();
        let execution = stream_message_reply_with_policy(
            agent,
            user_message,
            None,
            session_config,
            None,
            &request_tool_policy,
            |event| match event {
                lime_agent::AgentEvent::ToolStart {
                    tool_name, tool_id, ..
                } => {
                    tracing::info!(
                        "[AgentExecutor] 工具调用开始: {} (tool_id={})",
                        tool_name,
                        tool_id
                    );
                }
                lime_agent::AgentEvent::ToolEnd { tool_id, result } => {
                    tracing::info!(
                        "[AgentExecutor] 工具调用结束: tool_id={} success={}",
                        tool_id,
                        result.success
                    );
                }
                _ => {}
            },
        )
        .await
        .map_err(|error| {
            format!(
                "Agent 执行失败: {} (emitted_any={})",
                error.message, error.emitted_any
            )
        })?;

        let response = execution.text_output;
        if response.trim().is_empty() {
            if let Some(last_error) = execution.event_errors.last() {
                return Err(format!("Agent 未返回有效文本输出: {last_error}"));
            }
            return Err("Agent 未返回有效文本输出".to_string());
        }

        Ok(serde_json::json!({
            "type": "agent_chat",
            "prompt": response_prompt,
            "response": response,
            "status": "success"
        }))
    }

    /// 执行定时报告任务
    async fn execute_scheduled_report(
        &self,
        task: &ScheduledTask,
        _db: &DbConnection,
        _aster_config: &lime_agent::credential_bridge::AsterProviderConfig,
    ) -> Result<serde_json::Value, String> {
        let report_type = task
            .params
            .get("report_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少 report_type 参数".to_string())?;

        tracing::info!("[AgentExecutor] 生成定时报告: {}", report_type);

        // TODO: 实际生成报告逻辑
        Ok(serde_json::json!({
            "type": "scheduled_report",
            "report_type": report_type,
            "generated_at": chrono::Utc::now().to_rfc3339(),
            "status": "success"
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::conversation::message::MessageContent;
    use chrono::Utc;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn test_executor_creation() {
        let executor = AgentExecutor::new();
        assert!(Arc::strong_count(&executor.credential_bridge) >= 1);
    }

    #[tokio::test]
    async fn test_execute_agent_chat_missing_prompt() {
        let executor = AgentExecutor::new();
        let db = setup_test_db();

        let task = ScheduledTask::new(
            "Test".to_string(),
            "agent_chat".to_string(),
            serde_json::json!({}), // 缺少 prompt
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        // 由于缺少凭证池数据，这里会在选择凭证时失败
        // 但我们可以测试参数验证逻辑
        let result = executor.execute(&task, &db).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_unsupported_task_type() {
        let executor = AgentExecutor::new();
        let db = setup_test_db();

        let task = ScheduledTask::new(
            "Test".to_string(),
            "unsupported_type".to_string(),
            serde_json::json!({}),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        let result = executor.execute(&task, &db).await;
        assert!(result.is_err());
        // 测试环境无凭证，会在凭证选择阶段失败
        let err = result.unwrap_err();
        assert!(
            err.contains("不支持的任务类型") || err.contains("选择凭证失败"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn test_resolve_bool_param_supports_string_and_bool() {
        let task = ScheduledTask::new(
            "bool-test".to_string(),
            "agent_chat".to_string(),
            serde_json::json!({
                "prompt": "hello",
                "web_search": "true",
                "feature_flag": false
            }),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );
        assert_eq!(
            AgentExecutor::resolve_bool_param(&task, "web_search"),
            Some(true)
        );
        assert_eq!(
            AgentExecutor::resolve_bool_param(&task, "feature_flag"),
            Some(false)
        );
    }

    #[test]
    fn test_merge_system_prompt_with_web_search_policy() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged =
            merge_system_prompt_with_request_tool_policy(Some("你是助手".to_string()), &policy)
                .expect("merged prompt should exist");
        assert!(merged.contains("你是助手"));
        assert!(merged.contains(REQUEST_TOOL_POLICY_MARKER));
        assert!(merged.contains("WebSearch"));
    }

    #[test]
    fn test_build_user_message_uses_image_data_url_inputs() {
        let message = AgentExecutor::build_user_message(
            Some("忽略这条 fallback"),
            &[
                TaskInputBlock::Text {
                    text: "看看这张图".to_string(),
                },
                TaskInputBlock::Media(TaskInputMedia {
                    media_type: "image".to_string(),
                    source_type: TaskInputSourceType::DataUrl,
                    path_or_data: "data:image/png;base64,aGVsbG8=".to_string(),
                    mime_type: Some("image/png".to_string()),
                    file_name: Some("demo.png".to_string()),
                    metadata: None,
                }),
            ],
        )
        .expect("message should build");

        assert_eq!(message.as_concat_text(), "看看这张图");
        assert!(
            message
                .content
                .iter()
                .any(|content| matches!(content, MessageContent::Image(image) if image.mime_type == "image/png" && image.data == "aGVsbG8="))
        );
    }

    #[test]
    fn test_build_user_message_falls_back_to_prompt_when_inputs_missing_text() {
        let message = AgentExecutor::build_user_message(Some("请分析截图"), &[])
            .expect("fallback prompt should be used");
        assert_eq!(message.as_concat_text(), "请分析截图");
    }

    #[test]
    fn test_build_user_message_keeps_non_image_media_as_text_description() {
        let message = AgentExecutor::build_user_message(
            None,
            &[TaskInputBlock::Media(TaskInputMedia {
                media_type: "file".to_string(),
                source_type: TaskInputSourceType::LocalPath,
                path_or_data: "/tmp/demo.pdf".to_string(),
                mime_type: Some("application/pdf".to_string()),
                file_name: Some("demo.pdf".to_string()),
                metadata: None,
            })],
        )
        .expect("non-image media should degrade to text description");

        assert!(message
            .as_concat_text()
            .contains("[附件: type=file] file=demo.pdf mime=application/pdf"));
    }
}
