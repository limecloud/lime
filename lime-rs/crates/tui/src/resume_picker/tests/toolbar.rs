use super::*;

fn picker(action: SessionPickerAction, cwd: Option<PathBuf>) -> PickerState {
    PickerState::new(
        vec![
            thread("one", "first", false),
            thread("two", "second", false),
        ],
        action,
        SessionStatus::Active,
        cwd,
        false,
    )
}

fn key(picker: &mut PickerState, code: KeyCode, modifiers: KeyModifiers) -> PickerAction {
    picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(code, modifiers)))
}

#[test]
fn tab_cycles_controls_without_mutating_history_or_query() {
    let mut picker = picker(SessionPickerAction::Resume, Some("/workspace".into()));
    picker.selected = 1;
    picker.query = "needle".into();
    let token = picker.load_token;
    for expected in [
        ToolbarControl::Status,
        ToolbarControl::Sort,
        ToolbarControl::Filter,
    ] {
        assert_eq!(
            key(&mut picker, KeyCode::Tab, KeyModifiers::NONE),
            PickerAction::None
        );
        assert_eq!(picker.toolbar_focus, expected);
        assert_eq!(picker.selected_thread_id(), Some("two"));
        assert_eq!(picker.query, "needle");
        assert_eq!(picker.status, SessionStatus::Active);
        assert!(!picker.show_all);
        assert_eq!(picker.sort_key, ThreadSortKey::UpdatedAt);
        assert_eq!(picker.load_token, token);
    }
    for code in [KeyCode::BackTab, KeyCode::Tab] {
        picker.toolbar_focus = ToolbarControl::Filter;
        for expected in [
            ToolbarControl::Sort,
            ToolbarControl::Status,
            ToolbarControl::Filter,
        ] {
            assert_eq!(
                key(&mut picker, code, KeyModifiers::SHIFT),
                PickerAction::None
            );
            assert_eq!(picker.toolbar_focus, expected);
        }
    }
}

#[test]
fn arrows_dispatch_the_focused_control_and_preserve_the_query() {
    let mut picker = picker(SessionPickerAction::Resume, Some("/workspace".into()));
    picker.query = "needle".into();
    for code in [KeyCode::Left, KeyCode::Right] {
        for (control, action) in [
            (ToolbarControl::Filter, PickerAction::ToggleFilter),
            (ToolbarControl::Status, PickerAction::ToggleStatus),
            (ToolbarControl::Sort, PickerAction::ToggleSort),
        ] {
            picker.toolbar_focus = control;
            assert_eq!(key(&mut picker, code, KeyModifiers::NONE), action);
            assert_eq!(picker.query, "needle");
            assert_eq!(picker.selected_thread_id(), Some("one"));
        }
        assert_eq!(
            key(&mut picker, code, KeyModifiers::ALT),
            PickerAction::None
        );
    }
}

#[test]
fn filter_round_trip_retains_the_directory_candidate() {
    let mut picker = picker(SessionPickerAction::Resume, Some("/workspace".into()));
    let cwd = picker.filter_cwd.clone();
    assert!(cwd.is_some());
    assert_eq!(
        key(&mut picker, KeyCode::Right, KeyModifiers::NONE),
        PickerAction::ToggleFilter
    );
    picker.toggle_filter();
    assert!(picker.show_all);
    assert_eq!(
        key(&mut picker, KeyCode::Left, KeyModifiers::NONE),
        PickerAction::ToggleFilter
    );
    picker.toggle_filter();
    assert!(!picker.show_all);
    assert_eq!(picker.filter_cwd, cwd);
}

#[test]
fn unavailable_directory_filter_does_not_reload_or_claim_current_cwd() {
    let mut picker = picker(SessionPickerAction::Resume, None);
    for code in [KeyCode::Left, KeyCode::Right] {
        assert_eq!(
            key(&mut picker, code, KeyModifiers::NONE),
            PickerAction::None
        );
    }
    let line = resume_toolbar_line(&picker, Locale::EnUs, 100).to_string();
    assert!(line.contains("All directories"), "{line}");
    assert!(!line.contains("Current cwd"), "{line}");
    key(&mut picker, KeyCode::Tab, KeyModifiers::NONE);
    assert_eq!(
        key(&mut picker, KeyCode::Right, KeyModifiers::NONE),
        PickerAction::ToggleStatus
    );
    picker.toggle_status();
    assert_eq!(picker.status, SessionStatus::Archived);
    assert!(picker.filter_cwd.is_none());
}

#[test]
fn fork_focus_cycle_and_toolbar_omit_status() {
    let mut picker = picker(SessionPickerAction::Fork, Some("/workspace".into()));
    for code in [KeyCode::Tab, KeyCode::BackTab] {
        for expected in [ToolbarControl::Sort, ToolbarControl::Filter] {
            assert_eq!(
                key(&mut picker, code, KeyModifiers::NONE),
                PickerAction::None
            );
            assert_eq!(picker.toolbar_focus, expected);
            let line = resume_toolbar_line(&picker, Locale::EnUs, 100).to_string();
            assert!(
                !line.contains("Status") && !line.contains("Active"),
                "{line}"
            );
        }
    }
}

#[test]
fn narrow_toolbar_retains_focused_control_and_its_selection_style() {
    let mut picker = picker(SessionPickerAction::Resume, Some("/workspace".into()));
    for (control, value) in [
        (ToolbarControl::Filter, "Current cwd"),
        (ToolbarControl::Status, "Active"),
        (ToolbarControl::Sort, "Updated"),
    ] {
        picker.toolbar_focus = control;
        for width in [1, 8, 18, 36, 100] {
            let line = resume_toolbar_line(&picker, Locale::EnUs, width);
            assert!(crate::line_truncation::line_width(&line) <= usize::from(width));
            let focused = line
                .spans
                .iter()
                .find(|span| span.style == crate::style::active_tab_style())
                .expect("focused span must survive width fallback");
            assert!(focused.style.sub_modifier.contains(Modifier::DIM));
            if width >= 18 {
                assert!(line.to_string().contains(value), "{line}");
            }
        }
        let mut terminal = Terminal::new(TestBackend::new(80, 12)).unwrap();
        terminal
            .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
            .unwrap();
        let toolbar = super::super::layout::areas(terminal.backend().buffer().area).toolbar;
        let buffer = terminal.backend().buffer();
        let active = (toolbar.x..toolbar.right())
            .filter_map(|x| {
                let cell = &buffer[(x, toolbar.y)];
                cell.modifier.contains(Modifier::BOLD).then_some(cell)
            })
            .collect::<Vec<_>>();
        assert!(!active.is_empty());
        assert!(active
            .iter()
            .all(|cell| !cell.modifier.contains(Modifier::DIM)));
    }
}

#[test]
fn toolbar_order_and_interaction_hints_cover_product_locales() {
    let picker = picker(SessionPickerAction::Resume, Some("/workspace".into()));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let line = resume_toolbar_line(&picker, locale, 200).to_string();
        let filter = line.find(locale.resume_toolbar_label("filter")).unwrap();
        let status = line.find(locale.resume_toolbar_label("status")).unwrap();
        let sort = line.find(locale.resume_toolbar_label("sort")).unwrap();
        assert!(filter < status && status < sort, "{line}");
        let hint = locale.resume_controls_hint("←/→");
        assert!(hint.contains("tab") && hint.contains("←/→"), "{hint}");
        assert!(!hint.contains("Esc new"), "{hint}");
    }
}
