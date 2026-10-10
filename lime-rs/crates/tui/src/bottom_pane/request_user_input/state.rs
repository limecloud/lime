//! Each question owns its draft, option cursor, focus and explicit acceptance.

use super::*;
use crate::bottom_pane::scroll_state::ScrollState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Focus {
    Options,
    Notes,
}

#[derive(Debug)]
pub(super) struct AnswerState {
    pub(super) options_state: ScrollState,
    pub(super) draft: ComposerDraft,
    pub(super) answer_committed: bool,
    pub(super) focus: Focus,
}

impl AnswerState {
    pub(super) fn new(has_options: bool) -> Self {
        Self {
            options_state: ScrollState {
                selected_idx: has_options.then_some(0),
                scroll_top: 0,
            },
            draft: ComposerDraft::default(),
            answer_committed: false,
            focus: if has_options {
                Focus::Options
            } else {
                Focus::Notes
            },
        }
    }
}

impl RequestUserInputOverlay {
    pub(super) fn selected(&self) -> usize {
        self.answers
            .get(self.question_index)
            .and_then(|answer| answer.options_state.selected_idx)
            .unwrap_or(0)
    }

    pub(super) fn set_selected(&mut self, index: usize) {
        let count = self.option_count();
        if let Some(answer) = self.answers.get_mut(self.question_index) {
            if answer.options_state.selected_idx != Some(index) {
                answer.answer_committed = false;
            }
            answer.options_state.selected_idx = Some(index);
            answer.options_state.clamp_selection(count);
        }
    }

    pub(in crate::bottom_pane) fn editing(&self) -> bool {
        self.confirm_unanswered.is_none()
            && self
                .answers
                .get(self.question_index)
                .is_some_and(|answer| answer.focus == Focus::Notes)
    }

    pub(super) fn set_focus(&mut self, focus: Focus) {
        if let Some(answer) = self.answers.get_mut(self.question_index) {
            answer.focus = focus;
        }
    }

    pub(super) fn save_current_state(&mut self) {
        if let Some(answer) = self.answers.get_mut(self.question_index) {
            // Cursor-only movement preserves acceptance; changes to content require Enter again.
            if self.composer.paste_burst_needs_frame()
                || !self.composer.draft_content_equals(&answer.draft)
            {
                answer.answer_committed = false;
            }
            answer.draft = self.composer.snapshot_draft();
        }
    }

    pub(super) fn restore_current_state(&mut self) {
        let draft = self
            .answers
            .get(self.question_index)
            .map(|answer| answer.draft.clone())
            .unwrap_or_default();
        self.composer.replace_draft(draft);
    }

    pub(super) fn move_question(&mut self, next: bool) {
        let count = self.params.questions.len();
        if count < 2 {
            return;
        }
        let index = if next {
            (self.question_index + 1) % count
        } else {
            (self.question_index + count - 1) % count
        };
        self.jump_to_question(index);
    }

    pub(super) fn jump_to_question(&mut self, index: usize) {
        if index >= self.answers.len() {
            return;
        }
        self.list_key_chord_matcher.reset();
        self.composer.flush_paste_burst_before_handoff();
        self.save_current_state();
        self.question_index = index;
        self.restore_current_state();
    }

    pub(super) fn move_option(&mut self, next: bool) {
        let count = self.option_count();
        if count == 0 {
            return;
        }
        if let Some(answer) = self.answers.get_mut(self.question_index) {
            let previous = answer.options_state.selected_idx;
            if next {
                answer.options_state.move_down_wrap(count);
            } else {
                answer.options_state.move_up_wrap(count);
            }
            if answer.options_state.selected_idx != previous {
                answer.answer_committed = false;
            }
        }
        self.save_current_state();
    }

    pub(super) fn commit(&mut self) -> Option<AppServerResponse> {
        if let Some(draft) = self.pending_submission_draft.take() {
            self.composer.replace_draft(draft);
        }
        self.save_current_state();
        let committed =
            self.has_options() || !self.composer.current_text_with_pending().trim().is_empty();
        if let Some(answer) = self.answers.get_mut(self.question_index) {
            answer.answer_committed = committed;
        }
        if self.question_index + 1 >= self.params.questions.len() {
            if self.unanswered_count() > 0 {
                self.open_unanswered_confirmation();
                return None;
            }
            return Some(self.finish());
        }
        self.question_index += 1;
        self.restore_current_state();
        None
    }

    pub(super) fn clear_notes_and_focus_options(&mut self) {
        self.pending_submission_draft = None;
        self.composer.replace(String::new());
        self.set_focus(Focus::Options);
        self.save_current_state();
    }

    pub(super) fn unanswered_count(&self) -> usize {
        self.answers
            .iter()
            .filter(|answer| !answer.answer_committed)
            .count()
    }

    pub(super) fn first_unanswered_index(&self) -> Option<usize> {
        self.answers
            .iter()
            .position(|answer| !answer.answer_committed)
    }

    pub(super) fn finish(&self) -> AppServerResponse {
        let answers = self
            .params
            .questions
            .iter()
            .zip(&self.answers)
            .map(|(question, state)| {
                let mut answers = Vec::new();
                if state.answer_committed {
                    let has_options = question
                        .options
                        .as_ref()
                        .is_some_and(|options| !options.is_empty());
                    if let Some(options) = question.options.as_ref().filter(|_| has_options) {
                        let index = state.options_state.selected_idx.unwrap_or(0);
                        if let Some(option) = options.get(index) {
                            answers.push(option.label.clone());
                        } else if question.is_other && index == options.len() {
                            answers.push(OTHER_OPTION_LABEL.into());
                        }
                    }
                    let text = state.draft.text_with_pending();
                    let note = text.trim();
                    if !note.is_empty() {
                        answers.push(format!("user_note: {note}"));
                    }
                }
                (question.id.clone(), ToolRequestUserInputAnswer { answers })
            })
            .collect();
        AppServerResponse::UserInput {
            id: self.id.clone(),
            response: ToolRequestUserInputResponse { answers },
        }
    }
}
