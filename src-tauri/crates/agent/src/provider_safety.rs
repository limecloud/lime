use aster::conversation::message::{Message, MessageContent};
use aster::model::ModelConfig;
use aster::providers::base::{
    LeadWorkerProviderTrait, MessageStream, Provider, ProviderMetadata, ProviderUsage,
};
use aster::providers::errors::ProviderError;
use aster::providers::RetryConfig;
use async_trait::async_trait;
use rmcp::model::Tool;
use std::collections::HashSet;
use std::sync::Arc;

pub(crate) fn wrap_provider_with_message_safety(provider: Arc<dyn Provider>) -> Arc<dyn Provider> {
    Arc::new(MessageSafeProvider { inner: provider })
}

fn normalize_provider_messages(messages: &[Message]) -> Vec<Message> {
    let mut normalized_messages: Vec<Message> = messages.to_vec();
    let mut valid_request_ids = HashSet::new();
    let mut matched_request_ids = HashSet::new();
    let mut removed_invalid_requests = 0_usize;
    let mut removed_invalid_responses = 0_usize;

    for message in &mut normalized_messages {
        let mut next_content = Vec::with_capacity(message.content.len());

        for content in message.content.drain(..) {
            match &content {
                MessageContent::ToolRequest(request) => {
                    if message.role != rmcp::model::Role::Assistant || request.tool_call.is_err() {
                        removed_invalid_requests += 1;
                        continue;
                    }
                    valid_request_ids.insert(request.id.clone());
                    next_content.push(content);
                }
                MessageContent::FrontendToolRequest(request) => {
                    if message.role != rmcp::model::Role::Assistant || request.tool_call.is_err() {
                        removed_invalid_requests += 1;
                        continue;
                    }
                    valid_request_ids.insert(request.id.clone());
                    next_content.push(content);
                }
                MessageContent::ToolResponse(response) => {
                    if message.role != rmcp::model::Role::User
                        || !valid_request_ids.contains(&response.id)
                        || matched_request_ids.contains(&response.id)
                    {
                        removed_invalid_responses += 1;
                        continue;
                    }
                    matched_request_ids.insert(response.id.clone());
                    next_content.push(content);
                }
                _ => next_content.push(content),
            }
        }

        message.content = next_content;
    }

    normalized_messages.iter_mut().for_each(|message| {
        message.content.retain(|content| match content {
            MessageContent::ToolRequest(request) => matched_request_ids.contains(&request.id),
            MessageContent::FrontendToolRequest(request) => {
                matched_request_ids.contains(&request.id)
            }
            MessageContent::ToolResponse(response) => matched_request_ids.contains(&response.id),
            _ => true,
        });
    });

    normalized_messages.retain(|message| !message.content.is_empty());

    if removed_invalid_requests > 0 || removed_invalid_responses > 0 {
        tracing::warn!(
            removed_invalid_requests,
            removed_invalid_responses,
            "[ProviderSafety] 已在 provider 请求前归一化工具消息链"
        );
    }

    normalized_messages
}

struct MessageSafeProvider {
    inner: Arc<dyn Provider>,
}

#[async_trait]
impl Provider for MessageSafeProvider {
    fn metadata() -> ProviderMetadata
    where
        Self: Sized,
    {
        ProviderMetadata::empty()
    }

    fn get_name(&self) -> &str {
        self.inner.get_name()
    }

    async fn complete_with_model(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        let normalized_messages = normalize_provider_messages(messages);
        self.inner
            .complete_with_model(model_config, system, &normalized_messages, tools)
            .await
    }

    fn get_model_config(&self) -> ModelConfig {
        self.inner.get_model_config()
    }

    fn retry_config(&self) -> RetryConfig {
        self.inner.retry_config()
    }

    async fn fetch_supported_models(&self) -> Result<Option<Vec<String>>, ProviderError> {
        self.inner.fetch_supported_models().await
    }

    async fn fetch_recommended_models(&self) -> Result<Option<Vec<String>>, ProviderError> {
        self.inner.fetch_recommended_models().await
    }

    async fn map_to_canonical_model(
        &self,
        provider_model: &str,
    ) -> Result<Option<String>, ProviderError> {
        self.inner.map_to_canonical_model(provider_model).await
    }

    fn supports_embeddings(&self) -> bool {
        self.inner.supports_embeddings()
    }

    async fn supports_cache_control(&self) -> bool {
        self.inner.supports_cache_control().await
    }

