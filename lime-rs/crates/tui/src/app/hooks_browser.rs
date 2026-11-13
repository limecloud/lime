//! Two-level hooks browser: events first, then the handlers configured for the event.

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
pub(crate) struct HookHandlerView {
    pub key: String,
    pub summary: String,
    pub source: String,
    pub timeout_sec: u64,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub enabled: bool,
    pub needs_review: bool,
    pub is_managed: bool,
    pub current_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HooksBrowserAction {
    None,
    Close,
    SetEnabled { key: String, enabled: bool },
    Trust { key: String, current_hash: String },
    TrustAll { hooks: Vec<(String, String)> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HookEventView {
    pub event: String,
    pub handlers: Vec<HookHandlerView>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HooksPage {
    Events,
    Handlers(usize),
}

#[derive(Debug, Clone)]
pub(crate) struct HooksBrowser {
    events: Vec<HookEventView>,
    page: HooksPage,
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
}

impl HooksBrowser {
    pub(crate) fn new(events: Vec<HookEventView>) -> Self {
        Self {
            events,
            page: HooksPage::Events,
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

    pub(crate) fn handle_event(&mut self, event: Event) -> HooksBrowserAction {
        let Event::Key(key) = event else {
            self.chord_matcher.reset();
            return HooksBrowserAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return HooksBrowserAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return HooksBrowserAction::Close;
        }
        if key.modifiers.is_empty() && key.code == KeyCode::Char(' ') {
            return self.toggle_selected_hook();
        }
        if key.modifiers.is_empty() && key.code == KeyCode::Char('t') {
            return match self.page {
                HooksPage::Events => self.trust_all_hooks(),
                HooksPage::Handlers(_) => self.trust_selected_hook(),
            };
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled | KeymapMatch::PassThrough => {
                HooksBrowserAction::None
            }
        }
    }

    fn toggle_selected_hook(&mut self) -> HooksBrowserAction {
        let HooksPage::Handlers(index) = self.page else {
            return HooksBrowserAction::None;
        };
        let Some(handler) = self
            .events
            .get_mut(index)
            .and_then(|event| event.handlers.get_mut(self.selected))
        else {
            return HooksBrowserAction::None;
        };
        if handler.is_managed || handler.needs_review {
            return HooksBrowserAction::None;
        }
        handler.enabled = !handler.enabled;
        HooksBrowserAction::SetEnabled {
            key: handler.key.clone(),
            enabled: handler.enabled,
        }
    }

    fn trust_selected_hook(&mut self) -> HooksBrowserAction {
        let HooksPage::Handlers(index) = self.page else {
            return HooksBrowserAction::None;
        };
        let Some(handler) = self
            .events
            .get_mut(index)
            .and_then(|event| event.handlers.get_mut(self.selected))
        else {
            return HooksBrowserAction::None;
        };
        if !handler.needs_review {
            return HooksBrowserAction::None;
        }
        handler.needs_review = false;
        HooksBrowserAction::Trust {
            key: handler.key.clone(),
            current_hash: handler.current_hash.clone(),
        }
    }

    fn trust_all_hooks(&mut self) -> HooksBrowserAction {
        let mut hooks = Vec::new();
        for handler in self
            .events
            .iter_mut()
            .flat_map(|event| event.handlers.iter_mut())
        {
            if !handler.needs_review {
                continue;
            }
            handler.needs_review = false;
            hooks.push((handler.key.clone(), handler.current_hash.clone()));
        }
        if hooks.is_empty() {
            HooksBrowserAction::None
        } else {
            HooksBrowserAction::TrustAll { hooks }
        }
    }

    fn handle_list_action(&mut self, action: ListAction) -> HooksBrowserAction {
        let count = self.entry_count().max(1);
        match action {
            ListAction::Accept => {
                if let HooksPage::Events = self.page {
                    if !self.events.is_empty() {
                        self.page = HooksPage::Handlers(self.selected);
                        self.selected = 0;
                    }
                }
                HooksBrowserAction::None
            }
            ListAction::Cancel => match self.page {
                HooksPage::Events => HooksBrowserAction::Close,
                HooksPage::Handlers(_) => {
                    self.page = HooksPage::Events;
                    self.selected = 0;
                    HooksBrowserAction::None
                }
            },
            ListAction::MoveUp => {
                self.selected = self.selected.checked_sub(1).unwrap_or(count - 1);
                HooksBrowserAction::None
            }
            ListAction::MoveDown => {
                self.selected = (self.selected + 1) % count;
                HooksBrowserAction::None
            }
            ListAction::PageUp => {
                self.selected = self.selected.saturating_sub(self.page_rows.get().max(1));
                HooksBrowserAction::None
            }
            ListAction::PageDown => {
                self.selected = (self.selected + self.page_rows.get().max(1)).min(count - 1);
                HooksBrowserAction::None
            }
            ListAction::JumpTop => {
                self.selected = 0;
                HooksBrowserAction::None
            }
            ListAction::JumpBottom => {
                self.selected = count - 1;
                HooksBrowserAction::None
            }
            ListAction::MoveLeft | ListAction::MoveRight => HooksBrowserAction::None,
        }
    }

    fn entry_count(&self) -> usize {
        match self.page {
            HooksPage::Events => self.events.len(),
            HooksPage::Handlers(index) => self
                .events
                .get(index)
                .map(|event| event.handlers.len())
                .unwrap_or(0),
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let (entries, subtitle): (Vec<SelectionRow>, &str) = match self.page {
            HooksPage::Events => (
                self.events
                    .iter()
                    .map(|event| {
                        SelectionRow::new(
                            event.event.clone(),
                            Some(format!(
                                "{} {}",
                                event.handlers.len(),
                                locale.hooks_browser_handlers_label()
                            )),
                            Vec::new(),
                        )
                    })
                    .collect(),
                locale.hooks_browser_events_hint(),
            ),
            HooksPage::Handlers(index) => {
                let handlers = self
                    .events
                    .get(index)
                    .map(|event| event.handlers.as_slice())
                    .unwrap_or(&[]);
                (
                    handlers
                        .iter()
                        .map(|handler| {
                            let mut details = vec![
                                handler.summary.clone(),
                                handler.source.clone(),
                                format!("{}s", handler.timeout_sec),
                                if handler.needs_review {
                                    locale.hook_trust_review_label().to_string()
                                } else {
                                    locale.hook_trust_trusted_label().to_string()
                                },
                                if handler.enabled {
                                    locale.experimental_enabled_label().to_string()
                                } else {
                                    locale.experimental_disabled_label().to_string()
                                },
                            ];
                            if !handler.warnings.is_empty() {
                                details.push(format!(
                                    "{} {}",
                                    handler.warnings.len(),
                                    locale.hooks_browser_warnings_label()
                                ));
                            }
                            if !handler.errors.is_empty() {
                                details.push(format!(
                                    "{} {}",
                                    handler.errors.len(),
                                    locale.hooks_browser_errors_label()
                                ));
                            }
                            SelectionRow::new(
                                handler.key.clone(),
                                Some(details.join(" · ")),
                                Vec::new(),
                            )
                        })
                        .collect(),
                    locale.hooks_browser_handlers_hint(),
                )
            }
        };
        ListSelectionView {
            footer: None,
            title: locale.hooks_title(),
            subtitle: Line::from(subtitle),
            query: None,
            entries,
            selected: self.selected,
            empty_text: locale.hooks_empty(),
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, browser: &HooksBrowser, locale: Locale) {
    browser.page_rows.set(list_selection_view::render(
        frame,
        area,
        &browser.view(locale),
    ));
}

pub(crate) fn desired_height(browser: &HooksBrowser, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&browser.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    fn handler(needs_review: bool) -> HookHandlerView {
        HookHandlerView {
            key: "gate-hook".to_string(),
            summary: "cmd: echo gate".to_string(),
            source: "user".to_string(),
            timeout_sec: 5,
            warnings: Vec::new(),
            errors: Vec::new(),
            enabled: true,
            needs_review,
            is_managed: false,
            current_hash: "hash-1".to_string(),
        }
    }

    fn browser(needs_review: bool) -> HooksBrowser {
        HooksBrowser::new(vec![HookEventView {
            event: "pre_tool_use".to_string(),
            handlers: vec![handler(needs_review)],
        }])
    }

    #[test]
    fn enter_drills_into_handlers_and_escape_goes_back() {
        let mut browser = browser(false);
        assert_eq!(
            browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            HooksBrowserAction::None
        );
        assert_eq!(browser.entry_count(), 1);
        assert_eq!(
            browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            HooksBrowserAction::None
        );
        assert_eq!(browser.page, HooksPage::Events);
        assert_eq!(
            browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            HooksBrowserAction::Close
        );
    }

    #[test]
    fn ctrl_c_closes_from_any_page() {
        let mut browser = browser(false);
        browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter)));
        assert_eq!(
            browser.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Char('c'),
                KeyModifiers::CONTROL
            ))),
            HooksBrowserAction::Close
        );
    }

    #[test]
    fn space_toggles_enabled_for_a_trusted_hook() {
        let mut browser = browser(false);
        browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter)));
        assert_eq!(
            browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Char(' ')))),
            HooksBrowserAction::SetEnabled {
                key: "gate-hook".to_string(),
                enabled: false,
            }
        );
    }

    #[test]
    fn t_trusts_the_selected_review_hook() {
        let mut browser = browser(true);
        browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter)));
        assert_eq!(
            browser.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('t')))),
            HooksBrowserAction::Trust {
                key: "gate-hook".to_string(),
                current_hash: "hash-1".to_string(),
            }
        );
        assert!(!browser.events[0].handlers[0].needs_review);
    }
}
