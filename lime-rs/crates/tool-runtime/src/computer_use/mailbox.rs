//! Private per-user IPC shared by native-messaging and document hosts.
//! This carries adapter messages only; all business authority stays in the runtime.

use super::{denied, ComputerUseResult, ComputerUseSnapshot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(super) const MAX_BYTES: u64 = 900 * 1024;
pub(super) const SESSION_TTL_MS: u64 = 5_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Session {
    pub protocol: u32,
    pub adapter: String,
    pub updated_at: u64,
    pub snapshot: ComputerUseSnapshot,
}

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(super) fn private_directory(path: &Path) -> ComputerUseResult<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|e| denied(e.to_string()))?;
    super::broker::check_path(path, true)
}

pub(super) fn read(path: &Path) -> ComputerUseResult<Value> {
    super::broker::check_path(path, false)?;
    if fs::metadata(path).map_err(|e| denied(e.to_string()))?.len() > MAX_BYTES {
        return Err(denied("Adapter message exceeds its size limit"));
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| denied(e.to_string()))?)
        .map_err(|e| denied(e.to_string()))
}

pub(super) fn write(path: &Path, value: &impl Serialize) -> ComputerUseResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|e| denied(e.to_string()))?;
    write_bytes(path, &bytes)
}

pub(super) fn write_bytes(path: &Path, bytes: &[u8]) -> ComputerUseResult<()> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(denied("Adapter message exceeds its size limit"));
    }
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temporary)
            .map_err(|e| denied(e.to_string()))?;
        file.write_all(bytes).map_err(|e| denied(e.to_string()))?;
        fs::rename(&temporary, path).map_err(|e| denied(e.to_string()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn message_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
