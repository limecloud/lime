//! 本机容量测量与经过审阅的聊天清理；不接受调用方提供文件路径。
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageReadParams {}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum StorageStatus {
    #[default]
    Scanning,
    Ready,
    Error,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum StorageCategory {
    Threads,
    Subagents,
    Archived,
    Unclassified,
    Worktrees,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategoryUsage {
    pub category: StorageCategory,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub data_root: String,
    pub worktree_root: String,
    /// 实际测量的互不重叠根；portable AgentRoot 和外置 checkout 也明确列出。
    pub scanned_roots: Vec<String>,
    pub total_bytes: u64,
    pub categories: Vec<StorageCategoryUsage>,
    pub thread_bytes: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageState {
    pub status: StorageStatus,
    pub usage: Option<StorageUsage>,
    pub completed_categories: Vec<StorageCategory>,
    pub measured_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageReviewParams {
    #[serde(default = "default_days")]
    pub days: u32,
    #[serde(default = "default_archived_only")]
    pub archived_only: bool,
}
fn default_days() -> u32 {
    90
}
fn default_archived_only() -> bool {
    true
}
impl Default for StorageReviewParams {
    fn default() -> Self {
        Self {
            days: default_days(),
            archived_only: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageThreadSnapshot {
    pub thread_id: String,
    pub updated_at_ms: i64,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageCleanupCandidate {
    pub root: StorageThreadSnapshot,
    pub name: String,
    pub descendants: Vec<StorageThreadSnapshot>,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageReviewResponse {
    pub cutoff_ms: i64,
    pub archived_only: bool,
    pub candidates: Vec<StorageCleanupCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageDeleteParams {
    pub cutoff_ms: i64,
    pub archived_only: bool,
    pub candidates: Vec<StorageCleanupCandidate>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageDeleteResponse {
    pub deleted: u32,
    pub skipped: u32,
    pub failed: u32,
}
