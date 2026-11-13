use super::*;
#[path = "login_tests.rs"]
mod login_tests;
use app_server_protocol::JsonRpcMessage;
use app_server_transport::ConnectionId;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tool_runtime::tool_executor::RuntimeToolExecutionResult;

pub(super) async fn attach(
    manager: &AccountManager,
    server: &crate::AppServer,
) -> (
    mpsc::Receiver<crate::QueuedOutgoingMessage>,
    CancellationToken,
) {
    let id = ConnectionId(81);
    let (writer, outbound) = mpsc::channel(4);
    let disconnect = CancellationToken::new();
    server.register_transport_writer(id, writer, Some(disconnect.clone()));
    server.thread_states.connection_initialized(id).await;
    assert!(
        server
            .thread_states
            .subscribe_connection(agent_protocol::ThreadId::new("thread-web"), id,)
            .await
    );
    manager.set_host_requests(crate::host_request::HostRequestRouter::new(
        server.thread_states.clone(),
        server.transport_writers.clone(),
        server.transport_disconnects.clone(),
        server.server_requests.clone(),
    ));
    (outbound, disconnect)
}

pub(super) fn live_thread() -> TurnContextOverride {
    let mut context = live();
    context.metadata.insert(
        "app_server_runtime_backend".into(),
        json!({"threadId":"thread-web"}),
    );
    context
}

async fn search(
    manager: &AccountManager,
) -> Result<RuntimeToolExecutionResult, tool_runtime::tool_executor::RuntimeToolExecutionError> {
    manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &json!({"query":"Rust release"}),
            context: &context(),
            turn_context: Some(&live_thread()),
        })
        .await
}

async fn next(
    outbound: &mut mpsc::Receiver<crate::QueuedOutgoingMessage>,
) -> app_server_protocol::JsonRpcRequest {
    let queued = tokio::time::timeout(Duration::from_secs(5), outbound.recv())
        .await
        .unwrap()
        .unwrap();
    let JsonRpcMessage::Request(request) = queued.message.into_json_rpc_message() else {
        panic!("expected native authorization request");
    };
    assert_eq!(request.method, "account/authorize");
    request
}

async fn callback(f: &Fixture, params: &Value, denied: bool) {
    let url = reqwest::Url::parse(params["authUrl"].as_str().unwrap()).unwrap();
    let values: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
    {
        let mut state = f.state.lock().unwrap();
        state.nonce = values["nonce"].clone();
        state.challenge = values["code_challenge"].clone();
        state.resource = params["authorization"]["resource"].as_str().unwrap().into();
    }
    let mut callback = reqwest::Url::parse(&values["redirect_uri"]).unwrap();
    callback
        .query_pairs_mut()
        .append_pair("state", &values["state"])
        .append_pair(
            if denied { "error" } else { "code" },
            if denied {
                "access_denied"
            } else {
                "one-time-code"
            },
        );
    let response = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(callback)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 204);
}

#[tokio::test]
async fn opening_the_browser_waits_for_a_verified_callback_before_the_original_search() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.state.lock().unwrap().web_response = Some(result());
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    // Stdio has no transport disconnect token; the live writer is its lifetime.
    server
        .transport_disconnects
        .lock()
        .unwrap()
        .remove(&ConnectionId(81));
    let task = search(&manager);
    let host = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(f.count("/web/searches"), 0);
        assert_eq!(f.count("/auth/token"), 1);
        callback(&f, &params, false).await;
    };
    let (result, ()) = tokio::join!(task, host);
    let result = result.unwrap();
    assert!(result.success);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/auth/config"), 2);
    assert_eq!(f.count("/web/searches"), 1);
    assert_eq!(server.server_requests.pending_count(), 0);
    assert!(outbound.try_recv().is_err());
}

