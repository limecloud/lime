//! Load older transcript pages without creating a TUI-local history store.

use anyhow::Result;
use app_server_protocol::protocol::v2::Turn;
use std::collections::HashSet;

use super::App;
use crate::app_event::{AppEvent, OlderHistoryLoadMode};
use crate::app_event_sender::AppEventSender;
use crate::app_server_session::{
    thread_items_page_with_handle, thread_turns_for_items_with_handle, AppServerSession,
    InitialHistoryPage, HISTORY_ITEM_PAGE_LIMIT,
};
use crate::history_filter::hidden_user_message_ids;
use crate::pager_overlay::PagerOverlay;

#[path = "history_completion.rs"]
pub(crate) mod completion;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OlderHistoryLoadStart {
    Started,
    Pending,
    Unavailable,
}

impl App {
    /// Start one older-page request without holding the TUI event loop on App Server IO.
    ///
    /// The request handle is the only transport state moved into the task. Cursor ownership and
    /// projection remain on the main loop, where stale responses can be rejected atomically.
    pub(crate) fn spawn_older_history_page_load(
        &mut self,
        app_server: &mut AppServerSession,
        app_event_tx: &AppEventSender,
        mode: OlderHistoryLoadMode,
    ) -> OlderHistoryLoadStart {
        let Some(thread_id) = self.thread_id.clone() else {
            return OlderHistoryLoadStart::Unavailable;
        };
        if !app_server.has_older_history(&thread_id) {
            return OlderHistoryLoadStart::Unavailable;
        }
        let Some(cursor) = app_server.begin_older_history_page(&thread_id) else {
            return OlderHistoryLoadStart::Pending;
        };
        let request_handle = app_server.request_handle();
        let tx = app_event_tx.clone();
        tokio::spawn(async move {
            let result: Result<_> = async {
                let page = thread_items_page_with_handle(
                    request_handle.clone(),
                    thread_id.clone(),
                    Some(cursor.clone()),
                    HISTORY_ITEM_PAGE_LIMIT,
                )
                .await?;
                let turn_ids = page
                    .data
                    .iter()
                    .map(|entry| entry.turn_id.clone())
                    .collect::<HashSet<_>>();
                let turns = thread_turns_for_items_with_handle(
                    request_handle,
                    thread_id.clone(),
                    &turn_ids,
                )
                .await?;
                Ok((page, turns))
            }
            .await;
            let _ = tx.send(AppEvent::OlderThreadHistoryLoaded {
                thread_id,
                cursor,
                result: result.map_err(|error| error.to_string()),
                mode,
            });
        });
        OlderHistoryLoadStart::Started
    }

    /// Prepend the initial page using the same required Turn facts as older pages.
    pub(crate) fn prepend_initial_history_page(&mut self, page: InitialHistoryPage) {
        let InitialHistoryPage { items, turns } = page;
        self.prepend_history_page(items, &turns, false);
    }

    /// Reconcile one page against the Turn metadata available for it and its adjacent context.
    ///
    /// Additional canonical context can classify an earlier item as a hidden nested-review prompt.
    /// IO never degrades a failed Turn lookup into an unverified flat page.
    fn prepend_history_page(
        &mut self,
        items: Vec<app_server_protocol::protocol::v2::ThreadItem>,
        turns: &[Turn],
        prepend_replay: bool,
    ) {
        self.chat_widget
            .bottom_pane
            .record_replayed_history_page(&items, turns, prepend_replay);
        let previous_turn_id = self.projection.active_turn_id().map(str::to_owned);
        let hidden_ids = hidden_user_message_ids(turns);
        let groups = completion::group_completed_turn_items(items, turns);
        self.projection.remove_hidden_entries(&hidden_ids);
        self.projection
            .prepend_grouped_items_with_hidden_ids(groups, &hidden_ids);
        self.projection.restore_history_turns(turns);
        self.chat_widget.turn_lifecycle.sync_projection_turn(
            previous_turn_id.as_deref(),
            self.projection.active_turn_id(),
            std::time::Instant::now(),
        );
    }

