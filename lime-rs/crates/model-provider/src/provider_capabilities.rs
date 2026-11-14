use crate::runtime_provider::{RuntimeProviderConfig, RuntimeProviderProtocol};
use app_server_protocol::ProtocolKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderCapabilities {
    pub namespace_tools: bool,
    pub custom_tools: bool,
    pub image_generation: bool,
    pub web_search: bool,
    /// 当前 provider 路由是否已接入实时语音 wire。
    ///
    /// 这不是按 provider 品牌或模型名推断的开关：只有 model-provider 中
    /// 存在真实的实时语音适配器，并且 catalog 显式声明了相应能力时才可为
    /// `true`。目前没有任何适配器实现实时语音 wire，因此所有路由都必须为
    /// `false`，Voice 设置页只能显示不可用状态，不得伪造开始/停止控制。
    pub realtime: bool,
}

impl ProviderCapabilities {
    pub const NONE: Self = Self {
        namespace_tools: false,
        custom_tools: false,
        image_generation: false,
        web_search: false,
        realtime: false,
    };

    pub fn from_provider_type(provider_type: &str) -> Option<Self> {
        let protocol = RuntimeProviderProtocol::from_provider_type(provider_type)?;
        Some(Self::from_resolved_route(provider_type, protocol, None))
    }

    pub fn from_provider_route(provider_type: &str, base_url: Option<&str>) -> Option<Self> {
        let protocol = RuntimeProviderProtocol::from_provider_type(provider_type)?;
        Some(Self::from_resolved_route(provider_type, protocol, base_url))
    }

    pub fn from_route(
        provider_name: &str,
        protocol: &ProtocolKind,
        base_url: Option<&str>,
    ) -> Self {
        RuntimeProviderProtocol::from_route_protocol(protocol).map_or(Self::NONE, |protocol| {
            Self::from_resolved_route(provider_name, protocol, base_url)
        })
    }

    fn from_resolved_route(
        provider_name: &str,
        protocol: RuntimeProviderProtocol,
        base_url: Option<&str>,
    ) -> Self {
        let provider = normalize_provider(provider_name);
        let official_responses_provider = matches!(
            provider.as_str(),
            "openai" | "openai_response" | "openai_responses" | "responses" | "codex"
        );
        let hosted_tools = protocol == RuntimeProviderProtocol::Responses
            && official_responses_provider
            && is_official_openai_host(base_url);
        let realtime = matches!(
            protocol,
            RuntimeProviderProtocol::ChatCompletions | RuntimeProviderProtocol::Responses
        ) && matches!(
            provider.as_str(),
            "openai" | "openai_response" | "openai_responses" | "responses"
        ) && crate::realtime::openai_realtime_base_url(
            base_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("https://api.openai.com"),
        )
        .is_some();
        Self {
            namespace_tools: false,
            // Custom tools execute in the client host; their Responses wire support
            // does not require an OpenAI hosted-service endpoint. Model declarations
            // still decide which tools the runtime exposes.
            custom_tools: protocol.uses_responses_api(),
            image_generation: hosted_tools,
            web_search: hosted_tools,
            // Realtime voice has its own WebRTC client-secret + SDP wire. It is
            // only exposed on official OpenAI API-key routes; Codex cloud auth is
            // not a provider route and must never claim this capability.
            realtime,
        }
    }

    pub fn from_runtime_config(config: &RuntimeProviderConfig) -> Self {
        config.protocol.map_or(Self::NONE, |protocol| {
            Self::from_resolved_route(&config.provider_name, protocol, config.base_url.as_deref())
        })
    }
}

