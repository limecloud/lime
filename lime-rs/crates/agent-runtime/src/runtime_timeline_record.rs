use crate::runtime_timeline::{
    project_runtime_timeline_item, project_runtime_timeline_snapshot,
    project_runtime_timeline_turn, RuntimeTimelineItemPayloadSource, RuntimeTimelineItemProjection,
    RuntimeTimelineItemSource, RuntimeTimelineItemStatusSource, RuntimeTimelineSnapshotProjection,
    RuntimeTimelineSnapshotSource, RuntimeTimelineSnapshotThread, RuntimeTimelineTurnProjection,
    RuntimeTimelineTurnSource, RuntimeTimelineTurnStatusSource,
};
use thread_store::runtime_snapshot::{
    RuntimeItemPayloadRecord, RuntimeItemSnapshotRecord, RuntimeItemStatusRecord,
    RuntimeSessionSnapshotRecord, RuntimeTurnSnapshotRecord, RuntimeTurnStatusRecord,
};
use tool_runtime::tool_result::extract_tool_result_text;

pub type RuntimeTimelineSnapshotRecordProjection =
    RuntimeTimelineSnapshotProjection<RuntimeTimelineTurnProjection, RuntimeTimelineItemProjection>;

pub fn project_runtime_timeline_snapshot_record(
    snapshot: &RuntimeSessionSnapshotRecord,
    dynamic_filtering_enabled: bool,
) -> RuntimeTimelineSnapshotRecordProjection {
    project_runtime_timeline_snapshot(RuntimeTimelineSnapshotSource {
        threads: snapshot
            .threads
            .iter()
            .map(|thread| RuntimeTimelineSnapshotThread {
                thread_id: thread.id.clone(),
                turns: thread
                    .turns
                    .iter()
                    .map(project_runtime_timeline_turn_record)
                    .collect(),
                items: thread
                    .items
                    .iter()
                    .filter_map(|item| {
                        project_runtime_timeline_item_record(item, dynamic_filtering_enabled)
                    })
                    .collect(),
            })
            .collect(),
    })
}

pub fn project_runtime_timeline_turn_record(
    turn: &RuntimeTurnSnapshotRecord,
) -> RuntimeTimelineTurnProjection {
    project_runtime_timeline_turn(RuntimeTimelineTurnSource {
        id: turn.id.clone(),
        thread_id: turn.thread_id.clone(),
        input_text: turn.input_text.clone(),
        status: runtime_turn_status_source(turn.status),
        started_at: turn.started_at.map(|value| value.to_rfc3339()),
        completed_at: turn.completed_at.map(|value| value.to_rfc3339()),
        error_message: turn.error_message.clone(),
        created_at: turn.created_at.to_rfc3339(),
        updated_at: turn.updated_at.to_rfc3339(),
    })
}

fn runtime_turn_status_source(status: RuntimeTurnStatusRecord) -> RuntimeTimelineTurnStatusSource {
    match status {
        RuntimeTurnStatusRecord::Queued => RuntimeTimelineTurnStatusSource::Queued,
        RuntimeTurnStatusRecord::Running => RuntimeTimelineTurnStatusSource::Running,
        RuntimeTurnStatusRecord::Completed => RuntimeTimelineTurnStatusSource::Completed,
        RuntimeTurnStatusRecord::Failed => RuntimeTimelineTurnStatusSource::Failed,
        RuntimeTurnStatusRecord::Aborted => RuntimeTimelineTurnStatusSource::Aborted,
    }
}

pub fn project_runtime_timeline_item_record(
    item: &RuntimeItemSnapshotRecord,
    dynamic_filtering_enabled: bool,
) -> Option<RuntimeTimelineItemProjection> {
    project_runtime_timeline_item(RuntimeTimelineItemSource {
        id: item.id.clone(),
        thread_id: item.thread_id.clone(),
        turn_id: item.turn_id.clone(),
        sequence: item.sequence,
        status: runtime_item_status_source(item.status),
        started_at: item.started_at.to_rfc3339(),
        completed_at: item.completed_at.map(|value| value.to_rfc3339()),
        updated_at: item.updated_at.to_rfc3339(),
        payload: runtime_item_payload_source(&item.payload, dynamic_filtering_enabled),
    })
}

