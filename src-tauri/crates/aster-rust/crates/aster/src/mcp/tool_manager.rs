//! MCP Tool Manager
//!
//! This module implements the tool manager for MCP servers.
//! It handles tool discovery, caching, argument validation, and tool invocation.
//!
//! # Features
//!
//! - Tool discovery and caching from connected servers
//! - JSON Schema argument validation
//! - Tool invocation with timeout support
//! - Call tracking and cancellation
//! - Batch tool calls with parallel execution
//! - Result format conversion
//!
//! # Requirements Coverage
//!
//! - 4.1: Tool caching from connected servers
//! - 4.2: Argument validation against input schema
//! - 4.3: Descriptive error on validation failure
//! - 4.4: Batch tool calls for parallel execution
//! - 4.5: Tool call cancellation support
//! - 4.6: Pending call tracking with unique IDs
//! - 4.7: Tool call timeout handling
//! - 4.8: MCP result to standardized format conversion

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::mcp::connection_manager::ConnectionManager;
use crate::mcp::error::{McpError, McpResult};
use crate::mcp::transport::McpRequest;
use crate::mcp::types::JsonObject;

/// MCP tool definition
///
/// Represents a tool exposed by an MCP server, including its name,
/// description, and input schema for argument validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    /// Tool name (unique within a server)
    pub name: String,
    /// Human-readable description
    pub description: Option<String>,
    /// JSON Schema for input validation
    pub input_schema: serde_json::Value,
    /// Server name that provides this tool
    pub server_name: String,
}

impl McpTool {
    /// Create a new MCP tool
    pub fn new(
        name: impl Into<String>,
        server_name: impl Into<String>,
        input_schema: serde_json::Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: None,
            input_schema,
            server_name: server_name.into(),
        }
    }

    /// Create a new MCP tool with description
    pub fn with_description(
        name: impl Into<String>,
        server_name: impl Into<String>,
        description: impl Into<String>,
        input_schema: serde_json::Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: Some(description.into()),
            input_schema,
            server_name: server_name.into(),
        }
    }
}

/// Tool result content types
///
/// MCP tools can return different types of content in their results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ToolResultContent {
    /// Text content
    Text {
        /// The text content
        text: String,
    },
    /// Image content (base64 encoded)
    Image {
        /// Base64 encoded image data
        data: String,
        /// MIME type (e.g., "image/png")
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    /// Resource reference
    Resource {
        /// Resource URI
        uri: String,
        /// Optional text content
        text: Option<String>,
        /// Optional binary data (base64)
        #[serde(rename = "blob")]
        data: Option<String>,
        /// MIME type
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
    },
}

impl ToolResultContent {
    /// Create text content
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    /// Create image content
    pub fn image(data: impl Into<String>, mime_type: impl Into<String>) -> Self {
        Self::Image {
            data: data.into(),
            mime_type: mime_type.into(),
        }
    }

    /// Create resource content
    pub fn resource(uri: impl Into<String>) -> Self {
        Self::Resource {
            uri: uri.into(),
            text: None,
            data: None,
            mime_type: None,
        }
    }
}

/// Tool call result
///
/// Represents the result of a tool invocation, containing the content
/// and an error flag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    /// Result content (can be multiple items)
    pub content: Vec<ToolResultContent>,
    /// Whether the result represents an error
    #[serde(rename = "isError", default)]
    pub is_error: bool,
}

impl ToolCallResult {
    /// Create a successful result with text content
    pub fn success_text(text: impl Into<String>) -> Self {
        Self {
            content: vec![ToolResultContent::text(text)],
            is_error: false,
        }
    }

    /// Create a successful result with multiple content items
    pub fn success(content: Vec<ToolResultContent>) -> Self {
        Self {
            content,
            is_error: false,
        }
    }

    /// Create an error result
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            content: vec![ToolResultContent::text(message)],
            is_error: true,
        }
    }

    /// Check if the result is empty
    pub fn is_empty(&self) -> bool {
        self.content.is_empty()
    }

    /// Get the first text content if available
    pub fn first_text(&self) -> Option<&str> {
        self.content.iter().find_map(|c| match c {
            ToolResultContent::Text { text } => Some(text.as_str()),
            _ => None,
        })
    }
}

