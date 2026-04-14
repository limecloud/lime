//! Agent control tools.
//!
//! 提供当前 delegation / subagent 运行时的通用抽象，允许宿主通过
//! callback 注入真实 agent runtime，并只对外保留 current surface 需要的
//! spawn/send 能力。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::session::{resolve_named_subagent_child_session, resolve_team_context};
use crate::tools::base::Tool;
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;
use crate::tools::registry::ToolRegistry;

type CallbackFuture<T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send>>;

pub type SpawnAgentCallback =
    Arc<dyn Fn(SpawnAgentRequest) -> CallbackFuture<SpawnAgentResponse> + Send + Sync>;
pub type SendInputCallback =
    Arc<dyn Fn(SendInputRequest) -> CallbackFuture<SendInputResponse> + Send + Sync>;

const SEND_MESSAGE_TOOL_ALIASES: &[&str] = &["SendMessageTool", "SendInput", "SendInputTool"];

#[derive(Clone, Default)]
pub struct AgentControlToolConfig {
    pub spawn_agent: Option<SpawnAgentCallback>,
    pub send_input: Option<SendInputCallback>,
}

impl AgentControlToolConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_spawn_agent_callback(mut self, callback: SpawnAgentCallback) -> Self {
        self.spawn_agent = Some(callback);
        self
    }

    pub fn with_send_input_callback(mut self, callback: SendInputCallback) -> Self {
        self.send_input = Some(callback);
        self
    }

    pub fn is_empty(&self) -> bool {
        self.spawn_agent.is_none() && self.send_input.is_none()
    }
}

