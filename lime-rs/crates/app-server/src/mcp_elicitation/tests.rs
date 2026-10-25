use super::*;
use app_server_protocol::protocol::v2::{ServerNotification, ServerRequestResolvedNotification};
use app_server_protocol::{
    protocol::v2::METHOD_SERVER_REQUEST_RESOLVED, JsonRpcError, JsonRpcErrorResponse,
    JsonRpcMessage, JsonRpcRequest, JsonRpcResponse,
};
use app_server_transport::{ConnectionId, QueuedOutgoingMessage};
use serde_json::json;
use tokio::time::{timeout, Duration};

async fn next_outer_request(
    outbound: &mut tokio::sync::broadcast::Receiver<JsonRpcMessage>,
) -> JsonRpcRequest {
    let JsonRpcMessage::Request(request) = timeout(Duration::from_secs(2), outbound.recv())
        .await
        .expect("outer request timeout")
        .expect("outer request")
    else {
        panic!("expected App Server reverse request");
    };
    request
}

async fn next_resolved(
    outbound: &mut tokio::sync::broadcast::Receiver<JsonRpcMessage>,
) -> ServerRequestResolvedNotification {
    let JsonRpcMessage::Notification(notification) =
        timeout(Duration::from_secs(2), outbound.recv())
            .await
            .expect("resolved notification timeout")
            .expect("resolved notification")
    else {
        panic!("expected App Server resolved notification");
    };
    assert_eq!(notification.method, METHOD_SERVER_REQUEST_RESOLVED);
    let ServerNotification::ServerRequestResolved(params) =
        ServerNotification::try_from(notification).expect("typed resolved notification")
    else {
        panic!("expected typed resolved notification");
    };
    assert_eq!(params.thread_id, "thread-1");
    params
}

async fn begin_outer_wait(
    server: &AppServer,
    outbound: &mut tokio::sync::broadcast::Receiver<JsonRpcMessage>,
    closed: CancellationToken,
) -> (
    JsonRpcRequest,
    tokio::task::JoinHandle<Option<ElicitationResponse>>,
) {
    let pending = server
        .begin_test_server_request(
            METHOD_MCP_SERVER_ELICITATION_REQUEST,
            json!({
                "threadId": "thread-1",
                "turnId": null,
                "serverName": "form-server",
                "mode": "form",
                "_meta": null,
                "message": "Choose a value",
                "requestedSchema": {
                    "type": "object",
                    "properties": {}
                }
            }),
        )
        .await
        .expect("begin outer request");
    let request = next_outer_request(outbound).await;
    let wait_server = server.clone();
    let terminal = tokio::spawn(async move {
        let terminal =
            wait_for_outer_terminal(pending, closed, "test-domain-request".to_string()).await;
        notify_resolved(
            &wait_server,
            terminal.owner,
            "thread-1",
            terminal.outer_request_id,
        )
        .await;
        terminal.response
    });
    (request, terminal)
}

async fn assert_no_duplicate(outbound: &mut tokio::sync::broadcast::Receiver<JsonRpcMessage>) {
    assert!(timeout(Duration::from_millis(100), outbound.recv())
        .await
        .is_err());
}

async fn next_transport_resolved(
    outbound: &mut mpsc::Receiver<QueuedOutgoingMessage>,
) -> ServerRequestResolvedNotification {
    let JsonRpcMessage::Notification(notification) = timeout(Duration::from_secs(2), async {
        outbound
            .recv()
            .await
            .expect("transport resolved notification")
            .message
            .into_json_rpc_message()
    })
    .await
    .expect("transport resolved notification timeout") else {
        panic!("expected transport resolved notification");
    };
    assert_eq!(notification.method, METHOD_SERVER_REQUEST_RESOLVED);
    let ServerNotification::ServerRequestResolved(params) =
        ServerNotification::try_from(notification).expect("typed resolved notification")
    else {
        panic!("expected typed resolved notification");
    };
    assert_eq!(params.thread_id, "thread-1");
    params
}

fn assert_private_identity_absent(value: &serde_json::Value) {
    match value {
        serde_json::Value::Array(values) => {
            for value in values {
                assert_private_identity_absent(value);
            }
        }
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                assert_ne!(key, "limeai.run/mcp-call-scope");
                assert_ne!(key, "rawRequestId");
                assert_ne!(key, "mcpRequestId");
                assert_private_identity_absent(value);
            }
        }
        _ => {}
    }
}

