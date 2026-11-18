//! Resolve MCP server declarations without changing their identities.
//!
//! Core registration, exposure and ordering are adapted from the upstream MCP
//! catalog. Hosted Apps, EMA account tokens and account requirements are
//! intentionally excluded: they belong to product services Lime does not own.

use std::collections::BTreeMap;
use std::collections::HashMap;

use lime_utils_path_uri::PathUri;

use crate::McpServerConfig;
use crate::McpServerKey;

/// Which servers to expose; their internal keys are the same in either mode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum McpServerExposure {
    #[default]
    Legacy,
    EnvironmentQualified,
}

impl McpServerExposure {
    /// The environment selector shown alongside a server in model-visible output.
    pub fn environment_id(self, key: &McpServerKey) -> Option<&str> {
        match self {
            Self::Legacy => None,
            Self::EnvironmentQualified => key.scoped_environment_id(),
        }
    }
}

/// Plugin identity retained with an MCP registration for tool attribution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpPluginAttribution {
    plugin_id: String,
    display_name: String,
    agent_plugin: bool,
    host_root: Option<PathUri>,
}

impl McpPluginAttribution {
    pub fn new(plugin_id: String, display_name: String) -> Self {
        Self {
            plugin_id,
            display_name,
            agent_plugin: false,
            host_root: None,
        }
    }

    pub fn agent_plugin(plugin_id: String, display_name: String) -> Self {
        Self {
            plugin_id,
            display_name,
            agent_plugin: true,
            host_root: None,
        }
    }

    pub fn with_host_root(mut self, host_root: PathUri) -> Self {
        self.host_root = Some(host_root);
        self
    }

    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn is_agent_plugin(&self) -> bool {
        self.agent_plugin
    }

    pub fn host_root(&self) -> Option<&PathUri> {
        self.host_root.as_ref()
    }
}

/// The component that declared an MCP server registration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpServerSource {
    Plugin(McpPluginAttribution),
    SelectedPlugin(McpPluginAttribution),
    Config,
    Compatibility { id: String },
    Extension { id: String },
}

impl McpServerSource {
    pub fn is_agent_plugin(&self) -> bool {
        match self {
            Self::Plugin(attribution) | Self::SelectedPlugin(attribution) => {
                attribution.is_agent_plugin()
            }
            Self::Config | Self::Compatibility { .. } | Self::Extension { .. } => false,
        }
    }

    pub fn plugin_id(&self) -> Option<&str> {
        match self {
            Self::Plugin(attribution) | Self::SelectedPlugin(attribution) => {
                Some(attribution.plugin_id())
            }
            Self::Config | Self::Compatibility { .. } | Self::Extension { .. } => None,
        }
    }

    pub fn display_name(&self) -> Option<&str> {
        match self {
            Self::Plugin(attribution) | Self::SelectedPlugin(attribution) => {
                Some(attribution.display_name())
            }
            Self::Config | Self::Compatibility { .. } | Self::Extension { .. } => None,
        }
    }
}

/// One resolved MCP server registration.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedMcpServer {
    key: McpServerKey,
    config: McpServerConfig,
    source: McpServerSource,
}

impl ResolvedMcpServer {
    pub fn new(key: McpServerKey, config: McpServerConfig, source: McpServerSource) -> Self {
        Self {
            key,
            config,
            source,
        }
    }

    pub fn key(&self) -> &McpServerKey {
        &self.key
    }

    pub fn name(&self) -> &str {
        self.key.name()
    }

    pub fn environment_id(&self) -> &str {
        &self.config.environment_id
    }

    pub fn config(&self) -> &McpServerConfig {
        &self.config
    }

    pub fn source(&self) -> &McpServerSource {
        &self.source
    }
}

/// Registrations keyed by exact MCP server identity.
#[derive(Clone, Debug, Default)]
pub struct McpCatalog {
    registrations: BTreeMap<McpServerKey, ResolvedMcpServer>,
}

