//! 自动化任务调度计算
//!
//! 支持 `every`、`cron`、`at` 三种调度类型。

use chrono::{DateTime, Utc};
use proxycast_core::config::TaskSchedule;
use std::str::FromStr;

#[derive(Debug, Clone)]
pub struct ScheduleError {
    pub message: String,
}

impl std::fmt::Display for ScheduleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ScheduleError {}

impl From<String> for ScheduleError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

impl From<ScheduleError> for String {
    fn from(error: ScheduleError) -> Self {
        error.message
    }
}

pub fn next_run_for_schedule(
    schedule: &TaskSchedule,
    from: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, ScheduleError> {
    match schedule {
        TaskSchedule::Every { every_secs } => {
            let secs = (*every_secs).max(60);
            Ok(Some(from + chrono::Duration::seconds(secs as i64)))
        }
        TaskSchedule::Cron { expr, tz } => {
            let normalized = normalize_cron_expression(expr);
            let cron_schedule = cron::Schedule::from_str(&normalized)
                .map_err(|e| ScheduleError::from(format!("无效的 Cron 表达式: {e}")))?;

            let next = if let Some(tz_str) = tz {
                let timezone: chrono_tz::Tz = tz_str
                    .parse()
                    .map_err(|_| ScheduleError::from(format!("无效的时区: {tz_str}")))?;
                let from_tz = from.with_timezone(&timezone);
                cron_schedule
                    .after(&from_tz)
                    .next()
                    .map(|value| value.with_timezone(&Utc))
            } else {
                cron_schedule.after(&from).next()
            };

            Ok(next)
        }
        TaskSchedule::At { at } => {
            let target = DateTime::parse_from_rfc3339(at)
                .map_err(|e| ScheduleError::from(format!("无效的时间格式（需要 RFC3339）: {e}")))?
                .with_timezone(&Utc);

            if target > from {
                Ok(Some(target))
            } else {
                Ok(None)
            }
        }
    }
}

pub fn validate_schedule(schedule: &TaskSchedule, now: DateTime<Utc>) -> Result<(), ScheduleError> {
    match schedule {
        TaskSchedule::Every { every_secs } => {
            if *every_secs < 60 {
                return Err(ScheduleError::from("间隔时间不能小于 60 秒".to_string()));
            }
            Ok(())
        }
        TaskSchedule::Cron { expr, tz } => {
            let normalized = normalize_cron_expression(expr);
            cron::Schedule::from_str(&normalized)
                .map_err(|e| ScheduleError::from(format!("无效的 Cron 表达式: {e}")))?;
            if let Some(tz_str) = tz {
                let _: chrono_tz::Tz = tz_str
                    .parse()
                    .map_err(|_| ScheduleError::from(format!("无效的时区: {tz_str}")))?;
            }
            Ok(())
        }
        TaskSchedule::At { at } => {
            let target = DateTime::parse_from_rfc3339(at)
                .map_err(|e| ScheduleError::from(format!("无效的时间格式: {e}")))?
                .with_timezone(&Utc);
            if target <= now {
                return Err(ScheduleError::from("指定时间已过期".to_string()));
            }
            Ok(())
        }
    }
}

pub fn normalize_cron_expression(expr: &str) -> String {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {}", expr.trim())
    } else {
        expr.trim().to_string()
    }
}

pub fn describe_schedule(schedule: &TaskSchedule) -> String {
    match schedule {
        TaskSchedule::Every { every_secs } => {
            let secs = *every_secs;
            if secs >= 86400 && secs % 86400 == 0 {
                format!("每 {} 天", secs / 86400)
            } else if secs >= 3600 && secs % 3600 == 0 {
                format!("每 {} 小时", secs / 3600)
            } else if secs >= 60 && secs % 60 == 0 {
                format!("每 {} 分钟", secs / 60)
            } else {
                format!("每 {} 秒", secs)
            }
        }
        TaskSchedule::Cron { expr, tz } => {
            let tz_info = tz
                .as_ref()
                .map(|value| format!(" ({value})"))
                .unwrap_or_default();
            format!("Cron: {expr}{tz_info}")
        }
        TaskSchedule::At { at } => format!("定时: {at}"),
    }
}

pub fn preview_next_run(schedule: &TaskSchedule) -> Result<Option<String>, ScheduleError> {
    Ok(next_run_for_schedule(schedule, Utc::now())?.map(|value| value.to_rfc3339()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn should_reject_every_schedule_shorter_than_sixty_seconds() {
        let now = Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap();
        let result = validate_schedule(&TaskSchedule::Every { every_secs: 59 }, now);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "间隔时间不能小于 60 秒");
    }

    #[test]
    fn should_accept_five_field_cron_and_compute_next_run() {
        let from = Utc.with_ymd_and_hms(2026, 3, 15, 8, 30, 0).unwrap();
        let schedule = TaskSchedule::Cron {
            expr: "0 9 * * *".to_string(),
            tz: Some("Asia/Shanghai".to_string()),
        };

        validate_schedule(&schedule, from).expect("cron 应通过校验");
        let next_run = next_run_for_schedule(&schedule, from)
            .expect("应能计算 cron 下次执行时间")
            .expect("cron 应返回下次执行时间");

        assert_eq!(
            next_run,
            Utc.with_ymd_and_hms(2026, 3, 16, 1, 0, 0).unwrap()
        );
    }

    #[test]
    fn should_return_none_for_expired_at_schedule() {
        let from = Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap();
        let schedule = TaskSchedule::At {
            at: "2026-03-15T11:59:00Z".to_string(),
        };

        assert!(validate_schedule(&schedule, from).is_err());
        assert_eq!(
            next_run_for_schedule(&schedule, from).expect("过期 at 仍应可计算"),
            None
        );
    }

    #[test]
    fn should_describe_every_schedule_in_minutes() {
        let description = describe_schedule(&TaskSchedule::Every { every_secs: 1800 });

        assert_eq!(description, "每 30 分钟");
    }
}
