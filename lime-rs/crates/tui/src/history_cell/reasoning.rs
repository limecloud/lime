//! Transcript-only reasoning bodies; activity headings remain in the live status row.

use std::path::{Path, PathBuf};

use ratatui::style::Style;
use ratatui::text::{Line, Span};

use super::HistoryCell;
use crate::markdown_render;
use crate::terminal_hyperlinks::{
    prefix_hyperlink_lines, visible_lines_ref, wrap_hyperlink_line, HyperlinkLine,
};

/// Preserve structured part boundaries when dropping standalone empty placeholders.
pub(crate) fn split_reasoning_summary_parts(parts: &[String]) -> (String, String) {
    let mut leading_empty_part_header = None;
    let mut content_parts = Vec::with_capacity(parts.len());
    for part in parts {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let header_end = part.strip_prefix("**").and_then(|after_open| {
            after_open
                .find("**")
                .and_then(|close| (close > 0).then_some(close + 4))
        });
        let body = header_end.map_or(part, |end| &part[end..]);
        if body.trim() == "<!-- -->" {
            if content_parts.is_empty() && leading_empty_part_header.is_none() {
                if let Some(end) = header_end {
                    leading_empty_part_header = Some(part[..end].to_string());
                }
            }
            continue;
        }
        content_parts.push(part);
    }
    let content = content_parts.join("\n\n");
    if let Some(after_open) = content.strip_prefix("**") {
        if let Some(close) = after_open.find("**") {
            let after_close_idx = 2 + close + 2;
            let after_close = &content[after_close_idx..];
            if after_close.starts_with('\n') || after_close.starts_with('\r') {
                return (
                    content[..after_close_idx].to_string(),
                    after_close.to_string(),
                );
            }
        }
    }
    (leading_empty_part_header.unwrap_or_default(), content)
}

#[derive(Debug)]
pub(crate) struct ReasoningSummaryCell {
    content: String,
    cwd: PathBuf,
}

impl ReasoningSummaryCell {
    pub(crate) fn new(content: String, cwd: &Path) -> Self {
        Self {
            content,
            cwd: cwd.to_path_buf(),
        }
    }
}

impl HistoryCell for ReasoningSummaryCell {
    fn display_lines(&self, _width: u16) -> Vec<Line<'static>> {
        Vec::new()
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        Vec::new()
    }

    fn transcript_lines(&self, width: u16) -> Vec<Line<'static>> {
        visible_lines_ref(&self.transcript_hyperlink_lines(width))
    }

    fn transcript_hyperlink_lines(&self, width: u16) -> Vec<HyperlinkLine> {
        if self.content.trim().is_empty() {
            return Vec::new();
        }
        let summary_style = Style::default().dim().italic();
        let body_width = usize::from(width.saturating_sub(2).max(1));
        let mut lines = markdown_render::render_markdown_lines_with_width_and_cwd(
            &self.content,
            summary_style,
            Some(body_width),
            &self.cwd,
        );
        for line in &mut lines {
            for span in &mut line.line.spans {
                span.style = span.style.patch(summary_style);
            }
        }
        prefix_hyperlink_lines(
            lines
                .into_iter()
                .flat_map(|line| wrap_hyperlink_line(&line, body_width))
                .collect(),
            Span::styled("• ", Style::default().dim()),
            Span::raw("  "),
        )
    }
}

#[cfg(test)]
#[path = "reasoning_tests.rs"]
mod tests;
