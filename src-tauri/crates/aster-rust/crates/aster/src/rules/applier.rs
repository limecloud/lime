//! 规则应用器
//!
//! 应用自定义规则到内容

use regex::Regex;

use super::types::{CustomRule, ProjectRules, RuleAction, RuleApplyResult};

/// 应用自定义规则到内容
pub fn apply_rules(content: &str, rules: &[CustomRule]) -> RuleApplyResult {
    let mut result = content.to_string();
    let mut warnings = Vec::new();
    let mut blocked = false;

    for rule in rules {
        let pattern = match &rule.pattern {
            Some(p) => p,
            None => continue,
        };

        let regex = match Regex::new(pattern) {
            Ok(r) => r,
            Err(_) => continue, // 无效正则，跳过
        };

        if regex.is_match(content) {
            match rule.action {
                RuleAction::Deny => {
                    blocked = true;
                    warnings.push(format!(
                        "Blocked by rule \"{}\": {}",
                        rule.name,
                        rule.message.as_deref().unwrap_or("No message")
                    ));
                }
                RuleAction::Warn => {
                    warnings.push(format!(
                        "Warning from rule \"{}\": {}",
                        rule.name,
                        rule.message.as_deref().unwrap_or("No message")
                    ));
                }
                RuleAction::Transform => {
                    if let Some(ref transform) = rule.transform {
                        result = regex.replace_all(&result, transform.as_str()).to_string();
                    }
                }
                RuleAction::Allow => {
                    // 无需操作
                }
            }
        }
    }

    RuleApplyResult {
        result,
        warnings,
        blocked,
    }
}

/// 从规则生成系统提示词附加内容
pub fn generate_system_prompt_addition(rules: &ProjectRules) -> String {
    let mut parts = Vec::new();

    if let Some(ref instructions) = rules.instructions {
        parts.push("## Project Instructions\n".to_string());
        parts.push(instructions.clone());
        parts.push(String::new());
    }

    if let Some(ref memory) = rules.memory {
        if !memory.is_empty() {
            parts.push("## Project Context\n".to_string());
            for (key, value) in memory {
                parts.push(format!("- **{}**: {}", key, value));
            }
            parts.push(String::new());
        }
    }

    if let Some(ref custom_rules) = rules.custom_rules {
        if !custom_rules.is_empty() {
            parts.push("## Custom Rules\n".to_string());
            for rule in custom_rules {
                parts.push(format!(
                    "- **{}** ({:?}): {}",
                    rule.name,
                    rule.action,
                    rule.message.as_deref().unwrap_or("No description")
                ));
            }
            parts.push(String::new());
        }
    }

    parts.join("\n")
}

/// 创建默认 AGENTS.md 模板
pub fn create_agents_md_template() -> String {
    r#"# Project Instructions

Add your project-specific instructions here. The agent will follow these when working on your codebase.

## Guidelines

- Describe your coding style preferences
- List important conventions
- Mention key architecture decisions

## Memory

- **Project Type**: (e.g., Web App, CLI Tool, Library)
- **Language**: (e.g., TypeScript, Python, Rust)
- **Framework**: (e.g., React, Express, Actix)

## Allowed Tools

- Read
- Write
- Edit
- Bash
- Glob
- Grep

## Rules

- **No Console Logs**: Avoid adding console.log statements in production code
- **Test Coverage**: All new features should include tests
"#
    .to_string()
}

/// 在目录中初始化 AGENTS.md
pub fn init_agents_md(dir: Option<&std::path::Path>) -> Result<std::path::PathBuf, String> {
    let target_dir = dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let file_path = target_dir.join("AGENTS.md");

    if file_path.exists() {
        return Err("AGENTS.md already exists".to_string());
    }

    let template = create_agents_md_template();
    std::fs::write(&file_path, template).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path)
}
