//! 自动化任务健康统计

use crate::database::DbConnection;
use chrono::{DateTime, Duration, Timelike, Utc};
use proxycast_core::database::dao::agent_run::{AgentRun, AgentRunDao, AgentRunStatus};
use proxycast_core::database::dao::automation_job::{AutomationJob, AutomationJobDao};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutomationHealthQuery {
    pub running_timeout_minutes: Option<u64>,
    pub top_limit: Option<usize>,
    pub cooldown_alert_threshold: Option<usize>,
    pub stale_running_alert_threshold: Option<usize>,
    pub failed_24h_alert_threshold: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationFailureTrendPoint {
    pub bucket_start: String,
    pub label: String,
    pub error_count: usize,
    pub timeout_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationHealthAlert {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub current_value: usize,
    pub threshold: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationRiskJobInfo {
    pub job_id: String,
    pub name: String,
    pub status: String,
    pub consecutive_failures: u32,
    pub retry_count: u32,
    pub detail_message: Option<String>,
    pub auto_disabled_until: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationHealthResult {
    pub total_jobs: usize,
    pub enabled_jobs: usize,
    pub pending_jobs: usize,
    pub running_jobs: usize,
    pub failed_jobs: usize,
    pub cooldown_jobs: usize,
    pub stale_running_jobs: usize,
    pub failed_last_24h: usize,
    pub failure_trend_24h: Vec<AutomationFailureTrendPoint>,
    pub alerts: Vec<AutomationHealthAlert>,
    pub risky_jobs: Vec<AutomationRiskJobInfo>,
    pub generated_at: String,
}

pub fn query_automation_health(
    db: &DbConnection,
    query: Option<AutomationHealthQuery>,
) -> Result<AutomationHealthResult, String> {
    let query = query.unwrap_or_default();
    let running_timeout_minutes = query.running_timeout_minutes.unwrap_or(10);
    let top_limit = query.top_limit.unwrap_or(5);
    let cooldown_alert_threshold = query.cooldown_alert_threshold.unwrap_or(1);
    let stale_running_alert_threshold = query.stale_running_alert_threshold.unwrap_or(1);
    let failed_24h_alert_threshold = query.failed_24h_alert_threshold.unwrap_or(3);

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let jobs = AutomationJobDao::list(&conn).map_err(|e| format!("查询自动化任务失败: {e}"))?;

    let now = Utc::now();
    let stale_deadline = now - Duration::minutes(running_timeout_minutes as i64);

    let total_jobs = jobs.len();
    let enabled_jobs = jobs.iter().filter(|job| job.enabled).count();
    let pending_jobs = jobs
        .iter()
        .filter(|job| job.enabled)
        .filter(|job| !is_running(job))
        .filter(|job| !is_in_cooldown(job, now))
        .filter(|job| {
            job.next_run_at
                .as_deref()
                .and_then(parse_rfc3339_utc)
                .map(|value| value <= now)
                .unwrap_or(false)
        })
        .count();
    let running_jobs = jobs.iter().filter(|job| is_running(job)).count();
    let failed_jobs = jobs
        .iter()
        .filter(|job| matches!(job.last_status.as_deref(), Some("error" | "timeout")))
        .count();
    let cooldown_jobs = jobs.iter().filter(|job| is_in_cooldown(job, now)).count();
    let stale_running_jobs = jobs
        .iter()
        .filter(|job| {
            job.running_started_at
                .as_deref()
                .and_then(parse_rfc3339_utc)
                .map(|value| value < stale_deadline)
                .unwrap_or(false)
        })
        .count();

    let recent_runs_by_job = jobs
        .iter()
        .map(|job| {
            let runs = AgentRunDao::list_runs_by_source_ref(&conn, "automation", &job.id, 200)
                .unwrap_or_default();
            (job.id.clone(), runs)
        })
        .collect::<HashMap<_, _>>();
    let recent_runs = recent_runs_by_job
        .values()
        .flat_map(|runs| runs.iter().cloned())
        .collect::<Vec<_>>();
    let failure_trend_24h = build_failure_trend_24h(&recent_runs, now);
    let failed_last_24h = failure_trend_24h
        .iter()
        .map(|item| item.error_count + item.timeout_count)
        .sum();

    let mut risky_jobs = jobs
        .iter()
        .filter(|job| {
            job.consecutive_failures > 0
                || is_in_cooldown(job, now)
                || matches!(
                    job.last_status.as_deref(),
                    Some("waiting_for_human" | "human_controlling")
                )
                || matches!(job.last_status.as_deref(), Some("error" | "timeout"))
        })
        .map(|job| AutomationRiskJobInfo {
            job_id: job.id.clone(),
            name: job.name.clone(),
            status: job
                .last_status
                .clone()
                .unwrap_or_else(|| "idle".to_string()),
            consecutive_failures: job.consecutive_failures,
            retry_count: job.last_retry_count,
            detail_message: recent_runs_by_job
                .get(&job.id)
                .and_then(|runs| resolve_risky_job_detail(job, runs)),
            auto_disabled_until: job.auto_disabled_until.clone(),
            updated_at: job.updated_at.clone(),
        })
        .collect::<Vec<_>>();
    risky_jobs.sort_by(|left, right| {
        right
            .consecutive_failures
            .cmp(&left.consecutive_failures)
            .then_with(|| right.retry_count.cmp(&left.retry_count))
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });
    risky_jobs.truncate(top_limit);

    let alerts = build_alerts(
        cooldown_jobs,
        stale_running_jobs,
        failed_last_24h,
        cooldown_alert_threshold,
        stale_running_alert_threshold,
        failed_24h_alert_threshold,
    );

    Ok(AutomationHealthResult {
        total_jobs,
        enabled_jobs,
        pending_jobs,
        running_jobs,
        failed_jobs,
        cooldown_jobs,
        stale_running_jobs,
        failed_last_24h,
        failure_trend_24h,
        alerts,
        risky_jobs,
        generated_at: now.to_rfc3339(),
    })
}

fn resolve_risky_job_detail(job: &AutomationJob, runs: &[AgentRun]) -> Option<String> {
    runs.first()
        .and_then(resolve_run_detail_message)
        .or_else(|| job.last_error.as_deref().and_then(normalize_non_empty))
}

fn resolve_run_detail_message(run: &AgentRun) -> Option<String> {
    let human_reason = run
        .metadata
        .as_deref()
        .and_then(|metadata| extract_metadata_string(metadata, "human_reason"));
    if let Some(reason) = human_reason {
        if run.error_message.as_deref().map(str::trim) != Some(reason.as_str()) {
            return Some(reason);
        }
    }
    run.error_message.as_deref().and_then(normalize_non_empty)
}

fn extract_metadata_string(metadata: &str, key: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(metadata).ok()?;
    let value = parsed.get(key)?.as_str()?;
    normalize_non_empty(value)
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_rfc3339_utc(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn is_running(job: &AutomationJob) -> bool {
    job.running_started_at.is_some()
}

fn is_in_cooldown(job: &AutomationJob, now: DateTime<Utc>) -> bool {
    job.auto_disabled_until
        .as_deref()
        .and_then(parse_rfc3339_utc)
        .map(|value| value > now)
        .unwrap_or(false)
}

fn build_failure_trend_24h(
    runs: &[proxycast_core::database::dao::agent_run::AgentRun],
    now: DateTime<Utc>,
) -> Vec<AutomationFailureTrendPoint> {
    let mut points = Vec::with_capacity(24);
    let end_hour = floor_to_hour(now);
    let start_hour = end_hour - Duration::hours(23);

    for offset in 0..24 {
        let bucket = start_hour + Duration::hours(offset as i64);
        let bucket_end = bucket + Duration::hours(1);
        let mut error_count = 0usize;
        let mut timeout_count = 0usize;

        for run in runs {
            let Some(started_at) = parse_rfc3339_utc(run.started_at.as_str()) else {
                continue;
            };
            if started_at < bucket || started_at >= bucket_end {
                continue;
            }
            match run.status {
                AgentRunStatus::Error => error_count += 1,
                AgentRunStatus::Timeout => timeout_count += 1,
                _ => {}
            }
        }

        points.push(AutomationFailureTrendPoint {
            bucket_start: bucket.to_rfc3339(),
            label: bucket.format("%H:%M").to_string(),
            error_count,
            timeout_count,
        });
    }

    points
}

fn floor_to_hour(now: DateTime<Utc>) -> DateTime<Utc> {
    now.with_minute(0)
        .and_then(|value| value.with_second(0))
        .and_then(|value| value.with_nanosecond(0))
        .unwrap_or(now)
}

fn build_alerts(
    cooldown_jobs: usize,
    stale_running_jobs: usize,
    failed_last_24h: usize,
    cooldown_threshold: usize,
    stale_threshold: usize,
    failed_threshold: usize,
) -> Vec<AutomationHealthAlert> {
    let mut alerts = Vec::new();

    if cooldown_jobs >= cooldown_threshold {
        alerts.push(AutomationHealthAlert {
            code: "cooldown_jobs".to_string(),
            severity: "warning".to_string(),
            message: format!("当前有 {cooldown_jobs} 个任务处于冷却中"),
            current_value: cooldown_jobs,
            threshold: cooldown_threshold,
        });
    }

    if stale_running_jobs >= stale_threshold {
        alerts.push(AutomationHealthAlert {
            code: "stale_running_jobs".to_string(),
            severity: "critical".to_string(),
            message: format!("检测到 {stale_running_jobs} 个悬挂中的运行任务"),
            current_value: stale_running_jobs,
            threshold: stale_threshold,
        });
    }

    if failed_last_24h >= failed_threshold {
        alerts.push(AutomationHealthAlert {
            code: "failed_runs_24h".to_string(),
            severity: "warning".to_string(),
            message: format!("最近 24 小时失败或超时 {failed_last_24h} 次"),
            current_value: failed_last_24h,
            threshold: failed_threshold,
        });
    }

    alerts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use proxycast_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};
    use proxycast_core::database::dao::agent_run::{AgentRun, AgentRunDao, AgentRunStatus};
    use proxycast_core::database::dao::automation_job::AutomationJobDao;
    use rusqlite::Connection;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建数据表失败");
        Arc::new(Mutex::new(conn))
    }

    fn sample_browser_job() -> AutomationJob {
        AutomationJob {
            id: "job-browser-1".to_string(),
            name: "浏览器巡检".to_string(),
            description: Some("等待人工处理".to_string()),
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Intelligent,
            schedule: TaskSchedule::Every { every_secs: 300 },
            payload: json!({
                "kind": "browser_session",
                "profile_id": "profile-1",
                "profile_key": "shop_us",
                "url": "https://seller.example.com/dashboard",
                "open_window": false,
                "stream_mode": "events"
            }),
            delivery: DeliveryConfig::default(),
            timeout_secs: Some(120),
            max_retries: 2,
            next_run_at: None,
            last_status: Some("waiting_for_human".to_string()),
            last_error: None,
            last_run_at: Some("2026-03-16T00:00:00Z".to_string()),
            last_finished_at: None,
            running_started_at: Some("2026-03-16T00:00:00Z".to_string()),
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: "2026-03-16T00:00:00Z".to_string(),
            updated_at: "2026-03-16T00:00:05Z".to_string(),
        }
    }

    fn sample_run() -> AgentRun {
        AgentRun {
            id: "run-browser-1".to_string(),
            source: "automation".to_string(),
            source_ref: Some("job-browser-1".to_string()),
            session_id: Some("session-1".to_string()),
            status: AgentRunStatus::Running,
            started_at: "2026-03-16T00:00:00Z".to_string(),
            finished_at: None,
            duration_ms: None,
            error_code: None,
            error_message: None,
            metadata: Some(
                json!({
                    "payload_kind": "browser_session",
                    "session_id": "session-1",
                    "browser_lifecycle_state": "waiting_for_human",
                    "human_reason": "等待你确认是否继续执行"
                })
                .to_string(),
            ),
            created_at: "2026-03-16T00:00:00Z".to_string(),
            updated_at: "2026-03-16T00:00:05Z".to_string(),
        }
    }

    #[test]
    fn query_automation_health_should_include_human_reason_for_risky_browser_job() {
        let db = setup_db();
        let conn = db.lock().expect("数据库锁定失败");
        AutomationJobDao::create(&conn, &sample_browser_job()).expect("写入 job 失败");
        AgentRunDao::create_run(&conn, &sample_run()).expect("写入 run 失败");
        drop(conn);

        let result = query_automation_health(&db, Some(AutomationHealthQuery::default()))
            .expect("查询健康状态失败");

        assert_eq!(result.risky_jobs.len(), 1);
        assert_eq!(
            result.risky_jobs[0].detail_message.as_deref(),
            Some("等待你确认是否继续执行")
        );
    }
}
