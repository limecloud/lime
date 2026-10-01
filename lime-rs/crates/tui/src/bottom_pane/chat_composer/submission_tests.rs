use super::*;
use crate::bottom_pane::LocalImageAttachment;
use agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS;

#[test]
fn trim_rebases_and_clips_elements_using_utf8_bytes() {
    let original = "\u{3000}\t $技能 🙂 \n";
    let trimmed = "$技能 🙂";
    assert_eq!(
        ChatComposer::trim_text_elements(
            original,
            trimmed,
            vec![
                TextElement::new(0..4, None),
                TextElement::new(4..12, Some("different label".into())),
                TextElement::new(13..19, None),
                TextElement::new(19..20, None),
            ],
        ),
        vec![
            TextElement::new(0..7, Some("$技能".into())),
            TextElement::new(8..12, None),
        ]
    );
    assert!(
        ChatComposer::trim_text_elements(" \n", "", vec![TextElement::new(0..2, None)]).is_empty()
    );
}

#[test]
fn submit_and_queue_expand_then_trim_and_keep_complete_attachment_mentions_and_history() {
    for should_queue in [false, true] {
        let mut composer = ChatComposer::default();
        composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
        composer.insert("\u{3000}\n");
        let payload = format!("\t {} ", "界🙂".repeat(501));
        composer.handle_paste(&payload);
        composer.insert(" $review");
        let end = composer.text().len();
        composer.insert_selected_mention(end - 7..end, "$review", Some("/skills/review/SKILL.md"));
        composer.insert(" ");
        composer.attach_image("one.png".into());
        composer.insert("\t \n");
        let expected_text = format!("{}  $review  [Image #2]", "界🙂".repeat(501));
        let mention_start = "界🙂".repeat(501).len() + 2;
        let elements = vec![
            TextElement::new(mention_start..mention_start + 7, Some("$review".into())),
            TextElement::new(
                mention_start + 9..mention_start + 19,
                Some("[Image #2]".into()),
            ),
        ];
        let expected_result = if should_queue {
            InputResult::Queued {
                text: expected_text.clone(),
                text_elements: elements.clone(),
            }
        } else {
            InputResult::Submitted {
                text: expected_text.clone(),
                text_elements: elements.clone(),
            }
        };
        assert_eq!(composer.handle_submission(should_queue), expected_result);
        assert!(composer.text().is_empty());
        assert!(composer.draft.pending_pastes.is_empty());
        let bindings = vec![MentionBinding {
            sigil: '$',
            mention: "review".into(),
            path: "/skills/review/SKILL.md".into(),
        }];
        assert_eq!(composer.take_recent_submission_mention_bindings(), bindings);
        assert_eq!(
            composer.take_recent_submission_images_with_placeholders(),
            vec![LocalImageAttachment {
                placeholder: "[Image #2]".into(),
                path: "one.png".into(),
                detail: None,
            }]
        );
        assert_eq!(
            composer.take_remote_image_urls(),
            vec!["https://example.test/remote.png"]
        );
        assert_eq!(composer.history_previous(), InputResult::Changed);
        assert_eq!(
            composer.snapshot_history_entry(),
            HistoryEntry {
                text: expected_text,
                text_elements: elements,
                local_images: vec![LocalImageAttachment {
                    placeholder: "[Image #2]".into(),
                    path: "one.png".into(),
                    detail: None
                }],
                remote_images: vec![crate::bottom_pane::RemoteImageAttachment {
                    url: "https://example.test/remote.png".into(),
                    detail: None
                }],
                pending_pastes: Vec::new(),
                mention_bindings: bindings,
            }
        );
    }
}

#[test]
fn expanded_unicode_limit_accepts_boundary_after_trim() {
    let mut composer = ChatComposer::default();
    let payload = "界".repeat(MAX_USER_INPUT_TEXT_CHARS);
    composer.handle_paste(&format!("\u{3000}\n{payload}\t "));
    assert_eq!(
        composer.submit(),
        InputResult::Submitted {
            text: payload,
            text_elements: Vec::new()
        }
    );
    assert!(composer.draft.pending_pastes.is_empty());
}

#[test]
fn rejected_submit_and_queue_preserve_complete_folded_draft_cursor_and_history() {
    for should_queue in [false, true] {
        let mut composer = ChatComposer::default();
        composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
        composer.insert("$review");
        composer.insert_selected_mention(0..7, "$review", Some("/one/SKILL.md"));
        composer.insert(" ");
        composer.attach_image("one.png".into());
        composer.handle_paste(&"🙂".repeat(MAX_USER_INPUT_TEXT_CHARS));
        composer.draft.textarea.set_cursor(3);
        let before = composer.snapshot_draft();
        let actual_chars = composer.current_text_with_pending().trim().chars().count();
        assert_eq!(
            composer.handle_submission(should_queue),
            InputResult::SubmissionRejected { actual_chars }
        );
        assert_eq!(composer.snapshot_draft(), before);
        assert!(composer.history.is_empty());
        assert!(composer
            .take_recent_submission_mention_bindings()
            .is_empty());
        // Editing away the folded payload remains atomic and permits a corrected retry.
        composer.draft.textarea.set_cursor(composer.text().len());
        composer.handle_key_event(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
        assert!(composer.draft.pending_pastes.is_empty());
        assert!(matches!(composer.submit(), InputResult::Submitted { .. }));
    }
}

#[test]
fn expanded_whitespace_does_not_dispatch_or_record_history_but_remote_image_can_submit() {
    let mut composer = ChatComposer::default();
    composer.handle_paste(&"\u{3000}".repeat(1001));
    assert_eq!(composer.queue(), InputResult::None);
    assert!(composer.history.is_empty());
    composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
    assert_eq!(
        composer.submit(),
        InputResult::Submitted {
            text: String::new(),
            text_elements: Vec::new()
        }
    );
    assert_eq!(
        composer.take_remote_image_urls(),
        vec!["https://example.test/remote.png"]
    );
}
