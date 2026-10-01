use super::*;
use app_server_protocol::protocol::v2::ThreadHistoryMode;
use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use std::path::PathBuf;

fn thread(id: &str, status: ThreadStatus, updated_at: i64) -> Thread {
    Thread {
        id: id.to_string(),
        extra: None,
        session_id: format!("session-{id}"),
        forked_from_id: None,
        parent_thread_id: None,
        preview: format!("preview-{id}"),
        ephemeral: false,
        section: None,
        section_entered_at: None,
        project_id: None,
        history_mode: ThreadHistoryMode::Legacy,
        model_provider: "test".to_string(),
        created_at: updated_at,
        updated_at,
        recency_at: Some(updated_at),
        status,
        path: None,
        cwd: PathBuf::from("/workspace"),
        cli_version: "test".to_string(),
        source: app_server_protocol::protocol::v2::SessionSource::Cli,
        can_accept_direct_input: Some(true),
        thread_source: None,
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: Some(id.to_string()),
        turns: Vec::new(),
    }
}

pub(super) fn row(id: &str, group: AgentsOverviewGroup, current: bool) -> AgentsOverviewRow {
    AgentsOverviewRow {
        thread: thread(id, ThreadStatus::Idle, 1),
        group,
        is_current: current,
    }
}

#[test]
fn overview_groups_and_selects_current_thread() {
    let view = AgentsOverviewView::new(
        vec![
            row("ready", AgentsOverviewGroup::Ready, false),
            row("main", AgentsOverviewGroup::Working, true),
        ],
        None,
    );
    assert_eq!(view.selected_thread_id(), Some("main"));
    assert_eq!(
        AgentsOverviewGroup::for_status(&ThreadStatus::SystemError),
        AgentsOverviewGroup::NeedsYou
    );
}

#[test]
fn overview_search_filters_and_enter_selects() {
    let mut view = AgentsOverviewView::new(
        vec![
            row("alpha", AgentsOverviewGroup::Ready, false),
            row("beta", AgentsOverviewGroup::Finished, false),
        ],
        None,
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('f'),
            KeyModifiers::NONE
        ))),
        AgentsOverviewAction::None
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('l'),
            KeyModifiers::NONE
        ))),
        AgentsOverviewAction::None
    );
    assert_eq!(view.visible_rows().len(), 1);
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE
        ))),
        AgentsOverviewAction::Select
    );
    assert_eq!(view.selected_thread_id(), Some("alpha"));
}

#[test]
fn overview_show_more_is_selectable_and_loading_is_not_reentrant() {
    let mut view =
        AgentsOverviewView::new(vec![row("alpha", AgentsOverviewGroup::Ready, false)], None);
    view.set_pagination(true, false, false);
    assert_eq!(view.selected_thread_id(), Some("alpha"));
    assert_eq!(
        view.handle_event(Event::Key(
            KeyEvent::new(KeyCode::Down, KeyModifiers::NONE,)
        )),
        AgentsOverviewAction::None
    );
    assert!(view.selected_is_load_more());
    assert_eq!(view.selected_thread_id(), None);
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::LoadMore
    );

    view.set_pagination(true, true, false);
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::None
    );
    view.set_pagination(true, false, true);
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::LoadMore
    );
}

#[test]
fn overview_escape_is_an_explicit_action() {
    let mut view = AgentsOverviewView::default();
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE))),
        AgentsOverviewAction::Cancel
    );
}

#[test]
fn overview_codex_shortcuts_dispatch_rename_stop_and_resume() {
    let mut view = AgentsOverviewView::new(
        vec![row("ready", AgentsOverviewGroup::Ready, false), {
            let mut active = row("active", AgentsOverviewGroup::Working, true);
            active.thread.status = ThreadStatus::Active {
                active_flags: Vec::new(),
            };
            active
        }],
        Some("active"),
    );
    assert_eq!(view.selected_thread_id(), Some("active"));

    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::None
    );
    for character in "run checks".chars() {
        assert_eq!(
            view.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Char(character),
                KeyModifiers::NONE,
            ))),
            AgentsOverviewAction::None
        );
    }
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::Dispatch {
            prompt: "run checks".to_string(),
            cwd: Some(PathBuf::from("/workspace")),
        }
    );

    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('r'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::None
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::Rename {
            thread_id: "active".to_string(),
            name: "active".to_string(),
        }
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::Stop {
            thread_id: "active".to_string(),
        }
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('o'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::OpenResumePicker
    );
}

