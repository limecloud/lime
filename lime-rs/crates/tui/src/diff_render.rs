use std::path::Path;

use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use unicode_segmentation::UnicodeSegmentation;

use crate::line_truncation::truncate_line_to_width;
use crate::render::highlight::{exceeds_highlight_limits, CodeLineHighlighter};
use crate::width::display_width;

const TAB_REPLACEMENT: &str = "    ";

mod style;
use style::{current_diff_render_style_context, DiffRenderStyleContext};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DiffLineKind {
    FileHeader,
    Hunk,
    Insert,
    Delete,
    Context,
    Metadata,
    Plain,
}

struct DiffLine {
    kind: DiffLineKind,
    number: Option<u64>,
    text: String,
    syntax: Option<Vec<Span<'static>>>,
}

pub(crate) fn render(input: &str, width: Option<usize>, cwd: &Path) -> Vec<Line<'static>> {
    render_with_style(input, width, cwd, current_diff_render_style_context())
}

fn render_with_style(
    input: &str,
    width: Option<usize>,
    cwd: &Path,
    style: DiffRenderStyleContext,
) -> Vec<Line<'static>> {
    let parsed = parse(input, cwd);
    let number_width = parsed
        .iter()
        .filter_map(|line| line.number)
        .map(decimal_width)
        .max()
        .unwrap_or(0)
        .max(4);

    parsed
        .into_iter()
        .flat_map(|line| render_line(line, number_width, width, style))
        .collect()
}

