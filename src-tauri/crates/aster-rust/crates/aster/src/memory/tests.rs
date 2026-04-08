//! memory 模块测试

use super::*;

#[test]
fn test_memory_importance_ordering() {
    assert!(MemoryImportance::Core > MemoryImportance::High);
    assert!(MemoryImportance::High > MemoryImportance::Medium);
    assert!(MemoryImportance::Medium > MemoryImportance::Low);
    assert!(MemoryImportance::Low > MemoryImportance::Ephemeral);
}

#[test]
fn test_memory_emotion_default() {
    let emotion = MemoryEmotion::default();
    assert_eq!(emotion, MemoryEmotion::Neutral);
}

#[test]
fn test_memory_hierarchy_config_default() {
    let config = MemoryHierarchyConfig::default();
    assert_eq!(config.working_memory_size, 10);
    assert_eq!(config.short_term_days, 30);
    assert_eq!(config.compression_threshold, 50);
    assert_eq!(config.max_core_memories, 20);
}

#[test]
fn test_conversation_summary_serialize() {
    let summary = ConversationSummary {
        id: "test-id".to_string(),
        session_id: "session-1".to_string(),
        summary: "Test summary".to_string(),
        topics: vec!["rust".to_string(), "testing".to_string()],
        files_discussed: vec!["main.rs".to_string()],
        symbols_discussed: vec!["test_fn".to_string()],
        emotion: MemoryEmotion::Positive,
        importance: MemoryImportance::High,
        start_time: "2024-01-15T10:00:00Z".to_string(),
        end_time: "2024-01-15T11:00:00Z".to_string(),
        message_count: 10,
        embedding: None,
    };

    let json = serde_json::to_string(&summary).unwrap();
    assert!(json.contains("test-id"));
    assert!(json.contains("rust"));

    let parsed: ConversationSummary = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "test-id");
    assert_eq!(parsed.topics.len(), 2);
}

#[test]
fn test_memory_link_serialize() {
    let link = MemoryLink {
        id: "link-1".to_string(),
        timestamp: "2024-01-15T10:00:00Z".to_string(),
        conversation_id: Some("conv-1".to_string()),
        session_id: None,
        files: vec!["file.rs".to_string()],
        symbols: vec!["func".to_string()],
        commits: vec![],
        topics: vec!["topic".to_string()],
        description: "Test link".to_string(),
        importance: MemoryImportance::Medium,
        related_links: vec![],
    };

    let json = serde_json::to_string(&link).unwrap();
    assert!(json.contains("link-1"));

    let parsed: MemoryLink = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "link-1");
}

#[test]
fn test_user_profile_default() {
    let profile = UserProfile::default();
    assert!(profile.name.is_none());
    assert!(profile.tech_preferences.is_empty());
}

