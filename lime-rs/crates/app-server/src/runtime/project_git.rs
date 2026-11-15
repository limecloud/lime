use super::service_projection::{
    project_git_blame_from_service, project_git_commit_list_from_service,
    project_git_commit_result_from_service, project_git_diff_from_service,
    project_git_pull_request_create_from_service, project_git_pull_request_merge_from_service,
    project_git_pull_request_open_from_service, project_git_pull_request_status_from_service,
    project_git_status_from_service, project_git_worktree_from_service,
};
use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::{
    LocalEnvironmentResult, LocalEnvironmentsReadConfigParams, ProjectGitBlameParams,
    ProjectGitBlameResponse, ProjectGitBranchCreateParams, ProjectGitBranchCreateResponse,
    ProjectGitCommitParams, ProjectGitCommitResponse, ProjectGitPullRequestCreateParams,
    ProjectGitPullRequestCreateResponse, ProjectGitPullRequestMergeMethod,
    ProjectGitPullRequestMergeParams, ProjectGitPullRequestMergeResponse,
    ProjectGitPullRequestOpenParams, ProjectGitPullRequestOpenResponse,
    ProjectGitPullRequestStatusParams, ProjectGitPullRequestStatusResponse,
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

    pub async fn read_project_git_blame(
        &self,
        params: ProjectGitBlameParams,
    ) -> Result<ProjectGitBlameResponse, RuntimeCoreError> {
        let path = lime_services::project_git_service::validate_blame_path(&params.path)
            .map_err(RuntimeCoreError::InvalidRequest)?;
        let blame = lime_services::project_git_service::read_blame(&params.root_path, &path)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_blame_from_service(blame))
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

    pub async fn commit_project_git_changes(
        &self,
        params: ProjectGitCommitParams,
    ) -> Result<ProjectGitCommitResponse, RuntimeCoreError> {
        let message = params.message.trim();
        if message.is_empty() {
            return Err(RuntimeCoreError::InvalidRequest("提交信息不能为空".into()));
        }
        if message.chars().count() > lime_services::project_git_service::MAX_COMMIT_MESSAGE_CHARS {
            return Err(RuntimeCoreError::InvalidRequest(format!(
                "提交信息过长（最多 {} 个字符）",
                lime_services::project_git_service::MAX_COMMIT_MESSAGE_CHARS
            )));
        }
        if params.paths.as_ref().is_some_and(Vec::is_empty) {
            return Err(RuntimeCoreError::InvalidRequest("提交路径不能为空".into()));
        }
        let result = lime_services::project_git_service::commit(
            &params.root_path,
            &params.message,
            params.paths,
        )
        .await
        .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_commit_result_from_service(result))
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
        let branch = lime_services::project_git_service::validate_branch_name(&params.branch)
            .map_err(|error| RuntimeCoreError::InvalidRequest(error.to_string()))?
            .to_string();
        let status = lime_services::project_git_service::create_branch(&root_path, &branch)
            .await
            .map_err(RuntimeCoreError::Backend)?;
        Ok(project_git_status_from_service(status))
    }

    pub async fn create_project_git_pull_request(
        &self,
        params: ProjectGitPullRequestCreateParams,
    ) -> Result<ProjectGitPullRequestCreateResponse, RuntimeCoreError> {
        let runner = lime_services::pull_request_service::LocalGhCommandRunner::default();
        let result = lime_services::pull_request_service::create_pull_request(
            &runner,
            &params.root_path,
            &params.title,
            &params.body,
            params.draft,
            params.base.as_deref(),
        )
        .await
        .map_err(pull_request_error_to_runtime)?;
        Ok(project_git_pull_request_create_from_service(result))
    }

    pub async fn open_project_git_pull_request(
        &self,
        params: ProjectGitPullRequestOpenParams,
    ) -> Result<ProjectGitPullRequestOpenResponse, RuntimeCoreError> {
        let runner = lime_services::pull_request_service::LocalGhCommandRunner::default();
        let result =
            lime_services::pull_request_service::open_pull_request(&runner, &params.root_path)
                .await
                .map_err(pull_request_error_to_runtime)?;
        Ok(project_git_pull_request_open_from_service(result))
    }

    pub async fn read_project_git_pull_request(
        &self,
        params: ProjectGitPullRequestStatusParams,
    ) -> Result<ProjectGitPullRequestStatusResponse, RuntimeCoreError> {
        let runner = lime_services::pull_request_service::LocalGhCommandRunner::default();
        let result =
            lime_services::pull_request_service::read_pull_request(&runner, &params.root_path)
                .await
                .map_err(pull_request_error_to_runtime)?;
        Ok(project_git_pull_request_status_from_service(
            params.root_path,
            result,
        ))
    }

    pub async fn merge_project_git_pull_request(
        &self,
        params: ProjectGitPullRequestMergeParams,
    ) -> Result<ProjectGitPullRequestMergeResponse, RuntimeCoreError> {
        let runner = lime_services::pull_request_service::LocalGhCommandRunner::default();
        let result = lime_services::pull_request_service::merge_pull_request(
            &runner,
            &params.root_path,
            merge_method_to_service(params.method),
            params.delete_branch,
            params.pr_number,
        )
        .await
        .map_err(pull_request_error_to_runtime)?;
        Ok(project_git_pull_request_merge_from_service(result))
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

fn pull_request_error_to_runtime(
    error: lime_services::pull_request_service::PullRequestError,
) -> RuntimeCoreError {
    match error {
        lime_services::pull_request_service::PullRequestError::InvalidInput(message) => {
            RuntimeCoreError::InvalidRequest(message)
        }
        other => RuntimeCoreError::Backend(other.to_string()),
    }
}

fn merge_method_to_service(
    method: ProjectGitPullRequestMergeMethod,
) -> lime_services::pull_request_service::MergeMethod {
    match method {
        ProjectGitPullRequestMergeMethod::Merge => {
            lime_services::pull_request_service::MergeMethod::Merge
        }
        ProjectGitPullRequestMergeMethod::Squash => {
            lime_services::pull_request_service::MergeMethod::Squash
        }
        ProjectGitPullRequestMergeMethod::Rebase => {
            lime_services::pull_request_service::MergeMethod::Rebase
        }
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
