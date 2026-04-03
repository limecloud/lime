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
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{path::PathBuf, process::Command, sync::Arc};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

use crate::app::AppState;
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::model_registry_cmd::ModelRegistryState;
use crate::database::dao::api_key_provider::{ApiProviderType, ProviderWithKeys};
use crate::database::DbConnection;

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
pub const COMPANION_REQUEST_PROVIDER_SYNC_EVENT: &str = "companion-request-provider-sync";
pub const COMPANION_REQUEST_PET_CHEER_EVENT: &str = "companion-request-pet-cheer";
pub const COMPANION_REQUEST_PET_NEXT_STEP_EVENT: &str = "companion-request-pet-next-step";
pub const COMPANION_REQUEST_PET_CHAT_EVENT: &str = "companion-request-pet-chat";
pub const COMPANION_REQUEST_PET_CHAT_RESET_EVENT: &str = "companion-request-pet-chat-reset";
pub const COMPANION_REQUEST_PET_VOICE_CHAT_EVENT: &str = "companion-request-pet-voice-chat";
pub const COMPANION_PET_VOICE_TRANSCRIPT_EVENT: &str = "companion-pet-voice-transcript";

const MAX_PET_CONVERSATION_TURNS: usize = 6;
const SUPPORTED_LIVE2D_EMOTION_TAGS: &[&str] = &[
    "neutral", "joy", "sadness", "surprise", "anger", "fear", "disgust", "smirk",
];

static LIVE2D_TAG_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[([a-z0-9_-]+)\]").expect("live2d tag regex should compile"));

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionPetChatRequestPayload {
    pub text: String,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone)]
struct CompanionPetConversationTurn {
    role: CompanionPetConversationRole,
    content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionPetConversationRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompanionPetQuickAction {
    Cheer,
    NextStep,
}

#[derive(Debug, Clone)]
struct CompanionResolvedChatTarget {
    provider: ProviderWithKeys,
    model_name: Option<String>,
}

#[derive(Debug, Clone)]
struct NormalizedConversationBubble {
    bubble_text: String,
    emotion_tags: Vec<String>,
}

#[derive(Debug, Clone)]
struct ActivePetSender {
    connection_id: String,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct CompanionIncomingEventEffects {
    focus_main_window: bool,
    open_provider_settings: bool,
    request_provider_sync: bool,
    request_pet_cheer: bool,
    request_pet_next_step: bool,
    request_pet_voice_chat: bool,
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
    pet_action_lock: Arc<Mutex<()>>,
    pet_conversation_history: Arc<Mutex<Vec<CompanionPetConversationTurn>>>,
    frontend_event_listener_registered: Arc<Mutex<bool>>,
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
            pet_action_lock: Arc::new(Mutex::new(())),
            pet_conversation_history: Arc::new(Mutex::new(Vec::new())),
            frontend_event_listener_registered: Arc::new(Mutex::new(false)),
        }
    }
}

impl CompanionServiceState {
    pub async fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        self.set_app_handle(app_handle.clone()).await;
        self.register_frontend_event_listeners(&app_handle).await;

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

