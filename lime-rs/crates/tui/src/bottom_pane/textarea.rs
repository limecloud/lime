//! Editable UTF-8 text buffer shared by the TUI composer and focused input overlays.
//!
//! `TextArea` is deliberately independent from submission policy. The parent composer owns
//! history, queueing, and attachments while this module owns cursor-safe editing primitives.

use std::borrow::Cow;
use std::cell::{Cell, OnceCell, Ref, RefCell};
use std::ops::Range;
use std::sync::Arc;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{StatefulWidgetRef, WidgetRef};
use unicode_segmentation::UnicodeSegmentation;

use crate::width::display_width;

mod editing;
mod elements;
mod hyperlinks;
mod input;
use elements::TextElement;
pub(crate) use elements::TextElementSnapshot;
mod mouse;
mod vim;
mod vim_commands;
mod vim_register;
pub(crate) use vim_register::KillBufferSnapshot;
mod vim_search;
mod wrapping;

use self::vim::VimPending;
use self::vim_commands::VimCommandState;
pub(crate) use self::vim_commands::VimPersistentState;

const WORD_SEPARATORS: &str = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

fn is_word_separator(ch: char) -> bool {
    WORD_SEPARATORS.contains(ch)
}

fn split_word_pieces(run: &str) -> Vec<(usize, &str)> {
    let mut pieces = Vec::new();
    for (segment_start, segment) in run.split_word_bound_indices() {
        let mut piece_start = 0;
        let mut chars = segment.char_indices();
        let Some((_, first_char)) = chars.next() else {
            continue;
        };
        let mut in_separator = is_word_separator(first_char);
        for (idx, ch) in chars {
            let is_separator = is_word_separator(ch);
            if is_separator == in_separator {
                continue;
            }
            pieces.push((segment_start + piece_start, &segment[piece_start..idx]));
            piece_start = idx;
            in_separator = is_separator;
        }
        pieces.push((segment_start + piece_start, &segment[piece_start..]));
    }
    pieces
}

fn text_for_display(text: &str) -> Cow<'_, str> {
    if text.contains('\t') {
        Cow::Owned(text.replace('\t', " "))
    } else {
        Cow::Borrowed(text)
    }
}

fn editor_display_width(text: &str) -> usize {
    let display = text_for_display(text);
    display_width(display.as_ref())
}

#[derive(Debug, Default)]
pub(crate) struct TextArea {
    text: String,
    elements: Vec<TextElement>,
    next_element_id: u64,
    cursor: usize,
    kill_buffer: String,
    kill_buffer_kind: vim_register::KillBufferKind,
    wrap_cache: RefCell<Option<WrapCache>>,
    preferred_col: Option<usize>,
    vim_enabled: bool,
    vim_mode: vim::VimMode,
    vim_pending: VimPending,
    vim_search: vim_search::VimSearch,
    vim_commands: VimCommandState,
    editor_keymap: Arc<crate::keymap::EditorKeymap>,
    editor_key_chord_matcher: crate::keymap::KeyChordMatcher,
    vim_normal_keymap: Arc<crate::keymap::VimNormalKeymap>,
    vim_operator_keymap: Arc<crate::keymap::VimOperatorKeymap>,
    vim_text_object_keymap: Arc<crate::keymap::VimTextObjectKeymap>,
    vim_search_keymap: Arc<crate::keymap::VimSearchKeymap>,
    vim_key_chord_matcher: crate::keymap::KeyChordMatcher,
    rendered_area: Cell<Rect>,
    mouse_selection: Option<mouse::MouseSelection>,
    last_click: Option<(std::time::Instant, u16, u16, u8)>,
}

#[derive(Debug)]
struct WrapCache {
    width: u16,
    lines: Vec<Range<usize>>,
    hyperlinks: OnceCell<hyperlinks::HyperlinkCache>,
}

/// Viewport state kept outside the editable buffer, matching Codex's stateful textarea widget.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct TextAreaState {
    /// Index into wrapped lines of the first visible line.
    scroll: u16,
}

