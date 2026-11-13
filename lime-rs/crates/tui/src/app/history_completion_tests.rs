//! Pagination completion boundaries preserve 上游 item grouping semantics.

use super::*;
use app_server_protocol::protocol::v2::{ThreadItem, TurnItemsView, TurnStatus};

fn turn(id: &str, status: TurnStatus, item_ids: &[&str]) -> Turn {
    Turn {
        id: id.to_string(),
        items: item_ids
            .iter()
            .map(|id| ThreadItem::UserMessage {
                id: id.to_string(),
                client_id: None,
                content: Vec::new(),
            })
            .collect(),
        items_view: TurnItemsView::Summary,
        status,
        error: None,
        started_at: Some(1_700_000_000),
        completed_at: Some(1_700_000_001),
        duration_ms: Some(125_000),
    }
}

#[test]
fn split_turn_only_completes_on_the_page_with_its_last_item() {
    let turns = vec![turn(
        "turn",
        TurnStatus::Completed,
        &["first", "second", "last"],
    )];
    assert!(
        group_completed_turn_items(turns[0].items[1..].to_vec(), &turns)[0]
            .completion
            .is_some()
    );
    assert!(
        group_completed_turn_items(turns[0].items[..1].to_vec(), &turns)[0]
            .completion
            .is_none()
    );
}

#[test]
fn multiple_turns_keep_item_groups_and_completion_order() {
    let turns = vec![
        turn("first", TurnStatus::Completed, &["a", "b"]),
        turn("second", TurnStatus::Completed, &["c", "d"]),
    ];
    let items = turns
        .iter()
        .flat_map(|turn| turn.items.clone())
        .collect::<Vec<_>>();
    let groups = group_completed_turn_items(items, &turns);
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].items.len(), 2);
    assert_eq!(groups[0].activity_scope.as_deref(), Some("first"));
    assert_eq!(groups[1].items.len(), 2);
    assert_eq!(groups[1].activity_scope.as_deref(), Some("second"));
    assert_eq!(
        groups[0]
            .completion
            .as_ref()
            .and_then(|boundary| boundary.elapsed_seconds),
        Some(125)
    );
    assert_eq!(
        groups[1]
            .completion
            .as_ref()
            .and_then(|boundary| boundary.elapsed_seconds),
        Some(125)
    );
}

#[test]
fn unsuccessful_and_running_turns_do_not_create_completion_boundaries() {
    let turns = vec![
        turn("failed", TurnStatus::Failed, &["a"]),
        turn("interrupted", TurnStatus::Interrupted, &["b"]),
        turn("running", TurnStatus::InProgress, &["c"]),
    ];
    let items = turns
        .iter()
        .flat_map(|turn| turn.items.clone())
        .collect::<Vec<_>>();
    let groups = group_completed_turn_items(items, &turns);
    assert_eq!(groups.len(), 3);
    assert_eq!(
        groups
            .iter()
            .map(|group| group.activity_scope.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("failed"), Some("interrupted"), Some("running")]
    );
    assert!(groups.iter().all(|group| group.completion.is_none()));
}

#[test]
fn items_missing_turn_identity_are_grouped_without_activity_scope() {
    let unknown = turn("unknown", TurnStatus::Completed, &["outside"])
        .items
        .into_iter()
        .next()
        .expect("unknown item");
    let groups = group_completed_turn_items(vec![unknown], &[]);

    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].activity_scope, None);
    assert_eq!(groups[0].completion, None);
}
