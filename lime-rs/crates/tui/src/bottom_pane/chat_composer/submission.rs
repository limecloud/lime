//! Submission preparation owns expansion, trimming and validation before draft consumption.

use super::*;
use agent_protocol::input::validate_user_input_text_length;
use agent_protocol::{AgentInputError, TextElement};

impl ChatComposer {
    pub(super) fn submit(&mut self) -> InputResult {
        self.handle_submission(false)
    }

    pub(super) fn queue(&mut self) -> InputResult {
        self.handle_submission(true)
    }

    fn handle_submission(&mut self, should_queue: bool) -> InputResult {
        match self.prepare_submission_text(true) {
            Ok(Some((text, text_elements))) if should_queue => InputResult::Queued {
                text,
                text_elements,
            },
            Ok(Some((text, text_elements))) => InputResult::Submitted {
                text,
                text_elements,
            },
            Ok(None) => InputResult::None,
            Err(AgentInputError::InputTooLarge { actual_chars }) => {
                InputResult::SubmissionRejected { actual_chars }
            }
            Err(_) => unreachable!("submission preparation only validates text length"),
        }
    }

    /// Validate the expanded draft before consuming any editor, attachment or history state.
    fn prepare_submission_text(
        &mut self,
        record_history: bool,
    ) -> Result<Option<(String, Vec<TextElement>)>, AgentInputError> {
        let (expanded, text_elements) = Self::expand_pending_pastes(
            self.text(),
            self.draft.textarea.text_elements(),
            &self.draft.pending_pastes,
        );
        let text = expanded.trim().to_string();
        let text_elements = Self::trim_text_elements(&expanded, &text, text_elements);
        validate_user_input_text_length(text.chars().count())?;
        if text.is_empty() && self.attachments.is_empty() {
            return Ok(None);
        }
        self.attachments
            .prune_local_images_for_submission(&text, &text_elements);
        if text.is_empty() && self.attachments.is_empty() {
            return Ok(None);
        }
        let mention_bindings = self.take_mention_bindings();
        self.draft.recent_submission_mention_bindings = mention_bindings.clone();
        if record_history {
            self.history.record_local_submission(HistoryEntry {
                text: text.clone(),
                text_elements: text_elements.clone(),
                local_images: self.local_images(),
                remote_images: self.remote_images().to_vec(),
                pending_pastes: Vec::new(),
                mention_bindings,
            });
        }
        self.draft.textarea.take();
        self.draft.pending_pastes.clear();
        self.draft.saved_draft = None;
        self.history_search = None;
        self.vim_history = VimHistory::default();
        self.footer.mode = FooterMode::ComposerEmpty;
        Ok(Some((text, text_elements)))
    }

    fn trim_text_elements(
        original: &str,
        trimmed: &str,
        elements: Vec<TextElement>,
    ) -> Vec<TextElement> {
        if trimmed.is_empty() {
            return Vec::new();
        }
        let offset = original.len() - original.trim_start().len();
        let end = offset + trimmed.len();
        elements
            .into_iter()
            .filter_map(|element| {
                let start = element.byte_range.start.max(offset);
                let stop = element.byte_range.end.min(end);
                if start >= stop {
                    return None;
                }
                let range = start - offset..stop - offset;
                Some(TextElement::new(
                    range.clone(),
                    element
                        .placeholder
                        .and_then(|_| trimmed.get(range).map(str::to_owned)),
                ))
            })
            .collect()
    }
}

#[cfg(test)]
#[path = "submission_tests.rs"]
mod tests;
