use super::*;
use agent_protocol::response_item::MessagePhase;
use app_server_protocol::protocol::v2::{
    AgentMessageDeltaNotification, CollabAgentState, CollabAgentStatus, CollabAgentTool,
    CommandAction, CommandExecutionOutputDeltaNotification, CommandExecutionSource,
    DynamicToolCallOutputContentItem, ErrorNotification, FileChangePatchUpdatedNotification,
    FileUpdateChange, HookCompletedNotification, HookEventName, HookExecutionMode, HookHandlerType,
    HookOutputEntry, HookOutputEntryKind, HookRunStatus, HookRunSummary, HookScope, HookSource,
    HookStartedNotification, ImageGenerationItem, ItemCompletedNotification,
    ItemStartedNotification, McpToolCallError, McpToolCallResult, PatchChangeKind,
    ReasoningSummaryPartAddedNotification, ReasoningSummaryTextDeltaNotification, SessionSource,
    SleepItem, Thread, ThreadActiveFlag, ThreadItem, ThreadStatus, Turn, TurnCompletedNotification,
    TurnDiffUpdatedNotification, TurnError, TurnItemsView, TurnPlanStep, TurnPlanStepStatus,
    TurnPlanUpdatedNotification, WarningNotification, WebSearchItem,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

fn user_message(id: &str, text: &str) -> ThreadItem {
    ThreadItem::UserMessage {
        id: id.to_string(),
        metadata: None,
        client_id: None,
        content: vec![app_server_protocol::protocol::v2::UserInput::Text {
            text: text.to_string(),
            text_elements: Vec::new(),
        }],
    }
}

fn agent_message(id: &str, text: &str, phase: Option<MessagePhase>) -> ThreadItem {
    ThreadItem::AgentMessage {
        id: id.to_string(),
        metadata: None,
        text: text.to_string(),
        phase,
        memory_citation: None,
        delivery: None,
    }
}

fn review_boundary(id: &str, entered: bool) -> ThreadItem {
    if entered {
        ThreadItem::EnteredReviewMode {
            id: id.to_string(),
            metadata: None,
            review: "review".to_string(),
        }
    } else {
        ThreadItem::ExitedReviewMode {
            id: id.to_string(),
            metadata: None,
            review: "review".to_string(),
        }
    }
}

pub(super) fn test_thread(turns: Vec<Turn>) -> Thread {
    Thread {
        id: "thread-review-filter".to_string(),
        extra: None,
        session_id: "session-review-filter".to_string(),
        forked_from_id: None,
        parent_thread_id: None,
        preview: "review filter".to_string(),
        ephemeral: false,
        section: None,
        section_entered_at: None,
        project_id: None,
        history_mode: Default::default(),
        model_provider: "fixture".to_string(),
        created_at: 1,
        updated_at: 1,
        recency_at: None,
        status: ThreadStatus::Idle,
        path: None,
        cwd: PathBuf::from("/workspace"),
        cli_version: "test".to_string(),
        source: SessionSource::Cli,
        can_accept_direct_input: Some(true),
        thread_source: None,
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: None,
        turns,
    }
}

pub(super) fn test_turn(id: &str, status: TurnStatus, items: Vec<ThreadItem>) -> Turn {
    Turn {
        id: id.to_string(),
        items,
        items_view: TurnItemsView::Full,
        status,
        error: None,
        started_at: Some(1),
        completed_at: matches!(status, TurnStatus::Completed | TurnStatus::Failed).then_some(2),
        duration_ms: Some(1),
    }
}

fn hook_run(
    id: &str,
    status: HookRunStatus,
    status_message: Option<&str>,
    entries: Vec<(HookOutputEntryKind, &str)>,
) -> HookRunSummary {
    HookRunSummary {
        id: id.to_string(),
        event_name: HookEventName::PreToolUse,
        handler_type: HookHandlerType::Command,
        execution_mode: HookExecutionMode::Sync,
        scope: HookScope::Turn,
        source_path: PathBuf::from("/workspace/hooks.json"),
        source: HookSource::Project,
        display_order: 0,
        status,
        status_message: status_message.map(str::to_string),
        started_at: 1,
        completed_at: (status != HookRunStatus::Running).then_some(2),
        duration_ms: (status != HookRunStatus::Running).then_some(1),
        entries: entries
            .into_iter()
            .map(|(kind, text)| HookOutputEntry {
                kind,
                text: text.to_string(),
            })
            .collect(),
    }
}

fn hook_started(run: HookRunSummary, turn_id: Option<&str>) -> ServerNotification {
    ServerNotification::HookStarted(HookStartedNotification {
        thread_id: "thread-1".to_string(),
        turn_id: turn_id.map(str::to_string),
        run,
    })
}

fn hook_completed(run: HookRunSummary, turn_id: Option<&str>) -> ServerNotification {
    ServerNotification::HookCompleted(HookCompletedNotification {
        thread_id: "thread-1".to_string(),
        turn_id: turn_id.map(str::to_string),
        run,
    })
}

#[test]
fn typed_warning_and_error_notifications_keep_distinct_visual_kinds() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::Warning(WarningNotification {
        thread_id: Some("thread-1".to_string()),
        message: "credentials expire soon".to_string(),
        code: None,
    }));
    projection.apply(ServerNotification::Error(ErrorNotification {
        error: TurnError {
            message: "401 Unauthorized".to_string(),
            codex_error_info: None,
            additional_details: None,
        },
        will_retry: false,
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
    }));

    assert_eq!(projection.entries()[0].kind, EntryKind::Warning);
    assert_eq!(projection.entries()[0].text, "credentials expire soon");
    assert_eq!(projection.entries()[1].kind, EntryKind::Error);
    assert_eq!(projection.entries()[1].text, "401 Unauthorized");
    assert_eq!(projection.status(), "failed");
}

#[test]
fn hook_started_exposes_running_status_without_transcript_entry() {
    let mut projection = ConversationProjection::default();
    projection.apply(hook_started(
        hook_run("hook-1", HookRunStatus::Running, None, Vec::new()),
        Some("turn-1"),
    ));

    assert_eq!(projection.status(), "running hook");
    assert!(projection.entries().is_empty());

    projection.apply(hook_started(
        hook_run(
            "hook-1",
            HookRunStatus::Running,
            Some("checking files"),
            Vec::new(),
        ),
        Some("turn-1"),
    ));
    assert_eq!(projection.status(), "checking files");
}

