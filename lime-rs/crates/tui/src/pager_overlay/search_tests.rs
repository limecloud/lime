use super::*;
use crate::transcript_view::find_literal_ranges;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::text::Span;
use ratatui::Terminal;

fn key(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
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
fn transcript_bookmark_restores_stable_source_after_replacement_and_reflow() {
    let overlay = PagerOverlay::transcript(Locale::EnUs);
    let mut initial = TranscriptContent::default();
    initial.push_keyed_lines(
        "entry:older",
        vec![
            HyperlinkLine::from("older one"),
            HyperlinkLine::from("older two"),
            HyperlinkLine::from("older three"),
        ],
    );
    initial.push_keyed_lines(
        "entry:target",
        vec![
            HyperlinkLine::from("target first"),
            HyperlinkLine::from("target second"),
            HyperlinkLine::from("target third"),
        ],
    );
    initial.push_keyed_lines(
        "entry:tail",
        (0..6)
            .map(|index| HyperlinkLine::from(format!("tail {index}")))
            .collect(),
    );
    let mut wide = Terminal::new(TestBackend::new(24, 6)).expect("wide terminal");
    wide.draw(|frame| overlay.render_transcript(frame, frame.area(), Locale::EnUs, &initial))
        .expect("initial draw");
    overlay.pinned_to_bottom.set(false);
    overlay.scroll.set(3);
    let bookmark = overlay.bookmark();

    let mut updated = TranscriptContent::default();
    updated.push_keyed_lines(
        "entry:page",
        vec![
            HyperlinkLine::from("page one"),
            HyperlinkLine::from("page two"),
        ],
    );
    updated.push_keyed_lines(
        "entry:older",
        vec![
            HyperlinkLine::from("replacement older one"),
            HyperlinkLine::from("replacement older two"),
            HyperlinkLine::from("replacement older three"),
            HyperlinkLine::from("replacement older four"),
        ],
    );
    updated.push_keyed_lines(
        "entry:target",
        vec![
            HyperlinkLine::from("replacement target first"),
            HyperlinkLine::from("replacement target second"),
        ],
    );
    updated.push_keyed_lines(
        "entry:tail",
        (0..6)
            .map(|index| HyperlinkLine::from(format!("new tail {index}")))
            .collect(),
    );
    let materialized = overlay.disclosure.materialize(&updated, Locale::EnUs, 12);
    let expected = wrapped_line_starts(&materialized.lines, 12)[6];
    overlay.restore_bookmark(bookmark);

    let mut narrow = Terminal::new(TestBackend::new(12, 6)).expect("narrow terminal");
    narrow
        .draw(|frame| overlay.render_transcript(frame, frame.area(), Locale::EnUs, &updated))
        .expect("restored draw");

    assert_eq!(overlay.scroll.get(), expected);
    assert!(!overlay.pinned_to_bottom.get());
    let screen = buffer_text(&narrow);
    assert!(screen.contains("replacement"), "{screen}");
    assert!(screen.contains("target first"), "{screen}");
}

#[test]
fn transcript_search_edits_highlights_and_navigates_matches() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = vec![
        HyperlinkLine::from("Needle in the older entry"),
        HyperlinkLine::from("unrelated line"),
        HyperlinkLine::from("new NEEDLE in the latest entry"),
    ];
    let mut terminal = Terminal::new(TestBackend::new(100, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("initial draw");

    assert_eq!(
        overlay.handle_event(&key(KeyCode::Char('/'))),
        PagerAction::ScheduleFrame
    );
    for character in "needle".chars() {
        overlay.handle_event(&key(KeyCode::Char(character)));
    }
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("search draw");

    assert!(overlay.search.is_active());
    assert_eq!(overlay.search.query(), "needle");
    assert_eq!(overlay.search.match_count(), 2);
    // Find starts at the newest hit, matching Codex's backward history scan.
    assert_eq!(overlay.search.cursor(), 1);
    assert!(buffer_text(&terminal).contains("Find: needle"));
    let buffer = terminal.backend().buffer();
    assert!(buffer
        .content()
        .iter()
        .any(|cell| cell.style().add_modifier.contains(Modifier::REVERSED)));

    overlay.handle_event(&key(KeyCode::Enter));
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("next match draw");
    assert_eq!(overlay.search.cursor(), 1);
    assert!(overlay.search.selected_match().is_some_and(|search_match| {
        search_match.row_start >= overlay.scroll.get()
            && search_match.row_start
                < overlay
                    .scroll
                    .get()
                    .saturating_add(overlay.page_height.get())
    }));

    overlay.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::SHIFT,
    )));
    assert_eq!(overlay.search.cursor(), 0);
    overlay.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::SHIFT,
    )));
    assert_eq!(overlay.search.cursor(), 0);
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("boundary draw");
    assert!(buffer_text(&terminal).contains("No more matches"));
    overlay.handle_event(&key(KeyCode::Esc));
    assert!(!overlay.search.is_active());
    assert!(overlay.search.query().is_empty());
}

