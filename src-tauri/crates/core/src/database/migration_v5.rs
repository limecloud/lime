//! 历史 workbench 会话模式命名迁移
//!
//! 将旧 `creator:*` 会话模式前缀统一迁移为 `workbench:*`，
//! 避免运行时主链继续保留旧命名兼容。

use rusqlite::{params, Connection};

use super::migration_support::{
    is_migration_completed, mark_migration_completed, run_in_transaction,
};

const MIGRATION_KEY_WORKBENCH_CHAT_MODE_ALIAS: &str =
    "migrated_workbench_chat_mode_creator_alias_v1";

pub struct MigrationResult {
    pub executed: bool,
    pub migrated_sessions: usize,
}

pub fn migrate_workbench_chat_mode_alias(conn: &Connection) -> Result<MigrationResult, String> {
    if is_migration_completed(conn, MIGRATION_KEY_WORKBENCH_CHAT_MODE_ALIAS) {
        tracing::debug!("[迁移] workbench 会话模式旧别名已迁移，跳过");
        return Ok(MigrationResult {
            executed: false,
            migrated_sessions: 0,
        });
    }

    match run_in_transaction(conn, |tx| {
        let migrated_sessions = execute_migration(tx)?;
        mark_migration_completed(tx, MIGRATION_KEY_WORKBENCH_CHAT_MODE_ALIAS)?;
        Ok(migrated_sessions)
    }) {
        Ok(migrated_sessions) => Ok(MigrationResult {
            executed: migrated_sessions > 0,
            migrated_sessions,
        }),
        Err(error) => {
            tracing::error!("[迁移] workbench 会话模式旧别名迁移失败，已回滚: {}", error);
            Err(error)
        }
    }
}

fn execute_migration(conn: &Connection) -> Result<usize, String> {
    let renamed_default = conn
        .execute(
            "UPDATE agent_sessions
             SET model = 'workbench:default'
             WHERE model = 'creator'",
            [],
        )
        .map_err(|e| format!("迁移 creator 默认会话模式失败: {e}"))?;

    let renamed_prefixed = conn
        .execute(
            "UPDATE agent_sessions
             SET model = 'workbench:' || substr(model, 9)
             WHERE model LIKE 'creator:%'",
            params![],
        )
        .map_err(|e| format!("迁移 creator 前缀会话模式失败: {e}"))?;

    Ok(renamed_default + renamed_prefixed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        schema::create_tables(&conn).expect("初始化表结构失败");
        conn
    }

    #[test]
    fn migrate_workbench_chat_mode_alias_rewrites_legacy_creator_sessions() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params!["session-creator-default", "creator", "1", "1"],
        )
        .expect("插入 creator 默认会话失败");
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params!["session-creator-prefixed", "creator:gpt-4.1", "1", "1"],
        )
        .expect("插入 creator 前缀会话失败");
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params!["session-workbench", "workbench:default", "1", "1"],
        )
        .expect("插入 workbench 会话失败");

        let result =
            migrate_workbench_chat_mode_alias(&conn).expect("执行 workbench 会话模式迁移失败");

        assert!(result.executed);
        assert_eq!(result.migrated_sessions, 2);

        let creator_default: String = conn
            .query_row(
                "SELECT model FROM agent_sessions WHERE id = ?1",
                ["session-creator-default"],
                |row| row.get(0),
            )
            .expect("查询 creator 默认会话失败");
        let creator_prefixed: String = conn
            .query_row(
                "SELECT model FROM agent_sessions WHERE id = ?1",
                ["session-creator-prefixed"],
                |row| row.get(0),
            )
            .expect("查询 creator 前缀会话失败");
        let workbench: String = conn
            .query_row(
                "SELECT model FROM agent_sessions WHERE id = ?1",
                ["session-workbench"],
                |row| row.get(0),
            )
            .expect("查询 workbench 会话失败");

        assert_eq!(creator_default, "workbench:default");
        assert_eq!(creator_prefixed, "workbench:gpt-4.1");
        assert_eq!(workbench, "workbench:default");
    }

    #[test]
    fn migrate_workbench_chat_mode_alias_runs_only_once() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params!["session-creator-prefixed", "creator:gpt-4.1", "1", "1"],
        )
        .expect("插入 creator 前缀会话失败");

        let first =
            migrate_workbench_chat_mode_alias(&conn).expect("首次执行 workbench 会话模式迁移失败");
        let second =
            migrate_workbench_chat_mode_alias(&conn).expect("重复执行 workbench 会话模式迁移失败");

        assert!(first.executed);
        assert_eq!(first.migrated_sessions, 1);
        assert!(!second.executed);
        assert_eq!(second.migrated_sessions, 0);
    }
}
