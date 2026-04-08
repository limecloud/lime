//! MCP Resource Manager
//!
//! This module implements the resource manager for MCP servers.
//! It handles resource discovery, reading, caching, subscriptions, and URI templates.
//!
//! # Features
//!
//! - Resource listing from connected servers
//! - Resource content reading by URI
//! - Resource subscriptions for change notifications
//! - Resource caching with configurable TTL
//! - URI template parsing and expansion
//!
//! # Requirements Coverage
//!
//! - 5.1: List available resources from connected servers
//! - 5.2: Read resource content by URI
//! - 5.3: Support resource subscriptions for change notifications
//! - 5.4: Emit notification events when subscribed resources change
//! - 5.5: Cache resource content with configurable TTL
//! - 5.6: Support resource templates for parameterized URIs

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::mcp::connection_manager::ConnectionManager;
use crate::mcp::error::{McpError, McpResult};
use crate::mcp::transport::McpRequest;

/// MCP resource definition
///
/// Represents a resource exposed by an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    /// Resource URI (unique identifier)
    pub uri: String,
    /// Human-readable name
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// MIME type of the resource content
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    /// Server name that provides this resource
    pub server_name: String,
}

impl McpResource {
    /// Create a new MCP resource
    pub fn new(
        uri: impl Into<String>,
        name: impl Into<String>,
        server_name: impl Into<String>,
    ) -> Self {
        Self {
            uri: uri.into(),
            name: name.into(),
            description: None,
            mime_type: None,
            server_name: server_name.into(),
        }
    }

    /// Create a new MCP resource with all fields
    pub fn with_details(
        uri: impl Into<String>,
        name: impl Into<String>,
        server_name: impl Into<String>,
        description: Option<String>,
        mime_type: Option<String>,
    ) -> Self {
        Self {
            uri: uri.into(),
            name: name.into(),
            description,
            mime_type,
            server_name: server_name.into(),
        }
    }
}

/// MCP resource template definition
///
/// Represents a URI template for parameterized resource access.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResourceTemplate {
    /// URI template pattern (e.g., "file:///{path}")
    #[serde(rename = "uriTemplate")]
    pub uri_template: String,
    /// Human-readable name
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// MIME type of the resource content
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    /// Server name that provides this template
    pub server_name: String,
}

impl McpResourceTemplate {
    /// Create a new resource template
    pub fn new(
        uri_template: impl Into<String>,
        name: impl Into<String>,
        server_name: impl Into<String>,
    ) -> Self {
        Self {
            uri_template: uri_template.into(),
            name: name.into(),
            description: None,
            mime_type: None,
            server_name: server_name.into(),
        }
    }

    /// Expand the template with the given parameters
    ///
    /// Replaces placeholders like `{param}` with values from the params map.
    pub fn expand(&self, params: &HashMap<String, String>) -> String {
        let mut result = self.uri_template.clone();
        for (key, value) in params {
            let placeholder = format!("{{{}}}", key);
            result = result.replace(&placeholder, value);
        }
        result
    }

    /// Get the parameter names from the template
    pub fn get_parameters(&self) -> Vec<String> {
        let mut params = Vec::new();
        let mut chars = self.uri_template.chars().peekable();

        while let Some(c) = chars.next() {
            if c == '{' {
                let mut param = String::new();
                while let Some(&next) = chars.peek() {
                    if next == '}' {
                        chars.next();
                        break;
                    }
                    param.push(chars.next().unwrap());
                }
                if !param.is_empty() {
                    params.push(param);
                }
            }
        }
        params
    }
}

/// Resource content returned from reading a resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceContent {
    /// Resource URI
    pub uri: String,
    /// Text content (if text-based)
    pub text: Option<String>,
    /// Binary content as base64 (if binary)
    pub blob: Option<String>,
    /// MIME type
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

