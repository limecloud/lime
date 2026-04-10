//! 受管项目路径迁移
//!
//! 统一把历史 `.proxycast/projects/...`、`.lime/projects/...` 与旧 appdata
//! 下的受管项目目录迁移到当前 `lime/projects/...` 主路径，避免数据库和
//! 会话继续暴露旧品牌目录。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::app_paths;

use super::migration_support::{
    is_migration_completed, mark_migration_completed, run_in_transaction,
};

const MIGRATION_KEY_MANAGED_WORKSPACE_PATHS_TO_LIME: &str =
    "migrated_managed_workspace_paths_to_lime_v1";

pub struct MigrationResult {
    pub executed: bool,
    pub migrated_workspaces: usize,
    pub migrated_sessions: usize,
    pub skipped_workspaces: usize,
}

pub fn migrate_managed_workspace_paths(conn: &Connection) -> Result<MigrationResult, String> {
    migrate_managed_workspace_paths_with_mapper(
        conn,
        &app_paths::migrate_managed_project_path_to_preferred,
    )
}

fn migrate_managed_workspace_paths_with_mapper<F>(
    conn: &Connection,
    remap_path: &F,
) -> Result<MigrationResult, String>
where
    F: Fn(&Path) -> Result<Option<PathBuf>, String>,
{
    if is_migration_completed(conn, MIGRATION_KEY_MANAGED_WORKSPACE_PATHS_TO_LIME) {
        tracing::debug!("[迁移] 受管项目 legacy 路径已迁移到 lime，跳过");
        return Ok(MigrationResult {
            executed: false,
            migrated_workspaces: 0,
            migrated_sessions: 0,
            skipped_workspaces: 0,
        });
    }

    match run_in_transaction(conn, |tx| {
        let (migrated_workspaces, migrated_sessions, skipped_workspaces) =
            execute_migration(tx, remap_path)?;
        mark_migration_completed(tx, MIGRATION_KEY_MANAGED_WORKSPACE_PATHS_TO_LIME)?;
        Ok((migrated_workspaces, migrated_sessions, skipped_workspaces))
    }) {
        Ok((migrated_workspaces, migrated_sessions, skipped_workspaces)) => Ok(MigrationResult {
            executed: migrated_workspaces > 0 || migrated_sessions > 0,
            migrated_workspaces,
            migrated_sessions,
            skipped_workspaces,
        }),
        Err(error) => {
            tracing::error!("[迁移] 受管项目 legacy 路径迁移失败，已回滚: {}", error);
            Err(error)
        }
    }
}

