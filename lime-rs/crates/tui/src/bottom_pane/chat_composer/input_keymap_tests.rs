use super::*;
use crate::keymap::RuntimeKeymap;
use serde_json::json;

#[test]
fn modal_edit_undo_redo_and_repeat_use_the_configured_action_including_chords() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.replace("alpha beta gamma".into());
    composer.draft.textarea.set_cursor(0);
    composer.set_keymap_bindings(&bindings(json!({
        "vim_normal": {"start_delete_operator":"f9", "repeat_last_change":"f11", "undo":"z u", "redo":"z r"},
        "vim_operator": {"motion_word_forward":"f10"}
    })));
    for code in [KeyCode::F(9), KeyCode::F(10), KeyCode::F(11)] {
        composer.handle_key_event(key(code, KeyModifiers::NONE));
    }
    assert_eq!(composer.text(), "gamma");
    for ch in "zu".chars() {
        composer.handle_key_event(key(KeyCode::Char(ch), KeyModifiers::NONE));
    }
    assert_eq!(composer.text(), "beta gamma");
    for ch in "zu".chars() {
        composer.handle_key_event(key(KeyCode::Char(ch), KeyModifiers::NONE));
    }
    assert_eq!(composer.text(), "alpha beta gamma");
    for ch in "zr".chars() {
        composer.handle_key_event(key(KeyCode::Char(ch), KeyModifiers::NONE));
    }
    assert_eq!(composer.text(), "beta gamma");
    composer.handle_key_event(key(KeyCode::Char('u'), KeyModifiers::NONE));
    assert_eq!(
        composer.text(),
        "beta gamma",
        "unbound default u is not an undo fallback"
    );
}

#[test]
fn app_modal_chords_and_operator_literal_capture_precede_host_submission_and_interrupt() {
    use crate::app::{App, AppAction};
    use crate::tui::TuiEvent;
    let mut app = App::default();
    app.chat_widget.bottom_pane.composer.set_vim_enabled(true);
    app.chat_widget.bottom_pane.composer.replace("abc".into());
    app.set_runtime_keymap(bindings(json!({"vim_normal":{"delete_char":"z x"}})));
    app.start_turn("turn-modal".into());
    for completion in [
        key(KeyCode::Enter, KeyModifiers::NONE),
        key(KeyCode::Char('c'), KeyModifiers::CONTROL),
    ] {
        app.handle_tui_event(
            TuiEvent::Key(key(KeyCode::Char('z'), KeyModifiers::NONE)),
            true,
        );
        assert_eq!(
            app.handle_tui_event(TuiEvent::Key(completion), true),
            AppAction::None
        );
        assert_eq!(app.chat_widget.bottom_pane.composer.text(), "abc");
        assert_eq!(app.projection.active_turn_id(), Some("turn-modal"));
    }
    app.handle_tui_event(
        TuiEvent::Key(key(KeyCode::Char('f'), KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(key(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            true
        ),
        AppAction::None
    );
    assert_eq!(app.projection.active_turn_id(), Some("turn-modal"));
}

#[test]
fn normal_mode_history_navigation_resolves_rebound_actions_and_unbinds() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["older".into(), "newer".into()]);
    composer.set_vim_enabled(true);
    composer.set_keymap_bindings(&bindings(
        json!({"vim_normal":{"move_up": "f9", "move_down": "f10"}}),
    ));
    composer.handle_key_event(key(KeyCode::Up, KeyModifiers::NONE));
    composer.handle_key_event(key(KeyCode::Char('k'), KeyModifiers::NONE));
    assert!(composer.is_empty());
    composer.handle_key_event(key(KeyCode::F(9), KeyModifiers::NONE));
    assert_eq!(composer.text(), "newer");
    composer.handle_key_event(key(KeyCode::F(9), KeyModifiers::NONE));
    assert_eq!(composer.text(), "older");
    composer.handle_key_event(key(KeyCode::F(10), KeyModifiers::NONE));
    assert_eq!(composer.text(), "newer");
    composer.handle_key_event(key(KeyCode::F(10), KeyModifiers::NONE));
    assert!(composer.is_empty());
}

fn key(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
    KeyEvent::new(code, modifiers)
}

fn bindings(value: serde_json::Value) -> RuntimeKeymap {
    RuntimeKeymap::from_config(&serde_json::from_value(value).unwrap()).unwrap()
}

#[test]
fn custom_newline_and_unbind_do_not_submit_or_fall_back_to_hardcoded_editor_keys() {
    let mut composer = ChatComposer::default();
    composer.set_keymap_bindings(&bindings(
        json!({"editor":{"insert_newline":"f9", "delete_backward":[]}}),
    ));
    composer.insert("alpha");
    assert_eq!(
        composer.handle_key_event(key(KeyCode::F(9), KeyModifiers::NONE)),
        InputResult::Changed
    );
    assert_eq!(composer.text(), "alpha\n");
    composer.handle_key_event(key(KeyCode::Enter, KeyModifiers::SHIFT));
    composer.handle_key_event(key(KeyCode::Backspace, KeyModifiers::NONE));
    assert_eq!(composer.text(), "alpha\n");
    assert!(
        matches!(composer.handle_key_event(key(KeyCode::Enter, KeyModifiers::NONE)), InputResult::Submitted { text, .. } if text == "alpha")
    );
}

#[test]
fn configured_printable_edit_key_and_chord_completion_bypass_paste_burst_detection() {
    let mut composer = ChatComposer::default();
    composer.set_keymap_bindings(&bindings(
        json!({"editor":{"move_left":"z", "kill_line_end":"ctrl-q k"}}),
    ));
    composer.insert("abc");
    let now = Instant::now();
    composer.handle_key_event_at(key(KeyCode::Char('z'), KeyModifiers::NONE), now);
    assert_eq!((composer.text(), composer.cursor()), ("abc", 2));
    composer.handle_key_event_at(key(KeyCode::Char('q'), KeyModifiers::CONTROL), now);
    assert!(composer.editor_key_chord_pending());
    composer.handle_key_event_at(key(KeyCode::Char('k'), KeyModifiers::NONE), now);
    assert_eq!(composer.text(), "ab");
    assert!(!composer.draft.paste_burst.is_active());
    assert!(!composer.editor_key_chord_pending());
}

#[test]
fn unbound_vertical_navigation_does_not_recall_history() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["old prompt".into()]);
    composer.set_keymap_bindings(&bindings(json!({"editor":{"move_up":[], "move_down":[]}})));
    composer.handle_key_event(key(KeyCode::Up, KeyModifiers::NONE));
    assert!(composer.is_empty());
    composer.set_keymap_bindings(&RuntimeKeymap::default());
    composer.handle_key_event(key(KeyCode::Up, KeyModifiers::NONE));
    assert_eq!(composer.text(), "old prompt");
}

