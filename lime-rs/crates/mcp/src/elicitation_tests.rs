use super::*;
use crate::client::LimeMcpClient;
use crate::{LimeMcpClientService, McpRuntimeOwner};
use rmcp::model::{
    BooleanSchema, CallToolRequestParam, CallToolResult,
    ElicitationAction as RmcpElicitationAction, ElicitationSchema, IntegerSchema, PrimitiveSchema,
    StringSchema,
};
use rmcp::service::{PeerRequestOptions, RequestContext, RoleServer};
use rmcp::{ServerHandler, ServiceExt};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Barrier;

fn form_request() -> CreateElicitationRequestParam {
    CreateElicitationRequestParam {
        message: "Provide release details".to_string(),
        requested_schema: ElicitationSchema::builder()
            .required_property(
                "name",
                PrimitiveSchema::String(StringSchema::new().min_length(1)),
            )
            .required_property(
                "count",
                PrimitiveSchema::Integer(IntegerSchema::new().range(1, 10)),
            )
            .property("confirmed", PrimitiveSchema::Boolean(BooleanSchema::new()))
            .required_enum("channel", vec!["stable".to_string(), "preview".to_string()])
            .build()
            .expect("valid elicitation schema"),
    }
}

fn call_scope() -> tool_runtime::mcp_connection::McpCallScope {
    call_scope_for("turn-1")
}

fn call_scope_for(turn_id: &str) -> tool_runtime::mcp_connection::McpCallScope {
    tool_runtime::mcp_connection::McpCallScope::new(Some(turn_id)).expect("MCP turn correlation")
}

fn runtime_owner(session_id: &str, thread_id: &str) -> McpRuntimeOwner {
    McpRuntimeOwner {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
    }
}

async fn receive_request(receiver: &mut mpsc::Receiver<ElicitationRequest>) -> ElicitationRequest {
    receiver.recv().await.expect("elicitation request")
}

#[derive(Clone)]
struct ElicitationServer;

impl ServerHandler for ElicitationServer {}

#[derive(Clone)]
struct ScopedElicitationServer;

impl ServerHandler for ScopedElicitationServer {
    async fn call_tool(
        &self,
        _request: CallToolRequestParam,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        assert!(context.meta.get(MCP_PROGRESS_TOKEN_META_KEY).is_some());
        let mut meta = rmcp::model::Meta::new();
        meta.insert("persist".to_string(), json!(["session", "always"]));
        let result = context
            .peer
            .send_request_with_option(
                rmcp::model::ServerRequest::CreateElicitationRequest(
                    rmcp::model::CreateElicitationRequest {
                        method: Default::default(),
                        params: form_request(),
                        extensions: Default::default(),
                    },
                ),
                PeerRequestOptions {
                    timeout: None,
                    meta: Some(meta),
                },
            )
            .await
            .map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?
            .await_response()
            .await
            .map_err(|error| rmcp::ErrorData::internal_error(error.to_string(), None))?;
        let rmcp::model::ClientResult::CreateElicitationResult(result) = result else {
            return Err(rmcp::ErrorData::internal_error(
                "unexpected elicitation response",
                None,
            ));
        };
        assert_eq!(result.action, RmcpElicitationAction::Accept);
        Ok(CallToolResult::success(vec![rmcp::model::Content::text(
            "elicitation accepted",
        )]))
    }
}