#[allow(dead_code)]
impl TextArea {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    pub(crate) fn cursor(&self) -> usize {
        self.cursor
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    pub(crate) fn delete_backward(&mut self, n: usize) {
        for _ in 0..n {
            if !self.remove_previous_grapheme() {
                break;
            }
        }
    }

    pub(crate) fn delete_forward(&mut self, n: usize) {
        for _ in 0..n {
            if !self.remove_next_grapheme() {
                break;
            }
        }
    }

    pub(crate) fn delete_forward_kill(&mut self, n: usize) {
        if n == 0 || self.cursor >= self.text.len() {
            return;
        }
        let mut target = self.cursor;
        for _ in 0..n {
            target = self.next_grapheme_end_at(target);
            if target >= self.text.len() {
                break;
            }
        }
        self.kill_range(self.cursor..target);
    }

    pub(crate) fn delete_backward_word(&mut self) {
        let start = self.beginning_of_previous_word();
        self.kill_range(start..self.cursor);
    }

    /// Delete text to the right of the cursor through the next word boundary.
    pub(crate) fn delete_forward_word(&mut self) {
        let end = self.end_of_next_word();
        if end > self.cursor {
            self.kill_range(self.cursor..end);
        }
    }

    /// Kill from the cursor to the end of the current logical line.
    pub(crate) fn kill_to_end_of_line(&mut self) {
        let eol = self.line_end();
        let range = if self.cursor == eol {
            (eol < self.text.len()).then_some(self.cursor..eol + 1)
        } else {
            Some(self.cursor..eol)
        };
        if let Some(range) = range {
            self.kill_range(range);
        }
    }

    /// Kill from the beginning of the current logical line through the cursor.
    pub(crate) fn kill_to_beginning_of_line(&mut self) {
        let bol = self.line_start();
        let range = if self.cursor == bol {
            (bol > 0).then_some(bol - 1..bol)
        } else {
            Some(bol..self.cursor)
        };
        if let Some(range) = range {
            self.kill_range(range);
        }
    }

    /// Insert the most recently killed text at the cursor.
    pub(crate) fn yank(&mut self) {
        if !self.kill_buffer.is_empty() {
            let text = self.kill_buffer.clone();
            self.insert_str(&text);
        }
    }

    pub(crate) fn beginning_of_previous_word(&self) -> usize {
        let prefix = &self.text[..self.cursor];
        let Some((first_non_ws_idx, ch)) = prefix
            .char_indices()
            .rev()
            .find(|&(_, ch)| !ch.is_whitespace())
        else {
            return 0;
        };
        let run_start = prefix[..first_non_ws_idx]
            .char_indices()
            .rev()
            .find(|&(_, ch)| ch.is_whitespace())
            .map_or(0, |(idx, ch)| idx + ch.len_utf8());
        let run_end = first_non_ws_idx + ch.len_utf8();
        let pieces = split_word_pieces(&prefix[run_start..run_end]);
        let mut pieces = pieces.into_iter().rev().peekable();
        let Some((piece_start, piece)) = pieces.next() else {
            return run_start;
        };
        let mut start = run_start + piece_start;
        if piece.chars().all(is_word_separator) {
            while let Some((idx, piece)) = pieces.peek() {
                if !piece.chars().all(is_word_separator) {
                    break;
                }
                start = run_start + *idx;
                pieces.next();
            }
        }
        self.atomic_edit_range(start..self.cursor).start
    }

    pub(crate) fn end_of_next_word(&self) -> usize {
        self.end_of_next_word_from(self.cursor)
    }

