//! 自动清理只回收目录，聊天与恢复描述继续由 canonical store 持有。

use super::{git, raw_string_field, RuntimeCore, RuntimeCoreError};
use app_server_protocol::ProjectGitWorktreeDeleteParams;
use lime_core::config::{ConfigManager, WorktreeConfig};
use std::{
    future::Future,
    path::{Path, PathBuf},
};
mod planner;
pub(crate) use planner::BUFFER_MS;
use planner::{permits_removal, plan, Candidate};

impl RuntimeCore {
    pub(crate) async fn worktree_cleanup_plan_needed(&self) -> Result<bool, RuntimeCoreError> {
        let config = self.worktree_preferences()?;
        if !config.auto_cleanup_enabled {
            return Ok(false);
        }
        let options = self.project_worktree_options()?;
        Ok(git::list_worktrees(&options.root)
            .await
            .map_err(RuntimeCoreError::Backend)?
            .len()
            > config.keep_count as usize)
    }
    pub(crate) fn worktree_preferences(&self) -> Result<WorktreeConfig, RuntimeCoreError> {
        ConfigManager::load(&self.app_config_path)
            .map(|config| config.config().worktrees.clone())
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))
    }

    async fn cleanup_candidates<P, Protected>(
        &self,
        buffer: bool,
        is_attached: &P,
    ) -> Result<Vec<PathBuf>, RuntimeCoreError>
    where
        P: Fn(String) -> Protected,
        Protected: Future<Output = bool>,
    {
        let preferences = self.worktree_preferences()?;
        if !preferences.auto_cleanup_enabled {
            return Ok(Vec::new());
        }
        Ok(plan(
            self.cleanup_records(is_attached).await?,
            preferences.keep_count,
            chrono::Utc::now().timestamp_millis(),
            buffer,
        ))
    }

    async fn cleanup_records<P, Protected>(
        &self,
        is_attached: &P,
    ) -> Result<Vec<Candidate>, RuntimeCoreError>
    where
        P: Fn(String) -> Protected,
        Protected: Future<Output = bool>,
    {
        let options = self.project_worktree_options()?;
        let worktrees = git::list_worktrees(&options.root)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        // 任一 canonical/workspace 读取失败停止整轮，不把未知状态降成可删除。
        let threads = self.worktree_threads().await?;
        let workspaces = self.list_workspaces().await?;
        let mut roots = Vec::new();
        for workspace in workspaces.workspaces {
            if workspace
                .get("is_archived")
                .and_then(|value| value.as_bool())
                == Some(true)
            {
                continue;
            }
            if let Some(path) = raw_string_field(&workspace, &["root_path"]) {
                let path = PathBuf::from(path);
                roots.push(tokio::fs::canonicalize(&path).await.unwrap_or(path));
            }
        }
        let mut records = Vec::new();
        for worktree in worktrees {
            let associated = self
                .associated_worktree_threads(&threads, &worktree.worktree_path)
                .await;
            let mut protected = roots
                .iter()
                .any(|root| git::worktree_contains(&worktree.worktree_path, root));
            let mut updated_at_ms = 0;
            for owner in &associated {
                protected |=
                    owner.pinned || owner.active || is_attached(owner.thread_id.clone()).await;
                if let Some(thread) = threads
                    .iter()
                    .find(|thread| thread.thread_id.as_str() == owner.thread_id)
                {
                    updated_at_ms = updated_at_ms.max(thread.updated_at_ms);
                    if let Some(store) = &self.projection_store {
                        let rollout = store
                            .rollout_path_for_thread_sync(&thread.thread_id)
                            .map_err(RuntimeCoreError::Backend)?;
                        if let Some(path) = rollout {
                            match tokio::fs::metadata(path).await {
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                                Err(error) => {
                                    return Err(RuntimeCoreError::Backend(error.to_string()))
                                }
                                Ok(metadata) => {
                                    if let Ok(modified) = metadata.modified() {
                                        if let Ok(duration) =
                                            modified.duration_since(std::time::UNIX_EPOCH)
                                        {
                                            updated_at_ms = updated_at_ms.max(
                                                i64::try_from(duration.as_millis())
                                                    .unwrap_or(i64::MAX),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            records.push(Candidate {
                path: worktree.worktree_path,
                owned: !associated.is_empty(),
                created_at_ms: worktree.created_at_ms,
                updated_at_ms,
                protected,
            });
        }
        Ok(records)
    }

    pub(super) async fn ensure_automatic_worktree_removal<P, Protected>(
        &self,
        target: &Path,
        buffer: bool,
        is_attached: &P,
    ) -> Result<(), RuntimeCoreError>
    where
        P: Fn(String) -> Protected,
        Protected: Future<Output = bool>,
    {
        let preferences = self.worktree_preferences()?;
        let records = self.cleanup_records(is_attached).await?;
        // 保存恢复描述会更新rollout mtime；此处只复核保护与数量，不重新排序本次候选。
        if !preferences.auto_cleanup_enabled
            || !permits_removal(
                &records,
                target,
                preferences.keep_count,
                chrono::Utc::now().timestamp_millis(),
                buffer,
            )
        {
            return Err(RuntimeCoreError::InvalidRequest(
                "工作树清理条件已变化".into(),
            ));
        }
        Ok(())
    }

    pub(crate) async fn cleanup_worktrees<P, Protected>(
        &self,
        buffer_start_ms: i64,
        is_attached: P,
    ) -> Result<(), RuntimeCoreError>
    where
        P: Fn(String) -> Protected,
        Protected: Future<Output = bool>,
    {
        let buffer = buffer_start_ms <= 0
            || chrono::Utc::now().timestamp_millis() < buffer_start_ms.saturating_add(BUFFER_MS);
        let candidates = self.cleanup_candidates(buffer, &is_attached).await?;
        let mut failures = Vec::new();
        for target in candidates {
            if let Err(error) = self
                .delete_worktree(
                    ProjectGitWorktreeDeleteParams {
                        root_path: target.to_string_lossy().into_owned(),
                    },
                    true,
                    buffer,
                    |_| async {},
                    &is_attached,
                )
                .await
            {
                failures.push(error.to_string());
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(RuntimeCoreError::Backend(format!(
                "部分工作树清理失败: {}",
                failures.join("; ")
            )))
        }
    }
}
