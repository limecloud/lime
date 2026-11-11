use super::*;
use crate::runtime::{
    ActionRespondRequest, CancelExecutionRequest, ExecutionBackend, ExecutionRequest,
    RuntimeCoreEventAppender, RuntimeEvent, RuntimeEventSink, RuntimeHostContext,
};
use app_server_protocol::AgentSessionTurnStartParams;
use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tokio::sync::Notify;

#[derive(Default)]
struct ClosingBackend {
    appender: Mutex<Option<RuntimeCoreEventAppender>>,
    fail: AtomicBool,
    pause: AtomicBool,
    closing: Notify,
    release: Notify,
}

fn command_event(event_type: &str) -> RuntimeEvent {
    let terminal = event_type == "item.completed";
    let mut event = RuntimeEvent::new(
        event_type,
        json!({"item": ThreadItem {
            item_id: ItemId::new("item_shutdown-call"),
            session_id: SessionId::new("shutdown-session"),
            thread_id: ThreadId::new("shutdown-thread"),
            turn_id: TurnId::new("shutdown-turn"),
            sequence: 0,
            ordinal: 0,
            created_at_ms: 1,
            updated_at_ms: if terminal { 2 } else { 1 },
            completed_at_ms: terminal.then_some(2),
            kind: ItemKind::Command,
            status: if terminal { ItemStatus::Completed } else { ItemStatus::InProgress },
            payload: ThreadItemPayload::Command {
                command: "read answer".to_string(),
                cwd: None,
                output: terminal.then(|| "shutdown-final-output".to_string()),
                exit_code: terminal.then_some(-1),
            },
            metadata: json!({"exec_command_call_id": "shutdown-call", "processId": "shutdown-process", "executionSurface": "unified_exec"}),
        }}),
    );
    if event_type == "item.updated" {
        event.payload["item"]["metadata"]["session_id"] = json!(1000);
    }
    event
}

#[async_trait]
impl ExecutionBackend for ClosingBackend {
    async fn start_turn(
        &self,
        _request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        sink.emit(command_event("item.started"))?;
        sink.emit(command_event("item.updated"))?;
        sink.emit(RuntimeEvent::new("turn.completed", json!({})))
    }

