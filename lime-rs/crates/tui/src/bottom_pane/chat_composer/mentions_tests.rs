use super::*;
use crossterm::event::Event;

fn binding(path: &str) -> MentionBinding {
    MentionBinding {
        sigil: '$',
        mention: "review".into(),
        path: path.into(),
    }
}

fn select_review(composer: &mut ChatComposer, path: &str) {
    let mut skill = super::super::tests::test_skill("review");
    skill.path = path.into();
    composer.set_skills(vec![skill]);
    composer.insert("$rev");
    assert_eq!(
        composer
            .handle_skill_popup_event(&Event::Key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE))),
        SkillPopupAction::Complete
    );
}

#[test]
fn selected_skill_has_stable_identity_and_atomic_delete_without_binding_literal() {
    let mut composer = ChatComposer::default();
    composer.insert("literal $review 界 ");
    select_review(&mut composer, "/selected/SKILL.md");
    let snapshot = composer.snapshot_draft();
    assert_eq!(
        snapshot.mention_bindings,
        vec![binding("/selected/SKILL.md")]
    );
    let elements = composer.textarea().text_element_snapshots();
    assert_eq!(elements.len(), 1);
    composer.draft.textarea.set_cursor(0);
    composer.insert("🙂");
    assert_eq!(
        composer.textarea().text_element_snapshots()[0].id,
        elements[0].id
    );
    composer.restore_draft(snapshot);
    assert_eq!(composer.textarea().text_element_snapshots(), elements);
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    assert_eq!(composer.text(), "literal $review 界 ");
    assert!(composer.snapshot_mention_bindings().is_empty());
    assert!(composer.textarea().text_elements().is_empty());
}

#[test]
fn duplicate_names_keep_ordered_paths_through_submit_history_and_reverse_search() {
    let mut composer = ChatComposer::default();
    select_review(&mut composer, "/one/SKILL.md");
    select_review(&mut composer, "/two/SKILL.md");
    let expected = vec![binding("/one/SKILL.md"), binding("/two/SKILL.md")];
    composer.handle_paste(&"界".repeat(1200));
    let draft = composer.snapshot_draft();
    let InputResult::Submitted {
        text,
        text_elements,
    } = composer.submit()
    else {
        panic!("submission")
    };
    assert_eq!(composer.take_recent_submission_mention_bindings(), expected);
    assert!(composer
        .take_recent_submission_mention_bindings()
        .is_empty());
    assert_eq!(text_elements.len(), 2);
    assert!(text.ends_with(&"界".repeat(1200)));
    composer.history_previous();
    assert_eq!(composer.snapshot_mention_bindings(), expected);
    assert_eq!(composer.textarea().text_elements(), text_elements);
    composer.restore_draft(draft);
    composer.clear_for_ctrl_c();
    composer.begin_history_search();
    composer.handle_history_search_key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE));
    assert_eq!(composer.snapshot_mention_bindings(), expected);
    assert_eq!(composer.draft.pending_pastes.len(), 1);
}

#[test]
fn persistent_history_external_edit_and_catalog_refresh_do_not_rebind_paths() {
    let mut composer = ChatComposer::default();
    composer
        .set_cached_history(["界 [$review](/one/SKILL.md) [$review](/two/SKILL.md)".to_string()]);
    composer.history_previous();
    let expected = vec![binding("/one/SKILL.md"), binding("/two/SKILL.md")];
    assert_eq!(composer.snapshot_mention_bindings(), expected);
    composer.set_skills(vec![super::super::tests::test_skill("review")]);
    assert_eq!(composer.snapshot_mention_bindings(), expected);
    composer.apply_external_edit("🙂 $review then $review and literal $review".into());
    assert_eq!(composer.snapshot_mention_bindings(), expected);
    assert_eq!(composer.textarea().text_elements().len(), 2);
    composer.apply_external_edit("only $reviewer and no selected token".into());
    assert!(composer.snapshot_mention_bindings().is_empty());
}

#[test]
fn vim_delete_undo_redo_and_replace_backspace_preserve_mention_identity() {
    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    select_review(&mut composer, "/one/SKILL.md");
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    composer.draft.textarea.set_cursor(0);
    let snapshot = composer.textarea().text_element_snapshots();
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
    assert!(composer.snapshot_mention_bindings().is_empty());
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::NONE));
    assert_eq!(
        composer.snapshot_mention_bindings(),
        vec![binding("/one/SKILL.md")]
    );
    assert_eq!(composer.textarea().text_element_snapshots(), snapshot);
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    assert!(composer.snapshot_mention_bindings().is_empty());
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::NONE));
    composer.draft.textarea.set_cursor(0);
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('R'), KeyModifiers::NONE));
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Char('z'), KeyModifiers::NONE));
    assert_eq!(
        composer.snapshot_mention_bindings(),
        vec![binding("/one/SKILL.md")]
    );
    assert_eq!(composer.textarea().text_element_snapshots(), snapshot);
    composer.handle_disconnected_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    assert_eq!(
        composer.snapshot_mention_bindings(),
        vec![binding("/one/SKILL.md")]
    );
}
