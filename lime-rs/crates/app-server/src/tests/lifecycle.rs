use super::*;

#[test]
fn default_control_socket_startup_lock_does_not_repeat_control_directory() {
    let base_dir = Path::new("state");
    let socket_path = app_server_transport::app_server_control_socket_path(base_dir);

    assert_eq!(
        startup_lock_path_for_socket(&socket_path),
        app_server_startup_lock_path(base_dir)
    );
}

#[tokio::test]
async fn business_methods_require_initialized_notification() {
    let server = AppServer::new();

    let blocked_cases = [
        (1, METHOD_THREAD_START, json!({ "appId": "content-studio" })),
        (
            2,
            app_server_protocol::METHOD_WORKSPACE_UPDATE,
            json!({ "id": "workspace-main", "name": "Main" }),
        ),
        (
            3,
            app_server_protocol::METHOD_WORKSPACE_DELETE,
            json!({ "id": "workspace-main", "deleteDirectory": false }),
        ),
    ];

    for (id, method, params) in blocked_cases {
        let response = server
            .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
                RequestId::Integer(id),
                method,
                Some(params),
            )))
            .await
            .expect("handle")
            .remove(0);

        match response {
            JsonRpcMessage::Error(error) => {
                assert_eq!(error.error.code, error_codes::NOT_INITIALIZED);
            }
            other => panic!("expected error for {method}, got {other:?}"),
        }
    }

    initialize(&server).await;

    let workspace_cases = [
        (
            4,
            app_server_protocol::METHOD_WORKSPACE_UPDATE,
            json!({ "id": "workspace-main", "name": "Main" }),
            "workspace/update is not available without an app data source",
        ),
        (
            5,
            app_server_protocol::METHOD_WORKSPACE_DELETE,
            json!({ "id": "workspace-main", "deleteDirectory": false }),
            "workspace/delete is not available without an app data source",
        ),
    ];

    for (id, method, params, message) in workspace_cases {
        let response = server
            .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
                RequestId::Integer(id),
                method,
                Some(params),
            )))
            .await
            .expect("handle")
            .remove(0);

        match response {
            JsonRpcMessage::Error(error) => {
                assert_eq!(error.error.code, error_codes::RUNTIME_ERROR);
                assert_eq!(error.error.message, message);
            }
            other => panic!("expected runtime error for {method}, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn mcp_event_stream_is_gated_by_connection_experimental_capability() {
    let initialize = |id: i64, experimental_api: bool| {
        JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(id),
            METHOD_INITIALIZE,
            Some(
                serde_json::to_value(InitializeParams {
                    client_info: ClientInfo {
                        name: "mcp-event-test".to_string(),
                        title: None,
                        version: Some("test".to_string()),
                    },
                    capabilities: ClientCapabilities {
                        event_methods: Vec::new(),
                        experimental_api,
                        opt_out_notification_methods: None,
                    },
                })
                .expect("initialize params"),
            ),
        ))
    };
    let event_request = || {
        JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(2),
            app_server_protocol::protocol::v2::METHOD_MCP_SERVER_EVENT_STREAM_START,
            Some(json!({
                "threadId": "thread_1",
                "server": "lime_apps",
                "subscriptionId": "subscription_1",
                "name": "updates",
                "arguments": {}
            })),
        ))
    };

    let denied_server = AppServer::new();
    let denied = denied_server
        .handle_transport_message(ConnectionId(101), initialize(1, false))
        .await
        .expect("initialize without experimental API");
    assert!(matches!(denied.first(), Some(JsonRpcMessage::Response(_))));
    denied_server
        .handle_transport_message(
            ConnectionId(101),
            JsonRpcMessage::Notification(JsonRpcNotification::new(
                METHOD_INITIALIZED,
                Some(json!({})),
            )),
        )
        .await
        .expect("initialized notification without experimental API");
    let denied = denied_server
        .handle_transport_message(ConnectionId(101), event_request())
        .await
        .expect("event stream gate response");
    let JsonRpcMessage::Error(error) = &denied[0] else {
        panic!("expected experimental API gate error, got {denied:?}");
    };
    assert_eq!(error.error.code, error_codes::INVALID_REQUEST);

    let allowed_server = AppServer::new();
    let allowed = allowed_server
        .handle_transport_message(ConnectionId(102), initialize(1, true))
        .await
        .expect("initialize with experimental API");
    assert!(matches!(allowed.first(), Some(JsonRpcMessage::Response(_))));
    allowed_server
        .handle_transport_message(
            ConnectionId(102),
            JsonRpcMessage::Notification(JsonRpcNotification::new(
                METHOD_INITIALIZED,
                Some(json!({})),
            )),
        )
        .await
        .expect("initialized notification with experimental API");
    let allowed = allowed_server
        .handle_transport_message(ConnectionId(102), event_request())
        .await
        .expect("experimental event stream request");
    let JsonRpcMessage::Error(error) = &allowed[0] else {
        panic!("expected thread subscription validation error, got {allowed:?}");
    };
    assert_eq!(error.error.code, error_codes::INVALID_REQUEST);
    assert!(error.error.message.contains("not subscribed to thread"));
}

