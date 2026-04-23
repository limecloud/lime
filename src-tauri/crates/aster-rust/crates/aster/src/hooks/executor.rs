//! Hook 执行器
//!
//! 执行各种类型的 hooks

use super::registry::{
    clear_session_hooks, get_matching_session_hooks, global_registry,
    unregister_session_hook_entry, SharedHookRegistry,
};
use super::types::*;
use crate::agents::{Agent, AgentEvent, SessionConfig};
use crate::config::{AsterMode, Config};
use crate::conversation::message::Message;
use crate::conversation::Conversation;
use crate::providers::{create, create_with_default_model, create_with_named_model};
use crate::session::{
    query_session, ChatHistoryMatch, CommitOptions, CommitReport, ExtensionData, MemoryCategory,
    MemoryHealth, MemoryRecord, MemorySearchResult, MemoryStats, Session, SessionInsights,
    SessionStore, SessionType, TokenStatsUpdate, TurnContextOverride,
};
use crate::session_context;
use async_trait::async_trait;
use futures::StreamExt;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::warn;
use uuid::Uuid;

/// 替换命令中的环境变量占位符
fn replace_command_variables(command: &str, input: &HookInput) -> String {
    command
        .replace("$TOOL_NAME", input.tool_name.as_deref().unwrap_or(""))
        .replace(
            "$EVENT",
            &input.event.map(|e| e.to_string()).unwrap_or_default(),
        )
        .replace("$SESSION_ID", input.session_id.as_deref().unwrap_or(""))
        .replace(
            "$PERMISSION_MODE",
            input.permission_mode.as_deref().unwrap_or(""),
        )
}

const PROMPT_HOOK_SYSTEM_PROMPT: &str = r#"You are evaluating an Aster/Lime prompt hook.

You must return only a JSON object in one of these forms:
{"ok":true}
{"ok":false,"reason":"short explanation"}

Do not return markdown fences or any extra text."#;

const AGENT_HOOK_SYSTEM_PROMPT: &str = r#"You are evaluating an Aster/Lime agent hook.

Use the available tools to verify whether the hook condition is satisfied.
Prefer read-only inspection.
Do not ask the user questions.
Do not modify files unless the hook prompt explicitly requires it.

Return the final decision with the StructuredOutput tool using:
{"ok":true}
or
{"ok":false,"reason":"short explanation"}"#;

const DEFAULT_AGENT_HOOK_MAX_TURNS: u32 = 50;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
struct PromptHookResponse {
    ok: bool,
    #[serde(default)]
    reason: Option<String>,
}

fn prompt_hook_output_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "ok": {
                "type": "boolean"
            },
            "reason": {
                "type": "string"
            }
        },
        "required": ["ok"],
        "additionalProperties": false
    })
}

fn replace_prompt_hook_arguments(prompt: &str, input_json: &str) -> String {
    let mut processed = prompt.to_string();
    let mut replaced = false;

    if let Ok(serde_json::Value::Array(arguments)) =
        serde_json::from_str::<serde_json::Value>(input_json)
    {
        for (index, value) in arguments.iter().enumerate() {
            let replacement = value
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| value.to_string());
            let indexed_placeholder = format!("$ARGUMENTS[{index}]");
            let shorthand_placeholder = format!("${index}");

            if processed.contains(&indexed_placeholder) {
                processed = processed.replace(&indexed_placeholder, &replacement);
                replaced = true;
            }
            if processed.contains(&shorthand_placeholder) {
                processed = processed.replace(&shorthand_placeholder, &replacement);
                replaced = true;
            }
        }
    }

    if processed.contains("$ARGUMENTS") {
        processed = processed.replace("$ARGUMENTS", input_json);
        replaced = true;
    }

    if replaced {
        processed
    } else {
        format!("{prompt}\n\nHook input JSON:\n{input_json}")
    }
}

fn parse_prompt_hook_response(
    raw_response: &str,
    hook_label: &str,
) -> Result<PromptHookResponse, String> {
    let trimmed = raw_response.trim();
    if trimmed.is_empty() {
        return Err(format!("{hook_label} 返回为空"));
    }

    let direct = serde_json::from_str::<PromptHookResponse>(trimmed);
    if let Ok(parsed) = direct {
        return Ok(parsed);
    }

    let unwrapped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"))
        .map(str::trim)
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);

    if let Ok(parsed) = serde_json::from_str::<PromptHookResponse>(unwrapped) {
        return Ok(parsed);
    }

    if let (Some(start), Some(end)) = (unwrapped.find('{'), unwrapped.rfind('}')) {
        let candidate = &unwrapped[start..=end];
        if let Ok(parsed) = serde_json::from_str::<PromptHookResponse>(candidate) {
            return Ok(parsed);
        }
    }

    Err(format!(
        "{hook_label} 返回不是合法 JSON：{}",
        trimmed.chars().take(240).collect::<String>()
    ))
}

async fn resolve_hook_provider(
    requested_model: Option<&str>,
    input: &HookInput,
    hook_label: &str,
) -> Result<std::sync::Arc<dyn crate::providers::base::Provider>, String> {
    let requested_model = requested_model
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(session_id) = input
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match query_session(session_id, false).await {
            Ok(session) => {
                if let Some(provider_name) = session
                    .provider_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if let Some(model_name) = requested_model {
                        return create_with_named_model(provider_name, model_name)
                            .await
                            .map_err(|error| {
                                format!(
                                    "按 session provider 创建 {hook_label} provider 失败: provider={}, model={}, error={}",
                                    provider_name, model_name, error,
                                )
                            });
                    }

                    if let Some(model_config) = session.model_config {
                        return create(provider_name, model_config).await.map_err(|error| {
                            format!(
                                "按 session model_config 创建 {hook_label} provider 失败: provider={}, error={}",
                                provider_name, error,
                            )
                        });
                    }

                    return create_with_default_model(provider_name)
                        .await
                        .map_err(|error| {
                            format!(
                                "按 session 默认模型创建 {hook_label} provider 失败: provider={}, error={}",
                                provider_name, error,
                            )
                        });
                }
            }
            Err(error) => {
                warn!(
                    "{} 读取 session provider 失败，准备回退全局配置: session_id={}, error={}",
                    hook_label, session_id, error
                );
            }
        }
    }

    let config = Config::global();
    let provider_name = config
        .get_param::<String>("ASTER_PROVIDER")
        .ok()
        .or_else(|| std::env::var("ASTER_PROVIDER").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!("{hook_label} 缺少可用 provider；请先配置 session provider 或 ASTER_PROVIDER")
        })?;

    if let Some(model_name) = requested_model {
        return create_with_named_model(&provider_name, model_name)
            .await
            .map_err(|error| {
                format!(
                    "按全局 provider 创建 {hook_label} provider 失败: provider={}, model={}, error={}",
                    provider_name, model_name, error,
                )
            });
    }

    if let Some(model_name) = config
        .get_param::<String>("ASTER_MODEL")
        .ok()
        .or_else(|| std::env::var("ASTER_MODEL").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let model_config = crate::model::ModelConfig::new(&model_name)
            .map_err(|error| format!("解析 ASTER_MODEL 失败: {error}"))?;
        return create(&provider_name, model_config).await.map_err(|error| {
            format!(
                "按全局 provider/model 创建 {hook_label} provider 失败: provider={}, model={}, error={}",
                provider_name, model_name, error,
            )
        });
    }

    create_with_default_model(&provider_name)
        .await
        .map_err(|error| {
            format!(
                "按全局默认模型创建 {hook_label} provider 失败: provider={}, error={}",
                provider_name, error,
            )
        })
}