#[tokio::test]
async fn scoped_tools_call_owner_routes_nested_elicitation_without_private_wire_metadata() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    let (server_transport, client_transport) = tokio::io::duplex(8192);
    let server_task = tokio::spawn(async move {
        let service = ScopedElicitationServer
            .serve(server_transport)
            .await
            .expect("start scoped elicitation server");
        service.waiting().await.expect("wait for server")
    });
    let client_service = LimeMcpClientService::with_runtime_elicitation_router(
        "scoped-server".to_string(),
        None,
        router.clone(),
        "session-1".to_string(),
        "thread-1".to_string(),
    )
    .serve(client_transport)
    .await
    .expect("start Lime MCP client");
    let client = crate::McpBridgeClient::new(Arc::new(client_service), Duration::from_secs(5));
    let scope = call_scope()
        .with_environment_id("local")
        .with_snapshot_generation(17)
        .with_auth_scopes(vec!["search.read".to_string()]);
    let call_task = tokio::spawn(async move {
        client
            .call_tool(
                "request-form",
                None,
                Default::default(),
                Some(&scope),
                CancellationToken::new(),
            )
            .await
    });

    let request = receive_request(&mut requests).await;
    assert_eq!(request.thread_id, "thread-1");
    assert_eq!(request.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(request.environment_id(), Some("local"));
    assert_eq!(request.snapshot_generation(), Some(17));
    assert_eq!(
        request.auth_scopes(),
        Some(["search.read".to_string()].as_slice())
    );
    assert_eq!(
        request.meta,
        Some(json!({ "persist": ["session", "always"] }))
    );
    router
        .resolve(
            &request.id,
            ElicitationResponse::try_from_parts(
                ElicitationAction::Accept,
                Some(json!({
                    "name": "release",
                    "count": 2,
                    "channel": "stable"
                })),
            )
            .expect("valid response"),
        )
        .await
        .expect("resolve nested elicitation");
    call_task
        .await
        .expect("call task")
        .expect("scoped tool result");

    server_task.abort();
    let _ = server_task.await;
}

#[tokio::test]
async fn shared_manager_router_keeps_replacement_waiters_exact() {
    let router = ElicitationRequestRouter::default();
    let old_client = LimeMcpClient::with_runtime_elicitation_router(
        "same-server".to_string(),
        None,
        router.clone(),
        runtime_owner("session-1", "thread-1"),
    );
    let new_client = LimeMcpClient::with_runtime_elicitation_router(
        "same-server".to_string(),
        None,
        router.clone(),
        runtime_owner("session-1", "thread-1"),
    );
    let mut requests = router.subscribe().expect("request consumer");

    let old_task = tokio::spawn(async move {
        old_client
            .handle_form_elicitation(form_request(), call_scope(), None, CancellationToken::new())
            .await
    });
    let old_request = receive_request(&mut requests).await;
    let new_task = tokio::spawn(async move {
        new_client
            .handle_form_elicitation(form_request(), call_scope(), None, CancellationToken::new())
            .await
    });
    let new_request = receive_request(&mut requests).await;

    assert_ne!(old_request.id, new_request.id);
    assert!(!old_request.id.as_str().contains("same-server"));
    router
        .resolve(
            &old_request.id,
            ElicitationResponse::try_from_parts(
                ElicitationAction::Accept,
                Some(json!({
                    "name": "old",
                    "count": 1,
                    "channel": "stable"
                })),
            )
            .expect("typed response"),
        )
        .await
        .expect("resolve old waiter");
    router
        .resolve(&new_request.id, ElicitationResponse::Cancel)
        .await
        .expect("resolve replacement waiter");

    assert_eq!(
        old_task
            .await
            .expect("old task")
            .expect("old response")
            .action,
        ElicitationAction::Accept
    );
    assert_eq!(
        new_task
            .await
            .expect("new task")
            .expect("new response")
            .action,
        ElicitationAction::Cancel
    );
}

