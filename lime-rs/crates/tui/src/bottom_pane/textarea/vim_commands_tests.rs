use super::super::TextArea;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn keys(area: &mut TextArea, text: &str) {
    for ch in text.chars() {
        area.input(key(KeyCode::Char(ch)));
    }
}

#[test]
fn normal_end_and_character_find_use_atomic_element_boundaries() {
    let mut area = textarea("");
    area.insert_element("[Image #1]");
    keys(&mut area, "A");
    area.input(key(KeyCode::Esc));
    assert_eq!(
        area.cursor(),
        0,
        "normal cursor lands on the attachment, not after its label"
    );
    keys(&mut area, "l");
    assert_eq!(area.cursor(), 0);

    let mut area = textarea("A");
    area.insert_element("[Image #1]");
    area.insert_str("Z");
    area.set_cursor(0);
    keys(&mut area, "f[");
    assert_eq!(
        area.cursor(),
        0,
        "find cannot target a character inside an attachment"
    );
    keys(&mut area, "tZ");
    assert_eq!(
        area.cursor(),
        1,
        "till stops at the preceding atomic attachment's start"
    );
    assert_eq!(area.text(), "A[Image #1]Z");
}

#[test]
fn word_end_motion_never_splits_unicode_graphemes() {
    let mut area = textarea("界👩🏽‍💻 next");
    area.set_cursor(0);
    keys(&mut area, "e");
    assert!(area.text().is_char_boundary(area.cursor()));
    assert!(area.is_vim_command_target(area.cursor()));
    keys(&mut area, "de");
    assert!(area.text().is_char_boundary(area.cursor()));
}

#[test]
fn repeat_replays_semantic_delete_replace_and_complete_change() {
    let mut area = textarea("alpha beta gamma");
    area.set_cursor(0);
    keys(&mut area, "dw.");
    assert_eq!(area.text(), "gamma");

    let mut area = textarea("abc");
    area.set_cursor(0);
    keys(&mut area, "rXl.");
    assert_eq!(area.text(), "XXc");

    let mut area = textarea("one two three");
    area.set_cursor(0);
    keys(&mut area, "cwX");
    area.input(key(KeyCode::Esc));
    keys(&mut area, "w.");
    assert_eq!(area.text(), "X X three");
    assert!(area.is_vim_normal_mode());
}

#[test]
fn repeat_records_pasted_insertions_movement_and_effective_deletion() {
    let mut area = textarea("");
    keys(&mut area, "i");
    area.insert_str("foo");
    area.input(key(KeyCode::Esc));
    keys(&mut area, ".");
    assert_eq!(area.text(), "fofooo");

    let mut area = textarea("abc");
    area.set_cursor(0);
    keys(&mut area, "ix");
    area.input(key(KeyCode::Left));
    keys(&mut area, "y");
    area.input(key(KeyCode::Esc));
    keys(&mut area, ".");
    assert_eq!(area.text(), "yxyxabc");

    let mut area = textarea("abcd");
    area.set_cursor(3);
    keys(&mut area, "i");
    area.input(key(KeyCode::Backspace));
    area.input(key(KeyCode::Esc));
    keys(&mut area, "l.");
    assert_eq!(area.text(), "ad");
}

#[test]
fn repeat_omits_ineffective_deletions_and_aborts_failed_motion() {
    let mut area = textarea("one two");
    area.set_cursor(0);
    keys(&mut area, "i");
    area.input(key(KeyCode::Backspace));
    keys(&mut area, "X");
    area.input(key(KeyCode::Esc));
    keys(&mut area, "w.");
    assert_eq!(area.text(), "Xone Xtwo");

    let mut area = textarea("one\ntwo\nthree");
    area.set_cursor(0);
    keys(&mut area, "cjfoo");
    area.input(key(KeyCode::Esc));
    keys(&mut area, "j");
    let before = (area.text().to_string(), area.cursor());
    keys(&mut area, ".");
    assert_eq!((area.text(), area.cursor()), (before.0.as_str(), before.1));
    assert!(area.is_vim_normal_mode());
}

#[test]
fn dot_replays_find_text_object_and_buffer_jump_targets() {
    let mut area = textarea("one:two:three");
    area.set_cursor(0);
    keys(&mut area, "df:.");
    assert_eq!(area.text(), "three");

    let mut area = textarea("(one) (two)");
    area.set_cursor(1);
    keys(&mut area, "ci(X");
    area.input(key(KeyCode::Esc));
    area.set_cursor(6);
    keys(&mut area, ".");
    assert_eq!(area.text(), "(X) (X)");

    let mut area = textarea("one\ntwo\nthree");
    area.set_cursor(4);
    keys(&mut area, "cGlast");
    area.input(key(KeyCode::Esc));
    area.set_cursor(0);
    keys(&mut area, ".");
    assert_eq!(area.text(), "last");
}

