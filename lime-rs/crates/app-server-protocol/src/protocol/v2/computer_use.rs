//! Shared Computer Use contract for Desktop, CLI/TUI, Chrome and Office.
//!
//! The protocol deliberately separates adapter readiness from capability
//! declarations. A client can render setup guidance without treating a
//! disconnected helper, extension or Office task pane as ready.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum ComputerUseAdapterKind {
    Native,
    Chrome,
    Office,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComputerUseReadiness {
    Disabled,
    Unavailable,
    NotInstalled,
    PermissionRequired,
    Connecting,
    Ready,
    Busy,
    Disconnected,
    Blocked,
    UpdateRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ComputerUseTargetIdentity {
    Native {
        app_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        process_id: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    Chrome {
        origin: String,
        profile_id: String,
        tab_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    Office {
        host: String,
        workbook_id: String,
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workbook_name: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComputerUseCapability {
    Observe,
    Screenshot,
    Click,
    Type,
    Key,
    Scroll,
    Drag,
    DomRead,
    Navigate,
    Upload,
    Download,
    RawCdp,
    WorkbookRead,
    WorkbookWrite,
    SheetRead,
    SheetWrite,
    RangeRead,
    RangeWrite,
    FormulaRead,
    FormulaWrite,
    TableRead,
    TableWrite,
    ChartRead,
    ChartWrite,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ComputerUseGrantScope {
    #[default]
    Session,
    Persistent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseGrant {
    pub id: String,
    pub adapter: ComputerUseAdapterKind,
    pub scope: ComputerUseGrantScope,
    pub target: ComputerUseTargetIdentity,
    pub capabilities: Vec<ComputerUseCapability>,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseAdapterStatus {
    pub adapter: ComputerUseAdapterKind,
    pub readiness: ComputerUseReadiness,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<ComputerUseCapability>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<ComputerUseTargetIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub setup_steps: Vec<String>,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseStatusParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter: Option<ComputerUseAdapterKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ComputerUseTargetIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseStatusResponse {
    pub epoch: u64,
    pub adapters: Vec<ComputerUseAdapterStatus>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grants: Vec<ComputerUseGrant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseSetupParams {
    pub adapter: ComputerUseAdapterKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ComputerUseTargetIdentity>,
    #[serde(default)]
    pub grant_scope: ComputerUseGrantScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseSetupResponse {
    pub accepted: bool,
    pub status: ComputerUseAdapterStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant: Option<ComputerUseGrant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseRevokeParams {
    pub grant_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseRevokeResponse {
    pub revoked: bool,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseLeaseAcquireParams {
    pub thread_id: String,
    pub turn_id: String,
    pub adapter: ComputerUseAdapterKind,
    pub target: ComputerUseTargetIdentity,
    pub capability: ComputerUseCapability,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseLeaseAcquireResponse {
    pub lease_id: String,
    pub adapter: ComputerUseAdapterKind,
    pub target: ComputerUseTargetIdentity,
    pub capability: ComputerUseCapability,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseLeaseReleaseParams {
    pub lease_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseLeaseReleaseResponse {
    pub released: bool,
    pub epoch: u64,
}

/// String metadata is intentionally opaque to the shared contract. Adapters
/// may expose evidence identifiers without adding product-specific fields.
pub type ComputerUseEvidence = BTreeMap<String, String>;

#[cfg(test)]
#[path = "computer_use_tests.rs"]
mod tests;
