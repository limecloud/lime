use super::tests::{key, overlay};
use super::*;
use ratatui::layout::Position;
use serde_json::json;

fn text_fields() -> McpServerElicitationOverlay {
    overlay(json!({
        "type": "object",
        "properties": {"first": {"type": "string"}, "second": {"type": "string"}},
        "required": ["first", "second"]
    }))
}

#[test]
fn field_navigation_restores_atomic_payload_cursor_and_full_response() {
    let mut overlay = text_fields();
    let first = format!("/model\n@parser $gate-skill\n{}", "界🙂".repeat(501));
    overlay.handle_paste(&first);
    overlay.handle_key_event(key(KeyCode::Home));
    let first_draft = overlay.composer.snapshot_draft();
    assert_ne!(overlay.composer.text(), first);
    overlay.handle_key_event(key(KeyCode::Tab));
    overlay.handle_paste("second answer");
    overlay.handle_key_event(key(KeyCode::Left));
    let second_draft = overlay.composer.snapshot_draft();
    overlay.handle_key_event(key(KeyCode::BackTab));
    assert_eq!(overlay.composer.snapshot_draft(), first_draft);
    assert_eq!(overlay.composer.current_text_with_pending(), first);
    assert!(!overlay.composer.completion_popup_active());
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(overlay.composer.snapshot_draft(), second_draft);
    let Some(AppServerResponse::McpElicitation { id, response }) =
        overlay.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("MCP fields did not submit");
    };
    assert_eq!(id, RequestId::Integer(7));
    assert_eq!(
        response,
        McpServerElicitationRequestResponse {
            action: McpServerElicitationAction::Accept,
            content: Some(json!({"first": first, "second": "second answer"})),
            meta: None,
        }
    );
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
}

#[test]
fn accepted_field_revisit_preserves_acceptance_until_content_changes() {
    let mut overlay = text_fields();
    overlay.handle_paste("accepted");
    overlay.handle_key_event(key(KeyCode::Enter));
    overlay.handle_key_event(key(KeyCode::PageUp));
    overlay.handle_key_event(key(KeyCode::Left));
    assert_eq!(overlay.field_value(0), Some(json!("accepted")));
    overlay.handle_paste("!");
    assert_eq!(overlay.field_value(0), None);
    overlay.handle_key_event(key(KeyCode::PageDown));
    overlay.handle_paste("second");
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert!(overlay.validation_error);
    assert_eq!(overlay.current_field, 0);
    assert_eq!(overlay.composer.text(), "accepte!d");
    overlay.handle_key_event(key(KeyCode::Enter));
    let Some(AppServerResponse::McpElicitation { response, .. }) =
        overlay.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("revised fields did not submit");
    };
    assert_eq!(
        response.content,
        Some(json!({"first": "accepte!d", "second": "second"}))
    );
}

#[test]
fn raw_burst_enter_and_tab_remain_text_until_idle_flush() {
    let mut overlay = text_fields();
    let now = Instant::now();
    let text = format!("/model\t@parser\n{}", "界🙂".repeat(501));
    for ch in text.chars() {
        let code = match ch {
            '\n' => KeyCode::Enter,
            '\t' => KeyCode::Tab,
            _ => KeyCode::Char(ch),
        };
        assert!(overlay.handle_key_event_at(key(code), now).is_none());
    }
    assert_eq!(overlay.current_field, 0);
    assert!(overlay.is_in_paste_burst());
    assert!(overlay.next_frame_delay().is_some());
    assert!(overlay.flush_paste_burst_if_due(now + Duration::from_secs(1)));
    assert_eq!(overlay.composer.current_text_with_pending(), text);
    assert_ne!(overlay.composer.text(), text);
    assert!(!overlay.is_in_paste_burst());
    assert!(overlay
        .handle_key_event_at(key(KeyCode::Enter), now + Duration::from_secs(1))
        .is_none());
    assert_eq!(overlay.field_value(0), Some(json!(text)));
    assert_eq!(overlay.current_field, 1);
}

