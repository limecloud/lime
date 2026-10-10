use super::*;
use app_server_protocol::protocol::v2::{ToolRequestUserInputOption, ToolRequestUserInputQuestion};
use crossterm::event::{KeyEvent, KeyModifiers};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn collects_option_and_freeform_questions_before_responding() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(9),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![
                ToolRequestUserInputQuestion {
                    id: "mode".to_string(),
                    header: "Mode".to_string(),
                    question: "Choose a mode".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: Some(vec![ToolRequestUserInputOption {
                        label: "Fast".to_string(),
                        description: "Continue immediately".to_string(),
                    }]),
                },
                ToolRequestUserInputQuestion {
                    id: "note".to_string(),
                    header: "Note".to_string(),
                    question: "Add a note".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: None,
                },
            ],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    assert_eq!(request.handle_key_event(key(KeyCode::Enter)), None);
    let now = Instant::now();
    request.handle_key_event_at(key(KeyCode::Char('好')), now);
    request.pre_draw_tick(now + Duration::from_secs(1));
    let response = request.handle_key_event_at(key(KeyCode::Enter), now + Duration::from_secs(1));

    let Some(AppServerResponse::UserInput { response, .. }) = response else {
        panic!("expected user input response");
    };
    assert_eq!(response.answers["mode"].answers, ["Fast"]);
    assert_eq!(response.answers["note"].answers, ["user_note: 好"]);
}

#[test]
fn escape_returns_an_empty_fail_closed_response() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(9),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: Vec::new(),
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    let response = request.handle_key_event(key(KeyCode::Esc));
    let Some(AppServerResponse::UserInput { response, .. }) = response else {
        panic!("expected user input response");
    };
    assert!(response.answers.is_empty());
}

#[test]
fn ctrl_c_clears_notes_before_cancelling_request() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(10),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "secret".to_string(),
                header: "Secret".to_string(),
                question: "Enter a secret".to_string(),
                is_other: false,
                is_secret: true,
                options: None,
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );
    request.set_focus(super::Focus::Notes);
    request.composer.insert("sensitive");

    let first = request.handle_key_event(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
    assert!(first.is_none());
    assert!(request.composer.is_empty());

    let response =
        request.handle_key_event(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
    let Some(AppServerResponse::UserInput { response, .. }) = response else {
        panic!("expected user input response");
    };
    assert!(response.answers.is_empty());
}

#[test]
fn option_notes_follow_codex_answer_shape() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(11),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: false,
                is_secret: false,
                options: Some(vec![ToolRequestUserInputOption {
                    label: "Fast".to_string(),
                    description: "Continue immediately".to_string(),
                }]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    assert_eq!(request.handle_key_event(key(KeyCode::Tab)), None);
    assert!(request.editing());
    request.composer.insert("keep logs");
    let response = request.handle_key_event(key(KeyCode::Enter));

    let Some(AppServerResponse::UserInput { response, .. }) = response else {
        panic!("expected user input response");
    };
    assert_eq!(
        response.answers["mode"].answers,
        ["Fast", "user_note: keep logs"]
    );
}

#[test]
fn empty_notes_submit_the_selected_option() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(13),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: false,
                is_secret: false,
                options: Some(vec![ToolRequestUserInputOption {
                    label: "Fast".to_string(),
                    description: "Continue immediately".to_string(),
                }]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    request.handle_key_event(key(KeyCode::Tab));
    let response = request.handle_key_event(key(KeyCode::Enter));

    let Some(AppServerResponse::UserInput { response, .. }) = response else {
        panic!("expected user input response");
    };
    assert_eq!(response.answers["mode"].answers, ["Fast"]);
}

#[test]
fn other_option_is_only_added_when_the_contract_enables_it() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(12),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: true,
                is_secret: false,
                options: Some(vec![ToolRequestUserInputOption {
                    label: "Fast".to_string(),
                    description: "Continue immediately".to_string(),
                }]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    request.handle_key_event(key(KeyCode::Down));
    assert_eq!(request.handle_key_event(key(KeyCode::Enter)), None);
    assert!(request.editing());
    let response = request.handle_key_event(key(KeyCode::Enter));

    let Some(AppServerResponse::UserInput { response, .. }) = response else {
        panic!("expected user input response");
    };
    assert_eq!(response.answers["mode"].answers, ["None of the above"]);
}

#[test]
fn question_navigation_preserves_each_question_draft_and_selection() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(14),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![
                ToolRequestUserInputQuestion {
                    id: "first".to_string(),
                    header: "First".to_string(),
                    question: "First note".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: None,
                },
                ToolRequestUserInputQuestion {
                    id: "second".to_string(),
                    header: "Second".to_string(),
                    question: "Second note".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: None,
                },
            ],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    request.composer.insert("draft one");
    assert_eq!(
        request.handle_key_event(KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE)),
        None
    );
    assert_eq!(request.question_index, 1);
    request.composer.insert("draft two");
    assert_eq!(
        request.handle_key_event(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE)),
        None
    );
    assert_eq!(request.question_index, 0);
    assert_eq!(request.composer.text(), "draft one");
    assert_eq!(
        request.handle_key_event(KeyEvent::new(KeyCode::PageDown, KeyModifiers::NONE)),
        None
    );
    assert_eq!(request.composer.text(), "draft two");
}

