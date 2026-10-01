//! Model search and nested effort menus share the configured list navigation owner.

use super::*;
use crate::keymap::{KeymapMatch, ListAction};
use crossterm::event::KeyEventKind;

impl ModelPicker {
    pub(crate) fn handle_event(&mut self, event: Event) -> ModelPickerAction {
        if !matches!(event, Event::Key(_)) {
            self.list_chord_matcher.reset();
        }
        match event {
            Event::Key(key) if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) => {
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                    self.list_chord_matcher.reset();
                    return ModelPickerAction::Cancel;
                }
                let searchable = self.effort_menu.is_none();
                match self
                    .list_keymap
                    .dispatch(&mut self.list_chord_matcher, key, searchable)
                {
                    KeymapMatch::Completed(action) => return self.handle_list_action(action),
                    KeymapMatch::Pending | KeymapMatch::Cancelled => {
                        return ModelPickerAction::None
                    }
                    KeymapMatch::PassThrough => {}
                }
                match key.code {
                    KeyCode::Backspace if searchable => {
                        if let Some((offset, _)) = self.query.grapheme_indices(true).next_back() {
                            self.query.truncate(offset);
                        }
                        self.selected = 0;
                    }
                    KeyCode::Char(ch)
                        if !ch.is_control()
                            && !key
                                .modifiers
                                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                    {
                        if searchable {
                            self.query.push(ch);
                            self.selected = 0;
                        } else if let Some(index) =
                            ch.to_digit(10).and_then(|number| number.checked_sub(1))
                        {
                            let index = index as usize;
                            if index < self.row_count() {
                                self.set_selected_row(index);
                                return self.accept();
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::Paste(text) if self.effort_menu.is_none() => {
                if let Some(text) = crate::clipboard_paste::normalize_pasted_search_query(&text) {
                    self.query.push_str(&text);
                    self.selected = 0;
                }
            }
            _ => {}
        }
        ModelPickerAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> ModelPickerAction {
        let count = self.row_count();
        let selected = self.selected_row();
        let page = self.page_rows.get().max(1);
        match action {
            ListAction::Accept => return self.accept(),
            ListAction::Cancel => return self.back(),
            ListAction::MoveUp if count > 0 => {
                self.set_selected_row(selected.checked_sub(1).unwrap_or(count - 1))
            }
            ListAction::MoveDown if count > 0 => self.set_selected_row((selected + 1) % count),
            ListAction::PageUp => self.set_selected_row(selected.saturating_sub(page)),
            ListAction::PageDown => {
                self.set_selected_row(selected.saturating_add(page).min(count.saturating_sub(1)))
            }
            ListAction::JumpTop => self.set_selected_row(0),
            ListAction::JumpBottom => self.set_selected_row(count.saturating_sub(1)),
            _ => {}
        }
        ModelPickerAction::None
    }
}
