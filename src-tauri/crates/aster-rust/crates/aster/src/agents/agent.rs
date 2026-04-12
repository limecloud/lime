use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use futures::stream::BoxStream;
use futures::{stream, FutureExt, Stream, StreamExt, TryStreamExt};
use uuid::Uuid;

use super::final_output_tool::FinalOutputTool;
use super::tool_execution::{ToolCallResult, CHAT_MODE_TOOL_SKIPPED_RESPONSE, DECLINED_RESPONSE};
use crate::action_required_manager::ActionRequiredManager;
use crate::agents::error_handling::OverflowHandler;
use crate::agents::extension::{ExtensionConfig, ExtensionResult, ToolInfo};
use crate::agents::extension_manager::{get_parameter_names, ExtensionManager};
use crate::agents::extension_manager_extension::MANAGE_EXTENSIONS_TOOL_NAME_COMPLETE;
use crate::agents::final_output_tool::{FINAL_OUTPUT_CONTINUATION_MESSAGE, FINAL_OUTPUT_TOOL_NAME};
use crate::agents::prompt_manager::PromptManager;
use crate::agents::retry::{RetryManager, RetryResult};
use crate::agents::subagent_task_config::TaskConfig;
use crate::agents::subagent_tool::{create_subagent_tool, handle_subagent_tool, AGENT_TOOL_NAME};
use crate::agents::types::SessionConfig;
use crate::agents::types::{FrontendTool, SharedProvider, ToolResultReceiver};
use crate::config::{get_enabled_extensions, AsterMode, Config};
use crate::context::ContextTraceStep;
use crate::context_mgmt::{
    automatic_compaction_enabled_for_current_turn, check_if_compaction_needed,
    compact_messages_with_summary, DEFAULT_COMPACTION_THRESHOLD,
};
use crate::conversation::message::{
    ActionRequired, ActionRequiredData, ActionRequiredScope, Message, MessageContent,
    ProviderMetadata, SystemNotificationType, ThinkingContent, ToolRequest, ToolResponse,
};
use crate::conversation::{debug_conversation_fix, fix_conversation, Conversation};
use crate::mcp_utils::ToolResult;
use crate::model::ModelConfig;
use crate::permission::permission_inspector::PermissionInspector;
use crate::permission::permission_judge::PermissionCheckResult;
use crate::permission::PermissionConfirmation;
use crate::providers::base::{Provider, SessionNameGenerationExecutionStrategy};
use crate::providers::errors::ProviderError;
use crate::recipe::{Author, Recipe, Response, Settings, SubRecipe};
use crate::scheduler_trait::SchedulerTrait;
use crate::security::security_inspector::SecurityInspector;
use crate::session::extension_data::{EnabledExtensionsState, ExtensionState};
use crate::session::{
    load_session_runtime_snapshot, require_shared_thread_runtime_store, save_summary,
    InMemoryThreadRuntimeStore, ItemRuntime, ItemRuntimePayload, ItemStatus, Session,
    SessionManager, SessionRuntimeSnapshot, SessionStore, SessionType, TeamMembershipState,
    TeamSessionState, ThreadRuntime, ThreadRuntimeStore, TurnContextOverride,
    TurnOutputSchemaRuntime, TurnOutputSchemaSource, TurnOutputSchemaStrategy, TurnRuntime,
    TurnStatus,
};
use crate::tool_inspection::ToolInspectionManager;
use crate::tool_monitor::RepetitionInspector;
use crate::tools::{
    current_surface_tool_gates, register_all_tools, should_register_current_surface_tool,
    AgentControlToolConfig, AskTool, CronCreateTool, CronDeleteTool, CronListTool,
    CurrentSurfaceToolGates, SharedFileReadHistory, SpawnAgentRequest, SpawnAgentResponse,
    ToolRegistrationConfig, ToolRegistry, DEFAULT_ASK_TIMEOUT_SECS,
};
use crate::user_message_manager::UserMessageManager;
use crate::utils::is_token_cancelled;
use regex::Regex;
use rmcp::model::{
    CallToolRequestParam, CallToolResult, Content, ErrorCode, ErrorData, GetPromptResult, Prompt,
    Role, ServerNotification, TextContent, Tool,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, instrument, warn};

const DEFAULT_MAX_TURNS: u32 = 1000;
const COMPACTION_THINKING_TEXT: &str = "aster is compacting the conversation...";
const CONTEXT_COMPACTION_WARNING_TEXT: &str =
    "长对话和多次上下文压缩会降低模型准确性；如果后续结果开始漂移，建议新开会话。";
const RESOURCE_GATED_TOOL_NAMES: [&str; 2] = ["ListMcpResourcesTool", "ReadMcpResourceTool"];
const SUBAGENT_ALLOWED_NATIVE_TOOL_NAMES: [&str; 14] = [
    "Bash",
    "PowerShell",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "TaskCreate",
    "TaskGet",
    "TaskList",
    "TaskUpdate",
    "NotebookEdit",
];
const SUBAGENT_ALLOWED_COORDINATION_TOOL_NAMES: [&str; 5] = [
    "Skill",
    "ToolSearch",
    FINAL_OUTPUT_TOOL_NAME,
    "EnterWorktree",
    "ExitWorktree",
];
const SUBAGENT_TEAMMATE_ALLOWED_TOOL_NAMES: [&str; 5] = [
    "SendMessage",
    "ListPeers",
    "CronCreate",
    "CronList",
    "CronDelete",
];
const AUTO_COMPACTION_DISABLED_CONTEXT_LIMIT_TEXT: &str =
    "Automatic compaction is disabled for this turn. The conversation reached the context limit. Compact the session manually or start a new session before retrying.";
const PROPOSED_PLAN_OPEN: &str = "<proposed_plan>";
const PROPOSED_PLAN_CLOSE: &str = "</proposed_plan>";
const FILE_ARTIFACT_METADATA_KEYS: [&str; 9] = [
    "path",
    "file_path",
    "filePath",
    "output_file",
    "output_path",
    "outputPath",
    "artifact_path",
    "artifact_paths",
    "absolute_path",
];

#[derive(Debug, Clone)]
struct ResolvedOutputSchema {
    schema: Value,
    source: TurnOutputSchemaSource,
}

#[derive(Debug, Deserialize)]
struct CurrentAgentToolRequest {
    description: String,
    prompt: String,
    #[serde(default)]
    subagent_type: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    run_in_background: bool,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    team_name: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    isolation: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug)]
struct CallbackBackedAgentSpawn {
    request: CurrentAgentToolRequest,
    spawn_request: SpawnAgentRequest,
    description: String,
    prompt: String,
}

fn default_ask_callback() -> crate::tools::AskCallback {
    Arc::new(|request| {
        Box::pin(async move {
            let scope = crate::session_context::current_action_scope().unwrap_or_else(|| {
                let session_id = crate::session_context::current_session_id();
                ActionRequiredScope {
                    session_id: session_id.clone(),
                    thread_id: session_id,
                    turn_id: None,
                }
            });

            match ActionRequiredManager::global()
                .request_and_wait_scoped(
                    scope,
                    AskTool::build_elicitation_message(&request),
                    AskTool::build_elicitation_schema(&request),
                    Duration::from_secs(DEFAULT_ASK_TIMEOUT_SECS),
                )
                .await
            {
                Ok(user_data) => Some(user_data),
                Err(error) => {
                    warn!(?error, "AskUserQuestion elicitation failed");
                    None
                }
            }
        })
    })
}

fn extract_proposed_plan_block(text: &str) -> Option<String> {
    let start = text.find(PROPOSED_PLAN_OPEN)?;
    let remainder = text.get(start + PROPOSED_PLAN_OPEN.len()..)?;
    let end = remainder.find(PROPOSED_PLAN_CLOSE)?;
    let content = remainder.get(..end)?.trim();
    if content.is_empty() {
        None
    } else {
        Some(content.to_string())
    }
}

fn build_reasoning_summary_sections(text: &str) -> Option<Vec<String>> {
    let sections = text
        .split("\n\n")
        .map(str::trim)
        .filter(|section| !section.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    if sections.is_empty() {
        None
    } else {
        Some(sections)
    }
}

fn should_expose_registered_tool_with_gates(
    name: &str,
    resources_supported: bool,
    tool_gates: CurrentSurfaceToolGates,
) -> bool {
    if RESOURCE_GATED_TOOL_NAMES.contains(&name) {
        return resources_supported;
    }

    should_register_current_surface_tool(name, tool_gates)
}

fn should_expose_registered_tool(name: &str, resources_supported: bool) -> bool {
    should_expose_registered_tool_with_gates(
        name,
        resources_supported,
        current_surface_tool_gates(),
    )
}

fn is_extension_prefixed_tool(name: &str) -> bool {
    name.contains("__")
}

fn should_expose_tool_for_session(
    name: &str,
    session_type: Option<SessionType>,
    resources_supported: bool,
) -> bool {
    should_expose_tool_for_session_with_gates(
        name,
        session_type,
        resources_supported,
        current_surface_tool_gates(),
        false,
        crate::tools::plan_mode_tool::current_plan_mode_active(),
    )
}

fn should_expose_tool_for_session_with_gates(
    name: &str,
    session_type: Option<SessionType>,
    resources_supported: bool,
    tool_gates: CurrentSurfaceToolGates,
    subagent_teammate_tools_enabled: bool,
    plan_mode_active: bool,
) -> bool {
    if !should_expose_registered_tool_with_gates(name, resources_supported, tool_gates) {
        return false;
    }

    if !matches!(session_type, Some(SessionType::SubAgent)) {
        return true;
    }

    if is_extension_prefixed_tool(name) {
        return true;
    }

    if name == "ExitPlanMode" && plan_mode_active {
        return true;
    }

    if name == AGENT_TOOL_NAME && subagent_teammate_tools_enabled {
        return true;
    }

    SUBAGENT_ALLOWED_NATIVE_TOOL_NAMES.contains(&name)
        || SUBAGENT_ALLOWED_COORDINATION_TOOL_NAMES.contains(&name)
        || (subagent_teammate_tools_enabled && SUBAGENT_TEAMMATE_ALLOWED_TOOL_NAMES.contains(&name))
}

fn session_allows_subagent_teammate_tools(session: &Session) -> bool {
    matches!(session.session_type, SessionType::SubAgent)
        && (TeamMembershipState::from_session(session).is_some()
            || TeamSessionState::from_session(session).is_some())
}

fn collect_string_values(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else {
                vec![trimmed.to_string()]
            }
        }
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn push_unique_file_path(target: &mut Vec<String>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || target.iter().any(|item| item == trimmed) {
        return;
    }
    target.push(trimmed.to_string());
}

fn extract_file_artifacts(metadata: Option<&Value>) -> Vec<(String, Option<String>)> {
    let Some(object) = metadata.and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut paths = Vec::new();
    for key in FILE_ARTIFACT_METADATA_KEYS {
        let Some(value) = object.get(key) else {
            continue;
        };
        for path in collect_string_values(value) {
            push_unique_file_path(&mut paths, path.as_str());
        }
    }

    let artifact_ids = object
        .get("artifact_ids")
        .map(collect_string_values)
        .unwrap_or_default();
    let single_artifact_id = object
        .get("artifact_id")
        .or_else(|| object.get("artifactId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| {
            (
                path,
                artifact_ids.get(index).cloned().or_else(|| {
                    if index == 0 {
                        single_artifact_id.clone()
                    } else {
                        None
                    }
                }),
            )
        })
        .collect()
}

fn resolve_file_artifact_status(metadata: Option<&Value>) -> ItemStatus {
    let write_phase = metadata
        .and_then(|value| value.get("writePhase"))
        .and_then(Value::as_str);
    if matches!(write_phase, Some("failed")) {
        return ItemStatus::Failed;
    }

    match metadata
        .and_then(|value| value.get("complete"))
        .and_then(Value::as_bool)
    {
        Some(false) => ItemStatus::InProgress,
        _ => ItemStatus::Completed,
    }
}

fn resolve_file_artifact_source(metadata: Option<&Value>) -> String {
    metadata
        .and_then(|value| value.get("lastUpdateSource"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "tool_result".to_string())
}

fn extract_tool_result_metadata<T: serde::Serialize>(result: &T) -> Option<Value> {
    fn find_metadata(value: &Value, depth: usize) -> Option<Value> {
        const JSON_RECURSION_LIMIT: usize = 16;

        if depth >= JSON_RECURSION_LIMIT {
            return None;
        }

        let object = value.as_object()?;

        for key in [
            "metadata",
            "meta",
            "_meta",
            "structured_content",
            "structuredContent",
        ] {
            let Some(nested) = object.get(key) else {
                continue;
            };

            if let Some(record) = nested.as_object() {
                if !record.is_empty() {
                    return Some(Value::Object(record.clone()));
                }
            }

            if let Some(found) = find_metadata(nested, depth + 1) {
                return Some(found);
            }
        }

        for nested in object.values() {
            if let Some(found) = find_metadata(nested, depth + 1) {
                return Some(found);
            }
        }

        None
    }

    serde_json::to_value(result)
        .ok()
        .and_then(|value| find_metadata(&value, 0))
}

fn native_tool_metadata_to_value(
    metadata: std::collections::HashMap<String, Value>,
) -> Option<Value> {
    if metadata.is_empty() {
        None
    } else {
        Some(Value::Object(metadata.into_iter().collect()))
    }
}

fn native_tool_result_to_call_tool_result(result: crate::tools::ToolResult) -> CallToolResult {
    let structured_content = native_tool_metadata_to_value(result.metadata);
    let fallback_text = structured_content
        .as_ref()
        .and_then(|value| serde_json::to_string_pretty(value).ok());
    let text = if result.success {
        result
            .output
            .filter(|value| !value.is_empty())
            .or_else(|| fallback_text.clone())
            .unwrap_or_default()
    } else {
        result
            .error
            .or(result.output)
            .filter(|value| !value.is_empty())
            .or(fallback_text)
            .unwrap_or_default()
    };

    CallToolResult {
        content: vec![Content::text(text)],
        structured_content,
        is_error: Some(!result.success),
        meta: None,
    }
}

fn tool_surface_updated_from_call_tool_result(result: &CallToolResult) -> bool {
    result
        .structured_content
        .as_ref()
        .and_then(|value| value.get("tool_surface_updated"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn normalize_agent_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn require_agent_text(value: String, field_name: &str) -> Result<String, ErrorData> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            format!("{field_name} cannot be empty"),
            None,
        ));
    }

    Ok(trimmed.to_string())
}

fn normalize_agent_cwd(value: Option<String>) -> Result<Option<String>, ErrorData> {
    let Some(cwd) = normalize_agent_optional_text(value) else {
        return Ok(None);
    };

    let path = std::path::Path::new(&cwd);
    if !path.is_absolute() {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            "cwd must be an absolute path".to_string(),
            None,
        ));
    }
    if !path.is_dir() {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            format!("cwd is not a directory: {cwd}"),
            None,
        ));
    }

    Ok(Some(cwd))
}

fn parse_current_agent_tool_request(
    arguments: Value,
) -> Result<CurrentAgentToolRequest, ErrorData> {
    serde_json::from_value(arguments).map_err(|error| {
        ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            format!("Invalid parameters: {error}"),
            None,
        )
    })
}

fn prepare_callback_backed_agent_spawn(
    request: CurrentAgentToolRequest,
    session: &Session,
) -> Result<Option<CallbackBackedAgentSpawn>, ErrorData> {
    let mode = normalize_agent_optional_text(request.mode.clone());
    if mode.is_some() {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            "mode is not supported in the current runtime".to_string(),
            None,
        ));
    }

    let isolation = normalize_agent_optional_text(request.isolation.clone());
    if isolation.is_some() {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            "isolation is not supported in the current runtime".to_string(),
            None,
        ));
    }

    let name = normalize_agent_optional_text(request.name.clone());
    let team_name = normalize_agent_optional_text(request.team_name.clone());
    let cwd = normalize_agent_cwd(request.cwd.clone())?;
    let team_subagent = session_allows_subagent_teammate_tools(session);
    if team_subagent && request.run_in_background {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            "Team subagents cannot spawn background agents in the current runtime".to_string(),
            None,
        ));
    }
    if team_subagent && (name.is_some() || team_name.is_some()) {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            "Team subagents cannot spawn teammates in the current runtime; omit name and team_name"
                .to_string(),
            None,
        ));
    }

    let should_use_callback = !team_subagent
        && (request.run_in_background || name.is_some() || team_name.is_some() || cwd.is_some());
    if !should_use_callback {
        return Ok(None);
    }
    if team_name.is_some() && name.is_none() {
        return Err(ErrorData::new(
            ErrorCode::INVALID_PARAMS,
            "team_name requires name in the current runtime".to_string(),
            None,
        ));
    }

    let description = require_agent_text(request.description.clone(), "description")?;
    let prompt = require_agent_text(request.prompt.clone(), "prompt")?;
    let spawn_request = SpawnAgentRequest {
        parent_session_id: session.id.clone(),
        message: prompt.clone(),
        name,
        team_name,
        agent_type: normalize_agent_optional_text(request.subagent_type.clone()),
        model: normalize_agent_optional_text(request.model.clone()),
        run_in_background: request.run_in_background,
        reasoning_effort: None,
        fork_context: false,
        blueprint_role_id: None,
        blueprint_role_label: None,
        profile_id: None,
        profile_name: None,
        role_key: None,
        skill_ids: Vec::new(),
        skill_directories: Vec::new(),
        team_preset_id: None,
        theme: None,
        system_overlay: None,
        output_contract: None,
        mode,
        isolation,
        cwd,
    };

    Ok(Some(CallbackBackedAgentSpawn {
        request,
        spawn_request,
        description,
        prompt,
    }))
}

fn build_async_agent_call_result(
    request: &CurrentAgentToolRequest,
    response: &SpawnAgentResponse,
    description: String,
    prompt: String,
) -> CallToolResult {
    let mut structured = serde_json::Map::new();
    structured.insert(
        "status".to_string(),
        Value::String("async_launched".to_string()),
    );
    structured.insert(
        "agentId".to_string(),
        Value::String(response.agent_id.clone()),
    );
    structured.insert("description".to_string(), Value::String(description));
    structured.insert("prompt".to_string(), Value::String(prompt));
    structured.insert(
        "outputFile".to_string(),
        response
            .extra
            .get("outputFile")
            .or_else(|| response.extra.get("output_file"))
            .cloned()
            .unwrap_or_else(|| Value::String(String::new())),
    );
    structured.insert(
        "canReadOutputFile".to_string(),
        response
            .extra
            .get("canReadOutputFile")
            .or_else(|| response.extra.get("can_read_output_file"))
            .cloned()
            .unwrap_or(Value::Bool(false)),
    );
    if let Some(name) = normalize_agent_optional_text(request.name.clone()) {
        structured.insert("name".to_string(), Value::String(name));
    }
    if let Some(team_name) = normalize_agent_optional_text(request.team_name.clone()) {
        structured.insert("teamName".to_string(), Value::String(team_name));
    }
    if let Some(agent_type) = normalize_agent_optional_text(request.subagent_type.clone()) {
        structured.insert("agentType".to_string(), Value::String(agent_type));
    }

    CallToolResult {
        content: vec![Content::text(format!(
            "Agent launched: {}",
            response.agent_id
        ))],
        structured_content: Some(Value::Object(structured)),
        is_error: Some(false),
        meta: None,
    }
}

/// Context needed for the reply function
pub struct ReplyContext {
    pub conversation: Conversation,
    pub tools: Vec<Tool>,
    pub toolshim_tools: Vec<Tool>,
    pub system_prompt: String,
    pub model_config: ModelConfig,
    pub aster_mode: AsterMode,
    pub initial_messages: Vec<Message>,
    pub context_trace: Vec<ContextTraceStep>,
}

pub struct ToolCategorizeResult {
    pub frontend_requests: Vec<ToolRequest>,
    pub remaining_requests: Vec<ToolRequest>,
    pub filtered_response: Message,
    pub normalized_response: Message,
}

/// The main aster Agent
pub struct Agent {
    pub(super) provider: SharedProvider,

    pub extension_manager: Arc<ExtensionManager>,
    pub(super) session_type_hint: RwLock<Option<SessionType>>,
    pub(super) sub_recipes: Mutex<HashMap<String, SubRecipe>>,
    pub(super) session_output_schema: Arc<Mutex<Option<Value>>>,
    pub(super) final_output_tool: Arc<Mutex<Option<FinalOutputTool>>>,
    pub(super) frontend_tools: Mutex<HashMap<String, FrontendTool>>,
    pub(super) frontend_instructions: Mutex<Option<String>>,
    pub(super) prompt_manager: Mutex<PromptManager>,
    pub(super) confirmation_tx: mpsc::Sender<(String, PermissionConfirmation)>,
    pub(super) confirmation_rx: Mutex<mpsc::Receiver<(String, PermissionConfirmation)>>,
    pub(super) tool_result_tx: mpsc::Sender<(String, ToolResult<CallToolResult>)>,
    pub(super) tool_result_rx: ToolResultReceiver,

    pub(super) scheduler_service: Mutex<Option<Arc<dyn SchedulerTrait>>>,
    pub(super) retry_manager: RetryManager,
    pub(super) tool_inspection_manager: ToolInspectionManager,

    /// Tool registry for native tools (Requirements: 11.3, 11.4, 11.5)
    pub(super) tool_registry: Arc<RwLock<ToolRegistry>>,
    /// Shared file read history for file tools
    pub(super) file_read_history: SharedFileReadHistory,

    /// 可选的 session 存储
    ///
    /// 如果设置，Agent 会使用此存储保存消息。
    /// 如果未设置，会回退到全局 SessionManager（向后兼容）。
    pub(super) session_store: Option<Arc<dyn SessionStore>>,
    pub(super) thread_runtime_store: Arc<dyn ThreadRuntimeStore>,
    pub(super) agent_control_tools: Option<AgentControlToolConfig>,
}

