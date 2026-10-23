use super::super::thread_delete::DeletedThread;
use super::{
    inventory::{local_source, reviewable_root},
    RuntimeCore, RuntimeCoreError,
};
use agent_protocol::{Thread, ThreadId};
use app_server_protocol::{
    StorageCategory, StorageCleanupCandidate, StorageDeleteParams, StorageDeleteResponse,
    StorageReviewParams, StorageReviewResponse, StorageThreadSnapshot,
};
use std::collections::BTreeSet;

const DAY_MS: i64 = 86_400_000;

impl RuntimeCore {
    pub async fn review_storage(
        &self,
        params: StorageReviewParams,
    ) -> Result<StorageReviewResponse, RuntimeCoreError> {
        if ![30, 90, 180, 365].contains(&params.days) {
            return Err(RuntimeCoreError::InvalidRequest(
                "storage review days must be 30, 90, 180 or 365".into(),
            ));
        }
        let cutoff_ms = chrono::Utc::now().timestamp_millis() - i64::from(params.days) * DAY_MS;
        Ok(StorageReviewResponse {
            cutoff_ms,
            archived_only: params.archived_only,
            candidates: self
                .storage_candidates(cutoff_ms, params.archived_only)
                .await?,
        })
    }

    pub(crate) async fn delete_storage(
        &self,
        params: StorageDeleteParams,
    ) -> Result<(StorageDeleteResponse, Vec<DeletedThread>), RuntimeCoreError> {
        let now = chrono::Utc::now().timestamp_millis();
        if params.cutoff_ms <= 0 || params.cutoff_ms > now - 30 * DAY_MS {
            return Err(RuntimeCoreError::InvalidRequest(
                "storage cleanup requires a cutoff at least 30 days old".into(),
            ));
        }
        let mut result = StorageDeleteResponse::default();
        let mut deleted = Vec::new();
        let mut seen = BTreeSet::new();
        for expected in &params.candidates {
            if !seen.insert(expected.root.thread_id.as_str()) {
                return Err(RuntimeCoreError::InvalidRequest(
                    "storage cleanup contains duplicate roots".into(),
                ));
            }
        }
        for expected in params.candidates {
            let fresh = match self
                .storage_candidates(params.cutoff_ms, params.archived_only)
                .await
            {
                Ok(fresh) => fresh,
                Err(_) => {
                    result.failed += 1;
                    continue;
                }
            };
            let current = fresh
                .into_iter()
                .find(|candidate| candidate.root.thread_id == expected.root.thread_id);
            let Some(current) = current.filter(|candidate| {
                candidate.root == expected.root && candidate.descendants == expected.descendants
            }) else {
                result.skipped += 1;
                continue;
            };
            let mut snapshots = current.descendants;
            snapshots.push(current.root.clone());
            match self
                .delete_thread(
                    ThreadId::new(current.root.thread_id),
                    Some((&snapshots, params.cutoff_ms)),
                )
                .await
            {
                Ok(threads) => {
                    result.deleted += 1;
                    deleted.extend(threads);
                }
                Err(RuntimeCoreError::InvalidRequest(_)) => result.skipped += 1,
                Err(_) => result.failed += 1,
            }
        }
        // 同一受控扫描替换旧容量；失败删除也可能已经释放了部分磁盘文件。
        self.read_storage(true).await?;
        Ok((result, deleted))
    }

