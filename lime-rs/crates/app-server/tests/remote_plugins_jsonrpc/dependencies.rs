use super::*;
use sha2::{Digest, Sha256};

pub(super) fn operation_path(attempt: &str, item: &str, phase: &str) -> String {
    let mut digest = Sha256::new();
    for value in [attempt, item, phase] {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    format!(
        "/api/v1/client/market/operations/{}",
        hex::encode(digest.finalize())
    )
}

fn fixtures() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../src/market/testdata/cloud-market-types.json"
    ))
    .unwrap()
}

fn configure(f: &Fixture) -> Value {
    let fixtures = fixtures();
    configure_artifacts(f, &fixtures)
}

pub(super) fn configure_artifacts(f: &Fixture, fixtures: &[Value]) -> Value {
    for fixture in fixtures {
        let item = &fixture["item"];
        let release = &item["release"];
        let id = release["id"].as_str().unwrap();
        let acquisition = format!("acq_{}", item["kind"].as_str().unwrap());
        // HTTP and stdio fixtures share a type, but only HTTP is a dependency here.
        let acquisition = format!(
            "{acquisition}_{}",
            if id.ends_with("stdio") {
                "stdio"
            } else {
                "main"
            }
        );
        f.respond(
            &format!(
                "/api/v1/client/market/items/{}",
                item["id"].as_str().unwrap()
            ),
            200,
            item.clone(),
        );
        f.respond(
            &format!("/api/v1/client/market/releases/{id}"),
            200,
            release.clone(),
        );
        let acquired = json!({"id":acquisition,"releaseId":id,"status":"active","revision":1});
        f.respond(
            &format!("/api/v1/client/market/acquisitions#{id}"),
            200,
            acquired.clone(),
        );
        let ticket = json!({"sha256":release["archiveSha256"],"size":release["archiveSize"],"download":{
            "url":format!("{}/bundle/{id}", f.base),"method":"GET","headers":{},
            "expiresAt":(chrono::Utc::now()+chrono::Duration::minutes(5)).to_rfc3339()
        }});
        f.respond(
            &format!("/api/v1/client/market/acquisitions/{acquisition}/download-tickets"),
            200,
            ticket.clone(),
        );
        let attempt = if item["kind"] == "plugin" {
            "dependency-install-attempt".to_string()
        } else {
            format!("dependency-install-attempt:{id}")
        };
        let item_id = item["id"].as_str().unwrap();
        f.respond(
            &operation_path(&attempt, item_id, "acquire"),
            200,
            json!({"result":acquired}),
        );
        f.respond(
            &operation_path(&attempt, item_id, "download"),
            200,
            json!({"result":ticket}),
        );
        f.respond(
            &format!("/api/v1/client/market/acquisitions/{acquisition}"),
            200,
            json!({"id":acquisition,"releaseId":id,"status":"active","revision":1}),
        );
        f.state.lock().unwrap().responses.insert(
            format!("/bundle/{id}"),
            (
                200,
                hex::decode(fixture["archiveHex"].as_str().unwrap()).unwrap(),
            ),
        );
    }
    fixtures[3]["item"].clone()
}

fn install_params(item: &Value) -> Value {
    json!({"remoteMarketplaceName":MARKET,"pluginName":item["id"],"remoteRelease":reference(&item["release"]),"installAttemptId":"dependency-install-attempt"})
}

pub(super) async fn install_cloud_dependencies(f: &Fixture, server: &app_server::AppServer) {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../src/market/testdata/cloud-market-runtime.json"
    ))
    .unwrap();
    let item = configure_artifacts(f, &fixtures);
    rpc(server, "plugin/install", install_params(&item)).await;
}

