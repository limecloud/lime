use super::*;
use app_server_protocol::protocol::v2::{
    CommandExecutionRequestApprovalParams, FileChangeRequestApprovalParams,
    ItemStartedNotification, McpServerElicitationRequest, McpServerElicitationRequestParams,
    PermissionsRequestApprovalParams, RequestPermissionProfile, ServerRequestResolvedNotification,
    ThreadClosedNotification, ToolRequestUserInputParams, Turn, TurnCompletedNotification,
    TurnItemsView, TurnStatus,
};

fn request_user_input(id: i64, item_id: &str, turn_id: &str) -> ServerRequest {
    ServerRequest::ItemToolRequestUserInput {
        id: RequestId::Integer(id),
        params: ToolRequestUserInputParams {
            thread_id: "thread".to_string(),
            turn_id: turn_id.to_string(),
            item_id: item_id.to_string(),
            questions: Vec::new(),
            is_blocking: true,
            auto_resolution_ms: None,
        },
    }
}

fn exec_approval(
    id: i64,
    item_id: &str,
    approval_id: Option<&str>,
    turn_id: &str,
) -> ServerRequest {
    ServerRequest::ItemCommandExecutionRequestApproval {
        id: RequestId::Integer(id),
        params: CommandExecutionRequestApprovalParams {
            thread_id: "thread".to_string(),
            turn_id: turn_id.to_string(),
            item_id: item_id.to_string(),
            started_at_ms: 0,
            approval_id: approval_id.map(str::to_string),
            reason: None,
            network_approval_context: None,
            command: Some("echo ok".to_string()),
            cwd: None,
            available_decisions: None,
        },
    }
}

fn patch_approval(id: i64, item_id: &str, turn_id: &str) -> ServerRequest {
    ServerRequest::ItemFileChangeRequestApproval {
        id: RequestId::Integer(id),
        params: FileChangeRequestApprovalParams {
            thread_id: "thread".to_string(),
            turn_id: turn_id.to_string(),
            item_id: item_id.to_string(),
            started_at_ms: 0,
            reason: None,
            grant_root: None,
        },
    }
}

fn permissions_approval(id: i64, item_id: &str, turn_id: &str) -> ServerRequest {
    ServerRequest::ItemPermissionsRequestApproval {
        id: RequestId::Integer(id),
        params: PermissionsRequestApprovalParams {
            thread_id: "thread".to_string(),
            turn_id: turn_id.to_string(),
            item_id: item_id.to_string(),
            environment_id: None,
            started_at_ms: 0,
            cwd: "/tmp".to_string(),
            reason: None,
            permissions: RequestPermissionProfile {
                network: None,
                file_system: None,
            },
        },
    }
}

fn elicitation(id: &str) -> ServerRequest {
    ServerRequest::McpServerElicitationRequest {
        id: RequestId::String(id.to_string()),
        params: McpServerElicitationRequestParams {
            thread_id: "thread".to_string(),
            turn_id: Some("turn".to_string()),
            server_name: "server".to_string(),
            request: McpServerElicitationRequest::Form {
                meta: None,
                message: "Confirm".to_string(),
                requested_schema: serde_json::Map::new(),
            },
        },
    }
}

fn turn_completed(turn_id: &str) -> ServerNotification {
    ServerNotification::TurnCompleted(TurnCompletedNotification {
        thread_id: "thread".to_string(),
        turn: Turn {
            id: turn_id.to_string(),
            items: Vec::new(),
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: None,
            completed_at: None,
            duration_ms: None,
        },
    })
}

fn resolved(id: RequestId) -> ServerNotification {
    ServerNotification::ServerRequestResolved(ServerRequestResolvedNotification {
        thread_id: "thread".to_string(),
        request_id: id,
    })
}

#[test]
fn each_interactive_request_is_pending_until_resolved() {
    let mut state = PendingInteractiveReplayState::default();
    let requests = [
        request_user_input(1, "input", "turn"),
        exec_approval(2, "exec", Some("approval"), "turn"),
        patch_approval(3, "patch", "turn"),
        permissions_approval(4, "permissions", "turn"),
        elicitation("elicitation"),
    ];

    for request in &requests {
        state.note_server_request(request);
        assert!(state.should_replay_snapshot_request(request));
    }
    assert_eq!(state.pending_requests_by_request_id.len(), requests.len());
}

#[test]
fn outbound_response_clears_only_the_matching_request() {
    let mut state = PendingInteractiveReplayState::default();
    let first = request_user_input(1, "input-1", "turn");
    let second = request_user_input(2, "input-2", "turn");
    state.note_server_request(&first);
    state.note_server_request(&second);

    state.note_outbound_response(&RequestId::Integer(1));

    assert!(!state.should_replay_snapshot_request(&first));
    assert!(state.should_replay_snapshot_request(&second));
    assert_eq!(state.pending_requests_by_request_id.len(), 1);
}

