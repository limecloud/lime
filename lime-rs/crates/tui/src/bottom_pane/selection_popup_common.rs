//! Shared visual-row projection for composer suggestions. No catalog or draft state lives here.

use super::scroll_state::ScrollState;
use super::selection_row_layout::{
    build_full_line, line_to_owned, SelectionDescriptionLayout, SelectionRow, MAX_POPUP_ROWS,
};
use crate::line_truncation::{line_width, truncate_line_with_ellipsis_if_overflow};
use crate::style::selection_style;
use crate::width::display_width;
use crate::wrapping::{word_wrap_line, RtOptions};
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::Paragraph;
use ratatui::Frame;

#[derive(Default)]
pub(super) struct RenderedRows {
    pub(super) has_above: bool,
    pub(super) has_below: bool,
}

/// All rows determine column placement so scrolling never shifts descriptions.
pub(super) fn description_column(rows: &[SelectionRow], width: u16) -> usize {
    if width <= 1 {
        return 0;
    }
    rows.iter()
        .map(|row| {
            line_width(&Line::from(row.name_prefix_spans.clone())) + display_width(&row.name)
        })
        .max()
        .unwrap_or(0)
        .saturating_add(2)
        .min((usize::from(width) * 70 / 100).max(1))
}

fn item_window_start(state: &ScrollState, count: usize, visible: usize) -> usize {
    let start = state.scroll_top.min(count.saturating_sub(1));
    match state.selected_idx {
        Some(selected) if selected < start => selected,
        Some(selected) if selected >= start.saturating_add(visible.max(1)) => {
            selected + 1 - visible.max(1)
        }
        _ => start,
    }
}

fn wrapped_rows(
    rows: &[SelectionRow],
    width: u16,
    layout: SelectionDescriptionLayout,
) -> Vec<Vec<Line<'static>>> {
    let desc_col = description_column(rows, width);
    rows.iter()
        .map(|row| {
            if layout.should_stack(width, desc_col) {
                return super::selection_row_layout::wrap_stacked_row(row, width);
            }
            let line = build_full_line(row, desc_col, width, layout);
            let indent = if row.description.is_some() {
                desc_col
            } else {
                line_width(&Line::from(row.name_prefix_spans.clone()))
            }
            .min(usize::from(width.saturating_sub(1)));
            word_wrap_line(
                &line,
                RtOptions::new(usize::from(width.max(1)))
                    .subsequent_indent(Line::from(" ".repeat(indent))),
            )
            .into_iter()
            .map(line_to_owned)
            .collect()
        })
        .collect()
}

pub(super) fn measure_rows_height(rows: &[SelectionRow], state: &ScrollState, width: u16) -> u16 {
    measure_rows_height_with_layout(rows, state, width, SelectionDescriptionLayout::Columns)
}

pub(super) fn measure_rows_height_with_layout(
    rows: &[SelectionRow],
    state: &ScrollState,
    width: u16,
    layout: SelectionDescriptionLayout,
) -> u16 {
    let start = item_window_start(state, rows.len(), MAX_POPUP_ROWS);
    let height = wrapped_rows(rows, width, layout)
        .iter()
        .skip(start)
        .take(MAX_POPUP_ROWS)
        .map(Vec::len)
        .sum::<usize>()
        .max(1);
    u16::try_from(height).unwrap_or(u16::MAX)
}

fn selected_line(mut line: Line<'static>, selected: bool) -> Line<'static> {
    if selected {
        let style = selection_style();
        line.style = style;
        for span in &mut line.spans {
            let secondary = span.style.add_modifier.contains(Modifier::DIM);
            span.style = style.patch(span.style).not_dim();
            span.style.fg = style.fg;
            span.style.bg = style.bg;
            if secondary {
                span.style = span.style.not_bold();
            }
        }
    }
    line
}

pub(super) fn render_rows(
    frame: &mut Frame<'_>,
    area: Rect,
    rows: &[SelectionRow],
    state: &ScrollState,
) {
    render_rows_with_layout(
        frame,
        area,
        rows,
        state,
        SelectionDescriptionLayout::Columns,
    );
}

pub(super) fn render_rows_with_layout(
    frame: &mut Frame<'_>,
    area: Rect,
    rows: &[SelectionRow],
    state: &ScrollState,
    layout: SelectionDescriptionLayout,
) {
    let visual = wrapped_rows(rows, area.width, layout);
    let mut start = item_window_start(state, rows.len(), MAX_POPUP_ROWS);
    if let Some(selected) = state.selected_idx {
        // Wrapped descriptions may consume several terminal lines per item.
        while start < selected
            && visual
                .iter()
                .skip(start)
                .take(selected - start + 1)
                .map(Vec::len)
                .sum::<usize>()
                > usize::from(area.height)
        {
            start += 1;
        }
    }
    let mut y = area.y;
    for (index, lines) in visual
        .into_iter()
        .enumerate()
        .skip(start)
        .take(MAX_POPUP_ROWS)
    {
        if y > area.y && lines.len() > usize::from(area.bottom().saturating_sub(y)) {
            break;
        }
        for line in lines {
            if y >= area.bottom() {
                return;
            }
            frame.render_widget(
                Paragraph::new(selected_line(line, Some(index) == state.selected_idx)).style(
                    if Some(index) == state.selected_idx {
                        selection_style()
                    } else {
                        Style::default()
                    },
                ),
                Rect::new(area.x, y, area.width, 1),
            );
            y += 1;
        }
    }
}

pub(super) fn render_rows_single_line(
    frame: &mut Frame<'_>,
    area: Rect,
    rows: &[SelectionRow],
    state: &ScrollState,
    empty: &str,
) -> RenderedRows {
    if area.is_empty() {
        return RenderedRows::default();
    }
    if rows.is_empty() {
        frame.render_widget(
            Paragraph::new(empty).style(Style::default().dim().italic()),
            area,
        );
        return RenderedRows::default();
    }
    let visible = usize::from(area.height).min(MAX_POPUP_ROWS);
    let start = item_window_start(state, rows.len(), visible);
    let desc_col = description_column(rows, area.width);
    let layout = SelectionDescriptionLayout::HideWhenNarrow {
        min_description_width: 24,
    };
    for (offset, (index, row)) in rows
        .iter()
        .enumerate()
        .skip(start)
        .take(visible)
        .enumerate()
    {
        let line = build_full_line(row, desc_col, area.width, layout);
        let line = selected_line(line, Some(index) == state.selected_idx);
        let line = truncate_line_with_ellipsis_if_overflow(line, usize::from(area.width));
        frame.render_widget(
            Paragraph::new(line).style(if Some(index) == state.selected_idx {
                selection_style()
            } else {
                Style::default()
            }),
            Rect::new(area.x, area.y + offset as u16, area.width, 1),
        );
    }
    RenderedRows {
        has_above: start > 0,
        has_below: start + visible < rows.len(),
    }
}

#[cfg(test)]
#[path = "selection_popup_common_tests.rs"]
mod tests;