#[test]
fn overview_chord_does_not_cross_paste_boundary() {
    let mut config = lime_core::config::TuiKeymap::default();
    config.agents.resume = Some(lime_core::config::KeybindingsSpec::One(
        lime_core::config::KeybindingSpec("ctrl-g o".to_string()),
    ));
    let keymap = crate::keymap::RuntimeKeymap::from_config(&config)
        .expect("custom agents chord must be valid");
    let mut view = AgentsOverviewView::new_with_keymap(
        vec![row("ready", AgentsOverviewGroup::Ready, true)],
        Some("ready"),
        keymap.agents().clone(),
        keymap.list().clone(),
    );

    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('g'),
            KeyModifiers::CONTROL,
        ))),
        AgentsOverviewAction::None
    );
    assert_eq!(
        view.handle_event(Event::Paste("paste".to_string())),
        AgentsOverviewAction::None
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('o'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::None
    );

    view.update_rows(vec![row("ready", AgentsOverviewGroup::Ready, true)]);
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('g'),
            KeyModifiers::CONTROL,
        ))),
        AgentsOverviewAction::None
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('o'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::OpenResumePicker
    );
}

#[test]
fn overview_rename_accepts_shifted_characters() {
    let mut view = AgentsOverviewView::new(
        vec![row("active", AgentsOverviewGroup::Working, true)],
        Some("active"),
    );
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('r'),
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::None
    );
    for _ in 0.."active".len() {
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Backspace,
            KeyModifiers::NONE,
        )));
    }
    for (character, modifiers) in [
        ('G', KeyModifiers::SHIFT),
        ('a', KeyModifiers::NONE),
        ('t', KeyModifiers::NONE),
        ('e', KeyModifiers::NONE),
    ] {
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char(character),
            modifiers,
        )));
    }
    assert_eq!(
        view.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        ))),
        AgentsOverviewAction::Rename {
            thread_id: "active".to_string(),
            name: "Gate".to_string(),
        }
    );
}

pub(super) fn press(view: &mut AgentsOverviewView, code: KeyCode) -> AgentsOverviewAction {
    view.handle_event(Event::Key(KeyEvent::new(code, KeyModifiers::NONE)))
}

pub(super) fn screen(
    view: &AgentsOverviewView,
    width: u16,
    height: u16,
    locale: crate::locale::Locale,
) -> (String, ratatui::buffer::Buffer) {
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(width, height))
        .expect("terminal");
    terminal
        .draw(|frame| {
            command_center::render::render_at(frame, frame.area(), view, locale, 1_000_000, None)
        })
        .expect("draw");
    let buffer = terminal.backend().buffer().clone();
    let text = buffer
        .content()
        .chunks(usize::from(width))
        .map(|row| {
            row.iter()
                .map(ratatui::buffer::Cell::symbol)
                .collect::<String>()
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    (text, buffer)
}

#[test]
fn live_center_columns() {
    use crate::locale::Locale;
    let rows = [
        ("Current task", ThreadStatus::Idle, -3600),
        (
            "A longer task title that uses the available column",
            ThreadStatus::Idle,
            330,
        ),
        (
            "Needs an answer",
            ThreadStatus::Active {
                active_flags: vec![ThreadActiveFlag::WaitingOnUserInput],
            },
            7230,
        ),
        ("Unloaded task", ThreadStatus::NotLoaded, 172830),
        (
            "Working task",
            ThreadStatus::Active {
                active_flags: Vec::new(),
            },
            86430,
        ),
        ("Failed task", ThreadStatus::SystemError, 3630),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (title, status, age))| {
        let mut thread = thread(&format!("task-{index}"), status.clone(), 1_000_000 - age);
        thread.name = Some(title.to_string());
        AgentsOverviewRow {
            thread,
            group: AgentsOverviewGroup::for_status(&status),
            is_current: index == 0,
        }
    })
    .collect::<Vec<_>>();
    let view = AgentsOverviewView::new(rows.clone(), Some("task-0"));
    let (text, _) = screen(&view, 160, 22, Locale::EnUs);
    assert!(
        text.lines()
            .next()
            .unwrap()
            .starts_with("  Agent command center  Group: Project  g"),
        "{text}"
    );
    assert!(
        text.contains("All 6") && text.contains("Needs you 2") && text.contains("Ready 2"),
        "{text}"
    );
    assert!(
        text.contains("Tasks") && text.contains("Status") && text.contains("Updated"),
        "{text}"
    );
    assert!(
        text.contains("now") && text.contains("5m ago") && text.contains("2d ago"),
        "{text}"
    );
    assert!(
        text.lines().any(|line| line
            .contains("A longer task title that uses the available column")
            && line.contains("Ready")),
        "{text}"
    );
    assert_eq!(
        text.matches("Current task").count(),
        2,
        "one task row and one details title: {text}"
    );
    assert!(
        !text.contains("current"),
        "no redundant current badge: {text}"
    );
    for index in 0..6 {
        let view = AgentsOverviewView::new(rows.clone(), Some(&format!("task-{index}")));
        let (_, buffer) = screen(&view, 160, 22, Locale::EnUs);
        let row = buffer
            .content()
            .chunks(160)
            .find(|row| row.iter().any(|cell| cell.symbol() == "›"))
            .unwrap();
        let marker = row.iter().position(|cell| cell.symbol() == "›").unwrap();
        assert_eq!(
            row[marker].style(),
            row[marker + 2].style(),
            "selected status shares the selection fill, task-{index}"
        );
        assert_eq!(
            row[marker].style(),
            row[marker + 74].style(),
            "selection fills the whole task list, task-{index}"
        );
        assert_eq!(row[marker + 74].symbol(), " ", "last cell stays blank");
    }
}

