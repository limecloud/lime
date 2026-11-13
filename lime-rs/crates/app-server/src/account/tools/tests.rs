use super::*;
#[path = "authorization_tests.rs"]
mod authorization;
#[path = "billing_tests.rs"]
mod billing;
#[path = "connections/tests.rs"]
mod connection_tests;
#[path = "pending_tests.rs"]
mod pending;
#[path = "product_tests.rs"]
mod product;
#[path = "recovery_tests.rs"]
mod recovery;
use agent_protocol::{turn_context::TurnContextOverride, WebSearchMode};
use tool_runtime::tool_executor::{
    RuntimeToolExecutionContext, RuntimeToolExecutionContextInput, RuntimeToolExecutionIdentity,
    RuntimeToolExecutionRequest, RuntimeToolExecutor,
};

fn context() -> RuntimeToolExecutionContext {
    RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: std::env::temp_dir(),
        session_id: "session-web".into(),
        cancel_token: None,
        workspace_sandbox: None,
    })
    .with_tool_identity(RuntimeToolExecutionIdentity::new("search-call", "turn-web"))
}

fn live() -> TurnContextOverride {
    TurnContextOverride {
        web_search_mode: Some(WebSearchMode::Live),
        ..Default::default()
    }
}

fn result() -> Value {
    json!({"id":"web_search_1","kind":"search","status":"completed","search":{"items":[
        {"title":"Rust release","url":"https://blog.rust-lang.org/releases/#stable","summary":"Published release","retrievedAt":"2026-11-12T00:00:00Z"},
        {"title":"Wrong suffix","url":"https://rust-lang.org.attacker.test/","summary":"Unrelated","retrievedAt":"2026-11-12T00:00:00Z"}
    ],"truncated":false},"usage":{"requests":1,"responseBytes":32,"billingStatus":"unpriced"}})
}

#[tokio::test]
async fn web_tool_uses_resource_token_filters_sources_and_recovers_after_restart() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_response = Some(result());
    let params = json!({"query":"Rust release","allowed_domains":["rust-lang.org"]});
    let context = context();
    let live = live();
    let request = RuntimeToolExecutionRequest {
        tool_name: "WebSearch",
        params: &params,
        context: &context,
        turn_context: Some(&live),
    };
    let first = manager.execute(request).await.unwrap();
    assert!(first.success);
    let output: Value = serde_json::from_str(&first.output).unwrap();
    assert_eq!(output["search"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        output["search"]["items"][0]["url"],
        "https://blog.rust-lang.org/releases/#stable"
    );
    assert!(!first.output.contains("access-web"));
    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    assert!(restarted.execute(request).await.unwrap().success);
    assert_eq!(f.count("/web/searches"), 1);
    let mut recovery = params.clone();
    recovery["operation_key"] = output["operationKey"].clone();
    let later_context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: root.path().into(),
        session_id: "session-web".into(),
        cancel_token: None,
        workspace_sandbox: None,
    })
    .with_tool_identity(RuntimeToolExecutionIdentity::new(
        "later-call",
        "later-turn",
    ));
    assert!(
        restarted
            .execute(RuntimeToolExecutionRequest {
                params: &recovery,
                context: &later_context,
                ..request
            })
            .await
            .unwrap()
            .success
    );
    assert_eq!(f.count("/web/searches"), 1);
    let other_context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: root.path().into(),
        session_id: "different-session".into(),
        cancel_token: None,
        workspace_sandbox: None,
    })
    .with_tool_identity(RuntimeToolExecutionIdentity::new(
        "other-call",
        "other-turn",
    ));
    assert_eq!(
        restarted
            .execute(RuntimeToolExecutionRequest {
                params: &recovery,
                context: &other_context,
                ..request
            })
            .await
            .unwrap_err()
            .message(),
        "operation_key_conflict"
    );
    let calls = f.state.lock().unwrap();
    let sent = calls
        .calls
        .iter()
        .find(|(p, _, _)| p.ends_with("/web/searches"))
        .unwrap();
    assert_eq!(sent.2, "Bearer access-web");
    assert_eq!(sent.1, json!({"query":"Rust release","limit":10}));
    drop(calls);
    let changed = json!({"query":"Changed question"});
    assert_eq!(
        restarted
            .execute(RuntimeToolExecutionRequest {
                params: &changed,
                ..request
            })
            .await
            .unwrap_err()
            .message(),
        "operation_key_conflict"
    );
}

