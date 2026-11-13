//! Agent-free Skill 执行器。
//!
//! 该模块只处理 prompt / workflow 两类 Skill 执行语义；需要子 Agent 或工具转发的
//! Skill 必须交给 Turn runtime owner，而不是回落到 Agent SkillTool。

use crate::{ExecutionCallback, LlmProvider, LoadedSkillDefinition, SkillError};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillStepResult {
    pub step_id: String,
    pub step_name: String,
    pub output: String,
    pub success: bool,
    pub error: Option<String>,
}

impl SkillStepResult {
    fn success(step_id: impl Into<String>, step_name: impl Into<String>, output: String) -> Self {
        Self {
            step_id: step_id.into(),
            step_name: step_name.into(),
            output,
            success: true,
            error: None,
        }
    }

    fn failure(step_id: impl Into<String>, step_name: impl Into<String>, error: String) -> Self {
        Self {
            step_id: step_id.into(),
            step_name: step_name.into(),
            output: String::new(),
            success: false,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillRunResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub steps_completed: Vec<SkillStepResult>,
    pub command_name: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub model: Option<String>,
}

pub struct SkillRunner<'a, P>
where
    P: LlmProvider + ?Sized,
{
    provider: &'a P,
}

impl<'a, P> SkillRunner<'a, P>
where
    P: LlmProvider + ?Sized,
{
    pub fn new(provider: &'a P) -> Self {
        Self { provider }
    }

    pub async fn run(
        &self,
        skill: &LoadedSkillDefinition,
        input: &str,
        callback: Option<&dyn ExecutionCallback>,
    ) -> Result<SkillRunResult, SkillError> {
        if skill.disable_model_invocation {
            return Err(SkillError::ConfigError(format!(
                "Skill '{}' has model invocation disabled",
                skill.skill_name
            )));
        }
        if requires_turn_runtime(skill) {
            return Err(SkillError::ConfigError(format!(
                "Skill '{}' requires Turn runtime tool forwarding and cannot run in the prompt executor",
                skill.skill_name
            )));
        }

        match skill.execution_mode.trim().to_ascii_lowercase().as_str() {
            "workflow" => self.run_workflow(skill, input, callback).await,
            "prompt" | "" => self.run_prompt(skill, input, callback).await,
            other => Err(SkillError::ConfigError(format!(
                "Skill '{}' uses unsupported execution_mode '{}'",
                skill.skill_name, other
            ))),
        }
    }

    async fn run_prompt(
        &self,
        skill: &LoadedSkillDefinition,
        input: &str,
        callback: Option<&dyn ExecutionCallback>,
    ) -> Result<SkillRunResult, SkillError> {
        if let Some(callback) = callback {
            callback.on_step_start("prompt", &skill.display_name, 1, 1);
        }
        let output = self
            .provider
            .chat(&skill.markdown_content, input, skill.model.as_deref())
            .await?;
        if let Some(callback) = callback {
            callback.on_step_complete("prompt", &output);
            callback.on_complete(true, Some(&output), None);
        }
        Ok(SkillRunResult {
            success: true,
            output: Some(output),
            error: None,
            steps_completed: Vec::new(),
            command_name: Some(skill.skill_name.clone()),
            allowed_tools: skill.allowed_tools.clone(),
            model: skill.model.clone(),
        })
    }

    async fn run_workflow(
        &self,
        skill: &LoadedSkillDefinition,
        input: &str,
        callback: Option<&dyn ExecutionCallback>,
    ) -> Result<SkillRunResult, SkillError> {
        if skill.workflow_steps.is_empty() {
            return Err(SkillError::ConfigError(format!(
                "Skill '{}' uses workflow mode but has no workflow steps",
                skill.skill_name
            )));
        }

        let mut context = HashMap::from([("user_input".to_string(), input.to_string())]);
        let mut steps_completed = Vec::with_capacity(skill.workflow_steps.len());
        let total_steps = skill.workflow_steps.len();
        let mut final_output = None;

        for (index, step) in skill.workflow_steps.iter().enumerate() {
            if !step.execution_mode.eq_ignore_ascii_case("prompt") {
                let error = format!(
                    "workflow step '{}' uses unsupported execution_mode '{}'",
                    step.id, step.execution_mode
                );
                if let Some(callback) = callback {
                    callback.on_step_error(&step.id, &error, false);
                    callback.on_complete(false, None, Some(&error));
                }
                steps_completed.push(SkillStepResult::failure(
                    step.id.clone(),
                    step.name.clone(),
                    error.clone(),
                ));
                return Ok(failed_result(skill, steps_completed, error));
            }

            if let Some(callback) = callback {
                callback.on_step_start(&step.id, &step.name, index + 1, total_steps);
            }
            let prompt = interpolate_variables(&step.prompt, &context);
            match self
                .provider
                .chat(
                    "",
                    &prompt,
                    step.model.as_deref().or(skill.model.as_deref()),
                )
                .await
            {
                Ok(output) => {
                    if let Some(callback) = callback {
                        callback.on_step_complete(&step.id, &output);
                    }
                    context.insert(step.id.clone(), output.clone());
                    context.insert(format!("{}.output", step.id), output.clone());
                    steps_completed.push(SkillStepResult::success(
                        step.id.clone(),
                        step.name.clone(),
                        output.clone(),
                    ));
                    final_output = Some(output);
                }
                Err(error) => {
                    let message = error.to_string();
                    if let Some(callback) = callback {
                        callback.on_step_error(&step.id, &message, false);
                        callback.on_complete(false, None, Some(&message));
                    }
                    steps_completed.push(SkillStepResult::failure(
                        step.id.clone(),
                        step.name.clone(),
                        message.clone(),
                    ));
                    return Ok(failed_result(
                        skill,
                        steps_completed,
                        format!("步骤 '{}' 执行失败: {}", step.id, message),
                    ));
                }
            }
        }

        if let Some(callback) = callback {
            callback.on_complete(true, final_output.as_deref(), None);
        }
        Ok(SkillRunResult {
            success: true,
            output: final_output,
            error: None,
            steps_completed,
            command_name: Some(skill.skill_name.clone()),
            allowed_tools: skill.allowed_tools.clone(),
            model: skill.model.clone(),
        })
    }
}

pub fn requires_turn_runtime(skill: &LoadedSkillDefinition) -> bool {
    skill.execution_mode.eq_ignore_ascii_case("agent")
        || skill
            .allowed_tools
            .as_ref()
            .is_some_and(|tools| !tools.is_empty())
}

fn failed_result(
    skill: &LoadedSkillDefinition,
    steps_completed: Vec<SkillStepResult>,
    error: String,
) -> SkillRunResult {
    SkillRunResult {
        success: false,
        output: None,
        error: Some(error),
        steps_completed,
        command_name: Some(skill.skill_name.clone()),
        allowed_tools: skill.allowed_tools.clone(),
        model: skill.model.clone(),
    }
}

fn interpolation_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").unwrap())
}

pub fn interpolate_variables(prompt: &str, context: &HashMap<String, String>) -> String {
    interpolation_regex()
        .replace_all(prompt, |captures: &regex::Captures<'_>| {
            let key = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            context.get(key).cloned().unwrap_or_else(|| {
                captures
                    .get(0)
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_default()
            })
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SkillFrontmatter, WorkflowStep};
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct RecordingProvider {
        calls: Mutex<Vec<(String, String, Option<String>)>>,
    }

    impl RecordingProvider {
        fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<(String, String, Option<String>)> {
            self.calls
                .lock()
                .expect("calls lock should not be poisoned")
                .clone()
        }
    }

    #[async_trait]
    impl LlmProvider for RecordingProvider {
        async fn chat(
            &self,
            system_prompt: &str,
            user_message: &str,
            model: Option<&str>,
        ) -> Result<String, SkillError> {
            self.calls
                .lock()
                .expect("calls lock should not be poisoned")
                .push((
                    system_prompt.to_string(),
                    user_message.to_string(),
                    model.map(ToString::to_string),
                ));
            Ok(format!("reply: {user_message}"))
        }
    }

    fn skill() -> LoadedSkillDefinition {
        LoadedSkillDefinition {
            skill_name: "research".to_string(),
            display_name: "Research".to_string(),
            description: "Research skill".to_string(),
            local_directory_path: std::path::PathBuf::from("/tmp/research"),
            markdown_content: "Use careful research.".to_string(),
            license: None,
            compatibility: None,
            metadata: HashMap::new(),
            allowed_tools: None,
            argument_hint: None,
            when_to_use: None,
            when_to_use_config: None,
            model: Some("model-a".to_string()),
            provider: None,
            disable_model_invocation: false,
            execution_mode: "prompt".to_string(),
            workflow_ref: None,
            workflow_steps: Vec::new(),
            standard_compliance: Default::default(),
        }
    }

    #[tokio::test]
    async fn prompt_skill_uses_markdown_as_system_prompt() {
        let provider = RecordingProvider::new();
        let runner = SkillRunner::new(&provider);
        let result = runner
            .run(&skill(), "find lime", None)
            .await
            .expect("prompt skill should execute");

        assert!(result.success);
        assert_eq!(result.command_name.as_deref(), Some("research"));
        assert_eq!(
            provider.calls(),
            vec![(
                "Use careful research.".to_string(),
                "find lime".to_string(),
                Some("model-a".to_string())
            )]
        );
    }

    #[tokio::test]
    async fn workflow_skill_interpolates_previous_step_output() {
        let mut skill = skill();
        skill.execution_mode = "workflow".to_string();
        skill.workflow_steps = vec![
            WorkflowStep {
                id: "first".to_string(),
                name: "First".to_string(),
                prompt: "Find {{ user_input }}".to_string(),
                model: None,
                temperature: None,
                execution_mode: "prompt".to_string(),
            },
            WorkflowStep {
                id: "second".to_string(),
                name: "Second".to_string(),
                prompt: "Summarize {{first.output}}".to_string(),
                model: Some("model-b".to_string()),
                temperature: None,
                execution_mode: "prompt".to_string(),
            },
        ];
        let provider = RecordingProvider::new();
        let runner = SkillRunner::new(&provider);

        let result = runner
            .run(&skill, "lime skills", None)
            .await
            .expect("workflow skill should execute");

        assert!(result.success);
        assert_eq!(result.steps_completed.len(), 2);
        assert_eq!(
            provider.calls(),
            vec![
                (
                    String::new(),
                    "Find lime skills".to_string(),
                    Some("model-a".to_string())
                ),
                (
                    String::new(),
                    "Summarize reply: Find lime skills".to_string(),
                    Some("model-b".to_string())
                )
            ]
        );
    }

    #[tokio::test]
    async fn agent_mode_requires_turn_runtime() {
        let mut skill = skill();
        skill.execution_mode = "agent".to_string();
        let provider = RecordingProvider::new();
        let runner = SkillRunner::new(&provider);

        let error = runner
            .run(&skill, "input", None)
            .await
            .expect_err("agent mode should fail closed");

        assert!(error.to_string().contains("requires Turn runtime"));
    }

    #[test]
    fn interpolation_keeps_unknown_variables() {
        let context = HashMap::from([("known".to_string(), "value".to_string())]);
        assert_eq!(
            interpolate_variables("{{ known }} {{missing}}", &context),
            "value {{missing}}"
        );
    }

    #[test]
    fn skill_frontmatter_still_defaults_without_runner_side_effects() {
        let frontmatter = SkillFrontmatter::default();
        assert!(frontmatter.execution_mode.is_none());
    }
}
