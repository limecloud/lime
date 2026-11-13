//! Bounded MCP result summaries for the canonical transcript projection.
//
// 上游 keeps MCP result shaping in a dedicated history-cell owner. Lime receives
// already bounded v2 content from App Server and retains only deterministic
// display facts; media bodies and unknown wire payloads are never decoded here.

use app_server_protocol::protocol::v2::{McpToolCallError, McpToolCallResult};

pub(crate) fn summary(
    result: Option<&McpToolCallResult>,
    error: Option<&McpToolCallError>,
    duration_ms: Option<i64>,
) -> Vec<String> {
    let mut details = Vec::new();
    if let Some(result) = result {
        details.push(format!("result items: {}", result.content.len()));
        let content_types = content_type_summary(&result.content);
        if !content_types.is_empty() {
            details.push(format!("content types: {content_types}"));
        }
        details.extend(content_previews(&result.content));
        if let Some(value) = result.structured_content.as_ref() {
            details.push(format!(
                "structured content: {}",
                compact_text(&compact_json(value))
            ));
        }
        if let Some(meta) = result.meta.as_ref().and_then(serde_json::Value::as_object) {
            if meta.get("truncated").and_then(serde_json::Value::as_bool) == Some(true) {
                details.push("truncated".to_string());
            }
            if meta
                .get("outputAvailable")
                .and_then(serde_json::Value::as_bool)
                == Some(true)
            {
                details.push("output available".to_string());
            }
        }
    }
    if let Some(error) = error {
        details.push(format!("error: {}", compact_text(&error.message)));
    }
    if let Some(duration_ms) = duration_ms {
        details.push(format!("duration {duration_ms}ms"));
    }
    details
}

pub(crate) fn invocation_text(server: &str, tool: &str, arguments: &serde_json::Value) -> String {
    format!(
        "{server}.{tool}({})",
        compact_text(&compact_json(arguments))
    )
}

pub(crate) fn content_previews(content: &[serde_json::Value]) -> Vec<String> {
    content
        .iter()
        .filter_map(|block| {
            let kind = block.get("type").and_then(serde_json::Value::as_str)?;
            if kind != "text" {
                return None;
            }
            let text = block.get("text").and_then(serde_json::Value::as_str)?;
            (!text.trim().is_empty()).then(|| format!("output: {}", compact_text(text)))
        })
        .take(4)
        .collect()
}

pub(crate) fn compact_json(value: &serde_json::Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
}

/// Keep one-line MCP details bounded at the transcript boundary.
pub(crate) fn compact_text(value: &str) -> String {
    let value = value.lines().next().unwrap_or(value);
    let mut text = value.chars().take(160).collect::<String>();
    if value.chars().count() > 160 {
        text.push_str("...");
    }
    text
}

/// Summarize canonical content types without interpreting arbitrary wire blocks.
pub(crate) fn content_type_summary(content: &[serde_json::Value]) -> String {
    let mut counts = [0usize; 6];
    for block in content {
        let index = match block.get("type").and_then(serde_json::Value::as_str) {
            Some("text") => 0,
            Some("image") => 1,
            Some("audio") => 2,
            Some("resource") => 3,
            Some("resource_link") | Some("resourceLink") => 4,
            _ => 5,
        };
        counts[index] += 1;
    }
    const LABELS: [&str; 6] = [
        "text",
        "image",
        "audio",
        "resource",
        "resource-link",
        "unknown",
    ];
    LABELS
        .into_iter()
        .zip(counts)
        .filter(|(_, count)| *count > 0)
        .map(|(label, count)| format!("{label}={count}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{McpToolCallError, McpToolCallResult};
    use serde_json::json;

    #[test]
    fn summary_keeps_bounded_text_and_structured_facts() {
        let details = summary(
            Some(&McpToolCallResult {
                content: vec![
                    json!({"type": "text", "text": "first line\nsecond line"}),
                    json!({"type": "image", "data": "secret"}),
                    json!({"type": "resource_link", "uri": "file:///result.txt"}),
                    json!({"type": "future"}),
                ],
                structured_content: Some(json!({"matches": 1})),
                meta: Some(json!({"truncated": true, "outputAvailable": true})),
            }),
            Some(&McpToolCallError {
                message: "failed\nwith details".to_string(),
            }),
            Some(7),
        );

        assert_eq!(
            details,
            vec![
                "result items: 4",
                "content types: text=1, image=1, resource-link=1, unknown=1",
                "output: first line",
                "structured content: {\"matches\":1}",
                "truncated",
                "output available",
                "error: failed",
                "duration 7ms",
            ]
        );
        assert!(details.iter().all(|detail| !detail.contains("secret")));
    }

    #[test]
    fn content_previews_cap_items_and_length() {
        let content = vec![
            json!({"type": "text", "text": "a\nb"}),
            json!({"type": "text", "text": "x".repeat(161)}),
            json!({"type": "image", "data": "not retained"}),
            json!({"type": "text", "text": "c"}),
            json!({"type": "text", "text": "d"}),
            json!({"type": "text", "text": "e"}),
            json!({"type": "text", "text": "f"}),
        ];

        let previews = content_previews(&content);
        assert_eq!(previews.len(), 4);
        assert_eq!(previews[0], "output: a");
        assert_eq!(previews[1], format!("output: {}...", "x".repeat(160)));
        assert_eq!(previews[2], "output: c");
        assert_eq!(previews[3], "output: d");
    }
}