#[test]
fn multiple_running_hooks_use_shared_message_or_plural_status() {
    let mut projection = ConversationProjection::default();
    projection.apply(hook_started(
        hook_run(
            "hook-1",
            HookRunStatus::Running,
            Some("checking"),
            Vec::new(),
        ),
        Some("turn-1"),
    ));
    projection.apply(hook_started(
        hook_run(
            "hook-2",
            HookRunStatus::Running,
            Some("checking"),
            Vec::new(),
        ),
        Some("turn-1"),
    ));
    assert_eq!(projection.status(), "checking");

    projection.apply(hook_started(
        hook_run(
            "hook-3",
            HookRunStatus::Running,
            Some("waiting"),
            Vec::new(),
        ),
        Some("turn-1"),
    ));
    assert_eq!(projection.status(), "running hooks");
}

#[test]
fn context_only_successful_hook_is_hidden_from_transcript() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("turn-1".to_string());
    projection.apply(hook_started(
        hook_run("hook-1", HookRunStatus::Running, None, Vec::new()),
        Some("turn-1"),
    ));
    projection.apply(hook_completed(
        hook_run(
            "hook-1",
            HookRunStatus::Completed,
            None,
            vec![(HookOutputEntryKind::Context, "private model context")],
        ),
        Some("turn-1"),
    ));

    assert_eq!(projection.status(), "running");
    assert!(projection.entries().is_empty());
}

#[test]
fn non_successful_hooks_render_bounded_user_visible_summary() {
    for (status, label) in [
        (HookRunStatus::Failed, "hook failed"),
        (HookRunStatus::Blocked, "hook blocked"),
        (HookRunStatus::Stopped, "hook stopped"),
    ] {
        let mut projection = ConversationProjection::default();
        let mut run = hook_run(
            "hook-1",
            status,
            None,
            vec![
                (HookOutputEntryKind::Context, "private model context"),
                (HookOutputEntryKind::Feedback, "visible output\nsecond line"),
            ],
        );
        run.entries.extend((0..6).map(|_| HookOutputEntry {
            kind: HookOutputEntryKind::Warning,
            text: "additional output".to_string(),
        }));
        projection.apply(hook_completed(run, Some("turn-1")));

        assert_eq!(projection.entries().len(), 1);
        let entry = &projection.entries()[0];
        assert_eq!(entry.text, label);
        assert_eq!(entry.status, Some(EntryStatus::Failed));
        assert_eq!(entry.summary.len(), 4);
        assert_eq!(entry.summary[0], "hook output: visible output");
        assert!(!entry
            .summary
            .iter()
            .any(|summary| summary.contains("private model context")));
    }
}

#[test]
fn turn_completion_clears_only_hooks_owned_by_that_turn() {
    let mut projection = ConversationProjection::default();
    projection.apply(hook_started(
        hook_run("hook-1", HookRunStatus::Running, None, Vec::new()),
        Some("turn-1"),
    ));
    projection.apply(hook_started(
        hook_run("hook-2", HookRunStatus::Running, None, Vec::new()),
        Some("turn-2"),
    ));

    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: test_turn("turn-1", TurnStatus::Completed, Vec::new()),
        },
    ));
    assert_eq!(projection.status(), "running hook");

    projection.apply(hook_completed(
        hook_run("hook-2", HookRunStatus::Completed, None, Vec::new()),
        Some("turn-2"),
    ));
    assert_eq!(projection.status(), "ready");
}

#[test]
fn hydrate_thread_hides_review_prompt_but_keeps_boundaries() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "turn-review",
        TurnStatus::Completed,
        vec![
            review_boundary("enter", true),
            user_message("review-prompt", "内部 review prompt"),
            review_boundary("exit", false),
            user_message("visible", "普通请求"),
        ],
    )]));

    let texts = projection
        .entries()
        .iter()
        .map(|entry| entry.text.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        texts,
        vec![
            "review started: review",
            "review completed: review",
            "普通请求"
        ]
    );
    assert!(!texts.iter().any(|text| text.contains("内部 review prompt")));
}

#[test]
fn hydrate_thread_hides_unfinished_nested_review_duplicate_only() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![
        test_turn(
            "turn-review",
            TurnStatus::Completed,
            vec![
                review_boundary("enter", true),
                review_boundary("exit", false),
            ],
        ),
        test_turn(
            "turn-nested",
            TurnStatus::Interrupted,
            vec![
                user_message("nested-1", "重复请求"),
                user_message("nested-2", "重复请求"),
            ],
        ),
        test_turn(
            "turn-normal",
            TurnStatus::Completed,
            vec![
                user_message("normal-1", "重复请求"),
                user_message("normal-2", "重复请求"),
            ],
        ),
    ]));

    let visible_user_texts = projection
        .entries()
        .iter()
        .filter(|entry| entry.kind == EntryKind::User)
        .map(|entry| entry.text.as_str())
        .collect::<Vec<_>>();
    assert_eq!(visible_user_texts, vec!["重复请求", "重复请求"]);
}

#[test]
fn realtime_review_boundary_hides_only_messages_inside_interval() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: user_message("before", "普通请求"),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: review_boundary("enter", true),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: user_message("hidden", "内部 review prompt"),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: review_boundary("exit", false),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: user_message("after", "普通请求 2"),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));

    let visible_user_texts = projection
        .entries()
        .iter()
        .filter(|entry| entry.kind == EntryKind::User)
        .map(|entry| entry.text.as_str())
        .collect::<Vec<_>>();
    assert_eq!(visible_user_texts, vec!["普通请求", "普通请求 2"]);
}

#[test]
fn completed_agent_item_replaces_streaming_delta() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "item-1".to_string(),
            delta: "你".to_string(),
        },
    ));
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "item-1".to_string(),
            delta: "好".to_string(),
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: ThreadItem::AgentMessage {
                id: "item-1".to_string(),
                metadata: None,
                text: "你好。".to_string(),
                phase: None,
                memory_citation: None,
                delivery: None,
            },
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));

    assert_eq!(projection.entries().len(), 1);
    assert_eq!(projection.entries()[0].text, "你好。");
    assert!(!projection.entries()[0].streaming);
    assert_eq!(projection.final_answer(), "你好。");
}

#[test]
fn late_agent_delta_does_not_reopen_completed_item() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message("item-1", "canonical", None),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));

    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "item-1".to_string(),
            delta: " late".to_string(),
        },
    ));

    assert_eq!(projection.entries()[0].text, "canonical");
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn commentary_agent_messages_are_visible_but_not_final_answers() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message(
                "commentary-1",
                "正在检查实现",
                Some(MessagePhase::Commentary),
            ),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));

    assert_eq!(projection.entries().len(), 1);
    assert_eq!(projection.entries()[0].text, "正在检查实现");
    assert_eq!(projection.final_answer(), "");
}

#[test]
fn final_answer_phase_wins_over_older_commentary() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message(
                "commentary-1",
                "正在检查实现",
                Some(MessagePhase::Commentary),
            ),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message("final-1", "实现已完成", Some(MessagePhase::FinalAnswer)),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 2,
        },
    ));

    assert_eq!(projection.final_answer(), "实现已完成");
}

