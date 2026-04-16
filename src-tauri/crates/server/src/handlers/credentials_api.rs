//! 凭证 API 端点（用于 aster Agent 集成）
//!
//! 为 aster 子进程提供凭证查询接口，支持多种凭证类型：
//! - OAuth 凭证（Kiro, Gemini, Qwen, Antigravity 等）
//! - API Key Provider（OpenAI, Anthropic, Gemini API Key 等）
//! - OAuth 插件凭证（动态加载的第三方插件）
//!
//! 此 API 仅供内部使用，返回完整的凭证信息（包括未脱敏的 access_token）。

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;
use lime_core::database::dao::api_key_provider::ApiKeyProviderDao;
use lime_core::database::dao::provider_pool::ProviderPoolDao;
use lime_core::models::provider_pool_model::PoolProviderType;

use super::api_key_provider_utils::{build_api_key_headers, collect_api_key_provider_ids};

/// 选择凭证请求参数
#[derive(Debug, Deserialize)]
pub struct SelectCredentialRequest {
    /// Provider 类型（kiro, gemini, qwen, openai, claude, etc.）
    /// 支持 OAuth 凭证类型和 API Key Provider 类型
    pub provider_type: String,
    /// 指定模型（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 凭证来源偏好（可选）：oauth, api_key, plugin
    /// 如果不指定，会按优先级自动选择
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_preference: Option<String>,
}

/// 凭证类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    /// OAuth 凭证（凭证池）
    OAuth,
    /// API Key（API Key Provider）
    ApiKey,
    /// OAuth 插件凭证
    Plugin,
}

/// 凭证信息响应
#[derive(Debug, Serialize)]
pub struct CredentialResponse {
    /// 凭证 UUID
    pub uuid: String,
    /// Provider 类型
    pub provider_type: String,
    /// 凭证类型
    pub credential_type: CredentialType,
    /// Access Token（完整，未脱敏）
    pub access_token: String,
    /// Base URL
    pub base_url: String,
    /// Token 过期时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    /// 凭证名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 额外的请求头（用于某些 Provider）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_headers: Option<std::collections::HashMap<String, String>>,
}

/// API 错误响应
#[derive(Debug, Serialize)]
pub struct CredentialApiError {
    pub error: String,
    pub message: String,
    pub status_code: u16,
}

impl IntoResponse for CredentialApiError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, Json(self)).into_response()
    }
}

/// POST /v1/credentials/select - 选择可用凭证
///
/// 支持多种凭证来源：
/// 1. OAuth 凭证池（Kiro, Gemini, Qwen, Antigravity 等）
/// 2. API Key Provider（OpenAI, Anthropic, Gemini API Key 等）
/// 3. OAuth 插件凭证（动态加载的第三方插件）
///
/// 选择优先级（如果未指定 source_preference）：
/// 1. 首先尝试 OAuth 凭证池
/// 2. 然后尝试 API Key Provider
/// 3. 最后尝试 OAuth 插件
pub async fn credentials_select(
    State(state): State<AppState>,
    _headers: HeaderMap,
    Json(request): Json<SelectCredentialRequest>,
) -> Result<Json<CredentialResponse>, CredentialApiError> {
    tracing::info!(
        "[CREDENTIALS_API] 选择凭证请求: provider_type={}, model={:?}, source_preference={:?}",
        request.provider_type,
        request.model,
        request.source_preference
    );

    let db = state.db.as_ref().ok_or_else(|| CredentialApiError {
        error: "database_unavailable".to_string(),
        message: "数据库连接不可用".to_string(),
        status_code: 503,
    })?;

    // 根据 source_preference 决定选择策略
    let source_pref = request.source_preference.as_deref();

    // 尝试从 OAuth 凭证池选择
    if source_pref.is_none() || source_pref == Some("oauth") {
        if let Some(response) = try_select_oauth_credential(&state, db, &request).await? {
            return Ok(Json(response));
        }
    }

    // 尝试从 API Key Provider 选择（智能降级）
    if source_pref.is_none() || source_pref == Some("api_key") {
        if let Some(response) = try_select_api_key_credential(&state, db, &request).await? {
            return Ok(Json(response));
        }
    }

    // 尝试从 OAuth 插件选择
    if source_pref.is_none() || source_pref == Some("plugin") {
        if let Some(response) = try_select_plugin_credential(&state, &request).await? {
            return Ok(Json(response));
        }
    }

    // 没有找到可用凭证
    Err(CredentialApiError {
        error: "no_available_credentials".to_string(),
        message: format!(
            "没有可用的 {} 凭证。您可以在 API Key Provider 中配置 API Key 作为降级选项。",
            request.provider_type
        ),
        status_code: 503,
    })
}

