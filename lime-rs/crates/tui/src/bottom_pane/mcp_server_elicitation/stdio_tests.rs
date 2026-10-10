//! The real MCP peer, App Server stdio router and TUI share one typed response.

use super::*;
use crate::app_server_session::AppServerSession;
use app_server_client::{AppServerEvent, StdioTransportConfig};
use app_server_protocol::protocol::v2::{ServerNotification, ServerRequest};
use serde_json::json;

pub(super) async fn connect(cwd: &std::path::Path) -> AppServerSession {
    AppServerSession::connect(StdioTransportConfig {
        app_server_bin: std::env::var_os("LIME_TEST_APP_SERVER_BIN").unwrap().into(),
        args: vec![
            "--stdio".into(),
            "--backend".into(),
            "runtime".into(),
            "--data-dir".into(),
            cwd.join("data").into_os_string(),
            "--app-data-dir".into(),
            cwd.join("app-data").into_os_string(),
        ],
    })
    .await
    .unwrap()
}

pub(super) async fn configure_form(session: &AppServerSession, cwd: &std::path::Path) -> String {
    let ledger_path = cwd.join("mcp.jsonl");
    let handle = session.request_handle();
    let created = handle.request_value("modelProvider/create", json!({
        "name": "MCP form fixture", "providerType": "ollama", "apiHost": "http://127.0.0.1:1"
    })).await.unwrap();
    let provider_id = created["provider"]["id"].as_str().unwrap().to_string();
    handle.request_value("modelProvider/update", json!({
        "providerId": provider_id, "enabled": true,
        "models": [{"id": "form-model", "displayName": "Form model", "capability": {
            "taskFamilies": ["chat"], "inputModalities": ["text"], "outputModalities": ["text"],
            "runtimeFeatures": ["streaming", "tool_calling"],
            "capabilities": {"vision": false, "tools": true, "streaming": true,
                "jsonMode": false, "functionCalling": true, "reasoning": false}
        }}]
    })).await.unwrap();
    handle.request_value("mcpServer/create", json!({"server": {
        "id": "terminal-form", "name": "terminal-form", "description": "Test-only form peer",
        "server_config": {
            "command": std::env::var("LIME_TEST_NODE_BIN").unwrap(),
            "args": [std::env::var("LIME_TEST_MCP_ELICITATION_FIXTURE").unwrap(), ledger_path],
            "cwd": cwd, "timeout": 10, "tool_timeout": 30
        },
        "enabled_lime": true, "enabled_claude": false, "enabled_codex": false,
        "enabled_gemini": false, "created_at": 1
    }})).await.unwrap();
    provider_id
}

#[tokio::test]
async fn real_stdio_mcp_form_preserves_rich_drafts_and_resolves_once() {
    if std::env::var_os("LIME_TEST_MCP_ELICITATION_FIXTURE").is_none() {
        return;
    }
    let cwd = tempfile::tempdir().unwrap();
    let ledger_path = cwd.path().join("mcp.jsonl");
    let mut session = connect(cwd.path()).await;
    let provider_id = configure_form(&session, cwd.path()).await;
    let handle = session.request_handle();
    let thread = session
        .start_thread(
            cwd.path().into(),
            Some("form-model".into()),
            Some(provider_id),
        )
        .await
        .unwrap()
        .thread;
    let call_handle = handle.clone();
    let call_thread = thread.id.clone();
    let mut call = tokio::spawn(async move {
        call_handle.request_value("mcpServer/tool/call", json!({
            "threadId": call_thread, "server": "terminal-form", "tool": "form", "arguments": {}
        })).await
    });
    let (request_id, params) = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let event = tokio::select! {
                result = &mut call => panic!("MCP call ended before its reverse request: {result:?}"),
                event = session.next_event() => event,
            };
            if let Some(AppServerEvent::ServerRequest(request)) = event {
                if let ServerRequest::McpServerElicitationRequest { id, params } = *request {
                    break (id, params);
                }
            }
            assert!(
                !call.is_finished(),
                "MCP call ended before its reverse request"
            );
        }
    })
    .await
    .expect("real MCP reverse request over stdio");
    assert_eq!(params.thread_id, thread.id);
    let mut pane = crate::bottom_pane::BottomPane::default();
    pane.enqueue(ServerRequest::McpServerElicitationRequest {
        id: request_id.clone(),
        params,
    })
    .unwrap();
    let first = format!("/model\t@parser\n{}\nFORM_TAIL", "界🙂".repeat(501));
    pane.handle_event(crossterm::event::Event::Paste(first.clone()));
    pane.handle_event(crossterm::event::Event::Key(KeyEvent::new(
        KeyCode::Home,
        KeyModifiers::NONE,
    )));
    pane.handle_event(crossterm::event::Event::Key(KeyEvent::new(
        KeyCode::Tab,
        KeyModifiers::NONE,
    )));
    pane.handle_event(crossterm::event::Event::Paste("second".into()));
    pane.handle_event(crossterm::event::Event::Key(KeyEvent::new(
        KeyCode::BackTab,
        KeyModifiers::NONE,
    )));
    assert!(
        matches!(pane.current(), Some(crate::bottom_pane::PendingInteraction::McpElicitation(overlay)) if overlay.composer.current_text_with_pending() == first && overlay.composer.cursor() == 0)
    );
    pane.handle_event(crossterm::event::Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::NONE,
    )));
    let Some(crate::bottom_pane::ChatWidgetAction::Respond(response)) = pane.handle_event(
        crossterm::event::Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
    ) else {
        panic!("TUI did not submit the complete MCP form");
    };
    session.respond(response).await.unwrap();
    let expected = json!({"action": "accept", "content": {"first": first, "second": "second"}});
    let result = tokio::time::timeout(Duration::from_secs(10), call)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        result,
        json!({
            "content": [{"type": "text", "text": "MCP_FORM_COMPLETE"}],
            "structuredContent": expected, "isError": false
        })
    );
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(AppServerEvent::ServerNotification(notification)) =
                session.next_event().await
            {
                if let ServerNotification::ServerRequestResolved(params) = *notification {
                    assert_eq!(params.thread_id, thread.id);
                    assert_eq!(params.request_id, request_id);
                    break;
                }
            }
        }
    })
    .await
    .expect("typed MCP terminal notification");
    let read = handle
        .request_value(
            "thread/read",
            json!({"threadId": thread.id, "includeTurns": true}),
        )
        .await
        .unwrap();
    assert_eq!(read["thread"]["id"], thread.id);
    assert_eq!(read["thread"]["turns"], json!([]));
    session.shutdown().await.unwrap();
    let ledger = std::fs::read_to_string(ledger_path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    let responses = ledger
        .iter()
        .filter(|entry| entry["kind"] == "elicitationResult")
        .collect::<Vec<_>>();
    assert_eq!(responses.len(), 1);
    assert_eq!(responses[0]["result"], expected);
    assert_eq!(
        ledger
            .iter()
            .filter(|entry| entry["kind"] == "toolCall")
            .count(),
        1
    );
    eprintln!(
        "STDIO_MCP_FORM_OK thread={} response=complete exactly-once=true turns=none",
        thread.id
    );
}
