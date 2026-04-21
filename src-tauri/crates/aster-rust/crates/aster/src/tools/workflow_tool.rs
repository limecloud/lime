use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::conversation::message::Message;
use crate::execution::manager::AgentManager;
use crate::model::ModelConfig;
use crate::providers::base::Provider;
use crate::providers::errors::ProviderError;
use crate::providers::{create_with_default_model, create_with_named_model};
use crate::skills::{
    global_registry, refresh_shared_registry_if_needed, LlmProvider, SharedSkillRegistry,
    SkillDefinition, SkillError, SkillExecutionMode, SkillExecutionResult, SkillExecutor,
};
use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;

const WORKFLOW_TOOL_NAME: &str = "Workflow";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WorkflowInput {
    workflow: String,
    #[serde(default)]
    input: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowToolOutput {
    workflow: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    steps_completed: Vec<crate::skills::StepResult>,
}

pub struct WorkflowTool {
    registry: SharedSkillRegistry,
}

impl WorkflowTool {
    pub fn new() -> Self {
        Self::with_registry(global_registry().clone())
    }

    pub fn with_registry(registry: SharedSkillRegistry) -> Self {
        Self { registry }
    }

    fn list_workflow_skills(&self) -> Result<Vec<SkillDefinition>, ToolError> {
        refresh_shared_registry_if_needed(&self.registry).map_err(|error| {
            ToolError::execution_failed(format!("刷新 workflow 注册表失败: {error}"))
        })?;

        let registry = self.registry.read().map_err(|error| {
            ToolError::execution_failed(format!("读取 workflow 注册表失败: {error}"))
        })?;

        let mut workflows = registry
            .get_all()
            .into_iter()
            .filter(|skill| {
                skill.execution_mode == SkillExecutionMode::Workflow
                    && !skill.disable_model_invocation
            })
            .cloned()
            .collect::<Vec<_>>();
        workflows.sort_by(|left, right| left.skill_name.cmp(&right.skill_name));
        Ok(workflows)
    }

    fn find_workflow_skill(&self, workflow_name: &str) -> Result<SkillDefinition, ToolError> {
        refresh_shared_registry_if_needed(&self.registry).map_err(|error| {
            ToolError::execution_failed(format!("刷新 workflow 注册表失败: {error}"))
        })?;

        let registry = self.registry.read().map_err(|error| {
            ToolError::execution_failed(format!("读取 workflow 注册表失败: {error}"))
        })?;

        let skill = registry.find(workflow_name).ok_or_else(|| {
            let available = registry
                .get_all()
                .into_iter()
                .filter(|candidate| {
                    candidate.execution_mode == SkillExecutionMode::Workflow
                        && !candidate.disable_model_invocation
                })
                .map(|candidate| candidate.skill_name.as_str())
                .collect::<Vec<_>>();

            ToolError::execution_failed(format!(
                "未找到 workflow '{workflow_name}'。可用 workflows: {}",
                if available.is_empty() {
                    "none".to_string()
                } else {
                    available.join(", ")
                }
            ))
        })?;

        if skill.execution_mode != SkillExecutionMode::Workflow {
            return Err(ToolError::execution_failed(format!(
                "'{}' 不是 workflow skill，请改用 Skill 工具执行该 skill",
                skill.skill_name
            )));
        }

        if skill.disable_model_invocation {
            return Err(ToolError::execution_failed(format!(
                "workflow '{}' 已禁用模型调用，无法执行",
                skill.skill_name
            )));
        }

        Ok(skill.clone())
    }

    fn record_invocation(&self, skill: &SkillDefinition, input: &str) {
        if let Ok(mut registry) = self.registry.write() {
            registry.record_invoked(
                &skill.skill_name,
                &skill.file_path,
                &format!("WORKFLOW INPUT:\n{input}"),
            );
        }
    }

    fn build_description(&self) -> String {
        let workflows = self.list_workflow_skills().unwrap_or_default();
        let workflows_xml = workflows
            .iter()
            .map(|workflow| {
                format!(
                    r#"<workflow>
<name>{}</name>
<description>{}</description>
<source>{}</source>
<model>{}</model>
</workflow>"#,
                    workflow.skill_name,
                    workflow.description,
                    workflow.source,
                    workflow
                        .model
                        .as_deref()
                        .unwrap_or("current-session-provider"),
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            r#"Execute a registered workflow inside the current session.

<workflow_instructions>
- Use this tool only for workflows whose execution_mode is `workflow`
- Prefer the exact workflow name shown below
- The workflow runs on the current session provider unless the workflow binds a provider explicitly
- Workflow steps may call the model multiple times; individual tool permissions still apply inside those steps
</workflow_instructions>

<available_workflows>
{}
</available_workflows>
"#,
            if workflows_xml.is_empty() {
                "<none />".to_string()
            } else {
                workflows_xml
            }
        )
    }

    async fn resolve_current_provider(
        context: &ToolContext,
    ) -> Result<Option<Arc<dyn Provider>>, ToolError> {
        if let Some(provider) = context.provider.as_ref() {
            return Ok(Some(provider.clone()));
        }

        if context.session_id.is_empty() {
            return Ok(None);
        }

        let manager = match AgentManager::instance().await {
            Ok(manager) => manager,
            Err(_) => return Ok(None),
        };

        let agent = match manager
            .get_or_create_agent(context.session_id.clone())
            .await
        {
            Ok(agent) => agent,
            Err(_) => return Ok(None),
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
    ) -> Result<SessionLlmProvider, ToolError> {
        let current_provider = Self::resolve_current_provider(context).await?;

        if let Some(requested_provider) = skill.provider.as_deref() {
            if let Some(provider) = current_provider.as_ref() {
                if provider.get_name().eq_ignore_ascii_case(requested_provider) {
                    return Ok(SessionLlmProvider::new(provider.clone())
                        .with_default_model(skill.model.clone()));
                }
            }

            let provider = if let Some(model_name) = skill.model.as_deref() {
                create_with_named_model(requested_provider, model_name)
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!(
                            "创建 workflow provider '{}' 失败: {error}",
                            requested_provider
                        ))
                    })?
            } else {
                create_with_default_model(requested_provider)
                    .await
                    .map_err(|error| {
                        ToolError::execution_failed(format!(
                            "创建 workflow provider '{}' 失败: {error}",
                            requested_provider
                        ))
                    })?
            };

            return Ok(SessionLlmProvider::new(provider));
        }

        let provider = current_provider.ok_or_else(|| {
            ToolError::execution_failed(
                "当前 session 没有关联可用 provider，无法执行 Workflow；请在带 provider 的会话中重试",
            )
        })?;

        Ok(SessionLlmProvider::new(provider).with_default_model(skill.model.clone()))
    }

    async fn execute_workflow(
        &self,
        skill: &SkillDefinition,
        input: &str,
        context: &ToolContext,
    ) -> Result<SkillExecutionResult, ToolError> {
        let provider = self.resolve_llm_provider(skill, context).await?;
        let executor = SkillExecutor::new(provider);
        executor.execute(skill, input, None).await.map_err(|error| {
            ToolError::execution_failed(format!(
                "执行 workflow '{}' 失败: {}",
                skill.skill_name, error
            ))
        })
    }
}

impl Default for WorkflowTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for WorkflowTool {
    fn name(&self) -> &str {
        WORKFLOW_TOOL_NAME
    }

    fn description(&self) -> &str {
        "执行一个已注册的 workflow skill，并把它收敛到当前会话与当前工具面。只暴露 current workflow surface，不再走旧示例壳。"
    }

    fn dynamic_description(&self) -> Option<String> {
        Some(self.build_description())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "workflow": {
                    "type": "string",
                    "description": "要执行的 workflow 名称，例如 'spec' 或 'user:spec'"
                },
                "input": {
                    "type": "string",
                    "description": "传给 workflow 的可选输入文本"
                }
            },
            "required": ["workflow"],
            "additionalProperties": false
        })
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: WorkflowInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("Workflow 参数无效: {error}")))?;
        let workflow_name = input.workflow.trim();
        if workflow_name.is_empty() {
            return Err(ToolError::invalid_params("workflow 不能为空"));
        }

        let skill = self.find_workflow_skill(workflow_name)?;
        let workflow_input = input.input.unwrap_or_default();
        self.record_invocation(&skill, &workflow_input);

        let execution = self
            .execute_workflow(&skill, &workflow_input, context)
            .await?;
        let output = WorkflowToolOutput {
            workflow: skill.skill_name.clone(),
            display_name: Some(skill.display_name.clone()),
            success: execution.success,
            output: execution.output.clone(),
            error: execution.error.clone(),
            steps_completed: execution.steps_completed.clone(),
        };
        let pretty_output = serde_json::to_string_pretty(&output).map_err(|error| {
            ToolError::execution_failed(format!("序列化 Workflow 输出失败: {error}"))
        })?;

        let metadata = json!({
            "workflow": output.workflow,
            "displayName": output.display_name,
            "success": output.success,
            "stepsCompleted": output.steps_completed,
            "output": output.output,
            "error": output.error,
            "allowedTools": execution.allowed_tools,
            "model": execution.model,
        });

        if execution.success {
            let content = execution
                .output
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(pretty_output);
            Ok(ToolResult::success(content).with_metadata("workflow", metadata))
        } else {
            let content = match (execution.output.as_deref(), execution.error.as_deref()) {
                (Some(output), Some(error)) if !output.trim().is_empty() => {
                    format!("Workflow 执行未完全成功。\n\n最终输出:\n{output}\n\n错误:\n{error}")
                }
                (_, Some(error)) => error.to_string(),
                (Some(output), None) => output.to_string(),
                (None, None) => pretty_output,
            };

            Ok(ToolResult::error(content).with_metadata("workflow", metadata))
        }
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
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
            SkillError::invalid_config(format!(
                "无效 workflow model '{}': {error}",
                requested_model
            ))
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
    ) -> Result<String, crate::skills::SkillError> {
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

fn provider_error_to_skill_error(error: ProviderError) -> crate::skills::SkillError {
    crate::skills::SkillError::provider_error(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::PathBuf;
    use std::sync::Mutex;

    use crate::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
    use crate::skills::{new_shared_registry, SkillSource, WorkflowDefinition, WorkflowStep};
    use rmcp::model::Tool as McpTool;

    #[derive(Default)]
    struct MockProvider {
        name: String,
        model: String,
        calls: Mutex<Vec<String>>,
    }

    impl MockProvider {
        fn new(name: &str, model: &str) -> Self {
            Self {
                name: name.to_string(),
                model: model.to_string(),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("calls lock").clone()
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
            _tools: &[McpTool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            let user_message = messages
                .first()
                .map(Message::as_concat_text)
                .unwrap_or_default();
            self.calls.lock().expect("calls lock").push(format!(
                "{}|{}|{}",
                model_config.model_name, system, user_message
            ));
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

    fn build_workflow_skill(name: &str) -> SkillDefinition {
        SkillDefinition {
            skill_name: format!("user:{name}"),
            display_name: name.to_string(),
            description: format!("workflow {name}"),
            has_user_specified_description: true,
            markdown_content: format!("# {name}"),
            allowed_tools: Some(vec!["Read".to_string(), "Edit".to_string()]),
            argument_hint: None,
            when_to_use: None,
            version: Some("1.0.0".to_string()),
            model: None,
            disable_model_invocation: false,
            user_invocable: true,
            source: SkillSource::User,
            base_dir: PathBuf::from("/tmp/workflow"),
            file_path: PathBuf::from("/tmp/workflow/SKILL.md"),
            supporting_files: vec![],
            execution_mode: SkillExecutionMode::Workflow,
            provider: None,
            workflow: Some(WorkflowDefinition::new(vec![
                WorkflowStep::new("step1", "步骤一", "处理 ${user_input}", "result1"),
                WorkflowStep::new("step2", "步骤二", "继续 ${result1}", "result2")
                    .with_dependency("step1"),
            ])),
            hooks: None,
        }
    }

    fn build_prompt_skill(name: &str) -> SkillDefinition {
        SkillDefinition {
            execution_mode: SkillExecutionMode::Prompt,
            workflow: None,
            ..build_workflow_skill(name)
        }
    }

    fn build_tool_context(provider: Arc<dyn Provider>) -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("workflow-session")
            .with_provider(provider)
    }

    #[tokio::test]
    async fn test_workflow_tool_executes_workflow_skill() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(build_workflow_skill("spec"));
        }
        let tool = WorkflowTool::with_registry(registry);
        let provider: Arc<dyn Provider> = Arc::new(MockProvider::new("openai", "gpt-4o"));

        let result = tool
            .execute(
                json!({
                    "workflow": "spec",
                    "input": "整理需求"
                }),
                &build_tool_context(provider),
            )
            .await
            .expect("workflow result");

        assert!(result.success);
        assert!(result.content().contains("整理需求"));
        let workflow_meta = result
            .metadata
            .get("workflow")
            .and_then(|value| value.as_object())
            .expect("workflow metadata");
        assert_eq!(workflow_meta.get("success"), Some(&json!(true)));
        assert_eq!(
            workflow_meta
                .get("stepsCompleted")
                .and_then(|value| value.as_array())
                .map(Vec::len),
            Some(2)
        );
    }

    #[tokio::test]
    async fn test_workflow_tool_rejects_non_workflow_skill() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(build_prompt_skill("plain-skill"));
        }
        let tool = WorkflowTool::with_registry(registry);
        let provider: Arc<dyn Provider> = Arc::new(MockProvider::new("openai", "gpt-4o"));

        let error = tool
            .execute(
                json!({
                    "workflow": "plain-skill"
                }),
                &build_tool_context(provider),
            )
            .await
            .expect_err("should reject prompt skill");

        assert!(error.to_string().contains("不是 workflow skill"));
    }

    #[tokio::test]
    async fn test_workflow_tool_errors_when_workflow_missing() {
        let tool = WorkflowTool::with_registry(new_shared_registry());
        let provider: Arc<dyn Provider> = Arc::new(MockProvider::new("openai", "gpt-4o"));

        let error = tool
            .execute(
                json!({
                    "workflow": "missing-workflow"
                }),
                &build_tool_context(provider),
            )
            .await
            .expect_err("missing workflow should fail");

        assert!(error.to_string().contains("未找到 workflow"));
    }

    #[tokio::test]
    async fn test_workflow_tool_uses_skill_model_for_workflow_steps() {
        let registry = new_shared_registry();
        let mut workflow = build_workflow_skill("model-bound");
        workflow.model = Some("gpt-5.2".to_string());
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(workflow);
        }
        let tool = WorkflowTool::with_registry(registry);
        let provider = Arc::new(MockProvider::new("openai", "gpt-4o"));
        let provider_for_context: Arc<dyn Provider> = provider.clone();

        let result = tool
            .execute(
                json!({
                    "workflow": "model-bound",
                    "input": "测试模型"
                }),
                &build_tool_context(provider_for_context),
            )
            .await
            .expect("workflow result");

        assert!(result.success);
        let calls = provider.calls();
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().all(|call| call.starts_with("gpt-5.2|")));
    }

    #[test]
    fn test_workflow_tool_description_only_lists_workflows() {
        let registry = new_shared_registry();
        {
            let mut guard = registry.write().expect("registry write");
            guard.register(build_workflow_skill("wf-one"));
            guard.register(build_prompt_skill("prompt-one"));
        }
        let tool = WorkflowTool::with_registry(registry);
        let description = tool.build_description();

        assert!(description.contains("user:wf-one"));
        assert!(!description.contains("user:prompt-one"));
    }
}
