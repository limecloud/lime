use super::*;
use crate::account::tests::recovery_tests::summary;

#[tokio::test]
async fn disabled_approved_request_summary_never_starts_a_file_read() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    login(&f, &manager, "approved").await;
    f.state.lock().unwrap().connection_request_unknown = true;
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let first = read(&manager, &params, &context(), None).await.unwrap();
    let first: Value = serde_json::from_str(&first.output).unwrap();
    {
        let mut state = f.state.lock().unwrap();
        state.product_disabled = true;
        state.summary_response = Some((200, summary("connection_request", "approved")));
    }
    let cold = AccountManager::new(root.path(), &config);
    for call in ["disabled-one", "disabled-two"] {
        let context =
            context().with_tool_identity(RuntimeToolExecutionIdentity::new(call, "later-turn"));
        let result = read(&cold, &params, &context, None).await.unwrap();
        assert!(!result.success);
        let body: Value = serde_json::from_str(&result.output).unwrap();
        assert_eq!(body["status"], "outcome_unknown");
        assert_eq!(body["recoveryOnly"], true);
        assert_eq!(body["summary"]["status"], "approved");
        assert_eq!(body["operationKey"], first["operationKey"]);
        assert!(body.get("readOperationKey").is_none());
    }
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 0);
    assert_eq!(f.count("/product-users"), 1);
    f.state.lock().unwrap().product_disabled = false;
    let context =
        context().with_tool_identity(RuntimeToolExecutionIdentity::new("restored", "later-turn"));
    assert!(read(&cold, &params, &context, None).await.unwrap().success);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn disabled_file_recovery_prefers_the_saved_read_key_including_mid_read_suspension() {
    for during_read in [false, true] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.yaml");
        let manager = AccountManager::new(root.path(), &config);
        login(&f, &manager, "approved").await;
        {
            let mut state = f.state.lock().unwrap();
            state.connection_read_unknown = true;
            state.connection_read_missing = true;
        }
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        let first = read(&manager, &params, &context(), None).await.unwrap();
        let first: Value = serde_json::from_str(&first.output).unwrap();
        {
            let mut state = f.state.lock().unwrap();
            state.product_disabled = !during_read;
            state.disable_product_on_result = during_read;
            state.summary_response = Some((200, summary("connection_file", "completed")));
        }
        let cold = AccountManager::new(root.path(), &config);
        let next = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
            "disabled-read",
            "later-turn",
        ));
        let result = read(&cold, &params, &next, None).await.unwrap();
        assert!(!result.success);
        let body: Value = serde_json::from_str(&result.output).unwrap();
        assert_eq!(body["status"], "outcome_unknown");
        assert_eq!(body["summary"]["kind"], "connection_file");
        assert_eq!(body["recoveryOnly"], true);
        assert_eq!(body["operationKey"], first["operationKey"]);
        assert_eq!(body["readOperationKey"], first["readOperationKey"]);
        assert!(!result.output.contains("approved-connection-content"));
        let summary_path = format!(
            "/recovery/connection-file-operations/operations/{}",
            first["readOperationKey"].as_str().unwrap()
        );
        assert_eq!(f.count(&summary_path), 1);
        assert_eq!(f.count("/connection-requests"), 1);
        assert_eq!(f.count("/file-reads"), 1);
        {
            let mut state = f.state.lock().unwrap();
            state.product_disabled = false;
            state.disable_product_on_result = false;
            state.connection_read_missing = false;
        }
        let restored = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
            "restored-read",
            "later-turn",
        ));
        assert!(read(&cold, &params, &restored, None).await.unwrap().success);
        assert_eq!(f.count("/connection-requests"), 1);
        assert_eq!(f.count("/file-reads"), 1);
    }
}

#[tokio::test]
async fn disabled_new_connection_call_has_no_approval_or_file_dispatch() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    login(&f, &manager, "approved").await;
    f.state.lock().unwrap().product_disabled = true;
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    assert_eq!(
        read(&manager, &params, &context(), None)
            .await
            .unwrap_err()
            .message(),
        "product_user_disabled"
    );
    assert_eq!(f.count("/connection-requests"), 0);
    assert_eq!(f.count("/file-reads"), 0);
    assert_eq!(f.count("/product-users"), 0);
    assert!(!f
        .state
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|(p, _, _)| p.contains("/recovery/")));
}
