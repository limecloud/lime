//! Skill Loader
//!
//! Handles parsing and loading skills from SKILL.md files.

use super::types::{SkillDefinition, SkillExecutionMode, SkillFrontmatter, SkillSource};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Parse frontmatter from skill content
///
/// Supports two parsing modes:
/// 1. Simple fields (name, description, etc.) - line-by-line parsing
/// 2. Complex fields (workflow) - full YAML parsing via serde_yaml
///
/// ```text
/// function NV(A) {
///   let Q = /^---\s*\n([\s\S]*?)---\s*\n?/;
///   let B = A.match(Q);
///   if (!B) return { frontmatter: {}, content: A };
///   ...
/// }
/// ```
pub fn parse_frontmatter(content: &str) -> (SkillFrontmatter, String) {
    // Match frontmatter block: ---\n...\n---
    let regex = regex::Regex::new(r"^---\s*\n([\s\S]*?)---\s*\n?").unwrap();

    if let Some(captures) = regex.captures(content) {
        let frontmatter_text = captures.get(1).map(|m| m.as_str()).unwrap_or("");
        let body_start = captures.get(0).map(|m| m.end()).unwrap_or(0);
        let body = content.get(body_start..).unwrap_or("").to_string();

        // Try full YAML parsing first (handles complex fields like workflow)
        if let Ok(frontmatter) = serde_yaml::from_str::<SkillFrontmatter>(frontmatter_text) {
            return (frontmatter, body);
        }

        // Fallback to simple line-by-line parsing for basic fields
        let mut frontmatter = SkillFrontmatter::default();
        let mut extra_fields: HashMap<String, String> = HashMap::new();

        for line in frontmatter_text.lines() {
            if let Some(colon_idx) = line.find(':') {
                let key = line.get(..colon_idx).unwrap_or("").trim();
                let value = line.get(colon_idx + 1..).unwrap_or("").trim();
                // Remove surrounding quotes
                let clean_value = value
                    .trim_start_matches('"')
                    .trim_end_matches('"')
                    .trim_start_matches('\'')
                    .trim_end_matches('\'')
                    .to_string();

                match key {
                    "name" => frontmatter.name = Some(clean_value),
                    "description" => frontmatter.description = Some(clean_value),
                    "allowed-tools" => frontmatter.allowed_tools = Some(clean_value),
                    "argument-hint" => frontmatter.argument_hint = Some(clean_value),
                    "when-to-use" | "when_to_use" => frontmatter.when_to_use = Some(clean_value),
                    "version" => frontmatter.version = Some(clean_value),
                    "model" => frontmatter.model = Some(clean_value),
                    "user-invocable" => frontmatter.user_invocable = Some(clean_value),
                    "disable-model-invocation" => {
                        frontmatter.disable_model_invocation = Some(clean_value)
                    }
                    // 新增字段解析
                    "execution-mode" => frontmatter.execution_mode = Some(clean_value),
                    "provider" => frontmatter.provider = Some(clean_value),
                    _ => {
                        extra_fields.insert(key.to_string(), clean_value);
                    }
                }
            }
        }

        (frontmatter, body)
    } else {
        (SkillFrontmatter::default(), content.to_string())
    }
}

/// Parse allowed-tools field into a list
pub fn parse_allowed_tools(value: Option<&str>) -> Option<Vec<String>> {
    value.and_then(|v| {
        if v.is_empty() {
            return None;
        }
        if v.contains(',') {
            Some(
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            )
        } else {
            Some(vec![v.trim().to_string()])
        }
    })
}

/// Parse boolean field
pub fn parse_boolean(value: Option<&str>, default: bool) -> bool {
    value
        .map(|v| {
            let lower = v.to_lowercase();
            matches!(lower.as_str(), "true" | "1" | "yes")
        })
        .unwrap_or(default)
}

/// Find supporting files in a skill directory
pub fn find_supporting_files(directory: &Path, skill_file: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path != skill_file {
                files.push(path);
            } else if path.is_dir() {
                // Recursively find files in subdirectories
                if let Ok(sub_entries) = fs::read_dir(&path) {
                    for sub_entry in sub_entries.flatten() {
                        let sub_path = sub_entry.path();
                        if sub_path.is_file() {
                            files.push(sub_path);
                        }
                    }
                }
            }
        }
    }

    files
}

