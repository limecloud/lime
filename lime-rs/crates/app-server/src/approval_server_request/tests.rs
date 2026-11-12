use super::*;
use crate::JsonRpcMessage;
use app_server_protocol::error_codes;
use app_server_protocol::protocol::v2::{ServerNotification, ServerRequestResolvedNotification};
use serde_json::json;

fn event(payload: Value) -> AgentEvent {
    AgentEvent {
        event_id: "event-1".to_string(),
        sequence: 1,
        session_id: "session-1".to_string(),
        thread_id: Some("thread-1".to_string()),
        turn_id: Some("turn-1".to_string()),
        event_type: "action.required".to_string(),
        timestamp: "2026-07-20T00:00:01Z".to_string(),
        payload,
    }
}

#[test]
fn lowers_tool_confirmation_to_codex_command_approval_request() {
    let request = command_approval_request(&event(json!({
        "requestId": "approval-1",
        "actionType": "tool_confirmation",
        "toolCallId": "item-command-1",
        "prompt": "允许执行测试？",
        "arguments": { "command": "npm test" },
        "availableDecisions": ["allow_once", "allow_for_session", "decline", "cancel"]
    })))
    .expect("valid approval")
    .expect("command approval");

    assert_eq!(request.identity.request_id, "approval-1");
    assert_eq!(request.params.item_id, "item-command-1");
    assert_eq!(request.params.command.as_deref(), Some("npm test"));
    assert_eq!(request.params.network_approval_context, None);
    assert_eq!(
        request.params.available_decisions,
        Some(vec![
            CommandExecutionApprovalDecision::Accept,
            CommandExecutionApprovalDecision::AcceptForSession,
            CommandExecutionApprovalDecision::Decline,
            CommandExecutionApprovalDecision::Cancel,
        ])
    );
}

#[test]
fn file_change_approval_request_carries_sorted_unique_patch_destinations() {
    let request = file_change_approval_request(&event(json!({
        "requestId": "approval-patch-1",
        "actionType": "tool_confirmation",
        "toolName": "apply_patch",
        "toolCallId": "item-patch-1",
        "prompt": "Apply proposed file edits",
        "cwd": "/workspace/lime",
        "arguments": {
            "patch": "*** Begin Patch\n\
             *** Update File: path/update.py\n\
             *** Move to: path/moved.py\n\
             @@ def f():\n\
             -    pass\n\
             +    return 123\n\
             *** Add File: path/add.py\n\
             +abc\n\
             *** End Patch"
        }
    })))
    .expect("valid approval")
    .expect("file change approval");

    assert_eq!(
        request.params.destinations,
        vec![
            "/workspace/lime/path/add.py".to_string(),
            "/workspace/lime/path/moved.py".to_string(),
            "/workspace/lime/path/update.py".to_string()
        ]
    );
    assert_eq!(
        request.params.reason.as_deref(),
        Some("Apply proposed file edits")
    );
}

#[test]
fn lowers_managed_network_retry_to_network_only_approval_request() {
    let request = command_approval_request(&event(json!({
        "requestId": "approval-network-1",
        "actionType": "tool_confirmation",
        "toolCallId": "item-command-network-1",
        "prompt": "network access requires approval",
        "arguments": { "command": "curl http://127.0.0.1:43123/proof?token=secret" },
        "cwd": "/workspace/lime",
        "approvalPhase": "escalation",
        "denialKind": "managed_network",
        "approvalScope": {
            "networkHost": "127.0.0.1",
            "networkProtocol": "http"
        }
    })))
    .expect("valid network approval")
    .expect("network approval request");

    assert_eq!(
        request.params.network_approval_context,
        Some(NetworkApprovalContext {
            host: "127.0.0.1".to_string(),
            protocol: NetworkApprovalProtocol::Http,
        })
    );
    assert_eq!(request.params.command, None);
    assert_eq!(request.params.cwd, None);
    let serialized = serde_json::to_string(&request.params).expect("serialize network approval");
    assert!(!serialized.contains("token=secret"));
    assert!(!serialized.contains("approvalPhase"));
    assert!(!serialized.contains("denialKind"));
}