#[test]
fn insert_repeat_uses_semantic_actions_after_rebinding_and_undo_is_one_transaction() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.replace("abc def".into());
    composer.draft.textarea.set_cursor(0);
    composer.set_keymap_bindings(&bindings(json!({"editor":{"delete_forward_word":"f9"}})));
    composer.handle_key_event(key(KeyCode::Char('i'), KeyModifiers::NONE));
    composer.handle_key_event(key(KeyCode::F(9), KeyModifiers::NONE));
    composer.handle_key_event(key(KeyCode::Esc, KeyModifiers::NONE));
    assert_eq!(composer.text(), " def");
    composer.set_keymap_bindings(&bindings(json!({"editor":{"delete_forward_word":"f10"}})));
    composer.handle_key_event(key(KeyCode::Char('.'), KeyModifiers::NONE));
    assert!(composer.is_empty());
    composer.handle_key_event(key(KeyCode::Char('u'), KeyModifiers::NONE));
    assert_eq!(composer.text(), " def");
    composer.handle_key_event(key(KeyCode::Char('u'), KeyModifiers::NONE));
    assert_eq!(composer.text(), "abc def");
}

#[test]
fn app_applies_snapshot_and_pending_editor_chord_cannot_trigger_host_actions() {
    use crate::app::{App, AppAction};
    use crate::tui::TuiEvent;
    let mut app = App::default();
    app.set_runtime_keymap(bindings(json!({"editor":{"kill_line_end":"ctrl-q k"}})));
    app.chat_widget.bottom_pane.composer.insert("abc");
    app.start_turn("turn-editor".into());
    for event in [
        key(KeyCode::Char('q'), KeyModifiers::CONTROL),
        key(KeyCode::Char('c'), KeyModifiers::CONTROL),
    ] {
        assert_eq!(
            app.handle_tui_event(TuiEvent::Key(event), true),
            AppAction::None
        );
    }
    assert_eq!(app.chat_widget.bottom_pane.composer.text(), "abc");
    assert_eq!(app.projection.active_turn_id(), Some("turn-editor"));
    assert!(!app
        .chat_widget
        .bottom_pane
        .composer
        .editor_key_chord_pending());
    for event in [
        key(KeyCode::Char('q'), KeyModifiers::CONTROL),
        key(KeyCode::Enter, KeyModifiers::NONE),
    ] {
        assert_eq!(
            app.handle_tui_event(TuiEvent::Key(event), true),
            AppAction::None
        );
    }
    assert_eq!(app.chat_widget.bottom_pane.composer.text(), "abc");
    // Windows AltGr must reach text input, not App's Ctrl/Alt+V image shortcut.
    if cfg!(windows) {
        app.handle_tui_event(
            TuiEvent::Key(key(
                KeyCode::Char('v'),
                KeyModifiers::CONTROL | KeyModifiers::ALT,
            )),
            true,
        );
        assert_eq!(app.chat_widget.bottom_pane.composer.text(), "abcv");
    }
}
