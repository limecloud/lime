use std::path::Path;

use rusqlite::Connection;

use super::{migration, migration_v2, migration_v3, migration_v4, migration_v5, migration_v6};

pub(super) fn run_startup_migrations(conn: &Connection) {
    run_provider_pool_startup_migrations(conn);
    run_mcp_startup_migrations(conn);
    run_general_chat_startup_migrations(conn);
    run_versioned_startup_migrations(conn);
}

fn run_nonfatal_startup_migration<T, F, S>(
    conn: &Connection,
    failure_label: &str,
    operation: F,
    on_success: S,
) where
    F: FnOnce(&Connection) -> Result<T, String>,
    S: FnOnce(&Connection, T),
{
    match operation(conn) {
        Ok(result) => on_success(conn, result),
        Err(error) => {
            tracing::warn!("[数据库] {}（非致命）: {}", failure_label, error);
        }
    }
}

fn run_nonfatal_logged_startup_migration<T, F, S>(
    conn: &Connection,
    failure_label: &str,
    operation: F,
    on_success: S,
) where
    F: FnOnce(&Connection) -> Result<T, String>,
    S: FnOnce(&Connection, T) -> Option<String>,
{
    run_nonfatal_startup_migration(conn, failure_label, operation, |tx, result| {
        if let Some(message) = on_success(tx, result) {
            tracing::info!("{}", message);
        }
    });
}

fn run_nonfatal_count_migration<F, S>(
    conn: &Connection,
    failure_label: &str,
    operation: F,
    on_nonzero: S,
) where
    F: FnOnce(&Connection) -> Result<usize, String>,
    S: FnOnce(&Connection, usize) -> String,
{
    run_nonfatal_logged_startup_migration(conn, failure_label, operation, |tx, count| {
        if count > 0 {
            return Some(on_nonzero(tx, count));
        }
        None
    });
}

fn run_provider_pool_startup_migrations(conn: &Connection) {
    run_provider_id_migration(conn);
    migration::check_model_registry_version(conn);
    run_retired_provider_pool_cleanup(conn);
}

fn run_provider_id_migration(conn: &Connection) {
    run_nonfatal_count_migration(
        conn,
        "Provider ID 迁移失败",
        migration::migrate_provider_ids,
        |tx, count| {
            migration::mark_model_registry_refresh_needed(tx);
            format!("[数据库] 已迁移 {} 个 Provider ID", count)
        },
    );
}

#[derive(Debug, Clone, Copy)]
struct RetiredProviderPoolCleanup {
    rows_deleted: usize,
    managed_files_deleted: usize,
}

fn run_retired_provider_pool_cleanup(conn: &Connection) {
    run_nonfatal_logged_startup_migration(
        conn,
        "凭证池退役清理失败",
        |tx| {
            let rows_deleted = clear_provider_pool_credentials(tx)?;
            let managed_files_deleted = remove_managed_provider_pool_credential_files()?;
            Ok(RetiredProviderPoolCleanup {
                rows_deleted,
                managed_files_deleted,
            })
        },
        |_, result| {
            if result.rows_deleted == 0 && result.managed_files_deleted == 0 {
                return None;
            }
            Some(format!(
                "[数据库] 凭证池已退役，清理 {} 条旧凭证记录和 {} 个托管凭证文件",
                result.rows_deleted, result.managed_files_deleted
            ))
        },
    );
}

fn clear_provider_pool_credentials(conn: &Connection) -> Result<usize, String> {
    conn.execute("DELETE FROM provider_pool_credentials", [])
        .map_err(|error| error.to_string())
}

fn count_managed_files(path: &Path) -> usize {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return 0;
    };

    let file_type = metadata.file_type();
    if file_type.is_symlink() || metadata.is_file() {
        return 1;
    }

    if !metadata.is_dir() {
        return 0;
    }

    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };

    entries
        .filter_map(Result::ok)
        .map(|entry| count_managed_files(&entry.path()))
        .sum()
}

fn remove_managed_provider_pool_credential_files() -> Result<usize, String> {
    let data_dir = crate::app_paths::preferred_data_dir().map_err(|error| error.to_string())?;
    let credentials_dir = data_dir.join("credentials");

    let metadata = match std::fs::symlink_metadata(&credentials_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };

    let deleted_count = count_managed_files(&credentials_dir);
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(&credentials_dir).map_err(|error| error.to_string())?;
    } else if metadata.is_dir() {
        std::fs::remove_dir_all(&credentials_dir).map_err(|error| error.to_string())?;
    }

    Ok(deleted_count)
}

fn run_mcp_startup_migrations(conn: &Connection) {
    run_nonfatal_count_migration(
        conn,
        "MCP Lime 启用状态修复失败",
        migration::migrate_mcp_lime_enabled,
        |_, count| format!("[数据库] 已修复 {} 条 MCP Lime 启用状态", count),
    );

    run_nonfatal_count_migration(
        conn,
        "MCP created_at 归一化失败",
        migration::migrate_mcp_created_at_to_integer,
        |_, count| format!("[数据库] 已归一化 {} 条 MCP created_at 字段", count),
    );
}

fn run_general_chat_startup_migrations(conn: &Connection) {
    let general_chat_status = migration::check_general_chat_migration_status(conn);
    if general_chat_status.needs_migration {
        tracing::info!(
            "[数据库] 检测到 legacy general 数据待迁移: sessions={}, messages={}, unified_general_sessions={}",
            general_chat_status.general_sessions_count,
            general_chat_status.general_messages_count,
            general_chat_status.migrated_sessions_count
        );
    }

    run_nonfatal_count_migration(
        conn,
        "General Chat 迁移失败",
        migration::migrate_general_chat_to_unified,
        |_, count| {
            format!(
                "[数据库] 已将 {} 条 legacy general 数据迁移到 unified chat",
                count
            )
        },
    );
}

