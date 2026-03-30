//! Memory 管理器
//!
//! 提供项目记忆系统的 CRUD 操作（角色、世界观、大纲）。

use super::types::*;
use crate::database::DbConnection;
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

/// Memory 管理器
#[derive(Clone)]
pub struct MemoryManager {
    db: DbConnection,
}

impl MemoryManager {
    /// 创建新的 MemoryManager
    pub fn new(db: DbConnection) -> Self {
        Self { db }
    }

    // ==================== 角色管理 ====================

    /// 创建角色
    pub fn create_character(&self, request: CharacterCreateRequest) -> Result<Character, String> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();

        let order = self.get_next_character_order(&request.project_id)?;
        let aliases_json = serde_json::to_string(&request.aliases).unwrap_or_default();

        let character = Character {
            id: id.clone(),
            project_id: request.project_id.clone(),
            name: request.name,
            aliases: request.aliases,
            description: request.description,
            personality: request.personality,
            background: request.background,
            appearance: request.appearance,
            relationships: Vec::new(),
            avatar_url: None,
            is_main: request.is_main,
            order,
            extra: None,
            created_at: now,
            updated_at: now,
        };

        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        conn.execute(
            "INSERT INTO characters (id, project_id, name, aliases_json, description, personality, background, appearance, relationships_json, avatar_url, is_main, sort_order, extra_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &character.id,
                &character.project_id,
                &character.name,
                &aliases_json,
                &character.description,
                &character.personality,
                &character.background,
                &character.appearance,
                "[]",
                &character.avatar_url,
                character.is_main,
                character.order,
                Option::<String>::None,
                character.created_at.timestamp_millis(),
                character.updated_at.timestamp_millis(),
            ],
        )
        .map_err(|e| format!("创建角色失败: {e}"))?;

        tracing::info!(
            "[Memory] 创建角色: id={}, name={}",
            character.id,
            character.name
        );
        Ok(character)
    }

    /// 获取角色
    pub fn get_character(&self, id: &CharacterId) -> Result<Option<Character>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result = conn.query_row(
            "SELECT id, project_id, name, aliases_json, description, personality, background, appearance, relationships_json, avatar_url, is_main, sort_order, extra_json, created_at, updated_at
             FROM characters WHERE id = ?",
            params![id],
            Self::row_to_character,
        );

        match result {
            Ok(character) => Ok(Some(character)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("获取角色失败: {e}")),
        }
    }

    /// 列出项目的所有角色
    pub fn list_characters(&self, project_id: &str) -> Result<Vec<Character>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, aliases_json, description, personality, background, appearance, relationships_json, avatar_url, is_main, sort_order, extra_json, created_at, updated_at
                 FROM characters WHERE project_id = ? ORDER BY sort_order ASC",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let characters = stmt
            .query_map(params![project_id], Self::row_to_character)
            .map_err(|e| format!("查询失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析结果失败: {e}"))?;

        Ok(characters)
    }

    /// 更新角色
    pub fn update_character(
        &self,
        id: &CharacterId,
        updates: CharacterUpdateRequest,
    ) -> Result<Character, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let now = Utc::now().timestamp_millis();

        let mut set_clauses = vec!["updated_at = ?"];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

        if let Some(ref name) = updates.name {
            set_clauses.push("name = ?");
            params_vec.push(Box::new(name.clone()));
        }
        if let Some(ref aliases) = updates.aliases {
            set_clauses.push("aliases_json = ?");
            params_vec.push(Box::new(serde_json::to_string(aliases).unwrap_or_default()));
        }
        if let Some(ref description) = updates.description {
            set_clauses.push("description = ?");
            params_vec.push(Box::new(description.clone()));
        }
        if let Some(ref personality) = updates.personality {
            set_clauses.push("personality = ?");
            params_vec.push(Box::new(personality.clone()));
        }
        if let Some(ref background) = updates.background {
            set_clauses.push("background = ?");
            params_vec.push(Box::new(background.clone()));
        }
        if let Some(ref appearance) = updates.appearance {
            set_clauses.push("appearance = ?");
            params_vec.push(Box::new(appearance.clone()));
        }
        if let Some(ref relationships) = updates.relationships {
            set_clauses.push("relationships_json = ?");
            params_vec.push(Box::new(
                serde_json::to_string(relationships).unwrap_or_default(),
            ));
        }
        if let Some(ref avatar_url) = updates.avatar_url {
            set_clauses.push("avatar_url = ?");
            params_vec.push(Box::new(avatar_url.clone()));
        }
        if let Some(is_main) = updates.is_main {
            set_clauses.push("is_main = ?");
            params_vec.push(Box::new(is_main));
        }
        if let Some(order) = updates.order {
            set_clauses.push("sort_order = ?");
            params_vec.push(Box::new(order));
        }
        if let Some(ref extra) = updates.extra {
            set_clauses.push("extra_json = ?");
            params_vec.push(Box::new(serde_json::to_string(extra).unwrap_or_default()));
        }

        params_vec.push(Box::new(id.clone()));

        let sql = format!(
            "UPDATE characters SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        conn.execute(&sql, params_refs.as_slice())
            .map_err(|e| format!("更新角色失败: {e}"))?;

        drop(conn);
        self.get_character(id)?
            .ok_or_else(|| "角色不存在".to_string())
    }

    /// 删除角色
    pub fn delete_character(&self, id: &CharacterId) -> Result<bool, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let affected = conn
            .execute("DELETE FROM characters WHERE id = ?", params![id])
            .map_err(|e| format!("删除角色失败: {e}"))?;

        if affected > 0 {
            tracing::info!("[Memory] 删除角色: id={}", id);
        }
        Ok(affected > 0)
    }

    fn get_next_character_order(&self, project_id: &str) -> Result<i32, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let result: Result<i32, _> = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM characters WHERE project_id = ?",
            params![project_id],
            |row| row.get(0),
        );
        result.map_err(|e| format!("获取排序顺序失败: {e}"))
    }

    fn row_to_character(row: &rusqlite::Row) -> Result<Character, rusqlite::Error> {
        let id: String = row.get(0)?;
        let project_id: String = row.get(1)?;
        let name: String = row.get(2)?;
        let aliases_json: String = row.get(3)?;
        let description: Option<String> = row.get(4)?;
        let personality: Option<String> = row.get(5)?;
        let background: Option<String> = row.get(6)?;
        let appearance: Option<String> = row.get(7)?;
        let relationships_json: String = row.get(8)?;
        let avatar_url: Option<String> = row.get(9)?;
        let is_main: bool = row.get(10)?;
        let order: i32 = row.get(11)?;
        let extra_json: Option<String> = row.get(12)?;
        let created_at_ms: i64 = row.get(13)?;
        let updated_at_ms: i64 = row.get(14)?;

        Ok(Character {
            id,
            project_id,
            name,
            aliases: serde_json::from_str(&aliases_json).unwrap_or_default(),
            description,
            personality,
            background,
            appearance,
            relationships: serde_json::from_str(&relationships_json).unwrap_or_default(),
            avatar_url,
            is_main,
            order,
            extra: extra_json.and_then(|s| serde_json::from_str(&s).ok()),
            created_at: chrono::DateTime::from_timestamp_millis(created_at_ms)
                .unwrap_or_else(Utc::now),
            updated_at: chrono::DateTime::from_timestamp_millis(updated_at_ms)
                .unwrap_or_else(Utc::now),
        })
    }

    // ==================== 世界观管理 ====================

    /// 获取或创建世界观
    pub fn get_world_building(&self, project_id: &str) -> Result<Option<WorldBuilding>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result = conn.query_row(
            "SELECT project_id, description, era, locations, rules, extra_json, updated_at
             FROM world_building WHERE project_id = ?",
            params![project_id],
            |row| {
                let project_id: String = row.get(0)?;
                let description: String = row.get(1)?;
                let era: Option<String> = row.get(2)?;
                let locations: Option<String> = row.get(3)?;
                let rules: Option<String> = row.get(4)?;
                let extra_json: Option<String> = row.get(5)?;
                let updated_at_ms: i64 = row.get(6)?;

                Ok(WorldBuilding {
                    project_id,
                    description,
                    era,
                    locations,
                    rules,
                    extra: extra_json.and_then(|s| serde_json::from_str(&s).ok()),
                    updated_at: chrono::DateTime::from_timestamp_millis(updated_at_ms)
                        .unwrap_or_else(Utc::now),
                })
            },
        );

        match result {
            Ok(wb) => Ok(Some(wb)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("获取世界观失败: {e}")),
        }
    }

    /// 更新或创建世界观
    pub fn upsert_world_building(
        &self,
        project_id: &str,
        updates: WorldBuildingUpdateRequest,
    ) -> Result<WorldBuilding, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let now = Utc::now();

        let extra_json = updates
            .extra
            .as_ref()
            .map(|e| serde_json::to_string(e).unwrap_or_default());

        conn.execute(
            "INSERT INTO world_building (project_id, description, era, locations, rules, extra_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id) DO UPDATE SET
                description = COALESCE(excluded.description, description),
                era = COALESCE(excluded.era, era),
                locations = COALESCE(excluded.locations, locations),
                rules = COALESCE(excluded.rules, rules),
                extra_json = COALESCE(excluded.extra_json, extra_json),
                updated_at = excluded.updated_at",
            params![
                project_id,
                updates.description.unwrap_or_default(),
                updates.era,
                updates.locations,
                updates.rules,
                extra_json,
                now.timestamp_millis(),
            ],
        )
        .map_err(|e| format!("更新世界观失败: {e}"))?;

        drop(conn);
        self.get_world_building(project_id)?
            .ok_or_else(|| "世界观不存在".to_string())
    }

    // ==================== 大纲管理 ====================

    /// 创建大纲节点
    pub fn create_outline_node(
        &self,
        request: OutlineNodeCreateRequest,
    ) -> Result<OutlineNode, String> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let order = request.order.unwrap_or_else(|| {
            self.get_next_outline_order(&request.project_id, request.parent_id.as_deref())
                .unwrap_or(0)
        });

        let node = OutlineNode {
            id: id.clone(),
            project_id: request.project_id.clone(),
            parent_id: request.parent_id,
            title: request.title,
            content: request.content,
            content_id: request.content_id,
            order,
            expanded: true,
            extra: None,
            created_at: now,
            updated_at: now,
        };

        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        conn.execute(
            "INSERT INTO outline_nodes (id, project_id, parent_id, title, content, content_id, sort_order, expanded, extra_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &node.id,
                &node.project_id,
                &node.parent_id,
                &node.title,
                &node.content,
                &node.content_id,
                node.order,
                node.expanded,
                Option::<String>::None,
                node.created_at.timestamp_millis(),
                node.updated_at.timestamp_millis(),
            ],
        )
        .map_err(|e| format!("创建大纲节点失败: {e}"))?;

        tracing::info!(
            "[Memory] 创建大纲节点: id={}, title={}",
            node.id,
            node.title
        );
        Ok(node)
    }

    /// 获取大纲节点
    pub fn get_outline_node(&self, id: &OutlineNodeId) -> Result<Option<OutlineNode>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result = conn.query_row(
            "SELECT id, project_id, parent_id, title, content, content_id, sort_order, expanded, extra_json, created_at, updated_at
             FROM outline_nodes WHERE id = ?",
            params![id],
            Self::row_to_outline_node,
        );

        match result {
            Ok(node) => Ok(Some(node)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("获取大纲节点失败: {e}")),
        }
    }

    /// 列出项目的所有大纲节点
    pub fn list_outline_nodes(&self, project_id: &str) -> Result<Vec<OutlineNode>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, parent_id, title, content, content_id, sort_order, expanded, extra_json, created_at, updated_at
                 FROM outline_nodes WHERE project_id = ? ORDER BY sort_order ASC",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let nodes = stmt
            .query_map(params![project_id], Self::row_to_outline_node)
            .map_err(|e| format!("查询失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析结果失败: {e}"))?;

        Ok(nodes)
    }

    /// 更新大纲节点
    pub fn update_outline_node(
        &self,
        id: &OutlineNodeId,
        updates: OutlineNodeUpdateRequest,
    ) -> Result<OutlineNode, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let now = Utc::now().timestamp_millis();

        let mut set_clauses = vec!["updated_at = ?"];
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];

        if let Some(ref parent_id) = updates.parent_id {
            set_clauses.push("parent_id = ?");
            params_vec.push(Box::new(parent_id.clone()));
        }
        if let Some(ref title) = updates.title {
            set_clauses.push("title = ?");
            params_vec.push(Box::new(title.clone()));
        }
        if let Some(ref content) = updates.content {
            set_clauses.push("content = ?");
            params_vec.push(Box::new(content.clone()));
        }
        if let Some(ref content_id) = updates.content_id {
            set_clauses.push("content_id = ?");
            params_vec.push(Box::new(content_id.clone()));
        }
        if let Some(order) = updates.order {
            set_clauses.push("sort_order = ?");
            params_vec.push(Box::new(order));
        }
        if let Some(expanded) = updates.expanded {
            set_clauses.push("expanded = ?");
            params_vec.push(Box::new(expanded));
        }
        if let Some(ref extra) = updates.extra {
            set_clauses.push("extra_json = ?");
            params_vec.push(Box::new(serde_json::to_string(extra).unwrap_or_default()));
        }

        params_vec.push(Box::new(id.clone()));

        let sql = format!(
            "UPDATE outline_nodes SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        conn.execute(&sql, params_refs.as_slice())
            .map_err(|e| format!("更新大纲节点失败: {e}"))?;

        drop(conn);
        self.get_outline_node(id)?
            .ok_or_else(|| "大纲节点不存在".to_string())
    }

    /// 删除大纲节点
    pub fn delete_outline_node(&self, id: &OutlineNodeId) -> Result<bool, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let affected = conn
            .execute("DELETE FROM outline_nodes WHERE id = ?", params![id])
            .map_err(|e| format!("删除大纲节点失败: {e}"))?;

        if affected > 0 {
            tracing::info!("[Memory] 删除大纲节点: id={}", id);
        }
        Ok(affected > 0)
    }

    fn get_next_outline_order(
        &self,
        project_id: &str,
        parent_id: Option<&str>,
    ) -> Result<i32, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

        let result: Result<i32, _> = match parent_id {
            Some(pid) => conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM outline_nodes WHERE project_id = ? AND parent_id = ?",
                params![project_id, pid],
                |row| row.get(0),
            ),
            None => conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM outline_nodes WHERE project_id = ? AND parent_id IS NULL",
                params![project_id],
                |row| row.get(0),
            ),
        };

        result.map_err(|e| format!("获取排序顺序失败: {e}"))
    }

    fn row_to_outline_node(row: &rusqlite::Row) -> Result<OutlineNode, rusqlite::Error> {
        let id: String = row.get(0)?;
        let project_id: String = row.get(1)?;
        let parent_id: Option<String> = row.get(2)?;
        let title: String = row.get(3)?;
        let content: Option<String> = row.get(4)?;
        let content_id: Option<String> = row.get(5)?;
        let order: i32 = row.get(6)?;
        let expanded: bool = row.get(7)?;
        let extra_json: Option<String> = row.get(8)?;
        let created_at_ms: i64 = row.get(9)?;
        let updated_at_ms: i64 = row.get(10)?;

        Ok(OutlineNode {
            id,
            project_id,
            parent_id,
            title,
            content,
            content_id,
            order,
            expanded,
            extra: extra_json.and_then(|s| serde_json::from_str(&s).ok()),
            created_at: chrono::DateTime::from_timestamp_millis(created_at_ms)
                .unwrap_or_else(Utc::now),
            updated_at: chrono::DateTime::from_timestamp_millis(updated_at_ms)
                .unwrap_or_else(Utc::now),
        })
    }

    // ==================== 聚合查询 ====================

    /// 获取项目的完整记忆
    pub fn get_project_memory(&self, project_id: &str) -> Result<ProjectMemory, String> {
        let characters = self.list_characters(project_id)?;
        let world_building = self.get_world_building(project_id)?;
        let outline = self.list_outline_nodes(project_id)?;

        Ok(ProjectMemory {
            characters,
            world_building,
            outline,
        })
    }
}