#[test]
fn other_enter_opens_notes_before_submitting_custom_answer() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(15),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: true,
                is_secret: false,
                options: Some(vec![ToolRequestUserInputOption {
                    label: "Fast".to_string(),
                    description: "Continue immediately".to_string(),
                }]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    request.handle_key_event(key(KeyCode::Down));
    assert_eq!(request.handle_key_event(key(KeyCode::Enter)), None);
    assert!(request.editing());
    request.composer.insert("custom");
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("expected user input response");
    };
    assert_eq!(
        response.answers["mode"].answers,
        ["None of the above", "user_note: custom"]
    );
}

#[test]
fn notes_focus_returns_to_options_without_submitting_on_escape_or_empty_backspace() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(16),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: false,
                is_secret: false,
                options: Some(vec![ToolRequestUserInputOption {
                    label: "Fast".to_string(),
                    description: "Continue immediately".to_string(),
                }]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    request.handle_key_event(key(KeyCode::Tab));
    request.composer.insert("discarded");
    assert_eq!(request.handle_key_event(key(KeyCode::Esc)), None);
    assert!(!request.editing());
    assert!(request.composer.is_empty());

    request.handle_key_event(key(KeyCode::Tab));
    assert_eq!(request.handle_key_event(key(KeyCode::Backspace)), None);
    assert!(!request.editing());
    assert!(request.composer.is_empty());
}

#[test]
fn options_typing_does_not_open_notes() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(17),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: false,
                is_secret: false,
                options: Some(vec![
                    ToolRequestUserInputOption {
                        label: "Fast".to_string(),
                        description: "Continue immediately".to_string(),
                    },
                    ToolRequestUserInputOption {
                        label: "Safe".to_string(),
                        description: "Continue carefully".to_string(),
                    },
                ]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    assert_eq!(request.handle_key_event(key(KeyCode::Char('x'))), None);
    assert!(!request.editing());
    assert!(request.composer.is_empty());
    assert_eq!(request.handle_key_event(key(KeyCode::Char('j'))), None);
    assert_eq!(request.selected(), 1);
    assert!(!request.editing());
    assert_eq!(request.handle_key_event(key(KeyCode::Char('k'))), None);
    assert_eq!(request.selected(), 0);
    assert_eq!(request.handle_key_event(key(KeyCode::Char(' '))), None);
    assert!(!request.editing());
}

