use super::render::*;
use super::*;
use app_server_protocol::protocol::v2::McpServerElicitationRequest;
use crossterm::event::KeyModifiers;
use ratatui::backend::TestBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use serde_json::json;

pub(super) fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn params(schema: Value) -> McpServerElicitationRequestParams {
    params_with_meta(schema, None)
}

fn params_with_meta(schema: Value, meta: Option<Value>) -> McpServerElicitationRequestParams {
    let Value::Object(requested_schema) = schema else {
        panic!("test schema must be an object");
    };
    McpServerElicitationRequestParams {
        thread_id: "thread-1".to_string(),
        turn_id: Some("turn-1".to_string()),
        server_name: "server-1".to_string(),
        request: McpServerElicitationRequest::Form {
            meta,
            message: "Choose values".to_string(),
            requested_schema,
        },
    }
}

pub(super) fn overlay(schema: Value) -> McpServerElicitationOverlay {
    McpServerElicitationOverlay::from_server_request(RequestId::Integer(7), &params(schema))
        .expect("supported MCP form")
}

#[test]
fn parses_string_boolean_and_single_select_fields() {
    let overlay = overlay(json!({
        "type": "object",
        "properties": {
            "name": { "type": "string", "title": "Name" },
            "confirmed": { "type": "boolean", "default": true },
            "mode": { "type": "string", "enum": ["fast", "safe"], "enumNames": ["Fast", "Safe"] }
        },
        "required": ["name", "confirmed", "mode"]
    }));

    assert_eq!(overlay.fields.len(), 3);
    assert!(matches!(
        overlay.fields[0].input,
        McpFieldInput::Text { .. }
    ));
    assert!(matches!(
        overlay.fields[1].input,
        McpFieldInput::Select { .. }
    ));
    assert!(matches!(
        overlay.fields[2].input,
        McpFieldInput::Select { .. }
    ));
    assert_eq!(overlay.field_value(1), Some(Value::Bool(true)));
}

#[test]
fn parses_titled_single_select_and_rejects_unsupported_shapes() {
    let overlay = overlay(json!({
        "type": "object",
        "properties": {
            "mode": { "type": "string", "oneOf": [
                { "const": "fast", "title": "Fast", "description": "Run quickly" },
                { "const": "safe", "title": "Safe" }
            ] }
        }
    }));
    assert_eq!(overlay.current_options().len(), 2);
    assert_eq!(
        overlay.current_options()[0].description.as_deref(),
        Some("Run quickly")
    );

    for schema in [
        json!({ "type": "object", "properties": { "count": { "type": "number" } } }),
        json!({ "type": "object", "properties": { "tags": { "type": "string", "enum": [], "enumNames": [] } } }),
    ] {
        assert!(McpServerElicitationOverlay::from_server_request(
            RequestId::Integer(1),
            &params(schema)
        )
        .is_none());
    }
}

#[test]
fn empty_schema_uses_generic_approval_actions() {
    let mut overlay = McpServerElicitationOverlay::from_server_request(
        RequestId::Integer(8),
        &params(json!({ "type": "object", "properties": {} })),
    )
    .expect("empty object schema should use approval surface");

    assert_eq!(overlay.response_mode, McpResponseMode::ApprovalAction);
    assert_eq!(overlay.current_options().len(), 3);
    let response = overlay
        .handle_key_event(key(KeyCode::Enter))
        .expect("default allow response");
    let AppServerResponse::McpElicitation { response, .. } = response else {
        unreachable!();
    };
    assert_eq!(response.action, McpServerElicitationAction::Accept);
    assert_eq!(response.content, Some(json!({})));
    assert!(response.meta.is_none());
}

