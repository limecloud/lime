use super::*;
use crate::bottom_pane::{LocalImageAttachment, RemoteImageAttachment};
use crate::chatwidget::ExternalEditorState;
use agent_protocol::TextElement;
use app_server_protocol::protocol::v2::{
    CommandExecutionApprovalDecision, CommandExecutionRequestApprovalParams, McpServerStartupState,
    McpServerStatusDetail, McpServerStatusUpdatedNotification, ServerNotification, ServerRequest,
    ToolRequestUserInputOption, ToolRequestUserInputParams, ToolRequestUserInputQuestion,
    UserInput,
};
use app_server_protocol::RequestId;
use crossterm::event::{
    Event, KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
use lime_core::config::{KeybindingSpec, KeybindingsSpec, TuiKeymap};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

use crate::resume_picker::PickerState;
use crate::tui::TuiEvent;

fn dispatch_connected_input(app: &mut App, event: Event) -> AppAction {
    app.handle_tui_event(to_tui_event(event), true)
}

fn dispatch_disconnected_input(app: &mut App, event: Event) -> AppAction {
    app.handle_tui_event(to_tui_event(event), false)
}

fn to_tui_event(event: Event) -> TuiEvent {
    match event {
        Event::Key(key) => TuiEvent::Key(key),
        Event::Paste(text) => TuiEvent::Paste(text),
        Event::Mouse(mouse) => TuiEvent::Mouse(mouse),
        Event::Resize(width, height) => TuiEvent::Resize(ratatui::layout::Size { width, height }),
        Event::FocusGained => TuiEvent::FocusGained,
        Event::FocusLost => TuiEvent::FocusLost,
    }
}

#[test]
fn active_bottom_pane_receives_input_before_the_chat_composer() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(7),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue approval");

    let ignored = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
    );
    assert_eq!(ignored, AppAction::None);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");

    let response = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
    );
    assert!(matches!(
        response,
        AppAction::Respond(AppServerResponse::Command {
            response: app_server_protocol::protocol::v2::CommandExecutionRequestApprovalResponse {
                decision: CommandExecutionApprovalDecision::Accept,
            },
            ..
        })
    ));
    assert!(!app.chat_widget.bottom_pane.is_active());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn modal_transcript_wheel_scrolls_only_inside_the_visible_transcript() {
    let mut app = App::default();
    app.transcript_view.selection.update_layout(
        Rect::new(0, 0, 40, 5),
        5,
        &(0..20)
            .map(|index| crate::terminal_hyperlinks::HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>(),
    );
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(11),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue approval");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: 10,
                row: 2,
                modifiers: KeyModifiers::NONE,
            }),
        ),
        AppAction::ScrollRows(-3)
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::ScrollDown,
                column: 10,
                row: 7,
                modifiers: KeyModifiers::NONE,
            }),
        ),
        AppAction::None
    );

    // Keyboard ownership remains with the active approval surface.
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn modal_transcript_wheel_remains_available_during_request_user_input() {
    let mut app = App::default();
    app.transcript_view.selection.update_layout(
        Rect::new(0, 0, 40, 5),
        5,
        &(0..20)
            .map(|index| crate::terminal_hyperlinks::HyperlinkLine::from(format!("line {index}")))
            .collect::<Vec<_>>(),
    );
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(12),
            params: ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "question-1".to_string(),
                questions: vec![ToolRequestUserInputQuestion {
                    id: "mode".to_string(),
                    header: "Mode".to_string(),
                    question: "Choose a mode".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: Some(vec![ToolRequestUserInputOption {
                        label: "Fast".to_string(),
                        description: "Continue immediately".to_string(),
                    }]),
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        })
        .expect("queue user input");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::ScrollDown,
                column: 10,
                row: 3,
                modifiers: KeyModifiers::NONE,
            }),
        ),
        AppAction::ScrollRows(3)
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn mcp_startup_status_is_app_scoped_and_clears_when_ready() {
    let mut app = App::default();
    app.apply_notification(ServerNotification::McpServerStatusUpdated(
        McpServerStatusUpdatedNotification {
            thread_id: None,
            name: "docs".to_string(),
            status: McpServerStartupState::Failed,
            error: Some("offline".to_string()),
            failure_reason: None,
        },
    ));
    assert_eq!(app.projection.status(), "");
    assert_eq!(app.status_value(), "MCP startup issue: docs: offline");

    app.apply_notification(ServerNotification::McpServerStatusUpdated(
        McpServerStatusUpdatedNotification {
            thread_id: None,
            name: "docs".to_string(),
            status: McpServerStartupState::Ready,
            error: None,
            failure_reason: None,
        },
    ));
    assert_eq!(app.status_value(), "");
}

#[test]
fn startup_protected_request_keeps_draft_until_the_request_is_resolved() {
    let mut app = App::default();
    app.begin_startup_input_boundary();
    app.chat_widget.bottom_pane.insert_str("startup draft");
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(8),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue startup approval");
    app.note_startup_protected_request();

    let ignored = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
    );
    assert_eq!(ignored, AppAction::None);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "startup draft");
    assert!(app.has_queued_startup_protected_request());

    let response = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
    );
    assert!(matches!(
        response,
        AppAction::Respond(AppServerResponse::Command { .. })
    ));
    assert!(!app.has_queued_startup_protected_request());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "startup draft");
}

#[test]
fn startup_boundary_ignores_protected_requests_for_background_threads() {
    let mut app = App::default();
    app.begin_startup_input_boundary();
    app.set_thread_id("main".to_string());
    app.ensure_thread_channel("background").store.push_request(
        ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(9),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "background".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        },
    );

    assert!(!app.has_queued_startup_protected_request());
}

#[test]
fn startup_boundary_ends_on_the_first_safe_user_input() {
    let mut app = App::default();
    app.begin_startup_input_boundary();

    assert!(!app.release_startup_input_boundary_if_ready(false));
    assert!(app.startup_protected_input_boundary);
    assert!(app.release_startup_input_boundary_if_ready(true));
    assert!(!app.startup_protected_input_boundary);
    assert!(!app.chat_widget.startup_pending_protected_request);
}

#[test]
fn first_safe_user_input_releases_boundary_before_reaching_composer() {
    let mut app = App::default();
    app.begin_startup_input_boundary();

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(!app.startup_protected_input_boundary);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "x");
}

#[test]
fn global_keymap_chord_does_not_cross_non_keyboard_boundaries() {
    for boundary in [
        TuiEvent::Paste("paste".to_string()),
        TuiEvent::FocusLost,
        TuiEvent::Mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column: 0,
            row: 0,
            modifiers: KeyModifiers::NONE,
        }),
    ] {
        let mut config = TuiKeymap::default();
        config.global.find_transcript =
            Some(KeybindingsSpec::One(KeybindingSpec("ctrl-x f".to_string())));
        let keymap = crate::keymap::RuntimeKeymap::from_config(&config)
            .expect("custom global chord must be valid");
        let mut app = App::default();
        app.set_runtime_keymap(keymap);

        assert_eq!(
            app.handle_tui_event(
                TuiEvent::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL,)),
                true,
            ),
            AppAction::None
        );
        assert_eq!(app.handle_tui_event(boundary, true), AppAction::None);
        assert_eq!(
            app.handle_tui_event(
                TuiEvent::Key(KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE)),
                true,
            ),
            AppAction::None
        );
        assert!(!app.transcript_view.search.is_active());
    }
}

#[test]
fn startup_boundary_waits_for_visible_request_before_releasing() {
    let mut app = App::default();
    app.begin_startup_input_boundary();
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(10),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue startup approval");
    app.note_startup_protected_request();

    assert!(!app.release_startup_input_boundary_if_ready(true));
    assert!(app.startup_protected_input_boundary);
    assert!(app.chat_widget.startup_pending_protected_request);
}

#[test]
fn ctrl_g_requests_external_editor_after_the_current_draw() {
    let mut app = App::default();

    let action = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('g'), KeyModifiers::CONTROL)),
    );

    assert_eq!(action, AppAction::None);
    assert_eq!(
        app.chat_widget.external_editor_state(),
        ExternalEditorState::Requested
    );
}

#[test]
fn slash_pwd_and_cwd_alias_display_current_working_directory_from_composer() {
    let mut output = Vec::new();
    for command in ["/pwd", "/cwd", "/pwd x"] {
        let mut app = App::default();
        app.set_cwd(std::path::PathBuf::from("/tmp/project"));
        app.set_locale(Locale::EnUs);
        app.chat_widget
            .bottom_pane
            .set_composer_text(command.to_string());

        let action = dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        );

        assert_eq!(action, AppAction::None);
        output.push(app.projection.status().to_string());
    }

    assert_eq!(
        output,
        vec![
            "Current working directory: /tmp/project",
            "Current working directory: /tmp/project",
            "Usage: /pwd",
        ]
    );
}

