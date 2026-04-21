//! Hooks 模块测试

use super::*;
use std::fs;
use std::sync::Arc;

#[test]
fn test_hook_event_display() {
    assert_eq!(HookEvent::TaskCreated.to_string(), "TaskCreated");
    assert_eq!(HookEvent::TaskCompleted.to_string(), "TaskCompleted");
    assert_eq!(HookEvent::PreToolUse.to_string(), "PreToolUse");
    assert_eq!(HookEvent::PostToolUse.to_string(), "PostToolUse");
    assert_eq!(HookEvent::SessionStart.to_string(), "SessionStart");
}

#[test]
fn test_hook_result_success() {
    let result = HookResult::success(Some("output".to_string()));
    assert!(result.success);
    assert_eq!(result.output, Some("output".to_string()));
    assert!(!result.blocked);
}

#[test]
fn test_hook_result_failure() {
    let result = HookResult::failure("error".to_string());
    assert!(!result.success);
    assert_eq!(result.error, Some("error".to_string()));
}

#[test]
fn test_hook_result_blocked() {
    let result = HookResult::blocked("blocked message".to_string());
    assert!(!result.success);
    assert!(result.blocked);
    assert_eq!(result.block_message, Some("blocked message".to_string()));
}

#[test]
fn test_hook_registry() {
    let registry = HookRegistry::new();

    let config = HookConfig::Command(CommandHookConfig {
        command: "echo test".to_string(),
        args: vec![],
        env: std::collections::HashMap::new(),
        timeout: 30000,
        blocking: true,
        matcher: None,
    });

    registry.register(HookEvent::PreToolUse, config.clone());
    assert_eq!(registry.count(), 1);
    assert_eq!(registry.count_for_event(HookEvent::PreToolUse), 1);

    let hooks = registry.get_for_event(HookEvent::PreToolUse);
    assert_eq!(hooks.len(), 1);

    registry.clear();
    assert_eq!(registry.count(), 0);
}

#[test]
fn test_hook_matcher() {
    let registry = HookRegistry::new();

    let config = HookConfig::Command(CommandHookConfig {
        command: "echo test".to_string(),
        args: vec![],
        env: std::collections::HashMap::new(),
        timeout: 30000,
        blocking: true,
        matcher: Some("Bash".to_string()),
    });

    registry.register(HookEvent::PreToolUse, config);

    // 精确匹配
    let hooks = registry.get_matching(HookEvent::PreToolUse, Some("Bash"));
    assert_eq!(hooks.len(), 1);

    // 不匹配
    let hooks = registry.get_matching(HookEvent::PreToolUse, Some("Read"));
    assert_eq!(hooks.len(), 0);
}

#[test]
fn test_hook_regex_matcher() {
    let registry = HookRegistry::new();

    let config = HookConfig::Command(CommandHookConfig {
        command: "echo test".to_string(),
        args: vec![],
        env: std::collections::HashMap::new(),
        timeout: 30000,
        blocking: true,
        matcher: Some("/^(Edit|Write)$/".to_string()),
    });

    registry.register(HookEvent::PreToolUse, config);

    // 正则匹配
    let hooks = registry.get_matching(HookEvent::PreToolUse, Some("Edit"));
    assert_eq!(hooks.len(), 1);

    let hooks = registry.get_matching(HookEvent::PreToolUse, Some("Write"));
    assert_eq!(hooks.len(), 1);

    let hooks = registry.get_matching(HookEvent::PreToolUse, Some("Read"));
    assert_eq!(hooks.len(), 0);
}

#[test]
fn test_hook_config_serialization() {
    let config = HookConfig::Command(CommandHookConfig {
        command: "echo test".to_string(),
        args: vec!["arg1".to_string()],
        env: std::collections::HashMap::new(),
        timeout: 30000,
        blocking: true,
        matcher: Some("Bash".to_string()),
    });

    let json = serde_json::to_string(&config).unwrap();
    let parsed: HookConfig = serde_json::from_str(&json).unwrap();

    match parsed {
        HookConfig::Command(c) => {
            assert_eq!(c.command, "echo test");
            assert_eq!(c.args, vec!["arg1"]);
        }
        _ => panic!("Expected Command config"),
    }
}

