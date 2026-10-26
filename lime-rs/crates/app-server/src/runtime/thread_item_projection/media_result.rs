use super::base_item;
use super::compact_json;
use super::event_metadata;
use super::StoredSession;
use agent_protocol::response_item::MessagePhase;
use agent_protocol::{
    ItemId, ItemKind, ItemStatus, MessageContentPart, ThreadItem, ThreadItemPayload, ToolOutput,
};
use app_server_protocol::AgentEvent;
use runtime_core::runtime_media_part_from_reference;
use runtime_core::RuntimeMediaPartInput;
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;

const IMAGE_TASK_TOOL_NAME: &str = "lime_create_image_generation_task";
const EVENT_OWNER_FACTS_SOURCE: &str = "media_task_result_owner_facts";
const STORE_OWNER_FACTS_SOURCE: &str = "media_task_store_owner_facts";

pub(in crate::runtime) struct MediaTaskRecordProjectionInput<'a> {
    pub(in crate::runtime) task_id: &'a str,
    pub(in crate::runtime) task_type: &'a str,
    pub(in crate::runtime) normalized_status: &'a str,
    pub(in crate::runtime) artifact_path: Option<&'a str>,
    pub(in crate::runtime) record: &'a Value,
    pub(in crate::runtime) thread_id: Option<&'a str>,
    pub(in crate::runtime) turn_id: Option<&'a str>,
    pub(in crate::runtime) sequence: u64,
    pub(in crate::runtime) timestamp: &'a str,
}

pub(super) fn upsert_from_event(
    stored: &StoredSession,
    event: &AgentEvent,
    items: &mut HashMap<String, Value>,
) {
    let Some(item) = item_from_event(stored, event) else {
        return;
    };
    let Some(item_id) = string_field(&item, &["id"]) else {
        return;
    };
    items.entry(item_id).or_insert(item);
}

fn item_from_event(stored: &StoredSession, event: &AgentEvent) -> Option<Value> {
    if event.event_type != "item.completed" {
        return None;
    }
    let item = serde_json::from_value::<ThreadItem>(event.payload.get("item")?.clone()).ok()?;
    let mut media = completed_tool_media_item(&item)?;
    media.session_id = agent_protocol::SessionId::new(stored.session.session_id.clone());
    Some(super::super::read_model::canonical_item_to_agent_detail(
        &media,
    ))
}

/// Project the durable image result through the same canonical Item channel as
/// the completed tool. The legacy read adapter delegates to this projection.
pub(crate) fn completed_tool_media_item(item: &ThreadItem) -> Option<ThreadItem> {
    if item.status != ItemStatus::Completed {
        return None;
    }
    let ThreadItemPayload::Tool {
        call_id,
        name,
        output: Some(output),
        ..
    } = &item.payload
    else {
        return None;
    };
    if output.error.is_some() {
        return None;
    }
    let metadata = &item.metadata;
    let response = structured_response(output);
    let record = object_field(metadata, &["record"])
        .or_else(|| response.and_then(|value| object_field(value, &["record"])))?;
    if !is_image_task_result(name, metadata, response, record) {
        return None;
    }

    let record_with_result;
    let record = if record.get("result").is_some() {
        record
    } else if let Some(result) = object_field(metadata, &["result"])
        .or_else(|| response.and_then(|value| object_field(value, &["result"])))
    {
        record_with_result = record_with_result_field(record, result);
        &record_with_result
    } else {
        record
    };
    let task_id = task_id(metadata, response, record)?;
    let task_type = string_field(metadata, &["task_type", "taskType"])
        .or_else(|| response.and_then(|value| string_field(value, &["task_type", "taskType"])))
        .or_else(|| string_field(record, &["task_type", "taskType"]))
        .unwrap_or_else(|| "image_generate".to_string());
    let normalized_status = string_field(
        metadata,
        &["normalized_status", "normalizedStatus", "status"],
    )
    .or_else(|| {
        response.and_then(|value| {
            string_field(value, &["normalized_status", "normalizedStatus", "status"])
        })
    })
    .or_else(|| string_field(record, &["normalized_status", "normalizedStatus", "status"]))?;
    if !matches!(normalized_status.as_str(), "succeeded" | "partial") {
        return None;
    }
    let artifact_path = string_field(metadata, &["artifact_path", "artifactPath"]).or_else(|| {
        response.and_then(|value| string_field(value, &["artifact_path", "artifactPath"]))
    });
    let content_parts = record
        .pointer("/result/images")?
        .as_array()?
        .iter()
        .enumerate()
        .filter_map(|(index, image)| {
            media_content_part_from_image(image, index, EVENT_OWNER_FACTS_SOURCE)
        })
        .filter_map(|part| serde_json::from_value::<MessageContentPart>(part).ok())
        .filter(MessageContentPart::is_safe)
        .collect::<Vec<_>>();
    if content_parts.is_empty() {
        return None;
    }
    let mut media = item.clone();
    media.item_id = media_item_id(item.turn_id.as_str(), &task_id);
    media.ordinal = 0;
    media.kind = ItemKind::AgentMessage;
    media.created_at_ms = item.completed_at_ms.unwrap_or(item.updated_at_ms);
    media.payload = ThreadItemPayload::AgentMessage {
        text: String::new(),
        phase: Some(MessagePhase::FinalAnswer),
        content_parts,
        delivery: None,
        questions: None,
    };
    media.metadata = json!({
        "source": EVENT_OWNER_FACTS_SOURCE,
        "task_id": task_id,
        "task_type": task_type,
        "normalized_status": normalized_status,
        "artifact_path": artifact_path,
        "tool_call_id": call_id,
        "tool_name": name,
    });
    Some(media)
}