#[tokio::test]
async fn same_server_requests_keep_thread_scopes_and_waiters_exact() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");

    let first_router = router.clone();
    let first = tokio::spawn(async move {
        first_router
            .request_with_scope(
                "same-server".to_string(),
                runtime_owner("session-a", "thread-a"),
                call_scope_for("turn-a"),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let first_request = receive_request(&mut requests).await;

    let second_router = router.clone();
    let second = tokio::spawn(async move {
        second_router
            .request_with_scope(
                "same-server".to_string(),
                runtime_owner("session-b", "thread-b"),
                call_scope_for("turn-b"),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let second_request = receive_request(&mut requests).await;

    assert_eq!(first_request.server_name, second_request.server_name);
    assert_eq!(first_request.thread_id, "thread-a");
    assert_eq!(second_request.thread_id, "thread-b");
    assert_eq!(first_request.turn_id.as_deref(), Some("turn-a"));
    assert_eq!(second_request.turn_id.as_deref(), Some("turn-b"));
    assert_ne!(first_request.id, second_request.id);

    router
        .resolve(&second_request.id, ElicitationResponse::Cancel)
        .await
        .expect("resolve second waiter exactly");
    router
        .resolve(
            &first_request.id,
            ElicitationResponse::try_from_parts(
                ElicitationAction::Accept,
                Some(json!({
                    "name": "first",
                    "count": 1,
                    "channel": "stable"
                })),
            )
            .expect("valid first response"),
        )
        .await
        .expect("resolve first waiter exactly");

    assert_eq!(
        first
            .await
            .expect("first task")
            .expect("first response")
            .action,
        ElicitationAction::Accept
    );
    assert_eq!(
        second
            .await
            .expect("second task")
            .expect("second response")
            .action,
        ElicitationAction::Cancel
    );
}

#[tokio::test]
async fn session_cancel_keeps_other_session_and_forwarded_waiter_is_adapter_owned() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    router.defer_cancellation_to_consumer();

    let request_router = router.clone();
    let session_a = tokio::spawn(async move {
        request_router
            .request_with_scope(
                "same-server".to_string(),
                runtime_owner("session-a", "thread-a"),
                call_scope_for("turn-a"),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request_router = router.clone();
    let session_b = tokio::spawn(async move {
        request_router
            .request_with_scope(
                "same-server".to_string(),
                runtime_owner("session-b", "thread-b"),
                call_scope_for("turn-b"),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });

    let mut request_a = None;
    let mut request_b = None;
    for _ in 0..2 {
        let request = receive_request(&mut requests).await;
        match request.thread_id.as_str() {
            "thread-a" => request_a = Some(request),
            "thread-b" => request_b = Some(request),
            thread_id => panic!("unexpected MCP runtime thread: {thread_id}"),
        }
    }
    let request_a = request_a.expect("session A request");
    let request_b = request_b.expect("session B request");
    let closed_a = request_a.closed();
    let closed_b = request_b.closed();
    assert!(router.mark_forwarded(&request_a.id));

    assert_eq!(router.cancel_session("session-a"), 1);
    assert!(closed_a.is_cancelled());
    assert!(!closed_b.is_cancelled());
    assert_eq!(router.pending_count(), 2);

    router
        .resolve(&request_b.id, ElicitationResponse::Cancel)
        .await
        .expect("resolve session B request");
    assert_eq!(
        session_b
            .await
            .expect("session B request task")
            .expect("session B cancel response")
            .action,
        ElicitationAction::Cancel
    );

    let mut session_a = Box::pin(session_a);
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut session_a)
            .await
            .is_err(),
        "forwarded waiter must remain until the adapter publishes its terminal"
    );
    router
        .claim(&request_a.id, ElicitationResponse::Cancel)
        .expect("adapter terminal claim")
        .consume()
        .expect("adapter terminal consume");
    assert_eq!(
        session_a
            .await
            .expect("session A request task")
            .expect("session A cancel response")
            .action,
        ElicitationAction::Cancel
    );
    assert_eq!(router.pending_count(), 0);
}

#[tokio::test]
async fn rmcp_server_request_without_scoped_tool_call_declines_without_routing() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    let (server_transport, client_transport) = tokio::io::duplex(4096);
    let (peer_sender, peer_receiver) = oneshot::channel();
    let server_task = tokio::spawn(async move {
        let service = ElicitationServer
            .serve(server_transport)
            .await
            .expect("start elicitation server");
        peer_sender
            .send(service.peer().clone())
            .expect("publish server peer");
        service.waiting().await.expect("wait for server")
    });
    let client = LimeMcpClientService::with_elicitation_router(
        "duplex-server".to_string(),
        None,
        router.clone(),
    )
    .serve(client_transport)
    .await
    .expect("start Lime MCP client");
    let peer: rmcp::service::Peer<RoleServer> = peer_receiver.await.expect("server peer");
    let response_task = tokio::spawn(async move { peer.create_elicitation(form_request()).await });

    assert_eq!(
        response_task
            .await
            .expect("response task")
            .expect("elicitation response")
            .action,
        RmcpElicitationAction::Decline
    );
    assert!(requests.try_recv().is_err());
    assert_eq!(router.pending_count(), 0);

    client.cancel().await.expect("stop Lime MCP client");
    server_task.await.expect("server task");
}

#[tokio::test]
async fn raw_wire_response_preserves_result_meta() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    let (raw_server, client_transport) = tokio::io::duplex(8192);
    let (raw_reader, mut raw_writer) = tokio::io::split(raw_server);
    let client = LimeMcpClientService::with_runtime_elicitation_router(
        "raw-wire-server".to_string(),
        None,
        router.clone(),
        "session-1".to_string(),
        "thread-1".to_string(),
    );
    let scope_guard = client
        .handler()
        .enter_elicitation_owner(Some(call_scope()))
        .await;
    let client_task = tokio::spawn(async move { client.serve(client_transport).await });
    let mut lines = BufReader::new(raw_reader).lines();

    let initialize = lines
        .next_line()
        .await
        .expect("read initialize")
        .expect("initialize request");
    let initialize: serde_json::Value =
        serde_json::from_str(&initialize).expect("valid initialize request");
    assert_eq!(initialize["method"], "initialize");
    assert_eq!(initialize["params"]["protocolVersion"], "2025-06-18");
    assert_eq!(
        initialize["params"]["capabilities"],
        json!({ "elicitation": {} })
    );
    raw_writer
        .write_all(
            format!(
                "{}\n",
                json!({
                    "jsonrpc": "2.0",
                    "id": initialize["id"],
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "serverInfo": { "name": "raw-server", "version": "1.0.0" }
                    }
                })
            )
            .as_bytes(),
        )
        .await
        .expect("write initialize response");
    let initialized = lines
        .next_line()
        .await
        .expect("read initialized")
        .expect("initialized notification");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&initialized)
            .expect("valid initialized notification")["method"],
        "notifications/initialized"
    );

    raw_writer
        .write_all(
            format!(
                "{}\n",
                json!({
                    "jsonrpc": "2.0",
                    "id": 41,
                    "method": "elicitation/create",
                    "params": {
                        "_meta": {
                            "progressToken": "rmcp-progress-token",
                            "persist": ["session", "always"]
                        },
                        "message": "Confirm release",
                        "requestedSchema": {
                            "type": "object",
                            "properties": {
                                "confirmed": { "type": "boolean" }
                            },
                            "required": ["confirmed"]
                        }
                    }
                })
            )
            .as_bytes(),
        )
        .await
        .expect("write elicitation request");
    let request = receive_request(&mut requests).await;
    assert_eq!(request.thread_id, "thread-1");
    assert_eq!(request.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(
        request.meta,
        Some(json!({ "persist": ["session", "always"] }))
    );
    router
        .resolve(
            &request.id,
            ElicitationResponse::try_from_parts_with_meta(
                ElicitationAction::Accept,
                Some(json!({ "confirmed": true })),
                Some(json!({ "persist": ["session", "always"] })),
            )
            .expect("validated response with metadata"),
        )
        .await
        .expect("resolve elicitation");

    let response = lines
        .next_line()
        .await
        .expect("read elicitation response")
        .expect("elicitation response");
    let response: serde_json::Value =
        serde_json::from_str(&response).expect("valid elicitation response");
    assert_eq!(response["id"], 41);
    assert_eq!(response["result"]["action"], "accept");
    assert_eq!(response["result"]["content"], json!({ "confirmed": true }));
    assert_eq!(
        response["result"]["_meta"],
        json!({ "persist": ["session", "always"] })
    );

    drop(raw_writer);
    drop(scope_guard);
    client_task.abort();
    let _ = client_task.await;
}

#[tokio::test]
async fn invalid_content_fails_closed_without_consuming_waiter() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    let request_router = router.clone();
    let task = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request = receive_request(&mut requests).await;

    let invalid = ElicitationResponse::try_from_parts(
        ElicitationAction::Accept,
        Some(json!({ "name": 7, "count": 0, "channel": "unknown" })),
    )
    .expect("object response");
    assert!(matches!(
        router.resolve(&request.id, invalid).await,
        Err(ElicitationRouterError::InvalidContent(_))
    ));
    assert_eq!(router.pending_count(), 1);

    let unknown = ElicitationResponse::try_from_parts(
        ElicitationAction::Accept,
        Some(json!({
            "name": "release",
            "count": 2,
            "channel": "preview",
            "undeclared": true
        })),
    )
    .expect("object response");
    assert!(matches!(
        router.resolve(&request.id, unknown).await,
        Err(ElicitationRouterError::InvalidContent(_))
    ));
    assert_eq!(router.pending_count(), 1);

    router
        .resolve(
            &request.id,
            ElicitationResponse::try_from_parts(
                ElicitationAction::Accept,
                Some(json!({
                    "name": "release",
                    "count": 2,
                    "confirmed": true,
                    "channel": "preview"
                })),
            )
            .expect("typed response"),
        )
        .await
        .expect("resolve corrected response");
    task.await.expect("request task").expect("response");
}

#[test]
fn response_parts_enforce_action_content_contract() {
    assert_eq!(
        ElicitationResponse::try_from_parts(ElicitationAction::Accept, None),
        Err(ElicitationRouterError::AcceptContentRequired)
    );
    assert_eq!(
        ElicitationResponse::try_from_parts(ElicitationAction::Decline, Some(json!({}))),
        Err(ElicitationRouterError::ContentForbidden)
    );
    assert_eq!(
        ElicitationResponse::try_from_parts(ElicitationAction::Cancel, Some(json!({}))),
        Err(ElicitationRouterError::ContentForbidden)
    );
    assert_eq!(
        ElicitationResponse::try_from_parts_with_meta(
            ElicitationAction::Decline,
            None,
            Some(json!("not-an-object")),
        ),
        Err(ElicitationRouterError::MetaMustBeObject)
    );
}

#[test]
fn string_formats_are_enforced() {
    for (name, schema, valid, invalid) in [
        (
            "email",
            StringSchema::email(),
            "user@example.com",
            "not-an-email",
        ),
        (
            "uri",
            StringSchema::uri(),
            "https://example.com/path",
            "not a uri",
        ),
        ("date", StringSchema::date(), "2026-07-13", "2026-02-30"),
        (
            "date-time",
            StringSchema::date_time(),
            "2026-07-13T11:00:00Z",
            "2026-07-13 11:00:00",
        ),
    ] {
        let schema = PrimitiveSchema::String(schema);
        assert!(validate_primitive(name, &schema, &json!(valid)).is_ok());
        assert!(matches!(
            validate_primitive(name, &schema, &json!(invalid)),
            Err(ElicitationRouterError::InvalidContent(_))
        ));
    }
}

#[tokio::test]
async fn call_owner_gate_serializes_scoped_and_unscoped_owners() {
    let gate = ElicitationOwnerGate::default();
    let scoped = gate.enter(Some(call_scope())).await;
    let mut meta = rmcp::model::Meta::new();
    meta.insert(
        MCP_PROGRESS_TOKEN_META_KEY.to_string(),
        json!("rmcp-progress-token"),
    );
    meta.insert("persist".to_string(), json!(["session", "always"]));

    let (scope, meta) = gate.resolve_request_meta(meta);
    assert_eq!(scope, Some(call_scope()));
    assert_eq!(meta, Some(json!({ "persist": ["session", "always"] })));

    let waiting_gate = gate.clone();
    let unscoped = tokio::spawn(async move { waiting_gate.enter(None).await });
    tokio::task::yield_now().await;
    assert!(!unscoped.is_finished());
    drop(scoped);

    let unscoped = unscoped.await.expect("unscoped owner task");
    assert_eq!(
        gate.resolve_request_meta(rmcp::model::Meta::new()),
        (None, None)
    );
    drop(unscoped);
}

#[tokio::test]
async fn duplicate_unknown_and_canceled_ids_fail_closed() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    let request_router = router.clone();
    let task = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request = receive_request(&mut requests).await;
    let request_closed = request.closed();
    router
        .resolve(&request.id, ElicitationResponse::Decline)
        .await
        .expect("first response");
    task.await.expect("request task").expect("decline response");
    assert!(request_closed.is_cancelled());
    assert!(matches!(
        router
            .resolve(&request.id, ElicitationResponse::Decline)
            .await,
        Err(ElicitationRouterError::UnknownRequest(_))
    ));

    let cancellation = CancellationToken::new();
    let request_router = router.clone();
    let task_cancellation = cancellation.clone();
    let canceled_task = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                task_cancellation,
            )
            .await
    });
    let canceled_request = receive_request(&mut requests).await;
    let canceled_closed = canceled_request.closed();
    cancellation.cancel();
    assert!(matches!(
        canceled_task.await.expect("canceled task"),
        Err(ElicitationRouterError::RequestCanceled(_))
    ));
    assert!(matches!(
        router
            .resolve(&canceled_request.id, ElicitationResponse::Cancel)
            .await,
        Err(ElicitationRouterError::UnknownRequest(_))
    ));
    assert!(canceled_closed.is_cancelled());
}

