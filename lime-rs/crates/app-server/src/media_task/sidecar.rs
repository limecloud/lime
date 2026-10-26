use super::{data_error, maybe_json_string, AUDIO_TASK_DEFAULT_MIME_TYPE};
use crate::runtime::sidecar_store::{
    session_scoped_relative_path, SidecarBytesWriteRequest, SidecarStore,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_MEDIA_SIDECAR_WRITE_BYTES: usize = 32 * 1024 * 1024;
const REMOTE_MEDIA_SIDECAR_TIMEOUT_SECS: u64 = 10;

pub(crate) fn image_outputs_are_ready(record: &Value) -> bool {
    record
        .pointer("/result/images")
        .and_then(Value::as_array)
        .is_some_and(|images| {
            !images.is_empty()
                && images.iter().all(|image| {
                    image
                        .get("sidecarRef")
                        .or_else(|| image.get("sidecar_ref"))
                        .is_some()
                })
        })
}

pub(super) struct MediaSidecarContext<'a> {
    store: &'a SidecarStore,
    workspace_root: &'a Path,
    session_id: String,
    task_ref: &'a str,
    media_kind: &'a str,
    default_mime_type: Option<&'a str>,
}

#[derive(Debug)]
struct MediaBytesSource {
    bytes: Vec<u8>,
    mime_type: Option<String>,
    extension: String,
}

pub(super) fn image_sidecar_context<'a>(
    sidecar_store: Option<&'a SidecarStore>,
    workspace_root: &'a Path,
    task_ref: &'a str,
    payload: &Value,
) -> Option<MediaSidecarContext<'a>> {
    media_sidecar_context(
        sidecar_store,
        workspace_root,
        task_ref,
        payload,
        "image",
        None,
    )
}

pub(super) fn attach_image_sidecar_ref(
    image_output: &mut Value,
    context: &MediaSidecarContext<'_>,
    source: &str,
    index: usize,
) -> Result<(), String> {
    let Some(sidecar_ref) = persist_media_output_sidecar(context, source, index)? else {
        return Ok(());
    };
    if let Some(object) = image_output.as_object_mut() {
        object.insert("sidecarRef".to_string(), sidecar_ref);
    }
    Ok(())
}

pub(super) async fn attach_missing_image_sidecar_refs(
    result: &mut Value,
    context: &MediaSidecarContext<'_>,
) -> Result<bool, String> {
    let Some(images) = result.get_mut("images").and_then(Value::as_array_mut) else {
        return Ok(false);
    };

    let mut changed = false;
    for (index, image) in images.iter_mut().enumerate() {
        if image.get("sidecarRef").is_some() || image.get("sidecar_ref").is_some() {
            continue;
        }
        let Some(url) = maybe_json_string(image, &["url", "image_url", "imageUrl"]) else {
            continue;
        };
        attach_image_sidecar_ref_with_remote(image, context, &url, index).await?;
        changed |= image.get("sidecarRef").is_some();
    }
    Ok(changed)
}

async fn attach_image_sidecar_ref_with_remote(
    image_output: &mut Value,
    context: &MediaSidecarContext<'_>,
    source: &str,
    index: usize,
) -> Result<(), String> {
    let Some(sidecar_ref) =
        persist_media_output_sidecar_with_remote(context, source, index).await?
    else {
        return Ok(());
    };
    if let Some(object) = image_output.as_object_mut() {
        object.insert("sidecarRef".to_string(), sidecar_ref);
    }
    Ok(())
}

pub(super) fn attach_audio_sidecar_ref(
    mut audio_output: Value,
    sidecar_store: Option<&SidecarStore>,
    workspace_root: &str,
    task_ref: &str,
    payload: &Value,
) -> Result<Value, String> {
    let Some(context) = media_sidecar_context(
        sidecar_store,
        Path::new(workspace_root),
        task_ref,
        payload,
        "audio",
        Some(AUDIO_TASK_DEFAULT_MIME_TYPE),
    ) else {
        return Ok(audio_output);
    };
    let Some(audio_path) = maybe_json_string(&audio_output, &["audio_path", "audioPath"]) else {
        return Ok(audio_output);
    };
    attach_image_sidecar_ref(&mut audio_output, &context, audio_path.as_str(), 0)?;
    Ok(audio_output)
}