#[derive(Clone, Debug)]
pub enum AgentEvent {
    TurnStarted {
        turn: TurnRuntime,
    },
    ItemStarted {
        item: ItemRuntime,
    },
    ItemUpdated {
        item: ItemRuntime,
    },
    ItemCompleted {
        item: ItemRuntime,
    },
    ContextCompactionStarted {
        item_id: String,
        trigger: String,
        detail: Option<String>,
    },
    ContextCompactionCompleted {
        item_id: String,
        trigger: String,
        detail: Option<String>,
    },
    ContextCompactionWarning {
        message: String,
    },
    Message(Message),
    McpNotification((String, ServerNotification)),
    ModelChange {
        model: String,
        mode: String,
    },
    HistoryReplaced(Conversation),
    ContextTrace {
        steps: Vec<ContextTraceStep>,
    },
}

#[derive(Clone, Copy, Debug)]
enum ContextCompactionTrigger {
    Auto,
    Overflow,
    Manual,
}

impl ContextCompactionTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Overflow => "overflow",
            Self::Manual => "manual",
        }
    }

    fn started_detail(self) -> &'static str {
        match self {
            Self::Auto => "Context window is nearing its limit. Compacting earlier messages into a summary.",
            Self::Overflow => "Context limit was reached. Compacting earlier messages into a summary before retrying.",
            Self::Manual => "Compacting the current session on request and replacing earlier history with a summary.",
        }
    }

    fn completed_detail(self) -> &'static str {
        match self {
            Self::Auto => "Auto-compaction finished. The assistant will continue from the compacted summary.",
            Self::Overflow => "Recovery compaction finished. The assistant will retry with the compacted summary.",
            Self::Manual => "Context compaction finished. Earlier history was replaced with a summary for future turns.",
        }
    }
}

#[derive(Debug)]
pub(crate) struct ContextCompactionResult {
    compacted_conversation: Conversation,
}

impl Default for Agent {
    fn default() -> Self {
        Self::new()
    }
}

pub enum ToolStreamItem<T> {
    Message(ServerNotification),
    Result(T),
}

pub type ToolStream =
    Pin<Box<dyn Stream<Item = ToolStreamItem<ToolResult<CallToolResult>>> + Send>>;

#[derive(Debug)]
struct TurnItemRuntimeProjector {
    thread_id: String,
    turn_id: String,
    next_sequence: i64,
    items: HashMap<String, ItemRuntime>,
}

impl TurnItemRuntimeProjector {
    fn new(turn: &TurnRuntime) -> Self {
        Self {
            thread_id: turn.thread_id.clone(),
            turn_id: turn.id.clone(),
            next_sequence: 0,
            items: HashMap::new(),
        }
    }

    fn project_user_input(&mut self, turn: &TurnRuntime) -> Option<AgentEvent> {
        let content = turn.input_text.as_ref()?.trim();
        if content.is_empty() {
            return None;
        }

        Some(self.complete_item(
            format!("user:{}", turn.id),
            ItemRuntimePayload::UserMessage {
                content: content.to_string(),
            },
            ItemStatus::Completed,
            turn.started_at.unwrap_or(turn.created_at),
        ))
    }

    fn project_agent_event(&mut self, event: &AgentEvent) -> Vec<AgentEvent> {
        match event {
            AgentEvent::Message(message) => self.project_message(message),
            _ => Vec::new(),
        }
    }

    fn project_message(&mut self, message: &Message) -> Vec<AgentEvent> {
        if !message.is_user_visible() {
            return Vec::new();
        }

        message
            .content
            .iter()
            .flat_map(|content| self.project_message_content(message, content))
            .collect()
    }

    fn project_message_content(
        &mut self,
        message: &Message,
        content: &MessageContent,
    ) -> Vec<AgentEvent> {
        match content {
            MessageContent::Text(text_content) => self.project_text_content(message, text_content),
            MessageContent::Thinking(thinking_content) => self
                .project_thinking_content(message, thinking_content)
                .into_iter()
                .collect(),
            MessageContent::ToolRequest(tool_request) => self
                .project_tool_request(tool_request)
                .into_iter()
                .collect(),
            MessageContent::ToolResponse(tool_response) => {
                self.project_tool_response(tool_response)
            }
            MessageContent::ActionRequired(action_required) => self
                .project_action_required(action_required)
                .into_iter()
                .collect(),
            _ => Vec::new(),
        }
    }

    fn project_text_content(
        &mut self,
        message: &Message,
        text_content: &TextContent,
    ) -> Vec<AgentEvent> {
        if text_content.text.trim().is_empty() {
            return Vec::new();
        }

        let item_id = self.message_item_id(message, "assistant");
        let next_text = self.append_agent_message_text(&item_id, &text_content.text);
        let mut events = vec![self.upsert_in_progress(
            item_id,
            ItemRuntimePayload::AgentMessage {
                text: next_text.clone(),
            },
        )];

        if let Some(plan_text) = extract_proposed_plan_block(&next_text) {
            events.push(self.upsert_in_progress(
                format!("plan:{}", self.turn_id),
                ItemRuntimePayload::Plan { text: plan_text },
            ));
        }

        events
    }

    fn project_thinking_content(
        &mut self,
        message: &Message,
        thinking_content: &ThinkingContent,
    ) -> Option<AgentEvent> {
        if thinking_content.thinking.trim().is_empty() {
            return None;
        }

        let item_id = self.message_item_id(message, "reasoning");
        let next_text = self.append_reasoning_text(&item_id, &thinking_content.thinking);
        let summary = build_reasoning_summary_sections(&next_text);

        Some(self.upsert_in_progress(
            item_id,
            ItemRuntimePayload::Reasoning {
                text: next_text,
                summary,
            },
        ))
    }

    fn project_tool_request(&mut self, tool_request: &ToolRequest) -> Option<AgentEvent> {
        let Ok(tool_call) = &tool_request.tool_call else {
            return None;
        };

        Some(self.upsert_in_progress(
            tool_request.id.clone(),
            ItemRuntimePayload::ToolCall {
                tool_name: tool_call.name.to_string(),
                arguments: Self::serialize_non_null(&tool_call.arguments),
                output: None,
                success: None,
                error: None,
                metadata: Self::metadata_value(tool_request.metadata.as_ref()),
            },
        ))
    }

    fn project_tool_response(&mut self, tool_response: &ToolResponse) -> Vec<AgentEvent> {
        let existing = self.items.get(&tool_response.id).cloned();
        let (tool_name, arguments) = match existing.as_ref().map(|item| &item.payload) {
            Some(ItemRuntimePayload::ToolCall {
                tool_name,
                arguments,
                ..
            }) => (tool_name.clone(), arguments.clone()),
            _ => (tool_response.id.clone(), None),
        };
        let (output, success, error, status) = match &tool_response.tool_result {
            Ok(result) => (
                serde_json::to_value(result).ok(),
                Some(true),
                None,
                ItemStatus::Completed,
            ),
            Err(err) => (None, Some(false), Some(err.to_string()), ItemStatus::Failed),
        };
        let tool_event = self.complete_item(
            tool_response.id.clone(),
            ItemRuntimePayload::ToolCall {
                tool_name,
                arguments,
                output,
                success,
                error,
                metadata: Self::metadata_value(tool_response.metadata.as_ref()),
            },
            status,
            existing
                .as_ref()
                .map(|item| item.started_at)
                .unwrap_or_else(Utc::now),
        );

        let artifact_metadata = tool_response
            .tool_result
            .as_ref()
            .ok()
            .and_then(extract_tool_result_metadata);
        let artifact_status = resolve_file_artifact_status(artifact_metadata.as_ref());
        let artifact_source = resolve_file_artifact_source(artifact_metadata.as_ref());

        let mut events = vec![tool_event];
        for (path, artifact_id) in extract_file_artifacts(artifact_metadata.as_ref()) {
            let item_id =
                artifact_id.unwrap_or_else(|| format!("artifact:{}:{}", tool_response.id, path));
            let payload = ItemRuntimePayload::FileArtifact {
                path,
                source: artifact_source.clone(),
                content: None,
                metadata: artifact_metadata.clone(),
            };

            let event = match artifact_status {
                ItemStatus::InProgress => self.upsert_in_progress(item_id, payload),
                ItemStatus::Completed | ItemStatus::Failed => {
                    let started_at = self
                        .items
                        .get(&item_id)
                        .map(|item| item.started_at)
                        .unwrap_or_else(Utc::now);
                    self.complete_item(item_id, payload, artifact_status, started_at)
                }
            };
            events.push(event);
        }

        events
    }

    fn project_action_required(&mut self, action_required: &ActionRequired) -> Option<AgentEvent> {
        let (item_id, payload) = match &action_required.data {
            ActionRequiredData::ToolConfirmation {
                id,
                tool_name,
                arguments,
                prompt,
            } => (
                id.clone(),
                ItemRuntimePayload::ApprovalRequest {
                    request_id: id.clone(),
                    action_type: "tool_confirmation".to_string(),
                    prompt: prompt.clone(),
                    tool_name: Some(tool_name.clone()),
                    arguments: Self::serialize_non_null(arguments),
                    response: None,
                },
            ),
            ActionRequiredData::Elicitation {
                id,
                message,
                requested_schema,
            } => (
                id.clone(),
                ItemRuntimePayload::RequestUserInput {
                    request_id: id.clone(),
                    action_type: "elicitation".to_string(),
                    prompt: Some(message.clone()),
                    requested_schema: Some(requested_schema.clone()),
                    response: None,
                },
            ),
            ActionRequiredData::ElicitationResponse { .. } => return None,
        };

        Some(self.upsert_in_progress(item_id, payload))
    }

    fn message_item_id(&self, message: &Message, prefix: &str) -> String {
        message
            .id
            .as_ref()
            .map(|id| format!("{prefix}:{id}"))
            .unwrap_or_else(|| format!("{prefix}:{}", self.turn_id))
    }

    fn append_agent_message_text(&self, item_id: &str, text_chunk: &str) -> String {
        self.items
            .get(item_id)
            .and_then(|item| match &item.payload {
                ItemRuntimePayload::AgentMessage { text } => Some(format!("{text}{text_chunk}")),
                _ => None,
            })
            .unwrap_or_else(|| text_chunk.to_string())
    }

    fn append_reasoning_text(&self, item_id: &str, text_chunk: &str) -> String {
        self.items
            .get(item_id)
            .and_then(|item| match &item.payload {
                ItemRuntimePayload::Reasoning { text, .. } => Some(format!("{text}{text_chunk}")),
                _ => None,
            })
            .unwrap_or_else(|| text_chunk.to_string())
    }

    fn serialize_non_null<T: serde::Serialize>(value: &T) -> Option<Value> {
        serde_json::to_value(value)
            .ok()
            .filter(|value| !value.is_null())
    }

    fn metadata_value(metadata: Option<&ProviderMetadata>) -> Option<Value> {
        metadata.map(|metadata| Value::Object(metadata.clone()))
    }

    fn finalize_open_items(&mut self, turn_status: TurnStatus) -> Vec<AgentEvent> {
        let final_status = match turn_status {
            TurnStatus::Completed | TurnStatus::Queued | TurnStatus::Running => {
                ItemStatus::Completed
            }
            TurnStatus::Failed | TurnStatus::Aborted => ItemStatus::Failed,
        };

        let mut pending_ids = self
            .items
            .iter()
            .filter_map(|(id, item)| {
                (item.status == ItemStatus::InProgress).then_some((item.sequence, id.clone()))
            })
            .collect::<Vec<_>>();
        pending_ids.sort_by_key(|(sequence, _)| *sequence);

        pending_ids
            .into_iter()
            .filter_map(|(_, id)| {
                let item = self.items.get_mut(&id)?;
                let now = Utc::now();
                item.status = final_status;
                item.completed_at = Some(now);
                item.updated_at = now;
                Some(AgentEvent::ItemCompleted { item: item.clone() })
            })
            .collect()
    }

    fn upsert_in_progress(&mut self, id: String, payload: ItemRuntimePayload) -> AgentEvent {
        let now = Utc::now();
        if let Some(item) = self.items.get_mut(&id) {
            item.status = ItemStatus::InProgress;
            item.completed_at = None;
            item.updated_at = now;
            item.payload = payload;
            return AgentEvent::ItemUpdated { item: item.clone() };
        }

        let item = ItemRuntime {
            id: id.clone(),
            thread_id: self.thread_id.clone(),
            turn_id: self.turn_id.clone(),
            sequence: self.allocate_sequence(),
            status: ItemStatus::InProgress,
            started_at: now,
            completed_at: None,
            updated_at: now,
            payload,
        };
        self.items.insert(id, item.clone());
        AgentEvent::ItemStarted { item }
    }

    fn complete_item(
        &mut self,
        id: String,
        payload: ItemRuntimePayload,
        status: ItemStatus,
        started_at: DateTime<Utc>,
    ) -> AgentEvent {
        let now = Utc::now();
        if let Some(item) = self.items.get_mut(&id) {
            item.status = status;
            item.completed_at = Some(now);
            item.updated_at = now;
            item.payload = payload;
            return AgentEvent::ItemCompleted { item: item.clone() };
        }

        let item = ItemRuntime {
            id: id.clone(),
            thread_id: self.thread_id.clone(),
            turn_id: self.turn_id.clone(),
            sequence: self.allocate_sequence(),
            status,
            started_at,
            completed_at: Some(now),
            updated_at: now,
            payload,
        };
        self.items.insert(id, item.clone());
        AgentEvent::ItemCompleted { item }
    }

    fn allocate_sequence(&mut self) -> i64 {
        self.next_sequence += 1;
        self.next_sequence
    }
}

// tool_stream combines a stream of ServerNotifications with a future representing the
// final result of the tool call. MCP notifications are not request-scoped, but
// this lets us capture all notifications emitted during the tool call for
// simpler consumption
pub fn tool_stream<S, F>(rx: S, done: F) -> ToolStream
where
    S: Stream<Item = ServerNotification> + Send + Unpin + 'static,
    F: Future<Output = ToolResult<CallToolResult>> + Send + 'static,
{
    Box::pin(async_stream::stream! {
        tokio::pin!(done);
        let mut rx = rx;

        loop {
            tokio::select! {
                Some(msg) = rx.next() => {
                    yield ToolStreamItem::Message(msg);
                }
                r = &mut done => {
                    yield ToolStreamItem::Result(r);
                    break;
                }
            }
        }
    })
}

impl Agent {
    pub fn new() -> Self {
        // Create channels with buffer size 32 (adjust if needed)
        let (confirm_tx, confirm_rx) = mpsc::channel(32);
        let (tool_tx, tool_rx) = mpsc::channel(32);
        let provider = Arc::new(Mutex::new(None));
        let extension_manager = Arc::new(ExtensionManager::new(provider.clone()));

        // Initialize ToolRegistry with all native tools (Requirements: 11.3, 11.4)
        let mut tool_registry = ToolRegistry::new();
        let tool_config = ToolRegistrationConfig::new()
            .with_ask_callback(default_ask_callback())
            .with_extension_manager(Arc::downgrade(&extension_manager));
        let (file_read_history, _hook_manager) =
            register_all_tools(&mut tool_registry, tool_config);

        Self {
            provider: provider.clone(),
            extension_manager,
            session_type_hint: RwLock::new(None),
            sub_recipes: Mutex::new(HashMap::new()),
            session_output_schema: Arc::new(Mutex::new(None)),
            final_output_tool: Arc::new(Mutex::new(None)),
            frontend_tools: Mutex::new(HashMap::new()),
            frontend_instructions: Mutex::new(None),
            prompt_manager: Mutex::new(PromptManager::new()),
            confirmation_tx: confirm_tx,
            confirmation_rx: Mutex::new(confirm_rx),
            tool_result_tx: tool_tx,
            tool_result_rx: Arc::new(Mutex::new(tool_rx)),
            scheduler_service: Mutex::new(None),
            retry_manager: RetryManager::new(),
            tool_inspection_manager: Self::create_default_tool_inspection_manager(),
            tool_registry: Arc::new(RwLock::new(tool_registry)),
            file_read_history,
            session_store: None, // 默认使用全局 SessionManager
            thread_runtime_store: Arc::new(InMemoryThreadRuntimeStore::default()),
            agent_control_tools: None,
        }
    }

    pub fn new_with_required_shared_thread_runtime_store() -> Result<Self> {
        Ok(Self::new().with_thread_runtime_store(require_shared_thread_runtime_store()?))
    }

    /// 设置自定义 session 存储
    ///
    /// 允许应用层注入自己的存储实现，而不是使用默认的 SQLite 存储。
    /// 如果设置为 None，会回退到全局 SessionManager。
    ///
    /// # Example
    /// ```ignore
    /// let store = Arc::new(MyCustomStore::new());
    /// let agent = Agent::new().with_session_store(store);
    /// ```
    pub fn with_session_store(mut self, store: Arc<dyn SessionStore>) -> Self {
        self.session_store = Some(store);
        self
    }

    /// 获取当前的 session 存储引用
    pub fn session_store(&self) -> Option<&Arc<dyn SessionStore>> {
        self.session_store.as_ref()
    }

    pub fn with_thread_runtime_store(mut self, store: Arc<dyn ThreadRuntimeStore>) -> Self {
        self.thread_runtime_store = store;
        self
    }

    /// 设置 Agent 身份配置（Builder 模式）
    ///
    /// 允许应用层完全控制 Agent 的身份，包括名称、语言、描述等。
    /// 这会替换默认的 "aster by Block" 身份。
    ///
    /// 注意：此方法使用 try_lock，如果锁被占用会静默失败。
    /// 建议在 Agent 创建后立即调用，或使用异步版本 `set_identity()`。
    ///
    /// # Example
    /// ```ignore
    /// use aster::agents::{Agent, AgentIdentity};
    ///
    /// let identity = AgentIdentity::new("ProxyCast 助手")
    ///     .with_language("Chinese")
    ///     .with_description("一个专业的 AI 代理服务助手");
    ///
    /// let agent = Agent::new().with_identity(identity);
    /// ```
    pub fn with_identity(self, identity: super::identity::AgentIdentity) -> Self {
        // 使用 try_lock 避免在异步运行时中阻塞
        if let Ok(mut pm) = self.prompt_manager.try_lock() {
            pm.set_identity(identity);
        } else {
            // 如果锁被占用，记录警告
            tracing::warn!("[Agent] with_identity: 无法获取锁，身份设置被跳过");
        }
        self
    }

    /// 设置 Agent 身份（异步方法）
    ///
    /// 用于在 Agent 创建后动态修改身份配置。
    /// 这是在异步上下文中设置身份的推荐方式。
    pub async fn set_identity(&self, identity: super::identity::AgentIdentity) {
        let mut pm = self.prompt_manager.lock().await;
        pm.set_identity(identity);
    }

    /// Create a new Agent with custom tool registration configuration
    ///
    /// This allows customizing which tools are registered and their configuration.
    ///
    /// # Arguments
    /// * `config` - Configuration for tool registration
    ///
    /// Requirements: 11.3, 11.4
    pub fn with_tool_config(config: ToolRegistrationConfig) -> Self {
        let (confirm_tx, confirm_rx) = mpsc::channel(32);
        let (tool_tx, tool_rx) = mpsc::channel(32);
        let provider = Arc::new(Mutex::new(None));
        let extension_manager = Arc::new(ExtensionManager::new(provider.clone()));
        let mut config = config;
        let agent_control_tools = config.agent_control_tools.clone();
        let scheduler = config.scheduler.clone();
        if config.ask_callback.is_none() {
            config.ask_callback = Some(default_ask_callback());
        }
        config = config.with_extension_manager(Arc::downgrade(&extension_manager));

        // Initialize ToolRegistry with configured tools
        let mut tool_registry = ToolRegistry::new();
        let (file_read_history, _hook_manager) =
            crate::tools::register_all_tools(&mut tool_registry, config);
        if let Some(scheduler) = scheduler.as_ref() {
            tool_registry.register(Box::new(CronCreateTool::new(scheduler.clone())));
            tool_registry.register(Box::new(CronListTool::new(scheduler.clone())));
            tool_registry.register(Box::new(CronDeleteTool::new(scheduler.clone())));
        }

        Self {
            provider: provider.clone(),
            extension_manager,
            session_type_hint: RwLock::new(None),
            sub_recipes: Mutex::new(HashMap::new()),
            session_output_schema: Arc::new(Mutex::new(None)),
            final_output_tool: Arc::new(Mutex::new(None)),
            frontend_tools: Mutex::new(HashMap::new()),
            frontend_instructions: Mutex::new(None),
            prompt_manager: Mutex::new(PromptManager::new()),
            confirmation_tx: confirm_tx,
            confirmation_rx: Mutex::new(confirm_rx),
            tool_result_tx: tool_tx,
            tool_result_rx: Arc::new(Mutex::new(tool_rx)),
            scheduler_service: Mutex::new(scheduler),
            retry_manager: RetryManager::new(),
            tool_inspection_manager: Self::create_default_tool_inspection_manager(),
            tool_registry: Arc::new(RwLock::new(tool_registry)),
            file_read_history,
            session_store: None,
            thread_runtime_store: Arc::new(InMemoryThreadRuntimeStore::default()),
            agent_control_tools,
        }
    }

    async fn try_dispatch_callback_backed_agent_tool(
        &self,
        arguments: Value,
        session: &Session,
    ) -> Option<Result<ToolCallResult, ErrorData>> {
        let callbacks = self.agent_control_tools.as_ref()?;
        let spawn_callback = callbacks.spawn_agent.clone()?;

        let request = match parse_current_agent_tool_request(arguments) {
            Ok(request) => request,
            Err(error) => return Some(Err(error)),
        };
        let prepared = match prepare_callback_backed_agent_spawn(request, session) {
            Ok(Some(prepared)) => prepared,
            Ok(None) => return None,
            Err(error) => return Some(Err(error)),
        };
        let CallbackBackedAgentSpawn {
            request,
            spawn_request,
            description,
            prompt,
        } = prepared;

        Some(
            spawn_callback(spawn_request)
                .await
                .map(|response| {
                    ToolCallResult::from(Ok(build_async_agent_call_result(
                        &request,
                        &response,
                        description,
                        prompt,
                    )))
                })
                .map_err(|error| ErrorData::new(ErrorCode::INTERNAL_ERROR, error, None)),
        )
    }

