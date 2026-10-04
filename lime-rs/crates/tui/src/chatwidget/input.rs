//! Thread-local input handoff owned by `ChatWidget`.
//!
//! The terminal host chooses which thread is active and owns transport channels. The rich draft,
//! pending interaction and per-thread input snapshots remain a single ChatWidget owner.

use super::ChatWidget;
use std::path::PathBuf;

use app_server_protocol::protocol::v2::{QueuedSubmission, ServerNotification, UserInput};

use crate::app::right_click_paste::PendingPaste;
use crate::bottom_pane::pending_input_preview::can_restore_submission;
use crate::bottom_pane::{LocalImageAttachment, MentionBinding, RemoteImageAttachment};
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
        let mut text = String::new();
        let mut text_elements = Vec::new();
        let mut local_images = Vec::new();
        let mut remote_images = Vec::new();
        let mut mention_bindings = Vec::new();
        for input in submission.input {
            match input {
                UserInput::Text {
                    text: value,
                    text_elements: elements,
                } => {
                    let offset = text.len();
                    text.push_str(&value);
                    text_elements.extend(elements.into_iter().map(|mut element| {
                        element.byte_range.start += offset;
                        element.byte_range.end += offset;
                        element
                    }));
                }
                UserInput::LocalImage { path, detail } => {
                    local_images.push((PathBuf::from(path), detail))
                }
                UserInput::Image { url, detail } => {
                    remote_images.push(RemoteImageAttachment { url, detail })
                }
                UserInput::Skill { name, path } => mention_bindings.push(MentionBinding {
                    sigil: '$',
                    mention: name,
                    path,
                }),
                _ => return false,
            }
        }
        self.queued_submissions
            .retain(|queued| queued.id != submission_id);

        // Reuse existing canonical mention elements; only prepend skills absent from text.
        let mut available = std::collections::HashMap::<&str, usize>::new();
        for element in &text_elements {
            if let Some(token) = text.get(element.byte_range.start..element.byte_range.end) {
                *available.entry(token).or_default() += 1;
            }
        }
        let mut present = Vec::new();
        let mut missing = Vec::new();
        for binding in mention_bindings {
            let token = format!("${}", binding.mention);
            if let Some(count) = available
                .get_mut(token.as_str())
                .filter(|count| **count > 0)
            {
                *count -= 1;
                present.push(binding);
            } else {
                missing.push(binding);
            }
        }
        if !missing.is_empty() {
            let prefix = missing
                .iter()
                .map(|binding| format!("${}", binding.mention))
                .collect::<Vec<_>>()
                .join(" ");
            let offset = prefix.len() + usize::from(!text.is_empty());
            for element in &mut text_elements {
                element.byte_range.start += offset;
                element.byte_range.end += offset;
            }
            let mut start = 0;
            let mut prefix_elements = Vec::new();
            for binding in &missing {
                let token = format!("${}", binding.mention);
                prefix_elements.push(agent_protocol::TextElement::new(
                    start..start + token.len(),
                    Some(token.clone()),
                ));
                start += token.len() + 1;
            }
            prefix_elements.extend(text_elements);
            text_elements = prefix_elements;
            text = if text.is_empty() {
                prefix
            } else {
                format!("{prefix} {text}")
            };
        }
        let mention_bindings = missing.into_iter().chain(present).collect();
        let local_images = local_images
            .into_iter()
            .enumerate()
            .map(|(index, (path, detail))| LocalImageAttachment {
                placeholder: format!("[Image #{}]", remote_images.len() + index + 1),
                path,
                detail,
            })
            .collect();
        self.bottom_pane.set_composer_text_with_mention_bindings(
            text,
            text_elements,
            local_images,
            remote_images,
            mention_bindings,
        );
        self.bottom_pane.clear_completion_popup();
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
