use super::*;
use chrono::{Duration as ChronoDuration, Utc};
use std::time::Duration;
use tool_runtime::tool_executor::RuntimeToolExecutionResult;

#[path = "recovery_tests.rs"]
mod recovery;

#[path = "terminal_tests.rs"]
mod terminal;

#[path = "deadline_tests.rs"]
mod deadline;

#[path = "billing_tests.rs"]
mod billing;

fn approval(status: &str) -> Value {
    let now = Utc::now();
    let mut value = json!({"id":"irq_original","consentVersion":"connection-selected-files.v1","connector":"google-drive","actions":["drive.files.read"],"fileIds":["doc_original"],"requestedExpiresAt":(now+ChronoDuration::minutes(30)).to_rfc3339(),"status":status,"revision":1,"createdAt":(now-ChronoDuration::seconds(1)).to_rfc3339(),"expiresAt":(now+ChronoDuration::minutes(5)).to_rfc3339()});
    if status == "pending" {
        value["approvalUrl"] =
            json!("https://console.test/connections/requests/irq_original?environment=sandbox");
    }
    if status == "approved" {
        approve(&mut value);
    }
    value
}

fn approve(value: &mut Value) {
    value.as_object_mut().unwrap().remove("approvalUrl");
    value["status"] = json!("approved");
    value["revision"] = json!(2);
    value["grantId"] = json!("icg_original");
    value["grantRevision"] = json!(1);
    value["connectionId"] = json!("icn_original");
    value["approvedExpiresAt"] = value["requestedExpiresAt"].clone();
    value["decidedAt"] = json!(Utc::now().to_rfc3339());
}

fn document() -> Value {
    let now = Utc::now();
    json!({"id":"ifr_original","action":"drive.files.read","contractRevision":"google-docs.read.v1","connectionId":"icn_original","grantId":"icg_original","fileId":"doc_original","status":"completed","usage":{"requests":1,"responseBytes":32,"billingStatus":"unpriced"},"createdAt":(now-ChronoDuration::seconds(1)).to_rfc3339(),"finishedAt":now.to_rfc3339(),"resultExpiresAt":(now+ChronoDuration::hours(1)).to_rfc3339(),"result":{"file":{"id":"doc_original","name":"Approved document","mediaType":"application/vnd.google-apps.document","version":"1","modifiedAt":now.to_rfc3339(),"canDownload":true},"text":"approved-connection-content","url":"https://docs.google.com/document/d/doc_original/edit","retrievedAt":now.to_rfc3339(),"truncated":false}})
}

async fn login(f: &Fixture, manager: &AccountManager, status: &str) {
    f.login(manager, CloudResource::Default).await;
    f.login(manager, CloudResource::Connections).await;
    let mut state = f.state.lock().unwrap();
    state.connection_request = Some(approval(status));
    state.connection_file = Some(document());
}

async fn read(
    manager: &AccountManager,
    params: &Value,
    context: &RuntimeToolExecutionContext,
    turn: Option<&TurnContextOverride>,
) -> Result<RuntimeToolExecutionResult, tool_runtime::tool_executor::RuntimeToolExecutionError> {
    manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "ReadConnectedFile",
            params,
            context,
            turn_context: turn,
        })
        .await
}

#[tokio::test]
async fn connected_file_read_and_cold_recovery_preserve_both_commands() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    login(&f, &manager, "approved").await;
    {
        let mut state = f.state.lock().unwrap();
        let body = state.connection_file.as_mut().unwrap();
        body["accessToken"] = json!("private-provider-token");
        body["usage"]["credential"] = json!("private-provider-token");
        body["result"]["credential"] = json!("private-provider-token");
        body["result"]["file"]["credential"] = json!("private-provider-token");
    }
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let context = context();
    let first = read(&manager, &params, &context, None).await.unwrap();
    assert!(first.success);
    assert!(first.output.contains("approved-connection-content"));
    let body: Value = serde_json::from_str(&first.output).unwrap();
    assert_ne!(body["operationKey"], body["readOperationKey"]);
    let restarted = AccountManager::new(root.path(), &config);
    let again = read(&restarted, &params, &context, None).await.unwrap();
    assert!(again.success);
    assert_eq!(
        serde_json::from_str::<Value>(&again.output).unwrap()["operationKey"],
        body["operationKey"]
    );
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
    assert_eq!(f.count("/product-users"), 1);
    assert!(!first.output.contains("access-connections"));
    assert!(!first.output.contains("private-provider-token"));
}

