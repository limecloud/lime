use super::service_projection::{
    project_git_commit_list_from_service, project_git_diff_from_service,
    project_git_status_from_service, project_git_worktree_from_service,
};
use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::{
    LocalEnvironmentResult, LocalEnvironmentsReadConfigParams,
};
use app_server_protocol::*;

mod worktrees;

impl RuntimeCore {
    pub async fn set_project_git_worktree_environment(
        &self,
        params: ProjectGitWorktreeEnvironmentSetParams,
    ) -> Result<ProjectGitStatusResponse, RuntimeCoreError> {
        let _guard = self.worktree_operations.lock().await;
        let status = lime_services::project_git_service::read_status(&params.root_path)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        if !status.is_worktree {
            return Err(RuntimeCoreError::InvalidRequest(
                "Environment selection requires a linked worktree".into(),
            ));
        }
        if let Some(path) = params.config_path.as_deref() {
            let config =
                super::local_environments::read_config(LocalEnvironmentsReadConfigParams {
                    config_path: path.into(),
                    host_id: None,
                })
                .map_err(|error| RuntimeCoreError::InvalidRequest(error.message))?;
            if !matches!(
                config.environment,
                Some(LocalEnvironmentResult::Success { .. })
            ) {
                return Err(RuntimeCoreError::InvalidRequest(
                    "Environment config is missing or invalid".into(),
                ));
            }
        }
        let root = status.repository_root.as_deref().ok_or_else(|| {
            RuntimeCoreError::InvalidRequest("Worktree root is unavailable".into())
        })?;
        lime_services::project_git_service::save_local_environment_config_path(
            std::path::Path::new(root),
            params.config_path.as_deref(),
        )
        .await
        .map_err(RuntimeCoreError::Backend)?;
        self.read_project_git_status(ProjectGitStatusParams {
            root_path: params.root_path,
        })
        .await
    }

    pub async fn read_project_git_status(
        &self,
        params: ProjectGitStatusParams,
    ) -> Result<ProjectGitStatusResponse, RuntimeCoreError> {
        let root_path = params.root_path;
        let status = lime_services::project_git_service::read_status(&root_path)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_status_from_service(status))
    }

    pub async fn read_project_git_diff(
        &self,
        params: ProjectGitDiffParams,
    ) -> Result<ProjectGitDiffResponse, RuntimeCoreError> {
        let root_path = params.root_path;
        let context_lines = params.context_lines;
        let base = params.base.map(project_git_diff_base_to_service);
        let commit_sha = params.commit_sha;
        let diff = lime_services::project_git_service::read_diff(
            &root_path,
            context_lines,
            base,
            commit_sha.as_deref(),
        )
        .await
        .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_diff_from_service(diff))
    }

    pub async fn list_project_git_commits(
        &self,
        params: ProjectGitCommitListParams,
    ) -> Result<ProjectGitCommitListResponse, RuntimeCoreError> {
        let root_path = params.root_path;
        let limit = params.limit;
        let list = lime_services::project_git_service::list_commits(&root_path, limit)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_commit_list_from_service(list))
    }

    pub async fn checkout_project_git_branch(
        &self,
        params: ProjectGitBranchCheckoutParams,
    ) -> Result<ProjectGitBranchCheckoutResponse, RuntimeCoreError> {
        let root_path = params.root_path;
        let branch = params.branch;
        let status = lime_services::project_git_service::checkout_branch(&root_path, &branch)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_status_from_service(status))
    }

    pub async fn create_project_git_branch(
        &self,
        params: ProjectGitBranchCreateParams,
    ) -> Result<ProjectGitBranchCreateResponse, RuntimeCoreError> {
        let root_path = params.root_path;
        let branch = params.branch;
        let status = lime_services::project_git_service::create_branch(&root_path, &branch)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_status_from_service(status))
    }

    pub async fn create_project_git_worktree(
        &self,
        params: ProjectGitWorktreeCreateParams,
        connection_id: app_server_transport::ConnectionId,
        is_cancelled: impl Fn() -> bool + Send + Sync,
    ) -> Result<ProjectGitWorktreeCreateResponse, RuntimeCoreError> {
        let root_path = params.root_path;
        let name = params.name;
        let base_branch = params.base_branch;
        let options = self.project_worktree_options()?;
        let _guard = self.worktree_operations.lock().await;
        if is_cancelled() {
            return Err(RuntimeCoreError::RequestCanceled);
        }
        let source_workspace = std::fs::canonicalize(&root_path)
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let source_status = lime_services::project_git_service::read_status(&root_path)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        let source_git_root = source_status
            .repository_root
            .ok_or_else(|| RuntimeCoreError::InvalidRequest("Not a git repository".into()))?;
        let source_git_root = std::fs::canonicalize(source_git_root)
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let worktree = lime_services::project_git_service::create_worktree(
            &root_path,
            name.as_deref(),
            base_branch.as_deref(),
            &options,
        )
        .await
        .map_err(RuntimeCoreError::Backend)?;
        let mut response = project_git_worktree_from_service(worktree);
        let (setup_result, setup_error) = super::local_environments::lifecycle::setup(
            self,
            &source_workspace,
            &source_git_root,
            std::path::Path::new(&response.worktree_path),
            params.local_environment_config_path.as_deref(),
            connection_id,
            &is_cancelled,
        )
        .await;
        response.setup_result = setup_result;
        response.setup_error = setup_error;
        Ok(response)
    }
}

fn project_git_diff_base_to_service(
    base: ProjectGitDiffBase,
) -> lime_services::project_git_service::ProjectGitDiffBase {
    match base {
        ProjectGitDiffBase::Unstaged => {
            lime_services::project_git_service::ProjectGitDiffBase::Unstaged
        }
        ProjectGitDiffBase::Staged => {
            lime_services::project_git_service::ProjectGitDiffBase::Staged
        }
        ProjectGitDiffBase::Commit => {
            lime_services::project_git_service::ProjectGitDiffBase::Commit
        }
        ProjectGitDiffBase::Branch => {
            lime_services::project_git_service::ProjectGitDiffBase::Branch
        }
        ProjectGitDiffBase::PreviousConversation => {
            lime_services::project_git_service::ProjectGitDiffBase::PreviousConversation
        }
    }
}