#[test]
fn test_frontmatter_command_hook_converts_to_current_config() {
    let hook: FrontmatterHookCommand = serde_json::from_value(serde_json::json!({
        "type": "command",
        "command": "echo session",
        "timeout": 5,
        "once": true,
        "async": true
    }))
    .expect("frontmatter command hook should deserialize");

    let registration = hook
        .to_registration(Some("Bash"))
        .expect("frontmatter command hook should convert");

    assert!(registration.once);
    match registration.config {
        HookConfig::Command(config) => {
            assert_eq!(config.command, "echo session");
            assert_eq!(config.timeout, 5000);
            assert!(!config.blocking);
            assert_eq!(config.matcher.as_deref(), Some("Bash"));
        }
        _ => panic!("Expected Command config"),
    }
}

#[test]
fn test_frontmatter_hook_rejects_if_condition_until_runtime_supports_it() {
    let hook: FrontmatterHookCommand = serde_json::from_value(serde_json::json!({
        "type": "prompt",
        "prompt": "Verify",
        "if": "Bash(git status)"
    }))
    .expect("frontmatter prompt hook should deserialize");

    let error = hook
        .to_registration(Some("Bash"))
        .expect_err("frontmatter hook.if should remain unsupported for now");

    assert!(error.contains("hook.if"));
}

#[test]
fn test_agent_hook_config_supports_current_prompt_fields() {
    let parsed: HookConfig = serde_json::from_value(serde_json::json!({
        "type": "agent",
        "prompt": "Verify tests passed",
        "model": "gpt-5.4",
        "timeout": 60000,
        "blocking": true
    }))
    .expect("agent hook config should deserialize");

    match parsed {
        HookConfig::Agent(config) => {
            assert_eq!(config.prompt.as_deref(), Some("Verify tests passed"));
            assert_eq!(config.model.as_deref(), Some("gpt-5.4"));
            assert_eq!(config.agent_type, "verifier");
        }
        _ => panic!("Expected Agent config"),
    }
}

#[test]
fn test_agent_hook_config_keeps_compat_agent_config_fields() {
    let parsed: HookConfig = serde_json::from_value(serde_json::json!({
        "type": "agent",
        "agent_type": "compat-agent",
        "agent_config": {
            "prompt": "Verify via compat config",
            "model": "gpt-4o"
        }
    }))
    .expect("compat agent hook config should deserialize");

    match parsed {
        HookConfig::Agent(config) => {
            assert_eq!(config.agent_type, "compat-agent");
            assert_eq!(
                config.agent_config,
                Some(serde_json::json!({
                    "prompt": "Verify via compat config",
                    "model": "gpt-4o"
                }))
            );
        }
        _ => panic!("Expected Agent config"),
    }
}

#[test]
fn test_hook_input_serialization() {
    let input = HookInput {
        event: Some(HookEvent::PreToolUse),
        task_id: Some("1".to_string()),
        task_subject: Some("整理任务板".to_string()),
        teammate_name: Some("researcher".to_string()),
        team_name: Some("alpha".to_string()),
        tool_name: Some("Bash".to_string()),
        tool_input: Some(serde_json::json!({"command": "ls"})),
        session_id: Some("session-123".to_string()),
        ..Default::default()
    };

    let json = serde_json::to_string(&input).unwrap();
    let parsed: HookInput = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.event, Some(HookEvent::PreToolUse));
    assert_eq!(parsed.task_id, Some("1".to_string()));
    assert_eq!(parsed.tool_name, Some("Bash".to_string()));
}

#[test]
fn test_is_blocked() {
    let results = vec![
        HookResult::success(None),
        HookResult::success(Some("output".to_string())),
    ];
    let (blocked, _) = is_blocked(&results);
    assert!(!blocked);

    let results = vec![
        HookResult::success(None),
        HookResult::blocked("blocked".to_string()),
    ];
    let (blocked, message) = is_blocked(&results);
    assert!(blocked);
    assert_eq!(message, Some("blocked".to_string()));
}

