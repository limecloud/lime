use super::*;

#[test]
fn short_picker_layout_preserves_the_selected_session_before_chrome() {
    for height in [1, 2, 4, 8, 12, 24] {
        for selected in [0, 4, 8] {
            let mut picker = PickerState::new(
                (0..9)
                    .map(|index| {
                        let mut thread = thread(&format!("thread-{index}"), "preview", false);
                        thread.name = Some(format!("Session {index}"));
                        thread
                    })
                    .collect(),
                SessionPickerAction::Resume,
                SessionStatus::Active,
                None,
                true,
            );
            picker.selected = selected;
            let mut terminal = Terminal::new(TestBackend::new(80, height)).unwrap();
            terminal
                .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
                .unwrap();
            let text = buffer_text(&terminal);
            assert!(
                text.contains(&format!("› Session {selected}")),
                "height={height} selected={selected}: {text}"
            );
            if height >= 2 {
                assert!(text.contains("esc"), "height={height}: {text}");
            }
        }
    }
}

#[test]
fn picker_section_rectangles_are_bounded_and_keep_one_list_row() {
    for height in 0..40 {
        let area = ratatui::layout::Rect::new(4, 3, 60, height);
        let sections = super::super::layout::areas(area);
        for section in [
            sections.header,
            sections.toolbar,
            sections.search,
            sections.list,
            sections.footer,
        ] {
            assert!(
                section.y >= area.y && section.bottom() <= area.bottom(),
                "area={area:?} section={section:?}"
            );
        }
        assert_eq!(sections.list.height > 0, height > 0);
        assert_eq!(sections.footer.height > 0, height > 1);
    }
}

