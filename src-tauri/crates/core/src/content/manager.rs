//! Content 管理器
//!
//! 提供 Content 的 CRUD 操作。

use std::str::FromStr;

use super::types::{
    Content, ContentCreateRequest, ContentId, ContentListQuery, ContentStatus, ContentType,
    ContentUpdateRequest,
};
use crate::database::DbConnection;
use crate::workspace::WorkspaceType;
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

/// Content 管理器
#[derive(Clone)]
pub struct ContentManager {
    db: DbConnection,
}

impl ContentManager {
    /// 创建新的 ContentManager
    pub fn new(db: DbConnection) -> Self {
        Self { db }
    }

    /// 创建新内容
    pub fn create(&self, request: ContentCreateRequest) -> Result<Content, String> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();

        // 获取下一个排序顺序
        let order = match request.order {
            Some(o) => o,
            None => self.get_next_order(&request.project_id)?,
        };

        let body = request.body.unwrap_or_default();
        let word_count = count_words(&body);
        let content_type = match request.content_type {
            Some(content_type) => content_type,
            None => self.get_default_content_type(&request.project_id),
        };
        let metadata_json = request
            .metadata
            .as_ref()
            .map(|m| serde_json::to_string(m).unwrap_or_default());

        let content = Content {
            id: id.clone(),
            project_id: request.project_id.clone(),
            title: request.title,
            content_type: content_type.clone(),
            status: ContentStatus::Draft,
            order,
            body,
            word_count,
            metadata: request.metadata,
            session_id: None,
            created_at: now,
            updated_at: now,
        };

        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        conn.execute(
            "INSERT INTO contents (id, project_id, title, content_type, status, sort_order, body, word_count, metadata_json, session_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &content.id,
                &content.project_id,
                &content.title,
                content.content_type.as_str(),
                content.status.as_str(),
                content.order,
                &content.body,
                content.word_count,
                &metadata_json,
                &content.session_id,
                content.created_at.timestamp_millis(),
                content.updated_at.timestamp_millis(),
            ],
        )
        .map_err(|e| format!("创建内容失败: {e}"))?;

        tracing::info!(
            "[Content] 创建: id={}, project_id={}, title={}",
            content.id,
            content.project_id,
            content.title
        );

        Ok(content)
    }

    /// 获取项目默认内容类型（兜底）
    fn get_default_content_type(&self, project_id: &str) -> ContentType {
        let conn = match self.db.lock() {
            Ok(conn) => conn,
            Err(_) => return ContentType::Document,
        };

        let workspace_type: Result<String, _> = conn.query_row(
            "SELECT workspace_type FROM workspaces WHERE id = ?",
            params![project_id],
            |row| row.get(0),
        );

        let workspace_type = match workspace_type {
            Ok(value) => WorkspaceType::parse(&value),
            Err(_) => return ContentType::Document,
        };

        match workspace_type {
            WorkspaceType::Video => ContentType::Episode,
            WorkspaceType::SocialMedia => ContentType::Post,
            WorkspaceType::General => ContentType::Content,
            WorkspaceType::Document => ContentType::Document,
            WorkspaceType::Knowledge
            | WorkspaceType::Planning
            | WorkspaceType::Persistent
            | WorkspaceType::Temporary => ContentType::Document,
        }
    }

    /// 获取内容
    pub fn get(&self, id: &ContentId) -> Result<Option<Content>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result = conn.query_row(
            "SELECT id, project_id, title, content_type, status, sort_order, body, word_count, metadata_json, session_id, created_at, updated_at
             FROM contents WHERE id = ?",
            params![id],
            Self::row_to_content,
        );

        match result {
            Ok(content) => Ok(Some(content)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("获取内容失败: {e}")),
        }
    }

    /// 列出项目下的所有内容
    pub fn list_by_project(
        &self,
        project_id: &str,
        query: Option<ContentListQuery>,
    ) -> Result<Vec<Content>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let query = query.unwrap_or_default();

        // 构建查询
        let mut sql = String::from(
            "SELECT id, project_id, title, content_type, status, sort_order, body, word_count, metadata_json, session_id, created_at, updated_at
             FROM contents WHERE project_id = ?",
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(project_id.to_string())];

        // 状态过滤
        if let Some(ref status) = query.status {
            sql.push_str(" AND status = ?");
            params_vec.push(Box::new(status.as_str().to_string()));
        }

        // 内容类型过滤
        if let Some(ref content_type) = query.content_type {
            sql.push_str(" AND content_type = ?");
            params_vec.push(Box::new(content_type.as_str().to_string()));
        }

        // 搜索
        if let Some(ref search) = query.search {
            sql.push_str(" AND (title LIKE ? OR body LIKE ?)");
            let search_pattern = format!("%{search}%");
            params_vec.push(Box::new(search_pattern.clone()));
            params_vec.push(Box::new(search_pattern));
        }

        // 排序
        let sort_by = query.sort_by.unwrap_or_else(|| "sort_order".to_string());
        let sort_order = query.sort_order.unwrap_or_else(|| "asc".to_string());
        sql.push_str(&format!(" ORDER BY {sort_by} {sort_order}"));

        // 分页
        if let Some(limit) = query.limit {
            sql.push_str(" LIMIT ?");
            params_vec.push(Box::new(limit));
        }
        if let Some(offset) = query.offset {
            sql.push_str(" OFFSET ?");
            params_vec.push(Box::new(offset));
        }

        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let contents = stmt
            .query_map(params_refs.as_slice(), Self::row_to_content)
            .map_err(|e| format!("查询失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析结果失败: {e}"))?;

        Ok(contents)
    }

    /// 更新内容
    pub fn update(&self, id: &ContentId, updates: ContentUpdateRequest) -> Result<Content, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let now = Utc::now().timestamp_millis();

        // 构建更新语句
        let mut set_clauses = vec!["updated_at = ?"];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

        if let Some(ref title) = updates.title {
            set_clauses.push("title = ?");
            params_vec.push(Box::new(title.clone()));
        }

        if let Some(ref status) = updates.status {
            set_clauses.push("status = ?");
            params_vec.push(Box::new(status.as_str().to_string()));
        }

        if let Some(order) = updates.order {
            set_clauses.push("sort_order = ?");
            params_vec.push(Box::new(order));
        }

        if let Some(ref body) = updates.body {
            set_clauses.push("body = ?");
            params_vec.push(Box::new(body.clone()));
            set_clauses.push("word_count = ?");
            params_vec.push(Box::new(count_words(body)));
        }

        if let Some(ref metadata) = updates.metadata {
            let metadata_json = serde_json::to_string(metadata).map_err(|e| e.to_string())?;
            set_clauses.push("metadata_json = ?");
            params_vec.push(Box::new(metadata_json));
        }

        if let Some(ref session_id) = updates.session_id {
            set_clauses.push("session_id = ?");
            params_vec.push(Box::new(session_id.clone()));
        }

        params_vec.push(Box::new(id.clone()));

        let sql = format!(
            "UPDATE contents SET {} WHERE id = ?",
            set_clauses.join(", ")
        );

        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        conn.execute(&sql, params_refs.as_slice())
            .map_err(|e| format!("更新内容失败: {e}"))?;

        drop(conn);

        self.get(id)?.ok_or_else(|| "内容不存在".to_string())
    }

    /// 删除内容
    pub fn delete(&self, id: &ContentId) -> Result<bool, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let affected = conn
            .execute("DELETE FROM contents WHERE id = ?", params![id])
            .map_err(|e| format!("删除内容失败: {e}"))?;

        if affected > 0 {
            tracing::info!("[Content] 删除: id={}", id);
        }

        Ok(affected > 0)
    }

    /// 批量删除项目下的所有内容
    pub fn delete_by_project(&self, project_id: &str) -> Result<i64, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let affected = conn
            .execute(
                "DELETE FROM contents WHERE project_id = ?",
                params![project_id],
            )
            .map_err(|e| format!("删除内容失败: {e}"))?;

        tracing::info!(
            "[Content] 批量删除: project_id={}, count={}",
            project_id,
            affected
        );

        Ok(affected as i64)
    }

    /// 获取项目的内容统计
    pub fn get_project_stats(&self, project_id: &str) -> Result<(i64, i64, i64), String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(word_count), 0), COUNT(CASE WHEN status = 'completed' THEN 1 END)
             FROM contents WHERE project_id = ?",
            params![project_id],
            |row| {
                let count: i64 = row.get(0)?;
                let words: i64 = row.get(1)?;
                let completed: i64 = row.get(2)?;
                Ok((count, words, completed))
            },
        );

        match result {
            Ok(stats) => Ok(stats),
            Err(e) => Err(format!("获取统计失败: {e}")),
        }
    }

    /// 重新排序内容
    pub fn reorder(&self, project_id: &str, content_ids: Vec<String>) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        for (index, content_id) in content_ids.iter().enumerate() {
            conn.execute(
                "UPDATE contents SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?",
                params![
                    index as i32,
                    Utc::now().timestamp_millis(),
                    content_id,
                    project_id
                ],
            )
            .map_err(|e| format!("重新排序失败: {e}"))?;
        }

        Ok(())
    }

    /// 获取下一个排序顺序
    fn get_next_order(&self, project_id: &str) -> Result<i32, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result: Result<i32, _> = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM contents WHERE project_id = ?",
            params![project_id],
            |row| row.get(0),
        );

        result.map_err(|e| format!("获取排序顺序失败: {e}"))
    }

    /// 从数据库行解析 Content
    fn row_to_content(row: &rusqlite::Row) -> Result<Content, rusqlite::Error> {
        let id: String = row.get(0)?;
        let project_id: String = row.get(1)?;
        let title: String = row.get(2)?;
        let content_type_str: String = row.get(3)?;
        let status_str: String = row.get(4)?;
        let order: i32 = row.get(5)?;
        let body: String = row.get(6)?;
        let word_count: i64 = row.get(7)?;
        let metadata_json: Option<String> = row.get(8)?;
        let session_id: Option<String> = row.get(9)?;
        let created_at_ms: i64 = row.get(10)?;
        let updated_at_ms: i64 = row.get(11)?;

        let metadata = metadata_json.and_then(|s| serde_json::from_str(&s).ok());

        Ok(Content {
            id,
            project_id,
            title,
            content_type: ContentType::from_str(&content_type_str).unwrap_or_default(),
            status: ContentStatus::from_str(&status_str).unwrap_or_default(),
            order,
            body,
            word_count,
            metadata,
            session_id,
            created_at: chrono::DateTime::from_timestamp_millis(created_at_ms)
                .unwrap_or_else(Utc::now),
            updated_at: chrono::DateTime::from_timestamp_millis(updated_at_ms)
                .unwrap_or_else(Utc::now),
        })
    }
}

/// 计算字数（支持中英文混合）
fn count_words(text: &str) -> i64 {
    let mut count = 0i64;
    let mut in_word = false;

    for c in text.chars() {
        if c.is_whitespace() {
            in_word = false;
        } else if c.is_ascii_alphanumeric() {
            if !in_word {
                count += 1;
                in_word = true;
            }
        } else if !c.is_ascii_punctuation() {
            // 非 ASCII 字符（如中文）每个字符计为一个字
            count += 1;
            in_word = false;
        }
    }

    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_words() {
        assert_eq!(count_words("hello world"), 2);
        assert_eq!(count_words("你好世界"), 4);
        assert_eq!(count_words("hello 世界"), 3);
        assert_eq!(count_words(""), 0);
    }
}
