//! Editable draft state kept separate from composer control flow.

use std::cell::{RefCell, RefMut};
use std::collections::HashMap;

use super::attachment_state::AttachmentState;
use crate::bottom_pane::paste_burst::PasteBurst;
use crate::bottom_pane::textarea::{TextArea, TextAreaState, TextElementSnapshot};
use crate::bottom_pane::MentionBinding;

/// Minimal composer snapshot shared by history/search and Vim editing.
///
/// Keep this at the draft owner boundary so every temporary composer mode restores the
/// same text, cursor, atomic paste payload, mention targets and canonical attachment state.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ComposerDraft {
    pub(super) text: String,
    pub(super) cursor: usize,
    pub(super) attachments: AttachmentState,
    pub(super) text_elements: Vec<TextElementSnapshot>,
    pub(super) pending_pastes: Vec<(String, String)>,
    pub(super) mention_bindings: Vec<MentionBinding>,
}

impl ComposerDraft {
    pub(crate) fn text_with_pending(&self) -> String {
        super::ChatComposer::expand_pending_pastes(
            &self.text,
            self.text_elements
                .iter()
                .map(|element| {
                    agent_protocol::TextElement::new(
                        element.range.clone(),
                        element.placeholder.clone(),
                    )
                })
                .collect(),
            &self.pending_pastes,
        )
        .0
    }

    pub(super) fn bytes(&self) -> usize {
        self.text.len()
            + self
                .mention_bindings
                .iter()
                .map(|binding| binding.mention.len() + binding.path.len())
                .sum::<usize>()
            + self
                .pending_pastes
                .iter()
                .map(|(label, text)| label.len() + text.len())
                .sum::<usize>()
            + self
                .attachments
                .local_image_paths()
                .iter()
                .map(|path| path.as_os_str().len())
                .sum::<usize>()
            + self
                .attachments
                .remote_images()
                .iter()
                .map(|image| image.url.len())
                .sum::<usize>()
    }
}

#[derive(Debug)]
pub(super) struct DraftState {
    pub(super) textarea: TextArea,
    pub(super) textarea_state: RefCell<TextAreaState>,
    pub(super) input_enabled: bool,
    pub(super) input_disabled_placeholder: Option<String>,
    pub(super) saved_draft: Option<ComposerDraft>,
    pub(super) paste_burst: PasteBurst,
    pub(super) disable_paste_burst: bool,
    pub(super) pending_pastes: Vec<(String, String)>,
    pub(super) mention_bindings: HashMap<u64, ComposerMentionBinding>,
    pub(super) recent_submission_mention_bindings: Vec<MentionBinding>,
}

impl Default for DraftState {
    fn default() -> Self {
        Self {
            textarea: TextArea::default(),
            textarea_state: RefCell::new(TextAreaState::default()),
            input_enabled: true,
            input_disabled_placeholder: None,
            saved_draft: None,
            paste_burst: PasteBurst::default(),
            disable_paste_burst: false,
            pending_pastes: Vec::new(),
            mention_bindings: HashMap::new(),
            recent_submission_mention_bindings: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct ComposerMentionBinding {
    pub(super) sigil: char,
    pub(super) mention: String,
    pub(super) path: String,
}

impl DraftState {
    pub(super) fn textarea_state_mut(&self) -> RefMut<'_, TextAreaState> {
        self.textarea_state.borrow_mut()
    }
}
