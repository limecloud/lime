use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserEnvironmentPresetRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub proxy_server: Option<String>,
    pub timezone_id: Option<String>,
    pub locale: Option<String>,
    pub accept_language: Option<String>,
    pub geolocation_lat: Option<f64>,
    pub geolocation_lng: Option<f64>,
    pub geolocation_accuracy_m: Option<f64>,
    pub user_agent: Option<String>,
    pub platform: Option<String>,
    pub viewport_width: Option<i64>,
    pub viewport_height: Option<i64>,
    pub device_scale_factor: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpsertBrowserEnvironmentPresetInput {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub proxy_server: Option<String>,
    pub timezone_id: Option<String>,
    pub locale: Option<String>,
    pub accept_language: Option<String>,
    pub geolocation_lat: Option<f64>,
    pub geolocation_lng: Option<f64>,
    pub geolocation_accuracy_m: Option<f64>,
    pub user_agent: Option<String>,
    pub platform: Option<String>,
    pub viewport_width: Option<i64>,
    pub viewport_height: Option<i64>,
    pub device_scale_factor: Option<f64>,
}

pub struct BrowserEnvironmentPresetDao;

impl BrowserEnvironmentPresetDao {
    pub fn get_by_id(
        conn: &Connection,
        id: &str,
    ) -> Result<Option<BrowserEnvironmentPresetRecord>, rusqlite::Error> {
        conn.query_row(
            "SELECT
                id,
                name,
                description,
                proxy_server,
                timezone_id,
                locale,
                accept_language,
                geolocation_lat,
                geolocation_lng,
                geolocation_accuracy_m,
                user_agent,
                platform,
                viewport_width,
                viewport_height,
                device_scale_factor,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_environment_presets
             WHERE id = ?1",
            [id],
            map_browser_environment_preset_row,
        )
        .optional()
    }

    pub fn list(
        conn: &Connection,
        include_archived: bool,
    ) -> Result<Vec<BrowserEnvironmentPresetRecord>, rusqlite::Error> {
        let sql = if include_archived {
            "SELECT
                id,
                name,
                description,
                proxy_server,
                timezone_id,
                locale,
                accept_language,
                geolocation_lat,
                geolocation_lng,
                geolocation_accuracy_m,
                user_agent,
                platform,
                viewport_width,
                viewport_height,
                device_scale_factor,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_environment_presets
             ORDER BY
                CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
                COALESCE(last_used_at, updated_at) DESC,
                name COLLATE NOCASE ASC"
        } else {
            "SELECT
                id,
                name,
                description,
                proxy_server,
                timezone_id,
                locale,
                accept_language,
                geolocation_lat,
                geolocation_lng,
                geolocation_accuracy_m,
                user_agent,
                platform,
                viewport_width,
                viewport_height,
                device_scale_factor,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_environment_presets
             WHERE archived_at IS NULL
             ORDER BY
                COALESCE(last_used_at, updated_at) DESC,
                name COLLATE NOCASE ASC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], map_browser_environment_preset_row)?;
        rows.collect()
    }

    pub fn upsert(
        conn: &Connection,
        input: &UpsertBrowserEnvironmentPresetInput,
    ) -> Result<BrowserEnvironmentPresetRecord, rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = Self::get_by_id(conn, &id)?
            .map(|existing| existing.created_at)
            .unwrap_or_else(|| now.clone());

        conn.execute(
            "INSERT INTO browser_environment_presets (
                id,
                name,
                description,
                proxy_server,
                timezone_id,
                locale,
                accept_language,
                geolocation_lat,
                geolocation_lng,
                geolocation_accuracy_m,
                user_agent,
                platform,
                viewport_width,
                viewport_height,
                device_scale_factor,
                created_at,
                updated_at,
                last_used_at,
                archived_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                proxy_server = excluded.proxy_server,
                timezone_id = excluded.timezone_id,
                locale = excluded.locale,
                accept_language = excluded.accept_language,
                geolocation_lat = excluded.geolocation_lat,
                geolocation_lng = excluded.geolocation_lng,
                geolocation_accuracy_m = excluded.geolocation_accuracy_m,
                user_agent = excluded.user_agent,
                platform = excluded.platform,
                viewport_width = excluded.viewport_width,
                viewport_height = excluded.viewport_height,
                device_scale_factor = excluded.device_scale_factor,
                updated_at = excluded.updated_at",
            params![
                id,
                input.name,
                input.description,
                input.proxy_server,
                input.timezone_id,
                input.locale,
                input.accept_language,
                input.geolocation_lat,
                input.geolocation_lng,
                input.geolocation_accuracy_m,
                input.user_agent,
                input.platform,
                input.viewport_width,
                input.viewport_height,
                input.device_scale_factor,
                created_at,
                now,
            ],
        )?;

        Self::get_by_id(conn, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn archive(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let affected = conn.execute(
            "UPDATE browser_environment_presets
             SET archived_at = ?2, updated_at = ?2
             WHERE id = ?1 AND archived_at IS NULL",
            params![id, Utc::now().to_rfc3339()],
        )?;
        Ok(affected > 0)
    }

    pub fn restore(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let affected = conn.execute(
            "UPDATE browser_environment_presets
             SET archived_at = NULL, updated_at = ?2
             WHERE id = ?1 AND archived_at IS NOT NULL",
            params![id, Utc::now().to_rfc3339()],
        )?;
        Ok(affected > 0)
    }

    pub fn touch_last_used(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let affected = conn.execute(
            "UPDATE browser_environment_presets
             SET last_used_at = ?2, updated_at = ?2
             WHERE id = ?1",
            params![id, now],
        )?;
        Ok(affected > 0)
    }
}

