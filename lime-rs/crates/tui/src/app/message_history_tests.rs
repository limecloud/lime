use super::*;
use app_server_protocol::protocol::v2::PromptHistoryEntry;

fn page(offsets: &[u64], next: Option<&str>) -> PromptHistoryReadResponse {
    PromptHistoryReadResponse {
        log_id: "log".into(),
        entry_count: 250,
        data: offsets
            .iter()
            .map(|offset| PromptHistoryEntry {
                offset: *offset,
                thread_id: "thread".into(),
                ts: 1,
                text: format!("entry {offset}"),
            })
            .collect(),
        next_cursor: next.map(str::to_string),
    }
}

#[test]
fn row_range_lowering_preserves_malformed_holes_and_maps_exclusive_cursor() {
    let (entries, next) =
        lower_history_page(page(&[248, 245, 151], Some("150")), 250, 100, "log").unwrap();
    assert_eq!(entries.len(), 100);
    assert_eq!(
        entries[0],
        HistoryBatchEntryResponse {
            offset: 249,
            entry: None
        }
    );
    assert_eq!(entries[1].entry.as_deref(), Some("entry 248"));
    assert_eq!(next, Some(HistoryBatchCursor::new(149)));
    let (entries, next) = lower_history_page(page(&[], None), 1, 1, "log").unwrap();
    assert_eq!(
        entries,
        vec![HistoryBatchEntryResponse {
            offset: 0,
            entry: None
        }]
    );
    assert_eq!(next, None);
}

#[test]
fn invalid_snapshot_repeated_cursor_and_out_of_range_offsets_fail_closed() {
    for (page, log_id) in [
        (page(&[], Some("250")), "log"),
        (page(&[249, 249], Some("150")), "log"),
        (page(&[149], Some("150")), "log"),
        (page(&[251], Some("150")), "log"),
        (page(&[249], Some("150")), "stale"),
    ] {
        assert!(lower_history_page(page, 250, 100, log_id).is_err());
    }
}

#[tokio::test]
async fn disconnected_host_returns_an_error_response_instead_of_empty_history() {
    assert!(matches!(
        lookup_message_history(None, HistoryBatchCursor::new(5), "log", true).await,
        HistoryLookupResponse::EntryError { offset: 5, .. }
    ));
    assert!(matches!(
        lookup_message_history(None, HistoryBatchCursor::new(5), "log", false).await,
        HistoryLookupResponse::BatchError { .. }
    ));
}