pub(in crate::runtime) fn item_from_task_record(
    stored: &StoredSession,
    input: MediaTaskRecordProjectionInput<'_>,
) -> Option<Value> {
    item_from_task_record_with_source(stored, input, STORE_OWNER_FACTS_SOURCE, None, None)
}

fn item_from_task_record_with_source(
    stored: &StoredSession,
    input: MediaTaskRecordProjectionInput<'_>,
    source: &str,
    source_event: Option<&AgentEvent>,
    tool_identity: Option<(&str, &str)>,
) -> Option<Value> {
    if input.task_type != "image_generate" {
        return None;
    }
    if !matches!(input.normalized_status, "partial" | "succeeded") {
        return None;
    }
    let result = input
        .record
        .get("result")
        .filter(|value| value.is_object())?;
    let images = result.get("images").and_then(Value::as_array)?;
    let content_parts = images
        .iter()
        .enumerate()
        .filter_map(|(index, image)| media_content_part_from_image(image, index, source))
        .collect::<Vec<_>>();
    if content_parts.is_empty() {
        return None;
    }

    let event = source_event.cloned().unwrap_or_else(|| AgentEvent {
        event_id: format!("media-task-result-{}", input.task_id),
        sequence: input.sequence,
        session_id: stored.session.session_id.clone(),
        thread_id: input
            .thread_id
            .map(ToOwned::to_owned)
            .or_else(|| Some(stored.session.thread_id.clone())),
        turn_id: input.turn_id.map(ToOwned::to_owned),
        event_type: "media_task.result".to_string(),
        timestamp: input.timestamp.to_string(),
        payload: json!({
            "source": source,
            "task_id": input.task_id,
            "task_type": input.task_type,
            "normalized_status": input.normalized_status,
        }),
    });
    let item_id = media_item_id(
        input.turn_id.unwrap_or("session"),
        input.task_id,
    );
    let metadata = item_metadata(
        &event,
        source,
        tool_identity,
        input.task_id,
        input.task_type,
        input.normalized_status,
        input.artifact_path,
    );

    Some(base_item(
        stored,
        &event,
        "agent_message",
        "completed",
        compact_json(json!({
            "id": item_id,
            "contentParts": content_parts,
            "phase": "final_answer",
            "metadata": metadata,
        })),
    ))
}

fn media_item_id(turn_id: &str, task_id: &str) -> ItemId {
    ItemId::new(format!("media-task-result:{turn_id}:{task_id}"))
}

fn record_with_result_field(record: &Value, result: &Value) -> Value {
    let mut value = record.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("result".to_string(), result.clone());
    }
    value
}

fn structured_response(output: &ToolOutput) -> Option<&Value> {
    let content = output.structured_content.as_ref()?.as_object()?;
    content
        .get("response")
        .filter(|value| value.is_object())
        .or_else(|| Some(output.structured_content.as_ref()?))
}

fn is_image_task_result(
    tool_name: &str,
    metadata: &Value,
    response: Option<&Value>,
    record: &Value,
) -> bool {
    if tool_name == IMAGE_TASK_TOOL_NAME {
        return true;
    }
    let task_type = string_field(metadata, &["task_type", "taskType"])
        .or_else(|| response.and_then(|value| string_field(value, &["task_type", "taskType"])))
        .or_else(|| string_field(record, &["task_type", "taskType"]));
    task_type.as_deref() == Some("image_generate")
}

