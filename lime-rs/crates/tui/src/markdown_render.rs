use pulldown_cmark::{Event, Options, Parser, Tag};
use ratatui::style::Style;
use std::borrow::Cow;
use std::path::Path;

mod local_links;
pub(crate) mod renderer;
mod table;
use crate::terminal_hyperlinks::HyperlinkLine;

/// Replace only recognized follow-up directives with their visible Markdown label.
///
/// The directive body is an assistant-owned prompt and must not leak into the transcript or
/// clipboard. Code, HTML, links, images, escaped directives and malformed directives remain
/// byte-for-byte unchanged so source Markdown keeps its literal meaning.
pub(crate) fn followup_labels(input: &str) -> Cow<'_, str> {
    const PREFIX: &str = ":codex-followup[";
    if !input.contains(PREFIX) {
        return Cow::Borrowed(input);
    }

    let literal_ranges = Parser::new_ext(
        input,
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS,
    )
    .into_offset_iter()
    .filter_map(|(event, range)| {
        matches!(
            event,
            Event::Code(_)
                | Event::Html(_)
                | Event::InlineHtml(_)
                | Event::Start(Tag::CodeBlock(_) | Tag::Link { .. } | Tag::Image { .. })
        )
        .then_some(range)
    })
    .collect::<Vec<_>>();

    let mut replacements: Vec<(std::ops::Range<usize>, &str)> = Vec::new();
    for (start, _) in input.match_indices(PREFIX) {
        if literal_ranges.iter().any(|range| range.contains(&start))
            || input[..start].ends_with(':')
            || input[..start]
                .bytes()
                .rev()
                .take_while(|byte| *byte == b'\\')
                .count()
                % 2
                != 0
        {
            continue;
        }
        let Some((end, label)) = parse_followup(input, start, PREFIX.len()) else {
            continue;
        };
        if !label.trim().is_empty()
            && replacements
                .last()
                .is_none_or(|(range, _)| range.end <= start)
        {
            replacements.push((start..end, label));
        }
    }
    if replacements.is_empty() {
        return Cow::Borrowed(input);
    }

    let mut output = String::with_capacity(input.len());
    let mut offset = 0;
    for (range, label) in replacements {
        output.push_str(&input[offset..range.start]);
        output.push_str(label);
        offset = range.end;
    }
    output.push_str(&input[offset..]);
    Cow::Owned(output)
}

