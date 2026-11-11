use super::*;
use crate::app::{App, AppAction};
use crate::bottom_pane::AppServerResponse;
use app_server_protocol::protocol::v2::{
    ServerRequest, ToolRequestUserInputParams, ToolRequestUserInputQuestion,
};
use app_server_protocol::RequestId;
use crossterm::event::Event;
use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use crossterm::event::KeyModifiers;
use crossterm::event::MouseEvent;
use crossterm::event::MouseEventKind;
use pretty_assertions::assert_eq;
use serde_json::json;
use std::task::Context;
use std::task::Poll;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_stream::StreamExt;

/// Simple fake event source for tests; feed events via the handle.
struct FakeEventSource {
    rx: mpsc::UnboundedReceiver<EventResult>,
    tx: mpsc::UnboundedSender<EventResult>,
}

struct FakeEventSourceHandle {
    broker: Arc<EventBroker<FakeEventSource>>,
}

impl FakeEventSource {
    fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self { rx, tx }
    }
}

impl Default for FakeEventSource {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeEventSourceHandle {
    fn new(broker: Arc<EventBroker<FakeEventSource>>) -> Self {
        Self { broker }
    }

    fn send(&self, event: EventResult) {
        let mut state = self
            .broker
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(source) = state.active_event_source_mut() else {
            return;
        };
        let _ = source.tx.send(event);
    }
}

impl EventSource for FakeEventSource {
    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<EventResult>> {
        Pin::new(&mut self.get_mut().rx).poll_recv(cx)
    }
}

fn make_stream(
    broker: Arc<EventBroker<FakeEventSource>>,
    draw_rx: broadcast::Receiver<()>,
    terminal_focused: Arc<AtomicBool>,
) -> TuiEventStream<FakeEventSource> {
    TuiEventStream::new(broker, draw_rx, terminal_focused)
}

type SetupState = (
    Arc<EventBroker<FakeEventSource>>,
    FakeEventSourceHandle,
    broadcast::Sender<()>,
    broadcast::Receiver<()>,
    Arc<AtomicBool>,
);

fn setup() -> SetupState {
    let source = FakeEventSource::new();
    let broker = Arc::new(EventBroker::new());
    *broker.state.lock().unwrap() = EventBrokerState::Running(source);
    let handle = FakeEventSourceHandle::new(broker.clone());

    let (draw_tx, draw_rx) = broadcast::channel(1);
    let terminal_focused = Arc::new(AtomicBool::new(true));
    (broker, handle, draw_tx, draw_rx, terminal_focused)
}

fn input_app(surface: &str) -> App {
    let mut app = App::default();
    match surface {
        "composer" => {}
        "notes" => {
            app.chat_widget
                .bottom_pane
                .enqueue(ServerRequest::ItemToolRequestUserInput {
                    id: RequestId::Integer(109),
                    params: ToolRequestUserInputParams {
                        thread_id: "thread".into(),
                        turn_id: "turn".into(),
                        item_id: "question".into(),
                        questions: vec![ToolRequestUserInputQuestion {
                            id: "note".into(),
                            header: "Note".into(),
                            question: "Add notes".into(),
                            is_other: false,
                            is_secret: false,
                            options: None,
                        }],
                        is_blocking: true,
                        auto_resolution_ms: None,
                    },
                })
                .unwrap();
        }
        "mcp" => {
            app.chat_widget.bottom_pane.enqueue(serde_json::from_value(json!({
                "method": "mcpServer/elicitation/request", "id": 109,
                "params": {
                    "threadId": "thread", "turnId": "turn", "serverName": "form-server",
                    "mode": "form", "message": "Add notes", "requestedSchema": {
                        "type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]
                    }
                }
            })).unwrap()).unwrap();
        }
        _ => panic!("unknown input surface: {surface}"),
    }
    app
}

#[tokio::test(flavor = "current_thread")]
async fn queued_paste_survives_slow_consumption_and_fair_draws_on_all_surfaces() {
    for surface in ["composer", "notes", "mcp"] {
        let mut app = input_app(surface);
        let (broker, handle, draw_tx, draw_rx, terminal_focused) = setup();
        let mut stream = make_stream(broker, draw_rx, terminal_focused);
        let text = format!(
            "/model\t@parser\n{}\nPTY_NOTES_BURST_TAIL",
            "界🙂".repeat(501)
        );
        for ch in text.chars() {
            let code = match ch {
                '\n' => KeyCode::Enter,
                '\t' => KeyCode::Tab,
                ch => KeyCode::Char(ch),
            };
            handle.send(Ok(Event::Key(KeyEvent::new(code, KeyModifiers::NONE))));
        }
        let frames = super::super::FrameRequester::test_dummy();
        let mut keys = 0;
        let mut draws = 0;
        // Drive the input clock deterministically so burst cadence cannot depend
        // on host scheduling. The blocking stall below still exercises slow
        // consumption; it deliberately does not move this logical clock.
        let mut input_now = std::time::Instant::now();
        while keys < text.chars().count() {
            draw_tx.send(()).unwrap();
            let event = stream.next().await.unwrap();
            match event {
                TuiEvent::Draw => {
                    draws += 1;
                    input_now += Duration::from_millis(1);
                    assert!(
                        app.chat_widget.handle_paste_burst_tick(&frames, input_now),
                        "{surface}: keys={keys} draws={draws}"
                    );
                }
                TuiEvent::Key(_) => {
                    keys += 1;
                    input_now += Duration::from_millis(1);
                    if keys == 214 {
                        // Already queued input must survive a consumer stall beyond the paste threshold.
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    assert!(matches!(
                        app.handle_tui_event_runtime(event, true, input_now),
                        AppAction::None | AppAction::ScheduleFrameIn(_)
                    ));
                }
                other => panic!("unexpected queued event: {other:?}"),
            }
        }
        assert_eq!(
            draws,
            keys - 1,
            "draws and queued keys must retain round-robin fairness"
        );
        let waker = futures::task::noop_waker();
        let mut cx = Context::from_waker(&waker);
        assert!(stream.poll_crossterm_event(&mut cx).is_pending());
        input_now += Duration::from_millis(200);
        app.chat_widget.handle_paste_burst_tick(&frames, input_now);

        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 24)).unwrap();
        terminal
            .draw(|frame| crate::view::render(frame, &app))
            .unwrap();
        let screen = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        let label = app
            .chat_widget
            .locale
            .pasted_content_label(text.chars().count());
        assert!(
            screen.contains(&label),
            "{surface} must show one complete atomic paste: {screen}"
        );
        assert!(
            !screen.contains("PTY_NOTES_BURST_TAIL"),
            "{surface} exposed a split paste"
        );

        let submit = TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let action = app.handle_tui_event_runtime(submit.clone(), true, stream.input_time());
        match (surface, action) {
            ("composer", AppAction::Submit { text: body, .. }) => assert_eq!(body, text),
            ("notes", AppAction::Respond(AppServerResponse::UserInput { response, .. })) => {
                assert_eq!(
                    serde_json::to_value(response).unwrap(),
                    json!({
                        "answers": {"note": {"answers": [format!("user_note: {text}")]}}
                    })
                );
            }
            ("mcp", AppAction::Respond(AppServerResponse::McpElicitation { response, .. })) => {
                assert_eq!(
                    serde_json::to_value(response).unwrap(),
                    json!({"action": "accept", "content": {"note": text}})
                );
            }
            (_, action) => panic!("{surface} did not complete once: {action:?}"),
        }
        assert!(!matches!(
            app.handle_tui_event_runtime(submit, true, stream.input_time()),
            AppAction::Submit { .. } | AppAction::Respond(_)
        ));
    }
}

