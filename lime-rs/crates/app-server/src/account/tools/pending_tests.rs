use super::*;
use tool_runtime::tool_executor::{RuntimeToolExecutionError, RuntimeToolExecutionResult};

fn named_context(session: &str, call: &str, turn: &str) -> RuntimeToolExecutionContext {
    RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: std::env::temp_dir(),
        session_id: session.into(),
        cancel_token: None,
        workspace_sandbox: None,
    })
    .with_tool_identity(RuntimeToolExecutionIdentity::new(call, turn))
}

async fn search_tool(
    manager: &AccountManager,
    params: &Value,
    context: &RuntimeToolExecutionContext,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params,
            context,
            turn_context: Some(&live()),
        })
        .await
}

fn output(result: RuntimeToolExecutionResult) -> Value {
    serde_json::from_str(&result.output).unwrap()
}

#[tokio::test]
async fn pending_web_query_survives_new_call_ids_restart_and_late_old_results() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path());
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let params: Value =
        serde_json::from_str(r#"{"query":"Rust release","allowed_domains":["rust-lang.org"]}"#)
            .unwrap();
    let reordered: Value =
        serde_json::from_str(r#"{"allowed_domains":["rust-lang.org"],"query":"Rust release"}"#)
            .unwrap();
    let first = output(search_tool(&manager, &params, &context()).await.unwrap());
    let cold = AccountManager::new(root.path());
    let later = named_context("session-web", "new-call", "new-turn");
    let resumed = output(search_tool(&cold, &reordered, &later).await.unwrap());
    assert_eq!(resumed["operationKey"], first["operationKey"]);
    assert_eq!(resumed["errorCode"], "operation_not_found");
    assert_eq!(f.count("/web/searches"), 1);
    let changed = json!({"query":"Different query"});
    assert_eq!(
        search_tool(&cold, &changed, &later).await.unwrap_err().message(),
        "operation_key_conflict"
    );
    let token = tokio_util::sync::CancellationToken::new();
    token.cancel();
    let cancelled = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: root.path().into(), session_id:"session-web".into(),
        cancel_token:Some(token), workspace_sandbox:None,
    }).with_tool_identity(RuntimeToolExecutionIdentity::new("cancelled-call", "cancelled-turn"));
    assert_eq!(search_tool(&cold, &params, &cancelled).await.unwrap_err().message(), "cloud_tool_cancelled");
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = false;
        state.web_operation_missing = false;
        state.web_response = Some(result());
    }
    assert!(search_tool(&cold, &params, &later).await.unwrap().success);
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let fresh = named_context("session-web", "fresh-call", "fresh-turn");
    let second = output(search_tool(&cold, &params, &fresh).await.unwrap());
    assert_ne!(second["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/web/searches"), 2);
    let mut wrong_key = params.clone();
    wrong_key["operation_key"] = second["operationKey"].clone();
    assert_eq!(search_tool(&cold, &wrong_key, &later).await.unwrap_err().message(), "operation_key_conflict");
    // A previously aliased call keeps its original operation after completion.
    {
        let mut state = f.state.lock().unwrap();
        state.web_operation_missing = false;
    }
    let late = output(search_tool(&cold, &params, &later).await.unwrap());
    assert_eq!(late["operationKey"], first["operationKey"]);
    f.state.lock().unwrap().web_operation_missing = true;
    let another = named_context("session-web", "another-call", "another-turn");
    let pending = output(search_tool(&cold, &params, &another).await.unwrap());
    assert_eq!(pending["operationKey"], second["operationKey"]);
    assert_eq!(f.count("/web/searches"), 2);
}

#[tokio::test]
async fn invalid_web_results_never_release_the_pending_query() {
    for invalid_json in [false, true] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path());
        f.login(&manager, CloudResource::Default).await;
        f.login(&manager, CloudResource::Web).await;
        {
            let mut state = f.state.lock().unwrap();
            state.invalid_post = true;
            state.web_operation_invalid = invalid_json;
            state.web_response = Some(json!({"status":"completed"}));
        }
        let params = json!({"query":"Rust release"});
        let first = output(search_tool(&manager, &params, &context()).await.unwrap());
        let cold = AccountManager::new(root.path());
        let later = named_context("session-web", "new-call", "new-turn");
        let resumed = output(search_tool(&cold, &params, &later).await.unwrap());
        assert_eq!(resumed["status"], "outcome_unknown");
        assert_eq!(resumed["operationKey"], first["operationKey"]);
        assert_eq!(f.count("/web/searches"), 1);
    }
}

