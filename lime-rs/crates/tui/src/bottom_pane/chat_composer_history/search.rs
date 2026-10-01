//! Unique incremental traversal. Only awaited responses may resume the active query.

use super::{ChatComposerHistory, HistoryEntry};
use crate::app_event::HistoryBatchCursor;
use crate::app_event_sender::AppEventSender;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::bottom_pane) enum HistorySearchDirection {
    Older,
    Newer,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::bottom_pane) enum HistorySearchResult {
    Found(HistoryEntry),
    Pending,
    AtBoundary,
    NotFound,
    Unavailable,
}

#[derive(Debug)]
pub(super) struct HistorySearchState {
    query: String,
    query_lower: String,
    selected_offset: Option<usize>,
    unique_matches: Vec<UniqueHistoryMatch>,
    selected_match_index: Option<usize>,
    seen_texts: HashSet<String>,
    pub(super) awaiting: Option<PendingHistorySearch>,
    pub(super) next_older_cursor: Option<HistoryBatchCursor>,
    exhausted_older: bool,
    exhausted_newer: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PendingHistorySearch {
    Entry {
        offset: usize,
        direction: HistorySearchDirection,
        boundary_if_exhausted: bool,
    },
    Batch {
        cursor: HistoryBatchCursor,
        boundary_if_exhausted: bool,
        read_failures: u8,
    },
}

#[derive(Clone, Debug)]
struct UniqueHistoryMatch {
    offset: usize,
    entry: HistoryEntry,
}

impl ChatComposerHistory {
    pub(in crate::bottom_pane) fn reset_search(&mut self) {
        self.search = None;
    }

    pub(in crate::bottom_pane) fn search(
        &mut self,
        query: &str,
        direction: HistorySearchDirection,
        restart: bool,
        app_event_tx: &AppEventSender,
    ) -> HistorySearchResult {
        let query_changed = self
            .search
            .as_ref()
            .is_none_or(|search| search.query != query);
        if !query_changed
            && !restart
            && self
                .search
                .as_ref()
                .is_some_and(|search| search.awaiting.is_some())
        {
            return HistorySearchResult::Pending;
        }
        let restart = restart || query_changed;
        if restart {
            self.search = Some(HistorySearchState::new(query));
        } else if let Some(result) = self.select_cached_unique_match(direction) {
            return result;
        }
        let search = self.search.as_ref().expect("search initialized");
        let boundary_if_exhausted = !restart && search.selected_offset.is_some();
        if boundary_if_exhausted && search.is_exhausted(direction) {
            return HistorySearchResult::AtBoundary;
        }
        let offset = if restart {
            match direction {
                HistorySearchDirection::Older => self.total_entries().checked_sub(1),
                HistorySearchDirection::Newer => (self.total_entries() > 0).then_some(0),
            }
        } else {
            search
                .selected_offset
                .and_then(|offset| self.next_history_offset(offset, direction))
        };
        match offset {
            Some(offset) => {
                self.advance_search_from(offset, direction, boundary_if_exhausted, app_event_tx)
            }
            None => self.exhausted_search_result(direction, boundary_if_exhausted),
        }
    }

    fn advance_search_from(
        &mut self,
        mut offset: usize,
        direction: HistorySearchDirection,
        boundary_if_exhausted: bool,
        app_event_tx: &AppEventSender,
    ) -> HistorySearchResult {
        loop {
            if let Some(entry) = self.entry_at_cached_offset(offset) {
                if self.search_matches(&entry) && self.search_result_is_unique(&entry) {
                    return self.search_match(offset, entry);
                }
            } else if offset < self.persistent_entry_count
                && !self.fetched_history.contains_key(&offset)
            {
                if direction == HistorySearchDirection::Older {
                    if let Some(cursor) = self
                        .search
                        .as_ref()
                        .and_then(|search| search.next_older_cursor)
                        .filter(|cursor| cursor.end_offset() == offset)
                    {
                        return self.request_older_search_batch(
                            cursor,
                            boundary_if_exhausted,
                            app_event_tx,
                        );
                    }
                }
                if self.request_history_entry(offset, app_event_tx) {
                    self.search.as_mut().expect("active query").awaiting =
                        Some(PendingHistorySearch::Entry {
                            offset,
                            direction,
                            boundary_if_exhausted,
                        });
                    return HistorySearchResult::Pending;
                }
                return HistorySearchResult::Unavailable;
            }
            let Some(next) = self.next_history_offset(offset, direction) else {
                return self.exhausted_search_result(direction, boundary_if_exhausted);
            };
            offset = next;
        }
    }

    pub(super) fn search_awaits_entry(&self, offset: usize) -> bool {
        matches!(self.search.as_ref().and_then(|search| search.awaiting),
            Some(PendingHistorySearch::Entry { offset: awaited, .. }) if awaited == offset)
    }

