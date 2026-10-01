//! Elicitation presentation and width-aware control hints.

use super::*;

pub(in super::super) fn lines_with_locale(
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
) -> Vec<Line<'static>> {
    lines_with_locale_inner(overlay, locale, None)
}

pub(in super::super) fn lines_with_locale_with_width(
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
    width: usize,
) -> Vec<Line<'static>> {
    let width = width.max(1);
    if width == usize::MAX {
        return lines_with_locale(overlay, locale);
    }
    let lines = lines_with_locale_inner(overlay, locale, Some(width));

    let footer_index = lines.len().saturating_sub(1);
    lines
        .into_iter()
        .enumerate()
        .flat_map(|(index, line)| {
            if index == footer_index {
                return vec![line].into_iter();
            }
            if is_input_line(&line) {
                return split_input_lines(line)
                    .into_iter()
                    .map(|line| truncate_line_with_ellipsis_if_overflow(line, width))
                    .collect::<Vec<_>>()
                    .into_iter();
            }
            if is_option_line(&line) {
                return vec![truncate_line_with_ellipsis_if_overflow(line, width)].into_iter();
            }
            word_wrap_line(&line, RtOptions::new(width).break_words(true))
                .into_iter()
                .map(line_to_owned)
                .collect::<Vec<_>>()
                .into_iter()
        })
        .collect()
}

pub(super) fn lines_with_locale_inner(
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
    width: Option<usize>,
) -> Vec<Line<'static>> {
    let Some(field) = overlay.fields.get(overlay.current_field) else {
        return vec![Line::from(locale.mcp_elicitation_invalid())];
    };
    let mut lines = vec![Line::styled(
        locale.mcp_elicitation_title(&overlay.server_name),
        Style::default().add_modifier(Modifier::BOLD),
    )];
    let request_message =
        format_tool_approval_display_message(&overlay.message, &overlay.approval_display_params);
    lines.extend(
        request_message
            .lines()
            .map(|line| Line::from(line.to_string())),
    );
    lines.push(Line::styled(
        locale.mcp_elicitation_progress(overlay.current_field + 1, overlay.fields.len()),
        muted_style(),
    ));
    if !field.label.is_empty() {
        lines.push(Line::styled(
            format!("{}{}", field.label, if field.required { " *" } else { "" }),
            Style::default().add_modifier(Modifier::BOLD),
        ));
    }
    if let Some(description) = field.description.as_ref().filter(|value| !value.is_empty()) {
        lines.push(Line::styled(description.clone(), muted_style()));
    }

    match &field.input {
        McpFieldInput::Text { .. } => {
            let value = overlay.text_area.text();
            let value = if value.is_empty() {
                locale
                    .mcp_elicitation_text_placeholder(field.required)
                    .to_string()
            } else {
                value.to_string()
            };
            let style = if overlay.text_area.text().is_empty() {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default()
            };
            lines.push(Line::from(vec![
                Span::styled("› ", accent_style()),
                Span::styled(value, style),
            ]));
        }
        McpFieldInput::Select { options, .. } => {
            let selected = match overlay.states.get(overlay.current_field) {
                Some(McpFieldState::Select { selected, .. }) => *selected,
                _ => None,
            };
            let selected_index = selected.unwrap_or(0);
            let (start, end) = visible_item_window(selected_index, options.len(), MAX_POPUP_ROWS);
            for (index, option) in options.iter().enumerate().skip(start).take(end - start) {
                let is_selected = selected == Some(index);
                let prefix = if is_selected { "›" } else { " " };
                let label = match (&option.value, overlay.response_mode) {
                    (Value::Bool(value), _) => {
                        locale.mcp_elicitation_boolean_option(*value).to_string()
                    }
                    (Value::String(value), McpResponseMode::ApprovalAction) => {
                        let localized = locale.mcp_elicitation_approval_option(value);
                        if localized.is_empty() {
                            option.label.clone()
                        } else {
                            localized.to_string()
                        }
                    }
                    _ => option.label.clone(),
                };
                let style = if is_selected {
                    accent_style()
                } else {
                    Style::default()
                };
                let description = option
                    .description
                    .as_deref()
                    .filter(|description| !description.is_empty())
                    .map(|description| format!("  {description}"))
                    .unwrap_or_default();
                lines.push(Line::styled(
                    format!("{prefix} {}. {label}{description}", index + 1),
                    style,
                ));
            }
        }
    }
    if overlay.validation_error {
        lines.push(Line::styled(
            locale.mcp_elicitation_required_error(),
            Style::default().fg(Color::Red),
        ));
    }
    lines.extend(footer_control_lines(
        locale,
        overlay.is_select_field(),
        width,
    ));
    lines
}

pub(super) fn is_option_line(line: &Line<'_>) -> bool {
    let text = line.to_string();
    let text = text.trim_start_matches(['›', '>', ' ']);
    text.as_bytes().first().is_some_and(u8::is_ascii_digit) && text.contains(". ")
}

pub(super) fn is_input_line(line: &Line<'_>) -> bool {
    line.to_string().starts_with(['›', '>'])
}

