//! Desktop local-environment files remain owned by the shared App Server.

mod paths;
#[cfg(test)]
mod tests;

use app_server_protocol::protocol::v2::*;
use app_server_protocol::{error_codes, JsonRpcError};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
static SAVE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn list(
    params: LocalEnvironmentsListParams,
) -> Result<LocalEnvironmentsListResponse, JsonRpcError> {
    paths::ensure_local_host(params.host_id.as_deref())?;
    let root = paths::workspace_root(&params.workspace_root)?;
    let mut files = Vec::new();
    for (distance, ancestor) in root.ancestors().enumerate() {
        let directory = ancestor.join(".codex").join("environments");
        paths::check_environment_directory(&directory)?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(io_error(error)),
        };
        for entry in entries {
            let path = entry.map_err(io_error)?.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "toml")
            {
                files.push((path, distance));
            }
        }
    }
    files.sort_by(|(left, left_distance), (right, right_distance)| {
        let left_default = left
            .file_name()
            .is_some_and(|name| name == "environment.toml");
        let right_default = right
            .file_name()
            .is_some_and(|name| name == "environment.toml");
        right_default
            .cmp(&left_default)
            .then(left_distance.cmp(right_distance))
            .then(left.cmp(right))
    });
    let environments = files
        .into_iter()
        .map(|(path, _)| match read_raw(&path) {
            Ok(Some(raw)) => environment_result(&path, &raw),
            Ok(None) => error_result(&path, "Environment config no longer exists".into()),
            Err(error) => error_result(&path, error.message),
        })
        .collect();
    Ok(LocalEnvironmentsListResponse { environments })
}

pub(crate) fn read_config(
    params: LocalEnvironmentsReadConfigParams,
) -> Result<LocalEnvironmentsReadConfigResponse, JsonRpcError> {
    paths::ensure_local_host(params.host_id.as_deref())?;
    let path = paths::config_path(&params.config_path)?;
    let raw = read_raw(&path)?;
    Ok(LocalEnvironmentsReadConfigResponse {
        config_path: path.to_string_lossy().into_owned(),
        exists: raw.is_some(),
        revision: raw.as_deref().map(revision),
        environment: raw.as_deref().map(|raw| environment_result(&path, raw)),
        raw,
    })
}

pub(crate) fn save_config(
    params: LocalEnvironmentsSaveConfigParams,
) -> Result<LocalEnvironmentsSaveConfigResponse, JsonRpcError> {
    paths::ensure_local_host(params.host_id.as_deref())?;
    let path = paths::config_path(&params.config_path)?;
    if params.raw.len() as u64 > MAX_CONFIG_BYTES {
        return Err(invalid_params("Environment config exceeds 1 MiB"));
    }
    // The editor and external file tools can both produce TOML; never persist an invalid document.
    parse_environment(&params.raw).map_err(invalid_params)?;
    let _guard = SAVE_LOCK.lock().map_err(|_| {
        JsonRpcError::new(
            error_codes::RUNTIME_ERROR,
            "Environment save lock is unavailable",
        )
    })?;
    let previous = read_raw(&path)?;
    let previous_revision = previous.as_deref().map(revision);
    let response = |status, revision| LocalEnvironmentsSaveConfigResponse {
        config_path: path.to_string_lossy().into_owned(),
        status,
        revision,
    };
    if previous.as_deref() == Some(params.raw.as_str()) {
        return Ok(response(
            LocalEnvironmentSaveStatus::Success,
            previous_revision,
        ));
    }
    if previous_revision != params.expected_revision {
        return Ok(response(
            LocalEnvironmentSaveStatus::Conflict,
            previous_revision,
        ));
    }
    let parent = path.parent().expect("validated environment directory");
    paths::create_environment_directory(parent)?;
    let mut pending = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    if previous.is_some() {
        pending
            .as_file()
            .set_permissions(fs::metadata(&path).map_err(io_error)?.permissions())
            .map_err(io_error)?;
    }
    pending.write_all(params.raw.as_bytes()).map_err(io_error)?;
    pending.as_file().sync_all().map_err(io_error)?;
    paths::check_environment_directory(parent)?;
    // Re-read after staging so a visible external change does not get overwritten.
    let current = read_raw(&path)?;
    if current != previous {
        return Ok(response(
            LocalEnvironmentSaveStatus::Conflict,
            current.as_deref().map(revision),
        ));
    }
    if previous.is_none() {
        if let Err(error) = pending.persist_noclobber(&path) {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                let current = read_raw(&path)?;
                return Ok(response(
                    if current.as_deref() == Some(params.raw.as_str()) {
                        LocalEnvironmentSaveStatus::Success
                    } else {
                        LocalEnvironmentSaveStatus::Conflict
                    },
                    current.as_deref().map(revision),
                ));
            }
            return Err(io_error(error.error));
        }
    } else {
        pending
            .persist(&path)
            .map_err(|error| io_error(error.error))?;
    }
    Ok(response(
        LocalEnvironmentSaveStatus::Success,
        Some(revision(&params.raw)),
    ))
}

