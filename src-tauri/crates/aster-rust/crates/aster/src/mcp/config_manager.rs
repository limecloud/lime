//! MCP Configuration Manager
//!
//! This module implements the configuration manager for MCP servers.
//! It manages global and project-level configurations, validation,
//! change notifications, and import/export functionality.
//!
//! # Features
//!
//! - Load configurations from global (~/.aster/settings.yaml) and project (.aster/settings.yaml) paths
//! - Merge configurations with project-level taking precedence
//! - Validate server configurations using defined schema
//! - Check command existence for stdio servers
//! - Notify listeners on configuration changes
//! - Enable/disable individual servers
//! - Mask sensitive information when exporting
//! - Backup and restore configurations

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use crate::mcp::error::{McpError, McpResult};
use crate::mcp::types::{
    ConfigManagerOptions, ConfigScope, McpServerConfig, ServerValidationResult, TransportType,
    ValidationResult,
};

/// Configuration change callback type
pub type ConfigChangeCallback =
    Arc<dyn Fn(&HashMap<String, McpServerConfig>, Option<&str>) + Send + Sync>;

/// MCP configuration file structure
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpConfigFile {
    /// MCP server configurations
    #[serde(default, rename = "mcpServers")]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

/// Configuration manager trait
///
/// Defines the interface for managing MCP server configurations.
#[async_trait]
pub trait ConfigManager: Send + Sync {
    /// Load configurations from files
    async fn load(&self) -> McpResult<()>;

    /// Reload configurations
    async fn reload(&self) -> McpResult<()>;

    /// Get all server configurations (merged)
    fn get_servers(&self) -> HashMap<String, McpServerConfig>;

    /// Get a single server configuration
    fn get_server(&self, name: &str) -> Option<McpServerConfig>;

    /// Add a new server configuration
    async fn add_server(&self, name: &str, config: McpServerConfig) -> McpResult<()>;

    /// Update an existing server configuration
    async fn update_server(&self, name: &str, config: McpServerConfig) -> McpResult<()>;

    /// Remove a server configuration
    async fn remove_server(&self, name: &str) -> McpResult<bool>;

    /// Enable a server
    async fn enable_server(&self, name: &str) -> McpResult<()>;

    /// Disable a server
    async fn disable_server(&self, name: &str) -> McpResult<()>;

    /// Get enabled servers only
    fn get_enabled_servers(&self) -> HashMap<String, McpServerConfig>;

    /// Validate a server configuration
    fn validate(&self, config: &McpServerConfig) -> ValidationResult;

    /// Validate all server configurations
    fn validate_all(&self) -> Vec<ServerValidationResult>;

    /// Save configurations to file
    async fn save(&self, scope: ConfigScope) -> McpResult<()>;

    /// Backup current configuration
    async fn backup(&self) -> McpResult<PathBuf>;

    /// Restore configuration from backup
    async fn restore(&self, backup_path: &Path) -> McpResult<()>;

    /// Export configuration as JSON string
    fn export(&self, mask_secrets: bool) -> String;

    /// Import configuration from JSON string
    async fn import(&self, config_json: &str, scope: ConfigScope) -> McpResult<()>;

    /// Register a callback for configuration changes
    fn on_change(&self, callback: ConfigChangeCallback) -> Box<dyn FnOnce() + Send>;
}

/// Configuration change event
#[derive(Debug, Clone)]
pub enum ConfigEvent {
    /// Configuration loaded
    Loaded,
    /// Configuration reloaded
    Reloaded,
    /// Server added
    ServerAdded(String),
    /// Server updated
    ServerUpdated(String),
    /// Server removed
    ServerRemoved(String),
    /// Server enabled
    ServerEnabled(String),
    /// Server disabled
    ServerDisabled(String),
}

/// Internal configuration state
struct ConfigState {
    /// Global configuration
    global_config: HashMap<String, McpServerConfig>,
    /// Project configuration
    project_config: HashMap<String, McpServerConfig>,
    /// Merged configuration (project takes precedence)
    merged_config: HashMap<String, McpServerConfig>,
}

impl ConfigState {
    fn new() -> Self {
        Self {
            global_config: HashMap::new(),
            project_config: HashMap::new(),
            merged_config: HashMap::new(),
        }
    }

    /// Merge global and project configs (project takes precedence)
    fn merge(&mut self) {
        self.merged_config = merge_configs(&self.global_config, &self.project_config);
    }
}

/// Default implementation of the configuration manager
pub struct McpConfigManager {
    /// Configuration state
    state: Arc<RwLock<ConfigState>>,
    /// Manager options
    options: ConfigManagerOptions,
    /// Change callbacks
    callbacks: Arc<Mutex<Vec<ConfigChangeCallback>>>,
    /// File watcher handle (for cleanup)
    #[allow(dead_code)]
    watcher_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl McpConfigManager {
    /// Create a new configuration manager with default options
    pub fn new() -> Self {
        Self::with_options(ConfigManagerOptions::default())
    }

    /// Create a new configuration manager with custom options
    pub fn with_options(options: ConfigManagerOptions) -> Self {
        Self {
            state: Arc::new(RwLock::new(ConfigState::new())),
            options,
            callbacks: Arc::new(Mutex::new(Vec::new())),
            watcher_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Get the global config path
    pub fn global_config_path(&self) -> PathBuf {
        self.options.global_config_path.clone().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("~"))
                .join(".aster")
                .join("settings.yaml")
        })
    }

    /// Get the project config path
    pub fn project_config_path(&self) -> PathBuf {
        self.options
            .project_config_path
            .clone()
            .unwrap_or_else(|| PathBuf::from(".aster").join("settings.yaml"))
    }

    /// Start watching configuration files for changes
    ///
    /// This method spawns a background task that monitors the global and project
    /// configuration files for changes. When a change is detected, the configuration
    /// is automatically reloaded and all registered callbacks are notified.
    pub async fn start_watching(&self) -> McpResult<()> {
        let global_path = self.global_config_path();
        let project_path = self.project_config_path();
        let state = self.state.clone();
        let callbacks = self.callbacks.clone();

        // Store last modified times
        let global_mtime = Arc::new(Mutex::new(Self::get_mtime(&global_path)));
        let project_mtime = Arc::new(Mutex::new(Self::get_mtime(&project_path)));

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));

            loop {
                interval.tick().await;

                let mut changed = false;

                // Check global config
                let new_global_mtime = Self::get_mtime(&global_path);
                {
                    let mut last_mtime = global_mtime.lock().await;
                    if new_global_mtime != *last_mtime {
                        *last_mtime = new_global_mtime;
                        changed = true;
                    }
                }

                // Check project config
                let new_project_mtime = Self::get_mtime(&project_path);
                {
                    let mut last_mtime = project_mtime.lock().await;
                    if new_project_mtime != *last_mtime {
                        *last_mtime = new_project_mtime;
                        changed = true;
                    }
                }

                if changed {
                    // Reload configuration
                    if let Ok(global_config) = Self::load_config_from_file(&global_path).await {
                        if let Ok(project_config) = Self::load_config_from_file(&project_path).await
                        {
                            let mut s = state.write().await;
                            s.global_config = global_config;
                            s.project_config = project_config;
                            s.merge();

                            // Notify callbacks
                            let cbs = callbacks.lock().await;
                            for cb in cbs.iter() {
                                cb(&s.merged_config, None);
                            }
                        }
                    }
                }
            }
        });

        // Store the handle
        let mut watcher = self.watcher_handle.lock().await;
        if let Some(old_handle) = watcher.take() {
            old_handle.abort();
        }
        *watcher = Some(handle);

        Ok(())
    }

    /// Stop watching configuration files
    pub async fn stop_watching(&self) {
        let mut watcher = self.watcher_handle.lock().await;
        if let Some(handle) = watcher.take() {
            handle.abort();
        }
    }

    /// Get file modification time
    fn get_mtime(path: &Path) -> Option<std::time::SystemTime> {
        std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
    }

    /// Load configuration from a file
    async fn load_config_from_file(path: &Path) -> McpResult<HashMap<String, McpServerConfig>> {
        if !path.exists() {
            return Ok(HashMap::new());
        }

        let content = tokio::fs::read_to_string(path).await.map_err(|e| {
            McpError::config_with_source(format!("Failed to read config file: {:?}", path), e)
        })?;

        let config_file: McpConfigFile = serde_yaml::from_str(&content).map_err(|e| {
            McpError::config_with_source(format!("Failed to parse config file: {:?}", path), e)
        })?;

        Ok(config_file.mcp_servers)
    }

    /// Save configuration to a file
    async fn save_config_to_file(
        path: &Path,
        servers: &HashMap<String, McpServerConfig>,
    ) -> McpResult<()> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                McpError::config_with_source(
                    format!("Failed to create config directory: {:?}", parent),
                    e,
                )
            })?;
        }

        // Read existing config or create new
        let mut config_file = if path.exists() {
            let content = tokio::fs::read_to_string(path).await.map_err(|e| {
                McpError::config_with_source(format!("Failed to read config file: {:?}", path), e)
            })?;
            serde_yaml::from_str(&content).unwrap_or_default()
        } else {
            McpConfigFile::default()
        };

        // Update MCP servers
        config_file.mcp_servers = servers.clone();

        // Write back
        let content = serde_yaml::to_string(&config_file)
            .map_err(|e| McpError::config_with_source("Failed to serialize config", e))?;

        tokio::fs::write(path, content).await.map_err(|e| {
            McpError::config_with_source(format!("Failed to write config file: {:?}", path), e)
        })?;

        Ok(())
    }

    /// Notify all registered callbacks of a configuration change
    async fn notify_change(&self, changed_server: Option<&str>) {
        let callbacks = self.callbacks.lock().await;
        let state = self.state.read().await;

        for callback in callbacks.iter() {
            callback(&state.merged_config, changed_server);
        }
    }

    /// Check if a command exists on the system
    fn check_command_exists(command: &str) -> bool {
        which::which(command).is_ok()
    }

    /// Check if a key is sensitive (contains secret-like patterns)
    fn is_sensitive_key(key: &str) -> bool {
        let lower = key.to_lowercase();
        lower.contains("key")
            || lower.contains("token")
            || lower.contains("secret")
            || lower.contains("password")
            || lower.contains("auth")
            || lower.contains("credential")
            || lower.contains("api_key")
            || lower.contains("apikey")
    }

    /// Mask a sensitive value
    fn mask_secret(value: &str) -> String {
        if value.len() <= 8 {
            "***".to_string()
        } else {
            format!(
                "{}***{}",
                value.get(..4).unwrap_or(""),
                value.get(value.len().saturating_sub(4)..).unwrap_or("")
            )
        }
    }
}