impl ResourceContent {
    /// Create text content
    pub fn text(uri: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            uri: uri.into(),
            text: Some(text.into()),
            blob: None,
            mime_type: Some("text/plain".to_string()),
        }
    }

    /// Create binary content
    pub fn blob(
        uri: impl Into<String>,
        blob: impl Into<String>,
        mime_type: impl Into<String>,
    ) -> Self {
        Self {
            uri: uri.into(),
            text: None,
            blob: Some(blob.into()),
            mime_type: Some(mime_type.into()),
        }
    }

    /// Check if content is text
    pub fn is_text(&self) -> bool {
        self.text.is_some()
    }

    /// Check if content is binary
    pub fn is_blob(&self) -> bool {
        self.blob.is_some()
    }
}

/// Resource change notification event
#[derive(Debug, Clone)]
pub enum ResourceEvent {
    /// Resource content changed
    Changed { uri: String, server_name: String },
    /// Resource was deleted
    Deleted { uri: String, server_name: String },
    /// Subscription established
    Subscribed { uri: String, server_name: String },
    /// Subscription removed
    Unsubscribed { uri: String, server_name: String },
}

/// Resource cache entry
#[derive(Debug, Clone)]
pub struct ResourceCacheEntry {
    /// Cached content
    pub content: ResourceContent,
    /// Cache timestamp
    pub cached_at: DateTime<Utc>,
    /// TTL for this entry
    pub ttl: Duration,
}

impl ResourceCacheEntry {
    /// Check if the cache entry is still valid
    pub fn is_valid(&self) -> bool {
        let age = Utc::now() - self.cached_at;
        age.num_milliseconds() < self.ttl.as_millis() as i64
    }
}

/// Subscription info
#[derive(Debug, Clone)]
struct SubscriptionInfo {
    /// Resource URI
    uri: String,
    /// Server name
    server_name: String,
    /// Subscription timestamp
    #[allow(dead_code)]
    subscribed_at: DateTime<Utc>,
}

/// Resource manager trait
///
/// Defines the interface for managing MCP resources.
#[async_trait]
pub trait ResourceManager: Send + Sync {
    /// List all available resources from connected servers
    ///
    /// If `server_name` is provided, only lists resources from that server.
    async fn list_resources(&self, server_name: Option<&str>) -> McpResult<Vec<McpResource>>;

    /// List resource templates from connected servers
    async fn list_templates(
        &self,
        server_name: Option<&str>,
    ) -> McpResult<Vec<McpResourceTemplate>>;

    /// Read resource content by URI
    async fn read_resource(&self, server_name: &str, uri: &str) -> McpResult<ResourceContent>;

    /// Read resource content with caching
    ///
    /// Returns cached content if available and not expired.
    async fn read_resource_cached(
        &self,
        server_name: &str,
        uri: &str,
    ) -> McpResult<ResourceContent>;

    /// Subscribe to resource changes
    async fn subscribe(&self, server_name: &str, uri: &str) -> McpResult<()>;

    /// Unsubscribe from resource changes
    async fn unsubscribe(&self, server_name: &str, uri: &str) -> McpResult<()>;

    /// Get all active subscriptions
    fn get_subscriptions(&self) -> Vec<(String, String)>;

    /// Clear the resource cache
    fn clear_cache(&self, server_name: Option<&str>);

    /// Invalidate a specific cached resource
    fn invalidate_cache(&self, uri: &str);

    /// Get event receiver for resource notifications
    fn subscribe_events(&self) -> mpsc::Receiver<ResourceEvent>;

    /// Expand a URI template with parameters
    fn expand_template(
        &self,
        template: &McpResourceTemplate,
        params: &HashMap<String, String>,
    ) -> String;
}

/// Default implementation of the resource manager
pub struct McpResourceManager<C: ConnectionManager> {
    /// Connection manager for sending requests
    connection_manager: Arc<C>,
    /// Resource cache by URI
    cache: Arc<RwLock<HashMap<String, ResourceCacheEntry>>>,
    /// Active subscriptions
    subscriptions: Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
    /// Event channel sender
    event_tx: Arc<RwLock<Option<mpsc::Sender<ResourceEvent>>>>,
    /// Default cache TTL
    default_cache_ttl: Duration,
}

