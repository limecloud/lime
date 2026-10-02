use super::super::tests::model;
use super::*;
use crossterm::event::KeyEvent;
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn screen(picker: &ModelPicker, locale: Locale, width: u16, height: u16) -> String {
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
fn model_picker_is_borderless_bottom_anchored_and_highlights_current_provider_identity() {
    let picker = ModelPicker::new(vec![
        model("shared", "provider-a", false, true),
        model("shared", "provider-b", false, false),
    ])
    .with_current(Some("shared"), Some("provider-b"));
    assert_eq!(
        picker.selected_model(picker.selected).unwrap().provider,
        "provider-b"
    );
    let text = screen(&picker, Locale::EnUs, 100, 24);
    assert!(text.contains("Select Model and Effort"), "{text}");
    assert!(text.contains("› 2. shared (current)"), "{text}");
    assert!(text.contains("1. shared (default)"), "{text}");
    assert!(
        text.lines().next().unwrap().trim().is_empty(),
        "picker must anchor at bottom: {text}"
    );
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
fn model_picker_does_not_guess_provider_for_shared_model_name() {
    let picker = ModelPicker::new(vec![
        model("shared", "a", false, true),
        model("shared", "b", false, false),
    ])
    .with_current(Some("shared"), None);
    assert_eq!(picker.current, None);
    let picker =
        ModelPicker::new(vec![model("only", "a", false, true)]).with_current(Some("only"), None);
    assert_eq!(picker.current, Some(0));
}

#[test]
fn narrow_wrapped_descriptions_keep_selected_model_visible_and_measure_visual_rows() {
    let models = (0..20)
        .map(|index| {
            let mut model = model(&format!("model-{index:02}"), "fixture", false, index == 0);
            model.description = "中文 description with wrapping details and emoji 🙂 ".repeat(3);
            model
        })
        .collect();
    let mut picker = ModelPicker::new(models);
    picker.selected = 12;
    for width in [12, 28, 80, 120] {
        let text = screen(&picker, Locale::EnUs, width, 20);
        assert!(
            text.contains("model-12") || width == 12,
            "selected row at {width}: {text}"
        );
        assert!(text.contains('›'), "selected marker at {width}: {text}");
        assert!(desired_height(&picker, Locale::EnUs, width) <= 22);
    }
}

#[test]
fn model_picker_query_preserves_graphemes_normalizes_paste_and_keeps_cursor_visible() {
    let mut picker = ModelPicker::default();
    picker.handle_event(Event::Paste("👩‍💻".into()));
    picker.handle_event(Event::Key(KeyEvent::new(
        KeyCode::Backspace,
        KeyModifiers::NONE,
    )));
    assert!(picker.query().is_empty());
    picker.handle_event(Event::Paste(" a\r\nb\tc ".into()));
    assert!(!picker.query().chars().any(char::is_control));
    picker.query = "界🙂".repeat(1000);
    let mut terminal = Terminal::new(TestBackend::new(20, 9)).unwrap();
    terminal
        .draw(|frame| render(frame, frame.area(), &picker, Locale::EnUs))
        .unwrap();
    let cursor = terminal.backend().cursor_position();
    assert!(cursor.x < 20 && cursor.y < 9);
}

#[test]
fn model_picker_title_and_controls_cover_all_locales_and_tiny_areas() {
    let picker = ModelPicker::new(vec![model("fixture", "provider", false, true)]);
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
        assert!(compact(&text).contains(&compact(locale.model_picker_title())));
        assert!(compact(&text).contains(&compact(
            &locale.selection_picker_footer(Some("enter"), Some("esc"))
        )));
        for (width, height) in [(1, 1), (2, 2), (8, 3), (12, 4)] {
            screen(&picker, locale, width, height);
        }
    }
}

#[test]
fn model_picker_page_navigation_clamps_and_empty_filter_cannot_submit() {
    let mut picker = ModelPicker::new(
        (0..20)
            .map(|i| model(&format!("model-{i}"), "fixture", false, i == 0))
            .collect(),
    );
    for _ in 0..5 {
        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::PageDown,
            KeyModifiers::NONE,
        )));
    }
    assert_eq!(picker.selected, 19);
    picker.handle_event(Event::Key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE)));
    assert_eq!(picker.selected, 0);
    picker.handle_event(Event::Paste("not-in-catalog".into()));
    assert_eq!(
        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE
        ))),
        ModelPickerAction::None
    );
    assert!(screen(&picker, Locale::EnUs, 100, 20).contains(Locale::EnUs.picker_empty()));
}

#[test]
fn model_picker_page_step_uses_the_painted_visual_window() {
    let mut picker = ModelPicker::new(
        (0..20)
            .map(|i| {
                let mut model = model(&format!("model-{i:02}"), "fixture", false, i == 0);
                model.description = "long description ".repeat(10);
                model
            })
            .collect(),
    );
    screen(&picker, Locale::EnUs, 28, 12);
    let page = picker.page_rows.get();
    assert!(page < MAX_POPUP_ROWS);
    picker.handle_event(Event::Key(KeyEvent::new(
        KeyCode::PageDown,
        KeyModifiers::NONE,
    )));
    assert_eq!(picker.selected, page);
}

#[test]
fn model_picker_replaces_composer_without_erasing_draft_or_session_settings() {
    let mut app = crate::app::App::default();
    app.set_thread_id("canonical-thread".into());
    app.set_settings(
        Some("current".into()),
        Some("provider".into()),
        Some("high".into()),
        None,
    );
    app.chat_widget.bottom_pane.insert_str("preserved draft");
    app.open_model_picker(vec![
        model("default", "provider", false, true),
        model("current", "provider", false, false),
    ]);
    let mut terminal = Terminal::new(TestBackend::new(100, 20)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    let text = buffer
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>();
    assert!(text.contains("› 2. current (current)"), "{text}");
    assert!(
        !text.contains("preserved draft"),
        "picker replaces the composer surface: {text}"
    );
    app.handle_tui_event(
        crate::tui::TuiEvent::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        true,
    );
    assert!(app.chat_widget.model_picker.is_none());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "preserved draft"
    );
    assert_eq!(app.chat_widget.model.as_deref(), Some("current"));
    assert_eq!(app.chat_widget.model_provider.as_deref(), Some("provider"));
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(app.thread_id.as_deref(), Some("canonical-thread"));
}
