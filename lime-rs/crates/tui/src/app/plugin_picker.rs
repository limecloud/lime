//! Installed-plugin browser with an uninstall affordance.

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
pub(crate) struct PluginEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PluginPickerAction {
    None,
    Cancel,
    Uninstall { plugin_id: String, name: String },
}

#[derive(Debug, Clone)]
pub(crate) struct PluginPicker {
    entries: Vec<PluginEntry>,
    message: Option<String>,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl PluginPicker {
    pub(crate) fn new(entries: Vec<PluginEntry>, message: Option<String>) -> Self {
        Self {
            entries,
            message,
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

    pub(crate) fn handle_event(&mut self, event: Event) -> PluginPickerAction {
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return PluginPickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return PluginPickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return PluginPickerAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return PluginPickerAction::None,
            KeymapMatch::PassThrough => {}
        }
        PluginPickerAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> PluginPickerAction {
        let count = self.entries.len().max(1);
        if action == ListAction::Cancel {
            return PluginPickerAction::Cancel;
        }
        if action == ListAction::Accept {
            let Some(entry) = self.entries.get(self.selected) else {
                return PluginPickerAction::None;
            };
            return PluginPickerAction::Uninstall {
                plugin_id: entry.id.clone(),
                name: entry.name.clone(),
            };
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
        PluginPickerAction::None
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                let state = if entry.enabled {
                    locale.experimental_enabled_label()
                } else {
                    locale.experimental_disabled_label()
                };
                SelectionRow::new(
                    entry.name.clone(),
                    Some(format!(
                        "{} {} · {state}",
                        locale.plugins_version_label(),
                        entry.version
                    )),
                    Vec::new(),
                )
            })
            .collect();
        let empty_text = self
            .message
            .as_deref()
            .unwrap_or_else(|| locale.plugins_empty());
        ListSelectionView {
            footer: None,
            title: locale.plugins_title(),
            subtitle: Line::from(locale.plugin_picker_hint()),
            query: None,
            entries,
            selected: self.selected,
            empty_text,
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, picker: &PluginPicker, locale: Locale) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &picker.view(locale),
    ));
}

pub(crate) fn desired_height(picker: &PluginPicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&picker.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    fn picker() -> PluginPicker {
        PluginPicker::new(
            vec![PluginEntry {
                id: "plugin-1".to_string(),
                name: "gate-plugin".to_string(),
                version: "1.0.0".to_string(),
                enabled: true,
            }],
            None,
        )
    }

    #[test]
    fn enter_requests_uninstall_for_the_selected_plugin() {
        let mut picker = picker();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            PluginPickerAction::Uninstall {
                plugin_id: "plugin-1".to_string(),
                name: "gate-plugin".to_string(),
            }
        );
    }

    #[test]
    fn escape_cancels_the_picker() {
        let mut picker = picker();
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            PluginPickerAction::Cancel
        );
    }
}
