//! Reasoning-effort picker; selection is applied through the shared settings path.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

pub(crate) const EFFORT_VALUES: [&str; 3] = ["low", "medium", "high"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EffortPickerAction {
    None,
    Select(&'static str),
    Cancel,
}

#[derive(Debug, Clone)]
pub(crate) struct EffortPicker {
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl EffortPicker {
    pub(crate) fn new(current: Option<&str>) -> Self {
        let selected = current
            .and_then(|current| {
                EFFORT_VALUES
                    .iter()
                    .position(|value| Some(*value) == Some(current))
            })
            .unwrap_or(1);
        Self {
            selected,
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

    pub(crate) fn handle_event(&mut self, event: Event) -> EffortPickerAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return EffortPickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return EffortPickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return EffortPickerAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return EffortPickerAction::None,
            KeymapMatch::PassThrough => {}
        }
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                if let Some(index) = ch.to_digit(10).and_then(|number| number.checked_sub(1)) {
                    if let Some(value) = EFFORT_VALUES.get(index as usize) {
                        return EffortPickerAction::Select(value);
                    }
                }
            }
        }
        EffortPickerAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> EffortPickerAction {
        match action {
            ListAction::Accept => EFFORT_VALUES
                .get(self.selected)
                .map(|value| EffortPickerAction::Select(value))
                .unwrap_or(EffortPickerAction::None),
            ListAction::Cancel => EffortPickerAction::Cancel,
            ListAction::MoveUp => {
                self.selected = self
                    .selected
                    .checked_sub(1)
                    .unwrap_or(EFFORT_VALUES.len() - 1);
                EffortPickerAction::None
            }
            ListAction::MoveDown => {
                self.selected = (self.selected + 1) % EFFORT_VALUES.len();
                EffortPickerAction::None
            }
            ListAction::PageUp => {
                self.selected = self.selected.saturating_sub(self.page_rows.get().max(1));
                EffortPickerAction::None
            }
            ListAction::PageDown => {
                self.selected =
                    (self.selected + self.page_rows.get().max(1)).min(EFFORT_VALUES.len() - 1);
                EffortPickerAction::None
            }
            ListAction::JumpTop => {
                self.selected = 0;
                EffortPickerAction::None
            }
            ListAction::JumpBottom => {
                self.selected = EFFORT_VALUES.len() - 1;
                EffortPickerAction::None
            }
            _ => EffortPickerAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = EFFORT_VALUES
            .iter()
            .map(|value| {
                SelectionRow::new(
                    (*value).to_string(),
                    Some(locale.effort_picker_description(value).to_string()),
                    Vec::new(),
                )
            })
            .collect();
        ListSelectionView {
            footer: None,
            title: locale.effort_picker_title(),
            subtitle: Line::from(locale.effort_picker_subtitle()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, picker: &EffortPicker, locale: Locale) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &picker.view(locale),
    ));
}

pub(crate) fn desired_height(picker: &EffortPicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&picker.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_selects_the_current_effort_and_down_moves_to_next() {
        let mut picker = EffortPicker::new(Some("low"));
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            EffortPickerAction::Select("low")
        );

        let mut picker = EffortPicker::new(Some("low"));
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
            EffortPickerAction::None
        );
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            EffortPickerAction::Select("medium")
        );
    }

    #[test]
    fn numbered_shortcuts_select_effort_values() {
        let mut picker = EffortPicker::new(None);
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('3')))),
            EffortPickerAction::Select("high")
        );
    }
}
