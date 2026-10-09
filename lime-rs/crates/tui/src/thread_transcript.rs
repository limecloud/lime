//! Canonical persisted thread transcript projection for TUI resume/preview.
//!
//! Codex keeps this owner separate from the interactive chat widget. Lime does
//! the same, but its only source is App Server's v2 `Thread/Turn/Item` model;
//! no rollout files or private local history database are consulted.

use std::io;

use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    SortDirection, Thread, ThreadItemEntry, ThreadItemsListResponse, ThreadReadParams,
    ThreadReadResponse, ThreadTurnsListParams, ThreadTurnsListResponse, Turn, TurnItemsView,
    METHOD_THREAD_ITEMS_LIST, METHOD_THREAD_READ, METHOD_THREAD_TURNS_LIST,
};

use crate::app_server_session::thread_items_page_params;
use crate::projection::{ConversationProjection, TranscriptEntry};

pub(crate) async fn load_session_transcript(
    request_handle: RequestHandle,
    thread_id: impl Into<String>,
    show_raw_agent_reasoning: bool,
) -> io::Result<Vec<TranscriptEntry>> {
    let thread_id = thread_id.into();
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

    if metadata.thread.id != thread_id {
        return Err(io::ErrorKind::InvalidData.into());
    }

    let turns = load_paginated_turns(request_handle.clone(), thread_id.clone()).await?;
    let items = load_paginated_items(request_handle, thread_id).await?;
    let thread = hydrate_paginated_thread(&metadata.thread, turns, &items)
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidData))?;
    Ok(thread_to_transcript_entries(
        thread,
        show_raw_agent_reasoning,
    ))
}

async fn load_paginated_items(
    request_handle: RequestHandle,
    thread_id: String,
) -> io::Result<Vec<ThreadItemEntry>> {
    let mut cursor = None;
    let mut seen_cursors = std::collections::HashSet::new();
    let mut items = Vec::new();

    loop {
        let response: ThreadItemsListResponse = request_handle
            .request(
                METHOD_THREAD_ITEMS_LIST,
                thread_items_page_params(
                    thread_id.clone(),
                    None,
                    cursor.clone(),
                    crate::app_server_session::HISTORY_ITEM_PAGE_LIMIT,
                ),
            )
            .await
            .map_err(io::Error::other)?;

        let page_items = response.data.into_iter().rev().collect::<Vec<_>>();
        prepend_page_entries(&mut items, page_items);

        let Some(next_cursor) = next_transcript_cursor(response.next_cursor, &mut seen_cursors)?
        else {
            break;
        };
        cursor = Some(next_cursor);
    }

    Ok(items)
}

async fn load_paginated_turns(
    request_handle: RequestHandle,
    thread_id: String,
) -> io::Result<Vec<Turn>> {
    let mut cursor = None;
    let mut seen_cursors = std::collections::HashSet::new();
    let mut turns = Vec::new();

    loop {
        let response: ThreadTurnsListResponse = request_handle
            .request(
                METHOD_THREAD_TURNS_LIST,
                ThreadTurnsListParams {
                    thread_id: thread_id.clone(),
                    cursor: cursor.clone(),
                    limit: Some(crate::app_server_session::HISTORY_ITEM_PAGE_LIMIT),
                    sort_direction: Some(SortDirection::Desc),
                    items_view: Some(TurnItemsView::NotLoaded),
                },
            )
            .await
            .map_err(io::Error::other)?;

        let page_turns = response.data.into_iter().rev().collect::<Vec<_>>();
        prepend_page_turns(&mut turns, page_turns);

        let Some(next_cursor) = next_transcript_cursor(response.next_cursor, &mut seen_cursors)?
        else {
            break;
        };
        cursor = Some(next_cursor);
    }

    Ok(turns)
}