impl Default for McpConfigManager {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ConfigManager for McpConfigManager {
    async fn load(&self) -> McpResult<()> {
        let global_path = self.global_config_path();
        let project_path = self.project_config_path();

        let global_config = Self::load_config_from_file(&global_path).await?;
        let project_config = Self::load_config_from_file(&project_path).await?;

        let mut state = self.state.write().await;
        state.global_config = global_config;
        state.project_config = project_config;
        state.merge();

        drop(state);
        self.notify_change(None).await;

        Ok(())
    }

    async fn reload(&self) -> McpResult<()> {
        self.load().await
    }

    fn get_servers(&self) -> HashMap<String, McpServerConfig> {
        self.state
            .try_read()
            .map(|s| s.merged_config.clone())
            .unwrap_or_default()
    }

    fn get_server(&self, name: &str) -> Option<McpServerConfig> {
        self.state
            .try_read()
            .ok()
            .and_then(|s| s.merged_config.get(name).cloned())
    }

    async fn add_server(&self, name: &str, config: McpServerConfig) -> McpResult<()> {
        // Validate configuration
        let validation = self.validate(&config);
        if !validation.valid {
            return Err(McpError::validation(
                format!("Invalid server configuration for '{}'", name),
                validation.errors,
            ));
        }

        // Add to project config
        {
            let mut state = self.state.write().await;
            state.project_config.insert(name.to_string(), config);
            state.merge();
        }

        // Auto-save if enabled
        if self.options.auto_save {
            self.save(ConfigScope::Project).await?;
        }

        self.notify_change(Some(name)).await;
        Ok(())
    }

