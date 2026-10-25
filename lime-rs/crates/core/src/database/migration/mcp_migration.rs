use rusqlite::Connection;

use super::{is_true_setting, mark_true_setting};

const MCP_CREATED_AT_INTEGER_MIGRATED_KEY: &str = "migrated_mcp_created_at_to_integer";

/// 删除已经退役的跨应用同步列，保留本地服务器配置和启用状态。
pub fn remove_mcp_sync_columns(conn: &Connection) -> Result<(), rusqlite::Error> {
    for column in ["enabled_claude", "enabled_codex", "enabled_gemini"] {
        let exists = conn
            .prepare("PRAGMA table_info(mcp_servers)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == column);
        if exists {
            conn.execute(&format!("ALTER TABLE mcp_servers DROP COLUMN {column}"), [])?;
        }
    }
    Ok(())
}

/// 归一化 mcp_servers.created_at 字段为 INTEGER 时间戳
///
/// 历史版本曾写入 RFC3339 文本，导致下游按 i64 读取时出现类型异常。
/// 迁移策略：
/// - 纯数字文本 -> CAST 为 INTEGER
/// - RFC3339 文本 -> strftime('%s', ...) 转为秒级时间戳
/// - 其余值保持不变（由 DAO 兼容读取）
pub fn migrate_mcp_created_at_to_integer(conn: &Connection) -> Result<usize, String> {
    if is_true_setting(conn, MCP_CREATED_AT_INTEGER_MIGRATED_KEY) {
        tracing::debug!("[迁移] MCP created_at 类型已归一化，跳过");
        return Ok(0);
    }

    if !has_mcp_columns(conn, &["created_at"])? {
        tracing::info!("[迁移] mcp_servers 缺少 created_at 列，跳过 MCP created_at 归一化");
        return Ok(0);
    }

    let updated_numeric = conn
        .execute(
            "UPDATE mcp_servers
             SET created_at = CAST(TRIM(created_at) AS INTEGER)
             WHERE typeof(created_at) = 'text'
               AND TRIM(created_at) != ''
               AND TRIM(created_at) NOT GLOB '*[^0-9]*'",
            [],
        )
        .map_err(|e| format!("归一化 MCP created_at 数字文本失败: {e}"))?;

    let updated_rfc3339 = conn
        .execute(
            "UPDATE mcp_servers
             SET created_at = CAST(strftime('%s', created_at) AS INTEGER)
             WHERE typeof(created_at) = 'text'
               AND strftime('%s', created_at) IS NOT NULL",
            [],
        )
        .map_err(|e| format!("归一化 MCP created_at RFC3339 文本失败: {e}"))?;

    mark_true_setting(conn, MCP_CREATED_AT_INTEGER_MIGRATED_KEY)?;

    let total = updated_numeric + updated_rfc3339;
    tracing::info!("[迁移] MCP created_at 归一化完成，更新 {} 条记录", total);

    Ok(total)
}

fn has_mcp_columns(conn: &Connection, required_columns: &[&str]) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(mcp_servers)")
        .map_err(|e| format!("读取 mcp_servers 表结构失败: {e}"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("扫描 mcp_servers 列失败: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("收集 mcp_servers 列失败: {e}"))?;

    if columns.is_empty() {
        return Ok(false);
    }

    Ok(required_columns
        .iter()
        .all(|column| columns.iter().any(|existing| existing == column)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_mcp_migration_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE mcp_servers (
                id TEXT PRIMARY KEY,
                enabled_lime INTEGER NOT NULL DEFAULT 0,
                created_at
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn remove_sync_columns_preserves_servers_and_local_enablement() {
        let conn = setup_mcp_migration_db();
        conn.execute_batch(
            "ALTER TABLE mcp_servers ADD COLUMN enabled_claude INTEGER DEFAULT 0;
            ALTER TABLE mcp_servers ADD COLUMN enabled_codex INTEGER DEFAULT 0;
            ALTER TABLE mcp_servers ADD COLUMN enabled_gemini INTEGER DEFAULT 0;
            INSERT INTO mcp_servers (id, enabled_lime, enabled_codex, created_at)
                VALUES ('local', 0, 1, 123);",
        )
        .unwrap();
        remove_mcp_sync_columns(&conn).unwrap();
        remove_mcp_sync_columns(&conn).unwrap();
        let columns = conn
            .prepare("PRAGMA table_info(mcp_servers)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(columns, ["id", "enabled_lime", "created_at"]);
        let row: (String, bool, i64) = conn
            .query_row(
                "SELECT id, enabled_lime, created_at FROM mcp_servers",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, ("local".to_string(), false, 123));
    }

    #[test]
    fn migrate_mcp_created_at_to_integer_normalizes_text_values() {
        let conn = setup_mcp_migration_db();

        conn.execute(
            "INSERT INTO mcp_servers (id, created_at) VALUES (?1, ?2)",
            ("numeric", "1700000000"),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mcp_servers (id, created_at) VALUES (?1, ?2)",
            ("rfc3339", "2026-03-01T00:00:00Z"),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO mcp_servers (id, created_at) VALUES (?1, ?2)",
            ("invalid", "not-a-date"),
        )
        .unwrap();

        let updated = migrate_mcp_created_at_to_integer(&conn).unwrap();
        assert_eq!(updated, 2);

        let numeric_type: String = conn
            .query_row(
                "SELECT typeof(created_at) FROM mcp_servers WHERE id = 'numeric'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(numeric_type, "integer");

        let rfc_timestamp: i64 = conn
            .query_row(
                "SELECT created_at FROM mcp_servers WHERE id = 'rfc3339'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(rfc_timestamp > 0);

        let invalid_type: String = conn
            .query_row(
                "SELECT typeof(created_at) FROM mcp_servers WHERE id = 'invalid'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(invalid_type, "text");
    }
}
