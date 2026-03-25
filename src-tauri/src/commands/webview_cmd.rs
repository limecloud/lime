//! Webview 管理命令
//!
//! 提供创建和管理独立浏览器窗口的功能。
//! 使用 Tauri 2.x 的 WebviewWindow 创建独立的浏览器窗口。
//!
//! ## 功能
//! - 创建独立的浏览器窗口显示外部 URL
//! - 管理窗口生命周期
//! - 控制窗口位置和大小

use crate::app::AppState;
use crate::database::DbConnection;
use crate::services::automation_service::browser_runtime_sync::{
    complete_browser_session_after_resume, sync_browser_session_runtime_state,
};
use crate::services::browser_profile_service::{
    normalize_browser_profile_key,
    resolve_chrome_profile_data_dir as resolve_managed_chrome_profile_data_dir,
    resolve_chrome_profile_data_dir_from_base as resolve_managed_chrome_profile_data_dir_from_base,
};
use aster::chrome_mcp::{
    get_chrome_mcp_tools, is_chrome_integration_configured, is_chrome_integration_supported,
};
use lime_browser_runtime::{
    BrowserEvent, BrowserRuntimeManager, BrowserStreamMode, CdpSessionState, CdpTargetInfo,
    EventBufferSnapshot, OpenSessionRequest,
};
use lime_server::chrome_bridge::{
    self, ChromeBridgeCommandRequest, ChromeBridgeCommandResult, ChromeBridgeStatusSnapshot,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Arc;
use sysinfo::{Pid, Signal, System};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

/// Webview 面板信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebviewPanelInfo {
    /// 面板 ID
    pub id: String,
    /// 当前 URL
    pub url: String,
    /// 面板标题
    pub title: String,
    /// X 坐标
    pub x: f64,
    /// Y 坐标
    pub y: f64,
    /// 宽度
    pub width: f64,
    /// 高度
    pub height: f64,
}

/// Webview 管理器状态
pub struct WebviewManagerState {
    /// 活跃的 webview 面板
    panels: HashMap<String, WebviewPanelInfo>,
}

impl WebviewManagerState {
    pub fn new() -> Self {
        Self {
            panels: HashMap::new(),
        }
    }
}

impl Default for WebviewManagerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Webview 管理器状态包装
pub struct WebviewManagerWrapper(pub Arc<RwLock<WebviewManagerState>>);

/// Chrome Profile 进程内部状态
struct ChromeProfileProcess {
    profile_key: String,
    browser_source: String,
    browser_path: String,
    profile_dir: String,
    remote_debugging_port: u16,
    started_at: String,
    last_url: String,
    child: Child,
}

impl ChromeProfileProcess {
    fn as_info(&self) -> ChromeProfileSessionInfo {
        ChromeProfileSessionInfo {
            profile_key: self.profile_key.clone(),
            browser_source: self.browser_source.clone(),
            browser_path: self.browser_path.clone(),
            profile_dir: self.profile_dir.clone(),
            remote_debugging_port: self.remote_debugging_port,
            pid: self.child.id(),
            started_at: self.started_at.clone(),
            last_url: self.last_url.clone(),
        }
    }
}

/// Chrome Profile 会话管理器状态
pub struct ChromeProfileManagerState {
    sessions: HashMap<String, ChromeProfileProcess>,
}

