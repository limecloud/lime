use std::fs;
use std::sync::{Arc, Mutex};

use app_server::{AppServer, LocalAppDataSource, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_PLUGIN_INSTALL, METHOD_PLUGIN_SEARCH};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use lime_core::database::schema::create_tables;
use rusqlite::Connection;
use serde_json::{json, Value};
use tempfile::TempDir;

#[tokio::test]
async fn plugin_search_uses_current_catalog_and_codex_wire_contract() {
    let temp = TempDir::new().expect("plugin search temp dir");
    let server = server(&temp).await;
    initialize(&server).await;

    let marketplace = temp.path().join(".agents/plugins/marketplace.json");
    fs::create_dir_all(marketplace.parent().unwrap()).unwrap();
    fs::write(
        &marketplace,
        serde_json::to_vec(&json!({
            "name": "workspace-market",
            "plugins": [
                {"name":"alpha-plugin", "source":{"source":"local", "path":"./alpha-plugin"}},
                {"name":"beta-plugin", "source":{"source":"local", "path":"./beta-plugin"}}
            ]
        }))
        .unwrap(),
    )
    .unwrap();

    let plugins = [
        (2, "alpha-plugin", "Alpha Plugin"),
        (3, "beta-plugin", "Beta Plugin"),
    ];
    for (_, name, display_name) in plugins {
        let source = temp.path().join(name);
        write_plugin(&source, name, display_name);
    }
    for (id, name, _) in plugins {
        request(
            &server,
            id,
            METHOD_PLUGIN_INSTALL,
            json!({
                "marketplacePath": marketplace,
                "pluginName": name
            }),
        )
        .await;
    }

    let first = request(
        &server,
        4,
        METHOD_PLUGIN_SEARCH,
        json!({
            "searchTerm": "plugin",
            "scope": "workspace",
            "cwds": [temp.path()],
            "limit": 1
        }),
    )
    .await;
    assert_eq!(first["result"]["data"].as_array().unwrap().len(), 1);
    assert_eq!(first["result"]["nextCursor"], "1");
    assert_eq!(
        first["result"]["data"][0]["plugin"]["id"],
        "alpha-plugin@workspace-market"
    );
    assert_eq!(
        first["result"]["data"][0]["marketplaceName"],
        "workspace-market"
    );
    assert_eq!(
        first["result"]["data"][0]["plugin"]["source"]["type"],
        "local"
    );
    assert_eq!(
        first["result"]["data"][0]["plugin"]["installPolicy"],
        "AVAILABLE"
    );
    assert_eq!(first["result"]["data"][0]["plugin"]["authPolicy"], "ON_USE");

    let second = request(
        &server,
        5,
        METHOD_PLUGIN_SEARCH,
        json!({
            "searchTerm": "plugin",
            "scope": "workspace",
            "cwds": [temp.path()],
            "cursor": "1",
            "limit": 1
        }),
    )
    .await;
    assert_eq!(
        second["result"]["data"][0]["plugin"]["id"],
        "beta-plugin@workspace-market"
    );
    assert_eq!(second["result"]["nextCursor"], Value::Null);

    let personal = request(
        &server,
        6,
        METHOD_PLUGIN_SEARCH,
        json!({"searchTerm": "plugin", "scope": "personal", "cwds": [temp.path()]}),
    )
    .await;
    assert_eq!(personal["result"], json!({"data": [], "nextCursor": null}));

    let unrelated = temp.path().join("unrelated-workspace");
    fs::create_dir(&unrelated).unwrap();
    let empty = request(
        &server,
        7,
        METHOD_PLUGIN_SEARCH,
        json!({"searchTerm":"plugin", "scope":"workspace", "cwds":[unrelated]}),
    )
    .await;
    assert_eq!(empty["result"], json!({"data":[], "nextCursor":null}));
}

async fn server(temp: &TempDir) -> AppServer {
    let connection = Connection::open_in_memory().expect("plugin search product db");
    create_tables(&connection).expect("plugin search product schema");
    let app_data_source = LocalAppDataSource::initialize_with_roots(
        Arc::new(Mutex::new(connection)),
        temp.path(),
        temp.path().join("agent-root"),
    )
    .await
    .expect("plugin search app data source")
    .with_app_config_path(temp.path().join("config.yaml"))
    .with_plugin_discovery_roots(None, None);
    let runtime = RuntimeCore::with_backend(Arc::new(MockBackend))
        .with_app_config_path(temp.path().join("config.yaml"))
        .with_app_data_source(Arc::new(app_data_source));
    AppServer::with_runtime(runtime)
}

