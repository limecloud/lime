//! Agent Task Executor
//!
//! 负责执行调度任务。

use super::types::ScheduledTask;
use async_trait::async_trait;
use lime_agent::credential_bridge::CredentialBridge;
#[cfg(test)]
use lime_agent::request_tool_policy::REQUEST_TOOL_POLICY_MARKER;
use lime_agent::request_tool_policy::{
    merge_system_prompt_with_request_tool_policy, resolve_request_tool_policy,
    stream_reply_with_policy,
};
use lime_agent::{merge_system_prompt_with_runtime_agents, AsterAgentState, SessionConfigBuilder};
use lime_core::database::DbConnection;
use serde_json::Value;
use std::sync::Arc;

/// 任务执行器 Trait
#[async_trait]
pub trait TaskExecutor: Send + Sync {
    /// 执行任务
    ///
    /// # 参数
    /// - `task`: 要执行的任务
    /// - `db`: 数据库连接
    ///
    /// # 返回
    /// - 成功返回执行结果（JSON 格式）
    /// - 失败返回错误信息
    async fn execute(
        &self,
        task: &ScheduledTask,
        db: &DbConnection,
    ) -> Result<serde_json::Value, String>;
}

/// Agent 任务执行器
///
/// 通过 CredentialBridge 选择凭证，调用 Aster Agent 执行任务
pub struct AgentExecutor {
    credential_bridge: Arc<CredentialBridge>,
}

impl AgentExecutor {
    /// 创建新的执行器实例
    pub fn new() -> Self {
        Self {
            credential_bridge: Arc::new(CredentialBridge::new()),
        }
    }

    /// 使用自定义的 CredentialBridge 创建执行器
    pub fn with_credential_bridge(credential_bridge: Arc<CredentialBridge>) -> Self {
        Self { credential_bridge }
    }
}

impl Default for AgentExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TaskExecutor for AgentExecutor {
    async fn execute(
        &self,
        task: &ScheduledTask,
        db: &DbConnection,
    ) -> Result<serde_json::Value, String> {
        tracing::info!(
            "[AgentExecutor] 开始执行任务: {} (类型: {}, provider: {}, model: {})",
            task.name,
            task.task_type,
            task.provider_type,
            task.model
        );

        // 1. 从凭证池选择凭证
        let aster_config = self
            .credential_bridge
            .select_and_configure(db, &task.provider_type, &task.model)
            .await
            .map_err(|e| format!("选择凭证失败: {e}"))?;

        tracing::info!(
            "[AgentExecutor] 已选择凭证: {} (provider: {}, model: {})",
            aster_config.credential_uuid,
            aster_config.provider_name,
            aster_config.model_name
        );

        // 2. 根据任务类型执行不同的操作
        let result = match task.task_type.as_str() {
            "agent_chat" => {
                // 执行 Agent 对话任务
                self.execute_agent_chat(task, db, &aster_config).await?
            }
            "scheduled_report" => {
                // 执行定时报告任务
                self.execute_scheduled_report(task, db, &aster_config)
                    .await?
            }
            _ => {
                return Err(format!("不支持的任务类型: {}", task.task_type));
            }
        };

        // 3. 标记凭证为健康
        if let Err(e) = self.credential_bridge.mark_healthy(
            db,
            &aster_config.credential_uuid,
            Some(&task.model),
        ) {
            tracing::warn!("[AgentExecutor] 标记凭证健康失败: {}", e);
        }

        tracing::info!("[AgentExecutor] 任务执行成功: {}", task.name);
        Ok(result)
    }
}

