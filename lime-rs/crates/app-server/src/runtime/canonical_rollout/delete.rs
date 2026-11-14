use std::fs;
use std::path::Path;

use super::RolloutStore;

impl RolloutStore {
    pub(in crate::runtime) fn delete(
        &self,
        relative_path: &Path,
        session_id: &str,
        thread_id: &str,
        archived: bool,
    ) -> Result<bool, String> {
        let _writer = self.acquire_writer(thread_id)?;
        let path = if archived {
            self.resolve_archived(relative_path)?
        } else {
            self.resolve_active(relative_path)?
        };
        if super::compression::existing_rollout_path(&path)?.is_none() {
            return Ok(false);
        }
        let active = if archived {
            super::active_path_from_archived(relative_path)?
        } else {
            relative_path.to_path_buf()
        };
        let scan = super::scan_rollout_repaired(&path)?;
        super::validate_scan_identity(&scan, &active, session_id, thread_id, &path)?;
        // Remove the hidden representation first so a failed deletion cannot revive it.
        super::compression::remove_compressed_rollout(&path)?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to delete rollout {}: {error}",
                    path.display()
                ))
            }
        }
        Ok(true)
    }
}
