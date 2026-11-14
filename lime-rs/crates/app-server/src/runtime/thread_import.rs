use agent_protocol::{
    AgentInput, ItemId, ItemStatus, MessageContentPart, SessionId, Thread, ThreadId, ThreadItem,
    ThreadItemPayload, ThreadStatus, ThreadTurnsView, TurnAdmissionState, TurnId, TurnItemsView,
    TurnQueueState, TurnStatus,
};
use app_server_protocol::protocol::v2::{
    ThreadImportMessage, ThreadImportParams, ThreadImportResponse, ThreadImportRole,
    ThreadImportTurn, ThreadImportTurnStatus,
};
use app_server_protocol::AgentEvent;
use chrono::{SecondsFormat, TimeZone, Utc};
use serde_json::json;
use std::collections::HashSet;
use thread_store::{ApplyThreadHistoryParams, CreateThreadParams, ReadThreadParams, ThreadStore};
use uuid::Uuid;

use super::thread_item_projection;
use super::{RuntimeCore, RuntimeCoreError};

const MAX_IMPORT_TURNS: usize = 2_000;
const MAX_IMPORT_MESSAGES: usize = 5_000;
const MAX_MESSAGE_CHARS: usize = 200_000;
const MAX_TOTAL_MESSAGE_CHARS: usize = 20_000_000;
const PREVIEW_CHARS: usize = 200;

