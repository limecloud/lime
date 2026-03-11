//! SubAgent 调度器集成（Tauri 桥接层）
//!
//! 纯逻辑已迁移到 `proxycast-agent` crate，
//! 本模块负责 Tauri 事件桥接。

use std::sync::Arc;

use aster::agents::context::AgentContext;
use aster::agents::subagent_scheduler::{
    SchedulerConfig, SchedulerExecutionResult, SchedulerResult, SubAgentTask,
};
use tauri::{AppHandle, Emitter};

use crate::database::DbConnection;

pub use proxycast_agent::subagent_scheduler::{
    ProxyCastSubAgentExecutor, SchedulerEventEmitter, SubAgentProgressEvent, SubAgentRole,
};

/// ProxyCast SubAgent 调度器（Tauri 桥接）
pub struct ProxyCastScheduler {
    /// 内部纯逻辑调度器
    inner: proxycast_agent::subagent_scheduler::ProxyCastScheduler,
    /// Tauri AppHandle
    app_handle: Option<AppHandle>,
    /// 调度事件归属的会话 ID
    event_session_id: Option<String>,
}

impl ProxyCastScheduler {
    /// 创建新的调度器
    pub fn new(db: DbConnection) -> Self {
        Self {
            inner: proxycast_agent::subagent_scheduler::ProxyCastScheduler::new(db),
            app_handle: None,
            event_session_id: None,
        }
    }

    /// 设置 Tauri AppHandle
    pub fn with_app_handle(mut self, handle: AppHandle) -> Self {
        self.app_handle = Some(handle);
        self
    }

    /// 绑定调度事件的会话 ID
    pub fn with_event_session_id(mut self, session_id: impl Into<String>) -> Self {
        let normalized = session_id.into();
        self.event_session_id = (!normalized.trim().is_empty()).then_some(normalized);
        self
    }

    /// 设置默认角色
    pub fn with_default_role(mut self, role: SubAgentRole) -> Self {
        self.inner = self.inner.with_default_role(role);
        self
    }

    /// 初始化调度器
    pub async fn init(&self, config: Option<SchedulerConfig>) {
        let event_session_id = self.event_session_id.clone();
        let event_emitter = self.app_handle.clone().map(|handle| {
            Arc::new(move |event: &serde_json::Value| {
                let payload = enrich_scheduler_event_payload(event, event_session_id.as_deref());
                if let Err(err) = handle.emit("subagent-scheduler-event", payload) {
                    tracing::warn!("发送 Tauri 事件失败: {}", err);
                }
            }) as SchedulerEventEmitter
        });

        self.inner
            .init_with_event_emitter(config, event_emitter)
            .await;
    }

    /// 执行任务
    pub async fn execute(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        self.inner.execute(tasks, parent_context).await
    }

    /// 使用指定角色执行任务
    pub async fn execute_with_role(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
        role: SubAgentRole,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        self.inner
            .execute_with_role(tasks, parent_context, role)
            .await
    }

    /// 取消执行
    pub async fn cancel(&self) {
        self.inner.cancel().await;
    }
}

fn enrich_scheduler_event_payload(
    event: &serde_json::Value,
    session_id: Option<&str>,
) -> serde_json::Value {
    let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return event.clone();
    };

    match event {
        serde_json::Value::Object(map) => {
            let mut next = map.clone();
            next.insert(
                "sessionId".to_string(),
                serde_json::Value::String(session_id.to_string()),
            );
            serde_json::Value::Object(next)
        }
        other => serde_json::json!({
            "type": "unknown",
            "payload": other,
            "sessionId": session_id,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::enrich_scheduler_event_payload;

    #[test]
    fn should_append_session_id_for_object_event() {
        let payload = serde_json::json!({
            "type": "started",
            "totalTasks": 1,
        });

        let enriched = enrich_scheduler_event_payload(&payload, Some("session-a"));

        assert_eq!(enriched["type"], serde_json::json!("started"));
        assert_eq!(enriched["sessionId"], serde_json::json!("session-a"));
    }

    #[test]
    fn should_keep_original_event_when_session_id_missing() {
        let payload = serde_json::json!({
            "type": "completed",
            "success": true,
        });

        let enriched = enrich_scheduler_event_payload(&payload, None);

        assert_eq!(enriched, payload);
    }
}
