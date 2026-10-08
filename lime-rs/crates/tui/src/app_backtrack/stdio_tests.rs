//! Real stdio evidence for selection, prefix retention, typed restoration and live refresh.

use super::*;
use crate::app_event::AppEvent;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use app_server_client::{AppServerEvent, StdioTransportConfig};
use app_server_protocol::protocol::v2::ServerNotification;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

#[tokio::test]
async fn real_stdio_backtrack_retains_prefix_and_replays_live_refresh() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    assert_eq!(
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap(),
        "complete"
    );
    let temp = tempfile::tempdir().unwrap();
    let cwd = temp.path();
    let app_server_bin = PathBuf::from(std::env::var_os("LIME_TEST_APP_SERVER_BIN").unwrap());
    let sentinel = cwd.join("workspace.txt");
    std::fs::write(&sentinel, "workspace files do not rewind\n").unwrap();
    let mut session = AppServerSession::connect(StdioTransportConfig {
        app_server_bin: app_server_bin.clone(),
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
    let thread = session
        .start_thread(
            cwd.into(),
            Some("fixture-model".into()),
            Some("fixture-provider".into()),
        )
        .await
        .unwrap()
        .thread;
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.hydrate_thread(thread.clone());
    app.set_thread_id(thread.id.clone());
    assert_eq!(
        app.thread_history_mode,
        app_server_protocol::protocol::v2::ThreadHistoryMode::Paginated
    );
    let elements = vec![agent_protocol::TextElement::new(3..9, None)];
    let selected_input = vec![UserInput::Text {
        text: "界[edit] SECOND_PROMPT".into(),
        text_elements: elements.clone(),
    }];
    let mut turn_ids = Vec::new();
    for input in [
        text("FIRST_PROMPT"),
        selected_input.clone(),
        text("THIRD_PROMPT"),
    ] {
        let turn_id = session.start_turn_input(input).await.unwrap();
        eprintln!(
            "STDIO_BACKTRACK phase=turn-start thread={} turn={turn_id}",
            thread.id
        );
        receive_terminal(&mut app, &mut session, &turn_id).await;
        turn_ids.push(turn_id);
    }
    let (tx, mut rx) = unbounded_channel();
    let tx = AppEventSender::new(tx);
    key(&mut app, KeyCode::Esc);
    key(&mut app, KeyCode::Esc);
    drive_until(&mut app, &mut session, &tx, &mut rx, |app| {
        !app.backtrack.loading && !app.backtrack.load_needed
    })
    .await;
    assert_eq!(app.backtrack.choices.len(), 3);
    key(&mut app, KeyCode::Left);
    key(&mut app, KeyCode::Left);
    assert_eq!(
        app.backtrack.choices[app.backtrack.nth_user_message].turn_id,
        turn_ids[0]
    );
    key(&mut app, KeyCode::Right);
    assert_eq!(
        app.backtrack.choices[app.backtrack.nth_user_message].prompt,
        selected_input
    );
    key(&mut app, KeyCode::Enter);
    drive_until(&mut app, &mut session, &tx, &mut rx, |app| {
        !app.backtrack_revert_pending() && !app.history_replacement.is_pending()
    })
    .await;
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "界[edit] SECOND_PROMPT"
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text_elements(),
        elements
    );
    assert!(app
        .projection
        .entries()
        .iter()
        .any(|entry| entry.text == "FIRST_PROMPT"));
    assert!(!app
        .projection
        .entries()
        .iter()
        .any(|entry| entry.text.contains("THIRD_PROMPT")));
    let page = crate::app_server_session::thread_turns_page_with_handle(
        session.request_handle(),
        &thread.id,
        None,
    )
    .await
    .unwrap();
    assert_eq!(page.data.len(), 1);
    assert_eq!(page.data[0].id, turn_ids[0]);
    assert_eq!(
        std::fs::read_to_string(&sentinel).unwrap(),
        "workspace files do not rewind\n"
    );
    assert_eq!(
        std::fs::read_to_string(cwd.join("ledger.jsonl"))
            .unwrap()
            .lines()
            .filter(
                |line| serde_json::from_str::<serde_json::Value>(line).unwrap()["kind"]
                    == "turnStart"
            )
            .count(),
        3
    );

    // Hold the real IO completion in the UI queue while a new canonical Turn completes.
    // This models a delayed redraw/dispatch, without synthesizing notifications or terminal state.
    app.request_history_replacement();
    app.poll_backtrack_io(&mut session, &tx);
    let live_turn = session
        .start_turn("LIVE_AFTER_REVERT".into())
        .await
        .unwrap();
    receive_terminal(&mut app, &mut session, &live_turn).await;
    assert!(app.history_replacement.is_pending());
    // Inject an IO failure at the UI boundary, then reject its late success after Esc retry.
    // The actual live events above must survive retry in the original bounded event store.
    let event = tokio::time::timeout(Duration::from_secs(15), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let AppEvent::ThreadHistoryReplaced {
        thread_id,
        generation,
        result,
    } = event
    else {
        panic!("expected the pending canonical history read");
    };
    app.handle_history_replaced(
        &mut session,
        &thread_id,
        generation,
        Err("fixture read failure".into()),
    );
    assert!(!app.can_accept_direct_input());
    assert!(app.projection.status().contains("esc retry history"));
    key(&mut app, KeyCode::Esc);
    app.poll_backtrack_io(&mut session, &tx);
    app.handle_history_replaced(&mut session, &thread_id, generation, result);
    assert!(
        app.history_replacement.is_pending(),
        "a late old generation cannot finish retry"
    );
    drive_until(&mut app, &mut session, &tx, &mut rx, |app| {
        !app.history_replacement.is_pending()
    })
    .await;
    assert!(app
        .projection
        .entries()
        .iter()
        .any(|entry| entry.text == "LIVE_AFTER_REVERT"));
    assert!(app.projection.active_turn_id().is_none());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "界[edit] SECOND_PROMPT"
    );
    session.shutdown().await.unwrap();
    let mut cold = AppServerSession::connect(StdioTransportConfig {
        app_server_bin,
        args: vec![
            "--stdio".into(),
            "--backend".into(),
            "unavailable".into(),
            "--data-dir".into(),
            cwd.join("data").into_os_string(),
            "--app-data-dir".into(),
            cwd.join("app-data").into_os_string(),
        ],
    })
    .await
    .unwrap();
    let resumed = cold.resume_thread(thread.id.clone()).await.unwrap();
    assert_eq!(resumed.thread.id, thread.id);
    let page = crate::app_server_session::thread_turns_page_with_handle(
        cold.request_handle(),
        &thread.id,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        page.data.iter().map(|turn| &turn.id).collect::<Vec<_>>(),
        vec![&live_turn, &turn_ids[0]]
    );
    cold.shutdown().await.unwrap();
    println!("STDIO_BACKTRACK_OK thread={} preserved-turn={} removed-turns={},{} metadata=ok files=unchanged cold-resume=ok live-replay=ok retry=ok", thread.id, turn_ids[0], turn_ids[1], turn_ids[2]);
}