fn resolve_agent_hook_config_string(hook: &AgentHookConfig, key: &str) -> Option<String> {
    hook.agent_config
        .as_ref()?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn resolve_agent_hook_config_u32(hook: &AgentHookConfig, key: &str) -> Option<u32> {
    hook.agent_config
        .as_ref()?
        .get(key)?
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn resolve_agent_hook_prompt(hook: &AgentHookConfig) -> Result<String, String> {
    hook.prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| resolve_agent_hook_config_string(hook, "prompt"))
        .ok_or_else(|| {
            "Agent hook 缺少 prompt；请直接配置 prompt，或在 compat agent_config.prompt 中提供"
                .to_string()
        })
}

fn resolve_agent_hook_model(hook: &AgentHookConfig) -> Option<String> {
    hook.model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| resolve_agent_hook_config_string(hook, "model"))
}

fn resolve_agent_hook_max_turns(hook: &AgentHookConfig) -> u32 {
    resolve_agent_hook_config_u32(hook, "max_turns")
        .or_else(|| resolve_agent_hook_config_u32(hook, "maxTurns"))
        .unwrap_or(DEFAULT_AGENT_HOOK_MAX_TURNS)
}

async fn resolve_agent_hook_working_dir(input: &HookInput) -> PathBuf {
    if let Some(session_id) = input
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match query_session(session_id, false).await {
            Ok(session) => return session.working_dir,
            Err(error) => {
                warn!(
                    "Agent hook 读取 session working_dir 失败，准备回退当前目录: session_id={}, error={}",
                    session_id, error
                );
            }
        }
    }

    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn build_agent_hook_system_prompt(
    hook: &AgentHookConfig,
    input: &HookInput,
    working_dir: &std::path::Path,
) -> String {
    let mut system_prompt = AGENT_HOOK_SYSTEM_PROMPT.to_string();
    system_prompt.push_str("\n\nHook context:\n");
    system_prompt.push_str(&format!(
        "- event: {}\n- working_dir: {}\n",
        input
            .event
            .map(|event| event.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        working_dir.display()
    ));

    if let Some(session_id) = input.session_id.as_deref() {
        system_prompt.push_str(&format!("- source_session_id: {session_id}\n"));
    }

    if let Some(tool_name) = input.tool_name.as_deref() {
        system_prompt.push_str(&format!("- tool_name: {tool_name}\n"));
    }

    if !hook.agent_type.trim().is_empty() {
        system_prompt.push_str(&format!("- agent_type: {}\n", hook.agent_type.trim()));
    }

    system_prompt
}

fn build_hook_agent_session(working_dir: PathBuf) -> Session {
    Session {
        id: format!("hook-agent-{}", Uuid::new_v4()),
        working_dir,
        name: "hook-agent".to_string(),
        user_set_name: false,
        session_type: SessionType::SubAgent,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        extension_data: ExtensionData::default(),
        total_tokens: None,
        input_tokens: None,
        output_tokens: None,
        cached_input_tokens: None,
        cache_creation_input_tokens: None,
        accumulated_total_tokens: None,
        accumulated_input_tokens: None,
        accumulated_output_tokens: None,
        schedule_id: None,
        recipe: None,
        user_recipe_values: None,
        conversation: Some(Conversation::empty()),
        message_count: 0,
        provider_name: None,
        model_config: None,
    }
}

struct HookAgentSessionStore {
    session: Mutex<Session>,
}

impl HookAgentSessionStore {
    fn new(session: Session) -> Self {
        Self {
            session: Mutex::new(session),
        }
    }

    fn clone_session(&self, include_messages: bool) -> Session {
        let mut session = match self.session.lock() {
            Ok(guard) => guard.clone(),
            Err(error) => error.into_inner().clone(),
        };
        if !include_messages {
            session.conversation = None;
        }
        session
    }
}

#[async_trait]
impl SessionStore for HookAgentSessionStore {
    async fn create_session(
        &self,
        _working_dir: PathBuf,
        _name: String,
        _session_type: SessionType,
    ) -> anyhow::Result<Session> {
        Ok(self.clone_session(true))
    }

    async fn get_session(&self, _id: &str, include_messages: bool) -> anyhow::Result<Session> {
        Ok(self.clone_session(include_messages))
    }

    async fn add_message(&self, _session_id: &str, message: &Message) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        let conversation = session.conversation.get_or_insert_with(Conversation::empty);
        conversation.push(message.clone());
        session.message_count = conversation.len();
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn replace_conversation(
        &self,
        _session_id: &str,
        conversation: &Conversation,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.conversation = Some(conversation.clone());
        session.message_count = conversation.len();
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn list_sessions(&self) -> anyhow::Result<Vec<Session>> {
        Ok(vec![self.clone_session(false)])
    }

    async fn list_sessions_by_types(&self, types: &[SessionType]) -> anyhow::Result<Vec<Session>> {
        let session = self.clone_session(false);
        if types.contains(&session.session_type) {
            Ok(vec![session])
        } else {
            Ok(Vec::new())
        }
    }

    async fn delete_session(&self, _id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn get_insights(&self) -> anyhow::Result<SessionInsights> {
        Ok(SessionInsights {
            total_sessions: 1,
            total_tokens: 0,
        })
    }

    async fn export_session(&self, _id: &str) -> anyhow::Result<String> {
        serde_json::to_string(&self.clone_session(true)).map_err(Into::into)
    }

    async fn import_session(&self, json: &str) -> anyhow::Result<Session> {
        let session: Session = serde_json::from_str(json)?;
        Ok(session)
    }

    async fn copy_session(&self, _session_id: &str, new_name: String) -> anyhow::Result<Session> {
        let mut session = self.clone_session(true);
        session.id = format!("hook-agent-copy-{}", Uuid::new_v4());
        session.name = new_name;
        Ok(session)
    }

    async fn truncate_conversation(
        &self,
        _session_id: &str,
        _timestamp: i64,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn update_session_name(
        &self,
        _session_id: &str,
        name: String,
        user_set: bool,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.name = name;
        session.user_set_name = user_set;
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn update_working_dir(
        &self,
        _session_id: &str,
        working_dir: PathBuf,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.working_dir = working_dir;
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn update_session_type(
        &self,
        _session_id: &str,
        session_type: SessionType,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.session_type = session_type;
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn update_extension_data(
        &self,
        _session_id: &str,
        extension_data: ExtensionData,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.extension_data = extension_data;
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn update_token_stats(
        &self,
        _session_id: &str,
        _stats: TokenStatsUpdate,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn update_provider_config(
        &self,
        _session_id: &str,
        provider_name: Option<String>,
        model_config: Option<crate::model::ModelConfig>,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.provider_name = provider_name;
        session.model_config = model_config;
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn update_recipe(
        &self,
        _session_id: &str,
        recipe: Option<crate::recipe::Recipe>,
        user_recipe_values: Option<HashMap<String, String>>,
    ) -> anyhow::Result<()> {
        let mut session = match self.session.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        session.recipe = recipe;
        session.user_recipe_values = user_recipe_values;
        session.updated_at = chrono::Utc::now();
        Ok(())
    }

    async fn search_chat_history(
        &self,
        _query: &str,
        _limit: Option<usize>,
        _after_date: Option<chrono::DateTime<chrono::Utc>>,
        _before_date: Option<chrono::DateTime<chrono::Utc>>,
        _exclude_session_id: Option<String>,
    ) -> anyhow::Result<Vec<ChatHistoryMatch>> {
        Ok(Vec::new())
    }

    async fn commit_session(
        &self,
        session_id: &str,
        _options: CommitOptions,
    ) -> anyhow::Result<CommitReport> {
        Ok(CommitReport {
            session_id: session_id.to_string(),
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
    ) -> anyhow::Result<Vec<MemorySearchResult>> {
        Ok(Vec::new())
    }

    async fn retrieve_context_memories(
        &self,
        _session_id: &str,
        _query: &str,
        _limit: usize,
    ) -> anyhow::Result<Vec<MemoryRecord>> {
        Ok(Vec::new())
    }

    async fn memory_stats(&self) -> anyhow::Result<MemoryStats> {
        Ok(MemoryStats::default())
    }

    async fn memory_health(&self) -> anyhow::Result<MemoryHealth> {
        Ok(MemoryHealth {
            healthy: true,
            message: "hook-agent-memory-disabled".to_string(),
        })
    }
}

/// 执行 Command Hook
async fn execute_command_hook(hook: &CommandHookConfig, input: &HookInput) -> HookResult {
    let timeout_duration = Duration::from_millis(hook.timeout);
    let command = replace_command_variables(&hook.command, input);

    // 准备环境变量
    let mut env: HashMap<String, String> = std::env::vars().collect();
    env.extend(hook.env.clone());
    env.insert(
        "CLAUDE_HOOK_EVENT".to_string(),
        input.event.map(|e| e.to_string()).unwrap_or_default(),
    );
    env.insert(
        "CLAUDE_HOOK_TOOL_NAME".to_string(),
        input.tool_name.clone().unwrap_or_default(),
    );
    env.insert(
        "CLAUDE_HOOK_SESSION_ID".to_string(),
        input.session_id.clone().unwrap_or_default(),
    );
    env.insert(
        "CLAUDE_HOOK_PERMISSION_MODE".to_string(),
        input.permission_mode.clone().unwrap_or_default(),
    );

    // 准备输入 JSON
    let input_json = serde_json::to_string(input).unwrap_or_default();

    let mut cmd = Command::new("sh");
    cmd.arg("-c")
        .arg(&command)
        .envs(&env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let result = timeout(timeout_duration, async {
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                return HookResult::failure(format!("Failed to spawn: {}", e));
            }
        };

        // 写入 stdin
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input_json.as_bytes()).await;
        }

        match child.wait_with_output().await {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                if !output.status.success() {
                    // 尝试解析 JSON 输出以获取阻塞消息
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                        if json.get("blocked").and_then(|v| v.as_bool()) == Some(true) {
                            let message = json
                                .get("message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Blocked by hook")
                                .to_string();
                            return HookResult::blocked(message);
                        }
                    }
                    return HookResult::failure(if stderr.is_empty() {
                        format!("Hook exited with code {:?}", output.status.code())
                    } else {
                        stderr
                    });
                }

                HookResult::success(Some(stdout))
            }
            Err(e) => HookResult::failure(format!("Failed to wait: {}", e)),
        }
    })
    .await;

    match result {
        Ok(r) => r,
        Err(_) => HookResult::failure("Hook execution timed out".to_string()),
    }
}

/// 执行 URL Hook
async fn execute_url_hook(hook: &UrlHookConfig, input: &HookInput) -> HookResult {
    let timeout_duration = Duration::from_millis(hook.timeout);

    let payload = serde_json::json!({
        "event": input.event,
        "toolName": input.tool_name,
        "toolInput": input.tool_input,
        "toolOutput": input.tool_output,
        "message": input.message,
        "sessionId": input.session_id,
        "permissionMode": input.permission_mode,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "tool_use_id": input.tool_use_id,
        "error": input.error,
        "error_type": input.error_type,
        "is_interrupt": input.is_interrupt,
        "is_timeout": input.is_timeout,
        "agent_id": input.agent_id,
        "agent_type": input.agent_type,
        "result": input.result,
        "notification_type": input.notification_type,
        "source": input.source,
        "reason": input.reason,
        "trigger": input.trigger,
        "currentTokens": input.current_tokens,
    });

    let client = reqwest::Client::new();
    let mut request = match hook.method {
        HttpMethod::Get => client.get(&hook.url),
        HttpMethod::Post => client.post(&hook.url),
        HttpMethod::Put => client.put(&hook.url),
        HttpMethod::Patch => client.patch(&hook.url),
    };

    request = request
        .header("Content-Type", "application/json")
        .header("User-Agent", "Aster-Hooks/1.0");

    for (key, value) in &hook.headers {
        request = request.header(key, value);
    }

    if hook.method != HttpMethod::Get {
        request = request.json(&payload);
    }

    let result = timeout(timeout_duration, request.send()).await;

    match result {
        Ok(Ok(response)) => {
            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return HookResult::failure(format!("HTTP {}: {}", status, text));
            }

            let text = response.text().await.unwrap_or_default();

            // 尝试解析 JSON 响应
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if json.get("blocked").and_then(|v| v.as_bool()) == Some(true) {
                    let message = json
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Blocked by hook")
                        .to_string();
                    return HookResult::blocked(message);
                }
            }

            HookResult::success(Some(text))
        }
        Ok(Err(e)) => HookResult::failure(format!("Request failed: {}", e)),
        Err(_) => HookResult::failure("Hook request timed out".to_string()),
    }
}

/// 执行 MCP Hook
async fn execute_mcp_hook(
    hook: &McpHookConfig,
    input: &HookInput,
    runtime: &HookRuntimeContext,
) -> HookResult {
    let Some(dispatcher) = runtime.mcp_executor().cloned() else {
        return HookResult::failure(format!(
            "MCP hook 当前运行时未提供 dispatcher: server={}, tool={}",
            hook.server, hook.tool
        ));
    };

    let timeout_duration = Duration::from_millis(hook.timeout);
    match timeout(timeout_duration, dispatcher(hook.clone(), input.clone())).await {
        Ok(result) => result,
        Err(_) => HookResult::failure("MCP hook 执行超时".to_string()),
    }
}

async fn execute_prompt_hook_with_provider(
    hook: &PromptHookConfig,
    input: &HookInput,
    provider: &dyn crate::providers::base::Provider,
) -> HookResult {
    let timeout_duration = Duration::from_millis(hook.timeout);
    let input_json = serde_json::to_string(input).unwrap_or_default();
    let prompt = replace_prompt_hook_arguments(&hook.prompt, &input_json);
    let messages = vec![Message::user().with_text(prompt)];
    let turn_context = TurnContextOverride {
        output_schema: Some(prompt_hook_output_schema()),
        ..TurnContextOverride::default()
    };

    let result = timeout(timeout_duration, async {
        session_context::with_turn_context(Some(turn_context), async {
            provider
                .complete(PROMPT_HOOK_SYSTEM_PROMPT, &messages, &[])
                .await
        })
        .await
    })
    .await;

    let (message, _usage) = match result {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            return HookResult::failure(format!("Prompt hook 调用模型失败: {error}"));
        }
        Err(_) => {
            return HookResult::failure("Prompt hook 执行超时".to_string());
        }
    };

    let raw_response = message.as_concat_text();
    let parsed = match parse_prompt_hook_response(&raw_response, "Prompt hook") {
        Ok(parsed) => parsed,
        Err(error) => return HookResult::failure(error),
    };

    if parsed.ok {
        HookResult::success(Some(raw_response))
    } else {
        HookResult::blocked(
            parsed
                .reason
                .unwrap_or_else(|| "Prompt hook condition was not met".to_string()),
        )
    }
}

/// 执行 Prompt Hook
async fn execute_prompt_hook(hook: &PromptHookConfig, input: &HookInput) -> HookResult {
    let provider = match resolve_hook_provider(hook.model.as_deref(), input, "Prompt hook").await {
        Ok(provider) => provider,
        Err(error) => return HookResult::failure(error),
    };

    execute_prompt_hook_with_provider(hook, input, provider.as_ref()).await
}

async fn execute_agent_hook_with_provider(
    hook: &AgentHookConfig,
    input: &HookInput,
    provider: Arc<dyn crate::providers::base::Provider>,
) -> HookResult {
    let prompt_template = match resolve_agent_hook_prompt(hook) {
        Ok(prompt) => prompt,
        Err(error) => return HookResult::failure(error),
    };
    let working_dir = resolve_agent_hook_working_dir(input).await;
    let requested_model = resolve_agent_hook_model(hook);
    let input_json = serde_json::to_string(input).unwrap_or_default();
    let prompt = replace_prompt_hook_arguments(&prompt_template, &input_json);
    let session = build_hook_agent_session(working_dir.clone());
    let session_id = session.id.clone();
    let session_store: Arc<dyn SessionStore> = Arc::new(HookAgentSessionStore::new(session));
    let agent = Agent::new().with_session_store(session_store);
    agent.set_permission_mode(AsterMode::Auto).await;

    if let Err(error) = agent.update_provider(provider, &session_id).await {
        return HookResult::failure(format!("Agent hook 初始化 provider 失败: {error}"));
    }

    let cancel_token = CancellationToken::new();
    let session_config = SessionConfig {
        id: session_id.clone(),
        thread_id: Some(session_id.clone()),
        turn_id: Some(format!("hook-turn-{}", Uuid::new_v4())),
        schedule_id: None,
        max_turns: Some(resolve_agent_hook_max_turns(hook)),
        retry_config: None,
        system_prompt: Some(build_agent_hook_system_prompt(hook, input, &working_dir)),
        include_context_trace: None,
        turn_context: Some(TurnContextOverride {
            cwd: Some(working_dir),
            model: requested_model,
            output_schema: Some(prompt_hook_output_schema()),
            ..TurnContextOverride::default()
        }),
    };

    let timeout_duration = Duration::from_millis(hook.timeout);
    let execution = timeout(timeout_duration, async {
        let mut stream = agent
            .reply(
                Message::user().with_text(prompt),
                session_config,
                Some(cancel_token.clone()),
            )
            .await
            .map_err(|error| format!("Agent hook 启动失败: {error}"))?;

        let mut last_text = None;
        while let Some(event) = stream.next().await {
            let event = event.map_err(|error| format!("Agent hook 执行失败: {error}"))?;
            if let AgentEvent::Message(message) = event {
                let text = message.as_concat_text();
                if !text.trim().is_empty() {
                    last_text = Some(text);
                }
            }
        }

        Ok::<Option<String>, String>(last_text)
    })
    .await;

    let last_text = match execution {
        Ok(Ok(Some(text))) => text,
        Ok(Ok(None)) => {
            return HookResult::failure("Agent hook 未返回可解析结果".to_string());
        }
        Ok(Err(error)) => return HookResult::failure(error),
        Err(_) => {
            cancel_token.cancel();
            return HookResult::failure("Agent hook 执行超时".to_string());
        }
    };

    let parsed = match parse_prompt_hook_response(&last_text, "Agent hook") {
        Ok(parsed) => parsed,
        Err(error) => return HookResult::failure(error),
    };

    if parsed.ok {
        HookResult::success(Some(last_text))
    } else {
        HookResult::blocked(
            parsed
                .reason
                .unwrap_or_else(|| "Agent hook condition was not met".to_string()),
        )
    }
}

/// 执行 Agent Hook
async fn execute_agent_hook(hook: &AgentHookConfig, input: &HookInput) -> HookResult {
    let requested_model = resolve_agent_hook_model(hook);
    let provider =
        match resolve_hook_provider(requested_model.as_deref(), input, "Agent hook").await {
            Ok(provider) => provider,
            Err(error) => return HookResult::failure(error),
        };

    execute_agent_hook_with_provider(hook, input, provider).await
}

/// 执行单个 hook
async fn execute_hook(
    hook: &HookConfig,
    input: &HookInput,
    runtime: &HookRuntimeContext,
) -> HookResult {
    match hook {
        HookConfig::Command(c) => execute_command_hook(c, input).await,
        HookConfig::Url(c) => execute_url_hook(c, input).await,
        HookConfig::Mcp(c) => execute_mcp_hook(c, input, runtime).await,
        HookConfig::Prompt(c) => execute_prompt_hook(c, input).await,
        HookConfig::Agent(c) => execute_agent_hook(c, input).await,
    }
}

/// 运行所有匹配的 hooks
pub async fn run_hooks(input: HookInput) -> Vec<HookResult> {
    let registry = global_registry();
    run_hooks_with_registry(input, &registry).await
}

/// 使用指定注册表运行所有匹配的 hooks
pub async fn run_hooks_with_registry(
    input: HookInput,
    registry: &SharedHookRegistry,
) -> Vec<HookResult> {
    run_hooks_with_registry_and_context(input, registry, &HookRuntimeContext::default()).await
}

pub async fn run_hooks_with_registry_and_context(
    input: HookInput,
    registry: &SharedHookRegistry,
    runtime: &HookRuntimeContext,
) -> Vec<HookResult> {
    let event = match input.event {
        Some(e) => e,
        None => return vec![],
    };

    let mut results = Vec::new();

    for hook in registry.get_matching(event, input.tool_name.as_deref()) {
        let result = execute_hook(&hook, &input, runtime).await;
        let is_blocked = result.blocked;
        let is_blocking = hook.is_blocking();
        results.push(result);

        // 如果 hook 阻塞且是 blocking 类型，停止执行后续 hooks
        if is_blocked && is_blocking {
            break;
        }
    }

    if let Some(session_id) = input
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        for entry in get_matching_session_hooks(session_id, event, input.tool_name.as_deref()) {
            let result = execute_hook(&entry.config, &input, runtime).await;
            let is_blocked = result.blocked;
            let is_blocking = entry.config.is_blocking();
            let should_remove_once = entry.once && result.success;
            results.push(result);

            if should_remove_once {
                let _ = unregister_session_hook_entry(session_id, event, entry.id);
            }

            if is_blocked && is_blocking {
                break;
            }
        }
    }

    results
}

/// 检查是否有任何 hook 阻塞操作
pub fn is_blocked(results: &[HookResult]) -> (bool, Option<String>) {
    for result in results {
        if result.blocked {
            return (true, result.block_message.clone());
        }
    }
    (false, None)
}

/// PreToolUse hook 辅助函数
pub async fn run_pre_tool_use_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    session_id: Option<String>,
) -> (bool, Option<String>) {
    let results = run_hooks(HookInput {
        event: Some(HookEvent::PreToolUse),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        session_id,
        ..Default::default()
    })
    .await;

    let (blocked, message) = is_blocked(&results);
    (!blocked, message)
}

/// PostToolUse hook 辅助函数
pub async fn run_post_tool_use_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_output: String,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::PostToolUse),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        tool_output: Some(tool_output),
        session_id,
        ..Default::default()
    })
    .await;
}

