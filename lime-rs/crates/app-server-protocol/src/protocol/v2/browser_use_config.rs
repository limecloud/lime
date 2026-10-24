use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct BrowserUseConfig {
    pub allow_history_access: Option<bool>,
    pub default_origin_policy: Option<BrowserUseOriginPolicyConfig>,
    pub origins: Option<BTreeMap<String, BrowserUseOriginPolicyConfig>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct BrowserUseOriginPolicyConfig {
    pub access: Option<AllowDenyRequirement>,
    pub downloads: Option<AllowDenyRequirement>,
    pub uploads: Option<AllowDenyRequirement>,
    pub full_cdp_access: Option<AllowDenyRequirement>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AllowDenyRequirement {
    Allow,
    Deny,
}
