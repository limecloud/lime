use super::*;
use crate::locale::Locale;
use crate::terminal_probe::DefaultColors;
use ratatui::{backend::TestBackend, Terminal};

fn text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn input_is_a_borderless_filled_band_with_top_bottom_and_right_padding() {
    for colors in [
        DefaultColors {
            fg: (255, 255, 255),
            bg: (0, 0, 0),
        },
        DefaultColors {
            fg: (0, 0, 0),
            bg: (255, 255, 255),
        },
    ] {
        crate::terminal_palette::with_test_default_colors(colors, || {
            let mut composer = ChatComposer::default();
            composer.insert("draft");
            let mut terminal = Terminal::new(TestBackend::new(20, 7)).unwrap();
            let area = Rect::new(1, 2, 18, 3);
            terminal
                .draw(|frame| composer.render(frame, area, Locale::EnUs))
                .unwrap();
            let buffer = terminal.backend().buffer();
            let fill = crate::style::user_message_style()
                .bg
                .expect("known canvas fill");
            for y in area.y..area.bottom() {
                for x in area.x..area.right() {
                    assert_eq!(buffer[(x, y)].bg, fill, "{x}/{y}");
                }
            }
            assert_eq!(buffer[(1, 3)].symbol(), "›");
            assert!(buffer[(1, 3)].modifier.contains(Modifier::BOLD));
            assert_eq!(buffer[(1, 3)].fg, ratatui::style::Color::Reset);
            assert_eq!(buffer[(3, 3)].symbol(), "d");
            assert_eq!(buffer[(18, 3)].symbol(), " ");
            assert_eq!(buffer[(0, 3)].bg, ratatui::style::Color::Reset);
            assert_eq!(buffer[(1, 1)].bg, ratatui::style::Color::Reset);
            assert!(text(&terminal).lines().nth(2).unwrap().trim().is_empty());
            assert!(text(&terminal).lines().nth(4).unwrap().trim().is_empty());
            assert_eq!(terminal.backend().cursor_position(), Position::new(8, 3));
        });
    }
}

#[test]
fn attachments_share_the_text_inset_and_have_a_blank_separator_before_prompt() {
    let mut composer = ChatComposer::default();
    composer.set_remote_image_urls(vec!["https://example.test/image.png".into()]);
    composer.attach_image("/workspace/local.png".into());
    composer.insert("describe");
    let mut terminal = Terminal::new(TestBackend::new(40, 7)).unwrap();
    terminal
        .draw(|frame| composer.render(frame, frame.area(), Locale::EnUs))
        .unwrap();
    let text = text(&terminal);
    let lines = text.lines().collect::<Vec<_>>();
    assert!(lines[1].starts_with("  [Image #1]"), "{text}");
    assert!(lines[2].trim().is_empty(), "{text}");
    assert!(lines[3].starts_with("› [Image #2]describe"), "{text}");
    assert_eq!(
        terminal.backend().buffer()[(2, 3)].fg,
        ratatui::style::Color::Cyan
    );
    assert!(lines[4].trim().is_empty(), "{text}");
    assert!(lines[6].trim().is_empty(), "{text}");
}

#[test]
fn narrow_and_clipped_input_keeps_text_cursor_and_draft_at_the_actual_width() {
    let mut composer = ChatComposer::default();
    composer.insert("界🙂abcdefgh");
    composer.attach_image("/workspace/local.png".into());
    for (width, height) in [(4, 3), (7, 4), (12, 5), (30, 8)] {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal
            .draw(|frame| composer.render(frame, frame.area(), Locale::EnUs))
            .unwrap();
        let cursor = terminal.backend().cursor_position();
        assert!(
            cursor.x >= 2 && cursor.x < width - 1 && cursor.y > 0 && cursor.y < height - 1,
            "{width}/{height}: {cursor:?}"
        );
        assert_eq!(composer.text(), "界🙂abcdefgh[Image #1]");
        assert_eq!(composer.local_image_paths().len(), 1);
    }
}

#[test]
fn localized_placeholder_uses_the_same_prompt_baseline_in_every_product_locale() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let composer = ChatComposer::default();
        let mut terminal = Terminal::new(TestBackend::new(100, 3)).unwrap();
        terminal
            .draw(|frame| composer.render(frame, frame.area(), locale))
            .unwrap();
        let rendered = text(&terminal);
        let compact = |value: &str| {
            value
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>()
        };
        assert!(
            compact(&rendered).contains(&compact(locale.composer_placeholder())),
            "{locale:?}: {rendered}"
        );
        assert!(
            rendered.lines().nth(1).unwrap().starts_with("› "),
            "{rendered}"
        );
        assert_eq!(terminal.backend().cursor_position(), Position::new(2, 1));
    }
}
