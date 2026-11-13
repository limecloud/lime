//! Configuration menu; each entry routes to an existing settings editor.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;
use crate::slash_command::SlashCommand;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfigItem {
    Model,
    Effort,
    Permissions,
    Experimental,
    TerminalTitle,
    StatusLine,
    Hooks,
    Skills,
    Keymap,
    Animations,
    RightClickPaste,
    StatusLineColors,
    AutoRecap,
}

impl ConfigItem {
    const ALL: [Self; 13] = [
        Self::Model,
        Self::Effort,
        Self::Permissions,
        Self::Experimental,
        Self::TerminalTitle,
        Self::StatusLine,
        Self::Hooks,
        Self::Skills,
        Self::Keymap,
        Self::Animations,
        Self::RightClickPaste,
        Self::StatusLineColors,
        Self::AutoRecap,
    ];

    fn label(self, locale: Locale) -> String {
        match self {
            Self::Animations => locale.config_animations_label().to_string(),
            Self::RightClickPaste => locale.config_right_click_label().to_string(),
            Self::StatusLineColors => locale.config_status_colors_label().to_string(),
            Self::AutoRecap => locale.config_auto_recap_label().to_string(),
            _ => self.command().command().to_string(),
        }
    }

    fn description(self, locale: Locale) -> String {
        match self {
            Self::Animations => locale.config_animations_description().to_string(),
            Self::RightClickPaste => locale.config_right_click_description().to_string(),
            Self::StatusLineColors => locale.config_status_colors_description().to_string(),
            Self::AutoRecap => locale.config_auto_recap_description().to_string(),
            _ => self.command().description(locale).to_string(),
        }
    }

    fn command(self) -> SlashCommand {
        match self {
            Self::Model => SlashCommand::Model,
            Self::Effort => SlashCommand::Effort,
            Self::Permissions => SlashCommand::Permissions,
            Self::Experimental => SlashCommand::Experimental,
            Self::TerminalTitle => SlashCommand::Title,
            Self::StatusLine => SlashCommand::Statusline,
            Self::Hooks => SlashCommand::Hooks,
            Self::Skills => SlashCommand::Skills,
            Self::Keymap => SlashCommand::Keymap,
            Self::Animations | Self::RightClickPaste | Self::StatusLineColors | Self::AutoRecap => {
                SlashCommand::Config
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfigMenuAction {
    None,
    Select(ConfigItem),
    Cancel,
}

#[derive(Debug, Clone)]
pub(crate) struct ConfigMenu {
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl ConfigMenu {
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

    pub(crate) fn handle_event(&mut self, event: Event) -> ConfigMenuAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return ConfigMenuAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return ConfigMenuAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return ConfigMenuAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return ConfigMenuAction::None,
            KeymapMatch::PassThrough => {}
        }
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                if let Some(index) = ch.to_digit(10).and_then(|number| number.checked_sub(1)) {
                    if let Some(item) = ConfigItem::ALL.get(index as usize) {
                        return ConfigMenuAction::Select(*item);
                    }
                }
            }
        }
        ConfigMenuAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> ConfigMenuAction {
        let count = ConfigItem::ALL.len();
        match action {
            ListAction::Accept => {
                return ConfigItem::ALL
                    .get(self.selected)
                    .map(|item| ConfigMenuAction::Select(*item))
                    .unwrap_or(ConfigMenuAction::None);
            }
            ListAction::Cancel => return ConfigMenuAction::Cancel,
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
            _ => {}
        }
        ConfigMenuAction::None
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let entries = ConfigItem::ALL
            .iter()
            .map(|item| {
                SelectionRow::new(
                    item.label(locale),
                    Some(item.description(locale)),
                    Vec::new(),
                )
            })
            .collect();
        ListSelectionView {
            footer: None,
            title: locale.config_panel_title(),
            subtitle: Line::from(locale.config_panel_hint()),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, menu: &ConfigMenu, locale: Locale) {
    menu.page_rows
        .set(list_selection_view::render(frame, area, &menu.view(locale)));
}

pub(crate) fn desired_height(menu: &ConfigMenu, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&menu.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_selects_model_and_down_moves_to_effort() {
        let mut menu = ConfigMenu::new();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfigMenuAction::Select(ConfigItem::Model)
        );

        let mut menu = ConfigMenu::new();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
            ConfigMenuAction::None
        );
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfigMenuAction::Select(ConfigItem::Effort)
        );
    }

    #[test]
    fn navigation_reaches_the_status_line_colors_toggle() {
        let mut menu = ConfigMenu::new();
        for _ in 0..11 {
            assert_eq!(
                menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
                ConfigMenuAction::None
            );
        }
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfigMenuAction::Select(ConfigItem::StatusLineColors)
        );
    }

    #[test]
    fn navigation_reaches_the_right_click_paste_toggle() {
        let mut menu = ConfigMenu::new();
        for _ in 0..10 {
            assert_eq!(
                menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
                ConfigMenuAction::None
            );
        }
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfigMenuAction::Select(ConfigItem::RightClickPaste)
        );
    }

    #[test]
    fn navigation_reaches_the_animations_toggle() {
        let mut menu = ConfigMenu::new();
        for _ in 0..9 {
            assert_eq!(
                menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
                ConfigMenuAction::None
            );
        }
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfigMenuAction::Select(ConfigItem::Animations)
        );
    }

    #[test]
    fn numbered_shortcuts_select_entries() {
        let mut menu = ConfigMenu::new();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('4')))),
            ConfigMenuAction::Select(ConfigItem::Experimental)
        );
        let mut menu = ConfigMenu::new();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('7')))),
            ConfigMenuAction::Select(ConfigItem::Hooks)
        );
        let mut menu = ConfigMenu::new();
        assert_eq!(
            menu.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('9')))),
            ConfigMenuAction::Select(ConfigItem::Keymap)
        );
    }
}