/// Load a skill from a SKILL.md file
pub fn load_skill_from_file(
    skill_name: &str,
    file_path: &Path,
    source: SkillSource,
) -> Result<SkillDefinition, String> {
    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read skill file: {}", e))?;

    let (frontmatter, markdown_content) = parse_frontmatter(&content);

    let base_dir = file_path
        .parent()
        .ok_or("Skill file has no parent directory")?
        .to_path_buf();

    let supporting_files = find_supporting_files(&base_dir, file_path);

    let display_name = frontmatter
        .name
        .clone()
        .unwrap_or_else(|| skill_name.to_string());
    let description = frontmatter.description.clone().unwrap_or_default();
    let has_user_specified_description = frontmatter.description.is_some();

    let allowed_tools = parse_allowed_tools(frontmatter.allowed_tools.as_deref());
    let disable_model_invocation =
        parse_boolean(frontmatter.disable_model_invocation.as_deref(), false);
    let user_invocable = parse_boolean(frontmatter.user_invocable.as_deref(), true);

    // 解析执行模式
    let execution_mode = frontmatter
        .execution_mode
        .as_deref()
        .map(SkillExecutionMode::parse)
        .unwrap_or_default();

    Ok(SkillDefinition {
        skill_name: skill_name.to_string(),
        display_name,
        description,
        has_user_specified_description,
        markdown_content,
        allowed_tools,
        argument_hint: frontmatter.argument_hint,
        when_to_use: frontmatter.when_to_use,
        version: frontmatter.version,
        model: frontmatter.model,
        disable_model_invocation,
        user_invocable,
        source,
        base_dir,
        file_path: file_path.to_path_buf(),
        supporting_files,
        execution_mode,
        provider: frontmatter.provider,
        workflow: frontmatter.workflow,
    })
}

/// Load skills from a directory
///
/// 1. Check for SKILL.md in root (single skill mode)
/// 2. Otherwise, scan subdirectories for SKILL.md files
pub fn load_skills_from_directory(dir_path: &Path, source: SkillSource) -> Vec<SkillDefinition> {
    let mut results = Vec::new();

    if !dir_path.exists() {
        return results;
    }

    // 1. Check for SKILL.md in root directory (single skill mode)
    let root_skill_file = dir_path.join("SKILL.md");
    if root_skill_file.exists() {
        let skill_name = format!(
            "{}:{}",
            source,
            dir_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
        );

        if let Ok(skill) = load_skill_from_file(&skill_name, &root_skill_file, source) {
            results.push(skill);
        }
        return results;
    }

    // 2. Scan subdirectories for SKILL.md files
    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let skill_file = path.join("SKILL.md");
            if skill_file.exists() {
                let skill_name = format!(
                    "{}:{}",
                    source,
                    path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                );

                if let Ok(skill) = load_skill_from_file(&skill_name, &skill_file, source) {
                    results.push(skill);
                }
            }
        }
    }

    results
}

/// Get enabled plugins from settings
pub fn get_enabled_plugins() -> std::collections::HashSet<String> {
    let mut enabled = std::collections::HashSet::new();

    if let Some(home) = dirs::home_dir() {
        let settings_path = home.join(".claude/settings.json");
        if let Ok(content) = fs::read_to_string(&settings_path) {
            if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(plugins) = settings.get("enabledPlugins").and_then(|v| v.as_object()) {
                    for (plugin_id, is_enabled) in plugins {
                        if is_enabled.as_bool().unwrap_or(false) {
                            enabled.insert(plugin_id.clone());
                        }
                    }
                }
            }
        }
    }

    enabled
}

