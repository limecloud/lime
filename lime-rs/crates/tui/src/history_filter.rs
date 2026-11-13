use std::collections::HashSet;

use app_server_protocol::protocol::v2::{ThreadItem, Turn, TurnStatus};

/// Return canonical ids of user messages that 上游 does not show in history.
///
/// Review prompts are agent-only inputs persisted in the canonical thread. The
/// nested interrupted turn rule is intentionally based on turn/item identity,
/// never on rendered text.
pub(crate) fn hidden_user_message_ids(turns: &[Turn]) -> HashSet<String> {
    let mut hidden = HashSet::new();
    let mut review_mode = false;

    for (index, turn) in turns.iter().enumerate() {
        let hidden_nested = index
            .checked_sub(1)
            .and_then(|previous| turns.get(previous))
            .is_some_and(|previous| is_hidden_nested_review_turn(previous, turn));

        for item in &turn.items {
            match item {
                ThreadItem::EnteredReviewMode { .. } => review_mode = true,
                ThreadItem::ExitedReviewMode { .. } => review_mode = false,
                ThreadItem::UserMessage { id, .. } if review_mode || hidden_nested => {
                    hidden.insert(id.clone());
                }
                _ => {}
            }
        }
    }

    hidden
}

/// Filter a flat page without guessing review state from items outside the page.
///
/// thread/items/list does not carry turn status, so nested-review detection is
/// deliberately deferred to full Thread hydration.
pub(crate) fn filter_review_mode_items(items: &[ThreadItem]) -> Vec<ThreadItem> {
    filter_review_mode_items_with_state(items, false)
}

pub(crate) fn filter_review_mode_items_with_state(
    items: &[ThreadItem],
    initial_review_mode: bool,
) -> Vec<ThreadItem> {
    let mut review_mode = initial_review_mode;
    items
        .iter()
        .filter_map(|item| match item {
            ThreadItem::EnteredReviewMode { .. } => {
                review_mode = true;
                Some(item.clone())
            }
            ThreadItem::ExitedReviewMode { .. } => {
                review_mode = false;
                Some(item.clone())
            }
            ThreadItem::UserMessage { .. } if review_mode => None,
            _ => Some(item.clone()),
        })
        .collect()
}

/// Filter canonical user messages whose ids were classified from complete Turn metadata.
///
/// This is intentionally separate from the page-local review-boundary filter: a paginated item
/// page may not contain the `EnteredReviewMode` item that established the state, while Turn
/// metadata still gives us stable canonical ids for the messages that must remain hidden.
pub(crate) fn filter_user_message_ids(
    items: &[ThreadItem],
    hidden_ids: &HashSet<String>,
) -> Vec<ThreadItem> {
    items
        .iter()
        .filter(|item| user_message_id(item).is_none_or(|id| !hidden_ids.contains(id)))
        .cloned()
        .collect()
}

pub(crate) fn is_hidden_nested_review_turn(previous: &Turn, turn: &Turn) -> bool {
    if previous.status != TurnStatus::Completed
        || turn.status != TurnStatus::Interrupted
        || turn.completed_at.is_some()
        || !previous
            .items
            .iter()
            .any(|item| matches!(item, ThreadItem::EnteredReviewMode { .. }))
        || !previous
            .items
            .iter()
            .any(|item| matches!(item, ThreadItem::ExitedReviewMode { .. }))
    {
        return false;
    }

    let mut user_messages = turn.items.iter().filter_map(|item| match item {
        ThreadItem::UserMessage { content, .. } => Some(content),
        _ => None,
    });

    matches!(
        (user_messages.next(), user_messages.next(), user_messages.next()),
        (Some(first), Some(second), None) if first == second
    )
}