    pub(super) fn clear_search_awaiting(&mut self) {
        if let Some(search) = self.search.as_mut() {
            search.awaiting = None;
        }
    }

    pub(super) fn resume_search_after_entry(
        &mut self,
        offset: usize,
        entry: Option<HistoryEntry>,
        app_event_tx: &AppEventSender,
    ) -> Option<HistorySearchResult> {
        let PendingHistorySearch::Entry {
            offset: awaited,
            direction,
            boundary_if_exhausted,
        } = self.search.as_ref()?.awaiting?
        else {
            return None;
        };
        if awaited != offset {
            return None;
        }
        self.clear_search_awaiting();
        if let Some(entry) =
            entry.filter(|entry| self.search_matches(entry) && self.search_result_is_unique(entry))
        {
            return Some(self.search_match(offset, entry));
        }
        Some(match direction {
            HistorySearchDirection::Older => self.advance_older_search_after_entry_miss(
                offset,
                boundary_if_exhausted,
                app_event_tx,
            ),
            HistorySearchDirection::Newer => match self.next_history_offset(offset, direction) {
                Some(next) => {
                    self.advance_search_from(next, direction, boundary_if_exhausted, app_event_tx)
                }
                None => self.exhausted_search_result(direction, boundary_if_exhausted),
            },
        })
    }

    pub(super) fn search_matches(&self, entry: &HistoryEntry) -> bool {
        self.search.as_ref().is_some_and(|search| {
            search.query.is_empty() || entry.text.to_lowercase().contains(&search.query_lower)
        })
    }

    pub(super) fn search_result_is_unique(&self, entry: &HistoryEntry) -> bool {
        self.search
            .as_ref()
            .is_none_or(|search| !search.seen_texts.contains(&entry.text))
    }

    pub(super) fn search_match(
        &mut self,
        offset: usize,
        entry: HistoryEntry,
    ) -> HistorySearchResult {
        self.history_cursor = Some(offset);
        self.pending_navigation_direction = None;
        self.record_recalled_text(entry.text.clone());
        self.search
            .as_mut()
            .expect("active query")
            .record_match(offset, &entry);
        HistorySearchResult::Found(entry)
    }

    fn select_cached_unique_match(
        &mut self,
        direction: HistorySearchDirection,
    ) -> Option<HistorySearchResult> {
        let search = self.search.as_ref()?;
        let selected = search.selected_match_index?;
        let next = match direction {
            HistorySearchDirection::Older => {
                (selected + 1 < search.unique_matches.len()).then_some(selected + 1)?
            }
            HistorySearchDirection::Newer => selected.checked_sub(1)?,
        };
        let history_match = search.unique_matches[next].clone();
        self.search.as_mut()?.select_match(next);
        self.history_cursor = Some(history_match.offset);
        self.record_recalled_text(history_match.entry.text.clone());
        Some(HistorySearchResult::Found(history_match.entry))
    }

    pub(super) fn exhausted_search_result(
        &mut self,
        direction: HistorySearchDirection,
        boundary_if_exhausted: bool,
    ) -> HistorySearchResult {
        if let Some(search) = self.search.as_mut() {
            search.awaiting = None;
            search.mark_exhausted(direction);
        }
        if boundary_if_exhausted {
            HistorySearchResult::AtBoundary
        } else {
            HistorySearchResult::NotFound
        }
    }
}

impl HistorySearchState {
    fn new(query: &str) -> Self {
        Self {
            query: query.into(),
            query_lower: query.to_lowercase(),
            selected_offset: None,
            unique_matches: Vec::new(),
            selected_match_index: None,
            seen_texts: HashSet::new(),
            awaiting: None,
            next_older_cursor: None,
            exhausted_older: false,
            exhausted_newer: false,
        }
    }

    fn is_exhausted(&self, direction: HistorySearchDirection) -> bool {
        match direction {
            HistorySearchDirection::Older => self.exhausted_older,
            HistorySearchDirection::Newer => self.exhausted_newer,
        }
    }

    fn mark_exhausted(&mut self, direction: HistorySearchDirection) {
        match direction {
            HistorySearchDirection::Older => self.exhausted_older = true,
            HistorySearchDirection::Newer => self.exhausted_newer = true,
        }
    }

    fn record_match(&mut self, offset: usize, entry: &HistoryEntry) {
        self.seen_texts.insert(entry.text.clone());
        let index = self
            .unique_matches
            .partition_point(|history_match| history_match.offset > offset);
        self.unique_matches.insert(
            index,
            UniqueHistoryMatch {
                offset,
                entry: entry.clone(),
            },
        );
        self.select_match(index);
    }

    fn select_match(&mut self, index: usize) {
        self.selected_match_index = Some(index);
        self.selected_offset = Some(self.unique_matches[index].offset);
        self.awaiting = None;
        self.exhausted_older = false;
        self.exhausted_newer = false;
    }
}

#[cfg(test)]
#[path = "search_tests.rs"]
mod tests;
