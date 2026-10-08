//! Revert responses and notifications replace the same canonical, paginated projection.

use std::collections::HashSet;

use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    Thread, ThreadReadParams, ThreadReadResponse, METHOD_THREAD_READ,
};
use tokio::task::JoinHandle;

use super::App;
use crate::app_event::AppEvent;
use crate::app_event_sender::AppEventSender;
use crate::app_server_session::{
    thread_items_page_with_handle, thread_turns_for_items_with_handle, AppServerSession,
    InitialHistoryPage, HISTORY_ITEM_PAGE_LIMIT,
};

#[derive(Debug)]
pub(crate) struct HistoryReplacement {
    thread: Thread,
    page: InitialHistoryPage,
    next_cursor: Option<String>,
}

#[derive(Debug, Default)]
pub(crate) struct HistoryReplacementState {
    generation: u64,
    needed: bool,
    pending: bool,
    failed: bool,
    task: Option<JoinHandle<()>>,
}

impl Drop for HistoryReplacementState {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

impl HistoryReplacementState {
    pub(crate) fn reset(&mut self) {
        let generation = self.generation.wrapping_add(1);
        *self = Self::default();
        self.generation = generation;
    }

    pub(crate) fn is_pending(&self) -> bool {
        self.needed || self.pending || self.failed
    }
}

impl App {
    pub(crate) fn note_thread_reverted(&mut self, thread_id: &str) {
        // A replacement invalidates buffered deltas, usage, prompts and request identities,
        // including an inactive thread that will next be hydrated through thread/resume.
        if self.thread_id.as_deref() == Some(thread_id) {
            if !self.backtrack_revert_pending() {
                self.reset_backtrack_state();
            }
            self.chat_widget.dismiss_pager_overlay();
            self.request_history_replacement();
        } else {
            self.thread_event_channels.remove(thread_id);
        }
    }

    pub(crate) fn request_history_replacement(&mut self) {
        self.begin_history_replacement(true);
    }

    fn begin_history_replacement(&mut self, clear_buffer: bool) {
        self.history_replacement.reset();
        self.history_replacement.needed = true;
        if clear_buffer {
            if let Some(thread_id) = self.thread_id.as_deref() {
                self.thread_event_channels.remove(thread_id);
            }
        }
        // Never leave removed turns visible while a fresh page is loading or has failed.
        self.projection = crate::projection::ConversationProjection::default();
        self.chat_widget.reset_for_hydrated_thread();
        self.chat_widget.bottom_pane.clear_interactions();
        self.chat_widget.replace_queued_submissions(Vec::new());
        self.chat_widget.set_scrollback_has_older_history(false);
        if let Some(thread_id) = self.thread_id.clone() {
            self.chat_widget
                .bottom_pane
                .replace_replayed_history(thread_id, &[]);
        }
        self.projection
            .set_status(self.chat_widget.locale.backtrack_loading());
    }

    pub(crate) fn retry_history_replacement(&mut self) -> bool {
        if !self.history_replacement.failed {
            return false;
        }
        self.begin_history_replacement(false);
        true
    }

    pub(crate) fn poll_history_replacement(
        &mut self,
        session: &mut AppServerSession,
        tx: &AppEventSender,
    ) {
        // A revert notification can precede its response. Restore its selected prompt before
        // hydrate_thread resets the mutation state; meanwhile the same event store buffers live IO.
        if !self.history_replacement.needed || self.backtrack_revert_pending() {
            return;
        }
        let Some(thread_id) = self.thread_id.clone() else {
            return;
        };
        session.initialize_history_pagination(thread_id.clone(), None);
        self.history_replacement.needed = false;
        self.history_replacement.pending = true;
        let generation = self.history_replacement.generation;
        let locale = self.chat_widget.locale;
        let handle = session.request_handle();
        let tx = tx.clone();
        self.history_replacement.task = Some(tokio::spawn(async move {
            let result = load_replacement(handle, &thread_id, locale)
                .await
                .map(Box::new)
                .map_err(|error| error.to_string());
            tx.send(AppEvent::ThreadHistoryReplaced {
                thread_id,
                generation,
                result,
            });
        }));
    }

    pub(crate) fn handle_history_replaced(
        &mut self,
        session: &mut AppServerSession,
        thread_id: &str,
        generation: u64,
        result: Result<Box<HistoryReplacement>, String>,
    ) {
        if self.thread_id.as_deref() != Some(thread_id)
            || generation != self.history_replacement.generation
            || !self.history_replacement.pending
        {
            return;
        }
        self.history_replacement.task = None;
        self.history_replacement.pending = false;
        match result {
            Ok(replacement) if replacement.thread.id == thread_id => {
                let replacement = *replacement;
                // Events received after the replacement boundary survive canonical hydration.
                // Reuse the bounded ThreadEventStore, including exact unresolved request ids.
                let snapshot = self.take_thread_event_snapshot(thread_id, false);
                session.initialize_history_pagination(thread_id, replacement.next_cursor);
                self.hydrate_thread(replacement.thread);
                self.prepend_initial_history_page(replacement.page);
                self.chat_widget
                    .set_scrollback_has_older_history(session.has_older_history(thread_id));
                self.replay_thread_snapshot(snapshot);
            }
            result => {
                self.history_replacement.failed = true;
                let error = result.err().unwrap_or_else(|| {
                    self.chat_widget
                        .locale
                        .backtrack_identity_failed()
                        .to_string()
                });
                self.projection
                    .set_status(self.chat_widget.locale.backtrack_refresh_failed(&error));
            }
        }
    }
}

async fn load_replacement(
    handle: RequestHandle,
    thread_id: &str,
    locale: crate::locale::Locale,
) -> anyhow::Result<HistoryReplacement> {
    let response: ThreadReadResponse = handle
        .request(
            METHOD_THREAD_READ,
            ThreadReadParams {
                thread_id: thread_id.to_string(),
                include_turns: false,
            },
        )
        .await?;
    anyhow::ensure!(
        response.thread.id == thread_id,
        "{}",
        locale.backtrack_identity_failed()
    );
    let page =
        thread_items_page_with_handle(handle.clone(), thread_id, None, HISTORY_ITEM_PAGE_LIMIT)
            .await?;
    let ids = page
        .data
        .iter()
        .map(|entry| entry.turn_id.clone())
        .collect::<HashSet<_>>();
    let turns = thread_turns_for_items_with_handle(handle, thread_id, &ids).await?;
    Ok(HistoryReplacement {
        thread: response.thread,
        next_cursor: page.next_cursor,
        page: InitialHistoryPage {
            items: page
                .data
                .into_iter()
                .map(|entry| entry.item)
                .rev()
                .collect(),
            turns,
        },
    })
}
