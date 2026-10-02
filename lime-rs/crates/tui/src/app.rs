mod agent_navigation;
pub(crate) mod agent_picker;
pub(crate) mod agents_overview;
pub(crate) mod agents_overview_threads;
pub(crate) mod agents_overview_view;
pub(crate) mod app_server_event_targets;
mod app_server_events;
pub(crate) mod app_server_requests;
pub(crate) mod event_dispatch;
pub(crate) mod history_pagination;
pub(crate) mod history_ui;
mod input_flow;
pub(crate) mod input_submission;
mod interaction;
mod interrupts;
pub(crate) mod mcp_login;
pub(crate) mod message_history;
mod pending_interactive_replay;
mod reasoning_shortcuts;
pub(crate) mod reconnect;
mod replay_filter;
mod right_click_paste;
mod session_lifecycle;
mod skills;
pub(crate) mod startup;
#[allow(dead_code)]
pub(crate) mod startup_prompts;
mod thread_event_buffer;
mod thread_events;
mod thread_input;
mod thread_settings;
mod tool_lifecycle;
pub(crate) mod transcript_export;
mod transcript_presentation;
mod turn_lifecycle;
pub(crate) mod working_directory;

use app_server_protocol::protocol::v2::{
    McpServerStatus, McpServerStatusDetail, QueuedSubmission, Thread,
};
use lime_core::config::RightClickPaste;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use self::agent_navigation::{AgentNavigationDirection, AgentNavigationState};
use crate::app::transcript_export::ExportPicker;
use crate::bottom_pane::{AppServerResponse, BottomPaneInputState};
use crate::chatwidget::ChatWidget;
use crate::clipboard_paste::ClipboardTextSource;
use crate::history_cell::HistoryRenderMode;
use crate::locale::Locale;
use crate::model_picker::ModelSelection;
use crate::pager_overlay::PagerOverlay;
use crate::projection::ConversationProjection;
use crate::resume_picker::{PickerAction, PickerState};
use crate::slash_command::SlashCommand;
use crate::status::StatusFacts;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TranscriptSelectionTarget {
    MainTranscript,
    MainPager,
    ResumePicker,
}