    pub(crate) fn handle_older_history_page_loaded(
        &mut self,
        app_server: &mut AppServerSession,
        thread_id: &str,
        cursor: &str,
        result: std::result::Result<
            (
                app_server_protocol::protocol::v2::ThreadItemsListResponse,
                Vec<Turn>,
            ),
            String,
        >,
    ) -> Result<bool> {
        // A completion must first prove that it still owns the current cursor. This keeps a
        // stale response from cancelling or projecting a newer request after a retry.
        if !app_server.is_older_history_page_pending(thread_id, cursor) {
            return Ok(false);
        }
        if self.thread_id.as_deref() != Some(thread_id) {
            app_server.cancel_older_history_page(thread_id, cursor);
            return Ok(false);
        }
        // The transcript overlay owns an explicit beginning-loading intent. If another lifecycle
        // transition already established that no older page remains, an in-flight completion is
        // stale even when its thread/cursor still match; fail closed before touching projection.
        if !transcript_history_surface_is_current(
            self.chat_widget
                .pager_overlay
                .as_ref()
                .is_some_and(PagerOverlay::is_transcript),
            self.chat_widget.scrollback_has_older_history(),
        ) {
            app_server.cancel_older_history_page(thread_id, cursor);
            return Ok(false);
        }
        let (page, turns) = match result {
            Ok(page) => page,
            Err(error) => {
                app_server.cancel_older_history_page(thread_id, cursor);
                return Err(anyhow::Error::msg(error));
            }
        };
        let items = app_server.apply_older_history_page(thread_id, cursor, page)?;
        self.prepend_history_page(items, &turns, true);
        self.chat_widget
            .set_scrollback_has_older_history(app_server.has_older_history(thread_id));
        Ok(true)
    }
}