fn parse(input: &str, cwd: &Path) -> Vec<DiffLine> {
    let mut lines = Vec::new();
    let mut old_line = None;
    let mut new_line = None;
    let mut in_hunk = false;
    let mut saw_hunk = false;
    let mut file_block_active = false;
    let mut old_highlighter = None;
    let mut new_highlighter = None;
    let source_lines = input.lines().collect::<Vec<_>>();
    let allow_highlighting = !exceeds_highlight_limits(input.len(), source_lines.len());

    for (index, raw) in source_lines.iter().enumerate() {
        let raw = raw.replace('\t', TAB_REPLACEMENT);
        let raw = raw.as_str();
        if let Some((old_start, new_start)) = parse_hunk_starts(raw) {
            if saw_hunk {
                lines.push(DiffLine {
                    kind: DiffLineKind::Hunk,
                    number: None,
                    text: String::new(),
                    syntax: None,
                });
            }
            old_line = Some(old_start);
            new_line = Some(new_start);
            in_hunk = true;
            saw_hunk = true;
            continue;
        }

        if let Some((verb, path)) = file_header(raw) {
            let (old_language, new_language) = languages_for_change_path(path);
            old_highlighter = highlighter_for(old_language.as_deref(), allow_highlighting);
            new_highlighter = highlighter_for(new_language.as_deref(), allow_highlighting);
            let (added, removed) = file_change_counts(&source_lines[index + 1..]);
            lines.push(DiffLine {
                kind: DiffLineKind::FileHeader,
                number: None,
                text: format!(
                    "{verb} {} (+{added} -{removed})",
                    display_change_path(path, cwd)
                ),
                syntax: None,
            });
            old_line = Some(1);
            new_line = Some(1);
            in_hunk = false;
            saw_hunk = false;
            file_block_active = true;
            continue;
        }

        if raw.starts_with("diff --git ")
            || raw.starts_with("index ")
            || raw.starts_with("--- ")
            || raw.starts_with("+++ ")
        {
            if let Some(path) = raw.strip_prefix("--- ") {
                if let Some(language) = language_for_path(path) {
                    old_highlighter = highlighter_for(Some(&language), allow_highlighting);
                }
            } else if let Some(path) = raw.strip_prefix("+++ ") {
                if let Some(language) = language_for_path(path) {
                    new_highlighter = highlighter_for(Some(&language), allow_highlighting);
                }
            }
            in_hunk = false;
            if raw.starts_with("diff --git ") {
                saw_hunk = false;
                file_block_active = false;
                old_highlighter = None;
                new_highlighter = None;
            }
            lines.push(DiffLine {
                kind: DiffLineKind::Metadata,
                number: None,
                text: raw.to_string(),
                syntax: None,
            });
            continue;
        }

        if in_hunk {
            if let Some(text) = raw.strip_prefix('+') {
                lines.push(DiffLine {
                    kind: DiffLineKind::Insert,
                    number: new_line,
                    text: text.to_string(),
                    syntax: highlight_line(text, &mut new_highlighter),
                });
                new_line = new_line.map(|line| line.saturating_add(1));
                continue;
            }
            if let Some(text) = raw.strip_prefix('-') {
                lines.push(DiffLine {
                    kind: DiffLineKind::Delete,
                    number: old_line,
                    text: text.to_string(),
                    syntax: highlight_line(text, &mut old_highlighter),
                });
                old_line = old_line.map(|line| line.saturating_add(1));
                continue;
            }
            if let Some(text) = raw.strip_prefix(' ') {
                let old_syntax = highlight_line(text, &mut old_highlighter);
                let new_syntax = highlight_line(text, &mut new_highlighter);
                lines.push(DiffLine {
                    kind: DiffLineKind::Context,
                    number: new_line.or(old_line),
                    text: text.to_string(),
                    syntax: new_syntax.or(old_syntax),
                });
                old_line = old_line.map(|line| line.saturating_add(1));
                new_line = new_line.map(|line| line.saturating_add(1));
                continue;
            }
            if raw.starts_with("\\ No newline at end of file") {
                lines.push(DiffLine {
                    kind: DiffLineKind::Metadata,
                    number: None,
                    text: raw.to_string(),
                    syntax: None,
                });
                continue;
            }
        }

        if file_block_active {
            if let Some(text) = raw.strip_prefix('+') {
                lines.push(DiffLine {
                    kind: DiffLineKind::Insert,
                    number: new_line,
                    text: text.to_string(),
                    syntax: highlight_line(text, &mut new_highlighter),
                });
                new_line = new_line.map(|line| line.saturating_add(1));
                continue;
            }
            if let Some(text) = raw.strip_prefix('-') {
                lines.push(DiffLine {
                    kind: DiffLineKind::Delete,
                    number: old_line,
                    text: text.to_string(),
                    syntax: highlight_line(text, &mut old_highlighter),
                });
                old_line = old_line.map(|line| line.saturating_add(1));
                continue;
            }
        }

        let kind = if raw.starts_with('+') {
            DiffLineKind::Insert
        } else if raw.starts_with('-') {
            DiffLineKind::Delete
        } else {
            DiffLineKind::Plain
        };
        lines.push(DiffLine {
            kind,
            number: None,
            text: raw.to_string(),
            syntax: None,
        });
    }

    lines
}

fn render_line(
    line: DiffLine,
    number_width: usize,
    width: Option<usize>,
    style: DiffRenderStyleContext,
) -> Vec<Line<'static>> {
    let DiffLine {
        kind,
        number,
        text,
        syntax,
    } = line;
    if kind == DiffLineKind::Hunk && text.is_empty() {
        let marker = Line::from(vec![
            Span::raw(" ".repeat(number_width + 1)),
            Span::styled("⋮", Style::default().fg(Color::DarkGray)),
        ]);
        return vec![width
            .map(|width| truncate_line_to_width(marker.clone(), width))
            .unwrap_or(marker)];
    }
    let Some(number) = number else {
        if matches!(kind, DiffLineKind::Insert | DiffLineKind::Delete) {
            let sign = text[..1].to_string();
            return wrap_diff_content(
                text[1..].to_string(),
                vec![Span::styled(sign, style.sign(kind))],
                vec![Span::styled(" ", style.sign(kind))],
                width,
                syntax,
                kind,
                style,
            );
        }
        return wrap_plain_line(Line::from(Span::styled(text, style.content(kind))), width);
    };
    let sign = match kind {
        DiffLineKind::Insert => '+',
        DiffLineKind::Delete => '-',
        DiffLineKind::Context => ' ',
        _ => ' ',
    };
    let initial_prefix = vec![
        Span::styled(format!("{number:>number_width$} "), style.gutter(kind)),
        Span::styled(sign.to_string(), style.sign(kind)),
    ];
    let continuation_prefix = vec![Span::styled(
        " ".repeat(number_width + 2),
        style.gutter(kind),
    )];
    wrap_diff_content(
        text,
        initial_prefix,
        continuation_prefix,
        width,
        syntax,
        kind,
        style,
    )
}

