use super::*;
use lime_core::config::{KeybindingSpec, KeybindingsSpec};

fn one(spec: &str) -> KeybindingsSpec {
    KeybindingsSpec::One(KeybindingSpec(spec.to_string()))
}

fn many(specs: &[&str]) -> KeybindingsSpec {
    KeybindingsSpec::Many(
        specs
            .iter()
            .map(|spec| KeybindingSpec((*spec).to_string()))
            .collect(),
    )
}

#[test]
fn codex_transcript_defaults_and_hints_share_one_owner() {
    let keymap = RuntimeKeymap::default();
    let transcript = keymap.transcript();
    assert!(transcript.open_transcript(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL,)));
    assert!(transcript.find_transcript(KeyEvent::new(KeyCode::F(3), KeyModifiers::NONE,)));
    assert!(!transcript.find_transcript(KeyEvent::new(KeyCode::Char('f'), KeyModifiers::CONTROL,)));
    assert_eq!(transcript.pager_find_hint(), "f3·/");
    assert_eq!(transcript.pager_page_down_hint(), "pgdn·space·ctrl+f");
    assert_eq!(transcript.pager_close_hint(), "ctrl+t·esc·q");
    assert_eq!(transcript.open_transcript_hint().as_deref(), Some("ctrl+t"));
}

#[test]
fn queued_input_edit_dispatch_and_label_share_one_binding() {
    assert!(queued_input_edit_matches(KeyEvent::new(
        KeyCode::Up,
        KeyModifiers::ALT,
    )));
    assert!(!queued_input_edit_matches(KeyEvent::new(
        KeyCode::Up,
        KeyModifiers::NONE,
    )));
    assert!(!queued_input_edit_matches(KeyEvent::new(
        KeyCode::Down,
        KeyModifiers::ALT,
    )));
    assert_eq!(queued_input_edit_shortcut_label(), "⌥↑");
}

#[test]
fn custom_chord_alternatives_dispatch_and_update_hints() {
    let mut config = TuiKeymap::default();
    config.global.find_transcript = Some(many(&["f6", "ctrl-x f"]));
    config.pager.find = Some(many(&["f7", "ctrl-x f"]));
    let runtime = RuntimeKeymap::from_config(&config).expect("valid custom keymap");
    let mut matcher = KeyChordMatcher::default();
    assert_eq!(
        runtime.transcript().dispatch_global(
            &mut matcher,
            KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL),
        ),
        KeymapMatch::Pending
    );
    assert_eq!(
        runtime.transcript().dispatch_global(
            &mut matcher,
            KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE),
        ),
        KeymapMatch::Completed(GlobalKeymapAction::FindTranscript)
    );
    assert_eq!(runtime.transcript().pager_find_hint(), "f7·ctrl+x f");
}

#[test]
fn explicit_empty_bindings_do_not_fall_back_to_defaults() {
    let mut config = TuiKeymap::default();
    config.global.open_transcript = Some(KeybindingsSpec::Many(Vec::new()));
    config.pager.page_down = Some(KeybindingsSpec::Many(Vec::new()));
    let runtime = RuntimeKeymap::from_config(&config).expect("explicit unbind is valid");
    let mut global = KeyChordMatcher::default();
    assert_eq!(
        runtime.transcript().dispatch_global(
            &mut global,
            KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL),
        ),
        KeymapMatch::PassThrough
    );
    assert_eq!(runtime.transcript().pager_page_down_hint(), "");
    assert_eq!(runtime.transcript().open_transcript_hint(), None);
}

#[test]
fn conflicts_and_plain_chord_prefixes_fail_closed() {
    let mut config = TuiKeymap::default();
    config.global.open_transcript = Some(one("f6"));
    config.global.find_transcript = Some(one("f6"));
    let duplicate = RuntimeKeymap::from_config(&config).expect_err("duplicate key must fail");
    assert!(duplicate.contains("open_transcript"));
    assert!(duplicate.contains("find_transcript"));

    config.global.find_transcript = Some(one("f7"));
    config.global.open_transcript = Some(one("x f"));
    let printable = RuntimeKeymap::from_config(&config).expect_err("typing prefix must fail");
    assert!(printable.contains("ordinary text input"));
}

#[test]
fn codex_agents_defaults_are_stable() {
    let keymap = RuntimeKeymap::default();
    let agents = keymap.agents();
    assert!(agents.resume(KeyEvent::new(KeyCode::Char('o'), KeyModifiers::NONE,)));
    assert!(agents.search(KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE,)));
    assert!(agents.new_task(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE,)));
    assert!(agents.rename(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE,)));
    assert!(agents.stop(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE,)));
    assert!(agents.toggle_grouping(KeyEvent::new(KeyCode::Char('g'), KeyModifiers::NONE,)));
    assert_eq!(
        agents.primary_hint(AgentsKeymapAction::NewTask).as_deref(),
        Some("n")
    );
    assert!(!agents.new_task(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::CONTROL)));
    assert!(!agents.search(KeyEvent::new(KeyCode::Char('f'), KeyModifiers::CONTROL)));
}

#[test]
fn codex_editor_control_aliases_are_routed_to_textarea() {
    let keymap = RuntimeKeymap::default();
    for character in [
        'a', 'b', 'e', 'f', 'h', 'j', 'k', 'm', 'n', 'p', 'u', 'w', 'y',
    ] {
        assert!(keymap.editor.owns_key(
            &KeyChordMatcher::default(),
            KeyEvent::new(KeyCode::Char(character), KeyModifiers::CONTROL,)
        ));
    }
    assert!(!keymap.editor.owns_key(
        &KeyChordMatcher::default(),
        KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,)
    ));
}