#[tokio::test]
async fn dropped_waiter_and_missing_consumer_fail_closed() {
    let router = ElicitationRequestRouter::default();
    assert_eq!(
        router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new()
            )
            .await,
        Err(ElicitationRouterError::NoRequestConsumer)
    );
    assert_eq!(router.pending_count(), 0);

    let mut requests = router.subscribe().expect("request consumer");
    let request_router = router.clone();
    let task = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request = receive_request(&mut requests).await;
    task.abort();
    let _ = task.await;
    assert_eq!(router.pending_count(), 0);
    assert!(matches!(
        router
            .resolve(&request.id, ElicitationResponse::Cancel)
            .await,
        Err(ElicitationRouterError::UnknownRequest(_))
    ));
}

#[tokio::test]
async fn request_consumer_is_single_and_can_reconnect_after_drop() {
    let router = ElicitationRequestRouter::default();
    let requests = router.subscribe().expect("first request consumer");
    assert!(matches!(
        router.subscribe(),
        Err(ElicitationRouterError::RequestConsumerAlreadyAttached)
    ));

    drop(requests);
    assert_eq!(
        router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await,
        Err(ElicitationRouterError::NoRequestConsumer)
    );
    assert_eq!(router.pending_count(), 0);

    let mut replacement = router.subscribe().expect("replacement request consumer");
    let request_router = router.clone();
    let pending = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request = receive_request(&mut replacement).await;
    let request_closed = request.closed();
    drop(replacement);
    assert_eq!(
        pending.await.expect("pending request task"),
        Err(ElicitationRouterError::NoRequestConsumer)
    );
    assert_eq!(router.pending_count(), 0);
    assert!(request_closed.is_cancelled());
    let _reconnected = router.subscribe().expect("reconnected request consumer");
}

