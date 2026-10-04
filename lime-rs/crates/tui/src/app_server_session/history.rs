//! Bounded App Server transcript loading for resume and scrollback views.

use std::collections::HashSet;

use anyhow::{bail, Context, Result};
use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    SortDirection, ThreadItem, ThreadItemsListParams, ThreadItemsListResponse,
    ThreadTurnsListParams, ThreadTurnsListResponse, Turn, TurnItemsView, METHOD_THREAD_ITEMS_LIST,
    METHOD_THREAD_TURNS_LIST,
};

use super::AppServerSession;

pub(crate) const HISTORY_ITEM_PAGE_LIMIT: u32 = 100;
pub(crate) const HISTORY_ITEM_SCAN_LIMIT: usize = 4 * HISTORY_ITEM_PAGE_LIMIT as usize;

/// The first page of a paginated transcript and the optional Turn metadata used to render it.
///
/// Items remain the canonical payload. Turn metadata is an enrichment contract: callers must
/// keep the item-only path when an older App Server cannot provide it.
#[derive(Debug)]
pub(crate) struct InitialHistoryPage {
    pub(crate) items: Vec<ThreadItem>,
    pub(crate) turns: Option<Vec<Turn>>,
}

pub(crate) fn thread_items_page_params(
    thread_id: impl Into<String>,
    turn_id: Option<&str>,
    cursor: Option<String>,
    limit: u32,
) -> ThreadItemsListParams {
    ThreadItemsListParams {
        thread_id: thread_id.into(),
        turn_id: turn_id.map(str::to_string),
        cursor,
        limit: Some(limit),
        sort_direction: Some(SortDirection::Desc),
    }
}

fn pending_cursor_matches(
    next_item_cursor: Option<&str>,
    loading_older: bool,
    cursor: &str,
) -> bool {
    loading_older && next_item_cursor == Some(cursor)
}