#[test]
fn live_center_pages_visible_rows_without_wrapping() {
    use crate::locale::Locale;
    for count in [5, 30] {
        let rows = (0..count)
            .map(|index| {
                let mut thread = thread(
                    &format!("task-{index:02}"),
                    ThreadStatus::Idle,
                    1_000_000 - index as i64,
                );
                if index >= 10 {
                    thread.cwd = PathBuf::from("/workspace2");
                }
                AgentsOverviewRow {
                    thread,
                    group: AgentsOverviewGroup::Ready,
                    is_current: false,
                }
            })
            .collect::<Vec<_>>();
        let mut view = AgentsOverviewView::new(rows, Some("task-00"));
        screen(&view, 110, 18, Locale::EnUs);
        press(&mut view, KeyCode::PageDown);
        assert_eq!(
            view.selected_thread_id(),
            Some(format!("task-{:02}", (count - 1).min(10)).as_str())
        );
        press(&mut view, KeyCode::PageUp);
        press(&mut view, KeyCode::PageUp);
        assert_eq!(view.selected_thread_id(), Some("task-00"));
        for _ in 0..count {
            screen(&view, 110, 18, Locale::EnUs);
            view.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Char('f'),
                KeyModifiers::CONTROL,
            )));
        }
        assert_eq!(
            view.selected_thread_id(),
            Some(format!("task-{:02}", count - 1).as_str())
        );
        press(&mut view, KeyCode::PageDown);
        assert_eq!(
            view.selected_thread_id(),
            Some(format!("task-{:02}", count - 1).as_str())
        );
        press(&mut view, KeyCode::Down);
        let (text, _) = screen(&view, 110, 18, Locale::EnUs);
        assert!(
            text.lines()
                .any(|line| line.trim_start().starts_with("/workspace")),
            "wrapped row navigation must reveal the first group: {text}"
        );
    }
}

#[test]
fn live_center_metadata_clips_at_grapheme_boundaries() {
    use crate::locale::Locale;
    let input = format!("{}日本語 e\u{301} 👩\u{200d}💻", "界".repeat(100_000));
    for key in ['r', 'f'] {
        let mut view =
            AgentsOverviewView::new(vec![row("task", AgentsOverviewGroup::Ready, false)], None);
        press(&mut view, KeyCode::Char(key));
        if key == 'r' {
            view.input.clear();
        }
        view.handle_event(Event::Paste(input.clone()));
        let (text, _) = screen(&view, 40, 18, Locale::EnUs);
        let label = if key == 'r' {
            "Rename › "
        } else {
            "Search › "
        };
        let input_row = text.lines().find(|line| line.contains(label)).unwrap();
        assert!(
            input_row.contains("e\u{301}") && input_row.ends_with("👩\u{200d}💻"),
            "{text}"
        );
        assert_eq!(
            view.cursor_pos(ratatui::layout::Rect::new(0, 0, 40, 18), Locale::EnUs),
            Some((36, 3))
        );
        press(&mut view, KeyCode::Backspace);
        let content = if key == 'r' {
            view.input()
        } else {
            view.search()
        };
        assert!(
            content.ends_with("e\u{301} "),
            "backspace deletes an entire emoji grapheme"
        );
    }
}

