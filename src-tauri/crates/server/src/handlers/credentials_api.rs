//! 凭证 API 端点（用于 aster Agent 集成）
//!
//! 为 aster 子进程提供 API Key Provider 查询接口。
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
    /// 凭证来源偏好（可选）：当前只支持 api_key
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_preference: Option<String>,
}

/// 凭证类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    /// API Key（API Key Provider）
    ApiKey,
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
/// 只从 API Key Provider 主路径选择凭证。
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

    let source_pref = request.source_preference.as_deref();

    // 尝试从 API Key Provider 选择（智能降级）
    if source_pref.is_none() || source_pref == Some("api_key") {
        if let Some(response) = try_select_api_key_credential(&state, db, &request).await? {
            return Ok(Json(response));
        }
    }

    // 没有找到可用凭证
    Err(CredentialApiError {
        error: "no_available_credentials".to_string(),
        message: format!(
            "没有可用的 {} API Key Provider 凭证。",
            request.provider_type
        ),
        status_code: 503,
    })
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

/// GET /v1/credentials/{uuid}/token - 获取指定凭证的 Token
///
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