impl ChromeProfileManagerState {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

impl Default for ChromeProfileManagerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Chrome Profile 管理器状态包装
pub struct ChromeProfileManagerWrapper(pub Arc<Mutex<ChromeProfileManagerState>>);

static SHARED_CHROME_PROFILE_MANAGER: Lazy<Arc<Mutex<ChromeProfileManagerState>>> =
    Lazy::new(|| Arc::new(Mutex::new(ChromeProfileManagerState::new())));
static SHARED_BROWSER_RUNTIME: Lazy<Arc<BrowserRuntimeManager>> =
    Lazy::new(|| Arc::new(BrowserRuntimeManager::new()));
static BROWSER_STREAM_RELAY_TASKS: Lazy<Mutex<HashMap<String, JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const MANAGED_CHROME_RECOVERY_WAIT_MS: u64 = 800;

pub fn shared_chrome_profile_manager() -> Arc<Mutex<ChromeProfileManagerState>> {
    SHARED_CHROME_PROFILE_MANAGER.clone()
}

pub fn shared_browser_runtime() -> Arc<BrowserRuntimeManager> {
    SHARED_BROWSER_RUNTIME.clone()
}

/// 创建嵌入式 webview 的请求参数
#[derive(Debug, Deserialize)]
pub struct CreateWebviewRequest {
    /// 面板 ID（唯一标识）
    pub panel_id: String,
    /// 要加载的 URL
    pub url: String,
    /// 面板标题
    pub title: Option<String>,
    /// X 坐标（相对于主窗口）- 预留，当前使用居中显示
    #[allow(dead_code)]
    pub x: f64,
    /// Y 坐标（相对于主窗口）- 预留，当前使用居中显示
    #[allow(dead_code)]
    pub y: f64,
    /// 宽度
    pub width: f64,
    /// 高度
    pub height: f64,
    /// Profile 隔离键（用于区分不同站点/用途）
    #[serde(default)]
    pub profile_key: Option<String>,
    /// 是否启用持久化 profile（独立 cookies/localStorage）
    #[serde(default)]
    pub persistent_profile: bool,
}

/// 创建 webview 面板的响应
#[derive(Debug, Serialize)]
pub struct CreateWebviewResponse {
    /// 是否成功
    pub success: bool,
    /// 面板 ID
    pub panel_id: String,
    /// 错误信息（如果有）
    pub error: Option<String>,
}

/// 启动外部 Chrome Profile 的请求参数
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ChromeProfileLaunchOptions {
    #[serde(default)]
    pub proxy_server: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
}

/// 启动外部 Chrome Profile 的请求参数
#[derive(Debug, Deserialize)]
pub struct OpenChromeProfileRequest {
    /// Profile 隔离键（用于不同用途隔离）
    pub profile_key: String,
    /// 要打开的 URL
    pub url: String,
    /// 浏览器启动级选项
    #[serde(default)]
    pub launch_options: Option<ChromeProfileLaunchOptions>,
}

/// 启动外部 Chrome Profile 的响应
#[derive(Debug, Serialize)]
pub struct OpenChromeProfileResponse {
    /// 是否成功
    pub success: bool,
    /// 是否复用已有会话
    pub reused: bool,
    /// 浏览器来源：system / playwright
    pub browser_source: Option<String>,
    /// 浏览器可执行文件路径
    pub browser_path: Option<String>,
    /// Profile 数据目录
    pub profile_dir: Option<String>,
    /// Chrome 远程调试端口
    pub remote_debugging_port: Option<u16>,
    /// Chrome 进程 PID
    pub pid: Option<u32>,
    /// DevTools HTTP 端点
    pub devtools_http_url: Option<String>,
    /// 错误信息（如果有）
    pub error: Option<String>,
}

/// Chrome Profile 会话信息
#[derive(Debug, Clone, Serialize)]
pub struct ChromeProfileSessionInfo {
    /// Profile 隔离键
    pub profile_key: String,
    /// 浏览器来源
    pub browser_source: String,
    /// 浏览器可执行文件路径
    pub browser_path: String,
    /// Profile 目录
    pub profile_dir: String,
    /// 远程调试端口
    pub remote_debugging_port: u16,
    /// 进程 PID
    pub pid: u32,
    /// 启动时间（RFC3339）
    pub started_at: String,
    /// 最近一次打开的 URL
    pub last_url: String,
}

/// Chrome 扩展桥接端点信息
#[derive(Debug, Clone, Serialize)]
pub struct ChromeBridgeEndpointInfo {
    /// 当前服务器是否运行
    pub server_running: bool,
    /// WebSocket 主机
    pub host: String,
    /// WebSocket 端口
    pub port: u16,
    /// observer 通道 URL
    pub observer_ws_url: String,
    /// control 通道 URL
    pub control_ws_url: String,
    /// Bridge Key（与 server.api_key 一致）
    pub bridge_key: String,
}

const ASTER_CHROME_TOOL_PREFIX: &str = "mcp__lime-browser__";
const DEFAULT_BROWSER_ACTION_TIMEOUT_MS: u64 = 30_000;
const MIN_BROWSER_ACTION_TIMEOUT_MS: u64 = 1_000;
const MAX_BROWSER_ACTION_TIMEOUT_MS: u64 = 120_000;
const MANAGED_CDP_READY_MAX_ATTEMPTS: usize = 60;
const MANAGED_CDP_READY_RETRY_INTERVAL_MS: u64 = 250;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum BrowserBackendType {
    AsterCompat,
    LimeExtensionBridge,
    CdpDirect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BrowserBackendPolicy {
    pub priority: Vec<BrowserBackendType>,
    #[serde(default = "default_browser_auto_fallback")]
    pub auto_fallback: bool,
}

fn default_browser_auto_fallback() -> bool {
    true
}

impl Default for BrowserBackendPolicy {
    fn default() -> Self {
        Self {
            priority: vec![
                BrowserBackendType::AsterCompat,
                BrowserBackendType::LimeExtensionBridge,
                BrowserBackendType::CdpDirect,
            ],
            auto_fallback: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserBackendStatusItem {
    pub backend: BrowserBackendType,
    pub available: bool,
    pub reason: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserBackendsStatusSnapshot {
    pub policy: BrowserBackendPolicy,
    pub bridge_observer_count: usize,
    pub bridge_control_count: usize,
    pub running_profile_count: usize,
    pub cdp_alive_profile_count: usize,
    pub aster_native_host_supported: bool,
    pub aster_native_host_configured: bool,
    pub backends: Vec<BrowserBackendStatusItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrowserActionRequest {
    #[serde(default)]
    pub profile_key: Option<String>,
    #[serde(default)]
    pub backend: Option<BrowserBackendType>,
    pub action: String,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserActionAttempt {
    pub backend: BrowserBackendType,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserActionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<BrowserBackendType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub action: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub attempts: Vec<BrowserActionAttempt>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpenCdpSessionRequest {
    pub profile_key: String,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub environment_preset_id: Option<String>,
    #[serde(default)]
    pub environment_preset_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListCdpTargetsRequest {
    #[serde(default)]
    pub profile_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartBrowserStreamRequest {
    pub session_id: String,
    pub mode: BrowserStreamMode,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StopBrowserStreamRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrowserSessionStateRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateBrowserSessionControlRequest {
    pub session_id: String,
    #[serde(default)]
    pub human_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrowserEventBufferRequest {
    pub session_id: String,
    #[serde(default)]
    pub cursor: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventBufferSnapshotResponse {
    pub events: Vec<BrowserEvent>,
    pub next_cursor: u64,
}

impl From<EventBufferSnapshot> for EventBufferSnapshotResponse {
    fn from(value: EventBufferSnapshot) -> Self {
        Self {
            events: value.events,
            next_cursor: value.next_cursor,
        }
    }
}

static BROWSER_BACKEND_POLICY: Lazy<RwLock<BrowserBackendPolicy>> =
    Lazy::new(|| RwLock::new(BrowserBackendPolicy::default()));

const BROWSER_AUDIT_LOG_MAX: usize = 200;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserRuntimeAuditKind {
    Action,
    Launch,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserRuntimeAuditRecord {
    pub id: String,
    pub created_at: String,
    pub kind: BrowserRuntimeAuditKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    pub profile_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_backend: Option<BrowserBackendType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_backend: Option<BrowserBackendType>,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attempts: Vec<BrowserActionAttempt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_preset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_preset_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_window: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_mode: Option<BrowserStreamMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_debugging_port: Option<u16>,
}

pub type BrowserActionAuditRecord = BrowserRuntimeAuditRecord;

#[derive(Debug, Clone)]
pub struct BrowserRuntimeLaunchAuditInput {
    pub profile_key: String,
    pub profile_id: Option<String>,
    pub environment_preset_id: Option<String>,
    pub environment_preset_name: Option<String>,
    pub target_id: Option<String>,
    pub session_id: Option<String>,
    pub url: String,
    pub reused: Option<bool>,
    pub open_window: bool,
    pub stream_mode: BrowserStreamMode,
    pub browser_source: Option<String>,
    pub remote_debugging_port: Option<u16>,
    pub success: bool,
    pub error: Option<String>,
}

impl BrowserRuntimeAuditRecord {
    fn action(
        id: String,
        action: String,
        profile_key: Option<String>,
        requested_backend: Option<BrowserBackendType>,
        selected_backend: Option<BrowserBackendType>,
        success: bool,
        error: Option<String>,
        attempts: Vec<BrowserActionAttempt>,
    ) -> Self {
        Self {
            id,
            created_at: chrono::Utc::now().to_rfc3339(),
            kind: BrowserRuntimeAuditKind::Action,
            action: Some(action),
            profile_key,
            profile_id: None,
            requested_backend,
            selected_backend,
            success,
            error,
            attempts,
            environment_preset_id: None,
            environment_preset_name: None,
            target_id: None,
            session_id: None,
            url: None,
            reused: None,
            open_window: None,
            stream_mode: None,
            browser_source: None,
            remote_debugging_port: None,
        }
    }

    fn launch(input: BrowserRuntimeLaunchAuditInput) -> Self {
        Self {
            id: format!("browser-launch-{}", uuid::Uuid::new_v4()),
            created_at: chrono::Utc::now().to_rfc3339(),
            kind: BrowserRuntimeAuditKind::Launch,
            action: None,
            profile_key: Some(input.profile_key),
            profile_id: input.profile_id,
            requested_backend: None,
            selected_backend: None,
            success: input.success,
            error: input.error,
            attempts: Vec::new(),
            environment_preset_id: input.environment_preset_id,
            environment_preset_name: input.environment_preset_name,
            target_id: input.target_id,
            session_id: input.session_id,
            url: Some(input.url),
            reused: input.reused,
            open_window: Some(input.open_window),
            stream_mode: Some(input.stream_mode),
            browser_source: input.browser_source,
            remote_debugging_port: input.remote_debugging_port,
        }
    }
}

static BROWSER_RUNTIME_AUDIT_LOGS: Lazy<Mutex<VecDeque<BrowserRuntimeAuditRecord>>> =
    Lazy::new(|| Mutex::new(VecDeque::new()));

/// 创建独立的浏览器窗口
///
/// 使用 Tauri 2.x 的 WebviewWindow 创建独立的浏览器窗口。
#[tauri::command]
pub async fn create_webview_panel(
    app: AppHandle,
    state: tauri::State<'_, WebviewManagerWrapper>,
    request: CreateWebviewRequest,
) -> Result<CreateWebviewResponse, String> {
    let panel_id = request.panel_id.clone();
    let url = request.url.clone();
    let title = request.title.unwrap_or_else(|| "Web Browser".to_string());

    tracing::info!(
        "[Webview] 创建独立窗口: id={}, url={}, size={}x{}",
        panel_id,
        url,
        request.width,
        request.height
    );

    // 解析 URL
    let parsed_url = match url.parse::<url::Url>() {
        Ok(parsed_url) => parsed_url,
        Err(e) => {
            return Ok(CreateWebviewResponse {
                success: false,
                panel_id,
                error: Some(format!("无效的 URL: {e}")),
            });
        }
    };
    let webview_url = WebviewUrl::External(parsed_url.clone());

    // 若窗口已存在，复用并导航
    if let Some(window) = app.get_webview_window(&panel_id) {
        let js_url =
            serde_json::to_string(parsed_url.as_str()).map_err(|e| format!("URL 编码失败: {e}"))?;
        let js = format!("window.location.href = {js_url};");
        if let Err(e) = window.eval(&js) {
            tracing::warn!("[Webview] 已存在窗口导航失败: {}", e);
        }
        let _ = window.set_title(&title);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();

        let mut manager = state.0.write().await;
        manager.panels.insert(
            panel_id.clone(),
            WebviewPanelInfo {
                id: panel_id.clone(),
                url,
                title,
                x: 0.0,
                y: 0.0,
                width: request.width,
                height: request.height,
            },
        );

        tracing::info!("[Webview] 复用已存在窗口: {}", panel_id);
        return Ok(CreateWebviewResponse {
            success: true,
            panel_id,
            error: None,
        });
    }

    // 创建独立的 WebviewWindow
    let mut builder = WebviewWindowBuilder::new(&app, &panel_id, webview_url)
        .title(&title)
        .inner_size(request.width, request.height)
        .min_inner_size(400.0, 300.0)
        .resizable(true)
        .center();

    if request.persistent_profile {
        let profile_key = request.profile_key.as_deref().unwrap_or(&panel_id);
        let profile_dir = resolve_profile_data_dir(&app, profile_key)?;
        std::fs::create_dir_all(&profile_dir).map_err(|e| format!("创建 profile 目录失败: {e}"))?;
        builder = builder.data_directory(profile_dir);
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            builder = builder.data_store_identifier(profile_data_store_identifier(profile_key));
        }
    }

    match builder.build() {
        Ok(_window) => {
            // 记录窗口信息
            let mut manager = state.0.write().await;
            manager.panels.insert(
                panel_id.clone(),
                WebviewPanelInfo {
                    id: panel_id.clone(),
                    url,
                    title,
                    x: 0.0,
                    y: 0.0,
                    width: request.width,
                    height: request.height,
                },
            );

            tracing::info!("[Webview] 独立窗口创建成功: {}", panel_id);

            Ok(CreateWebviewResponse {
                success: true,
                panel_id,
                error: None,
            })
        }
        Err(e) => {
            tracing::error!("[Webview] 创建独立窗口失败: {}", e);
            Ok(CreateWebviewResponse {
                success: false,
                panel_id,
                error: Some(format!("创建窗口失败: {e}")),
            })
        }
    }
}

/// 使用独立 profile 启动外部 Chrome 窗口
async fn open_chrome_profile_window_with_manager(
    app: AppHandle,
    app_state: AppState,
    manager: Arc<Mutex<ChromeProfileManagerState>>,
    request: OpenChromeProfileRequest,
) -> Result<OpenChromeProfileResponse, String> {
    let profile_key = normalize_profile_key(&request.profile_key);
    let launch_options = request.launch_options.clone().unwrap_or_default();
    let parsed_url = match request.url.parse::<url::Url>() {
        Ok(url) => url,
        Err(e) => {
            return Ok(OpenChromeProfileResponse {
                success: false,
                reused: false,
                browser_source: None,
                browser_path: None,
                profile_dir: None,
                remote_debugging_port: None,
                pid: None,
                devtools_http_url: None,
                error: Some(format!("无效的 URL: {e}")),
            });
        }
    };
    let url_text = parsed_url.to_string();

    let (browser_path, browser_source) = match get_available_chrome_path() {
        Some(v) => v,
        None => {
            return Ok(OpenChromeProfileResponse {
                success: false,
                reused: false,
                browser_source: None,
                browser_path: None,
                profile_dir: None,
                remote_debugging_port: None,
                pid: None,
                devtools_http_url: None,
                error: Some(
                    "未找到可用的 Chrome/Chromium。请安装 Google Chrome 或运行: npx playwright install chromium"
                        .to_string(),
                ),
            });
        }
    };

    let profile_dir = resolve_chrome_profile_data_dir(&app, &profile_key)?;
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("创建 Chrome profile 目录失败: {e}"))?;
    let remote_port = profile_remote_debugging_port(&profile_key);
    let devtools_http_url = format!("http://127.0.0.1:{remote_port}/json/version");

    if wait_for_managed_cdp_ready(remote_port, None).await.is_ok() {
        if launch_options.proxy_server.is_some() {
            return Err(
                "当前资料已有运行中的浏览器进程；代理属于启动参数，切换代理前请先关闭该资料会话"
                    .to_string(),
            );
        }
        tracing::info!(
            "[ChromeProfile] 复用未登记的 CDP 会话: profile_key={}, port={}",
            profile_key,
            remote_port
        );
        return Ok(OpenChromeProfileResponse {
            success: true,
            reused: true,
            browser_source: Some(browser_source.clone()),
            browser_path: Some(browser_path.clone()),
            profile_dir: Some(profile_dir.to_string_lossy().to_string()),
            remote_debugging_port: Some(remote_port),
            pid: find_chrome_profile_process_pid(&profile_dir),
            devtools_http_url: Some(devtools_http_url),
            error: None,
        });
    }

    let _ = cleanup_orphan_chrome_profile_processes(&profile_dir).await?;

    // 准备 Chrome 扩展（获取 server 配置并生成 auto_config.json）
    let extension_dir = {
        let state_guard = app_state.read().await;
        let status = state_guard.status();
        let host = normalize_bridge_host(&status.host);
        let port = status.port;
        let bridge_key = state_guard.config.server.api_key.clone();
        let server_url = format!("ws://{host}:{port}");

        prepare_chrome_extension(&app, &profile_dir, &server_url, &bridge_key, &profile_key)?
    };

    {
        let mut guard = manager.lock().await;
        if let Some(existing) = guard.sessions.get_mut(&profile_key) {
            match existing.child.try_wait() {
                Ok(None) => {
                    if launch_options.proxy_server.is_some() {
                        return Err(
                            "当前资料已有运行中的浏览器进程；代理属于启动参数，切换代理前请先关闭该资料会话"
                                .to_string(),
                        );
                    }
                    // reuse 场景：不重复加载扩展
                    spawn_chrome_with_profile(
                        &existing.browser_path,
                        Path::new(&existing.profile_dir),
                        existing.remote_debugging_port,
                        &url_text,
                        true,
                        None,
                        &launch_options,
                    )?;
                    existing.last_url = url_text.clone();
                    return Ok(OpenChromeProfileResponse {
                        success: true,
                        reused: true,
                        browser_source: Some(existing.browser_source.clone()),
                        browser_path: Some(existing.browser_path.clone()),
                        profile_dir: Some(existing.profile_dir.clone()),
                        remote_debugging_port: Some(existing.remote_debugging_port),
                        pid: Some(existing.child.id()),
                        devtools_http_url: Some(format!(
                            "http://127.0.0.1:{}/json/version",
                            existing.remote_debugging_port
                        )),
                        error: None,
                    });
                }
                Ok(Some(_)) | Err(_) => {
                    guard.sessions.remove(&profile_key);
                }
            }
        }
    }

    let child = spawn_chrome_with_profile(
        &browser_path,
        &profile_dir,
        remote_port,
        &url_text,
        true,
        Some(&extension_dir),
        &launch_options,
    )?;
    let pid = child.id();

    tracing::info!(
        "[ChromeProfile] 启动浏览器: source={}, path={}, profile_key={}, pid={}, port={}",
        browser_source,
        browser_path,
        profile_key,
        pid,
        remote_port
    );

    {
        let mut guard = manager.lock().await;
        guard.sessions.insert(
            profile_key.clone(),
            ChromeProfileProcess {
                profile_key,
                browser_source: browser_source.clone(),
                browser_path: browser_path.clone(),
                profile_dir: profile_dir.to_string_lossy().to_string(),
                remote_debugging_port: remote_port,
                started_at: chrono::Utc::now().to_rfc3339(),
                last_url: url_text,
                child,
            },
        );
    }

    Ok(OpenChromeProfileResponse {
        success: true,
        reused: false,
        browser_source: Some(browser_source),
        browser_path: Some(browser_path),
        profile_dir: Some(profile_dir.to_string_lossy().to_string()),
        remote_debugging_port: Some(remote_port),
        pid: Some(pid),
        devtools_http_url: Some(devtools_http_url),
        error: None,
    })
}

async fn wait_for_managed_cdp_ready(
    remote_debugging_port: u16,
    requested_target_id: Option<&str>,
) -> Result<(), String> {
    let runtime = shared_browser_runtime();
    let mut last_error =
        format!("等待 CDP 端点就绪: http://127.0.0.1:{remote_debugging_port}/json/version");

    for attempt in 0..MANAGED_CDP_READY_MAX_ATTEMPTS {
        match runtime.list_targets(remote_debugging_port).await {
            Ok(targets) => {
                if let Some(target_id) = requested_target_id {
                    if targets.iter().any(|target| target.id == target_id) {
                        return Ok(());
                    }
                    last_error = if targets.is_empty() {
                        format!("CDP 已连通，但尚未发现 target_id={target_id}")
                    } else {
                        format!("CDP 已连通，但未找到 target_id={target_id}")
                    };
                } else {
                    return Ok(());
                }
            }
            Err(error) => {
                last_error = error;
                if runtime.is_cdp_endpoint_alive(remote_debugging_port).await {
                    last_error = format!("CDP 调试端点已响应，但标签页列表暂不可用: {last_error}");
                }
            }
        }

        if attempt + 1 < MANAGED_CDP_READY_MAX_ATTEMPTS {
            tokio::time::sleep(tokio::time::Duration::from_millis(
                MANAGED_CDP_READY_RETRY_INTERVAL_MS,
            ))
            .await;
        }
    }

    Err(format!("等待 CDP 就绪超时: {last_error}"))
}

#[tauri::command]
pub async fn open_chrome_profile_window(
    app: AppHandle,
    app_state: tauri::State<'_, AppState>,
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
    request: OpenChromeProfileRequest,
) -> Result<OpenChromeProfileResponse, String> {
    open_chrome_profile_window_with_manager(
        app,
        app_state.inner().clone(),
        state.0.clone(),
        request,
    )
    .await
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn open_chrome_profile_window_global(
    app: AppHandle,
    app_state: AppState,
    request: OpenChromeProfileRequest,
) -> Result<OpenChromeProfileResponse, String> {
    open_chrome_profile_window_with_manager(
        app,
        app_state,
        shared_chrome_profile_manager(),
        request,
    )
    .await
}

async fn ensure_managed_chrome_profile_with_manager(
    manager: Arc<Mutex<ChromeProfileManagerState>>,
    profile_key: String,
    url: Option<String>,
) -> Result<ChromeProfileSessionInfo, String> {
    let normalized_profile_key = normalize_profile_key(&profile_key);
    let launch_options = ChromeProfileLaunchOptions::default();
    if let Some(existing) = list_alive_profile_sessions(manager.clone())
        .await
        .into_iter()
        .find(|session| session.profile_key == normalized_profile_key)
    {
        wait_for_managed_cdp_ready(existing.remote_debugging_port, None).await?;
        return Ok(existing);
    }

    let launch_url = url.unwrap_or_else(|| "https://www.google.com".to_string());
    let parsed_url = launch_url
        .parse::<url::Url>()
        .map_err(|error| format!("无效的 URL: {error}"))?;
    let url_text = parsed_url.to_string();

    let (browser_path, browser_source) = get_available_chrome_path().ok_or_else(|| {
        "未找到可用的 Chrome/Chromium。请安装 Google Chrome 或运行: npx playwright install chromium"
            .to_string()
    })?;

    let profile_dir = resolve_chrome_profile_data_dir_from_base(
        &lime_core::app_paths::preferred_data_dir()
            .map_err(|error| format!("获取应用数据目录失败: {error}"))?,
        &normalized_profile_key,
    );
    std::fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("创建 Chrome profile 目录失败: {error}"))?;

    let remote_port = profile_remote_debugging_port(&normalized_profile_key);
    if wait_for_managed_cdp_ready(remote_port, None).await.is_ok() {
        tracing::info!(
            "[ChromeProfile] 复用未登记的受管会话: profile_key={}, port={}",
            normalized_profile_key,
            remote_port
        );
        return Ok(ChromeProfileSessionInfo {
            profile_key: normalized_profile_key,
            browser_source,
            browser_path,
            profile_dir: profile_dir.to_string_lossy().to_string(),
            remote_debugging_port: remote_port,
            pid: find_chrome_profile_process_pid(&profile_dir).unwrap_or_default(),
            started_at: chrono::Utc::now().to_rfc3339(),
            last_url: url_text,
        });
    }

    let _ = cleanup_orphan_chrome_profile_processes(&profile_dir).await?;

    let child = spawn_chrome_with_profile(
        &browser_path,
        &profile_dir,
        remote_port,
        &url_text,
        true,
        None,
        &launch_options,
    )?;
    let pid = child.id();

    let session = ChromeProfileSessionInfo {
        profile_key: normalized_profile_key.clone(),
        browser_source: browser_source.clone(),
        browser_path: browser_path.clone(),
        profile_dir: profile_dir.to_string_lossy().to_string(),
        remote_debugging_port: remote_port,
        pid,
        started_at: chrono::Utc::now().to_rfc3339(),
        last_url: url_text,
    };

    {
        let mut guard = manager.lock().await;
        guard.sessions.insert(
            normalized_profile_key.clone(),
            ChromeProfileProcess {
                profile_key: normalized_profile_key,
                browser_source,
                browser_path,
                profile_dir: session.profile_dir.clone(),
                remote_debugging_port: remote_port,
                started_at: session.started_at.clone(),
                last_url: session.last_url.clone(),
                child,
            },
        );
    }

    wait_for_managed_cdp_ready(remote_port, None).await?;
    Ok(session)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn ensure_managed_chrome_profile_global(
    profile_key: String,
    url: Option<String>,
) -> Result<ChromeProfileSessionInfo, String> {
    ensure_managed_chrome_profile_with_manager(shared_chrome_profile_manager(), profile_key, url)
        .await
}

#[tauri::command]
pub async fn get_chrome_profile_sessions(
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
) -> Result<Vec<ChromeProfileSessionInfo>, String> {
    Ok(list_alive_profile_sessions(state.0.clone()).await)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_chrome_profile_sessions_global() -> Result<Vec<ChromeProfileSessionInfo>, String> {
    Ok(list_alive_profile_sessions(shared_chrome_profile_manager()).await)
}

#[tauri::command]
pub async fn close_chrome_profile_session(
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
    profile_key: String,
) -> Result<bool, String> {
    close_chrome_profile_session_with_manager(state.0.clone(), profile_key).await
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn close_chrome_profile_session_global(profile_key: String) -> Result<bool, String> {
    close_chrome_profile_session_with_manager(shared_chrome_profile_manager(), profile_key).await
}

async fn close_chrome_profile_session_with_manager(
    manager: Arc<Mutex<ChromeProfileManagerState>>,
    profile_key: String,
) -> Result<bool, String> {
    let key = normalize_profile_key(&profile_key);
    let mut manager = manager.lock().await;

    let closed = if let Some(mut process) = manager.sessions.remove(&key) {
        match process.child.try_wait() {
            Ok(Some(_)) => true,
            Ok(None) => {
                if let Err(e) = process.child.kill() {
                    tracing::warn!("[ChromeProfile] 结束进程失败: key={}, err={}", key, e);
                }
                let _ = process.child.wait();
                true
            }
            Err(e) => {
                tracing::warn!("[ChromeProfile] 读取进程状态失败: key={}, err={}", key, e);
                true
            }
        }
    } else {
        false
    };
    drop(manager);

    if let Some(cdp_session) = shared_browser_runtime()
        .find_session_by_profile_key(&key)
        .await
    {
        let _ = shared_browser_runtime()
            .close_session(&cdp_session.session_id)
            .await;
        cleanup_browser_stream_relay(&cdp_session.session_id).await;
    }

    Ok(closed)
}

/// 获取 ChromeBridge 连接端点信息
#[tauri::command]
pub async fn get_chrome_bridge_endpoint_info(
    app_state: tauri::State<'_, AppState>,
) -> Result<ChromeBridgeEndpointInfo, String> {
    get_chrome_bridge_endpoint_info_with_state(app_state.inner().clone()).await
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_chrome_bridge_endpoint_info_global(
    app_state: AppState,
) -> Result<ChromeBridgeEndpointInfo, String> {
    get_chrome_bridge_endpoint_info_with_state(app_state).await
}

async fn get_chrome_bridge_endpoint_info_with_state(
    app_state: AppState,
) -> Result<ChromeBridgeEndpointInfo, String> {
    let state = app_state.read().await;
    let status = state.status();
    let host = normalize_bridge_host(&status.host);
    let port = status.port;
    let bridge_key = state.config.server.api_key.clone();

    Ok(ChromeBridgeEndpointInfo {
        server_running: status.running,
        observer_ws_url: format!("ws://{host}:{port}/lime-chrome-observer/{bridge_key}"),
        control_ws_url: format!("ws://{host}:{port}/lime-chrome-control/{bridge_key}"),
        host,
        port,
        bridge_key,
    })
}

/// 获取 ChromeBridge 状态快照（observer/control/pending）
#[tauri::command]
pub async fn get_chrome_bridge_status() -> Result<ChromeBridgeStatusSnapshot, String> {
    Ok(chrome_bridge::chrome_bridge_hub()
        .get_status_snapshot()
        .await)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_chrome_bridge_status_global() -> Result<ChromeBridgeStatusSnapshot, String> {
    get_chrome_bridge_status().await
}

/// 通过 ChromeBridge 执行命令（用于设置页测试）
#[tauri::command]
pub async fn chrome_bridge_execute_command(
    request: ChromeBridgeCommandRequest,
) -> Result<ChromeBridgeCommandResult, String> {
    chrome_bridge::chrome_bridge_hub()
        .execute_api_command(request)
        .await
}

/// 获取浏览器后端策略
#[tauri::command]
pub async fn get_browser_backend_policy() -> Result<BrowserBackendPolicy, String> {
    Ok(BROWSER_BACKEND_POLICY.read().await.clone())
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_browser_backend_policy_global() -> Result<BrowserBackendPolicy, String> {
    get_browser_backend_policy().await
}

/// 设置浏览器后端策略
#[tauri::command]
pub async fn set_browser_backend_policy(
    policy: BrowserBackendPolicy,
) -> Result<BrowserBackendPolicy, String> {
    let normalized = normalize_backend_policy(policy)?;
    {
        let mut guard = BROWSER_BACKEND_POLICY.write().await;
        *guard = normalized.clone();
    }
    Ok(normalized)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn set_browser_backend_policy_global(
    policy: BrowserBackendPolicy,
) -> Result<BrowserBackendPolicy, String> {
    set_browser_backend_policy(policy).await
}

/// 获取浏览器后端状态快照
#[tauri::command]
pub async fn get_browser_backends_status(
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
) -> Result<BrowserBackendsStatusSnapshot, String> {
    let policy = BROWSER_BACKEND_POLICY.read().await.clone();
    let bridge_status = chrome_bridge::chrome_bridge_hub()
        .get_status_snapshot()
        .await;
    let sessions = list_alive_profile_sessions(state.0.clone()).await;
    let mut cdp_alive = 0usize;
    let runtime = shared_browser_runtime();
    for session in &sessions {
        if runtime
            .is_cdp_endpoint_alive(session.remote_debugging_port)
            .await
        {
            cdp_alive += 1;
        }
    }

    let extension_available = bridge_status.observer_count > 0;
    let cdp_available = cdp_alive > 0;
    let aster_supported = is_chrome_integration_supported();
    let aster_configured = is_chrome_integration_configured().await;
    let aster_available = extension_available || cdp_available || aster_configured;

    Ok(BrowserBackendsStatusSnapshot {
        policy,
        bridge_observer_count: bridge_status.observer_count,
        bridge_control_count: bridge_status.control_count,
        running_profile_count: sessions.len(),
        cdp_alive_profile_count: cdp_alive,
        aster_native_host_supported: aster_supported,
        aster_native_host_configured: aster_configured,
        backends: vec![
            BrowserBackendStatusItem {
                backend: BrowserBackendType::AsterCompat,
                available: aster_available,
                reason: if aster_available {
                    None
                } else {
                    Some("aster 兼容层当前无可用下游连接（扩展/CDP/native-host）".to_string())
                },
                capabilities: aster_backend_capabilities(),
            },
            BrowserBackendStatusItem {
                backend: BrowserBackendType::LimeExtensionBridge,
                available: extension_available,
                reason: if extension_available {
                    None
                } else {
                    Some("未检测到扩展 observer 连接".to_string())
                },
                capabilities: extension_backend_capabilities(),
            },
            BrowserBackendStatusItem {
                backend: BrowserBackendType::CdpDirect,
                available: cdp_available,
                reason: if cdp_available {
                    None
                } else {
                    Some("未检测到可连接的 CDP 调试端口".to_string())
                },
                capabilities: cdp_backend_capabilities(),
            },
        ],
    })
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_browser_backends_status_global() -> Result<BrowserBackendsStatusSnapshot, String> {
    let policy = BROWSER_BACKEND_POLICY.read().await.clone();
    let bridge_status = chrome_bridge::chrome_bridge_hub()
        .get_status_snapshot()
        .await;
    let sessions = list_alive_profile_sessions(shared_chrome_profile_manager()).await;
    let mut cdp_alive = 0usize;
    let runtime = shared_browser_runtime();
    for session in &sessions {
        if runtime
            .is_cdp_endpoint_alive(session.remote_debugging_port)
            .await
        {
            cdp_alive += 1;
        }
    }

    let extension_available = bridge_status.observer_count > 0;
    let cdp_available = cdp_alive > 0;
    let aster_supported = is_chrome_integration_supported();
    let aster_configured = is_chrome_integration_configured().await;
    let aster_available = extension_available || cdp_available || aster_configured;

    Ok(BrowserBackendsStatusSnapshot {
        policy,
        bridge_observer_count: bridge_status.observer_count,
        bridge_control_count: bridge_status.control_count,
        running_profile_count: sessions.len(),
        cdp_alive_profile_count: cdp_alive,
        aster_native_host_supported: aster_supported,
        aster_native_host_configured: aster_configured,
        backends: vec![
            BrowserBackendStatusItem {
                backend: BrowserBackendType::AsterCompat,
                available: aster_available,
                reason: if aster_available {
                    None
                } else {
                    Some("aster 兼容层当前无可用下游连接（扩展/CDP/native-host）".to_string())
                },
                capabilities: aster_backend_capabilities(),
            },
            BrowserBackendStatusItem {
                backend: BrowserBackendType::LimeExtensionBridge,
                available: extension_available,
                reason: if extension_available {
                    None
                } else {
                    Some("未检测到扩展 observer 连接".to_string())
                },
                capabilities: extension_backend_capabilities(),
            },
            BrowserBackendStatusItem {
                backend: BrowserBackendType::CdpDirect,
                available: cdp_available,
                reason: if cdp_available {
                    None
                } else {
                    Some("未检测到可连接的 CDP 调试端口".to_string())
                },
                capabilities: cdp_backend_capabilities(),
            },
        ],
    })
}

#[tauri::command]
pub async fn list_cdp_targets(
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
    request: ListCdpTargetsRequest,
) -> Result<Vec<CdpTargetInfo>, String> {
    let session = select_profile_session(state.0.clone(), request.profile_key).await?;
    shared_browser_runtime()
        .list_targets(session.remote_debugging_port)
        .await
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn list_cdp_targets_global(
    request: ListCdpTargetsRequest,
) -> Result<Vec<CdpTargetInfo>, String> {
    let session =
        select_profile_session(shared_chrome_profile_manager(), request.profile_key).await?;
    shared_browser_runtime()
        .list_targets(session.remote_debugging_port)
        .await
}

#[tauri::command]
pub async fn open_cdp_session(
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
    request: OpenCdpSessionRequest,
) -> Result<CdpSessionState, String> {
    let session =
        select_profile_session(state.0.clone(), Some(request.profile_key.clone())).await?;
    shared_browser_runtime()
        .open_session(OpenSessionRequest {
            profile_key: session.profile_key,
            remote_debugging_port: session.remote_debugging_port,
            target_id: request.target_id,
            environment_preset_id: request.environment_preset_id,
            environment_preset_name: request.environment_preset_name,
        })
        .await
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn open_cdp_session_global(
    request: OpenCdpSessionRequest,
) -> Result<CdpSessionState, String> {
    let session = select_profile_session(
        shared_chrome_profile_manager(),
        Some(request.profile_key.clone()),
    )
    .await?;
    shared_browser_runtime()
        .open_session(OpenSessionRequest {
            profile_key: session.profile_key,
            remote_debugging_port: session.remote_debugging_port,
            target_id: request.target_id,
            environment_preset_id: request.environment_preset_id,
            environment_preset_name: request.environment_preset_name,
        })
        .await
}

#[tauri::command]
pub async fn close_cdp_session(request: BrowserSessionStateRequest) -> Result<bool, String> {
    shared_browser_runtime()
        .close_session(&request.session_id)
        .await?;
    cleanup_browser_stream_relay(&request.session_id).await;
    Ok(true)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn close_cdp_session_global(request: BrowserSessionStateRequest) -> Result<bool, String> {
    close_cdp_session(request).await
}

#[tauri::command]
pub async fn start_browser_stream(
    app: AppHandle,
    request: StartBrowserStreamRequest,
) -> Result<CdpSessionState, String> {
    let runtime = shared_browser_runtime();
    let state = runtime
        .start_stream(&request.session_id, request.mode)
        .await?;
    let receiver = runtime.subscribe(&request.session_id).await?;
    register_browser_stream_relay(app, request.session_id, request.mode, receiver).await;
    Ok(state)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn start_browser_stream_global(
    app: AppHandle,
    request: StartBrowserStreamRequest,
) -> Result<CdpSessionState, String> {
    start_browser_stream(app, request).await
}

#[tauri::command]
pub async fn stop_browser_stream(
    request: StopBrowserStreamRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .stop_stream(&request.session_id)
        .await?;
    cleanup_browser_stream_relay(&request.session_id).await;
    Ok(state)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn stop_browser_stream_global(
    request: StopBrowserStreamRequest,
) -> Result<CdpSessionState, String> {
    stop_browser_stream(request).await
}

#[tauri::command]
pub async fn get_browser_session_state(
    db: tauri::State<'_, DbConnection>,
    request: BrowserSessionStateRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .get_session_state(&request.session_id)
        .await?;
    sync_automation_browser_state(db.inner(), &state, false);
    Ok(state)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_browser_session_state_global(
    db: DbConnection,
    request: BrowserSessionStateRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .get_session_state(&request.session_id)
        .await?;
    sync_automation_browser_state(&db, &state, false);
    Ok(state)
}

#[tauri::command]
pub async fn take_over_browser_session(
    db: tauri::State<'_, DbConnection>,
    request: UpdateBrowserSessionControlRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .take_over_session(&request.session_id, request.human_reason)
        .await?;
    sync_automation_browser_state(db.inner(), &state, false);
    Ok(state)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn take_over_browser_session_global(
    db: DbConnection,
    request: UpdateBrowserSessionControlRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .take_over_session(&request.session_id, request.human_reason)
        .await?;
    sync_automation_browser_state(&db, &state, false);
    Ok(state)
}

#[tauri::command]
pub async fn release_browser_session(
    db: tauri::State<'_, DbConnection>,
    request: UpdateBrowserSessionControlRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .release_session(&request.session_id, request.human_reason)
        .await?;
    sync_automation_browser_state(db.inner(), &state, false);
    Ok(state)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn release_browser_session_global(
    db: DbConnection,
    request: UpdateBrowserSessionControlRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .release_session(&request.session_id, request.human_reason)
        .await?;
    sync_automation_browser_state(&db, &state, false);
    Ok(state)
}

#[tauri::command]
pub async fn resume_browser_session(
    db: tauri::State<'_, DbConnection>,
    request: UpdateBrowserSessionControlRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .resume_session(&request.session_id, request.human_reason)
        .await?;
    sync_automation_browser_state(db.inner(), &state, true);
    Ok(state)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn resume_browser_session_global(
    db: DbConnection,
    request: UpdateBrowserSessionControlRequest,
) -> Result<CdpSessionState, String> {
    let state = shared_browser_runtime()
        .resume_session(&request.session_id, request.human_reason)
        .await?;
    sync_automation_browser_state(&db, &state, true);
    Ok(state)
}

#[tauri::command]
pub async fn get_browser_event_buffer(
    request: BrowserEventBufferRequest,
) -> Result<EventBufferSnapshotResponse, String> {
    let snapshot = shared_browser_runtime()
        .get_event_buffer(&request.session_id, request.cursor)
        .await?;
    Ok(EventBufferSnapshotResponse::from(snapshot))
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_browser_event_buffer_global(
    request: BrowserEventBufferRequest,
) -> Result<EventBufferSnapshotResponse, String> {
    get_browser_event_buffer(request).await
}

fn sync_automation_browser_state(db: &DbConnection, state: &CdpSessionState, finalize: bool) {
    let result = if finalize {
        complete_browser_session_after_resume(db, state)
    } else {
        sync_browser_session_runtime_state(db, state)
    };
    if let Err(error) = result {
        tracing::warn!(
            "[BrowserRuntime] 同步自动化浏览器运行态失败: session_id={}, error={}",
            state.session_id,
            error
        );
    }
}

/// 通过统一编排层执行浏览器动作
#[tauri::command]
pub async fn browser_execute_action(
    _app: AppHandle,
    state: tauri::State<'_, ChromeProfileManagerWrapper>,
    request: BrowserActionRequest,
) -> Result<BrowserActionResult, String> {
    browser_execute_action_with_manager(state.0.clone(), request).await
}

/// 获取浏览器动作审计日志
#[tauri::command]
pub async fn get_browser_action_audit_logs(
    limit: Option<usize>,
) -> Result<Vec<BrowserActionAuditRecord>, String> {
    let max_count = limit
        .unwrap_or(BROWSER_AUDIT_LOG_MAX)
        .min(BROWSER_AUDIT_LOG_MAX);
    let logs = BROWSER_RUNTIME_AUDIT_LOGS.lock().await;
    let mut result = logs.iter().cloned().collect::<Vec<_>>();
    result.reverse();
    result.truncate(max_count);
    Ok(result)
}

#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn get_browser_action_audit_logs_global(
    limit: Option<usize>,
) -> Result<Vec<BrowserActionAuditRecord>, String> {
    get_browser_action_audit_logs(limit).await
}

/// 使用指定 profile manager 执行动作（供非 Tauri 命令入口复用）
pub async fn browser_execute_action_with_manager(
    manager: Arc<Mutex<ChromeProfileManagerState>>,
    request: BrowserActionRequest,
) -> Result<BrowserActionResult, String> {
    let action = normalize_action_name(&request.action)?;
    let request_id = format!("browser-{}", uuid::Uuid::new_v4());
    let policy = BROWSER_BACKEND_POLICY.read().await.clone();
    let candidates = build_backend_candidates(request.backend.clone(), &policy);
    let allow_fallback = request.backend.is_none() && policy.auto_fallback;
    let profile_key = request
        .profile_key
        .as_deref()
        .map(normalize_profile_key)
        .or_else(|| Some("default".to_string()));

    let mut attempts = Vec::new();
    for (idx, backend) in candidates.iter().enumerate() {
        match execute_browser_action_with_backend(
            backend.clone(),
            &action,
            request.args.clone(),
            profile_key.clone(),
            request.timeout_ms,
            manager.clone(),
        )
        .await
        {
            Ok(data) => {
                let enriched_data =
                    enrich_browser_action_value(data, manager.clone(), profile_key.as_deref())
                        .await;
                let (session_id, target_id) = extract_browser_session_and_target(&enriched_data);
                attempts.push(BrowserActionAttempt {
                    backend: backend.clone(),
                    success: true,
                    message: "执行成功".to_string(),
                });
                let result = BrowserActionResult {
                    success: true,
                    backend: Some(backend.clone()),
                    session_id,
                    target_id,
                    action,
                    request_id: request_id.clone(),
                    data: Some(enriched_data),
                    error: None,
                    attempts: attempts.clone(),
                };
                append_browser_runtime_audit(BrowserRuntimeAuditRecord::action(
                    request_id,
                    result.action.clone(),
                    profile_key.clone(),
                    request.backend.clone(),
                    result.backend.clone(),
                    true,
                    None,
                    attempts,
                ))
                .await;
                return Ok(result);
            }
            Err(error) => {
                attempts.push(BrowserActionAttempt {
                    backend: backend.clone(),
                    success: false,
                    message: error.clone(),
                });
                if !allow_fallback || idx + 1 >= candidates.len() {
                    let result = BrowserActionResult {
                        success: false,
                        backend: None,
                        session_id: None,
                        target_id: None,
                        action: action.clone(),
                        request_id: request_id.clone(),
                        data: None,
                        error: Some(error.clone()),
                        attempts: attempts.clone(),
                    };
                    append_browser_runtime_audit(BrowserRuntimeAuditRecord::action(
                        request_id,
                        result.action.clone(),
                        profile_key.clone(),
                        request.backend.clone(),
                        None,
                        false,
                        Some(error),
                        attempts,
                    ))
                    .await;
                    return Ok(result);
                }
            }
        }
    }

    let result = BrowserActionResult {
        success: false,
        backend: None,
        session_id: None,
        target_id: None,
        action: action.clone(),
        request_id: request_id.clone(),
        data: None,
        error: Some("没有可用的浏览器后端".to_string()),
        attempts: attempts.clone(),
    };
    append_browser_runtime_audit(BrowserRuntimeAuditRecord::action(
        request_id,
        action,
        profile_key,
        request.backend,
        None,
        false,
        result.error.clone(),
        attempts,
    ))
    .await;
    Ok(result)
}

/// 使用全局 profile manager 执行动作（供 Agent 工具复用）
#[cfg_attr(any(test, not(debug_assertions)), allow(dead_code))]
pub async fn browser_execute_action_global(
    request: BrowserActionRequest,
) -> Result<BrowserActionResult, String> {
    browser_execute_action_with_manager(shared_chrome_profile_manager(), request).await
}

pub async fn append_browser_runtime_launch_audit(input: BrowserRuntimeLaunchAuditInput) {
    append_browser_runtime_audit(BrowserRuntimeAuditRecord::launch(input)).await;
}

async fn append_browser_runtime_audit(record: BrowserRuntimeAuditRecord) {
    let mut logs = BROWSER_RUNTIME_AUDIT_LOGS.lock().await;
    logs.push_back(record);
    while logs.len() > BROWSER_AUDIT_LOG_MAX {
        logs.pop_front();
    }
}

fn normalize_backend_policy(policy: BrowserBackendPolicy) -> Result<BrowserBackendPolicy, String> {
    let mut priority = Vec::new();
    for backend in policy.priority {
        if !priority.contains(&backend) {
            priority.push(backend);
        }
    }
    for backend in [
        BrowserBackendType::AsterCompat,
        BrowserBackendType::LimeExtensionBridge,
        BrowserBackendType::CdpDirect,
    ] {
        if !priority.contains(&backend) {
            priority.push(backend);
        }
    }
    if priority.is_empty() {
        return Err("后端优先级不能为空".to_string());
    }
    Ok(BrowserBackendPolicy {
        priority,
        auto_fallback: policy.auto_fallback,
    })
}

fn build_backend_candidates(
    forced_backend: Option<BrowserBackendType>,
    policy: &BrowserBackendPolicy,
) -> Vec<BrowserBackendType> {
    if let Some(backend) = forced_backend {
        return vec![backend];
    }
    if policy.priority.is_empty() {
        return BrowserBackendPolicy::default().priority;
    }
    policy.priority.clone()
}

fn normalize_action_name(action: &str) -> Result<String, String> {
    let raw = action.trim();
    if raw.is_empty() {
        return Err("action 不能为空".to_string());
    }
    let stripped = raw
        .strip_prefix(ASTER_CHROME_TOOL_PREFIX)
        .unwrap_or(raw)
        .trim();
    if stripped.is_empty() {
        return Err("action 无效".to_string());
    }
    Ok(stripped.to_ascii_lowercase())
}

fn normalize_action_timeout(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_BROWSER_ACTION_TIMEOUT_MS)
        .clamp(MIN_BROWSER_ACTION_TIMEOUT_MS, MAX_BROWSER_ACTION_TIMEOUT_MS)
}

fn extract_browser_session_and_target(data: &Value) -> (Option<String>, Option<String>) {
    let session_id = read_browser_session_string(data, &["session_id", "sessionId"])
        .or_else(|| {
            read_nested_browser_session_string(
                data,
                "browser_session",
                &["session_id", "sessionId"],
            )
        })
        .or_else(|| {
            read_nested_browser_session_string(data, "session", &["session_id", "sessionId"])
        });
    let target_id = read_browser_session_string(data, &["target_id", "targetId"])
        .or_else(|| {
            read_nested_browser_session_string(data, "browser_session", &["target_id", "targetId"])
        })
        .or_else(|| read_nested_browser_session_string(data, "session", &["target_id", "targetId"]))
        .or_else(|| {
            data.get("tab")
                .and_then(|tab| tab.get("id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        });
    (session_id, target_id)
}

fn read_browser_session_string(data: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        data.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn read_nested_browser_session_string(data: &Value, parent: &str, keys: &[&str]) -> Option<String> {
    let nested = data.get(parent)?;
    read_browser_session_string(nested, keys)
}

fn browser_session_value_from_state(state: &CdpSessionState) -> Value {
    json!({
        "session_id": state.session_id.clone(),
        "profile_key": state.profile_key.clone(),
        "target_id": state.target_id.clone(),
        "target_title": state.target_title.clone(),
        "target_url": state.target_url.clone(),
        "remote_debugging_port": state.remote_debugging_port,
        "ws_debugger_url": state.ws_debugger_url.clone(),
        "devtools_frontend_url": state.devtools_frontend_url.clone(),
        "stream_mode": state.stream_mode,
        "transport_kind": state.transport_kind,
        "lifecycle_state": state.lifecycle_state,
        "control_mode": state.control_mode,
        "human_reason": state.human_reason.clone(),
    })
}

async fn enrich_browser_action_value(
    data: Value,
    manager: Arc<Mutex<ChromeProfileManagerState>>,
    fallback_profile_key: Option<&str>,
) -> Value {
    let mut object = match data {
        Value::Object(object) => object,
        other => {
            let mut object = serde_json::Map::new();
            object.insert("result".to_string(), other);
            object
        }
    };

    let snapshot = Value::Object(object.clone());
    let profile_key = read_browser_session_string(&snapshot, &["profile_key", "profileKey"])
        .or_else(|| {
            read_nested_browser_session_string(
                &snapshot,
                "browser_session",
                &["profile_key", "profileKey"],
            )
        })
        .or_else(|| fallback_profile_key.map(ToString::to_string));
    let session_id =
        read_browser_session_string(&snapshot, &["session_id", "sessionId"]).or_else(|| {
            read_nested_browser_session_string(
                &snapshot,
                "browser_session",
                &["session_id", "sessionId"],
            )
        });
    let target_id = read_browser_session_string(&snapshot, &["target_id", "targetId"])
        .or_else(|| {
            read_nested_browser_session_string(
                &snapshot,
                "browser_session",
                &["target_id", "targetId"],
            )
        })
        .or_else(|| {
            snapshot
                .get("tab")
                .and_then(|tab| tab.get("id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        });

    let runtime = shared_browser_runtime();
    let mut cdp_session = if let Some(existing_session_id) = session_id.as_deref() {
        runtime.get_session_state(existing_session_id).await.ok()
    } else {
        None
    };

    if cdp_session.is_none() {
        if let Some(ref resolved_profile_key) = profile_key {
            if let Ok(profile_session) =
                select_profile_session(manager, Some(resolved_profile_key.clone())).await
            {
                if runtime
                    .is_cdp_endpoint_alive(profile_session.remote_debugging_port)
                    .await
                {
                    cdp_session = ensure_cdp_runtime_session(
                        &runtime,
                        &profile_session,
                        target_id.as_deref(),
                    )
                    .await
                    .ok();
                }
            }
        }
    }

    if let Some(state) = cdp_session {
        object.insert(
            "session_id".to_string(),
            Value::String(state.session_id.clone()),
        );
        object.insert(
            "target_id".to_string(),
            Value::String(state.target_id.clone()),
        );
        object.insert(
            "profile_key".to_string(),
            Value::String(state.profile_key.clone()),
        );
        object.insert(
            "browser_session".to_string(),
            browser_session_value_from_state(&state),
        );
    } else {
        if let Some(value) = session_id {
            object.insert("session_id".to_string(), Value::String(value));
        }
        if let Some(value) = target_id {
            object.insert("target_id".to_string(), Value::String(value));
        }
        if let Some(value) = profile_key {
            object.insert("profile_key".to_string(), Value::String(value));
        }
    }

    Value::Object(object)
}

fn aster_backend_capabilities() -> Vec<String> {
    get_chrome_mcp_tools()
        .into_iter()
        .map(|tool| tool.name)
        .collect()
}

fn extension_backend_capabilities() -> Vec<String> {
    vec![
        "navigate".to_string(),
        "read_page".to_string(),
        "get_page_text".to_string(),
        "find".to_string(),
        "computer".to_string(),
        "form_input".to_string(),
        "tabs_context_mcp".to_string(),
        "open_url".to_string(),
        "click".to_string(),
        "type".to_string(),
        "scroll".to_string(),
        "scroll_page".to_string(),
        "get_page_info".to_string(),
        "refresh_page".to_string(),
        "go_back".to_string(),
        "go_forward".to_string(),
        "switch_tab".to_string(),
        "list_tabs".to_string(),
    ]
}

fn cdp_backend_capabilities() -> Vec<String> {
    vec![
        "tabs_context_mcp".to_string(),
        "navigate".to_string(),
        "read_page".to_string(),
        "get_page_text".to_string(),
        "click".to_string(),
        "type".to_string(),
        "scroll".to_string(),
        "scroll_page".to_string(),
        "refresh_page".to_string(),
        "go_back".to_string(),
        "go_forward".to_string(),
        "get_page_info".to_string(),
        "read_console_messages".to_string(),
        "read_network_requests".to_string(),
    ]
}

fn action_arg_string(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    })
}

fn action_arg_bool(args: &Value, key: &str, default: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn action_arg_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(Value::as_u64)
}

async fn execute_browser_action_with_backend(
    backend: BrowserBackendType,
    action: &str,
    args: Value,
    profile_key: Option<String>,
    timeout_ms: Option<u64>,
    manager: Arc<Mutex<ChromeProfileManagerState>>,
) -> Result<Value, String> {
    match backend {
        BrowserBackendType::LimeExtensionBridge => {
            execute_extension_backend_action(action, args, profile_key, timeout_ms, manager).await
        }
        BrowserBackendType::CdpDirect => {
            execute_cdp_backend_action(action, args, profile_key, manager).await
        }
        BrowserBackendType::AsterCompat => {
            execute_aster_compat_action(action, args, profile_key, timeout_ms, manager).await
        }
    }
}

async fn execute_aster_compat_action(
    action: &str,
    args: Value,
    profile_key: Option<String>,
    timeout_ms: Option<u64>,
    manager: Arc<Mutex<ChromeProfileManagerState>>,
) -> Result<Value, String> {
    match action {
        "tabs_context_mcp" | "read_page" | "get_page_text" => {
            if let Ok(result) = execute_cdp_backend_action(
                action,
                args.clone(),
                profile_key.clone(),
                manager.clone(),
            )
            .await
            {
                return Ok(result);
            }
            execute_extension_backend_action(action, args, profile_key, timeout_ms, manager).await
        }
        "read_console_messages" | "read_network_requests" => {
            execute_cdp_backend_action(action, args, profile_key, manager).await
        }
        "tabs_create_mcp" => {
            let mut next_args = args;
            if action_arg_string(&next_args, &["url"]).is_none() {
                next_args["url"] = Value::String("about:blank".to_string());
            }
            next_args["action"] = Value::String("goto".to_string());
            execute_extension_backend_action(
                "navigate",
                next_args,
                profile_key,
                timeout_ms,
                manager,
            )
            .await
        }
        "shortcuts_list" => Ok(json!({
            "supported": false,
            "message": "当前后端尚未实现 shortcuts_list",
            "shortcuts": [],
        })),
        "update_plan" => Ok(json!({
            "accepted": true,
            "plan": action_arg_string(&args, &["plan"]).unwrap_or_default(),
        })),
        "shortcuts_execute" | "gif_creator" | "upload_image" | "resize_window"
        | "javascript_tool" => Err(format!(
            "aster 兼容层暂不支持 {action}，请切换为扩展桥接或补充实现"
        )),
        _ => execute_extension_backend_action(action, args, profile_key, timeout_ms, manager).await,
    }
}

async fn execute_extension_backend_action(
    action: &str,
    args: Value,
    profile_key: Option<String>,
    timeout_ms: Option<u64>,
    manager: Arc<Mutex<ChromeProfileManagerState>>,
) -> Result<Value, String> {
    match action {
        "navigate" => {
            let nav_action =
                action_arg_string(&args, &["action"]).unwrap_or_else(|| "goto".to_string());
            match nav_action.as_str() {
                "goto" => execute_bridge_api_command(ChromeBridgeCommandRequest {
                    profile_key,
                    command: "open_url".to_string(),
                    target: None,
                    text: None,
                    url: action_arg_string(&args, &["url"]),
                    payload: None,
                    wait_for_page_info: action_arg_bool(&args, "wait_for_page_info", true),
                    timeout_ms: Some(normalize_action_timeout(
                        action_arg_u64(&args, "timeout_ms").or(timeout_ms),
                    )),
                })
                .await
                .map(bridge_result_to_value),
                "back" => execute_bridge_api_command(ChromeBridgeCommandRequest {
                    profile_key,
                    command: "go_back".to_string(),
                    target: None,
                    text: None,
                    url: None,
                    payload: None,
                    wait_for_page_info: action_arg_bool(&args, "wait_for_page_info", true),
                    timeout_ms: Some(normalize_action_timeout(timeout_ms)),
                })
                .await
                .map(bridge_result_to_value),
                "forward" => execute_bridge_api_command(ChromeBridgeCommandRequest {
                    profile_key,
                    command: "go_forward".to_string(),
                    target: None,
                    text: None,
                    url: None,
                    payload: None,
                    wait_for_page_info: action_arg_bool(&args, "wait_for_page_info", true),
                    timeout_ms: Some(normalize_action_timeout(timeout_ms)),
                })
                .await
                .map(bridge_result_to_value),
                "reload" => execute_bridge_api_command(ChromeBridgeCommandRequest {
                    profile_key,
                    command: "refresh_page".to_string(),
                    target: None,
                    text: None,
                    url: None,
                    payload: None,
                    wait_for_page_info: action_arg_bool(&args, "wait_for_page_info", true),
                    timeout_ms: Some(normalize_action_timeout(timeout_ms)),
                })
                .await
                .map(bridge_result_to_value),
                _ => Err(format!("不支持的 navigate.action: {nav_action}")),
            }
        }
        "read_page" | "get_page_text" => execute_bridge_api_command(ChromeBridgeCommandRequest {
            profile_key,
            command: "get_page_info".to_string(),
            target: None,
            text: None,
            url: None,
            payload: None,
            wait_for_page_info: true,
            timeout_ms: Some(normalize_action_timeout(timeout_ms)),
        })
        .await
        .map(bridge_result_to_value),
        "find" => {
            let query = action_arg_string(&args, &["query"])
                .ok_or_else(|| "find 需要 query 参数".to_string())?;
            let response = execute_bridge_api_command(ChromeBridgeCommandRequest {
                profile_key,
                command: "get_page_info".to_string(),
                target: None,
                text: None,
                url: None,
                payload: None,
                wait_for_page_info: true,
                timeout_ms: Some(normalize_action_timeout(timeout_ms)),
            })
            .await?;
            let markdown = response
                .page_info
                .as_ref()
                .map(|v| v.markdown.clone())
                .unwrap_or_default();
            let q = query.to_ascii_lowercase();
            let matches = markdown
                .lines()
                .filter(|line| line.to_ascii_lowercase().contains(&q))
                .take(30)
                .map(|line| line.to_string())
                .collect::<Vec<_>>();
            Ok(json!({
                "query": query,
                "match_count": matches.len(),
                "matches": matches,
                "page_info": response.page_info,
            }))
        }
        "form_input" => execute_bridge_api_command(ChromeBridgeCommandRequest {
            profile_key,
            command: "type".to_string(),
            target: action_arg_string(&args, &["ref_id", "target"]),
            text: action_arg_string(&args, &["value", "text"]),
            url: None,
            payload: None,
            wait_for_page_info: action_arg_bool(&args, "wait_for_page_info", false),
            timeout_ms: Some(normalize_action_timeout(timeout_ms)),
        })
        .await
        .map(bridge_result_to_value),
        "computer" => {
            let computer_action =
                action_arg_string(&args, &["action"]).unwrap_or_else(|| "click".to_string());
            let (command, wait_for_page_info) = match computer_action.as_str() {
                "click" => ("click".to_string(), false),
                "type" => ("type".to_string(), false),
                "scroll" => ("scroll_page".to_string(), false),
                _ => {
                    return Err(format!(
                        "扩展桥接暂不支持 computer.action={computer_action}"
                    ));
                }
            };
            let text_payload = if computer_action == "scroll" {
                let direction =
                    action_arg_string(&args, &["direction"]).unwrap_or_else(|| "down".to_string());
                let amount = action_arg_u64(&args, "amount").unwrap_or(500);
                Some(format!("{direction}:{amount}"))
            } else {
                action_arg_string(&args, &["text"])
            };
            execute_bridge_api_command(ChromeBridgeCommandRequest {
                profile_key,
                command,
                target: action_arg_string(&args, &["ref_id", "target"]),
                text: text_payload,
                url: action_arg_string(&args, &["url"]),
                payload: None,
                wait_for_page_info: action_arg_bool(
                    &args,
                    "wait_for_page_info",
                    wait_for_page_info,
                ),
                timeout_ms: Some(normalize_action_timeout(timeout_ms)),
            })
            .await
            .map(bridge_result_to_value)
        }
        "tabs_context_mcp" => {
            let bridge_status = chrome_bridge::chrome_bridge_hub()
                .get_status_snapshot()
                .await;
            let sessions = list_alive_profile_sessions(manager).await;
            Ok(json!({
                "bridge": {
                    "observer_count": bridge_status.observer_count,
                    "control_count": bridge_status.control_count,
                    "observers": bridge_status.observers,
                },
                "profiles": sessions,
            }))
        }
        "list_tabs" => execute_bridge_api_command(ChromeBridgeCommandRequest {
            profile_key,
            command: "list_tabs".to_string(),
            target: None,
            text: None,
            url: None,
            payload: None,
            wait_for_page_info: false,
            timeout_ms: Some(normalize_action_timeout(timeout_ms)),
        })
        .await
        .map(bridge_result_to_value),
        "open_url" | "click" | "type" | "scroll" | "scroll_page" | "get_page_info"
        | "refresh_page" | "go_back" | "go_forward" | "switch_tab" => {
            execute_bridge_api_command(ChromeBridgeCommandRequest {
                profile_key,
                command: action.to_string(),
                target: action_arg_string(&args, &["target", "ref_id"]),
                text: action_arg_string(&args, &["text", "value"]),
                url: action_arg_string(&args, &["url"]),
                payload: None,
                wait_for_page_info: action_arg_bool(
                    &args,
                    "wait_for_page_info",
                    action == "get_page_info",
                ),
                timeout_ms: Some(normalize_action_timeout(timeout_ms)),
            })
            .await
            .map(bridge_result_to_value)
        }
        "read_console_messages" | "read_network_requests" => {
            Err(format!("扩展桥接暂不支持 {action}"))
        }
        _ => Err(format!("扩展桥接不支持动作: {action}")),
    }
}

async fn execute_cdp_backend_action(
    action: &str,
    args: Value,
    profile_key: Option<String>,
    manager: Arc<Mutex<ChromeProfileManagerState>>,
) -> Result<Value, String> {
    let profile_session = select_profile_session(manager, profile_key).await?;
    let runtime = shared_browser_runtime();
    if !runtime
        .is_cdp_endpoint_alive(profile_session.remote_debugging_port)
        .await
    {
        return Err(format!(
            "CDP 调试端口不可用: 127.0.0.1:{}",
            profile_session.remote_debugging_port
        ));
    }
    let requested_target_id = action_arg_string(&args, &["target_id", "tab_id"]);

    match action {
        "tabs_context_mcp" => {
            let tabs = runtime
                .list_targets(profile_session.remote_debugging_port)
                .await?;
            Ok(json!({
                "profile_key": profile_session.profile_key,
                "remote_debugging_port": profile_session.remote_debugging_port,
                "tabs": tabs,
            }))
        }
        "tabs_create_mcp"
        | "navigate"
        | "click"
        | "type"
        | "form_input"
        | "scroll"
        | "scroll_page"
        | "refresh_page"
        | "go_back"
        | "go_forward"
        | "get_page_info"
        | "read_page"
        | "get_page_text"
        | "read_console_messages"
        | "read_network_requests" => {
            let cdp_session = ensure_cdp_runtime_session(
                &runtime,
                &profile_session,
                requested_target_id.as_deref(),
            )
            .await?;
            let (effective_action, effective_args) = if action == "tabs_create_mcp" {
                let mut next_args = args;
                if action_arg_string(&next_args, &["url"]).is_none() {
                    next_args["url"] = Value::String("about:blank".to_string());
                }
                next_args["action"] = Value::String("goto".to_string());
                ("navigate", next_args)
            } else {
                (action, args)
            };
            let result = runtime
                .execute_action(&cdp_session.session_id, effective_action, effective_args)
                .await?;
            match result {
                Value::Object(mut object) => {
                    object.insert(
                        "session_id".to_string(),
                        Value::String(cdp_session.session_id),
                    );
                    object.insert(
                        "target_id".to_string(),
                        Value::String(cdp_session.target_id),
                    );
                    object.insert(
                        "profile_key".to_string(),
                        Value::String(cdp_session.profile_key),
                    );
                    Ok(Value::Object(object))
                }
                other => Ok(json!({
                    "session_id": cdp_session.session_id,
                    "target_id": cdp_session.target_id,
                    "profile_key": cdp_session.profile_key,
                    "result": other,
                })),
            }
        }
        _ => Err(format!("CDP 直连不支持动作: {action}")),
    }
}

async fn execute_bridge_api_command(
    request: ChromeBridgeCommandRequest,
) -> Result<ChromeBridgeCommandResult, String> {
    chrome_bridge::chrome_bridge_hub()
        .execute_api_command(request)
        .await
}

fn bridge_result_to_value(result: ChromeBridgeCommandResult) -> Value {
    json!({
        "success": result.success,
        "request_id": result.request_id,
        "command": result.command,
        "message": result.message,
        "error": result.error,
        "page_info": result.page_info,
        "data": result.data,
    })
}

async fn register_browser_stream_relay(
    app: AppHandle,
    session_id: String,
    mode: BrowserStreamMode,
    mut receiver: tokio::sync::broadcast::Receiver<BrowserEvent>,
) {
    cleanup_browser_stream_relay(&session_id).await;
    let relay_key = session_id.clone();
    let task = tokio::spawn(async move {
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    if mode == BrowserStreamMode::Frames && !event.is_frame_related() {
                        continue;
                    }
                    if mode == BrowserStreamMode::Events && event.is_frame_related() {
                        continue;
                    }
                    if let Err(error) = app.emit("browser-event", &event) {
                        tracing::warn!("[BrowserRuntime] 推送浏览器事件失败: {}", error);
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    });
    BROWSER_STREAM_RELAY_TASKS
        .lock()
        .await
        .insert(relay_key, task);
}

async fn cleanup_browser_stream_relay(session_id: &str) {
    if let Some(task) = BROWSER_STREAM_RELAY_TASKS.lock().await.remove(session_id) {
        task.abort();
    }
}

async fn discover_unmanaged_profile_session(
    profile_key: &str,
) -> Result<Option<ChromeProfileSessionInfo>, String> {
    let normalized_profile_key = normalize_profile_key(profile_key);
    let base_dir = lime_core::app_paths::preferred_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    let profile_dir = resolve_chrome_profile_data_dir_from_base(&base_dir, &normalized_profile_key);
    if !profile_dir.exists() {
        return Ok(None);
    }

    let remote_debugging_port = profile_remote_debugging_port(&normalized_profile_key);
    let runtime = shared_browser_runtime();
    let targets = match runtime.list_targets(remote_debugging_port).await {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let pid = find_chrome_profile_process_pid(&profile_dir).unwrap_or_default();

    let (browser_path, browser_source) =
        get_available_chrome_path().unwrap_or_else(|| (String::new(), "system".to_string()));
    let last_url = targets
        .iter()
        .find(|target| target.target_type == "page" && !target.url.trim().is_empty())
        .map(|target| target.url.trim().to_string())
        .unwrap_or_else(|| "about:blank".to_string());

    Ok(Some(ChromeProfileSessionInfo {
        profile_key: normalized_profile_key,
        browser_source,
        browser_path,
        profile_dir: profile_dir.to_string_lossy().to_string(),
        remote_debugging_port,
        pid,
        started_at: chrono::Utc::now().to_rfc3339(),
        last_url,
    }))
}

async fn discover_unmanaged_profile_sessions() -> Result<Vec<ChromeProfileSessionInfo>, String> {
    let base_dir = lime_core::app_paths::preferred_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    let chrome_profiles_dir = base_dir.join("chrome_profiles");
    if !chrome_profiles_dir.exists() {
        return Ok(Vec::new());
    }

    let mut discovered = Vec::new();
    let entries = std::fs::read_dir(&chrome_profiles_dir)
        .map_err(|error| format!("读取 Chrome profile 目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Chrome profile 条目失败: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取 Chrome profile 类型失败: {error}"))?;
        if !file_type.is_dir() {
            continue;
        }

        let profile_key = entry.file_name().to_string_lossy().to_string();
        if let Some(session) = discover_unmanaged_profile_session(&profile_key).await? {
            discovered.push(session);
        }
    }

    discovered.sort_by(|left, right| left.profile_key.cmp(&right.profile_key));
    Ok(discovered)
}

async fn list_alive_profile_sessions(
    manager: Arc<Mutex<ChromeProfileManagerState>>,
) -> Vec<ChromeProfileSessionInfo> {
    let mut guard = manager.lock().await;
    let mut stale_keys = Vec::new();
    let mut sessions = Vec::new();

    for (key, process) in &mut guard.sessions {
        match process.child.try_wait() {
            Ok(None) => sessions.push(process.as_info()),
            Ok(Some(_)) => stale_keys.push(key.clone()),
            Err(_) => stale_keys.push(key.clone()),
        }
    }

    for key in stale_keys {
        guard.sessions.remove(&key);
    }

    let managed_profile_keys = sessions
        .iter()
        .map(|session| session.profile_key.clone())
        .collect::<HashSet<_>>();
    drop(guard);

    let unmanaged_sessions = match discover_unmanaged_profile_sessions().await {
        Ok(items) => items,
        Err(error) => {
            tracing::warn!("[ChromeProfile] 发现未受管会话失败: {}", error);
            Vec::new()
        }
    };

    sessions.extend(
        unmanaged_sessions
            .into_iter()
            .filter(|session| !managed_profile_keys.contains(&session.profile_key)),
    );
    sessions
}

async fn select_profile_session(
    manager: Arc<Mutex<ChromeProfileManagerState>>,
    profile_key: Option<String>,
) -> Result<ChromeProfileSessionInfo, String> {
    let sessions = list_alive_profile_sessions(manager).await;
    if sessions.is_empty() {
        return Err("没有可用的 Chrome profile 会话，请先打开独立浏览器窗口".to_string());
    }

    if let Some(key) = profile_key {
        let normalized = normalize_profile_key(&key);
        if let Some(session) = sessions.into_iter().find(|v| v.profile_key == normalized) {
            return Ok(session);
        }
        return Err(format!("未找到 profile_key={} 的会话", normalized));
    }

    sessions
        .into_iter()
        .next()
        .ok_or_else(|| "没有可用的 Chrome profile 会话".to_string())
}

async fn ensure_cdp_runtime_session(
    runtime: &BrowserRuntimeManager,
    profile_session: &ChromeProfileSessionInfo,
    target_id: Option<&str>,
) -> Result<CdpSessionState, String> {
    if let Some(existing) = runtime
        .find_session_by_profile_key(&profile_session.profile_key)
        .await
    {
        if target_id.is_none() || Some(existing.target_id.as_str()) == target_id {
            return Ok(existing);
        }
        runtime.close_session(&existing.session_id).await?;
        cleanup_browser_stream_relay(&existing.session_id).await;
    }

    runtime
        .open_session(OpenSessionRequest {
            profile_key: profile_session.profile_key.clone(),
            remote_debugging_port: profile_session.remote_debugging_port,
            target_id: target_id.map(ToString::to_string),
            environment_preset_id: None,
            environment_preset_name: None,
        })
        .await
}

fn normalize_profile_key(input: &str) -> String {
    normalize_browser_profile_key(input)
}

fn normalize_bridge_host(host: &str) -> String {
    match host.trim() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1".to_string(),
        value => value.to_string(),
    }
}

fn profile_remote_debugging_port(profile_key: &str) -> u16 {
    const BASE_PORT: u16 = 13000;
    const RANGE: u16 = 4000;

    let mut hash: u64 = 1469598103934665603;
    for byte in profile_key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    BASE_PORT + (hash as u16 % RANGE)
}

/// 递归复制目录
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {e}"))?;

    for entry in std::fs::read_dir(src).map_err(|e| format!("读取源目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path)?;
        } else {
            std::fs::copy(&path, &dst_path)
                .map_err(|e| format!("复制文件失败 {:?}: {e}", file_name))?;
        }
    }
    Ok(())
}

/// 准备 Chrome 扩展（复制到 profile 目录并生成配置）
fn prepare_chrome_extension(
    app: &AppHandle,
    profile_dir: &Path,
    server_url: &str,
    bridge_key: &str,
    profile_key: &str,
) -> Result<PathBuf, String> {
    // 确定扩展源路径
    let extension_src = if cfg!(debug_assertions) {
        // 开发模式：从当前目录向上查找项目根目录
        let current_dir = std::env::current_dir().map_err(|e| format!("获取当前目录失败: {e}"))?;

        // 如果当前目录是 src-tauri，则向上一级
        let project_root = if current_dir.ends_with("src-tauri") {
            current_dir
                .parent()
                .ok_or_else(|| "无法获取项目根目录".to_string())?
                .to_path_buf()
        } else {
            current_dir
        };

        project_root.join("extensions").join("lime-chrome")
    } else {
        // 打包模式：使用资源目录
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("获取资源目录失败: {e}"))?;
        resource_dir.join("extensions").join("lime-chrome")
    };

    if !extension_src.exists() {
        return Err(format!("扩展源目录不存在: {:?}", extension_src));
    }

    // 目标路径：profile_dir/lime_extension
    let extension_dst = profile_dir.join("lime_extension");

    // 如果目标目录已存在，先删除（确保使用最新版本）
    if extension_dst.exists() {
        std::fs::remove_dir_all(&extension_dst).map_err(|e| format!("删除旧扩展目录失败: {e}"))?;
    }

    // 复制扩展文件
    copy_dir_recursive(&extension_src, &extension_dst)?;

    // 生成 auto_config.json
    let auto_config = json!({
        "serverUrl": server_url,
        "bridgeKey": bridge_key,
        "profileKey": profile_key,
        "monitoringEnabled": true,
    });

    let config_path = extension_dst.join("auto_config.json");
    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&auto_config).unwrap(),
    )
    .map_err(|e| format!("写入 auto_config.json 失败: {e}"))?;

    tracing::info!(
        "[ChromeExtension] 扩展已准备: dst={:?}, config={:?}",
        extension_dst,
        config_path
    );

    Ok(extension_dst)
}

fn spawn_chrome_with_profile(
    browser_path: &str,
    profile_dir: &Path,
    remote_debugging_port: u16,
    url: &str,
    new_window: bool,
    extension_dir: Option<&Path>,
    launch_options: &ChromeProfileLaunchOptions,
) -> Result<Child, String> {
    let profile_arg = format!("--user-data-dir={}", profile_dir.to_string_lossy());
    let mut cmd = Command::new(browser_path);
    cmd.arg(profile_arg)
        .arg(format!("--remote-debugging-port={remote_debugging_port}"))
        .arg("--remote-allow-origins=*")
        .arg("--no-first-run")
        .arg("--no-default-browser-check");

    if let Some(proxy_server) = launch_options.proxy_server.as_deref() {
        cmd.arg(format!("--proxy-server={proxy_server}"));
    }
    if let Some(language) = launch_options.language.as_deref() {
        cmd.arg(format!("--lang={language}"));
    }

    // 如果提供了扩展目录，添加 --load-extension 参数
    if let Some(ext_dir) = extension_dir {
        cmd.arg(format!("--load-extension={}", ext_dir.to_string_lossy()));
    }

    if new_window {
        cmd.arg("--new-window");
    }
    cmd.arg(url);
    cmd.spawn().map_err(|e| format!("启动 Chrome 失败: {e}"))
}

fn chrome_process_uses_profile_dir(args: &[OsString], profile_dir: &Path) -> bool {
    let expected = profile_dir.to_string_lossy();
    let expected_owned = expected.as_ref();

    for (index, arg) in args.iter().enumerate() {
        let value = arg.to_string_lossy();
        if value == format!("--user-data-dir={expected_owned}") {
            return true;
        }
        if value == "--user-data-dir" {
            if let Some(next) = args.get(index + 1) {
                if next.to_string_lossy() == expected_owned {
                    return true;
                }
            }
        }
    }

    false
}

fn collect_chrome_profile_processes(profile_dir: &Path) -> Vec<Pid> {
    let mut system = System::new_all();
    system.refresh_all();

    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let process_name = process.name().to_string_lossy().to_lowercase();
            if !process_name.contains("chrome") && !process_name.contains("chromium") {
                return None;
            }
            if chrome_process_uses_profile_dir(process.cmd(), profile_dir) {
                return Some(*pid);
            }
            None
        })
        .collect()
}

fn find_chrome_profile_process_pid(profile_dir: &Path) -> Option<u32> {
    collect_chrome_profile_processes(profile_dir)
        .into_iter()
        .next()
        .map(|pid| pid.as_u32())
}

fn cleanup_chrome_profile_singleton_artifacts(profile_dir: &Path) {
    for name in ["SingletonLock", "SingletonCookie", "SingletonSocket"] {
        let path = profile_dir.join(name);
        let result = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(error) = result {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    "[ChromeProfile] 清理 profile 锁文件失败: path={:?}, err={}",
                    path,
                    error
                );
            }
        }
    }
}

async fn cleanup_orphan_chrome_profile_processes(profile_dir: &Path) -> Result<bool, String> {
    let mut system = System::new_all();
    system.refresh_all();

    let target_pids = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let process_name = process.name().to_string_lossy().to_lowercase();
            if !process_name.contains("chrome") && !process_name.contains("chromium") {
                return None;
            }
            if chrome_process_uses_profile_dir(process.cmd(), profile_dir) {
                return Some(*pid);
            }
            None
        })
        .collect::<Vec<_>>();

    if target_pids.is_empty() {
        return Ok(false);
    }

    tracing::warn!(
        "[ChromeProfile] 检测到未受管 profile 进程，准备清理: profile_dir={:?}, pids={:?}",
        profile_dir,
        target_pids
            .iter()
            .map(|pid| pid.as_u32())
            .collect::<Vec<_>>()
    );

    for pid in &target_pids {
        if let Some(process) = system.process(*pid) {
            let terminated = process.kill_with(Signal::Term).unwrap_or(false);
            if !terminated {
                let _ = process.kill();
            }
        }
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(
        MANAGED_CHROME_RECOVERY_WAIT_MS,
    ))
    .await;
    cleanup_chrome_profile_singleton_artifacts(profile_dir);
    Ok(true)
}

fn resolve_profile_data_dir_from_base(base_dir: &Path, profile_key: &str) -> PathBuf {
    let effective_key = normalize_profile_key(profile_key);
    base_dir.join("webview_profiles").join(effective_key)
}

fn resolve_chrome_profile_data_dir_from_base(base_dir: &Path, profile_key: &str) -> PathBuf {
    resolve_managed_chrome_profile_data_dir_from_base(base_dir, profile_key)
}

fn resolve_profile_data_dir(app: &AppHandle, profile_key: &str) -> Result<PathBuf, String> {
    let _ = app;
    let base_dir = lime_core::app_paths::preferred_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(resolve_profile_data_dir_from_base(&base_dir, profile_key))
}

fn resolve_chrome_profile_data_dir(app: &AppHandle, profile_key: &str) -> Result<PathBuf, String> {
    let _ = app;
    resolve_managed_chrome_profile_data_dir(profile_key)
}

fn get_system_chrome_path() -> Option<String> {
    #[cfg_attr(
        not(any(target_os = "macos", target_os = "windows")),
        allow(unused_variables)
    )]
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        let paths = [
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ];
        for path in paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let paths = [
            PathBuf::from("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"),
            PathBuf::from("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"),
            home.join("AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
        ];
        for path in paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let paths = [
            PathBuf::from("/usr/bin/google-chrome"),
            PathBuf::from("/usr/bin/google-chrome-stable"),
            PathBuf::from("/usr/bin/chromium"),
            PathBuf::from("/usr/bin/chromium-browser"),
            PathBuf::from("/snap/bin/chromium"),
        ];
        for path in paths {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }

    None
}

fn get_playwright_cache_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        home.join("Library").join("Caches").join("ms-playwright")
    }

    #[cfg(target_os = "windows")]
    {
        home.join("AppData").join("Local").join("ms-playwright")
    }

    #[cfg(target_os = "linux")]
    {
        home.join(".cache").join("ms-playwright")
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        home.join(".cache").join("ms-playwright")
    }
}

fn get_playwright_chrome_path() -> Option<String> {
    let cache_dir = get_playwright_cache_dir();
    let entries = std::fs::read_dir(&cache_dir).ok()?;
    let mut candidates: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("chromium-") || name == "chromium")
                .unwrap_or(false)
        })
        .collect();

    candidates.sort_by(|a, b| b.cmp(a));

    for base in candidates {
        #[cfg(target_os = "macos")]
        let exec_path = base
            .join("chrome-mac")
            .join("Chromium.app")
            .join("Contents")
            .join("MacOS")
            .join("Chromium");

        #[cfg(target_os = "windows")]
        let exec_path = base.join("chrome-win").join("chrome.exe");

        #[cfg(target_os = "linux")]
        let exec_path = base.join("chrome-linux").join("chrome");

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let exec_path = base.join("chrome-linux").join("chrome");

        if exec_path.exists() {
            return Some(exec_path.to_string_lossy().to_string());
        }
    }

    None
}

fn get_available_chrome_path() -> Option<(String, String)> {
    if let Some(path) = get_system_chrome_path() {
        return Some((path, "system".to_string()));
    }
    get_playwright_chrome_path().map(|path| (path, "playwright".to_string()))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn profile_data_store_identifier(profile_key: &str) -> [u8; 16] {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    fn fnv1a64(bytes: &[u8], seed: u64) -> u64 {
        let mut hash = FNV_OFFSET_BASIS ^ seed;
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        hash
    }

    let bytes = profile_key.as_bytes();
    let h1 = fnv1a64(bytes, 0x9e3779b185ebca87);
    let h2 = fnv1a64(bytes, 0xc2b2ae3d27d4eb4f);

    let mut out = [0_u8; 16];
    out[..8].copy_from_slice(&h1.to_le_bytes());
    out[8..].copy_from_slice(&h2.to_le_bytes());
    out
}

/// 关闭浏览器窗口
#[tauri::command]
pub async fn close_webview_panel(
    app: AppHandle,
    state: tauri::State<'_, WebviewManagerWrapper>,
    panel_id: String,
) -> Result<bool, String> {
    tracing::info!("[Webview] 尝试关闭窗口: {}", panel_id);

    // 获取并关闭窗口
    match app.get_webview_window(&panel_id) {
        Some(window) => {
            tracing::info!("[Webview] 找到窗口: {}", panel_id);

            // 关闭窗口
            match window.close() {
                Ok(_) => {
                    tracing::info!("[Webview] 窗口已关闭: {}", panel_id);
                }
                Err(e) => {
                    tracing::error!("[Webview] 关闭窗口失败: {}", e);
                }
            }
        }
        None => {
            tracing::warn!("[Webview] 未找到窗口: {}", panel_id);
        }
    }

    // 从状态中移除
    let mut manager = state.0.write().await;
    manager.panels.remove(&panel_id);

    tracing::info!("[Webview] 窗口已从状态中移除: {}", panel_id);
    Ok(true)
}

/// 导航到新 URL
#[tauri::command]
pub async fn navigate_webview_panel(
    app: AppHandle,
    state: tauri::State<'_, WebviewManagerWrapper>,
    panel_id: String,
    url: String,
) -> Result<bool, String> {
    tracing::info!("[Webview] 导航窗口 {} 到: {}", panel_id, url);

    // 解析 URL
    let parsed_url = url
        .parse::<url::Url>()
        .map_err(|e| format!("无效的 URL: {e}"))?;

    // 获取窗口并导航
    if let Some(window) = app.get_webview_window(&panel_id) {
        // 使用 eval 来导航
        let js = format!("window.location.href = '{parsed_url}';");
        window.eval(&js).map_err(|e| format!("导航失败: {e}"))?;

        // 更新状态中的 URL
        let mut manager = state.0.write().await;
        if let Some(panel) = manager.panels.get_mut(&panel_id) {
            panel.url = url;
        }

        Ok(true)
    } else {
        Err(format!("窗口不存在: {panel_id}"))
    }
}

/// 调整窗口大小（独立窗口不需要位置参数）
#[tauri::command]
pub async fn resize_webview_panel(
    app: AppHandle,
    state: tauri::State<'_, WebviewManagerWrapper>,
    panel_id: String,
    _x: f64,
    _y: f64,
    width: f64,
    height: f64,
) -> Result<bool, String> {
    tracing::info!(
        "[Webview] 调整窗口 {} 大小: size={}x{}",
        panel_id,
        width,
        height
    );

    // 获取窗口
    if let Some(window) = app.get_webview_window(&panel_id) {
        // 设置大小
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| format!("设置大小失败: {e}"))?;

        // 更新状态
        let mut manager = state.0.write().await;
        if let Some(panel) = manager.panels.get_mut(&panel_id) {
            panel.width = width;
            panel.height = height;
        }

        Ok(true)
    } else {
        Err(format!("窗口不存在: {panel_id}"))
    }
}

/// 获取所有活跃的浏览器窗口
#[tauri::command]
pub async fn get_webview_panels(
    app: AppHandle,
    state: tauri::State<'_, WebviewManagerWrapper>,
) -> Result<Vec<WebviewPanelInfo>, String> {
    let stale_panel_ids = {
        let manager = state.0.read().await;
        manager
            .panels
            .keys()
            .filter(|panel_id| app.get_webview_window(panel_id).is_none())
            .cloned()
            .collect::<Vec<_>>()
    };

    if !stale_panel_ids.is_empty() {
        let mut manager = state.0.write().await;
        for panel_id in stale_panel_ids {
            manager.panels.remove(&panel_id);
        }
    }

    let manager = state.0.read().await;
    Ok(manager.panels.values().cloned().collect())
}

/// 聚焦指定的浏览器窗口
#[tauri::command]
pub async fn focus_webview_panel(app: AppHandle, panel_id: String) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(&panel_id) {
        let _ = window.unminimize();
        window.show().map_err(|e| format!("显示窗口失败: {e}"))?;
        window.set_focus().map_err(|e| format!("聚焦失败: {e}"))?;
        Ok(true)
    } else {
        Err(format!("窗口不存在: {panel_id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::browser_profile_service::sanitize_browser_profile_key;

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    #[test]
    fn profile_data_store_identifier_should_be_stable_for_same_key() {
        let left = profile_data_store_identifier("search_google");
        let right = profile_data_store_identifier("search_google");
        assert_eq!(left, right);
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    #[test]
    fn profile_data_store_identifier_should_differ_for_different_keys() {
        let left = profile_data_store_identifier("search_google");
        let right = profile_data_store_identifier("search_xiaohongshu");
        assert_ne!(left, right);
    }

    #[test]
    fn resolve_profile_data_dir_should_join_expected_segments() {
        let base = PathBuf::from("lime_data");
        let path = resolve_profile_data_dir_from_base(&base, "search_google");
        assert_eq!(
            path,
            PathBuf::from("lime_data/webview_profiles/search_google")
        );
    }

    #[test]
    fn sanitize_profile_key_should_replace_unsafe_chars() {
        let safe = sanitize_browser_profile_key("search/google:zh-CN");
        assert_eq!(safe, "search_google_zh-CN");
    }

    #[test]
    fn normalize_profile_key_should_fallback_to_default() {
        let normalized = normalize_profile_key("///");
        assert_eq!(normalized, "default");
    }

    #[test]
    fn profile_remote_debugging_port_should_be_stable() {
        let left = profile_remote_debugging_port("search_google");
        let right = profile_remote_debugging_port("search_google");
        assert_eq!(left, right);
        assert!((13000..17000).contains(&left));
    }

    #[test]
    fn profile_remote_debugging_port_should_differ_for_different_keys() {
        let left = profile_remote_debugging_port("search_google");
        let right = profile_remote_debugging_port("search_xiaohongshu");
        assert_ne!(left, right);
    }

    #[test]
    fn normalize_backend_policy_should_deduplicate_and_fill_defaults() {
        let policy = BrowserBackendPolicy {
            priority: vec![BrowserBackendType::CdpDirect, BrowserBackendType::CdpDirect],
            auto_fallback: false,
        };
        let normalized = normalize_backend_policy(policy).expect("policy must normalize");
        assert_eq!(
            normalized.priority,
            vec![
                BrowserBackendType::CdpDirect,
                BrowserBackendType::AsterCompat,
                BrowserBackendType::LimeExtensionBridge,
            ]
        );
        assert!(!normalized.auto_fallback);
    }

    #[test]
    fn normalize_action_name_should_strip_aster_prefix() {
        let action =
            normalize_action_name("mcp__lime-browser__read_page").expect("action must normalize");
        assert_eq!(action, "read_page");
    }

    #[test]
    fn extension_backend_capabilities_should_include_list_tabs() {
        assert!(extension_backend_capabilities().contains(&"list_tabs".to_string()));
    }

    #[test]
    fn bridge_result_to_value_should_include_data_payload() {
        let value = bridge_result_to_value(ChromeBridgeCommandResult {
            success: true,
            request_id: "req-tabs".to_string(),
            command: "list_tabs".to_string(),
            message: Some("ok".to_string()),
            error: None,
            page_info: None,
            data: Some(json!({
                "tabs": [
                    {
                        "id": 101,
                        "index": 0,
                        "title": "首页",
                    }
                ],
            })),
        });

        assert_eq!(
            value.get("data"),
            Some(&json!({
                "tabs": [
                    {
                        "id": 101,
                        "index": 0,
                        "title": "首页",
                    }
                ],
            })),
        );
    }

    #[test]
    fn build_backend_candidates_should_prefer_forced_backend() {
        let policy = BrowserBackendPolicy::default();
        let candidates = build_backend_candidates(Some(BrowserBackendType::CdpDirect), &policy);
        assert_eq!(candidates, vec![BrowserBackendType::CdpDirect]);
    }

    #[tokio::test]
    async fn browser_runtime_audit_should_store_launch_metadata() {
        BROWSER_RUNTIME_AUDIT_LOGS.lock().await.clear();

        append_browser_runtime_launch_audit(BrowserRuntimeLaunchAuditInput {
            profile_key: "general_browser_assist".to_string(),
            profile_id: Some("browser-profile-1".to_string()),
            environment_preset_id: Some("browser-env-1".to_string()),
            environment_preset_name: Some("美区桌面".to_string()),
            target_id: Some("target-1".to_string()),
            session_id: Some("session-1".to_string()),
            url: "https://example.com".to_string(),
            reused: Some(false),
            open_window: true,
            stream_mode: BrowserStreamMode::Both,
            browser_source: Some("system".to_string()),
            remote_debugging_port: Some(13001),
            success: true,
            error: None,
        })
        .await;

        let logs = get_browser_action_audit_logs(Some(5))
            .await
            .expect("audit logs should be readable");
        let record = logs.first().expect("launch audit must exist");
        assert!(matches!(record.kind, BrowserRuntimeAuditKind::Launch));
        assert_eq!(
            record.profile_key.as_deref(),
            Some("general_browser_assist")
        );
        assert_eq!(record.profile_id.as_deref(), Some("browser-profile-1"));
        assert_eq!(
            record.environment_preset_id.as_deref(),
            Some("browser-env-1")
        );
        assert_eq!(record.session_id.as_deref(), Some("session-1"));
        assert_eq!(record.url.as_deref(), Some("https://example.com"));
        assert_eq!(record.open_window, Some(true));
        assert!(matches!(record.stream_mode, Some(BrowserStreamMode::Both)));
        assert_eq!(record.browser_source.as_deref(), Some("system"));
        assert_eq!(record.remote_debugging_port, Some(13001));

        BROWSER_RUNTIME_AUDIT_LOGS.lock().await.clear();
    }
}
