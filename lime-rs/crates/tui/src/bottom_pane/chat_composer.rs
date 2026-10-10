//! Current composer state; draft, input, history, and completion each have one control-flow owner.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::text::Line;
use std::cell::RefMut;
use std::ops::Range;
use std::time::Instant;
use unicode_segmentation::UnicodeSegmentation;

mod agents_navigation;
mod attachment_state;
mod completion;
mod completion_target;
mod config;
mod draft;
mod draft_state;
mod effort;
mod external_edit;
mod footer_state;
mod history;
mod history_search;
mod input;
mod layout;
mod mentions;
mod mouse;
mod paste_input;
mod pending_paste;
mod popup_state;
mod reconnect;
mod render;
mod slash_input;
mod submission;

#[cfg(test)]
#[path = "chat_composer/structured_input_tests.rs"]
mod structured_input_tests;
mod vim_history;
mod vim_search;

use self::attachment_state::AttachmentState;
pub(crate) use self::config::ChatComposerConfig;
pub(crate) use self::draft_state::ComposerDraft;
use self::draft_state::{ComposerMentionBinding, DraftState};
use self::footer_state::FooterState;
use self::history_search::HistorySearchSession;
use self::popup_state::{ActivePopup, DismissedToken, PopupState};
use self::vim_history::VimHistory;
use super::command_popup::{CommandPopup, CommandPopupAction};
use super::effort_ignition::{EffortIgnition, EffortTier, IgnitionStyle};
use super::effort_status_line::EffortStatusLineTransition;
use super::file_search_popup::{FileSearchPopup, FileSearchPopupAction};
use super::footer::FooterMode;
use super::skill_popup::{SkillPopup, SkillPopupAction};
use super::MentionBinding;
use crate::app_event_sender::AppEventSender;
use crate::bottom_pane::chat_composer_history::{
    replay_entries_from_items, replay_entries_from_turns, ChatComposerHistory, HistoryEntry,
    HistoryEntryResponse, HistorySearchDirection, HistorySearchResult,
};
use crate::bottom_pane::textarea::{TextArea, TextAreaState, VimPersistentState};
use app_server_protocol::protocol::v2::{FuzzyFileSearchResult, SkillMetadata};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileSearchRequest {
    pub(crate) generation: u64,
    pub(crate) query: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InputResult {
    None,
    Changed,
    Submitted {
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
    },
    Queued {
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
    },
    SubmissionRejected {
        actual_chars: usize,
    },
    Interrupt,
    DecreaseEffort,
    IncreaseEffort,
    PreviousPermissions,
    NextPermissions,
    OpenExternalEditor,
    OpenAgentsOverview,
    Quit,
}

#[derive(Debug, Default)]
pub(crate) struct ChatComposer {
    config: ChatComposerConfig,
    app_event_tx: AppEventSender,
    locale: crate::locale::Locale,
    draft: DraftState,
    attachments: AttachmentState,
    popups: PopupState,
    footer: FooterState,
    history: ChatComposerHistory,
    history_search: Option<HistorySearchSession>,
    vim_history: VimHistory,
    agents_navigation_enabled: bool,
    effort_tier: Option<EffortTier>,
    effort_observed: bool,
    effort_ignition: Option<EffortIgnition>,
    effort_animation_style: Option<IgnitionStyle>,
    effort_status_line_transition: Option<EffortStatusLineTransition>,
    frame_requester: Option<crate::tui::FrameRequester>,
}

impl ChatComposer {
    pub(crate) fn new_with_config(config: ChatComposerConfig) -> Self {
        Self {
            config,
            ..Self::default()
        }
    }
}

#[cfg(test)]
mod completion_tests;
#[cfg(test)]
mod history_response_tests;
#[cfg(test)]
mod tests;