    /// Get a reference to the tool registry
    ///
    /// Requirements: 11.3
    pub fn tool_registry(&self) -> &Arc<RwLock<ToolRegistry>> {
        &self.tool_registry
    }

    /// Get a reference to the shared file read history
    ///
    /// This is useful for tools that need to track file reads.
    pub fn file_read_history(&self) -> &SharedFileReadHistory {
        &self.file_read_history
    }

    /// Register an MCP tool with the registry
    ///
    /// This method allows registering MCP tools from extensions into the
    /// native tool registry. Native tools have priority over MCP tools
    /// with the same name.
    ///
    /// # Arguments
    /// * `name` - The tool name
    /// * `description` - Tool description
    /// * `input_schema` - JSON schema for tool input
    /// * `server_name` - Name of the MCP server providing this tool
    ///
    /// Requirements: 11.4, 11.5
    pub async fn register_mcp_tool(
        &self,
        name: String,
        description: String,
        input_schema: serde_json::Value,
        server_name: String,
    ) {
        let wrapper =
            crate::tools::McpToolWrapper::new(name.clone(), description, input_schema, server_name);
        let mut registry = self.tool_registry.write().await;
        registry.register_mcp(name, wrapper);
    }

    /// Create a tool inspection manager with default inspectors
    fn create_default_tool_inspection_manager() -> ToolInspectionManager {
        let mut tool_inspection_manager = ToolInspectionManager::new();

        // Add security inspector (highest priority - runs first)
        tool_inspection_manager.add_inspector(Box::new(SecurityInspector::new()));

        // Add permission inspector (medium-high priority)
        // Note: mode will be updated dynamically based on session config
        tool_inspection_manager.add_inspector(Box::new(PermissionInspector::new(
            AsterMode::SmartApprove,
            std::collections::HashSet::new(), // readonly tools - will be populated from extension manager
            std::collections::HashSet::new(), // regular tools - will be populated from extension manager
        )));

        // Add repetition inspector (lower priority - basic repetition checking)
        tool_inspection_manager.add_inspector(Box::new(RepetitionInspector::new(None)));

        tool_inspection_manager
    }

    // ========== Session 存储辅助方法 ==========
    // 这些方法会优先使用注入的 session_store，如果没有则回退到全局 SessionManager

    /// 添加消息到 session
    pub(crate) async fn store_add_message(
        &self,
        session_id: &str,
        message: &Message,
    ) -> Result<()> {
        if let Some(store) = &self.session_store {
            store.add_message(session_id, message).await
        } else {
            SessionManager::add_message(session_id, message).await
        }
    }

    /// 获取 session
    pub(crate) async fn store_get_session(
        &self,
        session_id: &str,
        include_messages: bool,
    ) -> Result<Session> {
        if let Some(store) = &self.session_store {
            store.get_session(session_id, include_messages).await
        } else {
            SessionManager::get_session(session_id, include_messages).await
        }
    }

    /// 替换整个对话历史
    pub(crate) async fn store_replace_conversation(
        &self,
        session_id: &str,
        conversation: &Conversation,
    ) -> Result<()> {
        if let Some(store) = &self.session_store {
            store.replace_conversation(session_id, conversation).await
        } else {
            SessionManager::replace_conversation(session_id, conversation).await
        }
    }

    /// 更新 session 扩展数据
    async fn store_update_extension_data(
        &self,
        session_id: &str,
        extension_data: crate::session::ExtensionData,
    ) -> Result<()> {
        if let Some(store) = &self.session_store {
            store
                .update_extension_data(session_id, extension_data)
                .await
        } else {
            SessionManager::update_session(session_id)
                .extension_data(extension_data)
                .apply()
                .await
        }
    }

    /// 更新 session 的 provider 和 model 配置
    async fn store_update_provider_config(
        &self,
        session_id: &str,
        provider_name: String,
        model_config: crate::model::ModelConfig,
    ) -> Result<()> {
        if let Some(store) = &self.session_store {
            store
                .update_provider_config(session_id, Some(provider_name), Some(model_config))
                .await
        } else {
            SessionManager::update_session(session_id)
                .provider_name(provider_name)
                .model_config(model_config)
                .apply()
                .await
        }
    }

