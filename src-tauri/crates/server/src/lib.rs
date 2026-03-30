//! HTTP API 服务器

#![allow(clippy::all)]

pub mod auth;
pub mod chrome_bridge;
pub mod client_detector;
pub mod middleware;

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use lime_core::config::{
    Config, ConfigChangeKind, ConfigManager, EndpointProvidersConfig, FileChangeEvent, FileWatcher,
    HotReloadManager, ReloadResult,
};
use lime_core::database::dao::provider_pool::ProviderPoolDao;
use lime_core::database::DbConnection;
use lime_core::logger::LogStore;
use lime_core::models::anthropic::*;
use lime_core::models::openai::*;
use lime_core::models::provider_pool_model::CredentialData;
use lime_credential::CredentialSyncService;
use lime_infra::injection::Injector;
use lime_processor::{RequestContext, RequestProcessor};
use lime_providers::converter::anthropic_to_openai::convert_anthropic_to_openai;
use lime_providers::providers::antigravity::AntigravityProvider;
use lime_providers::providers::claude_custom::ClaudeCustomProvider;
use lime_providers::providers::gemini::GeminiProvider;
use lime_providers::providers::kiro::KiroProvider;
use lime_providers::providers::openai_custom::OpenAICustomProvider;
use lime_server_utils::{
    build_anthropic_response, build_anthropic_stream_response, build_error_response,
    build_error_response_with_status, build_gemini_cli_request, build_gemini_native_request,
    models, parse_cw_response,
};
use lime_services::kiro_event_service::KiroEventService;
use lime_services::provider_pool_service::ProviderPoolService;
use lime_services::token_cache_service::TokenCacheService;
use lime_websocket::{WsConfig, WsConnectionManager, WsStats};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use tower_http::cors::CorsLayer;
use tower_http::timeout::TimeoutLayer;

/// 记录请求统计到遥测系统
pub fn record_request_telemetry(
    state: &AppState,
    ctx: &RequestContext,
    status: lime_infra::telemetry::RequestStatus,
    error_message: Option<String>,
) {
    use lime_infra::telemetry::RequestLog;

    let provider = ctx.provider.unwrap_or(lime_core::ProviderType::Kiro);

    // 清理错误消息中的敏感信息
    let sanitized_error = error_message.map(|msg| state.sanitizer.sanitize(&msg));

    let mut log = RequestLog::new(
        ctx.request_id.clone(),
        provider,
        ctx.resolved_model.clone(),
        ctx.is_stream,
    );

    // 设置状态和持续时间
    match status {
        lime_infra::telemetry::RequestStatus::Success => log.mark_success(ctx.elapsed_ms(), 200),
        lime_infra::telemetry::RequestStatus::Failed => log.mark_failed(
            ctx.elapsed_ms(),
            None,
            sanitized_error.clone().unwrap_or_default(),
        ),
        lime_infra::telemetry::RequestStatus::Timeout => log.mark_timeout(ctx.elapsed_ms()),
        lime_infra::telemetry::RequestStatus::Cancelled => log.mark_cancelled(ctx.elapsed_ms()),
        lime_infra::telemetry::RequestStatus::Retrying => {
            log.duration_ms = ctx.elapsed_ms();
        }
    }

    // 设置凭证 ID
    if let Some(cred_id) = &ctx.credential_id {
        log.set_credential_id(cred_id.clone());
    }

    // 设置重试次数
    log.retry_count = ctx.retry_count;

    // 记录到统计聚合器
    {
        let stats = state.processor.stats.write();
        stats.record(log.clone());
    }

    // 记录到请求日志记录器（用于前端日志列表显示）
    if let Some(logger) = &state.request_logger {
        let _ = logger.record(log.clone());
    }

    tracing::info!(
        "[TELEMETRY] request_id={} provider={:?} model={} status={:?} duration_ms={}",
        ctx.request_id,
        provider,
        ctx.resolved_model,
        status,
        ctx.elapsed_ms()
    );
}

