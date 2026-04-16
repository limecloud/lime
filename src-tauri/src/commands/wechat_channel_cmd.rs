use crate::agent::AsterAgentState;
use crate::app::LogState;
use crate::config::{GlobalConfigManagerState, WechatAccountConfig};
use crate::database::DbConnection;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use lime_gateway::wechat::{
    purge_account_data, start_gateway, start_login, stop_gateway, wait_login, WechatGatewayState,
    WechatLoginStartResult, WechatLoginState, WechatLoginWaitResult, DEFAULT_CDN_BASE_URL,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
pub struct WechatLoginStartRequest {
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub bot_type: Option<String>,
    #[serde(default)]
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatLoginWaitRequest {
    pub session_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub bot_type: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub account_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatConfiguredAccount {
    pub account_id: String,
    pub enabled: bool,
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub cdn_base_url: Option<String>,
    pub has_token: bool,
    pub scanner_user_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatRemoveAccountRequest {
    pub account_id: String,
    #[serde(default)]
    pub purge_data: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WechatRuntimeModelRequest {
    pub provider_id: String,
    pub model_id: String,
}

pub async fn persist_wechat_runtime_model(
    config_manager: &GlobalConfigManagerState,
    logs: &LogState,
    request: &WechatRuntimeModelRequest,
) -> Result<String, String> {
    let provider_id = request.provider_id.trim();
    if provider_id.is_empty() {
        return Err("provider_id 不能为空".to_string());
    }
    let model_id = request.model_id.trim();
    if model_id.is_empty() {
        return Err("model_id 不能为空".to_string());
    }

    let runtime_model = format!("{provider_id}/{model_id}");
    let mut config = config_manager.config();
    config.channels.wechat.default_model = Some(runtime_model.clone());

    let mut bound_account_id = config
        .channels
        .wechat
        .default_account
        .clone()
        .filter(|value| config.channels.wechat.accounts.contains_key(value));

    if bound_account_id.is_none() && config.channels.wechat.accounts.len() == 1 {
        bound_account_id = config.channels.wechat.accounts.keys().next().cloned();
    }

    if let Some(account_id) = bound_account_id.as_deref() {
        if let Some(account) = config.channels.wechat.accounts.get_mut(account_id) {
            account.default_model = Some(runtime_model.clone());
        }
    }

    config_manager.save_config(&config).await?;
    logs.write().await.add(
        "info",
        &format!(
            "[WechatGateway] runtime_model synced provider={} model={} stored={} bound_account={}",
            provider_id,
            model_id,
            runtime_model,
            bound_account_id.as_deref().unwrap_or("<root>")
        ),
    );

    Ok(runtime_model)
}

#[tauri::command]
pub async fn wechat_channel_login_start(
    login_state: State<'_, WechatLoginState>,
    logs: State<'_, LogState>,
    request: WechatLoginStartRequest,
) -> Result<WechatLoginStartResult, String> {
    logs.write().await.add(
        "info",
        &format!(
            "[WechatGateway] login_start base_url={} bot_type={}",
            request
                .base_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("<default>"),
            request
                .bot_type
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("<default>")
        ),
    );
    let client = reqwest::Client::new();
    let result = start_login(
        &login_state,
        &client,
        request.base_url.as_deref(),
        request.bot_type.as_deref(),
        request.session_key.as_deref(),
    )
    .await?;
    logs.write().await.add(
        "info",
        &format!(
            "[WechatGateway] login_start success session_key={} has_qrcode={}",
            result.session_key,
            !result.qrcode_url.trim().is_empty()
        ),
    );
    Ok(result)
}

#[tauri::command]
pub async fn wechat_channel_login_wait(
    login_state: State<'_, WechatLoginState>,
    gateway_state: State<'_, WechatGatewayState>,
    aster_state: State<'_, AsterAgentState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    db: State<'_, DbConnection>,
    logs: State<'_, LogState>,
    request: WechatLoginWaitRequest,
) -> Result<WechatLoginWaitResult, String> {
    logs.write().await.add(
        "info",
        &format!(
            "[WechatGateway] login_wait session_key={} timeout_ms={}",
            request.session_key,
            request.timeout_ms.unwrap_or(480_000)
        ),
    );
    let client = reqwest::Client::new();
    let result = wait_login(
        &login_state,
        &client,
        &request.session_key,
        request.base_url.as_deref(),
        request.bot_type.as_deref(),
        request.timeout_ms,
    )
    .await?;

    if result.connected {
        let account_id = result
            .account_id
            .clone()
            .ok_or_else(|| "登录成功但缺少 account_id".to_string())?;
        let bot_token = result
            .bot_token
            .clone()
            .ok_or_else(|| "登录成功但缺少 bot_token".to_string())?;
        let mut config = config_manager.config();
        let accounts = &mut config.channels.wechat.accounts;
        let account = accounts
            .entry(account_id.clone())
            .or_insert_with(WechatAccountConfig::default);
        account.enabled = true;
        account.name = request
            .account_name
            .clone()
            .filter(|value| !value.trim().is_empty());
        account.base_url = result.base_url.clone();
        account.cdn_base_url = Some(DEFAULT_CDN_BASE_URL.to_string());
        account.bot_token = Some(bot_token);
        account.scanner_user_id = result.user_id.clone();
        let default_account = config
            .channels
            .wechat
            .default_account
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if default_account.is_none()
            || default_account == Some("default")
            || !accounts.contains_key(default_account.unwrap_or_default())
        {
            config.channels.wechat.default_account = Some(account_id.clone());
        }
        if config.channels.wechat.base_url.trim().is_empty() {
            config.channels.wechat.base_url = result
                .base_url
                .clone()
                .unwrap_or_else(|| request.base_url.clone().unwrap_or_default());
        }
        if config.channels.wechat.cdn_base_url.trim().is_empty() {
            config.channels.wechat.cdn_base_url = DEFAULT_CDN_BASE_URL.to_string();
        }
        if config.channels.wechat.scanner_user_id.is_none() {
            config.channels.wechat.scanner_user_id = result.user_id.clone();
        }
        config.channels.wechat.enabled = true;
        config_manager.save_config(&config).await?;
        logs.write().await.add(
            "info",
            &format!(
                "[WechatGateway] login_wait success account={} scanner_user_id={}",
                account_id,
                result.user_id.as_deref().unwrap_or("<none>")
            ),
        );
        logs.write().await.add(
            "info",
            &format!(
                "[WechatGateway] login_wait auto_start begin account={} configured_accounts={} default_account={}",
                account_id,
                config.channels.wechat.accounts.len(),
                config
                    .channels
                    .wechat
                    .default_account
                    .as_deref()
                    .unwrap_or("<none>")
            ),
        );
        apply_web_search_runtime_env(&config);
        match start_gateway(
            &gateway_state,
            db.inner().clone(),
            aster_state.inner().clone(),
            logs.inner().clone(),
            config,
            Some(account_id.clone()),
            None,
        )
        .await
        {
            Ok(status) => {
                logs.write().await.add(
                    "info",
                    &format!(
                        "[WechatGateway] login_wait auto_start success account={} running_accounts={}",
                        account_id, status.running_accounts
                    ),
                );
            }
            Err(error) => {
                logs.write().await.add(
                    "warn",
                    &format!(
                        "[WechatGateway] login_wait auto_start failed account={} error={}",
                        account_id, error
                    ),
                );
                return Err(format!("微信登录成功，但自动启动网关失败: {error}"));
            }
        }
    } else {
        logs.write().await.add(
            "warn",
            &format!(
                "[WechatGateway] login_wait incomplete session_key={} message={}",
                request.session_key, result.message
            ),
        );
    }

    Ok(result)
}

#[tauri::command]
pub async fn wechat_channel_set_runtime_model(
    config_manager: State<'_, GlobalConfigManagerState>,
    logs: State<'_, LogState>,
    request: WechatRuntimeModelRequest,
) -> Result<String, String> {
    persist_wechat_runtime_model(config_manager.inner(), logs.inner(), &request).await
}

pub fn list_wechat_configured_accounts(
    config_manager: &GlobalConfigManagerState,
) -> Vec<WechatConfiguredAccount> {
    let config = config_manager.config();
    let mut accounts = config
        .channels
        .wechat
        .accounts
        .into_iter()
        .map(|(account_id, account)| WechatConfiguredAccount {
            account_id,
            enabled: account.enabled,
            name: account.name,
            base_url: account.base_url,
            cdn_base_url: account.cdn_base_url,
            has_token: account
                .bot_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some(),
            scanner_user_id: account.scanner_user_id,
        })
        .collect::<Vec<_>>();
    accounts.sort_by(|left, right| left.account_id.cmp(&right.account_id));
    accounts
}

#[tauri::command]
pub async fn wechat_channel_list_accounts(
    config_manager: State<'_, GlobalConfigManagerState>,
) -> Result<Vec<WechatConfiguredAccount>, String> {
    Ok(list_wechat_configured_accounts(config_manager.inner()))
}

#[tauri::command]
pub async fn wechat_channel_remove_account(
    gateway_state: State<'_, WechatGatewayState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    request: WechatRemoveAccountRequest,
) -> Result<(), String> {
    let account_id = request.account_id.trim();
    if account_id.is_empty() {
        return Err("account_id 不能为空".to_string());
    }

    let _ = stop_gateway(&gateway_state, Some(account_id.to_string())).await;

    let mut config = config_manager.config();
    config.channels.wechat.accounts.remove(account_id);
    if config.channels.wechat.default_account.as_deref() == Some(account_id) {
        config.channels.wechat.default_account = None;
    }
    config_manager.save_config(&config).await?;

    if request.purge_data {
        purge_account_data(account_id)?;
    }

    Ok(())
}
