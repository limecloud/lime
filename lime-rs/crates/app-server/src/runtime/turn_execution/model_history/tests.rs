use super::*;
use model_provider::current_client::{CurrentProviderContent, CurrentProviderToolCall};

fn call_record() -> ModelHistoryRecord {
    ModelHistoryRecord::calls(&[CurrentProviderContent::ToolCall(
        CurrentProviderToolCall::new("call-1", "Read", json!({})),
    )])
    .unwrap()
}

fn fixture(status: AgentTurnStatus) -> (tempfile::TempDir, AppendingRuntimeEventSink<'static>) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeCore::default().with_event_log_writer(Arc::new(
        EventLogWriter::new(temp.path().join("events")).unwrap(),
    ));
    runtime
        .start_session(AgentSessionStartParams {
            session_id: Some("history-session".to_string()),
            thread_id: Some("history-thread".to_string()),
            app_id: "test".to_string(),
            workspace_id: None,
            business_object_ref: None,
            locale: None,
        })
        .unwrap();
    runtime
        .state
        .lock()
        .unwrap()
        .sessions
        .get_mut("history-session")
        .unwrap()
        .turns
        .push(AgentTurn {
            turn_id: "history-turn".to_string(),
            session_id: "history-session".to_string(),
            thread_id: "history-thread".to_string(),
            status,
            started_at: None,
            completed_at: None,
        });
    let sink = AppendingRuntimeEventSink::with_hub(
        runtime.state.clone(),
        runtime.computer_use.clone(),
        runtime.file_checkpoint_snapshot_store.clone(),
        runtime.output_snapshot_store.clone(),
        runtime.sidecar_store.clone(),
        runtime.event_log_writer.clone(),
        runtime.trace_event_writer.clone(),
        runtime.projection_store.clone(),
        runtime.session_loops.clone(),
        runtime.rollout_budget.clone(),
        "history-session".to_string(),
        "history-thread".to_string(),
        "history-turn".to_string(),
        runtime.event_hub.clone(),
    );
    (temp, sink)
}

#[tokio::test]
async fn recorded_terminal_releases_computer_use_owner() {
    use app_server_protocol::protocol::v2::{ComputerUseAdapterKind, ComputerUseSetupParams};
    use tool_runtime::computer_use::*;
    struct Adapter(Arc<Mutex<Vec<ComputerUseOwner>>>);
    #[async_trait::async_trait]
    impl ComputerUseAdapter for Adapter {
        fn kind(&self) -> ComputerUseAdapterKind {
            ComputerUseAdapterKind::Chrome
        }
        fn finish_turn(&self, owner: &ComputerUseOwner) {
            self.0.lock().unwrap().push(owner.clone());
        }
        async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
            Err(ComputerUseError::new("unused by terminal hook".into()))
        }
        async fn setup(
            &self,
            _: &ComputerUseSetupParams,
        ) -> ComputerUseResult<ComputerUseSetupOutcome> {
            Err(ComputerUseError::new("unused by terminal hook".into()))
        }
    }
    for terminal in ["turn.completed", "turn.failed", "turn.canceled"] {
        let (_dir, mut sink) = fixture(AgentTurnStatus::Running);
        let finished = Arc::new(Mutex::new(Vec::new()));
        sink.computer_use = Arc::new(
            ComputerUseService::default().with_adapter(Arc::new(Adapter(finished.clone()))),
        );
        let owner = ComputerUseOwner {
            connection: "host".into(),
            thread_id: "history-thread".into(),
            turn_id: "history-turn".into(),
        };
        sink.computer_use.bind_turn(owner.clone()).unwrap();
        sink.emit_recorded(RuntimeEvent::new("turn.started", json!({})))
            .unwrap();
        assert!(finished.lock().unwrap().is_empty());
        sink.emit_recorded(RuntimeEvent::new(terminal, json!({})))
            .unwrap();
        assert_eq!(*finished.lock().unwrap(), vec![owner], "{terminal}");
        let _ = sink.emit_recorded(RuntimeEvent::new(terminal, json!({})));
        assert_eq!(finished.lock().unwrap().len(), 1, "{terminal}");
    }
}

