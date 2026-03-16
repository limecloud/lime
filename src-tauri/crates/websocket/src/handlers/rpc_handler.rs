//! RPC 处理器
//!
//! 处理 Gateway RPC 请求，集成 Agent 和 Scheduler

use super::super::{protocol::*, WsError};
use chrono::{DateTime, Timelike, Utc};
use proxycast_core::database::dao::agent_run::{AgentRun, AgentRunDao, AgentRunStatus};
use proxycast_core::database::dao::chat::{ChatDao, ChatMessage, ChatMode, ChatSession};
use proxycast_scheduler::{
    AgentExecutor, AgentScheduler, ScheduledTask, SchedulerDao, TaskExecutor, TaskFilter,
    DEFAULT_TASK_COOLDOWN_SECS, DEFAULT_TASK_FAILURE_THRESHOLD,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration, Instant};
use uuid::Uuid;

const DEFAULT_HEALTH_RUNNING_TIMEOUT_MINUTES: u64 = 20;
const DEFAULT_HEALTH_TOP_LIMIT: usize = 10;
const MAX_HEALTH_TOP_LIMIT: usize = 50;
const DEFAULT_COOLDOWN_ALERT_THRESHOLD: usize = 1;
const DEFAULT_STALE_RUNNING_ALERT_THRESHOLD: usize = 1;
const DEFAULT_FAILED_24H_ALERT_THRESHOLD: usize = 5;

