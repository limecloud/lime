use super::*;
use crate::{
    ActionRespondRequest, CancelExecutionRequest, ExecutionBackend, ExecutionRequest,
    RuntimeEventSink,
};

struct CompleteBackend;

#[async_trait::async_trait]
impl ExecutionBackend for CompleteBackend {
    async fn start_turn(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        let item_id = format!("answer-{}", request.turn.turn_id);
        sink.emit(RuntimeEvent::new("turn.started", json!({})))?;
        sink.emit(RuntimeEvent::new(
            "message.delta",
            json!({ "itemId": item_id, "text": "fork answer" }),
        ))?;
        sink.emit(RuntimeEvent::new(
            "message.completed",
            json!({ "itemId": item_id, "phase": "final_answer", "status": "completed" }),
        ))?;
        sink.emit(RuntimeEvent::new("turn.completed", json!({})))
    }

    async fn cancel_turn(
        &self,
        _: CancelExecutionRequest,
        _: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Err(RuntimeCoreError::Backend("unexpected cancel".into()))
    }

    async fn respond_action(
        &self,
        _: ActionRespondRequest,
        _: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Err(RuntimeCoreError::Backend("unexpected action".into()))
    }
}

#[tokio::test]
async fn fork_response_subscribes_target_before_first_turn_and_keeps_source_connection_isolated() {
    let temp = tempfile::TempDir::new().unwrap();
    let runtime = RuntimeCore::with_backend(Arc::new(CompleteBackend)).with_projection_store(
        Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap()),
    );
    let server = AppServer::with_runtime(runtime);
    let (transport_tx, transport_rx) = mpsc::channel(OUTBOUND_MESSAGE_CAPACITY);
    let shutdown = tokio_util::sync::CancellationToken::new();
    let runner = tokio::spawn(run_transport_events(
        server.clone(),
        transport_rx,
        false,
        shutdown.clone(),
    ));
    let source_connection = ConnectionId(701);
    let fork_connection = ConnectionId(702);
    let mut source_messages = open_initialized_connection(
        &transport_tx,
        source_connection,
        RequestId::Integer(1),
        "fork-source",
    )
    .await;
    let mut fork_messages = open_initialized_connection(
        &transport_tx,
        fork_connection,
        RequestId::Integer(2),
        "fork-target",
    )
    .await;
    send_transport_message(&transport_tx, source_connection, json!({
        "jsonrpc": "2.0", "id": 3, "method": METHOD_THREAD_START,
        "params": { "model": "fixture-model", "modelProvider": "fixture-provider", "cwd": temp.path() }
    })).await;
    let source = next_queued_response(&mut source_messages, RequestId::Integer(3)).await;
    let source_id = source.result["thread"]["id"].as_str().unwrap().to_owned();
    let started = next_queued_message(&mut source_messages).await;
    assert_eq!(notification_method(&started), Some("thread/started"));
    send_transport_message(&transport_tx, fork_connection, json!({
        "jsonrpc": "2.0", "id": 4, "method": app_server_protocol::protocol::v2::METHOD_THREAD_FORK,
        "params": { "threadId": source_id, "excludeTurns": true, "deferGoalContinuation": true }
    })).await;
    let JsonRpcMessage::Response(fork) = next_queued_message(&mut fork_messages).await else {
        panic!("fork response must precede its notifications");
    };
    assert_eq!(fork.id, RequestId::Integer(4));
    let target_id = fork.result["thread"]["id"].as_str().unwrap().to_owned();
    assert_ne!(target_id, source_id);
    assert_eq!(fork.result["thread"]["forkedFromId"], source_id);
    assert_eq!(
        server
            .thread_states
            .subscribed_connection_ids(&agent_protocol::ThreadId::new(&target_id))
            .await,
        vec![fork_connection]
    );
    assert_eq!(
        server
            .thread_states
            .subscribed_connection_ids(&agent_protocol::ThreadId::new(&source_id))
            .await,
        vec![source_connection]
    );
    let started = next_queued_message(&mut fork_messages).await;
    assert_eq!(notification_method(&started), Some("thread/started"));
    send_transport_message(&transport_tx, fork_connection, json!({
        "jsonrpc": "2.0", "id": 5, "method": METHOD_TURN_START,
        "params": { "threadId": target_id, "input": [{ "type": "text", "text": "continue fork" }] }
    })).await;
    let mut response_turn_id = None;
    let mut completed_turn_id = None;
    let mut answer_visible = false;
    for _ in 0..20 {
        match next_queued_message(&mut fork_messages).await {
            JsonRpcMessage::Response(response) if response.id == RequestId::Integer(5) => {
                response_turn_id = response.result["turn"]["id"].as_str().map(str::to_owned);
            }
            JsonRpcMessage::Notification(notification) => {
                let params = notification.params.unwrap();
                if notification.method.starts_with("turn/")
                    || notification.method.starts_with("item/")
                {
                    assert_eq!(params["threadId"], target_id);
                }
                if notification.method == "item/agentMessage/delta" {
                    answer_visible |= params["delta"] == "fork answer";
                }
                if notification.method == "turn/completed" {
                    assert_eq!(params["turn"]["status"], "completed");
                    completed_turn_id = params["turn"]["id"].as_str().map(str::to_owned);
                }
            }
            JsonRpcMessage::Error(error) => panic!("fork Turn failed: {error:?}"),
            other => panic!("unexpected fork message: {other:?}"),
        }
        if response_turn_id.is_some() && completed_turn_id.is_some() {
            break;
        }
    }
    assert!(answer_visible);
    assert!(response_turn_id.is_some());
    assert_eq!(completed_turn_id, response_turn_id);
    assert!(matches!(
        source_messages.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
    shutdown.cancel();
    drop(transport_tx);
    timeout(Duration::from_secs(2), runner)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}
