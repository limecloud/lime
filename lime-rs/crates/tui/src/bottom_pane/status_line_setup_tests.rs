use super::*;
use crate::keymap::RuntimeKeymap;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};
use serde_json::json;

fn key(
    view: &mut StatusLineSetupView,
    code: KeyCode,
    modifiers: KeyModifiers,
) -> StatusLineSetupAction {
    view.handle_event(&Event::Key(KeyEvent::new(code, modifiers)))
}
fn configured(config: TuiConfig) -> StatusLineSetupView {
    let keymap = RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {"accept": "f9", "cancel": "ctrl-x q"}
        }))
        .unwrap(),
    )
    .unwrap();
    StatusLineSetupView::new(&config, keymap.list().clone(), Locale::EnUs)
}

#[test]
fn status_line_default_empty_and_ordered_selection_are_distinct() {
    let default = configured(TuiConfig::default());
    assert_eq!(
        default.selection(),
        (DEFAULT_STATUS_LINE_ITEMS.map(str::to_string).to_vec(), true)
    );
    let empty = configured(TuiConfig {
        status_line: Some(vec![]),
        ..Default::default()
    });
    assert_eq!(empty.selection(), (vec![], true));
    let ordered = configured(TuiConfig {
        status_line: Some(vec![
            "session-id".into(),
            "model-name".into(),
            "thread-id".into(),
            "status".into(),
            "run-state".into(),
            "unavailable".into(),
        ]),
        ..Default::default()
    });
    assert_eq!(ordered.selection().0, ["thread-id", "model", "run-state"]);
    let mut ordered = ordered;
    assert_eq!(
        key(&mut ordered, KeyCode::F(9), KeyModifiers::NONE),
        StatusLineSetupAction::Confirm {
            items: vec!["thread-id".into(), "model".into(), "run-state".into()],
            use_colors: true,
        }
    );
}

#[test]
fn status_line_confirm_cancel_and_pending_chords_use_the_resolved_keymap() {
    let mut view = configured(TuiConfig::default());
    assert_eq!(
        key(&mut view, KeyCode::Enter, KeyModifiers::NONE),
        StatusLineSetupAction::None
    );
    assert_eq!(
        key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL),
        StatusLineSetupAction::None
    );
    assert_eq!(
        key(&mut view, KeyCode::Enter, KeyModifiers::NONE),
        StatusLineSetupAction::None
    );
    assert_eq!(
        key(&mut view, KeyCode::F(9), KeyModifiers::NONE),
        StatusLineSetupAction::Confirm {
            items: DEFAULT_STATUS_LINE_ITEMS.map(str::to_string).to_vec(),
            use_colors: true,
        }
    );
    assert_eq!(
        key(&mut view, KeyCode::Esc, KeyModifiers::NONE),
        StatusLineSetupAction::None
    );
    key(&mut view, KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(
        key(&mut view, KeyCode::Char('q'), KeyModifiers::NONE),
        StatusLineSetupAction::Cancel
    );
}

#[test]
fn canonical_state_and_thread_names_select_distinct_items_in_all_five_languages() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for item in [StatusLineItem::Status, StatusLineItem::SessionId] {
            let mut view = StatusLineSetupView::new(
                &TuiConfig {
                    status_line: Some(vec![]),
                    ..Default::default()
                },
                configured(TuiConfig::default()).picker.keymap,
                locale,
            );
            let name = locale.status_line_item_name(item);
            view.handle_event(&Event::Paste(name.to_string()));
            assert_eq!(view.picker.filtered_indices.len(), 1, "{locale:?}: {name}");
            key(&mut view, KeyCode::Char(' '), KeyModifiers::NONE);
            assert_eq!(
                key(&mut view, KeyCode::F(9), KeyModifiers::NONE),
                StatusLineSetupAction::Confirm {
                    items: vec![item.id().into()],
                    use_colors: true
                },
                "{locale:?}: {name}"
            );
            let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
            terminal
                .draw(|frame| {
                    view.render(
                        frame,
                        frame.area(),
                        locale,
                        &StatusSurfacePreviewData::default(),
                    )
                })
                .unwrap();
            let screen = terminal
                .backend()
                .buffer()
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect::<String>();
            let compact = |text: &str| {
                text.chars()
                    .filter(|ch| !ch.is_whitespace())
                    .collect::<String>()
            };
            assert!(
                compact(&screen).contains(&compact(name)),
                "{locale:?}: {screen}"
            );
        }
    }
}