    pub(super) fn end_of_next_word_from(&self, cursor: usize) -> usize {
        let suffix = &self.text[cursor..];
        let Some(first_non_ws) = suffix.find(|ch: char| !ch.is_whitespace()) else {
            return self.text.len();
        };
        let run = &suffix[first_non_ws..];
        let run = &run[..run.find(char::is_whitespace).unwrap_or(run.len())];
        let mut pieces = split_word_pieces(run).into_iter().peekable();
        let Some((start, piece)) = pieces.next() else {
            return cursor + first_non_ws;
        };
        let word_start = cursor + first_non_ws + start;
        let mut end = word_start + piece.len();
        if piece.chars().all(is_word_separator) {
            while let Some((idx, piece)) = pieces.peek() {
                if !piece.chars().all(is_word_separator) {
                    break;
                }
                end = cursor + first_non_ws + *idx + piece.len();
                pieces.next();
            }
        }
        self.atomic_edit_range(cursor..end).end
    }

    fn kill_range(&mut self, range: Range<usize>) {
        if let Some(selection) = self.mouse_selection_range() {
            self.store_kill_buffer(
                self.text[selection.clone()].to_string(),
                vim_register::KillBufferKind::Characterwise,
            );
            self.replace_range(selection, "");
            return;
        }
        let Range { start, end } = self.atomic_edit_range(range);
        if start >= end {
            return;
        }
        self.store_kill_buffer(
            self.text[start..end].to_string(),
            vim_register::KillBufferKind::Characterwise,
        );
        self.replace_range(start..end, "");
    }

    pub(crate) fn wrapped_lines(&self, width: u16) -> Ref<'_, Vec<std::ops::Range<usize>>> {
        {
            let mut cache = self.wrap_cache.borrow_mut();
            let needs_recalc = cache.as_ref().is_none_or(|cache| cache.width != width);
            if needs_recalc {
                let display_text = text_for_display(&self.text);
                *cache = Some(WrapCache {
                    width,
                    lines: wrapping::wrapped_lines(display_text.as_ref(), width),
                    hyperlinks: OnceCell::new(),
                });
            }
        }

        let cache = self.wrap_cache.borrow();
        Ref::map(cache, |cache| {
            &cache
                .as_ref()
                .expect("textarea wrap cache initialized")
                .lines
        })
    }

    pub(crate) fn cursor_position(&self, width: u16) -> Option<(usize, usize)> {
        let lines = self.wrapped_lines(width);
        wrapping::cursor_position(&self.text, &lines, width, self.cursor)
    }

    pub(crate) fn cursor_pos(&self, area: Rect) -> Option<(u16, u16)> {
        self.cursor_pos_with_state(area, TextAreaState::default())
    }

    pub(crate) fn cursor_pos_with_state(
        &self,
        area: Rect,
        state: TextAreaState,
    ) -> Option<(u16, u16)> {
        if area.is_empty() {
            return None;
        }
        let lines = self.wrapped_lines(area.width);
        let scroll = self.effective_scroll(area, &lines, state.scroll);
        let (row, column) = wrapping::cursor_position(&self.text, &lines, area.width, self.cursor)?;
        Some((
            area.x.saturating_add(column as u16),
            area.y
                .saturating_add(row.saturating_sub(scroll as usize) as u16)
                .min(area.bottom().saturating_sub(1)),
        ))
    }

    pub(crate) fn desired_height(&self, width: u16) -> u16 {
        self.wrapped_lines(width).len().max(1) as u16
    }

    pub(crate) fn remember_rendered_area(&self, area: Rect) {
        self.rendered_area.set(area);
    }

    fn effective_scroll(&self, area: Rect, lines: &[Range<usize>], current: u16) -> u16 {
        if area.height == 0 || lines.is_empty() {
            return 0;
        }
        let total = lines.len() as u16;
        if total <= area.height {
            return 0;
        }
        let cursor_row = wrapping::cursor_position(&self.text, lines, area.width, self.cursor)
            .map(|(row, _)| row as u16)
            .unwrap_or_default();
        let max_scroll = total.saturating_sub(area.height);
        let mut scroll = current.min(max_scroll);
        if cursor_row < scroll {
            scroll = cursor_row;
        } else if cursor_row >= scroll.saturating_add(area.height) {
            scroll = cursor_row
                .saturating_add(1)
                .saturating_sub(area.height)
                .min(max_scroll);
        }
        scroll
    }

