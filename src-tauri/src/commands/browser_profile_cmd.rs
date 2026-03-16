use crate::app::AppState;
use crate::commands::browser_runtime_cmd::{
    launch_browser_session_with_db, BrowserRuntimeAssistLaunchResponse, LaunchBrowserSessionRequest,
};
use crate::database::{lock_db, DbConnection};
use crate::services::browser_profile_service::{
    archive_browser_profile, list_browser_profiles, restore_browser_profile, save_browser_profile,
    SaveBrowserProfileInput,
};
use proxycast_browser_runtime::BrowserStreamMode;
use proxycast_core::database::dao::browser_profile::{
    BrowserProfileRecord, BrowserProfileTransportKind,
};
use serde::Deserialize;
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize)]
pub struct ListBrowserProfilesRequest {
    #[serde(default)]
    pub include_archived: bool,
}

#[derive(Debug, Deserialize)]
pub struct SaveBrowserProfileRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub profile_key: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub site_scope: Option<String>,
    #[serde(default)]
    pub launch_url: Option<String>,
    #[serde(default)]
    pub transport_kind: BrowserProfileTransportKind,
}

#[derive(Debug, Deserialize)]
pub struct BrowserProfileRecordRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct LaunchBrowserProfileRuntimeAssistRequest {
    pub id: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub environment_preset_id: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub open_window: Option<bool>,
    #[serde(default)]
    pub stream_mode: Option<BrowserStreamMode>,
}

#[tauri::command]
pub fn list_browser_profiles_cmd(
    db: State<'_, DbConnection>,
    request: Option<ListBrowserProfilesRequest>,
) -> Result<Vec<BrowserProfileRecord>, String> {
    let request = request.unwrap_or(ListBrowserProfilesRequest {
        include_archived: false,
    });
    let conn = lock_db(&db)?;
    list_browser_profiles(&conn, request.include_archived)
}

#[tauri::command]
pub fn save_browser_profile_cmd(
    db: State<'_, DbConnection>,
    request: SaveBrowserProfileRequest,
) -> Result<BrowserProfileRecord, String> {
    let conn = lock_db(&db)?;
    save_browser_profile(
        &conn,
        SaveBrowserProfileInput {
            id: request.id,
            profile_key: request.profile_key,
            name: request.name,
            description: request.description,
            site_scope: request.site_scope,
            launch_url: request.launch_url,
            transport_kind: request.transport_kind,
        },
    )
}

#[tauri::command]
pub fn archive_browser_profile_cmd(
    db: State<'_, DbConnection>,
    request: BrowserProfileRecordRequest,
) -> Result<bool, String> {
    let conn = lock_db(&db)?;
    archive_browser_profile(&conn, &request.id)
}

#[tauri::command]
pub fn restore_browser_profile_cmd(
    db: State<'_, DbConnection>,
    request: BrowserProfileRecordRequest,
) -> Result<bool, String> {
    let conn = lock_db(&db)?;
    restore_browser_profile(&conn, &request.id)
}

#[tauri::command]
pub async fn launch_browser_profile_runtime_assist_cmd(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    db: State<'_, DbConnection>,
    request: LaunchBrowserProfileRuntimeAssistRequest,
) -> Result<BrowserRuntimeAssistLaunchResponse, String> {
    launch_browser_session_with_db(
        app_handle,
        app_state.inner().clone(),
        db.inner().clone(),
        LaunchBrowserSessionRequest {
            profile_id: Some(request.id),
            profile_key: None,
            url: request.url,
            environment_preset_id: request.environment_preset_id,
            environment: None,
            target_id: request.target_id,
            open_window: request.open_window.unwrap_or(false),
            stream_mode: request.stream_mode.unwrap_or(BrowserStreamMode::Both),
        },
    )
    .await
}
