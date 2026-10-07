//! Export surface behavior is exercised through the real ChatWidget/App input boundary.

use std::path::PathBuf;

use super::transcript_export::{ExportPicker, ExportPickerAction};
use crate::app::{App, AppAction};
use crate::keymap::RuntimeKeymap;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{
    ItemCompletedNotification, ServerNotification, ThreadItem,
};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use serde_json::json;

fn key(app: &mut App, code: KeyCode, modifiers: KeyModifiers) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, modifiers)), true)
}

fn app(config: serde_json::Value) -> App {
    let mut app = App::default();
    let config = serde_json::from_value(config).unwrap();
    app.set_runtime_keymap(RuntimeKeymap::from_config(&config).unwrap());
    app.chat_widget.bottom_pane.insert_str("/export");
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    app
}

fn screen(app: &App, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, app))
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
fn export_destination_consumes_configured_keys_without_hidden_defaults() {
    let mut app = app(json!({"list":{"accept":"f9", "cancel":"ctrl-x q", "move_down":"f7"}}));
    for code in [
        KeyCode::Enter,
        KeyCode::Esc,
        KeyCode::Down,
        KeyCode::Char('j'),
    ] {
        assert_eq!(key(&mut app, code, KeyModifiers::NONE), AppAction::None);
        assert!(
            app.chat_widget.export_picker.is_some(),
            "unbound {code:?} dismissed export"
        );
    }
    assert_eq!(
        key(&mut app, KeyCode::F(9), KeyModifiers::NONE),
        AppAction::ExportTranscript { path: None }
    );
    assert!(app.chat_widget.export_picker.is_none());
}

#[test]
fn export_destination_shows_the_real_keys_in_all_product_locales() {
    let mut app = app(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        app.set_locale(locale);
        let text = screen(&app, 100, 24);
        assert!(
            text.contains("f9") && text.contains("ctrl+x q"),
            "{locale:?}: {text}"
        );
        assert!(
            !text.contains("enter") && !text.contains("Enter") && !text.contains("Esc"),
            "{locale:?}: {text}"
        );
    }
}

#[test]
fn export_filename_pending_editor_chord_owns_enter_before_save() {
    let mut app = app(json!({"editor":{"kill_whole_line":"ctrl-q enter", "delete_forward":[]}}));
    key(&mut app, KeyCode::Down, KeyModifiers::NONE);
    key(&mut app, KeyCode::Enter, KeyModifiers::NONE);
    assert!(app
        .chat_widget
        .export_picker
        .as_ref()
        .unwrap()
        .is_filename_prompt());
    assert_eq!(
        key(&mut app, KeyCode::Char('d'), KeyModifiers::CONTROL),
        AppAction::None
    );
    assert!(
        app.chat_widget.export_picker.is_some(),
        "editor Ctrl-D must not be a hidden cancel"
    );
    key(&mut app, KeyCode::Char('q'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    assert_eq!(
        app.chat_widget
            .export_picker
            .as_ref()
            .unwrap()
            .filename()
            .text(),
        ""
    );
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    assert!(app.chat_widget.export_picker.is_some());
    app.handle_tui_event(TuiEvent::Paste("report.md".into()), true);
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::ExportTranscript {
            path: Some("report.md".into())
        }
    );
}

#[test]
fn export_unbound_controls_leave_the_picker_and_composer_draft_intact() {
    let mut app = app(json!({"list":{"accept":[], "cancel":[]}}));
    app.chat_widget.bottom_pane.insert_str("retained draft");
    for code in [KeyCode::Enter, KeyCode::Esc] {
        assert_eq!(key(&mut app, code, KeyModifiers::NONE), AppAction::None);
        assert!(app.chat_widget.export_picker.is_some());
    }
    let text = screen(&app, 100, 24);
    assert!(
        !text.contains("enter select") && !text.contains("esc back"),
        "{text}"
    );
    key(&mut app, KeyCode::Char('c'), KeyModifiers::CONTROL);
    assert!(app.chat_widget.export_picker.is_none());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "retained draft"
    );
}

