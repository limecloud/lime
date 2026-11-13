//! 模型连接交付回执独立于可编辑的 Provider UI 状态。

pub(super) fn create_table(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS provider_connection_transfers (
            operation_id TEXT PRIMARY KEY,
            recipient TEXT NOT NULL,
            identity_ref TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            payload_sha256 TEXT,
            provider_id TEXT,
            phase TEXT NOT NULL CHECK (phase IN ('preparing', 'prepared', 'receiving', 'complete', 'expired'))
        );",
    )
}
