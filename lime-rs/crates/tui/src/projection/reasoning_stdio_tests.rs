//! Public stdio notifications and cold canonical reads must retain the same structured parts.

use crate::app::App;
use crate::app_server_session::AppServerSession;
use crate::projection::{items::project_item, ConversationProjection, EntryKind};
use app_server_client::{AppServerEvent, StdioTransportConfig};
use app_server_protocol::protocol::v2::TurnStatus;
use app_server_protocol::protocol::v2::{ServerNotification, ThreadItem};
use std::path::Path;
use std::time::Duration;

#[tokio::test]
async fn real_stdio_raw_reasoning_uses_shared_config_live_resume_and_cold_history() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    use crate::local_settings::LocalSettings;
    use app_server_protocol::protocol::v2::{ConfigBatchWriteParams, ConfigEdit, MergeStrategy};
    assert_eq!(
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap(),
        "reasoning-raw"
    );
    for show_raw in [false, true] {
        let cwd = tempfile::tempdir().unwrap();
        let mut session = AppServerSession::connect(transport(cwd.path(), true))
            .await
            .unwrap();
        let config = session.read_config().await.unwrap();
        session
            .write_config_batch(ConfigBatchWriteParams {
                edits: vec![ConfigEdit {
                    key_path: "show_raw_agent_reasoning".into(),
                    value: serde_json::json!(show_raw),
                    merge_strategy: MergeStrategy::Replace,
                }],
                file_path: None,
                expected_version: Some(config.layers.unwrap()[0].version.clone()),
                reload_user_config: true,
            })
            .await
            .unwrap();
        let settings = LocalSettings::read(&session).await.unwrap();
        assert_eq!(settings.show_raw_agent_reasoning, show_raw);
        let thread = session
            .start_thread(
                cwd.path().into(),
                Some("fixture-model".into()),
                Some("fixture-provider".into()),
            )
            .await
            .unwrap()
            .thread;
        let turn_id = session
            .start_turn("raw reasoning fixture".into())
            .await
            .unwrap();
        let mut projection = ConversationProjection::default();
        projection.set_show_raw_agent_reasoning(settings.show_raw_agent_reasoning);
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let Some(AppServerEvent::ServerNotification(notification)) =
                    session.next_event().await
                else {
                    continue;
                };
                let raw = matches!(
                    notification.as_ref(),
                    ServerNotification::ReasoningTextDelta(_)
                );
                projection.apply(*notification);
                if raw {
                    break;
                }
            }
        })
        .await
        .unwrap();
        let live = projection
            .entries()
            .iter()
            .find(|item| item.kind == EntryKind::Reasoning)
            .unwrap();
        assert!(live.text.contains("RAW_SUMMARY"));
        assert_eq!(live.text.contains("RAW_BODY"), show_raw);
        let item_id = live.id.clone();
        let page = session
            .hydrate_initial_thread_history(&thread.id, None)
            .await
            .unwrap();
        let resumed = session.resume_thread(thread.id.clone()).await.unwrap();
        let mut app = App::default();
        app.projection.set_show_raw_agent_reasoning(show_raw);
        app.hydrate_thread(resumed.thread);
        app.prepend_initial_history_page(page);
        assert_eq!(
            app.projection
                .entries()
                .iter()
                .find(|item| item.id == item_id)
                .unwrap()
                .text,
            live.text
        );
        tokio::fs::write(cwd.path().join("ledger.jsonl.continue"), b"continue")
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let Some(AppServerEvent::ServerNotification(notification)) = session.next_event().await else { continue; };
                let terminal = matches!(notification.as_ref(), ServerNotification::TurnCompleted(p) if p.turn.id == turn_id);
                app.projection.apply(*notification);
                if terminal { break; }
            }
        }).await.unwrap();
        let final_text = app
            .projection
            .entries()
            .iter()
            .find(|item| item.id == item_id)
            .unwrap()
            .text
            .clone();
        assert_eq!(final_text.contains("RAW_BODY RAW_CONTINUED"), show_raw);
        let exported =
            crate::app::transcript_export::render_markdown_transcript(app.projection.entries())
                .unwrap();
        assert_eq!(exported.contains("RAW_BODY RAW_CONTINUED"), show_raw);
        session.shutdown().await.unwrap();
        session = AppServerSession::connect(transport(cwd.path(), false))
            .await
            .unwrap();
        let settings = LocalSettings::read(&session).await.unwrap();
        assert_eq!(settings.show_raw_agent_reasoning, show_raw);
        let entries = crate::thread_transcript::load_session_transcript(
            session.request_handle(),
            &thread.id,
            settings.show_raw_agent_reasoning,
        )
        .await
        .unwrap();
        assert_eq!(
            entries.iter().find(|item| item.id == item_id).unwrap().text,
            final_text
        );
        let page = session
            .hydrate_initial_thread_history(&thread.id, None)
            .await
            .unwrap();
        let item = page
            .items
            .iter()
            .find(|item| matches!(item, ThreadItem::Reasoning { id, .. } if id == &item_id))
            .unwrap();
        assert!(
            matches!(item, ThreadItem::Reasoning { summary, content, .. } if summary == &vec!["RAW_SUMMARY".to_string()] && content == &vec!["RAW_BODY RAW_CONTINUED".to_string()])
        );
        session.shutdown().await.unwrap();
        println!("STDIO_RAW_REASONING_OK visible={show_raw} thread={} turn={turn_id} item={item_id} config=ok live=ok resume=ok cold=ok export=ok canonical=ok", thread.id);
    }
}