#[test]
fn legacy_agent_messages_without_phase_remain_final_answers() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message("legacy-1", "兼容回答", None),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));

    assert_eq!(projection.final_answer(), "兼容回答");
}

#[test]
fn streamed_agent_message_phase_is_repaired_by_item_completion() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "streamed-1".to_string(),
            delta: "内部进度".to_string(),
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message("streamed-1", "内部进度", Some(MessagePhase::Commentary)),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    assert_eq!(projection.final_answer(), "");

    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message("streamed-1", "公开回答", Some(MessagePhase::FinalAnswer)),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 2,
        },
    ));
    assert_eq!(projection.final_answer(), "公开回答");
}

#[test]
fn reasoning_summary_parts_keep_streamed_section_boundaries() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            delta: "检查输入".to_string(),
            summary_index: 0,
        },
    ));
    projection.apply(ServerNotification::ReasoningSummaryPartAdded(
        ReasoningSummaryPartAddedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            summary_index: 1,
        },
    ));
    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            delta: "准备回答".to_string(),
            summary_index: 1,
        },
    ));

    assert_eq!(projection.entries()[0].text, "检查输入\n准备回答");
    assert!(projection.entries()[0].streaming);
    assert_eq!(
        projection.entries()[0].activity_detail,
        Some(ActivityDetail::Reasoning {
            scope: "turn-1".to_string(),
        })
    );
}

#[test]
fn reasoning_summary_updates_running_status_with_latest_usable_line() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("turn-1".to_string());

    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            delta: "**Checking tests**".to_string(),
            summary_index: 0,
        },
    ));
    assert_eq!(projection.status(), "Checking tests");

    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            delta: "\n<!-- progress -->\nPreparing response".to_string(),
            summary_index: 0,
        },
    ));
    assert_eq!(projection.status(), "Preparing response");

    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: test_turn("turn-1", TurnStatus::Completed, Vec::new()),
        },
    ));
    assert_eq!(projection.status(), "ready");
}

#[test]
fn explicit_status_clears_reasoning_summary_header() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("turn-1".to_string());
    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            delta: "**Checking**".to_string(),
            summary_index: 0,
        },
    ));
    assert_eq!(projection.status(), "Checking");

    projection.set_status("waiting for input");
    assert_eq!(projection.status(), "waiting for input");
}

#[test]
fn late_reasoning_section_boundary_does_not_mutate_completed_history() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: ThreadItem::Reasoning {
                id: "reasoning-1".to_string(),
                metadata: None,
                summary: vec!["已完成".to_string()],
                content: Vec::new(),
            },
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    projection.apply(ServerNotification::ReasoningSummaryPartAdded(
        ReasoningSummaryPartAddedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            summary_index: 1,
        },
    ));
    projection.apply(ServerNotification::ReasoningSummaryTextDelta(
        ReasoningSummaryTextDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "reasoning-1".to_string(),
            delta: " late".to_string(),
            summary_index: 1,
        },
    ));

    assert_eq!(projection.entries()[0].text, "已完成");
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn hydrated_thread_uses_the_same_phase_aware_final_answer_rule() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "turn-1",
        TurnStatus::Completed,
        vec![
            agent_message("commentary-1", "历史进度", Some(MessagePhase::Commentary)),
            agent_message("final-1", "历史最终回答", Some(MessagePhase::FinalAnswer)),
        ],
    )]));

    assert_eq!(projection.final_answer(), "历史最终回答");
}

#[test]
fn user_message_images_are_numbered_without_retaining_sources() {
    let item = ThreadItem::UserMessage {
        id: "user-images".to_string(),
        metadata: None,
        client_id: None,
        content: vec![
            app_server_protocol::protocol::v2::UserInput::Image {
                detail: None,
                url: "data:image/png;base64,private-payload".to_string(),
            },
            app_server_protocol::protocol::v2::UserInput::Text {
                text: "describe these".to_string(),
                text_elements: Vec::new(),
            },
            app_server_protocol::protocol::v2::UserInput::LocalImage {
                detail: None,
                path: "C:/Users/alice/private.png".to_string(),
            },
        ],
    };

    let mut live = ConversationProjection::default();
    live.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: item.clone(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    let mut persisted = ConversationProjection::default();
    persisted.hydrate_thread(test_thread(vec![test_turn(
        "turn-1",
        TurnStatus::Completed,
        vec![item],
    )]));

    assert_eq!(live.entries(), persisted.entries());
    let entry = &live.entries()[0];
    assert_eq!(entry.text, "describe these");
    assert_eq!(entry.summary, vec!["image: 1", "image: 2"]);
    assert!(!entry.text.contains("private-payload"));
    assert!(!entry.text.contains("alice"));
}

#[test]
fn hydrate_thread_restores_items_and_active_turn_identity() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(Thread {
        id: "thread-restore".to_string(),
        extra: None,
        session_id: "session-restore".to_string(),
        forked_from_id: None,
        parent_thread_id: None,
        preview: "恢复测试".to_string(),
        ephemeral: false,
        section: None,
        section_entered_at: None,
        project_id: None,
        history_mode: Default::default(),
        model_provider: "fixture".to_string(),
        created_at: 1,
        updated_at: 1,
        recency_at: None,
        status: ThreadStatus::Active {
            active_flags: vec![ThreadActiveFlag::WaitingOnUserInput],
        },
        path: None,
        cwd: PathBuf::from("/workspace"),
        cli_version: "test".to_string(),
        source: SessionSource::Cli,
        can_accept_direct_input: Some(true),
        thread_source: None,
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: None,
        turns: vec![Turn {
            id: "turn-restore".to_string(),
            items: vec![ThreadItem::AgentMessage {
                id: "item-restore".to_string(),
                metadata: None,
                text: "已恢复".to_string(),
                phase: None,
                memory_citation: None,
                delivery: None,
            }],
            items_view: TurnItemsView::Full,
            status: TurnStatus::InProgress,
            error: None,
            started_at: Some(1),
            completed_at: None,
            duration_ms: None,
        }],
    });

    assert_eq!(projection.active_turn_id(), Some("turn-restore"));
    assert_eq!(projection.status(), "running");
    assert_eq!(projection.final_answer(), "已恢复");
}

#[test]
fn start_turn_records_active_turn_from_request_response() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("turn-response".to_string());

    assert_eq!(projection.active_turn_id(), Some("turn-response"));
    assert_eq!(projection.status(), "running");
}