/// Argument validation result
///
/// Contains the validation status and any errors found.
#[derive(Debug, Clone, Default)]
pub struct ArgValidationResult {
    /// Whether the arguments are valid
    pub valid: bool,
    /// Validation error messages
    pub errors: Vec<String>,
}

impl ArgValidationResult {
    /// Create a valid result
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
        }
    }

    /// Create an invalid result with errors
    pub fn invalid(errors: Vec<String>) -> Self {
        Self {
            valid: false,
            errors,
        }
    }

    /// Add an error
    pub fn add_error(&mut self, error: impl Into<String>) {
        self.valid = false;
        self.errors.push(error.into());
    }
}

/// Call information for tracking pending calls
///
/// Tracks the state of an in-progress tool call for monitoring
/// and cancellation purposes.
#[derive(Debug, Clone)]
pub struct CallInfo {
    /// Unique call ID
    pub call_id: String,
    /// Server name
    pub server_name: String,
    /// Tool name
    pub tool_name: String,
    /// Call arguments
    pub args: JsonObject,
    /// Call start time
    pub start_time: DateTime<Utc>,
    /// Whether the call has completed
    pub completed: bool,
    /// Whether the call was cancelled
    pub cancelled: bool,
}

impl CallInfo {
    /// Create a new call info
    pub fn new(
        call_id: impl Into<String>,
        server_name: impl Into<String>,
        tool_name: impl Into<String>,
        args: JsonObject,
    ) -> Self {
        Self {
            call_id: call_id.into(),
            server_name: server_name.into(),
            tool_name: tool_name.into(),
            args,
            start_time: Utc::now(),
            completed: false,
            cancelled: false,
        }
    }

    /// Mark the call as completed
    pub fn mark_completed(&mut self) {
        self.completed = true;
    }

    /// Mark the call as cancelled
    pub fn mark_cancelled(&mut self) {
        self.cancelled = true;
    }

    /// Get the elapsed time since the call started
    pub fn elapsed(&self) -> chrono::Duration {
        Utc::now() - self.start_time
    }
}

/// Tool call definition for batch operations
///
/// Defines a single tool call in a batch operation.
#[derive(Debug, Clone)]
pub struct ToolCall {
    /// Server name
    pub server_name: String,
    /// Tool name
    pub tool_name: String,
    /// Call arguments
    pub args: JsonObject,
}

impl ToolCall {
    /// Create a new tool call
    pub fn new(
        server_name: impl Into<String>,
        tool_name: impl Into<String>,
        args: JsonObject,
    ) -> Self {
        Self {
            server_name: server_name.into(),
            tool_name: tool_name.into(),
            args,
        }
    }
}

/// Tool manager trait
///
/// Defines the interface for managing MCP tools, including discovery,
/// caching, validation, and invocation.
#[async_trait]
pub trait ToolManager: Send + Sync {
    /// List all available tools from connected servers
    ///
    /// If `server_name` is provided, only lists tools from that server.
    /// Results are cached for subsequent calls.
    async fn list_tools(&self, server_name: Option<&str>) -> McpResult<Vec<McpTool>>;

    /// Get a specific tool by server and name
    ///
    /// Returns the cached tool definition if available.
    async fn get_tool(&self, server_name: &str, tool_name: &str) -> McpResult<Option<McpTool>>;

    /// Clear the tool cache
    ///
    /// If `server_name` is provided, only clears cache for that server.
    fn clear_cache(&self, server_name: Option<&str>);