#[test]
fn control_j_and_k_navigate_options_without_opening_notes() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(21),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: false,
                is_secret: false,
                options: Some(vec![
                    ToolRequestUserInputOption {
                        label: "Fast".to_string(),
                        description: "Continue immediately".to_string(),
                    },
                    ToolRequestUserInputOption {
                        label: "Safe".to_string(),
                        description: "Continue carefully".to_string(),
                    },
                ]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    assert_eq!(request.selected(), 0);
    request.handle_key_event(KeyEvent::new(KeyCode::Char('j'), KeyModifiers::CONTROL));
    assert_eq!(request.selected(), 1);
    request.handle_key_event(KeyEvent::new(KeyCode::Char('k'), KeyModifiers::CONTROL));
    assert_eq!(request.selected(), 0);
    assert!(!request.editing());
}

#[test]
fn option_navigation_wraps_at_both_ends() {
    let mut request = RequestUserInputOverlay::new(
        RequestId::Integer(22),
        ToolRequestUserInputParams {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "question-1".to_string(),
            questions: vec![ToolRequestUserInputQuestion {
                id: "mode".to_string(),
                header: "Mode".to_string(),
                question: "Choose a mode".to_string(),
                is_other: false,
                is_secret: false,
                options: Some(vec![
                    ToolRequestUserInputOption {
                        label: "Fast".to_string(),
                        description: "Continue immediately".to_string(),
                    },
                    ToolRequestUserInputOption {
                        label: "Safe".to_string(),
                        description: "Continue carefully".to_string(),
                    },
                ]),
            }],
            is_blocking: true,
            auto_resolution_ms: None,
        },
    );

    request.handle_key_event(key(KeyCode::Up));
    assert_eq!(request.selected(), 1);
    request.handle_key_event(key(KeyCode::Down));
    assert_eq!(request.selected(), 0);
}

fn non_blocking_request() -> ToolRequestUserInputParams {
    ToolRequestUserInputParams {
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        item_id: "question-1".to_string(),
        questions: vec![ToolRequestUserInputQuestion {
            id: "mode".to_string(),
            header: "Mode".to_string(),
            question: "Choose a mode".to_string(),
            is_other: false,
            is_secret: false,
            options: Some(vec![ToolRequestUserInputOption {
                label: "Fast".to_string(),
                description: "Continue immediately".to_string(),
            }]),
        }],
        is_blocking: false,
        auto_resolution_ms: None,
    }
}

#[test]
fn non_blocking_request_uses_hidden_grace_then_visible_countdown() {
    let request = RequestUserInputOverlay::new(RequestId::Integer(18), non_blocking_request());
    let started = request.request_started_at;

    assert_eq!(
        request.auto_resolution_timing_at(started),
        AutoResolutionTiming::HiddenGrace {
            remaining: AUTO_RESOLUTION_HIDDEN_GRACE
        }
    );
    let visible = started + AUTO_RESOLUTION_HIDDEN_GRACE;
    assert!(request
        .auto_resolution_countdown_text(visible, crate::locale::Locale::EnUs)
        .is_some());
    assert_eq!(
        request.next_frame_delay(visible),
        Some(Duration::from_secs(1))
    );
}

#[test]
fn non_blocking_request_expires_with_empty_answers() {
    let mut request = RequestUserInputOverlay::new(RequestId::Integer(19), non_blocking_request());
    let due = request.request_started_at
        + AUTO_RESOLUTION_HIDDEN_GRACE
        + AUTO_RESOLUTION_VISIBLE_COUNTDOWN;
    let Some(AppServerResponse::UserInput { response, .. }) = request.pre_draw_tick(due) else {
        panic!("expected automatic user input response");
    };
    assert!(response.answers.is_empty());
    assert_eq!(request.next_frame_delay(due), Some(Duration::ZERO));
}

#[test]
fn non_blocking_request_is_snoozed_by_user_input() {
    let mut request = RequestUserInputOverlay::new(RequestId::Integer(20), non_blocking_request());
    let due = request.request_started_at
        + AUTO_RESOLUTION_HIDDEN_GRACE
        + AUTO_RESOLUTION_VISIBLE_COUNTDOWN;
    assert_eq!(request.handle_key_event(key(KeyCode::Down)), None);
    assert_eq!(
        request.auto_resolution_timing_at(due),
        AutoResolutionTiming::Disabled
    );
    assert_eq!(request.pre_draw_tick(due), None);
}

