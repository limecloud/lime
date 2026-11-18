use super::super::raw_string_field;
use super::super::string_field;
use super::super::StoredSession;
use super::base_item;
use super::compact_json;
use super::event_metadata;
use app_server_protocol::AgentEvent;
use model_routing_core::{RuntimeContentPart, RuntimeMessageDeltaContent};
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) fn item_from_delta(stored: &StoredSession, event: &AgentEvent) -> Option<Value> {
    let content = message_content_from_payload(&event.payload)?;
    let phase = raw_string_field(&event.payload, &["phase", "messagePhase", "message_phase"])
        .unwrap_or_else(|| "final".to_string());
    Some(base_item(
        stored,
        event,
        "agent_message",
        &status_from_delta_event(event),
        compact_json(json!({
            "id": raw_string_field(
                &event.payload,
                &["id", "itemId", "item_id", "messageId", "message_id"],
            ),
            "text": content.text,
            "contentParts": content.content_parts,
            "phase": phase,
            "metadata": event_metadata(event),
        })),
    ))
}

pub(super) fn payload_id(event: &AgentEvent) -> Option<String> {
    raw_string_field(
        &event.payload,
        &["id", "itemId", "item_id", "messageId", "message_id"],
    )
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

pub(super) fn upsert_from_item_event(
    stored: &StoredSession,
    event: &AgentEvent,
    items: &mut Vec<Value>,
    item_by_id: &mut HashMap<String, usize>,
) -> bool {
    let Some(next) = item_from_item_event(stored, event) else {
        return false;
    };
    let Some(item_id) = string_field(&next, &["id"]) else {
        return true;
    };
    if let Some(existing_index) = item_by_id.get(&item_id).copied() {
        merge_item(&mut items[existing_index], &next);
        return true;
    }
    if !has_message_content(&next) {
        return true;
    }
    item_by_id.insert(item_id, items.len());
    items.push(next);
    true
}

pub(super) fn merge_item(existing: &mut Value, next: &Value) {
    let Some(existing_object) = existing.as_object_mut() else {
        return;
    };
    let next_source_event_type = next
        .pointer("/metadata/source_event_type")
        .and_then(Value::as_str);
    if let Some(next_text) = next.get("text").and_then(Value::as_str) {
        if let Some(existing_text) = existing_object.get_mut("text") {
            let merged = if next_source_event_type == Some("item.completed") {
                next_text.to_string()
            } else if next_source_event_type == Some("item.updated") {
                merge_cumulative_text(existing_text.as_str().unwrap_or_default(), next_text)
            } else {
                format!(
                    "{}{}",
                    existing_text.as_str().unwrap_or_default(),
                    next_text
                )
            };
            *existing_text = Value::String(merged);
        } else {
            existing_object.insert("text".to_string(), Value::String(next_text.to_string()));
        }
    }
    merge_content_parts(existing_object, next, next_source_event_type);
    for field in ["phase", "delivery", "questions"] {
        if let Some(value) = next.get(field) {
            existing_object.insert(field.to_string(), value.clone());
        }
    }
    if let Some(status) = next.get("status").and_then(Value::as_str) {
        let existing_is_completed = existing_object
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|value| value == "completed");
        if !existing_is_completed || status == "completed" {
            existing_object.insert("status".to_string(), Value::String(status.to_string()));
        }
    }
    if let Some(started_at) = next.get("started_at").cloned() {
        existing_object
            .entry("started_at".to_string())
            .or_insert(started_at);
    }
    if let Some(updated_at) = next.get("updated_at").cloned() {
        existing_object.insert("updated_at".to_string(), updated_at);
    }
    if let Some(completed_at) = next.get("completed_at").cloned() {
        existing_object.insert("completed_at".to_string(), completed_at);
    }
}

fn merge_cumulative_text(existing_text: &str, next_text: &str) -> String {
    if next_text.is_empty() {
        return existing_text.to_string();
    }
    if existing_text.is_empty() {
        return next_text.to_string();
    }
    if next_text.starts_with(existing_text) || next_text.contains(existing_text) {
        return next_text.to_string();
    }
    if existing_text.ends_with(next_text) {
        return existing_text.to_string();
    }
    if existing_text.contains(next_text) {
        return existing_text.to_string();
    }
    format!("{existing_text}{next_text}")
}

