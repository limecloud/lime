//! Borderless bottom picker; wrapped visual rows drive both measurement and scrolling.

use crate::bottom_pane::selection_row_layout::MAX_POPUP_ROWS;
use crate::keymap::{ListAction, ListKeymap};
use crate::locale::Locale;
use ratatui::Frame;
use unicode_segmentation::UnicodeSegmentation;

use crate::bottom_pane::selection_row_layout::{
    wrap_row, SelectionDescriptionLayout, SelectionRow,
};
use crate::line_truncation::{line_width, truncate_line_with_ellipsis_if_overflow};
use crate::style::{muted_style, selection_style};
use crate::width::display_width;
use ratatui::layout::{Position, Rect};
use ratatui::style::Stylize;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};

/// Display-only parameters; callers retain selection, input, and canonical thread/model state.
pub(crate) struct ListSelectionView<'a> {
    pub(crate) title: &'a str,
    pub(crate) subtitle: Line<'static>,
    pub(crate) query: Option<&'a str>,
    pub(crate) entries: Vec<SelectionRow>,
    pub(crate) selected: usize,
    pub(crate) empty_text: &'a str,
    pub(crate) keymap: &'a ListKeymap,
    pub(crate) locale: Locale,
}

fn rows(view: &ListSelectionView<'_>, width: u16) -> Vec<Vec<Line<'static>>> {
    let entries = &view.entries;
    let row_width = width.saturating_sub(2).max(1);
    let name_width = entries
        .iter()
        .map(|entry| {
            display_width(&entry.name)
                + entry
                    .name_prefix_spans
                    .iter()
                    .map(|span| display_width(&span.content))
                    .sum::<usize>()
        })
        .max()
        .unwrap_or(0);
    let desc_col = name_width
        .saturating_add(2)
        .min((usize::from(row_width) * 70 / 100).max(1))
        .max(1);
    entries
        .iter()
        .map(|entry| {
            wrap_row(
                entry,
                desc_col,
                row_width,
                SelectionDescriptionLayout::StackBelowWhenNarrow {
                    min_description_width: 12,
                },
            )
        })
        .collect()
}

pub(crate) fn desired_height(view: &ListSelectionView<'_>, width: u16) -> u16 {
    let height = rows(view, width)
        .iter()
        .take(MAX_POPUP_ROWS)
        .map(Vec::len)
        .sum::<usize>()
        .clamp(1, MAX_POPUP_ROWS * 2);
    u16::try_from(height).unwrap_or(u16::MAX).saturating_add(6)
}

fn visible_window(rows: &[Vec<Line<'static>>], selected: usize, height: usize) -> (usize, usize) {
    if rows.is_empty() || height == 0 {
        return (0, 0);
    }
    let selected = selected.min(rows.len() - 1);
    let mut start = selected;
    let mut used = rows[selected].len().min(height);
    while start > 0
        && selected - start + 1 < MAX_POPUP_ROWS
        && used + rows[start - 1].len() <= height
    {
        start -= 1;
        used += rows[start].len();
    }
    let mut end = selected + 1;
    while end < rows.len() && end - start < MAX_POPUP_ROWS && used + rows[end].len() <= height {
        used += rows[end].len();
        end += 1;
    }
    (start, end)
}

fn suffix(text: &str, width: usize) -> &str {
    let mut used = 0;
    let mut start = text.len();
    for (offset, grapheme) in text.grapheme_indices(true).rev() {
        let next = used + display_width(grapheme);
        if next > width {
            break;
        }
        start = offset;
        used = next;
    }
    &text[start..]
}

/// Returns the actual painted item count used by configured page navigation.
pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, view: &ListSelectionView<'_>) -> usize {
    let height = desired_height(view, area.width).min(area.height);
    let area = Rect::new(
        area.x,
        area.bottom().saturating_sub(height),
        area.width,
        height,
    );
    if area.is_empty() {
        return 1;
    }
    frame.render_widget(Clear, area);
    // Title/search/result take priority over spacing and wrapped hints at tiny heights.
    let content_x = area.x.saturating_add(2.min(area.width.saturating_sub(1)));
    let content_width = area.right().saturating_sub(content_x).saturating_sub(2);
    let title = Rect::new(content_x, area.y, content_width, 1);
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_if_overflow(
            Line::from(view.title.to_string()).bold(),
            usize::from(title.width),
        )),
        title,
    );
    if height < 2 {
        return 1;
    }
    let title_gap = u16::from(height >= 6);
    let search_y = area.y + 1 + title_gap;
    let search = Rect::new(content_x, search_y, content_width, 1);
    let query = suffix(
        view.query.unwrap_or_default(),
        usize::from(search.width.saturating_sub(1)),
    );
    let search_line = if view.query.is_some_and(|query| !query.is_empty()) {
        Line::from(query.to_string())
    } else {
        view.subtitle.clone()
    };
    frame.render_widget(
        Paragraph::new(truncate_line_with_ellipsis_if_overflow(
            search_line,
            usize::from(search.width),
        )),
        search,
    );
    if search.width > 0 && view.query.is_some() {
        frame.set_cursor_position(Position::new(
            search.x
                + u16::try_from(display_width(query))
                    .unwrap_or(u16::MAX)
                    .min(search.width - 1),
            search.y,
        ));
    }
    if height < 3 {
        return 1;
    }
    let footer_height = u16::from(height >= 4);
    let search_gap = u16::from(height >= 7);
    let footer_gap = u16::from(height >= 7);
    let list_y = search_y + 1 + search_gap;
    let list_bottom = area.bottom().saturating_sub(footer_height + footer_gap);
    let list = Rect::new(
        area.x,
        list_y,
        area.width,
        list_bottom.saturating_sub(list_y),
    );
    let rows = rows(view, list.width);
    let selected_row = view.selected;
    let (start, end) = visible_window(&rows, selected_row, usize::from(list.height));

    let mut y = list.y;
    for (index, row) in rows.iter().enumerate().take(end).skip(start) {
        let selected = index == selected_row;
        for (line_index, line) in row.iter().enumerate() {
            if y >= list.bottom() {
                break;
            }
            let mut line = line.clone();
            line.spans.insert(
                0,
                Span::raw(if selected && line_index == 0 {
                    "› "
                } else {
                    "  "
                }),
            );
            let line = truncate_line_with_ellipsis_if_overflow(line, usize::from(list.width));
            let style = if selected {
                selection_style()
            } else {
                ratatui::style::Style::default()
            };
            frame.render_widget(
                Paragraph::new(line).style(style),
                Rect::new(list.x, y, list.width, 1),
            );
            y += 1;
        }
    }
    if rows.is_empty() && list.height > 0 {
        frame.render_widget(
            Paragraph::new(view.empty_text).style(muted_style()),
            Rect::new(content_x, list.y, content_width, 1),
        );
    }
    if footer_height > 0 {
        let footer = Rect::new(content_x, area.bottom() - 1, content_width, 1);
        let hint = controls_hint(view.locale, view.keymap, usize::from(footer.width));
        frame.render_widget(
            Paragraph::new(truncate_line_with_ellipsis_if_overflow(
                Line::from(hint).dim(),
                usize::from(footer.width),
            )),
            footer,
        );
    }
    debug_assert!(rows
        .iter()
        .flatten()
        .all(|line| line_width(line) <= usize::from(list.width.saturating_sub(2).max(1))));
    end.saturating_sub(start).max(1)
}
/// Never truncate a chord or advertise a default that the configured snapshot replaced.
fn controls_hint(locale: Locale, keymap: &ListKeymap, width: usize) -> String {
    let accept = keymap.primary_hint(ListAction::Accept);
    let cancel = keymap.primary_hint(ListAction::Cancel);
    let keys = [accept.as_deref(), cancel.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    [
        locale.selection_picker_footer(accept.as_deref(), cancel.as_deref()),
        keys.join(" · "),
        keys.join(" "),
        cancel.unwrap_or_default(),
        accept.unwrap_or_default(),
    ]
    .into_iter()
    .find(|hint| display_width(hint) <= width)
    .unwrap_or_default()
}
