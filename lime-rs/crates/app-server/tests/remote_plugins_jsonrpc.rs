use serde_json::{json, Value};
use tempfile::TempDir;

#[path = "account_jsonrpc/issuer.rs"]
mod issuer;
#[path = "remote_plugins_jsonrpc/package.rs"]
mod package;
#[path = "remote_plugins_jsonrpc/runtime.rs"]
mod runtime;
use issuer::{raw, rpc, server, Fixture};

const MARKET: &str = "lime-cloud-publisher";
const PLUGIN: &str = "research@lime-cloud-publisher";
fn detail() -> Value {
    json!({"remoteMarketplaceName":MARKET,"pluginName":"item_research"})
}
fn cloud() -> Value {
    json!({"marketplaceKinds":["cloud"]})
}
fn install() -> Value {
    let mut value = detail();
    value["installAttemptId"] = json!("original-install-attempt");
    value
}
fn summary(value: &Value) -> &Value {
    &value["marketplaces"][0]["plugins"][0]
}
async fn login(f: &Fixture, server: &app_server::AppServer) {
    assert!(!f.authorize(server, "default").await["account"].is_null());
    assert!(!f.authorize(server, "market").await["account"].is_null());
}

#[tokio::test]
async fn public_cloud_catalog_checks_identity_digest_pagination_and_local_failure_isolation() {
    let temp = TempDir::new().unwrap();
    let server = server(temp.path()).await;
    assert!(rpc(
        &server,
        "plugin/list",
        json!({"marketplaceKinds":["local"]})
    )
    .await["marketplaces"]
        .is_array());
    assert!(
        !rpc(&server, "plugin/list", cloud()).await["marketplaceLoadErrors"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let f = Fixture::start().await;
    let item = package::configure(&f);
    login(&f, &server).await;
    let listed = rpc(&server, "plugin/list", cloud()).await;
    assert_eq!(summary(&listed)["id"], PLUGIN);
    assert_eq!(summary(&listed)["remotePluginId"], "item_research");
    assert_eq!(summary(&listed)["installed"], false);
    assert_eq!(summary(&listed)["installPolicy"], "AVAILABLE");
    assert_eq!(listed["marketplaces"][0]["path"], Value::Null);
    let read = rpc(&server, "plugin/read", detail()).await;
    assert_eq!(read["plugin"]["summary"], *summary(&listed));
    let mut wrong = detail();
    wrong["remoteMarketplaceName"] = json!("lime-cloud-other");
    assert!(raw(&server, "plugin/read", wrong)
        .await
        .get("error")
        .is_some());
    let mut tampered = item.clone();
    tampered["release"]["manifest"]["description"]["source"] = json!("tampered");
    f.respond(
        "/api/v1/client/market/items",
        200,
        json!({"items":[tampered],"nextCursor":""}),
    );
    assert!(
        !rpc(&server, "plugin/list", cloud()).await["marketplaceLoadErrors"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    f.respond(
        "/api/v1/client/market/items",
        200,
        json!({"items":[],"nextCursor":"repeated"}),
    );
    assert!(
        !rpc(&server, "plugin/list", cloud()).await["marketplaceLoadErrors"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    f.respond(
        "/api/v1/client/market/items",
        503,
        json!({"error":"private-provider-diagnostic"}),
    );
    assert!(rpc(&server, "plugin/list", json!({})).await["marketplaces"].is_array());
    assert!(!raw(&server, "plugin/list", cloud())
        .await
        .to_string()
        .contains("private-provider"));
    let state = f.state.lock().unwrap();
    let listings: Vec<_> = state
        .calls
        .iter()
        .filter(|(p, _, _)| p.contains("/market/items?"))
        .collect();
    assert!(listings
        .iter()
        .all(|(path, _, bearer)| path.contains("kind=plugin")
            && path.contains("capability=skills")
            && bearer == "Bearer access-market"));
    assert!(state
        .calls
        .iter()
        .all(|(path, _, _)| !path.contains("/tenants/") && !path.contains("/ps/")));
}

#[tokio::test]
async fn public_cloud_package_installs_into_current_local_owner_and_isolates_accounts() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    package::configure(&f);
    let first = server(temp.path()).await;
    login(&f, &first).await;
    assert_eq!(
        rpc(&first, "plugin/install", install()).await["authPolicy"],
        "ON_INSTALL"
    );
    let installed = rpc(&first, "plugin/installed", json!({})).await;
    assert_eq!(summary(&installed)["id"], PLUGIN);
    assert_eq!(summary(&installed)["localVersion"], "1.0.0");
    assert_eq!(summary(&installed)["enabled"], true);
    let read = rpc(&first, "plugin/read", detail()).await;
    assert_eq!(read["plugin"]["skills"][0]["name"], "research:research");
    assert!(read["plugin"]["skills"][0]["path"]
        .as_str()
        .unwrap()
        .ends_with("SKILL.md"));
    assert!(rpc(&first, "plugin/skill/read", json!({"remoteMarketplaceName":MARKET,"remotePluginId":"item_research","skillName":"research:research"})).await["contents"].as_str().unwrap().contains("Research instructions"));
    for enabled in [false, true] {
        rpc(&first, "config/batchWrite", json!({"edits":[{"keyPath":format!("plugins.\"{PLUGIN}\".enabled"),"value":enabled,"mergeStrategy":"replace"}]})).await;
        assert_eq!(
            summary(&rpc(&first, "plugin/installed", json!({})).await)["enabled"],
            enabled
        );
    }
    let cold = server(temp.path()).await;
    assert_eq!(
        summary(&rpc(&cold, "plugin/installed", json!({})).await),
        summary(&installed)
    );
    rpc(&cold, "account/logout", json!({})).await;
    assert_eq!(
        rpc(&first, "plugin/installed", json!({})).await["marketplaces"],
        json!([])
    );
    f.state.lock().unwrap().user = "person-b".into();
    login(&f, &cold).await;
    assert_eq!(
        rpc(&cold, "plugin/installed", json!({})).await["marketplaces"],
        json!([])
    );
    assert!(raw(&cold, "plugin/uninstall", json!({"pluginId":PLUGIN}))
        .await
        .get("error")
        .is_some());
    rpc(&cold, "account/logout", json!({})).await;
    f.state.lock().unwrap().user = "person-a".into();
    login(&f, &cold).await;
    rpc(&cold, "plugin/uninstall", json!({"pluginId":PLUGIN})).await;
    assert_eq!(
        rpc(&cold, "plugin/installed", json!({})).await["marketplaces"],
        json!([])
    );
    assert_eq!(f.count("/market/acquisitions"), 1);
    assert_eq!(f.count("/download-tickets"), 1);
    let state = f.state.lock().unwrap();
    assert!(state
        .calls
        .iter()
        .any(|(p, _, bearer)| p == "/bundle" && bearer.is_empty()));
    assert!(!state
        .calls
        .iter()
        .any(|(p, _, _)| p.contains("/revocations") || p.contains("/uninstall")));
}

#[tokio::test]
async fn public_unknown_acquisition_recovers_original_release_after_restart_without_posting_again()
{
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let original = package::configure(&f);
    let recovery = {
        let mut state = f.state.lock().unwrap();
        let key = state
            .responses
            .keys()
            .find(|p| p.contains("/market/operations/"))
            .unwrap()
            .clone();
        let reply = state.responses.remove(&key).unwrap();
        (key, reply)
    };
    f.state.lock().unwrap().responses.insert(
        "/api/v1/client/market/acquisitions".into(),
        (200, b"invalid-json".to_vec()),
    );
    let first = server(temp.path()).await;
    login(&f, &first).await;
    assert!(raw(&first, "plugin/install", install())
        .await
        .get("error")
        .is_some());
    assert_eq!(f.count("/market/acquisitions"), 1);
    f.state
        .lock()
        .unwrap()
        .responses
        .insert(recovery.0, recovery.1);
    let cold = server(temp.path()).await;
    let mut newer = original.clone();
    newer["publishedReleaseId"] = json!("rel_newer");
    f.respond("/api/v1/client/market/items/item_research", 200, newer);
    let mut resumed = install();
    resumed["installAttemptId"] = json!("different-click-attempt");
    rpc(&cold, "plugin/install", resumed).await;
    assert_eq!(f.count("/market/acquisitions"), 1);
    assert_eq!(f.count("/market/items/item_research"), 1);
    let state = f.state.lock().unwrap();
    assert!(state
        .calls
        .iter()
        .any(|(p, _, _)| p.contains("/market/operations/")));
    assert!(state.calls.iter().all(|(p, _, _)| !p.contains("rel_newer")));
}

#[tokio::test]
async fn public_package_rejects_archive_tampering_without_committing_local_files() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    package::configure(&f);
    let server = server(temp.path()).await;
    login(&f, &server).await;
    f.state
        .lock()
        .unwrap()
        .responses
        .insert("/bundle".into(), (200, b"tampered".to_vec()));
    assert!(raw(&server, "plugin/install", install())
        .await
        .get("error")
        .is_some());
    assert_eq!(
        rpc(&server, "plugin/installed", json!({})).await["marketplaces"],
        json!([])
    );
}
