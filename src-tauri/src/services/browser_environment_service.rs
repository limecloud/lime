use lime_browser_runtime::BrowserRuntimeManager;
use lime_core::database::dao::browser_environment_preset::{
    BrowserEnvironmentPresetDao, BrowserEnvironmentPresetRecord,
    UpsertBrowserEnvironmentPresetInput,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const DEFAULT_CDP_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_ID: &str = "browser-environment-us-desktop";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_NAME: &str = "美区桌面";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_DESCRIPTION: &str = "美国住宅代理 + 桌面视口";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_PROXY_SERVER: &str = "http://127.0.0.1:7890";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_TIMEZONE_ID: &str = "America/Los_Angeles";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_LOCALE: &str = "en-US";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_ACCEPT_LANGUAGE: &str = "en-US,en;q=0.9";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_USER_AGENT: &str = "Mozilla/5.0";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_PLATFORM: &str = "MacIntel";
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_VIEWPORT_WIDTH: i64 = 1440;
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_VIEWPORT_HEIGHT: i64 = 900;
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_DEVICE_SCALE_FACTOR: f64 = 2.0;
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_LAT: f64 = 37.7749;
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_LNG: f64 = -122.4194;
const DEFAULT_BROWSER_ENVIRONMENT_PRESET_GEO_ACCURACY_M: f64 = 100.0;

#[derive(Debug, Clone)]
pub struct SaveBrowserEnvironmentPresetInput {
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BrowserEnvironmentLaunchConfig {
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub preset_name: Option<String>,
    #[serde(default)]
    pub proxy_server: Option<String>,
    #[serde(default)]
    pub timezone_id: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub accept_language: Option<String>,
    #[serde(default)]
    pub geolocation_lat: Option<f64>,
    #[serde(default)]
    pub geolocation_lng: Option<f64>,
    #[serde(default)]
    pub geolocation_accuracy_m: Option<f64>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub viewport_width: Option<u32>,
    #[serde(default)]
    pub viewport_height: Option<u32>,
    #[serde(default)]
    pub device_scale_factor: Option<f64>,
}

impl BrowserEnvironmentLaunchConfig {
    pub fn browser_launch_language(&self) -> Option<String> {
        if let Some(accept_language) = self.accept_language.as_deref() {
            let first_language = accept_language
                .split(',')
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(language) = first_language {
                return Some(language.to_string());
            }
        }
        self.locale
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.replace('_', "-"))
    }

    pub fn requires_browser_relaunch(&self) -> bool {
        self.proxy_server.is_some()
    }

    pub fn has_runtime_overrides(&self) -> bool {
        self.timezone_id.is_some()
            || self.locale.is_some()
            || self.accept_language.is_some()
            || self.geolocation_lat.is_some()
            || self.geolocation_lng.is_some()
            || self.user_agent.is_some()
            || self.platform.is_some()
            || self.viewport_width.is_some()
            || self.viewport_height.is_some()
            || self.device_scale_factor.is_some()
    }
}

pub fn list_browser_environment_presets(
    conn: &Connection,
    include_archived: bool,
) -> Result<Vec<BrowserEnvironmentPresetRecord>, String> {
    BrowserEnvironmentPresetDao::list(conn, include_archived)
        .map_err(|error| format!("读取浏览器环境预设失败: {error}"))
}

pub fn ensure_default_browser_environment_presets(conn: &Connection) -> Result<bool, String> {
    let existing_presets = BrowserEnvironmentPresetDao::list(conn, true)
        .map_err(|error| format!("读取浏览器环境预设失败: {error}"))?;
    if !existing_presets.is_empty() {
        return Ok(false);
    }

    save_browser_environment_preset(
        conn,
        SaveBrowserEnvironmentPresetInput {
            id: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_ID.to_string()),
            name: DEFAULT_BROWSER_ENVIRONMENT_PRESET_NAME.to_string(),
            description: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_DESCRIPTION.to_string()),
            proxy_server: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_PROXY_SERVER.to_string()),
            timezone_id: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_TIMEZONE_ID.to_string()),
            locale: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_LOCALE.to_string()),
            accept_language: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_ACCEPT_LANGUAGE.to_string()),
            geolocation_lat: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_LAT),
            geolocation_lng: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_LNG),
            geolocation_accuracy_m: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_GEO_ACCURACY_M),
            user_agent: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_USER_AGENT.to_string()),
            platform: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_PLATFORM.to_string()),
            viewport_width: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_VIEWPORT_WIDTH),
            viewport_height: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_VIEWPORT_HEIGHT),
            device_scale_factor: Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_DEVICE_SCALE_FACTOR),
        },
    )?;

    Ok(true)
}

