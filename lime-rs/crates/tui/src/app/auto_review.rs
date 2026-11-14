//! Recent auto-review denials eligible for a single approved retry.
//!
//! The TUI keeps the serialized Guardian assessment event because
//! `thread/approveGuardianDeniedAction` requires the exact denial the user saw.

use app_server_protocol::protocol::v2::{
    GuardianApprovalReviewAction, GuardianApprovalReviewStatus,
    ItemGuardianApprovalReviewCompletedNotification,
};
use serde_json::{json, Value};

#[derive(Debug)]
pub(crate) struct GuardianDenial {
    pub(crate) review_id: String,
    pub(crate) summary: String,
    pub(crate) event: Value,
}

#[derive(Debug, Default)]
pub(crate) struct GuardianDenialStore {
    entries: Vec<GuardianDenial>,
}

impl GuardianDenialStore {
    const MAX_ENTRIES: usize = 20;

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
    }

    pub(crate) fn latest(&self) -> Option<&GuardianDenial> {
        self.entries.last()
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    /// Records a denied assessment once. Returns whether a new entry was stored.
    pub(crate) fn record(
        &mut self,
        notification: &ItemGuardianApprovalReviewCompletedNotification,
    ) -> bool {
        if notification.review.status != GuardianApprovalReviewStatus::Denied {
            return false;
        }
        if self
            .entries
            .iter()
            .any(|entry| entry.review_id == notification.review_id)
        {
            return false;
        }
        let event = json!({
            "id": notification.review_id,
            "status": "denied",
            "action": notification.action,
        });
        self.entries.push(GuardianDenial {
            review_id: notification.review_id.clone(),
            summary: denial_summary(&notification.action),
            event,
        });
        if self.entries.len() > Self::MAX_ENTRIES {
            self.entries.remove(0);
        }
        true
    }
}

fn denial_summary(action: &GuardianApprovalReviewAction) -> String {
    match action {
        GuardianApprovalReviewAction::Command { command, .. } => format!("command: {command}"),
        GuardianApprovalReviewAction::Execve { program, .. } => format!("execve: {program}"),
        GuardianApprovalReviewAction::ApplyPatch { files, .. } => {
            format!("apply_patch: {} file(s)", files.len())
        }
        GuardianApprovalReviewAction::NetworkAccess { target, .. } => {
            format!("network_access: {target}")
        }
        GuardianApprovalReviewAction::McpToolCall {
            server, tool_name, ..
        } => {
            format!("mcp_tool_call: {server}/{tool_name}")
        }
        GuardianApprovalReviewAction::RequestPermissions { .. } => {
            "request_permissions".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{AutoReviewDecisionSource, GuardianApprovalReview};

    fn notification(
        review_id: &str,
        status: GuardianApprovalReviewStatus,
    ) -> ItemGuardianApprovalReviewCompletedNotification {
        ItemGuardianApprovalReviewCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            started_at_ms: 1,
            completed_at_ms: 2,
            review_id: review_id.to_string(),
            target_item_id: None,
            decision_source: AutoReviewDecisionSource::Agent,
            review: GuardianApprovalReview {
                status,
                risk_level: None,
                user_authorization: None,
                rationale: None,
            },
            action: GuardianApprovalReviewAction::Command {
                source: "shell".to_string(),
                command: "rm -rf build".to_string(),
                cwd: "/workspace".to_string(),
            },
        }
    }

    #[test]
    fn records_only_denied_reviews_once() {
        let mut store = GuardianDenialStore::default();
        assert!(!store.record(&notification(
            "review-1",
            GuardianApprovalReviewStatus::Approved
        )));
        assert!(store.record(&notification(
            "review-1",
            GuardianApprovalReviewStatus::Denied
        )));
        assert!(!store.record(&notification(
            "review-1",
            GuardianApprovalReviewStatus::Denied
        )));
        assert_eq!(store.len(), 1);
        let latest = store.latest().expect("denial");
        assert_eq!(latest.review_id, "review-1");
        assert!(latest.summary.contains("rm -rf build"));
        assert_eq!(latest.event["status"], "denied");
        assert_eq!(latest.event["action"]["type"], "command");
        assert_eq!(latest.event["id"], "review-1");
    }

    #[test]
    fn clearing_removes_denials() {
        let mut store = GuardianDenialStore::default();
        store.record(&notification(
            "review-1",
            GuardianApprovalReviewStatus::Denied,
        ));
        store.clear();
        assert!(store.latest().is_none());
        assert_eq!(store.len(), 0);
    }
}
