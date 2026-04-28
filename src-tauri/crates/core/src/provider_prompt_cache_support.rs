use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptCacheCatalog {
    #[serde(default)]
    automatic_anthropic_compatible_hosts: Vec<PromptCacheHostRule>,
}

#[derive(Debug, Deserialize)]
struct PromptCacheHostRule {
    contains: String,
}

fn normalize_api_host(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .trim_end_matches('/')
        .to_string()
}

fn load_prompt_cache_catalog() -> &'static PromptCacheCatalog {
    static CATALOG: OnceLock<PromptCacheCatalog> = OnceLock::new();

    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../src/lib/model/anthropicCompatiblePromptCacheCatalog.json"
        ))
        .expect("prompt cache catalog should be valid json")
    })
}

pub fn is_known_automatic_anthropic_compatible_host(api_host: Option<&str>) -> bool {
    let normalized_api_host = normalize_api_host(api_host.unwrap_or_default());
    if normalized_api_host.is_empty() {
        return false;
    }

    load_prompt_cache_catalog()
        .automatic_anthropic_compatible_hosts
        .iter()
        .map(|rule| rule.contains.trim().to_lowercase())
        .any(|needle| normalized_api_host.contains(&needle))
}

#[cfg(test)]
mod tests {
    use super::is_known_automatic_anthropic_compatible_host;

    #[test]
    fn known_official_anthropic_compatible_hosts_should_match() {
        let hosts = [
            "https://open.bigmodel.cn/api/anthropic",
            "https://api.z.ai/api/anthropic",
            "https://api.moonshot.cn/anthropic",
            "https://api.moonshot.ai/anthropic",
            "https://api.kimi.com/coding/",
            "https://api.minimaxi.com/anthropic",
            "https://api.minimax.io/anthropic",
            "https://coding.dashscope.aliyuncs.com/apps/anthropic",
            "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
            "https://token-plan-cn.xiaomimimo.com/anthropic",
        ];

        for host in hosts {
            assert!(
                is_known_automatic_anthropic_compatible_host(Some(host)),
                "expected host to be treated as automatic prompt cache: {host}"
            );
        }
    }

    #[test]
    fn unknown_host_should_not_match() {
        assert!(!is_known_automatic_anthropic_compatible_host(Some(
            "https://example.com/anthropic"
        )));
    }
}
