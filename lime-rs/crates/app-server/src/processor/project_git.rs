//! project_git domain handlers for the App Server processor.

use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::{
    JsonRpcError, ProjectGitBranchCheckoutParams, ProjectGitBranchCreateParams,
    ProjectGitCommitListParams, ProjectGitDiffParams, ProjectGitStatusParams,
    ProjectGitWorktreeCreateParams, ProjectGitWorktreeDeleteParams, ProjectGitWorktreeListParams,
    METHOD_PROJECT_GIT_BRANCH_CHECKOUT, METHOD_PROJECT_GIT_BRANCH_CREATE,
    METHOD_PROJECT_GIT_COMMITS_LIST, METHOD_PROJECT_GIT_DIFF, METHOD_PROJECT_GIT_STATUS,
    METHOD_PROJECT_GIT_WORKTREE_CREATE, METHOD_PROJECT_GIT_WORKTREE_DELETE,
    METHOD_PROJECT_GIT_WORKTREE_LIST,
};
use futures::{future::BoxFuture, FutureExt};
use serde_json::Value;

impl RequestProcessor {
    pub(super) fn dispatch_project_git_request<'a>(
        &'a self,
        method: &str,
        params: &mut Option<Value>,
    ) -> Option<BoxFuture<'a, Result<RpcDispatch, JsonRpcError>>> {
        let request = match method {
            METHOD_PROJECT_GIT_STATUS => self.handle_project_git_status_impl(params.take()).boxed(),
            METHOD_PROJECT_GIT_DIFF => self.handle_project_git_diff_impl(params.take()).boxed(),
            METHOD_PROJECT_GIT_COMMITS_LIST => self
                .handle_project_git_commits_list_impl(params.take())
                .boxed(),
            METHOD_PROJECT_GIT_BRANCH_CHECKOUT => self
                .handle_project_git_branch_checkout_impl(params.take())
                .boxed(),
            METHOD_PROJECT_GIT_BRANCH_CREATE => self
                .handle_project_git_branch_create_impl(params.take())
                .boxed(),
            METHOD_PROJECT_GIT_WORKTREE_CREATE => self
                .handle_project_git_worktree_create_impl(params.take())
                .boxed(),
            METHOD_PROJECT_GIT_WORKTREE_LIST => self
                .handle_project_git_worktree_list_impl(params.take())
                .boxed(),
            METHOD_PROJECT_GIT_WORKTREE_DELETE => self
                .handle_project_git_worktree_delete_impl(params.take())
                .boxed(),
            _ => return None,
        };
        Some(request)
    }

    pub(super) async fn handle_project_git_status_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitStatusParams = parse_params(params)?;
        let response = self
            .runtime
            .read_project_git_status(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_project_git_diff_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitDiffParams = parse_params(params)?;
        let response = self
            .runtime
            .read_project_git_diff(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_project_git_commits_list_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitCommitListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_project_git_commits(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_project_git_branch_checkout_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitBranchCheckoutParams = parse_params(params)?;
        let response = self
            .runtime
            .checkout_project_git_branch(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_project_git_branch_create_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitBranchCreateParams = parse_params(params)?;
        let response = self
            .runtime
            .create_project_git_branch(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_project_git_worktree_create_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitWorktreeCreateParams = parse_params(params)?;
        let response = self
            .runtime
            .create_project_git_worktree(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.request_worktree_cleanup().await;
        dispatch_result(response)
    }

    pub(super) async fn handle_project_git_worktree_list_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitWorktreeListParams = parse_params(params)?;
        dispatch_result(
            self.runtime
                .list_project_git_worktrees(params)
                .await
                .map_err(to_jsonrpc_error)?,
        )
    }

    pub(super) async fn handle_project_git_worktree_delete_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ProjectGitWorktreeDeleteParams = parse_params(params)?;
        let result = self
            .runtime
            .delete_project_git_worktree(params, |thread_id| async move {
                let notification = self.finish_thread_archive(thread_id).await;
                // 归档已经持久化；即使后续Git删除失败，客户端也必须收到真实状态。
                self.publish_server_notification(notification).await;
            })
            .await;
        self.request_worktree_cleanup().await;
        dispatch_result(result.map_err(to_jsonrpc_error)?)
    }
}
