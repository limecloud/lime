//! Lime LLM Provider 实现
//!
//! 使用 ProviderPoolService 选择凭证并调用 LLM API。
//! trait 定义（LlmProvider, SkillError）已迁移到 lime-skills crate。

use std::sync::Arc;

use async_trait::async_trait;

use lime_core::database::DbConnection;
use lime_core::models::anthropic::AnthropicMessagesRequest;
#[cfg(test)]
use lime_core::models::provider_pool_model::PoolProviderType;
use lime_core::models::provider_pool_model::{CredentialData, ProviderCredential};
use lime_providers::providers::claude_custom::{ClaudeCustomProvider, PromptCacheMode};
use lime_providers::providers::kiro::KiroProvider;
use lime_providers::providers::openai_custom::OpenAICustomProvider;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use lime_services::provider_pool_service::ProviderPoolService;

use crate::{LlmProvider, SkillError};

/// Lime LLM Provider
///
/// 使用 ProviderPoolService 选择凭证并调用 LLM API。
/// 实现 aster-rust 定义的 LlmProvider trait。
pub struct LimeLlmProvider {
    /// 凭证池服务
    pool_service: Arc<ProviderPoolService>,
    /// API Key Provider 服务（用于智能降级）
    api_key_service: Arc<ApiKeyProviderService>,
    /// 数据库连接
    db: DbConnection,
    /// 偏好的 Provider 类型（可选）
    preferred_provider: Option<String>,
}

impl LimeLlmProvider {
    /// 创建新的 LimeLlmProvider 实例
    ///
    /// # Arguments
    /// * `pool_service` - 凭证池服务
    /// * `api_key_service` - API Key 服务
    /// * `db` - 数据库连接
    pub fn new(
        pool_service: Arc<ProviderPoolService>,
        api_key_service: Arc<ApiKeyProviderService>,
        db: DbConnection,
    ) -> Self {
        Self {
            pool_service,
            api_key_service,
            db,
            preferred_provider: None,
        }
    }

    /// 创建带有偏好 Provider 的实例
    ///
    /// # Arguments
    /// * `pool_service` - 凭证池服务
    /// * `api_key_service` - API Key 服务
    /// * `db` - 数据库连接
    /// * `preferred_provider` - 偏好的 Provider 类型
    pub fn with_preferred_provider(
        pool_service: Arc<ProviderPoolService>,
        api_key_service: Arc<ApiKeyProviderService>,
        db: DbConnection,
        preferred_provider: String,
    ) -> Self {
        Self {
            pool_service,
            api_key_service,
            db,
            preferred_provider: Some(preferred_provider),
        }
    }

    /// 设置偏好的 Provider 类型
    pub fn set_preferred_provider(&mut self, provider: Option<String>) {
        self.preferred_provider = provider;
    }

    /// 获取偏好的 Provider 类型
    pub fn preferred_provider(&self) -> Option<&str> {
        self.preferred_provider.as_deref()
    }

    /// 将 Skill 的 provider 字段映射到 PoolProviderType
    ///
    /// # Arguments
    /// * `provider` - Provider 名称字符串
    ///
    /// # Returns
    /// 对应的 PoolProviderType，未知类型返回 None
    #[cfg(test)]
    fn map_skill_provider_to_pool_type(provider: &str) -> Option<PoolProviderType> {
        match provider.to_lowercase().as_str() {
            "openai" | "gpt" => Some(PoolProviderType::OpenAI),
            "anthropic" | "claude" => Some(PoolProviderType::Claude),
            "gemini" | "google" => Some(PoolProviderType::Gemini),
            "kiro" | "codewhisperer" => Some(PoolProviderType::Kiro),
            "vertex" => Some(PoolProviderType::Vertex),
            "codex" => Some(PoolProviderType::Codex),
            _ => None,
        }
    }