    async fn update_server(&self, name: &str, config: McpServerConfig) -> McpResult<()> {
        // Check if server exists
        {
            let state = self.state.read().await;
            if !state.merged_config.contains_key(name) {
                return Err(McpError::config(format!("Server not found: {}", name)));
            }
        }

        // Validate configuration
        let validation = self.validate(&config);
        if !validation.valid {
            return Err(McpError::validation(
                format!("Invalid server configuration for '{}'", name),
                validation.errors,
            ));
        }

        // Update project config
        {
            let mut state = self.state.write().await;
            state.project_config.insert(name.to_string(), config);
            state.merge();
        }

        // Auto-save if enabled
        if self.options.auto_save {
            self.save(ConfigScope::Project).await?;
        }

        self.notify_change(Some(name)).await;
        Ok(())
    }

    async fn remove_server(&self, name: &str) -> McpResult<bool> {
        let existed = {
            let mut state = self.state.write().await;
            let existed = state.merged_config.contains_key(name);
            state.global_config.remove(name);
            state.project_config.remove(name);
            state.merge();
            existed
        };

        if existed && self.options.auto_save {
            self.save(ConfigScope::Global).await?;
            self.save(ConfigScope::Project).await?;
        }

        if existed {
            self.notify_change(Some(name)).await;
        }

        Ok(existed)
    }

