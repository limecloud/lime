use super::super::ChatComposer;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn disconnected_edit_preserves_draft_and_cancels_history_preview() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["history preview".to_string()]);
    composer.insert("original draft");
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    composer.handle_key_event(key(KeyCode::Char('h')));
    assert_eq!(composer.text(), "history preview");

    composer.handle_disconnected_key(key(KeyCode::Char('!')));

    assert_eq!(composer.text(), "original draft!");
    assert!(!composer.history_search_active());
}

#[test]
fn disconnected_enter_and_tab_leave_input_available_for_reconnect() {
    let mut composer = ChatComposer::default();
    composer.insert("unsent");

    composer.handle_disconnected_key(key(KeyCode::Enter));
    assert_eq!(composer.text(), "unsent");
    composer.handle_disconnected_key(key(KeyCode::Tab));
    assert_eq!(composer.text(), "unsent");
}

#[test]
fn disconnected_editing_preserves_graphemes_and_cursor_boundaries() {
    let mut composer = ChatComposer::default();
    composer.insert("你👍好");

    composer.handle_disconnected_key(key(KeyCode::Backspace));
    assert_eq!(composer.text(), "你👍");
    composer.handle_disconnected_key(key(KeyCode::Backspace));
    assert_eq!(composer.text(), "你");

    composer.handle_disconnected_key(key(KeyCode::Char('a')));
    composer.handle_disconnected_key(key(KeyCode::Left));
    composer.handle_disconnected_key(key(KeyCode::Char('界')));
    assert_eq!(composer.text(), "你界a");
}

#[test]
fn disconnected_repeat_key_is_editable_but_never_submits() {
    let mut composer = ChatComposer::default();
    composer.insert("draft");
    let mut repeated = key(KeyCode::Char('!'));
    repeated.kind = crossterm::event::KeyEventKind::Repeat;

    composer.handle_disconnected_key(repeated);
    composer.handle_disconnected_key(key(KeyCode::Enter));

    assert_eq!(composer.text(), "draft!");
}
