use super::{install::issuer, support::*};
use serde_json::{json, Value};
use tempfile::TempDir;

fn base(root: &std::path::Path) -> std::path::PathBuf {
    root.join("agent/plugins/cache/workspace-directory/research")
}

fn install_params(attempt: Option<&str>) -> Option<Value> {
    Some(
        json!({"pluginName":"opaque~install", "remoteMarketplaceName":"workspace-directory", "installAttemptId":attempt}),
    )
}

#[tokio::test]
async fn remote_mutation_posts_opaque_identity_attempt_and_then_commits() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    rpc(
        &server,
        "plugin/install",
        install_params(Some("attempt-42")),
    )
    .await;
    let requests = issuer.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    assert!(requests[1].starts_with("GET "));
    assert!(requests[2].starts_with("GET /signed-bundle?"));
    assert!(requests[3].starts_with("POST /api/v1/public/tenants/tenant-one/client/ps/plugins/opaque~install/install?includeAppsNeedingAuth=true HTTP/1.1"));
    let body: Value = serde_json::from_str(requests[3].split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body, json!({"install_attempt_id":"attempt-42"}));
    assert!(base(temp.path())
        .join("1.2.3/.lime-plugin/plugin.json")
        .is_file());
}

#[tokio::test]
async fn remote_mutation_failure_preserves_old_package_and_config() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    rpc(&server, "plugin/install", install_params(None)).await;
    let manifest = base(temp.path()).join("1.2.3/.lime-plugin/plugin.json");
    let before_package = std::fs::read(&manifest).unwrap();
    let before_config = std::fs::read(temp.path().join("config.yaml")).unwrap();
    for (status, response) in [
        (503, json!({"message":BUNDLE})),
        (200, json!({"id":"other","enabled":true})),
        (200, json!({"id":"opaque~install","enabled":false})),
        (200, json!({"id":"opaque~install"})),
    ] {
        *issuer.mutation_reply.lock().unwrap() = Some((status, response));
        let result = raw(&server, "plugin/install", install_params(None)).await;
        assert!(result.get("error").is_some(), "{result}");
        assert_eq!(std::fs::read(&manifest).unwrap(), before_package);
        assert_eq!(
            std::fs::read(temp.path().join("config.yaml")).unwrap(),
            before_config
        );
    }
    // The existing installation remains usable after every rejected response.
    assert_eq!(
        rpc(&server, "plugin/installed", Some(json!({}))).await["marketplaces"][0]["plugins"][0]
            ["installed"],
        true
    );
}

#[tokio::test]
async fn remote_bad_bundle_never_posts_install_or_publishes_package() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.bundle.lock().unwrap() = b"not gzip".to_vec();
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    assert!(raw(&server, "plugin/install", install_params(None))
        .await
        .get("error")
        .is_some());
    assert!(!base(temp.path()).exists());
    assert!(!issuer
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|request| request.starts_with("POST ")));
}

#[tokio::test]
async fn remote_uninstall_requires_successful_matching_confirmation() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    rpc(&server, "plugin/install", install_params(None)).await;
    let params = Some(json!({"pluginId":"research@workspace-directory"}));
    for response in [
        (403, json!({"message":BUNDLE})),
        (200, json!({"id":"other","enabled":false})),
        (200, json!({"id":"opaque~install","enabled":true})),
    ] {
        *issuer.mutation_reply.lock().unwrap() = Some(response);
        assert!(raw(&server, "plugin/uninstall", params.clone())
            .await
            .get("error")
            .is_some());
        assert!(base(temp.path()).is_dir());
    }
    *issuer.mutation_reply.lock().unwrap() = None;
    rpc(&server, "plugin/uninstall", params).await;
    assert!(!base(temp.path()).exists());
    assert!(issuer.requests.lock().unwrap().last().unwrap().starts_with("POST /api/v1/public/tenants/tenant-one/client/ps/plugins/opaque~install/uninstall HTTP/1.1"));
}

#[tokio::test]
async fn remote_install_uses_canonical_marketplace_from_service_identity() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    rpc(&server, "plugin/install", Some(json!({"pluginName":"opaque~install", "remoteMarketplaceName":"caller-does-not-select-authority"}))).await;
    assert!(base(temp.path()).is_dir());
    assert!(!temp
        .path()
        .join("agent/plugins/cache/caller-does-not-select-authority")
        .exists());
    let requests = issuer.requests.lock().unwrap();
    let body = requests.last().unwrap().split("\r\n\r\n").nth(1).unwrap();
    assert!(
        body.is_empty(),
        "absent attempt must not send an empty or camelCase body"
    );
}

#[tokio::test]
async fn remote_gate_holds_staging_until_confirmation_and_serializes_peer_removal() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    let peer = super::support::server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    rpc(&server, "plugin/install", install_params(None)).await;
    let before = std::fs::read(base(temp.path()).join("1.2.3/.lime-plugin/plugin.json")).unwrap();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    *issuer.mutation_gate.lock().unwrap() = Some((started, released));
    *issuer.mutation_reply.lock().unwrap() = Some((503, json!({"message":"unavailable"})));
    let first = raw(&server, "plugin/install", install_params(None));
    let second = async {
        ready.await.unwrap();
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(temp.path().join("agent/plugins/.remote-mutation.lock"))
            .unwrap();
        assert_eq!(
            fs2::FileExt::try_lock_exclusive(&file)
                .unwrap_err()
                .raw_os_error(),
            fs2::lock_contended_error().raw_os_error()
        );
        assert_eq!(
            std::fs::read(base(temp.path()).join("1.2.3/.lime-plugin/plugin.json")).unwrap(),
            before
        );
        let removing = raw(
            &peer,
            "plugin/uninstall",
            Some(json!({"pluginId":"research@workspace-directory"})),
        );
        tokio::pin!(removing);
        tokio::select! {
            result = &mut removing => panic!("peer mutation bypassed active gate: {result}"),
            _ = tokio::time::sleep(std::time::Duration::from_millis(75)) => {}
        }
        release.send(()).unwrap();
        assert!(removing.await.get("error").is_some());
    };
    let (installed, ()) = tokio::join!(first, second);
    assert!(installed.get("error").is_some());
    assert_eq!(
        std::fs::read(base(temp.path()).join("1.2.3/.lime-plugin/plugin.json")).unwrap(),
        before
    );
}

#[tokio::test]
async fn remote_confirmation_after_peer_logout_cannot_publish_staged_package() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    let peer = super::support::server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    *issuer.mutation_gate.lock().unwrap() = Some((started, released));
    let (result, ()) = tokio::join!(
        raw(&server, "plugin/install", install_params(None)),
        async {
            ready.await.unwrap();
            rpc(&peer, "account/logout", None).await;
            release.send(()).unwrap();
        }
    );
    assert!(result.get("error").is_some());
    assert!(!base(temp.path()).exists());
    assert_eq!(
        rpc(&peer, "plugin/installed", Some(json!({}))).await["marketplaces"],
        json!([])
    );
    // An uncertain install outcome must not compensate by deleting a preexisting remote fact.
    assert!(!issuer
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|request| request.contains("/uninstall ")));
}
