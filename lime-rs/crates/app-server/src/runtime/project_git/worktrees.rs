//! 托管工作树投影与删除编排；聊天事实只读取 canonical thread store。

use super::super::{value_fields::raw_string_field, RuntimeCore, RuntimeCoreError};
use agent_protocol::{SortDirection, Thread};
use app_server_protocol::{
    ProjectGitManagedWorktree, ProjectGitWorktreeDeleteParams, ProjectGitWorktreeDeleteResponse,
    ProjectGitWorktreeListParams, ProjectGitWorktreeListResponse, ProjectGitWorktreeThread,
};
use lime_services::project_git_service::{self as git, WorktreeOptions};
use std::{future::Future, path::Path};
use thread_store::{ListThreadsParams, PageRequest, PINNED_THREAD_SECTION_ID};

mod cleanup;
mod recovery;

impl RuntimeCore {
    pub(super) fn project_worktree_options(&self) -> Result<WorktreeOptions, RuntimeCoreError> {
        let config = lime_core::config::ConfigManager::load(&self.app_config_path)
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let preferences = &config.config().worktrees;
        Ok(WorktreeOptions {
            root: preferences.resolved_root(
                self.app_config_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            ),
            refresh_upstream: preferences.upstream_refresh_mode
                == lime_core::config::UpstreamRefreshMode::BestEffort,
        })
    }

    pub async fn list_project_git_worktrees(
        &self,
        _params: ProjectGitWorktreeListParams,
    ) -> Result<ProjectGitWorktreeListResponse, RuntimeCoreError> {
        let options = self.project_worktree_options()?;
        let worktrees = git::list_worktrees(&options.root)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        let threads = self.worktree_threads().await?;
        let mut result = Vec::new();
        for worktree in worktrees {
            let associated = self
                .associated_worktree_threads(&threads, &worktree.worktree_path)
                .await;
            result.push(ProjectGitManagedWorktree {
                worktree_path: worktree.worktree_path.to_string_lossy().into_owned(),
                repository_root: worktree.repository_root.to_string_lossy().into_owned(),
                head_sha: worktree.head_sha,
                branch: worktree.branch,
                threads: associated,
            });
        }
        Ok(ProjectGitWorktreeListResponse {
            root_path: options.root.to_string_lossy().into_owned(),
            worktrees: result,
        })
    }

    pub async fn delete_project_git_worktree<F, Fut>(
        &self,
        params: ProjectGitWorktreeDeleteParams,
        on_archived: F,
    ) -> Result<ProjectGitWorktreeDeleteResponse, RuntimeCoreError>
    where
        F: FnMut(String) -> Fut,
        Fut: Future<Output = ()>,
    {
        self.delete_worktree(params, false, false, on_archived, |_| async { false })
            .await
    }