#[tokio::test]
async fn cancel_all_resolves_each_pending_waiter_as_cancel() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    let mut tasks = Vec::new();
    let mut closed = Vec::new();
    for server in ["first", "second"] {
        let request_router = router.clone();
        tasks.push(tokio::spawn(async move {
            request_router
                .request_for_test(
                    server.to_string(),
                    call_scope(),
                    form_request(),
                    None,
                    CancellationToken::new(),
                )
                .await
        }));
        closed.push(receive_request(&mut requests).await.closed());
    }

    assert_eq!(router.cancel_all(), 2);
    for task in tasks {
        assert_eq!(
            task.await
                .expect("request task")
                .expect("cancel response")
                .action,
            ElicitationAction::Cancel
        );
    }
    assert!(closed.into_iter().all(|token| token.is_cancelled()));
    assert_eq!(router.pending_count(), 0);
}

#[tokio::test]
async fn adapter_shutdown_releases_deferred_waiters_as_cancel() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    router.defer_cancellation_to_consumer();
    let request_router = router.clone();
    let pending = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request = receive_request(&mut requests).await;
    let closed = request.closed();

    assert_eq!(router.cancel_all(), 1);
    assert_eq!(
        pending
            .await
            .expect("request task")
            .expect("cancel response")
            .action,
        ElicitationAction::Cancel
    );
    assert!(closed.is_cancelled());
    assert_eq!(router.pending_count(), 0);
}

