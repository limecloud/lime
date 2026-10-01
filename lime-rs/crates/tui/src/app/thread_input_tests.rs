//! Thread handoff owns a fresh editor lifetime, not the previous thread's undo or commands.

use super::*;
use crate::keymap::RuntimeKeymap;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::json;

fn key(app: &mut App, value: char) {
    app.composer
        .handle_key_event(KeyEvent::new(KeyCode::Char(value), KeyModifiers::NONE));
}

fn handoff(app: &mut App, id: &str) {
    app.capture_current_thread_input();
    app.set_thread_id(id.into());
    app.restore_thread_input(id);
}

#[test]
fn held_typing_is_materialized_before_capture_and_never_flushed_into_the_new_thread() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    let now = std::time::Instant::now();
    app.composer
        .handle_key_event_at(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE), now);
    assert!(
        app.composer.is_empty(),
        "first ASCII key is held by the burst owner"
    );
    handoff(&mut app, "child");
    app.composer
        .handle_paste_burst_flush(now + std::time::Duration::from_secs(1));
    assert!(
        app.composer.is_empty(),
        "child must not receive the previous editor's held key"
    );
    handoff(&mut app, "root");
    assert_eq!(
        app.composer.text(),
        "a",
        "held typing remains part of the root draft"
    );
}

#[test]
fn foreign_undo_repeat_and_pending_modal_input_cannot_restore_a_previous_thread() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.composer.set_vim_enabled(true);
    app.composer.insert("root tail");
    for value in ['0', 'd', 'w'] {
        key(&mut app, value);
    }
    assert_eq!(app.composer.text(), "tail");
    key(&mut app, 'g');
    assert!(app.composer.key_chord_pending());
    handoff(&mut app, "child");
    assert!(app.composer.is_vim_normal_mode());
    assert!(!app.composer.key_chord_pending());
    key(&mut app, 'u');
    key(&mut app, '.');
    assert!(
        app.composer.is_empty(),
        "child must not inherit root undo/repeat"
    );

    app.composer.insert("child text");
    handoff(&mut app, "root");
    assert_eq!(app.composer.text(), "tail");
    key(&mut app, 'u');
    key(&mut app, '.');
    assert_eq!(
        app.composer.text(),
        "tail",
        "restoring a draft does not restore retired edit transactions"
    );
}

#[test]
fn session_linewise_register_survives_editor_replacement_and_thread_draft_recall() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.composer.set_vim_enabled(true);
    app.composer.insert("ROOT_LINE\nroot tail");
    key(&mut app, '0');
    key(&mut app, 'g');
    key(&mut app, 'g');
    key(&mut app, 'Y');
    handoff(&mut app, "child");
    key(&mut app, 'p');
    assert_eq!(
        app.composer.text(),
        "\nROOT_LINE",
        "linewise paste remains below the empty child line"
    );
    app.composer.replace("CHILD_LINE".into());
    key(&mut app, 'Y');
    handoff(&mut app, "root");
    key(&mut app, 'g');
    key(&mut app, 'g');
    key(&mut app, 'p');
    assert_eq!(
        app.composer.text(),
        "ROOT_LINE\nCHILD_LINE\nroot tail",
        "register is session-owned, not rolled back with root draft"
    );
}

#[test]
fn replacement_retains_live_bindings_but_retires_old_editor_chord_and_query() {
    let mut app = App::default();
    app.set_runtime_keymap(
        RuntimeKeymap::from_config(
            &serde_json::from_value(json!({
                "vim_normal": {"delete_char":"f12", "undo":["u", "z u"]},
                "editor": {"kill_whole_line":"ctrl-q k"}
            }))
            .unwrap(),
        )
        .unwrap(),
    );
    app.set_thread_id("root".into());
    app.composer.set_vim_enabled(true);
    app.composer.insert("root");
    key(&mut app, 'z');
    assert!(app.composer.key_chord_pending());
    handoff(&mut app, "child");
    assert!(!app.composer.key_chord_pending());
    app.composer.insert("child");
    key(&mut app, '0');
    key(&mut app, 'x');
    assert_eq!(
        app.composer.text(),
        "child",
        "old default does not return after replacement"
    );
    app.composer
        .handle_key_event(KeyEvent::new(KeyCode::F(12), KeyModifiers::NONE));
    assert_eq!(app.composer.text(), "hild");
    key(&mut app, 'z');
    key(&mut app, 'u');
    assert_eq!(app.composer.text(), "child");
    key(&mut app, '/');
    app.composer.handle_paste("child");
    assert!(app.composer.textarea().vim_search_query().is_some());
    handoff(&mut app, "root");
    assert!(app.composer.textarea().vim_search_query().is_none());
    assert_eq!(app.composer.text(), "root");

    app.composer.set_vim_enabled(false);
    app.composer
        .handle_key_event(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    assert!(app.composer.key_chord_pending());
    handoff(&mut app, "child");
    assert!(!app.composer.key_chord_pending());
    assert_eq!(app.composer.text(), "child");
}
