//! Semantic Vim editing transactions, character find/till motions, and complete-change replay.
//!
//! `f`/`F` land on a matching grapheme; `t`/`T` stop just before/after it. Forward operator
//! motions include the destination, while backward motions exclude the original cursor.
//! All four motions share these boundaries for navigation, `c`/`d`/`y`, and semantic `.` replay.

use super::vim::{
    VimFindMotion, VimMode, VimMotion, VimOperator, VimPending, VimTextObject, VimTextObjectScope,
};
use super::TextArea;
use crate::vim_search::SearchQuery;
use unicode_segmentation::{GraphemeCursor, UnicodeSegmentation};

#[derive(Clone, Debug)]
pub(crate) enum VimEdit {
    Editor(VimEditorEdit),
    Text(String),
}

/// Vim command recording and searches preserved across same-draft restoration.
#[derive(Debug, Default)]
pub(crate) struct VimPersistentState {
    pub(crate) commands: VimCommandState,
    search: crate::vim_search::SearchQuery,
}

#[derive(Clone, Debug)]
pub(crate) struct VimEditorEdit(VimAction);

#[derive(Clone, Copy, Debug)]
pub(super) enum VimInsertPosition {
    Cursor,
    AfterCursor,
    LineStart,
    LineEnd,
    OpenAbove,
    OpenBelow,
}

#[derive(Clone, Debug)]
pub(super) enum VimEditTarget {
    Character,
    Line,
    LineEnd,
    Motion(VimMotion),
    Search(SearchQuery),
    TextObject {
        scope: VimTextObjectScope,
        object: VimTextObject,
    },
    Find {
        motion: VimFindMotion,
        target: char,
    },
    BufferJump {
        last: bool,
    },
}

#[derive(Clone, Debug)]
pub(super) enum VimAction {
    Insert(VimInsertPosition),
    EnterReplaceMode,
    RestoreReplacedCharacter,
    Delete(VimEditTarget),
    Change(VimEditTarget),
    Replace(char),
    PasteAfter,
    DeleteBackward,
    DeleteForward,
    DeleteBackwardWord,
    DeleteForwardWord,
    KillLineStart,
    KillLine,
    KillLineEnd,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown,
    MoveWordLeft,
    MoveWordRight,
    MoveLineStart { move_up_at_bol: bool },
    MoveLineEnd { move_down_at_eol: bool },
}

#[derive(Debug, Default)]
pub(crate) struct VimCommandState {
    pub(super) pending_change: Vec<VimEdit>,
    pub(crate) last_change: Vec<VimEdit>,
    changed: bool,
    pub(super) replaying: bool,
    replace_steps: Vec<VimReplaceStep>,
}

#[derive(Debug)]
struct VimReplaceStep {
    // Backspace also retraces attachments skipped before the replacement.
    cursor_before: usize,
    start: usize,
    inserted_len: usize,
    original: String,
}

impl TextArea {
    pub(crate) fn is_vim_replace_mode(&self) -> bool {
        self.vim_enabled && self.vim_mode == VimMode::Replace
    }

    pub(super) fn clear_vim_replace_recovery(&mut self) {
        self.vim_commands.replace_steps.clear();
    }

    pub(super) fn replace_vim_text(&mut self, text: &str) {
        for grapheme in text.graphemes(/*is_extended*/ true) {
            let cursor_before = self.cursor;
            while let Some(element) = self
                .elements
                .iter()
                .find(|element| element.range.start == self.cursor)
            {
                self.set_cursor(element.range.end);
            }
            let start = self.cursor;
            let end = if grapheme == "\n" || start >= self.line_end() {
                start
            } else {
                self.next_grapheme_end_at(start)
            };
            let original = self.text[start..end].to_string();
            self.replace_range_preserving_recovery(start..end, grapheme);
            self.vim_commands.replace_steps.push(VimReplaceStep {
                cursor_before,
                start,
                inserted_len: grapheme.len(),
                original,
            });
        }
    }

    pub(super) fn restore_vim_replaced_character(&mut self) -> bool {
        let steps = &mut self.vim_commands.replace_steps;
        let Some(step) = steps
            .pop()
            .filter(|step| self.cursor == step.start + step.inserted_len)
        else {
            steps.clear();
            return false;
        };
        // Replace skips existing elements, so an overlapping marker was added after typing.
        // Unmark it before restoring one character; never expand recovery to the whole token.
        self.elements.retain(|element| {
            element.range.end <= step.start || element.range.start >= step.start + step.inserted_len
        });
        self.replace_range_preserving_recovery(
            step.start..step.start + step.inserted_len,
            &step.original,
        );
        self.set_cursor(step.cursor_before);
        true
    }

