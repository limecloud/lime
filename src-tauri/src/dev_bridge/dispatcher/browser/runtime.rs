use super::super::{get_db, require_app_handle};
use super::{parse_optional_request, parse_request, success_response, DynError};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "open_chrome_profile_window" => {
            let app_handle = require_app_handle(state)?;
            let request: crate::commands::webview_cmd::OpenChromeProfileRequest =
                parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::open_chrome_profile_window_global(
                    app_handle,
                    state.server.clone(),
                    request,
                )
                .await?,
            )?
        }
        "open_browser_runtime_debugger_window" => {
            let request: Option<
                crate::commands::browser_runtime_cmd::OpenBrowserRuntimeDebuggerWindowRequest,
            > = parse_optional_request(args)?;
            crate::commands::browser_runtime_cmd::open_browser_runtime_debugger_window(
                require_app_handle(state)?,
                request,
            )?;
            success_response()
        }
        "close_browser_runtime_debugger_window" => {
            crate::commands::browser_runtime_cmd::close_browser_runtime_debugger_window(
                require_app_handle(state)?,
            )?;
            success_response()
        }
        "launch_browser_session" => {
            let app_handle = require_app_handle(state)?;
            let request: crate::commands::browser_runtime_cmd::LaunchBrowserSessionRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(
                crate::commands::browser_runtime_cmd::launch_browser_session_with_db(
                    app_handle,
                    state.server.clone(),
                    db,
                    request,
                )
                .await?,
            )?
        }
        "list_browser_profiles_cmd" => {
            let request: Option<crate::commands::browser_profile_cmd::ListBrowserProfilesRequest> =
                parse_optional_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_profile_service::list_browser_profiles(
                    &conn,
                    request
                        .map(|payload| payload.include_archived)
                        .unwrap_or(false),
                )?,
            )?
        }
        "save_browser_profile_cmd" => {
            let request: crate::commands::browser_profile_cmd::SaveBrowserProfileRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_profile_service::save_browser_profile(
                    &conn,
                    crate::services::browser_profile_service::SaveBrowserProfileInput {
                        id: request.id,
                        profile_key: request.profile_key,
                        name: request.name,
                        description: request.description,
                        site_scope: request.site_scope,
                        launch_url: request.launch_url,
                        transport_kind: request.transport_kind,
                    },
                )?,
            )?
        }
        "archive_browser_profile_cmd" => {
            let request: crate::commands::browser_profile_cmd::BrowserProfileRecordRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_profile_service::archive_browser_profile(
                    &conn,
                    &request.id,
                )?,
            )?
        }
        "restore_browser_profile_cmd" => {
            let request: crate::commands::browser_profile_cmd::BrowserProfileRecordRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_profile_service::restore_browser_profile(
                    &conn,
                    &request.id,
                )?,
            )?
        }
        "list_browser_environment_presets_cmd" => {
            let request: Option<
                crate::commands::browser_environment_cmd::ListBrowserEnvironmentPresetsRequest,
            > = parse_optional_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_environment_service::list_browser_environment_presets(
                    &conn,
                    request
                        .map(|payload| payload.include_archived)
                        .unwrap_or(false),
                )?,
            )?
        }
        "save_browser_environment_preset_cmd" => {
            let request: crate::commands::browser_environment_cmd::SaveBrowserEnvironmentPresetRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_environment_service::save_browser_environment_preset(
                    &conn,
                    crate::services::browser_environment_service::SaveBrowserEnvironmentPresetInput {
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
                )?,
            )?
        }
        "archive_browser_environment_preset_cmd" => {
            let request: crate::commands::browser_environment_cmd::BrowserEnvironmentPresetRecordRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_environment_service::archive_browser_environment_preset(
                    &conn,
                    &request.id,
                )?,
            )?
        }
        "restore_browser_environment_preset_cmd" => {
            let request: crate::commands::browser_environment_cmd::BrowserEnvironmentPresetRecordRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            let conn = crate::database::lock_db(&db)?;
            serde_json::to_value(
                crate::services::browser_environment_service::restore_browser_environment_preset(
                    &conn,
                    &request.id,
                )?,
            )?
        }
        "launch_browser_runtime_assist" => {
            let app_handle = require_app_handle(state)?;
            let request: crate::commands::browser_runtime_cmd::LaunchBrowserRuntimeAssistRequest =
                parse_request(args)?;
            serde_json::to_value(
                crate::commands::browser_runtime_cmd::launch_browser_runtime_assist_global(
                    app_handle,
                    state.server.clone(),
                    request,
                )
                .await?,
            )?
        }
        "start_browser_stream" => {
            let app_handle = require_app_handle(state)?;
            let request: crate::commands::webview_cmd::StartBrowserStreamRequest =
                parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::start_browser_stream_global(app_handle, request)
                    .await?,
            )?
        }
        "stop_browser_stream" => {
            let request: crate::commands::webview_cmd::StopBrowserStreamRequest =
                parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::stop_browser_stream_global(request).await?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
