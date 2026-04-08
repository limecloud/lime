//! Integration tests for the Context Management Module
//!
//! These tests verify end-to-end functionality and module interactions
//! for the context management system.
//!
//! # Test Coverage
//!
//! - Token estimation across different content types
//! - Context window management with different models
//! - Message compression and summarization
//! - Cache control and eligibility
//! - Priority sorting and selection
//! - File mention resolution
//! - AGENTS.md parsing
//! - Full context manager workflow

use aster::context::{
    AgentsMdParser,
    CacheConfig,
    CacheController,
    CompressionConfig,
    // Types
    ContextConfig,
    ContextWindowManager,
    // Core components
    EnhancedContextManager,
    FileMentionResolver,
    MessageCompressor,
    MessagePriority,
    PrioritySorter,
    Summarizer,
    TokenEstimator,
    TokenUsage,
};
use aster::conversation::message::Message;
use std::fs;
use tempfile::TempDir;

// ============================================================================
// Integration Test: Full Context Manager Workflow
// ============================================================================

/// Test the complete workflow of the context manager:
/// 1. Create manager with configuration
/// 2. Set system prompt
/// 3. Add conversation turns
/// 4. Check token usage
/// 5. Export and import state
/// 6. Verify state consistency
#[test]
fn test_full_context_manager_workflow() {
    // Step 1: Create manager with custom configuration
    let config = ContextConfig {
        max_tokens: 10000,
        reserve_tokens: 2000,
        summarize_threshold: 0.7,
        keep_recent_messages: 5,
        enable_ai_summary: false,
        code_block_max_lines: 30,
        tool_output_max_chars: 1000,
        enable_incremental_compression: true,
    };
    let mut manager = EnhancedContextManager::new(config);

    // Step 2: Set system prompt
    manager.set_system_prompt("You are a helpful coding assistant.");
    assert_eq!(
        manager.system_prompt(),
        "You are a helpful coding assistant."
    );

    // Step 3: Add conversation turns
    for i in 0..3 {
        let user =
            Message::user().with_text(format!("Question {}: How do I implement feature {}?", i, i));
        let assistant = Message::assistant().with_text(format!(
            "Answer {}: Here's how to implement feature {}...",
            i, i
        ));
        let usage = TokenUsage::new(50 + i * 10, 100 + i * 20);
        manager.add_turn(user, assistant, Some(usage));
    }

    assert_eq!(manager.turn_count(), 3);

    // Step 4: Check token usage
    let used_tokens = manager.get_used_tokens();
    assert!(used_tokens > 0, "Should have used some tokens");

    let available_tokens = manager.get_available_tokens();
    assert!(available_tokens > 0, "Should have available tokens");

    let usage = manager.get_context_usage();
    assert!(
        usage.percentage > 0.0,
        "Usage percentage should be positive"
    );
    assert!(
        usage.percentage < 100.0,
        "Usage percentage should be less than 100%"
    );

    // Step 5: Export state
    let export = manager.export();
    assert_eq!(export.turns.len(), 3);
    assert_eq!(export.system_prompt, "You are a helpful coding assistant.");

    // Step 6: Import into new manager and verify consistency
    let mut new_manager = EnhancedContextManager::new(ContextConfig::default());
    new_manager.import(export);

    assert_eq!(new_manager.turn_count(), 3);
    assert_eq!(
        new_manager.system_prompt(),
        "You are a helpful coding assistant."
    );

    // Verify messages are consistent
    let original_messages = manager.get_messages();
    let imported_messages = new_manager.get_messages();
    assert_eq!(original_messages.len(), imported_messages.len());
}

// ============================================================================
// Integration Test: Token Estimation with Window Manager
// ============================================================================

/// Test that token estimation integrates correctly with window management
#[test]
fn test_token_estimation_with_window_manager() {
    // Create window manager for Claude model
    let mut window_manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");
    assert_eq!(window_manager.get_context_window_size(), 200_000);

    // Create messages and estimate tokens
    let messages = vec![
        Message::user().with_text("Hello, I need help with Rust programming."),
        Message::assistant()
            .with_text("I'd be happy to help! What would you like to know about Rust?"),
        Message::user().with_text("How do I implement a trait?"),
    ];

    let total_tokens = TokenEstimator::estimate_total_tokens(&messages);
    assert!(total_tokens > 0);

    // Record usage
    let usage = TokenUsage::new(total_tokens, 50);
    window_manager.record_usage(usage);

    // Verify tracking
    assert_eq!(window_manager.get_total_input_tokens(), total_tokens);
    assert!(window_manager.get_usage_percentage() > 0.0);
    assert!(!window_manager.is_near_limit(90.0));
}

