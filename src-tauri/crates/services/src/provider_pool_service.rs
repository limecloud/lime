//! Provider Pool 管理服务
//!
//! 提供凭证池的选择、健康检测、负载均衡等功能。

#![allow(dead_code)]

use crate::api_key_provider_service::ApiKeyProviderService;
use crate::provider_type_mapping::{
    api_provider_type_to_pool_type, is_custom_provider_id, parse_pool_provider_type,
    resolve_pool_provider_type_or_default,
};
use chrono::Utc;
use lime_core::database::dao::api_key_provider::{infer_managed_runtime_spec, ApiProviderType};
use lime_core::database::dao::provider_pool::ProviderPoolDao;
use lime_core::database::DbConnection;
use lime_core::models::client_type::ClientType;
use lime_core::models::provider_pool_model::{
    get_default_check_model, get_oauth_creds_path, CredentialData, CredentialDisplay,
    HealthCheckResult, OAuthStatus, PoolProviderType, PoolStats, ProviderCredential,
    ProviderPoolOverview,
};
use lime_providers::providers::antigravity::TokenRefreshError;
use lime_providers::providers::kiro::KiroProvider;
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// 扩展 ProviderCredential 的客户端兼容性检查
/// （此方法依赖 server::client_detector，不适合放在 core crate）
trait ProviderCredentialClientCompat {
    fn is_compatible_with_client(&self, client_type: Option<&ClientType>) -> bool;
}

impl ProviderCredentialClientCompat for ProviderCredential {
    fn is_compatible_with_client(&self, client_type: Option<&ClientType>) -> bool {
        if let Some(error_msg) = &self.last_error_message {
            if error_msg.contains("only authorized for use with Claude Code") {
                return matches!(client_type, Some(ClientType::ClaudeCode));
            }
        }
        true
    }
}
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::AtomicUsize;
use std::time::Duration;

/// 凭证健康信息
/// Requirements: 3.1, 3.2
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialHealthInfo {
    /// 凭证 UUID
    pub uuid: String,
    /// 凭证名称
    pub name: Option<String>,
    /// Provider 类型
    pub provider_type: String,
    /// 是否健康
    pub is_healthy: bool,
    /// 最后错误信息
    pub last_error: Option<String>,
    /// 最后错误时间（RFC3339 格式）
    pub last_error_time: Option<String>,
    /// 错误次数
    pub failure_count: u32,
    /// 是否需要重新授权
    pub requires_reauth: bool,
}

/// 凭证选择错误
/// Requirements: 3.4
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SelectionError {
    /// 没有凭证
    NoCredentials,
    /// 所有凭证都不健康
    AllUnhealthy { details: Vec<CredentialHealthInfo> },
    /// 模型不支持
    ModelNotSupported { model: String },
}

/// 凭证池管理服务
pub struct ProviderPoolService {
    /// HTTP 客户端（用于健康检测）
    client: Client,
    /// 轮询索引（按 provider_type 和可选的 model 分组）
    round_robin_index: std::sync::RwLock<HashMap<String, AtomicUsize>>,
    /// 最大错误次数（超过后标记为不健康）
    max_error_count: u32,
    /// 健康检查超时时间
    health_check_timeout: Duration,
}

