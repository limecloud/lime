//! MCP Roots Module
//!
//! Manages root directories for MCP servers. Roots define the base directories
//! that servers can access, providing a sandboxing mechanism for file operations.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

/// Root directory for MCP protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Root {
    /// URI of the root (file:// format)
    pub uri: String,
    /// Optional human-readable name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Root directory with metadata
#[derive(Debug, Clone)]
pub struct RootInfo {
    /// URI of the root
    pub uri: String,
    /// Optional name
    pub name: Option<String>,
    /// Whether the path exists
    pub exists: bool,
    /// Absolute path (if file:// URI)
    pub absolute_path: Option<PathBuf>,
    /// Permissions
    pub permissions: Option<RootPermissions>,
}

/// Root permissions
#[derive(Debug, Clone, Copy)]
pub struct RootPermissions {
    /// Read permission
    pub read: bool,
    /// Write permission
    pub write: bool,
}

/// Roots configuration
#[derive(Debug, Clone)]
pub struct RootsConfig {
    /// Initial roots
    pub roots: Vec<Root>,
    /// Allow dynamic root addition
    pub allow_dynamic_roots: bool,
    /// Validate paths exist
    pub validate_paths: bool,
}

impl Default for RootsConfig {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            allow_dynamic_roots: true,
            validate_paths: true,
        }
    }
}

/// Root event for broadcasting
#[derive(Debug, Clone)]
pub enum RootEvent {
    /// Root added
    RootAdded { root: RootInfo },
    /// Root removed
    RootRemoved { root: RootInfo },
    /// Root updated
    RootUpdated { root: RootInfo, previous: RootInfo },
    /// Roots cleared
    RootsCleared { count: usize },
    /// Roots refreshed
    RootsRefreshed { count: usize },
}

/// Manages root directories for MCP servers
pub struct McpRootsManager {
    roots: Arc<RwLock<HashMap<String, RootInfo>>>,
    allow_dynamic_roots: bool,
    validate_paths: bool,
    event_sender: broadcast::Sender<RootEvent>,
}

impl McpRootsManager {
    /// Create a new roots manager
    pub fn new(config: RootsConfig) -> Self {
        let (event_sender, _) = broadcast::channel(64);
        let manager = Self {
            roots: Arc::new(RwLock::new(HashMap::new())),
            allow_dynamic_roots: config.allow_dynamic_roots,
            validate_paths: config.validate_paths,
            event_sender,
        };

        // Initialize with provided roots (blocking for simplicity)
        for root in config.roots {
            let root_info = manager.parse_root_sync(&root);
            manager
                .roots
                .blocking_write()
                .insert(root.uri.clone(), root_info);
        }

        manager
    }

    /// Subscribe to root events
    pub fn subscribe(&self) -> broadcast::Receiver<RootEvent> {
        self.event_sender.subscribe()
    }

    /// Add a root directory
    pub async fn add_root(&self, root: Root) -> RootInfo {
        let root_info = self.parse_root(&root);
        self.roots
            .write()
            .await
            .insert(root.uri.clone(), root_info.clone());
        let _ = self.event_sender.send(RootEvent::RootAdded {
            root: root_info.clone(),
        });
        root_info
    }

    /// Remove a root directory
    pub async fn remove_root(&self, uri: &str) -> Option<RootInfo> {
        let root = self.roots.write().await.remove(uri);
        if let Some(ref r) = root {
            let _ = self
                .event_sender
                .send(RootEvent::RootRemoved { root: r.clone() });
        }
        root
    }

    /// Update a root directory
    pub async fn update_root(&self, uri: &str, updates: Root) -> Option<RootInfo> {
        let mut roots = self.roots.write().await;
        let existing = roots.get(uri)?.clone();
        let updated = self.parse_root(&updates);
        roots.insert(uri.to_string(), updated.clone());
        let _ = self.event_sender.send(RootEvent::RootUpdated {
            root: updated.clone(),
            previous: existing,
        });
        Some(updated)
    }

    /// Get a root by URI
    pub async fn get_root(&self, uri: &str) -> Option<RootInfo> {
        self.roots.read().await.get(uri).cloned()
    }

    /// Get all roots
    pub async fn get_roots(&self) -> Vec<RootInfo> {
        self.roots.read().await.values().cloned().collect()
    }

    /// Get all roots as plain Root objects (for MCP protocol)
    pub async fn get_roots_for_protocol(&self) -> Vec<Root> {
        self.roots
            .read()
            .await
            .values()
            .map(|r| Root {
                uri: r.uri.clone(),
                name: r.name.clone(),
            })
            .collect()
    }

    /// Clear all roots
    pub async fn clear_roots(&self) {
        let mut roots = self.roots.write().await;
        let count = roots.len();
        roots.clear();
        let _ = self.event_sender.send(RootEvent::RootsCleared { count });
    }

    /// Check if a URI is registered as a root
    pub async fn has_root(&self, uri: &str) -> bool {
        self.roots.read().await.contains_key(uri)
    }

