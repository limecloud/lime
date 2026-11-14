//! Managed worktree inventory for the TUI `/worktree` picker.

use anyhow::{Context, Result};
use app_server_protocol::protocol::v0::{
    ProjectGitWorktreeCreateParams, ProjectGitWorktreeCreateResponse,
    ProjectGitWorktreeDeleteParams, ProjectGitWorktreeDeleteResponse, ProjectGitWorktreeListParams,
    ProjectGitWorktreeListResponse, METHOD_PROJECT_GIT_WORKTREE_CREATE,
    METHOD_PROJECT_GIT_WORKTREE_DELETE, METHOD_PROJECT_GIT_WORKTREE_LIST,
};

use super::AppServerSession;

impl AppServerSession {
    pub(crate) async fn worktree_list(&self) -> Result<ProjectGitWorktreeListResponse> {
        self.request_handle
            .request(
                METHOD_PROJECT_GIT_WORKTREE_LIST,
                ProjectGitWorktreeListParams {},
            )
            .await
            .context("failed to list managed worktrees")
    }

    pub(crate) async fn worktree_create(
        &self,
        root_path: String,
        name: String,
    ) -> Result<ProjectGitWorktreeCreateResponse> {
        self.request_handle
            .request(
                METHOD_PROJECT_GIT_WORKTREE_CREATE,
                ProjectGitWorktreeCreateParams {
                    root_path,
                    name: Some(name),
                    ..ProjectGitWorktreeCreateParams::default()
                },
            )
            .await
            .context("failed to create a managed worktree")
    }

    pub(crate) async fn worktree_delete(
        &self,
        worktree_path: String,
    ) -> Result<ProjectGitWorktreeDeleteResponse> {
        self.request_handle
            .request(
                METHOD_PROJECT_GIT_WORKTREE_DELETE,
                ProjectGitWorktreeDeleteParams {
                    root_path: worktree_path,
                },
            )
            .await
            .context("failed to delete a managed worktree")
    }
}
