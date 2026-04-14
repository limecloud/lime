//! Current cron scheduling tools.
//!
//! 对齐当前工具面：
//! - CronCreate
//! - CronList
//! - CronDelete

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use async_trait::async_trait;
use chrono::{DateTime, Local, Utc};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

use crate::recipe::Recipe;
use crate::scheduler::{get_default_scheduled_recipes_dir, ScheduledJob, SchedulerError};
use crate::scheduler_trait::SchedulerTrait;

const CRON_CREATE_TOOL_NAME: &str = "CronCreate";
const CRON_LIST_TOOL_NAME: &str = "CronList";
const CRON_DELETE_TOOL_NAME: &str = "CronDelete";
const MAX_CRON_JOBS: usize = 50;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CronCreateInput {
    cron: String,
    prompt: String,
    #[serde(default = "default_true")]
    recurring: bool,
    #[serde(default)]
    durable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CronCreateOutput {
    id: String,
    human_schedule: String,
    recurring: bool,
    durable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CronListJobOutput {
    id: String,
    cron: String,
    human_schedule: String,
    prompt: String,
    recurring: bool,
    durable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CronListOutput {
    jobs: Vec<CronListJobOutput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CronDeleteInput {
    id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CronDeleteOutput {
    id: String,
}

fn default_true() -> bool {
    true
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化 Cron 结果失败: {error}")))
}

fn normalize_five_field_cron(raw: &str) -> Result<String, ToolError> {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err(ToolError::invalid_params("cron 不能为空".to_string()));
    }

    let field_count = normalized.split_whitespace().count();
    if field_count != 5 {
        return Err(ToolError::invalid_params(format!(
            "cron 必须是 5 段本地时间表达式，当前收到 {field_count} 段"
        )));
    }

    Ok(normalized)
}

fn scheduler_cron_expression(cron: &str) -> String {
    format!("0 {cron}")
}

fn next_run_at(cron: &str) -> Result<DateTime<Utc>, ToolError> {
    let expression = scheduler_cron_expression(cron);
    let schedule = Schedule::from_str(expression.as_str()).map_err(|error| {
        ToolError::invalid_params(format!("无效的 cron 表达式 \"{cron}\": {error}"))
    })?;

    schedule
        .after(&Local::now())
        .next()
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(|| {
            ToolError::invalid_params(format!(
                "cron 表达式 \"{cron}\" 在可预见范围内没有下一次触发时间"
            ))
        })
}

fn describe_schedule(cron: &str, next_run: DateTime<Utc>, recurring: bool) -> String {
    let local_run = next_run.with_timezone(&Local);
    let frequency = if recurring { "recurring" } else { "one-shot" };
    format!(
        "{frequency} cron {cron} (next run: {})",
        local_run.format("%Y-%m-%d %H:%M:%S %Z")
    )
}

fn build_recipe(prompt: &str) -> Result<Recipe, ToolError> {
    Recipe::builder()
        .title("Scheduled prompt")
        .description("Prompt scheduled by CronCreate")
        .prompt(prompt)
        .build()
        .map_err(|error| ToolError::execution_failed(format!("构建定时 recipe 失败: {error}")))
}

fn write_recipe_file(path: &Path, prompt: &str) -> Result<(), ToolError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| ToolError::execution_failed(format!("创建定时目录失败: {error}")))?;
    }

    let recipe = build_recipe(prompt)?;
    let content = recipe
        .to_yaml()
        .map_err(|error| ToolError::execution_failed(format!("序列化定时 recipe 失败: {error}")))?;

    fs::write(path, content)
        .map_err(|error| ToolError::execution_failed(format!("写入定时 recipe 失败: {error}")))
}

fn durable_recipe_path(job_id: &str) -> Result<PathBuf, ToolError> {
    let base = get_default_scheduled_recipes_dir().map_err(map_scheduler_error)?;
    Ok(base.join(format!("{job_id}.yaml")))
}

fn session_recipe_path(session_id: &str, job_id: &str) -> PathBuf {
    let session_fragment = if session_id.trim().is_empty() {
        "default".to_string()
    } else {
        session_id
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect()
    };

    std::env::temp_dir()
        .join("aster-session-cron")
        .join(session_fragment)
        .join(format!("{job_id}.yaml"))
}

fn map_scheduler_error(error: SchedulerError) -> ToolError {
    ToolError::execution_failed(error.to_string())
}

fn read_prompt_from_recipe(path: &str) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("yaml")
        .to_ascii_lowercase();

    let recipe = match extension.as_str() {
        "json" | "jsonl" => serde_json::from_str::<Recipe>(&content).ok()?,
        _ => serde_yaml::from_str::<Recipe>(&content).ok()?,
    };

    recipe
        .prompt
        .or(recipe.instructions)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn job_prompt(job: &ScheduledJob) -> String {
    if let Some(prompt) = job
        .prompt
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return prompt.to_string();
    }

    read_prompt_from_recipe(job.source.as_str()).unwrap_or_else(|| job.source.clone())
}

