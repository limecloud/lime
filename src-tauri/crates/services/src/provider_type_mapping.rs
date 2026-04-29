//! Provider 类型映射与解析工具
//!
//! 统一 API Key Provider 主路径中历史 ProviderType 与 ApiProviderType 的映射规则。

use lime_core::database::dao::api_key_provider::ApiProviderType;
use lime_core::models::provider_type::is_custom_provider_id as core_is_custom_provider_id;
use lime_core::models::RuntimeProviderType;

/// 是否为自定义 Provider ID（`custom-*`）
pub(crate) fn is_custom_provider_id(provider_type: &str) -> bool {
    core_is_custom_provider_id(provider_type)
}

/// 是否为已退役的旧凭证来源标签。
pub(crate) fn is_retired_credential_provider_label(provider_type: &str) -> bool {
    matches!(
        provider_type.trim().to_lowercase().as_str(),
        "kiro" | "gemini" | "codex" | "claude_oauth"
    )
}

/// 解析运行时 Provider 类型。
///
/// 未知第三方 Provider 仍按 OpenAI 兼容处理；已退役的旧凭证池 Provider 类型不再
/// 回退到 API Key Provider 类型映射，避免把 OAuth / 本地 CLI 心智带回运行时。
pub(crate) fn resolve_runtime_provider_type(provider_type: &str) -> Option<RuntimeProviderType> {
    if is_retired_credential_provider_label(provider_type) {
        return None;
    }

    Some(provider_type.parse().unwrap_or(RuntimeProviderType::OpenAI))
}

/// ApiProviderType → RuntimeProviderType 映射
pub(crate) fn api_provider_type_to_runtime_provider_type(
    api_type: ApiProviderType,
) -> RuntimeProviderType {
    match api_type {
        ApiProviderType::Anthropic => RuntimeProviderType::Claude,
        ApiProviderType::AnthropicCompatible => RuntimeProviderType::AnthropicCompatible,
        ApiProviderType::Gemini => RuntimeProviderType::GeminiApiKey,
        ApiProviderType::Vertexai => RuntimeProviderType::Vertex,
        ApiProviderType::AzureOpenai => RuntimeProviderType::AzureOpenai,
        ApiProviderType::AwsBedrock => RuntimeProviderType::AwsBedrock,
        ApiProviderType::Ollama => RuntimeProviderType::Ollama,
        _ => RuntimeProviderType::OpenAI,
    }
}

/// RuntimeProviderType → ApiProviderType 映射
pub(crate) fn runtime_provider_type_to_api_type(
    runtime_provider_type: &RuntimeProviderType,
) -> ApiProviderType {
    match runtime_provider_type {
        // API Key 类型 - 直接映射
        RuntimeProviderType::Claude => ApiProviderType::Anthropic,
        RuntimeProviderType::OpenAI => ApiProviderType::Openai,
        RuntimeProviderType::GeminiApiKey => ApiProviderType::Gemini,
        RuntimeProviderType::Vertex => ApiProviderType::Vertexai,

        // API Key Provider 类型 - 直接映射
        RuntimeProviderType::Anthropic => ApiProviderType::Anthropic,
        RuntimeProviderType::AnthropicCompatible => ApiProviderType::AnthropicCompatible,
        RuntimeProviderType::AzureOpenai => ApiProviderType::AzureOpenai,
        RuntimeProviderType::AwsBedrock => ApiProviderType::AwsBedrock,
        RuntimeProviderType::Ollama => ApiProviderType::Ollama,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        api_provider_type_to_runtime_provider_type, is_custom_provider_id,
        is_retired_credential_provider_label, resolve_runtime_provider_type,
        runtime_provider_type_to_api_type,
    };
    use lime_core::database::dao::api_key_provider::ApiProviderType;
    use lime_core::models::RuntimeProviderType;

    #[test]
    fn test_api_provider_type_to_runtime_provider_type_mapping() {
        assert_eq!(
            api_provider_type_to_runtime_provider_type(ApiProviderType::Anthropic),
            RuntimeProviderType::Claude
        );
        assert_eq!(
            api_provider_type_to_runtime_provider_type(ApiProviderType::AnthropicCompatible),
            RuntimeProviderType::AnthropicCompatible
        );
        assert_eq!(
            api_provider_type_to_runtime_provider_type(ApiProviderType::Gemini),
            RuntimeProviderType::GeminiApiKey
        );
        assert_eq!(
            api_provider_type_to_runtime_provider_type(ApiProviderType::Openai),
            RuntimeProviderType::OpenAI
        );
    }

    #[test]
    fn test_runtime_provider_type_to_api_type_mapping() {
        assert_eq!(
            runtime_provider_type_to_api_type(&RuntimeProviderType::Claude),
            ApiProviderType::Anthropic
        );
        assert_eq!(
            runtime_provider_type_to_api_type(&RuntimeProviderType::AnthropicCompatible),
            ApiProviderType::AnthropicCompatible
        );
        assert_eq!(
            runtime_provider_type_to_api_type(&RuntimeProviderType::GeminiApiKey),
            ApiProviderType::Gemini
        );
    }

    #[test]
    fn test_runtime_provider_type_parser_helpers() {
        assert_eq!(
            resolve_runtime_provider_type("not-exists"),
            Some(RuntimeProviderType::OpenAI)
        );
        assert_eq!(
            resolve_runtime_provider_type("qwen"),
            Some(RuntimeProviderType::OpenAI)
        );
        assert_eq!(
            resolve_runtime_provider_type("gemini_api_key"),
            Some(RuntimeProviderType::GeminiApiKey)
        );
        assert_eq!(resolve_runtime_provider_type("kiro"), None);
        assert_eq!(resolve_runtime_provider_type("gemini"), None);
        assert_eq!(resolve_runtime_provider_type("codex"), None);
        assert_eq!(resolve_runtime_provider_type("claude_oauth"), None);
        assert!(is_retired_credential_provider_label("Kiro"));
    }

    #[test]
    fn test_is_custom_provider_id() {
        assert!(is_custom_provider_id(
            "custom-a32774c6-6fd0-433b-8b81-e95340e08793"
        ));
        assert!(!is_custom_provider_id("openai"));
    }
}
