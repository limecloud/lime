use super::*;
use chrono::DateTime;

#[tokio::test]
async fn signed_short_approval_bounds_file_request_after_refresh_and_cold_recovery() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    let limit = Utc::now().timestamp() + 300;
    f.state.lock().unwrap().connection_claims =
        Some(json!({"lime_test_approval_expires_at":limit as f64}));
    login(&f, &manager, "approved").await;
    f.state.lock().unwrap().connection_request.as_mut().unwrap()["expiresAt"] =
        json!(DateTime::from_timestamp(limit, 0).unwrap().to_rfc3339());
    store::update(&manager.path, |state| {
        state
            .credentials
            .get_mut(&CloudResource::Connections)
            .unwrap()
            .expires_at = 0;
        Ok(())
    })
    .unwrap();
    // A later token carries a longer approval claim, but refresh cannot extend
    // the independently verified original authorization.
    f.state.lock().unwrap().connection_claims =
        Some(json!({"lime_test_approval_expires_at":limit + 3600}));
    let (_, _, refreshed) = manager
        .credential(CloudResource::Connections, "zh-CN")
        .await
        .unwrap();
    assert_eq!(refreshed.authorization_expires_at, Some(limit));
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let context = context();
    let first = read(&manager, &params, &context, None).await.unwrap();
    assert!(first.success, "{}", first.output);
    let body: Value = serde_json::from_str(&first.output).unwrap();
    let cold = AccountManager::new(root.path(), &config);
    let recovered = read(&cold, &params, &context, None).await.unwrap();
    assert!(recovered.success, "{}", recovered.output);
    let recovered: Value = serde_json::from_str(&recovered.output).unwrap();
    assert_eq!(recovered["operationKey"], body["operationKey"]);
    assert_eq!(recovered["readOperationKey"], body["readOperationKey"]);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
    let state = f.state.lock().unwrap();
    let (_, request, _) = state
        .calls
        .iter()
        .find(|(path, input, _)| path.ends_with("/connection-requests") && !input.is_null())
        .unwrap();
    let expires = DateTime::parse_from_rfc3339(request["expiresAt"].as_str().unwrap()).unwrap();
    assert_eq!(expires.timestamp(), limit);
    assert!(!first.output.contains("lime_test_approval_expires_at"));
}

#[tokio::test]
async fn invalid_signed_connection_approval_never_completes_authorization() {
    for claims in [
        json!({"lime_test_approval_expires_at":null}),
        json!({"lime_test_approval_expires_at":Utc::now().timestamp() - 1}),
        json!({"lime_test_approval_expires_at":"300"}),
        json!({"lime_test_approval_expires_at":i64::MAX}),
        json!({"lime_test_approval_expires_at":Utc::now().timestamp() as f64 + 300.5}),
        json!({"lime_authorization_source":"installation"}),
        json!({"lime_application_id":"another-app"}),
        json!({"lime_environment":"production"}),
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        f.login(&manager, CloudResource::Default).await;
        f.state.lock().unwrap().connection_claims = Some(claims.clone());
        let id = f.login(&manager, CloudResource::Connections).await;
        let state = store::load(&manager.path).unwrap();
        let authorization = &state.authorizations[&CloudResource::Connections].public;
        assert_eq!(authorization.id, id);
        assert_eq!(
            authorization.status,
            AccountAuthorizationStatus::OutcomeUnknown,
            "{claims}"
        );
        assert!(!state.credentials.contains_key(&CloudResource::Connections));
        assert_eq!(f.count("/connection-requests"), 0);
        assert_eq!(f.count("/file-reads"), 0);
    }
}

#[tokio::test]
async fn missing_or_expired_saved_approval_never_dispatches_a_new_task() {
    for limit in [None, Some(Utc::now().timestamp() - 1), Some(i64::MAX)] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        login(&f, &manager, "approved").await;
        store::update(&manager.path, |state| {
            state
                .credentials
                .get_mut(&CloudResource::Connections)
                .unwrap()
                .authorization_expires_at = limit;
            Ok(())
        })
        .unwrap();
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        assert!(
            read(&manager, &params, &context(), None).await.is_err(),
            "{limit:?}"
        );
        assert_eq!(f.count("/connection-requests"), 0);
        assert_eq!(f.count("/file-reads"), 0);
        assert_eq!(
            store::load(&manager.path).unwrap().credentials[&CloudResource::Connections]
                .authorization_expires_at,
            limit
        );
    }
}