// ============================================================================
// Integration Test: Compression Pipeline
// ============================================================================

/// Test the compression pipeline: code block compression -> message compression
#[test]
fn test_compression_pipeline() {
    // Create a message with a large code block
    let large_code = (0..100)
        .map(|i| format!("    let line_{} = {};", i, i))
        .collect::<Vec<_>>()
        .join("\n");

    let code_content = format!("Here's the code:\n```rust\n{}\n```", large_code);
    let message = Message::assistant().with_text(&code_content);

    // Estimate original tokens
    let original_tokens = TokenEstimator::estimate_message_tokens(&message);

    // Compress the message
    let config = CompressionConfig {
        code_block_max_lines: 30,
        tool_output_max_chars: 1000,
        file_content_max_chars: 500,
        enable_incremental: true,
    };
    let compressed = MessageCompressor::compress_message(&message, &config);

    // Estimate compressed tokens
    let compressed_tokens = TokenEstimator::estimate_message_tokens(&compressed);

    // Verify compression occurred
    assert!(
        compressed_tokens < original_tokens,
        "Compressed message should have fewer tokens: {} < {}",
        compressed_tokens,
        original_tokens
    );
}

// ============================================================================
// Integration Test: Priority Sorting with Budget Selection
// ============================================================================

/// Test priority sorting and budget-based selection
#[test]
fn test_priority_sorting_with_budget() {
    // Create messages with different characteristics
    let messages = vec![
        Message::user().with_text("[Summary] Previous conversation about file operations"),
        Message::user().with_text("First question"),
        Message::assistant().with_text("First answer"),
        Message::user().with_text("Second question"),
        Message::assistant().with_text("Second answer"),
        Message::user().with_text("Recent question"),
        Message::assistant().with_text("Recent answer"),
    ];

    // Sort by priority
    let prioritized = PrioritySorter::sort_by_priority_default(&messages);

    // Verify summary message has critical priority
    let summary_msg = prioritized.iter().find(|p| {
        if let Some(aster::conversation::message::MessageContent::Text(t)) =
            p.message.content.first()
        {
            return t.text.contains("[Summary]");
        }
        false
    });
    assert!(summary_msg.is_some());
    assert_eq!(summary_msg.unwrap().priority, MessagePriority::Critical);

    // Select within budget
    let budget = 100; // Small budget
    let selected = PrioritySorter::select_within_budget(&prioritized, budget);

    // Verify selection respects budget
    let total_tokens: usize = selected.iter().map(|p| p.tokens).sum();
    assert!(total_tokens <= budget);

    // Critical messages should be prioritized
    if !selected.is_empty() {
        assert!(selected[0].priority >= MessagePriority::High);
    }
}

// ============================================================================
// Integration Test: Cache Control with Token Estimation
// ============================================================================

/// Test cache control eligibility with token estimation
#[test]
fn test_cache_control_with_token_estimation() {
    // Create messages of varying sizes
    let short_message = Message::user().with_text("Hello");
    let long_message = Message::user().with_text("x".repeat(5000)); // ~1400 tokens

    let messages = vec![short_message.clone(), long_message.clone()];

    // Configure cache with token threshold
    let config = CacheConfig {
        min_tokens_for_cache: 1000,
        cache_system_prompt: true,
        cache_tool_definitions: true,
        cache_recent_messages: 5,
    };

    // Check eligibility
    let (_, cacheable_indices) = CacheController::add_cache_control(&messages, &config);

    // Short message should not be cacheable
    assert!(!CacheController::is_cacheable(&short_message, 1000));

    // Long message should be cacheable
    assert!(CacheController::is_cacheable(&long_message, 1000));

    // Verify only long message is in cacheable indices
    assert!(cacheable_indices.contains(&1)); // Index of long message
}

// ============================================================================
// Integration Test: File Mention with Context Manager
// ============================================================================

