use chrono::Utc;
use lime_agent::AgentEvent as RuntimeAgentEvent;
use lime_core::database::dao::agent_timeline::{
    AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus, AgentThreadTurn,
    AgentThreadTurnStatus, AgentTimelineDao,
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

    pub fn complete_turn_success(
        &mut self,
        app: &AppHandle,
        event_name: &str,
    ) -> Result<(), String> {
        self.complete_projection_items(app, event_name, AgentThreadItemStatus::Completed)?;
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

        emit_event(
            app,
            event_name,
            &RuntimeAgentEvent::TurnCompleted {
                turn: self.turn.clone(),
            },
        );
        Ok(())
    }

    pub fn fail_turn(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        message: &str,
    ) -> Result<(), String> {
        self.complete_projection_items(app, event_name, AgentThreadItemStatus::Completed)?;
        let error_item = self.build_item(
            format!("error:{}", self.turn_id),
            AgentThreadItemStatus::Failed,
            Some(Utc::now().to_rfc3339()),
            AgentThreadItemPayload::Error {
                message: message.to_string(),
            },
        );
        self.persist_and_emit_item(app, event_name, error_item)?;

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

        emit_event(
            app,
            event_name,
            &RuntimeAgentEvent::TurnFailed {
                turn: self.turn.clone(),
            },
        );
        Ok(())
    }

    fn complete_projection_items(
        &mut self,
        app: &AppHandle,
        event_name: &str,
        status: AgentThreadItemStatus,
    ) -> Result<(), String> {
        if let Some(plan_text) = self.plan_text.clone() {
            let item = self.build_item(
                format!("plan:{}", self.turn_id),
                status.clone(),
                Some(Utc::now().to_rfc3339()),
                AgentThreadItemPayload::Plan { text: plan_text },
            );
            self.persist_and_emit_item(app, event_name, item)?;
        }

        Ok(())
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
        emit_event(app, event_name, &event);
        Ok(())
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