    /// Call a tool on a server
    ///
    /// Validates arguments before calling and tracks the call.
    async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        args: JsonObject,
    ) -> McpResult<ToolCallResult>;

    /// Call a tool with a timeout
    ///
    /// Returns an error if the call doesn't complete within the timeout.
    async fn call_tool_with_timeout(
        &self,
        server_name: &str,
        tool_name: &str,
        args: JsonObject,
        timeout: Duration,
    ) -> McpResult<ToolCallResult>;

    /// Validate tool arguments against the schema
    ///
    /// Returns validation result without making the actual call.
    fn validate_args(&self, tool: &McpTool, args: &JsonObject) -> ArgValidationResult;

    /// Cancel a pending tool call
    ///
    /// Sends a cancellation notification to the server.
    fn cancel_call(&self, call_id: &str);

    /// Get all pending (in-progress) calls
    fn get_pending_calls(&self) -> Vec<CallInfo>;

    /// Execute multiple tool calls in parallel
    ///
    /// Returns results in the same order as the input calls.
    async fn call_tools_batch(&self, calls: Vec<ToolCall>) -> Vec<McpResult<ToolCallResult>>;
}

/// Tool cache entry
struct ToolCacheEntry {
    /// Cached tools
    tools: Vec<McpTool>,
    /// Cache timestamp
    cached_at: DateTime<Utc>,
}

/// Default implementation of the tool manager
pub struct McpToolManager<C: ConnectionManager> {
    /// Connection manager for sending requests
    connection_manager: Arc<C>,
    /// Tool cache by server name
    tool_cache: Arc<RwLock<HashMap<String, ToolCacheEntry>>>,
    /// Pending calls by call ID
    pending_calls: Arc<RwLock<HashMap<String, CallInfo>>>,
    /// Call ID counter for unique ID generation
    call_counter: AtomicU64,
    /// Default timeout for tool calls
    default_timeout: Duration,
    /// Cache TTL (time-to-live)
    cache_ttl: Duration,
}

impl<C: ConnectionManager> McpToolManager<C> {
    /// Create a new tool manager
    pub fn new(connection_manager: Arc<C>) -> Self {
        Self {
            connection_manager,
            tool_cache: Arc::new(RwLock::new(HashMap::new())),
            pending_calls: Arc::new(RwLock::new(HashMap::new())),
            call_counter: AtomicU64::new(1),
            default_timeout: Duration::from_secs(30),
            cache_ttl: Duration::from_secs(300), // 5 minutes
        }
    }

    /// Create a new tool manager with custom settings
    pub fn with_settings(
        connection_manager: Arc<C>,
        default_timeout: Duration,
        cache_ttl: Duration,
    ) -> Self {
        Self {
            connection_manager,
            tool_cache: Arc::new(RwLock::new(HashMap::new())),
            pending_calls: Arc::new(RwLock::new(HashMap::new())),
            call_counter: AtomicU64::new(1),
            default_timeout,
            cache_ttl,
        }
    }

    /// Generate a unique call ID
    pub fn generate_call_id(&self) -> String {
        let counter = self.call_counter.fetch_add(1, Ordering::SeqCst);
        format!("call-{}-{}", Uuid::new_v4(), counter)
    }

    /// Check if cache is valid for a server
    fn is_cache_valid(&self, entry: &ToolCacheEntry) -> bool {
        let age = Utc::now() - entry.cached_at;
        age.num_seconds() < self.cache_ttl.as_secs() as i64
    }

