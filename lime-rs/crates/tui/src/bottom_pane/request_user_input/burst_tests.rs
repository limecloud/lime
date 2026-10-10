use super::*;
use app_server_protocol::protocol::v2::ToolRequestUserInputQuestion;

fn request(count: usize) -> RequestUserInputOverlay {
    RequestUserInputOverlay::new(
        RequestId::Integer(88),
        ToolRequestUserInputParams {
            thread_id: "burst-thread".into(),
            turn_id: "burst-turn".into(),
            item_id: "burst-item".into(),
            questions: (0..count)
                .map(|index| ToolRequestUserInputQuestion {
                    id: format!("q{index}"),
                    header: format!("Question {index}"),
                    question: "Add a note".into(),
                    is_other: false,
                    is_secret: false,
                    options: None,
                })
                .collect(),
            is_blocking: true,
            auto_resolution_ms: None,
        },
    )
}

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn type_burst(request: &mut RequestUserInputOverlay, text: &str, now: Instant) {
    for character in text.chars() {
        let code = match character {
            '\n' => KeyCode::Enter,
            '\t' => KeyCode::Tab,
            character => KeyCode::Char(character),
        };
        assert!(request.handle_key_event_at(key(code), now).is_none());
    }
}

fn response(request: &mut RequestUserInputOverlay, now: Instant) -> ToolRequestUserInputResponse {
    let Some(AppServerResponse::UserInput { id, response }) =
        request.handle_key_event_at(key(KeyCode::Enter), now)
    else {
        panic!("explicit idle Enter must submit the complete note")
    };
    assert_eq!(id, RequestId::Integer(88));
    response
}

#[test]
fn held_typing_is_drawn_on_idle_without_accepting_the_question() {
    let now = Instant::now();
    let mut request = request(1);
    request.handle_key_event_at(key(KeyCode::Char('x')), now);
    assert!(request.composer.is_empty());
    assert_eq!(
        request.next_frame_delay(now),
        Some(crate::tui::TARGET_FRAME_INTERVAL)
    );
    assert!(request
        .pre_draw_tick(now + Duration::from_secs(1))
        .is_none());
    assert_eq!(request.composer.text(), "x");
    assert!(!request.answers[0].answer_committed);
    assert_eq!(request.next_frame_delay(now + Duration::from_secs(1)), None);
    assert_eq!(
        response(&mut request, now + Duration::from_secs(1)).answers,
        BTreeMap::from([(
            "q0".into(),
            ToolRequestUserInputAnswer {
                answers: vec!["user_note: x".into()]
            }
        )])
    );
}

#[test]
fn rapid_multiline_unicode_notes_keep_enter_tab_and_expand_only_on_submission() {
    let now = Instant::now();
    let text = format!("/model\t@file\n{}\nTAIL", "界🙂".repeat(501));
    let mut request = request(1);
    type_burst(&mut request, &text, now);
    assert!(request.pending_submission_draft.is_none());
    assert!(!request.answers[0].answer_committed);
    request.pre_draw_tick(now + Duration::from_secs(1));
    assert_eq!(request.composer.text(), "[Pasted Content 1020 chars]");
    assert!(!request.composer.completion_popup_active());
    assert_eq!(request.composer.current_text_with_pending(), text);
    assert_eq!(
        response(&mut request, now + Duration::from_secs(1)).answers["q0"].answers,
        [format!("user_note: {text}")]
    );
}

#[test]
fn held_ascii_followed_by_ime_input_keeps_notes_order_through_question_handoff() {
    let now = Instant::now();
    let mut request = request(2);
    type_burst(&mut request, "a界🙂b", now);
    request.handle_key_event_at(key(KeyCode::PageDown), now);
    assert_eq!(request.answers[0].draft.text_with_pending(), "a界🙂b");
    request.handle_paste("second");
    request.handle_key_event_at(key(KeyCode::PageUp), now);
    assert_eq!(request.composer.text(), "a界🙂b");
    request.handle_key_event_at(key(KeyCode::Enter), now);
    assert_eq!(
        response(&mut request, now).answers["q0"].answers,
        ["user_note: a界🙂b"]
    );
}

#[test]
fn question_handoff_materializes_held_text_and_preserves_submission_snapshot() {
    let now = Instant::now();
    let mut request = request(2);
    request.handle_key_event_at(key(KeyCode::Char('a')), now);
    request.handle_key_event_at(key(KeyCode::PageDown), now);
    assert_eq!(request.answers[0].draft.text_with_pending(), "a");
    request.handle_paste("second");
    request.handle_key_event_at(key(KeyCode::PageUp), now);
    assert_eq!(request.composer.text(), "a");
    assert_eq!(request.composer.cursor(), 1);
    assert!(request
        .handle_key_event_at(key(KeyCode::Enter), now)
        .is_none());
    assert!(request.answers[0].answer_committed);
    assert_eq!(request.answers[0].draft.text_with_pending(), "a");
    assert_eq!(
        response(&mut request, now).answers,
        BTreeMap::from([
            (
                "q0".into(),
                ToolRequestUserInputAnswer {
                    answers: vec!["user_note: a".into()]
                }
            ),
            (
                "q1".into(),
                ToolRequestUserInputAnswer {
                    answers: vec!["user_note: second".into()]
                }
            ),
        ])
    );
}

#[test]
fn held_edits_revoke_acceptance_before_the_next_draw_and_never_submit_old_text() {
    let now = Instant::now();
    let mut request = request(2);
    request.handle_paste("old");
    request.handle_key_event_at(key(KeyCode::Enter), now);
    request.handle_paste("second");
    request.handle_key_event_at(key(KeyCode::PageUp), now);
    request.handle_key_event_at(key(KeyCode::Char('x')), now);
    assert!(!request.answers[0].answer_committed);
    request.handle_key_event_at(key(KeyCode::PageDown), now);
    assert_eq!(request.answers[0].draft.text_with_pending(), "oldx");
    assert!(request
        .handle_key_event_at(key(KeyCode::Enter), now)
        .is_none());
    assert!(request.confirm_unanswered.is_some());
    assert_eq!(
        response(&mut request, now).answers["q0"].answers,
        Vec::<String>::new()
    );
}

#[test]
fn explicit_paste_joins_held_typing_and_modified_navigation_keeps_the_complete_draft() {
    let now = Instant::now();
    let mut request = request(1);
    type_burst(&mut request, "abc", now);
    request.handle_paste("界🙂");
    assert_eq!(request.composer.text(), "abc界🙂");
    request.handle_key_event_at(key(KeyCode::Left), now);
    assert_eq!(request.composer.cursor(), "abc界".len());
    assert_eq!(
        response(&mut request, now).answers["q0"].answers,
        ["user_note: abc界🙂"]
    );
}

#[test]
fn release_enter_neither_snoozes_auto_resolution_nor_consumes_a_burst() {
    let now = Instant::now();
    let mut request = request(1);
    request.params.is_blocking = false;
    let release =
        KeyEvent::new_with_kind(KeyCode::Enter, KeyModifiers::NONE, KeyEventKind::Release);
    request.handle_key_event_at(release, now);
    assert!(!request.auto_resolution_snoozed);
    type_burst(&mut request, "ab\ncd", now);
    assert!(request.handle_key_event_at(release, now).is_none());
    request.pre_draw_tick(now + Duration::from_secs(1));
    assert_eq!(request.composer.text(), "ab\ncd");
    assert_eq!(
        response(&mut request, now + Duration::from_secs(1)).answers["q0"].answers,
        ["user_note: ab\ncd"]
    );
}
