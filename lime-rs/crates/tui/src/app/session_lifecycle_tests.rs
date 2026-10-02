//! Gate-driven production resume and request lifecycle over the real stdio App Server.

use super::*;
use crate::tui::TuiEvent;
use app_server_client::{AppServerEvent, StdioTransportConfig};
use app_server_protocol::protocol::v2::{
    ServerNotification, ServerRequest, ToolRequestUserInputAnswer, ToolRequestUserInputResponse,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::time::Duration;

#[tokio::test]
async fn real_stdio_thread_handoff_preserves_pending_input() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    assert_eq!(
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap(),
        "user-input"
    );
    let temp = tempfile::tempdir().unwrap();
    let cwd = temp.path();
    let mut session = AppServerSession::connect(StdioTransportConfig {
        app_server_bin: PathBuf::from(std::env::var_os("LIME_TEST_APP_SERVER_BIN").unwrap()),
        args: vec![
            "--stdio".into(),
            "--backend".into(),
            "external".into(),
            "--backend-command".into(),
            std::env::var_os("LIME_TEST_NODE_BIN").unwrap(),
            "--backend-arg".into(),
            std::env::var_os("LIME_TEST_TERMINAL_BACKEND").unwrap(),
            "--backend-arg".into(),
            cwd.join("ledger.jsonl").into_os_string(),
            "--backend-timeout-ms".into(),
            "30000".into(),
            "--data-dir".into(),
            cwd.join("data").into_os_string(),
            "--app-data-dir".into(),
            cwd.join("app-data").into_os_string(),
        ],
    })
    .await
    .unwrap();
    let root = session
        .start_thread(
            cwd.into(),
            Some("fixture-model".into()),
            Some("fixture-provider".into()),
        )
        .await
        .unwrap()
        .thread;
    let child = session
        .start_thread_with_session_start_source(
            cwd.into(),
            Some("fixture-model".into()),
            Some("fixture-provider".into()),
            None,
        )
        .await
        .unwrap()
        .thread;
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.hydrate_thread(root.clone());
    app.set_thread_id(root.id.clone());
    app.set_cwd(cwd.into());
    app.chat_widget
        .bottom_pane
        .handle_paste(&"界🙂".repeat(501));
    app.chat_widget.bottom_pane.insert_str(" ROOT_DRAFT");
    let root_draft = app.chat_widget.bottom_pane.composer_draft();
    let first_turn = session
        .start_turn("thread input handoff probe".into())
        .await
        .unwrap();
    eprintln!(
        "STDIO_THREAD_INPUT phase=first root={} turn={}",
        root.id, first_turn
    );
    receive_question(
        &mut app,
        &mut session,
        &root.id,
        &first_turn,
        &cwd.join("ledger.jsonl"),
    )
    .await;
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Tab);
    paste(&mut app, "STDIO_RESTORED_界🙂");
    assert!(screen(&app).contains("STDIO_RESTORED_界🙂"));
    let input_before_failed_resume = app.chat_widget.bottom_pane.composer_draft();
    let mut model = Some("fixture-model".into());
    let mut provider = Some("fixture-provider".into());
    let mut effort = None;
    let mut permissions = None;
    let options = crate::runtime::TuiOptions {
        app_server_bin: PathBuf::from(std::env::var_os("LIME_TEST_APP_SERVER_BIN").unwrap()),
        app_server_args: Vec::new(),
        remote: None,
        cwd: cwd.into(),
        model: model.clone(),
        model_provider: provider.clone(),
        reasoning_effort: None,
        permissions: None,
        approval_policy: None,
        approvals_reviewer: None,
        sandbox_policy: None,
        locale: Some("en-US".into()),
        resume_thread: None,
    };
    assert!(app
        .resume_target_session(
            &mut session,
            "missing-thread".into(),
            &mut model,
            &mut provider,
            &mut effort,
            &mut permissions,
            &options
        )
        .await
        .is_err());
    assert_eq!(app.thread_id.as_deref(), Some(root.id.as_str()));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_draft(),
        input_before_failed_resume
    );
    assert!(screen(&app).contains("STDIO_RESTORED_界🙂"));

    for target in [&child.id, &root.id] {
        app.resume_target_session(
            &mut session,
            target.clone(),
            &mut model,
            &mut provider,
            &mut effort,
            &mut permissions,
            &options,
        )
        .await
        .unwrap();
        assert_eq!(app.thread_id.as_deref(), Some(target.as_str()));
        if target == &child.id {
            assert!(!app.chat_widget.bottom_pane.is_active());
            assert!(app.chat_widget.bottom_pane.composer_is_empty());
            app.chat_widget.bottom_pane.insert_str("CHILD_DRAFT");
        }
    }
    assert_eq!(app.chat_widget.bottom_pane.composer_draft(), root_draft);
    assert!(screen(&app).contains("STDIO_RESTORED_界🙂"));
    let AppAction::Respond(response @ AppServerResponse::UserInput { .. }) =
        key(&mut app, KeyCode::Enter)
    else {
        panic!("restored interaction must return its original typed response")
    };
    if let AppServerResponse::UserInput { response, .. } = &response {
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "answers":{"mode":{"answers":["Safe", "user_note: STDIO_RESTORED_界🙂"]}}
            })
        );
    }
    app.note_outbound_response(&response);
    session.respond(response).await.unwrap();
    receive_terminal(
        &mut app,
        &mut session,
        &root.id,
        &first_turn,
        &cwd.join("ledger.jsonl"),
    )
    .await;
    assert!(!app.chat_widget.bottom_pane.is_active());

    // Resolve a second request through the real transport while its edited view is dormant.
    let second_turn = session
        .start_turn("dormant request lifecycle probe".into())
        .await
        .unwrap();
    let request = receive_question(
        &mut app,
        &mut session,
        &root.id,
        &second_turn,
        &cwd.join("ledger.jsonl"),
    )
    .await;
    key(&mut app, KeyCode::Tab);
    paste(&mut app, "DORMANT_NOTES");
    app.resume_target_session(
        &mut session,
        child.id.clone(),
        &mut model,
        &mut provider,
        &mut effort,
        &mut permissions,
        &options,
    )
    .await
    .unwrap();
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "CHILD_DRAFT");
    session
        .respond(AppServerResponse::UserInput {
            id: request.id().clone(),
            response: ToolRequestUserInputResponse {
                answers: std::collections::BTreeMap::from([(
                    "mode".into(),
                    ToolRequestUserInputAnswer {
                        answers: vec!["Fast".into(), "user_note: DORMANT_NOTES".into()],
                    },
                )]),
            },
        })
        .await
        .unwrap();
    receive_terminal(
        &mut app,
        &mut session,
        &root.id,
        &second_turn,
        &cwd.join("ledger.jsonl"),
    )
    .await;
    app.resume_target_session(
        &mut session,
        root.id.clone(),
        &mut model,
        &mut provider,
        &mut effort,
        &mut permissions,
        &options,
    )
    .await
    .unwrap();
    assert!(
        !app.chat_widget.bottom_pane.is_active(),
        "resolved dormant request cannot reappear"
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_draft(), root_draft);
    let root_read = session
        .thread_read(root.id.clone(), true)
        .await
        .unwrap()
        .thread;
    assert_eq!(
        root_read
            .turns
            .iter()
            .map(|turn| &turn.id)
            .collect::<Vec<_>>(),
        vec![&first_turn, &second_turn]
    );
    let child_read = session
        .thread_read(child.id.clone(), true)
        .await
        .unwrap()
        .thread;
    assert!(
        child_read.turns.is_empty(),
        "switching and editing never create a child Turn"
    );
    let ledger = std::fs::read_to_string(cwd.join("ledger.jsonl")).unwrap();
    let entries: Vec<serde_json::Value> = ledger
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let responses: Vec<_> = entries
        .iter()
        .filter(|entry| entry["kind"] == "actionRespond")
        .collect();
    assert_eq!(
        responses.len(),
        2,
        "each canonical request is answered exactly once"
    );
    assert!(responses.iter().all(|entry| entry["threadId"] == root.id));
    assert_eq!(
        responses[0]["userData"],
        serde_json::json!({
            "mode":["Safe", "user_note: STDIO_RESTORED_界🙂"]
        })
    );
    assert_eq!(
        responses[1]["userData"],
        serde_json::json!({"mode":["Fast", "user_note: DORMANT_NOTES"]})
    );
    session.shutdown().await.unwrap();
    println!(
        "STDIO_THREAD_INPUT_OK root={} child={} turns={},{} responses=2",
        root.id, child.id, first_turn, second_turn
    );
}

