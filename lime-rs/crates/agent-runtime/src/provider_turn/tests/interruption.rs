use super::*;
use tool_runtime::tool_executor::RuntimeToolExecutionError;

struct InterruptingTool;

impl RuntimeToolExecutor for InterruptingTool {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            request.context.interrupt_turn();
            Err(RuntimeToolExecutionError::new("Manual intervention", None))
        })
    }
}

#[tokio::test]
async fn trusted_interruption_stops_direct_and_nested_provider_turns_before_resampling() {
    for nested in [false, true] {
        let event = if nested {
            CanonicalLlmEvent::CustomToolCall {
                id: "interrupt-call".into(),
                name: "exec".into(),
                input: "await tools.read({path:'README.md'});".into(),
                namespace: None,
                provider_metadata: Default::default(),
            }
        } else {
            CanonicalLlmEvent::ToolCall {
                id: "interrupt-call".into(),
                name: "read".into(),
                input: serde_json::json!({"path":"README.md"}),
                raw_arguments: None,
                provider_executed: None,
                provider_metadata: Default::default(),
            }
        };
        let provider = Arc::new(ScriptedProvider::new(vec![
            vec![
                Ok(event),
                Ok(CanonicalLlmEvent::Finish {
                    reason: FinishReason::ToolCall,
                    usage: None,
                    needs_follow_up: false,
                    response_id: Some("first".into()),
                }),
            ],
            vec![
                Ok(CanonicalLlmEvent::TextDelta {
                    id: "unexpected".into(),
                    text: "must not resample".into(),
                }),
                Ok(CanonicalLlmEvent::Finish {
                    reason: FinishReason::Stop,
                    usage: None,
                    needs_follow_up: false,
                    response_id: Some("second".into()),
                }),
            ],
        ]));
        let requests = provider.requests.clone();
        let definition =
            RuntimeToolDefinition::new("read", "read", serde_json::json!({"type":"object"}));
        let mut snapshot = RuntimeToolStepSnapshot::new(
            vec![definition.clone()],
            RuntimeToolExecutorHandle::new(Arc::new(InterruptingTool)),
        );
        if nested {
            snapshot = snapshot.with_code_mode_session(
                RuntimeCodeModeSessionHandle::new(Arc::new(NestedDispatchCodeModeSession)),
                vec![RuntimeCodeModeTool {
                    identity: RuntimeToolIdentity::plain("read"),
                    definition,
                    kind: ::code_mode::CodeModeToolKind::Function,
                    code_name: "read".into(),
                    global_name: "read".into(),
                }],
            );
        }
        let token = tokio_util::sync::CancellationToken::new();
        let emitter = Arc::new(RecordingLifecycleEmitter::default());
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            run_current_provider_turn(
                CurrentProviderTurnInput {
                    provider,
                    provider_trace_metadata: None,
                    session_config: crate::session_config::SessionConfigBuilder::new(
                        "interruption-session",
                    )
                    .turn_id("interruption-turn")
                    .max_turns(3)
                    .build(),
                    initial_messages: vec![CurrentProviderMessage::user(vec![
                        CurrentProviderContent::Text("run".into()),
                    ])],
                    tool_step_snapshot_source: RuntimeToolStepSnapshotSourceHandle::fixed(snapshot),
                    hook_snapshot_source: None,
                    model_request_policy: None,
                    tool_lifecycle_emitter: emitter.clone(),
                    working_directory: ".".into(),
                    cancel_token: Some(token.clone()),
                    pending_input: None,
                    mid_turn_compaction: None,
                },
                |_| {},
            ),
        )
        .await
        .expect("interruption must finish promptly")
        .expect("canceled turn is a normal terminal");
        assert!(result.cancelled, "nested={nested}");
        assert!(token.is_cancelled(), "nested={nested}");
        assert_eq!(
            requests.lock().unwrap().len(),
            1,
            "no provider request after takeover; nested={nested}"
        );
        let events = emitter.events();
        let tool_events = events
            .iter()
            .filter(|event| event.tool_name == "read")
            .collect::<Vec<_>>();
        assert_eq!(
            tool_events.len(),
            2,
            "one started and one terminal; nested={nested}"
        );
        assert_eq!(tool_events[0].phase, ToolLifecyclePhase::Started);
        assert_eq!(tool_events[1].phase, ToolLifecyclePhase::Completed);
    }
}
