use super::{parse_request, DynError};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    _state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "list_cdp_targets" => {
            let request: crate::commands::webview_cmd::ListCdpTargetsRequest = parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::list_cdp_targets_global(request).await?,
            )?
        }
        "open_cdp_session" => {
            let request: crate::commands::webview_cmd::OpenCdpSessionRequest = parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::open_cdp_session_global(request).await?,
            )?
        }
        "close_cdp_session" => {
            let request: crate::commands::webview_cmd::BrowserSessionStateRequest =
                parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::close_cdp_session_global(request).await?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
