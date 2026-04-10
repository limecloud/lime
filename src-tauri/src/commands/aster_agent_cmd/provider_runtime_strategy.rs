use super::dto::ConfigureProviderRequest;
use aster::network::should_bypass_system_proxy_for_url;
use lime_core::models::model_registry::ModelCapabilities;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;
use url::Url;

const OLLAMA_RUNTIME_PROBE_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeToolCallStrategy {
    Native,
    ToolShim,
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeToolCallDecision {
    pub capabilities: ModelCapabilities,
    pub strategy: RuntimeToolCallStrategy,
    pub toolshim_model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaShowResponse {
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagModel {
    name: String,
}

fn normalize_provider_identity(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn is_ollama_provider(provider_selector: Option<&str>, provider_name: &str) -> bool {
    provider_selector
        .map(normalize_provider_identity)
        .or_else(|| Some(normalize_provider_identity(provider_name)))
        .is_some_and(|identity| identity == "ollama")
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_ollama_base_url(base_url: Option<&str>) -> String {
    let candidate =
        normalize_optional_text(base_url).unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let raw = if candidate.starts_with("http://") || candidate.starts_with("https://") {
        candidate
    } else {
        format!("http://{candidate}")
    };

    let mut parsed = Url::parse(&raw).unwrap_or_else(|_| {
        Url::parse("http://127.0.0.1:11434").expect("hardcoded ollama fallback url is valid")
    });

    if matches!(parsed.host_str(), Some("localhost")) {
        let _ = parsed.set_host(Some("127.0.0.1"));
    }
    if parsed.port().is_none() && parsed.scheme() == "http" {
        let _ = parsed.set_port(Some(11434));
    }

    let trimmed_path = parsed.path().trim_end_matches('/').to_string();
    if trimmed_path.is_empty() {
        parsed.set_path("");
    } else {
        parsed.set_path(&trimmed_path);
    }
    parsed.to_string().trim_end_matches('/').to_string()
}

fn default_runtime_model_capabilities() -> ModelCapabilities {
    ModelCapabilities {
        vision: false,
        tools: true,
        streaming: true,
        json_mode: true,
        function_calling: true,
        reasoning: false,
    }
}

fn conservative_ollama_fallback_capabilities(fallback: &ModelCapabilities) -> ModelCapabilities {
    ModelCapabilities {
        vision: fallback.vision,
        tools: false,
        streaming: true,
        json_mode: false,
        function_calling: false,
        reasoning: fallback.reasoning,
    }
}

fn build_runtime_tool_call_decision(
    provider_selector: Option<&str>,
    provider_name: &str,
    model_name: &str,
    capabilities: ModelCapabilities,
    toolshim_model: Option<String>,
) -> RuntimeToolCallDecision {
    let supports_native_tools = capabilities.tools || capabilities.function_calling;
    if is_ollama_provider(provider_selector, provider_name) && !supports_native_tools {
        return RuntimeToolCallDecision {
            capabilities,
            strategy: RuntimeToolCallStrategy::ToolShim,
            toolshim_model: Some(toolshim_model.unwrap_or_else(|| model_name.to_string())),
        };
    }

    RuntimeToolCallDecision {
        capabilities,
        strategy: RuntimeToolCallStrategy::Native,
        toolshim_model: None,
    }
}

fn parse_ollama_show_capabilities(
    response: OllamaShowResponse,
    fallback: Option<&ModelCapabilities>,
) -> ModelCapabilities {
    let capability_set = response
        .capabilities
        .into_iter()
        .map(|capability| capability.trim().to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let fallback = fallback.cloned().unwrap_or_default();
    let supports_tools = capability_set.contains("tools");

    ModelCapabilities {
        vision: capability_set.contains("vision") || fallback.vision,
        tools: supports_tools,
        streaming: true,
        json_mode: supports_tools || fallback.json_mode,
        function_calling: supports_tools,
        reasoning: capability_set.contains("thinking") || fallback.reasoning,
    }
}

async fn fetch_ollama_show_capabilities(
    client: &reqwest::Client,
    base_url: &str,
    model_name: &str,
    fallback: Option<&ModelCapabilities>,
) -> Option<ModelCapabilities> {
    let url = format!("{base_url}/api/show");
    let response = client
        .post(url)
        .json(&serde_json::json!({ "name": model_name }))
        .send()
        .await
        .ok()?;
    let response = response.error_for_status().ok()?;
    let parsed = response.json::<OllamaShowResponse>().await.ok()?;
    Some(parse_ollama_show_capabilities(parsed, fallback))
}

async fn fetch_ollama_toolshim_interpreter_model(
    client: &reqwest::Client,
    base_url: &str,
    selected_model: &str,
) -> Option<String> {
    let url = format!("{base_url}/api/tags");
    let response = client.get(url).send().await.ok()?;
    let response = response.error_for_status().ok()?;
    let parsed = response.json::<OllamaTagsResponse>().await.ok()?;

    for model in parsed
        .models
        .into_iter()
        .map(|model| model.name)
        .filter(|name| {
            normalize_provider_identity(name) != normalize_provider_identity(selected_model)
        })
    {
        let Some(capabilities) =
            fetch_ollama_show_capabilities(client, base_url, &model, None).await
        else {
            continue;
        };
        if capabilities.tools || capabilities.function_calling {
            return Some(model);
        }
    }

    None
}

pub(crate) fn resolve_runtime_tool_call_decision_from_capabilities(
    provider_selector: Option<&str>,
    provider_name: &str,
    model_name: &str,
    capabilities: Option<&ModelCapabilities>,
) -> RuntimeToolCallDecision {
    build_runtime_tool_call_decision(
        provider_selector,
        provider_name,
        model_name,
        capabilities
            .cloned()
            .unwrap_or_else(default_runtime_model_capabilities),
        None,
    )
}

pub(crate) async fn resolve_runtime_tool_call_decision(
    provider_selector: Option<&str>,
    provider_name: &str,
    model_name: &str,
    base_url: Option<&str>,
    capabilities: Option<&ModelCapabilities>,
) -> RuntimeToolCallDecision {
    if !is_ollama_provider(provider_selector, provider_name) {
        return resolve_runtime_tool_call_decision_from_capabilities(
            provider_selector,
            provider_name,
            model_name,
            capabilities,
        );
    }

    let fallback_capabilities = capabilities
        .cloned()
        .unwrap_or_else(default_runtime_model_capabilities);
    let base_url = normalize_ollama_base_url(base_url);
    let mut client_builder =
        reqwest::Client::builder().timeout(Duration::from_secs(OLLAMA_RUNTIME_PROBE_TIMEOUT_SECS));
    if should_bypass_system_proxy_for_url(&base_url) {
        tracing::info!(
            "[AsterAgent] Ollama 运行时能力探测绕过系统代理: {}",
            base_url
        );
        client_builder = client_builder.no_proxy();
    }
    let client = match client_builder.build() {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 创建 Ollama 运行时能力探测客户端失败，回退 catalog 能力: {}",
                error
            );
            return build_runtime_tool_call_decision(
                provider_selector,
                provider_name,
                model_name,
                conservative_ollama_fallback_capabilities(&fallback_capabilities),
                Some(model_name.to_string()),
            );
        }
    };

    let Some(live_capabilities) = fetch_ollama_show_capabilities(
        &client,
        &base_url,
        model_name,
        Some(&fallback_capabilities),
    )
    .await
    else {
        tracing::warn!(
            "[AsterAgent] 读取 Ollama 模型能力失败，保守降级到 toolshim: model={}, base_url={}",
            model_name,
            base_url
        );
        return build_runtime_tool_call_decision(
            provider_selector,
            provider_name,
            model_name,
            conservative_ollama_fallback_capabilities(&fallback_capabilities),
            Some(model_name.to_string()),
        );
    };

    let toolshim_model = if live_capabilities.tools || live_capabilities.function_calling {
        None
    } else {
        fetch_ollama_toolshim_interpreter_model(&client, &base_url, model_name)
            .await
            .or_else(|| Some(model_name.to_string()))
    };

    build_runtime_tool_call_decision(
        provider_selector,
        provider_name,
        model_name,
        live_capabilities,
        toolshim_model,
    )
}

pub(crate) async fn enrich_provider_config_with_runtime_tool_strategy(
    provider_config: &mut ConfigureProviderRequest,
) -> RuntimeToolCallDecision {
    let decision = resolve_runtime_tool_call_decision(
        provider_config.provider_id.as_deref(),
        &provider_config.provider_name,
        &provider_config.model_name,
        provider_config.base_url.as_deref(),
        provider_config.model_capabilities.as_ref(),
    )
    .await;

    provider_config.model_capabilities = Some(decision.capabilities.clone());
    provider_config.tool_call_strategy = Some(decision.strategy);
    provider_config.toolshim_model = decision.toolshim_model.clone();

    decision
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_strategy_keeps_tool_capable_model_on_native_path() {
        let capabilities = ModelCapabilities {
            vision: false,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: false,
        };

        let decision = resolve_runtime_tool_call_decision_from_capabilities(
            Some("ollama"),
            "ollama",
            "glm-5.1:cloud",
            Some(&capabilities),
        );

        assert_eq!(decision.strategy, RuntimeToolCallStrategy::Native);
        assert!(decision.toolshim_model.is_none());
        assert!(decision.capabilities.tools);
    }

    #[test]
    fn toolshim_strategy_wraps_ollama_model_without_native_tools() {
        let capabilities = ModelCapabilities {
            vision: false,
            tools: false,
            streaming: true,
            json_mode: false,
            function_calling: false,
            reasoning: true,
        };

        let decision = resolve_runtime_tool_call_decision_from_capabilities(
            Some("ollama"),
            "ollama",
            "deepseek-r1:latest",
            Some(&capabilities),
        );

        assert_eq!(decision.strategy, RuntimeToolCallStrategy::ToolShim);
        assert_eq!(
            decision.toolshim_model.as_deref(),
            Some("deepseek-r1:latest")
        );
        assert!(!decision.capabilities.tools);
    }

    #[test]
    fn parse_ollama_show_capabilities_uses_live_capabilities() {
        let parsed = parse_ollama_show_capabilities(
            OllamaShowResponse {
                capabilities: vec![
                    "completion".to_string(),
                    "thinking".to_string(),
                    "tools".to_string(),
                ],
            },
            None,
        );

        assert!(parsed.tools);
        assert!(parsed.function_calling);
        assert!(parsed.reasoning);
        assert!(parsed.json_mode);
    }

    #[test]
    fn conservative_ollama_fallback_disables_native_tool_flags() {
        let fallback = ModelCapabilities {
            vision: true,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: true,
        };

        let parsed = conservative_ollama_fallback_capabilities(&fallback);

        assert!(parsed.vision);
        assert!(parsed.streaming);
        assert!(parsed.reasoning);
        assert!(!parsed.tools);
        assert!(!parsed.function_calling);
        assert!(!parsed.json_mode);
    }

    #[tokio::test]
    async fn enrich_provider_config_sets_runtime_strategy_fields() {
        let mut provider_config = ConfigureProviderRequest {
            provider_id: Some("openai".to_string()),
            provider_name: "openai".to_string(),
            model_name: "gpt-4o".to_string(),
            api_key: None,
            base_url: None,
            model_capabilities: None,
            tool_call_strategy: None,
            toolshim_model: None,
        };

        let decision =
            enrich_provider_config_with_runtime_tool_strategy(&mut provider_config).await;

        assert_eq!(decision.strategy, RuntimeToolCallStrategy::Native);
        assert_eq!(
            provider_config.tool_call_strategy,
            Some(RuntimeToolCallStrategy::Native)
        );
        assert!(provider_config.toolshim_model.is_none());
        assert!(provider_config
            .model_capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.tools));
    }
}