#[test]
fn empty_schema_decline_and_persisted_accept_are_typed() {
    let mut decline = McpServerElicitationOverlay::from_server_request(
        RequestId::Integer(9),
        &params(json!({ "type": "object", "properties": {} })),
    )
    .expect("generic approval surface");
    decline.handle_key_event(key(KeyCode::Down));
    let response = decline
        .handle_key_event(key(KeyCode::Enter))
        .expect("decline response");
    let AppServerResponse::McpElicitation { response, .. } = response else {
        unreachable!();
    };
    assert_eq!(response.action, McpServerElicitationAction::Decline);
    assert!(response.content.is_none());

    let mut persisted = McpServerElicitationOverlay::from_server_request(
        RequestId::Integer(10),
        &params_with_meta(
            json!({ "type": "object", "properties": {} }),
            Some(json!({ "persist": ["session", "always"] })),
        ),
    )
    .expect("persisted approval surface");
    assert_eq!(persisted.current_options().len(), 5);
    persisted.handle_key_event(key(KeyCode::Down));
    let response = persisted
        .handle_key_event(key(KeyCode::Enter))
        .expect("session accept response");
    let AppServerResponse::McpElicitation { response, .. } = response else {
        unreachable!();
    };
    assert_eq!(response.action, McpServerElicitationAction::Accept);
    assert_eq!(response.content, Some(json!({})));
    assert_eq!(
        response.meta,
        Some(Map::from_iter([(
            "persist".to_string(),
            Value::String("session".to_string()),
        )]))
    );
}

#[test]
fn ctrl_c_clears_text_draft_before_cancelling_elicitation() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": {
            "token": { "type": "string" }
        }
    }));
    overlay.handle_paste("sensitive draft");

    assert!(overlay
        .handle_key_event(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL))
        .is_none());
    assert!(overlay.composer.is_empty());
    assert!(!overlay.done);

    let response = overlay
        .handle_key_event(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL))
        .expect("second Ctrl-C cancels the request");
    let AppServerResponse::McpElicitation { response, .. } = response else {
        panic!("expected MCP elicitation response");
    };
    assert_eq!(response.action, McpServerElicitationAction::Cancel);
}

#[test]
fn ctrl_c_on_select_field_cancels_without_mutating_selection() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": {
            "mode": { "type": "string", "enum": ["fast", "safe"] }
        }
    }));
    overlay.handle_key_event(key(KeyCode::Down));
    assert!(matches!(
        overlay.states.first(),
        Some(McpFieldState::Select {
            selected: Some(1),
            ..
        })
    ));

    let response = overlay
        .handle_key_event(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL))
        .expect("Ctrl-C cancels selection fields");
    let AppServerResponse::McpElicitation { response, .. } = response else {
        panic!("expected MCP elicitation response");
    };
    assert_eq!(response.action, McpServerElicitationAction::Cancel);
    assert!(overlay.done);
    assert!(matches!(
        overlay.states.first(),
        Some(McpFieldState::Select {
            selected: Some(1),
            ..
        })
    ));
}

#[test]
fn tool_suggestion_empty_schema_remains_fail_closed_without_a_consumer() {
    let request = params_with_meta(
        json!({ "type": "object", "properties": {} }),
        Some(json!({ "codex_approval_kind": "tool_suggestion" })),
    );
    assert!(
        McpServerElicitationOverlay::from_server_request(RequestId::Integer(11), &request)
            .is_none()
    );
}

