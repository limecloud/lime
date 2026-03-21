use super::*;

/// Aster Agent 状态信息
#[derive(Debug, Serialize)]
pub struct AsterAgentStatus {
    pub initialized: bool,
    pub provider_configured: bool,
    pub provider_name: Option<String>,
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
    pub creator: bool,
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
    /// 请求级元数据（可选，用于 harness / 主题工作台状态对齐）
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
    pub workspace_id: String,
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
            project_id: None,
            workspace_id: request.workspace_id,
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
    pub messages: Vec<lime_agent::event_converter::TauriMessage>,
    pub execution_strategy: Option<String>,
    pub turns: Vec<lime_core::database::dao::agent_timeline::AgentThreadTurn>,
    pub items: Vec<lime_core::database::dao::agent_timeline::AgentThreadItem>,
    #[serde(default)]
    pub todo_items: Vec<lime_agent::SessionTodoItem>,
    #[serde(default)]
    pub queued_turns: Vec<QueuedTurnSnapshot>,
    #[serde(default)]
    pub child_subagent_sessions: Vec<lime_agent::ChildSubagentSession>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_parent_context: Option<lime_agent::SubagentParentContext>,
}

impl AgentRuntimeSessionDetail {
    pub(crate) fn from_session_detail(
        detail: SessionDetail,
        queued_turns: Vec<QueuedTurnSnapshot>,
    ) -> Self {
        Self {
            id: detail.id,
            name: detail.name,
            created_at: detail.created_at,
            updated_at: detail.updated_at,
            thread_id: detail.thread_id,
            messages: detail.messages,
            execution_strategy: detail.execution_strategy,
            turns: detail.turns,
            items: detail.items,
            todo_items: detail.todo_items,
            queued_turns,
            child_subagent_sessions: detail.child_subagent_sessions,
            subagent_parent_context: detail.subagent_parent_context,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentRuntimeSpawnSubagentRequest {
    #[serde(alias = "parentSessionId")]
    pub parent_session_id: String,
    pub message: String,
    #[serde(default, alias = "agentType")]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, alias = "reasoningEffort")]
    pub reasoning_effort: Option<String>,
    #[serde(default, alias = "forkContext")]
    pub fork_context: bool,
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
}

#[derive(Debug, Deserialize)]
pub struct AgentRuntimeUpdateSessionRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, alias = "executionStrategy")]
    pub execution_strategy: Option<AsterExecutionStrategy>,
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
