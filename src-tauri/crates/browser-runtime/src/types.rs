use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserPageInfo {
    pub title: String,
    pub url: String,
    pub markdown: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserStreamMode {
    Events,
    Frames,
    Both,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserSessionLifecycleState {
    Launching,
    Live,
    WaitingForHuman,
    HumanControlling,
    AgentResuming,
    Closed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserControlMode {
    Agent,
    Human,
    Shared,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserTransportKind {
    CdpFrames,
}

impl BrowserStreamMode {
    pub fn includes_frames(self) -> bool {
        matches!(self, Self::Frames | Self::Both)
    }

    pub fn includes_events(self) -> bool {
        matches!(self, Self::Events | Self::Both)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameMetadata {
    pub width: u32,
    pub height: u32,
    pub timestamp: i64,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserEvent {
    pub session_id: String,
    pub sequence: u64,
    pub occurred_at: String,
    #[serde(flatten)]
    pub payload: BrowserEventPayload,
}

impl BrowserEvent {
    pub fn is_frame_related(&self) -> bool {
        matches!(
            self.payload,
            BrowserEventPayload::FrameChunk { .. } | BrowserEventPayload::FrameDropped { .. }
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BrowserEventPayload {
    SessionOpened {
        profile_key: String,
        target_id: String,
    },
    SessionClosed {
        reason: String,
    },
    SessionError {
        error: String,
    },
    SessionStateChanged {
        lifecycle_state: BrowserSessionLifecycleState,
        control_mode: BrowserControlMode,
        #[serde(skip_serializing_if = "Option::is_none")]
        human_reason: Option<String>,
    },
    PageInfoChanged {
        title: String,
        url: String,
        markdown: String,
    },
    ConsoleMessage {
        level: String,
        text: String,
        timestamp: i64,
    },
    NetworkRequest {
        request_id: String,
        url: String,
        method: String,
    },
    NetworkResponse {
        request_id: String,
        url: String,
        status: u16,
        mime_type: String,
    },
    NetworkFailed {
        request_id: String,
        error_text: String,
    },
    FrameChunk {
        data: String,
        metadata: FrameMetadata,
    },
    FrameDropped {
        reason: String,
    },
    CommandStarted {
        command_id: u64,
        action: String,
    },
    CommandCompleted {
        command_id: u64,
        action: String,
    },
    CommandFailed {
        command_id: u64,
        action: String,
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpTargetInfo {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "type", default)]
    pub target_type: String,
    #[serde(rename = "webSocketDebuggerUrl", default)]
    pub web_socket_debugger_url: Option<String>,
    #[serde(rename = "devtoolsFrontendUrl", default)]
    pub devtools_frontend_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpSessionState {
    pub session_id: String,
    pub profile_key: String,
    pub environment_preset_id: Option<String>,
    pub environment_preset_name: Option<String>,
    pub target_id: String,
    pub target_title: String,
    pub target_url: String,
    pub remote_debugging_port: u16,
    pub ws_debugger_url: String,
    pub devtools_frontend_url: Option<String>,
    pub stream_mode: Option<BrowserStreamMode>,
    pub transport_kind: BrowserTransportKind,
    pub lifecycle_state: BrowserSessionLifecycleState,
    pub control_mode: BrowserControlMode,
    pub human_reason: Option<String>,
    pub last_page_info: Option<BrowserPageInfo>,
    pub last_event_at: Option<String>,
    pub last_frame_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub connected: bool,
}
