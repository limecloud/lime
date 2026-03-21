use anyhow::anyhow;
use aster::conversation::message::{Message, MessageContent};
use aster::model::ModelConfig;
use aster::providers::base::{
    ConfigKey, MessageStream, ModelInfo, Provider, ProviderMetadata, ProviderUsage, Usage,
};
use aster::providers::errors::ProviderError;
use aster::providers::formats::openai::{
    format_messages, format_tools, response_to_streaming_message,
};
use aster::providers::utils::ImageFormat;
use aster::session_context::current_turn_context;
use async_stream::try_stream;
use async_trait::async_trait;
use futures::{pin_mut, StreamExt};
use lime_core::models::openai::ChatCompletionRequest;
use lime_providers::providers::{KiroProvider, TokenManager};
use lime_providers::streaming::converter::{StreamConverter, StreamFormat as LimeStreamFormat};
use rmcp::model::{Role, Tool};
use serde_json::json;
use uuid::Uuid;

const KIRO_PROVIDER_NAME: &str = "kiro";

pub(crate) struct LimeKiroProvider {
    credential_path: String,
    model: ModelConfig,
    name: String,
}

impl LimeKiroProvider {
    pub(crate) fn new(
        credential_path: impl Into<String>,
        model: ModelConfig,
    ) -> Result<Self, ProviderError> {
        let credential_path = credential_path.into();
        if credential_path.trim().is_empty() {
            return Err(ProviderError::ExecutionError(
                "Kiro provider 缺少 credential_path".to_string(),
            ));
        }

        Ok(Self {
            credential_path,
            model,
            name: KIRO_PROVIDER_NAME.to_string(),
        })
    }

    async fn load_provider(&self) -> Result<KiroProvider, ProviderError> {
        let mut provider = KiroProvider::new();
        provider
            .load_credentials_from_path(&self.credential_path)
            .await
            .map_err(|error| {
                ProviderError::Authentication(format!("加载 Kiro 凭证失败: {}", error))
            })?;

        provider.ensure_valid_token().await.map_err(|error| {
            ProviderError::Authentication(format!("刷新 Kiro Token 失败: {}", error))
        })?;

        Ok(provider)
    }

