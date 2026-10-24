use super::AllowDenyRequirement;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrowserUseRequirements {
    pub extension: Option<BrowserUseExtensionRequirements>,
    pub allow_webmcp: Option<bool>,
    pub allow_history_access: Option<bool>,
    pub disable_auto_review: Option<bool>,
    pub allow_global_persistent_approval: Option<bool>,
    pub default_origin_policy: Option<BrowserUseOriginPolicy>,
    pub origins: Option<BTreeMap<String, BrowserUseOriginPolicy>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrowserUseExtensionRequirements {
    pub request_headers: Option<Vec<RequestHeader>>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestHeader {
    pub name: String,
    pub value: String,
}

impl std::fmt::Debug for RequestHeader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RequestHeader")
            .field("name", &self.name)
            .field("value", &"[REDACTED]")
            .finish()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrowserUseOriginPolicy {
    pub access: Option<AllowDenyRequirement>,
    pub downloads: Option<AllowDenyRequirement>,
    pub uploads: Option<AllowDenyRequirement>,
    pub full_cdp_access: Option<AllowDenyRequirement>,
    pub auto_review: Option<AllowDenyRequirement>,
    pub persistent_approval: Option<bool>,
    pub access_approval_lifetime: Option<BrowserUseAccessApprovalLifetime>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BrowserUseAccessApprovalLifetime {
    Turn,
    Thread,
}

