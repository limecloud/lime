pub(crate) mod agent_navigation;
pub(crate) mod agent_picker;
pub(crate) mod agents_overview;
pub(crate) mod agents_overview_loading;
pub(crate) mod agents_overview_threads;
pub(crate) mod agents_overview_view;
pub(crate) mod app_server_event_targets;
mod app_server_events;
pub(crate) mod app_server_requests;
pub(crate) mod auto_review;
mod clipboard;
pub(crate) mod config_menu;
pub(crate) mod confirm_prompt;
pub(crate) mod effort_picker;
pub(crate) mod event_dispatch;
pub(crate) mod git_diff;
pub(crate) mod history_pagination;
pub(crate) mod history_replacement;
pub(crate) mod history_ui;
pub(crate) mod hooks_browser;
mod input;
mod input_flow;
pub(crate) mod input_submission;
mod interaction;
pub(crate) mod keymap_editor;
pub(crate) mod memories_settings;
pub(crate) mod permissions_picker;
pub(crate) mod plugin_picker;
pub(crate) mod presets_menu;
pub(crate) mod process_list;
pub(crate) mod recap;
pub(crate) mod review_picker;
pub(crate) mod side;
pub(crate) mod skills_toggle;
pub(crate) mod subagent_backfill;
pub(crate) mod voice;
pub(crate) mod worktree_picker;
pub(crate) use interaction::FullscreenSurface;
mod interrupts;
pub(crate) mod mcp_login;
pub(crate) mod message_history;
mod owned_transcript;
mod pending_interactive_replay;
mod reasoning_shortcuts;
pub(crate) mod reconnect;
mod replay_filter;
pub(crate) mod right_click_paste;
mod session_lifecycle;
mod skills;
pub(crate) mod startup;
#[allow(dead_code)]
pub(crate) mod startup_prompts;
mod status_controls;
mod status_line;
mod terminal_title;
mod thread_event_buffer;
mod thread_events;
mod thread_input;
mod tool_lifecycle;
pub(crate) mod transcript_export;
mod transcript_presentation;
pub(crate) mod turn_lifecycle;
pub(crate) mod working_directory;

