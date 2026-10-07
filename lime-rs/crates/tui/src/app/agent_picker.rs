//! Snapshot selector for canonical App Server threads; lifecycle stays in AppServerSession.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::Frame;

use super::agent_navigation::AgentNavigationState;
use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;
use crate::multi_agents::format_agent_picker_item_name;

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentPickerEntry {
    thread_id: String,
    label: String,
    is_closed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AgentPickerAction {
    None,
    Cancel,
    Select(String),
}

#[derive(Debug, Clone)]
pub(crate) struct AgentPicker {
    entries: Vec<AgentPickerEntry>,
    selected: usize,
    current: Option<usize>,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl AgentPicker {
    pub(crate) fn from_navigation(
        navigation: &AgentNavigationState,
        primary_thread_id: Option<&str>,
    ) -> Self {
        let entries = navigation
            .ordered_threads()
            .into_iter()
            .map(|(thread_id, entry)| {
                let is_primary = primary_thread_id == Some(thread_id);
                let label = entry
                    .agent_path
                    .as_deref()
                    .map(str::trim)
                    .filter(|path| !is_primary && !path.is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| {
                        format_agent_picker_item_name(
                            entry.agent_nickname.as_deref(),
                            entry.agent_role.as_deref(),
                            is_primary,
                        )
                    });
                AgentPickerEntry {
                    thread_id: thread_id.to_string(),
                    label,
                    is_closed: entry.is_closed,
                }
            })
            .collect();
        Self {
            entries,
            selected: 0,
            current: None,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn with_current(mut self, thread_id: Option<&str>) -> Self {
        self.current = self
            .entries
            .iter()
            .position(|entry| Some(entry.thread_id.as_str()) == thread_id);
        if let Some(index) = self.current {
            self.selected = index;
        }
        self
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> AgentPickerAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return AgentPickerAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return AgentPickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return AgentPickerAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return AgentPickerAction::None,
            KeymapMatch::PassThrough => {}
        }
        // Non-search lists share Codex's direct numbered selection.
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                if let Some(index) = ch.to_digit(10).and_then(|number| number.checked_sub(1)) {
                    if (index as usize) < self.entries.len() {
                        self.selected = index as usize;
                        return self.accept();
                    }
                }
            }
        }
        AgentPickerAction::None
    }

    fn accept(&self) -> AgentPickerAction {
        self.entries
            .get(self.selected)
            .map(|entry| AgentPickerAction::Select(entry.thread_id.clone()))
            .unwrap_or(AgentPickerAction::None)
    }

    fn handle_list_action(&mut self, action: ListAction) -> AgentPickerAction {
        let count = self.entries.len();
        let page = self.page_rows.get().max(1);
        match action {
            ListAction::Accept => return self.accept(),
            ListAction::Cancel => return AgentPickerAction::Cancel,
            ListAction::MoveUp if count > 0 => {
                self.selected = self.selected.checked_sub(1).unwrap_or(count - 1)
            }
            ListAction::MoveDown if count > 0 => self.selected = (self.selected + 1) % count,
            ListAction::PageUp => self.selected = self.selected.saturating_sub(page),
            ListAction::PageDown => {
                self.selected = self
                    .selected
                    .saturating_add(page)
                    .min(count.saturating_sub(1))
            }
            ListAction::JumpTop => self.selected = 0,
            ListAction::JumpBottom => self.selected = count.saturating_sub(1),
            _ => {}
        }
        AgentPickerAction::None
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = self
            .entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let suffix = if self.current == Some(index) {
                    format!(" ({})", locale.picker_current_label())
                } else {
                    String::new()
                };
                let dot = if entry.is_closed {
                    Span::raw("•")
                } else {
                    Span::raw("•").green()
                };
                SelectionRow::new(
                    format!("{}{suffix}", entry.label),
                    Some(entry.thread_id.clone()),
                    vec![Span::raw(format!("{}. ", index + 1)), dot, Span::raw(" ")],
                )
            })
            .collect();
        ListSelectionView {
            footer: None,
            title: locale.agent_picker_title(),
            subtitle: Line::from(AgentNavigationState::picker_subtitle(locale)),
            query: None,
            entries,
            selected: self.selected,
            empty_text: locale.agent_picker_empty(),
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, picker: &AgentPicker, locale: Locale) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &picker.view(locale),
    ));
}

pub(crate) fn desired_height(picker: &AgentPicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&picker.view(locale), width)
}

#[cfg(test)]
mod tests;
