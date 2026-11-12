//! Destructive-action confirmation rendered with the shared list selection view.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfirmPromptAction {
    None,
    Confirm,
    Cancel,
}

#[derive(Debug, Clone)]
pub(crate) struct ConfirmPrompt {
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
    kind: ConfirmKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfirmKind {
    ArchiveThread,
    DeleteThread,
}

impl ConfirmPrompt {
    pub(crate) fn archive() -> Self {
        Self::new(ConfirmKind::ArchiveThread)
    }

    pub(crate) fn delete_thread() -> Self {
        Self::new(ConfirmKind::DeleteThread)
    }

    fn new(kind: ConfirmKind) -> Self {
        Self {
            selected: 0,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
            kind,
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn kind(&self) -> ConfirmKind {
        self.kind
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> ConfirmPromptAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return ConfirmPromptAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return ConfirmPromptAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return ConfirmPromptAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return ConfirmPromptAction::None,
            KeymapMatch::PassThrough => {}
        }
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                match ch {
                    '1' => {
                        self.selected = 0;
                        return ConfirmPromptAction::Cancel;
                    }
                    '2' => {
                        self.selected = 1;
                        return ConfirmPromptAction::Confirm;
                    }
                    _ => {}
                }
            }
        }
        ConfirmPromptAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> ConfirmPromptAction {
        match action {
            ListAction::Accept => match self.selected {
                1 => ConfirmPromptAction::Confirm,
                _ => ConfirmPromptAction::Cancel,
            },
            ListAction::Cancel => ConfirmPromptAction::Cancel,
            ListAction::MoveUp | ListAction::MoveDown => {
                self.selected = 1 - self.selected;
                ConfirmPromptAction::None
            }
            _ => ConfirmPromptAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = vec![
            SelectionRow::new(
                locale.confirm_cancel_label(),
                Some(locale.confirm_cancel_description().to_string()),
                Vec::new(),
            ),
            SelectionRow::new(
                match self.kind {
                    ConfirmKind::ArchiveThread => locale.confirm_archive_label(),
                    ConfirmKind::DeleteThread => locale.confirm_delete_label(),
                },
                Some(
                    match self.kind {
                        ConfirmKind::ArchiveThread => locale.confirm_archive_description(),
                        ConfirmKind::DeleteThread => locale.confirm_delete_description(),
                    }
                    .to_string(),
                ),
                Vec::new(),
            ),
        ];
        ListSelectionView {
            footer: None,
            title: match self.kind {
                ConfirmKind::ArchiveThread => locale.confirm_archive_title(),
                ConfirmKind::DeleteThread => locale.confirm_delete_title(),
            },
            subtitle: Line::from(match self.kind {
                ConfirmKind::ArchiveThread => locale.confirm_archive_subtitle(),
                ConfirmKind::DeleteThread => locale.confirm_delete_subtitle(),
            }),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, prompt: &ConfirmPrompt, locale: Locale) {
    prompt.page_rows.set(list_selection_view::render(
        frame,
        area,
        &prompt.view(locale),
    ));
}

pub(crate) fn desired_height(prompt: &ConfirmPrompt, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&prompt.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_cancels_by_default_and_down_then_enter_confirms() {
        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfirmPromptAction::Cancel
        );

        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
            ConfirmPromptAction::None
        );
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfirmPromptAction::Confirm
        );
    }

    #[test]
    fn escape_and_ctrl_c_cancel() {
        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            ConfirmPromptAction::Cancel
        );

        let mut prompt = ConfirmPrompt::archive();
        let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(
            prompt.handle_event(Event::Key(ctrl_c)),
            ConfirmPromptAction::Cancel
        );
    }

    #[test]
    fn delete_variant_reports_its_kind() {
        let prompt = ConfirmPrompt::delete_thread();
        assert_eq!(prompt.kind(), ConfirmKind::DeleteThread);
        let archive = ConfirmPrompt::archive();
        assert_eq!(archive.kind(), ConfirmKind::ArchiveThread);
    }

    #[test]
    fn numbered_shortcuts_pick_both_outcomes() {
        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('1')))),
            ConfirmPromptAction::Cancel
        );

        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('2')))),
            ConfirmPromptAction::Confirm
        );
    }
}