#[tokio::test]
async fn lime_thread_owner_reaches_outer_request_without_invented_identity() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let params = McpServerElicitationRequestParams {
        thread_id: "thread-7".to_string(),
        turn_id: Some("turn-7".to_string()),
        server_name: "form-server".to_string(),
        request: McpServerElicitationRequest::Form {
            meta: Some(json!({ "persist": ["session", "always"] })),
            message: "Choose a value".to_string(),
            requested_schema: serde_json::from_value(json!({
                "type": "object",
                "properties": { "confirmed": { "type": "boolean" } },
                "required": ["confirmed"]
            }))
            .expect("object schema"),
        },
    };

    let pending = server
        .begin_test_server_request(
            METHOD_MCP_SERVER_ELICITATION_REQUEST,
            serde_json::to_value(params).expect("serialize elicitation params"),
        )
        .await
        .expect("begin outer request");
    let request = next_outer_request(&mut outbound).await;
    let request_params = request.params.as_ref().expect("outer request params");

    assert_eq!(
        request_params,
        &json!({
            "threadId": "thread-7",
            "turnId": "turn-7",
            "serverName": "form-server",
            "mode": "form",
            "_meta": { "persist": ["session", "always"] },
            "message": "Choose a value",
            "requestedSchema": {
                "type": "object",
                "properties": { "confirmed": { "type": "boolean" } },
                "required": ["confirmed"]
            }
        })
    );
    assert!(request_params.get("sessionId").is_none());
    assert!(request_params.get("parentToolCallId").is_none());
    assert_private_identity_absent(request_params);
    drop(pending);
}

#[test]
fn typed_outer_response_preserves_action_and_meta_contract() {
    assert_eq!(
        parse_response(json!({ "action": "decline" })).expect("decline"),
        ElicitationResponse::Decline
    );
    assert!(parse_response(json!({
        "action": "accept",
        "content": ["not", "an", "object"]
    }))
    .is_err());
    assert!(parse_response(json!({
        "action": "cancel",
        "content": { "unexpected": true }
    }))
    .is_err());
    assert!(parse_response(json!({
        "action": "decline",
        "_meta": { "trace": "declined" }
    }))
    .is_ok());
}

#[tokio::test]
async fn normal_result_notifies_resolved_before_domain_response_once() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let (request, terminal) =
        begin_outer_wait(&server, &mut outbound, CancellationToken::new()).await;
    let outer_request_id = request.id.clone();

    server
        .handle_message(JsonRpcMessage::Response(
            JsonRpcResponse::new(request.id, json!({ "action": "decline" }))
                .expect("outer response"),
        ))
        .await
        .expect("handle outer response");

    assert_eq!(
        next_resolved(&mut outbound).await.request_id,
        outer_request_id
    );
    assert_eq!(
        terminal.await.expect("terminal join"),
        Some(ElicitationResponse::Decline)
    );
    assert_no_duplicate(&mut outbound).await;
}

#[tokio::test]
async fn malformed_result_notifies_resolved_before_cancel_response_once() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let (request, terminal) =
        begin_outer_wait(&server, &mut outbound, CancellationToken::new()).await;
    let outer_request_id = request.id.clone();

    server
        .handle_message(JsonRpcMessage::Response(
            JsonRpcResponse::new(
                request.id,
                json!({ "action": "accept", "content": ["not", "an", "object"] }),
            )
            .expect("outer response"),
        ))
        .await
        .expect("handle malformed outer response");

    assert_eq!(
        next_resolved(&mut outbound).await.request_id,
        outer_request_id
    );
    assert_eq!(
        terminal.await.expect("terminal join"),
        Some(ElicitationResponse::Cancel)
    );
    assert_no_duplicate(&mut outbound).await;
}

#[tokio::test]
async fn json_rpc_error_notifies_resolved_before_domain_response_once() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let (request, terminal) =
        begin_outer_wait(&server, &mut outbound, CancellationToken::new()).await;
    let outer_request_id = request.id.clone();

    server
        .handle_message(JsonRpcMessage::Error(JsonRpcErrorResponse {
            id: request.id,
            error: JsonRpcError::new(error_codes::INVALID_REQUEST, "invalid form response"),
        }))
        .await
        .expect("handle outer error");

    assert_eq!(
        next_resolved(&mut outbound).await.request_id,
        outer_request_id
    );
    assert_eq!(
        terminal.await.expect("terminal join"),
        Some(ElicitationResponse::Decline)
    );
    assert_no_duplicate(&mut outbound).await;
}

