//! 客户端类型检测模块
//!
//! 已迁移到 lime-core crate，本文件仅做重新导出。

pub use lime_core::models::client_type::*;

#[cfg(test)]
mod property_tests {
    use super::*;
    use lime_core::config::EndpointProvidersConfig;
    use proptest::prelude::*;

    fn arb_client_type() -> impl Strategy<Value = ClientType> {
        prop_oneof![
            Just(ClientType::Cursor),
            Just(ClientType::ClaudeCode),
            Just(ClientType::Lime),
            Just(ClientType::Windsurf),
            Just(ClientType::Kiro),
            Just(ClientType::Other),
        ]
    }

    fn arb_provider_name() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("kiro".to_string()),
            Just("gemini".to_string()),
            Just("qwen".to_string()),
            Just("openai".to_string()),
            Just("claude".to_string()),
            Just("lime".to_string()),
        ]
    }

    fn arb_optional_provider() -> impl Strategy<Value = Option<String>> {
        prop_oneof![Just(None), arb_provider_name().prop_map(Some),]
    }

    fn arb_endpoint_providers_config() -> impl Strategy<Value = EndpointProvidersConfig> {
        (
            arb_optional_provider(),
            arb_optional_provider(),
            arb_optional_provider(),
            arb_optional_provider(),
            arb_optional_provider(),
            arb_optional_provider(),
        )
            .prop_map(|(cursor, claude_code, lime, windsurf, kiro, other)| {
                EndpointProvidersConfig {
                    cursor,
                    claude_code,
                    lime,
                    windsurf,
                    kiro,
                    other,
                }
            })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn prop_provider_selection_priority(
            client_type in arb_client_type(),
            endpoint_config in arb_endpoint_providers_config(),
            default_provider in arb_provider_name()
        ) {
            let endpoint_provider = endpoint_config.get_provider(client_type.config_key());
            let selected = select_provider(client_type, endpoint_provider, &default_provider);
            match endpoint_provider {
                Some(provider) => {
                    prop_assert_eq!(selected, provider.clone());
                }
                None => {
                    prop_assert_eq!(selected, default_provider);
                }
            }
        }
    }
}