    fn scope_reply_stream<'a>(
        session_config: &SessionConfig,
        stream: BoxStream<'a, Result<AgentEvent>>,
    ) -> BoxStream<'a, Result<AgentEvent>> {
        let scope = session_config.runtime_scope();
        Box::pin(crate::session_context::scope_stream(
            scope,
            session_config.turn_context.clone(),
            stream,
        ))
    }

    async fn ensure_thread_runtime(
        &self,
        session: &Session,
        session_config: &SessionConfig,
    ) -> Result<()> {
        let thread_id = session_config.resolved_thread_id().to_string();

        let existing = self.thread_runtime_store.get_thread(&thread_id).await?;
        let thread = existing.unwrap_or_else(|| {
            ThreadRuntime::new(thread_id, session.id.clone(), session.working_dir.clone())
        });
        self.thread_runtime_store.upsert_thread(thread).await?;
        Ok(())
    }

    async fn create_turn_runtime(
        &self,
        session: &Session,
        session_config: &SessionConfig,
        input_text: Option<String>,
    ) -> Result<TurnRuntime> {
        self.create_turn_runtime_for_session_id(&session.id, session_config, input_text)
            .await
    }

    async fn create_turn_runtime_for_session_id(
        &self,
        session_id: &str,
        session_config: &SessionConfig,
        input_text: Option<String>,
    ) -> Result<TurnRuntime> {
        let turn_id = session_config
            .turn_id
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow!("Missing turn id after session normalization"))?;
        if let Some(mut existing) = self.thread_runtime_store.get_turn(&turn_id).await? {
            let mut changed = false;

            if existing.input_text.is_none() && input_text.is_some() {
                existing.input_text = input_text;
                changed = true;
            }
            if existing.context_override.is_none() && session_config.turn_context.is_some() {
                existing.context_override = session_config.turn_context.clone();
                changed = true;
            }
            if existing.output_schema_runtime.is_none() {
                let output_schema_runtime = self
                    .resolve_turn_output_schema_runtime(session_config.turn_context.as_ref())
                    .await;
                if output_schema_runtime.is_some() {
                    existing.output_schema_runtime = output_schema_runtime;
                    changed = true;
                }
            }

            if changed {
                existing.updated_at = Utc::now();
                return self.thread_runtime_store.update_turn(existing).await;
            }

            return Ok(existing);
        }

        let thread_id = session_config.resolved_thread_id().to_string();
        let turn = TurnRuntime::new(
            turn_id,
            session_id.to_string(),
            thread_id,
            input_text,
            session_config.turn_context.clone(),
        )
        .with_output_schema_runtime(
            self.resolve_turn_output_schema_runtime(session_config.turn_context.as_ref())
                .await,
        );
        let turn = self.thread_runtime_store.create_turn(turn).await?;
        Ok(turn)
    }

    async fn finalize_turn_runtime(
        &self,
        session_config: &SessionConfig,
        status: TurnStatus,
        error_message: Option<String>,
    ) -> Result<()> {
        let Some(turn_id) = session_config.turn_id.as_ref() else {
            return Ok(());
        };
        let Some(mut turn) = self.thread_runtime_store.get_turn(turn_id).await? else {
            return Ok(());
        };

        turn.status = status;
        turn.error_message = error_message;
        turn.completed_at = Some(chrono::Utc::now());
        self.thread_runtime_store.update_turn(turn).await?;
        Ok(())
    }

    async fn persist_item_runtime(&self, event: &AgentEvent) -> Result<()> {
        let Some(item) = (match event {
            AgentEvent::ItemStarted { item }
            | AgentEvent::ItemUpdated { item }
            | AgentEvent::ItemCompleted { item } => Some(item.clone()),
            _ => None,
        }) else {
            return Ok(());
        };

        let existing = self.thread_runtime_store.get_item(&item.id).await?;
        if existing.is_some() {
            self.thread_runtime_store.update_item(item).await?;
        } else {
            self.thread_runtime_store.create_item(item).await?;
        }
        Ok(())
    }

    async fn complete_runtime_request_item(
        &self,
        request_id: &str,
        response: Option<Value>,
    ) -> Result<()> {
        let Some(mut item) = self.thread_runtime_store.get_item(request_id).await? else {
            return Ok(());
        };

        item.status = ItemStatus::Completed;
        item.completed_at = Some(Utc::now());
        item.payload = match item.payload {
            ItemRuntimePayload::ApprovalRequest {
                request_id,
                action_type,
                prompt,
                tool_name,
                arguments,
                ..
            } => ItemRuntimePayload::ApprovalRequest {
                request_id,
                action_type,
                prompt,
                tool_name,
                arguments,
                response,
            },
            ItemRuntimePayload::RequestUserInput {
                request_id,
                action_type,
                prompt,
                requested_schema,
                ..
            } => ItemRuntimePayload::RequestUserInput {
                request_id,
                action_type,
                prompt,
                requested_schema,
                response,
            },
            payload => payload,
        };
        self.thread_runtime_store.update_item(item).await?;
        Ok(())
    }

    fn runtime_status_item_id(turn_id: &str) -> String {
        format!("turn_summary:{turn_id}")
    }

    fn context_compaction_item_id(turn_id: &str) -> String {
        format!("context_compaction:{turn_id}:{}", Uuid::new_v4())
    }

    fn estimated_compacted_turn_count(conversation: &Conversation) -> usize {
        conversation
            .messages()
            .iter()
            .filter(|message| message.is_agent_visible() && message.role == Role::User)
            .count()
    }

    pub(crate) async fn perform_context_compaction(
        &self,
        session_config: &SessionConfig,
        conversation: &Conversation,
        manual_compact: bool,
    ) -> Result<ContextCompactionResult> {
        let (compacted_conversation, summarization_usage, summary_text) =
            compact_messages_with_summary(
                self.provider().await?.as_ref(),
                conversation,
                manual_compact,
            )
            .await?;

        self.store_replace_conversation(&session_config.id, &compacted_conversation)
            .await?;
        Self::update_session_metrics(
            session_config,
            &summarization_usage,
            true,
            self.session_store.as_ref(),
        )
        .await?;

        let turn_count = Self::estimated_compacted_turn_count(conversation);
        if let Err(error) = save_summary(&session_config.id, &summary_text, Some(turn_count)) {
            warn!(
                session_id = %session_config.id,
                ?error,
                "Failed to persist compacted summary cache"
            );
        }

        Ok(ContextCompactionResult {
            compacted_conversation,
        })
    }

    pub async fn compact_session(
        &self,
        session_config: SessionConfig,
    ) -> Result<BoxStream<'_, Result<AgentEvent>>> {
        let session_config = session_config.with_runtime_defaults();
        let session = self.store_get_session(&session_config.id, true).await?;
        self.remember_session_type_hint(session.session_type).await;
        let conversation = session
            .conversation
            .clone()
            .ok_or_else(|| anyhow!("Session {} has no conversation", session_config.id))?;
        let scoped_session_config = session_config.clone();
        let turn_session_config = session_config.clone();
        let turn_session = session.clone();

        Ok(Self::scope_reply_stream(
            &session_config,
            Box::pin(async_stream::try_stream! {
                self.ensure_thread_runtime(&turn_session, &turn_session_config).await?;
                let turn_runtime = self
                    .create_turn_runtime(&turn_session, &turn_session_config, None)
                    .await?;
                let item_id = Self::context_compaction_item_id(&turn_runtime.id);

                yield AgentEvent::TurnStarted {
                    turn: turn_runtime,
                };
                yield AgentEvent::ContextCompactionStarted {
                    item_id: item_id.clone(),
                    trigger: ContextCompactionTrigger::Manual.as_str().to_string(),
                    detail: Some(ContextCompactionTrigger::Manual.started_detail().to_string()),
                };

                match self
                    .perform_context_compaction(&scoped_session_config, &conversation, true)
                    .await
                {
                    Ok(result) => {
                        yield AgentEvent::HistoryReplaced(result.compacted_conversation);
                        yield AgentEvent::ContextCompactionCompleted {
                            item_id,
                            trigger: ContextCompactionTrigger::Manual.as_str().to_string(),
                            detail: Some(
                                ContextCompactionTrigger::Manual
                                    .completed_detail()
                                    .to_string(),
                            ),
                        };
                        yield AgentEvent::ContextCompactionWarning {
                            message: CONTEXT_COMPACTION_WARNING_TEXT.to_string(),
                        };
                        self.finalize_turn_runtime(
                            &scoped_session_config,
                            TurnStatus::Completed,
                            None,
                        )
                        .await?;
                    }
                    Err(error) => {
                        self.finalize_turn_runtime(
                            &scoped_session_config,
                            TurnStatus::Failed,
                            Some(error.to_string()),
                        )
                        .await?;
                        Err(error)?;
                    }
                }
            }),
        ))
    }

    pub async fn ensure_runtime_turn_initialized(
        &self,
        session_config: &SessionConfig,
        input_text: Option<String>,
    ) -> Result<TurnRuntime> {
        let session_config = session_config.clone().with_runtime_defaults();
        let thread_id = session_config.resolved_thread_id().to_string();

        if self
            .thread_runtime_store
            .get_thread(&thread_id)
            .await?
            .is_some()
        {
            return self
                .create_turn_runtime_for_session_id(&session_config.id, &session_config, input_text)
                .await;
        }

        let session = self.store_get_session(&session_config.id, false).await?;
        self.remember_session_type_hint(session.session_type).await;
        self.ensure_thread_runtime(&session, &session_config)
            .await?;
        self.create_turn_runtime(&session, &session_config, input_text)
            .await
    }

    pub async fn upsert_runtime_status_item(
        &self,
        session_config: &SessionConfig,
        phase: impl Into<String>,
        title: impl Into<String>,
        detail: impl Into<String>,
        checkpoints: Vec<String>,
    ) -> Result<AgentEvent> {
        let turn = self
            .ensure_runtime_turn_initialized(session_config, None)
            .await?;
        let item_id = Self::runtime_status_item_id(&turn.id);
        let payload = ItemRuntimePayload::RuntimeStatus {
            phase: phase.into(),
            title: title.into(),
            detail: detail.into(),
            checkpoints,
        };
        let now = Utc::now();

        if let Some(mut existing) = self.thread_runtime_store.get_item(&item_id).await? {
            existing.status = ItemStatus::InProgress;
            existing.completed_at = None;
            existing.updated_at = now;
            existing.payload = payload;
            let item = self.thread_runtime_store.update_item(existing).await?;
            return Ok(AgentEvent::ItemUpdated { item });
        }

        let next_sequence = self
            .thread_runtime_store
            .list_items(&turn.thread_id)
            .await?
            .into_iter()
            .map(|item| item.sequence)
            .max()
            .unwrap_or(0)
            + 1;
        let item = ItemRuntime {
            id: item_id,
            thread_id: turn.thread_id,
            turn_id: turn.id,
            sequence: next_sequence,
            status: ItemStatus::InProgress,
            started_at: now,
            completed_at: None,
            updated_at: now,
            payload,
        };
        let item = self.thread_runtime_store.create_item(item).await?;
        Ok(AgentEvent::ItemStarted { item })
    }

    pub async fn complete_runtime_status_item(
        &self,
        session_config: &SessionConfig,
    ) -> Result<Option<AgentEvent>> {
        let session_config = session_config.clone().with_runtime_defaults();
        let Some(turn_id) = session_config.turn_id.as_ref() else {
            return Ok(None);
        };
        let item_id = Self::runtime_status_item_id(turn_id);
        let Some(mut item) = self.thread_runtime_store.get_item(&item_id).await? else {
            return Ok(None);
        };

        if item.status == ItemStatus::Completed {
            return Ok(None);
        }

        let now = Utc::now();
        item.status = ItemStatus::Completed;
        item.completed_at = Some(now);
        item.updated_at = now;
        let item = self.thread_runtime_store.update_item(item).await?;
        Ok(Some(AgentEvent::ItemCompleted { item }))
    }

    pub async fn runtime_snapshot(&self, session_id: &str) -> Result<SessionRuntimeSnapshot> {
        load_session_runtime_snapshot(self.thread_runtime_store.as_ref(), session_id).await
    }

    // ========== End Session 存储辅助方法 ==========

    /// Reset the retry attempts counter to 0
    pub async fn reset_retry_attempts(&self) {
        self.retry_manager.reset_attempts().await;
    }

    /// Increment the retry attempts counter and return the new value
    pub async fn increment_retry_attempts(&self) -> u32 {
        self.retry_manager.increment_attempts().await
    }

    /// Get the current retry attempts count
    pub async fn get_retry_attempts(&self) -> u32 {
        self.retry_manager.get_attempts().await
    }

    async fn handle_retry_logic(
        &self,
        messages: &mut Conversation,
        session_config: &SessionConfig,
        initial_messages: &[Message],
    ) -> Result<bool> {
        let result = self
            .retry_manager
            .handle_retry_logic(
                messages,
                session_config,
                initial_messages,
                &self.final_output_tool,
            )
            .await?;

        match result {
            RetryResult::Retried => Ok(true),
            RetryResult::Skipped
            | RetryResult::MaxAttemptsReached
            | RetryResult::SuccessChecksPassed => Ok(false),
        }
    }

    /// 排空 elicitation 消息队列并保存到 session
    async fn drain_elicitation_messages(&self, session_config: &SessionConfig) -> Vec<Message> {
        let mut messages = Vec::new();
        let scope = session_config.runtime_scope();
        for elicitation_message in ActionRequiredManager::global()
            .drain_messages_for_scope(&scope)
            .await
        {
            if let Err(e) = self
                .store_add_message(&session_config.id, &elicitation_message)
                .await
            {
                warn!("Failed to save elicitation message to session: {}", e);
            }
            messages.push(elicitation_message);
        }
        messages
    }

    async fn drain_user_messages(&self, session_config: &SessionConfig) -> Vec<Message> {
        let mut messages = Vec::new();
        let scope = session_config.runtime_scope();
        for user_message in UserMessageManager::global()
            .drain_messages_for_scope(&scope)
            .await
        {
            if let Err(error) = self
                .store_add_message(&session_config.id, &user_message)
                .await
            {
                warn!("Failed to save user message to session: {}", error);
            }
            messages.push(user_message);
        }
        messages
    }

    async fn prepare_reply_context(
        &self,
        unfixed_conversation: Conversation,
        working_dir: &std::path::Path,
        session_config: &SessionConfig,
        include_context_trace: bool,
    ) -> Result<ReplyContext> {
        let mut context_trace = Vec::new();
        let mut push_trace = |stage: &str, detail: String| {
            if include_context_trace {
                context_trace.push(ContextTraceStep {
                    stage: stage.to_string(),
                    detail,
                });
            }
        };

        push_trace("session", format!("session_id={}", session_config.id));
        push_trace(
            "conversation_input",
            format!("messages={}", unfixed_conversation.len()),
        );

        let unfixed_messages = unfixed_conversation.messages().clone();
        let (conversation, issues) = fix_conversation(unfixed_conversation.clone());
        push_trace(
            "conversation_fixed",
            format!("messages={}, issues={}", conversation.len(), issues.len()),
        );
        if !issues.is_empty() {
            debug!(
                "Conversation issue fixed: {}",
                debug_conversation_fix(
                    unfixed_messages.as_slice(),
                    conversation.messages(),
                    &issues
                )
            );
        }
        let initial_messages = conversation.messages().clone();
        let config = Config::global();

        let session_prompt = session_config.system_prompt.as_deref();
        let model_config = self
            .resolve_effective_model_config(session_config.turn_context.as_ref())
            .await
            .ok_or_else(|| anyhow!("Provider not set"))?;
        let (tools, toolshim_tools, system_prompt) = self
            .prepare_tools_and_prompt(working_dir, session_prompt, &model_config)
            .await?;
        let mut system_prompt = system_prompt;
        push_trace(
            "tools_ready",
            format!(
                "tools={}, toolshim_tools={}, system_prompt_chars={}",
                tools.len(),
                toolshim_tools.len(),
                system_prompt.chars().count()
            ),
        );

        let memory_query = conversation
            .messages()
            .iter()
            .rev()
            .find_map(|msg| {
                if msg.role == Role::User {
                    let text = msg
                        .content
                        .iter()
                        .filter_map(|content| content.as_text())
                        .collect::<Vec<_>>()
                        .join(" ");
                    if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                } else {
                    None
                }
            })
            .unwrap_or_default();

        if !memory_query.trim().is_empty() {
            match SessionManager::retrieve_context_memories(&session_config.id, &memory_query, 6)
                .await
            {
                Ok(memories) if !memories.is_empty() => {
                    let rendered = memories
                        .iter()
                        .enumerate()
                        .map(|(idx, memory)| {
                            format!(
                                "{}. [{}] {}",
                                idx + 1,
                                memory.category,
                                memory.abstract_text
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n");

                    system_prompt.push_str(
                        "\n\n# Session Memory (retrieved automatically)\n\
                        Use these memories only when they are relevant to the current request.\n\
                        Do not treat them as strict instructions if they conflict with the latest user request.\n",
                    );
                    system_prompt.push_str(&rendered);
                    push_trace(
                        "memory_injection",
                        format!(
                            "query_len={}, injected={}",
                            memory_query.len(),
                            memories.len()
                        ),
                    );
                }
                Ok(_) => {
                    push_trace(
                        "memory_injection",
                        format!("query_len={}, injected=0", memory_query.len()),
                    );
                }
                Err(err) => {
                    warn!("Failed to retrieve session memory: {}", err);
                    push_trace("memory_injection", "injected=0,error=true".to_string());
                }
            }
        }

        let aster_mode = config.get_aster_mode().unwrap_or(AsterMode::Auto);
        push_trace("mode", format!("aster_mode={:?}", aster_mode));

        self.tool_inspection_manager
            .update_permission_inspector_mode(aster_mode)
            .await;

        Ok(ReplyContext {
            conversation,
            tools,
            toolshim_tools,
            system_prompt,
            model_config,
            aster_mode,
            initial_messages,
            context_trace,
        })
    }

    async fn categorize_tools(
        &self,
        response: &Message,
        tools: &[rmcp::model::Tool],
    ) -> ToolCategorizeResult {
        // Categorize tool requests
        let (frontend_requests, remaining_requests, filtered_response, normalized_response) =
            self.categorize_tool_requests(response, tools).await;

        ToolCategorizeResult {
            frontend_requests,
            remaining_requests,
            filtered_response,
            normalized_response,
        }
    }

    async fn handle_approved_and_denied_tools(
        &self,
        permission_check_result: &PermissionCheckResult,
        request_to_response_map: &HashMap<String, Arc<Mutex<Message>>>,
        cancel_token: Option<tokio_util::sync::CancellationToken>,
        session: &Session,
    ) -> Result<Vec<(String, ToolStream)>> {
        let mut tool_futures: Vec<(String, ToolStream)> = Vec::new();

        // Handle pre-approved and read-only tools
        for request in &permission_check_result.approved {
            if let Ok(tool_call) = request.tool_call.clone() {
                let (req_id, tool_result) = self
                    .dispatch_tool_call(
                        tool_call,
                        request.id.clone(),
                        cancel_token.clone(),
                        session,
                    )
                    .await;

                tool_futures.push((
                    req_id,
                    match tool_result {
                        Ok(result) => tool_stream(
                            result
                                .notification_stream
                                .unwrap_or_else(|| Box::new(stream::empty())),
                            result.result,
                        ),
                        Err(e) => {
                            tool_stream(Box::new(stream::empty()), futures::future::ready(Err(e)))
                        }
                    },
                ));
            }
        }

        Self::handle_denied_tools(permission_check_result, request_to_response_map).await;
        Ok(tool_futures)
    }

    async fn handle_denied_tools(
        permission_check_result: &PermissionCheckResult,
        request_to_response_map: &HashMap<String, Arc<Mutex<Message>>>,
    ) {
        for request in &permission_check_result.denied {
            if let Some(response_msg) = request_to_response_map.get(&request.id) {
                let mut response = response_msg.lock().await;
                *response = response.clone().with_tool_response_with_metadata(
                    request.id.clone(),
                    Ok(CallToolResult {
                        content: vec![rmcp::model::Content::text(DECLINED_RESPONSE)],
                        structured_content: None,
                        is_error: Some(true),
                        meta: None,
                    }),
                    request.metadata.as_ref(),
                );
            }
        }
    }

    pub async fn set_scheduler(&self, scheduler: Arc<dyn SchedulerTrait>) {
        {
            let mut scheduler_service = self.scheduler_service.lock().await;
            *scheduler_service = Some(scheduler.clone());
        }

        let mut registry = self.tool_registry.write().await;
        registry.register(Box::new(CronCreateTool::new(scheduler.clone())));
        registry.register(Box::new(CronListTool::new(scheduler.clone())));
        registry.register(Box::new(CronDeleteTool::new(scheduler)));
    }

    /// Get a reference count clone to the provider
    pub async fn provider(&self) -> Result<Arc<dyn Provider>, anyhow::Error> {
        match &*self.provider.lock().await {
            Some(provider) => Ok(Arc::clone(provider)),
            None => Err(anyhow!("Provider not set")),
        }
    }

    /// Check if a tool is a frontend tool
    pub async fn is_frontend_tool(&self, name: &str) -> bool {
        self.frontend_tools.lock().await.contains_key(name)
    }

    /// Get a reference to a frontend tool
    pub async fn get_frontend_tool(&self, name: &str) -> Option<FrontendTool> {
        self.frontend_tools.lock().await.get(name).cloned()
    }

    pub async fn add_final_output_tool(&self, output_schema: Value) -> Result<()> {
        let mut final_output_tool = self.final_output_tool.lock().await;
        *final_output_tool = Some(
            FinalOutputTool::new(output_schema)
                .map_err(|error| anyhow!("Failed to configure final output tool: {error}"))?,
        );
        Ok(())
    }

    pub async fn clear_final_output_tool(&self) {
        let mut final_output_tool = self.final_output_tool.lock().await;
        *final_output_tool = None;
    }

    pub async fn set_session_output_schema(&self, output_schema: Option<Value>) -> Result<()> {
        if let Some(schema) = output_schema.as_ref() {
            FinalOutputTool::validate_output_schema(schema)
                .map_err(|error| anyhow!("Invalid session output schema: {error}"))?;
        }

        let mut session_output_schema = self.session_output_schema.lock().await;
        *session_output_schema = output_schema;
        Ok(())
    }

    async fn resolve_effective_output_schema(
        &self,
        turn_context: Option<&TurnContextOverride>,
    ) -> Option<ResolvedOutputSchema> {
        if let Some(context) = turn_context {
            if let Some(output_schema) = context.output_schema.clone() {
                return Some(ResolvedOutputSchema {
                    schema: output_schema,
                    source: context
                        .output_schema_source
                        .unwrap_or(TurnOutputSchemaSource::Turn),
                });
            }
        }

        self.session_output_schema
            .lock()
            .await
            .clone()
            .map(|schema| ResolvedOutputSchema {
                schema,
                source: TurnOutputSchemaSource::Session,
            })
    }

    async fn resolve_effective_model_config(
        &self,
        turn_context: Option<&TurnContextOverride>,
    ) -> Option<ModelConfig> {
        let provider = self.provider.lock().await.as_ref()?.clone();
        let mut model_config = provider.get_model_config();
        if let Some(model) = turn_context
            .and_then(|context| context.model.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            model_config = match model_config.rebuild_with_model_name(model) {
                Ok(rebuilt) => rebuilt,
                Err(error) => {
                    warn!(
                        "Failed to rebuild model config for turn model override '{}': {}",
                        model, error
                    );
                    model_config.with_model_name(model.to_string())
                }
            };
        }
        Some(model_config)
    }

    async fn provider_supports_native_output_schema(&self, model_config: &ModelConfig) -> bool {
        self.provider
            .lock()
            .await
            .as_ref()
            .map(|provider| provider.supports_native_output_schema_with_model(model_config))
            .unwrap_or(false)
    }

    fn merge_turn_context_output_schema(
        turn_context: Option<TurnContextOverride>,
        resolved_output_schema: Option<&ResolvedOutputSchema>,
    ) -> Option<TurnContextOverride> {
        match (turn_context, resolved_output_schema) {
            (Some(mut turn_context), Some(resolved_output_schema)) => {
                if turn_context.output_schema.is_none() {
                    turn_context.output_schema = Some(resolved_output_schema.schema.clone());
                }
                turn_context.output_schema_source = Some(resolved_output_schema.source);
                Some(turn_context)
            }
            (Some(turn_context), None) => Some(turn_context),
            (None, Some(resolved_output_schema)) => Some(TurnContextOverride {
                output_schema: Some(resolved_output_schema.schema.clone()),
                output_schema_source: Some(resolved_output_schema.source),
                ..TurnContextOverride::default()
            }),
            (None, None) => None,
        }
    }

    async fn resolve_turn_output_schema_runtime(
        &self,
        turn_context: Option<&TurnContextOverride>,
    ) -> Option<TurnOutputSchemaRuntime> {
        turn_context.and_then(|context| context.output_schema.as_ref())?;

        let model_config = self.resolve_effective_model_config(turn_context).await;
        let uses_final_output_tool = self.final_output_tool.lock().await.is_some();
        let strategy = if uses_final_output_tool {
            TurnOutputSchemaStrategy::FinalOutputTool
        } else if let Some(model_config) = model_config.as_ref() {
            if self
                .provider_supports_native_output_schema(model_config)
                .await
            {
                TurnOutputSchemaStrategy::Native
            } else {
                TurnOutputSchemaStrategy::FinalOutputTool
            }
        } else {
            TurnOutputSchemaStrategy::FinalOutputTool
        };
        let provider_name = self
            .provider
            .lock()
            .await
            .as_ref()
            .map(|provider| provider.get_name().to_string());

        Some(TurnOutputSchemaRuntime {
            source: turn_context
                .and_then(|context| context.output_schema_source)
                .unwrap_or(TurnOutputSchemaSource::Turn),
            strategy,
            provider_name,
            model_name: model_config.map(|config| config.model_name),
        })
    }

    async fn prepare_session_config_for_reply(
        &self,
        session_config: SessionConfig,
    ) -> Result<SessionConfig> {
        let mut session_config = session_config.with_runtime_defaults();
        let effective_output_schema = self
            .resolve_effective_output_schema(session_config.turn_context.as_ref())
            .await;

        session_config.turn_context = Self::merge_turn_context_output_schema(
            session_config.turn_context.take(),
            effective_output_schema.as_ref(),
        );

        if let Some(output_schema) = effective_output_schema {
            let use_native_output_schema = if let Some(model_config) = self
                .resolve_effective_model_config(session_config.turn_context.as_ref())
                .await
            {
                self.provider_supports_native_output_schema(&model_config)
                    .await
            } else {
                false
            };

            if use_native_output_schema {
                self.clear_final_output_tool().await;
            } else {
                self.add_final_output_tool(output_schema.schema).await?;
            }
        } else {
            self.clear_final_output_tool().await;
        }

        Ok(session_config)
    }

    pub async fn add_sub_recipes(&self, sub_recipes_to_add: Vec<SubRecipe>) {
        let mut sub_recipes = self.sub_recipes.lock().await;
        for sr in sub_recipes_to_add {
            sub_recipes.insert(sr.name.clone(), sr);
        }
    }

    pub async fn apply_recipe_components(
        &self,
        sub_recipes: Option<Vec<SubRecipe>>,
        response: Option<Response>,
        include_final_output: bool,
    ) -> Result<()> {
        if let Some(sub_recipes) = sub_recipes {
            self.add_sub_recipes(sub_recipes).await;
        }

        let output_schema = if include_final_output {
            response.and_then(|response| response.json_schema)
        } else {
            None
        };

        self.set_session_output_schema(output_schema).await?;
        Ok(())
    }

    /// Dispatch a single tool call to the appropriate client
    #[instrument(skip(self, tool_call, request_id), fields(input, output))]
    pub async fn dispatch_tool_call(
        &self,
        tool_call: CallToolRequestParam,
        request_id: String,
        cancellation_token: Option<CancellationToken>,
        session: &Session,
    ) -> (String, Result<ToolCallResult, ErrorData>) {
        if tool_call.name == FINAL_OUTPUT_TOOL_NAME {
            return if let Some(final_output_tool) = self.final_output_tool.lock().await.as_mut() {
                let result = final_output_tool.execute_tool_call(tool_call.clone()).await;
                (request_id, Ok(result))
            } else {
                (
                    request_id,
                    Err(ErrorData::new(
                        ErrorCode::INTERNAL_ERROR,
                        "Structured output tool not defined".to_string(),
                        None,
                    )),
                )
            };
        }

        let needs_current_surface_session = tool_call.name == AGENT_TOOL_NAME
            && (session.session_type == SessionType::SubAgent
                || self.agent_control_tools.is_some());
        let latest_session = if needs_current_surface_session {
            self.store_get_session(&session.id, false).await.ok()
        } else {
            None
        };
        let effective_session = latest_session.as_ref().unwrap_or(session);

        if effective_session.session_type == SessionType::SubAgent
            && tool_call.name == AGENT_TOOL_NAME
        {
            // Only team subagents keep the current surface needed for synchronous nested subagents.
            // Plain delegated workers still must not recursively spawn more agents.
            if session_allows_subagent_teammate_tools(effective_session) {
                debug!(
                    session_id = %effective_session.id,
                    "Allowing Agent tool for team subagent current surface"
                );
            } else {
                return (
                    request_id,
                    Err(ErrorData::new(
                        ErrorCode::INVALID_REQUEST,
                        "Agents cannot create other agents".to_string(),
                        None,
                    )),
                );
            }
        }

        debug!("WAITING_TOOL_START: {}", tool_call.name);
        let result: ToolCallResult = if tool_call.name == AGENT_TOOL_NAME {
            let arguments = tool_call
                .arguments
                .clone()
                .map(Value::Object)
                .unwrap_or(Value::Object(serde_json::Map::new()));
            if let Some(callback_result) = self
                .try_dispatch_callback_backed_agent_tool(arguments.clone(), effective_session)
                .await
            {
                return (request_id, callback_result);
            }

            let provider = match self.provider().await {
                Ok(p) => p,
                Err(_) => {
                    return (
                        request_id,
                        Err(ErrorData::new(
                            ErrorCode::INTERNAL_ERROR,
                            "Provider is required".to_string(),
                            None,
                        )),
                    );
                }
            };

            let extensions = self.get_extension_configs().await;
            let task_config =
                TaskConfig::new(provider, &session.id, &session.working_dir, extensions);
            let sub_recipes = self.sub_recipes.lock().await.clone();

            handle_subagent_tool(
                arguments,
                task_config,
                sub_recipes,
                session.working_dir.clone(),
                cancellation_token,
            )
        } else if self.is_frontend_tool(&tool_call.name).await {
            // For frontend tools, return an error indicating we need frontend execution
            ToolCallResult::from(Err(ErrorData::new(
                ErrorCode::INTERNAL_ERROR,
                "Frontend tool execution required".to_string(),
                None,
            )))
        } else {
            // 优先检查 tool_registry 中的原生工具
            // 原生工具直接在进程内执行，不需要 MCP 子进程
            let is_native = self
                .tool_registry
                .read()
                .await
                .contains_native(&tool_call.name);

            if is_native {
                // 原生工具：直接通过 tool_registry 执行
                let tool_name = tool_call.name.clone();
                let params = tool_call
                    .arguments
                    .clone()
                    .map(Value::Object)
                    .unwrap_or(Value::Object(serde_json::Map::new()));
                let mut context =
                    crate::tools::context::ToolContext::new(session.working_dir.clone())
                        .with_session_id(session.id.clone());
                if let Ok(provider) = self.provider().await {
                    context = context.with_provider(provider);
                }
                if let Some(token) = cancellation_token.clone() {
                    context = context.with_cancellation_token(token);
                }

                let registry = self.tool_registry.read().await;
                let execute_result = registry.execute(&tool_name, params, &context, None).await;
                drop(registry);

                match execute_result {
                    Ok(result) => {
                        ToolCallResult::from(Ok(native_tool_result_to_call_tool_result(result)))
                    }
                    Err(e) => ToolCallResult::from(Err(ErrorData::new(
                        ErrorCode::INTERNAL_ERROR,
                        e.to_string(),
                        None,
                    ))),
                }
            } else {
                // MCP 工具：通过 extension_manager 分发
                let result = self
                    .extension_manager
                    .dispatch_tool_call(tool_call.clone(), cancellation_token.unwrap_or_default())
                    .await;
                result.unwrap_or_else(|e| {
                    crate::posthog::emit_error(
                        "tool_execution_failed",
                        &format!("{}: {}", tool_call.name, e),
                    );
                    ToolCallResult::from(Err(ErrorData::new(
                        ErrorCode::INTERNAL_ERROR,
                        e.to_string(),
                        None,
                    )))
                })
            }
        };

        debug!("WAITING_TOOL_END: {}", tool_call.name);

        (
            request_id,
            Ok(ToolCallResult {
                notification_stream: result.notification_stream,
                result: Box::new(
                    result
                        .result
                        .map(super::large_response_handler::process_tool_response),
                ),
            }),
        )
    }

    /// Save current extension state to session metadata
    /// Should be called after any extension add/remove operation
    pub async fn save_extension_state(&self, session: &SessionConfig) -> Result<()> {
        let extension_configs = self.extension_manager.get_extension_configs().await;

        let extensions_state = EnabledExtensionsState::new(extension_configs);

        let mut session_data = self.store_get_session(&session.id, false).await?;

        if let Err(e) = extensions_state.to_extension_data(&mut session_data.extension_data) {
            warn!("Failed to serialize extension state: {}", e);
            return Err(anyhow!("Extension state serialization failed: {}", e));
        }

        self.store_update_extension_data(&session.id, session_data.extension_data)
            .await?;

        Ok(())
    }

    pub async fn add_extension(&self, extension: ExtensionConfig) -> ExtensionResult<()> {
        match &extension {
            ExtensionConfig::Frontend {
                tools,
                instructions,
                ..
            } => {
                // For frontend tools, just store them in the frontend_tools map
                let mut frontend_tools = self.frontend_tools.lock().await;
                for tool in tools {
                    let frontend_tool = FrontendTool {
                        name: tool.name.to_string(),
                        tool: tool.clone(),
                    };
                    frontend_tools.insert(tool.name.to_string(), frontend_tool);
                }
                // Store instructions if provided, using "frontend" as the key
                let mut frontend_instructions = self.frontend_instructions.lock().await;
                if let Some(instructions) = instructions {
                    *frontend_instructions = Some(instructions.clone());
                } else {
                    // Default frontend instructions if none provided
                    *frontend_instructions = Some(
                        "The following tools are provided directly by the frontend and will be executed by the frontend when called.".to_string(),
                    );
                }
            }
            _ => {
                self.extension_manager
                    .add_extension(extension.clone())
                    .await?;
            }
        }

        Ok(())
    }

    pub async fn subagents_enabled(&self) -> bool {
        let session_type = self.current_session_type().await;
        self.subagents_enabled_for_session_type(session_type).await
    }

    async fn remember_session_type_hint(&self, session_type: SessionType) {
        let mut session_type_hint = self.session_type_hint.write().await;
        if session_type_hint.as_ref() == Some(&session_type) {
            return;
        }
        *session_type_hint = Some(session_type);
    }

    async fn session_type_hint(&self) -> Option<SessionType> {
        *self.session_type_hint.read().await
    }

    async fn current_session_type(&self) -> Option<SessionType> {
        if let Some(session_type) = self.session_type_hint().await {
            return Some(session_type);
        }

        let session_id = self.extension_manager.get_context().await.session_id?;
        let session_type = self
            .store_get_session(&session_id, false)
            .await
            .ok()
            .map(|session| session.session_type);
        if let Some(session_type) = session_type {
            self.remember_session_type_hint(session_type).await;
        }
        session_type
    }

    async fn subagents_enabled_for_session_type(&self, session_type: Option<SessionType>) -> bool {
        let config = crate::config::Config::global();
        let is_autonomous = config.get_aster_mode().unwrap_or(AsterMode::Auto) == AsterMode::Auto;
        if !is_autonomous {
            return false;
        }
        if self
            .provider()
            .await
            .map(|provider| provider.get_active_model_name().starts_with("gemini"))
            .unwrap_or(false)
        {
            return false;
        }
        if matches!(session_type, Some(SessionType::SubAgent)) {
            return false;
        }
        true
    }

    pub async fn list_tools(&self, extension_name: Option<String>) -> Vec<Tool> {
        let mut prefixed_tools = self
            .extension_manager
            .get_prefixed_tools(extension_name.clone())
            .await
            .unwrap_or_default();

        let hinted_session_type = self.session_type_hint().await;
        let current_session = match (
            self.extension_manager.get_context().await.session_id,
            hinted_session_type,
        ) {
            (Some(session_id), Some(SessionType::SubAgent)) | (Some(session_id), None) => {
                let current_session = self.store_get_session(&session_id, false).await.ok();
                if let Some(session) = current_session.as_ref() {
                    self.remember_session_type_hint(session.session_type).await;
                }
                current_session
            }
            _ => None,
        };
        let current_session_type = current_session
            .as_ref()
            .map(|session| session.session_type)
            .or(hinted_session_type);
        let subagent_teammate_tools_enabled = current_session
            .as_ref()
            .is_some_and(session_allows_subagent_teammate_tools);
        let subagents_enabled = self
            .subagents_enabled_for_session_type(current_session_type)
            .await;
        let resources_supported = self.extension_manager.supports_resources().await;
        let tool_gates = current_surface_tool_gates();

        if extension_name.is_none() {
            if let Some(final_output_tool) = self.final_output_tool.lock().await.as_ref() {
                prefixed_tools.push(final_output_tool.tool());
            }

            if subagents_enabled {
                let sub_recipes = self.sub_recipes.lock().await;
                let sub_recipes_vec: Vec<_> = sub_recipes.values().cloned().collect();
                prefixed_tools.push(create_subagent_tool(&sub_recipes_vec));
            }

            // 添加 tool_registry 中的原生工具（包括 SkillTool）
            let registry = self.tool_registry.read().await;
            for tool_def in registry.get_definitions() {
                if !should_expose_registered_tool_with_gates(
                    &tool_def.name,
                    resources_supported,
                    tool_gates,
                ) {
                    continue;
                }

                let tool = Tool::new(
                    tool_def.name,
                    tool_def.description,
                    tool_def
                        .input_schema
                        .as_object()
                        .cloned()
                        .unwrap_or_default(),
                );
                prefixed_tools.push(tool);
            }
        }

        prefixed_tools.retain(|tool| {
            should_expose_tool_for_session_with_gates(
                &tool.name,
                current_session_type,
                resources_supported,
                tool_gates,
                subagent_teammate_tools_enabled,
                crate::tools::plan_mode_tool::current_plan_mode_active(),
            )
        });

        prefixed_tools
    }

    pub async fn remove_extension(&self, name: &str) -> Result<()> {
        self.extension_manager.remove_extension(name).await?;
        Ok(())
    }

    pub async fn list_extensions(&self) -> Vec<String> {
        self.extension_manager
            .list_extensions()
            .await
            .expect("Failed to list extensions")
    }

    pub async fn get_extension_configs(&self) -> Vec<ExtensionConfig> {
        self.extension_manager.get_extension_configs().await
    }

    /// Handle a confirmation response for a tool request
    pub async fn handle_confirmation(
        &self,
        request_id: String,
        confirmation: PermissionConfirmation,
    ) {
        let response = serde_json::json!({
            "confirmed": !matches!(
                confirmation.permission,
                crate::permission::Permission::Cancel | crate::permission::Permission::DenyOnce
            )
        });
        if let Err(error) = self
            .complete_runtime_request_item(&request_id, Some(response))
            .await
        {
            warn!(
                request_id = %request_id,
                ?error,
                "Failed to complete runtime approval item"
            );
        }
        if let Err(e) = self.confirmation_tx.send((request_id, confirmation)).await {
            error!("Failed to send confirmation: {}", e);
        }
    }

    #[instrument(skip(self, user_message, session_config), fields(user_message))]
    pub async fn reply(
        &self,
        user_message: Message,
        session_config: SessionConfig,
        cancel_token: Option<CancellationToken>,
    ) -> Result<BoxStream<'_, Result<AgentEvent>>> {
        let session_config = self
            .prepare_session_config_for_reply(session_config)
            .await?;

        for content in &user_message.content {
            if let MessageContent::ActionRequired(action_required) = content {
                if let ActionRequiredData::ElicitationResponse { id, user_data } =
                    &action_required.data
                {
                    let action_scope = action_required.scope.as_ref();
                    if let Err(e) = ActionRequiredManager::global()
                        .submit_response_scoped(id.clone(), action_scope, user_data.clone())
                        .await
                    {
                        let error_text = format!("Failed to submit elicitation response: {}", e);
                        error!(error_text);
                        return Ok(Self::scope_reply_stream(
                            &session_config,
                            Box::pin(stream::once(async {
                                Ok(AgentEvent::Message(
                                    Message::assistant().with_text(error_text),
                                ))
                            })),
                        ));
                    }
                    if let Err(error) = self
                        .complete_runtime_request_item(id, Some(user_data.clone()))
                        .await
                    {
                        warn!(
                            request_id = %id,
                            ?error,
                            "Failed to complete runtime elicitation item"
                        );
                    }
                    self.store_add_message(&session_config.id, &user_message)
                        .await?;
                    return Ok(Self::scope_reply_stream(
                        &session_config,
                        Box::pin(futures::stream::empty()),
                    ));
                }
            }
        }

        let message_text = user_message.as_concat_text();

        // Track custom slash command usage (don't track command name for privacy)
        if message_text.trim().starts_with('/') {
            let command = message_text.split_whitespace().next();
            if let Some(cmd) = command {
                if crate::slash_commands::get_recipe_for_command(cmd).is_some() {
                    crate::posthog::emit_custom_slash_command_used();
                }
            }
        }

        let command_result = self
            .execute_command(&message_text, &session_config.id)
            .await;

        match command_result {
            Err(e) => {
                let error_message = Message::assistant()
                    .with_text(e.to_string())
                    .with_visibility(true, false);
                return Ok(Self::scope_reply_stream(
                    &session_config,
                    Box::pin(stream::once(async move {
                        Ok(AgentEvent::Message(error_message))
                    })),
                ));
            }
            Ok(Some(response)) if response.role == rmcp::model::Role::Assistant => {
                self.store_add_message(
                    &session_config.id,
                    &user_message.clone().with_visibility(true, false),
                )
                .await?;
                self.store_add_message(
                    &session_config.id,
                    &response.clone().with_visibility(true, false),
                )
                .await?;

                // Check if this was a command that modifies conversation history
                let modifies_history = crate::agents::execute_commands::COMPACT_TRIGGERS
                    .contains(&message_text.trim())
                    || message_text.trim() == "/clear";

                // 克隆 session_store 引用供 async_stream 宏内部使用
                let session_store_clone = self.session_store.clone();
                let session_id_clone = session_config.id.clone();

                return Ok(Self::scope_reply_stream(
                    &session_config,
                    Box::pin(async_stream::try_stream! {
                        yield AgentEvent::Message(user_message);
                        yield AgentEvent::Message(response);

                        // After commands that modify history, notify UI that history was replaced
                        if modifies_history {
                            let updated_session = if let Some(store) = &session_store_clone {
                                store.get_session(&session_id_clone, true).await
                            } else {
                                SessionManager::get_session(&session_id_clone, true).await
                            }
                                .map_err(|e| anyhow!("Failed to fetch updated session: {}", e))?;
                            let updated_conversation = updated_session
                                .conversation
                                .ok_or_else(|| anyhow!("Session has no conversation after history modification"))?;
                            yield AgentEvent::HistoryReplaced(updated_conversation);
                        }
                    }),
                ));
            }
            Ok(Some(resolved_message)) => {
                self.store_add_message(
                    &session_config.id,
                    &user_message.clone().with_visibility(true, false),
                )
                .await?;
                self.store_add_message(
                    &session_config.id,
                    &resolved_message.clone().with_visibility(false, true),
                )
                .await?;
            }
            Ok(None) => {
                self.store_add_message(&session_config.id, &user_message)
                    .await?;
            }
        }
        let session = self.store_get_session(&session_config.id, true).await?;
        self.remember_session_type_hint(session.session_type).await;
        let conversation = session
            .conversation
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Session {} has no conversation", session_config.id))?;

        let needs_auto_compact = check_if_compaction_needed(
            self.provider().await?.as_ref(),
            &conversation,
            None,
            &session,
        )
        .await?;

        let conversation_to_compact = conversation.clone();
        let scope_session_config = session_config.clone();
        let stream_session_config = session_config.clone();
        let scoped_session_config = session_config.clone();
        let input_text_for_turn = (!message_text.trim().is_empty()).then_some(message_text.clone());

        Ok(Self::scope_reply_stream(
            &scope_session_config,
            Box::pin(async_stream::try_stream! {
                let final_conversation = if !needs_auto_compact {
                    conversation
                } else {
                    let config = Config::global();
                    let threshold = config
                        .get_param::<f64>("ASTER_AUTO_COMPACT_THRESHOLD")
                        .unwrap_or(DEFAULT_COMPACTION_THRESHOLD);
                    let threshold_percentage = (threshold * 100.0) as u32;

                    let inline_msg = format!(
                        "Exceeded auto-compact threshold of {}%. Performing auto-compaction...",
                        threshold_percentage
                    );

                    yield AgentEvent::Message(
                        Message::assistant().with_system_notification(
                            SystemNotificationType::InlineMessage,
                            inline_msg,
                        )
                    );

                    yield AgentEvent::Message(
                        Message::assistant().with_system_notification(
                            SystemNotificationType::ThinkingMessage,
                            COMPACTION_THINKING_TEXT,
                        )
                    );

                    let compaction_item_id = Self::context_compaction_item_id(
                        stream_session_config
                            .turn_id
                            .as_deref()
                            .unwrap_or("unknown-turn"),
                    );
                    yield AgentEvent::ContextCompactionStarted {
                        item_id: compaction_item_id.clone(),
                        trigger: ContextCompactionTrigger::Auto.as_str().to_string(),
                        detail: Some(ContextCompactionTrigger::Auto.started_detail().to_string()),
                    };

                    match self
                        .perform_context_compaction(
                            &stream_session_config,
                            &conversation_to_compact,
                            false,
                        )
                        .await
                    {
                        Ok(result) => {
                            yield AgentEvent::HistoryReplaced(
                                result.compacted_conversation.clone(),
                            );
                            yield AgentEvent::ContextCompactionCompleted {
                                item_id: compaction_item_id,
                                trigger: ContextCompactionTrigger::Auto.as_str().to_string(),
                                detail: Some(
                                    ContextCompactionTrigger::Auto
                                        .completed_detail()
                                        .to_string(),
                                ),
                            };
                            yield AgentEvent::ContextCompactionWarning {
                                message: CONTEXT_COMPACTION_WARNING_TEXT.to_string(),
                            };

                            yield AgentEvent::Message(
                                Message::assistant().with_system_notification(
                                    SystemNotificationType::InlineMessage,
                                    "Compaction complete",
                                )
                            );

                            result.compacted_conversation
                        }
                        Err(e) => {
                            yield AgentEvent::Message(
                                Message::assistant().with_text(
                                    format!("Ran into this error trying to compact: {e}.\n\nPlease try again or create a new session")
                                )
                            );
                            return;
                        }
                    }
                };

                self.ensure_thread_runtime(&session, &scoped_session_config).await?;
                let turn_runtime = self
                    .create_turn_runtime(&session, &scoped_session_config, input_text_for_turn.clone())
                    .await?;
                let mut item_runtime_projector = TurnItemRuntimeProjector::new(&turn_runtime);
                yield AgentEvent::TurnStarted {
                    turn: turn_runtime.clone(),
                };
                if let Some(user_item_event) = item_runtime_projector.project_user_input(&turn_runtime)
                {
                    self.persist_item_runtime(&user_item_event).await?;
                    yield user_item_event;
                }

                let mut turn_status = TurnStatus::Completed;
                let mut turn_error = None;

                let mut reply_stream = match self
                    .reply_internal(final_conversation, scoped_session_config.clone(), session, cancel_token.clone())
                    .await
                {
                    Ok(stream) => stream,
                    Err(err) => {
                        turn_status = TurnStatus::Failed;
                        turn_error = Some(err.to_string());
                        self.finalize_turn_runtime(&scoped_session_config, turn_status, turn_error.clone()).await?;
                        Err(err)?;
                        unreachable!();
                    }
                };

                while let Some(event) = reply_stream.next().await {
                    match event {
                        Ok(event) => {
                            for runtime_event in item_runtime_projector.project_agent_event(&event) {
                                self.persist_item_runtime(&runtime_event).await?;
                                yield runtime_event;
                            }
                            yield event;
                        }
                        Err(err) => {
                            turn_status = if is_token_cancelled(&cancel_token) {
                                TurnStatus::Aborted
                            } else {
                                TurnStatus::Failed
                            };
                            turn_error = Some(err.to_string());
                            for runtime_event in
                                item_runtime_projector.finalize_open_items(turn_status)
                            {
                                self.persist_item_runtime(&runtime_event).await?;
                                yield runtime_event;
                            }
                            self.finalize_turn_runtime(&scoped_session_config, turn_status, turn_error.clone()).await?;
                            Err(err)?;
                            unreachable!();
                        }
                    }
                }

                if is_token_cancelled(&cancel_token) {
                    turn_status = TurnStatus::Aborted;
                }
                for runtime_event in item_runtime_projector.finalize_open_items(turn_status) {
                    self.persist_item_runtime(&runtime_event).await?;
                    yield runtime_event;
                }
                self.finalize_turn_runtime(&scoped_session_config, turn_status, turn_error).await?;
            }),
        ))
    }

    async fn reply_internal(
        &self,
        conversation: Conversation,
        session_config: SessionConfig,
        session: Session,
        cancel_token: Option<CancellationToken>,
    ) -> Result<BoxStream<'_, Result<AgentEvent>>> {
        let emit_context_trace = session_config.include_context_trace.unwrap_or(false);
        let context = self
            .prepare_reply_context(
                conversation,
                &session.working_dir,
                &session_config,
                emit_context_trace,
            )
            .await?;
        let ReplyContext {
            mut conversation,
            mut tools,
            mut toolshim_tools,
            mut system_prompt,
            model_config,
            aster_mode,
            initial_messages,
            context_trace,
        } = context;
        let reply_span = tracing::Span::current();
        self.reset_retry_attempts().await;

        let provider = self.provider().await?;
        let session_for_name = session.clone().without_messages();
        let conversation_for_name = conversation.clone();
        let deferred_session_name_generation =
            match provider.session_name_generation_execution_strategy() {
                SessionNameGenerationExecutionStrategy::Background => {
                    tokio::spawn(async move {
                        if let Err(e) = SessionManager::maybe_update_name_for_session(
                            &session_for_name,
                            &conversation_for_name,
                            provider,
                        )
                        .await
                        {
                            warn!("Failed to generate session description: {}", e);
                        }
                    });
                    None
                }
                SessionNameGenerationExecutionStrategy::AfterReply => {
                    Some((session_for_name, conversation_for_name, provider))
                }
            };
        let working_dir = session.working_dir.clone();

        Ok(Box::pin(async_stream::try_stream! {
            let _ = reply_span.enter();
            let mut turns_taken = 0u32;
            let max_turns = session_config.max_turns.unwrap_or(DEFAULT_MAX_TURNS);
            let mut overflow_handler = OverflowHandler::new(2);

            if emit_context_trace && !context_trace.is_empty() {
                yield AgentEvent::ContextTrace { steps: context_trace };
            }

            loop {
                if is_token_cancelled(&cancel_token) {
                    break;
                }

                if let Some(final_output_tool) = self.final_output_tool.lock().await.as_ref() {
                    if final_output_tool.final_output.is_some() {
                        let final_event = AgentEvent::Message(
                            Message::assistant().with_text(final_output_tool.final_output.clone().unwrap())
                        );
                        yield final_event;
                        break;
                    }
                }

                turns_taken += 1;
                if turns_taken > max_turns {
                    yield AgentEvent::Message(
                        Message::assistant().with_text(
                            "I've reached the maximum number of actions I can do without user input. Would you like me to continue?"
                        )
                    );
                    break;
                }

                let conversation_with_moim = super::moim::inject_moim(
                    conversation.clone(),
                    &self.extension_manager,
                ).await;

                let mut stream = Self::stream_response_from_provider(
                    self.provider().await?,
                    &model_config,
                    &system_prompt,
                    conversation_with_moim.messages(),
                    &tools,
                    &toolshim_tools,
                ).await?;

                let mut no_tools_called = true;
                let mut messages_to_add = Conversation::default();
                let mut tools_updated = false;
                let mut did_recovery_compact_this_iteration = false;

                while let Some(next) = stream.next().await {
                    if is_token_cancelled(&cancel_token) {
                        break;
                    }

                    match next {
                        Ok((response, usage)) => {
                            overflow_handler.reset();

                            // Emit model change event if provider is lead-worker
                            let provider = self.provider().await?;
                            if let Some(lead_worker) = provider.as_lead_worker() {
                                if let Some(ref usage) = usage {
                                    let active_model = usage.model.clone();
                                    let (lead_model, worker_model) = lead_worker.get_model_info();
                                    let mode = if active_model == lead_model {
                                        "lead"
                                    } else if active_model == worker_model {
                                        "worker"
                                    } else {
                                        "unknown"
                                    };

                                    yield AgentEvent::ModelChange {
                                        model: active_model,
                                        mode: mode.to_string(),
                                    };
                                }
                            }

                            if let Some(ref usage) = usage {
                                Self::update_session_metrics(&session_config, usage, false, self.session_store.as_ref()).await?;
                            }

                            if let Some(response) = response {
                                let ToolCategorizeResult {
                                    frontend_requests,
                                    remaining_requests,
                                    filtered_response,
                                    normalized_response,
                                } = self.categorize_tools(&response, &tools).await;

                                yield AgentEvent::Message(filtered_response.clone());
                                tokio::task::yield_now().await;

                                let num_tool_requests = frontend_requests.len() + remaining_requests.len();
                                if num_tool_requests == 0 {
                                    messages_to_add.push(normalized_response);
                                    continue;
                                }

                                let tool_response_messages: Vec<Arc<Mutex<Message>>> = (0..num_tool_requests)
                                    .map(|_| Arc::new(Mutex::new(Message::user().with_id(
                                        format!("msg_{}", Uuid::new_v4())
                                    ))))
                                    .collect();

                                let mut request_to_response_map = HashMap::new();
                                let mut request_metadata: HashMap<String, Option<ProviderMetadata>> = HashMap::new();
                                for (idx, request) in frontend_requests.iter().chain(remaining_requests.iter()).enumerate() {
                                    request_to_response_map.insert(request.id.clone(), tool_response_messages[idx].clone());
                                    request_metadata.insert(request.id.clone(), request.metadata.clone());
                                }

                                for (idx, request) in frontend_requests.iter().enumerate() {
                                    let mut frontend_tool_stream = self.handle_frontend_tool_request(
                                        request,
                                        tool_response_messages[idx].clone(),
                                    );

                                    while let Some(msg) = frontend_tool_stream.try_next().await? {
                                        yield AgentEvent::Message(msg);
                                    }
                                }
                                if aster_mode == AsterMode::Chat {
                                    // Skip all remaining tool calls in chat mode
                                    for request in remaining_requests.iter() {
                                        if let Some(response_msg) = request_to_response_map.get(&request.id) {
                                            let mut response = response_msg.lock().await;
                                            *response = response.clone().with_tool_response_with_metadata(
                                                request.id.clone(),
                                                Ok(CallToolResult {
                                                    content: vec![Content::text(CHAT_MODE_TOOL_SKIPPED_RESPONSE)],
                                                    structured_content: None,
                                                    is_error: Some(false),
                                                    meta: None,
                                                }),
                                                request.metadata.as_ref(),
                                            );
                                        }
                                    }
                                } else {
                                    // Run all tool inspectors
                                    let inspection_results = self.tool_inspection_manager
                                        .inspect_tools(
                                            &remaining_requests,
                                            conversation.messages(),
                                        )
                                        .await?;

                                    let permission_check_result = self.tool_inspection_manager
                                        .process_inspection_results_with_permission_inspector(
                                            &remaining_requests,
                                            &inspection_results,
                                        )
                                        .unwrap_or_else(|| {
                                            let mut result = PermissionCheckResult {
                                                approved: vec![],
                                                needs_approval: vec![],
                                                denied: vec![],
                                            };
                                            result.needs_approval.extend(remaining_requests.iter().cloned());
                                            result
                                        });

                                    // Track extension requests
                                    let mut enable_extension_request_ids = vec![];
                                    for request in &remaining_requests {
                                        if let Ok(tool_call) = &request.tool_call {
                                            if tool_call.name == MANAGE_EXTENSIONS_TOOL_NAME_COMPLETE {
                                                enable_extension_request_ids.push(request.id.clone());
                                            }
                                        }
                                    }

                                    let mut tool_futures = self.handle_approved_and_denied_tools(
                                        &permission_check_result,
                                        &request_to_response_map,
                                        cancel_token.clone(),
                                        &session,
                                    ).await?;

                                    let tool_futures_arc = Arc::new(Mutex::new(tool_futures));

                                    let mut tool_approval_stream = self.handle_approval_tool_requests(
                                        &permission_check_result.needs_approval,
                                        tool_futures_arc.clone(),
                                        &request_to_response_map,
                                        cancel_token.clone(),
                                        &session,
                                        &inspection_results,
                                    );

                                    while let Some(msg) = tool_approval_stream.try_next().await? {
                                        yield AgentEvent::Message(msg);
                                    }

                                    tool_futures = {
                                        let mut futures_lock = tool_futures_arc.lock().await;
                                        futures_lock.drain(..).collect::<Vec<_>>()
                                    };

                                    let with_id = tool_futures
                                        .into_iter()
                                        .map(|(request_id, stream)| {
                                            stream.map(move |item| (request_id.clone(), item))
                                        })
                                        .collect::<Vec<_>>();

                                    let mut combined = stream::select_all(with_id);
                                    let mut all_install_successful = true;

                                    while let Some((request_id, item)) = combined.next().await {
                                        if is_token_cancelled(&cancel_token) {
                                            break;
                                        }

                                        for msg in self.drain_elicitation_messages(&session_config).await {
                                            yield AgentEvent::Message(msg);
                                        }
                                        for msg in self.drain_user_messages(&session_config).await {
                                            yield AgentEvent::Message(msg);
                                        }

                                        match item {
                                            ToolStreamItem::Result(output) => {
                                                if enable_extension_request_ids.contains(&request_id)
                                                    && output.is_err()
                                                {
                                                    all_install_successful = false;
                                                }
                                                if output
                                                    .as_ref()
                                                    .ok()
                                                    .is_some_and(tool_surface_updated_from_call_tool_result)
                                                {
                                                    tools_updated = true;
                                                }
                                                if let Some(response_msg) = request_to_response_map.get(&request_id) {
                                                    let metadata = request_metadata.get(&request_id).and_then(|m| m.as_ref());
                                                    let mut response = response_msg.lock().await;
                                                    *response = response.clone().with_tool_response_with_metadata(request_id, output, metadata);
                                                }
                                            }
                                            ToolStreamItem::Message(msg) => {
                                                yield AgentEvent::McpNotification((request_id, msg));
                                            }
                                        }
                                    }

                                    // check for remaining elicitation messages after all tools complete
                                    for msg in self.drain_elicitation_messages(&session_config).await {
                                        yield AgentEvent::Message(msg);
                                    }
                                    for msg in self.drain_user_messages(&session_config).await {
                                        yield AgentEvent::Message(msg);
                                    }

                                    if all_install_successful && !enable_extension_request_ids.is_empty() {
                                        if let Err(e) = self.save_extension_state(&session_config).await {
                                            warn!("Failed to save extension state after runtime changes: {}", e);
                                        }
                                        tools_updated = true;
                                    }
                                }

                                // Preserve the original assistant turn as one atomic provider round:
                                // thinking/text/tool requests must stay together so providers like
                                // DeepSeek can receive reasoning_content on the same assistant
                                // tool-call message during the next turn.
                                messages_to_add.push(normalized_response);

                                for (idx, request) in frontend_requests.iter().chain(remaining_requests.iter()).enumerate() {
                                    if request.tool_call.is_ok() {
                                        let final_response = tool_response_messages[idx]
                                                                .lock().await.clone();
                                        yield AgentEvent::Message(final_response.clone());
                                        messages_to_add.push(final_response);
                                    }
                                }

                                no_tools_called = false;
                            }
                        }
                        Err(ref provider_err @ ProviderError::ContextLengthExceeded(_)) => {
                            crate::posthog::emit_error(provider_err.telemetry_type(), &provider_err.to_string());

                            if !overflow_handler.can_retry() {
                                error!("Context limit exceeded after compaction - prompt too large");
                                yield AgentEvent::Message(
                                    Message::assistant().with_system_notification(
                                        SystemNotificationType::InlineMessage,
                                        "Unable to continue: Context limit still exceeded after compaction. Try using a shorter message, a model with a larger context window, or start a new session."
                                    )
                                );
                                break;
                            }

                            if !automatic_compaction_enabled_for_current_turn() {
                                yield AgentEvent::Message(
                                    Message::assistant().with_system_notification(
                                        SystemNotificationType::InlineMessage,
                                        AUTO_COMPACTION_DISABLED_CONTEXT_LIMIT_TEXT,
                                    )
                                );
                                break;
                            }

                            yield AgentEvent::Message(
                                Message::assistant().with_system_notification(
                                    SystemNotificationType::InlineMessage,
                                    format!(
                                        "Context limit reached. Compacting to continue conversation... (attempt {}/{})",
                                        overflow_handler.compaction_attempts() + 1,
                                        2
                                    ),
                                )
                            );
                            yield AgentEvent::Message(
                                Message::assistant().with_system_notification(
                                    SystemNotificationType::ThinkingMessage,
                                    COMPACTION_THINKING_TEXT,
                                )
                            );

                            if let Err(e) = overflow_handler.note_compaction_attempt() {
                                crate::posthog::emit_error("compaction_failed", &e.to_string());
                                error!("Compaction failed: {}", e);
                                yield AgentEvent::Message(
                                    Message::assistant().with_system_notification(
                                        SystemNotificationType::InlineMessage,
                                        format!("Compaction failed: {}", e),
                                    )
                                );
                                break;
                            }

                            let compaction_item_id = Self::context_compaction_item_id(
                                session_config.turn_id.as_deref().unwrap_or("unknown-turn"),
                            );
                            yield AgentEvent::ContextCompactionStarted {
                                item_id: compaction_item_id.clone(),
                                trigger: ContextCompactionTrigger::Overflow.as_str().to_string(),
                                detail: Some(
                                    ContextCompactionTrigger::Overflow
                                        .started_detail()
                                        .to_string(),
                                ),
                            };

                            match self
                                .perform_context_compaction(&session_config, &conversation, false)
                                .await
                            {
                                Ok(result) => {
                                    conversation = result.compacted_conversation;
                                    did_recovery_compact_this_iteration = true;
                                    yield AgentEvent::HistoryReplaced(conversation.clone());
                                    yield AgentEvent::ContextCompactionCompleted {
                                        item_id: compaction_item_id,
                                        trigger: ContextCompactionTrigger::Overflow
                                            .as_str()
                                            .to_string(),
                                        detail: Some(
                                            ContextCompactionTrigger::Overflow
                                                .completed_detail()
                                                .to_string(),
                                        ),
                                    };
                                    yield AgentEvent::ContextCompactionWarning {
                                        message: CONTEXT_COMPACTION_WARNING_TEXT.to_string(),
                                    };
                                    break;
                                }
                                Err(e) => {
                                    crate::posthog::emit_error("compaction_failed", &e.to_string());
                                    error!("Compaction failed: {}", e);
                                    yield AgentEvent::Message(
                                        Message::assistant().with_system_notification(
                                            SystemNotificationType::InlineMessage,
                                            format!("Compaction failed: {}", e),
                                        )
                                    );
                                    break;
                                }
                            }
                        }
                        Err(ref provider_err) => {
                            crate::posthog::emit_error(provider_err.telemetry_type(), &provider_err.to_string());
                            error!("Error: {}", provider_err);
                            yield AgentEvent::Message(
                                Message::assistant().with_text(
                                    format!("Ran into this error: {provider_err}.\n\nPlease retry if you think this is a transient or recoverable error.")
                                )
                            );
                            break;
                        }
                    }
                }
                if tools_updated {
                    let session_prompt = session_config.system_prompt.as_deref();
                    (tools, toolshim_tools, system_prompt) =
                        self.prepare_tools_and_prompt(&working_dir, session_prompt, &model_config).await?;
                }
                let mut exit_chat = false;
                if no_tools_called {
                    if let Some(final_output_tool) = self.final_output_tool.lock().await.as_ref() {
                        if final_output_tool.final_output.is_none() {
                            warn!("Final output tool has not been called yet. Continuing agent loop.");
                            let message = Message::user()
                                .with_text(FINAL_OUTPUT_CONTINUATION_MESSAGE)
                                .agent_only();
                            messages_to_add.push(message.clone());
                            yield AgentEvent::Message(message);
                        } else {
                            let message = Message::assistant().with_text(final_output_tool.final_output.clone().unwrap());
                            messages_to_add.push(message.clone());
                            yield AgentEvent::Message(message);
                            exit_chat = true;
                        }
                    } else if did_recovery_compact_this_iteration {
                        // Avoid setting exit_chat; continue from last user message in the conversation
                    } else {
                        match self.handle_retry_logic(&mut conversation, &session_config, &initial_messages).await {
                            Ok(should_retry) => {
                                if should_retry {
                                    info!("Retry logic triggered, restarting agent loop");
                                } else {
                                    exit_chat = true;
                                }
                            }
                            Err(e) => {
                                error!("Retry logic failed: {}", e);
                                yield AgentEvent::Message(
                                    Message::assistant().with_text(
                                        format!("Retry logic encountered an error: {}", e)
                                    )
                                );
                                exit_chat = true;
                            }
                        }
                    }
                }

                for msg in &messages_to_add {
                    self.store_add_message(&session_config.id, msg).await?;
                }
                conversation.extend(messages_to_add);
                if exit_chat {
                    break;
                }

                tokio::task::yield_now().await;
            }

            if let Some((session_for_name, conversation_for_name, provider)) =
                deferred_session_name_generation
            {
                tokio::spawn(async move {
                    if let Err(e) = SessionManager::maybe_update_name_for_session(
                        &session_for_name,
                        &conversation_for_name,
                        provider,
                    )
                    .await
                    {
                        warn!("Failed to generate session description: {}", e);
                    }
                });
            }
        }))
    }

    pub async fn extend_system_prompt(&self, instruction: String) {
        let mut prompt_manager = self.prompt_manager.lock().await;
        prompt_manager.add_system_prompt_extra(instruction);
    }

    pub async fn update_provider(
        &self,
        provider: Arc<dyn Provider>,
        session_id: &str,
    ) -> Result<()> {
        let mut current_provider = self.provider.lock().await;
        *current_provider = Some(provider.clone());

        self.store_update_provider_config(
            session_id,
            provider.get_name().to_string(),
            provider.get_model_config(),
        )
        .await
        .context("Failed to persist provider config to session")
    }

    /// Override the system prompt with a custom template
    pub async fn override_system_prompt(&self, template: String) {
        let mut prompt_manager = self.prompt_manager.lock().await;
        prompt_manager.set_system_prompt_override(template);
    }

    pub async fn list_extension_prompts(&self) -> HashMap<String, Vec<Prompt>> {
        self.extension_manager
            .list_prompts(CancellationToken::default())
            .await
            .expect("Failed to list prompts")
    }

    pub async fn get_prompt(&self, name: &str, arguments: Value) -> Result<GetPromptResult> {
        // First find which extension has this prompt
        let prompts = self
            .extension_manager
            .list_prompts(CancellationToken::default())
            .await
            .map_err(|e| anyhow!("Failed to list prompts: {}", e))?;

        if let Some(extension) = prompts
            .iter()
            .find(|(_, prompt_list)| prompt_list.iter().any(|p| p.name == name))
            .map(|(extension, _)| extension)
        {
            return self
                .extension_manager
                .get_prompt(extension, name, arguments, CancellationToken::default())
                .await
                .map_err(|e| anyhow!("Failed to get prompt: {}", e));
        }

        Err(anyhow!("Prompt '{}' not found", name))
    }

    pub async fn get_plan_prompt(&self) -> Result<String> {
        let tools = self.extension_manager.get_prefixed_tools(None).await?;
        let tools_info = tools
            .into_iter()
            .map(|tool| {
                ToolInfo::new(
                    &tool.name,
                    tool.description
                        .as_ref()
                        .map(|d| d.as_ref())
                        .unwrap_or_default(),
                    get_parameter_names(&tool),
                    None,
                )
            })
            .collect();

        let plan_prompt = self.extension_manager.get_planning_prompt(tools_info).await;

        Ok(plan_prompt)
    }

    pub async fn handle_tool_result(&self, id: String, result: ToolResult<CallToolResult>) {
        if let Err(e) = self.tool_result_tx.send((id, result)).await {
            error!("Failed to send tool result: {}", e);
        }
    }

    pub async fn create_recipe(&self, mut messages: Conversation) -> Result<Recipe> {
        tracing::info!("Starting recipe creation with {} messages", messages.len());

        let extensions_info = self.extension_manager.get_extensions_info().await;
        tracing::debug!("Retrieved {} extensions info", extensions_info.len());
        let (extension_count, tool_count) =
            self.extension_manager.get_extension_and_tool_counts().await;

        // Get model name from provider
        let provider = self.provider().await.map_err(|e| {
            tracing::error!("Failed to get provider for recipe creation: {}", e);
            e
        })?;
        let model_config = provider.get_model_config();
        let model_name = &model_config.model_name;
        tracing::debug!("Using model: {}", model_name);

        let prompt_manager = self.prompt_manager.lock().await;
        let system_prompt = prompt_manager
            .builder()
            .with_extensions(extensions_info.into_iter())
            .with_frontend_instructions(self.frontend_instructions.lock().await.clone())
            .with_extension_and_tool_counts(extension_count, tool_count)
            .build();

        let recipe_prompt = prompt_manager.get_recipe_prompt().await;
        let tools = self
            .extension_manager
            .get_prefixed_tools(None)
            .await
            .map_err(|e| {
                tracing::error!("Failed to get tools for recipe creation: {}", e);
                e
            })?;

        messages.push(Message::user().with_text(recipe_prompt));

        let (messages, issues) = fix_conversation(messages);
        if !issues.is_empty() {
            issues
                .iter()
                .for_each(|issue| tracing::warn!(recipe.conversation.issue = issue));
        }

        tracing::debug!(
            "Added recipe prompt to messages, total messages: {}",
            messages.len()
        );

        tracing::info!("Calling provider to generate recipe content");
        let (result, _usage) = self
            .provider
            .lock()
            .await
            .as_ref()
            .ok_or_else(|| {
                let error = anyhow!("Provider not available during recipe creation");
                tracing::error!("{}", error);
                error
            })?
            .complete(&system_prompt, messages.messages(), &tools)
            .await
            .map_err(|e| {
                tracing::error!("Provider completion failed during recipe creation: {}", e);
                e
            })?;

        let content = result.as_concat_text();
        tracing::debug!(
            "Provider returned content with {} characters",
            content.len()
        );

        // the response may be contained in ```json ```, strip that before parsing json
        let re = Regex::new(r"(?s)```[^\n]*\n(.*?)\n```").unwrap();
        let clean_content = re
            .captures(&content)
            .and_then(|caps| caps.get(1).map(|m| m.as_str()))
            .unwrap_or(&content)
            .trim()
            .to_string();

        let (instructions, activities) =
            if let Ok(json_content) = serde_json::from_str::<Value>(&clean_content) {
                let instructions = json_content
                    .get("instructions")
                    .ok_or_else(|| anyhow!("Missing 'instructions' in json response"))?
                    .as_str()
                    .ok_or_else(|| anyhow!("instructions' is not a string"))?
                    .to_string();

                let activities = json_content
                    .get("activities")
                    .ok_or_else(|| anyhow!("Missing 'activities' in json response"))?
                    .as_array()
                    .ok_or_else(|| anyhow!("'activities' is not an array'"))?
                    .iter()
                    .map(|act| {
                        act.as_str()
                            .map(|s| s.to_string())
                            .ok_or(anyhow!("'activities' array element is not a string"))
                    })
                    .collect::<Result<_, _>>()?;

                (instructions, activities)
            } else {
                tracing::warn!("Failed to parse JSON, falling back to string parsing");
                // If we can't get valid JSON, try string parsing
                // Use split_once to get the content after "Instructions:".
                let after_instructions = content
                    .split_once("instructions:")
                    .map(|(_, rest)| rest)
                    .unwrap_or(&content);

                // Split once more to separate instructions from activities.
                let (instructions_part, activities_text) = after_instructions
                    .split_once("activities:")
                    .unwrap_or((after_instructions, ""));

                let instructions = instructions_part
                    .trim_end_matches(|c: char| c.is_whitespace() || c == '#')
                    .trim()
                    .to_string();
                let activities_text = activities_text.trim();

                // Regex to remove bullet markers or numbers with an optional dot.
                let bullet_re = Regex::new(r"^[•\-*\d]+\.?\s*").expect("Invalid regex");

                // Process each line in the activities section.
                let activities: Vec<String> = activities_text
                    .lines()
                    .map(|line| bullet_re.replace(line, "").to_string())
                    .map(|s| s.trim().to_string())
                    .filter(|line| !line.is_empty())
                    .collect();

                (instructions, activities)
            };

        let extension_configs = get_enabled_extensions();

        let author = Author {
            contact: std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .ok(),
            metadata: None,
        };

        // Ideally we'd get the name of the provider we are using from the provider itself,
        // but it doesn't know and the plumbing looks complicated.
        let config = Config::global();
        let provider_name: String = config
            .get_aster_provider()
            .expect("No provider configured. Run 'aster configure' first");

        let settings = Settings {
            aster_provider: Some(provider_name.clone()),
            aster_model: Some(model_name.clone()),
            temperature: Some(model_config.temperature.unwrap_or(0.0)),
        };

        tracing::debug!(
            "Building recipe with {} activities and {} extensions",
            activities.len(),
            extension_configs.len()
        );

        let (title, description) =
            if let Ok(json_content) = serde_json::from_str::<Value>(&clean_content) {
                let title = json_content
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("Custom recipe from chat")
                    .to_string();

                let description = json_content
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("a custom recipe instance from this chat session")
                    .to_string();

                (title, description)
            } else {
                (
                    "Custom recipe from chat".to_string(),
                    "a custom recipe instance from this chat session".to_string(),
                )
            };

        let recipe = Recipe::builder()
            .title(title)
            .description(description)
            .instructions(instructions)
            .activities(activities)
            .extensions(extension_configs)
            .settings(settings)
            .author(author)
            .build()
            .map_err(|e| {
                tracing::error!("Failed to build recipe: {}", e);
                anyhow!("Recipe build failed: {}", e)
            })?;

        tracing::info!("Recipe creation completed successfully");
        Ok(recipe)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::extension::PlatformExtensionContext;
    use crate::providers::base::{Provider, ProviderMetadata, ProviderUsage};
    use crate::providers::errors::ProviderError;
    use crate::session::{
        extension_data::ExtensionData, initialize_shared_thread_runtime_store, ChatHistoryMatch,
        CommitOptions, CommitReport, InMemoryThreadRuntimeStore, MemoryCategory, MemoryHealth,
        MemoryRecord, MemorySearchResult, MemoryStats, SessionInsights, SessionManager,
        SessionStore, SessionType, TokenStatsUpdate, TurnContextOverride,
    };
    use async_trait::async_trait;
    use futures::StreamExt;
    use rmcp::model::Tool;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    struct NativeOutputSchemaProvider;

    struct ModelAwareNativeOutputSchemaProvider;
    struct ContextLengthExceededProvider;

    struct CountingSessionStore {
        get_session_calls: AtomicUsize,
        session: Mutex<Session>,
    }

    impl CountingSessionStore {
        fn new(session: Session) -> Self {
            Self {
                get_session_calls: AtomicUsize::new(0),
                session: Mutex::new(session),
            }
        }

        fn get_session_calls(&self) -> usize {
            self.get_session_calls.load(Ordering::SeqCst)
        }

        fn current_session(&self, include_messages: bool) -> Session {
            let mut session = self.session.lock().expect("锁测试 session").clone();
            if !include_messages {
                session.conversation = None;
            }
            session
        }
    }

    #[async_trait]
    impl SessionStore for CountingSessionStore {
        async fn create_session(
            &self,
            _working_dir: PathBuf,
            _name: String,
            _session_type: SessionType,
        ) -> Result<Session> {
            Ok(self.current_session(true))
        }

        async fn get_session(&self, _id: &str, include_messages: bool) -> Result<Session> {
            self.get_session_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.current_session(include_messages))
        }

        async fn add_message(&self, _session_id: &str, _message: &Message) -> Result<()> {
            Ok(())
        }

        async fn replace_conversation(
            &self,
            _session_id: &str,
            _conversation: &Conversation,
        ) -> Result<()> {
            Ok(())
        }

        async fn list_sessions(&self) -> Result<Vec<Session>> {
            Ok(vec![self.current_session(false)])
        }

        async fn list_sessions_by_types(&self, _types: &[SessionType]) -> Result<Vec<Session>> {
            Ok(vec![self.current_session(false)])
        }

        async fn delete_session(&self, _id: &str) -> Result<()> {
            Ok(())
        }

        async fn get_insights(&self) -> Result<SessionInsights> {
            Ok(SessionInsights {
                total_sessions: 1,
                total_tokens: 0,
            })
        }

        async fn export_session(&self, _id: &str) -> Result<String> {
            Ok("{}".to_string())
        }

        async fn import_session(&self, _json: &str) -> Result<Session> {
            Ok(self.current_session(true))
        }

        async fn copy_session(&self, _session_id: &str, _new_name: String) -> Result<Session> {
            Ok(self.current_session(true))
        }

        async fn truncate_conversation(&self, _session_id: &str, _timestamp: i64) -> Result<()> {
            Ok(())
        }

        async fn update_session_name(
            &self,
            _session_id: &str,
            _name: String,
            _user_set: bool,
        ) -> Result<()> {
            Ok(())
        }

        async fn update_extension_data(
            &self,
            _session_id: &str,
            _extension_data: ExtensionData,
        ) -> Result<()> {
            Ok(())
        }

        async fn update_token_stats(
            &self,
            _session_id: &str,
            _stats: TokenStatsUpdate,
        ) -> Result<()> {
            Ok(())
        }

        async fn update_provider_config(
            &self,
            _session_id: &str,
            _provider_name: Option<String>,
            _model_config: Option<crate::model::ModelConfig>,
        ) -> Result<()> {
            Ok(())
        }

        async fn update_recipe(
            &self,
            _session_id: &str,
            _recipe: Option<crate::recipe::Recipe>,
            _user_recipe_values: Option<HashMap<String, String>>,
        ) -> Result<()> {
            Ok(())
        }

        async fn search_chat_history(
            &self,
            _query: &str,
            _limit: Option<usize>,
            _after_date: Option<chrono::DateTime<chrono::Utc>>,
            _before_date: Option<chrono::DateTime<chrono::Utc>>,
            _exclude_session_id: Option<String>,
        ) -> Result<Vec<ChatHistoryMatch>> {
            Ok(Vec::new())
        }

        async fn commit_session(&self, _id: &str, _options: CommitOptions) -> Result<CommitReport> {
            Ok(CommitReport {
                session_id: "counting-test-store".to_string(),
                messages_scanned: 0,
                memories_created: 0,
                memories_merged: 0,
                source_start_ts: None,
                source_end_ts: None,
                warnings: Vec::new(),
            })
        }

        async fn search_memories(
            &self,
            _query: &str,
            _limit: Option<usize>,
            _session_scope: Option<&str>,
            _categories: Option<Vec<MemoryCategory>>,
        ) -> Result<Vec<MemorySearchResult>> {
            Ok(Vec::new())
        }

        async fn retrieve_context_memories(
            &self,
            _session_id: &str,
            _query: &str,
            _limit: usize,
        ) -> Result<Vec<MemoryRecord>> {
            Ok(Vec::new())
        }

        async fn memory_stats(&self) -> Result<MemoryStats> {
            Ok(MemoryStats::default())
        }

        async fn memory_health(&self) -> Result<MemoryHealth> {
            Ok(MemoryHealth {
                healthy: true,
                message: "counting test store".to_string(),
            })
        }
    }

    #[async_trait]
    impl Provider for NativeOutputSchemaProvider {
        fn metadata() -> ProviderMetadata
        where
            Self: Sized,
        {
            ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "native-output-schema-provider"
        }

        async fn complete_with_model(
            &self,
            _model_config: &crate::model::ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            Err(ProviderError::NotImplemented(
                "test provider should not execute completions".to_string(),
            ))
        }

        fn get_model_config(&self) -> crate::model::ModelConfig {
            crate::model::ModelConfig::new("gpt-5.3-codex").expect("test model config")
        }

        fn supports_native_output_schema(&self) -> bool {
            true
        }
    }

    #[async_trait]
    impl Provider for ModelAwareNativeOutputSchemaProvider {
        fn metadata() -> ProviderMetadata
        where
            Self: Sized,
        {
            ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "model-aware-native-output-schema-provider"
        }

        async fn complete_with_model(
            &self,
            _model_config: &crate::model::ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            Err(ProviderError::NotImplemented(
                "test provider should not execute completions".to_string(),
            ))
        }

        fn get_model_config(&self) -> crate::model::ModelConfig {
            crate::model::ModelConfig::new("fallback-model").expect("test model config")
        }

        fn supports_native_output_schema_with_model(
            &self,
            model_config: &crate::model::ModelConfig,
        ) -> bool {
            model_config.model_name == "native-model"
        }
    }

    #[async_trait]
    impl Provider for ContextLengthExceededProvider {
        fn metadata() -> ProviderMetadata
        where
            Self: Sized,
        {
            ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            "context-length-exceeded-provider"
        }

        async fn complete_with_model(
            &self,
            _model_config: &crate::model::ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            Err(ProviderError::ContextLengthExceeded(
                "mock context overflow".to_string(),
            ))
        }

        fn get_model_config(&self) -> crate::model::ModelConfig {
            crate::model::ModelConfig::new("gpt-5.3-codex").expect("test model config")
        }
    }

    fn build_auto_compaction_disabled_turn_context() -> TurnContextOverride {
        let mut metadata = HashMap::new();
        metadata.insert(
            "lime_runtime".to_string(),
            serde_json::json!({
                "auto_compact": false,
            }),
        );
        TurnContextOverride {
            metadata,
            ..TurnContextOverride::default()
        }
    }

    #[test]
    fn test_new_with_required_shared_thread_runtime_store_uses_initialized_store() {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));
        assert!(Agent::new_with_required_shared_thread_runtime_store().is_ok());
    }

    #[test]
    fn test_extract_proposed_plan_block_returns_inner_markdown() {
        let text = "前言\n<proposed_plan>\n- 调研\n- 实现\n</proposed_plan>\n结尾";
        assert_eq!(
            extract_proposed_plan_block(text).as_deref(),
            Some("- 调研\n- 实现")
        );
    }

    #[test]
    fn test_build_reasoning_summary_sections_splits_blank_line_boundaries() {
        assert_eq!(
            build_reasoning_summary_sections("先判断任务类型\n\n再决定是否联网"),
            Some(vec![
                "先判断任务类型".to_string(),
                "再决定是否联网".to_string()
            ])
        );
        assert_eq!(build_reasoning_summary_sections("   "), None);
    }

    #[test]
    fn test_project_message_emits_plan_runtime_item() {
        let turn = TurnRuntime::new(
            "turn-1",
            "session-1",
            "thread-1",
            Some("实现计划".to_string()),
            None,
        );
        let mut projector = TurnItemRuntimeProjector::new(&turn);
        let message = Message::assistant()
            .with_text("先说明\n<proposed_plan>\n- 调研\n- 实现\n</proposed_plan>\n再继续");

        let events = projector.project_agent_event(&AgentEvent::Message(message));

        assert!(
            events.iter().any(|event| matches!(
                event,
                AgentEvent::ItemStarted { item } | AgentEvent::ItemUpdated { item }
                    if matches!(&item.payload, ItemRuntimePayload::Plan { text } if text == "- 调研\n- 实现")
            )),
            "应生成显式的 plan runtime item"
        );
    }

    #[test]
    fn test_project_message_emits_reasoning_summary_runtime_item() {
        let turn = TurnRuntime::new(
            "turn-2",
            "session-1",
            "thread-1",
            Some("推理摘要".to_string()),
            None,
        );
        let mut projector = TurnItemRuntimeProjector::new(&turn);
        let message = Message::assistant()
            .with_id("assistant-msg-1")
            .with_thinking("先判断任务类型\n\n再决定是否联网", "");

        let events = projector.project_agent_event(&AgentEvent::Message(message));

        assert!(
            events.iter().any(|event| matches!(
                event,
                AgentEvent::ItemStarted { item } | AgentEvent::ItemUpdated { item }
                    if item.id == "reasoning:assistant-msg-1"
                        && matches!(
                            &item.payload,
                            ItemRuntimePayload::Reasoning { text, summary }
                                if text == "先判断任务类型\n\n再决定是否联网"
                                    && summary.as_ref()
                                        == Some(&vec![
                                            "先判断任务类型".to_string(),
                                            "再决定是否联网".to_string(),
                                        ])
                        )
            )),
            "应保留 reasoning summary 分段"
        );
    }

    #[test]
    fn test_project_message_skips_agent_only_text_message() {
        let turn = TurnRuntime::new(
            "turn-hidden",
            "session-1",
            "thread-1",
            Some("隐藏内部提示".to_string()),
            None,
        );
        let mut projector = TurnItemRuntimeProjector::new(&turn);
        let message = Message::user()
            .with_text("internal continuation")
            .agent_only();

        let events = projector.project_agent_event(&AgentEvent::Message(message));

        assert!(
            events.is_empty(),
            "agent-only 消息不应再投影到用户可见事件流"
        );
    }

    #[test]
    fn test_project_tool_response_emits_file_artifact_runtime_item() {
        let turn = TurnRuntime::new(
            "turn-1",
            "session-1",
            "thread-1",
            Some("生成产物".to_string()),
            None,
        );
        let mut projector = TurnItemRuntimeProjector::new(&turn);
        let mut artifact_meta = rmcp::model::Meta::new();
        artifact_meta.0.insert(
            "output_file".to_string(),
            Value::String("/tmp/result.md".to_string()),
        );
        artifact_meta.0.insert(
            "artifact_id".to_string(),
            Value::String("artifact-1".to_string()),
        );

        let message = Message::user().with_tool_response(
            "tool-call-1",
            Ok(CallToolResult {
                content: vec![Content::text("写入完成")],
                structured_content: None,
                is_error: Some(false),
                meta: Some(artifact_meta),
            }),
        );

        let events = projector.project_agent_event(&AgentEvent::Message(message));

        assert!(
            events.iter().any(|event| matches!(
                event,
                AgentEvent::ItemCompleted { item }
                    if item.id == "artifact-1"
                        && matches!(
                            &item.payload,
                            ItemRuntimePayload::FileArtifact { path, source, content, metadata }
                                if path == "/tmp/result.md"
                                    && source == "tool_result"
                                    && content.is_none()
                                    && metadata
                                        .as_ref()
                                        .and_then(|value| value.get("output_file"))
                                        == Some(&Value::String("/tmp/result.md".to_string()))
                        )
            )),
            "应生成显式的 file artifact runtime item"
        );
    }

    #[tokio::test]
    async fn test_ensure_runtime_turn_initialized_reuses_existing_thread_without_reloading_session()
    {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let store = Arc::new(CountingSessionStore::new(Session {
            id: "session-runtime-cache".to_string(),
            working_dir: PathBuf::from("/tmp/runtime-cache"),
            name: "runtime cache".to_string(),
            user_set_name: false,
            session_type: SessionType::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        }));

        let agent = Agent::new_with_required_shared_thread_runtime_store()
            .expect("初始化 agent 失败")
            .with_session_store(store.clone());
        let session_config = SessionConfig {
            id: "session-runtime-cache".to_string(),
            thread_id: Some("thread-runtime-cache".to_string()),
            turn_id: Some("turn-runtime-cache".to_string()),
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: None,
        };

        agent
            .ensure_runtime_turn_initialized(&session_config, Some("第一次初始化".to_string()))
            .await
            .expect("首次初始化 turn runtime 失败");
        agent
            .ensure_runtime_turn_initialized(&session_config, None)
            .await
            .expect("二次初始化 turn runtime 失败");

        assert_eq!(store.get_session_calls(), 1);
    }

    #[tokio::test]
    async fn test_prepare_tools_and_prompt_reuses_listed_tools_for_subagent_prompt_flag() {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let store = Arc::new(CountingSessionStore::new(Session {
            id: "session-prompt-surface".to_string(),
            working_dir: PathBuf::from("/tmp/prompt-surface"),
            name: "prompt surface".to_string(),
            user_set_name: false,
            session_type: SessionType::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        }));

        let agent = Agent::new_with_required_shared_thread_runtime_store()
            .expect("初始化 agent 失败")
            .with_session_store(store.clone());
        agent
            .extension_manager
            .set_context(PlatformExtensionContext {
                session_id: Some("session-prompt-surface".to_string()),
                extension_manager: Some(Arc::downgrade(&agent.extension_manager)),
            })
            .await;

        let working_dir = std::env::current_dir().expect("读取当前目录失败");
        agent
            .prepare_tools_and_prompt(
                &working_dir,
                None,
                &crate::model::ModelConfig::new("test-model").expect("model config"),
            )
            .await
            .expect("准备 tools 与 prompt 失败");

        assert_eq!(store.get_session_calls(), 1);
    }

    #[tokio::test]
    async fn test_prepare_tools_and_prompt_reuses_session_type_hint_after_runtime_init() {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let store = Arc::new(CountingSessionStore::new(Session {
            id: "session-runtime-hint".to_string(),
            working_dir: PathBuf::from("/tmp/runtime-hint"),
            name: "runtime hint".to_string(),
            user_set_name: false,
            session_type: SessionType::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        }));

        let agent = Agent::new_with_required_shared_thread_runtime_store()
            .expect("初始化 agent 失败")
            .with_session_store(store.clone());
        let session_config = SessionConfig {
            id: "session-runtime-hint".to_string(),
            thread_id: Some("thread-runtime-hint".to_string()),
            turn_id: Some("turn-runtime-hint".to_string()),
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: None,
        };

        agent
            .ensure_runtime_turn_initialized(&session_config, Some("首次初始化".to_string()))
            .await
            .expect("初始化 turn runtime 失败");

        let working_dir = std::env::current_dir().expect("读取当前目录失败");
        agent
            .prepare_tools_and_prompt(
                &working_dir,
                None,
                &crate::model::ModelConfig::new("test-model").expect("model config"),
            )
            .await
            .expect("准备 tools 与 prompt 失败");

        assert_eq!(store.get_session_calls(), 1);
    }

    #[tokio::test]
    async fn test_reply_reuses_session_type_hint_after_loading_session() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let store = Arc::new(CountingSessionStore::new(Session {
            id: "session-reply-hint".to_string(),
            working_dir: PathBuf::from("/tmp/reply-hint"),
            name: "reply hint".to_string(),
            user_set_name: false,
            session_type: SessionType::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        }));

        let agent = Agent::new_with_required_shared_thread_runtime_store()
            .expect("初始化 agent 失败")
            .with_session_store(store.clone());
        agent
            .extension_manager
            .set_context(PlatformExtensionContext {
                session_id: Some("session-reply-hint".to_string()),
                extension_manager: Some(Arc::downgrade(&agent.extension_manager)),
            })
            .await;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), "session-reply-hint")
            .await?;

        let session_config = SessionConfig {
            id: "session-reply-hint".to_string(),
            thread_id: Some("thread-reply-hint".to_string()),
            turn_id: Some("turn-reply-hint".to_string()),
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: None,
        };

        let mut stream = agent
            .reply(Message::user().with_text("继续处理"), session_config, None)
            .await?;

        while let Some(event) = stream.next().await {
            if event.is_err() {
                break;
            }
        }

        assert_eq!(store.get_session_calls(), 1);
        Ok(())
    }

    #[tokio::test]
    async fn test_dispatch_tool_call_skips_session_reload_for_non_agent_tools() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let store = Arc::new(CountingSessionStore::new(Session {
            id: "session-tool-dispatch".to_string(),
            working_dir: PathBuf::from("/tmp/tool-dispatch"),
            name: "tool dispatch".to_string(),
            user_set_name: false,
            session_type: SessionType::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        }));

        let agent = Agent::new_with_required_shared_thread_runtime_store()
            .expect("初始化 agent 失败")
            .with_session_store(store.clone());
        agent
            .add_final_output_tool(serde_json::json!({
                "type": "object",
                "properties": {
                    "answer": { "type": "string" }
                },
                "required": ["answer"]
            }))
            .await?;

        let session = store.current_session(false);
        let tool_call = CallToolRequestParam {
            name: FINAL_OUTPUT_TOOL_NAME.into(),
            arguments: Some(
                serde_json::json!({
                    "answer": "ok"
                })
                .as_object()
                .cloned()
                .expect("final output arguments should be an object"),
            ),
        };

        let (_request_id, tool_result) = agent
            .dispatch_tool_call(tool_call, "req-final-output".to_string(), None, &session)
            .await;

        let tool_result = tool_result.expect("final output dispatch should succeed");
        let call_result = tool_result
            .result
            .await
            .expect("final output should resolve successfully");
        assert_eq!(call_result.is_error, Some(false));
        assert_eq!(store.get_session_calls(), 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_add_final_output_tool() -> Result<()> {
        let agent = Agent::new();

        agent
            .add_final_output_tool(serde_json::json!({
                "type": "object",
                "properties": {
                    "result": {"type": "string"}
                }
            }))
            .await?;

        let tools = agent.list_tools(None).await;
        let final_output_tool = tools
            .iter()
            .find(|tool| tool.name == FINAL_OUTPUT_TOOL_NAME);

        assert!(
            final_output_tool.is_some(),
            "Final output tool should be present after adding"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_prepare_session_config_for_reply_merges_session_output_schema() -> Result<()> {
        let agent = Agent::new();
        let output_schema = serde_json::json!({
            "type": "object",
            "properties": {
                "answer": {"type": "string"}
            }
        });

        agent
            .set_session_output_schema(Some(output_schema.clone()))
            .await?;

        let session_config = SessionConfig {
            id: "session-1".to_string(),
            thread_id: None,
            turn_id: None,
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: None,
        };

        let prepared = agent
            .prepare_session_config_for_reply(session_config)
            .await?;
        assert_eq!(
            prepared
                .turn_context
                .as_ref()
                .and_then(|context| context.output_schema.as_ref()),
            Some(&output_schema)
        );
        assert_eq!(
            prepared
                .turn_context
                .as_ref()
                .and_then(|context| context.output_schema_source),
            Some(TurnOutputSchemaSource::Session)
        );

        let final_output_tool = agent.final_output_tool.lock().await;
        assert!(final_output_tool.is_some());
        Ok(())
    }

    #[tokio::test]
    async fn test_prepare_session_config_for_reply_skips_final_output_tool_for_native_provider(
    ) -> Result<()> {
        let agent = Agent::new();
        {
            let mut provider = agent.provider.lock().await;
            *provider = Some(Arc::new(NativeOutputSchemaProvider));
        }

        let output_schema = serde_json::json!({
            "type": "object",
            "properties": {
                "answer": {"type": "string"}
            }
        });

        agent
            .set_session_output_schema(Some(output_schema.clone()))
            .await?;

        let session_config = SessionConfig {
            id: "session-native-1".to_string(),
            thread_id: None,
            turn_id: None,
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: None,
        };

        let prepared = agent
            .prepare_session_config_for_reply(session_config)
            .await?;
        assert_eq!(
            prepared
                .turn_context
                .as_ref()
                .and_then(|context| context.output_schema.as_ref()),
            Some(&output_schema)
        );
        assert_eq!(
            prepared
                .turn_context
                .as_ref()
                .and_then(|context| context.output_schema_source),
            Some(TurnOutputSchemaSource::Session)
        );

        let final_output_tool = agent.final_output_tool.lock().await;
        assert!(final_output_tool.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn test_prepare_session_config_for_reply_uses_turn_model_for_native_schema_detection(
    ) -> Result<()> {
        let agent = Agent::new();
        {
            let mut provider = agent.provider.lock().await;
            *provider = Some(Arc::new(ModelAwareNativeOutputSchemaProvider));
        }

        let output_schema = serde_json::json!({
            "type": "object",
            "properties": {
                "answer": {"type": "string"}
            }
        });

        agent
            .set_session_output_schema(Some(output_schema.clone()))
            .await?;

        let session_config = SessionConfig {
            id: "session-native-2".to_string(),
            thread_id: None,
            turn_id: None,
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: Some(TurnContextOverride {
                model: Some("native-model".to_string()),
                ..TurnContextOverride::default()
            }),
        };

        let prepared = agent
            .prepare_session_config_for_reply(session_config)
            .await?;
        assert_eq!(
            prepared
                .turn_context
                .as_ref()
                .and_then(|context| context.output_schema.as_ref()),
            Some(&output_schema)
        );
        assert_eq!(
            prepared
                .turn_context
                .as_ref()
                .and_then(|context| context.output_schema_source),
            Some(TurnOutputSchemaSource::Session)
        );

        let final_output_tool = agent.final_output_tool.lock().await;
        assert!(final_output_tool.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn test_resolve_turn_output_schema_runtime_tracks_native_strategy_and_model() -> Result<()>
    {
        let agent = Agent::new();
        {
            let mut provider = agent.provider.lock().await;
            *provider = Some(Arc::new(ModelAwareNativeOutputSchemaProvider));
        }

        agent
            .set_session_output_schema(Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "answer": {"type": "string"}
                }
            })))
            .await?;

        let prepared = agent
            .prepare_session_config_for_reply(SessionConfig {
                id: "session-native-runtime".to_string(),
                thread_id: None,
                turn_id: None,
                schedule_id: None,
                max_turns: None,
                retry_config: None,
                system_prompt: None,
                include_context_trace: None,
                turn_context: Some(TurnContextOverride {
                    model: Some("native-model".to_string()),
                    ..TurnContextOverride::default()
                }),
            })
            .await?;

        let runtime = agent
            .resolve_turn_output_schema_runtime(prepared.turn_context.as_ref())
            .await;

        assert_eq!(
            runtime,
            Some(TurnOutputSchemaRuntime {
                source: TurnOutputSchemaSource::Session,
                strategy: TurnOutputSchemaStrategy::Native,
                provider_name: Some("model-aware-native-output-schema-provider".to_string()),
                model_name: Some("native-model".to_string()),
            })
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_reply_surfaces_manual_compaction_hint_when_overflow_auto_compaction_disabled(
    ) -> Result<()> {
        let agent = Agent::new();
        let session = SessionManager::create_session(
            PathBuf::default(),
            "overflow-auto-compact-disabled".to_string(),
            SessionType::Hidden,
        )
        .await?;

        agent
            .update_provider(Arc::new(ContextLengthExceededProvider), &session.id)
            .await?;

        let session_config = SessionConfig {
            id: session.id.clone(),
            thread_id: None,
            turn_id: Some("turn-overflow-auto-compact-disabled".to_string()),
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: Some(build_auto_compaction_disabled_turn_context()),
        };

        let mut stream = agent
            .reply(Message::user().with_text("继续处理"), session_config, None)
            .await?;

        let mut saw_disabled_notification = false;
        let mut saw_context_compaction_started = false;
        let mut saw_history_replaced = false;

        while let Some(event) = stream.next().await {
            match event? {
                AgentEvent::Message(message) => {
                    if let Some(MessageContent::SystemNotification(notification)) =
                        message.content.first()
                    {
                        if notification.msg == AUTO_COMPACTION_DISABLED_CONTEXT_LIMIT_TEXT {
                            saw_disabled_notification = true;
                        }
                    }
                }
                AgentEvent::ContextCompactionStarted { .. } => {
                    saw_context_compaction_started = true;
                }
                AgentEvent::HistoryReplaced(_) => {
                    saw_history_replaced = true;
                }
                _ => {}
            }
        }

        assert!(
            saw_disabled_notification,
            "禁用自动压缩后，overflow 应提示手动压缩而不是静默失败"
        );
        assert!(
            !saw_context_compaction_started,
            "禁用自动压缩后，不应再启动 overflow recovery compaction"
        );
        assert!(!saw_history_replaced, "禁用自动压缩后，不应发生历史替换");

        Ok(())
    }

    #[tokio::test]
    async fn test_tool_inspection_manager_has_all_inspectors() -> Result<()> {
        let agent = Agent::new();

        // Verify that the tool inspection manager has all expected inspectors
        let inspector_names = agent.tool_inspection_manager.inspector_names();

        assert!(
            inspector_names.contains(&"repetition"),
            "Tool inspection manager should contain repetition inspector"
        );
        assert!(
            inspector_names.contains(&"permission"),
            "Tool inspection manager should contain permission inspector"
        );
        assert!(
            inspector_names.contains(&"security"),
            "Tool inspection manager should contain security inspector"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_agent_has_tool_registry() -> Result<()> {
        let agent = Agent::new();

        // Verify that the tool registry is initialized
        let registry = agent.tool_registry();
        let registry_guard = registry.read().await;

        // Verify core native tools are registered
        assert!(
            registry_guard.contains("Bash"),
            "Bash tool should be registered"
        );
        assert!(
            registry_guard.contains("Read"),
            "Read tool should be registered"
        );
        assert!(
            registry_guard.contains("Write"),
            "Write tool should be registered"
        );
        assert!(
            registry_guard.contains("Edit"),
            "Edit tool should be registered"
        );
        assert!(
            registry_guard.contains("Glob"),
            "Glob tool should be registered"
        );
        assert!(
            registry_guard.contains("Grep"),
            "Grep tool should be registered"
        );
        assert!(
            registry_guard.contains("ListMcpResourcesTool"),
            "ListMcpResourcesTool should be registered"
        );
        assert!(
            registry_guard.contains("ReadMcpResourceTool"),
            "ReadMcpResourceTool should be registered"
        );
        assert!(
            registry_guard.contains("ToolSearch"),
            "ToolSearch should be registered"
        );
        assert!(
            registry_guard.contains("AskUserQuestion"),
            "AskUserQuestion should be registered"
        );
        let tool_gates = current_surface_tool_gates();
        assert_eq!(
            registry_guard.contains("Config"),
            should_register_current_surface_tool("Config", tool_gates),
            "Config registration should match current surface gate"
        );
        assert_eq!(
            registry_guard.contains("Sleep"),
            should_register_current_surface_tool("Sleep", tool_gates),
            "Sleep registration should match current surface gate"
        );

        // Verify tool count
        assert!(
            registry_guard.native_tool_count() >= 10,
            "Should have at least 10 native tools"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_agent_with_tool_config() -> Result<()> {
        let config = ToolRegistrationConfig::new().with_pdf_enabled(true);
        let agent = Agent::with_tool_config(config);

        // Verify that the tool registry is initialized
        let registry = agent.tool_registry();
        let registry_guard = registry.read().await;

        // Verify core native tools are registered
        assert!(
            registry_guard.contains("Bash"),
            "Bash tool should be registered"
        );
        assert!(
            registry_guard.contains("Read"),
            "Read tool should be registered"
        );
        assert!(
            registry_guard.contains("ListMcpResourcesTool"),
            "ListMcpResourcesTool should be registered"
        );
        assert!(
            registry_guard.contains("ReadMcpResourceTool"),
            "ReadMcpResourceTool should be registered"
        );
        assert!(
            registry_guard.contains("ToolSearch"),
            "ToolSearch should be registered"
        );
        assert!(
            registry_guard.contains("AskUserQuestion"),
            "AskUserQuestion should be registered"
        );
        let tool_gates = current_surface_tool_gates();
        assert_eq!(
            registry_guard.contains("Config"),
            should_register_current_surface_tool("Config", tool_gates),
            "Config registration should match current surface gate"
        );
        assert_eq!(
            registry_guard.contains("Sleep"),
            should_register_current_surface_tool("Sleep", tool_gates),
            "Sleep registration should match current surface gate"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_list_tools_includes_current_agent_tool_without_extensions() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let agent = Agent::new();
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-tool-visibility".to_string(),
            SessionType::User,
        )
        .await?;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;

        assert!(agent.subagents_enabled().await);

        let tools = agent.list_tools(None).await;
        assert!(
            tools.iter().any(|tool| tool.name == AGENT_TOOL_NAME),
            "Agent tool should be visible once provider is ready, even without extensions"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_list_tools_excludes_legacy_agent_control_surface() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let agent = Agent::new();
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-tool-legacy-surface".to_string(),
            SessionType::User,
        )
        .await?;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;

        let tools = agent.list_tools(None).await;
        for legacy_name in [
            "spawn_agent",
            "send_input",
            "wait_agent",
            "resume_agent",
            "close_agent",
            "analyze_image",
        ] {
            assert!(
                !tools.iter().any(|tool| tool.name == legacy_name),
                "legacy tool surface should stay hidden: {legacy_name}"
            );
        }

        Ok(())
    }

    #[test]
    fn test_current_surface_resource_helpers_are_visibility_gated() {
        assert!(!should_expose_registered_tool(
            "ListMcpResourcesTool",
            false
        ));
        assert!(!should_expose_registered_tool("ReadMcpResourceTool", false));
        assert!(should_expose_registered_tool("ListMcpResourcesTool", true));
        assert!(should_expose_registered_tool("ReadMcpResourceTool", true));
        assert!(should_expose_registered_tool("ToolSearch", false));
    }

    #[test]
    fn test_current_surface_main_thread_tool_gates_match_reference_contract() {
        let external_env = HashMap::new();
        let external_gates =
            crate::tools::current_surface_tool_gates_from_env_map(&external_env, true);
        assert!(!external_gates.config);
        assert!(!external_gates.sleep);
        assert!(!external_gates.workflow);
        assert!(!external_gates.powershell);

        let ant_env = HashMap::from([("USER_TYPE".to_string(), "ant".to_string())]);
        let ant_gates = crate::tools::current_surface_tool_gates_from_env_map(&ant_env, true);
        assert!(ant_gates.config);
        assert!(!ant_gates.sleep);
        assert!(!ant_gates.workflow);
        assert!(ant_gates.powershell);

        let external_powershell_env = HashMap::from([(
            crate::tools::CURRENT_SURFACE_POWERSHELL_ENV.to_string(),
            "1".to_string(),
        )]);
        let external_powershell_gates =
            crate::tools::current_surface_tool_gates_from_env_map(&external_powershell_env, true);
        assert!(external_powershell_gates.powershell);

        let ant_powershell_disabled_env = HashMap::from([
            ("USER_TYPE".to_string(), "ant".to_string()),
            (
                crate::tools::CURRENT_SURFACE_POWERSHELL_ENV.to_string(),
                "0".to_string(),
            ),
            ("PROACTIVE".to_string(), "true".to_string()),
            ("WORKFLOW_SCRIPTS".to_string(), "yes".to_string()),
        ]);
        let ant_powershell_disabled_gates = crate::tools::current_surface_tool_gates_from_env_map(
            &ant_powershell_disabled_env,
            true,
        );
        assert!(ant_powershell_disabled_gates.config);
        assert!(ant_powershell_disabled_gates.sleep);
        assert!(ant_powershell_disabled_gates.workflow);
        assert!(!ant_powershell_disabled_gates.powershell);

        let non_windows_env = HashMap::from([(
            crate::tools::CURRENT_SURFACE_POWERSHELL_ENV.to_string(),
            "1".to_string(),
        )]);
        let non_windows_gates =
            crate::tools::current_surface_tool_gates_from_env_map(&non_windows_env, false);
        assert!(!non_windows_gates.powershell);
    }

    #[test]
    fn test_current_surface_subagent_tool_visibility_matches_async_surface() {
        assert!(should_expose_tool_for_session(
            "Bash",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(should_expose_tool_for_session(
            "ToolSearch",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(should_expose_tool_for_session(
            FINAL_OUTPUT_TOOL_NAME,
            Some(SessionType::SubAgent),
            false
        ));
        assert!(should_expose_tool_for_session(
            "mcp__docs__search",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "TaskOutput",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "TaskStop",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "SendUserMessage",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "SendMessage",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "Config",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "Sleep",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "Workflow",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            "ListMcpResourcesTool",
            Some(SessionType::SubAgent),
            false
        ));
        assert!(!should_expose_tool_for_session(
            AGENT_TOOL_NAME,
            Some(SessionType::SubAgent),
            false
        ));
    }

    #[test]
    fn test_current_surface_subagent_plan_mode_keeps_exit_plan_mode_visible() {
        let tool_gates = CurrentSurfaceToolGates {
            config: false,
            sleep: false,
            cron: false,
            remote_trigger: false,
            workflow: false,
            powershell: false,
        };

        assert!(should_expose_tool_for_session_with_gates(
            "ExitPlanMode",
            Some(SessionType::SubAgent),
            false,
            tool_gates,
            false,
            true
        ));
        assert!(!should_expose_tool_for_session_with_gates(
            "EnterPlanMode",
            Some(SessionType::SubAgent),
            false,
            tool_gates,
            false,
            true
        ));
    }

    #[test]
    fn test_current_surface_team_subagent_keeps_agent_visible_for_sync_nested_subagents() {
        let tool_gates = CurrentSurfaceToolGates {
            config: false,
            sleep: false,
            cron: false,
            remote_trigger: false,
            workflow: false,
            powershell: false,
        };

        assert!(should_expose_tool_for_session_with_gates(
            AGENT_TOOL_NAME,
            Some(SessionType::SubAgent),
            false,
            tool_gates,
            true,
            false
        ));
    }

    #[tokio::test]
    async fn test_list_tools_hides_resource_helpers_without_resource_extensions() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let agent = Agent::new();
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-resource-helper-visibility".to_string(),
            SessionType::User,
        )
        .await?;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;

        let tools = agent.list_tools(None).await;

        assert!(
            tools.iter().any(|tool| tool.name == "ToolSearch"),
            "ToolSearch should stay visible on the current surface"
        );
        assert!(
            !tools.iter().any(|tool| tool.name == "ListMcpResourcesTool"),
            "resource helper should stay hidden until a resource-capable extension is active"
        );
        assert!(
            !tools.iter().any(|tool| tool.name == "ReadMcpResourceTool"),
            "resource helper should stay hidden until a resource-capable extension is active"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_list_tools_applies_current_surface_main_thread_gates() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let agent = Agent::new();
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-main-thread-surface".to_string(),
            SessionType::User,
        )
        .await?;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;

        let tools = agent.list_tools(None).await;
        let tool_gates = current_surface_tool_gates();

        for (tool_name, expected_visible) in [
            ("Config", tool_gates.config),
            ("Sleep", tool_gates.sleep),
            ("Workflow", tool_gates.workflow),
            ("PowerShell", tool_gates.powershell),
        ] {
            assert_eq!(
                tools.iter().any(|tool| tool.name == tool_name),
                expected_visible,
                "main-thread current surface visibility mismatch for {tool_name}"
            );
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_list_tools_hides_main_thread_only_tools_for_subagent_sessions() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let agent = Agent::new();
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-subagent-surface".to_string(),
            SessionType::SubAgent,
        )
        .await?;
        agent
            .extension_manager
            .set_context(PlatformExtensionContext {
                session_id: Some(session.id.clone()),
                extension_manager: Some(Arc::downgrade(&agent.extension_manager)),
            })
            .await;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;
        agent
            .add_final_output_tool(serde_json::json!({
                "type": "object",
                "properties": {
                    "answer": { "type": "string" }
                },
                "required": ["answer"]
            }))
            .await?;

        let tools = agent.list_tools(None).await;

        for visible_name in [
            "Bash",
            "Read",
            "Edit",
            "Write",
            "TaskCreate",
            "TaskGet",
            "TaskList",
            "TaskUpdate",
            "ToolSearch",
            FINAL_OUTPUT_TOOL_NAME,
            "EnterWorktree",
            "ExitWorktree",
        ] {
            assert!(
                tools.iter().any(|tool| tool.name == visible_name),
                "subagent current surface should keep: {visible_name}"
            );
        }

        for hidden_name in [
            "TaskOutput",
            "TaskStop",
            "SendUserMessage",
            "Config",
            "Sleep",
            "Workflow",
            "AskUserQuestion",
            "EnterPlanMode",
            "ExitPlanMode",
        ] {
            assert!(
                !tools.iter().any(|tool| tool.name == hidden_name),
                "subagent current surface should hide: {hidden_name}"
            );
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_list_tools_exposes_teammate_coordination_tools_for_team_subagents() -> Result<()>
    {
        use crate::execution::manager::AgentManager;
        use crate::session::{
            save_team_membership, save_team_state, TeamMember, TeamMembershipState,
            TeamSessionState,
        };

        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let manager = AgentManager::new_with_thread_runtime_store(
            None,
            Arc::new(InMemoryThreadRuntimeStore::default()),
        )
        .await?;
        let working_dir = tempfile::tempdir()?;
        let lead = SessionManager::create_session(
            working_dir.path().to_path_buf(),
            "team-lead".to_string(),
            SessionType::User,
        )
        .await?;
        let child = SessionManager::create_session(
            working_dir.path().to_path_buf(),
            "team-child".to_string(),
            SessionType::SubAgent,
        )
        .await?;

        let mut team_state = TeamSessionState::new("delivery-team", lead.id.clone(), None, None);
        team_state.add_or_update_member(TeamMember::teammate(
            child.id.clone(),
            "verifier".to_string(),
            None,
        ));
        save_team_state(&lead.id, Some(team_state)).await?;
        save_team_membership(
            &child.id,
            Some(TeamMembershipState {
                team_name: "delivery-team".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "verifier".to_string(),
                agent_type: None,
            }),
        )
        .await?;

        let child_agent = manager.get_or_create_agent(child.id.clone()).await?;
        let tools = child_agent.list_tools(None).await;

        for visible_name in [
            AGENT_TOOL_NAME,
            "SendMessage",
            "ListPeers",
            "CronCreate",
            "CronList",
            "CronDelete",
        ] {
            assert!(
                tools.iter().any(|tool| tool.name == visible_name),
                "team subagent current surface should keep teammate tool: {visible_name}"
            );
        }

        for hidden_name in ["TeamCreate", "TeamDelete", "SendUserMessage"] {
            assert!(
                !tools.iter().any(|tool| tool.name == hidden_name),
                "team subagent current surface should still hide main-thread-only tool: {hidden_name}"
            );
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_team_subagent_agent_tool_reaches_sync_nested_subagent_runtime() -> Result<()> {
        use crate::execution::manager::AgentManager;
        use crate::session::{
            save_team_membership, save_team_state, TeamMember, TeamMembershipState,
            TeamSessionState,
        };

        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let manager = AgentManager::new_with_thread_runtime_store(
            None,
            Arc::new(InMemoryThreadRuntimeStore::default()),
        )
        .await?;
        let working_dir = tempfile::tempdir()?;
        let lead = SessionManager::create_session(
            working_dir.path().to_path_buf(),
            "sync-team-lead".to_string(),
            SessionType::User,
        )
        .await?;
        let child = SessionManager::create_session(
            working_dir.path().to_path_buf(),
            "sync-team-child".to_string(),
            SessionType::SubAgent,
        )
        .await?;

        let mut team_state = TeamSessionState::new("delivery-team", lead.id.clone(), None, None);
        team_state.add_or_update_member(TeamMember::teammate(
            child.id.clone(),
            "verifier".to_string(),
            None,
        ));
        save_team_state(&lead.id, Some(team_state)).await?;
        save_team_membership(
            &child.id,
            Some(TeamMembershipState {
                team_name: "delivery-team".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "verifier".to_string(),
                agent_type: None,
            }),
        )
        .await?;

        let child_agent = manager.get_or_create_agent(child.id.clone()).await?;
        let tool_call = CallToolRequestParam {
            name: AGENT_TOOL_NAME.into(),
            arguments: Some(
                serde_json::json!({
                    "description": "继续拆解",
                    "prompt": "同步执行下一层子任务"
                })
                .as_object()
                .cloned()
                .expect("agent tool arguments should be an object"),
            ),
        };

        let (_request_id, tool_result) = child_agent
            .dispatch_tool_call(tool_call, "req-team-sync-agent".to_string(), None, &child)
            .await;
        let error = match tool_result {
            Ok(_) => panic!("missing provider should surface sync runtime path"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::INTERNAL_ERROR);
        assert_eq!(error.message, "Provider is required");

        Ok(())
    }

    #[tokio::test]
    async fn test_team_subagent_agent_tool_rejects_background_and_teammate_spawn_fields(
    ) -> Result<()> {
        use crate::session::{
            save_team_membership, save_team_state, TeamMember, TeamMembershipState,
            TeamSessionState,
        };

        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let spawn_agent_callback = Arc::new(move |_request: SpawnAgentRequest| {
            Box::pin(async move {
                Ok(SpawnAgentResponse {
                    agent_id: "agent-team-child".to_string(),
                    nickname: Some("team-child".to_string()),
                    extra: std::collections::BTreeMap::new(),
                })
            })
                as Pin<Box<dyn Future<Output = Result<SpawnAgentResponse, String>> + Send>>
        });
        let agent =
            Agent::with_tool_config(ToolRegistrationConfig::new().with_agent_control_tools(
                AgentControlToolConfig::new().with_spawn_agent_callback(spawn_agent_callback),
            ));
        let working_dir = tempfile::tempdir()?;
        let lead = SessionManager::create_session(
            working_dir.path().to_path_buf(),
            "team-guard-lead".to_string(),
            SessionType::User,
        )
        .await?;
        let child = SessionManager::create_session(
            working_dir.path().to_path_buf(),
            "team-guard-child".to_string(),
            SessionType::SubAgent,
        )
        .await?;

        let mut team_state = TeamSessionState::new("delivery-team", lead.id.clone(), None, None);
        team_state.add_or_update_member(TeamMember::teammate(
            child.id.clone(),
            "verifier".to_string(),
            None,
        ));
        save_team_state(&lead.id, Some(team_state)).await?;
        save_team_membership(
            &child.id,
            Some(TeamMembershipState {
                team_name: "delivery-team".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "verifier".to_string(),
                agent_type: None,
            }),
        )
        .await?;

        let background_call = CallToolRequestParam {
            name: AGENT_TOOL_NAME.into(),
            arguments: Some(
                serde_json::json!({
                    "description": "后台校验",
                    "prompt": "尝试启动后台 agent",
                    "run_in_background": true
                })
                .as_object()
                .cloned()
                .expect("agent tool arguments should be an object"),
            ),
        };
        let (_request_id, background_result) = agent
            .dispatch_tool_call(
                background_call,
                "req-team-background".to_string(),
                None,
                &child,
            )
            .await;
        let background_error = match background_result {
            Ok(_) => panic!("team subagent background agent should be rejected"),
            Err(error) => error,
        };
        assert_eq!(background_error.code, ErrorCode::INVALID_PARAMS);
        assert_eq!(
            background_error.message,
            "Team subagents cannot spawn background agents in the current runtime"
        );

        let teammate_call = CallToolRequestParam {
            name: AGENT_TOOL_NAME.into(),
            arguments: Some(
                serde_json::json!({
                    "description": "派生 teammate",
                    "prompt": "尝试再创建 teammate",
                    "name": "nested",
                    "team_name": "delivery-team"
                })
                .as_object()
                .cloned()
                .expect("agent tool arguments should be an object"),
            ),
        };
        let (_request_id, teammate_result) = agent
            .dispatch_tool_call(teammate_call, "req-team-nested".to_string(), None, &child)
            .await;
        let teammate_error = match teammate_result {
            Ok(_) => panic!("team subagent teammate spawn should be rejected"),
            Err(error) => error,
        };
        assert_eq!(teammate_error.code, ErrorCode::INVALID_PARAMS);
        assert_eq!(
            teammate_error.message,
            "Team subagents cannot spawn teammates in the current runtime; omit name and team_name"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_agent_tool_routes_async_current_surface_through_callbacks() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let captured = Arc::new(std::sync::Mutex::new(None::<SpawnAgentRequest>));
        let captured_clone = captured.clone();
        let spawn_agent_callback = Arc::new(move |request: SpawnAgentRequest| {
            *captured_clone.lock().expect("capture lock") = Some(request.clone());
            Box::pin(async move {
                Ok(SpawnAgentResponse {
                    agent_id: "agent-42".to_string(),
                    nickname: Some("delegate".to_string()),
                    extra: std::collections::BTreeMap::new(),
                })
            })
                as Pin<Box<dyn Future<Output = Result<SpawnAgentResponse, String>> + Send>>
        });

        let agent =
            Agent::with_tool_config(ToolRegistrationConfig::new().with_agent_control_tools(
                AgentControlToolConfig::new().with_spawn_agent_callback(spawn_agent_callback),
            ));
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-callback-surface".to_string(),
            SessionType::User,
        )
        .await?;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;

        let arguments = serde_json::json!({
            "description": "并行验证",
            "prompt": "检查这个改动是否会影响子代理通信",
            "name": "verifier",
            "run_in_background": true
        });
        let tool_call = CallToolRequestParam {
            name: AGENT_TOOL_NAME.into(),
            arguments: Some(
                arguments
                    .as_object()
                    .cloned()
                    .expect("agent tool arguments should be an object"),
            ),
        };

        let (_request_id, tool_result) = agent
            .dispatch_tool_call(tool_call, "req-agent-callback".to_string(), None, &session)
            .await;
        let tool_result = tool_result.expect("agent dispatch should succeed");
        let call_result = tool_result
            .result
            .await
            .expect("callback-backed agent result");

        assert_eq!(
            call_result
                .structured_content
                .as_ref()
                .and_then(|value| value.get("status"))
                .and_then(Value::as_str),
            Some("async_launched")
        );
        assert_eq!(
            call_result
                .structured_content
                .as_ref()
                .and_then(|value| value.get("agentId"))
                .and_then(Value::as_str),
            Some("agent-42")
        );

        let captured_request = captured
            .lock()
            .expect("capture lock")
            .clone()
            .expect("spawn callback should capture request");
        assert_eq!(captured_request.parent_session_id, session.id);
        assert_eq!(captured_request.message, "检查这个改动是否会影响子代理通信");
        assert_eq!(captured_request.name.as_deref(), Some("verifier"));

        Ok(())
    }

    #[tokio::test]
    async fn test_agent_tool_routes_cwd_override_through_callbacks() -> Result<()> {
        initialize_shared_thread_runtime_store(Arc::new(InMemoryThreadRuntimeStore::default()));

        let captured = Arc::new(std::sync::Mutex::new(None::<SpawnAgentRequest>));
        let captured_clone = captured.clone();
        let spawn_agent_callback = Arc::new(move |request: SpawnAgentRequest| {
            *captured_clone.lock().expect("capture lock") = Some(request.clone());
            Box::pin(async move {
                Ok(SpawnAgentResponse {
                    agent_id: "agent-cwd".to_string(),
                    nickname: Some("cwd-agent".to_string()),
                    extra: std::collections::BTreeMap::new(),
                })
            })
                as Pin<Box<dyn Future<Output = Result<SpawnAgentResponse, String>> + Send>>
        });

        let agent =
            Agent::with_tool_config(ToolRegistrationConfig::new().with_agent_control_tools(
                AgentControlToolConfig::new().with_spawn_agent_callback(spawn_agent_callback),
            ));
        let session = SessionManager::create_session(
            PathBuf::from("."),
            "agent-cwd-callback-surface".to_string(),
            SessionType::User,
        )
        .await?;
        agent
            .update_provider(Arc::new(NativeOutputSchemaProvider), &session.id)
            .await?;

        let cwd = tempfile::tempdir()?;
        let arguments = serde_json::json!({
            "description": "隔离目录验证",
            "prompt": "在自定义 cwd 中执行这个子任务",
            "cwd": cwd.path().display().to_string()
        });
        let tool_call = CallToolRequestParam {
            name: AGENT_TOOL_NAME.into(),
            arguments: Some(
                arguments
                    .as_object()
                    .cloned()
                    .expect("agent tool arguments should be an object"),
            ),
        };

        let (_request_id, tool_result) = agent
            .dispatch_tool_call(tool_call, "req-agent-cwd".to_string(), None, &session)
            .await;
        let tool_result = tool_result.expect("agent dispatch should succeed");
        let call_result = tool_result
            .result
            .await
            .expect("callback-backed agent result");

        assert_eq!(
            call_result
                .structured_content
                .as_ref()
                .and_then(|value| value.get("status"))
                .and_then(Value::as_str),
            Some("async_launched")
        );

        let captured_request = captured
            .lock()
            .expect("capture lock")
            .clone()
            .expect("spawn callback should capture request");
        assert_eq!(
            captured_request.cwd.as_deref(),
            Some(cwd.path().to_string_lossy().as_ref())
        );

        Ok(())
    }

    #[test]
    fn test_native_tool_result_to_call_tool_result_preserves_metadata_and_error_flag() {
        let tool_result = crate::tools::ToolResult::error("failed")
            .with_metadata("tool_surface_updated", Value::Bool(true))
            .with_metadata("matches", serde_json::json!(["demo__tool"]));

        let call_result = native_tool_result_to_call_tool_result(tool_result);

        assert_eq!(call_result.is_error, Some(true));
        assert_eq!(
            call_result
                .structured_content
                .as_ref()
                .and_then(|value| value.get("tool_surface_updated")),
            Some(&Value::Bool(true))
        );
        assert!(tool_surface_updated_from_call_tool_result(&call_result));
    }

    #[tokio::test]
    async fn test_agent_register_mcp_tool() -> Result<()> {
        let agent = Agent::new();

        // Register an MCP tool
        agent
            .register_mcp_tool(
                "test_mcp_tool".to_string(),
                "A test MCP tool".to_string(),
                serde_json::json!({"type": "object"}),
                "test_server".to_string(),
            )
            .await;

        // Verify the MCP tool is registered
        let registry = agent.tool_registry();
        let registry_guard = registry.read().await;
        assert!(
            registry_guard.contains("test_mcp_tool"),
            "MCP tool should be registered"
        );
        assert!(
            registry_guard.contains_mcp("test_mcp_tool"),
            "Should be registered as MCP tool"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_agent_file_read_history() -> Result<()> {
        let agent = Agent::new();

        // Verify that the file read history is initialized and accessible
        let history = agent.file_read_history();
        assert!(
            history.read().unwrap().is_empty(),
            "History should be empty initially"
        );

        Ok(())
    }
}