    /// Retract a detected paste prefix without losing overwritten text or crossing attachments.
    pub(crate) fn retract_paste_burst(&mut self, start: usize) -> bool {
        if start > self.cursor
            || !self.text.is_char_boundary(start)
            || !GraphemeCursor::new(start, self.text.len(), true)
                .is_boundary(&self.text, 0)
                .unwrap_or(false)
            || self
                .elements
                .iter()
                .any(|element| element.range.start < self.cursor && start < element.range.end)
        {
            return false;
        }
        if self.is_vim_replace_mode() {
            let restored_start = self
                .vim_commands
                .replace_steps
                .iter()
                .rev()
                .take_while(|step| step.start >= start)
                .try_fold(self.cursor, |cursor, step| {
                    (step.start + step.inserted_len == cursor && step.cursor_before == step.start)
                        .then_some(step.start)
                });
            if restored_start != Some(start) {
                return false;
            }
            while self.cursor > start {
                self.apply_vim_insert_action(VimAction::RestoreReplacedCharacter);
            }
        } else {
            // The visible prefix was already recorded. Retract it through semantic
            // deletions as well, so dot replay does not insert that prefix twice.
            while self.cursor > start {
                self.apply_vim_insert_action(VimAction::DeleteBackward);
            }
        }
        true
    }

    pub(crate) fn swap_vim_persistent_state(&mut self, state: &mut VimPersistentState) {
        std::mem::swap(&mut self.vim_commands, &mut state.commands);
        std::mem::swap(&mut self.vim_search.last, &mut state.search);
    }

    pub(crate) fn vim_repeat_actions(&self) -> Option<Vec<VimEdit>> {
        (!self.vim_commands.last_change.is_empty()).then(|| self.vim_commands.last_change.clone())
    }

    pub(super) fn record_vim_inserted_text(&mut self, text: &str) {
        if !self.vim_enabled
            || !matches!(self.vim_mode, VimMode::Insert | VimMode::Replace)
            || self.vim_commands.replaying
            || self.vim_commands.pending_change.is_empty()
            || text.is_empty()
        {
            return;
        }
        if self.vim_mode == VimMode::Insert {
            if let Some(VimEdit::Text(pending)) = self.vim_commands.pending_change.last_mut() {
                pending.push_str(text);
                self.vim_commands.changed = true;
                return;
            }
        }
        self.vim_commands
            .pending_change
            .push(VimEdit::Text(text.to_owned()));
        self.vim_commands.changed = true;
    }

    pub(super) fn apply_vim_insert_action(&mut self, action: VimAction) -> bool {
        let deletion = matches!(
            action,
            VimAction::DeleteBackward
                | VimAction::DeleteForward
                | VimAction::DeleteBackwardWord
                | VimAction::DeleteForwardWord
                | VimAction::KillLineStart
                | VimAction::KillLine
                | VimAction::KillLineEnd
        );
        let selection = if deletion {
            self.mouse_selection_range()
        } else {
            None
        };
        if let Some(range) = selection {
            self.vim_commands = VimCommandState::default();
            if matches!(action, VimAction::DeleteBackward | VimAction::DeleteForward) {
                self.replace_range(range, "");
            } else {
                self.kill_range(range);
            }
            return true;
        }
        self.mouse_selection = None;
        let recording = self.vim_enabled
            && matches!(self.vim_mode, VimMode::Insert | VimMode::Replace)
            && !self.vim_commands.replaying
            && !self.vim_commands.pending_change.is_empty();
        let prior_len = self.text.len();
        if !self.apply_vim_editor_action(action.clone()) {
            return false;
        }
        let changed =
            self.text.len() != prior_len || matches!(action, VimAction::RestoreReplacedCharacter);
        if recording && (changed || !deletion) {
            self.vim_commands
                .pending_change
                .push(VimEdit::Editor(VimEditorEdit(action)));
        }
        self.vim_commands.changed |= recording && changed;
        true
    }

    pub(super) fn start_vim_edit(&mut self, action: VimAction) -> bool {
        let prior_len = self.text.len();
        self.vim_commands.pending_change = vec![VimEdit::Editor(VimEditorEdit(action.clone()))];
        self.vim_commands.changed = false;
        if !self.apply_vim_editor_action(action.clone()) {
            self.vim_commands.pending_change.clear();
            return false;
        }
        self.vim_commands.changed =
            self.text.len() != prior_len || matches!(action, VimAction::Replace(_));
        if self.vim_mode == VimMode::Normal {
            self.finish_pending_vim_change();
        }
        true
    }