pub fn register_agent_control_tools(registry: &mut ToolRegistry, config: &AgentControlToolConfig) {
    if let Some(callback) = config.spawn_agent.clone() {
        registry.register(Box::new(SpawnAgentTool::new(callback)));
    }
    if let Some(callback) = config.send_input.clone() {
        registry.register(Box::new(SendInputTool::new(callback)));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpawnAgentRequest {
    pub parent_session_id: String,
    pub message: String,
    pub name: Option<String>,
    #[serde(alias = "team_name")]
    pub team_name: Option<String>,
    #[serde(alias = "agent_type")]
    pub agent_type: Option<String>,
    pub model: Option<String>,
    #[serde(default, alias = "run_in_background")]
    pub run_in_background: bool,
    #[serde(alias = "reasoning_effort")]
    pub reasoning_effort: Option<String>,
    #[serde(alias = "fork_context")]
    pub fork_context: bool,
    #[serde(alias = "blueprint_role_id")]
    pub blueprint_role_id: Option<String>,
    #[serde(alias = "blueprint_role_label")]
    pub blueprint_role_label: Option<String>,
    #[serde(alias = "profile_id")]
    pub profile_id: Option<String>,
    #[serde(alias = "profile_name")]
    pub profile_name: Option<String>,
    #[serde(alias = "role_key")]
    pub role_key: Option<String>,
    #[serde(default, alias = "skill_ids")]
    pub skill_ids: Vec<String>,
    #[serde(default, alias = "skill_directories")]
    pub skill_directories: Vec<String>,
    #[serde(alias = "team_preset_id")]
    pub team_preset_id: Option<String>,
    pub theme: Option<String>,
    #[serde(alias = "system_overlay")]
    pub system_overlay: Option<String>,
    #[serde(alias = "output_contract")]
    pub output_contract: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub isolation: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpawnAgentResponse {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AgentToolInput {
    description: String,
    prompt: String,
    #[serde(default, alias = "subagent_type")]
    subagent_type: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default, alias = "run_in_background")]
    run_in_background: bool,
    #[serde(default)]
    name: Option<String>,
    #[serde(default, alias = "team_name")]
    team_name: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    isolation: Option<String>,
    #[serde(default, alias = "reasoning_effort")]
    reasoning_effort: Option<String>,
    #[serde(default, alias = "fork_context")]
    fork_context: bool,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendInputRequest {
    pub id: String,
    pub message: String,
    #[serde(default)]
    pub interrupt: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SendMessageToolInput {
    to: String,
    #[serde(default)]
    summary: Option<String>,
    message: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StructuredMessage {
    ShutdownRequest {
        #[serde(default)]
        reason: Option<String>,
    },
    ShutdownResponse {
        request_id: String,
        approve: bool,
        #[serde(default)]
        reason: Option<String>,
    },
    PlanApprovalResponse {
        request_id: String,
        approve: bool,
        #[serde(default)]
        feedback: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MessageRouting {
    pub sender: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_color: Option<String>,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessageOutput {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing: Option<MessageRouting>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BroadcastOutput {
    pub success: bool,
    pub message: String,
    pub recipients: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing: Option<MessageRouting>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RequestOutput {
    pub success: bool,
    pub message: String,
    #[serde(rename = "request_id")]
    pub request_id: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResponseOutput {
    pub success: bool,
    pub message: String,
    #[serde(rename = "request_id", skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

pub type SendMessageToolOutput = Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SendInputResponse {
    pub submission_id: String,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PeerAddressScheme {
    Uds,
    Bridge,
}

fn normalize_required_text(value: &str, field_name: &str) -> Result<String, ToolError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ToolError::invalid_params(format!("{field_name} 不能为空")));
    }

    Ok(trimmed.to_string())
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化结果失败: {error}")))
}

#[derive(Clone)]
pub struct SpawnAgentTool {
    callback: SpawnAgentCallback,
}

impl SpawnAgentTool {
    pub fn new(callback: SpawnAgentCallback) -> Self {
        Self { callback }
    }
}

#[async_trait]
impl Tool for SpawnAgentTool {
    fn name(&self) -> &str {
        "Agent"
    }

    fn description(&self) -> &str {
        "Launch a new agent. 适合把独立子问题委派给新的协作成员；创建后可结合 SendMessage 与 ListPeers 继续协作。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "description": { "type": "string", "description": "3-5 个词的任务标题，用于展示与回顾。" },
                "prompt": { "type": "string", "description": "发给子代理的完整任务说明。" },
                "subagent_type": { "type": "string", "description": "可选子代理类型，例如 explorer / planner / executor。" },
                "model": { "type": "string", "description": "可选模型覆盖。" },
                "run_in_background": { "type": "boolean", "description": "是否在后台启动子代理。" },
                "name": { "type": "string", "description": "可选名字；创建后可通过 SendMessage({to: name}) 继续沟通。" },
                "team_name": { "type": "string", "description": "可选 team 名称；未传时沿用当前 team 上下文。" },
                "mode": { "type": "string", "description": "可选权限模式；当前 runtime 是否支持由宿主决定。" },
                "isolation": { "type": "string", "enum": ["worktree", "remote"], "description": "可选隔离模式；当前 runtime 是否支持由宿主决定。" },
                "reasoning_effort": { "type": "string", "description": "可选推理强度覆盖。" },
                "fork_context": { "type": "boolean", "description": "是否复制当前上下文给子代理。" },
                "cwd": { "type": "string", "description": "可选工作目录绝对路径。" }
            },
            "required": ["description", "prompt"],
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: AgentToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("Agent 参数无效: {error}")))?;
        let description = normalize_required_text(&input.description, "description")?;
        let prompt = normalize_required_text(&input.prompt, "prompt")?;
        let parent_session_id = normalize_required_text(&context.session_id, "session_id")?;
        let response = (self.callback)(SpawnAgentRequest {
            parent_session_id,
            message: prompt.clone(),
            name: normalize_optional_text(input.name),
            team_name: normalize_optional_text(input.team_name),
            agent_type: normalize_optional_text(input.subagent_type),
            model: normalize_optional_text(input.model),
            run_in_background: input.run_in_background,
            reasoning_effort: normalize_optional_text(input.reasoning_effort),
            fork_context: input.fork_context,
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
            mode: normalize_optional_text(input.mode),
            isolation: normalize_optional_text(input.isolation),
            cwd: normalize_optional_text(input.cwd),
        })
        .await
        .map_err(ToolError::execution_failed)?;

        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "agentId".to_string(),
            Value::String(response.agent_id.clone()),
        );
        metadata.insert(
            "description".to_string(),
            Value::String(description.clone()),
        );
        metadata.insert("prompt".to_string(), Value::String(prompt));
        if let Some(name) = response
            .nickname
            .clone()
            .or_else(|| normalize_optional_text(Some(description.clone())))
        {
            metadata.insert("name".to_string(), Value::String(name));
        }
        if !response.extra.is_empty() {
            metadata.insert(
                "extra".to_string(),
                serde_json::to_value(response.extra).unwrap_or(Value::Null),
            );
        }

        Ok(
            ToolResult::success(format!("Agent launched: {}", response.agent_id))
                .with_metadata("agent", Value::Object(metadata)),
        )
    }
}

#[derive(Clone)]
pub struct SendInputTool {
    callback: SendInputCallback,
}

impl SendInputTool {
    pub fn new(callback: SendInputCallback) -> Self {
        Self { callback }
    }
}

#[async_trait]
impl Tool for SendInputTool {
    fn name(&self) -> &str {
        "SendMessage"
    }

    fn aliases(&self) -> &'static [&'static str] {
        SEND_MESSAGE_TOOL_ALIASES
    }

    fn description(&self) -> &str {
        "Send a message to another agent. 优先复用已有 agent 的上下文继续推进任务，而不是重复创建新 agent；当前 Lime runtime 支持直接发送给 agent id、命名子 session，以及活跃 team 内按名字或 `*` 广播路由。上游 `uds:` / `bridge:` 跨会话 peer address 目前只做显式识别，不会误当作普通 agent id 投递。"
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "to": { "type": "string", "description": "目标 agent 标识。可传 agent id、命名子 session 名称；若当前 session 属于活跃 team，也可传 teammate 名称、ListPeers 返回的 `agent_id`，或 `*` 广播给所有其他 team 成员。上游 `uds:` / `bridge:` peer address 当前会返回未实现失败。" },
                "summary": { "type": "string", "description": "纯字符串消息必填的 5-10 词预览摘要；当前 runtime 仅保留到 metadata，不参与路由。" },
                "message": {
                    "description": "发送给目标 agent 的消息内容。字符串会直接发送；结构化 JSON 会被序列化为字符串后发送。",
                    "oneOf": [
                        { "type": "string" },
                        { "type": "object" },
                        { "type": "array" },
                        { "type": "number" },
                        { "type": "boolean" },
                        { "type": "null" }
                    ]
                }
            },
            "required": ["to", "message"],
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: SendMessageToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("SendMessage 参数无效: {error}")))?;
        let target = normalize_required_text(&input.to, "to")?;
        let summary = normalize_optional_text(input.summary.clone());
        if let Some(scheme) = parse_peer_address(&target) {
            return send_message_unsupported_peer_result(&target, summary, scheme);
        }
        let canonical_target = normalize_send_target(&context.session_id, &target).await?;
        if input.message.is_string() && input.summary.as_deref().unwrap_or("").trim().is_empty() {
            return Err(ToolError::invalid_params(
                "summary is required when message is a string",
            ));
        }
        let structured_message =
            serde_json::from_value::<StructuredMessage>(input.message.clone()).ok();
        if target == "*" && structured_message.is_some() {
            return Err(ToolError::invalid_params(
                "structured messages cannot be broadcast (to: \"*\")",
            ));
        }

        if let Some(StructuredMessage::ShutdownResponse {
            request_id: _,
            approve,
            reason,
        }) = structured_message.as_ref()
        {
            if canonical_target != "team-lead" {
                return Err(ToolError::invalid_params(
                    "shutdown_response must be sent to \"team-lead\"",
                ));
            }
            if !approve && reason.as_deref().unwrap_or("").trim().is_empty() {
                return Err(ToolError::invalid_params(
                    "reason is required when rejecting a shutdown request",
                ));
            }
        }

        if let Some(StructuredMessage::PlanApprovalResponse { approve, .. }) =
            structured_message.as_ref()
        {
            let team_context =
                resolve_team_context(&context.session_id)
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!("读取 team 状态失败: {error}"))
                    })?;
            if !team_context
                .as_ref()
                .is_some_and(|team_context| team_context.is_lead)
            {
                return Err(ToolError::invalid_params(if *approve {
                    "Only the team lead can approve plans. Teammates cannot approve their own or other plans."
                } else {
                    "Only the team lead can reject plans. Teammates cannot reject their own or other plans."
                }));
            }
        }

        let message = match structured_message.as_ref() {
            Some(StructuredMessage::ShutdownRequest { reason }) => serde_json::to_string(&json!({
                "type": "shutdown_request",
                "request_id": generate_request_id("shutdown", &canonical_target),
                "reason": reason.clone(),
            }))
            .map_err(|error| {
                ToolError::invalid_params(format!(
                    "SendMessage 无法序列化 shutdown_request: {error}"
                ))
            })?,
            Some(_) => serde_json::to_string(&input.message).map_err(|error| {
                ToolError::invalid_params(format!("SendMessage 无法序列化结构化消息: {error}"))
            })?,
            None => match input.message {
                Value::String(text) => normalize_required_text(&text, "message")?,
                other => serde_json::to_string(&other)
                    .map_err(|error| {
                        ToolError::invalid_params(format!(
                            "SendMessage 无法序列化结构化消息: {error}"
                        ))
                    })?
                    .trim()
                    .to_string(),
            },
        };
        if message.is_empty() {
            return Err(ToolError::invalid_params("message 不能为空"));
        }

        let resolved_targets = resolve_send_targets(&context.session_id, &canonical_target).await?;
        let mut deliveries = Vec::with_capacity(resolved_targets.len());
        for resolved_target in &resolved_targets {
            let request = SendInputRequest {
                id: resolved_target.agent_id.clone(),
                message: message.clone(),
                interrupt: false,
            };
            let response = (self.callback)(request)
                .await
                .map_err(ToolError::execution_failed)?;
            deliveries.push(json!({
                "target": resolved_target.display_name,
                "agentId": resolved_target.agent_id,
                "submissionId": response.submission_id,
                "extra": response.extra
            }));
        }

        let sender = resolve_sender_name(&context.session_id).await;
        let routing = if target == "*" {
            Some(MessageRouting {
                sender,
                sender_color: None,
                target: "@team".to_string(),
                target_color: None,
                summary: summary.clone(),
                content: Some(message.clone()),
            })
        } else {
            resolved_targets
                .first()
                .map(|resolved_target| MessageRouting {
                    sender,
                    sender_color: None,
                    target: resolved_target.routing_target.clone(),
                    target_color: None,
                    summary: summary.clone(),
                    content: Some(message.clone()),
                })
        };

        let structured_output = if let Some(structured_message) = structured_message.as_ref() {
            match structured_message {
                StructuredMessage::ShutdownRequest { .. } => {
                    let request_id = serde_json::from_str::<Value>(&message)
                        .ok()
                        .and_then(|value| value.get("request_id").cloned())
                        .and_then(|value| value.as_str().map(ToString::to_string))
                        .ok_or_else(|| {
                            ToolError::execution_failed("shutdown_request 缺少 request_id")
                        })?;
                    serde_json::to_value(RequestOutput {
                        success: true,
                        message: format!(
                            "Shutdown request sent to {target}. Request ID: {request_id}"
                        ),
                        request_id,
                        target: target.clone(),
                    })
                    .map_err(|error| {
                        ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
                    })?
                }
                StructuredMessage::ShutdownResponse {
                    request_id,
                    approve,
                    reason,
                } => serde_json::to_value(ResponseOutput {
                    success: true,
                    message: if *approve {
                        format!("Shutdown approved. Request ID: {request_id}")
                    } else {
                        format!(
                            "Shutdown rejected. Reason: \"{}\". Continuing to work.",
                            reason.clone().unwrap_or_default()
                        )
                    },
                    request_id: Some(request_id.clone()),
                })
                .map_err(|error| {
                    ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
                })?,
                StructuredMessage::PlanApprovalResponse {
                    request_id,
                    approve,
                    feedback,
                } => serde_json::to_value(ResponseOutput {
                    success: true,
                    message: if *approve {
                        format!("Plan approved for {target}. Request ID: {request_id}")
                    } else {
                        format!(
                            "Plan rejected for {target} with feedback: \"{}\"",
                            feedback
                                .clone()
                                .unwrap_or_else(|| "Plan needs revision".to_string())
                        )
                    },
                    request_id: Some(request_id.clone()),
                })
                .map_err(|error| {
                    ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
                })?,
            }
        } else if target == "*" {
            let recipients = deliveries
                .iter()
                .filter_map(|delivery| delivery.get("target").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            if recipients.is_empty() {
                serde_json::to_value(BroadcastOutput {
                    success: true,
                    message: "No teammates to broadcast to (you are the only team member)"
                        .to_string(),
                    recipients,
                    routing,
                })
                .map_err(|error| {
                    ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
                })?
            } else {
                serde_json::to_value(BroadcastOutput {
                    success: true,
                    message: format!(
                        "Message broadcast to {} teammate(s): {}",
                        recipients.len(),
                        recipients.join(", ")
                    ),
                    recipients,
                    routing,
                })
                .map_err(|error| {
                    ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
                })?
            }
        } else {
            let label = deliveries[0]["target"]
                .as_str()
                .unwrap_or(&target)
                .to_string();
            serde_json::to_value(MessageOutput {
                success: true,
                message: format!("Message sent to {label}"),
                routing,
            })
            .map_err(|error| {
                ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
            })?
        };

        let mut metadata = serde_json::Map::new();
        if let Value::Object(map) = structured_output.clone() {
            metadata.extend(map);
        }
        if let Some(summary) = summary {
            metadata.insert("summary".to_string(), Value::String(summary));
        }
        metadata.insert("deliveries".to_string(), Value::Array(deliveries));
        metadata.insert("target".to_string(), Value::String(target));

        Ok(ToolResult::success(pretty_json(&structured_output)?)
            .with_metadata("send_message", Value::Object(metadata)))
    }
}

