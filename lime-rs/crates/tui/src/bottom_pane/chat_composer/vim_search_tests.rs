use super::super::{ChatComposer, InputResult};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn vim_search_query_and_paste_do_not_mutate_the_draft() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.insert("alpha beta");
    composer.handle_key_event(key(KeyCode::Char('/')));
    composer.handle_paste("beta");

    assert_eq!(composer.text(), "alpha beta");
    assert_eq!(
        composer.vim_search_query().map(|(query, _)| query),
        Some("beta")
    );
}

#[test]
fn empty_vim_search_backspace_cancels_without_submission() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.insert("draft");
    composer.handle_key_event(key(KeyCode::Char('/')));

    assert_eq!(
        composer.handle_key_event(key(KeyCode::Backspace)),
        InputResult::Changed
    );
    assert!(!composer.vim_search_active());
    assert_eq!(composer.text(), "draft");
}

#[test]
fn disabling_vim_cancels_an_active_query() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.insert("draft");
    composer.handle_key_event(key(KeyCode::Char('/')));
    assert!(composer.vim_search_active());

    composer.set_vim_enabled(false);

    assert!(!composer.vim_search_active());
}

#[test]
fn empty_vim_slash_enters_insert_and_opens_the_command_popup_through_the_host() {
    use crate::app::{App, AppAction};
    use crate::tui::TuiEvent;
    for kind in [KeyEventKind::Press, KeyEventKind::Repeat] {
        let mut app = App::default();
        app.chat_widget.bottom_pane.composer.set_vim_enabled(true);
        app.chat_widget
            .bottom_pane
            .composer
            .set_paste_burst_disabled(true);
        assert_eq!(
            app.handle_tui_event(
                TuiEvent::Key(KeyEvent::new_with_kind(
                    KeyCode::Char('/'),
                    KeyModifiers::NONE,
                    kind
                )),
                true
            ),
            AppAction::None
        );
        let composer = &app.chat_widget.bottom_pane.composer;
        assert_eq!(composer.text(), "/");
        assert!(!composer.is_vim_normal_mode());
        assert!(!composer.vim_search_active());
        assert!(composer.completion_popup_active());
    }
}

#[test]
fn empty_vim_slash_respects_release_disabled_input_and_explicit_search_bindings() {
    use crate::keymap::RuntimeKeymap;
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.handle_key_event(KeyEvent::new_with_kind(
        KeyCode::Char('/'),
        KeyModifiers::NONE,
        KeyEventKind::Release,
    ));
    assert!(composer.is_empty());
    assert!(composer.is_vim_normal_mode());
    composer.set_input_enabled(false, None);
    composer.handle_key_event(key(KeyCode::Char('/')));
    assert!(composer.is_empty());
    composer.set_input_enabled(true, None);
    for binding in [serde_json::json!([]), serde_json::json!("f9")] {
        composer.set_keymap_bindings(
            &RuntimeKeymap::from_config(
                &serde_json::from_value(serde_json::json!({
                    "vim_search": {"forward": binding}
                }))
                .unwrap(),
            )
            .unwrap(),
        );
        composer.handle_key_event(key(KeyCode::Char('/')));
        assert!(composer.is_empty());
        assert!(composer.is_vim_normal_mode());
        assert!(!composer.vim_search_active());
    }
    composer.handle_key_event(key(KeyCode::F(9)));
    assert!(composer.vim_search_active());
}

#[test]
fn empty_vim_search_chord_keeps_its_query_owner_when_completed_by_slash() {
    use crate::keymap::RuntimeKeymap;
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.set_keymap_bindings(
        &RuntimeKeymap::from_config(
            &serde_json::from_value(serde_json::json!({
                "vim_search": {"forward": "z /"}
            }))
            .unwrap(),
        )
        .unwrap(),
    );
    composer.handle_key_event(key(KeyCode::Char('z')));
    composer.handle_key_event(key(KeyCode::Char('/')));
    assert!(composer.is_empty());
    assert!(composer.is_vim_normal_mode());
    assert!(composer.vim_search_active());
    composer.handle_paste("query");
    assert_eq!(
        composer.vim_search_query().map(|(query, _)| query),
        Some("query")
    );
    assert!(!composer.completion_popup_active());
}
