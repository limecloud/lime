use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};
use ratatui::Frame;
use std::time::Instant;
use unicode_segmentation::UnicodeSegmentation;

use crate::bottom_pane::scroll_state::ScrollState;
use crate::bottom_pane::selection_popup_common::{
    measure_rows_height_with_layout, render_rows_with_layout,
};
use crate::bottom_pane::selection_row_layout::{
    line_to_owned, SelectionDescriptionLayout, SelectionRow,
};
use crate::line_truncation::line_width;
use crate::locale::Locale;
use crate::style::{accent_style, muted_style};
use crate::width::display_width;
use crate::wrapping::{word_wrap_line, RtOptions};

use super::layout::{layout_sections, menu_surface_inset, LayoutSections};
use super::RequestUserInputOverlay;

const OPTIONS_LAYOUT: SelectionDescriptionLayout =
    SelectionDescriptionLayout::StackBelowWhenNarrow {
        min_description_width: 24,
    };

fn option_rows(request: &RequestUserInputOverlay, locale: Locale) -> Vec<SelectionRow> {
    let mut rows = request
        .current_options()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, option)| {
            SelectionRow::new(
                option.label.clone(),
                (!option.description.is_empty()).then(|| option.description.clone()),
                vec![format!(
                    "{}{}. ",
                    if index == request.selected() {
                        "› "
                    } else {
                        "  "
                    },
                    index + 1
                )
                .into()],
            )
        })
        .collect::<Vec<_>>();
    if request.other_option_enabled() {
        let index = rows.len();
        rows.push(SelectionRow::new(
            locale.other_option_label(),
            Some(locale.other_option_description().into()),
            vec![format!(
                "{}{}. ",
                if index == request.selected() {
                    "› "
                } else {
                    "  "
                },
                index + 1
            )
            .into()],
        ));
    }
    rows
}

fn options_state(request: &RequestUserInputOverlay) -> ScrollState {
    request
        .answers
        .get(request.question_index)
        .map(|answer| answer.options_state)
        .unwrap_or_default()
}

fn question_lines(
    request: &RequestUserInputOverlay,
    locale: Locale,
    width: u16,
) -> Vec<Line<'static>> {
    let text = request
        .params
        .questions
        .get(request.question_index)
        .map_or_else(
            || locale.no_questions().to_string(),
            |question| question.question.clone(),
        );
    word_wrap_line(
        &Line::from(text),
        RtOptions::new(usize::from(width.max(1))).break_words(true),
    )
    .into_iter()
    .map(line_to_owned)
    .collect()
}

fn notes_input_area(area: Rect) -> Rect {
    let prefix = 2.min(area.width.saturating_sub(1));
    Rect::new(
        area.x + prefix,
        area.y,
        area.width.saturating_sub(prefix),
        area.height,
    )
}

fn notes_height(request: &RequestUserInputOverlay, width: u16) -> u16 {
    if !request.editing() {
        return 0;
    }
    request
        .composer
        .desired_height(notes_input_area(Rect::new(0, 0, width, 1)).width.max(1))
        .clamp(1, 6)
}

fn sections(request: &RequestUserInputOverlay, locale: Locale, area: Rect) -> LayoutSections {
    let rows = option_rows(request, locale);
    let options_height = if rows.is_empty() {
        0
    } else {
        measure_rows_height_with_layout(&rows, &options_state(request), area.width, OPTIONS_LAYOUT)
    };
    layout_sections(
        area,
        u16::try_from(question_lines(request, locale, area.width).len()).unwrap_or(u16::MAX),
        options_height,
        notes_height(request, area.width),
    )
}

pub(in crate::bottom_pane) fn desired_height(
    request: &RequestUserInputOverlay,
    locale: Locale,
    width: u16,
) -> u16 {
    if request.confirm_unanswered.is_some() {
        return request.confirmation_desired_height(locale, width);
    }
    let inner = menu_surface_inset(Rect::new(0, 0, width, u16::MAX));
    let rows = option_rows(request, locale);
    let options_height = if rows.is_empty() {
        0
    } else {
        measure_rows_height_with_layout(&rows, &options_state(request), inner.width, OPTIONS_LAYOUT)
    };
    u16::try_from(question_lines(request, locale, inner.width).len())
        .unwrap_or(u16::MAX)
        .saturating_add(options_height)
        .saturating_add(notes_height(request, inner.width))
        .saturating_add(4)
        .clamp(8, 18)
}

pub(in crate::bottom_pane) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    request: &RequestUserInputOverlay,
    locale: Locale,
) {
    render_ui_at(frame, area, request, locale, Instant::now());
}