#[test]
fn mcp_slash_commands_request_the_matching_inventory_detail() {
    for (command, detail) in [
        ("/mcp", McpServerStatusDetail::ToolsAndAuthOnly),
        ("/mcp verbose", McpServerStatusDetail::Full),
    ] {
        let mut app = App::default();
        app.chat_widget
            .bottom_pane
            .set_composer_text(command.to_string());
        assert_eq!(
            dispatch_connected_input(
                &mut app,
                Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            ),
            AppAction::FetchMcpInventory { detail }
        );
        assert!(app.chat_widget.bottom_pane.composer_is_empty());
        assert!(!app.chat_widget.bottom_pane.command_popup_active());
    }
}

#[test]
fn mcp_slash_command_rejects_unknown_arguments_with_localized_usage() {
    let mut app = App::default();
    app.set_locale(Locale::ZhCn);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/mcp compact".to_string());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert_eq!(
        app.projection.status(),
        "用法：/mcp [verbose | login <名称>]"
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn permissions_slash_command_opens_the_picker_and_keeps_inline_arguments() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .set_permission_profiles(["default".to_string(), "read-only".to_string()]);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/permissions".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.permissions_picker_open());
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(enter, AppAction::SelectPermissions("default".to_string()));

    app.chat_widget
        .bottom_pane
        .set_composer_text("/permissions default".to_string());
    assert_eq!(app.run_local_command(), None);
}

#[test]
fn effort_slash_command_opens_the_picker_and_keeps_inline_arguments() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/effort".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.effort_picker_open());
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(enter, AppAction::SelectEffort("medium".to_string()));

    app.chat_widget
        .bottom_pane
        .set_composer_text("/effort high".to_string());
    assert_eq!(app.run_local_command(), None);
}

#[test]
fn memory_slash_command_shows_memory_status() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/memory".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ShowMemoryStatus));
}

#[test]
fn usage_slash_command_shows_token_usage() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/usage".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ShowUsage));
}

#[test]
fn stop_slash_command_reports_no_active_turn() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/stop".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(app.projection.status(), "no active turn to stop");
}

#[test]
fn memory_reset_requires_confirmation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/memory reset".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.confirm_prompt_open());
    assert_eq!(
        app.chat_widget.confirm_kind(),
        Some(crate::app::confirm_prompt::ConfirmKind::ResetMemory)
    );
    let cancel = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(cancel, AppAction::None);

    app.chat_widget
        .bottom_pane
        .set_composer_text("/memory reset".to_string());
    app.run_local_command();
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    let confirm = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(confirm, AppAction::ResetMemory);
}

#[test]
fn keymap_slash_command_lists_bindings() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/keymap".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.keymap_editor_open());
}

#[test]
fn skills_slash_command_lists_available_skills() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/skills".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.skills_toggle_open());
}

#[test]
fn hooks_slash_command_lists_configured_hooks() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/hooks".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ListHooks));
}

#[test]
fn config_slash_command_opens_the_configuration_menu() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/config".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.config_menu_open());
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(enter, AppAction::OpenModelPicker);

    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.open_config_menu();
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    let effort = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(effort, AppAction::OpenEffortPicker);
}

#[test]
fn clear_slash_command_starts_a_new_chat() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/clear".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ClearConversation));
}

#[test]
fn quit_slash_command_exits_the_tui() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/quit".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::Quit));

    app.chat_widget
        .bottom_pane
        .set_composer_text("/exit".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::Quit));
}

#[test]
fn experimental_slash_command_lists_and_toggles_features() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/experimental".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::ListExperimentalFeatures)
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/experimental workspace_dependencies off".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::SetExperimentalFeature {
            name: "workspace_dependencies".to_string(),
            enabled: false,
        })
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/experimental workspace_dependencies".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(
        app.projection.status(),
        "Usage: /experimental [<name> <on|off>]"
    );
}

#[test]
fn review_slash_command_opens_the_preset_picker() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/review".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.review_picker_open());
}

#[test]
fn review_picker_maps_enter_and_custom_selection() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.open_review_picker();
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(enter, AppAction::ReviewUncommitted);
    assert!(!app.chat_widget.review_picker_open());

    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.open_review_picker();
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    let custom = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(custom, AppAction::None);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "/review ");
}

#[test]
fn review_slash_command_accepts_branch_and_commit_targets() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);

    app.chat_widget
        .bottom_pane
        .set_composer_text("/review branch main".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::ReviewBaseBranch {
            branch: "main".to_string()
        })
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/review commit 1234abc".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::ReviewCommit {
            sha: "1234abc".to_string()
        })
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/review branch".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(app.projection.status(), "Usage: /review branch <branch>");
}

#[test]
fn review_slash_command_appends_custom_instructions() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/review focus on runtime errors".to_string());
    let Some(AppAction::Submit { text, .. }) = app.run_local_command() else {
        panic!("/review must submit a prompt");
    };
    assert!(text.contains("focus on runtime errors"));
    assert!(text.starts_with("Review the current repository changes."));
}

#[test]
fn fork_slash_command_forks_the_thread() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/fork".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ForkThread));
}

#[test]
fn delete_slash_command_opens_the_confirmation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/delete".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.confirm_prompt_open());
    assert_eq!(
        app.chat_widget.confirm_kind(),
        Some(crate::app::confirm_prompt::ConfirmKind::DeleteThread)
    );
}

fn open_presets(app: &mut App) {
    app.chat_widget
        .bottom_pane
        .set_composer_text("/presets".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.presets_menu_open());
}

#[test]
fn voice_slash_command_starts_dictation_when_idle() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/voice".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::StartVoiceInput));
    assert!(!app.voice.is_recording());
}

#[test]
fn side_thread_title_uses_the_parent_name_when_known() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .set_status_thread_name("main-thread".to_string(), Some("Roadmap".to_string()));
    assert_eq!(
        app.side_thread_title("main-thread"),
        "Side · Roadmap".to_string()
    );
    assert_eq!(
        app.side_thread_title("unknown"),
        "Side · unknown".to_string()
    );
}

#[test]
fn side_and_btw_start_and_exit_a_side_conversation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/side".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app
        .projection
        .status()
        .contains("before the session starts"));

    app.set_thread_id("main-thread".into());
    app.chat_widget
        .bottom_pane
        .set_composer_text("/side what changed?".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::StartSideConversation {
            prompt: "what changed?".to_string()
        })
    );

    app.side_state
        .open("side-thread".to_string(), "main-thread".to_string());
    app.set_thread_id("side-thread".into());
    app.chat_widget
        .bottom_pane
        .set_composer_text("/btw".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::ExitSideConversation)
    );

    app.set_thread_id("main-thread".into());
    app.chat_widget
        .bottom_pane
        .set_composer_text("/side".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.projection.status().contains("already open"));
}

#[test]
fn worktree_picker_create_and_delete_actions_are_mapped() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .open_worktree_picker(crate::app::worktree_picker::WorktreePicker::new(
            "/repo".to_string(),
            vec![crate::app::worktree_picker::WorktreeEntry {
                path: "/repo/.lime/worktrees/one".to_string(),
                repository_root: "/repo".to_string(),
                branch: Some("feature".to_string()),
                thread_id: None,
                thread_summary: None,
            }],
        ));
    let name_mode = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE)),
        true,
    );
    assert_eq!(name_mode, AppAction::None);
    for ch in "next".chars() {
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE)),
            true,
        );
    }
    let create = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        create,
        AppAction::CreateWorktree {
            root_path: "/repo".to_string(),
            name: "next".to_string()
        }
    );
    assert!(!app.chat_widget.worktree_picker_open());

    app.chat_widget
        .open_worktree_picker(crate::app::worktree_picker::WorktreePicker::new(
            "/repo".to_string(),
            vec![crate::app::worktree_picker::WorktreeEntry {
                path: "/repo/.lime/worktrees/one".to_string(),
                repository_root: "/repo".to_string(),
                branch: None,
                thread_id: None,
                thread_summary: None,
            }],
        ));
    let delete_request = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE)),
        true,
    );
    assert_eq!(delete_request, AppAction::None);
    assert!(app.chat_widget.confirm_prompt_open());
    let down = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(down, AppAction::None);
    let delete = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        delete,
        AppAction::DeleteWorktree {
            worktree_path: "/repo/.lime/worktrees/one".to_string()
        }
    );
}

