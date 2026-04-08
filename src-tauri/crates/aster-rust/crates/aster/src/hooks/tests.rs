//! Hooks 模块测试

use super::*;

#[test]
fn test_hook_event_display() {
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
fn test_hook_input_serialization() {
    let input = HookInput {
        event: Some(HookEvent::PreToolUse),
        tool_name: Some("Bash".to_string()),
        tool_input: Some(serde_json::json!({"command": "ls"})),
        session_id: Some("session-123".to_string()),
        ..Default::default()
    };

    let json = serde_json::to_string(&input).unwrap();
    let parsed: HookInput = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.event, Some(HookEvent::PreToolUse));
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
