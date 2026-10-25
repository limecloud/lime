//! Hook controls share the config RPC and the discovery/turn snapshot's TOML source.

use super::{config_runtime_error, config_write_error, parse_key_path};
use app_server_protocol::protocol::v2::{
    ConfigEdit, ConfigWriteErrorCode, ConfigWriteResponse, WriteStatus,
};
use app_server_protocol::JsonRpcError;
use sha2::{Digest, Sha256};
use std::path::Path;
use toml_edit::{DocumentMut, Item, Table};

pub(super) fn write_edits(
    file_path: Option<&str>,
    expected_version: Option<&str>,
    edits: &[ConfigEdit],
) -> Result<ConfigWriteResponse, JsonRpcError> {
    let home = lime_core::app_paths::resolve_lime_home_dir()
        .ok_or_else(|| config_runtime_error("cannot resolve LIME_HOME"))?;
    write_hook_edits(
        &home.join("config.toml"),
        file_path,
        expected_version,
        edits,
    )
}

fn invalid(message: impl Into<String>) -> JsonRpcError {
    config_write_error(ConfigWriteErrorCode::ConfigValidationError, message)
}

fn write_hook_edits(
    path: &Path,
    file_path: Option<&str>,
    expected_version: Option<&str>,
    edits: &[ConfigEdit],
) -> Result<ConfigWriteResponse, JsonRpcError> {
    if let Some(file) = file_path {
        if !Path::new(file).is_absolute() {
            return Err(config_write_error(
                ConfigWriteErrorCode::ConfigPathNotFound,
                "config filePath must be absolute",
            ));
        }
        if Path::new(file) != path {
            return Err(config_write_error(
                ConfigWriteErrorCode::ConfigLayerReadonly,
                "Hook state can only be written to the user hook config",
            ));
        }
    }
    // Validate the entire batch before touching either configuration file.
    let edits = edits
        .iter()
        .map(|edit| {
            let segments = parse_key_path(&edit.key_path).map_err(invalid)?;
            if segments.len() != 4
                || segments[0] != "hooks"
                || segments[1] != "state"
                || !matches!(segments[3].as_str(), "enabled" | "trusted_hash")
            {
                return Err(invalid(
                    "Hook state edits must target hooks.state.\"key\".enabled or trusted_hash; mixed config batches are not supported",
                ));
            }
            let valid = match segments[3].as_str() {
                "enabled" => edit.value.is_boolean() || edit.value.is_null(),
                "trusted_hash" => edit.value.is_string() || edit.value.is_null(),
                _ => false,
            };
            if !valid {
                return Err(invalid(format!("Invalid hook state value: {}", edit.key_path)));
            }
            Ok((segments, &edit.value))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(config_runtime_error(error)),
    };
    let version = hex::encode(Sha256::digest(source.as_bytes()));
    if expected_version.is_some_and(|expected| expected != version) {
        return Err(config_write_error(
            ConfigWriteErrorCode::ConfigVersionConflict,
            "Hook configuration was modified since last read. Fetch latest version and retry.",
        ));
    }
    let mut document = source
        .parse::<DocumentMut>()
        .map_err(|error| invalid(error.to_string()))?;
    'edits: for (segments, value) in edits {
        let mut table: &mut dyn toml_edit::TableLike = document.as_table_mut();
        for segment in &segments[..3] {
            // Clearing a missing leaf must not create an otherwise empty tree.
            if value.is_null() && !table.contains_key(segment) {
                continue 'edits;
            }
            let item = table.entry(segment).or_insert(Item::Table(Table::new()));
            table = item
                .as_table_like_mut()
                .ok_or_else(|| invalid(format!("Hook config table expected at {segment}")))?;
        }
        let leaf = &segments[3];
        if value.is_null() {
            table.remove(leaf);
        } else if let Some(enabled) = value.as_bool() {
            table.insert(leaf, toml_edit::value(enabled));
        } else if let Some(hash) = value.as_str() {
            table.insert(leaf, toml_edit::value(hash));
        }
    }
    let source = document.to_string();
    // Reuse the config owner's atomic, same-directory persistence (also used by project TOML).
    lime_core::config::layers::save_project(path, &source).map_err(config_runtime_error)?;
    Ok(ConfigWriteResponse {
        status: WriteStatus::Ok,
        version: hex::encode(Sha256::digest(source.as_bytes())),
        file_path: path.to_string_lossy().into_owned(),
        overridden_metadata: None,
    })
}

#[cfg(test)]
#[path = "hooks/tests.rs"]
mod tests;
