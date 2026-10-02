use super::*;
use crate::bottom_pane::RemoteImageAttachment;
use crate::tui::TuiEvent;
use agent_protocol::TextElement;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[test]
fn rejected_composer_input_stays_local_and_projects_a_visible_error_without_a_submit_action() {
    let mut app = App::default();
    let actual_chars = agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS + 1;
    app.chat_widget
        .bottom_pane
        .handle_paste(&"界".repeat(actual_chars));
    let before = app.chat_widget.bottom_pane.composer_snapshot();
    let result = app
        .chat_widget
        .bottom_pane
        .handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    assert!(matches!(
        app.map_chat_widget_action(result),
        AppAction::None
    ));
    assert_eq!(app.chat_widget.bottom_pane.composer_snapshot(), before);
    let entry = app
        .projection
        .entries()
        .last()
        .expect("local size error must be visible");
    assert_eq!(entry.kind, crate::projection::EntryKind::Error);
    assert_eq!(
        entry.text,
        app.locale.user_input_too_large_message(actual_chars)
    );
}

fn skill(name: &str, path: &str) -> app_server_protocol::protocol::v2::SkillMetadata {
    app_server_protocol::protocol::v2::SkillMetadata {
        name: name.into(),
        description: "Test skill".into(),
        short_description: None,
        interface: None,
        dependencies: None,
        path: path.into(),
        scope: app_server_protocol::protocol::v2::SkillScope::User,
        enabled: true,
    }
}

fn binding(name: &str, path: &str) -> crate::bottom_pane::MentionBinding {
    crate::bottom_pane::MentionBinding {
        sigil: '$',
        mention: name.into(),
        path: path.into(),
    }
}

fn remote(url: &str) -> RemoteImageAttachment {
    RemoteImageAttachment {
        url: url.into(),
        detail: None,
    }
}

#[test]
fn submission_preserves_image_text_skill_order_and_image_only_input() {
    use super::input_submission::submission_input;
    let images = vec![LocalImageAttachment {
        placeholder: "[Image #2]".into(),
        path: "one.png".into(),
        detail: None,
    }];
    let skills = vec![skill("review", "/one/SKILL.md")];
    let elements = vec![TextElement::new(0..7, Some("$review".into()))];
    assert_eq!(
        submission_input(
            "$review".into(),
            &images,
            &[remote("https://example.test/remote.png")],
            &skills,
            elements.clone(),
            &[]
        ),
        vec![
            UserInput::Image {
                detail: None,
                url: "https://example.test/remote.png".into()
            },
            UserInput::LocalImage {
                detail: None,
                path: "one.png".into()
            },
            UserInput::Text {
                text: "$review".into(),
                text_elements: elements
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/one/SKILL.md".into()
            },
        ]
    );
    assert_eq!(
        submission_input(String::new(), &images, &[], &[], Vec::new(), &[]),
        vec![UserInput::LocalImage {
            detail: None,
            path: "one.png".into()
        }]
    );
    assert_eq!(
        submission_input(
            "describe".into(),
            &[],
            &[remote("remote")],
            &[],
            Vec::new(),
            &[]
        ),
        vec![
            UserInput::Image {
                detail: None,
                url: "remote".into()
            },
            UserInput::Text {
                text: "describe".into(),
                text_elements: Vec::new()
            },
        ]
    );
}

#[test]
fn selected_paths_precede_typed_names_and_never_fall_back_after_catalog_refresh() {
    use super::input_submission::submission_input;
    let skills = vec![
        skill("review", "/one/SKILL.md"),
        skill("review", "/two/SKILL.md"),
    ];
    let bindings = vec![
        binding("review", "/two/SKILL.md"),
        binding("review", "/one/SKILL.md"),
        binding("review", "/two/SKILL.md"),
    ];
    let input = submission_input(
        "$review $review".into(),
        &[],
        &[],
        &skills,
        Vec::new(),
        &bindings,
    );
    assert_eq!(
        &input[1..],
        &[
            UserInput::Skill {
                name: "review".into(),
                path: "/two/SKILL.md".into()
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/one/SKILL.md".into()
            },
        ]
    );
    let refreshed = submission_input(
        "$review".into(),
        &[],
        &[],
        &skills[..1],
        Vec::new(),
        &[binding("review", "/two/SKILL.md")],
    );
    assert_eq!(refreshed.len(), 1);
    let mut disabled = skills[1].clone();
    disabled.enabled = false;
    assert_eq!(
        submission_input(
            "$review".into(),
            &[],
            &[],
            &[disabled],
            Vec::new(),
            &bindings
        )
        .len(),
        1
    );
}

