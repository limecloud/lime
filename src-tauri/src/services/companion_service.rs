use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{path::PathBuf, process::Command, sync::Arc};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

const DEFAULT_COMPANION_HOST: &str = "127.0.0.1";
const DEFAULT_COMPANION_PORT: u16 = 45554;
const DEFAULT_COMPANION_PATH: &str = "/companion/pet";
const DEFAULT_CLIENT_ID: &str = "lime";
const DEFAULT_PROTOCOL_VERSION: u32 = 1;
const COMPANION_ENV_APP_PATH: &str = "LIME_PET_APP_PATH";
#[cfg(target_os = "macos")]
const MACOS_PET_APP_NAME: &str = "Lime Pet";
#[cfg(target_os = "windows")]
const WINDOWS_PET_EXE_NAME: &str = "Lime Pet.exe";

pub const COMPANION_PET_STATUS_EVENT: &str = "companion-pet-status";
pub const COMPANION_OPEN_PROVIDER_SETTINGS_EVENT: &str = "companion-open-provider-settings";

fn default_companion_endpoint() -> String {
    format!("ws://{DEFAULT_COMPANION_HOST}:{DEFAULT_COMPANION_PORT}{DEFAULT_COMPANION_PATH}")
}

fn empty_payload() -> Value {
    Value::Object(Map::new())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompanionPetVisualState {
    Hidden,
    Idle,
    Walking,
    Thinking,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionPetStatus {
    pub endpoint: String,
    pub server_listening: bool,
    pub connected: bool,
    pub client_id: Option<String>,
    pub platform: Option<String>,
    pub capabilities: Vec<String>,
    pub last_event: Option<String>,
    pub last_error: Option<String>,
    pub last_state: Option<CompanionPetVisualState>,
}

impl Default for CompanionPetStatus {
    fn default() -> Self {
        Self {
            endpoint: default_companion_endpoint(),
            server_listening: false,
            connected: false,
            client_id: None,
            platform: None,
            capabilities: Vec::new(),
            last_event: None,
            last_error: None,
            last_state: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompanionLaunchPetRequest {
    pub app_path: Option<String>,
    pub endpoint: Option<String>,
    pub client_id: Option<String>,
    pub protocol_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionLaunchPetResult {
    pub launched: bool,
    pub resolved_path: Option<String>,
    pub endpoint: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionPetCommandRequest {
    pub event: String,
    #[serde(default = "empty_payload")]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionPetSendResult {
    pub delivered: bool,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize)]
struct CompanionEnvelope {
    protocol_version: u32,
    event: String,
    payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
struct CompanionIncomingEnvelope {
    protocol_version: u32,
    event: String,
    #[serde(default = "empty_payload")]
    payload: Value,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct CompanionReadyPayload {
    client_id: Option<String>,
    platform: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Debug, Clone)]
struct ActivePetSender {
    connection_id: String,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Debug, Clone, Default)]
struct CompanionRuntime {
    status: CompanionPetStatus,
    active_connection_id: Option<String>,
}

#[derive(Clone)]
struct CompanionRouterState {
    app_handle: AppHandle,
    service: CompanionServiceState,
}

#[derive(Clone)]
pub struct CompanionServiceState {
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    runtime: Arc<RwLock<CompanionRuntime>>,
    sender: Arc<Mutex<Option<ActivePetSender>>>,
    start_lock: Arc<Mutex<()>>,
}

impl Default for CompanionServiceState {
    fn default() -> Self {
        Self {
            app_handle: Arc::new(RwLock::new(None)),
            runtime: Arc::new(RwLock::new(CompanionRuntime {
                status: CompanionPetStatus::default(),
                active_connection_id: None,
            })),
            sender: Arc::new(Mutex::new(None)),
            start_lock: Arc::new(Mutex::new(())),
        }
    }
}

impl CompanionServiceState {
    pub async fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        self.set_app_handle(app_handle.clone()).await;

        let _guard = self.start_lock.lock().await;
        if self.snapshot().await.server_listening {
            return Ok(());
        }

        let bind_addr = format!("{DEFAULT_COMPANION_HOST}:{DEFAULT_COMPANION_PORT}");
        let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
            Ok(listener) => listener,
            Err(error) => {
                self.update_runtime(|runtime| {
                    runtime.status.server_listening = false;
                    runtime.status.last_error = Some(format!("Companion 服务监听失败: {error}"));
                })
                .await;
                return Err(format!("Companion 服务监听失败: {error}"));
            }
        };

        self.update_runtime(|runtime| {
            runtime.status.server_listening = true;
            runtime.status.last_error = None;
            runtime.status.endpoint = default_companion_endpoint();
        })
        .await;

        let service = self.clone();
        let router = Router::new()
            .route(DEFAULT_COMPANION_PATH, get(companion_pet_ws))
            .with_state(CompanionRouterState {
                app_handle,
                service: self.clone(),
            });

        tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router).await {
                tracing::error!("[Companion] 服务运行失败: {}", error);
                service
                    .mark_server_stopped(Some(format!("Companion 服务运行失败: {error}")))
                    .await;
            }
        });

        tracing::info!(
            "[Companion] 已监听桌宠入口: {}",
            default_companion_endpoint()
        );
        Ok(())
    }

    pub async fn snapshot(&self) -> CompanionPetStatus {
        self.runtime.read().await.status.clone()
    }

    pub async fn launch_pet(
        &self,
        request: CompanionLaunchPetRequest,
    ) -> Result<CompanionLaunchPetResult, String> {
        let endpoint = request
            .endpoint
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(default_companion_endpoint);
        let client_id = request
            .client_id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
        let protocol_version = request.protocol_version.unwrap_or(DEFAULT_PROTOCOL_VERSION);

        let Some(target) = resolve_launch_target(request.app_path.as_deref()) else {
            return Ok(CompanionLaunchPetResult {
                launched: false,
                resolved_path: None,
                endpoint,
                message: Some(
                    "未找到 Lime Pet 可执行产物，请先安装桌宠应用或通过 app_path 显式指定。"
                        .to_string(),
                ),
            });
        };

        let mut command = Command::new(&target.exec_path);
        command
            .arg("--connect")
            .arg(&endpoint)
            .arg("--client-id")
            .arg(&client_id)
            .arg("--protocol-version")
            .arg(protocol_version.to_string());

        match command.spawn() {
            Ok(_) => Ok(CompanionLaunchPetResult {
                launched: true,
                resolved_path: Some(target.exec_path.to_string_lossy().to_string()),
                endpoint,
                message: None,
            }),
            Err(error) => Ok(CompanionLaunchPetResult {
                launched: false,
                resolved_path: Some(target.exec_path.to_string_lossy().to_string()),
                endpoint,
                message: Some(format!("启动 Lime Pet 失败: {error}")),
            }),
        }
    }

    pub async fn send_pet_command(
        &self,
        request: CompanionPetCommandRequest,
    ) -> Result<CompanionPetSendResult, String> {
        let payload = CompanionEnvelope {
            protocol_version: DEFAULT_PROTOCOL_VERSION,
            event: request.event.clone(),
            payload: request.payload.clone(),
        };
        let serialized = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

        let active_sender = self.sender.lock().await.clone();
        let Some(active_sender) = active_sender else {
            return Ok(CompanionPetSendResult {
                delivered: false,
                connected: false,
            });
        };

        if active_sender.tx.send(serialized).is_err() {
            self.mark_connection_closed(
                &active_sender.connection_id,
                "桌宠连接不可用，命令未送达".to_string(),
            )
            .await;
            return Ok(CompanionPetSendResult {
                delivered: false,
                connected: false,
            });
        }

        self.record_outbound_command(&request.event, &request.payload)
            .await;

        Ok(CompanionPetSendResult {
            delivered: true,
            connected: true,
        })
    }

    async fn set_app_handle(&self, app_handle: AppHandle) {
        let mut guard = self.app_handle.write().await;
        *guard = Some(app_handle);
    }

    async fn emit_status(&self, status: CompanionPetStatus) {
        let app_handle = self.app_handle.read().await.clone();
        if let Some(app_handle) = app_handle {
            if let Err(error) = app_handle.emit(COMPANION_PET_STATUS_EVENT, &status) {
                tracing::warn!("[Companion] 发送状态事件失败: {}", error);
            }
        }
    }

    async fn update_runtime<F>(&self, mutate: F)
    where
        F: FnOnce(&mut CompanionRuntime),
    {
        let snapshot = {
            let mut runtime = self.runtime.write().await;
            mutate(&mut runtime);
            runtime.status.clone()
        };
        self.emit_status(snapshot).await;
    }

    async fn mark_server_stopped(&self, reason: Option<String>) {
        let mut sender = self.sender.lock().await;
        sender.take();
        drop(sender);

        self.update_runtime(|runtime| {
            runtime.status.server_listening = false;
            runtime.status.connected = false;
            runtime.status.client_id = None;
            runtime.status.platform = None;
            runtime.status.capabilities.clear();
            runtime.status.last_error = reason;
            runtime.active_connection_id = None;
        })
        .await;
    }

    async fn attach_sender(&self, connection_id: String, tx: mpsc::UnboundedSender<String>) {
        let mut guard = self.sender.lock().await;
        *guard = Some(ActivePetSender { connection_id, tx });
    }

    async fn mark_connection_open(&self, connection_id: String) {
        self.update_runtime(|runtime| {
            runtime.active_connection_id = Some(connection_id);
            runtime.status.connected = true;
            runtime.status.client_id = None;
            runtime.status.platform = None;
            runtime.status.capabilities.clear();
            runtime.status.last_event = Some("pet.connected".to_string());
            runtime.status.last_error = None;
        })
        .await;
    }

    async fn mark_connection_ready(&self, connection_id: &str, payload: CompanionReadyPayload) {
        self.update_runtime(|runtime| {
            if runtime.active_connection_id.as_deref() != Some(connection_id) {
                return;
            }
            runtime.status.connected = true;
            runtime.status.client_id = payload.client_id;
            runtime.status.platform = payload.platform;
            runtime.status.capabilities = payload.capabilities;
            runtime.status.last_event = Some("pet.ready".to_string());
            runtime.status.last_error = None;
        })
        .await;
    }

    async fn mark_connection_closed(&self, connection_id: &str, reason: String) {
        {
            let mut sender = self.sender.lock().await;
            if sender.as_ref().map(|active| active.connection_id.as_str()) == Some(connection_id) {
                sender.take();
            }
        }

        self.update_runtime(|runtime| {
            if runtime.active_connection_id.as_deref() != Some(connection_id) {
                return;
            }
            runtime.active_connection_id = None;
            runtime.status.connected = false;
            runtime.status.client_id = None;
            runtime.status.platform = None;
            runtime.status.capabilities.clear();
            runtime.status.last_event = Some("pet.disconnected".to_string());
            runtime.status.last_error = Some(reason);
        })
        .await;
    }

    async fn handle_incoming_message(
        &self,
        app_handle: &AppHandle,
        connection_id: &str,
        text: &str,
    ) {
        let envelope = match serde_json::from_str::<CompanionIncomingEnvelope>(text) {
            Ok(envelope) => envelope,
            Err(error) => {
                tracing::warn!("[Companion] 忽略无法解析的桌宠消息: {}", error);
                return;
            }
        };

        if envelope.protocol_version != DEFAULT_PROTOCOL_VERSION {
            self.update_runtime(|runtime| {
                if runtime.active_connection_id.as_deref() != Some(connection_id) {
                    return;
                }
                runtime.status.last_error =
                    Some(format!("桌宠协议版本不兼容: {}", envelope.protocol_version));
            })
            .await;
            return;
        }

        let should_focus_main_window = matches!(
            envelope.event.as_str(),
            "pet.clicked" | "pet.open_chat" | "pet.open_provider_settings"
        );

        self.update_runtime(|runtime| {
            if runtime.active_connection_id.as_deref() != Some(connection_id) {
                return;
            }
            runtime.status.last_event = Some(envelope.event.clone());
            runtime.status.last_error = None;
        })
        .await;

        if envelope.event == "pet.ready" {
            match serde_json::from_value::<CompanionReadyPayload>(envelope.payload.clone()) {
                Ok(payload) => {
                    self.mark_connection_ready(connection_id, payload).await;
                }
                Err(error) => {
                    self.update_runtime(|runtime| {
                        if runtime.active_connection_id.as_deref() != Some(connection_id) {
                            return;
                        }
                        runtime.status.last_error =
                            Some(format!("桌宠 ready 负载解析失败: {error}"));
                    })
                    .await;
                }
            }
        }

        if should_focus_main_window {
            reveal_main_window(app_handle);
        }

        if envelope.event == "pet.open_provider_settings" {
            if let Err(error) = app_handle.emit(COMPANION_OPEN_PROVIDER_SETTINGS_EVENT, ()) {
                tracing::warn!("[Companion] 发送服务商设置跳转事件失败: {}", error);
            }
        }
    }

    async fn record_outbound_command(&self, event: &str, payload: &Value) {
        let event_name = event.to_string();
        let next_state = match event {
            "pet.hide" => Some(CompanionPetVisualState::Hidden),
            "pet.show" => Some(CompanionPetVisualState::Walking),
            "pet.state_changed" => payload
                .get("state")
                .and_then(Value::as_str)
                .and_then(parse_visual_state),
            _ => None,
        };

        self.update_runtime(|runtime| {
            runtime.status.last_event = Some(event_name);
            runtime.status.last_error = None;
            if let Some(next_state) = next_state {
                runtime.status.last_state = Some(next_state);
            }
        })
        .await;
    }
}

fn parse_visual_state(value: &str) -> Option<CompanionPetVisualState> {
    match value.trim() {
        "hidden" => Some(CompanionPetVisualState::Hidden),
        "idle" => Some(CompanionPetVisualState::Idle),
        "walking" => Some(CompanionPetVisualState::Walking),
        "thinking" => Some(CompanionPetVisualState::Thinking),
        "done" => Some(CompanionPetVisualState::Done),
        _ => None,
    }
}

fn reveal_main_window(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        tracing::warn!("[Companion] 未找到主窗口，无法响应桌宠点击");
        return;
    };

    if let Err(error) = window.unminimize() {
        tracing::warn!("[Companion] 主窗口取消最小化失败: {}", error);
    }
    if let Err(error) = window.show() {
        tracing::warn!("[Companion] 主窗口显示失败: {}", error);
    }
    if let Err(error) = window.set_focus() {
        tracing::warn!("[Companion] 主窗口聚焦失败: {}", error);
    }
}

