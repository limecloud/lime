use crate::tool_definition::RuntimeToolDefinition;
use serde_json::{Map, json};

pub const IMAGE_TASK_TOOL_NAME: &str = "lime_create_image_generation_task";

pub fn image_task_tool_definition() -> RuntimeToolDefinition {
    let mut properties = Map::new();
    for key in [
        "project_root_path",
        "prompt",
        "title",
        "mode",
        "raw_text",
        "layout_hint",
        "size",
        "aspect_ratio",
        "usage",
        "style",
        "provider_id",
        "model",
        "executor_mode",
        "outer_model",
        "session_id",
        "thread_id",
        "turn_id",
        "project_id",
        "content_id",
        "entry_source",
        "modality_contract_key",
        "modality",
        "routing_slot",
        "requested_target",
        "slot_id",
        "anchor_hint",
        "anchor_section_title",
        "anchor_text",
        "target_output_id",
        "target_output_ref_id",
    ] {
        properties.insert(key.to_string(), json!({ "type": "string" }));
    }
    properties.insert("title_generation_result".to_string(), json!({}));
    properties.insert("persona_context".to_string(), json!({}));
    properties.insert("presentation".to_string(), json!({}));
    properties.insert("taste_context".to_string(), json!({}));
    properties.insert("runtime_contract".to_string(), json!({}));
    properties.insert(
        "count".to_string(),
        json!({ "type": "integer", "minimum": 1 }),
    );
    properties.insert(
        "reference_images".to_string(),
        json!({ "type": "array", "items": { "type": "string" } }),
    );
    properties.insert(
        "storyboard_slots".to_string(),
        json!({
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "slot_id": { "type": "string" },
                    "label": { "type": "string" },
                    "shot_type": { "type": "string" }
                },
                "required": ["prompt"]
            }
        }),
    );
    RuntimeToolDefinition::new(
        IMAGE_TASK_TOOL_NAME,
        "Create a real image generation task and return the App Server media task artifact response.",
        json!({
            "type": "object",
            "properties": properties,
            "required": ["project_root_path", "prompt"]
        }),
    )
}