#[test]
fn worktree_command_opens_the_picker_and_enter_enters_the_worktree() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/worktree".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ListWorktrees));

    app.chat_widget
        .open_worktree_picker(crate::app::worktree_picker::WorktreePicker::new(
            "/repo".to_string(),
            vec![crate::app::worktree_picker::WorktreeEntry {
                path: "/repo/.lime/worktrees/one".to_string(),
                repository_root: "/repo".to_string(),
                branch: Some("feature".to_string()),
                thread_id: Some("thread-1".to_string()),
                thread_summary: Some("Active task".to_string()),
            }],
        ));
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        enter,
        AppAction::EnterWorktree {
            path: "/repo/.lime/worktrees/one".to_string(),
            thread_id: Some("thread-1".to_string())
        }
    );
    assert!(!app.chat_widget.worktree_picker_open());

    app.chat_widget
        .open_worktree_picker(crate::app::worktree_picker::WorktreePicker::new(
            "/repo".to_string(),
            Vec::new(),
        ));
    let cancel = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(cancel, AppAction::None);
    assert!(!app.chat_widget.worktree_picker_open());
}

#[test]
fn presets_menu_recalls_saves_and_deletes_from_the_config() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.tui_config = serde_json::from_value(serde_json::json!({
        "presets": {
            "1": {"input": "review the diff", "label": "Review"}
        }
    }))
    .unwrap();
    open_presets(&mut app);
    let recall = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        recall,
        AppAction::InsertComposerText("review the diff".into())
    );
    assert!(!app.chat_widget.presets_menu_open());

    open_presets(&mut app);
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE)),
        true,
    );
    for ch in "summarize the plan".chars() {
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE)),
            true,
        );
    }
    let save = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        save,
        AppAction::SavePreset {
            slot: "2".to_string(),
            input: "summarize the plan".to_string()
        }
    );
    assert!(!app.chat_widget.presets_menu_open());

    open_presets(&mut app);
    let delete = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        delete,
        AppAction::DeletePreset {
            slot: "1".to_string()
        }
    );
}

#[test]
fn presets_label_edit_maps_to_the_config_action() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.tui_config = serde_json::from_value(serde_json::json!({
        "presets": {
            "1": {"input": "review the diff", "label": "Review"}
        }
    }))
    .unwrap();
    open_presets(&mut app);
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::NONE)),
            true
        ),
        AppAction::None
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true
        ),
        AppAction::SetPresetLabel {
            slot: "1".to_string(),
            label: "Review".to_string()
        }
    );
    assert!(!app.chat_widget.presets_menu_open());
}

#[test]
fn presets_save_prompt_ignores_empty_input_and_keeps_the_menu() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    open_presets(&mut app);
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE)),
            true
        ),
        AppAction::None
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true
        ),
        AppAction::None
    );
    assert!(app.chat_widget.presets_menu_open());
}

#[test]
fn autoreview_requires_a_recent_denial_and_confirms_the_exact_event() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.set_thread_id("thread-autoreview".into());
    app.chat_widget
        .bottom_pane
        .set_composer_text("/autoreview".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(!app.chat_widget.confirm_prompt_open());
    assert!(app
        .projection
        .status()
        .contains("no recent auto-review denial"));

    let notification: app_server_protocol::protocol::v2::ItemGuardianApprovalReviewCompletedNotification =
        serde_json::from_value(serde_json::json!({
            "threadId": "thread-autoreview",
            "turnId": "turn-1",
            "startedAtMs": 1,
            "completedAtMs": 2,
            "reviewId": "review-1",
            "decisionSource": "agent",
            "review": {"status": "denied"},
            "action": {"type": "command", "source": "shell", "command": "rm -rf build", "cwd": "/workspace"}
        }))
        .unwrap();
    assert!(app.guardian_denials.record(&notification));

    app.chat_widget
        .bottom_pane
        .set_composer_text("/autoreview".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.confirm_prompt_open());
    let down = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(down, AppAction::None);
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    let AppAction::ApproveGuardianRetry(event) = enter else {
        panic!("expected guardian retry approval, got {enter:?}");
    };
    assert_eq!(event["id"], "review-1");
    assert_eq!(event["status"], "denied");
    assert_eq!(event["action"]["command"], "rm -rf build");
}

#[test]
fn delete_confirmation_maps_enter_to_delete() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .open_confirm_prompt(crate::app::confirm_prompt::ConfirmPrompt::delete_thread());
    let down = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(down, AppAction::None);
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(enter, AppAction::DeleteThread);
}

#[test]
fn archive_confirmation_maps_enter_to_archive() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .open_confirm_prompt(crate::app::confirm_prompt::ConfirmPrompt::archive());
    let down = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(down, AppAction::None);
    let enter = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(enter, AppAction::ArchiveThread);
    assert!(!app.chat_widget.confirm_prompt_open());
}

#[test]
fn archive_slash_command_opens_the_confirmation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/archive".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert!(app.chat_widget.confirm_prompt_open());
}

#[test]
fn compact_slash_command_compacts_the_thread() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/compact".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::CompactThread));
}

#[test]
fn rename_slash_command_requires_a_name_and_builds_the_action() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/rename".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(app.projection.status(), "Usage: /rename <name>");

    app.chat_widget
        .bottom_pane
        .set_composer_text("/rename Gate Renamed".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::RenameThread {
            name: "Gate Renamed".to_string()
        })
    );
}

#[test]
fn new_slash_command_starts_a_new_thread() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/new".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::StartNewThread));
}

#[test]
fn init_slash_command_submits_the_contributor_guide_prompt() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/init".to_string());
    let Some(AppAction::Submit {
        text,
        text_elements,
    }) = app.run_local_command()
    else {
        panic!("/init must submit a prompt");
    };
    assert!(text.contains("Generate a file named AGENTS.md"));
    assert!(text_elements.is_empty());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn mcp_login_slash_command_requires_one_server_name_and_active_thread() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);

    app.chat_widget
        .bottom_pane
        .set_composer_text("/mcp login".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(
        app.projection.status(),
        "Usage: /mcp [verbose | login <name>]"
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/mcp login docs extra".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(
        app.projection.status(),
        "Usage: /mcp [verbose | login <name>]"
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/mcp login docs".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(
        app.projection.status(),
        "MCP sign-in requires an active session."
    );

    app.set_thread_id("thread-1".to_string());
    app.chat_widget
        .bottom_pane
        .set_composer_text("/mcp login docs".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::StartMcpLogin {
            name: "docs".to_string(),
            thread_id: "thread-1".to_string(),
        })
    );
}

#[test]
fn mcp_login_completion_is_thread_scoped_and_rejects_stale_attempts() {
    use app_server_protocol::protocol::v2::McpServerOauthLoginCompletedNotification;

    let mut app = App::default();
    app.set_locale(Locale::ZhCn);
    app.set_thread_id("thread-1".to_string());
    app.active_mcp_login_ids.insert(
        "docs".to_string(),
        crate::app::mcp_login::ActiveMcpLogin {
            login_id: Some("new".to_string()),
            thread_id: "thread-1".to_string(),
        },
    );

    app.apply_notification(ServerNotification::McpServerOauthLoginCompleted(
        McpServerOauthLoginCompletedNotification {
            name: "docs".to_string(),
            thread_id: Some("thread-1".to_string()),
            login_id: Some("old".to_string()),
            success: false,
            error: Some("stale".to_string()),
        },
    ));
    assert_eq!(app.projection.status(), "");
    assert_eq!(
        app.active_mcp_login_ids.get("docs"),
        Some(&crate::app::mcp_login::ActiveMcpLogin {
            login_id: Some("new".to_string()),
            thread_id: "thread-1".to_string(),
        })
    );

    app.apply_notification(ServerNotification::McpServerOauthLoginCompleted(
        McpServerOauthLoginCompletedNotification {
            name: "docs".to_string(),
            thread_id: Some("thread-1".to_string()),
            login_id: Some("new".to_string()),
            success: true,
            error: None,
        },
    ));
    assert_eq!(app.projection.status(), "已登录 MCP 服务器“docs”。");
    assert!(!app.active_mcp_login_ids.contains_key("docs"));
}

#[test]
fn mcp_login_completion_survives_thread_switch_and_replay() {
    use app_server_protocol::protocol::v2::{
        McpServerOauthLoginCompletedNotification, ServerNotification,
    };

    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.set_thread_id("thread-1".to_string());
    app.active_mcp_login_ids.insert(
        "docs".to_string(),
        crate::app::mcp_login::ActiveMcpLogin {
            login_id: Some("login-1".to_string()),
            thread_id: "thread-1".to_string(),
        },
    );

    app.set_thread_id("thread-2".to_string());
    app.apply_notification(ServerNotification::McpServerOauthLoginCompleted(
        McpServerOauthLoginCompletedNotification {
            name: "docs".to_string(),
            thread_id: Some("thread-1".to_string()),
            login_id: Some("login-1".to_string()),
            success: true,
            error: None,
        },
    ));
    assert_eq!(app.projection.status(), "");
    assert!(app.active_mcp_login_ids.contains_key("docs"));

    app.set_thread_id("thread-1".to_string());
    let snapshot = app.take_thread_event_snapshot("thread-1", false);
    app.replay_thread_snapshot(snapshot);
    assert_eq!(app.projection.status(), "Signed in to MCP server 'docs'.");
    assert!(!app.active_mcp_login_ids.contains_key("docs"));
}