fn item_from_item_event(stored: &StoredSession, event: &AgentEvent) -> Option<Value> {
    let item = event.payload.get("item").unwrap_or(&event.payload);
    let payload = item.get("payload").unwrap_or(item);
    let item_type = string_field(payload, &["type", "kind"])
        .or_else(|| string_field(item, &["type", "kind"]))?;
    let role = string_field(payload, &["role"]).or_else(|| string_field(item, &["role"]));
    if !is_item_type(&item_type, role.as_deref()) {
        return None;
    }
    let item_id = string_field(
        item,
        &["id", "itemId", "item_id", "messageId", "message_id"],
    )
    .or_else(|| {
        string_field(
            payload,
            &["id", "itemId", "item_id", "messageId", "message_id"],
        )
    })?;
    let content =
        message_content_from_payload(payload).or_else(|| message_content_from_payload(item));
    let phase = raw_string_field(payload, &["phase", "messagePhase", "message_phase"])
        .or_else(|| raw_string_field(item, &["phase", "messagePhase", "message_phase"]))
        .unwrap_or_else(|| "final".to_string());
    let status = string_field(item, &["status"])
        .or_else(|| string_field(payload, &["status"]))
        .map(|status| normalize_status(&status))
        .unwrap_or_else(|| {
            if event.event_type == "item.completed" {
                "completed".to_string()
            } else {
                "in_progress".to_string()
            }
        });

    Some(base_item(
        stored,
        event,
        "agent_message",
        &status,
        compact_json(json!({
            "id": item_id,
            "text": content.as_ref().and_then(|content| content.text.clone()),
            "contentParts": content
                .map(|content| content.content_parts)
                .unwrap_or_default(),
            "phase": phase,
            "delivery": payload.get("delivery").or_else(|| item.get("delivery")),
            "questions": payload.get("questions").or_else(|| item.get("questions")),
            "metadata": event_metadata(event),
        })),
    ))
}

#[derive(Debug)]
struct MessageContent {
    text: Option<String>,
    content_parts: Vec<Value>,
}

fn message_content_from_payload(payload: &Value) -> Option<MessageContent> {
    let mut text = text_from_payload(payload)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut content_parts = Vec::new();

    let has_runtime_content_shape =
        payload.get("contentPart").is_some() || payload.get("contentParts").is_some();
    match RuntimeMessageDeltaContent::from_payload(payload) {
        Ok(content) => {
            if let Some(runtime_text) = content
                .text
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                text = Some(runtime_text);
            }
            for content_part in content.content_parts {
                if content_part_has_inline_payload(&content_part) {
                    return None;
                }
                if text.is_none() {
                    text = text_from_runtime_content_part(&content_part);
                }
                if let Ok(value) = serde_json::to_value(content_part) {
                    content_parts.push(value);
                }
            }
        }
        Err(_) if has_runtime_content_shape => return None,
        Err(_) => {}
    }

    if text.is_none() && content_parts.is_empty() {
        return None;
    }
    Some(MessageContent {
        text,
        content_parts,
    })
}

fn text_from_runtime_content_part(content_part: &RuntimeContentPart) -> Option<String> {
    match content_part {
        RuntimeContentPart::Text { text } => {
            let text = text.trim();
            if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        }
        RuntimeContentPart::Media { .. } => None,
    }
}

fn content_part_has_inline_payload(content_part: &RuntimeContentPart) -> bool {
    match content_part {
        RuntimeContentPart::Media { reference, .. } => {
            is_inline_media_payload_uri(&reference.uri)
                || reference
                    .source_uri
                    .as_deref()
                    .is_some_and(is_inline_media_payload_uri)
                || reference
                    .preview_url
                    .as_deref()
                    .is_some_and(is_inline_media_payload_uri)
        }
        RuntimeContentPart::Text { .. } => false,
    }
}