fn media_sidecar_context<'a>(
    sidecar_store: Option<&'a SidecarStore>,
    workspace_root: &'a Path,
    task_ref: &'a str,
    payload: &Value,
    media_kind: &'a str,
    default_mime_type: Option<&'a str>,
) -> Option<MediaSidecarContext<'a>> {
    let session_id = maybe_json_string(payload, &["session_id", "sessionId"])?;
    Some(MediaSidecarContext {
        store: sidecar_store?,
        workspace_root,
        session_id,
        task_ref,
        media_kind,
        default_mime_type,
    })
}

fn persist_media_output_sidecar(
    context: &MediaSidecarContext<'_>,
    source: &str,
    index: usize,
) -> Result<Option<Value>, String> {
    let Some(media) =
        read_media_bytes_source(source, context.workspace_root, context.default_mime_type)?
    else {
        return Ok(None);
    };
    write_media_sidecar(context, media, index)
}

async fn persist_media_output_sidecar_with_remote(
    context: &MediaSidecarContext<'_>,
    source: &str,
    index: usize,
) -> Result<Option<Value>, String> {
    let Some(media) =
        read_media_bytes_source_with_remote(source, context.workspace_root, context).await?
    else {
        return Ok(None);
    };
    write_media_sidecar(context, media, index)
}

fn write_media_sidecar(
    context: &MediaSidecarContext<'_>,
    media: MediaBytesSource,
    index: usize,
) -> Result<Option<Value>, String> {
    if media.bytes.len() > MAX_MEDIA_SIDECAR_WRITE_BYTES {
        return Err(format!(
            "媒体 sidecar 超过写入上限: {} > {} bytes",
            media.bytes.len(),
            MAX_MEDIA_SIDECAR_WRITE_BYTES
        ));
    }
    let relative_path = session_scoped_relative_path(
        context.session_id.as_str(),
        &format!(
            "media/{:016x}-{}-{}.{}",
            stable_hash(context.task_ref),
            context.media_kind,
            index + 1,
            media.extension
        ),
    );
    let sidecar_ref = context
        .store
        .write_bytes(&SidecarBytesWriteRequest {
            session_id: context.session_id.clone(),
            kind: "media".to_string(),
            logical_id: format!("{}:{}:{}", context.task_ref, context.media_kind, index + 1),
            relative_path,
            content: media.bytes,
        })
        .map_err(|error| format!("保存媒体 sidecar 失败: {error}"))?;
    let mut value = serde_json::to_value(&sidecar_ref).map_err(data_error)?;
    if let Some(object) = value.as_object_mut() {
        object.insert("uri".to_string(), Value::String(sidecar_ref.ref_id.clone()));
        if let Some(mime_type) = media.mime_type {
            object.insert("mimeType".to_string(), Value::String(mime_type));
        }
    }
    Ok(Some(value))
}

fn read_media_bytes_source(
    source: &str,
    workspace_root: &Path,
    default_mime_type: Option<&str>,
) -> Result<Option<MediaBytesSource>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if let Some(media) = read_data_url_media_source(trimmed, default_mime_type)? {
        return Ok(Some(media));
    }
    let Some(path) = local_media_path(trimmed, workspace_root) else {
        return Ok(None);
    };
    let bytes = fs::read(&path)
        .map_err(|error| format!("读取媒体输出文件失败 {}: {error}", path.display()))?;
    Ok(Some(MediaBytesSource {
        bytes,
        mime_type: infer_mime_type(trimmed, default_mime_type),
        extension: media_extension(trimmed, default_mime_type),
    }))
}

async fn read_media_bytes_source_with_remote(
    source: &str,
    workspace_root: &Path,
    context: &MediaSidecarContext<'_>,
) -> Result<Option<MediaBytesSource>, String> {
    if let Some(media) = read_media_bytes_source(source, workspace_root, context.default_mime_type)?
    {
        return Ok(Some(media));
    }
    read_remote_media_bytes_source(source, context.media_kind).await
}

fn read_data_url_media_source(
    source: &str,
    default_mime_type: Option<&str>,
) -> Result<Option<MediaBytesSource>, String> {
    let Some(rest) = source.strip_prefix("data:") else {
        return Ok(None);
    };
    let Some((metadata, encoded)) = rest.split_once(',') else {
        return Err("媒体 data URL 缺少 payload".to_string());
    };
    if !metadata
        .split(';')
        .any(|part| part.eq_ignore_ascii_case("base64"))
    {
        return Err("媒体 data URL 只支持 base64 payload".to_string());
    }
    let mime_type = metadata
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| default_mime_type.map(ToOwned::to_owned));
    let bytes = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("媒体 data URL base64 解码失败: {error}"))?;
    Ok(Some(MediaBytesSource {
        bytes,
        extension: extension_for_mime_type(mime_type.as_deref()).to_string(),
        mime_type,
    }))
}

