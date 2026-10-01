use super::*;
use crate::app_event::{HistoryBatchCursor, HistoryBatchEntryResponse};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

fn persistent(
    count: usize,
) -> (
    ChatComposerHistory,
    AppEventSender,
    UnboundedReceiver<AppEvent>,
) {
    let (tx, rx) = unbounded_channel();
    let mut history = ChatComposerHistory::default();
    history.set_metadata("thread".into(), "log".into(), count);
    (history, AppEventSender::new(tx), rx)
}

fn older(
    history: &mut ChatComposerHistory,
    tx: &AppEventSender,
    restart: bool,
) -> HistorySearchResult {
    history.search("needle", HistorySearchDirection::Older, restart, tx)
}

#[test]
fn first_metadata_keeps_startup_local_but_next_configuration_clears_it() {
    let mut history = ChatComposerHistory::default();
    let entry = HistoryEntry::new("local".into());
    history.record_local_submission(entry.clone());
    history.set_metadata("thread".into(), "log".into(), 0);
    assert_eq!(history.navigate_up(&AppEventSender::default()), Some(entry));
    history.set_metadata("other".into(), "log".into(), 0);
    assert!(history.is_empty());
}

#[test]
fn local_history_ignores_empty_and_collapses_only_identical_adjacent_rich_entries() {
    let mut history = ChatComposerHistory::default();
    history.record_local_submission(HistoryEntry::new(String::new()));
    assert!(history.is_empty());
    let entry = HistoryEntry::new("same".into());
    history.record_local_submission(entry.clone());
    history.record_local_submission(entry.clone());
    let mut rich = entry;
    rich.remote_images = vec![RemoteImageAttachment {
        url: "https://example.test/image.png".into(),
        detail: None,
    }];
    history.record_local_submission(rich.clone());
    assert_eq!(history.local_history.len(), 2);
    assert_eq!(history.navigate_up(&AppEventSender::default()), Some(rich));
}

#[test]
fn navigation_fetches_on_demand_and_pending_down_is_not_the_newest_boundary() {
    let (mut history, tx, mut rx) = persistent(3);
    assert_eq!(history.navigate_up(&tx), None);
    assert!(matches!(
        rx.try_recv().unwrap(),
        AppEvent::LookupMessageHistoryEntry { offset: 2, .. }
    ));
    assert_eq!(history.navigate_up(&tx), None);
    assert!(matches!(
        rx.try_recv().unwrap(),
        AppEvent::LookupMessageHistoryEntry { offset: 1, .. }
    ));
    assert_eq!(history.navigate_down(&tx), None);
    assert!(
        rx.try_recv().is_err(),
        "in-flight lookups must be coalesced"
    );
    assert!(history.is_navigating());
    assert_eq!(
        history.on_entry_response("log", 1, Some("older".into()), &tx),
        HistoryEntryResponse::Ignored
    );
    assert_eq!(
        history.on_entry_response("log", 2, Some("newest".into()), &tx),
        HistoryEntryResponse::Found(HistoryEntry::new("newest".into()))
    );
    assert_eq!(
        history.navigate_down(&tx),
        Some(HistoryEntry::new(String::new()))
    );
    assert!(!history.is_navigating());
}

#[test]
fn malformed_entry_is_cached_and_navigation_skips_it_without_refetching() {
    let (mut history, tx, mut rx) = persistent(2);
    history.navigate_up(&tx);
    rx.try_recv().unwrap();
    assert_eq!(
        history.on_entry_response("log", 1, None, &tx),
        HistoryEntryResponse::Ignored
    );
    assert!(matches!(
        rx.try_recv().unwrap(),
        AppEvent::LookupMessageHistoryEntry { offset: 0, .. }
    ));
    history.on_entry_response("log", 0, Some("oldest".into()), &tx);
    history.reset_navigation();
    assert_eq!(
        history.navigate_up(&tx),
        Some(HistoryEntry::new("oldest".into()))
    );
    assert!(rx.try_recv().is_err());
}

#[test]
fn newest_probe_switches_to_batches_and_searches_beyond_two_hundred_rows() {
    let (mut history, tx, mut rx) = persistent(350);
    assert_eq!(older(&mut history, &tx, true), HistorySearchResult::Pending);
    assert!(matches!(
        rx.try_recv().unwrap(),
        AppEvent::LookupMessageHistoryEntry { offset: 349, .. }
    ));
    assert_eq!(
        history.on_entry_response("log", 349, Some("newest unrelated".into()), &tx),
        HistoryEntryResponse::Search(HistorySearchResult::Pending)
    );
    for (end, start) in [(348, 249), (248, 149), (148, 49), (48, 0)] {
        let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
            panic!("batch expected");
        };
        assert_eq!(cursor.end_offset(), end);
        let entries = (start..=end)
            .rev()
            .map(|offset| HistoryBatchEntryResponse {
                offset,
                entry: (offset % 5 != 0).then(|| {
                    if offset == 1 {
                        "needle oldest".into()
                    } else {
                        format!("other {offset}")
                    }
                }),
            })
            .collect();
        let result = history.on_batch_response(
            "log",
            cursor,
            entries,
            start.checked_sub(1).map(HistoryBatchCursor::new),
            &tx,
        );
        assert_eq!(
            result,
            Some(if start == 0 {
                HistorySearchResult::Found(HistoryEntry::new("needle oldest".into()))
            } else {
                HistorySearchResult::Pending
            })
        );
    }
    assert_eq!(
        older(&mut history, &tx, false),
        HistorySearchResult::AtBoundary
    );
    assert!(rx.try_recv().is_err());
}

