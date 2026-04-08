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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct SendMessageToolInput {
    to: String,
    #[serde(default)]
    summary: Option<String>,
    message: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SendInputResponse {
    pub submission_id: String,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, Value>,
}

fn normalize_required_text(value: &str, field_name: &str) -> Result<String, ToolError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ToolError::invalid_params(format!("{field_name} 不能为空")));
    }

    Ok(trimmed.to_string())
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

    fn description(&self) -> &str {
        "Send a message to another agent. 优先复用已有 agent 的上下文继续推进任务，而不是重复创建新 agent；当前 runtime 支持直接发送给 agent id，也支持在活跃 team 内按名字或 `*` 广播路由，但不保留旧跨会话 peer surface。"
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "to": { "type": "string", "description": "目标 agent 标识。可传 agent id；若当前 session 属于活跃 team，也可传 teammate 名称或 `*` 广播给所有其他 team 成员。" },
                "summary": { "type": "string", "description": "可选的 5-10 词预览摘要；当前 runtime 仅保留到 metadata，不参与路由。" },
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
        let message = match input.message {
            Value::String(text) => normalize_required_text(&text, "message")?,
            other => serde_json::to_string(&other)
                .map_err(|error| {
                    ToolError::invalid_params(format!("SendMessage 无法序列化结构化消息: {error}"))
                })?
                .trim()
                .to_string(),
        };
        if message.is_empty() {
            return Err(ToolError::invalid_params("message 不能为空"));
        }

        let resolved_targets = resolve_send_targets(&context.session_id, &target).await?;
        let summary = normalize_optional_text(input.summary);
        let mut deliveries = Vec::with_capacity(resolved_targets.len());
        for resolved_target in resolved_targets {
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

        let mut metadata = serde_json::Map::new();
        metadata.insert("success".to_string(), Value::Bool(true));
        metadata.insert("deliveries".to_string(), Value::Array(deliveries.clone()));
        metadata.insert("target".to_string(), Value::String(target.clone()));
        if let Some(summary) = summary {
            metadata.insert("summary".to_string(), Value::String(summary));
        }

        let success_message = if deliveries.len() == 1 {
            let label = deliveries[0]["target"].as_str().unwrap_or(&target);
            format!("Message sent to {label}")
        } else {
            format!("Message sent to {} teammates", deliveries.len())
        };

        Ok(ToolResult::success(success_message)
            .with_metadata("send_message", Value::Object(metadata)))
    }
}

#[derive(Debug, Clone)]
struct ResolvedSendTarget {
    display_name: String,
    agent_id: String,
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
            .map(|member| ResolvedSendTarget {
                display_name: member.name,
                agent_id: member.agent_id,
            })
            .collect::<Vec<_>>();
        if recipients.is_empty() {
            return Err(ToolError::execution_failed(
                "当前 team 没有其他成员可接收消息",
            ));
        }
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
        }]);
    }

    Ok(vec![ResolvedSendTarget {
        display_name: target.to_string(),
        agent_id: target.to_string(),
    }])
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
    use crate::session::{SessionManager, SessionType, SubagentSessionMetadata};
    use crate::tools::Tool;
    use std::path::PathBuf;
    use std::time::Duration;
    use tempfile::tempdir;

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

        assert_eq!(result.output.as_deref(), Some("Message sent to agent-7"));
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
                    "message": "继续验证"
                }),
                &create_context(&parent.id),
            )
            .await
            .unwrap();

        assert_eq!(result.output.as_deref(), Some("Message sent to verifier"));
        assert_eq!(
            result.metadata["send_message"]["deliveries"][0]["agentId"],
            newer_child.id
        );
    }
}
