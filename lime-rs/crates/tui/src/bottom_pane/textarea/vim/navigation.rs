//! Vim motions consume the same atomic textarea boundaries as insert-mode navigation.

use super::TextArea;
use unicode_segmentation::UnicodeSegmentation;

impl TextArea {
    pub(super) fn move_left_normal(&mut self) {
        self.move_left();
    }

    pub(super) fn move_right_normal(&mut self) {
        let next = self.next_grapheme_end().min(self.vim_normal_end_cursor());
        self.set_cursor(next);
    }

    pub(super) fn move_word_forward(&mut self) {
        self.set_cursor(self.beginning_of_next_word());
    }

    pub(super) fn beginning_of_next_word(&self) -> usize {
        let Some(non_ws) = self.text[self.cursor..].find(|ch: char| !ch.is_whitespace()) else {
            return self.text.len();
        };
        let start = self.cursor + non_ws;
        let target = if start != self.cursor {
            start
        } else {
            let end = self.end_of_next_word();
            end + self.text[end..]
                .find(|ch: char| !ch.is_whitespace())
                .unwrap_or(self.text.len() - end)
        };
        self.elements
            .iter()
            .find(|element| element.range.contains(&target))
            .map_or(target, |element| element.range.start)
    }

    pub(super) fn vim_word_end_exclusive(&self) -> usize {
        let end = self.end_of_next_word();
        let target = if end > self.cursor {
            self.previous_grapheme_start_at(end)
        } else {
            end
        };
        if target == self.cursor && end < self.text.len() {
            self.end_of_next_word_from(end)
        } else {
            end
        }
    }

    pub(super) fn vim_word_end_cursor(&self) -> usize {
        let end = self.vim_word_end_exclusive();
        if end > self.cursor {
            self.previous_grapheme_start_at(end)
        } else {
            end
        }
    }

    pub(super) fn vim_line_end(&self) -> usize {
        let end = self.line_end();
        if end > self.line_start() {
            self.text[..end]
                .grapheme_indices(true)
                .next_back()
                .map(|(index, _)| index)
                .unwrap_or(end)
        } else {
            end
        }
    }

    pub(super) fn move_vertical(&mut self, delta: isize) {
        if delta < 0 {
            self.move_up();
        } else {
            self.move_down();
        }
        self.cursor = self.cursor.min(self.vim_normal_end_cursor());
    }
}
