use super::{args_or_default, get_string_arg, parse_nested_arg};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;
use std::io;

type DynError = Box<dyn std::error::Error>;

fn to_dyn_error(message: String) -> DynError {
    io::Error::other(message).into()
}

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
        "list_dir" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::list_dir(path)
                    .await
                    .map_err(|error| format!("列出目录失败: {error}"))?,
            )?
        }
        "get_home_dir" => serde_json::to_value(
            crate::services::file_browser_service::get_home_dir()
                .await
                .map_err(|error| format!("读取用户主目录失败: {error}"))?,
        )?,
        "get_file_manager_locations" => serde_json::to_value(
            crate::services::file_browser_service::get_file_manager_locations()
                .await
                .map_err(|error| format!("读取文件管理器快捷入口失败: {error}"))?,
        )?,
        "get_file_icon_data_url" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::get_file_icon_data_url(path)
                    .await
                    .map_err(|error| format!("读取文件图标失败: {error}"))?,
            )?
        }
        "create_file" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::create_file(path)
                    .await
                    .map_err(|error| format!("创建文件失败: {error}"))?,
            )?
        }
        "create_directory" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::create_directory(path)
                    .await
                    .map_err(|error| format!("创建目录失败: {error}"))?,
            )?
        }
        "delete_file" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            let recursive = args
                .get("recursive")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            serde_json::to_value(
                crate::services::file_browser_service::delete_file(path, recursive)
                    .await
                    .map_err(|error| format!("删除文件失败: {error}"))?,
            )?
        }
        "rename_file" => {
            let args = args_or_default(args);
            let old_path = get_string_arg(&args, "old_path", "oldPath")?;
            let new_path = get_string_arg(&args, "new_path", "newPath")?;
            serde_json::to_value(
                crate::services::file_browser_service::rename_file(old_path, new_path)
                    .await
                    .map_err(|error| format!("重命名文件失败: {error}"))?,
            )?
        }
        "get_file_name" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::get_file_name(path)
                    .await
                    .map_err(|error| format!("读取文件名失败: {error}"))?,
            )?
        }
        "reveal_in_finder" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::reveal_in_finder(path)
                    .await
                    .map_err(|error| format!("在系统文件管理器中显示失败: {error}"))?,
            )?
        }
        "open_with_default_app" => {
            let args = args_or_default(args);
            let path = get_string_arg(&args, "path", "path")?;
            serde_json::to_value(
                crate::services::file_browser_service::open_with_default_app(path)
                    .await
                    .map_err(|error| format!("使用默认应用打开失败: {error}"))?,
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
        "save_layered_design_project_export" => {
            let args = args_or_default(args);
            let request: crate::commands::layered_design_cmd::SaveLayeredDesignProjectExportRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                crate::commands::layered_design_cmd::save_layered_design_project_export_inner(
                    request,
                )
                .await
                .map_err(to_dyn_error)?,
            )?
        }
        "read_layered_design_project_export" => {
            let args = args_or_default(args);
            let request: crate::commands::layered_design_cmd::ReadLayeredDesignProjectExportRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                crate::commands::layered_design_cmd::read_layered_design_project_export_inner(
                    request,
                )
                .map_err(to_dyn_error)?,
            )?
        }
        "recognize_layered_design_text" => {
            let args = args_or_default(args);
            let request: crate::commands::layered_design_cmd::RecognizeLayeredDesignTextRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                crate::commands::layered_design_cmd::recognize_layered_design_text_inner(request)
                    .map_err(to_dyn_error)?,
            )?
        }
        "analyze_layered_design_flat_image" => {
            let args = args_or_default(args);
            let request: crate::commands::layered_design_cmd::AnalyzeLayeredDesignFlatImageRequest =
                parse_nested_arg(&args, "request")?;
            serde_json::to_value(
                crate::commands::layered_design_cmd::analyze_layered_design_flat_image_inner(
                    request,
                )
                .map_err(to_dyn_error)?,
            )?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
