use super::super::{args_or_default, get_string_arg, parse_nested_arg};
use super::DynError;
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_chrome_profile_sessions" => serde_json::to_value(
            crate::commands::webview_cmd::get_chrome_profile_sessions_global().await?,
        )?,
        "close_chrome_profile_session" => {
            let args = args_or_default(args);
            let profile_key = get_string_arg(&args, "profileKey", "profile_key")?;
            serde_json::to_value(
                crate::commands::webview_cmd::close_chrome_profile_session_global(profile_key)
                    .await?,
            )?
        }
        "cleanup_gui_smoke_chrome_profiles" => serde_json::to_value(
            crate::commands::webview_cmd::cleanup_gui_smoke_chrome_profiles_global().await?,
        )?,
        "get_chrome_bridge_endpoint_info" => serde_json::to_value(
            crate::commands::webview_cmd::get_chrome_bridge_endpoint_info_global(
                state.server.clone(),
            )
            .await?,
        )?,
        "get_chrome_bridge_status" => serde_json::to_value(
            crate::commands::webview_cmd::get_chrome_bridge_status_global().await?,
        )?,
        "disconnect_browser_connector_session" => {
            let args = args_or_default(args);
            let profile_key = args
                .get("profileKey")
                .or_else(|| args.get("profile_key"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            serde_json::to_value(
                crate::commands::webview_cmd::disconnect_browser_connector_session(profile_key)
                    .await?,
            )?
        }
        "get_browser_backend_policy" => serde_json::to_value(
            crate::commands::webview_cmd::get_browser_backend_policy_global().await?,
        )?,
        "set_browser_backend_policy" => {
            let policy: crate::commands::webview_cmd::BrowserBackendPolicy =
                parse_nested_arg(&args_or_default(args), "policy")?;
            serde_json::to_value(
                crate::commands::webview_cmd::set_browser_backend_policy_global(policy).await?,
            )?
        }
        "get_browser_backends_status" => serde_json::to_value(
            crate::commands::webview_cmd::get_browser_backends_status_global().await?,
        )?,
        _ => return Ok(None),
    };

    Ok(Some(result))
}