fn runtime_item_status_source(status: RuntimeItemStatusRecord) -> RuntimeTimelineItemStatusSource {
    match status {
        RuntimeItemStatusRecord::InProgress => RuntimeTimelineItemStatusSource::InProgress,
        RuntimeItemStatusRecord::Completed => RuntimeTimelineItemStatusSource::Completed,
        RuntimeItemStatusRecord::Failed => RuntimeTimelineItemStatusSource::Failed,
    }
}

fn runtime_item_payload_source(
    payload: &RuntimeItemPayloadRecord,
    dynamic_filtering_enabled: bool,
) -> RuntimeTimelineItemPayloadSource {
    match payload {
        RuntimeItemPayloadRecord::InternalTranscript { .. } => {
            RuntimeTimelineItemPayloadSource::InternalTranscript
        }
        RuntimeItemPayloadRecord::UserMessage { content } => {
            RuntimeTimelineItemPayloadSource::UserMessage {
                content: content.clone(),
            }
        }
        RuntimeItemPayloadRecord::AgentMessage { text } => {
            RuntimeTimelineItemPayloadSource::AgentMessage { text: text.clone() }
        }
        RuntimeItemPayloadRecord::Plan { text } => {
            RuntimeTimelineItemPayloadSource::Plan { text: text.clone() }
        }
        RuntimeItemPayloadRecord::RuntimeStatus {
            phase,
            title,
            detail,
            checkpoints,
        } => RuntimeTimelineItemPayloadSource::RuntimeStatus {
            phase: phase.clone(),
            title: title.clone(),
            detail: detail.clone(),
            checkpoints: checkpoints.clone(),
        },
        RuntimeItemPayloadRecord::FileArtifact {
            path,
            source,
            content,
            metadata,
        } => RuntimeTimelineItemPayloadSource::FileArtifact {
            path: path.clone(),
            source: source.clone(),
            content: content.clone(),
            metadata: metadata.clone(),
        },
        RuntimeItemPayloadRecord::Reasoning {
            text,
            summary,
            metadata,
        } => RuntimeTimelineItemPayloadSource::Reasoning {
            text: text.clone(),
            summary: summary.clone(),
            metadata: metadata.clone(),
        },
        RuntimeItemPayloadRecord::ToolCall {
            tool_name,
            arguments,
            output,
            success,
            error,
            metadata,
        } => {
            let output_text = output
                .as_ref()
                .map(|result| extract_tool_result_text(result, dynamic_filtering_enabled))
                .filter(|text| !text.is_empty());
            RuntimeTimelineItemPayloadSource::ToolCall {
                tool_name: tool_name.clone(),
                arguments: arguments.clone(),
                output_text,
                success: *success,
                error: error.clone(),
                metadata: metadata.clone(),
            }
        }
        RuntimeItemPayloadRecord::ApprovalRequest {
            request_id,
            action_type,
            prompt,
            tool_name,
            arguments,
            response,
        } => RuntimeTimelineItemPayloadSource::ApprovalRequest {
            request_id: request_id.clone(),
            action_type: action_type.clone(),
            prompt: prompt.clone(),
            tool_name: tool_name.clone(),
            arguments: arguments.clone(),
            response: response.clone(),
        },
        RuntimeItemPayloadRecord::RequestUserInput {
            request_id,
            action_type,
            prompt,
            requested_schema,
            response,
        } => RuntimeTimelineItemPayloadSource::RequestUserInput {
            request_id: request_id.clone(),
            action_type: action_type.clone(),
            prompt: prompt.clone(),
            requested_schema: requested_schema.clone(),
            response: response.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_timeline::{
        RuntimeTimelineItemPayload, RuntimeTimelineItemStatus, RuntimeTimelineRequestOption,
        RuntimeTimelineRequestQuestion, RuntimeTimelineTurnStatus,
        RUNTIME_REQUEST_QUESTIONS_SCHEMA_KEY,
    };
    use chrono::Utc;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use thread_store::runtime_snapshot::{
        RuntimeItemPayloadRecord, RuntimeItemSnapshotRecord, RuntimeItemStatusRecord,
        RuntimeSessionSnapshotRecord, RuntimeThreadSnapshotRecord, RuntimeTurnSnapshotRecord,
        RuntimeTurnStatusRecord,
    };

    fn runtime_item(payload: RuntimeItemPayloadRecord) -> RuntimeItemSnapshotRecord {
        let now = Utc::now();
        RuntimeItemSnapshotRecord {
            id: "item-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 1,
            status: RuntimeItemStatusRecord::Completed,
            started_at: now,
            completed_at: Some(now),
            updated_at: now,
            payload,
        }
    }

    #[test]
    fn item_record_projector_extracts_tool_output_text() {
        let item = runtime_item(RuntimeItemPayloadRecord::ToolCall {
            tool_name: "web_search".to_string(),
            arguments: Some(serde_json::json!({ "q": "lime" })),
            output: Some(serde_json::json!({
                "content": [
                    { "type": "text", "text": "Lime 是一个智能体编码系统" }
                ]
            })),
            success: Some(true),
            error: None,
            metadata: Some(serde_json::json!({ "source": "runtime_record" })),
        });

        let item =
            project_runtime_timeline_item_record(&item, false).expect("expected projected item");

        assert_eq!(item.id, "item-1");
        assert_eq!(item.status, RuntimeTimelineItemStatus::Completed);
        match item.payload {
            RuntimeTimelineItemPayload::ToolCall {
                tool_name,
                arguments,
                output,
                success,
                error,
                metadata,
            } => {
                assert_eq!(tool_name, "web_search");
                assert_eq!(
                    arguments.as_ref(),
                    Some(&serde_json::json!({ "q": "lime" }))
                );
                assert_eq!(output.as_deref(), Some("Lime 是一个智能体编码系统"));
                assert_eq!(success, Some(true));
                assert_eq!(error, None);
                assert_eq!(
                    metadata.as_ref(),
                    Some(&serde_json::json!({ "source": "runtime_record" }))
                );
            }
            other => panic!("unexpected payload: {other:?}"),
        }
    }

    #[test]
    fn item_record_projector_drops_internal_transcript() {
        let item = runtime_item(RuntimeItemPayloadRecord::InternalTranscript {
            role: "user".to_string(),
            content_json: serde_json::json!([{ "type": "text", "text": "hidden" }]),
            metadata_json: serde_json::json!({ "userVisible": true }),
            created_timestamp: 42,
        });

        assert!(project_runtime_timeline_item_record(&item, false).is_none());
    }

    #[test]
    fn item_record_projector_normalizes_request_user_input_questions() {
        let item = runtime_item(RuntimeItemPayloadRecord::RequestUserInput {
            request_id: "request-1".to_string(),
            action_type: "elicitation".to_string(),
            prompt: Some("请补充发布渠道".to_string()),
            requested_schema: Some(serde_json::json!({
                RUNTIME_REQUEST_QUESTIONS_SCHEMA_KEY: [
                    {
                        "question": "请补充发布渠道",
                        "header": "channel",
                        "options": [
                            {
                                "label": "小红书",
                                "description": "适合图文种草"
                            },
                            {
                                "value": "wechat-video",
                                "label": "视频号"
                            }
                        ],
                        "multiSelect": false
                    }
                ],
                "type": "object",
                "properties": {
                    "channel": { "type": "string" }
                }
            })),
            response: None,
        });

        let item =
            project_runtime_timeline_item_record(&item, false).expect("expected projected item");

        match item.payload {
            RuntimeTimelineItemPayload::RequestUserInput {
                request_id,
                action_type,
                prompt,
                questions,
                response,
            } => {
                assert_eq!(request_id, "request-1");
                assert_eq!(action_type, "elicitation");
                assert_eq!(prompt.as_deref(), Some("请补充发布渠道"));
                assert_eq!(
                    questions,
                    Some(vec![RuntimeTimelineRequestQuestion {
                        question: "请补充发布渠道".to_string(),
                        header: Some("channel".to_string()),
                        options: Some(vec![
                            RuntimeTimelineRequestOption {
                                label: "小红书".to_string(),
                                description: Some("适合图文种草".to_string()),
                            },
                            RuntimeTimelineRequestOption {
                                label: "视频号".to_string(),
                                description: None,
                            },
                        ]),
                        multi_select: Some(false),
                    }])
                );
                assert_eq!(response, None);
            }
            other => panic!("unexpected payload: {other:?}"),
        }
    }

    #[test]
    fn snapshot_record_projector_flattens_threads() {
        let now = Utc::now();
        let completed_turn = RuntimeTurnSnapshotRecord {
            id: "turn-1".to_string(),
            session_id: "session-1".to_string(),
            thread_id: "thread-1".to_string(),
            status: RuntimeTurnStatusRecord::Completed,
            input_text: Some("整理计划".to_string()),
            error_message: None,
            context_override: None,
            output_schema_runtime: None,
            created_at: now,
            started_at: Some(now),
            completed_at: Some(now),
            updated_at: now,
        };
        let queued_turn = RuntimeTurnSnapshotRecord {
            id: "turn-2".to_string(),
            session_id: "session-1".to_string(),
            thread_id: "thread-2".to_string(),
            status: RuntimeTurnStatusRecord::Queued,
            input_text: None,
            error_message: None,
            context_override: None,
            output_schema_runtime: None,
            created_at: now,
            started_at: None,
            completed_at: None,
            updated_at: now,
        };
        let snapshot = RuntimeSessionSnapshotRecord {
            session_id: "session-1".to_string(),
            threads: vec![
                RuntimeThreadSnapshotRecord {
                    id: "thread-1".to_string(),
                    session_id: "session-1".to_string(),
                    working_dir: PathBuf::from("/tmp/thread-1"),
                    created_at: now,
                    updated_at: now,
                    metadata: HashMap::new(),
                    turns: vec![completed_turn],
                    items: vec![runtime_item(RuntimeItemPayloadRecord::InternalTranscript {
                        role: "user".to_string(),
                        content_json: serde_json::json!([{ "type": "text", "text": "hidden" }]),
                        metadata_json: serde_json::json!({}),
                        created_timestamp: 42,
                    })],
                },
                RuntimeThreadSnapshotRecord {
                    id: "thread-2".to_string(),
                    session_id: "session-1".to_string(),
                    working_dir: PathBuf::from("/tmp/thread-2"),
                    created_at: now,
                    updated_at: now,
                    metadata: HashMap::new(),
                    turns: vec![queued_turn],
                    items: vec![RuntimeItemSnapshotRecord {
                        id: "user-1".to_string(),
                        thread_id: "thread-2".to_string(),
                        turn_id: "turn-2".to_string(),
                        sequence: 1,
                        status: RuntimeItemStatusRecord::Completed,
                        started_at: now,
                        completed_at: Some(now),
                        updated_at: now,
                        payload: RuntimeItemPayloadRecord::UserMessage {
                            content: "用户输入".to_string(),
                        },
                    }],
                },
            ],
        };

        let projection = project_runtime_timeline_snapshot_record(&snapshot, false);

        assert_eq!(projection.thread_id.as_deref(), Some("thread-1"));
        assert_eq!(
            projection
                .turns
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            vec!["turn-1", "turn-2"]
        );
        assert_eq!(
            projection.turns[1].status,
            RuntimeTimelineTurnStatus::Running
        );
        assert_eq!(
            projection
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["user-1"]
        );
        assert_eq!(projection.turns[1].prompt_text, "");
    }
}