/// 记录 Token 使用量到遥测系统
pub fn record_token_usage(
    state: &AppState,
    ctx: &RequestContext,
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
) {
    use lime_infra::telemetry::{TokenSource, TokenUsageRecord};

    // 只有当至少有一个 Token 值时才记录
    if input_tokens.is_none() && output_tokens.is_none() {
        return;
    }

    let provider = ctx.provider.unwrap_or(lime_core::ProviderType::Kiro);
    let record = TokenUsageRecord::new(
        uuid::Uuid::new_v4().to_string(),
        provider,
        ctx.resolved_model.clone(),
        input_tokens.unwrap_or(0),
        output_tokens.unwrap_or(0),
        TokenSource::Actual,
    )
    .with_request_id(ctx.request_id.clone());

    // 记录到 Token 追踪器
    {
        let tokens = state.processor.tokens.write();
        tokens.record(record);
    }

    tracing::debug!(
        "[TOKEN] request_id={} input={} output={}",
        ctx.request_id,
        input_tokens.unwrap_or(0),
        output_tokens.unwrap_or(0)
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub requests: u64,
    pub uptime_secs: u64,
    /// 最近 1 分钟错误率（0.0 - 1.0）
    pub error_rate_1m: f64,
    /// 最近 1 分钟 P95 延迟（毫秒）
    pub p95_latency_ms_1m: Option<u64>,
    /// 当前熔断的上游数量（当前版本暂未接入熔断器）
    pub open_circuit_count: u32,
    /// 当前活跃请求数（近似值，当前版本默认 0）
    pub active_requests: u64,
    /// 能力过滤与跨 Provider 回退指标
    pub capability_routing:
        middleware::capability_routing_metrics::CapabilityRoutingMetricsSnapshot,
    /// 响应缓存运行时统计
    pub response_cache: middleware::response_cache::ResponseCacheStats,
    /// 请求去重运行时统计
    pub request_dedup: middleware::request_dedup::RequestDedupStats,
    /// 幂等运行时统计
    pub idempotency: middleware::idempotency::IdempotencyStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseCacheDiagnostics {
    pub config: middleware::response_cache::ResponseCacheConfig,
    pub stats: middleware::response_cache::ResponseCacheStats,
    pub hit_rate_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestDedupDiagnostics {
    pub config: middleware::request_dedup::RequestDedupConfig,
    pub stats: middleware::request_dedup::RequestDedupStats,
    pub replay_rate_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdempotencyDiagnostics {
    pub config: middleware::idempotency::IdempotencyConfig,
    pub stats: middleware::idempotency::IdempotencyStats,
    pub replay_rate_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDiagnostics {
    pub generated_at: String,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub telemetry_summary: lime_infra::telemetry::StatsSummary,
    pub capability_routing:
        middleware::capability_routing_metrics::CapabilityRoutingMetricsSnapshot,
    pub response_cache: ResponseCacheDiagnostics,
    pub request_dedup: RequestDedupDiagnostics,
    pub idempotency: IdempotencyDiagnostics,
}

pub fn build_response_cache_diagnostics(
    store: &middleware::response_cache::ResponseCacheStore,
) -> ResponseCacheDiagnostics {
    ResponseCacheDiagnostics {
        config: store.config(),
        stats: store.stats(),
        hit_rate_percent: store.hit_rate_percent(),
    }
}

pub fn build_request_dedup_diagnostics(
    store: &middleware::request_dedup::RequestDedupStore,
) -> RequestDedupDiagnostics {
    RequestDedupDiagnostics {
        config: store.config(),
        stats: store.stats(),
        replay_rate_percent: store.replay_rate_percent(),
    }
}

pub fn build_idempotency_diagnostics(
    store: &middleware::idempotency::IdempotencyStore,
) -> IdempotencyDiagnostics {
    IdempotencyDiagnostics {
        config: store.config(),
        stats: store.stats(),
        replay_rate_percent: store.replay_rate_percent(),
    }
}

pub fn build_server_diagnostics(
    running: bool,
    host: String,
    port: u16,
    telemetry_summary: lime_infra::telemetry::StatsSummary,
    capability_routing: middleware::capability_routing_metrics::CapabilityRoutingMetricsSnapshot,
    response_cache_store: &middleware::response_cache::ResponseCacheStore,
    request_dedup_store: &middleware::request_dedup::RequestDedupStore,
    idempotency_store: &middleware::idempotency::IdempotencyStore,
) -> ServerDiagnostics {
    ServerDiagnostics {
        generated_at: chrono::Utc::now().to_rfc3339(),
        running,
        host,
        port,
        telemetry_summary,
        capability_routing,
        response_cache: build_response_cache_diagnostics(response_cache_store),
        request_dedup: build_request_dedup_diagnostics(request_dedup_store),
        idempotency: build_idempotency_diagnostics(idempotency_store),
    }
}

pub struct ServerState {
    pub config: Config,
    pub running: bool,
    pub requests: u64,
    pub start_time: Option<std::time::Instant>,
    pub kiro_provider: KiroProvider,
    pub gemini_provider: GeminiProvider,
    pub openai_custom_provider: OpenAICustomProvider,
    pub claude_custom_provider: ClaudeCustomProvider,
    pub default_provider_ref: Arc<RwLock<String>>,
    /// 路由器引用（用于动态更新默认 Provider）
    pub router_ref: Option<Arc<RwLock<lime_core::router::Router>>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// 服务器实际监听的 host（可能与配置不同，因为会自动切换到有效的 IP）
    pub running_host: Option<String>,
    /// 能力路由指标（能力过滤/模型回退/Provider 回退）
    pub capability_routing_metrics_store:
        Arc<middleware::capability_routing_metrics::CapabilityRoutingMetricsStore>,
    /// 响应缓存存储（用于状态统计与运行时共享）
    pub response_cache_store: Arc<middleware::response_cache::ResponseCacheStore>,
    /// 请求去重存储（用于状态统计与运行时共享）
    pub request_dedup_store: Arc<middleware::request_dedup::RequestDedupStore>,
    /// 幂等性存储（用于状态统计与运行时共享）
    pub idempotency_store: Arc<middleware::idempotency::IdempotencyStore>,
}

impl ServerState {
    pub fn new(config: Config) -> Self {
        let kiro = KiroProvider::new();
        let gemini = GeminiProvider::new();
        let openai_custom = OpenAICustomProvider::new();
        let claude_custom = ClaudeCustomProvider::new();
        let default_provider_ref = Arc::new(RwLock::new(config.default_provider.clone()));
        let idempotency_store = Arc::new(middleware::idempotency::IdempotencyStore::new(
            middleware::idempotency::IdempotencyConfig::default(),
        ));
        let request_dedup_store = Arc::new(middleware::request_dedup::RequestDedupStore::new(
            middleware::request_dedup::RequestDedupConfig::default(),
        ));
        let response_cache_store = Arc::new(middleware::response_cache::ResponseCacheStore::new(
            middleware::response_cache::ResponseCacheConfig {
                enabled: config.server.response_cache.enabled,
                ttl_secs: config.server.response_cache.ttl_secs,
                max_entries: config.server.response_cache.max_entries,
                max_body_bytes: config.server.response_cache.max_body_bytes,
                cacheable_status_codes: config.server.response_cache.cacheable_status_codes.clone(),
            },
        ));

        Self {
            config,
            running: false,
            requests: 0,
            start_time: None,
            kiro_provider: kiro,
            gemini_provider: gemini,
            openai_custom_provider: openai_custom,
            claude_custom_provider: claude_custom,
            default_provider_ref,
            router_ref: None,
            shutdown_tx: None,
            running_host: None,
            capability_routing_metrics_store: Arc::new(
                middleware::capability_routing_metrics::CapabilityRoutingMetricsStore::new(),
            ),
            response_cache_store,
            request_dedup_store,
            idempotency_store,
        }
    }

    pub fn status(&self) -> ServerStatus {
        ServerStatus {
            running: self.running,
            // 使用实际运行的 host，如果没有则使用配置的 host
            host: self
                .running_host
                .clone()
                .unwrap_or_else(|| self.config.server.host.clone()),
            port: self.config.server.port,
            requests: self.requests,
            uptime_secs: self.start_time.map(|t| t.elapsed().as_secs()).unwrap_or(0),
            error_rate_1m: 0.0,
            p95_latency_ms_1m: None,
            open_circuit_count: 0,
            active_requests: 0,
            capability_routing: self.capability_routing_metrics_store.snapshot(),
            response_cache: self.response_cache_store.stats(),
            request_dedup: self.request_dedup_store.stats(),
            idempotency: self.idempotency_store.stats(),
        }
    }

    /// 增加请求计数
    pub fn increment_request_count(&mut self) {
        self.requests = self.requests.saturating_add(1);
    }

    /// 解析绑定地址
    ///
    /// 直接返回用户配置的地址，不做任何自动替换。
    /// 如果地址无效，绑定时会失败并返回错误。
    fn resolve_bind_host(&self, configured_host: &str) -> String {
        tracing::info!("[SERVER] 使用配置的监听地址: {}", configured_host);
        configured_host.to_string()
    }

    pub async fn start(
        &mut self,
        logs: Arc<RwLock<LogStore>>,
        pool_service: Arc<ProviderPoolService>,
        token_cache: Arc<TokenCacheService>,
        db: Option<DbConnection>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.start_with_telemetry(logs, pool_service, token_cache, db, None, None, None)
            .await
    }

    /// 启动服务器（使用共享的遥测实例）
    ///
    /// 这允许服务器与 TelemetryState 共享同一个 StatsAggregator、TokenTracker 和 RequestLogger，
    /// 使得请求处理过程中记录的统计数据能够在前端监控页面中显示。
    pub async fn start_with_telemetry(
        &mut self,
        logs: Arc<RwLock<LogStore>>,
        pool_service: Arc<ProviderPoolService>,
        token_cache: Arc<TokenCacheService>,
        db: Option<DbConnection>,
        shared_stats: Option<Arc<parking_lot::RwLock<lime_infra::telemetry::StatsAggregator>>>,
        shared_tokens: Option<Arc<parking_lot::RwLock<lime_infra::telemetry::TokenTracker>>>,
        shared_logger: Option<Arc<lime_infra::telemetry::RequestLogger>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.start_with_telemetry_and_flow_monitor(
            logs,
            pool_service,
            token_cache,
            db,
            shared_stats,
            shared_tokens,
            shared_logger,
        )
        .await
    }

    /// 启动服务器（使用共享的遥测实例）
    ///
    /// 这允许服务器与 TelemetryState 共享同一个 StatsAggregator、TokenTracker 和 RequestLogger，
    /// 使得请求处理过程中记录的统计数据能够在前端监控页面中显示。
    pub async fn start_with_telemetry_and_flow_monitor(
        &mut self,
        logs: Arc<RwLock<LogStore>>,
        pool_service: Arc<ProviderPoolService>,
        token_cache: Arc<TokenCacheService>,
        db: Option<DbConnection>,
        shared_stats: Option<Arc<parking_lot::RwLock<lime_infra::telemetry::StatsAggregator>>>,
        shared_tokens: Option<Arc<parking_lot::RwLock<lime_infra::telemetry::TokenTracker>>>,
        shared_logger: Option<Arc<lime_infra::telemetry::RequestLogger>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.running {
            return Ok(());
        }

        let (tx, rx) = oneshot::channel();
        self.shutdown_tx = Some(tx);

        // 智能选择监听地址
        // - 127.0.0.1, localhost, 0.0.0.0, :: 直接使用
        // - 局域网 IP：检查是否在当前网卡列表中，如果不在则自动切换到当前局域网 IP
        let configured_host = self.config.server.host.clone();
        let host = self.resolve_bind_host(&configured_host);

        // 如果地址发生了变化，记录日志
        if host != configured_host {
            tracing::warn!(
                "[SERVER] 配置的监听地址 {} 不可用，自动切换到 {}",
                configured_host,
                host
            );
        }

        let port = self.config.server.port;
        let api_key = self.config.server.api_key.clone();
        let default_provider_ref = self.default_provider_ref.clone();

        // 重新加载凭证
        let _ = self.kiro_provider.load_credentials().await;
        let kiro = self.kiro_provider.clone();

        // 创建参数注入器
        let injection_enabled = self.config.injection.enabled;
        let injector = Injector::with_rules(
            self.config
                .injection
                .rules
                .iter()
                .map(|r| r.clone().into())
                .collect(),
        );

        // 获取配置和配置路径用于热重载
        let config = self.config.clone();
        let config_path = lime_core::config::ConfigManager::default_config_path();

        // 创建请求处理器（在 spawn 之前创建，以便保存 router_ref）
        let processor = match (&shared_stats, &shared_tokens) {
            (Some(stats), Some(tokens)) => Arc::new(RequestProcessor::with_shared_telemetry(
                pool_service.clone(),
                stats.clone(),
                tokens.clone(),
            )),
            _ => Arc::new(RequestProcessor::with_defaults(pool_service.clone())),
        };

        // 从配置初始化 Router 的默认 Provider
        {
            let default_provider_str = &config.routing.default_provider;

            // 尝试解析为 ProviderType 枚举
            match default_provider_str.parse::<lime_core::ProviderType>() {
                Ok(provider_type) => {
                    let mut router = processor.router.write().await;
                    router.set_default_provider(provider_type);
                    tracing::info!(
                        "[SERVER] 从配置初始化 Router 默认 Provider: {} (ProviderType)",
                        default_provider_str
                    );
                }
                Err(_) => {
                    // 如果解析失败，可能是自定义 provider ID
                    // 这种情况下，路由器保持空状态，请求会直接使用 provider_id 进行凭证查找
                    tracing::warn!(
                        "[SERVER] 配置的默认 Provider '{}' 不是有效的 ProviderType 枚举值，可能是自定义 Provider ID。\
                        路由器将保持空状态，请求将直接使用 provider_id 进行凭证查找。",
                        default_provider_str
                    );
                    eprintln!(
                        "[SERVER] 警告：默认 Provider '{default_provider_str}' 不是标准 Provider 类型（kiro/openai/claude等），\
                        可能是自定义 Provider ID。如果这是预期行为，请忽略此警告。"
                    );
                }
            }
        }

        // 保存 router_ref 以便后续动态更新
        self.router_ref = Some(processor.router.clone());

        // 保存实际使用的 host（在移动到 spawn 之前克隆）
        let running_host = host.clone();
        let idempotency_store = Arc::new(middleware::idempotency::IdempotencyStore::new(
            middleware::idempotency::IdempotencyConfig::default(),
        ));
        self.idempotency_store = idempotency_store.clone();
        let request_dedup_store = Arc::new(middleware::request_dedup::RequestDedupStore::new(
            middleware::request_dedup::RequestDedupConfig::default(),
        ));
        self.request_dedup_store = request_dedup_store.clone();
        let capability_routing_metrics_store =
            Arc::new(middleware::capability_routing_metrics::CapabilityRoutingMetricsStore::new());
        self.capability_routing_metrics_store = capability_routing_metrics_store.clone();
        let response_cache_store = Arc::new(middleware::response_cache::ResponseCacheStore::new(
            middleware::response_cache::ResponseCacheConfig {
                enabled: config.server.response_cache.enabled,
                ttl_secs: config.server.response_cache.ttl_secs,
                max_entries: config.server.response_cache.max_entries,
                max_body_bytes: config.server.response_cache.max_body_bytes,
                cacheable_status_codes: config.server.response_cache.cacheable_status_codes.clone(),
            },
        ));
        self.response_cache_store = response_cache_store.clone();

        tokio::spawn(async move {
            if let Err(e) = run_server(
                &host,
                port,
                &api_key,
                default_provider_ref,
                kiro,
                logs,
                rx,
                pool_service,
                token_cache,
                db,
                injector,
                injection_enabled,
                shared_stats,
                shared_tokens,
                shared_logger,
                Some(config),
                Some(config_path),
                Some(processor),
                capability_routing_metrics_store,
                response_cache_store,
                request_dedup_store,
                idempotency_store,
                None, // dev_bridge_callback: 由主 crate 在重新导出层注入
            )
            .await
            {
                tracing::error!("Server error: {}", e);
            }
        });

        self.running = true;
        self.start_time = Some(std::time::Instant::now());
        // 保存服务器实际监听的 host（可能与配置不同）
        self.running_host = Some(running_host);
        Ok(())
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.running = false;
        self.start_time = None;
        self.running_host = None;
        self.router_ref = None;
    }
}

pub mod handlers;

#[derive(Clone)]
#[allow(dead_code)]
pub struct AppState {
    pub api_key: String,
    pub base_url: String,
    pub default_provider: Arc<RwLock<String>>,
    pub kiro: Arc<RwLock<KiroProvider>>,
    pub logs: Arc<RwLock<LogStore>>,
    pub kiro_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    pub gemini_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    pub pool_service: Arc<ProviderPoolService>,
    pub token_cache: Arc<TokenCacheService>,
    pub db: Option<DbConnection>,
    /// 参数注入器
    pub injector: Arc<RwLock<Injector>>,
    /// 是否启用参数注入
    pub injection_enabled: Arc<RwLock<bool>>,
    /// 请求处理器
    pub processor: Arc<RequestProcessor>,
    /// 是否允许自动降级/切换 Provider（来自配置 retry.auto_switch_provider）
    pub allow_provider_fallback: bool,
    /// WebSocket 连接管理器
    pub ws_manager: Arc<WsConnectionManager>,
    /// WebSocket 统计信息
    pub ws_stats: Arc<WsStats>,
    /// 热重载管理器
    pub hot_reload_manager: Option<Arc<HotReloadManager>>,
    /// 请求日志记录器（与 TelemetryState 共享）
    pub request_logger: Option<Arc<lime_infra::telemetry::RequestLogger>>,
    /// Amp CLI 路由器
    pub amp_router: Arc<lime_core::router::AmpRouter>,
    /// 端点 Provider 配置
    pub endpoint_providers: Arc<RwLock<EndpointProvidersConfig>>,
    /// Provider 维度模型配置（用于能力感知回退）
    pub provider_models:
        Arc<std::collections::HashMap<String, lime_core::config::ProviderModelsConfig>>,
    /// Kiro 事件服务
    pub kiro_event_service: Arc<KiroEventService>,
    /// API Key Provider 服务（用于智能降级）
    pub api_key_service: Arc<lime_services::api_key_provider_service::ApiKeyProviderService>,
    /// 速率限制器
    pub rate_limiter: Option<Arc<middleware::rate_limit::SlidingWindowRateLimiter>>,
    /// 幂等性存储
    pub idempotency_store: Arc<middleware::idempotency::IdempotencyStore>,
    /// 请求去重存储（请求指纹 in-flight + 短 TTL 回放）
    pub request_dedup_store: Arc<middleware::request_dedup::RequestDedupStore>,
    /// 响应缓存存储（非流式短时缓存）
    pub response_cache_store: Arc<middleware::response_cache::ResponseCacheStore>,
    /// 能力路由指标（能力过滤/模型回退/Provider 回退）
    pub capability_routing_metrics_store:
        Arc<middleware::capability_routing_metrics::CapabilityRoutingMetricsStore>,
    /// 凭证清理器
    pub sanitizer: Arc<lime_core::sanitizer::CredentialSanitizer>,
}

/// 启动配置文件监控
///
/// 监控配置文件变化并触发热重载。
///
/// # 连接保持
///
/// 热重载过程不会中断现有连接：
/// - 配置更新在独立的 tokio 任务中异步执行
/// - 使用 RwLock 进行原子性更新，不会阻塞正在处理的请求
/// - 服务器继续运行，不需要重启
/// - HTTP 和 WebSocket 连接保持活跃
async fn start_config_watcher(
    config_path: PathBuf,
    hot_reload_manager: Option<Arc<HotReloadManager>>,
    processor: Arc<RequestProcessor>,
    logs: Arc<RwLock<LogStore>>,
    db: Option<DbConnection>,
    config_manager: Option<Arc<std::sync::RwLock<ConfigManager>>>,
) -> Option<FileWatcher> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<FileChangeEvent>();

    // 创建文件监控器
    let mut watcher = match FileWatcher::new(&config_path, tx) {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("[HOT_RELOAD] 创建文件监控器失败: {}", e);
            return None;
        }
    };

    // 启动监控
    if let Err(e) = watcher.start() {
        tracing::error!("[HOT_RELOAD] 启动文件监控失败: {}", e);
        return None;
    }

    tracing::info!("[HOT_RELOAD] 配置文件监控已启动: {:?}", config_path);

    // 启动事件处理任务
    let hot_reload_manager_clone = hot_reload_manager.clone();
    let processor_clone = processor.clone();
    let logs_clone = logs.clone();
    let db_clone = db.clone();
    let config_manager_clone = config_manager.clone();

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            // 只处理修改事件
            if event.kind != ConfigChangeKind::Modified {
                continue;
            }

            tracing::info!("[HOT_RELOAD] 检测到配置文件变更: {:?}", event.path);
            logs_clone.write().await.add(
                "info",
                &format!("[HOT_RELOAD] 检测到配置文件变更: {:?}", event.path),
            );

            // 执行热重载
            if let Some(ref manager) = hot_reload_manager_clone {
                let result = manager.reload();
                match &result {
                    ReloadResult::Success { .. } => {
                        tracing::info!("[HOT_RELOAD] 配置热重载成功");
                        logs_clone
                            .write()
                            .await
                            .add("info", "[HOT_RELOAD] 配置热重载成功");

                        // 更新处理器中的组件
                        let new_config = manager.config();
                        update_processor_config(&processor_clone, &new_config).await;

                        // 同步凭证池
                        if let (Some(ref db), Some(ref cfg_manager)) =
                            (&db_clone, &config_manager_clone)
                        {
                            match sync_credential_pool_from_config(db, cfg_manager, &logs_clone)
                                .await
                            {
                                Ok(count) => {
                                    tracing::info!(
                                        "[HOT_RELOAD] 凭证池同步完成，共 {} 个凭证",
                                        count
                                    );
                                    logs_clone.write().await.add(
                                        "info",
                                        &format!("[HOT_RELOAD] 凭证池同步完成，共 {count} 个凭证"),
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!("[HOT_RELOAD] 凭证池同步失败: {}", e);
                                    logs_clone
                                        .write()
                                        .await
                                        .add("warn", &format!("[HOT_RELOAD] 凭证池同步失败: {e}"));
                                }
                            }
                        }
                    }
                    ReloadResult::RolledBack { error, .. } => {
                        tracing::warn!("[HOT_RELOAD] 配置热重载失败，已回滚: {}", error);
                        logs_clone.write().await.add(
                            "warn",
                            &format!("[HOT_RELOAD] 配置热重载失败，已回滚: {error}"),
                        );
                    }
                    ReloadResult::Failed {
                        error,
                        rollback_error,
                        ..
                    } => {
                        tracing::error!(
                            "[HOT_RELOAD] 配置热重载失败: {}, 回滚错误: {:?}",
                            error,
                            rollback_error
                        );
                        logs_clone.write().await.add(
                            "error",
                            &format!(
                                "[HOT_RELOAD] 配置热重载失败: {error}, 回滚错误: {rollback_error:?}"
                            ),
                        );
                    }
                }
            }
        }
    });

    Some(watcher)
}

/// 更新处理器配置
///
/// 当配置热重载成功后，更新 RequestProcessor 中的各个组件。
///
/// # 原子性更新
///
/// 每个组件的更新都是原子性的，使用 RwLock 确保：
/// - 正在处理的请求不会看到部分更新的状态
/// - 更新过程不会阻塞新请求的处理
/// - 现有连接不受影响
async fn update_processor_config(processor: &RequestProcessor, config: &Config) {
    // 更新注入器规则
    {
        let mut injector = processor.injector.write().await;
        injector.clear();
        for rule in &config.injection.rules {
            injector.add_rule(rule.clone().into());
        }
        tracing::debug!(
            "[HOT_RELOAD] 注入器规则已更新: {} 条规则",
            config.injection.rules.len()
        );
    }

    // 更新路由器默认 Provider
    {
        let mut router = processor.router.write().await;

        // 尝试解析为 ProviderType 枚举
        match config
            .routing
            .default_provider
            .parse::<lime_core::ProviderType>()
        {
            Ok(provider_type) => {
                router.set_default_provider(provider_type);
                tracing::debug!(
                    "[HOT_RELOAD] 路由器默认 Provider 已更新: {} (ProviderType)",
                    config.routing.default_provider
                );
            }
            Err(_) => {
                // 如果解析失败，可能是自定义 provider ID
                // 清空路由器的默认 provider，让请求直接使用 provider_id
                tracing::warn!(
                    "[HOT_RELOAD] 配置的默认 Provider '{}' 不是有效的 ProviderType 枚举值，可能是自定义 Provider ID。\
                    路由器默认 Provider 将被清空。",
                    config.routing.default_provider
                );
            }
        }
    }

    // 更新模型映射器
    {
        let mut mapper = processor.mapper.write().await;
        mapper.clear();
        for (alias, model) in &config.routing.model_aliases {
            mapper.add_alias(alias, model);
        }
        tracing::debug!(
            "[HOT_RELOAD] 模型别名已更新: {} 个别名",
            config.routing.model_aliases.len()
        );
    }

    // 注意：重试配置目前不支持热更新，因为 Retrier 是不可变的
    // 如果需要更新重试配置，需要重启服务器
    tracing::debug!(
        "[HOT_RELOAD] 重试配置: max_retries={}, base_delay={}ms (需重启生效)",
        config.retry.max_retries,
        config.retry.base_delay_ms
    );

    tracing::info!("[HOT_RELOAD] 处理器配置更新完成");
}

/// 从配置同步凭证池
///
/// 当配置热重载成功后，从 YAML 配置中加载凭证并同步到数据库。
///
/// # 同步策略
///
/// - 从配置中加载所有凭证
/// - 对于配置中存在但数据库中不存在的凭证，添加到数据库
/// - 对于配置中存在且数据库中也存在的凭证，更新数据库中的记录
/// - 对于数据库中存在但配置中不存在的凭证，保留（不删除，避免丢失运行时状态）
async fn sync_credential_pool_from_config(
    db: &DbConnection,
    config_manager: &Arc<std::sync::RwLock<ConfigManager>>,
    _logs: &Arc<RwLock<LogStore>>,
) -> Result<usize, String> {
    // 创建凭证同步服务
    let sync_service = CredentialSyncService::new(config_manager.clone());

    // 从配置加载凭证
    let credentials = sync_service.load_from_config().map_err(|e| e.to_string())?;

    let conn = lime_core::database::lock_db(db)?;
    let mut synced_count = 0;

    for cred in &credentials {
        // 检查凭证是否已存在
        let existing =
            ProviderPoolDao::get_by_uuid(&conn, &cred.uuid).map_err(|e| e.to_string())?;

        if existing.is_some() {
            // 更新现有凭证
            ProviderPoolDao::update(&conn, cred).map_err(|e| e.to_string())?;
            tracing::debug!(
                "[HOT_RELOAD] 更新凭证: {} ({})",
                cred.uuid,
                cred.provider_type
            );
        } else {
            // 添加新凭证
            ProviderPoolDao::insert(&conn, cred).map_err(|e| e.to_string())?;
            tracing::debug!(
                "[HOT_RELOAD] 添加凭证: {} ({})",
                cred.uuid,
                cred.provider_type
            );
        }
        synced_count += 1;
    }

    Ok(synced_count)
}

/// 开发桥接启动回调类型
pub type DevBridgeCallback = Box<dyn FnOnce(AppState) + Send + 'static>;

async fn run_server(
    host: &str,
    port: u16,
    api_key: &str,
    default_provider: Arc<RwLock<String>>,
    kiro: KiroProvider,
    logs: Arc<RwLock<LogStore>>,
    shutdown: oneshot::Receiver<()>,
    pool_service: Arc<ProviderPoolService>,
    token_cache: Arc<TokenCacheService>,
    db: Option<DbConnection>,
    injector: Injector,
    injection_enabled: bool,
    shared_stats: Option<Arc<parking_lot::RwLock<lime_infra::telemetry::StatsAggregator>>>,
    shared_tokens: Option<Arc<parking_lot::RwLock<lime_infra::telemetry::TokenTracker>>>,
    shared_logger: Option<Arc<lime_infra::telemetry::RequestLogger>>,
    config: Option<Config>,
    config_path: Option<PathBuf>,
    processor: Option<Arc<RequestProcessor>>,
    capability_routing_metrics_store: Arc<
        middleware::capability_routing_metrics::CapabilityRoutingMetricsStore,
    >,
    response_cache_store: Arc<middleware::response_cache::ResponseCacheStore>,
    request_dedup_store: Arc<middleware::request_dedup::RequestDedupStore>,
    idempotency_store: Arc<middleware::idempotency::IdempotencyStore>,
    dev_bridge_callback: Option<DevBridgeCallback>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let base_url = format!("http://{host}:{port}");

    // 使用传入的 processor 或创建新的
    let processor = match processor {
        Some(p) => p,
        None => match (&shared_stats, &shared_tokens) {
            (Some(stats), Some(tokens)) => Arc::new(RequestProcessor::with_shared_telemetry(
                pool_service.clone(),
                stats.clone(),
                tokens.clone(),
            )),
            _ => Arc::new(RequestProcessor::with_defaults(pool_service.clone())),
        },
    };

    // 将注入器规则同步到处理器
    {
        let mut proc_injector = processor.injector.write().await;
        for rule in injector.rules() {
            proc_injector.add_rule(rule.clone());
        }
    }

    // 从配置初始化 Router 的默认 Provider
    if let Some(cfg) = &config {
        let default_provider_str = &cfg.routing.default_provider;

        // 尝试解析为 ProviderType 枚举
        match default_provider_str.parse::<lime_core::ProviderType>() {
            Ok(provider_type) => {
                let mut router = processor.router.write().await;
                router.set_default_provider(provider_type);
                tracing::info!(
                    "[SERVER] 从配置初始化 Router 默认 Provider: {} (ProviderType)",
                    default_provider_str
                );
            }
            Err(_) => {
                // 如果解析失败，可能是自定义 provider ID
                tracing::warn!(
                    "[SERVER] 配置的默认 Provider '{}' 不是有效的 ProviderType 枚举值，可能是自定义 Provider ID。\
                    路由器将保持空状态，请求将直接使用 provider_id 进行凭证查找。",
                    default_provider_str
                );
                eprintln!(
                    "[SERVER] 警告：默认 Provider '{default_provider_str}' 不是标准 Provider 类型，可能是自定义 Provider ID"
                );
            }
        }
    }

    // 初始化 WebSocket 管理器
    let ws_manager = Arc::new(WsConnectionManager::new(WsConfig::default()));
    let ws_stats = ws_manager.stats().clone();

    // 初始化热重载管理器
    let hot_reload_manager = match (&config, &config_path) {
        (Some(cfg), Some(path)) => Some(Arc::new(HotReloadManager::new(cfg.clone(), path.clone()))),
        _ => None,
    };

    // 初始化配置管理器（用于凭证池同步）
    let config_manager: Option<Arc<std::sync::RwLock<ConfigManager>>> =
        match (&config, &config_path) {
            (Some(cfg), Some(path)) => Some(Arc::new(std::sync::RwLock::new(
                ConfigManager::with_config(cfg.clone(), path.clone()),
            ))),
            _ => None,
        };

    let logs_clone = logs.clone();
    let db_clone = db.clone();

    // 初始化 Amp CLI 路由器
    let amp_router = Arc::new(lime_core::router::AmpRouter::new(
        config
            .as_ref()
            .map(|c| c.ampcode.clone())
            .unwrap_or_default(),
    ));

    // 初始化端点 Provider 配置
    let endpoint_providers = Arc::new(RwLock::new(
        config
            .as_ref()
            .map(|c| c.endpoint_providers.clone())
            .unwrap_or_default(),
    ));
    let provider_models = Arc::new(
        config
            .as_ref()
            .map(|c| c.models.providers.clone())
            .unwrap_or_default(),
    );

    // 创建 Kiro 事件服务
    let kiro_event_service = Arc::new(KiroEventService::new());

    // 创建 API Key Provider 服务
    let api_key_service =
        Arc::new(lime_services::api_key_provider_service::ApiKeyProviderService::new());

    // 是否允许自动降级/切换 Provider（默认开启，兼容旧行为）
    let allow_provider_fallback = config
        .as_ref()
        .map(|c| c.retry.auto_switch_provider)
        .unwrap_or(true);
    let state = AppState {
        api_key: api_key.to_string(),
        base_url,
        default_provider,
        kiro: Arc::new(RwLock::new(kiro)),
        logs,
        kiro_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        gemini_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        pool_service,
        token_cache,
        db,
        injector: Arc::new(RwLock::new(injector)),
        injection_enabled: Arc::new(RwLock::new(injection_enabled)),
        processor: processor.clone(),
        allow_provider_fallback,
        ws_manager,
        ws_stats,
        hot_reload_manager: hot_reload_manager.clone(),
        request_logger: shared_logger,
        amp_router,
        endpoint_providers,
        provider_models,
        kiro_event_service,
        api_key_service,
        rate_limiter: Some(Arc::new(
            middleware::rate_limit::SlidingWindowRateLimiter::new(
                middleware::rate_limit::RateLimitConfig::default(),
            ),
        )),
        idempotency_store,
        request_dedup_store,
        response_cache_store,
        capability_routing_metrics_store,
        sanitizer: Arc::new(lime_core::sanitizer::CredentialSanitizer::with_defaults()),
    };

    // ========== 开发模式：通过回调启动桥接服务器 ==========
    if let Some(callback) = dev_bridge_callback {
        callback(state.clone());
    }

    // 启动配置文件监控
    let _file_watcher = if let Some(path) = config_path {
        start_config_watcher(
            path,
            hot_reload_manager,
            processor,
            logs_clone,
            db_clone,
            config_manager,
        )
        .await
    } else {
        None
    };

    // 设置请求体大小限制为 100MB，支持大型上下文请求（如 Claude Code 的 /compact 命令）
    let body_limit = 100 * 1024 * 1024; // 100MB

    // Kiro凭证管理API路由
    let kiro_api_routes = Router::new()
        .route(
            "/api/kiro/credentials/available",
            get(handlers::get_available_credentials),
        )
        .route(
            "/api/kiro/credentials/select",
            post(handlers::select_credential),
        )
        .route(
            "/api/kiro/credentials/{uuid}/refresh",
            axum::routing::put(handlers::refresh_credential),
        )
        .route(
            "/api/kiro/credentials/{uuid}/status",
            get(handlers::get_credential_status),
        );

    // 凭证 API 路由（用于 aster Agent 集成）
    let credentials_api_routes = Router::new()
        .route("/v1/credentials/select", post(handlers::credentials_select))
        .route(
            "/v1/credentials/{uuid}/token",
            get(handlers::credentials_get_token),
        );

    let allowed_origins = vec![
        HeaderValue::from_static("http://localhost:1420"),
        HeaderValue::from_static("http://127.0.0.1:1420"),
        HeaderValue::from_static("http://localhost:5173"),
        HeaderValue::from_static("http://127.0.0.1:5173"),
        HeaderValue::from_static("tauri://localhost"),
        HeaderValue::from_static("http://tauri.localhost"),
        HeaderValue::from_static("https://tauri.localhost"),
    ];

    let cors_layer = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::ORIGIN,
        ]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/cache", get(cache_diagnostics))
        .route("/stats", get(stats_diagnostics))
        .route("/v1/models", get(models))
        .route("/v1/chat/completions", post(
            |State(state): State<AppState>,
             headers: HeaderMap,
             Json(request): Json<lime_core::models::openai::ChatCompletionRequest>| async {
                handlers::chat_completions(State(state), headers, Json(request)).await
            }
        ))
        .route("/v1/messages", post(
            |State(state): State<AppState>,
             headers: HeaderMap,
             Json(request): Json<AnthropicMessagesRequest>| async {
                handlers::anthropic_messages(State(state), headers, Json(request)).await
            }
        ))
        .route("/v1/messages/count_tokens", post(count_tokens))
        // 图像生成 API 路由
        .route(
            "/v1/images/generations",
            post(handlers::handle_image_generation),
        )
        // WebSocket 路由
        .route("/v1/ws", get(handlers::ws_upgrade_handler))
        .route("/ws", get(handlers::ws_upgrade_handler))
        .route(
            "/lime-chrome-observer/:lime_key",
            get(handlers::chrome_observer_ws_upgrade),
        )
        .route(
            "/lime-chrome-control/:lime_key",
            get(handlers::chrome_control_ws_upgrade),
        )
        // Kiro凭证管理API路由
        .merge(kiro_api_routes)
        // 凭证 API 路由（用于 aster Agent 集成）
        .merge(credentials_api_routes)
        .layer(cors_layer)
        .layer(DefaultBodyLimit::max(body_limit))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_secs(300),
        ))
        .with_state(state);

    let addr: std::net::SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("无效的监听地址 {host}:{port} - {e}"))?;

    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
        format!("无法绑定到 {host}:{port}，错误: {e}。请检查地址是否有效或端口是否被占用。")
    })?;

    tracing::info!("Server listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown.await;
        })
        .await?;

    Ok(())
}