#[tokio::test(flavor = "current_thread")]
async fn mouse_and_key_events_are_forwarded_in_order() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker, draw_rx, terminal_focused);

    let expected_mouse = MouseEvent {
        kind: MouseEventKind::Moved,
        column: 0,
        row: 0,
        modifiers: KeyModifiers::NONE,
    };
    handle.send(Ok(Event::Mouse(expected_mouse)));
    handle.send(Ok(Event::Key(KeyEvent::new(
        KeyCode::Char('a'),
        KeyModifiers::NONE,
    ))));

    match stream.next().await.unwrap() {
        TuiEvent::Mouse(mouse) => assert_eq!(mouse, expected_mouse),
        other => panic!("expected mouse event, got {other:?}"),
    }
    match stream.next().await.unwrap() {
        TuiEvent::Key(key) => {
            assert_eq!(key, KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE));
        }
        other => panic!("expected key event, got {other:?}"),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn focus_lost_is_forwarded_and_updates_terminal_state() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker, draw_rx, terminal_focused.clone());

    handle.send(Ok(Event::FocusLost));

    assert!(matches!(stream.next().await, Some(TuiEvent::FocusLost)));
    assert!(!terminal_focused.load(Ordering::Relaxed));
}

#[tokio::test(flavor = "current_thread")]
async fn focus_lost_consumed_by_startup_remains_visible_to_the_tui() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut startup_events = make_stream(broker, draw_rx, terminal_focused.clone());
    handle.send(Ok(Event::FocusLost));

    assert!(matches!(
        startup_events.next().await,
        Some(TuiEvent::FocusLost)
    ));
    assert!(!terminal_focused.load(Ordering::Relaxed));
}

