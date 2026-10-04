//! Shell-style recall and incremental search share one persistent offset cache.
//! Persistent IO is asynchronous through App events and the current App Server history owner.

use super::MentionBinding;
use crate::app_event::AppEvent;
use crate::app_event_sender::AppEventSender;
use crate::bottom_pane::{LocalImageAttachment, RemoteImageAttachment};
use agent_protocol::TextElement;
use app_server_protocol::protocol::v2::{ThreadItem, Turn, UserInput};
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

    /// Lower one canonical user message into the existing composer history shape.
    ///
    /// Replay must preserve the structured input facts that the composer can restore. Review
    /// filtering is intentionally owned by the caller because it requires complete Turn
    /// metadata; this conversion only handles one already-approved UserMessage payload.
    pub(super) fn from_user_inputs(inputs: &[UserInput]) -> Option<Self> {
        let mut text = String::new();
        let mut text_elements = Vec::new();
        let mut local_images = Vec::new();
        let mut remote_images = Vec::new();
        let mut mention_bindings = Vec::new();

        for input in inputs {
            match input {
                UserInput::Text {
                    text: value,
                    text_elements: elements,
                } => {
                    let offset = text.len();
                    text.push_str(value);
                    text_elements.extend(elements.iter().map(|element| {
                        TextElement::new(
                            element.byte_range.start + offset..element.byte_range.end + offset,
                            element.placeholder.clone(),
                        )
                    }));
                }
                UserInput::Image { detail, url } => {
                    remote_images.push(RemoteImageAttachment {
                        url: url.clone(),
                        detail: *detail,
                    });
                }
                UserInput::LocalImage { detail, path } => {
                    let image_number = remote_images.len() + local_images.len() + 1;
                    local_images.push(LocalImageAttachment {
                        placeholder: format!("[Image #{image_number}]"),
                        path: path.clone().into(),
                        detail: *detail,
                    });
                }
                UserInput::Skill { name, path } => mention_bindings.push(MentionBinding {
                    sigil: '$',
                    mention: name.clone(),
                    path: path.clone(),
                }),
                UserInput::Mention { name, path } => mention_bindings.push(MentionBinding {
                    sigil: '@',
                    mention: name.clone(),
                    path: path.clone(),
                }),
            }
        }

        let entry = Self {
            text,
            text_elements,
            local_images,
            remote_images,
            pending_pastes: Vec::new(),
            mention_bindings,
        };
        (!entry.is_empty()).then_some(entry)
    }

    fn is_empty(&self) -> bool {
        self.text.is_empty()
            && self.text_elements.is_empty()
            && self.local_images.is_empty()
            && self.remote_images.is_empty()
            && self.pending_pastes.is_empty()
            && self.mention_bindings.is_empty()
    }
}

pub(super) fn replay_entries_from_turns(turns: &[Turn]) -> Vec<HistoryEntry> {
    let hidden_ids = crate::history_filter::hidden_user_message_ids(turns);
    turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .filter_map(|item| match item {
            ThreadItem::UserMessage { id, content, .. } if !hidden_ids.contains(id) => {
                HistoryEntry::from_user_inputs(content)
            }
            _ => None,
        })
        .collect()
}

pub(super) fn replay_entries_from_items(
    items: &[ThreadItem],
    turns: Option<&[Turn]>,
) -> Vec<HistoryEntry> {
    // A flat paginated page cannot prove nested-review identity. Do not seed it until the
    // optional canonical Turn enrichment is available; rendering may remain item-only, but
    // composer recall must never expose an agent-only review prompt.
    let Some(turns) = turns else {
        return Vec::new();
    };
    let hidden_ids = crate::history_filter::hidden_user_message_ids(turns);
    crate::history_filter::filter_review_mode_items(items)
        .into_iter()
        .filter_map(|item| match item {
            ThreadItem::UserMessage { id, content, .. } if !hidden_ids.contains(&id) => {
                HistoryEntry::from_user_inputs(&content)
            }
            _ => None,
        })
        .collect()
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
    replay_seeded_history: Vec<HistoryEntry>,
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
        let thread_changed = self
            .thread_id
            .as_deref()
            .is_some_and(|current| current != thread_id);
        self.thread_id = Some(thread_id);
        self.persistent_log_id = Some(log_id);
        self.persistent_entry_count = entry_count;
        self.fetched_history.clear();
        self.in_flight_entries.clear();
        self.in_flight_batches.clear();
        if thread_changed {
            self.local_history.clear();
            self.replay_seeded_history.clear();
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
        self.record_local_submission_inner(entry);
    }

    pub(super) fn record_replayed_submission(&mut self, entry: HistoryEntry) {
        if self.record_local_submission_inner(entry.clone()) {
            self.replay_seeded_history.push(entry);
        }
    }

    /// Insert an older paginated replay page before the currently visible replay entries.
    ///
    /// Page responses are delivered newest-first over time, so the page owner must prepend them
    /// to keep Up recall chronological. Exact replay duplicates are ignored to make overlapping
    /// page responses fail closed without collapsing ordinary local submissions.
    pub(super) fn prepend_replayed_submissions(
        &mut self,
        entries: impl IntoIterator<Item = HistoryEntry>,
    ) {
        let mut entries = entries.into_iter().collect::<Vec<_>>();
        entries.reverse();
        for entry in entries {
            if entry.is_empty()
                || self
                    .replay_seeded_history
                    .iter()
                    .any(|existing| existing == &entry)
            {
                continue;
            }
            self.local_history.insert(0, entry.clone());
            self.replay_seeded_history.insert(0, entry);
        }
        self.reset_navigation();
    }

    fn record_local_submission_inner(&mut self, entry: HistoryEntry) -> bool {
        if entry.is_empty() {
            return false;
        }
        self.reset_navigation();
        if self.local_history.last() != Some(&entry) {
            self.local_history.push(entry);
            return true;
        }
        false
    }

    /// Replace replay facts for a hydrated thread while retaining the existing history owner.
    pub(super) fn replace_replayed_history(
        &mut self,
        thread_id: String,
        entries: impl IntoIterator<Item = HistoryEntry>,
    ) {
        self.set_thread_id(&thread_id);
        let previous = std::mem::take(&mut self.replay_seeded_history);
        for entry in previous {
            if let Some(index) = self
                .local_history
                .iter()
                .position(|current| current == &entry)
            {
                self.local_history.remove(index);
            }
        }
        for entry in entries {
            self.record_replayed_submission(entry);
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
            if self.persistent_entry_duplicates_local(&entry) {
                let Some(next) = self.next_history_offset(offset, direction) else {
                    return HistoryEntryResponse::Ignored;
                };
                self.history_cursor = Some(next);
                return self
                    .populate_history_at_index(next, direction, app_event_tx)
                    .map(HistoryEntryResponse::Found)
                    .unwrap_or(HistoryEntryResponse::Ignored);
            }
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
                if offset < self.persistent_entry_count
                    && self.persistent_entry_duplicates_local(&entry)
                {
                    offset = self.next_history_offset(offset, direction)?;
                    self.history_cursor = Some(offset);
                    continue;
                }
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

    fn persistent_entry_duplicates_local(&self, entry: &HistoryEntry) -> bool {
        self.replay_seeded_history.iter().any(|replayed| {
            replayed.text == entry.text && replayed.mention_bindings == entry.mention_bindings
        })
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