#[test]
fn server_resolution_clears_request_identity_and_category() {
    let mut state = PendingInteractiveReplayState::default();
    let request = exec_approval(1, "item", Some("approval"), "turn");
    state.note_server_request(&request);
    state.note_server_notification(&resolved(RequestId::Integer(1)));

    assert!(!state.should_replay_snapshot_request(&request));
    assert!(state.pending_requests_by_request_id.is_empty());
}

#[test]
fn item_started_clears_command_and_file_approval_by_item_id() {
    let mut state = PendingInteractiveReplayState::default();
    let exec = exec_approval(1, "exec-item", Some("approval-id"), "turn");
    let patch = patch_approval(2, "patch-item", "turn");
    state.note_server_request(&exec);
    state.note_server_request(&patch);

    state.note_server_notification(&ServerNotification::ItemStarted(ItemStartedNotification {
        thread_id: "thread".to_string(),
        turn_id: "turn".to_string(),
        started_at_ms: 0,
        item: ThreadItem::CommandExecution {
            id: "exec-item".to_string(),
            metadata: None,
            plugin_id: None,
            script_path: None,
            command: "echo ok".to_string(),
            cwd: "/tmp".to_string(),
            process_id: None,
            source: Default::default(),
            status: app_server_protocol::protocol::v2::CommandExecutionStatus::InProgress,
            command_actions: Vec::new(),
            aggregated_output: None,
            exit_code: None,
            duration_ms: None,
            terminal_interactions: Vec::new(),
        },
    }));
    assert!(!state.should_replay_snapshot_request(&exec));
    assert!(state.should_replay_snapshot_request(&patch));

    state.note_server_notification(&ServerNotification::ItemStarted(ItemStartedNotification {
        thread_id: "thread".to_string(),
        turn_id: "turn".to_string(),
        started_at_ms: 0,
        item: ThreadItem::FileChange {
            id: "patch-item".to_string(),
            metadata: None,
            changes: Vec::new(),
            status: app_server_protocol::protocol::v2::PatchApplyStatus::InProgress,
        },
    }));
    assert!(!state.should_replay_snapshot_request(&patch));
}

#[test]
fn turn_completion_clears_all_turn_indexed_prompts() {
    let mut state = PendingInteractiveReplayState::default();
    let requests = [
        request_user_input(1, "input", "turn"),
        exec_approval(2, "exec", None, "turn"),
        patch_approval(3, "patch", "turn"),
        permissions_approval(4, "permissions", "turn"),
    ];
    for request in &requests {
        state.note_server_request(request);
    }

    state.note_server_notification(&turn_completed("turn"));

    assert!(requests
        .iter()
        .all(|request| !state.should_replay_snapshot_request(request)));
    assert!(state.pending_requests_by_request_id.is_empty());
}

#[test]
fn user_input_requests_are_removed_in_fifo_order_per_turn() {
    let mut state = PendingInteractiveReplayState::default();
    let first = request_user_input(1, "first", "turn");
    let second = request_user_input(2, "second", "turn");
    state.note_server_request(&first);
    state.note_server_request(&second);

    state.note_outbound_response(&RequestId::Integer(1));

    assert!(!state.should_replay_snapshot_request(&first));
    assert!(state.should_replay_snapshot_request(&second));
}

#[test]
fn evicted_request_does_not_replay() {
    let mut state = PendingInteractiveReplayState::default();
    let request = permissions_approval(1, "permissions", "turn");
    state.note_server_request(&request);
    state.note_evicted_server_request(&request);

    assert!(!state.should_replay_snapshot_request(&request));
    assert!(state.pending_requests_by_request_id.is_empty());
}

#[test]
fn closing_thread_clears_all_prompt_categories() {
    let mut state = PendingInteractiveReplayState::default();
    let requests = [
        request_user_input(1, "input", "turn"),
        exec_approval(2, "exec", None, "turn"),
        patch_approval(3, "patch", "turn"),
        permissions_approval(4, "permissions", "turn"),
        elicitation("elicitation"),
    ];
    for request in &requests {
        state.note_server_request(request);
    }

    state.note_server_notification(&ServerNotification::ThreadClosed(
        ThreadClosedNotification {
            thread_id: "thread".to_string(),
        },
    ));

    assert!(requests
        .iter()
        .all(|request| !state.should_replay_snapshot_request(request)));
    assert!(state.pending_requests_by_request_id.is_empty());
}