fn is_inline_media_payload_uri(uri: &str) -> bool {
    uri.trim_start().to_ascii_lowercase().starts_with("data:")
}

fn has_message_content(value: &Value) -> bool {
    value
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
        || value
            .get("contentParts")
            .and_then(Value::as_array)
            .is_some_and(|parts| !parts.is_empty())
}

fn merge_content_parts(
    existing_object: &mut serde_json::Map<String, Value>,
    next: &Value,
    next_source_event_type: Option<&str>,
) {
    let Some(next_parts) = next.get("contentParts").and_then(Value::as_array) else {
        return;
    };
    if next_parts.is_empty() {
        return;
    }
    let should_replace = matches!(
        next_source_event_type,
        Some("item.completed" | "item.updated")
    );
    if should_replace {
        existing_object.insert("contentParts".to_string(), Value::Array(next_parts.clone()));
        return;
    }
    let existing_parts = existing_object
        .entry("contentParts".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(existing_parts) = existing_parts.as_array_mut() else {
        existing_object.insert("contentParts".to_string(), Value::Array(next_parts.clone()));
        return;
    };
    for next_part in next_parts {
        if !existing_parts.iter().any(|part| part == next_part) {
            existing_parts.push(next_part.clone());
        }
    }
}

fn status_from_delta_event(event: &AgentEvent) -> String {
    string_field(&event.payload, &["status"])
        .map(|status| normalize_status(&status))
        .unwrap_or_else(|| {
            if payload_id(event).is_some() {
                "in_progress".to_string()
            } else {
                "completed".to_string()
            }
        })
}

fn is_item_type(item_type: &str, role: Option<&str>) -> bool {
    let normalized = item_type
        .trim()
        .replace('-', "_")
        .replace(' ', "_")
        .to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "agent_message" | "agentmessage" | "assistant_message" | "assistantmessage"
    ) || (normalized == "message"
        && role.is_some_and(|role| role.trim().eq_ignore_ascii_case("assistant")))
}

fn normalize_status(status: &str) -> String {
    match status.trim() {
        "running" | "pending" | "started" | "inProgress" | "in_progress" => {
            "in_progress".to_string()
        }
        "completed" | "succeeded" | "success" => "completed".to_string(),
        "failed" | "error" => "failed".to_string(),
        _ => "in_progress".to_string(),
    }
}

