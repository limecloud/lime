//! HTTP 桥接模块
//!
//! 仅在开发模式下启用，允许浏览器 dev server 通过 HTTP 调用 Tauri 命令。
//!
//! 这是一个独立的开发服务器，运行在 3030 端口，与主应用服务器（8999）分离。

#[cfg(debug_assertions)]
pub mod dispatcher;

#[cfg(debug_assertions)]
use axum::{
    extract::{Query, State},
    http::{request::Parts as RequestParts, HeaderValue, Method},
    response::{
        sse::{Event as SseEvent, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
#[cfg(debug_assertions)]
use serde::{Deserialize, Serialize};
#[cfg(debug_assertions)]
use std::sync::Arc;
#[cfg(debug_assertions)]
use std::{convert::Infallible, time::Duration};
#[cfg(debug_assertions)]
use tokio::sync::RwLock;
#[cfg(debug_assertions)]
use tower_http::cors::{AllowOrigin, CorsLayer};

#[cfg(debug_assertions)]
use crate::{app, database::DbConnection};
#[cfg(debug_assertions)]
use lime_infra::telemetry::StatsAggregator;
#[cfg(debug_assertions)]
use lime_services::{
    api_key_provider_service::ApiKeyProviderService, model_registry_service::ModelRegistryService,
    provider_pool_service::ProviderPoolService, skill_service::SkillService,
};
#[cfg(debug_assertions)]
use tauri::{AppHandle, EventId, Listener};

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
#[derive(Debug, Deserialize)]
pub struct EventStreamRequest {
    pub event: String,
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
fn is_allowed_loopback_origin(origin: &HeaderValue, _request_parts: &RequestParts) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    let Ok(parsed) = url::Url::parse(origin) else {
        return false;
    };

    matches!(parsed.scheme(), "http" | "https")
        && matches!(
            parsed.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("::1")
        )
}

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

        let app = Router::new()
            .route("/invoke", post(invoke_command))
            .route("/events", get(stream_events))
            .route("/health", get(health_check).post(health_check))
            .layer(
                // CORS 配置 - 允许本地开发前端访问
                CorsLayer::new()
                    .allow_origin(AllowOrigin::predicate(is_allowed_loopback_origin))
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
        tauri::async_runtime::spawn(async move {
            match axum::serve(listener, app).await {
                Ok(()) => tracing::warn!("[DevBridge] 服务循环已退出"),
                Err(error) => tracing::error!("[DevBridge] 运行失败: {}", error),
            }
        });

        Ok(())
    }
}

#[cfg(debug_assertions)]
#[derive(Clone)]
struct DevBridgeEventListenerGuard {
    app_handle: AppHandle,
    listener_id: EventId,
}

#[cfg(debug_assertions)]
impl Drop for DevBridgeEventListenerGuard {
    fn drop(&mut self) {
        self.app_handle.unlisten(self.listener_id);
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
async fn stream_events(
    State(state): State<DevBridgeState>,
    Query(req): Query<EventStreamRequest>,
) -> Response {
    let event_name = req.event.trim().to_string();
    if event_name.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "missing event query parameter",
        )
            .into_response();
    }

    let Some(app_handle) = state.app_handle.clone() else {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "dev bridge app handle unavailable",
        )
            .into_response();
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let listener_event_name = event_name.clone();
    let listener_id = app_handle.listen_any(listener_event_name.clone(), move |event| {
        let payload = event.payload();
        let payload_value = serde_json::from_str::<serde_json::Value>(payload)
            .unwrap_or_else(|_| serde_json::Value::String(payload.to_string()));
        let serialized = serde_json::json!({
            "event": listener_event_name.clone(),
            "payload": payload_value,
        })
        .to_string();
        let _ = tx.send(serialized);
    });

    let cleanup_handle = app_handle.clone();
    let stream = async_stream::stream! {
        let _listener_guard = DevBridgeEventListenerGuard {
            app_handle: cleanup_handle,
            listener_id,
        };

        while let Some(payload) = rx.recv().await {
            yield Ok::<SseEvent, Infallible>(SseEvent::default().data(payload));
        }
    };

    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keepalive"),
        )
        .into_response()
}

#[cfg(debug_assertions)]
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "DevBridge",
        "version": "1.0.0"
    }))
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::is_allowed_loopback_origin;
    use axum::http::{request::Parts as RequestParts, HeaderValue, Request};

    fn empty_parts() -> RequestParts {
        let request = Request::builder().uri("/invoke").body(()).unwrap();
        let (parts, _) = request.into_parts();
        parts
    }

    #[test]
    fn allows_loopback_dev_origins_with_any_port() {
        let parts = empty_parts();

        assert!(is_allowed_loopback_origin(
            &HeaderValue::from_static("http://127.0.0.1:1421"),
            &parts,
        ));
        assert!(is_allowed_loopback_origin(
            &HeaderValue::from_static("http://localhost:5173"),
            &parts,
        ));
        assert!(is_allowed_loopback_origin(
            &HeaderValue::from_static("https://localhost:3000"),
            &parts,
        ));
    }

    #[test]
    fn rejects_non_loopback_origins() {
        let parts = empty_parts();

        assert!(!is_allowed_loopback_origin(
            &HeaderValue::from_static("https://example.com"),
            &parts,
        ));
        assert!(!is_allowed_loopback_origin(
            &HeaderValue::from_static("http://192.168.1.10:1420"),
            &parts,
        ));
    }
}
