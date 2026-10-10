use super::*;
use app_server_protocol::protocol::v2::{ToolRequestUserInputOption, ToolRequestUserInputQuestion};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn request(has_options: bool) -> RequestUserInputOverlay {
    RequestUserInputOverlay::new(
        RequestId::Integer(87),
        ToolRequestUserInputParams {
            thread_id: "state-thread".into(),
            turn_id: "state-turn".into(),
            item_id: "state-item".into(),
            questions: (0..2)
                .map(|index| ToolRequestUserInputQuestion {
                    id: format!("q{index}"),
                    header: format!("Question {index}"),
                    question: "Choose or add notes".into(),
                    is_other: false,
                    is_secret: false,
                    options: (has_options && index == 0).then(|| {
                        vec![
                            ToolRequestUserInputOption {
                                label: "Fast".into(),
                                description: String::new(),
                            },
                            ToolRequestUserInputOption {
                                label: "Safe".into(),
                                description: String::new(),
                            },
                        ]
                    }),
                })
                .collect(),
            is_blocking: true,
            auto_resolution_ms: None,
        },
    )
}

#[test]
fn response_keeps_authored_labels_and_encodes_freeform_and_secret_notes_uniformly() {
    let mut request = request(true);
    request.params.questions[0].options.as_mut().unwrap()[0].label = "Other".into();
    request.params.questions[1].is_secret = true;
    request.handle_key_event(key(KeyCode::Tab));
    request.handle_paste("  selected detail  ");
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    request.handle_paste("  user_note: literal 界🙂  ");
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("accepted option and secret notes must return one complete response");
    };
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        serde_json::json!({"answers": {
            "q0": {"answers": ["Other", "user_note: selected detail"]},
            "q1": {"answers": ["user_note: user_note: literal 界🙂"]}
        }})
    );
}

#[test]
fn synthetic_choice_keeps_its_wire_label_with_an_unanswered_freeform_question() {
    let mut request = request(true);
    request.params.questions[0].is_other = true;
    request.handle_key_event(key(KeyCode::Down));
    request.handle_key_event(key(KeyCode::Down));
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert!(request.confirm_unanswered.is_some());
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("explicit unanswered confirmation must return the selected synthetic label");
    };
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        serde_json::json!({"answers": {
            "q0": {"answers": ["None of the above"]},
            "q1": {"answers": []}
        }})
    );
}

#[test]
fn cursor_and_focus_navigation_preserve_acceptance_but_content_changes_revoke_it() {
    let mut request = request(true);
    request.handle_key_event(key(KeyCode::Tab));
    request.handle_paste(&"界🙂".repeat(501));
    request.handle_key_event(key(KeyCode::Enter));
    assert!(request.answers[0].answer_committed);
    request.handle_key_event(key(KeyCode::PageUp));
    let original = request.composer.snapshot_draft();
    request.handle_key_event(key(KeyCode::Left));
    assert!(request.answers[0].answer_committed);
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_key_event(key(KeyCode::PageUp));
    assert_ne!(request.composer.snapshot_draft(), original);
    assert!(request.answers[0].answer_committed);
    request.handle_paste(" revised");
    assert!(!request.answers[0].answer_committed);
}

#[test]
fn editing_an_accepted_note_then_skipping_it_never_submits_the_old_answer() {
    let mut request = request(false);
    request.handle_paste("old answer");
    request.handle_key_event(key(KeyCode::Enter));
    request.handle_paste("second answer");
    request.handle_key_event(key(KeyCode::PageUp));
    request.handle_paste(" revised");
    let revised = request.composer.snapshot_draft();
    request.handle_key_event(key(KeyCode::PageDown));
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.unanswered_count(), 1);
    assert!(request.confirm_unanswered.is_some());
    assert_eq!(request.answers[0].draft, revised);
    let Some(AppServerResponse::UserInput { id, response }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("explicit proceed was not accepted")
    };
    assert_eq!(id, RequestId::Integer(87));
    assert_eq!(
        response.answers,
        BTreeMap::from([
            ("q0".into(), ToolRequestUserInputAnswer { answers: vec![] }),
            (
                "q1".into(),
                ToolRequestUserInputAnswer {
                    answers: vec!["user_note: second answer".into()]
                }
            ),
        ])
    );
}