#[test]
fn plan_and_diff_notifications_replace_stable_projection_entries() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::TurnPlanUpdated(
        TurnPlanUpdatedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            explanation: None,
            plan: vec![TurnPlanStep {
                step: "运行测试".to_string(),
                status: TurnPlanStepStatus::InProgress,
            }],
        },
    ));
    projection.apply(ServerNotification::TurnDiffUpdated(
        TurnDiffUpdatedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            diff: "@@ -1 +1 @@\n-旧\n+新".to_string(),
        },
    ));
    projection.apply(ServerNotification::FileChangePatchUpdated(
        FileChangePatchUpdatedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "patch-1".to_string(),
            changes: vec![FileUpdateChange {
                path: "src/lib.rs".to_string(),
                kind: PatchChangeKind::Update { move_path: None },
                diff: "+新".to_string(),
            }],
        },
    ));

    assert_eq!(projection.entries().len(), 3);
    assert!(projection.entries()[0].text.contains("运行测试"));
    assert_eq!(projection.entries()[0].kind, EntryKind::Plan);
    assert!(projection.entries()[1].text.contains("+新"));
    assert_eq!(projection.entries()[1].kind, EntryKind::Patch);
    assert!(projection.entries()[2].text.contains("src/lib.rs"));
    assert_eq!(projection.entries()[2].kind, EntryKind::Patch);
}

#[test]
fn patch_format_preserves_rename_destination() {
    let text = format_patch(&[FileUpdateChange {
        path: "/workspace/src/old.rs".to_string(),
        kind: PatchChangeKind::Update {
            move_path: Some("/workspace/src/new.rs".to_string()),
        },
        diff: "@@ -1 +1 @@\n-old\n+new".to_string(),
    }]);

    assert!(text.starts_with("updated /workspace/src/old.rs → /workspace/src/new.rs\n"));
}

#[test]
fn web_search_action_details_follow_codex_display_contract() {
    let cases = [
        (
            Some(json!({"type": "search", "query": "Rust release"})),
            Some("canonical query"),
            "web search: Rust release",
        ),
        (
            Some(json!({"type": "search", "queries": ["first query", "second query"]})),
            None,
            "web search: first query ...",
        ),
        (
            Some(json!({"type": "open_page", "url": "https://example.test/page"})),
            None,
            "web search: https://example.test/page",
        ),
        (
            Some(json!({
                "type": "find_in_page",
                "url": "https://example.test/page",
                "pattern": "release"
            })),
            None,
            "web search: 'release' in https://example.test/page",
        ),
        (
            Some(json!({"type": "find_in_page", "pattern": "release"})),
            None,
            "web search: 'release'",
        ),
    ];

    for (action, query, expected) in cases {
        let entry = project_item(
            &ThreadItem::WebSearch(WebSearchItem {
                id: "web-search".to_string(),
                metadata: None,
                query: query.map(str::to_string),
                action,
            }),
            false,
        )
        .expect("web search projection");
        assert_eq!(entry.text, expected);
    }
}

#[test]
fn web_search_realtime_lifecycle_uses_codex_started_and_completed_labels() {
    let item = ThreadItem::WebSearch(WebSearchItem {
        id: "web-search-lifecycle".to_string(),
        metadata: None,
        query: Some("Rust release".to_string()),
        action: None,
    });
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemStarted(ItemStartedNotification {
        item: item.clone(),
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        started_at_ms: 1,
    }));
    assert_eq!(
        projection.entries()[0].text,
        "searching the web Rust release"
    );
    assert!(projection.entries()[0].streaming);

    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item,
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 2,
        },
    ));
    assert_eq!(
        projection.entries()[0].text,
        "searched the web for Rust release"
    );
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn completed_turn_repair_keeps_web_search_completed_label() {
    let item = ThreadItem::WebSearch(WebSearchItem {
        id: "web-search-turn-repair".to_string(),
        metadata: None,
        query: Some("Rust release".to_string()),
        action: None,
    });
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemStarted(ItemStartedNotification {
        item: item.clone(),
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        started_at_ms: 1,
    }));
    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: test_turn("turn-1", TurnStatus::Completed, vec![item]),
        },
    ));

    assert_eq!(
        projection.entries()[0].text,
        "searched the web for Rust release"
    );
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn web_search_persisted_projection_is_status_agnostic() {
    let entry = project_item(
        &ThreadItem::WebSearch(WebSearchItem {
            id: "web-search-history".to_string(),
            metadata: None,
            query: Some("Rust release".to_string()),
            action: None,
        }),
        false,
    )
    .expect("web search projection");
    assert_eq!(entry.text, "web search: Rust release");
}

#[test]
fn web_search_malformed_or_unknown_action_falls_back_to_query() {
    for action in [
        json!("search_query"),
        json!({"type": "future_action", "url": "https://example.test/hidden"}),
        json!({"type": "open_page", "url": 42}),
        json!({"type": "search", "queries": [42]}),
        json!({"type": "other"}),
    ] {
        let entry = project_item(
            &ThreadItem::WebSearch(WebSearchItem {
                id: "web-search-fallback".to_string(),
                metadata: None,
                query: Some("canonical query".to_string()),
                action: Some(action),
            }),
            false,
        )
        .expect("web search projection");
        assert_eq!(entry.text, "web search: canonical query");
    }
}

