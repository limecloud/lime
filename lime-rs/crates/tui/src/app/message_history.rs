//! History lookup host: typed events -> cloned App Server request handle -> composer response.
//! The terminal event loop never waits for history disk/network IO.

use anyhow::{bail, Context, Result};
use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    PromptHistoryReadParams, PromptHistoryReadResponse, METHOD_PROMPT_HISTORY_READ,
};
use tokio::task::JoinSet;

use super::App;
use crate::app_event::{
    AppEvent, HistoryBatchCursor, HistoryBatchEntryResponse, HistoryLookupResponse,
};
use crate::app_event_sender::AppEventSender;

const HISTORY_BATCH_SIZE: usize = 100;

#[derive(Default)]
pub(crate) struct MessageHistory {
    lookups: JoinSet<()>,
}

impl MessageHistory {
    pub(crate) fn handle_event(
        &mut self,
        event: AppEvent,
        app: &mut App,
        request_handle: Option<RequestHandle>,
        app_event_tx: &AppEventSender,
    ) {
        while self.lookups.try_join_next().is_some() {}
        let (thread_id, cursor, log_id, single_entry) = match event {
            AppEvent::OlderThreadHistoryLoaded { .. } => return,
            AppEvent::ThreadHistoryEntryResponse {
                thread_id,
                event: response,
            } => {
                app.chat_widget
                    .bottom_pane
                    .on_history_lookup_response(&thread_id, response);
                return;
            }
            AppEvent::LookupMessageHistoryEntry {
                thread_id,
                offset,
                log_id,
            } => (thread_id, HistoryBatchCursor::new(offset), log_id, true),
            AppEvent::LookupMessageHistoryBatch {
                thread_id,
                cursor,
                log_id,
            } => (thread_id, cursor, log_id, false),
        };
        let tx = app_event_tx.clone();
        self.lookups.spawn(async move {
            let response =
                lookup_message_history(request_handle, cursor, &log_id, single_entry).await;
            tx.send(AppEvent::ThreadHistoryEntryResponse {
                thread_id,
                event: response,
            });
        });
    }
}

async fn lookup_message_history(
    request_handle: Option<RequestHandle>,
    cursor: HistoryBatchCursor,
    log_id: &str,
    single_entry: bool,
) -> HistoryLookupResponse {
    let limit = if single_entry { 1 } else { HISTORY_BATCH_SIZE };
    let result = read_history_batch(request_handle, cursor, log_id, limit).await;
    match result {
        Ok((mut entries, _)) if single_entry => HistoryLookupResponse::Entry {
            offset: cursor.end_offset(),
            log_id: log_id.into(),
            entry: entries.pop().and_then(|entry| entry.entry),
        },
        Ok((entries, next_older_cursor)) => HistoryLookupResponse::Batch {
            cursor,
            log_id: log_id.into(),
            entries,
            next_older_cursor,
        },
        Err(error) => {
            // Never log prompt text or credential-bearing transport details.
            tracing::warn!(%error, "message history lookup unavailable");
            if single_entry {
                HistoryLookupResponse::EntryError {
                    offset: cursor.end_offset(),
                    log_id: log_id.into(),
                }
            } else {
                HistoryLookupResponse::BatchError {
                    cursor,
                    log_id: log_id.into(),
                }
            }
        }
    }
}

async fn read_history_batch(
    request_handle: Option<RequestHandle>,
    cursor: HistoryBatchCursor,
    log_id: &str,
    limit: usize,
) -> Result<(Vec<HistoryBatchEntryResponse>, Option<HistoryBatchCursor>)> {
    let request_handle = request_handle.context("App Server history transport disconnected")?;
    let end = cursor
        .end_offset()
        .checked_add(1)
        .context("history offset overflow")?;
    let page: PromptHistoryReadResponse = request_handle
        .request(
            METHOD_PROMPT_HISTORY_READ,
            PromptHistoryReadParams {
                cursor: Some(end.to_string()),
                limit: Some(limit as u32),
                log_id: Some(log_id.into()),
            },
        )
        .await
        .context("App Server history read failed")?;
    lower_history_page(page, end, limit, log_id)
}

/// Public cursors are exclusive end offsets. Missing rows remain cached malformed offsets.
fn lower_history_page(
    page: PromptHistoryReadResponse,
    end: usize,
    limit: usize,
    log_id: &str,
) -> Result<(Vec<HistoryBatchEntryResponse>, Option<HistoryBatchCursor>)> {
    if page.log_id != log_id {
        bail!("history log changed");
    }
    if page.entry_count < end as u64 {
        bail!("history snapshot truncated");
    }
    let start = end.saturating_sub(limit);
    let next_end = page
        .next_cursor
        .as_deref()
        .map(str::parse::<usize>)
        .transpose()
        .context("invalid history cursor")?;
    if next_end != (start > 0).then_some(start) {
        bail!("history page did not advance by the bounded row range");
    }
    let mut entries = (start..end)
        .rev()
        .map(|offset| HistoryBatchEntryResponse {
            offset,
            entry: None,
        })
        .collect::<Vec<_>>();
    let mut previous_offset = end;
    for entry in page.data {
        let offset = usize::try_from(entry.offset).context("history offset exceeds host range")?;
        if offset < start || offset >= previous_offset {
            bail!("history page offsets out of order or range");
        }
        previous_offset = offset;
        entries[end - offset - 1].entry = Some(entry.text);
    }
    Ok((
        entries,
        next_end
            .and_then(|end| end.checked_sub(1))
            .map(HistoryBatchCursor::new),
    ))
}

#[cfg(test)]
#[path = "message_history_tests.rs"]
mod tests;