#[test]
fn status_line_toggle_reorder_and_search_preserve_selection_identity() {
    let mut view = configured(TuiConfig::default());
    key(&mut view, KeyCode::Right, KeyModifiers::NONE);
    assert_eq!(
        view.selection().0,
        ["current-dir", "model-with-reasoning", "thread-name"]
    );
    key(&mut view, KeyCode::Char(' '), KeyModifiers::NONE);
    assert_eq!(view.selection().0, ["current-dir", "thread-name"]);
    view.handle_event(&Event::Paste("Model".into()));
    assert_eq!(view.picker.query, "Model");
    let selected = view.picker.filtered_indices[view.picker.selected];
    assert_eq!(view.picker.items[selected].id, "model-with-reasoning");
    key(&mut view, KeyCode::Left, KeyModifiers::NONE);
    assert_eq!(view.selection().0, ["current-dir", "thread-name"]);
    key(&mut view, KeyCode::Char(' '), KeyModifiers::NONE);
    assert_eq!(
        view.selection().0,
        ["current-dir", "model-with-reasoning", "thread-name"]
    );
}

#[test]
fn status_line_empty_confirmation_and_color_checkbox_are_independent() {
    let mut view = configured(TuiConfig {
        status_line: Some(vec![]),
        ..Default::default()
    });
    key(&mut view, KeyCode::End, KeyModifiers::NONE);
    key(&mut view, KeyCode::Right, KeyModifiers::NONE);
    key(&mut view, KeyCode::Char(' '), KeyModifiers::NONE);
    view.handle_event(&Event::Paste("missing界".into()));
    assert!(view.picker.filtered_indices.is_empty());
    assert_eq!(
        key(&mut view, KeyCode::F(9), KeyModifiers::NONE),
        StatusLineSetupAction::Confirm {
            items: vec![],
            use_colors: false
        }
    );
}

#[test]
fn status_line_unbound_accept_cancel_and_rebound_order_have_no_hidden_defaults() {
    let keymap = RuntimeKeymap::from_config(
        &serde_json::from_value(json!({"list": {
            "accept": [], "cancel": [], "move_left": "f7", "move_right": "f8"
        }}))
        .unwrap(),
    )
    .unwrap();
    let mut view =
        StatusLineSetupView::new(&TuiConfig::default(), keymap.list().clone(), Locale::EnUs);
    for code in [KeyCode::Enter, KeyCode::Esc, KeyCode::Right] {
        assert_eq!(
            key(&mut view, code, KeyModifiers::NONE),
            StatusLineSetupAction::None
        );
    }
    assert_eq!(view.selection().0, DEFAULT_STATUS_LINE_ITEMS);
    key(&mut view, KeyCode::F(8), KeyModifiers::NONE);
    assert_eq!(
        view.selection().0,
        ["current-dir", "model-with-reasoning", "thread-name"]
    );
    key(&mut view, KeyCode::F(7), KeyModifiers::NONE);
    assert_eq!(view.selection().0, DEFAULT_STATUS_LINE_ITEMS);
    assert_eq!(
        key(&mut view, KeyCode::Char('c'), KeyModifiers::CONTROL),
        StatusLineSetupAction::Cancel
    );
    assert!(RuntimeKeymap::from_config(
        &serde_json::from_value(json!({"list": {"accept": "space"}})).unwrap()
    )
    .is_err());
}

#[test]
fn status_line_preview_omits_unavailable_facts_and_keeps_configured_order() {
    let facts = StatusSurfacePreviewData {
        model: Some("\x1b[31m真实模型\x1b[0m".into()),
        reasoning: Some("high".into()),
        current_dir: Some("/界\nproject".into()),
        ..Default::default()
    };
    let ids = [
        "thread-id",
        "unknown",
        "current-dir",
        "model-with-reasoning",
        "thread-name",
        "raw-output",
    ]
    .map(str::to_string);
    assert_eq!(
        facts.line(&ids, false, Locale::EnUs).unwrap().to_string(),
        "/界 project · 真实模型 high"
    );
    assert!(facts
        .line(&["unknown".into()], true, Locale::EnUs)
        .is_none());
    assert!(facts.line(&[], true, Locale::EnUs).is_none());
}

#[test]
fn status_line_layout_wraps_and_reflows_in_all_locales() {
    let facts = StatusSurfacePreviewData {
        model: Some("fixture-model".into()),
        current_dir: Some("/项目/界👩‍💻/workspace".into()),
        ..Default::default()
    };
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut view = StatusLineSetupView::new(
            &TuiConfig::default(),
            configured(TuiConfig::default()).picker.keymap,
            locale,
        );
        for (width, height) in [(4, 3), (12, 24), (24, 10), (80, 24)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal
                .draw(|frame| view.render(frame, frame.area(), locale, &facts))
                .unwrap();
            let buffer = terminal.backend().buffer();
            assert!(buffer
                .content
                .iter()
                .all(|cell| !cell.symbol().contains('\n')));
            if width == 80 {
                let screen = buffer
                    .content
                    .iter()
                    .map(|cell| cell.symbol())
                    .collect::<String>();
                assert!(screen
                    .replace(' ', "")
                    .contains(&locale.status_line_title().replace(' ', "")));
                assert!(screen.contains("fixture-model"));
                assert!(screen.contains("ctrl+x q"));
            }
            key(&mut view, KeyCode::End, KeyModifiers::NONE);
        }
    }
}