fn wrap_plain_line(line: Line<'static>, width: Option<usize>) -> Vec<Line<'static>> {
    let Some(width) = width else {
        return vec![line];
    };
    if width == 0 {
        return vec![Line::default()];
    }
    let text = line
        .spans
        .iter()
        .map(|span| span.content.as_ref())
        .collect::<String>();
    let style = line
        .spans
        .first()
        .map(|span| span.style)
        .unwrap_or_default();
    hard_wrap(&text, width)
        .into_iter()
        .map(|part| Line::from(Span::styled(part, style)))
        .collect()
}

fn wrap_diff_content(
    text: String,
    initial_prefix: Vec<Span<'static>>,
    continuation_prefix: Vec<Span<'static>>,
    width: Option<usize>,
    syntax: Option<Vec<Span<'static>>>,
    kind: DiffLineKind,
    style: DiffRenderStyleContext,
) -> Vec<Line<'static>> {
    let line_style = style.line(kind);
    let prefix_width = initial_prefix
        .iter()
        .map(|span| display_width(span.content.as_ref()))
        .sum::<usize>();
    let Some(width) = width else {
        let mut spans = initial_prefix;
        spans.extend(content_spans(text, style, syntax, kind));
        return vec![Line::from(spans).style(line_style)];
    };
    if width <= prefix_width {
        let mut spans = initial_prefix;
        spans.extend(content_spans(text, style, syntax, kind));
        return vec![
            truncate_line_to_width(Line::from(spans).style(line_style), width).style(line_style),
        ];
    }

    let content_width = width - prefix_width;
    hard_wrap_spans(content_spans(text, style, syntax, kind), content_width)
        .into_iter()
        .enumerate()
        .map(|(index, content)| {
            let mut spans = if index == 0 {
                initial_prefix.clone()
            } else {
                continuation_prefix.clone()
            };
            spans.extend(content);
            Line::from(spans).style(line_style)
        })
        .collect()
}

fn content_spans(
    text: String,
    style: DiffRenderStyleContext,
    syntax: Option<Vec<Span<'static>>>,
    kind: DiffLineKind,
) -> Vec<Span<'static>> {
    syntax
        .unwrap_or_else(|| vec![Span::styled(text, style.content(kind))])
        .into_iter()
        .map(|span| {
            let style = style.readable(span.style, kind);
            Span::styled(span.content.into_owned(), style)
        })
        .collect()
}