#[test]
fn rejects_managed_network_approval_without_complete_typed_context() {
    for payload in [
        json!({
            "requestId": "approval-network-incomplete",
            "actionType": "tool_confirmation",
            "toolCallId": "item-command-network-incomplete",
            "denialKind": "managed_network",
            "approvalScope": {
                "networkHost": "127.0.0.1"
            }
        }),
        json!({
            "requestId": "approval-network-missing-scope",
            "actionType": "tool_confirmation",
            "toolCallId": "item-command-network-missing-scope",
            "denialKind": "managed_network"
        }),
    ] {
        let error = match command_approval_request(&event(payload)) {
            Err(error) => error,
            Ok(_) => panic!("managed-network approval must fail closed"),
        };
        assert_eq!(
            error,
            "action.required managed-network approval context is incomplete"
        );
    }
}

#[test]
fn ignores_legacy_network_host_for_non_managed_approval() {
    let request = command_approval_request(&event(json!({
        "requestId": "approval-legacy-host",
        "actionType": "tool_confirmation",
        "toolCallId": "item-command-legacy-host",
        "arguments": { "command": "npm test" },
        "approvalScope": {
            "networkHost": "legacy.example"
        }
    })))
    .expect("legacy approval remains valid")
    .expect("command approval");

    assert_eq!(request.params.network_approval_context, None);
    assert_eq!(request.params.command.as_deref(), Some("npm test"));
}

#[test]
fn routes_apply_patch_to_codex_file_change_approval_request() {
    let request = action_server_request(&event(json!({
        "requestId": "approval-file-1",
        "actionType": "tool_confirmation",
        "toolCallId": "item-file-1",
        "toolName": "apply_patch",
        "prompt": "允许修改文件？",
        "createdAtMs": 1784560000000_i64
    })))
    .expect("valid file approval")
    .expect("file approval request");

    let ActionServerRequest::FileChange(request) = request else {
        panic!("apply_patch must use file change approval");
    };
    assert_eq!(request.params.item_id, "item-file-1");
    assert_eq!(request.params.reason.as_deref(), Some("允许修改文件？"));
    assert_eq!(request.params.started_at_ms, 1784560000000);
}

#[test]
fn fixture_shaped_apply_patch_action_required_selects_file_change_approval() {
    let request = action_server_request(&event(json!({
        "actionType": "tool_confirmation",
        "actionKind": "tool_execution_policy",
        "requestId": "terminal-file-approval",
        "actionId": "terminal-file-approval",
        "toolCallId": "terminal-patch-1",
        "toolName": "apply_patch",
        "toolFamily": "apply_patch",
        "prompt": "Apply proposed file edits",
        "arguments": {
            "patch": "*** Begin Patch\n\
             *** Add File: gate/fixture-approved.rs\n\
             +fn approved() {}\n\
             *** End Patch"
        },
        "cwd": "/tmp/workspace",
        "runtime_contract": {
            "contract_key": "apply_patch",
            "tool_family": "apply_patch",
            "session_cache_supported": false
        },
        "approvalScope": {
            "contractKey": "apply_patch",
            "toolFamily": "apply_patch",
            "riskClass": "file_write_requires_approval",
            "workingDirHash": "sha256:test"
        },
        "availableDecisions": ["allow_once", "allow_for_session", "decline", "cancel"]
    })))
    .expect("valid file change approval")
    .expect("file change approval request");

    let ActionServerRequest::FileChange(request) = request else {
        panic!("apply_patch must use file change approval");
    };
    assert_eq!(
        request.params.destinations,
        vec!["/tmp/workspace/gate/fixture-approved.rs".to_string()]
    );
}

