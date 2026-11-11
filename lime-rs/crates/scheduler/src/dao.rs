//! Agent Scheduler 数据访问层
//!
//! 提供任务的持久化存储功能

use super::types::{ScheduledTask, TaskFilter, TaskStatus};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use tracing::warn;

pub struct SchedulerDao;

impl SchedulerDao {
    /// 创建任务表
    pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                task_type TEXT NOT NULL,
                params TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                model TEXT NOT NULL,
                status TEXT NOT NULL,
                scheduled_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                result TEXT,
                error_message TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                auto_disabled_until TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        Self::ensure_columns(conn)?;

        // 创建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_scheduled_at ON scheduled_tasks(scheduled_at)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_provider_type ON scheduled_tasks(provider_type)",
            [],
        )?;

        Ok(())
    }

    fn ensure_columns(conn: &Connection) -> Result<(), rusqlite::Error> {
        let mut stmt = conn.prepare("PRAGMA table_info(scheduled_tasks)")?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<HashSet<_>, _>>()?;

        if !columns.contains("consecutive_failures") {
            conn.execute(
                "ALTER TABLE scheduled_tasks ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !columns.contains("auto_disabled_until") {
            conn.execute(
                "ALTER TABLE scheduled_tasks ADD COLUMN auto_disabled_until TEXT",
                [],
            )?;
        }

        Ok(())
    }

    /// 创建新任务
    pub fn create_task(conn: &Connection, task: &ScheduledTask) -> Result<(), rusqlite::Error> {
        let params_json = serde_json::to_string(&task.params)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let result_json = task
            .result
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "INSERT INTO scheduled_tasks (
                id, name, description, task_type, params, provider_type, model,
                status, scheduled_at, started_at, completed_at, result, error_message,
                retry_count, max_retries, consecutive_failures, auto_disabled_until, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                task.id,
                task.name,
                task.description,
                task.task_type,
                params_json,
                task.provider_type,
                task.model,
                task.status.to_string(),
                task.scheduled_at,
                task.started_at,
                task.completed_at,
                result_json,
                task.error_message,
                task.retry_count,
                task.max_retries,
                task.consecutive_failures,
                task.auto_disabled_until,
                task.created_at,
                task.updated_at,
            ],
        )?;

        Ok(())
    }

    /// 获取任务
    pub fn get_task(conn: &Connection, id: &str) -> Result<Option<ScheduledTask>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, name, description, task_type, params, provider_type, model,
                    status, scheduled_at, started_at, completed_at, result, error_message,
                    retry_count, max_retries, consecutive_failures, auto_disabled_until, created_at, updated_at
             FROM scheduled_tasks WHERE id = ?",
        )?;

        let mut rows = stmt.query([id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_task(row)?))
        } else {
            Ok(None)
        }
    }

    /// 查询任务列表
    pub fn list_tasks(
        conn: &Connection,
        filter: &TaskFilter,
    ) -> Result<Vec<ScheduledTask>, rusqlite::Error> {
        let mut query = String::from(
            "SELECT id, name, description, task_type, params, provider_type, model,
                    status, scheduled_at, started_at, completed_at, result, error_message,
                    retry_count, max_retries, consecutive_failures, auto_disabled_until, created_at, updated_at
             FROM scheduled_tasks WHERE 1=1",
        );

        let mut params = Vec::new();

        if let Some(status) = &filter.status {
            query.push_str(&format!(" AND status = ?{}", params.len() + 1));
            params.push(status.to_string());
        }

        if let Some(provider_type) = &filter.provider_type {
            query.push_str(&format!(" AND provider_type = ?{}", params.len() + 1));
            params.push(provider_type.clone());
        }

        if let Some(task_type) = &filter.task_type {
            query.push_str(&format!(" AND task_type = ?{}", params.len() + 1));
            params.push(task_type.clone());
        }

        if filter.only_due {
            query.push_str(&format!(
                " AND status = 'pending'
                  AND datetime(scheduled_at) <= datetime('now')
                  AND (auto_disabled_until IS NULL OR datetime(auto_disabled_until) <= datetime('now'))"
            ));
        }

        query.push_str(" ORDER BY scheduled_at ASC");

        if let Some(limit) = filter.limit {
            query.push_str(&format!(" LIMIT {}", limit));
        }

        let mut stmt = conn.prepare(&query)?;

        let param_refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();

        let tasks = stmt.query_map(param_refs.as_slice(), |row| Self::row_to_task(row))?;

        tasks.collect()
    }

    /// 更新任务
    pub fn update_task(conn: &Connection, task: &ScheduledTask) -> Result<(), rusqlite::Error> {
        let params_json = serde_json::to_string(&task.params)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let result_json = task
            .result
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "UPDATE scheduled_tasks SET
                name = ?1, description = ?2, task_type = ?3, params = ?4,
                provider_type = ?5, model = ?6, status = ?7, scheduled_at = ?8,
                started_at = ?9, completed_at = ?10, result = ?11, error_message = ?12,
                retry_count = ?13, max_retries = ?14, consecutive_failures = ?15,
                auto_disabled_until = ?16, updated_at = ?17
             WHERE id = ?18",
            params![
                task.name,
                task.description,
                task.task_type,
                params_json,
                task.provider_type,
                task.model,
                task.status.to_string(),
                task.scheduled_at,
                task.started_at,
                task.completed_at,
                result_json,
                task.error_message,
                task.retry_count,
                task.max_retries,
                task.consecutive_failures,
                task.auto_disabled_until,
                task.updated_at,
                task.id,
            ],
        )?;

        Ok(())
    }

    /// 删除任务
    pub fn delete_task(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let rows = conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", [id])?;
        Ok(rows > 0)
    }

    /// 获取到期任务
    pub fn get_due_tasks(
        conn: &Connection,
        limit: usize,
    ) -> Result<Vec<ScheduledTask>, rusqlite::Error> {
        let limit = i64::try_from(limit)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, task_type, params, provider_type, model,
                    status, scheduled_at, started_at, completed_at, result, error_message,
                    retry_count, max_retries, consecutive_failures, auto_disabled_until, created_at, updated_at
             FROM scheduled_tasks
             WHERE status = 'pending'
               AND datetime(scheduled_at) <= datetime('now')
               AND (auto_disabled_until IS NULL OR datetime(auto_disabled_until) <= datetime('now'))
             ORDER BY scheduled_at ASC
             LIMIT ?",
        )?;

        let tasks = stmt.query_map([limit], |row| Self::row_to_task(row))?;

        tasks.collect()
    }

    /// 将数据库行转换为 ScheduledTask
    fn row_to_task(row: &rusqlite::Row) -> Result<ScheduledTask, rusqlite::Error> {
        let params_json: String = row.get(4)?;
        let params: serde_json::Value = serde_json::from_str(&params_json).map_err(|e| {
            warn!("Failed to parse params JSON: {}", e);
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?;

        let result_json: Option<String> = row.get(11)?;
        let result = result_json
            .map(|json| {
                serde_json::from_str(&json).map_err(|e| {
                    warn!("Failed to parse result JSON: {}", e);
                    rusqlite::Error::FromSqlConversionFailure(
                        11,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
            })
            .transpose()?;

        let status_str: String = row.get(7)?;
        let status = match status_str.as_str() {
            "pending" => TaskStatus::Pending,
            "running" => TaskStatus::Running,
            "completed" => TaskStatus::Completed,
            "failed" => TaskStatus::Failed,
            "cancelled" => TaskStatus::Cancelled,
            _ => {
                warn!("Unknown task status: {}, defaulting to pending", status_str);
                TaskStatus::Pending
            }
        };

        Ok(ScheduledTask {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            task_type: row.get(3)?,
            params,
            provider_type: row.get(5)?,
            model: row.get(6)?,
            status,
            scheduled_at: row.get(8)?,
            started_at: row.get(9)?,
            completed_at: row.get(10)?,
            result,
            error_message: row.get(12)?,
            retry_count: row.get(13)?,
            max_retries: row.get(14)?,
            consecutive_failures: row.get(15)?,
            auto_disabled_until: row.get(16)?,
            created_at: row.get(17)?,
            updated_at: row.get(18)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        SchedulerDao::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn test_create_and_get_task() {
        let conn = setup_test_db();

        let task = ScheduledTask::new(
            "Test Task".to_string(),
            "test_type".to_string(),
            serde_json::json!({"key": "value"}),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        SchedulerDao::create_task(&conn, &task).unwrap();
        let retrieved = SchedulerDao::get_task(&conn, &task.id).unwrap().unwrap();

        assert_eq!(retrieved.id, task.id);
        assert_eq!(retrieved.name, task.name);
        assert_eq!(retrieved.task_type, task.task_type);
    }

    #[test]
    fn test_list_tasks_with_filter() {
        let conn = setup_test_db();

        let task1 = ScheduledTask::new(
            "Task 1".to_string(),
            "type_a".to_string(),
            serde_json::json!(null),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        let task2 = ScheduledTask::new(
            "Task 2".to_string(),
            "type_b".to_string(),
            serde_json::json!(null),
            "anthropic".to_string(),
            "claude-3".to_string(),
            Utc::now(),
        );

        SchedulerDao::create_task(&conn, &task1).unwrap();
        SchedulerDao::create_task(&conn, &task2).unwrap();

        // 查询所有
        let all = SchedulerDao::list_tasks(&conn, &TaskFilter::default()).unwrap();
        assert_eq!(all.len(), 2);

        // 按 task_type 过滤
        let filtered = SchedulerDao::list_tasks(
            &conn,
            &TaskFilter {
                task_type: Some("type_a".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].task_type, "type_a");
    }

    #[test]
    fn test_update_task() {
        let conn = setup_test_db();

        let mut task = ScheduledTask::new(
            "Test".to_string(),
            "test".to_string(),
            serde_json::json!(null),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        SchedulerDao::create_task(&conn, &task).unwrap();

        task.mark_completed(Some(serde_json::json!("done")));
        SchedulerDao::update_task(&conn, &task).unwrap();

        let updated = SchedulerDao::get_task(&conn, &task.id).unwrap().unwrap();
        assert_eq!(updated.status, TaskStatus::Completed);
        assert_eq!(updated.result, Some(serde_json::json!("done")));
        assert_eq!(updated.consecutive_failures, 0);
    }

    #[test]
    fn test_delete_task() {
        let conn = setup_test_db();

        let task = ScheduledTask::new(
            "Test".to_string(),
            "test".to_string(),
            serde_json::json!(null),
            "openai".to_string(),
            "gpt-4".to_string(),
            Utc::now(),
        );

        SchedulerDao::create_task(&conn, &task).unwrap();
        assert!(SchedulerDao::delete_task(&conn, &task.id).unwrap());

        let retrieved = SchedulerDao::get_task(&conn, &task.id).unwrap();
        assert!(retrieved.is_none());
    }

    #[test]
    fn test_create_tables_should_add_missing_columns_for_existing_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE scheduled_tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                task_type TEXT NOT NULL,
                params TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                model TEXT NOT NULL,
                status TEXT NOT NULL,
                scheduled_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                result TEXT,
                error_message TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .unwrap();

        SchedulerDao::create_tables(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(scheduled_tasks)").unwrap();
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.contains(&"consecutive_failures".to_string()));
        assert!(columns.contains(&"auto_disabled_until".to_string()));
    }
}
