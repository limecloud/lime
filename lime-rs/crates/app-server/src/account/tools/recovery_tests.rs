use super::*;
use crate::account::tests::recovery_tests::summary;
use tool_runtime::tool_executor::RuntimeToolExecutionResult;

async fn search_tool(
    manager: &AccountManager,
    context: &RuntimeToolExecutionContext,
) -> Result<RuntimeToolExecutionResult, tool_runtime::tool_executor::RuntimeToolExecutionError> {
    manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &json!({"query":"Rust release"}),
            context,
            turn_context: Some(&live()),
        })
        .await
}

fn next(call: &str) -> RuntimeToolExecutionContext {
    context().with_tool_identity(RuntimeToolExecutionIdentity::new(call, "later-turn"))
}

#[tokio::test]
async fn disabled_web_summary_preserves_pending_intent_until_a_full_result_is_validated() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let first: Value =
        serde_json::from_str(&search_tool(&manager, &context()).await.unwrap().output).unwrap();
    let key = first["operationKey"].as_str().unwrap();
    {
        let mut state = f.state.lock().unwrap();
        state.product_disabled = true;
        state.summary_response = Some((200, summary("search", "completed")));
    }
    let cold = AccountManager::new(root.path(), &config);
    for call in ["disabled-first", "disabled-second"] {
        let result = search_tool(&cold, &next(call)).await.unwrap();
        assert!(!result.success);
        let body: Value = serde_json::from_str(&result.output).unwrap();
        assert_eq!(body["status"], "outcome_unknown");
        assert_eq!(body["recoveryOnly"], true);
        assert_eq!(body["summary"]["status"], "completed");
        assert_eq!(body["operationKey"], key);
        assert!(body.get("search").is_none());
        let account = cold.read(Default::default()).unwrap().account.unwrap();
        assert_eq!(
            cold.operation(&account, key).unwrap().unwrap().status,
            "outcome_unknown"
        );
    }
    assert_eq!(f.count(&format!("/recovery/web/operations/{key}")), 2);
    assert_eq!(f.count("/web/searches"), 1);
    assert_eq!(f.count("/product-users"), 1);
    {
        let mut state = f.state.lock().unwrap();
        state.product_disabled = false;
        state.invalid_post = false;
        state.web_operation_missing = false;
        state.web_response = Some(result());
    }
    let restored = search_tool(&cold, &next("restored")).await.unwrap();
    assert!(restored.success);
    assert_eq!(
        serde_json::from_str::<Value>(&restored.output).unwrap()["operationKey"],
        key
    );
    assert_eq!(f.count("/web/searches"), 1);
    let fresh = search_tool(&cold, &next("fresh")).await.unwrap();
    assert!(fresh.success);
    assert_ne!(
        serde_json::from_str::<Value>(&fresh.output).unwrap()["operationKey"],
        key
    );
    assert_eq!(f.count("/web/searches"), 2);
}

#[tokio::test]
async fn summary_faults_keep_the_original_key_and_never_publish_invalid_data() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let first: Value =
        serde_json::from_str(&search_tool(&manager, &context()).await.unwrap().output).unwrap();
    f.state.lock().unwrap().product_disabled = true;
    let mut invalid = summary("search", "completed");
    invalid["text"] = json!("private-invalid-summary-content");
    for (index, response) in [
        (403, json!({"error":"access_denied"})),
        (404, json!({"error":"not_found"})),
        (503, json!({"error":"unavailable"})),
        (200, invalid),
        (200, summary("search", "completed")),
    ]
    .into_iter()
    .enumerate()
    {
        f.state.lock().unwrap().summary_response = Some(response);
        let result = search_tool(&manager, &next(&format!("fault-{index}")))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(!result.output.contains("private-invalid-summary-content"));
        let body: Value = serde_json::from_str(&result.output).unwrap();
        assert_eq!(body["status"], "outcome_unknown");
        assert_eq!(body["operationKey"], first["operationKey"]);
    }
    assert_eq!(f.count("/web/searches"), 1);
    assert_eq!(f.count("/product-users"), 1);
}

#[tokio::test]
async fn product_disabled_during_full_result_read_switches_to_the_original_summary() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.invalid_post = true;
        state.web_operation_missing = true;
    }
    let first: Value =
        serde_json::from_str(&search_tool(&manager, &context()).await.unwrap().output).unwrap();
    {
        let mut state = f.state.lock().unwrap();
        state.disable_product_on_result = true;
        state.summary_response = Some((200, summary("search", "failed")));
    }
    let result = search_tool(&manager, &next("during-read")).await.unwrap();
    assert!(!result.success);
    let body: Value = serde_json::from_str(&result.output).unwrap();
    assert_eq!(body["recoveryOnly"], true);
    assert_eq!(body["summary"]["status"], "failed");
    assert_eq!(body["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/web/searches"), 1);
    assert_eq!(f.count("/product-users"), 1);
}

#[tokio::test]
async fn disabled_new_web_call_has_no_summary_or_business_dispatch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().product_disabled = true;
    assert_eq!(
        search_tool(&manager, &context())
            .await
            .unwrap_err()
            .message(),
        "product_user_disabled"
    );
    assert_eq!(f.count("/web/searches"), 0);
    assert_eq!(f.count("/product-users"), 0);
    assert!(!f
        .state
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|(p, _, _)| p.contains("/recovery/")));
}
