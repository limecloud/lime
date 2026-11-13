//! Interactive keybinding editor backed by `tui.keymap.*` config writes.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapEntry, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KeymapEditorAction {
    None,
    Cancel,
    Save { path: String, spec: String },
    Unbind { path: String },
    Reset { path: String },
}

#[derive(Debug, Clone)]
pub(crate) struct KeymapEditor {
    entries: Vec<KeymapEntry>,
    selected: usize,
    capturing: bool,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl KeymapEditor {
    pub(crate) fn new(entries: Vec<KeymapEntry>) -> Self {
        Self {
            entries,
            selected: 0,
            capturing: false,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> KeymapEditorAction {
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return KeymapEditorAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return KeymapEditorAction::None;
        }
        if self.capturing {
            if key.code == KeyCode::Esc {
                self.capturing = false;
                return KeymapEditorAction::None;
            }
            let spec = crate::keymap::key_event_spec(key);
            let Some(entry) = self.entries.get(self.selected) else {
                return KeymapEditorAction::None;
            };
            self.capturing = false;
            return KeymapEditorAction::Save {
                path: entry.path.to_string(),
                spec,
            };
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return KeymapEditorAction::Cancel;
        }
        if key.code == KeyCode::Char('r') && key.modifiers.is_empty() {
            let Some(entry) = self.entries.get(self.selected) else {
                return KeymapEditorAction::None;
            };
            return KeymapEditorAction::Reset {
                path: entry.path.to_string(),
            };
        }
        if key.code == KeyCode::Delete {
            let Some(entry) = self.entries.get(self.selected) else {
                return KeymapEditorAction::None;
            };
            return KeymapEditorAction::Unbind {
                path: entry.path.to_string(),
            };
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return KeymapEditorAction::None,
            KeymapMatch::PassThrough => {}
        }
        KeymapEditorAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> KeymapEditorAction {
        let count = self.entries.len().max(1);
        if action == ListAction::Cancel {
            return KeymapEditorAction::Cancel;
        }
        if action == ListAction::Accept {
            if self.entries.is_empty() {
                return KeymapEditorAction::None;
            }
            self.capturing = true;
            return KeymapEditorAction::None;
        }
        match action {
            ListAction::MoveUp => self.selected = self.selected.checked_sub(1).unwrap_or(count - 1),
            ListAction::MoveDown => self.selected = (self.selected + 1) % count,
            ListAction::PageUp => {
                self.selected = self.selected.saturating_sub(self.page_rows.get().max(1))
            }
            ListAction::PageDown => {
                self.selected = (self.selected + self.page_rows.get().max(1)).min(count - 1)
            }
            ListAction::JumpTop => self.selected = 0,
            ListAction::JumpBottom => self.selected = count - 1,
            ListAction::MoveLeft
            | ListAction::MoveRight
            | ListAction::Accept
            | ListAction::Cancel => {}
        }
        KeymapEditorAction::None
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                let name = entry
                    .path
                    .strip_prefix("tui.keymap.")
                    .unwrap_or(entry.path.as_str());
                let keys = if entry.specs.is_empty() {
                    "—".to_string()
                } else {
                    entry.specs.join(", ")
                };
                SelectionRow::new(name.to_string(), Some(keys), Vec::new())
            })
            .collect();
        ListSelectionView {
            footer: None,
            title: locale.keymap_title(),
            subtitle: Line::from(if self.capturing {
                locale.keymap_capturing_hint()
            } else {
                locale.keymap_editor_hint()
            }),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }

    pub(crate) fn selected_path(&self) -> Option<&str> {
        self.entries
            .get(self.selected)
            .map(|entry| entry.path.as_str())
    }

    pub(crate) fn is_capturing(&self) -> bool {
        self.capturing
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, editor: &KeymapEditor, locale: Locale) {
    editor.page_rows.set(list_selection_view::render(
        frame,
        area,
        &editor.view(locale),
    ));
}

pub(crate) fn desired_height(editor: &KeymapEditor, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&editor.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap::key_event_spec;

    fn editor() -> KeymapEditor {
        KeymapEditor::new(vec![KeymapEntry {
            path: "tui.keymap.global.open_agents".to_string(),
            keys: vec!["ctrl+e".to_string()],
            specs: vec!["ctrl-e".to_string()],
        }])
    }

    #[test]
    fn enter_starts_capture_and_next_key_saves_the_spec() {
        let mut editor = editor();
        assert_eq!(
            editor.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Enter,
                KeyModifiers::NONE
            ))),
            KeymapEditorAction::None
        );
        assert!(editor.is_capturing());
        assert_eq!(
            editor.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Char('t'),
                KeyModifiers::CONTROL
            ))),
            KeymapEditorAction::Save {
                path: "tui.keymap.global.open_agents".to_string(),
                spec: "ctrl-t".to_string(),
            }
        );
        assert!(!editor.is_capturing());
        assert_eq!(
            key_event_spec(KeyEvent::new(KeyCode::F(9), KeyModifiers::NONE)),
            "f9"
        );
    }

    #[test]
    fn r_resets_the_selected_binding() {
        let mut editor = editor();
        assert_eq!(
            editor.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Char('r'),
                KeyModifiers::NONE
            ))),
            KeymapEditorAction::Reset {
                path: "tui.keymap.global.open_agents".to_string(),
            }
        );
    }

    #[test]
    fn delete_unbinds_the_selected_binding() {
        let mut editor = editor();
        assert_eq!(
            editor.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Delete,
                KeyModifiers::NONE
            ))),
            KeymapEditorAction::Unbind {
                path: "tui.keymap.global.open_agents".to_string(),
            }
        );
    }

    #[test]
    fn escape_cancels_capture_without_saving() {
        let mut editor = editor();
        editor.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        )));
        assert_eq!(
            editor.handle_event(Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE))),
            KeymapEditorAction::None
        );
        assert!(!editor.is_capturing());
    }
}
