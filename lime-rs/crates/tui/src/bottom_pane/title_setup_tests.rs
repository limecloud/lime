use super::*;
use crate::keymap::RuntimeKeymap;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};
use serde_json::json;

fn configured(config: TuiConfig) -> TerminalTitleSetupView {
    let keymap = RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {"accept": "f9", "cancel": "ctrl-x q"}
        }))
        .unwrap(),
    )
    .unwrap();
    TerminalTitleSetupView::new(&config, keymap.list().clone(), Locale::EnUs)
}
fn key(
    view: &mut TerminalTitleSetupView,
    code: KeyCode,
    modifiers: KeyModifiers,
) -> MultiSelectAction {
    view.handle_event(&Event::Key(KeyEvent::new(code, modifiers)))
}

#[test]
fn title_default_empty_and_ordered_aliases_preserve_distinct_preferences() {
    assert_eq!(
        configured(TuiConfig::default()).selected_ids(),
        DEFAULT_TERMINAL_TITLE_ITEMS
    );
    assert!(configured(TuiConfig {
        terminal_title: Some(vec![]),
        ..Default::default()
    })
    .selected_ids()
    .is_empty());
    let view = configured(TuiConfig {
        terminal_title: Some(vec![
            "project".into(),
            "spinner".into(),
            "status".into(),
            "thread".into(),
            "session-id".into(),
            "model-name".into(),
            "project-name".into(),
            "missing".into(),
        ]),
        ..Default::default()
    });
    assert_eq!(
        view.selected_ids(),
        [
            "project-name",
            "activity",
            "run-state",
            "thread-title",
            "thread-id",
            "model"
        ]
    );
}

#[test]
fn title_search_reorder_toggle_and_resolved_controls_share_selection_state() {
    let mut view = configured(TuiConfig::default());
    key(&mut view, KeyCode::Right, KeyModifiers::NONE);
    assert_eq!(
        view.selected_ids(),
        ["thread-name", "activity", "project-name"]
    );
    key(&mut view, KeyCode::Char(' '), KeyModifiers::NONE);
    assert_eq!(view.selected_ids(), ["thread-name", "project-name"]);
    view.handle_event(&Event::Paste("Activity".into()));
    key(&mut view, KeyCode::Right, KeyModifiers::NONE);
    key(&mut view, KeyCode::Char(' '), KeyModifiers::NONE);
    assert_eq!(
        view.selected_ids(),
        ["thread-name", "activity", "project-name"]
    );
    assert_eq!(
        key(&mut view, KeyCode::Enter, KeyModifiers::NONE),
        MultiSelectAction::None
    );
    key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut view, KeyCode::Enter, KeyModifiers::NONE),
        MultiSelectAction::None
    );
    assert_eq!(
        key(&mut view, KeyCode::F(9), KeyModifiers::NONE),
        MultiSelectAction::Confirm
    );
    assert_eq!(
        key(&mut view, KeyCode::Esc, KeyModifiers::NONE),
        MultiSelectAction::None
    );
    key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut view, KeyCode::Char('q'), KeyModifiers::NONE),
        MultiSelectAction::Cancel
    );
    assert_eq!(
        key(&mut view, KeyCode::Char('c'), KeyModifiers::CONTROL),
        MultiSelectAction::Cancel
    );
}

#[test]
fn title_unbound_controls_do_not_fall_back_to_default_keys() {
    let keymap = RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {"accept": [], "cancel": [], "move_left": "f7", "move_right": "f8"}
        }))
        .unwrap(),
    )
    .unwrap();
    let mut view =
        TerminalTitleSetupView::new(&TuiConfig::default(), keymap.list().clone(), Locale::EnUs);
    for code in [KeyCode::Enter, KeyCode::Esc, KeyCode::Right] {
        assert_eq!(
            key(&mut view, code, KeyModifiers::NONE),
            MultiSelectAction::None
        );
    }
    assert_eq!(view.selected_ids(), DEFAULT_TERMINAL_TITLE_ITEMS);
    key(&mut view, KeyCode::F(8), KeyModifiers::NONE);
    assert_eq!(
        view.selected_ids(),
        ["thread-name", "activity", "project-name"]
    );
    key(&mut view, KeyCode::F(7), KeyModifiers::NONE);
    assert_eq!(view.selected_ids(), DEFAULT_TERMINAL_TITLE_ITEMS);
}

