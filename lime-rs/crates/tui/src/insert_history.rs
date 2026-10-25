//! Inserts finalized history rows into terminal scrollback.
//!
//! Codex uses the terminal scrollback itself for finalized chat history, so inserting a history
//! cell is an escape-sequence operation rather than a normal ratatui render.

use std::fmt;
use std::io;
use std::io::Write;

use crate::render::line_utils::line_to_static;
use crate::terminal_hyperlinks::decorate_spans;
use crate::terminal_hyperlinks::plain_hyperlink_lines;
use crate::terminal_hyperlinks::remap_source_wrapped_line;
use crate::terminal_hyperlinks::HyperlinkLine;
use crate::wrapping::adaptive_wrap_line_with_source;
use crate::wrapping::line_contains_url_like;
use crate::wrapping::line_has_mixed_url_and_non_url_tokens;
use crate::wrapping::RtOptions;
use crossterm::cursor::MoveDown;
use crossterm::cursor::MoveTo;
use crossterm::cursor::MoveToColumn;
use crossterm::cursor::RestorePosition;
use crossterm::cursor::SavePosition;
use crossterm::queue;
use crossterm::style::Color as CColor;
use crossterm::style::Colors;
use crossterm::style::Print;
use crossterm::style::SetAttribute;
use crossterm::style::SetBackgroundColor;
use crossterm::style::SetColors;
use crossterm::style::SetForegroundColor;
use crossterm::terminal::Clear;
use crossterm::terminal::ClearType;
use crossterm::Command;
use ratatui::backend::IntoCrossterm;
use ratatui::layout::{Position, Rect, Size};
use ratatui::style::Color;
use ratatui::style::Modifier;
use ratatui::text::Line;
use ratatui::text::Span;

/// Terminal capabilities required by history insertion.
///
/// The owner is deliberately independent from a concrete terminal implementation so Lime can
/// keep its existing ratatui host while sharing Codex's scrollback algorithm with PTY fixtures.
/// Terminal capabilities required by history insertion.
///
/// This is public so the Lime-native integration suite can exercise the same
/// scrollback algorithm with a VT100-backed terminal without depending on the
/// concrete interactive terminal owner.
pub trait HistoryTerminal {
    fn screen_size(&self) -> Size;
    fn viewport_area(&self) -> Rect;
    fn last_known_cursor_position(&mut self) -> Position;
    fn clear_after_position(&mut self, position: Position) -> io::Result<()>;
    fn write_ansi(&mut self, bytes: &[u8]) -> io::Result<()>;
    fn set_viewport_area(&mut self, area: Rect);
    fn note_history_rows_inserted(&mut self, rows: u16);
}

impl HistoryTerminal for crate::tui::Tui {
    fn screen_size(&self) -> Size {
        self.screen_size()
    }

    fn viewport_area(&self) -> Rect {
        self.viewport_area()
    }

    fn last_known_cursor_position(&mut self) -> Position {
        self.last_known_cursor_position()
    }

    fn clear_after_position(&mut self, position: Position) -> io::Result<()> {
        let mut output = Vec::new();
        queue!(
            output,
            MoveTo(position.x, position.y),
            Clear(ClearType::FromCursorDown)
        )?;
        self.write_ansi(&output)
    }

    fn write_ansi(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.write_ansi(bytes)
    }

    fn set_viewport_area(&mut self, area: Rect) {
        self.set_viewport_area(area);
    }