#[derive(Debug, Clone)]
struct ResolvedSendTarget {
    display_name: String,
    agent_id: String,
    routing_target: String,
}

fn parse_peer_address(target: &str) -> Option<PeerAddressScheme> {
    if target.starts_with("uds:") {
        return Some(PeerAddressScheme::Uds);
    }
    if target.starts_with("bridge:") {
        return Some(PeerAddressScheme::Bridge);
    }

    None
}

fn send_message_unsupported_peer_result(
    target: &str,
    summary: Option<String>,
    scheme: PeerAddressScheme,
) -> Result<ToolResult, ToolError> {
    let message = match scheme {
        PeerAddressScheme::Uds => "Known upstream peer address surface (`uds:`), but the current Lime runtime does not expose cross-session local peer messaging through SendMessage yet.",
        PeerAddressScheme::Bridge => "Known upstream peer address surface (`bridge:`), but the current Lime runtime does not expose cross-session remote peer messaging through SendMessage yet.",
    };
    let output = serde_json::to_value(MessageOutput {
        success: false,
        message: message.to_string(),
        routing: None,
    })
    .map_err(|error| {
        ToolError::execution_failed(format!("序列化 SendMessage 结果失败: {error}"))
    })?;

    let mut metadata = serde_json::Map::new();
    if let Value::Object(map) = output.clone() {
        metadata.extend(map);
    }
    if let Some(summary) = summary {
        metadata.insert("summary".to_string(), Value::String(summary));
    }
    metadata.insert("deliveries".to_string(), Value::Array(Vec::new()));
    metadata.insert("target".to_string(), Value::String(target.to_string()));
    metadata.insert(
        "unsupportedTargetScheme".to_string(),
        Value::String(
            match scheme {
                PeerAddressScheme::Uds => "uds",
                PeerAddressScheme::Bridge => "bridge",
            }
            .to_string(),
        ),
    );

    Ok(ToolResult::success(pretty_json(&output)?)
        .with_metadata("send_message", Value::Object(metadata)))
}