#[test]
fn web_search_detail_is_localized_at_the_entry_boundary() {
    let entry = project_item(
        &ThreadItem::WebSearch(WebSearchItem {
            id: "web-search-locale".to_string(),
            metadata: None,
            query: None,
            action: Some(json!({
                "type": "find_in_page",
                "url": "https://example.test/page",
                "pattern": "release"
            })),
        }),
        false,
    )
    .expect("web search projection");
    for (locale, prefix) in [
        (crate::locale::Locale::ZhCn, "网页搜索："),
        (crate::locale::Locale::ZhTw, "網頁搜尋："),
        (crate::locale::Locale::EnUs, "web search: "),
        (crate::locale::Locale::JaJp, "ウェブ検索: "),
        (crate::locale::Locale::KoKr, "웹 검색: "),
    ] {
        let rendered = crate::entry::hyperlink_lines_with_locale(
            &entry,
            locale,
            Some(120),
            std::path::Path::new("/workspace"),
        );
        let text = rendered
            .iter()
            .flat_map(|line| line.line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<String>();
        assert!(text.contains(format!("{prefix}'release' in https://example.test/page").as_str()));
    }
}

#[test]
fn item_result_fields_become_structured_display_summaries() {
    let command = project_item(
        &ThreadItem::CommandExecution {
            id: "command-1".to_string(),
            metadata: None,
            plugin_id: None,
            script_path: None,
            command: "cargo test -p tui".to_string(),
            cwd: "/workspace".to_string(),
            process_id: None,
            source: CommandExecutionSource::Agent,
            status: CommandExecutionStatus::Completed,
            command_actions: Vec::new(),
            aggregated_output: Some("ok".to_string()),
            exit_code: Some(0),
            duration_ms: Some(42),
            terminal_interactions: Vec::new(),
        },
        false,
    )
    .expect("command projection");
    assert_eq!(command.status, Some(EntryStatus::Completed));
    assert!(command.text.contains("cargo test -p tui\nok"));
    assert_eq!(command.summary, vec!["exit 0", "duration 42ms"]);

    assert!(project_item(
        &ThreadItem::Sleep(SleepItem {
            id: "sleep-1".to_string(),
            metadata: None,
            duration_ms: Some(1000),
        }),
        false,
    )
    .is_none());

    let patch = project_item(
        &ThreadItem::FileChange {
            id: "patch-1".to_string(),
            metadata: None,
            changes: vec![
                FileUpdateChange {
                    path: "src/new.rs".to_string(),
                    kind: PatchChangeKind::Add,
                    diff: "+new".to_string(),
                },
                FileUpdateChange {
                    path: "src/lib.rs".to_string(),
                    kind: PatchChangeKind::Update { move_path: None },
                    diff: "+changed".to_string(),
                },
            ],
            status: PatchApplyStatus::Completed,
        },
        false,
    )
    .expect("patch projection");
    assert_eq!(patch.summary, vec!["files: 2", "added: 1", "updated: 1"]);

    let mcp = project_item(
        &ThreadItem::McpToolCall {
            id: "mcp-1".to_string(),
            metadata: None,
            server: "docs".to_string(),
            tool: "search".to_string(),
            status: McpToolCallStatus::Failed,
            arguments: json!({"query": "tui"}),
            app_context: None,
            mcp_app_resource_uri: None,
            plugin_id: None,
            read_only_hint: None,
            result: Some(Box::new(McpToolCallResult {
                content: vec![json!("one")],
                structured_content: None,
                meta: None,
            })),
            error: Some(McpToolCallError {
                message: "upstream unavailable".to_string(),
            }),
            duration_ms: Some(9),
        },
        false,
    )
    .expect("mcp projection");
    assert_eq!(mcp.status, Some(EntryStatus::Failed));
    assert_eq!(
        mcp.summary,
        vec![
            "result items: 1",
            "content types: unknown=1",
            "error: upstream unavailable",
            "duration 9ms"
        ]
    );

    let mcp_details = project_item(
        &ThreadItem::McpToolCall {
            id: "mcp-details".to_string(),
            metadata: None,
            server: "docs".to_string(),
            tool: "search".to_string(),
            status: McpToolCallStatus::Completed,
            arguments: json!({}),
            app_context: None,
            mcp_app_resource_uri: None,
            plugin_id: None,
            read_only_hint: None,
            result: Some(Box::new(McpToolCallResult {
                content: vec![
                    json!({"type": "text", "text": "ok"}),
                    json!({"type": "image", "data": "bounded"}),
                    json!({"type": "resource_link", "uri": "file:///result.txt"}),
                    json!({"type": "future_block"}),
                ],
                structured_content: Some(json!({"matches": 1})),
                meta: Some(json!({"truncated": true, "outputAvailable": true})),
            })),
            error: None,
            duration_ms: Some(4),
        },
        false,
    )
    .expect("mcp details projection");
    assert_eq!(
        mcp_details.summary,
        vec![
            "result items: 4",
            "content types: text=1, image=1, resource-link=1, unknown=1",
            "output: ok",
            "structured content: {\"matches\":1}",
            "truncated",
            "output available",
            "duration 4ms",
        ]
    );

    let computer = project_item(
        &ThreadItem::McpToolCall {
            id: "computer-1".to_string(),
            metadata: None,
            server: "cua_repl".to_string(),
            tool: "computer".to_string(),
            status: McpToolCallStatus::Completed,
            arguments: json!({"title": "Capture calendar"}),
            app_context: None,
            mcp_app_resource_uri: None,
            plugin_id: None,
            read_only_hint: None,
            result: Some(Box::new(McpToolCallResult {
                content: vec![json!({"type": "image", "data": "not retained"})],
                structured_content: None,
                meta: None,
            })),
            error: None,
            duration_ms: None,
        },
        false,
    )
    .expect("computer activity projection");
    assert_eq!(
        computer.summary,
        vec![
            "result items: 1",
            "content types: image=1",
            "computer action: Capture calendar",
            "computer screenshot: captured",
        ]
    );

    let dynamic = project_item(
        &ThreadItem::DynamicToolCall {
            id: "dynamic-1".to_string(),
            metadata: None,
            namespace: Some("browser".to_string()),
            tool: "open".to_string(),
            arguments: json!({}),
            status: DynamicToolCallStatus::Completed,
            content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                text: "done".to_string(),
            }]),
            success: Some(true),
            duration_ms: Some(12),
        },
        false,
    )
    .expect("dynamic projection");
    assert_eq!(
        dynamic.summary,
        vec![
            "success: true",
            "content items: 1",
            "output: done",
            "duration 12ms",
        ]
    );

    let mut agents_states = HashMap::new();
    agents_states.insert(
        "agent-1".to_string(),
        CollabAgentState {
            status: CollabAgentStatus::Running,
            message: None,
        },
    );
    agents_states.insert(
        "agent-2".to_string(),
        CollabAgentState {
            status: CollabAgentStatus::Completed,
            message: None,
        },
    );
    let collab = project_item(
        &ThreadItem::CollabAgentToolCall {
            id: "collab-1".to_string(),
            metadata: None,
            tool: CollabAgentTool::SpawnAgent,
            status: CollabAgentToolCallStatus::Completed,
            sender_thread_id: "thread-1".to_string(),
            receiver_thread_ids: vec!["agent-1".to_string(), "agent-2".to_string()],
            prompt: None,
            model: None,
            reasoning_effort: None,
            agents_states,
        },
        false,
    )
    .expect("collab projection");
    assert_eq!(
        collab.summary,
        vec!["agents: 2", "completed: 1", "running: 1"]
    );

    let image = project_item(
        &ThreadItem::ImageGeneration(ImageGenerationItem {
            id: "image-1".to_string(),
            metadata: None,
            status: "completed".to_string(),
            revised_prompt: Some("a concise prompt".to_string()),
            result: "https://example.test/image.png".to_string(),
            saved_path: Some("/tmp/image.png".to_string()),
        }),
        false,
    )
    .expect("image projection");
    assert_eq!(image.status, Some(EntryStatus::Completed));
    assert_eq!(
        image.summary,
        vec!["saved: /tmp/image.png", "revised prompt: a concise prompt"]
    );
    assert!(!image
        .summary
        .iter()
        .any(|detail| detail.contains("example.test")));
}

