//! Opt-in real Cloud/Core/public identity and native stdio market acceptance.
//! Object storage, browser navigation and model responses are explicit fixtures.
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use support::json_lines_transport::TransportClient;

async fn login(peer: &mut TransportClient, browser: &str, resource: &str) {
    let started = peer
        .request_ok(
            2,
            "account/login/start",
            json!({
                "type":"cloud", "resource":resource, "language":"zh-CN"
            }),
        )
        .await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client
        .post(format!("{browser}/authorize"))
        .json(&json!({"url":started["result"]["authUrl"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status().as_u16(),
        204,
        "actual {resource} authorization chain"
    );
    let id = &started["result"]["authorization"]["id"];
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let read = peer
                .request_ok(3, "account/read", json!({"authorizationId":id}))
                .await;
            let authorization = read["result"]["authorizations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|value| value["id"] == *id)
                .unwrap();
            match authorization["status"].as_str() {
                Some("completed") => break,
                Some("pending" | "exchanging") => {
                    tokio::time::sleep(Duration::from_millis(5)).await
                }
                status => panic!("actual {resource} authorization failed: {status:?}"),
            }
        }
    })
    .await
    .expect("native signature and identity verification must complete");
}

async fn turn(
    peer: &mut TransportClient,
    root: &Path,
    skill: &Value,
    server: &Value,
    model: &ModelFixture,
) {
    let started = peer
        .request_ok(
            10,
            "thread/start",
            json!({
                "cwd":root,"modelProvider":"market-joint-model","model":Wire::Chat.model(),
                "config":{"approval_policy":"never"}
            }),
        )
        .await;
    let thread = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let started = peer
        .request_ok(
            11,
            "turn/start",
            json!({"threadId":thread,"input":[
                {"type":"text","text":"Follow the selected research skill."},
                {"type":"skill","name":skill["name"],"path":skill["path"]}
            ]}),
        )
        .await;
    let id = started["result"]["turn"]["id"].as_str().unwrap();
    tokio::time::timeout(
        Duration::from_secs(30),
        peer.wait_for_turn_completed(&thread, id),
    )
    .await
    .unwrap();
    assert!(model
        .last_request()
        .history()
        .to_string()
        .contains("Research instructions"));
    if server.is_null() {
        return;
    }
    let called = peer.request_ok(12, "mcpServer/tool/call", json!({
        "threadId":thread,"server":server,"tool":"search","arguments":{"query":"native-joint"}
    })).await;
    assert_eq!(
        called["result"]["content"][0]["text"],
        "research:native-joint"
    );
    assert!(called["result"]["isError"] == false || called["result"]["isError"].is_null());
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires isolated Cloud/Core HTTP, separate MySQL schemas and frozen native artifact"]
async fn real_public_client_shared_market_install_and_runtime() {
    let core = std::env::var("LIME_NATIVE_JOINT_CORE_URL").unwrap();
    let browser = std::env::var("LIME_NATIVE_JOINT_BROWSER").unwrap();
    let binary = std::env::var("LIME_NATIVE_JOINT_APP_SERVER").unwrap();
    let unknown = std::env::var("LIME_NATIVE_MARKET_UNKNOWN").unwrap() == "1";
    let root = tempfile::tempdir().unwrap();
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), |_| None).await;
    let roots =
        app_server::StorageRoots::initialize(root.path().join("app"), root.path().join("agent"))
            .unwrap();
    let db = lime_core::database::init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            "market-joint-model",
            Wire::Chat.model(),
            Wire::Chat.provider_type(),
            &model.url,
            Wire::Chat.credential(),
        )],
        false,
    );
    drop(db);
    std::fs::write(
        root.path().join("config.yaml"),
        json!({"cloud":{"base_url":core}}).to_string(),
    )
    .unwrap();
    let mut peer =
        TransportClient::start_stdio(Path::new(&binary), root.path(), "market-joint-first").await;
    // A real business request performs several current-identity checks. This
    // harness budget covers that sequence under Go race instrumentation.
    peer.set_read_timeout(Duration::from_secs(60));
    for resource in ["default", "market"] {
        login(&mut peer, &browser, resource).await;
    }
    for (variable, path) in [
        (
            "LIME_NATIVE_MARKET_FOREIGN_ACQUISITION",
            "/market/acquisitions/",
        ),
        (
            "LIME_NATIVE_MARKET_FOREIGN_OPERATION",
            "/market/operations/",
        ),
    ] {
        let id = std::env::var(variable).unwrap_or_default();
        if !id.is_empty() {
            let read = peer
                .request_ok(
                    4,
                    "cloud/request",
                    json!({"path":format!("{path}{id}"),"method":"GET","language":"en"}),
                )
                .await;
            assert_eq!(
                read["result"]["status"], 404,
                "another application must not read a private acquisition or receipt"
            );
        }
    }
    let mut installed = Vec::new();
    let kinds = if unknown {
        vec!["skill", "mcp"]
    } else {
        vec!["skill"]
    };
    for kind in kinds {
        let listed = peer
            .request_ok(5, "market/list", json!({"kind":kind}))
            .await;
        let resources = listed["result"]["resources"].as_array().unwrap();
        assert_eq!(resources.len(), 1, "one actually published {kind}");
        let resource = resources[0].clone();
        assert!(resource["installation"].is_null());
        let params = json!({"itemId":resource["itemId"],"kind":kind,"release":resource["release"],"installAttemptId":format!("native-joint-{kind}")});
        if kind == "skill" && unknown {
            let failed = peer.request(6, "market/install", params.clone()).await;
            assert!(
                failed.get("error").is_some(),
                "the committed acquisition response was deliberately lost"
            );
            let pending = peer
                .request_ok(7, "market/install/pending", json!({}))
                .await;
            assert_eq!(
                pending["result"]["attempts"].as_array().unwrap().len(),
                1,
                "an unknown acquisition must remain pending; install response: {failed}"
            );
            peer.shutdown().await;
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            assert_eq!(
                client
                    .post(format!("{core}/_native-market/resume"))
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16(),
                204
            );
            peer = TransportClient::start_stdio(
                Path::new(&binary),
                root.path(),
                "market-joint-recovery",
            )
            .await;
            peer.set_read_timeout(Duration::from_secs(60));
            let mut resumed = params.clone();
            resumed["installAttemptId"] = json!("new-click-must-retain-original");
            let result = peer.request_ok(8, "market/install", resumed).await;
            assert_eq!(result["result"]["resource"]["release"], resource["release"]);
        } else {
            peer.request_ok(8, "market/install", params).await;
        }
        installed.push(resource);
    }
    let skills = peer
        .request_ok(
            9,
            "skills/list",
            json!({"cwds":[root.path()],"forceReload":true}),
        )
        .await;
    let skill = skills["result"]["data"][0]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .find(|skill| {
            skill["name"] == "research"
                && skill["path"].as_str().is_some_and(|path| {
                    Path::new(path).starts_with(root.path().canonicalize().unwrap())
                })
        })
        .expect("the exact Cloud skill must be available to the local runtime")
        .clone();
    if !unknown {
        turn(&mut peer, root.path(), &skill, &Value::Null, &model).await;
        assert_eq!(model.request_count(), 1);
        peer.shutdown().await;
        return;
    }
    let read = peer
        .request_ok(9, "market/installed", json!({"kind":"mcp"}))
        .await;
    let server = read["result"]["resources"][0]["installation"]["mcpServerName"].clone();
    turn(&mut peer, root.path(), &skill, &server, &model).await;
    let listed = peer
        .request_ok(13, "plugin/list", json!({"marketplaceKinds":["cloud"]}))
        .await;
    assert_eq!(listed["result"]["marketplaceLoadErrors"], json!([]));
    let marketplace = &listed["result"]["marketplaces"][0];
    let plugin = &marketplace["plugins"][0];
    let detail =
        json!({"remoteMarketplaceName":marketplace["name"],"pluginName":plugin["remotePluginId"]});
    let read = peer.request_ok(14, "plugin/read", detail.clone()).await;
    let mut params = detail.clone();
    params["remoteRelease"] = read["result"]["plugin"]["summary"]["remoteRelease"].clone();
    params["installAttemptId"] = json!("native-joint-plugin");
    // One plugin installation performs three sequential acquisitions and
    // downloads, each with real current-identity checks under Go race.
    peer.set_read_timeout(Duration::from_secs(180));
    peer.request_ok(15, "plugin/install", params).await;
    let read = peer.request_ok(16, "plugin/read", detail.clone()).await;
    let skill = read["result"]["plugin"]["skills"][0].clone();
    let server = read["result"]["plugin"]["mcpServers"][0].clone();
    turn(&mut peer, root.path(), &skill, &server, &model).await;
    assert_eq!(model.request_count(), 2);
    peer.shutdown().await;
    let mut peer =
        TransportClient::start_stdio(Path::new(&binary), root.path(), "market-joint-cold").await;
    peer.set_read_timeout(Duration::from_secs(60));
    let read = peer.request_ok(17, "market/installed", json!({})).await;
    assert_eq!(read["result"]["resources"].as_array().unwrap().len(), 2);
    assert_eq!(read["result"]["errors"], json!([]));
    let pending = peer
        .request_ok(18, "market/install/pending", json!({}))
        .await;
    assert_eq!(pending["result"]["attempts"], json!([]));
    let read = peer.request_ok(19, "plugin/installed", json!({})).await;
    assert_eq!(
        read["result"]["marketplaces"][0]["plugins"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for resource in installed {
        for enabled in [false, true] {
            peer.request_ok(
                20,
                "market/enabled/set",
                json!({"itemId":resource["itemId"],"kind":resource["kind"],"enabled":enabled}),
            )
            .await;
        }
    }
    let account = peer.request_ok(21, "account/read", json!({})).await;
    for projection in [
        read.to_string(),
        account.to_string(),
        model.last_request().history().to_string(),
    ] {
        for forbidden in [
            "access_token",
            "refresh_token",
            "client_secret",
            "code_verifier",
        ] {
            assert!(
                !projection.contains(forbidden),
                "native projections exposed {forbidden}"
            );
        }
    }
    peer.shutdown().await;
}
