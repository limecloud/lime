use chrono::Utc;
use lime_agent::AgentEvent as RuntimeAgentEvent;
use lime_core::database::dao::agent_timeline::{
    AgentRequestQuestion, AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus,
    AgentThreadTurn, AgentThreadTurnStatus, AgentTimelineDao,
};
use lime_core::database::{lock_db, DbConnection};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

fn emit_event(app: &AppHandle, event_name: &str, event: &RuntimeAgentEvent) {
    if let Err(error) = app.emit(event_name, event) {
        tracing::error!("[AgentTimeline] 发送事件失败: {}", error);
    }
}

fn resolve_artifact_item_status(metadata: Option<&Value>) -> AgentThreadItemStatus {
    let write_phase = metadata
        .and_then(|value| value.get("writePhase"))
        .and_then(Value::as_str);
    if matches!(write_phase, Some("failed")) {
        return AgentThreadItemStatus::Failed;
    }

    match metadata
        .and_then(|value| value.get("complete"))
        .and_then(Value::as_bool)
    {
        Some(false) => AgentThreadItemStatus::InProgress,
        _ => AgentThreadItemStatus::Completed,
    }
}

fn resolve_artifact_item_source(metadata: Option<&Value>) -> String {
    metadata
        .and_then(|value| value.get("lastUpdateSource"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "artifact_snapshot".to_string())
}

#[derive(Debug)]
pub struct AgentTimelineRecorder {
    db: DbConnection,
    thread_id: String,
    turn_id: String,
    turn: AgentThreadTurn,
    sequence_counter: i64,
    item_sequences: HashMap<String, i64>,
    item_statuses: HashMap<String, AgentThreadItemStatus>,
    plan_text: Option<String>,
}

impl AgentTimelineRecorder {
    pub fn create(
        db: DbConnection,
        thread_id: impl Into<String>,
        turn_id: impl Into<String>,
        prompt_text: impl Into<String>,
    ) -> Result<Self, String> {
        let thread_id = thread_id.into();
        let turn_id = turn_id.into();
        let prompt_text = prompt_text.into();
        let now = Utc::now().to_rfc3339();
        let turn = AgentThreadTurn {
            id: turn_id.clone(),
            thread_id: thread_id.clone(),
            prompt_text,
            status: AgentThreadTurnStatus::Running,
            started_at: now.clone(),
            completed_at: None,
            error_message: None,
            created_at: now.clone(),
            updated_at: now,
        };

        {
            let conn = lock_db(&db)?;
            AgentTimelineDao::create_turn(&conn, &turn)
                .map_err(|e| format!("创建 turn 失败: {e}"))?;
        }

        Ok(Self {
            db,
            thread_id,
            turn_id,
            turn,
            sequence_counter: 0,
            item_sequences: HashMap::new(),
            item_statuses: HashMap::new(),
            plan_text: None,
        })
    }

    pub fn thread_id(&self) -> &str {
        &self.thread_id
    }

    pub fn turn_id(&self) -> &str {
        &self.turn_id
    }

    pub fn record_runtime_event(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        event: &RuntimeAgentEvent,
        _workspace_root: &str,
    ) -> Result<(), String> {
        match event {
            RuntimeAgentEvent::ThreadStarted { .. } => {}
            RuntimeAgentEvent::TurnStarted { turn } => {
                self.thread_id = turn.thread_id.clone();
                self.turn_id = turn.id.clone();
                self.turn = turn.clone();

                let conn = lock_db(&self.db)?;
                AgentTimelineDao::upsert_turn(&conn, &self.turn)
                    .map_err(|e| format!("同步 turn 启动态失败: {e}"))?;
            }
            RuntimeAgentEvent::ItemStarted { item } => {
                self.persist_runtime_item(
                    app,
                    event_name,
                    item.clone(),
                    RuntimeAgentEvent::ItemStarted { item: item.clone() },
                )?;
            }
            RuntimeAgentEvent::ItemUpdated { item } => {
                self.persist_runtime_item(
                    app,
                    event_name,
                    item.clone(),
                    RuntimeAgentEvent::ItemUpdated { item: item.clone() },
                )?;
            }
            RuntimeAgentEvent::ItemCompleted { item } => {
                self.persist_runtime_item(
                    app,
                    event_name,
                    item.clone(),
                    RuntimeAgentEvent::ItemCompleted { item: item.clone() },
                )?;
            }
            RuntimeAgentEvent::RuntimeStatus { .. } => {}
            RuntimeAgentEvent::TurnContext { .. } => {}
            RuntimeAgentEvent::ToolEnd { .. } => {}
            RuntimeAgentEvent::ArtifactSnapshot { artifact } => {
                let metadata_value = artifact
                    .metadata
                    .as_ref()
                    .and_then(|metadata| serde_json::to_value(metadata).ok());
                let status = resolve_artifact_item_status(metadata_value.as_ref());
                let item = self.build_item(
                    artifact.artifact_id.clone(),
                    status.clone(),
                    if matches!(status, AgentThreadItemStatus::InProgress) {
                        None
                    } else {
                        Some(Utc::now().to_rfc3339())
                    },
                    AgentThreadItemPayload::FileArtifact {
                        path: artifact.file_path.clone(),
                        source: resolve_artifact_item_source(metadata_value.as_ref()),
                        content: artifact.content.clone(),
                        metadata: metadata_value,
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            RuntimeAgentEvent::ActionRequired { .. } => {}
            RuntimeAgentEvent::ContextCompactionStarted {
                item_id,
                trigger,
                detail,
            } => {
                let item = self.build_item(
                    item_id.clone(),
                    AgentThreadItemStatus::InProgress,
                    None,
                    AgentThreadItemPayload::ContextCompaction {
                        stage: "started".to_string(),
                        trigger: Some(trigger.clone()),
                        detail: detail.clone(),
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            RuntimeAgentEvent::ContextCompactionCompleted {
                item_id,
                trigger,
                detail,
            } => {
                let item = self.build_item(
                    item_id.clone(),
                    AgentThreadItemStatus::Completed,
                    Some(Utc::now().to_rfc3339()),
                    AgentThreadItemPayload::ContextCompaction {
                        stage: "completed".to_string(),
                        trigger: Some(trigger.clone()),
                        detail: detail.clone(),
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            RuntimeAgentEvent::Warning { code, message } => {
                let item = self.build_item(
                    format!("warning:{}:{}", self.turn_id, self.sequence_counter + 1),
                    AgentThreadItemStatus::Completed,
                    Some(Utc::now().to_rfc3339()),
                    AgentThreadItemPayload::Warning {
                        message: message.clone(),
                        code: code.clone(),
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            RuntimeAgentEvent::Error { message } => {
                let item = self.build_item(
                    format!("error:{}", self.turn_id),
                    AgentThreadItemStatus::Failed,
                    Some(Utc::now().to_rfc3339()),
                    AgentThreadItemPayload::Error {
                        message: message.clone(),
                    },
                );
                self.persist_and_emit_item(app, event_name, item)?;
            }
            _ => {}
        }

        Ok(())
    }

    pub fn record_request_user_input(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        request_id: String,
        action_type: String,
        prompt: Option<String>,
        questions: Option<Vec<AgentRequestQuestion>>,
    ) -> Result<(), String> {
        let item = self.build_item(
            request_id.clone(),
            AgentThreadItemStatus::InProgress,
            None,
            AgentThreadItemPayload::RequestUserInput {
                request_id,
                action_type,
                prompt,
                questions,
                response: None,
            },
        );
        self.persist_and_emit_item(app, event_name, item)
    }

    pub fn complete_turn_success(&mut self) -> Result<Vec<RuntimeAgentEvent>, String> {
        let now = Utc::now().to_rfc3339();
        self.turn.status = AgentThreadTurnStatus::Completed;
        self.turn.completed_at = Some(now.clone());
        self.turn.updated_at = now.clone();

        let conn = lock_db(&self.db)?;
        AgentTimelineDao::update_turn_status(
            &conn,
            &self.turn_id,
            AgentThreadTurnStatus::Completed,
            Some(&now),
            None,
            &now,
        )
        .map_err(|e| format!("更新 turn 完成状态失败: {e}"))?;
        drop(conn);

        let mut events = self.complete_projection_items(AgentThreadItemStatus::Completed)?;
        events.push(RuntimeAgentEvent::TurnCompleted {
            turn: self.turn.clone(),
        });
        Ok(events)
    }

    pub fn fail_turn(&mut self, message: &str) -> Result<Vec<RuntimeAgentEvent>, String> {
        let now = Utc::now().to_rfc3339();
        self.turn.status = AgentThreadTurnStatus::Failed;
        self.turn.completed_at = Some(now.clone());
        self.turn.error_message = Some(message.to_string());
        self.turn.updated_at = now.clone();

        let conn = lock_db(&self.db)?;
        AgentTimelineDao::update_turn_status(
            &conn,
            &self.turn_id,
            AgentThreadTurnStatus::Failed,
            Some(&now),
            Some(message),
            &now,
        )
        .map_err(|e| format!("更新 turn 失败状态失败: {e}"))?;
        drop(conn);

        let mut events = self.complete_projection_items(AgentThreadItemStatus::Completed)?;
        let error_item = self.build_item(
            format!("error:{}", self.turn_id),
            AgentThreadItemStatus::Failed,
            Some(Utc::now().to_rfc3339()),
            AgentThreadItemPayload::Error {
                message: message.to_string(),
            },
        );
        events.push(self.persist_item_and_build_event(error_item)?);
        events.push(RuntimeAgentEvent::TurnFailed {
            turn: self.turn.clone(),
        });
        Ok(events)
    }

    fn complete_projection_items(
        &mut self,
        status: AgentThreadItemStatus,
    ) -> Result<Vec<RuntimeAgentEvent>, String> {
        let mut events = Vec::new();
        if let Some(plan_text) = self.plan_text.clone() {
            let item = self.build_item(
                format!("plan:{}", self.turn_id),
                status.clone(),
                Some(Utc::now().to_rfc3339()),
                AgentThreadItemPayload::Plan { text: plan_text },
            );
            events.push(self.persist_item_and_build_event(item)?);
        }

        Ok(events)
    }

    fn build_item(
        &mut self,
        id: String,
        status: AgentThreadItemStatus,
        completed_at: Option<String>,
        payload: AgentThreadItemPayload,
    ) -> AgentThreadItem {
        let now = Utc::now().to_rfc3339();
        let started_at = self
            .item_statuses
            .get(&id)
            .map(|_| {
                let conn = lock_db(&self.db).ok()?;
                AgentTimelineDao::get_item(&conn, &id)
                    .ok()
                    .flatten()
                    .map(|item| item.started_at)
            })
            .flatten()
            .unwrap_or_else(|| now.clone());

        let sequence = if let Some(existing) = self.item_sequences.get(&id) {
            *existing
        } else {
            self.sequence_counter += 1;
            self.item_sequences
                .insert(id.clone(), self.sequence_counter);
            self.sequence_counter
        };

        AgentThreadItem {
            id,
            thread_id: self.thread_id.clone(),
            turn_id: self.turn_id.clone(),
            sequence,
            status,
            started_at,
            completed_at,
            updated_at: now,
            payload,
        }
    }

    fn persist_and_emit_item(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        item: AgentThreadItem,
    ) -> Result<(), String> {
        let event = self.persist_item_and_build_event(item)?;
        emit_event(app, event_name, &event);
        Ok(())
    }

    fn persist_item_and_build_event(
        &mut self,
        item: AgentThreadItem,
    ) -> Result<RuntimeAgentEvent, String> {
        {
            let conn = lock_db(&self.db)?;
            AgentTimelineDao::upsert_item(&conn, &item)
                .map_err(|e| format!("保存 item 失败: {e}"))?;
        }

        let previous_status = self
            .item_statuses
            .insert(item.id.clone(), item.status.clone());
        let event = match (&previous_status, &item.status) {
            (None, AgentThreadItemStatus::InProgress) => {
                RuntimeAgentEvent::ItemStarted { item: item.clone() }
            }
            (None, _) => RuntimeAgentEvent::ItemCompleted { item: item.clone() },
            (_, AgentThreadItemStatus::Completed | AgentThreadItemStatus::Failed) => {
                RuntimeAgentEvent::ItemCompleted { item: item.clone() }
            }
            _ => RuntimeAgentEvent::ItemUpdated { item: item.clone() },
        };
        Ok(event)
    }

    fn persist_runtime_item(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        item: AgentThreadItem,
        event: RuntimeAgentEvent,
    ) -> Result<(), String> {
        self.sync_runtime_item_state(&item);
        {
            let conn = lock_db(&self.db)?;
            AgentTimelineDao::upsert_item(&conn, &item)
                .map_err(|e| format!("保存 runtime item 失败: {e}"))?;
        }
        emit_event(app, event_name, &event);
        Ok(())
    }

    fn sync_runtime_item_state(&mut self, item: &AgentThreadItem) {
        self.thread_id = item.thread_id.clone();
        self.turn_id = item.turn_id.clone();
        self.sequence_counter = self.sequence_counter.max(item.sequence);
        self.item_sequences.insert(item.id.clone(), item.sequence);
        self.item_statuses
            .insert(item.id.clone(), item.status.clone());

        if let AgentThreadItemPayload::Plan { text } = &item.payload {
            self.plan_text = Some(text.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::agent_timeline::{AgentThreadTurnStatus, AgentTimelineDao};
    use lime_core::database::schema::create_tables;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建 agent timeline 表失败");
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "thread-1",
                "general:test",
                "2026-03-13T00:00:00Z",
                "2026-03-13T00:00:00Z"
            ],
        )
        .expect("创建测试 session");
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn fail_turn_should_persist_failed_turn_before_emitting_events() {
        let db = setup_db();
        let mut recorder = AgentTimelineRecorder::create(db.clone(), "thread-1", "turn-1", "hello")
            .expect("创建 recorder");

        let events = recorder.fail_turn("boom").expect("写入失败终态");

        let conn = lock_db(&db).expect("获取数据库锁");
        let turns = AgentTimelineDao::list_turns_by_thread(&conn, "thread-1").expect("读取 turn");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].status, AgentThreadTurnStatus::Failed);
        assert_eq!(turns[0].error_message.as_deref(), Some("boom"));
        drop(conn);

        assert!(events
            .iter()
            .any(|event| matches!(event, RuntimeAgentEvent::TurnFailed { .. })));
        assert!(events
            .iter()
            .any(|event| matches!(event, RuntimeAgentEvent::ItemCompleted { item } if item.id == "error:turn-1")));
    }

    #[test]
    fn complete_turn_success_should_persist_completed_turn_before_emitting_events() {
        let db = setup_db();
        let mut recorder = AgentTimelineRecorder::create(db.clone(), "thread-1", "turn-1", "hello")
            .expect("创建 recorder");

        let events = recorder.complete_turn_success().expect("写入完成终态");

        let conn = lock_db(&db).expect("获取数据库锁");
        let turns = AgentTimelineDao::list_turns_by_thread(&conn, "thread-1").expect("读取 turn");
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].status, AgentThreadTurnStatus::Completed);
        assert!(turns[0].completed_at.is_some());
        drop(conn);

        assert!(events
            .iter()
            .any(|event| matches!(event, RuntimeAgentEvent::TurnCompleted { .. })));
    }
}
