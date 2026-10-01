//! Current composer state; draft, input, history, and completion each have one control-flow owner.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::text::Line;
use std::cell::RefMut;
use std::ops::Range;
use std::time::Instant;
use unicode_segmentation::UnicodeSegmentation;

mod agents_navigation;
mod attachment_state;
mod completion;
mod completion_target;
mod draft;
mod draft_state;
mod external_edit;
mod file_search_popup;
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
mod skill_popup;
mod slash_input;
mod submission;

#[cfg(test)]
#[path = "chat_composer/structured_input_tests.rs"]
mod structured_input_tests;
mod vim_history;
mod vim_search;

use self::attachment_state::AttachmentState;
pub(crate) use self::draft_state::ComposerDraft;
use self::draft_state::{ComposerMentionBinding, DraftState};
use self::file_search_popup::FileSearchPopup;
pub(crate) use self::file_search_popup::FileSearchPopupAction;
use self::footer_state::{FooterMode, FooterState};
use self::history_search::HistorySearchSession;
use self::popup_state::{ActivePopup, DismissedToken, PopupState};
use self::skill_popup::SkillPopup;
pub(crate) use self::skill_popup::SkillPopupAction;
use self::vim_history::VimHistory;
use super::command_popup::{CommandPopup, CommandPopupAction};
use super::MentionBinding;
use crate::app_event_sender::AppEventSender;
use crate::bottom_pane::chat_composer_history::{
    ChatComposerHistory, HistoryEntry, HistoryEntryResponse, HistorySearchDirection,
    HistorySearchResult,
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
}

#[cfg(test)]
mod completion_tests;
#[cfg(test)]
mod history_response_tests;
#[cfg(test)]
mod tests;