    pub(super) fn finish_pending_vim_change(&mut self) {
        if self.vim_commands.changed {
            self.vim_commands.last_change = std::mem::take(&mut self.vim_commands.pending_change);
        } else {
            self.vim_commands.pending_change.clear();
        }
        self.vim_commands.changed = false;
    }

    pub(crate) fn begin_vim_repeat(&mut self) -> Option<Vec<VimEdit>> {
        let edits = self.vim_repeat_actions()?;
        self.vim_commands.replaying = true;
        Some(edits)
    }

    pub(crate) fn finish_vim_repeat(&mut self) {
        if matches!(self.vim_mode, VimMode::Insert | VimMode::Replace) {
            self.leave_vim_insert_mode();
        }
        self.vim_pending = VimPending::None;
        self.vim_commands.replaying = false;
    }

    pub(crate) fn apply_vim_edit(&mut self, edit: &VimEdit) -> bool {
        match edit {
            VimEdit::Editor(VimEditorEdit(action)) => self.apply_vim_editor_action(action.clone()),
            VimEdit::Text(text) => {
                if !matches!(self.vim_mode, VimMode::Insert | VimMode::Replace) {
                    return false;
                }
                self.insert_str(text);
                true
            }
        }
    }

    fn apply_vim_editor_action(&mut self, action: VimAction) -> bool {
        // Editor actions invalidate contiguous Replace offsets, including during replay.
        if !matches!(action, VimAction::RestoreReplacedCharacter) {
            self.clear_vim_replace_recovery();
        }
        let prior_len = self.text.len();
        let is_change = matches!(action, VimAction::Change(_));
        match action {
            VimAction::EnterReplaceMode => {
                self.vim_mode = VimMode::Replace;
            }
            VimAction::RestoreReplacedCharacter => {
                return self.restore_vim_replaced_character();
            }
            VimAction::Insert(position) => {
                match position {
                    VimInsertPosition::Cursor => {}
                    VimInsertPosition::AfterCursor => {
                        self.set_cursor(self.next_grapheme_end_at(self.cursor));
                    }
                    VimInsertPosition::LineStart => {
                        self.set_cursor(self.first_non_blank_of_current_line());
                    }
                    VimInsertPosition::LineEnd => self.set_cursor(self.line_end()),
                    VimInsertPosition::OpenAbove => {
                        let bol = self.line_start();
                        self.insert_str_at(bol, "\n");
                        self.set_cursor(bol);
                    }
                    VimInsertPosition::OpenBelow => {
                        let eol = self.line_end();
                        let insert_at = if eol < prior_len { eol + 1 } else { eol };
                        self.insert_str_at(insert_at, "\n");
                        self.set_cursor(if eol < prior_len {
                            insert_at
                        } else {
                            insert_at + 1
                        });
                    }
                }
                self.enter_vim_insert_mode();
            }
            VimAction::Delete(target) | VimAction::Change(target) => {
                let operator = if !is_change {
                    VimOperator::Delete
                } else {
                    VimOperator::Change
                };
                match target {
                    VimEditTarget::Character => {
                        if self.cursor < self.line_end() {
                            self.delete_forward_kill(/*n*/ 1);
                        }
                        if operator == VimOperator::Change {
                            self.vim_mode = VimMode::Insert;
                        }
                    }
                    VimEditTarget::Line => {
                        if operator == VimOperator::Delete {
                            self.kill_line_range(self.current_line_range_with_newline());
                        } else {
                            let range = self.line_start()..self.line_end();
                            self.kill_line_range(range);
                            self.vim_mode = VimMode::Insert;
                        }
                    }
                    VimEditTarget::LineEnd => {
                        self.delete_to_line_end(false);
                        if operator == VimOperator::Change {
                            self.vim_mode = VimMode::Insert;
                        }
                    }
                    VimEditTarget::Motion(motion) => self.apply_vim_operator(operator, motion),
                    VimEditTarget::Search(query) => {
                        if !self.apply_vim_search(&query, Some(operator)) {
                            return false;
                        }
                    }
                    VimEditTarget::TextObject { scope, object } => {
                        let Some(range) = self.text_object_range(object, scope) else {
                            return false;
                        };
                        self.apply_vim_operator_to_range(operator, range);
                    }
                    VimEditTarget::Find { motion, target } => {
                        if !self.find_vim_character(motion, Some(operator), target) {
                            return false;
                        }
                    }
                    VimEditTarget::BufferJump { last } => {
                        self.jump_to_vim_buffer_line(last, Some(operator));
                    }
                }
                if operator == VimOperator::Change {
                    return self.vim_mode == VimMode::Insert;
                }
                return self.text.len() != prior_len;
            }
            VimAction::Replace(ch) => {
                if self.cursor >= self.line_end() {
                    return false;
                }
                let start = self.cursor;
                let end = self.next_grapheme_end_at(start);
                self.replace_range(start..end, &ch.to_string());
                self.set_cursor(start + usize::from(ch == '\n'));
            }
            VimAction::PasteAfter => {
                self.paste_after_cursor();
                return self.text.len() != prior_len;
            }
            VimAction::DeleteBackward => self.delete_backward(/*n*/ 1),
            VimAction::DeleteForward => self.delete_forward(/*n*/ 1),
            VimAction::DeleteBackwardWord => self.delete_backward_word(),
            VimAction::DeleteForwardWord => self.delete_forward_word(),
            VimAction::KillLineStart => self.kill_to_beginning_of_line(),
            VimAction::KillLine => self.kill_line_range(self.current_line_range_with_newline()),
            VimAction::KillLineEnd => self.kill_to_end_of_line(),
            VimAction::MoveLeft => self.move_left(),
            VimAction::MoveRight => self.move_right(),
            VimAction::MoveUp => self.move_up(),
            VimAction::MoveDown => self.move_down(),
            VimAction::MoveWordLeft => self.set_cursor(self.beginning_of_previous_word()),
            VimAction::MoveWordRight => self.set_cursor(self.end_of_next_word()),
            VimAction::MoveLineStart { move_up_at_bol } => {
                if move_up_at_bol && self.cursor == self.line_start() {
                    self.move_up();
                }
                self.move_line_start();
            }
            VimAction::MoveLineEnd { move_down_at_eol } => {
                if move_down_at_eol && self.cursor == self.line_end() {
                    self.move_down();
                }
                self.move_line_end();
            }
        }
        true
    }

