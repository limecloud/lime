use crate::database::{lock_db, DbConnection};
use crate::services::browser_environment_service::{
    archive_browser_environment_preset, get_browser_environment_preset,
    list_browser_environment_presets, restore_browser_environment_preset,
    save_browser_environment_preset, SaveBrowserEnvironmentPresetInput,
};
use proxycast_core::database::dao::browser_environment_preset::BrowserEnvironmentPresetRecord;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct ListBrowserEnvironmentPresetsRequest {
    #[serde(default)]
    pub include_archived: bool,
}

#[derive(Debug, Deserialize)]
pub struct SaveBrowserEnvironmentPresetRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
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
    pub viewport_width: Option<i64>,
    #[serde(default)]
    pub viewport_height: Option<i64>,
    #[serde(default)]
    pub device_scale_factor: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct BrowserEnvironmentPresetRecordRequest {
    pub id: String,
}

#[tauri::command]
pub fn list_browser_environment_presets_cmd(
    db: State<'_, DbConnection>,
    request: Option<ListBrowserEnvironmentPresetsRequest>,
) -> Result<Vec<BrowserEnvironmentPresetRecord>, String> {
    let request = request.unwrap_or(ListBrowserEnvironmentPresetsRequest {
        include_archived: false,
    });
    let conn = lock_db(&db)?;
    list_browser_environment_presets(&conn, request.include_archived)
}

#[tauri::command]
pub fn save_browser_environment_preset_cmd(
    db: State<'_, DbConnection>,
    request: SaveBrowserEnvironmentPresetRequest,
) -> Result<BrowserEnvironmentPresetRecord, String> {
    let conn = lock_db(&db)?;
    save_browser_environment_preset(
        &conn,
        SaveBrowserEnvironmentPresetInput {
            id: request.id,
            name: request.name,
            description: request.description,
            proxy_server: request.proxy_server,
            timezone_id: request.timezone_id,
            locale: request.locale,
            accept_language: request.accept_language,
            geolocation_lat: request.geolocation_lat,
            geolocation_lng: request.geolocation_lng,
            geolocation_accuracy_m: request.geolocation_accuracy_m,
            user_agent: request.user_agent,
            platform: request.platform,
            viewport_width: request.viewport_width,
            viewport_height: request.viewport_height,
            device_scale_factor: request.device_scale_factor,
        },
    )
}

#[tauri::command]
pub fn archive_browser_environment_preset_cmd(
    db: State<'_, DbConnection>,
    request: BrowserEnvironmentPresetRecordRequest,
) -> Result<bool, String> {
    let conn = lock_db(&db)?;
    archive_browser_environment_preset(&conn, &request.id)
}

#[tauri::command]
pub fn restore_browser_environment_preset_cmd(
    db: State<'_, DbConnection>,
    request: BrowserEnvironmentPresetRecordRequest,
) -> Result<bool, String> {
    let conn = lock_db(&db)?;
    restore_browser_environment_preset(&conn, &request.id)
}

#[allow(dead_code)]
pub fn get_browser_environment_preset_cmd(
    db: State<'_, DbConnection>,
    request: BrowserEnvironmentPresetRecordRequest,
) -> Result<Option<BrowserEnvironmentPresetRecord>, String> {
    let conn = lock_db(&db)?;
    get_browser_environment_preset(&conn, &request.id)
}
