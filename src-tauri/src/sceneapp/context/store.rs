use super::dto::{ContextLayerSnapshot, ReferenceItem, TasteProfile};
use crate::database::DbConnection;
use crate::workspace::WorkspaceManager;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const SCENEAPP_CONTEXT_RELATIVE_ROOT: &str = ".lime/sceneapp/context";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSceneAppContext {
    pub sceneapp_id: String,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    #[serde(default)]
    pub reference_items: Vec<ReferenceItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taste_profile: Option<TasteProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_feedback_run_id: Option<String>,
}

fn normalize_optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn sanitize_sceneapp_file_stem(sceneapp_id: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_dash = false;

    for ch in sceneapp_id.trim().chars() {
        let normalized = if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            ch
        } else {
            '-'
        };
        if normalized == '-' {
            if last_was_dash {
                continue;
            }
            last_was_dash = true;
        } else {
            last_was_dash = false;
        }
        sanitized.push(normalized);
    }

    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "sceneapp-context".to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_workspace_root(db: &DbConnection, workspace_id: &str) -> Option<PathBuf> {
    WorkspaceManager::new(db.clone())
        .get(&workspace_id.to_string())
        .ok()
        .flatten()
        .map(|workspace| workspace.root_path)
}

pub fn resolve_sceneapp_context_root(
    db: &DbConnection,
    workspace_id: Option<&str>,
    project_id: Option<&str>,
) -> Option<PathBuf> {
    normalize_optional_id(project_id)
        .and_then(|workspace_id| resolve_workspace_root(db, workspace_id.as_str()))
        .or_else(|| {
            normalize_optional_id(workspace_id)
                .and_then(|workspace_id| resolve_workspace_root(db, workspace_id.as_str()))
        })
}

pub fn resolve_sceneapp_context_path(
    db: &DbConnection,
    sceneapp_id: &str,
    workspace_id: Option<&str>,
    project_id: Option<&str>,
) -> Option<PathBuf> {
    let root = resolve_sceneapp_context_root(db, workspace_id, project_id)?;
    let file_name = format!("{}.json", sanitize_sceneapp_file_stem(sceneapp_id));
    Some(root.join(SCENEAPP_CONTEXT_RELATIVE_ROOT).join(file_name))
}

pub fn build_persisted_sceneapp_context(
    sceneapp_id: &str,
    snapshot: &ContextLayerSnapshot,
) -> PersistedSceneAppContext {
    PersistedSceneAppContext {
        sceneapp_id: sceneapp_id.trim().to_string(),
        workspace_id: snapshot.workspace_id.clone(),
        project_id: snapshot.project_id.clone(),
        reference_items: snapshot.reference_items.clone(),
        taste_profile: snapshot.taste_profile.clone(),
        last_feedback_run_id: None,
    }
}

pub fn load_persisted_sceneapp_context(
    db: &DbConnection,
    sceneapp_id: &str,
    workspace_id: Option<&str>,
    project_id: Option<&str>,
) -> Result<Option<PersistedSceneAppContext>, String> {
    let Some(path) = resolve_sceneapp_context_path(db, sceneapp_id, workspace_id, project_id)
    else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 SceneApp Context Snapshot 失败({}): {error}",
            path.display()
        )
    })?;
    let document =
        serde_json::from_str::<PersistedSceneAppContext>(raw.as_str()).map_err(|error| {
            format!(
                "解析 SceneApp Context Snapshot 失败({}): {error}",
                path.display()
            )
        })?;
    Ok(Some(document))
}

pub fn save_persisted_sceneapp_context(
    db: &DbConnection,
    context: &PersistedSceneAppContext,
) -> Result<Option<PathBuf>, String> {
    let Some(path) = resolve_sceneapp_context_path(
        db,
        context.sceneapp_id.as_str(),
        context.workspace_id.as_deref(),
        context.project_id.as_deref(),
    ) else {
        return Ok(None);
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "创建 SceneApp Context Snapshot 目录失败({}): {error}",
                parent.display()
            )
        })?;
    }

    let serialized = serde_json::to_string_pretty(context)
        .map_err(|error| format!("序列化 SceneApp Context Snapshot 失败: {error}"))?;
    fs::write(&path, serialized.as_bytes()).map_err(|error| {
        format!(
            "写入 SceneApp Context Snapshot 失败({}): {error}",
            path.display()
        )
    })?;

    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::{
        build_persisted_sceneapp_context, load_persisted_sceneapp_context,
        save_persisted_sceneapp_context,
    };
    use crate::database::schema::create_tables;
    use crate::database::DbConnection;
    use crate::workspace::{WorkspaceManager, WorkspaceType};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn should_save_and_load_sceneapp_context_snapshot_under_workspace_root() {
        let db = setup_test_db();
        let temp_dir = tempdir().expect("创建临时目录失败");
        let workspace_root = temp_dir.path().join("sceneapp-context-workspace");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "SceneApp Context".to_string(),
                workspace_root.clone(),
                WorkspaceType::General,
            )
            .expect("创建 workspace 失败");

        let snapshot = crate::sceneapp::context::dto::ContextLayerSnapshot {
            workspace_id: Some(workspace.id.clone()),
            project_id: Some(workspace.id.clone()),
            skill_refs: vec!["story-video-suite".to_string()],
            memory_refs: vec![format!("workspace:{}", workspace.id)],
            tool_refs: vec!["workspace_storage".to_string()],
            reference_items: vec![crate::sceneapp::context::dto::ReferenceItem {
                id: "slot-style-a1b2".to_string(),
                label: "style".to_string(),
                source_kind:
                    crate::sceneapp::context::dto::ContextLayerSourceKind::ReferenceLibrary,
                content_type: "slot".to_string(),
                uri: None,
                summary: Some("科技感，快节奏".to_string()),
                selected: true,
                usage_count: Some(1),
                last_used_at: Some("2026-04-17T00:00:00.000Z".to_string()),
                last_feedback_label: Some("可继续复用".to_string()),
            }],
            taste_profile: Some(crate::sceneapp::context::dto::TasteProfile {
                profile_id: "taste-story-video-suite".to_string(),
                summary: "偏好快节奏科技感表达。".to_string(),
                keywords: vec!["快节奏".to_string(), "科技感".to_string()],
                avoid_keywords: vec!["冗长铺垫".to_string()],
                derived_from_reference_ids: vec!["slot-style-a1b2".to_string()],
                confidence: Some(0.72),
                feedback_summary: Some("最近一次运行已沉淀为正向风格反馈。".to_string()),
                feedback_signals: vec!["publish_ready".to_string()],
                last_feedback_at: Some("2026-04-17T00:00:00.000Z".to_string()),
            }),
        };
        let persisted = build_persisted_sceneapp_context("story-video-suite", &snapshot);

        let path = save_persisted_sceneapp_context(&db, &persisted)
            .expect("写入 SceneApp Context Snapshot 失败")
            .expect("应返回写入路径");
        assert!(path.exists());

        let loaded = load_persisted_sceneapp_context(
            &db,
            "story-video-suite",
            Some(workspace.id.as_str()),
            Some(workspace.id.as_str()),
        )
        .expect("读取 SceneApp Context Snapshot 失败");

        assert_eq!(loaded, Some(persisted));
    }
}
