//! Main-surface reasoning shortcuts never infer capabilities or escape an input owner.

use super::*;
use crate::model_catalog::{ReasoningShortcutDirection, ReasoningStep};

impl App {
    pub(super) fn reasoning_shortcut_input_is_owned(&self) -> bool {
        self.bottom_pane.is_active()
            || self.model_picker.is_some()
            || self.agent_picker.is_some()
            || self.agents_overview.is_some()
            || self.resume_picker.is_some()
            || self.pager_overlay.is_some()
            || self.export_picker.is_some()
            || self.transcript_search.is_active()
            || self.composer.completion_popup_active()
            || self.composer.file_search_popup_active()
            || self.composer.skill_popup_active()
            || self.composer.history_search_active()
            || self.composer.vim_search_active()
            || self.external_editor_state() != ExternalEditorState::Closed
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
                .set_status(self.locale.reasoning_parent_owned_message());
            return None;
        }
        if self.thread_id.is_none() || self.startup_protected_input_boundary {
            self.projection
                .set_status(self.locale.reasoning_startup_message());
            return None;
        }
        // The current contract couples Plan and ordinary effort. Do not pretend a plain settings
        // mutation is a Plan-only override, or create a second client-owned settings store.
        if self
            .collaboration_mode
            .as_ref()
            .is_some_and(|mode| mode.mode == agent_protocol::ModeKind::Plan)
        {
            self.projection
                .set_status(self.locale.reasoning_plan_message());
            return None;
        }
        match self.model_catalog.reasoning_step(
            self.model.as_deref(),
            self.model_provider.as_deref(),
            self.reasoning_effort.as_deref(),
            direction,
        ) {
            Some(ReasoningStep::Change(effort)) => Some(effort),
            Some(ReasoningStep::Bound(effort)) => {
                self.projection
                    .set_status(self.locale.reasoning_boundary_message(direction, &effort));
                None
            }
            Some(ReasoningStep::Advanced) => {
                self.projection.set_status(
                    self.locale
                        .reasoning_ultra_message(self.model.as_deref().unwrap_or_default()),
                );
                None
            }
            None => {
                self.projection.set_status(
                    self.locale
                        .reasoning_unavailable_message(self.model.as_deref().unwrap_or_default()),
                );
                None
            }
        }
    }
}

#[cfg(test)]
#[path = "reasoning_shortcuts_tests.rs"]
mod tests;
