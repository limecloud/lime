use super::*;

#[test]
fn initialized_requests_spawn_transport_tasks_without_racing_initialize() {
    assert!(should_spawn_transport_request(&JsonRpcMessage::Request(
        JsonRpcRequest::new(RequestId::Integer(1), METHOD_MEDIA_READ, Some(json!({})),),
    )));
    assert!(should_spawn_transport_request(&JsonRpcMessage::Request(
        JsonRpcRequest::new(RequestId::Integer(2), METHOD_TURN_START, Some(json!({})),),
    )));
    assert!(should_spawn_transport_request(&JsonRpcMessage::Request(
        JsonRpcRequest::new(RequestId::Integer(3), METHOD_THREAD_START, Some(json!({}))),
    )));
    assert!(!should_spawn_transport_request(&JsonRpcMessage::Request(
        JsonRpcRequest::new(RequestId::Integer(4), METHOD_INITIALIZE, Some(json!({}))),
    )));
    assert!(!should_spawn_transport_request(
        &JsonRpcMessage::Notification(JsonRpcNotification::new(
            METHOD_INITIALIZED,
            Some(json!({})),
        )),
    ));
}

#[tokio::test]
async fn slow_websocket_broadcast_cancels_connection_when_outbound_queue_is_full() {
    let server = AppServer::new();
    let (writer, mut queued) = mpsc::channel(1);
    let first = JsonRpcMessage::Notification(JsonRpcNotification::new(
        "thread/status/changed",
        Some(json!({ "status": "busy" })),
    ));
    writer
        .send(QueuedOutgoingMessage::new(OutgoingMessage::from(
            first.clone(),
        )))
        .await
        .expect("fill websocket queue");
    let disconnect_sender = CancellationToken::new();
    server.register_transport_writer(ConnectionId(99), writer, Some(disconnect_sender.clone()));
    server.mark_transport_initialized(ConnectionId(99));

    enqueue_transport_outbound_message(
        &server.transport_writers,
        &server.transport_disconnects,
        &server.transport_initialized,
        &server.transport_notification_opt_out,
        JsonRpcMessage::Notification(JsonRpcNotification::new(
            "thread/status/changed",
            Some(json!({ "status": "idle" })),
        )),
    );

    assert!(disconnect_sender.is_cancelled());
    let queued_message = queued.try_recv().expect("original queued message");
    assert_eq!(queued_message.message.into_json_rpc_message(), first);
}

#[tokio::test]
async fn broadcast_notifications_wait_for_connection_initialize() {
    let server = AppServer::new();
    let (writer, mut queued) = mpsc::channel(4);
    let connection_id = ConnectionId(100);
    server.register_transport_writer(connection_id, writer, None);
    let notification = JsonRpcMessage::Notification(JsonRpcNotification::new(
        "thread/status/changed",
        Some(json!({ "status": "busy" })),
    ));

    enqueue_transport_outbound_message(
        &server.transport_writers,
        &server.transport_disconnects,
        &server.transport_initialized,
        &server.transport_notification_opt_out,
        notification.clone(),
    );
    assert!(matches!(
        queued.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));

    server.mark_transport_initialized(connection_id);
    enqueue_transport_outbound_message(
        &server.transport_writers,
        &server.transport_disconnects,
        &server.transport_initialized,
        &server.transport_notification_opt_out,
        notification.clone(),
    );
    let queued_message = queued.recv().await.expect("initialized notification");
    assert_eq!(queued_message.message.into_json_rpc_message(), notification);
}

#[tokio::test]
async fn broadcast_notifications_respect_connection_opt_out_methods() {
    let server = AppServer::new();
    let (writer, mut queued) = mpsc::channel(4);
    let connection_id = ConnectionId(101);
    server.register_transport_writer(connection_id, writer, None);
    server.set_transport_notification_opt_out(
        connection_id,
        Some(vec!["thread/status/changed".to_string()]),
    );
    server.mark_transport_initialized(connection_id);

    enqueue_transport_outbound_message(
        &server.transport_writers,
        &server.transport_disconnects,
        &server.transport_initialized,
        &server.transport_notification_opt_out,
        JsonRpcMessage::Notification(JsonRpcNotification::new(
            "thread/status/changed",
            Some(json!({ "status": "busy" })),
        )),
    );
    assert!(matches!(
        queued.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));

    enqueue_transport_outbound_message(
        &server.transport_writers,
        &server.transport_disconnects,
        &server.transport_initialized,
        &server.transport_notification_opt_out,
        JsonRpcMessage::Notification(JsonRpcNotification::new(
            "thread/started",
            Some(json!({ "threadId": "thread-1" })),
        )),
    );
    assert!(queued.recv().await.is_some());
}

