//! Editing and visual navigation share one UTF-8 and atomic-element boundary.

use super::*;

impl TextArea {
    pub(crate) fn replace(&mut self, text: String) {
        self.text = text;
        self.cursor = self.text.len();
        self.reset_text_state();
    }

    pub(crate) fn set_text_clearing_elements(&mut self, text: &str) {
        self.text = text.to_string();
        self.cursor = self.nearest_char_boundary(self.cursor.min(self.text.len()));
        self.reset_text_state();
    }

    pub(crate) fn take(&mut self) -> String {
        self.cursor = 0;
        let text = std::mem::take(&mut self.text);
        self.reset_text_state();
        text
    }

    fn reset_text_state(&mut self) {
        self.editor_key_chord_matcher.reset();
        self.vim_key_chord_matcher.reset();
        self.mouse_selection = None;
        self.elements.clear();
        self.preferred_col = None;
        self.vim_pending = VimPending::None;
        self.vim_search = vim_search::VimSearch::default();
        self.vim_commands = VimCommandState::default();
        self.invalidate_wrap_cache();
    }

    pub(crate) fn insert(&mut self, value: &str) {
        let replaced_selection = !value.is_empty() && self.delete_mouse_selection();
        self.record_vim_inserted_text(value);
        if self.is_vim_replace_mode() && !replaced_selection {
            self.replace_vim_text(value);
        } else {
            self.insert_str_at(self.cursor, value);
        }
    }

    pub(crate) fn insert_str(&mut self, value: &str) {
        self.insert(value);
    }

    pub(crate) fn insert_str_at(&mut self, pos: usize, value: &str) {
        self.clear_vim_replace_recovery();
        self.mouse_selection = None;
        let pos = self.nearest_atomic_boundary(pos);
        self.text.insert_str(pos, value);
        self.shift_elements(pos, pos, value.len());
        if pos <= self.cursor {
            self.cursor += value.len();
        }
        self.preferred_col = None;
        self.invalidate_wrap_cache();
    }

    pub(crate) fn replace_range(&mut self, range: Range<usize>, value: &str) {
        self.clear_vim_replace_recovery();
        self.replace_range_preserving_recovery(range, value);
    }

    pub(super) fn replace_range_preserving_recovery(&mut self, range: Range<usize>, value: &str) {
        self.mouse_selection = None;
        let Range { start, end } = self.atomic_edit_range(range);
        if start > end {
            return;
        }
        self.text.replace_range(start..end, value);
        self.shift_elements(start, end, value.len());
        self.cursor = if self.cursor < start {
            self.cursor
        } else if self.cursor <= end {
            start + value.len()
        } else {
            self.cursor.saturating_sub(end - start) + value.len()
        }
        .min(self.text.len());
        self.preferred_col = None;
        self.invalidate_wrap_cache();
    }

    pub(crate) fn set_cursor(&mut self, pos: usize) {
        self.mouse_selection = None;
        self.cursor = self.nearest_atomic_boundary(pos);
        self.preferred_col = None;
    }

    pub(crate) fn move_left(&mut self) {
        self.mouse_selection = None;
        self.cursor = self.previous_grapheme_start();
        self.preferred_col = None;
    }

    pub(crate) fn move_right(&mut self) {
        self.mouse_selection = None;
        self.cursor = self.next_grapheme_end();
        self.preferred_col = None;
    }

    pub(crate) fn move_line_start(&mut self) {
        self.mouse_selection = None;
        self.cursor = self.line_start();
        self.preferred_col = None;
    }

    pub(crate) fn move_line_end(&mut self) {
        self.mouse_selection = None;
        self.cursor = self.line_end();
        self.preferred_col = None;
    }

    /// Move to the adjacent visual line while preserving the terminal column.
    ///
    /// When wrapping information is available, navigation follows the same visual rows rendered
    /// by the textarea. Without a cache (for example before the first render), it falls back to
    /// logical-line navigation. The target is always chosen on grapheme boundaries, so wide
    /// characters and combining marks can never leave the cursor inside an UTF-8 sequence.
    pub(crate) fn move_up(&mut self) {
        self.mouse_selection = None;
        if !self.move_visual_vertical(-1) {
            self.move_insert_vertical(-1);
        }
    }

    pub(crate) fn move_down(&mut self) {
        self.mouse_selection = None;
        if !self.move_visual_vertical(1) {
            self.move_insert_vertical(1);
        }
    }

