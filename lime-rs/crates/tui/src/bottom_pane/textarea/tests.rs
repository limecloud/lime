use super::{TextArea, TextAreaState};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::widgets::StatefulWidgetRef;

#[test]
fn unicode_cursor_and_grapheme_deletion_match_codex_textarea_semantics() {
    let mut textarea = TextArea::default();
    textarea.insert("a👩🏽‍💻界");
    textarea.move_left();
    assert!(textarea.remove_previous_grapheme());
    assert_eq!(textarea.text(), "a界");
    assert_eq!(textarea.cursor(), 1);
}

#[test]
fn line_navigation_stays_inside_the_current_logical_line() {
    let mut textarea = TextArea::default();
    textarea.insert("first\nsecond");
    textarea.move_line_start();
    assert_eq!(textarea.cursor(), 6);
    textarea.move_line_end();
    assert_eq!(textarea.cursor(), 12);
}

#[test]
fn codex_cursor_pos_api_keeps_cursor_visible_in_a_scrolled_viewport() {
    let mut textarea = TextArea::new();
    textarea.insert_str("abcdefghij");
    textarea.set_cursor(textarea.text().len());

    let area = Rect::new(2, 3, 4, 2);
    let state = TextAreaState::default();
    let (x, y) = textarea
        .cursor_pos_with_state(area, state)
        .expect("cursor position");

    assert_eq!((x, y), (area.x + 2, area.y + 1));
}

#[test]
fn codex_buffer_replacement_preserves_cursor_only_at_valid_boundaries() {
    let mut textarea = TextArea::new();
    textarea.insert_str("ab");
    textarea.set_cursor(1);
    textarea.set_text_clearing_elements("cd");

    assert_eq!(textarea.text(), "cd");
    assert_eq!(textarea.cursor(), 1);
}

#[test]
fn stateful_render_clears_rows_outside_the_current_draft() {
    let area = Rect::new(0, 0, 6, 2);
    let mut textarea = TextArea::new();
    textarea.insert_str("longer draft");
    let mut buffer = ratatui::buffer::Buffer::empty(area);
    let mut state = TextAreaState::default();
    StatefulWidgetRef::render_ref(&&textarea, area, &mut buffer, &mut state);

    textarea.set_text_clearing_elements("ok");
    StatefulWidgetRef::render_ref(&&textarea, area, &mut buffer, &mut state);

    assert_eq!(buffer[(0, 0)].symbol(), "o");
    assert_eq!(buffer[(2, 0)].symbol(), " ");
    assert_eq!(buffer[(0, 1)].symbol(), " ");
}

#[test]
fn codex_word_delete_and_line_kill_preserve_unicode_boundaries() {
    let mut textarea = TextArea::new();
    textarea.insert_str("alpha 你👍 beta");
    textarea.set_cursor(textarea.text().len());
    textarea.delete_backward_word();
    assert_eq!(textarea.text(), "alpha 你👍 ");
    textarea.yank();
    assert_eq!(textarea.text(), "alpha 你👍 beta");

    textarea.set_cursor(9);
    textarea.kill_to_beginning_of_line();
    assert_eq!(textarea.text(), "👍 beta");
    textarea.yank();
    assert_eq!(textarea.text(), "alpha 你👍 beta");
}

#[test]
fn codex_input_dispatches_emacs_style_editor_bindings() {
    let mut textarea = TextArea::new();
    textarea.input(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE));
    textarea.input(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::NONE));
    textarea.input(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));
    textarea.input(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::CONTROL));
    textarea.input(KeyEvent::new(KeyCode::Char('k'), KeyModifiers::CONTROL));
    assert_eq!(textarea.text(), "ab");
    textarea.input(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::CONTROL));
    assert_eq!(textarea.text(), "abc");
}

#[test]
fn codex_control_h_deletes_and_control_m_inserts_newline() {
    let mut textarea = TextArea::new();
    textarea.insert_str("ab");
    textarea.input(KeyEvent::new(KeyCode::Char('h'), KeyModifiers::CONTROL));
    assert_eq!(textarea.text(), "a");
    textarea.input(KeyEvent::new(KeyCode::Char('m'), KeyModifiers::CONTROL));
    assert_eq!(textarea.text(), "a\n");
}

#[test]
fn c0_line_feed_and_emacs_vertical_motion_match_codex_textarea_semantics() {
    let mut textarea = TextArea::new();
    textarea.insert_str("ab\ncdef");
    textarea.set_cursor(2);
    textarea.input(KeyEvent::new(KeyCode::Char('\u{000a}'), KeyModifiers::NONE));
    assert_eq!(textarea.text(), "ab\n\ncdef");

    textarea.replace("ab\ncdef".to_string());
    textarea.set_cursor(2);
    textarea.input(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::CONTROL));
    assert_eq!(textarea.cursor(), 5);
    textarea.input(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL));
    assert_eq!(textarea.cursor(), 2);
}

#[test]
fn vertical_motion_preserves_display_column_for_wide_graphemes() {
    let mut textarea = TextArea::new();
    textarea.insert_str("界a\nxy");
    textarea.set_cursor(3);
    textarea.move_down();
    assert_eq!(textarea.cursor(), 7);
    textarea.move_up();
    assert_eq!(textarea.cursor(), 3);
}

#[test]
fn codex_word_boundaries_handle_cjk_and_separator_runs() {
    let mut textarea = TextArea::new();
    textarea.insert_str("你好::world");
    textarea.set_cursor(textarea.text().len());
    assert_eq!(textarea.beginning_of_previous_word(), 8);
    textarea.delete_backward_word();
    assert_eq!(textarea.text(), "你好::");
    textarea.set_cursor(0);
    assert_eq!(textarea.end_of_next_word(), 3);
}