/// RPC 处理器状态
#[derive(Clone)]
pub struct RpcHandlerState {
    /// 数据库连接
    pub db: Arc<RwLock<Option<proxycast_core::database::DbConnection>>>,
    /// Agent 调度器（可选）
    pub scheduler: Arc<RwLock<Option<proxycast_agent::ProxyCastScheduler>>>,
    /// 日志存储
    pub logs: Arc<RwLock<proxycast_core::LogStore>>,
    /// 活跃运行任务（支持 agent.stop）
    pub active_runs: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl RpcHandlerState {
    /// 创建新的 RPC 处理器状态
    pub fn new(
        db: Option<proxycast_core::database::DbConnection>,
        scheduler: Option<proxycast_agent::ProxyCastScheduler>,
        logs: Arc<RwLock<proxycast_core::LogStore>>,
    ) -> Self {
        Self {
            db: Arc::new(RwLock::new(db)),
            scheduler: Arc::new(RwLock::new(scheduler)),
            logs,
            active_runs: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

/// RPC 处理器
pub struct RpcHandler {
    state: RpcHandlerState,
}

impl RpcHandler {
    /// 创建新的 RPC 处理器
    pub fn new(state: RpcHandlerState) -> Self {
        Self { state }
    }

    /// 处理 RPC 请求
    pub async fn handle_request(&self, request: GatewayRpcRequest) -> GatewayRpcResponse {
        let method = request.method;
        let request_id = request.id.clone();
        let params = request.params;

        // 记录请求
        self.state.logs.write().await.add(
            "info",
            &format!("[RPC] Request: id={} method={:?}", request_id, method),
        );

        // 路由到具体的处理方法
        let result = match method {
            RpcMethod::AgentRun => self.handle_agent_run(params).await,
            RpcMethod::AgentWait => self.handle_agent_wait(params).await,
            RpcMethod::AgentStop => self.handle_agent_stop(params).await,
            RpcMethod::SessionsList => self.handle_sessions_list().await,
            RpcMethod::SessionsGet => self.handle_sessions_get(params).await,
            RpcMethod::CronList => self.handle_cron_list().await,
            RpcMethod::CronRun => self.handle_cron_run(params).await,
            RpcMethod::CronHealth => self.handle_cron_health(params).await,
        };

        match result {
            Ok(data) => GatewayRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request_id,
                result: Some(data),
                error: None,
            },
            Err(err) => {
                self.state.logs.write().await.add(
                    "error",
                    &format!("[RPC] Error: id={} error={}", request_id, err.message),
                );
                GatewayRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request_id,
                    result: None,
                    error: Some(err),
                }
            }
        }
    }

    /// 处理 agent.run
    async fn handle_agent_run(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let params: AgentRunParams = params
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(|| {
                RpcError::invalid_params("Missing or invalid parameters for agent.run")
            })?;
        let message = params.message.trim().to_string();
        if message.is_empty() {
            return Err(RpcError::invalid_params(
                "agent.run message cannot be empty",
            ));
        }
        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;

        let run_id = Uuid::new_v4().to_string();
        let session_id = params
            .session_id
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        self.ensure_session_and_append_user_message(
            &db,
            &session_id,
            &message,
            params.model.as_deref(),
            params.system_prompt.as_deref(),
        )
        .map_err(|e| RpcError::internal_error(e.message.clone()))?;

        let start_metadata = json!({
            "trigger": "websocket_rpc",
            "message": message,
            "stream": params.stream,
            "model": params.model.clone(),
            "web_search": params.web_search,
        });
        self.create_run_record(
            &db,
            &run_id,
            "chat",
            Some("agent.run".to_string()),
            Some(session_id.clone()),
            Some(start_metadata),
        )
        .map_err(|e| RpcError::internal_error(e.message))?;

        let run_id_for_task = run_id.clone();
        let session_id_for_task = session_id.clone();
        let message_for_task = message.clone();
        let raw_model_for_task = params
            .model
            .clone()
            .unwrap_or_else(|| "claude-sonnet-4-5".to_string());
        let (provider_type_for_task, model_for_task) =
            resolve_provider_and_model(&raw_model_for_task);
        let active_runs = self.state.active_runs.clone();
        let logs_for_task = self.state.logs.clone();
        let db_for_task = db.clone();
        let handle = tokio::spawn(async move {
            let started_ms = Utc::now().timestamp_millis();
            logs_for_task.write().await.add(
                "info",
                &format!(
                    "[RPC] agent.run dispatch: run_id={} raw_model={} resolved_model={} provider={} web_search={}",
                    run_id_for_task,
                    raw_model_for_task,
                    model_for_task,
                    provider_type_for_task,
                    params.web_search.unwrap_or(false)
                ),
            );
            let mut task_params = json!({
                "prompt": message_for_task,
                "session_id": session_id_for_task,
            });
            if let Some(web_search) = params.web_search {
                task_params["web_search"] = serde_json::Value::Bool(web_search);
            }
            if let Some(system_prompt) = params.system_prompt.as_deref() {
                let trimmed = system_prompt.trim();
                if !trimmed.is_empty() {
                    task_params["system_prompt"] = serde_json::Value::String(trimmed.to_string());
                }
            }
            let mut task = ScheduledTask::new(
                format!("rpc-agent-run-{}", &run_id_for_task[..8]),
                "agent_chat".to_string(),
                task_params,
                provider_type_for_task,
                model_for_task,
                Utc::now(),
            );
            task.description = Some("WebSocket RPC agent.run".to_string());

            let executor = AgentExecutor::new();
            match executor.execute(&task, &db_for_task).await {
                Ok(result) => {
                    let content = extract_result_content(&result);
                    let _ = append_assistant_message(&db_for_task, &session_id_for_task, &content);
                    finalize_run(
                        &db_for_task,
                        &run_id_for_task,
                        started_ms,
                        AgentRunStatus::Success,
                        None,
                        None,
                        Some(json!({
                            "content": content,
                            "result": result,
                        })),
                    );
                }
                Err(error) => {
                    let error_content = format!("执行失败: {error}");
                    let _ = append_assistant_message(
                        &db_for_task,
                        &session_id_for_task,
                        &error_content,
                    );
                    finalize_run(
                        &db_for_task,
                        &run_id_for_task,
                        started_ms,
                        AgentRunStatus::Error,
                        Some("agent_run_failed"),
                        Some(error_content.as_str()),
                        Some(json!({
                            "content": error_content,
                        })),
                    );
                }
            }
            active_runs.write().await.remove(&run_id_for_task);
        });
        self.state
            .active_runs
            .write()
            .await
            .insert(run_id.clone(), handle);

        let result = AgentRunResult {
            run_id,
            session_id,
            completed: false,
            content: None,
            usage: None,
        };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    /// 处理 agent.wait
    async fn handle_agent_wait(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let params: AgentWaitParams = params
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(|| {
                RpcError::invalid_params("Missing or invalid parameters for agent.wait")
            })?;
        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;
        let timeout_ms = params.timeout.max(100);
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let run_id = params.run_id;

        loop {
            let run = self
                .get_run_by_id(&db, &run_id)
                .map_err(|e| RpcError::internal_error(e.message.clone()))?
                .ok_or_else(|| RpcError::invalid_params(format!("run not found: {run_id}")))?;

            if run.status.is_terminal() {
                let content = resolve_wait_content(&run);
                let usage = parse_usage_from_metadata(run.metadata.as_deref());
                let result = AgentWaitResult {
                    run_id,
                    completed: true,
                    content,
                    usage,
                };
                return serde_json::to_value(result)
                    .map_err(|e| RpcError::internal_error(e.to_string()));
            }

            if Instant::now() >= deadline {
                let result = AgentWaitResult {
                    run_id,
                    completed: false,
                    content: None,
                    usage: None,
                };
                return serde_json::to_value(result)
                    .map_err(|e| RpcError::internal_error(e.to_string()));
            }

            sleep(Duration::from_millis(120)).await;
        }
    }

    /// 处理 agent.stop
    async fn handle_agent_stop(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let params: AgentStopParams = params
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(|| {
                RpcError::invalid_params("Missing or invalid parameters for agent.stop")
            })?;
        let run_id = params.run_id;
        let stopped = if let Some(handle) = self.state.active_runs.write().await.remove(&run_id) {
            handle.abort();
            true
        } else {
            false
        };

        if stopped {
            if let Ok(db) = self.require_db().await {
                finish_run_with_status(
                    &db,
                    &run_id,
                    AgentRunStatus::Canceled,
                    Some("agent_run_canceled"),
                    Some("Run canceled by client"),
                    Some(json!({ "canceled_by": "agent.stop" })),
                );
            }
        }

        let result = AgentStopResult { run_id, stopped };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    /// 处理 sessions.list
    async fn handle_sessions_list(&self) -> Result<serde_json::Value, RpcError> {
        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;
        let conn = proxycast_core::database::lock_db(&db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        let raw_sessions = ChatDao::list_sessions(&conn, Some(ChatMode::Agent))
            .map_err(|e| RpcError::internal_error(format!("load sessions failed: {e}")))?;

        let sessions: Vec<SessionInfo> = raw_sessions
            .into_iter()
            .map(|item| {
                let message_count = ChatDao::get_message_count(&conn, &item.id).unwrap_or(0);
                SessionInfo {
                    session_id: item.id,
                    model: item.model.unwrap_or_else(|| "default".to_string()),
                    message_count,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                }
            })
            .collect();

        let result = SessionsListResult { sessions };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    /// 处理 sessions.get
    async fn handle_sessions_get(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let params: SessionGetParams = params
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(|| {
                RpcError::invalid_params("Missing or invalid parameters for sessions.get")
            })?;
        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;
        let conn = proxycast_core::database::lock_db(&db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        let detail = ChatDao::get_session_detail(&conn, &params.session_id, None)
            .map_err(|e| RpcError::internal_error(format!("load session detail failed: {e}")))?;
        let detail = detail.ok_or_else(|| {
            RpcError::invalid_params(format!("session not found: {}", params.session_id))
        })?;

        let result = SessionGetResult {
            session_id: detail.session.id,
            model: detail
                .session
                .model
                .unwrap_or_else(|| "default".to_string()),
            system_prompt: detail.session.system_prompt,
            message_count: detail.message_count,
            created_at: detail.session.created_at,
            updated_at: detail.session.updated_at,
        };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    /// 处理 cron.list
    async fn handle_cron_list(&self) -> Result<serde_json::Value, RpcError> {
        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;
        AgentScheduler::init_tables(&db)
            .map_err(|e| RpcError::internal_error(format!("init cron tables failed: {e}")))?;
        let conn = proxycast_core::database::lock_db(&db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        let raw_tasks = SchedulerDao::list_tasks(
            &conn,
            &TaskFilter {
                limit: Some(200),
                ..TaskFilter::default()
            },
        )
        .map_err(|e| RpcError::internal_error(format!("load cron tasks failed: {e}")))?;

        let tasks: Vec<CronTaskInfo> = raw_tasks
            .into_iter()
            .map(|item| {
                let enabled = item.status != proxycast_scheduler::TaskStatus::Cancelled
                    && !item.is_in_cooldown();
                let next_run = if item.status == proxycast_scheduler::TaskStatus::Pending {
                    Some(item.scheduled_at.clone())
                } else {
                    None
                };
                CronTaskInfo {
                    task_id: item.id,
                    name: item.name,
                    schedule: item.scheduled_at,
                    enabled,
                    last_run: item.completed_at,
                    next_run,
                }
            })
            .collect();

        let result = CronListResult { tasks };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    /// 处理 cron.run
    async fn handle_cron_run(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let params: CronRunParams = params
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(|| {
                RpcError::invalid_params("Missing or invalid parameters for cron.run")
            })?;
        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;
        AgentScheduler::init_tables(&db)
            .map_err(|e| RpcError::internal_error(format!("init cron tables failed: {e}")))?;
        let execution_id = Uuid::new_v4().to_string();
        let task = {
            let conn = proxycast_core::database::lock_db(&db)
                .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
            SchedulerDao::get_task(&conn, &params.task_id)
                .map_err(|e| RpcError::internal_error(format!("load task failed: {e}")))?
        }
        .ok_or_else(|| RpcError::invalid_params(format!("task not found: {}", params.task_id)))?;
        if task.is_in_cooldown() {
            let until = task
                .auto_disabled_until
                .clone()
                .unwrap_or_else(|| "未知时间".to_string());
            return Err(RpcError::invalid_params(format!(
                "task is in cooldown until {until}"
            )));
        }

        self.create_run_record(
            &db,
            &execution_id,
            "automation",
            Some(task.id.clone()),
            None,
            Some(json!({
                "trigger": "websocket_rpc",
                "task_id": task.id,
                "task_name": task.name,
            })),
        )
        .map_err(|e| RpcError::internal_error(e.message))?;

        let db_for_task = db.clone();
        let run_id_for_task = execution_id.clone();
        let task_id_for_task = task.id.clone();
        let active_runs = self.state.active_runs.clone();
        let handle = tokio::spawn(async move {
            let started_ms = Utc::now().timestamp_millis();
            let mut task_to_run = task;
            if mark_task_running(&db_for_task, &mut task_to_run).is_err() {
                finalize_run(
                    &db_for_task,
                    &run_id_for_task,
                    started_ms,
                    AgentRunStatus::Error,
                    Some("cron_task_state_failed"),
                    Some("Failed to mark task running"),
                    None,
                );
                active_runs.write().await.remove(&run_id_for_task);
                return;
            }

            let executor = AgentExecutor::new();
            match executor.execute(&task_to_run, &db_for_task).await {
                Ok(result) => {
                    let _ = mark_task_completed(&db_for_task, &mut task_to_run, result.clone());
                    finalize_run(
                        &db_for_task,
                        &run_id_for_task,
                        started_ms,
                        AgentRunStatus::Success,
                        None,
                        None,
                        Some(json!({
                            "task_id": task_id_for_task,
                            "result": result,
                        })),
                    );
                }
                Err(error) => {
                    let _ = mark_task_failed(&db_for_task, &mut task_to_run, error.clone());
                    finalize_run(
                        &db_for_task,
                        &run_id_for_task,
                        started_ms,
                        AgentRunStatus::Error,
                        Some("cron_task_execute_failed"),
                        Some(error.as_str()),
                        Some(json!({
                            "task_id": task_id_for_task,
                        })),
                    );
                }
            }
            active_runs.write().await.remove(&run_id_for_task);
        });
        self.state
            .active_runs
            .write()
            .await
            .insert(execution_id.clone(), handle);

        let result = CronRunResult {
            task_id: params.task_id,
            execution_id,
            started: true,
        };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    /// 处理 cron.health
    async fn handle_cron_health(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, RpcError> {
        let params = match params {
            Some(value) => serde_json::from_value::<CronHealthParams>(value).map_err(|_| {
                RpcError::invalid_params("Missing or invalid parameters for cron.health")
            })?,
            None => CronHealthParams::default(),
        };

        let running_timeout_minutes = params
            .running_timeout_minutes
            .unwrap_or(DEFAULT_HEALTH_RUNNING_TIMEOUT_MINUTES)
            .clamp(5, 24 * 60);
        let top_limit = params
            .top_limit
            .unwrap_or(DEFAULT_HEALTH_TOP_LIMIT)
            .clamp(1, MAX_HEALTH_TOP_LIMIT);
        let cooldown_alert_threshold = params
            .cooldown_alert_threshold
            .unwrap_or(DEFAULT_COOLDOWN_ALERT_THRESHOLD)
            .max(1);
        let stale_running_alert_threshold = params
            .stale_running_alert_threshold
            .unwrap_or(DEFAULT_STALE_RUNNING_ALERT_THRESHOLD)
            .max(1);
        let failed_24h_alert_threshold = params
            .failed_24h_alert_threshold
            .unwrap_or(DEFAULT_FAILED_24H_ALERT_THRESHOLD)
            .max(1);

        let db = self
            .require_db()
            .await
            .map_err(|e| RpcError::internal_error(e.message))?;
        AgentScheduler::init_tables(&db)
            .map_err(|e| RpcError::internal_error(format!("init cron tables failed: {e}")))?;
        let conn = proxycast_core::database::lock_db(&db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        let tasks = SchedulerDao::list_tasks(&conn, &TaskFilter::default())
            .map_err(|e| RpcError::internal_error(format!("load cron tasks failed: {e}")))?;

        let now = Utc::now();
        let stale_deadline = now - chrono::Duration::minutes(running_timeout_minutes as i64);
        let mut pending_tasks = 0usize;
        let mut running_tasks = 0usize;
        let mut completed_tasks = 0usize;
        let mut failed_tasks = 0usize;
        let mut cancelled_tasks = 0usize;
        let mut cooldown_tasks = 0usize;
        let mut stale_running_tasks = 0usize;

        for task in &tasks {
            match task.status {
                proxycast_scheduler::TaskStatus::Pending => pending_tasks += 1,
                proxycast_scheduler::TaskStatus::Running => running_tasks += 1,
                proxycast_scheduler::TaskStatus::Completed => completed_tasks += 1,
                proxycast_scheduler::TaskStatus::Failed => failed_tasks += 1,
                proxycast_scheduler::TaskStatus::Cancelled => cancelled_tasks += 1,
            }

            if task.is_in_cooldown() {
                cooldown_tasks += 1;
            }

            if task.status == proxycast_scheduler::TaskStatus::Running {
                if let Some(started_at) = task.started_at.as_deref().and_then(parse_rfc3339_utc) {
                    if started_at < stale_deadline {
                        stale_running_tasks += 1;
                    }
                }
            }
        }

        let end_hour = floor_to_hour(now);
        let start_hour = end_hour - chrono::Duration::hours(23);
        let failure_rows = {
            let mut stmt = conn
                .prepare(
                    "SELECT status, started_at
                     FROM agent_runs
                     WHERE source = 'automation'
                       AND status IN ('error', 'timeout')
                       AND datetime(started_at) >= datetime(?1)",
                )
                .map_err(|e| {
                    RpcError::internal_error(format!("prepare failure trend query failed: {e}"))
                })?;
            let rows = stmt
                .query_map([start_hour.to_rfc3339()], |row| {
                    let status: String = row.get(0)?;
                    let started_at: String = row.get(1)?;
                    Ok((status, started_at))
                })
                .map_err(|e| {
                    RpcError::internal_error(format!("query failure trend failed: {e}"))
                })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| {
                RpcError::internal_error(format!("collect failure trend rows failed: {e}"))
            })?
        };
        let failure_trend_24h = build_failure_trend_24h(failure_rows, now);
        let failed_last_24h = failure_trend_24h
            .iter()
            .map(|item| item.error_count + item.timeout_count)
            .sum();

        let mut risky_tasks = tasks
            .iter()
            .filter(|task| {
                task.is_in_cooldown()
                    || task.consecutive_failures > 0
                    || task.status == proxycast_scheduler::TaskStatus::Failed
            })
            .map(|task| CronRiskTaskInfo {
                task_id: task.id.clone(),
                name: task.name.clone(),
                status: task.status.to_string(),
                consecutive_failures: task.consecutive_failures,
                retry_count: task.retry_count,
                auto_disabled_until: task.auto_disabled_until.clone(),
                updated_at: task.updated_at.clone(),
            })
            .collect::<Vec<_>>();

        risky_tasks.sort_by(|a, b| {
            let b_cooldown = b.auto_disabled_until.is_some();
            let a_cooldown = a.auto_disabled_until.is_some();
            b_cooldown
                .cmp(&a_cooldown)
                .then_with(|| b.consecutive_failures.cmp(&a.consecutive_failures))
                .then_with(|| b.retry_count.cmp(&a.retry_count))
                .then_with(|| {
                    parse_rfc3339_utc(&b.updated_at).cmp(&parse_rfc3339_utc(&a.updated_at))
                })
        });
        risky_tasks.truncate(top_limit);
        let alerts = build_cron_health_alerts(
            cooldown_tasks,
            stale_running_tasks,
            failed_last_24h,
            cooldown_alert_threshold,
            stale_running_alert_threshold,
            failed_24h_alert_threshold,
        );

        let result = CronHealthResult {
            total_tasks: tasks.len(),
            pending_tasks,
            running_tasks,
            completed_tasks,
            failed_tasks,
            cancelled_tasks,
            cooldown_tasks,
            stale_running_tasks,
            failed_last_24h,
            failure_trend_24h,
            alerts,
            top_risky_tasks: risky_tasks,
            generated_at: now.to_rfc3339(),
        };

        Ok(serde_json::to_value(result).map_err(|e| RpcError::internal_error(e.to_string()))?)
    }

    async fn require_db(&self) -> Result<proxycast_core::database::DbConnection, RpcError> {
        self.state
            .db
            .read()
            .await
            .clone()
            .ok_or_else(|| RpcError::internal_error("database not initialized"))
    }

    fn create_run_record(
        &self,
        db: &proxycast_core::database::DbConnection,
        run_id: &str,
        source: &str,
        source_ref: Option<String>,
        session_id: Option<String>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(), RpcError> {
        let now = Utc::now().to_rfc3339();
        let run = AgentRun {
            id: run_id.to_string(),
            source: source.to_string(),
            source_ref,
            session_id,
            status: AgentRunStatus::Running,
            started_at: now.clone(),
            finished_at: None,
            duration_ms: None,
            error_code: None,
            error_message: None,
            metadata: metadata.map(|value| value.to_string()),
            created_at: now.clone(),
            updated_at: now,
        };
        let conn = proxycast_core::database::lock_db(db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        AgentRunDao::create_run(&conn, &run)
            .map_err(|e| RpcError::internal_error(format!("create run failed: {e}")))
    }

    fn get_run_by_id(
        &self,
        db: &proxycast_core::database::DbConnection,
        run_id: &str,
    ) -> Result<Option<AgentRun>, RpcError> {
        let conn = proxycast_core::database::lock_db(db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        AgentRunDao::get_run(&conn, run_id)
            .map_err(|e| RpcError::internal_error(format!("query run failed: {e}")))
    }

    fn ensure_session_and_append_user_message(
        &self,
        db: &proxycast_core::database::DbConnection,
        session_id: &str,
        message: &str,
        model: Option<&str>,
        system_prompt: Option<&str>,
    ) -> Result<(), RpcError> {
        let now = Utc::now().to_rfc3339();
        let conn = proxycast_core::database::lock_db(db)
            .map_err(|e| RpcError::internal_error(format!("DB lock failed: {e}")))?;
        let exists = ChatDao::session_exists(&conn, session_id)
            .map_err(|e| RpcError::internal_error(format!("check session failed: {e}")))?;
        if !exists {
            let title = message
                .chars()
                .take(40)
                .collect::<String>()
                .trim()
                .to_string();
            let session = ChatSession {
                id: session_id.to_string(),
                mode: ChatMode::Agent,
                title: if title.is_empty() { None } else { Some(title) },
                system_prompt: system_prompt.map(|v| v.to_string()),
                model: model.map(|v| v.to_string()),
                provider_type: None,
                credential_uuid: None,
                metadata: Some(json!({ "source": "websocket_rpc" })),
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            ChatDao::create_session(&conn, &session)
                .map_err(|e| RpcError::internal_error(format!("create session failed: {e}")))?;
        }

        let user_message = ChatMessage {
            id: 0,
            session_id: session_id.to_string(),
            role: "user".to_string(),
            content: text_content(message),
            tool_calls: None,
            tool_call_id: None,
            metadata: None,
            created_at: now,
        };
        ChatDao::add_message(&conn, &user_message)
            .map_err(|e| RpcError::internal_error(format!("append user message failed: {e}")))?;
        Ok(())
    }
}

/// 从 WsMessage 解析 RPC 请求
pub fn parse_rpc_request(msg: &str) -> Result<GatewayRpcRequest, RpcError> {
    serde_json::from_str(msg).map_err(|e| RpcError::parse_error(format!("Invalid JSON: {}", e)))
}

/// 序列化 RPC 响应
pub fn serialize_rpc_response(resp: &GatewayRpcResponse) -> Result<String, WsError> {
    serde_json::to_string(resp)
        .map_err(|e| WsError::internal(None, format!("Failed to serialize response: {}", e)))
}

fn append_assistant_message(
    db: &proxycast_core::database::DbConnection,
    session_id: &str,
    content: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let conn = proxycast_core::database::lock_db(db)?;
    let assistant_message = ChatMessage {
        id: 0,
        session_id: session_id.to_string(),
        role: "assistant".to_string(),
        content: text_content(content),
        tool_calls: None,
        tool_call_id: None,
        metadata: None,
        created_at: now,
    };
    ChatDao::add_message(&conn, &assistant_message)
        .map_err(|e| format!("append assistant message failed: {e}"))?;
    Ok(())
}

fn text_content(text: &str) -> serde_json::Value {
    json!([{ "type": "text", "text": text }])
}

fn extract_result_content(result: &serde_json::Value) -> String {
    if let Some(text) = result.get("response").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    if let Some(text) = result.get("output").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    result.to_string()
}

fn parse_usage_from_metadata(metadata: Option<&str>) -> Option<TokenUsage> {
    let metadata = metadata?;
    let parsed: serde_json::Value = serde_json::from_str(metadata).ok()?;
    let usage = parsed.get("usage")?;
    Some(TokenUsage::new(
        usage.get("input_tokens")?.as_u64()? as u32,
        usage.get("output_tokens")?.as_u64()? as u32,
    ))
}

fn resolve_wait_content(run: &AgentRun) -> Option<String> {
    if matches!(run.status, AgentRunStatus::Success) {
        if let Some(metadata) = &run.metadata {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(metadata) {
                if let Some(content) = parsed.get("content").and_then(|value| value.as_str()) {
                    return Some(content.to_string());
                }
            }
        }
    }
    run.error_message.clone()
}

fn infer_provider_from_model(model: &str) -> String {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return "openai".to_string();
    }

    if let Some((provider_prefix, _)) = normalized.split_once('/') {
        let provider_prefix = provider_prefix.trim();
        if !provider_prefix.is_empty() && provider_prefix != "models" {
            return provider_prefix.to_string();
        }
    }

    if normalized.contains("claude") {
        return "anthropic".to_string();
    }
    if normalized.contains("gemini") {
        return "gemini".to_string();
    }
    if normalized.contains("qwen") {
        return "qwen".to_string();
    }
    if normalized.contains("glm") || normalized.contains("zhipu") {
        return "zhipuai".to_string();
    }
    if normalized.contains("gpt") || normalized.contains("o1") || normalized.contains("o3") {
        return "openai".to_string();
    }
    "openai".to_string()
}

fn resolve_provider_and_model(model: &str) -> (String, String) {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return ("openai".to_string(), String::new());
    }

    if let Some((provider_prefix, model_suffix)) = trimmed.split_once('/') {
        let provider_prefix = provider_prefix.trim().to_ascii_lowercase();
        let model_suffix = model_suffix.trim();
        if !provider_prefix.is_empty() && provider_prefix != "models" && !model_suffix.is_empty() {
            return (provider_prefix, model_suffix.to_string());
        }
    }

    (infer_provider_from_model(trimmed), trimmed.to_string())
}

fn finalize_run(
    db: &proxycast_core::database::DbConnection,
    run_id: &str,
    started_ms: i64,
    status: AgentRunStatus,
    error_code: Option<&str>,
    error_message: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    let finished_at = Utc::now();
    let duration_ms = finished_at.timestamp_millis().saturating_sub(started_ms);
    let finished_at_str = finished_at.to_rfc3339();
    if let Ok(conn) = proxycast_core::database::lock_db(db) {
        let _ = AgentRunDao::finish_run(
            &conn,
            run_id,
            status,
            &finished_at_str,
            Some(duration_ms),
            error_code,
            error_message,
            metadata.map(|value| value.to_string()).as_deref(),
        );
    }
}

fn finish_run_with_status(
    db: &proxycast_core::database::DbConnection,
    run_id: &str,
    status: AgentRunStatus,
    error_code: Option<&str>,
    error_message: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    if let Ok(conn) = proxycast_core::database::lock_db(db) {
        let now = Utc::now().to_rfc3339();
        let _ = AgentRunDao::finish_run(
            &conn,
            run_id,
            status,
            &now,
            None,
            error_code,
            error_message,
            metadata.map(|value| value.to_string()).as_deref(),
        );
    }
}

fn mark_task_running(
    db: &proxycast_core::database::DbConnection,
    task: &mut ScheduledTask,
) -> Result<(), String> {
    if task.is_in_cooldown() {
        let until = task
            .auto_disabled_until
            .clone()
            .unwrap_or_else(|| "未知时间".to_string());
        return Err(format!("task is in cooldown until {until}"));
    }
    task.mark_running();
    let conn = proxycast_core::database::lock_db(db)?;
    SchedulerDao::update_task(&conn, task).map_err(|e| format!("update task running failed: {e}"))
}

fn mark_task_completed(
    db: &proxycast_core::database::DbConnection,
    task: &mut ScheduledTask,
    result: serde_json::Value,
) -> Result<(), String> {
    task.mark_completed(Some(result));
    let conn = proxycast_core::database::lock_db(db)?;
    SchedulerDao::update_task(&conn, task).map_err(|e| format!("update task completed failed: {e}"))
}

fn mark_task_failed(
    db: &proxycast_core::database::DbConnection,
    task: &mut ScheduledTask,
    error: String,
) -> Result<(), String> {
    task.mark_failed(error);
    task.apply_failure_governance(DEFAULT_TASK_FAILURE_THRESHOLD, DEFAULT_TASK_COOLDOWN_SECS);
    let conn = proxycast_core::database::lock_db(db)?;
    SchedulerDao::update_task(&conn, task).map_err(|e| format!("update task failed failed: {e}"))
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn floor_to_hour(value: DateTime<Utc>) -> DateTime<Utc> {
    value
        .with_minute(0)
        .and_then(|v| v.with_second(0))
        .and_then(|v| v.with_nanosecond(0))
        .unwrap_or(value)
}

fn build_failure_trend_24h(
    rows: Vec<(String, String)>,
    now: DateTime<Utc>,
) -> Vec<CronFailureTrendPoint> {
    let end_hour = floor_to_hour(now);
    let start_hour = end_hour - chrono::Duration::hours(23);

    let mut trend = (0..24)
        .map(|offset| {
            let bucket_start = start_hour + chrono::Duration::hours(offset as i64);
            CronFailureTrendPoint {
                bucket_start: bucket_start.to_rfc3339(),
                label: bucket_start.format("%H:%M").to_string(),
                error_count: 0,
                timeout_count: 0,
            }
        })
        .collect::<Vec<_>>();

    for row in rows {
        let (status, started_at) = row;
        let Some(started_at_utc) = parse_rfc3339_utc(&started_at) else {
            continue;
        };
        let bucket_time = floor_to_hour(started_at_utc);
        if bucket_time < start_hour || bucket_time > end_hour {
            continue;
        }
        let index = (bucket_time - start_hour).num_hours() as usize;
        if let Some(point) = trend.get_mut(index) {
            match status.as_str() {
                "error" => point.error_count += 1,
                "timeout" => point.timeout_count += 1,
                _ => {}
            }
        }
    }

    trend
}

fn build_cron_health_alerts(
    cooldown_tasks: usize,
    stale_running_tasks: usize,
    failed_last_24h: usize,
    cooldown_alert_threshold: usize,
    stale_running_alert_threshold: usize,
    failed_24h_alert_threshold: usize,
) -> Vec<CronHealthAlert> {
    let mut alerts = Vec::new();
    if cooldown_tasks >= cooldown_alert_threshold {
        alerts.push(CronHealthAlert {
            code: "cooldown_tasks_threshold".to_string(),
            severity: "warning".to_string(),
            message: format!(
                "冷却中的任务数量达到阈值（{}/{}）",
                cooldown_tasks, cooldown_alert_threshold
            ),
            current_value: cooldown_tasks,
            threshold: cooldown_alert_threshold,
        });
    }
    if stale_running_tasks >= stale_running_alert_threshold {
        alerts.push(CronHealthAlert {
            code: "stale_running_tasks_threshold".to_string(),
            severity: "critical".to_string(),
            message: format!(
                "悬挂运行任务数量达到阈值（{}/{}）",
                stale_running_tasks, stale_running_alert_threshold
            ),
            current_value: stale_running_tasks,
            threshold: stale_running_alert_threshold,
        });
    }
    if failed_last_24h >= failed_24h_alert_threshold {
        alerts.push(CronHealthAlert {
            code: "failed_last_24h_threshold".to_string(),
            severity: "warning".to_string(),
            message: format!(
                "最近24小时失败次数达到阈值（{}/{}）",
                failed_last_24h, failed_24h_alert_threshold
            ),
            current_value: failed_last_24h,
            threshold: failed_24h_alert_threshold,
        });
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::database::{self, schema};
    use proxycast_scheduler::SchedulerDao;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    #[test]
    fn test_parse_rpc_request() {
        let json = r#"{
            "jsonrpc": "2.0",
            "id": "test-123",
            "method": "agent.run",
            "params": {
                "message": "Hello",
                "stream": false
            }
        }"#;

        let request = parse_rpc_request(json).unwrap();
        assert_eq!(request.method, RpcMethod::AgentRun);
        assert_eq!(request.id, "test-123");
    }

    #[test]
    fn test_serialize_rpc_response() {
        let response = GatewayRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: "test-123".to_string(),
            result: Some(serde_json::json!({"success": true})),
            error: None,
        };

        let json = serialize_rpc_response(&response).unwrap();
        assert!(json.contains("2.0"));
        assert!(json.contains("test-123"));
    }

    fn create_test_handler() -> RpcHandler {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        schema::create_tables(&conn).expect("创建核心表失败");
        SchedulerDao::create_tables(&conn).expect("创建调度表失败");
        let db: database::DbConnection = Arc::new(Mutex::new(conn));
        let state = RpcHandlerState::new(
            Some(db),
            None,
            Arc::new(RwLock::new(proxycast_core::LogStore::new())),
        );
        RpcHandler::new(state)
    }

    #[tokio::test]
    async fn test_sessions_list_should_return_created_session() {
        let handler = create_test_handler();
        let request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "run-1".to_string(),
            method: RpcMethod::AgentRun,
            params: Some(json!({
                "message": "请帮我写一个任务总结",
                "stream": false
            })),
        };
        let run_response = handler.handle_request(request).await;
        assert!(run_response.error.is_none());
        let run_result: AgentRunResult =
            serde_json::from_value(run_response.result.expect("缺少 run result"))
                .expect("解析 agent.run 失败");

        let list_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "list-1".to_string(),
            method: RpcMethod::SessionsList,
            params: None,
        };
        let list_response = handler.handle_request(list_request).await;
        assert!(list_response.error.is_none());
        let result: SessionsListResult =
            serde_json::from_value(list_response.result.expect("缺少 sessions.list result"))
                .expect("解析 sessions.list 返回失败");
        assert!(!result.sessions.is_empty());
        assert!(result
            .sessions
            .iter()
            .any(|session| session.session_id == run_result.session_id));
    }

    #[tokio::test]
    async fn test_agent_wait_should_observe_terminal_status() {
        let handler = create_test_handler();
        let run_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "run-2".to_string(),
            method: RpcMethod::AgentRun,
            params: Some(json!({
                "message": "测试 wait 接口",
                "model": "claude-sonnet-4-5",
                "stream": false
            })),
        };
        let run_response = handler.handle_request(run_request).await;
        assert!(run_response.error.is_none());
        let run_result: AgentRunResult =
            serde_json::from_value(run_response.result.expect("缺少 run result"))
                .expect("解析 agent.run 失败");

        let wait_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "wait-1".to_string(),
            method: RpcMethod::AgentWait,
            params: Some(json!({
                "run_id": run_result.run_id,
                "timeout": 3000
            })),
        };
        let wait_response = handler.handle_request(wait_request).await;
        assert!(wait_response.error.is_none());
        let wait_result: AgentWaitResult =
            serde_json::from_value(wait_response.result.expect("缺少 wait result"))
                .expect("解析 agent.wait 失败");
        assert!(wait_result.completed);
    }

    #[tokio::test]
    async fn test_cron_list_and_run_should_work() {
        let handler = create_test_handler();
        let db = handler.state.db.read().await.clone().expect("db 未初始化");
        {
            let conn = database::lock_db(&db).expect("DB lock 失败");
            let task = ScheduledTask::new(
                "测试定时任务".to_string(),
                "agent_chat".to_string(),
                json!({"prompt":"hello"}),
                "anthropic".to_string(),
                "claude-sonnet-4-5".to_string(),
                Utc::now(),
            );
            SchedulerDao::create_task(&conn, &task).expect("插入测试任务失败");
        }

        let list_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "cron-list".to_string(),
            method: RpcMethod::CronList,
            params: None,
        };
        let list_response = handler.handle_request(list_request).await;
        assert!(list_response.error.is_none());
        let list_result: CronListResult =
            serde_json::from_value(list_response.result.expect("缺少 cron.list result"))
                .expect("解析 cron.list 返回失败");
        assert!(!list_result.tasks.is_empty());

        let run_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "cron-run".to_string(),
            method: RpcMethod::CronRun,
            params: Some(json!({
                "task_id": list_result.tasks[0].task_id
            })),
        };
        let run_response = handler.handle_request(run_request).await;
        assert!(run_response.error.is_none());
        let run_result: CronRunResult =
            serde_json::from_value(run_response.result.expect("缺少 cron.run result"))
                .expect("解析 cron.run 返回失败");
        assert!(run_result.started);
        assert!(!run_result.execution_id.is_empty());
    }

    #[tokio::test]
    async fn test_cron_run_should_block_when_task_in_cooldown() {
        let handler = create_test_handler();
        let db = handler.state.db.read().await.clone().expect("db 未初始化");
        let task_id = {
            let conn = database::lock_db(&db).expect("DB lock 失败");
            let mut task = ScheduledTask::new(
                "冷却任务".to_string(),
                "agent_chat".to_string(),
                json!({"prompt":"hello"}),
                "anthropic".to_string(),
                "claude-sonnet-4-5".to_string(),
                Utc::now(),
            );
            task.mark_failed("error-1".to_string());
            task.mark_failed("error-2".to_string());
            task.mark_failed("error-3".to_string());
            task.activate_cooldown(300);
            let task_id = task.id.clone();
            SchedulerDao::create_task(&conn, &task).expect("插入测试任务失败");
            task_id
        };

        let run_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "cron-run-cooldown".to_string(),
            method: RpcMethod::CronRun,
            params: Some(json!({
                "task_id": task_id
            })),
        };
        let run_response = handler.handle_request(run_request).await;
        assert!(run_response.error.is_some());
        let err = run_response.error.expect("应返回错误");
        assert!(err.message.contains("cooldown"));
    }

    #[tokio::test]
    async fn test_cron_health_should_return_aggregated_metrics() {
        let handler = create_test_handler();
        let db = handler.state.db.read().await.clone().expect("db 未初始化");
        {
            let conn = database::lock_db(&db).expect("DB lock 失败");

            let pending_task = ScheduledTask::new(
                "待执行任务".to_string(),
                "agent_chat".to_string(),
                json!({"prompt":"pending"}),
                "anthropic".to_string(),
                "claude-sonnet-4-5".to_string(),
                Utc::now(),
            );
            SchedulerDao::create_task(&conn, &pending_task).expect("插入待执行任务失败");

            let mut stale_running_task = ScheduledTask::new(
                "悬挂任务".to_string(),
                "agent_chat".to_string(),
                json!({"prompt":"running"}),
                "anthropic".to_string(),
                "claude-sonnet-4-5".to_string(),
                Utc::now(),
            );
            stale_running_task.mark_running();
            stale_running_task.started_at =
                Some((Utc::now() - chrono::Duration::minutes(30)).to_rfc3339());
            stale_running_task.updated_at = Utc::now().to_rfc3339();
            SchedulerDao::create_task(&conn, &stale_running_task).expect("插入悬挂任务失败");

            let mut cooldown_task = ScheduledTask::new(
                "冷却任务".to_string(),
                "agent_chat".to_string(),
                json!({"prompt":"failed"}),
                "anthropic".to_string(),
                "claude-sonnet-4-5".to_string(),
                Utc::now(),
            );
            cooldown_task.mark_failed("error-1".to_string());
            cooldown_task.mark_failed("error-2".to_string());
            cooldown_task.mark_failed("error-3".to_string());
            cooldown_task.activate_cooldown(300);
            SchedulerDao::create_task(&conn, &cooldown_task).expect("插入冷却任务失败");

            let now = Utc::now().to_rfc3339();
            let run_error = AgentRun {
                id: Uuid::new_v4().to_string(),
                source: "automation".to_string(),
                source_ref: Some("task-1".to_string()),
                session_id: None,
                status: AgentRunStatus::Error,
                started_at: now.clone(),
                finished_at: Some(now.clone()),
                duration_ms: Some(100),
                error_code: Some("x".to_string()),
                error_message: Some("error".to_string()),
                metadata: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            AgentRunDao::create_run(&conn, &run_error).expect("插入错误执行记录失败");
            let run_timeout = AgentRun {
                id: Uuid::new_v4().to_string(),
                source: "automation".to_string(),
                source_ref: Some("task-2".to_string()),
                session_id: None,
                status: AgentRunStatus::Timeout,
                started_at: now.clone(),
                finished_at: Some(now.clone()),
                duration_ms: Some(200),
                error_code: Some("timeout".to_string()),
                error_message: Some("timeout".to_string()),
                metadata: None,
                created_at: now.clone(),
                updated_at: now,
            };
            AgentRunDao::create_run(&conn, &run_timeout).expect("插入超时执行记录失败");
        }

        let health_request = GatewayRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: "cron-health".to_string(),
            method: RpcMethod::CronHealth,
            params: Some(json!({
                "running_timeout_minutes": 10,
                "top_limit": 5
            })),
        };
        let health_response = handler.handle_request(health_request).await;
        assert!(health_response.error.is_none());
        let result: CronHealthResult =
            serde_json::from_value(health_response.result.expect("缺少 cron.health result"))
                .expect("解析 cron.health 返回失败");
        assert!(result.total_tasks >= 3);
        assert!(result.cooldown_tasks >= 1);
        assert!(result.stale_running_tasks >= 1);
        assert!(result.failed_last_24h >= 2);
        assert_eq!(result.failure_trend_24h.len(), 24);
        assert!(result.alerts.len() >= 2);
        assert!(!result.top_risky_tasks.is_empty());
    }

    #[test]
    fn test_infer_provider_from_model_should_support_provider_prefix_and_glm() {
        assert_eq!(infer_provider_from_model("zhipuai/glm-4.7"), "zhipuai");
        assert_eq!(infer_provider_from_model("glm-4-plus"), "zhipuai");
        assert_eq!(infer_provider_from_model("openai/gpt-4o-mini"), "openai");
        assert_eq!(infer_provider_from_model(""), "openai");
    }

    #[test]
    fn test_resolve_provider_and_model_should_strip_provider_prefix() {
        let (provider, model) = resolve_provider_and_model("zhipuai/glm-4.7");
        assert_eq!(provider, "zhipuai");
        assert_eq!(model, "glm-4.7");

        let (provider, model) = resolve_provider_and_model("glm-4-plus");
        assert_eq!(provider, "zhipuai");
        assert_eq!(model, "glm-4-plus");
    }
}
