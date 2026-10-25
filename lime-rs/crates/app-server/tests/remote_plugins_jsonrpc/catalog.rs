use super::support::*;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

fn installed(mut plugin: Value, version: &str, enabled: bool) -> Value {
    plugin["release"]["version"] = json!(version);
    plugin["enabled"] = json!(enabled);
    plugin["installed_at"] = json!("2026-01-01T00:00:00Z");
    plugin
}

#[tokio::test]
async fn catalog_reads_fresh_paginated_installation_and_policy_without_publishing_local_state() {
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let plugin = item("catalog~one", "research");
    let row = installed(plugin.clone(), "0.9.0", true);
    let (url, task) = issuer(vec![
        ok(session("one")),
        ok(page(vec![plugin.clone()], None)),
        ok(page(vec![], Some("installed+/="))),
        ok(page(vec![row.clone()], None)),
        ok(page(vec![plugin.clone()], None)),
        ok(page(vec![row], None)),
        ok(page(vec![plugin], None)),
        ok(page(vec![], None)),
    ])
    .await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let first = rpc(&app, "plugin/list", workspace()).await;
    let summary = &first["marketplaces"][0]["plugins"][0];
    assert_eq!(summary["installed"], true);
    assert_eq!(summary["enabled"], true);
    assert_eq!(summary["installedAt"], 1767225600_i64);
    assert_eq!(summary["version"], "1.2.3");
    assert_eq!(summary["localVersion"], "0.9.0");
    rpc(
        &app,
        "config/batchWrite",
        Some(json!({"edits":[{
            "keyPath":"plugins.\"research@workspace-directory\".enabled",
            "value":false,"mergeStrategy":"replace"
        }]})),
    )
    .await;
    let config = std::fs::read(temp.path().join("config.yaml")).unwrap();
    let blocked = rpc(&app, "plugin/list", workspace()).await;
    assert_eq!(blocked["marketplaces"][0]["plugins"][0]["installed"], true);
    assert_eq!(blocked["marketplaces"][0]["plugins"][0]["enabled"], false);
    let revoked = rpc(&app, "plugin/list", workspace()).await;
    let summary = &revoked["marketplaces"][0]["plugins"][0];
    assert_eq!(summary["installed"], false);
    assert_eq!(summary["enabled"], false);
    assert_eq!(summary["localVersion"], Value::Null);
    assert_eq!(summary["installedAt"], Value::Null);
    assert_eq!(
        std::fs::read(temp.path().join("config.yaml")).unwrap(),
        config
    );
    assert_eq!(
        rpc(&app, "plugin/installed", Some(json!({}))).await["marketplaces"],
        json!([])
    );
    assert!(!temp.path().join("agent/plugins/cache").exists());
    assert!(!temp.path().join("agent/plugins/remote-state").exists());
    let requests = finish(task).await;
    assert!(requests[3].contains("pageToken=installed%2B%2F%3D"));
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.contains("/installed?"))
            .count(),
        4
    );
    assert!(requests.iter().skip(1).all(|r| r.starts_with("GET ")));
    assert!(!requests
        .iter()
        .any(|r| r.contains("includeDownloadUrls=true")));
}

#[tokio::test]
async fn catalog_remote_changes_override_stale_materialization_without_mutating_it() {
    let temp = TempDir::new().unwrap();
    let issuer = super::install::issuer().await;
    let app = server(temp.path()).await;
    rpc(&app, "account/login/start", Some(login(&issuer.url))).await;
    rpc(&app, "plugin/install", detail("opaque~install")).await;
    let manifest = temp
        .path()
        .join("agent/plugins/cache/workspace-directory/research/.lime-remote-plugin-install.json");
    let bytes = std::fs::read(&manifest).unwrap();
    let before = rpc(&app, "plugin/installed", Some(json!({}))).await;
    assert_eq!(before["marketplaces"][0]["plugins"][0]["enabled"], true);
    let mut current = issuer.plugin.lock().unwrap().clone();
    let row = installed(current.clone(), "0.8.0", false);
    current["release"]["version"] = json!("2.0.0");
    *issuer.plugin.lock().unwrap() = current;
    issuer
        .installed_replies
        .lock()
        .unwrap()
        .push_back((200, page(vec![row], None)));
    let listed = rpc(&app, "plugin/list", workspace()).await;
    let summary = &listed["marketplaces"][0]["plugins"][0];
    assert_eq!(summary["version"], "2.0.0");
    assert_eq!(summary["localVersion"], "0.8.0");
    assert_eq!(summary["enabled"], false);
    *issuer.remotely_installed.lock().unwrap() = false;
    let listed = rpc(&app, "plugin/list", workspace()).await;
    assert_eq!(listed["marketplaces"][0]["plugins"][0]["installed"], false);
    assert_eq!(
        listed["marketplaces"][0]["plugins"][0]["localVersion"],
        Value::Null
    );
    assert_eq!(std::fs::read(&manifest).unwrap(), bytes);
    assert_eq!(rpc(&app, "plugin/installed", Some(json!({}))).await, before);
}