fn map_browser_environment_preset_row(
    row: &rusqlite::Row<'_>,
) -> Result<BrowserEnvironmentPresetRecord, rusqlite::Error> {
    Ok(BrowserEnvironmentPresetRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        proxy_server: row.get(3)?,
        timezone_id: row.get(4)?,
        locale: row.get(5)?,
        accept_language: row.get(6)?,
        geolocation_lat: row.get(7)?,
        geolocation_lng: row.get(8)?,
        geolocation_accuracy_m: row.get(9)?,
        user_agent: row.get(10)?,
        platform: row.get(11)?,
        viewport_width: row.get(12)?,
        viewport_height: row.get(13)?,
        device_scale_factor: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        last_used_at: row.get(17)?,
        archived_at: row.get(18)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE browser_environment_presets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                proxy_server TEXT,
                timezone_id TEXT,
                locale TEXT,
                accept_language TEXT,
                geolocation_lat REAL,
                geolocation_lng REAL,
                geolocation_accuracy_m REAL,
                user_agent TEXT,
                platform TEXT,
                viewport_width INTEGER,
                viewport_height INTEGER,
                device_scale_factor REAL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                archived_at TEXT
            )",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn should_insert_and_list_active_presets() {
        let conn = setup_db();
        let inserted = BrowserEnvironmentPresetDao::upsert(
            &conn,
            &UpsertBrowserEnvironmentPresetInput {
                id: None,
                name: "美区桌面".to_string(),
                description: Some("美国住宅代理".to_string()),
                proxy_server: Some("http://127.0.0.1:7890".to_string()),
                timezone_id: Some("America/Los_Angeles".to_string()),
                locale: Some("en-US".to_string()),
                accept_language: Some("en-US,en;q=0.9".to_string()),
                geolocation_lat: Some(37.7749),
                geolocation_lng: Some(-122.4194),
                geolocation_accuracy_m: Some(100.0),
                user_agent: Some("Mozilla/5.0".to_string()),
                platform: Some("MacIntel".to_string()),
                viewport_width: Some(1440),
                viewport_height: Some(900),
                device_scale_factor: Some(2.0),
            },
        )
        .unwrap();

        let presets = BrowserEnvironmentPresetDao::list(&conn, false).unwrap();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0], inserted);
    }

    #[test]
    fn should_archive_and_restore_preset() {
        let conn = setup_db();
        let inserted = BrowserEnvironmentPresetDao::upsert(
            &conn,
            &UpsertBrowserEnvironmentPresetInput {
                id: None,
                name: "美区桌面".to_string(),
                description: None,
                proxy_server: None,
                timezone_id: None,
                locale: None,
                accept_language: None,
                geolocation_lat: None,
                geolocation_lng: None,
                geolocation_accuracy_m: None,
                user_agent: None,
                platform: None,
                viewport_width: None,
                viewport_height: None,
                device_scale_factor: None,
            },
        )
        .unwrap();

        assert!(BrowserEnvironmentPresetDao::archive(&conn, &inserted.id).unwrap());
        assert!(BrowserEnvironmentPresetDao::list(&conn, false)
            .unwrap()
            .is_empty());

        let archived = BrowserEnvironmentPresetDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert!(archived.archived_at.is_some());

        assert!(BrowserEnvironmentPresetDao::restore(&conn, &inserted.id).unwrap());
        let restored = BrowserEnvironmentPresetDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert!(restored.archived_at.is_none());
    }

    #[test]
    fn should_touch_last_used_timestamp() {
        let conn = setup_db();
        let inserted = BrowserEnvironmentPresetDao::upsert(
            &conn,
            &UpsertBrowserEnvironmentPresetInput {
                id: None,
                name: "美区桌面".to_string(),
                description: None,
                proxy_server: None,
                timezone_id: None,
                locale: None,
                accept_language: None,
                geolocation_lat: None,
                geolocation_lng: None,
                geolocation_accuracy_m: None,
                user_agent: None,
                platform: None,
                viewport_width: None,
                viewport_height: None,
                device_scale_factor: None,
            },
        )
        .unwrap();

        assert!(BrowserEnvironmentPresetDao::touch_last_used(&conn, &inserted.id).unwrap());
        let touched = BrowserEnvironmentPresetDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert!(touched.last_used_at.is_some());
    }
}