#[tokio::test]
async fn cancelled_unavailable_invalid_and_disconnected_hosts_dispatch_no_business_request() {
    for action in [
        "cancelled",
        "unavailable",
        "invalid",
        "disconnect",
        "stdio_disconnect",
        "logout",
        "denied",
        "unknown",
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        f.login(&manager, CloudResource::Default).await;
        let server = crate::AppServer::new();
        let (mut outbound, disconnect) = attach(&manager, &server).await;
        if action == "stdio_disconnect" {
            server
                .transport_disconnects
                .lock()
                .unwrap()
                .remove(&ConnectionId(81));
        }
        let host = async {
            let request = next(&mut outbound).await;
            let params = request.params.unwrap();
            let response = if matches!(
                action,
                "disconnect" | "stdio_disconnect" | "logout" | "denied" | "unknown"
            ) {
                "opened"
            } else {
                action
            };
            server
                .resolve_transport_server_request_response(
                    ConnectionId(81),
                    request.id,
                    json!({"action":response}),
                )
                .await;
            match action {
                "disconnect" => disconnect.cancel(),
                "stdio_disconnect" => server.unregister_transport_writer(ConnectionId(81)),
                "logout" => {
                    manager.logout().unwrap();
                }
                "denied" => callback(&f, &params, true).await,
                "unknown" => {
                    f.state.lock().unwrap().reject_identity = true;
                    callback(&f, &params, false).await;
                }
                _ => {}
            }
        };
        let (result, ()) = tokio::join!(search(&manager), host);
        assert!(result.is_err(), "{action}");
        assert_eq!(f.count("/web/searches"), 0, "{action}");
        assert_eq!(
            f.count("/auth/token"),
            if action == "unknown" { 2 } else { 1 },
            "{action}"
        );
        assert_eq!(server.server_requests.pending_count(), 0);
    }
}

#[tokio::test]
async fn a_new_manager_resumes_the_exact_authorization_after_a_cancelled_handoff() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.state.lock().unwrap().web_response = Some(result());
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let first = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"cancelled"}),
            )
            .await;
        params
    };
    let (result, original) = tokio::join!(search(&manager), first);
    assert!(result.is_err());
    let restarted = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&restarted, &server).await;
    let resume = async {
        let request = next(&mut outbound).await;
        assert_eq!(request.params.as_ref().unwrap(), &original);
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &original, false).await;
    };
    let (result, ()) = tokio::join!(search(&restarted), resume);
    assert!(result.unwrap().success);
    assert_eq!(f.count("/auth/config"), 2);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn concurrent_searches_share_one_authorization_and_one_original_operation() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    f.state.lock().unwrap().web_response = Some(result());
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let host = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &params, false).await;
    };
    let (first, second, ()) = tokio::join!(search(&manager), search(&manager), host);
    assert!(first.unwrap().success);
    assert!(second.unwrap().success);
    assert_eq!(f.count("/auth/config"), 2);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/web/searches"), 1);
    assert!(outbound.try_recv().is_err());
}

#[tokio::test]
async fn cancelling_the_original_tool_stops_waiting_without_a_search_or_new_transaction() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let cancel = CancellationToken::new();
    let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: root.path().into(),
        session_id: "cancel-web".into(),
        cancel_token: Some(cancel.clone()),
        workspace_sandbox: None,
    })
    .with_tool_identity(RuntimeToolExecutionIdentity::new(
        "cancel-call",
        "cancel-turn",
    ));
    let params = json!({"query":"Rust release"});
    let live = live_thread();
    let tool = manager.execute(RuntimeToolExecutionRequest {
        tool_name: "WebSearch",
        params: &params,
        context: &context,
        turn_context: Some(&live),
    });
    let host = async {
        let request = next(&mut outbound).await;
        let original = request.params.unwrap()["authorization"]["id"].clone();
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        cancel.cancel();
        original
    };
    let (result, original) = tokio::join!(tool, host);
    assert!(result.is_err());
    assert_eq!(f.count("/web/searches"), 0);
    assert_eq!(f.count("/auth/token"), 1);
    let read = manager.read(Default::default()).unwrap();
    let authorization = read
        .authorizations
        .iter()
        .find(|a| a.resource == CloudResource::Web)
        .unwrap();
    assert_eq!(authorization.id, original.as_str().unwrap());
    assert_eq!(authorization.status, AccountAuthorizationStatus::Pending);
}

#[tokio::test]
async fn concurrent_tools_with_expired_credentials_share_the_renewed_authorization() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.login(&manager, CloudResource::Default).await;
    let previous = f.login(&manager, CloudResource::Web).await;
    crate::account::store::update(&manager.path, |state| {
        let credential = state.credentials.get_mut(&CloudResource::Web).unwrap();
        credential.expires_at = chrono::Utc::now().timestamp() - 60;
        credential.tokens.refresh_token = None;
        Ok(())
    })
    .unwrap();
    f.state.lock().unwrap().web_response = Some(result());
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let host = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        assert_ne!(params["authorization"]["id"], previous);
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &params, false).await;
    };
    let (first, second, ()) = tokio::join!(search(&manager), search(&manager), host);
    assert!(first.unwrap().success);
    assert!(second.unwrap().success);
    assert_eq!(f.count("/auth/token"), 3);
    assert_eq!(f.count("/web/searches"), 1);
    assert!(outbound.try_recv().is_err());
}
