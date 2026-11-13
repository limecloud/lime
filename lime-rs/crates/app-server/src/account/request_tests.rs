use super::*;

#[tokio::test]
async fn stale_market_task_cannot_dispatch_with_a_replacement_account_generation() {
    let fixture = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    fixture.login(&manager, CloudResource::Default).await;
    let original = store::load(&manager.path).unwrap().epoch;
    manager.logout().unwrap();
    fixture.login(&manager, CloudResource::Default).await;
    assert_ne!(store::load(&manager.path).unwrap().epoch, original);
    let before = fixture.state.lock().unwrap().calls.len();
    let result = manager
        .request_for_generation(
            CloudRequestParams {
                path: "/market/acquisitions".into(),
                method: CloudRequestMethod::Post,
                body: Some(json!({"releaseId":"original-release","expectedItemRevision":1})),
                language: "en-US".into(),
                operation_key: Some("original-market-operation".into()),
                task_id: Some("original-market-task".into()),
            },
            &original,
        )
        .await;
    assert_eq!(result.err().as_deref(), Some("account_changed"));
    assert_eq!(fixture.state.lock().unwrap().calls.len(), before);
}