fn run_versioned_startup_migrations(conn: &Connection) {
    run_nonfatal_logged_startup_migration(
        conn,
        "统一内容系统迁移失败",
        migration_v2::migrate_unified_content_system,
        |_, result| {
            result.stats.filter(|_| result.executed).map(|stats| {
                format!(
                    "[数据库] 统一内容系统迁移完成: 默认项目={}, 迁移内容数={}",
                    stats.default_project_id, stats.migrated_contents_count
                )
            })
        },
    );

    run_nonfatal_logged_startup_migration(
        conn,
        "Playwright MCP Server 迁移失败",
        migration_v3::migrate_playwright_mcp_server,
        |_, result| {
            result
                .server_id
                .filter(|_| result.executed)
                .map(|server_id| {
                    format!("[数据库] Playwright MCP Server 迁移完成: server_id={server_id}")
                })
        },
    );

    run_nonfatal_logged_startup_migration(
        conn,
        "路径修复和会话统一失败",
        migration_v4::migrate_fix_promise_paths,
        |_, result| {
            result.executed.then(|| {
                format!(
                    "[数据库] 路径修复和会话统一完成: workspaces={}, sessions={}, unified={}",
                    result.fixed_workspaces, result.fixed_sessions, result.unified_sessions
                )
            })
        },
    );

    run_nonfatal_logged_startup_migration(
        conn,
        "workbench 会话模式迁移失败",
        migration_v5::migrate_workbench_chat_mode_alias,
        |_, result| {
            result.executed.then(|| {
                format!(
                    "[数据库] workbench 会话模式旧别名迁移完成: sessions={}",
                    result.migrated_sessions
                )
            })
        },
    );

    run_nonfatal_logged_startup_migration(
        conn,
        "受管项目路径迁移失败",
        migration_v6::migrate_managed_workspace_paths,
        |_, result| {
            (result.executed || result.skipped_workspaces > 0).then(|| {
                format!(
                    "[数据库] 受管项目路径迁移完成: workspaces={}, sessions={}, skipped={}",
                    result.migrated_workspaces, result.migrated_sessions, result.skipped_workspaces
                )
            })
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema;
    use rusqlite::params;
    use std::cell::Cell;

    fn setup_provider_migration_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE api_key_providers (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                api_host TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL
            );
            CREATE TABLE api_keys (
                id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL,
                api_key_encrypted TEXT NOT NULL,
                alias TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                usage_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT,
                created_at TEXT
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn provider_id_startup_migration_marks_registry_refresh_when_changed() {
        let conn = setup_provider_migration_db();

        conn.execute(
            "INSERT INTO api_key_providers (id, type, api_host, name) VALUES (?1, ?2, '', ?3)",
            params!["gemini", "gemini", "Gemini"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO api_keys (id, provider_id, api_key_encrypted) VALUES (?1, ?2, ?3)",
            params!["key-1", "gemini", "secret-1"],
        )
        .unwrap();

        run_provider_id_migration(&conn);

        let provider_id: String = conn
            .query_row(
                "SELECT provider_id FROM api_keys WHERE id = ?1",
                ["key-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(provider_id, "google");
        assert!(migration::is_model_registry_refresh_needed(&conn));
    }

    #[test]
    fn provider_id_startup_migration_does_not_mark_refresh_without_changes() {
        let conn = setup_provider_migration_db();

        run_provider_id_migration(&conn);

        assert!(!migration::is_model_registry_refresh_needed(&conn));
    }

    #[test]
    fn nonfatal_count_migration_only_runs_callback_when_count_positive() {
        let conn = setup_provider_migration_db();
        let called = Cell::new(0usize);

        run_nonfatal_count_migration(
            &conn,
            "测试失败",
            |_| Ok(0),
            |_, count| {
                called.set(count);
                "ignored".to_string()
            },
        );
        assert_eq!(called.get(), 0);

        run_nonfatal_count_migration(
            &conn,
            "测试失败",
            |_| Ok(3),
            |_, count| {
                called.set(count);
                "ignored".to_string()
            },
        );
        assert_eq!(called.get(), 3);
    }

    #[test]
    fn nonfatal_startup_migration_skips_success_callback_on_error() {
        let conn = setup_provider_migration_db();
        let called = Cell::new(false);

        run_nonfatal_startup_migration(
            &conn,
            "测试失败",
            |_| Err("boom".to_string()),
            |_, ()| called.set(true),
        );

        assert!(!called.get());
    }

    #[test]
    fn nonfatal_logged_startup_migration_allows_optional_success_log() {
        let conn = setup_provider_migration_db();
        let called = Cell::new(false);

        run_nonfatal_logged_startup_migration(
            &conn,
            "测试失败",
            |_| Ok(7usize),
            |_, count| {
                called.set(true);
                (count > 0).then(|| "logged".to_string())
            },
        );

        assert!(called.get());
    }

    #[test]
    fn versioned_startup_migrations_rewrite_legacy_creator_chat_mode() {
        let conn = Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params!["session-creator-prefixed", "creator:gpt-4.1", "1", "1"],
        )
        .unwrap();

        run_versioned_startup_migrations(&conn);

        let model: String = conn
            .query_row(
                "SELECT model FROM agent_sessions WHERE id = ?1",
                ["session-creator-prefixed"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(model, "workbench:gpt-4.1");
    }
}