/// UserPromptSubmit hook
pub async fn run_user_prompt_submit_hooks(
    prompt: &str,
    session_id: Option<String>,
) -> (bool, Option<String>) {
    let registry = global_registry();
    run_user_prompt_submit_hooks_with_registry(prompt, session_id, &registry).await
}

/// 使用指定注册表运行 UserPromptSubmit hook
pub async fn run_user_prompt_submit_hooks_with_registry(
    prompt: &str,
    session_id: Option<String>,
    registry: &SharedHookRegistry,
) -> (bool, Option<String>) {
    run_user_prompt_submit_hooks_with_registry_and_context(
        prompt,
        session_id,
        registry,
        &HookRuntimeContext::default(),
    )
    .await
}

pub async fn run_user_prompt_submit_hooks_with_registry_and_context(
    prompt: &str,
    session_id: Option<String>,
    registry: &SharedHookRegistry,
    runtime: &HookRuntimeContext,
) -> (bool, Option<String>) {
    let results = run_hooks_with_registry_and_context(
        HookInput {
            event: Some(HookEvent::UserPromptSubmit),
            message: Some(prompt.to_string()),
            session_id,
            ..Default::default()
        },
        registry,
        runtime,
    )
    .await;

    let (blocked, message) = is_blocked(&results);
    (!blocked, message)
}

