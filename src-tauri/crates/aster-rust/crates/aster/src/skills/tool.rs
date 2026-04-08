//! Skill Tool
//!
//! Tool implementation for executing skills.

use super::registry::global_registry;
use super::types::SkillExecutionResult;
use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

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
pub struct SkillTool;

impl Default for SkillTool {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillTool {
    /// Create a new SkillTool
    pub fn new() -> Self {
        Self
    }

    /// Execute a skill by name
    pub fn execute_skill(
        &self,
        skill_name: &str,
        args: Option<&str>,
    ) -> Result<SkillExecutionResult, String> {
        let registry = global_registry();

        // First, get all the data we need from the skill
        let (skill_data, file_path) = {
            let registry_guard = registry.read().map_err(|e| e.to_string())?;

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

            // Clone the data we need
            let data = (
                skill.skill_name.clone(),
                skill.display_name.clone(),
                skill.markdown_content.clone(),
                skill.allowed_tools.clone(),
                skill.model.clone(),
            );
            let path = skill.file_path.clone();

            (data, path)
        };

        let (skill_name_owned, display_name, markdown_content, allowed_tools, model) = skill_data;

        // Build skill content
        let mut skill_content = markdown_content;
        if let Some(args_str) = args {
            skill_content.push_str(&format!("\n\n**ARGUMENTS:** {}", args_str));
        }

        // Record invocation with write lock
        if let Ok(mut registry_write) = registry.write() {
            registry_write.record_invoked(&skill_name_owned, &file_path, &skill_content);
        }

        Ok(SkillExecutionResult {
            success: true,
            output: Some(format!("Launching skill: {}", display_name)),
            error: None,
            steps_completed: Vec::new(),
            command_name: Some(display_name),
            allowed_tools,
            model,
        })
    }

    /// Generate tool description with available skills
    fn generate_description(&self) -> String {
        let registry = global_registry();
        let skills_xml = if let Ok(registry_guard) = registry.read() {
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
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let skill_name = params
            .get("skill")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: skill"))?;

        let args = params.get("args").and_then(|v| v.as_str());

        match self.execute_skill(skill_name, args) {
            Ok(result) => {
                let output = result
                    .output
                    .unwrap_or_else(|| "Skill executed".to_string());
                let mut tool_result = ToolResult::success(output);

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
    use crate::skills::types::{SkillDefinition, SkillExecutionMode, SkillSource};
    use std::path::PathBuf;

    fn create_test_skill() -> SkillDefinition {
        SkillDefinition {
            skill_name: "test:example".to_string(),
            display_name: "Example Skill".to_string(),
            description: "A test skill".to_string(),
            has_user_specified_description: true,
            markdown_content: "# Example\n\nDo something.".to_string(),
            allowed_tools: Some(vec!["read_file".to_string()]),
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
        }
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
}