#[tokio::test]
async fn request_cancel_error_notifies_resolved_before_cancel_response_once() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let (request, terminal) =
        begin_outer_wait(&server, &mut outbound, CancellationToken::new()).await;
    let outer_request_id = request.id.clone();

    server
        .handle_message(JsonRpcMessage::Error(JsonRpcErrorResponse {
            id: request.id,
            error: JsonRpcError::new(error_codes::REQUEST_CANCELLED, "request cancelled"),
        }))
        .await
        .expect("handle outer cancellation");

    assert_eq!(
        next_resolved(&mut outbound).await.request_id,
        outer_request_id
    );
    assert_eq!(
        terminal.await.expect("terminal join"),
        Some(ElicitationResponse::Cancel)
    );
    assert_no_duplicate(&mut outbound).await;
}

#[tokio::test]
async fn rmcp_closed_notifies_resolved_without_domain_resolve_once() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let closed = CancellationToken::new();
    let (request, terminal) = begin_outer_wait(&server, &mut outbound, closed.clone()).await;
    let outer_request_id = request.id;

    closed.cancel();

    assert_eq!(
        next_resolved(&mut outbound).await.request_id,
        outer_request_id
    );
    assert_eq!(terminal.await.expect("terminal join"), None);
    assert_no_duplicate(&mut outbound).await;
}

#[tokio::test]
async fn resolved_notification_targets_migrated_owner_after_resume() {
    let server = AppServer::new();
    let first_connection = ConnectionId(11);
    let second_connection = ConnectionId(12);
    let (first_writer, mut first_outbound) = mpsc::channel(4);
    let (second_writer, mut second_outbound) = mpsc::channel(4);
    server.register_transport_writer(first_connection, first_writer, None);
    server.register_transport_writer(second_connection, second_writer, None);
    server.mark_transport_initialized(first_connection);
    server.mark_transport_initialized(second_connection);
    let first_owner = crate::server_request::ServerRequestOwner::Transport(first_connection);
    let second_owner = crate::server_request::ServerRequestOwner::Transport(second_connection);
    let pending = server.server_requests.register_for_owner(
        first_owner,
        METHOD_MCP_SERVER_ELICITATION_REQUEST,
        Some(json!({ "threadId": "thread-1" })),
    );
    let request_id = pending.id().clone();

    assert_eq!(
        server
            .server_requests
            .cancel_owner(first_owner, "disconnected"),
        0
    );
    assert_eq!(
        server
            .server_requests
            .claim_owner_thread(second_owner, "thread-1")
            .len(),
        1
    );
    server
        .resolve_transport_server_request_response(
            second_connection,
            request_id.clone(),
            json!({ "action": "decline" }),
        )
        .await;

    let terminal = wait_for_outer_terminal(
        pending,
        CancellationToken::new(),
        "migrated-domain-request".to_string(),
    )
    .await;
    assert_eq!(terminal.owner, Some(second_owner));
    assert!(terminal.resolved_in_listener);

    assert_eq!(
        next_transport_resolved(&mut second_outbound)
            .await
            .request_id,
        request_id
    );
    assert!(timeout(Duration::from_millis(100), first_outbound.recv())
        .await
        .is_err());
}

#[tokio::test]
async fn domain_close_targets_current_claimed_owner() {
    let server = AppServer::new();
    let first_connection = ConnectionId(21);
    let second_connection = ConnectionId(22);
    let (first_writer, mut first_outbound) = mpsc::channel(4);
    let (second_writer, mut second_outbound) = mpsc::channel(4);
    server.register_transport_writer(first_connection, first_writer, None);
    server.register_transport_writer(second_connection, second_writer, None);
    server.mark_transport_initialized(first_connection);
    server.mark_transport_initialized(second_connection);
    let first_owner = crate::server_request::ServerRequestOwner::Transport(first_connection);
    let second_owner = crate::server_request::ServerRequestOwner::Transport(second_connection);
    let pending = server.server_requests.register_for_owner(
        first_owner,
        METHOD_MCP_SERVER_ELICITATION_REQUEST,
        Some(json!({ "threadId": "thread-1" })),
    );
    let request_id = pending.id().clone();
    let closed = CancellationToken::new();

    assert_eq!(
        server
            .server_requests
            .cancel_owner(first_owner, "disconnected"),
        0
    );
    assert_eq!(
        server
            .server_requests
            .claim_owner_thread(second_owner, "thread-1")
            .len(),
        1
    );
    closed.cancel();

    let terminal =
        wait_for_outer_terminal(pending, closed, "closed-domain-request".to_string()).await;
    assert_eq!(terminal.owner, Some(second_owner));
    assert_eq!(terminal.response, None);
    notify_resolved(
        &server,
        terminal.owner,
        "thread-1",
        terminal.outer_request_id,
    )
    .await;

    assert_eq!(
        next_transport_resolved(&mut second_outbound)
            .await
            .request_id,
        request_id
    );
    assert!(timeout(Duration::from_millis(100), first_outbound.recv())
        .await
        .is_err());
}