impl AgentExecutor {
    fn resolve_agent_session_id(task: &ScheduledTask) -> String {
        task.params
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| id.to_string())
            .unwrap_or_else(|| format!("scheduler-agent-chat-{}", task.id))
    }

    fn resolve_bool_param(task: &ScheduledTask, key: &str) -> Option<bool> {
        let value = task.params.get(key)?;
        match value {
            Value::Bool(flag) => Some(*flag),
            Value::String(raw) => match raw.trim().to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" | "on" => Some(true),
                "false" | "0" | "no" | "off" => Some(false),
                _ => None,
            },
            Value::Number(number) => number.as_i64().map(|v| v != 0),
            _ => None,
        }
    }

    fn resolve_system_prompt(task: &ScheduledTask) -> Option<String> {
        task.params
            .get("system_prompt")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
    }

    /// 执行 Agent 对话任务
    async fn execute_agent_chat(
        &self,
        task: &ScheduledTask,
        db: &DbConnection,
        _aster_config: &lime_agent::credential_bridge::AsterProviderConfig,
    ) -> Result<serde_json::Value, String> {
        // 从任务参数中提取对话内容
        let prompt = task
            .params
            .get("prompt")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少 prompt 参数".to_string())?;

        tracing::info!("[AgentExecutor] 执行 Agent 对话: {}", prompt);

        let session_id = Self::resolve_agent_session_id(task);
        let request_tool_policy =
            resolve_request_tool_policy(Self::resolve_bool_param(task, "web_search"), false);
        let merged_system_prompt = merge_system_prompt_with_request_tool_policy(
            merge_system_prompt_with_runtime_agents(Self::resolve_system_prompt(task), None),
            &request_tool_policy,
        );
        // 对齐主对话入口：执行前刷新一次 Skills 注册，避免运行期安装/更新后不可见。
        AsterAgentState::reload_lime_skills();
        tracing::info!(
            "[AgentExecutor] agent_chat 会话策略: session={} web_search={} system_prompt={}",
            session_id,
            request_tool_policy.effective_web_search,
            if merged_system_prompt.is_some() {
                "provided"
            } else {
                "none"
            }
        );

        let state = AsterAgentState::new();
        state
            .configure_provider_from_pool(db, &task.provider_type, &task.model, &session_id)
            .await
            .map_err(|e| format!("配置 Agent Provider 失败: {e}"))?;

        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or_else(|| "Agent 未初始化".to_string())?;
        let available_tools = {
            let registry = agent.tool_registry().read().await;
            registry
                .get_definitions()
                .iter()
                .map(|definition| definition.name.clone())
                .collect::<Vec<_>>()
        };
        tracing::info!(
            "[AgentExecutor] 当前可用工具({}): {}",
            available_tools.len(),
            available_tools.join(", ")
        );

        let mut session_builder = SessionConfigBuilder::new(&session_id);
        if let Some(system_prompt) = merged_system_prompt {
            session_builder = session_builder.system_prompt(system_prompt);
        }
        let session_config = session_builder.build();
        let execution = stream_reply_with_policy(
            agent,
            prompt,
            None,
            session_config,
            None,
            &request_tool_policy,
            |event| match event {
                lime_agent::TauriAgentEvent::ToolStart {
                    tool_name, tool_id, ..
                } => {
                    tracing::info!(
                        "[AgentExecutor] 工具调用开始: {} (tool_id={})",
                        tool_name,
                        tool_id
                    );
                }
                lime_agent::TauriAgentEvent::ToolEnd { tool_id, result } => {
                    tracing::info!(
                        "[AgentExecutor] 工具调用结束: tool_id={} success={}",
                        tool_id,
                        result.success
                    );
                }
                _ => {}
            },
        )
        .await
        .map_err(|error| {
            format!(
                "Agent 执行失败: {} (emitted_any={})",
                error.message, error.emitted_any
            )
        })?;

        let response = execution.text_output;
        if response.trim().is_empty() {
            if let Some(last_error) = execution.event_errors.last() {
                return Err(format!("Agent 未返回有效文本输出: {last_error}"));
            }
            return Err("Agent 未返回有效文本输出".to_string());
        }

        Ok(serde_json::json!({
            "type": "agent_chat",
            "prompt": prompt,
            "response": response,
            "status": "success"
        }))
    }

    /// 执行定时报告任务
    async fn execute_scheduled_report(
        &self,
        task: &ScheduledTask,
        _db: &DbConnection,
        _aster_config: &lime_agent::credential_bridge::AsterProviderConfig,
    ) -> Result<serde_json::Value, String> {
        let report_type = task
            .params
            .get("report_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少 report_type 参数".to_string())?;

        tracing::info!("[AgentExecutor] 生成定时报告: {}", report_type);

        // TODO: 实际生成报告逻辑
        Ok(serde_json::json!({
            "type": "scheduled_report",
            "report_type": report_type,
            "generated_at": chrono::Utc::now().to_rfc3339(),
            "status": "success"
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn test_executor_creation() {
        let executor = AgentExecutor::new();
        assert!(Arc::strong_count(&executor.credential_bridge) >= 1);
    }

    #[tokio::test]
    async fn test_execute_agent_chat_missing_prompt() {
        let executor = AgentExecutor::new();
        let db = setup_test_db();

        let task = ScheduledTask::new(
            "Test".to_string(),
            "agent_chat".to_string(),
            serde_json::json!({}), // 缺少 prompt
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        // 由于缺少凭证池数据，这里会在选择凭证时失败
        // 但我们可以测试参数验证逻辑
        let result = executor.execute(&task, &db).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_unsupported_task_type() {
        let executor = AgentExecutor::new();
        let db = setup_test_db();

        let task = ScheduledTask::new(
            "Test".to_string(),
            "unsupported_type".to_string(),
            serde_json::json!({}),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        let result = executor.execute(&task, &db).await;
        assert!(result.is_err());
        // 测试环境无凭证，会在凭证选择阶段失败
        let err = result.unwrap_err();
        assert!(
            err.contains("不支持的任务类型") || err.contains("选择凭证失败"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn test_resolve_bool_param_supports_string_and_bool() {
        let task = ScheduledTask::new(
            "bool-test".to_string(),
            "agent_chat".to_string(),
            serde_json::json!({
                "prompt": "hello",
                "web_search": "true",
                "feature_flag": false
            }),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );
        assert_eq!(
            AgentExecutor::resolve_bool_param(&task, "web_search"),
            Some(true)
        );
        assert_eq!(
            AgentExecutor::resolve_bool_param(&task, "feature_flag"),
            Some(false)
        );
    }

    #[test]
    fn test_merge_system_prompt_with_web_search_policy() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged =
            merge_system_prompt_with_request_tool_policy(Some("你是助手".to_string()), &policy)
                .expect("merged prompt should exist");
        assert!(merged.contains("你是助手"));
        assert!(merged.contains(REQUEST_TOOL_POLICY_MARKER));
        assert!(merged.contains("WebSearch"));
    }
}
