use super::{args_or_default, parse_nested_arg, require_app_handle};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "gateway_channel_status" => {
            let app_handle = require_app_handle(state)?;
            let args = args_or_default(args);
            let request: crate::commands::gateway_channel_cmd::GatewayChannelStatusRequest =
                parse_nested_arg(&args, "request")?;

            let telegram_state = app_handle.state::<lime_gateway::telegram::TelegramGatewayState>();
            let feishu_state = app_handle.state::<lime_gateway::feishu::FeishuGatewayState>();
            let discord_state = app_handle.state::<lime_gateway::discord::DiscordGatewayState>();
            let wechat_state = app_handle.state::<lime_gateway::wechat::WechatGatewayState>();

            serde_json::to_value(
                crate::commands::gateway_channel_cmd::gateway_channel_status(
                    telegram_state,
                    feishu_state,
                    discord_state,
                    wechat_state,
                    request,
                )
                .await?,
            )?
        }
        "wechat_channel_list_accounts" => {
            let app_handle = require_app_handle(state)?;
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            serde_json::to_value(
                crate::commands::wechat_channel_cmd::list_wechat_configured_accounts(
                    config_manager.inner(),
                ),
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