/// Split the editable line at explicit newlines before applying the width projection.
///
/// `Line` may contain a newline inside a span, but ratatui lays out each physical row
/// independently. Keeping the split here makes the rendered rows and cursor calculation share
/// the same source of truth, including continuation rows that do not carry the `›` prompt.
pub(super) fn split_input_lines(line: Line<'static>) -> Vec<Line<'static>> {
    let Line {
        style,
        alignment,
        spans,
    } = line;
    let mut rows = vec![Vec::<Span<'static>>::new()];
    for span in spans {
        let content = span.content.into_owned();
        let mut segments = content.split('\n').peekable();
        while let Some(segment) = segments.next() {
            if !segment.is_empty() {
                rows.last_mut()
                    .expect("input row exists")
                    .push(Span::styled(segment.to_string(), span.style));
            }
            if segments.peek().is_some() {
                rows.push(Vec::new());
            }
        }
    }
    rows.into_iter()
        .map(|spans| Line {
            style,
            alignment,
            spans,
        })
        .collect()
}

pub(super) fn line_to_owned(line: Line<'_>) -> Line<'static> {
    let style = line.style;
    let spans = line
        .spans
        .into_iter()
        .map(|span| Span::styled(span.content.into_owned(), span.style))
        .collect::<Vec<_>>();
    Line::from(spans).style(style)
}

pub(super) fn footer_control_lines(
    locale: Locale,
    select: bool,
    width: Option<usize>,
) -> Vec<Line<'static>> {
    let full = locale.mcp_elicitation_controls(select);
    let Some(width) = width else {
        return vec![Line::styled(full, muted_style())];
    };
    let width = width.max(1);
    if display_width(&full) <= width {
        return vec![Line::styled(full, muted_style())];
    }

    // Locale strings intentionally keep two spaces between tips. Reusing those boundaries lets
    // the wide layout remain byte-for-byte stable while allowing narrow terminals to pack each
    // action independently. Submit and cancel stay ahead of navigation hints so the primary
    // action set remains visible when the footer needs multiple rows.
    let segments = full
        .split("  ")
        .filter(|segment| !segment.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if segments.len() < 2 {
        return vec![Line::styled(
            compact_control_segment(&full, width),
            muted_style(),
        )];
    }
    let submit_index = segments
        .iter()
        .position(|segment| contains_submit_hint(segment))
        .unwrap_or(0);
    let cancel_index = segments
        .iter()
        .position(|segment| contains_cancel_hint(segment))
        .unwrap_or(segments.len().saturating_sub(1));
    let cancel_segment = (cancel_index != submit_index).then(|| segments[cancel_index].clone());
    let mut ordered = Vec::with_capacity(segments.len());
    ordered.push(segments[submit_index].clone());
    for (index, segment) in segments.into_iter().enumerate() {
        if index != submit_index && index != cancel_index {
            ordered.push(segment);
        }
    }
    if let Some(cancel_segment) = cancel_segment {
        ordered.push(cancel_segment);
    }

    let mut rows = Vec::<String>::new();
    let mut current = String::new();
    for segment in ordered {
        let segment = compact_control_segment(&segment, width);
        if current.is_empty() {
            current = segment;
            continue;
        }
        let candidate = format!("{current}  {segment}");
        if display_width(&candidate) <= width {
            current = candidate;
        } else {
            rows.push(current);
            current = segment;
        }
    }
    if !current.is_empty() {
        rows.push(current);
    }
    rows.into_iter()
        .map(|line| Line::styled(line, muted_style()))
        .collect()
}

pub(super) fn contains_submit_hint(segment: &str) -> bool {
    segment.contains("Enter")
        || segment.contains("↵")
        || segment.contains("确认")
        || segment.contains("確定")
        || segment.contains("확인")
}

pub(super) fn contains_cancel_hint(segment: &str) -> bool {
    segment.contains("Esc")
        || segment.contains('⎋')
        || segment.contains("取消")
        || segment.contains("キャンセル")
        || segment.contains("취소")
}

pub(super) fn compact_control_segment(segment: &str, width: usize) -> String {
    if display_width(segment) <= width {
        return segment.to_owned();
    }
    let candidates = if contains_cancel_hint(segment) {
        vec!["Esc", "⎋"]
    } else if contains_submit_hint(segment) {
        vec!["Enter", "↵"]
    } else if segment.contains('↑') || segment.contains('↓') {
        vec!["↑/↓", "↑↓", "↑", "↓"]
    } else if segment.contains("Tab")
        || segment.contains("欄位")
        || segment.contains("字段")
        || segment.contains("フィールド")
        || segment.contains("필드")
    {
        vec!["Tab", "⇥"]
    } else {
        Vec::new()
    };
    if let Some(candidate) = candidates
        .into_iter()
        .find(|candidate| display_width(candidate) <= width)
    {
        return candidate.to_owned();
    }
    truncate_line_with_ellipsis_if_overflow(Line::from(segment.to_owned()), width).to_string()
}

pub(in super::super) fn set_cursor_position(
    frame: &mut Frame<'_>,
    inner: Rect,
    overlay: &McpServerElicitationOverlay,
    content: &[Line<'static>],
) {
    if !overlay.is_text_field() || inner.is_empty() {
        return;
    }
    let before = &overlay.text_area.text()[..overlay.text_area.cursor()];
    let current_line = before.rsplit('\n').next().unwrap_or(before);
    let input_row = content
        .iter()
        .position(is_input_line)
        .unwrap_or_else(|| content.len().saturating_sub(1));
    let prefix_width = if before.contains('\n') { 0 } else { 2 };
    let x = inner
        .x
        .saturating_add(prefix_width)
        .saturating_add(u16::try_from(display_width(current_line)).unwrap_or(u16::MAX))
        .min(inner.right().saturating_sub(1));
    let input_row = input_row.saturating_add(before.matches('\n').count());
    let y = inner.y.saturating_add(
        u16::try_from(input_row)
            .unwrap_or(u16::MAX)
            .min(inner.height.saturating_sub(1)),
    );
    frame.set_cursor_position(Position::new(x, y));
}