pub fn get_browser_environment_preset(
    conn: &Connection,
    id: &str,
) -> Result<Option<BrowserEnvironmentPresetRecord>, String> {
    BrowserEnvironmentPresetDao::get_by_id(conn, id)
        .map_err(|error| format!("读取浏览器环境预设失败: {error}"))
}

pub fn save_browser_environment_preset(
    conn: &Connection,
    input: SaveBrowserEnvironmentPresetInput,
) -> Result<BrowserEnvironmentPresetRecord, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("环境预设名称不能为空".to_string());
    }

    let description = normalize_optional_text(input.description);
    let proxy_server = normalize_optional_text(input.proxy_server);
    let timezone_id = normalize_optional_text(input.timezone_id);
    let locale = normalize_optional_text(input.locale);
    let accept_language = normalize_optional_text(input.accept_language);
    let user_agent = normalize_optional_text(input.user_agent);
    let platform = normalize_optional_text(input.platform);
    let (geolocation_lat, geolocation_lng, geolocation_accuracy_m) = normalize_geolocation(
        input.geolocation_lat,
        input.geolocation_lng,
        input.geolocation_accuracy_m,
    )?;
    let (viewport_width, viewport_height) =
        normalize_viewport(input.viewport_width, input.viewport_height)?;
    let device_scale_factor = normalize_device_scale_factor(input.device_scale_factor)?;

    BrowserEnvironmentPresetDao::upsert(
        conn,
        &UpsertBrowserEnvironmentPresetInput {
            id: input.id,
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
        },
    )
    .map_err(|error| format!("保存浏览器环境预设失败: {error}"))
}

pub fn archive_browser_environment_preset(conn: &Connection, id: &str) -> Result<bool, String> {
    BrowserEnvironmentPresetDao::archive(conn, id)
        .map_err(|error| format!("归档浏览器环境预设失败: {error}"))
}

pub fn restore_browser_environment_preset(conn: &Connection, id: &str) -> Result<bool, String> {
    BrowserEnvironmentPresetDao::restore(conn, id)
        .map_err(|error| format!("恢复浏览器环境预设失败: {error}"))
}

pub fn touch_browser_environment_preset_last_used(
    conn: &Connection,
    id: &str,
) -> Result<bool, String> {
    BrowserEnvironmentPresetDao::touch_last_used(conn, id)
        .map_err(|error| format!("更新浏览器环境预设最近使用时间失败: {error}"))
}

pub fn build_browser_environment_launch_config(
    preset: &BrowserEnvironmentPresetRecord,
) -> Result<BrowserEnvironmentLaunchConfig, String> {
    let viewport_width = preset
        .viewport_width
        .map(|value| u32::try_from(value).map_err(|_| format!("视口宽度超出范围: {value}")))
        .transpose()?;
    let viewport_height = preset
        .viewport_height
        .map(|value| u32::try_from(value).map_err(|_| format!("视口高度超出范围: {value}")))
        .transpose()?;

    Ok(BrowserEnvironmentLaunchConfig {
        preset_id: Some(preset.id.clone()),
        preset_name: Some(preset.name.clone()),
        proxy_server: preset.proxy_server.clone(),
        timezone_id: preset.timezone_id.clone(),
        locale: preset.locale.clone(),
        accept_language: preset.accept_language.clone(),
        geolocation_lat: preset.geolocation_lat,
        geolocation_lng: preset.geolocation_lng,
        geolocation_accuracy_m: preset.geolocation_accuracy_m,
        user_agent: preset.user_agent.clone(),
        platform: preset.platform.clone(),
        viewport_width,
        viewport_height,
        device_scale_factor: preset.device_scale_factor,
    })
}

