//! Full row surfaces keep the same wrap/scroll and hyperlink geometry as the text.

use super::*;
use crate::terminal_hyperlinks::TerminalHyperlink;
use crate::terminal_palette::rgb_color;
use ratatui::text::{Line, Span};

#[test]
fn wrapped_surfaces_paint_only_visible_rows_and_keep_gutters_links_and_source_text() {
    let fill = rgb_color((33, 58, 43));
    let gutter = rgb_color((172, 238, 187));
    let text = "ab cdefg";
    let lines = [
        HyperlinkLine::from("plain"),
        HyperlinkLine {
            line: Line::from(vec![
                Span::styled("ab", Style::default().bg(gutter)),
                Span::raw(" cdefg"),
            ])
            .style(Style::default().bg(fill)),
            hyperlinks: vec![TerminalHyperlink::web(
                3..8,
                "https://example.test/path".into(),
            )],
        },
        HyperlinkLine::from("plain tail"),
    ];
    let original = lines.clone();
    for scroll in 0..5 {
        let area = Rect::new(2, 3, 6, 3);
        let mut actual = Buffer::empty(Rect::new(0, 0, 10, 8));
        HyperlinkParagraph::new(&lines)
            .scroll(scroll)
            .render(area, &mut actual);
        let mut expected = Buffer::empty(actual.area);
        Paragraph::new(Text::from(visible_lines_ref(&lines)))
            .wrap(Wrap { trim: false })
            .scroll((scroll, 0))
            .render(area, &mut expected);
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                assert_eq!(
                    crate::terminal_hyperlinks::strip_osc8(actual[(x, y)].symbol()),
                    expected[(x, y)].symbol(),
                    "text scroll={scroll} cell=({x},{y})"
                );
            }
            let logical_row = y - area.y + scroll;
            let on_surface = (1..3).contains(&logical_row);
            assert_eq!(
                actual[(area.right() - 1, y)].bg,
                if on_surface {
                    fill
                } else {
                    ratatui::style::Color::Reset
                }
            );
        }
        assert_eq!(actual[(0, 0)].bg, ratatui::style::Color::Reset);
    }
    assert_eq!(
        lines, original,
        "padding must not mutate copyable source or link ranges"
    );
    assert_eq!(
        lines[1]
            .line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>(),
        text
    );
    let mut buffer = Buffer::empty(Rect::new(0, 0, 6, 3));
    HyperlinkParagraph::new(&lines).render(buffer.area, &mut buffer);
    assert_eq!(buffer[(0, 1)].bg, gutter);
    assert!(buffer[(0, 2)]
        .symbol()
        .contains("\x1b]8;;https://example.test/path\x07"));
    assert!(buffer[(4, 2)]
        .symbol()
        .contains("\x1b]8;;https://example.test/path\x07"));
    assert!(
        !buffer[(5, 2)].symbol().contains("\x1b]8;;"),
        "surface padding must not extend link targets"
    );
}

#[test]
fn empty_surface_and_zero_area_do_not_leak_fill_into_following_lines() {
    let fill = rgb_color((255, 235, 233));
    let lines = [
        HyperlinkLine::new(Line::default().style(Style::default().bg(fill))),
        HyperlinkLine::from("context"),
    ];
    let area = Rect::new(0, 0, 8, 3);
    let mut buffer = Buffer::empty(area);
    HyperlinkParagraph::new(&lines).render(area, &mut buffer);
    assert_eq!(buffer[(7, 0)].bg, fill);
    assert_eq!(buffer[(7, 1)].bg, ratatui::style::Color::Reset);
    assert_eq!(buffer[(7, 2)].bg, ratatui::style::Color::Reset);
    let original = buffer.clone();
    for empty in [Rect::new(0, 0, 0, 3), Rect::new(0, 0, 8, 0)] {
        HyperlinkParagraph::new(&lines).render(empty, &mut buffer);
        assert_eq!(buffer, original);
    }
}