    async fn delete_worktree<F, Fut, P, Protected>(
        &self,
        params: ProjectGitWorktreeDeleteParams,
        automatic: bool,
        buffer: bool,
        mut on_archived: F,
        is_attached: P,
    ) -> Result<ProjectGitWorktreeDeleteResponse, RuntimeCoreError>
    where
        F: FnMut(String) -> Fut,
        Fut: Future<Output = ()>,
        P: Fn(String) -> Protected,
        Protected: Future<Output = bool>,
    {
        let _guard = self.worktree_operations.lock().await;
        let options = self.project_worktree_options()?;
        let target = Path::new(&params.root_path);
        // 快照前确认仍是当前托管目录下的真实 linked checkout。
        git::validate_worktree_removal(&options.root, target)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        let threads = self.worktree_threads().await?;
        let associated = self.associated_worktree_threads(&threads, target).await;
        ensure_removable_threads(&associated)?;
        if automatic {
            self.ensure_automatic_worktree_removal(target, buffer, &is_attached)
                .await?;
        }
        let snapshot = match git::snapshot_worktree(&options.root, target).await {
            Ok(snapshot) => Some(snapshot),
            Err(error) if !automatic => {
                tracing::warn!(%error, "Requested worktree deletion has no recovery snapshot");
                None
            }
            Err(error) => return Err(RuntimeCoreError::Backend(error)),
        };
        self.remember_worktree_snapshot(&associated, snapshot.as_ref())
            .await?;
        let mut archived_thread_ids = Vec::new();
        for thread in associated
            .iter()
            .filter(|thread| !automatic && !thread.archived)
        {
            if self
                .archive_thread(agent_protocol::ThreadId::new(&thread.thread_id))
                .await?
            {
                archived_thread_ids.push(thread.thread_id.clone());
                on_archived(thread.thread_id.clone()).await;
            }
        }
        // 归档可能让出执行权；实际删除前再次读取固定/运行状态。
        let fresh = self.worktree_threads().await?;
        let fresh = self.associated_worktree_threads(&fresh, target).await;
        ensure_removable_threads(&fresh)?;
        if fresh.iter().any(|thread| {
            !associated
                .iter()
                .any(|previous| previous.thread_id == thread.thread_id)
        }) || (!automatic && fresh.iter().any(|thread| !thread.archived))
        {
            return Err(RuntimeCoreError::InvalidRequest(
                "工作树关联聊天已变化，请刷新后重试".into(),
            ));
        }
        if automatic {
            self.ensure_automatic_worktree_removal(target, buffer, &is_attached)
                .await?;
        }
        let removed = git::remove_worktree(&options.root, target)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(ProjectGitWorktreeDeleteResponse {
            worktree_path: removed.worktree_path.to_string_lossy().into_owned(),
            repository_root: Some(removed.repository_root.to_string_lossy().into_owned()),
            archived_thread_ids,
        })
    }

    async fn worktree_threads(&self) -> Result<Vec<Thread>, RuntimeCoreError> {
        let store = self.canonical_thread_store()?;
        let mut cursor = None;
        let mut result = Vec::new();
        loop {
            let page = store
                .list_threads(ListThreadsParams {
                    include_archived: true,
                    page: PageRequest {
                        cursor: cursor.clone(),
                        limit: 100,
                        sort_direction: SortDirection::Desc,
                    },
                    section: None,
                    project: None,
                    sort_by_section_position: false,
                })
                .await
                .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
            result.extend(page.data);
            let Some(next) = page.next_cursor else {
                break;
            };
            if cursor.as_ref() == Some(&next) {
                return Err(RuntimeCoreError::Backend("工作树关联聊天分页未前进".into()));
            }
            cursor = Some(next);
        }
        Ok(result)
    }

    async fn associated_worktree_threads(
        &self,
        threads: &[Thread],
        root: &Path,
    ) -> Vec<ProjectGitWorktreeThread> {
        let mut result = Vec::new();
        for thread in threads {
            let Some(cwd) =
                raw_string_field(&thread.metadata, &["workingDir", "working_dir", "cwd"])
            else {
                continue;
            };
            let path = Path::new(&cwd);
            let matches = git::worktree_contains(root, path)
                || tokio::fs::canonicalize(path)
                    .await
                    .is_ok_and(|path| git::worktree_contains(root, &path));
            if !matches {
                continue;
            }
            result.push(ProjectGitWorktreeThread {
                thread_id: thread.thread_id.to_string(),
                name: thread.name.clone().unwrap_or_default(),
                archived: thread.archived,
                pinned: thread
                    .metadata
                    .get("section")
                    .and_then(|section| section.get("id"))
                    .and_then(|id| id.as_str())
                    == Some(PINNED_THREAD_SECTION_ID),
                active: thread.status.is_active()
                    || self.loaded_thread_is_active(thread.thread_id.as_str()) == Some(true),
            });
        }
        result
    }
}

fn ensure_removable_threads(threads: &[ProjectGitWorktreeThread]) -> Result<(), RuntimeCoreError> {
    if threads.iter().any(|thread| thread.pinned) {
        return Err(RuntimeCoreError::InvalidRequest(
            "工作树关联了固定聊天，请先取消固定".into(),
        ));
    }
    if threads.iter().any(|thread| thread.active) {
        return Err(RuntimeCoreError::InvalidRequest(
            "工作树关联聊天正在运行，请先停止回合".into(),
        ));
    }
    Ok(())
}
