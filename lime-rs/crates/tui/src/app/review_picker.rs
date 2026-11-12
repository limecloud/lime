//! Review preset picker; the runtime owns the canonical review turn.

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
pub(crate) enum ReviewPickerAction {
    None,
    Uncommitted,
    Custom,
    Cancel,
}

#[derive(Debug, Clone)]
pub(crate) struct ReviewPicker {
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl ReviewPicker {
    pub(crate) fn new() -> Self {
        Self {
            selected: 0,
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

    pub(crate) fn handle_event(&mut self, event: Event) -> ReviewPickerAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return ReviewPickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return ReviewPickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return ReviewPickerAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return ReviewPickerAction::None,
            KeymapMatch::PassThrough => {}
        }
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                match ch {
                    '1' => return ReviewPickerAction::Uncommitted,
                    '2' => return ReviewPickerAction::Custom,
                    _ => {}
                }
            }
        }
        ReviewPickerAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> ReviewPickerAction {
        match action {
            ListAction::Accept => match self.selected {
                0 => ReviewPickerAction::Uncommitted,
                _ => ReviewPickerAction::Custom,
            },
            ListAction::Cancel => ReviewPickerAction::Cancel,
            ListAction::MoveUp | ListAction::MoveDown => {
                self.selected = 1 - self.selected;
                ReviewPickerAction::None
            }
            _ => ReviewPickerAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = vec![
            SelectionRow::new(
                locale.review_preset_uncommitted_label(),
                Some(locale.review_preset_uncommitted_description().to_string()),
                Vec::new(),
            ),
            SelectionRow::new(
                locale.review_preset_custom_label(),
                Some(locale.review_preset_custom_description().to_string()),
                Vec::new(),
            ),
        ];
        ListSelectionView {
            footer: None,
            title: locale.review_preset_title(),
            subtitle: Line::from(locale.review_preset_subtitle()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, picker: &ReviewPicker, locale: Locale) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &picker.view(locale),
    ));
}

pub(crate) fn desired_height(picker: &ReviewPicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&picker.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_picks_uncommitted_and_down_then_enter_picks_custom() {
        let mut picker = ReviewPicker::new();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ReviewPickerAction::Uncommitted
        );

        let mut picker = ReviewPicker::new();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
            ReviewPickerAction::None
        );
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ReviewPickerAction::Custom
        );
    }

    #[test]
    fn escape_cancels() {
        let mut picker = ReviewPicker::new();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            ReviewPickerAction::Cancel
        );
    }
}