#[test]
fn replace_paste_skips_atomic_attachment_and_backspace_retraces_original_cursor() {
    let mut area = textarea("");
    area.insert_element("[Image #1]");
    area.insert_str("界👩🏽‍💻tail");
    area.set_cursor(0);
    keys(&mut area, "R");
    area.insert_str("XY");
    assert_eq!(area.text(), "[Image #1]XYtail");
    area.input(key(KeyCode::Backspace));
    area.input(key(KeyCode::Backspace));
    assert_eq!(area.text(), "[Image #1]界👩🏽‍💻tail");
    assert_eq!(area.cursor(), 0);
    assert_eq!(
        area.text_elements(),
        vec![agent_protocol::TextElement::new(
            0..10,
            Some("[Image #1]".into())
        )]
    );
}

#[test]
fn buffer_replacement_discards_pending_and_completed_repeat() {
    let mut area = textarea("draft");
    area.set_cursor(0);
    keys(&mut area, "rX");
    assert!(area.vim_repeat_actions().is_some());
    area.set_text_clearing_elements("fresh");
    assert!(area.vim_repeat_actions().is_none());
    keys(&mut area, "iY");
    area.set_text_clearing_elements("replacement");
    area.input(key(KeyCode::Esc));
    keys(&mut area, ".");
    assert_eq!(area.text(), "replacement");
}

#[test]
fn dot_replay_renders_the_complete_change_on_narrow_unicode_surface() {
    use ratatui::{backend::TestBackend, layout::Rect, Terminal};
    let mut area = textarea("one two 界");
    area.set_cursor(0);
    keys(&mut area, "cwX");
    area.input(key(KeyCode::Esc));
    keys(&mut area, "w.");
    let mut terminal = Terminal::new(TestBackend::new(12, 2)).unwrap();
    let mut state = super::super::TextAreaState::default();
    terminal
        .draw(|frame| {
            ratatui::widgets::StatefulWidgetRef::render_ref(
                &&area,
                Rect::new(0, 0, 12, 2),
                frame.buffer_mut(),
                &mut state,
            )
        })
        .unwrap();
    let buffer = terminal.backend().buffer();
    let row = (0..12).map(|x| buffer[(x, 0)].symbol()).collect::<String>();
    assert_eq!(row, "X X 界       ");
}

fn textarea(text: &str) -> TextArea {
    let mut area = TextArea::new();
    area.insert_str(text);
    area.set_vim_enabled(true);
    area
}

#[test]
fn vim_insert_and_escape_preserve_normal_cursor_contract() {
    let mut area = TextArea::new();
    area.set_vim_enabled(true);
    area.input(key(KeyCode::Char('i')));
    area.input(key(KeyCode::Char('h')));
    area.input(key(KeyCode::Esc));

    assert_eq!(area.text(), "h");
    assert_eq!(
        area.vim_mode_indicator_span()
            .expect("vim indicator")
            .content,
        "Vim: Normal"
    );
    assert_eq!(area.cursor(), 0);
}

#[test]
fn vim_normal_motion_and_delete_respect_grapheme_boundaries() {
    let mut area = textarea("a👩🏽‍💻c");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('l')));
    assert_eq!(area.cursor(), "a".len());
    area.input(key(KeyCode::Char('x')));
    assert_eq!(area.text(), "ac");
    assert_eq!(area.cursor(), "a".len());
}

#[test]
fn vim_operator_pending_supports_word_delete_and_escape_cancel() {
    let mut area = textarea("hello world");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('d')));
    assert!(area.is_vim_operator_pending());
    area.input(key(KeyCode::Char('w')));
    assert_eq!(area.text(), "world");
    assert!(!area.is_vim_operator_pending());

    area.input(key(KeyCode::Char('d')));
    area.input(key(KeyCode::Esc));
    assert_eq!(area.text(), "world");
    assert!(!area.is_vim_operator_pending());
}

#[test]
fn vim_find_and_till_stay_on_current_line_and_grapheme_boundaries() {
    let mut area = textarea("a👩🏽‍💻:b:c\nnext");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('f')));
    area.input(key(KeyCode::Char(':')));
    assert_eq!(area.cursor(), "a👩🏽‍💻".len());

    area.set_cursor("a👩🏽‍💻:".len());
    area.input(key(KeyCode::Char('t')));
    area.input(key(KeyCode::Char('c')));
    assert_eq!(area.cursor(), "a👩🏽‍💻:b".len());

    area.set_cursor("a👩🏽‍💻:b".len());
    area.input(key(KeyCode::Char('F')));
    area.input(key(KeyCode::Char(':')));
    assert_eq!(area.cursor(), "a👩🏽‍💻".len());

    area.set_cursor("a👩🏽‍💻:b:c".len());
    area.input(key(KeyCode::Char('T')));
    area.input(key(KeyCode::Char(':')));
    assert_eq!(area.cursor(), "a👩🏽‍💻:b:".len());

    area.set_cursor(0);
    area.input(key(KeyCode::Char('f')));
    area.input(key(KeyCode::Char('n')));
    assert_eq!(area.cursor(), 0);
}

