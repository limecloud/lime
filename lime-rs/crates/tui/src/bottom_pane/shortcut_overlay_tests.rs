use super::*;
use crate::keymap::RuntimeKeymap;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use lime_core::config::{KeybindingSpec, KeybindingsSpec, TuiKeymap};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn help_app(locale: Locale) -> App {
    let mut app = App::default();
    app.set_locale(locale);
    app.chat_widget
        .bottom_pane
        .composer
        .handle_key_event(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE));
    app
}

fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn shortcut_overlay_uses_runtime_bindings_and_omits_disabled_actions() {
    let mut app = help_app(Locale::EnUs);
    let mut config = TuiKeymap::default();
    config.global.open_transcript =
        Some(KeybindingsSpec::One(KeybindingSpec("ctrl-x ctrl-t".into())));
    config.pager.find = Some(KeybindingsSpec::One(KeybindingSpec("f6".into())));
    config.pager.page_up = Some(KeybindingsSpec::One(KeybindingSpec("ctrl-x u".into())));
    config.pager.jump_top = Some(KeybindingsSpec::Many(Vec::new()));
    app.set_runtime_keymap(RuntimeKeymap::from_config(&config).expect("keymap"));
    let text = lines(&app, 150)
        .iter()
        .map(Line::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("ctrl+x ctrl+t"), "{text}");
    assert!(text.contains("f6"), "{text}");
    assert!(text.contains("ctrl+x u"), "{text}");
    assert!(!text.contains("home"), "{text}");
    assert!(
        !text.contains("Voice") && !text.contains("Edit last message"),
        "{text}"
    );
    assert!(
        text.contains("tui.keymap") && !text.contains("/keymap"),
        "{text}"
    );
}

#[test]
fn editor_newline_help_renders_actual_binding_and_omits_unbound_action_in_all_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for value in [
            serde_json::json!("f11"),
            serde_json::json!("ctrl-q j"),
            serde_json::json!([]),
            serde_json::json!("enter"),
        ] {
            let mut app = help_app(locale);
            let config: TuiKeymap =
                serde_json::from_value(serde_json::json!({"editor":{"insert_newline":value}}))
                    .unwrap();
            app.set_runtime_keymap(RuntimeKeymap::from_config(&config).unwrap());
            let mut terminal =
                Terminal::new(TestBackend::new(160, desired_height(&app, 160))).unwrap();
            terminal.draw(|f| render(f, f.area(), &app)).unwrap();
            let text = buffer_text(&terminal);
            let compact = |value: &str| {
                value
                    .chars()
                    .filter(|ch| !ch.is_whitespace())
                    .collect::<String>()
            };
            let bound = value.as_str().filter(|value| *value != "enter");
            if let Some(bound) = bound {
                assert!(
                    text.contains(if bound == "f11" { "f11" } else { "ctrl+q j" }),
                    "{locale:?}: {text}"
                );
                assert!(
                    compact(&text).contains(&compact(locale.shortcut_label(Label::NewLine))),
                    "{locale:?}: {text}"
                );
            } else {
                assert!(
                    !compact(&text).contains(&compact(locale.shortcut_label(Label::NewLine))),
                    "unreachable newline hint: {locale:?}: {text}"
                );
            }
            assert!(!text.contains("ctrl+j"), "old hardcoded hint: {text}");
        }
    }
}

#[test]
fn shortcut_overlay_measurement_and_paint_share_localized_responsive_rows() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let app = help_app(locale);
        for width in [8, 28, 80, 160] {
            let measured = lines(&app, width - 1);
            assert!(
                measured
                    .iter()
                    .all(|line| line.width() <= usize::from(width - 1)),
                "{locale:?}/{width}"
            );
            let height = desired_height(&app, width);
            assert_eq!(usize::from(height), measured.len());
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal.draw(|f| render(f, f.area(), &app)).unwrap();
            let text = buffer_text(&terminal);
            let compact = |text: &str| {
                text.chars()
                    .filter(|c| !c.is_whitespace())
                    .collect::<String>()
            };
            assert!(
                compact(&text).contains(&compact(locale.shortcut_label(Label::Title))),
                "{locale:?}/{width}: {text}"
            );
            assert!(compact(&text).contains("tui.keymap"), "{text}");
        }
    }
}

#[test]
fn shortcut_overlay_clipping_preserves_customization_in_small_areas() {
    let app = help_app(Locale::EnUs);
    for height in [1, 4, 10] {
        let mut terminal = Terminal::new(TestBackend::new(28, height)).unwrap();
        terminal.draw(|f| render(f, f.area(), &app)).unwrap();
        assert!(buffer_text(&terminal).contains("tui.keymap"));
    }
}

#[test]
fn shortcuts_stay_above_editable_composer_with_close_hint_on_last_row() {
    for (width, height) in [(80, 28), (40, 12), (12, 8), (2, 3)] {
        let app = help_app(Locale::EnUs);
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|f| crate::view::render(f, &app)).unwrap();
        let text = buffer_text(&terminal);
        let last = text.lines().last().unwrap();
        if width >= 12 {
            assert!(last.contains("esc close"), "{width}/{height}: {text}");
            assert!(text.contains('›'), "composer must remain visible: {text}");
        }
    }
}

#[test]
fn send_and_queue_labels_follow_canonical_active_turn() {
    let mut app = help_app(Locale::EnUs);
    assert!(lines(&app, 160)
        .iter()
        .any(|line| line.to_string().contains("Send message")));
    app.start_turn("canonical-turn".into());
    let text = lines(&app, 160)
        .iter()
        .map(Line::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        text.contains("Queue message") && text.contains("Interrupt"),
        "{text}"
    );
    assert!(!text.contains("canonical-turn"));
}

#[test]
fn a_global_question_mark_binding_owns_routing_and_footer_hint() {
    let mut app = App::default();
    let mut config = TuiKeymap::default();
    config.global.open_agents = Some(KeybindingsSpec::One(KeybindingSpec("?".into())));
    app.set_runtime_keymap(RuntimeKeymap::from_config(&config).unwrap());
    assert!(!toggle_available(&app));
    let mut terminal = Terminal::new(TestBackend::new(80, 20)).unwrap();
    terminal.draw(|f| crate::view::render(f, &app)).unwrap();
    let text = buffer_text(&terminal);
    assert!(text.contains("? for agents"), "{text}");
    assert!(!text.contains("? for shortcuts"), "{text}");
    app.handle_tui_event(
        crate::tui::TuiEvent::Key(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE)),
        true,
    );
    assert!(app.chat_widget.agents_overview.is_some());
    assert!(!app
        .chat_widget
        .bottom_pane
        .composer
        .shortcut_overlay_visible());
}