#[test]
fn held_typing_is_saved_on_handoff_and_cleared_before_cancellation() {
    let mut overlay = text_fields();
    let now = Instant::now();
    overlay.handle_key_event_at(key(KeyCode::Char('x')), now);
    let release =
        KeyEvent::new_with_kind(KeyCode::Enter, KeyModifiers::NONE, KeyEventKind::Release);
    assert!(overlay.handle_key_event_at(release, now).is_none());
    assert!(overlay.is_in_paste_burst());
    overlay.handle_key_event_at(key(KeyCode::PageDown), now);
    overlay.handle_key_event_at(key(KeyCode::PageUp), now);
    assert_eq!(overlay.composer.text(), "x");
    let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
    assert!(overlay.handle_key_event_at(ctrl_c, now).is_none());
    assert!(overlay.composer.is_empty());
    let Some(AppServerResponse::McpElicitation { response, .. }) =
        overlay.handle_key_event_at(ctrl_c, now)
    else {
        panic!("empty draft did not cancel");
    };
    assert_eq!(response.action, McpServerElicitationAction::Cancel);
    assert_eq!(response.content, None);
}

#[test]
fn rejected_expanded_input_retains_draft_and_localizes_the_error() {
    let mut overlay = text_fields();
    let text = "界".repeat(agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS + 1);
    overlay.handle_paste(&text);
    let draft = overlay.composer.snapshot_draft();
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(overlay.submission_error, Some(text.chars().count()));
    assert_eq!(overlay.composer.snapshot_draft(), draft);
    assert_eq!(overlay.field_value(0), None);
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let lines = render::lines_with_locale(&overlay, locale);
        assert!(lines
            .iter()
            .any(|line| line.to_string()
                == locale.user_input_too_large_message(text.chars().count())));
    }
    overlay.handle_key_event(key(KeyCode::PageDown));
    overlay.handle_key_event(key(KeyCode::PageUp));
    assert_eq!(overlay.composer.snapshot_draft(), draft);
}

#[test]
fn query_and_editor_chords_own_enter_escape_and_navigation() {
    let mut overlay = text_fields();
    overlay.composer.set_vim_enabled(true);
    overlay.handle_key_event(key(KeyCode::Char('/')));
    assert!(overlay.composer.vim_search_active());
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(overlay.current_field, 0);
    assert!(!overlay.validation_error);
    overlay.handle_key_event(key(KeyCode::Char('i')));
    assert!(overlay.handle_key_event(key(KeyCode::Esc)).is_none());
    assert!(!overlay.done);

    overlay.composer.set_vim_enabled(false);
    overlay.handle_paste("draft");
    let keymap = crate::keymap::RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "editor": {"kill_whole_line": "ctrl-x enter"}
        }))
        .unwrap(),
    )
    .unwrap();
    overlay.set_keymap_bindings(&keymap);
    overlay.handle_key_event(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL));
    assert!(overlay.composer.key_chord_pending());
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(overlay.current_field, 0);
    assert!(overlay.composer.is_empty());
}

#[test]
fn plain_text_image_paths_remain_literal_and_bracketed_pastes_normalize() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("form.png");
    image::RgbaImage::new(2, 2).save(&path).unwrap();
    let mut overlay = text_fields();
    overlay.handle_paste(path.to_str().unwrap());
    assert_eq!(overlay.composer.text(), path.to_str().unwrap());
    assert!(overlay.composer.local_images().is_empty());
    overlay.handle_key_event(key(KeyCode::Tab));
    overlay.handle_paste("a\r\nb\rc");
    assert_eq!(overlay.composer.text(), "a\nb\nc");
}

#[test]
fn multiline_viewport_keeps_wrapped_tail_and_cursor_visible_in_all_locales() {
    let mut overlay = text_fields();
    overlay.handle_paste(&format!("{}\nTAIL", "界🙂".repeat(100)));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for (width, height) in [(12, 16), (20, 8), (5, 3), (1, 1), (0, 0)] {
            let mut terminal =
                ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height)).unwrap();
            terminal
                .draw(|frame| render::render(frame, frame.area(), &overlay, locale))
                .unwrap();
            if width >= 12 {
                let buffer = terminal.backend().buffer();
                let tail_row = (0..height)
                    .find(|y| buffer[(4, *y)].symbol() == "T")
                    .expect("wrapped tail visible");
                for (offset, ch) in "TAIL".chars().enumerate() {
                    assert_eq!(
                        buffer[(4 + offset as u16, tail_row)].symbol(),
                        ch.to_string()
                    );
                }
                let cursor = terminal.backend().cursor_position();
                assert_eq!(cursor, Position::new(8, tail_row));
            }
        }
    }
}