fn next_transcript_cursor(
    next_cursor: Option<String>,
    seen_cursors: &mut std::collections::HashSet<String>,
) -> io::Result<Option<String>> {
    let Some(next_cursor) = next_cursor else {
        return Ok(None);
    };
    if !seen_cursors.insert(next_cursor.clone()) {
        return Err(io::Error::other(format!(
            "thread items pagination repeated cursor {next_cursor}"
        )));
    }
    Ok(Some(next_cursor))
}

fn prepend_page_entries(items: &mut Vec<ThreadItemEntry>, page_items: Vec<ThreadItemEntry>) {
    if page_items.is_empty() {
        return;
    }
    items.splice(0..0, page_items);
}

fn prepend_page_turns(turns: &mut Vec<Turn>, page_turns: Vec<Turn>) {
    if page_turns.is_empty() {
        return;
    }
    turns.splice(0..0, page_turns);
}

fn hydrate_paginated_thread(
    metadata: &Thread,
    turns: Vec<Turn>,
    items: &[ThreadItemEntry],
) -> Option<Thread> {
    if items
        .iter()
        .any(|entry| !turns.iter().any(|turn| turn.id == entry.turn_id))
    {
        return None;
    }

    let mut thread = metadata.clone();
    let mut turns = turns;
    for turn in &mut turns {
        turn.items.clear();
        turn.items_view = TurnItemsView::Full;
    }
    for entry in items {
        turns
            .iter_mut()
            .find(|turn| turn.id == entry.turn_id)
            .expect("turn id checked before hydration")
            .items
            .push(entry.item.clone());
    }
    thread.turns = turns;
    Some(thread)
}

