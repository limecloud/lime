//! Query-independent bounded batches share the recall cache, even after query cancellation.

use super::search::PendingHistorySearch;
use super::{ChatComposerHistory, HistoryEntry, HistorySearchDirection, HistorySearchResult};
use crate::app_event::{AppEvent, HistoryBatchCursor, HistoryBatchEntryResponse};
use crate::app_event_sender::AppEventSender;

const MAX_BATCH_READ_RETRIES: u8 = 2;

impl ChatComposerHistory {
    pub(in crate::bottom_pane) fn on_batch_response(
        &mut self,
        log_id: &str,
        cursor: HistoryBatchCursor,
        entries: Vec<HistoryBatchEntryResponse>,
        next_older_cursor: Option<HistoryBatchCursor>,
        app_event_tx: &AppEventSender,
    ) -> Option<HistorySearchResult> {
        if self.persistent_log_id.as_deref() != Some(log_id) {
            return None;
        }
        self.in_flight_batches.remove(&cursor);
        let entries = entries
            .into_iter()
            .filter(|response| response.offset < self.persistent_entry_count)
            .map(|response| {
                let entry = response.entry.map(HistoryEntry::new);
                if entry.is_some() {
                    self.fetched_history.insert(response.offset, entry.clone());
                } else {
                    self.fetched_history.entry(response.offset).or_insert(None);
                }
                (response.offset, entry)
            })
            .collect::<Vec<_>>();
        let (boundary_if_exhausted, _) = self.pending_batch(cursor)?;
        self.search.as_mut()?.next_older_cursor = next_older_cursor;
        self.clear_search_awaiting();
        for (offset, entry) in entries {
            if let Some(entry) = entry
                .filter(|entry| self.search_matches(entry) && self.search_result_is_unique(entry))
            {
                return Some(self.search_match(offset, entry));
            }
        }
        Some(match next_older_cursor {
            Some(next) => self.advance_older_search_with_batches_from(
                next,
                boundary_if_exhausted,
                app_event_tx,
            ),
            None => {
                self.exhausted_search_result(HistorySearchDirection::Older, boundary_if_exhausted)
            }
        })
    }

    pub(in crate::bottom_pane) fn on_batch_error(
        &mut self,
        log_id: &str,
        cursor: HistoryBatchCursor,
        app_event_tx: &AppEventSender,
    ) -> Option<HistorySearchResult> {
        if self.persistent_log_id.as_deref() != Some(log_id) {
            return None;
        }
        self.in_flight_batches.remove(&cursor);
        let (boundary_if_exhausted, read_failures) = self.pending_batch(cursor)?;
        if read_failures < MAX_BATCH_READ_RETRIES && self.send_batch_lookup(cursor, app_event_tx) {
            self.search.as_mut()?.awaiting = Some(PendingHistorySearch::Batch {
                cursor,
                boundary_if_exhausted,
                read_failures: read_failures + 1,
            });
            return Some(HistorySearchResult::Pending);
        }
        self.clear_search_awaiting();
        Some(if boundary_if_exhausted {
            HistorySearchResult::AtBoundary
        } else {
            self.search = None;
            HistorySearchResult::Unavailable
        })
    }

    fn pending_batch(&self, cursor: HistoryBatchCursor) -> Option<(bool, u8)> {
        let Some(PendingHistorySearch::Batch {
            cursor: awaited,
            boundary_if_exhausted,
            read_failures,
        }) = self.search.as_ref().and_then(|search| search.awaiting)
        else {
            return None;
        };
        (awaited == cursor).then_some((boundary_if_exhausted, read_failures))
    }

    pub(super) fn advance_older_search_after_entry_miss(
        &mut self,
        offset: usize,
        boundary_if_exhausted: bool,
        app_event_tx: &AppEventSender,
    ) -> HistorySearchResult {
        let Some(next) = offset.checked_sub(1) else {
            return self
                .exhausted_search_result(HistorySearchDirection::Older, boundary_if_exhausted);
        };
        self.advance_older_search_with_batches_from(
            HistoryBatchCursor::new(next),
            boundary_if_exhausted,
            app_event_tx,
        )
    }

    fn advance_older_search_with_batches_from(
        &mut self,
        cursor: HistoryBatchCursor,
        boundary_if_exhausted: bool,
        app_event_tx: &AppEventSender,
    ) -> HistorySearchResult {
        let mut offset = cursor.end_offset();
        loop {
            if let Some(entry) = self.entry_at_cached_offset(offset) {
                if self.search_matches(&entry) && self.search_result_is_unique(&entry) {
                    return self.search_match(offset, entry);
                }
            } else if offset < self.persistent_entry_count
                && !self.fetched_history.contains_key(&offset)
            {
                return self.request_older_search_batch(
                    HistoryBatchCursor::new(offset),
                    boundary_if_exhausted,
                    app_event_tx,
                );
            }
            let Some(next) = offset.checked_sub(1) else {
                return self
                    .exhausted_search_result(HistorySearchDirection::Older, boundary_if_exhausted);
            };
            offset = next;
        }
    }

    pub(super) fn request_older_search_batch(
        &mut self,
        cursor: HistoryBatchCursor,
        boundary_if_exhausted: bool,
        app_event_tx: &AppEventSender,
    ) -> HistorySearchResult {
        if !self.send_batch_lookup(cursor, app_event_tx) {
            return HistorySearchResult::Unavailable;
        }
        self.search.as_mut().expect("active query").awaiting = Some(PendingHistorySearch::Batch {
            cursor,
            boundary_if_exhausted,
            read_failures: 0,
        });
        HistorySearchResult::Pending
    }

    fn send_batch_lookup(
        &mut self,
        cursor: HistoryBatchCursor,
        app_event_tx: &AppEventSender,
    ) -> bool {
        if self.in_flight_batches.contains(&cursor) {
            return true;
        }
        let (Some(thread_id), Some(log_id)) = (&self.thread_id, &self.persistent_log_id) else {
            return false;
        };
        if app_event_tx.send(AppEvent::LookupMessageHistoryBatch {
            thread_id: thread_id.clone(),
            cursor,
            log_id: log_id.clone(),
        }) {
            self.in_flight_batches.insert(cursor);
            true
        } else {
            false
        }
    }
}
