//! Chat surface owner shared by the terminal host and the canonical transcript.
//!
//! 上游 keeps the chat surface separate from the process-level `App`: the widget owns the
//! bottom-pane input and dialog presentation, while `App` owns transport, thread routing and
//! the main `TranscriptView`. Main reading, search and selection must not return to this widget.

use self::transcript_export::ExportPicker;
use crate::app::agent_navigation::AgentNavigationState;
use crate::app::agent_picker::AgentPicker;
use crate::app::agents_overview::AgentsOverviewState;
use crate::app::right_click_paste::PendingPaste;
use crate::bottom_pane::BottomPane;
use crate::history_cell::HistoryRenderMode;
use crate::keymap::{KeyChordMatcher, RuntimeKeymap, TranscriptKeymap};
use crate::locale::Locale;
use crate::model_catalog::ModelCatalog;
use crate::model_picker::ModelPicker;
use crate::pager_overlay::PagerOverlay;
use crate::resume_picker::PickerState;
use crate::transcript_view::TranscriptBookmark;
use app_server_protocol::protocol::v2::QueuedSubmission;
use lime_core::config::RightClickPaste;
use std::collections::HashMap;

mod clipboard;
pub(crate) mod copy_picker;
mod footer;
mod input;
mod interaction;
mod settings;
mod status_controls;
mod transcript;
pub(crate) mod transcript_export;
#[cfg(test)]
mod transcript_export_tests;

pub(crate) use interaction::{ExportPickerEvent, ModelPickerEvent, ResumePickerEvent};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ExternalEditorState {
    #[default]
    Closed,
    Requested,
    Active,
}

#[derive(Debug)]
struct RetainedTranscript {
    pager: PagerOverlay,
    bookmark: TranscriptBookmark,
}

#[derive(Debug, Default)]
pub(crate) struct TranscriptPresentation {
    detailed: Option<RetainedTranscript>,
}

impl TranscriptPresentation {
    pub(crate) fn open(&mut self, locale: Locale, keymap: TranscriptKeymap) -> PagerOverlay {
        let mut pager = match self.detailed.take() {
            Some(retained) => {
                retained.pager.restore_bookmark(retained.bookmark);
                retained.pager
            }
            None => PagerOverlay::transcript(locale),
        };
        pager = pager.with_keymap(keymap);
        pager
    }

    pub(crate) fn retain(&mut self, mut pager: PagerOverlay) {
        if !pager.is_transcript() {
            return;
        }
        pager.suspend_transcript_interaction();
        let bookmark = pager.bookmark();
        self.detailed = Some(RetainedTranscript { pager, bookmark });
    }

    pub(crate) fn clear(&mut self) {
        self.detailed = None;
    }

    #[cfg(test)]
    pub(crate) fn has_detailed_bookmark(&self) -> bool {
        self.detailed.is_some()
    }
}

