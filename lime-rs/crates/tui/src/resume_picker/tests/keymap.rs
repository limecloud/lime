use super::*;
use crate::keymap::RuntimeKeymap;
use serde_json::json;

fn picker(value: serde_json::Value) -> PickerState {
    let config = serde_json::from_value(json!({"list": value})).unwrap();
    let mut picker = PickerState::new(
        (0..16)
            .map(|index| thread(&format!("t{index}"), "preview", false))
            .collect(),
        SessionPickerAction::Resume,
        SessionStatus::Active,
        Some("/workspace".into()),
        false,
    );
    picker.set_list_keymap(RuntimeKeymap::from_config(&config).unwrap().list().clone());
    picker.view_rows.set(Some(4));
    picker
}

fn key(picker: &mut PickerState, code: KeyCode, modifiers: KeyModifiers) -> PickerAction {
    picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(code, modifiers)))
}

#[test]
fn configured_pages_jumps_and_options_replace_default_keys() {
    let mut picker = picker(
        json!({"page_down": "ctrl-d", "page_up": "ctrl-u", "jump_top": "ctrl-a", "jump_bottom": "ctrl-y", "move_left": "f6", "move_right": "f7"}),
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected, 4);
    assert_eq!(
        key(&mut picker, KeyCode::PageDown, KeyModifiers::NONE),
        PickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('y'), KeyModifiers::CONTROL),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected, 15);
    assert_eq!(
        key(&mut picker, KeyCode::Char('u'), KeyModifiers::CONTROL),
        PickerAction::MoveUp
    );
    assert_eq!(picker.selected, 11);
    assert_eq!(
        key(&mut picker, KeyCode::Char('a'), KeyModifiers::CONTROL),
        PickerAction::MoveUp
    );
    assert_eq!(
        picker.selected, 0,
        "configured jump_top takes precedence over archive"
    );
    assert_eq!(
        key(&mut picker, KeyCode::Left, KeyModifiers::NONE),
        PickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::F(7), KeyModifiers::NONE),
        PickerAction::ToggleFilter
    );
    key(&mut picker, KeyCode::Tab, KeyModifiers::NONE);
    assert_eq!(
        key(&mut picker, KeyCode::F(6), KeyModifiers::NONE),
        PickerAction::ToggleStatus
    );
}

#[test]
fn search_text_and_removed_toolbar_shortcuts_do_not_trigger_navigation() {
    let mut picker = picker(json!({"move_up": "k", "move_down": "j"}));
    for code in ['k', 'j'] {
        assert_eq!(
            key(&mut picker, KeyCode::Char(code), KeyModifiers::NONE),
            PickerAction::Reload
        );
    }
    assert_eq!(picker.query, "kj");
    for code in ['s', 'r'] {
        assert_eq!(
            key(&mut picker, KeyCode::Char(code), KeyModifiers::CONTROL),
            PickerAction::None
        );
    }
    assert_eq!(
        key(&mut picker, KeyCode::Char('f'), KeyModifiers::CONTROL),
        PickerAction::MoveDown
    );
    assert_eq!(picker.query, "kj");
    assert!(!picker.show_all);
}

#[test]
fn custom_accept_cancel_chords_preserve_query_priority_and_have_no_hidden_defaults() {
    let mut picker = picker(json!({"accept": "f9", "cancel": "ctrl-x q"}));
    assert_eq!(
        key(&mut picker, KeyCode::Enter, KeyModifiers::NONE),
        PickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Esc, KeyModifiers::NONE),
        PickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::F(9), KeyModifiers::NONE),
        PickerAction::Select
    );
    picker.query = "needle".into();
    assert_eq!(
        key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL),
        PickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
        PickerAction::Reload
    );
    assert_eq!(picker.query, "");
    assert_eq!(
        key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL),
        PickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
        PickerAction::Cancel
    );
}

#[test]
fn configured_page_down_keeps_its_pending_target_and_paste_resets_chord_owner() {
    let mut picker = picker(json!({"page_down": "ctrl-d", "jump_bottom": "ctrl-x y"}));
    picker.threads.truncate(3);
    picker
        .pagination
        .complete_page(Some(PageCursor::AppServer("cursor".into())), 3, false);
    assert_eq!(
        key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL),
        PickerAction::MoveDown
    );
    assert_eq!(picker.pending_page_down_target, Some(4));
    assert_eq!(
        key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL),
        PickerAction::MoveDown
    );
    assert_eq!(picker.pending_page_down_target, Some(4));
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    picker.handle_event(Event::Paste("query".into()));
    assert_eq!(
        key(&mut picker, KeyCode::Char('y'), KeyModifiers::NONE),
        PickerAction::Reload
    );
    assert_eq!(picker.query, "queryy");
    assert_eq!(picker.pending_page_down_target, None);
}

#[test]
fn custom_and_unbound_footer_hints_are_truthful_in_all_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for (config, expected) in [
            (
                json!({"accept":"f9", "cancel":"f10", "move_left":"f6", "move_right":"f7"}),
                true,
            ),
            (
                json!({"accept":[], "cancel":[], "move_left":[], "move_right":[]}),
                false,
            ),
        ] {
            let picker = picker(config);
            let mut terminal = Terminal::new(TestBackend::new(160, 24)).unwrap();
            terminal
                .draw(|frame| render_with_locale(frame, &picker, locale))
                .unwrap();
            let text = buffer_text(&terminal);
            assert_eq!(text.contains("f9"), expected, "{locale:?}: {text}");
            assert_eq!(text.contains("f10"), expected, "{locale:?}: {text}");
            assert_eq!(text.contains("f6/f7"), expected, "{locale:?}: {text}");
            assert!(
                !text.contains("enter") && !text.contains("esc") && !text.contains("←/→"),
                "stale defaults: {text}"
            );
        }
    }
}
