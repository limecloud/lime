use super::*;
use app_server_protocol::protocol::v2::ToolRequestUserInputQuestion;

fn request(question_count: usize) -> RequestUserInputOverlay {
    RequestUserInputOverlay::new(
        RequestId::Integer(85),
        ToolRequestUserInputParams {
            thread_id: "notes-thread".into(),
            turn_id: "notes-turn".into(),
            item_id: "notes-item".into(),
            questions: (0..question_count)
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

#[test]
fn notes_submit_literal_command_file_and_skill_text_without_popups() {
    for text in ["/model", "@parser", "$gate-skill", "!echo note"] {
        let mut request = request(1);
        request.handle_paste(text);
        assert!(!request.composer.completion_popup_active(), "{text}");
        assert!(request.composer.take_file_search_request().is_none());
        let Some(AppServerResponse::UserInput { id, response }) =
            request.handle_key_event(key(KeyCode::Enter))
        else {
            panic!("literal note was not submitted: {text}");
        };
        assert_eq!(id, RequestId::Integer(85));
        assert_eq!(
            response.answers["q0"].answers,
            [format!("user_note: {text}")]
        );
    }
}

#[test]
fn image_path_remains_literal_in_notes_while_main_composer_attaches_it() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("notes.png");
    image::RgbaImage::new(2, 2).save(&path).unwrap();
    let text = path.to_str().unwrap();
    let mut request = request(1);
    request.handle_paste(text);
    assert_eq!(request.composer.text(), text);
    assert!(request.composer.local_images().is_empty());
    let mut main = ChatComposer::default();
    main.handle_paste(text);
    assert_eq!(main.local_images()[0].path, path);
    assert_ne!(main.text(), text);
}

#[test]
fn notes_share_normalization_and_markdown_blockquote_paste() {
    let mut request = request(1);
    request.handle_paste("> ");
    request.handle_paste("alpha\r\nbeta\rgamma");
    assert_eq!(request.composer.text(), "> alpha\n> beta\n> gamma\n\n");
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("blockquote answer was not submitted");
    };
    assert_eq!(
        response.answers["q0"].answers,
        ["user_note: > alpha\n> beta\n> gamma"]
    );
}

#[test]
fn question_navigation_restores_cursor_atomic_paste_and_exact_expanded_answers() {
    let mut request = request(2);
    let first = format!("FIRST\n{}\nEND", "界🙂".repeat(501));
    request.handle_paste(&first);
    assert_ne!(request.composer.text(), first);
    request
        .composer
        .handle_key_event(KeyEvent::new(KeyCode::Home, KeyModifiers::CONTROL));
    let first_draft = request.composer.snapshot_draft();
    assert!(request.handle_key_event(key(KeyCode::PageDown)).is_none());
    request.handle_paste("second answer");
    request.composer.handle_key_event(key(KeyCode::Left));
    let second_draft = request.composer.snapshot_draft();
    assert!(request.handle_key_event(key(KeyCode::PageUp)).is_none());
    assert_eq!(request.composer.snapshot_draft(), first_draft);
    assert_eq!(request.composer.current_text_with_pending(), first);
    assert!(!request.composer.completion_popup_active());
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.composer.snapshot_draft(), second_draft);
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("both notes were not submitted");
    };
    assert_eq!(
        response.answers["q0"].answers,
        [format!("user_note: {first}")]
    );
    assert_eq!(response.answers["q1"].answers, ["user_note: second answer"]);
}

#[test]
fn expanded_limit_rejection_preserves_the_note_across_question_navigation() {
    let mut request = request(2);
    let text = "界".repeat(agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS + 1);
    request.handle_paste(&text);
    let draft = request.composer.snapshot_draft();
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.submission_error, Some(text.chars().count()));
    assert_eq!(request.composer.snapshot_draft(), draft);
    assert!(request
        .answers
        .iter()
        .all(|answer| !answer.answer_committed));
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_key_event(key(KeyCode::PageUp));
    assert_eq!(request.composer.snapshot_draft(), draft);
    assert_eq!(request.composer.current_text_with_pending(), text);
}

#[test]
fn switching_questions_starts_a_new_vim_edit_lifetime() {
    let mut request = request(2);
    request.composer.set_vim_enabled(true);
    request.handle_paste("first note");
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_paste("second note");
    request.handle_key_event(key(KeyCode::PageUp));
    request.composer.handle_key_event(key(KeyCode::Char('u')));
    assert_eq!(request.composer.text(), "first note");
    request.handle_key_event(key(KeyCode::PageDown));
    request.composer.handle_key_event(key(KeyCode::Char('u')));
    assert_eq!(request.composer.text(), "second note");
}

