use super::super::tests::{press, row, screen};
use super::super::{AgentsOverviewAction, AgentsOverviewInputMode};
use super::*;
use crate::{keymap::RuntimeKeymap, locale::Locale};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use serde_json::json;

fn configured(value: serde_json::Value) -> RuntimeKeymap {
    RuntimeKeymap::from_config(&serde_json::from_value(value).unwrap()).unwrap()
}

fn view(value: serde_json::Value) -> AgentsOverviewView {
    let keymap = configured(value);
    AgentsOverviewView::new_with_keymap(
        (0..12)
            .map(|index| {
                row(
                    &format!("task-{index:02}"),
                    AgentsOverviewGroup::Ready,
                    index == 0,
                )
            })
            .collect(),
        Some("task-00"),
        keymap.agents().clone(),
        keymap.list().clone(),
    )
}

fn key(
    view: &mut AgentsOverviewView,
    code: KeyCode,
    modifiers: KeyModifiers,
) -> AgentsOverviewAction {
    view.handle_event(Event::Key(KeyEvent::new(code, modifiers)))
}

fn cancel(view: &mut AgentsOverviewView) -> AgentsOverviewAction {
    key(view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    press(view, KeyCode::Char('q'))
}

#[test]
fn configured_list_navigation_accept_and_cancel_have_no_hidden_defaults() {
    let mut view = view(
        json!({"list":{"accept":"f9", "cancel":"ctrl-x q", "page_down":"ctrl-d", "page_up":"ctrl-u", "jump_top":"ctrl-a", "jump_bottom":"ctrl-y"}}),
    );
    screen(&view, 100, 12, Locale::EnUs);
    for code in [KeyCode::Enter, KeyCode::Esc, KeyCode::PageDown] {
        assert_eq!(press(&mut view, code), AgentsOverviewAction::None);
        assert_eq!(view.selected_thread_id(), Some("task-00"));
    }
    assert_eq!(
        key(&mut view, KeyCode::Char('d'), KeyModifiers::CONTROL),
        AgentsOverviewAction::None
    );
    assert_ne!(
        view.selected_thread_id(),
        Some("task-00"),
        "Ctrl-D pages instead of closing"
    );
    key(&mut view, KeyCode::Char('y'), KeyModifiers::CONTROL);
    assert_eq!(view.selected_thread_id(), Some("task-11"));
    key(&mut view, KeyCode::Char('a'), KeyModifiers::CONTROL);
    assert_eq!(view.selected_thread_id(), Some("task-00"));
    assert_eq!(
        press(&mut view, KeyCode::F(9)),
        AgentsOverviewAction::Select
    );
    assert_eq!(cancel(&mut view), AgentsOverviewAction::Cancel);
}

#[test]
fn configured_editor_confirmation_and_cancel_do_not_dispatch_task_shortcuts() {
    let mut view = view(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}));
    press(&mut view, KeyCode::Char('n'));
    for ch in "nrxgof".chars() {
        press(&mut view, KeyCode::Char(ch));
    }
    for code in [KeyCode::Enter, KeyCode::Esc] {
        assert_eq!(press(&mut view, code), AgentsOverviewAction::None);
    }
    assert_eq!(view.input_mode(), Some(AgentsOverviewInputMode::NewTask));
    assert!(
        matches!(press(&mut view, KeyCode::F(9)), AgentsOverviewAction::Dispatch { prompt, .. } if prompt == "nrxgof")
    );
    press(&mut view, KeyCode::Char('r'));
    assert_eq!(view.input_mode(), Some(AgentsOverviewInputMode::Rename));
    assert_eq!(cancel(&mut view), AgentsOverviewAction::None);
    assert_eq!(view.input_mode(), None);
    assert_eq!(view.selected_thread_id(), Some("task-00"));
    press(&mut view, KeyCode::Char('f'));
    for ch in "task-01".chars() {
        press(&mut view, KeyCode::Char(ch));
    }
    assert_eq!(
        press(&mut view, KeyCode::F(9)),
        AgentsOverviewAction::Select
    );
    assert_eq!(view.selected_thread_id(), Some("task-01"));
}