#[test]
fn mcp_login_pending_completion_replays_only_the_new_attempt() {
    use app_server_protocol::protocol::v2::McpServerOauthLoginCompletedNotification;

    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.set_thread_id("thread-1".to_string());
    let request_id = app
        .begin_mcp_login_start("docs".to_string(), "thread-1".to_string())
        .expect("start login");

    assert!(app
        .accept_mcp_login_completion(McpServerOauthLoginCompletedNotification {
            name: "docs".to_string(),
            thread_id: Some("thread-1".to_string()),
            login_id: Some("login-1".to_string()),
            success: true,
            error: None,
        })
        .is_none());

    app.finish_mcp_login_start(
        crate::app::mcp_login::McpLoginStarted {
            request_id,
            result: Ok(app_server_protocol::McpServerOauthLoginResponse {
                authorization_url: "https://auth.example/authorize".to_string(),
                state: "pending".to_string(),
                login_id: Some("login-1".to_string()),
            }),
        },
        |_| Ok(()),
    );
    assert_eq!(app.projection.status(), "Signed in to MCP server 'docs'.");
    assert!(!app.active_mcp_login_ids.contains_key("docs"));

    // The completion was consumed by the replay path, not projected twice.
    assert!(app
        .accept_mcp_login_completion(McpServerOauthLoginCompletedNotification {
            name: "docs".to_string(),
            thread_id: Some("thread-1".to_string()),
            login_id: Some("login-1".to_string()),
            success: true,
            error: None,
        })
        .is_none());
    assert_eq!(app.projection.status(), "Signed in to MCP server 'docs'.");
}

#[test]
fn tab_queues_a_follow_up_without_submitting_the_active_turn() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("follow up");
    app.projection.apply(
        app_server_protocol::protocol::v2::ServerNotification::TurnStarted(
            app_server_protocol::protocol::v2::TurnStartedNotification {
                thread_id: "thread-1".to_string(),
                turn: app_server_protocol::protocol::v2::Turn {
                    id: "turn-1".to_string(),
                    items: Vec::new(),
                    items_view: Default::default(),
                    status: app_server_protocol::protocol::v2::TurnStatus::InProgress,
                    error: None,
                    started_at: None,
                    completed_at: None,
                    duration_ms: None,
                },
            },
        ),
    );

    let action = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE)),
    );

    assert_eq!(
        action,
        AppAction::Queue {
            text: "follow up".to_string(),
            text_elements: Vec::new()
        }
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn escape_interrupts_only_an_active_turn_and_preserves_the_draft() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("keep this draft");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))
        ),
        AppAction::None
    );

    app.start_turn("turn-1".to_string());
    assert!(app.active_turn_elapsed(Instant::now()).is_some());
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))
        ),
        AppAction::Interrupt
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "keep this draft"
    );
}

#[test]
fn ctrl_c_clears_idle_plain_text_draft_and_keeps_it_recallable() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE,)),
        ),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn ctrl_c_clears_active_turn_draft_without_interrupting() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");
    app.start_turn("turn-1".to_string());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn ctrl_c_cancels_attachment_draft_without_interrupt_and_recalls_complete_history() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");
    app.attach_image(std::path::PathBuf::from("/tmp/draft.png"));

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
    assert!(!app.chat_widget.bottom_pane.composer_has_pending_images());
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)),
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "draft[Image #1]"
    );
    assert!(app.chat_widget.bottom_pane.composer_has_pending_images());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        vec![TextElement::new(5..15, Some("[Image #1]".into()))]
    );
}

#[test]
fn turn_completion_clears_the_active_status_timer() {
    use app_server_protocol::protocol::v2::{
        Turn, TurnCompletedNotification, TurnItemsView, TurnStatus,
    };

    let mut app = App::default();
    app.set_thread_id("thread-1".to_string());
    app.start_turn("turn-1".to_string());
    app.apply_notification(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::Completed,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    assert!(app.projection.active_turn_id().is_none());
    assert!(app.active_turn_elapsed(Instant::now()).is_none());
}

#[test]
fn permission_profile_catalog_is_trimmed_deduplicated_and_used_for_cycles() {
    let mut app = App::default();
    app.chat_widget.set_permission_profiles([
        " custom-read ".to_string(),
        "custom-write".to_string(),
        "custom-read".to_string(),
        "".to_string(),
    ]);

    assert_eq!(
        app.chat_widget.permission_profiles,
        vec!["custom-read".to_string(), "custom-write".to_string()]
    );
    assert_eq!(
        app.chat_widget
            .cycle_permission_profile(Some("custom-read"), 1),
        "custom-write"
    );
    assert_eq!(
        app.chat_widget
            .cycle_permission_profile(Some("custom-write"), 1),
        "custom-read"
    );

    app.chat_widget
        .set_permission_profiles([" ".to_string(), "custom-read".to_string()]);
    assert_eq!(
        app.chat_widget.permission_profiles,
        vec!["custom-read".to_string()]
    );
    app.chat_widget
        .set_permission_profiles(std::iter::empty::<String>());
    assert!(app.chat_widget.permission_profiles.is_empty());
    assert_eq!(
        app.chat_widget
            .cycle_permission_profile(Some(":read-only"), 1),
        ":workspace"
    );
}

#[test]
fn backtab_cycles_server_collaboration_modes_only_when_idle() {
    let mut app = App::default();
    app.chat_widget.set_settings(
        Some("fixture-model".to_string()),
        Some("fixture-provider".to_string()),
        Some("medium".to_string()),
        None,
    );
    app.chat_widget.set_collaboration_modes(vec![
        app_server_protocol::protocol::v2::CollaborationModeMask {
            name: "Plan".to_string(),
            mode: Some(agent_protocol::ModeKind::Plan),
            model: None,
            reasoning_effort: Some(Some("high".to_string())),
        },
        app_server_protocol::protocol::v2::CollaborationModeMask {
            name: "Default".to_string(),
            mode: Some(agent_protocol::ModeKind::Default),
            model: None,
            reasoning_effort: Some(None),
        },
    ]);

    assert_eq!(
        app.chat_widget
            .collaboration_mode
            .as_ref()
            .map(|mode| mode.mode),
        Some(agent_protocol::ModeKind::Default)
    );
    let plan_mode = agent_protocol::CollaborationMode {
        mode: agent_protocol::ModeKind::Plan,
        settings: agent_protocol::CollaborationModeSettings {
            model: "fixture-model".to_string(),
            reasoning_effort: Some("high".to_string()),
            developer_instructions: None,
        },
    };
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::BackTab, KeyModifiers::NONE,))
        ),
        AppAction::ChangeCollaborationMode(plan_mode.clone())
    );
    app.chat_widget.collaboration_mode = Some(plan_mode);
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::BackTab, KeyModifiers::NONE,))
        ),
        AppAction::ChangeCollaborationMode(agent_protocol::CollaborationMode {
            mode: agent_protocol::ModeKind::Default,
            settings: agent_protocol::CollaborationModeSettings {
                model: "fixture-model".to_string(),
                reasoning_effort: None,
                developer_instructions: None,
            },
        })
    );

    app.start_turn("turn-1".to_string());
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::BackTab, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
}

#[test]
fn settings_updates_keep_the_active_collaboration_mode_in_sync() {
    let mut app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            collaboration_mode: Some(agent_protocol::CollaborationMode {
                mode: agent_protocol::ModeKind::Plan,
                settings: agent_protocol::CollaborationModeSettings {
                    model: "old-model".to_string(),
                    reasoning_effort: Some("high".to_string()),
                    developer_instructions: None,
                },
            }),
            ..Default::default()
        },
        ..App::default()
    };

    app.chat_widget.set_settings(
        Some("new-model".to_string()),
        Some("fixture-provider".to_string()),
        Some("low".to_string()),
        None,
    );

    let mode = app
        .chat_widget
        .collaboration_mode
        .as_ref()
        .expect("active mode");
    assert_eq!(mode.settings.model, "new-model");
    assert_eq!(mode.settings.reasoning_effort.as_deref(), Some("low"));

    app.chat_widget.set_settings(
        Some("newer-model".to_string()),
        Some("fixture-provider".to_string()),
        None,
        None,
    );
    let mode = app
        .chat_widget
        .collaboration_mode
        .as_ref()
        .expect("active mode");
    assert_eq!(mode.settings.model, "newer-model");
    assert_eq!(mode.settings.reasoning_effort.as_deref(), Some("low"));
}

