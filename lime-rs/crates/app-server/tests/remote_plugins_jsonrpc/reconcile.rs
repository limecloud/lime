use super::{install::issuer, support::*};
use app_server::AppServer;
use serde_json::{json, Value};
use tempfile::TempDir;

#[tokio::test]
async fn remote_reconcile_portable_apps_change_hint_does_not_activate_apps() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    issuer.plugin.lock().unwrap()["scope"] = json!("GLOBAL");
    *issuer.bundle.lock().unwrap() = super::install::archive(&[("plugin.json", br#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"research","version":"1.2.3"}"#)]);
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    assert_eq!(
        reconcile(&server).await["changedPlugins"][0]["hasApps"],
        true
    );
    assert_eq!(
        rpc(&server, "app/list", Some(json!({}))).await["data"],
        json!([])
    );
}

async fn reconcile(server: &AppServer) -> Value {
    rpc(
        server,
        "plugin/reconcile",
        Some(json!({"reason":"public-rpc-fixture"})),
    )
    .await
}

async fn installed(server: &AppServer) -> Value {
    rpc(server, "plugin/installed", Some(json!({}))).await
}

fn summary(response: &Value) -> &Value {
    &response["marketplaces"][0]["plugins"][0]
}

#[tokio::test]
async fn remote_reconcile_without_account_is_empty_and_does_not_create_remote_state() {
    let temp = TempDir::new().unwrap();
    let server = server(temp.path()).await;
    assert_eq!(
        reconcile(&server).await,
        json!({"changedPlugins":[],"failedRemotePluginIds":[],"failedMaterializationRemotePluginIds":[]})
    );
    assert!(!temp.path().join("agent/plugins/remote-state").exists());
}

#[tokio::test]
async fn remote_reconcile_publishes_all_scope_pages_before_materializing_separate_marketplaces() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    let mut workspace = item("opaque~install", "research");
    workspace["enabled"] = json!(true);
    workspace["release"]["bundle_download_url"] =
        json!(format!("{}/signed-bundle?signature=private", issuer.url));
    let mut global = workspace.clone();
    global["id"] = json!("global~1");
    global["scope"] = json!("GLOBAL");
    issuer.installed_replies.lock().unwrap().extend([
        (200, page(vec![workspace], Some("all+/="))),
        (200, page(vec![global], None)),
    ]);
    let result = reconcile(&server).await;
    assert_eq!(result["failedRemotePluginIds"], json!([]));
    assert_eq!(result["changedPlugins"].as_array().unwrap().len(), 2);
    let actual = installed(&server).await;
    assert_eq!(actual["marketplaces"].as_array().unwrap().len(), 2);
    for market in actual["marketplaces"].as_array().unwrap() {
        assert_eq!(market["plugins"][0]["localVersion"], "1.2.3");
    }
    let requests = issuer.requests.lock().unwrap();
    let last_page = requests
        .iter()
        .position(|request| request.contains("pageToken=all%2B%2F%3D"))
        .unwrap();
    let first_download = requests
        .iter()
        .position(|request| request.starts_with("GET /signed-bundle?"))
        .unwrap();
    assert!(last_page < first_download);
}

#[tokio::test]
async fn remote_reconcile_materializes_cloud_install_and_keeps_same_version_across_peers() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    let response = reconcile(&server).await;
    assert_eq!(response["failedRemotePluginIds"], json!([]));
    assert_eq!(
        response["changedPlugins"],
        json!([{"id":"research@workspace-directory","hasSkills":true,"hasMcps":true,"hasHooks":true,"hasApps":false}])
    );
    let actual = installed(&server).await;
    assert_eq!(summary(&actual)["installed"], true);
    assert_eq!(summary(&actual)["localVersion"], "1.2.3");
    let count_downloads = || {
        issuer
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|request| request.starts_with("GET /signed-bundle?"))
            .count()
    };
    assert_eq!(count_downloads(), 1);
    *issuer.bundle.lock().unwrap() =
        b"invalid archive should never be read for unchanged version".to_vec();
    let peer = super::support::server(temp.path()).await;
    assert_eq!(reconcile(&peer).await["changedPlugins"], json!([]));
    assert_eq!(count_downloads(), 1);
    let state_path = std::fs::read_dir(temp.path().join("agent/plugins/remote-state"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let state = std::fs::read_to_string(state_path).unwrap();
    assert!(!state.contains(TOKEN));
    assert!(!state.contains("bundle_download_url"));
    assert!(!state.contains("signature=private"));
    assert!(issuer
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|request| !request.starts_with("POST ")));
    let requests = issuer.requests.lock().unwrap();
    let request = requests
        .iter()
        .find(|request| request.contains("/installed?"))
        .unwrap();
    assert!(request.starts_with("GET "));
    assert!(request.contains("limit=200&includeDownloadUrls=true"));
    assert!(!request.contains("scope="));
}

