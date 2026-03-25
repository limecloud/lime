use serde::{Deserialize, Serialize};

use crate::commands::skill_error::{
    format_skill_error, map_find_skill_error, SKILL_ERR_CATALOG_UNAVAILABLE,
    SKILL_ERR_EXECUTE_FAILED,
};
use lime_skills::{
    find_skill_by_name, get_skill_roots, load_skills_from_directory, LoadedSkillDefinition,
};

/// 可执行 Skill 信息
///
/// 用于 list_executable_skills 命令的返回类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutableSkillInfo {
    /// Skill 名称（唯一标识）
    pub name: String,
    /// 显示名称
    pub display_name: String,
    /// Skill 描述
    pub description: String,
    /// 执行模式：prompt, workflow, agent
    pub execution_mode: String,
    /// 是否有 workflow 定义
    pub has_workflow: bool,
    /// 指定的 Provider（可选）
    pub provider: Option<String>,
    /// 指定的 Model（可选）
    pub model: Option<String>,
    /// 参数提示（可选）
    pub argument_hint: Option<String>,
}

/// Workflow 步骤信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepInfo {
    /// 步骤 ID
    pub id: String,
    /// 步骤名称
    pub name: String,
    /// 依赖的步骤 ID 列表
    pub dependencies: Vec<String>,
}

/// Skill 详情信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDetailInfo {
    /// 基本信息
    #[serde(flatten)]
    pub basic: ExecutableSkillInfo,
    /// Markdown 内容
    pub markdown_content: String,
    /// Workflow 步骤（如果有）
    pub workflow_steps: Option<Vec<WorkflowStepInfo>>,
    /// 允许的工具列表（可选）
    pub allowed_tools: Option<Vec<String>>,
    /// 使用场景说明（可选）
    pub when_to_use: Option<String>,
}

pub fn invalid_skill_message(skill: &LoadedSkillDefinition) -> Option<String> {
    if skill.standard_compliance.validation_errors.is_empty() {
        return None;
    }

    Some(format!(
        "Skill '{}' 未通过标准校验: {}",
        skill.skill_name,
        skill.standard_compliance.validation_errors.join("; ")
    ))
}

pub fn load_executable_skill_definition(skill_name: &str) -> Result<LoadedSkillDefinition, String> {
    let skill = find_skill_by_name(skill_name).map_err(map_find_skill_error)?;
    if let Some(message) = invalid_skill_message(&skill) {
        return Err(format_skill_error(SKILL_ERR_EXECUTE_FAILED, message));
    }
    if skill.disable_model_invocation {
        return Err(format_skill_error(
            SKILL_ERR_EXECUTE_FAILED,
            format!("Skill '{skill_name}' 已禁用模型调用，无法执行"),
        ));
    }

    Ok(skill)
}

fn to_executable_skill_info(skill: LoadedSkillDefinition) -> ExecutableSkillInfo {
    ExecutableSkillInfo {
        name: skill.skill_name,
        display_name: skill.display_name,
        description: skill.description,
        execution_mode: skill.execution_mode.clone(),
        has_workflow: skill.execution_mode == "workflow",
        provider: skill.provider,
        model: skill.model,
        argument_hint: skill.argument_hint,
    }
}

pub fn list_executable_skill_catalog() -> Result<Vec<ExecutableSkillInfo>, String> {
    let skill_roots = get_skill_roots();
    if skill_roots.is_empty() {
        return Err(format_skill_error(
            SKILL_ERR_CATALOG_UNAVAILABLE,
            "无法获取 Skills 目录",
        ));
    }

    let mut all_skills = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for skill_root in skill_roots {
        for skill in load_skills_from_directory(&skill_root) {
            if seen.insert(skill.skill_name.clone()) {
                all_skills.push(skill);
            }
        }
    }

    let executable_skills: Vec<ExecutableSkillInfo> = all_skills
        .into_iter()
        .filter(|skill| !skill.disable_model_invocation)
        .map(to_executable_skill_info)
        .collect();

    tracing::info!(
        "[list_executable_skills] 返回 {} 个可执行 Skills",
        executable_skills.len()
    );

    Ok(executable_skills)
}

