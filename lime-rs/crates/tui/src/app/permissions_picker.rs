//! Permission-profile picker; the selection is applied through the shared settings path.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PermissionsPickerAction {
    None,
    Select(String),
    Cancel,
}

#[derive(Debug, Clone)]
pub(crate) struct PermissionsPicker {
    entries: Vec<String>,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl PermissionsPicker {
    pub(crate) fn new(profiles: Vec<String>, current: Option<&str>) -> Self {
        let selected = current
            .and_then(|current| profiles.iter().position(|profile| profile == current))
            .unwrap_or(0);
        Self {
            entries: profiles,
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

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> PermissionsPickerAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return PermissionsPickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return PermissionsPickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return PermissionsPickerAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return PermissionsPickerAction::None,
            KeymapMatch::PassThrough => {}
        }
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                if let Some(index) = ch.to_digit(10).and_then(|number| number.checked_sub(1)) {
                    if let Some(profile) = self.entries.get(index as usize) {
                        return PermissionsPickerAction::Select(profile.clone());
                    }
                }
            }
        }
        PermissionsPickerAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> PermissionsPickerAction {
        let count = self.entries.len();
        match action {
            ListAction::Accept => {
                return self
                    .entries
                    .get(self.selected)
                    .map(|profile| PermissionsPickerAction::Select(profile.clone()))
                    .unwrap_or(PermissionsPickerAction::None);
            }
            ListAction::Cancel => return PermissionsPickerAction::Cancel,
            ListAction::MoveUp if count > 0 => {
                self.selected = self.selected.checked_sub(1).unwrap_or(count - 1);
            }
            ListAction::MoveDown if count > 0 => {
                self.selected = (self.selected + 1) % count;
            }
            ListAction::PageUp => {
                self.selected = self.selected.saturating_sub(self.page_rows.get().max(1));
            }
            ListAction::PageDown => {
                self.selected = (self.selected + self.page_rows.get().max(1)).min(count - 1);
            }
            ListAction::JumpTop => self.selected = 0,
            ListAction::JumpBottom if count > 0 => self.selected = count - 1,
            _ => {}
        }
        PermissionsPickerAction::None
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .map(|profile| SelectionRow::new(profile.clone(), None, Vec::new()))
            .collect();
        ListSelectionView {
            footer: None,
            title: locale.permissions_picker_title(),
            subtitle: Line::from(locale.permissions_picker_subtitle()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: locale.permissions_picker_empty(),
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    picker: &PermissionsPicker,
    locale: Locale,
) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &picker.view(locale),
    ));
}

pub(crate) fn desired_height(picker: &PermissionsPicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&picker.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_selects_current_profile_and_down_moves() {
        let profiles = vec!["default".to_string(), "read-only".to_string()];
        let mut picker = PermissionsPicker::new(profiles.clone(), Some("default"));
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            PermissionsPickerAction::Select("default".to_string())
        );

        let mut picker = PermissionsPicker::new(profiles, Some("default"));
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
            PermissionsPickerAction::None
        );
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            PermissionsPickerAction::Select("read-only".to_string())
        );
    }

    #[test]
    fn escape_cancels() {
        let mut picker = PermissionsPicker::new(vec!["default".to_string()], None);
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            PermissionsPickerAction::Cancel
        );
    }
}