#[test]
fn dynamic_text_previews_are_compact_bounded_and_ignore_media_urls() {
    let long_text = "x".repeat(161);
    let content = vec![
        DynamicToolCallOutputContentItem::InputText {
            text: "first line\nsecond line".to_string(),
        },
        DynamicToolCallOutputContentItem::InputImage {
            image_url: "https://secret.example/image.png".to_string(),
        },
        DynamicToolCallOutputContentItem::InputText { text: long_text },
        DynamicToolCallOutputContentItem::InputAudio {
            audio_url: "https://secret.example/audio.wav".to_string(),
        },
        DynamicToolCallOutputContentItem::InputText {
            text: "third".to_string(),
        },
        DynamicToolCallOutputContentItem::InputText {
            text: "fourth".to_string(),
        },
        DynamicToolCallOutputContentItem::InputText {
            text: "fifth".to_string(),
        },
    ];

    let summary = super::dynamic_summary(Some(&content), Some(true), None);

    assert_eq!(
        summary,
        vec![
            "success: true".to_string(),
            "content items: 7".to_string(),
            "output: first line".to_string(),
            format!("output: {}...", "x".repeat(160)),
            "output: third".to_string(),
            "output: fourth".to_string(),
        ]
    );
    assert!(summary
        .iter()
        .all(|detail| { !detail.contains("secret.example") }));
}

#[test]
fn mcp_text_previews_are_compact_bounded_and_capped() {
    let long_text = "x".repeat(161);
    let content = vec![
        json!({"type": "text", "text": "first line\nsecond line"}),
        json!({"type": "text", "text": long_text}),
        json!({"type": "image", "data": "bounded"}),
        json!({"type": "text", "text": "third"}),
        json!({"type": "text", "text": "fourth"}),
        json!({"type": "text", "text": "fifth"}),
        json!({"type": "text", "text": "sixth"}),
    ];

    let previews = mcp_content_previews(&content);
    assert_eq!(previews.len(), 4);
    assert_eq!(previews[0], "output: first line");
    assert_eq!(previews[1], format!("output: {}...", "x".repeat(160)));
    assert_eq!(previews[2], "output: third");
    assert_eq!(previews[3], "output: fourth");
}

#[test]
fn command_output_deltas_follow_the_command_without_splitting_chunks() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemStarted(ItemStartedNotification {
        item: command_item(
            "command-1",
            "printf 'stdout\\nstderr\\n'",
            CommandExecutionStatus::InProgress,
            None,
        ),
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        started_at_ms: 1,
    }));
    for delta in ["std", "out\nstderr\n"] {
        projection.apply(ServerNotification::CommandExecutionOutputDelta(
            CommandExecutionOutputDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                delta: delta.to_string(),
            },
        ));
    }

    assert_eq!(
        projection.entries()[0].text,
        "printf 'stdout\\nstderr\\n'\nstdout\nstderr\n"
    );
    assert!(projection.entries()[0].streaming);
    assert_eq!(projection.entries()[0].status, Some(EntryStatus::Running));
}

#[test]
fn completed_command_item_replaces_live_output_with_canonical_output() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemStarted(ItemStartedNotification {
        item: command_item(
            "command-1",
            "printf data",
            CommandExecutionStatus::InProgress,
            None,
        ),
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        started_at_ms: 1,
    }));
    projection.apply(ServerNotification::CommandExecutionOutputDelta(
        CommandExecutionOutputDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "command-1".to_string(),
            delta: "partial".to_string(),
        },
    ));
    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: command_item(
                "command-1",
                "printf data",
                CommandExecutionStatus::Completed,
                Some("canonical output"),
            ),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 2,
        },
    ));

    assert_eq!(
        projection.entries()[0].text,
        "printf data\ncanonical output"
    );
    assert!(!projection.entries()[0].streaming);
    assert_eq!(projection.entries()[0].status, Some(EntryStatus::Completed));
}

fn command_item(
    id: &str,
    command: &str,
    status: CommandExecutionStatus,
    aggregated_output: Option<&str>,
) -> ThreadItem {
    ThreadItem::CommandExecution {
        id: id.to_string(),
        metadata: None,
        plugin_id: None,
        script_path: None,
        command: command.to_string(),
        cwd: "/workspace".to_string(),
        process_id: None,
        source: CommandExecutionSource::Agent,
        status,
        command_actions: Vec::new(),
        aggregated_output: aggregated_output.map(str::to_string),
        exit_code: (status == CommandExecutionStatus::Completed).then_some(0),
        duration_ms: None,
        terminal_interactions: Vec::new(),
    }
}

#[test]
fn activity_group_requires_canonical_kind_and_turn_scope() {
    let mut exploration = command_item(
        "command-read",
        "rg needle src",
        CommandExecutionStatus::Completed,
        Some("src/lib.rs"),
    );
    if let ThreadItem::CommandExecution {
        command_actions, ..
    } = &mut exploration
    {
        command_actions.push(CommandAction::Search {
            command: "rg needle src".to_string(),
            query: Some("needle".to_string()),
            path: Some("src".to_string()),
        });
    }
    let entry = project_item_with_scope(
        &exploration,
        false,
        WebSearchLifecycle::Historical,
        Some("turn-1"),
    )
    .expect("exploration projection");
    assert_eq!(
        entry.activity_group,
        Some(ActivityGroupKey::new(
            ActivityGroupKind::Exploration,
            "turn-1"
        ))
    );
    assert_eq!(
        entry.activity_detail,
        Some(ActivityDetail::Exploration {
            actions: vec![CommandAction::Search {
                command: "rg needle src".to_string(),
                query: Some("needle".to_string()),
                path: Some("src".to_string()),
            }],
            exit_code: Some(0),
        })
    );

    if let ThreadItem::CommandExecution { source, .. } = &mut exploration {
        *source = CommandExecutionSource::UserShell;
    }
    assert_eq!(activity_group_kind(&exploration), None);

    if let ThreadItem::CommandExecution {
        source,
        command_actions,
        ..
    } = &mut exploration
    {
        *source = CommandExecutionSource::Agent;
        command_actions.push(CommandAction::Unknown {
            command: "printf changed".to_string(),
        });
    }
    assert_eq!(activity_group_kind(&exploration), None);

    let computer = ThreadItem::McpToolCall {
        id: "computer-1".to_string(),
        metadata: None,
        server: "cua_repl".to_string(),
        tool: "js".to_string(),
        status: McpToolCallStatus::InProgress,
        arguments: json!({"title": "Inspect page"}),
        app_context: None,
        mcp_app_resource_uri: None,
        plugin_id: None,
        read_only_hint: None,
        result: Some(Box::new(McpToolCallResult {
            content: vec![json!({"type": "image", "data": "not-projected"})],
            structured_content: None,
            meta: None,
        })),
        error: None,
        duration_ms: None,
    };
    let entry =
        project_item_with_scope(&computer, true, WebSearchLifecycle::Started, Some("turn-1"))
            .expect("computer projection");
    assert_eq!(
        entry.activity_group,
        Some(ActivityGroupKey::new(ActivityGroupKind::Computer, "turn-1"))
    );
    assert_eq!(
        entry.activity_detail,
        Some(ActivityDetail::Computer(ComputerActivityFacts {
            title: "Inspect page".to_string(),
            screenshots: 1,
            error: None,
        }))
    );

    let reasoning = ThreadItem::Reasoning {
        id: "reasoning-1".to_string(),
        metadata: None,
        summary: vec!["Inspect the result".to_string()],
        content: Vec::new(),
    };
    let scoped = project_item_with_scope(
        &reasoning,
        false,
        WebSearchLifecycle::Historical,
        Some("turn-1"),
    )
    .expect("reasoning projection");
    assert_eq!(
        scoped.activity_detail,
        Some(ActivityDetail::Reasoning {
            scope: "turn-1".to_string(),
        })
    );
    assert_eq!(
        project_item(&reasoning, false)
            .expect("flat reasoning projection")
            .activity_detail,
        None,
        "flat fallback must not invent a turn relationship"
    );
}

