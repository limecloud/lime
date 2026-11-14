use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::protocol::v0::CapabilitySnapshot;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderCapabilitiesReadParams {}

/// 阻断实时语音会话的单个原因。
///
/// 只有 `realtime == true` 时该列表才为空；UI 只能按这些原因展示不可用状态，
/// 不得渲染开始/停止等伪控制。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeVoiceBlocker {
    /// 当前默认 provider 不是官方 OpenAI API-key 路由，没有可用的 Realtime wire。
    ProviderRealtimeUnsupported,
    /// 官方 OpenAI provider 已配置，但没有可解密使用的启用 API key。
    ProviderKeyMissing,
    /// 没有显式配置实时语音模型。
    RealtimeModelUnconfigured,
    /// 显式配置的模型不在本构建的实时语音 wire 支持集合内。
    RealtimeModelUnsupported,
    /// 没有显式配置实时语音音色。
    RealtimeVoiceUnconfigured,
    /// 显式配置的音色不受官方 Realtime API 支持。
    RealtimeVoiceUnsupported,
    /// 宿主缺少浏览器 WebRTC / 麦克风 / SDP 会话路径。
    RealtimeTransportUnimplemented,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderCapabilitiesReadResponse {
    pub namespace_tools: bool,
    pub image_generation: bool,
    pub web_search: bool,
    /// 当前 provider 路由、配置与宿主是否已经具备端到端实时语音能力。
    ///
    /// `namespaceTools` 同属 Lime 在 Codex 形状上的扩展字段。该值为 `false`
    /// 时，`realtimeBlockers` 给出具体缺失环节。
    pub realtime: bool,
    pub realtime_blockers: Vec<RealtimeVoiceBlocker>,
    /// 显式配置的实时语音模型；未配置时为空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realtime_model: Option<String>,
    /// 显式配置的实时语音音色；未配置时为空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realtime_voice: Option<String>,
    /// 本构建可用的实时语音模型选项；provider 不可用时为空。
    #[serde(default)]
    pub realtime_models: Vec<String>,
    /// 官方 Realtime API 支持的音色选项；provider 不可用时为空。
    #[serde(default)]
    pub realtime_voices: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelListParams {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub include_hidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum InputModality {
    Text,
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelAvailabilityNux {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelServiceTier {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpgradeInfo {
    pub model: String,
    pub upgrade_copy: Option<String>,
    pub model_link: Option<String>,
    pub migration_markdown: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MultiAgentVersion {
    Disabled,
    V1,
    V2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffortOption {
    pub reasoning_effort: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub provider_id: String,
    pub model: String,
    pub upgrade: Option<String>,
    pub upgrade_info: Option<ModelUpgradeInfo>,
    pub availability_nux: Option<ModelAvailabilityNux>,
    pub display_name: String,
    pub description: String,
    pub hidden: bool,
    pub supported_reasoning_efforts: Vec<ReasoningEffortOption>,
    pub default_reasoning_effort: String,
    pub input_modalities: Vec<InputModality>,
    pub capability_snapshot: CapabilitySnapshot,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub supports_personality: bool,
    pub multi_agent_version: Option<MultiAgentVersion>,
    pub additional_speed_tiers: Vec<String>,
    pub service_tiers: Vec<ModelServiceTier>,
    pub default_service_tier: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub data: Vec<Model>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelListUpdatedNotification {
    pub generation: u64,
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ModelRerouteReason {
    HighRiskCyberActivity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelReroutedNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub from_model: String,
    pub to_model: String,
    pub reason: ModelRerouteReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ModelVerification {
    TrustedAccessForCyber,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelVerificationNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub verifications: Vec<ModelVerification>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TurnModerationMetadataNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelSafetyBufferingUpdatedNotification {
    pub thread_id: String,
    pub turn_id: String,
    pub model: String,
    pub use_cases: Vec<String>,
    pub reasons: Vec<String>,
    pub show_buffering_ui: bool,
    pub faster_model: Option<String>,
}
