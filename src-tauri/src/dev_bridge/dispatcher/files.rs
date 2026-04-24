use super::{args_or_default, get_string_arg};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

type DynError = Box<dyn std::error::Error>;

fn read_optional_usize_arg(
    args: &JsonValue,
    primary: &str,
    secondary: &str,
) -> Result<Option<usize>, DynError> {
    let value = args.get(primary).or_else(|| args.get(secondary));
    match value {
        Some(raw) if raw.is_null() => Ok(None),
        Some(raw) => {
            let parsed = serde_json::from_value::<usize>(raw.clone())
                .map_err(|error| format!("参数 {primary}/{secondary} 解析失败: {error}"))?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}

pub(super) async fn try_handle(
    _state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "session_files_save_file" => {
            let args = args_or_default(args);
            let session_id = get_string_arg(&args, "session_id", "sessionId")?;
            let file_name = get_string_arg(&args, "file_name", "fileName")?;
            let content = get_string_arg(&args, "content", "content")?;
            let metadata = args.get("metadata").cloned();
            let storage = crate::session_files::SessionFileStorage::new()
                .map_err(|error| format!("SessionFileStorage 初始化失败: {error}"))?;
            serde_json::to_value(
                storage
                    .save_file_with_metadata(&session_id, &file_name, &content, metadata)
                    .map_err(|error| format!("保存会话文件失败: {error}"))?,
            )?
        }
        "read_file_preview_cmd" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            let max_size = read_optional_usize_arg(&args, "max_size", "maxSize")?;
            serde_json::to_value(
                crate::services::file_browser_service::read_file_preview_cmd(path, max_size)
                    .await
                    .map_err(|error| format!("读取文件预览失败: {error}"))?,
            )?
        }
        "session_files_resolve_file_path" => {
            let args = args_or_default(args);
            let session_id = get_string_arg(&args, "session_id", "sessionId")?;
            let file_name = get_string_arg(&args, "file_name", "fileName")?;
            let storage = crate::session_files::SessionFileStorage::new()
                .map_err(|error| format!("SessionFileStorage 初始化失败: {error}"))?;
            serde_json::json!(storage
                .resolve_file_path(&session_id, &file_name)
                .map_err(|error| format!("解析会话文件路径失败: {error}"))?)
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