#[tokio::test]
async fn validated_failed_web_result_allows_a_new_query() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path());
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_response = Some(json!({
        "id":"failed_search", "kind":"search", "status":"failed", "errorCode":"INTEGRATION_SEARCH_UNAVAILABLE"
    }));
    let params = json!({"query":"Rust release"});
    let first = output(search_tool(&manager, &params, &context()).await.unwrap());
    assert_eq!(first["status"], "failed");
    f.state.lock().unwrap().web_response = Some(result());
    let later = named_context("session-web", "new-call", "new-turn");
    let second = output(search_tool(&manager, &params, &later).await.unwrap());
    assert_eq!(second["status"], "completed");
    assert_ne!(second["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/web/searches"), 2);
}

#[tokio::test]
async fn pending_web_query_is_scoped_to_original_parameters_session_and_epoch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path());
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let params = json!({"query":"Rust release"});
    let first = output(search_tool(&manager, &params, &context()).await.unwrap());
    let different = named_context("other-session", "new-call", "new-turn");
    let other = output(search_tool(&manager, &params, &different).await.unwrap());
    assert_ne!(other["operationKey"], first["operationKey"]);
    let changed = json!({"query":"Rust release","blocked_domains":["rust-lang.org"]});
    let later = named_context("session-web", "changed-call", "new-turn");
    let changed = output(search_tool(&manager, &changed, &later).await.unwrap());
    assert_ne!(changed["operationKey"], first["operationKey"]);
    manager.logout().unwrap();
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let fresh = named_context("session-web", "fresh-call", "fresh-turn");
    let current = output(search_tool(&manager, &params, &fresh).await.unwrap());
    assert_ne!(current["operationKey"], first["operationKey"]);
    assert_eq!(
        search_tool(&manager, &params, &context())
            .await
            .unwrap_err()
            .message(),
        "account_changed"
    );
    assert_eq!(f.count("/web/searches"), 4);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_new_call_ids_share_one_pending_dispatch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path());
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let params = json!({"query":"Rust release"});
    let first = context();
    let second = named_context("session-web", "concurrent-call", "concurrent-turn");
    let (a, b) = tokio::join!(
        search_tool(&manager, &params, &first),
        search_tool(&manager, &params, &second),
    );
    for result in [a, b] {
        if let Err(error) = result {
            // The existing cross-process lock exposes contention. Retrying the
            // original call must recover its binding rather than make a new one.
            assert_eq!(error.message(), "account_store_busy");
        }
    }
    let a = output(search_tool(&manager, &params, &first).await.unwrap());
    let b = output(search_tool(&manager, &params, &second).await.unwrap());
    assert_eq!(a["operationKey"], b["operationKey"]);
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn missing_pending_intent_never_authorizes_a_second_dispatch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path());
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let params = json!({"query":"Rust release"});
    let first = output(search_tool(&manager, &params, &context()).await.unwrap());
    let key = first["operationKey"].as_str().unwrap();
    std::fs::remove_file(
        root.path()
            .join("credentials/tool-calls")
            .join(format!("{key}.json")),
    )
    .unwrap();
    let later = named_context("session-web", "new-call", "new-turn");
    assert_eq!(
        search_tool(&manager, &params, &later)
            .await
            .unwrap_err()
            .message(),
        "operation_store_invalid"
    );
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn pending_page_read_reuses_original_operation_with_a_new_call_id() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path());
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_response = Some(json!({"status":"completed"}));
    let params = json!({"url":"https://www.rust-lang.org/","prompt":"ownership"});
    let context = context();
    let live = live();
    let request = RuntimeToolExecutionRequest {
        tool_name: "WebFetch",
        params: &params,
        context: &context,
        turn_context: Some(&live),
    };
    let first = output(manager.execute(request).await.unwrap());
    assert_eq!(first["status"], "outcome_unknown");
    f.state.lock().unwrap().web_response = Some(json!({
        "id":"page_1", "kind":"page", "status":"completed", "page":{
            "url":params["url"], "finalUrl":params["url"], "text":"Ownership rules.",
            "title":"Rust", "retrievedAt":"2026-11-12T00:00:00Z", "truncated":false
        }
    }));
    let later = named_context("session-web", "new-call", "new-turn");
    let cold = AccountManager::new(root.path());
    let resumed = output(
        cold.execute(RuntimeToolExecutionRequest {
            context: &later,
            ..request
        })
        .await
        .unwrap(),
    );
    assert_eq!(resumed["status"], "completed");
    assert_eq!(resumed["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/web/pages"), 1);
}