    async fn register_frontend_event_listeners(&self, app_handle: &AppHandle) {
        let mut guard = self.frontend_event_listener_registered.lock().await;
        if *guard {
            return;
        }

        let service = self.clone();
        let listener_app_handle = app_handle.clone();
        app_handle.listen(COMPANION_PET_VOICE_TRANSCRIPT_EVENT, move |event| {
            let raw_payload = event.payload().to_string();
            let service = service.clone();
            let app_handle = listener_app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let payload = match parse_companion_chat_request_event_payload(&raw_payload) {
                    Ok(payload) => payload,
                    Err(error) => {
                        tracing::warn!(
                            "[Companion] 解析桌宠语音转写事件失败: {}，payload={}",
                            error,
                            raw_payload
                        );
                        return;
                    }
                };

                if let Err(error) = service.handle_pet_chat_request(&app_handle, payload).await {
                    tracing::warn!("[Companion] 处理桌宠语音转写失败: {}", error);
                }
            });
        });

        *guard = true;
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

        let event_effects = companion_incoming_event_effects(envelope.event.as_str());

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

        if event_effects.focus_main_window {
            reveal_main_window(app_handle);
        }

        if event_effects.open_provider_settings {
            if let Err(error) = app_handle.emit(COMPANION_OPEN_PROVIDER_SETTINGS_EVENT, ()) {
                tracing::warn!("[Companion] 发送服务商设置跳转事件失败: {}", error);
            }
        }

        if event_effects.request_provider_sync {
            if let Err(error) = app_handle.emit(COMPANION_REQUEST_PROVIDER_SYNC_EVENT, ()) {
                tracing::warn!("[Companion] 发送桌宠摘要同步请求失败: {}", error);
            }
        }

        if event_effects.request_pet_cheer {
            if let Err(error) = self
                .handle_pet_quick_action_request(app_handle, CompanionPetQuickAction::Cheer)
                .await
            {
                tracing::warn!("[Companion] 处理桌宠鼓励请求失败: {}", error);
            }
        }

        if event_effects.request_pet_next_step {
            if let Err(error) = self
                .handle_pet_quick_action_request(app_handle, CompanionPetQuickAction::NextStep)
                .await
            {
                tracing::warn!("[Companion] 处理桌宠下一步建议请求失败: {}", error);
            }
        }

        if event_effects.request_pet_voice_chat {
            if let Err(error) = self.handle_pet_voice_chat_request(app_handle).await {
                tracing::warn!("[Companion] 处理桌宠语音对话请求失败: {}", error);
            }
        }

        if envelope.event == "pet.request_chat_reply" {
            match serde_json::from_value::<CompanionPetChatRequestPayload>(envelope.payload.clone())
            {
                Ok(payload) => {
                    if let Err(error) = self.handle_pet_chat_request(app_handle, payload).await {
                        tracing::warn!("[Companion] 处理桌宠对话请求失败: {}", error);
                    }
                }
                Err(error) => {
                    self.update_runtime(|runtime| {
                        if runtime.active_connection_id.as_deref() != Some(connection_id) {
                            return;
                        }
                        runtime.status.last_error =
                            Some(format!("桌宠对话请求负载解析失败: {error}"));
                    })
                    .await;
                }
            }
        }

        if envelope.event == "pet.request_chat_reset" {
            if let Err(error) = self.handle_pet_chat_reset_request().await {
                tracing::warn!("[Companion] 处理桌宠对话重置请求失败: {}", error);
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

    async fn handle_pet_voice_chat_request(&self, app_handle: &AppHandle) -> Result<(), String> {
        if !self.snapshot().await.connected {
            return Ok(());
        }

        let _ = self.send_pet_bubble("你说吧，我在认真听", 1600).await;

        if let Err(error) =
            crate::voice::window::open_voice_window(app_handle, Some("companion-pet"))
        {
            tracing::warn!("[Companion] 打开桌宠语音窗口失败: {}", error);
            let _ = self
                .send_pet_bubble("语音入口暂时没打开，你先打字和我聊吧", 2200)
                .await;
        }

        Ok(())
    }

    async fn handle_pet_chat_reset_request(&self) -> Result<(), String> {
        self.pet_conversation_history.lock().await.clear();
        let _ = self
            .send_pet_bubble("好呀，我们从这句重新开始聊", 1800)
            .await;
        Ok(())
    }

    async fn handle_pet_quick_action_request(
        &self,
        app_handle: &AppHandle,
        action: CompanionPetQuickAction,
    ) -> Result<(), String> {
        let action_guard = match self.pet_action_lock.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                let _ = self.send_pet_bubble("我还在想上一句呢", 1400).await;
                return Ok(());
            }
        };
        let resume_state = self.resume_visual_state().await;
        let _ = self
            .send_pet_visual_state(CompanionPetVisualState::Thinking)
            .await;

        let target = match resolve_companion_chat_target(app_handle).await {
            Ok(target) => target,
            Err(error) => {
                let _ = self
                    .send_pet_bubble(&format_quick_action_error(action, &error), 2200)
                    .await;
                drop(action_guard);
                let _ = self.send_pet_visual_state(resume_state).await;
                return Ok(());
            }
        };

        let prompt = build_quick_action_prompt(action);
        let result = run_companion_chat_completion(app_handle, &target, prompt).await;
        match result {
            Ok(content) => {
                let bubble_text = normalize_quick_action_bubble(action, content.content.as_deref());
                let auto_hide_ms = match action {
                    CompanionPetQuickAction::Cheer => 2200,
                    CompanionPetQuickAction::NextStep => 2600,
                };
                let _ = self.send_pet_bubble(&bubble_text, auto_hide_ms).await;
            }
            Err(error) => {
                let _ = self
                    .send_pet_bubble(&format_quick_action_error(action, &error), 2200)
                    .await;
            }
        }

        drop(action_guard);
        let _ = self.send_pet_visual_state(resume_state).await;
        Ok(())
    }

    async fn handle_pet_chat_request(
        &self,
        app_handle: &AppHandle,
        payload: CompanionPetChatRequestPayload,
    ) -> Result<(), String> {
        let input = normalize_text(&payload.text);
        if input.is_empty() {
            let _ = self.send_pet_bubble("你先跟我说一句话吧", 1600).await;
            return Ok(());
        }

        let action_guard = match self.pet_action_lock.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                let _ = self.send_pet_bubble("我还在想上一句呢", 1400).await;
                return Ok(());
            }
        };
        let resume_state = self.resume_visual_state().await;
        let _ = self
            .send_pet_visual_state(CompanionPetVisualState::Thinking)
            .await;

        let target = match resolve_companion_chat_target(app_handle).await {
            Ok(target) => target,
            Err(error) => {
                let _ = self
                    .send_pet_bubble(&format_pet_conversation_error(&error), 2200)
                    .await;
                drop(action_guard);
                let _ = self.send_pet_visual_state(resume_state).await;
                return Ok(());
            }
        };

        let history = self.pet_conversation_history.lock().await.clone();
        let prompt = build_pet_conversation_prompt(&history, &input);
        let result = run_companion_chat_completion(app_handle, &target, prompt).await;
        match result {
            Ok(content) => {
                let normalized = normalize_conversation_bubble(content.content.as_deref());
                {
                    let mut history = self.pet_conversation_history.lock().await;
                    append_pet_conversation_turn(
                        &mut history,
                        CompanionPetConversationRole::User,
                        &input,
                    );
                    append_pet_conversation_turn(
                        &mut history,
                        CompanionPetConversationRole::Assistant,
                        &normalized.bubble_text,
                    );
                }

                if !normalized.emotion_tags.is_empty() {
                    let _ = self.send_pet_live2d_action(&normalized.emotion_tags).await;
                }
                let _ = self.send_pet_bubble(&normalized.bubble_text, 3200).await;
            }
            Err(error) => {
                let _ = self
                    .send_pet_bubble(&format_pet_conversation_error(&error), 2200)
                    .await;
            }
        }

        drop(action_guard);
        let _ = self.send_pet_visual_state(resume_state).await;
        Ok(())
    }

    async fn resume_visual_state(&self) -> CompanionPetVisualState {
        let snapshot = self.snapshot().await;
        match snapshot.last_state {
            Some(state) if state != CompanionPetVisualState::Thinking => state,
            _ => CompanionPetVisualState::Walking,
        }
    }

    async fn send_pet_visual_state(
        &self,
        state: CompanionPetVisualState,
    ) -> Result<CompanionPetSendResult, String> {
        self.send_pet_command(CompanionPetCommandRequest {
            event: "pet.state_changed".to_string(),
            payload: serde_json::json!({
                "state": state.as_wire_value(),
            }),
        })
        .await
    }

    async fn send_pet_bubble(
        &self,
        text: &str,
        auto_hide_ms: u64,
    ) -> Result<CompanionPetSendResult, String> {
        self.send_pet_command(CompanionPetCommandRequest {
            event: "pet.show_bubble".to_string(),
            payload: serde_json::json!({
                "text": text,
                "auto_hide_ms": auto_hide_ms,
            }),
        })
        .await
    }

    async fn send_pet_live2d_action(
        &self,
        emotion_tags: &[String],
    ) -> Result<CompanionPetSendResult, String> {
        self.send_pet_command(CompanionPetCommandRequest {
            event: "pet.live2d_action".to_string(),
            payload: serde_json::json!({
                "emotion_tags": emotion_tags,
            }),
        })
        .await
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

impl CompanionPetVisualState {
    fn as_wire_value(self) -> &'static str {
        match self {
            CompanionPetVisualState::Hidden => "hidden",
            CompanionPetVisualState::Idle => "idle",
            CompanionPetVisualState::Walking => "walking",
            CompanionPetVisualState::Thinking => "thinking",
            CompanionPetVisualState::Done => "done",
        }
    }
}

