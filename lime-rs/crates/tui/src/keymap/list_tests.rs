use super::*;
use serde_json::json;

fn configured(value: serde_json::Value) -> Result<ListKeymap, String> {
    let config: TuiListKeymap = serde_json::from_value(value).unwrap();
    ListKeymap::from_config(&config)
}

fn key(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
    KeyEvent::new(code, modifiers)
}

#[test]
fn searchable_list_hints_skip_printable_navigation_that_belongs_to_the_query() {
    let list = configured(json!({"move_left": ["h", "f7"], "move_right": "l"})).unwrap();
    assert_eq!(
        list.primary_searchable_hint(ListAction::MoveLeft)
            .as_deref(),
        Some("f7")
    );
    assert_eq!(list.primary_searchable_hint(ListAction::MoveRight), None);
    assert_eq!(
        list.primary_searchable_hint(ListAction::Accept).as_deref(),
        Some("enter")
    );
}

#[test]
fn defaults_route_modified_navigation_and_keep_plain_text_searchable() {
    let list = ListKeymap::default();
    let mut matcher = KeyChordMatcher::default();
    for (code, modifiers, action) in [
        (KeyCode::Up, KeyModifiers::NONE, ListAction::MoveUp),
        (
            KeyCode::Char('p'),
            KeyModifiers::CONTROL,
            ListAction::MoveUp,
        ),
        (
            KeyCode::Char('k'),
            KeyModifiers::CONTROL,
            ListAction::MoveUp,
        ),
        (
            KeyCode::Char('f'),
            KeyModifiers::CONTROL,
            ListAction::PageDown,
        ),
        (
            KeyCode::Char('h'),
            KeyModifiers::CONTROL,
            ListAction::MoveLeft,
        ),
        (
            KeyCode::Char('l'),
            KeyModifiers::CONTROL,
            ListAction::MoveRight,
        ),
        (KeyCode::Enter, KeyModifiers::NONE, ListAction::Accept),
        (KeyCode::Esc, KeyModifiers::NONE, ListAction::Cancel),
    ] {
        assert_eq!(
            list.dispatch(&mut matcher, key(code, modifiers), true),
            KeymapMatch::Completed(action)
        );
    }
    for character in ['j', 'k'] {
        assert_eq!(
            list.dispatch(
                &mut matcher,
                key(KeyCode::Char(character), KeyModifiers::NONE),
                true
            ),
            KeymapMatch::PassThrough
        );
    }
    assert_eq!(
        list.primary_hint(ListAction::PageDown).as_deref(),
        Some("pgdn")
    );
}

#[test]
fn custom_chords_alternatives_and_unbinds_share_dispatch_and_hints() {
    let list = configured(json!({"page_down": ["ctrl-x d", "ctrl-d"], "accept": "f9", "cancel": [], "move_down": "j"})).unwrap();
    let mut matcher = KeyChordMatcher::default();
    assert_eq!(
        list.primary_hint(ListAction::PageDown).as_deref(),
        Some("ctrl+x d")
    );
    assert_eq!(list.primary_hint(ListAction::Accept).as_deref(), Some("f9"));
    assert_eq!(list.primary_hint(ListAction::Cancel), None);
    assert_eq!(
        list.dispatch(
            &mut matcher,
            key(KeyCode::Char('x'), KeyModifiers::CONTROL),
            true
        ),
        KeymapMatch::Pending
    );
    assert_eq!(
        list.dispatch(
            &mut matcher,
            key(KeyCode::Char('d'), KeyModifiers::NONE),
            true
        ),
        KeymapMatch::Completed(ListAction::PageDown)
    );
    assert_eq!(
        list.dispatch(
            &mut matcher,
            key(KeyCode::Char('d'), KeyModifiers::CONTROL),
            true
        ),
        KeymapMatch::Completed(ListAction::PageDown)
    );
    for code in [
        KeyCode::PageDown,
        KeyCode::Enter,
        KeyCode::Esc,
        KeyCode::Char('j'),
    ] {
        assert_eq!(
            list.dispatch(&mut matcher, key(code, KeyModifiers::NONE), true),
            KeymapMatch::PassThrough
        );
    }
}

#[test]
fn conflicting_prefixes_and_unreachable_picker_bindings_fail_closed() {
    for value in [
        json!({"page_down": "ctrl-d", "page_up": "ctrl-d"}),
        json!({"page_down": "ctrl-x", "page_up": "ctrl-x u"}),
        json!({"page_down": "x d"}),
        json!({"page_down": "ctrl-t"}),
        json!({"accept": "ctrl-o x"}),
        json!({"move_down": "shift-tab"}),
    ] {
        assert!(
            configured(value.clone()).is_err(),
            "invalid list bindings: {value}"
        );
    }
}

#[test]
fn cancelled_chords_and_release_events_do_not_replay_to_the_query() {
    let list = configured(json!({"page_down": "ctrl-x d"})).unwrap();
    let mut matcher = KeyChordMatcher::default();
    assert_eq!(
        list.dispatch(
            &mut matcher,
            key(KeyCode::Char('x'), KeyModifiers::CONTROL),
            true
        ),
        KeymapMatch::Pending
    );
    let mut release = key(KeyCode::Char('d'), KeyModifiers::NONE);
    release.kind = KeyEventKind::Release;
    assert_eq!(
        list.dispatch(&mut matcher, release, true),
        KeymapMatch::PassThrough
    );
    assert_eq!(
        list.dispatch(
            &mut matcher,
            key(KeyCode::Char('q'), KeyModifiers::NONE),
            true
        ),
        KeymapMatch::Cancelled
    );
    assert_eq!(
        list.dispatch(
            &mut matcher,
            key(KeyCode::Char('d'), KeyModifiers::NONE),
            true
        ),
        KeymapMatch::PassThrough
    );
}
