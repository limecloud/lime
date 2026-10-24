//! Orchestrator DAO 模块
//!
//! 提供模型元数据和用户偏好的数据库操作

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// 模型元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMetadataRow {
    pub model_id: String,
    pub provider_type: String,
    pub display_name: String,
    pub family: Option<String>,
    pub tier: String,
    pub context_length: Option<i64>,
    pub max_output_tokens: Option<i64>,
    pub cost_input_per_million: Option<f64>,
    pub cost_output_per_million: Option<f64>,
    pub supports_vision: bool,
    pub supports_tools: bool,
    pub supports_streaming: bool,
    pub is_deprecated: bool,
    pub release_date: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 用户等级偏好
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTierPreference {
    pub tier_id: String,
    pub strategy_id: String,
    pub preferred_provider: Option<String>,
    pub fallback_enabled: bool,
    pub max_retries: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Orchestrator DAO
pub struct OrchestratorDao;

impl OrchestratorDao {
    // ========================================================================
    // 模型元数据操作
    // ========================================================================

    /// 获取所有模型元数据
    pub fn get_all_model_metadata(conn: &Connection) -> Result<Vec<ModelMetadataRow>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT model_id, provider_type, display_name, family, tier,
                        context_length, max_output_tokens, cost_input_per_million,
                        cost_output_per_million, supports_vision, supports_tools,
                        supports_streaming, is_deprecated, release_date, description,
                        created_at, updated_at
                 FROM model_metadata
                 WHERE is_deprecated = 0
                 ORDER BY provider_type, tier, display_name",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ModelMetadataRow {
                    model_id: row.get(0)?,
                    provider_type: row.get(1)?,
                    display_name: row.get(2)?,
                    family: row.get(3)?,
                    tier: row.get(4)?,
                    context_length: row.get(5)?,
                    max_output_tokens: row.get(6)?,
                    cost_input_per_million: row.get(7)?,
                    cost_output_per_million: row.get(8)?,
                    supports_vision: row.get::<_, i32>(9)? != 0,
                    supports_tools: row.get::<_, i32>(10)? != 0,
                    supports_streaming: row.get::<_, i32>(11)? != 0,
                    is_deprecated: row.get::<_, i32>(12)? != 0,
                    release_date: row.get(13)?,
                    description: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// 按 Provider 获取模型元数据
    pub fn get_model_metadata_by_provider(
        conn: &Connection,
        provider_type: &str,
    ) -> Result<Vec<ModelMetadataRow>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT model_id, provider_type, display_name, family, tier,
                        context_length, max_output_tokens, cost_input_per_million,
                        cost_output_per_million, supports_vision, supports_tools,
                        supports_streaming, is_deprecated, release_date, description,
                        created_at, updated_at
                 FROM model_metadata
                 WHERE provider_type = ?1 AND is_deprecated = 0
                 ORDER BY tier, display_name",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([provider_type], |row| {
                Ok(ModelMetadataRow {
                    model_id: row.get(0)?,
                    provider_type: row.get(1)?,
                    display_name: row.get(2)?,
                    family: row.get(3)?,
                    tier: row.get(4)?,
                    context_length: row.get(5)?,
                    max_output_tokens: row.get(6)?,
                    cost_input_per_million: row.get(7)?,
                    cost_output_per_million: row.get(8)?,
                    supports_vision: row.get::<_, i32>(9)? != 0,
                    supports_tools: row.get::<_, i32>(10)? != 0,
                    supports_streaming: row.get::<_, i32>(11)? != 0,
                    is_deprecated: row.get::<_, i32>(12)? != 0,
                    release_date: row.get(13)?,
                    description: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// 按等级获取模型元数据
    pub fn get_model_metadata_by_tier(
        conn: &Connection,
        tier: &str,
    ) -> Result<Vec<ModelMetadataRow>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT model_id, provider_type, display_name, family, tier,
                        context_length, max_output_tokens, cost_input_per_million,
                        cost_output_per_million, supports_vision, supports_tools,
                        supports_streaming, is_deprecated, release_date, description,
                        created_at, updated_at
                 FROM model_metadata
                 WHERE tier = ?1 AND is_deprecated = 0
                 ORDER BY provider_type, display_name",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([tier], |row| {
                Ok(ModelMetadataRow {
                    model_id: row.get(0)?,
                    provider_type: row.get(1)?,
                    display_name: row.get(2)?,
                    family: row.get(3)?,
                    tier: row.get(4)?,
                    context_length: row.get(5)?,
                    max_output_tokens: row.get(6)?,
                    cost_input_per_million: row.get(7)?,
                    cost_output_per_million: row.get(8)?,
                    supports_vision: row.get::<_, i32>(9)? != 0,
                    supports_tools: row.get::<_, i32>(10)? != 0,
                    supports_streaming: row.get::<_, i32>(11)? != 0,
                    is_deprecated: row.get::<_, i32>(12)? != 0,
                    release_date: row.get(13)?,
                    description: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// 获取单个模型元数据
    pub fn get_model_metadata(
        conn: &Connection,
        model_id: &str,
    ) -> Result<Option<ModelMetadataRow>, String> {
        conn.query_row(
            "SELECT model_id, provider_type, display_name, family, tier,
                    context_length, max_output_tokens, cost_input_per_million,
                    cost_output_per_million, supports_vision, supports_tools,
                    supports_streaming, is_deprecated, release_date, description,
                    created_at, updated_at
             FROM model_metadata
             WHERE model_id = ?1",
            [model_id],
            |row| {
                Ok(ModelMetadataRow {
                    model_id: row.get(0)?,
                    provider_type: row.get(1)?,
                    display_name: row.get(2)?,
                    family: row.get(3)?,
                    tier: row.get(4)?,
                    context_length: row.get(5)?,
                    max_output_tokens: row.get(6)?,
                    cost_input_per_million: row.get(7)?,
                    cost_output_per_million: row.get(8)?,
                    supports_vision: row.get::<_, i32>(9)? != 0,
                    supports_tools: row.get::<_, i32>(10)? != 0,
                    supports_streaming: row.get::<_, i32>(11)? != 0,
                    is_deprecated: row.get::<_, i32>(12)? != 0,
                    release_date: row.get(13)?,
                    description: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// 插入或更新模型元数据
    pub fn upsert_model_metadata(
        conn: &Connection,
        metadata: &ModelMetadataRow,
    ) -> Result<(), String> {
        conn.execute(
            "INSERT INTO model_metadata (
                model_id, provider_type, display_name, family, tier,
                context_length, max_output_tokens, cost_input_per_million,
                cost_output_per_million, supports_vision, supports_tools,
                supports_streaming, is_deprecated, release_date, description,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(model_id) DO UPDATE SET
                provider_type = excluded.provider_type,
                display_name = excluded.display_name,
                family = excluded.family,
                tier = excluded.tier,
                context_length = excluded.context_length,
                max_output_tokens = excluded.max_output_tokens,
                cost_input_per_million = excluded.cost_input_per_million,
                cost_output_per_million = excluded.cost_output_per_million,
                supports_vision = excluded.supports_vision,
                supports_tools = excluded.supports_tools,
                supports_streaming = excluded.supports_streaming,
                is_deprecated = excluded.is_deprecated,
                release_date = excluded.release_date,
                description = excluded.description,
                updated_at = excluded.updated_at",
            params![
                metadata.model_id,
                metadata.provider_type,
                metadata.display_name,
                metadata.family,
                metadata.tier,
                metadata.context_length,
                metadata.max_output_tokens,
                metadata.cost_input_per_million,
                metadata.cost_output_per_million,
                metadata.supports_vision as i32,
                metadata.supports_tools as i32,
                metadata.supports_streaming as i32,
                metadata.is_deprecated as i32,
                metadata.release_date,
                metadata.description,
                metadata.created_at,
                metadata.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// 批量插入模型元数据
    pub fn bulk_upsert_model_metadata(
        conn: &Connection,
        metadata_list: &[ModelMetadataRow],
    ) -> Result<usize, String> {
        let mut count = 0;
        for metadata in metadata_list {
            Self::upsert_model_metadata(conn, metadata)?;
            count += 1;
        }
        Ok(count)
    }

    // ========================================================================
    // 用户等级偏好操作
    // ========================================================================

    /// 获取所有用户等级偏好
    pub fn get_all_tier_preferences(conn: &Connection) -> Result<Vec<UserTierPreference>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT tier_id, strategy_id, preferred_provider, fallback_enabled,
                        max_retries, created_at, updated_at
                 FROM user_tier_preferences
                 ORDER BY tier_id",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(UserTierPreference {
                    tier_id: row.get(0)?,
                    strategy_id: row.get(1)?,
                    preferred_provider: row.get(2)?,
                    fallback_enabled: row.get::<_, i32>(3)? != 0,
                    max_retries: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// 获取单个等级偏好
    pub fn get_tier_preference(
        conn: &Connection,
        tier_id: &str,
    ) -> Result<Option<UserTierPreference>, String> {
        conn.query_row(
            "SELECT tier_id, strategy_id, preferred_provider, fallback_enabled,
                    max_retries, created_at, updated_at
             FROM user_tier_preferences
             WHERE tier_id = ?1",
            [tier_id],
            |row| {
                Ok(UserTierPreference {
                    tier_id: row.get(0)?,
                    strategy_id: row.get(1)?,
                    preferred_provider: row.get(2)?,
                    fallback_enabled: row.get::<_, i32>(3)? != 0,
                    max_retries: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// 插入或更新等级偏好
    pub fn upsert_tier_preference(
        conn: &Connection,
        pref: &UserTierPreference,
    ) -> Result<(), String> {
        conn.execute(
            "INSERT INTO user_tier_preferences (
                tier_id, strategy_id, preferred_provider, fallback_enabled,
                max_retries, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(tier_id) DO UPDATE SET
                strategy_id = excluded.strategy_id,
                preferred_provider = excluded.preferred_provider,
                fallback_enabled = excluded.fallback_enabled,
                max_retries = excluded.max_retries,
                updated_at = excluded.updated_at",
            params![
                pref.tier_id,
                pref.strategy_id,
                pref.preferred_provider,
                pref.fallback_enabled as i32,
                pref.max_retries,
                pref.created_at,
                pref.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// 初始化默认等级偏好
    pub fn init_default_tier_preferences(conn: &Connection) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();

        let defaults = vec![
            UserTierPreference {
                tier_id: "mini".to_string(),
                strategy_id: "speed_optimized".to_string(),
                preferred_provider: None,
                fallback_enabled: true,
                max_retries: 3,
                created_at: now,
                updated_at: now,
            },
            UserTierPreference {
                tier_id: "pro".to_string(),
                strategy_id: "task_based".to_string(),
                preferred_provider: None,
                fallback_enabled: true,
                max_retries: 3,
                created_at: now,
                updated_at: now,
            },
            UserTierPreference {
                tier_id: "max".to_string(),
                strategy_id: "quality_first".to_string(),
                preferred_provider: None,
                fallback_enabled: true,
                max_retries: 3,
                created_at: now,
                updated_at: now,
            },
        ];

        for pref in defaults {
            // 只在不存在时插入
            let exists = Self::get_tier_preference(conn, &pref.tier_id)?.is_some();
            if !exists {
                Self::upsert_tier_preference(conn, &pref)?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::schema::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn test_model_metadata_crud() {
        let conn = setup_test_db();
        let now = chrono::Utc::now().timestamp();

        let metadata = ModelMetadataRow {
            model_id: "claude-3-opus".to_string(),
            provider_type: "anthropic".to_string(),
            display_name: "Claude 3 Opus".to_string(),
            family: Some("opus".to_string()),
            tier: "max".to_string(),
            context_length: Some(200000),
            max_output_tokens: Some(4096),
            cost_input_per_million: Some(15.0),
            cost_output_per_million: Some(75.0),
            supports_vision: true,
            supports_tools: true,
            supports_streaming: true,
            is_deprecated: false,
            release_date: Some("2024-03-04".to_string()),
            description: Some("Most capable Claude model".to_string()),
            created_at: now,
            updated_at: now,
        };

        // Insert
        OrchestratorDao::upsert_model_metadata(&conn, &metadata).unwrap();

        // Read
        let result = OrchestratorDao::get_model_metadata(&conn, "claude-3-opus")
            .unwrap()
            .unwrap();
        assert_eq!(result.display_name, "Claude 3 Opus");
        assert!(result.supports_vision);

        // Update
        let mut updated = metadata.clone();
        updated.display_name = "Claude 3 Opus (Updated)".to_string();
        OrchestratorDao::upsert_model_metadata(&conn, &updated).unwrap();

        let result = OrchestratorDao::get_model_metadata(&conn, "claude-3-opus")
            .unwrap()
            .unwrap();
        assert_eq!(result.display_name, "Claude 3 Opus (Updated)");
    }

    #[test]
    fn test_tier_preferences() {
        let conn = setup_test_db();

        // Init defaults
        OrchestratorDao::init_default_tier_preferences(&conn).unwrap();

        // Check defaults exist
        let prefs = OrchestratorDao::get_all_tier_preferences(&conn).unwrap();
        assert_eq!(prefs.len(), 3);

        // Get specific
        let pro = OrchestratorDao::get_tier_preference(&conn, "pro")
            .unwrap()
            .unwrap();
        assert_eq!(pro.strategy_id, "task_based");
    }
}