fn advancing_cursor(
    current: Option<&str>,
    next: Option<String>,
    seen_cursors: &mut HashSet<String>,
) -> Option<String> {
    if let Some(current) = current {
        seen_cursors.insert(current.to_string());
    }
    next.filter(|next| seen_cursors.insert(next.clone()))
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ThreadHistoryPagination {
    next_item_cursor: Option<String>,
    seen_item_cursors: HashSet<String>,
    loading_older: bool,
}

impl ThreadHistoryPagination {
    fn has_older_history(&self) -> bool {
        self.next_item_cursor.is_some()
    }

    fn begin_older_history_page(&mut self) -> Option<String> {
        if self.loading_older {
            return None;
        }
        let cursor = self.next_item_cursor.clone()?;
        self.loading_older = true;
        Some(cursor)
    }

    fn is_older_history_page_pending(&self, cursor: &str) -> bool {
        pending_cursor_matches(self.next_item_cursor.as_deref(), self.loading_older, cursor)
    }

    fn cancel_older_history_page(&mut self, cursor: &str) {
        if self.is_older_history_page_pending(cursor) {
            self.loading_older = false;
        }
    }

    fn apply_older_history_page(
        &mut self,
        cursor: &str,
        page: ThreadItemsListResponse,
    ) -> Result<Vec<ThreadItem>> {
        if !self.is_older_history_page_pending(cursor) {
            return Ok(Vec::new());
        }
        self.next_item_cursor =
            advancing_cursor(Some(cursor), page.next_cursor, &mut self.seen_item_cursors);
        self.loading_older = false;
        Ok(page
            .data
            .into_iter()
            .map(|entry| entry.item)
            .rev()
            .collect())
    }
}

impl AppServerSession {
    pub(crate) async fn hydrate_initial_thread_history(
        &mut self,
        thread_id: impl Into<String>,
        item_cursor: Option<String>,
    ) -> Result<InitialHistoryPage> {
        let thread_id = thread_id.into();
        let page = self
            .thread_items_page(thread_id.clone(), item_cursor, HISTORY_ITEM_PAGE_LIMIT)
            .await?;
        let next_item_cursor = page.next_cursor.clone();
        let turn_ids = page
            .data
            .iter()
            .map(|entry| entry.turn_id.clone())
            .collect::<HashSet<_>>();
        let turns = if turn_ids.is_empty() {
            None
        } else {
            // Turn metadata is optional for compatibility with older App Servers. The caller
            // renders the same canonical items without enrichment when this lookup is absent.
            self.thread_turns_for_items(thread_id.clone(), &turn_ids)
                .await
                .ok()
        };
        let items = page
            .data
            .into_iter()
            .map(|entry| entry.item)
            .rev()
            .collect();
        self.initialize_history_pagination(thread_id, next_item_cursor);
        Ok(InitialHistoryPage { items, turns })
    }

    pub(crate) fn initialize_history_pagination(
        &mut self,
        thread_id: impl Into<String>,
        next_item_cursor: Option<String>,
    ) {
        self.history_pagination.insert(
            thread_id.into(),
            ThreadHistoryPagination {
                next_item_cursor,
                ..ThreadHistoryPagination::default()
            },
        );
    }

    pub(crate) fn has_older_history(&self, thread_id: &str) -> bool {
        self.history_pagination
            .get(thread_id)
            .is_some_and(ThreadHistoryPagination::has_older_history)
    }

    pub(crate) fn begin_older_history_page(&mut self, thread_id: &str) -> Option<String> {
        let page = self.history_pagination.get_mut(thread_id)?;
        page.begin_older_history_page()
    }

    /// Match cancellation to the request cursor so an older response cannot cancel a newer load.
    pub(crate) fn is_older_history_page_pending(&self, thread_id: &str, cursor: &str) -> bool {
        self.history_pagination
            .get(thread_id)
            .is_some_and(|page| page.is_older_history_page_pending(cursor))
    }

    pub(crate) fn cancel_older_history_page(&mut self, thread_id: &str, cursor: &str) {
        if let Some(page) = self.history_pagination.get_mut(thread_id) {
            page.cancel_older_history_page(cursor);
        }
    }

    pub(crate) fn apply_older_history_page(
        &mut self,
        thread_id: &str,
        cursor: &str,
        page: ThreadItemsListResponse,
    ) -> Result<Vec<ThreadItem>> {
        let Some(state) = self.history_pagination.get_mut(thread_id) else {
            return Ok(Vec::new());
        };
        state.apply_older_history_page(cursor, page)
    }

    pub(crate) async fn thread_items_page(
        &self,
        thread_id: impl Into<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> Result<ThreadItemsListResponse> {
        thread_items_page_with_handle(self.request_handle.clone(), thread_id, cursor, limit).await
    }

    /// Load the turn pages that cover the item page and one older context turn.
    ///
    /// The lookup is bounded and stops on a repeated cursor, so an older or malformed App Server
    /// cannot make a scroll request unbounded. A missing turn page is handled by the caller as an
    /// item-only projection without inventing completion state.
    pub(crate) async fn thread_turns_for_items(
        &self,
        thread_id: impl Into<String>,
        target_turn_ids: &HashSet<String>,
    ) -> Result<Vec<Turn>> {
        thread_turns_for_items_with_handle(self.request_handle.clone(), thread_id, target_turn_ids)
            .await
    }
}

pub(crate) async fn thread_items_page_with_handle(
    request_handle: RequestHandle,
    thread_id: impl Into<String>,
    cursor: Option<String>,
    limit: u32,
) -> Result<ThreadItemsListResponse> {
    request_handle
        .request(
            METHOD_THREAD_ITEMS_LIST,
            thread_items_page_params(thread_id, None, cursor, limit),
        )
        .await
        .context("failed to load App Server thread item page")
}

async fn thread_turns_page_with_handle(
    request_handle: RequestHandle,
    thread_id: impl Into<String>,
    cursor: Option<String>,
) -> Result<ThreadTurnsListResponse> {
    request_handle
        .request(
            METHOD_THREAD_TURNS_LIST,
            ThreadTurnsListParams {
                thread_id: thread_id.into(),
                cursor,
                limit: Some(HISTORY_ITEM_PAGE_LIMIT),
                sort_direction: Some(SortDirection::Desc),
                items_view: Some(TurnItemsView::Full),
            },
        )
        .await
        .context("failed to load App Server thread turn page")
}

pub(crate) async fn thread_turns_for_items_with_handle(
    request_handle: RequestHandle,
    thread_id: impl Into<String>,
    target_turn_ids: &HashSet<String>,
) -> Result<Vec<Turn>> {
    if target_turn_ids.is_empty() {
        return Ok(Vec::new());
    }
    let thread_id = thread_id.into();
    let mut cursor = None;
    let mut seen_cursors = HashSet::new();
    let mut turns_desc = Vec::new();

    for _ in 0..16 {
        let page = thread_turns_page_with_handle(
            request_handle.clone(),
            thread_id.clone(),
            cursor.clone(),
        )
        .await?;
        turns_desc.extend(page.data);
        if all_target_turns_loaded(&turns_desc, target_turn_ids)
            && has_older_turn_context(&turns_desc, target_turn_ids)
        {
            return Ok(chronological_turns(turns_desc));
        }
        let Some(next_cursor) = page.next_cursor else {
            if all_target_turns_loaded(&turns_desc, target_turn_ids) {
                return Ok(chronological_turns(turns_desc));
            }
            bail!("thread turns page is missing an item page target turn");
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            bail!("thread turns pagination repeated cursor {next_cursor}");
        }
        cursor = Some(next_cursor);
    }

    bail!("thread turns pagination exceeded 16 pages")
}

fn chronological_turns(turns_desc: Vec<Turn>) -> Vec<Turn> {
    turns_desc.into_iter().rev().collect()
}

fn all_target_turns_loaded(turns_desc: &[Turn], target_turn_ids: &HashSet<String>) -> bool {
    target_turn_ids
        .iter()
        .all(|target| turns_desc.iter().any(|turn| &turn.id == target))
}

/// The turns endpoint is queried newest-first. Once every target turn is present, keep paging
/// until one older turn is present as context for nested-review reconciliation.
fn has_older_turn_context(turns_desc: &[Turn], target_turn_ids: &HashSet<String>) -> bool {
    turns_desc
        .iter()
        .enumerate()
        .filter(|(_, turn)| target_turn_ids.contains(&turn.id))
        .map(|(index, _)| index)
        .max()
        .is_some_and(|oldest_target| oldest_target + 1 < turns_desc.len())
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
