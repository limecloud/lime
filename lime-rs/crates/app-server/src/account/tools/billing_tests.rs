use super::*;
use tool_runtime::tool_executor::RuntimeToolExecutionResult;

fn priced() -> Value {
    json!({"items":[{"kind":"search","billingStatus":"priced","price":{"priceVersion":"search.v1","creditsPerOperation":"7"}},{"kind":"page","billingStatus":"unpriced"}]})
}

fn paid_result() -> Value {
    let mut body = result();
    body["usage"] = json!({"requests":1,"responseBytes":32,"billingStatus":"settled","billing":{
        "priceVersion":"search.v1","unit":"credit","creditsPerUnit":"7","reservedCredits":"7","chargedCredits":"7","quantity":"1"
    }});
    body
}

fn call(id: &str) -> RuntimeToolExecutionContext {
    context().with_tool_identity(RuntimeToolExecutionIdentity::new(id, "turn-web"))
}

async fn search(
    manager: &AccountManager,
    params: &Value,
    context: &RuntimeToolExecutionContext,
) -> RuntimeToolExecutionResult {
    manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params,
            context,
            turn_context: Some(&live()),
        })
        .await
        .unwrap()
}

fn decoded(result: RuntimeToolExecutionResult) -> Value {
    serde_json::from_str(&result.output).unwrap()
}

#[tokio::test]
async fn priced_search_keeps_budget_receipt_and_original_price_across_cold_recovery() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    {
        let mut state = f.state.lock().unwrap();
        state.web_prices = Some((200, priced()));
        state.web_response = Some(paid_result());
    }
    let params = json!({"query":"Rust release","price_version":"search.v1","max_credits":"7"});
    let first = search(&manager, &params, &context()).await;
    assert!(first.success);
    let first = decoded(first);
    assert_eq!(first["usage"]["billing"]["chargedCredits"], "7");
    let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.state.lock().unwrap().web_prices = Some((503, json!({"error":"unavailable"})));
    let again = decoded(search(&cold, &params, &context()).await);
    assert_eq!(again["operationKey"], first["operationKey"]);
    let mut original = params.clone();
    original["operation_key"] = first["operationKey"].clone();
    assert!(search(&cold, &original, &call("recovery")).await.success);
    assert_eq!(f.count("/web/prices"), 1);
    assert_eq!(f.count("/web/searches"), 1);
    let state = f.state.lock().unwrap();
    let sent = state
        .calls
        .iter()
        .find(|(path, _, _)| path.ends_with("/web/searches"))
        .unwrap();
    assert_eq!(
        sent.1,
        json!({"query":"Rust release","limit":10,"priceVersion":"search.v1","maxCredits":"7"})
    );
    assert_eq!(sent.2, "Bearer access-web");
}

#[tokio::test]
async fn priced_page_preserves_its_budget_and_receipt_without_sending_the_local_prompt() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let mut prices = priced();
    prices["items"][1] = json!({"kind":"page","billingStatus":"priced","price":{"priceVersion":"page.v1","creditsPerOperation":"3"}});
    let mut page = paid_result();
    page["id"] = json!("web_page_paid");
    page["kind"] = json!("page");
    page.as_object_mut().unwrap().remove("search");
    page["page"] = json!({"url":"https://www.rust-lang.org/","finalUrl":"https://www.rust-lang.org/","title":"Rust","text":"Rust ownership rules.","retrievedAt":"2026-11-12T00:00:00Z","truncated":false});
    page["usage"]["billing"] = json!({"priceVersion":"page.v1","unit":"credit","creditsPerUnit":"3","reservedCredits":"3","chargedCredits":"3","quantity":"1"});
    {
        let mut state = f.state.lock().unwrap();
        state.web_prices = Some((200, prices));
        state.web_response = Some(page);
    }
    let params = json!({"url":"https://www.rust-lang.org/","prompt":"ownership","max_chars":1000,"price_version":"page.v1","max_credits":"3"});
    let request = |manager: AccountManager, params: Value| async move {
        let response = manager
            .execute(RuntimeToolExecutionRequest {
                tool_name: "WebFetch",
                params: &params,
                context: &context(),
                turn_context: Some(&live()),
            })
            .await
            .unwrap();
        assert!(response.success);
        decoded(response)
    };
    let first = request(manager, params.clone()).await;
    assert_eq!(first["usage"]["billing"]["chargedCredits"], "3");
    f.state.lock().unwrap().web_prices = Some((503, json!({"error":"unavailable"})));
    let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    assert_eq!(request(cold, params).await, first);
    let state = f.state.lock().unwrap();
    let posts = state
        .calls
        .iter()
        .filter(|(path, _, _)| path.ends_with("/web/pages"))
        .collect::<Vec<_>>();
    assert_eq!(posts.len(), 1);
    assert_eq!(
        posts[0].1,
        json!({"url":"https://www.rust-lang.org/","maxCharacters":1000,"priceVersion":"page.v1","maxCredits":"3"})
    );
    assert_eq!(
        state
            .calls
            .iter()
            .filter(|(path, _, _)| path.ends_with("/web/prices"))
            .count(),
        1
    );
}

