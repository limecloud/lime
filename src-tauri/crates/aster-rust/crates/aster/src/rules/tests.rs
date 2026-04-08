//! rules 模块测试

use super::*;

#[test]
fn test_project_rules_default() {
    let rules = ProjectRules::default();
    assert!(rules.instructions.is_none());
    assert!(rules.allowed_tools.is_none());
    assert!(rules.custom_rules.is_none());
}

#[test]
fn test_rule_action_default() {
    let action = RuleAction::default();
    assert_eq!(action, RuleAction::Warn);
}

#[test]
fn test_custom_rule_serialize() {
    let rule = CustomRule {
        name: "test-rule".to_string(),
        pattern: Some(r"console\.log".to_string()),
        action: RuleAction::Deny,
        message: Some("No console.log".to_string()),
        transform: None,
    };

    let json = serde_json::to_string(&rule).unwrap();
    assert!(json.contains("test-rule"));
    assert!(json.contains("deny"));

    let parsed: CustomRule = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.name, "test-rule");
    assert_eq!(parsed.action, RuleAction::Deny);
}

#[test]
fn test_parse_agents_md_content() {
    let content = r#"# Project Instructions

This is the main instruction.

## Guidelines

- Use Rust
- Write tests

## Memory

- **Language**: Rust
- **Framework**: Actix
"#;

    // 写入临时文件
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join("test_agents.md");
    std::fs::write(&temp_file, content).unwrap();

    let sections = parse_agents_md(&temp_file);
    assert!(!sections.is_empty());

    // 清理
    let _ = std::fs::remove_file(&temp_file);
}

#[test]
fn test_extract_rules_from_sections() {
    let sections = vec![
        AgentsMdSection {
            title: "Instructions".to_string(),
            content: "Follow these rules".to_string(),
            level: 0,
        },
        AgentsMdSection {
            title: "Allowed Tools".to_string(),
            content: "- Read\n- Write\n- Edit".to_string(),
            level: 2,
        },
        AgentsMdSection {
            title: "Memory".to_string(),
            content: "- **Language**: Rust\n- **Type**: CLI".to_string(),
            level: 2,
        },
    ];

    let rules = extract_rules(&sections);

    assert!(rules.instructions.is_some());
    assert!(rules.instructions.unwrap().contains("Follow these rules"));

    assert!(rules.allowed_tools.is_some());
    let tools = rules.allowed_tools.unwrap();
    assert_eq!(tools.len(), 3);
    assert!(tools.contains(&"Read".to_string()));

    assert!(rules.memory.is_some());
    let memory = rules.memory.unwrap();
    assert_eq!(memory.get("Language"), Some(&"Rust".to_string()));
}

#[test]
fn test_apply_rules_deny() {
    let rules = vec![CustomRule {
        name: "no-console".to_string(),
        pattern: Some(r"console\.log".to_string()),
        action: RuleAction::Deny,
        message: Some("No console.log allowed".to_string()),
        transform: None,
    }];

    let content = "console.log('test');";
    let result = apply_rules(content, &rules);

    assert!(result.blocked);
    assert!(!result.warnings.is_empty());
    assert!(result.warnings[0].contains("no-console"));
}

#[test]
fn test_apply_rules_warn() {
    let rules = vec![CustomRule {
        name: "todo-check".to_string(),
        pattern: Some(r"TODO".to_string()),
        action: RuleAction::Warn,
        message: Some("Found TODO comment".to_string()),
        transform: None,
    }];

    let content = "// TODO: fix this";
    let result = apply_rules(content, &rules);

    assert!(!result.blocked);
    assert!(!result.warnings.is_empty());
    assert!(result.warnings[0].contains("TODO"));
}

#[test]
fn test_apply_rules_transform() {
    let rules = vec![CustomRule {
        name: "replace-foo".to_string(),
        pattern: Some(r"foo".to_string()),
        action: RuleAction::Transform,
        message: None,
        transform: Some("bar".to_string()),
    }];

    let content = "foo bar foo";
    let result = apply_rules(content, &rules);

    assert!(!result.blocked);
    assert_eq!(result.result, "bar bar bar");
}

#[test]
fn test_apply_rules_allow() {
    let rules = vec![CustomRule {
        name: "allow-all".to_string(),
        pattern: Some(r".*".to_string()),
        action: RuleAction::Allow,
        message: None,
        transform: None,
    }];

    let content = "anything goes";
    let result = apply_rules(content, &rules);

    assert!(!result.blocked);
    assert!(result.warnings.is_empty());
    assert_eq!(result.result, content);
}

#[test]
fn test_generate_system_prompt_addition() {
    let mut memory = std::collections::HashMap::new();
    memory.insert("Language".to_string(), "Rust".to_string());

    let rules = ProjectRules {
        instructions: Some("Follow coding standards".to_string()),
        memory: Some(memory),
        custom_rules: Some(vec![CustomRule {
            name: "test-rule".to_string(),
            pattern: None,
            action: RuleAction::Warn,
            message: Some("Test message".to_string()),
            transform: None,
        }]),
        ..Default::default()
    };

    let prompt = generate_system_prompt_addition(&rules);

    assert!(prompt.contains("Project Instructions"));
    assert!(prompt.contains("Follow coding standards"));
    assert!(prompt.contains("Project Context"));
    assert!(prompt.contains("Language"));
    assert!(prompt.contains("Custom Rules"));
    assert!(prompt.contains("test-rule"));
}

#[test]
fn test_create_agents_md_template() {
    let template = create_agents_md_template();

    assert!(template.contains("# Project Instructions"));
    assert!(template.contains("## Guidelines"));
    assert!(template.contains("## Memory"));
    assert!(template.contains("## Allowed Tools"));
    assert!(template.contains("## Rules"));
}

#[test]
fn test_project_rules_serialize() {
    let rules = ProjectRules {
        instructions: Some("Test instructions".to_string()),
        allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
        permission_mode: Some("default".to_string()),
        ..Default::default()
    };

    let json = serde_json::to_string(&rules).unwrap();
    assert!(json.contains("Test instructions"));
    assert!(json.contains("Read"));

    let parsed: ProjectRules = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.instructions, Some("Test instructions".to_string()));
}

#[test]
fn test_apply_rules_invalid_regex() {
    let rules = vec![CustomRule {
        name: "invalid".to_string(),
        pattern: Some(r"[invalid".to_string()), // 无效正则
        action: RuleAction::Deny,
        message: None,
        transform: None,
    }];

    let content = "test content";
    let result = apply_rules(content, &rules);

    // 应该跳过无效正则，不阻止
    assert!(!result.blocked);
    assert_eq!(result.result, content);
}

#[test]
fn test_apply_rules_no_pattern() {
    let rules = vec![CustomRule {
        name: "no-pattern".to_string(),
        pattern: None,
        action: RuleAction::Deny,
        message: None,
        transform: None,
    }];

    let content = "test content";
    let result = apply_rules(content, &rules);

    // 没有 pattern 应该跳过
    assert!(!result.blocked);
}