#[derive(Debug)]
struct LaunchTarget {
    exec_path: PathBuf,
}

fn resolve_launch_target(explicit_path: Option<&str>) -> Option<LaunchTarget> {
    let mut candidates = Vec::new();

    if let Some(explicit_path) = explicit_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        candidates.push(expand_user_path(explicit_path));
    }

    if let Ok(env_path) = std::env::var(COMPANION_ENV_APP_PATH) {
        let env_path = env_path.trim();
        if !env_path.is_empty() {
            candidates.push(expand_user_path(env_path));
        }
    }

    candidates.extend(default_launch_candidates());

    candidates.into_iter().find_map(normalize_launch_target)
}

fn expand_user_path(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(value));
    }

    if let Some(suffix) = value.strip_prefix("~/") {
        if let Some(home_dir) = dirs::home_dir() {
            return home_dir.join(suffix);
        }
    }

    PathBuf::from(value)
}

#[cfg(target_os = "macos")]
fn default_launch_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home_dir) = dirs::home_dir() {
        candidates.push(home_dir.join("Applications/Lime Pet.app"));
    }
    candidates.push(PathBuf::from("/Applications/Lime Pet.app"));
    candidates
}

#[cfg(target_os = "windows")]
fn default_launch_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_dir) = dirs::data_local_dir() {
        candidates.push(
            local_dir
                .join("Programs")
                .join("Lime Pet")
                .join(WINDOWS_PET_EXE_NAME),
        );
    }
    candidates
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn default_launch_candidates() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn normalize_launch_target(path: PathBuf) -> Option<LaunchTarget> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("app"))
    {
        let exec_path = path.join("Contents").join("MacOS").join(MACOS_PET_APP_NAME);
        return exec_path.exists().then_some(LaunchTarget { exec_path });
    }

    path.exists().then_some(LaunchTarget { exec_path: path })
}