#[derive(Debug, PartialEq)]
pub(crate) enum AppAction {
    None,
    Submit {
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
    },
    Queue {
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
    },
    Interrupt,
    DecreaseEffort,
    IncreaseEffort,
    PreviousPermissions,
    NextPermissions,
    CopyLastResponse,
    CopyComposerSelection {
        text: String,
        clear_selection: bool,
    },
    CopyTranscriptSelection {
        text: String,
        follow: bool,
        target: TranscriptSelectionTarget,
    },
    OpenLink(String),
    ScheduleFrameIn(Duration),
    ExportTranscript {
        path: Option<PathBuf>,
    },
    PasteImage,
    PasteClipboardText(ClipboardTextSource),
    EditQueuedSubmission(QueuedSubmission),
    ScrollUp,
    ScrollDown,
    ScrollRows(isize),
    ScrollTop,
    ScrollBottom,
    LoadOlderHistory,
    SelectModel(ModelSelection),
    ChangeCollaborationMode(agent_protocol::CollaborationMode),
    SwitchThread(String),
    RefreshAgentsOverview,
    LoadMoreAgentsOverview,
    DispatchAgentsOverviewTask {
        prompt: String,
        cwd: Option<PathBuf>,
    },
    RenameAgentsOverviewThread {
        thread_id: String,
        name: String,
    },
    StopAgentsOverviewThread {
        thread_id: String,
    },
    OpenResumePicker,
    ResumePicker(PickerAction),
    FetchMcpInventory {
        detail: McpServerStatusDetail,
    },
    StartMcpLogin {
        name: String,
        thread_id: String,
    },
    Respond(AppServerResponse),
    Quit,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ExternalEditorState {
    #[default]
    Closed,
    Requested,
    Active,
}

#[derive(Debug, Default)]
pub(crate) struct App {
    pub(crate) chat_widget: ChatWidget,
    pub(crate) projection: ConversationProjection,
    pub(crate) skill_load_warnings: startup_prompts::SkillLoadWarningState,
    pub(crate) mcp_startup_warnings: startup_prompts::McpStartupWarningState,
    pending_mcp_login_start: Option<mcp_login::PendingMcpLoginStart>,
    active_mcp_login_ids: HashMap<String, mcp_login::ActiveMcpLogin>,
    mcp_login_generation: u64,
    pub(crate) thread_id: Option<String>,
    pub(crate) primary_thread_id: Option<String>,
    pub(crate) agent_navigation: AgentNavigationState,
    thread_event_channels: HashMap<String, self::thread_events::ThreadEventChannel>,
    pub(crate) scrollback_has_older_history: bool,
    pub(crate) runtime_keymap: crate::keymap::RuntimeKeymap,
    pub(crate) global_key_chord_matcher: crate::keymap::KeyChordMatcher,
    pub(crate) locale: Locale,
    pub(crate) cwd: PathBuf,
    pub(crate) clipboard_lease: Option<crate::clipboard_copy::ClipboardLease>,
    /// Independent X11 PRIMARY owner retained while a transcript selection remains active.
    /// CLIPBOARD and PRIMARY are separate X11 selections and must not share a lease.
    pub(crate) primary_clipboard_lease: Option<crate::clipboard_copy::ClipboardLease>,
    pub(crate) right_click_paste: RightClickPaste,
    pending_clipboard_paste: Option<right_click_paste::PendingPaste>,
    pub(crate) queued_submissions: Vec<QueuedSubmission>,
    thread_input_states: HashMap<String, BottomPaneInputState>,
    /// Keeps terminal input behind a startup request that may open a protected interaction.
    ///
    /// The App Server stream can deliver an approval or user-input request immediately after the
    /// initial thread handshake. Codex quarantines terminal input until that request is visible;
    /// Lime keeps the same boundary while leaving request ownership in `BottomPane`.
    pub(crate) startup_protected_input_boundary: bool,
    pub(crate) startup_pending_protected_request: bool,
    external_editor_state: ExternalEditorState,
    turn_lifecycle: turn_lifecycle::TurnLifecycleState,
}

impl App {
    pub(crate) fn set_runtime_keymap(&mut self, keymap: crate::keymap::RuntimeKeymap) {
        self.chat_widget.bottom_pane.set_keymap_bindings(&keymap);
        self.runtime_keymap = keymap;
        self.global_key_chord_matcher.reset();
    }

    pub(crate) fn set_right_click_paste(&mut self, mode: RightClickPaste) {
        self.right_click_paste = mode;
    }

    pub(crate) fn raw_output_mode(&self) -> bool {
        self.chat_widget.history_render_mode == HistoryRenderMode::Raw
    }

    fn toggle_raw_output_mode(&mut self) {
        self.finish_main_transcript_selection(false);
        self.chat_widget
            .transcript_viewport
            .suppress_next_activity();
        self.chat_widget.transcript_prompt_header.clear();
        self.chat_widget.history_render_mode = match self.chat_widget.history_render_mode {
            HistoryRenderMode::Rich => HistoryRenderMode::Raw,
            HistoryRenderMode::Raw => HistoryRenderMode::Rich,
        };
        self.projection
            .set_status(self.locale.raw_output_mode_message(self.raw_output_mode()));
    }

    pub(crate) fn set_cwd(&mut self, cwd: PathBuf) {
        self.cwd = cwd;
    }

    /// Enable the startup input boundary before the terminal event loop begins.
    pub(crate) fn begin_startup_input_boundary(&mut self) {
        self.startup_protected_input_boundary = true;
        self.startup_pending_protected_request = false;
    }

