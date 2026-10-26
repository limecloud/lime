use super::*;
use crate::NoopAppDataSource;
use lime_agent::agent_tools::catalog::LIME_CREATE_IMAGE_TASK_TOOL_NAME;
use lime_core::models::{parse_skill_manifest_from_content, split_skill_frontmatter};

const IMAGE_GENERATE_DEFAULT_SKILL: &str =
    include_str!("../../../../../resources/default-skills/image_generate/SKILL.md");

#[test]
fn default_image_generate_skill_uses_current_native_image_task_tool() {
    let manifest = parse_skill_manifest_from_content(IMAGE_GENERATE_DEFAULT_SKILL)
        .expect("image_generate default skill manifest should parse");
    assert!(
        manifest.compliance.validation_errors.is_empty(),
        "image_generate default skill manifest should be standard: {:?}",
        manifest.compliance.validation_errors
    );
    assert_eq!(manifest.metadata.name.as_deref(), Some("image_generate"));
    assert_eq!(
        manifest.metadata.allowed_tools,
        vec![LIME_CREATE_IMAGE_TASK_TOOL_NAME.to_string()],
        "image_generate must only expose the current native image task tool"
    );
    assert!(
        !manifest
            .metadata
            .allowed_tools
            .iter()
            .any(|tool| tool.eq_ignore_ascii_case("Bash")
                || tool.eq_ignore_ascii_case("tool_search")),
        "image_generate must not expose Bash or tool_search in allowed-tools"
    );

    let (_frontmatter, body) =
        split_skill_frontmatter(IMAGE_GENERATE_DEFAULT_SKILL).expect("frontmatter");
    assert!(
        body.contains(&format!(
            "必须直接调用 `{LIME_CREATE_IMAGE_TASK_TOOL_NAME}`"
        )),
        "image_generate prompt must route through the current native task tool"
    );
    assert!(
        body.contains("不要先调用 `tool_search`") && body.contains("不要通过 `Bash`"),
        "image_generate prompt must forbid tool_search/Bash task-creation detours"
    );
}

#[tokio::test]
async fn runtime_backend_registers_image_generation_task_native_tool() {
    let db: lime_core::database::DbConnection = std::sync::Arc::new(std::sync::Mutex::new(
        rusqlite::Connection::open_in_memory().expect("db"),
    ));
    {
        let conn = db.lock().expect("db lock");
        lime_core::database::schema::create_tables(&conn).expect("schema");
    }
    let backend = RuntimeBackend::with_db(db.clone());
    ExecutionBackend::set_app_data_source(&backend, std::sync::Arc::new(NoopAppDataSource))
        .expect("app data source should be accepted");
    backend
        .agent_state
        .init_agent_with_db(&db)
        .await
        .expect("agent should initialize");
    backend
        .register_current_native_tools_if_available()
        .await
        .expect("current native tools should register");

    assert!(
        backend
            .agent_state
            .contains_native_tool(LIME_CREATE_IMAGE_TASK_TOOL_NAME)
            .await,
        "{LIME_CREATE_IMAGE_TASK_TOOL_NAME} should be registered as the current image task native tool"
    );
}

#[test]
fn image_tool_result_emits_canonical_media_lifecycle_only_for_available_images() {
    use agent_protocol::{
        ItemId, ItemKind, ItemStatus, SessionId, ThreadId, ThreadItem, ThreadItemPayload,
        ToolOutput, TurnId,
    };
    use lime_agent::AgentEvent as RuntimeAgentEvent;
    use serde_json::json;

    for (status, with_sidecar, expected_media) in [
        ("succeeded", true, true),
        ("partial", true, true),
        ("pending", true, false),
        ("failed", true, false),
        ("cancelled", true, false),
        ("succeeded", false, false),
    ] {
        let mut image = json!({"url": "data:image/png;base64,AAAA"});
        if with_sidecar {
            image["sidecarRef"] = json!({"uri": "sidecar://media/result", "mimeType": "image/png"});
        }
        let item = ThreadItem {
            session_id: SessionId::new("session-image"),
            thread_id: ThreadId::new("thread-image"),
            turn_id: TurnId::new("turn-image"),
            item_id: ItemId::new("tool-image"),
            sequence: 5,
            ordinal: 5,
            created_at_ms: 1,
            updated_at_ms: 2,
            completed_at_ms: Some(2),
            kind: ItemKind::Tool,
            status: ItemStatus::Completed,
            payload: ThreadItemPayload::Tool {
                call_id: "call-image".to_string(),
                name: LIME_CREATE_IMAGE_TASK_TOOL_NAME.to_string(),
                arguments: vec![],
                output: Some(ToolOutput {
                    structured_content: Some(json!({"response": {
                        "task_id": "task-image", "task_type": "image_generate", "normalized_status": status,
                        "record": {"result": {"images": [image]}}
                    }})),
                    ..ToolOutput::default()
                }),
            },
            metadata: json!({}),
        };
        let events = super::super::tool_events::runtime_events_from_agent_event(
            &RuntimeAgentEvent::ItemCompleted { item },
        )
        .unwrap();
        assert_eq!(
            events.len(),
            if expected_media { 3 } else { 1 },
            "{status}, sidecar={with_sidecar}"
        );
        if !expected_media {
            continue;
        }
        assert_eq!(
            events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<_>>(),
            ["item.completed", "item.started", "item.completed"]
        );
        let start: ThreadItem = serde_json::from_value(events[1].payload["item"].clone()).unwrap();
        let complete: ThreadItem =
            serde_json::from_value(events[2].payload["item"].clone()).unwrap();
        assert_eq!(start.item_id, complete.item_id);
        assert_eq!(
            complete.item_id.as_str(),
            "item_media-task-result:turn-image:task-image"
        );
        assert_eq!(complete.thread_id.as_str(), "thread-image");
        assert_eq!(complete.turn_id.as_str(), "turn-image");
        assert_eq!(start.status, ItemStatus::InProgress);
        assert_eq!(complete.status, ItemStatus::Completed);
        assert!(!serde_json::to_string(&complete).unwrap().contains("data:image"));
        let ThreadItemPayload::AgentMessage { content_parts, .. } = complete.payload else {
            panic!("media message")
        };
        assert_eq!(content_parts.len(), 1);
        assert!(content_parts[0].is_safe());
        assert!(!serde_json::to_string(&content_parts)
            .unwrap()
            .contains("data:image"));
    }
}
