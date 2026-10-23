use super::support::*;
use super::*;
use crate::runtime::memory_prompt::{CONTEXT_PACKET_TELEMETRY_KEY, MEMORY_PROMPT_CONTEXT_KEY};

fn read_response(content: &str, truncated: bool) -> MemoryStoreReadResponse {
    MemoryStoreReadResponse {
        path: "memory_summary.md".to_string(),
        start_line_number: 1,
        content: content.to_string(),
        truncated,
        citation: MemoryStoreCitation {
            path: "memory_summary.md".to_string(),
            start_line_number: 1,
            end_line_number: 1,
        },
    }
}

#[tokio::test]
async fn disabling_memory_stops_context_injection_on_the_next_turn() {
    let data = Arc::new(
        TestSessionDataSource::new()
            .with_memory_store_read_response(Ok(read_response("remember this", false))),
    );
    let (backend, core, _config) = start_memory_prompt_turn_with_core(data, None, |backend| {
        RuntimeCore::with_backend(backend)
    })
    .await;
    core.append_external_runtime_events(
        "sess_memory_prompt",
        Some("turn_memory_prompt"),
        vec![crate::RuntimeEvent::new(
            "turn.completed",
            serde_json::json!({}),
        )],
    )
    .unwrap();
    std::fs::write(core.app_config_path(), "memory:\n  enabled: false\n").unwrap();
    core.start_turn(
        AgentSessionTurnStartParams {
            session_id: "sess_memory_prompt".into(),
            turn_id: Some("turn-memory-disabled".into()),
            input: AgentInput {
                text: "next".into(),
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
    let requests = backend.requests.lock().unwrap();
    assert!(requests[0]
        .runtime_options
        .as_ref()
        .and_then(RuntimeOptions::runtime_metadata)
        .unwrap()
        .get(MEMORY_PROMPT_CONTEXT_KEY)
        .is_some());
    assert!(requests[1]
        .runtime_options
        .as_ref()
        .and_then(RuntimeOptions::runtime_metadata)
        .and_then(|metadata| metadata.get(MEMORY_PROMPT_CONTEXT_KEY))
        .is_none());
}

async fn start_memory_prompt_turn(
    data_source: Arc<TestSessionDataSource>,
    runtime_options: Option<RuntimeOptions>,
) -> Arc<RecordingBackend> {
    start_memory_prompt_turn_with_core(data_source, runtime_options, |backend| {
        RuntimeCore::with_backend(backend)
    })
    .await
    .0
}

async fn start_memory_prompt_turn_with_sidecar(
    data_source: Arc<TestSessionDataSource>,
    runtime_options: Option<RuntimeOptions>,
) -> (Arc<RecordingBackend>, Arc<SidecarStore>, tempfile::TempDir) {
    let sidecar_root = tempfile::tempdir().expect("sidecar root");
    let sidecar_store = Arc::new(SidecarStore::new(sidecar_root.path()).expect("sidecar store"));
    let sidecar_store_for_core = sidecar_store.clone();
    let (backend, _, _config) =
        start_memory_prompt_turn_with_core(data_source, runtime_options, move |backend| {
            RuntimeCore::with_backend(backend).with_sidecar_store(sidecar_store_for_core.clone())
        })
        .await;

    (backend, sidecar_store, sidecar_root)
}

async fn start_memory_prompt_turn_with_core(
    data_source: Arc<TestSessionDataSource>,
    runtime_options: Option<RuntimeOptions>,
    build_core: impl FnOnce(Arc<RecordingBackend>) -> RuntimeCore,
) -> (Arc<RecordingBackend>, RuntimeCore, tempfile::TempDir) {
    let backend = Arc::new(RecordingBackend::default());
    let config = tempfile::tempdir().unwrap();
    let config_path = config.path().join("config.yaml");
    std::fs::write(&config_path, "memory:\n  enabled: true\n").unwrap();
    let core = build_core(backend.clone())
        .with_app_data_source(data_source)
        .with_app_config_path(config_path);
    let session = core
        .start_session(AgentSessionStartParams {
            session_id: Some("sess_memory_prompt".to_string()),
            thread_id: Some("thread_memory_prompt".to_string()),
            app_id: "content-studio".to_string(),
            workspace_id: Some("default".to_string()),
            business_object_ref: None,
            locale: None,
        })
        .expect("session")
        .session;

    core.start_turn(
        AgentSessionTurnStartParams {
            session_id: session.session_id,
            turn_id: Some("turn_memory_prompt".to_string()),
            input: AgentInput {
                text: "hello".to_string(),
                attachments: Vec::new(),
            },
            runtime_options,
            queue_if_busy: false,
            skip_pre_submit_resume: false,
        },
        RuntimeHostContext::default(),
    )
    .await
    .expect("turn");

    (backend, core, config)
}

#[tokio::test]
async fn start_turn_injects_workspace_memory_summary_context() {
    let data_source = Arc::new(
        TestSessionDataSource::new()
            .with_memory_store_read_response(Ok(read_response("Prefer concise answers.\n", false))),
    );
    let runtime_options = Some(RuntimeOptions {
        runtime_request: Some(RuntimeRequest {
            workspace_root: Some("/tmp/workspace-memory".to_string()),
            ..RuntimeRequest::default()
        }),
        ..RuntimeOptions::default()
    });

    let (backend, sidecar_store, _sidecar_root) =
        start_memory_prompt_turn_with_sidecar(data_source.clone(), runtime_options).await;

    let requests = backend
        .requests
        .lock()
        .expect("test backend requests mutex poisoned");
    let metadata = requests[0]
        .runtime_options
        .as_ref()
        .and_then(app_server_protocol::RuntimeOptions::runtime_metadata)
        .expect("runtime metadata");
    let context = metadata
        .get(MEMORY_PROMPT_CONTEXT_KEY)
        .expect("memory context");

    assert_eq!(context["scope"].as_str(), Some("workspace"));
    assert_eq!(
        context["workspaceRoot"].as_str(),
        Some("/tmp/workspace-memory")
    );
    assert_eq!(context["path"].as_str(), Some("memory_summary.md"));
    assert_eq!(context["content"].as_str(), Some("Prefer concise answers."));
    assert_eq!(
        context["sidecarRef"]["kind"].as_str(),
        Some("memory_summary_context")
    );
    let sidecar_path = context["sidecarRef"]["relativePath"]
        .as_str()
        .expect("memory sidecar relative path");
    assert_eq!(
        sidecar_store.read_text(sidecar_path).as_deref(),
        Some("Prefer concise answers.")
    );
    let sidecar_content = sidecar_store
        .read_text(sidecar_path)
        .expect("memory sidecar content");
    assert!(!sidecar_content.contains("memory_soul_prompt_context"));
    assert!(!sidecar_content.contains("Style profile:"));
    assert!(!sidecar_content.contains("## Interaction Soul"));
    assert_eq!(
        context["contextPacketTelemetry"]["packets"][0]["kind"].as_str(),
        Some("long_term_memory_summary")
    );
    assert_eq!(
        metadata[CONTEXT_PACKET_TELEMETRY_KEY]["packets"][0]["source"].as_str(),
        Some("memory.store")
    );
    assert_eq!(
        metadata[CONTEXT_PACKET_TELEMETRY_KEY]["packets"][0]["admitted"].as_bool(),
        Some(true)
    );
    assert_eq!(
        metadata[CONTEXT_PACKET_TELEMETRY_KEY]["packets"][0]["fragmentEnvelope"]
            ["sidecar_reference"]["kind"]
            .as_str(),
        Some("memory_summary_context")
    );
    assert_eq!(
        metadata[CONTEXT_PACKET_TELEMETRY_KEY]["packets"][0]["fragmentEnvelope"]
            ["sidecar_reference"]["uri"]
            .as_str(),
        context["sidecarRef"]["ref"].as_str()
    );

    let read_requests = data_source.memory_store_read_requests();
    assert_eq!(read_requests.len(), 1);
    assert_eq!(read_requests[0].root.scope, MemoryStoreScope::Workspace);
    assert_eq!(
        read_requests[0].root.workspace_root.as_deref(),
        Some("/tmp/workspace-memory")
    );
    assert_eq!(read_requests[0].path, "memory_summary.md");
}

#[tokio::test]
async fn start_turn_falls_back_to_global_memory_when_workspace_summary_is_missing() {
    let data_source = Arc::new(
        TestSessionDataSource::new().with_memory_store_read_sequence(vec![
            Err("workspace summary missing".to_string()),
            Ok(read_response(
                "Global memory survives workspace cleanup.\n",
                false,
            )),
        ]),
    );
    let runtime_options = Some(RuntimeOptions {
        runtime_request: Some(RuntimeRequest {
            workspace_root: Some("/tmp/workspace-memory".to_string()),
            ..RuntimeRequest::default()
        }),
        ..RuntimeOptions::default()
    });

    let backend = start_memory_prompt_turn(data_source.clone(), runtime_options).await;
    let requests = backend
        .requests
        .lock()
        .expect("test backend requests mutex poisoned");
    let metadata = requests[0]
        .runtime_options
        .as_ref()
        .and_then(app_server_protocol::RuntimeOptions::runtime_metadata)
        .expect("runtime metadata");
    let context = metadata
        .get(MEMORY_PROMPT_CONTEXT_KEY)
        .expect("global fallback memory context");
    assert_eq!(context["scope"].as_str(), Some("global"));
    assert_eq!(
        context["content"].as_str(),
        Some("Global memory survives workspace cleanup.")
    );

    let read_requests = data_source.memory_store_read_requests();
    assert_eq!(read_requests.len(), 2);
    assert_eq!(read_requests[0].root.scope, MemoryStoreScope::Workspace);
    assert_eq!(read_requests[1].root.scope, MemoryStoreScope::Global);
}

#[tokio::test]
async fn start_turn_skips_empty_memory_summary() {
    let data_source = Arc::new(
        TestSessionDataSource::new()
            .with_memory_store_read_response(Ok(read_response("   \n", false))),
    );

    let backend = start_memory_prompt_turn(data_source, None).await;

    let requests = backend
        .requests
        .lock()
        .expect("test backend requests mutex poisoned");
    let metadata = requests[0]
        .runtime_options
        .as_ref()
        .and_then(app_server_protocol::RuntimeOptions::runtime_metadata);
    assert!(metadata
        .and_then(|metadata| metadata.get(MEMORY_PROMPT_CONTEXT_KEY))
        .is_none());
}

#[tokio::test]
async fn start_turn_does_not_block_when_memory_summary_read_fails() {
    let data_source = Arc::new(
        TestSessionDataSource::new()
            .with_memory_store_read_response(Err("memory unavailable".to_string())),
    );

    let backend = start_memory_prompt_turn(data_source.clone(), None).await;

    let requests = backend
        .requests
        .lock()
        .expect("test backend requests mutex poisoned");
    assert_eq!(requests.len(), 1);
    let metadata = requests[0]
        .runtime_options
        .as_ref()
        .and_then(app_server_protocol::RuntimeOptions::runtime_metadata);
    assert!(metadata
        .and_then(|metadata| metadata.get(MEMORY_PROMPT_CONTEXT_KEY))
        .is_none());
    assert_eq!(data_source.memory_store_read_requests().len(), 1);
}

#[tokio::test]
async fn start_turn_rejects_secret_like_memory_summary_packet() {
    let data_source = Arc::new(
        TestSessionDataSource::new().with_memory_store_read_response(Ok(read_response(
            "api_key = abcdefghijklmnop\n",
            false,
        ))),
    );

    let backend = start_memory_prompt_turn(data_source, None).await;

    let requests = backend
        .requests
        .lock()
        .expect("test backend requests mutex poisoned");
    let metadata = requests[0]
        .runtime_options
        .as_ref()
        .and_then(app_server_protocol::RuntimeOptions::runtime_metadata)
        .expect("runtime metadata");
    let telemetry = &metadata[CONTEXT_PACKET_TELEMETRY_KEY];
    assert_eq!(telemetry["admittedCount"].as_u64(), Some(0));
    assert_eq!(
        telemetry["packets"][0]["rejectedReason"].as_str(),
        Some("secret_like")
    );
}

#[tokio::test]
async fn start_turn_rejects_secret_like_memory_summary_without_sidecar() {
    let data_source = Arc::new(
        TestSessionDataSource::new().with_memory_store_read_response(Ok(read_response(
            "api_key = abcdefghijklmnop\n",
            false,
        ))),
    );

    let (backend, sidecar_store, _sidecar_root) =
        start_memory_prompt_turn_with_sidecar(data_source, None).await;

    let requests = backend
        .requests
        .lock()
        .expect("test backend requests mutex poisoned");
    let metadata = requests[0]
        .runtime_options
        .as_ref()
        .and_then(app_server_protocol::RuntimeOptions::runtime_metadata)
        .expect("runtime metadata");
    let context = metadata
        .get(MEMORY_PROMPT_CONTEXT_KEY)
        .expect("memory context");
    assert!(context.get("sidecarRef").is_none());
    assert_eq!(
        metadata[CONTEXT_PACKET_TELEMETRY_KEY]["packets"][0]["rejectedReason"].as_str(),
        Some("secret_like")
    );
    assert!(sidecar_store
        .read_text("sessions/sess_memory_prompt/context/memory-summary-turn_memory_prompt.md")
        .is_none());
}