fn split_team_display_id(target: &str) -> Option<(&str, &str)> {
    let (name, team_name) = target.split_once('@')?;
    let name = name.trim();
    let team_name = team_name.trim();
    if name.is_empty() || team_name.is_empty() {
        None
    } else {
        Some((name, team_name))
    }
}

async fn normalize_send_target(session_id: &str, target: &str) -> Result<String, ToolError> {
    let Some((name, team_name)) = split_team_display_id(target) else {
        return Ok(target.to_string());
    };

    let Some(team_context) = resolve_team_context(session_id)
        .await
        .map_err(|error| ToolError::execution_failed(format!("读取 team 状态失败: {error}")))?
    else {
        return Err(ToolError::invalid_params(
            "to 必须是裸 teammate 名称、agent id，或当前活跃 team 的 `name@team` 标识",
        ));
    };

    if team_context.team_state.team_name != team_name {
        return Err(ToolError::invalid_params(format!(
            "目标 team 不匹配：当前 team 为 {}，但收到 {}",
            team_context.team_state.team_name, team_name
        )));
    }

    if team_context.team_state.find_member_by_name(name).is_none() {
        return Err(ToolError::invalid_params(format!(
            "team {} 中不存在名为 {} 的成员",
            team_name, name
        )));
    }

    Ok(name.to_string())
}