#[tokio::test]
async fn deferred_shutdown_leaves_forwarded_waiter_for_adapter_terminal() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");
    router.defer_cancellation_to_consumer();
    let request_router = router.clone();
    let pending = tokio::spawn(async move {
        request_router
            .request_for_test(
                "server".to_string(),
                call_scope(),
                form_request(),
                None,
                CancellationToken::new(),
            )
            .await
    });
    let request = receive_request(&mut requests).await;
    let closed = request.closed();
    assert!(router.mark_forwarded(&request.id));

    assert_eq!(router.cancel_all(), 1);
    assert!(closed.is_cancelled());
    let mut pending = Box::pin(pending);
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut pending)
            .await
            .is_err()
    );
    let claim = router
        .claim(&request.id, ElicitationResponse::Cancel)
        .expect("adapter terminal claim");
    claim.consume().expect("adapter terminal consume");
    assert_eq!(
        pending
            .await
            .expect("request task")
            .expect("cancel response")
            .action,
        ElicitationAction::Cancel
    );
}

#[tokio::test]
async fn resolve_and_request_cancellation_have_one_winner() {
    let router = ElicitationRequestRouter::default();
    let mut requests = router.subscribe().expect("request consumer");

    for _ in 0..50 {
        let cancellation = CancellationToken::new();
        let request_router = router.clone();
        let request_cancellation = cancellation.clone();
        let request_task = tokio::spawn(async move {
            request_router
                .request_for_test(
                    "server".to_string(),
                    call_scope(),
                    form_request(),
                    None,
                    request_cancellation,
                )
                .await
        });
        let request = receive_request(&mut requests).await;

        let barrier = Arc::new(Barrier::new(3));
        let resolve_router = router.clone();
        let resolve_id = request.id.clone();
        let resolve_barrier = barrier.clone();
        let resolve_task = tokio::spawn(async move {
            resolve_barrier.wait().await;
            resolve_router
                .resolve(&resolve_id, ElicitationResponse::Decline)
                .await
        });
        let cancel_barrier = barrier.clone();
        let cancel_task = tokio::spawn(async move {
            cancel_barrier.wait().await;
            cancellation.cancel();
        });
        barrier.wait().await;

        cancel_task.await.expect("cancel task");
        let resolve_result = resolve_task.await.expect("resolve task");
        let request_result = request_task.await.expect("request task");
        match resolve_result {
            Ok(()) => assert_eq!(
                request_result.expect("resolved response").action,
                ElicitationAction::Decline
            ),
            Err(ElicitationRouterError::UnknownRequest(_)) => assert!(matches!(
                request_result,
                Err(ElicitationRouterError::RequestCanceled(_))
            )),
            other => panic!("unexpected resolve result: {other:?}"),
        }
        assert!(request.closed().is_cancelled());
    }
}

