use super::*;
use app_server_protocol::protocol::v2::FuzzyFileSearchMatchType;
use crossterm::event::Event;

fn result(path: &str) -> FuzzyFileSearchResult {
    FuzzyFileSearchResult {
        root: "/workspace".into(),
        path: path.into(),
        match_type: FuzzyFileSearchMatchType::File,
        file_name: path.into(),
        score: 1,
        indices: None,
    }
}

#[test]
fn clearing_file_completion_invalidates_pending_and_reissues_the_same_query() {
    let mut composer = ChatComposer::default();
    composer.insert("@src");
    let old = composer.take_file_search_request().unwrap();
    composer.clear_completion_popup();
    assert!(!composer.completion_popup_active());
    assert!(composer.take_file_search_request().is_none());
    composer.sync_completion_popup();
    let next = composer
        .take_file_search_request()
        .expect("same query must restart after cancellation");
    assert!(next.generation > old.generation);
    assert_eq!(next.query, old.query);
    composer.on_file_search_result(old.generation, &old.query, vec![result("stale.rs")]);
    assert!(!composer.file_search_popup_has_selection());
    composer.on_file_search_result(next.generation, &next.query, vec![result("current.rs")]);
    assert_eq!(
        composer.file_search_popup().unwrap().selected_path(),
        Some("current.rs")
    );
}

#[test]
fn skill_focus_cancels_file_search_without_late_reopening_or_catalog_loss() {
    let mut composer = ChatComposer::default();
    composer.set_skills(vec![tests::test_skill("deploy")]);
    composer.insert("@src $deploy");
    composer.draft.textarea.set_cursor(3);
    composer.sync_completion_popup();
    let request = composer.take_file_search_request().unwrap();
    composer.draft.textarea.set_cursor(composer.text().len());
    composer.sync_completion_popup();
    assert!(composer.skill_popup_active());
    assert!(composer.take_file_search_request().is_none());
    composer.on_file_search_result(request.generation, &request.query, vec![result("stale.rs")]);
    assert!(composer.skill_popup_active());
    assert!(!composer.file_search_popup_active());
    assert_eq!(composer.skills().len(), 1);
}

#[test]
fn file_and_skill_completion_share_suffix_cursor_and_attachment_preservation() {
    for skill in [false, true] {
        let mut composer = ChatComposer::default();
        composer.attach_image(std::path::PathBuf::from("/workspace/image.png"));
        composer.draft.textarea.set_cursor(0);
        let (query, replacement) = if skill {
            ("$dep", "$deploy")
        } else {
            ("@src", "src/main.rs")
        };
        composer.set_skills(vec![tests::test_skill("deploy")]);
        composer.insert(&format!("{query} suffix"));
        composer.draft.textarea.set_cursor(query.len());
        composer.sync_completion_popup();
        let event = Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        if skill {
            assert_eq!(
                composer.handle_skill_popup_event(&event),
                SkillPopupAction::Complete
            );
        } else {
            let request = composer.take_file_search_request().unwrap();
            composer.on_file_search_result(
                request.generation,
                &request.query,
                vec![result(replacement)],
            );
            assert_eq!(
                composer.handle_file_search_popup_event(&event),
                FileSearchPopupAction::Complete
            );
        }
        assert_eq!(composer.text(), format!("{replacement}  suffix[Image #1]"));
        assert_eq!(composer.cursor(), replacement.len() + 1);
        assert_eq!(composer.local_image_paths().len(), 1);
        assert!(!composer.completion_popup_active());
    }
}

#[test]
fn token_dismissal_remains_scoped_after_search_cancellation() {
    let mut composer = ChatComposer::default();
    composer.insert("@same @same");
    composer.draft.textarea.set_cursor(5);
    composer.sync_completion_popup();
    let event = Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    assert_eq!(
        composer.handle_file_search_popup_event(&event),
        FileSearchPopupAction::Cancel
    );
    assert!(composer.take_file_search_request().is_none());
    composer.sync_completion_popup();
    assert!(!composer.completion_popup_active());
    composer.draft.textarea.set_cursor(composer.text().len());
    composer.sync_completion_popup();
    assert!(composer.take_file_search_request().is_some());
}
