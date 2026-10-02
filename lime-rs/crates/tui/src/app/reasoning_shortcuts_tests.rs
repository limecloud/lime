use super::*;
use crate::model_catalog::tests::model;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{
    CommandExecutionRequestApprovalParams, ReasoningEffortOption, ServerRequest,
};
use app_server_protocol::RequestId;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ReasoningShortcutDirection::{Lower, Raise};

fn ready() -> App {
    let mut app = App {
        thread_id: Some("thread".into()),
        ..App::default()
    };
    let mut model = model("reasoner", "provider", false);
    model.supported_reasoning_efforts = ["low", "medium", "high", "ultra", "max"]
        .iter()
        .map(|effort| ReasoningEffortOption {
            reasoning_effort: (*effort).into(),
            description: String::new(),
        })
        .collect();
    app.set_model_catalog(vec![model]);
    app.set_settings(
        Some("reasoner".into()),
        Some("provider".into()),
        Some("medium".into()),
        None,
    );
    app.chat_widget.bottom_pane.insert_str("draft");
    app
}

fn shortcut(app: &mut App, code: char) -> AppAction {
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char(code), KeyModifiers::ALT)),
        true,
    )
}

#[test]
fn preparing_a_supported_step_does_not_change_local_settings_or_draft() {
    let mut app = ready();
    assert_eq!(app.prepare_reasoning_shortcut(Raise), Some("high".into()));
    assert_eq!(app.prepare_reasoning_shortcut(Lower), Some("low".into()));
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn boundary_and_ultra_navigation_are_informational_not_settings_changes() {
    let mut app = ready();
    app.chat_widget.reasoning_effort = Some("low".into());
    assert_eq!(app.prepare_reasoning_shortcut(Lower), None);
    assert_eq!(
        app.projection.status(),
        "Reasoning is already at the lowest level (Low)."
    );
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("low"));
    app.chat_widget.reasoning_effort = Some("max".into());
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert_eq!(
        app.projection.status(),
        "Ultra is available under /model → reasoner → More reasoning…"
    );
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("max"));
}

#[test]
fn unavailable_or_ambiguous_catalog_never_guesses_an_effort() {
    let mut app = ready();
    app.chat_widget.model_catalog.models.clear();
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert_eq!(
        app.projection.status(),
        "Reasoning shortcuts are unavailable for reasoner."
    );
    let mut app = ready();
    app.chat_widget
        .model_catalog
        .models
        .push(app.chat_widget.model_catalog.models[0].clone());
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("medium"));
}

#[test]
fn startup_and_parent_owned_threads_are_not_mutable_by_shortcuts() {
    let mut app = ready();
    app.thread_id = None;
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert_eq!(
        app.projection.status(),
        "Reasoning shortcuts are disabled until startup completes."
    );
    app.thread_id = Some("thread".into());
    app.begin_startup_input_boundary();
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    app.startup_protected_input_boundary = false;
    app.agent_navigation.mark_parent_owned("thread");
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert_eq!(
        app.projection.status(),
        "Sub-agent thread is parent-owned; reasoning cannot be changed directly."
    );
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("medium"));
}

#[test]
fn plan_scope_fails_closed_instead_of_mutating_the_ordinary_effort() {
    let mut app = ready();
    app.chat_widget.collaboration_mode = Some(agent_protocol::CollaborationMode {
        mode: agent_protocol::ModeKind::Plan,
        settings: agent_protocol::CollaborationModeSettings {
            model: "reasoner".into(),
            reasoning_effort: Some("low".into()),
            developer_instructions: None,
        },
    });
    let mode = app.chat_widget.collaboration_mode.clone();
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert!(app
        .projection
        .status()
        .contains("Plan-only reasoning changes are not supported"));
    assert_eq!(app.chat_widget.collaboration_mode, mode);
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("medium"));
}

#[test]
fn model_picker_and_status_own_alt_reasoning_keys() {
    let mut app = ready();
    app.open_model_picker(app.chat_widget.model_catalog.models.clone());
    assert_eq!(shortcut(&mut app, '.'), AppAction::None);
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    app.chat_widget.model_picker = None;
    app.open_status_pager();
    assert_eq!(shortcut(&mut app, ','), AppAction::None);
    assert_eq!(app.prepare_reasoning_shortcut(Lower), None);
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn approval_popup_and_external_editor_block_settings_dispatch() {
    let mut app = ready();
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(7),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread".into(),
                turn_id: "turn".into(),
                item_id: "item".into(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".into()),
                cwd: None,
                available_decisions: None,
            },
        })
        .unwrap();
    assert_eq!(shortcut(&mut app, '.'), AppAction::None);
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert!(app.chat_widget.bottom_pane.is_active());
    let mut app = ready();
    app.chat_widget.bottom_pane.set_composer_text("/mo".into());
    assert!(app.chat_widget.bottom_pane.popup_active());
    let action = shortcut(&mut app, '.');
    assert!(!matches!(
        action,
        AppAction::DecreaseEffort | AppAction::IncreaseEffort
    ));
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    let mut app = ready();
    app.set_external_editor_state(ExternalEditorState::Active);
    assert_eq!(app.prepare_reasoning_shortcut(Raise), None);
    assert_eq!(app.chat_widget.reasoning_effort.as_deref(), Some("medium"));
}

#[test]
fn reasoning_keys_preserve_drafts_and_ignore_release_events() {
    let mut app = ready();
    assert_eq!(shortcut(&mut app, '.'), AppAction::IncreaseEffort);
    assert_eq!(shortcut(&mut app, ','), AppAction::DecreaseEffort);
    let release =
        KeyEvent::new_with_kind(KeyCode::Char('.'), KeyModifiers::ALT, KeyEventKind::Release);
    assert_eq!(
        app.handle_tui_event(TuiEvent::Key(release), true),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn reasoning_feedback_is_localized_with_catalog_identity_preserved() {
    for (locale, updated, lowest) in [
        (
            Locale::ZhCn,
            "推理强度：高",
            "推理强度已处于最低档位（低）。",
        ),
        (
            Locale::ZhTw,
            "推理強度：高",
            "推理強度已處於最低檔位（低）。",
        ),
        (
            Locale::EnUs,
            "Reasoning: High",
            "Reasoning is already at the lowest level (Low).",
        ),
        (
            Locale::JaJp,
            "推論レベル：高",
            "推論レベルはすでに最低です（低）。",
        ),
        (
            Locale::KoKr,
            "추론 수준: 높음",
            "이미 가장 낮은 추론 수준입니다(낮음).",
        ),
    ] {
        let mut app = ready();
        app.locale = locale;
        app.chat_widget.reasoning_effort = Some("low".into());
        assert_eq!(app.prepare_reasoning_shortcut(Lower), None);
        assert_eq!(app.projection.status(), lowest);
        assert_eq!(locale.reasoning_updated_message("high"), updated);
        assert!(locale
            .reasoning_ultra_message("catalog-model")
            .contains("/model → catalog-model →"));
        assert!(locale
            .reasoning_unavailable_message("catalog-model")
            .contains("catalog-model"));
    }
}
