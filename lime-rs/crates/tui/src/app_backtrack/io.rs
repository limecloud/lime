//! Previous-prompt reads and mutation use cloned current App Server request handles.

use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    ThreadRevertParams, ThreadRevertResponse, ThreadTurnsListResponse, Turn, METHOD_THREAD_REVERT,
};
use tokio::task::JoinHandle;

use super::BacktrackSelection;
use crate::app_event::{AppEvent, BacktrackEvent};
use crate::app_event_sender::AppEventSender;
use crate::app_server_session::thread_turns_page_with_handle;

#[derive(Debug)]
pub(crate) struct BacktrackPage {
    pub(crate) page: ThreadTurnsListResponse,
    /// Adjacent older Turn metadata proves nested-review filtering across page boundaries.
    pub(crate) context: Vec<Turn>,
}

pub(super) fn spawn_history_load(
    handle: RequestHandle,
    tx: AppEventSender,
    thread_id: String,
    generation: u64,
    cursor: Option<String>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let result = load_history(handle, &thread_id, cursor.clone())
            .await
            .map_err(|error| error.to_string());
        tx.send(AppEvent::Backtrack(BacktrackEvent::HistoryLoaded {
            thread_id,
            generation,
            cursor,
            result,
        }));
    })
}

async fn load_history(
    handle: RequestHandle,
    thread_id: &str,
    cursor: Option<String>,
) -> anyhow::Result<BacktrackPage> {
    let page = thread_turns_page_with_handle(handle.clone(), thread_id, cursor).await?;
    let mut context = page.data.clone();
    if let Some(cursor) = page.next_cursor.clone() {
        let older = thread_turns_page_with_handle(handle, thread_id, Some(cursor)).await?;
        context.extend(older.data.into_iter().take(1));
    }
    context.reverse();
    Ok(BacktrackPage { page, context })
}

pub(super) fn spawn_revert(
    handle: RequestHandle,
    tx: AppEventSender,
    generation: u64,
    selection: BacktrackSelection,
) {
    tokio::spawn(async move {
        let result: Result<ThreadRevertResponse, _> = handle
            .request(
                METHOD_THREAD_REVERT,
                ThreadRevertParams {
                    thread_id: selection.thread_id.clone(),
                    before_turn_id: selection.turn_id,
                },
            )
            .await;
        tx.send(AppEvent::Backtrack(BacktrackEvent::Reverted {
            thread_id: selection.thread_id,
            generation,
            result: result.map(Box::new).map_err(|error| error.to_string()),
        }));
    });
}