#[test]
fn test_memory_event_serialize() {
    let event = MemoryEvent {
        event_type: MemoryEventType::Conversation,
        session_id: "session-1".to_string(),
        conversation_summary: Some("Summary".to_string()),
        topics: vec!["topic1".to_string()],
        files_modified: None,
        symbols_discussed: None,
        commits: None,
        emotion: Some(MemoryEmotion::Positive),
        explicit_memory: None,
        timestamp: "2024-01-15T10:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("conversation"));
    assert!(json.contains("session-1"));
}

#[test]
fn test_compressor_single_summary() {
    let compressor = MemoryCompressor::default();

    let summary = ConversationSummary {
        id: "1".to_string(),
        session_id: "s1".to_string(),
        summary: "Test".to_string(),
        topics: vec!["rust".to_string()],
        files_discussed: vec!["main.rs".to_string()],
        symbols_discussed: vec![],
        emotion: MemoryEmotion::Neutral,
        importance: MemoryImportance::Medium,
        start_time: "2024-01-15T10:00:00Z".to_string(),
        end_time: "2024-01-15T11:00:00Z".to_string(),
        message_count: 5,
        embedding: None,
    };

    let result = compressor.compress(&[summary]).unwrap();
    assert_eq!(result.original_count, 1);
    assert_eq!(result.compressed_summary, "Test");
}

#[test]
fn test_compressor_multiple_summaries() {
    let compressor = MemoryCompressor::default();

    let summaries = vec![
        ConversationSummary {
            id: "1".to_string(),
            session_id: "s1".to_string(),
            summary: "First conversation".to_string(),
            topics: vec!["rust".to_string(), "testing".to_string()],
            files_discussed: vec!["main.rs".to_string()],
            symbols_discussed: vec![],
            emotion: MemoryEmotion::Positive,
            importance: MemoryImportance::High,
            start_time: "2024-01-15T10:00:00Z".to_string(),
            end_time: "2024-01-15T11:00:00Z".to_string(),
            message_count: 10,
            embedding: None,
        },
        ConversationSummary {
            id: "2".to_string(),
            session_id: "s2".to_string(),
            summary: "Second conversation".to_string(),
            topics: vec!["rust".to_string(), "memory".to_string()],
            files_discussed: vec!["lib.rs".to_string()],
            symbols_discussed: vec![],
            emotion: MemoryEmotion::Neutral,
            importance: MemoryImportance::Medium,
            start_time: "2024-01-16T10:00:00Z".to_string(),
            end_time: "2024-01-16T11:00:00Z".to_string(),
            message_count: 8,
            embedding: None,
        },
    ];

    let result = compressor.compress(&summaries).unwrap();
    assert_eq!(result.original_count, 2);
    assert!(result.preserved_topics.contains(&"rust".to_string()));
    assert_eq!(result.importance, MemoryImportance::High);
}

#[test]
fn test_compressor_empty_error() {
    let compressor = MemoryCompressor::default();
    let result = compressor.compress(&[]);
    assert!(result.is_err());
}

#[test]
fn test_compressor_evaluate_importance() {
    let compressor = MemoryCompressor::default();

    // 高重要性：meaningful emotion + 多话题 + 多文件
    let high_summary = ConversationSummary {
        id: "1".to_string(),
        session_id: "s1".to_string(),
        summary: "Important".to_string(),
        topics: vec!["a".to_string(), "b".to_string(), "c".to_string()],
        files_discussed: vec![
            "1".to_string(),
            "2".to_string(),
            "3".to_string(),
            "4".to_string(),
            "5".to_string(),
        ],
        symbols_discussed: vec![],
        emotion: MemoryEmotion::Meaningful,
        importance: MemoryImportance::Medium,
        start_time: "2024-01-15T10:00:00Z".to_string(),
        end_time: "2024-01-15T11:00:00Z".to_string(),
        message_count: 25,
        embedding: None,
    };

    let importance = compressor.evaluate_importance(&high_summary);
    assert!(importance >= MemoryImportance::High);

    // 低重要性
    let low_summary = ConversationSummary {
        id: "2".to_string(),
        session_id: "s2".to_string(),
        summary: "Simple".to_string(),
        topics: vec![],
        files_discussed: vec![],
        symbols_discussed: vec![],
        emotion: MemoryEmotion::Neutral,
        importance: MemoryImportance::Low,
        start_time: "2024-01-15T10:00:00Z".to_string(),
        end_time: "2024-01-15T10:05:00Z".to_string(),
        message_count: 2,
        embedding: None,
    };

    let importance = compressor.evaluate_importance(&low_summary);
    assert!(importance <= MemoryImportance::Low);
}

#[test]
fn test_compressor_should_compress() {
    let compressor = MemoryCompressor::default();

    let summaries: Vec<ConversationSummary> = (0..60)
        .map(|i| ConversationSummary {
            id: format!("{}", i),
            session_id: format!("s{}", i),
            summary: format!("Summary {}", i),
            topics: vec![],
            files_discussed: vec![],
            symbols_discussed: vec![],
            emotion: MemoryEmotion::Neutral,
            importance: MemoryImportance::Medium,
            start_time: "2024-01-15T10:00:00Z".to_string(),
            end_time: "2024-01-15T11:00:00Z".to_string(),
            message_count: 5,
            embedding: None,
        })
        .collect();

    assert!(compressor.should_compress(&summaries, 50));
    assert!(!compressor.should_compress(&summaries[..40], 50));
}

#[test]
fn test_compressor_group_by_period() {
    let compressor = MemoryCompressor::default();

    let summaries = vec![
        ConversationSummary {
            id: "1".to_string(),
            session_id: "s1".to_string(),
            summary: "Day 1".to_string(),
            topics: vec![],
            files_discussed: vec![],
            symbols_discussed: vec![],
            emotion: MemoryEmotion::Neutral,
            importance: MemoryImportance::Medium,
            start_time: "2024-01-15T10:00:00Z".to_string(),
            end_time: "2024-01-15T11:00:00Z".to_string(),
            message_count: 5,
            embedding: None,
        },
        ConversationSummary {
            id: "2".to_string(),
            session_id: "s2".to_string(),
            summary: "Day 2".to_string(),
            topics: vec![],
            files_discussed: vec![],
            symbols_discussed: vec![],
            emotion: MemoryEmotion::Neutral,
            importance: MemoryImportance::Medium,
            start_time: "2024-01-16T10:00:00Z".to_string(),
            end_time: "2024-01-16T11:00:00Z".to_string(),
            message_count: 5,
            embedding: None,
        },
    ];

    let groups = compressor.group_by_period(&summaries, Period::Day);
    assert_eq!(groups.len(), 2);

    let groups = compressor.group_by_period(&summaries, Period::Month);
    assert_eq!(groups.len(), 1);
}
