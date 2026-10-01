//! Query state and literal search motions for the TextArea Vim owner.

use super::super::TextArea;
use super::vim::{VimMode, VimOperator, VimPending};
use crate::vim_search::{matching_ranges, SearchDirection, SearchQuery};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Debug, Default)]
pub(super) struct VimSearch {
    input: Option<Box<SearchInput>>,
    pub(super) last: SearchQuery,
}

#[derive(Debug)]
struct SearchInput {
    editor: TextArea,
    direction: SearchDirection,
}

impl VimSearch {
    pub(super) fn cancel(&mut self) {
        self.input = None;
    }
}

impl TextArea {
    pub(super) fn set_vim_search_editor_keymap(&mut self, keymap: &crate::keymap::RuntimeKeymap) {
        if let Some(input) = self.vim_search.input.as_deref_mut() {
            input.editor.set_keymap_bindings(keymap);
        }
    }

    pub(crate) fn vim_search_query(&self) -> Option<(&str, SearchDirection)> {
        self.vim_search
            .input
            .as_deref()
            .map(|input| (input.editor.text(), input.direction))
    }

    pub(crate) fn insert_vim_search_text(&mut self, text: &str) -> bool {
        let Some(input) = self.vim_search.input.as_deref_mut() else {
            return false;
        };
        input.editor.insert_str(text);
        true
    }

    pub(crate) fn wants_vim_search_key(&self, event: KeyEvent) -> bool {
        self.vim_search.input.is_some()
            || matches!(
                self.vim_action_for_key(event),
                Some(crate::keymap::VimKeymapAction::Search(_))
            )
    }

    pub(super) fn handle_vim_search_key(&mut self, event: KeyEvent) -> bool {
        if let Some(mut input) = self.vim_search.input.take() {
            if input.editor.editor_key_chord_pending() {
                input.editor.input(event);
                self.vim_search.input = Some(input);
                return true;
            }
            if event.code == KeyCode::Esc
                || (event.code == KeyCode::Char('c') && event.modifiers == KeyModifiers::CONTROL)
            {
                self.vim_pending = VimPending::None;
                return true;
            }
            if event.code == KeyCode::Backspace && input.editor.is_empty() {
                self.vim_pending = VimPending::None;
                return true;
            }
            if event.code != KeyCode::Enter || event.modifiers != KeyModifiers::NONE {
                input.editor.input(event);
                self.vim_search.input = Some(input);
                return true;
            }

            let text = input.editor.text().to_owned();
            if text.is_empty() && self.vim_search.last.text.is_empty() {
                self.vim_pending = VimPending::None;
                return true;
            }
            let query = SearchQuery {
                text: if text.is_empty() {
                    self.vim_search.last.text.clone()
                } else {
                    text
                },
                direction: input.direction,
            };
            self.vim_search.last = query.clone();
            self.apply_search_with_pending(query);
            return true;
        }

        false
    }

    pub(super) fn apply_vim_search_action(&mut self, action: crate::keymap::VimSearchAction) {
        use crate::keymap::VimSearchAction;
        match action {
            VimSearchAction::Forward | VimSearchAction::Backward => {
                let direction = if action == VimSearchAction::Forward {
                    SearchDirection::Forward
                } else {
                    SearchDirection::Backward
                };
                let mut editor = TextArea::new();
                editor.editor_keymap = std::sync::Arc::clone(&self.editor_keymap);
                self.vim_search.input = Some(Box::new(SearchInput { editor, direction }));
            }
            VimSearchAction::Next | VimSearchAction::Previous => {
                if self.vim_search.last.text.is_empty() {
                    return;
                }
                let mut query = self.vim_search.last.clone();
                if action == VimSearchAction::Previous {
                    query.direction = query.direction.reversed();
                }
                self.apply_search_with_pending(query);
            }
        }
    }

    fn apply_search_with_pending(&mut self, query: SearchQuery) {
        let pending = std::mem::replace(&mut self.vim_pending, VimPending::None);
        let operator = match pending {
            VimPending::Operator(operator) => Some(operator),
            _ => None,
        };
        use super::vim_commands::{VimAction, VimEditTarget};
        match operator {
            Some(VimOperator::Delete) => {
                self.start_vim_edit(VimAction::Delete(VimEditTarget::Search(query)));
            }
            Some(VimOperator::Change) => {
                self.start_vim_edit(VimAction::Change(VimEditTarget::Search(query)));
            }
            _ => {
                self.apply_vim_search(&query, operator);
            }
        }
    }

    pub(super) fn apply_vim_search(
        &mut self,
        query: &SearchQuery,
        operator: Option<VimOperator>,
    ) -> bool {
        let origin = self.cursor;
        let target = matching_ranges(&self.text, &query.text)
            .map(|range| range.start)
            .filter(|&position| self.is_vim_command_target(position))
            .min_by_key(|&position| match query.direction {
                SearchDirection::Forward => (position <= origin, position),
                SearchDirection::Backward => (position >= origin, usize::MAX - position),
            });
        let Some(target) = target else {
            return false;
        };
        if let Some(operator) = operator {
            if origin == target {
                return false;
            }
            let range = origin.min(target)..origin.max(target);
            match operator {
                VimOperator::Delete => self.kill_range(range),
                VimOperator::Change => {
                    self.kill_range(range);
                    self.vim_mode = VimMode::Insert;
                }
                VimOperator::Yank => self.yank_range(range),
            }
        } else {
            self.set_cursor(target);
        }
        true
    }
}
