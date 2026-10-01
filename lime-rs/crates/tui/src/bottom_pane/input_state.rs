//! Thread-owned interaction views are moved, never rebuilt from flattened notes.

use std::collections::VecDeque;

use app_server_protocol::protocol::v2::{ServerNotification, ThreadItem};
use app_server_protocol::RequestId;

use super::approval_overlay::ApprovalRequest;
use super::{BottomPane, PendingInteraction};

#[derive(Debug, Default)]
pub(crate) struct BottomPaneInputState {
    queue: VecDeque<PendingInteraction>,
}

impl BottomPaneInputState {
    pub(crate) fn observe_notification(&mut self, notification: &ServerNotification) {
        retain_pending(&mut self.queue, notification);
    }

    pub(crate) fn clear(&mut self) {
        self.queue.clear();
    }
}

impl BottomPane {
    pub(crate) fn take_input_state(&mut self) -> BottomPaneInputState {
        BottomPaneInputState {
            queue: std::mem::take(&mut self.queue),
        }
    }

    pub(crate) fn restore_input_state(&mut self, state: BottomPaneInputState) {
        self.queue = state.queue;
        // Host configuration is not part of a per-thread snapshot. Apply the current bindings
        // to every restored editor, including requests that are not at the front of the queue.
        for request in &mut self.queue {
            request.set_keymap_bindings(&self.keymap);
        }
    }

    pub(crate) fn observe_notification(&mut self, notification: &ServerNotification) {
        retain_pending(&mut self.queue, notification);
    }
}

fn retain_pending(queue: &mut VecDeque<PendingInteraction>, notification: &ServerNotification) {
    // App routes this notification to the matching thread before touching either live or dormant
    // views. These are presentation invalidations, not local waiter or approval decisions.
    queue.retain(|request| !request.is_resolved_by(notification));
}

impl PendingInteraction {
    fn request_id(&self) -> &RequestId {
        match self {
            Self::Approval(approval) => match &approval.request {
                ApprovalRequest::Exec { id, .. }
                | ApprovalRequest::ApplyPatch { id, .. }
                | ApprovalRequest::Permissions { id, .. } => id,
            },
            Self::UserInput(request) => &request.id,
            Self::McpElicitation(request) => request.request_id(),
        }
    }

    fn turn_id(&self) -> Option<&str> {
        match self {
            Self::Approval(approval) => Some(match &approval.request {
                ApprovalRequest::Exec { params, .. } => &params.turn_id,
                ApprovalRequest::ApplyPatch { params, .. } => &params.turn_id,
                ApprovalRequest::Permissions { params, .. } => &params.turn_id,
            }),
            Self::UserInput(request) => Some(&request.params.turn_id),
            // MCP elicitation has its own resolved notification and can outlive a turn.
            Self::McpElicitation(_) => None,
        }
    }

    fn is_resolved_by(&self, notification: &ServerNotification) -> bool {
        match notification {
            ServerNotification::ServerRequestResolved(params) => {
                self.request_id() == &params.request_id
            }
            ServerNotification::TurnCompleted(params) => {
                self.turn_id() == Some(params.turn.id.as_str())
            }
            ServerNotification::ThreadClosed(_) => true,
            ServerNotification::ItemStarted(params) => {
                if self.turn_id() != Some(params.turn_id.as_str()) {
                    return false;
                }
                matches!((self, &params.item),
                    (Self::Approval(approval), ThreadItem::CommandExecution { id, .. })
                        if matches!(&approval.request, ApprovalRequest::Exec { params, .. }
                            if &params.item_id == id))
                    || matches!((self, &params.item),
                        (Self::Approval(approval), ThreadItem::FileChange { id, .. })
                            if matches!(&approval.request, ApprovalRequest::ApplyPatch { params, .. }
                                if &params.item_id == id))
            }
            _ => false,
        }
    }
}
