//! Managed terminal-title output. Business facts and refresh timing stay in the existing owners.

use crossterm::Command;
use std::fmt;
use std::io::{self, Write};

const MAX_TERMINAL_TITLE_CHARS: usize = 240;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SetTerminalTitleResult {
    Applied,
    NoVisibleContent,
}

#[derive(Default)]
pub(crate) struct ManagedTerminalTitle {
    last_terminal_title: Option<String>,
}

impl ManagedTerminalTitle {
    pub(crate) fn is_managed(&self) -> bool {
        self.last_terminal_title.is_some()
    }

    pub(crate) fn refresh(
        &mut self,
        output: &mut impl Write,
        title: Option<&str>,
    ) -> io::Result<()> {
        let title = title
            .map(sanitize_terminal_title)
            .filter(|title| !title.is_empty());
        if self.last_terminal_title == title {
            return Ok(());
        }
        match title {
            Some(title) => {
                if set_terminal_title(output, &title)? == SetTerminalTitleResult::Applied {
                    self.last_terminal_title = Some(title);
                }
            }
            None => {
                clear_terminal_title(output)?;
                self.last_terminal_title = None;
            }
        }
        Ok(())
    }
}

fn set_terminal_title(output: &mut impl Write, title: &str) -> io::Result<SetTerminalTitleResult> {
    let title = sanitize_terminal_title(title);
    if title.is_empty() {
        return Ok(SetTerminalTitleResult::NoVisibleContent);
    }
    crossterm::execute!(output, SetWindowTitle(&title))?;
    Ok(SetTerminalTitleResult::Applied)
}

/// Clears our managed title; portable terminals cannot restore the preceding shell title.
pub(crate) fn clear_terminal_title(output: &mut impl Write) -> io::Result<()> {
    crossterm::execute!(output, SetWindowTitle(""))
}

struct SetWindowTitle<'a>(&'a str);

impl Command for SetWindowTitle<'_> {
    fn write_ansi(&self, output: &mut impl fmt::Write) -> fmt::Result {
        // Use Codex's OSC 0 + BEL framing, including on Windows terminals.
        write!(output, "\x1b]0;{}\x07", self.0)
    }

    #[cfg(windows)]
    fn execute_winapi(&self) -> io::Result<()> {
        Err(io::Error::other("SetWindowTitle requires ANSI output"))
    }

    #[cfg(windows)]
    fn is_ansi_code_supported(&self) -> bool {
        true
    }
}

pub(crate) fn sanitize_terminal_title(title: &str) -> String {
    let mut sanitized = String::new();
    let mut chars_written = 0;
    let mut pending_space = false;
    for ch in title.chars() {
        if ch.is_whitespace() {
            pending_space = !sanitized.is_empty();
            continue;
        }
        if ch.is_control()
            || matches!(ch,
                '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{180E}'
                | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}' | '\u{FE00}'..='\u{FE0F}'
                | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}'
                | '\u{1BCA0}'..='\u{1BCA3}' | '\u{E0100}'..='\u{E01EF}')
        {
            continue;
        }
        if pending_space && MAX_TERMINAL_TITLE_CHARS - chars_written > 1 {
            sanitized.push(' ');
            chars_written += 1;
            pending_space = false;
        }
        if chars_written >= MAX_TERMINAL_TITLE_CHARS {
            break;
        }
        sanitized.push(ch);
        chars_written += 1;
    }
    sanitized
}

#[cfg(test)]
#[path = "terminal_title_tests.rs"]
mod tests;