    async fn storage_candidates(
        &self,
        cutoff_ms: i64,
        archived_only: bool,
    ) -> Result<Vec<StorageCleanupCandidate>, RuntimeCoreError> {
        let bytes = {
            let scan = self
                .storage_scan
                .lock()
                .expect("storage scan mutex poisoned");
            if ![
                StorageCategory::Threads,
                StorageCategory::Subagents,
                StorageCategory::Archived,
            ]
            .iter()
            .all(|category| scan.state.completed_categories.contains(category))
            {
                return Err(RuntimeCoreError::InvalidRequest(
                    "storage chat measurement is not complete".into(),
                ));
            }
            scan.state
                .usage
                .as_ref()
                .ok_or_else(|| RuntimeCoreError::Backend("storage usage is unavailable".into()))?
                .thread_bytes
                .clone()
        };
        let inventory = self.storage_inventory().await?;
        let store = self.canonical_projection_store()?;
        let mut result = Vec::new();
        for root in inventory
            .values()
            .filter(|thread| thread.parent_thread_id.is_none() && reviewable_root(thread))
        {
            let snapshot = store
                .snapshot_thread_delete_subtree(&root.thread_id)
                .map_err(RuntimeCoreError::Backend)?;
            if !snapshot.pending_only.is_empty() {
                continue;
            }
            let mut descendants = Vec::new();
            let mut total_bytes = 0_u64;
            let mut eligible = true;
            for entry in snapshot.persisted {
                let Some(thread) = inventory.get(entry.thread_id.as_str()) else {
                    eligible = false;
                    break;
                };
                if !self
                    .storage_thread_eligible(thread, cutoff_ms, archived_only)
                    .await?
                {
                    eligible = false;
                    break;
                }
                let Some(bytes) = bytes.get(entry.thread_id.as_str()) else {
                    eligible = false;
                    break;
                };
                total_bytes = total_bytes.saturating_add(*bytes);
                if entry.thread_id != root.thread_id {
                    descendants.push(thread_snapshot(thread));
                }
            }
            if !eligible {
                continue;
            }
            // parent投影与真实spawn边必须一致，缺失边不允许把子聊天漏在待删树之外。
            let ids = descendants
                .iter()
                .map(|thread| thread.thread_id.as_str())
                .chain(std::iter::once(root.thread_id.as_str()))
                .collect::<BTreeSet<_>>();
            if inventory.values().any(|thread| {
                thread
                    .parent_thread_id
                    .as_ref()
                    .is_some_and(|parent| ids.contains(parent.as_str()))
                    && !ids.contains(thread.thread_id.as_str())
            }) {
                continue;
            }
            descendants.sort_by(|left, right| left.thread_id.cmp(&right.thread_id));
            result.push(StorageCleanupCandidate {
                root: thread_snapshot(root),
                name: root
                    .name
                    .clone()
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| root.preview.clone()),
                descendants,
                bytes: total_bytes,
            });
        }
        result.sort_by(|left, right| {
            (left.root.updated_at_ms, &left.root.thread_id)
                .cmp(&(right.root.updated_at_ms, &right.root.thread_id))
        });
        Ok(result)
    }

    pub(in crate::runtime) async fn storage_thread_eligible(
        &self,
        thread: &Thread,
        cutoff_ms: i64,
        archived_only: bool,
    ) -> Result<bool, RuntimeCoreError> {
        if !local_source(thread)
            || thread.status.is_active()
            || thread.updated_at_ms <= 0
            || thread.created_at_ms <= 0
            || thread.created_at_ms > thread.updated_at_ms
            || thread.updated_at_ms >= cutoff_ms
            || (archived_only && !thread.archived)
            || thread
                .metadata
                .get("ephemeral")
                .and_then(serde_json::Value::as_bool)
                == Some(true)
            || self.loaded_thread_is_active(thread.thread_id.as_str()) == Some(true)
            || !self
                .turn_driver_completions
                .pending_turn_ids(thread.session_id.as_str())
                .is_empty()
        {
            return Ok(false);
        }
        if let Some(snapshot) = self
            .session_loops
            .snapshot(thread.session_id.as_str())
            .await
            .map_err(|e| RuntimeCoreError::Backend(e.to_string()))?
        {
            if snapshot.active_turn_id.is_some() {
                return Ok(false);
            }
        }
        let Some(path) = self
            .canonical_projection_store()?
            .rollout_path_for_thread_sync(&thread.thread_id)
            .map_err(RuntimeCoreError::Backend)?
        else {
            return Ok(false);
        };
        let mut compressed = path.clone().into_os_string();
        compressed.push(".zst");
        let mut found = false;
        for path in [path, compressed.into()] {
            match std::fs::symlink_metadata(path) {
                Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                    let modified = metadata
                        .modified()
                        .map_err(|e| RuntimeCoreError::Backend(e.to_string()))?
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|e| RuntimeCoreError::Backend(e.to_string()))?
                        .as_millis();
                    if modified >= cutoff_ms as u128 {
                        return Ok(false);
                    }
                    found = true;
                }
                Ok(_) => return Ok(false),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(RuntimeCoreError::Backend(error.to_string())),
            }
        }
        Ok(found)
    }
}

fn thread_snapshot(thread: &Thread) -> StorageThreadSnapshot {
    StorageThreadSnapshot {
        thread_id: thread.thread_id.to_string(),
        updated_at_ms: thread.updated_at_ms,
        archived: thread.archived,
    }
}
