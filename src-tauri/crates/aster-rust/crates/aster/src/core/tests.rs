//! Core 模块测试

use super::*;

// ============ Background Tasks Tests ============

#[test]
fn test_task_status() {
    assert_eq!(
        serde_json::to_string(&TaskStatus::Running).unwrap(),
        "\"running\""
    );
    assert_eq!(
        serde_json::to_string(&TaskStatus::Completed).unwrap(),
        "\"completed\""
    );
    assert_eq!(
        serde_json::to_string(&TaskStatus::Failed).unwrap(),
        "\"failed\""
    );
}

#[test]
fn test_task_stats_default() {
    let stats = TaskStats::default();
    assert_eq!(stats.total, 0);
    assert_eq!(stats.running, 0);
    assert_eq!(stats.completed, 0);
    assert_eq!(stats.failed, 0);
}

#[test]
fn test_background_task_manager() {
    let manager = BackgroundTaskManager::new();

    // 创建任务
    let task = manager.create_task("test input");
    assert_eq!(task.status, TaskStatus::Running);
    assert_eq!(task.user_input, "test input");
    assert!(!task.cancelled);

    // 获取任务
    let retrieved = manager.get_task(&task.id);
    assert!(retrieved.is_some());

    // 追加文本
    manager.append_text(&task.id, "output text");
    let updated = manager.get_task(&task.id).unwrap();
    assert!(updated.text_output.contains("output text"));

    // 完成任务
    manager.complete_task(&task.id, true, None);
    let completed = manager.get_task(&task.id).unwrap();
    assert_eq!(completed.status, TaskStatus::Completed);
    assert!(completed.end_time.is_some());
}

#[test]
fn test_task_cancel() {
    let manager = BackgroundTaskManager::new();
    let task = manager.create_task("test");

    assert!(manager.cancel_task(&task.id));

    let cancelled = manager.get_task(&task.id).unwrap();
    assert!(cancelled.cancelled);
    assert_eq!(cancelled.status, TaskStatus::Failed);
}

#[test]
fn test_task_summaries() {
    let manager = BackgroundTaskManager::new();
    manager.create_task("task 1");
    manager.create_task("task 2");

    let summaries = manager.get_task_summaries();
    assert_eq!(summaries.len(), 2);
}

#[test]
fn test_task_stats() {
    let manager = BackgroundTaskManager::new();
    let task1 = manager.create_task("task 1");
    let task2 = manager.create_task("task 2");

    manager.complete_task(&task1.id, true, None);
    manager.complete_task(&task2.id, false, Some("error".to_string()));

    let stats = manager.get_stats();
    assert_eq!(stats.total, 2);
    assert_eq!(stats.running, 0);
    assert_eq!(stats.completed, 1);
    assert_eq!(stats.failed, 1);
}

// ============ Retry Logic Tests ============

#[test]
fn test_parse_context_overflow_error() {
    let message = "input length and `max_tokens` exceed context limit: 195000 + 8192 > 200000";
    let result = parse_context_overflow_error(400, message);

    assert!(result.is_some());
    let overflow = result.unwrap();
    assert_eq!(overflow.input_tokens, 195000);
    assert_eq!(overflow.max_tokens, 8192);
    assert_eq!(overflow.context_limit, 200000);
}

#[test]
fn test_parse_context_overflow_error_wrong_status() {
    let message = "input length and `max_tokens` exceed context limit: 195000 + 8192 > 200000";
    let result = parse_context_overflow_error(500, message);
    assert!(result.is_none());
}

#[test]
fn test_parse_context_overflow_error_wrong_message() {
    let message = "some other error";
    let result = parse_context_overflow_error(400, message);
    assert!(result.is_none());
}

#[test]
fn test_calculate_adjusted_max_tokens() {
    let overflow = ContextOverflowError {
        input_tokens: 195000,
        max_tokens: 8192,
        context_limit: 200000,
    };

    let adjusted = calculate_adjusted_max_tokens(&overflow, 0);
    assert!(adjusted.is_some());
    let value = adjusted.unwrap();
    // 200000 - 195000 - 1000 = 4000, which is > MIN_OUTPUT_TOKENS (3000)
    assert!(value >= 3000);
}

#[test]
fn test_calculate_adjusted_max_tokens_cannot_recover() {
    let overflow = ContextOverflowError {
        input_tokens: 199000,
        max_tokens: 8192,
        context_limit: 200000,
    };

    // 200000 - 199000 - 1000 = 0, which is < MIN_OUTPUT_TOKENS
    let adjusted = calculate_adjusted_max_tokens(&overflow, 0);
    assert!(adjusted.is_none());
}

#[test]
fn test_calculate_adjusted_max_tokens_with_thinking() {
    let overflow = ContextOverflowError {
        input_tokens: 180000,
        max_tokens: 8192,
        context_limit: 200000,
    };

    let adjusted = calculate_adjusted_max_tokens(&overflow, 5000);
    assert!(adjusted.is_some());
    let value = adjusted.unwrap();
    // Should be at least max_thinking_tokens + 1
    assert!(value >= 5001);
}

#[test]
fn test_handle_context_overflow_success() {
    let message = "input length and `max_tokens` exceed context limit: 180000 + 8192 > 200000";
    let result = handle_context_overflow(400, message, 0);
    assert!(result.is_ok());
}

#[test]
fn test_handle_context_overflow_not_overflow() {
    let message = "some other error";
    let result = handle_context_overflow(400, message, 0);
    assert!(matches!(
        result,
        Err(OverflowRecoveryError::NotOverflowError)
    ));
}

#[test]
fn test_overflow_recovery_options_default() {
    let options = OverflowRecoveryOptions::default();
    assert!(options.max_tokens.is_none());
    assert_eq!(options.max_thinking_tokens, 0);
    assert_eq!(options.max_retries, 3);
}
