use std::path::PathBuf;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::ChatComposer;
use crate::bottom_pane::InputResult;

#[test]
fn rapid_normal_mode_commands_are_not_reclassified_as_paste_bursts() {
    let mut composer = vim_composer("alpha beta gamma");
    let now = std::time::Instant::now();
    for ch in "dw.".chars() {
        composer.handle_key_event_at(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE), now);
    }
    assert_eq!(composer.text(), "gamma");
    assert!(!composer.draft.paste_burst.is_active());
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "beta gamma");
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "alpha beta gamma");
}

#[test]
fn unicode_paste_burst_reclassification_repeats_text_once_not_the_retracted_prefix() {
    let mut composer = vim_composer("");
    key(&mut composer, KeyCode::Char('i'), KeyModifiers::NONE);
    let start = std::time::Instant::now();
    for index in 0..17 {
        composer.handle_key_event_at(
            KeyEvent::new(KeyCode::Char('界'), KeyModifiers::NONE),
            start + std::time::Duration::from_millis(index),
        );
    }
    assert!(composer.draft.paste_burst.is_active());
    composer.handle_paste_burst_flush(start + std::time::Duration::from_secs(1));
    assert_eq!(composer.text(), "界".repeat(17));
    key(&mut composer, KeyCode::Esc, KeyModifiers::NONE);
    key(&mut composer, KeyCode::Char('.'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "界".repeat(34));
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "界".repeat(17));
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert!(composer.is_empty());
}

fn key(composer: &mut ChatComposer, code: KeyCode, modifiers: KeyModifiers) {
    let _ = composer.handle_key_event(KeyEvent::new(code, modifiers));
}

fn chars(composer: &mut ChatComposer, value: &str) {
    for ch in value.chars() {
        key(composer, KeyCode::Char(ch), KeyModifiers::NONE);
    }
}

fn vim_composer(text: &str) -> ChatComposer {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.replace(text.to_owned());
    composer.draft.textarea.set_cursor(0);
    composer
}

#[test]
fn normal_edit_undo_and_redo_restore_text() {
    let mut composer = vim_composer("abc");
    key(&mut composer, KeyCode::Char('x'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "bc");
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "abc");
    key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
    assert_eq!(composer.text(), "bc");
}

#[test]
fn insert_session_is_one_undo_transaction() {
    let mut composer = vim_composer("");
    key(&mut composer, KeyCode::Char('i'), KeyModifiers::NONE);
    chars(&mut composer, "你好");
    key(&mut composer, KeyCode::Esc, KeyModifiers::NONE);
    assert_eq!(composer.text(), "你好");
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert!(composer.is_empty());
}

#[test]
fn attachment_edit_is_undoable_without_text_changes() {
    let mut composer = vim_composer("draft");
    let path = PathBuf::from("image.png");
    composer.attach_image(path.clone());
    assert_eq!(composer.local_image_paths(), &[path]);
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert!(composer.local_image_paths().is_empty());
    key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
    assert_eq!(composer.local_image_paths(), &[PathBuf::from("image.png")]);
}

#[test]
fn selected_remote_image_delete_is_undoable_with_text_unchanged() {
    let mut composer = vim_composer("draft");
    let url = "https://example.test/remote.png".to_owned();
    composer.set_remote_image_urls(vec![url.clone()]);
    key(&mut composer, KeyCode::Up, KeyModifiers::NONE);
    key(&mut composer, KeyCode::Delete, KeyModifiers::NONE);
    assert!(composer.remote_image_urls().is_empty());
    assert_eq!(composer.text(), "draft");
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.remote_image_urls(), &[url]);
    key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
    assert!(composer.remote_image_urls().is_empty());
}

#[test]
fn query_paste_does_not_consume_draft_redo() {
    let mut composer = vim_composer("alpha beta");
    key(&mut composer, KeyCode::Char('x'), KeyModifiers::NONE);
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    key(&mut composer, KeyCode::Char('/'), KeyModifiers::NONE);
    composer.handle_paste("beta");
    assert_eq!(composer.text(), "alpha beta");
    key(&mut composer, KeyCode::Esc, KeyModifiers::NONE);
    key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
    assert_eq!(composer.text(), "lpha beta");
}

#[test]
fn cancelled_reverse_history_preview_restores_original_vim_undo_and_redo() {
    for cancel in [KeyCode::Esc, KeyCode::Char('c')] {
        let mut composer = vim_composer("abc");
        key(&mut composer, KeyCode::Char('x'), KeyModifiers::NONE);
        composer.set_cached_history(["historic prompt".into()]);
        composer.begin_history_search();
        composer.handle_paste("historic");
        assert_eq!(composer.text(), "historic prompt");
        key(
            &mut composer,
            cancel,
            if cancel == KeyCode::Esc {
                KeyModifiers::NONE
            } else {
                KeyModifiers::CONTROL
            },
        );
        assert_eq!(composer.text(), "bc");
        key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
        assert_eq!(composer.text(), "abc");
        key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
        assert_eq!(composer.text(), "bc");
    }
}

#[test]
fn accepted_reverse_history_preview_starts_a_fresh_vim_edit_history() {
    let mut composer = vim_composer("abc");
    key(&mut composer, KeyCode::Char('x'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "bc");
    key(&mut composer, KeyCode::Char('i'), KeyModifiers::NONE);

    composer.set_cached_history(["archived prompt".to_owned()]);
    key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
    chars(&mut composer, "archive");
    assert_eq!(composer.text(), "archived prompt");
    key(&mut composer, KeyCode::Enter, KeyModifiers::NONE);
    assert!(!composer.history_search_active());

    // Accepting the preview must discard the pre-search undo transaction.
    key(&mut composer, KeyCode::Esc, KeyModifiers::NONE);
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "archived prompt");
}

#[test]
fn direct_paste_replaces_stale_redo() {
    let mut composer = vim_composer("abc");
    key(&mut composer, KeyCode::Char('x'), KeyModifiers::NONE);
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    composer.handle_paste("Z");
    assert_eq!(composer.text(), "Zabc");
    key(&mut composer, KeyCode::Char('r'), KeyModifiers::CONTROL);
    assert_eq!(composer.text(), "Zabc");
    key(&mut composer, KeyCode::Char('u'), KeyModifiers::NONE);
    assert_eq!(composer.text(), "abc");
}

#[test]
fn empty_undo_and_redo_are_consumed_in_normal_mode() {
    let mut composer = vim_composer("draft");
    assert_eq!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::NONE,)),
        InputResult::Changed
    );
    assert_eq!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL,)),
        InputResult::Changed
    );
}
