//! Memory settings view; the App Server currently exposes only the thread memory mode.

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
pub(crate) enum MemoriesSettingsAction {
    None,
    Cancel,
    SetMode(bool),
}

#[derive(Debug, Clone)]
pub(crate) struct MemoriesSettings {
    mode: Option<bool>,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl MemoriesSettings {
    pub(crate) fn new(mode: Option<bool>) -> Self {
        Self {
            mode,
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

    pub(crate) fn handle_event(&mut self, event: Event) -> MemoriesSettingsAction {
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return MemoriesSettingsAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return MemoriesSettingsAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return MemoriesSettingsAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => match action {
                ListAction::Accept => {
                    let next = !self.mode.unwrap_or(false);
                    self.mode = Some(next);
                    MemoriesSettingsAction::SetMode(next)
                }
                ListAction::Cancel => MemoriesSettingsAction::Cancel,
                _ => MemoriesSettingsAction::None,
            },
            KeymapMatch::Pending | KeymapMatch::Cancelled => MemoriesSettingsAction::None,
            KeymapMatch::PassThrough => MemoriesSettingsAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let state = match self.mode {
            Some(true) => locale.memory_ready_label(),
            Some(false) => locale.memory_not_ready_label(),
            None => locale.memories_unknown_label(),
        };
        let entries = vec![SelectionRow::new(
            locale.memories_use_label(),
            Some(format!("{} · {state}", locale.memories_use_description())),
            Vec::new(),
        )];
        ListSelectionView {
            footer: None,
            title: locale.memories_title(),
            subtitle: Line::from(locale.memories_hint()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    settings: &MemoriesSettings,
    locale: Locale,
) {
    settings.page_rows.set(list_selection_view::render(
        frame,
        area,
        &settings.view(locale),
    ));
}

pub(crate) fn desired_height(settings: &MemoriesSettings, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&settings.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_toggles_the_thread_memory_mode() {
        let mut settings = MemoriesSettings::new(None);
        assert_eq!(
            settings.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            MemoriesSettingsAction::SetMode(true)
        );
        let mut settings = MemoriesSettings::new(Some(true));
        assert_eq!(
            settings.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            MemoriesSettingsAction::SetMode(false)
        );
    }

    #[test]
    fn escape_cancels_the_view() {
        let mut settings = MemoriesSettings::new(None);
        assert_eq!(
            settings.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            MemoriesSettingsAction::Cancel
        );
    }
}
