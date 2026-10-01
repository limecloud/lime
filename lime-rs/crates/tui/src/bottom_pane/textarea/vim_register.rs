//! The single kill register preserves characterwise versus linewise Vim semantics.

use super::{Range, TextArea};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum KillBufferKind {
    #[default]
    Characterwise,
    Linewise,
}

#[cfg(test)]
#[path = "vim_register_tests.rs"]
mod tests;

/// The session register moves between editors, independently of thread draft snapshots.
pub(crate) struct KillBufferSnapshot {
    text: String,
    kind: KillBufferKind,
}

impl TextArea {
    pub(crate) fn take_kill_buffer_snapshot(&mut self) -> KillBufferSnapshot {
        KillBufferSnapshot {
            text: std::mem::take(&mut self.kill_buffer),
            kind: self.kill_buffer_kind,
        }
    }

    pub(crate) fn restore_kill_buffer_snapshot(&mut self, snapshot: KillBufferSnapshot) {
        self.kill_buffer = snapshot.text;
        self.kill_buffer_kind = snapshot.kind;
    }

    pub(super) fn store_kill_buffer(&mut self, text: String, kind: KillBufferKind) {
        self.kill_buffer = text;
        self.kill_buffer_kind = kind;
    }

    pub(super) fn yank_range(&mut self, range: Range<usize>) {
        self.yank_range_with_kind(range, KillBufferKind::Characterwise);
    }

    pub(super) fn yank_line_range(&mut self, range: Range<usize>) {
        self.yank_range_with_kind(range, KillBufferKind::Linewise);
    }

    fn yank_range_with_kind(&mut self, range: Range<usize>, kind: KillBufferKind) {
        let range = self.atomic_edit_range(range);
        if range.start < range.end {
            self.store_kill_buffer(self.text[range].to_owned(), kind);
        }
    }

    pub(super) fn kill_line_range(&mut self, range: Range<usize>) {
        let range = self.atomic_edit_range(range);
        if range.start < range.end {
            self.store_kill_buffer(
                self.text[range.clone()].to_owned(),
                KillBufferKind::Linewise,
            );
            self.replace_range(range, "");
        }
    }

    pub(super) fn yank_current_line(&mut self) {
        self.yank_line_range(self.current_line_range_with_newline());
    }

    pub(super) fn paste_after_cursor(&mut self) {
        if self.kill_buffer.is_empty() {
            return;
        }
        if self.kill_buffer_kind == KillBufferKind::Linewise {
            self.paste_line_after_current_line();
        } else {
            let at = self.next_grapheme_end();
            self.insert_str_at(at, &self.kill_buffer.clone());
            self.set_cursor(at + self.kill_buffer.len());
        }
    }

    fn paste_line_after_current_line(&mut self) {
        let eol = self.line_end();
        let insert_at = if eol < self.text.len() { eol + 1 } else { eol };
        let cursor = if eol < self.text.len() {
            insert_at
        } else {
            insert_at + 1
        };
        let text = if eol < self.text.len() {
            if self.kill_buffer.ends_with('\n') {
                self.kill_buffer.clone()
            } else {
                format!("{}\n", self.kill_buffer)
            }
        } else {
            format!("\n{}", self.kill_buffer.trim_end_matches('\n'))
        };
        self.insert_str_at(insert_at, &text);
        self.set_cursor(cursor.min(self.text.len()));
    }

    pub(super) fn apply_vim_line_operator(
        &mut self,
        operator: super::vim::VimOperator,
        range: Range<usize>,
    ) {
        use super::vim::{VimMode, VimOperator};
        match operator {
            VimOperator::Delete => self.kill_line_range(range),
            VimOperator::Yank => self.yank_line_range(range),
            VimOperator::Change => {
                self.kill_line_range(range);
                self.vim_mode = VimMode::Insert;
            }
        }
    }
}
