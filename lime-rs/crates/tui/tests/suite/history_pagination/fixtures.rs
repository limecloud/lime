//! Public JSON-RPC fixtures for history failure and race scenarios.

use super::*;

pub(super) async fn run_history_switch_server(
    listener: TcpListener,
    cwd: String,
    stale_released: Arc<AtomicBool>,
    history_request_seen: Arc<AtomicBool>,
) -> Result<()> {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    let mut delayed_page = None;
    let mut stale_page_released = false;
    while let Some(message) = socket.next().await {
        let Message::Text(text) = message? else {
            continue;
        };
        let JsonRpcMessage::Request(request) = app_server_transport::decode_message(&text)? else {
            continue;
        };
        let thread_id = request
            .params
            .as_ref()
            .and_then(|params| params.get("threadId"))
            .and_then(Value::as_str);
        let cursor = request
            .params
            .as_ref()
            .and_then(|params| params.get("cursor"))
            .and_then(Value::as_str);
        if request.method == "thread/items/list"
            && thread_id == Some(HISTORY_RACE_THREAD_ID)
            && cursor == Some(HISTORY_RACE_CURSOR)
        {
            history_request_seen.store(true, Ordering::SeqCst);
            delayed_page = Some(request.id);
            continue;
        }

        let result = history_race_response(&request.method, request.params.as_ref(), &cwd, false);
        send_history_result(&mut socket, request.id, result).await?;

        if request.method == "thread/turns/list" && thread_id == Some(HISTORY_RACE_TARGET_THREAD_ID)
        {
            if let Some(request_id) = delayed_page.take() {
                send_history_result(&mut socket, request_id, history_race_stale_page_response())
                    .await?;
                stale_page_released = true;
            }
        }
        if stale_page_released
            && request.method == "thread/turns/list"
            && thread_id == Some(HISTORY_RACE_THREAD_ID)
        {
            stale_released.store(true, Ordering::SeqCst);
            stale_page_released = false;
        }
    }
    Ok(())
}

pub(super) async fn run_history_reconnect_server(
    listener: TcpListener,
    cwd: String,
    old_request_seen: Arc<AtomicBool>,
) -> Result<()> {
    let mut connection_index = 0_u8;
    loop {
        let (stream, _) = listener.accept().await?;
        let mut socket = accept_async(stream).await?;
        let reconnect = connection_index > 0;
        while let Some(message) = socket.next().await {
            let Message::Text(text) = message? else {
                continue;
            };
            let JsonRpcMessage::Request(request) = app_server_transport::decode_message(&text)?
            else {
                continue;
            };
            let thread_id = request
                .params
                .as_ref()
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str);
            let cursor = request
                .params
                .as_ref()
                .and_then(|params| params.get("cursor"))
                .and_then(Value::as_str);
            if !reconnect
                && request.method == "thread/items/list"
                && thread_id == Some(HISTORY_RACE_THREAD_ID)
                && cursor == Some(HISTORY_RACE_CURSOR)
            {
                old_request_seen.store(true, Ordering::SeqCst);
                socket.close(None).await?;
                break;
            }
            let result =
                history_race_response(&request.method, request.params.as_ref(), &cwd, reconnect);
            send_history_result(&mut socket, request.id, result).await?;
        }
        connection_index = connection_index.saturating_add(1);
        if reconnect {
            return Ok(());
        }
    }
}

async fn send_history_result(
    socket: &mut WebSocketStream<TcpStream>,
    id: app_server_protocol::RequestId,
    result: Value,
) -> Result<()> {
    socket
        .send(Message::Text(app_server_transport::encode_message(
            &JsonRpcMessage::Response(JsonRpcResponse::new(id, result)?),
        )?))
        .await?;
    Ok(())
}

