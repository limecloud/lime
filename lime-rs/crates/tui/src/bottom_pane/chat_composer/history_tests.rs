use super::*;
use agent_protocol::TextElement;

fn key(composer: &mut ChatComposer, code: KeyCode) -> InputResult {
    composer.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE))
}

#[test]
fn history_search_footer_marks_multiline_query_status_keys_and_safe_cursor_in_five_locales() {
    use crate::locale::Locale;
    use ratatui::style::{Color, Style};

    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut composer = ChatComposer::default();
        composer.set_locale(locale);
        composer.set_cached_history(["historic\n\t界 prompt".into()]);
        composer.begin_history_search();
        let idle = composer.history_search_footer_line().unwrap();
        assert_eq!(idle.to_string(), locale.history_search_label());
        composer.handle_paste("historic\n\t界");
        let line = composer.history_search_footer_line().unwrap();
        let display = "historic↵⇥界";
        let (accept, cancel) = locale.history_search_actions();
        assert_eq!(
            line.to_string(),
            format!(
                "{}{display}  enter {accept} · esc {cancel}",
                locale.history_search_label()
            )
        );
        assert_eq!(line.spans[1].style, crate::style::accent_style());
        assert_eq!(line.spans[3].style, Style::default());
        assert_eq!(line.spans[5].style, Style::default());
        let area = Rect::new(10, 4, 120, 1);
        let query_width =
            Line::from(format!(" {}{display}", locale.history_search_label())).width() as u16;
        assert_eq!(
            composer.history_search_cursor_pos(area, locale.history_search_label()),
            Some((10 + query_width, 4))
        );
        assert_eq!(
            composer
                .history_search_cursor_pos(Rect::new(10, 4, 1, 1), locale.history_search_label()),
            Some((10, 4))
        );
        assert_eq!(
            composer
                .history_search_cursor_pos(Rect::new(10, 4, 0, 1), locale.history_search_label()),
            None
        );
        composer.handle_paste("missing");
        let line = composer.history_search_footer_line().unwrap();
        assert!(line.to_string().ends_with(locale.history_search_no_match()));
        assert_eq!(line.spans.last().unwrap().style.fg, Some(Color::Red));
        composer.cancel_history_search();
        assert!(composer.history_search_footer_line().is_none());
    }
}

#[test]
fn reverse_search_unique_navigation_boundary_query_restart_and_cancel_preserve_preview() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["git status".into(), "git status".into(), "git diff".into()]);
    composer.insert("draft");
    let draft = composer.snapshot_draft();
    composer.begin_history_search();
    assert_eq!(composer.text(), "draft");
    composer.handle_paste("git");
    assert_eq!(composer.text(), "git diff");
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.text(), "git status");
    for _ in 0..2 {
        key(&mut composer, KeyCode::Up);
        assert_eq!(composer.text(), "git status");
        assert_eq!(composer.history_search_highlight_ranges(), vec![0..3]);
    }
    key(&mut composer, KeyCode::Down);
    assert_eq!(composer.text(), "git diff");
    key(&mut composer, KeyCode::Down);
    assert_eq!(composer.text(), "git diff");
    key(&mut composer, KeyCode::Char('x'));
    assert_eq!(composer.snapshot_draft(), draft);
    key(&mut composer, KeyCode::Backspace);
    assert_eq!(composer.text(), "git diff");
    for _ in 0..3 {
        key(&mut composer, KeyCode::Backspace);
    }
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.snapshot_draft(), draft);
    key(&mut composer, KeyCode::Esc);
    assert_eq!(composer.snapshot_draft(), draft);
    assert!(!composer.history.is_navigating());
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.text(), "draft");
}

#[test]
fn ctrl_c_and_history_traversal_keep_folded_paste_remote_offset_and_image_identity() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["older text".into()]);
    composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
    composer.handle_paste(&"界🙂".repeat(501));
    composer.attach_image("one.png".into());
    composer.insert(" draft tail");
    let entry = composer.snapshot_history_entry();
    assert_eq!(composer.clear_for_ctrl_c(), Some(entry.text.clone()));
    assert!(composer.is_empty());
    assert!(!composer.has_pending_images());
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.snapshot_history_entry(), entry);
    composer.draft.textarea.set_cursor(0);
    // The remote-image rows own Up at zero. Clear their selection before entering history.
    composer.attachments.clear_remote_image_selection();
    composer.draft.textarea.set_cursor(composer.text().len());
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.text(), "older text");
    assert!(!composer.has_pending_images());
    key(&mut composer, KeyCode::Down);
    assert_eq!(composer.snapshot_history_entry(), entry);
    key(&mut composer, KeyCode::Down);
    assert!(composer.is_empty());
    assert!(!composer.has_pending_images());
}

#[test]
fn submitted_image_history_restores_structured_expanded_input_after_runtime_takes_attachments() {
    let mut composer = ChatComposer::default();
    composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
    let pasted = "界".repeat(1001);
    composer.handle_paste(&pasted);
    composer.attach_image("one.png".into());
    let elements = vec![TextElement::new(
        pasted.len()..pasted.len() + 10,
        Some("[Image #2]".into()),
    )];
    let text = format!("{pasted}[Image #2]");
    assert_eq!(
        key(&mut composer, KeyCode::Enter),
        InputResult::Submitted {
            text: text.clone(),
            text_elements: elements.clone()
        }
    );
    let images = composer.take_recent_submission_images_with_placeholders();
    let remotes = composer.take_remote_image_urls();
    key(&mut composer, KeyCode::Up);
    assert_eq!(composer.text(), text);
    assert_eq!(composer.textarea().text_elements(), elements);
    assert_eq!(composer.local_images(), images);
    assert_eq!(composer.remote_image_urls(), remotes);
    assert!(composer.draft.pending_pastes.is_empty());
}

#[test]
fn reverse_search_previews_its_own_attachments_cancel_restores_draft_accept_requires_another_enter()
{
    let mut composer = ChatComposer::default();
    composer.insert("historic ");
    composer.attach_image("history.png".into());
    composer.clear_for_ctrl_c();
    composer.insert("unsent ");
    composer.attach_image("draft.png".into());
    let draft = composer.snapshot_draft();
    for cancel in [true, false] {
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        composer.handle_paste("historic");
        assert_eq!(composer.text(), "historic [Image #1]");
        assert_eq!(
            composer.local_image_paths(),
            vec![std::path::PathBuf::from("history.png")]
        );
        assert_eq!(
            key(
                &mut composer,
                if cancel { KeyCode::Esc } else { KeyCode::Enter }
            ),
            InputResult::Changed
        );
        if cancel {
            assert_eq!(composer.snapshot_draft(), draft);
        } else {
            assert!(!composer.history_search_active());
            assert_eq!(
                key(&mut composer, KeyCode::Enter),
                InputResult::Submitted {
                    text: "historic [Image #1]".into(),
                    text_elements: vec![TextElement::new(9..19, Some("[Image #1]".into()))],
                }
            );
            assert_eq!(
                composer.take_recent_submission_images_with_placeholders()[0].path,
                std::path::PathBuf::from("history.png")
            );
        }
    }
}