fn parse_companion_chat_request_event_payload(
    raw_payload: &str,
) -> Result<CompanionPetChatRequestPayload, String> {
    if let Ok(payload) = serde_json::from_str::<CompanionPetChatRequestPayload>(raw_payload) {
        return Ok(payload);
    }

    let value: Value =
        serde_json::from_str(raw_payload).map_err(|error| format!("JSON 解析失败: {error}"))?;
    match value {
        Value::String(text) => Ok(CompanionPetChatRequestPayload {
            text,
            source: Some("voice_window".to_string()),
        }),
        Value::Object(_) => serde_json::from_value(value)
            .map_err(|error| format!("桌宠语音转写负载解析失败: {error}")),
        _ => Err("桌宠语音转写负载不是合法对象或字符串".to_string()),
    }
}

fn build_quick_action_prompt(action: CompanionPetQuickAction) -> String {
    match action {
        CompanionPetQuickAction::NextStep => [
            "你是“Lime 青柠精灵”桌宠。",
            "请只输出一句中文下一步行动建议。",
            "要求具体、轻量、可立刻执行，不超过26个汉字。",
            "不要使用表情、引号、换行、编号，也不要解释原因。",
        ]
        .join(""),
        CompanionPetQuickAction::Cheer => [
            "你是“Lime 青柠精灵”桌宠。",
            "请只输出一句中文陪伴或鼓励短句。",
            "语气温柔机灵，不超过24个汉字。",
            "不要使用表情、引号、换行、编号，也不要自我介绍。",
        ]
        .join(""),
    }
}

