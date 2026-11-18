use super::common::{
    canonical_generation_prompt, canonical_media_references, non_empty, ProtocolMappingError,
};
use model_routing_core::CanonicalRequest;
use serde_json::{json, Map, Value};

const STRING_METADATA_FIELDS: &[&str] = &[
    "size",
    "quality",
    "background",
    "style",
    "response_format",
    "output_format",
    "moderation",
    "user",
];

pub(crate) fn body_for_model(
    model_id: &str,
    request: &CanonicalRequest,
) -> Result<Value, ProtocolMappingError> {
    let prompt = canonical_generation_prompt(
        request,
        app_server_protocol::ProtocolKind::OpenaiImages,
        true,
    )?;
    let mut body = Map::new();
    body.insert("model".to_string(), json!(model_id));
    body.insert("prompt".to_string(), json!(prompt));
    insert_canonical_string_options(&mut body, request);
    insert_canonical_image_count(&mut body, request);
    insert_canonical_reference_images(&mut body, request);
    Ok(Value::Object(body))
}

fn insert_canonical_string_options(body: &mut Map<String, Value>, request: &CanonicalRequest) {
    for key in STRING_METADATA_FIELDS {
        if let Some(value) = request
            .provider_options
            .get(*key)
            .and_then(Value::as_str)
            .and_then(|value| non_empty(Some(value)))
        {
            body.insert((*key).to_string(), json!(value));
        }
    }
}

fn insert_canonical_image_count(body: &mut Map<String, Value>, request: &CanonicalRequest) {
    let Some(count) = request
        .provider_options
        .get("n")
        .and_then(metadata_positive_u64)
    else {
        return;
    };
    body.insert("n".to_string(), json!(count));
}

fn insert_canonical_reference_images(body: &mut Map<String, Value>, request: &CanonicalRequest) {
    let references = canonical_media_references(request);
    if references.is_empty() {
        return;
    }
    body.insert(
        "images".to_string(),
        Value::Array(
            references
                .into_iter()
                .map(|image_url| json!({ "image_url": image_url }))
                .collect(),
        ),
    );
}

fn metadata_positive_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().filter(|value| *value > 0),
        Value::String(raw) => raw.trim().parse::<u64>().ok().filter(|value| *value > 0),
        _ => None,
    }
}
