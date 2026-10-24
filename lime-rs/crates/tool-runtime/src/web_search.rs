use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
    RuntimeToolPolicyErrorKind,
};
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use url::Url;
use urlencoding::encode;

pub const WEB_SEARCH_TOOL_NAME: &str = "WebSearch";

const WEB_SEARCH_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Clone)]
pub struct RuntimeWebSearchExecutor {
    client: Client,
    cache: Arc<WebSearchCache>,
}

impl RuntimeWebSearchExecutor {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (compatible; ToolRuntime/1.0)")
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            client,
            cache: Arc::new(WebSearchCache::default()),
        }
    }

    pub fn handle() -> RuntimeToolExecutorHandle {
        RuntimeToolExecutorHandle::new(Arc::new(Self::new()))
    }

    async fn execute_web_search(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        if !is_web_search_tool_name(request.tool_name) {
            return Err(runtime_web_search_error(format!(
                "unsupported web search tool: {}",
                request.tool_name
            )));
        }
        let mode = request
            .turn_context
            .and_then(|context| context.web_search_mode)
            .unwrap_or_default();
        match mode {
            agent_protocol::WebSearchMode::Disabled => {
                return Err(runtime_web_search_error(
                    "web search is disabled by the current access policy",
                ))
            }
            agent_protocol::WebSearchMode::Indexed => {
                return Err(runtime_web_search_error(
                    "indexed web search is unavailable in the local search backend",
                ))
            }
            _ => {}
        }
        if request
            .context
            .cancel_token()
            .is_some_and(|token| token.is_cancelled())
        {
            return Err(runtime_web_search_error("web search cancelled"));
        }

        let started_at = Instant::now();
        let input = serde_json::from_value::<WebSearchInput>(request.params.clone())
            .map_err(|error| runtime_web_search_error(format!("输入参数解析失败: {error}")))?;
        let query = input.query.trim().to_string();
        if query.chars().count() < 2 {
            return Err(runtime_web_search_error("query 至少需要 2 个非空白字符"));
        }

        let (allowed_domains, blocked_domains) =
            sanitize_domain_filters(&query, input.allowed_domains, input.blocked_domains);
        let cache_key = generate_search_cache_key(&query, &allowed_domains, &blocked_domains);

        if let Some(cached) = self.cache.get(&cache_key) {
            return runtime_result_from_cached_search(&query, cached, started_at);
        }
        if mode == agent_protocol::WebSearchMode::Cached {
            return Err(runtime_web_search_error("no cached web search result is available; cached mode does not permit a network request"));
        }

        let execution = self
            .perform_search(&query)
            .await
            .map_err(|error| runtime_web_search_error(format!("搜索失败: {error}")))?;
        let raw_results = execution.results.clone();
        let filtered_results =
            apply_domain_filters(raw_results.clone(), &allowed_domains, &blocked_domains);
        self.cache.insert(
            cache_key,
            CachedSearchResults {
                query: query.clone(),
                results: filtered_results.clone(),
                fetched_at: SystemTime::now(),
                allowed_domains: allowed_domains.clone(),
                blocked_domains: blocked_domains.clone(),
            },
        );

        let web_search_metadata = json!({
            "cache_hit": false,
            "selected_provider": execution.selected_provider.as_env_value(),
            "configured_priority": execution
                .configured_priority
                .iter()
                .map(|provider| provider.as_env_value())
                .collect::<Vec<_>>(),
            "attempts": execution
                .attempts
                .iter()
                .map(SearchAttempt::as_json)
                .collect::<Vec<_>>(),
            "provider_metadata": execution.provider_metadata,
        });

        if !filtered_results.is_empty() {
            let output = WebSearchOutput {
                query: query.clone(),
                results: vec![
                    WebSearchOutputEntry::Result(WebSearchResultBlock {
                        tool_use_id: "web_search".to_string(),
                        content: filtered_results
                            .iter()
                            .map(WebSearchHit::from_result)
                            .collect(),
                    }),
                    WebSearchOutputEntry::Text(format_search_results(&filtered_results, &query)),
                ],
                duration_seconds: started_at.elapsed().as_secs_f64(),
            };
            return runtime_result_from_output(output, web_search_metadata);
        }

        if !raw_results.is_empty() {
            let allowed = allowed_domains
                .as_ref()
                .map(|domains| domains.join(", "))
                .unwrap_or_else(|| "全部".to_string());
            let blocked = blocked_domains
                .as_ref()
                .map(|domains| domains.join(", "))
                .unwrap_or_else(|| "无".to_string());
            let output = WebSearchOutput {
                query,
                results: vec![WebSearchOutputEntry::Text(format!(
                    "应用域名过滤器后未找到结果。允许的域名: {allowed}；阻止的域名: {blocked}。"
                ))],
                duration_seconds: started_at.elapsed().as_secs_f64(),
            };
            return runtime_result_from_output(output, web_search_metadata);
        }

        let configured_chain = execution
            .configured_priority
            .iter()
            .map(|provider| provider.as_env_value())
            .collect::<Vec<_>>()
            .join(" -> ");
        let output = WebSearchOutput {
            query,
            results: vec![WebSearchOutputEntry::Text(format!(
                "未找到结果。当前搜索提供商链路: {configured_chain}"
            ))],
            duration_seconds: started_at.elapsed().as_secs_f64(),
        };
        runtime_result_from_output(output, web_search_metadata)
    }

    async fn perform_search(&self, query: &str) -> Result<SearchExecution, String> {
        let runtime_config = SearchRuntimeConfig::from_env();
        let mut attempts = Vec::new();
        let mut fallback_empty: Option<(SearchProviderKind, Value)> = None;

        for provider in &runtime_config.priority {
            match self.search_with_provider(*provider, query).await {
                Ok(output) if !output.results.is_empty() => {
                    attempts.push(SearchAttempt::success(*provider, output.results.len()));
                    return Ok(SearchExecution {
                        selected_provider: *provider,
                        configured_priority: runtime_config.priority.clone(),
                        attempts,
                        provider_metadata: output.metadata,
                        results: output.results,
                    });
                }
                Ok(output) => {
                    attempts.push(SearchAttempt::empty(*provider));
                    if fallback_empty.is_none() {
                        fallback_empty = Some((*provider, output.metadata));
                    }
                }
                Err(error) => {
                    attempts.push(SearchAttempt::error(*provider, error));
                }
            }
        }

        if let Some((selected_provider, provider_metadata)) = fallback_empty {
            return Ok(SearchExecution {
                selected_provider,
                configured_priority: runtime_config.priority.clone(),
                attempts,
                provider_metadata,
                results: Vec::new(),
            });
        }

        let errors = attempts
            .iter()
            .filter_map(|attempt| {
                attempt
                    .error
                    .as_ref()
                    .map(|error| format!("{}: {error}", attempt.provider.as_env_value()))
            })
            .collect::<Vec<_>>();
        if errors.is_empty() {
            Err("所有搜索提供商均未返回结果".to_string())
        } else {
            Err(format!("所有搜索提供商均失败: {}", errors.join(" | ")))
        }
    }

    async fn search_with_provider(
        &self,
        provider: SearchProviderKind,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        match provider {
            SearchProviderKind::Tavily => {
                let api_key = std::env::var("TAVILY_API_KEY")
                    .map_err(|_| "缺少环境变量 TAVILY_API_KEY".to_string())?;
                let results = self.search_with_tavily(query, &api_key).await?;
                Ok(SearchProviderOutput {
                    results,
                    metadata: json!({ "provider": provider.as_env_value() }),
                })
            }
            SearchProviderKind::MultiSearchEngine => {
                self.search_with_multi_search_engine(query).await
            }
            SearchProviderKind::BingSearchApi => {
                let api_key = std::env::var("BING_SEARCH_API_KEY")
                    .map_err(|_| "缺少环境变量 BING_SEARCH_API_KEY".to_string())?;
                let results = self.search_with_bing(query, &api_key).await?;
                Ok(SearchProviderOutput {
                    results,
                    metadata: json!({ "provider": provider.as_env_value() }),
                })
            }
            SearchProviderKind::GoogleCustomSearch => {
                let api_key = std::env::var("GOOGLE_SEARCH_API_KEY")
                    .map_err(|_| "缺少环境变量 GOOGLE_SEARCH_API_KEY".to_string())?;
                let engine_id = std::env::var("GOOGLE_SEARCH_ENGINE_ID")
                    .map_err(|_| "缺少环境变量 GOOGLE_SEARCH_ENGINE_ID".to_string())?;
                let results = self.search_with_google(query, &api_key, &engine_id).await?;
                Ok(SearchProviderOutput {
                    results,
                    metadata: json!({ "provider": provider.as_env_value() }),
                })
            }
            SearchProviderKind::DuckduckgoInstant => {
                let results = self.search_with_duckduckgo(query).await?;
                Ok(SearchProviderOutput {
                    results,
                    metadata: json!({ "provider": provider.as_env_value() }),
                })
            }
        }
    }

    async fn search_with_tavily(
        &self,
        query: &str,
        api_key: &str,
    ) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .post("https://api.tavily.com/search")
            .json(&json!({
                "api_key": api_key,
                "query": query,
                "max_results": 10,
                "include_answer": false,
            }))
            .send()
            .await
            .map_err(|error| format!("Tavily Search API 请求失败: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Tavily API 返回错误 {status}: {text}"));
        }

        let data = response
            .json::<Value>()
            .await
            .map_err(|error| format!("解析 Tavily 响应失败: {error}"))?;
        let items = data
            .get("results")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);

        Ok(items
            .iter()
            .filter_map(|item| {
                Some(SearchResult {
                    title: item.get("title")?.as_str()?.to_string(),
                    url: item.get("url")?.as_str()?.to_string(),
                    snippet: item
                        .get("content")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    publish_date: item
                        .get("published_date")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
            })
            .collect())
    }

    async fn search_with_multi_search_engine(
        &self,
        query: &str,
    ) -> Result<SearchProviderOutput, String> {
        let config = MultiSearchEngineConfig::from_env()?;
        let engines = config.engine_order();
        if engines.is_empty() {
            return Err("Multi Search Engine 未配置有效引擎".to_string());
        }

        let timeout = Duration::from_millis(config.timeout_ms);
        let encoded_query = encode(query);
        let mut aggregated_results = Vec::new();
        let mut successful_engines = Vec::new();
        let mut failed_engines = Vec::new();
        let mut raw_result_count = 0usize;

        for engine in engines {
            if aggregated_results.len() >= config.max_total_results {
                break;
            }

            let request_url = engine
                .url_template
                .replace("{query}", encoded_query.as_ref());
            let request_host = Url::parse(&request_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string));
            let send_result =
                tokio::time::timeout(timeout, self.client.get(&request_url).send()).await;
            let response = match send_result {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => {
                    failed_engines.push(format!("{}: {error}", engine.name));
                    continue;
                }
                Err(_) => {
                    failed_engines
                        .push(format!("{}: timeout {}ms", engine.name, config.timeout_ms));
                    continue;
                }
            };

            if !response.status().is_success() {
                failed_engines.push(format!("{}: HTTP {}", engine.name, response.status()));
                continue;
            }

            let body = match response.text().await {
                Ok(text) => text,
                Err(error) => {
                    failed_engines.push(format!("{}: {error}", engine.name));
                    continue;
                }
            };
            let mut engine_results = extract_results_from_search_html(
                &body,
                config.max_results_per_engine,
                request_host.as_deref(),
            );
            raw_result_count += engine_results.len();
            if engine_results.is_empty() {
                failed_engines.push(format!("{}: no_results", engine.name));
            } else {
                successful_engines.push(engine.name.clone());
                aggregated_results.append(&mut engine_results);
            }
        }

        let deduped_results = deduplicate_results(aggregated_results, config.max_total_results);
        Ok(SearchProviderOutput {
            results: deduped_results.clone(),
            metadata: json!({
                "provider": SearchProviderKind::MultiSearchEngine.as_env_value(),
                "dedup_before": raw_result_count,
                "dedup_after": deduped_results.len(),
                "successful_engines": successful_engines,
                "failed_engines": failed_engines,
                "timeout_ms": config.timeout_ms,
                "max_results_per_engine": config.max_results_per_engine,
                "max_total_results": config.max_total_results,
            }),
        })
    }

    async fn search_with_duckduckgo(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .get("https://api.duckduckgo.com/")
            .query(&[
                ("q", query),
                ("format", "json"),
                ("no_html", "1"),
                ("skip_disambig", "1"),
            ])
            .send()
            .await
            .map_err(|error| format!("DuckDuckGo 请求失败: {error}"))?;
        let data = response
            .json::<Value>()
            .await
            .map_err(|error| format!("解析 DuckDuckGo 响应失败: {error}"))?;
        let mut results = Vec::new();

        if let Some(related_topics) = data.get("RelatedTopics").and_then(Value::as_array) {
            for topic in related_topics.iter().take(10) {
                if let Some(topics) = topic.get("Topics").and_then(Value::as_array) {
                    for sub_topic in topics.iter().take(3) {
                        push_duckduckgo_topic_result(&mut results, sub_topic);
                    }
                } else {
                    push_duckduckgo_topic_result(&mut results, topic);
                }
            }
        }

        if let (Some(abstract_text), Some(abstract_url)) = (
            data.get("Abstract").and_then(Value::as_str),
            data.get("AbstractURL").and_then(Value::as_str),
        ) {
            if !abstract_text.is_empty() && !abstract_url.is_empty() {
                let title = data
                    .get("Heading")
                    .and_then(Value::as_str)
                    .unwrap_or("DuckDuckGo Instant Answer");
                results.insert(
                    0,
                    SearchResult {
                        title: title.to_string(),
                        url: abstract_url.to_string(),
                        snippet: Some(abstract_text.to_string()),
                        publish_date: None,
                    },
                );
            }
        }

        Ok(results)
    }

    async fn search_with_bing(
        &self,
        query: &str,
        api_key: &str,
    ) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .get("https://api.bing.microsoft.com/v7.0/search")
            .query(&[("q", query), ("count", "10")])
            .header("Ocp-Apim-Subscription-Key", api_key)
            .send()
            .await
            .map_err(|error| format!("Bing Search API 请求失败: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Bing API 返回错误 {}", response.status()));
        }
        let data = response
            .json::<Value>()
            .await
            .map_err(|error| format!("解析 Bing 响应失败: {error}"))?;
        let items = data
            .get("webPages")
            .and_then(|value| value.get("value"))
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        Ok(items
            .iter()
            .filter_map(|item| {
                Some(SearchResult {
                    title: item.get("name")?.as_str()?.to_string(),
                    url: item.get("url")?.as_str()?.to_string(),
                    snippet: item
                        .get("snippet")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    publish_date: item
                        .get("dateLastCrawled")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
            })
            .collect())
    }

    async fn search_with_google(
        &self,
        query: &str,
        api_key: &str,
        cx: &str,
    ) -> Result<Vec<SearchResult>, String> {
        let response = self
            .client
            .get("https://www.googleapis.com/customsearch/v1")
            .query(&[("key", api_key), ("cx", cx), ("q", query), ("num", "10")])
            .send()
            .await
            .map_err(|error| format!("Google Search API 请求失败: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Google Search API 返回错误 {}", response.status()));
        }
        let data = response
            .json::<Value>()
            .await
            .map_err(|error| format!("解析 Google 响应失败: {error}"))?;
        let items = data
            .get("items")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        Ok(items
            .iter()
            .filter_map(|item| {
                Some(SearchResult {
                    title: item.get("title")?.as_str()?.to_string(),
                    url: item.get("link")?.as_str()?.to_string(),
                    snippet: item
                        .get("snippet")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    publish_date: None,
                })
            })
            .collect())
    }
}

