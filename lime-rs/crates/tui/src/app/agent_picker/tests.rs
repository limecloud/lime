use super::*;
use crate::keymap::RuntimeKeymap;
use crate::multi_agents::SubAgentActivityDisplay;
use crossterm::event::KeyEvent;
use ratatui::{backend::TestBackend, Terminal};
use serde_json::json;

fn picker(count: usize) -> AgentPicker {
    let mut navigation = AgentNavigationState::default();
    for index in 0..count {
        navigation.upsert(
            format!("thread-{index:02}"),
            Some(format!("Agent {index:02}")),
            None,
            false,
        );
    }
    AgentPicker::from_navigation(&navigation, Some("thread-00"))
}

fn configured(value: serde_json::Value) -> ListKeymap {
    let config = serde_json::from_value(json!({"list": value})).unwrap();
    RuntimeKeymap::from_config(&config).unwrap().list().clone()
}

fn key(picker: &mut AgentPicker, code: KeyCode, modifiers: KeyModifiers) -> AgentPickerAction {
    picker.handle_event(Event::Key(KeyEvent::new(code, modifiers)))
}

fn screen(picker: &AgentPicker, locale: Locale, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| render(frame, frame.area(), picker, locale))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..height)
        .map(|y| {
            (0..width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn current_thread_defaults_to_its_stable_canonical_row() {
    let mut picker = picker(3).with_current(Some("thread-02"));
    assert_eq!(picker.selected, 2);
    assert_eq!(
        key(&mut picker, KeyCode::Enter, KeyModifiers::NONE),
        AgentPickerAction::Select("thread-02".into())
    );
    let unknown = picker.with_current(Some("unknown"));
    assert_eq!(unknown.current, None);
}

#[test]
fn app_open_consumes_the_startup_keymap_and_current_thread_snapshot() {
    let config =
        serde_json::from_value(json!({"list": {"accept": "f9", "cancel": "ctrl-x q"}})).unwrap();
    let mut app = crate::app::App::default();
    app.set_thread_id("root".into());
    app.set_runtime_keymap(RuntimeKeymap::from_config(&config).unwrap());
    app.open_agent_picker();
    let picker = app.chat_widget.agent_picker.as_mut().expect("root picker");
    assert_eq!(picker.current, Some(picker.selected));
    assert_eq!(
        key(picker, KeyCode::Enter, KeyModifiers::NONE),
        AgentPickerAction::None
    );
    assert_eq!(
        key(picker, KeyCode::F(9), KeyModifiers::NONE),
        AgentPickerAction::Select("root".into())
    );
}

#[test]
fn canonical_child_path_wins_but_primary_keeps_main_name() {
    let mut navigation = AgentNavigationState::default();
    for thread_id in ["main", "child", "blank"] {
        navigation.upsert(
            thread_id,
            Some("nickname".into()),
            Some("worker".into()),
            false,
        );
        navigation.record_sub_agent_activity(SubAgentActivityDisplay {
            thread_id: thread_id.into(),
            agent_path: if thread_id == "blank" {
                "  ".into()
            } else {
                " /root/worker ".into()
            },
            is_running_hint: false,
        });
    }
    let picker =
        AgentPicker::from_navigation(&navigation, Some("main")).with_current(Some("child"));
    assert_eq!(picker.entries[0].label, "Main [default]");
    assert_eq!(picker.entries[1].label, "/root/worker");
    assert!(picker.entries[2].label.contains("nickname"));
    let text = screen(&picker, Locale::EnUs, 100, 24);
    assert!(text.contains("Subagents"), "{text}");
    assert!(text.contains("› 2. • /root/worker (current)"), "{text}");
    assert!(text.contains("child"), "{text}");
    assert!(
        text.contains("Select an agent to watch. ⌥← previous, ⌥→ next."),
        "{text}"
    );
    assert!(text.lines().next().unwrap().trim().is_empty(), "{text}");
    assert!(
        text.lines()
            .last()
            .unwrap()
            .contains("enter select · esc back"),
        "{text}"
    );
    assert!(!text.chars().any(|c| "┌┐└┘│─".contains(c)), "{text}");
}

#[test]
fn status_dot_uses_closed_fact_not_running_hint() {
    let mut picker = picker(2);
    picker.entries[1].is_closed = true;
    let view = picker.view(Locale::EnUs);
    assert_eq!(
        view.entries[0].name_prefix_spans[1].style.fg,
        Some(ratatui::style::Color::Green)
    );
    assert_eq!(view.entries[1].name_prefix_spans[1].style.fg, None);
    assert!(view.entries.iter().all(|row| row.description.is_some()));
}

#[test]
fn subagents_replaces_composer_without_erasing_draft_settings_or_thread() {
    let mut app = crate::app::App::default();
    app.set_thread_id("root".into());
    app.chat_widget.set_settings(
        Some("model".into()),
        Some("provider".into()),
        Some("high".into()),
        None,
    );
    app.chat_widget
        .bottom_pane
        .insert_str("preserved root draft");
    app.open_agent_picker();
    let mut terminal = Terminal::new(TestBackend::new(100, 24)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let text = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>();
    assert!(text.contains("Main [default] (current)"), "{text}");
    assert!(!text.contains("preserved root draft"), "{text}");
    app.handle_tui_event(
        crate::tui::TuiEvent::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        true,
    );
    assert!(app.chat_widget.agent_picker.is_none());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "preserved root draft"
    );
    assert_eq!(app.thread_id.as_deref(), Some("root"));
    assert_eq!(app.chat_widget.model.as_deref(), Some("model"));
    assert_eq!(app.chat_widget.model_provider.as_deref(), Some("provider"));
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("high"));
}

#[test]
fn configured_accept_cancel_and_paging_have_no_hidden_defaults() {
    let mut picker = picker(20).with_keymap(configured(json!({
        "accept": "f9", "cancel": "ctrl-x q", "page_down": "ctrl-d", "page_up": "ctrl-u"
    })));
    for code in [KeyCode::Enter, KeyCode::Esc] {
        assert_eq!(
            key(&mut picker, code, KeyModifiers::NONE),
            AgentPickerAction::None
        );
    }
    screen(&picker, Locale::EnUs, 28, 12);
    let page = picker.page_rows.get();
    assert!(page < MAX_POPUP_ROWS);
    assert_eq!(
        key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL),
        AgentPickerAction::None
    );
    assert_eq!(picker.selected, page);
    key(&mut picker, KeyCode::Char('u'), KeyModifiers::CONTROL);
    assert_eq!(picker.selected, 0);
    key(&mut picker, KeyCode::End, KeyModifiers::NONE);
    assert_eq!(picker.selected, 19);
    key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL);
    assert_eq!(picker.selected, 19);
    assert_eq!(
        key(&mut picker, KeyCode::F(9), KeyModifiers::NONE),
        AgentPickerAction::Select("thread-19".into())
    );
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
        AgentPickerAction::Cancel
    );
}