    async fn cancel_turn(
        &self,
        _request: CancelExecutionRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn close_session(&self, session: &str, _thread: &str) -> Result<(), RuntimeCoreError> {
        if self.pause.load(Ordering::SeqCst) {
            self.closing.notify_one();
            self.release.notified().await;
        }
        let appender = self.appender.lock().unwrap().clone().unwrap();
        // A retry must retain the previous cleanup's new events, rather than restore a clone.
        if !self.fail.load(Ordering::SeqCst) {
            appender.append_command_runtime_events(
                session,
                "shutdown-turn",
                vec![command_event("item.completed")],
            )?;
        } else {
            appender.append_command_runtime_events(
                session,
                "shutdown-turn",
                vec![RuntimeEvent::new("command.output", json!({
                    "commandId": "shutdown-call", "processId": "shutdown-process", "delta": "cleanup-before-failure", "outputRef": "output://shutdown-call"
                }))],
            )?;
            return Err(RuntimeCoreError::Backend(
                "close fixture failure".to_string(),
            ));
        }
        Ok(())
    }

    async fn respond_action(
        &self,
        _request: ActionRespondRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }
}

fn turn_params(id: &str) -> AgentSessionTurnStartParams {
    AgentSessionTurnStartParams {
        session_id: "shutdown-session".to_string(),
        turn_id: Some(id.to_string()),
        input: app_server_protocol::AgentInput {
            text: "run the command".to_string(),
            attachments: Vec::new(),
        },
        runtime_options: None,
        queue_if_busy: false,
        skip_pre_submit_resume: false,
    }
}

async fn prepared_runtime() -> (tempfile::TempDir, RuntimeCore, Arc<ClosingBackend>) {
    let temp = tempfile::tempdir().unwrap();
    let backend = Arc::new(ClosingBackend::default());
    let runtime = RuntimeCore::with_backend(backend.clone())
        .with_event_log_writer(Arc::new(
            crate::EventLogWriter::new(temp.path().join("events")).unwrap(),
        ))
        .with_projection_store(Arc::new(
            ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
        ));
    *backend.appender.lock().unwrap() = Some(runtime.event_appender());
    runtime
        .start_session(AgentSessionStartParams {
            session_id: Some("shutdown-session".to_string()),
            thread_id: Some("shutdown-thread".to_string()),
            app_id: "test".to_string(),
            workspace_id: None,
            business_object_ref: None,
            locale: None,
        })
        .unwrap();
    runtime
        .start_turn(turn_params("shutdown-turn"), RuntimeHostContext::default())
        .await
        .unwrap();
    (temp, runtime, backend)
}

#[tokio::test]
async fn idle_shutdown_persists_command_terminal_before_removing_session() {
    let (_temp, runtime, _backend) = prepared_runtime().await;
    assert_eq!(
        runtime
            .unload_thread_if_idle("shutdown-thread")
            .await
            .unwrap(),
        ThreadUnloadResult::Unloaded
    );
    assert_eq!(
        runtime.loaded_session_id_for_thread("shutdown-thread"),
        None
    );
    let thread = runtime
        .read_thread(ThreadReadParams {
            thread_id: ThreadId::new("shutdown-thread"),
            turns_view: ThreadTurnsView::Full,
        })
        .await
        .unwrap()
        .thread;
    assert_eq!(thread.turns[0].status, TurnStatus::Completed);
    let item = thread.turns[0]
        .items
        .iter()
        .find(|item| item.item_id.as_str() == "item_shutdown-call")
        .unwrap();
    assert_eq!(item.status, ItemStatus::Completed);
    match &item.payload {
        ThreadItemPayload::Command { output, .. } => {
            assert_eq!(output.as_deref(), Some("shutdown-final-output"))
        }
        other => panic!("expected original Command: {other:?}"),
    }
}

#[tokio::test]
async fn failed_shutdown_keeps_new_events_and_allows_retry() {
    let (_temp, runtime, backend) = prepared_runtime().await;
    backend.fail.store(true, Ordering::SeqCst);
    let error = runtime
        .unload_thread_if_idle("shutdown-thread")
        .await
        .expect_err("close fixture must fail after appending output");
    assert!(
        matches!(error, RuntimeCoreError::Backend(ref message) if message == "close fixture failure"),
        "{error}"
    );
    assert!(runtime
        .events_for_session("shutdown-session")
        .unwrap()
        .iter()
        .any(|event| {
            event.event_type == "command.output"
                && event.payload["delta"] == "cleanup-before-failure"
        }));
    backend.fail.store(false, Ordering::SeqCst);
    assert_eq!(
        runtime
            .unload_thread_if_idle("shutdown-thread")
            .await
            .unwrap(),
        ThreadUnloadResult::Unloaded
    );
}

#[tokio::test]
async fn closing_session_rejects_turn_admission_and_resume_without_creating_loop() {
    let (_temp, runtime, backend) = prepared_runtime().await;
    backend.pause.store(true, Ordering::SeqCst);
    let closing = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.unload_thread_if_idle("shutdown-thread").await }
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        backend.closing.notified(),
    )
    .await
    .unwrap();
    assert!(runtime
        .start_turn(turn_params("racing-turn"), RuntimeHostContext::default())
        .await
        .is_err());
    assert!(runtime
        .resume_thread(ThreadId::new("shutdown-thread"))
        .await
        .is_err());
    assert!(runtime
        .session_loops
        .get_existing("shutdown-session")
        .await
        .is_none());
    backend.release.notify_one();
    assert_eq!(
        closing.await.unwrap().unwrap(),
        ThreadUnloadResult::Unloaded
    );
    runtime
        .resume_thread(ThreadId::new("shutdown-thread"))
        .await
        .unwrap();
}