    fn invalidate_wrap_cache(&mut self) {
        self.wrap_cache.get_mut().take();
        self.preferred_col = None;
    }

    fn nearest_char_boundary(&self, mut pos: usize) -> usize {
        while pos > 0 && !self.text.is_char_boundary(pos) {
            pos -= 1;
        }
        pos
    }

    fn render_lines(&self, area: Rect, buf: &mut Buffer, lines: &[Range<usize>], scroll: u16) {
        self.rendered_area.set(area);
        let blank = " ".repeat(usize::from(area.width));
        for row in 0..area.height {
            buf.set_string(area.x, area.y + row, &blank, Style::default());
        }
        let start = usize::from(scroll);
        let end = (start + usize::from(area.height)).min(lines.len());
        for (row, range) in lines[start..end].iter().enumerate() {
            let content_end = range.end.saturating_sub(1).min(self.text.len());
            let content_start = range.start.min(content_end);
            let visible =
                wrapping::visible_prefix(&self.text[content_start..content_end], area.width);
            buf.set_string(
                area.x,
                area.y + row as u16,
                text_for_display(visible),
                Style::default(),
            );
            self.render_elements(
                area,
                buf,
                content_start..content_start + visible.len(),
                area.y + row as u16,
            );
            self.render_mouse_selection(area, buf, range, visible, area.y + row as u16);
        }
        if let Some(wrap_cache) = self.wrap_cache.borrow().as_ref() {
            wrap_cache
                .hyperlinks
                .get_or_init(|| hyperlinks::HyperlinkCache::new(&self.text, lines))
                .mark(buf, area, &self.text, lines, start..end);
        }
    }

    /// Render the textarea with a fixed-width mask without exposing hyperlink destinations.
    pub(crate) fn render_ref_masked(
        &self,
        area: Rect,
        buf: &mut Buffer,
        state: &mut TextAreaState,
        mask_char: char,
    ) {
        self.rendered_area.set(area);
        let lines = self.wrapped_lines(area.width);
        state.scroll = self.effective_scroll(area, &lines, state.scroll);
        let start = usize::from(state.scroll);
        let end = (start + usize::from(area.height)).min(lines.len());
        let blank = " ".repeat(usize::from(area.width));
        for row in 0..area.height {
            buf.set_string(area.x, area.y + row, &blank, Style::default());
        }
        for (row, range) in lines[start..end].iter().enumerate() {
            let content_end = range.end.saturating_sub(1).min(self.text.len());
            let content_start = range.start.min(content_end);
            let visible =
                wrapping::visible_prefix(&self.text[content_start..content_end], area.width);
            let masked = visible
                .graphemes(true)
                .flat_map(|grapheme| {
                    std::iter::repeat_n(mask_char, crate::width::display_width(grapheme))
                })
                .collect::<String>();
            buf.set_string(area.x, area.y + row as u16, masked, Style::default());
        }
    }

    /// Render the textarea with render-only highlight ranges and preserve OSC 8 annotations.
    pub(crate) fn render_ref_styled_with_highlights(
        &self,
        area: Rect,
        buf: &mut Buffer,
        state: &mut TextAreaState,
        base_style: Style,
        highlights: &[(Range<usize>, Style)],
    ) {
        self.rendered_area.set(area);
        let lines = self.wrapped_lines(area.width);
        state.scroll = self.effective_scroll(area, &lines, state.scroll);
        let start = usize::from(state.scroll);
        let end = (start + usize::from(area.height)).min(lines.len());
        let blank = " ".repeat(usize::from(area.width));
        for row in 0..area.height {
            buf.set_string(area.x, area.y + row, &blank, base_style);
        }
        for (row, range) in lines[start..end].iter().enumerate() {
            let content_end = range.end.saturating_sub(1).min(self.text.len());
            let content_start = range.start.min(content_end);
            let visible =
                wrapping::visible_prefix(&self.text[content_start..content_end], area.width);
            let line_range = content_start..content_start + visible.len();
            let y = area.y + row as u16;
            buf.set_stringn(
                area.x,
                y,
                text_for_display(visible),
                usize::from(area.width),
                base_style,
            );
            self.render_elements(area, buf, line_range.clone(), y);
            for (highlight_range, style) in highlights {
                let overlap_start = highlight_range.start.max(line_range.start);
                let overlap_end = highlight_range.end.min(line_range.end);
                if overlap_start >= overlap_end {
                    continue;
                }
                let x = area.x
                    + crate::width::display_width(&self.text[line_range.start..overlap_start])
                        as u16;
                buf.set_stringn(
                    x,
                    y,
                    text_for_display(&self.text[overlap_start..overlap_end]),
                    usize::from(area.width.saturating_sub(x.saturating_sub(area.x))),
                    *style,
                );
            }
            self.render_mouse_selection(area, buf, range, visible, y);
        }
        if let Some(wrap_cache) = self.wrap_cache.borrow().as_ref() {
            wrap_cache
                .hyperlinks
                .get_or_init(|| hyperlinks::HyperlinkCache::new(&self.text, &lines))
                .mark(buf, area, &self.text, &lines, start..end);
        }
    }

