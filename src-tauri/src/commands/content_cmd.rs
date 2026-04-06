//! Content 相关的 Tauri 命令
//!
//! 提供内容管理的前端 API。

use crate::content::{
    Content, ContentCreateRequest, ContentListQuery, ContentManager, ContentUpdateRequest,
};
use crate::database::DbConnection;
use serde::{Deserialize, Serialize};
use tauri::State;

pub(crate) const GENERAL_WORKBENCH_DOCUMENT_META_KEY: &str = "general_workbench_document_v1";
pub(crate) const LEGACY_GENERAL_WORKBENCH_DOCUMENT_META_KEY: &str = "theme_workbench_document_v1";

/// 内容列表项（用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentListItem {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content_type: String,
    pub status: String,
    pub order: i32,
    pub word_count: i64,
    pub metadata: Option<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Content> for ContentListItem {
    fn from(content: Content) -> Self {
        Self {
            id: content.id,
            project_id: content.project_id,
            title: content.title,
            content_type: content.content_type.as_str().to_string(),
            status: content.status.as_str().to_string(),
            order: content.order,
            word_count: content.word_count,
            metadata: content.metadata,
            created_at: content.created_at.timestamp_millis(),
            updated_at: content.updated_at.timestamp_millis(),
        }
    }
}

/// 内容详情（包含正文）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentDetail {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content_type: String,
    pub status: String,
    pub order: i32,
    pub body: String,
    pub word_count: i64,
    pub metadata: Option<serde_json::Value>,
    pub session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Content> for ContentDetail {
    fn from(content: Content) -> Self {
        Self {
            id: content.id,
            project_id: content.project_id,
            title: content.title,
            content_type: content.content_type.as_str().to_string(),
            status: content.status.as_str().to_string(),
            order: content.order,
            body: content.body,
            word_count: content.word_count,
            metadata: content.metadata,
            session_id: content.session_id,
            created_at: content.created_at.timestamp_millis(),
            updated_at: content.updated_at.timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralWorkbenchVersionState {
    pub id: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralWorkbenchDocumentState {
    pub content_id: String,
    pub current_version_id: String,
    pub version_count: usize,
    pub versions: Vec<GeneralWorkbenchVersionState>,
}

fn is_valid_topic_branch_status(status: &str) -> bool {
    matches!(status, "in_progress" | "pending" | "merged" | "candidate")
}

pub(crate) fn parse_general_workbench_document_state(
    content_id: &str,
    metadata: Option<&serde_json::Value>,
) -> Option<GeneralWorkbenchDocumentState> {
    let metadata = metadata?.as_object()?;
    let raw = metadata
        .get(GENERAL_WORKBENCH_DOCUMENT_META_KEY)
        .or_else(|| metadata.get(LEGACY_GENERAL_WORKBENCH_DOCUMENT_META_KEY))?
        .as_object()?;

    let versions_raw = raw.get("versions")?.as_array()?;
    if versions_raw.is_empty() {
        return None;
    }

    let current_version_id = raw.get("currentVersionId")?.as_str()?.trim().to_string();
    if current_version_id.is_empty() {
        return None;
    }

    let status_map = raw
        .get("versionStatusMap")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let versions: Vec<GeneralWorkbenchVersionState> = versions_raw
        .iter()
        .filter_map(|version| {
            let version_obj = version.as_object()?;
            let id = version_obj.get("id")?.as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }

            let created_at = version_obj
                .get("createdAt")
                .and_then(|value| value.as_i64())
                .or_else(|| {
                    version_obj
                        .get("created_at")
                        .and_then(|value| value.as_i64())
                })?;

            let description = version_obj
                .get("description")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);

            let status = status_map
                .get(&id)
                .and_then(|value| value.as_str())
                .filter(|value| is_valid_topic_branch_status(value))
                .map(ToString::to_string);

            Some(GeneralWorkbenchVersionState {
                is_current: id == current_version_id,
                id,
                created_at,
                description,
                status,
            })
        })
        .collect();

    if versions.is_empty() {
        return None;
    }

    if !versions
        .iter()
        .any(|version| version.id == current_version_id)
    {
        return None;
    }

    Some(GeneralWorkbenchDocumentState {
        content_id: content_id.to_string(),
        current_version_id,
        version_count: versions.len(),
        versions,
    })
}

/// 创建内容请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContentRequest {
    pub project_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// 更新内容请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateContentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// 内容列表查询请求
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListContentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

/// 创建内容
#[tauri::command]
pub async fn content_create(
    db: State<'_, DbConnection>,
    request: CreateContentRequest,
) -> Result<ContentDetail, String> {
    let manager = ContentManager::new(db.inner().clone());

    let create_request = ContentCreateRequest {
        project_id: request.project_id,
        title: request.title,
        content_type: request.content_type.map(|s| s.parse().unwrap_or_default()),
        order: request.order,
        body: request.body,
        metadata: request.metadata,
    };

    let content = manager.create(create_request)?;
    Ok(content.into())
}

/// 获取内容详情
#[tauri::command]
pub async fn content_get(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<ContentDetail>, String> {
    let manager = ContentManager::new(db.inner().clone());
    let content = manager.get(&id)?;
    Ok(content.map(|c| c.into()))
}

/// 获取工作区文稿版本状态（从 content.metadata 解析）
#[tauri::command]
pub async fn content_get_general_workbench_document_state(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<GeneralWorkbenchDocumentState>, String> {
    let manager = ContentManager::new(db.inner().clone());
    let content = manager.get(&id)?;
    Ok(content
        .and_then(|item| parse_general_workbench_document_state(&item.id, item.metadata.as_ref())))
}

/// 列出项目的所有内容
#[tauri::command]
pub async fn content_list(
    db: State<'_, DbConnection>,
    project_id: String,
    query: Option<ListContentRequest>,
) -> Result<Vec<ContentListItem>, String> {
    let manager = ContentManager::new(db.inner().clone());

    let list_query = query.map(|q| ContentListQuery {
        status: q.status.map(|s| s.parse().unwrap_or_default()),
        content_type: q.content_type.map(|s| s.parse().unwrap_or_default()),
        search: q.search,
        sort_by: q.sort_by,
        sort_order: q.sort_order,
        offset: q.offset,
        limit: q.limit,
    });

    let contents = manager.list_by_project(&project_id, list_query)?;
    Ok(contents.into_iter().map(|c| c.into()).collect())
}

/// 更新内容
#[tauri::command]
pub async fn content_update(
    db: State<'_, DbConnection>,
    id: String,
    request: UpdateContentRequest,
) -> Result<ContentDetail, String> {
    let manager = ContentManager::new(db.inner().clone());

    let update_request = ContentUpdateRequest {
        title: request.title,
        status: request.status.map(|s| s.parse().unwrap_or_default()),
        order: request.order,
        body: request.body,
        metadata: request.metadata,
        session_id: request.session_id,
    };

    let content = manager.update(&id, update_request)?;
    Ok(content.into())
}

/// 删除内容
#[tauri::command]
pub async fn content_delete(db: State<'_, DbConnection>, id: String) -> Result<bool, String> {
    let manager = ContentManager::new(db.inner().clone());
    manager.delete(&id)
}

/// 重新排序内容
#[tauri::command]
pub async fn content_reorder(
    db: State<'_, DbConnection>,
    project_id: String,
    content_ids: Vec<String>,
) -> Result<(), String> {
    let manager = ContentManager::new(db.inner().clone());
    manager.reorder(&project_id, content_ids)
}

/// 获取项目内容统计
#[tauri::command]
pub async fn content_stats(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<(i64, i64, i64), String> {
    let manager = ContentManager::new(db.inner().clone());
    manager.get_project_stats(&project_id)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_general_workbench_document_state, GENERAL_WORKBENCH_DOCUMENT_META_KEY,
        LEGACY_GENERAL_WORKBENCH_DOCUMENT_META_KEY,
    };

    #[test]
    fn test_parse_general_workbench_document_state_success() {
        let metadata = serde_json::json!({
          GENERAL_WORKBENCH_DOCUMENT_META_KEY: {
            "currentVersionId": "v2",
            "versions": [
              { "id": "v1", "createdAt": 1700000000000_i64, "description": "初稿" },
              { "id": "v2", "createdAt": 1700000100000_i64, "description": "修订版" }
            ],
            "versionStatusMap": {
              "v1": "merged",
              "v2": "in_progress"
            }
          }
        });

        let parsed = parse_general_workbench_document_state("content-1", Some(&metadata))
            .expect("should parse");
        assert_eq!(parsed.content_id, "content-1");
        assert_eq!(parsed.current_version_id, "v2");
        assert_eq!(parsed.version_count, 2);
        assert_eq!(parsed.versions[0].status.as_deref(), Some("merged"));
        assert!(parsed.versions[1].is_current);
    }

    #[test]
    fn test_parse_general_workbench_document_state_rejects_invalid_current_version() {
        let metadata = serde_json::json!({
          GENERAL_WORKBENCH_DOCUMENT_META_KEY: {
            "currentVersionId": "v-not-exists",
            "versions": [
              { "id": "v1", "createdAt": 1700000000000_i64, "description": "初稿" }
            ],
            "versionStatusMap": { "v1": "merged" }
          }
        });

        assert!(parse_general_workbench_document_state("content-1", Some(&metadata)).is_none());
    }

    #[test]
    fn test_parse_general_workbench_document_state_accepts_legacy_alias_key() {
        let metadata = serde_json::json!({
          LEGACY_GENERAL_WORKBENCH_DOCUMENT_META_KEY: {
            "currentVersionId": "v1",
            "versions": [
              { "id": "v1", "createdAt": 1700000000000_i64, "description": "初稿" }
            ]
          }
        });

        let parsed = parse_general_workbench_document_state("content-1", Some(&metadata))
            .expect("should parse");
        assert_eq!(parsed.current_version_id, "v1");
    }
}
