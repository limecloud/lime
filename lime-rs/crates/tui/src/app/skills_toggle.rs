//! Interactive skills list; Enter toggles a skill through `skills/config/write`.

use std::cell::Cell;
use std::path::PathBuf;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkillToggleEntry {
    pub name: String,
    pub description: String,
    pub path: PathBuf,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SkillsToggleAction {
    None,
    Cancel,
    Toggle {
        name: String,
        path: PathBuf,
        enabled: bool,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct SkillsToggle {
    entries: Vec<SkillToggleEntry>,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl SkillsToggle {
    pub(crate) fn new(entries: Vec<SkillToggleEntry>) -> Self {
        Self {
            entries,
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

    pub(crate) fn handle_event(&mut self, event: Event) -> SkillsToggleAction {
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return SkillsToggleAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return SkillsToggleAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return SkillsToggleAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return SkillsToggleAction::None,
            KeymapMatch::PassThrough => {}
        }
        SkillsToggleAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> SkillsToggleAction {
        let count = self.entries.len().max(1);
        if action == ListAction::Cancel {
            return SkillsToggleAction::Cancel;
        }
        if action == ListAction::Accept {
            let Some(entry) = self.entries.get(self.selected) else {
                return SkillsToggleAction::None;
            };
            return SkillsToggleAction::Toggle {
                name: entry.name.clone(),
                path: entry.path.clone(),
                enabled: !entry.enabled,
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
        SkillsToggleAction::None
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
                    Some(if entry.description.is_empty() {
                        state.to_string()
                    } else {
                        format!("{} · {state}", entry.description)
                    }),
                    Vec::new(),
                )
            })
            .collect();
        ListSelectionView {
            footer: None,
            title: locale.skills_title(),
            subtitle: Line::from(locale.skills_toggle_hint()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: locale.skills_empty(),
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, toggle: &SkillsToggle, locale: Locale) {
    toggle.page_rows.set(list_selection_view::render(
        frame,
        area,
        &toggle.view(locale),
    ));
}

pub(crate) fn desired_height(toggle: &SkillsToggle, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&toggle.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    fn toggle() -> SkillsToggle {
        SkillsToggle::new(vec![SkillToggleEntry {
            name: "gate-skill".to_string(),
            description: "Gate skill".to_string(),
            path: PathBuf::from("/skills/gate/SKILL.md"),
            enabled: true,
        }])
    }

    #[test]
    fn enter_toggles_the_selected_skill() {
        let mut toggle = toggle();
        assert_eq!(
            toggle.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            SkillsToggleAction::Toggle {
                name: "gate-skill".to_string(),
                path: PathBuf::from("/skills/gate/SKILL.md"),
                enabled: false,
            }
        );
    }

    #[test]
    fn escape_cancels_the_view() {
        let mut toggle = toggle();
        assert_eq!(
            toggle.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            SkillsToggleAction::Cancel
        );
    }
}