#[tokio::test]
async fn unknown_request_recovers_by_original_key_before_the_first_file_read() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    login(&f, &manager, "approved").await;
    f.state.lock().unwrap().connection_request_unknown = true;
    let params =
        json!({"url":"https://docs.google.com/document/d/doc_original/edit?usp=sharing#heading=h"});
    let first = context();
    assert!(!read(&manager, &params, &first, None).await.unwrap().success);
    assert_eq!(f.count("/file-reads"), 0);
    let second =
        context().with_tool_identity(RuntimeToolExecutionIdentity::new("new-call", "new-turn"));
    let equivalent =
        json!({"url":"https://docs.google.com/document/d/doc_original","max_characters":20000});
    let recovered = read(&manager, &equivalent, &second, None).await.unwrap();
    assert!(recovered.success);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn unknown_read_and_missing_recovery_never_dispatch_a_second_read() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    login(&f, &manager, "approved").await;
    {
        let mut state = f.state.lock().unwrap();
        state.connection_read_unknown = true;
        state.connection_read_missing = true;
    }
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let first = read(&manager, &params, &context(), None).await.unwrap();
    assert!(!first.success);
    let output: Value = serde_json::from_str(&first.output).unwrap();
    assert_eq!(output["status"], "outcome_unknown");
    let restarted = AccountManager::new(root.path(), &config);
    let second =
        context().with_tool_identity(RuntimeToolExecutionIdentity::new("new-call", "new-turn"));
    assert!(
        !read(&restarted, &params, &second, None)
            .await
            .unwrap()
            .success
    );
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn missing_original_request_never_creates_a_replacement() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    login(&f, &manager, "approved").await;
    f.state.lock().unwrap().connection_request_unknown = true;
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let first = read(&manager, &params, &context(), None).await.unwrap();
    let first: Value = serde_json::from_str(&first.output).unwrap();
    f.state.lock().unwrap().connection_request = None;
    let restarted = AccountManager::new(root.path(), &config);
    let next = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
        "recovery-call",
        "recovery-turn",
    ));
    let result = read(&restarted, &params, &next, None).await.unwrap();
    let result: Value = serde_json::from_str(&result.output).unwrap();
    assert_eq!(result["status"], "outcome_unknown");
    assert_eq!(result["operationKey"], first["operationKey"]);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 0);
}

#[tokio::test]
async fn browser_open_waits_for_the_original_file_approval() {
    use app_server_transport::ConnectionId;
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    login(&f, &manager, "pending").await;
    let server = crate::AppServer::new();
    let (mut outbound, _) = super::authorization::attach(&manager, &server).await;
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let context = context();
    let turn = super::authorization::live_thread();
    let future = read(&manager, &params, &context, Some(&turn));
    tokio::pin!(future);
    let envelope = tokio::select! {result=&mut future=>panic!("unexpected result {result:?}"),message=outbound.recv()=>message.unwrap()};
    let crate::JsonRpcMessage::Request(message) = envelope.message.into_json_rpc_message() else {
        panic!("expected host request")
    };
    assert_eq!(message.method, "connection/authorize");
    assert_eq!(
        message.params.as_ref().unwrap()["requestId"],
        "irq_original"
    );
    server
        .resolve_transport_server_request_response(
            ConnectionId(81),
            message.id,
            json!({"action":"opened"}),
        )
        .await;
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut future)
            .await
            .is_err()
    );
    assert_eq!(f.count("/file-reads"), 0);
    approve(f.state.lock().unwrap().connection_request.as_mut().unwrap());
    assert!(
        tokio::time::timeout(Duration::from_secs(3), future)
            .await
            .unwrap()
            .unwrap()
            .success
    );
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn cancel_denial_and_logout_do_not_read_the_file() {
    use app_server_transport::ConnectionId;
    for action in ["cancelled", "unavailable", "denied", "logout"] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        login(&f, &manager, "pending").await;
        let server = crate::AppServer::new();
        let (mut outbound, _) = super::authorization::attach(&manager, &server).await;
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        let context = context();
        let turn = super::authorization::live_thread();
        let future = read(&manager, &params, &context, Some(&turn));
        tokio::pin!(future);
        let message = tokio::select! {result=&mut future=>panic!("unexpected result {result:?}"),message=outbound.recv()=>message.unwrap()};
        let crate::JsonRpcMessage::Request(message) = message.message.into_json_rpc_message()
        else {
            panic!("host request")
        };
        if action == "logout" {
            manager.logout().unwrap();
        }
        if action == "denied" {
            let mut state = f.state.lock().unwrap();
            let value = state.connection_request.as_mut().unwrap();
            value["status"] = json!("denied");
            value["revision"] = json!(2);
            value["decidedAt"] = json!(Utc::now().to_rfc3339());
            value.as_object_mut().unwrap().remove("approvalUrl");
        }
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                message.id,
                json!({"action":if action=="denied"||action=="logout"{"opened"}else{action}}),
            )
            .await;
        let result = tokio::time::timeout(Duration::from_secs(3), future)
            .await
            .unwrap();
        if matches!(action, "cancelled" | "logout") {
            assert!(result.is_err(), "{action}");
        } else {
            let result = result.unwrap();
            assert!(!result.success, "{action}");
            let output: Value = serde_json::from_str(&result.output).unwrap();
            assert_eq!(
                output["status"],
                if action == "denied" {
                    "failed"
                } else {
                    "outcome_unknown"
                }
            );
        }
        assert_eq!(f.count("/file-reads"), 0, "{action}");
    }
}

