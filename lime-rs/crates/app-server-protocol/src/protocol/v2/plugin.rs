use super::{AppSummary, HookEventName, SkillInterface};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginListParams {
    /// Optional working directories used to discover repo marketplaces. When omitted,
    /// only home-scoped marketplaces and the official curated marketplace are considered.
    pub cwds: Option<Vec<PathBuf>>,
    /// Optional marketplace kind filter. When omitted, only local marketplaces are queried, plus
    /// the default remote catalog when enabled by feature flag.
    pub marketplace_kinds: Option<Vec<PluginListMarketplaceKind>>,
    /// Whether the client requests a fresh remote plugin catalog fetch.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub force_refetch: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstalledParams {
    /// Optional working directories used to discover repo marketplaces.
    pub cwds: Option<Vec<PathBuf>>,
    /// Additional uninstalled plugin names that should be returned when present locally.
    /// This is used by mention surfaces that intentionally expose install entrypoints.
    pub install_suggestion_plugin_names: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
pub enum PluginListMarketplaceKind {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "cloud")]
    Cloud,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginListResponse {
    pub marketplaces: Vec<PluginMarketplaceEntry>,
    #[serde(default)]
    pub marketplace_load_errors: Vec<MarketplaceLoadErrorInfo>,
    #[serde(default)]
    pub featured_plugin_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstalledResponse {
    pub marketplaces: Vec<PluginMarketplaceEntry>,
    #[serde(default)]
    pub marketplace_load_errors: Vec<MarketplaceLoadErrorInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginReconcileParams {
    pub reason: Option<String>,
}

/// Changes observed by this pass, rather than an acknowledgement of runtime readiness.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginReconcileResponse {
    pub changed_plugins: Vec<PluginReconcileChangedPlugin>,
    pub failed_remote_plugin_ids: Vec<String>,
    pub failed_materialization_remote_plugin_ids: Vec<String>,
}

/// Categories declared by either the previous or new package, before runtime policy filtering.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginReconcileChangedPlugin {
    pub id: String,
    pub has_mcps: bool,
    pub has_apps: bool,
    pub has_hooks: bool,
    pub has_skills: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceLoadErrorInfo {
    pub marketplace_path: PathBuf,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginReadParams {
    pub marketplace_path: Option<PathBuf>,
    pub remote_marketplace_name: Option<String>,
    pub plugin_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginReadResponse {
    pub plugin: PluginDetail,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkillReadParams {
    pub remote_marketplace_name: String,
    pub remote_plugin_id: String,
    pub skill_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkillReadResponse {
    pub contents: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallParams {
    pub marketplace_path: Option<PathBuf>,
    pub remote_marketplace_name: Option<String>,
    /// Client-generated identifier used to correlate one installation attempt.
    pub install_attempt_id: Option<String>,
    pub plugin_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallResponse {
    pub auth_policy: PluginAuthPolicy,
    pub apps_needing_auth: Vec<AppSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketplaceEntry {
    pub name: String,
    /// Local marketplace file path when the marketplace is backed by a local file.
    /// Remote-only catalog marketplaces do not have a local path.
    pub path: Option<PathBuf>,
    pub interface: Option<MarketplaceInterface>,
    pub plugins: Vec<PluginSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceInterface {
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginDetail {
    pub marketplace_name: String,
    pub marketplace_path: Option<PathBuf>,
    pub summary: PluginSummary,
    pub description: Option<String>,
    pub skills: Vec<SkillSummary>,
    /// The declared onboarding skill, when the plugin and visible skill are enabled.
    #[serde(default)]
    pub onboarding_skill: Option<SkillSummary>,
    pub hooks: Vec<PluginHookSummary>,
    pub apps: Vec<AppSummary>,
    pub app_templates: Vec<AppTemplateSummary>,
    pub mcp_servers: Vec<String>,
    pub scheduled_tasks: Option<Vec<ScheduledTaskSummary>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskSummary {
    pub key: String,
    pub name: String,
    pub prompt: String,
    pub schedule: ScheduledTaskSchedule,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScheduledTaskSchedule {
    #[serde(rename_all = "camelCase")]
    Hourly {
        interval_hours: u32,
        days: Option<Vec<ScheduledTaskWeekday>>,
    },
    #[serde(rename_all = "camelCase")]
    Daily { time: String },
    #[serde(rename_all = "camelCase")]
    Weekdays { time: String },
    #[serde(rename_all = "camelCase")]
    Weekly {
        days: Vec<ScheduledTaskWeekday>,
        time: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScheduledTaskWeekday {
    Mo,
    Tu,
    We,
    Th,
    Fr,
    Sa,
    Su,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppTemplateUnavailableReason {
    NotConfiguredForWorkspace,
    NoActiveWorkspace,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppTemplateSummary {
    pub template_id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub canonical_connector_id: Option<String>,
    pub logo_url: Option<String>,
    pub logo_url_dark: Option<String>,
    pub materialized_app_ids: Vec<String>,
    pub reason: Option<AppTemplateUnavailableReason>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginHookSummary {
    pub key: String,
    pub event_name: HookEventName,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
    pub short_description: Option<String>,
    pub interface: Option<SkillInterface>,
    pub path: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginUninstallParams {
    pub plugin_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginUninstallResponse {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSearchParams {
    pub search_term: String,
    #[serde(default)]
    pub scope: Option<PluginSearchScope>,
    #[serde(default)]
    pub cwds: Option<Vec<String>>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PluginSearchScope {
    Global,
    Workspace,
    Personal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSearchResult {
    pub plugin: PluginSummary,
    pub marketplace_name: String,
    #[serde(default)]
    pub marketplace_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSearchResponse {
    pub data: Vec<PluginSearchResult>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum PluginInstallPolicy {
    #[serde(rename = "NOT_AVAILABLE")]
    NotAvailable,
    #[serde(rename = "AVAILABLE")]
    Available,
    #[serde(rename = "INSTALLED_BY_DEFAULT")]
    InstalledByDefault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum PluginInstallPolicySource {
    #[serde(rename = "WORKSPACE_SETTING")]
    WorkspaceSetting,
    #[serde(rename = "IMPLICIT_CANONICAL_APP")]
    ImplicitCanonicalApp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum PluginAuthPolicy {
    #[serde(rename = "ON_INSTALL")]
    OnInstall,
    #[serde(rename = "ON_USE")]
    OnUse,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum PluginAvailability {
    #[serde(rename = "AVAILABLE", alias = "ENABLED")]
    #[default]
    Available,
    #[serde(rename = "DISABLED_BY_ADMIN")]
    DisabledByAdmin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginDisabledReason {
    DisabledByAdmin,
    PlanNotEligible,
    RequiredAppUnavailable,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    #[serde(default)]
    pub remote_plugin_id: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub local_version: Option<String>,
    pub name: String,
    pub source: PluginSource,
    pub installed: bool,
    #[serde(default)]
    pub installed_at: Option<i64>,
    pub enabled: bool,
    pub install_policy: PluginInstallPolicy,
    #[serde(default)]
    pub install_policy_source: Option<PluginInstallPolicySource>,
    #[serde(default)]
    pub must_show_installation_interstitial: Option<bool>,
    pub auth_policy: PluginAuthPolicy,
    #[serde(default)]
    pub availability: PluginAvailability,
    #[serde(default)]
    pub disabled_reason: Option<PluginDisabledReason>,
    #[serde(default)]
    pub eligible_plan_types: Option<Vec<String>>,
    #[serde(default)]
    pub interface: Option<PluginInterface>,
    #[serde(default)]
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PluginInterface {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub short_description: Option<String>,
    #[serde(default)]
    pub long_description: Option<String>,
    #[serde(default)]
    pub developer_name: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub website_url: Option<String>,
    #[serde(default)]
    pub privacy_policy_url: Option<String>,
    #[serde(default)]
    pub terms_of_service_url: Option<String>,
    #[serde(default)]
    pub default_prompt: Option<Vec<String>>,
    #[serde(default)]
    pub brand_color: Option<String>,
    #[serde(default)]
    pub composer_icon: Option<String>,
    #[serde(default)]
    pub composer_icon_url: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub logo_dark: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub logo_url_dark: Option<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub screenshot_urls: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PluginSource {
    #[serde(rename_all = "camelCase")]
    Local {
        path: String,
    },
    #[serde(rename_all = "camelCase")]
    Git {
        url: String,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        ref_name: Option<String>,
        #[serde(default)]
        sha: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Npm {
        package: String,
        #[serde(default)]
        version: Option<String>,
        #[serde(default)]
        registry: Option<String>,
    },
    Remote,
}
