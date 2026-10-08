use std::path::Path;

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthStr;

use crate::diff_render;
use crate::exec_cell::{output_lines, CommandOutput, OutputLinesParams};
use crate::history_cell::{HistoryCell, ReasoningSummaryCell};
use crate::locale::Locale;
use crate::markdown_render;
use crate::projection::{EntryKind, EntryStatus, TranscriptEntry};
use crate::style::{
    accent_style, attention_style, failure_style, muted_style, status_style, user_message_style,
    StatusTone,
};
use crate::terminal_hyperlinks::{prefix_hyperlink_lines, HyperlinkLine};
use crate::wrapping::{adaptive_wrap_lines, RtOptions};

#[cfg(test)]
pub(crate) fn lines(entry: &TranscriptEntry) -> Vec<Line<'static>> {
    hyperlink_lines_with_locale(entry, Locale::default(), None, Path::new(""))
        .into_iter()
        .map(|line| line.line)
        .collect()
}

pub(crate) fn hyperlink_lines_with_locale(
    entry: &TranscriptEntry,
    locale: Locale,
    width: Option<usize>,
    cwd: &Path,
) -> Vec<HyperlinkLine> {
    if entry.kind == EntryKind::Reasoning {
        return ReasoningSummaryCell::new(entry.text.clone(), cwd).transcript_hyperlink_lines(
            width
                .unwrap_or(usize::from(u16::MAX))
                .min(usize::from(u16::MAX)) as u16,
        );
    }
    let (prefix, prefix_style, text_style) = styles(entry.kind);
    let rich_lines = match entry.kind {
        EntryKind::Assistant => Some(markdown_render::render_markdown_lines_with_width_and_cwd(
            &entry.text,
            text_style,
            width,
            cwd,
        )),
        EntryKind::Warning | EntryKind::Error => Some(notice_content_lines(
            &entry.text,
            text_style,
            width.map(|width| width.saturating_sub(UnicodeWidthStr::width(prefix)).max(1)),
        )),
        EntryKind::Patch => Some(
            diff_render::render(
                &entry.text,
                width.map(|width| width.saturating_sub(UnicodeWidthStr::width(prefix))),
                cwd,
            )
            .into_iter()
            .map(HyperlinkLine::new)
            .collect(),
        ),
        _ => None,
    };
    if let Some(mut rendered) = rich_lines {
        if rendered.is_empty() {
            rendered.push(HyperlinkLine::default());
        }
        rendered = prefix_hyperlink_lines(
            rendered,
            Span::styled(prefix, prefix_style),
            Span::styled("  ", prefix_style),
        );
        if let Some(status) = entry.status {
            if let Some(line) = rendered.first_mut() {
                line.push_span(
                    Span::styled(
                        format!(" [{}]", locale.status(status.label())),
                        entry_status_style(status),
                    ),
                    None,
                );
            }
        }
        rendered.extend(entry.summary.iter().map(|detail| {
            let detail = formatted_summary(entry.kind, detail, locale);
            HyperlinkLine::new(format_line(
                entry.kind,
                "  ",
                prefix_style,
                continuation_style(entry.kind, text_style),
                &detail,
            ))
        }));
        return rendered;
    }
    let mut source = entry.text.lines();
    let first = source.next().unwrap_or("");
    let first = match entry.kind {
        EntryKind::Tool | EntryKind::System => locale.detail(&localized_tool_detail(first, cwd)),
        EntryKind::MultiAgent => locale.multi_agent(first),
        _ => first.to_string(),
    };
    let mut first_line = format_line(entry.kind, prefix, prefix_style, text_style, &first);
    if let Some(status) = entry.status {
        first_line.spans.push(Span::styled(
            format!(" [{}]", locale.status(status.label())),
            entry_status_style(status),
        ));
    }
    let mut lines = vec![HyperlinkLine::new(first_line)];
    if entry.kind == EntryKind::Command {
        let output = CommandOutput::from_lines(source, locale);
        let rendered_output = output_lines(
            Some(&output),
            OutputLinesParams {
                line_limit: 50,
                only_err: false,
                include_angle_pipe: false,
                include_prefix: false,
                locale,
            },
        );
        lines.extend(rendered_output.lines.iter().map(|line| {
            HyperlinkLine::new(format_line(
                entry.kind,
                "  ",
                prefix_style,
                continuation_style(entry.kind, text_style),
                line,
            ))
        }));
    } else {
        lines.extend(source.map(|line| {
            HyperlinkLine::new(format_line(
                entry.kind,
                "  ",
                prefix_style,
                continuation_style(entry.kind, text_style),
                line,
            ))
        }));
    }
    lines.extend(entry.summary.iter().map(|detail| {
        let detail = formatted_summary(entry.kind, detail, locale);
        HyperlinkLine::new(format_line(
            entry.kind,
            "  ",
            prefix_style,
            continuation_style(entry.kind, text_style),
            &detail,
        ))
    }));
    lines
}

