//! Assert painted rows, including padding and continuation, not only requested styles.

use super::*;
use crate::style::text_contrast_ratio;
use crate::terminal_hyperlinks::{plain_hyperlink_lines, HyperlinkParagraph};
use crate::terminal_palette::{
    color_rgb, indexed_color, rgb_color, DefaultColors, StdoutColorLevel,
};
use ratatui::backend::TestBackend;
use ratatui::style::Modifier;
use ratatui::widgets::Paragraph;
use ratatui::Terminal;

fn colors(light: bool) -> DefaultColors {
    if light {
        DefaultColors {
            fg: (31, 35, 40),
            bg: (255, 255, 255),
        }
    } else {
        DefaultColors {
            fg: (230, 230, 230),
            bg: (18, 20, 30),
        }
    }
}

#[test]
fn painted_diff_palette_matrix_keeps_full_width_fill_and_distinct_gutters() {
    for (light, level, add, del, add_gutter, del_gutter) in [
        (
            false,
            StdoutColorLevel::TrueColor,
            rgb_color((33, 58, 43)),
            rgb_color((74, 34, 29)),
            rgb_color((33, 58, 43)),
            rgb_color((74, 34, 29)),
        ),
        (
            true,
            StdoutColorLevel::TrueColor,
            rgb_color((218, 251, 225)),
            rgb_color((255, 235, 233)),
            rgb_color((172, 238, 187)),
            rgb_color((255, 206, 203)),
        ),
        (
            false,
            StdoutColorLevel::Ansi256,
            indexed_color(22),
            indexed_color(52),
            indexed_color(22),
            indexed_color(52),
        ),
        (
            true,
            StdoutColorLevel::Ansi256,
            indexed_color(194),
            indexed_color(224),
            indexed_color(157),
            indexed_color(217),
        ),
        (
            false,
            StdoutColorLevel::Ansi16,
            Color::Reset,
            Color::Reset,
            Color::Reset,
            Color::Reset,
        ),
        (
            true,
            StdoutColorLevel::Ansi16,
            Color::Reset,
            Color::Reset,
            Color::Reset,
            Color::Reset,
        ),
        (
            false,
            StdoutColorLevel::Unknown,
            Color::Reset,
            Color::Reset,
            Color::Reset,
            Color::Reset,
        ),
        (
            true,
            StdoutColorLevel::Unknown,
            Color::Reset,
            Color::Reset,
            Color::Reset,
            Color::Reset,
        ),
    ] {
        let style = DiffRenderStyleContext::new(Some(colors(light)), level);
        let lines = render_with_style(
            "@@ -1 +1 @@\n abc\n-0123456789\n+ABCDEFGHIJ\n",
            Some(12),
            Path::new(""),
            style,
        );
        assert_eq!(
            super::tests::plain(&lines),
            [
                "   1  abc",
                "   2 -012345",
                "      6789",
                "   2 +ABCDEF",
                "      GHIJ"
            ]
        );
        let mut terminal = Terminal::new(TestBackend::new(12, 5)).unwrap();
        let lines = plain_hyperlink_lines(lines);
        terminal
            .draw(|frame| frame.render_widget(HyperlinkParagraph::new(&lines), frame.area()))
            .unwrap();
        let buffer = terminal.backend().buffer();
        for (row, fill, gutter, sign) in [
            (1, del, del_gutter, Color::Red),
            (3, add, add_gutter, Color::Green),
        ] {
            for y in [row, row + 1] {
                for x in 0..12 {
                    let expected = if x < 5 || (y == row + 1 && x == 5) {
                        gutter
                    } else {
                        fill
                    };
                    assert_eq!(
                        buffer[(x, y)].bg,
                        expected,
                        "light={light} {level:?} cell=({x},{y})"
                    );
                }
                for x in 6..12 {
                    assert!(
                        !buffer[(x, y)].modifier.contains(Modifier::DIM),
                        "diff content must not be dimmed"
                    );
                }
            }
            assert_eq!(buffer[(5, row)].fg, sign);
            assert_eq!(buffer[(0, row)].modifier.contains(Modifier::DIM), !light);
            if light
                && matches!(
                    level,
                    StdoutColorLevel::TrueColor | StdoutColorLevel::Ansi256
                )
            {
                let content = &buffer[(6, row)];
                assert!(
                    text_contrast_ratio(
                        color_rgb(content.fg).unwrap(),
                        color_rgb(content.bg).unwrap()
                    ) >= 4.5
                );
            }
        }
        for x in 0..12 {
            assert_eq!(
                buffer[(x, 0)].bg,
                Color::Reset,
                "context must keep the terminal background"
            );
        }
    }
}