/// Session-local chat surface state.
///
/// This is intentionally a real owner, not a compatibility alias or a `Deref` facade.  The
/// nested bottom pane remains the single owner for composer text, queued approvals/questions,
/// popup state, input routing, rendering and draft snapshots.  App Server/runtime state stays in
/// [`crate::app::App`], so GUI and TUI continue to consume the same canonical backend.
#[derive(Debug, Default)]
pub(crate) struct ChatWidget {
    pub(crate) tui_config: lime_core::config::TuiConfig,
    pub(crate) config_version: Option<String>,
    pub(crate) thread_names: HashMap<String, String>,
    pub(crate) status_line_setup:
        Option<crate::bottom_pane::status_line_setup::StatusLineSetupView>,
    pub(crate) terminal_title_setup:
        Option<crate::bottom_pane::title_setup::TerminalTitleSetupView>,
    pub(crate) bottom_pane: BottomPane,
    pub(crate) locale: Locale,
    pub(crate) runtime_keymap: RuntimeKeymap,
    pub(crate) global_key_chord_matcher: KeyChordMatcher,
    pub(crate) right_click_paste: RightClickPaste,
    pub(crate) pending_clipboard_paste: Option<PendingPaste>,
    pub(crate) suppress_image_paste_until: Option<std::time::Instant>,
    pub(crate) queued_submissions: Vec<QueuedSubmission>,
    pub(crate) thread_input_states: HashMap<String, crate::bottom_pane::BottomPaneInputState>,
    pub(crate) turn_lifecycle: crate::app::turn_lifecycle::TurnLifecycleState,
    pub(crate) skill_load_warnings: crate::app::startup_prompts::SkillLoadWarningState,
    pub(crate) mcp_startup_warnings: crate::app::startup_prompts::McpStartupWarningState,
    pub(crate) agent_navigation: AgentNavigationState,
    pub(crate) agents_overview: Option<AgentsOverviewState>,
    pub(crate) model_picker: Option<ModelPicker>,
    pub(crate) confirm_prompt: Option<crate::app::confirm_prompt::ConfirmPrompt>,
    pub(crate) review_picker: Option<crate::app::review_picker::ReviewPicker>,
    pub(crate) effort_picker: Option<crate::app::effort_picker::EffortPicker>,
    pub(crate) permissions_picker: Option<crate::app::permissions_picker::PermissionsPicker>,
    pub(crate) config_menu: Option<crate::app::config_menu::ConfigMenu>,
    pub(crate) keymap_editor: Option<crate::app::keymap_editor::KeymapEditor>,
    pub(crate) plugin_picker: Option<crate::app::plugin_picker::PluginPicker>,
    pub(crate) skills_toggle: Option<crate::app::skills_toggle::SkillsToggle>,
    pub(crate) memories_settings: Option<crate::app::memories_settings::MemoriesSettings>,
    pub(crate) hooks_browser: Option<crate::app::hooks_browser::HooksBrowser>,
    pub(crate) process_list: Option<crate::app::process_list::ProcessList>,
    pub(crate) shell_mode: bool,
    pub(crate) presets_menu: Option<crate::app::presets_menu::PresetsMenu>,
    pub(crate) worktree_picker: Option<crate::app::worktree_picker::WorktreePicker>,
    pub(crate) memory_mode: Option<bool>,
    pub(crate) agent_picker: Option<AgentPicker>,
    pub(crate) resume_picker: Option<PickerState>,
    pub(crate) export_picker: Option<ExportPicker>,
    pub(crate) copy_picker: Option<copy_picker::CopyPicker>,
    pub(crate) last_status_copy_targets: Option<copy_picker::StatusCopySource>,
    pub(crate) model_catalog: ModelCatalog,
    pub(crate) collaboration_mode: Option<agent_protocol::CollaborationMode>,
    pub(crate) model: Option<String>,
    pub(crate) model_provider: Option<String>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) permissions: Option<String>,
    pub(crate) permission_profiles: Vec<String>,
    pub(crate) history_render_mode: HistoryRenderMode,
    pub(crate) scrollback_has_older_history: bool,
    pub(crate) pager_overlay: Option<PagerOverlay>,
    pub(crate) transcript_presentation: TranscriptPresentation,
    pub(crate) external_editor_state: ExternalEditorState,
    /// True while a startup-scoped protected request is waiting to be shown in the pane.
    ///
    /// The host boundary itself remains in `App`; this flag is presentation state owned by the
    /// chat surface and must not become a second transport/session lifecycle.
    pub(crate) startup_pending_protected_request: bool,
}

impl ChatWidget {
    pub(crate) fn set_locale(&mut self, locale: Locale) {
        self.locale = locale;
        self.bottom_pane.set_locale(locale);
    }

    pub(crate) fn set_runtime_keymap(&mut self, keymap: RuntimeKeymap) {
        self.bottom_pane.set_keymap_bindings(&keymap);
        self.runtime_keymap = keymap;
        self.global_key_chord_matcher.reset();
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
}