impl Default for ProviderPoolService {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderPoolService {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            round_robin_index: std::sync::RwLock::new(HashMap::new()),
            max_error_count: 3,
            health_check_timeout: Duration::from_secs(30),
        }
    }

    /// 获取所有凭证概览
    pub fn get_overview(&self, db: &DbConnection) -> Result<Vec<ProviderPoolOverview>, String> {
        let conn = lime_core::database::lock_db(db)?;
        let grouped = ProviderPoolDao::get_grouped(&conn).map_err(|e| e.to_string())?;

        let mut overview = Vec::new();
        for (provider_type, mut credentials) in grouped {
            // 为每个凭证加载 token 缓存
            for cred in &mut credentials {
                cred.cached_token = ProviderPoolDao::get_token_cache(&conn, &cred.uuid)
                    .ok()
                    .flatten();
            }

            let stats = PoolStats::from_credentials(&credentials);
            let displays: Vec<CredentialDisplay> = credentials.iter().map(|c| c.into()).collect();

            overview.push(ProviderPoolOverview {
                provider_type: provider_type.to_string(),
                stats,
                credentials: displays,
            });
        }

        // 按 provider_type 排序
        overview.sort_by(|a, b| a.provider_type.cmp(&b.provider_type));
        Ok(overview)
    }

    /// 获取指定类型的凭证列表
    pub fn get_by_type(
        &self,
        db: &DbConnection,
        provider_type: &str,
    ) -> Result<Vec<CredentialDisplay>, String> {
        let pt = parse_pool_provider_type(provider_type)?;
        let conn = lime_core::database::lock_db(db)?;
        let mut credentials =
            ProviderPoolDao::get_by_type(&conn, &pt).map_err(|e| e.to_string())?;

        // 为每个凭证加载 token 缓存
        for cred in &mut credentials {
            cred.cached_token = ProviderPoolDao::get_token_cache(&conn, &cred.uuid)
                .ok()
                .flatten();
        }

        Ok(credentials.iter().map(|c| c.into()).collect())
    }

    /// 获取指定 UUID 的凭证
    pub fn get_by_uuid(
        &self,
        db: &DbConnection,
        uuid: &str,
    ) -> Result<Option<ProviderCredential>, String> {
        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::get_by_uuid(&conn, uuid).map_err(|e| e.to_string())
    }

    /// 添加凭证
    pub fn add_credential(
        &self,
        db: &DbConnection,
        provider_type: &str,
        credential: CredentialData,
        name: Option<String>,
        check_health: Option<bool>,
        check_model_name: Option<String>,
    ) -> Result<ProviderCredential, String> {
        let pt = parse_pool_provider_type(provider_type)?;

        let mut cred = ProviderCredential::new(pt, credential);
        cred.name = name;
        cred.check_health = check_health.unwrap_or(true);
        cred.check_model_name = check_model_name;

        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::insert(&conn, &cred).map_err(|e| e.to_string())?;

        Ok(cred)
    }

    /// 更新凭证
    pub fn update_credential(
        &self,
        db: &DbConnection,
        uuid: &str,
        name: Option<String>,
        is_disabled: Option<bool>,
        check_health: Option<bool>,
        check_model_name: Option<String>,
        not_supported_models: Option<Vec<String>>,
        proxy_url: Option<String>,
    ) -> Result<ProviderCredential, String> {
        let conn = lime_core::database::lock_db(db)?;
        let mut cred = ProviderPoolDao::get_by_uuid(&conn, uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Credential not found: {uuid}"))?;

        // 处理 name：空字符串表示清除，None 表示不修改
        if let Some(n) = name {
            cred.name = if n.is_empty() { None } else { Some(n) };
        }
        if let Some(d) = is_disabled {
            cred.is_disabled = d;
        }
        if let Some(c) = check_health {
            cred.check_health = c;
        }
        // 处理 check_model_name：空字符串表示清除，None 表示不修改
        if let Some(m) = check_model_name {
            cred.check_model_name = if m.is_empty() { None } else { Some(m) };
        }
        if let Some(models) = not_supported_models {
            cred.not_supported_models = models;
        }
        // 处理 proxy_url：空字符串表示清除，None 表示不修改
        if let Some(p) = proxy_url {
            cred.proxy_url = if p.is_empty() { None } else { Some(p) };
        }
        cred.updated_at = Utc::now();

        ProviderPoolDao::update(&conn, &cred).map_err(|e| e.to_string())?;
        Ok(cred)
    }

    /// 删除凭证
    pub fn delete_credential(&self, db: &DbConnection, uuid: &str) -> Result<bool, String> {
        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::delete(&conn, uuid).map_err(|e| e.to_string())
    }

    /// 选择一个可用的凭证（智能轮换策略）
    ///
    /// 增强版轮换策略，考虑以下因素：
    /// - 健康状态：优先选择健康的凭证
    /// - 使用频率：优先选择使用次数较少的凭证
    /// - 错误率：避免选择错误次数过多的凭证
    /// - 冷却时间：避免短时间内重复使用同一凭证
    pub fn select_credential(
        &self,
        db: &DbConnection,
        provider_type: &str,
        model: Option<&str>,
    ) -> Result<Option<ProviderCredential>, String> {
        self.select_credential_with_client_check(db, provider_type, model, None)
    }

    /// 选择凭证并检查客户端兼容性
    ///
    /// 内部方法，支持客户端类型检查
    pub fn select_credential_with_client_check(
        &self,
        db: &DbConnection,
        provider_type: &str,
        model: Option<&str>,
        client_type: Option<&lime_core::models::client_type::ClientType>,
    ) -> Result<Option<ProviderCredential>, String> {
        if is_custom_provider_id(provider_type) {
            eprintln!("[SELECT_CREDENTIAL] custom provider '{provider_type}' 使用智能降级路径");
            return Ok(None);
        }

        // 对于未知的 provider_type，直接返回 None（不是错误）
        // 这样可以让 select_credential_with_fallback 继续尝试智能降级
        let pt: PoolProviderType = match parse_pool_provider_type(provider_type) {
            Ok(pt) => pt,
            Err(_) => {
                eprintln!(
                    "[SELECT_CREDENTIAL] 未知的 provider_type '{provider_type}', 返回 None 以便智能降级"
                );
                return Ok(None);
            }
        };
        let conn = lime_core::database::lock_db(db)?;

        // 获取凭证，对于 AI Provider 类型，也查找 Assistant 类型的凭证
        let mut credentials =
            ProviderPoolDao::get_by_type(&conn, &pt).map_err(|e| e.to_string())?;
        eprintln!(
            "[SELECT_CREDENTIAL] provider_type={}, pt={:?}, initial_count={}",
            provider_type,
            pt,
            credentials.len()
        );

        // AI Provider 和 Assistant 共享凭证（都使用 AI Provider API）
        if pt == PoolProviderType::Anthropic {
            let assistant_creds = ProviderPoolDao::get_by_type(&conn, &PoolProviderType::Claude)
                .map_err(|e| e.to_string())?;
            eprintln!(
                "[SELECT_CREDENTIAL] AI Provider: adding {} Assistant credentials",
                assistant_creds.len()
            );
            credentials.extend(assistant_creds);
        } else if pt == PoolProviderType::Claude {
            let ai_provider_creds =
                ProviderPoolDao::get_by_type(&conn, &PoolProviderType::Anthropic)
                    .map_err(|e| e.to_string())?;
            eprintln!(
                "[SELECT_CREDENTIAL] Assistant: adding {} AI Provider credentials",
                ai_provider_creds.len()
            );
            credentials.extend(ai_provider_creds);
        }

        let recoverable_antigravity: HashMap<String, Option<String>> =
            if pt == PoolProviderType::Antigravity {
                credentials
                    .iter()
                    .filter(|cred| Self::should_auto_recover_antigravity_credential(cred))
                    .map(|cred| (cred.uuid.clone(), cred.check_model_name.clone()))
                    .collect()
            } else {
                HashMap::new()
            };

        drop(conn);

        if !recoverable_antigravity.is_empty() {
            for (uuid, check_model_name) in &recoverable_antigravity {
                self.mark_healthy(db, uuid, check_model_name.as_deref())?;
            }
            for cred in &mut credentials {
                if let Some(check_model_name) = recoverable_antigravity.get(&cred.uuid) {
                    cred.mark_healthy(check_model_name.clone());
                }
            }
        }

        eprintln!(
            "[SELECT_CREDENTIAL] total_credentials={}, model={:?}",
            credentials.len(),
            model
        );

        // 过滤可用的凭证
        let mut available: Vec<_> = credentials
            .into_iter()
            .filter(|c| {
                let is_avail = c.is_available();
                if !is_avail {
                    eprintln!(
                        "[SELECT_CREDENTIAL] credential {} (type={}) is_available={} (is_healthy={}, is_disabled={}, error_count={}, last_error={:?})",
                        c.name.as_deref().unwrap_or("unnamed"),
                        c.provider_type,
                        is_avail,
                        c.is_healthy,
                        c.is_disabled,
                        c.error_count,
                        c.last_error_message
                    );
                } else {
                    eprintln!(
                        "[SELECT_CREDENTIAL] credential {} (type={}) is_available={}",
                        c.name.as_deref().unwrap_or("unnamed"),
                        c.provider_type,
                        is_avail
                    );
                }
                is_avail
            })
            .collect();

        eprintln!(
            "[SELECT_CREDENTIAL] after is_available filter: {}",
            available.len()
        );

        // 如果指定了模型，进一步过滤支持该模型的凭证
        if let Some(m) = model {
            available.retain(|c| {
                let supports = c.supports_model(m);
                eprintln!(
                    "[SELECT_CREDENTIAL] credential {} supports_model({})={}",
                    c.name.as_deref().unwrap_or("unnamed"),
                    m,
                    supports
                );
                supports
            });
        }

        // 过滤客户端兼容的凭证
        available.retain(|c| {
            let compatible = c.is_compatible_with_client(client_type);
            if !compatible {
                eprintln!(
                    "[SELECT_CREDENTIAL] credential {} 不兼容客户端类型 {:?}",
                    c.name.as_deref().unwrap_or("unnamed"),
                    client_type
                );
            }
            compatible
        });

        eprintln!(
            "[SELECT_CREDENTIAL] after client compatibility filter: {}",
            available.len()
        );

        if available.is_empty() {
            return Ok(None);
        }

        // 如果只有一个可用凭证，直接返回
        if available.len() == 1 {
            return Ok(Some(available.into_iter().next().unwrap()));
        }

        // 智能选择：基于权重分数选择最优凭证
        let selected = self.select_best_credential_by_weight(&available);

        Ok(Some(selected))
    }

    fn should_auto_recover_antigravity_credential(cred: &ProviderCredential) -> bool {
        let CredentialData::AntigravityOAuth {
            creds_file_path, ..
        } = &cred.credential
        else {
            return false;
        };

        if cred.is_healthy || Path::new(creds_file_path).exists() {
            return false;
        }

        let last_error = cred.last_error_message.as_deref().unwrap_or_default();
        let is_missing_path_failure = last_error.contains("Failed to load credentials")
            || last_error.contains("No such file or directory");
        if !is_missing_path_failure {
            return false;
        }

        lime_providers::providers::antigravity::AntigravityProvider::default_creds_path().exists()
    }

    /// 带智能降级的凭证选择
    ///
    /// 当 Provider Pool 无可用凭证时，自动从 API Key Provider 降级查找
    ///
    /// # 参数
    /// - `db`: 数据库连接
    /// - `api_key_service`: API Key Provider 服务
    /// - `provider_type`: Provider 类型字符串，如 "assistant", "openai"
    /// - `model`: 可选的模型名称
    /// - `provider_id_hint`: 可选的 provider_id 提示，用于 60+ Provider 直接查找
    /// - `client_type`: 可选的客户端类型，用于凭证兼容性检查
    ///
    /// # 返回
    /// - `Ok(Some(credential))`: 找到可用凭证（来自 Pool 或降级）
    /// - `Ok(None)`: 没有找到任何可用凭证
    /// - `Err(e)`: 查询过程中发生错误
    pub async fn select_credential_with_fallback(
        &self,
        db: &DbConnection,
        api_key_service: &ApiKeyProviderService,
        provider_type: &str,
        model: Option<&str>,
        provider_id_hint: Option<&str>,
        client_type: Option<&lime_core::models::client_type::ClientType>,
    ) -> Result<Option<ProviderCredential>, String> {
        eprintln!(
            "[select_credential_with_fallback] 开始: provider_type={provider_type}, model={model:?}, provider_id_hint={provider_id_hint:?}"
        );

        // Step 1: 尝试从 Provider Pool 选择 (OAuth + API Key)
        if let Some(cred) =
            self.select_credential_with_client_check(db, provider_type, model, client_type)?
        {
            eprintln!(
                "[select_credential_with_fallback] 从 Provider Pool 找到凭证: {:?}",
                cred.name
            );
            return Ok(Some(cred));
        }
        eprintln!("[select_credential_with_fallback] Provider Pool 未找到凭证，尝试智能降级");

        // Step 2: 智能降级到 API Key Provider
        let mut pt = resolve_pool_provider_type_or_default(provider_type);
        let mut resolved_provider_id_hint = provider_id_hint;

        // 对 custom-* 场景优先查询真实 Provider 类型，避免默认按 OpenAI 协议处理
        if is_custom_provider_id(provider_type) {
            resolved_provider_id_hint = Some(provider_type);
        }

        if let Some(custom_provider_id) =
            resolved_provider_id_hint.filter(|id| is_custom_provider_id(id))
        {
            match api_key_service.get_provider(db, custom_provider_id) {
                Ok(Some(provider_with_keys)) => {
                    pt = api_provider_type_to_pool_type(provider_with_keys.provider.provider_type);
                    eprintln!(
                        "[select_credential_with_fallback] custom provider '{}' 真实类型 {:?} -> {:?}",
                        custom_provider_id,
                        provider_with_keys.provider.provider_type,
                        pt
                    );
                }
                Ok(None) => {
                    eprintln!(
                        "[select_credential_with_fallback] custom provider '{custom_provider_id}' 不存在，继续使用解析类型 {pt:?}"
                    );
                }
                Err(e) => {
                    eprintln!(
                        "[select_credential_with_fallback] 查询 custom provider '{custom_provider_id}' 失败: {e}，继续使用解析类型 {pt:?}"
                    );
                }
            }
        }

        eprintln!(
            "[select_credential_with_fallback] 解析 provider_type '{provider_type}' -> {pt:?}"
        );

        // 传入 provider_id_hint 支持 60+ Provider
        eprintln!("[select_credential_with_fallback] 调用 get_fallback_credential");
        if let Some(cred) = api_key_service
            .get_fallback_credential(db, &pt, resolved_provider_id_hint, client_type)
            .await?
        {
            eprintln!(
                "[select_credential_with_fallback] 智能降级成功: {:?}",
                cred.name
            );
            return Ok(Some(cred));
        }

        // Step 3: 都没有找到
        eprintln!(
            "[select_credential_with_fallback] 未找到任何凭证 for provider_type='{provider_type}'"
        );
        Ok(None)
    }

    /// 基于权重分数选择最优凭证
    fn select_best_credential_by_weight(
        &self,
        credentials: &[ProviderCredential],
    ) -> ProviderCredential {
        let now = chrono::Utc::now();

        let mut best_score = f64::MIN;
        let mut best_credential = None;

        for cred in credentials {
            let score = self.calculate_credential_score(cred, now, credentials);
            if score > best_score {
                best_score = score;
                best_credential = Some(cred);
            }
        }

        best_credential.unwrap().clone()
    }

    /// 计算凭证的综合分数（分数越高越优先）
    fn calculate_credential_score(
        &self,
        cred: &ProviderCredential,
        now: chrono::DateTime<chrono::Utc>,
        all_credentials: &[ProviderCredential],
    ) -> f64 {
        let mut score = 0.0;

        // 1. 健康状态权重 (40分)
        if cred.is_healthy {
            score += 40.0;
        } else {
            score -= 20.0; // 不健康的凭证严重扣分
        }

        // 2. 使用频率权重 (30分) - 使用次数越少分数越高
        let max_usage = all_credentials
            .iter()
            .map(|c| c.usage_count)
            .max()
            .unwrap_or(1);
        if max_usage > 0 {
            let usage_ratio = cred.usage_count as f64 / max_usage as f64;
            score += 30.0 * (1.0 - usage_ratio); // 使用越少分数越高
        } else {
            score += 30.0; // 如果都没使用过，给满分
        }

        // 3. 错误率权重 (20分) - 错误越少分数越高
        let total_requests = cred.usage_count + cred.error_count as u64;
        if total_requests > 0 {
            let error_ratio = cred.error_count as f64 / total_requests as f64;
            score += 20.0 * (1.0 - error_ratio); // 错误率越低分数越高
        } else {
            score += 20.0; // 没有历史记录给满分
        }

        // 4. 冷却时间权重 (10分) - 距离上次使用时间越长分数越高
        if let Some(last_used) = &cred.last_used {
            let duration_since_last_use = now.signed_duration_since(*last_used);
            let minutes_since_last_use = duration_since_last_use.num_minutes() as f64;

            // 超过5分钟的冷却时间给满分，否则按比例给分
            let cooldown_score = if minutes_since_last_use >= 5.0 {
                10.0
            } else {
                10.0 * (minutes_since_last_use / 5.0)
            };
            score += cooldown_score;
        } else {
            score += 10.0; // 从未使用过给满分
        }

        score
    }

    /// 记录凭证使用
    pub fn record_usage(&self, db: &DbConnection, uuid: &str) -> Result<(), String> {
        let conn = lime_core::database::lock_db(db)?;
        let cred = ProviderPoolDao::get_by_uuid(&conn, uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Credential not found: {uuid}"))?;

        ProviderPoolDao::update_usage(&conn, uuid, cred.usage_count + 1, Utc::now())
            .map_err(|e| e.to_string())
    }

    /// 标记凭证为健康
    pub fn mark_healthy(
        &self,
        db: &DbConnection,
        uuid: &str,
        check_model: Option<&str>,
    ) -> Result<(), String> {
        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::update_health_status(
            &conn,
            uuid,
            true,
            0,
            None,
            None,
            Some(Utc::now()),
            check_model,
        )
        .map_err(|e| e.to_string())
    }

    /// 标记凭证为不健康
    pub fn mark_unhealthy(
        &self,
        db: &DbConnection,
        uuid: &str,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let conn = lime_core::database::lock_db(db)?;
        let cred = ProviderPoolDao::get_by_uuid(&conn, uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Credential not found: {uuid}"))?;

        let new_error_count = cred.error_count + 1;
        let is_healthy = new_error_count < self.max_error_count;

        ProviderPoolDao::update_health_status(
            &conn,
            uuid,
            is_healthy,
            new_error_count,
            Some(Utc::now()),
            error_message,
            None,
            None,
        )
        .map_err(|e| e.to_string())
    }

    /// 重置凭证计数器
    pub fn reset_counters(&self, db: &DbConnection, uuid: &str) -> Result<(), String> {
        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::reset_counters(&conn, uuid).map_err(|e| e.to_string())
    }

    /// 重置指定类型的所有凭证健康状态
    pub fn reset_health_by_type(
        &self,
        db: &DbConnection,
        provider_type: &str,
    ) -> Result<usize, String> {
        let pt = parse_pool_provider_type(provider_type)?;
        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::reset_health_by_type(&conn, &pt).map_err(|e| e.to_string())
    }

    /// 获取凭证健康状态
    /// Requirements: 3.2
    pub fn get_credential_health(
        &self,
        db: &DbConnection,
        uuid: &str,
    ) -> Result<Option<CredentialHealthInfo>, String> {
        let conn = lime_core::database::lock_db(db)?;
        let cred = ProviderPoolDao::get_by_uuid(&conn, uuid).map_err(|e| e.to_string())?;

        Ok(cred.map(|c| CredentialHealthInfo {
            uuid: c.uuid.clone(),
            name: c.name.clone(),
            provider_type: c.provider_type.to_string(),
            is_healthy: c.is_healthy,
            last_error: c.last_error_message.clone(),
            last_error_time: c.last_error_time.map(|t| t.to_rfc3339()),
            failure_count: c.error_count,
            requires_reauth: c
                .last_error_message
                .as_ref()
                .map(|e| e.contains("invalid_grant") || e.contains("重新授权"))
                .unwrap_or(false),
        }))
    }

    /// 获取所有凭证的健康状态
    /// Requirements: 3.2
    pub fn get_all_credential_health(
        &self,
        db: &DbConnection,
    ) -> Result<Vec<CredentialHealthInfo>, String> {
        let conn = lime_core::database::lock_db(db)?;
        let credentials = ProviderPoolDao::get_all(&conn).map_err(|e| e.to_string())?;

        Ok(credentials
            .into_iter()
            .map(|c| CredentialHealthInfo {
                uuid: c.uuid.clone(),
                name: c.name.clone(),
                provider_type: c.provider_type.to_string(),
                is_healthy: c.is_healthy,
                last_error: c.last_error_message.clone(),
                last_error_time: c.last_error_time.map(|t| t.to_rfc3339()),
                failure_count: c.error_count,
                requires_reauth: c
                    .last_error_message
                    .as_ref()
                    .map(|e| e.contains("invalid_grant") || e.contains("重新授权"))
                    .unwrap_or(false),
            })
            .collect())
    }

    /// 标记凭证为不健康（带详细错误信息）
    /// Requirements: 3.1, 3.2
    pub fn mark_unhealthy_with_details(
        &self,
        db: &DbConnection,
        uuid: &str,
        error: &TokenRefreshError,
    ) -> Result<(), String> {
        let error_message = error.user_message();
        let requires_reauth = error.requires_reauth();

        let conn = lime_core::database::lock_db(db)?;
        let cred = ProviderPoolDao::get_by_uuid(&conn, uuid)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Credential not found: {uuid}"))?;

        let new_error_count = cred.error_count + 1;
        // 如果需要重新授权，直接标记为不健康
        let is_healthy = if requires_reauth {
            false
        } else {
            new_error_count < self.max_error_count
        };

        let error_msg = if requires_reauth {
            format!("[需要重新授权] {error_message}")
        } else {
            error_message
        };

        ProviderPoolDao::update_health_status(
            &conn,
            uuid,
            is_healthy,
            new_error_count,
            Some(Utc::now()),
            Some(&error_msg),
            None,
            None,
        )
        .map_err(|e| e.to_string())
    }

    /// 选择一个健康的凭证
    /// Requirements: 2.4, 3.3, 3.4
    pub fn select_healthy_credential(
        &self,
        db: &DbConnection,
        provider_type: &str,
        model: Option<&str>,
    ) -> Result<ProviderCredential, SelectionError> {
        let pt: PoolProviderType = provider_type
            .parse()
            .map_err(|_| SelectionError::NoCredentials)?;
        let conn = lime_core::database::lock_db(db).map_err(|_| SelectionError::NoCredentials)?;
        let credentials =
            ProviderPoolDao::get_by_type(&conn, &pt).map_err(|_| SelectionError::NoCredentials)?;
        drop(conn);

        if credentials.is_empty() {
            return Err(SelectionError::NoCredentials);
        }

        // 过滤可用的凭证（健康且未禁用）
        let mut available: Vec<_> = credentials
            .iter()
            .filter(|c| c.is_available() && c.is_healthy)
            .collect();

        // 如果指定了模型，进一步过滤支持该模型的凭证
        if let Some(m) = model {
            available.retain(|c| c.supports_model(m));
            if available.is_empty() {
                // 检查是否有凭证支持该模型但不健康
                let unhealthy_supporting: Vec<_> = credentials
                    .iter()
                    .filter(|c| c.supports_model(m) && !c.is_healthy)
                    .collect();

                if !unhealthy_supporting.is_empty() {
                    // 返回不健康凭证的详细信息
                    let details: Vec<CredentialHealthInfo> = unhealthy_supporting
                        .into_iter()
                        .map(|c| CredentialHealthInfo {
                            uuid: c.uuid.clone(),
                            name: c.name.clone(),
                            provider_type: c.provider_type.to_string(),
                            is_healthy: c.is_healthy,
                            last_error: c.last_error_message.clone(),
                            last_error_time: c.last_error_time.map(|t| t.to_rfc3339()),
                            failure_count: c.error_count,
                            requires_reauth: c
                                .last_error_message
                                .as_ref()
                                .map(|e| e.contains("invalid_grant") || e.contains("重新授权"))
                                .unwrap_or(false),
                        })
                        .collect();
                    return Err(SelectionError::AllUnhealthy { details });
                }

                return Err(SelectionError::ModelNotSupported {
                    model: m.to_string(),
                });
            }
        }

        if available.is_empty() {
            // 所有凭证都不健康
            let details: Vec<CredentialHealthInfo> = credentials
                .iter()
                .filter(|c| !c.is_healthy)
                .map(|c| CredentialHealthInfo {
                    uuid: c.uuid.clone(),
                    name: c.name.clone(),
                    provider_type: c.provider_type.to_string(),
                    is_healthy: c.is_healthy,
                    last_error: c.last_error_message.clone(),
                    last_error_time: c.last_error_time.map(|t| t.to_rfc3339()),
                    failure_count: c.error_count,
                    requires_reauth: c
                        .last_error_message
                        .as_ref()
                        .map(|e| e.contains("invalid_grant") || e.contains("重新授权"))
                        .unwrap_or(false),
                })
                .collect();
            return Err(SelectionError::AllUnhealthy { details });
        }

        // 使用轮询策略选择凭证
        let key = format!("{}:{}", provider_type, model.unwrap_or("*"));
        let index = {
            let indices = self.round_robin_index.read().unwrap();
            indices
                .get(&key)
                .map(|i| i.load(std::sync::atomic::Ordering::Relaxed))
                .unwrap_or(0)
        };

        let selected_index = index % available.len();
        let selected = available[selected_index].clone();

        // 更新轮询索引
        {
            let mut indices = self.round_robin_index.write().unwrap();
            indices
                .entry(key)
                .or_insert_with(|| AtomicUsize::new(0))
                .store(index + 1, std::sync::atomic::Ordering::Relaxed);
        }

        Ok(selected)
    }

    /// 执行单个凭证的健康检查
    ///
    /// 如果遇到 401 错误，会自动尝试刷新 token 后重试
    pub async fn check_credential_health(
        &self,
        db: &DbConnection,
        uuid: &str,
    ) -> Result<HealthCheckResult, String> {
        let cred = {
            let conn = lime_core::database::lock_db(db)?;
            ProviderPoolDao::get_by_uuid(&conn, uuid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Credential not found: {uuid}"))?
        };

        let check_model = cred
            .check_model_name
            .clone()
            .unwrap_or_else(|| get_default_check_model(cred.provider_type).to_string());

        let start = std::time::Instant::now();
        let result = self
            .perform_health_check(&cred.credential, &check_model)
            .await;
        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(_) => {
                self.mark_healthy(db, uuid, Some(&check_model))?;
                Ok(HealthCheckResult {
                    uuid: uuid.to_string(),
                    success: true,
                    model: Some(check_model),
                    message: Some("Health check passed".to_string()),
                    duration_ms,
                })
            }
            Err(e) => {
                // 如果是 401 错误，尝试刷新 token 后重试
                if e.contains("401") || e.contains("Unauthorized") {
                    tracing::info!("[健康检查] 检测到 401 错误，尝试刷新 token: {}", uuid);

                    // 尝试刷新 token
                    match self.refresh_credential_token(db, uuid).await {
                        Ok(_) => {
                            tracing::info!("[健康检查] Token 刷新成功，重新检查健康状态");

                            // 重新获取凭证（token 已更新）
                            let updated_cred = {
                                let conn = lime_core::database::lock_db(db)?;
                                ProviderPoolDao::get_by_uuid(&conn, uuid)
                                    .map_err(|e| e.to_string())?
                                    .ok_or_else(|| format!("Credential not found: {uuid}"))?
                            };

                            // 重新执行健康检查
                            let retry_start = std::time::Instant::now();
                            let retry_result = self
                                .perform_health_check(&updated_cred.credential, &check_model)
                                .await;
                            let retry_duration_ms = retry_start.elapsed().as_millis() as u64;

                            match retry_result {
                                Ok(_) => {
                                    self.mark_healthy(db, uuid, Some(&check_model))?;
                                    return Ok(HealthCheckResult {
                                        uuid: uuid.to_string(),
                                        success: true,
                                        model: Some(check_model),
                                        message: Some(
                                            "Health check passed after token refresh".to_string(),
                                        ),
                                        duration_ms: duration_ms + retry_duration_ms,
                                    });
                                }
                                Err(retry_e) => {
                                    tracing::warn!("[健康检查] Token 刷新后仍然失败: {}", retry_e);
                                    self.mark_unhealthy(db, uuid, Some(&retry_e))?;
                                    return Ok(HealthCheckResult {
                                        uuid: uuid.to_string(),
                                        success: false,
                                        model: Some(check_model),
                                        message: Some(retry_e),
                                        duration_ms: duration_ms + retry_duration_ms,
                                    });
                                }
                            }
                        }
                        Err(refresh_err) => {
                            tracing::warn!("[健康检查] Token 刷新失败: {}", refresh_err);
                            // Token 刷新失败，返回原始错误
                            self.mark_unhealthy(db, uuid, Some(&e))?;
                            return Ok(HealthCheckResult {
                                uuid: uuid.to_string(),
                                success: false,
                                model: Some(check_model),
                                message: Some(format!("{e} (Token 刷新失败: {refresh_err})")),
                                duration_ms,
                            });
                        }
                    }
                }

                self.mark_unhealthy(db, uuid, Some(&e))?;
                Ok(HealthCheckResult {
                    uuid: uuid.to_string(),
                    success: false,
                    model: Some(check_model),
                    message: Some(e),
                    duration_ms,
                })
            }
        }
    }

    /// 执行指定类型的所有凭证健康检查
    pub async fn check_type_health(
        &self,
        db: &DbConnection,
        provider_type: &str,
    ) -> Result<Vec<HealthCheckResult>, String> {
        let pt = parse_pool_provider_type(provider_type)?;
        let credentials = {
            let conn = lime_core::database::lock_db(db)?;
            ProviderPoolDao::get_by_type(&conn, &pt).map_err(|e| e.to_string())?
        };

        let mut results = Vec::new();
        for cred in credentials {
            if cred.is_disabled || !cred.check_health {
                continue;
            }

            let result = self.check_credential_health(db, &cred.uuid).await?;
            results.push(result);
        }

        Ok(results)
    }

    /// 执行实际的健康检查请求
    async fn perform_health_check(
        &self,
        credential: &CredentialData,
        model: &str,
    ) -> Result<(), String> {
        // 根据凭证类型构建测试请求
        match credential {
            CredentialData::KiroOAuth { creds_file_path } => {
                self.check_kiro_health(creds_file_path, model).await
            }
            CredentialData::GeminiOAuth {
                creds_file_path,
                project_id,
            } => {
                self.check_gemini_health(creds_file_path, project_id.as_deref(), model)
                    .await
            }
            CredentialData::AntigravityOAuth {
                creds_file_path,
                project_id,
            } => {
                self.check_antigravity_health(creds_file_path, project_id.as_deref(), model)
                    .await
            }
            CredentialData::OpenAIKey { api_key, base_url } => {
                self.check_openai_health(api_key, base_url.as_deref(), model)
                    .await
            }
            CredentialData::ClaudeKey { api_key, base_url } => {
                self.check_claude_health(api_key, base_url.as_deref(), model)
                    .await
            }
            CredentialData::VertexKey {
                api_key, base_url, ..
            } => {
                self.check_vertex_health(api_key, base_url.as_deref(), model)
                    .await
            }
            CredentialData::GeminiApiKey {
                api_key, base_url, ..
            } => {
                self.check_gemini_api_key_health(api_key, base_url.as_deref(), model)
                    .await
            }
            CredentialData::CodexOAuth {
                creds_file_path,
                api_base_url,
            } => {
                self.check_codex_health(creds_file_path, api_base_url.as_deref(), model)
                    .await
            }
            CredentialData::ClaudeOAuth { creds_file_path } => {
                self.check_claude_oauth_health(creds_file_path, model).await
            }
            CredentialData::AnthropicKey { api_key, base_url } => {
                // Anthropic API Key 使用与 Claude API Key 相同的健康检查逻辑
                self.check_claude_health(api_key, base_url.as_deref(), model)
                    .await
            }
        }
    }

    /// 将技术错误转换为用户友好的错误信息
    fn format_user_friendly_error(&self, error: &str, provider_type: &str) -> String {
        if error.contains("No client_id") {
            format!("OAuth 配置不完整：缺少必要的认证参数。\n💡 解决方案：\n1. 检查 {provider_type} OAuth 凭证配置是否完整\n2. 如问题持续，建议删除后重新添加此凭证\n3. 或者切换到其他可用的凭证")
        } else if error.contains("请求失败") || error.contains("error sending request") {
            format!("网络连接失败，无法访问 {provider_type} 服务。\n💡 解决方案：\n1. 检查网络连接是否正常\n2. 确认防火墙或代理设置\n3. 稍后重试，如问题持续请联系网络管理员")
        } else if error.contains("HTTP 401") || error.contains("HTTP 403") {
            format!("{provider_type} 认证失败，凭证可能已过期或无效。\n💡 解决方案：\n1. 点击\"刷新\"按钮尝试更新 Token\n2. 如刷新失败，请删除后重新添加此凭证\n3. 检查账户权限是否正常")
        } else if error.contains("HTTP 429") {
            format!("{provider_type} 请求频率过高，已被限流。\n💡 解决方案：\n1. 稍等几分钟后再次尝试\n2. 考虑添加更多凭证分散负载")
        } else if error.contains("HTTP 500")
            || error.contains("HTTP 502")
            || error.contains("HTTP 503")
        {
            format!("{provider_type} 服务暂时不可用。\n💡 解决方案：\n1. 这通常是服务提供方的临时问题\n2. 请稍后重试\n3. 如问题持续，可尝试其他凭证")
        } else if error.contains("读取凭证文件失败") || error.contains("解析凭证失败")
        {
            "凭证文件损坏或不可读。\n💡 解决方案：\n1. 凭证文件可能已损坏\n2. 建议删除此凭证后重新添加\n3. 确保文件权限正确且格式为有效的 JSON".to_string()
        } else {
            // 对于其他未识别的错误，提供通用建议
            format!("操作失败：{error}\n💡 建议：\n1. 检查网络连接和凭证状态\n2. 尝试刷新 Token 或重新添加凭证\n3. 如问题持续，请联系技术支持")
        }
    }

    // Kiro OAuth 健康检查
    async fn check_kiro_health(&self, creds_path: &str, model: &str) -> Result<(), String> {
        tracing::debug!("[KIRO HEALTH] 开始健康检查，凭证路径: {}", creds_path);

        // 使用 KiroProvider 加载凭证（包括 clientIdHash 文件）
        let mut provider = KiroProvider::new();
        provider
            .load_credentials_from_path(creds_path)
            .await
            .map_err(|e| self.format_user_friendly_error(&format!("加载凭证失败: {e}"), "Kiro"))?;

        let access_token = provider
            .credentials
            .access_token
            .as_ref()
            .ok_or_else(|| "凭证中缺少 access_token".to_string())?;

        let health_check_url = provider.get_health_check_url();

        // 获取 modelId 映射
        let model_id = match model {
            "claude-opus-4-5" | "claude-opus-4-5-20251101" => "claude-opus-4.5",
            "claude-haiku-4-5" => "claude-haiku-4.5",
            "claude-sonnet-4-5" | "claude-sonnet-4-5-20250929" => "CLAUDE_SONNET_4_5_20250929_V1_0",
            "claude-sonnet-4-20250514" => "CLAUDE_SONNET_4_20250514_V1_0",
            "claude-3-7-sonnet-20250219" => "CLAUDE_3_7_SONNET_20250219_V1_0",
            _ => "claude-haiku-4.5", // 默认使用 haiku
        };

        tracing::debug!("[KIRO HEALTH] 健康检查 URL: {}", health_check_url);
        tracing::debug!("[KIRO HEALTH] 使用模型: {} -> {}", model, model_id);

        // 构建与实际 API 调用相同格式的测试请求（参考 AIClient-2-API 实现）
        let conversation_id = uuid::Uuid::new_v4().to_string();
        let mut request_body = serde_json::json!({
            "conversationState": {
                "chatTriggerType": "MANUAL",
                "conversationId": conversation_id,
                "currentMessage": {
                    "userInputMessage": {
                        "content": "Say OK",
                        "modelId": model_id,
                        "origin": "AI_EDITOR"
                    }
                }
            }
        });

        // 如果是 social 认证方式，需要添加 profileArn
        if provider.credentials.auth_method.as_deref() == Some("social") {
            if let Some(profile_arn) = &provider.credentials.profile_arn {
                request_body["profileArn"] = serde_json::json!(profile_arn);
            }
        }

        tracing::debug!("[KIRO HEALTH] 请求体已构建");

        let response = self
            .client
            .post(&health_check_url)
            .bearer_auth(access_token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("x-amz-user-agent", "aws-sdk-js/1.0.7 KiroIDE-0.1.25")
            .header("user-agent", "aws-sdk-js/1.0.7 ua/2.1 os/macos#14.0 lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.7 m/E KiroIDE-0.1.25")
            .header("amz-sdk-invocation-id", uuid::Uuid::new_v4().to_string())
            .header("amz-sdk-request", "attempt=1; max=1")
            .header("x-amzn-kiro-agent-mode", "vibe")
            .json(&request_body)
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| self.format_user_friendly_error(&format!("请求失败: {e}"), "Kiro"))?;

        let status = response.status();
        tracing::info!("[KIRO HEALTH] 响应状态: {}", status);

        if status.is_success() {
            tracing::info!("[KIRO HEALTH] 健康检查成功");
            Ok(())
        } else {
            let body_text = response.text().await.unwrap_or_default();
            tracing::warn!("[KIRO HEALTH] 健康检查失败: {} - {}", status, body_text);
            let error_msg = format!("HTTP {status}: {body_text}");
            Err(self.format_user_friendly_error(&error_msg, "Kiro"))
        }
    }

    // Gemini OAuth 健康检查
    // 使用 cloudcode-pa.googleapis.com API（与 Gemini CLI 兼容）
    // 使用 loadCodeAssist 接口进行健康检查，这是最简单可靠的方式
    async fn check_gemini_health(
        &self,
        creds_path: &str,
        _project_id: Option<&str>,
        _model: &str,
    ) -> Result<(), String> {
        let creds_content =
            std::fs::read_to_string(creds_path).map_err(|e| format!("读取凭证文件失败: {e}"))?;
        let creds: serde_json::Value =
            serde_json::from_str(&creds_content).map_err(|e| format!("解析凭证失败: {e}"))?;

        let access_token = creds["access_token"]
            .as_str()
            .ok_or_else(|| "凭证中缺少 access_token".to_string())?;

        // 使用 loadCodeAssist 接口进行健康检查
        // 这个接口用于获取项目信息，是最简单可靠的健康检查方式
        let url = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

        let request_body = serde_json::json!({
            "cloudaicompanionProject": "",
            "metadata": {
                "ideType": "IDE_UNSPECIFIED",
                "platform": "PLATFORM_UNSPECIFIED",
                "pluginType": "GEMINI",
                "duetProject": ""
            }
        });

        let response = self
            .client
            .post(url)
            .bearer_auth(access_token)
            .header("Content-Type", "application/json")
            .json(&request_body)
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!("HTTP {status} - {body}"))
        }
    }

    // Antigravity OAuth 健康检查
    async fn check_antigravity_health(
        &self,
        creds_path: &str,
        _project_id: Option<&str>,
        _model: &str,
    ) -> Result<(), String> {
        let creds_content =
            std::fs::read_to_string(creds_path).map_err(|e| format!("读取凭证文件失败: {e}"))?;
        let creds: serde_json::Value =
            serde_json::from_str(&creds_content).map_err(|e| format!("解析凭证失败: {e}"))?;

        let access_token = creds["access_token"]
            .as_str()
            .ok_or_else(|| "凭证中缺少 access_token".to_string())?;

        // 使用 fetchAvailableModels 作为健康检查
        let url =
            "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels";

        let response = self
            .client
            .post(url)
            .bearer_auth(access_token)
            .header("User-Agent", "antigravity/1.11.5 windows/amd64")
            .json(&serde_json::json!({}))
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("HTTP {}", response.status()))
        }
    }

    // OpenAI API 健康检查
    // 与 OpenAI Provider 保持一致的 URL 处理逻辑
    fn is_version_path_segment(segment: &str) -> bool {
        segment.starts_with('v')
            && segment.len() >= 2
            && segment[1..].chars().all(|c| c.is_ascii_digit())
    }

    fn build_openai_url_from_base(base_url: &str, endpoint: &str) -> String {
        let base = base_url.trim_end_matches('/');
        let has_version = base
            .rsplit('/')
            .next()
            .map(Self::is_version_path_segment)
            .unwrap_or(false);

        if has_version {
            format!("{base}/{endpoint}")
        } else {
            format!("{base}/v1/{endpoint}")
        }
    }

    fn parent_base_url(base_url: &str) -> Option<String> {
        let base = base_url.trim();
        if base.is_empty() {
            return None;
        }

        let mut url = reqwest::Url::parse(base)
            .or_else(|_| reqwest::Url::parse(&format!("http://{base}")))
            .ok()?;

        let path = url.path().trim_end_matches('/');
        if path.is_empty() || path == "/" {
            return None;
        }

        let mut segments: Vec<&str> = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if segments.is_empty() {
            return None;
        }
        segments.pop();

        let new_path = if segments.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", segments.join("/"))
        };

        url.set_path(&new_path);
        url.set_query(None);
        url.set_fragment(None);

        Some(url.to_string().trim_end_matches('/').to_string())
    }

    fn push_openai_url_candidates(urls: &mut Vec<String>, base_url: &str, endpoint: &str) {
        if base_url.trim().is_empty() {
            return;
        }

        let primary = Self::build_openai_url_from_base(base_url, endpoint);
        if !urls.iter().any(|url| url == &primary) {
            urls.push(primary.clone());
        }

        if primary.contains("/v1/") {
            let no_v1 = primary.replacen("/v1/", "/", 1);
            if !urls.iter().any(|url| url == &no_v1) {
                urls.push(no_v1);
            }
        }
    }

    fn build_openai_health_check_urls(base_url: Option<&str>) -> Vec<String> {
        let raw_base = base_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("https://api.openai.com");
        let normalized_base = raw_base.trim_end_matches('/').to_string();

        let mut urls = Vec::new();
        let mut visited = HashSet::new();
        visited.insert(normalized_base.clone());

        Self::push_openai_url_candidates(&mut urls, &normalized_base, "chat/completions");

        let mut current = normalized_base;
        for _ in 0..6 {
            let Some(parent) = Self::parent_base_url(&current) else {
                break;
            };
            if !visited.insert(parent.clone()) {
                break;
            }
            Self::push_openai_url_candidates(&mut urls, &parent, "chat/completions");
            current = parent;
        }

        if urls.is_empty() {
            urls.push("https://api.openai.com/v1/chat/completions".to_string());
        }
        urls
    }

    async fn check_openai_health(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        model: &str,
    ) -> Result<(), String> {
        let urls = Self::build_openai_health_check_urls(base_url);

        let request_body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "Say OK"}],
            "max_tokens": 10
        });

        let mut last_error: Option<String> = None;

        for (index, url) in urls.iter().enumerate() {
            tracing::debug!("[HEALTH_CHECK] OpenAI API URL: {}, model: {}", url, model);

            let response = match self
                .client
                .post(url)
                .bearer_auth(api_key)
                .json(&request_body)
                .timeout(self.health_check_timeout)
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    let message = format!("请求失败: {error}");
                    last_error = Some(message.clone());
                    if index + 1 < urls.len() {
                        tracing::warn!(
                            "[HEALTH_CHECK] OpenAI API URL {} 请求失败，继续尝试后续候选: {}",
                            url,
                            message
                        );
                        continue;
                    }
                    return Err(message);
                }
            };

            if response.status().is_success() {
                return Ok(());
            }

            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let message = format!(
                "HTTP {} - {}",
                status,
                body.chars().take(200).collect::<String>()
            );
            last_error = Some(message.clone());

            let can_retry_next_url = matches!(
                status,
                reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::METHOD_NOT_ALLOWED
            );
            if can_retry_next_url && index + 1 < urls.len() {
                tracing::warn!(
                    "[HEALTH_CHECK] OpenAI API URL {} 返回 {}，尝试下一个候选 URL",
                    url,
                    status
                );
                continue;
            }

            return Err(message);
        }

        Err(last_error.unwrap_or_else(|| "OpenAI 健康检查失败".to_string()))
    }

    // Claude API 健康检查
    // 与 ClaudeCustomProvider 保持一致的 URL 处理逻辑
    async fn check_claude_health(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        model: &str,
    ) -> Result<(), String> {
        // 与 ClaudeCustomProvider::get_base_url() 保持一致
        // base_url 应该不带 /v1，在这里拼接
        // 但为了兼容用户可能输入带 /v1 的情况，这里做智能处理
        let base = base_url.unwrap_or("https://api.anthropic.com");
        let base = base.trim_end_matches('/');

        // 如果用户输入了带 /v1 的 URL，直接使用；否则拼接 /v1
        let url = if base.ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}/v1/messages")
        };

        let request_body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "Say OK"}],
            "max_tokens": 10
        });

        tracing::debug!("[HEALTH_CHECK] Claude API URL: {}, model: {}", url, model);

        let runtime_spec = infer_managed_runtime_spec(ApiProviderType::Anthropic, base);
        let auth_value = runtime_spec
            .auth_prefix
            .map(|prefix| format!("{prefix} {api_key}"))
            .unwrap_or_else(|| api_key.to_string());

        let mut request = self
            .client
            .post(&url)
            .header(runtime_spec.auth_header, auth_value)
            .json(&request_body)
            .timeout(self.health_check_timeout);

        for (name, value) in runtime_spec.extra_headers {
            request = request.header(*name, *value);
        }

        let response = request.send().await.map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "HTTP {} - {}",
                status,
                body.chars().take(200).collect::<String>()
            ))
        }
    }

    // Vertex AI 健康检查
    async fn check_vertex_health(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        model: &str,
    ) -> Result<(), String> {
        let base = base_url.unwrap_or("https://generativelanguage.googleapis.com/v1beta");
        let url = format!("{base}/models/{model}:generateContent");

        let request_body = serde_json::json!({
            "contents": [{"role": "user", "parts": [{"text": "Say OK"}]}],
            "generationConfig": {"maxOutputTokens": 10}
        });

        let response = self
            .client
            .post(&url)
            .header("x-goog-api-key", api_key)
            .json(&request_body)
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("HTTP {}", response.status()))
        }
    }

    // Gemini API Key 健康检查
    async fn check_gemini_api_key_health(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        model: &str,
    ) -> Result<(), String> {
        let base = base_url.unwrap_or("https://generativelanguage.googleapis.com");
        let url = format!("{base}/v1beta/models/{model}:generateContent");

        let request_body = serde_json::json!({
            "contents": [{"role": "user", "parts": [{"text": "Say OK"}]}],
            "generationConfig": {"maxOutputTokens": 10}
        });

        let response = self
            .client
            .post(&url)
            .header("x-goog-api-key", api_key)
            .json(&request_body)
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("HTTP {}", response.status()))
        }
    }

    // Codex 健康检查
    // 支持 Yunyi 等代理使用 responses API 格式
    async fn check_codex_health(
        &self,
        creds_path: &str,
        override_base_url: Option<&str>,
        model: &str,
    ) -> Result<(), String> {
        use lime_providers::providers::codex::CodexProvider;

        let mut provider = CodexProvider::new();
        provider
            .load_credentials_from_path(creds_path)
            .await
            .map_err(|e| format!("加载 Codex 凭证失败: {e}"))?;

        let token = provider
            .ensure_valid_token()
            .await
            .map_err(|e| format!("获取 Codex Token 失败: 配置错误，请检查凭证设置。详情：{e}"))?;

        // 优先使用 override_base_url（来自 CredentialData），其次使用凭证文件中的配置
        let base_url = override_base_url
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                provider
                    .credentials
                    .api_base_url
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
            });

        // 检查是否使用 API Key 模式（如果有 api_key 且没有 refresh_token/access_token）
        let is_api_key_mode = provider
            .credentials
            .api_key
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
            && provider.credentials.refresh_token.is_none();

        // API Key 模式使用 chat/completions API，OAuth 模式使用 responses API
        if is_api_key_mode && base_url.is_none() {
            // API Key 直连 OpenAI：使用 chat/completions API
            return self.check_openai_health(&token, None, model).await;
        }

        // OAuth 模式或有自定义 base_url：使用 responses API
        let url = match base_url {
            Some(base) => CodexProvider::build_responses_url(base),
            None => "https://api.openai.com/v1/responses".to_string(),
        };

        // Codex/Yunyi 使用 responses API 格式；云驿等代理要求 stream 必须为 true
        let request_body = serde_json::json!({
            "model": model,
            "input": [{
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "Say OK"}]
            }],
            "max_output_tokens": 10,
            "stream": true
        });

        tracing::debug!(
            "[HEALTH_CHECK] Codex responses API URL: {}, model: {}",
            url,
            model
        );

        let response = self
            .client
            .post(&url)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Openai-Beta", "responses=experimental")
            .header("Originator", "codex_cli_rs")
            .header("Session_id", uuid::Uuid::new_v4().to_string())
            .header("Conversation_id", uuid::Uuid::new_v4().to_string())
            .header(
                "User-Agent",
                "codex_cli_rs/0.77.0 (Lime health check; Mac OS; arm64)",
            )
            .json(&request_body)
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "HTTP {} - {}",
                status,
                body.chars().take(200).collect::<String>()
            ))
        }
    }

    // Claude OAuth 健康检查
    async fn check_claude_oauth_health(&self, creds_path: &str, model: &str) -> Result<(), String> {
        use lime_providers::providers::claude_oauth::ClaudeOAuthProvider;

        let mut provider = ClaudeOAuthProvider::new();
        provider
            .load_credentials_from_path(creds_path)
            .await
            .map_err(|e| format!("加载 Claude OAuth 凭证失败: {e}"))?;

        let token = provider
            .ensure_valid_token()
            .await
            .map_err(|e| format!("获取 Claude OAuth Token 失败: {e}"))?;

        // 使用 Anthropic API 进行健康检查
        let url = "https://api.anthropic.com/v1/messages";
        let request_body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "Say OK"}],
            "max_tokens": 10
        });

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {token}"))
            .header("anthropic-version", "2023-06-01")
            .json(&request_body)
            .timeout(self.health_check_timeout)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("HTTP {}", response.status()))
        }
    }

    /// 获取 OAuth 凭证状态
    pub fn get_oauth_status(
        &self,
        creds_path: &str,
        provider_type: &str,
    ) -> Result<OAuthStatus, String> {
        let content =
            std::fs::read_to_string(creds_path).map_err(|e| format!("读取凭证文件失败: {e}"))?;
        let creds: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("解析凭证文件失败: {e}"))?;

        let has_api_key = creds
            .get("apiKey")
            .or_else(|| creds.get("api_key"))
            .map(|v| v.as_str().is_some())
            .unwrap_or(false);

        let has_oauth_access_token = creds
            .get("accessToken")
            .or_else(|| creds.get("access_token"))
            .map(|v| v.as_str().is_some())
            .unwrap_or(false);

        let has_access_token = has_oauth_access_token || has_api_key;

        let has_refresh_token = creds
            .get("refreshToken")
            .or_else(|| creds.get("refresh_token"))
            .map(|v| v.as_str().is_some())
            .unwrap_or(false);

        // 检查 token 是否有效（根据 expiry_date 判断）
        let (is_token_valid, expiry_info) = match provider_type {
            "kiro" => {
                let expires_at = creds
                    .get("expiresAt")
                    .or_else(|| creds.get("expires_at"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                // Kiro 没有标准的过期时间字段，假设有 access_token 就有效
                (has_access_token, expires_at)
            }

            "codex" => {
                // Codex: 兼容 OAuth token 或 Codex CLI 的 API Key 登录
                if has_api_key {
                    (true, None)
                } else {
                    let expires_at = creds
                        .get("expiresAt")
                        .or_else(|| creds.get("expires_at"))
                        .or_else(|| creds.get("expired"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    (has_oauth_access_token, expires_at)
                }
            }
            _ => (has_access_token, None),
        };

        Ok(OAuthStatus {
            has_access_token,
            has_refresh_token,
            is_token_valid,
            expiry_info,
            creds_path: creds_path.to_string(),
        })
    }

    /// 刷新 OAuth Token (Kiro)
    ///
    /// 使用副本文件中的凭证进行刷新，副本文件应包含完整的 client_id/client_secret。
    /// 支持多账号场景，每个副本文件完全独立。
    pub async fn refresh_kiro_token(&self, creds_path: &str) -> Result<String, String> {
        let mut provider = lime_providers::providers::kiro::KiroProvider::new();
        provider
            .load_credentials_from_path(creds_path)
            .await
            .map_err(|e| self.format_user_friendly_error(&format!("加载凭证失败: {e}"), "Kiro"))?;

        // 使用副本文件中的凭证刷新 Token
        provider
            .refresh_token()
            .await
            .map_err(|e| self.format_user_friendly_error(&format!("刷新 Token 失败: {e}"), "Kiro"))
    }

    /// 刷新 OAuth Token (Gemini)
    pub async fn refresh_gemini_token(&self, creds_path: &str) -> Result<String, String> {
        let mut provider = lime_providers::providers::gemini::GeminiProvider::new();
        provider
            .load_credentials_from_path(creds_path)
            .await
            .map_err(|e| format!("加载凭证失败: {e}"))?;
        provider
            .refresh_token()
            .await
            .map_err(|e| format!("刷新 Token 失败: {e}"))
    }

    /// 刷新 OAuth Token (Antigravity)
    pub async fn refresh_antigravity_token(&self, creds_path: &str) -> Result<String, String> {
        let mut provider = lime_providers::providers::antigravity::AntigravityProvider::new();
        provider
            .load_credentials_from_path(creds_path)
            .await
            .map_err(|e| format!("加载凭证失败: {e}"))?;
        provider
            .refresh_token()
            .await
            .map_err(|e| format!("刷新 Token 失败: {e}"))
    }

    /// 刷新凭证池中指定凭证的 OAuth Token
    pub async fn refresh_credential_token(
        &self,
        db: &DbConnection,
        uuid: &str,
    ) -> Result<String, String> {
        let cred = {
            let conn = lime_core::database::lock_db(db)?;
            ProviderPoolDao::get_by_uuid(&conn, uuid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Credential not found: {uuid}"))?
        };

        match &cred.credential {
            CredentialData::KiroOAuth { creds_file_path } => {
                self.refresh_kiro_token(creds_file_path).await
            }
            CredentialData::GeminiOAuth {
                creds_file_path, ..
            } => self.refresh_gemini_token(creds_file_path).await,
            CredentialData::AntigravityOAuth {
                creds_file_path, ..
            } => self.refresh_antigravity_token(creds_file_path).await,
            _ => Err("此凭证类型不支持 Token 刷新".to_string()),
        }
    }

    /// 获取凭证池中指定凭证的 OAuth 状态
    pub fn get_credential_oauth_status(
        &self,
        db: &DbConnection,
        uuid: &str,
    ) -> Result<OAuthStatus, String> {
        let cred = {
            let conn = lime_core::database::lock_db(db)?;
            ProviderPoolDao::get_by_uuid(&conn, uuid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Credential not found: {uuid}"))?
        };

        let creds_path = get_oauth_creds_path(&cred.credential)
            .ok_or_else(|| "此凭证类型不是 OAuth 凭证".to_string())?;

        self.get_oauth_status(&creds_path, &cred.provider_type.to_string())
    }

    /// 添加带来源的凭证
    pub fn add_credential_with_source(
        &self,
        db: &DbConnection,
        provider_type: &str,
        credential: CredentialData,
        name: Option<String>,
        check_health: Option<bool>,
        check_model_name: Option<String>,
        source: lime_core::models::provider_pool_model::CredentialSource,
    ) -> Result<ProviderCredential, String> {
        let pt = parse_pool_provider_type(provider_type)?;

        let mut cred = ProviderCredential::new_with_source(pt, credential, source);
        cred.name = name;
        cred.check_health = check_health.unwrap_or(true);
        cred.check_model_name = check_model_name;

        let conn = lime_core::database::lock_db(db)?;
        ProviderPoolDao::insert(&conn, &cred).map_err(|e| e.to_string())?;

        Ok(cred)
    }

    /// 迁移 Private 配置到凭证池
    ///
    /// 从 providers 配置中读取单个凭证配置，迁移到凭证池中并标记为 Private 来源
    pub fn migrate_private_config(
        &self,
        db: &DbConnection,
        config: &lime_core::config::Config,
    ) -> Result<MigrationResult, String> {
        use lime_core::config::expand_tilde;
        use lime_core::models::provider_pool_model::CredentialSource;

        let mut result = MigrationResult::default();

        // 迁移 Kiro 凭证
        if config.providers.kiro.enabled {
            if let Some(creds_path) = &config.providers.kiro.credentials_path {
                let expanded_path = expand_tilde(creds_path);
                let expanded_path_str = expanded_path.to_string_lossy().to_string();
                if expanded_path.exists() {
                    // 检查是否已存在相同路径的凭证
                    if !self.credential_exists_by_path(db, &expanded_path_str)? {
                        match self.add_credential_with_source(
                            db,
                            "kiro",
                            CredentialData::KiroOAuth {
                                creds_file_path: expanded_path_str.clone(),
                            },
                            Some("Private Kiro".to_string()),
                            Some(true),
                            None,
                            CredentialSource::Private,
                        ) {
                            Ok(_) => result.migrated_count += 1,
                            Err(e) => result.errors.push(format!("Kiro: {e}")),
                        }
                    } else {
                        result.skipped_count += 1;
                    }
                }
            }
        }

        // 迁移 Gemini 凭证
        if config.providers.gemini.enabled {
            if let Some(creds_path) = &config.providers.gemini.credentials_path {
                let expanded_path = expand_tilde(creds_path);
                let expanded_path_str = expanded_path.to_string_lossy().to_string();
                if expanded_path.exists() {
                    if !self.credential_exists_by_path(db, &expanded_path_str)? {
                        match self.add_credential_with_source(
                            db,
                            "gemini",
                            CredentialData::GeminiOAuth {
                                creds_file_path: expanded_path_str.clone(),
                                project_id: config.providers.gemini.project_id.clone(),
                            },
                            Some("Private Gemini".to_string()),
                            Some(true),
                            None,
                            CredentialSource::Private,
                        ) {
                            Ok(_) => result.migrated_count += 1,
                            Err(e) => result.errors.push(format!("Gemini: {e}")),
                        }
                    } else {
                        result.skipped_count += 1;
                    }
                }
            }
        }

        // 迁移 OpenAI 凭证
        if config.providers.openai.enabled {
            if let Some(api_key) = &config.providers.openai.api_key {
                if !self.credential_exists_by_api_key(db, api_key)? {
                    match self.add_credential_with_source(
                        db,
                        "openai",
                        CredentialData::OpenAIKey {
                            api_key: api_key.clone(),
                            base_url: config.providers.openai.base_url.clone(),
                        },
                        Some("Private OpenAI".to_string()),
                        Some(true),
                        None,
                        CredentialSource::Private,
                    ) {
                        Ok(_) => result.migrated_count += 1,
                        Err(e) => result.errors.push(format!("OpenAI: {e}")),
                    }
                } else {
                    result.skipped_count += 1;
                }
            }
        }

        // 迁移 Claude 凭证
        if config.providers.claude.enabled {
            if let Some(api_key) = &config.providers.claude.api_key {
                if !self.credential_exists_by_api_key(db, api_key)? {
                    match self.add_credential_with_source(
                        db,
                        "claude",
                        CredentialData::ClaudeKey {
                            api_key: api_key.clone(),
                            base_url: config.providers.claude.base_url.clone(),
                        },
                        Some("Private Claude".to_string()),
                        Some(true),
                        None,
                        CredentialSource::Private,
                    ) {
                        Ok(_) => result.migrated_count += 1,
                        Err(e) => result.errors.push(format!("Claude: {e}")),
                    }
                } else {
                    result.skipped_count += 1;
                }
            }
        }

        Ok(result)
    }

    /// 检查是否存在相同路径的凭证
    fn credential_exists_by_path(&self, db: &DbConnection, path: &str) -> Result<bool, String> {
        let conn = lime_core::database::lock_db(db)?;
        let all_creds = ProviderPoolDao::get_all(&conn).map_err(|e| e.to_string())?;

        for cred in all_creds {
            if let Some(cred_path) = get_oauth_creds_path(&cred.credential) {
                if cred_path == path {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// 检查是否存在相同 API Key 的凭证
    fn credential_exists_by_api_key(
        &self,
        db: &DbConnection,
        api_key: &str,
    ) -> Result<bool, String> {
        let conn = lime_core::database::lock_db(db)?;
        let all_creds = ProviderPoolDao::get_all(&conn).map_err(|e| e.to_string())?;

        for cred in all_creds {
            match &cred.credential {
                CredentialData::OpenAIKey { api_key: key, .. }
                | CredentialData::ClaudeKey { api_key: key, .. } => {
                    if key == api_key {
                        return Ok(true);
                    }
                }
                _ => {}
            }
        }
        Ok(false)
    }
}

/// 迁移结果
#[derive(Debug, Clone, Default)]
pub struct MigrationResult {
    /// 成功迁移的凭证数量
    pub migrated_count: usize,
    /// 跳过的凭证数量（已存在）
    pub skipped_count: usize,
    /// 错误信息列表
    pub errors: Vec<String>,
}

// ==================== 测试模块 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::api_key_provider::ApiProviderType;
    use lime_core::database::schema::create_tables;
    use rusqlite::Connection;
    use std::ffi::OsString;
    use std::sync::{Arc, Mutex, OnceLock};
    use tempfile::tempdir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        values: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvGuard {
        fn set(entries: &[(&'static str, OsString)]) -> Self {
            let mut values = Vec::new();
            for (key, value) in entries {
                values.push((*key, std::env::var_os(key)));
                std::env::set_var(key, value);
            }
            Self { values }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, previous) in self.values.drain(..) {
                if let Some(value) = previous {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_tables(&conn).expect("create tables");
        Arc::new(Mutex::new(conn))
    }

    // ==================== Property 3: 不健康凭证排除 ====================
    // Feature: antigravity-token-refresh, Property 3: 不健康凭证排除
    // Validates: Requirements 2.4, 3.3

    #[test]
    fn test_credential_health_info_creation() {
        let info = CredentialHealthInfo {
            uuid: "test-uuid".to_string(),
            name: Some("Test Credential".to_string()),
            provider_type: "antigravity".to_string(),
            is_healthy: false,
            last_error: Some("Token refresh failed".to_string()),
            last_error_time: Some("2024-01-01T00:00:00Z".to_string()),
            failure_count: 3,
            requires_reauth: true,
        };

        assert_eq!(info.uuid, "test-uuid");
        assert!(!info.is_healthy);
        assert!(info.requires_reauth);
        assert_eq!(info.failure_count, 3);
    }

    #[test]
    fn test_selection_error_no_credentials() {
        let error = SelectionError::NoCredentials;
        // 验证可以序列化
        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("NoCredentials"));
    }

    #[test]
    fn test_selection_error_all_unhealthy() {
        let details = vec![CredentialHealthInfo {
            uuid: "test-uuid".to_string(),
            name: Some("Test".to_string()),
            provider_type: "antigravity".to_string(),
            is_healthy: false,
            last_error: Some("invalid_grant".to_string()),
            last_error_time: None,
            failure_count: 1,
            requires_reauth: true,
        }];

        let error = SelectionError::AllUnhealthy { details };
        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("AllUnhealthy"));
        assert!(json.contains("invalid_grant"));
    }

    #[test]
    fn test_selection_error_model_not_supported() {
        let error = SelectionError::ModelNotSupported {
            model: "gpt-5".to_string(),
        };
        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("ModelNotSupported"));
        assert!(json.contains("gpt-5"));
    }

    // ==================== Property 4: 健康状态记录完整性 ====================
    // Feature: antigravity-token-refresh, Property 4: 健康状态记录完整性
    // Validates: Requirements 3.2

    #[test]
    fn test_credential_health_info_requires_reauth_detection() {
        // 测试 invalid_grant 检测
        let info_with_invalid_grant = CredentialHealthInfo {
            uuid: "test".to_string(),
            name: None,
            provider_type: "antigravity".to_string(),
            is_healthy: false,
            last_error: Some("Token refresh failed: invalid_grant".to_string()),
            last_error_time: Some(chrono::Utc::now().to_rfc3339()),
            failure_count: 1,
            requires_reauth: true,
        };
        assert!(info_with_invalid_grant.requires_reauth);

        // 测试重新授权检测
        let info_with_reauth = CredentialHealthInfo {
            uuid: "test".to_string(),
            name: None,
            provider_type: "antigravity".to_string(),
            is_healthy: false,
            last_error: Some("[需要重新授权] Token 已过期".to_string()),
            last_error_time: Some(chrono::Utc::now().to_rfc3339()),
            failure_count: 1,
            requires_reauth: true,
        };
        assert!(info_with_reauth.requires_reauth);

        // 测试普通错误不需要重新授权
        let info_normal_error = CredentialHealthInfo {
            uuid: "test".to_string(),
            name: None,
            provider_type: "antigravity".to_string(),
            is_healthy: false,
            last_error: Some("Network error".to_string()),
            last_error_time: Some(chrono::Utc::now().to_rfc3339()),
            failure_count: 1,
            requires_reauth: false,
        };
        assert!(!info_normal_error.requires_reauth);
    }

    #[test]
    fn test_credential_health_info_serialization() {
        let info = CredentialHealthInfo {
            uuid: "test-uuid".to_string(),
            name: Some("Test".to_string()),
            provider_type: "antigravity".to_string(),
            is_healthy: true,
            last_error: None,
            last_error_time: None,
            failure_count: 0,
            requires_reauth: false,
        };

        // 测试序列化
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("test-uuid"));
        assert!(json.contains("antigravity"));

        // 测试反序列化
        let deserialized: CredentialHealthInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.uuid, info.uuid);
        assert_eq!(deserialized.is_healthy, info.is_healthy);
    }

    #[test]
    fn test_api_provider_type_to_pool_type_mapping() {
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::Anthropic),
            PoolProviderType::Claude
        );
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::AnthropicCompatible),
            PoolProviderType::AnthropicCompatible
        );
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::Gemini),
            PoolProviderType::GeminiApiKey
        );
        assert_eq!(
            api_provider_type_to_pool_type(ApiProviderType::Openai),
            PoolProviderType::OpenAI
        );
    }

    #[test]
    fn test_build_openai_health_check_urls_supports_nested_base_path() {
        let urls = ProviderPoolService::build_openai_health_check_urls(Some(
            "http://127.0.0.1:3030/openai/v1",
        ));

        assert!(urls.contains(&"http://127.0.0.1:3030/openai/v1/chat/completions".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:3030/openai/chat/completions".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:3030/v1/chat/completions".to_string()));
    }

    #[test]
    fn test_build_openai_health_check_urls_defaults_to_official_endpoint() {
        let urls = ProviderPoolService::build_openai_health_check_urls(None);
        assert_eq!(urls[0], "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn select_credential_should_auto_recover_antigravity_from_default_path() {
        let _guard = env_lock().lock().expect("env lock");
        let temp = tempdir().expect("create tempdir");
        let _env = EnvGuard::set(&[("HOME", temp.path().as_os_str().to_os_string())]);
        let default_path = temp.path().join(".antigravity").join("oauth_creds.json");
        std::fs::create_dir_all(default_path.parent().expect("default parent"))
            .expect("create default dir");
        std::fs::write(
            &default_path,
            r#"{"access_token":"fallback_token","refresh_token":"refresh","project_id":"fallback-project"}"#,
        )
        .expect("write default creds");

        let db = setup_test_db();
        let service = ProviderPoolService::new();
        let inserted = service
            .add_credential(
                &db,
                "antigravity",
                CredentialData::AntigravityOAuth {
                    creds_file_path: temp
                        .path()
                        .join("missing.json")
                        .to_string_lossy()
                        .to_string(),
                    project_id: Some("fallback-project".to_string()),
                },
                Some("Recovered Antigravity".to_string()),
                Some(true),
                None,
            )
            .expect("insert credential");

        for _ in 0..3 {
            service
                .mark_unhealthy(
                    &db,
                    &inserted.uuid,
                    Some("Failed to load credentials: No such file or directory (os error 2)"),
                )
                .expect("mark unhealthy");
        }

        let selected = service
            .select_credential(&db, "antigravity", Some("gemini-3-pro-image-preview"))
            .expect("select credential")
            .expect("recovered credential should be selectable");

        assert_eq!(selected.uuid, inserted.uuid);
        assert!(selected.is_healthy);

        let recovered = service
            .get_by_uuid(&db, &inserted.uuid)
            .expect("query credential")
            .expect("credential should exist");
        assert!(recovered.is_healthy);
        assert_eq!(recovered.error_count, 0);
        assert!(recovered.last_error_message.is_none());
    }
}
