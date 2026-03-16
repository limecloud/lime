use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::database::DbConnection;
use crate::services::openclaw_service::{
    openclaw_install_event_name, ActionResult, BinaryAvailabilityStatus, BinaryInstallStatus,
    ChannelInfo, CommandPreview, EnvironmentStatus, GatewayStatusInfo, HealthInfo,
    InstallProgressEvent, NodeCheckResult, OpenClawServiceState, SyncModelEntry, UpdateInfo,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSyncConfigRequest {
    pub provider_id: String,
    pub primary_model_id: String,
    #[serde(default)]
    pub models: Vec<SyncModelEntry>,
}

#[tauri::command]
pub async fn openclaw_check_installed(
    service: State<'_, OpenClawServiceState>,
) -> Result<BinaryInstallStatus, String> {
    let service = service.0.lock().await;
    service.check_installed().await
}

#[tauri::command]
pub async fn openclaw_get_environment_status(
    service: State<'_, OpenClawServiceState>,
) -> Result<EnvironmentStatus, String> {
    let service = service.0.lock().await;
    service.get_environment_status().await
}

#[tauri::command]
pub async fn openclaw_check_node_version(
    service: State<'_, OpenClawServiceState>,
) -> Result<NodeCheckResult, String> {
    let service = service.0.lock().await;
    service.check_node_version().await
}

#[tauri::command]
pub async fn openclaw_check_git_available(
    service: State<'_, OpenClawServiceState>,
) -> Result<BinaryAvailabilityStatus, String> {
    let service = service.0.lock().await;
    service.check_git_available().await
}

#[tauri::command]
pub async fn openclaw_get_node_download_url(
    service: State<'_, OpenClawServiceState>,
) -> Result<String, String> {
    let service = service.0.lock().await;
    Ok(service.get_node_download_url())
}

#[tauri::command]
pub async fn openclaw_get_git_download_url(
    service: State<'_, OpenClawServiceState>,
) -> Result<String, String> {
    let service = service.0.lock().await;
    Ok(service.get_git_download_url())
}

#[tauri::command]
pub async fn openclaw_get_command_preview(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
    operation: String,
    port: Option<u16>,
) -> Result<CommandPreview, String> {
    let mut service = service.0.lock().await;
    service.get_command_preview(&app, &operation, port).await
}

#[tauri::command]
pub async fn openclaw_install(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.install(&app).await
}

#[tauri::command]
pub async fn openclaw_install_dependency(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
    kind: String,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.install_dependency(&app, &kind).await
}

#[tauri::command]
pub async fn openclaw_cleanup_temp_artifacts(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.cleanup_temp_artifacts(Some(&app)).await
}

#[tauri::command]
pub async fn openclaw_check_update(
    service: State<'_, OpenClawServiceState>,
) -> Result<UpdateInfo, String> {
    let service = service.0.lock().await;
    service.check_update().await
}

#[tauri::command]
pub async fn openclaw_uninstall(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.uninstall(&app).await
}

#[tauri::command]
pub async fn openclaw_perform_update(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.perform_update(&app).await
}

#[tauri::command]
pub async fn openclaw_start_gateway(
    app: AppHandle,
    port: Option<u16>,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.start_gateway(Some(&app), port).await
}

#[tauri::command]
pub async fn openclaw_stop_gateway(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.stop_gateway(Some(&app)).await
}

#[tauri::command]
pub async fn openclaw_restart_gateway(
    app: AppHandle,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let mut service = service.0.lock().await;
    service.clear_progress_logs();
    service.restart_gateway(&app).await
}

#[tauri::command]
pub async fn openclaw_get_progress_logs(
    service: State<'_, OpenClawServiceState>,
) -> Result<Vec<InstallProgressEvent>, String> {
    let service = service.0.lock().await;
    Ok(service.get_progress_logs())
}

#[tauri::command]
pub async fn openclaw_get_status(
    service: State<'_, OpenClawServiceState>,
) -> Result<GatewayStatusInfo, String> {
    let mut service = service.0.lock().await;
    service.get_status().await
}

#[tauri::command]
pub async fn openclaw_check_health(
    service: State<'_, OpenClawServiceState>,
) -> Result<HealthInfo, String> {
    let mut service = service.0.lock().await;
    service.check_health().await
}

#[tauri::command]
pub async fn openclaw_get_dashboard_url(
    service: State<'_, OpenClawServiceState>,
) -> Result<String, String> {
    let mut service = service.0.lock().await;
    Ok(service.get_dashboard_url())
}

#[tauri::command]
pub async fn openclaw_get_channels(
    service: State<'_, OpenClawServiceState>,
) -> Result<Vec<ChannelInfo>, String> {
    let mut service = service.0.lock().await;
    service.get_channels().await
}

#[tauri::command]
pub async fn openclaw_sync_provider_config(
    request: OpenClawSyncConfigRequest,
    db: State<'_, DbConnection>,
    api_key_service: State<'_, ApiKeyProviderServiceState>,
    service: State<'_, OpenClawServiceState>,
) -> Result<ActionResult, String> {
    let provider = api_key_service
        .0
        .get_provider(&db, &request.provider_id)?
        .ok_or_else(|| "未找到指定 Provider。".to_string())?;

    if !provider.provider.enabled {
        return Ok(ActionResult {
            success: false,
            message: "该 Provider 已被禁用。".to_string(),
        });
    }

    let api_key = api_key_service
        .0
        .get_next_api_key(&db, &request.provider_id)?
        .unwrap_or_default();

    let mut service = service.0.lock().await;
    service.sync_provider_config(
        &provider.provider,
        &api_key,
        &request.primary_model_id,
        &request.models,
    )
}

#[tauri::command]
pub fn openclaw_install_event() -> String {
    openclaw_install_event_name().to_string()
}