#[test]
fn task_and_list_chords_with_one_prefix_share_the_pending_owner() {
    let mut view = view(
        json!({"list":{"cancel":"ctrl-x q"}, "agents":{"rename":"ctrl-x r", "resume":"ctrl-x o"}}),
    );
    key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        press(&mut view, KeyCode::Char('o')),
        AgentsOverviewAction::OpenResumePicker
    );
    key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    press(&mut view, KeyCode::Char('r'));
    assert_eq!(view.input_mode(), Some(AgentsOverviewInputMode::Rename));
    assert_eq!(cancel(&mut view), AgentsOverviewAction::None);
    key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    view.handle_event(Event::Resize(80, 24));
    assert_eq!(
        press(&mut view, KeyCode::Char('q')),
        AgentsOverviewAction::None
    );
    assert_eq!(cancel(&mut view), AgentsOverviewAction::Cancel);
}

#[test]
fn task_chord_prefix_outranks_a_list_single_and_preserves_reachable_alternatives() {
    let mut view =
        view(json!({"list":{"cancel":["ctrl-x", "f8"]}, "agents":{"resume":"ctrl-x o"}}));
    assert!(view
        .center_footer_hints(Locale::EnUs)
        .iter()
        .any(|(key, action)| key == "f8" && action == "back"));
    assert_eq!(
        key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL),
        AgentsOverviewAction::None
    );
    assert_eq!(
        press(&mut view, KeyCode::Char('o')),
        AgentsOverviewAction::OpenResumePicker
    );
    assert_eq!(
        press(&mut view, KeyCode::F(8)),
        AgentsOverviewAction::Cancel
    );
    press(&mut view, KeyCode::Char('?'));
    assert!(view.help);
    assert_eq!(
        key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL),
        AgentsOverviewAction::None
    );
    assert!(
        !view.help,
        "help uses the actual list cancel without task precedence"
    );
}

#[test]
fn task_priority_filters_unreachable_hints_but_editing_restores_list_keys() {
    let mut view =
        view(json!({"list":{"accept":["f9", "f8"], "cancel":"q"}, "agents":{"resume":"f9"}}));
    let (text, _) = screen(&view, 100, 24, Locale::EnUs);
    assert!(
        text.contains("f8 open") && !text.contains("f9 open"),
        "{text}"
    );
    assert_eq!(
        press(&mut view, KeyCode::F(9)),
        AgentsOverviewAction::OpenResumePicker
    );
    press(&mut view, KeyCode::Char('f'));
    let hints = view.center_footer_hints(Locale::EnUs);
    assert!(hints
        .iter()
        .any(|(key, action)| key == "f9" && action == "open"));
    assert_eq!(
        press(&mut view, KeyCode::Char('q')),
        AgentsOverviewAction::None
    );
    assert!(!view.searching);
    assert_eq!(
        press(&mut view, KeyCode::F(8)),
        AgentsOverviewAction::Select
    );
}

#[test]
fn unbound_list_actions_are_not_executed_or_advertised() {
    let mut view = view(
        json!({"list":{"accept":[], "cancel":[], "move_up":[], "move_down":[], "move_right":[], "page_up":[], "page_down":[]}}),
    );
    for code in [
        KeyCode::Enter,
        KeyCode::Esc,
        KeyCode::Up,
        KeyCode::Down,
        KeyCode::Right,
        KeyCode::PageDown,
    ] {
        assert_eq!(press(&mut view, code), AgentsOverviewAction::None);
        assert_eq!(view.selected_thread_id(), Some("task-00"));
    }
    let hints = view.center_footer_hints(Locale::EnUs);
    assert!(!hints
        .iter()
        .any(|(_, action)| ["back", "move", "open"].contains(&action.as_str())));
    press(&mut view, KeyCode::Char('?'));
    let (text, _) = screen(&view, 100, 24, Locale::EnUs);
    assert!(
        !text.contains("Page down") && !text.contains("Page up"),
        "{text}"
    );
    assert_eq!(
        key(&mut view, KeyCode::Char('c'), KeyModifiers::CONTROL),
        AgentsOverviewAction::None
    );
    assert_eq!(
        key(&mut view, KeyCode::Char('c'), KeyModifiers::CONTROL),
        AgentsOverviewAction::Cancel
    );
}

