//! Transcript presentation state owned by `ChatWidget`.
//!
//! App keeps thread routing and the canonical projection. This module owns the mutable pager,
//! scroll, selection and turn-presentation reset rules that shape the terminal surface.

use super::ChatWidget;
use crate::history_cell::HistoryRenderMode;
use crate::pager_overlay::PagerOverlay;
use crate::status::{StatusFacts, StatusSnapshot};
use app_server_protocol::protocol::v2::{McpServerStatus, McpServerStatusDetail};
use ratatui::text::Line;
use std::time::Instant;

impl ChatWidget {
    pub(crate) fn set_scrollback_has_older_history(&mut self, available: bool) {
        self.scrollback_has_older_history = available;
        if let Some(pager) = self.pager_overlay.as_ref() {
            pager.set_older_history_available(available);
        }
    }

    pub(crate) fn scrollback_has_older_history(&self) -> bool {
        self.scrollback_has_older_history
    }

    #[cfg(test)]
    pub(crate) fn set_pager_overlay(&mut self, pager: PagerOverlay) {
        self.pager_overlay = Some(pager);
    }

    pub(crate) fn is_raw_output_mode(&self) -> bool {
        self.history_render_mode == HistoryRenderMode::Raw
    }

    pub(crate) fn toggle_history_render_mode(&mut self) -> bool {
        self.history_render_mode = match self.history_render_mode {
            HistoryRenderMode::Rich => HistoryRenderMode::Raw,
            HistoryRenderMode::Raw => HistoryRenderMode::Rich,
        };
        self.is_raw_output_mode()
    }

    pub(crate) fn dismiss_pager_overlay(&mut self) {
        let Some(pager) = self.pager_overlay.take() else {
            return;
        };
        self.transcript_presentation.retain(pager);
    }

    pub(crate) fn reset_transcript_presentation(&mut self) {
        if self
            .pager_overlay
            .as_ref()
            .is_some_and(PagerOverlay::is_transcript)
        {
            self.pager_overlay = None;
        }
        self.transcript_presentation.clear();
    }

    pub(crate) fn reset_thread_surface(&mut self, active_turn_id: Option<&str>, now: Instant) {
        self.copy_picker = None;
        self.last_status_copy_targets = None;
        self.queued_submissions.clear();

        self.turn_lifecycle.reset_thread();
        self.turn_lifecycle.restore_running(active_turn_id, now);
    }

    pub(crate) fn reset_for_hydrated_thread(&mut self) {
        self.copy_picker = None;
        self.last_status_copy_targets = None;
        self.set_active_reasoning_effort_baseline();
        self.status_line_setup = None;
        self.terminal_title_setup = None;

        self.turn_lifecycle.reset_thread();
    }

    pub(crate) fn open_status_pager(&mut self, facts: StatusFacts<'_>) {
        self.dismiss_pager_overlay();
        let snapshot = std::sync::Arc::new(StatusSnapshot::from_facts(facts));
        self.last_status_copy_targets = Some(super::copy_picker::StatusCopySource {
            handle: std::sync::Arc::clone(&snapshot),
        });
        self.pager_overlay = Some(
            PagerOverlay::status(self.locale, snapshot)
                .with_keymap(self.runtime_keymap.transcript().clone()),
        );
    }

    pub(crate) fn open_text_pager(&mut self, title: String, lines: Vec<Line<'static>>) {
        self.dismiss_pager_overlay();
        self.pager_overlay = Some(
            PagerOverlay::new(title, lines).with_keymap(self.runtime_keymap.transcript().clone()),
        );
    }

    pub(crate) fn open_mcp_inventory(
        &mut self,
        statuses: &[McpServerStatus],
        detail: McpServerStatusDetail,
    ) {
        let lines = crate::history_cell::mcp_inventory_lines(statuses, detail, self.locale);
        self.dismiss_pager_overlay();
        self.pager_overlay = Some(
            PagerOverlay::new(self.locale.mcp_inventory_title().to_string(), lines)
                .with_keymap(self.runtime_keymap.transcript().clone()),
        );
    }
}