async fn resolve_send_targets(
    session_id: &str,
    target: &str,
) -> Result<Vec<ResolvedSendTarget>, ToolError> {
    if target == "*" {
        let Some(team_context) = resolve_team_context(session_id)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 team 状态失败: {error}")))?
        else {
            return Err(ToolError::execution_failed(
                "当前 session 不在活跃 team 中，无法使用 `*` 广播",
            ));
        };
        let recipients = team_context
            .team_state
            .members
            .into_iter()
            .filter(|member| member.agent_id != team_context.current_agent_id)
            .map(|member| {
                let display_name = member.name.clone();
                let routing_target = format!("@{}", display_name);
                ResolvedSendTarget {
                    display_name,
                    agent_id: member.agent_id,
                    routing_target,
                }
            })
            .collect::<Vec<_>>();
        return Ok(recipients);
    }

    if let Some(team_context) = resolve_team_context(session_id)
        .await
        .map_err(|error| ToolError::execution_failed(format!("读取 team 状态失败: {error}")))?
    {
        if let Some(member) = team_context.team_state.find_member_by_name(target) {
            if member.agent_id == team_context.current_agent_id {
                return Err(ToolError::execution_failed(
                    "不能把消息发送给当前 session 自己",
                ));
            }

            return Ok(vec![ResolvedSendTarget {
                display_name: member.name.clone(),
                agent_id: member.agent_id.clone(),
                routing_target: format!("@{}", member.name),
            }]);
        }
    }

    if let Some(child_session) = resolve_named_subagent_child_session(session_id, target)
        .await
        .map_err(|error| {
            ToolError::execution_failed(format!("读取命名子 agent 路由失败: {error}"))
        })?
    {
        return Ok(vec![ResolvedSendTarget {
            display_name: target.to_string(),
            agent_id: child_session.id,
            routing_target: target.to_string(),
        }]);
    }

    Ok(vec![ResolvedSendTarget {
        display_name: target.to_string(),
        agent_id: target.to_string(),
        routing_target: target.to_string(),
    }])
}

async fn resolve_sender_name(session_id: &str) -> String {
    resolve_team_context(session_id)
        .await
        .ok()
        .flatten()
        .map(|team_context| team_context.current_member_name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| {
            if session_id.trim().is_empty() {
                "current-session".to_string()
            } else {
                session_id.to_string()
            }
        })
}

