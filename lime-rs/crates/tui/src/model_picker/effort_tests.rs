use super::tests::model;
use super::*;
use app_server_protocol::protocol::v2::ReasoningEffortOption;
use crossterm::event::KeyEvent;
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn preset(id: &str, provider: &str, values: &[&str], default: &str) -> Model {
    let mut model = model(id, provider, false, false);
    model.default_reasoning_effort = default.into();
    model.supported_reasoning_efforts = values
        .iter()
        .map(|value| ReasoningEffortOption {
            reasoning_effort: (*value).into(),
            description: format!("catalog description for {value}"),
        })
        .collect();
    model
}

fn key(picker: &mut ModelPicker, code: KeyCode) -> ModelPickerAction {
    picker.handle_event(Event::Key(KeyEvent::new(code, KeyModifiers::NONE)))
}

fn screen(picker: &ModelPicker, locale: Locale, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| render_with_locale(frame, frame.area(), picker, locale))
        .unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}

#[test]
fn model_accept_opens_effort_without_emitting_a_settings_selection() {
    let mut picker = ModelPicker::new(vec![preset(
        "reasoner",
        "p",
        &["low", "medium", "high"],
        "medium",
    )]);
    assert_eq!(key(&mut picker, KeyCode::Enter), ModelPickerAction::None);
    assert_eq!(picker.selected_row(), 1);
    assert_eq!(key(&mut picker, KeyCode::Down), ModelPickerAction::None);
    assert_eq!(
        key(&mut picker, KeyCode::Enter),
        ModelPickerAction::Select(2)
    );
    assert_eq!(
        picker.selected_model(2),
        Some(ModelSelection {
            model: "reasoner".into(),
            provider: "p".into(),
            effort: Some("high".into())
        })
    );
}

#[test]
fn unsupported_current_effort_anchors_to_the_model_default_not_the_first_row() {
    let mut picker = ModelPicker::new(vec![preset(
        "reasoner",
        "p",
        &["low", "medium", "high"],
        "medium",
    )])
    .with_current(Some("reasoner"), Some("p"))
    .with_current_effort(Some("unsupported"));
    assert_eq!(key(&mut picker, KeyCode::Enter), ModelPickerAction::None);
    assert_eq!(
        picker
            .selected_model(picker.selected_row())
            .unwrap()
            .effort
            .as_deref(),
        Some("medium")
    );
}

#[test]
fn current_effort_only_highlights_the_matching_model_and_provider() {
    let models = vec![
        preset("shared", "a", &["low", "high"], "low"),
        preset("shared", "b", &["low", "high"], "low"),
    ];
    let mut picker = ModelPicker::new(models)
        .with_current(Some("shared"), Some("b"))
        .with_current_effort(Some("high"));
    key(&mut picker, KeyCode::Enter);
    assert_eq!(picker.selected_row(), 1);
    assert_eq!(picker.selected_model(1).unwrap().provider, "b");
    key(&mut picker, KeyCode::Esc);
    key(&mut picker, KeyCode::Up);
    key(&mut picker, KeyCode::Enter);
    assert_eq!(picker.selected_row(), 0);
    assert_eq!(picker.selected_model(0).unwrap().provider, "a");
}

#[test]
fn cancel_child_restores_parent_query_highlight_and_ignores_child_text() {
    let mut picker = ModelPicker::new(vec![preset("reasoner", "p", &["low", "high"], "low")]);
    picker.handle_event(Event::Paste("reas".into()));
    key(&mut picker, KeyCode::Enter);
    picker.handle_event(Event::Paste("must not change the parent query".into()));
    key(&mut picker, KeyCode::Char('x'));
    key(&mut picker, KeyCode::Backspace);
    assert_eq!(picker.query(), "reas");
    assert_eq!(key(&mut picker, KeyCode::Esc), ModelPickerAction::None);
    assert!(picker.effort_menu.is_none());
    assert_eq!(picker.query(), "reas");
    assert_eq!(
        picker.selected_model(picker.selected).unwrap().model,
        "reasoner"
    );
    assert_eq!(key(&mut picker, KeyCode::Esc), ModelPickerAction::Cancel);
}

#[test]
fn default_and_single_effort_select_directly_without_a_hardcoded_value() {
    for (values, default, expected) in [
        (
            vec![],
            "custom-server-default",
            Some("custom-server-default"),
        ),
        (vec!["none"], "medium", Some("none")),
        (vec![], "", None),
        (vec![""], "medium", None),
    ] {
        let mut picker = ModelPicker::new(vec![preset("model", "p", &values, default)]);
        assert_eq!(
            key(&mut picker, KeyCode::Enter),
            ModelPickerAction::Select(0)
        );
        assert!(picker.effort_menu.is_none());
        assert_eq!(
            picker.selected_model(0).unwrap().effort.as_deref(),
            expected
        );
    }
}

