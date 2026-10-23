use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitStatusParams {
    pub root_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitDiffParams {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_lines: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<ProjectGitDiffBase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProjectGitDiffBase {
    #[default]
    Unstaged,
    Staged,
    Commit,
    Branch,
    PreviousConversation,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitListParams {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBranchCheckoutParams {
    pub root_path: String,
    pub branch: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBranchCreateParams {
    pub root_path: String,
    pub branch: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorktreeCreateParams {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitWorktreeListParams {}

#[cfg(test)]
mod worktree_management_contract {
    use super::*;
    use serde_json::json;

    #[test]
    fn worktree_params_reject_force_discard_and_unknown_fields() {
        assert!(serde_json::from_value::<ProjectGitWorktreeListParams>(json!({})).is_ok());
        assert!(serde_json::from_value::<ProjectGitWorktreeListParams>(
            json!({"rootPath": "/other"})
        )
        .is_err());
        assert!(serde_json::from_value::<ProjectGitWorktreeDeleteParams>(
            json!({"rootPath": "/managed/one"})
        )
        .is_ok());
        assert!(serde_json::from_value::<ProjectGitWorktreeDeleteParams>(
            json!({"rootPath": "/managed/one", "discardChanges": true})
        )
        .is_err());
        assert!(serde_json::from_value::<ProjectGitWorktreeDeleteParams>(json!({})).is_err());
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorktreeThread {
    pub thread_id: String,
    pub name: String,
    pub archived: bool,
    pub pinned: bool,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitManagedWorktree {
    pub worktree_path: String,
    pub repository_root: String,
    pub head_sha: String,
    pub branch: Option<String>,
    pub threads: Vec<ProjectGitWorktreeThread>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorktreeListResponse {
    pub root_path: String,
    pub worktrees: Vec<ProjectGitManagedWorktree>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGitWorktreeDeleteParams {
    pub root_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitStatusResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub has_git_repository: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    #[serde(default)]
    pub branches: Vec<String>,
    #[serde(default)]
    pub uncommitted_file_count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitDiffResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub has_git_repository: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison_base_ref: Option<String>,
    pub patch: String,
    #[serde(default)]
    pub uncommitted_file_count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitListResponse {
    pub root_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub has_git_repository: bool,
    #[serde(default)]
    pub commits: Vec<ProjectGitCommit>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub committed_at: String,
}

pub type ProjectGitBranchCheckoutResponse = ProjectGitStatusResponse;
pub type ProjectGitBranchCreateResponse = ProjectGitStatusResponse;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorktreeCreateResponse {
    pub worktree_path: String,
    pub branch: String,
    pub status: ProjectGitStatusResponse,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorktreeDeleteResponse {
    pub worktree_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    pub archived_thread_ids: Vec<String>,
}
