//! Typed host events. History IO stays behind the App Server request boundary.

use app_server_protocol::protocol::v2::{ThreadItemsListResponse, Turn};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct HistoryBatchCursor {
    end_offset: usize,
}

impl HistoryBatchCursor {
    pub(crate) fn new(end_offset: usize) -> Self {
        Self { end_offset }
    }

    pub(crate) fn end_offset(self) -> usize {
        self.end_offset
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryBatchEntryResponse {
    pub(crate) offset: usize,
    pub(crate) entry: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OlderHistoryLoadMode {
    OnePage,
    All,
    TopUp,
}

#[derive(Debug)]
pub(crate) enum HistoryLookupResponse {
    Entry {
        offset: usize,
        log_id: String,
        entry: Option<String>,
    },
    EntryError {
        offset: usize,
        log_id: String,
    },
    Batch {
        cursor: HistoryBatchCursor,
        log_id: String,
        entries: Vec<HistoryBatchEntryResponse>,
        next_older_cursor: Option<HistoryBatchCursor>,
    },
    BatchError {
        cursor: HistoryBatchCursor,
        log_id: String,
    },
}

#[derive(Debug)]
pub(crate) enum AppEvent {
    OlderThreadHistoryLoaded {
        thread_id: String,
        cursor: String,
        result: Result<ThreadItemsListResponse, String>,
        turns: Option<Vec<Turn>>,
        mode: OlderHistoryLoadMode,
    },
    LookupMessageHistoryEntry {
        thread_id: String,
        offset: usize,
        log_id: String,
    },
    LookupMessageHistoryBatch {
        thread_id: String,
        cursor: HistoryBatchCursor,
        log_id: String,
    },
    ThreadHistoryEntryResponse {
        thread_id: String,
        event: HistoryLookupResponse,
    },
}