use app_server_protocol::protocol::v2::{
    McpServerStatus, McpServerStatusDetail, QueuedSubmission, Thread,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use self::agent_navigation::AgentNavigationDirection;
use crate::bottom_pane::AppServerResponse;
use crate::chatwidget::ChatWidget;
use crate::clipboard_copy::worker::PasteSource;
use crate::locale::Locale;
use crate::model_picker::ModelSelection;
use crate::pager_overlay::PagerOverlay;
use crate::projection::ConversationProjection;
use crate::resume_picker::PickerAction;
use crate::slash_command::SlashCommand;
use crate::status::StatusFacts;

/// Model-facing review instruction; the command itself stays a single user message.
const REVIEW_PROMPT: &str = "Review the current repository changes and report concrete issues with file and line references. Do not modify files.";

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
    StartNewThread,
    RenameThread {
        name: String,
    },
    CompactThread,
    ArchiveThread,
    DeleteThread,
    ForkThread,
    ReviewUncommitted,
    ReviewBaseBranch {
        branch: String,
    },
    ReviewCommit {
        sha: String,
    },
    ClearConversation,
    OpenConfigPanel,
    OpenModelPicker,
    OpenEffortPicker,
    OpenPermissionsPicker,
    OpenTitleSetup,
    OpenStatusLineSetup,
    ListHooks,
    ShowMemoryStatus,
    ResetMemory,
    ShowUsage,
    ListWarnings,
    ShowDiff,
    ChangeWorkingDirectory(std::path::PathBuf),
    ListPlugins,
    InsertComposerText(String),
    GoalCommand(String),
    SetMemoryMode(bool),
    WriteKeybinding {
        path: String,
        spec: String,
    },
    UnbindKeybinding {
        path: String,
    },
    ResetKeybinding {
        path: String,
    },
    UninstallPlugin {
        plugin_id: String,
        name: String,
    },
    InstallPlugin {
        plugin_name: String,
        marketplace_path: Option<String>,
        remote_marketplace_name: Option<String>,
        remote_release: Option<app_server_protocol::protocol::v2::MarketReleaseReference>,
    },
    InstallPluginRequest(String),
    ListProcesses,
    RunShellCommand(String),
    GenerateRecap(recap::RecapTrigger),
    ToggleAutoRecap,
    ApproveGuardianRetry(serde_json::Value),
    SavePreset {
        slot: String,
        input: String,
    },
    DeletePreset {
        slot: String,
    },
    SetPresetLabel {
        slot: String,
        label: String,
    },
    ListWorktrees,
    StartSideConversation {
        prompt: String,
    },
    ExitSideConversation,
    EnterWorktree {
        path: String,
        thread_id: Option<String>,
    },
    CreateWorktree {
        root_path: String,
        name: String,
    },
    DeleteWorktree {
        worktree_path: String,
    },
    StartVoiceInput,
    StopVoiceInput,
    SetHookEnabled {
        key: String,
        enabled: bool,
    },
    TrustHooks {
        hooks: Vec<(String, String)>,
    },
    TerminateProcess {
        thread_id: String,
        process_id: String,
        command: String,
    },
    SearchPlugins(String),
    SetSkillEnabled {
        path: std::path::PathBuf,
        name: String,
        enabled: bool,
    },
    ToggleAnimations,
    CycleRightClickPaste,
    ToggleStatusLineColors,
    SelectEffort(String),
    SelectPermissions(String),
    ListExperimentalFeatures,
    SetExperimentalFeature {
        name: String,
        enabled: bool,
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
    SelectTranscriptCopy,
    CopySelection {
        text: String,
        label: String,
        format: crate::clipboard_copy::CopyFormat,
    },
    CopyComposerSelection {
        text: String,
    },
    CopyTranscriptSelection {
        text: String,
        format: crate::clipboard_copy::CopyFormat,
        follow: bool,
        target: TranscriptSelectionTarget,
    },
    PublishPrimarySelection {
        target: TranscriptSelectionTarget,
    },
    OpenLink(String),
    ScheduleFrameIn(Duration),
    ExportTranscript {
        path: Option<PathBuf>,
    },
    PasteImage,
    PasteClipboardText(PasteSource),
    EditQueuedSubmission(QueuedSubmission),
    ScrollUp,
    ScrollDown,
    ScrollRows(isize),
    ScrollTop,
    ScrollBottom,
    LoadOlderHistory,
    SelectModel(ModelSelection),
    StatusLineSetup {
        items: Vec<String>,
        use_colors: bool,
    },
    TerminalTitleSetup {
        items: Vec<String>,
    },
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

#[derive(Debug, Default)]
pub(crate) struct App {
    pub(crate) backtrack: crate::app_backtrack::BacktrackState,
    pub(crate) history_replacement: history_replacement::HistoryReplacementState,
    pub(crate) chat_widget: ChatWidget,
    pub(crate) transcript_view: crate::transcript_view::TranscriptView,
    pub(crate) projection: ConversationProjection,
    pending_clipboard_copy: Option<clipboard::PendingCopy>,
    pending_mcp_login_start: Option<mcp_login::PendingMcpLoginStart>,
    active_mcp_login_ids: HashMap<String, mcp_login::ActiveMcpLogin>,
    mcp_login_generation: u64,
    pub(crate) thread_id: Option<String>,
    pub(crate) thread_history_mode: app_server_protocol::protocol::v2::ThreadHistoryMode,
    pub(crate) primary_thread_id: Option<String>,
    thread_event_channels: HashMap<String, self::thread_events::ThreadEventChannel>,
    pub(crate) cwd: PathBuf,
    /// Keeps terminal input behind a startup request that may open a protected interaction.
    ///
    /// The App Server stream can deliver an approval or user-input request immediately after the
    /// initial thread handshake. 上游 quarantines terminal input until that request is visible;
    /// Lime keeps the same boundary while leaving request ownership in `BottomPane`.
    pub(crate) startup_protected_input_boundary: bool,
    pub(crate) recap: recap::RecapState,
    pub(crate) thread_git_branch: Option<String>,
    pub(crate) thread_running: bool,
    pub(crate) thread_active_flags: Vec<app_server_protocol::protocol::v2::ThreadActiveFlag>,
    pub(crate) guardian_denials: auto_review::GuardianDenialStore,
    pub(crate) side_state: side::SideState,
    pub(crate) voice: voice::VoiceState,
}

impl App {
    pub(crate) fn open_skills_toggle_from_catalog(&mut self) {
        let entries = self
            .chat_widget
            .bottom_pane
            .skills()
            .iter()
            .map(|skill| crate::app::skills_toggle::SkillToggleEntry {
                name: skill.name.clone(),
                description: if skill.description.is_empty() {
                    skill.short_description.clone().unwrap_or_default()
                } else {
                    skill.description.clone()
                },
                path: skill.path.clone(),
                enabled: skill.enabled,
            })
            .collect();
        self.chat_widget.open_skills_toggle(entries);
    }

    pub(crate) fn set_runtime_keymap(&mut self, keymap: crate::keymap::RuntimeKeymap) {
        self.chat_widget.set_runtime_keymap(keymap);
    }

    pub(crate) fn set_right_click_paste(&mut self, mode: lime_core::config::RightClickPaste) {
        self.chat_widget.right_click_paste = mode;
    }

    pub(crate) fn raw_output_mode(&self) -> bool {
        self.chat_widget.is_raw_output_mode()
    }

    fn toggle_raw_output_mode(&mut self) {
        self.finish_main_transcript_selection(false);
        self.transcript_view.release_live_reading();
        self.transcript_view.viewport.suppress_next_activity();
        self.transcript_view.prompt_header.clear();
        self.chat_widget.toggle_history_render_mode();
        self.projection.set_status(
            self.chat_widget
                .locale
                .raw_output_mode_message(self.raw_output_mode()),
        );
    }

    pub(crate) fn set_cwd(&mut self, cwd: PathBuf) {
        self.cwd = cwd;
    }

    /// Enable the startup input boundary before the terminal event loop begins.
    pub(crate) fn begin_startup_input_boundary(&mut self) {
        self.startup_protected_input_boundary = true;
        self.chat_widget.clear_startup_protected_request();
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
            && (self.chat_widget.startup_protected_request_pending()
                || active_thread_has_buffered_request)
    }

    pub(crate) fn note_startup_protected_request(&mut self) {
        if self.startup_protected_input_boundary {
            self.chat_widget.set_startup_protected_request_pending(true);
        }
    }

    pub(crate) fn end_startup_input_boundary(&mut self) {
        self.startup_protected_input_boundary = false;
        self.chat_widget.clear_startup_protected_request();
    }

    /// Release the startup input boundary once the first ordinary input is safe to process.
    ///
    /// 上游 keeps startup protection until queued app events and interactive requests have been
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
            self.chat_widget.close_confirm_prompt();
            self.reset_backtrack_state();
            self.history_replacement.reset();
            self.chat_widget
                .bottom_pane
                .set_history_thread_id(&thread_id);
            self.reset_transcript_presentation();
            self.transcript_view.reset();
            self.chat_widget
                .reset_thread_surface(self.projection.active_turn_id(), Instant::now());
        }
        if self.primary_thread_id.is_none() {
            self.primary_thread_id = Some(thread_id.clone());
        }
        if self.chat_widget.agent_navigation.get(&thread_id).is_none() {
            self.chat_widget
                .agent_navigation
                .upsert(thread_id.clone(), None, None, false);
        }
        self.ensure_thread_channel(&thread_id);
        self.thread_id = Some(thread_id);
    }

    pub(crate) fn set_locale(&mut self, locale: Locale) {
        self.chat_widget.set_locale(locale);
    }

    /// Return the user-visible status while keeping active-turn and explicit command status ahead
    /// of app-scoped MCP startup diagnostics.
    /// Canonical live state for surfaces that cannot infer it from local turn projections.
    pub(crate) fn thread_display_name(&self, thread_id: &str) -> String {
        self.chat_widget
            .thread_names
            .get(thread_id)
            .cloned()
            .unwrap_or_else(|| thread_id.to_string())
    }

    pub(crate) fn side_parent_snapshot(&self) -> Option<&side::SideParentSnapshot> {
        let thread_id = self.thread_id.as_deref()?;
        self.side_state
            .is_side_thread(thread_id)
            .then(|| self.side_state.parent_snapshot())
            .flatten()
    }

    pub(crate) fn side_thread_title(&self, parent_thread_id: &str) -> String {
        let display = self
            .chat_widget
            .thread_names
            .get(parent_thread_id)
            .cloned()
            .unwrap_or_else(|| parent_thread_id.to_string());
        self.chat_widget.locale.side_thread_title(&display)
    }

    pub(crate) fn side_context_label(&self) -> Option<String> {
        let thread_id = self.thread_id.as_deref()?;
        let parent = self.side_state.parent_of(thread_id)?;
        let display = self
            .chat_widget
            .thread_names
            .get(parent)
            .cloned()
            .unwrap_or_else(|| parent.to_string());
        let mut label = self.chat_widget.locale.side_context_label(&display);
        if let Some(status) = self
            .chat_widget
            .agent_navigation
            .parent_status_label(parent, self.chat_widget.locale)
        {
            label.push_str(&format!(" · {status}"));
        }
        Some(label)
    }

    pub(crate) fn live_thread_status(&self) -> Option<&'static str> {
        use app_server_protocol::protocol::v2::ThreadActiveFlag;
        if self
            .thread_active_flags
            .contains(&ThreadActiveFlag::WaitingOnApproval)
        {
            return Some("waiting approval");
        }
        if self
            .thread_active_flags
            .contains(&ThreadActiveFlag::WaitingOnUserInput)
        {
            return Some("waiting input");
        }
        (self.thread_running || self.projection.active_turn_id().is_some()).then_some("running")
    }

    pub(crate) fn note_thread_status(
        &mut self,
        thread_id: &str,
        status: &app_server_protocol::protocol::v2::ThreadStatus,
    ) {
        if self.thread_id.as_deref() != Some(thread_id) {
            return;
        }
        self.apply_live_thread_status(status);
    }

    fn apply_live_thread_status(
        &mut self,
        status: &app_server_protocol::protocol::v2::ThreadStatus,
    ) {
        use app_server_protocol::protocol::v2::ThreadStatus;
        match status {
            ThreadStatus::Active { active_flags } => {
                self.thread_running = true;
                self.thread_active_flags = active_flags.clone();
            }
            ThreadStatus::Idle => {
                self.thread_running = false;
                self.thread_active_flags.clear();
            }
            ThreadStatus::SystemError => {
                self.thread_running = false;
                self.thread_active_flags.clear();
            }
            ThreadStatus::NotLoaded => {
                self.thread_running = false;
                self.thread_active_flags.clear();
            }
        }
    }

    pub(crate) fn status_value(&self) -> String {
        if let Some(live) = self.live_thread_status() {
            let status = self.projection.status();
            if matches!(status, "" | "ready" | "running") {
                return live.to_string();
            }
        }
        let status = self.projection.status();
        if matches!(status, "" | "ready") {
            return self
                .chat_widget
                .mcp_startup_warnings
                .status()
                .unwrap_or_else(|| status.to_string());
        }
        status.to_string()
    }

    pub(crate) fn hydrate_thread(&mut self, thread: Thread) {
        self.guardian_denials.clear();
        self.apply_live_thread_status(&thread.status);
        self.thread_git_branch = thread
            .git_info
            .as_ref()
            .and_then(|git_info| git_info.branch.clone());
        self.thread_history_mode = thread.history_mode.clone();
        self.reset_backtrack_state();
        self.history_replacement.reset();
        self.reset_for_hydrated_thread();
        self.chat_widget
            .set_status_thread_name(thread.id.clone(), thread.name.clone());
        self.chat_widget.agent_navigation.upsert(
            thread.id.clone(),
            thread.agent_nickname.clone(),
            thread.agent_role.clone(),
            false,
        );
        if let Some(parent_thread_id) = thread.parent_thread_id.clone() {
            self.chat_widget
                .agent_navigation
                .mark_parent_owned(thread.id.clone());
            if self.primary_thread_id.is_none() {
                self.primary_thread_id = Some(parent_thread_id);
            }
        }
        self.chat_widget
            .bottom_pane
            .replace_replayed_history(thread.id.clone(), &thread.turns);
        self.projection.hydrate_thread(thread);
        self.chat_widget.set_scrollback_has_older_history(false);
        self.chat_widget
            .turn_lifecycle
            .restore_running(self.projection.active_turn_id(), Instant::now());
    }

    fn adjacent_agent(&self, direction: AgentNavigationDirection) -> Option<String> {
        self.chat_widget
            .agent_navigation
            .adjacent_thread_id(self.thread_id.as_deref(), direction)
            .filter(|thread_id| self.thread_id.as_deref() != Some(thread_id.as_str()))
    }

    pub(crate) fn can_accept_direct_input(&mut self) -> bool {
        if self.backtrack_revert_pending() || self.history_replacement.is_pending() {
            return false;
        }
        if self
            .thread_id
            .as_deref()
            .is_some_and(|thread_id| self.chat_widget.agent_navigation.is_parent_owned(thread_id))
        {
            self.projection
                .set_status("sub-agent thread is parent-owned");
            return false;
        }
        true
    }

    pub(crate) fn pre_draw_tick(&mut self, now: Instant) -> AppAction {
        let action = self
            .chat_widget
            .bottom_pane
            .pre_draw_tick(now)
            .map(AppAction::Respond)
            .unwrap_or(AppAction::None);
        if matches!(action, AppAction::Respond(_)) && !self.chat_widget.bottom_pane.is_active() {
            self.chat_widget.clear_startup_protected_request();
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
            self.transcript_view.selection.tick_edge_scroll()
        };
        if selection_scrolled {
            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
        } else if self
            .transcript_view
            .search
            .take_history_request(self.chat_widget.scrollback_has_older_history)
            || self
                .chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(PagerOverlay::take_search_history_request)
        {
            AppAction::LoadOlderHistory
        } else if self.transcript_search_needs_frame() {
            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
        } else if let Some(delay) = self.transcript_view.composer_gap.tick(now) {
            AppAction::ScheduleFrameIn(delay)
        } else {
            AppAction::None
        }
    }

    pub(crate) fn scroll_up(&mut self, amount: usize) {
        if self.scroll_owned_transcript(-isize::try_from(amount).unwrap_or(isize::MAX)) {
            return;
        }
        self.transcript_view.scroll_up(amount);
    }

    pub(crate) fn scroll_down(&mut self, amount: usize) {
        if self.scroll_owned_transcript(isize::try_from(amount).unwrap_or(isize::MAX)) {
            return;
        }
        self.transcript_view.scroll_down(amount);
    }

    pub(crate) fn scroll_top(&mut self) {
        self.transcript_view.scroll_top();
    }

    pub(crate) fn scroll_bottom(&mut self) {
        self.transcript_view.scroll_bottom();
    }

    pub(crate) fn finish_main_transcript_selection(&mut self, follow: bool) {
        self.transcript_view.finish_selection(follow);
    }

    fn run_local_command(&mut self) -> Option<AppAction> {
        let text = self
            .chat_widget
            .bottom_pane
            .composer_text()
            .trim()
            .to_string();
        let command = self.chat_widget.bottom_pane.command_from_prompt(&text)?;
        // Enter executed the command; the popup must not keep whatever follows.
        self.chat_widget.bottom_pane.clear_completion_popup();
        if command != SlashCommand::Copy {
            self.chat_widget.last_status_copy_targets = None;
        }
        let action = match command {
            SlashCommand::Raw => {
                self.toggle_raw_output_mode();
                AppAction::None
            }
            SlashCommand::Vim => {
                let enabled = self.chat_widget.bottom_pane.toggle_vim_enabled();
                self.projection
                    .set_status(self.chat_widget.locale.vim_mode_message(enabled));
                AppAction::None
            }
            SlashCommand::Status => {
                self.open_status_pager();
                AppAction::None
            }
            SlashCommand::Statusline => {
                self.chat_widget.show_status_line_setup();
                AppAction::None
            }
            SlashCommand::Title => {
                self.chat_widget.show_terminal_title_setup();
                AppAction::None
            }
            SlashCommand::Copy => AppAction::SelectTranscriptCopy,
            SlashCommand::Export => {
                let path = text
                    .strip_prefix("/export")
                    .map(str::trim)
                    .filter(|path| !path.is_empty())
                    .map(PathBuf::from);
                if path.is_none() {
                    self.chat_widget
                        .show_transcript_export_popup(self.thread_id.as_deref());
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
            SlashCommand::New => AppAction::StartNewThread,
            SlashCommand::Compact => AppAction::CompactThread,
            SlashCommand::Archive => {
                self.chat_widget
                    .open_confirm_prompt(crate::app::confirm_prompt::ConfirmPrompt::archive());
                AppAction::None
            }
            SlashCommand::Fork => AppAction::ForkThread,
            SlashCommand::Quit => AppAction::Quit,
            SlashCommand::Clear => AppAction::ClearConversation,
            SlashCommand::Config => {
                self.chat_widget.open_config_menu();
                AppAction::None
            }
            SlashCommand::Permissions => {
                let argument = text
                    .strip_prefix("/permissions")
                    .map(str::trim)
                    .unwrap_or_default();
                if !argument.is_empty() {
                    return None;
                }
                let profiles = self.chat_widget.permission_profiles.clone();
                if profiles.is_empty() {
                    self.projection
                        .set_status(self.chat_widget.locale.permissions_picker_empty());
                    AppAction::None
                } else {
                    self.chat_widget.open_permissions_picker();
                    AppAction::None
                }
            }
            SlashCommand::Effort => {
                let argument = text
                    .strip_prefix("/effort")
                    .map(str::trim)
                    .unwrap_or_default();
                if !argument.is_empty() {
                    return None;
                }
                self.chat_widget.open_effort_picker();
                AppAction::None
            }
            SlashCommand::Hooks => AppAction::ListHooks,
            SlashCommand::Skills => {
                self.open_skills_toggle_from_catalog();
                AppAction::None
            }
            SlashCommand::Keymap => {
                let entries = self.chat_widget.runtime_keymap.describe();
                self.chat_widget.open_keymap_editor(entries);
                AppAction::None
            }
            SlashCommand::Usage => AppAction::ShowUsage,
            SlashCommand::Warnings => AppAction::ListWarnings,
            SlashCommand::Diff => AppAction::ShowDiff,
            SlashCommand::Plugins => {
                let argument = text
                    .strip_prefix("/plugins")
                    .map(str::trim)
                    .unwrap_or_default();
                if let Some(term) = argument.strip_prefix("search ") {
                    let term = term.trim();
                    if term.is_empty() {
                        self.projection
                            .set_status(self.chat_widget.locale.plugins_usage());
                        AppAction::None
                    } else {
                        AppAction::SearchPlugins(term.to_string())
                    }
                } else if let Some(name) = argument.strip_prefix("install ") {
                    let name = name.trim();
                    if name.is_empty() {
                        self.projection
                            .set_status(self.chat_widget.locale.plugins_usage());
                        AppAction::None
                    } else {
                        AppAction::InstallPluginRequest(name.to_string())
                    }
                } else if argument.is_empty() {
                    AppAction::ListPlugins
                } else {
                    self.projection
                        .set_status(self.chat_widget.locale.plugins_usage());
                    AppAction::None
                }
            }
            SlashCommand::Mention => AppAction::InsertComposerText("@".to_string()),
            SlashCommand::Recap => AppAction::GenerateRecap(recap::RecapTrigger::Manual),
            SlashCommand::Worktree => AppAction::ListWorktrees,
            SlashCommand::Voice => {
                if self.voice.is_recording() {
                    AppAction::StopVoiceInput
                } else {
                    AppAction::StartVoiceInput
                }
            }
            SlashCommand::Side | SlashCommand::Btw => {
                let prompt = text
                    .split_once(char::is_whitespace)
                    .map(|(_, rest)| rest.trim().to_string())
                    .unwrap_or_default();
                if self.thread_id.is_none() {
                    self.projection
                        .set_status(self.chat_widget.locale.side_unavailable());
                    AppAction::None
                } else {
                    let thread_id = self.thread_id.clone().expect("thread id checked above");
                    if self.side_state.is_side_thread(&thread_id) {
                        AppAction::ExitSideConversation
                    } else if self.side_state.has_open_side(&thread_id) {
                        self.projection
                            .set_status(self.chat_widget.locale.side_already_open());
                        AppAction::None
                    } else {
                        AppAction::StartSideConversation { prompt }
                    }
                }
            }
            SlashCommand::Presets => {
                let entries = self
                    .chat_widget
                    .tui_config
                    .presets
                    .iter()
                    .map(|(slot, dial)| crate::app::presets_menu::PresetEntry {
                        slot: slot.clone(),
                        label: dial
                            .label
                            .clone()
                            .filter(|label| !label.trim().is_empty())
                            .unwrap_or_else(|| dial.input.lines().next().unwrap_or("").to_string()),
                        input: dial.input.clone(),
                    })
                    .collect();
                self.chat_widget
                    .open_presets_menu(crate::app::presets_menu::PresetsMenu::new(entries));
                AppAction::None
            }
            SlashCommand::AutoReview => {
                if self.thread_id.is_none() {
                    self.projection
                        .set_status(self.chat_widget.locale.auto_review_no_denials());
                    AppAction::None
                } else {
                    match self.guardian_denials.latest() {
                        Some(denial) => {
                            let prompt =
                                crate::app::confirm_prompt::ConfirmPrompt::approve_guardian_retry(
                                    denial.summary.clone(),
                                    denial.event.clone(),
                                );
                            self.chat_widget.open_confirm_prompt(prompt);
                            AppAction::None
                        }
                        None => {
                            self.projection
                                .set_status(self.chat_widget.locale.auto_review_no_denials());
                            AppAction::None
                        }
                    }
                }
            }
            SlashCommand::Ps => AppAction::ListProcesses,
            SlashCommand::Memories => {
                let argument = text
                    .strip_prefix("/memories")
                    .map(str::trim)
                    .unwrap_or_default();
                match argument {
                    "on" => AppAction::SetMemoryMode(true),
                    "off" => AppAction::SetMemoryMode(false),
                    "" => {
                        let mode = self.chat_widget.memory_mode;
                        self.chat_widget.open_memories_settings(mode);
                        AppAction::None
                    }
                    _ => {
                        self.projection
                            .set_status(self.chat_widget.locale.memories_usage());
                        AppAction::None
                    }
                }
            }
            SlashCommand::Goal => {
                let argument = text
                    .strip_prefix("/goal")
                    .map(str::trim)
                    .unwrap_or_default();
                match argument {
                    "" => AppAction::GoalCommand("show".to_string()),
                    "clear" => AppAction::GoalCommand("clear".to_string()),
                    "pause" => AppAction::GoalCommand("pause".to_string()),
                    "resume" => AppAction::GoalCommand("resume".to_string()),
                    objective => AppAction::GoalCommand(format!("set:{objective}")),
                }
            }
            SlashCommand::Cd => {
                let argument = text.strip_prefix("/cd").map(str::trim).unwrap_or_default();
                let requested = if argument.is_empty() || argument == "~" {
                    dirs::home_dir()
                } else if let Some(relative) = argument.strip_prefix("~/") {
                    dirs::home_dir().map(|home| home.join(relative))
                } else {
                    Some(std::path::PathBuf::from(argument))
                };
                match requested {
                    Some(path) => {
                        let resolved = if path.is_absolute() {
                            path
                        } else {
                            self.cwd.join(path)
                        };
                        AppAction::ChangeWorkingDirectory(resolved)
                    }
                    None => {
                        self.projection
                            .set_status(self.chat_widget.locale.cd_usage());
                        AppAction::None
                    }
                }
            }
            SlashCommand::Stop => {
                if self.projection.active_turn_id().is_some() {
                    AppAction::Interrupt
                } else {
                    self.projection
                        .set_status(self.chat_widget.locale.stop_no_active_turn());
                    AppAction::None
                }
            }
            SlashCommand::Memory => {
                let argument = text
                    .strip_prefix("/memory")
                    .map(str::trim)
                    .unwrap_or_default();
                match argument {
                    "" => AppAction::ShowMemoryStatus,
                    "reset" => {
                        self.chat_widget.open_confirm_prompt(
                            crate::app::confirm_prompt::ConfirmPrompt::reset_memory(),
                        );
                        AppAction::None
                    }
                    _ => {
                        self.projection
                            .set_status(self.chat_widget.locale.memory_usage());
                        AppAction::None
                    }
                }
            }
            SlashCommand::Experimental => {
                let argument = text
                    .strip_prefix("/experimental")
                    .map(str::trim)
                    .unwrap_or_default();
                if argument.is_empty() {
                    AppAction::ListExperimentalFeatures
                } else {
                    let mut parts = argument.split_whitespace();
                    let name = parts.next().unwrap_or_default();
                    let state = parts.next();
                    match (name, state) {
                        ("", _) | (_, None) => {
                            self.projection
                                .set_status(self.chat_widget.locale.experimental_usage());
                            AppAction::None
                        }
                        (name, Some("on")) => AppAction::SetExperimentalFeature {
                            name: name.to_string(),
                            enabled: true,
                        },
                        (name, Some("off")) => AppAction::SetExperimentalFeature {
                            name: name.to_string(),
                            enabled: false,
                        },
                        _ => {
                            self.projection
                                .set_status(self.chat_widget.locale.experimental_usage());
                            AppAction::None
                        }
                    }
                }
            }
            SlashCommand::Review => {
                let instructions = text
                    .strip_prefix("/review")
                    .map(str::trim)
                    .unwrap_or_default();
                if instructions.is_empty() && self.chat_widget.review_picker.is_none() {
                    self.chat_widget.open_review_picker();
                    return Some(AppAction::None);
                }
                if instructions == "branch" {
                    self.projection
                        .set_status(self.chat_widget.locale.review_branch_usage());
                    return Some(AppAction::None);
                }
                if instructions == "commit" {
                    self.projection
                        .set_status(self.chat_widget.locale.review_commit_usage());
                    return Some(AppAction::None);
                }
                if let Some(branch) = instructions.strip_prefix("branch ") {
                    let branch = branch.trim();
                    if branch.is_empty() {
                        self.projection
                            .set_status(self.chat_widget.locale.review_branch_usage());
                        return Some(AppAction::None);
                    }
                    self.chat_widget
                        .bottom_pane
                        .set_composer_text(String::new());
                    return Some(AppAction::ReviewBaseBranch {
                        branch: branch.to_string(),
                    });
                }
                if let Some(sha) = instructions.strip_prefix("commit ") {
                    let sha = sha.trim();
                    if sha.is_empty() {
                        self.projection
                            .set_status(self.chat_widget.locale.review_commit_usage());
                        return Some(AppAction::None);
                    }
                    self.chat_widget
                        .bottom_pane
                        .set_composer_text(String::new());
                    return Some(AppAction::ReviewCommit {
                        sha: sha.to_string(),
                    });
                }
                let prompt = if instructions.is_empty() {
                    REVIEW_PROMPT.to_string()
                } else {
                    format!(
                        "Review the current repository changes. Focus on the following instructions: {instructions}"
                    )
                };
                self.chat_widget
                    .bottom_pane
                    .set_composer_text(String::new());
                AppAction::Submit {
                    text: prompt,
                    text_elements: Vec::new(),
                }
            }
            SlashCommand::Delete => {
                self.chat_widget
                    .open_confirm_prompt(crate::app::confirm_prompt::ConfirmPrompt::delete_thread());
                AppAction::None
            }
            SlashCommand::Rename => {
                let name = text
                    .strip_prefix("/rename")
                    .map(str::trim)
                    .unwrap_or_default();
                if name.is_empty() {
                    self.projection
                        .set_status(self.chat_widget.locale.rename_usage());
                    AppAction::None
                } else {
                    self.chat_widget
                        .bottom_pane
                        .set_composer_text(String::new());
                    AppAction::RenameThread {
                        name: name.to_string(),
                    }
                }
            }
            SlashCommand::Init => {
                self.chat_widget
                    .bottom_pane
                    .set_composer_text(String::new());
                AppAction::Submit {
                    text: include_str!("../assets/prompt_for_init_command.md").to_string(),
                    text_elements: Vec::new(),
                }
            }
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
                    self.projection
                        .set_status(self.chat_widget.locale.pwd_usage());
                } else {
                    let cwd = self.cwd.to_string_lossy();
                    self.projection.set_status(
                        self.chat_widget
                            .locale
                            .current_working_directory_message(&cwd),
                    );
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
        let cwd = self.cwd.to_string_lossy();
        let status = self.status_value();
        let thread_id = self.thread_id.clone();
        let thread_name = thread_id
            .as_deref()
            .and_then(|id| self.chat_widget.thread_names.get(id))
            .cloned();
        let model = self.chat_widget.model.clone();
        let provider = self.chat_widget.model_provider.clone();
        let effort = self.chat_widget.reasoning_effort.clone();
        let permissions = self.chat_widget.permissions.clone();
        self.chat_widget.open_status_pager(StatusFacts {
            thread_id: thread_id.as_deref(),
            thread_name: thread_name.as_deref(),
            model: model.as_deref(),
            provider: provider.as_deref(),
            effort: effort.as_deref(),
            permissions: permissions.as_deref(),
            cwd: &cwd,
            status: &status,
            token_usage: thread_id
                .as_deref()
                .and_then(|id| self.projection.token_usage(id)),
        });
    }

    pub(crate) fn open_mcp_inventory(
        &mut self,
        statuses: Vec<McpServerStatus>,
        detail: McpServerStatusDetail,
    ) {
        self.chat_widget.open_mcp_inventory(&statuses, detail);
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "app/transcript_presentation_tests.rs"]
mod transcript_presentation_tests;
