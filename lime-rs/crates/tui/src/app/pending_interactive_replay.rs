//! Pending interactive request state used by Codex-shaped thread event replay.
//!
//! Only the exact unresolved JSON-RPC request may replay. Item IDs classify lifecycle events;
//! they are not response identities and must not revive a resolved or evicted request.

use app_server_protocol::protocol::v2::{ServerNotification, ServerRequest, ThreadItem};
use app_server_protocol::RequestId;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
enum PendingInteractiveRequest {
    ExecApproval {
        turn_id: String,
        item_id: String,
        approval_id: String,
    },
    PatchApproval {
        turn_id: String,
        item_id: String,
    },
    Elicitation {
        server_name: String,
    },
    RequestPermissions {
        turn_id: String,
        item_id: String,
    },
    RequestUserInput {
        turn_id: String,
        item_id: String,
    },
}

#[derive(Debug, Default)]
pub(super) struct PendingInteractiveReplayState {
    pending_requests_by_request_id: HashMap<RequestId, PendingInteractiveRequest>,
}

impl PendingInteractiveReplayState {
    pub(super) fn note_server_request(&mut self, request: &ServerRequest) {
        if let Some(pending) = PendingInteractiveRequest::from_server_request(request) {
            self.pending_requests_by_request_id
                .insert(request.id().clone(), pending);
        } else {
            self.pending_requests_by_request_id.remove(request.id());
        }
    }

    pub(super) fn note_server_notification(&mut self, notification: &ServerNotification) {
        self.pending_requests_by_request_id
            .retain(|id, pending| !pending.is_resolved_by(id, notification));
    }

    pub(super) fn note_evicted_server_request(&mut self, request: &ServerRequest) {
        // A buffered event can precede a replacement with the same response ID. Evicting the old
        // event must not discard the replacement's lifecycle identity.
        if self.should_replay_snapshot_request(request) {
            self.pending_requests_by_request_id.remove(request.id());
        }
    }

    pub(super) fn note_outbound_response(&mut self, request_id: &RequestId) {
        self.pending_requests_by_request_id.remove(request_id);
    }

    pub(super) fn should_replay_snapshot_request(&self, request: &ServerRequest) -> bool {
        match PendingInteractiveRequest::from_server_request(request) {
            Some(pending) => {
                self.pending_requests_by_request_id.get(request.id()) == Some(&pending)
            }
            // These methods have no interactive TUI view and are handled before buffering.
            None => true,
        }
    }
}

impl PendingInteractiveRequest {
    fn from_server_request(request: &ServerRequest) -> Option<Self> {
        match request {
            ServerRequest::ItemCommandExecutionRequestApproval { params, .. } => {
                Some(Self::ExecApproval {
                    turn_id: params.turn_id.clone(),
                    item_id: params.item_id.clone(),
                    approval_id: params
                        .approval_id
                        .clone()
                        .unwrap_or_else(|| params.item_id.clone()),
                })
            }
            ServerRequest::ItemFileChangeRequestApproval { params, .. } => {
                Some(Self::PatchApproval {
                    turn_id: params.turn_id.clone(),
                    item_id: params.item_id.clone(),
                })
            }
            ServerRequest::McpServerElicitationRequest { params, .. } => Some(Self::Elicitation {
                server_name: params.server_name.clone(),
            }),
            ServerRequest::ItemPermissionsRequestApproval { params, .. } => {
                Some(Self::RequestPermissions {
                    turn_id: params.turn_id.clone(),
                    item_id: params.item_id.clone(),
                })
            }
            ServerRequest::ItemToolRequestUserInput { params, .. } => {
                Some(Self::RequestUserInput {
                    turn_id: params.turn_id.clone(),
                    item_id: params.item_id.clone(),
                })
            }
            ServerRequest::CurrentTimeRead { .. } | ServerRequest::DynamicToolCall { .. } => None,
        }
    }

    fn turn_id(&self) -> Option<&str> {
        match self {
            Self::ExecApproval { turn_id, .. }
            | Self::PatchApproval { turn_id, .. }
            | Self::RequestPermissions { turn_id, .. }
            | Self::RequestUserInput { turn_id, .. } => Some(turn_id),
            // MCP elicitation has an independent resolved lifecycle and may outlive a turn.
            Self::Elicitation { .. } => None,
        }
    }

    fn is_resolved_by(&self, request_id: &RequestId, notification: &ServerNotification) -> bool {
        match notification {
            ServerNotification::ServerRequestResolved(params) => request_id == &params.request_id,
            ServerNotification::TurnCompleted(params) => {
                self.turn_id() == Some(params.turn.id.as_str())
            }
            ServerNotification::ThreadClosed(_) => true,
            ServerNotification::ItemStarted(params) => {
                if self.turn_id() != Some(params.turn_id.as_str()) {
                    return false;
                }
                match (self, &params.item) {
                    (
                        Self::ExecApproval { item_id, .. },
                        ThreadItem::CommandExecution { id, .. },
                    )
                    | (Self::PatchApproval { item_id, .. }, ThreadItem::FileChange { id, .. }) => {
                        item_id == id
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }
}

#[cfg(test)]
#[path = "pending_interactive_replay_tests.rs"]
mod tests;