#[tokio::test]
async fn unknown_web_tool_response_reads_original_without_a_second_dispatch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut s = f.state.lock().unwrap();
        s.invalid_post = true;
        s.web_response = Some(result());
    }
    let params = json!({"query":"Rust release"});
    let context = context();
    let live = live();
    let response = manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &params,
            context: &context,
            turn_context: Some(&live),
        })
        .await
        .unwrap();
    assert!(response.success);
    assert_eq!(f.count("/web/searches"), 1);
    let key: Value = serde_json::from_str(&response.output).unwrap();
    assert_eq!(
        f.count(&format!(
            "/web/operations/{}",
            key["operationKey"].as_str().unwrap()
        )),
        1
    );
}

#[tokio::test]
async fn web_tool_rejects_cached_access_cancelled_calls_and_new_account_replay() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_response = Some(result());
    let params = json!({"query":"Rust release"});
    let context = context();
    let live = live();
    let request = RuntimeToolExecutionRequest {
        tool_name: "WebSearch",
        params: &params,
        context: &context,
        turn_context: Some(&live),
    };
    assert_eq!(
        manager
            .execute(RuntimeToolExecutionRequest {
                turn_context: None,
                ..request
            })
            .await
            .unwrap_err()
            .message(),
        "web_live_access_required"
    );
    assert_eq!(f.count("/web/searches"), 0);
    assert!(manager.execute(request).await.unwrap().success);
    manager.logout().unwrap();
    f.state.lock().unwrap().user = "person-b".into();
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    assert_eq!(
        manager.execute(request).await.unwrap_err().message(),
        "account_changed"
    );
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn web_page_prompt_stays_local_and_result_keeps_original_source() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_response = Some(
        json!({"id":"page_1","kind":"page","status":"completed","usage":{"requests":1,"responseBytes":32,"billingStatus":"unpriced"},"page":{
            "url":"https://www.rust-lang.org/","finalUrl":"https://www.rust-lang.org/#ownership","title":"Rust","text":"Rust ownership rules.\n\nFootball match report.",
            "retrievedAt":"2026-11-12T00:00:00Z","truncated":false
        }}),
    );
    let params = json!({"url":"https://www.rust-lang.org/","prompt":"ownership","dynamic_filter":true,"max_chars":1000});
    let context = context();
    let live = live();
    let response = manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebFetch",
            params: &params,
            context: &context,
            turn_context: Some(&live),
        })
        .await
        .unwrap();
    assert!(response.success);
    let body: Value = serde_json::from_str(&response.output).unwrap();
    assert_eq!(body["page"]["url"], params["url"]);
    assert_eq!(
        body["page"]["finalUrl"],
        "https://www.rust-lang.org/#ownership"
    );
    assert!(body["page"]["text"]
        .as_str()
        .unwrap()
        .contains("Rust ownership"));
    let state = f.state.lock().unwrap();
    let sent = state
        .calls
        .iter()
        .find(|(p, _, _)| p.ends_with("/web/pages"))
        .unwrap();
    assert_eq!(sent.1, json!({"url":params["url"],"maxCharacters":1000}));
}

#[tokio::test]
async fn web_gateway_requires_local_approval_before_dispatch() {
    use tool_runtime::gateway_dispatch_execution::{
        execute_runtime_gateway_dispatch_tool, RuntimeGatewayDispatchToolRequest,
        RuntimeGatewayToolExecutionRegistry,
    };
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = Arc::new(AccountManager::new(
        root.path(),
        &root.path().join("config.yaml"),
    ));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_response = Some(result());
    let registry = RuntimeGatewayToolExecutionRegistry::default();
    for registration in manager.tool_registrations() {
        registry.register(registration);
    }
    let params = json!({"query":"Rust release"});
    let mut turn = live();
    for approved in [false, true] {
        turn.metadata
            .insert("tool_approval_granted".into(), json!(approved));
        let response = execute_runtime_gateway_dispatch_tool(
            &registry,
            RuntimeGatewayDispatchToolRequest {
                tool_name: "WebSearch",
                params: &params,
                working_directory: root.path().into(),
                session_id: "session-approved".into(),
                tool_identity: Some(RuntimeToolExecutionIdentity::new(
                    "approved-call",
                    "turn-approved",
                )),
                cancel_token: None,
                turn_context: Some(&turn),
            },
        )
        .await
        .unwrap();
        assert_eq!(response.is_ok(), approved);
        assert_eq!(f.count("/web/searches"), usize::from(approved));
    }
}