#[test]
fn empty_slash_stays_vim_search_in_plain_notes() {
    let mut request = request(1);
    request.composer.set_vim_enabled(true);
    request.handle_key_event(key(KeyCode::Char('/')));
    assert!(request.composer.vim_search_active());
    assert!(!request.composer.completion_popup_active());
    assert!(request.composer.is_empty());
}

#[test]
fn notes_paste_uses_current_host_locale_when_enqueued_updated_and_restored() {
    use super::super::{BottomPane, PendingInteraction};
    use crate::locale::Locale;

    let text = "界".repeat(1001);
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut pane = BottomPane::default();
        pane.set_locale(locale);
        pane.enqueue(
            app_server_protocol::protocol::v2::ServerRequest::ItemToolRequestUserInput {
                id: RequestId::Integer(85),
                params: request(1).params,
            },
        )
        .unwrap();
        pane.handle_paste(&text);
        let Some(PendingInteraction::UserInput(notes)) = pane.queue.front() else {
            panic!("notes view missing");
        };
        assert_eq!(notes.composer.text(), locale.pasted_content_label(1001));
        let state = pane.take_input_state();
        pane.set_locale(Locale::EnUs);
        pane.restore_input_state(state);
        let Some(PendingInteraction::UserInput(notes)) = pane.queue.front_mut() else {
            panic!("restored notes view missing");
        };
        notes.composer.replace(String::new());
        pane.handle_paste(&text);
        let Some(PendingInteraction::UserInput(notes)) = pane.queue.front_mut() else {
            panic!("restored notes view missing");
        };
        assert_eq!(
            notes.composer.text(),
            Locale::EnUs.pasted_content_label(1001)
        );
        notes.composer.replace(String::new());
        pane.set_locale(locale);
        pane.handle_paste(&text);
        let Some(PendingInteraction::UserInput(notes)) = pane.queue.front() else {
            panic!("updated notes view missing");
        };
        assert_eq!(notes.composer.text(), locale.pasted_content_label(1001));
        assert_eq!(notes.composer.current_text_with_pending(), text);
    }
}

#[test]
fn accepted_long_note_can_be_revisited_edited_and_accepted_without_losing_other_drafts() {
    let mut request = request(2);
    let original = "界🙂".repeat(501);
    request.handle_paste(&original);
    let accepted_draft = request.composer.snapshot_draft();
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert!(request.answers[0].answer_committed);
    assert_eq!(request.answers[0].draft.text_with_pending(), original);
    assert!(request.pending_submission_draft.is_none());
    request.handle_paste("second answer");
    request.composer.handle_key_event(key(KeyCode::Left));
    let second_draft = request.composer.snapshot_draft();
    request.handle_key_event(key(KeyCode::PageUp));
    assert_eq!(request.composer.snapshot_draft(), accepted_draft);
    request.handle_paste(" revised");
    assert!(request.handle_key_event(key(KeyCode::Enter)).is_none());
    assert_eq!(request.composer.snapshot_draft(), second_draft);
    let Some(AppServerResponse::UserInput { response, .. }) =
        request.handle_key_event(key(KeyCode::Enter))
    else {
        panic!("revised questionnaire was not submitted");
    };
    assert_eq!(
        response.answers["q0"].answers,
        [format!("user_note: {original} revised")]
    );
    assert_eq!(response.answers["q1"].answers, ["user_note: second answer"]);
}

#[test]
fn rejected_or_vim_search_enter_does_not_leave_a_pending_submission_snapshot() {
    let mut request = request(2);
    request.composer.set_vim_enabled(true);
    request.handle_key_event(key(KeyCode::Char('/')));
    request.handle_key_event(key(KeyCode::Enter));
    assert!(request.pending_submission_draft.is_none());
    assert!(request
        .answers
        .iter()
        .all(|answer| !answer.answer_committed));
    request.composer.set_vim_enabled(false);
    let text = "界".repeat(agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS + 1);
    request.handle_paste(&text);
    request.handle_key_event(key(KeyCode::Enter));
    assert!(request.pending_submission_draft.is_none());
    assert!(request
        .answers
        .iter()
        .all(|answer| !answer.answer_committed));
    let draft = request.composer.snapshot_draft();
    request.handle_key_event(key(KeyCode::PageDown));
    request.handle_key_event(key(KeyCode::PageUp));
    assert_eq!(request.composer.snapshot_draft(), draft);
}

#[test]
fn modified_enter_in_an_empty_note_inserts_a_newline_without_accepting_an_answer() {
    for modifiers in [KeyModifiers::SHIFT, KeyModifiers::ALT] {
        let mut request = request(2);
        assert!(request
            .handle_key_event(KeyEvent::new(KeyCode::Enter, modifiers))
            .is_none());
        assert_eq!(request.composer.text(), "\n");
        assert_eq!(request.question_index, 0);
        assert!(request
            .answers
            .iter()
            .all(|answer| !answer.answer_committed));
        assert!(request.pending_submission_draft.is_none());
    }
}
