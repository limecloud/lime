//! Web-search detail shaping for canonical transcript entries.
//
// The App Server v2 item keeps the action as an opaque JSON value. This owner
// performs the narrow typed lowering that 上游 exposes at the history-cell
// boundary and fails closed to the canonical query for unknown wire shapes.

use agent_protocol::response_item::WebSearchAction;

pub(crate) fn web_search_detail(query: &str, action: Option<&serde_json::Value>) -> String {
    let Some(action) = action
        .cloned()
        .and_then(|value| serde_json::from_value::<WebSearchAction>(value).ok())
    else {
        return query.to_string();
    };

    let detail = match action {
        WebSearchAction::Search { query, queries } => {
            query.filter(|value| !value.is_empty()).unwrap_or_else(|| {
                let first = queries
                    .as_ref()
                    .and_then(|values| values.first())
                    .cloned()
                    .unwrap_or_default();
                if queries.as_ref().is_some_and(|values| values.len() > 1) && !first.is_empty() {
                    format!("{first} ...")
                } else {
                    first
                }
            })
        }
        WebSearchAction::OpenPage { url } => url.unwrap_or_default(),
        WebSearchAction::FindInPage { url, pattern } => match (pattern, url) {
            (Some(pattern), Some(url)) => format!("'{pattern}' in {url}"),
            (Some(pattern), None) => format!("'{pattern}'"),
            (None, Some(url)) => url,
            (None, None) => String::new(),
        },
        WebSearchAction::Other => String::new(),
    };

    if detail.is_empty() {
        query.to_string()
    } else {
        detail
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn web_search_detail_prefers_typed_action_fields() {
        assert_eq!(
            web_search_detail(
                "canonical",
                Some(
                    &json!({"type": "find_in_page", "url": "https://example.test", "pattern": "release"})
                ),
            ),
            "'release' in https://example.test"
        );
        assert_eq!(
            web_search_detail(
                "canonical",
                Some(&json!({"type": "search", "queries": ["first", "second"]})),
            ),
            "first ..."
        );
    }

    #[test]
    fn web_search_detail_fails_closed_to_query() {
        for action in [
            json!("search_query"),
            json!({"type": "future_action", "url": "https://hidden.example"}),
            json!({"type": "open_page", "url": 42}),
            json!({"type": "search", "queries": [42]}),
        ] {
            assert_eq!(
                web_search_detail("canonical query", Some(&action)),
                "canonical query"
            );
        }
    }
}
