use app_server_transport::ConnectionId;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use lime_services::cloud_archive_service::{export_for_download, MAX_CLOUD_CIPHERTEXT_BYTES};
use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

pub(super) const CHUNK_BYTES: u64 = 256 * 1024;
pub(super) const STAGING_TTL: Duration = Duration::from_secs(30 * 60);
const ARCHIVE_NAME: &str = "workspace.age";

pub(super) struct DownloadSelection {
    pub(super) source_root: String,
    pub(super) paths: Vec<String>,
    pub(super) recipient: String,
    pub(super) include_credentials: bool,
    pub(super) work_saved: bool,
}

struct ReadyDownload {
    staging: TempDir,
    bytes: u64,
    _permit: OwnedSemaphorePermit,
}

struct Download {
    owner: ConnectionId,
    id: Uuid,
    ready: Option<ReadyDownload>,
}

pub(super) struct CloudArchiveDownloads {
    permit: Arc<Semaphore>,
    current: Mutex<Option<Download>>,
}

impl Default for CloudArchiveDownloads {
    fn default() -> Self {
        Self {
            permit: Arc::new(Semaphore::new(1)),
            current: Mutex::new(None),
        }
    }
}

struct Reservation<'a> {
    downloads: &'a CloudArchiveDownloads,
    owner: ConnectionId,
    id: Uuid,
    published: bool,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if !self.published {
            self.downloads.clear(self.owner, Some(self.id));
        }
    }
}

impl CloudArchiveDownloads {
    pub(super) async fn prepare(
        self: &Arc<Self>,
        owner: ConnectionId,
        selection: DownloadSelection,
    ) -> Result<Value, String> {
        let permit = Arc::clone(&self.permit)
            .try_acquire_owned()
            .map_err(|_| "A cloud archive download is already active")?;
        let id = Uuid::new_v4();
        *self
            .current
            .lock()
            .map_err(|_| "Archive download state unavailable")? = Some(Download {
            owner,
            id,
            ready: None,
        });
        let mut reservation = Reservation {
            downloads: self,
            owner,
            id,
            published: false,
        };
        let (ready, receipt) = tokio::task::spawn_blocking(move || {
            let staging = tempfile::Builder::new()
                .prefix("lime-archive-")
                .tempdir()
                .map_err(|_| "Cannot create private archive staging".to_owned())?;
            let output = staging.path().join(ARCHIVE_NAME);
            let receipt = export_for_download(
                Path::new(&selection.source_root),
                &selection.paths,
                &output,
                &selection.recipient,
                selection.include_credentials,
                selection.work_saved,
            )?;
            let bytes = receipt["bytes"]
                .as_u64()
                .filter(|bytes| (1..=MAX_CLOUD_CIPHERTEXT_BYTES).contains(bytes))
                .ok_or("Encrypted archive exceeds the cloud download limit")?;
            Ok::<_, String>((
                ReadyDownload {
                    staging,
                    bytes,
                    _permit: permit,
                },
                receipt,
            ))
        })
        .await
        .map_err(|_| "Cloud archive worker failed")??;
        let result = json!({ "archiveId": id.to_string(), "bytes": ready.bytes,
            "chunkBytes": CHUNK_BYTES, "sha256": receipt["sha256"],
            "files": receipt["files"], "skippedEntries": receipt["skippedEntries"] });
        {
            let mut state = self
                .current
                .lock()
                .map_err(|_| "Archive download state unavailable")?;
            let download = state
                .as_mut()
                .filter(|entry| entry.owner == owner && entry.id == id)
                .ok_or("Cloud archive connection was closed")?;
            download.ready = Some(ready);
            reservation.published = true;
        }
        let downloads = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(STAGING_TTL).await;
            if let Some(downloads) = downloads.upgrade() {
                downloads.clear(owner, Some(id));
            }
        });
        Ok(result)
    }

    pub(super) fn read(&self, owner: ConnectionId, id: Uuid, offset: u64) -> Result<Value, String> {
        let (mut file, bytes) = {
            let state = self
                .current
                .lock()
                .map_err(|_| "Archive download state unavailable")?;
            let ready = state
                .as_ref()
                .filter(|entry| entry.owner == owner && entry.id == id)
                .and_then(|entry| entry.ready.as_ref())
                .ok_or("Cloud archive download is unavailable")?;
            if offset >= ready.bytes || offset % CHUNK_BYTES != 0 {
                return Err("Invalid cloud archive offset".into());
            }
            let file = std::fs::File::open(ready.staging.path().join(ARCHIVE_NAME))
                .map_err(|_| "Cloud archive download is unavailable")?;
            (file, ready.bytes)
        };
        let mut chunk = vec![0; (bytes - offset).min(CHUNK_BYTES) as usize];
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.read_exact(&mut chunk))
            .map_err(|_| "Cannot read encrypted archive chunk")?;
        Ok(json!({ "archiveId": id.to_string(), "offset": offset, "data": STANDARD.encode(chunk) }))
    }

    pub(super) fn clear(&self, owner: ConnectionId, id: Option<Uuid>) -> bool {
        let Ok(mut state) = self.current.lock() else {
            return false;
        };
        if state
            .as_ref()
            .is_some_and(|entry| entry.owner == owner && id.is_none_or(|id| entry.id == id))
        {
            let download = state.take();
            drop(state);
            drop(download);
            true
        } else {
            false
        }
    }
}
