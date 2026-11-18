use super::*;

#[tokio::test]
async fn slow_event_sink_does_not_timeout_a_buffered_provider_completion() {
    let mut turn_context = agent_protocol::turn_context::TurnContextOverride::default();
    turn_context.metadata.insert(
        "runtime_request".to_string(),
        serde_json::json!({
            "harness": {
                "generation": {
                    "first_visible_output_timeout_ms": 250,
                    "provider_step_timeout_ms": 250
                }
            }
        }),
    );
    let provider = Arc::new(ScriptedProvider::new(vec![vec![
        Ok(CanonicalLlmEvent::TextStart {
            id: "text-1".into(),
        }),
        Ok(CanonicalLlmEvent::TextDelta {
            id: "text-1".into(),
            text: "done".into(),
        }),
        Ok(CanonicalLlmEvent::TextEnd {
            id: "text-1".into(),
        }),
        Ok(CanonicalLlmEvent::Finish {
            reason: FinishReason::Stop,
            usage: None,
            needs_follow_up: false,
            response_id: None,
        }),
    ]]));
    let mut events = Vec::new();
    let execution = run_current_provider_turn(
        CurrentProviderTurnInput {
            provider,
            provider_trace_metadata: None,
            session_config: crate::session_config::SessionConfigBuilder::new("session-1")
                .turn_id("turn-1")
                .max_turns(1)
                .turn_context(turn_context)
                .build(),
            initial_messages: vec![CurrentProviderMessage::user(vec![
                CurrentProviderContent::Text("hello".into()),
            ])],
            tool_step_snapshot_source: RuntimeToolStepSnapshotSourceHandle::fixed(
                RuntimeToolStepSnapshot::new(
                    Vec::new(),
                    RuntimeToolExecutorHandle::new(Arc::new(EchoTool)),
                ),
            ),
            hook_snapshot_source: None,
            model_request_policy: None,
            tool_lifecycle_emitter: Arc::new(RecordingLifecycleEmitter::default()),
            working_directory: PathBuf::from("."),
            cancel_token: None,
            pending_input: None,
            mid_turn_compaction: None,
        },
        |event| {
            if matches!(
                event,
                CurrentProviderTurnEvent::TextStart { .. }
                    | CurrentProviderTurnEvent::TextDelta { .. }
                    | CurrentProviderTurnEvent::TextEnd { .. }
            ) {
                std::thread::sleep(Duration::from_millis(300));
            }
            events.push(event);
        },
    )
    .await
    .expect("local persistence must not fail a completed provider response");

    assert_eq!(execution.text_output, "done");
    assert!(execution.event_errors.is_empty());
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, CurrentProviderTurnEvent::TextEnd { .. }))
            .count(),
        1
    );
}
