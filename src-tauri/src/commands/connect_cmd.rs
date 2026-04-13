//! Lime Connect 命令模块
//!
//! 提供 Deep Link 协议处理和中转商 API Key 管理的 Tauri 命令。
//!
//! ## 功能
//!
//! - Deep Link 协议处理和事件发送
//! - 中转商注册表查询和刷新
//! - API Key 集成到 API Key Provider 系统
//! - 统计回调（Webhook）
//!
//! ## Tauri 命令
//!
//! - `get_relay_info` - 查询中转商信息
//! - `save_relay_api_key` - 保存 API Key（添加到 API Key Provider 系统）
//! - `refresh_relay_registry` - 刷新注册表
//! - `handle_deep_link` - 处理 Deep Link URL
//! - `send_connect_callback` - 发送统计回调
//!
//! _Requirements: 1.4, 2.3, 4.1, 5.3_

use crate::connect::{
    parse_deep_link, send_cancelled_callback, send_error_callback, send_success_callback,
    ConnectPayload, DeepLinkError, RelayInfo, RelayRegistry,
};
use crate::database::dao::api_key_provider::ApiProviderType;
use crate::database::DbConnection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;

use super::api_key_provider_cmd::ApiKeyProviderServiceState;

/// Connect 模块状态
///
/// 管理 RelayRegistry 的共享状态
pub struct ConnectState {
    /// 中转商注册表
    pub registry: Arc<RelayRegistry>,
}

/// Connect 状态包装器（用于 Tauri 状态管理）
pub struct ConnectStateWrapper(pub Arc<RwLock<Option<ConnectState>>>);

/// Deep Link 处理结果
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeepLinkResult {
    /// 解析后的 payload
    pub payload: ConnectPayload,
    /// 中转商信息（如果在注册表中找到）
    pub relay_info: Option<RelayInfo>,
    /// 是否为已验证的中转商
    pub is_verified: bool,
}

/// 命令错误类型
#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectError {
    pub code: String,
    pub message: String,
}

impl From<DeepLinkError> for ConnectError {
    fn from(err: DeepLinkError) -> Self {
        let (code, message) = match &err {
            DeepLinkError::InvalidUrl(msg) => ("INVALID_URL".to_string(), msg.clone()),
            DeepLinkError::MissingRelay => (
                "MISSING_RELAY".to_string(),
                "缺少必填参数: relay".to_string(),
            ),
            DeepLinkError::MissingKey => {
                ("MISSING_KEY".to_string(), "缺少必填参数: key".to_string())
            }
        };
        ConnectError { code, message }
    }
}

impl From<crate::connect::RegistryError> for ConnectError {
    fn from(err: crate::connect::RegistryError) -> Self {
        ConnectError {
            code: "REGISTRY_ERROR".to_string(),
            message: err.to_string(),
        }
    }
}

/// 初始化 Connect 状态
///
/// 在应用启动时调用，初始化 RelayRegistry
pub async fn init_connect_state(app_data_dir: PathBuf) -> Result<ConnectState, ConnectError> {
    // 初始化 Registry
    let cache_path = app_data_dir.join("connect").join("registry.json");
    let registry = Arc::new(RelayRegistry::new(cache_path));

    // 尝试从缓存加载，如果失败则从远程加载
    if registry.load_from_cache().is_err() {
        tracing::info!("[Connect] 缓存不存在，尝试从远程加载注册表");
        if let Err(e) = registry.load_from_remote().await {
            tracing::warn!("[Connect] 从远程加载注册表失败: {}", e);
            // 不返回错误，允许应用继续运行
        }
    }

    Ok(ConnectState { registry })
}

/// 处理 Deep Link URL
///
/// 解析 Deep Link URL，查询中转商信息，并发送事件到前端
///
/// _Requirements: 1.4_
#[tauri::command]
pub async fn handle_deep_link(
    app: AppHandle,
    state: State<'_, ConnectStateWrapper>,
    url: String,
) -> Result<DeepLinkResult, ConnectError> {
    tracing::info!("[Connect] 处理 Deep Link: {}", url);

    // 解析 Deep Link
    let payload = parse_deep_link(&url)?;

    // 查询中转商信息
    let (relay_info, is_verified) = {
        let state_guard = state.0.read().await;
        if let Some(connect_state) = state_guard.as_ref() {
            let info = connect_state.registry.get(&payload.relay);
            let verified = info.is_some();
            (info, verified)
        } else {
            (None, false)
        }
    };

    let result = DeepLinkResult {
        payload: payload.clone(),
        relay_info: relay_info.clone(),
        is_verified,
    };

    // 发送事件到前端
    // _Requirements: 1.4_
    if let Err(e) = app.emit("deep-link-connect", &result) {
        tracing::error!("[Connect] 发送 deep-link-connect 事件失败: {}", e);
    }

    Ok(result)
}

