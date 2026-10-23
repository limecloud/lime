use super::support::*;
use super::*;
use crate::memory_store::MemorySourcePolicy;

#[tokio::test]
async fn source_preferences_follow_the_source_thread_and_canonical_tool_items() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    std::fs::write(
        &config,
        "memory:\n  enabled: true\n  disable_on_external_context: true\n",
    )
    .unwrap();
    let projection =
        Arc::new(ProjectionStore::initialize(root.path().join("projection.sqlite")).unwrap());
    let core = RuntimeCore::default()
        .with_app_config_path(config.clone())
        .with_projection_store(projection);
    for (session_id, thread_id, tool) in [
        ("source-local", "thread-local", "shell"),
        ("source-external", "thread-external", "mcp__docs__search"),
    ] {
        let turn_id = format!("turn-{session_id}");
        core.start_session(AgentSessionStartParams {
            session_id: Some(session_id.into()),
            thread_id: Some(thread_id.into()),
            app_id: "test".into(),
            workspace_id: None,
            business_object_ref: None,
            locale: None,
        })
        .unwrap();
        core.start_turn(
            AgentSessionTurnStartParams {
                session_id: session_id.into(),
                turn_id: Some(turn_id.clone()),
                input: AgentInput {
                    text: "hello".into(),
                    attachments: vec![],
                },
                runtime_options: None,
                queue_if_busy: false,
                skip_pre_submit_resume: false,
            },
            RuntimeHostContext::default(),
        )
        .await
        .unwrap();
        core.append_external_runtime_events(
            session_id,
            Some(&turn_id),
            vec![
                canonical_tool_started_event(session_id, thread_id, &turn_id, session_id, tool),
                canonical_tool_completed_event(
                    session_id, thread_id, &turn_id, session_id, tool, "done",
                ),
            ],
        )
        .unwrap();
    }
    assert!(core.source_eligible(Some("thread-local")).await.unwrap());
    assert!(!core.source_eligible(Some("thread-external")).await.unwrap());
    assert!(!core.source_eligible(None).await.unwrap());
    assert!(!core.source_eligible(Some("missing")).await.unwrap());
    std::fs::write(
        &config,
        "memory:\n  enabled: true\n  disable_on_external_context: false\n",
    )
    .unwrap();
    assert!(core.source_eligible(Some("thread-external")).await.unwrap());
    std::fs::write(
        &config,
        "memory:\n  enabled: true\n  auto:\n    enabled: false\n",
    )
    .unwrap();
    assert!(core.session_memory_enabled("source-local"));
    assert!(!core.session_memory_generation_enabled("source-local"));
    assert!(!core.source_eligible(Some("thread-local")).await.unwrap());
    std::fs::write(&config, "memory:\n  enabled: false\n").unwrap();
    assert!(!core.session_memory_enabled("source-local"));
    assert!(!core.source_eligible(Some("thread-local")).await.unwrap());
}
