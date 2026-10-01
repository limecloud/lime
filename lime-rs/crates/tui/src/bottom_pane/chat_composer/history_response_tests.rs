use super::*;
use crate::app_event::{
    AppEvent, HistoryBatchCursor, HistoryBatchEntryResponse, HistoryLookupResponse,
};
use crate::locale::Locale;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

fn composer() -> (ChatComposer, UnboundedReceiver<AppEvent>) {
    let (tx, rx) = unbounded_channel();
    let mut composer = ChatComposer::default();
    composer.set_app_event_tx(AppEventSender::new(tx));
    composer.set_history_metadata("thread".into(), "log".into(), 3);
    (composer, rx)
}

fn entry(offset: usize, text: &str) -> HistoryLookupResponse {
    HistoryLookupResponse::Entry {
        offset,
        log_id: "log".into(),
        entry: Some(text.into()),
    }
}

fn query(composer: &mut ChatComposer, text: &str) {
    composer.begin_history_search();
    composer.update_history_search_query(|query| query.push_str(text));
}

#[test]
fn pending_navigation_down_does_not_restore_saved_draft_and_late_entries_do_not_overwrite_edits() {
    let (mut composer, mut rx) = composer();
    composer.history_previous();
    rx.try_recv().unwrap();
    composer.history_previous();
    rx.try_recv().unwrap();
    composer.history_next();
    assert!(composer.history.is_navigating());
    assert!(composer.draft.saved_draft.is_some());
    composer.handle_paste("x");
    composer.on_history_lookup_response("thread", entry(2, "late"));
    assert_eq!(composer.text(), "x");
    assert!(!composer.history.is_navigating());
    assert_eq!(composer.history_previous(), InputResult::Changed);
    assert_eq!(
        composer.text(),
        "late",
        "inactive response still populates the shared cache"
    );
}

#[test]
fn cancelled_search_and_thread_or_log_stale_responses_never_replace_the_rich_draft() {
    let (mut composer, mut rx) = composer();
    composer.handle_paste("my draft");
    composer.attach_image("draft.png".into());
    let draft = composer.snapshot_draft();
    query(&mut composer, "needle");
    rx.try_recv().unwrap();
    composer.cancel_history_search();
    composer.on_history_lookup_response("thread", entry(2, "needle late"));
    assert_eq!(composer.snapshot_draft(), draft);
    query(&mut composer, "old");
    let before = composer.snapshot_draft();
    composer.on_history_lookup_response("other-thread", entry(1, "old wrong thread"));
    composer.on_history_lookup_response(
        "thread",
        HistoryLookupResponse::Entry {
            offset: 1,
            log_id: "old-log".into(),
            entry: Some("old stale log".into()),
        },
    );
    assert_eq!(composer.snapshot_draft(), before);
    composer.set_history_thread_id("other-thread");
    composer.on_history_lookup_response("thread", entry(1, "old switched thread"));
    assert_eq!(composer.snapshot_draft(), draft);
}

#[test]
fn changed_query_coalesces_the_probe_and_matches_only_the_current_query() {
    let (mut composer, mut rx) = composer();
    composer.handle_paste("saved");
    query(&mut composer, "obsolete");
    rx.try_recv().unwrap();
    composer.update_history_search_query(|query| *query = "current".into());
    assert!(rx.try_recv().is_err());
    composer.on_history_lookup_response("thread", entry(2, "obsolete hit"));
    assert_eq!(composer.text(), "saved");
    let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
        panic!("batch");
    };
    composer.on_history_lookup_response(
        "thread",
        HistoryLookupResponse::Batch {
            log_id: "log".into(),
            cursor,
            entries: vec![
                HistoryBatchEntryResponse {
                    offset: 1,
                    entry: Some("current hit".into()),
                },
                HistoryBatchEntryResponse {
                    offset: 0,
                    entry: None,
                },
            ],
            next_older_cursor: None,
        },
    );
    assert_eq!(composer.text(), "current hit");
    assert_eq!(
        composer.history_search.as_ref().unwrap().status,
        history_search::HistorySearchStatus::Match
    );
}

#[test]
fn response_for_a_nonawaited_cursor_only_fills_cache_and_does_not_change_search_status() {
    let (mut composer, mut rx) = composer();
    query(&mut composer, "needle");
    rx.try_recv().unwrap();
    composer.on_history_lookup_response("thread", entry(2, "other"));
    rx.try_recv().unwrap();
    composer.on_history_lookup_response(
        "thread",
        HistoryLookupResponse::Batch {
            log_id: "log".into(),
            cursor: HistoryBatchCursor::new(0),
            entries: vec![HistoryBatchEntryResponse {
                offset: 0,
                entry: Some("needle cached".into()),
            }],
            next_older_cursor: None,
        },
    );
    assert!(composer.text().is_empty());
    assert_eq!(
        composer.history_search.as_ref().unwrap().status,
        history_search::HistorySearchStatus::Searching
    );
}

#[test]
fn pending_and_unavailable_feedback_is_localized_and_never_claims_no_match() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let (mut composer, mut rx) = composer();
        composer.set_locale(locale);
        composer.handle_paste("original");
        query(&mut composer, "needle");
        rx.try_recv().unwrap();
        assert!(composer
            .history_search_footer_line()
            .unwrap()
            .to_string()
            .contains(locale.history_search_pending()));
        assert_eq!(
            composer.handle_history_search_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            InputResult::Changed
        );
        assert!(
            composer.history_search_active(),
            "pending Enter must not submit"
        );
        composer.on_history_lookup_response(
            "thread",
            HistoryLookupResponse::EntryError {
                offset: 2,
                log_id: "log".into(),
            },
        );
        let footer = composer.history_search_footer_line().unwrap().to_string();
        assert!(footer.contains(locale.history_search_unavailable()));
        assert!(!footer.contains(locale.history_search_no_match()));
        assert_eq!(composer.text(), "original");
    }
}

#[test]
fn async_boundary_reenables_accept_actions_and_never_submits_a_turn() {
    let (mut composer, mut rx) = composer();
    query(&mut composer, "needle");
    rx.try_recv().unwrap();
    composer.on_history_lookup_response("thread", entry(2, "needle hit"));
    composer.handle_history_search_key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
    rx.try_recv().unwrap();
    composer.on_history_lookup_response("thread", entry(1, "other"));
    let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
        panic!("batch");
    };
    composer.on_history_lookup_response(
        "thread",
        HistoryLookupResponse::Batch {
            log_id: "log".into(),
            cursor,
            entries: vec![HistoryBatchEntryResponse {
                offset: 0,
                entry: None,
            }],
            next_older_cursor: None,
        },
    );
    assert_eq!(composer.text(), "needle hit");
    assert_eq!(
        composer.history_search.as_ref().unwrap().status,
        history_search::HistorySearchStatus::Match
    );
    assert_eq!(
        composer.handle_history_search_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        InputResult::Changed
    );
    assert!(!composer.history_search_active());
}