    fn note_history_rows_inserted(&mut self, rows: u16) {
        self.note_history_rows_inserted(rows);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryLineWrapPolicy {
    PreWrap,
    Terminal,
}

/// Selects the terminal escape strategy used when writing history above the viewport.
///
/// Full-screen insertion preserves terminal-native scrollback when partial scroll regions are
/// unreliable and keeps terminal-managed soft wrapping intact for Zellij.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InsertHistoryMode {
    Standard,
    FullScreen,
}

/// Insert `lines` above the viewport using the terminal's backend writer
/// (avoids direct stdout references).
pub fn insert_history_lines<T: HistoryTerminal>(
    terminal: &mut T,
    lines: Vec<Line>,
) -> io::Result<()> {
    insert_history_lines_with_wrap_policy(terminal, lines, HistoryLineWrapPolicy::PreWrap)
}

pub(crate) fn insert_history_lines_with_wrap_policy<T: HistoryTerminal>(
    terminal: &mut T,
    lines: Vec<Line>,
    wrap_policy: HistoryLineWrapPolicy,
) -> io::Result<()> {
    insert_history_lines_with_mode_and_wrap_policy(
        terminal,
        lines,
        InsertHistoryMode::Standard,
        wrap_policy,
    )
}

pub(crate) fn insert_history_lines_with_mode_and_wrap_policy<T: HistoryTerminal>(
    terminal: &mut T,
    lines: Vec<Line>,
    mode: InsertHistoryMode,
    wrap_policy: HistoryLineWrapPolicy,
) -> io::Result<()> {
    let screen_size = terminal.screen_size();
    insert_history_hyperlink_lines_with_mode_and_wrap_policy(
        terminal,
        &plain_hyperlink_lines(lines.iter().map(line_to_static).collect()),
        mode,
        wrap_policy,
        screen_size,
    )
}

pub(crate) fn insert_history_hyperlink_lines_with_mode_and_wrap_policy<T: HistoryTerminal>(
    terminal: &mut T,
    lines: &[HyperlinkLine],
    mode: InsertHistoryMode,
    wrap_policy: HistoryLineWrapPolicy,
    screen_size: Size,
) -> io::Result<()> {
    let mut area = terminal.viewport_area();
    let mut should_update_area = false;
    let last_cursor_pos = terminal.last_known_cursor_position();

    // Pre-wrap lines for terminal scrollback. Three paths:
    //
    // - URL-only-ish lines are kept intact (no hard newlines inserted) so that
    //   terminal emulators can match them as clickable links. The
    //   terminal will character-wrap these lines at the viewport
    //   boundary.
    // - Mixed lines (URL + non-URL prose) are adaptively wrapped so
    //   non-URL text still wraps naturally while URL tokens remain
    //   unsplit.
    // - Non-URL lines also flow through adaptive wrapping; behavior is
    //   equivalent to standard wrapping when no URL is present.
    let wrap_width = area.width.max(1) as usize;
    let (wrapped, wrapped_rows) = wrap_history_hyperlink_lines(lines, wrap_width, wrap_policy);
    let wrapped_lines = wrapped_rows as u16;
    let mut output = Vec::new();
    match mode {
        InsertHistoryMode::FullScreen => {
            // The existing viewport is immediately replaced in the same draw pass. Clear it
            // before terminal scrolling can move composer contents into scrollback.
            terminal.clear_after_position(area.as_position())?;
            queue!(output, MoveTo(/*x*/ 0, area.top()))?;
            for (index, line) in wrapped.iter().enumerate() {
                if index > 0 {
                    queue!(output, Print("\r\n"))?;
                }
                write_history_line(&mut output, line, wrap_width)?;
            }

            // Writing raw source text through the terminal preserves its soft-wrap metadata.
            // Advance through empty rows for the viewport so history ends immediately above the
            // composer even when a replay batch is taller than the visible history region.
            for _ in 0..area.height {
                queue!(output, Print("\r\n"), Clear(ClearType::UntilNewLine))?;
            }
            queue!(output, MoveTo(last_cursor_pos.x, last_cursor_pos.y))?;

            let viewport_top = area
                .top()
                .saturating_add(wrapped_lines)
                .min(screen_size.height.saturating_sub(area.height));
            if area.y != viewport_top {
                area.y = viewport_top;
                should_update_area = true;
            }
        }
        InsertHistoryMode::Standard => {
            let cursor_top = if area.bottom() < screen_size.height {
                // If the viewport is not at the bottom of the screen, scroll it down to make room.
                // Don't scroll it past the bottom of the screen.
                let scroll_amount = wrapped_lines.min(screen_size.height - area.bottom());

                let top_1based = area.top() + 1;
                queue!(output, SetScrollRegion(top_1based..screen_size.height))?;
                queue!(output, MoveTo(/*x*/ 0, area.top()))?;
                for _ in 0..scroll_amount {
                    queue!(output, Print("\x1bM"))?;
                }
                queue!(output, ResetScrollRegion)?;

                let cursor_top = area.top().saturating_sub(1);
                area.y += scroll_amount;
                should_update_area = true;
                cursor_top
            } else {
                area.top().saturating_sub(1)
            };

            // Limit the scroll region to the lines from the top of the screen to the
            // top of the viewport. With this in place, when we add lines inside this
            // area, only the lines in this area will be scrolled. We place the cursor
            // at the end of the scroll region, and add lines starting there.
            //
            // ┌─Screen───────────────────────┐
            // │┌╌Scroll region╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐│
            // │┆                            ┆│
            // │┆                            ┆│
            // │┆                            ┆│
            // │█╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘│
            // │╭─Viewport───────────────────╮│
            // ││                            ││
            // │╰────────────────────────────╯│
            // └──────────────────────────────┘
            queue!(output, SetScrollRegion(1..area.top()))?;

            // NB: we are using MoveTo instead of set_cursor_position here to avoid messing with the
            // terminal's last_known_cursor_position, which hopefully will still be accurate after we
            // fetch/restore the cursor position. insert_history_lines should be cursor-position-neutral :)
            queue!(output, MoveTo(/*x*/ 0, cursor_top))?;

            for line in &wrapped {
                queue!(output, Print("\r\n"))?;
                write_history_line(&mut output, line, wrap_width)?;
            }

            queue!(output, ResetScrollRegion)?;
            queue!(output, MoveTo(last_cursor_pos.x, last_cursor_pos.y))?;
        }
    }

    terminal.write_ansi(&output)?;

    if should_update_area {
        terminal.set_viewport_area(area);
    }
    if wrapped_lines > 0 {
        terminal.note_history_rows_inserted(wrapped_lines);
    }

    Ok(())
}

pub(crate) fn wrap_history_hyperlink_lines(
    lines: &[HyperlinkLine],
    wrap_width: usize,
    wrap_policy: HistoryLineWrapPolicy,
) -> (Vec<HyperlinkLine>, usize) {
    let mut wrapped = Vec::new();
    let mut wrapped_rows = 0usize;

    for line in lines {
        let line_wrapped = match wrap_policy {
            HistoryLineWrapPolicy::Terminal => vec![line.clone()],
            HistoryLineWrapPolicy::PreWrap
                if line_contains_url_like(&line.line)
                    && !line_has_mixed_url_and_non_url_tokens(&line.line) =>
            {
                vec![line.clone()]
            }
            HistoryLineWrapPolicy::PreWrap => remap_source_wrapped_line(
                line,
                adaptive_wrap_line_with_source(
                    &line.line,
                    RtOptions::new(wrap_width)
                        .subsequent_indent(leading_whitespace_prefix(&line.line)),
                ),
            ),
        };
        wrapped_rows += line_wrapped
            .iter()
            .map(|wrapped_line| wrapped_line.width().max(/*other*/ 1).div_ceil(wrap_width))
            .sum::<usize>();
        wrapped.extend(line_wrapped);
    }

    (wrapped, wrapped_rows)
}

pub(crate) fn leading_whitespace_prefix(line: &Line<'_>) -> Line<'static> {
    let mut spans = Vec::new();
    for span in &line.spans {
        let prefix_end = span
            .content
            .char_indices()
            .find_map(|(idx, ch)| (!ch.is_whitespace()).then_some(idx))
            .unwrap_or(span.content.len());
        if prefix_end > 0 {
            spans.push(Span::styled(
                span.content[..prefix_end].to_string(),
                span.style,
            ));
        }
        if prefix_end < span.content.len() {
            break;
        }
    }
    Line::from(spans).style(line.style)
}

/// Render a single wrapped history line: clear continuation rows for wide lines,
/// set foreground/background colors, and write styled spans. Caller is responsible
/// for cursor positioning and any leading `\r\n`.
fn write_history_line<W: Write>(
    writer: &mut W,
    line: &HyperlinkLine,
    wrap_width: usize,
) -> io::Result<()> {
    let physical_rows = line.width().max(1).div_ceil(wrap_width) as u16;
    if physical_rows > 1 {
        queue!(writer, SavePosition)?;
        for _ in 1..physical_rows {
            queue!(writer, MoveDown(1), MoveToColumn(0))?;
            queue!(writer, Clear(ClearType::UntilNewLine))?;
        }
        queue!(writer, RestorePosition)?;
    }
    queue!(
        writer,
        SetColors(Colors::new(
            line.line
                .style
                .fg
                .map(IntoCrossterm::into_crossterm)
                .unwrap_or(CColor::Reset),
            line.line
                .style
                .bg
                .map(IntoCrossterm::into_crossterm)
                .unwrap_or(CColor::Reset)
        ))
    )?;
    queue!(writer, Clear(ClearType::UntilNewLine))?;
    // Merge line-level style into each span so that ANSI colors reflect
    // line styles (e.g., blockquotes with green fg).
    let merged_spans: Vec<Span> = line
        .line
        .spans
        .iter()
        .map(|s| Span {
            style: s.style.patch(line.line.style),
            content: s.content.clone(),
        })
        .collect();
    let merged_line = HyperlinkLine {
        line: Line::from(merged_spans),
        hyperlinks: line.hyperlinks.clone(),
        source: line.source.clone(),
    };
    let decorated = decorate_spans(&merged_line);
    write_spans(writer, decorated.iter())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetScrollRegion(pub std::ops::Range<u16>);

impl Command for SetScrollRegion {
    fn write_ansi(&self, f: &mut impl fmt::Write) -> fmt::Result {
        write!(f, "\x1b[{};{}r", self.0.start, self.0.end)
    }

    #[cfg(windows)]
    fn execute_winapi(&self) -> std::io::Result<()> {
        panic!("tried to execute SetScrollRegion command using WinAPI, use ANSI instead");
    }

    #[cfg(windows)]
    fn is_ansi_code_supported(&self) -> bool {
        // TODO(nornagon): is this supported on Windows?
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResetScrollRegion;

impl Command for ResetScrollRegion {
    fn write_ansi(&self, f: &mut impl fmt::Write) -> fmt::Result {
        write!(f, "\x1b[r")
    }

    #[cfg(windows)]
    fn execute_winapi(&self) -> std::io::Result<()> {
        panic!("tried to execute ResetScrollRegion command using WinAPI, use ANSI instead");
    }

    #[cfg(windows)]
    fn is_ansi_code_supported(&self) -> bool {
        // TODO(nornagon): is this supported on Windows?
        true
    }
}

struct ModifierDiff {
    pub from: Modifier,
    pub to: Modifier,
}

impl ModifierDiff {
    fn queue<W>(self, mut w: W) -> io::Result<()>
    where
        W: io::Write,
    {
        use crossterm::style::Attribute as CAttribute;
        let removed = self.from - self.to;
        if removed.contains(Modifier::REVERSED) {
            queue!(w, SetAttribute(CAttribute::NoReverse))?;
        }
        if removed.contains(Modifier::BOLD) {
            queue!(w, SetAttribute(CAttribute::NormalIntensity))?;
            if self.to.contains(Modifier::DIM) {
                queue!(w, SetAttribute(CAttribute::Dim))?;
            }
        }
        if removed.contains(Modifier::ITALIC) {
            queue!(w, SetAttribute(CAttribute::NoItalic))?;
        }
        if removed.contains(Modifier::UNDERLINED) {
            queue!(w, SetAttribute(CAttribute::NoUnderline))?;
        }
        if removed.contains(Modifier::DIM) {
            queue!(w, SetAttribute(CAttribute::NormalIntensity))?;
        }
        if removed.contains(Modifier::CROSSED_OUT) {
            queue!(w, SetAttribute(CAttribute::NotCrossedOut))?;
        }
        if removed.contains(Modifier::SLOW_BLINK) || removed.contains(Modifier::RAPID_BLINK) {
            queue!(w, SetAttribute(CAttribute::NoBlink))?;
        }

        let added = self.to - self.from;
        if added.contains(Modifier::REVERSED) {
            queue!(w, SetAttribute(CAttribute::Reverse))?;
        }
        if added.contains(Modifier::BOLD) {
            queue!(w, SetAttribute(CAttribute::Bold))?;
        }
        if added.contains(Modifier::ITALIC) {
            queue!(w, SetAttribute(CAttribute::Italic))?;
        }
        if added.contains(Modifier::UNDERLINED) {
            queue!(w, SetAttribute(CAttribute::Underlined))?;
        }
        if added.contains(Modifier::DIM) {
            queue!(w, SetAttribute(CAttribute::Dim))?;
        }
        if added.contains(Modifier::CROSSED_OUT) {
            queue!(w, SetAttribute(CAttribute::CrossedOut))?;
        }
        if added.contains(Modifier::SLOW_BLINK) {
            queue!(w, SetAttribute(CAttribute::SlowBlink))?;
        }
        if added.contains(Modifier::RAPID_BLINK) {
            queue!(w, SetAttribute(CAttribute::RapidBlink))?;
        }

        Ok(())
    }
}

fn write_spans<'a, I>(mut writer: &mut impl Write, content: I) -> io::Result<()>
where
    I: IntoIterator<Item = &'a Span<'a>>,
{
    let mut fg = Color::Reset;
    let mut bg = Color::Reset;
    let mut last_modifier = Modifier::empty();
    for span in content {
        let mut modifier = Modifier::empty();
        modifier.insert(span.style.add_modifier);
        modifier.remove(span.style.sub_modifier);
        if modifier != last_modifier {
            let diff = ModifierDiff {
                from: last_modifier,
                to: modifier,
            };
            diff.queue(&mut writer)?;
            last_modifier = modifier;
        }
        let next_fg = span.style.fg.unwrap_or(Color::Reset);
        let next_bg = span.style.bg.unwrap_or(Color::Reset);
        if next_fg != fg || next_bg != bg {
            queue!(
                writer,
                SetColors(Colors::new(
                    next_fg.into_crossterm(),
                    next_bg.into_crossterm()
                ))
            )?;
            fg = next_fg;
            bg = next_bg;
        }

        queue!(writer, Print(&span.content))?;
    }

    queue!(
        writer,
        SetForegroundColor(CColor::Reset),
        SetBackgroundColor(CColor::Reset),
        SetAttribute(crossterm::style::Attribute::Reset),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::cursor::MoveTo;
    use crossterm::terminal::{Clear, ClearType};
    use ratatui::layout::{Position, Rect, Size};
    use std::io::Write;

    struct Vt100HistoryTerminal {
        parser: vt100::Parser,
        screen_size: Size,
        viewport_area: Rect,
        cursor_position: Position,
        history_rows: u16,
    }

    impl Vt100HistoryTerminal {
        fn new(width: u16, height: u16, viewport_area: Rect) -> Self {
            Self {
                parser: vt100::Parser::new(height, width, 0),
                screen_size: Size::new(width, height),
                viewport_area,
                cursor_position: Position::ORIGIN,
                history_rows: 0,
            }
        }

        fn rows(&self) -> Vec<String> {
            self.parser
                .screen()
                .rows(0, self.screen_size.width)
                .collect()
        }
    }

    impl HistoryTerminal for Vt100HistoryTerminal {
        fn screen_size(&self) -> Size {
            self.screen_size
        }

        fn viewport_area(&self) -> Rect {
            self.viewport_area
        }

        fn last_known_cursor_position(&mut self) -> Position {
            self.cursor_position
        }

        fn clear_after_position(&mut self, position: Position) -> io::Result<()> {
            self.cursor_position = position;
            let mut output = Vec::new();
            queue!(
                output,
                MoveTo(position.x, position.y),
                Clear(ClearType::FromCursorDown)
            )?;
            self.write_ansi(&output)
        }

        fn write_ansi(&mut self, bytes: &[u8]) -> io::Result<()> {
            self.parser.write_all(bytes)
        }

        fn set_viewport_area(&mut self, area: Rect) {
            self.viewport_area = area;
        }

        fn note_history_rows_inserted(&mut self, rows: u16) {
            self.history_rows = self.history_rows.saturating_add(rows);
        }
    }

    #[test]
    fn vt100_zellij_raw_insert_keeps_soft_wrapped_tail_above_viewport() {
        let width = 20;
        let height = 8;
        let viewport = Rect::new(0, height - 2, width, 2);
        let mut terminal = Vt100HistoryTerminal::new(width, height, viewport);

        let line = Line::from("raw-start-aaaaaaaaaaaaaaaaaaaaaaaa-tail-must-remain");
        insert_history_lines_with_mode_and_wrap_policy(
            &mut terminal,
            vec![line],
            InsertHistoryMode::FullScreen,
            HistoryLineWrapPolicy::Terminal,
        )
        .expect("insert Zellij raw history");

        let rows = terminal.rows();
        assert_eq!(
            rows.join("\n"),
            "\n\n\nraw-start-aaaaaaaaaa\naaaaaaaaaaaaaa-tail-\nmust-remain\n\n"
        );
        let history_rows = rows[..usize::from(terminal.viewport_area.y)]
            .iter()
            .map(|row| row.trim_end())
            .collect::<String>();
        let viewport_rows = rows[usize::from(terminal.viewport_area.y)..].join("\n");
        assert!(
            history_rows.contains("tail-must-remain"),
            "expected wrapped raw tail above the viewport, rows: {rows:?}"
        );
        assert!(
            !viewport_rows.contains("tail-must-remain"),
            "raw tail must not be written through the viewport, rows: {rows:?}"
        );
    }

    #[test]
    fn vt100_zellij_raw_replay_keeps_overflowing_soft_wrapped_tail_above_viewport() {
        let width = 20;
        let height = 8;
        let viewport = Rect::new(0, 0, width, 2);
        let mut terminal = Vt100HistoryTerminal::new(width, height, viewport);

        let line = Line::from(format!("raw-start-{}tail-must-remain", "a".repeat(130)));
        insert_history_lines_with_mode_and_wrap_policy(
            &mut terminal,
            vec![line],
            InsertHistoryMode::FullScreen,
            HistoryLineWrapPolicy::Terminal,
        )
        .expect("replay Zellij raw history");

        let rows = terminal.rows();
        assert_eq!(
            rows.join("\n"),
            "aaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaa\ntail-must-remain\n\n"
        );
        let history_rows = rows[..usize::from(terminal.viewport_area.y)]
            .iter()
            .map(|row| row.trim_end())
            .collect::<String>();
        let viewport_rows = rows[usize::from(terminal.viewport_area.y)..].join("\n");
        assert!(
            history_rows.contains("tail-must-remain"),
            "expected overflowing raw tail above the viewport, rows: {rows:?}"
        );
        assert!(
            !viewport_rows.contains("tail-must-remain"),
            "overflowing raw tail must not be written through the viewport, rows: {rows:?}"
        );
    }
}
