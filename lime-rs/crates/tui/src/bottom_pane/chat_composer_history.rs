//! Shell-style recall and incremental search share one persistent offset cache.
//! Persistent IO is asynchronous through App events and the current App Server history owner.

use super::MentionBinding;
use crate::app_event::AppEvent;
use crate::app_event_sender::AppEventSender;
use crate::bottom_pane::{LocalImageAttachment, RemoteImageAttachment};
use agent_protocol::TextElement;
use std::collections::{HashMap, HashSet};

mod search;
mod search_batch;
use search::HistorySearchState;
pub(super) use search::{HistorySearchDirection, HistorySearchResult};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct HistoryEntry {
    pub(super) text: String,
    pub(super) text_elements: Vec<TextElement>,
    pub(super) local_images: Vec<LocalImageAttachment>,
    pub(super) remote_images: Vec<RemoteImageAttachment>,
    pub(super) pending_pastes: Vec<(String, String)>,
    pub(super) mention_bindings: Vec<MentionBinding>,
}

impl HistoryEntry {
    pub(super) fn new(text: String) -> Self {
        let decoded = crate::mention_codec::decode_history_mentions(&text);
        Self {
            text: decoded.text,
            text_elements: decoded.text_elements,
            local_images: Vec::new(),
            remote_images: Vec::new(),
            pending_pastes: Vec::new(),
            mention_bindings: decoded
                .mentions
                .into_iter()
                .map(|mention| MentionBinding {
                    sigil: mention.sigil,
                    mention: mention.mention,
                    path: mention.path,
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum HistoryEntryResponse {
    Found(HistoryEntry),
    Search(HistorySearchResult),
    Ignored,
}

#[derive(Debug, Default)]
pub(super) struct ChatComposerHistory {
    thread_id: Option<String>,
    persistent_log_id: Option<String>,
    persistent_entry_count: usize,
    local_history: Vec<HistoryEntry>,
    fetched_history: HashMap<usize, Option<HistoryEntry>>,
    history_cursor: Option<usize>,
    pending_navigation_direction: Option<HistorySearchDirection>,
    last_history_text: Option<String>,
    search: Option<HistorySearchState>,
    in_flight_entries: HashSet<usize>,
    in_flight_batches: HashSet<crate::app_event::HistoryBatchCursor>,
}

impl ChatComposerHistory {
    /// Startup-local drafts survive initial configuration; later thread snapshots reset history.
    pub(super) fn set_metadata(&mut self, thread_id: String, log_id: String, entry_count: usize) {
        let had_configured_thread = self.thread_id.replace(thread_id).is_some();
        self.persistent_log_id = Some(log_id);
        self.persistent_entry_count = entry_count;
        self.fetched_history.clear();
        self.in_flight_entries.clear();
        self.in_flight_batches.clear();
        if had_configured_thread {
            self.local_history.clear();
        }
        self.reset_navigation();
    }

    /// Keep thread switching synchronous; a response owned by the previous composer is stale.
    pub(super) fn set_thread_id(&mut self, thread_id: &str) {
        if self
            .thread_id
            .as_deref()
            .is_some_and(|current| current != thread_id)
        {
            self.set_metadata(
                thread_id.to_string(),
                self.persistent_log_id.clone().unwrap_or_default(),
                self.persistent_entry_count,
            );
        }
    }

    pub(super) fn owns_response(&self, thread_id: &str) -> bool {
        self.thread_id.as_deref() == Some(thread_id)
    }

    pub(super) fn record_local_submission(&mut self, entry: HistoryEntry) {
        if entry.text.is_empty()
            && entry.text_elements.is_empty()
            && entry.local_images.is_empty()
            && entry.remote_images.is_empty()
            && entry.pending_pastes.is_empty()
            && entry.mention_bindings.is_empty()
        {
            return;
        }
        self.reset_navigation();
        if self.local_history.last() != Some(&entry) {
            self.local_history.push(entry);
        }
    }

    pub(super) fn is_navigating(&self) -> bool {
        self.history_cursor.is_some()
    }

    pub(super) fn is_empty(&self) -> bool {
        self.total_entries() == 0
    }

    pub(super) fn reset_navigation(&mut self) {
        self.history_cursor = None;
        self.pending_navigation_direction = None;
        self.last_history_text = None;
        self.reset_search();
    }

    pub(super) fn record_recalled_text(&mut self, text: String) {
        self.last_history_text = Some(text);
    }

    pub(super) fn should_handle_navigation(&self, text: &str, cursor: usize) -> bool {
        self.total_entries() > 0
            && (text.is_empty()
                || ((cursor == 0 || cursor == text.len())
                    && self.last_history_text.as_deref() == Some(text)))
    }

    pub(super) fn navigate_up(&mut self, app_event_tx: &AppEventSender) -> Option<HistoryEntry> {
        self.reset_search();
        let index = match self.history_cursor {
            None => self.total_entries().checked_sub(1)?,
            Some(index) => index.checked_sub(1)?,
        };
        self.history_cursor = Some(index);
        self.populate_history_at_index(index, HistorySearchDirection::Older, app_event_tx)
    }

    /// None means pending/boundary; an empty entry means the user moved past the newest entry.
    pub(super) fn navigate_down(&mut self, app_event_tx: &AppEventSender) -> Option<HistoryEntry> {
        self.reset_search();
        let index = self.history_cursor?.checked_add(1)?;
        if index >= self.total_entries() {
            self.reset_navigation();
            return Some(HistoryEntry::new(String::new()));
        }
        self.history_cursor = Some(index);
        self.populate_history_at_index(index, HistorySearchDirection::Newer, app_event_tx)
    }

    pub(super) fn on_entry_response(
        &mut self,
        log_id: &str,
        offset: usize,
        entry: Option<String>,
        app_event_tx: &AppEventSender,
    ) -> HistoryEntryResponse {
        if self.persistent_log_id.as_deref() != Some(log_id)
            || offset >= self.persistent_entry_count
        {
            return HistoryEntryResponse::Ignored;
        }
        self.in_flight_entries.remove(&offset);
        let entry = entry.map(HistoryEntry::new);
        self.fetched_history.insert(offset, entry.clone());
        if let Some(result) = self.resume_search_after_entry(offset, entry.clone(), app_event_tx) {
            return HistoryEntryResponse::Search(result);
        }
        if self.search.is_some()
            || self.history_cursor != Some(offset)
            || self.pending_navigation_direction.is_none()
        {
            return HistoryEntryResponse::Ignored;
        }
        let direction = self
            .pending_navigation_direction
            .take()
            .expect("pending direction");
        if let Some(entry) = entry {
            self.record_recalled_text(entry.text.clone());
            return HistoryEntryResponse::Found(entry);
        }
        let Some(next) = self.next_history_offset(offset, direction) else {
            return HistoryEntryResponse::Ignored;
        };
        self.history_cursor = Some(next);
        self.populate_history_at_index(next, direction, app_event_tx)
            .map(HistoryEntryResponse::Found)
            .unwrap_or(HistoryEntryResponse::Ignored)
    }

    /// IO errors do not poison the shared cache as malformed rows or claim query exhaustion.
    pub(super) fn on_entry_error(&mut self, log_id: &str, offset: usize) -> HistoryEntryResponse {
        if self.persistent_log_id.as_deref() != Some(log_id) {
            return HistoryEntryResponse::Ignored;
        }
        self.in_flight_entries.remove(&offset);
        if self.search_awaits_entry(offset) {
            self.clear_search_awaiting();
            return HistoryEntryResponse::Search(HistorySearchResult::Unavailable);
        }
        if self.history_cursor == Some(offset) {
            self.pending_navigation_direction = None;
        }
        HistoryEntryResponse::Ignored
    }

    fn total_entries(&self) -> usize {
        self.persistent_entry_count + self.local_history.len()
    }

    fn entry_at_cached_offset(&self, offset: usize) -> Option<HistoryEntry> {
        if offset >= self.persistent_entry_count {
            self.local_history
                .get(offset - self.persistent_entry_count)
                .cloned()
        } else {
            self.fetched_history.get(&offset).cloned().flatten()
        }
    }

    fn next_history_offset(
        &self,
        offset: usize,
        direction: HistorySearchDirection,
    ) -> Option<usize> {
        match direction {
            HistorySearchDirection::Older => offset.checked_sub(1),
            HistorySearchDirection::Newer => offset
                .checked_add(1)
                .filter(|next| *next < self.total_entries()),
        }
    }

    fn populate_history_at_index(
        &mut self,
        mut offset: usize,
        direction: HistorySearchDirection,
        app_event_tx: &AppEventSender,
    ) -> Option<HistoryEntry> {
        loop {
            if let Some(entry) = self.entry_at_cached_offset(offset) {
                self.pending_navigation_direction = None;
                self.record_recalled_text(entry.text.clone());
                return Some(entry);
            }
            if self.fetched_history.contains_key(&offset) {
                offset = self.next_history_offset(offset, direction)?;
                self.history_cursor = Some(offset);
                continue;
            }
            self.pending_navigation_direction = Some(direction);
            if !self.request_history_entry(offset, app_event_tx) {
                self.pending_navigation_direction = None;
            }
            return None;
        }
    }

    fn request_history_entry(&mut self, offset: usize, app_event_tx: &AppEventSender) -> bool {
        if self.in_flight_entries.contains(&offset) {
            return true;
        }
        let (Some(thread_id), Some(log_id)) = (&self.thread_id, &self.persistent_log_id) else {
            return false;
        };
        if app_event_tx.send(AppEvent::LookupMessageHistoryEntry {
            thread_id: thread_id.clone(),
            offset,
            log_id: log_id.clone(),
        }) {
            self.in_flight_entries.insert(offset);
            true
        } else {
            false
        }
    }

    /// Complete cache fixture, not a production eager-load API.
    #[cfg(test)]
    pub(super) fn set_cached_entries(&mut self, entries: impl IntoIterator<Item = String>) {
        let entries = entries
            .into_iter()
            .map(HistoryEntry::new)
            .collect::<Vec<_>>();
        self.set_metadata("test-thread".into(), "test-log".into(), entries.len());
        self.fetched_history = entries
            .into_iter()
            .enumerate()
            .map(|(offset, entry)| (offset, Some(entry)))
            .collect();
    }
}

#[cfg(test)]
mod tests;
