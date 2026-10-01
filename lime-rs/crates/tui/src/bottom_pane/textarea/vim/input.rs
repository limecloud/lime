//! Modal dispatch resolves actions once; semantic edits never replay raw keys.

use super::super::vim_commands::VimEditTarget;
use super::*;
use crate::keymap::{
    KeymapContext, KeymapMatch, VimKeymap, VimKeymapAction, VimNormalAction, VimOperatorAction,
    VimTextObjectAction,
};

impl TextArea {
    pub(crate) fn keymap_context(&self) -> KeymapContext {
        if !self.vim_enabled || self.allows_paste_burst() || self.vim_search_query().is_some() {
            return KeymapContext::Editor;
        }
        match self.vim_pending {
            VimPending::None => KeymapContext::VimNormal,
            VimPending::Operator(_) => KeymapContext::VimOperator,
            VimPending::TextObject { .. } => KeymapContext::VimTextObject,
            VimPending::Find { .. } | VimPending::Replace => KeymapContext::Editor,
        }
    }

    fn vim_keymap(&self) -> VimKeymap<'_> {
        VimKeymap {
            normal: &self.vim_normal_keymap,
            operator: &self.vim_operator_keymap,
            text_object: &self.vim_text_object_keymap,
            search: &self.vim_search_keymap,
        }
    }

    fn resolve_vim_key(
        &self,
        event: KeyEvent,
    ) -> (KeymapMatch<VimKeymapAction>, crate::keymap::KeyChordMatcher) {
        let mut matcher = self.vim_key_chord_matcher;
        let action = self.vim_keymap().dispatch(
            self.keymap_context(),
            self.vim_pending == VimPending::Operator(VimOperator::Change),
            &mut matcher,
            event,
        );
        (action, matcher)
    }

    pub(crate) fn vim_action_for_key(&self, event: KeyEvent) -> Option<VimKeymapAction> {
        match self.resolve_vim_key(event).0 {
            KeymapMatch::Completed(action) => Some(action),
            _ => None,
        }
    }

    pub(crate) fn vim_key_chord_pending(&self) -> bool {
        self.vim_key_chord_matcher.is_pending()
    }

    pub(crate) fn vim_key_event_is_owned(&self, event: KeyEvent) -> bool {
        if self.vim_action_for_key(event)
            == Some(VimKeymapAction::Normal(VimNormalAction::CancelOperator))
            && !self.is_vim_operator_pending()
        {
            // Idle Normal Esc belongs to the host interrupt boundary, not pending cancellation.
            return false;
        }
        matches!(event.kind, KeyEventKind::Press | KeyEventKind::Repeat)
            && self.is_vim_normal_mode()
            && (self.is_vim_operator_pending()
                || !matches!(self.resolve_vim_key(event).0, KeymapMatch::PassThrough))
    }

    pub(crate) fn vim_key_starts_edit(&self, event: KeyEvent) -> bool {
        use VimNormalAction::*;
        matches!(
            self.vim_action_for_key(event),
            Some(VimKeymapAction::Normal(
                EnterInsert
                    | AppendAfterCursor
                    | AppendLineEnd
                    | InsertLineStart
                    | OpenLineBelow
                    | OpenLineAbove
                    | EnterReplaceMode
                    | DeleteChar
                    | ReplaceChar
                    | RepeatLastChange
                    | SubstituteChar
                    | DeleteToLineEnd
                    | ChangeToLineEnd
                    | PasteAfter
                    | StartDeleteOperator
                    | StartChangeOperator
            ))
        )
    }

    pub(in super::super) fn handle_vim_input(&mut self, event: KeyEvent) {
        if self.vim_search_query().is_some() {
            self.handle_vim_search_key(event);
            return;
        }
        if matches!(self.vim_mode, VimMode::Insert | VimMode::Replace) {
            if event.code == KeyCode::Esc && event.modifiers == KeyModifiers::NONE {
                self.leave_vim_insert_mode();
            } else {
                self.input_insert_mode(event);
            }
            return;
        }
        // Find and replace capture a literal character, not a modal command.
        if let VimPending::Find { motion, operator } = self.vim_pending {
            self.vim_pending = VimPending::None;
            if let Some(target) = plain_char(event).and_then(|value| value.chars().next()) {
                self.apply_vim_target(operator, VimEditTarget::Find { motion, target });
            }
            return;
        }
        if self.vim_pending == VimPending::Replace {
            self.vim_pending = VimPending::None;
            if let Some(value) = plain_char(event) {
                self.start_vim_edit(VimAction::Replace(value.chars().next().unwrap()));
            }
            return;
        }

        let (resolved, matcher) = self.resolve_vim_key(event);
        self.vim_key_chord_matcher = matcher;
        match resolved {
            KeymapMatch::Pending => {}
            KeymapMatch::Cancelled | KeymapMatch::PassThrough => {
                self.vim_pending = VimPending::None
            }
            KeymapMatch::Completed(VimKeymapAction::Normal(action)) => {
                self.handle_vim_normal(action)
            }
            KeymapMatch::Completed(VimKeymapAction::Search(action)) => {
                self.apply_vim_search_action(action)
            }
            KeymapMatch::Completed(VimKeymapAction::Operator(action)) => {
                if let VimPending::Operator(operator) = self.vim_pending {
                    self.vim_pending = VimPending::None;
                    self.handle_vim_operator(operator, action);
                }
            }
            KeymapMatch::Completed(VimKeymapAction::TextObject(action)) => {
                if let VimPending::TextObject { operator, scope } = self.vim_pending {
                    self.vim_pending = VimPending::None;
                    self.handle_vim_text_object(operator, scope, action);
                }
            }
            KeymapMatch::Completed(VimKeymapAction::ChangeLine) => {
                self.vim_pending = VimPending::None;
                self.start_vim_edit(VimAction::Change(VimEditTarget::Line));
            }
        }
    }

    fn handle_vim_normal(&mut self, action: VimNormalAction) {
        use VimNormalAction::*;
        let insert = match action {
            EnterInsert => Some(VimInsertPosition::Cursor),
            AppendAfterCursor => Some(VimInsertPosition::AfterCursor),
            AppendLineEnd => Some(VimInsertPosition::LineEnd),
            InsertLineStart => Some(VimInsertPosition::LineStart),
            OpenLineBelow => Some(VimInsertPosition::OpenBelow),
            OpenLineAbove => Some(VimInsertPosition::OpenAbove),
            _ => None,
        };
        if let Some(position) = insert {
            self.start_vim_edit(VimAction::Insert(position));
            return;
        }
        match action {
            EnterReplaceMode => {
                self.start_vim_edit(VimAction::EnterReplaceMode);
            }
            ReplaceChar => self.vim_pending = VimPending::Replace,
            RepeatLastChange => {
                if let Some(edits) = self.begin_vim_repeat() {
                    for edit in edits {
                        if !self.apply_vim_edit(&edit) {
                            break;
                        }
                    }
                    self.finish_vim_repeat();
                }
            }
            MoveLeft => self.move_left_normal(),
            MoveRight => self.move_right_normal(),
            MoveUp => self.move_vertical(-1),
            MoveDown => self.move_vertical(1),
            MoveWordForward => self.move_word_forward(),
            MoveWordBackward => self.set_cursor(self.beginning_of_previous_word()),
            MoveWordEnd => self.set_cursor(self.vim_word_end_cursor()),
            MoveLineStart => self.move_line_start(),
            MoveLineEnd => self.set_cursor(self.vim_line_end()),
            JumpTop | JumpBottom => self.jump_to_vim_buffer_line(action == JumpBottom, None),
            FindForward | FindBackward | TillForward | TillBackward => {
                let motion = match action {
                    FindForward => VimFindMotion::Forward,
                    FindBackward => VimFindMotion::Backward,
                    TillForward => VimFindMotion::TillForward,
                    _ => VimFindMotion::TillBackward,
                };
                self.vim_pending = VimPending::Find {
                    motion,
                    operator: None,
                };
            }
            DeleteChar => {
                self.start_vim_edit(VimAction::Delete(VimEditTarget::Character));
            }
            SubstituteChar => {
                self.start_vim_edit(VimAction::Change(VimEditTarget::Character));
            }
            DeleteToLineEnd => {
                self.start_vim_edit(VimAction::Delete(VimEditTarget::LineEnd));
            }
            ChangeToLineEnd => {
                self.start_vim_edit(VimAction::Change(VimEditTarget::LineEnd));
            }
            YankLine => self.yank_current_line(),
            PasteAfter => {
                self.start_vim_edit(VimAction::PasteAfter);
            }
            StartDeleteOperator => self.vim_pending = VimPending::Operator(VimOperator::Delete),
            StartYankOperator => self.vim_pending = VimPending::Operator(VimOperator::Yank),
            StartChangeOperator => self.vim_pending = VimPending::Operator(VimOperator::Change),
            CancelOperator => {
                self.vim_pending = VimPending::None;
                self.vim_search.cancel();
            }
            // Rich-draft undo/redo belongs to ChatComposer; it consumes these same actions.
            Undo | Redo => {}
            EnterInsert | AppendAfterCursor | AppendLineEnd | InsertLineStart | OpenLineBelow
            | OpenLineAbove => unreachable!(),
        }
    }

    fn handle_vim_operator(&mut self, operator: VimOperator, action: VimOperatorAction) {
        use VimOperatorAction::*;
        let target = match action {
            DeleteLine if operator == VimOperator::Delete => VimEditTarget::Line,
            YankLine if operator == VimOperator::Yank => {
                self.yank_current_line();
                return;
            }
            MotionLeft => VimEditTarget::Motion(VimMotion::Left),
            MotionRight => VimEditTarget::Motion(VimMotion::Right),
            MotionUp => VimEditTarget::Motion(VimMotion::Up),
            MotionDown => VimEditTarget::Motion(VimMotion::Down),
            MotionWordForward => VimEditTarget::Motion(VimMotion::WordForward),
            MotionWordBackward => VimEditTarget::Motion(VimMotion::WordBackward),
            MotionWordEnd => VimEditTarget::Motion(VimMotion::WordEnd),
            MotionLineStart => VimEditTarget::Motion(VimMotion::LineStart),
            MotionLineEnd => VimEditTarget::Motion(VimMotion::LineEnd),
            MotionJumpTop | MotionJumpBottom => VimEditTarget::BufferJump {
                last: action == MotionJumpBottom,
            },
            MotionFindForward | MotionFindBackward | MotionTillForward | MotionTillBackward => {
                let motion = match action {
                    MotionFindForward => VimFindMotion::Forward,
                    MotionFindBackward => VimFindMotion::Backward,
                    MotionTillForward => VimFindMotion::TillForward,
                    _ => VimFindMotion::TillBackward,
                };
                self.vim_pending = VimPending::Find {
                    motion,
                    operator: Some(operator),
                };
                return;
            }
            SelectInnerTextObject | SelectAroundTextObject => {
                let scope = if action == SelectInnerTextObject {
                    VimTextObjectScope::Inner
                } else {
                    VimTextObjectScope::Around
                };
                self.vim_pending = VimPending::TextObject { operator, scope };
                return;
            }
            DeleteLine | YankLine | Cancel => return,
        };
        self.apply_vim_target(Some(operator), target);
    }

    fn handle_vim_text_object(
        &mut self,
        operator: VimOperator,
        scope: VimTextObjectScope,
        action: VimTextObjectAction,
    ) {
        use VimTextObjectAction::*;
        let object = match action {
            Word => VimTextObject::Word,
            BigWord => VimTextObject::BigWord,
            Parentheses => VimTextObject::Parentheses,
            Brackets => VimTextObject::Brackets,
            Braces => VimTextObject::Braces,
            DoubleQuote => VimTextObject::DoubleQuote,
            SingleQuote => VimTextObject::SingleQuote,
            Backtick => VimTextObject::Backtick,
            Cancel => return,
        };
        self.apply_vim_target(Some(operator), VimEditTarget::TextObject { scope, object });
    }

    fn apply_vim_target(&mut self, operator: Option<VimOperator>, target: VimEditTarget) {
        match operator {
            Some(VimOperator::Delete) => {
                self.start_vim_edit(VimAction::Delete(target));
            }
            Some(VimOperator::Change) => {
                self.start_vim_edit(VimAction::Change(target));
            }
            _ => match target {
                VimEditTarget::Find { motion, target } => {
                    self.find_vim_character(motion, operator, target);
                }
                VimEditTarget::BufferJump { last } => self.jump_to_vim_buffer_line(last, operator),
                VimEditTarget::Motion(motion) => self.apply_vim_operator(VimOperator::Yank, motion),
                VimEditTarget::TextObject { scope, object } => {
                    if let Some(range) = self.text_object_range(object, scope) {
                        self.yank_range(range);
                    }
                }
                _ => {}
            },
        }
    }
}

#[cfg(test)]
#[path = "keymap_tests.rs"]
mod tests;
