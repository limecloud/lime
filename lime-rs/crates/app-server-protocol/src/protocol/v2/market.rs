use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Immutable artifact identity, independent of the item's current publication.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketReleaseReference {
    pub id: String,
    pub manifest_sha256: String,
    pub archive_sha256: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MarketResourceKind {
    Skill,
    Mcp,
}

impl MarketResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Skill => "skill",
            Self::Mcp => "mcp",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketListParams {
    pub kind: MarketResourceKind,
    pub query: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketListResponse {
    pub resources: Vec<MarketResource>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketReadParams {
    pub item_id: String,
    pub kind: MarketResourceKind,
    pub release: Option<MarketReleaseReference>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketReadResponse {
    pub resource: MarketResource,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketInstallParams {
    pub item_id: String,
    pub kind: MarketResourceKind,
    pub release: MarketReleaseReference,
    pub install_attempt_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketInstallResponse {
    pub resource: MarketResource,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketInstalledParams {
    pub kind: Option<MarketResourceKind>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketInstalledResponse {
    pub resources: Vec<MarketResource>,
    pub errors: Vec<MarketResourceError>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketResourceError {
    pub item_id: String,
    pub kind: MarketResourceKind,
    pub error: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketEnabledSetParams {
    pub item_id: String,
    pub kind: MarketResourceKind,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketEnabledSetResponse {
    pub resource: MarketResource,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketUninstallParams {
    pub item_id: String,
    pub kind: MarketResourceKind,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
pub struct MarketUninstallResponse {}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketPendingParams {
    pub kind: Option<MarketResourceKind>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketPendingResponse {
    pub attempts: Vec<MarketPendingInstall>,
    pub errors: Vec<MarketResourceError>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketPendingInstall {
    pub install_attempt_id: String,
    pub resource: MarketResource,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketInstallCancelParams {
    pub item_id: String,
    pub kind: MarketResourceKind,
    pub install_attempt_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
pub struct MarketInstallCancelResponse {}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketReconcileParams {
    pub kind: Option<MarketResourceKind>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketReconcileResponse {
    pub resources: Vec<MarketAcquisitionCheck>,
    pub errors: Vec<MarketResourceError>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketAcquisitionCheck {
    pub item_id: String,
    pub kind: MarketResourceKind,
    pub release: MarketReleaseReference,
    pub acquisition_status: MarketAcquisitionStatus,
}

/// Only the acquisition is checked; publication and runtime approval are separate.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MarketAcquisitionStatus {
    Active,
    Revoked,
    Unavailable,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketResource {
    pub item_id: String,
    pub publisher_application_id: String,
    pub kind: MarketResourceKind,
    pub name: String,
    pub title: String,
    pub description: String,
    pub version: String,
    pub license: String,
    pub release: MarketReleaseReference,
    pub compatible: bool,
    pub actions: Vec<String>,
    pub mcp: Option<MarketMcp>,
    pub installation: Option<MarketInstallation>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketMcp {
    pub transport: String,
    pub endpoint: Option<String>,
    pub executable: Option<String>,
    pub arguments: Vec<String>,
    pub authentication: String,
    pub scopes: Vec<String>,
    pub tools: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketInstallation {
    pub release: MarketReleaseReference,
    pub version: String,
    pub enabled: bool,
    pub mcp_server_name: Option<String>,
}