impl Default for RuntimeWebSearchExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeToolExecutor for RuntimeWebSearchExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move { self.execute_web_search(request).await })
    }
}

pub fn runtime_web_search_executor_handle() -> RuntimeToolExecutorHandle {
    static HANDLE: OnceLock<RuntimeToolExecutorHandle> = OnceLock::new();
    HANDLE.get_or_init(RuntimeWebSearchExecutor::handle).clone()
}

pub fn web_search_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        WEB_SEARCH_TOOL_NAME,
        "允许当前代理搜索网络并使用结果来提供响应。",
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 2,
                    "description": "要使用的搜索查询"
                },
                "allowed_domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "仅包含来自这些域名的结果"
                },
                "blocked_domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "永远不包含来自这些域名的结果"
                }
            },
            "required": ["query"]
        }),
    )
}

pub fn is_web_search_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_lookup_key(tool_name).as_str(),
        "websearch" | "websearchtool" | "mcpsystemwebsearch"
    )
}

include!("web_search/support.rs");

#[cfg(test)]
mod access_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_executor::{RuntimeToolExecutionContext, RuntimeToolExecutionContextInput};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn web_search_tool_name_matches_current_aliases() {
        assert!(is_web_search_tool_name("WebSearch"));
        assert!(is_web_search_tool_name("WebSearchTool"));
        assert!(is_web_search_tool_name("mcp__system__web_search"));
        assert!(!is_web_search_tool_name("WebFetch"));
    }

    #[test]
    fn search_runtime_config_keeps_default_fallback_order() {
        let env = HashMap::from([(
            "WEB_SEARCH_PROVIDER_PRIORITY".to_string(),
            "google_custom_search,tavily,unknown".to_string(),
        )]);
        let config = SearchRuntimeConfig::from_env_map(&env);

        assert_eq!(config.priority[0], SearchProviderKind::GoogleCustomSearch);
        assert_eq!(config.priority[1], SearchProviderKind::Tavily);
        assert!(config
            .priority
            .contains(&SearchProviderKind::DuckduckgoInstant));
    }

    #[test]
    fn domain_filters_prefer_allowed_domains_when_both_are_present() {
        let (allowed, blocked) = sanitize_domain_filters(
            "query",
            Some(vec!["Example.com".to_string()]),
            Some(vec!["blocked.com".to_string()]),
        );

        assert_eq!(allowed, Some(vec!["example.com".to_string()]));
        assert_eq!(blocked, None);
    }

    #[test]
    fn search_html_extractor_uses_real_links_and_removes_engine_links() {
        let html = r#"
            <a href="/search?q=ignored">Search</a>
            <a href="/url?q=https%3A%2F%2Fexample.com%2Fpost">Example Post</a>
            <a href="https://example.com/post">Example Post Duplicate</a>
            <a href="https://docs.example.com/guide">Docs Guide</a>
        "#;

        let results = extract_results_from_search_html(html, 5, Some("www.google.com"));

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://example.com/post");
        assert_eq!(results[1].url, "https://docs.example.com/guide");
    }

    #[tokio::test]
    async fn runtime_web_search_executor_rejects_non_web_search_tools() {
        let executor = RuntimeWebSearchExecutor::new();
        let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: PathBuf::from("."),
            session_id: "session-test".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        });

        let error = executor
            .execute_web_search(RuntimeToolExecutionRequest {
                tool_name: "WebFetch",
                params: &json!({ "query": "rust" }),
                context: &context,
                turn_context: None,
            })
            .await
            .expect_err("non WebSearch tool should fail");

        assert!(error.message().contains("unsupported web search tool"));
    }
}