#[cfg(target_os = "windows")]
fn normalize_launch_target(path: PathBuf) -> Option<LaunchTarget> {
    path.exists().then_some(LaunchTarget { exec_path: path })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn normalize_launch_target(path: PathBuf) -> Option<LaunchTarget> {
    path.exists().then_some(LaunchTarget { exec_path: path })
}

async fn companion_pet_ws(
    ws: WebSocketUpgrade,
    State(router_state): State<CompanionRouterState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_companion_socket(router_state, socket))
}

async fn handle_companion_socket(router_state: CompanionRouterState, socket: WebSocket) {
    let connection_id = Uuid::new_v4().to_string();
    let (mut writer, mut reader) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    router_state
        .service
        .attach_sender(connection_id.clone(), tx)
        .await;
    router_state
        .service
        .mark_connection_open(connection_id.clone())
        .await;

    let writer_service = router_state.service.clone();
    let writer_connection_id = connection_id.clone();
    let writer_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if writer.send(Message::Text(message.into())).await.is_err() {
                break;
            }
        }

        writer_service
            .mark_connection_closed(&writer_connection_id, "桌宠连接写入通道已关闭".to_string())
            .await;
    });

    while let Some(message) = reader.next().await {
        match message {
            Ok(Message::Text(text)) => {
                router_state
                    .service
                    .handle_incoming_message(&router_state.app_handle, &connection_id, &text)
                    .await;
            }
            Ok(Message::Binary(_)) => {}
            Ok(Message::Ping(_)) => {}
            Ok(Message::Pong(_)) => {}
            Ok(Message::Close(_)) => {
                break;
            }
            Err(error) => {
                router_state
                    .service
                    .mark_connection_closed(&connection_id, format!("桌宠连接读取失败: {error}"))
                    .await;
                writer_task.abort();
                return;
            }
        }
    }

    writer_task.abort();
    router_state
        .service
        .mark_connection_closed(&connection_id, "桌宠连接已关闭".to_string())
        .await;
}