fn transport(cwd: &Path, external: bool) -> StdioTransportConfig {
    let mut args = vec![
        "--stdio".into(),
        "--backend".into(),
        if external { "external" } else { "unavailable" }.into(),
        "--data-dir".into(),
        cwd.join("data").into_os_string(),
        "--app-data-dir".into(),
        cwd.join("app-data").into_os_string(),
    ];
    if external {
        args.extend([
            "--backend-command".into(),
            std::env::var_os("LIME_TEST_NODE_BIN").unwrap(),
            "--backend-arg".into(),
            std::env::var_os("LIME_TEST_TERMINAL_BACKEND").unwrap(),
            "--backend-arg".into(),
            cwd.join("ledger.jsonl").into_os_string(),
        ]);
    }
    StdioTransportConfig {
        app_server_bin: std::env::var_os("LIME_TEST_APP_SERVER_BIN").unwrap().into(),
        args,
    }
}

#[tokio::test]
async fn real_stdio_running_reasoning_resumes_indexed_parts_without_started() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    assert_eq!(
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap(),
        "reasoning-resume"
    );
    let cwd = tempfile::tempdir().unwrap();
    let mut session = AppServerSession::connect(transport(cwd.path(), true))
        .await
        .unwrap();
    let thread = session
        .start_thread(
            cwd.path().into(),
            Some("fixture-model".into()),
            Some("fixture-provider".into()),
        )
        .await
        .unwrap()
        .thread;
    let turn_id = session
        .start_turn("running reasoning resume fixture".into())
        .await
        .unwrap();
    let item_id = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let AppServerEvent::ServerNotification(notification) =
                session.next_event().await.unwrap()
            {
                if let ServerNotification::ItemStarted(p) = *notification {
                    if let ThreadItem::Reasoning { id, .. } = p.item {
                        break id;
                    }
                }
            }
        }
    })
    .await
    .unwrap();
    let resumed = session.resume_thread(thread.id.clone()).await.unwrap();
    assert!(resumed.thread.turns.is_empty());
    let page = session
        .hydrate_initial_thread_history(&thread.id, None)
        .await
        .unwrap();
    assert_eq!(page.turns.last().unwrap().status, TurnStatus::InProgress);
    let mut app = App::default();
    app.hydrate_thread(resumed.thread);
    app.prepend_initial_history_page(page);
    assert_eq!(app.projection.active_turn_id(), Some(turn_id.as_str()));
    assert_eq!(app.projection.status(), "STDIO_RESUMED_STATUS");
    let entry = app
        .projection
        .entries()
        .iter()
        .find(|entry| entry.id == item_id)
        .unwrap();
    assert!(entry.streaming);
    assert_eq!(entry.text, "\n\nSTDIO_RESUMED_BODY");
    tokio::fs::write(cwd.path().join("ledger.jsonl.continue"), b"continue")
        .await
        .unwrap();
    let mut saw_delta = false;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let AppServerEvent::ServerNotification(notification) = session.next_event().await.unwrap()
                else { continue; };
            assert!(!matches!(notification.as_ref(), ServerNotification::ItemStarted(p)
                if matches!(&p.item, ThreadItem::Reasoning { id, .. } if id == &item_id)),
                "the first resumed update must have no item/started");
            let delta = matches!(notification.as_ref(), ServerNotification::ReasoningSummaryTextDelta(p)
                if p.item_id == item_id && p.turn_id == turn_id);
            let terminal = matches!(notification.as_ref(), ServerNotification::TurnCompleted(p)
                if p.turn.id == turn_id);
            app.projection.apply(*notification);
            if delta {
                saw_delta = true;
                let entry = app.projection.entries().iter().find(|entry| entry.id == item_id).unwrap();
                assert!(entry.streaming);
                assert_eq!(entry.text, "\n\nSTDIO_RESUMED_BODY STDIO_RESUMED_DELTA");
            }
            if terminal { break; }
        }
    }).await.unwrap();
    assert!(saw_delta);
    let entry = app
        .projection
        .entries()
        .iter()
        .find(|entry| entry.id == item_id)
        .unwrap();
    assert!(!entry.streaming);
    let expected = entry.clone();
    let page = session
        .hydrate_initial_thread_history(&thread.id, None)
        .await
        .unwrap();
    let item = page
        .items
        .iter()
        .find(|item| matches!(item, ThreadItem::Reasoning { id, .. } if id == &item_id))
        .unwrap();
    assert_eq!(project_item(item, false).unwrap().text, expected.text);
    app.projection
        .apply(ServerNotification::ReasoningSummaryTextDelta(
            app_server_protocol::protocol::v2::ReasoningSummaryTextDeltaNotification {
                thread_id: thread.id.clone(),
                turn_id: turn_id.clone(),
                item_id: item_id.clone(),
                summary_index: 0,
                delta: "obsolete".into(),
            },
        ));
    assert_eq!(
        app.projection
            .entries()
            .iter()
            .find(|entry| entry.id == item_id)
            .unwrap(),
        &expected
    );
    session.shutdown().await.unwrap();
    println!("STDIO_REASONING_RESUME_OK thread={} turn={turn_id} item={item_id} metadata-resume=ok page=ok no-started=ok canonical=ok terminal=ok raw=hidden", thread.id);
}

