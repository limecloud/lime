use super::*;
use crate::projection::tests::{test_thread, test_turn};
use app_server_protocol::protocol::v2::{
    ItemCompletedNotification, ReasoningSummaryPartAddedNotification,
    ReasoningSummaryTextDeltaNotification, ReasoningTextDeltaNotification, ServerNotification,
    ThreadItem, TurnStatus,
};

fn raw_delta(turn_id: &str, item_id: &str) -> ServerNotification {
    ServerNotification::ReasoningTextDelta(ReasoningTextDeltaNotification {
        thread_id: "thread-review-filter".into(),
        turn_id: turn_id.into(),
        item_id: item_id.into(),
        delta: "RAW_REASONING_MUST_STAY_HIDDEN".into(),
        content_index: 0,
    })
}

fn summary_delta(index: i64, delta: &str) -> ServerNotification {
    ServerNotification::ReasoningSummaryTextDelta(ReasoningSummaryTextDeltaNotification {
        thread_id: "thread-review-filter".into(),
        turn_id: "live".into(),
        item_id: "reasoning".into(),
        delta: delta.into(),
        summary_index: index,
    })
}

fn part_added(index: i64) -> ServerNotification {
    ServerNotification::ReasoningSummaryPartAdded(ReasoningSummaryPartAddedNotification {
        thread_id: "thread-review-filter".into(),
        turn_id: "live".into(),
        item_id: "reasoning".into(),
        summary_index: index,
    })
}

#[test]
fn streamed_indexed_parts_match_canonical_body_export_and_running_recovery() {
    let parts = [
        "**Status**\n\n<!-- -->",
        "**Plan**\n\nTests **passed**.",
        "Second paragraph",
        "**Next**\n<!-- -->",
    ];
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(Vec::new()));
    projection.start_turn("live".into());
    for (index, part) in parts.iter().enumerate() {
        projection.apply(part_added(index as i64));
        // Delta boundaries can bisect Markdown syntax.
        let split = part.len().min(3);
        projection.apply(summary_delta(index as i64, &part[..split]));
        projection.apply(summary_delta(index as i64, &part[split..]));
    }
    let streamed = projection.entries()[0].clone();
    assert_eq!(streamed.text, "\n\nTests **passed**.\n\nSecond paragraph");
    assert_eq!(projection.status(), "Next");
    let export =
        crate::app::transcript_export::render_markdown_transcript(projection.entries()).unwrap();
    assert!(export.contains("Tests **passed**.\n\nSecond paragraph"));
    assert!(
        !export.contains("**Status**")
            && !export.contains("**Plan**")
            && !export.contains("<!-- -->")
    );
    projection.hydrate_thread(test_thread(vec![test_turn(
        "live",
        TurnStatus::InProgress,
        vec![reasoning(&parts)],
    )]));
    // The in-progress tail is provisional host state, settled by the next live item/terminal.
    assert_eq!(projection.entries()[0], streamed);
    assert_eq!(projection.status(), "Next");
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            thread_id: "thread-review-filter".into(),
            turn_id: "live".into(),
            item: reasoning(&parts),
            completed_at_ms: 1,
        },
    ));
    let settled = projection.entries()[0].clone();
    projection.apply(part_added(9));
    projection.apply(summary_delta(9, "late"));
    assert_eq!(projection.entries()[0], settled);
    projection.hydrate_thread(test_thread(vec![test_turn(
        "live",
        TurnStatus::Completed,
        vec![reasoning(&parts)],
    )]));
    assert_eq!(projection.entries()[0], settled);
    projection.apply(summary_delta(0, "late after closed turn"));
    assert_eq!(projection.entries()[0], settled);
}

#[test]
fn part_added_is_idempotent_and_sparse_indexes_do_not_allocate_empty_parts() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("live".into());
    projection.apply(summary_delta(-1, "invalid"));
    projection.apply(part_added(-1));
    assert!(projection.entries().is_empty());
    projection.apply(summary_delta(i64::MAX, "last part"));
    projection.apply(part_added(i64::MAX));
    projection.apply(summary_delta(0, "first part"));
    projection.apply(part_added(0));
    assert_eq!(projection.entries()[0].text, "first part\n\nlast part");
    assert_eq!(projection.status(), "last part");
}

#[test]
fn placeholder_only_summary_updates_status_without_visible_or_exported_body() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("live".into());
    projection.apply(summary_delta(0, "**Checking tests**\n\n<!-- -->"));
    assert_eq!(projection.status(), "Checking tests");
    assert!(projection.entries()[0].text.is_empty());
    assert!(crate::entry::lines(&projection.entries()[0]).is_empty());
    assert!(
        crate::app::transcript_export::render_markdown_transcript(projection.entries()).is_err()
    );
    projection.apply(summary_delta(1, "**Important conclusion**"));
    assert_eq!(projection.entries()[0].text, "**Important conclusion**");
    assert_eq!(projection.status(), "Important conclusion");
}

fn reasoning(summary: &[&str]) -> ThreadItem {
    ThreadItem::Reasoning {
        id: "reasoning".into(),
        metadata: None,
        summary: summary.iter().map(|part| (*part).to_string()).collect(),
        content: vec!["RAW_REASONING_MUST_STAY_HIDDEN".into()],
    }
}

#[test]
fn raw_deltas_do_not_create_summary_entries_or_change_the_running_status() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(Vec::new()));
    projection.start_turn("live".into());
    projection.apply(raw_delta("live", "reasoning"));
    assert!(projection.entries().is_empty());
    assert_eq!(projection.status(), "running");

    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-review-filter".into(),
            turn_id: "live".into(),
            item_id: "reasoning".into(),
            delta: "**Checking tests**".into(),
            summary_index: 0,
        },
    ));
    projection.apply(raw_delta("live", "reasoning"));
    assert_eq!(projection.status(), "Checking tests");
    assert_eq!(projection.entries()[0].text, "**Checking tests**");
}

#[test]
fn canonical_raw_only_reasoning_has_no_visible_or_exported_content() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "done",
        TurnStatus::Completed,
        vec![reasoning(&[])],
    )]));
    let entry = &projection.entries()[0];
    assert!(entry.text.is_empty());
    assert!(crate::entry::lines(entry).is_empty());
    assert!(
        crate::app::transcript_export::render_markdown_transcript(projection.entries()).is_err()
    );
    projection.apply(raw_delta("done", "reasoning"));
    assert!(projection.entries()[0].text.is_empty());
}

#[test]
fn completed_summary_is_authoritative_across_streaming_and_cold_hydration() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(Vec::new()));
    projection.start_turn("live".into());
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            thread_id: "thread-review-filter".into(),
            turn_id: "live".into(),
            item: reasoning(&["visible summary", "second part"]),
            completed_at_ms: 1,
        },
    ));
    projection.apply(raw_delta("live", "reasoning"));
    let expected = projection.entries()[0].text.clone();
    assert_eq!(expected, "visible summary\n\nsecond part");
    assert!(!projection.entries()[0].streaming);
    let exported =
        crate::app::transcript_export::render_markdown_transcript(projection.entries()).unwrap();
    assert!(exported.contains("visible summary"));
    assert!(!exported.contains("RAW_REASONING_MUST_STAY_HIDDEN"));
    projection.hydrate_thread(test_thread(vec![test_turn(
        "live",
        TurnStatus::Completed,
        vec![reasoning(&["visible summary", "second part"])],
    )]));
    assert_eq!(projection.entries()[0].text, expected);
}