#[tokio::test]
async fn remote_reconcile_update_failure_keeps_cached_version_and_local_disable_override() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    reconcile(&server).await;
    std::fs::write(
        temp.path().join("config.yaml"),
        "plugins:\n  research@workspace-directory:\n    enabled: false\n",
    )
    .unwrap();
    issuer.plugin.lock().unwrap()["release"]["version"] = json!("2.0.0");
    let good_bundle = issuer.bundle.lock().unwrap().clone();
    *issuer.bundle.lock().unwrap() = b"broken".to_vec();
    let response = reconcile(&server).await;
    assert_eq!(response["failedRemotePluginIds"], json!(["opaque~install"]));
    assert_eq!(
        response["failedMaterializationRemotePluginIds"],
        json!(["opaque~install"])
    );
    let actual = installed(&server).await;
    assert_eq!(summary(&actual)["version"], "2.0.0");
    assert_eq!(summary(&actual)["localVersion"], "1.2.3");
    assert_eq!(summary(&actual)["enabled"], false);
    let before_config = std::fs::read(temp.path().join("config.yaml")).unwrap();
    *issuer.bundle.lock().unwrap() = good_bundle;
    let response = reconcile(&server).await;
    assert_eq!(response["failedRemotePluginIds"], json!([]));
    assert_eq!(response["changedPlugins"][0]["hasMcps"], true);
    assert_eq!(summary(&installed(&server).await)["localVersion"], "2.0.0");
    assert_eq!(
        std::fs::read(temp.path().join("config.yaml")).unwrap(),
        before_config
    );
}

#[tokio::test]
async fn remote_reconcile_rejects_incomplete_or_ambiguous_snapshot_before_any_local_change() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    reconcile(&server).await;
    let state_path = std::fs::read_dir(temp.path().join("agent/plugins/remote-state"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let before_state = std::fs::read(&state_path).unwrap();
    let mut row = item("opaque~install", "research");
    row["enabled"] = json!(true);
    let mut collision = row.clone();
    collision["id"] = json!("another-id");
    let mut invalid = row.clone();
    invalid["name"] = json!("../escape");
    for pages in [
        vec![
            (200, page(vec![row.clone()], Some("next+/="))),
            (503, json!({"error":"private"})),
        ],
        vec![
            (200, page(vec![row.clone()], Some("next"))),
            (200, page(vec![row.clone()], None)),
        ],
        vec![(200, page(vec![row.clone(), collision], None))],
        vec![(200, page(vec![invalid], None))],
        vec![
            (200, page(Vec::new(), Some("repeat"))),
            (200, page(Vec::new(), Some("repeat"))),
        ],
        vec![(200, json!({"plugins":[],"pagination":null}))],
    ] {
        issuer.installed_replies.lock().unwrap().extend(pages);
        let before_requests = issuer.requests.lock().unwrap().len();
        let response = raw(&server, "plugin/reconcile", Some(json!({}))).await;
        assert!(response.get("error").is_some(), "{response}");
        assert_eq!(std::fs::read(&state_path).unwrap(), before_state);
        assert_eq!(summary(&installed(&server).await)["localVersion"], "1.2.3");
        assert!(issuer.requests.lock().unwrap()[before_requests..]
            .iter()
            .all(|request| !request.starts_with("GET /signed-bundle?")
                && !request.starts_with("POST ")));
        assert!(issuer.installed_replies.lock().unwrap().is_empty());
    }
    assert!(issuer
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|request| request.contains("pageToken=next%2B%2F%3D")));
}

#[tokio::test]
async fn remote_reconcile_revocation_removes_cached_plugin_and_is_visible_to_cold_peer() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    reconcile(&server).await;
    *issuer.remotely_installed.lock().unwrap() = false;
    let response = reconcile(&server).await;
    assert_eq!(
        response["changedPlugins"][0]["id"],
        "research@workspace-directory"
    );
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
    assert!(!temp
        .path()
        .join("agent/plugins/cache/workspace-directory/research")
        .exists());
    let peer = super::support::server(temp.path()).await;
    assert_eq!(installed(&peer).await["marketplaces"], json!([]));
}

#[cfg(unix)]
#[tokio::test]
async fn remote_reconcile_revocation_stays_inactive_after_config_cleanup_failure() {
    use std::os::unix::fs::PermissionsExt;
    struct RestorePermissions(std::path::PathBuf, std::fs::Permissions);
    impl Drop for RestorePermissions {
        fn drop(&mut self) {
            std::fs::set_permissions(&self.0, self.1.clone()).unwrap();
        }
    }
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    rpc(&server, "plugin/install", detail("opaque~install")).await;
    reconcile(&server).await;
    let restore = RestorePermissions(
        temp.path().into(),
        std::fs::metadata(temp.path()).unwrap().permissions(),
    );
    std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    assert!(std::fs::write(temp.path().join("must-fail"), "probe").is_err());
    *issuer.remotely_installed.lock().unwrap() = false;
    let response = reconcile(&server).await;
    assert_eq!(
        response["changedPlugins"][0]["id"],
        "research@workspace-directory"
    );
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
    let base = temp
        .path()
        .join("agent/plugins/cache/workspace-directory/research");
    assert!(
        base.exists(),
        "failed config commit must preserve package for cleanup retry"
    );
    drop(restore);
    reconcile(&server).await;
    assert!(
        !base.exists(),
        "next pass must retry inactive stale cache cleanup"
    );
}