#[test]
fn typed_punctuation_linked_paths_and_environment_variables_follow_codex_scanning() {
    use super::input_submission::submission_input;
    let skills = vec![
        skill("review", "/one/SKILL.md"),
        skill("review", "/two/SKILL.md"),
        skill("HOME", "/env/SKILL.md"),
    ];
    let input = submission_input(
        "界 ($review), [$review](skill:///two/SKILL.md) $HOME".into(),
        &[],
        &[],
        &skills,
        Vec::new(),
        &[],
    );
    assert_eq!(
        &input[1..],
        &[UserInput::Skill {
            name: "review".into(),
            path: "/two/SKILL.md".into()
        }]
    );
    let input = submission_input(
        "[$review](app://unavailable)".into(),
        &[],
        &[],
        &skills,
        Vec::new(),
        &[],
    );
    assert_eq!(input.len(), 1);
}

#[test]
fn canonical_queue_and_failed_transport_restore_selected_paths_without_duplicate_tokens() {
    let mut app = App::default();
    let elements = vec![TextElement::new(4..11, Some("$review".into()))];
    let queued = QueuedSubmission {
        id: "mentions".into(),
        client_user_message_id: "client".into(),
        input: vec![
            UserInput::Text {
                text: "界 $review".into(),
                text_elements: elements.clone(),
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/two/SKILL.md".into(),
            },
        ],
    };
    app.set_queued_submissions(vec![queued.clone()]);
    assert!(app.restore_queued_submission_for_edit(queued));
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "界 $review");
    let AppAction::Submit {
        text,
        text_elements,
    } = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    )
    else {
        panic!("submit")
    };
    let bindings = app.take_recent_submission_mention_bindings();
    assert_eq!(bindings, vec![binding("review", "/two/SKILL.md")]);
    app.restore_submission_draft(
        text,
        text_elements,
        Vec::new(),
        Vec::new(),
        bindings.clone(),
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        elements
    );
    assert!(matches!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true
        ),
        AppAction::Submit { .. }
    ));
    assert_eq!(app.take_recent_submission_mention_bindings(), bindings);
}

#[test]
fn queue_edit_rebases_multiple_text_parts_and_skill_prefix_without_losing_inline_image() {
    let mut app = App::default();
    let queued = QueuedSubmission {
        id: "queued-images".into(),
        client_user_message_id: "client-images".into(),
        input: vec![
            UserInput::Image {
                detail: None,
                url: "https://example.test/remote.png".into(),
            },
            UserInput::LocalImage {
                detail: None,
                path: "one.png".into(),
            },
            UserInput::Text {
                text: "界[Image #2]".into(),
                text_elements: vec![TextElement::new(3..13, Some("[Image #2]".into()))],
            },
            UserInput::Text {
                text: " tail [token]".into(),
                text_elements: vec![TextElement::new(6..13, Some("[token]".into()))],
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/skills/review/SKILL.md".into(),
            },
        ],
    };
    app.set_queued_submissions(vec![queued.clone()]);
    assert!(app.restore_queued_submission_for_edit(queued));
    let text = "$review 界[Image #2] tail [token]";
    let elements = vec![
        TextElement::new(0..7, Some("$review".into())),
        TextElement::new(11..21, Some("[Image #2]".into())),
        TextElement::new(27..34, Some("[token]".into())),
    ];
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), text);
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        elements
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_local_images(),
        vec![LocalImageAttachment {
            placeholder: "[Image #2]".into(),
            path: "one.png".into(),
            detail: None,
        }]
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true
        ),
        AppAction::Submit {
            text: text.into(),
            text_elements: elements
        }
    );
    assert_eq!(
        app.take_recent_submission_images_with_placeholders()[0].path,
        PathBuf::from("one.png")
    );
    assert_eq!(
        app.take_remote_image_urls(),
        vec!["https://example.test/remote.png"]
    );
    assert!(app.queued_submissions.is_empty());
}