#[test]
fn lowers_nested_ask_user_to_codex_tool_request() {
    let request = action_server_request(&event(json!({
        "requestId": "ask-1",
        "data": {
            "actionType": "ask_user",
            "toolCallId": "item-ask-1",
            "isBlocking": false,
            "autoResolutionMs": 60000,
            "questions": [{
                "id": "mode",
                "header": "模式",
                "question": "请选择执行模式",
                "options": [
                    {"value": "auto", "label": "自动", "description": "直接继续"},
                    {"value": "confirm", "label": "确认", "description": "再次确认"}
                ]
            }]
        }
    })))
    .expect("valid user input")
    .expect("user input request");

    let ActionServerRequest::UserInput(request) = request else {
        panic!("ask_user must use tool request user input");
    };
    assert_eq!(request.params.item_id, "item-ask-1");
    assert!(!request.params.is_blocking);
    assert_eq!(request.params.auto_resolution_ms, Some(60000));
    assert_eq!(request.params.questions[0].id, "mode");
    assert_eq!(
        request.params.questions[0].options.as_ref().unwrap()[0].label,
        "自动"
    );
}

#[test]
fn leaves_non_command_actions_for_their_typed_server_request_owner() {
    assert!(command_approval_request(&event(json!({
        "requestId": "ask-1",
        "actionType": "ask_user"
    })))
    .expect("not malformed")
    .is_none());
}

#[test]
fn approval_request_failure_preserves_failure_fact_without_canceling_turn() {
    let response = RuntimeActionResponse::from_approval(
        identity(),
        Err(WaitServerRequestError::Failed(
            "client disconnected".to_string(),
        )),
    )
    .expect("failure response");
    assert_eq!(
        response.decision,
        Some(AgentSessionApprovalDecision::Decline)
    );
    assert!(tool_runtime::execution_approval::approval_request_failed(
        response.metadata.as_ref()
    ));
    assert_eq!(response.identity.request_id, "approval-1");
    assert!(RuntimeActionResponse::from_approval(
        identity(),
        Err(WaitServerRequestError::Transition)
    )
    .is_none());

    let declined =
        RuntimeActionResponse::from_approval(identity(), Ok(AgentSessionApprovalDecision::Decline))
            .expect("user decline");
    assert!(declined.metadata.is_none());
}

fn identity() -> RuntimeActionIdentity {
    RuntimeActionIdentity {
        request_id: "approval-1".to_string(),
        session_id: "session-1".to_string(),
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
    }
}

#[tokio::test]
async fn malformed_response_and_client_error_resolve_once_as_request_failure() {
    for malformed in [true, false] {
        let server = AppServer::new();
        let mut outbound = server.subscribe_outbound_messages();
        let pending = server.server_requests.register(
            METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
            Some(json!({ "threadId": "thread-1" })),
        );
        let request_id = pending.id().clone();
        if malformed {
            server
                .server_requests
                .resolve_response(request_id.clone(), json!({ "decision": "invalid" }))
                .expect("resolve malformed response");
        } else {
            server
                .server_requests
                .resolve_error(
                    request_id.clone(),
                    app_server_protocol::JsonRpcError::new(-32603, "cannot show approval"),
                )
                .expect("client error");
        }
        let error = server
            .finish_server_request::<CommandExecutionRequestApprovalResponse>("thread-1", pending)
            .await
            .expect_err("request failed");
        assert!(matches!(error, WaitServerRequestError::Failed(_)));
        let response =
            RuntimeActionResponse::from_approval(identity(), Err(error)).expect("failure response");
        assert!(tool_runtime::execution_approval::approval_request_failed(
            response.metadata.as_ref()
        ));
        let JsonRpcMessage::Notification(notification) =
            outbound.try_recv().expect("resolved notification")
        else {
            panic!("expected resolved notification");
        };
        assert_eq!(
            ServerNotification::try_from(notification).expect("typed notification"),
            ServerNotification::ServerRequestResolved(ServerRequestResolvedNotification {
                thread_id: "thread-1".to_string(),
                request_id,
            })
        );
        assert!(outbound.try_recv().is_err());
    }
}

