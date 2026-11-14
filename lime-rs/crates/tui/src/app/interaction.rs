//! Key routing and composer-adjacent interaction for the TUI app.
//!
//! This is the Lime owner corresponding to 上游 `chatwidget/interaction.rs`. It orders terminal
//! surfaces from most specific to least specific while leaving input ownership in `BottomPane`
//! and canonical turn state in `ConversationProjection`.

use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};

use super::agent_picker::AgentPickerAction;
use super::agents_overview_view::AgentsOverviewAction;
use super::{App, AppAction, TranscriptSelectionTarget};
use crate::keymap::{GlobalKeymapAction, KeymapMatch};
use crate::pager_overlay::PagerAction;
use crate::transcript_view::{SearchAction, TranscriptSelectionAction};
use crate::tui::TuiEvent;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FullscreenSurface {
    Pager,
    ResumePicker,
    AgentsOverview,
}

fn normalize_paste(text: String) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

impl App {
    pub(crate) fn transcript_search_needs_frame(&self) -> bool {
        self.transcript_view.search.needs_frame()
            || self
                .transcript_view
                .search
                .history_request_pending(self.chat_widget.scrollback_has_older_history())
            || self
                .chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(crate::pager_overlay::PagerOverlay::search_needs_frame)
            || self
                .chat_widget
                .resume_picker
                .as_ref()
                .is_some_and(crate::resume_picker::PickerState::transcript_search_needs_frame)
    }

    /// Rendering, cursor and completion routing use the same input ownership priority.
    pub(crate) fn fullscreen_surface(&self) -> Option<FullscreenSurface> {
        if self.chat_widget.pager_overlay.is_some() {
            return Some(FullscreenSurface::Pager);
        }
        if self.chat_widget.export_picker.is_some()
            || self.chat_widget.copy_picker.is_some()
            || self.chat_widget.bottom_pane.is_active()
            || self.chat_widget.terminal_title_setup.is_some()
            || self.chat_widget.status_line_setup.is_some()
            || self.has_queued_startup_protected_request()
        {
            return None;
        }
        if self.chat_widget.resume_picker.is_some() {
            Some(FullscreenSurface::ResumePicker)
        } else if self.chat_widget.agents_overview.is_some() {
            Some(FullscreenSurface::AgentsOverview)
        } else {
            None
        }
    }

    pub(super) fn composer_owns_clipboard(&self) -> bool {
        self.main_clipboard_surface_is_current()
            && !self.chat_widget.bottom_pane.is_active()
            && !self.transcript_view.search.is_active()
            && !self.transcript_view.selection.is_active()
            && !self.has_queued_startup_protected_request()
    }

    pub(super) fn main_clipboard_surface_is_current(&self) -> bool {
        self.chat_widget.pager_overlay.is_none()
            && self.chat_widget.status_line_setup.is_none()
            && self.chat_widget.terminal_title_setup.is_none()
            && self.chat_widget.export_picker.is_none()
            && self.chat_widget.copy_picker.is_none()
            && self.chat_widget.resume_picker.is_none()
            && self.chat_widget.agents_overview.is_none()
            && self.chat_widget.model_picker.is_none()
            && self.chat_widget.agent_picker.is_none()
    }

    #[cfg(test)]
    pub(crate) fn handle_tui_event(&mut self, event: TuiEvent, connected: bool) -> AppAction {
        let was_disabled = self.chat_widget.bottom_pane.paste_burst_is_disabled();
        self.chat_widget.bottom_pane.set_paste_burst_disabled(true);
        let action = self.handle_tui_event_impl(event, connected, std::time::Instant::now());
        self.chat_widget
            .bottom_pane
            .set_paste_burst_disabled(was_disabled);
        action
    }

    pub(crate) fn handle_tui_event_runtime(
        &mut self,
        event: TuiEvent,
        connected: bool,
        input_at: std::time::Instant,
    ) -> AppAction {
        self.handle_tui_event_impl(event, connected, input_at)
    }