#[test]
fn syntax_foregrounds_use_actual_quantized_fill_and_clear_inherited_dim() {
    for light in [false, true] {
        for level in [StdoutColorLevel::TrueColor, StdoutColorLevel::Ansi256] {
            for kind in [
                DiffLineKind::Insert,
                DiffLineKind::Delete,
                DiffLineKind::Context,
            ] {
                let samples = colors(light);
                let style = DiffRenderStyleContext::new(Some(samples), level);
                let bg = style
                    .line(kind)
                    .bg
                    .and_then(color_rgb)
                    .unwrap_or(samples.bg);
                for foreground in [
                    rgb_color(bg),
                    indexed_color(140),
                    Color::Reset,
                    Color::Blue,
                    indexed_color(4),
                ] {
                    let lines = render_line(
                        DiffLine {
                            kind,
                            number: Some(1),
                            text: "syntax".into(),
                            syntax: Some(vec![Span::styled(
                                "syntax",
                                Style::default().fg(foreground).dim().italic(),
                            )]),
                        },
                        4,
                        Some(10),
                        style,
                    );
                    let mut terminal = Terminal::new(TestBackend::new(10, 2)).unwrap();
                    terminal
                        .draw(|frame| {
                            frame.render_widget(
                                Paragraph::new(lines).style(Style::default().dim()),
                                frame.area(),
                            )
                        })
                        .unwrap();
                    for (x, y) in [(6, 0), (6, 1)] {
                        let cell = &terminal.backend().buffer()[(x, y)];
                        assert_eq!(cell.modifier, Modifier::ITALIC);
                        if matches!(foreground, Color::Blue | Color::Indexed(4)) {
                            assert_eq!(
                                cell.fg, foreground,
                                "terminal-owned ANSI color must not be guessed"
                            );
                        } else {
                            assert!(
                                text_contrast_ratio(color_rgb(cell.fg).unwrap(), bg) >= 4.5,
                                "{foreground:?} {kind:?} {level:?} light={light}"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn clipped_and_unnumbered_diff_rows_retain_fill_and_colored_signs() {
    let style = DiffRenderStyleContext::new(Some(colors(true)), StdoutColorLevel::TrueColor);
    for input in ["@@ -1 +1 @@\n-界🙂old\n+界🙂new", "-界🙂old\n+界🙂new"] {
        for width in 0..=8 {
            let lines = render_with_style(input, Some(width), Path::new(""), style);
            for line in &lines {
                assert!(crate::line_truncation::line_width(line) <= width);
                assert!(line.style.bg.is_some());
            }
        }
    }
    let lines = render_with_style("+plain", Some(8), Path::new(""), style);
    assert_eq!(
        lines[0].spans[0],
        Span::styled("+", Style::default().fg(Color::Green))
    );
    assert!(color_rgb(lines[0].spans[1].style.fg.unwrap()).is_some());
}

#[test]
fn canonical_patch_surface_keeps_fill_after_prefix_wrap_and_scroll() {
    let entry = crate::projection::TranscriptEntry {
        id: "patch-1".into(),
        kind: crate::projection::EntryKind::Patch,
        text: "updated demo.txt\n@@ -1 +1 @@\n-0123456789\n+ABCDEFGHIJ".into(),
        streaming: false,
        status: None,
        summary: Vec::new(),
        activity_group: None,
        activity_detail: None,
    };
    crate::terminal_palette::with_test_default_colors(
        crate::terminal_probe::DefaultColors {
            fg: colors(true).fg,
            bg: colors(true).bg,
        },
        || {
            let lines = crate::entry::hyperlink_lines_with_locale(
                &entry,
                crate::locale::Locale::EnUs,
                Some(14),
                Path::new(""),
            );
            // Long headers can wrap, but pre-wrapped diff bodies must not gain another row
            // when the transcript prefix is attached. Keep logical source text unpadded.
            assert!(lines.iter().all(|line| line.width() <= 14));
            let body = lines
                .iter()
                .position(|line| {
                    line.line
                        .spans
                        .iter()
                        .any(|span| span.content.contains("012345"))
                })
                .unwrap();
            assert_eq!(
                lines[body]
                    .line
                    .spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>(),
                "     1 -012345"
            );
            let start = crate::terminal_hyperlinks::wrapped_line_starts(&lines, 14)[body + 1];
            let mut terminal = Terminal::new(TestBackend::new(14, 3)).unwrap();
            terminal
                .draw(|frame| {
                    frame.render_widget(
                        HyperlinkParagraph::new(&lines).scroll(start as u16),
                        frame.area(),
                    )
                })
                .unwrap();
            let buffer = terminal.backend().buffer();
            assert_eq!(buffer[(13, 0)].bg, rgb_color((255, 235, 233)));
            assert_eq!(buffer[(13, 1)].bg, rgb_color((218, 251, 225)));
            assert_eq!(buffer[(2, 0)].bg, rgb_color((255, 206, 203)));
            assert_eq!(buffer[(2, 1)].bg, rgb_color((172, 238, 187)));
            assert!(!buffer[(8, 0)].modifier.contains(Modifier::DIM));
        },
    );
}