/// Stop hook
pub async fn run_stop_hooks(reason: Option<String>, session_id: Option<String>) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::Stop),
        message: reason,
        session_id,
        ..Default::default()
    })
    .await;
}

/// PreCompact hook
pub async fn run_pre_compact_hooks(
    session_id: Option<String>,
    current_tokens: Option<u64>,
    trigger: Option<CompactTrigger>,
) -> (bool, Option<String>) {
    let registry = global_registry();
    let results =
        run_pre_compact_hooks_with_registry(session_id, current_tokens, trigger, &registry).await;

    let (blocked, message) = is_blocked(&results);
    (!blocked, message)
}

/// 使用指定注册表运行 PreCompact hook
pub async fn run_pre_compact_hooks_with_registry(
    session_id: Option<String>,
    current_tokens: Option<u64>,
    trigger: Option<CompactTrigger>,
    registry: &SharedHookRegistry,
) -> Vec<HookResult> {
    run_pre_compact_hooks_with_registry_and_context(
        session_id,
        current_tokens,
        trigger,
        registry,
        &HookRuntimeContext::default(),
    )
    .await
}

pub async fn run_pre_compact_hooks_with_registry_and_context(
    session_id: Option<String>,
    current_tokens: Option<u64>,
    trigger: Option<CompactTrigger>,
    registry: &SharedHookRegistry,
    runtime: &HookRuntimeContext,
) -> Vec<HookResult> {
    run_hooks_with_registry_and_context(
        HookInput {
            event: Some(HookEvent::PreCompact),
            current_tokens,
            trigger,
            session_id,
            ..Default::default()
        },
        registry,
        runtime,
    )
    .await
}

