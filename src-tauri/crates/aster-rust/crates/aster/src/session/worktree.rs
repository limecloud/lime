use super::extension_data::ExtensionState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSessionState {
    pub original_cwd: String,
    pub git_root: String,
    pub worktree_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_head_commit: Option<String>,
    pub slug: String,
}

impl ExtensionState for WorktreeSessionState {
    const EXTENSION_NAME: &'static str = "worktree_session";
    const VERSION: &'static str = "v0";
}
