use super::common::{canonical_generation_prompt, non_empty, ProtocolMappingError};
use app_server_protocol::ProtocolKind;
use model_routing_core::CanonicalRequest;
use serde_json::{json, Map, Value};

/// WaveSpeedAI 的模型 id 位于请求路径中；请求体只包含模型输入。
/// Canonical 选项名映射到 WaveSpeedAI 视频模型的输入字段名。
const STRING_FIELDS: &[(&str, &str)] = &[
    ("aspect_ratio", "aspect_ratio"),
    ("resolution", "resolution"),
    ("image_url", "image"),
    ("end_image_url", "last_image"),
];

pub(crate) fn body_for_model(request: &CanonicalRequest) -> Result<Value, ProtocolMappingError> {
    let prompt = canonical_generation_prompt(request, ProtocolKind::WavespeedVideo, false)?;
    let mut body = Map::from_iter([("prompt".to_string(), json!(prompt))]);
    for (option, field) in STRING_FIELDS {
        if let Some(value) = request
            .provider_options
            .get(*option)
            .and_then(Value::as_str)
            .and_then(|value| non_empty(Some(value)))
        {
            body.insert((*field).to_string(), json!(value));
        }
    }
    if let Some(duration) = request.provider_options.get("duration").and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
    }) {
        body.insert("duration".to_string(), json!(duration));
    }
    for key in ["generate_audio", "camera_fixed"] {
        if let Some(value) = request.provider_options.get(key).and_then(metadata_bool) {
            body.insert(key.to_string(), json!(value));
        }
    }
    if let Some(seed) = request.provider_options.get("seed").and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
    }) {
        body.insert("seed".to_string(), json!(seed));
    }
    Ok(Value::Object(body))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowers_wavespeed_image_to_video_body_without_model_or_provider_fields() {
        let mut request =
            CanonicalRequest::text("alibaba/wan-3.0/image-to-video", "让画面缓慢向前推进");
        for (key, value) in [
            ("provider_id", json!("wavespeed")),
            ("image_url", json!("https://example.test/start.png")),
            ("end_image_url", json!("https://example.test/end.png")),
            ("duration", json!("5")),
            ("aspect_ratio", json!("16:9")),
            ("resolution", json!("720p")),
            ("generate_audio", json!("false")),
            ("seed", json!(42)),
        ] {
            request.provider_options.insert(key.to_string(), value);
        }

        let body = body_for_model(&request).expect("WaveSpeedAI video body");

        assert_eq!(
            body,
            json!({
                "prompt": "让画面缓慢向前推进",
                "image": "https://example.test/start.png",
                "last_image": "https://example.test/end.png",
                "duration": 5,
                "aspect_ratio": "16:9",
                "resolution": "720p",
                "generate_audio": false,
                "seed": 42
            })
        );
    }

    #[test]
    fn rejects_empty_prompt() {
        let request = CanonicalRequest::text("alibaba/wan-3.0/text-to-video", "  ");

        assert_eq!(
            body_for_model(&request),
            Err(ProtocolMappingError::EmptyInput)
        );
    }
}
