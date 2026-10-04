use super::tests::model;
use super::*;
use crate::keymap::RuntimeKeymap;
use app_server_protocol::protocol::v2::ReasoningEffortOption;
use crossterm::event::{KeyEvent, KeyEventKind};
use ratatui::{backend::TestBackend, Terminal};
use serde_json::json;

fn configured(value: serde_json::Value) -> ListKeymap {
    let config = serde_json::from_value(json!({"list": value})).unwrap();
    RuntimeKeymap::from_config(&config).unwrap().list().clone()
}

fn key(picker: &mut ModelPicker, code: KeyCode, modifiers: KeyModifiers) -> ModelPickerAction {
    picker.handle_event(Event::Key(KeyEvent::new(code, modifiers)))
}

fn nested() -> ModelPicker {
    let mut model = model("j-reasoner", "p", false, true);
    model.supported_reasoning_efforts = ["low", "medium", "high", "max", "ultra"]
        .into_iter()
        .map(|value| ReasoningEffortOption {
            reasoning_effort: value.into(),
            description: String::new(),
        })
        .collect();
    ModelPicker::new(vec![model]).with_keymap(configured(
        json!({"accept": "f9", "cancel": "ctrl-x q", "page_down": "ctrl-d"}),
    ))
}

#[test]
fn nested_configured_confirmation_and_cancel_replace_hidden_defaults() {
    let mut picker = nested();
    for code in [KeyCode::Enter, KeyCode::Esc] {
        assert_eq!(
            key(&mut picker, code, KeyModifiers::NONE),
            ModelPickerAction::None
        );
        assert!(picker.effort_menu.is_none());
    }
    key(&mut picker, KeyCode::Char('j'), KeyModifiers::NONE);
    assert_eq!(picker.query(), "j");
    key(&mut picker, KeyCode::F(9), KeyModifiers::NONE);
    assert_eq!(picker.selected_row(), 1);
    key(&mut picker, KeyCode::Char('j'), KeyModifiers::NONE);
    assert_eq!(
        picker.selected_row(),
        2,
        "non-search effort uses plain navigation"
    );
    key(&mut picker, KeyCode::Char('j'), KeyModifiers::NONE);
    key(&mut picker, KeyCode::F(9), KeyModifiers::NONE);
    assert!(picker.effort_menu.as_ref().unwrap().advanced);
    assert_eq!(
        key(&mut picker, KeyCode::Esc, KeyModifiers::NONE),
        ModelPickerAction::None
    );
    for advanced in [Some(false), None] {
        key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
        assert_eq!(
            key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
            ModelPickerAction::None
        );
        assert_eq!(
            picker.effort_menu.as_ref().map(|menu| menu.advanced),
            advanced
        );
    }
    assert_eq!(picker.query(), "j");
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE),
        ModelPickerAction::Cancel
    );
}

#[test]
fn configured_pages_and_jumps_use_visible_rows_without_wrapping_or_ctrl_d_exit() {
    let models = (0..12)
        .map(|index| model(&format!("model-{index:02}"), "p", false, index == 0))
        .collect();
    let mut picker = ModelPicker::new(models).with_keymap(configured(json!({"page_down": "ctrl-d", "page_up": "ctrl-u", "jump_bottom": "ctrl-y", "jump_top": "ctrl-a"})));
    picker.page_rows.set(3);
    key(&mut picker, KeyCode::PageDown, KeyModifiers::NONE);
    assert_eq!(picker.selected_row(), 0);
    assert_eq!(
        key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL),
        ModelPickerAction::None
    );
    assert_eq!(picker.selected_row(), 3);
    key(&mut picker, KeyCode::Char('y'), KeyModifiers::CONTROL);
    assert_eq!(picker.selected_row(), 11);
    key(&mut picker, KeyCode::Char('d'), KeyModifiers::CONTROL);
    assert_eq!(picker.selected_row(), 11);
    key(&mut picker, KeyCode::Char('u'), KeyModifiers::CONTROL);
    assert_eq!(picker.selected_row(), 8);
    key(&mut picker, KeyCode::Char('a'), KeyModifiers::CONTROL);
    assert_eq!(picker.selected_row(), 0);
    picker.handle_event(Event::Paste("model-01".into()));
    key(&mut picker, KeyCode::Char('y'), KeyModifiers::CONTROL);
    assert_eq!(
        picker.selected_model(picker.selected_row()).unwrap().model,
        "model-01"
    );
}

