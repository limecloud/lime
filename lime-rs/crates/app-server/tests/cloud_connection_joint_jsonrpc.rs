//! Opt-in actual Cloud/Core/Console/native document journey. Google, model and
//! browser navigation are fixtures; authorization and document operations are real.
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use base64::Engine;
use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, sync::Mutex, time::Duration};
use support::json_lines_transport::TransportClient;

#[tokio::test]
#[ignore = "requires isolated actual Cloud/Core/Console and separate MySQL databases"]
async fn real_public_client_connected_document_original_turn_and_revocation() {
    let core = std::env::var("LIME_NATIVE_JOINT_CORE_URL").unwrap();
    let browser = std::env::var("LIME_NATIVE_JOINT_BROWSER").unwrap();
    let binary = std::env::var("LIME_NATIVE_JOINT_APP_SERVER").unwrap();
    let billed = std::env::var("LIME_NATIVE_CONNECTION_BILLING").as_deref() == Ok("priced");
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    let root = tempfile::tempdir().unwrap();
    let operation = Arc::new(Mutex::new(None::<String>));
    let model_operation = Arc::clone(&operation);
    let mut step = 0;
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), move |capture| {
        step += 1;
        let mut input = json!({"url":"https://docs.google.com/document/d/file_first/edit"});
        if billed {
            match step {
                1 => {}
                2 => {
                    let quote = latest_operation(&capture.history()).unwrap();
                    assert_eq!(quote["errorCode"], "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED");
                    assert_eq!(quote["executionStarted"], false);
                    assert_eq!(quote["quote"]["action"], "drive.files.read");
                    input["price_version"] = json!("files.v1");
                    input["max_credits"] = json!("6");
                }
                3 => {
                    assert_eq!(
                        latest_operation(&capture.history()).unwrap()["errorCode"],
                        "INTEGRATION_BUDGET_EXCEEDED"
                    );
                    input["price_version"] = json!("files.v1");
                    input["max_credits"] = json!("7");
                }
                5 | 7 | 9 => {
                    input["price_version"] = json!("files.v1");
                    input["max_credits"] = json!("7");
                }
                4 | 6 | 8 | 10 => return None,
                _ => panic!("unexpected file billing model request"),
            }
        } else if step % 2 == 0 {
            return None;
        }
        if !billed || step != 7 {
            if let Some(key) = model_operation.lock().unwrap().as_ref() {
                input["operation_key"] = json!(key);
            }
        }
        Some((
            format!("original-document-{step}"),
            "ReadConnectedFile".into(),
            input,
        ))
    })
    .await;
    let roots =
        app_server::StorageRoots::initialize(root.path().join("app"), root.path().join("agent"))
            .unwrap();
    let db = lime_core::database::init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            "native-connection-model",
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
        TransportClient::start_stdio(Path::new(&binary), root.path(), "native-connection-joint")
            .await;
    let started = peer.request_ok(2, "thread/start", json!({"cwd":root.path(), "modelProvider":"native-connection-model", "model":Wire::Chat.model(), "config":{"approval_policy":"never"}})).await;
    let thread = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let prompt = if billed {
        "Read https://docs.google.com/document/d/file_first/edit. Check the quote first. I accept files.v1 at 7 credits and authorize a maximum of 7 credits for this read."
    } else {
        "Read https://docs.google.com/document/d/file_first/edit"
    };
    let started = peer
        .request_ok(
            3,
            "turn/start",
            json!({"threadId":thread,"input":[{"type":"text","text":prompt}]}),
        )
        .await;
    let first_turn = started["result"]["turn"]["id"].as_str().unwrap().to_owned();
    for resource in ["default", "connections"] {
        let handoff = peer.wait_for_server_request("account/authorize").await;
        assert_eq!(handoff["params"]["threadId"], thread);
        assert_eq!(handoff["params"]["authorization"]["resource"], resource);
        peer.respond(&handoff, json!({"action":"opened"})).await;
        let response = http
            .post(format!("{browser}/authorize"))
            .json(&json!({"url":handoff["params"]["authUrl"]}))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            204,
            "actual {resource} authorization failed"
        );
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let state = peer.request_ok(20, "account/read", json!({})).await;
            let authorization = state["result"]["authorizations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|value| value["id"] == handoff["params"]["authorization"]["id"])
                .unwrap();
            if authorization["status"] == "completed" {
                break;
            }
            if !matches!(
                authorization["status"].as_str(),
                Some("pending" | "exchanging")
            ) {
                panic!(
                    "actual {resource} authorization did not complete: status={}, checks={}",
                    authorization["status"],
                    claim_checks(root.path(), resource)
                );
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "actual {resource} callback did not complete"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    let handoff = peer.wait_for_server_request("connection/authorize").await;
    assert_eq!(handoff["params"]["threadId"], thread);
    let request_id = handoff["params"]["requestId"].as_str().unwrap().to_owned();
    peer.respond(&handoff, json!({"action":"opened"})).await;
    let response = http
        .post(format!("{browser}/connection-approve"))
        .json(&json!({"url":handoff["params"]["approvalUrl"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status().as_u16(),
        204,
        "actual Console selection and approval failed"
    );
    peer.wait_for_turn_completed(&thread, &first_turn).await;
    assert_eq!(model.request_count(), if billed { 4 } else { 2 });
    let first = latest_operation(&model.last_request().history())
        .expect("completed connection tool result");
    assert_eq!(first["status"], "completed");
    assert_eq!(first["result"]["text"], "Synthetic selected document");
    if billed {
        assert_eq!(first["usage"]["billing"]["priceVersion"], "files.v1");
        assert_eq!(first["usage"]["billing"]["chargedCredits"], "7");
        let response = http
            .post(format!("{browser}/change-price"))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 204);
    }
    let original_key = first["operationKey"].as_str().unwrap().to_owned();
    *operation.lock().unwrap() = Some(original_key.clone());
    let original_read_key = first["readOperationKey"].as_str().unwrap().to_owned();
    peer.shutdown().await;

    // A new native process and a new tool call must GET the persisted original
    // operation, even though the first call has already completed.
    let mut peer =
        TransportClient::start_stdio(Path::new(&binary), root.path(), "native-connection-cold")
            .await;
    peer.request_ok(4, "thread/resume", json!({"threadId":thread}))
        .await;
    let second = run_turn(
        &mut peer,
        &thread,
        "Recover the original document read without reading it again.",
    )
    .await;
    assert_eq!(model.request_count(), if billed { 6 } else { 4 });
    let restored = latest_operation(&model.last_request().history()).unwrap();
    assert_eq!(restored["id"], first["id"]);
    assert_eq!(restored["operationKey"], original_key);
    assert_eq!(restored["readOperationKey"], original_read_key);
    assert_eq!(restored["result"], first["result"]);
    assert_eq!(restored["usage"], first["usage"]);

    let stale_turn = if billed {
        let turn = run_turn(&mut peer, &thread, "Start a new read using the previously accepted files.v1 price and a budget of 7 credits.").await;
        let stale = latest_operation(&model.last_request().history()).unwrap();
        assert_eq!(stale["errorCode"], "INTEGRATION_PRICE_CHANGED");
        assert_eq!(stale["executionStarted"], false);
        assert_eq!(stale["quote"]["price"]["priceVersion"], "files.v2");
        Some(turn)
    } else {
        None
    };

    let response = http
        .post(format!("{browser}/revoke"))
        .json(&json!({"requestId":request_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status().as_u16(),
        204,
        "actual owner revocation failed"
    );
    let third = run_turn(
        &mut peer,
        &thread,
        "Check the original read after its file authorization was revoked.",
    )
    .await;
    assert_eq!(model.request_count(), if billed { 10 } else { 6 });
    let revoked = latest_operation(&model.last_request().history()).unwrap();
    assert_ne!(revoked["status"], "completed");
    assert_eq!(revoked["operationKey"], original_key);
    assert!(!revoked.to_string().contains("Synthetic selected document"));
    let read = peer
        .request_ok(
            8,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    let turns = read["result"]["thread"]["turns"].as_array().unwrap();
    assert_eq!(turns.len(), if billed { 4 } else { 3 });
    assert_eq!(turns[0]["id"], first_turn);
    assert_eq!(turns[1]["id"], second);
    if let Some(stale) = stale_turn {
        assert_eq!(turns[2]["id"], stale);
        assert_eq!(turns[3]["id"], third);
    } else {
        assert_eq!(turns[2]["id"], third);
    }
    assert!(read.to_string().contains(if billed {
        "original-document-3"
    } else {
        "original-document-1"
    }));
    let account = peer.request_ok(9, "account/read", json!({})).await;
    let resources = account["result"]["account"]["resources"]
        .as_array()
        .unwrap();
    assert_eq!(resources.len(), 2);
    for resource in resources {
        assert_eq!(resource["status"], "connected");
        assert!(matches!(
            resource["resource"].as_str(),
            Some("default" | "connections")
        ));
    }
    for value in [read, account, model.last_request().body] {
        for forbidden in [
            "access_token",
            "refresh_token",
            "code_verifier",
            "client_secret",
            "authorization_expires_at",
            "authorizationExpiresAt",
            "lime_test_approval_expires_at",
            "synthetic-access-token",
            "synthetic-refresh-token",
        ] {
            assert!(
                !value.to_string().contains(forbidden),
                "public projection leaked {forbidden}"
            );
        }
    }
    peer.shutdown().await;
    if billed {
        let result = json!({"coldResultEqual":restored["result"]==first["result"] && restored["usage"]==first["usage"],"chargedCredits":first["usage"]["billing"]["chargedCredits"],"revokedBodyDenied":revoked["status"]!="completed","originalKeyPreserved":revoked["operationKey"]==original_key,"turns":4,"modelRequests":model.request_count(),"realProvider":false,"realPayment":false});
        let evidence = std::env::var("LIME_NATIVE_JOINT_EVIDENCE").unwrap();
        std::fs::write(
            Path::new(&evidence).join("native-billing.json"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
    }
}

// Failure diagnostics expose only contract checks, never the private token,
// nonce, subject or application identifier being compared.
fn claim_checks(root: &Path, resource: &str) -> Value {
    let state: Value =
        serde_json::from_slice(&std::fs::read(root.join("app/credentials/account.json")).unwrap())
            .unwrap();
    let auth = &state["authorizations"][resource];
    let Some(token) = auth["staged"]["tokens"]["id_token"].as_str() else {
        return json!({"stagedToken":false});
    };
    let payload = token.split('.').nth(1).unwrap();
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .unwrap();
    let claims: Value = serde_json::from_slice(&bytes).unwrap();
    json!({
        "sourceMatches":claims["lime_authorization_source"] == "sandbox_test_approval",
        "applicationMatches":claims["lime_application_id"] == auth["config"]["applicationId"],
        "environmentMatches":claims["lime_environment"] == auth["config"]["environment"],
        "integerDeadline":claims["lime_test_approval_expires_at"].as_i64().is_some(),
        "futureDeadline":claims["lime_test_approval_expires_at"].as_i64().is_some_and(|value| value > chrono::Utc::now().timestamp()),
        "nonceMatches":claims["nonce"] == auth["nonce"],
        "subjectMatches":claims["sub"] == state["account"]["userId"],
        "audienceMatches":claims["aud"] == auth["config"]["clientId"],
    })
}

async fn run_turn(peer: &mut TransportClient, thread: &str, text: &str) -> String {
    let started = peer
        .request_ok(
            6,
            "turn/start",
            json!({"threadId":thread,"input":[{"type":"text","text":text}]}),
        )
        .await;
    let turn = started["result"]["turn"]["id"].as_str().unwrap().to_owned();
    tokio::time::timeout(
        Duration::from_secs(30),
        peer.wait_for_turn_completed(thread, &turn),
    )
    .await
    .unwrap();
    turn
}

fn latest_operation(value: &Value) -> Option<Value> {
    match value {
        Value::String(text) => serde_json::from_str::<Value>(text).ok().filter(|value| {
            value.get("operationKey").is_some() || value.get("executionStarted").is_some()
        }),
        Value::Array(values) => values.iter().rev().find_map(latest_operation),
        Value::Object(values) => values.values().rev().find_map(latest_operation),
        _ => None,
    }
}
