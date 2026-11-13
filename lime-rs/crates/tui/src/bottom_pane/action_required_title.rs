//! Shared action-required presentation for pending App Server interactions.
//!
//! 上游 keeps the action-required title assembly independent from the source of each value.
//! Lime follows the same boundary: the current `BottomPane` request remains the fact source and
//! this module only joins already-localized display values.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ActionRequiredItem {
    Approval,
    UserInput,
    McpElicitation,
}

/// Prefix used by the action-required row before the localized request detail.
pub(crate) const ACTION_REQUIRED_PREVIEW_PREFIX: &str = "[ ! ]";

pub(crate) fn build_action_required_title_text<I, F>(
    prefix: &str,
    items: I,
    excluded_items: &[ActionRequiredItem],
    mut value_for: F,
) -> String
where
    I: IntoIterator<Item = ActionRequiredItem>,
    F: FnMut(ActionRequiredItem) -> Option<String>,
{
    let mut parts = vec![prefix.to_string()];
    for item in items {
        if excluded_items.contains(&item) {
            continue;
        }
        if let Some(value) = value_for(item).filter(|value| !value.trim().is_empty()) {
            parts.push(value);
        }
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_only_visible_action_required_values() {
        let text = build_action_required_title_text(
            ACTION_REQUIRED_PREVIEW_PREFIX,
            [
                ActionRequiredItem::Approval,
                ActionRequiredItem::UserInput,
                ActionRequiredItem::McpElicitation,
            ],
            &[ActionRequiredItem::UserInput],
            |item| match item {
                ActionRequiredItem::Approval => Some("Approve command?".to_string()),
                ActionRequiredItem::UserInput => Some("Choose a mode".to_string()),
                ActionRequiredItem::McpElicitation => Some("MCP request".to_string()),
            },
        );

        assert_eq!(text, "[ ! ] Approve command? MCP request");
    }

    #[test]
    fn empty_values_do_not_create_trailing_separators() {
        let text = build_action_required_title_text(
            ACTION_REQUIRED_PREVIEW_PREFIX,
            [ActionRequiredItem::Approval],
            &[],
            |_| Some("  ".to_string()),
        );

        assert_eq!(text, ACTION_REQUIRED_PREVIEW_PREFIX);
    }
}
