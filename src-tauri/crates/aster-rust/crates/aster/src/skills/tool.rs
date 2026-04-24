//! Skill Tool
//!
//! Tool implementation for executing skills.

use super::registry::{global_registry, refresh_shared_registry_if_needed};
use super::{
    LlmProvider, SharedSkillRegistry, SkillDefinition, SkillError, SkillExecutionMode,
    SkillExecutionResult, SkillExecutor,
};
use crate::agents::extension::PlatformExtensionContext;
use crate::agents::{Agent, AgentEvent, SessionConfig};
use crate::config::AsterMode;
use crate::conversation::message::Message;
use crate::conversation::Conversation;
use crate::execution::manager::AgentManager;
use crate::hooks::register_session_frontmatter_hooks;
use crate::model::ModelConfig;
use crate::providers::base::Provider;
use crate::providers::errors::ProviderError;
use crate::providers::{create_with_default_model, create_with_named_model};
use crate::session::{
    ChatHistoryMatch, CommitOptions, CommitReport, ExtensionData, ItemRuntime, ItemRuntimePayload,
    MemoryCategory, MemoryHealth, MemoryRecord, MemorySearchResult, MemoryStats, Session,
    SessionInsights, SessionStore, SessionType, TokenStatsUpdate, TurnContextOverride,
};
use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;
use async_trait::async_trait;
use futures::StreamExt;
use lru::LruCache;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use tokio::sync::RwLock;
use uuid::Uuid;

const SKILL_SOURCE_AGENT_CACHE_CAPACITY: usize = 128;
static SKILL_SOURCE_AGENT_CACHE: OnceLock<RwLock<LruCache<String, Arc<Agent>>>> = OnceLock::new();

fn skill_source_agent_cache() -> &'static RwLock<LruCache<String, Arc<Agent>>> {
    SKILL_SOURCE_AGENT_CACHE.get_or_init(|| {
        RwLock::new(LruCache::new(
            NonZeroUsize::new(SKILL_SOURCE_AGENT_CACHE_CAPACITY)
                .expect("skill source agent cache capacity should be non-zero"),
        ))
    })
}

/// Skill tool input parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInput {
    /// Skill name (e.g., "pdf", "user:my-skill")
    pub skill: String,
    /// Optional arguments for the skill
    pub args: Option<String>,
}

/// Skill Tool for executing skills
///
pub struct SkillTool {
    registry: SharedSkillRegistry,
}

impl Default for SkillTool {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillTool {
    /// Create a new SkillTool
    pub fn new() -> Self {
        Self::with_registry(global_registry().clone())
    }

    pub fn with_registry(registry: SharedSkillRegistry) -> Self {
        Self { registry }
    }

    pub async fn register_source_agent_for_session(session_id: String, agent: Arc<Agent>) {
        let normalized_session_id = session_id.trim();
        if normalized_session_id.is_empty() {
            return;
        }

        let mut cache = skill_source_agent_cache().write().await;
        cache.put(normalized_session_id.to_string(), agent);
    }

    /// Execute a skill by name
    pub async fn execute_skill(
        &self,
        skill_name: &str,
        args: Option<&str>,
        context: &ToolContext,
    ) -> Result<SkillExecutionResult, String> {
        refresh_shared_registry_if_needed(&self.registry)?;

        // First, get all the data we need from the skill
        let skill = {
            let registry_guard = self.registry.read().map_err(|e| e.to_string())?;

            let skill = registry_guard.find(skill_name).ok_or_else(|| {
                let available: Vec<_> = registry_guard
                    .get_all()
                    .iter()
                    .map(|s| s.skill_name.as_str())
                    .collect();
                format!(
                    "Skill '{}' not found. Available skills: {}",
                    skill_name,
                    if available.is_empty() {
                        "none".to_string()
                    } else {
                        available.join(", ")
                    }
                )
            })?;

            // Check if model invocation is disabled
            if skill.disable_model_invocation {
                return Err(format!(
                    "Skill '{}' has model invocation disabled",
                    skill.skill_name
                ));
            }

            skill.clone()
        };

        let skill_content = build_skill_content(&skill, args, &context.session_id);

        // Record invocation with write lock
        if let Ok(mut registry_write) = self.registry.write() {
            registry_write.record_invoked(&skill.skill_name, &skill.file_path, &skill_content);
        }

        if let Some(frontmatter_hooks) = skill.hooks.as_ref() {
            if context.session_id.trim().is_empty() {
                tracing::warn!(
                    "[SkillTool] skill '{}' 声明了 frontmatter hooks，但当前调用缺少 session_id，已跳过注册",
                    skill.skill_name
                );
            } else {
                let report = register_session_frontmatter_hooks(
                    context.session_id.trim(),
                    frontmatter_hooks,
                );
                if report.registered > 0 {
                    tracing::info!(
                        "[SkillTool] 已为 session={} 注册 {} 个 skill frontmatter hooks: {}",
                        context.session_id,
                        report.registered,
                        skill.skill_name
                    );
                }
                for skipped in report.skipped {
                    tracing::warn!(
                        "[SkillTool] 跳过 skill '{}' 的 frontmatter hook: {}",
                        skill.skill_name,
                        skipped
                    );
                }
            }
        }

        if Self::should_execute_with_agent_runtime(&skill) {
            return Ok(self
                .execute_agent_skill(&skill, &skill_content, context)
                .await);
        }

        let provider = self.resolve_llm_provider(&skill, context).await?;
        let executor = SkillExecutor::new(provider);
        let skill_input = args.unwrap_or_default();
        executor
            .execute(&skill, skill_input, None)
            .await
            .map_err(|error| format!("执行 skill '{}' 失败: {}", skill.skill_name, error))
    }