#[test]
fn approval_metadata_renders_explicit_display_order_and_truncates_values() {
    let overlay = McpServerElicitationOverlay::from_server_request(
        RequestId::Integer(12),
        &params_with_meta(
            json!({ "type": "object", "properties": {} }),
            Some(json!({
                "codex_approval_kind": "mcp_tool_call",
                "tool_params": { "zeta": 3, "alpha": 1 },
                "tool_params_display": [
                    { "name": "calendar_id", "value": "primary", "display_name": "Calendar" },
                    { "name": "title", "value": "Roadmap review", "display_name": "Title" },
                    { "name": "extra", "value": "ignored", "display_name": "Extra" },
                    { "name": "fourth", "value": "ignored", "display_name": "Fourth" }
                ]
            })),
        ),
    )
    .expect("tool approval should use the approval surface");

    let lines = lines_with_locale_with_width(&overlay, Locale::EnUs, 80);
    let text = lines.iter().map(ToString::to_string).collect::<Vec<_>>();
    let calendar = text
        .iter()
        .position(|line| line.contains("Calendar: primary"))
        .expect("explicit display parameter should be visible");
    let title = text
        .iter()
        .position(|line| line.contains("Title: Roadmap review"))
        .expect("second display parameter should be visible");
    assert!(
        calendar < title,
        "display metadata order must be stable: {text:?}"
    );
    assert!(text.iter().all(|line| !line.contains("Fourth:")));
    assert!(text.iter().all(|line| display_width(line) <= 80));

    let fallback_overlay = McpServerElicitationOverlay::from_server_request(
        RequestId::Integer(13),
        &params_with_meta(
            json!({ "type": "object", "properties": {} }),
            Some(json!({
                "codex_approval_kind": "mcp_tool_call",
                "tool_params": { "zeta": 3, "alpha": 1 }
            })),
        ),
    )
    .expect("tool approval fallback should remain supported");
    let fallback_text = lines_with_locale_with_width(&fallback_overlay, Locale::EnUs, 80)
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let alpha = fallback_text
        .iter()
        .position(|line| line.contains("alpha: 1"))
        .expect("fallback alpha parameter should be visible");
    let zeta = fallback_text
        .iter()
        .position(|line| line.contains("zeta: 3"))
        .expect("fallback zeta parameter should be visible");
    assert!(alpha < zeta, "fallback parameters should sort by name");

    let long_value = "x".repeat(80);
    let param = McpToolApprovalDisplayParam {
        name: "value".to_string(),
        value: Value::String(long_value),
        display_name: "Value".to_string(),
    };
    let formatted = format_tool_approval_display_message("Approve", std::slice::from_ref(&param));
    assert!(formatted.starts_with("Approve\n\nValue: "));
    let param_line = format_tool_approval_display_param_line(&param);
    assert!(param_line.chars().count() < 80);
    assert!(param_line.ends_with("..."));
}

#[test]
fn enter_collects_multiple_fields_and_emits_typed_content() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "confirmed": { "type": "boolean" }
        },
        "required": ["name", "confirmed"]
    }));
    overlay.handle_paste("Ada");
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(overlay.current_field, 1);
    let response = overlay
        .handle_key_event(key(KeyCode::Enter))
        .expect("elicitation response");
    assert!(matches!(
        response,
        AppServerResponse::McpElicitation {
            response: McpServerElicitationRequestResponse {
                action: McpServerElicitationAction::Accept,
                content: Some(Value::Object(_)),
                ..
            },
            ..
        }
    ));
    let AppServerResponse::McpElicitation { response, .. } = response else {
        unreachable!();
    };
    assert_eq!(
        response.content,
        Some(json!({ "name": "Ada", "confirmed": true }))
    );
}

#[test]
fn required_validation_moves_to_missing_field_and_cancel_is_typed() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": { "name": { "type": "string" } },
        "required": ["name"]
    }));
    assert!(overlay.handle_key_event(key(KeyCode::Enter)).is_none());
    assert!(overlay.validation_error);
    assert!(!overlay.is_complete());

    let response = overlay
        .handle_key_event(key(KeyCode::Esc))
        .expect("cancel response");
    assert!(matches!(
        response,
        AppServerResponse::McpElicitation {
            response: McpServerElicitationRequestResponse {
                action: McpServerElicitationAction::Cancel,
                content: None,
                ..
            },
            ..
        }
    ));
    assert!(overlay.is_complete());
}

#[test]
fn select_fields_support_horizontal_navigation_and_digits() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": {
            "first": { "type": "boolean" },
            "second": { "type": "string", "enum": ["a", "b"] }
        }
    }));
    assert!(overlay.handle_key_event(key(KeyCode::Char(' '))).is_none());
    assert!(overlay.handle_key_event(key(KeyCode::Right)).is_none());
    assert_eq!(overlay.current_field, 1);
    let response = overlay
        .handle_key_event(key(KeyCode::Char('2')))
        .expect("last field response");
    let AppServerResponse::McpElicitation { response, .. } = response else {
        unreachable!();
    };
    assert_eq!(
        response.content,
        Some(json!({ "first": true, "second": "b" }))
    );
}