fn read_raw(path: &Path) -> Result<Option<String>, JsonRpcError> {
    paths::check_file(path)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    };
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
        return Err(invalid_params(
            "Environment config must be a file of at most 1 MiB",
        ));
    }
    let mut raw = String::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(io_error)?;
    if raw.len() as u64 > MAX_CONFIG_BYTES {
        return Err(invalid_params("Environment config exceeds 1 MiB"));
    }
    Ok(Some(raw))
}

fn revision(raw: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(raw.as_bytes()))
}

fn environment_result(path: &Path, raw: &str) -> LocalEnvironmentResult {
    match parse_environment(raw) {
        Ok(environment) => LocalEnvironmentResult::Success {
            config_path: path.to_string_lossy().into_owned(),
            cwd_relative_to_git_root: paths::cwd_relative_to_git_root(path),
            environment,
        },
        Err(message) => error_result(path, message),
    }
}

fn error_result(path: &Path, message: String) -> LocalEnvironmentResult {
    LocalEnvironmentResult::Error {
        config_path: path.to_string_lossy().into_owned(),
        cwd_relative_to_git_root: paths::cwd_relative_to_git_root(path),
        error: LocalEnvironmentError { message },
    }
}

fn parse_environment(raw: &str) -> Result<LocalEnvironment, String> {
    let mut value: serde_json::Value =
        toml_edit::de::from_str(raw).map_err(|e| format!("Invalid environment TOML: {e}"))?;
    let table = value
        .as_object_mut()
        .ok_or("Environment config must be a table")?;
    table.entry("version").or_insert(serde_json::json!(1));
    if let Some(actions) = table
        .get_mut("actions")
        .and_then(serde_json::Value::as_array_mut)
    {
        actions.retain(|action| {
            action
                .get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|name| !name.trim().is_empty())
                && action
                    .get("command")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|command| !command.trim().is_empty())
        });
        for action in actions {
            let icon = action.get("icon").and_then(serde_json::Value::as_str);
            if !matches!(icon, Some("tool" | "run" | "debug" | "test")) {
                action["icon"] = serde_json::Value::Null;
            }
        }
    }
    let mut environment: LocalEnvironment =
        serde_json::from_value(value).map_err(|e| format!("Invalid environment config: {e}"))?;
    if environment.version == 0 {
        return Err("Environment version must be at least 1".into());
    }
    environment.name = environment.name.trim().into();
    normalize_lifecycle(&mut environment.setup);
    if let Some(cleanup) = &mut environment.cleanup {
        normalize_lifecycle(cleanup);
    }
    if let Some(actions) = &mut environment.actions {
        for action in actions {
            action.name = action.name.trim().into();
            action.command = action.command.trim().into();
        }
    }
    Ok(environment)
}

fn normalize_lifecycle(lifecycle: &mut LocalEnvironmentLifecycle) {
    lifecycle.script = lifecycle.script.trim().into();
    for script in [
        &mut lifecycle.darwin,
        &mut lifecycle.linux,
        &mut lifecycle.win32,
    ]
    .into_iter()
    .flatten()
    {
        script.script = script.script.trim().into();
    }
}

fn invalid_params(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_PARAMS, message)
}

fn io_error(error: std::io::Error) -> JsonRpcError {
    JsonRpcError::new(
        error_codes::RUNTIME_ERROR,
        format!("Environment file operation failed: {error}"),
    )
}
