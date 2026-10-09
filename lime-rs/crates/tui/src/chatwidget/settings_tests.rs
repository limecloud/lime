use super::*;
use ratatui::{backend::TestBackend, Terminal};

fn prompt(widget: &ChatWidget) -> (String, ratatui::style::Color) {
    let mut terminal = Terminal::new(TestBackend::new(30, 5)).unwrap();
    terminal
        .draw(|frame| {
            crate::bottom_pane::render_with_locale(
                frame,
                frame.area(),
                &widget.bottom_pane,
                crate::locale::Locale::EnUs,
            );
        })
        .unwrap();
    let cell = &terminal.backend().buffer()[(0, 1)];
    (cell.symbol().to_string(), cell.fg)
}

#[test]
fn settings_and_model_selection_refresh_the_prompt_without_restoring_stale_draft_tiers() {
    let mut widget = ChatWidget::default();
    widget.bottom_pane.set_composer_text("source draft".into());
    widget.set_settings(None, None, Some("ultra".into()), None);
    assert_eq!(prompt(&widget).0, "»");
    widget.capture_thread_input("source");
    widget.apply_model_selection("model".into(), Some("provider".into()), Some("low".into()));
    widget.restore_thread_input("source");
    assert_eq!(widget.bottom_pane.composer_text(), "source draft");
    assert_eq!(prompt(&widget).0, "›");
    widget.apply_effort("ultra".into());
    assert_eq!(prompt(&widget).0, "»");
    widget.set_settings(None, None, None, None);
    assert_eq!(prompt(&widget).0, "›");
}

#[test]
fn collaboration_scope_retains_its_override_until_an_explicit_mode_clear() {
    let mut widget = ChatWidget::default();
    widget.set_settings(Some("model".into()), None, Some("medium".into()), None);
    widget.set_collaboration_mode(agent_protocol::CollaborationMode {
        mode: agent_protocol::ModeKind::Plan,
        settings: agent_protocol::CollaborationModeSettings {
            model: "model".into(),
            reasoning_effort: Some("ultra".into()),
            developer_instructions: None,
        },
    });
    assert_eq!(prompt(&widget).0, "»");
    widget.set_settings(Some("model".into()), None, None, None);
    assert_eq!(prompt(&widget).0, "»");
    assert_eq!(
        widget
            .collaboration_mode
            .as_ref()
            .unwrap()
            .settings
            .reasoning_effort
            .as_deref(),
        Some("ultra"),
    );
    widget.set_collaboration_mode(agent_protocol::CollaborationMode {
        mode: agent_protocol::ModeKind::Default,
        settings: agent_protocol::CollaborationModeSettings {
            model: "model".into(),
            reasoning_effort: None,
            developer_instructions: None,
        },
    });
    assert_eq!(prompt(&widget).0, "›");
    assert_eq!(
        widget.collaboration_mode.unwrap().settings.reasoning_effort,
        None
    );
}