#[test]
fn an_open_popup_owns_escape_before_active_turn_interruption() {
    let mut app = App::default();
    app.start_turn("turn-1".to_string());
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE)),
    );
    assert!(app.chat_widget.bottom_pane.command_popup_active());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert!(!app.chat_widget.bottom_pane.command_popup_active());
    assert!(app.projection.active_turn_id().is_some());
}

#[test]
fn history_search_owns_escape_before_active_turn_interruption() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .set_cached_history(["previous prompt".to_string()]);
    app.chat_widget.bottom_pane.insert_str("previous");
    app.start_turn("turn-1".to_string());

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
    );
    assert!(app.chat_widget.bottom_pane.history_search_active());
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert!(!app.chat_widget.bottom_pane.history_search_active());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "previous");
    assert!(app.projection.active_turn_id().is_some());
}

#[test]
fn vim_slash_command_toggles_composer_mode_and_projects_localized_status() {
    let mut app = App::default();
    app.set_locale(Locale::ZhCn);
    app.chat_widget.bottom_pane.insert_str("/vim");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.is_vim_normal_mode());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
    assert_eq!(app.projection.status(), "已启用 Vim 编辑模式");

    app.chat_widget.bottom_pane.insert_str("/vim");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(!app.chat_widget.bottom_pane.is_vim_normal_mode());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
    assert_eq!(app.projection.status(), "已关闭 Vim 编辑模式");
}

#[test]
fn raw_slash_command_and_global_shortcut_toggle_only_local_presentation() {
    let mut app = App::default();
    app.set_locale(Locale::ZhCn);
    app.chat_widget.bottom_pane.insert_str("/raw");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.raw_output_mode());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
    assert_eq!(app.projection.status(), "已启用原始输出模式");

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL)),
    );
    assert!(app.chat_widget.pager_overlay.is_some());
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::ALT)),
        ),
        AppAction::None
    );
    assert!(!app.raw_output_mode());
    assert!(
        app.chat_widget.pager_overlay.is_some(),
        "global toggle must not close Ctrl+T"
    );
    assert_eq!(app.projection.status(), "已恢复富文本输出模式");
}

#[test]
fn vim_insert_escape_returns_to_normal_before_interrupting_an_active_turn() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.set_vim_enabled(true);
    app.start_turn("turn-1".to_string());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('i'), KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(!app.chat_widget.bottom_pane.is_vim_normal_mode());
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.is_vim_normal_mode());
    assert!(app.projection.active_turn_id().is_some());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        ),
        AppAction::Interrupt
    );
}

#[test]
fn vim_search_owns_escape_and_paste_before_popup_or_active_turn() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.set_vim_enabled(true);
    app.chat_widget.bottom_pane.insert_str("alpha beta");
    app.start_turn("turn-1".to_string());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.bottom_pane.vim_search_active());

    assert_eq!(
        dispatch_connected_input(&mut app, Event::Paste("beta".to_string())),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "alpha beta");
    assert_eq!(
        app.chat_widget
            .bottom_pane
            .vim_search_query()
            .map(|(query, _)| query),
        Some("beta")
    );

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(!app.chat_widget.bottom_pane.vim_search_active());
    assert!(app.projection.active_turn_id().is_some());
}

#[test]
fn vim_normal_up_and_down_do_not_replace_the_draft_with_history() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .set_cached_history(["previous prompt".to_string()]);
    app.chat_widget.bottom_pane.insert_str("current draft");
    app.chat_widget.bottom_pane.set_vim_enabled(true);

    for code in [KeyCode::Up, KeyCode::Down] {
        assert_eq!(
            dispatch_connected_input(
                &mut app,
                Event::Key(KeyEvent::new(code, KeyModifiers::NONE)),
            ),
            AppAction::None
        );
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "current draft");
        assert!(app.chat_widget.bottom_pane.is_vim_normal_mode());
    }
}

#[test]
fn lime_style_effort_and_permission_shortcuts_are_not_inserted_into_draft() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('.'), KeyModifiers::ALT,))
        ),
        AppAction::IncreaseEffort
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::F(8), KeyModifiers::NONE,))
        ),
        AppAction::NextPermissions
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn copy_shortcut_and_slash_command_do_not_become_turn_input() {
    let mut app = App::default();
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('o'), KeyModifiers::CONTROL,))
        ),
        AppAction::CopyLastResponse
    );
    app.chat_widget.bottom_pane.insert_str("/copy");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::SelectTranscriptCopy
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn export_slash_command_targets_the_canonical_transcript() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("/export");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert!(app.chat_widget.export_picker.is_some());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());

    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .insert_str("/export transcript.md");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::ExportTranscript {
            path: Some(std::path::PathBuf::from("transcript.md")),
        }
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn slash_popup_filters_and_executes_immediate_commands() {
    let mut app = App::default();
    for character in ['/', 'm'] {
        assert_eq!(
            dispatch_connected_input(
                &mut app,
                Event::Key(KeyEvent::new(KeyCode::Char(character), KeyModifiers::NONE,))
            ),
            AppAction::None
        );
    }
    assert_eq!(
        app.chat_widget.bottom_pane.selected_command(),
        Some(SlashCommand::Model)
    );

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::Submit {
            text: "/model".to_string(),
            text_elements: Vec::new()
        }
    );
    assert!(!app.chat_widget.bottom_pane.command_popup_active());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn slash_popup_completes_argument_commands_and_reopens_after_cancelled_input_changes() {
    let mut app = App::default();
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE)),
    );
    assert!(app.chat_widget.bottom_pane.command_popup_active());
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
    );
    assert!(!app.chat_widget.bottom_pane.command_popup_active());

    for ch in "rename".chars() {
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE)),
        );
    }
    assert_eq!(
        app.chat_widget.bottom_pane.selected_command(),
        Some(SlashCommand::Rename)
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "/rename ");
    assert!(!app.chat_widget.bottom_pane.command_popup_active());
}

#[test]
fn status_command_opens_an_ephemeral_pager_and_consumes_input_until_closed() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("real prompt");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::Submit {
            text: "real prompt".to_string(),
            text_elements: Vec::new()
        }
    );
    app.set_thread_id("thread-1".to_string());
    app.chat_widget.set_settings(
        Some("gpt-5".to_string()),
        Some("openai".to_string()),
        Some("high".to_string()),
        Some(":workspace".to_string()),
    );
    app.chat_widget.bottom_pane.insert_str("/status");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert!(app.chat_widget.pager_overlay.is_some());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
    assert!(app.chat_widget.pager_overlay.is_some());
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE)),
    );
    assert!(app.chat_widget.pager_overlay.is_none());

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)),
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "real prompt");
    assert!(app.projection.entries().is_empty());
}

#[test]
fn ctrl_t_opens_transcript_without_copying_or_mutating_conversation_state() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL,))
        ),
        AppAction::None
    );
    assert!(app
        .chat_widget
        .pager_overlay
        .as_ref()
        .is_some_and(PagerOverlay::is_transcript));
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
    assert!(app.projection.entries().is_empty());

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL)),
    );
    assert!(app.chat_widget.pager_overlay.is_none());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft");
}

#[test]
fn transcript_overlay_requests_older_history_only_when_session_has_more_pages() {
    let mut app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            scrollback_has_older_history: true,
            ..crate::chatwidget::ChatWidget::default()
        },
        ..App::default()
    };
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL,))
        ),
        AppAction::None
    );

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE,))
        ),
        AppAction::LoadOlderHistory
    );
}

#[test]
fn switching_threads_resets_the_main_transcript_to_the_tail() {
    let mut app = App::default();
    app.set_thread_id("thread-1".to_string());
    app.transcript_view.scroll = 12;

    app.set_thread_id("thread-2".to_string());

    assert_eq!(app.transcript_view.scroll, 0);
}

#[test]
fn image_shortcut_attaches_and_allows_image_only_submission() {
    let mut app = App::default();
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('v'), KeyModifiers::CONTROL,))
        ),
        AppAction::PasteImage
    );
    app.attach_image(PathBuf::from("/tmp/input.png"));
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::Submit {
            text: "[Image #1]".to_string(),
            text_elements: vec![TextElement::new(0..10, Some("[Image #1]".to_string()))],
        }
    );
    assert_eq!(
        app.take_recent_submission_images_with_placeholders(),
        vec![LocalImageAttachment {
            placeholder: "[Image #1]".to_string(),
            path: PathBuf::from("/tmp/input.png"),
            detail: None,
        }]
    );
}

