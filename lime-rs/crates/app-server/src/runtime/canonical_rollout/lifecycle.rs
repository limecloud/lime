use super::*;
use std::time::SystemTime;

/// A physical move is committed only after its index transaction succeeds.
pub(in crate::runtime) struct RolloutMove {
    _writer: writer_lock::WriterGuard,
    source: Option<PathBuf>,
    destination: PathBuf,
    relative_path: PathBuf,
    storage_path: String,
    original_modified: SystemTime,
    updated_at_ms: i64,
    touched: bool,
    finished: bool,
}

impl RolloutMove {
    pub(in crate::runtime) fn storage_path(&self) -> String {
        self.storage_path.clone()
    }

    pub(in crate::runtime) fn updated_at_ms(&self) -> i64 {
        self.updated_at_ms
    }

    pub(in crate::runtime) fn commit(mut self) -> PathBuf {
        self.finished = true;
        self.relative_path.clone()
    }

    pub(in crate::runtime) fn rollback(mut self) -> Result<(), String> {
        self.restore()
    }

    pub(super) fn touch(mut self) -> Result<Self, String> {
        let result = (|| {
            let file = OpenOptions::new()
                .append(true)
                .open(&self.destination)
                .map_err(|error| error.to_string())?;
            file.set_times(std::fs::FileTimes::new().set_modified(SystemTime::now()))
                .map_err(|error| error.to_string())?;
            self.touched = true;
            file.sync_all().map_err(|error| error.to_string())?;
            self.updated_at_ms = modified_ms(
                file.metadata()
                    .and_then(|metadata| metadata.modified())
                    .map_err(|error| error.to_string())?,
            );
            Ok::<_, String>(())
        })();
        if let Err(cause) = result {
            let cause = format!(
                "failed to touch rollout {}: {cause}",
                self.destination.display()
            );
            return match self.restore() {
                Ok(()) => Err(cause),
                Err(restore) => Err(format!("{cause}; failed to restore rollout: {restore}")),
            };
        }
        Ok(self)
    }

    fn restore(&mut self) -> Result<(), String> {
        if self.touched {
            let file = OpenOptions::new()
                .append(true)
                .open(&self.destination)
                .map_err(|error| error.to_string())?;
            file.set_times(std::fs::FileTimes::new().set_modified(self.original_modified))
                .and_then(|()| file.sync_all())
                .map_err(|error| error.to_string())?;
            self.touched = false;
        }
        if let Some(source) = &self.source {
            fs::rename(&self.destination, source).map_err(|error| {
                format!("failed to restore rollout {}: {error}", source.display())
            })?;
        }
        self.finished = true;
        Ok(())
    }
}

impl Drop for RolloutMove {
    fn drop(&mut self) {
        if !self.finished {
            if let Err(error) = self.restore() {
                tracing::error!(%error, path = %self.destination.display(), "rollout rollback failed");
            }
        }
    }
}

impl RolloutStore {
    pub(super) fn move_rollout(
        &self,
        source: &Path,
        destination: &Path,
        active_path: &Path,
        session_id: &str,
        thread_id: &str,
    ) -> Result<RolloutMove, String> {
        let writer = self.acquire_writer(thread_id)?;
        let relative_path = destination
            .strip_prefix(&self.agent_root)
            .map_err(|error| error.to_string())?
            .to_path_buf();
        let storage_path = location_storage_path(&relative_path)?;
        let physical_source = compression::existing_rollout_path(source)?;
        let physical_destination = compression::existing_rollout_path(destination)?;
        let (source, destination) = match (physical_source, physical_destination) {
            (Some(physical_source), None) => {
                let scan = scan_rollout_repaired(source)?;
                validate_scan_identity(&scan, active_path, session_id, thread_id, source)?;
                // A stale compressed sibling must not resurrect the source on rebuild.
                let physical_destination = if physical_source == source {
                    compression::remove_compressed_rollout(source)?;
                    destination.to_path_buf()
                } else {
                    compression::compressed_rollout_path(destination)
                };
                let parent = destination.parent().ok_or_else(|| {
                    format!("rollout path has no parent: {}", destination.display())
                })?;
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                (Some(physical_source), physical_destination)
            }
            (None, Some(physical_destination)) => {
                let scan = scan_rollout_repaired(destination)?;
                validate_scan_identity(&scan, active_path, session_id, thread_id, destination)?;
                (None, physical_destination)
            }
            (Some(_), Some(_)) => {
                return Err(format!(
                    "rollout move refused because source and destination both exist: {} -> {}",
                    source.display(),
                    destination.display()
                ));
            }
            (None, None) => {
                return Err(format!(
                    "rollout move source and destination are both missing: {} -> {}",
                    source.display(),
                    destination.display()
                ));
            }
        };
        let original_modified = fs::metadata(source.as_deref().unwrap_or(&destination))
            .and_then(|metadata| metadata.modified())
            .map_err(|error| error.to_string())?;
        if let Some(source) = &source {
            fs::rename(source, &destination).map_err(|error| {
                format!(
                    "failed to move rollout {} to {}: {error}",
                    source.display(),
                    destination.display()
                )
            })?;
        }
        Ok(RolloutMove {
            _writer: writer,
            source,
            destination,
            relative_path,
            storage_path,
            original_modified,
            updated_at_ms: modified_ms(original_modified),
            touched: false,
            finished: false,
        })
    }
}

pub(super) fn file_updated_at_ms(path: &Path) -> Result<i64, String> {
    let physical = compression::existing_rollout_path(path)?
        .ok_or_else(|| format!("rollout file is missing: {}", path.display()))?;
    fs::metadata(&physical)
        .and_then(|metadata| metadata.modified())
        .map(modified_ms)
        .map_err(|error| {
            format!(
                "failed to read rollout mtime {}: {error}",
                physical.display()
            )
        })
}

fn modified_ms(time: SystemTime) -> i64 {
    DateTime::<Utc>::from(time).timestamp_millis()
}
