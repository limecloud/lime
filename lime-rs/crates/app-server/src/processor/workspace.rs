//! workspace domain handlers for the App Server processor.
use serde_json::Value;

use super::{dispatch_result, parse_params, to_jsonrpc_error, RequestProcessor, RpcDispatch};
use app_server_protocol::{
    JsonRpcError, SessionFileGetOrCreateParams, SessionFileIdParams, SessionFileSaveParams,
    SessionFileUpdateMetaParams, WorkspaceDeleteParams, WorkspaceEnsureParams,
    WorkspaceEnsureProjectParams, WorkspacePathReadParams, WorkspaceProjectPathResolveParams,
    WorkspaceReadParams, WorkspaceRegisteredSkillsListParams, WorkspaceSkillBindingsListParams,
    WorkspaceUpdateParams,
};

impl RequestProcessor {
    pub(super) async fn handle_session_file_get_or_create_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileGetOrCreateParams = parse_params(params)?;
        let response = self
            .runtime
            .get_or_create_session_file(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_session_file_update_meta_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileUpdateMetaParams = parse_params(params)?;
        let response = self
            .runtime
            .update_session_file_meta(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_session_file_save_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileSaveParams = parse_params(params)?;
        let response = self
            .runtime
            .save_session_file(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_session_file_read_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileIdParams = parse_params(params)?;
        let response = self
            .runtime
            .read_session_file(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_session_file_resolve_path_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileIdParams = parse_params(params)?;
        let response = self
            .runtime
            .resolve_session_file_path(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_session_file_delete_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileIdParams = parse_params(params)?;
        let response = self
            .runtime
            .delete_session_file(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_session_file_list_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: SessionFileGetOrCreateParams = parse_params(params)?;
        let response = self
            .runtime
            .list_session_files(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_list_impl(&self) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .list_workspaces()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_read_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceReadParams = parse_params(params)?;
        let response = self
            .runtime
            .read_workspace(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_update_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceUpdateParams = parse_params(params)?;
        let response = self
            .runtime
            .update_workspace(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.request_worktree_cleanup().await;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_delete_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceDeleteParams = parse_params(params)?;
        let response = self
            .runtime
            .delete_workspace(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.request_worktree_cleanup().await;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_by_path_read_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspacePathReadParams = parse_params(params)?;
        let response = self
            .runtime
            .read_workspace_by_path(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_ensure_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceEnsureProjectParams = parse_params(params)?;
        let response = self
            .runtime
            .ensure_project_workspace(params)
            .await
            .map_err(to_jsonrpc_error)?;
        self.request_worktree_cleanup().await;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_default_read_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .read_default_workspace()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_default_ensure_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .ensure_default_workspace()
            .await
            .map_err(to_jsonrpc_error)?;
        self.request_worktree_cleanup().await;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_projects_root_read_impl(
        &self,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let response = self
            .runtime
            .read_workspace_projects_root()
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_project_path_resolve_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceProjectPathResolveParams = parse_params(params)?;
        let response = self
            .runtime
            .resolve_workspace_project_path(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_ensure_ready_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceEnsureParams = parse_params(params)?;
        let response = self
            .runtime
            .ensure_workspace_ready(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_skill_bindings_list_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceSkillBindingsListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_workspace_skill_bindings(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    pub(super) async fn handle_workspace_registered_skills_list_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: WorkspaceRegisteredSkillsListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_workspace_registered_skills(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
}