fn media_content_part_from_image(image: &Value, index: usize, source: &str) -> Option<Value> {
    let sidecar_ref = image
        .get("sidecarRef")
        .or_else(|| image.get("sidecar_ref"))?;
    let uri = sidecar_uri(sidecar_ref)?;
    let mime_type = image_mime_type(image, sidecar_ref, &uri)?;
    let content_part = runtime_media_part_from_reference(RuntimeMediaPartInput {
        uri: uri.clone(),
        mime_type,
        title: string_field(image, &["title", "filename", "fileName"]),
        caption: string_field(image, &["caption"]),
        source_uri: non_inline_string_field(image, &["sourceUri", "source_uri", "url"]),
        source_path: string_field(image, &["sourcePath", "source_path"]),
        preview_url: non_inline_string_field(image, &["previewUrl", "preview_url"]),
        sidecar_ref: Some(sidecar_ref.clone()),
        sha256: string_field(sidecar_ref, &["sha256"]),
        byte_size: u64_field(sidecar_ref, &["bytes", "byteSize", "byte_size"])
            .or_else(|| u64_field(image, &["bytes", "byteSize", "byte_size"])),
    })
    .ok()?;
    let mut value = serde_json::to_value(content_part).ok()?;
    if let Some(object) = value.as_object_mut() {
        object.insert("source".to_string(), json!(source));
        object.insert("contentPartIndex".to_string(), json!(index));
    }
    Some(value)
}

fn sidecar_uri(sidecar_ref: &Value) -> Option<String> {
    string_field(sidecar_ref, &["uri", "ref"]).filter(|value| !is_inline_media_uri(value))
}

fn image_mime_type(image: &Value, sidecar_ref: &Value, uri: &str) -> Option<String> {
    string_field(image, &["mimeType", "mime_type"])
        .or_else(|| string_field(sidecar_ref, &["mimeType", "mime_type"]))
        .or_else(|| {
            string_field(sidecar_ref, &["relativePath", "relative_path"])
                .and_then(|path| infer_image_mime_type(&path))
        })
        .or_else(|| infer_image_mime_type(uri))
}

fn infer_image_mime_type(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.ends_with(".png") {
        return Some("image/png".to_string());
    }
    if normalized.ends_with(".jpg") || normalized.ends_with(".jpeg") {
        return Some("image/jpeg".to_string());
    }
    if normalized.ends_with(".webp") {
        return Some("image/webp".to_string());
    }
    if normalized.ends_with(".gif") {
        return Some("image/gif".to_string());
    }
    None
}

fn task_id(metadata: &Value, response: Option<&Value>, record: &Value) -> Option<String> {
    string_field(metadata, &["task_id", "taskId", "id"])
        .or_else(|| response.and_then(|value| string_field(value, &["task_id", "taskId", "id"])))
        .or_else(|| string_field(record, &["task_id", "taskId", "id"]))
}

fn object_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find(|value| value.is_object())
}

fn item_metadata(
    event: &AgentEvent,
    source: &str,
    tool_identity: Option<(&str, &str)>,
    task_id: &str,
    task_type: &str,
    normalized_status: &str,
    artifact_path: Option<&str>,
) -> Value {
    let mut value = event_metadata(event);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    object.insert("source".to_string(), json!(source));
    object.insert("task_id".to_string(), json!(task_id));
    object.insert("task_type".to_string(), json!(task_type));
    object.insert("normalized_status".to_string(), json!(normalized_status));
    if let Some(artifact_path) = artifact_path {
        object.insert("artifact_path".to_string(), json!(artifact_path));
    }
    if let Some((call_id, name)) = tool_identity {
        object.insert("tool_call_id".to_string(), json!(call_id));
        object.insert("tool_name".to_string(), json!(name));
    }
    Value::Object(object.clone())
}

fn non_inline_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    string_field(value, keys).filter(|value| !is_inline_media_uri(value))
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn u64_field(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find_map(|value| {
            value.as_u64().or_else(|| {
                value
                    .as_str()
                    .and_then(|string| string.trim().parse::<u64>().ok())
            })
        })
}

