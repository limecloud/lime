use super::*;

pub(super) fn summary(kind: &str, status: &str) -> Value {
    let mut value = json!({"id":"original_result","kind":kind,"status":status,"recoveryOnly":true,"createdAt":"2026-11-12T00:00:00Z"});
    match kind {
        "market" => value["command"] = json!("acquisition.create"),
        "connection_request" => value["expiresAt"] = json!("2026-11-12T00:30:00Z"),
        _ => {
            value["usage"] = json!({"requests":1,"responseBytes":32,"billingStatus":"unpriced"});
        }
    }
    value
}

fn seed(
    manager: &AccountManager,
    key: &str,
    path: &str,
    result_path: &str,
) -> operations::Operation {
    let state = store::load(&manager.path).unwrap();
    let original = operations::Operation {
        key: key.into(),
        task_id: "original-task".into(),
        path: path.into(),
        input: json!({"original":true}),
        language: "zh-CN".into(),
        recovery_path: format!("{result_path}{key}"),
        status: "outcome_unknown".into(),
        rejection_code: None,
        created_at: "2026-11-12T00:00:00Z".into(),
    };
    assert!(manager
        .begin_operation(state.account.as_ref().unwrap(), &state.epoch, &original)
        .unwrap());
    original
}

fn get(path: &str) -> CloudRequestParams {
    CloudRequestParams {
        path: path.into(),
        method: CloudRequestMethod::Get,
        body: None,
        operation_key: None,
        task_id: None,
        language: "en-US".into(),
    }
}

#[tokio::test]
async fn billed_summary_preserves_the_original_price_and_budget_after_product_suspension() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let state = store::load(&manager.path).unwrap();
    let original = operations::Operation {
        key: "priced_summary_original".into(),
        task_id: "original-task".into(),
        path: "/web/searches".into(),
        input: json!({"query":"Rust","priceVersion":"v1","maxCredits":"7"}),
        language: "zh-CN".into(),
        recovery_path: "/web/operations/priced_summary_original".into(),
        status: "outcome_unknown".into(),
        rejection_code: None,
        created_at: "2026-11-12T00:00:00Z".into(),
    };
    assert!(manager
        .begin_operation(state.account.as_ref().unwrap(), &state.epoch, &original)
        .unwrap());
    let mut body = summary("search", "completed");
    body["usage"] = json!({"requests":1,"responseBytes":32,"billingStatus":"settled","billing":{
        "priceVersion":"v1","unit":"credit","creditsPerUnit":"7","reservedCredits":"7","chargedCredits":"7","quantity":"1"
    }});
    f.state.lock().unwrap().product_disabled = true;
    let path = format!("/recovery{}", original.recovery_path);
    f.state.lock().unwrap().summary_response = Some((200, body.clone()));
    assert_eq!(manager.request(get(&path)).await.unwrap().body, body);
    for (field, value) in [
        ("priceVersion", json!("v2")),
        ("chargedCredits", json!("8")),
        ("quantity", json!(1)),
    ] {
        let mut changed = body.clone();
        changed["usage"]["billing"][field] = value;
        f.state.lock().unwrap().summary_response = Some((200, changed));
        assert_eq!(
            manager.request(get(&path)).await.unwrap_err(),
            "cloud_response_invalid"
        );
    }
    let cold = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.state.lock().unwrap().summary_response = Some((200, body.clone()));
    assert_eq!(cold.request(get(&path)).await.unwrap().body, body);
    assert_eq!(f.count("/product-users"), 0);
    assert_eq!(f.count("/product-users/self"), 0);
    assert_eq!(f.count("/web/prices"), 0);
    assert_eq!(f.count("/web/searches"), 0);
    assert_eq!(
        cold.operation(state.account.as_ref().unwrap(), &original.key)
            .unwrap()
            .unwrap()
            .status,
        "outcome_unknown"
    );
}