/// 尝试从 OAuth 凭证池选择凭证
async fn try_select_oauth_credential(
    state: &AppState,
    db: &lime_core::database::DbConnection,
    request: &SelectCredentialRequest,
) -> Result<Option<CredentialResponse>, CredentialApiError> {
    // 使用 ProviderPoolService 智能选择凭证
    let credential = match state.pool_service.select_credential(
        db,
        &request.provider_type,
        request.model.as_deref(),
    ) {
        Ok(Some(cred)) => cred,
        Ok(None) => return Ok(None),
        Err(_) => return Ok(None),
    };

    // 获取 access_token
    let access_token = match credential
        .cached_token
        .as_ref()
        .and_then(|cache| cache.access_token.clone())
    {
        Some(token) => token,
        None => return Ok(None),
    };

    // 根据 Provider 类型确定 base_url
    let base_url = get_oauth_base_url(&credential.provider_type);

    let response = CredentialResponse {
        uuid: credential.uuid.clone(),
        provider_type: credential.provider_type.to_string(),
        credential_type: CredentialType::OAuth,
        access_token,
        base_url,
        expires_at: credential
            .cached_token
            .as_ref()
            .and_then(|cache| cache.expiry_time),
        name: credential.name.clone(),
        extra_headers: None,
    };

    tracing::info!(
        "[CREDENTIALS_API] OAuth 凭证选择成功: {} ({})",
        response.name.as_deref().unwrap_or("未命名"),
        response.uuid
    );

    Ok(Some(response))
}

/// 尝试从 API Key Provider 选择凭证
async fn try_select_api_key_credential(
    state: &AppState,
    db: &lime_core::database::DbConnection,
    request: &SelectCredentialRequest,
) -> Result<Option<CredentialResponse>, CredentialApiError> {
    let candidate_provider_ids = collect_api_key_provider_ids(&request.provider_type);

    // 获取 API Key Provider Service
    let api_key_service = &state.api_key_service;

    for provider_id in candidate_provider_ids {
        // 尝试获取下一个可用的 API Key
        let (key_id, api_key) = match api_key_service.get_next_api_key_entry(db, &provider_id) {
            Ok(Some((id, key))) => (id, key),
            Ok(None) => continue,
            Err(_) => continue,
        };

        // 获取 Provider 信息以确定 base_url
        let provider = {
            let conn = db.lock().map_err(|e| CredentialApiError {
                error: "database_lock_error".to_string(),
                message: format!("数据库锁定失败: {e}"),
                status_code: 500,
            })?;

            match ApiKeyProviderDao::get_provider_by_id(&conn, &provider_id) {
                Ok(Some(p)) => p,
                Ok(None) => continue,
                Err(_) => continue,
            }
        };

        // 构建额外的请求头
        let extra_headers =
            build_api_key_headers(&provider.provider_type, &provider.api_host, &api_key);

        let response = CredentialResponse {
            uuid: key_id,
            provider_type: request.provider_type.clone(),
            credential_type: CredentialType::ApiKey,
            access_token: api_key,
            base_url: provider.api_host,
            expires_at: None, // API Key 通常没有过期时间
            name: Some(provider.name),
            extra_headers: Some(extra_headers),
        };

        tracing::info!(
            "[CREDENTIALS_API] API Key 凭证选择成功: {} ({})",
            response.name.as_deref().unwrap_or("未命名"),
            response.uuid
        );

        return Ok(Some(response));
    }

    Ok(None)
}