/// Load skills from plugin cache
///
pub fn load_skills_from_plugin_cache() -> Vec<SkillDefinition> {
    let mut results = Vec::new();

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return results,
    };

    let plugins_cache_dir = home.join(".claude/plugins/cache");
    if !plugins_cache_dir.exists() {
        return results;
    }

    let enabled_plugins = get_enabled_plugins();

    // Traverse marketplace directories
    let marketplaces = match fs::read_dir(&plugins_cache_dir) {
        Ok(entries) => entries,
        Err(_) => return results,
    };

    for marketplace_entry in marketplaces.flatten() {
        if !marketplace_entry.path().is_dir() {
            continue;
        }

        let marketplace_name = marketplace_entry.file_name();
        let marketplace_path = marketplace_entry.path();

        let plugins = match fs::read_dir(&marketplace_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for plugin_entry in plugins.flatten() {
            if !plugin_entry.path().is_dir() {
                continue;
            }

            let plugin_name = plugin_entry.file_name();
            let plugin_id = format!(
                "{}@{}",
                plugin_name.to_string_lossy(),
                marketplace_name.to_string_lossy()
            );

            // Check if plugin is enabled
            if !enabled_plugins.contains(&plugin_id) {
                continue;
            }

            let plugin_path = plugin_entry.path();
            let versions = match fs::read_dir(&plugin_path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for version_entry in versions.flatten() {
                if !version_entry.path().is_dir() {
                    continue;
                }

                let skills_path = version_entry.path().join("skills");
                if !skills_path.exists() {
                    continue;
                }

                let skill_dirs = match fs::read_dir(&skills_path) {
                    Ok(entries) => entries,
                    Err(_) => continue,
                };

                for skill_dir_entry in skill_dirs.flatten() {
                    if !skill_dir_entry.path().is_dir() {
                        continue;
                    }

                    let skill_md_path = skill_dir_entry.path().join("SKILL.md");
                    if !skill_md_path.exists() {
                        continue;
                    }

                    let skill_name = format!(
                        "{}:{}",
                        plugin_name.to_string_lossy(),
                        skill_dir_entry.file_name().to_string_lossy()
                    );

                    if let Ok(skill) =
                        load_skill_from_file(&skill_name, &skill_md_path, SkillSource::Plugin)
                    {
                        results.push(skill);
                    }
                }
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parse_frontmatter_basic() {
        let content = r#"---
name: test-skill
description: A test skill
---

# Test Skill

This is the body.
"#;
        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("test-skill".to_string()));
        assert_eq!(fm.description, Some("A test skill".to_string()));
        assert!(body.contains("# Test Skill"));
    }

    #[test]
    fn test_parse_frontmatter_no_frontmatter() {
        let content = "# Just content\nNo frontmatter here.";
        let (fm, body) = parse_frontmatter(content);
        assert!(fm.name.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_frontmatter_with_quotes() {
        let content = r#"---
name: "quoted-name"
description: 'single quoted'
---
Body
"#;
        let (fm, _) = parse_frontmatter(content);
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
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("my-skill");
        fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(
            &skill_file,
            r#"---
name: my-skill
description: Test skill description
allowed-tools: tool1, tool2
version: 1.0.0
---

# My Skill

Instructions here.
"#,
        )
        .unwrap();

        // Add supporting file
        fs::write(skill_dir.join("helper.py"), "print('hello')").unwrap();

        let skill = load_skill_from_file("user:my-skill", &skill_file, SkillSource::User).unwrap();

        assert_eq!(skill.skill_name, "user:my-skill");
        assert_eq!(skill.display_name, "my-skill");
        assert_eq!(skill.description, "Test skill description");
        assert!(skill.has_user_specified_description);
        assert_eq!(
            skill.allowed_tools,
            Some(vec!["tool1".to_string(), "tool2".to_string()])
        );
        assert_eq!(skill.version, Some("1.0.0".to_string()));
        assert!(skill.user_invocable);
        assert!(!skill.disable_model_invocation);
        assert_eq!(skill.supporting_files.len(), 1);
    }

    #[test]
    fn test_load_skills_from_directory() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        fs::create_dir(&skills_dir).unwrap();

        // Create skill 1
        let skill1_dir = skills_dir.join("skill-one");
        fs::create_dir(&skill1_dir).unwrap();
        fs::write(
            skill1_dir.join("SKILL.md"),
            r#"---
name: skill-one
description: First skill
---
Content 1
"#,
        )
        .unwrap();

        // Create skill 2
        let skill2_dir = skills_dir.join("skill-two");
        fs::create_dir(&skill2_dir).unwrap();
        fs::write(
            skill2_dir.join("SKILL.md"),
            r#"---
name: skill-two
description: Second skill
---
Content 2
"#,
        )
        .unwrap();

        let skills = load_skills_from_directory(&skills_dir, SkillSource::User);

        assert_eq!(skills.len(), 2);
        let names: Vec<_> = skills.iter().map(|s| s.short_name()).collect();
        assert!(names.contains(&"skill-one"));
        assert!(names.contains(&"skill-two"));
    }

    #[test]
    fn test_load_skills_single_skill_mode() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("single-skill");
        fs::create_dir(&skill_dir).unwrap();

        // SKILL.md in root = single skill mode
        fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: single
description: Single skill
---
Content
"#,
        )
        .unwrap();

        let skills = load_skills_from_directory(&skill_dir, SkillSource::Project);

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].display_name, "single");
    }

    #[test]
    fn test_find_supporting_files() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(&skill_file, "content").unwrap();
        fs::write(skill_dir.join("helper.py"), "code").unwrap();
        fs::write(skill_dir.join("config.json"), "{}").unwrap();

        let sub_dir = skill_dir.join("templates");
        fs::create_dir(&sub_dir).unwrap();
        fs::write(sub_dir.join("template.txt"), "template").unwrap();

        let files = find_supporting_files(skill_dir, &skill_file);

        assert_eq!(files.len(), 3);
    }

    // ==================== 新增字段解析测试 ====================

    #[test]
    fn test_parse_frontmatter_with_execution_mode() {
        let content = r#"---
name: workflow-skill
description: A workflow skill
execution-mode: workflow
---

# Workflow Skill

Instructions here.
"#;
        let (fm, body) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("workflow-skill".to_string()));
        assert_eq!(fm.execution_mode, Some("workflow".to_string()));
        assert!(body.contains("# Workflow Skill"));
    }

    #[test]
    fn test_parse_frontmatter_with_provider() {
        let content = r#"---
name: provider-skill
description: A skill with provider
provider: openai
---

# Provider Skill

Content here.
"#;
        let (fm, _) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("provider-skill".to_string()));
        assert_eq!(fm.provider, Some("openai".to_string()));
    }

    #[test]
    fn test_parse_frontmatter_with_execution_mode_and_provider() {
        let content = r#"---
name: full-skill
description: A skill with all new fields
execution-mode: agent
provider: claude
model: claude-3-opus
---

# Full Skill

Content.
"#;
        let (fm, _) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("full-skill".to_string()));
        assert_eq!(fm.execution_mode, Some("agent".to_string()));
        assert_eq!(fm.provider, Some("claude".to_string()));
        assert_eq!(fm.model, Some("claude-3-opus".to_string()));
    }

    #[test]
    fn test_parse_frontmatter_execution_mode_default() {
        // 不指定 execution-mode 时应为 None
        let content = r#"---
name: simple-skill
description: A simple skill
---

Content.
"#;
        let (fm, _) = parse_frontmatter(content);
        assert_eq!(fm.name, Some("simple-skill".to_string()));
        assert!(fm.execution_mode.is_none());
        assert!(fm.provider.is_none());
    }

    #[test]
    fn test_parse_frontmatter_with_workflow_yaml() {
        let content = r#"---
name: workflow-skill
description: A workflow skill with steps
execution-mode: workflow
provider: openai
workflow:
  steps:
    - id: analyze
      name: 分析代码
      prompt: "分析以下代码：${user_input}"
      output: analysis_result
    - id: generate
      name: 生成代码
      prompt: "基于分析结果生成代码：${analysis_result}"
      output: generated_code
      dependencies:
        - analyze
  max_retries: 3
  continue_on_failure: true
---

# Workflow Skill

This skill runs a multi-step workflow.
"#;
        let (fm, body) = parse_frontmatter(content);

        // 验证基本字段
        assert_eq!(fm.name, Some("workflow-skill".to_string()));
        assert_eq!(fm.execution_mode, Some("workflow".to_string()));
        assert_eq!(fm.provider, Some("openai".to_string()));

        // 验证 workflow 定义
        assert!(fm.workflow.is_some());
        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 2);
        assert_eq!(workflow.max_retries, 3);
        assert!(workflow.continue_on_failure);

        // 验证步骤
        assert_eq!(workflow.steps[0].id, "analyze");
        assert_eq!(workflow.steps[0].name, "分析代码");
        assert_eq!(workflow.steps[1].id, "generate");
        assert_eq!(workflow.steps[1].dependencies, vec!["analyze"]);

        // 验证 body
        assert!(body.contains("# Workflow Skill"));
    }

    #[test]
    fn test_load_skill_with_execution_mode() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("workflow-skill");
        fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(
            &skill_file,
            r#"---
name: workflow-skill
description: A workflow skill
execution-mode: workflow
provider: gemini
---

# Workflow Skill

Instructions here.
"#,
        )
        .unwrap();

        let skill =
            load_skill_from_file("user:workflow-skill", &skill_file, SkillSource::User).unwrap();

        assert_eq!(skill.skill_name, "user:workflow-skill");
        assert_eq!(skill.execution_mode, SkillExecutionMode::Workflow);
        assert_eq!(skill.provider, Some("gemini".to_string()));
    }

    #[test]
    fn test_load_skill_with_workflow_definition() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("full-workflow");
        fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(
            &skill_file,
            r#"---
name: full-workflow
description: A complete workflow skill
execution-mode: workflow
provider: openai
workflow:
  steps:
    - id: step1
      name: 第一步
      prompt: "处理输入：${user_input}"
      output: result1
    - id: step2
      name: 第二步
      prompt: "继续处理：${result1}"
      output: result2
      dependencies:
        - step1
  max_retries: 2
  continue_on_failure: false
---

# Full Workflow Skill

This is a complete workflow skill.
"#,
        )
        .unwrap();

        let skill =
            load_skill_from_file("user:full-workflow", &skill_file, SkillSource::User).unwrap();

        assert_eq!(skill.execution_mode, SkillExecutionMode::Workflow);
        assert_eq!(skill.provider, Some("openai".to_string()));

        // 验证 workflow 定义
        assert!(skill.workflow.is_some());
        let workflow = skill.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 2);
        assert_eq!(workflow.max_retries, 2);
        assert!(!workflow.continue_on_failure);

        // 验证步骤依赖
        assert_eq!(workflow.steps[1].dependencies, vec!["step1"]);
    }

    #[test]
    fn test_load_skill_default_execution_mode() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("simple-skill");
        fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(
            &skill_file,
            r#"---
name: simple-skill
description: A simple skill without execution-mode
---

# Simple Skill

Content.
"#,
        )
        .unwrap();

        let skill =
            load_skill_from_file("user:simple-skill", &skill_file, SkillSource::User).unwrap();

        // 默认执行模式应为 Prompt
        assert_eq!(skill.execution_mode, SkillExecutionMode::Prompt);
        assert!(skill.provider.is_none());
        assert!(skill.workflow.is_none());
    }

    // ==================== Workflow YAML 解析综合测试 ====================
    // Task 2.2: 添加 YAML workflow 解析逻辑
    // Requirements: 3.1, 3.2, 3.3, 3.4

    #[test]
    fn test_parse_workflow_with_multiple_steps() {
        // 测试多步骤工作流解析
        // Requirements: 3.1, 3.2
        let content = r#"---
name: multi-step-workflow
description: A workflow with multiple steps
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 第一步
      prompt: "处理输入：${user_input}"
      output: result1
    - id: step2
      name: 第二步
      prompt: "继续处理：${result1}"
      output: result2
    - id: step3
      name: 第三步
      prompt: "最终处理：${result2}"
      output: final_result
---

# Multi-Step Workflow
"#;
        let (fm, _) = parse_frontmatter(content);

        assert!(fm.workflow.is_some());
        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 3);

        // 验证每个步骤
        assert_eq!(workflow.steps[0].id, "step1");
        assert_eq!(workflow.steps[0].name, "第一步");
        assert_eq!(workflow.steps[0].output, "result1");

        assert_eq!(workflow.steps[1].id, "step2");
        assert_eq!(workflow.steps[1].name, "第二步");
        assert!(workflow.steps[1].prompt.contains("${result1}"));

        assert_eq!(workflow.steps[2].id, "step3");
        assert_eq!(workflow.steps[2].output, "final_result");
    }

    #[test]
    fn test_parse_workflow_with_complex_dependencies() {
        // 测试复杂依赖关系的工作流
        // Requirements: 3.2
        let content = r#"---
name: dependency-workflow
execution-mode: workflow
workflow:
  steps:
    - id: fetch_data
      name: 获取数据
      prompt: "获取数据：${user_input}"
      output: raw_data
    - id: validate
      name: 验证数据
      prompt: "验证：${raw_data}"
      output: validated_data
      dependencies:
        - fetch_data
    - id: transform
      name: 转换数据
      prompt: "转换：${raw_data}"
      output: transformed_data
      dependencies:
        - fetch_data
    - id: merge
      name: 合并结果
      prompt: "合并：${validated_data} 和 ${transformed_data}"
      output: merged_result
      dependencies:
        - validate
        - transform
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 4);

        // 验证依赖关系
        let fetch = &workflow.steps[0];
        assert!(fetch.dependencies.is_empty());

        let validate = &workflow.steps[1];
        assert_eq!(validate.dependencies, vec!["fetch_data"]);

        let transform = &workflow.steps[2];
        assert_eq!(transform.dependencies, vec!["fetch_data"]);

        let merge = &workflow.steps[3];
        assert_eq!(merge.dependencies.len(), 2);
        assert!(merge.dependencies.contains(&"validate".to_string()));
        assert!(merge.dependencies.contains(&"transform".to_string()));
    }

    #[test]
    fn test_parse_workflow_with_max_retries() {
        // 测试 max_retries 配置
        // Requirements: 3.3
        let content = r#"---
name: retry-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 步骤
      prompt: "执行"
      output: result
  max_retries: 5
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.max_retries, 5);
    }

    #[test]
    fn test_parse_workflow_with_default_max_retries() {
        // 测试 max_retries 默认值
        // Requirements: 3.3
        let content = r#"---
name: default-retry-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 步骤
      prompt: "执行"
      output: result
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.max_retries, 2); // 默认值为 2
    }

    #[test]
    fn test_parse_workflow_with_continue_on_failure_true() {
        // 测试 continue_on_failure = true
        // Requirements: 3.4
        let content = r#"---
name: continue-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 步骤
      prompt: "执行"
      output: result
  continue_on_failure: true
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert!(workflow.continue_on_failure);
    }

    #[test]
    fn test_parse_workflow_with_default_continue_on_failure() {
        // 测试 continue_on_failure 默认值
        // Requirements: 3.4
        let content = r#"---
name: default-continue-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 步骤
      prompt: "执行"
      output: result
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert!(!workflow.continue_on_failure); // 默认值为 false
    }

    #[test]
    fn test_parse_workflow_with_all_settings() {
        // 测试所有配置项组合
        // Requirements: 3.3, 3.4
        let content = r#"---
name: full-config-workflow
execution-mode: workflow
workflow:
  steps:
    - id: analyze
      name: 分析
      prompt: "分析：${user_input}"
      output: analysis
    - id: generate
      name: 生成
      prompt: "生成：${analysis}"
      output: result
      dependencies:
        - analyze
  max_retries: 10
  continue_on_failure: true
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 2);
        assert_eq!(workflow.max_retries, 10);
        assert!(workflow.continue_on_failure);
    }

    #[test]
    fn test_parse_workflow_with_empty_steps() {
        // 测试空步骤列表（边界情况）
        let content = r#"---
name: empty-workflow
execution-mode: workflow
workflow:
  steps: []
  max_retries: 3
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert!(workflow.steps.is_empty());
        assert_eq!(workflow.max_retries, 3);
    }

    #[test]
    fn test_parse_workflow_step_with_optional_input() {
        // 测试步骤的可选 input 字段
        // Requirements: 3.2
        let content = r#"---
name: input-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 带输入的步骤
      prompt: "处理"
      input: user_data
      output: result
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps[0].input, Some("user_data".to_string()));
    }

    #[test]
    fn test_parse_workflow_step_without_optional_fields() {
        // 测试步骤缺少可选字段时的默认值
        // Requirements: 3.2
        let content = r#"---
name: minimal-step-workflow
execution-mode: workflow
workflow:
  steps:
    - id: minimal
      name: 最小步骤
      prompt: "执行任务"
      output: result
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        let step = &workflow.steps[0];

        assert_eq!(step.id, "minimal");
        assert_eq!(step.name, "最小步骤");
        assert_eq!(step.prompt, "执行任务");
        assert_eq!(step.output, "result");
        assert!(step.input.is_none()); // 可选字段默认为 None
        assert!(step.dependencies.is_empty()); // 可选字段默认为空
        assert!(!step.parallel); // 可选字段默认为 false
    }

    #[test]
    fn test_parse_workflow_step_with_parallel_flag() {
        // 测试步骤的 parallel 标志（预留字段）
        let content = r#"---
name: parallel-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 并行步骤
      prompt: "执行"
      output: result
      parallel: true
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert!(workflow.steps[0].parallel);
    }

    #[test]
    fn test_parse_workflow_with_variable_interpolation_patterns() {
        // 测试各种变量插值模式
        // Requirements: 3.2
        let content = r#"---
name: interpolation-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 用户输入
      prompt: "处理用户输入：${user_input}"
      output: processed
    - id: step2
      name: 引用前一步
      prompt: "基于 ${processed} 继续处理"
      output: continued
      dependencies:
        - step1
    - id: step3
      name: 多变量引用
      prompt: "合并 ${user_input} 和 ${processed} 以及 ${continued}"
      output: final
      dependencies:
        - step1
        - step2
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 3);

        // 验证变量插值模式被正确保留
        assert!(workflow.steps[0].prompt.contains("${user_input}"));
        assert!(workflow.steps[1].prompt.contains("${processed}"));
        assert!(workflow.steps[2].prompt.contains("${user_input}"));
        assert!(workflow.steps[2].prompt.contains("${processed}"));
        assert!(workflow.steps[2].prompt.contains("${continued}"));
    }

    #[test]
    fn test_parse_workflow_without_execution_mode() {
        // 测试：即使 execution-mode 不是 workflow，也应该解析 workflow 定义
        // Requirements: 3.5 (IF workflow is specified but execution-mode is not "workflow",
        // THE Skill_Loader SHALL still parse and store the workflow definition)
        let content = r#"---
name: prompt-with-workflow
execution-mode: prompt
workflow:
  steps:
    - id: step1
      name: 步骤
      prompt: "执行"
      output: result
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        assert_eq!(fm.execution_mode, Some("prompt".to_string()));
        assert!(fm.workflow.is_some()); // workflow 仍然被解析
        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 1);
    }

    #[test]
    fn test_load_skill_workflow_with_chinese_content() {
        // 测试中文内容的工作流
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("chinese-workflow");
        fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(
            &skill_file,
            r#"---
name: 中文工作流
description: 一个包含中文的工作流技能
execution-mode: workflow
provider: openai
workflow:
  steps:
    - id: 分析步骤
      name: 代码分析
      prompt: "请分析以下代码：${user_input}"
      output: 分析结果
    - id: 生成步骤
      name: 代码生成
      prompt: "基于分析结果生成代码：${分析结果}"
      output: 生成代码
      dependencies:
        - 分析步骤
  max_retries: 3
  continue_on_failure: false
---

# 中文工作流技能

这是一个支持中文的工作流技能。
"#,
        )
        .unwrap();

        let skill =
            load_skill_from_file("user:chinese-workflow", &skill_file, SkillSource::User).unwrap();

        assert_eq!(skill.display_name, "中文工作流");
        assert_eq!(skill.execution_mode, SkillExecutionMode::Workflow);

        let workflow = skill.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 2);
        assert_eq!(workflow.steps[0].id, "分析步骤");
        assert_eq!(workflow.steps[0].name, "代码分析");
        assert_eq!(workflow.steps[1].dependencies, vec!["分析步骤"]);
        assert_eq!(workflow.max_retries, 3);
        assert!(!workflow.continue_on_failure);
    }

    #[test]
    fn test_load_skill_workflow_preserves_prompt_whitespace() {
        // 测试多行 prompt 的空白保留
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("multiline-prompt");
        fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        fs::write(
            &skill_file,
            r#"---
name: multiline-prompt-skill
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 多行提示
      prompt: |
        这是第一行
        这是第二行
        变量：${user_input}
      output: result
---

Content
"#,
        )
        .unwrap();

        let skill =
            load_skill_from_file("user:multiline-prompt", &skill_file, SkillSource::User).unwrap();

        let workflow = skill.workflow.unwrap();
        let prompt = &workflow.steps[0].prompt;

        // 验证多行内容被保留
        assert!(prompt.contains("这是第一行"));
        assert!(prompt.contains("这是第二行"));
        assert!(prompt.contains("${user_input}"));
    }

    #[test]
    fn test_parse_workflow_max_retries_zero() {
        // 测试 max_retries = 0 的边界情况
        let content = r#"---
name: no-retry-workflow
execution-mode: workflow
workflow:
  steps:
    - id: step1
      name: 步骤
      prompt: "执行"
      output: result
  max_retries: 0
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.max_retries, 0);
    }

    #[test]
    fn test_parse_workflow_single_step_with_self_reference() {
        // 测试单步骤工作流（无依赖）
        let content = r#"---
name: single-step-workflow
execution-mode: workflow
workflow:
  steps:
    - id: only_step
      name: 唯一步骤
      prompt: "处理输入：${user_input}"
      output: final_output
---

Content
"#;
        let (fm, _) = parse_frontmatter(content);

        let workflow = fm.workflow.unwrap();
        assert_eq!(workflow.steps.len(), 1);
        assert_eq!(workflow.steps[0].id, "only_step");
        assert!(workflow.steps[0].dependencies.is_empty());
    }
}