    /// Parse a root and extract information
    fn parse_root(&self, root: &Root) -> RootInfo {
        self.parse_root_sync(root)
    }

    fn parse_root_sync(&self, root: &Root) -> RootInfo {
        let mut absolute_path = None;
        let mut exists = false;
        let mut permissions = None;

        if root.uri.starts_with("file://") {
            if let Some(path) = self.uri_to_path(&root.uri) {
                absolute_path = Some(path.clone());

                if self.validate_paths {
                    exists = path.exists();
                    if exists {
                        let read = path
                            .metadata()
                            .map(|m| !m.permissions().readonly())
                            .unwrap_or(false);
                        let write = std::fs::OpenOptions::new().write(true).open(&path).is_ok();
                        permissions = Some(RootPermissions { read, write });
                    }
                }
            }
        }

        RootInfo {
            uri: root.uri.clone(),
            name: root.name.clone(),
            exists,
            absolute_path,
            permissions,
        }
    }

    /// Convert file:// URI to local path
    fn uri_to_path(&self, uri: &str) -> Option<PathBuf> {
        if !uri.starts_with("file://") {
            return None;
        }

        let path_str = uri.get(7..)?; // Remove "file://"

        #[cfg(windows)]
        let path_str = if path_str.starts_with('/') && path_str.chars().nth(2) == Some(':') {
            path_str.get(1..)? // Remove leading / for Windows paths like /C:/
        } else {
            path_str
        };

        let decoded = urlencoding::decode(path_str).ok()?;
        Some(PathBuf::from(decoded.into_owned()))
    }

    /// Convert local path to file:// URI
    fn path_to_uri(&self, path: &Path) -> String {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir().unwrap_or_default().join(path)
        };

        let path_str = absolute.to_string_lossy();

        #[cfg(windows)]
        let uri = format!("file:///{}", path_str.replace('\\', "/"));

        #[cfg(not(windows))]
        let uri = format!("file://{}", path_str);

        uri
    }

    /// Check if a path is within any root
    pub async fn is_path_in_roots(&self, path: &Path) -> bool {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir().unwrap_or_default().join(path)
        };

        for root in self.roots.read().await.values() {
            if let Some(ref root_path) = root.absolute_path {
                if self.is_path_in_root(&absolute, root_path) {
                    return true;
                }
            }
        }
        false
    }

    /// Check if a path is within a specific root
    fn is_path_in_root(&self, path: &Path, root_path: &Path) -> bool {
        let normalized_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let normalized_root = root_path
            .canonicalize()
            .unwrap_or_else(|_| root_path.to_path_buf());
        normalized_path.starts_with(&normalized_root)
    }

    /// Get the root that contains a path
    pub async fn get_root_for_path(&self, path: &Path) -> Option<RootInfo> {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir().unwrap_or_default().join(path)
        };

        for root in self.roots.read().await.values() {
            if let Some(ref root_path) = root.absolute_path {
                if self.is_path_in_root(&absolute, root_path) {
                    return Some(root.clone());
                }
            }
        }
        None
    }

    /// Add a root from a local path
    pub async fn add_root_from_path(
        &self,
        path: &Path,
        name: Option<String>,
    ) -> Result<RootInfo, &'static str> {
        if !self.allow_dynamic_roots {
            return Err("Dynamic roots are not allowed");
        }

        let uri = self.path_to_uri(path);
        let root = Root { uri, name };
        Ok(self.add_root(root).await)
    }

    /// Add the current working directory as a root
    pub async fn add_cwd_root(&self, name: Option<String>) -> Result<RootInfo, &'static str> {
        let cwd = std::env::current_dir().map_err(|_| "Could not get current directory")?;
        self.add_root_from_path(&cwd, name.or(Some("Current Directory".to_string())))
            .await
    }

    /// Add home directory as a root
    pub async fn add_home_root(&self, name: Option<String>) -> Result<RootInfo, &'static str> {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        self.add_root_from_path(&home, name.or(Some("Home Directory".to_string())))
            .await
    }

    /// Get statistics about roots
    pub async fn get_stats(&self) -> RootsStats {
        let roots = self.get_roots().await;
        RootsStats {
            total_roots: roots.len(),
            existing_roots: roots.iter().filter(|r| r.exists).count(),
            readable_roots: roots
                .iter()
                .filter(|r| r.permissions.map(|p| p.read).unwrap_or(false))
                .count(),
            writable_roots: roots
                .iter()
                .filter(|r| r.permissions.map(|p| p.write).unwrap_or(false))
                .count(),
            allow_dynamic_roots: self.allow_dynamic_roots,
            validate_paths: self.validate_paths,
        }
    }

    /// Refresh root information
    pub async fn refresh_roots(&self) {
        let roots: Vec<_> = self.roots.read().await.values().cloned().collect();
        let count = roots.len();

        for root in roots {
            let refreshed = self.parse_root(&Root {
                uri: root.uri.clone(),
                name: root.name.clone(),
            });
            self.roots.write().await.insert(root.uri, refreshed);
        }

        let _ = self.event_sender.send(RootEvent::RootsRefreshed { count });
    }
}