impl RuntimeCore {
    /// Imports one external conversation as a new canonical Thread.
    ///
    /// The external transcript is lowered into the same canonical
    /// `turn.started` / `item.completed` / `turn.completed` events that live
    /// turns produce, then materialized through the existing projection owner
    /// and committed through `ProjectionStore::create_thread` /
    /// `apply_history_with_runtime_sync`. The runtime events are persisted to
    /// the thread rollout, so a later resume continues with a fresh sequence.
    pub async fn import_thread(
        &self,
        params: ThreadImportParams,
    ) -> Result<ThreadImportResponse, RuntimeCoreError> {
        let source = require_trimmed(&params.source, "source")?;
        let source_conversation_id =
            require_trimmed(&params.source_conversation_id, "sourceConversationId")?;
        let turns = normalize_turns(&params.turns)?;
        let total_messages = turns.iter().map(|turn| turn.messages.len()).sum::<usize>();
        if total_messages == 0 {
            return Err(RuntimeCoreError::InvalidRequest(
                "thread/import requires at least one user or assistant message".to_string(),
            ));
        }
        let mut title = params.title.trim().to_string();
        if title.is_empty() {
            title = turns
                .iter()
                .flat_map(|turn| turn.messages.iter())
                .find(|message| message.message.role == ThreadImportRole::User)
                .map(|message| truncate_chars(message.message.text.trim(), 120))
                .unwrap_or_default();
        }
        if title.is_empty() {
            title = source_conversation_id.to_string();
        }
        let thread_id = import_thread_id(source, source_conversation_id);
        let session_id = thread_id.clone();
        let store = self.canonical_thread_store()?;

        if let Some(existing) = store
            .read_thread(ReadThreadParams {
                thread_id: ThreadId::new(thread_id.clone()),
                include_archived: true,
                turns_view: ThreadTurnsView::Full,
            })
            .await
            .map_err(store_error)?
        {
            if thread_matches_import(&existing, source, source_conversation_id) {
                let imported_message_count = existing
                    .turns
                    .iter()
                    .map(|turn| turn.items.len() as u32)
                    .sum();
                return Ok(ThreadImportResponse {
                    thread_id: existing.thread_id.to_string(),
                    session_id: existing.session_id.to_string(),
                    imported_turn_count: existing.turns.len() as u32,
                    imported_message_count,
                    already_imported: true,
                });
            }
            return Err(RuntimeCoreError::InvalidRequest(format!(
                "thread/import identity collision for {source}:{source_conversation_id}"
            )));
        }

        let created_at_ms = params.created_at_ms.unwrap_or_else(now_ms).max(0);
        let updated_at_ms = params
            .updated_at_ms
            .unwrap_or(created_at_ms)
            .max(created_at_ms);
        let first_user_text = turns
            .iter()
            .flat_map(|turn| turn.messages.iter())
            .find(|message| message.message.role == ThreadImportRole::User)
            .map(|message| message.message.text.trim())
            .filter(|value| !value.is_empty());
        let preview = first_user_text
            .map(|text| truncate_chars(text, PREVIEW_CHARS))
            .unwrap_or_default();
        let mut metadata = json!({
            "source": "import",
            "importedAtMs": now_ms(),
            "importSource": source,
            "importSourceConversationId": source_conversation_id,
        });
        if let Some(source_path) = params.source_path.as_deref() {
            if !source_path.trim().is_empty() {
                metadata["importSourcePath"] = json!(source_path);
            }
        }
        if let Some(cwd) = params.cwd.as_deref() {
            if !cwd.trim().is_empty() {
                metadata["workingDir"] = json!(cwd);
            }
        }
        let thread = Thread {
            session_id: SessionId::new(session_id.clone()),
            thread_id: ThreadId::new(thread_id.clone()),
            status: ThreadStatus::NotLoaded,
            created_at_ms,
            updated_at_ms,
            archived: false,
            recency_at_ms: Some(updated_at_ms),
            parent_thread_id: None,
            agent_path: None,
            agent_nickname: None,
            agent_role: None,
            last_task_message: None,
            agent_state: None,
            forked_from_id: None,
            preview,
            model_provider: String::new(),
            product: None,
            name: Some(title),
            metadata,
            turns: Vec::new(),
            turns_view: ThreadTurnsView::NotLoaded,
        };

        let (events, change_set) = build_import_events(
            source,
            source_conversation_id,
            &session_id,
            &thread_id,
            &turns,
        )?;
        store
            .create_thread(CreateThreadParams {
                thread: thread.clone(),
            })
            .await
            .map_err(store_error)?;
        let projection = self.canonical_projection_store()?;
        let applied = projection
            .apply_history_with_runtime_sync(
                ApplyThreadHistoryParams {
                    session_id: thread.session_id.clone(),
                    thread_id: thread.thread_id.clone(),
                    changes: change_set,
                },
                &events,
                self.sidecar_store.as_deref(),
            )
            .map_err(store_error)?;
        if !applied.applied {
            return Err(RuntimeCoreError::Backend(
                "thread/import history was not applied".to_string(),
            ));
        }
        Ok(ThreadImportResponse {
            thread_id,
            session_id,
            imported_turn_count: turns.len() as u32,
            imported_message_count: total_messages as u32,
            already_imported: false,
        })
    }
}

struct NormalizedTurn {
    source_turn_id: String,
    status: ThreadImportTurnStatus,
    started_at_ms: Option<i64>,
    completed_at_ms: Option<i64>,
    messages: Vec<NormalizedMessage>,
}

struct NormalizedMessage {
    message: ThreadImportMessage,
    created_at_ms: i64,
}

