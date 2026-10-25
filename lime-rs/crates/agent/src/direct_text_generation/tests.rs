use super::*;
use serde_json::json;

fn text(value: &str) -> CanonicalLlmEvent {
    CanonicalLlmEvent::TextDelta {
        id: "answer".to_string(),
        text: value.to_string(),
    }
}

fn finish(reason: FinishReason, needs_follow_up: bool) -> CanonicalLlmEvent {
    CanonicalLlmEvent::Finish {
        reason,
        needs_follow_up,
        usage: None,
        response_id: None,
    }
}

async fn collect(
    events: Vec<CanonicalLlmEvent>,
) -> Result<(String, Option<AgentTokenUsage>), String> {
    collect_response(futures::stream::iter(
        events.into_iter().map(Ok::<_, String>),
    ))
    .await
}

#[test]
fn single_sample_request_retains_identity_schema_and_generation_without_tools() {
    let schema = json!({"type": "object", "properties": {"summary": {"type": "string"}}});
    let context = AgentTurnContext {
        output_schema: Some(schema.clone()),
        metadata: std::collections::HashMap::from([(
            "runtime_request".to_string(),
            json!({"harness": {"generation": {"max_output_tokens": 2048, "enable_thinking": false}}}),
        )]),
        ..Default::default()
    };
    let session = SessionConfigBuilder::new("sampling-session")
        .thread_id("source-thread")
        .turn_id("memory-stage1-1")
        .system_prompt("Extract immutable rollout evidence.")
        .turn_context(context)
        .build();
    let request = build_request(&session, "rollout input".to_string());
    assert!(request.tools.is_empty());
    assert_eq!(request.output_schema, Some(schema));
    assert!(request.output_schema_strict);
    assert_eq!(
        request.system_prompt.as_deref(),
        Some("Extract immutable rollout evidence.")
    );
    assert_eq!(request.messages.len(), 1);
    assert!(
        matches!(&request.messages[0].content[..], [CurrentProviderContent::Text(value)] if value == "rollout input")
    );
    assert_eq!(request.generation.max_tokens, Some(2048));
    assert_eq!(
        request.provider_options.get("enable_thinking"),
        Some(&json!(false))
    );
    let metadata = request.metadata.expect("canonical sampling identity");
    assert_eq!(metadata.session_id, "sampling-session");
    assert_eq!(metadata.thread_id, "source-thread");
    assert_eq!(metadata.turn_id, "memory-stage1-1");
}

#[tokio::test]
async fn single_sample_waits_for_terminal_and_preserves_usage() {
    let usage = Usage {
        input_tokens: Some(31),
        output_tokens: Some(12),
        cache_read_input_tokens: Some(7),
        cache_write_input_tokens: Some(3),
        lime_rollout_budget_units: Some(2.into()),
        ..Default::default()
    };
    let result = collect(vec![
        text("one"),
        CanonicalLlmEvent::StepFinish {
            index: 0,
            reason: FinishReason::Stop,
            usage: Some(usage),
        },
        text(" sample"),
        finish(FinishReason::Stop, false),
    ])
    .await
    .expect("terminal response");
    assert_eq!(result.0, "one sample");
    assert_eq!(
        result.1,
        Some(AgentTokenUsage {
            input_tokens: 31,
            output_tokens: 12,
            cached_input_tokens: Some(7),
            cache_creation_input_tokens: Some(3),
            lime_rollout_budget_units: Some(2.into()),
        })
    );
}

#[tokio::test]
async fn single_sample_accepts_completed_message_without_duplicating_deltas() {
    let completed = CanonicalLlmEvent::ResponseItemDone {
        source_id: "answer".to_string(),
        producer: None,
        item: json!({"type": "message", "role": "assistant", "content": [
            {"type": "output_text", "text": "completed "},
            {"type": "output_text", "text": "answer"}
        ]}),
    };
    let result = collect(vec![completed.clone(), finish(FinishReason::Stop, false)])
        .await
        .expect("completed-only provider output");
    assert_eq!(result.0, "completed answer");
    let result = collect(vec![
        text("completed answer"),
        completed,
        finish(FinishReason::Stop, false),
    ])
    .await
    .expect("deltas and completed item");
    assert_eq!(result.0, "completed answer");
}

#[tokio::test]
async fn single_sample_rejects_eof_even_after_step_finish() {
    let error = collect(vec![
        text("partial"),
        CanonicalLlmEvent::StepFinish {
            index: 0,
            reason: FinishReason::Stop,
            usage: None,
        },
    ])
    .await
    .expect_err("step completion is not response completion");
    assert!(error.contains("before completion"), "{error}");
}

#[tokio::test]
async fn single_sample_rejects_tools_truncation_filter_and_follow_up() {
    for event in [
        CanonicalLlmEvent::ToolInputStart {
            id: "call".to_string(),
            name: "exec_command".to_string(),
        },
        CanonicalLlmEvent::CustomToolCall {
            id: "call".to_string(),
            name: "apply_patch".to_string(),
            input: "patch".to_string(),
            namespace: None,
            provider_metadata: Default::default(),
        },
        finish(FinishReason::ToolCall, false),
        finish(FinishReason::Length, false),
        finish(FinishReason::ContentFilter, false),
        finish(FinishReason::Error, false),
        finish(FinishReason::Unknown, false),
        finish(FinishReason::Stop, true),
    ] {
        let scenario = format!("{event:?}");
        assert!(
            collect(vec![text("partial"), event]).await.is_err(),
            "{scenario}"
        );
    }
}

#[tokio::test]
async fn single_sample_propagates_provider_transport_failure() {
    let error = collect_response(futures::stream::iter([
        Ok(text("partial")),
        Err("fixture transport failure"),
    ]))
    .await
    .expect_err("transport failure must not return partial output");
    assert_eq!(error, "fixture transport failure");
}
