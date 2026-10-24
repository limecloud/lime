use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AllowDenyRequirementToml {
    Allow,
    Deny,
}

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserUseOriginPolicyToml {
    pub access: Option<AllowDenyRequirementToml>,
    pub downloads: Option<AllowDenyRequirementToml>,
    pub uploads: Option<AllowDenyRequirementToml>,
    pub full_cdp_access: Option<AllowDenyRequirementToml>,
    pub auto_review: Option<AllowDenyRequirementToml>,
    pub persistent_approval: Option<bool>,
    pub access_approval_lifetime: Option<BrowserUseAccessApprovalLifetimeToml>,
}

impl BrowserUseOriginPolicyToml {
    fn is_empty(&self) -> bool {
        self.access.is_none()
            && self.downloads.is_none()
            && self.uploads.is_none()
            && self.full_cdp_access.is_none()
            && self.auto_review.is_none()
            && self.persistent_approval.is_none()
            && self.access_approval_lifetime.is_none()
    }
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BrowserUseAccessApprovalLifetimeToml {
    Turn,
    Thread,
}

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserUseRequirementsToml {
    pub extension: Option<BrowserUseExtensionRequirementsToml>,
    pub allow_webmcp: Option<bool>,
    pub allow_history_access: Option<bool>,
    pub disable_auto_review: Option<bool>,
    pub allow_global_persistent_approval: Option<bool>,
    pub default_origin_policy: Option<BrowserUseOriginPolicyToml>,
    pub origins: Option<BTreeMap<String, BrowserUseOriginPolicyToml>>,
}

impl BrowserUseRequirementsToml {
    pub fn is_empty(&self) -> bool {
        self.extension
            .as_ref()
            .is_none_or(|extension| extension.request_headers.is_none())
            && self.allow_webmcp.is_none()
            && self.allow_history_access.is_none()
            && self.disable_auto_review.is_none()
            && self.allow_global_persistent_approval.is_none()
            && self
                .default_origin_policy
                .as_ref()
                .is_none_or(BrowserUseOriginPolicyToml::is_empty)
            && self
                .origins
                .as_ref()
                .is_none_or(|origins| origins.values().all(BrowserUseOriginPolicyToml::is_empty))
    }
}

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserUseExtensionRequirementsToml {
    pub request_headers: Option<Vec<RequestHeaderToml>>,
}

#[derive(Deserialize, Clone, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RequestHeaderToml {
    pub name: String,
    pub value: String,
}

impl std::fmt::Debug for RequestHeaderToml {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RequestHeaderToml")
            .field("name", &self.name)
            .field("value", &"[REDACTED]")
            .finish()
    }
}