fn build_pet_conversation_prompt(
    history: &[CompanionPetConversationTurn],
    user_input: &str,
) -> String {
    let supported_tags = SUPPORTED_LIVE2D_EMOTION_TAGS
        .iter()
        .map(|tag| format!("[{tag}]"))
        .collect::<Vec<_>>()
        .join(" ");
    let mut prompt = String::from("你是“Lime 青柠精灵”桌宠。用户正在直接和你说话。");

    if !history.is_empty() {
        prompt.push_str("最近几轮对话如下，请自然延续语气和上下文。");
        for turn in history {
            match turn.role {
                CompanionPetConversationRole::User => prompt.push_str("用户："),
                CompanionPetConversationRole::Assistant => prompt.push_str("青柠："),
            }
            prompt.push_str(&turn.content);
        }
    }

    prompt.push_str("请直接用中文回复用户，最多两句，总长度不超过48个汉字。");
    prompt.push_str(&format!(
        "为了驱动 Live2D，你可以插入 0 到 2 个情绪标签：{supported_tags}。"
    ));
    prompt.push_str("标签可放在句首或句中，但除了这些标签以外，不要输出任何方括号内容。");
    prompt.push_str("语气温柔、机灵、自然，像桌边陪伴，不要使用表情、引号、编号、标题或换行。");
    prompt.push_str(&format!("用户输入：{user_input}"));
    prompt
}

fn normalize_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sanitize_bubble_candidate(value: Option<&str>) -> String {
    let compact = normalize_text(value.unwrap_or_default());
    let trimmed_quotes = compact.trim_matches(|ch| matches!(ch, '"' | '“' | '”' | '\'' | '`'));
    trimmed_quotes
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit() || matches!(ch, '-' | '*' | ' ' | '、' | '.')
        })
        .to_string()
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= limit {
        return value.to_string();
    }

    format!("{}…", chars.into_iter().take(limit).collect::<String>())
}

fn fallback_quick_action_bubble(action: CompanionPetQuickAction) -> &'static str {
    match action {
        CompanionPetQuickAction::NextStep => "先把眼前最小的一步做掉",
        CompanionPetQuickAction::Cheer => "青柠会一直陪着你",
    }
}

