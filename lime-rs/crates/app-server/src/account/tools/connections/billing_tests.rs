use super::*;

fn params() -> Value {
    json!({"url":"https://docs.google.com/document/d/doc_original/edit","price_version":"documents.v1","max_credits":"7"})
}

fn priced() -> Value {
    json!({"items":[{"action":"drive.files.read","billingStatus":"priced","price":{"priceVersion":"documents.v1","creditsPerOperation":"7"}}]})
}

fn paid() -> Value {
    let mut result = document();
    result["usage"] = json!({"requests":1,"responseBytes":32,"billingStatus":"settled","billing":{
        "priceVersion":"documents.v1","unit":"credit","creditsPerUnit":"7","reservedCredits":"7","chargedCredits":"7","quantity":"1"
    }});
    result
}

fn call(id: &str) -> RuntimeToolExecutionContext {
    context().with_tool_identity(RuntimeToolExecutionIdentity::new(id, "file-billing-turn"))
}

fn decode(result: RuntimeToolExecutionResult) -> Value {
    serde_json::from_str(&result.output).unwrap()
}

fn original_read_queries(f: &Fixture) -> usize {
    f.state
        .lock()
        .unwrap()
        .calls
        .iter()
        .filter(|(path, _, _)| path.contains("/connection-file-operations/"))
        .count()
}

async fn setup(f: &Fixture, manager: &AccountManager) {
    login(f, manager, "approved").await;
    let mut state = f.state.lock().unwrap();
    state.connection_prices = Some((200, priced()));
    state.connection_file = Some(paid());
}

#[tokio::test]
async fn file_quote_and_budget_refusal_create_no_approval_or_read() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    setup(&f, &manager).await;
    for (id, budget, code) in [
        ("missing", None, "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED"),
        ("stale", Some(("old.v1", "7")), "INTEGRATION_PRICE_CHANGED"),
        (
            "small",
            Some(("documents.v1", "6")),
            "INTEGRATION_BUDGET_EXCEEDED",
        ),
    ] {
        let mut input = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        if let Some((version, maximum)) = budget {
            input["price_version"] = json!(version);
            input["max_credits"] = json!(maximum);
        }
        let body = decode(read(&manager, &input, &call(id), None).await.unwrap());
        assert_eq!(body["errorCode"], code);
        assert_eq!(body["executionStarted"], false);
        assert_eq!(body["quote"]["action"], "drive.files.read");
        assert!(body.get("operationKey").is_none());
        assert_eq!(f.count("/connection-requests"), 0);
        assert_eq!(f.count("/file-reads"), 0);
    }
    assert!(
        read(&manager, &params(), &call("accepted"), None)
            .await
            .unwrap()
            .success
    );
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn file_budget_and_original_receipt_survive_approval_and_cold_recovery() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    setup(&f, &manager).await;
    let context = call("accepted");
    let first = decode(read(&manager, &params(), &context, None).await.unwrap());
    assert_eq!(first["status"], "completed");
    assert_eq!(first["usage"]["billing"]["chargedCredits"], "7");
    {
        let state = f.state.lock().unwrap();
        let (_, body, token) = state
            .calls
            .iter()
            .find(|(p, _, _)| p.ends_with("/file-reads"))
            .unwrap();
        assert_eq!(body["priceVersion"], "documents.v1");
        assert_eq!(body["maxCredits"], "7");
        assert_eq!(token, "Bearer access-connections");
        let (_, approval, _) = state
            .calls
            .iter()
            .find(|(p, _, _)| p.ends_with("/connection-requests"))
            .unwrap();
        assert!(approval.get("priceVersion").is_none());
    }
    f.state.lock().unwrap().connection_prices = Some((503, json!({"error":"unavailable"})));
    let cold = AccountManager::new(root.path(), &config);
    assert_eq!(
        decode(read(&cold, &params(), &context, None).await.unwrap()),
        first
    );
    let mut resume = params();
    resume["operation_key"] = first["operationKey"].clone();
    assert_eq!(
        decode(read(&cold, &resume, &call("resume"), None).await.unwrap()),
        first
    );
    resume["max_credits"] = json!("8");
    assert!(read(&cold, &resume, &call("changed"), None).await.is_err());
    assert_eq!(f.count("/connection-file-prices"), 1);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn five_formal_file_fee_refusals_are_recovered_without_repricing_or_querying_missing_reads() {
    for code in [
        "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED",
        "INTEGRATION_PRICE_CHANGED",
        "INTEGRATION_BUDGET_EXCEEDED",
        "INTEGRATION_CREDITS_INSUFFICIENT",
        "INTEGRATION_CREDITS_POLICY_UNVERIFIED",
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.yaml");
        let manager = AccountManager::new(root.path(), &config);
        setup(&f, &manager).await;
        f.state.lock().unwrap().connection_rejection = Some((409, json!({"error":code})));
        let context = call("rejected");
        let first = decode(read(&manager, &params(), &context, None).await.unwrap());
        assert_eq!(first["errorCode"], code);
        assert_eq!(first["executionStarted"], false);
        let cold = AccountManager::new(root.path(), &config);
        {
            let mut state = f.state.lock().unwrap();
            state.connection_prices = Some((503, json!({"error":"unavailable"})));
            state.connection_request = None;
        }
        assert_eq!(
            decode(read(&cold, &params(), &context, None).await.unwrap()),
            first
        );
        assert_eq!(f.count("/connection-file-prices"), 1);
        assert_eq!(f.count("/file-reads"), 1);
        assert_eq!(original_read_queries(&f), 0);
    }
}