/// Whether the visible surface may still accept an older-history completion.
///
/// The inline transcript can accept a response while its cached availability flag is being
/// refreshed. The explicit transcript overlay must reject a completion after its older-page
/// intent has been exhausted, matching Codex's owned-transcript fail-closed boundary.
fn transcript_history_surface_is_current(
    transcript_overlay: bool,
    older_history_available: bool,
) -> bool {
    !transcript_overlay || older_history_available
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{TurnItemsView, TurnStatus, UserInput};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn user_message(id: &str, text: &str) -> app_server_protocol::protocol::v2::ThreadItem {
        app_server_protocol::protocol::v2::ThreadItem::UserMessage {
            id: id.to_string(),
            metadata: None,
            client_id: None,
            content: vec![UserInput::Text {
                text: text.to_string(),
                text_elements: Vec::new(),
            }],
        }
    }

    fn answer(id: &str, text: &str) -> app_server_protocol::protocol::v2::ThreadItem {
        app_server_protocol::protocol::v2::ThreadItem::AgentMessage {
            id: id.to_string(),
            metadata: None,
            text: text.to_string(),
            phase: None,
            memory_citation: None,
            delivery: None,
        }
    }

    #[test]
    fn initial_history_page_uses_turn_metadata_for_filtering_and_completion() {
        let items = vec![
            app_server_protocol::protocol::v2::ThreadItem::EnteredReviewMode {
                id: "review-enter".to_string(),
                metadata: None,
                review: "review".to_string(),
            },
            user_message("review-prompt", "hidden"),
            app_server_protocol::protocol::v2::ThreadItem::ExitedReviewMode {
                id: "review-exit".to_string(),
                metadata: None,
                review: "review".to_string(),
            },
            answer("answer", "done"),
        ];
        let turn = Turn {
            id: "turn-1".to_string(),
            items: items.clone(),
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: Some(1),
            completed_at: Some(4),
            duration_ms: Some(3_000),
        };
        let mut app = App::default();
        app.prepend_initial_history_page(InitialHistoryPage {
            items,
            turns: vec![turn],
        });

        assert_eq!(
            app.projection
                .entries()
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["review-enter", "review-exit", "answer"]
        );
        assert_eq!(
            app.projection
                .completion_after("answer")
                .and_then(|boundary| boundary.elapsed_seconds),
            Some(3)
        );
    }

    #[test]
    fn empty_history_page_preserves_live_projection_and_composer() {
        let mut app = App::default();
        app.projection.start_turn("live".into());
        app.chat_widget
            .bottom_pane
            .set_composer_text("draft".into());
        app.prepend_initial_history_page(InitialHistoryPage {
            items: Vec::new(),
            turns: Vec::new(),
        });

        assert!(app.projection.entries().is_empty());
        assert_eq!(app.projection.active_turn_id(), Some("live"));
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
    }

    #[test]
    fn replay_seed_keeps_older_pages_before_newer_recall() {
        let mut app = App::default();
        app.set_thread_id("thread".into());
        let new_turn = Turn {
            id: "new-turn".into(),
            items: vec![user_message("new", "new prompt")],
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: None,
            completed_at: None,
            duration_ms: None,
        };
        app.prepend_initial_history_page(InitialHistoryPage {
            items: vec![user_message("new", "new prompt")],
            turns: vec![new_turn],
        });
        let old_turn = Turn {
            id: "old-turn".into(),
            items: vec![user_message("old", "old prompt")],
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: None,
            completed_at: None,
            duration_ms: None,
        };
        app.prepend_history_page(vec![user_message("old", "old prompt")], &[old_turn], true);

        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "new prompt");
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "old prompt");
    }

    #[test]
    fn transcript_history_surface_rejects_completion_after_older_history_is_exhausted() {
        assert!(transcript_history_surface_is_current(false, false));
        assert!(transcript_history_surface_is_current(true, true));
        assert!(!transcript_history_surface_is_current(true, false));
    }

    #[test]
    fn older_pagination_completion_footers_follow_answers_without_overlap_duplicates() {
        let newest_items = vec![
            user_message("new-prompt", "new"),
            answer("new-answer", "new"),
        ];
        let newest_turn = Turn {
            id: "new-turn".to_string(),
            items: newest_items.clone(),
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: Some(1),
            completed_at: Some(4),
            duration_ms: Some(3_000),
        };
        let mut app = App::default();
        app.prepend_initial_history_page(InitialHistoryPage {
            items: newest_items,
            turns: vec![newest_turn],
        });

        let older_items = vec![
            user_message("old-prompt", "old"),
            answer("old-answer", "old"),
            answer("new-answer", "new"),
        ];
        let old_turn = Turn {
            id: "old-turn".to_string(),
            items: older_items[..2].to_vec(),
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: Some(1),
            completed_at: Some(2),
            duration_ms: Some(1_000),
        };
        let overlapping_new_turn = Turn {
            id: "new-turn".to_string(),
            items: vec![answer("new-answer", "new")],
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: Some(3),
            completed_at: Some(4),
            duration_ms: Some(3_000),
        };
        let groups =
            completion::group_completed_turn_items(older_items, &[old_turn, overlapping_new_turn]);
        app.projection
            .prepend_grouped_items_with_hidden_ids(groups, &HashSet::new());

        assert_eq!(
            app.projection
                .entries()
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["old-prompt", "old-answer", "new-prompt", "new-answer"]
        );
        assert_eq!(
            app.projection
                .entries()
                .iter()
                .filter(|entry| app.projection.completion_after(&entry.id).is_some())
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["old-answer", "new-answer"]
        );
    }

    #[test]
    fn older_page_reconciles_nested_review_prompt_from_adjacent_turn_metadata() {
        let hidden = user_message("nested-hidden", "same prompt");
        let duplicate = user_message("nested-duplicate", "same prompt");
        let mut app = App::default();

        // Live items can precede the adjacent Turn context later discovered by pagination.
        app.projection.prepend_items(vec![
            hidden.clone(),
            user_message("visible", "visible prompt"),
        ]);

        let previous_review_turn = Turn {
            id: "review-turn".to_string(),
            items: vec![
                app_server_protocol::protocol::v2::ThreadItem::EnteredReviewMode {
                    id: "review-enter".to_string(),
                    metadata: None,
                    review: "review".to_string(),
                },
                app_server_protocol::protocol::v2::ThreadItem::ExitedReviewMode {
                    id: "review-exit".to_string(),
                    metadata: None,
                    review: "review".to_string(),
                },
            ],
            items_view: TurnItemsView::Full,
            status: TurnStatus::Completed,
            error: None,
            started_at: Some(1),
            completed_at: Some(2),
            duration_ms: Some(1_000),
        };
        let nested_review_turn = Turn {
            id: "nested-turn".to_string(),
            items: vec![hidden, duplicate],
            items_view: TurnItemsView::Full,
            status: TurnStatus::Interrupted,
            error: None,
            started_at: Some(3),
            completed_at: None,
            duration_ms: None,
        };

        app.prepend_history_page(
            vec![user_message("older-visible", "older visible")],
            &[previous_review_turn, nested_review_turn],
            true,
        );

        assert_eq!(
            app.projection
                .entries()
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["older-visible", "visible"]
        );
    }
}