    fn should_execute_with_agent_runtime(skill: &SkillDefinition) -> bool {
        skill.execution_mode == SkillExecutionMode::Agent
            || (skill.execution_mode == SkillExecutionMode::Prompt
                && skill
                    .allowed_tools
                    .as_ref()
                    .is_some_and(|tools| !tools.is_empty()))
    }

    /// Generate tool description with available skills
    fn generate_description(&self) -> String {
        if let Err(error) = refresh_shared_registry_if_needed(&self.registry) {
            tracing::warn!("[SkillTool] 刷新 plugin skill 注册表失败: {}", error);
        }

        let skills_xml = if let Ok(registry_guard) = self.registry.read() {
            registry_guard
                .get_all()
                .iter()
                .map(|skill| {
                    format!(
                        r#"<skill>
<name>{}</name>
<description>{}</description>
<location>{}</location>
</skill>"#,
                        skill.skill_name, skill.description, skill.source
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            String::new()
        };

        format!(
            r#"Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

When users ask you to run a "slash command" or reference "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke the corresponding skill.

<example>
User: "run /commit"
Assistant: [Calls Skill tool with skill: "commit"]
</example>

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "user:pdf"` - invoke using fully qualified name

Important:
- When a skill is relevant, invoke this tool IMMEDIATELY as your first action
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already running
</skills_instructions>

<available_skills>
{}
</available_skills>
"#,
            skills_xml
        )
    }

    async fn resolve_current_session_agent(context: &ToolContext) -> Option<Arc<Agent>> {
        let session_id = context.session_id.trim();
        if session_id.is_empty() {
            return None;
        }

        {
            let mut cache = skill_source_agent_cache().write().await;
            if let Some(agent) = cache.get(session_id).cloned() {
                return Some(agent);
            }
        }

        let manager = AgentManager::instance().await.ok()?;
        manager
            .get_or_create_agent(session_id.to_string())
            .await
            .ok()
    }

    async fn resolve_current_provider(
        context: &ToolContext,
    ) -> Result<Option<Arc<dyn Provider>>, String> {
        if let Some(provider) = context.provider.as_ref() {
            return Ok(Some(provider.clone()));
        }

        let Some(agent) = Self::resolve_current_session_agent(context).await else {
            return Ok(None);
        };

        match agent.provider().await {
            Ok(provider) => Ok(Some(provider)),
            Err(_) => Ok(None),
        }
    }

    async fn resolve_llm_provider(
        &self,
        skill: &SkillDefinition,
        context: &ToolContext,
    ) -> Result<SessionLlmProvider, String> {
        let resolved = self.resolve_skill_provider(skill, context).await?;
        Ok(SessionLlmProvider::new(resolved.provider).with_default_model(resolved.model))
    }

    async fn resolve_skill_provider(
        &self,
        skill: &SkillDefinition,
        context: &ToolContext,
    ) -> Result<ResolvedSkillProvider, String> {
        let current_provider = Self::resolve_current_provider(context).await?;
        let requested_model = skill
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        if let Some(requested_provider) = skill.provider.as_deref() {
            if let Some(provider) = current_provider.as_ref() {
                if provider.get_name().eq_ignore_ascii_case(requested_provider) {
                    return Ok(ResolvedSkillProvider::new(
                        provider.clone(),
                        requested_model.clone(),
                    ));
                }
            }

            let provider = if let Some(model_name) = requested_model.as_deref() {
                create_with_named_model(requested_provider, model_name)
                    .await
                    .map_err(|error| {
                        format!(
                            "创建 skill provider '{}' 失败: {}",
                            requested_provider, error
                        )
                    })?
            } else {
                create_with_default_model(requested_provider)
                    .await
                    .map_err(|error| {
                        format!(
                            "创建 skill provider '{}' 失败: {}",
                            requested_provider, error
                        )
                    })?
            };

            return Ok(ResolvedSkillProvider::new(provider, requested_model));
        }

        let provider = current_provider.ok_or_else(|| {
            "当前 session 没有关联可用 provider，无法执行 Skill；请在带 provider 的会话中重试"
                .to_string()
        })?;

        Ok(ResolvedSkillProvider::new(provider, requested_model))
    }

    async fn execute_agent_skill(
        &self,
        skill: &SkillDefinition,
        skill_content: &str,
        context: &ToolContext,
    ) -> SkillExecutionResult {
        let source_agent = Self::resolve_current_session_agent(context).await;
        self.execute_agent_skill_with_source_agent(skill, skill_content, context, source_agent)
            .await
    }

    async fn execute_agent_skill_with_source_agent(
        &self,
        skill: &SkillDefinition,
        skill_content: &str,
        context: &ToolContext,
        source_agent: Option<Arc<Agent>>,
    ) -> SkillExecutionResult {
        let resolved_provider = match self.resolve_skill_provider(skill, context).await {
            Ok(provider) => provider,
            Err(error) => return build_failed_skill_result(skill, error),
        };
        let requested_model = resolved_provider.model.clone();

        let session = build_skill_agent_session(
            context.working_directory.clone(),
            skill,
            Some(context.session_id.as_str()),
        );
        let session_id = session.id.clone();
        let session_store: Arc<dyn SessionStore> = Arc::new(SkillAgentSessionStore::new(session));
        let mut agent = Agent::new().with_session_store(session_store);
        if let Some(source_agent) = source_agent.as_deref() {
            agent = agent.with_shared_native_tool_surface_from(source_agent);
        }
        agent
            .extension_manager
            .set_context(PlatformExtensionContext {
                session_id: Some(session_id.clone()),
                extension_manager: Some(Arc::downgrade(&agent.extension_manager)),
            })
            .await;
        if let Some(source_agent) = source_agent.as_deref() {
            if let Err(error) = agent.inherit_runtime_tool_surface_from(source_agent).await {
                return build_failed_skill_result(
                    skill,
                    format!("继承当前 session 工具面失败: {error}"),
                );
            }
        }
        agent.set_permission_mode(AsterMode::Auto).await;

        if let Err(error) = agent
            .update_provider(resolved_provider.provider.clone(), &session_id)
            .await
        {
            return build_failed_skill_result(
                skill,
                format!("初始化 skill agent provider 失败: {error}"),
            );
        }

        let session_config = SessionConfig {
            id: session_id.clone(),
            thread_id: Some(session_id.clone()),
            turn_id: Some(format!("skill-turn-{}", Uuid::new_v4())),
            schedule_id: None,
            max_turns: None,
            retry_config: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: Some(TurnContextOverride {
                cwd: Some(context.working_directory.clone()),
                model: requested_model.clone(),
                metadata: build_skill_turn_context_metadata(skill),
                ..TurnContextOverride::default()
            }),
        };

        let mut stream = match agent
            .reply(
                Message::user().with_text(skill_content),
                session_config,
                context.cancellation_token.clone(),
            )
            .await
        {
            Ok(stream) => stream,
            Err(error) => {
                return build_failed_skill_result(skill, format!("启动 skill agent 失败: {error}"));
            }
        };

        let mut last_assistant_text = None;
        let mut forwarded_tool_call = None;
        while let Some(event) = stream.next().await {
            match event {
                Ok(AgentEvent::Message(message))
                    if message.role == rmcp::model::Role::Assistant =>
                {
                    let text = message.as_concat_text();
                    if !text.trim().is_empty() {
                        last_assistant_text = Some(text);
                    }
                }
                Ok(AgentEvent::ItemCompleted { item }) => {
                    if let Some(tool_call) =
                        extract_forwarded_skill_tool_call(&item, skill.allowed_tools.as_deref())
                    {
                        forwarded_tool_call = Some(tool_call);
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    return build_failed_skill_result(
                        skill,
                        format!("执行 skill agent 失败: {error}"),
                    );
                }
            }
        }

        let mut result = build_success_skill_result(
            skill,
            last_assistant_text.unwrap_or_else(|| "Skill executed".to_string()),
        );
        if let Some(tool_call) = forwarded_tool_call {
            result.forwarded_tool_name = Some(tool_call.tool_name);
            result.forwarded_tool_metadata = Some(tool_call.metadata);
        }
        result
    }
}

#[derive(Clone)]
struct ResolvedSkillProvider {
    provider: Arc<dyn Provider>,
    model: Option<String>,
}

impl ResolvedSkillProvider {
    fn new(provider: Arc<dyn Provider>, model: Option<String>) -> Self {
        Self { provider, model }
    }
}

#[derive(Clone)]
struct SessionLlmProvider {
    provider: Arc<dyn Provider>,
    default_model: Option<String>,
}

impl SessionLlmProvider {
    fn new(provider: Arc<dyn Provider>) -> Self {
        Self {
            provider,
            default_model: None,
        }
    }

    fn with_default_model(mut self, model: Option<String>) -> Self {
        self.default_model = model.filter(|value| !value.trim().is_empty());
        self
    }

    fn resolve_model_config(&self, model: Option<&str>) -> Result<Option<ModelConfig>, SkillError> {
        let requested_model = model
            .or(self.default_model.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty());

        let Some(requested_model) = requested_model else {
            return Ok(None);
        };

        let mut model_config = self.provider.get_model_config();
        if model_config.model_name == requested_model {
            return Ok(Some(model_config));
        }

        let parsed = ModelConfig::new(requested_model).map_err(|error| {
            SkillError::invalid_config(format!("无效 skill model '{}': {error}", requested_model))
        })?;
        model_config.model_name = parsed.model_name;
        model_config.context_limit = parsed.context_limit;
        model_config.fast_model = parsed.fast_model;
        Ok(Some(model_config))
    }
}

#[async_trait]
impl LlmProvider for SessionLlmProvider {
    async fn chat(
        &self,
        system_prompt: &str,
        user_message: &str,
        model: Option<&str>,
    ) -> Result<String, SkillError> {
        let messages = vec![Message::user().with_text(user_message)];
        let response = if let Some(model_config) = self.resolve_model_config(model)? {
            self.provider
                .complete_with_model(&model_config, system_prompt, &messages, &[])
                .await
        } else {
            self.provider.complete(system_prompt, &messages, &[]).await
        };

        let (message, _usage) = response.map_err(provider_error_to_skill_error)?;
        Ok(message.as_concat_text())
    }
}

fn provider_error_to_skill_error(error: ProviderError) -> SkillError {
    SkillError::provider_error(error.to_string())
}

fn build_skill_content(skill: &SkillDefinition, args: Option<&str>, session_id: &str) -> String {
    let normalized_dir = normalize_skill_path(&skill.base_dir);
    let mut skill_content = if normalized_dir.is_empty() {
        skill.markdown_content.clone()
    } else {
        format!(
            "Base directory for this skill: {normalized_dir}\n\n{}",
            skill.markdown_content
        )
    };

    if !normalized_dir.is_empty() {
        skill_content = skill_content.replace("${CLAUDE_SKILL_DIR}", &normalized_dir);
    }
    skill_content = skill_content.replace("${CLAUDE_SESSION_ID}", session_id);

    if let Some(args_str) = args.filter(|value| !value.trim().is_empty()) {
        skill_content.push_str(&format!("\n\n**ARGUMENTS:** {}", args_str));
    }

    skill_content
}

fn normalize_skill_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn build_skill_turn_context_metadata(skill: &SkillDefinition) -> HashMap<String, Value> {
    let mut metadata = HashMap::new();

    if let Some(allowed_tools) = skill
        .allowed_tools
        .as_ref()
        .filter(|tools| !tools.is_empty())
    {
        metadata.insert(
            "tool_scope".to_string(),
            json!({
                "allowed_tools": allowed_tools,
            }),
        );
    }

    metadata
}

fn build_skill_agent_session(
    working_dir: PathBuf,
    skill: &SkillDefinition,
    parent_session_id: Option<&str>,
) -> Session {
    let session_id = parent_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("skill-agent-{}", Uuid::new_v4()));

    Session {
        id: session_id,
        working_dir,
        name: format!("skill-agent:{}", skill.short_name()),
        user_set_name: false,
        // skill 会话使用隔离的自定义 SessionStore 持有状态，
        // 不需要再复用 SubAgent 的工具白名单裁剪，否则 current-surface
        // 动态注册工具（如 lime_create_image_generation_task）会在列举阶段被隐藏。
        session_type: SessionType::User,
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

fn build_failed_skill_result(
    skill: &SkillDefinition,
    error: impl Into<String>,
) -> SkillExecutionResult {
    SkillExecutionResult {
        success: false,
        output: None,
        error: Some(error.into()),
        steps_completed: Vec::new(),
        command_name: Some(skill.skill_name.clone()),
        allowed_tools: skill.allowed_tools.clone(),
        model: skill.model.clone(),
        forwarded_tool_name: None,
        forwarded_tool_metadata: None,
    }
}

fn build_success_skill_result(
    skill: &SkillDefinition,
    output: impl Into<String>,
) -> SkillExecutionResult {
    SkillExecutionResult {
        success: true,
        output: Some(output.into()),
        error: None,
        steps_completed: Vec::new(),
        command_name: Some(skill.skill_name.clone()),
        allowed_tools: skill.allowed_tools.clone(),
        model: skill.model.clone(),
        forwarded_tool_name: None,
        forwarded_tool_metadata: None,
    }
}

#[derive(Debug, Clone)]
struct ForwardedSkillToolCall {
    tool_name: String,
    metadata: Value,
}

fn extract_forwarded_skill_tool_call(
    item: &ItemRuntime,
    allowed_tools: Option<&[String]>,
) -> Option<ForwardedSkillToolCall> {
    let ItemRuntimePayload::ToolCall {
        tool_name,
        output,
        success,
        ..
    } = &item.payload
    else {
        return None;
    };

    if !success.unwrap_or(false) {
        return None;
    }

    let allowed_tools = allowed_tools?;
    if allowed_tools.is_empty() || !allowed_tools.iter().any(|name| name == tool_name) {
        return None;
    }

    let metadata = output
        .as_ref()
        .and_then(extract_structured_tool_metadata)
        .filter(Value::is_object)?;

    Some(ForwardedSkillToolCall {
        tool_name: tool_name.clone(),
        metadata,
    })
}

fn extract_structured_tool_metadata(output: &Value) -> Option<Value> {
    let record = output.as_object()?;
    record
        .get("structured_content")
        .or_else(|| record.get("structuredContent"))
        .cloned()
}

struct SkillAgentSessionStore {
    session: Mutex<Session>,
}

impl SkillAgentSessionStore {
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
impl SessionStore for SkillAgentSessionStore {
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
        session.id = format!("skill-agent-copy-{}", Uuid::new_v4());
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
        model_config: Option<ModelConfig>,
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
            message: "skill-agent-memory-disabled".to_string(),
        })
    }
}

#[async_trait]
impl Tool for SkillTool {
    fn name(&self) -> &str {
        "Skill"
    }

    fn description(&self) -> &str {
        "Execute a skill within the main conversation. \
         Skills provide specialized capabilities and domain knowledge."
    }

    /// 动态生成包含可用 Skills 列表的描述
    fn dynamic_description(&self) -> Option<String> {
        Some(self.generate_description())
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "skill": {
                    "type": "string",
                    "description": "The skill name. E.g., 'pdf', 'user:my-skill'"
                },
                "args": {
                    "type": "string",
                    "description": "Optional arguments for the skill"
                }
            },
            "required": ["skill"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let skill_name = params
            .get("skill")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: skill"))?;

        let args = params.get("args").and_then(|v| v.as_str());

        match self.execute_skill(skill_name, args, context).await {
            Ok(result) => {
                let metadata = json!({
                    "success": result.success,
                    "stepsCompleted": result.steps_completed.clone(),
                    "output": result.output.clone(),
                    "error": result.error.clone(),
                });

                let mut tool_result = if result.success {
                    ToolResult::success(
                        result
                            .output
                            .clone()
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "Skill executed".to_string()),
                    )
                } else {
                    ToolResult::error(
                        result
                            .error
                            .clone()
                            .or(result.output.clone())
                            .unwrap_or_else(|| "Skill execution failed".to_string()),
                    )
                }
                .with_metadata("skill", metadata);

                if let Some(cmd_name) = result.command_name {
                    tool_result =
                        tool_result.with_metadata("command_name", serde_json::json!(cmd_name));
                }
                if let Some(tools) = result.allowed_tools {
                    tool_result =
                        tool_result.with_metadata("allowed_tools", serde_json::json!(tools));
                }
                if let Some(model) = result.model {
                    tool_result = tool_result.with_metadata("model", serde_json::json!(model));
                }
                if let Some(forwarded_tool_name) = result.forwarded_tool_name {
                    tool_result = tool_result.with_metadata(
                        "skill_forwarded_tool_name",
                        serde_json::json!(forwarded_tool_name),
                    );
                }
                if let Some(forwarded_metadata) = result.forwarded_tool_metadata {
                    if let Some(map) = forwarded_metadata.as_object() {
                        let metadata_map = map
                            .iter()
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect::<HashMap<_, _>>();
                        tool_result = tool_result.with_metadata_map(metadata_map);
                    }
                    tool_result = tool_result
                        .with_metadata("skill_forwarded_tool_metadata", forwarded_metadata);
                }

                Ok(tool_result)
            }
            Err(error) => Err(ToolError::execution_failed(error)),
        }
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // Skills are read-only operations
        PermissionCheckResult::allow()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::{
        clear_session_hooks, get_session_hook_count, is_blocked, run_hooks_with_registry,
        FrontmatterHooks, HookEvent, HookInput, HookRegistry,
    };
    use crate::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
    use crate::session::{ItemRuntime, ItemRuntimePayload, ItemStatus};
    use crate::skills::new_shared_registry;
    use crate::skills::types::{
        SkillDefinition, SkillExecutionMode, SkillSource, WorkflowDefinition, WorkflowStep,
    };
    use crate::tools::base::Tool as NativeTool;
    use crate::tools::error::ToolError;
    use crate::tools::ToolResult as NativeToolResult;
    use chrono::Utc;
    use rmcp::model::{CallToolRequestParam, Tool as McpTool};
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    fn create_test_skill() -> SkillDefinition {
        SkillDefinition {
            skill_name: "test:example".to_string(),
            display_name: "Example Skill".to_string(),
            description: "A test skill".to_string(),
            has_user_specified_description: true,
            markdown_content: "# Example\n\nDo something.".to_string(),
            allowed_tools: None,
            argument_hint: Some("--flag".to_string()),
            when_to_use: Some("When testing".to_string()),
            version: Some("1.0.0".to_string()),
            model: Some("claude-3-opus".to_string()),
            disable_model_invocation: false,
            user_invocable: true,
            source: SkillSource::User,
            base_dir: PathBuf::from("/test"),
            file_path: PathBuf::from("/test/SKILL.md"),
            supporting_files: vec![],
            execution_mode: SkillExecutionMode::default(),
            provider: None,
            workflow: None,
            hooks: None,
        }
    }

    fn create_workflow_skill() -> SkillDefinition {
        SkillDefinition {
            execution_mode: SkillExecutionMode::Workflow,
            workflow: Some(WorkflowDefinition::new(vec![
                WorkflowStep::new("step1", "步骤一", "处理 ${user_input}", "result1"),
                WorkflowStep::new("step2", "步骤二", "继续 ${result1}", "result2")
                    .with_dependency("step1"),
            ])),
            ..create_test_skill()
        }
    }

    fn create_agent_skill() -> SkillDefinition {
        SkillDefinition {
            execution_mode: SkillExecutionMode::Agent,
            ..create_test_skill()
        }
    }

    fn create_tool_capable_prompt_skill() -> SkillDefinition {
        SkillDefinition {
            allowed_tools: Some(vec!["Read".to_string()]),
            ..create_test_skill()
        }
    }

    #[derive(Default)]
    struct MockProvider {
        name: String,
        model: String,
        calls: Mutex<Vec<String>>,
        tool_names: Mutex<Vec<Vec<String>>>,
    }

    impl MockProvider {
        fn new(name: &str, model: &str) -> Self {
            Self {
                name: name.to_string(),
                model: model.to_string(),
                calls: Mutex::new(Vec::new()),
                tool_names: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl Provider for MockProvider {
        fn metadata() -> ProviderMetadata
        where
            Self: Sized,
        {
            ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            &self.name
        }

        async fn complete_with_model(
            &self,
            model_config: &ModelConfig,
            system: &str,
            messages: &[Message],
            tools: &[McpTool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            let user_message = messages
                .first()
                .map(Message::as_concat_text)
                .unwrap_or_default();
            self.calls.lock().expect("calls lock").push(format!(
                "{}|{}|{}",
                model_config.model_name, system, user_message
            ));
            self.tool_names.lock().expect("tool_names lock").push(
                tools
                    .iter()
                    .map(|tool| tool.name.to_string())
                    .collect::<Vec<_>>(),
            );
            Ok((
                Message::assistant()
                    .with_text(format!("[{}] {}", model_config.model_name, user_message)),
                ProviderUsage::new(model_config.model_name.clone(), Usage::default()),
            ))
        }

        fn get_model_config(&self) -> ModelConfig {
            ModelConfig::new(&self.model).expect("model config")
        }
    }

    struct ToolCallingProvider {
        name: String,
        model: String,
        requested_tool: String,
        call_count: AtomicUsize,
        tool_names: Mutex<Vec<Vec<String>>>,
    }

    impl ToolCallingProvider {
        fn new(name: &str, model: &str, requested_tool: &str) -> Self {
            Self {
                name: name.to_string(),
                model: model.to_string(),
                requested_tool: requested_tool.to_string(),
                call_count: AtomicUsize::new(0),
                tool_names: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl Provider for ToolCallingProvider {
        fn metadata() -> ProviderMetadata
        where
            Self: Sized,
        {
            ProviderMetadata::empty()
        }

        fn get_name(&self) -> &str {
            &self.name
        }

        async fn complete_with_model(
            &self,
            model_config: &ModelConfig,
            _system: &str,
            _messages: &[Message],
            tools: &[McpTool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            self.tool_names.lock().expect("tool_names lock").push(
                tools
                    .iter()
                    .map(|tool| tool.name.to_string())
                    .collect::<Vec<_>>(),
            );

            let call_index = self.call_count.fetch_add(1, Ordering::SeqCst);
            if call_index == 0 {
                if tools.iter().any(|tool| tool.name == self.requested_tool) {
                    let arguments = serde_json::json!({
                        "prompt": "生成一张测试图片"
                    })
                    .as_object()
                    .cloned()
                    .expect("tool arguments");

                    return Ok((
                        Message::assistant().with_tool_request(
                            "tool-call-1",
                            Ok(CallToolRequestParam {
                                name: self.requested_tool.clone().into(),
                                arguments: Some(arguments),
                            }),
                        ),
                        ProviderUsage::new(model_config.model_name.clone(), Usage::default()),
                    ));
                }

                return Ok((
                    Message::assistant().with_text("missing requested tool"),
                    ProviderUsage::new(model_config.model_name.clone(), Usage::default()),
                ));
            }

            Ok((
                Message::assistant().with_text("skill finished"),
                ProviderUsage::new(model_config.model_name.clone(), Usage::default()),
            ))
        }

        fn get_model_config(&self) -> ModelConfig {
            ModelConfig::new(&self.model).expect("model config")
        }
    }

    struct DynamicForwardedTool;

    #[async_trait]
    impl NativeTool for DynamicForwardedTool {
        fn name(&self) -> &str {
            "dynamic_forwarded_tool"
        }

        fn description(&self) -> &str {
            "test forwarded tool"
        }

        fn input_schema(&self) -> serde_json::Value {
            json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" }
                },
                "required": ["prompt"],
                "additionalProperties": false
            })
        }

        async fn execute(
            &self,
            _params: serde_json::Value,
            _context: &ToolContext,
        ) -> Result<NativeToolResult, ToolError> {
            Ok(NativeToolResult::success("forwarded")
                .with_metadata("task_id", json!("task-forwarded-1"))
                .with_metadata("task_type", json!("image_generate"))
                .with_metadata("status", json!("queued")))
        }
    }

    fn build_tool_context(provider: Arc<dyn Provider>) -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("skill-session")
            .with_provider(provider)
    }

    fn build_context_without_provider() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
    }

    #[test]
    fn test_skill_tool_new() {
        let tool = SkillTool::new();
        assert_eq!(tool.name(), "Skill");
    }

    #[test]
    fn test_skill_tool_input_schema() {
        let tool = SkillTool::new();
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["skill"].is_object());
        assert!(schema["properties"]["args"].is_object());
        assert_eq!(schema["required"], serde_json::json!(["skill"]));
    }

    #[test]
    fn test_generate_description() {
        let tool = SkillTool::new();
        let desc = tool.generate_description();

        assert!(desc.contains("skills_instructions"));
        assert!(desc.contains("available_skills"));
    }

    #[tokio::test]
    async fn test_skill_tool_check_permissions() {
        let tool = SkillTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"skill": "test"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_skill_tool_execute_not_found() {
        let tool = SkillTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"skill": "nonexistent-skill-xyz"});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_skill_tool_execute_missing_param() {
        let tool = SkillTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_skill_tool_executes_prompt_skill_with_provider() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(create_test_skill());
        }
        let tool = SkillTool::with_registry(registry);
        let provider: Arc<dyn Provider> = Arc::new(MockProvider::new("openai", "gpt-4o"));

        let result = tool
            .execute(
                serde_json::json!({
                    "skill": "test:example",
                    "args": "整理需求"
                }),
                &build_tool_context(provider),
            )
            .await
            .expect("skill result");

        assert!(result.success);
        assert!(result.content().contains("整理需求"));
        assert_eq!(result.metadata["command_name"], json!("test:example"));
    }

    #[tokio::test]
    async fn test_skill_tool_executes_workflow_skill_with_provider() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(create_workflow_skill());
        }
        let tool = SkillTool::with_registry(registry);
        let provider: Arc<dyn Provider> = Arc::new(MockProvider::new("openai", "gpt-4o"));

        let result = tool
            .execute(
                serde_json::json!({
                    "skill": "test:example",
                    "args": "继续执行"
                }),
                &build_tool_context(provider),
            )
            .await
            .expect("workflow result");

        assert!(result.success);
        assert_eq!(result.metadata["skill"]["success"], json!(true));
        assert_eq!(
            result.metadata["skill"]["stepsCompleted"]
                .as_array()
                .map(Vec::len),
            Some(2)
        );
    }

    #[tokio::test]
    async fn test_skill_tool_executes_agent_skill_with_upstream_style_prompt_injection() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            let mut skill = create_agent_skill();
            skill.model = Some("gpt-4o-mini".to_string());
            skill.markdown_content =
                "Inspect ${CLAUDE_SKILL_DIR} for session ${CLAUDE_SESSION_ID}.".to_string();
            guard.register(skill);
        }
        let tool = SkillTool::with_registry(registry);
        let provider = Arc::new(MockProvider::new("openai", "gpt-4o"));
        let provider_dyn: Arc<dyn Provider> = provider.clone();

        let result = tool
            .execute(
                serde_json::json!({
                    "skill": "test:example",
                    "args": "整理需求"
                }),
                &build_tool_context(provider_dyn),
            )
            .await
            .expect("agent skill result");

        assert!(result.success);
        assert!(result.content().contains("/test"));
        assert!(result.content().contains("skill-session"));
        assert!(result.content().contains("**ARGUMENTS:** 整理需求"));
        assert_eq!(result.metadata["model"], json!("gpt-4o-mini"));

        let calls = provider.calls.lock().expect("calls lock");
        assert!(
            calls.iter().any(|call| call.starts_with("gpt-4o-mini|")),
            "agent mode 应命中 skill model override"
        );
        assert!(
            calls
                .iter()
                .any(|call| call.contains("Base directory for this skill: /test")),
            "agent mode 应注入 skill base directory header"
        );
    }

    #[tokio::test]
    async fn test_skill_tool_executes_prompt_skill_with_allowed_tools_via_agent_runtime() {
        let tool = SkillTool::new();
        let provider = Arc::new(MockProvider::new("openai", "gpt-4o"));
        let provider_dyn: Arc<dyn Provider> = provider.clone();
        let mut skill = create_tool_capable_prompt_skill();
        skill.model = Some("gpt-4o-mini".to_string());
        skill.markdown_content =
            "Inspect ${CLAUDE_SKILL_DIR} for session ${CLAUDE_SESSION_ID}.".to_string();
        let context = build_tool_context(provider_dyn);
        let skill_content = build_skill_content(&skill, Some("整理需求"), &context.session_id);

        let result = tool
            .execute_agent_skill(&skill, &skill_content, &context)
            .await;

        assert!(result.success);
        assert_eq!(result.allowed_tools, Some(vec!["Read".to_string()]));
        assert_eq!(result.model, Some("gpt-4o-mini".to_string()));
        assert!(result
            .output
            .as_deref()
            .unwrap_or_default()
            .contains("**ARGUMENTS:** 整理需求"));

        let calls = provider.calls.lock().expect("calls lock");
        assert!(
            calls.iter().any(|call| call.starts_with("gpt-4o-mini|")),
            "tool-capable prompt skill 应命中 agent runtime model override"
        );
        drop(calls);

        let tool_names = provider.tool_names.lock().expect("tool_names lock");
        assert!(
            tool_names
                .iter()
                .any(|names| names == &vec!["Read".to_string()]),
            "tool-capable prompt skill 应把 provider 可见工具面收窄到 allowed-tools，实际为 {:?}",
            *tool_names
        );
    }

    #[tokio::test]
    async fn test_skill_tool_inherits_current_session_dynamic_native_tool_surface() {
        let tool = SkillTool::new();
        let provider = Arc::new(ToolCallingProvider::new(
            "openai",
            "gpt-4o",
            "dynamic_forwarded_tool",
        ));
        let provider_dyn: Arc<dyn Provider> = provider.clone();
        let mut skill = create_tool_capable_prompt_skill();
        skill.allowed_tools = Some(vec!["dynamic_forwarded_tool".to_string()]);
        skill.markdown_content = "Call the forwarded tool immediately.".to_string();

        let source_session =
            build_skill_agent_session(PathBuf::from("/tmp"), &skill, Some("skill-session"));
        let source_store: Arc<dyn SessionStore> =
            Arc::new(SkillAgentSessionStore::new(source_session));
        let source_agent = Arc::new(Agent::new().with_session_store(source_store));
        {
            let mut registry = source_agent.tool_registry().write().await;
            registry.register(Box::new(DynamicForwardedTool));
        }

        let context = build_tool_context(provider_dyn);
        let skill_content = build_skill_content(&skill, None, &context.session_id);
        let result = tool
            .execute_agent_skill_with_source_agent(
                &skill,
                &skill_content,
                &context,
                Some(source_agent),
            )
            .await;

        assert!(result.success);
        assert_eq!(
            result.forwarded_tool_name.as_deref(),
            Some("dynamic_forwarded_tool")
        );
        let metadata = result
            .forwarded_tool_metadata
            .as_ref()
            .expect("forwarded metadata");
        assert_eq!(metadata["task_id"], json!("task-forwarded-1"));
        assert_eq!(metadata["task_type"], json!("image_generate"));

        let tool_names = provider.tool_names.lock().expect("tool_names lock");
        assert!(
            tool_names
                .first()
                .is_some_and(|names| names == &vec!["dynamic_forwarded_tool".to_string()]),
            "skill 子 agent 应继承当前 session 的动态 native tool，实际为 {:?}",
            *tool_names
        );
    }

    #[tokio::test]
    async fn test_skill_tool_prefers_registered_session_source_agent() {
        let tool = SkillTool::new();
        let provider = Arc::new(ToolCallingProvider::new(
            "openai",
            "gpt-4o",
            "dynamic_forwarded_tool",
        ));
        let provider_dyn: Arc<dyn Provider> = provider.clone();
        let mut skill = create_tool_capable_prompt_skill();
        skill.allowed_tools = Some(vec!["dynamic_forwarded_tool".to_string()]);
        skill.markdown_content = "Call the forwarded tool immediately.".to_string();

        let source_session = build_skill_agent_session(
            PathBuf::from("/tmp"),
            &skill,
            Some("skill-source-cache-session"),
        );
        let source_store: Arc<dyn SessionStore> =
            Arc::new(SkillAgentSessionStore::new(source_session));
        let source_agent = Arc::new(Agent::new().with_session_store(source_store));
        {
            let mut registry = source_agent.tool_registry().write().await;
            registry.register(Box::new(DynamicForwardedTool));
        }

        SkillTool::register_source_agent_for_session(
            "skill-source-cache-session".to_string(),
            Arc::clone(&source_agent),
        )
        .await;

        let context = ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("skill-source-cache-session")
            .with_provider(provider_dyn);
        let skill_content = build_skill_content(&skill, None, &context.session_id);
        let result = tool
            .execute_agent_skill(&skill, &skill_content, &context)
            .await;

        assert!(result.success);
        assert_eq!(
            result.forwarded_tool_name.as_deref(),
            Some("dynamic_forwarded_tool")
        );

        let tool_names = provider.tool_names.lock().expect("tool_names lock");
        assert!(
            tool_names
                .first()
                .is_some_and(|names| names == &vec!["dynamic_forwarded_tool".to_string()]),
            "skill 子 agent 应优先命中已注册的 session source agent，实际为 {:?}",
            *tool_names
        );
    }

    #[test]
    fn test_extract_forwarded_skill_tool_call_prefers_allowed_tool_metadata() {
        let item = ItemRuntime {
            id: "tool-call-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 1,
            status: ItemStatus::Completed,
            started_at: Utc::now(),
            completed_at: Some(Utc::now()),
            updated_at: Utc::now(),
            payload: ItemRuntimePayload::ToolCall {
                tool_name: "lime_create_image_generation_task".to_string(),
                arguments: None,
                output: Some(json!({
                    "content": [{ "text": "图片任务已提交", "type": "text" }],
                    "structured_content": {
                        "task_id": "task-image-1",
                        "task_type": "image_generate",
                        "status": "queued"
                    },
                    "is_error": false,
                    "meta": null
                })),
                success: Some(true),
                error: None,
                metadata: None,
            },
        };

        let forwarded = extract_forwarded_skill_tool_call(
            &item,
            Some(&["lime_create_image_generation_task".to_string()]),
        )
        .expect("should capture forwarded tool metadata");

        assert_eq!(forwarded.tool_name, "lime_create_image_generation_task");
        assert_eq!(forwarded.metadata["task_id"], json!("task-image-1"));
        assert_eq!(forwarded.metadata["task_type"], json!("image_generate"));
    }

    #[tokio::test]
    async fn test_skill_tool_returns_failed_result_when_agent_skill_has_no_provider() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(create_agent_skill());
        }
        let tool = SkillTool::with_registry(registry);

        let result = tool
            .execute(
                serde_json::json!({
                    "skill": "test:example"
                }),
                &build_context_without_provider(),
            )
            .await
            .expect("agent mode should return failed tool result");

        assert!(result.is_error());
        assert_eq!(result.metadata["skill"]["success"], json!(false));
        assert!(
            result
                .content()
                .contains("当前 session 没有关联可用 provider"),
            "应返回 provider 缺失错误"
        );
    }

    #[tokio::test]
    async fn test_skill_tool_registers_session_frontmatter_hooks_for_current_session() {
        clear_session_hooks("skill-session");

        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            let mut skill = create_test_skill();
            skill.hooks = Some(
                serde_yaml::from_str::<FrontmatterHooks>(
                    r#"
PreToolUse:
  - matcher: Bash
    hooks:
      - type: command
        command: "printf '%s' '{\"blocked\":true,\"message\":\"skill hook blocked\"}'; exit 2"
"#,
                )
                .expect("frontmatter hooks should parse"),
            );
            guard.register(skill);
        }
        let tool = SkillTool::with_registry(registry);
        let provider: Arc<dyn Provider> = Arc::new(MockProvider::new("openai", "gpt-4o"));

        let result = tool
            .execute(
                serde_json::json!({
                    "skill": "test:example",
                    "args": "注册 session hooks"
                }),
                &build_tool_context(provider),
            )
            .await
            .expect("skill result");

        assert!(result.success);
        assert_eq!(get_session_hook_count("skill-session"), 1);

        let empty_registry = Arc::new(HookRegistry::new());
        let hook_results = run_hooks_with_registry(
            HookInput {
                event: Some(HookEvent::PreToolUse),
                tool_name: Some("Bash".to_string()),
                session_id: Some("skill-session".to_string()),
                ..Default::default()
            },
            &empty_registry,
        )
        .await;

        let (blocked, message) = is_blocked(&hook_results);
        assert!(blocked);
        assert_eq!(message.as_deref(), Some("skill hook blocked"));

        clear_session_hooks("skill-session");
    }
}
