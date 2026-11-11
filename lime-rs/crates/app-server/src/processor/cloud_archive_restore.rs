use app_server_transport::ConnectionId;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use lime_services::cloud_archive_service::{CloudRestoreIdentity, MAX_CLOUD_CIPHERTEXT_BYTES};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tempfile::NamedTempFile;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use super::cloud_archive_download::{CHUNK_BYTES, STAGING_TTL};

struct Restore {
    owner: ConnectionId,
    id: Uuid,
    destination: PathBuf,
    identity: CloudRestoreIdentity,
    staged: NamedTempFile,
    bytes: u64,
    _permit: OwnedSemaphorePermit,
}

pub(super) struct CloudArchiveRestores {
    permit: Arc<Semaphore>,
    current: Mutex<Option<Restore>>,
}

impl Default for CloudArchiveRestores {
    fn default() -> Self {
        Self {
            permit: Arc::new(Semaphore::new(1)),
            current: Mutex::new(None),
        }
    }
}

fn destination(home: &Path, name: &str) -> Result<PathBuf, String> {
    if !(1..=80).contains(&name.len())
        || !name.as_bytes()[0].is_ascii_alphanumeric()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Restore folder name must use letters, digits, hyphens or underscores".into());
    }
    let root = home
        .canonicalize()
        .map_err(|_| "Cannot resolve cloud desktop home")?;
    let destination = root.join(format!("lime-restored-{name}"));
    match std::fs::symlink_metadata(&destination) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(destination),
        _ => Err("Cloud restore folder already exists or is unavailable".into()),
    }
}

impl CloudArchiveRestores {
    pub(super) fn begin(
        self: &Arc<Self>,
        owner: ConnectionId,
        name: &str,
    ) -> Result<Value, String> {
        let home = dirs::home_dir().ok_or("Cannot resolve cloud desktop home")?;
        let destination = destination(&home, name)?;
        let permit = Arc::clone(&self.permit)
            .try_acquire_owned()
            .map_err(|_| "A cloud archive restore is already active")?;
        let id = Uuid::new_v4();
        let identity = CloudRestoreIdentity::generate();
        let recipient = identity.recipient();
        let staged = tempfile::Builder::new()
            .prefix("lime-restore-ciphertext-")
            .tempfile()
            .map_err(|_| "Cannot create private cloud restore staging")?;
        *self
            .current
            .lock()
            .map_err(|_| "Cloud restore state unavailable")? = Some(Restore {
            owner,
            id,
            destination,
            identity,
            staged,
            bytes: 0,
            _permit: permit,
        });
        let restores = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(STAGING_TTL).await;
            if let Some(restores) = restores.upgrade() {
                restores.clear(owner, Some(id));
            }
        });
        Ok(json!({ "archiveId": id, "recipient": recipient, "chunkBytes": CHUNK_BYTES }))
    }

    pub(super) fn write(
        &self,
        owner: ConnectionId,
        id: Uuid,
        offset: u64,
        data: &str,
    ) -> Result<Value, String> {
        if data.is_empty() || data.len() > (4 * CHUNK_BYTES.div_ceil(3)) as usize {
            return Err("Invalid cloud restore chunk size".into());
        }
        let mut state = self
            .current
            .lock()
            .map_err(|_| "Cloud restore state unavailable")?;
        let entry = state
            .as_mut()
            .filter(|entry| entry.owner == owner && entry.id == id)
            .ok_or("Cloud restore upload is unavailable")?;
        if offset != entry.bytes {
            return Err("Invalid cloud restore upload offset".into());
        }
        let chunk = STANDARD
            .decode(data)
            .map_err(|_| "Invalid cloud restore chunk encoding")?;
        let bytes = entry
            .bytes
            .checked_add(chunk.len() as u64)
            .filter(|size| {
                !chunk.is_empty()
                    && chunk.len() as u64 <= CHUNK_BYTES
                    && *size <= MAX_CLOUD_CIPHERTEXT_BYTES
            })
            .ok_or("Invalid cloud restore chunk size")?;
        if entry.staged.write_all(&chunk).is_err() {
            drop(state.take());
            return Err("Cannot stage cloud restore chunk".into());
        }
        entry.bytes = bytes;
        Ok(json!({ "receivedBytes": bytes }))
    }

    pub(super) async fn finish(
        &self,
        owner: ConnectionId,
        id: Uuid,
        sha256: String,
        bytes: u64,
    ) -> Result<Value, String> {
        let entry = {
            let mut state = self
                .current
                .lock()
                .map_err(|_| "Cloud restore state unavailable")?;
            let entry = state
                .as_ref()
                .filter(|entry| entry.owner == owner && entry.id == id)
                .ok_or("Cloud restore upload is unavailable")?;
            if bytes == 0
                || bytes != entry.bytes
                || sha256.len() != 64
                || !sha256.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Cloud restore size or checksum is invalid".into());
            }
            state.take().ok_or("Cloud restore upload is unavailable")?
        };
        // Once finish was accepted the outcome may be unknown to a disconnected client.
        // Hold the staging file, recipient and slot until the worker exits.
        tokio::task::spawn_blocking(move || {
            let Restore {
                destination,
                identity,
                staged,
                _permit,
                ..
            } = entry;
            identity.restore(staged.path(), &destination, &sha256)
        })
        .await
        .map_err(|_| "Cloud restore worker failed")?
    }

    pub(super) fn clear(&self, owner: ConnectionId, id: Option<Uuid>) -> bool {
        let Ok(mut state) = self.current.lock() else {
            return false;
        };
        if state
            .as_ref()
            .is_some_and(|entry| entry.owner == owner && id.is_none_or(|id| entry.id == id))
        {
            let entry = state.take();
            drop(state);
            drop(entry);
            true
        } else {
            false
        }
    }
}