fn write_plugin(root: &std::path::Path, name: &str, display_name: &str) {
    fs::create_dir_all(root.join(".lime-plugin")).expect("create plugin manifest directory");
    fs::write(
        root.join("plugin.json"),
        serde_json::to_vec_pretty(&json!({
            "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
            "name": name,
            "version": "1.0.0",
            "description": format!("{display_name} description")
        }))
        .expect("serialize standard plugin manifest"),
    )
    .expect("write standard plugin manifest");
    fs::write(
        root.join(".lime-plugin/plugin.json"),
        serde_json::to_vec_pretty(&json!({
            "name": name,
            "version": "1.0.0",
            "description": format!("{display_name} description"),
            "interface": {"displayName": display_name}
        }))
        .expect("serialize plugin manifest"),
    )
    .expect("write plugin manifest");
}

async fn initialize(server: &AppServer) {
    request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({"clientInfo": {"name": "plugin-search-jsonrpc-test", "version": "1"}}),
    )
    .await;
    server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .expect("initialized notification");
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let response = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .expect("JSON-RPC request")
        .iter()
        .filter_map(|message| serde_json::from_str::<Value>(message).ok())
        .find(|message| message.get("id") == Some(&json!(id)))
        .expect("JSON-RPC response");
    assert!(
        response.get("error").is_none(),
        "plugin search request failed: {response:#}"
    );
    response
}

#[tokio::test]
async fn grouped_plugin_contract_preserves_errors_policy_and_install_state() {
    let temp = TempDir::new().unwrap();
    let server = server(&temp).await;
    initialize(&server).await;
    let source = temp.path().join("proof");
    write_plugin(&source, "proof", "Proof Plugin");
    let marketplace = temp.path().join(".agents/plugins/marketplace.json");
    fs::create_dir_all(marketplace.parent().unwrap()).unwrap();
    fs::write(
        &marketplace,
        serde_json::to_vec(&json!({
            "name": "proof-market", "plugins": [{
                "name": "proof", "source": "./proof",
                "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    let broken = temp.path().join("broken/.agents/plugins/marketplace.json");
    fs::create_dir_all(broken.parent().unwrap()).unwrap();
    fs::write(&broken, "{broken").unwrap();
    let cwds = json!({"cwds": [temp.path(), temp.path().join("broken")]});
    let listed = request(&server, 20, "plugin/list", cwds.clone()).await;
    assert_eq!(
        listed["result"]["marketplaces"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        listed["result"]["marketplaceLoadErrors"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let summary = &listed["result"]["marketplaces"][0]["plugins"][0];
    assert_eq!(summary["id"], "proof@proof-market");
    assert_eq!(summary["name"], "proof");
    assert_eq!(summary["interface"]["displayName"], "Proof Plugin");
    assert_eq!(summary["installed"], false);
    for field in [
        "sourceUri",
        "contentDigest",
        "skillsCount",
        "mcpServersCount",
    ] {
        assert!(
            summary.get(field).is_none(),
            "retired summary field: {field}"
        );
    }
    let location = json!({"marketplacePath": marketplace, "pluginName": "proof"});
    let detail = request(&server, 21, "plugin/read", location.clone()).await;
    assert_eq!(
        detail["result"]["plugin"]["marketplaceName"],
        "proof-market"
    );
    assert_eq!(detail["result"]["plugin"]["summary"]["installed"], false);
    assert!(detail["result"]["plugin"].get("uiResources").is_none());
    let initial = request(&server, 22, "plugin/installed", cwds.clone()).await;
    assert_eq!(initial["result"]["marketplaces"], json!([]));
    let suggested = request(
        &server,
        23,
        "plugin/installed",
        json!({
            "cwds": [temp.path()], "installSuggestionPluginNames": ["proof"]
        }),
    )
    .await;
    assert_eq!(
        suggested["result"]["marketplaces"][0]["plugins"][0]["installed"],
        false
    );
    let installed = request(&server, 24, METHOD_PLUGIN_INSTALL, location).await;
    assert_eq!(
        installed["result"],
        json!({"authPolicy": "ON_INSTALL", "appsNeedingAuth": []})
    );
    let active = request(&server, 25, "plugin/installed", cwds).await;
    assert_eq!(
        active["result"]["marketplaces"][0]["plugins"][0]["enabled"],
        true
    );
    let legacy = server
        .handle_json_line(
            &json!({
                "id": 26, "method": METHOD_PLUGIN_INSTALL,
                "params": {"sourcePath": source, "expectedDigest": "sha256:legacy"}
            })
            .to_string(),
        )
        .await
        .unwrap();
    assert!(
        legacy.iter().any(|line| serde_json::from_str::<Value>(line)
            .unwrap()
            .get("error")
            .is_some()),
        "retired directory install accepted: {legacy:?}"
    );
    let preserved = request(
        &server,
        27,
        "plugin/installed",
        json!({"cwds": [temp.path()]}),
    )
    .await;
    assert_eq!(
        preserved["result"]["marketplaces"],
        active["result"]["marketplaces"]
    );
}