#[test]
fn form_surface_localizes_generated_labels_and_controls() {
    let overlay = overlay(json!({
        "type": "object",
        "properties": { "confirmed": { "type": "boolean" } }
    }));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let lines = lines_with_locale(&overlay, locale);
        let text = lines
            .iter()
            .flat_map(|line| line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains("server-1"));
        assert!(text.contains(&locale.mcp_elicitation_progress(1, 1)));
        assert!(text.contains(locale.mcp_elicitation_boolean_option(true)));
        let controls = [
            locale.mcp_select_hint("↑", "↓"),
            locale.mcp_confirm_hint("enter"),
            locale.mcp_field_hint("tab", Some("←"), Some("→")),
            locale.mcp_cancel_hint("esc"),
        ]
        .join("  ");
        assert!(text.contains(controls.trim()), "{locale:?}: {text}");
    }
}

#[test]
fn controls_follow_the_runtime_list_keymap_snapshot() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": { "confirmed": { "type": "boolean" } }
    }));
    let keymap = crate::keymap::RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {
                "move_up": "f9",
                "move_down": "f10",
                "move_left": "f7",
                "move_right": "f8",
                "accept": "f12",
                "cancel": "f11"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    overlay.set_keymap_bindings(&keymap);

    let text = lines_with_locale(&overlay, Locale::EnUs)
        .into_iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("f9/f10 select"), "{text}");
    assert!(text.contains("f12 confirm"), "{text}");
    assert!(text.contains("Tab/f7/f8 switch field"), "{text}");
    assert!(text.contains("f11 cancel"), "{text}");
    let narrow = lines_with_locale_with_width(&overlay, Locale::EnUs, 8)
        .into_iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    assert!(narrow.iter().any(|line| line.contains("f12")), "{narrow:?}");
    assert!(narrow.iter().any(|line| line.contains("f11")), "{narrow:?}");
}

#[test]
fn footer_never_clips_configured_chords_or_recreates_unbound_actions() {
    for (accept, cancel) in [(true, true), (true, false), (false, true), (false, false)] {
        let keymap = crate::keymap::RuntimeKeymap::from_config(
            &serde_json::from_value(json!({"list": {
                "accept": if accept { json!("ctrl-x s") } else { json!([]) },
                "cancel": if cancel { json!("ctrl-x q") } else { json!([]) },
                "move_left": [], "move_right": "f8"
            }}))
            .unwrap(),
        )
        .unwrap();
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for width in 1..60 {
                let rows = footer_control_lines(locale, true, Some(width), keymap.list());
                let text = rows
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(
                    !text.contains("Enter") && !text.contains("Esc"),
                    "{locale:?}/{width}: {text}"
                );
                assert!(!text.contains('…'), "{locale:?}/{width}: {text}");
                for row in &rows {
                    let text = row.to_string();
                    assert!(display_width(&text) <= width, "{locale:?}/{width}: {text}");
                    if text.contains("ctrl+x") {
                        assert!(
                            text.contains("ctrl+x s") || text.contains("ctrl+x q"),
                            "partial chord: {text}"
                        );
                    }
                }
                if width >= 8 {
                    assert_eq!(text.contains("ctrl+x s"), accept, "{text}");
                    assert_eq!(text.contains("ctrl+x q"), cancel, "{text}");
                    assert!(text.contains("Tab"), "field navigation lost: {text}");
                }
                if width >= 40 {
                    assert!(
                        text.contains("Tab/f8"),
                        "one-sided field binding lost: {text}"
                    );
                }
            }
        }
    }
}