#[test]
fn live_center_rename_retains_target_when_status_leaves_filter() {
    for finish in [KeyCode::Esc, KeyCode::Enter] {
        let mut rows = vec![
            row("target", AgentsOverviewGroup::Ready, false),
            row("other", AgentsOverviewGroup::Ready, false),
        ];
        rows[0].thread.updated_at = 2;
        let mut view = AgentsOverviewView::new(rows.clone(), Some("target"));
        for _ in 0..3 {
            press(&mut view, KeyCode::Tab);
        }
        assert_eq!(view.selected_thread_id(), Some("target"));
        press(&mut view, KeyCode::Char('r'));
        rows[0].group = AgentsOverviewGroup::NeedsYou;
        rows[0].thread.status = ThreadStatus::SystemError;
        view.update_rows(rows);
        assert_eq!(view.selected_thread_id(), Some("target"));
        assert_eq!(view.input(), "target");
        press(&mut view, KeyCode::Char('!'));
        let action = press(&mut view, finish);
        if finish == KeyCode::Enter {
            assert_eq!(
                action,
                AgentsOverviewAction::Rename {
                    thread_id: "target".into(),
                    name: "target!".into()
                }
            );
        } else {
            assert_eq!(action, AgentsOverviewAction::None);
        }
        assert_eq!(view.selected_thread_id(), Some("other"));
        assert_eq!(view.visible_rows().len(), 1);
    }
}

#[test]
fn live_center_status_tabs_keep_counts_and_selection_across_refresh() {
    let rows = vec![
        row("input", AgentsOverviewGroup::NeedsYou, false),
        row("working", AgentsOverviewGroup::Working, false),
        row("ready", AgentsOverviewGroup::Ready, true),
        row("inactive", AgentsOverviewGroup::Finished, false),
    ];
    let mut view = AgentsOverviewView::new(rows.clone(), None);
    for id in ["input", "working", "ready", "inactive"] {
        press(&mut view, KeyCode::Tab);
        assert_eq!(view.selected_thread_id(), Some(id));
        view.update_rows(rows.clone());
        assert_eq!(view.selected_thread_id(), Some(id));
        assert_eq!(view.visible_rows().len(), 1);
    }
    press(&mut view, KeyCode::BackTab);
    assert_eq!(view.selected_thread_id(), Some("ready"));
    let (text, _) = screen(&view, 24, 10, crate::locale::Locale::EnUs);
    assert!(
        text.lines().nth(1).unwrap().contains("Ready 1"),
        "active tab survives narrow clipping: {text}"
    );
}

#[test]
fn live_center_configured_tab_binding_takes_precedence_over_status_filter() {
    let mut config = lime_core::config::TuiKeymap::default();
    config.agents.new_task = Some(lime_core::config::KeybindingsSpec::One(
        lime_core::config::KeybindingSpec("shift-tab".into()),
    ));
    let runtime = crate::keymap::RuntimeKeymap::from_config(&config).unwrap();
    let mut view = AgentsOverviewView::new_with_keymap(
        vec![row("task", AgentsOverviewGroup::Ready, true)],
        None,
        runtime.agents().clone(),
        runtime.list().clone(),
    );
    let (text, _) = screen(&view, 110, 18, crate::locale::Locale::EnUs);
    let tabs = text.lines().nth(1).unwrap();
    assert!(
        tabs.contains("tab filter") && !tabs.contains("shift+tab"),
        "{text}"
    );
    press(&mut view, KeyCode::BackTab);
    assert_eq!(view.input_mode(), Some(AgentsOverviewInputMode::NewTask));
    assert_eq!(view.status_filter, 0);
    press(&mut view, KeyCode::Esc);
    press(&mut view, KeyCode::Tab);
    assert_eq!(view.status_filter, 1);
}

