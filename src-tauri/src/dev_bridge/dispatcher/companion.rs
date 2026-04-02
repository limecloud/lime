use super::{args_or_default, parse_nested_arg, parse_optional_nested_arg, require_app_handle};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let app_handle = match cmd {
        "companion_get_pet_status" | "companion_launch_pet" | "companion_send_pet_command" => {
            require_app_handle(state)?
        }
        _ => return Ok(None),
    };

    let companion_state =
        app_handle.state::<crate::services::companion_service::CompanionServiceState>();
    let result = match cmd {
        "companion_get_pet_status" => serde_json::to_value(
            crate::services::companion_service::get_pet_status_global(&companion_state).await?,
        )?,
        "companion_launch_pet" => {
            let request = parse_optional_nested_arg::<
                crate::services::companion_service::CompanionLaunchPetRequest,
            >(&args_or_default(args), "request")?
            .unwrap_or_default();
            serde_json::to_value(
                crate::services::companion_service::launch_pet_global(&companion_state, request)
                    .await?,
            )?
        }
        "companion_send_pet_command" => {
            let request: crate::services::companion_service::CompanionPetCommandRequest =
                parse_nested_arg(&args_or_default(args), "request")?;
            serde_json::to_value(
                crate::services::companion_service::send_pet_command_global(
                    &companion_state,
                    request,
                )
                .await?,
            )?
        }
        _ => unreachable!("已通过前置判断过滤 companion 命令"),
    };

    Ok(Some(result))
}
