use crate::bottom_pane::chat_composer::ChatComposer;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::path::PathBuf;

fn key(composer: &mut ChatComposer, code: KeyCode) {
    composer.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE));
}

fn search(composer: &mut ChatComposer) {
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    assert!(composer.history_search_active());
}

#[test]
fn background_text_and_image_edits_preserve_query_preview_and_unique_traversal() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["older match".into(), "newer match".into()]);
    composer.insert("draft");
    search(&mut composer);
    composer.handle_paste("match");
    let preview = composer.snapshot_draft();
    composer.insert(" background");
    composer.attach_image(PathBuf::from("background.png"));
    assert_eq!(composer.history_search_query(), Some("match"));
    assert_eq!(composer.snapshot_draft(), preview);
    assert!(composer
        .draft_snapshot()
        .text
        .starts_with("draft background"));
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.text(), "older match");
    key(&mut composer, KeyCode::Down);
    assert_eq!(composer.text(), "newer match");
    let stored = composer.draft_snapshot();
    key(&mut composer, KeyCode::Esc);
    assert_eq!(composer.snapshot_draft(), stored);
    assert_eq!(
        composer.local_image_paths(),
        vec![PathBuf::from("background.png")]
    );
}

#[test]
fn accepting_match_discards_background_edits_and_image_ownership() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["history match".into()]);
    composer.insert("draft");
    search(&mut composer);
    composer.handle_paste("match");
    composer.insert(" background");
    composer.attach_image(PathBuf::from("discard.png"));
    key(&mut composer, KeyCode::Enter);
    assert!(!composer.history_search_active());
    assert_eq!(composer.text(), "history match");
    assert!(composer.local_image_paths().is_empty());
    assert_eq!(composer.draft_snapshot(), composer.snapshot_draft());
}

#[test]
fn idle_and_no_match_fallback_stays_frozen_until_cancel() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["history match".into()]);
    composer.insert("draft");
    search(&mut composer);
    composer.insert(" hidden");
    assert_eq!(composer.text(), "draft");
    composer.handle_paste("absent");
    assert_eq!(composer.text(), "draft");
    for _ in "absent".chars() {
        key(&mut composer, KeyCode::Backspace);
    }
    assert_eq!(composer.history_search_query(), Some(""));
    assert_eq!(composer.text(), "draft");
    key(&mut composer, KeyCode::Esc);
    assert_eq!(composer.text(), "draft hidden");
}

#[test]
fn cancel_restores_pending_vim_change_and_dot_while_accept_resets_commands() {
    for accept in [false, true] {
        let mut composer = ChatComposer::default();
        composer.set_cached_history(["history match".into()]);
        composer.set_vim_enabled(true);
        key(&mut composer, KeyCode::Char('i'));
        key(&mut composer, KeyCode::Char('a'));
        search(&mut composer);
        composer.handle_paste("match");
        composer.insert("b");
        key(
            &mut composer,
            if accept { KeyCode::Enter } else { KeyCode::Esc },
        );
        key(&mut composer, KeyCode::Esc);
        if accept {
            let before = composer.text().to_string();
            key(&mut composer, KeyCode::Char('.'));
            assert_eq!(composer.text(), before);
        } else {
            assert_eq!(composer.text(), "ab");
            key(&mut composer, KeyCode::Char('.'));
            assert_eq!(composer.text(), "aabb");
            key(&mut composer, KeyCode::Char('u'));
            assert_eq!(composer.text(), "ab");
            key(&mut composer, KeyCode::Char('u'));
            assert_eq!(composer.text(), "");
        }
    }
}

#[test]
fn background_edit_keeps_pending_lookup_and_cancelled_reply_only_fills_cache() {
    use crate::app_event::{AppEvent, HistoryLookupResponse};
    use crate::app_event_sender::AppEventSender;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let mut composer = ChatComposer::default();
    composer.set_app_event_tx(AppEventSender::new(tx));
    composer.set_history_metadata("thread".into(), "log".into(), 1);
    composer.insert("draft");
    search(&mut composer);
    composer.handle_paste("match");
    assert!(matches!(
        rx.try_recv().unwrap(),
        AppEvent::LookupMessageHistoryEntry { offset: 0, .. }
    ));
    composer.attach_image(PathBuf::from("background.png"));
    assert_eq!(composer.history_search_query(), Some("match"));
    assert_eq!(composer.text(), "draft");
    assert!(rx.try_recv().is_err());
    assert!(composer.on_history_lookup_response(
        "thread",
        HistoryLookupResponse::Entry {
            log_id: "log".into(),
            offset: 0,
            entry: Some("history match".into()),
        }
    ));
    assert_eq!(composer.text(), "history match");
    let stored = composer.draft_snapshot();
    key(&mut composer, KeyCode::Esc);
    assert_eq!(composer.snapshot_draft(), stored);
    composer.on_history_lookup_response(
        "thread",
        HistoryLookupResponse::Entry {
            log_id: "log".into(),
            offset: 0,
            entry: Some("late match".into()),
        },
    );
    assert_eq!(composer.snapshot_draft(), stored);
}

#[test]
fn cancel_preserves_last_vim_search_and_completed_change() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["history match".into()]);
    composer.insert("one:two:three");
    composer.set_vim_enabled(true);
    composer.draft.textarea.set_cursor(0);
    key(&mut composer, KeyCode::Char('/'));
    composer.handle_paste(":");
    key(&mut composer, KeyCode::Enter);
    assert_eq!(composer.cursor(), 3);
    key(&mut composer, KeyCode::Char('r'));
    key(&mut composer, KeyCode::Char('X'));
    // Ctrl-R is Vim redo in Normal mode. Exercise the history owner directly here;
    // the PTY covers the product shortcut from Insert mode.
    composer.begin_history_search();
    composer.handle_paste("match");
    key(&mut composer, KeyCode::Esc);
    key(&mut composer, KeyCode::Char('n'));
    assert_eq!(composer.cursor(), 7);
    key(&mut composer, KeyCode::Char('.'));
    assert_eq!(composer.text(), "oneXtwoXthree");
}

#[test]
fn explicit_fresh_replacement_ends_search_and_discards_saved_draft() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["history match".into()]);
    composer.insert("draft");
    search(&mut composer);
    composer.handle_paste("match");
    composer.insert(" hidden");
    composer.replace("fresh".into());
    assert!(!composer.cancel_history_search());
    assert_eq!(composer.text(), "fresh");
}
