use super::*;

fn output(result: RuntimeToolExecutionResult) -> Value {
    assert!(!result.success);
    serde_json::from_str(&result.output).unwrap()
}

fn next_context(call: &str) -> RuntimeToolExecutionContext {
    context().with_tool_identity(RuntimeToolExecutionIdentity::new(call, call))
}

#[tokio::test]
async fn verified_terminal_decisions_release_only_their_pending_request() {
    for status in ["denied", "expired", "consumer_unavailable"] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.yaml");
        let manager = AccountManager::new(root.path(), &config);
        login(&f, &manager, status).await;
        if status == "denied" {
            let mut state = f.state.lock().unwrap();
            let body = state.connection_request.as_mut().unwrap();
            body["revision"] = json!(2);
            body["decidedAt"] = json!(Utc::now().to_rfc3339());
        }
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        let first = output(read(&manager, &params, &context(), None).await.unwrap());
        assert_eq!(first["status"], "failed", "{status}");
        let original = f.state.lock().unwrap().connection_request.clone();
        {
            let mut state = f.state.lock().unwrap();
            state.connection_request = Some(approval("approved"));
            state.connection_read_unknown = true;
            state.connection_read_missing = true;
        }
        let cold = AccountManager::new(root.path(), &config);
        let second = output(
            read(&cold, &params, &next_context("second"), None)
                .await
                .unwrap(),
        );
        assert_ne!(second["operationKey"], first["operationKey"], "{status}");
        assert_eq!(f.count("/connection-requests"), 2, "{status}");
        assert_eq!(f.count("/file-reads"), 1, "{status}");
        let pending = f.state.lock().unwrap().connection_request.clone();
        f.state.lock().unwrap().connection_request = original;
        let late = output(read(&cold, &params, &context(), None).await.unwrap());
        assert_eq!(late["operationKey"], first["operationKey"]);
        assert_eq!(late["status"], "failed");
        f.state.lock().unwrap().connection_request = pending;
        let third = output(
            read(&cold, &params, &next_context("third"), None)
                .await
                .unwrap(),
        );
        assert_eq!(third["operationKey"], second["operationKey"]);
        assert_eq!(f.count("/connection-requests"), 2);
        assert_eq!(f.count("/file-reads"), 1);
    }
}

#[tokio::test]
async fn verified_expired_file_result_allows_a_new_request_without_reusing_the_old_key() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    login(&f, &manager, "approved").await;
    {
        let mut state = f.state.lock().unwrap();
        let body = state.connection_file.as_mut().unwrap();
        body["status"] = json!("result_expired");
        body["createdAt"] = json!((Utc::now() - ChronoDuration::hours(3)).to_rfc3339());
        body["finishedAt"] = json!((Utc::now() - ChronoDuration::hours(2)).to_rfc3339());
        body["resultExpiresAt"] = json!((Utc::now() - ChronoDuration::hours(1)).to_rfc3339());
        body["errorCode"] = json!("INTEGRATION_RESULT_EXPIRED");
        body.as_object_mut().unwrap().remove("result");
    }
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let first = output(read(&manager, &params, &context(), None).await.unwrap());
    assert_eq!(first["status"], "result_expired");
    let replay = output(read(&manager, &params, &context(), None).await.unwrap());
    assert_eq!(replay["operationKey"], first["operationKey"]);
    assert_eq!(replay["readOperationKey"], first["readOperationKey"]);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
    f.state.lock().unwrap().connection_request_unknown = true;
    let second = output(
        read(&manager, &params, &next_context("second"), None)
            .await
            .unwrap(),
    );
    assert_ne!(second["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/connection-requests"), 2);
    assert_eq!(f.count("/file-reads"), 1);
    assert!(second.get("readOperationKey").is_none());
}

#[tokio::test]
async fn locally_expired_pending_approval_keeps_the_original_request_unknown() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    login(&f, &manager, "pending").await;
    {
        let mut state = f.state.lock().unwrap();
        let body = state.connection_request.as_mut().unwrap();
        body["createdAt"] = json!((Utc::now() - ChronoDuration::minutes(2)).to_rfc3339());
        body["expiresAt"] = json!((Utc::now() - ChronoDuration::minutes(1)).to_rfc3339());
    }
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let first = output(read(&manager, &params, &context(), None).await.unwrap());
    assert_eq!(first["status"], "outcome_unknown");
    assert_eq!(first["errorCode"], "connection_request_expired");
    let second = output(
        read(&manager, &params, &next_context("second"), None)
            .await
            .unwrap(),
    );
    assert_eq!(second["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 0);
}

#[tokio::test]
async fn malformed_terminal_responses_never_release_the_pending_request() {
    for file in [false, true] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        login(&f, &manager, if file { "approved" } else { "denied" }).await;
        if file {
            let mut state = f.state.lock().unwrap();
            let body = state.connection_file.as_mut().unwrap();
            body["status"] = json!("result_expired");
            body["errorCode"] = json!("INTEGRATION_RESULT_EXPIRED");
            body.as_object_mut().unwrap().remove("finishedAt");
            body.as_object_mut().unwrap().remove("result");
        }
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        let first = output(read(&manager, &params, &context(), None).await.unwrap());
        assert_eq!(first["status"], "outcome_unknown");
        assert_eq!(first["errorCode"], "connection_response_invalid");
        let second = output(
            read(&manager, &params, &next_context("second"), None)
                .await
                .unwrap(),
        );
        assert_eq!(second["operationKey"], first["operationKey"]);
        assert_eq!(f.count("/connection-requests"), 1);
        assert_eq!(f.count("/file-reads"), usize::from(file));
    }
}