#[test]
fn collab_agent_summary_keeps_requested_model_effort_and_prompt() {
    let collab = project_item(
        &ThreadItem::CollabAgentToolCall {
            id: "collab-1".to_string(),
            metadata: None,
            tool: CollabAgentTool::SpawnAgent,
            status: CollabAgentToolCallStatus::Completed,
            sender_thread_id: "thread-1".to_string(),
            receiver_thread_ids: vec!["agent-1".to_string()],
            prompt: Some("Inspect the repository structure".to_string()),
            model: Some("fixture-model".to_string()),
            reasoning_effort: Some(
                app_server_protocol::protocol::v2::ReasoningEffort::new("high").expect("effort"),
            ),
            agents_states: HashMap::new(),
        },
        false,
    )
    .expect("collab projection");

    assert_eq!(
        collab.summary,
        vec![
            "agents: 0",
            "model: fixture-model",
            "effort: high",
            "prompt: Inspect the repository structure",
        ]
    );
}

#[test]
fn collab_wait_projection_keeps_per_agent_results() {
    let mut agents_states = HashMap::new();
    agents_states.insert(
        "agent-1".to_string(),
        CollabAgentState {
            status: CollabAgentStatus::Completed,
            message: Some("answer".to_string()),
        },
    );
    agents_states.insert(
        "agent-2".to_string(),
        CollabAgentState {
            status: CollabAgentStatus::Errored,
            message: Some("timeout".to_string()),
        },
    );

    let collab = project_item(
        &ThreadItem::CollabAgentToolCall {
            id: "collab-wait".to_string(),
            metadata: None,
            tool: CollabAgentTool::Wait,
            status: CollabAgentToolCallStatus::Completed,
            sender_thread_id: "thread-1".to_string(),
            receiver_thread_ids: vec!["agent-2".to_string(), "agent-1".to_string()],
            prompt: None,
            model: None,
            reasoning_effort: None,
            agents_states,
        },
        false,
    )
    .expect("collab projection");

    assert!(collab
        .summary
        .iter()
        .any(|detail| detail == "agent-1: Completed - answer"));
    assert!(collab
        .summary
        .iter()
        .any(|detail| detail == "agent-2: Error - timeout"));
}

#[test]
fn collab_resume_projection_keeps_resume_result() {
    let collab = project_item(
        &ThreadItem::CollabAgentToolCall {
            id: "collab-resume".to_string(),
            metadata: None,
            tool: CollabAgentTool::ResumeAgent,
            status: CollabAgentToolCallStatus::Completed,
            sender_thread_id: "thread-1".to_string(),
            receiver_thread_ids: vec!["agent-1".to_string()],
            prompt: None,
            model: None,
            reasoning_effort: None,
            agents_states: HashMap::from([(
                "agent-1".to_string(),
                CollabAgentState {
                    status: CollabAgentStatus::Interrupted,
                    message: None,
                },
            )]),
        },
        false,
    )
    .expect("collab projection");

    assert!(collab.summary.iter().any(|detail| detail == "Interrupted"));
}

#[test]
fn turn_terminal_status_settles_in_progress_items() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::ItemStarted(ItemStartedNotification {
        item: ThreadItem::CommandExecution {
            id: "command-1".to_string(),
            metadata: None,
            plugin_id: None,
            script_path: None,
            command: "cargo test -p tui".to_string(),
            cwd: "/workspace".to_string(),
            process_id: None,
            source: CommandExecutionSource::Agent,
            status: CommandExecutionStatus::InProgress,
            command_actions: Vec::new(),
            aggregated_output: None,
            exit_code: None,
            duration_ms: None,
            terminal_interactions: Vec::new(),
        },
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        started_at_ms: 1,
    }));
    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::Interrupted,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    assert_eq!(projection.status(), "interrupted");
    assert_eq!(
        projection.entries()[0].status,
        Some(EntryStatus::Interrupted)
    );
}

#[test]
fn turn_completion_repairs_missing_streamed_items_from_canonical_turn() {
    let mut projection = ConversationProjection::default();
    projection.start_turn("turn-1".to_string());

    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: vec![ThreadItem::AgentMessage {
                    id: "answer-1".to_string(),
                    metadata: None,
                    text: "最终回答".to_string(),
                    phase: None,
                    memory_citation: None,
                    delivery: None,
                }],
                items_view: TurnItemsView::Full,
                status: TurnStatus::Completed,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    assert_eq!(projection.final_answer(), "最终回答");
    assert_eq!(projection.entries().len(), 1);
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn turn_completion_replaces_streaming_item_with_canonical_text() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "answer-1".to_string(),
            delta: "部分".to_string(),
        },
    ));

    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: vec![ThreadItem::AgentMessage {
                    id: "answer-1".to_string(),
                    metadata: None,
                    text: "完整最终回答".to_string(),
                    phase: None,
                    memory_citation: None,
                    delivery: None,
                }],
                items_view: TurnItemsView::Full,
                status: TurnStatus::Completed,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    assert_eq!(projection.entries().len(), 1);
    assert_eq!(projection.entries()[0].text, "完整最终回答");
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn terminal_turn_closes_unrepaired_stream_tail_against_late_delta() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "answer-1".to_string(),
            delta: "部分".to_string(),
        },
    ));

    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::Interrupted,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "answer-1".to_string(),
            delta: " late".to_string(),
        },
    ));

    assert_eq!(projection.entries().len(), 1);
    assert_eq!(projection.entries()[0].text, "部分");
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn terminal_turn_rejects_late_delta_for_unknown_item() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::Failed,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "missing-answer".to_string(),
            delta: "late output".to_string(),
        },
    ));

    assert!(projection.entries().is_empty());
}

