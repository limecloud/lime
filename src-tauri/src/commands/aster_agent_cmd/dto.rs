use super::*;
use crate::services::runtime_file_checkpoint_service;
use chrono::{DateTime, Utc};
use lime_core::models::model_registry::ModelCapabilities;

/// Aster Agent 状态信息
#[derive(Debug, Serialize)]
pub struct AsterAgentStatus {
    pub initialized: bool,
    pub provider_configured: bool,
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_selector: Option<String>,
    pub model_name: Option<String>,
    /// 凭证 UUID（来自凭证池）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_uuid: Option<String>,
}

/// Provider 配置请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigureProviderRequest {
    #[serde(default)]
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub model_name: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default, alias = "modelCapabilities")]
    pub model_capabilities: Option<ModelCapabilities>,
    #[serde(default, alias = "toolCallStrategy")]
    pub tool_call_strategy: Option<RuntimeToolCallStrategy>,
    #[serde(default, alias = "toolshimModel")]
    pub toolshim_model: Option<String>,
}

/// 从凭证池配置 Provider 的请求
#[derive(Debug, Deserialize)]
pub struct ConfigureFromPoolRequest {
    /// Provider 类型 (openai, anthropic, kiro, gemini 等)
    pub provider_type: String,
    /// 模型名称
    pub model_name: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeToolInventoryRequest {
    #[serde(default)]
    pub workbench: bool,
    #[serde(default)]
    pub browser_assist: bool,
    #[serde(default)]
    pub caller: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

/// 发送消息请求参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsterChatRequest {
    pub message: String,
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "eventName")]
    pub event_name: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub images: Option<Vec<ImageInput>>,
    /// Provider 配置（可选，如果未配置则使用当前配置）
    #[serde(default, alias = "providerConfig")]
    pub provider_config: Option<ConfigureProviderRequest>,
    /// Provider 偏好（后端会基于该偏好解析最终 provider_config）
    #[serde(default, alias = "providerPreference")]
    pub provider_preference: Option<String>,
    /// 模型偏好（后端会基于该偏好解析最终 model_name）
    #[serde(default, alias = "modelPreference")]
    pub model_preference: Option<String>,
    /// 是否偏好 reasoning 变体
    #[serde(default, alias = "thinkingEnabled")]
    pub thinking_enabled: Option<bool>,
    /// 执行权限审批策略
    #[serde(default, alias = "approvalPolicy")]
    pub approval_policy: Option<String>,
    /// 执行沙箱策略
    #[serde(default, alias = "sandboxPolicy")]
    pub sandbox_policy: Option<String>,
    /// 项目 ID（可选，用于注入项目上下文到 System Prompt）
    #[serde(default, alias = "projectId")]
    pub project_id: Option<String>,
    /// Workspace ID（必填，用于校验会话与工作区一致性）
    #[serde(alias = "workspaceId")]
    pub workspace_id: String,
    /// 是否强制开启联网搜索工具策略
    #[serde(default, alias = "webSearch")]
    pub web_search: Option<bool>,
    /// 联网搜索模式（disabled / allowed / required）
    #[serde(default, alias = "searchMode")]
    pub search_mode: Option<RequestToolPolicyMode>,
    /// 执行策略（react / code_orchestrated / auto）
    #[serde(default, alias = "executionStrategy")]
    pub execution_strategy: Option<AsterExecutionStrategy>,
    /// 自动续写策略（用于文稿续写等场景）
    #[serde(default, alias = "autoContinue")]
    pub auto_continue: Option<AutoContinuePayload>,
    /// 前端传入的 System Prompt（可选，优先级低于项目上下文）
    #[serde(default, alias = "systemPrompt")]
    pub system_prompt: Option<String>,
    /// 请求级元数据（可选，用于 harness / 工作区编排状态对齐）
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    /// 回合 ID（可选，由前端提供时透传到 Aster runtime）
    #[serde(default, alias = "turnId")]
    pub turn_id: Option<String>,
    /// 会话忙时是否进入后端队列
    #[serde(default, alias = "queueIfBusy")]
    pub queue_if_busy: Option<bool>,
    /// 队列项 ID（由前端或后端生成）
    #[serde(default, alias = "queuedTurnId")]
    pub queued_turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTurnConfigSnapshot {
    #[serde(default, alias = "providerConfig")]
    pub provider_config: Option<ConfigureProviderRequest>,
    #[serde(default, alias = "providerPreference")]
    pub provider_preference: Option<String>,
    #[serde(default, alias = "modelPreference")]
    pub model_preference: Option<String>,
    #[serde(default, alias = "thinkingEnabled")]
    pub thinking_enabled: Option<bool>,
    #[serde(default, alias = "approvalPolicy")]
    pub approval_policy: Option<String>,
    #[serde(default, alias = "sandboxPolicy")]
    pub sandbox_policy: Option<String>,
    #[serde(default, alias = "executionStrategy")]
    pub execution_strategy: Option<AsterExecutionStrategy>,
    #[serde(default, alias = "webSearch")]
    pub web_search: Option<bool>,
    #[serde(default, alias = "searchMode")]
    pub search_mode: Option<RequestToolPolicyMode>,
    #[serde(default, alias = "autoContinue")]
    pub auto_continue: Option<AutoContinuePayload>,
    #[serde(default, alias = "systemPrompt")]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeSubmitTurnRequest {
    pub message: String,
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "eventName")]
    pub event_name: String,
    #[serde(default)]
    pub images: Option<Vec<ImageInput>>,
    #[serde(alias = "workspaceId")]
    pub workspace_id: Option<String>,
    #[serde(default, alias = "turnConfig")]
    pub turn_config: Option<AgentTurnConfigSnapshot>,
    #[serde(default, alias = "turnId")]
    #[allow(dead_code)]
    pub turn_id: Option<String>,
    #[serde(default, alias = "queueIfBusy")]
    pub queue_if_busy: Option<bool>,
    #[serde(default, alias = "queuedTurnId")]
    pub queued_turn_id: Option<String>,
}

