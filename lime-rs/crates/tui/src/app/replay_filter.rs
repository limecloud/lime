//! Helpers for deciding which buffered events to replay when switching threads.
//!
//! The live event store remains untouched. These filters only normalize the snapshot that is
//! about to be replayed into the active TUI projection.

use std::collections::HashSet;

use app_server_protocol::protocol::v2::{ServerNotification, ThreadItem};

use super::thread_events::{ThreadBufferedEvent, ThreadEventSnapshot};

pub(super) fn snapshot_has_pending_interactive_request(snapshot: &ThreadEventSnapshot) -> bool {
    snapshot.events.iter().any(|event| {
        matches!(
            event,
            ThreadBufferedEvent::Request(request)
                if matches!(
                    request.as_ref(),
                    app_server_protocol::protocol::v2::ServerRequest::ItemCommandExecutionRequestApproval { .. }
                        | app_server_protocol::protocol::v2::ServerRequest::ItemFileChangeRequestApproval { .. }
                        | app_server_protocol::protocol::v2::ServerRequest::McpServerElicitationRequest { .. }
                        | app_server_protocol::protocol::v2::ServerRequest::ItemPermissionsRequestApproval { .. }
                        | app_server_protocol::protocol::v2::ServerRequest::ItemToolRequestUserInput { .. }
                )
        )
    })
}

pub(super) fn event_is_notice(event: &ThreadBufferedEvent) -> bool {
    matches!(
        event,
        ThreadBufferedEvent::Notification(notification)
            if matches!(
                notification.as_ref(),
                ServerNotification::Warning(_)
                    | ServerNotification::GuardianWarning(_)
                    | ServerNotification::ConfigWarning(_)
            )
    )
}

/// A completed item's full text replaces its earlier streaming deltas during replay.
///
/// Keep deltas without a later completion so an in-progress or truncated stream still renders.
/// Other events are barriers: streaming text may need to flush before a tool or prompt. This only
/// changes the replay snapshot; the live notification store remains untouched.
pub(super) fn omit_completed_agent_deltas(events: &mut Vec<ThreadBufferedEvent>) {
    let mut completed = HashSet::new();
    events.reverse();
    events.retain(|event| {
        if let ThreadBufferedEvent::Notification(notification) = event {
            match notification.as_ref() {
                ServerNotification::ItemCompleted(notification) => {
                    if let ThreadItem::AgentMessage { id, .. } = &notification.item {
                        completed.insert((
                            notification.thread_id.clone(),
                            notification.turn_id.clone(),
                            id.clone(),
                        ));
                    } else {
                        completed.clear();
                    }
                }
                ServerNotification::AgentMessageDelta(notification) => {
                    return !completed.contains(&(
                        notification.thread_id.clone(),
                        notification.turn_id.clone(),
                        notification.item_id.clone(),
                    ));
                }
                _ => completed.clear(),
            }
        } else {
            completed.clear();
        }
        true
    });
    events.reverse();
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{
        AgentMessageDeltaNotification, ConfigWarningNotification, ItemCompletedNotification,
        ServerRequest, ThreadItem, ToolRequestUserInputParams, WarningNotification,
    };
    use app_server_protocol::RequestId;

    fn delta(item_id: &str, text: &str) -> ThreadBufferedEvent {
        ThreadBufferedEvent::Notification(Box::new(ServerNotification::AgentMessageDelta(
            AgentMessageDeltaNotification {
                thread_id: "thread".to_string(),
                turn_id: "turn".to_string(),
                item_id: item_id.to_string(),
                delta: text.to_string(),
            },
        )))
    }

    fn completed_agent(item_id: &str, text: &str) -> ThreadBufferedEvent {
        ThreadBufferedEvent::Notification(Box::new(ServerNotification::ItemCompleted(
            ItemCompletedNotification {
                thread_id: "thread".to_string(),
                turn_id: "turn".to_string(),
                completed_at_ms: 1,
                item: ThreadItem::AgentMessage {
                    id: item_id.to_string(),
                    metadata: None,
                    text: text.to_string(),
                    phase: None,
                    memory_citation: None,
                    delivery: None,
                },
            },
        )))
    }

    #[test]
    fn snapshot_has_pending_interactive_request_matches_user_input() {
        let request = ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(1),
            params: ToolRequestUserInputParams {
                thread_id: "thread".to_string(),
                turn_id: "turn".to_string(),
                item_id: "item".to_string(),
                questions: Vec::new(),
                is_blocking: true,
                auto_resolution_ms: None,
            },
        };
        let snapshot = ThreadEventSnapshot {
            events: vec![ThreadBufferedEvent::Request(Box::new(request))],
        };
        assert!(snapshot_has_pending_interactive_request(&snapshot));
    }

    #[test]
    fn event_is_notice_matches_warning_notifications() {
        let warning = ThreadBufferedEvent::Notification(Box::new(ServerNotification::Warning(
            WarningNotification {
                thread_id: Some("thread".to_string()),
                message: "warning".to_string(),
                code: None,
            },
        )));
        let config_warning = ThreadBufferedEvent::Notification(Box::new(
            ServerNotification::ConfigWarning(ConfigWarningNotification {
                summary: "config".to_string(),
                details: None,
                path: None,
                range: None,
            }),
        ));
        assert!(event_is_notice(&warning));
        assert!(event_is_notice(&config_warning));
        assert!(!event_is_notice(&delta("item", "text")));
    }

    #[test]
    fn omit_completed_agent_deltas_removes_only_replaced_streams() {
        let mut events = vec![delta("item-1", "draft"), completed_agent("item-1", "final")];
        events.push(delta("item-2", "still streaming"));

        omit_completed_agent_deltas(&mut events);

        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0],
            ThreadBufferedEvent::Notification(notification)
                if matches!(notification.as_ref(), ServerNotification::ItemCompleted(_))
        ));
        assert!(matches!(
            &events[1],
            ThreadBufferedEvent::Notification(notification)
                if matches!(notification.as_ref(), ServerNotification::AgentMessageDelta(delta)
                    if delta.item_id == "item-2")
        ));
    }
}