    /// Fetch tools from a server (bypassing cache)
    async fn fetch_tools_from_server(&self, server_name: &str) -> McpResult<Vec<McpTool>> {
        // Get connection for the server
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Send tools/list request
        let request = McpRequest::new(
            serde_json::json!(format!("tools-list-{}", Uuid::new_v4())),
            "tools/list",
        );

        let response = self
            .connection_manager
            .send(&connection.id, request)
            .await?;

        // Parse response
        let result = response.into_result()?;

        // Extract tools from response
        let tools_value = result
            .get("tools")
            .ok_or_else(|| McpError::protocol("Response missing 'tools' field"))?;

        let raw_tools: Vec<serde_json::Value> = serde_json::from_value(tools_value.clone())
            .map_err(|e| McpError::protocol(format!("Failed to parse tools: {}", e)))?;

        // Convert to McpTool
        let tools: Vec<McpTool> = raw_tools
            .into_iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?.to_string();
                let description = t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(String::from);
                let input_schema = t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));

                Some(McpTool {
                    name,
                    description,
                    input_schema,
                    server_name: server_name.to_string(),
                })
            })
            .collect();

        Ok(tools)
    }

    /// Register a pending call
    async fn register_call(&self, call_info: CallInfo) {
        let mut calls = self.pending_calls.write().await;
        calls.insert(call_info.call_id.clone(), call_info);
    }

    /// Complete a pending call
    async fn complete_call(&self, call_id: &str) {
        let mut calls = self.pending_calls.write().await;
        if let Some(info) = calls.get_mut(call_id) {
            info.mark_completed();
        }
        calls.remove(call_id);
    }

    /// Convert MCP tool result to standardized format
    ///
    /// This handles the conversion from raw MCP response to ToolCallResult.
    fn convert_result(&self, result: serde_json::Value) -> McpResult<ToolCallResult> {
        // Check if result has content array
        if let Some(content) = result.get("content") {
            let content_items: Vec<ToolResultContent> = serde_json::from_value(content.clone())
                .map_err(|e| {
                    McpError::protocol(format!("Failed to parse tool result content: {}", e))
                })?;

            let is_error = result
                .get("isError")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            return Ok(ToolCallResult {
                content: content_items,
                is_error,
            });
        }

        // Handle legacy format or simple text response
        if let Some(text) = result.as_str() {
            return Ok(ToolCallResult::success_text(text));
        }

        // Return the raw result as JSON text
        Ok(ToolCallResult::success_text(result.to_string()))
    }
}