fn text_from_payload(payload: &Value) -> Option<String> {
    if let Some(text) = payload
        .as_str()
        .map(str::to_string)
        .filter(|text| !text.is_empty())
    {
        return Some(text);
    }
    raw_string_field(
        payload,
        &[
            "text",
            "delta",
            "content",
            "message",
            "outputText",
            "output_text",
        ],
    )
    .or_else(|| {
        payload
            .get("content")
            .and_then(|content| raw_string_field(content, &["text", "message"]))
    })
    .or_else(|| {
        for key in ["deltas", "messages", "items", "parts", "content"] {
            let Some(values) = payload.get(key).and_then(Value::as_array) else {
                continue;
            };
            let text = values
                .iter()
                .filter_map(text_from_payload)
                .collect::<String>();
            if !text.is_empty() {
                return Some(text);
            }
        }
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::{AgentSession, AgentSessionStatus};

    fn stored_session() -> StoredSession {
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
            events: Vec::new(),
            output_blobs: HashMap::new(),
        }
    }

    fn agent_event(event_id: &str, sequence: u64, payload: Value) -> AgentEvent {
        AgentEvent {
            event_id: event_id.to_string(),
            sequence,
            session_id: "session-1".to_string(),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            event_type: "message.delta".to_string(),
            timestamp: "2026-07-07T00:00:01.000Z".to_string(),
            payload,
        }
    }

    #[test]
    fn media_only_delta_creates_agent_message_content_parts() {
        let stored = stored_session();
        let event = agent_event(
            "evt-media",
            1,
            json!({
                "itemId": "agent-media-1",
                "phase": "final_answer",
                "contentPart": {
                    "type": "media",
                    "kind": "image",
                    "reference": {
                        "uri": "sidecar://session-1/media/image-1.png",
                        "mime_type": "image/png",
                        "title": "image-1.png",
                        "source_uri": "sidecar://session-1/media/image-1.png",
                        "source_path": "/tmp/lime-media/image-1.png",
                        "preview_url": "asset:///tmp/lime-media/image-1.png"
                    },
                    "caption": "生成图预览"
                }
            }),
        );

        let item = item_from_delta(&stored, &event).expect("agent message item");

        assert_eq!(item["id"], "agent-media-1");
        assert_eq!(item["type"], "agent_message");
        assert!(item.get("text").is_none());
        assert_eq!(item["contentParts"][0]["type"], "media");
        assert_eq!(item["contentParts"][0]["kind"], "image");
        assert_eq!(
            item["contentParts"][0]["reference"]["uri"],
            "sidecar://session-1/media/image-1.png"
        );
        assert_eq!(
            item["contentParts"][0]["reference"]["source_path"],
            "/tmp/lime-media/image-1.png"
        );
        assert_eq!(
            item["contentParts"][0]["reference"]["preview_url"],
            "asset:///tmp/lime-media/image-1.png"
        );
    }

    #[test]
    fn merge_item_appends_media_content_parts_to_text_delta() {
        let stored = stored_session();
        let mut existing = item_from_delta(
            &stored,
            &agent_event(
                "evt-text",
                1,
                json!({
                    "itemId": "agent-media-1",
                    "text": "图片已生成：",
                    "phase": "final_answer"
                }),
            ),
        )
        .expect("text item");
        let next = item_from_delta(
            &stored,
            &agent_event(
                "evt-media",
                2,
                json!({
                    "itemId": "agent-media-1",
                    "contentPart": {
                        "type": "media",
                        "kind": "image",
                        "reference": {
                            "uri": "sidecar://session-1/media/image-1.png",
                            "mime_type": "image/png"
                        }
                    }
                }),
            ),
        )
        .expect("media item");

        merge_item(&mut existing, &next);
        merge_item(&mut existing, &next);

        assert_eq!(existing["text"], "图片已生成：");
        assert_eq!(existing["contentParts"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn mismatched_content_part_alias_is_fail_closed() {
        let stored = stored_session();
        let event = agent_event(
            "evt-invalid-media",
            1,
            json!({
                "itemId": "agent-media-1",
                "text": "should not bypass invalid media",
                "contentPart": {
                    "type": "media",
                    "kind": "image",
                    "reference": {
                        "uri": "sidecar://session-1/media/image-1.png",
                        "mime_type": "image/png"
                    }
                },
                "contentParts": [{
                    "type": "media",
                    "kind": "audio",
                    "reference": {
                        "uri": "sidecar://session-1/media/audio-1.wav",
                        "mime_type": "audio/wav"
                    }
                }]
            }),
        );

        assert!(item_from_delta(&stored, &event).is_none());
    }

    #[test]
    fn inline_media_payload_is_fail_closed() {
        let stored = stored_session();
        let event = agent_event(
            "evt-inline-media",
            1,
            json!({
                "itemId": "agent-media-1",
                "contentPart": {
                    "type": "media",
                    "kind": "image",
                    "reference": {
                        "uri": "data:image/png;base64,AAAA",
                        "mime_type": "image/png"
                    }
                }
            }),
        );

        assert!(item_from_delta(&stored, &event).is_none());
    }

    #[test]
    fn inline_media_source_owner_is_fail_closed() {
        let stored = stored_session();
        let event = agent_event(
            "evt-inline-source-owner",
            1,
            json!({
                "itemId": "agent-media-1",
                "contentPart": {
                    "type": "media",
                    "kind": "image",
                    "reference": {
                        "uri": "sidecar://session-1/media/image-1.png",
                        "mime_type": "image/png",
                        "preview_url": "data:image/png;base64,AAAA"
                    }
                }
            }),
        );

        assert!(item_from_delta(&stored, &event).is_none());
    }
}
