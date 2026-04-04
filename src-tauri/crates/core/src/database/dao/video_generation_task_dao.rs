//! 视频生成任务数据访问层
//!
//! 提供视频生成任务（`video_generation_tasks`）的 CRUD 操作。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 视频生成任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoGenerationTaskStatus {
    Pending,
    Processing,
    Success,
    Error,
    Cancelled,
}

impl VideoGenerationTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Success => "success",
            Self::Error => "error",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "pending" => Self::Pending,
            "processing" => Self::Processing,
            "success" => Self::Success,
            "error" => Self::Error,
            "cancelled" => Self::Cancelled,
            _ => Self::Error,
        }
    }
}

impl std::fmt::Display for VideoGenerationTaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 视频生成任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenerationTask {
    pub id: String,
    pub project_id: String,
    pub provider_id: String,
    pub model: String,
    pub prompt: String,
    pub request_payload: Option<String>,
    pub provider_task_id: Option<String>,
    pub status: VideoGenerationTaskStatus,
    pub progress: Option<i64>,
    pub result_url: Option<String>,
    pub error_message: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
}

/// 创建视频任务参数
#[derive(Debug, Clone)]
pub struct CreateVideoGenerationTaskParams {
    pub project_id: String,
    pub provider_id: String,
    pub model: String,
    pub prompt: String,
    pub request_payload: Option<String>,
    pub metadata_json: Option<String>,
}

/// 更新视频任务状态参数
#[derive(Debug, Clone, Default)]
pub struct UpdateVideoGenerationTaskParams {
    pub provider_task_id: Option<Option<String>>,
    pub status: Option<VideoGenerationTaskStatus>,
    pub progress: Option<Option<i64>>,
    pub result_url: Option<Option<String>>,
    pub error_message: Option<Option<String>>,
    pub metadata_json: Option<Option<String>>,
    pub finished_at: Option<Option<i64>>,
}

/// 视频任务 DAO
pub struct VideoGenerationTaskDao;

impl VideoGenerationTaskDao {
    /// 创建视频生成任务
    pub fn create(
        conn: &Connection,
        params: &CreateVideoGenerationTaskParams,
    ) -> Result<VideoGenerationTask, rusqlite::Error> {
        let now = chrono::Utc::now().timestamp();
        let id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO video_generation_tasks (
                id, project_id, provider_id, model, prompt, request_payload, provider_task_id,
                status, progress, result_url, error_message, metadata_json,
                created_at, updated_at, finished_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, NULL, NULL, NULL, ?8, ?9, ?10, NULL)",
            params![
                id,
                params.project_id,
                params.provider_id,
                params.model,
                params.prompt,
                params.request_payload,
                VideoGenerationTaskStatus::Pending.as_str(),
                params.metadata_json,
                now,
                now,
            ],
        )?;

        Self::get_by_id(conn, &id).map(|task| task.expect("刚创建的任务必须可读取"))
    }

    /// 按 ID 获取任务
    pub fn get_by_id(
        conn: &Connection,
        id: &str,
    ) -> Result<Option<VideoGenerationTask>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT
                id, project_id, provider_id, model, prompt, request_payload, provider_task_id,
                status, progress, result_url, error_message, metadata_json,
                created_at, updated_at, finished_at
             FROM video_generation_tasks
             WHERE id = ?1",
        )?;

        stmt.query_row([id], Self::map_row).optional()
    }

    /// 按项目列出任务（按创建时间倒序）
    pub fn list_by_project(
        conn: &Connection,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<VideoGenerationTask>, rusqlite::Error> {
        let bounded_limit = limit.clamp(1, 200);
        let mut stmt = conn.prepare(
            "SELECT
                id, project_id, provider_id, model, prompt, request_payload, provider_task_id,
                status, progress, result_url, error_message, metadata_json,
                created_at, updated_at, finished_at
             FROM video_generation_tasks
             WHERE project_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![project_id, bounded_limit], Self::map_row)?;
        Ok(rows.filter_map(|row| row.ok()).collect())
    }

    /// 更新任务状态
    pub fn update_task(
        conn: &Connection,
        id: &str,
        params: &UpdateVideoGenerationTaskParams,
    ) -> Result<Option<VideoGenerationTask>, rusqlite::Error> {
        let mut task = match Self::get_by_id(conn, id)? {
            Some(value) => value,
            None => return Ok(None),
        };

        if let Some(provider_task_id) = &params.provider_task_id {
            task.provider_task_id = provider_task_id.clone();
        }
        if let Some(status) = params.status {
            task.status = status;
        }
        if let Some(progress) = &params.progress {
            task.progress = *progress;
        }
        if let Some(result_url) = &params.result_url {
            task.result_url = result_url.clone();
        }
        if let Some(error_message) = &params.error_message {
            task.error_message = error_message.clone();
        }
        if let Some(metadata_json) = &params.metadata_json {
            task.metadata_json = metadata_json.clone();
        }
        if let Some(finished_at) = params.finished_at {
            task.finished_at = finished_at;
        }

        task.updated_at = chrono::Utc::now().timestamp();

        conn.execute(
            "UPDATE video_generation_tasks
             SET provider_task_id = ?2,
                 status = ?3,
                 progress = ?4,
                 result_url = ?5,
                 error_message = ?6,
                 metadata_json = ?7,
                 updated_at = ?8,
                 finished_at = ?9
             WHERE id = ?1",
            params![
                task.id,
                task.provider_task_id,
                task.status.as_str(),
                task.progress,
                task.result_url,
                task.error_message,
                task.metadata_json,
                task.updated_at,
                task.finished_at,
            ],
        )?;

        Ok(Some(task))
    }

    fn map_row(row: &rusqlite::Row<'_>) -> Result<VideoGenerationTask, rusqlite::Error> {
        let status_value: String = row.get(7)?;

        Ok(VideoGenerationTask {
            id: row.get(0)?,
            project_id: row.get(1)?,
            provider_id: row.get(2)?,
            model: row.get(3)?,
            prompt: row.get(4)?,
            request_payload: row.get(5)?,
            provider_task_id: row.get(6)?,
            status: VideoGenerationTaskStatus::from_db(&status_value),
            progress: row.get(8)?,
            result_url: row.get(9)?,
            error_message: row.get(10)?,
            metadata_json: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
            finished_at: row.get(14)?,
        })
    }
}