#[tokio::test]
async fn ordinary_file_conflicts_remain_unknown_and_recover_only_the_original_read() {
    for (status, body) in [
        (409, json!({"error":"conflict"})),
        (
            409,
            json!({"error":"INTEGRATION_PRICE_CHANGED","extra":true}),
        ),
        (502, json!({"error":"INTEGRATION_PRICE_CHANGED"})),
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.yaml");
        let manager = AccountManager::new(root.path(), &config);
        setup(&f, &manager).await;
        {
            let mut state = f.state.lock().unwrap();
            state.connection_rejection = Some((status, body));
            state.connection_read_missing = true;
        }
        let context = call("unknown");
        let first = decode(read(&manager, &params(), &context, None).await.unwrap());
        assert_eq!(first["status"], "outcome_unknown");
        assert_ne!(first["executionStarted"], false);
        let cold = AccountManager::new(root.path(), &config);
        let again = decode(read(&cold, &params(), &context, None).await.unwrap());
        assert_eq!(again["operationKey"], first["operationKey"]);
        assert_eq!(f.count("/file-reads"), 1);
        assert_eq!(f.count("/connection-file-prices"), 1);
        assert!(original_read_queries(&f) > 0);
    }
}

#[tokio::test]
async fn invalid_file_quotes_and_budgets_never_create_a_file_request() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    setup(&f, &manager).await;
    for (index, quote) in [
        json!({"items":[{"kind":"page","billingStatus":"unpriced"}]}),
        json!({"items":[{"action":"other.read","billingStatus":"unpriced"}]}),
        json!({"items":[]}),
        json!({"items":[{"action":"drive.files.read","billingStatus":"priced","price":{"priceVersion":"v1","creditsPerOperation":"01"}}]}),
    ].into_iter().enumerate() {
        f.state.lock().unwrap().connection_prices = Some((200, quote));
        assert!(read(&manager, &params(), &call(&format!("quote-{index}")), None).await.is_err());
    }
    let before = f.count("/connection-file-prices");
    for (index, (version, maximum)) in [
        (json!("documents.v1"), Value::Null),
        (Value::Null, json!("7")),
        (json!("documents.v1"), json!(7)),
        (json!("documents.v1"), json!("07")),
        (json!("documents.v1"), json!("9000000000000001")),
    ]
    .into_iter()
    .enumerate()
    {
        let mut input = params();
        input["price_version"] = version;
        input["max_credits"] = maximum;
        assert!(
            read(&manager, &input, &call(&format!("budget-{index}")), None)
                .await
                .is_err()
        );
    }
    assert_eq!(f.count("/connection-file-prices"), before);
    assert_eq!(f.count("/connection-requests"), 0);
    assert_eq!(f.count("/file-reads"), 0);
}

#[test]
fn file_receipts_validate_original_budget_and_expired_results_remain_settled() {
    let input = json!({"priceVersion":"documents.v1","maxCredits":"7"});
    let validate = |body: Value| {
        crate::account::billing::validate_usage(
            &body["usage"],
            body["status"].as_str().unwrap(),
            &input,
        )
    };
    assert!(validate(paid()).is_ok());
    for (field, value) in [
        ("priceVersion", json!("changed")),
        ("chargedCredits", json!("8")),
        ("quantity", json!(1)),
    ] {
        let mut result = paid();
        result["usage"]["billing"][field] = value;
        assert!(validate(result).is_err());
    }
    let mut expired = paid();
    expired["status"] = json!("result_expired");
    expired["errorCode"] = json!("INTEGRATION_RESULT_EXPIRED");
    expired.as_object_mut().unwrap().remove("result");
    assert!(validate(expired.clone()).is_ok());
    expired["usage"]["billingStatus"] = json!("released");
    expired["usage"]["billing"]["quantity"] = json!("0");
    expired["usage"]["billing"]["chargedCredits"] = json!("0");
    assert!(validate(expired).is_err());
}