    /// 根据凭证调用 LLM API
    ///
    /// # Arguments
    /// * `credential` - 选中的凭证
    /// * `system_prompt` - 系统提示词
    /// * `user_message` - 用户消息
    /// * `model` - 模型名称
    ///
    /// # Returns
    /// LLM 响应文本或错误
    async fn call_llm_with_credential(
        &self,
        credential: &ProviderCredential,
        system_prompt: &str,
        user_message: &str,
        model: &str,
    ) -> Result<String, SkillError> {
        match &credential.credential {
            CredentialData::KiroOAuth { creds_file_path } => {
                self.call_kiro_api(creds_file_path, system_prompt, user_message, model)
                    .await
            }
            CredentialData::ClaudeKey { api_key, base_url } => {
                self.call_claude_api(
                    api_key,
                    base_url.as_deref(),
                    if matches!(
                        credential.effective_prompt_cache_mode(),
                        Some(lime_core::models::ProviderPromptCacheMode::Automatic)
                    ) {
                        PromptCacheMode::Automatic
                    } else {
                        PromptCacheMode::ExplicitOnly
                    },
                    system_prompt,
                    user_message,
                    model,
                )
                .await
            }
            CredentialData::OpenAIKey { api_key, base_url } => {
                self.call_openai_api(
                    api_key,
                    base_url.as_deref(),
                    system_prompt,
                    user_message,
                    model,
                )
                .await
            }
            CredentialData::AnthropicKey { api_key, base_url } => {
                // Anthropic API Key 使用 Claude API
                self.call_claude_api(
                    api_key,
                    base_url.as_deref(),
                    if matches!(
                        credential.effective_prompt_cache_mode(),
                        Some(lime_core::models::ProviderPromptCacheMode::Automatic)
                    ) {
                        PromptCacheMode::Automatic
                    } else {
                        PromptCacheMode::ExplicitOnly
                    },
                    system_prompt,
                    user_message,
                    model,
                )
                .await
            }
            _ => Err(SkillError::ProviderError(format!(
                "不支持的凭证类型: {:?}",
                credential.provider_type
            ))),
        }
    }