#[test]
fn default_plain_jk_wrap_and_direct_numbers_match_non_search_lists() {
    let mut picker = picker(3);
    key(&mut picker, KeyCode::Char('k'), KeyModifiers::NONE);
    assert_eq!(picker.selected, 2);
    key(&mut picker, KeyCode::Char('j'), KeyModifiers::NONE);
    assert_eq!(picker.selected, 0);
    assert_eq!(
        key(&mut picker, KeyCode::Char('2'), KeyModifiers::NONE),
        AgentPickerAction::Select("thread-01".into())
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL),
        AgentPickerAction::None
    );
}

#[test]
fn chord_resets_at_non_keyboard_boundaries_and_release_never_accepts() {
    let mut picker = picker(2).with_keymap(configured(json!({"accept": "ctrl-x q"})));
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    picker.handle_event(Event::Resize(80, 24));
    assert_eq!(
        key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
        AgentPickerAction::None
    );
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    let mut released = KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE);
    released.kind = KeyEventKind::Release;
    assert_eq!(
        picker.handle_event(Event::Key(released)),
        AgentPickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
        AgentPickerAction::Select("thread-00".into())
    );
    assert_eq!(
        key(&mut picker, KeyCode::Char('c'), KeyModifiers::CONTROL),
        AgentPickerAction::Cancel
    );
}

#[test]
fn unbound_controls_and_alternatives_are_truthful_in_every_locale() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let picker = picker(2).with_keymap(configured(
            json!({"accept": ["f9", "ctrl-x a"], "cancel": "ctrl-x q"}),
        ));
        let text = screen(&picker, locale, 100, 24);
        let compact = |value: &str| {
            value
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>()
        };
        assert!(
            compact(&text).contains(&compact(locale.agent_picker_title())),
            "{locale:?}: {text}"
        );
        assert!(
            text.contains("f9") && text.contains("ctrl+x q"),
            "{locale:?}: {text}"
        );
        assert!(
            !text.contains("enter") && !text.contains("esc"),
            "{locale:?}: {text}"
        );
        let text = screen(&picker, locale, 8, 9);
        assert!(text.lines().last().unwrap().contains("f9"), "{text}");
        for (width, height) in [(1, 1), (2, 2), (8, 3), (12, 4)] {
            screen(&picker, locale, width, height);
        }
    }
    let mut picker = picker(2).with_keymap(configured(json!({"accept": [], "cancel": []})));
    let text = screen(&picker, Locale::EnUs, 100, 24);
    assert!(text.lines().last().unwrap().trim().is_empty(), "{text}");
    assert_eq!(
        key(&mut picker, KeyCode::Enter, KeyModifiers::NONE),
        AgentPickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Esc, KeyModifiers::NONE),
        AgentPickerAction::None
    );
}