/// Compact activity presentation used by the full-screen transcript disclosure owner.
///
/// The canonical entry remains unchanged: only the invocation/title line is retained while
/// output, diffs, plan steps, and summary facts stay available through the expanded rendering.
pub(crate) fn compact_hyperlink_lines_with_locale(
    entry: &TranscriptEntry,
    locale: Locale,
    width: Option<usize>,
    cwd: &Path,
) -> Vec<HyperlinkLine> {
    let mut compact = entry.clone();
    compact.text = entry.text.lines().next().unwrap_or_default().to_string();
    compact.summary.clear();
    hyperlink_lines_with_locale(&compact, locale, width, cwd)
}

fn localized_tool_detail(detail: &str, cwd: &Path) -> String {
    detail
        .strip_prefix("view image: ")
        .map(|path| format!("view image: {}", diff_render::display_path_for(path, cwd)))
        .unwrap_or_else(|| detail.to_string())
}

fn formatted_summary(kind: EntryKind, detail: &str, locale: Locale) -> String {
    if kind == EntryKind::User {
        if let Some(index) = detail.strip_prefix("image: ") {
            if !index.is_empty() {
                return locale.numbered_image_label(index);
            }
        }
    }
    format!("- {}", locale.detail(detail))
}

fn entry_status_style(status: EntryStatus) -> Style {
    match status {
        EntryStatus::Completed => status_style(StatusTone::Success),
        EntryStatus::Running => attention_style(),
        EntryStatus::Failed | EntryStatus::Declined | EntryStatus::Interrupted => failure_style(),
    }
}

