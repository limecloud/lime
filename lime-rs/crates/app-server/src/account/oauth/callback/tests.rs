use super::*;
use app_server_protocol::protocol::v2::GetAccountParams;

async fn pending() -> (tempfile::TempDir, AccountManager, store::Authorization) {
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut authorization = super::super::tests::authorization();
    authorization.public.id = uuid::Uuid::new_v4().to_string();
    authorization.redirect_uri =
        format!("http://{}/oauth/callback", listener.local_addr().unwrap());
    authorization.config.redirect_uris = vec![authorization.redirect_uri.clone()];
    drop(listener);
    store::update(&manager.path, |state| {
        authorization.parent_epoch = state.epoch.clone();
        state
            .authorizations
            .insert(CloudResource::Default, authorization.clone());
        Ok(())
    })
    .unwrap();
    (root, manager, authorization)
}

async fn read(manager: &AccountManager, authorization: &store::Authorization) {
    manager
        .read_verified(GetAccountParams {
            authorization_id: Some(authorization.public.id.clone()),
        })
        .await
        .unwrap();
}

async fn wait_status(manager: &AccountManager, expected: Status) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let result = manager.read(Default::default()).unwrap();
            if result.authorizations[0].status == expected {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn restart_rearms_original_pending_callback_without_replacing_transaction() {
    let (_root, manager, original) = pending().await;
    let before = std::fs::read(&manager.path).unwrap();
    read(&manager, &original).await;
    read(&manager, &original).await;
    assert_eq!(std::fs::read(&manager.path).unwrap(), before);
    assert!(claim(&manager.path, &original.public.id).unwrap().is_none());

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .get(format!(
            "{}?state=wrong&error=access_denied",
            original.redirect_uri
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(
        manager.read(Default::default()).unwrap().authorizations[0].status,
        Status::Pending
    );
    let response = client
        .get(format!(
            "{}?state={}&error=access_denied",
            original.redirect_uri, original.state
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 204);
    wait_status(&manager, Status::Denied).await;
    assert!(manager.read(Default::default()).unwrap().account.is_none());
    let saved = store::load(&manager.path).unwrap();
    let result = &saved.authorizations[&CloudResource::Default];
    assert_eq!(result.public.id, original.public.id);
    assert_eq!(result.public.expires_at, original.public.expires_at);
    assert!(result.verifier.is_empty());
}

#[tokio::test]
async fn interrupted_listener_releases_lease_and_another_manager_resumes_it() {
    let (root, manager, original) = pending().await;
    let (listener, _) = callback_listener(&[original.redirect_uri.clone()])
        .await
        .unwrap();
    let lease = claim(&manager.path, &original.public.id).unwrap().unwrap();
    let task = manager.start_callback(listener, original.clone(), lease);
    read(&manager, &original).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());

    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    restarted.read_verified(Default::default()).await.unwrap();
    assert!(claim(&restarted.path, &original.public.id)
        .unwrap()
        .is_none());
    let result = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!(
            "{}?state={}&error=access_denied",
            original.redirect_uri, original.state
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(result.status(), 204);
    wait_status(&restarted, Status::Denied).await;
}

#[tokio::test]
async fn unavailable_original_port_preserves_pending_and_never_uses_another_redirect() {
    let (_root, manager, original) = pending().await;
    let (reserved, _) = callback_listener(&[original.redirect_uri.clone()])
        .await
        .unwrap();
    let alternative = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let alternate_uri = format!(
        "http://{}/oauth/callback",
        alternative.local_addr().unwrap()
    );
    drop(alternative);
    store::update(&manager.path, |state| {
        state
            .authorizations
            .get_mut(&CloudResource::Default)
            .unwrap()
            .config
            .redirect_uris
            .push(alternate_uri.clone());
        Ok(())
    })
    .unwrap();
    let before = std::fs::read(&manager.path).unwrap();
    assert_eq!(
        manager.read_verified(Default::default()).await.unwrap_err(),
        "account_callback_unavailable"
    );
    assert_eq!(std::fs::read(&manager.path).unwrap(), before);
    let (free_alternate, _) = callback_listener(&[alternate_uri]).await.unwrap();
    drop(free_alternate);
    drop(reserved);
    read(&manager, &original).await;
    assert!(claim(&manager.path, &original.public.id).unwrap().is_none());
}

#[tokio::test]
async fn expired_pending_is_not_extended_or_rearmed() {
    let (_root, manager, mut original) = pending().await;
    original.public.expires_at = timestamp(chrono::Utc::now().timestamp() - 1);
    store::update(&manager.path, |state| {
        state
            .authorizations
            .insert(CloudResource::Default, original.clone());
        Ok(())
    })
    .unwrap();
    read(&manager, &original).await;
    let state = store::load(&manager.path).unwrap();
    let result = &state.authorizations[&CloudResource::Default];
    assert_eq!(result.public.id, original.public.id);
    assert_eq!(result.public.expires_at, original.public.expires_at);
    assert_eq!(result.public.status, Status::Expired);
    assert!(result.state.is_empty() && result.nonce.is_empty() && result.verifier.is_empty());
    assert!(callback_listener(&[original.redirect_uri]).await.is_ok());
}

#[tokio::test]
async fn callback_received_after_the_original_deadline_never_dispatches_code() {
    let (_root, manager, mut original) = pending().await;
    original.public.expires_at = timestamp(chrono::Utc::now().timestamp() - 1);
    store::update(&manager.path, |state| {
        state
            .authorizations
            .insert(CloudResource::Default, original.clone());
        Ok(())
    })
    .unwrap();
    assert_eq!(
        manager
            .complete(&original, "not-submitted")
            .await
            .unwrap_err(),
        "authorization_expired"
    );
    let state = store::load(&manager.path).unwrap();
    assert_eq!(
        state.authorizations[&CloudResource::Default].public.status,
        Status::Pending
    );
    assert!(state.credentials.is_empty());
}

#[tokio::test]
async fn dispatched_exchange_and_unknown_outcome_never_rearm_or_resubmit_code() {
    let (_root, manager, original) = pending().await;
    for status in [Status::Exchanging, Status::OutcomeUnknown] {
        store::update(&manager.path, |state| {
            state
                .authorizations
                .get_mut(&CloudResource::Default)
                .unwrap()
                .public
                .status = status;
            Ok(())
        })
        .unwrap();
        let before = std::fs::read(&manager.path).unwrap();
        read(&manager, &original).await;
        assert_eq!(std::fs::read(&manager.path).unwrap(), before);
        assert!(callback_listener(&[original.redirect_uri.clone()])
            .await
            .is_ok());
    }
}

#[tokio::test]
async fn logout_fences_pending_callback_and_releases_original_port() {
    let (_root, manager, original) = pending().await;
    read(&manager, &original).await;
    manager.logout().unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if callback_listener(&[original.redirect_uri.clone()])
                .await
                .is_ok()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(claim(&manager.path, &original.public.id).unwrap().is_some());
    assert_eq!(
        manager
            .read_verified(GetAccountParams {
                authorization_id: Some(original.public.id),
            })
            .await
            .unwrap_err(),
        "authorization_not_found"
    );
    assert!(manager.read(Default::default()).unwrap().account.is_none());
}

#[tokio::test]
async fn unregistered_saved_redirect_is_rejected_without_changing_original_transaction() {
    let (_root, manager, original) = pending().await;
    store::update(&manager.path, |state| {
        state
            .authorizations
            .get_mut(&CloudResource::Default)
            .unwrap()
            .config
            .redirect_uris
            .clear();
        Ok(())
    })
    .unwrap();
    let before = std::fs::read(&manager.path).unwrap();
    assert_eq!(
        manager.read_verified(Default::default()).await.unwrap_err(),
        "account_store_invalid"
    );
    assert_eq!(std::fs::read(&manager.path).unwrap(), before);
    assert!(callback_listener(&[original.redirect_uri]).await.is_ok());
}

#[tokio::test]
async fn live_verification_lease_prevents_a_second_reader_using_staged_tokens() {
    let (_root, manager, original) = pending().await;
    store::update(&manager.path, |state| {
        let authorization = state
            .authorizations
            .get_mut(&CloudResource::Default)
            .unwrap();
        authorization.public.status = Status::Exchanging;
        authorization.staged = Some(store::Credential {
            authorization_expires_at: None,
            tokens: cloud::Tokens {
                access_token: "test-staged-token".into(),
                token_type: "Bearer".into(),
                expires_in: 3600,
                refresh_token: None,
                id_token: None,
                scope: Some("openid profile".into()),
            },
            audience: authorization.config.audience.clone(),
            scope: authorization.config.scope.clone(),
            expires_at: chrono::Utc::now().timestamp() + 3600,
            status: CloudCredentialStatus::VerificationRequired,
        });
        Ok(())
    })
    .unwrap();
    let lease = claim(&manager.path, &original.public.id).unwrap().unwrap();
    let before = std::fs::read(&manager.path).unwrap();
    let result = manager
        .read_verified(GetAccountParams {
            authorization_id: Some(original.public.id),
        })
        .await
        .unwrap();
    assert!(result.account.is_none());
    assert_eq!(result.authorizations[0].status, Status::Exchanging);
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("test-staged-token"));
    assert_eq!(std::fs::read(&manager.path).unwrap(), before);
    drop(lease);
}

#[tokio::test]
async fn late_callback_failure_cannot_overwrite_a_completed_authorization() {
    let (_root, manager, original) = pending().await;
    store::update(&manager.path, |state| {
        state
            .authorizations
            .get_mut(&CloudResource::Default)
            .unwrap()
            .public
            .status = Status::Completed;
        Ok(())
    })
    .unwrap();
    manager.authorization_failed(&original, Status::OutcomeUnknown);
    assert_eq!(
        manager.read(Default::default()).unwrap().authorizations[0].status,
        Status::Completed
    );
}

#[test]
fn callback_lease_is_exclusive_across_processes() {
    const TEST_PATH: &str = "LIME_TEST_CALLBACK_LEASE";
    if let Some(path) = std::env::var_os(TEST_PATH) {
        assert!(claim(Path::new(&path), "original").unwrap().is_none());
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("account.json");
    let lease = claim(&path, "original").unwrap().unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "account::oauth::callback::tests::callback_lease_is_exclusive_across_processes",
        ])
        .env(TEST_PATH, &path)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(String::from_utf8_lossy(&result.stdout).contains("1 passed"));
    drop(lease);
    assert!(claim(&path, "original").unwrap().is_some());
}

#[cfg(unix)]
#[test]
fn callback_lease_is_private_and_rejects_symlinks() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("account.json");
    let lease = claim(&path, "original").unwrap().unwrap();
    let key = hex::encode(Sha256::digest(b"original"));
    let lock = path.with_file_name(format!("oauth-callback-{key}.lock"));
    assert_eq!(
        std::fs::metadata(&lock).unwrap().permissions().mode() & 0o777,
        0o600
    );
    drop(lease);
    let other = root.path().join("other");
    std::fs::create_dir(&other).unwrap();
    symlink(&lock, other.join(lock.file_name().unwrap())).unwrap();
    assert_eq!(
        claim(&other.join("account.json"), "original").unwrap_err(),
        "account_store_invalid"
    );
}
