use super::*;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .flat_map(|row| {
            (0..buffer.area.width)
                .map(move |column| buffer[(column, row)].symbol().to_string())
                .chain(std::iter::once("\n".to_string()))
        })
        .collect()
}

#[test]
fn query_footer_keeps_end_and_caret_visible_on_narrow_widths() {
    let mut search = TranscriptSearch::default();
    search.begin(0, true);
    search.handle_event(
        &Event::Paste("abcdefghijklmno".to_string()),
        /*older_history_available*/ false,
    );
    let footer = TranscriptFooter;
    let mut terminal = Terminal::new(TestBackend::new(12, 2)).expect("terminal");

    terminal
        .draw(|frame| {
            assert!(footer.render_search_query(
                frame,
                Some(Rect::new(0, 0, 12, 1)),
                Locale::EnUs,
                &search,
            ));
        })
        .expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("…lmno▏"), "{text}");
}

#[test]
fn status_prefers_selection_and_all_locales_fit_without_panicking() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut search = TranscriptSearch::default();
        search.begin(0, true);
        search.handle_event(
            &Event::Key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE)),
            false,
        );
        let footer = TranscriptFooter;
        let mut terminal = Terminal::new(TestBackend::new(18, 1)).expect("terminal");
        terminal
            .draw(|frame| {
                assert!(footer.render_status(
                    frame,
                    frame.area(),
                    locale,
                    &search,
                    /*selection_active*/ true,
                ));
            })
            .expect("status draw");
        assert_eq!(terminal.backend().buffer().area.width, 18);
    }
}

#[test]
fn copy_footer_matches_upstream_two_rows_and_shared_key_emphasis() {
    let mut terminal = Terminal::new(TestBackend::new(100, 2)).unwrap();
    terminal
        .draw(|frame| {
            TranscriptFooter.render_copy_mode(
                frame,
                frame.area(),
                Locale::EnUs,
                super::super::CopyTargetKind::WholeResponse,
                None,
            )
        })
        .unwrap();
    let text = buffer_text(&terminal);
    let rows = text.lines().map(str::trim_end).collect::<Vec<_>>();
    assert_eq!(
        rows,
        [
            "Copy whole response",
            "↑/↓/j/k select · g/G ends · enter copy · esc close"
        ]
    );
    let buffer = terminal.backend().buffer();
    assert!(buffer[(0, 0)]
        .modifier
        .contains(ratatui::style::Modifier::BOLD));
    let navigation = navigation_line(Locale::EnUs.transcript_copy_mode_navigation());
    assert_eq!(navigation.spans[0].style, crate::style::key_hint_style());
    assert_eq!(navigation.spans[1].style, crate::style::muted_style());
}

#[test]
fn narrow_copy_footer_keeps_complete_executable_actions_in_every_locale() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [100, 30, 18, 11, 5] {
            for height in [1, 2] {
                let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
                terminal
                    .draw(|frame| {
                        TranscriptFooter.render_copy_mode(
                            frame,
                            frame.area(),
                            locale,
                            super::super::CopyTargetKind::CodeBlock,
                            None,
                        )
                    })
                    .unwrap();
                let text = buffer_text(&terminal);
                let navigation = text.lines().last().unwrap();
                assert!(
                    navigation.contains("esc"),
                    "locale {locale:?}, {width}x{height}: {navigation}"
                );
                if width >= 11 {
                    assert!(navigation.contains("enter"));
                }
                assert!(
                    !navigation.contains('…'),
                    "executable keys cannot be ellipsized"
                );
            }
        }
    }
}

#[test]
fn copy_feedback_uses_the_title_row_and_preserves_navigation() {
    let mut terminal = Terminal::new(TestBackend::new(24, 2)).unwrap();
    terminal
        .draw(|frame| {
            TranscriptFooter.render_copy_mode(
                frame,
                frame.area(),
                Locale::EnUs,
                super::super::CopyTargetKind::CodeBlock,
                Some("Copy unconfirmed; keep selection"),
            )
        })
        .unwrap();
    let text = buffer_text(&terminal);
    let rows = text.lines().collect::<Vec<_>>();
    assert!(rows[0].starts_with("Copy unconfirmed"));
    assert!(rows[1].contains("enter") && rows[1].contains("esc"));
}