async fn receive_question(
    app: &mut App,
    session: &mut AppServerSession,
    thread: &str,
    turn: &str,
    ledger: &std::path::Path,
) -> ServerRequest {
    let mut observed = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let event = session.next_event().await.expect("stdio must stay connected");
            match &event {
                AppServerEvent::ServerRequest(request) => observed.push(format!("request:{}:{:?}", request.method(), request.id())),
                AppServerEvent::ServerNotification(notification) => observed.push(format!("notification:{}", notification.method())),
                _ => {}
            }
            let request = match &event {
                AppServerEvent::ServerRequest(request) if matches!(&**request, ServerRequest::ItemToolRequestUserInput { params, .. } if params.thread_id == thread && params.turn_id == turn) => Some((**request).clone()),
                AppServerEvent::Disconnected { message } => panic!("stdio disconnected: {message}"),
                _ => None,
            };
            app.handle_app_server_event(session, event).await;
            if let Some(request) = request { return request; }
        }
    }).await;
    result.unwrap_or_else(|_| {
        panic!(
            "canonical question timeout thread={thread} turn={turn} observed={observed:?} status={} fixture-ledger={}",
            app.projection.status(),
            std::fs::read_to_string(ledger).unwrap_or_else(|error| error.to_string())
        )
    })
}

async fn receive_terminal(
    app: &mut App,
    session: &mut AppServerSession,
    thread: &str,
    turn: &str,
    ledger: &std::path::Path,
) {
    let mut observed = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let event = session.next_event().await.expect("stdio must stay connected");
            observed.push(format!("{event:?}"));
            let terminal = matches!(&event, AppServerEvent::ServerNotification(notification) if matches!(&**notification, ServerNotification::TurnCompleted(params) if params.thread_id == thread && params.turn.id == turn));
            app.handle_app_server_event(session, event).await;
            if terminal { return; }
        }
    }).await;
    result.unwrap_or_else(|_| {
        panic!(
            "canonical terminal timeout thread={thread} turn={turn} observed={observed:?} fixture-ledger={}",
            std::fs::read_to_string(ledger).unwrap_or_else(|error| error.to_string())
        )
    });
}

fn key(app: &mut App, code: KeyCode) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)), true)
}

fn paste(app: &mut App, text: &str) {
    assert_eq!(
        app.handle_tui_event(TuiEvent::Paste(text.into()), true),
        AppAction::None
    );
}

fn screen(app: &App) -> String {
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(120, 32)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|row| {
            let mut column = 0;
            let mut line = String::new();
            while column < buffer.area.width {
                let symbol = buffer[(column, row)].symbol();
                line.push_str(symbol);
                column += crate::width::display_width(symbol).max(1) as u16;
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}