#[test]
fn failed_image_submission_restores_inline_elements_and_attachments() {
    let mut app = App::default();
    app.attach_image(PathBuf::from("/tmp/one.png"));
    app.attach_image(PathBuf::from("/tmp/two.png"));

    let AppAction::Submit {
        text,
        text_elements,
    } = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
    )
    else {
        panic!("expected image submission");
    };
    let images = app.take_recent_submission_images_with_placeholders();
    assert!(!app.chat_widget.bottom_pane.composer_has_pending_images());
    app.restore_submission_draft(
        text.clone(),
        text_elements.clone(),
        images.clone(),
        Vec::new(),
        Vec::new(),
    );

    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "[Image #1][Image #2]"
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_local_images(), images);
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        text_elements
    );

    assert_eq!(
        app.chat_widget.bottom_pane.composer_local_image_paths(),
        &[PathBuf::from("/tmp/one.png"), PathBuf::from("/tmp/two.png")]
    );
}

#[test]
fn queued_submission_projection_updates_by_id_and_clears_on_thread_change() {
    let queued = |id: &str, text: &str| QueuedSubmission {
        id: id.to_string(),
        input: vec![UserInput::Text {
            text: text.to_string(),
            text_elements: Vec::new(),
        }],
        client_user_message_id: format!("client-{id}"),
    };
    let mut app = App::default();
    app.set_thread_id("thread-1".to_string());
    app.upsert_queued_submission(queued("queue-1", "first"));
    app.upsert_queued_submission(queued("queue-1", "revised"));
    app.upsert_queued_submission(queued("queue-2", "second"));

    assert_eq!(app.chat_widget.queued_submissions().len(), 2);
    assert!(matches!(
        app.chat_widget.queued_submissions()[0].input.as_slice(),
        [UserInput::Text { text, .. }] if text == "revised"
    ));

    app.set_thread_id("thread-2".to_string());
    assert!(app.chat_widget.queued_submissions().is_empty());
}

#[test]
fn alt_up_requests_server_delete_before_restoring_the_last_queued_input() {
    let submission = QueuedSubmission {
        id: "queue-1".to_string(),
        input: vec![
            UserInput::LocalImage {
                detail: None,
                path: "/tmp/queued.png".to_string(),
            },
            UserInput::Text {
                text: "revise this follow-up".to_string(),
                text_elements: Vec::new(),
            },
        ],
        client_user_message_id: "client-queue-1".to_string(),
    };
    let mut app = App::default();
    app.set_queued_submissions(vec![submission.clone()]);

    let action = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::ALT)),
    );

    assert_eq!(action, AppAction::EditQueuedSubmission(submission.clone()));
    assert_eq!(
        app.chat_widget.queued_submissions(),
        std::slice::from_ref(&submission)
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
    assert!(!app.chat_widget.bottom_pane.composer_has_pending_images());

    assert!(app.restore_queued_submission_for_edit(submission));
    assert!(app.chat_widget.queued_submissions().is_empty());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "[Image #1] revise this follow-up"
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        vec![TextElement::new(0..10, Some("[Image #1]".to_string()))]
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_local_image_paths(),
        &[PathBuf::from("/tmp/queued.png")]
    );
}

#[test]
fn queued_skill_input_restores_as_an_editable_dollar_mention() {
    let submission = QueuedSubmission {
        id: "queue-skill".to_string(),
        input: vec![
            UserInput::Skill {
                name: "review".to_string(),
                path: "/skills/review/SKILL.md".to_string(),
            },
            UserInput::Text {
                text: "please check".to_string(),
                text_elements: Vec::new(),
            },
        ],
        client_user_message_id: "client-queue-skill".to_string(),
    };
    let mut app = App::default();
    app.set_queued_submissions(vec![submission.clone()]);

    assert!(app.restore_queued_submission_for_edit(submission));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "$review please check"
    );
    assert!(app.chat_widget.queued_submissions().is_empty());
}

#[test]
fn alt_up_offers_lossless_remote_image_queue_edit() {
    let remote_image = QueuedSubmission {
        id: "queue-remote".to_string(),
        input: vec![UserInput::Image {
            detail: None,
            url: "https://example.test/input.png".to_string(),
        }],
        client_user_message_id: "client-remote".to_string(),
    };
    let mut app = App::default();
    app.set_queued_submissions(vec![remote_image]);
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::ALT,))
        ),
        AppAction::EditQueuedSubmission(QueuedSubmission {
            id: "queue-remote".to_string(),
            input: vec![UserInput::Image {
                detail: None,
                url: "https://example.test/input.png".to_string(),
            }],
            client_user_message_id: "client-remote".to_string(),
        })
    );

    let remote_image = app.chat_widget.queued_submissions()[0].clone();
    assert!(app.restore_queued_submission_for_edit(remote_image));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_remote_image_urls(),
        &["https://example.test/input.png"]
    );
    assert!(!app.chat_widget.bottom_pane.composer_is_empty());
    assert!(app.chat_widget.bottom_pane.composer_text().is_empty());

    app.set_queued_submissions(vec![QueuedSubmission {
        id: "queue-text".to_string(),
        input: vec![UserInput::Text {
            text: "queued".to_string(),
            text_elements: Vec::new(),
        }],
        client_user_message_id: "client-text".to_string(),
    }]);
    app.chat_widget.bottom_pane.insert_str("unsent draft");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::ALT,))
        ),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "unsent draft");
    assert_eq!(app.chat_widget.queued_submissions().len(), 1);
}

#[test]
fn remote_image_rows_are_selectable_and_deletable_from_the_composer() {
    let mut app = App::default();
    app.set_remote_image_urls(vec![
        "https://example.test/one.png".to_string(),
        "https://example.test/two.png".to_string(),
    ]);

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE))
        ),
        AppAction::None
    );
    assert!(app
        .chat_widget
        .bottom_pane
        .composer_has_selected_remote_image());

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Delete, KeyModifiers::NONE))
        ),
        AppAction::None
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_remote_image_urls(),
        &["https://example.test/one.png"]
    );
}

#[test]
fn disconnected_input_edits_locally_without_submit_or_queue() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("draft");

    assert_eq!(
        dispatch_disconnected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('!'), KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert_eq!(
        dispatch_disconnected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft!");
    assert!(app.chat_widget.queued_submissions().is_empty());
}

#[test]
fn disconnected_paste_and_ctrl_c_are_handled_at_the_app_boundary() {
    let mut app = App::default();
    assert_eq!(
        dispatch_disconnected_input(&mut app, Event::Paste("离线草稿".to_string())),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "离线草稿");
    assert_eq!(
        dispatch_disconnected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,))
        ),
        AppAction::Quit
    );
}

#[test]
fn failed_submission_restores_the_complete_local_draft() {
    let mut app = App::default();
    app.restore_submission_draft(
        "retry [Image #2] after reconnect".to_string(),
        vec![TextElement::new(6..16, Some("[Image #2]".to_string()))],
        vec![LocalImageAttachment {
            placeholder: "[Image #2]".to_string(),
            path: PathBuf::from("/tmp/retry.png"),
            detail: None,
        }],
        vec![RemoteImageAttachment {
            url: "https://example.test/retry.png".to_string(),
            detail: None,
        }],
        Vec::new(),
    );

    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "retry [Image #2] after reconnect"
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        vec![TextElement::new(6..16, Some("[Image #2]".to_string()))]
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_local_image_paths(),
        &[std::path::PathBuf::from("/tmp/retry.png")]
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_remote_image_urls(),
        &["https://example.test/retry.png"]
    );
}

#[test]
fn composer_mouse_selection_precedes_shortcuts_and_requests_copy() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("hello world");
    let area = Rect::new(10, 5, 20, 2);
    let mut buffer = Buffer::empty(area);
    app.chat_widget
        .bottom_pane
        .render_composer_textarea(area, &mut buffer);

    for (kind, column) in [
        (MouseEventKind::Down(MouseButton::Left), 11),
        (MouseEventKind::Drag(MouseButton::Left), 15),
        (MouseEventKind::Up(MouseButton::Left), 15),
    ] {
        assert_eq!(
            dispatch_connected_input(
                &mut app,
                Event::Mouse(MouseEvent {
                    kind,
                    column,
                    row: 5,
                    modifiers: KeyModifiers::NONE,
                }),
            ),
            AppAction::None
        );
    }
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "hello world");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Right),
                column: 12,
                row: 5,
                modifiers: KeyModifiers::NONE,
            }),
        ),
        AppAction::CopyComposerSelection {
            text: "ello".to_string(),
        }
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(
                KeyCode::Char('c'),
                KeyModifiers::CONTROL | KeyModifiers::SHIFT,
            )),
        ),
        AppAction::CopyComposerSelection {
            text: "ello".to_string(),
        }
    );
}

