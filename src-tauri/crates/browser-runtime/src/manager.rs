use crate::action;
use crate::client::CdpCommandClient;
use crate::types::{
    BrowserControlMode, BrowserEvent, BrowserEventPayload, BrowserPageInfo,
    BrowserSessionLifecycleState, BrowserStreamMode, BrowserTransportKind, CdpSessionState,
    CdpTargetInfo, FrameMetadata,
};
use chrono::Utc;
use futures::{stream::SplitStream, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::task::JoinHandle;
use tokio::time::Duration;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{debug, warn};

const DEFAULT_BUFFER_SIZE: usize = 500;
const DEFAULT_CDP_TIMEOUT_MS: u64 = 10_000;
const SCREENSHOT_FALLBACK_INTERVAL_MS: u64 = 500;
const RESUME_TO_LIVE_DELAY_MS: u64 = 1_200;

type CdpRead = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

#[derive(Debug, Clone)]
pub struct EventBufferSnapshot {
    pub events: Vec<BrowserEvent>,
    pub next_cursor: u64,
}

#[derive(Debug, Clone)]
pub struct OpenSessionRequest {
    pub profile_key: String,
    pub remote_debugging_port: u16,
    pub target_id: Option<String>,
    pub environment_preset_id: Option<String>,
    pub environment_preset_name: Option<String>,
}

pub struct BrowserRuntimeManager {
    sessions: RwLock<HashMap<String, CdpSessionHandle>>,
    open_session_gate: Mutex<()>,
}

impl Default for BrowserRuntimeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserRuntimeManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            open_session_gate: Mutex::new(()),
        }
    }

    pub async fn list_targets(
        &self,
        remote_debugging_port: u16,
    ) -> Result<Vec<CdpTargetInfo>, String> {
        fetch_cdp_targets(remote_debugging_port).await
    }

    pub async fn is_cdp_endpoint_alive(&self, remote_debugging_port: u16) -> bool {
        is_cdp_endpoint_alive(remote_debugging_port).await
    }

    pub async fn find_session_by_profile_key(&self, profile_key: &str) -> Option<CdpSessionState> {
        let mut sessions = self
            .session_states_by_profile_key(profile_key)
            .await
            .into_iter()
            .filter(|state| state.connected)
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        sessions.pop()
    }

    pub async fn close_sessions_by_profile_key(&self, profile_key: &str) -> Vec<String> {
        let session_ids = self
            .session_states_by_profile_key(profile_key)
            .await
            .into_iter()
            .map(|state| state.session_id)
            .collect::<Vec<_>>();

        for session_id in &session_ids {
            let _ = self.close_session(session_id).await;
        }

        session_ids
    }

    pub async fn open_session(
        &self,
        request: OpenSessionRequest,
    ) -> Result<CdpSessionState, String> {
        let _open_guard = self.open_session_gate.lock().await;
        if let Some(existing) = self.find_session_by_profile_key(&request.profile_key).await {
            let duplicate_session_ids = self
                .session_states_by_profile_key(&request.profile_key)
                .await
                .into_iter()
                .filter(|state| state.connected && state.session_id != existing.session_id)
                .map(|state| state.session_id)
                .collect::<Vec<_>>();
            for session_id in duplicate_session_ids {
                let _ = self.close_session(&session_id).await;
            }
            if existing.environment_preset_id == request.environment_preset_id {
                return Ok(existing);
            }
            return Err(format!(
                "浏览器资料 {} 已存在运行会话，当前环境预设与现有会话不同，请先关闭会话后再切换环境",
                request.profile_key
            ));
        }

        let target =
            ensure_cdp_target(request.remote_debugging_port, request.target_id.as_deref()).await?;
        let ws_url = target
            .web_socket_debugger_url
            .clone()
            .ok_or_else(|| "目标标签页缺少 webSocketDebuggerUrl".to_string())?;
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| format!("连接 CDP WebSocket 失败: {e}"))?;
        let (writer, reader) = ws_stream.split();
        let created_at = Utc::now().to_rfc3339();
        let session_id = uuid::Uuid::new_v4().to_string();
        let state = CdpSessionState {
            session_id: session_id.clone(),
            profile_key: request.profile_key.clone(),
            environment_preset_id: request.environment_preset_id.clone(),
            environment_preset_name: request.environment_preset_name.clone(),
            target_id: target.id.clone(),
            target_title: target.title.clone(),
            target_url: target.url.clone(),
            remote_debugging_port: request.remote_debugging_port,
            ws_debugger_url: ws_url,
            devtools_frontend_url: target.devtools_frontend_url.clone(),
            stream_mode: None,
            transport_kind: BrowserTransportKind::CdpFrames,
            lifecycle_state: BrowserSessionLifecycleState::Launching,
            control_mode: BrowserControlMode::Agent,
            human_reason: None,
            last_page_info: None,
            last_event_at: None,
            last_frame_at: None,
            last_error: None,
            created_at,
            connected: true,
        };
        let session = CdpSessionHandle::new(state, writer);
        let session_clone = session.clone();
        let reader_task = tokio::spawn(async move {
            session_clone.reader_loop(reader).await;
        });
        session.set_reader_task(reader_task).await;
        session.bootstrap().await?;
        session
            .emit(BrowserEventPayload::SessionOpened {
                profile_key: request.profile_key,
                target_id: target.id,
            })
            .await;
        session
            .set_session_state(
                BrowserSessionLifecycleState::Live,
                BrowserControlMode::Agent,
                None,
            )
            .await;
        if let Ok(page_info) = session.capture_page_info().await {
            session.update_page_info(page_info).await;
        }
        self.sessions
            .write()
            .await
            .insert(session_id, session.clone());
        Ok(session.state().await)
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let session = {
            let mut sessions = self.sessions.write().await;
            sessions
                .remove(session_id)
                .ok_or_else(|| format!("未找到 session_id={session_id}"))?
        };
        session.shutdown("manual_close").await;
        Ok(())
    }

    pub async fn start_stream(
        &self,
        session_id: &str,
        mode: BrowserStreamMode,
    ) -> Result<CdpSessionState, String> {
        let session = self.get_session(session_id).await?;
        session.start_stream(mode).await?;
        Ok(session.state().await)
    }

    pub async fn stop_stream(&self, session_id: &str) -> Result<CdpSessionState, String> {
        let session = self.get_session(session_id).await?;
        session.stop_stream().await?;
        Ok(session.state().await)
    }

    pub async fn get_session_state(&self, session_id: &str) -> Result<CdpSessionState, String> {
        Ok(self.get_session(session_id).await?.state().await)
    }

    pub async fn take_over_session(
        &self,
        session_id: &str,
        human_reason: Option<String>,
    ) -> Result<CdpSessionState, String> {
        let session = self.get_session(session_id).await?;
        session.take_over(human_reason).await;
        Ok(session.state().await)
    }

    pub async fn release_session(
        &self,
        session_id: &str,
        human_reason: Option<String>,
    ) -> Result<CdpSessionState, String> {
        let session = self.get_session(session_id).await?;
        session.release(human_reason).await;
        Ok(session.state().await)
    }

    pub async fn resume_session(
        &self,
        session_id: &str,
        human_reason: Option<String>,
    ) -> Result<CdpSessionState, String> {
        let session = self.get_session(session_id).await?;
        session.resume(human_reason).await;
        Ok(session.state().await)
    }

    pub async fn get_event_buffer(
        &self,
        session_id: &str,
        cursor: Option<u64>,
    ) -> Result<EventBufferSnapshot, String> {
        Ok(self
            .get_session(session_id)
            .await?
            .event_buffer(cursor)
            .await)
    }

    pub async fn send_command(
        &self,
        session_id: &str,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        self.get_session(session_id)
            .await?
            .send_command(method, params, timeout_ms)
            .await
    }

    pub async fn refresh_page_info(&self, session_id: &str) -> Result<CdpSessionState, String> {
        let session = self.get_session(session_id).await?;
        let page_info = session.capture_page_info().await?;
        session.update_page_info(page_info).await;
        Ok(session.state().await)
    }

    pub async fn subscribe(
        &self,
        session_id: &str,
    ) -> Result<broadcast::Receiver<BrowserEvent>, String> {
        Ok(self.get_session(session_id).await?.subscribe())
    }

    pub async fn execute_action(
        &self,
        session_id: &str,
        action: &str,
        args: Value,
    ) -> Result<Value, String> {
        let session = self.get_session(session_id).await?;
        let command_id = session.next_user_command_id();
        session
            .emit(BrowserEventPayload::CommandStarted {
                command_id,
                action: action.to_string(),
            })
            .await;
        match action::execute_action(&session, action, args).await {
            Ok(result) => {
                session
                    .emit(BrowserEventPayload::CommandCompleted {
                        command_id,
                        action: action.to_string(),
                    })
                    .await;
                Ok(result)
            }
            Err(error) => {
                session
                    .emit(BrowserEventPayload::CommandFailed {
                        command_id,
                        action: action.to_string(),
                        error: error.clone(),
                    })
                    .await;
                Err(error)
            }
        }
    }

    async fn get_session(&self, session_id: &str) -> Result<CdpSessionHandle, String> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("未找到 session_id={session_id}"))
    }

    async fn session_states_by_profile_key(&self, profile_key: &str) -> Vec<CdpSessionState> {
        let session_handles = self
            .sessions
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut matches = Vec::new();
        for session in session_handles {
            let state = session.state().await;
            if state.profile_key == profile_key {
                matches.push(state);
            }
        }
        matches
    }
}

