use super::super::{ChatComposer, InputResult};
use super::*;
use agent_protocol::TextElement;
use crossterm::event::KeyModifiers;

fn key(composer: &mut ChatComposer, code: KeyCode) -> InputResult {
    composer.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE))
}

#[test]
fn attach_at_cursor_and_submit_keep_complete_inline_input() {
    let mut composer = ChatComposer::default();
    composer.insert("界🙂 tail");
    composer.draft.textarea.set_cursor("界".len());
    composer.attach_image("one.png".into());
    assert_eq!(composer.text(), "界[Image #1]🙂 tail");
    assert_eq!(composer.cursor(), 13);
    let expected = vec![TextElement::new(3..13, Some("[Image #1]".into()))];
    assert_eq!(
        key(&mut composer, KeyCode::Enter),
        InputResult::Submitted {
            text: "界[Image #1]🙂 tail".into(),
            text_elements: expected,
        }
    );
    assert!(composer.textarea().is_empty());
    assert_eq!(
        composer.take_recent_submission_images_with_placeholders(),
        vec![LocalImageAttachment {
            placeholder: "[Image #1]".into(),
            path: "one.png".into(),
            detail: None,
        }]
    );
    assert!(!composer.has_pending_images());
}

#[test]
fn deleting_reordered_middle_image_renumbers_owned_ranges_not_literal_labels() {
    let mut composer = ChatComposer::default();
    let text = "[Image #3] [Image #2] [Image #1] literal [Image #3]";
    composer.set_text_content(
        text.into(),
        vec![
            TextElement::new(0..10, Some("[Image #3]".into())),
            TextElement::new(11..21, Some("[Image #2]".into())),
            TextElement::new(22..32, Some("[Image #1]".into())),
        ],
        (1..=3)
            .map(|index| LocalImageAttachment {
                placeholder: format!("[Image #{index}]"),
                path: PathBuf::from(format!("{index}.png")),
                detail: None,
            })
            .collect(),
        Vec::new(),
    );
    composer.draft.textarea.set_cursor(21);
    key(&mut composer, KeyCode::Backspace);
    assert_eq!(composer.text(), "[Image #2]  [Image #1] literal [Image #3]");
    assert_eq!(
        composer.local_image_paths(),
        vec![PathBuf::from("1.png"), PathBuf::from("3.png")]
    );
    assert_eq!(
        composer.textarea().text_elements(),
        vec![
            TextElement::new(0..10, Some("[Image #2]".into())),
            TextElement::new(12..22, Some("[Image #1]".into())),
        ]
    );
    assert_eq!(composer.cursor(), 11);
}

#[test]
fn remote_prefix_growth_shrink_and_digit_boundary_preserve_image_identity() {
    let mut composer = ChatComposer::default();
    composer.attach_image("one.png".into());
    composer.draft.textarea.set_cursor(0);
    composer.attach_image("two.png".into());
    composer.insert(" literal [Image #1] [Image #2]");
    for count in [1, 9, 8, 0] {
        composer.set_remote_image_urls(
            (0..count)
                .map(|index| format!("https://example.test/{index}.png"))
                .collect(),
        );
        assert_eq!(
            composer.text(),
            format!(
                "[Image #{}] literal [Image #1] [Image #2][Image #{}]",
                count + 2,
                count + 1
            )
        );
        let elements = composer.textarea().text_elements();
        assert_eq!(
            elements
                .iter()
                .map(|element| element.placeholder(composer.text()).unwrap())
                .collect::<Vec<_>>(),
            vec![
                format!("[Image #{}]", count + 2),
                format!("[Image #{}]", count + 1)
            ]
        );
        assert!(composer.text().is_char_boundary(composer.cursor()));
    }
    assert_eq!(
        composer.local_image_paths(),
        vec![PathBuf::from("one.png"), PathBuf::from("two.png")]
    );
    composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
    composer.draft.textarea.set_cursor(0);
    key(&mut composer, KeyCode::Up);
    key(&mut composer, KeyCode::Delete);
    assert!(composer.remote_image_urls().is_empty());
    assert_eq!(
        composer.textarea().text_elements()[0]
            .placeholder
            .as_deref(),
        Some("[Image #2]")
    );
}

