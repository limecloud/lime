//! Hit testing and editable mouse selections share the textarea's rendered wrap and scroll state.

use std::ops::Range;

use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::style::{Modifier, Style};

use super::{cursor_at_display_column, text_for_display, TextArea, TextAreaState};
use crate::text_selection::SelectionUnit;

#[derive(Debug)]
pub(super) struct MouseSelection {
    origin: Range<usize>,
    unit: SelectionUnit,
    dragging: bool,
    moved: bool,
}

impl TextArea {
    pub(in crate::bottom_pane) fn contains_mouse(&self, event: MouseEvent) -> bool {
        self.rendered_area
            .get()
            .contains(Position::new(event.column, event.row))
    }

    pub(crate) fn end_mouse_drag(&mut self) {
        if let Some(selection) = &mut self.mouse_selection {
            selection.dragging = false;
        }
    }

    pub(crate) fn clear_mouse_selection(&mut self) {
        self.mouse_selection = None;
    }

    pub(crate) fn mouse_selection_range(&self) -> Option<Range<usize>> {
        let origin = &self.mouse_selection.as_ref()?.origin;
        let range = origin.start.min(self.cursor)..origin.end.max(self.cursor);
        (!range.is_empty()).then(|| self.atomic_edit_range(range))
    }

    pub(crate) fn selected_text(&self) -> Option<&str> {
        self.mouse_selection_range()
            .and_then(|range| self.text.get(range))
    }

    pub(super) fn delete_mouse_selection(&mut self) -> bool {
        let Some(range) = self.mouse_selection_range() else {
            return false;
        };
        self.vim_pending = super::VimPending::None;
        self.replace_range(range, "");
        true
    }

    pub(crate) fn handle_mouse(&mut self, event: MouseEvent, state: TextAreaState) -> bool {
        let area = self.rendered_area.get();
        let dragging = self.mouse_selection.as_ref().is_some_and(|s| s.dragging);
        if area.is_empty() {
            self.end_mouse_drag();
            return false;
        }
        match event.kind {
            MouseEventKind::Down(MouseButton::Left)
                if event.modifiers.is_empty() && self.contains_mouse(event) => {}
            MouseEventKind::Drag(MouseButton::Left) | MouseEventKind::Up(MouseButton::Left)
                if dragging => {}
            _ => return false,
        }

        if matches!(event.kind, MouseEventKind::Up(MouseButton::Left))
            && self.mouse_selection.as_ref().is_some_and(|s| !s.moved)
        {
            self.end_mouse_drag();
            return true;
        }

        let lines = self.wrapped_lines(area.width);
        let row = usize::from(state.scroll)
            + usize::from(event.row.saturating_sub(area.y).min(area.height - 1));
        // Dragging beyond the viewport advances one wrapped row per event.
        let row = if event.row < area.y {
            row.saturating_sub(1)
        } else if event.row >= area.bottom() {
            row + 1
        } else {
            row
        };
        let line = lines[row.min(lines.len() - 1)].clone();
        drop(lines);
        let line_end = line.end.saturating_sub(1).min(self.text.len());
        let col = usize::from(event.column.saturating_sub(area.x).min(area.width));
        let pos = cursor_at_display_column(&self.text[line.start..line_end], line.start, col);
        let down = matches!(event.kind, MouseEventKind::Down(MouseButton::Left));
        let mut selection = if down {
            if self.mouse_selection.is_none() {
                self.last_click = None;
            }
            let clicks =
                crate::text_selection::click_count(&mut self.last_click, event.column, event.row);
            MouseSelection {
                origin: pos..pos,
                // Padding remains an insertion target on repeated clicks.
                unit: SelectionUnit::from_clicks(if pos == line_end { 1 } else { clicks }),
                dragging: true,
                moved: false,
            }
        } else if let Some(selection) = self.mouse_selection.take() {
            selection
        } else {
            return false;
        };
        let range = self.atomic_edit_range(selection.unit.range(&self.text, pos));
        self.preferred_col = None;
        self.vim_pending = super::VimPending::None;
        self.clear_vim_replace_recovery();
        if down {
            selection.origin = range.clone();
        }
        self.cursor = if range.start < selection.origin.start {
            range.start
        } else {
            range.end
        };
        selection.moved |= !down;
        selection.dragging = !matches!(event.kind, MouseEventKind::Up(MouseButton::Left));
        self.mouse_selection = Some(selection);
        true
    }

    pub(super) fn render_mouse_selection(
        &self,
        area: Rect,
        buf: &mut Buffer,
        source_range: &Range<usize>,
        visible: &str,
        y: u16,
    ) {
        let Some(selection) = self.mouse_selection_range() else {
            return;
        };
        let line_start = source_range.start;
        let line_end = line_start.saturating_add(visible.len());
        let overlap_start = selection.start.max(line_start);
        let overlap_end = selection.end.min(line_end);
        if overlap_start >= overlap_end {
            return;
        }
        let x_offset = crate::width::display_width(&self.text[line_start..overlap_start]);
        let width = crate::width::display_width(&self.text[overlap_start..overlap_end]);
        if x_offset >= usize::from(area.width) || width == 0 {
            return;
        }
        let x_offset = u16::try_from(x_offset).unwrap_or(u16::MAX);
        let width = u16::try_from(width)
            .unwrap_or(u16::MAX)
            .min(area.width.saturating_sub(x_offset));
        let selected = Rect::new(area.x.saturating_add(x_offset), y, width, 1);
        buf.set_style(selected, Style::default().add_modifier(Modifier::REVERSED));
        // Re-assert the visible symbols because style-only writes intentionally preserve OSC 8.
        let text = &self.text[overlap_start..overlap_end];
        buf.set_stringn(
            selected.x,
            y,
            text_for_display(text),
            usize::from(width),
            Style::default().add_modifier(Modifier::REVERSED),
        );
    }
}

#[cfg(test)]
#[path = "mouse_tests.rs"]
mod tests;
