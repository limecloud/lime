use lime_core::database::dao::mcp::McpDao;
use lime_core::database::DbConnection;
use lime_core::models::mcp_model::ConfigValidationError;
use lime_core::models::McpServer;

pub struct McpService;

impl McpService {
    pub fn get_all(db: &DbConnection) -> Result<Vec<McpServer>, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        McpDao::get_all(&conn).map_err(|e| e.to_string())
    }

    /// 根据名称获取服务器
    pub fn get_by_name(db: &DbConnection, name: &str) -> Result<Option<McpServer>, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let servers = McpDao::get_all(&conn).map_err(|e| e.to_string())?;
        Ok(servers.into_iter().find(|s| s.name == name))
    }

    /// 检查名称是否已存在（排除指定 ID）
    pub fn is_name_duplicate(
        db: &DbConnection,
        name: &str,
        exclude_id: Option<&str>,
    ) -> Result<bool, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let servers = McpDao::get_all(&conn).map_err(|e| e.to_string())?;
        Ok(servers
            .iter()
            .any(|s| s.name == name && exclude_id.is_none_or(|id| s.id != id)))
    }

    /// 验证服务器配置
    pub fn validate_server(
        db: &DbConnection,
        server: &McpServer,
        is_update: bool,
    ) -> Result<Vec<ConfigValidationError>, String> {
        let mut errors = server.validate_config();

        // 检查名称重复
        let exclude_id = if is_update {
            Some(server.id.as_str())
        } else {
            None
        };
        if Self::is_name_duplicate(db, &server.name, exclude_id)? {
            errors.push(ConfigValidationError {
                field: "name".to_string(),
                message: format!("服务器名称 '{}' 已存在", server.name),
            });
        }

        Ok(errors)
    }

    pub fn add(db: &DbConnection, server: McpServer) -> Result<(), String> {
        // 验证配置
        let errors = Self::validate_server(db, &server, false)?;
        if !errors.is_empty() {
            let error_msgs: Vec<String> = errors.iter().map(|e| e.message.clone()).collect();
            return Err(format!("配置验证失败: {}", error_msgs.join("; ")));
        }

        let conn = db.lock().map_err(|e| e.to_string())?;
        McpDao::insert(&conn, &server).map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn update(db: &DbConnection, server: McpServer) -> Result<(), String> {
        // 验证配置
        let errors = Self::validate_server(db, &server, true)?;
        if !errors.is_empty() {
            let error_msgs: Vec<String> = errors.iter().map(|e| e.message.clone()).collect();
            return Err(format!("配置验证失败: {}", error_msgs.join("; ")));
        }

        let conn = db.lock().map_err(|e| e.to_string())?;
        McpDao::update(&conn, &server).map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn delete(db: &DbConnection, id: &str) -> Result<(), String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        McpDao::delete(&conn, id).map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn toggle_enabled(db: &DbConnection, id: &str, enabled: bool) -> Result<(), String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        McpDao::toggle_enabled(&conn, id, enabled).map_err(|e| e.to_string())?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[test]
    fn crud_and_enablement_use_only_local_server_state() {
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        db.lock()
            .unwrap()
            .execute_batch(
                "CREATE TABLE mcp_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                server_config TEXT NOT NULL,
                description TEXT,
                enabled_lime INTEGER DEFAULT 0,
                created_at INTEGER
            );",
            )
            .unwrap();
        let mut server = McpServer::new(
            "docs-id".into(),
            "docs".into(),
            json!({
                "command": "node", "args": ["server.js"], "env": {"TOKEN": " value "}
            }),
        );
        server.enabled_lime = true;
        McpService::add(&db, server.clone()).unwrap();
        assert!(McpService::add(&db, server.clone()).is_err());
        server.description = Some("updated".into());
        server.server_config["args"] = json!(["updated.js"]);
        McpService::update(&db, server.clone()).unwrap();
        McpService::toggle_enabled(&db, &server.id, false).unwrap();
        let saved = McpService::get_by_name(&db, "docs").unwrap().unwrap();
        assert!(!saved.enabled_lime);
        assert_eq!(saved.server_config, server.server_config);
        assert_eq!(saved.description.as_deref(), Some("updated"));
        McpService::toggle_enabled(&db, &server.id, true).unwrap();
        assert!(McpService::get_all(&db).unwrap()[0].enabled_lime);
        McpService::delete(&db, &server.id).unwrap();
        assert!(McpService::get_all(&db).unwrap().is_empty());
    }
}
