//! HTTP 桥接模块
//!
//! 仅在开发模式下启用，允许浏览器 dev server 通过 HTTP 调用 Tauri 命令。
//!
//! 这是一个独立的开发服务器，运行在 3030 端口，与主应用服务器（8999）分离。

#[cfg(debug_assertions)]
pub mod dispatcher;

#[cfg(debug_assertions)]
use axum::{
    extract::State,
    http::{HeaderValue, Method},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
#[cfg(debug_assertions)]
use serde::{Deserialize, Serialize};
#[cfg(debug_assertions)]
use std::sync::Arc;
#[cfg(debug_assertions)]
use tokio::sync::RwLock;
#[cfg(debug_assertions)]
use tower_http::cors::CorsLayer;

#[cfg(debug_assertions)]
use crate::{app, database::DbConnection};
#[cfg(debug_assertions)]
use proxycast_infra::telemetry::StatsAggregator;
#[cfg(debug_assertions)]
use proxycast_services::{
    api_key_provider_service::ApiKeyProviderService, model_registry_service::ModelRegistryService,
    provider_pool_service::ProviderPoolService, skill_service::SkillService,
};
#[cfg(debug_assertions)]
use tauri::AppHandle;

#[cfg(debug_assertions)]
#[derive(Debug, Deserialize)]
pub struct InvokeRequest {
    pub cmd: String,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
}

#[cfg(debug_assertions)]
#[derive(Debug, Serialize)]
pub struct InvokeResponse {
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[cfg(debug_assertions)]
#[derive(Clone)]
pub struct DevBridgeState {
    pub app_handle: Option<AppHandle>,
    pub server: app::AppState,
    pub logs: app::LogState,
    pub db: Option<DbConnection>,
    pub pool_service: Arc<ProviderPoolService>,
    pub api_key_provider_service: Arc<ApiKeyProviderService>,
    pub connect_state: Arc<RwLock<Option<crate::commands::connect_cmd::ConnectState>>>,
    pub model_registry: Arc<RwLock<Option<ModelRegistryService>>>,
    pub skill_service: Arc<SkillService>,
    pub shared_stats: Arc<parking_lot::RwLock<StatsAggregator>>,
}

/// 开发桥接服务器配置
#[cfg(debug_assertions)]
pub struct DevBridgeConfig {
    /// 监听地址
    pub host: String,
    /// 监听端口
    pub port: u16,
}

#[cfg(debug_assertions)]
impl Default for DevBridgeConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3030,
        }
    }
}

/// 开发桥接服务器
#[cfg(debug_assertions)]
pub struct DevBridgeServer;

#[cfg(debug_assertions)]
impl DevBridgeServer {
    /// 启动开发桥接服务器
    ///
    /// 这是一个独立的 HTTP 服务器，仅用于开发模式，
    /// 允许浏览器 dev server 通过 HTTP 调用 Tauri 命令。
    ///
    /// 服务器会在后台持续运行，直到应用退出。
    pub async fn start(
        app_handle: AppHandle,
        server: app::AppState,
        logs: app::LogState,
        db: Option<DbConnection>,
        pool_service: Arc<ProviderPoolService>,
        api_key_provider_service: Arc<ApiKeyProviderService>,
        connect_state: Arc<RwLock<Option<crate::commands::connect_cmd::ConnectState>>>,
        model_registry: Arc<RwLock<Option<ModelRegistryService>>>,
        skill_service: Arc<SkillService>,
        shared_stats: Arc<parking_lot::RwLock<StatsAggregator>>,
        config: Option<DevBridgeConfig>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let config = config.unwrap_or_default();
        let bridge_state = DevBridgeState {
            app_handle: Some(app_handle),
            server,
            logs,
            db,
            pool_service,
            api_key_provider_service,
            connect_state,
            model_registry,
            skill_service,
            shared_stats,
        };

        let allowed_origins = vec![
            HeaderValue::from_static("http://localhost:1420"),
            HeaderValue::from_static("http://127.0.0.1:1420"),
            HeaderValue::from_static("http://localhost:5173"),
            HeaderValue::from_static("http://127.0.0.1:5173"),
        ];

        let app = Router::new()
            .route("/invoke", post(invoke_command))
            .route("/health", get(health_check).post(health_check))
            .layer(
                // CORS 配置 - 允许本地开发前端访问
                CorsLayer::new()
                    .allow_origin(allowed_origins)
                    .allow_methods([Method::POST, Method::GET, Method::OPTIONS])
                    .allow_headers([axum::http::header::CONTENT_TYPE]),
            )
            .with_state(bridge_state);

        let addr = format!("{}:{}", config.host, config.port);
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[DevBridge] 绑定失败: {e} (地址: {addr})");
                return Err(e.into());
            }
        };

        eprintln!("[DevBridge] 正在监听: http://{addr}");

        // 直接运行服务器（不使用 graceful_shutdown）
        // 服务器将持续运行直到应用退出
        tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                tracing::error!("[DevBridge] 运行失败: {}", error);
            }
        });

        Ok(())
    }
}

#[cfg(debug_assertions)]
fn invoke_command(
    State(state): State<DevBridgeState>,
    Json(req): Json<InvokeRequest>,
) -> impl std::future::Future<Output = Response> + Send {
    async move {
        // 调用命令分发器
        match dispatcher::handle_command(&state, &req.cmd, req.args).await {
            Ok(result) => Json(InvokeResponse {
                result: Some(result),
                error: None,
            })
            .into_response(),
            Err(e) => Json(InvokeResponse {
                result: None,
                error: Some(e.to_string()),
            })
            .into_response(),
        }
    }
}

#[cfg(debug_assertions)]
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "DevBridge",
        "version": "1.0.0"
    }))
}
