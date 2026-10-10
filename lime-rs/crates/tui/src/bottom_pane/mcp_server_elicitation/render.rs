//! Elicitation presentation and width-aware control hints.

use super::*;
use crate::footer_hint::{display_key_label, wrap_hint_rows, ShortcutHint};
use crate::keymap::{ListAction, ListKeymap};
use ratatui::text::Span;
use ratatui::widgets::{Clear, Paragraph};

pub(in super::super) fn lines_with_locale(
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
) -> Vec<Line<'static>> {
    let mut lines = lines_with_locale_inner(overlay, locale);
    lines.extend(footer_control_lines(
        locale,
        overlay.is_select_field(),
        None,
        &overlay.list_keymap,
    ));
    lines
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
    let mut lines = content_lines_with_width(overlay, locale, width);
    lines.extend(footer_control_lines(
        locale,
        overlay.is_select_field(),
        Some(width),
        &overlay.list_keymap,
    ));
    lines
}

fn content_lines_with_width(
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
    width: usize,
) -> Vec<Line<'static>> {
    lines_with_locale_inner(overlay, locale)
        .into_iter()
        .flat_map(|line| {
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
        McpFieldInput::Text { .. } => {}
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
    if let Some(actual_chars) = overlay.submission_error {
        lines.push(Line::styled(
            locale.user_input_too_large_message(actual_chars),
            Style::default().fg(Color::Red),
        ));
    }
    lines
}

pub(super) fn is_option_line(line: &Line<'_>) -> bool {
    let text = line.to_string();
    let text = text.trim_start_matches(['›', '>', ' ']);
    text.as_bytes().first().is_some_and(u8::is_ascii_digit) && text.contains(". ")
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

fn content_area(area: Rect) -> Rect {
    let horizontal = if area.width > 4 { 2 } else { 0 };
    let vertical = u16::from(area.height > 3);
    Rect::new(
        area.x + horizontal,
        area.y + vertical,
        area.width.saturating_sub(2 * horizontal),
        area.height.saturating_sub(2 * vertical),
    )
}

fn input_area(area: Rect) -> Rect {
    let prefix = 2.min(area.width.saturating_sub(1));
    Rect::new(area.x + prefix, area.y, area.width - prefix, area.height)
}

fn input_height(overlay: &McpServerElicitationOverlay, width: u16) -> u16 {
    if overlay.is_select_field() {
        return 0;
    }
    overlay
        .composer
        .desired_height(input_area(Rect::new(0, 0, width, 1)).width.max(1))
        .clamp(1, 6)
}

pub(in super::super) fn desired_height(
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
    width: u16,
) -> u16 {
    let width = content_area(Rect::new(0, 0, width, u16::MAX)).width.max(1);
    u16::try_from(lines_with_locale_with_width(overlay, locale, usize::from(width)).len())
        .unwrap_or(u16::MAX)
        .saturating_add(input_height(overlay, width))
        .saturating_add(2)
        .clamp(5, 18)
}

pub(in super::super) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    overlay: &McpServerElicitationOverlay,
    locale: Locale,
) {
    frame.render_widget(Clear, area);
    let inner = content_area(area);
    if inner.is_empty() {
        return;
    }
    let content = content_lines_with_width(overlay, locale, usize::from(inner.width));
    let footer = footer_control_lines(
        locale,
        overlay.is_select_field(),
        Some(usize::from(inner.width)),
        &overlay.list_keymap,
    );
    let minimum_input = u16::from(overlay.is_text_field()).min(inner.height);
    let footer_height = u16::try_from(footer.len())
        .unwrap_or(u16::MAX)
        .min(inner.height.saturating_sub(minimum_input));
    let available = inner.height - footer_height;
    let input_height = input_height(overlay, inner.width).min(available);
    let content_height = available - input_height;
    frame.render_widget(
        Paragraph::new(content),
        Rect::new(inner.x, inner.y, inner.width, content_height),
    );
    frame.render_widget(
        Paragraph::new(footer),
        Rect::new(
            inner.x,
            inner.bottom() - footer_height,
            inner.width,
            footer_height,
        ),
    );
    if input_height == 0 {
        return;
    }
    let area = Rect::new(inner.x, inner.y + content_height, inner.width, input_height);
    let input = input_area(area);
    frame.render_widget(
        Paragraph::new("› ").style(accent_style()),
        Rect::new(area.x, area.y, area.width.min(2), 1),
    );
    let textarea = overlay.composer.textarea();
    let mut state = overlay.composer.textarea_state_mut();
    textarea.render_ref_styled_with_highlights(
        input,
        frame.buffer_mut(),
        &mut state,
        Style::default(),
        &[],
    );
    if overlay.composer.is_empty() {
        let required = overlay
            .fields
            .get(overlay.current_field)
            .is_some_and(|field| field.required);
        frame.render_widget(
            Paragraph::new(locale.mcp_elicitation_text_placeholder(required))
                .style(Style::default().fg(Color::DarkGray)),
            input,
        );
    }
    if let Some(position) = textarea.cursor_pos_with_state(input, *state) {
        frame.set_cursor_position(position);
    }
}