fn history_race_response(
    method: &str,
    params: Option<&Value>,
    cwd: &str,
    reconnect: bool,
) -> Value {
    match method {
        "initialize" => json!({
            "serverInfo": {
                "name": "app-server",
                "version": "fixture",
                "protocolVersion": app_server_protocol::PROTOCOL_VERSION
            },
            "platform": {"family": "unix", "os": "test"},
            "capabilities": {
                "agentSession": true,
                "capabilityDiscovery": true,
                "artifact": false,
                "workspace": false
            }
        }),
        "config/read" => json!({"config": {}, "origins": {}}),
        "thread/list" => json!({
            "data": [history_race_thread(HISTORY_RACE_TARGET_THREAD_ID, cwd, "race-target")],
            "nextCursor": null,
            "backwardsCursor": null
        }),
        "thread/resume" => {
            let thread_id = params
                .and_then(|value| value.get("threadId"))
                .and_then(Value::as_str)
                .unwrap_or(HISTORY_RACE_THREAD_ID);
            history_race_thread_response(
                thread_id,
                cwd,
                if reconnect {
                    "reconnected"
                } else {
                    "race-current"
                },
            )
        }
        "thread/items/list" => {
            let thread_id = params
                .and_then(|value| value.get("threadId"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if thread_id == HISTORY_RACE_TARGET_THREAD_ID {
                json!({
                    "data": [history_race_item("race-target-turn", "race-target-history", false)],
                    "nextCursor": null,
                    "backwardsCursor": null
                })
            } else if reconnect {
                json!({
                    "data": [history_race_item("race-reconnected-turn", "reconnected-history", false)],
                    "nextCursor": null,
                    "backwardsCursor": null
                })
            } else {
                json!({
                    "data": [history_race_item("race-current-turn", "race-current-history", false)],
                    "nextCursor": HISTORY_RACE_CURSOR,
                    "backwardsCursor": null
                })
            }
        }
        "thread/turns/list" => {
            let mut entries = history_race_response("thread/items/list", params, cwd, reconnect)
                ["data"]
                .as_array()
                .unwrap()
                .clone();
            if params
                .and_then(|value| value.get("threadId"))
                .and_then(Value::as_str)
                == Some(HISTORY_RACE_THREAD_ID)
            {
                entries.push(history_race_item(
                    "race-stale-turn",
                    "race-stale-history",
                    false,
                ));
            }
            history_turn_page(entries, params)
        }
        "permissionProfile/list" => json!({
            "data": [{"id": ":workspace", "description": "fixture", "allowed": true}],
            "nextCursor": null
        }),
        "model/list" => json!({"data": [], "nextCursor": null}),
        "skills/list" => json!({"data": [], "nextCursor": null}),
        "collaborationMode/list" => json!({"data": []}),
        "thread/settings/update" => json!({}),
        "promptHistory/read" => json!({
            "logId": "fixture",
            "entryCount": 0,
            "data": [],
            "nextCursor": null
        }),
        "thread/queue/list" => json!({"data": [], "nextCursor": null}),
        _ => json!({}),
    }
}

fn history_race_thread_response(thread_id: &str, cwd: &str, preview: &str) -> Value {
    json!({
        "thread": history_race_thread(thread_id, cwd, preview),
        "model": "fixture-model",
        "modelProvider": "fixture-provider",
        "cwd": cwd,
        "runtimeWorkspaceRoots": [cwd],
        "instructionSources": [],
        "approvalPolicy": "never",
        "approvalsReviewer": "user",
        "sandbox": {"type": "readOnly"},
        "activePermissionProfile": {"id": ":workspace"},
        "reasoningEffort": null,
        "multiAgentMode": "explicitRequestOnly"
    })
}

fn history_race_thread(thread_id: &str, cwd: &str, preview: &str) -> Value {
    json!({
        "id": thread_id,
        "sessionId": thread_id,
        "preview": preview,
        "ephemeral": false,
        "projectId": null,
        "historyMode": "paginated",
        "modelProvider": "fixture-provider",
        "createdAt": 1,
        "updatedAt": 2,
        "status": {"type": "idle", "activeFlags": []},
        "cwd": cwd,
        "cliVersion": "fixture",
        "source": "appServer",
        "turns": []
    })
}

fn history_race_item(turn_id: &str, text: &str, user: bool) -> Value {
    // Keep the initial viewport full so only the scenario's explicit Home action requests the
    // delayed page. Startup underfill is covered separately by the real stdio fixture.
    let display_text = if text == "race-current-history" {
        format!("{}{text}", "race viewport context\n".repeat(40))
    } else {
        text.to_string()
    };
    let item = if user {
        json!({
            "type": "userMessage",
            "id": format!("{text}-id"),
            "content": [{"type": "text", "text": display_text}]
        })
    } else {
        json!({
            "type": "agentMessage",
            "id": format!("{text}-id"),
            "text": display_text,
            "phase": "final_answer"
        })
    };
    json!({"turnId": turn_id, "item": item})
}

fn history_race_stale_page_response() -> Value {
    json!({
        "data": [history_race_item("race-stale-turn", "race-stale-history", false)],
        "nextCursor": null,
        "backwardsCursor": null
    })
}

pub(super) async fn run_history_failure_server(
    listener: TcpListener,
    failed_once: Arc<AtomicBool>,
    turn_enrichment_failed: Arc<AtomicBool>,
    fail_turn_metadata: bool,
) -> Result<()> {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    let mut older_page_requested = false;
    while let Some(message) = socket.next().await {
        let Message::Text(text) = message? else {
            continue;
        };
        let JsonRpcMessage::Request(request) = app_server_transport::decode_message(&text)? else {
            continue;
        };
        if request.method == "thread/items/list"
            && request
                .params
                .as_ref()
                .and_then(|params| params.get("cursor"))
                .and_then(Value::as_str)
                == Some(HISTORY_FAILURE_CURSOR)
        {
            older_page_requested = true;
            if !fail_turn_metadata && !failed_once.swap(true, Ordering::SeqCst) {
                send_history_failure(&mut socket, request.id, "fixture history page failed once")
                    .await?;
                continue;
            }
        }
        if request.method == "thread/turns/list"
            && fail_turn_metadata
            && older_page_requested
            && !turn_enrichment_failed.swap(true, Ordering::SeqCst)
        {
            failed_once.store(true, Ordering::SeqCst);
            send_history_failure(
                &mut socket,
                request.id,
                "fixture Turn enrichment failed once",
            )
            .await?;
            continue;
        }
        let result = history_failure_response(&request.method, request.params.as_ref());
        socket
            .send(Message::Text(app_server_transport::encode_message(
                &JsonRpcMessage::Response(JsonRpcResponse::new(request.id, result)?),
            )?))
            .await?;
    }
    Ok(())
}

async fn send_history_failure(
    socket: &mut WebSocketStream<TcpStream>,
    id: app_server_protocol::RequestId,
    message: &str,
) -> Result<()> {
    socket
        .send(Message::Text(app_server_transport::encode_message(
            &JsonRpcMessage::Error(app_server_protocol::JsonRpcErrorResponse {
                id,
                error: JsonRpcError::new(-32000, message),
            }),
        )?))
        .await?;
    Ok(())
}

fn history_failure_response(method: &str, params: Option<&Value>) -> Value {
    match method {
        "initialize" => json!({
            "serverInfo": {
                "name": "app-server",
                "version": "fixture",
                "protocolVersion": app_server_protocol::PROTOCOL_VERSION
            },
            "platform": {"family": "unix", "os": "test"},
            "capabilities": {
                "agentSession": true,
                "capabilityDiscovery": true,
                "artifact": false,
                "workspace": false
            }
        }),
        "thread/resume" => history_failure_thread_response(),
        "config/read" => json!({"config": {}, "origins": {}}),
        "thread/items/list" => {
            let cursor = params
                .and_then(|value| value.get("cursor"))
                .and_then(Value::as_str);
            if cursor == Some(HISTORY_FAILURE_CURSOR) {
                json!({
                    "data": [
                        history_failure_item("turn-history-failure-older", "older-history-user", true),
                        history_failure_item("turn-history-failure-older", "older-history", false)
                    ],
                    "nextCursor": null,
                    "backwardsCursor": null
                })
            } else {
                let data = (0..24)
                    .flat_map(|index| {
                        let turn_id = format!("{HISTORY_FAILURE_TURN_ID}-{index}");
                        [
                            history_failure_item(
                                &turn_id,
                                &format!("recent-history-user-{index}"),
                                true,
                            ),
                            history_failure_item(
                                &turn_id,
                                &format!("recent-history-{index}"),
                                false,
                            ),
                        ]
                    })
                    .collect::<Vec<_>>();
                json!({
                    "data": data,
                    "nextCursor": HISTORY_FAILURE_CURSOR,
                    "backwardsCursor": null
                })
            }
        }
        "thread/turns/list" => {
            let mut entries = history_failure_response("thread/items/list", None)["data"]
                .as_array()
                .unwrap()
                .clone();
            entries.extend(
                history_failure_response(
                    "thread/items/list",
                    Some(&json!({"cursor": HISTORY_FAILURE_CURSOR})),
                )["data"]
                    .as_array()
                    .unwrap()
                    .clone(),
            );
            history_turn_page(entries, params)
        }
        "permissionProfile/list" => json!({
            "data": [{"id": ":workspace", "description": "fixture", "allowed": true}],
            "nextCursor": null
        }),
        "model/list" => json!({"data": [], "nextCursor": null}),
        "skills/list" => json!({"data": [], "nextCursor": null}),
        "collaborationMode/list" => json!({"data": []}),
        "thread/settings/update" => json!({}),
        "promptHistory/read" => {
            json!({"logId": "fixture", "entryCount": 0, "data": [], "nextCursor": null})
        }
        "thread/queue/list" => json!({"data": [], "nextCursor": null}),
        _ => json!({}),
    }
}

fn history_failure_thread_response() -> Value {
    json!({
        "thread": {
            "id": HISTORY_FAILURE_THREAD_ID,
            "sessionId": HISTORY_FAILURE_THREAD_ID,
            "preview": "",
            "ephemeral": false,
            "projectId": null,
            "historyMode": "paginated",
            "modelProvider": "fixture-provider",
            "createdAt": 1,
            "updatedAt": 2,
            "status": {"type": "idle", "activeFlags": []},
            "cwd": "/tmp/history-failure",
            "cliVersion": "fixture",
            "source": "appServer",
            "turns": []
        },
        "model": "fixture-model",
        "modelProvider": "fixture-provider",
        "cwd": "/tmp/history-failure",
        "runtimeWorkspaceRoots": ["/tmp/history-failure"],
        "instructionSources": [],
        "approvalPolicy": "never",
        "approvalsReviewer": "user",
        "sandbox": {"type": "readOnly"},
        "activePermissionProfile": {"id": ":workspace"},
        "reasoningEffort": null,
        "multiAgentMode": "explicitRequestOnly"
    })
}

fn history_failure_item(turn_id: &str, text: &str, user: bool) -> Value {
    let item = if user {
        json!({
            "type": "userMessage",
            "id": format!("{text}-id"),
            "content": [{"type": "text", "text": text}]
        })
    } else {
        json!({
            "type": "agentMessage",
            "id": format!("{text}-id"),
            "text": text,
            "phase": "final_answer"
        })
    };
    json!({"turnId": turn_id, "item": item})
}

fn history_turn_page(entries: Vec<Value>, params: Option<&Value>) -> Value {
    let mut turns: Vec<Value> = Vec::new();
    for entry in entries {
        let id = entry["turnId"].as_str().unwrap();
        if let Some(turn) = turns.iter_mut().find(|turn| turn["id"] == id) {
            turn["items"]
                .as_array_mut()
                .unwrap()
                .push(entry["item"].clone());
        } else {
            turns.push(json!({"id": id, "status": "completed", "itemsView": "full",
                "items": [entry["item"]], "startedAt": 1, "completedAt": 2, "durationMs": 1000}));
        }
    }
    if params
        .and_then(|value| value.get("itemsView"))
        .and_then(Value::as_str)
        == Some("notLoaded")
    {
        for turn in &mut turns {
            turn["itemsView"] = json!("notLoaded");
            turn["items"] = json!([]);
        }
    }
    json!({"data": turns, "nextCursor": null, "backwardsCursor": null})
}

pub(super) fn required_path(name: &str) -> PathBuf {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("missing {name}"))
}
