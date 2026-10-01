use super::*;
use crate::keymap::RuntimeKeymap;
use serde_json::json;

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
fn keys(area: &mut TextArea, value: &str) {
    for ch in value.chars() {
        area.input(key(KeyCode::Char(ch)));
    }
}
fn bindings(value: serde_json::Value) -> RuntimeKeymap {
    RuntimeKeymap::from_config(&serde_json::from_value(value).unwrap()).unwrap()
}
fn area(text: &str) -> TextArea {
    let mut area = TextArea::new();
    area.replace(text.into());
    area.set_cursor(0);
    area.set_vim_enabled(true);
    area
}

#[test]
fn normal_operator_and_text_object_use_rebound_actions_without_old_fallbacks() {
    let mut area = area("alpha beta (界)");
    area.set_keymap_bindings(&bindings(json!({
        "vim_normal": {"start_delete_operator":"f9", "delete_char":[]},
        "vim_operator": {"motion_word_forward":"f10", "select_inner_text_object":"z z"},
        "vim_text_object": {"parentheses":"f11"}
    })));
    keys(&mut area, "x");
    assert_eq!(area.text(), "alpha beta (界)");
    area.input(key(KeyCode::F(9)));
    assert_eq!(area.keymap_context(), KeymapContext::VimOperator);
    area.input(key(KeyCode::F(10)));
    assert_eq!(area.text(), "beta (界)");
    area.set_cursor(6);
    area.input(key(KeyCode::F(9)));
    keys(&mut area, "zz");
    assert_eq!(area.keymap_context(), KeymapContext::VimTextObject);
    area.input(key(KeyCode::F(11)));
    assert_eq!(area.text(), "beta ()");
    area.set_text_clearing_elements("alpha beta gamma");
    area.set_cursor(0);
    area.input(key(KeyCode::F(9)));
    area.input(key(KeyCode::F(10)));
    area.set_keymap_bindings(&bindings(json!({"vim_normal":{"start_delete_operator":[]}, "vim_operator":{"motion_word_forward":[]}})));
    keys(&mut area, ".");
    assert_eq!(
        area.text(),
        "gamma",
        "repeat is semantic, not the old d/w bindings"
    );
}

#[test]
fn default_gg_and_operator_gg_use_the_same_modal_chord_matcher() {
    let mut area = area("alpha\nbeta\ngamma");
    keys(&mut area, "G");
    assert_eq!(area.cursor(), 11);
    keys(&mut area, "g");
    assert!(area.vim_key_chord_pending());
    keys(&mut area, "g");
    assert_eq!(area.cursor(), 0);
    keys(&mut area, "Gdgg");
    assert_eq!(area.text(), "");
    assert!(!area.is_vim_operator_pending());
}

#[test]
fn pending_modal_chords_cancel_without_reinterpreting_the_completion() {
    let mut area = area("abc");
    area.set_keymap_bindings(&bindings(json!({"vim_normal":{"delete_char":"z x"}})));
    keys(&mut area, "z");
    area.input(key(KeyCode::Enter));
    assert_eq!(area.text(), "abc");
    assert!(!area.vim_key_chord_pending());
    keys(&mut area, "z");
    area.set_keymap_bindings(&RuntimeKeymap::default());
    assert!(!area.vim_key_chord_pending());
    keys(&mut area, "x");
    assert_eq!(area.text(), "bc");
    keys(&mut area, "d");
    area.set_keymap_bindings(&RuntimeKeymap::default());
    assert_eq!(area.keymap_context(), KeymapContext::VimNormal);
    keys(&mut area, "w");
    assert_eq!(area.text(), "bc");
}

#[test]
fn search_rebindings_capture_query_and_share_operator_semantics() {
    let mut area = area("alpha beta gamma");
    area.set_keymap_bindings(&bindings(json!({
        "vim_search":{"forward":"z /", "next":"f10", "previous":[]}
    })));
    keys(&mut area, "/");
    assert!(area.vim_search_query().is_none());
    keys(&mut area, "z/");
    assert_eq!(area.keymap_context(), KeymapContext::Editor);
    keys(&mut area, "beta");
    area.input(key(KeyCode::Enter));
    assert_eq!(area.cursor(), 6);
    area.set_cursor(0);
    area.input(key(KeyCode::F(10)));
    assert_eq!(area.cursor(), 6);
    area.set_cursor(0);
    keys(&mut area, "dz/");
    keys(&mut area, "gamma");
    area.input(key(KeyCode::Enter));
    assert_eq!(area.text(), "gamma");
    assert!(!area.is_vim_operator_pending());
}

#[test]
fn search_query_pending_editor_chord_owns_enter_and_cancellation() {
    let mut area = area("alpha beta");
    area.set_keymap_bindings(&bindings(json!({"editor":{"delete_backward":"ctrl-q h"}})));
    keys(&mut area, "/beta");
    area.input(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    area.input(key(KeyCode::Enter));
    assert_eq!(area.vim_search_query().unwrap().0, "beta");
    assert_eq!(area.cursor(), 0);
    area.input(key(KeyCode::Enter));
    assert_eq!(area.cursor(), 6);
}

#[test]
fn linewise_and_characterwise_registers_are_not_inferred_from_text() {
    let mut area = area("alpha\nbeta");
    keys(&mut area, "Yp");
    assert_eq!(area.text(), "alpha\nalpha\nbeta");
    assert_eq!(area.cursor(), 6);
    area.replace("alpha\nbeta".into());
    area.set_cursor(6);
    keys(&mut area, "yyp");
    assert_eq!(area.text(), "alpha\nbeta\nbeta");
    assert_eq!(area.cursor(), 11);
    area.replace("alpha\nbeta".into());
    area.set_cursor(0);
    keys(&mut area, "ddp");
    assert_eq!(area.text(), "beta\nalpha");
    // A characterwise yank containing a newline still pastes after the character.
    area.replace("(a\nb) x".into());
    area.set_cursor(1);
    keys(&mut area, "yi)");
    area.set_cursor(6);
    keys(&mut area, "p");
    assert_eq!(area.text(), "(a\nb) xa\nb");
}

#[test]
fn unbound_text_objects_and_shift_reported_uppercase_commands_have_real_consumers() {
    let mut area = area("(界) tail");
    area.set_cursor(1);
    area.set_keymap_bindings(&bindings(json!({"vim_text_object":{"parentheses":[]}})));
    keys(&mut area, "di)");
    assert_eq!(area.text(), "(界) tail");
    area.input(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::SHIFT));
    assert!(!area.is_vim_normal_mode());
    area.insert_str("!");
    area.input(key(KeyCode::Esc));
    assert_eq!(area.text(), "(界) tail!");
}
