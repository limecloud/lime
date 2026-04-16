//! API Key Provider 相关公共工具
//!
//! 统一 provider_id 候选映射和鉴权请求头构建，避免各 handler 规则漂移。

use lime_core::database::dao::api_key_provider::{
    infer_managed_runtime_spec, ApiProviderType, ProviderProtocolFamily,
};

/// 收集 API Key Provider ID 候选列表（按优先级）
///
/// 策略：
/// 1. 优先使用请求方显式传入的 provider_type（支持 custom-* / new-api / gateway）
/// 2. 再尝试别名归一化（如 claude -> anthropic）
/// 3. 最后按协议族回退（如 new-api -> openai）
pub(crate) fn collect_api_key_provider_ids(provider_type: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut push_unique = |candidate: String| {
        if !candidate.is_empty() && !ids.iter().any(|id| id == &candidate) {
            ids.push(candidate);
        }
    };

    let normalized = provider_type.trim().to_lowercase();
    push_unique(normalized.clone());
    if normalized.contains('_') {
        push_unique(normalized.replace('_', "-"));
    }

    let parsed = normalized
        .parse::<ApiProviderType>()
        .or_else(|_| normalized.replace('_', "-").parse::<ApiProviderType>());

    if let Ok(api_type) = parsed {
        push_unique(api_type.to_string());
        let family_fallback = match api_type.runtime_spec().protocol_family {
            ProviderProtocolFamily::Anthropic => "anthropic",
            ProviderProtocolFamily::Gemini => "gemini",
            ProviderProtocolFamily::AzureOpenai => "azure-openai",
            ProviderProtocolFamily::Vertexai => "vertexai",
            ProviderProtocolFamily::AwsBedrock => "aws-bedrock",
            ProviderProtocolFamily::Ollama => "ollama",
            ProviderProtocolFamily::OpenAiCompatible | ProviderProtocolFamily::Codex => "openai",
        };
        push_unique(family_fallback.to_string());
        return ids;
    }

    match normalized.as_str() {
        "gpt" => push_unique("openai".to_string()),
        "claude" => push_unique("anthropic".to_string()),
        "google" => push_unique("gemini".to_string()),
        "azure" | "azure_openai" => push_unique("azure-openai".to_string()),
        "vertex" => push_unique("vertexai".to_string()),
        "bedrock" | "aws_bedrock" => push_unique("aws-bedrock".to_string()),
        _ => {}
    }

    ids
}

/// 根据 API Provider 类型构建额外请求头
pub(crate) fn build_api_key_headers(
    provider_type: &ApiProviderType,
    api_host: &str,
    api_key: &str,
) -> std::collections::HashMap<String, String> {
    let mut headers = std::collections::HashMap::new();

    let spec = infer_managed_runtime_spec(*provider_type, api_host);
    let auth_value = match spec.auth_prefix {
        Some(prefix) => format!("{prefix} {api_key}"),
        None => api_key.to_string(),
    };
    headers.insert(spec.auth_header.to_string(), auth_value);

    for (key, value) in spec.extra_headers {
        headers.insert((*key).to_string(), (*value).to_string());
    }

    headers
}

#[cfg(test)]
mod tests {
    use super::{build_api_key_headers, collect_api_key_provider_ids};
    use lime_core::database::dao::api_key_provider::ApiProviderType;

    #[test]
    fn test_collect_api_key_provider_ids_keeps_specific_before_family_fallback() {
        assert_eq!(
            collect_api_key_provider_ids("new-api"),
            vec!["new-api".to_string(), "openai".to_string()]
        );
        assert_eq!(
            collect_api_key_provider_ids("gateway"),
            vec!["gateway".to_string(), "openai".to_string()]
        );
    }

    #[test]
    fn test_collect_api_key_provider_ids_anthropic_compatible_has_anthropic_fallback() {
        assert_eq!(
            collect_api_key_provider_ids("anthropic-compatible"),
            vec!["anthropic-compatible".to_string(), "anthropic".to_string()]
        );
    }

    #[test]
    fn test_collect_api_key_provider_ids_custom_keeps_exact_only() {
        assert_eq!(
            collect_api_key_provider_ids("custom-a32774c6-6fd0-433b-8b81-e95340e08793"),
            vec!["custom-a32774c6-6fd0-433b-8b81-e95340e08793".to_string()]
        );
    }

    #[test]
    fn test_build_api_key_headers_supports_anthropic_compatible() {
        let headers = build_api_key_headers(
            &ApiProviderType::AnthropicCompatible,
            "https://api.minimaxi.com/anthropic",
            "test-key",
        );
        assert_eq!(
            headers.get("Authorization"),
            Some(&"Bearer test-key".to_string())
        );
        assert_eq!(
            headers.get("anthropic-version"),
            Some(&"2023-06-01".to_string())
        );
        assert!(!headers.contains_key("x-api-key"));
    }

    #[test]
    fn test_build_api_key_headers_keeps_x_api_key_for_official_anthropic() {
        let headers = build_api_key_headers(
            &ApiProviderType::Anthropic,
            "https://api.anthropic.com",
            "test-key",
        );
        assert_eq!(headers.get("x-api-key"), Some(&"test-key".to_string()));
        assert!(!headers.contains_key("Authorization"));
    }
}