    /// Returns whether a startup request is waiting in the active pane or a thread buffer.
    ///
    /// Requests are never dropped to make room for ordinary notifications, so this check is
    /// deterministic and does not require a second runtime or a local persistence store.
    pub(crate) fn has_queued_startup_protected_request(&self) -> bool {
        let active_thread_has_buffered_request = self
            .thread_id
            .as_deref()
            .and_then(|thread_id| self.thread_event_channels.get(thread_id))
            .is_some_and(|channel| {
                channel.store.buffer.iter().any(|event| {
                    matches!(event, self::thread_events::ThreadBufferedEvent::Request(_))
                })
            });
        self.startup_protected_input_boundary
            && (self.startup_pending_protected_request || active_thread_has_buffered_request)
    }

    pub(crate) fn note_startup_protected_request(&mut self) {
        if self.startup_protected_input_boundary {
            self.startup_pending_protected_request = true;
        }
    }

    pub(crate) fn end_startup_input_boundary(&mut self) {
        self.startup_protected_input_boundary = false;
        self.startup_pending_protected_request = false;
    }

    /// Release the startup input boundary once the first ordinary input is safe to process.
    ///
    /// Codex keeps startup protection until queued app events and interactive requests have been
    /// drained. The first key or paste event after that point ends the startup-only phase; later
    /// requests are handled by the normal BottomPane lifecycle.
    pub(crate) fn release_startup_input_boundary_if_ready(&mut self, user_input: bool) -> bool {
        if !user_input
            || !self.startup_protected_input_boundary
            || self.chat_widget.bottom_pane.is_active()
            || self.has_queued_startup_protected_request()
        {
            return false;
        }
        self.end_startup_input_boundary();
        true
    }

    pub(crate) fn set_thread_id(&mut self, thread_id: String) {
        if self.thread_id.as_deref() != Some(thread_id.as_str()) {
            self.chat_widget
                .bottom_pane
                .set_history_thread_id(&thread_id);
            self.reset_transcript_presentation();
            self.primary_clipboard_lease = None;
            self.queued_submissions.clear();
            self.chat_widget.transcript_scroll = 0;
            self.chat_widget.transcript_viewport.clear();
            self.chat_widget.transcript_follow_control.clear();
            self.chat_widget.transcript_composer_gap.clear();
            self.chat_widget.transcript_prompt_header.clear();
            self.chat_widget.transcript_search.clear();
            self.chat_widget.transcript_selection.reset();
            self.turn_lifecycle.reset_thread();
            self.turn_lifecycle
                .restore_running(self.projection.active_turn_id(), Instant::now());
        }
        if self.primary_thread_id.is_none() {
            self.primary_thread_id = Some(thread_id.clone());
        }
        if self.agent_navigation.get(&thread_id).is_none() {
            self.agent_navigation
                .upsert(thread_id.clone(), None, None, false);
        }
        self.ensure_thread_channel(&thread_id);
        self.thread_id = Some(thread_id);
    }

    pub(crate) fn set_locale(&mut self, locale: Locale) {
        self.locale = locale;
        self.chat_widget.bottom_pane.set_locale(locale);
    }

    /// Return the user-visible status while keeping active-turn and explicit command status ahead
    /// of app-scoped MCP startup diagnostics.
    pub(crate) fn status_value(&self) -> String {
        let status = self.projection.status();
        if matches!(status, "" | "ready") {
            return self
                .mcp_startup_warnings
                .status()
                .unwrap_or_else(|| status.to_string());
        }
        status.to_string()
    }

    pub(crate) fn hydrate_thread(&mut self, thread: Thread) {
        self.primary_clipboard_lease = None;
        self.chat_widget.transcript_scroll = 0;
        self.chat_widget.transcript_viewport.clear();
        self.chat_widget.transcript_follow_control.clear();
        self.chat_widget.transcript_composer_gap.clear();
        self.chat_widget.transcript_prompt_header.clear();
        self.chat_widget.transcript_search.clear();
        self.chat_widget.transcript_selection.reset();
        self.turn_lifecycle.reset_thread();
        self.agent_navigation.upsert(
            thread.id.clone(),
            thread.agent_nickname.clone(),
            thread.agent_role.clone(),
            false,
        );
        if let Some(parent_thread_id) = thread.parent_thread_id.clone() {
            self.agent_navigation.mark_parent_owned(thread.id.clone());
            if self.primary_thread_id.is_none() {
                self.primary_thread_id = Some(parent_thread_id);
            }
        }
        self.projection.hydrate_thread(thread);
        self.scrollback_has_older_history = false;
        self.turn_lifecycle
            .restore_running(self.projection.active_turn_id(), Instant::now());
    }