pub fn get_skill_detail_info(skill_name: &str) -> Result<SkillDetailInfo, String> {
    let skill = load_executable_skill_definition(skill_name)?;

    let detail = SkillDetailInfo {
        basic: ExecutableSkillInfo {
            name: skill.skill_name,
            display_name: skill.display_name,
            description: skill.description,
            execution_mode: skill.execution_mode.clone(),
            has_workflow: skill.execution_mode == "workflow",
            provider: skill.provider,
            model: skill.model,
            argument_hint: skill.argument_hint,
        },
        markdown_content: skill.markdown_content,
        workflow_steps: if skill.workflow_steps.is_empty() {
            None
        } else {
            Some(
                skill
                    .workflow_steps
                    .iter()
                    .map(|step| WorkflowStepInfo {
                        id: step.id.clone(),
                        name: step.name.clone(),
                        dependencies: Vec::new(),
                    })
                    .collect(),
            )
        },
        allowed_tools: skill.allowed_tools,
        when_to_use: skill.when_to_use,
    };

    tracing::info!("[get_skill_detail] 返回 Skill 详情: name={}", skill_name);

    Ok(detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::{SkillExecutionResult, StepResult};
    use lime_skills::{
        load_skill_from_file, parse_allowed_tools, parse_boolean, parse_skill_frontmatter,
    };

    #[test]
    fn test_executable_skill_info_serialization() {
        let info = ExecutableSkillInfo {
            name: "test-skill".to_string(),
            display_name: "Test Skill".to_string(),
            description: "A test skill".to_string(),
            execution_mode: "prompt".to_string(),
            has_workflow: false,
            provider: None,
            model: None,
            argument_hint: Some("Enter your query".to_string()),
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("test-skill"));
        assert!(json.contains("Test Skill"));
    }

    #[test]
    fn test_skill_execution_result_serialization() {
        let result = SkillExecutionResult {
            success: true,
            output: Some("Hello, world!".to_string()),
            error: None,
            artifact_paths: vec![],
            steps_completed: vec![StepResult {
                step_id: "step-1".to_string(),
                step_name: "Process".to_string(),
                success: true,
                output: Some("Done".to_string()),
                error: None,
            }],
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("Hello, world!"));
        assert!(json.contains("step-1"));
    }

    #[test]
    fn test_skill_detail_info_serialization() {
        let detail = SkillDetailInfo {
            basic: ExecutableSkillInfo {
                name: "workflow-skill".to_string(),
                display_name: "Workflow Skill".to_string(),
                description: "A workflow skill".to_string(),
                execution_mode: "workflow".to_string(),
                has_workflow: true,
                provider: Some("claude".to_string()),
                model: Some("claude-sonnet-4-5-20250514".to_string()),
                argument_hint: None,
            },
            markdown_content: "# Workflow Skill\n\nThis is a workflow skill.".to_string(),
            workflow_steps: Some(vec![
                WorkflowStepInfo {
                    id: "step-1".to_string(),
                    name: "Initialize".to_string(),
                    dependencies: vec![],
                },
                WorkflowStepInfo {
                    id: "step-2".to_string(),
                    name: "Process".to_string(),
                    dependencies: vec!["step-1".to_string()],
                },
            ]),
            allowed_tools: Some(vec!["read_file".to_string(), "write_file".to_string()]),
            when_to_use: Some("Use this skill for complex workflows".to_string()),
        };

        let json = serde_json::to_string(&detail).unwrap();
        assert!(json.contains("workflow-skill"));
        assert!(json.contains("workflow_steps"));
        assert!(json.contains("step-1"));
        assert!(json.contains("step-2"));
    }

    #[test]
    fn test_parse_skill_frontmatter_basic() {
        let content = r#"---
name: test-skill
description: A test skill
metadata:
  lime_model_preference: claude-sonnet-4-5-20250514
  lime_provider_preference: claude
---

# Test Skill

This is the body content.
"#;
        let (fm, body) = parse_skill_frontmatter(content);
        assert_eq!(fm.name, Some("test-skill".to_string()));
        assert_eq!(fm.description, Some("A test skill".to_string()));
        assert_eq!(fm.model, Some("claude-sonnet-4-5-20250514".to_string()));
        assert_eq!(fm.provider, Some("claude".to_string()));
        assert!(body.contains("# Test Skill"));
        assert!(body.contains("This is the body content."));
    }

    #[test]
    fn test_parse_skill_frontmatter_no_frontmatter() {
        let content = "# Just content\nNo frontmatter here.";
        let (fm, body) = parse_skill_frontmatter(content);
        assert!(fm.name.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_skill_frontmatter_with_quotes() {
        let content = r#"---
name: "quoted-name"
description: 'single quoted'
---
Body
"#;
        let (fm, _) = parse_skill_frontmatter(content);
        assert_eq!(fm.name, Some("quoted-name".to_string()));
        assert_eq!(fm.description, Some("single quoted".to_string()));
    }

    #[test]
    fn test_parse_allowed_tools() {
        assert_eq!(parse_allowed_tools(None), None);
        assert_eq!(parse_allowed_tools(Some("")), None);
        assert_eq!(
            parse_allowed_tools(Some("tool1")),
            Some(vec!["tool1".to_string()])
        );
        assert_eq!(
            parse_allowed_tools(Some("tool1, tool2, tool3")),
            Some(vec![
                "tool1".to_string(),
                "tool2".to_string(),
                "tool3".to_string()
            ])
        );
    }

    #[test]
    fn test_parse_boolean() {
        assert!(!parse_boolean(None, false));
        assert!(parse_boolean(None, true));
        assert!(parse_boolean(Some("true"), false));
        assert!(parse_boolean(Some("TRUE"), false));
        assert!(parse_boolean(Some("1"), false));
        assert!(parse_boolean(Some("yes"), false));
        assert!(!parse_boolean(Some("false"), true));
        assert!(!parse_boolean(Some("no"), true));
    }

    #[test]
    fn test_load_skill_from_file() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("my-skill");
        std::fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        std::fs::write(
            &skill_file,
            r#"---
name: my-skill
description: Test skill description
allowed-tools: tool1, tool2
metadata:
  lime_model_preference: gpt-4
  lime_provider_preference: openai
---

# My Skill

Instructions here.
"#,
        )
        .unwrap();

        let skill = load_skill_from_file("my-skill", &skill_file).unwrap();

        assert_eq!(skill.skill_name, "my-skill");
        assert_eq!(skill.display_name, "my-skill");
        assert_eq!(skill.description, "Test skill description");
        assert_eq!(
            skill.allowed_tools,
            Some(vec!["tool1".to_string(), "tool2".to_string()])
        );
        assert_eq!(skill.model, Some("gpt-4".to_string()));
        assert_eq!(skill.provider, Some("openai".to_string()));
        assert!(!skill.disable_model_invocation);
        assert_eq!(skill.execution_mode, "prompt");
        assert!(skill.standard_compliance.is_standard);
    }

    #[test]
    fn test_load_skill_from_file_should_surface_invalid_workflow_reference() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("workflow-skill");
        std::fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        std::fs::write(
            &skill_file,
            r#"---
name: workflow-skill
description: Workflow skill
metadata:
  lime_workflow_ref: references/missing.json
---

# Workflow Skill
"#,
        )
        .unwrap();

        let skill = load_skill_from_file("workflow-skill", &skill_file).unwrap();

        assert!(!skill.standard_compliance.is_standard);
        assert!(skill
            .standard_compliance
            .validation_errors
            .iter()
            .any(|error| error.contains("metadata.lime_workflow_ref")));
        assert!(skill.workflow_steps.is_empty());
    }

    #[test]
    fn test_load_skills_from_directory() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path();

        let skill1_dir = skills_dir.join("skill-one");
        std::fs::create_dir(&skill1_dir).unwrap();
        std::fs::write(
            skill1_dir.join("SKILL.md"),
            r#"---
name: skill-one
description: First skill
---
Content 1
"#,
        )
        .unwrap();

        let skill2_dir = skills_dir.join("skill-two");
        std::fs::create_dir(&skill2_dir).unwrap();
        std::fs::write(
            skill2_dir.join("SKILL.md"),
            r#"---
name: skill-two
description: Second skill
disable-model-invocation: true
---
Content 2
"#,
        )
        .unwrap();

        let skills = load_skills_from_directory(skills_dir);

        assert_eq!(skills.len(), 2);
        let names: Vec<_> = skills
            .iter()
            .map(|skill| skill.skill_name.as_str())
            .collect();
        assert!(names.contains(&"skill-one"));
        assert!(names.contains(&"skill-two"));

        let skill_two = skills
            .iter()
            .find(|skill| skill.skill_name == "skill-two")
            .unwrap();
        assert!(skill_two.disable_model_invocation);
    }

    #[test]
    fn test_load_skills_from_directory_should_skip_invalid_skill_packages() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path();

        let valid_dir = skills_dir.join("skill-valid");
        std::fs::create_dir(&valid_dir).unwrap();
        std::fs::write(
            valid_dir.join("SKILL.md"),
            r#"---
name: skill-valid
description: Valid skill
---
Valid content
"#,
        )
        .unwrap();

        let invalid_dir = skills_dir.join("skill-invalid");
        std::fs::create_dir(&invalid_dir).unwrap();
        std::fs::write(
            invalid_dir.join("SKILL.md"),
            r#"---
name: skill-invalid
description: Invalid skill
metadata:
  lime_workflow_ref: references/missing.json
---
Invalid content
"#,
        )
        .unwrap();

        let skills = load_skills_from_directory(skills_dir);

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].skill_name, "skill-valid");
    }

    #[test]
    fn test_load_skills_from_nonexistent_directory() {
        let skills = load_skills_from_directory(std::path::Path::new("/nonexistent/path"));
        assert!(skills.is_empty());
    }

    #[test]
    fn test_bundled_social_post_with_cover_skill_contract() {
        let skill_file = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/default-skills/social_post_with_cover/SKILL.md");

        assert!(skill_file.exists());
        let content = std::fs::read_to_string(&skill_file).unwrap();
        let skill = load_skill_from_file("social_post_with_cover", &skill_file).unwrap();

        assert_eq!(skill.skill_name, "social_post_with_cover");
        assert_eq!(skill.execution_mode, "workflow");
        assert_eq!(
            skill.workflow_ref,
            Some("references/workflow.json".to_string())
        );
        assert_eq!(
            skill.allowed_tools,
            Some(vec![
                "social_generate_cover_image".to_string(),
                "search_query".to_string(),
            ])
        );
        assert!(content.contains("<write_file") && content.contains("social-posts/"));
        assert!(!skill.disable_model_invocation);
        assert!(skill.standard_compliance.is_standard);
    }
}
