//! Destructive-action confirmation rendered with the shared list selection view.

use std::cell::Cell;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use ratatui::Frame;

use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::keymap::{KeyChordMatcher, KeymapMatch, ListAction, ListKeymap};
use crate::locale::Locale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfirmPromptAction {
    None,
    Confirm,
    Cancel,
}

#[derive(Debug, Clone)]
pub(crate) struct ConfirmPrompt {
    selected: usize,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    chord_matcher: KeyChordMatcher,
    kind: ConfirmKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConfirmKind {
    ArchiveThread,
    DeleteThread,
    ResetMemory,
    UninstallPlugin {
        plugin_id: String,
        name: String,
    },
    TerminateProcess {
        thread_id: String,
        process_id: String,
        command: String,
    },
    DeleteWorktree {
        worktree_path: String,
    },
    ApproveGuardianRetry {
        summary: String,
        event: serde_json::Value,
    },
    InstallPlugin {
        plugin_name: String,
        marketplace_path: Option<String>,
        remote_marketplace_name: Option<String>,
        remote_release: Option<app_server_protocol::protocol::v2::MarketReleaseReference>,
    },
}

impl ConfirmPrompt {
    pub(crate) fn archive() -> Self {
        Self::new(ConfirmKind::ArchiveThread)
    }

    pub(crate) fn delete_thread() -> Self {
        Self::new(ConfirmKind::DeleteThread)
    }

    pub(crate) fn reset_memory() -> Self {
        Self::new(ConfirmKind::ResetMemory)
    }

    pub(crate) fn uninstall_plugin(plugin_id: String, name: String) -> Self {
        Self::new(ConfirmKind::UninstallPlugin { plugin_id, name })
    }

    pub(crate) fn terminate_process(
        thread_id: String,
        process_id: String,
        command: String,
    ) -> Self {
        Self::new(ConfirmKind::TerminateProcess {
            thread_id,
            process_id,
            command,
        })
    }

    pub(crate) fn delete_worktree(worktree_path: String) -> Self {
        Self::new(ConfirmKind::DeleteWorktree { worktree_path })
    }

    pub(crate) fn approve_guardian_retry(summary: String, event: serde_json::Value) -> Self {
        Self::new(ConfirmKind::ApproveGuardianRetry { summary, event })
    }

    pub(crate) fn install_plugin(
        plugin_name: String,
        marketplace_path: Option<String>,
        remote_marketplace_name: Option<String>,
        remote_release: Option<app_server_protocol::protocol::v2::MarketReleaseReference>,
    ) -> Self {
        Self::new(ConfirmKind::InstallPlugin {
            plugin_name,
            marketplace_path,
            remote_marketplace_name,
            remote_release,
        })
    }

    fn new(kind: ConfirmKind) -> Self {
        Self {
            selected: 0,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            chord_matcher: KeyChordMatcher::default(),
            kind,
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.chord_matcher.reset();
        self
    }

    pub(crate) fn kind(&self) -> ConfirmKind {
        self.kind.clone()
    }

    pub(crate) fn handle_event(&mut self, event: Event) -> ConfirmPromptAction {
        if !matches!(event, Event::Key(_)) {
            self.chord_matcher.reset();
        }
        let Event::Key(key) = event else {
            return ConfirmPromptAction::None;
        };
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return ConfirmPromptAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.chord_matcher.reset();
            return ConfirmPromptAction::Cancel;
        }
        match self
            .list_keymap
            .dispatch(&mut self.chord_matcher, key, false)
        {
            KeymapMatch::Completed(action) => return self.handle_list_action(action),
            KeymapMatch::Pending | KeymapMatch::Cancelled => return ConfirmPromptAction::None,
            KeymapMatch::PassThrough => {}
        }
        if let KeyCode::Char(ch) = key.code {
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                match ch {
                    '1' => {
                        self.selected = 0;
                        return ConfirmPromptAction::Cancel;
                    }
                    '2' => {
                        self.selected = 1;
                        return ConfirmPromptAction::Confirm;
                    }
                    _ => {}
                }
            }
        }
        ConfirmPromptAction::None
    }

    fn handle_list_action(&mut self, action: ListAction) -> ConfirmPromptAction {
        match action {
            ListAction::Accept => match self.selected {
                1 => ConfirmPromptAction::Confirm,
                _ => ConfirmPromptAction::Cancel,
            },
            ListAction::Cancel => ConfirmPromptAction::Cancel,
            ListAction::MoveUp | ListAction::MoveDown => {
                self.selected = 1 - self.selected;
                ConfirmPromptAction::None
            }
            _ => ConfirmPromptAction::None,
        }
    }

