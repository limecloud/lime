//! Thread-owned interaction views are moved, never rebuilt from flattened notes.

use std::collections::VecDeque;

use app_server_protocol::protocol::v2::{ServerNotification, ThreadItem};
use app_server_protocol::RequestId;

use super::approval_overlay::ApprovalRequest;
use super::{BottomPane, ComposerDraft, PendingInteraction};

#[derive(Debug, Default)]
pub(crate) struct BottomPaneInputState {
    composer: ComposerDraft,
    queue: VecDeque<PendingInteraction>,
}

impl BottomPaneInputState {
    pub(crate) fn observe_notification(&mut self, notification: &ServerNotification) {
        retain_pending(&mut self.queue, notification);
    }

    pub(crate) fn clear_interactions(&mut self) {
        self.queue.clear();
    }

    #[cfg(test)]
    pub(crate) fn composer_draft(&self) -> &ComposerDraft {
        &self.composer
    }
}

impl BottomPane {
    pub(crate) fn take_input_state(&mut self) -> BottomPaneInputState {
        self.composer.flush_paste_burst_before_handoff();
        BottomPaneInputState {
            composer: self.composer.draft_snapshot(),
            queue: std::mem::take(&mut self.queue),
        }
    }

    pub(crate) fn restore_input_state(&mut self, state: BottomPaneInputState) {
        self.composer
            .restore_thread_input_state(state.composer, &self.keymap);
        self.queue = state.queue;
        // Host configuration is not part of a per-thread snapshot. Apply the current bindings
        // to every restored editor, including requests that are not at the front of the queue.
        for request in &mut self.queue {
            request.set_keymap_bindings(&self.keymap);
            request.set_locale(self.composer.locale());
        }
        self.composer.sync_completion_popup();
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