#[test]
fn changing_an_accepted_option_requires_accepting_it_again() {
    let mut request = request(true);
    request.handle_key_event(key(KeyCode::Enter));
    request.handle_key_event(key(KeyCode::PageUp));
    request.handle_key_event(key(KeyCode::Down));
    assert_eq!(request.selected(), 1);
    assert!(!request.answers[0].answer_committed);
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_paste("follow-up");
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    request.handle_key_event(key(KeyCode::Down));
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.question_index, 0);
    assert_eq!(request.selected(), 1);
    request.handle_key_event(key(KeyCode::Enter));
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("reaccepted option missing")
    };
    assert_eq!(response.answers["q0"].answers, ["Safe"]);
    assert_eq!(response.answers["q1"].answers, ["user_note: follow-up"]);
}

#[test]
fn skipped_and_empty_freeform_answers_require_confirmation_and_return_to_the_first_unanswered() {
    let mut request = request(false);
    request.handle_paste("unaccepted draft");
    let first = request.composer.snapshot_draft();
    request.handle_key_event(key(KeyCode::PageDown));
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.unanswered_count(), 2);
    assert!(request.confirm_unanswered.is_some());
    assert!(request.handle_key_event(key(KeyCode::Char('2'))).is_none());
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.question_index, 0);
    assert!(request.confirm_unanswered.is_none());
    assert_eq!(request.composer.snapshot_draft(), first);
}

#[test]
fn confirmation_consumes_remapped_chords_and_ignores_release_and_unbound_enter() {
    let mut request = request(false);
    let config: lime_core::config::TuiKeymap = serde_json::from_value(serde_json::json!({
        "list": { "accept": "f9", "cancel": "ctrl-x q" }
    }))
    .unwrap();
    let bindings = crate::keymap::RuntimeKeymap::from_config(&config).unwrap();
    request.set_keymap_bindings(&bindings);
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_key_event(key(KeyCode::Enter));
    assert!(request.confirm_unanswered.is_some());
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    let mut release = key(KeyCode::F(9));
    release.kind = KeyEventKind::Release;
    assert!(request.handle_key_event(release).is_none());
    request.handle_key_event(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL));
    assert!(request.handle_key_event(key(KeyCode::F(9))).is_none());
    assert!(request.confirm_unanswered.is_some());
    request.handle_key_event(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL));
    request.handle_key_event(key(KeyCode::Char('q')));
    assert!(request.confirm_unanswered.is_none());
    assert_eq!(request.question_index, 0);
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_key_event(key(KeyCode::Enter));
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::F(9)))
    else {
        panic!("configured accept did not submit")
    };
    assert_eq!(response.answers.len(), 2);
    assert!(response
        .answers
        .values()
        .all(|answer| answer.answers.is_empty()));
    assert!(request
        .confirmation_footer_hints(crate::locale::Locale::EnUs, 80)
        .join(" · ")
        .contains("f9"));
}

#[test]
fn vim_query_owns_escape_and_question_navigation_without_revoking_accepted_content() {
    let mut request = request(true);
    request.handle_key_event(key(KeyCode::Tab));
    request.handle_paste("accepted note");
    request.handle_key_event(key(KeyCode::Enter));
    request.handle_key_event(key(KeyCode::PageUp));
    request.composer.set_vim_enabled(true);
    request.handle_key_event(key(KeyCode::Char('/')));
    assert!(request.composer.vim_search_active());
    request.handle_key_event(key(KeyCode::PageDown));
    assert_eq!(request.question_index, 0);
    request.handle_key_event(key(KeyCode::Esc));
    assert!(!request.composer.vim_search_active());
    assert!(request.editing());
    assert_eq!(request.composer.text(), "accepted note");
    assert!(request.answers[0].answer_committed);
}