#[test]
fn live_center_search_help_and_footer_use_the_actual_configured_keys() {
    use crate::locale::Locale;
    let mut config = lime_core::config::TuiKeymap::default();
    config.agents.new_task = Some(lime_core::config::KeybindingsSpec::One(
        lime_core::config::KeybindingSpec("alt-n".into()),
    ));
    config.agents.rename = Some(lime_core::config::KeybindingsSpec::Many(Vec::new()));
    let runtime = crate::keymap::RuntimeKeymap::from_config(&config).unwrap();
    let mut view = AgentsOverviewView::new_with_keymap(
        vec![row("find", AgentsOverviewGroup::Ready, true)],
        None,
        runtime.agents().clone(),
        runtime.list().clone(),
    );
    let (text, _) = screen(&view, 100, 28, Locale::EnUs);
    assert!(
        text.contains("n new") && !text.contains("ctrl+n new"),
        "configured label: {text}"
    );
    press(&mut view, KeyCode::Char('n'));
    assert_eq!(view.input_mode(), None, "no hidden default fallback");
    press(&mut view, KeyCode::Char('?'));
    let (text, _) = screen(&view, 100, 28, Locale::EnUs);
    assert!(
        text.contains("Task shortcuts") && text.contains("pgdn"),
        "{text}"
    );
    assert!(
        !text.contains("Rename"),
        "unbound task action is not advertised: {text}"
    );
    press(&mut view, KeyCode::Esc);
    press(&mut view, KeyCode::Char('f'));
    for ch in "find".chars() {
        press(&mut view, KeyCode::Char(ch));
    }
    assert_eq!(
        view.search(),
        "find",
        "task action keys type literal text while searching"
    );
    view.update_rows(view.rows.clone());
    assert_eq!(view.search(), "find");
    assert!(view.is_searching());
    assert_eq!(view.input_mode(), None);
}

#[test]
fn live_center_help_footer_is_not_overwritten_by_app_feedback() {
    let mut app = crate::app::App::default();
    app.open_agents_overview();
    app.projection.set_status("agent renamed");
    press(
        &mut app.agents_overview.as_mut().unwrap().view,
        KeyCode::Char('?'),
    );
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(110, 28)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let text = terminal
        .backend()
        .buffer()
        .content()
        .chunks(110)
        .map(|row| {
            row.iter()
                .map(ratatui::buffer::Cell::symbol)
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("Task shortcuts"), "{text}");
    assert!(text.lines().last().unwrap().contains("esc back"), "{text}");
    assert!(
        !text.contains("agent renamed"),
        "app feedback must yield to the help footer: {text}"
    );
}

#[test]
fn live_center_layout_covers_every_product_locale_and_terminal_size() {
    use crate::locale::Locale;
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut view = AgentsOverviewView::new(
            vec![row(
                "日本語 e\u{301} 👩\u{200d}💻",
                AgentsOverviewGroup::Ready,
                true,
            )],
            None,
        );
        for (width, height) in [
            (160, 22),
            (110, 18),
            (80, 16),
            (24, 10),
            (16, 8),
            (4, 3),
            (1, 1),
        ] {
            screen(&view, width, height, locale);
            press(&mut view, KeyCode::Char('r'));
            screen(&view, width, height, locale);
            if let Some((x, y)) =
                view.cursor_pos(ratatui::layout::Rect::new(0, 0, width, height), locale)
            {
                assert!(
                    x < width && y < height,
                    "cursor out of bounds for {} {width}x{height}",
                    locale.tag()
                );
            }
            press(&mut view, KeyCode::Esc);
        }
        let (text, _) = screen(&view, 160, 22, locale);
        let compact = |text: &str| {
            text.chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>()
        };
        assert!(
            compact(&text).contains(&compact(locale.agent_center_label("Agent command center"))),
            "{}: {text}",
            locale.tag()
        );
        assert!(
            compact(&text).contains(&compact(locale.agent_center_label("Task details"))),
            "{}: {text}",
            locale.tag()
        );
        assert!(
            compact(&text).contains(&compact(locale.agent_center_label("Inactive"))),
            "{}: {text}",
            locale.tag()
        );
        if locale != Locale::EnUs {
            assert!(
                !text.contains("Task details") && !text.contains("Prompt"),
                "English details leaked for {}: {text}",
                locale.tag()
            );
        }
    }
}