#[test]
fn expanded_pastes_rebase_image_elements_by_utf8_bytes_for_queue() {
    let mut composer = ChatComposer::default();
    let pasted = "界🙂".repeat(501);
    composer.handle_paste(&pasted);
    composer.insert(" literal [Image #1] ");
    composer.attach_image("one.png".into());
    let start = pasted.len() + " literal [Image #1] ".len();
    assert_eq!(
        key(&mut composer, KeyCode::Tab),
        InputResult::Queued {
            text: format!("{pasted} literal [Image #1] [Image #1]"),
            text_elements: vec![TextElement::new(
                start..start + 10,
                Some("[Image #1]".into())
            )],
        }
    );
    assert_eq!(
        composer
            .take_recent_submission_images_with_placeholders()
            .len(),
        1
    );
}

#[test]
fn ordinary_placeholder_text_does_not_keep_a_deleted_attachment_alive_offline() {
    let mut composer = ChatComposer::default();
    composer.insert("literal [Image #1] ");
    composer.attach_image("one.png".into());
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    assert_eq!(composer.text(), "literal [Image #1] ");
    assert!(composer.local_image_paths().is_empty());
    assert!(composer.textarea().text_elements().is_empty());
    assert_eq!(
        key(&mut composer, KeyCode::Enter),
        InputResult::Submitted {
            text: "literal [Image #1]".into(),
            text_elements: Vec::new(),
        }
    );
    assert!(composer
        .take_recent_submission_images_with_placeholders()
        .is_empty());
}

#[test]
fn vim_replace_recovery_and_undo_redo_keep_image_path_and_atomic_range_together() {
    let mut composer = ChatComposer::default();
    composer.attach_image("one.png".into());
    composer.set_vim_enabled(true);
    composer.draft.textarea.set_cursor(0);
    key(&mut composer, KeyCode::Char('R'));
    key(&mut composer, KeyCode::Char('x'));
    assert_eq!(composer.text(), "[Image #1]x");
    assert_eq!(composer.local_image_paths(), vec![PathBuf::from("one.png")]);
    assert_eq!(
        composer.textarea().text_elements(),
        vec![TextElement::new(0..10, Some("[Image #1]".into()))]
    );
    key(&mut composer, KeyCode::Backspace);
    assert_eq!(composer.text(), "[Image #1]");
    assert_eq!(
        composer.textarea().text_elements(),
        vec![TextElement::new(0..10, Some("[Image #1]".into()))]
    );
    key(&mut composer, KeyCode::Esc);
    key(&mut composer, KeyCode::Home);
    key(&mut composer, KeyCode::Char('x'));
    assert!(composer.local_image_paths().is_empty());
    key(&mut composer, KeyCode::Char('u'));
    assert_eq!(composer.text(), "[Image #1]");
    assert_eq!(composer.local_image_paths(), vec![PathBuf::from("one.png")]);
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    assert!(composer.is_empty());
    assert!(composer.local_image_paths().is_empty());
}

#[test]
fn bracketed_image_path_paste_uses_real_file_decoding_and_keeps_other_text_literal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("图片 with spaces.png");
    image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]))
        .save(&path)
        .unwrap();
    let mut composer = ChatComposer::default();
    composer.handle_paste(url::Url::from_file_path(&path).unwrap().as_str());
    assert_eq!(composer.text(), "[Image #1] ");
    assert_eq!(composer.local_image_paths(), vec![path]);
    composer.handle_paste("not-an-image.txt");
    assert_eq!(composer.text(), "[Image #1] not-an-image.txt");
    assert_eq!(composer.local_image_paths().len(), 1);
}

#[test]
fn remote_only_submission_remains_structured_without_an_app_bypass() {
    let mut composer = ChatComposer::default();
    composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
    assert_eq!(
        key(&mut composer, KeyCode::Enter),
        InputResult::Submitted {
            text: String::new(),
            text_elements: Vec::new(),
        }
    );
    assert_eq!(
        composer.take_remote_image_urls(),
        vec!["https://example.test/remote.png"]
    );
    assert!(!composer.has_pending_images());
}

#[test]
fn remote_only_draft_is_not_empty_and_ctrl_c_history_restores_it_without_quit() {
    let mut composer = ChatComposer::default();
    let url = "https://example.test/remote.png".to_string();
    composer.set_remote_image_urls(vec![url.clone()]);
    assert!(!composer.is_empty());
    assert_ne!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL)),
        InputResult::Quit
    );
    assert_eq!(composer.clear_for_ctrl_c(), Some(String::new()));
    assert!(composer.is_empty());
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.remote_image_urls(), vec![url]);
    assert!(!composer.is_empty());
}
