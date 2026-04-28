//! Provider 类型映射与解析工具
//!
//! 统一 API Key Provider 主路径中历史 ProviderType 与 ApiProviderType 的映射规则。

use lime_core::database::dao::api_key_provider::ApiProviderType;
use lime_core::models::provider_pool_model::PoolProviderType;
use lime_core::models::provider_type::is_custom_provider_id as core_is_custom_provider_id;

/// 是否为自定义 Provider ID（`custom-*`）
pub(crate) fn is_custom_provider_id(provider_type: &str) -> bool {
    core_is_custom_provider_id(provider_type)
}

/// 解析 PoolProviderType（失败时回退到 OpenAI）
pub(crate) fn resolve_pool_provider_type_or_default(provider_type: &str) -> PoolProviderType {
    provider_type.parse().unwrap_or(PoolProviderType::OpenAI)
}

/// ApiProviderType → PoolProviderType 映射
pub(crate) fn api_provider_type_to_pool_type(api_type: ApiProviderType) -> PoolProviderType {
    match api_type {
        ApiProviderType::Anthropic => PoolProviderType::Claude,
        ApiProviderType::AnthropicCompatible => PoolProviderType::AnthropicCompatible,
        ApiProviderType::Gemini => PoolProviderType::GeminiApiKey,
        ApiProviderType::Vertexai => PoolProviderType::Vertex,
        ApiProviderType::AzureOpenai => PoolProviderType::AzureOpenai,
        ApiProviderType::AwsBedrock => PoolProviderType::AwsBedrock,
        ApiProviderType::Ollama => PoolProviderType::Ollama,
        _ => PoolProviderType::OpenAI,
    }
}

/// PoolProviderType → ApiProviderType 映射
pub(crate) fn pool_provider_type_to_api_type(
    pool_type: &PoolProviderType,
) -> Option<ApiProviderType> {
    match pool_type {
        // API Key 类型 - 直接映射
        PoolProviderType::Claude => Some(ApiProviderType::Anthropic),
        PoolProviderType::OpenAI => Some(ApiProviderType::Openai),
        PoolProviderType::GeminiApiKey => Some(ApiProviderType::Gemini),
        PoolProviderType::Vertex => Some(ApiProviderType::Vertexai),

        // API Key Provider 类型 - 直接映射
        PoolProviderType::Anthropic => Some(ApiProviderType::Anthropic),
        PoolProviderType::AnthropicCompatible => Some(ApiProviderType::AnthropicCompatible),
        PoolProviderType::AzureOpenai => Some(ApiProviderType::AzureOpenai),
        PoolProviderType::AwsBedrock => Some(ApiProviderType::AwsBedrock),
        PoolProviderType::Ollama => Some(ApiProviderType::Ollama),

        // 已退役的凭证池 / OAuth 类型不再自动映射到 API Key Provider。
        PoolProviderType::Kiro
        | PoolProviderType::Gemini
        | PoolProviderType::Codex
        | PoolProviderType::ClaudeOAuth => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        api_provider_type_to_pool_type, is_custom_provider_id, pool_provider_type_to_api_type,
        resolve_pool_provider_type_or_default,
    };
    use lime_core::database::dao::api_key_provider::ApiProviderType;
    use lime_core::models::provider_pool_model::PoolProviderType;

    #[test]
    fn test_api_provider_type_to_pool_type_mapping() {
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::Anthropic),
            PoolProviderType::Claude
        );
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::AnthropicCompatible),
            PoolProviderType::AnthropicCompatible
        );
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::Gemini),
            PoolProviderType::GeminiApiKey
        );
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::Openai),
            PoolProviderType::OpenAI
        );
    }

    #[test]
    fn test_pool_provider_type_to_api_type_mapping() {
        assert_eq!(
            pool_provider_type_to_api_type(&PoolProviderType::Claude),
            Some(ApiProviderType::Anthropic)
        );
        assert_eq!(
            pool_provider_type_to_api_type(&PoolProviderType::AnthropicCompatible),
            Some(ApiProviderType::AnthropicCompatible)
        );
        assert_eq!(
            pool_provider_type_to_api_type(&PoolProviderType::Kiro),
            None
        );
    }

    #[test]
    fn test_pool_provider_type_parser_helpers() {
        assert_eq!(
            resolve_pool_provider_type_or_default("not-exists"),
            PoolProviderType::OpenAI
        );
    }

    #[test]
    fn test_is_custom_provider_id() {
        assert!(is_custom_provider_id(
            "custom-a32774c6-6fd0-433b-8b81-e95340e08793"
        ));
        assert!(!is_custom_provider_id("openai"));
    }
}