    fn normalize_optional_text(value: Option<&str>) -> Option<String> {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn resolve_conversation_id_from_turn_context() -> Option<String> {
        let turn_context = current_turn_context()?;
        let provider_continuation = turn_context
            .metadata
            .get("provider_continuation")?
            .as_object()?;

        if provider_continuation
            .get("enabled")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        {
            return None;
        }

        if provider_continuation
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            != Some("provider_session_token")
        {
            return None;
        }

        for key in [
            "session_token",
            "sessionToken",
            "provider_session_token",
            "providerSessionToken",
            "conversation_id",
            "conversationId",
        ] {
            if let Some(value) = Self::normalize_optional_text(
                provider_continuation
                    .get(key)
                    .and_then(serde_json::Value::as_str),
            ) {
                return Some(value);
            }
        }

        None
    }

    fn resolve_or_create_conversation_id() -> String {
        Self::resolve_conversation_id_from_turn_context()
            .unwrap_or_else(|| Uuid::new_v4().to_string())
    }

    fn build_chat_request(
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
        stream: bool,
    ) -> Result<ChatCompletionRequest, ProviderError> {
        let mut openai_messages = vec![json!({
            "role": "system",
            "content": system,
        })];
        openai_messages.extend(format_messages(messages, &ImageFormat::OpenAi));

        let tools_payload = format_tools(tools)
            .map_err(|error| ProviderError::ExecutionError(error.to_string()))?;

        let mut payload = json!({
            "model": model_config.model_name,
            "messages": openai_messages,
            "stream": stream,
        });

        if !tools_payload.is_empty() {
            payload["tools"] = json!(tools_payload);
        }

        serde_json::from_value(payload).map_err(|error| {
            ProviderError::ExecutionError(format!(
                "构造 Kiro ChatCompletionRequest 失败: {}",
                error
            ))
        })
    }

    fn attach_conversation_id(mut message: Message, conversation_id: &str) -> Message {
        if message.role == Role::Assistant {
            message.id = Some(conversation_id.to_string());
        }
        message
    }

    fn push_or_merge_content(target: &mut Vec<MessageContent>, content: MessageContent) {
        match (target.last_mut(), &content) {
            (Some(MessageContent::Text(existing)), MessageContent::Text(incoming)) => {
                existing.text.push_str(&incoming.text);
            }
            (Some(MessageContent::Thinking(existing)), MessageContent::Thinking(incoming)) => {
                existing.thinking.push_str(&incoming.thinking);
            }
            _ => target.push(content),
        }
    }

    fn merge_message_chunk(target: &mut Message, chunk: Message) {
        if target.id.is_none() {
            target.id = chunk.id.clone();
        }

        for content in chunk.content {
            Self::push_or_merge_content(&mut target.content, content);
        }
    }

    async fn stream_with_model_and_conversation(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
        conversation_id: String,
    ) -> Result<MessageStream, ProviderError> {
        let request = Self::build_chat_request(model_config, system, messages, tools, true)?;
        let provider = self.load_provider().await?;
        let source_stream = provider
            .call_api_stream_with_conversation_id(&request, Some(&conversation_id))
            .await
            .map_err(Self::map_lime_provider_error)?;

        let model_name = model_config.model_name.clone();
        let openai_line_stream = Box::pin(try_stream! {
            let mut source_stream = source_stream;
            let mut converter = StreamConverter::with_model(
                LimeStreamFormat::AwsEventStream,
                LimeStreamFormat::OpenAiSse,
                &model_name,
            );

            while let Some(chunk) = source_stream.next().await {
                let chunk = chunk.map_err(|error| anyhow!(error.to_string()))?;
                for event in converter.convert(&chunk) {
                    for line in event.lines() {
                        let line = line.trim_end_matches('\r');
                        if !line.is_empty() {
                            yield line.to_string();
                        }
                    }
                }
            }

            for event in converter.finish() {
                for line in event.lines() {
                    let line = line.trim_end_matches('\r');
                    if !line.is_empty() {
                        yield line.to_string();
                    }
                }
            }
        });

        Ok(Box::pin(try_stream! {
            let message_stream = response_to_streaming_message(openai_line_stream);
            pin_mut!(message_stream);

            while let Some(item) = message_stream.next().await {
                let (message, usage) = item.map_err(|error| {
                    ProviderError::RequestFailed(format!("解析 Kiro 流式响应失败: {}", error))
                })?;

                let message = message.map(|message| {
                    Self::attach_conversation_id(message, &conversation_id)
                });

                yield (message, usage);
            }
        }))
    }

    fn map_lime_provider_error(error: lime_providers::providers::ProviderError) -> ProviderError {
        match error {
            lime_providers::providers::ProviderError::AuthenticationError(details) => {
                ProviderError::Authentication(details)
            }
            lime_providers::providers::ProviderError::RateLimitError(details) => {
                ProviderError::RateLimitExceeded {
                    details,
                    retry_delay: None,
                }
            }
            lime_providers::providers::ProviderError::ServerError(details) => {
                ProviderError::ServerError(details)
            }
            lime_providers::providers::ProviderError::RequestError(details) => {
                ProviderError::RequestFailed(details)
            }
            lime_providers::providers::ProviderError::ParseError(details)
            | lime_providers::providers::ProviderError::ConfigurationError(details)
            | lime_providers::providers::ProviderError::Unknown(details)
            | lime_providers::providers::ProviderError::TokenExpired(details)
            | lime_providers::providers::ProviderError::NetworkError(details) => {
                ProviderError::ExecutionError(details)
            }
        }
    }
}

#[async_trait]
impl Provider for LimeKiroProvider {
    fn metadata() -> ProviderMetadata
    where
        Self: Sized,
    {
        ProviderMetadata::with_models(
            KIRO_PROVIDER_NAME,
            "Kiro",
            "Lime 本地 Kiro/CodeWhisperer Provider 适配器",
            "claude-sonnet-4-5",
            vec![ModelInfo::new("claude-sonnet-4-5", 200_000)],
            "",
            vec![ConfigKey::new("KIRO_CREDENTIAL_PATH", true, true, None)],
        )
    }

    fn get_name(&self) -> &str {
        &self.name
    }

    async fn complete_with_model(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        let conversation_id = Self::resolve_or_create_conversation_id();
        let mut stream = self
            .stream_with_model_and_conversation(
                model_config,
                system,
                messages,
                tools,
                conversation_id.clone(),
            )
            .await?;

        let mut final_message = Message::assistant().with_id(conversation_id.clone());
        let mut final_usage = None;

        while let Some(item) = stream.next().await {
            let (message, usage) = item?;
            if let Some(message) = message {
                Self::merge_message_chunk(&mut final_message, message);
            }
            if usage.is_some() {
                final_usage = usage;
            }
        }

        let usage = final_usage.unwrap_or_else(|| {
            ProviderUsage::new(model_config.model_name.clone(), Usage::default())
        });

        Ok((final_message, usage))
    }

    fn get_model_config(&self) -> ModelConfig {
        self.model.clone()
    }

    async fn stream(
        &self,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        let conversation_id = Self::resolve_or_create_conversation_id();
        self.stream_with_model_and_conversation(
            &self.model,
            system,
            messages,
            tools,
            conversation_id,
        )
        .await
    }

    fn supports_streaming(&self) -> bool {
        true
    }
}