#[test]
fn vim_find_operators_delete_change_and_yank() {
    let mut area = textarea("one:two:three");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('d')));
    area.input(key(KeyCode::Char('f')));
    area.input(key(KeyCode::Char(':')));
    assert_eq!(area.text(), "two:three");

    let mut area = textarea("abc:def");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('c')));
    area.input(key(KeyCode::Char('t')));
    area.input(key(KeyCode::Char(':')));
    assert_eq!(area.text(), ":def");
    assert_eq!(
        area.vim_mode_indicator_span()
            .expect("vim indicator")
            .content,
        "Vim: Insert"
    );

    let mut area = textarea("abc:def");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('y')));
    area.input(key(KeyCode::Char('f')));
    area.input(key(KeyCode::Char(':')));
    area.input(key(KeyCode::Char('p')));
    assert_eq!(area.text(), "aabc:bc:def");
}

#[test]
fn vim_text_objects_delete_inner_around_words_and_pairs() {
    let mut area = textarea("alpha beta gamma");
    area.set_cursor("alpha ".len());
    area.input(key(KeyCode::Char('d')));
    area.input(key(KeyCode::Char('i')));
    area.input(key(KeyCode::Char('w')));
    assert_eq!(area.text(), "alpha  gamma");

    let mut area = textarea("alpha beta gamma");
    area.set_cursor("alpha ".len());
    area.input(key(KeyCode::Char('d')));
    area.input(key(KeyCode::Char('a')));
    area.input(key(KeyCode::Char('w')));
    assert_eq!(area.text(), "alpha gamma");

    let mut area = textarea("call(one, [two])");
    area.set_cursor("call(one, [t".len());
    area.input(key(KeyCode::Char('d')));
    area.input(key(KeyCode::Char('i')));
    area.input(key(KeyCode::Char('[')));
    assert_eq!(area.text(), "call(one, [])");

    let mut area = textarea("say(\"hello\")");
    area.set_cursor("say(\"he".len());
    area.input(key(KeyCode::Char('d')));
    area.input(key(KeyCode::Char('a')));
    area.input(key(KeyCode::Char('"')));
    assert_eq!(area.text(), "say()");
}

#[test]
fn vim_replace_mode_overwrites_one_grapheme_and_returns_to_normal() {
    let mut area = textarea("a👩🏽‍💻c");
    area.set_cursor("a".len());
    area.input(key(KeyCode::Char('r')));
    area.input(key(KeyCode::Char('Z')));
    assert_eq!(area.text(), "aZc");
    assert_eq!(
        area.vim_mode_indicator_span()
            .expect("vim indicator")
            .content,
        "Vim: Normal"
    );

    area.input(key(KeyCode::Char('R')));
    area.input(key(KeyCode::Char('X')));
    area.input(key(KeyCode::Esc));
    assert_eq!(area.text(), "aXc");
    assert_eq!(
        area.vim_mode_indicator_span()
            .expect("vim indicator")
            .content,
        "Vim: Normal"
    );
}

#[test]
fn vim_replace_mode_backspace_restores_original_graphemes() {
    let mut area = textarea("a👩🏽‍💻");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('R')));
    area.input(key(KeyCode::Char('X')));
    area.input(key(KeyCode::Char('Y')));
    area.input(key(KeyCode::Char('Z')));
    assert_eq!(area.text(), "XYZ");

    for expected in ["XY", "X👩🏽‍💻", "a👩🏽‍💻", "a👩🏽‍💻"] {
        area.input(key(KeyCode::Backspace));
        assert_eq!(area.text(), expected);
    }
    assert_eq!(area.cursor(), 0);
}

#[test]
fn vim_replace_mode_enter_is_inserted_and_restored_as_one_step() {
    let mut area = textarea("abc");
    area.set_cursor(0);
    area.input(key(KeyCode::Char('R')));
    area.input(key(KeyCode::Enter));
    area.input(key(KeyCode::Char('X')));
    assert_eq!(area.text(), "\nXbc");

    area.input(key(KeyCode::Backspace));
    assert_eq!(area.text(), "\nabc");
    area.input(key(KeyCode::Backspace));
    assert_eq!(area.text(), "abc");
}

#[test]
fn vim_mode_indicator_is_hidden_when_disabled_and_colored_when_enabled() {
    let mut area = TextArea::new();
    assert!(area.vim_mode_indicator_span().is_none());
    area.set_vim_enabled(true);
    let span = area.vim_mode_indicator_span().expect("vim indicator");
    assert_eq!(span.content, "Vim: Normal");
    assert_eq!(span.style.fg, Some(ratatui::style::Color::Magenta));
}