#[tokio::test]
async fn experimental_notifications_only_reach_capable_connections() {
    use app_server_protocol::protocol::v2;

    let server = AppServer::new();
    let enabled_connection = ConnectionId(102);
    let disabled_connection = ConnectionId(103);
    let (enabled_writer, mut enabled_messages) = mpsc::channel(4);
    let (disabled_writer, mut disabled_messages) = mpsc::channel(4);
    server.register_transport_writer(enabled_connection, enabled_writer, None);
    server.register_transport_writer(disabled_connection, disabled_writer, None);
    server.mark_transport_initialized(enabled_connection);
    server.mark_transport_initialized(disabled_connection);
    server
        .transport_experimental_api
        .lock()
        .expect("app-server transport experimental capability mutex poisoned")
        .insert(enabled_connection);

    let notifications = [
        v2::ServerNotification::ThreadQueueChanged(v2::ThreadQueueChangedNotification {
            thread_id: "thread-experimental".to_string(),
        }),
        v2::ServerNotification::ProjectChanged(v2::ProjectChangedNotification {
            project_id: "project-experimental".to_string(),
            change_type: v2::ProjectChangeType::Created,
        }),
        v2::ServerNotification::ThreadProjectUpdated(v2::ThreadProjectUpdatedNotification {
            thread_id: "thread-experimental".to_string(),
            project_id: Some("project-experimental".to_string()),
        }),
        v2::ServerNotification::StrictReviewRequired(v2::StrictReviewRequiredNotification {
            thread_id: "thread-experimental".to_string(),
            turn_id: "turn-strict".to_string(),
            started_at_ms: 1_783_814_400_100,
        }),
    ];

    for notification in notifications {
        let expected_method = notification.method();
        server
            .processor
            .publish_server_notification(notification)
            .await;
        let message = enabled_messages
            .recv()
            .await
            .expect("experimental-capable connection notification")
            .message
            .into_json_rpc_message();
        let JsonRpcMessage::Notification(message) = message else {
            panic!("expected notification for {expected_method}");
        };
        assert_eq!(message.method, expected_method);
        assert!(matches!(
            disabled_messages.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }
}

#[test]
fn experimental_method_gate_matches_current_host_surface() {
    use app_server_protocol::protocol::v2;

    for method in [
        v2::METHOD_THREAD_INCREMENT_ELICITATION,
        v2::METHOD_THREAD_DECREMENT_ELICITATION,
        v2::METHOD_THREAD_TURNS_LIST,
        v2::METHOD_THREAD_ITEMS_LIST,
        v2::METHOD_THREAD_SEARCH,
        v2::METHOD_THREAD_SEARCH_OCCURRENCES,
        v2::METHOD_THREAD_REVERT,
        v2::METHOD_THREAD_SETTINGS_UPDATE,
        v2::METHOD_THREAD_MEMORY_MODE_SET,
        v2::METHOD_MEMORY_RESET,
        v2::METHOD_THREAD_BACKGROUND_TERMINALS_CLEAN,
        v2::METHOD_THREAD_BACKGROUND_TERMINALS_LIST,
        v2::METHOD_THREAD_BACKGROUND_TERMINALS_TERMINATE,
        v2::METHOD_PLUGIN_SEARCH,
        v2::METHOD_COLLABORATION_MODE_LIST,
        v2::METHOD_MCP_SERVER_EVENT_STREAM_START,
        v2::METHOD_MCP_SERVER_EVENT_STREAM_STOP,
        v2::METHOD_ENVIRONMENT_ADD,
        v2::METHOD_ENVIRONMENT_INFO,
        v2::METHOD_ENVIRONMENT_STATUS,
        v2::METHOD_THREAD_QUEUE_ADD,
        v2::METHOD_THREAD_QUEUE_LIST,
        v2::METHOD_THREAD_QUEUE_UPDATE,
        v2::METHOD_THREAD_QUEUE_DELETE,
        v2::METHOD_THREAD_QUEUE_REORDER,
        v2::METHOD_THREAD_QUEUE_START,
        v2::METHOD_PROJECT_LIST,
        v2::METHOD_PROJECT_READ,
        v2::METHOD_PROJECT_CREATE,
        v2::METHOD_PROJECT_IMPORT,
        v2::METHOD_PROJECT_UPDATE,
        v2::METHOD_PROJECT_MOVE,
        v2::METHOD_PROJECT_DELETE,
        v2::METHOD_PROCESS_SPAWN,
        v2::METHOD_PROCESS_WRITE_STDIN,
        v2::METHOD_PROCESS_RESIZE_PTY,
        v2::METHOD_PROCESS_KILL,
    ] {
        assert!(
            is_experimental_api_method(method),
            "expected {method} to require experimentalApi"
        );
    }

    for method in [
        METHOD_INITIALIZE,
        METHOD_THREAD_START,
        METHOD_TURN_START,
        v2::METHOD_PROMPT_HISTORY_READ,
        v2::METHOD_PROMPT_HISTORY_APPEND,
    ] {
        assert!(
            !is_experimental_api_method(method),
            "expected stable method {method} to remain available"
        );
    }

    for method in [
        v2::METHOD_THREAD_QUEUE_CHANGED,
        v2::METHOD_PROJECT_CHANGED,
        v2::METHOD_THREAD_PROJECT_UPDATED,
        v2::METHOD_THREAD_ENVIRONMENT_CONNECTED,
        v2::METHOD_THREAD_ENVIRONMENT_DISCONNECTED,
        v2::METHOD_THREAD_SETTINGS_UPDATED,
        v2::METHOD_STRICT_REVIEW_REQUIRED,
        v2::METHOD_PROCESS_OUTPUT_DELTA,
        v2::METHOD_PROCESS_EXITED,
        v2::METHOD_MCP_SERVER_EVENT_STREAM_NOTIFICATION,
        v2::METHOD_TURN_MODERATION_METADATA,
    ] {
        assert!(
            notification_requires_experimental_api(&JsonRpcMessage::Notification(
                JsonRpcNotification::new(method, None),
            )),
            "expected {method} notification to require experimentalApi"
        );
    }
    assert!(!notification_requires_experimental_api(
        &JsonRpcMessage::Notification(JsonRpcNotification::new(v2::METHOD_WARNING, None,))
    ));
}

#[test]
fn project_thread_fields_report_exact_experimental_reasons() {
    for (method, params, expected) in [
        (
            app_server_protocol::protocol::v2::METHOD_THREAD_START,
            json!({"projectId": "project-1"}),
            Some("thread/start.projectId"),
        ),
        (
            app_server_protocol::protocol::v2::METHOD_THREAD_METADATA_UPDATE,
            json!({"threadId": "thread-1", "projectId": ""}),
            Some("thread/metadata/update.projectId"),
        ),
        (
            app_server_protocol::protocol::v2::METHOD_THREAD_LIST,
            json!({"projectId": null}),
            Some("thread/list.projectId"),
        ),
        (
            app_server_protocol::protocol::v2::METHOD_THREAD_START,
            json!({"projectId": null}),
            None,
        ),
        (
            app_server_protocol::protocol::v2::METHOD_THREAD_LIST,
            json!({}),
            None,
        ),
    ] {
        let request = JsonRpcRequest::new(RequestId::Integer(1), method, Some(params));
        assert_eq!(experimental_api_field_reason(&request), expected);
    }
}

#[tokio::test]
async fn model_list_updated_broadcast_reaches_initialized_subscribers_only() {
    let server = AppServer::new();
    let subscribed_a = ConnectionId(110);
    let subscribed_b = ConnectionId(111);
    let opted_out = ConnectionId(112);
    let uninitialized = ConnectionId(113);
    let (writer_a, mut messages_a) = mpsc::channel(4);
    let (writer_b, mut messages_b) = mpsc::channel(4);
    let (writer_opted_out, mut messages_opted_out) = mpsc::channel(4);
    let (writer_uninitialized, mut messages_uninitialized) = mpsc::channel(4);
    server.register_transport_writer(subscribed_a, writer_a, None);
    server.register_transport_writer(subscribed_b, writer_b, None);
    server.register_transport_writer(opted_out, writer_opted_out, None);
    server.register_transport_writer(uninitialized, writer_uninitialized, None);
    server.mark_transport_initialized(subscribed_a);
    server.mark_transport_initialized(subscribed_b);
    server.set_transport_notification_opt_out(
        opted_out,
        Some(vec![
            app_server_protocol::protocol::v2::METHOD_MODEL_LIST_UPDATED.to_string(),
        ]),
    );
    server.mark_transport_initialized(opted_out);
    let mut outbound = server.subscribe_outbound_messages();

    server
        .processor
        .publish_server_notification(
            app_server_protocol::protocol::v2::ServerNotification::ModelListUpdated(
                app_server_protocol::protocol::v2::ModelListUpdatedNotification {
                    generation: 17,
                    provider_id: Some("openai".to_string()),
                },
            ),
        )
        .await;

    let expected = JsonRpcMessage::Notification(JsonRpcNotification::new(
        app_server_protocol::protocol::v2::METHOD_MODEL_LIST_UPDATED,
        Some(json!({ "generation": 17, "providerId": "openai" })),
    ));
    assert_eq!(
        outbound.recv().await.expect("in-process notification"),
        expected
    );
    assert_eq!(
        messages_a
            .recv()
            .await
            .expect("first subscribed notification")
            .message
            .into_json_rpc_message(),
        expected
    );
    assert_eq!(
        messages_b
            .recv()
            .await
            .expect("second subscribed notification")
            .message
            .into_json_rpc_message(),
        expected
    );
    assert!(matches!(
        messages_opted_out.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
    assert!(matches!(
        messages_uninitialized.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));
}