async fn read_remote_media_bytes_source(
    source: &str,
    media_kind: &str,
) -> Result<Option<MediaBytesSource>, String> {
    let trimmed = source.trim();
    let Ok(url) = reqwest::Url::parse(trimmed) else {
        return Ok(None);
    };
    if !remote_media_url_allowed(&url) {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(REMOTE_MEDIA_SIDECAR_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| format!("创建媒体远程下载客户端失败: {error}"))?;
    let response = match client.get(url).send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, source = %trimmed, "remote media sidecar download failed");
            return Ok(None);
        }
    };
    if !response.status().is_success() {
        tracing::warn!(
            status = %response.status(),
            source = %trimmed,
            "remote media sidecar download returned non-success status"
        );
        return Ok(None);
    }
    if !remote_media_url_allowed(response.url()) {
        tracing::warn!(source = %trimmed, "remote media sidecar download rejected final url");
        return Ok(None);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MEDIA_SIDECAR_WRITE_BYTES as u64)
    {
        tracing::warn!(source = %trimmed, "remote media sidecar download exceeded content-length limit");
        return Ok(None);
    }
    let Some(mime_type) = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_remote_media_mime_type)
        .filter(|mime_type| remote_media_mime_type_allowed(mime_type, media_kind))
    else {
        tracing::warn!(source = %trimmed, "remote media sidecar download rejected content type");
        return Ok(None);
    };
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::warn!(error = %error, source = %trimmed, "remote media sidecar bytes read failed");
            return Ok(None);
        }
    };
    if bytes.len() > MAX_MEDIA_SIDECAR_WRITE_BYTES {
        tracing::warn!(source = %trimmed, "remote media sidecar bytes exceeded limit");
        return Ok(None);
    }
    Ok(Some(MediaBytesSource {
        bytes: bytes.to_vec(),
        extension: extension_for_mime_type(Some(mime_type.as_str())).to_string(),
        mime_type: Some(mime_type),
    }))
}

fn remote_media_url_allowed(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "https") || (url.scheme() == "http" && is_loopback_remote_url(url))
}

fn normalize_remote_media_mime_type(value: &str) -> Option<String> {
    value
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn remote_media_mime_type_allowed(mime_type: &str, media_kind: &str) -> bool {
    match media_kind {
        "image" => matches!(
            mime_type,
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        ),
        "audio" => matches!(
            mime_type,
            "audio/mpeg" | "audio/mp3" | "audio/wav" | "audio/mp4" | "audio/ogg"
        ),
        _ => false,
    }
}

fn is_loopback_remote_url(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn local_media_path(source: &str, workspace_root: &Path) -> Option<PathBuf> {
    if source.contains("://") && !source.starts_with("file://") {
        return None;
    }
    let raw_path = source.strip_prefix("file://").unwrap_or(source);
    let path = Path::new(raw_path);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_root.join(path)
    };
    let workspace_root = fs::canonicalize(workspace_root).ok()?;
    let candidate = fs::canonicalize(candidate).ok()?;
    if !candidate.starts_with(&workspace_root) || !candidate.is_file() {
        return None;
    }
    Some(candidate)
}

fn infer_mime_type(source: &str, default_mime_type: Option<&str>) -> Option<String> {
    match Path::new(source)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png".to_string()),
        Some("jpg") | Some("jpeg") => Some("image/jpeg".to_string()),
        Some("webp") => Some("image/webp".to_string()),
        Some("gif") => Some("image/gif".to_string()),
        Some("mp3") => Some("audio/mpeg".to_string()),
        Some("wav") => Some("audio/wav".to_string()),
        Some("m4a") => Some("audio/mp4".to_string()),
        Some("ogg") => Some("audio/ogg".to_string()),
        _ => default_mime_type.map(ToOwned::to_owned),
    }
}

fn media_extension(source: &str, default_mime_type: Option<&str>) -> String {
    Path::new(source)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty() && extension.len() <= 8)
        .unwrap_or_else(|| extension_for_mime_type(default_mime_type).to_string())
}

fn extension_for_mime_type(mime_type: Option<&str>) -> &'static str {
    match mime_type.unwrap_or_default().to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "audio/wav" => "wav",
        "audio/mp4" => "m4a",
        "audio/ogg" => "ogg",
        "audio/mpeg" | "audio/mp3" => "mp3",
        _ => "bin",
    }
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
