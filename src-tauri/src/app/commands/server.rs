//! 服务器诊断命令
//!
//! 保留仅供开发者与运行时诊断使用的只读查询。

use crate::app::types::AppState;
use crate::commands::telemetry_cmd::TelemetryState;
use lime_server as server;

/// 获取服务器诊断信息（对标 /stats 与 /cache 端点）
#[tauri::command]
pub async fn get_server_diagnostics(
    state: tauri::State<'_, AppState>,
    telemetry_state: tauri::State<'_, TelemetryState>,
) -> Result<server::ServerDiagnostics, String> {
    let s = state.read().await;
    let status = s.status();
    let telemetry_summary = telemetry_state.stats.read().summary(None);

    Ok(server::build_server_diagnostics(
        status.running,
        status.host,
        status.port,
        telemetry_summary,
        status.capability_routing,
        s.response_cache_store.as_ref(),
        s.request_dedup_store.as_ref(),
        s.idempotency_store.as_ref(),
    ))
}
