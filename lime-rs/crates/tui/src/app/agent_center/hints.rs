//! The compact footer and help consume the same resolved task bindings as dispatch.

use super::*;
use crate::footer_hint::{first_fitting_line, shortcut};
use crate::keymap::{shortcut_label, AgentsKeymapAction, ListAction};
use crate::locale::Locale;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};

pub(super) fn hint_line(items: &[(String, String)]) -> Line<'static> {
    let mut spans = Vec::new();
    for (key, label) in items.iter().filter(|(key, _)| !key.is_empty()) {
        if !spans.is_empty() {
            spans.push(Span::raw("  "));
        }
        spans.extend(shortcut(key, label).spans);
    }
    Line::from(spans)
}

impl AgentsOverviewView {
    fn list_hint(&self, action: ListAction) -> Option<String> {
        if self.help || self.editing_metadata() {
            self.list_keymap.primary_hint(action)
        } else {
            self.list_keymap
                .primary_hint_without_tasks(action, &self.agents_keymap)
        }
    }

    fn accept_hint(&self) -> Option<String> {
        let available = !self.help
            && (self.input_mode.is_some()
                || self.selected_row().is_some()
                || self.selected_is_load_more() && !self.loading_more());
        available
            .then(|| self.list_hint(ListAction::Accept))
            .flatten()
    }

    pub(super) fn center_filter_hint(&self) -> String {
        [
            (KeyCode::Tab, KeyModifiers::NONE, "tab"),
            (KeyCode::BackTab, KeyModifiers::SHIFT, "shift+tab"),
        ]
        .into_iter()
        .filter(|(code, modifiers, _)| {
            !self
                .agents_keymap
                .reserves_key(KeyEvent::new(*code, *modifiers))
        })
        .map(|(_, _, label)| label)
        .collect::<Vec<_>>()
        .join("/")
    }

    pub(super) fn center_footer_hints(&self, locale: Locale) -> Vec<(String, String)> {
        let label = |name| locale.agent_center_label(name).to_string();
        let mut hints = Vec::new();
        if !self.help
            && !self.editing_metadata()
            && !self
                .agents_keymap
                .reserves_key(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE))
        {
            hints.push(("?".into(), label("help")));
        }
        let cancel = self.list_hint(ListAction::Cancel);
        if let Some(cancel) = cancel {
            hints.push((cancel, label("back")));
        }
        if self.help {
            return hints;
        }
        if !self.editing_metadata() && self.item_count() > 0 {
            let navigation = [ListAction::MoveUp, ListAction::MoveDown]
                .into_iter()
                .filter_map(|code| self.list_hint(code))
                .collect::<Vec<_>>()
                .join("/");
            if !navigation.is_empty() {
                hints.push((navigation, label("move")));
            }
        }
        let action = match self.input_mode {
            Some(super::super::AgentsOverviewInputMode::Rename) => "rename",
            Some(super::super::AgentsOverviewInputMode::NewTask) => "confirm",
            None if self.selected_is_load_more() => "Show more",
            None => "open",
        };
        let accept = self.accept_hint();
        if let Some(accept) = accept {
            hints.push((accept, label(action)));
        }
        if !self.editing_metadata() {
            if let Some(key) = self.agents_keymap.primary_hint(AgentsKeymapAction::NewTask) {
                hints.push((key, label("new")));
            }
        }
        hints
    }

    pub(super) fn center_help_lines(&self, locale: Locale, width: u16) -> Vec<Line<'static>> {
        use crate::shortcut_help::Group;
        let mut navigate = Group {
            title: locale.agent_center_label("Navigate"),
            entries: Vec::new(),
        };
        for (code, action) in [
            (ListAction::MoveUp, "Up"),
            (ListAction::MoveDown, "Down"),
            (ListAction::Accept, "Open"),
            (ListAction::PageUp, "Page up"),
            (ListAction::PageDown, "Page down"),
        ] {
            navigate.push(
                self.list_keymap
                    .primary_hint_without_tasks(code, &self.agents_keymap),
                locale.agent_center_label(action),
            );
        }
        navigate.push(
            Some(shortcut_label(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            locale.agent_center_label("Quit"),
        );
        let mut tasks = Group {
            title: locale.agent_center_label("Tasks"),
            entries: Vec::new(),
        };
        for (action, label) in [
            (AgentsKeymapAction::NewTask, "New"),
            (AgentsKeymapAction::Resume, "Resume"),
            (AgentsKeymapAction::Rename, "Rename"),
            (AgentsKeymapAction::Stop, "Stop"),
        ] {
            tasks.push(
                self.agents_keymap.primary_hint(action),
                locale.agent_center_label(label),
            );
        }
        let mut view = Group {
            title: locale.agent_center_label("View"),
            entries: Vec::new(),
        };
        view.push(
            Some(self.center_filter_hint()),
            locale.agent_center_label("Filter"),
        );
        for (action, label) in [
            (AgentsKeymapAction::Search, "Search"),
            (AgentsKeymapAction::ToggleGrouping, "Group"),
        ] {
            view.push(
                self.agents_keymap.primary_hint(action),
                locale.agent_center_label(label),
            );
        }
        let mut lines = vec![
            locale.agent_center_label("Task shortcuts").bold().into(),
            Line::default(),
        ];
        lines.extend(crate::shortcut_help::group_lines(
            [navigate, tasks, view],
            width,
        ));
        lines
    }

    pub(super) fn center_footer_line(&self, locale: Locale, width: u16) -> Line<'static> {
        let hints = self.center_footer_hints(locale);
        let keys = [self.list_hint(ListAction::Cancel), self.accept_hint()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let essential = keys
            .iter()
            .filter_map(|key| {
                hints
                    .iter()
                    .find(|(candidate, _)| candidate == key)
                    .cloned()
            })
            .collect::<Vec<_>>();
        first_fitting_line(
            [
                hint_line(&hints),
                hint_line(&essential),
                Line::from(keys.join(" · ")).dim(),
            ]
            .into_iter()
            .chain(keys.iter().map(|key| Line::from(key.clone()).dim()))
            .chain(
                hints
                    .iter()
                    .filter(|(key, _)| !keys.contains(key))
                    .map(|(key, _)| Line::from(key.clone()).dim()),
            ),
            usize::from(width),
        )
    }
}