    fn adjacent_agent(&self, direction: AgentNavigationDirection) -> Option<String> {
        self.agent_navigation
            .adjacent_thread_id(self.thread_id.as_deref(), direction)
            .filter(|thread_id| self.thread_id.as_deref() != Some(thread_id.as_str()))
    }

    pub(crate) fn can_accept_direct_input(&mut self) -> bool {
        if self
            .thread_id
            .as_deref()
            .is_some_and(|thread_id| self.agent_navigation.is_parent_owned(thread_id))
        {
            self.projection
                .set_status("sub-agent thread is parent-owned");
            return false;
        }
        true
    }

    pub(crate) fn apply_external_edit(&mut self, text: String) {
        self.chat_widget.bottom_pane.apply_external_edit(text);
    }

    pub(crate) fn external_editor_state(&self) -> ExternalEditorState {
        self.external_editor_state
    }

    pub(crate) fn request_external_editor_launch(&mut self) {
        if self.external_editor_state == ExternalEditorState::Closed {
            self.external_editor_state = ExternalEditorState::Requested;
        }
    }

    pub(crate) fn set_external_editor_state(&mut self, state: ExternalEditorState) {
        self.external_editor_state = state;
    }

    pub(crate) fn reset_external_editor_state(&mut self) {
        self.external_editor_state = ExternalEditorState::Closed;
    }

    pub(crate) fn pre_draw_tick(&mut self, now: Instant) -> AppAction {
        let action = self
            .chat_widget
            .bottom_pane
            .pre_draw_tick(now)
            .map(AppAction::Respond)
            .unwrap_or(AppAction::None);
        if matches!(action, AppAction::Respond(_)) && !self.chat_widget.bottom_pane.is_active() {
            self.startup_pending_protected_request = false;
        }
        if !matches!(action, AppAction::None) {
            return action;
        }
        let selection_scrolled = if let Some(picker) = self.chat_widget.resume_picker.as_ref() {
            picker.tick_transcript_selection()
        } else if self.chat_widget.pager_overlay.is_some() {
            self.chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(PagerOverlay::tick_transcript_selection)
        } else {
            self.chat_widget.transcript_selection.tick_edge_scroll()
        };
        if selection_scrolled {
            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
        } else if self
            .chat_widget
            .transcript_search
            .take_history_request(self.scrollback_has_older_history)
            || self
                .chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(PagerOverlay::take_search_history_request)
        {
            AppAction::LoadOlderHistory
        } else if self.chat_widget.transcript_search.needs_frame()
            || self
                .chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(PagerOverlay::search_needs_frame)
            || self
                .chat_widget
                .resume_picker
                .as_ref()
                .is_some_and(PickerState::transcript_search_needs_frame)
        {
            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
        } else if let Some(delay) = self.chat_widget.transcript_composer_gap.tick(now) {
            AppAction::ScheduleFrameIn(delay)
        } else {
            AppAction::None
        }
    }

    pub(crate) fn scroll_up(&mut self, amount: usize) {
        self.chat_widget.transcript_scroll =
            self.chat_widget.transcript_scroll.saturating_add(amount);
    }

    pub(crate) fn scroll_down(&mut self, amount: usize) {
        self.chat_widget.transcript_scroll =
            self.chat_widget.transcript_scroll.saturating_sub(amount);
    }

    pub(crate) fn scroll_top(&mut self) {
        self.chat_widget.transcript_scroll = usize::MAX;
    }

