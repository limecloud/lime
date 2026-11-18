use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RUNTIME_IMAGE_MIME_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/gif", "image/webp"];
pub const RUNTIME_VIDEO_MIME_TYPES: &[&str] = &["video/mp4", "video/webm", "video/quicktime"];
pub const RUNTIME_AUDIO_MIME_TYPES: &[&str] = &[
    "audio/wav",
    "audio/mp3",
    "audio/mpeg",
    "audio/aiff",
    "audio/aac",
    "audio/ogg",
    "audio/flac",
];
pub const RUNTIME_FILE_MIME_TYPES: &[&str] = &["application/pdf"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuntimeContentPart {
    Text {
        text: String,
    },
    Media {
        kind: RuntimeMediaKind,
        reference: RuntimeContentReference,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeMediaKind {
    Image,
    Audio,
    Video,
    File,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeContentReference {
    pub uri: String,
    pub mime_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
    #[serde(default, alias = "sidecarRef", skip_serializing_if = "Option::is_none")]
    pub sidecar_ref: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMessageDeltaContent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_part: Option<RuntimeContentPart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_parts: Vec<RuntimeContentPart>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeMediaPartInput {
    pub uri: String,
    pub mime_type: String,
    pub title: Option<String>,
    pub caption: Option<String>,
    pub source_uri: Option<String>,
    pub source_path: Option<String>,
    pub preview_url: Option<String>,
    pub sidecar_ref: Option<Value>,
    pub sha256: Option<String>,
    pub byte_size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RuntimeContentPartError {
    MissingReferenceUri,
    InlineMediaPayload,
    UnsupportedMimeType { mime_type: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RuntimeMessageDeltaContentParseError {
    InvalidPayload { message: String },
    MismatchedContentPartAlias,
}

impl RuntimeContentPart {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    pub fn requires_reference(&self) -> bool {
        matches!(self, Self::Media { .. })
    }
}

impl RuntimeMessageDeltaContent {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: Some(text.into()),
            content_part: None,
            content_parts: Vec::new(),
        }
    }

    pub fn content_part(content_part: RuntimeContentPart) -> Self {
        Self {
            text: None,
            content_part: Some(content_part.clone()),
            content_parts: vec![content_part],
        }
    }

    pub fn from_payload(payload: &Value) -> Result<Self, RuntimeMessageDeltaContentParseError> {
        let mut content: Self = serde_json::from_value(payload.clone()).map_err(|error| {
            RuntimeMessageDeltaContentParseError::InvalidPayload {
                message: error.to_string(),
            }
        })?;

        if let Some(content_part) = content.content_part.clone() {
            if content.content_parts.is_empty() {
                content.content_parts.push(content_part);
            } else if content.content_parts.first() != Some(&content_part) {
                return Err(RuntimeMessageDeltaContentParseError::MismatchedContentPartAlias);
            }
        } else if content.content_parts.len() == 1 {
            content.content_part = content.content_parts.first().cloned();
        }

        Ok(content)
    }
}

pub fn runtime_media_part_from_reference(
    input: RuntimeMediaPartInput,
) -> Result<RuntimeContentPart, RuntimeContentPartError> {
    let uri = normalize_non_empty(input.uri).ok_or(RuntimeContentPartError::MissingReferenceUri)?;
    if is_inline_media_payload_uri(&uri) {
        return Err(RuntimeContentPartError::InlineMediaPayload);
    }

    let mime_type = normalize_mime_type(&input.mime_type).ok_or_else(|| {
        RuntimeContentPartError::UnsupportedMimeType {
            mime_type: input.mime_type,
        }
    })?;
    let kind = runtime_media_kind_for_mime_type(&mime_type).ok_or_else(|| {
        RuntimeContentPartError::UnsupportedMimeType {
            mime_type: mime_type.clone(),
        }
    })?;

    Ok(RuntimeContentPart::Media {
        kind,
        reference: RuntimeContentReference {
            uri,
            mime_type,
            title: input.title.and_then(normalize_non_empty),
            source_uri: input.source_uri.and_then(normalize_non_inline_reference),
            source_path: input.source_path.and_then(normalize_non_empty),
            preview_url: input.preview_url.and_then(normalize_non_inline_reference),
            sidecar_ref: input.sidecar_ref,
            sha256: input.sha256.and_then(normalize_non_empty),
            byte_size: input.byte_size,
        },
        caption: input.caption.and_then(normalize_non_empty),
    })
}

pub fn runtime_media_kind_for_mime_type(mime_type: &str) -> Option<RuntimeMediaKind> {
    let mime_type = normalize_mime_type(mime_type)?;
    if RUNTIME_IMAGE_MIME_TYPES.contains(&mime_type.as_str()) {
        return Some(RuntimeMediaKind::Image);
    }
    if RUNTIME_AUDIO_MIME_TYPES.contains(&mime_type.as_str()) {
        return Some(RuntimeMediaKind::Audio);
    }
    if RUNTIME_VIDEO_MIME_TYPES.contains(&mime_type.as_str()) {
        return Some(RuntimeMediaKind::Video);
    }
    if RUNTIME_FILE_MIME_TYPES.contains(&mime_type.as_str()) {
        return Some(RuntimeMediaKind::File);
    }
    None
}

pub fn is_supported_runtime_media_mime_type(mime_type: &str) -> bool {
    runtime_media_kind_for_mime_type(mime_type).is_some()
}

fn normalize_mime_type(mime_type: &str) -> Option<String> {
    let normalized = mime_type.trim().to_ascii_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

fn normalize_non_empty(value: impl AsRef<str>) -> Option<String> {
    let value = value.as_ref().trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn normalize_non_inline_reference(value: impl AsRef<str>) -> Option<String> {
    let value = normalize_non_empty(value)?;
    (!is_inline_media_payload_uri(&value)).then_some(value)
}

fn is_inline_media_payload_uri(uri: &str) -> bool {
    uri.trim_start().to_ascii_lowercase().starts_with("data:")
}

#[cfg(test)]
mod tests {
    use super::{
        is_supported_runtime_media_mime_type, runtime_media_kind_for_mime_type,
        runtime_media_part_from_reference, RuntimeContentPart, RuntimeContentPartError,
        RuntimeMediaKind, RuntimeMediaPartInput, RuntimeMessageDeltaContent,
        RuntimeMessageDeltaContentParseError,
    };
    use serde_json::json;

    fn media_input(uri: &str, mime_type: &str) -> RuntimeMediaPartInput {
        RuntimeMediaPartInput {
            uri: uri.to_string(),
            mime_type: mime_type.to_string(),
            title: Some("  Screenshot  ".to_string()),
            caption: Some("  UI state  ".to_string()),
            source_uri: None,
            source_path: None,
            preview_url: None,
            sidecar_ref: None,
            sha256: Some("  sha256:abcd  ".to_string()),
            byte_size: Some(42),
        }
    }

    #[test]
    fn media_reference_uses_mime_type_as_kind_owner() {
        let part = runtime_media_part_from_reference(media_input(
            "sidecar://media/input-1",
            " Image/PNG ",
        ))
        .expect("image reference");

        match part {
            RuntimeContentPart::Media {
                kind,
                reference,
                caption,
            } => {
                assert_eq!(kind, RuntimeMediaKind::Image);
                assert_eq!(reference.uri, "sidecar://media/input-1");
                assert_eq!(reference.mime_type, "image/png");
                assert_eq!(reference.title.as_deref(), Some("Screenshot"));
                assert_eq!(reference.source_uri, None);
                assert_eq!(reference.source_path, None);
                assert_eq!(reference.preview_url, None);
                assert_eq!(reference.sidecar_ref, None);
                assert_eq!(reference.sha256.as_deref(), Some("sha256:abcd"));
                assert_eq!(reference.byte_size, Some(42));
                assert_eq!(caption.as_deref(), Some("UI state"));
            }
            RuntimeContentPart::Text { .. } => panic!("expected media part"),
        }
    }

    #[test]
    fn media_reference_serializes_as_runtime_content_part() {
        let part =
            runtime_media_part_from_reference(media_input("artifact://image/1", "image/webp"))
                .expect("media reference");

        assert_eq!(
            serde_json::to_value(part).expect("json"),
            json!({
                "type": "media",
                "kind": "image",
                "reference": {
                    "uri": "artifact://image/1",
                    "mime_type": "image/webp",
                    "title": "Screenshot",
                    "sha256": "sha256:abcd",
                    "byte_size": 42
                },
                "caption": "UI state"
            })
        );
    }

    #[test]
    fn media_reference_keeps_optional_source_owner_fields() {
        let mut input = media_input("sidecar://session-1/media/image-1", "image/png");
        input.source_uri = Some("sidecar://session-1/media/image-1".to_string());
        input.source_path = Some("  /tmp/lime/sidecars/image-1.png  ".to_string());
        input.preview_url = Some("  asset:///tmp/lime/sidecars/image-1.png  ".to_string());
        input.sidecar_ref = Some(json!({
            "ref": "sidecar://media/image-1",
            "kind": "media",
            "relativePath": "sessions/session-1/media/image-1.png",
            "sha256": "sha256:abcd",
            "bytes": 42
        }));

        let part = runtime_media_part_from_reference(input).expect("media reference");

        assert_eq!(
            serde_json::to_value(part).expect("json"),
            json!({
                "type": "media",
                "kind": "image",
                "reference": {
                    "uri": "sidecar://session-1/media/image-1",
                    "mime_type": "image/png",
                    "title": "Screenshot",
                    "source_uri": "sidecar://session-1/media/image-1",
                    "source_path": "/tmp/lime/sidecars/image-1.png",
                    "preview_url": "asset:///tmp/lime/sidecars/image-1.png",
                    "sidecar_ref": {
                        "ref": "sidecar://media/image-1",
                        "kind": "media",
                        "relativePath": "sessions/session-1/media/image-1.png",
                        "sha256": "sha256:abcd",
                        "bytes": 42
                    },
                    "sha256": "sha256:abcd",
                    "byte_size": 42
                },
                "caption": "UI state"
            })
        );
    }

    #[test]
    fn media_reference_drops_inline_source_owner_fields() {
        let mut input = media_input("sidecar://session-1/media/image-1", "image/png");
        input.source_uri = Some("data:image/png;base64,AAAA".to_string());
        input.preview_url = Some("data:image/png;base64,BBBB".to_string());

        let part = runtime_media_part_from_reference(input).expect("media reference");

        match part {
            RuntimeContentPart::Media { reference, .. } => {
                assert_eq!(reference.source_uri, None);
                assert_eq!(reference.preview_url, None);
            }
            RuntimeContentPart::Text { .. } => panic!("expected media part"),
        }
    }

    #[test]
    fn media_part_rejects_inline_data_url_payloads() {
        let error = runtime_media_part_from_reference(media_input(
            "data:image/png;base64,abcd",
            "image/png",
        ))
        .expect_err("inline payload should stay out of runtime item");

        assert_eq!(error, RuntimeContentPartError::InlineMediaPayload);
    }

    #[test]
    fn unsupported_mime_type_is_not_inferred_from_file_name() {
        let error = runtime_media_part_from_reference(media_input(
            "sidecar://media/screenshot.png",
            "text/plain",
        ))
        .expect_err("file extension must not decide media kind");

        assert_eq!(
            error,
            RuntimeContentPartError::UnsupportedMimeType {
                mime_type: "text/plain".to_string()
            }
        );
    }

    #[test]
    fn pdf_is_file_reference_for_desktop_multimodal_context() {
        let part = runtime_media_part_from_reference(media_input(
            "sidecar://docs/spec",
            "application/pdf",
        ))
        .expect("pdf reference");

        match part {
            RuntimeContentPart::Media { kind, .. } => {
                assert_eq!(kind, RuntimeMediaKind::File);
            }
            RuntimeContentPart::Text { .. } => panic!("expected media file part"),
        }
    }

    #[test]
    fn text_part_does_not_require_reference() {
        let part = RuntimeContentPart::text("hello");

        assert!(!part.requires_reference());
    }

    #[test]
    fn message_delta_text_serializes_as_runtime_content_owner() {
        let content = RuntimeMessageDeltaContent::text("hello");

        assert_eq!(
            serde_json::to_value(content).expect("json"),
            json!({
                "text": "hello"
            })
        );
    }

    #[test]
    fn message_delta_content_part_keeps_single_part_alias_and_list_in_sync() {
        let part =
            runtime_media_part_from_reference(media_input("artifact://image/1", "image/webp"))
                .expect("media reference");
        let part_value = serde_json::to_value(part.clone()).expect("part json");
        let content = RuntimeMessageDeltaContent::content_part(part);

        assert_eq!(
            serde_json::to_value(content).expect("json"),
            json!({
                "contentPart": part_value.clone(),
                "contentParts": [part_value]
            })
        );
    }

    #[test]
    fn message_delta_payload_parser_ignores_event_metadata() {
        let content = RuntimeMessageDeltaContent::from_payload(&json!({
            "text": "hello",
            "backend": "llm_protocol",
            "source": "llm_protocol_media_output",
            "runtimeEvent": { "type": "output_delta" }
        }))
        .expect("parse message delta");

        assert_eq!(content.text.as_deref(), Some("hello"));
        assert!(content.content_part.is_none());
        assert!(content.content_parts.is_empty());
    }

    #[test]
    fn message_delta_payload_parser_normalizes_single_part_alias() {
        let part =
            runtime_media_part_from_reference(media_input("artifact://image/1", "image/webp"))
                .expect("media reference");
        let part_value = serde_json::to_value(part.clone()).expect("part json");

        let content_from_part = RuntimeMessageDeltaContent::from_payload(&json!({
            "contentPart": part_value
        }))
        .expect("parse contentPart");
        assert_eq!(content_from_part.content_part.as_ref(), Some(&part));
        assert_eq!(content_from_part.content_parts, vec![part.clone()]);

        let content_from_parts = RuntimeMessageDeltaContent::from_payload(&json!({
            "contentParts": [part_value]
        }))
        .expect("parse contentParts");
        assert_eq!(content_from_parts.content_part.as_ref(), Some(&part));
        assert_eq!(content_from_parts.content_parts, vec![part]);
    }

    #[test]
    fn message_delta_payload_parser_rejects_mismatched_part_alias() {
        let image_part =
            runtime_media_part_from_reference(media_input("artifact://image/1", "image/webp"))
                .expect("image reference");
        let audio_part =
            runtime_media_part_from_reference(media_input("artifact://audio/1", "audio/mpeg"))
                .expect("audio reference");

        let error = RuntimeMessageDeltaContent::from_payload(&json!({
            "contentPart": serde_json::to_value(image_part).expect("image json"),
            "contentParts": [serde_json::to_value(audio_part).expect("audio json")]
        }))
        .expect_err("mismatched aliases should fail");

        assert_eq!(
            error,
            RuntimeMessageDeltaContentParseError::MismatchedContentPartAlias
        );
    }

    #[test]
    fn supported_mime_policy_covers_opencode_media_allowlist_plus_pdf() {
        for mime_type in [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "audio/wav",
            "audio/mp3",
            "audio/aiff",
            "audio/aac",
            "audio/ogg",
            "audio/flac",
            "application/pdf",
        ] {
            assert!(
                is_supported_runtime_media_mime_type(mime_type),
                "{mime_type} should be supported"
            );
        }
        assert_eq!(
            runtime_media_kind_for_mime_type("application/pdf"),
            Some(RuntimeMediaKind::File)
        );
    }
}