/// PostToolUseFailure hook
#[allow(clippy::too_many_arguments)]
pub async fn run_post_tool_use_failure_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: String,
    error: String,
    error_type: HookErrorType,
    is_interrupt: bool,
    is_timeout: bool,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::PostToolUseFailure),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        tool_use_id: Some(tool_use_id),
        error: Some(error),
        error_type: Some(error_type),
        is_interrupt: Some(is_interrupt),
        is_timeout: Some(is_timeout),
        session_id,
        ..Default::default()
    })
    .await;
}

/// SessionStart hook
pub async fn run_session_start_hooks(session_id: String, source: Option<SessionSource>) {
    let registry = global_registry();
    let _ = run_session_start_hooks_with_registry(session_id, source, &registry).await;
}

/// 使用指定注册表运行 SessionStart hook
pub async fn run_session_start_hooks_with_registry(
    session_id: String,
    source: Option<SessionSource>,
    registry: &SharedHookRegistry,
) -> Vec<HookResult> {
    run_session_start_hooks_with_registry_and_context(
        session_id,
        source,
        registry,
        &HookRuntimeContext::default(),
    )
    .await
}

pub async fn run_session_start_hooks_with_registry_and_context(
    session_id: String,
    source: Option<SessionSource>,
    registry: &SharedHookRegistry,
    runtime: &HookRuntimeContext,
) -> Vec<HookResult> {
    run_hooks_with_registry_and_context(
        HookInput {
            event: Some(HookEvent::SessionStart),
            source,
            session_id: Some(session_id),
            ..Default::default()
        },
        registry,
        runtime,
    )
    .await
}

