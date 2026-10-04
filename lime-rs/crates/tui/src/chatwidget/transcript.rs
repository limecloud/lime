//! Transcript presentation state owned by `ChatWidget`.
//!
//! App keeps thread routing and the canonical projection. This module owns the mutable pager,
//! scroll, selection and turn-presentation reset rules that shape the terminal surface.

use super::ChatWidget;
use crate::history_cell::HistoryRenderMode;
use crate::pager_overlay::PagerOverlay;
use crate::status::StatusFacts;
use app_server_protocol::protocol::v2::{McpServerStatus, McpServerStatusDetail};
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
        self.transcript_viewport.suppress_next_activity();
        self.transcript_prompt_header.clear();
        self.history_render_mode = match self.history_render_mode {
            HistoryRenderMode::Rich => HistoryRenderMode::Raw,
            HistoryRenderMode::Raw => HistoryRenderMode::Rich,
        };
        self.is_raw_output_mode()
    }

    pub(crate) fn open_transcript_pager(&mut self) {
        if let Some(scroll) = self.transcript_search.close() {
            self.transcript_scroll = scroll;
        }
        self.bottom_pane.clear_completion_popup();
        self.dismiss_pager_overlay();
        let pager = self
            .transcript_presentation
            .open(self.locale, self.runtime_keymap.transcript().clone());
        pager.set_older_history_available(self.scrollback_has_older_history);
        self.pager_overlay = Some(pager);
    }

    pub(crate) fn dismiss_pager_overlay(&mut self) {
        self.primary_clipboard_lease = None;
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
        self.primary_clipboard_lease = None;
        self.transcript_presentation.clear();
    }

    pub(crate) fn reset_thread_surface(&mut self, active_turn_id: Option<&str>, now: Instant) {
        self.primary_clipboard_lease = None;
        self.queued_submissions.clear();
        self.transcript_scroll = 0;
        self.transcript_viewport.clear();
        self.transcript_follow_control.clear();
        self.transcript_composer_gap.clear();
        self.transcript_prompt_header.clear();
        self.transcript_search.clear();
        self.transcript_selection.reset();
        self.turn_lifecycle.reset_thread();
        self.turn_lifecycle.restore_running(active_turn_id, now);
    }

    pub(crate) fn reset_for_hydrated_thread(&mut self) {
        self.primary_clipboard_lease = None;
        self.transcript_scroll = 0;
        self.transcript_viewport.clear();
        self.transcript_follow_control.clear();
        self.transcript_composer_gap.clear();
        self.transcript_prompt_header.clear();
        self.transcript_search.clear();
        self.transcript_selection.reset();
        self.turn_lifecycle.reset_thread();
    }

    pub(crate) fn scroll_up(&mut self, amount: usize) {
        self.transcript_scroll = self.transcript_scroll.saturating_add(amount);
    }

    pub(crate) fn scroll_down(&mut self, amount: usize) {
        self.transcript_scroll = self.transcript_scroll.saturating_sub(amount);
    }

    pub(crate) fn scroll_top(&mut self) {
        self.transcript_scroll = usize::MAX;
    }

    pub(crate) fn scroll_bottom(&mut self) {
        self.transcript_scroll = 0;
    }

    pub(crate) fn finish_transcript_selection(&mut self, follow: bool) {
        if follow {
            self.scroll_bottom();
        } else if let Some(distance) = self.transcript_selection.take_resume_distance_from_bottom()
        {
            self.transcript_scroll = distance;
        }
        self.transcript_selection.clear();
        self.primary_clipboard_lease = None;
    }

    pub(crate) fn open_status_pager(&mut self, facts: StatusFacts<'_>) {
        self.dismiss_pager_overlay();
        self.pager_overlay = Some(
            PagerOverlay::status(self.locale, facts)
                .with_keymap(self.runtime_keymap.transcript().clone()),
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
