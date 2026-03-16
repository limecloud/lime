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