fn hard_wrap_spans(spans: Vec<Span<'static>>, width: usize) -> Vec<Vec<Span<'static>>> {
    let width = width.max(1);
    let mut lines = Vec::new();
    let mut current = Vec::<Span<'static>>::new();
    let mut current_width = 0usize;

    for span in spans {
        let style = span.style;
        for grapheme in span.content.graphemes(true) {
            let grapheme_width = display_width(grapheme);
            if !current.is_empty() && current_width.saturating_add(grapheme_width) > width {
                lines.push(std::mem::take(&mut current));
                current_width = 0;
            }
            if current.is_empty() && grapheme_width > width {
                lines.push(vec![Span::styled("…", style)]);
                continue;
            }
            if let Some(last) = current.last_mut().filter(|last| last.style == style) {
                last.content.to_mut().push_str(grapheme);
            } else {
                current.push(Span::styled(grapheme.to_string(), style));
            }
            current_width += grapheme_width;
        }
    }
    if !current.is_empty() || lines.is_empty() {
        lines.push(current);
    }
    lines
}

fn hard_wrap(text: &str, width: usize) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    let width = width.max(1);
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;
    for grapheme in text.graphemes(true) {
        let grapheme_width = display_width(grapheme);
        if !current.is_empty() && current_width.saturating_add(grapheme_width) > width {
            lines.push(std::mem::take(&mut current));
            current_width = 0;
        }
        if current.is_empty() && grapheme_width > width {
            lines.push("…".to_string());
            continue;
        }
        current.push_str(grapheme);
        current_width += grapheme_width;
    }
    if !current.is_empty() || lines.is_empty() {
        lines.push(current);
    }
    lines
}

fn file_header(line: &str) -> Option<(&str, &str)> {
    ["added", "updated", "deleted"]
        .into_iter()
        .find_map(|verb| {
            line.strip_prefix(verb)?
                .strip_prefix(' ')
                .map(|path| (verb, path))
        })
}

fn file_change_counts(lines: &[&str]) -> (usize, usize) {
    let mut added = 0;
    let mut removed = 0;
    for line in lines {
        if file_header(line).is_some() {
            break;
        }
        if line.starts_with('+') && !line.starts_with("+++") {
            added += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            removed += 1;
        }
    }
    (added, removed)
}

fn highlighter_for(
    language: Option<&str>,
    allow_highlighting: bool,
) -> Option<CodeLineHighlighter> {
    if !allow_highlighting {
        return None;
    }
    CodeLineHighlighter::new(language?)
}

fn highlight_line(
    text: &str,
    highlighter: &mut Option<CodeLineHighlighter>,
) -> Option<Vec<Span<'static>>> {
    highlighter.as_mut()?.highlight_line(text)
}

fn languages_for_change_path(path: &str) -> (Option<String>, Option<String>) {
    path.split_once(" → ")
        .map(|(source, destination)| (language_for_path(source), language_for_path(destination)))
        .unwrap_or_else(|| {
            let language = language_for_path(path);
            (language.clone(), language)
        })
}

fn language_for_path(path: &str) -> Option<String> {
    let path = path
        .strip_prefix("a/")
        .or_else(|| path.strip_prefix("b/"))
        .unwrap_or(path);
    if path == "/dev/null" {
        return None;
    }
    Path::new(path).extension()?.to_str().map(str::to_string)
}

fn display_change_path(path: &str, cwd: &Path) -> String {
    path.split_once(" → ")
        .map(|(from, to)| {
            format!(
                "{} → {}",
                display_path_for(from, cwd),
                display_path_for(to, cwd)
            )
        })
        .unwrap_or_else(|| display_path_for(path, cwd))
}

pub(crate) fn display_path_for(path: &str, cwd: &Path) -> String {
    let path = Path::new(path);
    if path.is_absolute() && !cwd.as_os_str().is_empty() {
        if let Ok(relative) = path.strip_prefix(cwd) {
            if !relative.as_os_str().is_empty() {
                return relative.display().to_string();
            }
        }
    }
    path.display().to_string()
}

fn parse_hunk_starts(line: &str) -> Option<(u64, u64)> {
    let mut parts = line.split_whitespace();
    if parts.next()? != "@@" {
        return None;
    }
    let old = range_start(parts.next()?, '-')?;
    let new = range_start(parts.next()?, '+')?;
    (parts.next()? == "@@").then_some((old, new))
}

fn range_start(range: &str, prefix: char) -> Option<u64> {
    range.strip_prefix(prefix)?.split(',').next()?.parse().ok()
}

fn decimal_width(value: u64) -> usize {
    value.checked_ilog10().unwrap_or(0) as usize + 1
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod style_tests;