    fn previous_grapheme_start(&self) -> usize {
        self.previous_grapheme_start_at(self.cursor)
    }

    fn previous_grapheme_start_at(&self, cursor: usize) -> usize {
        if let Some(element) = self
            .elements
            .iter()
            .find(|element| element.range.end == cursor)
        {
            return element.range.start;
        }
        self.text[..cursor]
            .grapheme_indices(true)
            .next_back()
            .map(|(index, _)| index)
            .unwrap_or(0)
    }

    fn move_to_display_col_on_line(&mut self, line_start: usize, line_end: usize, target: usize) {
        let mut column: usize = 0;
        for (offset, grapheme) in self.text[line_start..line_end].grapheme_indices(true) {
            let width = editor_display_width(grapheme);
            if column.saturating_add(width) > target {
                self.cursor = self.nearest_atomic_boundary(line_start + offset);
                return;
            }
            column = column.saturating_add(width);
        }
        self.cursor = self.nearest_atomic_boundary(line_end);
    }

    fn next_grapheme_end(&self) -> usize {
        self.next_grapheme_end_at(self.cursor)
    }

    fn next_grapheme_end_at(&self, cursor: usize) -> usize {
        if let Some(element) = self
            .elements
            .iter()
            .find(|element| element.range.start == cursor)
        {
            return element.range.end;
        }
        self.text[cursor..]
            .graphemes(true)
            .next()
            .map(|grapheme| cursor + grapheme.len())
            .unwrap_or(self.text.len())
    }

    fn line_start(&self) -> usize {
        self.text[..self.cursor]
            .rfind('\n')
            .map(|index| index + 1)
            .unwrap_or(0)
    }

    fn line_end(&self) -> usize {
        self.text[self.cursor..]
            .find('\n')
            .map(|index| self.cursor + index)
            .unwrap_or(self.text.len())
    }
}

fn cursor_at_display_column(line: &str, line_start: usize, target_column: usize) -> usize {
    if target_column == 0 {
        return line_start;
    }

    let mut column: usize = 0;
    for (offset, grapheme) in line.grapheme_indices(true) {
        column = column.saturating_add(editor_display_width(grapheme));
        if column > target_column {
            return line_start + offset;
        }
    }
    line_start + line.len()
}

impl WidgetRef for &TextArea {
    fn render_ref(&self, area: Rect, buf: &mut Buffer) {
        let lines = self.wrapped_lines(area.width);
        self.render_lines(area, buf, &lines, 0);
    }
}

impl StatefulWidgetRef for &TextArea {
    type State = TextAreaState;

    fn render_ref(&self, area: Rect, buf: &mut Buffer, state: &mut Self::State) {
        let lines = self.wrapped_lines(area.width);
        state.scroll = self.effective_scroll(area, &lines, state.scroll);
        self.render_lines(area, buf, &lines, state.scroll);
    }
}

#[cfg(test)]
mod tests;