#[test]
fn terminal_turn_cannot_acknowledge_a_discarded_model_history_append() {
    for status in [
        AgentTurnStatus::Completed,
        AgentTurnStatus::Failed,
        AgentTurnStatus::Canceled,
    ] {
        let (_temp, mut sink) = fixture(status);
        let writer = sink.event_log_writer.clone().unwrap();
        let before = writer.read_session_events("history-session").unwrap();
        let result = sink.persist_model_history(call_record());
        assert_eq!(
            writer.read_session_events("history-session").unwrap(),
            before
        );
        assert!(
            result.is_err(),
            "{status:?} discarded append was acknowledged: {result:?}"
        );
    }
}

#[tokio::test]
async fn session_history_receipt_reports_a_missing_durable_owner() {
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let sink = ChannelRuntimeEventSink { sender };
    let recorder = sink.history_recorder();
    let task = tokio::spawn(async move { recorder.record(call_record()).await });
    let Some(SessionLoopEvent::ModelHistory(append)) = receiver.recv().await else {
        panic!("history append event");
    };
    assert!(
        !task.is_finished(),
        "enqueuing is not a persistence receipt"
    );
    let mut sink = CollectingRuntimeEventSink::default();
    assert!(append.persist(&mut sink).is_err());
    assert!(task
        .await
        .unwrap()
        .unwrap_err()
        .contains("no durable model tool history owner"));
}

#[test]
fn history_append_without_event_log_cannot_return_a_durable_receipt() {
    let (_temp, mut sink) = fixture(AgentTurnStatus::Running);
    sink.event_log_writer = None;
    let before = sink.state.lock().unwrap().sessions["history-session"]
        .events
        .clone();
    assert!(sink.persist_model_history(call_record()).is_err());
    assert_eq!(
        sink.state.lock().unwrap().sessions["history-session"].events,
        before
    );
}

#[test]
fn ephemeral_history_receipt_identifies_a_real_memory_record_without_claiming_durability() {
    let (_temp, mut sink) = fixture(AgentTurnStatus::Running);
    {
        let mut state = sink.state.lock().unwrap();
        state
            .sessions
            .get_mut("history-session")
            .unwrap()
            .session
            .business_object_ref = Some(BusinessObjectRef {
            kind: "agent.thread".to_string(),
            id: "history-thread".to_string(),
            title: None,
            uri: None,
            metadata: Some(json!({"ephemeral":true})),
        });
    }
    let writer = sink.event_log_writer.clone().unwrap();
    let receipt = sink.persist_model_history(call_record()).unwrap();
    assert!(!receipt.is_durable());
    let state = sink.state.lock().unwrap();
    let event = state.sessions["history-session"].events.last().unwrap();
    assert_eq!(receipt.event_id(), event.event_id);
    assert_eq!(receipt.sequence(), event.sequence);
    assert!(writer
        .read_session_events("history-session")
        .unwrap()
        .is_empty());
    drop(state);
    sink.event_log_writer = None;
    let second = sink.persist_model_history(call_record()).unwrap();
    assert!(!second.is_durable());
    assert!(second.sequence() > receipt.sequence());
}

