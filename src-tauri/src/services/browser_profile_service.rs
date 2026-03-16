use std::path::{Path, PathBuf};

use proxycast_core::app_paths;
use proxycast_core::database::dao::browser_profile::{
    BrowserProfileDao, BrowserProfileRecord, BrowserProfileTransportKind, UpsertBrowserProfileInput,
};
use rusqlite::Connection;
use url::Url;

#[derive(Debug, Clone)]
pub struct SaveBrowserProfileInput {
    pub id: Option<String>,
    pub profile_key: String,
    pub name: String,
    pub description: Option<String>,
    pub site_scope: Option<String>,
    pub launch_url: Option<String>,
    pub transport_kind: BrowserProfileTransportKind,
}

pub fn sanitize_browser_profile_key(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

pub fn normalize_browser_profile_key(input: &str) -> String {
    let safe_key = sanitize_browser_profile_key(input);
    if safe_key.trim_matches('_').is_empty() {
        "default".to_string()
    } else {
        safe_key
    }
}

pub fn resolve_chrome_profile_data_dir_from_base(base_dir: &Path, profile_key: &str) -> PathBuf {
    base_dir
        .join("chrome_profiles")
        .join(normalize_browser_profile_key(profile_key))
}

pub fn resolve_chrome_profile_data_dir(profile_key: &str) -> Result<PathBuf, String> {
    let base_dir = app_paths::preferred_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    Ok(resolve_chrome_profile_data_dir_from_base(
        &base_dir,
        profile_key,
    ))
}

pub fn list_browser_profiles(
    conn: &Connection,
    include_archived: bool,
) -> Result<Vec<BrowserProfileRecord>, String> {
    BrowserProfileDao::list(conn, include_archived)
        .map_err(|error| format!("读取浏览器资料失败: {error}"))
}

pub fn get_browser_profile(
    conn: &Connection,
    id: &str,
) -> Result<Option<BrowserProfileRecord>, String> {
    BrowserProfileDao::get_by_id(conn, id).map_err(|error| format!("读取浏览器资料失败: {error}"))
}

pub fn save_browser_profile(
    conn: &Connection,
    input: SaveBrowserProfileInput,
) -> Result<BrowserProfileRecord, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("资料名称不能为空".to_string());
    }

    let profile_key = normalize_browser_profile_key(&input.profile_key);
    let description = normalize_optional_text(input.description);
    let site_scope = normalize_optional_text(input.site_scope);
    let launch_url = normalize_launch_url(input.launch_url)?;
    let (profile_dir, managed_profile_dir) =
        resolve_browser_profile_storage(&profile_key, input.transport_kind)?;

    if let Some(ref id) = input.id {
        let existing = BrowserProfileDao::get_by_id(conn, id)
            .map_err(|error| format!("读取浏览器资料失败: {error}"))?
            .ok_or_else(|| format!("未找到浏览器资料: {id}"))?;
        if existing.profile_key != profile_key {
            return Err("暂不支持修改资料 Key，请新建一个资料".to_string());
        }
    } else if let Some(existing) = BrowserProfileDao::get_by_profile_key(conn, &profile_key)
        .map_err(|error| format!("读取浏览器资料失败: {error}"))?
    {
        if existing.archived_at.is_none() {
            return Err(format!("资料 Key 已存在: {profile_key}"));
        }
    }

    BrowserProfileDao::upsert(
        conn,
        &UpsertBrowserProfileInput {
            id: input.id,
            profile_key,
            name,
            description,
            site_scope,
            launch_url,
            transport_kind: input.transport_kind,
            profile_dir,
            managed_profile_dir,
        },
    )
    .map_err(|error| format!("保存浏览器资料失败: {error}"))
}

pub fn archive_browser_profile(conn: &Connection, id: &str) -> Result<bool, String> {
    BrowserProfileDao::archive(conn, id).map_err(|error| format!("归档浏览器资料失败: {error}"))
}

