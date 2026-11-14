use super::*;
use crate::{run_transport_events, ProjectionStore, RuntimeCore};
use app_server_protocol::RequestId;
use app_server_transport::{start_websocket_acceptor, ConnectionId};
use futures::{SinkExt, StreamExt};
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio::{net::TcpStream, sync::mpsc, time::timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

struct Client(WebSocketStream<MaybeTlsStream<TcpStream>>);

impl Client {
    async fn connect(url: &str) -> Self {
        let (socket, _) = connect_async(url).await.unwrap();
        let mut client = Self(socket);
        // Identical names deliberately cannot establish tool execution authority.
        assert!(client
            .request(
                1,
                "initialize",
                json!({
                    "clientInfo": {"name": "desktop", "version": "1"},
                    "capabilities": {"experimentalApi": true}
                })
            )
            .await
            .get("result")
            .is_some());
        client.send(json!({"method":"initialized"})).await;
        client
    }

    async fn send(&mut self, value: Value) {
        self.0
            .send(Message::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    async fn next(&mut self) -> Value {
        timeout(Duration::from_secs(5), async {
            loop {
                if let Message::Text(text) = self.0.next().await.unwrap().unwrap() {
                    return serde_json::from_str(text.as_str()).unwrap();
                }
            }
        })
        .await
        .expect("dynamic host wire message deadline")
    }

    async fn request(&mut self, id: i64, method: &str, params: Value) -> Value {
        self.send(json!({"id":id,"method":method,"params":params}))
            .await;
        loop {
            let message = self.next().await;
            if message.get("id") == Some(&json!(id)) {
                return message;
            }
            assert_ne!(
                message.get("method"),
                Some(&json!(METHOD_ITEM_TOOL_CALL)),
                "an observer must not receive tool execution requests: {message}"
            );
        }
    }

    async fn tool_request(&mut self) -> Value {
        loop {
            let message = self.next().await;
            if message.get("method") == Some(&json!(METHOD_ITEM_TOOL_CALL)) {
                return message;
            }
        }
    }
}

fn tools() -> Value {
    json!([{"type":"namespace","name":"desktop","description":"Desktop", "tools":[{
        "type":"function","name":"appInfo","description":"Read app info",
        "inputSchema":{"type":"object","additionalProperties":false}
    }]}])
}

fn call(thread_id: &str) -> DynamicToolCallParams {
    DynamicToolCallParams {
        thread_id: thread_id.into(),
        turn_id: "turn-1".into(),
        call_id: "call-1".into(),
        namespace: Some("desktop".into()),
        tool: "appInfo".into(),
        arguments: json!({}),
        phase: DynamicToolCallPhase::Preflight,
        approval_token: None,
    }
}

#[tokio::test]
async fn dynamic_tool_host_resume_barrier_precedes_first_execution_request() {
    use crate::thread_state::{ThreadListenerCommand, ThreadResumeBarrier};
    let server = AppServer::new();
    let connection_id = ConnectionId(1);
    let thread = agent_protocol::ThreadId::new("thread-1");
    let (writer, mut receiver) = mpsc::channel(16);
    server.register_transport_writer(connection_id, writer, None);
    server.mark_transport_initialized(connection_id);
    server
        .thread_states
        .connection_initialized(connection_id)
        .await;
    server
        .thread_states
        .bind_dynamic_tool_host(
            thread.clone(),
            connection_id,
            std::collections::HashSet::from([(Some("desktop".into()), "appInfo".into())]),
            false,
        )
        .await
        .unwrap();
    let barrier = ThreadResumeBarrier::new(connection_id, RequestId::Integer(77));
    server
        .event_bridge()
        .prepare_thread_resume(thread.clone(), barrier.clone())
        .await
        .unwrap();
    let requesting = server.clone();
    let pending = tokio::spawn(async move {
        requesting
            .begin_dynamic_tool_request(call("thread-1"))
            .await
    });
    timeout(Duration::from_secs(2), async {
        while server.server_requests.pending_count() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        receiver.try_recv().is_err(),
        "host must observe its resume result before any execution request"
    );
    let response =
        app_server_protocol::JsonRpcMessage::Response(app_server_protocol::JsonRpcResponse {
            id: RequestId::Integer(77),
            result: json!({"thread":{"id":"thread-1"}}),
        });
    let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
    server
        .event_bridge()
        .send_thread_command(
            thread,
            ThreadListenerCommand::CompleteResume {
                barrier,
                connection_id,
                messages: vec![response.clone()],
                subscribe: true,
                completion_tx,
            },
        )
        .await
        .unwrap();
    timeout(Duration::from_secs(5), completion_rx)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let pending = timeout(Duration::from_secs(5), pending)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        timeout(Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap()
            .message
            .into_json_rpc_message(),
        response
    );
    assert_eq!(
        timeout(Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap()
            .message
            .into_json_rpc_message(),
        app_server_protocol::JsonRpcMessage::Request(pending.request().clone())
    );
    assert!(
        receiver.try_recv().is_err(),
        "first dispatch must not also be replayed by resume snapshot"
    );
}

#[test]
fn dynamic_tool_host_pending_execution_is_not_a_resumable_prompt() {
    use crate::server_request::{ServerRequestOwner, ServerRequestRouter};
    let router = ServerRequestRouter::default();
    let owner = ServerRequestOwner::Transport(ConnectionId(1));
    let pending = router.register_for_owner(
        owner,
        METHOD_ITEM_TOOL_CALL,
        Some(serde_json::to_value(call("thread-1")).unwrap()),
    );
    assert!(
        router
            .snapshot_for_owner_thread(owner, "thread-1")
            .is_empty(),
        "resuming the same host must not replay an execution request"
    );
    assert_eq!(router.pending_count(), 1);
    drop(pending);
    assert_eq!(router.pending_count(), 0);
}

#[tokio::test]
async fn dynamic_tool_host_wire_routes_one_owner_and_rebinds_only_after_disconnect() {
    let temp = tempfile::tempdir().unwrap();
    let server = AppServer::with_runtime(RuntimeCore::default().with_projection_store(Arc::new(
        ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
    )));
    let shutdown = CancellationToken::new();
    let (events_tx, events_rx) = mpsc::channel(64);
    let (address, acceptor) = start_websocket_acceptor(
        "127.0.0.1:0".parse().unwrap(),
        events_tx,
        shutdown.clone(),
        Default::default(),
    )
    .await
    .unwrap();
    let runner = tokio::spawn(run_transport_events(
        server.clone(),
        events_rx,
        false,
        shutdown.clone(),
    ));
    let url = format!("ws://{address}");
    let mut owner = Client::connect(&url).await;
    let mut observer = Client::connect(&url).await;
    let started = owner.request(2,"thread/start",json!({
        "model":"fixture", "modelProvider":"fixture", "cwd":temp.path(), "dynamicTools":tools()
    })).await;
    let thread_id = started
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("thread/start: {started}"))
        .to_owned();
    let resume = json!({"threadId":thread_id,"excludeTurns":true});
    let observed = observer.request(2, "thread/resume", resume.clone()).await;
    assert!(observed.get("result").is_some(), "{observed}");
    let extra = observed.pointer("/result/thread/extra").cloned();
    let claimed = observer
        .request(
            3,
            "thread/resume",
            json!({
                "threadId":thread_id,"excludeTurns":true,"dynamicTools":tools()
            }),
        )
        .await;
    assert!(
        claimed
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap()
            .contains("already bound"),
        "{claimed}"
    );

    let mut drifted = tools();
    drifted[0]["tools"][0]["inputSchema"] =
        json!({"type":"object","properties":{"path":{"type":"string"}}});
    let rejected = owner
        .request(
            3,
            "thread/resume",
            json!({
                "threadId":thread_id,"excludeTurns":true,"dynamicTools":drifted
            }),
        )
        .await;
    assert_eq!(
        rejected.pointer("/error/code"),
        Some(&json!(app_server_protocol::error_codes::INVALID_PARAMS))
    );

    let pending = server
        .begin_dynamic_tool_request(call(&thread_id))
        .await
        .unwrap();
    let request = owner.tool_request().await;
    assert_eq!(request["params"]["threadId"], thread_id);
    // A response from an unrelated live transport cannot settle this request.
    let id: RequestId = serde_json::from_value(request["id"].clone()).unwrap();
    let owner_id = server.server_requests.current_owner(pending.id());
    let wrong = match owner_id {
        Some(crate::server_request::ServerRequestOwner::Transport(id)) => ConnectionId(id.0 + 1),
        _ => panic!("exact transport owner"),
    };
    assert!(matches!(
        server
            .server_requests
            .resolve_transport_response(wrong, id, json!({})),
        Err(crate::ServerRequestError::ClientMismatch { .. })
    ));
    owner
        .send(json!({"id":request["id"],"result":{"success":true,"contentItems":[]}}))
        .await;
    assert_eq!(
        timeout(Duration::from_secs(5), pending.wait())
            .await
            .unwrap()
            .unwrap(),
        json!({"success":true,"contentItems":[]})
    );

    let disconnected = server
        .begin_dynamic_tool_request(call(&thread_id))
        .await
        .unwrap();
    owner.tool_request().await;
    owner.0.close(None).await.unwrap();
    assert!(matches!(
        timeout(
            Duration::from_secs(5),
            server.finish_server_request::<DynamicToolCallResponse>(&thread_id, disconnected)
        )
        .await
        .unwrap(),
        Err(WaitServerRequestError::Failed(_))
    ));
    assert!(
        server
            .begin_dynamic_tool_request(call(&thread_id))
            .await
            .is_err(),
        "a sole remaining observer is not a fallback execution host"
    );

    let mut superset = tools();
    superset[0]["tools"][0]["description"] = json!("Updated host description");
    superset[0]["tools"].as_array_mut().unwrap().push(json!({
        "type":"function","name":"newTool","description":"A new capability",
        "inputSchema":{"type":"object"}
    }));
    let rebound = observer
        .request(
            4,
            "thread/resume",
            json!({
                "threadId":thread_id,"excludeTurns":true,"dynamicTools":superset
            }),
        )
        .await;
    assert!(rebound.get("result").is_some(), "{rebound}");
    assert_eq!(
        rebound.pointer("/result/thread/extra").cloned(),
        extra,
        "capability declaration must not rewrite durable frozen tool metadata"
    );
    let mut unregistered = call(&thread_id);
    unregistered.tool = "newTool".into();
    assert!(server
        .begin_dynamic_tool_request(unregistered)
        .await
        .is_err());
    let pending = server
        .begin_dynamic_tool_request(call(&thread_id))
        .await
        .unwrap();
    let request = observer.tool_request().await;
    observer
        .send(json!({"id":request["id"],"result":{"success":true,"contentItems":[]}}))
        .await;
    assert!(timeout(Duration::from_secs(5), pending.wait())
        .await
        .unwrap()
        .is_ok());
    assert_eq!(server.server_requests.pending_count(), 0);
    observer.0.close(None).await.unwrap();
    shutdown.cancel();
    timeout(Duration::from_secs(5), runner)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    acceptor.await.unwrap();
}

#[tokio::test]
async fn dynamic_tool_host_active_turn_never_transfers_preflight_to_another_connection() {
    let manager = crate::thread_state::ThreadStateManager::new();
    let thread = agent_protocol::ThreadId::new("thread");
    let tools = std::collections::HashSet::from([(Some("browser".into()), "click".into())]);
    for id in [ConnectionId(1), ConnectionId(2)] {
        manager.connection_initialized(id).await;
    }
    manager
        .bind_dynamic_tool_host(thread.clone(), ConnectionId(1), tools.clone(), false)
        .await
        .unwrap();
    manager
        .bind_dynamic_tool_host(thread.clone(), ConnectionId(1), tools.clone(), true)
        .await
        .unwrap();
    manager.disconnect_connection(ConnectionId(1)).await;
    assert!(manager
        .bind_dynamic_tool_host(thread.clone(), ConnectionId(2), tools.clone(), true)
        .await
        .is_err());
    assert!(manager
        .with_dynamic_tool_host(&thread, Some("browser"), "click", |id| id)
        .await
        .is_none());
    manager
        .bind_dynamic_tool_host(thread.clone(), ConnectionId(2), tools, false)
        .await
        .unwrap();
    assert_eq!(
        manager
            .with_dynamic_tool_host(&thread, Some("browser"), "click", |id| id)
            .await,
        Some(ConnectionId(2))
    );
    manager.remove_thread(&thread).await;
    assert!(manager
        .with_dynamic_tool_host(&thread, Some("browser"), "click", |id| id)
        .await
        .is_none());
}