#[derive(Debug, Default, Deserialize)]
struct HealthQuery {
    #[serde(default)]
    full: bool,
}

#[derive(Debug, Default, Deserialize)]
struct StatsQuery {
    days: Option<u32>,
}

fn parse_base_url_host_port(base_url: &str) -> (String, u16) {
    if let Ok(url) = reqwest::Url::parse(base_url) {
        let host = url.host_str().unwrap_or("127.0.0.1").to_string();
        let port = url.port_or_known_default().unwrap_or_else(|| {
            if url.scheme() == "https" {
                443
            } else {
                80
            }
        });
        return (host, port);
    }
    ("127.0.0.1".to_string(), 3030)
}

fn build_diagnostics_from_app_state(
    state: &AppState,
    stats_range: Option<lime_infra::telemetry::TimeRange>,
) -> ServerDiagnostics {
    let telemetry_summary = state.processor.stats.read().summary(stats_range);
    let (host, port) = parse_base_url_host_port(&state.base_url);
    build_server_diagnostics(
        true,
        host,
        port,
        telemetry_summary,
        state.capability_routing_metrics_store.snapshot(),
        state.response_cache_store.as_ref(),
        state.request_dedup_store.as_ref(),
        state.idempotency_store.as_ref(),
    )
}

async fn health(State(state): State<AppState>, Query(query): Query<HealthQuery>) -> Response {
    if !query.full {
        return Json(serde_json::json!({
            "status": "healthy",
            "version": env!("CARGO_PKG_VERSION")
        }))
        .into_response();
    }

    let diagnostics = build_diagnostics_from_app_state(&state, None);
    (
        [
            (header::CACHE_CONTROL, "no-cache"),
            (header::PRAGMA, "no-cache"),
        ],
        Json(serde_json::json!({
            "status": "healthy",
            "version": env!("CARGO_PKG_VERSION"),
            "diagnostics": diagnostics
        })),
    )
        .into_response()
}