/// SessionEnd hook
pub async fn run_session_end_hooks(session_id: String, reason: Option<SessionEndReason>) {
    let registry = global_registry();
    let _ = run_session_end_hooks_with_registry(session_id, reason, &registry).await;
}

pub async fn run_session_end_hooks_with_registry(
    session_id: String,
    reason: Option<SessionEndReason>,
    registry: &SharedHookRegistry,
) -> Vec<HookResult> {
    run_session_end_hooks_with_registry_and_context(
        session_id,
        reason,
        registry,
        &HookRuntimeContext::default(),
    )
    .await
}

pub async fn run_session_end_hooks_with_registry_and_context(
    session_id: String,
    reason: Option<SessionEndReason>,
    registry: &SharedHookRegistry,
    runtime: &HookRuntimeContext,
) -> Vec<HookResult> {
    let results = run_hooks_with_registry_and_context(
        HookInput {
            event: Some(HookEvent::SessionEnd),
            reason,
            session_id: Some(session_id.clone()),
            ..Default::default()
        },
        registry,
        runtime,
    )
    .await;
    clear_session_hooks(&session_id);
    results
}

/// SubagentStart hook
pub async fn run_subagent_start_hooks(
    agent_id: String,
    agent_type: String,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::SubagentStart),
        agent_id: Some(agent_id),
        agent_type: Some(agent_type),
        session_id,
        ..Default::default()
    })
    .await;
}

/// SubagentStop hook
pub async fn run_subagent_stop_hooks(
    agent_id: String,
    agent_type: String,
    result: Option<serde_json::Value>,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::SubagentStop),
        agent_id: Some(agent_id),
        agent_type: Some(agent_type),
        result,
        session_id,
        ..Default::default()
    })
    .await;
}

/// PermissionRequest hook
pub async fn run_permission_request_hooks(
    tool_name: &str,
    tool_input: Option<serde_json::Value>,
    tool_use_id: Option<String>,
    session_id: Option<String>,
) -> (Option<HookDecision>, Option<String>) {
    let results = run_hooks(HookInput {
        event: Some(HookEvent::PermissionRequest),
        tool_name: Some(tool_name.to_string()),
        tool_input,
        tool_use_id,
        session_id,
        ..Default::default()
    })
    .await;

    for result in &results {
        if let Some(output) = &result.output {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
                if let Some(decision) = json.get("decision").and_then(|v| v.as_str()) {
                    let d = match decision {
                        "allow" => HookDecision::Allow,
                        "deny" => HookDecision::Deny,
                        _ => continue,
                    };
                    let message = json
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    return (Some(d), message);
                }
            }
        }
    }

    (None, None)
}

