//! Key routing and composer-adjacent interaction for the TUI app.
//!
//! This is the Lime owner corresponding to Codex `chatwidget/interaction.rs`. It orders terminal
//! surfaces from most specific to least specific while leaving editing state in `ChatComposer`
//! and canonical turn state in `ConversationProjection`.

use std::time::Instant;

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};

use super::agent_picker::AgentPickerAction;
use super::agents_overview_view::AgentsOverviewAction;
use super::transcript_export::ExportPickerAction;
use super::{App, AppAction, TranscriptSelectionTarget};
use crate::bottom_pane::command_popup::CommandPopupAction;
use crate::keymap::{GlobalKeymapAction, KeymapMatch};
use crate::model_picker::ModelPickerAction;
use crate::pager_overlay::PagerAction;
use crate::resume_picker::PickerAction;
use crate::transcript_view::{SearchAction, TranscriptFollowAction, TranscriptSelectionAction};
use crate::tui::TuiEvent;

fn normalize_paste(text: String) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

impl App {
    /// Keep transcript scrolling available while a protected interaction owns keyboard input.
    ///
    /// Codex lets the approval/user-input surface retain keyboard ownership while allowing the
    /// mouse wheel to operate on the visible transcript.  The transcript selection layout is the
    /// canonical hit-test boundary, so events over the modal/footer continue to fall through to
    /// `BottomPane` rather than leaking into the main transcript.
    fn route_modal_transcript_wheel(&mut self, event: &Event) -> Option<AppAction> {
        let Event::Mouse(mouse) = event else {
            return None;
        };
        if !matches!(
            mouse.kind,
            crossterm::event::MouseEventKind::ScrollUp
                | crossterm::event::MouseEventKind::ScrollDown
        ) {
            return None;
        }

        match self.transcript_selection.handle_event(event) {
            Some(TranscriptSelectionAction::Scroll { rows }) => {
                if self.transcript_selection.is_active() {
                    self.transcript_selection.scroll_rows(rows);
                    Some(AppAction::None)
                } else {
                    Some(AppAction::ScrollRows(rows))
                }
            }
            Some(_) => Some(AppAction::None),
            None => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn handle_tui_event(&mut self, event: TuiEvent, connected: bool) -> AppAction {
        let was_disabled = self.composer.paste_burst_is_disabled();
        self.composer.set_paste_burst_disabled(true);
        let action = self.handle_tui_event_impl(event, connected);
        self.composer.set_paste_burst_disabled(was_disabled);
        action
    }

    pub(crate) fn handle_tui_event_runtime(
        &mut self,
        event: TuiEvent,
        connected: bool,
    ) -> AppAction {
        self.handle_tui_event_impl(event, connected)
    }

    fn handle_tui_event_impl(&mut self, event: TuiEvent, connected: bool) -> AppAction {
        if !matches!(&event, TuiEvent::Key(_)) {
            self.global_key_chord_matcher.reset();
        }
        if matches!(&event, TuiEvent::FocusLost | TuiEvent::Resume) {
            self.transcript_selection.end_drag();
            if let Some(pager) = self.pager_overlay.as_ref() {
                pager.end_transcript_drag();
            }
            if let Some(picker) = self.resume_picker.as_ref() {
                picker.end_transcript_drag();
            }
        }

        if !connected {
            return match event {
                TuiEvent::Key(key)
                    if key.kind == KeyEventKind::Press
                        && key.modifiers.contains(KeyModifiers::CONTROL)
                        && matches!(key.code, KeyCode::Char(value) if value.eq_ignore_ascii_case(&'c')) =>
                {
                    AppAction::Quit
                }
                TuiEvent::Key(key) => {
                    self.composer.handle_disconnected_key(key);
                    self.clear_completion_popup();
                    AppAction::None
                }
                TuiEvent::Paste(text) => {
                    self.composer.handle_paste(&normalize_paste(text));
                    self.clear_completion_popup();
                    AppAction::None
                }
                TuiEvent::Mouse(_) => {
                    self.composer.end_mouse_drag();
                    AppAction::None
                }
                _ => AppAction::None,
            };
        }

        if matches!(
            &event,
            TuiEvent::Key(key)
                if key.kind == KeyEventKind::Press
                    && key.modifiers == KeyModifiers::ALT
                    && matches!(key.code, KeyCode::Char(value) if value.eq_ignore_ascii_case(&'r'))
        ) {
            self.toggle_raw_output_mode();
            return AppAction::None;
        }

        let composer_owns_copy = self.pager_overlay.is_none()
            && self.export_picker.is_none()
            && !self.bottom_pane.is_active()
            && self.resume_picker.is_none()
            && self.agents_overview.is_none()
            && self.model_picker.is_none()
            && self.agent_picker.is_none()
            && !self.transcript_search.is_active()
            && !self.transcript_selection.is_active()
            && !self.has_queued_startup_protected_request();
        if composer_owns_copy {
            if let Some((text, clear_selection)) = self.composer.copy_selection_request(&event) {
                return AppAction::CopyComposerSelection {
                    text,
                    clear_selection,
                };
            }
            if let Some(source) = self.composer.clipboard_paste_request(&event) {
                if crate::clipboard_paste::right_click_paste_allowed(self.right_click_paste, source)
                {
                    return AppAction::PasteClipboardText(source);
                }
            }
        }

        let event = match event {
            TuiEvent::Key(key) => Event::Key(key),
            TuiEvent::Paste(text) => Event::Paste(normalize_paste(text)),
            TuiEvent::Mouse(mouse) => Event::Mouse(mouse),
            TuiEvent::Resize(size) => Event::Resize(size.width, size.height),
            TuiEvent::FocusGained => Event::FocusGained,
            TuiEvent::FocusLost => Event::FocusLost,
            TuiEvent::Draw => return self.pre_draw_tick(Instant::now()),
            TuiEvent::Resume => return AppAction::None,
        };

        if let Some(pager) = self.pager_overlay.as_mut() {
            return match pager.handle_event(&event) {
                PagerAction::Close => {
                    self.dismiss_pager_overlay();
                    AppAction::None
                }
                PagerAction::LoadOlderHistory => AppAction::LoadOlderHistory,
                PagerAction::ScheduleFrame => {
                    AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                }
                PagerAction::CopyTranscriptSelection { text, follow } => {
                    AppAction::CopyTranscriptSelection {
                        text,
                        follow,
                        target: TranscriptSelectionTarget::MainPager,
                    }
                }
                PagerAction::OpenLink(destination) => AppAction::OpenLink(destination),
                PagerAction::ContinueTranscriptSelection => {
                    AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                }
                PagerAction::Consumed => AppAction::None,
            };
        }

        if let Some(picker) = self.export_picker.as_mut() {
            let action = picker.handle_event(&event);
            return match action {
                ExportPickerAction::None => AppAction::None,
                ExportPickerAction::Cancel => {
                    self.export_picker = None;
                    AppAction::None
                }
                ExportPickerAction::Copy => {
                    self.export_picker = None;
                    AppAction::ExportTranscript { path: None }
                }
                ExportPickerAction::Save => {
                    let path = picker.selected_path();
                    self.export_picker = None;
                    path.map(|path| AppAction::ExportTranscript { path: Some(path) })
                        .unwrap_or(AppAction::None)
                }
            };
        }

        if self.bottom_pane.is_active() {
            if let Event::Key(key) = &event {
                if let Some((title, lines)) =
                    self.bottom_pane.approval_details_for_key(*key, self.locale)
                {
                    self.dismiss_pager_overlay();
                    self.pager_overlay = Some(
                        crate::pager_overlay::PagerOverlay::new(title, lines)
                            .with_keymap(self.runtime_keymap.transcript().clone()),
                    );
                    return AppAction::None;
                }
            }
            if let Some(action) = self.route_modal_transcript_wheel(&event) {
                return action;
            }
            let action = self
                .bottom_pane
                .handle_event(event)
                .map(AppAction::Respond)
                .unwrap_or(AppAction::None);
            if matches!(action, AppAction::Respond(_)) && !self.bottom_pane.is_active() {
                self.startup_pending_protected_request = false;
            }
            return action;
        }

        // A delayed startup approval/user-input request owns the terminal until it is shown.
        // This guard intentionally sits after `BottomPane`: once visible, the pane must receive
        // the key that resolves the request instead of being blocked by its own boundary.
        if self.has_queued_startup_protected_request() {
            return AppAction::None;
        }

        self.release_startup_input_boundary_if_ready(matches!(
            &event,
            Event::Key(_) | Event::Paste(_)
        ));

        if let Some(picker) = self.resume_picker.as_mut() {
            if picker.transcript_pager_is_open() {
                return match picker.handle_transcript_pager_event(&event) {
                    Some(PagerAction::CopyTranscriptSelection { text, follow }) => {
                        AppAction::CopyTranscriptSelection {
                            text,
                            follow,
                            target: TranscriptSelectionTarget::ResumePicker,
                        }
                    }
                    Some(PagerAction::OpenLink(destination)) => AppAction::OpenLink(destination),
                    Some(PagerAction::ContinueTranscriptSelection) => {
                        AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                    }
                    Some(PagerAction::ScheduleFrame) => {
                        AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                    }
                    _ => AppAction::None,
                };
            }
            let action = picker.handle_event(event);
            if action == PickerAction::Cancel {
                self.resume_picker = None;
                return AppAction::None;
            }
            return AppAction::ResumePicker(action);
        }

        if let Some(overview) = self.agents_overview.as_mut() {
            let action = overview.view.handle_event(event);
            return match action {
                AgentsOverviewAction::Select => {
                    let thread_id = overview.view.selected_thread_id().map(str::to_owned);
                    self.agents_overview = None;
                    self.agent_picker = None;
                    thread_id
                        .map(AppAction::SwitchThread)
                        .unwrap_or(AppAction::None)
                }
                AgentsOverviewAction::Cancel => {
                    self.agents_overview = None;
                    self.agent_picker = None;
                    AppAction::None
                }
                AgentsOverviewAction::LoadMore => AppAction::LoadMoreAgentsOverview,
                AgentsOverviewAction::Dispatch { prompt, cwd } => {
                    AppAction::DispatchAgentsOverviewTask { prompt, cwd }
                }
                AgentsOverviewAction::Rename { thread_id, name } => {
                    AppAction::RenameAgentsOverviewThread { thread_id, name }
                }
                AgentsOverviewAction::Stop { thread_id } => {
                    AppAction::StopAgentsOverviewThread { thread_id }
                }
                AgentsOverviewAction::OpenResumePicker => AppAction::OpenResumePicker,
                AgentsOverviewAction::None => AppAction::None,
            };
        }

        if let Some(picker) = self.model_picker.as_mut() {
            return match picker.handle_event(event) {
                ModelPickerAction::Select(index) => {
                    let selection = picker.selected_model(index);
                    self.model_picker = None;
                    selection
                        .map(AppAction::SelectModel)
                        .unwrap_or(AppAction::None)
                }
                ModelPickerAction::Cancel => {
                    self.model_picker = None;
                    AppAction::None
                }
                ModelPickerAction::None => AppAction::None,
            };
        }

        if let Some(picker) = self.agent_picker.as_mut() {
            return match picker.handle_event(event) {
                AgentPickerAction::Select(thread_id) => {
                    self.agent_picker = None;
                    AppAction::SwitchThread(thread_id)
                }
                AgentPickerAction::Cancel => {
                    self.agent_picker = None;
                    AppAction::None
                }
                AgentPickerAction::None => AppAction::None,
            };
        }

        let main_selection_wants_event = self.transcript_selection.is_active()
            || matches!(event, Event::Mouse(_))
            || matches!(
                event,
                Event::Key(key)
                    if key.kind == KeyEventKind::Press
                        && key.modifiers == KeyModifiers::CONTROL
                        && key.code == KeyCode::Char(' ')
            );
        if main_selection_wants_event
            && !self.composer.file_search_popup_active()
            && !self.composer.skill_popup_active()
            && !self.composer.completion_popup_active()
            && !self.composer.history_search_active()
        {
            let had_selection = self.transcript_selection.is_active();
            if let Some(action) = self.transcript_selection.handle_event(&event) {
                let app_action = match action {
                    TranscriptSelectionAction::Consumed => AppAction::None,
                    TranscriptSelectionAction::Copy { text, follow } => {
                        AppAction::CopyTranscriptSelection {
                            text,
                            follow,
                            target: TranscriptSelectionTarget::MainTranscript,
                        }
                    }
                    TranscriptSelectionAction::OpenLink(destination) => {
                        AppAction::OpenLink(destination)
                    }
                    TranscriptSelectionAction::Scroll { rows } => {
                        if self.transcript_selection.is_active() {
                            self.transcript_selection.scroll_rows(rows);
                        } else {
                            return AppAction::ScrollRows(rows);
                        }
                        AppAction::None
                    }
                    TranscriptSelectionAction::RevealRow(row) => {
                        self.transcript_selection.reveal_row(row);
                        AppAction::None
                    }
                };
                if had_selection && !self.transcript_selection.is_active() {
                    self.finish_main_transcript_selection(false);
                }
                return app_action;
            }
            if had_selection && matches!(event, Event::Key(_) | Event::Paste(_)) {
                self.finish_main_transcript_selection(false);
            }
        }

        if self.transcript_search.is_active() {
            return match self
                .transcript_search
                .handle_event(&event, self.scrollback_has_older_history)
            {
                SearchAction::Consumed => AppAction::None,
                SearchAction::ScheduleFrame => {
                    AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                }
                SearchAction::LoadOlderHistory => AppAction::LoadOlderHistory,
                SearchAction::Closed { restore_scroll } => {
                    if let Some(scroll) = restore_scroll {
                        self.transcript_scroll = scroll;
                    }
                    AppAction::None
                }
            };
        }

        if matches!(event, Event::Key(_) | Event::FocusLost) {
            self.composer.end_mouse_drag();
        }

        if let Event::Mouse(mouse) = event {
            if let Some(action) = self.transcript_follow_control.handle_mouse(mouse) {
                if action == TranscriptFollowAction::ReturnToLatest {
                    self.scroll_bottom();
                }
                return AppAction::None;
            }
            self.composer.handle_mouse(mouse);
            return AppAction::None;
        }

        // Vim query input is owned by the composer and must precede popups, global shortcuts,
        // and submission handling. Query paste edits the ephemeral query editor, never the draft.
        let vim_query_owns_event = self.composer.vim_search_active()
            || matches!(&event, Event::Key(key) if self.composer.vim_search_wants_key(*key));
        if vim_query_owns_event {
            match event {
                Event::Key(key) => {
                    let action = self.composer.handle_key_event_at(key, Instant::now());
                    return self.map_composer_action(action);
                }
                Event::Paste(text) => {
                    self.composer.handle_paste(&text);
                    return AppAction::None;
                }
                _ => {}
            }
        }

        if self.composer.completion_popup_active() {
            if let Event::Key(key) = &event {
                if self.composer.prepare_popup_key_event(*key, Instant::now()) {
                    return self.map_composer_action(crate::bottom_pane::InputResult::Changed);
                }
            }
        }

        if self.composer.file_search_popup_active() {
            let action = self.composer.handle_file_search_popup_event(&event);
            match action {
                crate::bottom_pane::FileSearchPopupAction::Pass => {}
                crate::bottom_pane::FileSearchPopupAction::Consumed => {
                    if !matches!(event, Event::Key(key) if key.code == KeyCode::Enter) {
                        return AppAction::None;
                    }
                }
                crate::bottom_pane::FileSearchPopupAction::Cancel
                | crate::bottom_pane::FileSearchPopupAction::Complete => {
                    return AppAction::None;
                }
            }
        }

        if self.composer.skill_popup_active() {
            let action = self.composer.handle_skill_popup_event(&event);
            match action {
                crate::bottom_pane::SkillPopupAction::Pass => {}
                crate::bottom_pane::SkillPopupAction::Consumed => return AppAction::None,
                crate::bottom_pane::SkillPopupAction::Cancel
                | crate::bottom_pane::SkillPopupAction::Complete => return AppAction::None,
            }
        }

        if self.composer.completion_popup_active() {
            let action = self.composer.handle_command_popup_event(&event);
            match action {
                CommandPopupAction::Pass => {}
                CommandPopupAction::Consumed => return AppAction::None,
                CommandPopupAction::Cancel => return AppAction::None,
                CommandPopupAction::Complete(command) => {
                    self.complete_slash_command(command);
                    return AppAction::None;
                }
                CommandPopupAction::Execute(command) => {
                    self.composer.replace(format!("/{}", command.command()));
                    self.clear_completion_popup();
                    if let Some(action) = self.run_local_command() {
                        return action;
                    }
                    let action = self
                        .composer
                        .handle_key_event(crossterm::event::KeyEvent::new(
                            KeyCode::Enter,
                            KeyModifiers::NONE,
                        ));
                    return self.map_composer_action(action);
                }
            }
        }

        if self.composer.history_search_active() {
            match event {
                Event::Key(key) => {
                    let action = self.composer.handle_key_event_at(key, Instant::now());
                    return self.map_composer_action(action);
                }
                Event::Paste(text) => self.composer.handle_paste(&text),
                _ => {}
            }
            return AppAction::None;
        }

        if let Event::Key(key) = event {
            if self.composer.should_handle_vim_insert_escape(key)
                || self.composer.key_chord_pending()
                || self.composer.vim_key_event_is_owned(key)
            {
                let action = self.composer.handle_key_event_at(key, Instant::now());
                return self.map_composer_action(action);
            }
        }

        if let Event::Key(key) = event {
            match self
                .runtime_keymap
                .transcript()
                .dispatch_global(&mut self.global_key_chord_matcher, key)
            {
                KeymapMatch::Completed(GlobalKeymapAction::OpenAgents) => {
                    self.composer.dismiss_shortcut_overlay();
                    self.open_agents_overview();
                    return AppAction::RefreshAgentsOverview;
                }
                KeymapMatch::Completed(GlobalKeymapAction::OpenTranscript) => {
                    self.composer.dismiss_shortcut_overlay();
                    self.open_transcript_pager();
                    return AppAction::None;
                }
                KeymapMatch::Completed(GlobalKeymapAction::FindTranscript) => {
                    self.composer.dismiss_shortcut_overlay();
                    self.transcript_search
                        .begin(self.transcript_scroll, /*restore_on_close*/ true);
                    self.transcript_follow_control.clear();
                    return AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL);
                }
                KeymapMatch::Pending | KeymapMatch::Cancelled => return AppAction::None,
                KeymapMatch::PassThrough => {}
            }
        }

        match event {
            Event::Key(key) => self.handle_key_event(key),
            Event::Paste(text) => {
                self.composer.handle_paste(&text);
                self.sync_completion_popup();
                AppAction::None
            }
            _ => AppAction::None,
        }
    }
}

#[cfg(test)]
#[path = "history_search_tests.rs"]
mod history_search_tests;

#[cfg(test)]
mod tests {
    use super::normalize_paste;

    #[test]
    fn paste_newlines_are_normalized_at_the_interaction_boundary() {
        assert_eq!(normalize_paste("a\r\nb\rc".to_string()), "a\nb\nc");
    }
}