#[test]
fn wrapped_long_catalog_keeps_selected_agent_in_actual_viewport() {
    let mut picker = picker(20).with_current(Some("thread-12"));
    for width in [12, 28, 80, 120] {
        let text = screen(&picker, Locale::EnUs, width, 20);
        assert!(text.contains("Agent 12") || width == 12, "{width}: {text}");
        assert!(text.contains('›'), "{width}: {text}");
        let page = picker.page_rows.get();
        key(&mut picker, KeyCode::PageDown, KeyModifiers::NONE);
        assert_eq!(picker.selected, (12 + page).min(19));
        picker.selected = 12;
    }
}

#[test]
fn empty_list_does_not_submit_or_advertise_a_hardcoded_escape() {
    let mut picker = picker(0).with_keymap(configured(json!({"cancel": "ctrl-x q"})));
    assert_eq!(
        key(&mut picker, KeyCode::Enter, KeyModifiers::NONE),
        AgentPickerAction::None
    );
    let text = screen(&picker, Locale::EnUs, 100, 24);
    assert!(text.contains("No sub-agents available"), "{text}");
    assert!(text.contains("ctrl+x q"), "{text}");
    assert!(!text.contains("Esc"), "{text}");
}

#[test]
fn narrow_picker_footer_separates_whole_chords_and_preserves_one_sided_bindings() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for (accept, cancel) in [(true, true), (true, false), (false, true), (false, false)] {
            let picker = picker(2).with_keymap(configured(json!({
                "accept": if accept { json!("ctrl-x a") } else { json!([]) },
                "cancel": if cancel { json!("ctrl-x q") } else { json!([]) }
            })));
            for content_width in 0..70 {
                let text = screen(&picker, locale, content_width + 4, 16);
                let footer = text.lines().last().unwrap().trim();
                assert!(
                    !footer.contains('…'),
                    "{locale:?}/{content_width}: {footer}"
                );
                assert!(
                    !footer.contains("enter") && !footer.contains("esc"),
                    "{footer}"
                );
                assert!(
                    !footer.contains("ctrl+x a ctrl+x q"),
                    "ambiguous chord list: {footer}"
                );
                if footer.contains("ctrl+x a") {
                    assert!(accept, "unbound accept: {footer}");
                }
                if footer.contains("ctrl+x q") {
                    assert!(cancel, "unbound cancel: {footer}");
                }
                if footer.contains("ctrl+x") {
                    assert!(
                        footer.contains("ctrl+x a") || footer.contains("ctrl+x q"),
                        "partial chord: {footer}"
                    );
                }
                if content_width == 8 && (accept || cancel) {
                    assert_eq!(
                        footer,
                        if cancel { "ctrl+x q" } else { "ctrl+x a" },
                        "{locale:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn empty_picker_footer_only_advertises_executable_cancel() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut picker = picker(0).with_keymap(configured(json!({"accept": "f9", "cancel": "f8"})));
        let text = screen(&picker, locale, 100, 16);
        let footer = text.lines().last().unwrap();
        assert!(
            !footer.contains("f9") && footer.contains("f8"),
            "{locale:?}: {footer}"
        );
        assert_eq!(
            key(&mut picker, KeyCode::F(9), KeyModifiers::NONE),
            AgentPickerAction::None
        );
        assert_eq!(
            key(&mut picker, KeyCode::F(8), KeyModifiers::NONE),
            AgentPickerAction::Cancel
        );
    }
}

#[test]
fn picker_footer_distinguishes_keyboard_tokens_from_localized_labels() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let picker = picker(2).with_keymap(configured(json!({"accept":"f9", "cancel":"f8"})));
        let mut terminal = Terminal::new(TestBackend::new(100, 16)).unwrap();
        terminal
            .draw(|frame| render(frame, frame.area(), &picker, locale))
            .unwrap();
        let buffer = terminal.backend().buffer();
        assert_eq!(buffer[(2, 15)].symbol(), "f", "{locale:?}");
        assert!(
            buffer[(2, 15)]
                .modifier
                .contains(ratatui::style::Modifier::BOLD),
            "key lost emphasis: {locale:?}"
        );
        assert!(
            !buffer[(5, 15)]
                .modifier
                .contains(ratatui::style::Modifier::BOLD),
            "label competes with shortcut: {locale:?}"
        );
    }
}