fn cdp_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

#[derive(Clone)]
pub struct CdpSessionHandle {
    inner: Arc<CdpSession>,
}

impl CdpSessionHandle {
    fn new(
        state: CdpSessionState,
        writer: futures::stream::SplitSink<
            WebSocketStream<MaybeTlsStream<TcpStream>>,
            tokio_tungstenite::tungstenite::Message,
        >,
    ) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            inner: Arc::new(CdpSession {
                client: Arc::new(CdpCommandClient::new(writer)),
                state: RwLock::new(state),
                event_buffer: RwLock::new(VecDeque::with_capacity(DEFAULT_BUFFER_SIZE)),
                event_tx,
                next_event_sequence: AtomicU64::new(1),
                next_user_command_id: AtomicU64::new(1),
                frame_sequence: AtomicU64::new(1),
                reader_task: Mutex::new(None),
                screenshot_task: Mutex::new(None),
                fallback_frames_running: AtomicBool::new(false),
            }),
        }
    }

    pub async fn bootstrap(&self) -> Result<(), String> {
        for method in [
            "Page.enable",
            "Runtime.enable",
            "Network.enable",
            "Log.enable",
        ] {
            let _ = self
                .send_command(method, json!({}), DEFAULT_CDP_TIMEOUT_MS)
                .await;
        }
        let _ = self
            .send_command(
                "Target.setAutoAttach",
                json!({
                    "autoAttach": true,
                    "waitForDebuggerOnStart": false,
                    "flatten": true,
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await;
        Ok(())
    }

    pub async fn state(&self) -> CdpSessionState {
        self.inner.state.read().await.clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BrowserEvent> {
        self.inner.event_tx.subscribe()
    }

    pub async fn event_buffer(&self, cursor: Option<u64>) -> EventBufferSnapshot {
        let buffer = self.inner.event_buffer.read().await;
        let events = buffer
            .iter()
            .filter(|event| cursor.map(|value| event.sequence > value).unwrap_or(true))
            .cloned()
            .collect::<Vec<_>>();
        let next_cursor = buffer.back().map(|event| event.sequence).unwrap_or(0);
        EventBufferSnapshot {
            events,
            next_cursor,
        }
    }

    pub fn next_user_command_id(&self) -> u64 {
        self.inner
            .next_user_command_id
            .fetch_add(1, Ordering::SeqCst)
    }

    pub async fn set_reader_task(&self, task: JoinHandle<()>) {
        *self.inner.reader_task.lock().await = Some(task);
    }

    pub async fn send_command(
        &self,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        self.inner
            .client
            .send_command(method, params, timeout_ms)
            .await
    }

    pub async fn runtime_evaluate(
        &self,
        expression: String,
        return_by_value: bool,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let response = self
            .send_command(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "returnByValue": return_by_value,
                    "awaitPromise": true,
                }),
                timeout_ms,
            )
            .await?;
        if let Some(exception) = response.get("exceptionDetails") {
            return Err(format!("页面脚本执行失败: {exception}"));
        }
        let result = response.get("result").cloned().unwrap_or(Value::Null);
        Ok(result.get("value").cloned().unwrap_or(result))
    }

    pub async fn capture_page_info(&self) -> Result<BrowserPageInfo, String> {
        let result = self
            .runtime_evaluate(
                r#"
(() => {
  const bodyText = (document.body?.innerText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80)
    .join("\n");
  const title = document.title || location.href;
  const url = location.href;
  return {
    title,
    url,
    markdown: `# ${title}\nURL: ${url}\n\n${bodyText}`.trim(),
  };
})()
"#
                .to_string(),
                true,
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await?;
        let title = result
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let url = result
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let markdown = result
            .get("markdown")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Ok(BrowserPageInfo {
            title,
            url,
            markdown,
            updated_at: Utc::now().to_rfc3339(),
        })
    }

    pub async fn update_page_info(&self, page_info: BrowserPageInfo) {
        {
            let mut state = self.inner.state.write().await;
            state.target_title = page_info.title.clone();
            state.target_url = page_info.url.clone();
            state.last_page_info = Some(page_info.clone());
            state.last_event_at = Some(Utc::now().to_rfc3339());
        }
        self.emit(BrowserEventPayload::PageInfoChanged {
            title: page_info.title,
            url: page_info.url,
            markdown: page_info.markdown,
        })
        .await;
        self.promote_to_live_if_needed().await;
    }

    pub async fn emit(&self, payload: BrowserEventPayload) {
        let session_id = self.inner.state.read().await.session_id.clone();
        let sequence = self
            .inner
            .next_event_sequence
            .fetch_add(1, Ordering::SeqCst);
        let occurred_at = Utc::now().to_rfc3339();
        let event = BrowserEvent {
            session_id,
            sequence,
            occurred_at: occurred_at.clone(),
            payload,
        };
        {
            let mut buffer = self.inner.event_buffer.write().await;
            buffer.push_back(event.clone());
            while buffer.len() > DEFAULT_BUFFER_SIZE {
                buffer.pop_front();
            }
        }
        {
            let mut state = self.inner.state.write().await;
            state.last_event_at = Some(occurred_at);
            match &event.payload {
                BrowserEventPayload::FrameChunk { .. } => {
                    state.last_frame_at = Some(event.occurred_at.clone());
                }
                BrowserEventPayload::SessionError { error } => {
                    state.last_error = Some(error.clone());
                }
                BrowserEventPayload::SessionClosed { .. } => {
                    state.connected = false;
                    if !matches!(
                        state.lifecycle_state,
                        BrowserSessionLifecycleState::Failed | BrowserSessionLifecycleState::Closed
                    ) {
                        state.lifecycle_state = BrowserSessionLifecycleState::Closed;
                    }
                }
                _ => {}
            }
        }
        let _ = self.inner.event_tx.send(event);
    }

    pub async fn start_stream(&self, mode: BrowserStreamMode) -> Result<(), String> {
        {
            let mut state = self.inner.state.write().await;
            state.stream_mode = Some(mode);
        }
        self.promote_to_live_if_needed().await;
        if !mode.includes_frames() {
            return Ok(());
        }
        if self
            .send_command(
                "Page.startScreencast",
                json!({
                    "format": "jpeg",
                    "quality": 60,
                    "maxWidth": 1280,
                    "maxHeight": 720,
                    "everyNthFrame": 1,
                }),
                DEFAULT_CDP_TIMEOUT_MS,
            )
            .await
            .is_ok()
        {
            self.inner
                .fallback_frames_running
                .store(false, Ordering::SeqCst);
            return Ok(());
        }
        self.start_screenshot_fallback().await;
        Ok(())
    }

    pub async fn stop_stream(&self) -> Result<(), String> {
        {
            let mut state = self.inner.state.write().await;
            state.stream_mode = None;
        }
        self.inner
            .fallback_frames_running
            .store(false, Ordering::SeqCst);
        if let Some(task) = self.inner.screenshot_task.lock().await.take() {
            task.abort();
        }
        let _ = self
            .send_command("Page.stopScreencast", json!({}), DEFAULT_CDP_TIMEOUT_MS)
            .await;
        Ok(())
    }

    pub async fn shutdown(&self, reason: &str) {
        let _ = self.stop_stream().await;
        self.set_session_state(
            BrowserSessionLifecycleState::Closed,
            BrowserControlMode::Agent,
            None,
        )
        .await;
        {
            let mut state = self.inner.state.write().await;
            state.connected = false;
        }
        if let Some(task) = self.inner.reader_task.lock().await.take() {
            task.abort();
        }
        self.emit(BrowserEventPayload::SessionClosed {
            reason: reason.to_string(),
        })
        .await;
    }

    pub async fn take_over(&self, human_reason: Option<String>) {
        self.set_session_state(
            BrowserSessionLifecycleState::HumanControlling,
            BrowserControlMode::Human,
            human_reason,
        )
        .await;
    }

    pub async fn release(&self, human_reason: Option<String>) {
        self.set_session_state(
            BrowserSessionLifecycleState::WaitingForHuman,
            BrowserControlMode::Shared,
            human_reason,
        )
        .await;
    }

    pub async fn resume(&self, human_reason: Option<String>) {
        self.set_session_state(
            BrowserSessionLifecycleState::AgentResuming,
            BrowserControlMode::Agent,
            human_reason,
        )
        .await;
        let session = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(RESUME_TO_LIVE_DELAY_MS)).await;
            session.promote_to_live_if_needed().await;
        });
    }

    pub fn collect_console_messages(&self, since: Option<u64>) -> Vec<BrowserEvent> {
        if let Ok(buffer) = self.inner.event_buffer.try_read() {
            buffer
                .iter()
                .filter(|event| {
                    since.map(|value| event.sequence > value).unwrap_or(true)
                        && matches!(event.payload, BrowserEventPayload::ConsoleMessage { .. })
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn collect_network_events(&self, since: Option<u64>) -> Vec<BrowserEvent> {
        if let Ok(buffer) = self.inner.event_buffer.try_read() {
            buffer
                .iter()
                .filter(|event| {
                    since.map(|value| event.sequence > value).unwrap_or(true)
                        && matches!(
                            event.payload,
                            BrowserEventPayload::NetworkRequest { .. }
                                | BrowserEventPayload::NetworkResponse { .. }
                                | BrowserEventPayload::NetworkFailed { .. }
                        )
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    async fn reader_loop(&self, mut reader: CdpRead) {
        let mut close_reason = "socket_closed".to_string();
        let mut close_as_failed = false;
        while let Some(message) = reader.next().await {
            match message {
                Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                    if let Err(error) = self.handle_message(text.to_string()).await {
                        warn!("处理 CDP 消息失败: {error}");
                        self.emit(BrowserEventPayload::SessionError { error }).await;
                    }
                }
                Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => break,
                Ok(_) => {}
                Err(error) => {
                    close_reason = "socket_error".to_string();
                    close_as_failed = true;
                    self.emit(BrowserEventPayload::SessionError {
                        error: format!("读取 CDP 消息失败: {error}"),
                    })
                    .await;
                    break;
                }
            }
        }
        if close_as_failed {
            self.set_session_state(
                BrowserSessionLifecycleState::Failed,
                BrowserControlMode::Agent,
                None,
            )
            .await;
        } else {
            self.set_session_state(
                BrowserSessionLifecycleState::Closed,
                BrowserControlMode::Agent,
                None,
            )
            .await;
        }
        {
            let mut state = self.inner.state.write().await;
            state.connected = false;
        }
        self.emit(BrowserEventPayload::SessionClosed {
            reason: close_reason,
        })
        .await;
    }

    async fn handle_message(&self, text: String) -> Result<(), String> {
        let payload: Value =
            serde_json::from_str(&text).map_err(|e| format!("解析 CDP 消息失败: {e}"))?;
        if let Some(id) = payload.get("id").and_then(Value::as_u64) {
            if let Some(error) = payload.get("error") {
                self.inner
                    .client
                    .respond(id, Err(format!("CDP 错误: {error}")))
                    .await;
            } else {
                self.inner
                    .client
                    .respond(
                        id,
                        Ok(payload.get("result").cloned().unwrap_or(Value::Null)),
                    )
                    .await;
            }
            return Ok(());
        }

        let Some(method) = payload.get("method").and_then(Value::as_str) else {
            return Ok(());
        };
        let params = payload.get("params").cloned().unwrap_or(Value::Null);
        match method {
            "Runtime.consoleAPICalled" => {
                let level = params
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("log")
                    .to_string();
                let text = params
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .map(extract_remote_value)
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default();
                let timestamp = params
                    .get("timestamp")
                    .and_then(Value::as_f64)
                    .map(|value| value as i64)
                    .unwrap_or_else(|| Utc::now().timestamp_millis());
                self.emit(BrowserEventPayload::ConsoleMessage {
                    level,
                    text,
                    timestamp,
                })
                .await;
            }
            "Log.entryAdded" => {
                let entry = params.get("entry").cloned().unwrap_or(Value::Null);
                let level = entry
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or("info")
                    .to_string();
                let text = entry
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let timestamp = entry
                    .get("timestamp")
                    .and_then(Value::as_f64)
                    .map(|value| value as i64)
                    .unwrap_or_else(|| Utc::now().timestamp_millis());
                self.emit(BrowserEventPayload::ConsoleMessage {
                    level,
                    text,
                    timestamp,
                })
                .await;
            }
            "Network.requestWillBeSent" => {
                let request = params.get("request").cloned().unwrap_or(Value::Null);
                self.emit(BrowserEventPayload::NetworkRequest {
                    request_id: params
                        .get("requestId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    url: request
                        .get("url")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    method: request
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .await;
            }
            "Network.responseReceived" => {
                let response = params.get("response").cloned().unwrap_or(Value::Null);
                self.emit(BrowserEventPayload::NetworkResponse {
                    request_id: params
                        .get("requestId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    url: response
                        .get("url")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    status: response
                        .get("status")
                        .and_then(Value::as_f64)
                        .map(|value| value.round() as u16)
                        .unwrap_or(0),
                    mime_type: response
                        .get("mimeType")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .await;
            }
            "Network.loadingFailed" => {
                self.emit(BrowserEventPayload::NetworkFailed {
                    request_id: params
                        .get("requestId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    error_text: params
                        .get("errorText")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .await;
            }
            "Page.loadEventFired" => {
                // 不要在 reader_loop 内直接等待 Runtime.evaluate，
                // 否则会把“等待响应”和“接收响应”锁在同一个任务里。
                let session = self.clone();
                tokio::spawn(async move {
                    if let Ok(page_info) = session.capture_page_info().await {
                        session.update_page_info(page_info).await;
                    }
                });
            }
            "Page.screencastFrame" => {
                let data = params
                    .get("data")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let metadata = params.get("metadata").cloned().unwrap_or(Value::Null);
                let sequence = self.inner.frame_sequence.fetch_add(1, Ordering::SeqCst);
                let frame = FrameMetadata {
                    width: metadata
                        .get("deviceWidth")
                        .and_then(Value::as_u64)
                        .unwrap_or(1280) as u32,
                    height: metadata
                        .get("deviceHeight")
                        .and_then(Value::as_u64)
                        .unwrap_or(720) as u32,
                    timestamp: Utc::now().timestamp_millis(),
                    sequence,
                };
                self.emit(BrowserEventPayload::FrameChunk {
                    data,
                    metadata: frame,
                })
                .await;
                self.promote_to_live_if_needed().await;
                if let Some(session_id) = params.get("sessionId").and_then(Value::as_u64) {
                    let session = self.clone();
                    tokio::spawn(async move {
                        let _ = session
                            .send_command(
                                "Page.screencastFrameAck",
                                json!({ "sessionId": session_id }),
                                DEFAULT_CDP_TIMEOUT_MS,
                            )
                            .await;
                    });
                }
            }
            _ => {
                debug!("忽略未处理 CDP 事件: {method}");
            }
        }
        Ok(())
    }

    async fn set_session_state(
        &self,
        lifecycle_state: BrowserSessionLifecycleState,
        control_mode: BrowserControlMode,
        human_reason: Option<String>,
    ) {
        let normalized_reason = human_reason
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let should_emit = {
            let mut state = self.inner.state.write().await;
            let changed = state.lifecycle_state != lifecycle_state
                || state.control_mode != control_mode
                || state.human_reason != normalized_reason;
            state.lifecycle_state = lifecycle_state;
            state.control_mode = control_mode;
            state.human_reason = normalized_reason.clone();
            changed
        };

        if should_emit {
            self.emit(BrowserEventPayload::SessionStateChanged {
                lifecycle_state,
                control_mode,
                human_reason: normalized_reason,
            })
            .await;
        }
    }

    async fn promote_to_live_if_needed(&self) {
        let should_promote = {
            let state = self.inner.state.read().await;
            state.connected
                && matches!(
                    state.lifecycle_state,
                    BrowserSessionLifecycleState::Launching
                        | BrowserSessionLifecycleState::AgentResuming
                )
        };

        if should_promote {
            self.set_session_state(
                BrowserSessionLifecycleState::Live,
                BrowserControlMode::Agent,
                None,
            )
            .await;
        }
    }

    async fn start_screenshot_fallback(&self) {
        if self
            .inner
            .fallback_frames_running
            .swap(true, Ordering::SeqCst)
        {
            return;
        }
        let session = self.clone();
        let task = tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis(SCREENSHOT_FALLBACK_INTERVAL_MS));
            loop {
                interval.tick().await;
                if !session.inner.fallback_frames_running.load(Ordering::SeqCst) {
                    break;
                }
                match session
                    .send_command(
                        "Page.captureScreenshot",
                        json!({
                            "format": "jpeg",
                            "quality": 60,
                        }),
                        DEFAULT_CDP_TIMEOUT_MS,
                    )
                    .await
                {
                    Ok(result) => {
                        if let Some(data) = result.get("data").and_then(Value::as_str) {
                            let frame = FrameMetadata {
                                width: 1280,
                                height: 720,
                                timestamp: Utc::now().timestamp_millis(),
                                sequence: session
                                    .inner
                                    .frame_sequence
                                    .fetch_add(1, Ordering::SeqCst),
                            };
                            session
                                .emit(BrowserEventPayload::FrameChunk {
                                    data: data.to_string(),
                                    metadata: frame,
                                })
                                .await;
                            session.promote_to_live_if_needed().await;
                        } else {
                            session
                                .emit(BrowserEventPayload::FrameDropped {
                                    reason: "截图结果缺少 data 字段".to_string(),
                                })
                                .await;
                        }
                    }
                    Err(error) => {
                        session
                            .emit(BrowserEventPayload::FrameDropped { reason: error })
                            .await;
                    }
                }
            }
        });
        *self.inner.screenshot_task.lock().await = Some(task);
    }
}

struct CdpSession {
    client: Arc<CdpCommandClient>,
    state: RwLock<CdpSessionState>,
    event_buffer: RwLock<VecDeque<BrowserEvent>>,
    event_tx: broadcast::Sender<BrowserEvent>,
    next_event_sequence: AtomicU64,
    next_user_command_id: AtomicU64,
    frame_sequence: AtomicU64,
    reader_task: Mutex<Option<JoinHandle<()>>>,
    screenshot_task: Mutex<Option<JoinHandle<()>>>,
    fallback_frames_running: AtomicBool,
}

async fn ensure_cdp_target(
    port: u16,
    requested_target_id: Option<&str>,
) -> Result<CdpTargetInfo, String> {
    let mut targets = fetch_cdp_targets(port).await?;
    if targets.is_empty() {
        open_new_target(port, "about:blank").await?;
        targets = fetch_cdp_targets(port).await?;
    }
    if let Some(target_id) = requested_target_id {
        if let Some(target) = targets.into_iter().find(|item| item.id == target_id) {
            return Ok(target);
        }
        return Err(format!("未找到 target_id={target_id}"));
    }
    if let Some(target) = targets
        .iter()
        .find(|item| item.target_type == "page")
        .cloned()
    {
        return Ok(target);
    }
    targets
        .into_iter()
        .next()
        .ok_or_else(|| "CDP 未返回可用标签页".to_string())
}

async fn open_new_target(port: u16, url: &str) -> Result<(), String> {
    let endpoint = format!(
        "http://127.0.0.1:{port}/json/new?{}",
        urlencoding::encode(url)
    );
    let client = cdp_http_client(5)?;
    let response = match client.put(&endpoint).send().await {
        Ok(resp) => resp,
        Err(_) => client
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("创建 CDP 标签页失败: {e}"))?,
    };
    if !response.status().is_success() {
        return Err(format!("创建 CDP 标签页失败: {}", response.status()));
    }
    Ok(())
}

pub async fn fetch_cdp_targets(port: u16) -> Result<Vec<CdpTargetInfo>, String> {
    let endpoint = format!("http://127.0.0.1:{port}/json/list");
    let client = cdp_http_client(5)?;
    let response = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("读取 CDP 标签页失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("读取 CDP 标签页失败: {}", response.status()));
    }
    response
        .json::<Vec<CdpTargetInfo>>()
        .await
        .map_err(|e| format!("解析 CDP 标签页失败: {e}"))
}

pub async fn is_cdp_endpoint_alive(port: u16) -> bool {
    let endpoint = format!("http://127.0.0.1:{port}/json/version");
    let client = match cdp_http_client(2) {
        Ok(client) => client,
        Err(_) => return false,
    };
    match client.get(endpoint).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

fn extract_remote_value(value: &Value) -> String {
    value
        .get("value")
        .or_else(|| value.get("description"))
        .or_else(|| value.get("unserializableValue"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_target_info_with_debugger_urls() {
        let value = json!({
            "id": "page-1",
            "title": "Example",
            "url": "https://example.com",
            "type": "page",
            "webSocketDebuggerUrl": "ws://127.0.0.1/devtools/page/1",
            "devtoolsFrontendUrl": "/devtools/inspector.html?ws=127.0.0.1/devtools/page/1"
        });
        let parsed: CdpTargetInfo = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.id, "page-1");
        assert_eq!(parsed.target_type, "page");
        assert!(parsed.web_socket_debugger_url.is_some());
        assert!(parsed.devtools_frontend_url.is_some());
    }
}
