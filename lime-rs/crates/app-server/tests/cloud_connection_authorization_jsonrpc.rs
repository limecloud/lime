//! External file approval resumes the original tool through a real stdio App Server.
#[path = "account_jsonrpc/issuer.rs"]
mod issuer;
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use futures::FutureExt;
use issuer::Fixture;
use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use support::json_lines_transport::TransportClient;

#[tokio::test]
async fn anonymous_stdio_task_continues_after_login_resource_and_file_approval() {
    connection_authorization("approved").await;
}

#[tokio::test]
async fn cancelled_file_request_does_not_read() {
    connection_authorization("cancelled").await;
}

#[tokio::test]
async fn unavailable_file_request_does_not_read() {
    connection_authorization("unavailable").await;
}

#[tokio::test]
async fn denied_file_request_does_not_read() {
    connection_authorization("denied").await;
}

async fn connection_authorization(action: &str) {
    let root = tempfile::tempdir().unwrap();
    let result = std::panic::AssertUnwindSafe(connection_authorization_at(action, root.path()))
        .catch_unwind()
        .await;
    if let Err(error) = result {
        eprintln!(
            "{action}: retained failed stdio fixture at {}",
            root.keep().display()
        );
        std::panic::resume_unwind(error);
    }
}

async fn connection_authorization_at(action: &str, root: &Path) {
    let cloud = Fixture::start().await;
    let now = chrono::Utc::now();
    cloud.respond("/api/v1/client/connections/icn_original/file-reads", 200, json!({
        "id":"ifr_original","action":"drive.files.read","contractRevision":"google-docs.read.v1",
        "connectionId":"icn_original","grantId":"icg_original","fileId":"doc_original","status":"completed",
        "usage":{"requests":1,"responseBytes":32,"billingStatus":"unpriced"},
        "createdAt":now.to_rfc3339(),"finishedAt":now.to_rfc3339(),
        "resultExpiresAt":(now+chrono::Duration::hours(1)).to_rfc3339(),
        "result":{"file":{"id":"doc_original","name":"Approved document",
            "mediaType":"application/vnd.google-apps.document","version":"1",
            "modifiedAt":now.to_rfc3339(),"canDownload":true},
            "text":"approved-stdio-document","url":"https://docs.google.com/document/d/doc_original/edit",
            "retrievedAt":now.to_rfc3339(),"truncated":false}
    }));
    let mut step = 0;
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), move |_| {
        step += 1;
        (step == 1).then(|| {
            (
                "original-file-call".into(),
                "ReadConnectedFile".into(),
                json!({"url":"https://docs.google.com/document/d/doc_original/edit"}),
            )
        })
    })
    .await;
    let roots = app_server::StorageRoots::initialize(root.join("app"), root.join("agent")).unwrap();
    let db = lime_core::database::init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            "cloud-connection-stdio",
            Wire::Chat.model(),
            Wire::Chat.provider_type(),
            &model.url,
            Wire::Chat.credential(),
        )],
        false,
    );
    drop(db);
    std::fs::write(
        root.join("config.yaml"),
        json!({"cloud":{"base_url":cloud.base}}).to_string(),
    )
    .unwrap();
    let binary = std::env::var_os("APP_SERVER_BIN")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_BIN_EXE_app-server")).to_path_buf());
    let mut peer =
        TransportClient::start_stdio(&binary, root, "cloud-connection-authorization").await;
    let start = peer.request_ok(2, "thread/start", json!({"cwd":root,
        "modelProvider":"cloud-connection-stdio","model":Wire::Chat.model(),"config":{"approval_policy":"never"}})).await;
    let thread = start["result"]["thread"]["id"].as_str().unwrap().to_owned();
    let start = peer.request_ok(3, "turn/start", json!({"threadId":thread,
        "input":[{"type":"text","text":"Read https://docs.google.com/document/d/doc_original/edit"}]})).await;
    let turn = start["result"]["turn"]["id"].as_str().unwrap().to_owned();
    for (count, resource) in ["default", "connections"].into_iter().enumerate() {
        eprintln!("{action}: waiting for {resource} authorization");
        let handoff = peer.wait_for_server_request("account/authorize").await;
        assert_eq!(handoff["params"]["threadId"], thread);
        assert_eq!(handoff["params"]["authorization"]["resource"], resource);
        assert_eq!(cloud.count("/auth/token"), count);
        assert_eq!(cloud.count("/connection-requests"), 0);
        assert_eq!(cloud.count("/product-users"), 0);
        peer.respond(&handoff, json!({"action":"opened"})).await;
        cloud
            .callback(handoff["params"]["authUrl"].as_str().unwrap())
            .await;
    }
    let handoff = peer.wait_for_server_request("connection/authorize").await;
    assert_eq!(handoff["params"]["threadId"], thread);
    assert_eq!(handoff["params"]["requestId"], "irq_original");
    assert_eq!(cloud.count("/connection-requests"), 1);
    assert_eq!(cloud.count("/file-reads"), 0);
    peer.respond(
        &handoff,
        json!({"action":if matches!(action,"approved"|"denied") {"opened"} else {action}}),
    )
    .await;
    if matches!(action, "approved" | "denied") {
        // Wait for an actual pending review read after the host opened the browser.
        tokio::time::timeout(Duration::from_secs(10), async {
            while cloud.count("/connection-requests/irq_original") == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("original request is polled after browser opening");
        assert_eq!(cloud.count("/file-reads"), 0);
        let path = "/api/v1/client/connection-requests/irq_original";
        let mut decision: Value = {
            let state = cloud.state.lock().unwrap();
            serde_json::from_slice(&state.responses[path].1).unwrap()
        };
        decision.as_object_mut().unwrap().remove("approvalUrl");
        decision["revision"] = json!(2);
        decision["decidedAt"] = json!(chrono::Utc::now().to_rfc3339());
        decision["status"] = json!(action);
        if action == "approved" {
            decision["grantId"] = json!("icg_original");
            decision["grantRevision"] = json!(1);
            decision["connectionId"] = json!("icn_original");
            decision["approvedExpiresAt"] = decision["requestedExpiresAt"].clone();
        }
        cloud.respond(path, 200, decision);
    }
    peer.wait_for_turn_completed(&thread, &turn).await;
    let read = peer
        .request_ok(
            4,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    let turns = read["result"]["thread"]["turns"].as_array().unwrap();
    assert_eq!(
        turns.len(),
        1,
        "{action}: approval must preserve the original turn"
    );
    assert_eq!(turns[0]["id"], turn);
    assert_eq!(model.request_count(), 2);
    let history = model.last_request().history().to_string();
    assert!(
        history.contains("original-file-call"),
        "{action}: {history}"
    );
    let successful = action == "approved";
    assert_eq!(
        history.contains("approved-stdio-document"),
        successful,
        "{action}: {history}"
    );
    assert_eq!(
        read.to_string().contains("approved-stdio-document"),
        successful,
        "{action}: {read}"
    );
    assert_eq!(cloud.count("/connection-requests"), 1);
    assert_eq!(cloud.count("/file-reads"), usize::from(successful));
    assert_eq!(cloud.count("/product-users"), 1);
    assert_eq!(cloud.count("/auth/token"), 2);
    for value in [read, model.last_request().body] {
        for resource in ["default", "connections"] {
            assert!(!value.to_string().contains(&format!("access-{resource}")));
            assert!(!value.to_string().contains(&format!("refresh-{resource}")));
        }
    }
    peer.shutdown().await;
}
