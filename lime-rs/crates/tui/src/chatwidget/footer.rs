//! Footer presentation snapshot owned by the chat surface.
//!
//! The terminal host still owns transport and turn lifecycle, but footer layout only consumes a
//! resolved snapshot. This keeps `bottom_pane::footer` pure with respect to business state and
//! mirrors Codex's `FooterProps` boundary without introducing another composer owner.

use super::ChatWidget;
use crate::bottom_pane::shortcut_overlay;
use crate::bottom_pane::{inset_footer_hint_area, FooterMode, FooterProps};
use crate::keymap::GlobalKeymapAction;
use crate::style::accent_style;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};

impl ChatWidget {
    pub(crate) fn footer_props(
        &self,
        width: u16,
        is_task_running: bool,
        thread_id: Option<&str>,
        primary_thread_id: Option<&str>,
    ) -> FooterProps {
        let mode = self.bottom_pane.footer_mode();
        let content_width = usize::from(inset_footer_hint_area(Rect::new(0, 0, width, 1)).width);
        FooterProps {
            locale: self.locale,
            mode,
            input_enabled: self.bottom_pane.composer_input_enabled(),
            interaction_hint_lines: self
                .bottom_pane
                .is_active()
                .then(|| {
                    self.bottom_pane
                        .footer_hint_lines(self.locale, content_width)
                })
                .flatten(),
            shortcut_close_hint: (mode == FooterMode::ShortcutOverlay).then(|| {
                shortcut_overlay::close_hint_text(
                    self.locale,
                    self.shortcut_toggle_available(),
                    content_width,
                )
            }),
            history_search_line: self.bottom_pane.history_search_footer_line(),
            history_search_cursor_column: self
                .bottom_pane
                .history_search_cursor_column(self.locale.history_search_label()),
            vim_search_line: self
                .bottom_pane
                .vim_search_query()
                .map(|(query, direction)| {
                    let prefix = match direction {
                        crate::vim_search::SearchDirection::Forward => "/",
                        crate::vim_search::SearchDirection::Backward => "?",
                    };
                    Line::from(Span::styled(format!("{prefix}{query}"), accent_style()))
                }),
            vim_mode_indicator: self.bottom_pane.vim_mode_indicator_span(),
            is_task_running,
            plan_mode: self.should_show_plan_mode_hint(),
            active_agent_label: self
                .agent_navigation
                .active_agent_label(thread_id, primary_thread_id),
            agents_hint: self.agents_hint(),
            shortcuts_available: self.shortcut_toggle_available(),
            status_line_value: None,
            status_line_enabled: false,
            context_window_percent: None,
            context_window_used_tokens: None,
        }
    }

    fn should_show_plan_mode_hint(&self) -> bool {
        matches!(
            self.collaboration_mode.as_ref().map(|mode| mode.mode),
            Some(agent_protocol::ModeKind::Plan)
        ) && !self.bottom_pane.is_active()
            && self.model_picker.is_none()
            && self.agent_picker.is_none()
            && self.agents_overview.is_none()
            && self.resume_picker.is_none()
            && self.export_picker.is_none()
            && self.status_line_setup.is_none()
            && self.terminal_title_setup.is_none()
            && self.pager_overlay.is_none()
            && !self.bottom_pane.history_search_active()
            && !self.bottom_pane.vim_search_active()
            && !self.bottom_pane.completion_popup_active()
            && !self.bottom_pane.file_search_popup_active()
            && !self.bottom_pane.skill_popup_active()
    }

    pub(crate) fn agents_hint(&self) -> Option<String> {
        self.runtime_keymap
            .transcript()
            .global_hint(GlobalKeymapAction::OpenAgents)
            .or_else(|| {
                self.bottom_pane
                    .agents_navigation_available()
                    .then(|| "←".to_string())
            })
    }

    pub(crate) fn shortcut_toggle_available(&self) -> bool {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

        [KeyModifiers::NONE, KeyModifiers::SHIFT]
            .into_iter()
            .all(|modifiers| {
                !self
                    .runtime_keymap
                    .transcript()
                    .reserves_global_key(KeyEvent::new(KeyCode::Char('?'), modifiers))
            })
    }
}
