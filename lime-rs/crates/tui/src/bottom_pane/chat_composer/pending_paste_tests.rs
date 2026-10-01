use super::*;
use crate::bottom_pane::chat_composer::{ChatComposer, InputResult};
use crate::locale::Locale;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

fn key(composer: &mut ChatComposer, code: KeyCode) -> InputResult {
    composer.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE))
}

#[test]
fn pending_paste_expansion_sorts_ranges_consumes_duplicate_payloads_once_and_keeps_literals() {
    let mut textarea = crate::bottom_pane::TextArea::default();
    let prefix = "literal [paste] 界";
    textarea.insert(prefix);
    textarea.insert_element("[paste]");
    textarea.insert("🙂");
    textarea.insert_element("[Image #1]");
    textarea.insert_element("[paste]");
    textarea.insert("/ ");
    textarea.insert_element("[paste]");
    textarea.insert(" end");
    let mut elements = textarea.text_elements();
    elements.reverse();
    let (text, elements) = ChatComposer::expand_pending_pastes(
        textarea.text(),
        elements,
        &[
            ("[paste]".into(), "甲🙂".into()),
            ("[paste]".into(), "乙".into()),
        ],
    );
    assert_eq!(text, "literal [paste] 界甲🙂🙂[Image #1]乙/ [paste] end");
    let image_start = prefix.len() + "甲🙂🙂".len();
    let final_paste_start = image_start + "[Image #1]乙/ ".len();
    assert_eq!(
        elements,
        vec![
            agent_protocol::TextElement::new(
                image_start..image_start + 10,
                Some("[Image #1]".into())
            ),
            agent_protocol::TextElement::new(
                final_paste_start..final_paste_start + 7,
                Some("[paste]".into())
            ),
        ]
    );
}

#[test]
fn no_pending_paste_preserves_the_complete_canonical_element_object() {
    let elements = vec![agent_protocol::TextElement::new(3..8, None)];
    assert_eq!(
        ChatComposer::expand_pending_pastes("界@docs", elements.clone(), &[]),
        ("界@docs".into(), elements)
    );
    assert_eq!(
        ChatComposer::expand_pending_pastes(
            "literal [paste]",
            Vec::new(),
            &[("[paste]".into(), "must not replace".into())]
        ),
        ("literal [paste]".into(), Vec::new())
    );
}

#[test]
fn threshold_counts_unicode_characters_not_bytes_and_normalizes_newlines() {
    let mut composer = ChatComposer::default();
    let short = "界".repeat(LARGE_PASTE_CHAR_THRESHOLD);
    composer.handle_paste(&short);
    assert_eq!(composer.text(), short);
    assert!(composer.draft.pending_pastes.is_empty());
    composer.replace(String::new());
    let long = format!("{}\r\nend\rtail", "🙂".repeat(1000));
    composer.handle_paste(&long);
    assert_eq!(composer.text(), "[Pasted Content 1009 chars]");
    assert_eq!(
        composer.current_text_with_pending(),
        long.replace("\r\n", "\n").replace('\r', "\n")
    );
}

#[test]
fn duplicate_sizes_have_unique_labels_and_removed_labels_do_not_expand() {
    let mut composer = ChatComposer::default();
    let one = "a".repeat(1001);
    let two = "b".repeat(1001);
    composer.handle_paste(&one);
    composer.insert(" / ");
    composer.handle_paste(&two);
    assert_eq!(
        composer.text(),
        "[Pasted Content 1001 chars] / [Pasted Content 1001 chars] #2"
    );
    assert_eq!(
        composer.current_text_with_pending(),
        format!("{one} / {two}")
    );
    key(&mut composer, KeyCode::Backspace);
    assert_eq!(composer.current_text_with_pending(), format!("{one} / "));
    assert_eq!(composer.draft.pending_pastes.len(), 1);
    composer.handle_paste(&two);
    assert!(composer.text().ends_with(" #2"));
}

#[test]
fn literal_placeholder_text_is_never_globally_replaced_and_queue_expands_once() {
    let mut composer = ChatComposer::default();
    composer.insert("[Pasted Content 1001 chars] ");
    let pasted = "x".repeat(1001);
    composer.handle_paste(&pasted);
    composer.insert(" suffix");
    let expected = format!("[Pasted Content 1001 chars] {pasted} suffix");
    assert_eq!(
        key(&mut composer, KeyCode::Tab),
        InputResult::Queued {
            text: expected.clone(),
            text_elements: Vec::new()
        }
    );
    assert!(composer.is_empty());
    assert!(composer.draft.pending_pastes.is_empty());
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.text(), expected);
}

