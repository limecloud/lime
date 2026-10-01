use super::split_word_pieces;
use super::vim_commands::{VimAction, VimCommandState, VimInsertPosition};
use super::TextArea;
mod input;
mod navigation;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::style::{Color, Style};
use ratatui::text::Span;
use std::ops::Range;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum VimMode {
    Normal,
    #[default]
    Insert,
    Replace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VimOperator {
    Delete,
    Change,
    Yank,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum VimPending {
    #[default]
    None,
    Operator(VimOperator),
    TextObject {
        operator: VimOperator,
        scope: VimTextObjectScope,
    },
    Find {
        motion: VimFindMotion,
        operator: Option<VimOperator>,
    },
    Replace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VimFindMotion {
    Forward,
    Backward,
    TillForward,
    TillBackward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VimMotion {
    Left,
    Right,
    Up,
    Down,
    WordForward,
    WordBackward,
    WordEnd,
    LineStart,
    LineEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VimTextObjectScope {
    Inner,
    Around,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VimTextObject {
    Word,
    BigWord,
    Parentheses,
    Brackets,
    Braces,
    DoubleQuote,
    SingleQuote,
    Backtick,
}

impl TextArea {
    pub(crate) fn set_vim_enabled(&mut self, enabled: bool) {
        self.vim_enabled = enabled;
        self.vim_commands = VimCommandState::default();
        self.vim_pending = VimPending::None;
        self.vim_key_chord_matcher.reset();
        self.vim_search = super::vim_search::VimSearch::default();
        self.clear_vim_replace_recovery();
        self.preferred_col = None;
        self.vim_mode = if enabled {
            VimMode::Normal
        } else {
            VimMode::Insert
        };
    }

    pub(crate) fn is_vim_enabled(&self) -> bool {
        self.vim_enabled
    }

    pub(crate) fn is_vim_normal_mode(&self) -> bool {
        self.vim_enabled && self.vim_mode == VimMode::Normal
    }

    pub(crate) fn allows_paste_burst(&self) -> bool {
        !self.vim_enabled || matches!(self.vim_mode, VimMode::Insert | VimMode::Replace)
    }

    pub(crate) fn vim_normal_end_cursor(&self) -> usize {
        self.previous_grapheme_start_at(self.text.len())
    }

    pub(crate) fn is_vim_operator_pending(&self) -> bool {
        self.vim_search_query().is_some()
            || self.vim_key_chord_matcher.is_pending()
            || !matches!(self.vim_pending, VimPending::None)
    }

    pub(crate) fn should_handle_vim_insert_escape(&self, event: KeyEvent) -> bool {
        self.vim_enabled
            && event.code == KeyCode::Esc
            && event.modifiers == KeyModifiers::NONE
            && matches!(event.kind, KeyEventKind::Press | KeyEventKind::Repeat)
            && (self.vim_mode != VimMode::Normal || self.is_vim_operator_pending())
    }

    pub(crate) fn vim_mode_indicator_span(&self) -> Option<Span<'static>> {
        let (label, color) = match self.vim_mode {
            VimMode::Normal => ("Vim: Normal", Color::Magenta),
            VimMode::Insert => ("Vim: Insert", Color::Green),
            VimMode::Replace => ("Vim: Replace", Color::Cyan),
        };
        self.vim_enabled
            .then(|| Span::styled(label, Style::default().fg(color)))
    }

    pub(crate) fn enter_vim_insert_mode(&mut self) {
        if self.vim_enabled {
            self.vim_mode = VimMode::Insert;
            self.vim_pending = VimPending::None;
            self.clear_vim_replace_recovery();
            self.vim_search.cancel();
            if self.vim_commands.pending_change.is_empty() && !self.vim_commands.replaying {
                self.start_vim_edit(VimAction::Insert(VimInsertPosition::Cursor));
            }
        }
    }

    pub(crate) fn enter_vim_normal_mode(&mut self) {
        if self.vim_enabled {
            self.vim_mode = VimMode::Normal;
            self.vim_pending = VimPending::None;
            self.clear_vim_replace_recovery();
            self.preferred_col = None;
            if !self.text.is_empty() {
                self.cursor = self.vim_normal_end_cursor().min(self.cursor);
            }
        }
    }

    pub(super) fn text_object_range(
        &self,
        object: VimTextObject,
        scope: VimTextObjectScope,
    ) -> Option<Range<usize>> {
        match object {
            VimTextObject::Word => self.word_text_object_range(scope, false),
            VimTextObject::BigWord => self.word_text_object_range(scope, true),
            VimTextObject::Parentheses => self.paired_text_object_range(scope, '(', ')'),
            VimTextObject::Brackets => self.paired_text_object_range(scope, '[', ']'),
            VimTextObject::Braces => self.paired_text_object_range(scope, '{', '}'),
            VimTextObject::DoubleQuote => self.quoted_text_object_range(scope, '"'),
            VimTextObject::SingleQuote => self.quoted_text_object_range(scope, '\''),
            VimTextObject::Backtick => self.quoted_text_object_range(scope, '\u{60}'),
        }
    }

    fn word_text_object_range(
        &self,
        scope: VimTextObjectScope,
        big_word: bool,
    ) -> Option<Range<usize>> {
        let mut runs = Vec::new();
        let mut start = None;
        for (idx, ch) in self.text.char_indices() {
            if ch.is_whitespace() {
                if let Some(run_start) = start.take() {
                    runs.push(run_start..idx);
                }
            } else if start.is_none() {
                start = Some(idx);
            }
        }
        if let Some(run_start) = start {
            runs.push(run_start..self.text.len());
        }
        let run = runs
            .iter()
            .find(|range| range.start <= self.cursor && self.cursor < range.end)
            .or_else(|| runs.iter().find(|range| range.end == self.cursor))?
            .clone();
        let inner = if big_word {
            run
        } else {
            split_word_pieces(&self.text[run.clone()])
                .into_iter()
                .map(|(offset, piece)| run.start + offset..run.start + offset + piece.len())
                .find(|range| range.start <= self.cursor && self.cursor < range.end)
                .or_else(|| {
                    split_word_pieces(&self.text[run.clone()])
                        .into_iter()
                        .last()
                        .map(|(offset, piece)| run.start + offset..run.start + offset + piece.len())
                })?
        };
        Some(match scope {
            VimTextObjectScope::Inner => inner,
            VimTextObjectScope::Around => {
                let following = self.following_whitespace_end(inner.end);
                if following > inner.end {
                    inner.start..following
                } else {
                    self.preceding_whitespace_start(inner.start)..inner.end
                }
            }
        })
    }

    fn following_whitespace_end(&self, start: usize) -> usize {
        let mut end = start;
        for (offset, ch) in self.text[start..].char_indices() {
            if !ch.is_whitespace() {
                break;
            }
            end = start + offset + ch.len_utf8();
        }
        end
    }

    fn preceding_whitespace_start(&self, end: usize) -> usize {
        let mut start = end;
        for (idx, ch) in self.text[..end].char_indices().rev() {
            if !ch.is_whitespace() {
                break;
            }
            start = idx;
        }
        start
    }

    fn paired_text_object_range(
        &self,
        scope: VimTextObjectScope,
        open: char,
        close: char,
    ) -> Option<Range<usize>> {
        let mut stack = Vec::new();
        let mut best = None;
        for (idx, ch) in self.text.char_indices() {
            if ch == open {
                stack.push(idx);
            } else if ch == close {
                let Some(open_idx) = stack.pop() else {
                    continue;
                };
                if open_idx <= self.cursor && self.cursor <= idx {
                    let candidate = match scope {
                        VimTextObjectScope::Inner => open_idx + open.len_utf8()..idx,
                        VimTextObjectScope::Around => open_idx..idx + close.len_utf8(),
                    };
                    if best
                        .as_ref()
                        .is_none_or(|current: &Range<usize>| candidate.len() < current.len())
                    {
                        best = Some(candidate);
                    }
                }
            }
        }
        best
    }

    fn quoted_text_object_range(
        &self,
        scope: VimTextObjectScope,
        quote: char,
    ) -> Option<Range<usize>> {
        let line_start = self.line_start();
        let line_end = self.line_end();
        let mut open = None;
        let mut best = None;
        for (offset, ch) in self.text[line_start..line_end].char_indices() {
            let idx = line_start + offset;
            if ch != quote || self.is_escaped(idx) {
                continue;
            }
            if let Some(open_idx) = open.take() {
                if open_idx <= self.cursor && self.cursor <= idx {
                    let candidate = match scope {
                        VimTextObjectScope::Inner => open_idx + quote.len_utf8()..idx,
                        VimTextObjectScope::Around => open_idx..idx + quote.len_utf8(),
                    };
                    if best
                        .as_ref()
                        .is_none_or(|current: &Range<usize>| candidate.len() < current.len())
                    {
                        best = Some(candidate);
                    }
                }
            } else {
                open = Some(idx);
            }
        }
        best
    }

    fn is_escaped(&self, pos: usize) -> bool {
        let mut backslashes = 0;
        for ch in self.text[..pos].chars().rev() {
            if ch != '\\' {
                break;
            }
            backslashes += 1;
        }
        backslashes % 2 == 1
    }

    pub(super) fn leave_vim_insert_mode(&mut self) {
        if self.cursor > self.line_start() {
            self.cursor = self.previous_grapheme_start();
        }
        self.enter_vim_normal_mode();
        if !self.vim_commands.replaying {
            self.finish_pending_vim_change();
        }
    }

    pub(super) fn apply_vim_operator(&mut self, operator: VimOperator, motion: VimMotion) {
        if operator == VimOperator::Change && motion == VimMotion::WordForward {
            let target = if self.text[self.cursor..]
                .chars()
                .next()
                .is_some_and(|ch| !ch.is_whitespace())
            {
                self.end_of_next_word()
            } else {
                self.beginning_of_next_word().min(self.line_end())
            };
            if target > self.cursor {
                self.apply_vim_operator_to_range(operator, self.cursor..target);
            } else {
                self.vim_mode = VimMode::Insert;
            }
            return;
        }
        if let Some(range) = self.range_for_motion(motion) {
            if operator == VimOperator::Change && matches!(motion, VimMotion::Up | VimMotion::Down)
            {
                let retain_newline =
                    range.end < self.text.len() && self.text[range.clone()].ends_with('\n');
                let start = range.start;
                self.kill_line_range(range);
                if retain_newline {
                    self.insert_str_at(start, "\n");
                    self.set_cursor(start);
                }
                self.vim_mode = VimMode::Insert;
                return;
            }
            if matches!(motion, VimMotion::Up | VimMotion::Down) {
                self.apply_vim_line_operator(operator, range);
            } else {
                self.apply_vim_operator_to_range(operator, range);
            }
        } else if operator == VimOperator::Change && motion == VimMotion::LineEnd {
            self.vim_mode = VimMode::Insert;
        }
    }

    pub(super) fn apply_vim_operator_to_range(
        &mut self,
        operator: VimOperator,
        range: Range<usize>,
    ) {
        match operator {
            VimOperator::Delete => self.kill_range(range),
            VimOperator::Change => {
                self.kill_range(range);
                self.vim_mode = VimMode::Insert;
            }
            VimOperator::Yank => self.yank_range(range),
        }
    }

    fn range_for_motion(&self, motion: VimMotion) -> Option<Range<usize>> {
        let target = match motion {
            VimMotion::Left => self.previous_grapheme_start(),
            VimMotion::Right => self.next_grapheme_end(),
            VimMotion::WordForward => self.beginning_of_next_word(),
            VimMotion::WordBackward => self.beginning_of_previous_word(),
            VimMotion::WordEnd => self.vim_word_end_exclusive(),
            VimMotion::LineStart => self.line_start(),
            VimMotion::LineEnd => self.line_end(),
            VimMotion::Up | VimMotion::Down => {
                let current = self.line_start()..self.line_end();
                return if motion == VimMotion::Up {
                    (current.start > 0).then(|| {
                        let previous_end = current.start - 1;
                        let previous_start = self.text[..previous_end]
                            .rfind('\n')
                            .map_or(0, |index| index + 1);
                        previous_start..(current.end + usize::from(current.end < self.text.len()))
                    })
                } else {
                    (current.end < self.text.len()).then(|| {
                        let next_start = current.end + 1;
                        let next_end = self.text[next_start..]
                            .find('\n')
                            .map_or(self.text.len(), |offset| next_start + offset + 1);
                        current.start..next_end
                    })
                };
            }
        };
        let start = self.cursor.min(target);
        let end = self.cursor.max(target);
        (start < end).then_some(start..end)
    }

    pub(super) fn first_non_blank_of_current_line(&self) -> usize {
        self.text[self.line_start()..self.line_end()]
            .char_indices()
            .find(|(_, ch)| !ch.is_whitespace())
            .map_or(self.line_start(), |(offset, _)| self.line_start() + offset)
    }

    pub(super) fn current_line_range_with_newline(&self) -> std::ops::Range<usize> {
        let start = self.line_start();
        let end = self.line_end();
        if end < self.text.len() {
            start..end + 1
        } else {
            start..end
        }
    }

    pub(super) fn delete_to_line_end(&mut self, enter_insert: bool) {
        let end = self.line_end();
        if self.cursor < end {
            self.kill_range(self.cursor..end);
        }
        if enter_insert {
            self.vim_mode = VimMode::Insert;
        }
    }
}

fn plain_char(event: KeyEvent) -> Option<String> {
    if !matches!(event.kind, KeyEventKind::Press | KeyEventKind::Repeat)
        || event
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
    {
        return None;
    }
    match event.code {
        KeyCode::Char(ch) if !ch.is_ascii_control() => Some(ch.to_string()),
        _ => None,
    }
}
