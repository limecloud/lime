use std::{collections::HashSet, io};

use app_server_client::RequestHandle;
#[cfg(test)]
use app_server_protocol::protocol::v2::UserInput;
use app_server_protocol::protocol::v2::{
    ThreadHistoryMode, ThreadItem, ThreadItemsListResponse, ThreadReadParams, ThreadReadResponse,
    Turn, METHOD_THREAD_ITEMS_LIST, METHOD_THREAD_READ,
};

use crate::app_server_session::{
    thread_items_page_params, thread_turns_for_items_with_handle, AppServerSession,
    HISTORY_ITEM_PAGE_LIMIT, HISTORY_ITEM_SCAN_LIMIT,
};
use crate::history_filter::{filter_user_message_ids, hidden_user_message_ids};
use crate::projection::{ConversationProjection, EntryKind};

const MAX_TRANSCRIPT_PREVIEW_LINES: usize = 6;
const TRANSCRIPT_PREVIEW_ITEMS_PAGE_SIZE: u32 = 6;

/// A bounded, display-only transcript line used by the resume picker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TranscriptPreviewLine {
    pub(crate) speaker: TranscriptPreviewSpeaker,
    pub(crate) text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TranscriptPreviewSpeaker {
    User,
    Assistant,
}

/// Load a bounded preview from the canonical App Server thread projection.
#[allow(dead_code)]
pub(crate) async fn load_transcript_preview(
    app_server: &AppServerSession,
    thread_id: &str,
) -> io::Result<Vec<TranscriptPreviewLine>> {
    load_transcript_preview_with_handle(app_server.request_handle(), thread_id.to_string()).await
}

pub(crate) async fn load_transcript_preview_with_handle(
    request_handle: RequestHandle,
    thread_id: String,
) -> io::Result<Vec<TranscriptPreviewLine>> {
    let metadata: ThreadReadResponse = request_handle
        .request(
            METHOD_THREAD_READ,
            ThreadReadParams {
                thread_id: thread_id.clone(),
                include_turns: false,
            },
        )
        .await
        .map_err(io::Error::other)?;

    if metadata.thread.history_mode == ThreadHistoryMode::Paginated {
        return load_paginated_preview(request_handle, thread_id).await;
    }

    let entries =
        crate::thread_transcript::load_session_transcript_with_handle(request_handle, thread_id)
            .await?;
    let entries = entries
        .into_iter()
        .filter_map(|entry| {
            let speaker = match entry.kind {
                crate::projection::EntryKind::User => TranscriptPreviewSpeaker::User,
                crate::projection::EntryKind::Assistant => TranscriptPreviewSpeaker::Assistant,
                _ => return None,
            };
            Some((speaker, entry.text))
        })
        .collect();
    preview_from_entries(entries)
}

async fn load_paginated_preview(
    request_handle: RequestHandle,
    thread_id: String,
) -> io::Result<Vec<TranscriptPreviewLine>> {
    let mut items = Vec::new();
    let mut cursor = None;
    let mut seen_cursors = std::collections::HashSet::new();
    let mut scanned_items = 0_usize;
    let mut turn_ids = HashSet::new();

    loop {
        let remaining_items = HISTORY_ITEM_SCAN_LIMIT.saturating_sub(scanned_items);
        let page_size = if cursor.is_none() {
            TRANSCRIPT_PREVIEW_ITEMS_PAGE_SIZE
        } else {
            HISTORY_ITEM_PAGE_LIMIT
        }
        .min(remaining_items as u32);
        if page_size == 0 {
            break;
        }

        let page: ThreadItemsListResponse = request_handle
            .request(
                METHOD_THREAD_ITEMS_LIST,
                thread_items_page_params(thread_id.clone(), None, cursor.clone(), page_size),
            )
            .await
            .map_err(io::Error::other)?;
        turn_ids.extend(page.data.iter().map(|entry| entry.turn_id.clone()));
        scanned_items = scanned_items.saturating_add(page.data.len());
        let page_items = page
            .data
            .into_iter()
            .take(remaining_items)
            .map(|entry| entry.item)
            .rev()
            .collect::<Vec<_>>();
        items.splice(0..0, page_items);
        if preview_from_items(&items).len() == MAX_TRANSCRIPT_PREVIEW_LINES
            || scanned_items >= HISTORY_ITEM_SCAN_LIMIT
        {
            break;
        }
        let Some(next_cursor) = next_preview_cursor(page.next_cursor, &mut seen_cursors) else {
            break;
        };
        cursor = Some(next_cursor);
    }

    let turns = if turn_ids.is_empty() {
        None
    } else {
        thread_turns_for_items_with_handle(request_handle, thread_id, &turn_ids)
            .await
            .ok()
    };
    Ok(match turns {
        Some(turns) => preview_from_items_with_turns(&items, &turns),
        None => preview_from_items(&items),
    })
}

fn preview_from_items(items: &[ThreadItem]) -> Vec<TranscriptPreviewLine> {
    let mut projection = ConversationProjection::default();
    projection.prepend_items(items.iter().cloned());
    let entries = projection
        .entries()
        .iter()
        .filter_map(|entry| {
            let speaker = match entry.kind {
                EntryKind::User => TranscriptPreviewSpeaker::User,
                EntryKind::Assistant => TranscriptPreviewSpeaker::Assistant,
                _ => return None,
            };
            Some((speaker, entry.text.clone()))
        })
        .collect();
    preview_from_entries(entries).expect("preview projection is infallible")
}

fn preview_from_items_with_turns(
    items: &[ThreadItem],
    turns: &[Turn],
) -> Vec<TranscriptPreviewLine> {
    let hidden_ids = hidden_user_message_ids(turns);
    let visible_items = filter_user_message_ids(items, &hidden_ids);
    preview_from_items(&visible_items)
}

fn next_preview_cursor(
    next_cursor: Option<String>,
    seen_cursors: &mut std::collections::HashSet<String>,
) -> Option<String> {
    next_cursor.filter(|next| seen_cursors.insert(next.clone()))
}

pub(crate) fn preview_from_entries(
    entries: Vec<(TranscriptPreviewSpeaker, String)>,
) -> io::Result<Vec<TranscriptPreviewLine>> {
    let mut lines = Vec::with_capacity(MAX_TRANSCRIPT_PREVIEW_LINES);
    for (speaker, text) in entries.into_iter().rev() {
        for text in text.lines().rev() {
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            lines.push(TranscriptPreviewLine {
                speaker,
                text: text.to_string(),
            });
            if lines.len() == MAX_TRANSCRIPT_PREVIEW_LINES {
                break;
            }
        }
        if lines.len() == MAX_TRANSCRIPT_PREVIEW_LINES {
            break;
        }
    }

    lines.reverse();
    Ok(lines)
}

#[cfg(test)]
#[path = "resume_picker_transcript_preview_tests.rs"]
mod tests;
