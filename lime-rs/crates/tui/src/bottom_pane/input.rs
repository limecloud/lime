//! Active interaction and composer editing share one terminal input boundary.

use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind};
use std::time::Instant;

use super::command_popup::CommandPopupAction;
use super::{AppServerResponse, BottomPane, FileSearchPopupAction, InputResult, SkillPopupAction};
use crate::slash_command::SlashCommand;

#[derive(Debug, PartialEq)]
pub(crate) enum ChatWidgetAction {
    Input(InputResult),
    Respond(AppServerResponse),
    ExecuteCommand,
}

impl BottomPane {
    /// Give modal, query, popup and editor chords priority over host shortcuts.
    /// Ordinary keys pass through so App can decide global navigation and interruption.
    pub(crate) fn handle_event(&mut self, event: Event) -> Option<ChatWidgetAction> {
        self.handle_event_at(event, Instant::now())
    }

    fn handle_event_at(&mut self, event: Event, now: Instant) -> Option<ChatWidgetAction> {
        if self.is_active() {
            return Some(
                self.handle_interaction_event(event)
                    .map(ChatWidgetAction::Respond)
                    .unwrap_or(ChatWidgetAction::Input(InputResult::None)),
            );
        }
        if matches!(event, Event::Key(_) | Event::FocusLost) {
            self.composer.end_mouse_drag();
        }
        if matches!(&event, Event::Key(key) if key.kind == KeyEventKind::Press
            && key.code == KeyCode::Esc && key.modifiers.is_empty())
            && self.composer.dismiss_shortcut_overlay()
        {
            return Some(ChatWidgetAction::Input(InputResult::None));
        }
        if let Event::Mouse(mouse) = event {
            self.composer.handle_mouse(mouse);
            return Some(ChatWidgetAction::Input(InputResult::None));
        }
        let query_owns_event = self.composer.vim_search_active()
            || matches!(&event, Event::Key(key) if self.composer.vim_search_wants_key(*key));
        if query_owns_event {
            return self.handle_query_event(event, now);
        }
        if self.composer.completion_popup_active() {
            if let Event::Key(key) = &event {
                if self.composer.prepare_popup_key_event(*key, now) {
                    return Some(ChatWidgetAction::Input(
                        self.finish_input(InputResult::Changed),
                    ));
                }
            }
        }
        if self.composer.file_search_popup_active() {
            match self.composer.handle_file_search_popup_event(&event) {
                FileSearchPopupAction::Pass => {}
                FileSearchPopupAction::Consumed => {
                    if !matches!(event, Event::Key(key) if key.code == KeyCode::Enter) {
                        return Some(ChatWidgetAction::Input(InputResult::None));
                    }
                }
                FileSearchPopupAction::Cancel | FileSearchPopupAction::Complete => {
                    return Some(ChatWidgetAction::Input(InputResult::None));
                }
            }
        }
        if self.composer.skill_popup_active()
            && !matches!(
                self.composer.handle_skill_popup_event(&event),
                SkillPopupAction::Pass
            )
        {
            return Some(ChatWidgetAction::Input(InputResult::None));
        }
        if self.composer.completion_popup_active() {
            match self.composer.handle_command_popup_event(&event) {
                CommandPopupAction::Pass => {}
                CommandPopupAction::Consumed | CommandPopupAction::Cancel => {
                    return Some(ChatWidgetAction::Input(InputResult::None));
                }
                CommandPopupAction::Complete(command) => {
                    self.complete_slash_command(command);
                    return Some(ChatWidgetAction::Input(InputResult::None));
                }
                CommandPopupAction::Execute(command) => {
                    self.composer.replace(format!("/{}", command.command()));
                    self.composer.clear_completion_popup();
                    return Some(ChatWidgetAction::ExecuteCommand);
                }
            }
        }
        if self.composer.history_search_active() {
            return self.handle_query_event(event, now);
        }
        match event {
            Event::Key(key)
                if self.composer.should_handle_vim_insert_escape(key)
                    || self.composer.key_chord_pending()
                    || self.composer.vim_key_event_is_owned(key) =>
            {
                Some(ChatWidgetAction::Input(
                    self.handle_composer_key_at(key, now),
                ))
            }
            Event::Paste(text) => {
                self.handle_paste(&text);
                Some(ChatWidgetAction::Input(InputResult::None))
            }
            _ => None,
        }
    }

    fn handle_query_event(&mut self, event: Event, now: Instant) -> Option<ChatWidgetAction> {
        match event {
            Event::Key(key) => Some(ChatWidgetAction::Input(
                self.handle_composer_key_at(key, now),
            )),
            Event::Paste(text) => {
                self.handle_paste(&text);
                Some(ChatWidgetAction::Input(InputResult::None))
            }
            _ => None,
        }
    }

    pub(crate) fn handle_key_event(&mut self, key: KeyEvent) -> ChatWidgetAction {
        self.handle_key_event_at(key, Instant::now())
    }

    pub(crate) fn handle_key_event_at(&mut self, key: KeyEvent, now: Instant) -> ChatWidgetAction {
        self.handle_event_at(Event::Key(key), now)
            .unwrap_or_else(|| ChatWidgetAction::Input(self.handle_composer_key_at(key, now)))
    }

    fn handle_composer_key_at(&mut self, key: KeyEvent, now: Instant) -> InputResult {
        let result = self.composer.handle_key_event_at(key, now);
        self.finish_input(result)
    }

    fn finish_input(&mut self, result: InputResult) -> InputResult {
        match &result {
            InputResult::Changed => {
                if self.composer.history_search_active() || self.composer.vim_search_active() {
                    self.composer.clear_completion_popup();
                } else {
                    self.composer.sync_completion_popup();
                }
            }
            InputResult::Submitted { .. } | InputResult::Queued { .. } => {
                self.composer.clear_completion_popup();
            }
            _ => {}
        }
        result
    }

    pub(crate) fn handle_paste(&mut self, text: &str) {
        if self.is_active() {
            self.handle_interaction_event(Event::Paste(text.to_owned()));
        } else {
            self.composer.handle_paste(text);
            self.finish_input(InputResult::Changed);
        }
    }

    pub(crate) fn handle_disconnected_key(&mut self, key: KeyEvent) {
        self.composer.handle_disconnected_key(key);
        self.composer.clear_completion_popup();
    }

    fn complete_slash_command(&mut self, command: SlashCommand) {
        let suffix = if command.requires_argument() { " " } else { "" };
        self.composer
            .replace(format!("/{}{suffix}", command.command()));
        self.composer.clear_completion_popup();
    }

    pub(crate) fn popup_active(&self) -> bool {
        self.composer.completion_popup_active()
    }

    #[cfg(test)]
    pub(crate) fn handle_mouse(&mut self, event: crossterm::event::MouseEvent) -> bool {
        self.composer.handle_mouse(event)
    }
}

#[cfg(test)]
#[path = "input_tests.rs"]
mod tests;
