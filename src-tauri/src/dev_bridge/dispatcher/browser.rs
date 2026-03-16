use super::{args_or_default, parse_nested_arg, parse_optional_nested_arg};
use crate::dev_bridge::DevBridgeState;
use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;

mod bridge;
mod cdp;
mod runtime;
mod sessions;

type DynError = Box<dyn std::error::Error>;

fn parse_request<T: DeserializeOwned>(args: Option<&JsonValue>) -> Result<T, DynError> {
    parse_nested_arg(&args_or_default(args), "request")
}

fn parse_optional_request<T: DeserializeOwned>(
    args: Option<&JsonValue>,
) -> Result<Option<T>, DynError> {
    parse_optional_nested_arg(&args_or_default(args), "request")
}

fn success_response() -> JsonValue {
    serde_json::json!({ "success": true })
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if let Some(result) = runtime::try_handle(state, cmd, args).await? {
        return Ok(Some(result));
    }

    if let Some(result) = bridge::try_handle(state, cmd, args).await? {
        return Ok(Some(result));
    }

    if let Some(result) = cdp::try_handle(state, cmd, args).await? {
        return Ok(Some(result));
    }

    sessions::try_handle(state, cmd, args).await
}