fn render_ui_at(
    frame: &mut Frame<'_>,
    area: Rect,
    request: &RequestUserInputOverlay,
    locale: Locale,
    now: Instant,
) {
    if area.is_empty() {
        return;
    }
    if request.confirm_unanswered.is_some() {
        frame.render_widget(Clear, area);
        request.render_unanswered_confirmation(frame, area, locale);
        return;
    }
    frame.render_widget(Clear, area);
    let inner = menu_surface_inset(area);
    if inner.is_empty() {
        return;
    }
    let sections = sections(request, locale, inner);
    let mut progress = vec![Span::styled(
        locale
            .request_question_progress(request.question_index + 1, request.params.questions.len()),
        muted_style(),
    )];
    if request.unanswered_count() > 0 {
        progress.push(Span::styled(
            format!(
                " ({})",
                locale.request_unanswered_count(request.unanswered_count())
            ),
            muted_style(),
        ));
    }
    if let Some(countdown) = request.auto_resolution_countdown_text(now, locale) {
        progress.extend([
            Span::raw(" · "),
            Span::styled(countdown, Style::default().fg(Color::Red)),
        ]);
    }
    frame.render_widget(
        Paragraph::new(truncate_line_word_boundary_with_ellipsis(
            Line::from(progress),
            usize::from(inner.width),
        )),
        sections.progress_area,
    );
    let mut lines = question_lines(request, locale, inner.width);
    if lines.len() > usize::from(sections.question_area.height) && sections.question_area.height > 0
    {
        lines.truncate(usize::from(sections.question_area.height));
        if let Some(last) = lines.last_mut() {
            *last = truncate_line_word_boundary_with_ellipsis(
                Line::from(format!("{} …", last)),
                usize::from(inner.width),
            );
        }
    }
    frame.render_widget(
        Paragraph::new(lines).style(accent_style()),
        sections.question_area,
    );
    render_rows_with_layout(
        frame,
        sections.options_area,
        &option_rows(request, locale),
        &options_state(request),
        OPTIONS_LAYOUT,
    );
    if request.editing() && !sections.notes_area.is_empty() {
        render_notes_input(frame, sections.notes_area, request);
    }
}

fn render_notes_input(frame: &mut Frame<'_>, area: Rect, request: &RequestUserInputOverlay) {
    let input = notes_input_area(area);
    frame.render_widget(
        Paragraph::new("› ").style(accent_style()),
        Rect::new(area.x, area.y, area.width.min(2), 1),
    );
    let textarea = request.composer.textarea();
    let mut state = request.composer.textarea_state_mut();
    if request
        .params
        .questions
        .get(request.question_index)
        .is_some_and(|question| question.is_secret)
    {
        textarea.render_ref_masked(input, frame.buffer_mut(), &mut state, '*');
    } else {
        textarea.render_ref_styled_with_highlights(
            input,
            frame.buffer_mut(),
            &mut state,
            Style::default(),
            &[],
        );
    }
    if let Some(position) = textarea.cursor_pos_with_state(input, *state) {
        frame.set_cursor_position(position);
    }
}

/// Truncate a styled line at a grapheme-safe word boundary and append an ellipsis.
///
/// The available width reserves one cell for the ellipsis. Whitespace is preferred as the
/// break point, while a grapheme boundary is used when no word boundary fits.
pub(super) fn truncate_line_word_boundary_with_ellipsis(
    line: Line<'static>,
    max_width: usize,
) -> Line<'static> {
    if max_width == 0 {
        return Line::from(Vec::<Span<'static>>::new());
    }

    if line_width(&line) <= max_width {
        return line;
    }

    let ellipsis = "…";
    let ellipsis_width = display_width(ellipsis);
    if ellipsis_width >= max_width {
        return Line::from(ellipsis);
    }
    let limit = max_width.saturating_sub(ellipsis_width);

    #[derive(Clone, Copy)]
    struct BreakPoint {
        span_idx: usize,
        byte_end: usize,
    }

    let mut used = 0usize;
    let mut last_fit = None;
    let mut last_word_break = None;
    let mut overflowed = false;

    'outer: for (span_idx, span) in line.spans.iter().enumerate() {
        for (byte_idx, grapheme) in span.content.as_ref().grapheme_indices(true) {
            let grapheme_width = display_width(grapheme);
            if used.saturating_add(grapheme_width) > limit {
                overflowed = true;
                break 'outer;
            }
            used = used.saturating_add(grapheme_width);
            let break_point = BreakPoint {
                span_idx,
                byte_end: byte_idx + grapheme.len(),
            };
            last_fit = Some(break_point);
            if grapheme.chars().all(char::is_whitespace) {
                last_word_break = Some(break_point);
            }
        }
    }

    if !overflowed {
        return line;
    }

    let Some(chosen_break) = last_word_break.or(last_fit) else {
        return Line::from(ellipsis);
    };

    let line_style = line.style;
    let mut spans_out = Vec::new();
    for (idx, span) in line.spans.into_iter().enumerate() {
        if idx < chosen_break.span_idx {
            spans_out.push(span);
            continue;
        }
        if idx == chosen_break.span_idx {
            let text = span.content.into_owned();
            let truncated = text[..chosen_break.byte_end].to_string();
            if !truncated.is_empty() {
                spans_out.push(Span::styled(truncated, span.style));
            }
        }
        break;
    }

    while let Some(last) = spans_out.last_mut() {
        let trimmed = last
            .content
            .trim_end_matches(char::is_whitespace)
            .to_string();
        if trimmed.is_empty() {
            spans_out.pop();
        } else {
            last.content = trimmed.into();
            break;
        }
    }

    let ellipsis_style = spans_out
        .last()
        .map(|span| span.style)
        .unwrap_or(line_style);
    spans_out.push(Span::styled(ellipsis, ellipsis_style));
    Line::from(spans_out).style(line_style)
}

#[cfg(test)]
#[path = "render_tests.rs"]
mod tests;