impl McpCatalog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_config(&mut self, name: impl Into<String>, config: McpServerConfig) -> &mut Self {
        let key = McpServerKey::unscoped(name);
        self.insert(key, config, McpServerSource::Config)
    }

    pub fn add_plugin(
        &mut self,
        name: impl Into<String>,
        config: McpServerConfig,
        attribution: McpPluginAttribution,
    ) -> &mut Self {
        let key = McpServerKey::unscoped(name);
        self.insert(key, config, McpServerSource::Plugin(attribution))
    }

    pub fn add_selected_plugin(
        &mut self,
        name: impl Into<String>,
        config: McpServerConfig,
        attribution: McpPluginAttribution,
    ) -> &mut Self {
        let key = McpServerKey::unscoped(name);
        self.insert(key, config, McpServerSource::SelectedPlugin(attribution))
    }

    pub fn add_compatibility(
        &mut self,
        name: impl Into<String>,
        config: McpServerConfig,
        id: impl Into<String>,
    ) -> &mut Self {
        let key = McpServerKey::unscoped(name);
        self.insert(
            key,
            config,
            McpServerSource::Compatibility { id: id.into() },
        )
    }

    pub fn add_extension(
        &mut self,
        name: impl Into<String>,
        config: McpServerConfig,
        id: impl Into<String>,
    ) -> &mut Self {
        let key = McpServerKey::unscoped(name);
        self.insert(key, config, McpServerSource::Extension { id: id.into() })
    }

    fn insert(
        &mut self,
        key: McpServerKey,
        config: McpServerConfig,
        source: McpServerSource,
    ) -> &mut Self {
        self.registrations
            .insert(key.clone(), ResolvedMcpServer::new(key, config, source));
        self
    }

    pub fn remove(&mut self, key: &McpServerKey) -> Option<ResolvedMcpServer> {
        self.registrations.remove(key)
    }

    pub fn server(&self, key: &McpServerKey) -> Option<&ResolvedMcpServer> {
        self.registrations.get(key)
    }

    pub fn is_empty(&self) -> bool {
        self.registrations.is_empty()
    }

    pub fn len(&self) -> usize {
        self.registrations.len()
    }

    /// Enabled registrations sorted by exact identity.
    pub fn resolve(&self, _exposure: McpServerExposure) -> Vec<ResolvedMcpServer> {
        self.registrations
            .values()
            .filter(|server| server.config.enabled)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DEFAULT_MCP_SERVER_ENVIRONMENT_ID;

    fn config(_name: &str) -> McpServerConfig {
        McpServerConfig {
            enabled: true,
            environment_id: DEFAULT_MCP_SERVER_ENVIRONMENT_ID.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn resolves_enabled_registrations_by_key() {
        let mut catalog = McpCatalog::new();
        catalog.add_config("zeta", config("zeta"));
        catalog.add_config("alpha", config("alpha"));

        let resolved = catalog.resolve(McpServerExposure::Legacy);
        assert_eq!(
            resolved
                .iter()
                .map(|server| server.name())
                .collect::<Vec<_>>(),
            ["alpha", "zeta"]
        );
    }

    #[test]
    fn disabled_registration_is_not_exposed() {
        let mut catalog = McpCatalog::new();
        let mut disabled = config("disabled");
        disabled.enabled = false;
        catalog.add_config("disabled", disabled);

        assert!(catalog.resolve(McpServerExposure::Legacy).is_empty());
        assert_eq!(catalog.len(), 1);
    }

    #[test]
    fn environment_exposure_only_reports_scoped_keys() {
        let key = McpServerKey::in_environment("remote", "files");
        assert_eq!(
            McpServerExposure::EnvironmentQualified.environment_id(&key),
            Some("remote")
        );
        assert_eq!(McpServerExposure::Legacy.environment_id(&key), None);
    }

    #[test]
    fn plugin_attribution_is_preserved() {
        let mut catalog = McpCatalog::new();
        let attribution = McpPluginAttribution::new("plugin-1".to_string(), "Plugin".to_string())
            .with_host_root(PathUri::from_host_native_path(std::env::temp_dir()).unwrap());
        catalog.add_plugin("files", config("files"), attribution.clone());

        let server = catalog
            .server(&McpServerKey::unscoped("files"))
            .expect("server");
        assert_eq!(server.source().plugin_id(), Some("plugin-1"));
        assert_eq!(server.source().display_name(), Some("Plugin"));
        assert!(matches!(server.source(), McpServerSource::Plugin(_)));
        assert_eq!(server.source().plugin_id(), Some(attribution.plugin_id()));
    }

    #[test]
    fn same_name_in_different_environment_stays_distinct() {
        let mut catalog = McpCatalog::new();
        catalog.insert(
            McpServerKey::in_environment("remote", "files"),
            config("files"),
            McpServerSource::Config,
        );
        catalog.insert(
            McpServerKey::in_environment("local", "files"),
            config("files"),
            McpServerSource::Config,
        );

        assert_eq!(catalog.len(), 2);
        assert!(catalog
            .server(&McpServerKey::in_environment("remote", "files"))
            .is_some());
        assert!(catalog
            .server(&McpServerKey::in_environment("local", "files"))
            .is_some());
    }
    #[test]
    fn config_registration_wins_over_plugin_by_name() {
        let mut catalog = McpCatalog::new();
        catalog.add_config("files", config("files"));
        let key = McpServerKey::unscoped("files");
        assert!(catalog.server(&key).is_some());

        let attribution = McpPluginAttribution::new("plugin".to_string(), "Plugin".to_string());
        // Consumers dedupe by checking `server()` before adding lower-priority sources.
        if catalog.server(&key).is_none() {
            catalog.add_plugin("files", config("files"), attribution);
        }
        assert!(matches!(
            catalog.server(&key).expect("server").source(),
            McpServerSource::Config
        ));
    }

    #[test]
    fn runtime_spec_projects_resolved_identity_and_plugin() {
        let attribution = McpPluginAttribution::new("plugin-7".to_string(), "Plugin".to_string());
        let resolved = ResolvedMcpServer::new(
            McpServerKey::unscoped("files"),
            config("files"),
            McpServerSource::Plugin(attribution),
        );
        let spec = crate::McpRuntimeServerSpec::from_resolved(&resolved);
        assert_eq!(spec.name, "files");
        assert_eq!(spec.plugin_id.as_deref(), Some("plugin-7"));
        assert_eq!(spec.config.environment_id, "local");
    }
}