#[tokio::test]
async fn real_stdio_reasoning_snapshot_matches_notifications_and_cold_read() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    assert_eq!(
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap(),
        "complete"
    );
    let cwd = tempfile::tempdir().unwrap();
    let mut session = AppServerSession::connect(transport(cwd.path(), true))
        .await
        .unwrap();
    let thread = session
        .start_thread(
            cwd.path().into(),
            Some("fixture-model".into()),
            Some("fixture-provider".into()),
        )
        .await
        .unwrap()
        .thread;
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(thread.clone());
    let turn_id = session
        .start_turn("reasoning parts canonical fixture".into())
        .await
        .unwrap();
    let reasoning_text = std::env::var("LIME_TEST_TERMINAL_REASONING_TEXT").unwrap();
    let expected_parts = vec![
        "**PTY_EMPTY_STATUS**\n\n<!-- -->".to_string(),
        format!("**PTY_BODY_HEADER**\n\n{reasoning_text}"),
        "PTY_SECOND_PARAGRAPH use `<!-- -->`.".to_string(),
        "**PTY_EMPTY_TAIL**\n<!-- -->".to_string(),
    ];
    let expected_content = vec!["PTY_RAW_REASONING_MUST_STAY_HIDDEN".to_string()];
    let expected_body = format!("\n\n{reasoning_text}\n\nPTY_SECOND_PARAGRAPH use `<!-- -->`.");
    let mut started_id = None;
    let mut completed_id = None;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let event = session.next_event().await.unwrap();
            let AppServerEvent::ServerNotification(notification) = event else { continue; };
            let terminal = matches!(notification.as_ref(), ServerNotification::TurnCompleted(p) if p.turn.id == turn_id);
            match notification.as_ref() {
                ServerNotification::ItemStarted(p) => if let ThreadItem::Reasoning {id, summary, content, ..} = &p.item {
                    assert_eq!(summary, &expected_parts);
                    assert_eq!(content, &expected_content);
                    started_id = Some(id.clone());
                },
                ServerNotification::ItemCompleted(p) => if let ThreadItem::Reasoning {id, summary, content, ..} = &p.item {
                    assert_eq!(summary, &expected_parts);
                    assert_eq!(content, &expected_content);
                    completed_id = Some(id.clone());
                },
                _ => {},
            }
            projection.apply(*notification);
            if terminal { break; }
        }
    }).await.expect("real canonical completion must arrive");
    assert!(started_id.is_some());
    assert_eq!(completed_id, started_id);
    let live_entry = projection
        .entries()
        .iter()
        .find(|entry| entry.kind == EntryKind::Reasoning)
        .unwrap();
    assert_eq!(live_entry.text, expected_body);
    let live_body = live_entry.text.clone();
    for cold in [false, true] {
        if cold {
            session.shutdown().await.unwrap();
            session = AppServerSession::connect(transport(cwd.path(), false))
                .await
                .unwrap();
            let resumed = session.resume_thread(thread.id.clone()).await.unwrap();
            assert!(
                resumed.thread.turns.is_empty(),
                "resume must be metadata-only"
            );
        }
        let page = session
            .hydrate_initial_thread_history(&thread.id, None)
            .await
            .unwrap();
        let item = page
            .items
            .iter()
            .find(|item| matches!(item, ThreadItem::Reasoning { .. }))
            .unwrap();
        let ThreadItem::Reasoning {
            id,
            summary,
            content,
            ..
        } = item
        else {
            unreachable!()
        };
        assert_eq!(Some(id), completed_id.as_ref());
        assert_eq!(summary, &expected_parts);
        assert_eq!(content, &expected_content);
        assert_eq!(project_item(item, false).unwrap().text, live_body);
        assert_eq!(page.turns.last().unwrap().id, turn_id);
    }
    session.shutdown().await.unwrap();
    println!("STDIO_REASONING_PARTS_OK thread={} turn={turn_id} notification=ok canonical=ok cold-resume=ok raw=hidden", thread.id);
}