#[tokio::test]
async fn exact_dependencies_are_installed_loaded_and_removed_with_the_plugin() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let item = configure(&f);
    let server = server(temp.path()).await;
    login(&f, &server).await;
    rpc(&server, "plugin/install", install_params(&item)).await;
    let read = rpc(
        &server,
        "plugin/read",
        json!({"remoteMarketplaceName":MARKET,"pluginName":item["id"]}),
    )
    .await;
    assert_eq!(read["plugin"]["skills"][0]["name"], "research:research");
    assert_eq!(read["plugin"]["mcpServers"].as_array().unwrap().len(), 1);
    assert!(read["plugin"]["mcpServers"][0]
        .as_str()
        .unwrap()
        .starts_with("market_"));
    let statuses = rpc(&server, "mcpServerStatus/list", json!({})).await;
    let mcp_name = read["plugin"]["mcpServers"][0].as_str().unwrap();
    let mcp = statuses["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == mcp_name)
        .unwrap();
    assert_eq!(mcp["pluginId"], PLUGIN);
    assert_eq!(mcp["authStatus"], "notLoggedIn");
    let skills = rpc(
        &server,
        "skills/list",
        json!({"cwds":[temp.path()],"forceReload":true}),
    )
    .await;
    let skill = skills["data"][0]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .find(|skill| skill["name"] == "research:research")
        .unwrap();
    let path = std::path::PathBuf::from(skill["path"].as_str().unwrap());
    assert!(path
        .to_string_lossy()
        .contains(".dependencies/rel_research_skill/"));
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("Research instructions"));
    assert_eq!(f.count("/market/acquisitions"), 3);
    let installed = rpc(&server, "plugin/installed", json!({})).await;
    assert_eq!(
        installed["marketplaces"][0]["plugins"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        installed["marketplaces"][0]["plugins"][0]["remotePluginId"],
        item["id"]
    );
    rpc(&server, "plugin/uninstall", json!({"pluginId":PLUGIN})).await;
    assert!(!path.exists());
    let skills = rpc(
        &server,
        "skills/list",
        json!({"cwds":[temp.path()],"forceReload":true}),
    )
    .await;
    assert!(!skills["data"][0]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .any(|skill| skill["name"] == "research:research"));
}

#[tokio::test]
async fn mismatched_dependency_is_rejected_before_any_acquisition() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let item = configure(&f);
    // A valid release of the wrong type must not satisfy the exact reference.
    f.respond(
        "/api/v1/client/market/releases/rel_research_skill",
        200,
        fixtures()[1]["item"]["release"].clone(),
    );
    let server = server(temp.path()).await;
    login(&f, &server).await;
    assert!(raw(&server, "plugin/install", install_params(&item))
        .await
        .get("error")
        .is_some());
    assert_eq!(f.count("/market/acquisitions"), 0);
    assert_eq!(
        rpc(&server, "plugin/installed", json!({})).await["marketplaces"],
        json!([])
    );
}

#[tokio::test]
async fn dependency_failure_preserves_existing_plugin_and_resumes_original_revision() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let (mut previous, bytes) = package::artifact();
    previous["id"] = json!("item_research_plugin");
    previous["release"]["itemId"] = previous["id"].clone();
    let previous = package::configure_artifact(&f, previous, bytes);
    f.respond(
        "/api/v1/client/market/items/item_research_plugin",
        200,
        previous.clone(),
    );
    let server = server(temp.path()).await;
    login(&f, &server).await;
    let mut previous_install = install_params(&previous);
    previous_install["installAttemptId"] = json!("previous-plugin-install-attempt");
    rpc(&server, "plugin/install", previous_install).await;
    let item = configure(&f);
    let release_path = "/api/v1/client/market/items/item_research_skill";
    let ticket_path = "/api/v1/client/market/acquisitions/acq_mcp_main/download-tickets";
    let ticket = f.state.lock().unwrap().responses[ticket_path].clone();
    let recovery = operation_path(
        "dependency-install-attempt:rel_research_http",
        "item_research_http",
        "download",
    );
    let recovered = f.state.lock().unwrap().responses.remove(&recovery).unwrap();
    f.respond(ticket_path, 503, json!({"error":"outcome_unknown"}));
    assert!(raw(&server, "plugin/install", install_params(&item))
        .await
        .get("error")
        .is_some());
    let installed = rpc(&server, "plugin/installed", json!({})).await;
    assert_eq!(
        installed["marketplaces"][0]["plugins"][0]["localRelease"]["id"],
        "rel_research"
    );
    let mut changed = fixtures()[0]["item"].clone();
    changed["revision"] = json!(9);
    f.respond(release_path, 200, changed);
    f.state
        .lock()
        .unwrap()
        .responses
        .insert(ticket_path.into(), ticket);
    // A fresh attempt id must resume the saved operation, not dispatch new writes.
    let mut retry = install_params(&item);
    retry["installAttemptId"] = json!("replacement-attempt-must-not-be-used");
    f.state
        .lock()
        .unwrap()
        .responses
        .insert(recovery, recovered);
    let cold = issuer::server(temp.path()).await;
    let response = raw(&cold, "plugin/install", retry).await;
    assert!(response.get("error").is_none(), "{response}");
    let state = f.state.lock().unwrap();
    let acquisitions = state
        .calls
        .iter()
        .filter(|(path, body, _)| {
            path.ends_with("/market/acquisitions") && body["releaseId"] == "rel_research_skill"
        })
        .collect::<Vec<_>>();
    assert_eq!(acquisitions.len(), 1);
    assert_eq!(acquisitions[0].1["expectedItemRevision"], 1);
    assert_eq!(
        state
            .calls
            .iter()
            .filter(|(path, _, _)| path.ends_with("/market/acquisitions"))
            .count(),
        4
    );
}