#[tokio::test]
async fn billed_file_summary_keeps_original_budget_without_returning_document_content() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Connections).await;
    let state = store::load(&manager.path).unwrap();
    let original = operations::Operation {
        key: "file_priced_summary_original".into(),
        task_id: "original-task".into(),
        path: "/connections/icn_original/file-reads".into(),
        input: json!({"contractRevision":"google-docs.read.v1","grantId":"icg_original","fileId":"doc_original","maxCharacters":20000,"priceVersion":"files.v1","maxCredits":"7"}),
        language: "zh-CN".into(),
        recovery_path: "/connection-file-operations/operations/file_priced_summary_original".into(),
        status: "outcome_unknown".into(),
        rejection_code: None,
        created_at: "2026-11-12T00:00:00Z".into(),
    };
    assert!(manager
        .begin_operation(state.account.as_ref().unwrap(), &state.epoch, &original)
        .unwrap());
    let mut body = summary("connection_file", "result_expired");
    body["usage"] = json!({"requests":1,"responseBytes":32,"billingStatus":"settled","billing":{
        "priceVersion":"files.v1","unit":"credit","creditsPerUnit":"7","reservedCredits":"7","chargedCredits":"7","quantity":"1"
    }});
    f.state.lock().unwrap().product_disabled = true;
    let path = format!("/recovery{}", original.recovery_path);
    f.state.lock().unwrap().summary_response = Some((200, body.clone()));
    assert_eq!(manager.request(get(&path)).await.unwrap().body, body);
    let cold = AccountManager::new(root.path(), &config);
    assert_eq!(cold.request(get(&path)).await.unwrap().body, body);
    assert!(body.get("result").is_none());
    body["usage"]["billing"]["priceVersion"] = json!("changed");
    f.state.lock().unwrap().summary_response = Some((200, body));
    assert_eq!(
        cold.request(get(&path)).await.unwrap_err(),
        "cloud_response_invalid"
    );
    assert_eq!(f.count("/connection-file-prices"), 0);
    assert_eq!(f.count("/file-reads"), 0);
    assert_eq!(f.count("/product-users"), 0);
}

#[tokio::test]
async fn summaries_use_exact_resources_and_never_resolve_or_register_operations() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    for resource in [
        CloudResource::Default,
        CloudResource::Market,
        CloudResource::Web,
        CloudResource::Connections,
    ] {
        f.login(&manager, resource).await;
    }
    f.state.lock().unwrap().product_disabled = true;
    for (index, (path, result_path, kind, status)) in [
        (
            "/market/acquisitions",
            "/market/operations/",
            "market",
            "completed",
        ),
        (
            "/market/acquisitions/acq_original/revocations",
            "/market/operations/",
            "market",
            "completed",
        ),
        (
            "/market/acquisitions/acq_original/download-tickets",
            "/market/operations/",
            "market",
            "completed",
        ),
        ("/web/searches", "/web/operations/", "search", "completed"),
        ("/web/pages", "/web/operations/", "page", "failed"),
        (
            "/connection-requests",
            "/connection-requests/operations/",
            "connection_request",
            "approved",
        ),
        (
            "/connections/icn_original/file-reads",
            "/connection-file-operations/operations/",
            "connection_file",
            "result_expired",
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let key = format!("summary_original_{index:04}");
        let original = seed(&manager, &key, path, result_path);
        let mut body = summary(kind, status);
        if path.ends_with("/revocations") {
            body["command"] = json!("acquisition.revoke");
        } else if path.ends_with("/download-tickets") {
            body["command"] = json!("acquisition.download");
        }
        f.state.lock().unwrap().summary_response = Some((200, body.clone()));
        let response = manager
            .request(get(&format!("/recovery{}", original.recovery_path)))
            .await
            .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, body);
        assert!(response.operation.is_none());
        assert_eq!(
            serde_json::to_value(manager.operation(&response.account, &key).unwrap().unwrap())
                .unwrap(),
            serde_json::to_value(original).unwrap()
        );
    }
    assert_eq!(f.count("/product-users"), 0);
    assert_eq!(f.count("/product-users/self"), 0);
    assert_eq!(f.count("/web/searches"), 0);
    assert_eq!(f.count("/connection-requests"), 0);
    assert_eq!(f.count("/file-reads"), 0);
}