#[tokio::test]
async fn session_and_turn_flow_runs_on_mock_runtime() {
    let (_temp, server) = server_with_projection_store();
    initialize(&server).await;

    let session_response = request(
        &server,
        2,
        METHOD_THREAD_START,
        json!({ "model": "gpt-4.1-mini", "modelProvider": "openai" }),
    )
    .await;
    let thread_id = session_response["thread"]["id"]
        .as_str()
        .expect("thread id")
        .to_string();
    let session_id = session_response["thread"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();

    let turn_response = request(
        &server,
        3,
        METHOD_TURN_START,
        json!({
            "threadId": thread_id,
            "input": [{"type": "text", "text": "生成草稿"}]
        }),
    )
    .await;

    assert_eq!(turn_response["turn"]["id"].as_str().is_some(), true);
    assert_eq!(turn_response["turn"]["status"], "inProgress");

    let events = server
        .runtime()
        .events_for_session(&session_id)
        .expect("stored events");
    assert_eq!(
        events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "world_state",
            "item.started",
            "message.created",
            "item.completed",
            "turn.accepted"
        ]
    );
}

#[tokio::test]
async fn session_start_rejects_duplicate_caller_supplied_session_id() {
    let server = AppServer::new();
    initialize(&server).await;
    let params = json!({
        "sessionId": "sess_external",
        "threadId": "thread_external",
        "appId": "content-studio",
        "workspaceId": "default"
    });
    let messages = server
        .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_THREAD_START,
            Some(params),
        )))
        .await
        .expect("handle");

    match messages.first().expect("error response") {
        JsonRpcMessage::Error(error) => {
            assert_eq!(error.error.code, error_codes::INVALID_PARAMS);
            assert!(!error.error.message.is_empty());
        }
        other => panic!("expected current v2 contract rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn capability_list_flows_through_json_rpc_router_with_scoped_inventory_source() {
    let runtime = AppServerRuntimeFactory::mock_runtime_core_with_capability_source(Arc::new(
        CapabilityInventorySource::new(vec![
            CapabilityInventoryRecord::new(CapabilityDescriptor {
                id: "global.agent.session".to_string(),
                title: "Global Agent Session".to_string(),
                description: None,
                methods: vec![METHOD_THREAD_START.to_string()],
            }),
            CapabilityInventoryRecord::new(CapabilityDescriptor {
                id: "content.draft.generate".to_string(),
                title: "Generate Draft".to_string(),
                description: Some("Content Studio draft capability".to_string()),
                methods: vec![METHOD_TURN_START.to_string()],
            })
            .for_apps(["content-studio"])
            .for_workspaces(["default"]),
            CapabilityInventoryRecord::new(CapabilityDescriptor {
                id: "other.private".to_string(),
                title: "Other Private".to_string(),
                description: None,
                methods: vec!["other/method".to_string()],
            })
            .for_apps(["other-app"]),
        ]),
    ));
    let server = AppServer::with_runtime(runtime);
    initialize(&server).await;

    let response = request(
        &server,
        2,
        METHOD_CAPABILITY_LIST,
        json!({
            "appId": "content-studio",
            "workspaceId": "default",
            "limit": 1
        }),
    )
    .await;

    let capabilities = response["capabilities"].as_array().expect("capabilities");
    let ids: Vec<&str> = capabilities
        .iter()
        .map(|capability| capability["id"].as_str().expect("id"))
        .collect();
    assert_eq!(ids, vec!["global.agent.session"]);
    assert_eq!(response["nextCursor"].as_str().expect("next cursor"), "1");

    let next_response = request(
        &server,
        3,
        METHOD_CAPABILITY_LIST,
        json!({
            "appId": "content-studio",
            "workspaceId": "default",
            "cursor": response["nextCursor"].as_str().expect("next cursor"),
            "limit": 1
        }),
    )
    .await;
    let next_capabilities = next_response["capabilities"]
        .as_array()
        .expect("next capabilities");
    assert_eq!(next_capabilities[0]["id"], "content.draft.generate");
    assert_eq!(next_capabilities[0]["methods"][0], METHOD_TURN_START);
    assert!(next_response.get("nextCursor").is_none());
}

#[tokio::test]
async fn capability_list_with_session_id_uses_stored_session_scope() {
    let server = AppServer::new();
    initialize(&server).await;
    let messages = server
        .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_CAPABILITY_LIST,
            Some(json!({ "sessionId": "sess_capability_scope" })),
        )))
        .await
        .expect("current v2 contract response");
    match messages.first().expect("error response") {
        JsonRpcMessage::Error(error) => {
            assert_eq!(error.error.code, error_codes::SESSION_NOT_FOUND);
        }
        other => panic!("expected current v2 contract rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn turn_start_rejects_legacy_session_shape_before_runtime_dispatch() {
    let server = AppServer::new();
    initialize(&server).await;
    let messages = server
        .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(2),
            METHOD_TURN_START,
            Some(json!({
                "sessionId": "sess_denied",
                "input": {
                    "text": "draft"
                },
                "runtimeOptions": {
                    "capabilityId": "content.draft.generate"
                }
            })),
        )))
        .await
        .expect("turn start");

    match messages.first().expect("error response") {
        JsonRpcMessage::Error(error) => {
            assert_eq!(error.error.code, error_codes::INVALID_PARAMS);
            assert!(error.error.message.contains("threadId"));
        }
        other => panic!("expected current v2 contract rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn turn_start_steers_parallel_input_into_active_turn() {
    let backend = Arc::new(ActiveTurnBackend::default());
    let temp = tempfile::tempdir().expect("projection tempdir");
    let store = ProjectionStore::initialize(temp.path().join("projection.sqlite"))
        .expect("projection store");
    let runtime = RuntimeCore::with_backend(backend.clone()).with_projection_store(Arc::new(store));
    let server = AppServer::with_runtime(runtime);
    initialize(&server).await;
    let thread = request(
        &server,
        2,
        METHOD_THREAD_START,
        json!({
            "model": "gpt-4.1-mini",
            "modelProvider": "openai"
        }),
    )
    .await;
    let thread_id = thread["thread"]["id"].as_str().expect("thread id");
    let session_id = thread["thread"]["sessionId"].as_str().expect("session id");
    let first = request(
        &server,
        3,
        METHOD_TURN_START,
        json!({
            "threadId": thread_id,
            "input": [{"type": "text", "text": "running"}]
        }),
    )
    .await;
    let active_turn_id = first["turn"]["id"].as_str().expect("active turn id");
    backend.wait_until_started().await;

    let messages = server
        .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(4),
            METHOD_TURN_START,
            Some(json!({
                "threadId": thread_id,
                "clientUserMessageId": "client-parallel-1",
                "input": [{"type": "text", "text": "parallel"}]
            })),
        )))
        .await
        .expect("parallel turn start");

    let response = messages
        .iter()
        .find_map(|message| match message {
            JsonRpcMessage::Response(response) => Some(response),
            _ => None,
        })
        .unwrap_or_else(|| panic!("expected active turn response, got {messages:?}"));
    assert_eq!(response.result["turn"]["id"], active_turn_id);

    let events = server
        .runtime()
        .events_for_session(session_id)
        .expect("stored events");
    let steer_event = events
        .iter()
        .find(|event| {
            event.event_type == "message.created" && event.payload["source"] == "session_steer"
        })
        .expect("session steer event");
    assert_eq!(steer_event.event_type, "message.created");
    assert_eq!(steer_event.payload["itemId"], "steer-client-parallel-1");
    assert_eq!(steer_event.payload["clientId"], "client-parallel-1");
    assert_eq!(steer_event.payload["content"]["text"], "parallel");

    let read = request(
        &server,
        5,
        METHOD_THREAD_READ,
        json!({ "threadId": thread_id, "includeTurns": true }),
    )
    .await;
    let turns = read["thread"]["turns"].as_array().expect("turns");
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0]["id"], active_turn_id);
    backend.release.notify_one();
}

#[tokio::test]
async fn turn_start_returns_response_and_event_notification() {
    let (_temp, server) = server_with_projection_store();
    initialize(&server).await;

    let session_response = request(
        &server,
        2,
        METHOD_THREAD_START,
        json!({ "model": "gpt-4.1-mini", "modelProvider": "openai" }),
    )
    .await;
    let thread_id = session_response["thread"]["id"]
        .as_str()
        .expect("thread id")
        .to_string();

    let messages = server
        .handle_message(JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(3),
            METHOD_TURN_START,
            Some(json!({
                "threadId": thread_id,
                "input": [{"type": "text", "text": "生成草稿"}]
            })),
        )))
        .await
        .expect("handle");

    let [JsonRpcMessage::Response(response)] = messages.as_slice() else {
        panic!("expected current v2 turn response, got {messages:?}");
    };
    assert_eq!(response.result["turn"]["status"], "inProgress");
    assert!(response.result["turn"]["id"].as_str().is_some());
}