#[tokio::test]
async fn remote_reconcile_discards_snapshot_after_peer_logout() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    let peer = super::support::server(temp.path()).await;
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    *issuer.installed_gate.lock().unwrap() = Some((started, released));
    let (response, ()) = tokio::join!(raw(&server, "plugin/reconcile", Some(json!({}))), async {
        ready.await.unwrap();
        rpc(&peer, "account/logout", None).await;
        release.send(()).unwrap();
    });
    assert!(response.get("error").is_some(), "{response}");
    assert!(!temp.path().join("agent/plugins/remote-state").exists());
    assert!(!temp
        .path()
        .join("agent/plugins/cache/workspace-directory/research")
        .exists());
}

#[tokio::test]
async fn remote_mutations_amend_reconciled_snapshot_without_resurrecting_removed_plugins() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    reconcile(&server).await;
    rpc(&server, "plugin/install", detail("opaque~install")).await;
    assert_eq!(summary(&installed(&server).await)["installed"], true);
    rpc(
        &server,
        "plugin/uninstall",
        Some(json!({"pluginId":"research@workspace-directory"})),
    )
    .await;
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
    assert_eq!(reconcile(&server).await["changedPlugins"], json!([]));
}

#[tokio::test]
async fn remote_reconcile_enablement_changes_refresh_cached_categories_without_redownloading() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    reconcile(&server).await;
    let mut row = item("opaque~install", "research");
    row["enabled"] = json!(false);
    row["installed_at"] = json!("2026-01-01T00:00:00Z");
    issuer
        .installed_replies
        .lock()
        .unwrap()
        .push_back((200, page(vec![row.clone()], None)));
    let response = reconcile(&server).await;
    assert_eq!(response["changedPlugins"][0]["hasSkills"], true);
    let actual = installed(&server).await;
    assert_eq!(summary(&actual)["enabled"], false);
    assert_eq!(summary(&actual)["installedAt"], 1767225600_i64);
    issuer
        .installed_replies
        .lock()
        .unwrap()
        .push_back((200, page(vec![row.clone()], None)));
    let details = rpc(&server, "plugin/read", detail("opaque~install")).await;
    assert_eq!(details["plugin"]["summary"]["enabled"], false);
    assert_eq!(details["plugin"]["skills"][0]["enabled"], true);
    row["enabled"] = json!(true);
    issuer
        .installed_replies
        .lock()
        .unwrap()
        .push_back((200, page(vec![row], None)));
    assert_eq!(
        reconcile(&server).await["changedPlugins"][0]["hasHooks"],
        true
    );
    assert_eq!(summary(&installed(&server).await)["enabled"], true);
    assert_eq!(
        issuer
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|request| request.starts_with("GET /signed-bundle?"))
            .count(),
        1
    );
}

#[tokio::test]
async fn remote_reconcile_update_reports_components_removed_from_new_bundle() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    reconcile(&server).await;
    issuer.plugin.lock().unwrap()["release"]["version"] = json!("2.0.0");
    *issuer.bundle.lock().unwrap() = super::install::archive(&[(
        ".lime-plugin/plugin.json",
        br#"{"name":"research","version":"2.0.0"}"#,
    )]);
    issuer.plugin.lock().unwrap()["release"]["skills"] = json!([]);
    issuer.plugin.lock().unwrap()["release"]["mcp_servers"] = json!([]);
    let response = reconcile(&server).await;
    assert_eq!(
        response["changedPlugins"][0],
        json!({"id":"research@workspace-directory","hasSkills":true,"hasMcps":true,"hasHooks":true,"hasApps":false})
    );
    let details = rpc(&server, "plugin/read", detail("opaque~install")).await;
    assert_eq!(details["plugin"]["skills"], json!([]));
    assert_eq!(details["plugin"]["mcpServers"], json!([]));
    assert_eq!(details["plugin"]["hooks"], json!([]));
}

#[tokio::test]
async fn remote_reconcile_failed_materialization_preserves_cloud_fact_without_claiming_local_bundle(
) {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    issuer.plugin.lock().unwrap()["release"]["version"] = Value::Null;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    let response = reconcile(&server).await;
    assert_eq!(
        response["failedMaterializationRemotePluginIds"],
        json!(["opaque~install"])
    );
    let actual = installed(&server).await;
    assert_eq!(summary(&actual)["installed"], true);
    assert_eq!(summary(&actual)["localVersion"], Value::Null);
    let details = rpc(&server, "plugin/read", detail("opaque~install")).await;
    assert_eq!(details["plugin"]["skills"][0]["path"], Value::Null);
    assert!(issuer
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|request| !request.starts_with("GET /signed-bundle?")));
}
