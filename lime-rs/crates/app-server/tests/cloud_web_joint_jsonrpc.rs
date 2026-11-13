//! Opt-in actual Cloud + Core + native process. Model and browser navigation are
//! fixtures; the live-page scenario uses the production public HTTPS provider.
#[path = "cloud_web_joint_jsonrpc/billing.rs"]
mod billing;
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc, sync::Mutex, time::Duration};
use support::json_lines_transport::TransportClient;

#[tokio::test]
#[ignore = "requires isolated actual Cloud/Core HTTP and separate MySQL databases"]
async fn real_public_client_cloud_core_original_web_turn() {
    public_client_web_turn(false).await;
}

#[tokio::test]
#[ignore = "requires explicit public HTTPS opt-in, actual Cloud/Core and isolated MySQL"]
async fn real_public_client_cloud_core_live_page_and_cold_recovery() {
    assert_eq!(
        std::env::var("LIME_NATIVE_JOINT_REAL_WEB").as_deref(),
        Ok("1")
    );
    public_client_web_turn(true).await;
}

async fn public_client_web_turn(real_page: bool) {
    let core = std::env::var("LIME_NATIVE_JOINT_CORE_URL").expect("joint Core origin");
    let browser = std::env::var("LIME_NATIVE_JOINT_BROWSER").unwrap();
    let binary = std::env::var("LIME_NATIVE_JOINT_APP_SERVER").unwrap();
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    let root = tempfile::tempdir().unwrap();
    let operation = Arc::new(Mutex::new(None::<String>));
    let model_operation = Arc::clone(&operation);
    let mut step = 0;
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), move |_| {
        step += 1;
        (step % 2 == 1).then(|| {
            if real_page {
                let mut input = json!({
                    "url":"https://a13n.dev/docs/a13n-service/use-platform/",
                    "prompt":"Read this public documentation page.",
                    "max_chars":12000
                });
                if let Some(key) = model_operation.lock().unwrap().as_ref() {
                    input["operation_key"] = json!(key);
                }
                return (
                    format!("original-native-joint-page-{step}"),
                    "WebFetch".into(),
                    input,
                );
            }
            (
                "original-native-joint-search".into(),
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
            "native-joint-model",
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
        TransportClient::start_stdio(Path::new(&binary), root.path(), "native-public-joint").await;
    peer.set_read_timeout(Duration::from_secs(60));
    let started = peer
        .request_ok(
            2,
            "thread/start",
            json!({
                "cwd":root.path(), "modelProvider":"native-joint-model", "model":Wire::Chat.model(),
                "config":{"web_search":"live", "approval_policy":"never"}
            }),
        )
        .await;
    let thread = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_started = std::time::Instant::now();
    let started = peer
        .request_ok(
            3,
            "turn/start",
            json!({
                "threadId":thread, "input":[{"type":"text","text":if real_page {
                    "Read https://a13n.dev/docs/a13n-service/use-platform/"
                } else {"Search for the current Rust release."}}]
            }),
        )
        .await;
    let turn = started["result"]["turn"]["id"].as_str().unwrap().to_owned();
    authorize_web_task(&mut peer, &http, &browser, &thread).await;
    tokio::time::timeout(
        Duration::from_secs(60),
        peer.wait_for_turn_completed(&thread, &turn),
    )
    .await
    .unwrap();
    let read = peer
        .request_ok(
            4,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    let turns = read["result"]["thread"]["turns"].as_array().unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0]["id"], turn);
    assert_eq!(model.request_count(), 2);
    let first_turn_ms = first_started.elapsed().as_millis();
    let history = model.last_request().history().to_string();
    if real_page {
        assert!(history.contains("original-native-joint-page-1"));
        let first = latest_operation(&model.last_request().history()).expect("page tool result");
        assert_eq!(first["status"], "completed");
        assert_eq!(first["kind"], "page");
        let page = &first["page"];
        assert_eq!(
            page["url"],
            "https://a13n.dev/docs/a13n-service/use-platform/"
        );
        assert!(page["finalUrl"]
            .as_str()
            .unwrap()
            .starts_with("https://a13n.dev/"));
        assert!(page["title"].as_str().is_some_and(|s| !s.is_empty()));
        let text = page["text"].as_str().unwrap();
        assert!((500..=12000).contains(&text.chars().count()));
        assert!(
            text.contains("agent"),
            "live documentation must reach the model"
        );
        let output = serde_json::to_string(&first).unwrap();
        let prefix = output.chars().take(500).collect::<String>();
        // Large tool outputs retain an inline preview and a durable full result.
        // A title after the page text need not fit in that preview.
        assert!(contains_output_prefix(&read, &prefix));
        assert!(read
            .to_string()
            .contains(&first["id"].as_str().unwrap().to_owned()));
        let key = first["operationKey"].as_str().unwrap().to_owned();
        *operation.lock().unwrap() = Some(key.clone());
        peer.shutdown().await;

        // The explicit original key survives process restart and a new tool ID.
        let recovery_started = std::time::Instant::now();
        peer = TransportClient::start_stdio(Path::new(&binary), root.path(), "native-public-cold")
            .await;
        peer.set_read_timeout(Duration::from_secs(60));
        peer.request_ok(7, "thread/resume", json!({"threadId":thread}))
            .await;
        let start = peer.request_ok(8, "turn/start", json!({"threadId":thread,"input":[{"type":"text","text":"Recover the original page result without fetching it again."}]})).await;
        let next = start["result"]["turn"]["id"].as_str().unwrap().to_owned();
        assert_ne!(next, turn);
        tokio::time::timeout(
            Duration::from_secs(60),
            peer.wait_for_turn_completed(&thread, &next),
        )
        .await
        .unwrap();
        assert_eq!(model.request_count(), 4);
        let recovery_ms = recovery_started.elapsed().as_millis();
        let restored = latest_operation(&model.last_request().history()).unwrap();
        assert_eq!(
            restored, first,
            "cold recovery must preserve the original page and metadata"
        );
        let mut persisted_results = Vec::new();
        collect_operations(&model.last_request().history(), &mut persisted_results);
        assert_eq!(persisted_results.len(), 2);
        assert!(persisted_results.iter().all(|result| result == &first));
        let cold = peer
            .request_ok(
                9,
                "thread/read",
                json!({"threadId":thread,"includeTurns":true}),
            )
            .await;
        let turns = cold["result"]["thread"]["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0]["id"], turn);
        assert_eq!(turns[1]["id"], next);
        assert!(cold.to_string().contains("original-native-joint-page-1"));
        assert!(cold.to_string().contains("original-native-joint-page-3"));
        assert!(contains_output_prefix(&cold, &prefix));
        if let Ok(evidence) = std::env::var("LIME_NATIVE_JOINT_EVIDENCE") {
            let summary = json!({
                "threadId":thread, "firstTurnId":turn, "recoveryTurnId":next,
                "operationId":first["id"], "operationKey":key, "modelRequests":model.request_count(),
                "firstTurnMs":first_turn_ms, "recoveryIncludingProcessStartMs":recovery_ms,
                "toolOutputCharacters":output.chars().count(), "canonicalPreviewMatched":true,
                "persistedFullResults":persisted_results.len(),
                "pageCharacters":text.chars().count(), "pageSha256":format!("{:x}", Sha256::digest(text.as_bytes())),
                "title":page["title"], "retrievedAt":page["retrievedAt"], "coldResultEqual":restored == first
            });
            std::fs::write(
                Path::new(&evidence).join("native-page.json"),
                serde_json::to_vec_pretty(&summary).unwrap(),
            )
            .unwrap();
        }
    } else {
        assert!(
            history.contains("original-native-joint-search"),
            "original tool identity must survive"
        );
        assert!(
            history.contains("native-cloud-core-result"),
            "actual Cloud result must reach model history"
        );
        assert!(
            read.to_string().contains("native-cloud-core-result"),
            "canonical read must retain Cloud result"
        );
    }
    let account = peer.request_ok(5, "account/read", json!({})).await;
    assert!(account["result"]["account"]["userId"]
        .as_str()
        .is_some_and(|id| !id.is_empty()));
    assert_eq!(
        account["result"]["account"]["resources"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for resource in account["result"]["account"]["resources"]
        .as_array()
        .unwrap()
    {
        assert_eq!(resource["status"], "connected");
        assert!(matches!(
            resource["resource"].as_str(),
            Some("default" | "web")
        ));
    }
    for projection in [
        read.to_string(),
        account.to_string(),
        history,
        model.last_request().history().to_string(),
    ] {
        for forbidden in [
            "access_token",
            "refresh_token",
            "code_verifier",
            "client_secret",
        ] {
            assert!(
                !projection.contains(forbidden),
                "native projections must not expose {forbidden}"
            );
        }
    }
    peer.shutdown().await;
}

fn latest_operation(value: &Value) -> Option<Value> {
    match value {
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(|value| value.get("operationKey").is_some()),
        Value::Array(values) => values.iter().rev().find_map(latest_operation),
        Value::Object(values) => values.values().rev().find_map(latest_operation),
        _ => None,
    }
}

fn contains_output_prefix(value: &Value, prefix: &str) -> bool {
    match value {
        Value::String(text) => text.starts_with(prefix),
        Value::Array(values) => values
            .iter()
            .any(|value| contains_output_prefix(value, prefix)),
        Value::Object(values) => values
            .values()
            .any(|value| contains_output_prefix(value, prefix)),
        _ => false,
    }
}

fn collect_operations(value: &Value, results: &mut Vec<Value>) {
    match value {
        Value::String(text) => {
            if let Ok(value) = serde_json::from_str::<Value>(text) {
                if value.get("operationKey").is_some() {
                    results.push(value);
                }
            }
        }
        Value::Array(values) => values
            .iter()
            .for_each(|value| collect_operations(value, results)),
        Value::Object(values) => values
            .values()
            .for_each(|value| collect_operations(value, results)),
        _ => {}
    }
}

async fn authorize_web_task(
    peer: &mut TransportClient,
    http: &reqwest::Client,
    browser: &str,
    thread: &str,
) {
    for resource in ["default", "web"] {
        let handoff = peer.wait_for_server_request("account/authorize").await;
        assert_eq!(handoff["params"]["threadId"], thread);
        assert_eq!(handoff["params"]["authorization"]["resource"], resource);
        assert_eq!(handoff["params"]["authorization"]["status"], "pending");
        peer.respond(&handoff, json!({"action":"opened"})).await;
        // The harness follows the real Core and authenticated Cloud redirects.
        // It cannot submit a code, credential, identity or result to the native owner.
        let response = http
            .post(format!("{browser}/authorize"))
            .json(&json!({"url":handoff["params"]["authUrl"]}))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            204,
            "actual {resource} authorization chain failed"
        );
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let read = peer
                    .request_ok(
                        6,
                        "account/read",
                        json!({
                            "authorizationId":handoff["params"]["authorization"]["id"]
                        }),
                    )
                    .await;
                let authorization = read["result"]["authorizations"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|value| value["id"] == handoff["params"]["authorization"]["id"])
                    .unwrap();
                match authorization["status"].as_str() {
                    Some("completed") => break,
                    Some("pending" | "exchanging") => {
                        tokio::time::sleep(Duration::from_millis(5)).await
                    }
                    status => panic!("{resource} native verification ended with {status:?}"),
                }
            }
        })
        .await
        .expect("native verification must finish on the original authorization");
    }
}
