//! Paragraph rendering that keeps visible text and hyperlink annotations aligned.

use super::{mark_buffer_hyperlinks, visible_lines_ref, HyperlinkLine};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::Text;
use ratatui::widgets::{Paragraph, Widget, Wrap};

/// Word-wraps without trimming and applies the same vertical scroll to text and links.
pub(crate) struct HyperlinkParagraph<'a> {
    lines: &'a [HyperlinkLine],
    paragraph: Paragraph<'static>,
    scroll_rows: u16,
}

impl<'a> HyperlinkParagraph<'a> {
    pub(crate) fn new(lines: &'a [HyperlinkLine]) -> Self {
        Self {
            lines,
            paragraph: Paragraph::new(Text::from(visible_lines_ref(lines)))
                .wrap(Wrap { trim: false }),
            scroll_rows: 0,
        }
    }

    pub(crate) fn line_count(&self, width: u16) -> usize {
        self.paragraph.line_count(width)
    }

    pub(crate) fn scroll(mut self, rows: u16) -> Self {
        self.scroll_rows = rows;
        self
    }
}

impl Widget for HyperlinkParagraph<'_> {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        if area.width == 0 || area.height == 0 {
            return;
        }
        // Paragraph applies Line styles only to occupied cells. Paint the row surface first,
        // so padding inherits the fill while span backgrounds (e.g. diff gutters) still win.
        let scroll = usize::from(self.scroll_rows);
        let viewport_end = scroll.saturating_add(usize::from(area.height));
        let mut row = 0usize;
        for line in self.lines {
            if row >= viewport_end {
                break;
            }
            let end = row.saturating_add(
                Self::new(std::slice::from_ref(line))
                    .line_count(area.width)
                    .max(1),
            );
            if let Some(background) = line.line.style.bg {
                let start = row.max(scroll);
                let visible_end = end.min(viewport_end);
                if start < visible_end {
                    buffer.set_style(
                        Rect::new(
                            area.x,
                            area.y + (start - scroll) as u16,
                            area.width,
                            (visible_end - start) as u16,
                        ),
                        Style::default().bg(background),
                    );
                }
            }
            row = end;
        }
        self.paragraph
            .scroll((self.scroll_rows, 0))
            .render(area, buffer);
        mark_buffer_hyperlinks(buffer, area, self.lines, usize::from(self.scroll_rows));
    }
}

#[cfg(test)]
#[path = "paragraph_tests.rs"]
mod tests;