fn parse_followup(input: &str, start: usize, prefix_len: usize) -> Option<(usize, &str)> {
    let label_start = start + prefix_len;
    let bytes = input.as_bytes();
    let mut index = label_start;
    let mut depth = 1usize;
    let mut code_ticks = 0usize;
    while index < bytes.len() {
        let character = input[index..].chars().next()?;
        if character == '\n' || character == '\r' {
            return None;
        }
        if character == '\\' {
            index += character.len_utf8();
            let escaped = input[index..].chars().next()?;
            index += escaped.len_utf8();
            continue;
        }
        if character == '`' {
            let run_start = index;
            while index < bytes.len() && bytes[index] == b'`' {
                index += 1;
            }
            let run = index - run_start;
            let has_matching_run = bytes[index..]
                .windows(run)
                .any(|window| window.iter().all(|byte| *byte == b'`'));
            if code_ticks == run {
                code_ticks = 0;
            } else if code_ticks == 0 && has_matching_run {
                code_ticks = run;
            }
            continue;
        }
        if code_ticks == 0 {
            match character {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
        }
        index += character.len_utf8();
    }
    if depth != 0 || code_ticks != 0 || bytes.get(index) != Some(&b']') {
        return None;
    }
    let label_end = index;
    index += 1;
    if bytes.get(index) != Some(&b'{') {
        return None;
    }
    let attributes_start = index + 1;
    let mut braces = 1usize;
    let mut quote = None;
    let mut escaped = false;
    index += 1;
    while index < bytes.len() {
        let character = input[index..].chars().next()?;
        index += character.len_utf8();
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        match character {
            '\'' | '"' => quote = Some(character),
            '{' => braces += 1,
            '}' => {
                braces -= 1;
                if braces == 0 {
                    let attributes = &input[attributes_start..index - 1];
                    if valid_followup_attributes(attributes) {
                        return Some((index, &input[label_start..label_end]));
                    }
                    return None;
                }
            }
            _ => {}
        }
    }
    None
}

fn valid_followup_attributes(attributes: &str) -> bool {
    let bytes = attributes.as_bytes();
    let mut index = 0;
    let mut names = std::collections::HashSet::new();
    let mut has_prompt = false;
    while index < bytes.len() {
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if index == bytes.len() {
            break;
        }
        let name_start = index;
        while bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
        {
            index += 1;
        }
        if name_start == index {
            return false;
        }
        let name = &attributes[name_start..index];
        if !names.insert(name) {
            return false;
        }
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if bytes.get(index) != Some(&b'=') {
            return false;
        }
        index += 1;
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let Some(&first) = bytes.get(index) else {
            return false;
        };
        if first == b'"' || first == b'\'' {
            let quote = first;
            index += 1;
            let mut escaped = false;
            let value_start = index;
            while let Some(&byte) = bytes.get(index) {
                index += 1;
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == quote {
                    break;
                }
            }
            if bytes.get(index.saturating_sub(1)) != Some(&quote)
                || (index.saturating_sub(1) == value_start && escaped)
            {
                return false;
            }
        } else {
            let value_start = index;
            while bytes
                .get(index)
                .is_some_and(|byte| !byte.is_ascii_whitespace())
            {
                index += 1;
            }
            if value_start == index {
                return false;
            }
        }
        has_prompt |= name == "prompt";
    }
    has_prompt
}

/// Lime-native markdown rendering entry point backed by Lime's canonical renderer.
pub(crate) fn render_markdown_lines_with_width(
    input: &str,
    base_style: Style,
    width: Option<usize>,
) -> Vec<HyperlinkLine> {
    renderer::render(input, base_style, width)
}

pub(crate) fn render_markdown_lines_with_width_and_cwd(
    input: &str,
    base_style: Style,
    width: Option<usize>,
    cwd: &Path,
) -> Vec<HyperlinkLine> {
    renderer::render_with_cwd(input, base_style, width, Some(cwd))
}

#[allow(dead_code)]
pub(crate) fn render_markdown_text(input: &str, base_style: Style) -> Vec<HyperlinkLine> {
    render_markdown_lines_with_width(input, base_style, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_markdown_text_keeps_plain_content() {
        let lines = render_markdown_text("hello", Style::default());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].line.spans[0].content, "hello");
    }

    #[test]
    fn followup_labels_hide_prompt_attributes_and_preserve_markdown_label() {
        let source = r#"Next: :codex-followup[**Inspect items[0]**]{prompt="private"}."#;
        assert_eq!(
            followup_labels(source).as_ref(),
            r#"Next: **Inspect items[0]**."#
        );
        let rendered = render_markdown_text(source, Style::default());
        let text = rendered
            .iter()
            .flat_map(|line| line.line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert_eq!(text, "Next: Inspect items[0].");
        assert!(rendered
            .iter()
            .flat_map(|line| line.line.spans.iter())
            .any(|span| span
                .style
                .add_modifier
                .contains(ratatui::style::Modifier::BOLD)));
    }

    #[test]
    fn followup_labels_leave_code_links_escaped_and_malformed_directives_untouched() {
        let source = concat!(
            "` :codex-followup[code]{prompt=\"hidden\"}` ",
            "[link](https://example.test/:codex-followup[label]{prompt=x}) ",
            r#"\:codex-followup[escaped]{prompt=x} :codex-followup[unfinished"#,
        );
        assert_eq!(followup_labels(source).as_ref(), source);
    }

    #[test]
    fn followup_labels_match_codex_malformed_and_nested_boundaries() {
        let source = concat!(
            "Next: :codex-followup[Add **revenue charts**]{prompt=\"Add a \\\"Q3\\\" chart with } labels\"} ",
            ":codex-followup[Format `Sheet1`]{prompt=\"Format the spreadsheet\"}."
        );
        assert_eq!(
            followup_labels(source).as_ref(),
            "Next: Add **revenue charts** Format `Sheet1`."
        );

        assert_eq!(
            followup_labels(":codex-followup[Type a ` character]{prompt=action}"),
            "Type a ` character"
        );
        assert_eq!(
            followup_labels(":codex-followup[Add charts]{prompt=one prompt=two}"),
            ":codex-followup[Add charts]{prompt=one prompt=two}"
        );
        assert_eq!(
            followup_labels(":x0[:x1[:codex-followup[Open]{prompt=secret}"),
            ":x0[:x1[Open"
        );
        assert_eq!(
            followup_labels(":codex-followup[:codex-followup[Inner]{prompt=one}]{prompt=two}"),
            ":codex-followup[Inner]{prompt=one}"
        );
    }
}