    async fn enable_server(&self, name: &str) -> McpResult<()> {
        let config = self
            .get_server(name)
            .ok_or_else(|| McpError::config(format!("Server not found: {}", name)))?;

        let mut updated = config;
        updated.enabled = true;
        self.update_server(name, updated).await
    }

    async fn disable_server(&self, name: &str) -> McpResult<()> {
        let config = self
            .get_server(name)
            .ok_or_else(|| McpError::config(format!("Server not found: {}", name)))?;

        let mut updated = config;
        updated.enabled = false;
        self.update_server(name, updated).await
    }

    fn get_enabled_servers(&self) -> HashMap<String, McpServerConfig> {
        self.state
            .try_read()
            .map(|s| {
                s.merged_config
                    .iter()
                    .filter(|(_, config)| config.enabled)
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn validate(&self, config: &McpServerConfig) -> ValidationResult {
        let mut result = ValidationResult::valid();

        // Validate transport-specific requirements
        match config.transport_type {
            TransportType::Stdio => {
                if config.command.is_none() {
                    result.add_error("Stdio transport requires a command");
                } else if self.options.validate_commands {
                    if let Some(ref cmd) = config.command {
                        if !Self::check_command_exists(cmd) {
                            result.add_warning(format!("Command not found: {}", cmd));
                        }
                    }
                }
            }
            TransportType::Http | TransportType::Sse | TransportType::WebSocket => {
                if config.url.is_none() {
                    result.add_error(format!(
                        "{} transport requires a URL",
                        config.transport_type
                    ));
                }
            }
        }

        // Validate timeout
        if config.timeout.as_secs() == 0 {
            result.add_warning("Timeout is set to 0, which may cause issues");
        }

        // Check for empty environment variables
        if let Some(ref env) = config.env {
            for (key, value) in env {
                if value.is_empty() {
                    result.add_warning(format!("Environment variable '{}' is empty", key));
                }
            }
        }

        result
    }

    fn validate_all(&self) -> Vec<ServerValidationResult> {
        let servers = self.get_servers();
        let mut results = Vec::new();

        for (name, config) in servers {
            let validation = self.validate(&config);
            let command_exists = if config.transport_type == TransportType::Stdio {
                config
                    .command
                    .as_ref()
                    .map(|cmd| Self::check_command_exists(cmd))
            } else {
                None
            };

            results.push(ServerValidationResult {
                server_name: name,
                valid: validation.valid,
                command_exists,
                errors: validation.errors,
                warnings: validation.warnings,
            });
        }

        results
    }

    async fn save(&self, scope: ConfigScope) -> McpResult<()> {
        let (path, config) = {
            let state = self.state.read().await;
            match scope {
                ConfigScope::Global => (self.global_config_path(), state.global_config.clone()),
                ConfigScope::Project => (self.project_config_path(), state.project_config.clone()),
            }
        };

        Self::save_config_to_file(&path, &config).await
    }

    async fn backup(&self) -> McpResult<PathBuf> {
        let project_path = self.project_config_path();
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let backup_path = project_path.with_extension(format!("yaml.backup.{}", timestamp));

        if project_path.exists() {
            tokio::fs::copy(&project_path, &backup_path)
                .await
                .map_err(|e| McpError::config_with_source("Failed to create backup", e))?;
        }

        Ok(backup_path)
    }

    async fn restore(&self, backup_path: &Path) -> McpResult<()> {
        if !backup_path.exists() {
            return Err(McpError::config(format!(
                "Backup file not found: {:?}",
                backup_path
            )));
        }

        let project_path = self.project_config_path();
        tokio::fs::copy(backup_path, &project_path)
            .await
            .map_err(|e| McpError::config_with_source("Failed to restore backup", e))?;

        self.reload().await
    }

    fn export(&self, mask_secrets: bool) -> String {
        let servers = self.get_servers();

        if !mask_secrets {
            return serde_json::to_string_pretty(&servers).unwrap_or_default();
        }

        // Mask sensitive values
        let masked: HashMap<String, McpServerConfig> = servers
            .into_iter()
            .map(|(name, mut config)| {
                // Mask environment variables
                if let Some(ref mut env) = config.env {
                    for (key, value) in env.iter_mut() {
                        if Self::is_sensitive_key(key) {
                            *value = Self::mask_secret(value);
                        }
                    }
                }

                // Mask headers
                if let Some(ref mut headers) = config.headers {
                    for (key, value) in headers.iter_mut() {
                        if Self::is_sensitive_key(key) {
                            *value = Self::mask_secret(value);
                        }
                    }
                }

                (name, config)
            })
            .collect();

        serde_json::to_string_pretty(&masked).unwrap_or_default()
    }

    async fn import(&self, config_json: &str, scope: ConfigScope) -> McpResult<()> {
        let servers: HashMap<String, McpServerConfig> = serde_json::from_str(config_json)
            .map_err(|e| McpError::config_with_source("Failed to parse import JSON", e))?;

        // Validate all servers
        for (name, config) in &servers {
            let validation = self.validate(config);
            if !validation.valid {
                return Err(McpError::validation(
                    format!("Invalid configuration for server '{}'", name),
                    validation.errors,
                ));
            }
        }

        // Update state
        {
            let mut state = self.state.write().await;
            match scope {
                ConfigScope::Global => state.global_config = servers,
                ConfigScope::Project => state.project_config = servers,
            }
            state.merge();
        }

        // Save if auto-save enabled
        if self.options.auto_save {
            self.save(scope).await?;
        }

        self.notify_change(None).await;
        Ok(())
    }

    fn on_change(&self, callback: ConfigChangeCallback) -> Box<dyn FnOnce() + Send> {
        let callbacks = self.callbacks.clone();
        let callback_clone = callback.clone();

        // Add callback
        tokio::spawn(async move {
            callbacks.lock().await.push(callback_clone);
        });

        // Return unsubscribe function
        let callbacks_for_unsub = self.callbacks.clone();
        Box::new(move || {
            let cb = callback;
            tokio::spawn(async move {
                let mut cbs = callbacks_for_unsub.lock().await;
                cbs.retain(|c| !Arc::ptr_eq(c, &cb));
            });
        })
    }
}

/// Merge two configurations (right takes precedence over left)
pub fn merge_configs(
    global: &HashMap<String, McpServerConfig>,
    project: &HashMap<String, McpServerConfig>,
) -> HashMap<String, McpServerConfig> {
    let mut merged = global.clone();

    for (name, project_config) in project {
        if let Some(global_config) = merged.get_mut(name) {
            // Merge: project values override global values
            *global_config = merge_server_config(global_config, project_config);
        } else {
            merged.insert(name.clone(), project_config.clone());
        }
    }

    merged
}

/// Merge two server configurations (right takes precedence)
fn merge_server_config(global: &McpServerConfig, project: &McpServerConfig) -> McpServerConfig {
    McpServerConfig {
        transport_type: project.transport_type,
        command: project.command.clone().or_else(|| global.command.clone()),
        args: project.args.clone().or_else(|| global.args.clone()),
        env: merge_optional_maps(&global.env, &project.env),
        url: project.url.clone().or_else(|| global.url.clone()),
        headers: merge_optional_maps(&global.headers, &project.headers),
        enabled: project.enabled,
        timeout: project.timeout,
        retries: project.retries,
        auto_approve: if project.auto_approve.is_empty() {
            global.auto_approve.clone()
        } else {
            project.auto_approve.clone()
        },
        log_level: project.log_level,
    }
}

/// Merge two optional HashMaps (right takes precedence)
fn merge_optional_maps(
    left: &Option<HashMap<String, String>>,
    right: &Option<HashMap<String, String>>,
) -> Option<HashMap<String, String>> {
    match (left, right) {
        (None, None) => None,
        (Some(l), None) => Some(l.clone()),
        (None, Some(r)) => Some(r.clone()),
        (Some(l), Some(r)) => {
            let mut merged = l.clone();
            merged.extend(r.clone());
            Some(merged)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn create_test_config() -> McpServerConfig {
        McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("node".to_string()),
            args: Some(vec!["server.js".to_string()]),
            env: Some(HashMap::from([
                ("API_KEY".to_string(), "secret123".to_string()),
                ("DEBUG".to_string(), "true".to_string()),
            ])),
            url: None,
            headers: None,
            enabled: true,
            timeout: Duration::from_secs(30),
            retries: 3,
            auto_approve: vec![],
            log_level: Default::default(),
        }
    }

    #[test]
    fn test_config_manager_new() {
        let manager = McpConfigManager::new();
        assert!(manager.get_servers().is_empty());
    }

    #[test]
    fn test_validation_result() {
        let mut result = ValidationResult::valid();
        assert!(result.valid);
        assert!(result.errors.is_empty());

        result.add_error("test error");
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);

        result.add_warning("test warning");
        assert_eq!(result.warnings.len(), 1);
    }

    #[test]
    fn test_validate_stdio_config() {
        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            validate_commands: false,
            ..Default::default()
        });

        let config = create_test_config();
        let result = manager.validate(&config);
        assert!(result.valid);
    }

    #[test]
    fn test_validate_stdio_missing_command() {
        let manager = McpConfigManager::new();
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: None,
            ..Default::default()
        };

        let result = manager.validate(&config);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("command")));
    }

    #[test]
    fn test_validate_http_missing_url() {
        let manager = McpConfigManager::new();
        let config = McpServerConfig {
            transport_type: TransportType::Http,
            url: None,
            ..Default::default()
        };

        let result = manager.validate(&config);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("URL")));
    }

    #[test]
    fn test_is_sensitive_key() {
        assert!(McpConfigManager::is_sensitive_key("API_KEY"));
        assert!(McpConfigManager::is_sensitive_key("api_key"));
        assert!(McpConfigManager::is_sensitive_key("SECRET_TOKEN"));
        assert!(McpConfigManager::is_sensitive_key("password"));
        assert!(McpConfigManager::is_sensitive_key("AUTH_TOKEN"));
        assert!(!McpConfigManager::is_sensitive_key("DEBUG"));
        assert!(!McpConfigManager::is_sensitive_key("PORT"));
    }

    #[test]
    fn test_mask_secret() {
        assert_eq!(McpConfigManager::mask_secret("short"), "***");
        assert_eq!(McpConfigManager::mask_secret("12345678"), "***");
        assert_eq!(
            McpConfigManager::mask_secret("longsecretvalue"),
            "long***alue"
        );
    }

    #[test]
    fn test_merge_configs() {
        let mut global = HashMap::new();
        global.insert(
            "server1".to_string(),
            McpServerConfig {
                transport_type: TransportType::Stdio,
                command: Some("global_cmd".to_string()),
                enabled: true,
                ..Default::default()
            },
        );
        global.insert(
            "server2".to_string(),
            McpServerConfig {
                transport_type: TransportType::Http,
                url: Some("http://global.example.com".to_string()),
                enabled: true,
                ..Default::default()
            },
        );

        let mut project = HashMap::new();
        project.insert(
            "server1".to_string(),
            McpServerConfig {
                transport_type: TransportType::Stdio,
                command: Some("project_cmd".to_string()),
                enabled: false,
                ..Default::default()
            },
        );
        project.insert(
            "server3".to_string(),
            McpServerConfig {
                transport_type: TransportType::WebSocket,
                url: Some("ws://project.example.com".to_string()),
                enabled: true,
                ..Default::default()
            },
        );

        let merged = merge_configs(&global, &project);

        // server1: project takes precedence
        assert_eq!(
            merged.get("server1").unwrap().command,
            Some("project_cmd".to_string())
        );
        assert!(!merged.get("server1").unwrap().enabled);

        // server2: only in global
        assert_eq!(
            merged.get("server2").unwrap().url,
            Some("http://global.example.com".to_string())
        );

        // server3: only in project
        assert_eq!(
            merged.get("server3").unwrap().url,
            Some("ws://project.example.com".to_string())
        );
    }

    #[test]
    fn test_merge_optional_maps() {
        let left = Some(HashMap::from([
            ("a".to_string(), "1".to_string()),
            ("b".to_string(), "2".to_string()),
        ]));
        let right = Some(HashMap::from([
            ("b".to_string(), "3".to_string()),
            ("c".to_string(), "4".to_string()),
        ]));

        let merged = merge_optional_maps(&left, &right).unwrap();
        assert_eq!(merged.get("a"), Some(&"1".to_string()));
        assert_eq!(merged.get("b"), Some(&"3".to_string())); // right takes precedence
        assert_eq!(merged.get("c"), Some(&"4".to_string()));
    }

    #[tokio::test]
    async fn test_export_with_masking() {
        let manager = McpConfigManager::new();

        // Add a server with sensitive data
        {
            let mut state = manager.state.write().await;
            state.merged_config.insert(
                "test".to_string(),
                McpServerConfig {
                    transport_type: TransportType::Stdio,
                    command: Some("node".to_string()),
                    env: Some(HashMap::from([
                        ("API_KEY".to_string(), "supersecretkey123".to_string()),
                        ("DEBUG".to_string(), "true".to_string()),
                    ])),
                    ..Default::default()
                },
            );
        }

        let exported = manager.export(true);
        // The mask function shows first 4 and last 4 chars: "supe***y123"
        assert!(exported.contains("supe***y123")); // masked
        assert!(exported.contains("true")); // not masked
        assert!(!exported.contains("supersecretkey123")); // original not present
    }

    #[tokio::test]
    async fn test_load_from_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("settings.yaml");

        // Create a test config file
        let config_content = r#"