    /// 调用 Kiro API
    async fn call_kiro_api(
        &self,
        creds_file_path: &str,
        system_prompt: &str,
        user_message: &str,
        model: &str,
    ) -> Result<String, SkillError> {
        use lime_core::models::anthropic::AnthropicMessage;
        use lime_providers::converter::anthropic_to_openai::convert_anthropic_to_openai;
        use lime_providers::providers::traits::CredentialProvider;
        use lime_server_utils::parse_cw_response;

        let mut kiro = KiroProvider::new();
        kiro.load_credentials_from_path(creds_file_path)
            .await
            .map_err(|e| SkillError::ProviderError(format!("加载 Kiro 凭证失败: {}", e)))?;

        // 确保 Token 有效
        if !kiro.is_token_valid() || kiro.is_token_expiring_soon() {
            kiro.refresh_token()
                .await
                .map_err(|e| SkillError::ProviderError(format!("刷新 Token 失败: {}", e)))?;
        }

        // 构建 Anthropic 请求
        let request = AnthropicMessagesRequest {
            model: model.to_string(),
            max_tokens: Some(4096),
            system: Some(serde_json::Value::String(system_prompt.to_string())),
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: serde_json::Value::String(user_message.to_string()),
            }],
            stream: false,
            temperature: None,
            tools: None,
            tool_choice: None,
        };

        // 转换为 OpenAI 格式并调用
        let openai_request = convert_anthropic_to_openai(&request);
        let resp = kiro
            .call_api(&openai_request)
            .await
            .map_err(|e| SkillError::ProviderError(format!("Kiro API 调用失败: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(SkillError::ProviderError(format!(
                "Kiro API 返回错误: status={}, body={}",
                status, body
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| SkillError::ProviderError(format!("读取响应失败: {}", e)))?;
        let body = String::from_utf8_lossy(&bytes).to_string();
        let parsed = parse_cw_response(&body);

        Ok(parsed.content)
    }

    /// 调用 Claude API
    async fn call_claude_api(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        prompt_cache_mode: PromptCacheMode,
        system_prompt: &str,
        user_message: &str,
        model: &str,
    ) -> Result<String, SkillError> {
        use lime_core::models::anthropic::AnthropicMessage;

        let claude = ClaudeCustomProvider::with_prompt_cache_mode(
            api_key.to_string(),
            base_url.map(|s| s.to_string()),
            prompt_cache_mode,
        );

        // 构建 Anthropic 请求
        let request = AnthropicMessagesRequest {
            model: model.to_string(),
            max_tokens: Some(4096),
            system: Some(serde_json::Value::String(system_prompt.to_string())),
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: serde_json::Value::String(user_message.to_string()),
            }],
            stream: false,
            temperature: None,
            tools: None,
            tool_choice: None,
        };

        let resp = claude
            .call_api(&request)
            .await
            .map_err(|e| SkillError::ProviderError(format!("Claude API 调用失败: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(SkillError::ProviderError(format!(
                "Claude API 返回错误: status={}, body={}",
                status, body
            )));
        }

        let body = resp
            .text()
            .await
            .map_err(|e| SkillError::ProviderError(format!("读取响应失败: {}", e)))?;

        // 解析 Anthropic 响应
        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| SkillError::ProviderError(format!("解析响应失败: {}", e)))?;

        // 提取文本内容
        let content = json["content"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|block| block["text"].as_str())
            .unwrap_or("");

        Ok(content.to_string())
    }

    /// 调用 OpenAI API
    async fn call_openai_api(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        system_prompt: &str,
        user_message: &str,
        model: &str,
    ) -> Result<String, SkillError> {
        use lime_core::models::openai::{ChatCompletionRequest, ChatMessage, MessageContent};

        let openai =
            OpenAICustomProvider::with_config(api_key.to_string(), base_url.map(|s| s.to_string()));

        // 构建 OpenAI 请求
        let request = ChatCompletionRequest {
            model: model.to_string(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: Some(MessageContent::Text(system_prompt.to_string())),
                    tool_calls: None,
                    tool_call_id: None,
                    reasoning_content: None,
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: Some(MessageContent::Text(user_message.to_string())),
                    tool_calls: None,
                    tool_call_id: None,
                    reasoning_content: None,
                },
            ],
            max_tokens: Some(4096),
            stream: false,
            temperature: None,
            top_p: None,
            tools: None,
            tool_choice: None,
            reasoning_effort: None,
        };

        let resp = openai
            .call_api(&request)
            .await
            .map_err(|e| SkillError::ProviderError(format!("OpenAI API 调用失败: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(SkillError::ProviderError(format!(
                "OpenAI API 返回错误: status={}, body={}",
                status, body
            )));
        }

        let body = resp
            .text()
            .await
            .map_err(|e| SkillError::ProviderError(format!("读取响应失败: {}", e)))?;

        // 解析 OpenAI 响应
        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| SkillError::ProviderError(format!("解析响应失败: {}", e)))?;

        // 提取文本内容
        let content = json["choices"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|choice| choice["message"]["content"].as_str())
            .unwrap_or("");

        Ok(content.to_string())
    }
}

