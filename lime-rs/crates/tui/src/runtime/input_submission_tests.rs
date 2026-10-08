//! Gate-driven real stdio evidence; no provider network or production mock backend.

use super::*;
use crate::app::AppAction;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use agent_protocol::ImageDetail;
use app_server_client::{AppServerEvent, StdioTransportConfig};
use app_server_protocol::protocol::v2::{ServerNotification, UserInput};
use base64::Engine;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::path::PathBuf;
use std::time::Duration;

#[tokio::test]
async fn real_stdio_queue_and_rejected_submission_preserve_typed_metadata() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    assert_eq!(
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap(),
        "queue-edit"
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
    let thread = session
        .start_thread(
            cwd.into(),
            Some("fixture-model".into()),
            Some("fixture-provider".into()),
        )
        .await
        .unwrap()
        .thread;
    let turn_id = session
        .start_turn("structured input owner probe".into())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match session.next_event().await.expect("stdio must remain connected") {
                AppServerEvent::ServerNotification(notification) => {
                    if matches!(&*notification, ServerNotification::AgentMessageDelta(delta) if delta.thread_id == thread.id && delta.turn_id == turn_id && delta.delta.contains("QUEUE_EDIT_READY")) { break; }
                }
                AppServerEvent::Disconnected { message } => panic!("structured fixture disconnected: {message}"),
                _ => {}
            }
        }
    }).await.expect("real active turn readiness");
    let image_path = cwd.join("one.png");
    image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 0, 255]))
        .save(&image_path)
        .unwrap();
    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(std::fs::read(&image_path).unwrap())
    );
    let queued = session
        .queue_input(vec![
            UserInput::Image {
                url: data_url,
                detail: Some(ImageDetail::High),
            },
            UserInput::LocalImage {
                path: image_path.to_string_lossy().into(),
                detail: Some(ImageDetail::Original),
            },
            UserInput::Text {
                text: "界[token]".into(),
                text_elements: vec![TextElement::new(3..10, None)],
            },
        ])
        .await
        .unwrap();
    let canonical = queued.input.clone();
    assert!(
        matches!(&canonical[0], UserInput::Image { url, detail: Some(ImageDetail::High) } if url.starts_with("sidecar://"))
    );
    assert!(
        matches!(&canonical[1], UserInput::Image { url, detail: Some(ImageDetail::Original) } if url.starts_with("sidecar://"))
    );
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.set_thread_id(thread.id.clone());
    app.start_turn(turn_id.clone());
    assert!(session
        .delete_queued_submission(queued.id.clone())
        .await
        .unwrap());
    app.upsert_queued_submission(queued.clone());
    assert!(app.restore_queued_submission_for_edit(queued));
    let AppAction::Queue {
        text,
        text_elements,
    } = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE)),
        true,
    )
    else {
        panic!("Tab must queue the complete typed draft")
    };
    handle_submission(&mut app, &session, text, text_elements, true).await;
    assert_eq!(app.projection.status(), "queued");
    let listed = session.list_queued_submissions(25).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        listed[0].input, canonical,
        "canonical queue -> TUI edit -> real queue/add is lossless"
    );
    assert_eq!(app.chat_widget.queued_submissions(), listed.as_slice());
    assert!(session
        .delete_queued_submission(listed[0].id.clone())
        .await
        .unwrap());
    assert!(app.restore_queued_submission_for_edit(listed[0].clone()));
    let mut remote = app
        .chat_widget
        .bottom_pane
        .composer_remote_images()
        .to_vec();
    remote[0].url = "data:image/png;base64,not-base64!".into();
    app.restore_submission_draft(
        "界[token]".into(),
        vec![TextElement::new(3..10, None)],
        Vec::new(),
        remote,
        Vec::new(),
    );
    let expected = composer_input(&app);
    for should_queue in [true, false] {
        rejected_submission(&mut app, &session, should_queue, &expected).await;
        if !should_queue {
            assert!(app.projection.status().contains("queue failed:"));
        }
    }
    session.interrupt(&turn_id).await.unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let AppServerEvent::ServerNotification(notification) = session.next_event().await.unwrap() {
                if matches!(&*notification, ServerNotification::TurnCompleted(params) if params.thread_id == thread.id && params.turn.id == turn_id) {
                    app.projection.apply(*notification);
                    break;
                }
            }
        }
    }).await.expect("real canonical turn terminal");
    assert!(app.projection.active_turn_id().is_none());
    rejected_submission(&mut app, &session, false, &expected).await;
    assert!(session
        .list_queued_submissions(25)
        .await
        .unwrap()
        .is_empty());
    let mut read = session
        .thread_read(thread.id.clone(), false)
        .await
        .unwrap()
        .thread;
    read.turns = crate::app_server_session::thread_turns_page_with_handle(
        session.request_handle(),
        thread.id.clone(),
        None,
    )
    .await
    .unwrap()
    .data
    .into_iter()
    .rev()
    .collect();
    assert_eq!(read.id, thread.id);
    assert_eq!(
        read.turns.iter().filter(|turn| turn.id == turn_id).count(),
        1
    );
    assert_eq!(
        read.turns.len(),
        1,
        "three rejected submissions must not create another canonical turn"
    );
    session.shutdown().await.unwrap();
    println!(
        "STDIO_TYPED_INPUT_OK thread={} turn={} queue={} failures=queue,steer,start",
        thread.id, turn_id, listed[0].id
    );
}

fn composer_input(app: &App) -> Vec<UserInput> {
    submission_input(
        app.chat_widget.bottom_pane.composer_text().into(),
        &app.chat_widget.bottom_pane.composer_local_images(),
        app.chat_widget.bottom_pane.composer_remote_images(),
        &[],
        app.chat_widget.bottom_pane.composer_text_elements(),
        &[],
    )
}

async fn rejected_submission(
    app: &mut App,
    session: &AppServerSession,
    should_queue: bool,
    expected: &[UserInput],
) {
    let AppAction::Submit {
        text,
        text_elements,
    } = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
        true,
    )
    else {
        panic!("restored draft must be editable and resubmittable")
    };
    handle_submission(app, session, text, text_elements, should_queue).await;
    assert_eq!(
        composer_input(app),
        expected,
        "failed submit must preserve typed metadata"
    );
    assert!(
        app.projection.status().starts_with("failed"),
        "{}",
        app.projection.status()
    );
}
