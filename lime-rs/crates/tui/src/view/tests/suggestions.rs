use super::*;
use app_server_protocol::protocol::v2::{
    FuzzyFileSearchMatchType, FuzzyFileSearchResult, SkillMetadata, SkillScope,
};

#[test]
fn visible_file_selection_inserts_original_path_and_preserves_draft_suffix() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("Before @parser");
    let request = app
        .chat_widget
        .bottom_pane
        .take_file_search_request()
        .unwrap();
    let paths = [
        "long_directory_that_does_not_fit_in_a_narrow_terminal/parser_alpha.rs",
        "long_directory_that_does_not_fit_in_a_narrow_terminal/parser_beta.rs",
    ];
    app.chat_widget.bottom_pane.on_file_search_result(
        request.generation,
        &request.query,
        paths
            .iter()
            .map(|path| FuzzyFileSearchResult {
                root: "/workspace".into(),
                path: (*path).into(),
                match_type: FuzzyFileSearchMatchType::File,
                file_name: path.rsplit('/').next().unwrap().into(),
                score: 1,
                indices: None,
            })
            .collect(),
    );
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
    );
    let mut terminal = Terminal::new(TestBackend::new(28, 16)).unwrap();
    terminal.draw(|frame| render(frame, &app)).unwrap();
    let text = buffer_text(&terminal);
    assert!(
        text.contains("parser_alpha.rs") && text.contains("parser_beta.rs"),
        "{text}"
    );
    let action = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE)),
    );
    assert!(matches!(action, crate::app::AppAction::None));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        format!("Before {} ", paths[1])
    );
    assert!(!app.chat_widget.bottom_pane.popup_active());
    assert!(app.projection.active_turn_id().is_none());
    assert!(app.queued_submissions.is_empty());
}

#[test]
fn visible_scrolled_skill_inserts_canonical_name_and_cancel_preserves_token() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.set_skills(
        (0..10)
            .map(|index| SkillMetadata {
                name: format!("skill-{index:02}"),
                description: "Review changes".into(),
                short_description: None,
                interface: None,
                dependencies: None,
                path: format!("/skills/skill-{index:02}/SKILL.md").into(),
                scope: SkillScope::Repo,
                enabled: true,
            })
            .collect(),
    );
    app.chat_widget.bottom_pane.insert_str("Review $skill-");
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)),
    );
    let mut terminal = Terminal::new(TestBackend::new(40, 12)).unwrap();
    terminal.draw(|frame| render(frame, &app)).unwrap();
    assert!(buffer_text(&terminal).contains("› skill-09"));
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE)),
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "Review $skill-09 "
    );
    assert!(!app.chat_widget.bottom_pane.popup_active());
    app.chat_widget.bottom_pane.insert_str("$skill-");
    assert!(app.chat_widget.bottom_pane.popup_active());
    let draft = app.chat_widget.bottom_pane.composer_text().to_string();
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), draft);
    assert!(!app.chat_widget.bottom_pane.popup_active());
    assert!(app.projection.active_turn_id().is_none());
}
