//! Bounded display facts for CUA-backed MCP calls.
//!
//! 上游 groups adjacent computer calls into a dedicated history cell. Lime's canonical
//! projection preserves one `ThreadItem` per MCP call, so this owner first derives only facts that
//! are provable from each item, then composes adjacent facts for terminal presentation. It never
//! decodes media or creates a second persisted activity model.

use app_server_protocol::protocol::v2::{McpToolCallError, McpToolCallResult};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;

use super::compact_text;
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::projection::{ActivityDetail, EntryStatus, TranscriptEntry};
use crate::style::{failure_style, muted_style};
use crate::terminal_hyperlinks::HyperlinkLine;
use crate::wrapping::{adaptive_wrap_lines, RtOptions};

const COMPUTER_SERVER: &str = "cua_repl";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ComputerActivityFacts {
    pub(crate) title: String,
    pub(crate) screenshots: usize,
    pub(crate) error: Option<String>,
}

pub(crate) fn is_computer_activity(server: &str) -> bool {
    server == COMPUTER_SERVER
}

pub(crate) fn summary(
    arguments: &Value,
    result: Option<&McpToolCallResult>,
    error: Option<&McpToolCallError>,
) -> Vec<String> {
    let facts = facts(arguments, result, error);
    let mut details = vec![format!("computer action: {}", facts.title)];

    if let Some(error) = facts.error {
        details.push(format!("computer error: {error}"));
        return details;
    }

    if facts.screenshots > 0 {
        details.push(format!(
            "computer screenshot: {}",
            if facts.screenshots == 1 {
                "captured".to_string()
            } else {
                format!("{} captured", facts.screenshots)
            }
        ));
    }

    details
}

pub(crate) fn facts(
    arguments: &Value,
    result: Option<&McpToolCallResult>,
    error: Option<&McpToolCallError>,
) -> ComputerActivityFacts {
    let title = arguments
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(compact_text)
        .unwrap_or_else(|| "Computer action".to_string());

    if let Some(error) = error {
        return ComputerActivityFacts {
            title,
            screenshots: 0,
            error: Some(compact_text(&error.message)),
        };
    }

    let screenshots = result
        .map(|result| {
            result
                .content
                .iter()
                .filter(|content| content.get("type").and_then(Value::as_str) == Some("image"))
                .count()
        })
        .unwrap_or_default();

    // CUA providers commonly return a diagnostic as a text block. Preserve only its first
    // bounded line; manuals and raw provider payloads do not belong in the transcript.
    let error = result.and_then(|result| {
        result.content.iter().find_map(|content| {
            let text = content.get("text").and_then(Value::as_str)?;
            text.strip_prefix("Script error:")
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(compact_text)
        })
    });

    ComputerActivityFacts {
        title,
        screenshots,
        error,
    }
}