#[tokio::test(flavor = "current_thread")]
async fn focus_gained_preserves_already_queued_key() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    terminal_focused.store(false, Ordering::Relaxed);
    let mut stream = make_stream(broker.clone(), draw_rx, terminal_focused.clone());
    let expected_key = KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE);

    handle.send(Ok(Event::FocusGained));
    handle.send(Ok(Event::Key(expected_key)));

    assert!(matches!(stream.next().await, Some(TuiEvent::FocusGained)));
    assert!(terminal_focused.load(Ordering::Relaxed));
    assert!(matches!(
        &*broker
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        EventBrokerState::Running(_)
    ));

    let next = timeout(Duration::from_millis(/*millis*/ 100), stream.next())
        .await
        .expect("focus handling discarded an already queued key");

    match next {
        Some(TuiEvent::Key(key)) => assert_eq!(key, expected_key),
        other => panic!("expected queued key event, got {other:?}"),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn draw_and_key_events_yield_both() {
    let (broker, handle, draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker, draw_rx, terminal_focused);

    let expected_key = KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE);
    let _ = draw_tx.send(());
    handle.send(Ok(Event::Key(expected_key)));

    let first = stream.next().await.unwrap();
    let second = stream.next().await.unwrap();

    let mut saw_draw = false;
    let mut saw_key = false;
    for event in [first, second] {
        match event {
            TuiEvent::Draw => {
                saw_draw = true;
            }
            TuiEvent::Key(key) => {
                assert_eq!(key, expected_key);
                saw_key = true;
            }
            other => panic!("expected draw or key event, got {other:?}"),
        }
    }

    assert!(saw_draw && saw_key, "expected both draw and key events");
}

#[tokio::test(flavor = "current_thread")]
async fn lagged_draw_maps_to_draw() {
    let (broker, _handle, draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker, draw_rx.resubscribe(), terminal_focused);

    // Fill channel to force Lagged on the receiver.
    let _ = draw_tx.send(());
    let _ = draw_tx.send(());

    let first = stream.next().await;
    assert!(matches!(first, Some(TuiEvent::Draw)));
}

#[tokio::test(flavor = "current_thread")]
async fn resize_event_maps_to_resize() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker, draw_rx, terminal_focused);

    handle.send(Ok(Event::Resize(80, 24)));

    let next = stream.next().await;
    assert!(matches!(
        next,
        Some(TuiEvent::Resize(ratatui::layout::Size {
            width: 80,
            height: 24
        }))
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn error_or_eof_ends_stream() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker, draw_rx, terminal_focused);

    handle.send(Err(std::io::Error::other("boom")));

    let next = stream.next().await;
    assert!(next.is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn resume_wakes_paused_stream() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker.clone(), draw_rx, terminal_focused);

    broker.pause_events();

    let task = tokio::spawn(async move { stream.next().await });
    tokio::task::yield_now().await;

    broker.resume_events();
    let expected_key = KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE);
    handle.send(Ok(Event::Key(expected_key)));

    let event = timeout(Duration::from_millis(100), task)
        .await
        .expect("timed out waiting for resumed event")
        .expect("join failed");
    match event {
        Some(TuiEvent::Key(key)) => assert_eq!(key, expected_key),
        other => panic!("expected key event, got {other:?}"),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn resume_wakes_pending_stream() {
    let (broker, handle, _draw_tx, draw_rx, terminal_focused) = setup();
    let mut stream = make_stream(broker.clone(), draw_rx, terminal_focused);

    let task = tokio::spawn(async move { stream.next().await });
    tokio::task::yield_now().await;

    broker.pause_events();
    broker.resume_events();
    let expected_key = KeyEvent::new(KeyCode::Char('p'), KeyModifiers::NONE);
    handle.send(Ok(Event::Key(expected_key)));

    let event = timeout(Duration::from_millis(100), task)
        .await
        .expect("timed out waiting for resumed event")
        .expect("join failed");
    match event {
        Some(TuiEvent::Key(key)) => assert_eq!(key, expected_key),
        other => panic!("expected key event, got {other:?}"),
    }
}