    /// Returns whether history navigation may consume a vertical key at the current visual row.
    ///
    /// Once the textarea has been rendered, wrapped rows are the editor's navigation surface;
    /// history is only eligible at the outermost row. Before the first render there is no width
    /// to resolve, so callers retain the legacy boundary behavior.
    pub(crate) fn is_vertical_boundary(&self, direction: i8) -> bool {
        let cache_ref = self.wrap_cache.borrow();
        let Some(cache) = cache_ref.as_ref() else {
            return true;
        };
        let Some((row, _)) =
            wrapping::cursor_position(&self.text, &cache.lines, cache.width, self.cursor)
        else {
            return true;
        };
        if direction < 0 {
            row == 0
        } else {
            row + 1 >= cache.lines.len()
        }
    }

    /// Move across wrapped rows when the current render width is known.
    ///
    /// The returned boolean distinguishes an unavailable cache from a real boundary move. A
    /// boundary move still consumes the event and resets the saved column, matching Codex's
    /// behavior when moving above the first or below the last visual row.
    fn move_visual_vertical(&mut self, direction: i8) -> bool {
        enum Target {
            Line {
                start: usize,
                end: usize,
                column: usize,
            },
            Boundary(usize),
        }

        let target = {
            let cache_ref = self.wrap_cache.borrow();
            let Some(cache) = cache_ref.as_ref() else {
                return false;
            };
            let Some((row, current_column)) =
                wrapping::cursor_position(&self.text, &cache.lines, cache.width, self.cursor)
            else {
                return false;
            };
            let column = self
                .preferred_col
                .unwrap_or(current_column)
                .min(usize::from(cache.width.saturating_sub(1)));

            if direction < 0 {
                if let Some(previous) = row.checked_sub(1) {
                    let current = &cache.lines[row];
                    let previous = &cache.lines[previous];
                    let start = previous.start;
                    let mut end = previous.end.saturating_sub(1);
                    if end == current.start {
                        end = self.previous_grapheme_start_at(end).max(start);
                    }
                    Target::Line { start, end, column }
                } else {
                    Target::Boundary(0)
                }
            } else if let Some(next) = cache.lines.get(row + 1) {
                let start = next.start;
                let mut end = next.end.saturating_sub(1);
                if cache
                    .lines
                    .get(row + 2)
                    .is_some_and(|following| following.start == end)
                {
                    end = self.previous_grapheme_start_at(end).max(start);
                }
                Target::Line { start, end, column }
            } else {
                Target::Boundary(self.text.len())
            }
        };

        match target {
            Target::Line { start, end, column } => {
                if self.preferred_col.is_none() {
                    self.preferred_col = Some(column);
                }
                self.move_to_display_col_on_line(start, end, column);
            }
            Target::Boundary(cursor) => {
                self.cursor = cursor;
                self.preferred_col = None;
            }
        }
        true
    }

    fn move_insert_vertical(&mut self, direction: i8) {
        let current_start = self.line_start();
        let current_column = self
            .preferred_col
            .unwrap_or_else(|| editor_display_width(&self.text[current_start..self.cursor]));
        let target_start = if direction < 0 {
            if current_start == 0 {
                self.preferred_col = None;
                return;
            }
            let previous_end = current_start - 1;
            self.text[..previous_end]
                .rfind('\n')
                .map_or(0, |index| index + 1)
        } else {
            let current_end = self.line_end();
            if current_end == self.text.len() {
                self.preferred_col = None;
                return;
            }
            current_end + 1
        };
        let target_end = self.text[target_start..]
            .find('\n')
            .map_or(self.text.len(), |offset| target_start + offset);
        self.cursor = cursor_at_display_column(
            &self.text[target_start..target_end],
            target_start,
            current_column,
        );
        self.cursor = self.nearest_atomic_boundary(self.cursor);
        if self.preferred_col.is_none() {
            self.preferred_col = Some(current_column);
        }
    }

    pub(crate) fn remove_previous_grapheme(&mut self) -> bool {
        if self.delete_mouse_selection() {
            return true;
        }
        if self.cursor == 0 {
            return false;
        }
        let start = self.previous_grapheme_start();
        self.replace_range(start..self.cursor, "");
        true
    }

    pub(crate) fn remove_next_grapheme(&mut self) -> bool {
        if self.delete_mouse_selection() {
            return true;
        }
        if self.cursor == self.text.len() {
            return false;
        }
        let end = self.next_grapheme_end();
        self.replace_range(self.cursor..end, "");
        true
    }
}
