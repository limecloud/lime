//! 网络搜索运行时环境同步服务
//!
//! 将设置页中的网络搜索配置同步为 aster-rust 可读取的环境变量。

use crate::services::environment_service::apply_web_search_environment;
use proxycast_core::config::Config;

pub fn apply_web_search_runtime_env(config: &Config) {
    apply_web_search_environment(config);
}

#[cfg(test)]
mod tests {
    use crate::services::environment_service::build_web_search_runtime_env;
    use proxycast_core::config::{Config, WebSearchConfig, WebSearchProvider};
    use proxycast_core::config::{MultiSearchConfig, SearchEngine};

    #[test]
    fn should_resolve_provider_priority_with_selected_provider_first() {
        let mut web_search = WebSearchConfig::default();
        web_search.provider = WebSearchProvider::GoogleCustomSearch;
        web_search.provider_priority = vec![
            WebSearchProvider::DuckduckgoInstant,
            WebSearchProvider::Tavily,
        ];

        let config = Config {
            web_search,
            ..Config::default()
        };
        let raw = build_web_search_runtime_env(&config)
            .get("WEB_SEARCH_PROVIDER_PRIORITY")
            .cloned()
            .unwrap_or_default();
        let priority = raw.split(',').map(str::to_string).collect::<Vec<_>>();
        assert_eq!(
            priority.first().map(String::as_str),
            Some("google_custom_search")
        );
        assert!(priority.iter().any(|item| item == "duckduckgo_instant"));
        assert!(priority.iter().any(|item| item == "tavily"));
    }

    #[test]
    fn should_filter_invalid_multi_search_engine_entries() {
        let mut config = Config::default();
        config.web_search.provider = WebSearchProvider::MultiSearchEngine;
        config.web_search.multi_search.engines = vec![
            proxycast_core::config::MultiSearchEngineEntryConfig {
                name: "valid".to_string(),
                url_template: "https://example.com/search?q={query}".to_string(),
                enabled: true,
            },
            proxycast_core::config::MultiSearchEngineEntryConfig {
                name: "invalid".to_string(),
                url_template: "https://example.com/search".to_string(),
                enabled: true,
            },
        ];

        let raw = build_web_search_runtime_env(&config)
            .get("MULTI_SEARCH_ENGINE_CONFIG_JSON")
            .cloned()
            .unwrap_or_default();
        assert!(raw.contains("\"valid\""));
        assert!(!raw.contains("\"invalid\""));
    }

    #[test]
    fn should_build_multi_search_runtime_json() {
        let mut config = Config::default();
        config.web_search = WebSearchConfig {
            engine: SearchEngine::Google,
            provider: WebSearchProvider::MultiSearchEngine,
            provider_priority: vec![WebSearchProvider::Tavily],
            tavily_api_key: Some("tavily-key".to_string()),
            bing_search_api_key: None,
            google_search_api_key: None,
            google_search_engine_id: None,
            multi_search: MultiSearchConfig::default(),
        };

        let raw = build_web_search_runtime_env(&config)
            .get("MULTI_SEARCH_ENGINE_CONFIG_JSON")
            .cloned()
            .unwrap_or_default();
        assert!(!raw.is_empty());
    }
}
