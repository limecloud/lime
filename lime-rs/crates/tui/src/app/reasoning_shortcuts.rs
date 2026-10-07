//! Main-surface reasoning shortcuts never infer capabilities or escape an input owner.

use super::*;
use crate::chatwidget::ExternalEditorState;
use crate::model_catalog::{ReasoningShortcutDirection, ReasoningStep};

impl App {
    pub(super) fn reasoning_shortcut_input_is_owned(&self) -> bool {
        self.chat_widget.bottom_pane.is_active()
            || self.chat_widget.model_picker.is_some()
            || self.chat_widget.agent_picker.is_some()
            || self.chat_widget.agents_overview.is_some()
            || self.chat_widget.resume_picker.is_some()
            || self.chat_widget.pager_overlay.is_some()
            || self.chat_widget.export_picker.is_some()
            || self.chat_widget.status_line_setup.is_some()
            || self.chat_widget.terminal_title_setup.is_some()
            || self.chat_widget.transcript_search.is_active()
            || self.chat_widget.bottom_pane.popup_active()
            || self.chat_widget.bottom_pane.history_search_active()
            || self.chat_widget.bottom_pane.vim_search_active()
            || self.chat_widget.external_editor_state() != ExternalEditorState::Closed
            || self.has_queued_startup_protected_request()
    }

    pub(super) fn prepare_reasoning_shortcut(
        &mut self,
        direction: ReasoningShortcutDirection,
    ) -> Option<String> {
        if self.reasoning_shortcut_input_is_owned() {
            return None;
        }
        if !self.can_accept_direct_input() {
            self.projection
                .set_status(self.chat_widget.locale.reasoning_parent_owned_message());
            return None;
        }
        if self.thread_id.is_none() || self.startup_protected_input_boundary {
            self.projection
                .set_status(self.chat_widget.locale.reasoning_startup_message());
            return None;
        }
        // The current contract couples Plan and ordinary effort. Do not pretend a plain settings
        // mutation is a Plan-only override, or create a second client-owned settings store.
        if self
            .chat_widget
            .collaboration_mode
            .as_ref()
            .is_some_and(|mode| mode.mode == agent_protocol::ModeKind::Plan)
        {
            self.projection
                .set_status(self.chat_widget.locale.reasoning_plan_message());
            return None;
        }
        match self.chat_widget.model_catalog.reasoning_step(
            self.chat_widget.model.as_deref(),
            self.chat_widget.model_provider.as_deref(),
            self.chat_widget.reasoning_effort.as_deref(),
            direction,
        ) {
            Some(ReasoningStep::Change(effort)) => Some(effort),
            Some(ReasoningStep::Bound(effort)) => {
                self.projection.set_status(
                    self.chat_widget
                        .locale
                        .reasoning_boundary_message(direction, &effort),
                );
                None
            }
            Some(ReasoningStep::Advanced) => {
                self.projection
                    .set_status(self.chat_widget.locale.reasoning_ultra_message(
                        self.chat_widget.model.as_deref().unwrap_or_default(),
                    ));
                None
            }
            None => {
                self.projection
                    .set_status(self.chat_widget.locale.reasoning_unavailable_message(
                        self.chat_widget.model.as_deref().unwrap_or_default(),
                    ));
                None
            }
        }
    }
}

#[cfg(test)]
#[path = "reasoning_shortcuts_tests.rs"]
mod tests;
