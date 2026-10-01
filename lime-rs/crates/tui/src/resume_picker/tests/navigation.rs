use super::*;

fn paging_picker(count: usize) -> PickerState {
    PickerState::new(
        (0..count)
            .map(|index| thread(&format!("thread-{index}"), "preview", false))
            .collect(),
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    )
}

fn page_key(picker: &mut PickerState, code: KeyCode) {
    picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
        code,
        KeyModifiers::NONE,
    )));
}

#[test]
fn page_navigation_uses_view_rows() {
    let mut picker = paging_picker(20);
    picker.view_rows.set(Some(5));
    page_key(&mut picker, KeyCode::PageDown);
    assert_eq!(picker.selected, 5);
    page_key(&mut picker, KeyCode::PageDown);
    assert_eq!(picker.selected, 10);
    page_key(&mut picker, KeyCode::PageUp);
    assert_eq!(picker.selected, 5);
    page_key(&mut picker, KeyCode::End);
    assert_eq!(picker.selected, 19);
}

#[test]
fn resize_and_render_update_the_same_paging_geometry() {
    let mut picker = paging_picker(40);
    let mut terminal = Terminal::new(TestBackend::new(80, 8)).unwrap();
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .unwrap();
    let rows = super::super::layout::areas(ratatui::layout::Rect::new(0, 0, 80, 8))
        .list
        .height;
    assert_eq!(picker.view_rows.get(), Some(usize::from(rows)));
    page_key(&mut picker, KeyCode::PageDown);
    assert_eq!(picker.selected, usize::from(rows));
    picker.handle_event(Event::Resize(80, 24));
    let resized = super::super::layout::areas(ratatui::layout::Rect::new(0, 0, 80, 24))
        .list
        .height;
    page_key(&mut picker, KeyCode::PageDown);
    assert_eq!(picker.selected, usize::from(rows + resized));
}

#[test]
fn pending_page_down_finishes_only_when_the_target_is_loaded() {
    let mut picker = paging_picker(4);
    picker.selected = 2;
    picker.view_rows.set(Some(5));
    picker
        .pagination
        .complete_page(Some(PageCursor::AppServer("cursor-1".into())), 4, false);
    page_key(&mut picker, KeyCode::PageDown);
    assert_eq!(picker.selected, 2);
    assert_eq!(picker.pending_page_down_target, Some(7));
    assert!(picker.has_pending_page_down());
    let token = picker.begin_load();
    picker.apply_thread_page(
        token,
        ThreadPage {
            threads: vec![
                thread("thread-4", "four", false),
                thread("thread-5", "five", false),
            ],
            next_cursor: Some("cursor-2".into()),
        },
    );
    assert_eq!(picker.selected, 2);
    assert!(picker.has_pending_page_down());
    let token = picker.begin_load();
    picker.apply_thread_page(
        token,
        ThreadPage {
            threads: vec![
                thread("thread-6", "six", false),
                thread("thread-7", "seven", false),
                thread("thread-8", "eight", false),
            ],
            next_cursor: None,
        },
    );
    assert_eq!(picker.selected, 7);
    assert!(picker.pending_page_down_target.is_none());
}

#[test]
fn pending_page_down_stops_at_the_real_end_of_history() {
    let mut picker = paging_picker(4);
    picker
        .pagination
        .complete_page(Some(PageCursor::AppServer("cursor-1".into())), 4, false);
    page_key(&mut picker, KeyCode::PageDown);
    let token = picker.begin_load();
    picker.apply_thread_page(
        token,
        ThreadPage {
            threads: vec![thread("last", "last", false)],
            next_cursor: None,
        },
    );
    assert_eq!(picker.selected, 4);
    assert!(picker.pending_page_down_target.is_none());
}

#[test]
fn stale_page_does_not_complete_the_pending_target() {
    let mut picker = paging_picker(4);
    picker
        .pagination
        .complete_page(Some(PageCursor::AppServer("cursor-1".into())), 4, false);
    page_key(&mut picker, KeyCode::PageDown);
    let token = picker.begin_load();
    picker.apply_thread_page(
        token.wrapping_sub(1),
        ThreadPage {
            threads: vec![thread("stale", "stale", false)],
            next_cursor: None,
        },
    );
    assert_eq!(picker.threads.len(), 4);
    assert_eq!(picker.pending_page_down_target, Some(10));
    assert!(picker.pagination.is_loading());
}

