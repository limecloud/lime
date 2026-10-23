//! Git 保存内容；canonical Thread 只持有与工作目录关联的恢复描述。

use super::{raw_string_field, RuntimeCore, RuntimeCoreError};
use agent_protocol::Thread;
use app_server_protocol::ProjectGitWorktreeThread;
use lime_services::project_git_service::{self as git, WorktreeSnapshot};
use std::path::Path;
use thread_store::{ThreadMetadataPatch, UpdateThreadMetadataParams};

const SNAPSHOT_KEY: &str = "worktreeSnapshot";

impl RuntimeCore {
    pub(super) async fn remember_worktree_snapshot(
        &self,
        threads: &[ProjectGitWorktreeThread],
        snapshot: Option<&WorktreeSnapshot>,
    ) -> Result<(), RuntimeCoreError> {
        let value = serde_json::to_value(snapshot)
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let store = self.canonical_thread_store()?;
        for thread in threads {
            store
                .update_thread_metadata(UpdateThreadMetadataParams {
                    thread_id: agent_protocol::ThreadId::new(&thread.thread_id),
                    patch: ThreadMetadataPatch {
                        metadata_values: [(SNAPSHOT_KEY.to_owned(), value.clone())].into(),
                        ..Default::default()
                    },
                    include_archived: true,
                })
                .await
                .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        }
        Ok(())
    }

    pub(crate) async fn restore_thread_worktree(
        &self,
        thread: &Thread,
    ) -> Result<(), RuntimeCoreError> {
        let Some(value) = thread.metadata.get(SNAPSHOT_KEY) else {
            return Ok(());
        };
        if value.is_null() {
            return Ok(());
        }
        let cwd = raw_string_field(&thread.metadata, &["workingDir", "working_dir", "cwd"])
            .ok_or_else(|| RuntimeCoreError::Backend("工作树聊天缺少工作目录".into()))?;
        let cwd = Path::new(&cwd);
        let snapshot =
            serde_json::from_value::<WorktreeSnapshot>(value.clone()).map_err(|error| {
                RuntimeCoreError::Backend(format!("无法读取工作树恢复信息: {error}"))
            })?;
        let _guard = self.worktree_operations.lock().await;
        git::restore_worktree(&snapshot, cwd)
            .await
            .map_err(RuntimeCoreError::Backend)
    }
}