#[async_trait]
impl<C: ConnectionManager + 'static> ToolManager for McpToolManager<C> {
    async fn list_tools(&self, server_name: Option<&str>) -> McpResult<Vec<McpTool>> {
        match server_name {
            Some(name) => {
                // Check cache first
                {
                    let cache = self.tool_cache.read().await;
                    if let Some(entry) = cache.get(name) {
                        if self.is_cache_valid(entry) {
                            return Ok(entry.tools.clone());
                        }
                    }
                }

                // Fetch from server
                let tools = self.fetch_tools_from_server(name).await?;

                // Update cache
                {
                    let mut cache = self.tool_cache.write().await;
                    cache.insert(
                        name.to_string(),
                        ToolCacheEntry {
                            tools: tools.clone(),
                            cached_at: Utc::now(),
                        },
                    );
                }

                Ok(tools)
            }
            None => {
                // List tools from all connected servers
                let connections = self.connection_manager.get_all_connections();
                let mut all_tools = Vec::new();

                for conn in connections {
                    match self.list_tools(Some(&conn.server_name)).await {
                        Ok(tools) => all_tools.extend(tools),
                        Err(e) => {
                            tracing::warn!(
                                "Failed to list tools from server {}: {}",
                                conn.server_name,
                                e
                            );
                        }
                    }
                }

                Ok(all_tools)
            }
        }
    }

    async fn get_tool(&self, server_name: &str, tool_name: &str) -> McpResult<Option<McpTool>> {
        let tools = self.list_tools(Some(server_name)).await?;
        Ok(tools.into_iter().find(|t| t.name == tool_name))
    }

    fn clear_cache(&self, server_name: Option<&str>) {
        // Convert to owned string for async move
        let server_name_owned = server_name.map(|s| s.to_string());
        let cache = self.tool_cache.clone();
        tokio::spawn(async move {
            let mut cache = cache.write().await;
            match server_name_owned {
                Some(name) => {
                    cache.remove(&name);
                }
                None => {
                    cache.clear();
                }
            }
        });
    }

    async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        args: JsonObject,
    ) -> McpResult<ToolCallResult> {
        self.call_tool_with_timeout(server_name, tool_name, args, self.default_timeout)
            .await
    }

    async fn call_tool_with_timeout(
        &self,
        server_name: &str,
        tool_name: &str,
        args: JsonObject,
        timeout: Duration,
    ) -> McpResult<ToolCallResult> {
        // Get the tool definition for validation
        let tool = self
            .get_tool(server_name, tool_name)
            .await?
            .ok_or_else(|| {
                McpError::tool(
                    format!("Tool not found: {}/{}", server_name, tool_name),
                    Some(tool_name.to_string()),
                )
            })?;

        // Validate arguments
        let validation = self.validate_args(&tool, &args);
        if !validation.valid {
            return Err(McpError::validation(
                format!(
                    "Invalid arguments for tool {}: {}",
                    tool_name,
                    validation.errors.join(", ")
                ),
                validation.errors,
            ));
        }

        // Get connection
        let connection = self
            .connection_manager
            .get_connection_by_server(server_name)
            .ok_or_else(|| {
                McpError::connection(format!("No connection found for server: {}", server_name))
            })?;

        // Generate call ID and register
        let call_id = self.generate_call_id();
        let call_info = CallInfo::new(&call_id, server_name, tool_name, args.clone());
        self.register_call(call_info).await;

        // Build request
        let request = McpRequest::with_params(
            serde_json::json!(call_id.clone()),
            "tools/call",
            serde_json::json!({
                "name": tool_name,
                "arguments": args
            }),
        );

        // Send request with timeout
        let result = self
            .connection_manager
            .send_with_timeout(&connection.id, request, timeout)
            .await;

        // Complete the call
        self.complete_call(&call_id).await;

        // Handle result
        match result {
            Ok(response) => {
                let result_value = response.into_result()?;
                self.convert_result(result_value)
            }
            Err(e) => Err(e),
        }
    }

    fn validate_args(&self, tool: &McpTool, args: &JsonObject) -> ArgValidationResult {
        let schema = &tool.input_schema;

        // If no schema or empty schema, accept any args
        if schema.is_null()
            || (schema.is_object() && schema.as_object().is_none_or(|o| o.is_empty()))
        {
            return ArgValidationResult::valid();
        }

        let mut result = ArgValidationResult::valid();

        // Check required properties
        if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
            for req in required {
                if let Some(field_name) = req.as_str() {
                    if !args.contains_key(field_name) {
                        result.add_error(format!("Missing required field: {}", field_name));
                    }
                }
            }
        }

        // Check property types if properties are defined
        if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
            for (key, value) in args.iter() {
                if let Some(prop_schema) = properties.get(key) {
                    // Validate type
                    if let Some(expected_type) = prop_schema.get("type").and_then(|t| t.as_str()) {
                        let actual_type = get_json_type(value);
                        if !types_compatible(expected_type, &actual_type) {
                            result.add_error(format!(
                                "Field '{}' has wrong type: expected {}, got {}",
                                key, expected_type, actual_type
                            ));
                        }
                    }
                }
            }
        }

        // Check for additional properties if not allowed
        if let Some(additional) = schema.get("additionalProperties") {
            if additional == &serde_json::Value::Bool(false) {
                if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
                    for key in args.keys() {
                        if !properties.contains_key(key) {
                            result.add_error(format!("Unknown field: {}", key));
                        }
                    }
                }
            }
        }

        result
    }

    fn cancel_call(&self, call_id: &str) {
        let pending_calls = self.pending_calls.clone();
        let connection_manager = self.connection_manager.clone();
        let call_id = call_id.to_string();

        tokio::spawn(async move {
            let mut calls = pending_calls.write().await;
            if let Some(info) = calls.get_mut(&call_id) {
                info.mark_cancelled();

                // Send cancellation to server
                if let Some(conn) = connection_manager.get_connection_by_server(&info.server_name) {
                    let _ = connection_manager.cancel_request(&conn.id, &call_id).await;
                }
            }
        });
    }

    fn get_pending_calls(&self) -> Vec<CallInfo> {
        // Use try_read to avoid blocking
        self.pending_calls
            .try_read()
            .map(|calls| calls.values().cloned().collect())
            .unwrap_or_default()
    }

    async fn call_tools_batch(&self, calls: Vec<ToolCall>) -> Vec<McpResult<ToolCallResult>> {
        use futures::future::join_all;

        let futures: Vec<_> = calls
            .into_iter()
            .map(|call| {
                let server_name = call.server_name.clone();
                let tool_name = call.tool_name.clone();
                let args = call.args;
                async move { self.call_tool(&server_name, &tool_name, args).await }
            })
            .collect();

        join_all(futures).await
    }
}

