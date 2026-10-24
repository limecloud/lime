use super::*;
use crate::tool_executor::{
    RuntimeToolExecutionContext, RuntimeToolExecutionContextInput, RuntimeToolTurnContext,
};
use agent_protocol::WebSearchMode;

#[tokio::test]
async fn restricted_search_never_contacts_the_network_even_on_cache_miss() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let executor = RuntimeWebSearchExecutor {
        client: Client::builder()
            .proxy(
                reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap(),
            )
            .timeout(Duration::from_millis(100))
            .build()
            .unwrap(),
        cache: Arc::new(WebSearchCache::default()),
    };
    let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: ".".into(),
        session_id: "access-test".into(),
        cancel_token: None,
        workspace_sandbox: None,
    });
    let params = json!({"query":"uncached query"});
    for (mode, message) in [
        (WebSearchMode::Disabled, "disabled"),
        (WebSearchMode::Cached, "does not permit a network request"),
        (WebSearchMode::Indexed, "unavailable"),
    ] {
        let turn_context = RuntimeToolTurnContext {
            web_search_mode: Some(mode),
            ..Default::default()
        };
        let error = executor
            .execute_web_search(RuntimeToolExecutionRequest {
                tool_name: "WebSearch",
                params: &params,
                context: &context,
                turn_context: Some(&turn_context),
            })
            .await
            .unwrap_err();
        assert!(
            error.message().contains(message),
            "{mode:?}: {}",
            error.message()
        );
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }
}

#[tokio::test]
async fn cached_search_reuses_results_but_disabled_search_cannot_read_them() {
    let executor = RuntimeWebSearchExecutor::new();
    executor.cache.insert(
        generate_search_cache_key("rust", &None, &None),
        CachedSearchResults {
            query: "rust".into(),
            results: vec![SearchResult {
                title: "Rust".into(),
                url: "https://rust-lang.org".into(),
                snippet: None,
                publish_date: None,
            }],
            fetched_at: SystemTime::now(),
            allowed_domains: None,
            blocked_domains: None,
        },
    );
    let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: ".".into(),
        session_id: "cache-test".into(),
        cancel_token: None,
        workspace_sandbox: None,
    });
    let params = json!({"query":"rust"});
    let turn_context = RuntimeToolTurnContext {
        web_search_mode: Some(WebSearchMode::Cached),
        ..Default::default()
    };
    let result = executor
        .execute_web_search(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &params,
            context: &context,
            turn_context: Some(&turn_context),
        })
        .await
        .unwrap();
    assert_eq!(
        result.metadata.get("web_search").unwrap()["cache_hit"],
        true
    );
    let disabled = RuntimeToolTurnContext {
        web_search_mode: Some(WebSearchMode::Disabled),
        ..Default::default()
    };
    assert!(executor
        .execute_web_search(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &params,
            context: &context,
            turn_context: Some(&disabled),
        })
        .await
        .unwrap_err()
        .message()
        .contains("disabled"));
}
