//! Elicitation presentation and width-aware control hints.

use super::*;
use crate::footer_hint::{display_key_label, wrap_hint_rows, ShortcutHint};
use crate::keymap::{ListAction, ListKeymap};

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
        &overlay.list_keymap,
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
    list_keymap: &ListKeymap,
) -> Vec<Line<'static>> {
    let selection = if select {
        match (
            list_keymap.primary_hint(ListAction::MoveUp),
            list_keymap.primary_hint(ListAction::MoveDown),
        ) {
            (Some(up), Some(down)) => Some(ShortcutHint::new(
                &format!("{}/{}", display_key_label(&up), display_key_label(&down)),
                locale.mcp_select_hint(&up, &down),
            )),
            _ => None,
        }
    } else {
        None
    };
    let confirm = if select {
        list_keymap.primary_hint(ListAction::Accept)
    } else {
        Some("enter".to_string())
    }
    .map(|key| ShortcutHint::new(&key, locale.mcp_confirm_hint(&key)));
    let (left, right) = if select {
        (
            list_keymap.primary_hint(ListAction::MoveLeft),
            list_keymap.primary_hint(ListAction::MoveRight),
        )
    } else {
        (None, None)
    };
    let field_keys = [Some("tab"), left.as_deref(), right.as_deref()]
        .into_iter()
        .flatten()
        .map(display_key_label)
        .collect::<Vec<_>>()
        .join("/");
    let field = ShortcutHint::new(
        &field_keys,
        locale.mcp_field_hint("tab", left.as_deref(), right.as_deref()),
    )
    .with_alternative_key("tab");
    let cancel = if select {
        list_keymap.primary_hint(ListAction::Cancel)
    } else {
        Some("esc".to_string())
    }
    .map(|key| ShortcutHint::new(&key, locale.mcp_cancel_hint(&key)));
    let full = [
        selection.as_ref(),
        confirm.as_ref(),
        Some(&field),
        cancel.as_ref(),
    ]
    .into_iter()
    .flatten()
    .map(ShortcutHint::text)
    .collect::<Vec<_>>()
    .join("  ");
    let Some(width) = width else {
        return vec![Line::styled(full, muted_style())];
    };
    if display_width(&full) <= width {
        return vec![Line::styled(full, muted_style())];
    }
    // The request owns priority; the shared layout only chooses and packs whole hints.
    let hints = [
        confirm.as_ref(),
        selection.as_ref(),
        Some(&field),
        cancel.as_ref(),
    ]
    .into_iter()
    .flatten()
    .map(|hint| hint.fit(width))
    .filter(|hint| !hint.is_empty());
    wrap_hint_rows(hints, width, 2, |hint| display_width(hint))
        .into_iter()
        .map(|row| Line::styled(row.join("  "), muted_style()))
        .collect()
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