#[tokio::test]
async fn domain_close_after_routed_response_preserves_actual_owner() {
    let server = AppServer::new();
    let first_owner = crate::server_request::ServerRequestOwner::Transport(ConnectionId(31));
    let second_owner = crate::server_request::ServerRequestOwner::Transport(ConnectionId(32));
    let pending = server.server_requests.register_for_owner(
        first_owner,
        METHOD_MCP_SERVER_ELICITATION_REQUEST,
        Some(json!({ "threadId": "thread-1" })),
    );
    let request_id = pending.id().clone();
    let closed = CancellationToken::new();

    assert_eq!(
        server
            .server_requests
            .cancel_owner(first_owner, "disconnected"),
        0
    );
    assert_eq!(
        server
            .server_requests
            .claim_owner_thread(second_owner, "thread-1")
            .len(),
        1
    );
    server
        .resolve_transport_server_request_response(
            ConnectionId(32),
            request_id,
            json!({ "action": "decline" }),
        )
        .await;
    closed.cancel();

    let terminal = wait_for_outer_terminal(
        pending,
        closed,
        "closed-after-response-domain-request".to_string(),
    )
    .await;
    assert_eq!(terminal.owner, Some(second_owner));
    assert_eq!(terminal.response, None);
}

#[tokio::test]
async fn shared_form_terminal_reaches_both_subscribers_once_even_on_interrupt() {
    for interrupted in [false, true] {
        let server = AppServer::new();
        let mut receivers = Vec::new();
        for id in [ConnectionId(1), ConnectionId(2)] {
            let (writer, receiver) = mpsc::channel(8);
            server.register_transport_writer(id, writer, None);
            server.mark_transport_initialized(id);
            server.thread_states.connection_initialized(id).await;
            assert!(
                server
                    .thread_states
                    .subscribe_connection(agent_protocol::ThreadId::new("thread-1"), id)
                    .await
            );
            receivers.push(receiver);
        }
        let pending = server
            .begin_thread_server_request(
                "thread-1",
                METHOD_MCP_SERVER_ELICITATION_REQUEST,
                json!({ "threadId": "thread-1", "turnId": "turn-1" }),
            )
            .await
            .unwrap();
        let request_id = pending.id().clone();
        for receiver in &mut receivers {
            let request = timeout(Duration::from_secs(2), receiver.recv())
                .await
                .unwrap()
                .unwrap()
                .message
                .into_json_rpc_message();
            assert_eq!(request, JsonRpcMessage::Request(pending.request().clone()));
        }
        if interrupted {
            assert_eq!(
                server
                    .server_requests
                    .abort_for_thread_turn(
                        &server.event_bridge(),
                        "thread-1",
                        "turn-1",
                        "interrupted"
                    )
                    .await,
                1
            );
        } else {
            server
                .server_requests
                .resolve_transport_response(
                    ConnectionId(2),
                    request_id.clone(),
                    json!({ "action": "cancel" }),
                )
                .unwrap();
        }
        let terminal =
            wait_for_outer_terminal(pending, CancellationToken::new(), "shared-form".into()).await;
        assert_eq!(terminal.resolved_in_listener, interrupted);
        // A domain cancellation may already have removed the original MCP waiter.
        let domain_id = serde_json::from_value(json!("already-canceled-form")).unwrap();
        settle_outer_terminal(
            &server,
            &ElicitationRequestRouter::default(),
            &domain_id,
            "thread-1",
            terminal,
        )
        .await;
        for receiver in &mut receivers {
            assert_eq!(
                next_transport_resolved(receiver).await.request_id,
                request_id
            );
            assert!(receiver.try_recv().is_err());
        }
        assert_eq!(server.server_requests.pending_count(), 0);
    }
}
