//! Chat surface owner shared by the terminal host and the canonical transcript.
//!
//! Codex keeps the chat surface separate from the process-level `App`: the widget owns the
//! bottom-pane input, transcript presentation and interaction state, while `App` owns transport,
//! thread routing and lifecycle decisions. Keeping this surface boundary explicit prevents the
//! host from becoming a second composer or transcript owner.

use crate::app::agent_picker::AgentPicker;
use crate::app::agents_overview::AgentsOverviewState;
use crate::app::transcript_export::ExportPicker;
use crate::bottom_pane::BottomPane;
use crate::history_cell::HistoryRenderMode;
use crate::keymap::TranscriptKeymap;
use crate::locale::Locale;
use crate::model_catalog::ModelCatalog;
use crate::model_picker::ModelPicker;
use crate::pager_overlay::PagerOverlay;
use crate::resume_picker::PickerState;
use crate::transcript_view::TranscriptBookmark;

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
    pub(crate) bottom_pane: BottomPane,
    pub(crate) agents_overview: Option<AgentsOverviewState>,
    pub(crate) model_picker: Option<ModelPicker>,
    pub(crate) agent_picker: Option<AgentPicker>,
    pub(crate) resume_picker: Option<PickerState>,
    pub(crate) export_picker: Option<ExportPicker>,
    pub(crate) model_catalog: ModelCatalog,
    pub(crate) collaboration_mode: Option<agent_protocol::CollaborationMode>,
    pub(crate) model: Option<String>,
    pub(crate) model_provider: Option<String>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) permissions: Option<String>,
    pub(crate) permission_profiles: Vec<String>,
    pub(crate) history_render_mode: HistoryRenderMode,
    pub(crate) pager_overlay: Option<PagerOverlay>,
    pub(crate) transcript_presentation: TranscriptPresentation,
    pub(crate) transcript_scroll: usize,
    pub(crate) transcript_viewport: crate::transcript_reflow::TranscriptViewport,
    pub(crate) transcript_follow_control: crate::transcript_view::TranscriptFollowControl,
    pub(crate) transcript_composer_gap: crate::transcript_view::TranscriptComposerGap,
    pub(crate) transcript_footer: crate::transcript_view::TranscriptFooter,
    pub(crate) transcript_prompt_header: crate::transcript_view::TranscriptPromptHeader,
    pub(crate) transcript_search: crate::transcript_view::TranscriptSearch,
    pub(crate) transcript_selection: crate::transcript_view::TranscriptSelection,
}