fn text(value: &str) -> Vec<UserInput> {
    vec![UserInput::Text {
        text: value.into(),
        text_elements: vec![],
    }]
}

fn key(app: &mut App, code: KeyCode) {
    assert_eq!(
        app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)), true),
        AppAction::None
    );
}

async fn receive_terminal(app: &mut App, session: &mut AppServerSession, turn_id: &str) {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let event = session.next_event().await.expect("real stdio must remain connected");
            let terminal = matches!(&event, AppServerEvent::ServerNotification(notification)
                if matches!(notification.as_ref(), ServerNotification::TurnCompleted(params) if params.turn.id == turn_id));
            app.handle_app_server_event(session, event).await;
            if terminal { break; }
        }
    }).await.expect("real canonical TurnCompleted");
}

async fn drive_until(
    app: &mut App,
    session: &mut AppServerSession,
    tx: &AppEventSender,
    rx: &mut UnboundedReceiver<AppEvent>,
    predicate: impl Fn(&App) -> bool,
) {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            app.poll_backtrack_io(session, tx);
            if predicate(app) { break; }
            tokio::select! {
                event = rx.recv() => match event.expect("UI event queue stays open") {
                    AppEvent::Backtrack(event) => app.handle_backtrack_event(event),
                    AppEvent::ThreadHistoryReplaced { thread_id, generation, result } =>
                        app.handle_history_replaced(session, &thread_id, generation, result),
                    event => panic!("unexpected backtrack fixture event: {event:?}"),
                },
                event = session.next_event() => app.handle_app_server_event(session, event.expect("stdio stays connected")).await,
            }
        }
    }).await.expect("real backtrack IO must finish");
}