#[test]
fn same_item_prompts_keep_exact_response_identity() {
    let pairs = [
        (
            request_user_input(1, "shared", "turn"),
            request_user_input(2, "shared", "turn"),
        ),
        (
            exec_approval(1, "shared", Some("shared-approval"), "turn"),
            exec_approval(2, "shared", Some("shared-approval"), "turn"),
        ),
        (
            patch_approval(1, "shared", "turn"),
            patch_approval(2, "shared", "turn"),
        ),
        (
            permissions_approval(1, "shared", "turn"),
            permissions_approval(2, "shared", "turn"),
        ),
    ];
    for (first, second) in pairs {
        for resolution in ["outbound", "resolved", "evicted"] {
            let mut state = PendingInteractiveReplayState::default();
            state.note_server_request(&first);
            state.note_server_request(&second);
            match resolution {
                "outbound" => state.note_outbound_response(first.id()),
                "resolved" => state.note_server_notification(&resolved(first.id().clone())),
                "evicted" => state.note_evicted_server_request(&first),
                _ => unreachable!(),
            }
            assert!(
                !state.should_replay_snapshot_request(&first),
                "{resolution}"
            );
            assert!(
                state.should_replay_snapshot_request(&second),
                "{resolution}"
            );
            state.note_server_request(&second);
            assert!(
                !state.should_replay_snapshot_request(&first),
                "a new prompt cannot revive an old response ID: {resolution}"
            );
            assert_eq!(state.pending_requests_by_request_id.len(), 1);
        }
    }
}

#[test]
fn stale_eviction_cannot_remove_a_replacement_request() {
    let mut state = PendingInteractiveReplayState::default();
    let first = request_user_input(1, "first", "turn-first");
    let replacement = patch_approval(1, "second", "turn-second");
    state.note_server_request(&first);
    state.note_server_request(&replacement);
    state.note_evicted_server_request(&first);
    assert!(!state.should_replay_snapshot_request(&first));
    assert!(state.should_replay_snapshot_request(&replacement));
}

#[test]
fn item_start_in_another_turn_cannot_clear_command_or_file_approval() {
    let mut state = PendingInteractiveReplayState::default();
    let exec = exec_approval(1, "item", Some("approval"), "turn");
    let patch = patch_approval(2, "item", "turn");
    state.note_server_request(&exec);
    state.note_server_request(&patch);
    let items = [
        ThreadItem::CommandExecution {
            id: "item".into(),
            metadata: None,
            plugin_id: None,
            script_path: None,
            command: "echo ok".into(),
            cwd: "/tmp".into(),
            process_id: None,
            source: Default::default(),
            status: app_server_protocol::protocol::v2::CommandExecutionStatus::InProgress,
            command_actions: Vec::new(),
            aggregated_output: None,
            exit_code: None,
            duration_ms: None,
            terminal_interactions: Vec::new(),
        },
        ThreadItem::FileChange {
            id: "item".into(),
            metadata: None,
            changes: Vec::new(),
            status: app_server_protocol::protocol::v2::PatchApplyStatus::InProgress,
        },
    ];
    for item in items {
        state.note_server_notification(&ServerNotification::ItemStarted(ItemStartedNotification {
            thread_id: "thread".into(),
            turn_id: "other-turn".into(),
            started_at_ms: 0,
            item,
        }));
        assert!(state.should_replay_snapshot_request(&exec));
        assert!(state.should_replay_snapshot_request(&patch));
    }
}

#[test]
fn snapshot_rebase_omits_resolved_prompt_when_new_prompt_shares_its_item() {
    use super::super::thread_events::{ThreadBufferedEvent, ThreadEventStore};

    let mut store = ThreadEventStore::new(8);
    let old = request_user_input(1, "shared", "turn");
    let new = request_user_input(2, "shared", "turn");
    assert!(store.push_request(old.clone()));
    store.push_notification(resolved(old.id().clone()));
    assert!(store.push_request(new.clone()));
    store.rebase_buffer_after_session_refresh();
    let snapshot = store.snapshot();
    assert_eq!(snapshot.events.len(), 1);
    let ThreadBufferedEvent::Request(request) = &snapshot.events[0] else {
        panic!("only the exact unresolved request may survive resume rebasing")
    };
    assert_eq!(**request, new);
}

#[test]
fn mcp_elicitation_keeps_its_independent_resolved_lifecycle() {
    let mut state = PendingInteractiveReplayState::default();
    let request = elicitation("elicitation");
    state.note_server_request(&request);
    state.note_server_notification(&turn_completed("turn"));
    assert!(state.should_replay_snapshot_request(&request));
    state.note_server_notification(&resolved(request.id().clone()));
    assert!(!state.should_replay_snapshot_request(&request));
    assert!(state.pending_requests_by_request_id.is_empty());
}