#[test]
fn transcript_pager_f3_and_slash_find_while_ctrl_f_pages_down() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = (0..40)
        .map(|index| HyperlinkLine::from(format!("line {index:02}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(80, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("initial draw");
    overlay.pinned_to_bottom.set(false);
    overlay.scroll.set(0);

    assert_eq!(
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('f'),
            KeyModifiers::CONTROL,
        ))),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), overlay.page_height.get());
    assert!(!overlay.search.is_active());

    assert_eq!(
        overlay.handle_event(&key(KeyCode::F(3))),
        PagerAction::ScheduleFrame
    );
    assert!(overlay.search.is_active());
    overlay.handle_event(&key(KeyCode::Esc));
    assert!(!overlay.search.is_active());

    assert_eq!(
        overlay.handle_event(&key(KeyCode::Char('/'))),
        PagerAction::ScheduleFrame
    );
    assert!(overlay.search.is_active());
}

#[test]
fn transcript_pager_footer_uses_the_dispatched_keymap_hints() {
    let overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = vec![HyperlinkLine::from("line")];
    let mut terminal = Terminal::new(TestBackend::new(180, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("pgdn·space·ctrl+f"), "{text}");
    assert!(text.contains("f3·/ find"), "{text}");
    assert!(text.contains("ctrl+t·esc·q close"), "{text}");
}

#[test]
fn transcript_pager_chord_does_not_cross_paste_boundary() {
    let mut config = lime_core::config::TuiKeymap::default();
    config.pager.find = Some(lime_core::config::KeybindingsSpec::One(
        lime_core::config::KeybindingSpec("ctrl-x f".to_string()),
    ));
    let keymap = crate::keymap::RuntimeKeymap::from_config(&config)
        .expect("custom pager chord must be valid");
    let mut overlay =
        PagerOverlay::transcript(Locale::EnUs).with_keymap(keymap.transcript().clone());

    assert_eq!(
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::CONTROL,
        ))),
        PagerAction::Consumed
    );
    assert_eq!(
        overlay.handle_event(&Event::Paste("paste".to_string())),
        PagerAction::Consumed
    );
    assert_eq!(
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('f'),
            KeyModifiers::NONE,
        ))),
        PagerAction::Consumed
    );
    assert!(!overlay.search.is_active());
}