#[test]
fn selected_summary_and_metadata_fill_the_entire_row() {
    let picker = PickerState::new(
        vec![thread("one", "selected title", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    let mut terminal = Terminal::new(TestBackend::new(80, 12)).unwrap();
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .unwrap();
    let buffer = terminal.backend().buffer();
    let y = (0..12).find(|y| buffer[(2, *y)].symbol() == "›").unwrap();
    let selected = crate::style::selection_style();
    for row in [y, y + 1] {
        for x in 2..78 {
            assert_eq!(buffer[(x, row)].bg, selected.bg.unwrap(), "cell {x},{row}");
            assert!(!buffer[(x, row)].modifier.contains(Modifier::DIM));
        }
    }
}

#[test]
fn expansion_uses_the_current_disclosure_marker() {
    let mut picker = PickerState::new(
        vec![thread("one", "selected title", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.expanded_thread_id = Some("one".into());
    let lines = session_list_item(&picker.threads[0], &picker, 0, Locale::EnUs, 80);
    assert!(lines[0].to_string().starts_with("⌄ selected title"));
}

#[test]
fn visible_rows_do_not_claim_overflow_when_all_sessions_fit() {
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
    picker.selected = 1;
    let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .unwrap();
    let text = buffer_text(&terminal);
    assert!(text.contains("first") && text.contains("second"), "{text}");
    assert!(
        !text.contains("↑ more") && !text.contains("↓ more"),
        "{text}"
    );
}

#[test]
fn resume_search_is_not_displaced_by_toolbar_metadata() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.query = "needle".into();
    let line = resume_search_line(&picker, Locale::EnUs, 24).to_string();
    assert!(line.contains("needle"), "{line}");
    assert!(!line.contains(Locale::EnUs.resume_status_label(false)));
}

#[test]
fn footer_primary_controls_survive_all_product_locales_and_modes() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for action in [SessionPickerAction::Resume, SessionPickerAction::Fork] {
            for status in [SessionStatus::Active, SessionStatus::Archived] {
                let mut picker = PickerState::new(
                    vec![thread("one", "first", false)],
                    action,
                    status,
                    None,
                    true,
                );
                for has_query in [false, true] {
                    picker.query = if has_query {
                        "needle".into()
                    } else {
                        String::new()
                    };
                    for width in [12, 24, 40, 80, 120] {
                        let mut terminal = Terminal::new(TestBackend::new(width, 8)).unwrap();
                        terminal
                            .draw(|frame| render_with_locale(frame, &picker, locale))
                            .unwrap();
                        let text = buffer_text(&terminal);
                        assert!(
                            text.contains("esc") && text.contains("enter"),
                            "{locale:?} width={width}: {text}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn picker_render_is_bounded_for_narrow_unicode_terminal() {
    let picker = PickerState::new(
        vec![thread("one", "你好，这是一段很长的预览", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    let mut terminal = Terminal::new(TestBackend::new(24, 8)).expect("terminal");
    terminal.draw(|frame| render(frame, &picker)).expect("draw");
    assert!(terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .all(|cell| cell.symbol().chars().count() <= 1));
}

#[test]
fn resume_picker_render_matrix_stays_bounded_across_locales_and_widths() {
    let mut threads = (0..12)
        .map(|index| {
            let mut value = thread(
                &format!("thread-{index:02}"),
                "这是一个很长的会话预览，用于验证窄终端上的重排与截断行为",
                false,
            );
            value.name = Some(format!(
                "会话 {index:02} — a deliberately long title for the picker"
            ));
            value.cwd =
                PathBuf::from("/Users/example/Documents/projects/a-very-long-working-directory");
            value
        })
        .collect::<Vec<_>>();
    let selected_id = threads[0].id.clone();
    threads.reverse();

    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [40u16, 80, 120] {
            let mut picker = PickerState::new(
                threads.clone(),
                SessionPickerAction::Resume,
                SessionStatus::Active,
                None,
                true,
            );
            picker.query = "a very long query that must remain clipped safely".to_string();
            picker.selected = picker
                .threads
                .iter()
                .position(|thread| thread.id == selected_id)
                .unwrap_or_default();
            let selected_lines = session_list_item(
                &picker.threads[picker.selected],
                &picker,
                picker.selected,
                locale,
                width,
            );
            assert!(
                selected_lines
                    .iter()
                    .all(|line| line.width() <= usize::from(width)),
                "locale={} width={width} selected row exceeded width: {selected_lines:?}",
                locale.tag()
            );

            let mut terminal = Terminal::new(TestBackend::new(width, 16)).expect("terminal");
            terminal
                .draw(|frame| render_with_locale(frame, &picker, locale))
                .expect("draw");
            let rendered = buffer_text(&terminal);
            assert_eq!(rendered.lines().count(), 16);
            assert!(
                rendered.contains("00"),
                "locale={} width={width} selected row was not visible: {rendered:?}",
                locale.tag()
            );
            assert!(
                rendered.contains("enter") && rendered.contains("esc"),
                "locale={} width={width} footer lost primary actions: {rendered:?}",
                locale.tag()
            );
            assert!(
                terminal.backend().buffer().content().iter().all(|cell| cell
                    .symbol()
                    .chars()
                    .count()
                    <= 1),
                "locale={} width={width} contains a multi-codepoint cell",
                locale.tag()
            );
        }
    }
}

#[test]
fn resume_picker_short_terminal_heights_remain_renderable() {
    let picker = PickerState::new(
        vec![thread("one", "preview", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    for height in [1u16, 2, 4, 7, 8] {
        let mut terminal = Terminal::new(TestBackend::new(40, height)).expect("terminal");
        terminal
            .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
            .expect("draw");
        assert_eq!(terminal.backend().buffer().area.height, height);
    }
}

#[test]
fn resume_search_line_preserves_toolbar_and_display_width_on_narrow_terminals() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.query = "a very long search query that should be shortened".to_string();
    for width in [8, 16, 24, 40] {
        let line = resume_search_line(&picker, Locale::EnUs, width);
        assert!(
            crate::line_truncation::line_width(&line) <= usize::from(width),
            "width={width} line={line:?}"
        );
    }
}

#[test]
fn long_resume_list_keeps_selected_session_visible_after_end_navigation() {
    let mut threads = (0..20)
        .map(|index| {
            let mut value = thread(&format!("thread-{index:02}"), "preview", false);
            value.name = Some(format!("Session {index:02}"));
            value
        })
        .collect::<Vec<_>>();
    threads.reverse();
    let mut picker = PickerState::new(
        threads,
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.handle_event(Event::Key(crossterm::event::KeyEvent::new(
        KeyCode::End,
        KeyModifiers::NONE,
    )));

    let mut terminal = Terminal::new(TestBackend::new(48, 10)).expect("terminal");
    terminal.draw(|frame| render(frame, &picker)).expect("draw");
    let text = buffer_text(&terminal);
    assert!(
        text.contains("Session 00"),
        "selected session was clipped from the viewport: {text}"
    );
}

#[test]
fn ctrl_t_opens_a_shared_transcript_pager_and_starts_loading_when_needed() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    let key = Event::Key(crossterm::event::KeyEvent::new(
        KeyCode::Char('t'),
        KeyModifiers::CONTROL,
    ));
    assert_eq!(picker.handle_event(key), PickerAction::OpenTranscript);
    assert_eq!(
        picker.open_transcript_pager(Locale::EnUs),
        Some("one".to_string())
    );
    assert!(picker.transcript_pager.is_some());
    assert!(matches!(
        picker.transcripts.get("one"),
        Some(SessionTranscriptState::Loading)
    ));

    let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .expect("draw");
    assert!(buffer_text(&terminal).contains("Loading transcript"));
}

#[test]
fn transcript_pager_renders_canonical_entries_scrolls_and_closes_with_ctrl_t() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.transcripts.insert(
        "one".to_string(),
        SessionTranscriptState::Loaded(vec![TranscriptEntry {
            id: "entry-1".to_string(),
            kind: EntryKind::Assistant,
            text: (0..16)
                .map(|index| format!("assistant line {index}"))
                .collect::<Vec<_>>()
                .join("\n"),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }]),
    );
    assert_eq!(picker.open_transcript_pager(Locale::EnUs), None);

    let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .expect("draw");
    let text = buffer_text(&terminal);
    assert!(text.contains("assistant line"));
    for (kind, column) in [
        (MouseEventKind::Down(MouseButton::Left), 0),
        (MouseEventKind::Drag(MouseButton::Left), 4),
        (MouseEventKind::Up(MouseButton::Left), 4),
    ] {
        assert!(picker
            .handle_transcript_pager_event(&Event::Mouse(MouseEvent {
                kind,
                column,
                row: 1,
                modifiers: KeyModifiers::NONE,
            }))
            .is_none());
    }
    assert!(matches!(
        picker.handle_transcript_pager_event(&Event::Key(
            crossterm::event::KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,)
        )),
        Some(PagerAction::CopyTranscriptSelection { text, follow: false }) if !text.is_empty()
    ));
    picker.apply_transcript_copy_result(
        false,
        5,
        &Ok(crate::clipboard_copy::CopyStatus::Unconfirmed),
    );
    assert!(picker
        .transcript_pager
        .as_ref()
        .expect("pager")
        .overlay
        .has_transcript_selection());
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .expect("unconfirmed copy draw");
    assert!(buffer_text(&terminal).contains("Copy sent to terminal"));
    picker.apply_transcript_copy_result(
        false,
        5,
        &Ok(crate::clipboard_copy::CopyStatus::Confirmed),
    );
    let pager = picker.transcript_pager.as_mut().expect("pager");
    assert!(!pager.overlay.has_transcript_selection());
    assert_eq!(
        pager
            .overlay
            .handle_event(&Event::Key(crossterm::event::KeyEvent::new(
                KeyCode::Home,
                KeyModifiers::NONE,
            ))),
        PagerAction::Consumed
    );
    assert_eq!(
        pager
            .overlay
            .handle_event(&Event::Key(crossterm::event::KeyEvent::new(
                KeyCode::Char('t'),
                KeyModifiers::CONTROL,
            ))),
        PagerAction::Close
    );
}

#[test]
fn transcript_pager_reuses_edge_drag_tick_and_resume_stop_contract() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.transcripts.insert(
        "one".to_string(),
        SessionTranscriptState::Loaded(vec![TranscriptEntry {
            id: "entry-1".to_string(),
            kind: EntryKind::Assistant,
            text: (0..20)
                .map(|index| format!("assistant line {index}"))
                .collect::<Vec<_>>()
                .join("\n"),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }]),
    );
    assert_eq!(picker.open_transcript_pager(Locale::EnUs), None);
    let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .expect("tail draw");
    assert!(picker
        .handle_transcript_pager_event(&Event::Key(crossterm::event::KeyEvent::new(
            KeyCode::Home,
            KeyModifiers::NONE,
        )))
        .is_none());
    terminal
        .draw(|frame| render_with_locale(frame, &picker, Locale::EnUs))
        .expect("top draw");

    assert!(picker
        .handle_transcript_pager_event(&Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: 0,
            row: 2,
            modifiers: KeyModifiers::NONE,
        }))
        .is_none());
    assert_eq!(
        picker.handle_transcript_pager_event(&Event::Mouse(MouseEvent {
            kind: MouseEventKind::Drag(MouseButton::Left),
            column: 12,
            row: 5,
            modifiers: KeyModifiers::NONE,
        })),
        Some(PagerAction::ContinueTranscriptSelection)
    );
    assert!(picker.tick_transcript_selection());
    picker.end_transcript_drag();
    assert!(!picker.tick_transcript_selection());
}

#[test]
fn ctrl_e_toggles_selected_session_expansion_and_transcript_loading() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    let key = Event::Key(crossterm::event::KeyEvent::new(
        KeyCode::Char('e'),
        KeyModifiers::CONTROL,
    ));
    assert_eq!(
        picker.handle_event(key.clone()),
        PickerAction::ToggleExpanded
    );
    assert_eq!(
        picker.toggle_selected_expansion(),
        Some(String::from("one"))
    );
    assert_eq!(picker.expanded_thread_id.as_deref(), Some("one"));
    assert!(matches!(
        picker.transcripts.get("one"),
        Some(SessionTranscriptState::Loading)
    ));

    assert_eq!(picker.handle_event(key), PickerAction::ToggleExpanded);
    assert_eq!(picker.toggle_selected_expansion(), None);
    assert_eq!(picker.expanded_thread_id, None);
}

#[test]
fn expanded_transcript_uses_canonical_entries_and_stays_bounded() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.expanded_thread_id = Some(String::from("one"));
    picker.transcripts.insert(
        String::from("one"),
        SessionTranscriptState::Loaded(vec![TranscriptEntry {
            id: String::from("entry-1"),
            kind: EntryKind::Assistant,
            text: String::from("a long assistant response that wraps safely"),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }]),
    );
    let lines = render_expanded_session_details(&picker.threads[0], &picker, 24, Locale::EnUs);
    assert!(lines
        .iter()
        .any(|line| line.to_string().contains("assistant")));
    assert!(lines
        .iter()
        .all(|line| display_width(&line.to_string()) <= 24));
}

#[test]
fn transcript_load_event_records_loaded_and_failed_states() {
    let mut picker = PickerState::new(
        vec![thread("one", "first", false)],
        SessionPickerAction::Resume,
        SessionStatus::Active,
        None,
        true,
    );
    picker.set_transcript(
        String::from("one"),
        Ok(vec![TranscriptEntry {
            id: String::from("entry-1"),
            kind: EntryKind::User,
            text: String::from("hello"),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }]),
    );
    assert!(matches!(
        picker.transcripts.get("one"),
        Some(SessionTranscriptState::Loaded(entries)) if entries.len() == 1
    ));

    picker.set_transcript(String::from("one"), Err(std::io::Error::other("offline")));
    assert!(matches!(
        picker.transcripts.get("one"),
        Some(SessionTranscriptState::Failed)
    ));
}