fn normalize_provider(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn is_official_openai_host(base_url: Option<&str>) -> bool {
    let Some(base_url) = base_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    url::Url::parse(base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .is_some_and(|host| host.eq_ignore_ascii_case("api.openai.com"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_adapters_only_claim_realtime_on_official_api_key_routes() {
        for provider_type in [
            "openai",
            "openai-response",
            "openai_responses",
            "responses",
        ] {
            let capabilities = ProviderCapabilities::from_provider_type(provider_type)
                .expect("current chat adapter");
            assert!(
                capabilities.realtime,
                "official api-key route must expose the realtime wire: {provider_type}"
            );
        }

        for provider_type in [
            "new-api",
            "gateway",
            "codex",
            "ollama",
            "anthropic",
            "anthropic-compatible",
            "anthropic_compatible",
            "gemini",
            "gemini-api-key",
            "google",
            "azure-openai",
            "vertexai",
        ] {
            let capabilities = ProviderCapabilities::from_provider_type(provider_type)
                .expect("current chat adapter");
            assert!(
                !capabilities.realtime,
                "non-OpenAI routes must not claim realtime voice: {provider_type}"
            );
        }
    }

    #[test]
    fn hosted_tools_require_official_responses_route_and_host() {
        let official_openai = Some(ProviderCapabilities {
            namespace_tools: false,
            custom_tools: true,
            image_generation: true,
            web_search: true,
            realtime: true,
        });
        let official_codex = Some(ProviderCapabilities {
            namespace_tools: false,
            custom_tools: true,
            image_generation: true,
            web_search: true,
            realtime: false,
        });
        let custom_only = ProviderCapabilities {
            namespace_tools: false,
            custom_tools: true,
            image_generation: false,
            web_search: false,
            realtime: false,
        };
        assert_eq!(
            ProviderCapabilities::from_provider_route(
                "openai-response",
                Some("https://api.openai.com/v1"),
            ),
            official_openai
        );
        assert_eq!(
            ProviderCapabilities::from_provider_route(
                "codex",
                Some("https://api.openai.com/v1/responses"),
            ),
            official_codex
        );
        assert_eq!(
            ProviderCapabilities::from_provider_route(
                "openai-response",
                Some("https://gateway.example.com/v1"),
            ),
            Some(custom_only)
        );
        assert_eq!(
            ProviderCapabilities::from_provider_route("ollama", Some("http://127.0.0.1:11434"),),
            Some(custom_only)
        );
        assert_eq!(
            ProviderCapabilities::from_provider_route(
                "azure-openai",
                Some("https://resource.openai.azure.com"),
            ),
            Some(custom_only)
        );
        assert_eq!(
            ProviderCapabilities::from_route(
                "openai",
                &ProtocolKind::OpenaiResponses,
                Some("https://api.openai.com/v1"),
            ),
            official_openai.expect("official Responses capability")
        );
        assert_eq!(
            ProviderCapabilities::from_route(
                "openai",
                &ProtocolKind::OpenaiChat,
                Some("https://api.openai.com/v1"),
            ),
            ProviderCapabilities {
                realtime: true,
                ..ProviderCapabilities::NONE
            }
        );
        assert_eq!(
            ProviderCapabilities::from_route(
                "gateway",
                &ProtocolKind::OpenaiResponses,
                Some("https://api.openai.com/v1"),
            ),
            custom_only
        );
        assert_eq!(
            ProviderCapabilities::from_route(
                "azure-openai",
                &ProtocolKind::OpenaiResponses,
                Some("https://resource.openai.azure.com"),
            ),
            custom_only
        );
    }

    #[test]
    fn local_responses_custom_tools_do_not_enable_remote_hosted_services() {
        let capabilities = ProviderCapabilities::from_provider_route(
            "openai-response",
            Some("http://127.0.0.1:43127/v1"),
        )
        .unwrap();
        assert!(capabilities.custom_tools);
        assert!(!capabilities.image_generation);
        assert!(!capabilities.web_search);
        assert!(!capabilities.namespace_tools);
        assert!(!capabilities.realtime);
        assert_eq!(
            ProviderCapabilities::from_route(
                "gateway",
                &ProtocolKind::OpenaiChat,
                Some("http://127.0.0.1:43127/v1"),
            ),
            ProviderCapabilities::NONE
        );
    }

    #[test]
    fn realtime_wire_requires_an_official_openai_api_key_route() {
        for (provider_type, base_url) in [
            ("openai", Some("https://api.openai.com/v1")),
            ("openai-response", Some("https://api.openai.com/v1")),
            ("responses", Some("https://api.openai.com")),
        ] {
            assert!(
                ProviderCapabilities::from_provider_route(provider_type, base_url)
                    .expect("current provider")
                    .realtime,
                "provider_type={provider_type} base_url={base_url:?}"
            );
        }

        // Brand, chat compatibility, Azure or a proxy host cannot imply the
        // official WebRTC session contract.
        let routes: &[(&str, Option<&str>)] = &[
            ("codex", Some("https://api.openai.com/v1")),
            ("openai", Some("https://gateway.example.com/v1")),
            ("openai-response", Some("https://gateway.example.com/v1")),
            ("new-api", Some("https://api.openai.com/v1")),
            ("gateway", Some("https://api.openai.com/v1")),
            ("azure-openai", Some("https://resource.openai.azure.com")),
            ("ollama", Some("http://127.0.0.1:11434")),
            ("anthropic", None),
            ("gemini", None),
            ("vertexai", None),
        ];
        for (provider_type, base_url) in routes {
            let capabilities = ProviderCapabilities::from_provider_route(provider_type, *base_url)
                .unwrap_or(ProviderCapabilities::NONE);
            assert!(
                !capabilities.realtime,
                "provider_type={provider_type} base_url={base_url:?}"
            );
        }
        for protocol in [
            ProtocolKind::AnthropicMessages,
            ProtocolKind::GeminiGenerateContent,
            ProtocolKind::VertexGemini,
        ] {
            assert!(
                !ProviderCapabilities::from_route(
                    "openai",
                    &protocol,
                    Some("https://api.openai.com/v1"),
                )
                .realtime
            );
        }
        assert!(!ProviderCapabilities::NONE.realtime);
    }

    #[test]
    fn providers_without_current_chat_adapters_have_no_capability_snapshot() {
        for provider_type in ["aws-bedrock", "fal"] {
            assert_eq!(
                ProviderCapabilities::from_provider_type(provider_type),
                None,
                "provider_type={provider_type}"
            );
        }
    }

    #[test]
    fn unknown_provider_type_fails_closed() {
        assert_eq!(
            ProviderCapabilities::from_provider_type("future-provider"),
            None
        );
    }
}