#[test]
fn stale_log_and_nonawaited_batch_fill_only_valid_cache_without_resuming_query() {
    let (mut history, tx, mut rx) = persistent(4);
    older(&mut history, &tx, true);
    rx.try_recv().unwrap();
    assert_eq!(
        history.on_entry_response("old-log", 3, Some("needle stale".into()), &tx),
        HistoryEntryResponse::Ignored
    );
    assert!(history.fetched_history.is_empty());
    history.on_entry_response("log", 3, Some("other".into()), &tx);
    let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
        panic!("batch");
    };
    history.reset_navigation();
    assert_eq!(
        history.on_batch_response(
            "log",
            cursor,
            vec![HistoryBatchEntryResponse {
                offset: 2,
                entry: Some("needle cached".into())
            }],
            Some(HistoryBatchCursor::new(1)),
            &tx
        ),
        None
    );
    assert_eq!(
        older(&mut history, &tx, true),
        HistorySearchResult::Found(HistoryEntry::new("needle cached".into()))
    );
    assert!(rx.try_recv().is_err());
}

#[test]
fn batch_errors_retry_twice_then_report_unavailable_not_not_found() {
    let (mut history, tx, mut rx) = persistent(4);
    older(&mut history, &tx, true);
    rx.try_recv().unwrap();
    history.on_entry_response("log", 3, Some("other".into()), &tx);
    let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
        panic!("batch");
    };
    for _ in 0..2 {
        assert_eq!(
            history.on_batch_error("log", cursor, &tx),
            Some(HistorySearchResult::Pending)
        );
        assert!(matches!(
            rx.try_recv().unwrap(),
            AppEvent::LookupMessageHistoryBatch { .. }
        ));
    }
    assert_eq!(
        history.on_batch_error("log", cursor, &tx),
        Some(HistorySearchResult::Unavailable)
    );
    assert!(rx.try_recv().is_err());
    assert!(!history.fetched_history.contains_key(&2));
}

#[test]
fn disconnected_event_consumer_fails_closed_and_entry_io_failure_does_not_poison_cache() {
    let (mut history, tx, mut rx) = persistent(1);
    assert_eq!(
        older(&mut history, &AppEventSender::default(), true),
        HistorySearchResult::Unavailable
    );
    assert_eq!(older(&mut history, &tx, true), HistorySearchResult::Pending);
    rx.try_recv().unwrap();
    assert_eq!(
        history.on_entry_error("log", 0),
        HistoryEntryResponse::Search(HistorySearchResult::Unavailable)
    );
    assert!(history.fetched_history.is_empty());
    assert_eq!(older(&mut history, &tx, true), HistorySearchResult::Pending);
}

#[test]
fn empty_terminal_batch_exhausts_without_refetching_and_errors_keep_an_existing_match() {
    let (mut history, tx, mut rx) = persistent(3);
    older(&mut history, &tx, true);
    rx.try_recv().unwrap();
    history.on_entry_response("log", 2, Some("needle selected".into()), &tx);
    older(&mut history, &tx, false);
    rx.try_recv().unwrap();
    history.on_entry_response("log", 1, Some("other".into()), &tx);
    let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
        panic!("batch");
    };
    for _ in 0..2 {
        assert_eq!(
            history.on_batch_error("log", cursor, &tx),
            Some(HistorySearchResult::Pending)
        );
        rx.try_recv().unwrap();
    }
    assert_eq!(
        history.on_batch_error("log", cursor, &tx),
        Some(HistorySearchResult::AtBoundary)
    );
    assert_eq!(
        older(&mut history, &tx, false),
        HistorySearchResult::Pending
    );
    assert!(matches!(
        rx.try_recv().unwrap(),
        AppEvent::LookupMessageHistoryEntry { offset: 0, .. }
    ));
    assert_eq!(
        history.on_entry_response("log", 0, None, &tx),
        HistoryEntryResponse::Search(HistorySearchResult::AtBoundary)
    );
    assert_eq!(
        older(&mut history, &tx, false),
        HistorySearchResult::AtBoundary
    );
    assert!(rx.try_recv().is_err());

    let (mut history, tx, mut rx) = persistent(3);
    older(&mut history, &tx, true);
    rx.try_recv().unwrap();
    history.on_entry_response("log", 2, Some("other".into()), &tx);
    let AppEvent::LookupMessageHistoryBatch { cursor, .. } = rx.try_recv().unwrap() else {
        panic!("batch");
    };
    assert_eq!(
        history.on_batch_response("log", cursor, Vec::new(), None, &tx),
        Some(HistorySearchResult::NotFound)
    );
    assert!(rx.try_recv().is_err());
}

#[test]
fn late_malformed_batch_rows_do_not_clobber_an_already_fetched_entry() {
    let (mut history, tx, _) = persistent(1);
    history.on_entry_response("log", 0, Some("needle cached".into()), &tx);
    assert_eq!(
        history.on_batch_response(
            "log",
            HistoryBatchCursor::new(0),
            vec![HistoryBatchEntryResponse {
                offset: 0,
                entry: None
            }],
            None,
            &tx
        ),
        None
    );
    assert_eq!(
        older(&mut history, &tx, true),
        HistorySearchResult::Found(HistoryEntry::new("needle cached".into()))
    );
}