#[test]
fn queue_edit_counts_duplicate_elements_and_orders_missing_bindings_before_text() {
    use super::input_submission::submission_input;
    let mut app = App::default();
    let queued = QueuedSubmission {
        id: "duplicate-skills".into(),
        client_user_message_id: "client".into(),
        input: vec![
            UserInput::Text {
                text: "$review".into(),
                text_elements: vec![TextElement::new(0..7, Some("$review".into()))],
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/one/SKILL.md".into(),
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/two/SKILL.md".into(),
            },
        ],
    };
    assert!(app.restore_queued_submission_for_edit(queued));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "$review $review"
    );
    let AppAction::Submit {
        text,
        text_elements,
    } = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    )
    else {
        panic!("submit")
    };
    let bindings = app.take_recent_submission_mention_bindings();
    assert_eq!(
        bindings,
        vec![
            binding("review", "/two/SKILL.md"),
            binding("review", "/one/SKILL.md")
        ]
    );
    let skills = vec![
        skill("review", "/one/SKILL.md"),
        skill("review", "/two/SKILL.md"),
    ];
    assert_eq!(
        &submission_input(text, &[], &[], &skills, text_elements, &bindings)[1..],
        &[
            UserInput::Skill {
                name: "review".into(),
                path: "/two/SKILL.md".into()
            },
            UserInput::Skill {
                name: "review".into(),
                path: "/one/SKILL.md".into()
            },
        ]
    );
}

#[test]
fn canonical_image_without_inline_metadata_adds_owned_prefix_but_never_reuses_literal_token() {
    let mut app = App::default();
    app.restore_submission_draft(
        "literal [Image #1]".into(),
        Vec::new(),
        vec![LocalImageAttachment {
            placeholder: "[Image #1]".into(),
            path: "one.png".into(),
            detail: None,
        }],
        Vec::new(),
        Vec::new(),
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "[Image #1] literal [Image #1]"
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        vec![TextElement::new(0..10, Some("[Image #1]".into()))]
    );
    app.chat_widget
        .bottom_pane
        .handle_disconnected_key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
    app.chat_widget
        .bottom_pane
        .handle_disconnected_key(KeyEvent::new(KeyCode::Delete, KeyModifiers::NONE));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        " literal [Image #1]"
    );
    assert!(!app.chat_widget.bottom_pane.composer_has_pending_images());
}

#[test]
fn canonical_queue_edit_resubmit_history_and_failure_restore_keep_all_image_details_and_none_elements(
) {
    use super::input_submission::submission_input;
    use agent_protocol::ImageDetail;
    for detail in [
        None,
        Some(ImageDetail::Auto),
        Some(ImageDetail::Low),
        Some(ImageDetail::High),
        Some(ImageDetail::Original),
    ] {
        let mut app = App::default();
        let input = vec![
            UserInput::Image {
                url: "data:image/png;base64,AA==".into(),
                detail,
            },
            UserInput::LocalImage {
                path: "one.png".into(),
                detail,
            },
            UserInput::Text {
                text: "界[Image #2] [token]".into(),
                text_elements: vec![
                    TextElement::new(3..13, None),
                    TextElement::new(14..21, Some("[token]".into())),
                ],
            },
        ];
        let queued = QueuedSubmission {
            id: "typed-queue".into(),
            client_user_message_id: "typed-client".into(),
            input: input.clone(),
        };
        app.set_queued_submissions(vec![queued.clone()]);
        assert!(app.restore_queued_submission_for_edit(queued));
        assert!(app.queued_submissions.is_empty());
        let AppAction::Submit {
            text,
            text_elements,
        } = app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        )
        else {
            panic!("typed draft must submit")
        };
        let local = app.take_recent_submission_images_with_placeholders();
        let remote = app.take_remote_images();
        assert_eq!(
            submission_input(
                text.clone(),
                &local,
                &remote,
                &[],
                text_elements.clone(),
                &[]
            ),
            input,
            "resubmit must retain {detail:?}"
        );
        app.restore_submission_draft(
            text,
            text_elements,
            local.clone(),
            remote.clone(),
            Vec::new(),
        );
        assert_eq!(app.chat_widget.bottom_pane.composer_local_images(), local);
        assert_eq!(app.chat_widget.bottom_pane.composer_remote_images(), remote);
        app.chat_widget.bottom_pane.clear_composer_for_ctrl_c();
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(
            app.chat_widget.bottom_pane.composer_local_images(),
            local,
            "history must retain {detail:?}"
        );
        assert_eq!(app.chat_widget.bottom_pane.composer_remote_images(), remote);
        assert_eq!(
            app.chat_widget.bottom_pane.composer_text_elements(),
            vec![
                TextElement::new(3..13, None),
                TextElement::new(14..21, Some("[token]".into()))
            ]
        );
    }
}