/// 查询中转商信息
///
/// _Requirements: 2.3_
#[tauri::command]
pub async fn get_relay_info(
    state: State<'_, ConnectStateWrapper>,
    relay_id: String,
) -> Result<Option<RelayInfo>, ConnectError> {
    let state_guard = state.0.read().await;
    if let Some(connect_state) = state_guard.as_ref() {
        Ok(connect_state.registry.get(&relay_id))
    } else {
        Err(ConnectError {
            code: "NOT_INITIALIZED".to_string(),
            message: "Connect 模块未初始化".to_string(),
        })
    }
}

/// 保存 API Key 的返回结果
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveApiKeyResult {
    /// Provider ID
    pub provider_id: String,
    /// API Key ID
    pub key_id: String,
    /// Provider 名称
    pub provider_name: String,
    /// 是否为新创建的 Provider
    pub is_new_provider: bool,
}

/// 保存 API Key
///
/// 将 API Key 添加到 API Key Provider 系统。
/// 如果中转商对应的 Provider 不存在，会自动创建一个自定义 Provider。
///
/// _Requirements: 4.1_
#[tauri::command]
pub async fn save_relay_api_key(
    state: State<'_, ConnectStateWrapper>,
    db: State<'_, DbConnection>,
    api_key_service: State<'_, ApiKeyProviderServiceState>,
    relay_id: String,
    api_key: String,
    name: Option<String>,
) -> Result<SaveApiKeyResult, ConnectError> {
    let state_guard = state.0.read().await;
    let connect_state = state_guard.as_ref().ok_or_else(|| ConnectError {
        code: "NOT_INITIALIZED".to_string(),
        message: "Connect 模块未初始化".to_string(),
    })?;

    // 获取中转商信息以确定协议类型和 base_url
    let relay_info = connect_state
        .registry
        .get(&relay_id)
        .ok_or_else(|| ConnectError {
            code: "RELAY_NOT_FOUND".to_string(),
            message: format!("中转商 {relay_id} 不在注册表中"),
        })?;

    let protocol = relay_info.api.protocol.to_lowercase();
    let base_url = relay_info.api.base_url.clone();

    // 确定 API Provider 类型
    let provider_type = if protocol == "claude" || protocol == "anthropic" {
        ApiProviderType::Anthropic
    } else {
        ApiProviderType::Openai
    };

    // 生成 Provider ID（使用 connect- 前缀 + 中转商 ID）
    let provider_id = format!("connect-{relay_id}");

    // 检查 Provider 是否已存在
    let existing_provider = api_key_service
        .0
        .get_provider(&db, &provider_id)
        .map_err(|e| ConnectError {
            code: "GET_PROVIDER_FAILED".to_string(),
            message: format!("查询 Provider 失败: {e}"),
        })?;

    let (final_provider_id, is_new_provider) = if existing_provider.is_some() {
        // Provider 已存在，直接使用
        (provider_id, false)
    } else {
        // 创建新的自定义 Provider
        let provider_name = name
            .clone()
            .unwrap_or_else(|| format!("[Connect] {}", relay_info.name));
        let new_provider = api_key_service
            .0
            .add_custom_provider(
                &db,
                provider_name,
                provider_type,
                base_url,
                None, // api_version
                None, // project
                None, // location
                None, // region
                None, // prompt_cache_mode
            )
            .map_err(|e| ConnectError {
                code: "CREATE_PROVIDER_FAILED".to_string(),
                message: format!("创建 Provider 失败: {e}"),
            })?;

        tracing::info!(
            "[Connect] 创建新 Provider: id={}, name={}",
            new_provider.id,
            new_provider.name
        );

        (new_provider.id, true)
    };

    // 添加 API Key 到 Provider
    let key_alias = name.or_else(|| Some(format!("[Connect] {}", relay_info.name)));
    let api_key_entry = api_key_service
        .0
        .add_api_key(&db, &final_provider_id, &api_key, key_alias.clone())
        .map_err(|e| ConnectError {
            code: "ADD_API_KEY_FAILED".to_string(),
            message: format!("添加 API Key 失败: {e}"),
        })?;

    tracing::info!(
        "[Connect] 已添加 API Key: relay={}, provider_id={}, key_id={}",
        relay_id,
        final_provider_id,
        api_key_entry.id
    );

    Ok(SaveApiKeyResult {
        provider_id: final_provider_id,
        key_id: api_key_entry.id,
        provider_name: key_alias.unwrap_or_else(|| relay_info.name.clone()),
        is_new_provider,
    })
}