mcpServers:
  test-server:
    transport_type: stdio
    command: node
    args:
      - server.js
    enabled: true
    timeout: 30000
    retries: 3
"#;
        tokio::fs::write(&config_path, config_content)
            .await
            .unwrap();

        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        manager.load().await.unwrap();

        let servers = manager.get_servers();
        assert!(servers.contains_key("test-server"));
        assert_eq!(
            servers.get("test-server").unwrap().command,
            Some("node".to_string())
        );
    }

    #[tokio::test]
    async fn test_save_and_load_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("settings.yaml");

        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path.clone()),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        // Add a server
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("test-cmd".to_string()),
            args: Some(vec!["arg1".to_string()]),
            enabled: true,
            ..Default::default()
        };

        manager
            .add_server("roundtrip-test", config.clone())
            .await
            .unwrap();
        manager.save(ConfigScope::Project).await.unwrap();

        // Create a new manager and load
        let manager2 = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        manager2.load().await.unwrap();

        let loaded = manager2.get_server("roundtrip-test").unwrap();
        assert_eq!(loaded.command, Some("test-cmd".to_string()));
        assert_eq!(loaded.args, Some(vec!["arg1".to_string()]));
    }

    #[test]
    fn test_validate_all() {
        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            validate_commands: false,
            ..Default::default()
        });

        // Add servers directly to state for testing
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut state = manager.state.write().await;
            state.merged_config.insert(
                "valid-server".to_string(),
                McpServerConfig {
                    transport_type: TransportType::Stdio,
                    command: Some("node".to_string()),
                    enabled: true,
                    ..Default::default()
                },
            );
            state.merged_config.insert(
                "invalid-server".to_string(),
                McpServerConfig {
                    transport_type: TransportType::Http,
                    url: None, // Missing required URL
                    enabled: true,
                    ..Default::default()
                },
            );
        });

        let results = manager.validate_all();
        assert_eq!(results.len(), 2);

        let valid_result = results
            .iter()
            .find(|r| r.server_name == "valid-server")
            .unwrap();
        assert!(valid_result.valid);

        let invalid_result = results
            .iter()
            .find(|r| r.server_name == "invalid-server")
            .unwrap();
        assert!(!invalid_result.valid);
    }

    #[test]
    fn test_command_exists_check() {
        // Test with a command that should exist on most systems
        assert!(
            McpConfigManager::check_command_exists("ls")
                || McpConfigManager::check_command_exists("dir")
        );

        // Test with a command that shouldn't exist
        assert!(!McpConfigManager::check_command_exists(
            "nonexistent_command_xyz123"
        ));
    }

    #[tokio::test]
    async fn test_enable_disable_server() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("settings.yaml");

        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        // Add a server
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("test-cmd".to_string()),
            enabled: true,
            ..Default::default()
        };

        manager.add_server("toggle-test", config).await.unwrap();

        // Verify initially enabled
        assert!(manager.get_server("toggle-test").unwrap().enabled);
        assert!(manager.get_enabled_servers().contains_key("toggle-test"));

        // Disable
        manager.disable_server("toggle-test").await.unwrap();
        assert!(!manager.get_server("toggle-test").unwrap().enabled);
        assert!(!manager.get_enabled_servers().contains_key("toggle-test"));

        // Enable again
        manager.enable_server("toggle-test").await.unwrap();
        assert!(manager.get_server("toggle-test").unwrap().enabled);
        assert!(manager.get_enabled_servers().contains_key("toggle-test"));
    }

    #[tokio::test]
    async fn test_on_change_callback() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("settings.yaml");

        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        // Track callback invocations
        let call_count = Arc::new(AtomicUsize::new(0));
        let call_count_clone = call_count.clone();

        // Register callback
        let _unsubscribe = manager.on_change(Arc::new(move |_config, _changed| {
            call_count_clone.fetch_add(1, Ordering::SeqCst);
        }));

        // Give time for callback registration
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Add a server (should trigger callback)
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("test-cmd".to_string()),
            enabled: true,
            ..Default::default()
        };

        manager.add_server("callback-test", config).await.unwrap();

        // Give time for callback to be invoked
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Callback should have been called at least once
        assert!(call_count.load(Ordering::SeqCst) >= 1);
    }

    #[tokio::test]
    async fn test_backup_and_restore() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("settings.yaml");

        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path.clone()),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        // Add a server and save
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("original-cmd".to_string()),
            enabled: true,
            ..Default::default()
        };

        manager.add_server("backup-test", config).await.unwrap();
        manager.save(ConfigScope::Project).await.unwrap();

        // Create backup
        let backup_path = manager.backup().await.unwrap();
        assert!(backup_path.exists());

        // Modify the config
        let new_config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("modified-cmd".to_string()),
            enabled: true,
            ..Default::default()
        };
        manager
            .update_server("backup-test", new_config)
            .await
            .unwrap();
        manager.save(ConfigScope::Project).await.unwrap();

        // Verify modification
        assert_eq!(
            manager.get_server("backup-test").unwrap().command,
            Some("modified-cmd".to_string())
        );

        // Restore from backup
        manager.restore(&backup_path).await.unwrap();

        // Verify restoration
        assert_eq!(
            manager.get_server("backup-test").unwrap().command,
            Some("original-cmd".to_string())
        );
    }

    #[tokio::test]
    async fn test_import_export() {
        let temp_dir = tempfile::tempdir().unwrap();
        let config_path = temp_dir.path().join("settings.yaml");

        let manager = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        // Add a server
        let config = McpServerConfig {
            transport_type: TransportType::Stdio,
            command: Some("export-cmd".to_string()),
            enabled: true,
            ..Default::default()
        };

        manager.add_server("export-test", config).await.unwrap();

        // Export without masking
        let exported = manager.export(false);
        assert!(exported.contains("export-cmd"));

        // Create a new manager and import
        let temp_dir2 = tempfile::tempdir().unwrap();
        let config_path2 = temp_dir2.path().join("settings.yaml");

        let manager2 = McpConfigManager::with_options(ConfigManagerOptions {
            project_config_path: Some(config_path2),
            auto_save: false,
            validate_commands: false,
            ..Default::default()
        });

        manager2
            .import(&exported, ConfigScope::Project)
            .await
            .unwrap();

        // Verify import
        assert!(manager2.get_server("export-test").is_some());
        assert_eq!(
            manager2.get_server("export-test").unwrap().command,
            Some("export-cmd".to_string())
        );
    }
}