fn is_inline_media_uri(value: &str) -> bool {
    value.trim_start().to_ascii_lowercase().starts_with("data:")
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_protocol::{ItemId, ItemKind, SessionId, ThreadId, TurnId};
    use app_server_protocol::AgentSession;
    use app_server_protocol::AgentSessionStatus;

    fn stored_session(events: Vec<AgentEvent>) -> StoredSession {
        StoredSession {
            session: AgentSession {
                session_id: "session-1".to_string(),
                thread_id: "thread-1".to_string(),
                app_id: "agent-runtime".to_string(),
                workspace_id: None,
                business_object_ref: None,
                status: AgentSessionStatus::Running,
                created_at: "2026-07-07T00:00:00.000Z".to_string(),
                updated_at: "2026-07-07T00:00:00.000Z".to_string(),
            },
            turns: Vec::new(),
            turn_inputs: HashMap::new(),
            turn_runtime_options: HashMap::new(),
            events,
            output_blobs: HashMap::new(),
        }
    }

    fn canonical_tool_event(
        item_status: ItemStatus,
        normalized_status: &str,
        record: Value,
    ) -> AgentEvent {
        let payload = ThreadItemPayload::Tool {
            call_id: "tool-image-1".to_string(),
            name: IMAGE_TASK_TOOL_NAME.to_string(),
            arguments: Vec::new(),
            output: Some(ToolOutput {
                text: Some("image task finished".to_string()),
                structured_content: Some(json!({
                    "response": {
                        "success": normalized_status == "succeeded",
                        "task_id": "task-image-1",
                        "task_type": "image_generate",
                        "normalized_status": normalized_status,
                        "record": record,
                    }
                })),
                ..ToolOutput::default()
            }),
        };
        let item = ThreadItem {
            session_id: SessionId::new("session-1"),
            thread_id: ThreadId::new("thread-1"),
            turn_id: TurnId::new("turn-1"),
            item_id: ItemId::new("tool-image-1"),
            sequence: 7,
            ordinal: 7,
            created_at_ms: 1,
            updated_at_ms: 2,
            completed_at_ms: item_status.is_terminal().then_some(2),
            kind: ItemKind::Tool,
            status: item_status,
            payload,
            metadata: json!({
                "task_id": "task-image-1",
                "task_type": "image_generate",
                "normalized_status": normalized_status,
                "artifact_path": ".lime/tasks/image_generate/task-image-1.json",
            }),
        };
        AgentEvent {
            event_id: "evt-tool-image-result".to_string(),
            sequence: 7,
            session_id: "session-1".to_string(),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            event_type: "item.completed".to_string(),
            timestamp: "2026-07-07T00:00:01.000Z".to_string(),
            payload: json!({"item": item}),
        }
    }

    fn image_record_with_sidecar() -> Value {
        json!({
            "task_type": "image_generate",
            "result": {
                "images": [{
                    "url": "data:image/png;base64,ZmFrZQ==",
                    "caption": "青柠封面图",
                    "sidecarRef": {
                        "ref": "sidecar://media/image-1",
                        "kind": "media",
                        "relativePath": "sessions/session-1/media/image-1.png",
                        "bytes": 4,
                        "sha256": "sha256:abcd",
                        "contentStatus": "available",
                        "uri": "sidecar://media/image-1",
                        "mimeType": "image/png"
                    }
                }]
            }
        })
    }

    #[test]
    fn completed_image_tool_projects_typed_sidecar_and_owner_facts() {
        let stored = stored_session(vec![canonical_tool_event(
            ItemStatus::Completed,
            "succeeded",
            image_record_with_sidecar(),
        )]);

        let mut items = HashMap::new();
        upsert_from_event(&stored, &stored.events[0], &mut items);
        let item = items
            .remove("item_media-task-result:turn-1:task-image-1")
            .expect("synthetic media item");

        assert_eq!(item["type"], "agent_message");
        assert_eq!(item["status"], "completed");
        assert_eq!(item["phase"], "final_answer");
        assert_eq!(item["contentParts"][0]["type"], "media");
        assert_eq!(item["contentParts"][0]["kind"], "image");
        assert_eq!(
            item["contentParts"][0]["reference"]["uri"],
            "sidecar://media/image-1"
        );
        assert_eq!(
            item["contentParts"][0]["reference"]["sidecar_ref"]["sha256"],
            "sha256:abcd"
        );
        assert_eq!(item["contentParts"][0]["reference"]["byte_size"], 4);
        assert!(item["contentParts"][0]["reference"]
            .get("source_uri")
            .is_none());
        assert_eq!(item["metadata"]["source"], "media_task_result_owner_facts");
        assert_eq!(item["metadata"]["tool_call_id"], "tool-image-1");
        assert_eq!(item["metadata"]["tool_name"], IMAGE_TASK_TOOL_NAME);

        let projected = super::super::thread_items_from_events(&stored);
        assert!(projected.iter().any(|item| {
            item.get("id").and_then(Value::as_str) == Some("item_media-task-result:turn-1:task-image-1")
                && item
                    .pointer("/contentParts/0/reference/uri")
                    .and_then(Value::as_str)
                    == Some("sidecar://media/image-1")
        }));
    }

    #[test]
    fn completed_image_tool_without_sidecar_does_not_project_media_part() {
        let stored = stored_session(vec![canonical_tool_event(
            ItemStatus::Completed,
            "succeeded",
            json!({
                "task_type": "image_generate",
                "result": {
                    "images": [{"url": "https://example.test/image.png"}]
                }
            }),
        )]);

        let mut items = HashMap::new();
        upsert_from_event(&stored, &stored.events[0], &mut items);

        assert!(items.is_empty());
    }

    #[test]
    fn canonical_media_history_and_tool_result_restore_one_image() {
        let tool_event = canonical_tool_event(
            ItemStatus::Completed,
            "partial",
            image_record_with_sidecar(),
        );
        let tool = serde_json::from_value(tool_event.payload["item"].clone()).unwrap();
        let media = completed_tool_media_item(&tool).expect("partial image result");
        let mut media_event = tool_event.clone();
        media_event.event_id = "evt-media-result".to_string();
        media_event.sequence += 1;
        media_event.payload = json!({"item": media});
        let stored = stored_session(vec![tool_event, media_event]);
        let items = super::super::thread_items_from_events(&stored);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], "item_media-task-result:turn-1:task-image-1");
        assert_eq!(
            items[0]["contentParts"][0]["reference"]["uri"],
            "sidecar://media/image-1"
        );
    }

    #[test]
    fn non_terminal_or_pending_image_tool_does_not_project_final_media() {
        let events = [
            canonical_tool_event(
                ItemStatus::InProgress,
                "succeeded",
                image_record_with_sidecar(),
            ),
            canonical_tool_event(
                ItemStatus::Completed,
                "pending",
                image_record_with_sidecar(),
            ),
            canonical_tool_event(ItemStatus::Completed, "failed", image_record_with_sidecar()),
            canonical_tool_event(
                ItemStatus::Completed,
                "cancelled",
                image_record_with_sidecar(),
            ),
        ];

        for event in events {
            let stored = stored_session(vec![event]);
            let mut items = HashMap::new();
            upsert_from_event(&stored, &stored.events[0], &mut items);
            assert!(items.is_empty());
        }
    }

    #[test]
    fn retired_raw_tool_result_does_not_project_media() {
        let stored = stored_session(vec![AgentEvent {
            event_id: "raw-tool-result".to_string(),
            sequence: 7,
            session_id: "session-1".to_string(),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            event_type: "tool.result".to_string(),
            timestamp: "2026-07-07T00:00:01.000Z".to_string(),
            payload: json!({
                "toolCallId": "tool-image-1",
                "toolName": IMAGE_TASK_TOOL_NAME,
                "result": {
                    "metadata": {
                        "task_id": "task-image-1",
                        "task_type": "image_generate",
                        "normalized_status": "succeeded",
                        "record": image_record_with_sidecar(),
                    }
                }
            }),
        }]);

        let mut items = HashMap::new();
        upsert_from_event(&stored, &stored.events[0], &mut items);

        assert!(items.is_empty());
        assert!(super::super::thread_items_from_events(&stored).is_empty());
    }

    #[test]
    fn materializer_keeps_current_tool_side_channels_and_rejects_retired_classes() {
        let event_types = [
            "tool.progress",
            "tool.output.delta",
            "tool.started",
            "tool.result",
            "tool.failed",
            "tool.completed",
            "tool.input.delta",
        ];
        let events = event_types
            .iter()
            .enumerate()
            .map(|(index, event_type)| AgentEvent {
                event_id: format!("tool-event-{index}"),
                sequence: index as u64 + 1,
                session_id: "session-1".to_string(),
                thread_id: Some("thread-1".to_string()),
                turn_id: Some("turn-1".to_string()),
                event_type: (*event_type).to_string(),
                timestamp: format!("2026-07-07T00:00:{index:02}Z"),
                payload: json!({
                    "toolCallId": format!("call-{index}"),
                    "toolName": "rg",
                }),
            })
            .collect::<Vec<_>>();

        let changes = super::super::materialize_events(&events, "session-1", "thread-1")
            .expect("materialize current tool side channels");

        assert_eq!(changes.changed_items.len(), 2);
        assert!(changes
            .changed_items
            .iter()
            .all(|item| matches!(item.payload, ThreadItemPayload::Tool { .. })));
    }
}