/// Notification hook
pub async fn run_notification_hooks(
    message: &str,
    notification_type: Option<NotificationType>,
    session_id: Option<String>,
) {
    let _ = run_hooks(HookInput {
        event: Some(HookEvent::Notification),
        message: Some(message.to_string()),
        notification_type,
        session_id,
        ..Default::default()
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
    use crate::providers::errors::ProviderError;
    use async_trait::async_trait;
    use rmcp::model::{CallToolRequestParam, Tool};
    use rmcp::object;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    struct StaticResponseProvider {
        response: String,
        captured: Arc<Mutex<Vec<Message>>>,
        name: String,
    }

    impl StaticResponseProvider {
        fn new(response: impl Into<String>) -> Self {
            Self {
                response: response.into(),
                captured: Arc::new(Mutex::new(Vec::new())),
                name: "static-response-provider".to_string(),
            }
        }

        fn captured_messages(&self) -> Vec<Message> {
            match self.captured.lock() {
                Ok(guard) => guard.clone(),
                Err(error) => error.into_inner().clone(),
            }
        }
    }

    #[async_trait]
    impl Provider for StaticResponseProvider {
        fn metadata() -> ProviderMetadata {
            ProviderMetadata::new(
                "static-response-provider",
                "Static Response Provider",
                "Test provider for prompt hook executor",
                "gpt-4o",
                vec!["gpt-4o"],
                "",
                vec![],
            )
        }

        fn get_name(&self) -> &str {
            &self.name
        }

        async fn complete_with_model(
            &self,
            _model_config: &crate::model::ModelConfig,
            _system: &str,
            messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            let mut captured = match self.captured.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            *captured = messages.to_vec();

            Ok((
                Message::assistant().with_text(self.response.clone()),
                ProviderUsage::new("gpt-4o".to_string(), Usage::default()),
            ))
        }

        fn get_model_config(&self) -> crate::model::ModelConfig {
            crate::model::ModelConfig::new_or_fail("gpt-4o")
        }
    }

    #[test]
    fn replace_prompt_hook_arguments_should_append_json_when_no_placeholder() {
        let processed = replace_prompt_hook_arguments("请检查输入", r#"{"ok":true}"#);

        assert!(processed.contains("请检查输入"));
        assert!(processed.contains("Hook input JSON"));
        assert!(processed.contains(r#"{"ok":true}"#));
    }

    #[test]
    fn parse_prompt_hook_response_should_accept_fenced_json() {
        let parsed = parse_prompt_hook_response(
            "```json\n{\"ok\":false,\"reason\":\"blocked\"}\n```",
            "Prompt hook",
        )
        .expect("应能解析 fenced json");

        assert!(!parsed.ok);
        assert_eq!(parsed.reason.as_deref(), Some("blocked"));
    }

    #[tokio::test]
    async fn execute_prompt_hook_with_provider_should_allow_when_model_returns_ok_json() {
        let provider = StaticResponseProvider::new(r#"{"ok":true}"#);
        let hook = PromptHookConfig {
            prompt: "请根据 $ARGUMENTS 判断是否允许".to_string(),
            model: None,
            timeout: 1000,
            blocking: true,
            matcher: None,
        };
        let input = HookInput {
            event: Some(HookEvent::UserPromptSubmit),
            message: Some("继续执行".to_string()),
            session_id: Some("session-prompt-hook-ok".to_string()),
            ..Default::default()
        };

        let result = execute_prompt_hook_with_provider(&hook, &input, &provider).await;

        assert!(result.success);
        assert!(!result.blocked);
        let captured_messages = provider.captured_messages();
        assert_eq!(captured_messages.len(), 1);
        let prompt = captured_messages[0].as_concat_text();
        assert!(prompt.contains("\"event\":\"UserPromptSubmit\""));
        assert!(prompt.contains("\"session_id\":\"session-prompt-hook-ok\""));
    }

    #[tokio::test]
    async fn execute_prompt_hook_with_provider_should_block_when_model_returns_reason() {
        let provider = StaticResponseProvider::new(r#"{"ok":false,"reason":"needs confirmation"}"#);
        let hook = PromptHookConfig {
            prompt: "评估这个请求".to_string(),
            model: None,
            timeout: 1000,
            blocking: true,
            matcher: None,
        };
        let input = HookInput {
            event: Some(HookEvent::UserPromptSubmit),
            message: Some("继续执行".to_string()),
            session_id: Some("session-prompt-hook-block".to_string()),
            ..Default::default()
        };

        let result = execute_prompt_hook_with_provider(&hook, &input, &provider).await;

        assert!(!result.success);
        assert!(result.blocked);
        assert_eq!(result.block_message.as_deref(), Some("needs confirmation"));
    }

    struct AgentHookScriptedProvider {
        responses: Vec<Message>,
        captured_turns: Arc<Mutex<Vec<Vec<Message>>>>,
        calls: AtomicUsize,
    }

    impl AgentHookScriptedProvider {
        fn new(responses: Vec<Message>) -> Self {
            Self {
                responses,
                captured_turns: Arc::new(Mutex::new(Vec::new())),
                calls: AtomicUsize::new(0),
            }
        }

        fn captured_turns(&self) -> Vec<Vec<Message>> {
            match self.captured_turns.lock() {
                Ok(guard) => guard.clone(),
                Err(error) => error.into_inner().clone(),
            }
        }
    }

    #[async_trait]
    impl Provider for AgentHookScriptedProvider {
        fn metadata() -> ProviderMetadata {
            ProviderMetadata::new(
                "agent-hook-scripted-provider",
                "Agent Hook Scripted Provider",
                "Test provider for agent hook executor",
                "gpt-4o",
                vec!["gpt-4o"],
                "",
                vec![],
            )
        }

        fn get_name(&self) -> &str {
            "agent-hook-scripted-provider"
        }

        async fn complete_with_model(
            &self,
            _model_config: &crate::model::ModelConfig,
            _system: &str,
            messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            let mut captured = match self.captured_turns.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            captured.push(messages.to_vec());

            let index = self.calls.fetch_add(1, Ordering::SeqCst);
            let response = self
                .responses
                .get(index)
                .cloned()
                .or_else(|| self.responses.last().cloned())
                .ok_or_else(|| {
                    ProviderError::ExecutionError("missing scripted response".to_string())
                })?;

            Ok((
                response,
                ProviderUsage::new("gpt-4o".to_string(), Usage::default()),
            ))
        }

        fn get_model_config(&self) -> crate::model::ModelConfig {
            crate::model::ModelConfig::new_or_fail("gpt-4o")
        }
    }

    #[tokio::test]
    async fn execute_agent_hook_with_provider_should_allow_after_tool_verification() {
        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let target_file = temp_dir.path().join("verification.txt");
        std::fs::write(&target_file, "tests passed").expect("write verification file");

        let provider = Arc::new(AgentHookScriptedProvider::new(vec![
            Message::assistant().with_tool_request(
                "req-read",
                Ok(CallToolRequestParam {
                    name: "Read".into(),
                    arguments: Some(object!({
                        "path": target_file.to_string_lossy().to_string(),
                    })),
                }),
            ),
            Message::assistant().with_tool_request(
                "req-output",
                Ok(CallToolRequestParam {
                    name: "StructuredOutput".into(),
                    arguments: Some(object!({
                        "ok": true,
                    })),
                }),
            ),
        ]));
        let hook = AgentHookConfig {
            agent_type: "verifier".to_string(),
            prompt: Some("验证 $ARGUMENTS[0] 是否存在且包含 tests passed".to_string()),
            model: None,
            agent_config: None,
            timeout: 5000,
            blocking: true,
            matcher: None,
        };
        let input = HookInput {
            event: Some(HookEvent::Stop),
            message: Some("请验证".to_string()),
            tool_input: Some(serde_json::json!([target_file
                .to_string_lossy()
                .to_string()])),
            ..Default::default()
        };

        let result = execute_agent_hook_with_provider(&hook, &input, provider.clone()).await;

        assert!(result.success);
        assert!(!result.blocked);
        let captured_turns = provider.captured_turns();
        assert_eq!(captured_turns.len(), 2);
        let first_prompt = captured_turns[0]
            .last()
            .expect("first turn should have user prompt")
            .as_concat_text();
        assert!(first_prompt.contains("verification.txt"));
        assert!(first_prompt.contains("tests passed"));
    }

    #[tokio::test]
    async fn execute_agent_hook_with_provider_should_block_with_structured_reason() {
        let provider = Arc::new(AgentHookScriptedProvider::new(vec![Message::assistant()
            .with_tool_request(
                "req-output",
                Ok(CallToolRequestParam {
                    name: "StructuredOutput".into(),
                    arguments: Some(object!({
                        "ok": false,
                        "reason": "verification failed",
                    })),
                }),
            )]));
        let hook = AgentHookConfig {
            agent_type: "verifier".to_string(),
            prompt: Some("验证当前状态".to_string()),
            model: None,
            agent_config: None,
            timeout: 5000,
            blocking: true,
            matcher: None,
        };

        let result = execute_agent_hook_with_provider(&hook, &HookInput::default(), provider).await;

        assert!(!result.success);
        assert!(result.blocked);
        assert_eq!(result.block_message.as_deref(), Some("verification failed"));
    }

    #[tokio::test]
    async fn execute_agent_hook_with_provider_should_fallback_to_agent_config_prompt() {
        let provider = Arc::new(AgentHookScriptedProvider::new(vec![Message::assistant()
            .with_tool_request(
                "req-output",
                Ok(CallToolRequestParam {
                    name: "StructuredOutput".into(),
                    arguments: Some(object!({
                        "ok": true,
                    })),
                }),
            )]));
        let hook = AgentHookConfig {
            agent_type: "compat-agent".to_string(),
            prompt: None,
            model: None,
            agent_config: Some(serde_json::json!({
                "prompt": "请根据 $ARGUMENTS 判断是否继续",
            })),
            timeout: 5000,
            blocking: true,
            matcher: None,
        };
        let input = HookInput {
            tool_input: Some(serde_json::json!(["compat-input"])),
            ..Default::default()
        };

        let result = execute_agent_hook_with_provider(&hook, &input, provider.clone()).await;

        assert!(result.success);
        let captured_turns = provider.captured_turns();
        let first_prompt = captured_turns[0]
            .last()
            .expect("first turn should have user prompt")
            .as_concat_text();
        assert!(first_prompt.contains("compat-input"));
    }

    fn build_test_mcp_runtime_context<F, Fut>(dispatcher: F) -> HookRuntimeContext
    where
        F: Fn(McpHookConfig, HookInput) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = HookResult> + Send + 'static,
    {
        HookRuntimeContext::new().with_mcp_executor(Arc::new(move |hook, input| {
            Box::pin(dispatcher(hook, input))
        }))
    }

    #[tokio::test]
    async fn execute_mcp_hook_should_use_runtime_dispatcher_result() {
        let runtime = build_test_mcp_runtime_context(|hook, input| async move {
            assert_eq!(hook.server, "docs");
            assert_eq!(hook.tool, "search");
            assert_eq!(input.session_id.as_deref(), Some("session-mcp-hook-ok"));
            HookResult::success(Some("{\"ok\":true}".to_string()))
        });
        let hook = McpHookConfig {
            server: "docs".to_string(),
            tool: "search".to_string(),
            tool_args: Some(serde_json::json!({"query":"hooks"})),
            timeout: 1000,
            blocking: true,
            matcher: None,
        };
        let input = HookInput {
            session_id: Some("session-mcp-hook-ok".to_string()),
            ..Default::default()
        };

        let result = execute_mcp_hook(&hook, &input, &runtime).await;

        assert!(result.success);
        assert_eq!(result.output.as_deref(), Some("{\"ok\":true}"));
    }

    #[tokio::test]
    async fn execute_mcp_hook_should_propagate_blocked_result() {
        let runtime = build_test_mcp_runtime_context(|_, _| async move {
            HookResult::blocked("blocked by mcp".to_string())
        });
        let hook = McpHookConfig {
            server: "docs".to_string(),
            tool: "search".to_string(),
            tool_args: None,
            timeout: 1000,
            blocking: true,
            matcher: None,
        };

        let result = execute_mcp_hook(&hook, &HookInput::default(), &runtime).await;

        assert!(!result.success);
        assert!(result.blocked);
        assert_eq!(result.block_message.as_deref(), Some("blocked by mcp"));
    }

    #[tokio::test]
    async fn execute_mcp_hook_should_fail_without_runtime_dispatcher() {
        let hook = McpHookConfig {
            server: "docs".to_string(),
            tool: "search".to_string(),
            tool_args: None,
            timeout: 1000,
            blocking: true,
            matcher: None,
        };

        let result =
            execute_mcp_hook(&hook, &HookInput::default(), &HookRuntimeContext::default()).await;

        assert!(!result.success);
        assert!(result
            .error
            .unwrap_or_default()
            .contains("未提供 dispatcher"));
    }

    #[tokio::test]
    async fn execute_mcp_hook_should_fail_on_timeout() {
        let runtime = build_test_mcp_runtime_context(|_, _| async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            HookResult::success(Some("late".to_string()))
        });
        let hook = McpHookConfig {
            server: "docs".to_string(),
            tool: "search".to_string(),
            tool_args: None,
            timeout: 10,
            blocking: true,
            matcher: None,
        };

        let result = execute_mcp_hook(&hook, &HookInput::default(), &runtime).await;

        assert!(!result.success);
        assert_eq!(result.error.as_deref(), Some("MCP hook 执行超时"));
    }
}