/// Get the JSON type name for a value
fn get_json_type(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                "integer".to_string()
            } else {
                "number".to_string()
            }
        }
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "object".to_string(),
    }
}

/// Check if types are compatible
fn types_compatible(expected: &str, actual: &str) -> bool {
    if expected == actual {
        return true;
    }
    // number accepts integer
    if expected == "number" && actual == "integer" {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_tool_new() {
        let tool = McpTool::new("test_tool", "test_server", serde_json::json!({}));
        assert_eq!(tool.name, "test_tool");
        assert_eq!(tool.server_name, "test_server");
        assert!(tool.description.is_none());
    }

    #[test]
    fn test_mcp_tool_with_description() {
        let tool = McpTool::with_description(
            "test_tool",
            "test_server",
            "A test tool",
            serde_json::json!({}),
        );
        assert_eq!(tool.description, Some("A test tool".to_string()));
    }

    #[test]
    fn test_tool_result_content_text() {
        let content = ToolResultContent::text("Hello, world!");
        match content {
            ToolResultContent::Text { text } => assert_eq!(text, "Hello, world!"),
            _ => panic!("Expected Text content"),
        }
    }

    #[test]
    fn test_tool_result_content_image() {
        let content = ToolResultContent::image("base64data", "image/png");
        match content {
            ToolResultContent::Image { data, mime_type } => {
                assert_eq!(data, "base64data");
                assert_eq!(mime_type, "image/png");
            }
            _ => panic!("Expected Image content"),
        }
    }

    #[test]
    fn test_tool_call_result_success() {
        let result = ToolCallResult::success_text("Success!");
        assert!(!result.is_error);
        assert_eq!(result.first_text(), Some("Success!"));
    }

    #[test]
    fn test_tool_call_result_error() {
        let result = ToolCallResult::error("Something went wrong");
        assert!(result.is_error);
        assert_eq!(result.first_text(), Some("Something went wrong"));
    }

    #[test]
    fn test_arg_validation_result_valid() {
        let result = ArgValidationResult::valid();
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_arg_validation_result_invalid() {
        let result = ArgValidationResult::invalid(vec!["Missing field".to_string()]);
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
    }

    #[test]
    fn test_call_info_new() {
        let args = serde_json::Map::new();
        let info = CallInfo::new("call-1", "server", "tool", args);
        assert_eq!(info.call_id, "call-1");
        assert_eq!(info.server_name, "server");
        assert_eq!(info.tool_name, "tool");
        assert!(!info.completed);
        assert!(!info.cancelled);
    }

    #[test]
    fn test_call_info_mark_completed() {
        let args = serde_json::Map::new();
        let mut info = CallInfo::new("call-1", "server", "tool", args);
        info.mark_completed();
        assert!(info.completed);
    }

    #[test]
    fn test_call_info_mark_cancelled() {
        let args = serde_json::Map::new();
        let mut info = CallInfo::new("call-1", "server", "tool", args);
        info.mark_cancelled();
        assert!(info.cancelled);
    }

    #[test]
    fn test_tool_call_new() {
        let args = serde_json::Map::new();
        let call = ToolCall::new("server", "tool", args);
        assert_eq!(call.server_name, "server");
        assert_eq!(call.tool_name, "tool");
    }

    #[test]
    fn test_get_json_type() {
        assert_eq!(get_json_type(&serde_json::Value::Null), "null");
        assert_eq!(get_json_type(&serde_json::json!(true)), "boolean");
        assert_eq!(get_json_type(&serde_json::json!(42)), "integer");
        assert_eq!(get_json_type(&serde_json::json!(3.15)), "number");
        assert_eq!(get_json_type(&serde_json::json!("hello")), "string");
        assert_eq!(get_json_type(&serde_json::json!([1, 2, 3])), "array");
        assert_eq!(
            get_json_type(&serde_json::json!({"key": "value"})),
            "object"
        );
    }

    #[test]
    fn test_types_compatible() {
        assert!(types_compatible("string", "string"));
        assert!(types_compatible("number", "integer"));
        assert!(!types_compatible("string", "number"));
        assert!(!types_compatible("integer", "number"));
    }
}
