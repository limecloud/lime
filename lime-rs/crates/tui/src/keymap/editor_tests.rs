use super::*;
use serde_json::json;

fn runtime(value: serde_json::Value) -> Result<RuntimeKeymap, String> {
    RuntimeKeymap::from_config(&serde_json::from_value(value).unwrap())
}

#[test]
fn editor_alternatives_chords_and_unbind_have_no_default_backdoor() {
    let keymap =
        runtime(json!({"editor": {"move_left": ["f9", "ctrl-q h"], "delete_backward": []}}))
            .unwrap();
    let editor = &keymap.editor;
    let mut matcher = KeyChordMatcher::default();
    assert_eq!(
        editor.dispatch(
            &mut matcher,
            KeyEvent::new(KeyCode::F(9), KeyModifiers::NONE)
        ),
        KeymapMatch::Completed(EditorAction::MoveLeft)
    );
    for key in [
        KeyEvent::new(KeyCode::Left, KeyModifiers::NONE),
        KeyEvent::new(KeyCode::Char('b'), KeyModifiers::CONTROL),
        KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE),
    ] {
        assert_eq!(
            editor.dispatch(&mut matcher, key),
            KeymapMatch::PassThrough,
            "explicit override: {key:?}"
        );
    }
    assert_eq!(
        editor.dispatch(
            &mut matcher,
            KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL)
        ),
        KeymapMatch::Pending
    );
    assert_eq!(
        editor.dispatch(
            &mut matcher,
            KeyEvent::new(KeyCode::Char('h'), KeyModifiers::NONE)
        ),
        KeymapMatch::Completed(EditorAction::MoveLeft)
    );
    assert_eq!(
        editor.dispatch(
            &mut matcher,
            KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL)
        ),
        KeymapMatch::Pending
    );
    assert_eq!(
        editor.dispatch(
            &mut matcher,
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
        ),
        KeymapMatch::Cancelled
    );
    assert!(!matcher.is_pending());
}

#[test]
fn editor_conflicts_include_main_surface_shadowing_and_reserved_host_keys() {
    for (config, expected) in [
        (json!({"editor":{"move_left":"ctrl-h"}}), "delete_backward"),
        (
            json!({"editor":{"move_left":"ctrl-q", "move_right":"ctrl-q l"}}),
            "overlap",
        ),
        (json!({"editor":{"move_left":"x h"}}), "ordinary text input"),
        (
            json!({"editor":{"move_left":"ctrl-t"}}),
            "global.open_transcript",
        ),
        (
            json!({"global":{"find_transcript":"ctrl-q f"}, "editor":{"move_left":"ctrl-q h"}}),
            "global.find_transcript",
        ),
        (json!({"editor":{"move_left":"ctrl-c"}}), "reserved"),
        (json!({"editor":{"insert_newline":"f8"}}), "reserved"),
        (json!({"editor":{"move_left":"enter"}}), "overlap"),
    ] {
        let error = runtime(config.clone()).unwrap_err();
        assert!(error.contains(expected), "config={config} error={error}");
    }
    // A configured global key must explicitly release the overlapping editor default.
    assert!(
        runtime(json!({"global":{"open_agents":"ctrl-n"}, "editor":{"move_down":"down"}})).is_ok()
    );
}

#[test]
fn raw_control_aliases_and_releases_use_the_same_matcher() {
    let editor = EditorKeymap::default();
    let mut matcher = KeyChordMatcher::default();
    assert_eq!(
        editor.dispatch(
            &mut matcher,
            KeyEvent::new(KeyCode::Char('\u{1}'), KeyModifiers::NONE)
        ),
        KeymapMatch::Completed(EditorAction::MoveLineStart)
    );
    let mut key = KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE);
    key.kind = KeyEventKind::Release;
    assert_eq!(editor.dispatch(&mut matcher, key), KeymapMatch::PassThrough);
    assert!(!editor.owns_key(&matcher, key));
}
