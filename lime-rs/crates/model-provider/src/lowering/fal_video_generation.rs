use super::common::{canonical_generation_prompt, non_empty, ProtocolMappingError};
use app_server_protocol::ProtocolKind;
use model_routing_core::CanonicalRequest;
use serde_json::{json, Map, Value};

const STRING_METADATA_FIELDS: &[&str] = &[
    "provider_id",
    "aspect_ratio",
    "resolution",
    "image_url",
    "end_image_url",
    "user",
];

pub(crate) fn body_for_model(
    model_id: &str,
    request: &CanonicalRequest,
) -> Result<Value, ProtocolMappingError> {
    let prompt = canonical_generation_prompt(request, ProtocolKind::Fal, false)?;
    let mut body = Map::new();
    body.insert("prompt".to_string(), json!(prompt));
    if let Some(model_id) = non_empty(Some(model_id)) {
        body.insert("model".to_string(), json!(model_id));
    }
    insert_canonical_string_options(&mut body, request);
    insert_canonical_u64_option(&mut body, request, "duration");
    insert_canonical_bool_option(&mut body, request, "generate_audio");
    insert_canonical_bool_option(&mut body, request, "camera_fixed");
    insert_canonical_scalar_option(&mut body, request, "seed");
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

fn insert_canonical_u64_option(
    body: &mut Map<String, Value>,
    request: &CanonicalRequest,
    key: &str,
) {
    let Some(value) = request.provider_options.get(key).and_then(metadata_u64) else {
        return;
    };
    body.insert(key.to_string(), json!(value));
}

fn insert_canonical_bool_option(
    body: &mut Map<String, Value>,
    request: &CanonicalRequest,
    key: &str,
) {
    let Some(value) = request.provider_options.get(key).and_then(metadata_bool) else {
        return;
    };
    body.insert(key.to_string(), json!(value));
}

fn insert_canonical_scalar_option(
    body: &mut Map<String, Value>,
    request: &CanonicalRequest,
    key: &str,
) {
    let Some(value) = request.provider_options.get(key) else {
        return;
    };
    if matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_)) {
        body.insert(key.to_string(), value.clone());
    }
}

fn metadata_u64(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64(),
        Value::String(raw) => raw.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn metadata_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::String(raw) => match raw.trim() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}