#[tokio::test]
async fn bounded_request_send_can_be_canceled_without_leaking_waiter() {
    let router = ElicitationRequestRouter::default();
    let requests = router.subscribe().expect("request consumer");
    let mut tasks = Vec::new();

    for index in 0..REQUEST_BUFFER_CAPACITY {
        let request_router = router.clone();
        tasks.push(tokio::spawn(async move {
            request_router
                .request_for_test(
                    format!("server-{index}"),
                    call_scope(),
                    form_request(),
                    None,
                    CancellationToken::new(),
                )
                .await
        }));
    }
    wait_for_pending_count(&router, REQUEST_BUFFER_CAPACITY).await;

    let cancellation = CancellationToken::new();
    let request_cancellation = cancellation.clone();
    let request_router = router.clone();
    let blocked = tokio::spawn(async move {
        request_router
            .request_for_test(
                "blocked".to_string(),
                call_scope(),
                form_request(),
                None,
                request_cancellation,
            )
            .await
    });
    wait_for_pending_count(&router, REQUEST_BUFFER_CAPACITY + 1).await;
    cancellation.cancel();
    assert!(matches!(
        blocked.await.expect("blocked request task"),
        Err(ElicitationRouterError::RequestCanceled(_))
    ));

    drop(requests);
    for task in tasks {
        assert_eq!(
            task.await.expect("queued request task"),
            Err(ElicitationRouterError::NoRequestConsumer)
        );
    }
    assert_eq!(router.pending_count(), 0);
}

async fn wait_for_pending_count(router: &ElicitationRequestRouter, expected: usize) {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while router.pending_count() != expected {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("pending count should converge");
}