#[test]
fn chord_ownership_resets_on_resize_paste_and_release_never_confirms() {
    let mut picker = nested();
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    let mut release = KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE);
    release.kind = KeyEventKind::Release;
    assert_eq!(
        picker.handle_event(Event::Key(release)),
        ModelPickerAction::None
    );
    picker.handle_event(Event::Resize(80, 24));
    key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE);
    assert_eq!(picker.query(), "q");
    key(&mut picker, KeyCode::Char('x'), KeyModifiers::CONTROL);
    picker.handle_event(Event::Paste("query".into()));
    key(&mut picker, KeyCode::Char('q'), KeyModifiers::NONE);
    assert_eq!(picker.query(), "qqueryq");
    assert_eq!(
        key(&mut picker, KeyCode::Char('c'), KeyModifiers::CONTROL),
        ModelPickerAction::Cancel
    );
}

#[test]
fn explicit_unbind_removes_defaults_and_numbered_effort_selection_preserves_identity() {
    let mut picker = nested().with_keymap(configured(json!({"accept": [], "cancel": []})));
    assert_eq!(
        key(&mut picker, KeyCode::Enter, KeyModifiers::NONE),
        ModelPickerAction::None
    );
    assert_eq!(
        key(&mut picker, KeyCode::Esc, KeyModifiers::NONE),
        ModelPickerAction::None
    );
    picker = picker.with_keymap(ListKeymap::default());
    key(&mut picker, KeyCode::Enter, KeyModifiers::NONE);
    assert_eq!(
        key(&mut picker, KeyCode::Char('3'), KeyModifiers::NONE),
        ModelPickerAction::Select(2)
    );
    assert_eq!(
        picker.selected_model(2),
        Some(ModelSelection {
            model: "j-reasoner".into(),
            provider: "p".into(),
            effort: Some("high".into())
        })
    );
}

#[test]
fn configured_footer_covers_all_locales_and_narrow_width_without_fake_keys() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [8, 12, 24, 100] {
            let picker = nested();
            let mut terminal = Terminal::new(TestBackend::new(width, 20)).unwrap();
            terminal
                .draw(|frame| render_with_locale(frame, frame.area(), &picker, locale))
                .unwrap();
            let buffer = terminal.backend().buffer();
            let footer = (0..width)
                .map(|x| buffer[(x, 19)].symbol())
                .collect::<String>();
            assert!(
                !footer.contains("enter") && !footer.contains("esc"),
                "{locale:?}/{width}: {footer}"
            );
            if width == 100 {
                let compact = |text: &str| {
                    text.chars()
                        .filter(|c| !c.is_whitespace())
                        .collect::<String>()
                };
                assert!(
                    compact(&footer).contains(&compact(
                        &locale.selection_picker_footer(Some("f9"), Some("ctrl+x q"))
                    )),
                    "{footer}"
                );
            } else if width == 8 {
                assert!(footer.contains("f9"), "shortest actionable key: {footer}");
            } else {
                assert!(
                    footer.contains("ctrl+x q"),
                    "narrow actionable footer: {footer}"
                );
            }
        }
    }
}

#[test]
fn app_open_model_picker_consumes_the_startup_list_snapshot() {
    let config =
        serde_json::from_value(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}})).unwrap();
    let mut app = crate::app::App::default();
    app.set_thread_id("thread".into());
    app.set_runtime_keymap(RuntimeKeymap::from_config(&config).unwrap());
    app.chat_widget
        .open_model_picker(vec![model("only", "p", false, true)]);
    let picker = app.chat_widget.model_picker.as_mut().unwrap();
    assert_eq!(
        key(picker, KeyCode::Enter, KeyModifiers::NONE),
        ModelPickerAction::None
    );
    assert_eq!(
        key(picker, KeyCode::F(9), KeyModifiers::NONE),
        ModelPickerAction::Select(0)
    );
}