#[test]
fn title_preview_uses_real_facts_order_separators_and_unnamed_fallback() {
    let data = StatusSurfacePreviewData {
        current_dir: Some("workspace/项目".into()),
        model: Some("真实模型".into()),
        reasoning: Some("high".into()),
        session_id: Some("thread-real".into()),
        status: Some("ready".into()),
        ..Default::default()
    };
    let ids = [
        "missing",
        "thread-name",
        "project",
        "activity",
        "model-with-reasoning",
        "thread-title",
        "project-name",
    ]
    .map(str::to_string);
    assert_eq!(
        title_text_for_items(&ids, &data, None, false, Locale::EnUs).as_deref(),
        Some("项目 | 真实模型 high | thread-real")
    );
    assert_eq!(
        title_text_for_items(&ids, &data, Some("⠋"), false, Locale::EnUs).as_deref(),
        Some("项目 ⠋ 真实模型 high | thread-real")
    );
    assert!(title_text_for_items(&[], &data, Some("⠋"), true, Locale::EnUs).is_none());
    assert!(
        title_text_for_items(&["thread-name".into()], &data, None, false, Locale::EnUs).is_none()
    );
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let ids = ["project-name", "run-state", "activity", "thread-title"].map(str::to_string);
        assert_eq!(
            title_text_for_items(&ids, &data, Some("[ ! ]"), true, locale).unwrap(),
            format!("[ ! ] {} 项目 thread-real", locale.action_required_label())
        );
        let ids = ["project-name", "run-state"].map(str::to_string);
        assert_eq!(
            title_text_for_items(&ids, &data, Some("[ ! ]"), true, locale).unwrap(),
            format!("项目 | {}", locale.status("ready"))
        );
    }
}

#[test]
fn title_segments_sanitize_controls_and_truncate_unicode_without_losing_following_items() {
    let data = StatusSurfacePreviewData {
        model: Some("界\u{301}".repeat(40)),
        thread_name: Some("\u{200b}\x07".into()),
        session_id: Some("real-id".into()),
        current_dir: Some("/workspace/".to_string() + &"项".repeat(30)),
        ..Default::default()
    };
    let ids = ["model", "project-name", "thread-title"].map(str::to_string);
    assert_eq!(
        title_text_for_items(&ids, &data, None, false, Locale::EnUs).unwrap(),
        format!(
            "{}... | {}... | real-id",
            "界\u{301}".repeat(29),
            "项".repeat(21)
        )
    );
}

#[test]
fn title_shared_layout_reflows_and_keeps_complete_controls_in_all_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let view = TerminalTitleSetupView::new(
            &TuiConfig::default(),
            configured(TuiConfig::default()).picker.keymap,
            locale,
        );
        for (width, height) in [(4, 3), (12, 24), (24, 10), (80, 24)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal
                .draw(|frame| view.render(frame, frame.area(), locale, Some("真实 preview".into())))
                .unwrap();
            let buffer = terminal.backend().buffer();
            let screen = (0..height)
                .map(|y| {
                    (0..width)
                        .map(|x| buffer[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("\n");
            assert!(buffer
                .content
                .iter()
                .all(|cell| !cell.symbol().contains('\n')));
            if width == 80 {
                assert!(screen
                    .replace(' ', "")
                    .contains(&locale.terminal_title_setup_title().replace(' ', "")));
                assert!(screen.contains("ctrl+x q"));
                assert!(screen.replace(' ', "").contains("真实preview"));
            }
            if width == 12 {
                assert!(screen.lines().any(|line| line.trim() == "ctrl+x q"));
            }
        }
    }
}