fn normalize_quick_action_bubble(action: CompanionPetQuickAction, content: Option<&str>) -> String {
    let bubble = sanitize_bubble_candidate(content);
    if bubble.is_empty() {
        return fallback_quick_action_bubble(action).to_string();
    }

    truncate_chars(&bubble, 30)
}

fn is_supported_live2d_emotion_tag(tag: &str) -> bool {
    SUPPORTED_LIVE2D_EMOTION_TAGS.contains(&tag)
}

fn normalize_conversation_bubble(content: Option<&str>) -> NormalizedConversationBubble {
    let mut emotion_tags = Vec::new();
    let content_without_tags = LIVE2D_TAG_REGEX
        .replace_all(content.unwrap_or_default(), |captures: &regex::Captures| {
            let tag = captures
                .get(1)
                .map(|value| value.as_str().to_ascii_lowercase())
                .unwrap_or_default();
            if is_supported_live2d_emotion_tag(&tag) {
                if !emotion_tags.iter().any(|existing| existing == &tag) {
                    emotion_tags.push(tag);
                }
                " ".to_string()
            } else {
                captures
                    .get(0)
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_default()
            }
        })
        .to_string();

    let bubble = sanitize_bubble_candidate(Some(&content_without_tags));
    if bubble.is_empty() {
        return NormalizedConversationBubble {
            bubble_text: "我在呢，我们慢慢说".to_string(),
            emotion_tags,
        };
    }

    NormalizedConversationBubble {
        bubble_text: truncate_chars(&bubble, 56),
        emotion_tags,
    }
}

fn append_pet_conversation_turn(
    history: &mut Vec<CompanionPetConversationTurn>,
    role: CompanionPetConversationRole,
    content: &str,
) {
    let normalized_content = normalize_text(content);
    if normalized_content.is_empty() {
        return;
    }

    history.push(CompanionPetConversationTurn {
        role,
        content: normalized_content,
    });
    if history.len() > MAX_PET_CONVERSATION_TURNS {
        let overflow = history.len() - MAX_PET_CONVERSATION_TURNS;
        history.drain(0..overflow);
    }
}

fn missing_provider_message() -> &'static str {
    "还没找到可聊天的 AI 服务商，先去 Lime 里配置一个吧"
}

fn format_quick_action_error(action: CompanionPetQuickAction, error: &str) -> String {
    let message = error.trim();
    if message.contains("还没找到可聊天的 AI 服务商") {
        return message.to_string();
    }

    match action {
        CompanionPetQuickAction::NextStep => "青柠这次没想好下一步，稍后再试试".to_string(),
        CompanionPetQuickAction::Cheer => "青柠这次灵感掉线啦，稍后再点我".to_string(),
    }
}

fn format_pet_conversation_error(error: &str) -> String {
    let message = error.trim();
    if message.contains("还没找到可聊天的 AI 服务商") || message.contains("你先跟我说一句话吧")
    {
        return message.to_string();
    }

    "青柠刚刚走神了，你再和我说一次吧".to_string()
}

async fn resolve_companion_chat_target(
    app_handle: &AppHandle,
) -> Result<CompanionResolvedChatTarget, String> {
    let app_state = app_handle
        .try_state::<AppState>()
        .ok_or_else(|| "AppState 未初始化".to_string())?;
    let config = {
        let guard = app_state.inner().read().await;
        guard.config.clone()
    };

    let db = app_handle
        .try_state::<DbConnection>()
        .ok_or_else(|| "DbConnection 未初始化".to_string())?;
    let api_key_service = app_handle
        .try_state::<ApiKeyProviderServiceState>()
        .ok_or_else(|| "ApiKeyProviderServiceState 未初始化".to_string())?;
    let providers = api_key_service.0.get_all_providers(db.inner())?;

    let general_preference = &config.workspace_preferences.companion_defaults.general;
    if let Some(preferred_provider_id) = general_preference
        .preferred_provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(provider) = find_usable_provider_by_hint(&providers, preferred_provider_id) {
            return Ok(CompanionResolvedChatTarget {
                provider: provider.clone(),
                model_name: general_preference.preferred_model_id.clone(),
            });
        }

        if !general_preference.allow_fallback {
            return Err(format!(
                "桌宠通用模型 Provider 不可用：{}",
                preferred_provider_id
            ));
        }
    }

    if let Some(provider) = find_usable_provider_by_hint(&providers, &config.default_provider) {
        return Ok(CompanionResolvedChatTarget {
            provider: provider.clone(),
            model_name: None,
        });
    }

    let provider = providers
        .iter()
        .find(|provider| can_use_companion_chat_provider(provider))
        .cloned()
        .ok_or_else(|| missing_provider_message().to_string())?;

    Ok(CompanionResolvedChatTarget {
        provider,
        model_name: None,
    })
}

