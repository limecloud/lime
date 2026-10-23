use super::*;
use agent_protocol::{ThreadId, ThreadTurnsView};
use rusqlite::Connection;
use thread_store::{ReadThreadParams, ThreadStore};

const SESSION_ID: &str = "session-delete-retry";
const THREAD_ID: &str = "thread-delete-retry";

#[tokio::test]
async fn failed_atomic_delete_keeps_database_and_memory_then_retries_without_external_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let projection_path = temp.path().join("projection.sqlite");
    let state_path = temp.path().join("state.sqlite");
    let history_path = temp.path().join("thread-history.sqlite");
    let agent_root = temp.path().join("agent-root");
    let event_log = Arc::new(
        EventLogWriter::new(temp.path().join("event-log")).expect("thread delete event log"),
    );
    let sidecar_root = temp.path().join("sidecars");
    let sidecar = Arc::new(SidecarStore::new(&sidecar_root).expect("thread delete sidecar"));
    let store = Arc::new(
        ProjectionStore::initialize_with_storage_paths(
            &projection_path,
            &state_path,
            &history_path,
            &agent_root,
        )
        .expect("thread delete projection store"),
    );
    let core = RuntimeCore::default()
        .with_projection_store(store.clone())
        .with_event_log_writer(event_log.clone())
        .with_sidecar_store(sidecar.clone());
    core.start_session(AgentSessionStartParams {
        session_id: Some(SESSION_ID.to_string()),
        thread_id: Some(THREAD_ID.to_string()),
        app_id: "thread-delete-retry-test".to_string(),
        workspace_id: None,
        business_object_ref: None,
        locale: None,
    })
    .expect("start thread delete retry session");
    event_log
        .append(&AgentEvent {
            event_id: "event-delete-retry".to_string(),
            sequence: 1,
            session_id: SESSION_ID.to_string(),
            thread_id: Some(THREAD_ID.to_string()),
            turn_id: None,
            event_type: "thread.delete.retry.test".to_string(),
            timestamp: "2026-07-21T00:00:00Z".to_string(),
            payload: json!({}),
        })
        .expect("seed thread delete retry event");
    let sidecar_ref = sidecar
        .write_text(&SidecarWriteRequest {
            session_id: SESSION_ID.to_string(),
            kind: "thread-delete-retry".to_string(),
            logical_id: "retry-proof".to_string(),
            relative_path: format!("sessions/{SESSION_ID}/retry-proof.txt"),
            content: "delete me before retry".to_string(),
        })
        .expect("seed thread delete retry sidecar");
    let sidecar_path = sidecar_root.join(sidecar_ref.relative_path);
    assert_eq!(
        store
            .rollout_store()
            .expect("rollout store")
            .snapshots()
            .expect("rollout snapshots")
            .len(),
        1
    );

    let conn = Connection::open(&state_path).expect("open state store");
    conn.execute_batch(
        "CREATE TRIGGER fail_thread_delete_retry
         BEFORE DELETE ON canonical_threads
         WHEN OLD.thread_id = 'thread-delete-retry'
         BEGIN
             SELECT RAISE(ABORT, 'injected thread delete retry failure');
         END;",
    )
    .expect("install delete failure trigger");
    drop(conn);

    let error = core
        .delete_thread(ThreadId::new(THREAD_ID), None)
        .await
        .expect_err("first delete must fail at atomic commit");
    assert!(error
        .to_string()
        .contains("injected thread delete retry failure"));
    assert!(store
        .read_thread(ReadThreadParams {
            thread_id: ThreadId::new(THREAD_ID),
            include_archived: true,
            turns_view: ThreadTurnsView::NotLoaded,
        })
        .await
        .expect("read thread after failed delete")
        .is_some());
    core.read_session(AgentSessionReadParams {
        session_id: SESSION_ID.to_string(),
        history_limit: None,
        history_offset: None,
        history_before_message_id: None,
    })
    .expect("failed atomic delete keeps memory session");
    assert!(store
        .rollout_store()
        .expect("rollout store")
        .snapshots()
        .expect("rollout snapshots after failure")
        .is_empty());
    assert!(event_log
        .read_session_events(SESSION_ID)
        .expect("events after failed delete")
        .is_empty());
    assert!(!sidecar_path.exists());

    let conn = Connection::open(&state_path).expect("reopen state store");
    conn.execute_batch("DROP TRIGGER fail_thread_delete_retry;")
        .expect("remove delete failure trigger");
    drop(conn);

    let deleted = core
        .delete_thread(ThreadId::new(THREAD_ID), None)
        .await
        .expect("retry delete without external files");
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0].thread_id, THREAD_ID);
    assert!(store
        .read_thread(ReadThreadParams {
            thread_id: ThreadId::new(THREAD_ID),
            include_archived: true,
            turns_view: ThreadTurnsView::NotLoaded,
        })
        .await
        .expect("read thread after retry")
        .is_none());

    let second = core
        .delete_thread(ThreadId::new(THREAD_ID), None)
        .await
        .expect_err("second delete must report missing thread");
    assert!(second.to_string().contains("thread not found"));
}