#[test]
fn narrow_footer_keeps_submit_and_cancel_before_secondary_hints() {
    let request = RequestUserInputOverlay::new(RequestId::Integer(21), non_blocking_request());
    let lines = request.footer_hint_lines(crate::locale::Locale::EnUs, 28);
    let footer = lines.first().expect("primary footer line");

    assert!(footer.contains("Enter submit"));
    assert!(footer.contains("Esc cancel"));
    assert!(crate::width::display_width(footer) <= 28);
}

#[test]
fn footer_wraps_hints_without_splitting_individual_hints() {
    let mut params = non_blocking_request();
    params.questions.push(params.questions[0].clone());
    let request = RequestUserInputOverlay::new(RequestId::Integer(26), params);

    let lines = request.footer_hint_lines(crate::locale::Locale::EnUs, 36);
    assert!(lines.len() > 1, "{lines:?}");
    assert!(
        lines
            .iter()
            .all(|line| crate::width::display_width(line) <= 36),
        "{lines:?}"
    );
    let footer = lines.join(" · ");
    for hint in [
        "Enter submit · Esc cancel",
        "↑/↓ select",
        "Tab notes",
        "←/→ questions",
    ] {
        assert!(footer.contains(hint), "missing {hint:?}: {lines:?}");
    }
}

#[test]
fn long_option_lists_expose_the_hidden_selection_position() {
    let mut params = non_blocking_request();
    params.questions[0].options = Some(
        (0..12)
            .map(|index| ToolRequestUserInputOption {
                label: format!("Choice {index}"),
                description: String::new(),
            })
            .collect(),
    );
    let mut request = RequestUserInputOverlay::new(RequestId::Integer(24), params);
    request.set_selected(10);

    let lines = request.footer_hint_lines(crate::locale::Locale::EnUs, 80);
    let footer = lines.join(" · ");
    assert!(footer.contains("option 11/12"), "{footer}");
    assert!(crate::width::display_width(&footer) > 0);
    let narrow = request
        .footer_hint_lines(crate::locale::Locale::EnUs, 40)
        .join(" · ");
    assert!(narrow.contains("option 11/12"), "{narrow}");
}

#[test]
fn option_position_hint_is_localized_across_product_locales() {
    let mut params = non_blocking_request();
    params.questions[0].options = Some(
        (0..9)
            .map(|index| ToolRequestUserInputOption {
                label: format!("Choice {index}"),
                description: String::new(),
            })
            .collect(),
    );
    let request = RequestUserInputOverlay::new(RequestId::Integer(25), params);
    for locale in [
        crate::locale::Locale::ZhCn,
        crate::locale::Locale::ZhTw,
        crate::locale::Locale::EnUs,
        crate::locale::Locale::JaJp,
        crate::locale::Locale::KoKr,
    ] {
        assert!(!request.footer_hint_lines(locale, 80).is_empty());
    }
}

#[test]
fn ultra_narrow_footer_keeps_cancel_action_visible_without_overflow() {
    for locale in [
        crate::locale::Locale::ZhCn,
        crate::locale::Locale::ZhTw,
        crate::locale::Locale::EnUs,
        crate::locale::Locale::JaJp,
        crate::locale::Locale::KoKr,
    ] {
        let request = RequestUserInputOverlay::new(RequestId::Integer(23), non_blocking_request());
        for width in [3, 4, 7, 12, 18] {
            let lines = request.footer_hint_lines(locale, width);
            assert!(
                lines
                    .iter()
                    .all(|line| crate::width::display_width(line) <= width),
                "{locale:?} at {width}: {lines:?}"
            );
            assert!(
                lines.first().is_some_and(|line| line.contains("Esc")),
                "{locale:?} at {width}: {lines:?}"
            );
        }
    }
}
