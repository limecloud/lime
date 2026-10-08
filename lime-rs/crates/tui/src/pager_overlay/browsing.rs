//! Previous-prompt highlight and footer are presentation state in the existing transcript pager.

use super::*;

#[derive(Debug)]
pub(super) struct BrowsingPresentation {
    pub(super) item_id: Option<String>,
    pub(super) footers: Vec<String>,
    pub(super) detailed: bool,
    pub(super) reveal: Cell<bool>,
}

impl PagerOverlay {
    pub(crate) fn set_browsing_prompt(&mut self, item_id: Option<String>, footers: Vec<String>) {
        let reveal = self
            .browsing
            .as_ref()
            .is_none_or(|state| state.item_id != item_id);
        let detailed = self.browsing.as_ref().is_some_and(|state| state.detailed);
        self.browsing = Some(BrowsingPresentation {
            item_id,
            footers,
            detailed,
            reveal: Cell::new(reveal),
        });
    }

    pub(crate) fn toggle_browsing_details(&mut self) {
        if let Some(state) = self.browsing.as_mut() {
            state.detailed = !state.detailed;
        }
    }

    pub(crate) fn clear_browsing(&mut self) {
        self.browsing = None;
    }

    pub(crate) fn has_active_interaction(&self) -> bool {
        self.search.is_active()
            || self.transcript_selection.is_active()
            || self.disclosure.is_focused()
    }
}