#[test]
fn submit_and_ctrl_c_history_keep_original_payload_not_placeholder_only() {
    let pasted = "界🙂".repeat(501);
    for clear in [false, true] {
        let mut composer = ChatComposer::default();
        composer.handle_paste(&pasted);
        if clear {
            let label = composer.text().to_string();
            assert_eq!(composer.clear_for_ctrl_c(), Some(label));
        } else {
            assert_eq!(
                key(&mut composer, KeyCode::Enter),
                InputResult::Submitted {
                    text: pasted.clone(),
                    text_elements: Vec::new()
                }
            );
        }
        key(&mut composer, KeyCode::Up);
        assert_eq!(composer.current_text_with_pending(), pasted);
        assert_eq!(
            composer.draft.textarea.text_element_snapshots().is_empty(),
            !clear
        );
        assert_eq!(composer.draft.pending_pastes.is_empty(), !clear);
    }
}

#[test]
fn search_paste_edits_the_query_and_cancel_restores_the_atomic_draft() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["git status".to_string()]);
    let pasted = "界".repeat(1001);
    composer.handle_paste(&pasted);
    let original = composer.snapshot_draft();
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    composer.handle_paste("git");
    assert_eq!(composer.history_search_query(), Some("git"));
    assert_eq!(composer.text(), "git status");
    key(&mut composer, KeyCode::Esc);
    assert_eq!(composer.snapshot_draft(), original);
    assert_eq!(composer.current_text_with_pending(), pasted);
}

#[test]
fn vim_undo_redo_replace_recovery_and_offline_edits_preserve_payloads() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    let pasted = "x".repeat(1001);
    composer.handle_paste(&pasted);
    let label = composer.text().to_string();
    key(&mut composer, KeyCode::Char('u'));
    assert!(composer.is_empty());
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    assert_eq!(composer.text(), label);
    assert_eq!(composer.current_text_with_pending(), pasted);

    key(&mut composer, KeyCode::Home);
    key(&mut composer, KeyCode::Char('R'));
    key(&mut composer, KeyCode::Char('a'));
    assert_eq!(composer.text(), format!("{label}a"));
    assert_eq!(composer.current_text_with_pending(), format!("{pasted}a"));
    key(&mut composer, KeyCode::Backspace);
    assert_eq!(composer.text(), label);
    assert_eq!(composer.current_text_with_pending(), pasted);
    key(&mut composer, KeyCode::Esc);
    key(&mut composer, KeyCode::Char('u'));
    assert!(composer.is_empty());
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    assert_eq!(composer.current_text_with_pending(), pasted);
    composer.set_vim_enabled(false);
    key(&mut composer, KeyCode::End);
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    assert!(composer.is_empty());
    assert!(composer.draft.pending_pastes.is_empty());
}

#[test]
fn every_locale_uses_an_atomic_label_but_submits_the_same_content() {
    let pasted = "界".repeat(1001);
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut app = crate::app::App::default();
        app.set_locale(locale);
        app.composer.handle_paste(&pasted);
        assert_eq!(app.composer.text(), locale.pasted_content_label(1001));
        assert_eq!(
            app.composer.draft.textarea.text_element_snapshots().len(),
            1
        );
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 3)).unwrap();
        terminal
            .draw(|frame| app.composer.render(frame, frame.area(), locale))
            .unwrap();
        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let compact = |value: &str| {
            value
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>()
        };
        assert!(
            compact(&rendered).contains(&compact(&locale.pasted_content_label(1001))),
            "{locale:?}: {rendered}"
        );
        assert_eq!(
            key(&mut app.composer, KeyCode::Enter),
            InputResult::Submitted {
                text: pasted.clone(),
                text_elements: Vec::new()
            }
        );
    }
}

#[test]
fn history_navigation_and_thread_draft_handoff_never_leave_orphan_placeholders() {
    let pasted = "x".repeat(1001);
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["previous".to_string()]);
    composer.handle_paste(&pasted);
    let snapshot = composer.snapshot_draft();
    composer.history_previous();
    assert_eq!(composer.text(), "previous");
    assert!(composer.draft.pending_pastes.is_empty());
    composer.history_next();
    assert_eq!(composer.snapshot_draft(), snapshot);
    assert_eq!(composer.current_text_with_pending(), pasted);

    let mut app = crate::app::App::default();
    app.thread_id = Some("root".into());
    app.composer.handle_paste(&pasted);
    let thread_snapshot = app.composer.snapshot_draft();
    app.capture_current_thread_input();
    app.composer.replace(String::new());
    app.restore_thread_input("root");
    assert_eq!(app.composer.snapshot_draft(), thread_snapshot);
    assert_eq!(app.composer.current_text_with_pending(), pasted);
}

#[test]
fn burst_retraction_does_not_consume_the_tail_of_an_existing_atomic_paste() {
    let mut composer = ChatComposer::default();
    let pasted = "x".repeat(1001);
    composer.handle_paste(&pasted);
    let start = std::time::Instant::now();
    for (index, ch) in "abcd".chars().enumerate() {
        composer.handle_key_event_at(
            KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE),
            start + std::time::Duration::from_millis(index as u64),
        );
    }
    composer.handle_paste_burst_flush(start + std::time::Duration::from_secs(1));
    assert_eq!(
        composer.current_text_with_pending(),
        format!("{pasted}abcd")
    );
    assert_eq!(composer.draft.textarea.text_element_snapshots().len(), 1);
}