#[test]
fn other_navigation_and_query_mutation_cancel_pending_paging() {
    for event in [
        Event::Paste("query".into()),
        Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Home,
            KeyModifiers::NONE,
        )),
        Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Up,
            KeyModifiers::NONE,
        )),
        Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
        )),
    ] {
        let mut picker = paging_picker(4);
        picker
            .pagination
            .complete_page(Some(PageCursor::AppServer("cursor-1".into())), 4, false);
        page_key(&mut picker, KeyCode::PageDown);
        assert!(picker.pending_page_down_target.is_some());
        picker.handle_event(event);
        assert!(picker.pending_page_down_target.is_none());
    }
}

#[test]
fn repeated_page_down_during_loading_preserves_its_target() {
    let mut picker = paging_picker(4);
    picker
        .pagination
        .complete_page(Some(PageCursor::AppServer("cursor-1".into())), 4, false);
    page_key(&mut picker, KeyCode::PageDown);
    picker.begin_load();
    page_key(&mut picker, KeyCode::PageDown);
    assert_eq!(picker.pending_page_down_target, Some(10));
    assert_eq!(picker.selected, 0);
}

#[test]
fn picker_filters_ephemeral_threads_and_navigates() {
    let mut picker = PickerState::new(
        vec![
            thread("hidden", "temporary", true),
            thread("one", "first", false),
            thread("two", "second", false),
        ],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    assert_eq!(picker.threads.len(), 2);
    assert_eq!(picker.selected_thread_id(), Some("one"));
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Down,
            KeyModifiers::NONE,
        ))),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected_thread_id(), Some("two"));
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        PickerAction::Select
    );
}

#[test]
fn picker_provider_filter_is_explicit_and_fail_closed_for_blank_values() {
    let mut picker = PickerState::new(
        Vec::new(),
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.set_model_provider_filter(Some(" managed-provider ".to_string()));
    assert_eq!(picker.model_provider.as_deref(), Some("managed-provider"));
    picker.set_model_provider_filter(Some("   ".to_string()));
    assert_eq!(picker.model_provider, None);
    picker.set_model_provider_filter(None);
    assert_eq!(picker.model_provider, None);
}

#[test]
fn searchable_picker_keeps_plain_vim_letters_for_query_input() {
    let mut picker = PickerState::new(
        vec![
            thread("one", "first", false),
            thread("two", "second", false),
        ],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );

    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('j'),
            KeyModifiers::NONE,
        ))),
        PickerAction::Reload
    );
    assert_eq!(picker.query, "j");
    assert_eq!(picker.selected, 0);
}

#[test]
fn picker_control_navigation_matches_codex_list_bindings() {
    let mut picker = PickerState::new(
        vec![
            thread("one", "first", false),
            thread("two", "second", false),
            thread("three", "third", false),
        ],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );

    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::CONTROL,
        ))),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected, 1);
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('p'),
            KeyModifiers::CONTROL,
        ))),
        PickerAction::MoveUp
    );
    assert_eq!(picker.selected, 0);
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::PageDown,
            KeyModifiers::NONE,
        ))),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected, 2);
}

#[test]
fn unhandled_control_keys_do_not_pollute_resume_query() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
        KeyCode::Char('z'),
        KeyModifiers::CONTROL,
    )));
    assert!(picker.query.is_empty());
}

#[test]
fn truncation_preserves_display_width() {
    let text = truncate_display("你好abc", 5);
    assert!(display_width(&text) <= 5);
    assert!(text.ends_with('…'));
}

#[test]
fn session_picker_action_keeps_resume_and_fork_selection_distinct() {
    let target = SessionTarget {
        path: Some(PathBuf::from("/workspace")),
        thread_id: String::from("thread-1"),
        history_mode: Some(ThreadHistoryMode::Legacy),
    };
    assert_eq!(SessionPickerAction::Resume.action_label(), "resume");
    assert_eq!(
        SessionPickerAction::Fork.selection(target.clone()),
        SessionSelection::Fork(target)
    );
}

#[test]
fn session_target_uses_thread_id_when_path_is_not_available() {
    let target = SessionTarget {
        path: None,
        thread_id: String::from("thread-1"),
        history_mode: None,
    };
    assert_eq!(target.display_label(), "thread thread-1");
}

#[test]
fn picker_search_filters_preview_name_path_and_thread_id() {
    let mut named = thread("named", "unrelated", false);
    named.name = Some("Release checklist".to_string());
    let mut picker = PickerState::new(
        vec![
            named,
            thread("preview-id", "Need a deployment review", false),
            thread("other", "unrelated", false),
        ],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        Some(PathBuf::from("/workspace")),
        true,
    );

    picker.query = "release".to_string();
    picker.set_threads(picker.threads.clone());
    assert_eq!(picker.threads.len(), 1);
    assert_eq!(picker.selected_thread_id(), Some("named"));

    picker.query = "preview-id".to_string();
    picker.set_threads(vec![thread("preview-id", "unrelated", false)]);
    assert_eq!(picker.selected_thread_id(), Some("preview-id"));
}