#[test]
fn transcript_search_highlights_only_matching_graphemes_and_keeps_hyperlinks() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let mut line = HyperlinkLine::default();
    line.push_span(
        Span::raw("prefix needle suffix"),
        Some("https://example.com"),
    );
    let lines = vec![line];
    let mut terminal = Terminal::new(TestBackend::new(64, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("initial draw");
    overlay.handle_event(&key(KeyCode::Char('/')));
    for character in "needle".chars() {
        overlay.handle_event(&key(KeyCode::Char(character)));
    }
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("search draw");

    let buffer = terminal.backend().buffer();
    for column in 0..7 {
        assert!(!buffer[(column, 1)]
            .style()
            .add_modifier
            .contains(Modifier::REVERSED));
    }
    for column in 7..13 {
        assert!(buffer[(column, 1)]
            .style()
            .add_modifier
            .contains(Modifier::REVERSED));
    }
    for column in 13..20 {
        assert!(!buffer[(column, 1)]
            .style()
            .add_modifier
            .contains(Modifier::REVERSED));
    }
    assert_eq!(lines[0].hyperlinks.len(), 1);
    assert_eq!(lines[0].hyperlinks[0].columns, 0..20);
}

#[test]
fn transcript_search_matches_unicode_case_folding_without_losing_source_ranges() {
    assert_eq!(find_literal_ranges("界 CAFÉ [x].* İ", "café"), vec![4..9]);
    assert_eq!(
        find_literal_ranges("界 CAFÉ [x].* İ", "[x].*"),
        vec![10..15]
    );
    assert_eq!(
        find_literal_ranges("界 CAFÉ [x].* İ", "i\u{307}"),
        vec![16..18]
    );
    assert!(find_literal_ranges("界 CAFÉ [x].* İ", "missing").is_empty());
}

#[test]
fn transcript_search_editing_removes_complete_graphemes_and_paste_does_not_split_them() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    overlay.handle_event(&key(KeyCode::Char('/')));
    overlay.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Char('N'),
        KeyModifiers::SHIFT,
    )));
    assert_eq!(overlay.search.query(), "N");
    overlay.handle_event(&key(KeyCode::Backspace));
    assert_eq!(
        overlay.handle_event(&Event::Paste("e\u{301}👩‍💻".to_string())),
        PagerAction::ScheduleFrame
    );
    assert_eq!(overlay.search.query(), "e\u{301}👩‍💻");
    overlay.handle_event(&key(KeyCode::Backspace));
    assert_eq!(overlay.search.query(), "e\u{301}");
    overlay.handle_event(&key(KeyCode::Backspace));
    assert!(overlay.search.query().is_empty());
}

#[test]
fn transcript_search_footer_and_highlight_stay_renderable_on_narrow_localized_terminals() {
    let lines = vec![HyperlinkLine::from(
        "a long transcript line containing the searchable needle",
    )];
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [1, 2, 8, 24] {
            let mut overlay = PagerOverlay::transcript(locale);
            overlay.handle_event(&key(KeyCode::Char('/')));
            for character in "needle with a long query".chars() {
                overlay.handle_event(&key(KeyCode::Char(character)));
            }
            let mut terminal = Terminal::new(TestBackend::new(width, 5)).expect("terminal");
            terminal
                .draw(|frame| overlay.render(frame, frame.area(), locale, &lines))
                .expect("narrow search draw");
            assert_eq!(terminal.backend().buffer().area.width, width);
        }
    }
}

#[test]
fn transcript_search_requests_older_history_and_retries_after_a_failed_page() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    overlay.set_older_history_available(true);
    let current_page = vec![HyperlinkLine::from("newer entry without the query")];
    let mut terminal = Terminal::new(TestBackend::new(80, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
        .expect("initial draw");
    overlay.handle_event(&key(KeyCode::Char('/')));
    for character in "needle".chars() {
        overlay.handle_event(&key(KeyCode::Char(character)));
    }
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
        .expect("search draw");

    assert_eq!(
        overlay.handle_event(&key(KeyCode::Enter)),
        PagerAction::LoadOlderHistory
    );
    overlay.begin_older_history_load();
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
        .expect("loading draw");
    assert!(buffer_text(&terminal).contains("Loading older history"));
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Enter)),
        PagerAction::Consumed
    );

    overlay.fail_older_history_load();
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &current_page))
        .expect("failed draw");
    assert!(buffer_text(&terminal).contains("History load failed"));
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::LoadOlderHistory
    );
    overlay.fail_older_history_load();
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Enter)),
        PagerAction::LoadOlderHistory
    );

    overlay.complete_older_history_load();
    overlay.set_older_history_available(false);
    let all_history = vec![
        HyperlinkLine::from("old needle entry"),
        HyperlinkLine::from("newer entry without the query"),
    ];
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &all_history))
        .expect("history loaded draw");
    assert_eq!(overlay.search.match_count(), 1);
    assert!(buffer_text(&terminal).contains("Match 1/1"));
}
