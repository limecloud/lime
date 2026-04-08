//! prompt 模块测试

use super::*;
use std::collections::HashMap;
use std::path::PathBuf;

#[test]
fn test_estimate_tokens_empty() {
    assert_eq!(estimate_tokens(""), 0);
}

#[test]
fn test_estimate_tokens_english() {
    let text = "Hello world, this is a test.";
    let tokens = estimate_tokens(text);
    assert!(tokens > 0);
    assert!(tokens < text.len()); // tokens 应该少于字符数
}

#[test]
fn test_estimate_tokens_chinese() {
    let text = "你好世界，这是一个测试。";
    let tokens = estimate_tokens(text);
    assert!(tokens > 0);
    // 中文每个字符约 0.5 token
}

#[test]
fn test_estimate_tokens_code() {
    let text = "function test() { return 42; }";
    let tokens = estimate_tokens(text);
    assert!(tokens > 0);
}

#[test]
fn test_prompt_cache_basic() {
    let mut cache = PromptCache::new(None, None);

    let content = "test content";
    let hash_info = cache.set("key1".to_string(), content.to_string(), None);

    assert!(!hash_info.hash.is_empty());
    assert_eq!(hash_info.length, content.len());

    let result = cache.get("key1");
    assert!(result.is_some());

    let (cached_content, cached_hash) = result.unwrap();
    assert_eq!(cached_content, content);
    assert_eq!(cached_hash.hash, hash_info.hash);
}

#[test]
fn test_prompt_cache_miss() {
    let cache = PromptCache::new(None, None);
    assert!(cache.get("nonexistent").is_none());
}

#[test]
fn test_tool_guidelines_do_not_unconditionally_reference_resource_helpers() {
    assert!(!TOOL_GUIDELINES.contains("ListMcpResourcesTool"));
    assert!(!TOOL_GUIDELINES.contains("ReadMcpResourceTool"));
}

#[test]
fn test_prompt_cache_is_valid() {
    let mut cache = PromptCache::new(None, None);

    let hash_info = cache.set("key1".to_string(), "content".to_string(), None);

    assert!(cache.is_valid("key1", &hash_info.hash));
    assert!(!cache.is_valid("key1", "wrong_hash"));
    assert!(!cache.is_valid("nonexistent", &hash_info.hash));
}

#[test]
fn test_generate_cache_key() {
    let key = generate_cache_key(
        "/home/user/project",
        Some("claude-3"),
        Some("default"),
        false,
    );
    assert!(key.contains("/home/user/project"));
    assert!(key.contains("claude-3"));
    assert!(key.contains("default"));
    assert!(key.contains("normal"));

    let key_plan = generate_cache_key("/home/user/project", None, None, true);
    assert!(key_plan.contains("plan"));
}

#[test]
fn test_cache_stats() {
    let mut cache = PromptCache::new(None, None);

    cache.set("key1".to_string(), "content1".to_string(), None);
    cache.set("key2".to_string(), "content2".to_string(), None);

    let stats = cache.get_stats();
    assert_eq!(stats.size, 2);
    assert!(stats.total_bytes > 0);
}

#[test]
fn test_prompt_context_default() {
    let context = PromptContext::default();
    assert!(!context.debug);
    assert!(!context.plan_mode);
    assert!(!context.delegate_mode);
    assert!(!context.is_git_repo);
}

#[test]
fn test_system_prompt_options_default() {
    let opts = SystemPromptOptions::default();
    assert!(opts.include_identity);
    assert!(opts.include_tool_guidelines);
    assert!(opts.include_permission_mode);
    assert!(opts.include_agents_md);
    assert!(opts.include_ide_info);
    assert!(opts.include_diagnostics);
    assert_eq!(opts.max_tokens, 180000);
    assert!(opts.enable_cache);
}

#[test]
fn test_prompt_too_long_error() {
    let err = PromptTooLongError::new(200000, 180000);
    assert_eq!(err.estimated_tokens, 200000);
    assert_eq!(err.max_tokens, 180000);
    assert!(err.message.contains("200000"));
    assert!(err.message.contains("180000"));
}

#[test]
fn test_attachment_type_serialize() {
    let att = Attachment {
        attachment_type: AttachmentType::AgentsMd,
        content: "test".to_string(),
        label: Some("Test".to_string()),
        priority: Some(10),
        compute_time_ms: Some(5),
    };

    let json = serde_json::to_string(&att).unwrap();
    assert!(json.contains("agents_md"));
}

#[test]
fn test_permission_mode_description() {
    assert!(get_permission_mode_description("default").contains("Default"));
    assert!(get_permission_mode_description("plan").contains("Plan"));
    assert!(get_permission_mode_description("bypass").contains("Bypass"));
    assert!(get_permission_mode_description("delegate").contains("Delegate"));
}

#[test]
fn test_get_environment_info() {
    let info = EnvironmentInfo {
        working_dir: "/home/user/project",
        is_git_repo: true,
        platform: "linux",
        today_date: "2024-01-15",
        model: Some("claude-3"),
    };

    let result = get_environment_info(&info);
    assert!(result.contains("<environment>"));
    assert!(result.contains("/home/user/project"));
    assert!(result.contains("linux"));
    assert!(result.contains("claude-3"));
    assert!(result.contains("</environment>"));
}

