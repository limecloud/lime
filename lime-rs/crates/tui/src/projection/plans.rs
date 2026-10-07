//! A single typed plan update supplies both transcript text and status-surface progress.

use super::{ConversationProjection, EntryKind, EntryStatus, TranscriptEntry};
use app_server_protocol::protocol::v2::{TurnPlanStepStatus, TurnPlanUpdatedNotification};

#[derive(Debug)]
pub(super) struct PlanProgress {
    thread_id: String,
    completed: usize,
    total: usize,
}

impl ConversationProjection {
    pub(crate) fn plan_progress(&self, thread_id: &str) -> Option<(usize, usize)> {
        let progress = self.last_plan_progress.as_ref()?;
        (progress.thread_id == thread_id).then_some((progress.completed, progress.total))
    }

    pub(super) fn project_plan_update(&mut self, params: TurnPlanUpdatedNotification) {
        if self.closed_turn_ids.contains(&params.turn_id) {
            return;
        }
        let total = params.plan.len();
        let completed = params
            .plan
            .iter()
            .filter(|step| step.status == TurnPlanStepStatus::Completed)
            .count();
        self.last_plan_progress = (total > 0).then_some(PlanProgress {
            thread_id: params.thread_id,
            completed,
            total,
        });
        let text = params
            .plan
            .iter()
            .map(|step| format!("{} {}", plan_marker(step.status), step.step))
            .collect::<Vec<_>>()
            .join("\n");
        self.replace_entry(TranscriptEntry {
            id: format!("turn-{}-plan", params.turn_id),
            kind: EntryKind::Plan,
            text,
            streaming: true,
            status: Some(EntryStatus::Running),
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        });
    }
}

fn plan_marker(status: TurnPlanStepStatus) -> &'static str {
    match status {
        TurnPlanStepStatus::Pending => "[ ]",
        TurnPlanStepStatus::InProgress => "[~]",
        TurnPlanStepStatus::Completed => "[x]",
    }
}

#[cfg(test)]
#[path = "plans_tests.rs"]
mod tests;