    pub(super) fn find_vim_character(
        &mut self,
        motion: VimFindMotion,
        operator: Option<VimOperator>,
        target: char,
    ) -> bool {
        let origin = self.cursor;
        let line_start = self.line_start();
        let line_end = self.line_end();
        let found = match motion {
            VimFindMotion::Forward | VimFindMotion::TillForward => {
                let start = self.next_grapheme_end_at(origin);
                if start >= line_end {
                    return false;
                }
                self.text[start..line_end]
                    .grapheme_indices(true)
                    .find(|(offset, grapheme)| {
                        grapheme.starts_with(target) && self.is_vim_command_target(start + offset)
                    })
                    .map(|(offset, grapheme)| start + offset..start + offset + grapheme.len())
            }
            VimFindMotion::Backward | VimFindMotion::TillBackward => self.text[line_start..origin]
                .grapheme_indices(true)
                .rev()
                .find(|(offset, grapheme)| {
                    grapheme.starts_with(target) && self.is_vim_command_target(line_start + offset)
                })
                .map(|(offset, grapheme)| {
                    let start = line_start + offset;
                    start..start + grapheme.len()
                }),
        };
        let Some(position) = found else {
            return false;
        };

        if let Some(operator) = operator {
            let range = match motion {
                VimFindMotion::Forward => origin..position.end,
                VimFindMotion::Backward => position.start..origin,
                VimFindMotion::TillForward => origin..position.start,
                VimFindMotion::TillBackward => position.end..origin,
            };
            if operator == VimOperator::Yank {
                self.set_cursor(range.start);
            }
            self.apply_vim_operator_to_range(operator, range);
        } else {
            let destination = match motion {
                VimFindMotion::Forward | VimFindMotion::Backward => position.start,
                VimFindMotion::TillForward => self.previous_grapheme_start_at(position.start),
                VimFindMotion::TillBackward => position.end,
            };
            self.set_cursor(destination.min(self.vim_normal_end_cursor()));
        }
        true
    }

    pub(super) fn jump_to_vim_buffer_line(&mut self, last: bool, operator: Option<VimOperator>) {
        if let Some(operator) = operator {
            let current = self.line_start()..self.line_end();
            let range = if last {
                current.start..self.text.len()
            } else {
                0..current.end + usize::from(current.end < self.text.len())
            };
            self.apply_vim_line_operator(operator, range);
        } else {
            let start = if last {
                self.text.rfind('\n').map_or(0, |index| index + 1)
            } else {
                0
            };
            self.set_cursor(start);
            self.set_cursor(self.first_non_blank_of_current_line());
        }
    }

    pub(super) fn is_vim_command_target(&self, position: usize) -> bool {
        !self
            .elements
            .iter()
            .any(|element| element.range.contains(&position))
            && GraphemeCursor::new(position, self.text.len(), true)
                .is_boundary(&self.text, 0)
                .unwrap_or(false)
    }
}

#[cfg(test)]
#[path = "vim_commands_tests.rs"]
mod tests;