#[test]
fn option_descriptions_are_visible_and_width_bounded() {
    let overlay = overlay(json!({
        "type": "object",
        "properties": {
            "mode": { "type": "string", "oneOf": [
                {
                    "const": "fast",
                    "title": "Fast",
                    "description": "Continue quickly without additional checks"
                },
                {
                    "const": "safe",
                    "title": "Safe",
                    "description": "Review every step before execution"
                }
            ] }
        }
    }));

    let wide = lines_with_locale_with_width(&overlay, Locale::EnUs, 80);
    assert!(wide
        .iter()
        .any(|line| line.to_string().contains("Continue quickly")));
    for width in [8, 16, 32] {
        let lines = lines_with_locale_with_width(&overlay, Locale::EnUs, width);
        assert!(lines
            .iter()
            .all(|line| display_width(&line.to_string()) <= width));
    }
}

#[test]
fn narrow_select_surface_bounds_rows_and_keeps_cancel_visible() {
    let options = (0..12)
        .map(|index| format!("choice-{index}"))
        .collect::<Vec<_>>();
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": {
            "choice": { "type": "string", "enum": options }
        }
    }));
    for _ in 0..11 {
        assert!(overlay.handle_key_event(key(KeyCode::Down)).is_none());
    }

    for width in [1, 4, 12, 24] {
        let lines = lines_with_locale_with_width(&overlay, Locale::EnUs, width);
        if width >= 8 {
            let option_lines = lines
                .iter()
                .filter(|line| is_option_line(line))
                .collect::<Vec<_>>();
            assert_eq!(option_lines.len(), MAX_POPUP_ROWS);
            assert!(option_lines
                .iter()
                .any(|line| line.to_string().starts_with('›')));
        }
        assert!(lines
            .iter()
            .all(|line| display_width(&line.to_string()) <= width));
        let footer = lines.last().expect("footer line").to_string();
        if width >= display_width("Esc") {
            assert!(footer.contains("Esc"), "footer={footer:?}, width={width}");
        }
    }
}

#[test]
fn narrow_footer_wraps_actions_in_priority_order_for_all_locales() {
    let overlay = overlay(json!({
        "type": "object",
        "properties": {
            "choice": { "type": "string", "enum": ["one", "two"] },
            "note": { "type": "string" }
        },
        "required": ["choice", "note"]
    }));

    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let lines = lines_with_locale_with_width(&overlay, locale, 8);
        let footer = lines
            .iter()
            .skip_while(|line| {
                !line.to_string().contains("Enter")
                    && !line.to_string().contains("确认")
                    && !line.to_string().contains("確定")
                    && !line.to_string().contains("확인")
            })
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        assert!(!footer.is_empty(), "missing submit footer for {locale:?}");
        assert!(
            footer.last().is_some_and(|line| line.contains("Esc")
                || line.contains("取消")
                || line.contains("キャンセル")
                || line.contains("취소")
                || line.contains('⎋')),
            "cancel action must remain last for {locale:?}: {footer:?}"
        );
        assert!(
            lines
                .iter()
                .all(|line| display_width(&line.to_string()) <= 8),
            "footer overflow for {locale:?}: {lines:?}"
        );
    }
}

#[test]
fn narrow_multiline_text_keeps_physical_rows_and_cursor_aligned() {
    let mut overlay = overlay(json!({
        "type": "object",
        "properties": {
            "answer": { "type": "string", "title": "回答" }
        },
        "required": ["answer"]
    }));
    overlay.handle_paste("你好\n👩🏽‍💻");

    let width = 12usize;
    let mut terminal = Terminal::new(TestBackend::new(width as u16, 16)).expect("terminal");
    terminal
        .draw(|frame| {
            render(
                frame,
                Rect::new(0, 0, width as u16, 16),
                &overlay,
                Locale::ZhCn,
            )
        })
        .expect("draw");
    let buffer = terminal.backend().buffer();
    let input_index = (0..16)
        .find(|y| buffer[(2, *y)].symbol() == "›")
        .expect("editable row");
    assert_eq!(buffer[(4, input_index)].symbol(), "你");
    assert_eq!(buffer[(6, input_index)].symbol(), "好");
    assert_eq!(buffer[(4, input_index + 1)].symbol(), "👩🏽‍💻");
    let cursor = terminal.backend().cursor_position();
    assert_eq!(cursor.y, input_index + 1);
    assert_eq!(cursor.x, 4 + display_width("👩🏽‍💻") as u16);
}