#[tokio::test]
async fn concurrent_unknown_calls_share_the_original_request_and_read() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let first = AccountManager::new(root.path(), &config);
    let second = AccountManager::new(root.path(), &config);
    login(&f, &first, "approved").await;
    let epoch = crate::account::store::load(&first.path).unwrap().epoch;
    first.ensure_product_user("en-US", &epoch).await.unwrap();
    f.state.lock().unwrap().connection_read_unknown = true;
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let a = context();
    let b = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
        "parallel-call",
        "parallel-turn",
    ));
    let (a, b) = tokio::join!(
        read(&first, &params, &a, None),
        read(&second, &params, &b, None)
    );
    let a: Value = serde_json::from_str(&a.unwrap().output).unwrap();
    let b: Value = serde_json::from_str(&b.unwrap().output).unwrap();
    assert_eq!(a["operationKey"], b["operationKey"]);
    assert_eq!(a["readOperationKey"], b["readOperationKey"]);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 1);
}

#[tokio::test]
async fn damaged_private_input_and_changed_arguments_cannot_create_a_new_command() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    login(&f, &manager, "approved").await;
    f.state.lock().unwrap().connection_request_unknown = true;
    let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
    let first = read(&manager, &params, &context(), None).await.unwrap();
    let output: Value = serde_json::from_str(&first.output).unwrap();
    let key = output["operationKey"].as_str().unwrap();
    let changed =
        json!({"url":"https://docs.google.com/document/d/doc_original/edit","max_characters":100});
    assert_eq!(
        read(&manager, &changed, &context(), None)
            .await
            .unwrap_err()
            .message(),
        "operation_key_conflict"
    );
    let private = root
        .path()
        .join("credentials/tool-calls/connections")
        .join(format!("{key}.json"));
    std::fs::write(&private, b"{damaged").unwrap();
    let restarted = AccountManager::new(root.path(), &config);
    let next = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
        "recovery-call",
        "recovery-turn",
    ));
    let recovered = read(&restarted, &params, &next, None).await.unwrap();
    assert!(!recovered.success);
    assert_eq!(f.count("/connection-requests"), 1);
    assert_eq!(f.count("/file-reads"), 0);
}

#[tokio::test]
async fn invalid_approval_and_wrong_file_result_stay_bound_to_the_original_key() {
    for invalid in [
        "approval-file",
        "approval-url",
        "file-grant",
        "file-id",
        "file-source",
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.yaml");
        let manager = AccountManager::new(root.path(), &config);
        login(
            &f,
            &manager,
            if invalid == "approval-url" {
                "pending"
            } else {
                "approved"
            },
        )
        .await;
        {
            let mut state = f.state.lock().unwrap();
            match invalid {
                "approval-file" => {
                    state.connection_request.as_mut().unwrap()["fileIds"] = json!(["wrong-file"])
                }
                "approval-url" => {
                    state.connection_request.as_mut().unwrap()["approvalUrl"] =
                        json!("https://console.test/connections/requests/other?environment=sandbox")
                }
                "file-grant" => {
                    state.connection_file.as_mut().unwrap()["grantId"] = json!("wrong-grant")
                }
                "file-id" => {
                    state.connection_file.as_mut().unwrap()["fileId"] = json!("wrong-file")
                }
                "file-source" => {
                    state.connection_file.as_mut().unwrap()["result"]["url"] =
                        json!("https://else.test/document")
                }
                _ => unreachable!(),
            }
        }
        let params = json!({"url":"https://docs.google.com/document/d/doc_original/edit"});
        let first = read(&manager, &params, &context(), None).await.unwrap();
        assert!(!first.success, "{invalid}");
        let output: Value = serde_json::from_str(&first.output).unwrap();
        if invalid.starts_with("file-") {
            assert!(output["readOperationKey"].as_str().is_some());
            assert!(output["recoveryPath"]
                .as_str()
                .unwrap()
                .starts_with("/connection-file-operations/operations/"));
        }
        let restarted = AccountManager::new(root.path(), &config);
        let next = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
            "recovery-call",
            "recovery-turn",
        ));
        assert!(
            !read(&restarted, &params, &next, None)
                .await
                .unwrap()
                .success,
            "{invalid}"
        );
        assert_eq!(f.count("/connection-requests"), 1, "{invalid}");
        assert_eq!(
            f.count("/file-reads"),
            usize::from(invalid.starts_with("file-")),
            "{invalid}"
        );
    }
}