fn normalize_turns(turns: &[ThreadImportTurn]) -> Result<Vec<NormalizedTurn>, RuntimeCoreError> {
    if turns.len() > MAX_IMPORT_TURNS {
        return Err(RuntimeCoreError::InvalidRequest(format!(
            "thread/import accepts at most {MAX_IMPORT_TURNS} turns"
        )));
    }
    let mut normalized = Vec::new();
    let mut total_messages = 0usize;
    let mut total_chars = 0usize;
    let mut source_turn_ids = HashSet::new();
    for (turn_index, turn) in turns.iter().enumerate() {
        let source_turn_id = require_trimmed(&turn.source_turn_id, "sourceTurnId")?;
        if !source_turn_ids.insert(source_turn_id.to_string()) {
            return Err(RuntimeCoreError::InvalidRequest(format!(
                "thread/import received duplicate sourceTurnId {source_turn_id}"
            )));
        }
        let mut messages = Vec::new();
        let mut last_created_at = turn.started_at_ms;
        for (message_index, message) in turn.messages.iter().enumerate() {
            total_messages += 1;
            if total_messages > MAX_IMPORT_MESSAGES {
                return Err(RuntimeCoreError::InvalidRequest(format!(
                    "thread/import accepts at most {MAX_IMPORT_MESSAGES} messages"
                )));
            }
            if message.text.trim().is_empty() {
                return Err(RuntimeCoreError::InvalidRequest(format!(
                    "turns[{turn_index}].messages[{message_index}] text must not be empty"
                )));
            }
            if message.text.chars().count() > MAX_MESSAGE_CHARS {
                return Err(RuntimeCoreError::InvalidRequest(format!(
                    "turns[{turn_index}].messages[{message_index}] exceeds {MAX_MESSAGE_CHARS} characters"
                )));
            }
            total_chars += message.text.chars().count();
            if total_chars > MAX_TOTAL_MESSAGE_CHARS {
                return Err(RuntimeCoreError::InvalidRequest(format!(
                    "thread/import message text exceeds {MAX_TOTAL_MESSAGE_CHARS} characters"
                )));
            }
            let created_at_ms = last_created_at
                .map_or(message.created_at_ms, |previous| {
                    message.created_at_ms.max(previous)
                })
                .max(0);
            last_created_at = Some(created_at_ms);
            messages.push(NormalizedMessage {
                message: message.clone(),
                created_at_ms,
            });
        }
        if messages.is_empty() {
            continue;
        }
        let started_at_ms = turn
            .started_at_ms
            .map(|value| value.max(0))
            .or_else(|| messages.first().map(|message| message.created_at_ms));
        let completed_at_ms = turn
            .completed_at_ms
            .map(|value| value.max(0))
            .or_else(|| messages.last().map(|message| message.created_at_ms));
        normalized.push(NormalizedTurn {
            source_turn_id: source_turn_id.to_string(),
            status: turn.status,
            started_at_ms,
            completed_at_ms,
            messages,
        });
    }
    Ok(normalized)
}