    fn view(&self, locale: Locale) -> ListSelectionView<'_> {
        let label = match &self.kind {
            ConfirmKind::ArchiveThread => locale.confirm_archive_label().to_string(),
            ConfirmKind::DeleteThread => locale.confirm_delete_label().to_string(),
            ConfirmKind::ResetMemory => locale.confirm_reset_memory_label().to_string(),
            ConfirmKind::UninstallPlugin { name, .. } => {
                locale.confirm_uninstall_plugin_label(name)
            }
            ConfirmKind::InstallPlugin { plugin_name, .. } => {
                locale.confirm_install_plugin_label(plugin_name)
            }
            ConfirmKind::ApproveGuardianRetry { summary, .. } => {
                locale.confirm_approve_guardian_retry_label(summary)
            }
            ConfirmKind::DeleteWorktree { worktree_path } => {
                locale.confirm_delete_worktree_label(worktree_path)
            }
            ConfirmKind::TerminateProcess { command, .. } => {
                locale.confirm_terminate_process_label(command)
            }
        };
        let description = match &self.kind {
            ConfirmKind::ArchiveThread => locale.confirm_archive_description(),
            ConfirmKind::DeleteThread => locale.confirm_delete_description(),
            ConfirmKind::ResetMemory => locale.confirm_reset_memory_description(),
            ConfirmKind::UninstallPlugin { .. } => locale.confirm_uninstall_plugin_description(),
            ConfirmKind::InstallPlugin { .. } => locale.confirm_install_plugin_description(),
            ConfirmKind::ApproveGuardianRetry { .. } => {
                locale.confirm_approve_guardian_retry_description()
            }
            ConfirmKind::DeleteWorktree { .. } => locale.confirm_delete_worktree_description(),
            ConfirmKind::TerminateProcess { .. } => locale.confirm_terminate_process_description(),
        };
        let entries = vec![
            SelectionRow::new(
                locale.confirm_cancel_label(),
                Some(locale.confirm_cancel_description().to_string()),
                Vec::new(),
            ),
            SelectionRow::new(label, Some(description.to_string()), Vec::new()),
        ];
        ListSelectionView {
            footer: None,
            title: match self.kind {
                ConfirmKind::ArchiveThread => locale.confirm_archive_title(),
                ConfirmKind::DeleteThread => locale.confirm_delete_title(),
                ConfirmKind::ResetMemory => locale.confirm_reset_memory_title(),
                ConfirmKind::UninstallPlugin { .. } => locale.confirm_uninstall_plugin_title(),
                ConfirmKind::InstallPlugin { .. } => locale.confirm_install_plugin_title(),
                ConfirmKind::ApproveGuardianRetry { .. } => {
                    locale.confirm_approve_guardian_retry_title()
                }
                ConfirmKind::DeleteWorktree { .. } => locale.confirm_delete_worktree_title(),
                ConfirmKind::TerminateProcess { .. } => locale.confirm_terminate_process_title(),
            },
            subtitle: Line::from(match self.kind {
                ConfirmKind::ArchiveThread => locale.confirm_archive_subtitle(),
                ConfirmKind::DeleteThread => locale.confirm_delete_subtitle(),
                ConfirmKind::ResetMemory => locale.confirm_reset_memory_subtitle(),
                ConfirmKind::UninstallPlugin { .. } => locale.confirm_uninstall_plugin_subtitle(),
                ConfirmKind::InstallPlugin { .. } => locale.confirm_install_plugin_subtitle(),
                ConfirmKind::ApproveGuardianRetry { .. } => {
                    locale.confirm_approve_guardian_retry_subtitle()
                }
                ConfirmKind::DeleteWorktree { .. } => locale.confirm_delete_worktree_subtitle(),
                ConfirmKind::TerminateProcess { .. } => locale.confirm_terminate_process_subtitle(),
            }),
            query: None,
            entries,
            selected: self.selected,
            empty_text: "",
            keymap: &self.list_keymap,
            locale,
        }
    }
}

pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, prompt: &ConfirmPrompt, locale: Locale) {
    prompt.page_rows.set(list_selection_view::render(
        frame,
        area,
        &prompt.view(locale),
    ));
}

pub(crate) fn desired_height(prompt: &ConfirmPrompt, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&prompt.view(locale), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEvent;

    #[test]
    fn enter_cancels_by_default_and_down_then_enter_confirms() {
        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfirmPromptAction::Cancel
        );

        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Down))),
            ConfirmPromptAction::None
        );
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Enter))),
            ConfirmPromptAction::Confirm
        );
    }

    #[test]
    fn escape_and_ctrl_c_cancel() {
        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Esc))),
            ConfirmPromptAction::Cancel
        );

        let mut prompt = ConfirmPrompt::archive();
        let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(
            prompt.handle_event(Event::Key(ctrl_c)),
            ConfirmPromptAction::Cancel
        );
    }

    #[test]
    fn delete_variant_reports_its_kind() {
        let prompt = ConfirmPrompt::delete_thread();
        assert_eq!(prompt.kind(), ConfirmKind::DeleteThread);
        let archive = ConfirmPrompt::archive();
        assert_eq!(archive.kind(), ConfirmKind::ArchiveThread);
        let memory = ConfirmPrompt::reset_memory();
        assert_eq!(memory.kind(), ConfirmKind::ResetMemory);
        let plugin = ConfirmPrompt::uninstall_plugin("p1".to_string(), "gate".to_string());
        assert_eq!(
            plugin.kind(),
            ConfirmKind::UninstallPlugin {
                plugin_id: "p1".to_string(),
                name: "gate".to_string()
            }
        );
    }

    #[test]
    fn numbered_shortcuts_pick_both_outcomes() {
        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('1')))),
            ConfirmPromptAction::Cancel
        );

        let mut prompt = ConfirmPrompt::archive();
        assert_eq!(
            prompt.handle_event(Event::Key(KeyEvent::from(KeyCode::Char('2')))),
            ConfirmPromptAction::Confirm
        );
    }
}