    async fn create_embeddings(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, ProviderError> {
        self.inner.create_embeddings(texts).await
    }

    fn as_lead_worker(&self) -> Option<&dyn LeadWorkerProviderTrait> {
        self.inner.as_lead_worker()
    }

    async fn stream(
        &self,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        let normalized_messages = normalize_provider_messages(messages);
        self.inner.stream(system, &normalized_messages, tools).await
    }

    fn supports_streaming(&self) -> bool {
        self.inner.supports_streaming()
    }

    fn get_active_model_name(&self) -> String {
        self.inner.get_active_model_name()
    }

    async fn configure_oauth(&self) -> Result<(), ProviderError> {
        self.inner.configure_oauth().await
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_provider_messages;
    use aster::conversation::message::{Message, MessageContent};
    use rmcp::model::{CallToolRequestParam, CallToolResult, ErrorCode, ErrorData};
    use rmcp::object;

    fn valid_tool_response() -> CallToolResult {
        CallToolResult {
            content: vec![],
            structured_content: None,
            is_error: Some(false),
            meta: None,
        }
    }

    fn invalid_tool_call_error(message: &str) -> ErrorData {
        ErrorData {
            code: ErrorCode::INTERNAL_ERROR,
            message: std::borrow::Cow::Owned(message.to_string()),
            data: None,
        }
    }

    #[test]
    fn normalize_provider_messages_should_preserve_valid_tool_chain() {
        let messages = vec![
            Message::user().with_text("帮我读一下项目结构"),
            Message::assistant()
                .with_text("我先检查目录。")
                .with_tool_request(
                    "tool-1",
                    Ok(CallToolRequestParam {
                        name: "read_dir".into(),
                        arguments: Some(object!({"path": "."})),
                    }),
                ),
            Message::user().with_tool_response("tool-1", Ok(valid_tool_response())),
            Message::assistant().with_text("目录读取完成。"),
        ];

        let normalized = normalize_provider_messages(&messages);

        assert_eq!(normalized, messages);
    }

    #[test]
    fn normalize_provider_messages_should_remove_orphan_tool_response() {
        let messages = vec![
            Message::user().with_text("继续"),
            Message::user().with_tool_response("orphan-tool", Ok(valid_tool_response())),
            Message::assistant().with_text("我继续整理。"),
        ];

        let normalized = normalize_provider_messages(&messages);

        assert_eq!(normalized.len(), 2);
        assert!(normalized.iter().all(|message| {
            message
                .content
                .iter()
                .all(|content| !matches!(content, MessageContent::ToolResponse(_)))
        }));
    }

    #[test]
    fn normalize_provider_messages_should_drop_invalid_tool_request_and_following_response() {
        let messages = vec![
            Message::assistant()
                .with_text("我先尝试调用工具。")
                .with_tool_request(
                    "broken-tool",
                    Err(invalid_tool_call_error("工具参数解析失败")),
                ),
            Message::user().with_tool_response("broken-tool", Ok(valid_tool_response())),
            Message::assistant().with_text("工具失败后我继续主线程编排。"),
        ];

        let normalized = normalize_provider_messages(&messages);

        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0].as_concat_text(), "我先尝试调用工具。");
        assert_eq!(
            normalized[1].as_concat_text(),
            "工具失败后我继续主线程编排。"
        );
        assert!(normalized.iter().all(|message| {
            message.content.iter().all(|content| {
                !matches!(
                    content,
                    MessageContent::ToolRequest(_) | MessageContent::ToolResponse(_)
                )
            })
        }));
    }

    #[test]
    fn normalize_provider_messages_should_drop_invalid_frontend_tool_request_and_response() {
        let messages = vec![
            Message::assistant()
                .with_text("我先请求前端动作。")
                .with_frontend_tool_request(
                    "frontend-tool",
                    Err(invalid_tool_call_error("前端工具参数无效")),
                ),
            Message::user().with_tool_response("frontend-tool", Ok(valid_tool_response())),
            Message::assistant().with_text("前端工具失败后继续推进。"),
        ];

        let normalized = normalize_provider_messages(&messages);

        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0].as_concat_text(), "我先请求前端动作。");
        assert_eq!(normalized[1].as_concat_text(), "前端工具失败后继续推进。");
        assert!(normalized.iter().all(|message| {
            message.content.iter().all(|content| {
                !matches!(
                    content,
                    MessageContent::FrontendToolRequest(_) | MessageContent::ToolResponse(_)
                )
            })
        }));
    }
}