fn build_import_events(
    source: &str,
    source_conversation_id: &str,
    session_id: &str,
    thread_id: &str,
    turns: &[NormalizedTurn],
) -> Result<(Vec<AgentEvent>, agent_protocol::ThreadHistoryChangeSet), RuntimeCoreError> {
    let mut events = Vec::new();
    let namespace = format!("{source}:{source_conversation_id}");
    for turn in turns.iter() {
        let turn_id = stable_id(&format!("{namespace}:turn:{}", turn.source_turn_id));
        let started_at_ms = turn
            .started_at_ms
            .or_else(|| turn.messages.first().map(|message| message.created_at_ms))
            .unwrap_or_else(now_ms)
            .max(0);
        push_event(
            &mut events,
            session_id,
            thread_id,
            &turn_id,
            "turn.started",
            started_at_ms,
            json!({}),
        )?;
        for (message_index, message) in turn.messages.iter().enumerate() {
            let item_id = stable_id(&format!(
                "{namespace}:turn:{}:message:{message_index}",
                turn.source_turn_id
            ));
            let payload = match message.message.role {
                ThreadImportRole::User => ThreadItemPayload::UserMessage {
                    content: vec![AgentInput::text(message.message.text.clone())],
                    client_id: Some(item_id.clone()),
                },
                ThreadImportRole::Assistant => ThreadItemPayload::AgentMessage {
                    text: message.message.text.clone(),
                    phase: None,
                    content_parts: vec![MessageContentPart::Text {
                        text: message.message.text.clone(),
                    }],
                    delivery: None,
                    questions: None,
                },
            };
            let item = ThreadItem {
                session_id: SessionId::new(session_id.to_string()),
                thread_id: ThreadId::new(thread_id.to_string()),
                turn_id: TurnId::new(turn_id.clone()),
                item_id: ItemId::new(item_id),
                sequence: events.len() as u64 + 1,
                ordinal: events.len() as u64 + 1,
                created_at_ms: message.created_at_ms,
                updated_at_ms: message.created_at_ms,
                completed_at_ms: Some(message.created_at_ms),
                kind: payload.kind(),
                status: ItemStatus::Completed,
                payload,
                metadata: json!({
                    "imported": true,
                    "source": source,
                    "sourceConversationId": source_conversation_id,
                    "sourceTurnId": turn.source_turn_id,
                    "sourceItemId": message.message.source_item_id,
                }),
            };
            push_event(
                &mut events,
                session_id,
                thread_id,
                &turn_id,
                "item.completed",
                message.created_at_ms,
                json!({ "item": serde_json::to_value(item).map_err(|error| {
                    RuntimeCoreError::Backend(format!("thread/import item encode failed: {error}"))
                })? }),
            )?;
        }
        let completed_at_ms = turn
            .completed_at_ms
            .or_else(|| turn.messages.last().map(|message| message.created_at_ms))
            .unwrap_or(started_at_ms)
            .max(started_at_ms);
        let (event_type, payload) = match turn.status {
            ThreadImportTurnStatus::Completed => ("turn.completed", json!({})),
            ThreadImportTurnStatus::Interrupted => ("turn.canceled", json!({})),
            ThreadImportTurnStatus::Failed => {
                ("turn.failed", json!({ "message": "source turn failed" }))
            }
        };
        push_event(
            &mut events,
            session_id,
            thread_id,
            &turn_id,
            event_type,
            completed_at_ms,
            payload,
        )?;
    }
    if events.is_empty() {
        return Err(RuntimeCoreError::InvalidRequest(
            "thread/import produced no canonical events".to_string(),
        ));
    }
    let change_set = thread_item_projection::materialize_events(&events, session_id, thread_id)
        .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
    Ok((events, change_set))
}

fn push_event(
    events: &mut Vec<AgentEvent>,
    session_id: &str,
    thread_id: &str,
    turn_id: &str,
    event_type: &str,
    timestamp_ms: i64,
    payload: serde_json::Value,
) -> Result<(), RuntimeCoreError> {
    let sequence = events.len() as u64 + 1;
    let timestamp = Utc
        .timestamp_millis_opt(timestamp_ms.max(0))
        .single()
        .ok_or_else(|| {
            RuntimeCoreError::InvalidRequest(format!(
                "thread/import timestamp {timestamp_ms} is out of range"
            ))
        })?
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    events.push(AgentEvent {
        event_id: stable_id(&format!("import:{}:{}", thread_id, sequence)),
        sequence,
        session_id: session_id.to_string(),
        thread_id: Some(thread_id.to_string()),
        turn_id: Some(turn_id.to_string()),
        event_type: event_type.to_string(),
        timestamp,
        payload,
    });
    Ok(())
}

fn thread_matches_import(thread: &Thread, source: &str, source_conversation_id: &str) -> bool {
    thread
        .metadata
        .get("importSource")
        .and_then(|value| value.as_str())
        == Some(source)
        && thread
            .metadata
            .get("importSourceConversationId")
            .and_then(|value| value.as_str())
            == Some(source_conversation_id)
}

fn import_thread_id(source: &str, source_conversation_id: &str) -> String {
    let namespace = format!("lime:{source}:{source_conversation_id}");
    Uuid::new_v5(&Uuid::NAMESPACE_URL, namespace.as_bytes()).to_string()
}

fn stable_id(value: &str) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, value.as_bytes()).to_string()
}

fn require_trimmed<'a>(value: &'a str, field: &str) -> Result<&'a str, RuntimeCoreError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(RuntimeCoreError::InvalidRequest(format!(
            "thread/import requires {field}"
        )));
    }
    Ok(trimmed)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn store_error(error: thread_store::ThreadStoreError) -> RuntimeCoreError {
    RuntimeCoreError::Backend(error.to_string())
}
