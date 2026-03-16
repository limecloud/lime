use chrono::Utc;
use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::io;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BrowserProfileTransportKind {
    #[default]
    ManagedCdp,
    ExistingSession,
}

impl BrowserProfileTransportKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::ManagedCdp => "managed_cdp",
            Self::ExistingSession => "existing_session",
        }
    }

    fn parse(value: String) -> Result<Self, rusqlite::Error> {
        match value.as_str() {
            "managed_cdp" => Ok(Self::ManagedCdp),
            "existing_session" => Ok(Self::ExistingSession),
            _ => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                Type::Text,
                Box::new(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("未知的浏览器资料传输模式: {value}"),
                )),
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserProfileRecord {
    pub id: String,
    pub profile_key: String,
    pub name: String,
    pub description: Option<String>,
    pub site_scope: Option<String>,
    pub launch_url: Option<String>,
    pub transport_kind: BrowserProfileTransportKind,
    pub profile_dir: String,
    pub managed_profile_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpsertBrowserProfileInput {
    pub id: Option<String>,
    pub profile_key: String,
    pub name: String,
    pub description: Option<String>,
    pub site_scope: Option<String>,
    pub launch_url: Option<String>,
    pub transport_kind: BrowserProfileTransportKind,
    pub profile_dir: String,
    pub managed_profile_dir: Option<String>,
}

pub struct BrowserProfileDao;

impl BrowserProfileDao {
    pub fn get_by_id(
        conn: &Connection,
        id: &str,
    ) -> Result<Option<BrowserProfileRecord>, rusqlite::Error> {
        conn.query_row(
            "SELECT
                id,
                profile_key,
                name,
                description,
                site_scope,
                launch_url,
                transport_kind,
                profile_dir,
                managed_profile_dir,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_profiles
             WHERE id = ?1",
            [id],
            map_browser_profile_row,
        )
        .optional()
    }

    pub fn get_by_profile_key(
        conn: &Connection,
        profile_key: &str,
    ) -> Result<Option<BrowserProfileRecord>, rusqlite::Error> {
        conn.query_row(
            "SELECT
                id,
                profile_key,
                name,
                description,
                site_scope,
                launch_url,
                transport_kind,
                profile_dir,
                managed_profile_dir,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_profiles
             WHERE profile_key = ?1",
            [profile_key],
            map_browser_profile_row,
        )
        .optional()
    }

    pub fn list(
        conn: &Connection,
        include_archived: bool,
    ) -> Result<Vec<BrowserProfileRecord>, rusqlite::Error> {
        let sql = if include_archived {
            "SELECT
                id,
                profile_key,
                name,
                description,
                site_scope,
                launch_url,
                transport_kind,
                profile_dir,
                managed_profile_dir,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_profiles
             ORDER BY
                CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
                COALESCE(last_used_at, updated_at) DESC,
                name COLLATE NOCASE ASC"
        } else {
            "SELECT
                id,
                profile_key,
                name,
                description,
                site_scope,
                launch_url,
                transport_kind,
                profile_dir,
                managed_profile_dir,
                created_at,
                updated_at,
                last_used_at,
                archived_at
             FROM browser_profiles
             WHERE archived_at IS NULL
             ORDER BY
                COALESCE(last_used_at, updated_at) DESC,
                name COLLATE NOCASE ASC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], map_browser_profile_row)?;
        rows.collect()
    }

    pub fn upsert(
        conn: &Connection,
        input: &UpsertBrowserProfileInput,
    ) -> Result<BrowserProfileRecord, rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = Self::get_by_id(conn, &id)?
            .map(|existing| existing.created_at)
            .unwrap_or_else(|| now.clone());

        conn.execute(
            "INSERT INTO browser_profiles (
                id,
                profile_key,
                name,
                description,
                site_scope,
                launch_url,
                transport_kind,
                profile_dir,
                managed_profile_dir,
                created_at,
                updated_at,
                last_used_at,
                archived_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                site_scope = excluded.site_scope,
                launch_url = excluded.launch_url,
                transport_kind = excluded.transport_kind,
                profile_dir = excluded.profile_dir,
                managed_profile_dir = excluded.managed_profile_dir,
                updated_at = excluded.updated_at",
            params![
                id,
                input.profile_key,
                input.name,
                input.description,
                input.site_scope,
                input.launch_url,
                input.transport_kind.as_str(),
                input.profile_dir,
                input.managed_profile_dir,
                created_at,
                now,
            ],
        )?;

        Self::get_by_id(conn, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn archive(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let affected = conn.execute(
            "UPDATE browser_profiles
             SET archived_at = ?2, updated_at = ?2
             WHERE id = ?1 AND archived_at IS NULL",
            params![id, Utc::now().to_rfc3339()],
        )?;
        Ok(affected > 0)
    }

    pub fn restore(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let affected = conn.execute(
            "UPDATE browser_profiles
             SET archived_at = NULL, updated_at = ?2
             WHERE id = ?1 AND archived_at IS NOT NULL",
            params![id, Utc::now().to_rfc3339()],
        )?;
        Ok(affected > 0)
    }

    pub fn touch_last_used(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let affected = conn.execute(
            "UPDATE browser_profiles
             SET last_used_at = ?2, updated_at = ?2
             WHERE id = ?1",
            params![id, now],
        )?;
        Ok(affected > 0)
    }
}

fn map_browser_profile_row(
    row: &rusqlite::Row<'_>,
) -> Result<BrowserProfileRecord, rusqlite::Error> {
    let transport_kind = BrowserProfileTransportKind::parse(row.get(6)?)?;
    Ok(BrowserProfileRecord {
        id: row.get(0)?,
        profile_key: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        site_scope: row.get(4)?,
        launch_url: row.get(5)?,
        transport_kind,
        profile_dir: row.get(7)?,
        managed_profile_dir: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        last_used_at: row.get(11)?,
        archived_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE browser_profiles (
                id TEXT PRIMARY KEY,
                profile_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                site_scope TEXT,
                launch_url TEXT,
                transport_kind TEXT NOT NULL DEFAULT 'managed_cdp',
                profile_dir TEXT NOT NULL,
                managed_profile_dir TEXT,
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
    fn should_insert_and_list_active_profiles() {
        let conn = setup_db();
        let inserted = BrowserProfileDao::upsert(
            &conn,
            &UpsertBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: Some("主账号".to_string()),
                site_scope: Some("shop.example.com".to_string()),
                launch_url: Some("https://shop.example.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
                profile_dir: "/tmp/browser/shop_us".to_string(),
                managed_profile_dir: Some("/tmp/browser/shop_us".to_string()),
            },
        )
        .unwrap();

        let profiles = BrowserProfileDao::list(&conn, false).unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0], inserted);
        assert_eq!(
            profiles[0].transport_kind,
            BrowserProfileTransportKind::ManagedCdp
        );
        assert_eq!(
            profiles[0].managed_profile_dir.as_deref(),
            Some("/tmp/browser/shop_us")
        );
    }

    #[test]
    fn should_archive_and_restore_profile() {
        let conn = setup_db();
        let inserted = BrowserProfileDao::upsert(
            &conn,
            &UpsertBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: None,
                site_scope: None,
                launch_url: None,
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
                profile_dir: "/tmp/browser/shop_us".to_string(),
                managed_profile_dir: Some("/tmp/browser/shop_us".to_string()),
            },
        )
        .unwrap();

        assert!(BrowserProfileDao::archive(&conn, &inserted.id).unwrap());
        assert!(BrowserProfileDao::list(&conn, false).unwrap().is_empty());

        let archived = BrowserProfileDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert!(archived.archived_at.is_some());

        assert!(BrowserProfileDao::restore(&conn, &inserted.id).unwrap());
        let restored = BrowserProfileDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert!(restored.archived_at.is_none());
    }

    #[test]
    fn should_touch_last_used_timestamp() {
        let conn = setup_db();
        let inserted = BrowserProfileDao::upsert(
            &conn,
            &UpsertBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: None,
                site_scope: None,
                launch_url: None,
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
                profile_dir: "/tmp/browser/shop_us".to_string(),
                managed_profile_dir: Some("/tmp/browser/shop_us".to_string()),
            },
        )
        .unwrap();

        assert!(BrowserProfileDao::touch_last_used(&conn, &inserted.id).unwrap());
        let touched = BrowserProfileDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert!(touched.last_used_at.is_some());
    }

    #[test]
    fn should_round_trip_existing_session_transport() {
        let conn = setup_db();
        let inserted = BrowserProfileDao::upsert(
            &conn,
            &UpsertBrowserProfileInput {
                id: None,
                profile_key: "weibo_attach".to_string(),
                name: "微博附着".to_string(),
                description: Some("附着当前 Chrome".to_string()),
                site_scope: Some("weibo.com".to_string()),
                launch_url: Some("https://weibo.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ExistingSession,
                profile_dir: String::new(),
                managed_profile_dir: None,
            },
        )
        .unwrap();

        let fetched = BrowserProfileDao::get_by_id(&conn, &inserted.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            fetched.transport_kind,
            BrowserProfileTransportKind::ExistingSession
        );
        assert_eq!(fetched.profile_dir, "");
        assert_eq!(fetched.managed_profile_dir, None);
    }
}
