//! Thread-local input handoff owned by `ChatWidget`.
//!
//! The terminal host chooses which thread is active and owns transport channels. The rich draft,
//! pending interaction and per-thread input snapshots remain a single ChatWidget owner.

use super::ChatWidget;

use app_server_protocol::protocol::v2::{QueuedSubmission, ServerNotification};

use crate::app::right_click_paste::PendingPaste;
use crate::bottom_pane::pending_input_preview::can_restore_submission;
use crate::clipboard_paste::ClipboardTextSource;

impl ChatWidget {
    pub(crate) fn set_pending_clipboard_paste(&mut self, pending: PendingPaste) {
        self.pending_clipboard_paste = Some(pending);
    }

    pub(crate) fn pending_clipboard_paste(&self) -> Option<&PendingPaste> {
        self.pending_clipboard_paste.as_ref()
    }

    pub(crate) fn take_pending_clipboard_paste(&mut self) -> Option<PendingPaste> {
        self.pending_clipboard_paste.take()
    }

    pub(crate) fn clear_pending_clipboard_paste(&mut self) {
        self.pending_clipboard_paste = None;
    }

    pub(crate) fn pending_clipboard_source(&self) -> Option<ClipboardTextSource> {
        self.pending_clipboard_paste
            .as_ref()
            .map(PendingPaste::source)
    }

    pub(crate) fn queued_submissions(&self) -> &[QueuedSubmission] {
        &self.queued_submissions
    }

    pub(crate) fn replace_queued_submissions(&mut self, submissions: Vec<QueuedSubmission>) {
        self.queued_submissions = submissions;
    }

    pub(crate) fn upsert_queued_submission(&mut self, submission: QueuedSubmission) {
        if let Some(existing) = self
            .queued_submissions
            .iter_mut()
            .find(|existing| existing.id == submission.id)
        {
            *existing = submission;
        } else {
            self.queued_submissions.push(submission);
        }
    }

    pub(crate) fn restore_queued_submission_for_edit(
        &mut self,
        submission: QueuedSubmission,
    ) -> bool {
        if !self.bottom_pane.composer_is_empty() || !can_restore_submission(&submission) {
            return false;
        }
        let submission_id = submission.id.clone();
        if !self.bottom_pane.restore_user_inputs(&submission.input) {
            return false;
        }
        self.queued_submissions
            .retain(|queued| queued.id != submission_id);
        true
    }

    pub(crate) fn startup_protected_request_pending(&self) -> bool {
        self.startup_pending_protected_request
    }

    pub(crate) fn clear_startup_protected_request(&mut self) {
        self.startup_pending_protected_request = false;
    }

    pub(crate) fn set_startup_protected_request_pending(&mut self, pending: bool) {
        self.startup_pending_protected_request = pending;
    }

    pub(crate) fn capture_thread_input(&mut self, thread_id: &str) {
        self.thread_input_states
            .insert(thread_id.to_string(), self.bottom_pane.take_input_state());
    }

    pub(crate) fn restore_thread_input(&mut self, thread_id: &str) {
        let state = self
            .thread_input_states
            .remove(thread_id)
            .unwrap_or_default();
        self.bottom_pane.restore_input_state(state);
        self.startup_pending_protected_request = self.bottom_pane.is_active();
    }

    pub(crate) fn observe_thread_input_notification(
        &mut self,
        thread_id: &str,
        notification: &ServerNotification,
        active_thread: bool,
    ) {
        if active_thread {
            self.bottom_pane.observe_notification(notification);
            if !self.bottom_pane.is_active() {
                self.startup_pending_protected_request = false;
            }
        } else if let Some(state) = self.thread_input_states.get_mut(thread_id) {
            state.observe_notification(notification);
        }
    }

    pub(crate) fn clear_thread_interactions(&mut self) {
        self.bottom_pane.clear_interactions();
        for state in self.thread_input_states.values_mut() {
            state.clear_interactions();
        }
        self.startup_pending_protected_request = false;
    }
}