/// 尝试从 OAuth 插件选择凭证（已禁用 - 插件系统已移除）
async fn try_select_plugin_credential(
    _state: &AppState,
    _request: &SelectCredentialRequest,
) -> Result<Option<CredentialResponse>, CredentialApiError> {
    // OAuth 插件系统已移除，直接返回 None
    Ok(None)
}

/// 根据 OAuth Provider 类型获取 base_url
fn get_oauth_base_url(provider_type: &PoolProviderType) -> String {
    match provider_type {
        PoolProviderType::Kiro => "https://api.anthropic.com".to_string(),
        PoolProviderType::Gemini => "https://generativelanguage.googleapis.com".to_string(),
        PoolProviderType::Antigravity => "https://api.anthropic.com".to_string(),
        PoolProviderType::Vertex => "https://vertex-ai.googleapis.com".to_string(),
        PoolProviderType::GeminiApiKey => "https://generativelanguage.googleapis.com".to_string(),
        PoolProviderType::Codex => "https://api.openai.com/v1".to_string(),
        PoolProviderType::ClaudeOAuth => "https://api.anthropic.com".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

/// GET /v1/credentials/{uuid}/token - 获取指定凭证的 Token
///
/// 支持多种凭证类型：
/// - OAuth 凭证池中的凭证
/// - API Key Provider 中的 API Key
pub async fn credentials_get_token(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    _headers: HeaderMap,
) -> Result<Json<CredentialResponse>, CredentialApiError> {
    tracing::info!("[CREDENTIALS_API] 获取凭证 Token: {}", uuid);

    let db = state.db.as_ref().ok_or_else(|| CredentialApiError {
        error: "database_unavailable".to_string(),
        message: "数据库连接不可用".to_string(),
        status_code: 503,
    })?;

    // 首先尝试从 OAuth 凭证池查询
    if let Some(response) = try_get_oauth_token(&state, db, &uuid).await? {
        return Ok(Json(response));
    }

    // 然后尝试从 API Key Provider 查询
    if let Some(response) = try_get_api_key_token(&state, db, &uuid).await? {
        return Ok(Json(response));
    }

    // 未找到凭证
    Err(CredentialApiError {
        error: "credential_not_found".to_string(),
        message: format!("未找到 UUID 为 {uuid} 的凭证"),
        status_code: 404,
    })
}

/// 尝试从 OAuth 凭证池获取 Token
async fn try_get_oauth_token(
    state: &AppState,
    db: &lime_core::database::DbConnection,
    uuid: &str,
) -> Result<Option<CredentialResponse>, CredentialApiError> {
    // 查询凭证
    let credential = {
        let conn = db.lock().map_err(|e| CredentialApiError {
            error: "database_lock_error".to_string(),
            message: format!("数据库锁定失败: {e}"),
            status_code: 500,
        })?;

        match ProviderPoolDao::get_by_uuid(&conn, uuid) {
            Ok(Some(cred)) => cred,
            Ok(None) => return Ok(None),
            Err(_) => return Ok(None),
        }
    };

    // 如果 Token 即将过期，尝试刷新
    let cached_token = if let Some(cache) = &credential.cached_token {
        if let Some(expiry_time) = cache.expiry_time {
            let now = chrono::Utc::now();
            let time_until_expiry = expiry_time - now;

            // 如果距离过期不到 30 分钟，尝试刷新
            if time_until_expiry < chrono::Duration::minutes(30) {
                tracing::info!("[CREDENTIALS_API] Token 即将过期，尝试刷新: {}", uuid);
                match state
                    .token_cache
                    .refresh_and_cache_with_events(
                        db,
                        uuid,
                        false,
                        Some(state.kiro_event_service.clone()),
                    )
                    .await
                {
                    Ok(new_token) => {
                        tracing::info!("[CREDENTIALS_API] Token 刷新成功: {}", uuid);
                        Some(new_token)
                    }
                    Err(e) => {
                        tracing::warn!("[CREDENTIALS_API] Token 刷新失败，使用现有 Token: {}", e);
                        cache.access_token.clone()
                    }
                }
            } else {
                cache.access_token.clone()
            }
        } else {
            cache.access_token.clone()
        }
    } else {
        None
    };

    let access_token = match cached_token {
        Some(token) => token,
        None => return Ok(None),
    };

    // 根据 Provider 类型确定 base_url
    let base_url = get_oauth_base_url(&credential.provider_type);

    // 重新查询凭证以获取更新后的 expires_at
    let updated_credential = {
        let conn = db.lock().map_err(|e| CredentialApiError {
            error: "database_lock_error".to_string(),
            message: format!("数据库锁定失败: {e}"),
            status_code: 500,
        })?;

        match ProviderPoolDao::get_by_uuid(&conn, uuid) {
            Ok(Some(cred)) => cred,
            Ok(None) => return Ok(None),
            Err(_) => return Ok(None),
        }
    };

    let response = CredentialResponse {
        uuid: updated_credential.uuid.clone(),
        provider_type: updated_credential.provider_type.to_string(),
        credential_type: CredentialType::OAuth,
        access_token,
        base_url,
        expires_at: updated_credential
            .cached_token
            .as_ref()
            .and_then(|cache| cache.expiry_time),
        name: updated_credential.name.clone(),
        extra_headers: None,
    };

    tracing::info!(
        "[CREDENTIALS_API] 返回 OAuth 凭证 Token: {} ({})",
        response.name.as_deref().unwrap_or("未命名"),
        response.uuid
    );

    Ok(Some(response))
}

/// 尝试从 API Key Provider 获取 Token
async fn try_get_api_key_token(
    state: &AppState,
    db: &lime_core::database::DbConnection,
    uuid: &str,
) -> Result<Option<CredentialResponse>, CredentialApiError> {
    let conn = db.lock().map_err(|e| CredentialApiError {
        error: "database_lock_error".to_string(),
        message: format!("数据库锁定失败: {e}"),
        status_code: 500,
    })?;

    // 查询 API Key
    let api_key_entry = match ApiKeyProviderDao::get_api_key_by_id(&conn, uuid) {
        Ok(Some(key)) => key,
        Ok(None) => return Ok(None),
        Err(_) => return Ok(None),
    };

    // 获取 Provider 信息
    let provider = match ApiKeyProviderDao::get_provider_by_id(&conn, &api_key_entry.provider_id) {
        Ok(Some(p)) => p,
        Ok(None) => return Ok(None),
        Err(_) => return Ok(None),
    };
    drop(conn);

    // 解密 API Key
    let api_key = state
        .api_key_service
        .decrypt_api_key(&api_key_entry.api_key_encrypted)
        .map_err(|e| CredentialApiError {
            error: "decryption_error".to_string(),
            message: format!("API Key 解密失败: {e}"),
            status_code: 500,
        })?;

    // 构建额外的请求头
    let extra_headers =
        build_api_key_headers(&provider.provider_type, &provider.api_host, &api_key);

    let response = CredentialResponse {
        uuid: api_key_entry.id.clone(),
        provider_type: provider.provider_type.to_string(),
        credential_type: CredentialType::ApiKey,
        access_token: api_key,
        base_url: provider.api_host,
        expires_at: None,
        name: api_key_entry.alias.or(Some(provider.name)),
        extra_headers: Some(extra_headers),
    };

    tracing::info!(
        "[CREDENTIALS_API] 返回 API Key 凭证: {} ({})",
        response.name.as_deref().unwrap_or("未命名"),
        response.uuid
    );

    Ok(Some(response))
}