#[tokio::test]
async fn rejected_input_must_not_shutdown_the_actor_owned_by_session_cleanup() {
    for shutting_down in [false, true] {
        let (_temp, runtime, _backend) = prepared_runtime().await;
        let actor = runtime
            .session_loop_for_input("shutdown-session", "shutdown-thread")
            .await
            .unwrap();
        let task = actor
            .submit(
                Arc::new(agent_runtime::session_loop::RuntimeSessionClosureTask::new(
                    "cleanup-owned-turn",
                    Vec::new(),
                    |_context, _input, cancellation| {
                        Box::pin(async move {
                            cancellation.cancelled().await;
                            Ok(())
                        })
                    },
                )),
                false,
            )
            .await
            .unwrap();
        {
            let mut state = runtime.state.lock().unwrap();
            state.shutting_down = shutting_down;
            if !shutting_down {
                state
                    .closing_sessions
                    .insert("shutdown-session".to_string());
            }
        }
        let rejected = runtime
            .session_loop_for_input("shutdown-session", "shutdown-thread")
            .await;
        assert!(
            matches!(rejected, Err(RuntimeCoreError::InvalidRequest(ref message))
            if message == "runtime session is shutting down: shutdown-session")
        );
        assert!(actor
            .interrupt_for_turn(Some("cleanup-owned-turn"))
            .await
            .expect("rejected input must retain the cleanup owner's actor"));
        assert_eq!(
            task.completion.await.unwrap().unwrap(),
            agent_runtime::session_loop::RuntimeSessionTaskOutcome::Interrupted
        );
        runtime
            .state
            .lock()
            .unwrap()
            .closing_sessions
            .remove("shutdown-session");
        runtime.shutdown().await.unwrap();
        assert!(runtime
            .session_loops
            .get_existing("shutdown-session")
            .await
            .is_none());
    }
}

#[tokio::test]
async fn transport_shutdown_waits_for_idle_cleanup_and_blocks_new_sessions() {
    let (_temp, runtime, backend) = prepared_runtime().await;
    backend.pause.store(true, Ordering::SeqCst);
    let idle = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.unload_thread_if_idle("shutdown-thread").await }
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        backend.closing.notified(),
    )
    .await
    .unwrap();
    let shutdown = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.shutdown().await }
    });
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !runtime.state.lock().unwrap().shutting_down {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!shutdown.is_finished());
    assert!(runtime
        .start_session(AgentSessionStartParams {
            session_id: Some("new-session".to_string()),
            thread_id: Some("new-thread".to_string()),
            app_id: "test".to_string(),
            workspace_id: None,
            business_object_ref: None,
            locale: None,
        })
        .is_err());
    backend.release.notify_one();
    assert_eq!(idle.await.unwrap().unwrap(), ThreadUnloadResult::Unloaded);
    shutdown.await.unwrap().unwrap();
    runtime.shutdown().await.unwrap();
    assert!(runtime
        .session_loop_for_input("shutdown-session", "shutdown-thread")
        .await
        .is_err());
    assert!(runtime
        .session_loops
        .get_existing("shutdown-session")
        .await
        .is_none());
}

#[tokio::test]
async fn aborted_idle_cleanup_releases_admission_marker_and_keeps_session() {
    let (_temp, runtime, backend) = prepared_runtime().await;
    backend.pause.store(true, Ordering::SeqCst);
    let idle = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.unload_thread_if_idle("shutdown-thread").await }
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        backend.closing.notified(),
    )
    .await
    .unwrap();
    idle.abort();
    assert!(idle.await.unwrap_err().is_cancelled());
    runtime
        .resume_thread(ThreadId::new("shutdown-thread"))
        .await
        .unwrap();
    backend.pause.store(false, Ordering::SeqCst);
    assert_eq!(
        runtime
            .unload_thread_if_idle("shutdown-thread")
            .await
            .unwrap(),
        ThreadUnloadResult::Unloaded
    );
}