fn execute_migration<F>(conn: &Connection, remap_path: &F) -> Result<(usize, usize, usize), String>
where
    F: Fn(&Path) -> Result<Option<PathBuf>, String>,
{
    let mut path_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut workspace_updates: Vec<(String, String, String)> = Vec::new();
    let mut session_updates: Vec<(String, String)> = Vec::new();
    let mut skipped_workspaces = 0usize;

    let mut resolve_target_path = |original: &str| -> Result<Option<String>, String> {
        if let Some(cached) = path_cache.get(original) {
            return Ok(cached.clone());
        }

        let mapped =
            remap_path(Path::new(original))?.map(|path| path.to_string_lossy().to_string());
        path_cache.insert(original.to_string(), mapped.clone());
        Ok(mapped)
    };

    {
        let mut stmt = conn
            .prepare("SELECT id, root_path FROM workspaces")
            .map_err(|e| format!("查询 workspaces 失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("读取 workspaces 失败: {e}"))?;

        for row in rows {
            let (workspace_id, root_path) =
                row.map_err(|e| format!("解析 workspace 行失败: {e}"))?;
            let Some(target_path) = resolve_target_path(&root_path)? else {
                continue;
            };
            if target_path == root_path {
                continue;
            }

            if let Some(existing_workspace_id) = find_workspace_id_by_root_path(conn, &target_path)?
            {
                if existing_workspace_id != workspace_id {
                    skipped_workspaces += 1;
                    tracing::warn!(
                        "[迁移] 跳过 workspace 路径迁移，目标路径已被占用: workspace_id={}, root_path={}, target_path={}, existing_workspace_id={}",
                        workspace_id,
                        root_path,
                        target_path,
                        existing_workspace_id
                    );
                    continue;
                }
            }

            workspace_updates.push((workspace_id, root_path, target_path));
        }
    }

    for (workspace_id, original_path, target_path) in &workspace_updates {
        conn.execute(
            "UPDATE workspaces SET root_path = ?1 WHERE id = ?2",
            params![target_path, workspace_id],
        )
        .map_err(|e| {
            format!(
                "更新 workspace 路径失败: workspace_id={}, root_path={} -> {}: {e}",
                workspace_id, original_path, target_path
            )
        })?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, working_dir
                 FROM agent_sessions
                 WHERE working_dir IS NOT NULL
                 AND TRIM(working_dir) != ''",
            )
            .map_err(|e| format!("查询 agent_sessions 失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("读取 agent_sessions 失败: {e}"))?;

        for row in rows {
            let (session_id, working_dir) =
                row.map_err(|e| format!("解析 agent_session 行失败: {e}"))?;
            let Some(target_path) = resolve_target_path(&working_dir)? else {
                continue;
            };
            if target_path == working_dir {
                continue;
            }

            session_updates.push((session_id, target_path));
        }
    }

    for (session_id, target_path) in &session_updates {
        conn.execute(
            "UPDATE agent_sessions SET working_dir = ?1 WHERE id = ?2",
            params![target_path, session_id],
        )
        .map_err(|e| {
            format!(
                "更新 session working_dir 失败: session_id={}, working_dir={}: {e}",
                session_id, target_path
            )
        })?;
    }

    Ok((
        workspace_updates.len(),
        session_updates.len(),
        skipped_workspaces,
    ))
}

fn find_workspace_id_by_root_path(
    conn: &Connection,
    root_path: &str,
) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT id FROM workspaces WHERE root_path = ?1 LIMIT 1",
        params![root_path],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(workspace_id) => Ok(Some(workspace_id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("查询重复 workspace 路径失败: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        schema::create_tables(&conn).expect("初始化表结构失败");
        conn
    }

    #[test]
    fn migrate_managed_workspace_paths_rewrites_proxycast_paths_and_copies_project() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_proxycast_root = temp.path().join("home").join(".proxycast");
        let legacy_project_root = legacy_proxycast_root.join("projects").join("default");
        std::fs::create_dir_all(&legacy_project_root).unwrap();
        std::fs::write(legacy_project_root.join("index.md"), "# proxycast").unwrap();

        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, is_default, settings_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, '{}', 0, 0)",
            params![
                "workspace-default",
                "默认项目",
                "general",
                legacy_project_root.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, is_default, settings_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, '{}', 0, 0)",
            params!["workspace-custom", "外部项目", "persistent", "/tmp/custom-project"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at, working_dir)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                "session-default",
                "gpt-5",
                0,
                0,
                legacy_project_root.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at, working_dir)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["session-custom", "gpt-5", 0, 0, "/tmp/custom-project"],
        )
        .unwrap();

        let legacy_roots = vec![legacy_proxycast_root.clone()];
        let remap_path = |path: &Path| {
            app_paths::migrate_managed_project_path_to_preferred_from_roots(
                path,
                &preferred_root,
                &legacy_roots,
            )
        };

        let result = migrate_managed_workspace_paths_with_mapper(&conn, &remap_path)
            .expect("执行受管项目路径迁移失败");

        assert!(result.executed);
        assert_eq!(result.migrated_workspaces, 1);
        assert_eq!(result.migrated_sessions, 1);
        assert_eq!(result.skipped_workspaces, 0);

        let migrated_root: String = conn
            .query_row(
                "SELECT root_path FROM workspaces WHERE id = ?1",
                ["workspace-default"],
                |row| row.get(0),
            )
            .unwrap();
        let migrated_working_dir: String = conn
            .query_row(
                "SELECT working_dir FROM agent_sessions WHERE id = ?1",
                ["session-default"],
                |row| row.get(0),
            )
            .unwrap();
        let custom_root: String = conn
            .query_row(
                "SELECT root_path FROM workspaces WHERE id = ?1",
                ["workspace-custom"],
                |row| row.get(0),
            )
            .unwrap();

        let expected_root = preferred_root.join("projects").join("default");
        assert_eq!(migrated_root, expected_root.to_string_lossy());
        assert_eq!(migrated_working_dir, expected_root.to_string_lossy());
        assert_eq!(custom_root, "/tmp/custom-project");
        assert_eq!(
            std::fs::read_to_string(expected_root.join("index.md")).unwrap(),
            "# proxycast"
        );
    }

    #[test]
    fn migrate_managed_workspace_paths_rewrites_compat_lime_paths_only_once() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let compat_root = temp.path().join("home").join(".lime");
        let compat_project_root = compat_root.join("projects").join("default");
        std::fs::create_dir_all(&compat_project_root).unwrap();

        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, is_default, settings_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, '{}', 0, 0)",
            params![
                "workspace-default",
                "默认项目",
                "general",
                compat_project_root.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at, working_dir)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                "session-default",
                "gpt-5",
                0,
                0,
                compat_project_root.to_string_lossy().to_string(),
            ],
        )
        .unwrap();

        let legacy_roots = vec![compat_root.clone()];
        let remap_path = |path: &Path| {
            app_paths::migrate_managed_project_path_to_preferred_from_roots(
                path,
                &preferred_root,
                &legacy_roots,
            )
        };

        let first = migrate_managed_workspace_paths_with_mapper(&conn, &remap_path)
            .expect("首次执行受管项目路径迁移失败");
        let second = migrate_managed_workspace_paths_with_mapper(&conn, &remap_path)
            .expect("重复执行受管项目路径迁移失败");

        assert!(first.executed);
        assert_eq!(first.migrated_workspaces, 1);
        assert_eq!(first.migrated_sessions, 1);
        assert!(!second.executed);
        assert_eq!(second.migrated_workspaces, 0);
        assert_eq!(second.migrated_sessions, 0);
    }
}
