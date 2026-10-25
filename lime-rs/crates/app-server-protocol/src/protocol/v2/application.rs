//! Managed application network and storage requirements, separate from agent permissions.

use super::NetworkDomainPermission;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationRequirements {
    pub network: Option<ApplicationNetworkRequirements>,
    pub storage: Option<ApplicationStorageRequirements>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationNetworkRequirements {
    /// When enabled, only explicitly allowed exact domains may be contacted.
    pub enabled: bool,
    pub domains: BTreeMap<String, NetworkDomainPermission>,
}

/// Managed storage settings for new Desktop workspaces, not filesystem access restrictions.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationStorageRequirements {
    pub default_project_parent: Option<String>,
    pub projectless_workspace_root: Option<String>,
}