pub async fn get_pet_status_global(
    state: &CompanionServiceState,
) -> Result<CompanionPetStatus, String> {
    Ok(state.snapshot().await)
}

pub async fn launch_pet_global(
    state: &CompanionServiceState,
    request: CompanionLaunchPetRequest,
) -> Result<CompanionLaunchPetResult, String> {
    state.launch_pet(request).await
}

pub async fn send_pet_command_global(
    state: &CompanionServiceState,
    request: CompanionPetCommandRequest,
) -> Result<CompanionPetSendResult, String> {
    state.send_pet_command(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn send_pet_command_without_active_sender_returns_not_delivered() {
        let state = CompanionServiceState::default();

        let result = state
            .send_pet_command(CompanionPetCommandRequest {
                event: "pet.provider_overview".to_string(),
                payload: json!({
                    "total_provider_count": 2
                }),
            })
            .await
            .unwrap();

        assert!(!result.delivered);
        assert!(!result.connected);
    }

    #[tokio::test]
    async fn send_pet_command_serializes_envelope_and_updates_visual_state() {
        let state = CompanionServiceState::default();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let connection_id = "conn-1".to_string();

        state.attach_sender(connection_id.clone(), tx).await;
        state.mark_connection_open(connection_id).await;

        let result = state
            .send_pet_command(CompanionPetCommandRequest {
                event: "pet.state_changed".to_string(),
                payload: json!({
                    "state": "thinking",
                    "total_provider_count": 3
                }),
            })
            .await
            .unwrap();

        assert!(result.delivered);
        assert!(result.connected);

        let outbound = rx.recv().await.expect("应收到发送给桌宠的消息");
        let envelope: serde_json::Value = serde_json::from_str(&outbound).expect("应输出合法 JSON");

        assert_eq!(
            envelope["protocol_version"],
            json!(DEFAULT_PROTOCOL_VERSION)
        );
        assert_eq!(envelope["event"], json!("pet.state_changed"));
        assert_eq!(envelope["payload"]["state"], json!("thinking"));
        assert_eq!(envelope["payload"]["total_provider_count"], json!(3));

        let snapshot = state.snapshot().await;
        assert_eq!(snapshot.last_event.as_deref(), Some("pet.state_changed"));
        assert_eq!(snapshot.last_state, Some(CompanionPetVisualState::Thinking));
        assert!(snapshot.connected);
    }
}