async fn run_companion_chat_completion(
    app_handle: &AppHandle,
    target: &CompanionResolvedChatTarget,
    prompt: String,
) -> Result<lime_services::api_key_provider_service::ChatTestResult, String> {
    let db = app_handle
        .try_state::<DbConnection>()
        .ok_or_else(|| "DbConnection 未初始化".to_string())?;
    let api_key_service = app_handle
        .try_state::<ApiKeyProviderServiceState>()
        .ok_or_else(|| "ApiKeyProviderServiceState 未初始化".to_string())?;
    let fallback_models = load_local_fallback_models(app_handle, &target.provider.provider).await;
    let result = api_key_service
        .0
        .test_chat_with_fallback_models(
            db.inner(),
            &target.provider.provider.id,
            target.model_name.clone(),
            prompt,
            fallback_models,
        )
        .await?;

    if result.success {
        return Ok(result);
    }

    Err(normalize_text(
        result
            .error
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("青柠这次暂时没有连上可用模型"),
    ))
}

async fn load_local_fallback_models(
    app_handle: &AppHandle,
    provider: &crate::database::dao::api_key_provider::ApiKeyProvider,
) -> Vec<String> {
    let Some(model_registry_state) = app_handle.try_state::<ModelRegistryState>() else {
        return Vec::new();
    };

    let guard = model_registry_state.inner().read().await;
    let Some(model_registry) = guard.as_ref() else {
        return Vec::new();
    };

    model_registry
        .get_local_fallback_model_ids_with_hints(
            &provider.id,
            &provider.api_host,
            Some(provider.provider_type),
            &provider.custom_models,
        )
        .await
}

fn can_use_companion_chat_provider(provider: &ProviderWithKeys) -> bool {
    provider.provider.enabled
        && (provider.api_keys.iter().any(|item| item.enabled)
            || (provider.provider.provider_type == ApiProviderType::Ollama
                && !provider.provider.api_host.trim().is_empty()))
}

fn find_usable_provider_by_hint<'a>(
    providers: &'a [ProviderWithKeys],
    hint: &str,
) -> Option<&'a ProviderWithKeys> {
    let normalized_hint = normalize_provider_hint(hint);
    if normalized_hint.is_empty() {
        return None;
    }

    providers.iter().find(|provider| {
        can_use_companion_chat_provider(provider)
            && (normalize_provider_hint(&provider.provider.id) == normalized_hint
                || normalize_provider_hint(api_provider_type_key(provider.provider.provider_type))
                    == normalized_hint)
    })
}

fn normalize_provider_hint(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn api_provider_type_key(value: ApiProviderType) -> &'static str {
    match value {
        ApiProviderType::Openai => "openai",
        ApiProviderType::OpenaiResponse => "openai-response",
        ApiProviderType::Codex => "codex",
        ApiProviderType::Anthropic => "anthropic",
        ApiProviderType::AnthropicCompatible => "anthropic-compatible",
        ApiProviderType::Gemini => "gemini",
        ApiProviderType::AzureOpenai => "azure-openai",
        ApiProviderType::Vertexai => "vertexai",
        ApiProviderType::AwsBedrock => "aws-bedrock",
        ApiProviderType::Ollama => "ollama",
        ApiProviderType::Fal => "fal",
        ApiProviderType::NewApi => "new-api",
        ApiProviderType::Gateway => "gateway",
    }
}

