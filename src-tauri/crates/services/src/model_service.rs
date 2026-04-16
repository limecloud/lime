//! 模型管理服务
//!
//! 提供统一的模型获取、缓存和查询接口，支持从不同 Provider 获取模型列表。

use lime_core::database::dao::api_key_provider::{infer_managed_runtime_spec, ApiProviderType};
use lime_core::database::dao::provider_pool::ProviderPoolDao;
use lime_core::database::DbConnection;
use lime_core::models::provider_pool_model::{
    CredentialData, PoolProviderType, ProviderCredential,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// 模型信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// 模型 ID
    pub id: String,
    /// 模型对象类型（通常是 "model"）
    pub object: String,
    /// 拥有者（如 "anthropic", "google", "openai"）
    pub owned_by: String,
    /// 创建时间（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<i64>,
}

/// /v1/models 接口的响应格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsResponse {
    pub object: String,
    pub data: Vec<ModelInfo>,
}

/// 模型服务
pub struct ModelService {
    /// HTTP 客户端
    client: Client,
    /// 请求超时时间
    timeout: Duration,
}

impl Default for ModelService {
    fn default() -> Self {
        Self::new()
    }
}

impl ModelService {
    /// 创建新的模型服务实例
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
            timeout: Duration::from_secs(10),
        }
    }

    /// 从凭证获取支持的模型列表
    ///
    /// 根据凭证类型调用相应的 /v1/models 接口
    pub async fn fetch_models_for_credential(
        &self,
        credential: &ProviderCredential,
    ) -> Result<Vec<String>, String> {
        tracing::info!(
            "[MODEL_SERVICE] 获取凭证模型列表: uuid={}, provider_type={}",
            credential.uuid,
            credential.provider_type
        );

        match &credential.credential {
            // Antigravity 使用固定的模型列表（从配置文件读取）
            CredentialData::AntigravityOAuth { .. } => {
                // Antigravity 不提供标准的 /v1/models 接口
                // 直接返回预定义的模型列表
                tracing::info!("[MODEL_SERVICE] Antigravity 使用预定义模型列表");
                Ok(self.get_default_models_for_provider(&credential.provider_type))
            }

            // OAuth 凭证：由于需要处理 Token 刷新等复杂逻辑，暂时使用默认模型列表
            // TODO: 未来可以通过 ProviderPoolService 来获取动态模型列表
            CredentialData::KiroOAuth { .. }
            | CredentialData::GeminiOAuth { .. }
            | CredentialData::CodexOAuth { .. }
            | CredentialData::ClaudeOAuth { .. } => {
                tracing::info!("[MODEL_SERVICE] OAuth 凭证使用默认模型列表");
                Ok(self.get_default_models_for_provider(&credential.provider_type))
            }

            // API Key 类型凭证：直接调用 Provider 的 API
            CredentialData::OpenAIKey { base_url, api_key } => {
                tracing::info!("[MODEL_SERVICE] 使用 OpenAI API Key");
                self.fetch_models_openai(base_url.as_deref(), api_key).await
            }
            CredentialData::ClaudeKey { base_url, api_key } => {
                tracing::info!("[MODEL_SERVICE] 使用 Claude API Key");
                self.fetch_models_claude(base_url.as_deref(), api_key).await
            }
            CredentialData::AnthropicKey { base_url, api_key } => {
                tracing::info!("[MODEL_SERVICE] 使用 Anthropic API Key");
                self.fetch_models_anthropic(base_url.as_deref(), api_key)
                    .await
            }
            CredentialData::GeminiApiKey {
                api_key, base_url, ..
            } => {
                tracing::info!("[MODEL_SERVICE] 使用 Gemini API Key");
                self.fetch_models_gemini(base_url.as_deref(), api_key).await
            }
            CredentialData::VertexKey { .. } => {
                tracing::info!("[MODEL_SERVICE] Vertex AI 使用固定模型列表");
                // Vertex AI 使用固定的模型列表
                Ok(self.get_default_models_for_provider(&credential.provider_type))
            }
        }
    }

    /// 获取 OpenAI 兼容 API 的模型列表
    async fn fetch_models_openai(
        &self,
        base_url: Option<&str>,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        let url = format!("{}/v1/models", base_url.unwrap_or("https://api.openai.com"));

        tracing::info!("[MODEL_SERVICE] 请求 OpenAI API 获取模型列表: url={}", url);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("[MODEL_SERVICE] OpenAI 请求失败: {}", e);
                format!("请求失败: {e}")
            })?;

        let status = response.status();
        tracing::info!("[MODEL_SERVICE] OpenAI 响应状态码: {}", status);

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            tracing::error!(
                "[MODEL_SERVICE] OpenAI HTTP 错误: status={}, body={}",
                status,
                error_body
            );
            return Err(format!("HTTP 错误: {status}"));
        }

        let response_text = response.text().await.map_err(|e| {
            tracing::error!("[MODEL_SERVICE] 读取 OpenAI 响应体失败: {}", e);
            format!("读取响应体失败: {e}")
        })?;

        tracing::debug!("[MODEL_SERVICE] OpenAI 响应体: {}", response_text);

        let models_response: ModelsResponse =
            serde_json::from_str(&response_text).map_err(|e| {
                tracing::error!(
                    "[MODEL_SERVICE] 解析 OpenAI 响应失败: {}, 响应内容: {}",
                    e,
                    response_text
                );
                format!("解析响应失败: {e}")
            })?;

        let model_ids: Vec<String> = models_response.data.into_iter().map(|m| m.id).collect();

        tracing::info!("[MODEL_SERVICE] OpenAI 成功获取 {} 个模型", model_ids.len());

        Ok(model_ids)
    }

    /// 获取 Claude API 的模型列表
    async fn fetch_models_claude(
        &self,
        base_url: Option<&str>,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        // Claude API 使用 OpenAI 兼容格式
        self.fetch_models_openai(base_url, api_key).await
    }

    /// 获取 Anthropic API 的模型列表
    async fn fetch_models_anthropic(
        &self,
        base_url: Option<&str>,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        // Anthropic API 使用 OpenAI 兼容格式
        let url = format!(
            "{}/v1/models",
            base_url.unwrap_or("https://api.anthropic.com")
        );

        tracing::info!(
            "[MODEL_SERVICE] 请求 Anthropic API 获取模型列表: url={}",
            url
        );

        let runtime_spec = infer_managed_runtime_spec(
            ApiProviderType::Anthropic,
            base_url.unwrap_or("https://api.anthropic.com"),
        );
        let auth_value = runtime_spec
            .auth_prefix
            .map(|prefix| format!("{prefix} {api_key}"))
            .unwrap_or_else(|| api_key.to_string());

        let mut request = self
            .client
            .get(&url)
            .header(runtime_spec.auth_header, auth_value)
            .timeout(self.timeout);

        for (name, value) in runtime_spec.extra_headers {
            request = request.header(*name, *value);
        }

        let response = request.send().await.map_err(|e| {
            tracing::error!("[MODEL_SERVICE] Anthropic 请求失败: {}", e);
            format!("请求失败: {e}")
        })?;

        let status = response.status();
        tracing::info!("[MODEL_SERVICE] Anthropic 响应状态码: {}", status);

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            tracing::error!(
                "[MODEL_SERVICE] Anthropic HTTP 错误: status={}, body={}",
                status,
                error_body
            );
            return Err(format!("HTTP 错误: {status}"));
        }

        let response_text = response.text().await.map_err(|e| {
            tracing::error!("[MODEL_SERVICE] 读取 Anthropic 响应体失败: {}", e);
            format!("读取响应体失败: {e}")
        })?;

        tracing::debug!("[MODEL_SERVICE] Anthropic 响应体: {}", response_text);

        let models_response: ModelsResponse =
            serde_json::from_str(&response_text).map_err(|e| {
                tracing::error!(
                    "[MODEL_SERVICE] 解析 Anthropic 响应失败: {}, 响应内容: {}",
                    e,
                    response_text
                );
                format!("解析响应失败: {e}")
            })?;

        let model_ids: Vec<String> = models_response.data.into_iter().map(|m| m.id).collect();

        tracing::info!(
            "[MODEL_SERVICE] Anthropic 成功获取 {} 个模型",
            model_ids.len()
        );

        Ok(model_ids)
    }

    /// 获取 Gemini API 的模型列表
    async fn fetch_models_gemini(
        &self,
        base_url: Option<&str>,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        let url = format!(
            "{}/v1/models?key={}",
            base_url.unwrap_or("https://generativelanguage.googleapis.com"),
            api_key
        );

        tracing::info!("[MODEL_SERVICE] 请求 Gemini API 获取模型列表: url={}", url);

        let response = self
            .client
            .get(&url)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("[MODEL_SERVICE] Gemini 请求失败: {}", e);
                format!("请求失败: {e}")
            })?;

        let status = response.status();
        tracing::info!("[MODEL_SERVICE] Gemini 响应状态码: {}", status);

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            tracing::error!(
                "[MODEL_SERVICE] Gemini HTTP 错误: status={}, body={}",
                status,
                error_body
            );
            return Err(format!("HTTP 错误: {status}"));
        }

        let response_text = response.text().await.map_err(|e| {
            tracing::error!("[MODEL_SERVICE] 读取 Gemini 响应体失败: {}", e);
            format!("读取响应体失败: {e}")
        })?;

        tracing::debug!("[MODEL_SERVICE] Gemini 响应体: {}", response_text);

        // Gemini API 返回格式不同，需要特殊处理
        let response_json: serde_json::Value =
            serde_json::from_str(&response_text).map_err(|e| {
                tracing::error!(
                    "[MODEL_SERVICE] 解析 Gemini 响应失败: {}, 响应内容: {}",
                    e,
                    response_text
                );
                format!("解析响应失败: {e}")
            })?;

        let models = response_json
            .get("models")
            .and_then(|m| m.as_array())
            .ok_or_else(|| {
                tracing::error!("[MODEL_SERVICE] Gemini 响应格式错误: 缺少 models 字段");
                "响应格式错误".to_string()
            })?;

        let model_ids: Vec<String> = models
            .iter()
            .filter_map(|m| m.get("name").and_then(|n| n.as_str()))
            .map(|name| {
                // Gemini API 返回的是 "models/gemini-pro"，需要提取模型名
                name.strip_prefix("models/").unwrap_or(name).to_string()
            })
            .collect();

        tracing::info!(
            "[MODEL_SERVICE] Gemini 成功获取 {} 个模型: {:?}",
            model_ids.len(),
            model_ids
        );

        Ok(model_ids)
    }

    /// 获取 Provider 的默认模型列表（用于无法动态获取的情况）
    pub fn get_default_models_for_provider(&self, provider_type: &PoolProviderType) -> Vec<String> {
        match provider_type {
            PoolProviderType::Kiro => vec![
                "claude-sonnet-4-5".to_string(),
                "claude-sonnet-4-5-20250929".to_string(),
                "claude-3-7-sonnet-20250219".to_string(),
                "claude-3-5-sonnet-latest".to_string(),
                "claude-haiku-4-5".to_string(),
            ],
            PoolProviderType::Gemini => vec![
                // Gemini 3 系列
                "gemini-3-pro-preview".to_string(),
                "gemini-3-flash-preview".to_string(),
                // Gemini 2.5 系列
                "gemini-2.5-pro".to_string(),
                "gemini-2.5-flash".to_string(),
                "gemini-2.5-flash-lite".to_string(),
                // Gemini 2.0 系列
                "gemini-2.0-flash".to_string(),
                "gemini-2.0-flash-lite".to_string(),
                // Gemini 1.5 系列（已弃用但仍可用）
                "gemini-1.5-pro".to_string(),
                "gemini-1.5-flash".to_string(),
            ],
            PoolProviderType::Antigravity => vec![
                "gemini-2.5-computer-use-preview-10-2025".to_string(),
                "gemini-3-pro-image-preview".to_string(),
                "gemini-3-pro-preview".to_string(),
                "gemini-3-flash-preview".to_string(),
                "gemini-2.5-flash-preview".to_string(),
                "gemini-claude-sonnet-4-5".to_string(),
                "gemini-claude-sonnet-4-5-thinking".to_string(),
                "gemini-claude-opus-4-5-thinking".to_string(),
            ],
            PoolProviderType::OpenAI => vec![
                "gpt-4o".to_string(),
                "gpt-4o-mini".to_string(),
                "gpt-3.5-turbo".to_string(),
            ],
            PoolProviderType::Claude | PoolProviderType::Anthropic => vec![
                "claude-sonnet-4-5-20250929".to_string(),
                "claude-3-5-sonnet-20241022".to_string(),
                "claude-3-5-haiku-20241022".to_string(),
            ],
            PoolProviderType::GeminiApiKey => {
                vec!["gemini-2.5-flash".to_string(), "gemini-2.5-pro".to_string()]
            }
            _ => vec![],
        }
    }

    /// 更新凭证的支持模型列表到数据库
    pub fn update_credential_models(
        &self,
        db: &DbConnection,
        credential_uuid: &str,
        models: Vec<String>,
    ) -> Result<(), String> {
        let conn = db.lock().map_err(|e| e.to_string())?;

        // 序列化模型列表为 JSON
        let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE provider_pool_credentials SET supported_models = ?1, updated_at = ?2 WHERE uuid = ?3",
            rusqlite::params![models_json, chrono::Utc::now().timestamp(), credential_uuid],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// 获取凭证的支持模型列表（从数据库）
    pub fn get_credential_models(
        &self,
        db: &DbConnection,
        credential_uuid: &str,
    ) -> Result<Vec<String>, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT supported_models FROM provider_pool_credentials WHERE uuid = ?1")
            .map_err(|e| e.to_string())?;

        let models_json: Option<String> = stmt.query_row([credential_uuid], |row| row.get(0)).ok();

        match models_json {
            Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
            None => Ok(vec![]),
        }
    }

    /// 获取所有凭证的模型列表（按 Provider 类型分组）
    pub fn get_all_models_by_provider(
        &self,
        db: &DbConnection,
    ) -> Result<HashMap<String, Vec<String>>, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let credentials = ProviderPoolDao::get_all(&conn).map_err(|e| e.to_string())?;
        drop(conn);

        let mut models_by_provider: HashMap<String, Vec<String>> = HashMap::new();

        for cred in credentials {
            if cred.is_disabled || !cred.is_healthy {
                continue;
            }

            let provider_key = cred.provider_type.to_string();

            models_by_provider
                .entry(provider_key)
                .or_default()
                .extend(cred.supported_models);
        }

        // 去重
        for models in models_by_provider.values_mut() {
            models.sort();
            models.dedup();
        }

        Ok(models_by_provider)
    }

    /// 获取可用的所有模型列表（合并所有健康凭证的模型）
    pub fn get_all_available_models(&self, db: &DbConnection) -> Result<Vec<String>, String> {
        let models_by_provider = self.get_all_models_by_provider(db)?;

        let mut all_models: Vec<String> = models_by_provider.into_values().flatten().collect();

        all_models.sort();
        all_models.dedup();

        Ok(all_models)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::provider_pool::ProviderPoolDao;
    use lime_core::database::schema;
    use lime_core::models::provider_pool_model::{CredentialData, PoolProviderType};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        schema::create_tables(&conn).expect("create schema");
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn test_get_default_models_for_provider() {
        let service = ModelService::new();

        let kiro_models = service.get_default_models_for_provider(&PoolProviderType::Kiro);
        assert!(!kiro_models.is_empty());
        assert!(kiro_models.contains(&"claude-sonnet-4-5".to_string()));

        let gemini_models = service.get_default_models_for_provider(&PoolProviderType::Gemini);
        assert!(!gemini_models.is_empty());
        assert!(gemini_models.contains(&"gemini-2.5-flash".to_string()));
    }

    #[test]
    fn test_get_all_available_models_uses_loaded_supported_models_without_relocking_db() {
        let db = setup_test_db();
        let mut openai = ProviderCredential::new(
            PoolProviderType::OpenAI,
            CredentialData::OpenAIKey {
                api_key: "sk-test".to_string(),
                base_url: None,
            },
        );
        openai.supported_models = vec!["gpt-4o".to_string(), "gpt-4.1".to_string()];

        let mut gemini = ProviderCredential::new(
            PoolProviderType::GeminiApiKey,
            CredentialData::GeminiApiKey {
                api_key: "gm-test".to_string(),
                base_url: None,
                excluded_models: Vec::new(),
            },
        );
        gemini.supported_models = vec!["gemini-2.5-flash".to_string(), "gpt-4o".to_string()];

        {
            let conn = db.lock().expect("lock db for seed");
            ProviderPoolDao::insert(&conn, &openai).expect("insert openai credential");
            ProviderPoolDao::insert(&conn, &gemini).expect("insert gemini credential");
        }

        let models = ModelService::new()
            .get_all_available_models(&db)
            .expect("list available models");

        assert_eq!(
            models,
            vec![
                "gemini-2.5-flash".to_string(),
                "gpt-4.1".to_string(),
                "gpt-4o".to_string(),
            ]
        );
    }
}