#[test]
fn test_legacy_hook_conversion() {
    let legacy = LegacyHookConfig {
        event: HookEvent::PreToolUse,
        matcher: Some("Bash".to_string()),
        command: "echo test".to_string(),
        args: vec![],
        timeout: 30000,
        env: std::collections::HashMap::new(),
        blocking: true,
    };

    let (event, config) = legacy.into();
    assert_eq!(event, HookEvent::PreToolUse);

    match config {
        HookConfig::Command(c) => {
            assert_eq!(c.command, "echo test");
            assert_eq!(c.matcher, Some("Bash".to_string()));
        }
        _ => panic!("Expected Command config"),
    }
}

#[tokio::test]
async fn test_session_frontmatter_once_hook_is_removed_after_success() {
    clear_session_hooks("session-once-hook");
    let hooks: FrontmatterHooks = serde_yaml::from_str(
        r#"
PreToolUse:
  - matcher: Bash
    hooks:
      - type: command
        command: "printf 'ok'"
        once: true
"#,
    )
    .expect("frontmatter hooks should parse");

    let report = register_session_frontmatter_hooks("session-once-hook", &hooks);
    assert_eq!(report.registered, 1);
    assert!(report.skipped.is_empty());
    assert_eq!(get_session_hook_count("session-once-hook"), 1);

    let registry = Arc::new(HookRegistry::new());
    let results = run_hooks_with_registry(
        HookInput {
            event: Some(HookEvent::PreToolUse),
            tool_name: Some("Bash".to_string()),
            session_id: Some("session-once-hook".to_string()),
            ..Default::default()
        },
        &registry,
    )
    .await;

    assert_eq!(results.len(), 1);
    assert!(results[0].success);
    assert_eq!(get_session_hook_count("session-once-hook"), 0);
    clear_session_hooks("session-once-hook");
}

#[test]
fn test_agent_frontmatter_hooks_rewrite_stop_to_subagent_stop() {
    clear_session_hooks("session-agent-hook");
    let hooks: FrontmatterHooks = serde_yaml::from_str(
        r#"
Stop:
  - hooks:
      - type: prompt
        prompt: "summarize stop"
"#,
    )
    .expect("frontmatter hooks should parse");

    let report = register_agent_session_frontmatter_hooks("session-agent-hook", &hooks);

    assert_eq!(report.registered, 1);
    assert!(report.skipped.is_empty());
    assert!(get_matching_session_hooks("session-agent-hook", HookEvent::Stop, None).is_empty());
    assert_eq!(
        get_matching_session_hooks("session-agent-hook", HookEvent::SubagentStop, None).len(),
        1
    );

    clear_session_hooks("session-agent-hook");
}

#[tokio::test]
async fn test_run_user_prompt_submit_hooks_with_registry_blocks_project_hook() {
    let temp_dir = tempfile::TempDir::new().expect("create temp dir");
    let claude_dir = temp_dir.path().join(".claude");
    fs::create_dir_all(&claude_dir).expect("create .claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        r#"{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "printf '%s' '{\"blocked\":true,\"message\":\"project hook blocked\"}'; exit 2",
        "blocking": true
      }
    ]
  }
}
"#,
    )
    .expect("write settings.json");

    let registry = Arc::new(HookRegistry::new());
    load_project_hooks_to_registry(temp_dir.path(), &registry)
        .expect("load project hooks to registry");

    assert_eq!(registry.count_for_event(HookEvent::UserPromptSubmit), 1);

    let (allowed, message) = run_user_prompt_submit_hooks_with_registry(
        "请继续提交",
        Some("session-hook-test".to_string()),
        &registry,
    )
    .await;

    assert!(!allowed);
    assert_eq!(message.as_deref(), Some("project hook blocked"));
}