pub(crate) fn user_message_id(item: &ThreadItem) -> Option<&str> {
    match item {
        ThreadItem::UserMessage { id, .. } => Some(id),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{ThreadItem, Turn, TurnItemsView, UserInput};

    fn text_message(id: &str, text: &str) -> ThreadItem {
        ThreadItem::UserMessage {
            id: id.to_string(),
            client_id: None,
            content: vec![UserInput::Text {
                text: text.to_string(),
                text_elements: Vec::new(),
            }],
        }
    }

    fn turn(id: &str, status: TurnStatus, items: Vec<ThreadItem>) -> Turn {
        Turn {
            id: id.to_string(),
            items,
            items_view: TurnItemsView::Full,
            status,
            error: None,
            started_at: Some(1),
            completed_at: None,
            duration_ms: None,
        }
    }

    fn entered(id: &str) -> ThreadItem {
        ThreadItem::EnteredReviewMode {
            id: id.to_string(),
            review: "review".to_string(),
        }
    }

    fn exited(id: &str) -> ThreadItem {
        ThreadItem::ExitedReviewMode {
            id: id.to_string(),
            review: "review".to_string(),
        }
    }

    #[test]
    fn hides_user_messages_inside_review_interval() {
        let turns = vec![turn(
            "turn-1",
            TurnStatus::Completed,
            vec![
                entered("enter"),
                text_message("hidden", "prompt"),
                exited("exit"),
            ],
        )];

        assert_eq!(
            hidden_user_message_ids(&turns),
            HashSet::from(["hidden".to_string()])
        );
    }

    #[test]
    fn hides_only_unfinished_nested_duplicate_review_turn() {
        let previous = turn(
            "turn-1",
            TurnStatus::Completed,
            vec![entered("enter"), exited("exit")],
        );
        let current = turn(
            "turn-2",
            TurnStatus::Interrupted,
            vec![text_message("one", "same"), text_message("two", "same")],
        );

        assert!(is_hidden_nested_review_turn(&previous, &current));
        assert_eq!(
            hidden_user_message_ids(&[previous, current]),
            HashSet::from(["one".to_string(), "two".to_string()])
        );
    }

    #[test]
    fn completed_at_prevents_nested_review_hiding() {
        let previous = turn(
            "turn-1",
            TurnStatus::Completed,
            vec![entered("enter"), exited("exit")],
        );
        let mut current = turn(
            "turn-2",
            TurnStatus::Interrupted,
            vec![text_message("one", "same"), text_message("two", "same")],
        );
        current.completed_at = Some(2);

        assert!(!is_hidden_nested_review_turn(&previous, &current));
        assert!(hidden_user_message_ids(&[previous, current]).is_empty());
    }

    #[test]
    fn flat_page_only_filters_explicit_review_boundary() {
        let items = vec![
            text_message("before", "before"),
            entered("enter"),
            text_message("hidden", "hidden"),
            exited("exit"),
            text_message("after", "after"),
        ];
        let filtered = filter_review_mode_items(&items);
        assert_eq!(
            filtered
                .iter()
                .filter_map(user_message_id)
                .collect::<Vec<_>>(),
            vec!["before", "after"]
        );
    }

    #[test]
    fn flat_page_can_continue_an_existing_review_interval() {
        let items = vec![
            text_message("hidden", "hidden"),
            exited("exit"),
            text_message("after", "after"),
        ];
        let filtered = filter_review_mode_items_with_state(&items, true);
        assert_eq!(
            filtered
                .iter()
                .filter_map(user_message_id)
                .collect::<Vec<_>>(),
            vec!["after"]
        );
    }

    #[test]
    fn canonical_ids_filter_cross_page_review_messages_without_text_matching() {
        let items = vec![
            text_message("hidden", "same"),
            text_message("visible", "same"),
        ];
        let filtered = filter_user_message_ids(&items, &HashSet::from([String::from("hidden")]));
        assert_eq!(
            filtered
                .iter()
                .filter_map(user_message_id)
                .collect::<Vec<_>>(),
            vec!["visible"]
        );
    }
}