/// Test file mention resolution in a realistic scenario
#[tokio::test]
async fn test_file_mention_integration() {
    let temp_dir = TempDir::new().unwrap();

    // Create test files
    let main_rs = temp_dir.path().join("main.rs");
    fs::write(&main_rs, "fn main() { println!(\"Hello\"); }").unwrap();

    let lib_rs = temp_dir.path().join("lib.rs");
    fs::write(&lib_rs, "pub mod utils;").unwrap();

    // Create resolver
    let resolver = FileMentionResolver::new(temp_dir.path());

    // Resolve mentions
    let text = "Check @main.rs and @lib.rs for the implementation";
    let result = resolver.resolve_mentions(text).await.unwrap();

    // Verify files were resolved
    assert_eq!(result.files.len(), 2);

    // Verify content was included
    assert!(result.processed_text.contains("fn main()"));
    assert!(result.processed_text.contains("pub mod utils"));

    // Original mentions should be replaced
    assert!(!result.processed_text.contains("@main.rs"));
    assert!(!result.processed_text.contains("@lib.rs"));
}

// ============================================================================
// Integration Test: AGENTS.md with System Prompt
// ============================================================================

/// Test AGENTS.md parsing and injection into system prompt
#[tokio::test]
async fn test_agents_md_integration() {
    let temp_dir = TempDir::new().unwrap();

    // Create AGENTS.md
    let agents_content = r#"# Project Instructions

## Build Commands
- `cargo build` - Build the project
- `cargo test` - Run tests

## Code Style
- Use Rust 2021 edition
- Follow clippy recommendations
"#;
    let agents_path = temp_dir.path().join("AGENTS.md");
    fs::write(&agents_path, agents_content).unwrap();

    // Parse AGENTS.md
    let config = AgentsMdParser::parse(temp_dir.path()).await.unwrap();
    assert!(config.is_some());

    let config = config.unwrap();
    assert!(config.content.contains("Build Commands"));
    assert!(config.content.contains("cargo build"));

    // Inject into system prompt
    let base_prompt = "You are a helpful assistant.";
    let enhanced = AgentsMdParser::inject_to_system_prompt(base_prompt, temp_dir.path())
        .await
        .unwrap();

    assert!(enhanced.contains(base_prompt));
    assert!(enhanced.contains("Project Instructions"));
    assert!(enhanced.contains("cargo build"));
}

// ============================================================================
// Integration Test: Context Manager with Compression
// ============================================================================

/// Test context manager automatic compression behavior
#[tokio::test]
async fn test_context_manager_compression() {
    let config = ContextConfig {
        max_tokens: 500,
        reserve_tokens: 100,
        summarize_threshold: 0.5, // Trigger at 50%
        keep_recent_messages: 2,
        enable_ai_summary: false,
        code_block_max_lines: 20,
        tool_output_max_chars: 500,
        enable_incremental_compression: true,
    };
    let mut manager = EnhancedContextManager::new(config);

    // Add turns until we exceed threshold
    for i in 0..10 {
        let user = Message::user().with_text(format!("Question {}: {}", i, "x".repeat(50)));
        let assistant =
            Message::assistant().with_text(format!("Answer {}: {}", i, "y".repeat(100)));
        manager.add_turn(user, assistant, None);
    }

    // Force compression
    manager.compact().await.unwrap();

    // Verify some turns were summarized
    let details = manager.get_compression_details();
    assert!(
        details.summarized_turns > 0,
        "Some turns should be summarized"
    );
    assert!(details.recent_turns > 0, "Recent turns should be preserved");

    // Verify statistics
    let stats = manager.get_stats();
    assert!(stats.compression_count > 0 || stats.saved_tokens > 0);
}

// ============================================================================
// Integration Test: Multi-Language Token Estimation
// ============================================================================