pub struct CronCreateTool {
    scheduler: Arc<dyn SchedulerTrait>,
}

impl CronCreateTool {
    pub fn new(scheduler: Arc<dyn SchedulerTrait>) -> Self {
        Self { scheduler }
    }
}

pub struct CronListTool {
    scheduler: Arc<dyn SchedulerTrait>,
}

impl CronListTool {
    pub fn new(scheduler: Arc<dyn SchedulerTrait>) -> Self {
        Self { scheduler }
    }
}

pub struct CronDeleteTool {
    scheduler: Arc<dyn SchedulerTrait>,
}

impl CronDeleteTool {
    pub fn new(scheduler: Arc<dyn SchedulerTrait>) -> Self {
        Self { scheduler }
    }
}

#[async_trait]
impl Tool for CronCreateTool {
    fn name(&self) -> &str {
        CRON_CREATE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Schedule a prompt to run at a future time, either recurring or once."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "cron": {
                    "type": "string",
                    "description": "Standard 5-field cron expression in local time: minute hour day-of-month month day-of-week."
                },
                "prompt": {
                    "type": "string",
                    "description": "The prompt to enqueue when the schedule fires."
                },
                "recurring": {
                    "type": "boolean",
                    "description": "true (default) repeats on every cron match. false fires once at the next match, then auto-deletes."
                },
                "durable": {
                    "type": "boolean",
                    "description": "true persists the job across restarts. false keeps it only for the current runtime session."
                }
            },
            "required": ["cron", "prompt"]
        })
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: CronCreateInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let cron = normalize_five_field_cron(input.cron.as_str())?;
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err(ToolError::invalid_params("prompt 不能为空".to_string()));
        }

        let existing_jobs = self.scheduler.list_scheduled_jobs().await;
        if existing_jobs.len() >= MAX_CRON_JOBS {
            return Err(ToolError::execution_failed(format!(
                "定时任务数量已达上限 {MAX_CRON_JOBS}，请先删除一个任务"
            )));
        }

        let next_run = next_run_at(cron.as_str())?;
        let job_id = format!("cron_{}", Uuid::new_v4().simple());
        let recipe_path = if input.durable {
            durable_recipe_path(job_id.as_str())?
        } else {
            session_recipe_path(context.session_id.as_str(), job_id.as_str())
        };

        write_recipe_file(recipe_path.as_path(), prompt)?;

        let job = ScheduledJob {
            id: job_id.clone(),
            source: recipe_path.to_string_lossy().to_string(),
            cron: cron.clone(),
            recurring: input.recurring,
            durable: input.durable,
            prompt: Some(prompt.to_string()),
            scheduled_for: (!input.recurring).then_some(next_run),
            last_run: None,
            currently_running: false,
            paused: false,
            current_session_id: None,
            process_start_time: None,
        };

        if let Err(error) = self.scheduler.add_scheduled_job(job, false).await {
            let _ = fs::remove_file(recipe_path);
            return Err(map_scheduler_error(error));
        }

        let output = CronCreateOutput {
            id: job_id,
            human_schedule: describe_schedule(cron.as_str(), next_run, input.recurring),
            recurring: input.recurring,
            durable: input.durable,
        };

        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("id", json!(output.id))
            .with_metadata("humanSchedule", json!(output.human_schedule))
            .with_metadata("recurring", json!(output.recurring))
            .with_metadata("durable", json!(output.durable)))
    }
}