async fn cache_diagnostics(State(state): State<AppState>) -> Response {
    let cache = build_response_cache_diagnostics(state.response_cache_store.as_ref());
    (
        [
            (header::CACHE_CONTROL, "no-cache"),
            (header::PRAGMA, "no-cache"),
        ],
        Json(cache),
    )
        .into_response()
}

async fn stats_diagnostics(
    State(state): State<AppState>,
    Query(query): Query<StatsQuery>,
) -> Response {
    let days = query.days.unwrap_or(7).clamp(1, 30);
    let range = lime_infra::telemetry::TimeRange::last_days(days as i64);
    let diagnostics = build_diagnostics_from_app_state(&state, Some(range));
    (
        [
            (header::CACHE_CONTROL, "no-cache"),
            (header::PRAGMA, "no-cache"),
        ],
        Json(diagnostics),
    )
        .into_response()
}

async fn count_tokens(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(_request): Json<serde_json::Value>,
) -> Response {
    if let Err(e) = handlers::verify_api_key(&headers, &state.api_key).await {
        return e.into_response();
    }

    // Claude Code 需要这个端点，返回估算值
    Json(serde_json::json!({
        "input_tokens": 100
    }))
    .into_response()
}

/// Gemini 原生协议处理
/// 路由: POST /v1/gemini/{model}:{method}
/// 例如: /v1/gemini/gemini-3-pro-preview:generateContent
#[allow(dead_code)]
async fn gemini_generate_content(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
    Json(request): Json<serde_json::Value>,
) -> Response {
    if let Err(e) = handlers::verify_api_key(&headers, &state.api_key).await {
        return e.into_response();
    }

    // 解析路径: {model}:{method}
    // 例如: gemini-3-pro-preview:generateContent
    let parts: Vec<&str> = path.splitn(2, ':').collect();
    if parts.len() != 2 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "message": format!("无效的路径格式: {}，期望格式: model:method", path)
                }
            })),
        )
            .into_response();
    }

    let model = parts[0];
    let method = parts[1];

    state.logs.write().await.add(
        "info",
        &format!("[GEMINI] POST /v1/gemini/{path} model={model} method={method}"),
    );

    // 目前只支持 generateContent 方法
    if method != "generateContent" && method != "streamGenerateContent" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "message": format!("不支持的方法: {}，目前只支持 generateContent", method)
                }
            })),
        )
            .into_response();
    }

    let is_stream = method == "streamGenerateContent";

    // 获取默认 provider
    let default_provider = state.default_provider.read().await.clone();

    // 尝试从凭证池中选择凭证（不降级，指定什么就用什么）
    let credential = match &state.db {
        Some(db) => state
            .pool_service
            .select_credential(db, &default_provider, Some(model))
            .ok()
            .flatten(),
        None => None,
    };

    let cred = match credential {
        Some(c) => c,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": {
                        "message": format!("No available credentials for provider '{}'. Please add credentials in the Provider Pool.", default_provider)
                    }
                })),
            )
                .into_response();
        }
    };

    state.logs.write().await.add(
        "info",
        &format!(
            "[GEMINI] 使用凭证: type={} name={:?} uuid={}",
            cred.provider_type,
            cred.name,
            &cred.uuid[..8]
        ),
    );

    // 调用 Antigravity Provider
    match &cred.credential {
        CredentialData::AntigravityOAuth {
            creds_file_path,
            project_id,
        } => {
            let mut antigravity = AntigravityProvider::new();
            if let Err(e) = antigravity
                .load_credentials_from_path(creds_file_path)
                .await
            {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": {
                            "message": format!("加载 Antigravity 凭证失败: {}", e)
                        }
                    })),
                )
                    .into_response();
            }

            // 使用新的 validate_token() 方法检查 Token 状态
            let validation_result = antigravity.validate_token();
            tracing::info!(
                "[Antigravity Gemini] Token 验证结果: {:?}",
                validation_result
            );

            // 根据验证结果决定是否刷新
            if validation_result.needs_refresh() {
                tracing::info!("[Antigravity Gemini] Token 需要刷新，开始刷新...");
                match antigravity.refresh_token_with_retry(3).await {
                    Ok(new_token) => {
                        tracing::info!(
                            "[Antigravity Gemini] Token 刷新成功，新 token 长度: {}",
                            new_token.len()
                        );
                    }
                    Err(refresh_error) => {
                        tracing::error!("[Antigravity Gemini] Token 刷新失败: {:?}", refresh_error);

                        // 根据错误类型返回不同的状态码和消息
                        let (status, message) = if refresh_error.requires_reauth() {
                            (StatusCode::UNAUTHORIZED, refresh_error.user_message())
                        } else {
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                refresh_error.user_message(),
                            )
                        };

                        return (
                            status,
                            Json(serde_json::json!({
                                "error": {
                                    "message": message
                                }
                            })),
                        )
                            .into_response();
                    }
                }
            }

            // 设置项目 ID
            if let Some(pid) = project_id {
                antigravity.project_id = Some(pid.clone());
            } else if antigravity.project_id.is_none() {
                // 如果凭证中没有 project_id，尝试从 API 获取或生成随机 ID
                if let Err(e) = antigravity.discover_project().await {
                    tracing::warn!("[Antigravity] 获取项目 ID 失败: {}，使用随机生成的 ID", e);
                    // 生成随机项目 ID
                    let uuid = uuid::Uuid::new_v4();
                    let bytes = uuid.as_bytes();
                    let adjectives = ["useful", "bright", "swift", "calm", "bold"];
                    let nouns = ["fuze", "wave", "spark", "flow", "core"];
                    let adj = adjectives[(bytes[0] as usize) % adjectives.len()];
                    let noun = nouns[(bytes[1] as usize) % nouns.len()];
                    let random_part: String = uuid.to_string()[..5].to_lowercase();
                    antigravity.project_id = Some(format!("{adj}-{noun}-{random_part}"));
                }
            }

            let proj_id = antigravity.project_id.clone().unwrap_or_else(|| {
                // 最后的后备：生成随机 ID
                let uuid = uuid::Uuid::new_v4();
                format!("lime-{}", &uuid.to_string()[..8])
            });

            state
                .logs
                .write()
                .await
                .add("debug", &format!("[GEMINI] 使用 project_id: {proj_id}"));

            // 构建 Antigravity 请求体
            // 直接使用用户传入的 Gemini 格式请求，只添加必要的字段
            let antigravity_request = build_gemini_native_request(&request, model, &proj_id);

            state.logs.write().await.add(
                "debug",
                &format!(
                    "[GEMINI] 请求体: {}",
                    serde_json::to_string(&antigravity_request).unwrap_or_default()
                ),
            );

            if is_stream {
                // 流式响应 - 暂不支持，返回错误
                return (
                    StatusCode::NOT_IMPLEMENTED,
                    Json(serde_json::json!({
                        "error": {
                            "message": "流式响应暂不支持，请使用 generateContent"
                        }
                    })),
                )
                    .into_response();
            }

            // 非流式响应
            match antigravity
                .call_api("generateContent", &antigravity_request)
                .await
            {
                Ok(resp) => {
                    state.logs.write().await.add(
                        "info",
                        &format!(
                            "[GEMINI] 响应成功: {}",
                            serde_json::to_string(&resp)
                                .unwrap_or_default()
                                .chars()
                                .take(200)
                                .collect::<String>()
                        ),
                    );

                    // 直接返回 Gemini 格式响应
                    Json(resp).into_response()
                }
                Err(api_err) => {
                    state.logs.write().await.add(
                        "error",
                        &format!(
                            "[GEMINI] 请求失败 (HTTP {}): {}",
                            api_err.status_code, api_err.message
                        ),
                    );

                    // 直接使用 AntigravityApiError 的状态码构建响应
                    build_error_response_with_status(api_err.status_code, &api_err.to_string())
                }
            }
        }
        CredentialData::GeminiOAuth {
            creds_file_path,
            project_id,
        } => {
            // 使用 GeminiProvider 处理 Gemini CLI OAuth 凭证
            let mut gemini = GeminiProvider::new();
            if let Err(e) = gemini.load_credentials_from_path(creds_file_path).await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": {
                            "message": format!("加载 Gemini 凭证失败: {}", e)
                        }
                    })),
                )
                    .into_response();
            }

            // 检查并刷新 Token
            if !gemini.is_token_valid() {
                tracing::info!("[Gemini CLI] Token 需要刷新，开始刷新...");
                match gemini.refresh_token_with_retry(3).await {
                    Ok(new_token) => {
                        tracing::info!(
                            "[Gemini CLI] Token 刷新成功，新 token 长度: {}",
                            new_token.len()
                        );
                    }
                    Err(refresh_error) => {
                        tracing::error!("[Gemini CLI] Token 刷新失败: {:?}", refresh_error);
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(serde_json::json!({
                                "error": {
                                    "message": format!("Token 刷新失败: {}", refresh_error)
                                }
                            })),
                        )
                            .into_response();
                    }
                }
            }

            // 设置项目 ID
            if let Some(pid) = project_id {
                gemini.project_id = Some(pid.clone());
            } else if gemini.project_id.is_none() {
                // 尝试从 API 获取项目 ID
                if let Err(e) = gemini.discover_project().await {
                    tracing::warn!("[Gemini CLI] 获取项目 ID 失败: {}，使用随机生成的 ID", e);
                    let uuid = uuid::Uuid::new_v4();
                    let bytes = uuid.as_bytes();
                    let adjectives = ["useful", "bright", "swift", "calm", "bold"];
                    let nouns = ["fuze", "wave", "spark", "flow", "core"];
                    let adj = adjectives[(bytes[0] as usize) % adjectives.len()];
                    let noun = nouns[(bytes[1] as usize) % nouns.len()];
                    let random_part: String = uuid.to_string()[..5].to_lowercase();
                    gemini.project_id = Some(format!("{adj}-{noun}-{random_part}"));
                }
            }

            let proj_id = gemini.project_id.clone().unwrap_or_else(|| {
                let uuid = uuid::Uuid::new_v4();
                format!("lime-{}", &uuid.to_string()[..8])
            });

            state
                .logs
                .write()
                .await
                .add("debug", &format!("[GEMINI CLI] 使用 project_id: {proj_id}"));

            // 构建 Gemini CLI 请求体
            // Gemini CLI 使用 Cloud Code Assist 端点，不做模型名称映射
            let gemini_request = build_gemini_cli_request(&request, model, &proj_id);

            state.logs.write().await.add(
                "debug",
                &format!(
                    "[GEMINI CLI] 请求体: {}",
                    serde_json::to_string(&gemini_request).unwrap_or_default()
                ),
            );

            if is_stream {
                // 流式响应 - 暂不支持
                return (
                    StatusCode::NOT_IMPLEMENTED,
                    Json(serde_json::json!({
                        "error": {
                            "message": "Gemini CLI 流式响应暂不支持，请使用 generateContent"
                        }
                    })),
                )
                    .into_response();
            }

            // 非流式响应
            match gemini.call_api("generateContent", &gemini_request).await {
                Ok(resp) => {
                    state.logs.write().await.add(
                        "info",
                        &format!(
                            "[GEMINI CLI] 响应成功: {}",
                            serde_json::to_string(&resp)
                                .unwrap_or_default()
                                .chars()
                                .take(200)
                                .collect::<String>()
                        ),
                    );

                    // 直接返回 Gemini 格式响应
                    Json(resp).into_response()
                }
                Err(api_err) => {
                    state
                        .logs
                        .write()
                        .await
                        .add("error", &format!("[GEMINI CLI] 请求失败: {api_err}"));

                    build_error_response(&api_err.to_string())
                }
            }
        }
        _ => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "message": "Gemini 原生协议只支持 Antigravity 或 Gemini CLI OAuth 凭证"
                }
            })),
        )
            .into_response(),
    }
}

