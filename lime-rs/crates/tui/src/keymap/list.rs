//! List navigation and hints resolve from the same immutable startup configuration.

use super::*;
use lime_core::config::TuiListKeymap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ListAction {
    MoveUp,
    MoveDown,
    MoveLeft,
    MoveRight,
    PageUp,
    PageDown,
    JumpTop,
    JumpBottom,
    Accept,
    Cancel,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ListKeymap {
    actions: Vec<(ListAction, BindingSet)>,
}

impl ListKeymap {
    pub(super) fn from_config(config: &TuiListKeymap) -> Result<Self, String> {
        let definitions = [
            (
                ListAction::MoveUp,
                "move_up",
                config.move_up.as_ref(),
                vec![plain(KeyCode::Up), ctrl('p'), ctrl('k'), plain_char('k')],
            ),
            (
                ListAction::MoveDown,
                "move_down",
                config.move_down.as_ref(),
                vec![plain(KeyCode::Down), ctrl('n'), ctrl('j'), plain_char('j')],
            ),
            (
                ListAction::MoveLeft,
                "move_left",
                config.move_left.as_ref(),
                vec![plain(KeyCode::Left), ctrl('h')],
            ),
            (
                ListAction::MoveRight,
                "move_right",
                config.move_right.as_ref(),
                vec![plain(KeyCode::Right), ctrl('l')],
            ),
            (
                ListAction::PageUp,
                "page_up",
                config.page_up.as_ref(),
                vec![plain(KeyCode::PageUp), ctrl('b')],
            ),
            (
                ListAction::PageDown,
                "page_down",
                config.page_down.as_ref(),
                vec![plain(KeyCode::PageDown), ctrl('f')],
            ),
            (
                ListAction::JumpTop,
                "jump_top",
                config.jump_top.as_ref(),
                vec![plain(KeyCode::Home)],
            ),
            (
                ListAction::JumpBottom,
                "jump_bottom",
                config.jump_bottom.as_ref(),
                vec![plain(KeyCode::End)],
            ),
            (
                ListAction::Accept,
                "accept",
                config.accept.as_ref(),
                vec![plain(KeyCode::Enter)],
            ),
            (
                ListAction::Cancel,
                "cancel",
                config.cancel.as_ref(),
                vec![plain(KeyCode::Esc)],
            ),
        ];
        let resolved = definitions
            .into_iter()
            .map(|(action, name, value, defaults)| {
                BindingSet::resolve(
                    value,
                    singles(&defaults),
                    &format!("tui.keymap.list.{name}"),
                )
                .map(|bindings| (action, name, bindings))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let validation = resolved
            .iter()
            .map(|(_, name, bindings)| (*name, bindings))
            .collect::<Vec<_>>();
        validate_context("list", &validation)?;
        // Resume's protected exit, details and toolbar-focus keys are not list configuration.
        // Reject unreachable custom bindings instead of displaying hints that cannot work.
        let reserved = [
            ctrl('c'),
            ctrl('o'),
            ctrl('t'),
            ctrl('e'),
            plain(KeyCode::Tab),
            plain(KeyCode::BackTab),
            plain(KeyCode::Backspace),
        ];
        for (_, name, bindings) in &resolved {
            if bindings.shortcuts.iter().any(|shortcut| {
                let first = match shortcut {
                    Shortcut::Single(key) => key,
                    Shortcut::Chord { prefix, .. } => prefix,
                };
                reserved
                    .iter()
                    .any(|key| key.normalized_parts() == first.normalized_parts())
            }) {
                return Err(format!(
                    "Invalid `tui.keymap.list.{name}`: binding overlaps a reserved picker key"
                ));
            }
        }
        Ok(Self {
            actions: resolved
                .into_iter()
                .map(|(action, _, bindings)| (action, bindings))
                .collect(),
        })
    }

    pub(crate) fn dispatch(
        &self,
        matcher: &mut KeyChordMatcher,
        key: KeyEvent,
        searchable: bool,
    ) -> KeymapMatch<ListAction> {
        let actions = self.binding_actions(key, searchable, matcher);
        matcher.advance(key, &actions)
    }

    pub(super) fn binding_actions(
        &self,
        key: KeyEvent,
        searchable: bool,
        matcher: &KeyChordMatcher,
    ) -> Vec<(ListAction, &BindingSet)> {
        // Searchable lists give printable navigation to the query. A chord completion still
        // belongs to its pending owner, and explicit accept/cancel retains upstream precedence.
        let allow_navigation = !searchable
            || matcher.pending.is_some()
            || !matches!(key.code, KeyCode::Char(_))
            || key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT);
        self.actions
            .iter()
            .filter(|(action, _)| {
                allow_navigation || matches!(action, ListAction::Accept | ListAction::Cancel)
            })
            .map(|(action, bindings)| (*action, bindings))
            .collect()
    }

    pub(crate) fn primary_hint(&self, action: ListAction) -> Option<String> {
        self.actions
            .iter()
            .find(|(candidate, _)| *candidate == action)?
            .1
            .labels()
            .next()
    }

    pub(crate) fn primary_hint_without_tasks(
        &self,
        action: ListAction,
        agents: &AgentsKeymap,
    ) -> Option<String> {
        self.actions
            .iter()
            .find(|(candidate, _)| *candidate == action)?
            .1
            .shortcuts
            .iter()
            .find(|shortcut| !agents.shadows(shortcut))
            .map(Shortcut::display_label)
    }
}

impl Default for ListKeymap {
    fn default() -> Self {
        Self::from_config(&TuiListKeymap::default()).expect("built-in list bindings must be valid")
    }
}

#[cfg(test)]
#[path = "list_tests.rs"]
mod tests;