fn generate_request_id(prefix: &str, target: &str) -> String {
    format!(
        "{prefix}-{}@{target}",
        chrono::Utc::now().timestamp_millis()
    )
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{
        save_team_membership, save_team_state, SessionManager, SessionType,
        SubagentSessionMetadata, TeamMember, TeamMembershipState, TeamSessionState,
    };
    use crate::tools::Tool;
    use std::path::PathBuf;
    use std::time::Duration;
    use tempfile::tempdir;
    use uuid::Uuid;

    fn create_context(session_id: &str) -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp")).with_session_id(session_id)
    }

    fn create_test_context() -> ToolContext {
        create_context("parent-session")
    }

    #[test]
    fn test_register_agent_control_tools_registers_only_configured_callbacks() {
        let mut registry = ToolRegistry::new();
        let config = AgentControlToolConfig::new().with_spawn_agent_callback(Arc::new(|request| {
            Box::pin(async move {
                Ok(SpawnAgentResponse {
                    agent_id: request.parent_session_id,
                    nickname: None,
                    extra: BTreeMap::new(),
                })
            })
        }));

        register_agent_control_tools(&mut registry, &config);

        assert!(!registry.contains("spawn_agent"));
        assert!(registry.contains("Agent"));
        assert!(!registry.contains("SendMessage"));
        assert!(!registry.contains("wait_agent"));
    }

    #[tokio::test]
    async fn test_agent_tool_accepts_current_surface() {
        let tool = SpawnAgentTool::new(Arc::new(|request| {
            Box::pin(async move {
                assert_eq!(request.parent_session_id, "parent-session");
                assert_eq!(request.message, "请检查测试失败原因");
                assert_eq!(request.agent_type.as_deref(), Some("explorer"));
                assert_eq!(request.name.as_deref(), Some("diag"));
                assert_eq!(request.team_name.as_deref(), Some("alpha"));
                assert!(request.run_in_background);
                assert_eq!(request.mode.as_deref(), Some("plan"));
                assert_eq!(request.isolation.as_deref(), Some("worktree"));
                assert_eq!(request.cwd.as_deref(), Some("/tmp/workspace"));
                Ok(SpawnAgentResponse {
                    agent_id: "agent-42".to_string(),
                    nickname: Some("diag".to_string()),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "description": "排查失败",
                    "prompt": "请检查测试失败原因",
                    "subagent_type": "explorer",
                    "name": "diag",
                    "team_name": "alpha",
                    "run_in_background": true,
                    "mode": "plan",
                    "isolation": "worktree",
                    "cwd": "/tmp/workspace"
                }),
                &create_test_context(),
            )
            .await
            .unwrap();

        assert_eq!(result.output.as_deref(), Some("Agent launched: agent-42"));
        assert_eq!(result.metadata["agent"]["agentId"], "agent-42");
        assert_eq!(result.metadata["agent"]["name"], "diag");
        assert_eq!(result.metadata["agent"]["description"], "排查失败");
    }

    #[tokio::test]
    async fn test_agent_tool_rejects_unknown_fields() {
        let tool = SpawnAgentTool::new(Arc::new(|_request| {
            Box::pin(async move {
                panic!("unknown fields should be rejected before dispatch");
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "description": "排查失败",
                    "prompt": "请检查测试失败原因",
                    "unexpected": true
                }),
                &create_test_context(),
            )
            .await;

        assert!(matches!(
            result,
            Err(ToolError::InvalidParams(message))
            if message.contains("unknown field `unexpected`")
        ));
    }

    #[tokio::test]
    async fn test_send_message_tool_accepts_current_surface() {
        let tool = SendInputTool::new(Arc::new(|request| {
            Box::pin(async move {
                assert_eq!(request.id, "agent-7");
                assert_eq!(request.message, "{\"kind\":\"follow_up\"}");
                assert!(!request.interrupt);
                Ok(SendInputResponse {
                    submission_id: "submission-1".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "agent-7",
                    "summary": "继续处理",
                    "message": {"kind": "follow_up"}
                }),
                &create_test_context(),
            )
            .await
            .unwrap();

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(true));
        assert_eq!(output["message"], json!("Message sent to agent-7"));
        assert_eq!(output["routing"]["target"], json!("agent-7"));
        assert_eq!(
            output["routing"]["content"],
            json!("{\"kind\":\"follow_up\"}")
        );
        assert_eq!(result.metadata["send_message"]["target"], "agent-7");
        assert_eq!(result.metadata["send_message"]["summary"], "继续处理");
        assert!(result.metadata["send_message"].get("interrupt").is_none());
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_send_message_routes_named_child_session_before_raw_agent_id() {
        let temp_dir = tempdir().unwrap();
        let parent = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            "parent".to_string(),
            SessionType::User,
        )
        .await
        .unwrap();

        let older_child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            "older".to_string(),
            SessionType::SubAgent,
        )
        .await
        .unwrap();
        let older_extension_data = SubagentSessionMetadata::new(parent.id.clone())
            .with_role_hint(Some("verifier".to_string()))
            .into_updated_extension_data(&older_child)
            .unwrap();
        SessionManager::update_session(&older_child.id)
            .extension_data(older_extension_data)
            .apply()
            .await
            .unwrap();

        tokio::time::sleep(Duration::from_millis(5)).await;

        let newer_child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            "newer".to_string(),
            SessionType::SubAgent,
        )
        .await
        .unwrap();
        let newer_extension_data = SubagentSessionMetadata::new(parent.id.clone())
            .with_role_hint(Some("verifier".to_string()))
            .into_updated_extension_data(&newer_child)
            .unwrap();
        SessionManager::update_session(&newer_child.id)
            .extension_data(newer_extension_data)
            .apply()
            .await
            .unwrap();

        let expected_agent_id = newer_child.id.clone();
        let tool = SendInputTool::new(Arc::new(move |request| {
            let expected_agent_id = expected_agent_id.clone();
            Box::pin(async move {
                assert_eq!(request.id, expected_agent_id);
                assert_eq!(request.message, "继续验证");
                Ok(SendInputResponse {
                    submission_id: "submission-2".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "verifier",
                    "summary": "继续验证 verifier",
                    "message": "继续验证"
                }),
                &create_context(&parent.id),
            )
            .await
            .unwrap();

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["message"], json!("Message sent to verifier"));
        assert_eq!(output["routing"]["target"], json!("verifier"));
        assert_eq!(
            result.metadata["send_message"]["deliveries"][0]["agentId"],
            newer_child.id
        );
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_send_message_accepts_team_display_agent_id() {
        let temp_dir = tempdir().unwrap();
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-display-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
        .unwrap();
        let teammate = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-display-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .unwrap();

        let team_state = TeamSessionState {
            team_name: "alpha".to_string(),
            description: None,
            lead_session_id: lead.id.clone(),
            members: vec![
                TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                TeamMember::teammate(
                    teammate.id.clone(),
                    "researcher",
                    Some("explorer".to_string()),
                ),
            ],
        };
        save_team_state(&lead.id, Some(team_state)).await.unwrap();
        save_team_membership(
            &teammate.id,
            Some(TeamMembershipState {
                team_name: "alpha".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: teammate.id.clone(),
                name: "researcher".to_string(),
                agent_type: Some("explorer".to_string()),
            }),
        )
        .await
        .unwrap();

        let expected_target_id = lead.id.clone();
        let tool = SendInputTool::new(Arc::new(move |request| {
            let expected_target_id = expected_target_id.clone();
            Box::pin(async move {
                assert_eq!(request.id, expected_target_id);
                assert_eq!(request.message, "继续同步结果");
                Ok(SendInputResponse {
                    submission_id: "submission-display-id".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "team-lead@alpha",
                    "summary": "同步给 lead",
                    "message": "继续同步结果"
                }),
                &create_context(&teammate.id),
            )
            .await
            .unwrap();

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(true));
        assert_eq!(output["message"], json!("Message sent to team-lead"));
        assert_eq!(output["routing"]["target"], json!("@team-lead"));
        assert_eq!(result.metadata["send_message"]["target"], "team-lead@alpha");
    }

    #[tokio::test]
    async fn test_send_message_returns_shutdown_request_output_shape() {
        let tool = SendInputTool::new(Arc::new(|request| {
            Box::pin(async move {
                assert_eq!(request.id, "researcher");
                let payload: Value = serde_json::from_str(&request.message).unwrap();
                assert_eq!(payload["type"], json!("shutdown_request"));
                assert!(payload["request_id"]
                    .as_str()
                    .unwrap()
                    .starts_with("shutdown-"));
                assert!(payload["request_id"]
                    .as_str()
                    .unwrap()
                    .ends_with("@researcher"));
                Ok(SendInputResponse {
                    submission_id: "submission-3".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "researcher",
                    "message": {
                        "type": "shutdown_request",
                        "reason": "team done"
                    }
                }),
                &create_test_context(),
            )
            .await
            .unwrap();

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(true));
        assert_eq!(output["target"], json!("researcher"));
        assert!(output["request_id"]
            .as_str()
            .unwrap()
            .starts_with("shutdown-"));
        assert!(output["request_id"]
            .as_str()
            .unwrap()
            .ends_with("@researcher"));
    }

    #[tokio::test]
    async fn test_send_message_requires_summary_for_plain_text_without_dispatch() {
        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                panic!("plain text message without summary should be rejected before dispatch");
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "researcher",
                    "message": "继续处理"
                }),
                &create_test_context(),
            )
            .await;

        assert!(matches!(
            result,
            Err(ToolError::InvalidParams(message))
            if message == "summary is required when message is a string"
        ));
    }

    #[tokio::test]
    async fn test_send_message_rejects_unknown_fields() {
        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                panic!("unknown fields should be rejected before dispatch");
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "researcher",
                    "summary": "继续处理",
                    "message": "继续处理",
                    "unexpected": true
                }),
                &create_test_context(),
            )
            .await;

        assert!(matches!(
            result,
            Err(ToolError::InvalidParams(message))
            if message.contains("unknown field `unexpected`, expected one of `to`, `summary`, `message`")
        ));
    }

    #[tokio::test]
    async fn test_send_message_returns_structured_failure_for_uds_peer_target() {
        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                panic!("uds peer target should not dispatch to send_input callback");
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "uds:/tmp/peer.sock",
                    "message": "继续验证"
                }),
                &create_test_context(),
            )
            .await
            .unwrap();

        assert!(result.success);
        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(false));
        assert!(output["message"]
            .as_str()
            .unwrap()
            .contains("does not expose cross-session local peer messaging"));
        assert_eq!(
            result.metadata["send_message"]["unsupportedTargetScheme"],
            json!("uds")
        );
        assert_eq!(
            result.metadata["send_message"]["target"],
            "uds:/tmp/peer.sock"
        );
    }

    #[tokio::test]
    async fn test_send_message_returns_structured_failure_for_bridge_peer_target() {
        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                panic!("bridge peer target should not dispatch to send_input callback");
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "bridge:session_123",
                    "summary": "同步远端会话",
                    "message": "继续验证"
                }),
                &create_test_context(),
            )
            .await
            .unwrap();

        assert!(result.success);
        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(false));
        assert!(output["message"]
            .as_str()
            .unwrap()
            .contains("does not expose cross-session remote peer messaging"));
        assert_eq!(
            result.metadata["send_message"]["unsupportedTargetScheme"],
            json!("bridge")
        );
        assert_eq!(result.metadata["send_message"]["summary"], "同步远端会话");
        assert_eq!(
            result.metadata["send_message"]["target"],
            "bridge:session_123"
        );
    }

    #[tokio::test]
    async fn test_send_message_rejects_structured_broadcast() {
        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                Ok(SendInputResponse {
                    submission_id: "submission-unused".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "*",
                    "message": {
                        "type": "plan_approval_response",
                        "request_id": "req-1",
                        "approve": true
                    }
                }),
                &create_test_context(),
            )
            .await;

        assert!(matches!(
            result,
            Err(ToolError::InvalidParams(message))
            if message == "structured messages cannot be broadcast (to: \"*\")"
        ));
    }

    #[tokio::test]
    async fn test_send_message_rejects_shutdown_response_without_reason() {
        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                Ok(SendInputResponse {
                    submission_id: "submission-unused".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "team-lead",
                    "message": {
                        "type": "shutdown_response",
                        "request_id": "req-1",
                        "approve": false
                    }
                }),
                &create_test_context(),
            )
            .await;

        assert!(matches!(
            result,
            Err(ToolError::InvalidParams(message))
            if message == "reason is required when rejecting a shutdown request"
        ));
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_send_message_accepts_shutdown_response_for_team_lead_display_id() {
        let temp_dir = tempdir().unwrap();
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-display-response-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
        .unwrap();
        let teammate = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-display-response-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .unwrap();

        let team_state = TeamSessionState {
            team_name: "alpha".to_string(),
            description: None,
            lead_session_id: lead.id.clone(),
            members: vec![
                TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                TeamMember::teammate(
                    teammate.id.clone(),
                    "researcher",
                    Some("explorer".to_string()),
                ),
            ],
        };
        save_team_state(&lead.id, Some(team_state)).await.unwrap();
        save_team_membership(
            &teammate.id,
            Some(TeamMembershipState {
                team_name: "alpha".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: teammate.id.clone(),
                name: "researcher".to_string(),
                agent_type: Some("explorer".to_string()),
            }),
        )
        .await
        .unwrap();

        let expected_target_id = lead.id.clone();
        let tool = SendInputTool::new(Arc::new(move |request| {
            let expected_target_id = expected_target_id.clone();
            Box::pin(async move {
                assert_eq!(request.id, expected_target_id);
                let payload: Value = serde_json::from_str(&request.message).unwrap();
                assert_eq!(payload["type"], json!("shutdown_response"));
                assert_eq!(payload["approve"], json!(true));
                assert_eq!(payload["request_id"], json!("req-1"));
                Ok(SendInputResponse {
                    submission_id: "submission-display-response".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "team-lead@alpha",
                    "message": {
                        "type": "shutdown_response",
                        "request_id": "req-1",
                        "approve": true
                    }
                }),
                &create_context(&teammate.id),
            )
            .await
            .unwrap();

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(true));
        assert_eq!(output["request_id"], json!("req-1"));
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_send_message_rejects_plan_approval_response_from_teammate() {
        let temp_dir = tempdir().unwrap();
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
        .unwrap();
        let teammate = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .unwrap();

        let team_state = TeamSessionState {
            team_name: "alpha".to_string(),
            description: None,
            lead_session_id: lead.id.clone(),
            members: vec![
                TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                TeamMember::teammate(
                    teammate.id.clone(),
                    "researcher",
                    Some("explorer".to_string()),
                ),
            ],
        };
        save_team_state(&lead.id, Some(team_state)).await.unwrap();
        save_team_membership(
            &teammate.id,
            Some(TeamMembershipState {
                team_name: "alpha".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: teammate.id.clone(),
                name: "researcher".to_string(),
                agent_type: Some("explorer".to_string()),
            }),
        )
        .await
        .unwrap();

        let tool = SendInputTool::new(Arc::new(|_request| {
            Box::pin(async move {
                panic!("plan_approval_response from teammate should be rejected before dispatch");
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "team-lead",
                    "message": {
                        "type": "plan_approval_response",
                        "request_id": "req-approve",
                        "approve": true
                    }
                }),
                &create_context(&teammate.id),
            )
            .await;

        assert!(matches!(
            result,
            Err(ToolError::InvalidParams(message))
            if message == "Only the team lead can approve plans. Teammates cannot approve their own or other plans."
        ));
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn test_send_message_allows_plan_approval_response_from_team_lead() {
        let temp_dir = tempdir().unwrap();
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
        .unwrap();
        let teammate = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("team-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .unwrap();

        let team_state = TeamSessionState {
            team_name: "alpha".to_string(),
            description: None,
            lead_session_id: lead.id.clone(),
            members: vec![
                TeamMember::lead(lead.id.clone(), Some("leader".to_string())),
                TeamMember::teammate(
                    teammate.id.clone(),
                    "researcher",
                    Some("explorer".to_string()),
                ),
            ],
        };
        save_team_state(&lead.id, Some(team_state)).await.unwrap();
        save_team_membership(
            &teammate.id,
            Some(TeamMembershipState {
                team_name: "alpha".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: teammate.id.clone(),
                name: "researcher".to_string(),
                agent_type: Some("explorer".to_string()),
            }),
        )
        .await
        .unwrap();

        let expected_target_id = teammate.id.clone();
        let tool = SendInputTool::new(Arc::new(move |request| {
            let expected_target_id = expected_target_id.clone();
            Box::pin(async move {
                assert_eq!(request.id, expected_target_id);
                let payload: Value = serde_json::from_str(&request.message).unwrap();
                assert_eq!(payload["type"], json!("plan_approval_response"));
                assert_eq!(payload["request_id"], json!("req-approve"));
                assert_eq!(payload["approve"], json!(true));
                Ok(SendInputResponse {
                    submission_id: "submission-plan-approve".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        let result = tool
            .execute(
                serde_json::json!({
                    "to": "researcher",
                    "message": {
                        "type": "plan_approval_response",
                        "request_id": "req-approve",
                        "approve": true
                    }
                }),
                &create_context(&lead.id),
            )
            .await
            .unwrap();

        let output: Value = serde_json::from_str(result.output.as_deref().unwrap()).unwrap();
        assert_eq!(output["success"], json!(true));
        assert_eq!(
            output["message"],
            json!("Plan approved for researcher. Request ID: req-approve")
        );
        assert_eq!(result.metadata["send_message"]["target"], "researcher");
    }
}