impl From<AgentRuntimeSubmitTurnRequest> for AsterChatRequest {
    fn from(request: AgentRuntimeSubmitTurnRequest) -> Self {
        let turn_config = request.turn_config;
        Self {
            message: request.message,
            session_id: request.session_id,
            event_name: request.event_name,
            images: request.images,
            provider_config: turn_config
                .as_ref()
                .and_then(|config| config.provider_config.clone()),
            provider_preference: turn_config
                .as_ref()
                .and_then(|config| config.provider_preference.clone()),
            model_preference: turn_config
                .as_ref()
                .and_then(|config| config.model_preference.clone()),
            thinking_enabled: turn_config
                .as_ref()
                .and_then(|config| config.thinking_enabled),
            approval_policy: turn_config
                .as_ref()
                .and_then(|config| config.approval_policy.clone()),
            sandbox_policy: turn_config
                .as_ref()
                .and_then(|config| config.sandbox_policy.clone()),
            project_id: None,
            workspace_id: request.workspace_id.unwrap_or_default(),
            web_search: turn_config.as_ref().and_then(|config| config.web_search),
            search_mode: turn_config.as_ref().and_then(|config| config.search_mode),
            execution_strategy: turn_config
                .as_ref()
                .and_then(|config| config.execution_strategy),
            auto_continue: turn_config
                .as_ref()
                .and_then(|config| config.auto_continue.clone()),
            system_prompt: turn_config
                .as_ref()
                .and_then(|config| config.system_prompt.clone()),
            metadata: turn_config.and_then(|config| config.metadata),
            turn_id: request.turn_id,
            queue_if_busy: request.queue_if_busy,
            queued_turn_id: request.queued_turn_id,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeInterruptTurnRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default, alias = "turnId")]
    #[allow(dead_code)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeCompactSessionRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "eventName")]
    pub event_name: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeResumeThreadRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeReplayRequestRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "requestId")]
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeListFileCheckpointsRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeGetFileCheckpointRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "checkpointId")]
    pub checkpoint_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeDiffFileCheckpointRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "checkpointId")]
    pub checkpoint_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeRemoveQueuedTurnRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "queuedTurnId")]
    pub queued_turn_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimePromoteQueuedTurnRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "queuedTurnId")]
    pub queued_turn_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeSessionDetail {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub thread_id: String,
    pub messages: Vec<lime_agent::AgentMessage>,
    pub execution_strategy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_runtime: Option<lime_agent::SessionExecutionRuntime>,
    pub turns: Vec<lime_core::database::dao::agent_timeline::AgentThreadTurn>,
    pub items: Vec<lime_core::database::dao::agent_timeline::AgentThreadItem>,
    #[serde(default)]
    pub todo_items: Vec<lime_agent::SessionTodoItem>,
    #[serde(default)]
    pub queued_turns: Vec<QueuedTurnSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_read: Option<AgentRuntimeThreadReadModel>,
    #[serde(default)]
    pub child_subagent_sessions: Vec<lime_agent::ChildSubagentSession>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_parent_context: Option<lime_agent::SubagentParentContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeRequestView {
    pub id: String,
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub request_type: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeOutcomeView {
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub outcome_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_cause: Option<String>,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeIncidentView {
    pub id: String,
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub incident_type: String,
    pub severity: String,
    pub status: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleared_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeDiagnosticWarningSample {
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub message: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeDiagnosticContextCompactionSample {
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeDiagnosticFailedToolSample {
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeDiagnosticFailedCommandSample {
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeDiagnosticPendingRequestSample {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub request_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waited_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeCompactionBoundarySnapshot {
    pub session_id: String,
    pub summary_preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_count: Option<u32>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeFileCheckpointSummary {
    pub checkpoint_id: String,
    pub turn_id: String,
    pub path: String,
    pub source: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_no: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_path: Option<String>,
    pub validation_issue_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeFileCheckpointThreadSummary {
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_checkpoint: Option<AgentRuntimeFileCheckpointSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeFileCheckpointListResult {
    pub session_id: String,
    pub thread_id: String,
    pub checkpoint_count: usize,
    #[serde(default)]
    pub checkpoints: Vec<AgentRuntimeFileCheckpointSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeFileCheckpointDetail {
    pub session_id: String,
    pub thread_id: String,
    pub checkpoint: AgentRuntimeFileCheckpointSummary,
    pub live_path: String,
    pub snapshot_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_document: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_document: Option<serde_json::Value>,
    #[serde(default)]
    pub version_history: Vec<serde_json::Value>,
    #[serde(default)]
    pub validation_issues: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeFileCheckpointDiffResult {
    pub session_id: String,
    pub thread_id: String,
    pub checkpoint: AgentRuntimeFileCheckpointSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeThreadDiagnostics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_elapsed_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_stalled_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupt_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_interrupt_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_interrupt_requested_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_interrupt_wait_seconds: Option<i64>,
    pub warning_count: usize,
    pub context_compaction_count: usize,
    pub failed_tool_call_count: usize,
    pub failed_command_count: usize,
    pub pending_request_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_pending_request_wait_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_blocking_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_blocking_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_warning: Option<AgentRuntimeDiagnosticWarningSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_context_compaction: Option<AgentRuntimeDiagnosticContextCompactionSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_failed_tool: Option<AgentRuntimeDiagnosticFailedToolSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_failed_command: Option<AgentRuntimeDiagnosticFailedCommandSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_pending_request: Option<AgentRuntimeDiagnosticPendingRequestSample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeThreadReadModel {
    pub thread_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_id: Option<String>,
    #[serde(default)]
    pub pending_requests: Vec<AgentRuntimeRequestView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_outcome: Option<AgentRuntimeOutcomeView>,
    #[serde(default)]
    pub incidents: Vec<AgentRuntimeIncidentView>,
    #[serde(default)]
    pub queued_turns: Vec<QueuedTurnSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupt_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_compaction_boundary: Option<AgentRuntimeCompactionBoundarySnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_checkpoint_summary: Option<AgentRuntimeFileCheckpointThreadSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<AgentRuntimeThreadDiagnostics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_model_slot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_gap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_cost_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub single_candidate_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_state: Option<lime_agent::SessionExecutionRuntimeLimitState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_state: Option<lime_agent::SessionExecutionRuntimeCostState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_event: Option<lime_agent::SessionExecutionRuntimeLimitEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeReplayedActionRequiredView {
    #[serde(rename = "type")]
    pub event_type: String,
    pub request_id: String,
    pub action_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub questions: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_schema: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<AgentRuntimeActionScope>,
}

impl AgentRuntimeSessionDetail {
    pub(crate) fn from_session_detail_with_thread_read(
        detail: SessionDetail,
        queued_turns: Vec<QueuedTurnSnapshot>,
        thread_read: AgentRuntimeThreadReadModel,
    ) -> Self {
        Self {
            id: detail.id,
            name: detail.name,
            created_at: detail.created_at,
            updated_at: detail.updated_at,
            thread_id: detail.thread_id,
            messages: detail.messages,
            execution_strategy: detail.execution_strategy,
            execution_runtime: detail.execution_runtime,
            turns: detail.turns,
            items: detail.items,
            todo_items: detail.todo_items,
            queued_turns,
            thread_read: Some(thread_read),
            child_subagent_sessions: detail.child_subagent_sessions,
            subagent_parent_context: detail.subagent_parent_context,
        }
    }
}

impl AgentRuntimeReplayedActionRequiredView {
    pub(crate) fn from_session_detail(detail: &SessionDetail, request_id: &str) -> Option<Self> {
        let trimmed_request_id = request_id.trim();
        if trimmed_request_id.is_empty() {
            return None;
        }

        detail.items.iter().rev().find_map(|item| {
            if !matches!(
                item.status,
                lime_core::database::dao::agent_timeline::AgentThreadItemStatus::InProgress
            ) {
                return None;
            }

            let scope = Some(AgentRuntimeActionScope {
                session_id: Some(detail.id.clone()),
                thread_id: Some(item.thread_id.clone()),
                turn_id: Some(item.turn_id.clone()),
            });

            match &item.payload {
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::ApprovalRequest {
                    request_id,
                    action_type,
                    prompt,
                    tool_name,
                    arguments,
                    ..
                } if request_id == trimmed_request_id => Some(Self {
                    event_type: "action_required".to_string(),
                    request_id: request_id.clone(),
                    action_type: action_type.clone(),
                    tool_name: tool_name.clone(),
                    arguments: arguments.clone(),
                    prompt: prompt.clone(),
                    questions: None,
                    requested_schema: None,
                    scope,
                }),
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::RequestUserInput {
                    request_id,
                    action_type,
                    prompt,
                    questions,
                    ..
                } if request_id == trimmed_request_id => Some(Self {
                    event_type: "action_required".to_string(),
                    request_id: request_id.clone(),
                    action_type: action_type.clone(),
                    tool_name: None,
                    arguments: None,
                    prompt: prompt.clone(),
                    questions: questions
                        .as_ref()
                        .and_then(|value| serde_json::to_value(value).ok()),
                    requested_schema: None,
                    scope,
                }),
                _ => None,
            }
        })
    }
}

impl AgentRuntimeThreadReadModel {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn from_session_detail(
        detail: &SessionDetail,
        queued_turns: &[QueuedTurnSnapshot],
    ) -> Self {
        let pending_requests = build_pending_requests(detail);
        let last_outcome = build_last_outcome(detail);
        let incidents = build_incidents(detail, &pending_requests);
        Self::from_parts(
            detail,
            queued_turns,
            pending_requests,
            last_outcome,
            incidents,
            None,
        )
    }

    pub(crate) fn from_parts(
        detail: &SessionDetail,
        queued_turns: &[QueuedTurnSnapshot],
        pending_requests: Vec<AgentRuntimeRequestView>,
        last_outcome: Option<AgentRuntimeOutcomeView>,
        incidents: Vec<AgentRuntimeIncidentView>,
        runtime_interrupt_marker: Option<&lime_agent::RuntimeInterruptMarker>,
    ) -> Self {
        let latest_turn = detail.turns.last();
        let diagnostics = build_thread_diagnostics(
            detail,
            latest_turn,
            queued_turns,
            &pending_requests,
            last_outcome.as_ref(),
            &incidents,
            runtime_interrupt_marker,
        );
        let latest_compaction_boundary = build_latest_compaction_boundary_snapshot(
            &detail.id,
            diagnostics
                .as_ref()
                .and_then(|value| value.latest_context_compaction.as_ref()),
        );
        let file_checkpoint_summary =
            runtime_file_checkpoint_service::build_thread_file_checkpoint_summary(detail);
        let active_turn = detail
            .turns
            .iter()
            .rev()
            .find(|turn| {
                matches!(
                    turn.status,
                    lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Running
                )
            })
            .or(latest_turn);
        let active_turn_running = active_turn
            .map(|turn| {
                matches!(
                    turn.status,
                    lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Running
                )
            })
            .unwrap_or(false);
        let interrupting = runtime_interrupt_marker.is_some() && active_turn_running;
        let status = if interrupting {
            "interrupting".to_string()
        } else if !pending_requests.is_empty() {
            "waiting_request".to_string()
        } else if active_turn_running {
            "running".to_string()
        } else if let Some(turn) = latest_turn {
            turn.status.as_str().to_string()
        } else if !queued_turns.is_empty() {
            "queued".to_string()
        } else {
            "idle".to_string()
        };
        let interrupt_state = latest_turn.and_then(|turn| {
            if matches!(
                turn.status,
                lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Aborted
            ) {
                Some("interrupted".to_string())
            } else {
                None
            }
        });
        let interrupt_state = interrupt_state.or_else(|| {
            if interrupting {
                Some("interrupting".to_string())
            } else {
                None
            }
        });
        let task_profile = detail
            .execution_runtime
            .as_ref()
            .and_then(|runtime| runtime.task_profile.as_ref());
        let routing_decision = detail
            .execution_runtime
            .as_ref()
            .and_then(|runtime| runtime.routing_decision.as_ref());
        let limit_state = detail
            .execution_runtime
            .as_ref()
            .and_then(|runtime| runtime.limit_state.clone());
        let cost_state = detail
            .execution_runtime
            .as_ref()
            .and_then(|runtime| runtime.cost_state.clone());
        let limit_event = detail
            .execution_runtime
            .as_ref()
            .and_then(|runtime| runtime.limit_event.clone());

        Self {
            thread_id: detail.thread_id.clone(),
            status,
            active_turn_id: active_turn.map(|turn| turn.id.clone()),
            pending_requests,
            last_outcome,
            incidents,
            queued_turns: queued_turns.to_vec(),
            interrupt_state,
            updated_at: latest_turn
                .map(|turn| turn.updated_at.clone())
                .or_else(|| Some(detail.updated_at.to_string())),
            latest_compaction_boundary,
            file_checkpoint_summary,
            diagnostics,
            task_kind: task_profile.map(|profile| profile.kind.clone()),
            service_model_slot: task_profile.and_then(|profile| profile.service_model_slot.clone()),
            routing_mode: routing_decision.map(|decision| decision.routing_mode.clone()),
            decision_source: routing_decision.map(|decision| decision.decision_source.clone()),
            candidate_count: routing_decision.map(|decision| decision.candidate_count),
            capability_gap: routing_decision
                .and_then(|decision| decision.capability_gap.clone())
                .or_else(|| {
                    limit_state
                        .as_ref()
                        .and_then(|state| state.capability_gap.clone())
                }),
            estimated_cost_class: routing_decision
                .and_then(|decision| decision.estimated_cost_class.clone())
                .or_else(|| {
                    cost_state
                        .as_ref()
                        .and_then(|state| state.estimated_cost_class.clone())
                }),
            single_candidate_only: limit_state
                .as_ref()
                .map(|state| state.single_candidate_only),
            limit_state,
            cost_state,
            limit_event,
        }
    }
}

const APPROVAL_TIMEOUT_SECONDS: i64 = 180;
const USER_INPUT_TIMEOUT_SECONDS: i64 = 300;
const TURN_STUCK_TIMEOUT_SECONDS: i64 = 180;

fn parse_rfc3339_utc(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn elapsed_seconds_since(raw: Option<&str>, now: &DateTime<Utc>) -> Option<i64> {
    let parsed = parse_rfc3339_utc(raw?)?;
    Some(now.signed_duration_since(parsed).num_seconds().max(0))
}

fn elapsed_seconds_between(start_raw: Option<&str>, end_raw: Option<&str>) -> Option<i64> {
    let start = parse_rfc3339_utc(start_raw?)?;
    let end = parse_rfc3339_utc(end_raw?)?;
    Some(end.signed_duration_since(start).num_seconds().max(0))
}

fn compact_summary_preview(input: &str, max_chars: usize) -> String {
    let normalized = input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    let mut chars = normalized.chars();
    let prefix: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        prefix
    }
}

fn build_latest_compaction_boundary_snapshot(
    session_id: &str,
    latest_context_compaction: Option<&AgentRuntimeDiagnosticContextCompactionSample>,
) -> Option<AgentRuntimeCompactionBoundarySnapshot> {
    let summary = aster::session::load_summary_data(session_id)?;
    Some(AgentRuntimeCompactionBoundarySnapshot {
        session_id: session_id.to_string(),
        summary_preview: compact_summary_preview(&summary.summary, 220),
        turn_count: summary.turn_count.map(|value| value as u32),
        created_at: summary.timestamp.to_rfc3339(),
        trigger: latest_context_compaction.and_then(|sample| sample.trigger.clone()),
        detail: latest_context_compaction.and_then(|sample| sample.detail.clone()),
    })
}

fn warning_sample_from_item(
    item: &lime_core::database::dao::agent_timeline::AgentThreadItem,
) -> Option<AgentRuntimeDiagnosticWarningSample> {
    match &item.payload {
        lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Warning {
            message,
            code,
        } => Some(AgentRuntimeDiagnosticWarningSample {
            item_id: item.id.clone(),
            turn_id: Some(item.turn_id.clone()),
            code: code.clone(),
            message: message.clone(),
            updated_at: item.updated_at.clone(),
        }),
        _ => None,
    }
}

fn context_compaction_sample_from_item(
    item: &lime_core::database::dao::agent_timeline::AgentThreadItem,
) -> Option<AgentRuntimeDiagnosticContextCompactionSample> {
    match &item.payload {
        lime_core::database::dao::agent_timeline::AgentThreadItemPayload::ContextCompaction {
            stage,
            trigger,
            detail,
        } => Some(AgentRuntimeDiagnosticContextCompactionSample {
            item_id: item.id.clone(),
            turn_id: Some(item.turn_id.clone()),
            stage: stage.clone(),
            trigger: trigger.clone(),
            detail: detail.clone(),
            updated_at: item.updated_at.clone(),
        }),
        _ => None,
    }
}

fn failed_tool_sample_from_item(
    item: &lime_core::database::dao::agent_timeline::AgentThreadItem,
) -> Option<AgentRuntimeDiagnosticFailedToolSample> {
    match &item.payload {
        lime_core::database::dao::agent_timeline::AgentThreadItemPayload::ToolCall {
            tool_name,
            error,
            success,
            ..
        } if matches!(
            item.status,
            lime_core::database::dao::agent_timeline::AgentThreadItemStatus::Failed
        ) || success == &Some(false) =>
        {
            Some(AgentRuntimeDiagnosticFailedToolSample {
                item_id: item.id.clone(),
                turn_id: Some(item.turn_id.clone()),
                tool_name: tool_name.clone(),
                error: error.clone(),
                updated_at: item.updated_at.clone(),
            })
        }
        _ => None,
    }
}

fn failed_command_sample_from_item(
    item: &lime_core::database::dao::agent_timeline::AgentThreadItem,
) -> Option<AgentRuntimeDiagnosticFailedCommandSample> {
    match &item.payload {
        lime_core::database::dao::agent_timeline::AgentThreadItemPayload::CommandExecution {
            command,
            exit_code,
            error,
            ..
        } if matches!(
            item.status,
            lime_core::database::dao::agent_timeline::AgentThreadItemStatus::Failed
        ) || exit_code.unwrap_or(0) != 0
            || error.as_ref().is_some() =>
        {
            Some(AgentRuntimeDiagnosticFailedCommandSample {
                item_id: item.id.clone(),
                turn_id: Some(item.turn_id.clone()),
                command: command.clone(),
                exit_code: *exit_code,
                error: error.clone(),
                updated_at: item.updated_at.clone(),
            })
        }
        _ => None,
    }
}

fn pending_request_sample_from_view(
    request: &AgentRuntimeRequestView,
    now: &DateTime<Utc>,
) -> AgentRuntimeDiagnosticPendingRequestSample {
    AgentRuntimeDiagnosticPendingRequestSample {
        request_id: request.id.clone(),
        turn_id: request.turn_id.clone(),
        request_type: request.request_type.clone(),
        title: request.title.clone(),
        waited_seconds: elapsed_seconds_since(request.created_at.as_deref(), now),
        created_at: request.created_at.clone(),
    }
}

fn build_thread_diagnostics(
    detail: &SessionDetail,
    latest_turn: Option<&lime_core::database::dao::agent_timeline::AgentThreadTurn>,
    queued_turns: &[QueuedTurnSnapshot],
    pending_requests: &[AgentRuntimeRequestView],
    last_outcome: Option<&AgentRuntimeOutcomeView>,
    incidents: &[AgentRuntimeIncidentView],
    runtime_interrupt_marker: Option<&lime_agent::RuntimeInterruptMarker>,
) -> Option<AgentRuntimeThreadDiagnostics> {
    let warning_count = detail
        .items
        .iter()
        .filter(|item| warning_sample_from_item(item).is_some())
        .count();
    let context_compaction_count = detail
        .items
        .iter()
        .filter(|item| context_compaction_sample_from_item(item).is_some())
        .count();
    let failed_tool_call_count = detail
        .items
        .iter()
        .filter(|item| failed_tool_sample_from_item(item).is_some())
        .count();
    let failed_command_count = detail
        .items
        .iter()
        .filter(|item| failed_command_sample_from_item(item).is_some())
        .count();

    let latest_warning = detail.items.iter().rev().find_map(warning_sample_from_item);
    let latest_context_compaction = detail
        .items
        .iter()
        .rev()
        .find_map(context_compaction_sample_from_item);
    let latest_failed_tool = detail
        .items
        .iter()
        .rev()
        .find_map(failed_tool_sample_from_item);
    let latest_failed_command = detail
        .items
        .iter()
        .rev()
        .find_map(failed_command_sample_from_item);

    if latest_turn.is_none()
        && warning_count == 0
        && context_compaction_count == 0
        && failed_tool_call_count == 0
        && failed_command_count == 0
        && pending_requests.is_empty()
        && queued_turns.is_empty()
    {
        return None;
    }

    let now = Utc::now();
    let latest_pending_request = pending_requests
        .first()
        .map(|request| pending_request_sample_from_view(request, &now));
    let oldest_pending_request_wait_seconds = pending_requests
        .iter()
        .filter_map(|request| elapsed_seconds_since(request.created_at.as_deref(), &now))
        .max();
    let latest_turn_status = latest_turn.map(|turn| turn.status.as_str().to_string());
    let latest_turn_started_at = latest_turn.map(|turn| turn.started_at.clone());
    let latest_turn_completed_at = latest_turn.and_then(|turn| turn.completed_at.clone());
    let latest_turn_updated_at = latest_turn.map(|turn| turn.updated_at.clone());
    let latest_turn_elapsed_seconds = latest_turn.and_then(|turn| {
        if turn.completed_at.is_some() {
            elapsed_seconds_between(Some(turn.started_at.as_str()), turn.completed_at.as_deref())
        } else {
            elapsed_seconds_since(Some(turn.started_at.as_str()), &now)
        }
    });
    let latest_turn_stalled_seconds = latest_turn.and_then(|turn| {
        if matches!(
            turn.status,
            lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Running
        ) {
            elapsed_seconds_since(Some(turn.updated_at.as_str()), &now)
        } else {
            None
        }
    });
    let latest_turn_error_message = latest_turn.and_then(|turn| turn.error_message.clone());
    let runtime_interrupt_source = runtime_interrupt_marker.map(|marker| marker.source.clone());
    let runtime_interrupt_requested_at =
        runtime_interrupt_marker.map(|marker| marker.requested_at.clone());
    let runtime_interrupt_wait_seconds = runtime_interrupt_marker
        .and_then(|marker| elapsed_seconds_since(Some(marker.requested_at.as_str()), &now));
    let interrupt_reason = latest_turn.and_then(|turn| {
        if matches!(
            turn.status,
            lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Aborted
        ) {
            runtime_interrupt_marker
                .map(|marker| marker.reason.clone())
                .or_else(|| turn.error_message.clone())
                .or_else(|| {
                    latest_warning
                        .as_ref()
                        .map(|sample| sample.message.clone())
                        .filter(|message| !message.trim().is_empty())
                })
        } else {
            runtime_interrupt_marker.map(|marker| marker.reason.clone())
        }
    });
    let latest_turn_running = latest_turn
        .map(|turn| {
            matches!(
                turn.status,
                lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Running
            )
        })
        .unwrap_or(false);
    let latest_turn_aborted = latest_turn
        .map(|turn| {
            matches!(
                turn.status,
                lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Aborted
            )
        })
        .unwrap_or(false);
    let primary_blocking_kind = if runtime_interrupt_marker.is_some() && latest_turn_running {
        Some("interrupting".to_string())
    } else if let Some(request) = pending_requests.first() {
        if is_tool_confirmation_request(&request.request_type) {
            Some("waiting_approval".to_string())
        } else if is_user_input_request(&request.request_type) {
            Some("waiting_user_input".to_string())
        } else {
            Some("waiting_request".to_string())
        }
    } else if latest_turn_aborted {
        Some("interrupted".to_string())
    } else if let Some(incident) = incidents.first() {
        match incident.incident_type.as_str() {
            "turn_stuck" => Some("turn_stuck".to_string()),
            "approval_timeout" => Some("approval_timeout".to_string()),
            "user_input_timeout" => Some("user_input_timeout".to_string()),
            "tool_failed" => Some("tool_failed".to_string()),
            "provider_error" => Some("provider_error".to_string()),
            "runtime_warning" => Some("runtime_warning".to_string()),
            "runtime_error" => Some("runtime_error".to_string()),
            other => Some(other.to_string()),
        }
    } else if let Some(outcome) = last_outcome {
        match outcome.outcome_type.as_str() {
            "interrupted" => Some("interrupted".to_string()),
            "failed_tool" => Some("failed_tool".to_string()),
            "failed_provider" => Some("failed_provider".to_string()),
            "failed_model" => Some("failed_model".to_string()),
            other => Some(other.to_string()),
        }
    } else if latest_failed_command.is_some() {
        Some("failed_command".to_string())
    } else if latest_context_compaction.is_some() || latest_warning.is_some() {
        Some("context_risk".to_string())
    } else if !queued_turns.is_empty() {
        Some("queued_wait".to_string())
    } else {
        None
    };
    let primary_blocking_summary = if runtime_interrupt_marker.is_some() && latest_turn_running {
        runtime_interrupt_marker.map(|marker| marker.reason.clone())
    } else if let Some(request) = pending_requests.first() {
        request.title.clone().or_else(|| {
            Some(format!(
                "线程正在等待{}",
                if is_tool_confirmation_request(&request.request_type) {
                    "工具确认"
                } else if is_user_input_request(&request.request_type) {
                    "人工输入"
                } else {
                    "外部请求响应"
                }
            ))
        })
    } else if latest_turn_aborted {
        last_outcome
            .and_then(|outcome| {
                outcome
                    .summary
                    .clone()
                    .or_else(|| outcome.primary_cause.clone())
            })
            .or_else(|| Some("最近一次回合已被中断".to_string()))
    } else if let Some(incident) = incidents.first() {
        incident
            .details
            .as_ref()
            .map(|value| match value {
                serde_json::Value::String(text) => text.clone(),
                other => other.to_string(),
            })
            .or_else(|| Some(incident.title.clone()))
    } else if let Some(outcome) = last_outcome {
        outcome
            .summary
            .clone()
            .or_else(|| outcome.primary_cause.clone())
    } else if let Some(sample) = latest_failed_command.as_ref() {
        sample
            .error
            .clone()
            .or_else(|| Some(format!("命令执行失败：{}", sample.command)))
    } else if let Some(sample) = latest_warning.as_ref() {
        Some(sample.message.clone())
    } else if !queued_turns.is_empty() {
        Some("当前没有活跃回合，线程里仍有排队任务等待执行".to_string())
    } else {
        None
    };

    Some(AgentRuntimeThreadDiagnostics {
        latest_turn_status,
        latest_turn_started_at,
        latest_turn_completed_at,
        latest_turn_updated_at,
        latest_turn_elapsed_seconds,
        latest_turn_stalled_seconds,
        latest_turn_error_message,
        interrupt_reason,
        runtime_interrupt_source,
        runtime_interrupt_requested_at,
        runtime_interrupt_wait_seconds,
        warning_count,
        context_compaction_count,
        failed_tool_call_count,
        failed_command_count,
        pending_request_count: pending_requests.len(),
        oldest_pending_request_wait_seconds,
        primary_blocking_kind,
        primary_blocking_summary,
        latest_warning,
        latest_context_compaction,
        latest_failed_tool,
        latest_failed_command,
        latest_pending_request,
    })
}

fn is_tool_confirmation_request(request_type: &str) -> bool {
    let normalized = request_type.to_ascii_lowercase();
    normalized.contains("tool") || normalized.contains("approval")
}

fn is_user_input_request(request_type: &str) -> bool {
    let normalized = request_type.to_ascii_lowercase();
    normalized.contains("ask") || normalized.contains("user") || normalized.contains("elicitation")
}

fn request_timeout_threshold_seconds(request: &AgentRuntimeRequestView) -> Option<i64> {
    if is_tool_confirmation_request(&request.request_type) {
        return Some(APPROVAL_TIMEOUT_SECONDS);
    }
    if is_user_input_request(&request.request_type) {
        return Some(USER_INPUT_TIMEOUT_SECONDS);
    }
    None
}

fn build_pending_request_incident(
    request: &AgentRuntimeRequestView,
    now: &DateTime<Utc>,
) -> AgentRuntimeIncidentView {
    let waited_seconds = elapsed_seconds_since(request.created_at.as_deref(), now).unwrap_or(0);
    let timeout_seconds =
        request_timeout_threshold_seconds(request).unwrap_or(USER_INPUT_TIMEOUT_SECONDS);
    let waited_minutes = ((waited_seconds + 59) / 60).max(1);
    let request_title = request
        .title
        .clone()
        .unwrap_or_else(|| "线程正在等待人工处理".to_string());

    let (incident_type, severity, title, details) =
        if is_tool_confirmation_request(&request.request_type) {
            if waited_seconds >= timeout_seconds {
                (
                    "approval_timeout".to_string(),
                    "high".to_string(),
                    "审批等待超过阈值".to_string(),
                    Some(serde_json::Value::String(format!(
                        "工具确认已等待 {waited_minutes} 分钟：{request_title}"
                    ))),
                )
            } else {
                (
                    "waiting_approval".to_string(),
                    "medium".to_string(),
                    "线程正在等待工具确认".to_string(),
                    Some(serde_json::Value::String(request_title)),
                )
            }
        } else if waited_seconds >= timeout_seconds {
            (
                "user_input_timeout".to_string(),
                "high".to_string(),
                "人工输入等待超过阈值".to_string(),
                Some(serde_json::Value::String(format!(
                    "人工输入已等待 {waited_minutes} 分钟：{request_title}"
                ))),
            )
        } else {
            (
                "waiting_user_input".to_string(),
                "medium".to_string(),
                "线程正在等待人工输入".to_string(),
                Some(serde_json::Value::String(request_title)),
            )
        };

    AgentRuntimeIncidentView {
        id: format!("incident-{}", request.id),
        thread_id: request.thread_id.clone(),
        turn_id: request.turn_id.clone(),
        item_id: request.item_id.clone(),
        incident_type,
        severity,
        status: "active".to_string(),
        title,
        details,
        detected_at: request.created_at.clone(),
        cleared_at: None,
    }
}

pub(crate) fn build_pending_requests(detail: &SessionDetail) -> Vec<AgentRuntimeRequestView> {
    detail
        .items
        .iter()
        .filter_map(|item| match &item.payload {
            lime_core::database::dao::agent_timeline::AgentThreadItemPayload::ApprovalRequest {
                request_id,
                action_type,
                prompt,
                tool_name,
                arguments,
                response,
            } if matches!(
                item.status,
                lime_core::database::dao::agent_timeline::AgentThreadItemStatus::InProgress
            ) =>
            {
                Some(AgentRuntimeRequestView {
                    id: request_id.clone(),
                    thread_id: item.thread_id.clone(),
                    turn_id: Some(item.turn_id.clone()),
                    item_id: Some(item.id.clone()),
                    request_type: action_type.clone(),
                    status: "pending".to_string(),
                    title: prompt
                        .clone()
                        .or_else(|| tool_name.as_ref().map(|value| format!("等待确认工具：{value}"))),
                    payload: arguments.clone(),
                    decision: response.clone(),
                    scope: Some(serde_json::json!({
                        "thread_id": item.thread_id,
                        "turn_id": item.turn_id,
                        "item_id": item.id,
                    })),
                    created_at: Some(item.started_at.clone()),
                    resolved_at: None,
                })
            }
            lime_core::database::dao::agent_timeline::AgentThreadItemPayload::RequestUserInput {
                request_id,
                action_type,
                prompt,
                questions,
                response,
            } if matches!(
                item.status,
                lime_core::database::dao::agent_timeline::AgentThreadItemStatus::InProgress
            ) =>
            {
                Some(AgentRuntimeRequestView {
                    id: request_id.clone(),
                    thread_id: item.thread_id.clone(),
                    turn_id: Some(item.turn_id.clone()),
                    item_id: Some(item.id.clone()),
                    request_type: action_type.clone(),
                    status: "pending".to_string(),
                    title: prompt.clone().or_else(|| {
                        questions
                            .as_ref()
                            .and_then(|items| items.first())
                            .map(|question| question.question.clone())
                    }),
                    payload: questions
                        .as_ref()
                        .and_then(|value| serde_json::to_value(value).ok()),
                    decision: response.clone(),
                    scope: Some(serde_json::json!({
                        "thread_id": item.thread_id,
                        "turn_id": item.turn_id,
                        "item_id": item.id,
                    })),
                    created_at: Some(item.started_at.clone()),
                    resolved_at: None,
                })
            }
            _ => None,
        })
        .collect()
}

pub(crate) fn build_last_outcome(detail: &SessionDetail) -> Option<AgentRuntimeOutcomeView> {
    let latest_turn = detail.turns.last()?;
    let latest_turn_summary = detail
        .items
        .iter()
        .rev()
        .find_map(|item| match &item.payload {
            lime_core::database::dao::agent_timeline::AgentThreadItemPayload::TurnSummary {
                text,
            } if item.turn_id == latest_turn.id => Some(text.clone()),
            _ => None,
        });
    let latest_failed_item = detail.items.iter().rev().find(|item| {
        item.turn_id == latest_turn.id
            && matches!(
                item.status,
                lime_core::database::dao::agent_timeline::AgentThreadItemStatus::Failed
            )
    });

    match latest_turn.status {
        lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Completed => {
            Some(AgentRuntimeOutcomeView {
                thread_id: latest_turn.thread_id.clone(),
                turn_id: Some(latest_turn.id.clone()),
                outcome_type: "completed".to_string(),
                summary: latest_turn_summary.or_else(|| Some("最近一次回合已稳定完成".to_string())),
                primary_cause: None,
                retryable: false,
                ended_at: latest_turn.completed_at.clone(),
            })
        }
        lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Aborted => {
            Some(AgentRuntimeOutcomeView {
                thread_id: latest_turn.thread_id.clone(),
                turn_id: Some(latest_turn.id.clone()),
                outcome_type: "interrupted".to_string(),
                summary: Some("最近一次回合已被中断".to_string()),
                primary_cause: None,
                retryable: true,
                ended_at: latest_turn.completed_at.clone(),
            })
        }
        lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Failed => {
            let (outcome_type, primary_cause) =
                classify_failed_turn(latest_turn, latest_failed_item);
            Some(AgentRuntimeOutcomeView {
                thread_id: latest_turn.thread_id.clone(),
                turn_id: Some(latest_turn.id.clone()),
                outcome_type,
                summary: latest_turn
                    .error_message
                    .clone()
                    .or_else(|| primary_cause.clone())
                    .or_else(|| Some("最近一次回合执行失败".to_string())),
                primary_cause,
                retryable: true,
                ended_at: latest_turn.completed_at.clone(),
            })
        }
        lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Running => None,
    }
}

fn classify_failed_turn(
    turn: &lime_core::database::dao::agent_timeline::AgentThreadTurn,
    failed_item: Option<&lime_core::database::dao::agent_timeline::AgentThreadItem>,
) -> (String, Option<String>) {
    if let Some(item) = failed_item {
        match &item.payload {
            lime_core::database::dao::agent_timeline::AgentThreadItemPayload::ToolCall {
                error, ..
            }
            | lime_core::database::dao::agent_timeline::AgentThreadItemPayload::CommandExecution {
                error, ..
            } => {
                return (
                    "failed_tool".to_string(),
                    error.clone().or_else(|| turn.error_message.clone()),
                );
            }
            lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Error { message } => {
                return ("failed_tool".to_string(), Some(message.clone()));
            }
            _ => {}
        }
    }

    let lowered_error = turn
        .error_message
        .as_deref()
        .map(|value| value.to_lowercase())
        .unwrap_or_default();
    if lowered_error.contains("provider")
        || lowered_error.contains("rate limit")
        || lowered_error.contains("authentication")
        || lowered_error.contains("network")
        || lowered_error.contains("api")
    {
        return ("failed_provider".to_string(), turn.error_message.clone());
    }

    ("failed_model".to_string(), turn.error_message.clone())
}

pub(crate) fn build_incidents(
    detail: &SessionDetail,
    pending_requests: &[AgentRuntimeRequestView],
) -> Vec<AgentRuntimeIncidentView> {
    let now = Utc::now();

    if let Some(request) = pending_requests.first() {
        return vec![build_pending_request_incident(request, &now)];
    }

    let latest_turn = match detail.turns.last() {
        Some(value) => value,
        None => return Vec::new(),
    };

    if matches!(
        latest_turn.status,
        lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Failed
    ) {
        let latest_failed_item = detail.items.iter().rev().find(|item| {
            item.turn_id == latest_turn.id
                && matches!(
                    item.status,
                    lime_core::database::dao::agent_timeline::AgentThreadItemStatus::Failed
                )
        });
        let (outcome_type, primary_cause) = classify_failed_turn(latest_turn, latest_failed_item);
        let (incident_type, title) = match outcome_type.as_str() {
            "failed_tool" => ("tool_failed".to_string(), "工具执行失败".to_string()),
            "failed_provider" => (
                "provider_error".to_string(),
                "Provider 请求失败".to_string(),
            ),
            _ => (
                "turn_failed".to_string(),
                "最近一次回合执行失败".to_string(),
            ),
        };

        return vec![AgentRuntimeIncidentView {
            id: format!("incident-turn-failed-{}", latest_turn.id),
            thread_id: latest_turn.thread_id.clone(),
            turn_id: Some(latest_turn.id.clone()),
            item_id: latest_failed_item.map(|item| item.id.clone()),
            incident_type,
            severity: "high".to_string(),
            status: "active".to_string(),
            title,
            details: primary_cause.map(serde_json::Value::String),
            detected_at: Some(latest_turn.updated_at.clone()),
            cleared_at: None,
        }];
    }

    if matches!(
        latest_turn.status,
        lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Running
    ) && elapsed_seconds_since(Some(latest_turn.updated_at.as_str()), &now)
        .map(|value| value >= TURN_STUCK_TIMEOUT_SECONDS)
        .unwrap_or(false)
    {
        let waited_seconds =
            elapsed_seconds_since(Some(latest_turn.updated_at.as_str()), &now).unwrap_or(0);
        let waited_minutes = ((waited_seconds + 59) / 60).max(1);
        let prompt_preview = latest_turn.prompt_text.trim();
        let details = if prompt_preview.is_empty() {
            format!("最近 {waited_minutes} 分钟内没有新的线程更新，可尝试停止后恢复执行。")
        } else {
            format!(
                "回合“{prompt_preview}”最近 {waited_minutes} 分钟内没有新的线程更新，可尝试停止后恢复执行。"
            )
        };

        return vec![AgentRuntimeIncidentView {
            id: format!("incident-turn-stuck-{}", latest_turn.id),
            thread_id: latest_turn.thread_id.clone(),
            turn_id: Some(latest_turn.id.clone()),
            item_id: None,
            incident_type: "turn_stuck".to_string(),
            severity: "high".to_string(),
            status: "active".to_string(),
            title: "当前回合长时间无进展".to_string(),
            details: Some(serde_json::Value::String(details)),
            detected_at: Some(latest_turn.updated_at.clone()),
            cleared_at: None,
        }];
    }

    let latest_issue_item = detail.items.iter().rev().find(|item| match &item.payload {
        lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Warning { .. }
        | lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Error { .. } => true,
        _ => false,
    });

    match latest_issue_item {
        Some(item) => {
            let (incident_type, title, details, severity) = match &item.payload {
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Warning {
                    message,
                    code,
                } => (
                    "runtime_warning".to_string(),
                    "时间线记录到警告项".to_string(),
                    Some(serde_json::json!({ "message": message, "code": code })),
                    "medium".to_string(),
                ),
                lime_core::database::dao::agent_timeline::AgentThreadItemPayload::Error {
                    message,
                } => (
                    "runtime_error".to_string(),
                    "时间线记录到异常项".to_string(),
                    Some(serde_json::json!({ "message": message })),
                    "high".to_string(),
                ),
                _ => unreachable!(),
            };
            vec![AgentRuntimeIncidentView {
                id: format!("incident-item-{}", item.id),
                thread_id: item.thread_id.clone(),
                turn_id: Some(item.turn_id.clone()),
                item_id: Some(item.id.clone()),
                incident_type,
                severity,
                status: "active".to_string(),
                title,
                details,
                detected_at: Some(item.updated_at.clone()),
                cleared_at: None,
            }]
        }
        None => Vec::new(),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRuntimeSpawnSubagentRequest {
    #[serde(alias = "parentSessionId")]
    pub parent_session_id: String,
    pub message: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, alias = "teamName")]
    pub team_name: Option<String>,
    #[serde(default, alias = "agentType")]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, alias = "runInBackground")]
    pub run_in_background: bool,
    #[serde(default, alias = "reasoningEffort")]
    pub reasoning_effort: Option<String>,
    #[serde(default, alias = "forkContext")]
    pub fork_context: bool,
    #[serde(default, alias = "blueprintRoleId")]
    pub blueprint_role_id: Option<String>,
    #[serde(default, alias = "blueprintRoleLabel")]
    pub blueprint_role_label: Option<String>,
    #[serde(default, alias = "profileId")]
    pub profile_id: Option<String>,
    #[serde(default, alias = "profileName")]
    pub profile_name: Option<String>,
    #[serde(default, alias = "roleKey")]
    pub role_key: Option<String>,
    #[serde(default, alias = "skillIds")]
    pub skill_ids: Vec<String>,
    #[serde(default, alias = "skillDirectories")]
    pub skill_directories: Vec<String>,
    #[serde(default, alias = "teamPresetId")]
    pub team_preset_id: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default, alias = "systemOverlay")]
    pub system_overlay: Option<String>,
    #[serde(default, alias = "outputContract")]
    pub output_contract: Option<String>,
    #[serde(default)]
    pub hooks: Option<aster::hooks::FrontmatterHooks>,
    #[serde(default, alias = "allowedTools")]
    pub allowed_tools: Vec<String>,
    #[serde(default, alias = "disallowedTools")]
    pub disallowed_tools: Vec<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub isolation: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeSpawnSubagentResponse {
    #[serde(alias = "agentId")]
    pub agent_id: String,
    #[serde(default)]
    pub nickname: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRuntimeSendSubagentInputRequest {
    pub id: String,
    pub message: String,
    #[serde(default)]
    pub interrupt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeSendSubagentInputResponse {
    #[serde(alias = "submissionId")]
    pub submission_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRuntimeWaitSubagentsRequest {
    pub ids: Vec<String>,
    #[serde(default, alias = "timeoutMs")]
    pub timeout_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeWaitSubagentsResponse {
    pub status: HashMap<String, SubagentRuntimeStatus>,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRuntimeResumeSubagentRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeResumeSubagentResponse {
    pub status: SubagentRuntimeStatus,
    pub cascade_session_ids: Vec<String>,
    pub changed_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRuntimeCloseSubagentRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeCloseSubagentResponse {
    pub previous_status: SubagentRuntimeStatus,
    pub cascade_session_ids: Vec<String>,
    pub changed_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeActionType {
    ToolConfirmation,
    AskUser,
    Elicitation,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRuntimeActionScope {
    #[serde(default, alias = "sessionId")]
    pub session_id: Option<String>,
    #[serde(default, alias = "threadId")]
    pub thread_id: Option<String>,
    #[serde(default, alias = "turnId")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeRespondActionRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "requestId")]
    pub request_id: String,
    #[serde(alias = "actionType")]
    pub action_type: AgentRuntimeActionType,
    pub confirmed: bool,
    #[serde(default)]
    pub response: Option<String>,
    #[serde(default, alias = "userData")]
    pub user_data: Option<serde_json::Value>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default, alias = "eventName")]
    pub event_name: Option<String>,
    #[serde(default, alias = "actionScope")]
    pub action_scope: Option<AgentRuntimeActionScope>,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeUpdateSessionRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, alias = "providerSelector")]
    pub provider_selector: Option<String>,
    #[serde(default, alias = "providerName")]
    pub provider_name: Option<String>,
    #[serde(default, alias = "modelName")]
    pub model_name: Option<String>,
    #[serde(default, alias = "executionStrategy")]
    pub execution_strategy: Option<AsterExecutionStrategy>,
    #[serde(default, alias = "recentAccessMode")]
    pub recent_access_mode: Option<lime_agent::SessionExecutionRuntimeAccessMode>,
    #[serde(default, alias = "recentPreferences")]
    pub recent_preferences: Option<lime_agent::SessionExecutionRuntimePreferences>,
    #[serde(default, alias = "recentTeamSelection")]
    pub recent_team_selection: Option<lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeSaveReviewDecisionRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default, alias = "decisionStatus")]
    pub decision_status: String,
    #[serde(default, alias = "decisionSummary")]
    pub decision_summary: String,
    #[serde(default, alias = "chosenFixStrategy")]
    pub chosen_fix_strategy: String,
    #[serde(default, alias = "riskLevel")]
    pub risk_level: String,
    #[serde(default, alias = "riskTags")]
    pub risk_tags: Vec<String>,
    #[serde(default, alias = "humanReviewer")]
    pub human_reviewer: String,
    #[serde(default, alias = "reviewedAt")]
    pub reviewed_at: Option<String>,
    #[serde(default, alias = "followupActions")]
    pub followup_actions: Vec<String>,
    #[serde(default, alias = "regressionRequirements")]
    pub regression_requirements: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

/// 自动续写参数
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutoContinuePayload {
    /// 主开关
    pub enabled: bool,
    /// 快速模式
    #[serde(default, alias = "fastModeEnabled")]
    pub fast_mode_enabled: bool,
    /// 续写长度：0=短、1=中、2=长
    #[serde(default, alias = "continuationLength")]
    pub continuation_length: u8,
    /// 灵敏度：0-100
    #[serde(default)]
    pub sensitivity: u8,
    /// 来源标识
    #[serde(default)]
    pub source: Option<String>,
}

impl AutoContinuePayload {
    pub(crate) fn normalized(mut self) -> Self {
        self.continuation_length = self.continuation_length.min(2);
        self.sensitivity = self.sensitivity.min(100);
        self.source = self
            .source
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self
    }

    pub(crate) fn length_instruction(&self) -> &'static str {
        match self.continuation_length.min(2) {
            0 => "短（补全 1-2 段，聚焦核心信息）",
            1 => "中（补全 3-5 段，兼顾结构与细节）",
            _ => "长（扩展为可发布草稿，结构完整）",
        }
    }

    pub(crate) fn sensitivity_instruction(&self) -> &'static str {
        match self.sensitivity.min(100) {
            0..=33 => "低：优先稳健延续原文表达",
            34..=66 => "中：保持一致性并适度优化表达",
            _ => "高：在不偏题前提下积极补充观点亮点",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};
    use lime_agent::queued_turn::QueuedTurnSnapshot;
    use lime_core::database::dao::agent_timeline::{
        AgentRequestQuestion, AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus,
        AgentThreadTurn, AgentThreadTurnStatus,
    };

    fn build_session_detail(
        turns: Vec<AgentThreadTurn>,
        items: Vec<AgentThreadItem>,
    ) -> SessionDetail {
        SessionDetail {
            id: "session-1".to_string(),
            name: "测试会话".to_string(),
            created_at: 1,
            updated_at: 2,
            thread_id: "thread-1".to_string(),
            model: None,
            working_dir: None,
            workspace_id: None,
            messages: Vec::new(),
            execution_strategy: None,
            execution_runtime: None,
            turns,
            items,
            todo_items: Vec::new(),
            child_subagent_sessions: Vec::new(),
            subagent_parent_context: None,
        }
    }

    fn seconds_ago(seconds: i64) -> String {
        (Utc::now() - Duration::seconds(seconds)).to_rfc3339()
    }

    #[test]
    fn spawn_subagent_request_should_parse_current_fields() {
        let request: AgentRuntimeSpawnSubagentRequest = serde_json::from_value(serde_json::json!({
            "parentSessionId": "parent-1",
            "message": "检查当前工具面对齐情况",
            "name": "verifier",
            "teamName": "delivery-team",
            "agentType": "explorer",
            "runInBackground": true,
            "hooks": {
                "Stop": [
                    {
                        "hooks": [
                            {
                                "type": "prompt",
                                "prompt": "Summarize the delegated result"
                            }
                        ]
                    }
                ]
            },
            "allowedTools": ["Read", "Bash"],
            "disallowedTools": ["WebSearch"],
            "mode": "plan",
            "isolation": "worktree",
            "cwd": "/tmp/workspace"
        }))
        .expect("spawn subagent request should deserialize");

        assert_eq!(request.parent_session_id, "parent-1");
        assert_eq!(request.message, "检查当前工具面对齐情况");
        assert_eq!(request.name.as_deref(), Some("verifier"));
        assert_eq!(request.team_name.as_deref(), Some("delivery-team"));
        assert_eq!(request.agent_type.as_deref(), Some("explorer"));
        assert!(request.run_in_background);
        assert_eq!(request.hooks.as_ref().map(|hooks| hooks.len()), Some(1));
        assert!(request
            .hooks
            .as_ref()
            .and_then(|hooks| hooks.get(&aster::hooks::HookEvent::Stop))
            .is_some());
        assert_eq!(request.allowed_tools, vec!["Read", "Bash"]);
        assert_eq!(request.disallowed_tools, vec!["WebSearch"]);
        assert_eq!(request.mode.as_deref(), Some("plan"));
        assert_eq!(request.isolation.as_deref(), Some("worktree"));
        assert_eq!(request.cwd.as_deref(), Some("/tmp/workspace"));
    }

    #[test]
    fn thread_read_should_expose_pending_request_and_waiting_incident() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-1".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "继续发布".to_string(),
                status: AgentThreadTurnStatus::Running,
                started_at: seconds_ago(20),
                completed_at: None,
                error_message: None,
                created_at: seconds_ago(20),
                updated_at: seconds_ago(10),
            }],
            vec![AgentThreadItem {
                id: "item-1".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                sequence: 1,
                status: AgentThreadItemStatus::InProgress,
                started_at: seconds_ago(15),
                completed_at: None,
                updated_at: seconds_ago(15),
                payload: AgentThreadItemPayload::RequestUserInput {
                    request_id: "req-1".to_string(),
                    action_type: "ask_user".to_string(),
                    prompt: Some("请确认是否继续发布".to_string()),
                    questions: Some(vec![AgentRequestQuestion {
                        question: "是否继续？".to_string(),
                        header: None,
                        options: None,
                        multi_select: None,
                    }]),
                    response: None,
                },
            }],
        );

        let thread_read = AgentRuntimeThreadReadModel::from_session_detail(&detail, &[]);

        assert_eq!(thread_read.status, "waiting_request");
        assert_eq!(thread_read.active_turn_id.as_deref(), Some("turn-1"));
        assert_eq!(thread_read.pending_requests.len(), 1);
        assert_eq!(thread_read.pending_requests[0].id, "req-1");
        assert_eq!(thread_read.incidents.len(), 1);
        assert_eq!(thread_read.incidents[0].incident_type, "waiting_user_input");
        assert_eq!(
            thread_read
                .diagnostics
                .as_ref()
                .and_then(|diagnostics| diagnostics.primary_blocking_kind.as_deref()),
            Some("waiting_user_input")
        );
        assert_eq!(
            thread_read
                .diagnostics
                .as_ref()
                .map(|diagnostics| diagnostics.pending_request_count),
            Some(1)
        );
    }

    #[test]
    fn thread_read_should_escalate_tool_confirmation_timeout() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-timeout".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "继续执行工具调用".to_string(),
                status: AgentThreadTurnStatus::Running,
                started_at: seconds_ago(400),
                completed_at: None,
                error_message: None,
                created_at: seconds_ago(400),
                updated_at: seconds_ago(200),
            }],
            vec![AgentThreadItem {
                id: "item-timeout".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: "turn-timeout".to_string(),
                sequence: 1,
                status: AgentThreadItemStatus::InProgress,
                started_at: seconds_ago(APPROVAL_TIMEOUT_SECONDS + 60),
                completed_at: None,
                updated_at: seconds_ago(APPROVAL_TIMEOUT_SECONDS + 60),
                payload: AgentThreadItemPayload::ApprovalRequest {
                    request_id: "req-timeout".to_string(),
                    action_type: "tool_confirmation".to_string(),
                    prompt: Some("请确认是否执行 apply_patch".to_string()),
                    tool_name: Some("apply_patch".to_string()),
                    arguments: None,
                    response: None,
                },
            }],
        );

        let thread_read = AgentRuntimeThreadReadModel::from_session_detail(&detail, &[]);

        assert_eq!(thread_read.status, "waiting_request");
        assert_eq!(thread_read.incidents.len(), 1);
        assert_eq!(thread_read.incidents[0].incident_type, "approval_timeout");
        assert_eq!(thread_read.incidents[0].severity, "high");
    }

    #[test]
    fn thread_read_should_expose_failed_outcome_and_queue_snapshot() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-2".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "执行外部调用".to_string(),
                status: AgentThreadTurnStatus::Failed,
                started_at: "2026-03-23T09:10:00Z".to_string(),
                completed_at: Some("2026-03-23T09:10:30Z".to_string()),
                error_message: Some("Provider 错误: rate limit".to_string()),
                created_at: "2026-03-23T09:10:00Z".to_string(),
                updated_at: "2026-03-23T09:10:30Z".to_string(),
            }],
            Vec::new(),
        );
        let queued_turns = vec![QueuedTurnSnapshot {
            queued_turn_id: "queued-1".to_string(),
            message_preview: "继续重试".to_string(),
            message_text: "继续重试 provider 请求".to_string(),
            created_at: 1_742_721_830,
            image_count: 0,
            position: 1,
        }];

        let thread_read = AgentRuntimeThreadReadModel::from_session_detail(&detail, &queued_turns);

        assert_eq!(thread_read.status, "failed");
        assert_eq!(thread_read.queued_turns.len(), 1);
        assert_eq!(
            thread_read
                .last_outcome
                .as_ref()
                .map(|value| value.outcome_type.as_str()),
            Some("failed_provider")
        );
        assert_eq!(thread_read.incidents.len(), 1);
        assert_eq!(thread_read.incidents[0].incident_type, "provider_error");
    }

    #[test]
    fn thread_read_should_surface_cost_and_limit_runtime_summary() {
        let mut detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-1".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "继续做多模型调度".to_string(),
                status: AgentThreadTurnStatus::Failed,
                started_at: "2026-03-23T09:10:00Z".to_string(),
                completed_at: Some("2026-03-23T09:10:05Z".to_string()),
                error_message: Some("429 Too Many Requests".to_string()),
                created_at: "2026-03-23T09:10:00Z".to_string(),
                updated_at: "2026-03-23T09:10:05Z".to_string(),
            }],
            Vec::new(),
        );
        detail.execution_runtime = Some(lime_agent::SessionExecutionRuntime {
            session_id: "session-1".to_string(),
            provider_selector: Some("openai".to_string()),
            provider_name: Some("openai".to_string()),
            model_name: Some("gpt-5.4-mini".to_string()),
            execution_strategy: Some("react".to_string()),
            output_schema_runtime: None,
            source: lime_agent::SessionExecutionRuntimeSource::RuntimeSnapshot,
            mode: None,
            latest_turn_id: Some("turn-1".to_string()),
            latest_turn_status: Some("failed".to_string()),
            recent_access_mode: None,
            recent_preferences: None,
            recent_team_selection: None,
            recent_theme: None,
            recent_session_mode: None,
            recent_gate_key: None,
            recent_run_title: None,
            recent_content_id: None,
            task_profile: Some(lime_agent::SessionExecutionRuntimeTaskProfile {
                kind: "translation".to_string(),
                source: "translation_skill_launch".to_string(),
                traits: vec!["service_model_slot".to_string()],
                service_model_slot: Some("translation".to_string()),
                scene_kind: None,
                scene_skill_id: None,
                entry_source: None,
            }),
            routing_decision: Some(lime_agent::SessionExecutionRuntimeRoutingDecision {
                routing_mode: "single_candidate".to_string(),
                decision_source: "service_model_setting".to_string(),
                decision_reason: "命中 service_models.translation".to_string(),
                selected_provider: Some("openai".to_string()),
                selected_model: Some("gpt-5.4-mini".to_string()),
                requested_provider: Some("openai".to_string()),
                requested_model: Some("gpt-5.4-mini".to_string()),
                candidate_count: 1,
                estimated_cost_class: Some("low".to_string()),
                capability_gap: None,
                fallback_chain: Vec::new(),
                settings_source: Some("service_models.translation".to_string()),
                service_model_slot: Some("translation".to_string()),
            }),
            limit_state: Some(lime_agent::SessionExecutionRuntimeLimitState {
                status: "single_candidate_only".to_string(),
                single_candidate_only: true,
                provider_locked: true,
                settings_locked: true,
                oem_locked: false,
                candidate_count: 1,
                capability_gap: None,
                notes: vec!["命中翻译模型".to_string()],
            }),
            cost_state: Some(lime_agent::SessionExecutionRuntimeCostState {
                status: "recorded".to_string(),
                estimated_cost_class: Some("low".to_string()),
                input_per_million: Some(0.8),
                output_per_million: Some(3.2),
                cache_read_per_million: None,
                cache_write_per_million: None,
                currency: Some("USD".to_string()),
                estimated_total_cost: Some(0.0012),
                input_tokens: Some(1000),
                output_tokens: Some(250),
                total_tokens: Some(1250),
                cached_input_tokens: None,
                cache_creation_input_tokens: None,
            }),
            limit_event: Some(lime_agent::SessionExecutionRuntimeLimitEvent {
                event_kind: "rate_limit_hit".to_string(),
                message: "429 Too Many Requests".to_string(),
                retryable: true,
            }),
        });

        let thread_read = AgentRuntimeThreadReadModel::from_session_detail(&detail, &[]);

        assert_eq!(thread_read.estimated_cost_class.as_deref(), Some("low"));
        assert_eq!(
            thread_read
                .cost_state
                .as_ref()
                .and_then(|value| value.estimated_total_cost),
            Some(0.0012)
        );
        assert_eq!(
            thread_read
                .limit_event
                .as_ref()
                .map(|value| value.event_kind.as_str()),
            Some("rate_limit_hit")
        );
    }

    #[test]
    fn thread_read_should_classify_running_turn_stuck() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-stuck".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "长时间执行无响应".to_string(),
                status: AgentThreadTurnStatus::Running,
                started_at: seconds_ago(TURN_STUCK_TIMEOUT_SECONDS + 120),
                completed_at: None,
                error_message: None,
                created_at: seconds_ago(TURN_STUCK_TIMEOUT_SECONDS + 120),
                updated_at: seconds_ago(TURN_STUCK_TIMEOUT_SECONDS + 30),
            }],
            Vec::new(),
        );

        let thread_read = AgentRuntimeThreadReadModel::from_session_detail(&detail, &[]);

        assert_eq!(thread_read.status, "running");
        assert_eq!(thread_read.incidents.len(), 1);
        assert_eq!(thread_read.incidents[0].incident_type, "turn_stuck");
        assert_eq!(thread_read.incidents[0].severity, "high");
    }

    #[test]
    fn thread_read_should_collect_backend_diagnostics() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-diag".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "生成研究简报".to_string(),
                status: AgentThreadTurnStatus::Aborted,
                started_at: "2026-03-23T09:10:00Z".to_string(),
                completed_at: Some("2026-03-23T09:10:30Z".to_string()),
                error_message: Some("用户主动中断".to_string()),
                created_at: "2026-03-23T09:10:00Z".to_string(),
                updated_at: "2026-03-23T09:10:30Z".to_string(),
            }],
            vec![
                AgentThreadItem {
                    id: "item-warning".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-diag".to_string(),
                    sequence: 1,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-23T09:10:10Z".to_string(),
                    completed_at: Some("2026-03-23T09:10:10Z".to_string()),
                    updated_at: "2026-03-23T09:10:10Z".to_string(),
                    payload: AgentThreadItemPayload::Warning {
                        message: "长对话和多次上下文压缩会降低模型准确性".to_string(),
                        code: Some("context_compaction_accuracy".to_string()),
                    },
                },
                AgentThreadItem {
                    id: "item-compaction".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-diag".to_string(),
                    sequence: 2,
                    status: AgentThreadItemStatus::Completed,
                    started_at: "2026-03-23T09:10:20Z".to_string(),
                    completed_at: Some("2026-03-23T09:10:20Z".to_string()),
                    updated_at: "2026-03-23T09:10:20Z".to_string(),
                    payload: AgentThreadItemPayload::ContextCompaction {
                        stage: "runtime".to_string(),
                        trigger: Some("token_budget".to_string()),
                        detail: Some("保留研究目标与来源摘要".to_string()),
                    },
                },
                AgentThreadItem {
                    id: "item-tool".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-diag".to_string(),
                    sequence: 3,
                    status: AgentThreadItemStatus::Failed,
                    started_at: "2026-03-23T09:10:25Z".to_string(),
                    completed_at: Some("2026-03-23T09:10:25Z".to_string()),
                    updated_at: "2026-03-23T09:10:25Z".to_string(),
                    payload: AgentThreadItemPayload::ToolCall {
                        tool_name: "web_search".to_string(),
                        arguments: None,
                        output: None,
                        success: Some(false),
                        error: Some("429 rate limit".to_string()),
                        metadata: None,
                    },
                },
                AgentThreadItem {
                    id: "item-command".to_string(),
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-diag".to_string(),
                    sequence: 4,
                    status: AgentThreadItemStatus::Failed,
                    started_at: "2026-03-23T09:10:26Z".to_string(),
                    completed_at: Some("2026-03-23T09:10:26Z".to_string()),
                    updated_at: "2026-03-23T09:10:26Z".to_string(),
                    payload: AgentThreadItemPayload::CommandExecution {
                        command: "npm run build".to_string(),
                        cwd: "/tmp/workspace".to_string(),
                        aggregated_output: None,
                        exit_code: Some(1),
                        error: Some("Command failed with exit code 1".to_string()),
                    },
                },
            ],
        );

        let thread_read = AgentRuntimeThreadReadModel::from_session_detail(&detail, &[]);
        let diagnostics = thread_read.diagnostics.expect("应生成 diagnostics");

        assert_eq!(diagnostics.latest_turn_status.as_deref(), Some("aborted"));
        assert_eq!(
            diagnostics.latest_turn_started_at.as_deref(),
            Some("2026-03-23T09:10:00Z")
        );
        assert_eq!(
            diagnostics.latest_turn_completed_at.as_deref(),
            Some("2026-03-23T09:10:30Z")
        );
        assert_eq!(
            diagnostics.latest_turn_updated_at.as_deref(),
            Some("2026-03-23T09:10:30Z")
        );
        assert_eq!(diagnostics.latest_turn_elapsed_seconds, Some(30));
        assert_eq!(diagnostics.latest_turn_stalled_seconds, None);
        assert_eq!(
            diagnostics.latest_turn_error_message.as_deref(),
            Some("用户主动中断")
        );
        assert_eq!(
            diagnostics.interrupt_reason.as_deref(),
            Some("用户主动中断")
        );
        assert_eq!(diagnostics.warning_count, 1);
        assert_eq!(diagnostics.context_compaction_count, 1);
        assert_eq!(diagnostics.failed_tool_call_count, 1);
        assert_eq!(diagnostics.failed_command_count, 1);
        assert_eq!(diagnostics.pending_request_count, 0);
        assert_eq!(
            diagnostics.primary_blocking_kind.as_deref(),
            Some("interrupted")
        );
        assert_eq!(
            diagnostics.primary_blocking_summary.as_deref(),
            Some("最近一次回合已被中断")
        );
        assert_eq!(
            diagnostics
                .latest_warning
                .as_ref()
                .and_then(|sample| sample.code.as_deref()),
            Some("context_compaction_accuracy")
        );
        assert_eq!(
            diagnostics
                .latest_context_compaction
                .as_ref()
                .map(|sample| sample.stage.as_str()),
            Some("runtime")
        );
        assert_eq!(
            diagnostics
                .latest_failed_tool
                .as_ref()
                .map(|sample| sample.tool_name.as_str()),
            Some("web_search")
        );
        assert_eq!(
            diagnostics
                .latest_failed_tool
                .as_ref()
                .and_then(|sample| sample.error.as_deref()),
            Some("429 rate limit")
        );
        assert_eq!(
            diagnostics
                .latest_failed_command
                .as_ref()
                .map(|sample| sample.command.as_str()),
            Some("npm run build")
        );
        assert_eq!(
            diagnostics
                .latest_failed_command
                .as_ref()
                .and_then(|sample| sample.exit_code),
            Some(1)
        );
    }

    #[test]
    fn thread_read_should_surface_runtime_interrupt_marker_while_running() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-running".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "继续生成研究简报".to_string(),
                status: AgentThreadTurnStatus::Running,
                started_at: "2026-03-23T09:10:00Z".to_string(),
                completed_at: None,
                error_message: None,
                created_at: "2026-03-23T09:10:00Z".to_string(),
                updated_at: "2026-03-23T09:10:28Z".to_string(),
            }],
            Vec::new(),
        );
        let marker = lime_agent::RuntimeInterruptMarker {
            source: "user".to_string(),
            reason: "用户主动停止当前执行".to_string(),
            requested_at: "2026-03-23T09:10:29Z".to_string(),
        };

        let thread_read = AgentRuntimeThreadReadModel::from_parts(
            &detail,
            &[],
            Vec::new(),
            None,
            Vec::new(),
            Some(&marker),
        );
        let diagnostics = thread_read.diagnostics.expect("应生成 diagnostics");

        assert_eq!(thread_read.status, "interrupting");
        assert_eq!(thread_read.interrupt_state.as_deref(), Some("interrupting"));
        assert_eq!(
            diagnostics.interrupt_reason.as_deref(),
            Some("用户主动停止当前执行")
        );
        assert_eq!(
            diagnostics.runtime_interrupt_source.as_deref(),
            Some("user")
        );
        assert_eq!(
            diagnostics.runtime_interrupt_requested_at.as_deref(),
            Some("2026-03-23T09:10:29Z")
        );
        assert_eq!(
            diagnostics.primary_blocking_kind.as_deref(),
            Some("interrupting")
        );
        assert_eq!(
            diagnostics.primary_blocking_summary.as_deref(),
            Some("用户主动停止当前执行")
        );
    }

    #[test]
    fn replay_request_should_rebuild_pending_action_payload() {
        let detail = build_session_detail(
            vec![AgentThreadTurn {
                id: "turn-replay".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "继续等待输入".to_string(),
                status: AgentThreadTurnStatus::Running,
                started_at: seconds_ago(30),
                completed_at: None,
                error_message: None,
                created_at: seconds_ago(30),
                updated_at: seconds_ago(10),
            }],
            vec![AgentThreadItem {
                id: "item-replay".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: "turn-replay".to_string(),
                sequence: 1,
                status: AgentThreadItemStatus::InProgress,
                started_at: seconds_ago(20),
                completed_at: None,
                updated_at: seconds_ago(15),
                payload: AgentThreadItemPayload::RequestUserInput {
                    request_id: "req-replay".to_string(),
                    action_type: "ask_user".to_string(),
                    prompt: Some("请确认是否继续发布".to_string()),
                    questions: Some(vec![AgentRequestQuestion {
                        question: "是否继续？".to_string(),
                        header: None,
                        options: None,
                        multi_select: None,
                    }]),
                    response: None,
                },
            }],
        );

        let replayed =
            AgentRuntimeReplayedActionRequiredView::from_session_detail(&detail, "req-replay")
                .expect("应能重建 replay 请求");

        assert_eq!(replayed.event_type, "action_required");
        assert_eq!(replayed.request_id, "req-replay");
        assert_eq!(replayed.action_type, "ask_user");
        assert_eq!(replayed.prompt.as_deref(), Some("请确认是否继续发布"));
        assert!(replayed.questions.is_some());
        assert_eq!(
            replayed.scope.and_then(|scope| scope.turn_id),
            Some("turn-replay".to_string())
        );
    }
}