#[test]
fn picker_controls_match_codex_resume_shortcut_shapes() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        Some(PathBuf::from("/workspace")),
        false,
    );
    picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
        KeyCode::Tab,
        KeyModifiers::NONE,
    )));
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Right,
            KeyModifiers::NONE,
        ))),
        PickerAction::ToggleStatus
    );
    picker.toggle_status();
    assert_eq!(picker.status, SessionStatus::Archived);
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('o'),
            KeyModifiers::CONTROL,
        ))),
        PickerAction::ToggleDensity
    );
    picker.density = picker.density.toggle();
    assert_eq!(picker.density, SessionListDensity::Dense);
}

#[test]
fn raw_ctrl_t_keycode_matches_codex_resume_shortcut() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('\u{0014}'),
            KeyModifiers::NONE,
        ))),
        PickerAction::OpenTranscript
    );
}

#[test]
fn raw_ctrl_e_keycode_matches_codex_resume_shortcut() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('\u{0005}'),
            KeyModifiers::NONE,
        ))),
        PickerAction::ToggleExpanded
    );
}

#[test]
fn picker_only_reloads_for_query_mutations() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        Some(PathBuf::from("/workspace")),
        false,
    );

    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::F(5),
            KeyModifiers::NONE,
        ))),
        PickerAction::None
    );
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
        ))),
        PickerAction::Reload
    );
}

#[test]
fn stale_thread_load_results_do_not_clear_newer_loading_state() {
    let mut picker = PickerState::new(
        Vec::new(),
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    let first = picker.begin_load();
    let second = picker.begin_load();
    picker.apply_threads(first, vec![thread("stale", "stale", false)]);

    assert!(picker.loading);
    assert!(picker.threads.is_empty());

    picker.apply_threads(second, vec![thread("fresh", "fresh", false)]);
    assert!(!picker.loading);
    assert_eq!(picker.selected_thread_id(), Some("fresh"));
}

#[test]
fn thread_pages_append_unique_threads_and_keep_the_next_cursor() {
    let mut picker = PickerState::new(
        Vec::new(),
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    let first_token = picker.begin_load();
    picker.apply_thread_page(
        first_token,
        ThreadPage {
            threads: vec![
                thread("one", "first", false),
                thread("two", "second", false),
            ],
            next_cursor: Some("cursor-1".to_string()),
        },
    );
    assert_eq!(picker.threads.len(), 2);
    assert!(matches!(
        picker.pagination.next_cursor.as_ref(),
        Some(PageCursor::AppServer(cursor)) if cursor == "cursor-1"
    ));
    picker.selected = 1;
    assert!(picker.should_load_more());

    let second_token = picker.begin_load();
    picker.apply_thread_page(
        second_token,
        ThreadPage {
            threads: vec![
                thread("two", "duplicate", false),
                thread("three", "third", false),
            ],
            next_cursor: None,
        },
    );
    assert_eq!(
        picker
            .threads
            .iter()
            .map(|thread| thread.id.as_str())
            .collect::<Vec<_>>(),
        vec!["one", "two", "three"]
    );
    assert!(picker.pagination.next_cursor.is_none());
    assert!(!picker.should_load_more());
}

#[test]
fn query_mutation_invalidates_a_previous_page_cursor() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.pagination.complete_page(
        Some(PageCursor::AppServer("cursor-1".to_string())),
        0,
        false,
    );
    picker.seen_cursors.insert("cursor-1".to_string());
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
        ))),
        PickerAction::Reload
    );
    assert!(picker.pagination.next_cursor.is_none());
    assert!(picker.seen_cursors.is_empty());
}

#[test]
fn page_navigation_matches_codex_shape_and_reaches_the_next_cursor() {
    let mut picker = PickerState::new(
        (0..12)
            .map(|index| thread(&format!("thread-{index}"), "preview", false))
            .collect(),
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.pagination.complete_page(
        Some(PageCursor::AppServer("cursor-1".to_string())),
        12,
        false,
    );
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::PageDown,
            KeyModifiers::NONE,
        ))),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected, 10);
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::PageDown,
            KeyModifiers::NONE,
        ))),
        PickerAction::MoveDown
    );
    assert_eq!(picker.selected, 10);
    assert_eq!(picker.pending_page_down_target, Some(20));
    assert!(picker.should_load_more());
    assert_eq!(
        picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Home,
            KeyModifiers::NONE,
        ))),
        PickerAction::MoveUp
    );
    assert_eq!(picker.selected, 0);
}