#[test]
fn composer_mouse_paste_requests_clipboard_surface_without_selection() {
    for (button, source) in [
        (
            MouseButton::Right,
            crate::clipboard_copy::worker::PasteSource::Clipboard,
        ),
        (
            MouseButton::Middle,
            crate::clipboard_copy::worker::PasteSource::Primary,
        ),
    ] {
        let mut app = App::default();
        app.set_right_click_paste(lime_core::config::RightClickPaste::On);
        app.chat_widget.bottom_pane.insert_str("draft");
        let area = Rect::new(10, 5, 20, 2);
        let mut buffer = Buffer::empty(area);
        app.chat_widget
            .bottom_pane
            .render_composer_textarea(area, &mut buffer);

        let action = dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::Down(button),
                column: 12,
                row: 5,
                modifiers: KeyModifiers::NONE,
            }),
        );
        let expected = if crate::clipboard_paste::right_click_paste_allowed(
            app.chat_widget.right_click_paste,
            source,
        ) {
            AppAction::PasteClipboardText(source)
        } else {
            AppAction::None
        };
        assert_eq!(action, expected);
    }
}

#[test]
fn transcript_pager_routes_mouse_selection_copy_to_runtime_action() {
    let mut app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            pager_overlay: Some(PagerOverlay::transcript(Locale::EnUs)),
            ..Default::default()
        },
        ..App::default()
    };
    let lines = vec![crate::terminal_hyperlinks::HyperlinkLine::from(
        "alpha beta",
    )];
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("pager")
                .render(frame, frame.area(), Locale::EnUs, &lines);
        })
        .expect("draw");

    for (kind, column) in [
        (MouseEventKind::Down(MouseButton::Left), 0),
        (MouseEventKind::Drag(MouseButton::Left), 5),
        (MouseEventKind::Up(MouseButton::Left), 5),
    ] {
        assert_eq!(
            dispatch_connected_input(
                &mut app,
                Event::Mouse(MouseEvent {
                    kind,
                    column,
                    row: 1,
                    modifiers: KeyModifiers::NONE,
                }),
            ),
            if kind == MouseEventKind::Up(MouseButton::Left) {
                AppAction::PublishPrimarySelection {
                    target: TranscriptSelectionTarget::MainPager,
                }
            } else {
                AppAction::None
            }
        );
    }
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,)),
        ),
        AppAction::CopyTranscriptSelection {
            format: crate::clipboard_copy::CopyFormat::PlainText,
            text: "alpha".to_string(),
            follow: false,
            target: TranscriptSelectionTarget::MainPager,
        }
    );
}

#[test]
fn transcript_pager_routes_stationary_link_release_to_runtime_action() {
    let mut app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            pager_overlay: Some(PagerOverlay::transcript(Locale::EnUs)),
            ..Default::default()
        },
        ..App::default()
    };
    let mut link = crate::terminal_hyperlinks::HyperlinkLine::from("docs");
    link.hyperlinks
        .push(crate::terminal_hyperlinks::TerminalHyperlink::web(
            0..4,
            "https://example.com/docs".to_string(),
        ));
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("pager")
                .render(frame, frame.area(), Locale::EnUs, &[link]);
        })
        .expect("draw");

    for (kind, expected) in [
        (MouseEventKind::Down(MouseButton::Left), AppAction::None),
        (
            MouseEventKind::Up(MouseButton::Left),
            AppAction::OpenLink("https://example.com/docs".to_string()),
        ),
    ] {
        assert_eq!(
            dispatch_connected_input(
                &mut app,
                Event::Mouse(MouseEvent {
                    kind,
                    column: 1,
                    row: 1,
                    modifiers: KeyModifiers::NONE,
                }),
            ),
            expected
        );
    }
}

#[test]
fn transcript_edge_drag_routes_frame_continuation_and_focus_loss_stops_it() {
    let mut app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            pager_overlay: Some(PagerOverlay::transcript(Locale::EnUs)),
            ..Default::default()
        },
        ..App::default()
    };
    let lines = (0..20)
        .map(|index| crate::terminal_hyperlinks::HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("pager")
                .render(frame, frame.area(), Locale::EnUs, &lines);
        })
        .expect("tail draw");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE))
        ),
        AppAction::None
    );
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("pager")
                .render(frame, frame.area(), Locale::EnUs, &lines);
        })
        .expect("top draw");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 0,
                row: 2,
                modifiers: KeyModifiers::NONE,
            })
        ),
        AppAction::None
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(MouseEvent {
                kind: MouseEventKind::Drag(MouseButton::Left),
                column: 6,
                row: 5,
                modifiers: KeyModifiers::NONE,
            })
        ),
        AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
    );
    assert_eq!(
        app.pre_draw_tick(Instant::now()),
        AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
    );
    assert_eq!(
        app.handle_tui_event(TuiEvent::FocusLost, true),
        AppAction::None
    );
    assert!(app
        .chat_widget
        .pager_overlay
        .as_ref()
        .is_some_and(PagerOverlay::has_transcript_selection));
    assert_eq!(app.pre_draw_tick(Instant::now()), AppAction::None);

    for kind in [
        MouseEventKind::Down(MouseButton::Left),
        MouseEventKind::Drag(MouseButton::Left),
    ] {
        let action = app.handle_tui_event(
            TuiEvent::Mouse(MouseEvent {
                kind,
                column: 6,
                row: if matches!(kind, MouseEventKind::Down(_)) {
                    2
                } else {
                    5
                },
                modifiers: KeyModifiers::NONE,
            }),
            true,
        );
        if matches!(kind, MouseEventKind::Drag(_)) {
            assert_eq!(
                action,
                AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
            );
        }
    }
    assert_eq!(
        app.handle_tui_event(TuiEvent::Resume, true),
        AppAction::None
    );
    assert_eq!(app.pre_draw_tick(Instant::now()), AppAction::None);
}

#[test]
fn resume_picker_owns_input_until_cancelled() {
    let mut app = App {
        chat_widget: crate::chatwidget::ChatWidget {
            resume_picker: Some(PickerState::new(
                Vec::new(),
                crate::resume_picker::SessionPickerAction::Resume,
                crate::resume_picker::SessionStatus::Active,
                None,
                true,
            )),
            ..Default::default()
        },
        ..App::default()
    };

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE,))
        ),
        AppAction::ResumePicker(PickerAction::Reload)
    );
    assert!(app.chat_widget.resume_picker.is_some());
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))
        ),
        AppAction::ResumePicker(PickerAction::Reload)
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))
        ),
        AppAction::None
    );
    assert!(app.chat_widget.resume_picker.is_none());
}

#[test]
fn alt_right_switches_to_the_next_agent_in_spawn_order() {
    let mut app = App::default();
    app.set_thread_id("main".to_string());
    app.chat_widget
        .agent_navigation
        .upsert("agent-1", Some("Robie".to_string()), None, false);

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Right, KeyModifiers::ALT,))
        ),
        AppAction::SwitchThread("agent-1".to_string())
    );
}

#[test]
fn subagents_slash_command_opens_the_upstream_named_picker() {
    let mut app = App::default();
    app.set_thread_id("main".to_string());
    app.chat_widget.agent_navigation.upsert(
        "agent-1",
        Some("Robie".to_string()),
        Some("worker".to_string()),
        false,
    );
    app.chat_widget.bottom_pane.insert_str("/subagents");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.agents_overview.is_none());
    assert!(app.chat_widget.agent_picker.is_some());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn agents_slash_command_opens_the_agents_overview() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("/agents");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        ),
        AppAction::RefreshAgentsOverview
    );
    assert!(app.chat_widget.agents_overview.is_some());
    assert!(app.chat_widget.agent_picker.is_none());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn empty_composer_left_opens_agents_overview_when_local_navigation_is_enabled() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .set_agents_navigation_enabled(true);

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE)),
        ),
        AppAction::RefreshAgentsOverview
    );
    assert!(app.chat_widget.agents_overview.is_some());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn empty_composer_left_stays_in_editor_when_navigation_is_disabled() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .set_agents_navigation_enabled(false);

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE)),
        ),
        AppAction::None
    );
    assert!(app.chat_widget.agents_overview.is_none());
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn resume_slash_command_opens_the_shared_picker_action() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("/resume");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        AppAction::OpenResumePicker
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());
}

#[test]
fn subagent_activity_marks_the_thread_parent_owned_before_resume() {
    let mut app = App::default();
    app.set_thread_id("agent-1".to_string());
    app.apply_notification(ServerNotification::ItemStarted(
        app_server_protocol::protocol::v2::ItemStartedNotification {
            item: app_server_protocol::protocol::v2::ThreadItem::SubAgentActivity {
                id: "activity-1".to_string(),
                kind: app_server_protocol::protocol::v2::SubAgentActivityKind::Started,
                agent_thread_id: "agent-1".to_string(),
                agent_path: "/root/worker".to_string(),
            },
            thread_id: "main".to_string(),
            turn_id: "turn-1".to_string(),
            started_at_ms: 1,
        },
    ));

    assert!(!app.can_accept_direct_input());
    assert_eq!(app.projection.status(), "sub-agent thread is parent-owned");
}