fn companion_incoming_event_effects(event: &str) -> CompanionIncomingEventEffects {
    match event {
        "pet.clicked" | "pet.open_chat" => CompanionIncomingEventEffects {
            focus_main_window: true,
            ..CompanionIncomingEventEffects::default()
        },
        "pet.open_provider_settings" => CompanionIncomingEventEffects {
            focus_main_window: true,
            open_provider_settings: true,
            ..CompanionIncomingEventEffects::default()
        },
        "pet.request_provider_overview_sync" => CompanionIncomingEventEffects {
            request_provider_sync: true,
            ..CompanionIncomingEventEffects::default()
        },
        "pet.request_pet_cheer" => CompanionIncomingEventEffects {
            request_pet_cheer: true,
            ..CompanionIncomingEventEffects::default()
        },
        "pet.request_pet_next_step" => CompanionIncomingEventEffects {
            request_pet_next_step: true,
            ..CompanionIncomingEventEffects::default()
        },
        "pet.request_voice_chat" => CompanionIncomingEventEffects {
            request_pet_voice_chat: true,
            ..CompanionIncomingEventEffects::default()
        },
        _ => CompanionIncomingEventEffects::default(),
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

    #[test]
    fn incoming_event_effects_focus_or_emit_expected_side_effects() {
        assert_eq!(
            companion_incoming_event_effects("pet.clicked"),
            CompanionIncomingEventEffects {
                focus_main_window: true,
                open_provider_settings: false,
                request_provider_sync: false,
                request_pet_cheer: false,
                request_pet_next_step: false,
                request_pet_voice_chat: false,
            }
        );
        assert_eq!(
            companion_incoming_event_effects("pet.open_provider_settings"),
            CompanionIncomingEventEffects {
                focus_main_window: true,
                open_provider_settings: true,
                request_provider_sync: false,
                request_pet_cheer: false,
                request_pet_next_step: false,
                request_pet_voice_chat: false,
            }
        );
        assert_eq!(
            companion_incoming_event_effects("pet.request_provider_overview_sync"),
            CompanionIncomingEventEffects {
                focus_main_window: false,
                open_provider_settings: false,
                request_provider_sync: true,
                request_pet_cheer: false,
                request_pet_next_step: false,
                request_pet_voice_chat: false,
            }
        );
        assert_eq!(
            companion_incoming_event_effects("pet.request_pet_cheer"),
            CompanionIncomingEventEffects {
                focus_main_window: false,
                open_provider_settings: false,
                request_provider_sync: false,
                request_pet_cheer: true,
                request_pet_next_step: false,
                request_pet_voice_chat: false,
            }
        );
        assert_eq!(
            companion_incoming_event_effects("pet.request_pet_next_step"),
            CompanionIncomingEventEffects {
                focus_main_window: false,
                open_provider_settings: false,
                request_provider_sync: false,
                request_pet_cheer: false,
                request_pet_next_step: true,
                request_pet_voice_chat: false,
            }
        );
        assert_eq!(
            companion_incoming_event_effects("pet.request_voice_chat"),
            CompanionIncomingEventEffects {
                focus_main_window: false,
                open_provider_settings: false,
                request_provider_sync: false,
                request_pet_cheer: false,
                request_pet_next_step: false,
                request_pet_voice_chat: true,
            }
        );
    }

    #[test]
    fn normalize_conversation_bubble_should_extract_supported_live2d_tags() {
        let normalized =
            normalize_conversation_bubble(Some("[joy]当然在，我会陪你把今天慢慢走完[unknown]"));

        assert_eq!(
            normalized.bubble_text,
            "当然在，我会陪你把今天慢慢走完[unknown]"
        );
        assert_eq!(normalized.emotion_tags, vec!["joy".to_string()]);
    }

    #[test]
    fn parse_companion_chat_request_event_payload_should_accept_object_and_string() {
        let object_payload = parse_companion_chat_request_event_payload(
            r#"{"text":"陪我聊两句","source":"voice_window"}"#,
        )
        .expect("对象事件负载应被成功解析");
        assert_eq!(object_payload.text, "陪我聊两句");
        assert_eq!(object_payload.source.as_deref(), Some("voice_window"));

        let string_payload = parse_companion_chat_request_event_payload(r#""今天有点累""#)
            .expect("字符串事件负载应被成功解析");
        assert_eq!(string_payload.text, "今天有点累");
        assert_eq!(string_payload.source.as_deref(), Some("voice_window"));
    }
}
