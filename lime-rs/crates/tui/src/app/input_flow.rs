//! Keyboard input flow for the TUI app.
//!
//! This owner mirrors Codex `chatwidget/input_flow`: App owns global routing,
//! while ChatComposer remains the editor and popup owner.

use super::*;
use crate::app::agent_navigation::AgentNavigationDirection;
use crate::bottom_pane::pending_input_preview::can_restore_submission;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

impl App {
    pub(crate) fn handle_key_event(&mut self, key_event: KeyEvent) -> AppAction {
        if crate::key_hint::is_altgr(key_event.modifiers)
            && matches!(key_event.code, KeyCode::Char(_))
        {
            let action = self
                .composer
                .handle_key_event_at(key_event, std::time::Instant::now());
            return self.map_composer_action(action);
        }
        if key_event.modifiers.contains(KeyModifiers::ALT)
            && matches!(key_event.code, KeyCode::Char(',' | '.'))
            && self.reasoning_shortcut_input_is_owned()
        {
            return AppAction::None;
        }
        if key_event.kind == KeyEventKind::Press
            && key_event.code == KeyCode::Esc
            && key_event.modifiers.is_empty()
            && self.composer.dismiss_shortcut_overlay()
        {
            return AppAction::None;
        }
        if self.resume_picker.is_none()
            && self.agents_overview.is_none()
            && key_event.kind == KeyEventKind::Press
        {
            match key_event.code {
                KeyCode::PageUp => return AppAction::ScrollUp,
                KeyCode::PageDown => return AppAction::ScrollDown,
                KeyCode::Home if key_event.modifiers.contains(KeyModifiers::ALT) => {
                    return AppAction::ScrollTop;
                }
                KeyCode::End if key_event.modifiers.contains(KeyModifiers::ALT) => {
                    return AppAction::ScrollBottom;
                }
                _ => {}
            }
        }

        if key_event.kind == KeyEventKind::Press
            && self.projection.active_turn_id().is_none()
            && self.composer.is_empty()
        {
            let direction = if crate::multi_agents::previous_agent_shortcut_matches(key_event, true)
            {
                Some(AgentNavigationDirection::Previous)
            } else if crate::multi_agents::next_agent_shortcut_matches(key_event, true) {
                Some(AgentNavigationDirection::Next)
            } else {
                None
            };
            if let Some(direction) = direction {
                return self
                    .adjacent_agent(direction)
                    .map(AppAction::SwitchThread)
                    .unwrap_or(AppAction::None);
            }
        }
        if key_event.kind == KeyEventKind::Press
            && key_event.code == KeyCode::BackTab
            && self.projection.active_turn_id().is_none()
        {
            return self
                .next_collaboration_mode()
                .map(AppAction::ChangeCollaborationMode)
                .unwrap_or(AppAction::None);
        }

        match key_event {
            KeyEvent {
                code: KeyCode::Esc,
                kind: KeyEventKind::Press,
                ..
            } if self.transcript_scroll > 0 => {
                self.scroll_bottom();
                AppAction::None
            }
            KeyEvent {
                code: KeyCode::Esc,
                kind: KeyEventKind::Press,
                ..
            } if super::interrupts::should_interrupt_turn(self) => AppAction::Interrupt,
            KeyEvent {
                code: KeyCode::Char(value),
                modifiers,
                kind: KeyEventKind::Press,
                ..
            } if modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
                && value.eq_ignore_ascii_case(&'v') =>
            {
                AppAction::PasteImage
            }
            KeyEvent {
                code: KeyCode::Char(value),
                modifiers,
                kind: KeyEventKind::Press,
                ..
            } if modifiers.contains(KeyModifiers::CONTROL) && value.eq_ignore_ascii_case(&'o') => {
                AppAction::CopyLastResponse
            }
            KeyEvent {
                code: KeyCode::Up,
                modifiers,
                kind: KeyEventKind::Press,
                ..
            } if modifiers.contains(KeyModifiers::ALT) && self.composer.is_empty() => self
                .queued_submissions
                .last()
                .filter(|submission| can_restore_submission(submission))
                .cloned()
                .map(AppAction::EditQueuedSubmission)
                .unwrap_or(AppAction::None),
            KeyEvent {
                kind: KeyEventKind::Press,
                ..
            } => {
                if key_event.code == KeyCode::Enter
                    && !self.composer.vim_search_active()
                    && !key_event
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SHIFT)
                {
                    if let Some(action) = self.run_local_command() {
                        return action;
                    }
                }
                let action = self
                    .composer
                    .handle_key_event_at(key_event, std::time::Instant::now());
                self.map_composer_action(action)
            }
            _ => {
                let action = self
                    .composer
                    .handle_key_event_at(key_event, std::time::Instant::now());
                self.map_composer_action(action)
            }
        }
    }
}
