mod api_key_migration;
mod general_chat_migration;
mod mcp_migration;
mod model_registry_migration;

use crate::app_paths;
pub use api_key_migration::{migrate_api_keys_to_pool, migrate_provider_ids};
pub use general_chat_migration::{
    check_general_chat_migration_status, is_general_chat_migration_completed,
    migrate_general_chat_to_unified, GeneralChatMigrationStatus,
    GENERAL_CHAT_MIGRATION_COMPLETED_KEY,
};
pub use mcp_migration::{migrate_mcp_created_at_to_integer, remove_mcp_sync_columns};
pub use model_registry_migration::{
    check_model_registry_version, clear_model_registry_refresh_flag,
    is_model_registry_refresh_needed, mark_model_registry_refresh_needed,
};

pub(crate) use super::migration_support::{
    clear_setting, is_true_setting, mark_true_setting, read_setting_value, upsert_setting,
};
use rusqlite::Connection;

/// 从旧的 JSON 配置迁移数据到 SQLite
#[allow(dead_code)]
pub fn migrate_from_json(conn: &Connection) -> Result<(), String> {
    if is_true_setting(conn, "migrated_from_json") {
        return Ok(());
    }

    // 读取旧配置文件（历史路径）
    let config_path = app_paths::legacy_home_dir()?.join("config.json");

    if config_path.exists() {
        // 备份旧配置，避免误覆盖
        let backup_path = config_path.with_file_name("config.json.backup");
        if !backup_path.exists() {
            std::fs::copy(&config_path, &backup_path)
                .map_err(|e| format!("备份旧配置失败: {e}"))?;
        }

        return Err(
            "检测到旧版 config.json（旧 Home 历史目录），当前版本尚未支持自动迁移。请手动导出或重建配置后再启动。"
                .to_string(),
        );
    }

    // 标记迁移完成
    mark_true_setting(conn, "migrated_from_json")?;

    Ok(())
}