    pub(crate) fn scroll_bottom(&mut self) {
        self.chat_widget.transcript_scroll = 0;
    }

    pub(crate) fn finish_main_transcript_selection(&mut self, follow: bool) {
        if follow {
            self.scroll_bottom();
        } else if let Some(distance) = self
            .chat_widget
            .transcript_selection
            .take_resume_distance_from_bottom()
        {
            self.chat_widget.transcript_scroll = distance;
        }
        self.chat_widget.transcript_selection.clear();
        self.primary_clipboard_lease = None;
    }

    fn run_local_command(&mut self) -> Option<AppAction> {
        let text = self.chat_widget.bottom_pane.composer_text().trim();
        let command = self.chat_widget.bottom_pane.command_from_prompt(text)?;
        let action = match command {
            SlashCommand::Raw => {
                self.toggle_raw_output_mode();
                AppAction::None
            }
            SlashCommand::Vim => {
                let enabled = self.chat_widget.bottom_pane.toggle_vim_enabled();
                self.projection
                    .set_status(self.locale.vim_mode_message(enabled));
                AppAction::None
            }
            SlashCommand::Status => {
                self.open_status_pager();
                AppAction::None
            }
            SlashCommand::Copy => AppAction::CopyLastResponse,
            SlashCommand::Export => {
                let path = text
                    .strip_prefix("/export")
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                    .map(PathBuf::from);
                if path.is_none() {
                    self.chat_widget.export_picker =
                        Some(ExportPicker::new(self.thread_id.as_deref()));
                    AppAction::None
                } else {
                    AppAction::ExportTranscript { path }
                }
            }
            SlashCommand::Agents => {
                self.open_agents_overview();
                AppAction::RefreshAgentsOverview
            }
            SlashCommand::MultiAgents => {
                self.open_agent_picker();
                AppAction::None
            }
            SlashCommand::Resume => AppAction::OpenResumePicker,
            SlashCommand::Mcp => {
                let argument = text
                    .strip_prefix("/mcp")
                    .map(str::trim)
                    .unwrap_or_default()
                    .to_string();
                self.mcp_command(&argument)
            }
            SlashCommand::Pwd => {
                if text.split_whitespace().count() != 1 {
                    self.projection.set_status(self.locale.pwd_usage());
                } else {
                    let cwd = self.cwd.to_string_lossy();
                    self.projection
                        .set_status(self.locale.current_working_directory_message(&cwd));
                }
                AppAction::None
            }
            _ => return None,
        };
        self.chat_widget
            .bottom_pane
            .set_composer_text(String::new());
        self.chat_widget.bottom_pane.clear_completion_popup();
        Some(action)
    }

    fn open_status_pager(&mut self) {
        self.dismiss_pager_overlay();
        let cwd = self.cwd.to_string_lossy();
        self.chat_widget.pager_overlay = Some(
            PagerOverlay::status(
                self.locale,
                StatusFacts {
                    thread_id: self.thread_id.as_deref(),
                    model: self.chat_widget.model.as_deref(),
                    provider: self.chat_widget.model_provider.as_deref(),
                    effort: self.chat_widget.reasoning_effort.as_deref(),
                    permissions: self.chat_widget.permissions.as_deref(),
                    cwd: &cwd,
                    status: &self.status_value(),
                },
            )
            .with_keymap(self.runtime_keymap.transcript().clone()),
        );
    }

    pub(crate) fn open_mcp_inventory(
        &mut self,
        statuses: Vec<McpServerStatus>,
        detail: McpServerStatusDetail,
    ) {
        let lines = crate::history_cell::mcp_inventory_lines(&statuses, detail, self.locale);
        self.dismiss_pager_overlay();
        self.chat_widget.pager_overlay = Some(
            PagerOverlay::new(self.locale.mcp_inventory_title().to_string(), lines)
                .with_keymap(self.runtime_keymap.transcript().clone()),
        );
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "app/transcript_presentation_tests.rs"]
mod transcript_presentation_tests;