/// 内部 Anthropic messages 处理 (使用默认 Kiro)
/// 预留：用于内部直接调用 Kiro API
#[allow(dead_code)]
async fn anthropic_messages_internal(
    state: &AppState,
    request: &AnthropicMessagesRequest,
) -> Response {
    // 检查 token
    {
        let _guard = state.kiro_refresh_lock.lock().await;
        let mut kiro = state.kiro.write().await;
        let needs_refresh =
            kiro.credentials.access_token.is_none() || kiro.is_token_expiring_soon();
        if needs_refresh {
            if let Err(e) = kiro.refresh_token().await {
                state
                    .logs
                    .write()
                    .await
                    .add("error", &format!("[AUTH] Token refresh failed: {e}"));
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"error": {"message": format!("Token refresh failed: {e}")}})),
                )
                    .into_response();
            }
        }
    }

    let openai_request = convert_anthropic_to_openai(request);
    let kiro = state.kiro.read().await;

    match kiro.call_api(&openai_request).await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                match resp.bytes().await {
                    Ok(bytes) => {
                        let body = String::from_utf8_lossy(&bytes).to_string();
                        let parsed = parse_cw_response(&body);
                        if request.stream {
                            build_anthropic_stream_response(&request.model, &parsed)
                        } else {
                            build_anthropic_response(&request.model, &parsed)
                        }
                    }
                    Err(e) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                    )
                        .into_response(),
                }
            } else {
                let body = resp.text().await.unwrap_or_default();
                (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                    Json(serde_json::json!({"error": {"message": format!("Upstream error: {}", body)}})),
                )
                    .into_response()
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": {"message": e.to_string()}})),
        )
            .into_response(),
    }
}

