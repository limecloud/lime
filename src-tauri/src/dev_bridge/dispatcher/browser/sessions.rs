use super::super::get_db;
use super::{parse_request, DynError};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "get_browser_session_state" => {
            let request: crate::commands::webview_cmd::BrowserSessionStateRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(
                crate::commands::webview_cmd::get_browser_session_state_global(db, request).await?,
            )?
        }
        "take_over_browser_session" => {
            let request: crate::commands::webview_cmd::UpdateBrowserSessionControlRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(
                crate::commands::webview_cmd::take_over_browser_session_global(db, request).await?,
            )?
        }
        "release_browser_session" => {
            let request: crate::commands::webview_cmd::UpdateBrowserSessionControlRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(
                crate::commands::webview_cmd::release_browser_session_global(db, request).await?,
            )?
        }
        "resume_browser_session" => {
            let request: crate::commands::webview_cmd::UpdateBrowserSessionControlRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(
                crate::commands::webview_cmd::resume_browser_session_global(db, request).await?,
            )?
        }
        "get_browser_event_buffer" => {
            let request: crate::commands::webview_cmd::BrowserEventBufferRequest =
                parse_request(args)?;
            serde_json::to_value(
                crate::commands::webview_cmd::get_browser_event_buffer_global(request).await?,
            )?
        }
        "browser_execute_action" => {
            let request: crate::commands::webview_cmd::BrowserActionRequest = parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(
                crate::commands::webview_cmd::browser_execute_action_global(db, request).await?,
            )?
        }
        "get_browser_action_audit_logs" => {
            let limit = args
                .and_then(|value| value.get("limit"))
                .and_then(|value| value.as_u64())
                .map(|value| value as usize);
            serde_json::to_value(
                crate::commands::webview_cmd::get_browser_action_audit_logs_global(limit).await?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
