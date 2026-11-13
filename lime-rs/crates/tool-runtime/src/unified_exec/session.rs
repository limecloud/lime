use super::invocation::Invocation;
use super::unified_exec_error;
use crate::tool_executor::RuntimeToolExecutionError;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub(super) struct UnifiedExecSession {
    pub(super) thread_id: String,
    pub(super) turn_id: String,
    pub(super) process_id: String,
    pub(super) call_id: String,
    pub(super) invocation: Invocation,
    pub(super) after_sequence: Option<u64>,
    pub(super) empty_poll_count: u64,
    pub(super) streaming_sequence: Option<u64>,
    pub(super) completed: bool,
    pub(super) started_at: std::time::Instant,
    pub(super) interaction_lock: Arc<tokio::sync::Mutex<()>>,
    pub(super) output_sink: Option<Arc<dyn crate::tool_lifecycle::ToolLifecycleEmitter>>,
}

#[derive(Default)]
struct UnifiedExecSessionRegistry {
    sessions: HashMap<i32, Arc<tokio::sync::Mutex<UnifiedExecSession>>>,
}

pub(super) async fn session_facts(
    session: &tokio::sync::Mutex<UnifiedExecSession>,
) -> UnifiedExecSession {
    let session = session.lock().await;
    UnifiedExecSession {
        thread_id: session.thread_id.clone(),
        turn_id: session.turn_id.clone(),
        process_id: session.process_id.clone(),
        call_id: session.call_id.clone(),
        invocation: session.invocation.clone(),
        after_sequence: session.after_sequence,
        empty_poll_count: session.empty_poll_count,
        streaming_sequence: session.streaming_sequence,
        completed: session.completed,
        started_at: session.started_at,
        interaction_lock: Arc::clone(&session.interaction_lock),
        output_sink: session.output_sink.clone(),
    }
}

fn session_registry() -> &'static Mutex<UnifiedExecSessionRegistry> {
    static REGISTRY: OnceLock<Mutex<UnifiedExecSessionRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(UnifiedExecSessionRegistry::default()))
}

pub(super) fn next_session_id() -> i32 {
    static NEXT_SESSION_ID: AtomicI32 = AtomicI32::new(1_000);
    NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

pub(super) fn register_session(
    session_id: i32,
    session: Arc<tokio::sync::Mutex<UnifiedExecSession>>,
) -> Result<(), RuntimeToolExecutionError> {
    let mut registry = session_registry()
        .lock()
        .map_err(|_| unified_exec_error("unified exec session registry is unavailable"))?;
    registry.sessions.insert(session_id, session);
    Ok(())
}

pub(super) fn find_session(
    session_id: i32,
) -> Result<Arc<tokio::sync::Mutex<UnifiedExecSession>>, RuntimeToolExecutionError> {
    session_registry()
        .lock()
        .map_err(|_| unified_exec_error("unified exec session registry is unavailable"))?
        .sessions
        .get(&session_id)
        .map(Arc::clone)
        .ok_or_else(|| unified_exec_error(format!("unified exec session not found: {session_id}")))
}

pub(super) fn remove_session(session_id: i32) {
    if let Ok(mut registry) = session_registry().lock() {
        registry.sessions.remove(&session_id);
    }
}

pub(super) async fn sessions_for_turn(
    thread_id: &str,
    turn_id: &str,
) -> Vec<(i32, Arc<tokio::sync::Mutex<UnifiedExecSession>>)> {
    sessions_for_scope(thread_id, Some(turn_id)).await
}

pub(super) async fn sessions_for_thread(
    thread_id: &str,
) -> Vec<(i32, Arc<tokio::sync::Mutex<UnifiedExecSession>>)> {
    sessions_for_scope(thread_id, None).await
}

async fn sessions_for_scope(
    thread_id: &str,
    turn_id: Option<&str>,
) -> Vec<(i32, Arc<tokio::sync::Mutex<UnifiedExecSession>>)> {
    let sessions = session_registry()
        .lock()
        .expect("unified exec session registry mutex poisoned")
        .sessions
        .iter()
        .map(|(id, session)| (*id, Arc::clone(session)))
        .collect::<Vec<_>>();
    let mut owned = Vec::new();
    for (id, session) in sessions {
        let facts = session_facts(&session).await;
        if facts.thread_id == thread_id && turn_id.is_none_or(|turn_id| facts.turn_id == turn_id) {
            owned.push((id, session));
        }
    }
    owned
}