#[tokio::test]
async fn closed_response_channel_and_missing_client_are_request_failures() {
    let server = AppServer::new();
    let pending = server.server_requests.register(
        METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        Some(json!({ "threadId": "thread-1" })),
    );
    pending.cancel_with_owner();
    let closed = server
        .finish_server_request::<CommandExecutionRequestApprovalResponse>("thread-1", pending)
        .await
        .expect_err("closed channel");
    assert!(matches!(closed, WaitServerRequestError::Failed(_)));
    let unavailable = server
        .wait_thread_server_request::<_, CommandExecutionRequestApprovalResponse>(
            METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
            "thread-1",
            json!({}),
        )
        .await
        .expect_err("no client");
    for error in [closed, unavailable] {
        let response =
            RuntimeActionResponse::from_approval(identity(), Err(error)).expect("failure response");
        assert!(tool_runtime::execution_approval::approval_request_failed(
            response.metadata.as_ref()
        ));
        assert!(!response.decision.expect("decision").confirmed());
    }
}

#[tokio::test]
async fn typed_response_publishes_resolved_before_wait_completes() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let pending = server.server_requests.register(
        METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        Some(json!({ "threadId": "thread-1" })),
    );
    let request_id = pending.id().clone();
    let waiting_server = server.clone();
    let waiter = tokio::spawn(async move {
        waiting_server
            .finish_server_request::<CommandExecutionRequestApprovalResponse>("thread-1", pending)
            .await
    });

    server
        .server_requests
        .resolve_response(
            request_id.clone(),
            json!({ "decision": "acceptForSession" }),
        )
        .expect("resolve typed approval response");
    let response = waiter
        .await
        .expect("approval waiter task")
        .expect("typed approval response");
    assert_eq!(
        response.decision,
        CommandExecutionApprovalDecision::AcceptForSession
    );

    let JsonRpcMessage::Notification(notification) = outbound
        .try_recv()
        .expect("resolved notification must be published before waiter returns")
    else {
        panic!("expected resolved notification");
    };
    assert_eq!(
        ServerNotification::try_from(notification).expect("typed resolved notification"),
        ServerNotification::ServerRequestResolved(ServerRequestResolvedNotification {
            thread_id: "thread-1".to_string(),
            request_id
        })
    );
}

#[tokio::test]
async fn client_cancel_error_publishes_resolved_and_preserves_runtime_failure() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let pending = server.server_requests.register(
        METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
        Some(json!({ "threadId": "thread-1" })),
    );
    let request_id = pending.id().clone();
    let waiting_server = server.clone();
    let waiter = tokio::spawn(async move {
        waiting_server
            .finish_server_request::<CommandExecutionRequestApprovalResponse>("thread-1", pending)
            .await
    });

    server
        .server_requests
        .resolve_error(
            request_id.clone(),
            app_server_protocol::JsonRpcError::new(
                error_codes::REQUEST_CANCELLED,
                "client canceled its prompt",
            ),
        )
        .expect("cancel typed approval request");
    let error = waiter
        .await
        .expect("approval waiter task")
        .expect_err("a client error must not claim that the runtime turn has transitioned");
    assert!(matches!(error, WaitServerRequestError::Failed(_)));

    let JsonRpcMessage::Notification(notification) = outbound
        .try_recv()
        .expect("transition cancellation must resolve the outer request")
    else {
        panic!("expected resolved notification");
    };
    assert_eq!(
        ServerNotification::try_from(notification).expect("typed resolved notification"),
        ServerNotification::ServerRequestResolved(ServerRequestResolvedNotification {
            thread_id: "thread-1".to_string(),
            request_id
        })
    );
}