pub(crate) fn compact_hyperlink_lines(
    entries: &[TranscriptEntry],
    locale: Locale,
    width: u16,
) -> Vec<HyperlinkLine> {
    let width = usize::from(width.max(1));
    let entries = entries
        .iter()
        .filter(|entry| computer_facts(entry).is_some())
        .collect::<Vec<_>>();
    let active = entries
        .iter()
        .rposition(|entry| entry.streaming || entry.status == Some(EntryStatus::Running));
    let failures = entries
        .iter()
        .filter(|entry| computer_failed(entry))
        .count();
    let mut header = vec![
        Span::styled("•", muted_style()),
        Span::raw(" "),
        Span::styled(
            locale.transcript_computer_label(active.is_some()),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" · {}", locale.transcript_activity_count(entries.len())),
            muted_style(),
        ),
    ];
    if failures > 0 {
        header.push(Span::styled(
            format!(" · {}", locale.transcript_activity_failed_count(failures)),
            failure_style(),
        ));
    }
    let mut lines = adaptive_wrap_lines(
        [Line::from(header)],
        RtOptions::new(width).subsequent_indent("  ".into()),
    )
    .into_iter()
    .map(HyperlinkLine::new)
    .collect::<Vec<_>>();

    let mut selected = if let Some(index) = active {
        vec![index]
    } else {
        let mut indices = (0..entries.len()).collect::<Vec<_>>();
        indices.sort_by_key(|&index| {
            let facts = computer_facts(entries[index]);
            std::cmp::Reverse((
                computer_failed(entries[index]),
                facts.is_some_and(|facts| facts.screenshots > 0),
                index,
            ))
        });
        indices.truncate(if entries.len() > 3 { 2 } else { 3 });
        indices
    };
    selected.sort_unstable();
    let visible = selected.len();
    for (row_index, index) in selected.into_iter().enumerate() {
        let Some(facts) = computer_facts(entries[index]) else {
            unreachable!("entries were filtered to computer details");
        };
        let failed = computer_failed(entries[index]);
        let title = if facts.title == "Computer action" {
            locale.transcript_computer_action_label()
        } else {
            &facts.title
        };
        let text = if failed {
            locale.transcript_computer_failure(title, facts.error.as_deref())
        } else if facts.screenshots > 0 {
            locale.transcript_computer_capture(title)
        } else {
            title.to_string()
        };
        let style = if failed {
            failure_style()
        } else {
            muted_style()
        };
        let prefix = if row_index + 1 == visible {
            "  └ "
        } else {
            "  ├ "
        };
        let content = truncate_line_with_ellipsis_if_overflow(
            Line::from(Span::styled(text, style)),
            width.saturating_sub(4),
        );
        let mut row = Line::from(Span::styled(prefix, muted_style()));
        row.spans.extend(content.spans);
        lines.push(HyperlinkLine::new(row));
    }
    lines
        .into_iter()
        .map(|line| HyperlinkLine::new(truncate_line_with_ellipsis_if_overflow(line.line, width)))
        .collect()
}

fn computer_facts(entry: &TranscriptEntry) -> Option<&ComputerActivityFacts> {
    let ActivityDetail::Computer(facts) = entry.activity_detail.as_ref()? else {
        return None;
    };
    Some(facts)
}

fn computer_failed(entry: &TranscriptEntry) -> bool {
    computer_facts(entry).is_some_and(|facts| facts.error.is_some())
        || matches!(
            entry.status,
            Some(EntryStatus::Failed | EntryStatus::Declined | EntryStatus::Interrupted)
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{McpToolCallError, McpToolCallResult};
    use serde_json::json;

    #[test]
    fn computer_activity_keeps_title_and_screenshot_fact_without_media() {
        let details = summary(
            &json!({"title": "Capture calendar"}),
            Some(&McpToolCallResult {
                content: vec![json!({"type": "image", "data": "secret"})],
                structured_content: None,
                meta: None,
            }),
            None,
        );

        assert_eq!(
            details,
            vec![
                "computer action: Capture calendar",
                "computer screenshot: captured"
            ]
        );
        assert!(details.iter().all(|detail| !detail.contains("secret")));
    }

    #[test]
    fn computer_activity_bounds_provider_diagnostics() {
        let details = summary(
            &json!({}),
            None,
            Some(&McpToolCallError {
                message: "failed\nfull provider manual".to_string(),
            }),
        );

        assert_eq!(details[0], "computer action: Computer action");
        assert_eq!(details[1], "computer error: failed");
    }

    #[test]
    fn computer_activity_bounds_multiline_titles_before_projection() {
        let details = summary(
            &json!({"title": format!("{}\nprovider manual", "a".repeat(200))}),
            None,
            None,
        );

        assert_eq!(details.len(), 1);
        assert_eq!(
            details[0].chars().count(),
            "computer action: ".chars().count() + 163
        );
        assert!(details[0].ends_with("..."));
        assert!(!details[0].contains("provider manual"));
    }
}