#[async_trait]
impl Tool for CronListTool {
    fn name(&self) -> &str {
        CRON_LIST_TOOL_NAME
    }

    fn description(&self) -> &str {
        "List scheduled cron jobs."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {}
        })
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }

    async fn execute(
        &self,
        _params: Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let mut jobs = self.scheduler.list_scheduled_jobs().await;
        jobs.sort_by(|left, right| left.id.cmp(&right.id));

        let output = CronListOutput {
            jobs: jobs
                .into_iter()
                .map(|job| {
                    let next_run = job
                        .scheduled_for
                        .or_else(|| next_run_at(job.cron.as_str()).ok())
                        .unwrap_or_else(Utc::now);
                    let human_schedule =
                        describe_schedule(job.cron.as_str(), next_run, job.recurring);
                    let prompt = job_prompt(&job);
                    CronListJobOutput {
                        id: job.id,
                        cron: job.cron.clone(),
                        human_schedule,
                        prompt,
                        recurring: job.recurring,
                        durable: job.durable,
                    }
                })
                .collect(),
        };

        Ok(ToolResult::success(pretty_json(&output)?).with_metadata(
            "jobs",
            serde_json::to_value(&output.jobs).unwrap_or(json!([])),
        ))
    }
}

#[async_trait]
impl Tool for CronDeleteTool {
    fn name(&self) -> &str {
        CRON_DELETE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Cancel a scheduled cron job by ID."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Job ID returned by CronCreate."
                }
            },
            "required": ["id"]
        })
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }

    async fn execute(
        &self,
        params: Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: CronDeleteInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.id.trim().is_empty() {
            return Err(ToolError::invalid_params("id 不能为空".to_string()));
        }

        self.scheduler
            .remove_scheduled_job(input.id.as_str(), true)
            .await
            .map_err(map_scheduler_error)?;

        let output = CronDeleteOutput { id: input.id };
        Ok(ToolResult::success(pretty_json(&output)?).with_metadata("id", json!(output.id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::Session;
    use chrono::{Duration as ChronoDuration, TimeZone};
    use std::sync::Mutex;

    #[derive(Default)]
    struct MockSchedulerState {
        jobs: Vec<ScheduledJob>,
        removed_ids: Vec<String>,
    }

    struct MockScheduler {
        state: Arc<Mutex<MockSchedulerState>>,
    }

    #[async_trait]
    impl SchedulerTrait for MockScheduler {
        async fn add_scheduled_job(
            &self,
            job: ScheduledJob,
            _copy_recipe: bool,
        ) -> Result<(), SchedulerError> {
            self.state.lock().unwrap().jobs.push(job);
            Ok(())
        }

        async fn schedule_recipe(
            &self,
            _recipe_path: PathBuf,
            _cron_schedule: Option<String>,
        ) -> anyhow::Result<(), SchedulerError> {
            Ok(())
        }

        async fn list_scheduled_jobs(&self) -> Vec<ScheduledJob> {
            self.state.lock().unwrap().jobs.clone()
        }

        async fn remove_scheduled_job(
            &self,
            id: &str,
            _remove_recipe: bool,
        ) -> Result<(), SchedulerError> {
            let mut state = self.state.lock().unwrap();
            state.removed_ids.push(id.to_string());
            state.jobs.retain(|job| job.id != id);
            Ok(())
        }

        async fn pause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn unpause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn run_now(&self, _id: &str) -> Result<String, SchedulerError> {
            Ok("mock-session".to_string())
        }

        async fn sessions(
            &self,
            _sched_id: &str,
            _limit: usize,
        ) -> Result<Vec<(String, Session)>, SchedulerError> {
            Ok(vec![])
        }

        async fn update_schedule(
            &self,
            _sched_id: &str,
            _new_cron: String,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn kill_running_job(&self, _sched_id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn get_running_job_info(
            &self,
            _sched_id: &str,
        ) -> Result<Option<(String, DateTime<Utc>)>, SchedulerError> {
            Ok(None)
        }
    }

    fn build_scheduler() -> (Arc<dyn SchedulerTrait>, Arc<Mutex<MockSchedulerState>>) {
        let state = Arc::new(Mutex::new(MockSchedulerState::default()));
        (
            Arc::new(MockScheduler {
                state: state.clone(),
            }),
            state,
        )
    }

    #[test]
    fn test_normalize_five_field_cron_rejects_non_five_field_expression() {
        let error = normalize_five_field_cron("* * * * * *").unwrap_err();
        assert!(error.to_string().contains("5 段"));
    }

    #[test]
    fn test_next_run_at_accepts_five_field_expression() {
        let run_at = next_run_at("*/5 * * * *").unwrap();
        assert!(run_at > Utc::now());
    }

    #[tokio::test]
    async fn test_cron_create_tool_creates_session_only_job() {
        let (scheduler, state) = build_scheduler();
        let tool = CronCreateTool::new(scheduler);
        let context = ToolContext::default().with_session_id("session-a");

        let result = tool
            .execute(
                json!({
                    "cron": "*/5 * * * *",
                    "prompt": "check logs",
                    "durable": false,
                    "recurring": false
                }),
                &context,
            )
            .await
            .expect("cron create should succeed");

        let output: CronCreateOutput =
            serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert!(!output.durable);
        assert!(!output.recurring);

        let jobs = &state.lock().unwrap().jobs;
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].prompt.as_deref(), Some("check logs"));
        assert!(!jobs[0].durable);
        assert!(!jobs[0].recurring);
        assert!(jobs[0].scheduled_for.is_some());
        assert!(jobs[0].source.contains("aster-session-cron"));
    }

    #[tokio::test]
    async fn test_cron_list_tool_uses_scheduler_jobs() {
        let (scheduler, state) = build_scheduler();
        state.lock().unwrap().jobs.push(ScheduledJob {
            id: "job-1".to_string(),
            source: "/tmp/job-1.yaml".to_string(),
            cron: "0 9 * * *".to_string(),
            recurring: true,
            durable: true,
            prompt: Some("daily summary".to_string()),
            scheduled_for: Some(Utc.with_ymd_and_hms(2026, 4, 2, 1, 0, 0).unwrap()),
            last_run: None,
            currently_running: false,
            paused: false,
            current_session_id: None,
            process_start_time: None,
        });

        let tool = CronListTool::new(scheduler);
        let result = tool
            .execute(json!({}), &ToolContext::default())
            .await
            .expect("cron list should succeed");

        let output: CronListOutput =
            serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output.jobs.len(), 1);
        assert_eq!(output.jobs[0].id, "job-1");
        assert_eq!(output.jobs[0].prompt, "daily summary");
        assert!(output.jobs[0].durable);
        assert!(output.jobs[0].recurring);
    }

    #[tokio::test]
    async fn test_cron_delete_tool_removes_job() {
        let (scheduler, state) = build_scheduler();
        state.lock().unwrap().jobs.push(ScheduledJob {
            id: "job-delete".to_string(),
            source: "/tmp/job-delete.yaml".to_string(),
            cron: "0 9 * * *".to_string(),
            recurring: true,
            durable: true,
            prompt: Some("delete me".to_string()),
            scheduled_for: Some(Utc::now() + ChronoDuration::minutes(10)),
            last_run: None,
            currently_running: false,
            paused: false,
            current_session_id: None,
            process_start_time: None,
        });

        let tool = CronDeleteTool::new(scheduler);
        tool.execute(json!({ "id": "job-delete" }), &ToolContext::default())
            .await
            .expect("cron delete should succeed");

        let state = state.lock().unwrap();
        assert!(state.jobs.is_empty());
        assert_eq!(state.removed_ids, vec!["job-delete".to_string()]);
    }
}