#[tokio::test]
async fn only_global_catalog_appends_installed_only_and_multiple_collections_share_one_snapshot() {
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let mut global = item("global~only", "global");
    global["scope"] = json!("GLOBAL");
    let mut user = item("user~only", "user");
    user["scope"] = json!("USER");
    let mut private = item("private~only", "private");
    private["discoverability"] = json!("PRIVATE");
    let rows = vec![
        installed(global, "0.1.0", true),
        installed(user, "0.2.0", true),
        installed(private, "0.3.0", true),
    ];
    let (url, task) = issuer(vec![
        ok(session("one")),
        ok(page(vec![], None)),
        ok(page(rows.clone(), None)),
        ok(page(vec![], None)),
        ok(page(vec![], None)),
        ok(page(vec![], None)),
        ok(page(vec![], None)),
        ok(page(rows, None)),
    ])
    .await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let global = rpc(&app, "plugin/list", Some(json!({}))).await;
    let market = &global["marketplaces"][0];
    assert_eq!(market["name"], "openai-curated-remote");
    assert_eq!(market["plugins"].as_array().unwrap().len(), 1);
    assert_eq!(market["plugins"][0]["remotePluginId"], "global~only");
    assert_eq!(market["plugins"][0]["localVersion"], "0.1.0");
    let explicit = rpc(
        &app,
        "plugin/list",
        Some(json!({"marketplaceKinds":[
            "workspace-directory","created-by-me-remote","vertical","shared-with-me",
            "workspace-directory"
        ]})),
    )
    .await;
    assert_eq!(explicit["marketplaces"], json!([]));
    let requests = finish(task).await;
    assert_eq!(requests.len(), 8);
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.contains("/installed?"))
            .count(),
        2
    );
    assert!(!requests
        .iter()
        .any(|r| r.contains("includeDownloadUrls=true")));
}

#[tokio::test]
async fn catalog_matches_opaque_identity_and_rejects_incomplete_installed_snapshots() {
    for installed_pages in [
        vec![ok(page(
            vec![installed(item("other", "research"), "0.9.0", true)],
            None,
        ))],
        vec![
            ok(page(
                vec![installed(item("same", "research"), "0.9.0", true)],
                Some("next"),
            )),
            (403, json!({"message":"revoked"}), String::new()),
        ],
        vec![ok(
            json!({"plugins":[],"pagination":{"next_page_token":""}}),
        )],
    ] {
        let temp = TempDir::new().unwrap();
        let app = server(temp.path()).await;
        let succeeds = installed_pages.len() == 1
            && installed_pages[0].1["plugins"]
                .as_array()
                .is_some_and(|rows| !rows.is_empty());
        let mut responses = vec![
            ok(session("one")),
            ok(page(vec![item("same", "research")], None)),
        ];
        responses.extend(installed_pages);
        let (url, task) = issuer(responses).await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        let result = raw(&app, "plugin/list", workspace()).await;
        if succeeds {
            assert_eq!(
                result["result"]["marketplaces"][0]["plugins"][0]["installed"],
                false
            );
        } else {
            assert!(result.get("error").is_some(), "{result}");
            assert!(result.get("result").is_none());
        }
        finish(task).await;
    }
}

#[tokio::test]
async fn catalog_discards_installed_snapshot_after_peer_logout() {
    let temp = TempDir::new().unwrap();
    let issuer = super::install::issuer().await;
    *issuer.remotely_installed.lock().unwrap() = true;
    let app = Arc::new(server(temp.path()).await);
    let peer = server(temp.path()).await;
    rpc(&app, "account/login/start", Some(login(&issuer.url))).await;
    let (entered, request_entered) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    *issuer.installed_gate.lock().unwrap() = Some((entered, released));
    let querying = app.clone();
    let pending = tokio::spawn(async move { raw(&querying, "plugin/list", workspace()).await });
    tokio::time::timeout(Duration::from_secs(10), request_entered)
        .await
        .unwrap()
        .unwrap();
    rpc(&peer, "account/logout", None).await;
    release.send(()).unwrap();
    let response = pending.await.unwrap();
    assert!(response.get("error").is_some());
    assert!(response.get("result").is_none());
}