    fn handle_tui_event_impl(
        &mut self,
        event: TuiEvent,
        connected: bool,
        input_at: std::time::Instant,
    ) -> AppAction {
        if self.backtrack.primed
            && !self.backtrack.overlay_preview_active
            && matches!(
                &event,
                TuiEvent::Paste(_)
                    | TuiEvent::Key(crossterm::event::KeyEvent {
                        kind: KeyEventKind::Press,
                        ..
                    })
            )
            && !matches!(&event, TuiEvent::Key(key) if key.code == KeyCode::Esc && key.modifiers.is_empty())
        {
            self.reset_backtrack_state();
        }
        if !matches!(&event, TuiEvent::Key(_)) {
            self.chat_widget.reset_global_key_chord();
        }
        if matches!(&event, TuiEvent::FocusLost | TuiEvent::Resume) {
            self.end_interaction_drag();
        }
        let now = std::time::Instant::now();
        match &event {
            TuiEvent::FocusLost => self.recap.note_focus_lost(now),
            TuiEvent::FocusGained => self.recap.note_focus_gained(),
            _ => {}
        }
        if connected
            && self.chat_widget.tui_config.auto_recap
            && !self.recap.is_pending()
            && self.projection.active_turn_id().is_none()
            && self.recap.should_generate(now)
            && matches!(
                &event,
                TuiEvent::Key(_) | TuiEvent::Paste(_) | TuiEvent::Resize(_) | TuiEvent::FocusGained
            )
        {
            return AppAction::GenerateRecap(crate::app::recap::RecapTrigger::Automatic);
        }

        if connected {
            if let TuiEvent::Key(key) = &event {
                if key.kind == KeyEventKind::Press
                    && key.code == KeyCode::Char('!')
                    && key.modifiers.is_empty()
                    && !self.chat_widget.shell_mode
                    && self.chat_widget.bottom_pane.composer_is_empty()
                    && self.composer_owns_clipboard()
                {
                    self.chat_widget.shell_mode = true;
                    return AppAction::None;
                }
                if key.kind == KeyEventKind::Press
                    && key.code == KeyCode::Esc
                    && key.modifiers.is_empty()
                    && self.chat_widget.shell_mode
                {
                    self.chat_widget.shell_mode = false;
                    self.chat_widget
                        .bottom_pane
                        .set_composer_text(String::new());
                    return AppAction::None;
                }
            }
        }

        if !connected {
            self.reset_backtrack_state();
            self.history_replacement.reset();
            return match event {
                TuiEvent::Key(key)
                    if key.kind == KeyEventKind::Press
                        && key.modifiers.contains(KeyModifiers::CONTROL)
                        && matches!(key.code, KeyCode::Char(value) if value.eq_ignore_ascii_case(&'c')) =>
                {
                    AppAction::Quit
                }
                TuiEvent::Key(key) => {
                    self.chat_widget.bottom_pane.handle_restricted_key(key);
                    self.chat_widget.bottom_pane.clear_completion_popup();
                    AppAction::None
                }
                TuiEvent::Paste(text) => {
                    self.chat_widget
                        .bottom_pane
                        .handle_paste(&normalize_paste(text));
                    self.chat_widget.bottom_pane.clear_completion_popup();
                    AppAction::None
                }
                TuiEvent::Mouse(_) => {
                    self.chat_widget.bottom_pane.end_mouse_drag();
                    AppAction::None
                }
                _ => AppAction::None,
            };
        }

        if matches!(
            &event,
            TuiEvent::Key(key)
                if key.kind == KeyEventKind::Press
                    && self.chat_widget.status_line_setup.is_none()
                    && self.chat_widget.terminal_title_setup.is_none()
                    && self.chat_widget.copy_picker.is_none()
                    && self.chat_widget.pager_overlay.as_ref().is_none_or(|pager| !pager.is_copy_mode())
                    && key.modifiers == KeyModifiers::ALT
                    && matches!(key.code, KeyCode::Char(value) if value.eq_ignore_ascii_case(&'r'))
        ) {
            self.toggle_raw_output_mode();
            return AppAction::None;
        }

        if self.composer_owns_clipboard() {
            if let Some(text) = self.chat_widget.bottom_pane.copy_selection_request(&event) {
                return AppAction::CopyComposerSelection { text };
            }
            if let Some(source) = self.chat_widget.bottom_pane.clipboard_paste_request(&event) {
                if crate::clipboard_paste::right_click_paste_allowed(
                    self.chat_widget.right_click_paste,
                    source,
                ) {
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
            TuiEvent::Draw | TuiEvent::Resume => return AppAction::None,
        };

        if self.fullscreen_surface() == Some(FullscreenSurface::Pager) {
            if let Some(action) = self.handle_backtrack_overlay_event(&event) {
                return action;
            }
            return match self.chat_widget.handle_pager_event(&event) {
                Some(PagerAction::Close) => {
                    self.reset_backtrack_state();
                    AppAction::None
                }
                Some(PagerAction::LoadOlderHistory) => AppAction::LoadOlderHistory,
                Some(PagerAction::ScheduleFrame) => {
                    AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                }
                Some(PagerAction::CopyTranscriptSelection {
                    text,
                    format,
                    follow,
                }) => AppAction::CopyTranscriptSelection {
                    text,
                    format,
                    follow,
                    target: TranscriptSelectionTarget::MainPager,
                },
                Some(PagerAction::OpenLink(destination)) => AppAction::OpenLink(destination),
                Some(PagerAction::PublishPrimarySelection) => AppAction::PublishPrimarySelection {
                    target: TranscriptSelectionTarget::MainPager,
                },
                Some(PagerAction::ContinueTranscriptSelection) => {
                    AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                }
                Some(PagerAction::Consumed) | None => AppAction::None,
            };
        }

        if let Some(action) = self.chat_widget.handle_export_picker_event(&event) {
            return match action {
                crate::chatwidget::ExportPickerEvent::Consumed
                | crate::chatwidget::ExportPickerEvent::Cancel => AppAction::None,
                crate::chatwidget::ExportPickerEvent::Copy => {
                    AppAction::ExportTranscript { path: None }
                }
                crate::chatwidget::ExportPickerEvent::Save(path) => path
                    .map(|path| AppAction::ExportTranscript { path: Some(path) })
                    .unwrap_or(AppAction::None),
            };
        }

        if !self.chat_widget.bottom_pane.is_active() {
            if let Some(action) = self.chat_widget.handle_copy_picker_event(&event) {
                return match action {
                    crate::chatwidget::copy_picker::CopyPickerAction::Copy { text, label } => {
                        AppAction::CopySelection {
                            text,
                            label,
                            format: crate::clipboard_copy::CopyFormat::PlainText,
                        }
                    }
                    _ => AppAction::None,
                };
            }
            if let Some(action) = self.handle_terminal_title_setup_event(&event) {
                return action;
            }
            if let Some(action) = self.handle_status_line_setup_event(&event) {
                return action;
            }
        }

        if self.chat_widget.bottom_pane.is_active() {
            if let Event::Key(key) = &event {
                if self.chat_widget.open_approval_details_pager(*key) {
                    return AppAction::None;
                }
            }
            if let Some(action) = self.transcript_view.route_modal_wheel(&event) {
                return match action {
                    TranscriptSelectionAction::Scroll { rows } => AppAction::ScrollRows(rows),
                    _ => AppAction::None,
                };
            }
            let action = self
                .chat_widget
                .bottom_pane
                .handle_event_at(event, input_at)
                .map(|action| self.map_chat_widget_action(action))
                .unwrap_or(AppAction::None);
            if matches!(action, AppAction::Respond(_)) && !self.chat_widget.bottom_pane.is_active()
            {
                self.chat_widget.clear_startup_protected_request();
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

        if self.fullscreen_surface() == Some(FullscreenSurface::ResumePicker) {
            if let Some(action) = self.chat_widget.handle_resume_picker_event(&event) {
                return match action {
                    crate::chatwidget::ResumePickerEvent::Transcript(action) => match action {
                        Some(PagerAction::CopyTranscriptSelection {
                            text,
                            format,
                            follow,
                        }) => AppAction::CopyTranscriptSelection {
                            text,
                            format,
                            follow,
                            target: TranscriptSelectionTarget::ResumePicker,
                        },
                        Some(PagerAction::OpenLink(destination)) => {
                            AppAction::OpenLink(destination)
                        }
                        Some(PagerAction::PublishPrimarySelection) => {
                            AppAction::PublishPrimarySelection {
                                target: TranscriptSelectionTarget::ResumePicker,
                            }
                        }
                        Some(PagerAction::ContinueTranscriptSelection) => {
                            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                        }
                        Some(PagerAction::ScheduleFrame) => {
                            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                        }
                        _ => AppAction::None,
                    },
                    crate::chatwidget::ResumePickerEvent::Picker(action) => {
                        if action == crate::resume_picker::PickerAction::Cancel {
                            AppAction::None
                        } else {
                            AppAction::ResumePicker(action)
                        }
                    }
                };
            }
        }

        if self.fullscreen_surface() == Some(FullscreenSurface::AgentsOverview) {
            if let Some(event) = self.chat_widget.handle_agents_overview_event(&event) {
                return match event.action {
                    AgentsOverviewAction::Select => event
                        .selected_thread_id
                        .map(AppAction::SwitchThread)
                        .unwrap_or(AppAction::None),
                    AgentsOverviewAction::Cancel => AppAction::None,
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
        }

        if self.chat_widget.review_picker_open() {
            if let Some(action) = self.chat_widget.handle_review_picker_event(&event) {
                return match action {
                    crate::app::review_picker::ReviewPickerAction::Uncommitted => {
                        AppAction::ReviewUncommitted
                    }
                    crate::app::review_picker::ReviewPickerAction::Custom => {
                        self.chat_widget
                            .bottom_pane
                            .set_composer_text("/review ".to_string());
                        AppAction::None
                    }
                    crate::app::review_picker::ReviewPickerAction::Cancel
                    | crate::app::review_picker::ReviewPickerAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.worktree_picker_open() {
            if let Some(action) = self.chat_widget.handle_worktree_picker_event(&event) {
                return match action {
                    crate::app::worktree_picker::WorktreePickerAction::Enter {
                        path,
                        thread_id,
                    } => {
                        self.chat_widget.close_worktree_picker();
                        AppAction::EnterWorktree { path, thread_id }
                    }
                    crate::app::worktree_picker::WorktreePickerAction::Create {
                        root_path,
                        name,
                    } => {
                        self.chat_widget.close_worktree_picker();
                        AppAction::CreateWorktree { root_path, name }
                    }
                    crate::app::worktree_picker::WorktreePickerAction::DeleteRequest {
                        worktree_path,
                    } => {
                        self.chat_widget.close_worktree_picker();
                        self.chat_widget.open_confirm_prompt(
                            crate::app::confirm_prompt::ConfirmPrompt::delete_worktree(
                                worktree_path,
                            ),
                        );
                        AppAction::None
                    }
                    crate::app::worktree_picker::WorktreePickerAction::Refresh => {
                        self.chat_widget.close_worktree_picker();
                        AppAction::ListWorktrees
                    }
                    crate::app::worktree_picker::WorktreePickerAction::Cancel => {
                        self.chat_widget.close_worktree_picker();
                        AppAction::None
                    }
                    crate::app::worktree_picker::WorktreePickerAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.presets_menu_open() {
            if let Some(action) = self.chat_widget.handle_presets_menu_event(&event) {
                return match action {
                    crate::app::presets_menu::PresetsMenuAction::Recall { input } => {
                        self.chat_widget.close_presets_menu();
                        AppAction::InsertComposerText(input)
                    }
                    crate::app::presets_menu::PresetsMenuAction::Save { input } => {
                        let entries = self.chat_widget.presets_menu_entries();
                        match crate::app::presets_menu::PresetEntry::first_free_slot(&entries) {
                            Some(slot) => {
                                self.chat_widget.close_presets_menu();
                                AppAction::SavePreset { slot, input }
                            }
                            None => {
                                self.projection
                                    .set_status(self.chat_widget.locale.presets_all_slots_used());
                                AppAction::None
                            }
                        }
                    }
                    crate::app::presets_menu::PresetsMenuAction::Delete { slot } => {
                        self.chat_widget.close_presets_menu();
                        AppAction::DeletePreset { slot }
                    }
                    crate::app::presets_menu::PresetsMenuAction::EditLabel { slot, label } => {
                        self.chat_widget.close_presets_menu();
                        AppAction::SetPresetLabel { slot, label }
                    }
                    crate::app::presets_menu::PresetsMenuAction::Cancel => {
                        self.chat_widget.close_presets_menu();
                        AppAction::None
                    }
                    crate::app::presets_menu::PresetsMenuAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.process_list_open() {
            if let Some(action) = self.chat_widget.handle_process_list_event(&event) {
                return match action {
                    crate::app::process_list::ProcessListAction::Terminate {
                        process_id,
                        command,
                    } => {
                        if let Some(thread_id) = self.thread_id.clone() {
                            self.chat_widget.open_confirm_prompt(
                                crate::app::confirm_prompt::ConfirmPrompt::terminate_process(
                                    thread_id, process_id, command,
                                ),
                            );
                        }
                        AppAction::None
                    }
                    crate::app::process_list::ProcessListAction::Cancel
                    | crate::app::process_list::ProcessListAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.hooks_browser_open() {
            if let Some(action) = self.chat_widget.handle_hooks_browser_event(&event) {
                return match action {
                    crate::app::hooks_browser::HooksBrowserAction::Close => {
                        self.chat_widget.close_hooks_browser();
                        AppAction::None
                    }
                    crate::app::hooks_browser::HooksBrowserAction::SetEnabled { key, enabled } => {
                        AppAction::SetHookEnabled { key, enabled }
                    }
                    crate::app::hooks_browser::HooksBrowserAction::Trust { key, current_hash } => {
                        AppAction::TrustHooks {
                            hooks: vec![(key, current_hash)],
                        }
                    }
                    crate::app::hooks_browser::HooksBrowserAction::TrustAll { hooks } => {
                        AppAction::TrustHooks { hooks }
                    }
                    crate::app::hooks_browser::HooksBrowserAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.memories_settings_open() {
            if let Some(action) = self.chat_widget.handle_memories_settings_event(&event) {
                return match action {
                    crate::app::memories_settings::MemoriesSettingsAction::SetMode(enabled) => {
                        AppAction::SetMemoryMode(enabled)
                    }
                    crate::app::memories_settings::MemoriesSettingsAction::Cancel
                    | crate::app::memories_settings::MemoriesSettingsAction::None => {
                        AppAction::None
                    }
                };
            }
        }

        if self.chat_widget.skills_toggle_open() {
            if let Some(action) = self.chat_widget.handle_skills_toggle_event(&event) {
                return match action {
                    crate::app::skills_toggle::SkillsToggleAction::Toggle {
                        name,
                        path,
                        enabled,
                    } => AppAction::SetSkillEnabled {
                        path,
                        name,
                        enabled,
                    },
                    crate::app::skills_toggle::SkillsToggleAction::Cancel
                    | crate::app::skills_toggle::SkillsToggleAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.plugin_picker_open() {
            if let Some(action) = self.chat_widget.handle_plugin_picker_event(&event) {
                return match action {
                    crate::app::plugin_picker::PluginPickerAction::Uninstall {
                        plugin_id,
                        name,
                    } => {
                        self.chat_widget.open_confirm_prompt(
                            crate::app::confirm_prompt::ConfirmPrompt::uninstall_plugin(
                                plugin_id, name,
                            ),
                        );
                        AppAction::None
                    }
                    crate::app::plugin_picker::PluginPickerAction::Cancel
                    | crate::app::plugin_picker::PluginPickerAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.keymap_editor_open() {
            if let Some(action) = self.chat_widget.handle_keymap_editor_event(&event) {
                return match action {
                    crate::app::keymap_editor::KeymapEditorAction::Save { path, spec } => {
                        AppAction::WriteKeybinding { path, spec }
                    }
                    crate::app::keymap_editor::KeymapEditorAction::Unbind { path } => {
                        AppAction::UnbindKeybinding { path }
                    }
                    crate::app::keymap_editor::KeymapEditorAction::Reset { path } => {
                        AppAction::ResetKeybinding { path }
                    }
                    crate::app::keymap_editor::KeymapEditorAction::Cancel => AppAction::None,
                    crate::app::keymap_editor::KeymapEditorAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.config_menu_open() {
            if let Some(action) = self.chat_widget.handle_config_menu_event(&event) {
                return match action {
                    crate::app::config_menu::ConfigMenuAction::Select(item) => match item {
                        crate::app::config_menu::ConfigItem::Model => AppAction::OpenModelPicker,
                        crate::app::config_menu::ConfigItem::Effort => AppAction::OpenEffortPicker,
                        crate::app::config_menu::ConfigItem::Permissions => {
                            AppAction::OpenPermissionsPicker
                        }
                        crate::app::config_menu::ConfigItem::Experimental => {
                            AppAction::ListExperimentalFeatures
                        }
                        crate::app::config_menu::ConfigItem::TerminalTitle => {
                            AppAction::OpenTitleSetup
                        }
                        crate::app::config_menu::ConfigItem::StatusLine => {
                            AppAction::OpenStatusLineSetup
                        }
                        crate::app::config_menu::ConfigItem::Hooks => AppAction::ListHooks,
                        crate::app::config_menu::ConfigItem::Skills => {
                            self.open_skills_toggle_from_catalog();
                            AppAction::None
                        }
                        crate::app::config_menu::ConfigItem::Animations => {
                            AppAction::ToggleAnimations
                        }
                        crate::app::config_menu::ConfigItem::RightClickPaste => {
                            AppAction::CycleRightClickPaste
                        }
                        crate::app::config_menu::ConfigItem::StatusLineColors => {
                            AppAction::ToggleStatusLineColors
                        }
                        crate::app::config_menu::ConfigItem::AutoRecap => {
                            AppAction::ToggleAutoRecap
                        }
                        crate::app::config_menu::ConfigItem::Keymap => {
                            let entries = self.chat_widget.runtime_keymap.describe();
                            self.chat_widget.open_keymap_editor(entries);
                            AppAction::None
                        }
                    },
                    crate::app::config_menu::ConfigMenuAction::Cancel
                    | crate::app::config_menu::ConfigMenuAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.permissions_picker_open() {
            if let Some(action) = self.chat_widget.handle_permissions_picker_event(&event) {
                return match action {
                    crate::app::permissions_picker::PermissionsPickerAction::Select(profile) => {
                        AppAction::SelectPermissions(profile)
                    }
                    crate::app::permissions_picker::PermissionsPickerAction::Cancel
                    | crate::app::permissions_picker::PermissionsPickerAction::None => {
                        AppAction::None
                    }
                };
            }
        }

        if self.chat_widget.effort_picker_open() {
            if let Some(action) = self.chat_widget.handle_effort_picker_event(&event) {
                return match action {
                    crate::app::effort_picker::EffortPickerAction::Select(value) => {
                        AppAction::SelectEffort(value.to_string())
                    }
                    crate::app::effort_picker::EffortPickerAction::Cancel
                    | crate::app::effort_picker::EffortPickerAction::None => AppAction::None,
                };
            }
        }

        if self.chat_widget.confirm_prompt_open() {
            let kind = self.chat_widget.confirm_kind();
            if let Some(action) = self.chat_widget.handle_confirm_prompt_event(&event) {
                return match action {
                    crate::app::confirm_prompt::ConfirmPromptAction::Confirm => match kind {
                        Some(crate::app::confirm_prompt::ConfirmKind::ArchiveThread) => {
                            AppAction::ArchiveThread
                        }
                        Some(crate::app::confirm_prompt::ConfirmKind::DeleteThread) => {
                            AppAction::DeleteThread
                        }
                        Some(crate::app::confirm_prompt::ConfirmKind::ResetMemory) => {
                            AppAction::ResetMemory
                        }
                        Some(crate::app::confirm_prompt::ConfirmKind::UninstallPlugin {
                            plugin_id,
                            name,
                        }) => AppAction::UninstallPlugin { plugin_id, name },
                        Some(crate::app::confirm_prompt::ConfirmKind::TerminateProcess {
                            thread_id,
                            process_id,
                            command,
                        }) => AppAction::TerminateProcess {
                            thread_id,
                            process_id,
                            command,
                        },
                        Some(crate::app::confirm_prompt::ConfirmKind::DeleteWorktree {
                            worktree_path,
                        }) => AppAction::DeleteWorktree { worktree_path },
                        Some(crate::app::confirm_prompt::ConfirmKind::ApproveGuardianRetry {
                            event,
                            ..
                        }) => AppAction::ApproveGuardianRetry(event),
                        Some(crate::app::confirm_prompt::ConfirmKind::InstallPlugin {
                            plugin_name,
                            marketplace_path,
                            remote_marketplace_name,
                            remote_release,
                        }) => AppAction::InstallPlugin {
                            plugin_name,
                            marketplace_path,
                            remote_marketplace_name,
                            remote_release,
                        },
                        None => AppAction::None,
                    },
                    crate::app::confirm_prompt::ConfirmPromptAction::Cancel
                    | crate::app::confirm_prompt::ConfirmPromptAction::None => AppAction::None,
                };
            }
        }

        if let Some(action) = self.chat_widget.handle_model_picker_event(&event) {
            return match action {
                crate::chatwidget::ModelPickerEvent::Select(selection) => selection
                    .map(AppAction::SelectModel)
                    .unwrap_or(AppAction::None),
                crate::chatwidget::ModelPickerEvent::Cancel
                | crate::chatwidget::ModelPickerEvent::None => AppAction::None,
            };
        }

        if let Some(action) = self.chat_widget.handle_agent_picker_event(&event) {
            return match action {
                AgentPickerAction::Select(thread_id) => AppAction::SwitchThread(thread_id),
                AgentPickerAction::Cancel => AppAction::None,
                AgentPickerAction::None => AppAction::None,
            };
        }

        let main_selection_wants_event = self.transcript_view.selection.is_active()
            || matches!(event, Event::Mouse(_))
            || matches!(
                event,
                Event::Key(key)
                    if key.kind == KeyEventKind::Press
                        && key.modifiers == KeyModifiers::CONTROL
                        && key.code == KeyCode::Char(' ')
            );
        if main_selection_wants_event
            && !self.chat_widget.bottom_pane.popup_active()
            && !self.chat_widget.bottom_pane.history_search_active()
        {
            let had_selection = self.transcript_view.selection.is_active();
            if let Some(action) = self.transcript_view.handle_selection_event(&event) {
                let app_action = match action {
                    TranscriptSelectionAction::Consumed => AppAction::None,
                    TranscriptSelectionAction::PublishPrimary => {
                        AppAction::PublishPrimarySelection {
                            target: TranscriptSelectionTarget::MainTranscript,
                        }
                    }
                    TranscriptSelectionAction::Copy {
                        text,
                        format,
                        follow,
                    } => AppAction::CopyTranscriptSelection {
                        text,
                        format,
                        follow,
                        target: TranscriptSelectionTarget::MainTranscript,
                    },
                    TranscriptSelectionAction::OpenLink(destination) => {
                        AppAction::OpenLink(destination)
                    }
                    TranscriptSelectionAction::Scroll { rows } => {
                        if !self.transcript_view.scroll_selection(rows) {
                            return AppAction::ScrollRows(rows);
                        }
                        if rows < 0
                            && self.transcript_view.selection.is_at_top()
                            && self.chat_widget.scrollback_has_older_history()
                        {
                            return AppAction::LoadOlderHistory;
                        }
                        AppAction::None
                    }
                    TranscriptSelectionAction::RevealRow(row) => {
                        self.transcript_view.reveal_selection_row(row);
                        AppAction::None
                    }
                };
                return app_action;
            }
            if had_selection && matches!(event, Event::Key(_) | Event::Paste(_)) {
                self.transcript_view.finish_selection_if_active();
            }
        }

        if self.transcript_view.search.is_active() {
            return match self
                .transcript_view
                .handle_search_event(&event, self.chat_widget.scrollback_has_older_history())
            {
                Some(SearchAction::Consumed) => AppAction::None,
                Some(SearchAction::ScheduleFrame) => {
                    AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
                }
                Some(SearchAction::LoadOlderHistory) => AppAction::LoadOlderHistory,
                Some(SearchAction::Closed { .. }) | None => AppAction::None,
            };
        }

        if let Event::Mouse(mouse) = event {
            if let Some(_action) = self.transcript_view.handle_follow_mouse(mouse) {
                return AppAction::None;
            }
        }

        if let Some(action) = self
            .chat_widget
            .bottom_pane
            .handle_event_at(event.clone(), input_at)
        {
            return self.map_chat_widget_action(action);
        }

        if let Event::Key(key) = event {
            match self.chat_widget.dispatch_global_key(key) {
                KeymapMatch::Completed(GlobalKeymapAction::OpenAgents) => {
                    self.chat_widget.dismiss_shortcut_overlay();
                    self.open_agents_overview();
                    return AppAction::RefreshAgentsOverview;
                }
                KeymapMatch::Completed(GlobalKeymapAction::OpenTranscript) => {
                    self.chat_widget.dismiss_shortcut_overlay();
                    self.open_transcript_pager();
                    return AppAction::None;
                }
                KeymapMatch::Completed(GlobalKeymapAction::FindTranscript) => {
                    self.chat_widget.dismiss_shortcut_overlay();
                    self.transcript_view.begin_search();
                    return AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL);
                }
                KeymapMatch::Pending | KeymapMatch::Cancelled => return AppAction::None,
                KeymapMatch::PassThrough => {}
            }
        }

        match event {
            Event::Key(key) => self.handle_key_event_at(key, std::time::Instant::now(), input_at),
            Event::Paste(text) => {
                self.chat_widget.bottom_pane.handle_paste(&text);
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
