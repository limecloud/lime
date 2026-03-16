use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

mod operations;
mod queries;

type DynError = Box<dyn std::error::Error>;
type OpenClawServiceHandle = Arc<Mutex<crate::services::openclaw_service::OpenClawService>>;

fn openclaw_service_handle(app_handle: &AppHandle) -> OpenClawServiceHandle {
    app_handle
        .state::<crate::services::openclaw_service::OpenClawServiceState>()
        .0
        .clone()
}

fn openclaw_context(
    state: &DevBridgeState,
) -> Result<(AppHandle, OpenClawServiceHandle), DynError> {
    let app_handle = super::require_app_handle(state)?;
    let service = openclaw_service_handle(&app_handle);
    Ok((app_handle, service))
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if let Some(result) = queries::try_handle(state, cmd).await? {
        return Ok(Some(result));
    }

    operations::try_handle(state, cmd, args).await
}