#[tokio::test]
async fn missing_or_mismatched_originals_and_invalid_routes_have_zero_network_access() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let original = seed(
        &manager,
        "summary_original_key",
        "/web/searches",
        "/web/operations/",
    );
    store::update(&manager.path, |state| {
        state
            .credentials
            .get_mut(&CloudResource::Web)
            .unwrap()
            .expires_at = 0;
        Ok(())
    })
    .unwrap();
    f.state.lock().unwrap().calls.clear();
    for path in [
        "/recovery/web/operations/summary_missing_key",
        "/recovery/market/operations/summary_original_key",
        "/recovery/connection-requests/operations/summary_original_key",
        "/recovery/web/operations/summary_original_key?",
        "/recovery/web/operations/summary_original_key?other=1",
        "/recovery/web/operations/%73ummary_original_key",
        "/recovery/web/operations/summary_original_key/extra",
    ] {
        assert!(manager.request(get(path)).await.is_err(), "{path}");
    }
    let path = format!("/recovery{}", original.recovery_path);
    let mut params = get(&path);
    params.body = Some(json!({}));
    assert!(manager.request(params).await.is_err());
    let mut params = get(&path);
    params.method = CloudRequestMethod::Post;
    params.body = Some(json!({}));
    assert!(manager.request(params).await.is_err());
    let mut params = get(&path);
    params.operation_key = Some(original.key.clone());
    assert!(manager.request(params).await.is_err());
    let mut params = get(&path);
    params.task_id = Some("new-task".into());
    assert!(manager.request(params).await.is_err());
    assert!(f.state.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn invalid_summary_fields_types_and_capabilities_never_publish_or_resolve() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let original = seed(
        &manager,
        "summary_original_key",
        "/web/searches",
        "/web/operations/",
    );
    let path = format!("/recovery{}", original.recovery_path);
    let valid = summary("search", "completed");
    let mut invalid = Vec::new();
    for key in ["id", "kind", "status", "recoveryOnly", "createdAt", "usage"] {
        let mut body = valid.clone();
        body.as_object_mut().unwrap().remove(key);
        invalid.push(body);
    }
    for (key, value) in [
        ("recoveryOnly", json!(false)),
        ("kind", json!("page")),
        ("status", json!("approved")),
        ("createdAt", json!("invalid")),
        ("finishedAt", Value::Null),
        ("finishedAt", json!("2026-11-11T00:00:00Z")),
        ("errorCode", json!("unsafe error")),
        ("id", json!("../invalid")),
        ("command", json!("acquisition.create")),
        ("expiresAt", json!("2026-11-12T00:30:00Z")),
        ("text", json!("private-content")),
        ("approvalUrl", json!("https://untrusted.test")),
        ("grantId", json!("icg_private")),
        ("downloadUrl", json!("https://untrusted.test")),
    ] {
        let mut body = valid.clone();
        body[key] = value;
        invalid.push(body);
    }
    for usage in [
        json!({"requests":-1,"responseBytes":32,"billingStatus":"unpriced"}),
        json!({"requests":1,"responseBytes":1.5,"billingStatus":"unpriced"}),
        json!({"requests":1,"responseBytes":32,"billingStatus":"paid"}),
        json!({"requests":1,"responseBytes":32,"billingStatus":"unpriced","credential":"private"}),
    ] {
        let mut body = valid.clone();
        body["usage"] = usage;
        invalid.push(body);
    }
    for body in invalid {
        f.state.lock().unwrap().summary_response = Some((200, body));
        assert_eq!(
            manager.request(get(&path)).await.unwrap_err(),
            "cloud_response_invalid"
        );
    }
    let account = manager.read(Default::default()).unwrap().account.unwrap();
    assert_eq!(
        manager
            .operation(&account, &original.key)
            .unwrap()
            .unwrap()
            .status,
        "outcome_unknown"
    );
    assert_eq!(f.count("/product-users"), 0);
}

#[tokio::test]
async fn summary_refusal_missing_resource_and_changed_account_never_create_operations() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    let original = seed(
        &manager,
        "summary_original_key",
        "/web/searches",
        "/web/operations/",
    );
    let path = format!("/recovery{}", original.recovery_path);
    assert_eq!(
        manager.request(get(&path)).await.unwrap_err(),
        "resource_login_required"
    );
    f.login(&manager, CloudResource::Web).await;
    for status in [401, 403, 404, 503] {
        f.state.lock().unwrap().summary_response = Some((status, json!({"error":"refused"})));
        assert_eq!(manager.request(get(&path)).await.unwrap().status, status);
    }
    manager.logout().unwrap();
    let before = f.state.lock().unwrap().calls.len();
    assert_eq!(
        manager.request(get(&path)).await.unwrap_err(),
        "account_login_required"
    );
    assert_eq!(f.state.lock().unwrap().calls.len(), before);
    f.state.lock().unwrap().user = "person-b".into();
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let before = f.state.lock().unwrap().calls.len();
    assert_eq!(
        manager.request(get(&path)).await.unwrap_err(),
        "operation_not_found"
    );
    assert_eq!(f.state.lock().unwrap().calls.len(), before);
    assert_eq!(f.count("/product-users"), 0);
}

#[tokio::test]
async fn logout_during_summary_read_fences_the_old_result() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.login(&manager, CloudResource::Web).await;
    let original = seed(
        &manager,
        "summary_original_key",
        "/web/searches",
        "/web/operations/",
    );
    let path = format!("/recovery{}", original.recovery_path);
    {
        let mut state = f.state.lock().unwrap();
        state.summary_response = Some((200, summary("search", "completed")));
        state.summary_delay = true;
    }
    let future = manager.request(get(&path));
    tokio::pin!(future);
    tokio::select! {
        result = &mut future => panic!("unexpected result {result:?}"),
        _ = async {
            while f.count(&path) == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
        } => {}
    }
    manager.logout().unwrap();
    assert!(future.await.is_err());
    assert!(manager.read(Default::default()).unwrap().account.is_none());
}
