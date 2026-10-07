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

fn footer(picker: &PickerState, locale: Locale, width: u16, height: u16) -> Terminal<TestBackend> {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| render_picker_footer(frame, frame.area(), picker, locale))
        .unwrap();
    terminal
}

#[test]
fn resume_primary_chords_have_an_explicit_action_separator() {
    let picker = picker(json!({"accept":"ctrl-x a", "cancel":"ctrl-x q"}));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let terminal = footer(&picker, locale, 19, 3);
        let text = buffer_text(&terminal);
        let primary = text.lines().nth(1).unwrap().trim();
        assert!(primary.contains("ctrl+x q"), "{locale:?}: {primary}");
        assert!(
            !primary.contains("ctrl+x a") || primary.contains('·'),
            "two actions must not read as one chord: {locale:?}: {primary}"
        );
        assert!(!primary.contains('…'), "{locale:?}: {primary}");
    }
}

#[test]
fn resume_empty_and_loading_results_do_not_advertise_accept() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for action in [SessionPickerAction::Resume, SessionPickerAction::Fork] {
            for status in [SessionStatus::Active, SessionStatus::Archived] {
                let mut picker = picker(json!({"accept":"f9", "cancel":"ctrl-x q"}));
                picker.action = action;
                picker.status = status;
                picker.threads.clear();
                for loading in [false, true] {
                    picker.loading = loading;
                    for height in [1, 3] {
                        let text = buffer_text(&footer(&picker, locale, 100, height));
                        assert!(!text.contains("f9"), "{locale:?}: {text}");
                        assert!(text.contains("ctrl+x q"), "{locale:?}: {text}");
                    }
                }
            }
        }
    }
}

#[test]
fn resume_secondary_hints_never_clip_configured_or_fixed_shortcuts() {
    let picker = picker(json!({"move_left":"ctrl-x l", "move_right":"ctrl-x r"}));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in 2..=200 {
            let terminal = footer(&picker, locale, width, 3);
            let text = buffer_text(&terminal);
            let secondary = text.lines().nth(2).unwrap().trim();
            assert!(
                !secondary.contains('…'),
                "action hints must be selected whole: {locale:?} width={width}: {secondary}"
            );
            if secondary.contains("ctrl+x") {
                assert!(
                    secondary.contains("ctrl+x l/ctrl+x r"),
                    "partial option chord: {locale:?} width={width}: {secondary}"
                );
            }
            for key in ["ctrl+c", "ctrl+o", "ctrl+t", "ctrl+e"] {
                if secondary.ends_with(&key[..key.len() - 1]) {
                    panic!("partial fixed key: {locale:?} width={width}: {secondary}");
                }
            }
        }
        let text = buffer_text(&footer(&picker, locale, 240, 3));
        for key in [
            "tab",
            "ctrl+x l/ctrl+x r",
            "ctrl+c",
            "ctrl+o",
            "ctrl+t",
            "ctrl+e",
        ] {
            assert!(
                text.contains(key),
                "wide footer lost {key}: {locale:?}: {text}"
            );
        }
    }
}

#[test]
fn resume_short_footer_paints_the_same_inset_it_measures() {
    let picker = picker(json!({"accept":[], "cancel":"ctrl-x q"}));
    for height in [1, 3] {
        let terminal = footer(&picker, Locale::EnUs, 10, height);
        let text = buffer_text(&terminal);
        let primary = text.lines().nth(usize::from(height > 1)).unwrap();
        assert_eq!(primary, " ctrl+x q ", "height={height}: {text}");
    }
}

#[test]
fn resume_footer_emphasizes_the_actual_key_separately_from_its_label() {
    let picker = picker(json!({"accept":"f9", "cancel":"ctrl-x q"}));
    let terminal = footer(&picker, Locale::EnUs, 100, 3);
    let buffer = terminal.backend().buffer();
    for x in 1..3 {
        assert!(buffer[(x, 1)].modifier.contains(Modifier::BOLD));
    }
    assert_eq!(buffer[(4, 1)].symbol(), "r");
    assert!(!buffer[(4, 1)].modifier.contains(Modifier::BOLD));
}

#[test]
fn resume_short_accept_survives_an_unbound_or_oversized_cancel() {
    for cancel in [json!([]), json!("ctrl-x q")] {
        let picker = picker(json!({"accept":"f9", "cancel":cancel}));
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for height in [1, 3] {
                let text = buffer_text(&footer(&picker, locale, 4, height));
                let primary = text.lines().nth(usize::from(height > 1)).unwrap();
                assert_eq!(primary, " f9 ", "{locale:?}: {text}");
            }
        }
    }
}

#[test]
fn resume_option_hint_matches_the_focused_controls_real_action() {
    for config in [
        json!({"move_left":"f6", "move_right":[]}),
        json!({"move_left":[], "move_right":"f7"}),
        json!({"move_left":[], "move_right":[]}),
    ] {
        let mut picker = picker(config);
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for action in [
                crate::keymap::ListAction::MoveLeft,
                crate::keymap::ListAction::MoveRight,
            ] {
                if let Some(key) = picker.list_keymap.primary_hint(action) {
                    let text = buffer_text(&footer(&picker, locale, 240, 3));
                    assert!(text.contains(&key), "{locale:?}: {text}");
                }
            }
            picker.filter_cwd = None;
            picker.toolbar_focus = ToolbarControl::Filter;
            let secondary = footer_hint_lines(&picker, locale, 240)[1].to_string();
            assert!(
                !secondary.contains("f6") && !secondary.contains("f7"),
                "{locale:?}: {secondary}"
            );
            picker.filter_cwd = Some("/workspace".into());
        }
    }
}