#[test]
fn test_get_ide_info() {
    let files = vec!["file1.rs".to_string(), "file2.rs".to_string()];
    let result = get_ide_info(Some(IdeType::Vscode), Some("selected code"), Some(&files));

    assert!(result.contains("<ide-info>"));
    assert!(result.contains("Vscode"));
    assert!(result.contains("selected code"));
    assert!(result.contains("file1.rs"));
    assert!(result.contains("</ide-info>"));
}

#[test]
fn test_get_diagnostics_info() {
    let diagnostics = vec![DiagnosticInfo {
        file: "test.rs".to_string(),
        line: 10,
        column: 5,
        severity: DiagnosticSeverity::Error,
        message: "undefined variable".to_string(),
        source: None,
    }];

    let result = get_diagnostics_info(&diagnostics);
    assert!(result.is_some());

    let content = result.unwrap();
    assert!(content.contains("<diagnostics>"));
    assert!(content.contains("ERROR"));
    assert!(content.contains("test.rs:10:5"));
    assert!(content.contains("undefined variable"));
}

#[test]
fn test_get_diagnostics_info_empty() {
    let result = get_diagnostics_info(&[]);
    assert!(result.is_none());
}

#[test]
fn test_get_git_status_info() {
    let status = GitStatusInfo {
        branch: "main".to_string(),
        is_clean: false,
        staged: vec!["file1.rs".to_string()],
        unstaged: vec!["file2.rs".to_string()],
        untracked: vec!["file3.rs".to_string()],
        ahead: 2,
        behind: 1,
    };

    let result = get_git_status_info(&status);
    assert!(result.contains("<git-status>"));
    assert!(result.contains("main"));
    assert!(result.contains("Ahead: 2"));
    assert!(result.contains("file1.rs"));
    assert!(result.contains("</git-status>"));
}

#[test]
fn test_get_memory_info() {
    let mut memory = HashMap::new();
    memory.insert("key1".to_string(), "value1".to_string());
    memory.insert("key2".to_string(), "value2".to_string());

    let result = get_memory_info(&memory);
    assert!(result.is_some());

    let content = result.unwrap();
    assert!(content.contains("<memory>"));
    assert!(content.contains("</memory>"));
}

#[test]
fn test_get_memory_info_empty() {
    let memory: HashMap<String, String> = HashMap::new();
    let result = get_memory_info(&memory);
    assert!(result.is_none());
}

#[test]
fn test_get_todo_list_info() {
    let todos = vec![
        TodoItem {
            content: "Task 1".to_string(),
            status: TodoStatus::Completed,
            active_form: "done".to_string(),
        },
        TodoItem {
            content: "Task 2".to_string(),
            status: TodoStatus::InProgress,
            active_form: "working".to_string(),
        },
        TodoItem {
            content: "Task 3".to_string(),
            status: TodoStatus::Pending,
            active_form: "todo".to_string(),
        },
    ];

    let result = get_todo_list_info(&todos);
    assert!(result.is_some());

    let content = result.unwrap();
    assert!(content.contains("[x] Task 1"));
    assert!(content.contains("[~] Task 2"));
    assert!(content.contains("[ ] Task 3"));
}

#[test]
fn test_attachment_manager_default() {
    let manager = AttachmentManager::default();
    let context = PromptContext {
        working_dir: PathBuf::from("/tmp/test"),
        ..Default::default()
    };

    let attachments = manager.generate_attachments(&context);
    // 没有特殊上下文时，附件应该很少
    assert!(attachments.len() <= 2);
}

#[test]
fn test_system_prompt_builder_basic() {
    let mut builder = SystemPromptBuilder::new(false);
    let context = PromptContext {
        working_dir: PathBuf::from("/tmp/test"),
        platform: Some("linux".to_string()),
        today_date: Some("2024-01-15".to_string()),
        ..Default::default()
    };

    let result = builder.build(&context, None);
    assert!(result.is_ok());

    let build_result = result.unwrap();
    assert!(!build_result.content.is_empty());
    assert!(!build_result.hash_info.hash.is_empty());
    assert!(build_result.hash_info.estimated_tokens > 0);
}

#[test]
fn test_system_prompt_builder_with_options() {
    let mut builder = SystemPromptBuilder::new(false);
    let context = PromptContext {
        working_dir: PathBuf::from("/tmp/test"),
        permission_mode: Some(PermissionMode::Plan),
        plan_mode: true,
        ..Default::default()
    };

    let options = SystemPromptOptions {
        include_identity: true,
        include_permission_mode: true,
        enable_cache: false,
        ..Default::default()
    };

    let result = builder.build(&context, Some(options));
    assert!(result.is_ok());

    let build_result = result.unwrap();
    assert!(build_result.content.contains("Plan"));
}

#[test]
fn test_system_prompt_builder_preview() {
    let builder = SystemPromptBuilder::new(false);

    let short = "Hello world";
    assert_eq!(builder.preview(short, 100), short);

    let long = "a".repeat(200);
    let preview = builder.preview(&long, 50);
    assert!(preview.contains("truncated"));
    assert!(preview.contains("200 chars"));
}