impl<C: ConnectionManager> McpResourceManager<C> {
    /// Create a new resource manager
    pub fn new(connection_manager: Arc<C>) -> Self {
        Self {
            connection_manager,
            cache: Arc::new(RwLock::new(HashMap::new())),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            event_tx: Arc::new(RwLock::new(None)),
            default_cache_ttl: Duration::from_secs(300), // 5 minutes default
        }
    }

    /// Create a new resource manager with custom cache TTL
    pub fn with_cache_ttl(connection_manager: Arc<C>, cache_ttl: Duration) -> Self {
        Self {
            connection_manager,
            cache: Arc::new(RwLock::new(HashMap::new())),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            event_tx: Arc::new(RwLock::new(None)),
            default_cache_ttl: cache_ttl,
        }
    }

    /// Get the default cache TTL
    pub fn cache_ttl(&self) -> Duration {
        self.default_cache_ttl
    }

    /// Set the default cache TTL
    pub fn set_cache_ttl(&mut self, ttl: Duration) {
        self.default_cache_ttl = ttl;
    }

    /// Emit a resource event
    async fn emit_event(&self, event: ResourceEvent) {
        if let Some(tx) = self.event_tx.read().await.as_ref() {
            let _ = tx.send(event).await;
        }
    }

    /// Generate a cache key for a resource
    fn cache_key(server_name: &str, uri: &str) -> String {
        format!("{}:{}", server_name, uri)
    }

    /// Fetch resources from a server (bypassing cache)
    async fn fetch_resources_from_server(&self, server_name: &str) -> McpResult<Vec<McpResource>> {
        // Get connection for the server
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Send resources/list request
        let request = McpRequest::new(
            serde_json::json!(format!("resources-list-{}", Uuid::new_v4())),
            "resources/list",
        );

        let response = self
            .connection_manager
            .send(&connection.id, request)
            .await?;

        // Parse response
        let result = response.into_result()?;

        // Extract resources from response
        let resources_value = result
            .get("resources")
            .ok_or_else(|| McpError::protocol("Response missing 'resources' field"))?;

        let raw_resources: Vec<serde_json::Value> = serde_json::from_value(resources_value.clone())
            .map_err(|e| McpError::protocol(format!("Failed to parse resources: {}", e)))?;

        // Convert to McpResource
        let resources: Vec<McpResource> = raw_resources
            .into_iter()
            .filter_map(|r| {
                let uri = r.get("uri")?.as_str()?.to_string();
                let name = r.get("name")?.as_str()?.to_string();
                let description = r
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(String::from);
                let mime_type = r.get("mimeType").and_then(|m| m.as_str()).map(String::from);

                Some(McpResource {
                    uri,
                    name,
                    description,
                    mime_type,
                    server_name: server_name.to_string(),
                })
            })
            .collect();

        Ok(resources)
    }

    /// Fetch resource templates from a server
    async fn fetch_templates_from_server(
        &self,
        server_name: &str,
    ) -> McpResult<Vec<McpResourceTemplate>> {
        // Get connection for the server
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Send resources/templates/list request
        let request = McpRequest::new(
            serde_json::json!(format!("templates-list-{}", Uuid::new_v4())),
            "resources/templates/list",
        );

        let response = self
            .connection_manager
            .send(&connection.id, request)
            .await?;

        // Parse response
        let result = response.into_result()?;

        // Extract templates from response
        let templates_value = result
            .get("resourceTemplates")
            .ok_or_else(|| McpError::protocol("Response missing 'resourceTemplates' field"))?;

        let raw_templates: Vec<serde_json::Value> = serde_json::from_value(templates_value.clone())
            .map_err(|e| McpError::protocol(format!("Failed to parse templates: {}", e)))?;

        // Convert to McpResourceTemplate
        let templates: Vec<McpResourceTemplate> = raw_templates
            .into_iter()
            .filter_map(|t| {
                let uri_template = t.get("uriTemplate")?.as_str()?.to_string();
                let name = t.get("name")?.as_str()?.to_string();
                let description = t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(String::from);
                let mime_type = t.get("mimeType").and_then(|m| m.as_str()).map(String::from);

                Some(McpResourceTemplate {
                    uri_template,
                    name,
                    description,
                    mime_type,
                    server_name: server_name.to_string(),
                })
            })
            .collect();

        Ok(templates)
    }