#[test]
fn export_chords_keep_completion_and_non_keyboard_reset_with_the_picker() {
    let mut app = app(json!({"list":{"accept":"ctrl-x enter", "cancel":"ctrl-x q"}}));
    key(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
    app.handle_tui_event(TuiEvent::Resize(ratatui::layout::Size::new(40, 12)), true);
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    assert!(app.chat_widget.export_picker.is_some());
    key(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::ExportTranscript { path: None }
    );

    let mut app = self::app(json!({"list":{"accept":"ctrl-x enter", "cancel":"ctrl-x q"}}));
    key(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
    key(&mut app, KeyCode::Char('q'), KeyModifiers::NONE);
    assert!(app.chat_widget.export_picker.is_none());
}

#[test]
fn export_page_jump_wrap_and_direct_numbers_share_list_semantics() {
    for config in [
        json!({"list":{"accept":"f9", "page_down":"ctrl-d"}}),
        json!({"list":{"accept":"f9"}}),
    ] {
        let mut app = app(config);
        let page = key(&mut app, KeyCode::Char('d'), KeyModifiers::CONTROL);
        assert_eq!(page, AppAction::None);
        assert!(app.chat_widget.export_picker.is_some());
        key(&mut app, KeyCode::End, KeyModifiers::NONE);
        key(&mut app, KeyCode::Home, KeyModifiers::NONE);
        key(&mut app, KeyCode::Up, KeyModifiers::NONE);
        key(&mut app, KeyCode::F(9), KeyModifiers::NONE);
        assert!(app
            .chat_widget
            .export_picker
            .as_ref()
            .unwrap()
            .is_filename_prompt());
    }
    let mut app = app(json!({"list":{"accept":[]}}));
    key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
    assert!(app
        .chat_widget
        .export_picker
        .as_ref()
        .unwrap()
        .is_filename_prompt());
}

#[test]
fn export_filename_chord_owns_escape_and_paste_resets_its_pending_state() {
    let mut app = app(json!({"editor":{"kill_whole_line":"ctrl-q esc"}}));
    key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
    key(&mut app, KeyCode::Char('q'), KeyModifiers::CONTROL);
    key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    let picker = app.chat_widget.export_picker.as_ref().unwrap();
    assert!(picker.is_filename_prompt());
    assert_eq!(picker.filename().text(), "");
    key(&mut app, KeyCode::Char('q'), KeyModifiers::CONTROL);
    app.handle_tui_event(TuiEvent::Paste("after paste.md".into()), true);
    key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    assert!(!app
        .chat_widget
        .export_picker
        .as_ref()
        .unwrap()
        .is_filename_prompt());
    key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
    assert_eq!(
        app.chat_widget
            .export_picker
            .as_ref()
            .unwrap()
            .filename()
            .text(),
        "after paste.md"
    );
}

#[test]
fn export_views_keep_canonical_transcript_visible_and_stay_bounded() {
    let mut app = app(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}));
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            thread_id: "thread-export".into(),
            turn_id: "turn-export".into(),
            completed_at_ms: 1,
            item: ThreadItem::AgentMessage {
                id: "item-export".into(),
                text: "CANONICAL_EXPORT_BODY".into(),
                phase: None,
                memory_citation: None,
                metadata: None,
                delivery: None,
            },
        },
    ));
    for filename in [false, true] {
        if filename {
            key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
        }
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            app.set_locale(locale);
            for width in [1, 2, 4, 10, 14, 24, 40, 100] {
                for height in [1, 2, 3, 4, 8, 24] {
                    let text = screen(&app, width, height);
                    assert_eq!(text.lines().count(), usize::from(height));
                    if width == 100 && height == 24 {
                        assert!(text.contains("CANONICAL_EXPORT_BODY"), "{locale:?}: {text}");
                    }
                }
            }
        }
    }
}

#[test]
fn export_narrow_footer_keeps_a_whole_cancel_chord_and_blank_filename_hides_save() {
    let mut app = app(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        app.set_locale(locale);
        let text = screen(&app, 14, 24);
        assert_eq!(
            text.lines().last().unwrap().trim(),
            "ctrl+x q",
            "{locale:?}: {text}"
        );
    }
    key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
    key(&mut app, KeyCode::Char('u'), KeyModifiers::CONTROL);
    let text = screen(&app, 100, 24);
    let footer = text.lines().last().unwrap();
    assert!(footer.contains("esc"), "{text}");
    assert!(
        !footer.contains("enter"),
        "blank filename must not advertise save: {text}"
    );
}