/// 内部 OpenAI chat completions 处理 (使用默认 Kiro)
/// 预留：用于内部直接调用 Kiro API
#[allow(dead_code)]
async fn chat_completions_internal(state: &AppState, request: &ChatCompletionRequest) -> Response {
    {
        let _guard = state.kiro_refresh_lock.lock().await;
        let mut kiro = state.kiro.write().await;
        let needs_refresh =
            kiro.credentials.access_token.is_none() || kiro.is_token_expiring_soon();
        if needs_refresh {
            if let Err(e) = kiro.refresh_token().await {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"error": {"message": format!("Token refresh failed: {e}")}})),
                )
                    .into_response();
            }
        }
    }

    let kiro = state.kiro.read().await;
    match kiro.call_api(request).await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                match resp.text().await {
                    Ok(body) => {
                        let parsed = parse_cw_response(&body);
                        let has_tool_calls = !parsed.tool_calls.is_empty();

                        let message = if has_tool_calls {
                            serde_json::json!({
                                "role": "assistant",
                                "content": if parsed.content.is_empty() { serde_json::Value::Null } else { serde_json::json!(parsed.content) },
                                "tool_calls": parsed.tool_calls.iter().map(|tc| {
                                    serde_json::json!({
                                        "id": tc.id,
                                        "type": "function",
                                        "function": {
                                            "name": tc.function.name,
                                            "arguments": tc.function.arguments
                                        }
                                    })
                                }).collect::<Vec<_>>()
                            })
                        } else {
                            serde_json::json!({
                                "role": "assistant",
                                "content": parsed.content
                            })
                        };

                        let response = serde_json::json!({
                            "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                            "object": "chat.completion",
                            "created": std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                            "model": request.model,
                            "choices": [{
                                "index": 0,
                                "message": message,
                                "finish_reason": if has_tool_calls { "tool_calls" } else { "stop" }
                            }],
                            "usage": {
                                "prompt_tokens": 0,
                                "completion_tokens": 0,
                                "total_tokens": 0
                            }
                        });
                        Json(response).into_response()
                    }
                    Err(e) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                    )
                        .into_response(),
                }
            } else {
                let body = resp.text().await.unwrap_or_default();
                (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                    Json(serde_json::json!({"error": {"message": format!("Upstream error: {}", body)}})),
                )
                    .into_response()
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": {"message": e.to_string()}})),
        )
            .into_response(),
    }
}
