use super::*;
use crate::keymap::RuntimeKeymap;
use serde_json::json;

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn keymap(value: serde_json::Value) -> RuntimeKeymap {
    RuntimeKeymap::from_config(&serde_json::from_value(value).unwrap()).unwrap()
}

#[test]
fn all_editor_actions_have_real_textarea_consumers() {
    for (action, text, cursor, expected, expected_cursor) in [
        ("insert_newline", "abc", 1, "a\nbc", 2),
        ("move_left", "abc", 1, "abc", 0),
        ("move_right", "abc", 1, "abc", 2),
        ("move_up", "abc\ndef", 5, "abc\ndef", 1),
        ("move_down", "abc\ndef", 1, "abc\ndef", 5),
        ("move_word_left", "abc def", 7, "abc def", 4),
        ("move_word_right", "abc def", 0, "abc def", 3),
        ("move_line_start", "abc", 1, "abc", 0),
        ("move_line_end", "abc", 1, "abc", 3),
        ("delete_backward", "a界b", 4, "ab", 1),
        ("delete_forward", "a界b", 1, "ab", 1),
        ("delete_backward_word", "abc def", 7, "abc ", 4),
        ("delete_forward_word", "abc def", 0, " def", 0),
        ("kill_line_start", "abc", 2, "c", 0),
        ("kill_whole_line", "abc\ndef", 1, "def", 0),
        ("kill_line_end", "abc", 1, "a", 1),
        ("yank", "abc", 1, "a界bc", 4),
    ] {
        let mut textarea = TextArea::new();
        textarea.replace(text.into());
        textarea.set_cursor(cursor);
        textarea.kill_buffer = "界".into();
        textarea.set_keymap_bindings(&keymap(json!({"editor":{(action):"f9"}})));
        textarea.input(key(KeyCode::F(9)));
        assert_eq!(
            (textarea.text(), textarea.cursor()),
            (expected, expected_cursor),
            "editor.{action}"
        );
    }
}

#[test]
fn swapping_bindings_preserves_draft_elements_and_kill_buffer_but_cancels_old_chord() {
    let mut textarea = TextArea::new();
    textarea.insert_element("[image]");
    textarea.kill_buffer = "killed".into();
    let before = (
        textarea.text().to_owned(),
        textarea.cursor(),
        textarea.text_element_snapshots(),
    );
    textarea.set_keymap_bindings(&keymap(json!({"editor":{"move_left":"ctrl-q h"}})));
    textarea.input(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    assert!(textarea.editor_key_chord_pending());
    textarea.set_keymap_bindings(&keymap(json!({"editor":{"move_left":"f9"}})));
    assert!(!textarea.editor_key_chord_pending());
    assert_eq!(
        (
            textarea.text().to_owned(),
            textarea.cursor(),
            textarea.text_element_snapshots()
        ),
        before
    );
    assert_eq!(textarea.kill_buffer, "killed");
    textarea.input(key(KeyCode::F(9)));
    assert_eq!(
        textarea.cursor(),
        0,
        "movement skips the complete atomic image element"
    );
}

#[test]
fn explicit_unbind_does_not_restore_backspace_and_plain_char_bindings_are_actions() {
    let mut textarea = TextArea::new();
    textarea.replace("abc".into());
    textarea.set_keymap_bindings(&keymap(
        json!({"editor":{"delete_backward":[], "move_left":"z"}}),
    ));
    textarea.input(key(KeyCode::Backspace));
    assert_eq!(textarea.text(), "abc");
    textarea.input(key(KeyCode::Char('z')));
    assert_eq!((textarea.text(), textarea.cursor()), ("abc", 2));
}

#[test]
fn replace_recovery_consumes_rebound_delete_action() {
    let mut textarea = TextArea::new();
    textarea.replace("abc".into());
    textarea.set_cursor(0);
    textarea.set_vim_enabled(true);
    textarea.set_keymap_bindings(&keymap(json!({"editor":{"delete_backward":"f9"}})));
    textarea.input(key(KeyCode::Char('R')));
    textarea.input(key(KeyCode::Char('界')));
    assert_eq!(textarea.text(), "界bc");
    textarea.input(key(KeyCode::Backspace));
    assert_eq!(textarea.text(), "界bc");
    textarea.input(key(KeyCode::F(9)));
    assert_eq!((textarea.text(), textarea.cursor()), ("abc", 0));
}

#[test]
fn pending_insert_chord_owns_escape_without_leaving_vim_insert_mode() {
    let mut textarea = TextArea::new();
    textarea.set_vim_enabled(true);
    textarea.enter_vim_insert_mode();
    textarea.set_keymap_bindings(&keymap(json!({"editor":{"move_left":"ctrl-q h"}})));
    textarea.input(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    assert!(textarea.editor_key_chord_pending());
    textarea.input(key(KeyCode::Esc));
    assert!(!textarea.editor_key_chord_pending());
    assert!(!textarea.is_vim_normal_mode());
    textarea.input(key(KeyCode::Esc));
    assert!(textarea.is_vim_normal_mode());
}

#[test]
fn vim_query_editor_inherits_the_current_snapshot_and_rebinding_preserves_query() {
    let mut textarea = TextArea::new();
    textarea.set_vim_enabled(true);
    textarea.set_keymap_bindings(&keymap(json!({"editor":{"delete_backward":"f9"}})));
    textarea.input(key(KeyCode::Char('/')));
    textarea.insert_vim_search_text("query");
    textarea.input(key(KeyCode::F(9)));
    assert_eq!(textarea.vim_search_query().unwrap().0, "quer");
    textarea.set_keymap_bindings(&keymap(json!({"editor":{"delete_backward":"f10"}})));
    assert_eq!(textarea.vim_search_query().unwrap().0, "quer");
    textarea.input(key(KeyCode::F(9)));
    assert_eq!(textarea.vim_search_query().unwrap().0, "quer");
    textarea.input(key(KeyCode::F(10)));
    assert_eq!(textarea.vim_search_query().unwrap().0, "que");
}

#[test]
fn altgr_text_and_codex_word_delete_alias_have_deterministic_precedence() {
    let mut textarea = TextArea::new();
    textarea.replace("abc def".into());
    textarea.input(KeyEvent::new(
        KeyCode::Char('h'),
        KeyModifiers::CONTROL | KeyModifiers::ALT,
    ));
    assert_eq!(textarea.text(), "abc ");
    if cfg!(windows) {
        textarea.input(KeyEvent::new(
            KeyCode::Char('€'),
            KeyModifiers::CONTROL | KeyModifiers::ALT,
        ));
        assert_eq!(textarea.text(), "abc €");
    }
}