fn styles(kind: EntryKind) -> (&'static str, Style, Style) {
    match kind {
        EntryKind::User => ("› ", accent_style(), user_message_style()),
        EntryKind::Assistant => ("  ", Style::default(), Style::default()),
        EntryKind::Reasoning => (
            "• ",
            muted_style(),
            muted_style().add_modifier(Modifier::ITALIC),
        ),
        EntryKind::Command => (
            "$ ",
            Style::default().fg(Color::Yellow),
            Style::default().fg(Color::Yellow),
        ),
        EntryKind::Patch => ("Δ ", Style::default().fg(Color::Blue), Style::default()),
        EntryKind::Mcp => ("@ ", Style::default().fg(Color::Magenta), Style::default()),
        EntryKind::Plan => (
            "• ",
            accent_style(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        EntryKind::MultiAgent => (
            "& ",
            Style::default().fg(Color::LightCyan),
            Style::default(),
        ),
        EntryKind::Tool => ("• ", Style::default().fg(Color::Yellow), Style::default()),
        EntryKind::Warning => ("⚠ ", attention_style(), attention_style()),
        EntryKind::Error => ("■ ", failure_style(), failure_style()),
        EntryKind::System => ("! ", failure_style(), failure_style()),
    }
}

fn notice_content_lines(
    text: &str,
    style: Style,
    content_width: Option<usize>,
) -> Vec<HyperlinkLine> {
    let lines = text
        .lines()
        .map(|line| Line::styled(line.to_string(), style))
        .collect::<Vec<_>>();
    let lines = match content_width {
        Some(width) => adaptive_wrap_lines(lines, RtOptions::new(width)),
        None => lines,
    };
    lines.into_iter().map(HyperlinkLine::new).collect()
}

fn continuation_style(kind: EntryKind, base_style: Style) -> Style {
    if kind == EntryKind::Command {
        muted_style()
    } else {
        base_style
    }
}

fn format_line(
    kind: EntryKind,
    prefix: &'static str,
    prefix_style: Style,
    base_style: Style,
    text: &str,
) -> Line<'static> {
    let text_style = match kind {
        EntryKind::Plan if text.starts_with("[x]") => {
            muted_style().add_modifier(Modifier::CROSSED_OUT)
        }
        EntryKind::Plan if text.starts_with("[~]") => accent_style(),
        EntryKind::Plan if text.starts_with("[ ]") => muted_style(),
        _ => base_style,
    };
    Line::from(vec![
        Span::styled(prefix, prefix_style),
        Span::styled(text.to_string(), text_style),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: EntryKind, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            id: "entry-1".to_string(),
            kind,
            text: text.to_string(),
            streaming: false,
            status: (kind == EntryKind::Command).then_some(EntryStatus::Running),
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }
    }

    #[test]
    fn item_kinds_have_distinct_terminal_layouts() {
        let command = lines(&entry(EntryKind::Command, "cargo test\nfinished"));
        let patch = lines(&entry(EntryKind::Patch, "updated src/lib.rs\n+new"));
        let mcp = lines(&entry(EntryKind::Mcp, "server.tool [Completed]"));
        let plan = lines(&entry(EntryKind::Plan, "[~] run tests"));
        let multi_agent = lines(&entry(EntryKind::MultiAgent, "SpawnAgent [InProgress]"));

        assert_eq!(command[0].spans[0].content.as_ref(), "$ ");
        assert!(command[0]
            .spans
            .iter()
            .any(|span| span.content.contains("[running]")));
        assert_eq!(patch[0].spans[0].content.as_ref(), "Δ ");
        assert_eq!(mcp[0].spans[0].content.as_ref(), "@ ");
        assert_eq!(plan[0].spans[0].content.as_ref(), "• ");
        assert_eq!(multi_agent[0].spans[0].content.as_ref(), "& ");
        assert!(patch[1]
            .spans
            .iter()
            .any(|span| span.style.fg == Some(Color::Green)));
        assert!(command[1].spans[1]
            .style
            .add_modifier
            .contains(Modifier::DIM));
    }

    #[test]
    fn multi_agent_titles_are_localized_at_the_render_boundary() {
        let entry = entry(EntryKind::MultiAgent, "Spawned agent-1");
        let rendered =
            hyperlink_lines_with_locale(&entry, Locale::ZhCn, Some(80), Path::new("/workspace"));
        let text = rendered
            .iter()
            .flat_map(|line| line.line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains("已启动 agent-1"));
        assert!(!text.contains("Spawned agent-1"));
    }

    #[test]
    fn image_view_paths_are_relative_to_the_current_working_directory() {
        let rendered = hyperlink_lines_with_locale(
            &entry(EntryKind::Tool, "view image: /workspace/assets/result.png"),
            Locale::EnUs,
            Some(80),
            Path::new("/workspace"),
        )
        .into_iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");

        assert!(rendered.contains("view image: assets/result.png"));
        assert!(!rendered.contains("view image: /workspace/assets/result.png"));
    }

    #[test]
    fn user_image_summaries_use_numbered_labels_in_all_product_locales() {
        let mut entry = entry(EntryKind::User, "describe these");
        entry.summary = vec!["image: 1".to_string(), "image: 2".to_string()];

        for (locale, first, second) in [
            (Locale::ZhCn, "[图片 #1]", "[图片 #2]"),
            (Locale::ZhTw, "[圖片 #1]", "[圖片 #2]"),
            (Locale::EnUs, "[Image #1]", "[Image #2]"),
            (Locale::JaJp, "[画像 #1]", "[画像 #2]"),
            (Locale::KoKr, "[이미지 #1]", "[이미지 #2]"),
        ] {
            let rendered =
                hyperlink_lines_with_locale(&entry, locale, Some(80), Path::new("/workspace"))
                    .into_iter()
                    .map(|line| line.line.to_string())
                    .collect::<Vec<_>>()
                    .join("\n");
            assert!(rendered.contains(first), "missing {first}: {rendered}");
            assert!(rendered.contains(second), "missing {second}: {rendered}");
        }
    }

    #[test]
    fn plan_statuses_use_stable_checkbox_styles() {
        let completed = lines(&entry(EntryKind::Plan, "[x] inspect"));
        let running = lines(&entry(EntryKind::Plan, "[~] test"));
        let pending = lines(&entry(EntryKind::Plan, "[ ] ship"));

        assert!(completed[0].spans[1]
            .style
            .add_modifier
            .contains(Modifier::CROSSED_OUT));
        assert!(running[0].spans[1]
            .style
            .add_modifier
            .contains(Modifier::BOLD));
        assert!(pending[0].spans[1]
            .style
            .add_modifier
            .contains(Modifier::DIM));
    }

    #[test]
    fn lifecycle_status_suffixes_use_the_shared_semantic_tones() {
        crate::terminal_palette::with_test_default_colors(
            crate::terminal_probe::DefaultColors {
                fg: (255, 255, 255),
                bg: (0, 0, 0),
            },
            || {
                for (status, expected) in [
                    (EntryStatus::Completed, Color::Green),
                    (EntryStatus::Running, Color::Yellow),
                    (EntryStatus::Failed, Color::Red),
                ] {
                    let mut item = entry(EntryKind::Mcp, "server.tool");
                    item.status = Some(status);
                    let rendered = lines(&item);
                    assert_eq!(
                        rendered[0].spans.last().and_then(|span| span.style.fg),
                        Some(expected)
                    );
                }
            },
        );
    }

    #[test]
    fn warning_and_error_notices_use_codex_markers_and_bounded_wrapping() {
        crate::terminal_palette::with_test_default_colors(
            crate::terminal_probe::DefaultColors {
                fg: (255, 255, 255),
                bg: (0, 0, 0),
            },
            || {
                for (kind, marker, color) in [
                    (EntryKind::Warning, "⚠ ", Color::Yellow),
                    (EntryKind::Error, "■ ", Color::Red),
                ] {
                    for width in [40, 80, 120] {
                        let rendered = hyperlink_lines_with_locale(
                            &entry(
                                kind,
                                "401 Unauthorized: provider credentials expired before the request completed; refresh them and retry",
                            ),
                            Locale::EnUs,
                            Some(width),
                            Path::new("/workspace"),
                        );
                        assert_eq!(rendered[0].line.spans[0].content, marker);
                        assert_eq!(rendered[0].line.spans[0].style.fg, Some(color));
                        assert!(rendered.iter().all(|line| line.line.width() <= width));
                        assert!(rendered
                            .iter()
                            .skip(1)
                            .all(|line| line.line.spans[0].content == "  "));
                    }
                }
            },
        );
    }

    #[test]
    fn assistant_markdown_is_rendered_at_the_transcript_boundary() {
        let rendered = lines(&entry(
            EntryKind::Assistant,
            "# Result\n\n**completed** with `cargo test`",
        ));
        let text = rendered
            .iter()
            .flat_map(|line| line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains("# Result"));
        assert!(text.contains("completed"));
        assert!(rendered.iter().any(|line| {
            line.spans
                .iter()
                .any(|span| span.style.add_modifier.contains(Modifier::BOLD))
        }));
        assert!(rendered.iter().any(|line| {
            line.spans
                .iter()
                .any(|span| span.style.fg == Some(Color::Cyan))
        }));
    }

    #[test]
    fn reasoning_markdown_keeps_reasoning_tone_and_inline_emphasis() {
        let rendered = lines(&entry(EntryKind::Reasoning, "**Inspecting** `src/lib.rs`"));

        assert!(rendered.iter().flat_map(|line| &line.spans).any(|span| {
            span.style.add_modifier.contains(Modifier::DIM)
                && span.style.add_modifier.contains(Modifier::BOLD)
        }));
        assert!(rendered
            .iter()
            .flat_map(|line| &line.spans)
            .any(|span| span.content == "src/lib.rs" && span.style.fg == Some(Color::Cyan)));
    }
}
