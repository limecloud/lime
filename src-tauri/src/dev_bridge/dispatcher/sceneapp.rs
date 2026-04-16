use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    _state: &DevBridgeState,
    cmd: &str,
    _args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if cmd != "sceneapp_list_catalog" {
        return Ok(None);
    }

    let result =
        serde_json::to_value(crate::commands::sceneapp_cmd::sceneapp_list_catalog().await?)?;

    Ok(Some(result))
}
