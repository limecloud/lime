//! A real App Server process resumes the originating web tool after verified OAuth.
#[path = "account_jsonrpc/issuer.rs"]
mod issuer;
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use issuer::Fixture;
use provider::{ModelFixture, Wire};
use serde_json::json;
use std::{path::Path, time::Duration};
use support::json_lines_transport::TransportClient;

#[tokio::test]
async fn real_stdio_first_web_authorization_resumes_one_original_turn() {
    web_authorization("opened", true, "web").await;
}

#[tokio::test]
async fn real_stdio_cancelled_unavailable_and_denied_authorizations_do_not_search() {
    for action in ["cancelled", "unavailable", "denied"] {
        web_authorization(action, true, "web").await;
    }
}

#[tokio::test]
async fn real_stdio_anonymous_first_task_resumes_after_default_and_web_authorization() {
    web_authorization("opened", false, "web").await;
}

#[tokio::test]
async fn real_stdio_anonymous_authorization_failures_never_search() {
    for resource in ["default", "web"] {
        for action in ["cancelled", "unavailable", "denied"] {
            web_authorization(action, false, resource).await;
        }
    }
}

async fn web_authorization(action: &str, signed_in: bool, failed_resource: &str) {
    let root = tempfile::tempdir().unwrap();
    let cloud = Fixture::start().await;
    cloud.respond("/api/v1/client/web/searches", 200, json!({
        "id":"web_search_stdio", "kind":"search", "status":"completed",
        "usage":{"requests":1,"responseBytes":32,"billingStatus":"unpriced"},
        "search":{"items":[{"title":"Rust release", "url":"https://blog.rust-lang.org/",
            "summary":"authorized-stdio-search", "retrievedAt":"2026-11-12T00:00:00Z"}], "truncated":false}
    }));
    let mut step = 0;
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), move |_| {
        step += 1;
        (step == 1).then(|| {
            (
                "original-search-call".into(),
                "WebSearch".into(),
                json!({"query":"Rust release"}),
            )
        })
    })
    .await;
    let roots =
        app_server::StorageRoots::initialize(root.path().join("app"), root.path().join("agent"))
            .unwrap();
    let db = lime_core::database::init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            "cloud-web-stdio",
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
        json!({"cloud":{"base_url":cloud.base}}).to_string(),
    )
    .unwrap();
    let mut peer = TransportClient::start_stdio(
        Path::new(env!("CARGO_BIN_EXE_app-server")),
        root.path(),
        "cloud-web-authorization",
    )
    .await;
    if signed_in {
        let login = peer
            .request_ok(
                2,
                "account/login/start",
                json!({
                    "type":"cloud", "resource":"default", "language":"zh-CN"
                }),
            )
            .await["result"]
            .clone();
        cloud.callback(login["authUrl"].as_str().unwrap()).await;
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let read = peer
                    .request_ok(
                        3,
                        "account/read",
                        json!({
                            "authorizationId":login["authorization"]["id"]
                        }),
                    )
                    .await;
                if read["result"]["account"]["userId"] == "person-a" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("default account authorization completes");
    }
    let started = peer
        .request_ok(
            4,
            "thread/start",
            json!({
                "cwd":root.path(), "modelProvider":"cloud-web-stdio", "model":Wire::Chat.model(),
                "config":{"web_search":"live", "approval_policy":"never"}
            }),
        )
        .await;
    let thread = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let started = peer.request_ok(5, "turn/start", json!({
        "threadId":thread, "input":[{"type":"text", "text":"Search for the current Rust release."}]
    })).await;
    let turn = started["result"]["turn"]["id"].as_str().unwrap().to_owned();
    let mut token_count = usize::from(signed_in);
    for resource in ["default", "web"] {
        if resource == "default" && signed_in {
            continue;
        }
        let handoff = peer.wait_for_server_request("account/authorize").await;
        assert_eq!(handoff["params"]["threadId"], thread);
        assert_eq!(handoff["params"]["authorization"]["resource"], resource);
        assert_eq!(handoff["params"]["authorization"]["status"], "pending");
        assert_eq!(cloud.count("/web/searches"), 0);
        assert_eq!(cloud.count("/product-users"), 0);
        assert_eq!(cloud.count("/auth/token"), token_count);
        let current_action = if resource == failed_resource {
            action
        } else {
            "opened"
        };
        peer.respond(
            &handoff,
            json!({"action":if current_action == "denied" {"opened"} else {current_action}}),
        )
        .await;
        if current_action == "opened" || current_action == "denied" {
            // A browser handoff grants neither a product relationship nor search access.
            tokio::time::sleep(Duration::from_millis(50)).await;
            assert_eq!(cloud.count("/web/searches"), 0);
            assert_eq!(cloud.count("/product-users"), 0);
            assert_eq!(cloud.count("/auth/token"), token_count);
            let auth_url = handoff["params"]["authUrl"].as_str().unwrap();
            if current_action == "opened" {
                cloud.callback(auth_url).await;
                token_count += 1;
            } else {
                let url = reqwest::Url::parse(auth_url).unwrap();
                let values: std::collections::BTreeMap<_, _> =
                    url.query_pairs().into_owned().collect();
                let mut callback = reqwest::Url::parse(&values["redirect_uri"]).unwrap();
                callback
                    .query_pairs_mut()
                    .append_pair("state", &values["state"])
                    .append_pair("error", "access_denied");
                let response = reqwest::Client::builder()
                    .no_proxy()
                    .build()
                    .unwrap()
                    .get(callback)
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status().as_u16(), 204);
            }
        }
        if current_action != "opened" {
            break;
        }
    }
    peer.wait_for_turn_completed(&thread, &turn).await;
    let read = peer
        .request_ok(
            6,
            "thread/read",
            json!({
                "threadId":thread, "includeTurns":true
            }),
        )
        .await;
    let turns = read["result"]["thread"]["turns"].as_array().unwrap();
    assert_eq!(turns.len(), 1, "authorization must resume the same turn");
    assert_eq!(turns[0]["id"], turn);
    assert_eq!(
        model.request_count(),
        2,
        "authorization does not restart model sampling"
    );
    let history = model.last_request().history().to_string();
    assert!(history.contains("original-search-call"), "{history}");
    let successful = action == "opened";
    assert_eq!(
        history.contains("authorized-stdio-search"),
        successful,
        "{history}"
    );
    assert_eq!(
        read.to_string().contains("authorized-stdio-search"),
        successful,
        "{read}"
    );
    assert_eq!(cloud.count("/web/searches"), usize::from(successful));
    assert_eq!(cloud.count("/auth/token"), token_count);
    assert_eq!(cloud.count("/product-users"), usize::from(successful));
    for value in [read, model.last_request().body] {
        for resource in ["default", "web"] {
            assert!(!value.to_string().contains(&format!("access-{resource}")));
            assert!(!value.to_string().contains(&format!("refresh-{resource}")));
        }
    }
    peer.shutdown().await;
}