#[test]
fn export_picker_uses_thread_id_filename_and_supports_both_destinations() {
    let mut picker = ExportPicker::new(Some("thread-123"), &RuntimeKeymap::default());
    assert_eq!(picker.filename().text(), "codex-session-thread-123.md");
    assert_eq!(
        picker.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        ExportPickerAction::Copy
    );

    let mut picker = ExportPicker::new(Some("thread-123"), &RuntimeKeymap::default());
    assert_eq!(
        picker.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Down,
            KeyModifiers::NONE,
        ))),
        ExportPickerAction::None
    );
    assert_eq!(
        picker.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        ExportPickerAction::None
    );
    assert!(picker.is_filename_prompt());
    assert_eq!(
        picker.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        ExportPickerAction::Save
    );
    assert_eq!(
        picker.selected_path(),
        Some(PathBuf::from("codex-session-thread-123.md"))
    );
}

#[test]
fn export_picker_escape_returns_to_destination_then_cancels() {
    let mut picker = ExportPicker::new(None, &RuntimeKeymap::default());
    picker.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Down,
        KeyModifiers::NONE,
    )));
    picker.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::NONE,
    )));
    assert!(picker.is_filename_prompt());
    assert_eq!(
        picker.handle_event(&Event::Key(
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,)
        )),
        ExportPickerAction::None
    );
    assert!(!picker.is_filename_prompt());
    assert_eq!(
        picker.handle_event(&Event::Key(
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,)
        )),
        ExportPickerAction::Cancel
    );
}

#[test]
fn export_picker_filename_paste_preserves_raw_text_and_trims_only_at_submit() {
    let mut picker = ExportPicker::new(None, &RuntimeKeymap::default());
    picker.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Down,
        KeyModifiers::NONE,
    )));
    picker.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::NONE,
    )));
    picker.handle_event(&Event::Key(KeyEvent::new(
        KeyCode::Char('u'),
        KeyModifiers::CONTROL,
    )));
    picker.handle_event(&Event::Paste("report".to_string()));
    picker.handle_event(&Event::Paste(".md\r\n".to_string()));
    assert_eq!(picker.filename().text(), "report.md\r\n");
    assert_eq!(picker.selected_path(), Some(PathBuf::from("report.md")));
}

#[test]
fn export_filename_grows_with_wrapped_input_and_caps_its_viewport() {
    let mut app = app(json!({}));
    key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
    let height = |app: &App| {
        super::transcript_export::desired_height(
            app.chat_widget.export_picker.as_ref().unwrap(),
            Locale::EnUs,
            40,
        )
    };
    let short = height(&app);
    app.handle_tui_event(TuiEvent::Paste("界👩‍💻 ".repeat(100)), true);
    let long = height(&app);
    assert!(
        long > short,
        "wrapped filename must grow: {short} -> {long}"
    );
    app.handle_tui_event(TuiEvent::Paste("界👩‍💻 ".repeat(100)), true);
    assert_eq!(
        height(&app),
        long,
        "input height must be capped at eight rows"
    );
}

#[test]
fn export_filename_inherits_vim_and_escape_tracks_the_real_mode() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.set_vim_enabled(true);
    app.chat_widget.show_transcript_export_popup(None);
    key(&mut app, KeyCode::Char('2'), KeyModifiers::NONE);
    assert!(screen(&app, 100, 24).contains("Vim: Insert"));
    key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    assert!(app
        .chat_widget
        .export_picker
        .as_ref()
        .unwrap()
        .is_filename_prompt());
    assert!(screen(&app, 100, 24).contains("Vim: Normal"));
    key(&mut app, KeyCode::Char('d'), KeyModifiers::NONE);
    key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    assert!(app
        .chat_widget
        .export_picker
        .as_ref()
        .unwrap()
        .is_filename_prompt());
    key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
    assert!(!app
        .chat_widget
        .export_picker
        .as_ref()
        .unwrap()
        .is_filename_prompt());
}