#[test]
fn sub_agent_activity_updates_navigation_liveness_and_label() {
    let mut app = App::default();
    app.set_thread_id("main".to_string());
    app.apply_notification(ServerNotification::ItemStarted(
        app_server_protocol::protocol::v2::ItemStartedNotification {
            item: app_server_protocol::protocol::v2::ThreadItem::SubAgentActivity {
                id: "activity-1".to_string(),
                kind: app_server_protocol::protocol::v2::SubAgentActivityKind::Started,
                agent_thread_id: "agent-1".to_string(),
                agent_path: "/root/worker".to_string(),
            },
            thread_id: "main".to_string(),
            turn_id: "turn-1".to_string(),
            started_at_ms: 1,
        },
    ));

    assert!(
        app.chat_widget
            .agent_navigation
            .get("agent-1")
            .expect("activity creates picker row")
            .is_running
    );
    assert_eq!(
        app.chat_widget
            .agent_navigation
            .active_agent_label(Some("agent-1"), Some("main")),
        Some("`/root/worker`".to_string())
    );
}

#[test]
fn warnings_slash_command_lists_startup_warnings() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/warnings".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ListWarnings));
}

#[test]
fn diff_slash_command_shows_the_working_tree_diff() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/diff".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ShowDiff));
}

#[test]
fn cd_slash_command_resolves_absolute_relative_and_home_paths() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.set_cwd(std::path::PathBuf::from("/workspace/project"));

    app.chat_widget
        .bottom_pane
        .set_composer_text("/cd /tmp".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::ChangeWorkingDirectory(std::path::PathBuf::from(
            "/tmp"
        )))
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/cd sub".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::ChangeWorkingDirectory(std::path::PathBuf::from(
            "/workspace/project/sub"
        )))
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/cd".to_string());
    assert_eq!(
        app.run_local_command(),
        dirs::home_dir().map(AppAction::ChangeWorkingDirectory)
    );
}

#[test]
fn plugins_slash_command_lists_installed_plugins() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/plugins".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ListPlugins));
}

#[test]
fn mention_slash_command_inserts_the_mention_token() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/mention".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::InsertComposerText("@".to_string()))
    );
}

#[test]
fn goal_slash_command_parses_view_set_and_control_forms() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    for (text, expected) in [
        ("/goal", "show"),
        ("/goal clear", "clear"),
        ("/goal pause", "pause"),
        ("/goal resume", "resume"),
        ("/goal ship the release", "set:ship the release"),
    ] {
        app.chat_widget
            .bottom_pane
            .set_composer_text(text.to_string());
        assert_eq!(
            app.run_local_command(),
            Some(AppAction::GoalCommand(expected.to_string())),
            "{text}"
        );
    }
}

#[test]
fn memories_slash_command_toggles_the_thread_memory_mode() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/memories on".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::SetMemoryMode(true))
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/memories off".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::SetMemoryMode(false))
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/memories maybe".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(app.projection.status(), "Usage: /memories [on|off]");
}

#[test]
fn plugin_uninstall_requires_confirmation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.open_confirm_prompt(
        crate::app::confirm_prompt::ConfirmPrompt::uninstall_plugin(
            "plugin-1".to_string(),
            "gate-plugin".to_string(),
        ),
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        ),
        AppAction::None
    );
    app.chat_widget.open_confirm_prompt(
        crate::app::confirm_prompt::ConfirmPrompt::uninstall_plugin(
            "plugin-1".to_string(),
            "gate-plugin".to_string(),
        ),
    );
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        ),
        AppAction::UninstallPlugin {
            plugin_id: "plugin-1".to_string(),
            name: "gate-plugin".to_string(),
        }
    );
}

#[test]
fn plugins_install_form_requests_resolution_and_rejects_unknown_forms() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/plugins install gate-plugin".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::InstallPluginRequest("gate-plugin".to_string()))
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/plugins bogus".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(
        app.projection.status(),
        "Usage: /plugins [install <name>|search <term>]"
    );
}

#[test]
fn plugin_install_requires_confirmation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    let prompt = crate::app::confirm_prompt::ConfirmPrompt::install_plugin(
        "gate-plugin".to_string(),
        None,
        Some("gate-market".to_string()),
        None,
    );
    app.chat_widget.open_confirm_prompt(prompt);
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        ),
        AppAction::None
    );
    app.chat_widget
        .open_confirm_prompt(crate::app::confirm_prompt::ConfirmPrompt::install_plugin(
            "gate-plugin".to_string(),
            None,
            Some("gate-market".to_string()),
            None,
        ));
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        ),
        AppAction::InstallPlugin {
            plugin_name: "gate-plugin".to_string(),
            marketplace_path: None,
            remote_marketplace_name: Some("gate-market".to_string()),
            remote_release: None,
        }
    );
}

#[test]
fn plugins_search_form_requests_marketplace_search() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/plugins search gate".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::SearchPlugins("gate".to_string()))
    );

    app.chat_widget
        .bottom_pane
        .set_composer_text("/plugins search".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::None));
    assert_eq!(
        app.projection.status(),
        "Usage: /plugins [install <name>|search <term>]"
    );
}

#[test]
fn ps_slash_command_lists_background_terminals() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/ps".to_string());
    assert_eq!(app.run_local_command(), Some(AppAction::ListProcesses));
}

#[test]
fn background_process_termination_requires_confirmation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.open_confirm_prompt(
        crate::app::confirm_prompt::ConfirmPrompt::terminate_process(
            "thread-1".to_string(),
            "proc-1".to_string(),
            "sleep 100".to_string(),
        ),
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        ),
        AppAction::None
    );
    app.chat_widget.open_confirm_prompt(
        crate::app::confirm_prompt::ConfirmPrompt::terminate_process(
            "thread-1".to_string(),
            "proc-1".to_string(),
            "sleep 100".to_string(),
        ),
    );
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            true,
        ),
        AppAction::TerminateProcess {
            thread_id: "thread-1".to_string(),
            process_id: "proc-1".to_string(),
            command: "sleep 100".to_string(),
        }
    );
}

#[test]
fn bang_enters_shell_mode_and_esc_exits_it() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    let action = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('!'), KeyModifiers::NONE)),
        true,
    );
    assert_eq!(action, AppAction::None);
    assert!(app.chat_widget.shell_mode);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "");
    let exit = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(exit, AppAction::None);
    assert!(!app.chat_widget.shell_mode);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "");
}

#[test]
fn shell_mode_submission_runs_the_command_instead_of_a_turn() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget.shell_mode = true;
    let action = app.map_input_result(crate::bottom_pane::InputResult::Submitted {
        text: "echo hi".to_string(),
        text_elements: Vec::new(),
    });
    assert_eq!(action, AppAction::RunShellCommand("echo hi".to_string()));
    assert!(!app.chat_widget.shell_mode);

    let action = app.map_input_result(crate::bottom_pane::InputResult::Submitted {
        text: "plain message".to_string(),
        text_elements: Vec::new(),
    });
    assert!(matches!(action, AppAction::Submit { .. }));
}

#[test]
fn recap_slash_command_requests_a_generation() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/recap".to_string());
    assert_eq!(
        app.run_local_command(),
        Some(AppAction::GenerateRecap(
            crate::app::recap::RecapTrigger::Manual
        ))
    );
}

#[test]
fn recap_state_allows_only_one_pending_request() {
    let mut recap = crate::app::recap::RecapState::default();
    assert!(recap.pending_thread_id().is_none());
    assert!(recap.begin(
        "ephemeral-thread".to_string(),
        crate::app::recap::RecapTrigger::Manual
    ));
    assert_eq!(recap.pending_thread_id(), Some("ephemeral-thread"));
    assert!(!recap.begin(
        "second-thread".to_string(),
        crate::app::recap::RecapTrigger::Automatic
    ));
    assert_eq!(recap.pending_thread_id(), Some("ephemeral-thread"));
    recap.push_agent_delta(r#"{"summary":"#);
    recap.push_agent_delta(r#""ok"}"#);
    let cleared = recap.clear().expect("pending recap");
    assert_eq!(cleared.thread_id, "ephemeral-thread");
    assert_eq!(cleared.assistant_text, r#"{"summary":"ok"}"#);
    assert!(recap.pending_thread_id().is_none());
    recap.push_agent_delta("ignored");
    assert!(recap.clear().is_none());
}

#[test]
fn recap_messages_render_as_recap_entries() {
    let mut app = App::default();
    app.projection
        .add_recap_message("Conversation recap\n\n  ↳ Recap: shipped");
    let entries = app.projection.entries();
    assert_eq!(
        entries.last().expect("recap entry").kind,
        crate::projection::EntryKind::Recap
    );
}
