//! Reuse the VT parser for an append-only PTY trace without dropping any terminal bytes.

use std::cell::RefCell;

struct TerminalObserver {
    trace: String,
    parser: vt100::Parser,
}

impl Default for TerminalObserver {
    fn default() -> Self {
        Self {
            trace: String::new(),
            parser: vt100::Parser::new(24, 100, 0),
        }
    }
}

impl TerminalObserver {
    fn observe(&mut self, output: &str) -> &vt100::Screen {
        // A different fixture or a truncated trace starts a fresh terminal lifetime.
        if !output.starts_with(&self.trace) {
            *self = Self::default();
        }
        let appended = &output[self.trace.len()..];
        self.parser.process(appended.as_bytes());
        self.trace.push_str(appended);
        self.parser.screen()
    }
}

thread_local! {
    static TERMINAL: RefCell<TerminalObserver> = RefCell::new(TerminalObserver::default());
}

pub(super) fn with_screen<T>(output: &str, inspect: impl FnOnce(&vt100::Screen) -> T) -> T {
    TERMINAL.with(|terminal| inspect(terminal.borrow_mut().observe(output)))
}

pub(super) fn resize(output: &str, rows: u16, columns: u16) {
    TERMINAL.with(|terminal| {
        let mut terminal = terminal.borrow_mut();
        terminal.observe(output);
        terminal.parser.screen_mut().set_size(rows, columns);
    });
}

pub(super) fn terminal_screen_text(output: &str) -> String {
    with_screen(output, vt100::Screen::contents)
}

pub(super) fn terminal_cursor_position(output: &str) -> (u16, u16) {
    with_screen(output, vt100::Screen::cursor_position)
}

pub(super) fn terminal_marker_position(output: &str, marker: &str) -> Option<(u16, u16)> {
    with_screen(output, |screen| {
        screen.rows(0, 100).enumerate().find_map(|(row, text)| {
            let offset = text.find(marker)?;
            let column = crate::width::display_width(&text[..offset]);
            Some((u16::try_from(row).ok()?, u16::try_from(column).ok()?))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_fresh_projection(observer: &mut TerminalObserver, trace: &str) {
        let mut fresh = vt100::Parser::new(24, 100, 0);
        fresh.process(trace.as_bytes());
        let actual = observer.observe(trace);
        let expected = fresh.screen();
        assert_eq!(actual.contents(), expected.contents());
        assert_eq!(actual.cursor_position(), expected.cursor_position());
        assert_eq!(actual.alternate_screen(), expected.alternate_screen());
        for row in 0..24 {
            for column in 0..100 {
                assert_eq!(actual.cell(row, column), expected.cell(row, column));
            }
        }
    }

    #[test]
    fn every_unicode_and_escape_boundary_matches_a_fresh_terminal() {
        let trace = "\x1b[?1049h\x1b[2J\x1b[H› 界🙂\r\n\x1b[7mselected\x1b[0m\x1b[2;4H!\x1b]0;标题\x07\x1b[?1049l";
        let mut observer = TerminalObserver::default();
        for end in trace
            .char_indices()
            .map(|(index, _)| index)
            .chain([trace.len()])
        {
            assert_fresh_projection(&mut observer, &trace[..end]);
            assert_fresh_projection(&mut observer, &trace[..end]);
        }
    }

    #[test]
    fn replaced_prefix_and_rewound_trace_start_fresh_lifetimes() {
        let mut observer = TerminalObserver::default();
        for trace in [
            "\x1b[3;4Hfirst",
            "\x1b[2;8Hother",
            "\x1b[2;8H",
            "",
            "second",
        ] {
            assert_fresh_projection(&mut observer, trace);
        }
    }

    #[test]
    fn resize_and_unicode_repaint_match_a_terminal_with_the_real_pty_geometry() {
        let mut observer = TerminalObserver::default();
        let mut reference = vt100::Parser::new(24, 100, 0);
        let mut trace = String::new();
        for (rows, columns, update) in [
            (24, 100, "\x1b[Hwide 界🙂"),
            (24, 24, "\x1b[2J\x1b[Hnarrow 界🙂\r\ntail"),
            (8, 10, "\x1b[2J\x1b[Htiny\r\n界🙂"),
            (24, 100, "\x1b[2J\x1b[Hrestored 界🙂"),
        ] {
            observer.parser.screen_mut().set_size(rows, columns);
            reference.screen_mut().set_size(rows, columns);
            trace.push_str(update);
            reference.process(update.as_bytes());
            let actual = observer.observe(&trace);
            assert_eq!(actual.size(), reference.screen().size());
            assert_eq!(actual.contents(), reference.screen().contents());
            assert_eq!(
                actual.cursor_position(),
                reference.screen().cursor_position()
            );
        }
    }
}