#[test]
fn advanced_choices_are_explicit_and_escape_unwinds_one_level_at_a_time() {
    let mut picker = ModelPicker::new(vec![preset(
        "reasoner",
        "p",
        &["low", "ultra", "max"],
        "low",
    )])
    .with_current(Some("reasoner"), Some("p"))
    .with_current_effort(Some("ultra"));
    key(&mut picker, KeyCode::Enter);
    assert_eq!(picker.selected_row(), 1);
    assert!(
        picker.selected_model(1).is_none(),
        "More reasoning is navigation, not a settings value"
    );
    assert_eq!(key(&mut picker, KeyCode::Enter), ModelPickerAction::None);
    assert!(picker.effort_menu.as_ref().unwrap().advanced);
    assert_eq!(picker.selected_row(), 1);
    assert_eq!(
        picker.selected_model(0).unwrap().effort.as_deref(),
        Some("max")
    );
    assert_eq!(
        picker.selected_model(1).unwrap().effort.as_deref(),
        Some("ultra")
    );
    assert_eq!(key(&mut picker, KeyCode::Esc), ModelPickerAction::None);
    assert!(!picker.effort_menu.as_ref().unwrap().advanced);
    assert_eq!(picker.selected_row(), 1);
    assert_eq!(key(&mut picker, KeyCode::Esc), ModelPickerAction::None);
    assert!(picker.effort_menu.is_none());
}

#[test]
fn advanced_only_catalog_still_requires_explicit_effort_acceptance() {
    let mut picker = ModelPicker::new(vec![preset("reasoner", "p", &["ultra"], "ultra")]);
    assert_eq!(key(&mut picker, KeyCode::Enter), ModelPickerAction::None);
    assert_eq!(key(&mut picker, KeyCode::Enter), ModelPickerAction::None);
    assert_eq!(
        key(&mut picker, KeyCode::Enter),
        ModelPickerAction::Select(0)
    );
    assert_eq!(
        picker.selected_model(0).unwrap().effort.as_deref(),
        Some("ultra")
    );
}

#[test]
fn nested_effort_render_reuses_wrapping_and_covers_all_locales_and_short_screens() {
    let mut model = preset("named-model", "p", &["low", "high", "max"], "low");
    model.supported_reasoning_efforts[1].description =
        "中文 wrapped catalog description 🙂 ".repeat(15);
    let mut picker = ModelPicker::new(vec![model]);
    key(&mut picker, KeyCode::Enter);
    key(&mut picker, KeyCode::Down);
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let text = screen(&picker, locale, 100, 20);
        let compact = |text: &str| {
            text.chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>()
        };
        assert!(
            compact(&text).contains(&compact(locale.reasoning_picker_title(false))),
            "{text}"
        );
        assert!(
            compact(&text).contains(&compact(locale.more_reasoning_label())),
            "{text}"
        );
        assert!(text.contains("named-model"), "{text}");
        for (width, height) in [(1, 1), (2, 2), (8, 3), (28, 8), (80, 12)] {
            let text = screen(&picker, locale, width, height);
            if height >= 3 && width >= 8 {
                assert!(
                    text.contains('›'),
                    "selected effort must remain visible: {text}"
                );
            }
        }
    }
}

#[test]
fn app_emits_one_combined_selection_only_after_effort_acceptance() {
    let mut app = crate::app::App::default();
    app.set_thread_id("canonical-thread".into());
    app.chat_widget.bottom_pane.insert_str("preserved draft");
    app.chat_widget.set_settings(
        Some("reasoner".into()),
        Some("p".into()),
        Some("low".into()),
        None,
    );
    app.chat_widget
        .open_model_picker(vec![preset("reasoner", "p", &["low", "high"], "low")]);
    let send = |app: &mut crate::app::App, code| {
        app.handle_tui_event(
            crate::tui::TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)),
            true,
        )
    };
    assert_eq!(send(&mut app, KeyCode::Enter), crate::app::AppAction::None);
    assert_eq!(send(&mut app, KeyCode::Down), crate::app::AppAction::None);
    let crate::app::AppAction::SelectModel(selection) = send(&mut app, KeyCode::Enter) else {
        panic!("effort acceptance must emit a settings action");
    };
    assert_eq!(selection.effort.as_deref(), Some("high"));
    assert_eq!(selection.model, "reasoner");
    assert_eq!(selection.provider, "p");
    assert!(app.chat_widget.model_picker.is_none());
    assert_eq!(
        app.chat_widget.reasoning_effort.as_deref(),
        Some("low"),
        "local settings only change after server success"
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "preserved draft"
    );
    assert_eq!(app.thread_id.as_deref(), Some("canonical-thread"));
}