/// Test token estimation accuracy across different content types
#[test]
fn test_multi_language_token_estimation() {
    // English text
    let english = "Hello, this is a test of the token estimation system.";
    let english_tokens = TokenEstimator::estimate_tokens(english);

    // Chinese text (should use ~2 chars/token)
    let chinese = "你好，这是一个测试。这个系统可以估算中文文本的令牌数量。";
    let chinese_tokens = TokenEstimator::estimate_tokens(chinese);

    // Code (should use ~3 chars/token)
    let code = r#"
fn main() {
    let x = 42;
    println!("Value: {}", x);
}
"#;
    let _code_tokens = TokenEstimator::estimate_tokens(code);

    // Verify different ratios are applied
    // Chinese should have more tokens per character
    let chinese_ratio = chinese.chars().count() as f64 / chinese_tokens as f64;
    let english_ratio = english.chars().count() as f64 / english_tokens as f64;

    // Chinese ratio should be lower (more tokens per char)
    assert!(
        chinese_ratio < english_ratio,
        "Chinese should have lower chars/token ratio: {} < {}",
        chinese_ratio,
        english_ratio
    );

    // Verify code detection
    assert!(TokenEstimator::is_code(code));
    assert!(!TokenEstimator::is_code(english));

    // Verify Asian char detection
    assert!(TokenEstimator::has_asian_chars(chinese));
    assert!(!TokenEstimator::has_asian_chars(english));
}

// ============================================================================
// Integration Test: Window Manager Model Switching
// ============================================================================

/// Test window manager behavior when switching models
#[test]
fn test_window_manager_model_switching() {
    let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

    // Record some usage
    manager.record_usage(TokenUsage::new(10000, 5000));

    // Verify initial state
    assert_eq!(manager.get_context_window_size(), 200_000);
    assert_eq!(manager.get_total_input_tokens(), 10000);

    // Switch to smaller model
    manager.update_model("gpt-4");

    // Context window should change
    assert_eq!(manager.get_context_window_size(), 8_192);

    // Usage should be preserved
    assert_eq!(manager.get_total_input_tokens(), 10000);

    // Usage percentage should increase (same usage, smaller window)
    let percentage = manager.get_usage_percentage();
    assert!(percentage > 100.0, "Should exceed 100% with smaller window");
}

// ============================================================================
// Integration Test: Summarizer with Token Budget
// ============================================================================

/// Test summarizer respects token budget when collecting turns
#[test]
fn test_summarizer_budget_collection() {
    use aster::context::ConversationTurn;

    // Create turns with known token estimates
    let mut turns = Vec::new();
    for i in 0..5 {
        let user = Message::user().with_text(format!("Question {}", i));
        let assistant = Message::assistant().with_text(format!("Answer {}", i));
        let token_estimate = 100; // Fixed estimate for testing
        let mut turn = ConversationTurn::new(user, assistant, token_estimate);
        turn.original_tokens = token_estimate;
        turns.push(turn);
    }

    // Collect with small budget (should only get some turns)
    let (collected, tokens_used) = Summarizer::collect_within_budget(&turns, 250);

    assert_eq!(collected.len(), 2); // 2 turns * 100 tokens = 200 < 250
    assert!(tokens_used <= 250);

    // Collect with large budget (should get all turns)
    let (collected_all, _) = Summarizer::collect_within_budget(&turns, 10000);
    assert_eq!(collected_all.len(), 5);
}

// ============================================================================
// Integration Test: End-to-End Message Flow
// ============================================================================

/// Test complete message flow through the system
#[test]
fn test_end_to_end_message_flow() {
    // 1. Create context manager
    let mut manager = EnhancedContextManager::new(ContextConfig::default());
    manager.set_system_prompt("You are a coding assistant.");

    // 2. Add a turn with code content
    let code = r#"```rust
fn fibonacci(n: u64) -> u64 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}
```"#;
    let user = Message::user().with_text("How do I implement fibonacci?");
    let assistant =
        Message::assistant().with_text(format!("Here's a recursive implementation:\n{}", code));

    manager.add_turn(user, assistant, Some(TokenUsage::new(50, 100)));

    // 3. Get messages for API call
    let messages = manager.get_messages();
    assert!(messages.len() >= 3); // system + user + assistant

    // 4. Verify token estimation
    let total_tokens = TokenEstimator::estimate_total_tokens(&messages);
    assert!(total_tokens > 0);

    // 5. Check context usage
    let usage = manager.get_context_usage();
    assert!(usage.used > 0);
    assert!(usage.available > 0);

    // 6. Get formatted report
    let report = manager.get_formatted_report();
    assert!(report.contains("Context Statistics"));
    assert!(report.contains("Total messages"));
}