pub fn restore_browser_profile(conn: &Connection, id: &str) -> Result<bool, String> {
    BrowserProfileDao::restore(conn, id).map_err(|error| format!("恢复浏览器资料失败: {error}"))
}

pub fn touch_browser_profile_last_used(conn: &Connection, id: &str) -> Result<bool, String> {
    BrowserProfileDao::touch_last_used(conn, id)
        .map_err(|error| format!("更新浏览器资料最近使用时间失败: {error}"))
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_launch_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = normalize_optional_text(value) else {
        return Ok(None);
    };
    let parsed = Url::parse(&raw).map_err(|error| format!("启动地址无效: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(Some(parsed.to_string())),
        _ => Err("启动地址仅支持 http/https".to_string()),
    }
}

fn resolve_browser_profile_storage(
    profile_key: &str,
    transport_kind: BrowserProfileTransportKind,
) -> Result<(String, Option<String>), String> {
    match transport_kind {
        BrowserProfileTransportKind::ManagedCdp => {
            let managed_profile_dir = resolve_chrome_profile_data_dir(profile_key)?
                .to_string_lossy()
                .to_string();
            Ok((managed_profile_dir.clone(), Some(managed_profile_dir)))
        }
        BrowserProfileTransportKind::ExistingSession => Ok((String::new(), None)),
    }
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
    fn should_normalize_browser_profile_key() {
        assert_eq!(
            normalize_browser_profile_key("shop/google:zh-CN"),
            "shop_google_zh-CN"
        );
        assert_eq!(normalize_browser_profile_key("///"), "default");
    }

    #[test]
    fn should_reject_invalid_launch_url() {
        let conn = setup_db();
        let error = save_browser_profile(
            &conn,
            SaveBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: None,
                site_scope: None,
                launch_url: Some("file:///tmp/demo".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
            },
        )
        .unwrap_err();

        assert!(error.contains("仅支持 http/https"));
    }

    #[test]
    fn should_disallow_changing_profile_key_on_existing_record() {
        let conn = setup_db();
        let inserted = save_browser_profile(
            &conn,
            SaveBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: None,
                site_scope: None,
                launch_url: Some("https://example.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
            },
        )
        .unwrap();

        let error = save_browser_profile(
            &conn,
            SaveBrowserProfileInput {
                id: Some(inserted.id),
                profile_key: "shop_eu".to_string(),
                name: "欧区店铺".to_string(),
                description: None,
                site_scope: None,
                launch_url: Some("https://example.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
            },
        )
        .unwrap_err();

        assert!(error.contains("暂不支持修改资料 Key"));
    }

    #[test]
    fn should_save_managed_profile_with_managed_storage() {
        let conn = setup_db();
        let saved = save_browser_profile(
            &conn,
            SaveBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: None,
                site_scope: Some("seller.example.com".to_string()),
                launch_url: Some("https://seller.example.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
            },
        )
        .unwrap();

        assert_eq!(
            saved.transport_kind,
            BrowserProfileTransportKind::ManagedCdp
        );
        assert!(!saved.profile_dir.is_empty());
        assert_eq!(
            saved.managed_profile_dir.as_deref(),
            Some(saved.profile_dir.as_str())
        );
    }

    #[test]
    fn should_save_existing_session_profile_without_managed_dir() {
        let conn = setup_db();
        let saved = save_browser_profile(
            &conn,
            SaveBrowserProfileInput {
                id: None,
                profile_key: "weibo_attach".to_string(),
                name: "微博附着".to_string(),
                description: Some("依赖当前 Chrome".to_string()),
                site_scope: Some("weibo.com".to_string()),
                launch_url: Some("https://weibo.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ExistingSession,
            },
        )
        .unwrap();

        assert_eq!(
            saved.transport_kind,
            BrowserProfileTransportKind::ExistingSession
        );
        assert_eq!(saved.profile_dir, "");
        assert_eq!(saved.managed_profile_dir, None);
    }
}