impl Default for McpRootsManager {
    fn default() -> Self {
        Self::new(RootsConfig::default())
    }
}

/// Roots statistics
#[derive(Debug, Clone)]
pub struct RootsStats {
    /// Total number of roots
    pub total_roots: usize,
    /// Roots that exist
    pub existing_roots: usize,
    /// Roots that are readable
    pub readable_roots: usize,
    /// Roots that are writable
    pub writable_roots: usize,
    /// Whether dynamic roots are allowed
    pub allow_dynamic_roots: bool,
    /// Whether paths are validated
    pub validate_paths: bool,
}

/// Create a root from a file path
pub fn create_root_from_path(path: &Path, name: Option<String>) -> Root {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };

    #[cfg(windows)]
    let uri = format!("file:///{}", absolute.to_string_lossy().replace('\\', "/"));

    #[cfg(not(windows))]
    let uri = format!("file://{}", absolute.to_string_lossy());

    Root { uri, name }
}

/// Get default roots configuration
pub fn get_default_roots_config() -> RootsConfig {
    let cwd = std::env::current_dir().unwrap_or_default();
    RootsConfig {
        roots: vec![create_root_from_path(
            &cwd,
            Some("Current Directory".to_string()),
        )],
        allow_dynamic_roots: true,
        validate_paths: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_root_creation() {
        let root = Root {
            uri: "file:///tmp/test".to_string(),
            name: Some("Test Root".to_string()),
        };
        assert_eq!(root.uri, "file:///tmp/test");
        assert_eq!(root.name, Some("Test Root".to_string()));
    }

    #[test]
    fn test_create_root_from_path() {
        let path = PathBuf::from("/tmp/test");
        let root = create_root_from_path(&path, Some("Test".to_string()));
        assert!(root.uri.starts_with("file://"));
        assert!(root.uri.contains("tmp"));
    }

    #[tokio::test]
    async fn test_manager_add_root() {
        let manager = McpRootsManager::default();
        let root = Root {
            uri: "file:///tmp/test".to_string(),
            name: Some("Test".to_string()),
        };

        let info = manager.add_root(root).await;
        assert_eq!(info.uri, "file:///tmp/test");
        assert!(manager.has_root("file:///tmp/test").await);
    }

    #[tokio::test]
    async fn test_manager_remove_root() {
        let manager = McpRootsManager::default();
        let root = Root {
            uri: "file:///tmp/test".to_string(),
            name: None,
        };

        manager.add_root(root).await;
        assert!(manager.has_root("file:///tmp/test").await);

        manager.remove_root("file:///tmp/test").await;
        assert!(!manager.has_root("file:///tmp/test").await);
    }

    #[tokio::test]
    async fn test_manager_get_roots() {
        let manager = McpRootsManager::default();

        manager
            .add_root(Root {
                uri: "file:///tmp/a".to_string(),
                name: None,
            })
            .await;
        manager
            .add_root(Root {
                uri: "file:///tmp/b".to_string(),
                name: None,
            })
            .await;

        let roots = manager.get_roots().await;
        assert_eq!(roots.len(), 2);
    }

    #[tokio::test]
    async fn test_manager_clear_roots() {
        let manager = McpRootsManager::default();

        manager
            .add_root(Root {
                uri: "file:///tmp/a".to_string(),
                name: None,
            })
            .await;
        manager
            .add_root(Root {
                uri: "file:///tmp/b".to_string(),
                name: None,
            })
            .await;

        manager.clear_roots().await;
        assert!(manager.get_roots().await.is_empty());
    }

    #[tokio::test]
    async fn test_get_roots_for_protocol() {
        let manager = McpRootsManager::default();

        manager
            .add_root(Root {
                uri: "file:///tmp/test".to_string(),
                name: Some("Test".to_string()),
            })
            .await;

        let roots = manager.get_roots_for_protocol().await;
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].uri, "file:///tmp/test");
        assert_eq!(roots[0].name, Some("Test".to_string()));
    }

    #[tokio::test]
    async fn test_get_stats() {
        let manager = McpRootsManager::default();

        manager
            .add_root(Root {
                uri: "file:///tmp/a".to_string(),
                name: None,
            })
            .await;
        manager
            .add_root(Root {
                uri: "file:///tmp/b".to_string(),
                name: None,
            })
            .await;

        let stats = manager.get_stats().await;
        assert_eq!(stats.total_roots, 2);
        assert!(stats.allow_dynamic_roots);
        assert!(stats.validate_paths);
    }

    #[test]
    fn test_get_default_roots_config() {
        let config = get_default_roots_config();
        assert!(!config.roots.is_empty());
        assert!(config.allow_dynamic_roots);
        assert!(config.validate_paths);
    }
}
