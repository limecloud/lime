//! Lower typed tool output through the existing canonical media payload boundary.

use super::{ContentPart, CurrentProviderError, CurrentProviderToolResult, ToolResultValue};
use agent_protocol::response_item::FunctionCallOutputContentItem;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) fn canonical_result(
    result: &CurrentProviderToolResult,
) -> Result<ToolResultValue, CurrentProviderError> {
    if !result
        .content_items
        .iter()
        .any(|item| !matches!(item, FunctionCallOutputContentItem::InputText { .. }))
    {
        return Ok(if result.success {
            ToolResultValue::text(result.output.clone())
        } else {
            ToolResultValue::Error {
                value: serde_json::json!({"output":result.output,"error":result.error}),
            }
        });
    }
    let value = result
        .content_items
        .iter()
        .map(|item| match item {
            FunctionCallOutputContentItem::InputText { text } => Ok(ContentPart::text(text)),
            FunctionCallOutputContentItem::InputImage { image_url, detail } => {
                media_part(image_url, "image/", *detail)
            }
            FunctionCallOutputContentItem::InputAudio { audio_url } => {
                media_part(audio_url, "audio/", None)
            }
            FunctionCallOutputContentItem::EncryptedContent { .. } => {
                Err(CurrentProviderError::invalid_request(
                    "encrypted tool output has no canonical lowering",
                ))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ToolResultValue::Content { value })
}

fn media_part(
    url: &str,
    kind: &str,
    detail: Option<agent_protocol::ImageDetail>,
) -> Result<ContentPart, CurrentProviderError> {
    let (uri, media_type) = media_reference(url, kind)?;
    ContentPart::media_with_detail(uri, media_type, detail)
        .map_err(|error| CurrentProviderError::invalid_request(error.to_string()))
}

fn media_reference(url: &str, kind: &str) -> Result<(String, String), CurrentProviderError> {
    if let Some(data) = url.strip_prefix("data:") {
        let (header, payload) = data.split_once(',').ok_or_else(invalid_media)?;
        let media_type = header.split(';').next().unwrap_or_default();
        if !media_type.starts_with(kind)
            || !header
                .split(';')
                .any(|part| part.eq_ignore_ascii_case("base64"))
            || payload.is_empty()
        {
            return Err(invalid_media());
        }
        // Bytes stay in the provider payload map; canonical content only carries an opaque URI.
        let digest = format!("{:x}", Sha256::digest(url.as_bytes()));
        return Ok((
            format!("opaque://tool-output/{digest}"),
            media_type.to_string(),
        ));
    }
    let parsed = url::Url::parse(url).map_err(|_| invalid_media())?;
    if !matches!(parsed.scheme(), "http" | "https" | "gs") {
        return Err(invalid_media());
    }
    Ok((
        url.to_string(),
        format!("{kind}{}", if kind == "image/" { "png" } else { "wav" }),
    ))
}

fn invalid_media() -> CurrentProviderError {
    CurrentProviderError::invalid_request(
        "tool media requires a typed base64 data URL or remote URI",
    )
}

pub(super) fn collect_media_payloads(
    result: &CurrentProviderToolResult,
    payloads: &mut BTreeMap<String, String>,
) -> Result<(), CurrentProviderError> {
    for item in &result.content_items {
        let (url, kind) = match item {
            FunctionCallOutputContentItem::InputImage { image_url, .. } => (image_url, "image/"),
            FunctionCallOutputContentItem::InputAudio { audio_url } => (audio_url, "audio/"),
            _ => continue,
        };
        let (uri, _) = media_reference(url, kind)?;
        if url.starts_with("data:") {
            if payloads
                .insert(uri, url.clone())
                .is_some_and(|previous| previous != *url)
            {
                return Err(CurrentProviderError::invalid_request(
                    "conflicting tool media payloads",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