#[test]
fn ephemeral_code_cell_trace_and_terminal_cleanup_do_not_touch_the_trace_store() {
    use tool_runtime::tool_lifecycle::CodeCellTraceEvent;
    let (temp, mut sink) = fixture(AgentTurnStatus::Running);
    let writer = Arc::new(TraceEventWriter::new(temp.path().join("traces")).unwrap());
    let started = |cell: &str| CodeCellTraceEvent::Started {
        turn_id: "history-turn".to_string(),
        runtime_cell_id: cell.to_string(),
        model_visible_call_id: cell.to_string(),
        source_js: "private source".to_string(),
    };
    writer
        .append_code_cell_trace_event(
            "history-session",
            "history-thread",
            CodeCellTraceEvent::SourceItemObserved {
                turn_id: "history-turn".to_string(),
                model_visible_call_id: "existing".to_string(),
                source_item_id: "source-existing".to_string(),
            },
        )
        .unwrap();
    writer
        .append_code_cell_trace_event("history-session", "history-thread", started("existing"))
        .unwrap();
    let before = writer
        .read_code_cell_trace("history-session", "history-thread")
        .unwrap();
    assert_eq!(before.code_cells.len(), 1);
    sink.trace_event_writer = Some(writer.clone());
    sink.state
        .lock()
        .unwrap()
        .sessions
        .get_mut("history-session")
        .unwrap()
        .session
        .business_object_ref = Some(BusinessObjectRef {
        kind: "agent.thread".to_string(),
        id: "history-thread".to_string(),
        title: None,
        uri: None,
        metadata: Some(json!({"ephemeral":true})),
    });
    sink.emit_code_cell_trace(started("ephemeral")).unwrap();
    sink.emit(RuntimeEvent::new(
        "turn.failed",
        json!({"message":"test failure"}),
    ))
    .unwrap();
    assert_eq!(
        writer
            .read_code_cell_trace("history-session", "history-thread")
            .unwrap(),
        before
    );
}

#[tokio::test]
async fn session_history_receipt_preserves_each_exact_event_log_identity() {
    let (_temp, mut sink) = fixture(AgentTurnStatus::Running);
    let writer = sink.event_log_writer.clone().unwrap();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let recorder = ChannelRuntimeEventSink { sender }.history_recorder();
    let mut receipts = Vec::new();
    for _ in 0..2 {
        let recorder = recorder.clone();
        let task = tokio::spawn(async move { recorder.record(call_record()).await });
        let Some(SessionLoopEvent::ModelHistory(append)) = receiver.recv().await else {
            panic!("history append event");
        };
        assert!(
            !task.is_finished(),
            "enqueuing cannot acknowledge persistence"
        );
        append.persist(&mut sink).unwrap();
        let receipt = task.await.unwrap().unwrap();
        let records = writer.read_session_events("history-session").unwrap();
        let event = &records.last().unwrap().event;
        assert_eq!(receipt.event_id(), event.event_id);
        assert_eq!(receipt.sequence(), event.sequence);
        assert_eq!(event.event_type, MODEL_HISTORY_EVENT_TYPE);
        assert_eq!(event.turn_id.as_deref(), Some("history-turn"));
        assert_eq!(
            serde_json::from_value::<ModelHistoryRecord>(event.payload.clone()).unwrap(),
            call_record()
        );
        receipts.push(receipt);
    }
    assert_ne!(receipts[0].event_id(), receipts[1].event_id());
    assert!(receipts[0].sequence() < receipts[1].sequence());
}

#[tokio::test]
async fn failed_event_log_append_rejects_the_session_history_receipt() {
    let (temp, mut sink) = fixture(AgentTurnStatus::Running);
    sink.persist_model_history(call_record()).unwrap();
    let writer = sink.event_log_writer.clone().unwrap();
    let before = writer.read_session_events("history-session").unwrap();
    let before_state = sink.state.lock().unwrap().sessions["history-session"]
        .events
        .clone();
    let sessions = temp.path().join("events/sessions");
    let saved = temp.path().join("saved-sessions");
    std::fs::rename(&sessions, &saved).unwrap();
    std::fs::write(&sessions, "block durable append").unwrap();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let recorder = ChannelRuntimeEventSink { sender }.history_recorder();
    let task = tokio::spawn(async move { recorder.record(call_record()).await });
    let Some(SessionLoopEvent::ModelHistory(append)) = receiver.recv().await else {
        panic!("history append event");
    };
    assert!(append.persist(&mut sink).is_err());
    assert!(
        task.await.unwrap().is_err(),
        "failed disk write cannot return a receipt"
    );
    std::fs::rename(&sessions, temp.path().join("blocked-sessions")).unwrap();
    std::fs::rename(&saved, &sessions).unwrap();
    assert_eq!(
        writer.read_session_events("history-session").unwrap(),
        before
    );
    assert_eq!(
        sink.state.lock().unwrap().sessions["history-session"].events,
        before_state
    );
}