pub async fn apply_browser_environment_to_session(
    runtime: &BrowserRuntimeManager,
    session_id: &str,
    config: &BrowserEnvironmentLaunchConfig,
) -> Result<(), String> {
    if !config.has_runtime_overrides() {
        return Ok(());
    }

    if config.user_agent.is_some() || config.accept_language.is_some() || config.platform.is_some()
    {
        let effective_user_agent = match config.user_agent.as_deref() {
            Some(user_agent) => user_agent.to_string(),
            None => read_current_user_agent(runtime, session_id).await?,
        };
        runtime
            .send_command(
                session_id,
                "Emulation.setUserAgentOverride",
                json!({
                    "userAgent": effective_user_agent,
                    "acceptLanguage": config.accept_language,
                    "platform": config.platform,
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await?;
    }

    if let Some(timezone_id) = config.timezone_id.as_deref() {
        runtime
            .send_command(
                session_id,
                "Emulation.setTimezoneOverride",
                json!({
                    "timezoneId": timezone_id,
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await?;
    }

    if let Some(locale) = config.locale.as_deref() {
        let locale = normalize_locale_for_cdp(locale);
        if let Err(error) = runtime
            .send_command(
                session_id,
                "Emulation.setLocaleOverride",
                json!({
                    "locale": locale,
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await
        {
            if should_ignore_optional_emulation_error(&error) {
                tracing::warn!(
                    "[BrowserEnvironment] locale override not available: {}",
                    error
                );
            } else {
                return Err(error);
            }
        }
    }

    if let (Some(lat), Some(lng)) = (config.geolocation_lat, config.geolocation_lng) {
        runtime
            .send_command(
                session_id,
                "Emulation.setGeolocationOverride",
                json!({
                    "latitude": lat,
                    "longitude": lng,
                    "accuracy": config.geolocation_accuracy_m.unwrap_or(100.0),
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await?;
    }

    if let (Some(width), Some(height)) = (config.viewport_width, config.viewport_height) {
        runtime
            .send_command(
                session_id,
                "Emulation.setDeviceMetricsOverride",
                json!({
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": config.device_scale_factor.unwrap_or(1.0),
                    "mobile": false,
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await?;
    }

    Ok(())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_geolocation(
    lat: Option<f64>,
    lng: Option<f64>,
    accuracy_m: Option<f64>,
) -> Result<(Option<f64>, Option<f64>, Option<f64>), String> {
    match (lat, lng) {
        (Some(lat), Some(lng)) => {
            if !(-90.0..=90.0).contains(&lat) {
                return Err("地理位置纬度必须位于 -90 到 90 之间".to_string());
            }
            if !(-180.0..=180.0).contains(&lng) {
                return Err("地理位置经度必须位于 -180 到 180 之间".to_string());
            }
            let accuracy = accuracy_m.unwrap_or(100.0);
            if accuracy <= 0.0 {
                return Err("地理位置精度必须大于 0".to_string());
            }
            Ok((Some(lat), Some(lng), Some(accuracy)))
        }
        (None, None) => Ok((None, None, None)),
        _ => Err("地理位置纬度和经度必须同时填写".to_string()),
    }
}

fn normalize_viewport(
    width: Option<i64>,
    height: Option<i64>,
) -> Result<(Option<i64>, Option<i64>), String> {
    match (width, height) {
        (Some(width), Some(height)) => {
            if width <= 0 || height <= 0 {
                return Err("视口宽高必须大于 0".to_string());
            }
            Ok((Some(width), Some(height)))
        }
        (None, None) => Ok((None, None)),
        _ => Err("视口宽度和高度必须同时填写".to_string()),
    }
}

fn normalize_device_scale_factor(value: Option<f64>) -> Result<Option<f64>, String> {
    match value {
        Some(number) if number <= 0.0 => Err("设备像素比必须大于 0".to_string()),
        other => Ok(other),
    }
}

fn normalize_locale_for_cdp(locale: &str) -> String {
    locale.trim().replace('-', "_")
}

fn should_ignore_optional_emulation_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("method not found") || lower.contains("wasn't found")
}

async fn read_current_user_agent(
    runtime: &BrowserRuntimeManager,
    session_id: &str,
) -> Result<String, String> {
    let response = runtime
        .send_command(
            session_id,
            "Runtime.evaluate",
            json!({
                "expression": "navigator.userAgent",
                "returnByValue": true,
                "awaitPromise": false,
            }),
            DEFAULT_CDP_TIMEOUT_MS,
        )
        .await?;

    extract_runtime_value(response)
        .and_then(|value| value.as_str().map(ToString::to_string))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "读取当前浏览器 User-Agent 失败".to_string())
}

fn extract_runtime_value(response: Value) -> Option<Value> {
    let result = response.get("result")?;
    result
        .get("value")
        .cloned()
        .or_else(|| result.get("description").cloned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建数据表失败");
        conn
    }

    #[test]
    fn should_require_complete_geolocation_pair() {
        let error = normalize_geolocation(Some(31.2), None, None).unwrap_err();
        assert!(error.contains("必须同时填写"));
    }

    #[test]
    fn should_normalize_locale_for_cdp() {
        assert_eq!(normalize_locale_for_cdp("zh-CN"), "zh_CN");
        assert_eq!(normalize_locale_for_cdp("en_US"), "en_US");
    }

    #[test]
    fn should_derive_browser_launch_language() {
        let config = BrowserEnvironmentLaunchConfig {
            accept_language: Some("en-US,en;q=0.9".to_string()),
            ..Default::default()
        };
        assert_eq!(config.browser_launch_language().as_deref(), Some("en-US"));

        let locale_only = BrowserEnvironmentLaunchConfig {
            locale: Some("zh_CN".to_string()),
            ..Default::default()
        };
        assert_eq!(
            locale_only.browser_launch_language().as_deref(),
            Some("zh-CN")
        );
    }

    #[test]
    fn should_require_complete_viewport_pair() {
        let error = normalize_viewport(Some(1440), None).unwrap_err();
        assert!(error.contains("必须同时填写"));
    }

    #[test]
    fn should_seed_default_environment_preset_for_empty_table() {
        let conn = setup_db();

        let seeded = ensure_default_browser_environment_presets(&conn).unwrap();
        let presets = list_browser_environment_presets(&conn, false).unwrap();

        assert!(seeded);
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].id, DEFAULT_BROWSER_ENVIRONMENT_PRESET_ID);
        assert_eq!(presets[0].name, DEFAULT_BROWSER_ENVIRONMENT_PRESET_NAME);
        assert_eq!(
            presets[0].proxy_server.as_deref(),
            Some(DEFAULT_BROWSER_ENVIRONMENT_PRESET_PROXY_SERVER)
        );
    }

    #[test]
    fn should_not_seed_default_environment_preset_when_table_has_records() {
        let conn = setup_db();
        save_browser_environment_preset(
            &conn,
            SaveBrowserEnvironmentPresetInput {
                id: None,
                name: "日本桌面".to_string(),
                description: None,
                proxy_server: None,
                timezone_id: Some("Asia/Tokyo".to_string()),
                locale: Some("ja-JP".to_string()),
                accept_language: Some("ja-JP,ja;q=0.9".to_string()),
                geolocation_lat: None,
                geolocation_lng: None,
                geolocation_accuracy_m: None,
                user_agent: None,
                platform: Some("MacIntel".to_string()),
                viewport_width: Some(1440),
                viewport_height: Some(900),
                device_scale_factor: Some(2.0),
            },
        )
        .unwrap();

        let seeded = ensure_default_browser_environment_presets(&conn).unwrap();
        let presets = list_browser_environment_presets(&conn, false).unwrap();

        assert!(!seeded);
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "日本桌面");
    }
}