#[test]
fn terminal_turn_rejects_late_item_started_but_accepts_canonical_completion() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::Interrupted,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    projection.apply(ServerNotification::ItemStarted(ItemStartedNotification {
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
        item: agent_message("late-item", "provisional", None),
        started_at_ms: 3,
    }));
    assert!(projection.entries().is_empty());

    projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: agent_message("late-item", "canonical repair", None),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 4,
        },
    ));
    assert_eq!(projection.entries().len(), 1);
    assert_eq!(projection.entries()[0].text, "canonical repair");
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn a_new_turn_can_create_a_streaming_item_after_a_terminal_turn() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::Completed,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));
    projection.apply(ServerNotification::TurnStarted(
        app_server_protocol::protocol::v2::TurnStartedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-2".to_string(),
                items: Vec::new(),
                items_view: TurnItemsView::Full,
                status: TurnStatus::InProgress,
                error: None,
                started_at: Some(3),
                completed_at: None,
                duration_ms: None,
            },
        },
    ));

    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-2".to_string(),
            item_id: "answer-2".to_string(),
            delta: "new output".to_string(),
        },
    ));

    assert_eq!(projection.entries().len(), 1);
    assert_eq!(projection.entries()[0].text, "new output");
    assert!(projection.entries()[0].streaming);
}

#[test]
fn turn_completion_inserts_missing_canonical_items_before_known_following_items() {
    let mut projection = ConversationProjection::default();
    projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "answer-1".to_string(),
            delta: "回答".to_string(),
        },
    ));

    projection.apply(ServerNotification::TurnCompleted(
        TurnCompletedNotification {
            thread_id: "thread-1".to_string(),
            turn: Turn {
                id: "turn-1".to_string(),
                items: vec![
                    ThreadItem::UserMessage {
                        id: "user-1".to_string(),
                        metadata: None,
                        client_id: Some("client-1".to_string()),
                        content: vec![app_server_protocol::protocol::v2::UserInput::Text {
                            text: "请求".to_string(),
                            text_elements: Vec::new(),
                        }],
                    },
                    ThreadItem::AgentMessage {
                        id: "answer-1".to_string(),
                        metadata: None,
                        text: "完整回答".to_string(),
                        phase: None,
                        memory_citation: None,
                        delivery: None,
                    },
                ],
                items_view: TurnItemsView::Full,
                status: TurnStatus::Completed,
                error: None,
                started_at: Some(1),
                completed_at: Some(2),
                duration_ms: Some(1),
            },
        },
    ));

    assert_eq!(
        projection
            .entries()
            .iter()
            .map(|entry| entry.text.as_str())
            .collect::<Vec<_>>(),
        vec!["请求", "完整回答"]
    );
}

#[test]
fn completed_turn_exposes_separator_after_its_last_visible_item() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "turn-complete",
        TurnStatus::Completed,
        vec![
            user_message("prompt", "请求"),
            agent_message("answer", "回答", None),
        ],
    )]));

    assert_eq!(
        projection
            .completion_after("answer")
            .map(|boundary| boundary.elapsed_seconds),
        Some(Some(0))
    );
    assert!(projection.completion_after("prompt").is_none());
}

#[test]
fn unsuccessful_turns_do_not_expose_completion_separators() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "turn-failed",
        TurnStatus::Failed,
        vec![agent_message("answer", "失败", None)],
    )]));

    assert!(projection.completion_after("answer").is_none());
}

#[test]
fn grouped_history_does_not_move_completion_to_a_previous_visible_item() {
    let mut projection = ConversationProjection::default();
    projection.prepend_grouped_items_with_hidden_ids(
        vec![HistoryItemGroup {
            items: vec![
                review_boundary("enter", true),
                user_message("hidden-final", "内部请求"),
            ],
            activity_scope: Some("turn-1".to_string()),
            completion: Some(CompletionMetadata {
                elapsed_seconds: Some(61),
            }),
        }],
        &HashSet::new(),
    );

    assert!(projection.completion_after("enter").is_none());
    assert!(projection.completion_after("hidden-final").is_none());
}

#[test]
fn grouped_history_filters_metadata_hidden_user_without_moving_completion() {
    let mut projection = ConversationProjection::default();
    projection.prepend_grouped_items_with_hidden_ids(
        vec![HistoryItemGroup {
            items: vec![
                user_message("hidden", "内部请求"),
                agent_message("answer", "回答", None),
            ],
            activity_scope: Some("turn-1".to_string()),
            completion: Some(CompletionMetadata {
                elapsed_seconds: Some(12),
            }),
        }],
        &HashSet::from([String::from("hidden")]),
    );

    assert_eq!(
        projection
            .entries()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["answer"]
    );
    assert_eq!(
        projection
            .completion_after("answer")
            .map(|boundary| boundary.elapsed_seconds),
        Some(Some(12))
    );
}

#[test]
fn grouped_history_hides_nested_review_prompts_from_turn_metadata() {
    let previous = test_turn(
        "review-turn",
        TurnStatus::Completed,
        vec![
            review_boundary("enter", true),
            review_boundary("exit", false),
        ],
    );
    let current = test_turn(
        "nested-turn",
        TurnStatus::Interrupted,
        vec![
            user_message("nested-one", "重复请求"),
            user_message("nested-two", "重复请求"),
        ],
    );
    let hidden_ids = crate::history_filter::hidden_user_message_ids(&[previous, current]);
    let mut projection = ConversationProjection::default();
    projection.prepend_grouped_items_with_hidden_ids(
        vec![HistoryItemGroup {
            items: vec![
                review_boundary("enter", true),
                review_boundary("exit", false),
                user_message("nested-one", "重复请求"),
                user_message("nested-two", "重复请求"),
            ],
            activity_scope: None,
            completion: None,
        }],
        &hidden_ids,
    );

    assert_eq!(
        projection
            .entries()
            .iter()
            .map(|entry| entry.text.as_str())
            .collect::<Vec<_>>(),
        vec!["review started: review", "review completed: review"]
    );
}

#[test]
fn hidden_id_reconciliation_removes_entries_loaded_from_a_newer_page() {
    let mut projection = ConversationProjection::default();
    projection.prepend_items(vec![user_message("nested-one", "重复请求")]);
    projection.add_completion_boundary("nested-one", Some(9));

    projection.remove_hidden_entries(&HashSet::from([String::from("nested-one")]));

    assert!(projection.entries().is_empty());
    assert!(projection.completion_after("nested-one").is_none());
}
