use app_server_protocol::protocol::v2::{
    AppInfo, AppSummary, AppsInstalledParams, AppsInstalledResponse, AppsListParams,
    AppsListResponse, AppsReadParams, AppsReadResponse, ConnectorMetadata, InstalledApp,
    MarketplaceInterface, MarketplaceLoadErrorInfo, PluginAuthPolicy, PluginAvailability,
    PluginDetail, PluginHookSummary, PluginInstallParams, PluginInstallPolicy,
    PluginInstallResponse, PluginInstalledParams, PluginInstalledResponse, PluginInterface,
    PluginListMarketplaceKind, PluginListParams, PluginListResponse, PluginMarketplaceEntry,
    PluginReadParams, PluginReadResponse, PluginSearchParams, PluginSearchResponse,
    PluginSearchResult, PluginSearchScope, PluginSource, PluginSummary, PluginUninstallParams,
    PluginUninstallResponse, SkillSummary,
};
use lime_mcp::parse_agent_plugin_mcp_config;
use lime_mcp::{McpRuntimeServerSpec, McpServerConfig, McpServerTransport};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const STANDARD_MANIFEST_SCHEMA: &str = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const LIME_EXTENSION_NAMESPACE: &str = "com.lime";
const LIME_EXTENSION_MANIFEST_PATH: &str = ".lime-plugin/plugin.json";
const STANDARD_MANIFEST_FIELDS: &[&str] = &[
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
];
const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 10_000;
const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;

mod apps;
mod bundle;
mod catalog;
mod components;
mod discovery;
pub(crate) mod hooks;
mod install;
pub(crate) mod marketplace;
mod store;
pub(crate) use store::PluginStore;
use store::{Installation, PluginId};
mod manifest;
pub(crate) mod remote;
mod resources;
pub(crate) mod share;

use apps::app_capabilities;
pub(crate) use apps::{installed_apps, list_apps, read_apps};
pub(crate) use catalog::{installed, list, read, search};
use components::build_capability_detail;
#[cfg(test)]
use components::skill_capabilities;
pub(crate) use components::{enabled_plugin_turn_snapshots, list_plugin_mcp_runtime_server_specs};
use discovery::{implicit_marketplace_paths, load_marketplace, resolve_plugin};
pub(crate) use install::install;
#[cfg(test)]
use install::uninstall;
use manifest::{interface_string, manifest_name, manifest_string, manifest_version};
use resources::{
    canonical_package_root, copy_package_tree, package_digest, resource_path, validate_plugin_id,
    validate_standard_name,
};

fn io_error(prefix: &'static str) -> impl FnOnce(std::io::Error) -> String {
    move |error| format!("{prefix}: {error}")
}

#[cfg(test)]
use manifest::read_manifest;
#[cfg(test)]
mod tests;