/// 刷新中转商注册表
///
/// _Requirements: 2.5_
#[tauri::command]
pub async fn refresh_relay_registry(
    state: State<'_, ConnectStateWrapper>,
) -> Result<usize, ConnectError> {
    let state_guard = state.0.read().await;
    if let Some(connect_state) = state_guard.as_ref() {
        connect_state.registry.load_from_remote().await?;
        let count = connect_state.registry.len();
        tracing::info!("[Connect] 注册表已刷新，共 {} 个中转商", count);
        Ok(count)
    } else {
        Err(ConnectError {
            code: "NOT_INITIALIZED".to_string(),
            message: "Connect 模块未初始化".to_string(),
        })
    }
}

/// 获取所有中转商列表
#[tauri::command]
pub async fn list_relay_providers(
    state: State<'_, ConnectStateWrapper>,
) -> Result<Vec<RelayInfo>, ConnectError> {
    let state_guard = state.0.read().await;
    if let Some(connect_state) = state_guard.as_ref() {
        Ok(connect_state.registry.list())
    } else {
        Err(ConnectError {
            code: "NOT_INITIALIZED".to_string(),
            message: "Connect 模块未初始化".to_string(),
        })
    }
}

/// 回调状态类型
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CallbackStatusType {
    /// 配置成功
    Success,
    /// 用户取消
    Cancelled,
    /// 配置失败
    Error,
}

/// 发送统计回调
///
/// 在用户确认/取消配置后调用，向中转商发送统计回调
///
/// _Requirements: 5.3_
#[tauri::command]
pub async fn send_connect_callback(
    state: State<'_, ConnectStateWrapper>,
    relay_id: String,
    api_key: String,
    status: CallbackStatusType,
    ref_code: Option<String>,
    error_code: Option<String>,
    error_message: Option<String>,
) -> Result<bool, ConnectError> {
    tracing::info!(
        "[Connect] 发送统计回调: relay={}, status={:?}",
        relay_id,
        status
    );

    // 获取中转商信息
    let relay_info = {
        let state_guard = state.0.read().await;
        if let Some(connect_state) = state_guard.as_ref() {
            connect_state.registry.get(&relay_id)
        } else {
            return Err(ConnectError {
                code: "NOT_INITIALIZED".to_string(),
                message: "Connect 模块未初始化".to_string(),
            });
        }
    };

    // 检查是否配置了 webhook
    let webhook = match relay_info {
        Some(info) => info.webhook,
        None => {
            tracing::debug!("[Connect] 中转商 {} 不在注册表中，跳过回调", relay_id);
            return Ok(false);
        }
    };

    let webhook = match webhook {
        Some(w) => w,
        None => {
            tracing::debug!("[Connect] 中转商 {} 未配置 webhook，跳过回调", relay_id);
            return Ok(false);
        }
    };

    let callback_url = match webhook.callback_url {
        Some(url) => url,
        None => {
            tracing::debug!("[Connect] 中转商 {} webhook 配置不完整，跳过回调", relay_id);
            return Ok(false);
        }
    };

    // 发送回调（异步，不阻塞）
    match status {
        CallbackStatusType::Success => {
            send_success_callback(&callback_url, &relay_id, &api_key, ref_code);
        }
        CallbackStatusType::Cancelled => {
            send_cancelled_callback(&callback_url, &relay_id, &api_key, ref_code);
        }
        CallbackStatusType::Error => {
            send_error_callback(
                &callback_url,
                &relay_id,
                &api_key,
                ref_code,
                error_code.as_deref().unwrap_or("UNKNOWN"),
                error_message.as_deref().unwrap_or("未知错误"),
            );
        }
    }

    tracing::info!("[Connect] 统计回调已触发: relay={}", relay_id);
    Ok(true)
}
