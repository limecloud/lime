use super::*;
use crate::bottom_pane::{LocalImageAttachment, RemoteImageAttachment};
use agent_protocol::{ImageDetail, TextElement};

fn composer() -> ChatComposer {
    let mut composer = ChatComposer::default();
    composer.set_text_content_with_mention_bindings(
        "界[Image #3] [token]".into(),
        vec![
            TextElement::new(3..13, None),
            TextElement::new(14..21, None),
        ],
        vec![LocalImageAttachment {
            placeholder: "[Image #3]".into(),
            path: "one.png".into(),
            detail: Some(ImageDetail::Original),
        }],
        vec![
            RemoteImageAttachment {
                url: "same-url".into(),
                detail: Some(ImageDetail::Low),
            },
            RemoteImageAttachment {
                url: "same-url".into(),
                detail: Some(ImageDetail::High),
            },
        ],
        Vec::new(),
    );
    composer
}

#[test]
fn history_search_cancel_recall_and_thread_restore_keep_complete_typed_input() {
    let mut composer = composer();
    let before = composer.snapshot_draft();
    let entry = composer.snapshot_history_entry();
    composer.clear_for_ctrl_c();
    assert_eq!(composer.history_previous(), InputResult::Changed);
    assert_eq!(composer.snapshot_history_entry(), entry);
    composer.begin_history_search();
    composer.cancel_history_search();
    assert_eq!(composer.snapshot_history_entry(), entry);
    composer.restore_thread_input_state(before.clone(), &crate::keymap::RuntimeKeymap::default());
    assert_eq!(composer.snapshot_draft(), before);
    assert_eq!(
        composer.submit(),
        InputResult::Submitted {
            text: entry.text.clone(),
            text_elements: entry.text_elements.clone()
        }
    );
    assert_eq!(
        composer.take_recent_submission_images_with_placeholders(),
        entry.local_images
    );
    assert_eq!(composer.take_remote_images(), entry.remote_images);
    assert_eq!(composer.history_previous(), InputResult::Changed);
    assert_eq!(composer.snapshot_history_entry(), entry);
}

#[test]
fn remote_deletion_renumbers_none_element_without_swapping_detail_and_vim_undo_restores_it() {
    let mut composer = composer();
    composer.set_vim_enabled(true);
    let before = composer.snapshot_draft();
    composer.draft.textarea.set_cursor(0);
    for code in [KeyCode::Up, KeyCode::Delete] {
        composer.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE));
    }
    assert_eq!(composer.text(), "界[Image #2] [token]");
    assert_eq!(
        composer.remote_images(),
        &[RemoteImageAttachment {
            url: "same-url".into(),
            detail: Some(ImageDetail::Low)
        }]
    );
    assert_eq!(
        composer.local_images()[0].detail,
        Some(ImageDetail::Original)
    );
    assert_eq!(
        composer.textarea().text_elements(),
        vec![
            TextElement::new(3..13, None),
            TextElement::new(14..21, None)
        ]
    );
    composer.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::NONE));
    assert_eq!(
        composer.snapshot_history_entry().remote_images,
        before.attachments.remote_images()
    );
    assert_eq!(
        composer.textarea().text_elements(),
        vec![
            TextElement::new(3..13, None),
            TextElement::new(14..21, None)
        ]
    );
    assert_eq!(composer.text(), before.text);
}

#[test]
fn external_edit_preserves_owned_image_metadata_but_does_not_infer_literal_duplicates() {
    let mut composer = composer();
    let local = composer.local_images();
    let remote = composer.remote_images().to_vec();
    composer.apply_external_edit("Move [Image #3] / literal [Image #3]".into());
    assert_eq!(composer.local_images(), local);
    assert_eq!(composer.remote_images(), remote);
    assert_eq!(
        composer.textarea().text_elements(),
        vec![TextElement::new(5..15, None)]
    );
    composer.draft.textarea.set_cursor(15);
    composer.handle_key_event(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    assert!(composer.local_images().is_empty());
    assert_eq!(composer.text(), "Move  / literal [Image #3]");
}

#[test]
fn paste_expansion_and_unicode_trim_keep_other_canonical_none_elements() {
    let mut composer = composer();
    composer.draft.textarea.set_cursor(0);
    composer.insert("\u{3000} ");
    let body = "界".repeat(1001);
    composer.draft.textarea.set_cursor(composer.text().len());
    composer.handle_paste(&body);
    composer.insert(" \n");
    assert_eq!(
        composer.submit(),
        InputResult::Submitted {
            text: format!("界[Image #3] [token]{body}"),
            text_elements: vec![
                TextElement::new(3..13, None),
                TextElement::new(14..21, None)
            ],
        }
    );
}