#[tokio::test]
async fn missing_original_operation_never_creates_a_new_search() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut s = f.state.lock().unwrap();
        s.invalid_post = true;
        s.web_operation_missing = true;
    }
    let params = json!({"query":"Rust release"});
    let context = context();
    let live = live();
    let request = RuntimeToolExecutionRequest {
        tool_name: "WebSearch",
        params: &params,
        context: &context,
        turn_context: Some(&live),
    };
    let first = manager.execute(request).await.unwrap();
    assert!(!first.success);
    assert!(first.output.contains("operation_not_found"));
    let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    assert!(!cold.execute(request).await.unwrap().success);
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn invalid_recovery_response_keeps_the_dispatched_key_for_later_reads() {
    for invalid_json in [false, true] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        f.login(&manager, CloudResource::Default).await;
        f.login(&manager, CloudResource::Web).await;
        {
            let mut state = f.state.lock().unwrap();
            state.invalid_post = true;
            state.web_operation_invalid = invalid_json;
            state.web_response = Some(json!({"status":"completed"}));
        }
        let params = json!({"query":"Rust release"});
        let context = context();
        let live = live();
        let request = RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &params,
            context: &context,
            turn_context: Some(&live),
        };
        let first = manager.execute(request).await.unwrap();
        assert!(!first.success);
        assert!(first.error.is_none());
        let output: Value = serde_json::from_str(&first.output).unwrap();
        assert_eq!(output["errorCode"], "cloud_response_invalid");
        assert!(output["operationKey"]
            .as_str()
            .unwrap()
            .starts_with("tool_"));
        let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        assert!(!cold.execute(request).await.unwrap().success);
        {
            let mut state = f.state.lock().unwrap();
            state.web_operation_invalid = false;
            state.web_response = Some(result());
        }
        let mut recovery = params.clone();
        recovery["operation_key"] = output["operationKey"].clone();
        assert!(
            cold.execute(RuntimeToolExecutionRequest {
                params: &recovery,
                ..request
            })
            .await
            .unwrap()
            .success
        );
        assert_eq!(f.count("/web/searches"), 1);
    }
}

#[tokio::test]
async fn cancelled_web_call_and_disabled_product_do_not_dispatch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let token = tokio_util::sync::CancellationToken::new();
    token.cancel();
    let cancelled = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: root.path().into(),
        session_id: "session-cancelled".into(),
        cancel_token: Some(token.clone()),
        workspace_sandbox: None,
    })
    .with_tool_identity(RuntimeToolExecutionIdentity::new(
        "cancelled-call",
        "turn-cancelled",
    ));
    let params = json!({"query":"Rust release"});
    let live = live();
    let request = RuntimeToolExecutionRequest {
        tool_name: "WebSearch",
        params: &params,
        context: &cancelled,
        turn_context: Some(&live),
    };
    assert_eq!(
        manager.execute(request).await.unwrap_err().message(),
        "cloud_tool_cancelled"
    );
    assert_eq!(f.count("/product-users"), 0);
    let params = search("cancel-at-dispatch-operation", "zh-CN");
    let epoch = store::load(&manager.path).unwrap().epoch;
    assert_eq!(
        manager
            .dispatch_with_cancel(params, &epoch, Some(&token))
            .await
            .unwrap_err(),
        "cloud_tool_cancelled"
    );
    f.state.lock().unwrap().product_disabled = true;
    let context = context();
    assert_eq!(
        manager
            .execute(RuntimeToolExecutionRequest {
                context: &context,
                ..request
            })
            .await
            .unwrap_err()
            .message(),
        "product_user_disabled"
    );
    assert_eq!(f.count("/web/searches"), 0);
}