pub(crate) fn thread_to_transcript_entries(
    thread: Thread,
    show_raw_agent_reasoning: bool,
) -> Vec<TranscriptEntry> {
    let mut projection = ConversationProjection::default();
    projection.set_show_raw_agent_reasoning(show_raw_agent_reasoning);
    projection.hydrate_thread(thread);
    projection.entries().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{
        SessionSource, ThreadActiveFlag, ThreadHistoryMode, ThreadItem, ThreadStatus, Turn,
        TurnStatus,
    };
    use std::path::PathBuf;

    fn thread(items: Vec<ThreadItem>) -> Thread {
        Thread {
            id: "thread-1".into(),
            extra: None,
            session_id: "session-1".into(),
            forked_from_id: None,
            parent_thread_id: None,
            preview: "preview".into(),
            ephemeral: false,
            section: None,
            section_entered_at: None,
            project_id: None,
            history_mode: ThreadHistoryMode::default(),
            model_provider: "fixture".into(),
            created_at: 1,
            updated_at: 1,
            recency_at: None,
            status: ThreadStatus::Active {
                active_flags: vec![ThreadActiveFlag::WaitingOnUserInput],
            },
            path: None,
            cwd: PathBuf::from("/workspace"),
            cli_version: "test".into(),
            source: SessionSource::Cli,
            can_accept_direct_input: Some(true),
            thread_source: None,
            agent_nickname: None,
            agent_role: None,
            git_info: None,
            name: None,
            turns: vec![Turn {
                id: "turn-1".into(),
                status: TurnStatus::Completed,
                error: None,
                items,
                items_view: Default::default(),
                started_at: None,
                completed_at: None,
                duration_ms: None,
            }],
        }
    }

    #[test]
    fn persisted_items_share_the_live_projection_shape() {
        let entries = thread_to_transcript_entries(
            thread(vec![ThreadItem::AgentMessage {
                id: "assistant-1".into(),
                metadata: None,
                text: "done".into(),
                phase: None,
                memory_citation: None,
                delivery: None,
            }]),
            false,
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "assistant-1");
        assert_eq!(entries[0].text, "done");
    }

    #[test]
    fn empty_threads_produce_an_empty_canonical_transcript() {
        assert!(thread_to_transcript_entries(thread(Vec::new()), false).is_empty());
    }

    #[test]
    fn paginated_pages_are_reassembled_in_transcript_order() {
        let entry = |id| ThreadItemEntry {
            turn_id: "turn-1".into(),
            item: agent_message(id),
        };
        let mut items = Vec::new();
        prepend_page_entries(&mut items, vec![entry("middle"), entry("newest")]);
        prepend_page_entries(&mut items, vec![entry("oldest"), entry("older")]);

        let ids = items
            .into_iter()
            .map(|entry| match entry.item {
                ThreadItem::AgentMessage { id, .. } => id,
                item => panic!("unexpected item: {item:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["oldest", "older", "middle", "newest"]);
    }

    #[test]
    fn paginated_items_restore_turn_status_for_nested_review_filtering() {
        let entered = ThreadItem::EnteredReviewMode {
            id: "review-enter".to_string(),
            metadata: None,
            review: "review".to_string(),
        };
        let exited = ThreadItem::ExitedReviewMode {
            id: "review-exit".to_string(),
            metadata: None,
            review: "review".to_string(),
        };
        let user = |id: &str| ThreadItem::UserMessage {
            id: id.to_string(),
            metadata: None,
            client_id: None,
            content: vec![app_server_protocol::protocol::v2::UserInput::Text {
                text: "duplicate review prompt".to_string(),
                text_elements: Vec::new(),
            }],
        };
        let previous = Turn {
            id: "review-turn".to_string(),
            status: TurnStatus::Completed,
            error: None,
            items: Vec::new(),
            items_view: TurnItemsView::NotLoaded,
            started_at: Some(1),
            completed_at: Some(2),
            duration_ms: Some(1),
        };
        let current = Turn {
            id: "nested-turn".to_string(),
            status: TurnStatus::Interrupted,
            error: None,
            items: Vec::new(),
            items_view: TurnItemsView::NotLoaded,
            started_at: Some(3),
            completed_at: None,
            duration_ms: None,
        };
        let items = vec![
            ThreadItemEntry {
                turn_id: "review-turn".to_string(),
                item: entered,
            },
            ThreadItemEntry {
                turn_id: "review-turn".to_string(),
                item: exited,
            },
            ThreadItemEntry {
                turn_id: "nested-turn".to_string(),
                item: user("nested-one"),
            },
            ThreadItemEntry {
                turn_id: "nested-turn".to_string(),
                item: user("nested-two"),
            },
        ];

        let mut metadata = thread(Vec::new());
        metadata.history_mode = ThreadHistoryMode::Paginated;
        let hydrated = hydrate_paginated_thread(&metadata, vec![previous, current], &items)
            .expect("all item turn ids should resolve");
        let entries = thread_to_transcript_entries(hydrated, false);

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.text.as_str())
                .collect::<Vec<_>>(),
            vec!["review started: review", "review completed: review"]
        );
    }

    #[test]
    fn paginated_hydration_fails_closed_when_item_turn_metadata_is_missing() {
        let item = ThreadItemEntry {
            turn_id: "unknown-turn".to_string(),
            item: agent_message("orphaned-item"),
        };
        assert!(hydrate_paginated_thread(&thread(Vec::new()), Vec::new(), &[item]).is_none());
    }

    #[test]
    fn paginated_loader_fails_closed_on_a_repeated_cursor() {
        let mut seen = std::collections::HashSet::from([String::from("head")]);
        assert!(next_transcript_cursor(Some(String::from("tail")), &mut seen).is_ok());
        let error = next_transcript_cursor(Some(String::from("tail")), &mut seen)
            .expect_err("repeated cursor must fail closed");
        assert!(error.to_string().contains("repeated cursor tail"));
    }

    fn agent_message(id: &str) -> ThreadItem {
        ThreadItem::AgentMessage {
            id: id.to_string(),
            metadata: None,
            text: id.to_string(),
            phase: None,
            memory_citation: None,
            delivery: None,
        }
    }
}