#[test]
fn help_and_all_locale_footers_share_custom_confirmation_keys() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut view = view(
            json!({"list":{"accept":"f9", "cancel":"ctrl-x q", "move_up":"f6", "move_down":"f7"}}),
        );
        let hints = view.center_footer_hints(locale);
        assert!(hints.iter().any(|(key, _)| key == "f9"));
        assert!(hints.iter().any(|(key, _)| key == "ctrl+x q"));
        assert!(hints.iter().any(|(key, _)| key == "f6/f7"));
        for (width, height) in [(24, 12), (100, 24)] {
            screen(&view, width, height, locale);
        }
        press(&mut view, KeyCode::Char('?'));
        assert_eq!(press(&mut view, KeyCode::Esc), AgentsOverviewAction::None);
        assert!(view.help);
        let mut repeat = KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE);
        repeat.kind = KeyEventKind::Repeat;
        view.handle_event(Event::Key(repeat));
        assert!(view.help);
        assert_eq!(cancel(&mut view), AgentsOverviewAction::None);
        assert!(!view.help);
    }
}

#[test]
fn app_agent_center_consumes_the_same_startup_snapshot_as_the_model_picker() {
    let mut app = crate::app::App::default();
    app.set_runtime_keymap(configured(
        json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}),
    ));
    app.open_agents_overview();
    let center = &mut app.agents_overview.as_mut().unwrap().view;
    assert_eq!(press(center, KeyCode::Esc), AgentsOverviewAction::None);
    assert_eq!(cancel(center), AgentsOverviewAction::Cancel);
}

#[test]
fn fullscreen_notice_does_not_overpaint_the_configured_controls_or_editor() {
    let mut app = crate::app::App {
        locale: Locale::EnUs,
        ..crate::app::App::default()
    };
    app.set_runtime_keymap(configured(
        json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}),
    ));
    app.open_agents_overview();
    app.projection.set_status("agents overview refreshed");
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 16)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    let line = |y| {
        (0..100)
            .map(|x| buffer[(x, y)].symbol())
            .collect::<String>()
    };
    assert!(
        line(15).contains("ctrl+x q back") && line(15).contains("f9 open"),
        "{}",
        line(15)
    );
    assert!(!line(15).contains("refreshed"));
    assert!(line(14).contains("refreshed"), "{}", line(14));
    press(
        &mut app.agents_overview.as_mut().unwrap().view,
        KeyCode::Char('n'),
    );
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let text = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>();
    assert!(
        text.contains("New task ›") && text.contains("f9 confirm"),
        "{text}"
    );
    assert!(
        !text.contains("refreshed"),
        "editing owns the surface: {text}"
    );
}

#[test]
fn narrow_footer_keeps_complete_actionable_keys_instead_of_truncated_chords() {
    let view = view(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}}));
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for (width, expected) in [(8, "f9"), (12, "ctrl+x q"), (24, "ctrl+x q")] {
            let (text, _) = screen(&view, width, 16, locale);
            let footer = text.lines().last().unwrap();
            assert!(footer.contains(expected), "{locale:?}/{width}: {footer}");
            assert!(!footer.contains('…'), "no partial shortcut: {footer}");
        }
    }
}

#[test]
fn footer_yields_to_task_keys_and_restores_cancel_while_editing() {
    let mut view = view(json!({"agents":{"new_task":"up", "resume":"esc"}}));
    let hints = view.center_footer_hints(Locale::EnUs);
    assert!(hints
        .iter()
        .any(|(key, action)| key == "ctrl+p/↓" && action == "move"));
    assert!(!hints.iter().any(|(_, action)| action == "back"));
    assert_eq!(
        press(&mut view, KeyCode::Esc),
        AgentsOverviewAction::OpenResumePicker
    );
    press(&mut view, KeyCode::Up);
    assert_eq!(view.input_mode(), Some(AgentsOverviewInputMode::NewTask));
    assert!(view
        .center_footer_hints(Locale::EnUs)
        .iter()
        .any(|(key, action)| key == "esc" && action == "back"));
    assert_eq!(press(&mut view, KeyCode::Esc), AgentsOverviewAction::None);
    assert_eq!(view.input_mode(), None);
}
