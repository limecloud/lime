//! Numbered reusable inputs: recall a saved prompt, save the current draft, or delete a slot.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::custom_prompt_view::{CustomPromptView, PromptAction, PromptLabels};
use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

pub(crate) const PRESET_SLOTS: [&str; 10] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PresetEntry {
    pub(crate) slot: String,
    pub(crate) label: String,
    pub(crate) input: String,
}

impl PresetEntry {
    /// First slot in menu order that has no saved preset.
    pub(crate) fn first_free_slot(entries: &[PresetEntry]) -> Option<String> {
        PRESET_SLOTS
            .iter()
            .find(|slot| !entries.iter().any(|entry| &entry.slot == *slot))
            .map(|slot| (*slot).to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PresetsMenuAction {
    None,
    Cancel,
    Recall { input: String },
    Save { input: String },
    Delete { slot: String },
    EditLabel { slot: String, label: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PresetsMenuMode {
    List,
    EditLabel,
    EditInput,
}

#[derive(Debug)]
pub(crate) struct PresetsMenu {
    entries: Vec<PresetEntry>,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
    mode: PresetsMenuMode,
    edit_slot: Option<String>,
    label_input: CustomPromptView,
    input_prompt: CustomPromptView,
}

impl PresetsMenu {
    pub(crate) fn new(entries: Vec<PresetEntry>) -> Self {
        Self {
            entries,
            selected: 0,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
            mode: PresetsMenuMode::List,
            edit_slot: None,
            label_input: CustomPromptView::new(String::new()),
            input_prompt: CustomPromptView::new(String::new()),
        }
    }

    pub(crate) fn cursor_style(&self) -> crossterm::cursor::SetCursorStyle {
        match self.mode {
            PresetsMenuMode::EditLabel => self.label_input.cursor_style(),
            PresetsMenuMode::EditInput => self.input_prompt.cursor_style(),
            PresetsMenuMode::List => crossterm::cursor::SetCursorStyle::DefaultUserShape,
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn entries(&self) -> &[PresetEntry] {
        &self.entries
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> PresetsMenuAction {
        if self.mode == PresetsMenuMode::EditLabel {
            return self.handle_label_event(event);
        }
        if self.mode == PresetsMenuMode::EditInput {
            return self.handle_input_event(event);
        }
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return PresetsMenuAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return PresetsMenuAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return PresetsMenuAction::Cancel;
        }
        if key.modifiers.is_empty() {
            match key.code {
                KeyCode::Char('e') => {
                    if let Some(entry) = self.entries.get(self.selected) {
                        self.mode = PresetsMenuMode::EditLabel;
                        self.edit_slot = Some(entry.slot.clone());
                        self.label_input = CustomPromptView::new(entry.label.clone());
                    }
                    return PresetsMenuAction::None;
                }
                KeyCode::Char('n') => {
                    self.mode = PresetsMenuMode::EditInput;
                    self.input_prompt = CustomPromptView::new(String::new());
                    return PresetsMenuAction::None;
                }
                KeyCode::Char('d') => {
                    if let Some(entry) = self.entries.get(self.selected) {
                        return PresetsMenuAction::Delete {
                            slot: entry.slot.clone(),
                        };
                    }
                    return PresetsMenuAction::None;
                }
                _ => {}
            }
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => match action {
                ListAction::Accept => self
                    .entries
                    .get(self.selected)
                    .map(|entry| PresetsMenuAction::Recall {
                        input: entry.input.clone(),
                    })
                    .unwrap_or(PresetsMenuAction::None),
                ListAction::Cancel => PresetsMenuAction::Cancel,
                ListAction::MoveUp => {
                    let count = self.entries.len().max(1);
                    self.selected = self.selected.checked_sub(1).unwrap_or(count - 1);
                    PresetsMenuAction::None
                }
                ListAction::MoveDown => {
                    let count = self.entries.len().max(1);
                    self.selected = (self.selected + 1) % count;
                    PresetsMenuAction::None
                }
                ListAction::PageUp => {
                    self.selected = self.selected.saturating_sub(self.page_rows.get().max(1));
                    PresetsMenuAction::None
                }
                ListAction::PageDown => {
                    self.selected = (self.selected + self.page_rows.get().max(1))
                        .min(self.entries.len().saturating_sub(1));
                    PresetsMenuAction::None
                }
                ListAction::JumpTop => {
                    self.selected = 0;
                    PresetsMenuAction::None
                }
                ListAction::JumpBottom => {
                    self.selected = self.entries.len().saturating_sub(1);
                    PresetsMenuAction::None
                }
                ListAction::MoveLeft | ListAction::MoveRight => PresetsMenuAction::None,
            },
            KeymapMatch::Pending | KeymapMatch::Cancelled | KeymapMatch::PassThrough => {
                PresetsMenuAction::None
            }
        }
    }

    fn handle_input_event(&mut self, event: Event) -> PresetsMenuAction {
        let Event::Key(key) = event else {
            return PresetsMenuAction::None;
        };
        if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            if key.code == KeyCode::Esc && key.modifiers.is_empty() {
                self.mode = PresetsMenuMode::List;
                return PresetsMenuAction::None;
            }
            if key.code == KeyCode::Enter && key.modifiers.is_empty() {
                let input = self.input_prompt.text().trim().to_string();
                if input.is_empty() {
                    return PresetsMenuAction::None;
                }
                self.mode = PresetsMenuMode::List;
                return PresetsMenuAction::Save { input };
            }
        }
        match self.input_prompt.handle_key_event(key) {
            PromptAction::Cancel => {
                self.mode = PresetsMenuMode::List;
                PresetsMenuAction::None
            }
            PromptAction::Submit | PromptAction::None => PresetsMenuAction::None,
        }
    }

    fn handle_label_event(&mut self, event: Event) -> PresetsMenuAction {
        let Event::Key(key) = event else {
            return PresetsMenuAction::None;
        };
        if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            if key.code == KeyCode::Esc && key.modifiers.is_empty() {
                self.mode = PresetsMenuMode::List;
                self.edit_slot = None;
                return PresetsMenuAction::None;
            }
            if key.code == KeyCode::Enter && key.modifiers.is_empty() {
                let label = self.label_input.text().trim().to_string();
                let slot = self.edit_slot.take();
                self.mode = PresetsMenuMode::List;
                return match slot {
                    Some(slot) => PresetsMenuAction::EditLabel { slot, label },
                    None => PresetsMenuAction::None,
                };
            }
        }
        match self.label_input.handle_key_event(key) {
            PromptAction::Cancel => {
                self.mode = PresetsMenuMode::List;
                self.edit_slot = None;
                PresetsMenuAction::None
            }
            PromptAction::Submit | PromptAction::None => PresetsMenuAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                SelectionRow::new(
                    format!("{}  {}", entry.slot, entry.label),
                    Some(entry.input.replace('\n', " ")),
                    Vec::new(),
                )
            })
            .collect::<Vec<_>>();
        ListSelectionView {
            footer: None,
            title: locale.presets_title(),
            subtitle: Line::from(locale.presets_subtitle()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: locale.presets_empty(),
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, menu: &PresetsMenu, locale: Locale) {
    menu.page_rows
        .set(list_selection_view::render(frame, area, &menu.view(locale)));
}

pub(crate) fn desired_height(menu: &PresetsMenu, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&menu.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    fn menu() -> PresetsMenu {
        PresetsMenu::new(vec![PresetEntry {
            slot: "1".to_string(),
            label: "Review".to_string(),
            input: "/review main".to_string(),
        }])
    }

    #[test]
    fn enter_recalls_the_selected_preset_and_escape_cancels() {
        let mut menu = menu();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            PresetsMenuAction::Recall {
                input: "/review main".to_string()
            }
        );
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            PresetsMenuAction::Cancel
        );
    }

    #[test]
    fn save_asks_for_input_and_delete_is_explicit() {
        let mut menu = menu();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('n')))),
            PresetsMenuAction::None
        );
        for ch in "summarize".chars() {
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char(ch))));
        }
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            PresetsMenuAction::Save {
                input: "summarize".to_string()
            }
        );
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('d')))),
            PresetsMenuAction::Delete {
                slot: "1".to_string()
            }
        );
    }

    #[test]
    fn e_edits_the_selected_label_prefilled_from_the_entry() {
        let mut menu = menu();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('e')))),
            PresetsMenuAction::None
        );
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            PresetsMenuAction::EditLabel {
                slot: "1".to_string(),
                label: "Review".to_string()
            }
        );
    }

    #[test]
    fn first_free_slot_skips_used_slots() {
        let entries = vec![
            PresetEntry {
                slot: "1".to_string(),
                label: String::new(),
                input: "a".to_string(),
            },
            PresetEntry {
                slot: "3".to_string(),
                label: String::new(),
                input: "b".to_string(),
            },
        ];
        assert_eq!(PresetEntry::first_free_slot(&entries).as_deref(), Some("2"));
    }
}