    /// Handle resource change notification from server
    pub async fn handle_resource_changed(&self, server_name: &str, uri: &str) {
        // Invalidate cache
        let cache_key = Self::cache_key(server_name, uri);
        {
            let mut cache = self.cache.write().await;
            cache.remove(&cache_key);
        }

        // Emit event
        self.emit_event(ResourceEvent::Changed {
            uri: uri.to_string(),
            server_name: server_name.to_string(),
        })
        .await;
    }
}

#[async_trait]
impl<C: ConnectionManager + 'static> ResourceManager for McpResourceManager<C> {
    async fn list_resources(&self, server_name: Option<&str>) -> McpResult<Vec<McpResource>> {
        match server_name {
            Some(name) => self.fetch_resources_from_server(name).await,
            None => {
                // List resources from all connected servers
                let connections = self.connection_manager.get_all_connections();
                let mut all_resources = Vec::new();

                for conn in connections {
                    match self.fetch_resources_from_server(&conn.server_name).await {
                        Ok(resources) => all_resources.extend(resources),
                        Err(e) => {
                            tracing::warn!(
                                "Failed to list resources from server {}: {}",
                                conn.server_name,
                                e
                            );
                        }
                    }
                }

                Ok(all_resources)
            }
        }
    }

    async fn list_templates(
        &self,
        server_name: Option<&str>,
    ) -> McpResult<Vec<McpResourceTemplate>> {
        match server_name {
            Some(name) => self.fetch_templates_from_server(name).await,
            None => {
                // List templates from all connected servers
                let connections = self.connection_manager.get_all_connections();
                let mut all_templates = Vec::new();

                for conn in connections {
                    match self.fetch_templates_from_server(&conn.server_name).await {
                        Ok(templates) => all_templates.extend(templates),
                        Err(e) => {
                            tracing::warn!(
                                "Failed to list templates from server {}: {}",
                                conn.server_name,
                                e
                            );
                        }
                    }
                }

                Ok(all_templates)
            }
        }
    }

    async fn read_resource(&self, server_name: &str, uri: &str) -> McpResult<ResourceContent> {
        // Get connection for the server
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Send resources/read request
        let request = McpRequest::with_params(
            serde_json::json!(format!("resource-read-{}", Uuid::new_v4())),
            "resources/read",
            serde_json::json!({
                "uri": uri
            }),
        );

        let response = self
            .connection_manager
            .send(&connection.id, request)
            .await?;

        // Parse response
        let result = response.into_result()?;

        // Extract contents from response
        let contents_value = result
            .get("contents")
            .ok_or_else(|| McpError::protocol("Response missing 'contents' field"))?;

        let contents: Vec<serde_json::Value> = serde_json::from_value(contents_value.clone())
            .map_err(|e| McpError::protocol(format!("Failed to parse contents: {}", e)))?;

        // Get the first content item (MCP returns an array)
        let content = contents
            .into_iter()
            .next()
            .ok_or_else(|| McpError::protocol("Empty contents array"))?;

        let resource_uri = content
            .get("uri")
            .and_then(|u| u.as_str())
            .unwrap_or(uri)
            .to_string();
        let text = content
            .get("text")
            .and_then(|t| t.as_str())
            .map(String::from);
        let blob = content
            .get("blob")
            .and_then(|b| b.as_str())
            .map(String::from);
        let mime_type = content
            .get("mimeType")
            .and_then(|m| m.as_str())
            .map(String::from);

        Ok(ResourceContent {
            uri: resource_uri,
            text,
            blob,
            mime_type,
        })
    }

    async fn read_resource_cached(
        &self,
        server_name: &str,
        uri: &str,
    ) -> McpResult<ResourceContent> {
        let cache_key = Self::cache_key(server_name, uri);

        // Check cache first
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                if entry.is_valid() {
                    return Ok(entry.content.clone());
                }
            }
        }

        // Fetch from server
        let content = self.read_resource(server_name, uri).await?;

        // Update cache
        {
            let mut cache = self.cache.write().await;
            cache.insert(
                cache_key,
                ResourceCacheEntry {
                    content: content.clone(),
                    cached_at: Utc::now(),
                    ttl: self.default_cache_ttl,
                },
            );
        }

        Ok(content)
    }

    async fn subscribe(&self, server_name: &str, uri: &str) -> McpResult<()> {
        // Get connection for the server
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Send resources/subscribe request
        let request = McpRequest::with_params(
            serde_json::json!(format!("resource-subscribe-{}", Uuid::new_v4())),
            "resources/subscribe",
            serde_json::json!({
                "uri": uri
            }),
        );

        self.connection_manager
            .send(&connection.id, request)
            .await?
            .into_result()?;

        // Track subscription
        let subscription_key = Self::cache_key(server_name, uri);
        {
            let mut subs = self.subscriptions.write().await;
            subs.insert(
                subscription_key,
                SubscriptionInfo {
                    uri: uri.to_string(),
                    server_name: server_name.to_string(),
                    subscribed_at: Utc::now(),
                },
            );
        }

        // Emit event
        self.emit_event(ResourceEvent::Subscribed {
            uri: uri.to_string(),
            server_name: server_name.to_string(),
        })
        .await;

        Ok(())
    }

    async fn unsubscribe(&self, server_name: &str, uri: &str) -> McpResult<()> {
        // Get connection for the server
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Send resources/unsubscribe request
        let request = McpRequest::with_params(
            serde_json::json!(format!("resource-unsubscribe-{}", Uuid::new_v4())),
            "resources/unsubscribe",
            serde_json::json!({
                "uri": uri
            }),
        );

        self.connection_manager
            .send(&connection.id, request)
            .await?
            .into_result()?;

        // Remove subscription tracking
        let subscription_key = Self::cache_key(server_name, uri);
        {
            let mut subs = self.subscriptions.write().await;
            subs.remove(&subscription_key);
        }

        // Emit event
        self.emit_event(ResourceEvent::Unsubscribed {
            uri: uri.to_string(),
            server_name: server_name.to_string(),
        })
        .await;

        Ok(())
    }

    fn get_subscriptions(&self) -> Vec<(String, String)> {
        self.subscriptions
            .try_read()
            .map(|subs| {
                subs.values()
                    .map(|info| (info.server_name.clone(), info.uri.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn clear_cache(&self, server_name: Option<&str>) {
        let server_name_owned = server_name.map(|s| s.to_string());
        let cache = self.cache.clone();
        tokio::spawn(async move {
            let mut cache = cache.write().await;
            match server_name_owned {
                Some(name) => {
                    let prefix = format!("{}:", name);
                    cache.retain(|k, _| !k.starts_with(&prefix));
                }
                None => {
                    cache.clear();
                }
            }
        });
    }

    fn invalidate_cache(&self, uri: &str) {
        let uri_owned = uri.to_string();
        let cache = self.cache.clone();
        tokio::spawn(async move {
            let mut cache = cache.write().await;
            cache.retain(|k, _| !k.ends_with(&format!(":{}", uri_owned)));
        });
    }

    fn subscribe_events(&self) -> mpsc::Receiver<ResourceEvent> {
        let (tx, rx) = mpsc::channel(100);
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            *event_tx.write().await = Some(tx);
        });
        rx
    }

    fn expand_template(
        &self,
        template: &McpResourceTemplate,
        params: &HashMap<String, String>,
    ) -> String {
        template.expand(params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_resource_new() {
        let resource = McpResource::new("file:///test.txt", "test.txt", "test-server");
        assert_eq!(resource.uri, "file:///test.txt");
        assert_eq!(resource.name, "test.txt");
        assert_eq!(resource.server_name, "test-server");
        assert!(resource.description.is_none());
        assert!(resource.mime_type.is_none());
    }

    #[test]
    fn test_mcp_resource_with_details() {
        let resource = McpResource::with_details(
            "file:///test.txt",
            "test.txt",
            "test-server",
            Some("A test file".to_string()),
            Some("text/plain".to_string()),
        );
        assert_eq!(resource.description, Some("A test file".to_string()));
        assert_eq!(resource.mime_type, Some("text/plain".to_string()));
    }

    #[test]
    fn test_resource_template_new() {
        let template = McpResourceTemplate::new("file:///{path}", "File Template", "test-server");
        assert_eq!(template.uri_template, "file:///{path}");
        assert_eq!(template.name, "File Template");
    }

    #[test]
    fn test_resource_template_expand() {
        let template = McpResourceTemplate::new("file:///{path}", "File Template", "test-server");

        let mut params = HashMap::new();
        params.insert("path".to_string(), "documents/test.txt".to_string());

        let expanded = template.expand(&params);
        assert_eq!(expanded, "file:///documents/test.txt");
    }

    #[test]
    fn test_resource_template_expand_multiple_params() {
        let template = McpResourceTemplate::new(
            "db://{database}/{table}",
            "Database Template",
            "test-server",
        );

        let mut params = HashMap::new();
        params.insert("database".to_string(), "mydb".to_string());
        params.insert("table".to_string(), "users".to_string());

        let expanded = template.expand(&params);
        assert_eq!(expanded, "db://mydb/users");
    }

    #[test]
    fn test_resource_template_get_parameters() {
        let template = McpResourceTemplate::new(
            "db://{database}/{table}?filter={filter}",
            "Database Template",
            "test-server",
        );

        let params = template.get_parameters();
        assert_eq!(params.len(), 3);
        assert!(params.contains(&"database".to_string()));
        assert!(params.contains(&"table".to_string()));
        assert!(params.contains(&"filter".to_string()));
    }

    #[test]
    fn test_resource_template_expand_missing_param() {
        let template = McpResourceTemplate::new("file:///{path}", "File Template", "test-server");

        let params = HashMap::new(); // Empty params

        let expanded = template.expand(&params);
        // Missing params are not replaced
        assert_eq!(expanded, "file:///{path}");
    }

    #[test]
    fn test_resource_content_text() {
        let content = ResourceContent::text("file:///test.txt", "Hello, World!");
        assert!(content.is_text());
        assert!(!content.is_blob());
        assert_eq!(content.text, Some("Hello, World!".to_string()));
        assert_eq!(content.mime_type, Some("text/plain".to_string()));
    }

    #[test]
    fn test_resource_content_blob() {
        let content = ResourceContent::blob("file:///image.png", "base64data", "image/png");
        assert!(!content.is_text());
        assert!(content.is_blob());
        assert_eq!(content.blob, Some("base64data".to_string()));
        assert_eq!(content.mime_type, Some("image/png".to_string()));
    }

    #[test]
    fn test_cache_key_generation() {
        let key =
            McpResourceManager::<crate::mcp::connection_manager::McpConnectionManager>::cache_key(
                "server1",
                "file:///test.txt",
            );
        assert_eq!(key, "server1:file:///test.txt");
    }

    #[test]
    fn test_resource_cache_entry_validity() {
        let entry = ResourceCacheEntry {
            content: ResourceContent::text("file:///test.txt", "content"),
            cached_at: Utc::now(),
            ttl: Duration::from_secs(300),
        };
        assert!(entry.is_valid());

        // Create an expired entry
        let expired_entry = ResourceCacheEntry {
            content: ResourceContent::text("file:///test.txt", "content"),
            cached_at: Utc::now() - chrono::Duration::seconds(400),
            ttl: Duration::from_secs(300),
        };
        assert!(!expired_entry.is_valid());
    }
}