#[tokio::test]
async fn price_acceptance_never_dispatches_or_chooses_a_budget_and_releases_pending_intent() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_prices = Some((200, priced()));
    let params = json!({"query":"Rust release"});
    let first = decoded(search(&manager, &params, &context()).await);
    assert_eq!(first["status"], "price_acceptance_required");
    assert_eq!(first["quote"]["price"]["creditsPerOperation"], "7");
    assert_eq!(first["executionStarted"], false);
    assert!(first.get("operationKey").is_none());
    assert_eq!(f.count("/web/searches"), 0);
    // The same arguments in a new call do not inherit a terminal preflight.
    f.state.lock().unwrap().web_prices = None;
    f.state.lock().unwrap().web_response = Some(result());
    assert!(
        search(&manager, &params, &call("unpriced-new-call"))
            .await
            .success
    );
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn explicit_budget_can_follow_a_quote_and_stale_or_insufficient_budgets_never_post() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    f.state.lock().unwrap().web_prices = Some((200, priced()));
    for (id, version, maximum, code) in [
        (
            "missing-budget",
            None,
            None,
            "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED",
        ),
        (
            "changed-version",
            Some("old.v1"),
            Some("7"),
            "INTEGRATION_PRICE_CHANGED",
        ),
        (
            "small-budget",
            Some("search.v1"),
            Some("6"),
            "INTEGRATION_BUDGET_EXCEEDED",
        ),
    ] {
        let mut params = json!({"query":"Rust release"});
        if let Some(version) = version {
            params["price_version"] = json!(version);
            params["max_credits"] = json!(maximum.unwrap());
        }
        let output = decoded(search(&manager, &params, &call(id)).await);
        assert_eq!(output["errorCode"], code);
        assert_eq!(output["executionStarted"], false);
        assert_eq!(f.count("/web/searches"), 0);
    }
    f.state.lock().unwrap().web_response = Some(paid_result());
    let params = json!({"query":"Rust release","price_version":"search.v1","max_credits":"7"});
    assert!(
        search(&manager, &params, &call("accepted-budget"))
            .await
            .success
    );
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn exact_budget_rejections_survive_restart_without_quoting_polling_or_reposting() {
    for code in [
        "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED",
        "INTEGRATION_PRICE_CHANGED",
        "INTEGRATION_BUDGET_EXCEEDED",
        "INTEGRATION_CREDITS_INSUFFICIENT",
        "INTEGRATION_CREDITS_POLICY_UNVERIFIED",
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        f.login(&manager, CloudResource::Default).await;
        f.login(&manager, CloudResource::Web).await;
        {
            let mut state = f.state.lock().unwrap();
            state.web_prices = Some((200, priced()));
            state.web_rejection = Some((409, json!({"error":code})));
        }
        let params = json!({"query":"Rust release","price_version":"search.v1","max_credits":"7"});
        let first = decoded(search(&manager, &params, &context()).await);
        assert_eq!(first["status"], "failed");
        assert_eq!(first["errorCode"], code);
        assert_eq!(first["executionStarted"], false);
        let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        let before = f.state.lock().unwrap().calls.len();
        assert_eq!(decoded(search(&cold, &params, &context()).await), first);
        assert_eq!(f.state.lock().unwrap().calls.len(), before);
        assert_eq!(f.count("/web/prices"), 1);
        assert_eq!(f.count("/web/searches"), 1);
        assert!(!f
            .state
            .lock()
            .unwrap()
            .calls
            .iter()
            .any(|(path, _, _)| path.contains("/web/operations/")));
        f.state.lock().unwrap().web_rejection = None;
        f.state.lock().unwrap().web_response = Some(paid_result());
        assert!(
            search(&cold, &params, &call("new-explicit-attempt"))
                .await
                .success
        );
        assert_eq!(f.count("/web/searches"), 2);
    }
}

#[tokio::test]
async fn ambiguous_conflicts_keep_the_original_operation_unknown() {
    for (status, body) in [
        (409, json!({"error":"INTEGRATION_OPERATION_CONFLICT"})),
        (
            409,
            json!({"error":"INTEGRATION_PRICE_CHANGED","untrusted":true}),
        ),
        (503, json!({"error":"INTEGRATION_PRICE_CHANGED"})),
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        f.login(&manager, CloudResource::Default).await;
        f.login(&manager, CloudResource::Web).await;
        {
            let mut state = f.state.lock().unwrap();
            state.web_rejection = Some((status, body));
            state.web_operation_missing = true;
        }
        let params = json!({"query":"Rust release"});
        let first = decoded(search(&manager, &params, &context()).await);
        assert_eq!(first["status"], "outcome_unknown");
        assert!(first["operationKey"].is_string());
        let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        let second = decoded(search(&cold, &params, &context()).await);
        assert_eq!(second["operationKey"], first["operationKey"]);
        assert_eq!(f.count("/web/searches"), 1);
        assert_eq!(f.count("/web/prices"), 1);
    }
}

#[tokio::test]
async fn invalid_budgets_fail_before_login_or_network_and_cloud_schemas_declare_the_pair() {
    let root = tempfile::tempdir().unwrap();
    let manager = Arc::new(AccountManager::new(
        root.path(),
        &root.path().join("config.yaml"),
    ));
    for budget in [
        json!({"price_version":"v1"}),
        json!({"max_credits":"7"}),
        json!({"price_version":"v1","max_credits":7}),
        json!({"price_version":"v1","max_credits":"01"}),
        json!({"price_version":"v1","max_credits":"9000000000000001"}),
        json!({"price_version":null,"max_credits":null}),
    ] {
        let mut params = budget;
        params["query"] = json!("Rust release");
        let error = manager
            .execute(RuntimeToolExecutionRequest {
                tool_name: "WebSearch",
                params: &params,
                context: &context(),
                turn_context: Some(&live()),
            })
            .await
            .unwrap_err();
        assert_eq!(error.message(), "cloud_tool_input_invalid");
        assert!(manager.read(Default::default()).unwrap().account.is_none());
    }
    for registration in manager.tool_registrations().iter().take(2) {
        let schema = registration.definition().input_schema;
        assert_eq!(schema["properties"]["max_credits"]["type"], "string");
        assert_eq!(
            schema["dependentRequired"]["price_version"],
            json!(["max_credits"])
        );
    }
}