#[async_trait]
impl LlmProvider for LimeLlmProvider {
    /// 调用 LLM 进行对话
    ///
    /// # 实现说明
    /// 1. 使用 ProviderPoolService.select_credential_with_fallback() 选择凭证
    /// 2. 如果指定了 preferred_provider，优先选择该类型的凭证
    /// 3. 如果指定了 model，传递给底层 provider
    /// 4. 如果没有可用凭证，返回 ProviderError
    ///
    /// # Requirements
    /// - 1.2: 使用 ProviderPoolService 选择可用凭证
    /// - 1.3: 优先选择指定 provider 类型的凭证
    /// - 1.4: 将 model 参数传递给底层 provider
    /// - 1.5: 没有可用凭证时返回 ProviderError
    async fn chat(
        &self,
        system_prompt: &str,
        user_message: &str,
        model: Option<&str>,
    ) -> Result<String, SkillError> {
        // 确定要使用的 provider 类型
        let provider_type = self.preferred_provider.as_deref().unwrap_or("claude"); // 默认使用 Claude

        // 确定要使用的模型
        let model_name = model.unwrap_or("claude-sonnet-4-5-20250514");

        tracing::info!(
            "[LimeLlmProvider] chat 调用: provider_type={}, model={}",
            provider_type,
            model_name
        );

        // 使用 ProviderPoolService 选择凭证（Requirements 1.2, 1.3）
        let credential = self
            .pool_service
            .select_credential_with_fallback(
                &self.db,
                &self.api_key_service,
                provider_type,
                Some(model_name),
                None, // provider_id_hint
                None, // client_type
            )
            .await
            .map_err(|e| SkillError::ProviderError(format!("选择凭证失败: {}", e)))?
            .ok_or_else(|| {
                // Requirements 1.5: 没有可用凭证时返回 ProviderError
                SkillError::ProviderError(format!(
                    "没有可用的凭证: provider_type={}, model={}",
                    provider_type, model_name
                ))
            })?;

        tracing::info!(
            "[LimeLlmProvider] 选中凭证: uuid={}, type={:?}",
            &credential.uuid[..8],
            credential.provider_type
        );

        // 调用 LLM API（Requirements 1.4: 传递 model 参数）
        let result = self
            .call_llm_with_credential(&credential, system_prompt, user_message, model_name)
            .await;

        // 记录使用情况
        match &result {
            Ok(_) => {
                let _ = self.pool_service.record_usage(&self.db, &credential.uuid);
                let _ =
                    self.pool_service
                        .mark_healthy(&self.db, &credential.uuid, Some(model_name));
            }
            Err(e) => {
                let _ = self.pool_service.mark_unhealthy(
                    &self.db,
                    &credential.uuid,
                    Some(&e.to_string()),
                );
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_skill_provider_openai() {
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("openai"),
            Some(PoolProviderType::OpenAI)
        );
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("gpt"),
            Some(PoolProviderType::OpenAI)
        );
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("OPENAI"),
            Some(PoolProviderType::OpenAI)
        );
    }

    #[test]
    fn test_map_skill_provider_claude() {
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("claude"),
            Some(PoolProviderType::Claude)
        );
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("anthropic"),
            Some(PoolProviderType::Claude)
        );
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("CLAUDE"),
            Some(PoolProviderType::Claude)
        );
    }

    #[test]
    fn test_map_skill_provider_gemini() {
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("gemini"),
            Some(PoolProviderType::Gemini)
        );
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("google"),
            Some(PoolProviderType::Gemini)
        );
    }

    #[test]
    fn test_map_skill_provider_kiro() {
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("kiro"),
            Some(PoolProviderType::Kiro)
        );
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("codewhisperer"),
            Some(PoolProviderType::Kiro)
        );
    }

    #[test]
    fn test_map_skill_provider_unknown() {
        assert_eq!(
            LimeLlmProvider::map_skill_provider_to_pool_type("unknown_provider"),
            None
        );
        assert_eq!(LimeLlmProvider::map_skill_provider_to_pool_type(""), None);
    }

    #[test]
    fn test_skill_error_display() {
        let provider_err = SkillError::ProviderError("没有可用凭证".to_string());
        assert!(provider_err.to_string().contains("Provider error"));
        assert!(provider_err.to_string().contains("没有可用凭证"));

        let exec_err = SkillError::ExecutionError("执行失败".to_string());
        assert!(exec_err.to_string().contains("Execution error"));

        let config_err = SkillError::ConfigError("配置错误".to_string());
        assert!(config_err.to_string().contains("Config error"));
    }
}
