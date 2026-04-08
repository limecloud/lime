//! MCP 资源工具
//!
//! 对齐当前 MCP 资源工具面：
//! - ListMcpResourcesTool
//! - ReadMcpResourceTool

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use super::registry::ToolRegistry;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rmcp::model::{ErrorCode, ResourceContents};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Weak;
use tokio::fs;
use uuid::Uuid;

use crate::agents::ExtensionManager;

const LIST_MCP_RESOURCES_TOOL_NAME: &str = "ListMcpResourcesTool";
const READ_MCP_RESOURCE_TOOL_NAME: &str = "ReadMcpResourceTool";

#[derive(Debug, Clone, Deserialize)]
struct ListMcpResourcesInput {
    #[serde(default)]
    server: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ReadMcpResourceInput {
    server: String,
    uri: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListedMcpResource {
    uri: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    server: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadMcpResourceOutput {
    contents: Vec<ReadMcpResourceContent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadMcpResourceContent {
    uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    blob_saved_to: Option<String>,
}

pub struct ListMcpResourcesTool {
    extension_manager: Weak<ExtensionManager>,
}

impl ListMcpResourcesTool {
    pub fn new(extension_manager: Weak<ExtensionManager>) -> Self {
        Self { extension_manager }
    }

    fn extension_manager(&self) -> Result<std::sync::Arc<ExtensionManager>, ToolError> {
        self.extension_manager
            .upgrade()
            .ok_or_else(|| ToolError::execution_failed("MCP 资源管理器不可用，无法列出资源"))
    }
}

pub struct ReadMcpResourceTool {
    extension_manager: Weak<ExtensionManager>,
}

impl ReadMcpResourceTool {
    pub fn new(extension_manager: Weak<ExtensionManager>) -> Self {
        Self { extension_manager }
    }

    fn extension_manager(&self) -> Result<std::sync::Arc<ExtensionManager>, ToolError> {
        self.extension_manager
            .upgrade()
            .ok_or_else(|| ToolError::execution_failed("MCP 资源管理器不可用，无法读取资源"))
    }
}

fn map_extension_error(error: rmcp::model::ErrorData) -> ToolError {
    match error.code {
        ErrorCode::INVALID_PARAMS => ToolError::invalid_params(error.message.to_string()),
        ErrorCode::RESOURCE_NOT_FOUND => ToolError::not_found(error.message.to_string()),
        _ => ToolError::execution_failed(error.message.to_string()),
    }
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化工具结果失败: {error}")))
}

fn resource_storage_dir() -> PathBuf {
    std::env::temp_dir().join("aster_mcp_resources")
}

fn sanitize_extension_from_mime_type(mime_type: Option<&str>) -> Option<String> {
    let mime_type = mime_type?.split(';').next()?.trim();
    let subtype = mime_type.split('/').nth(1)?.trim();
    let extension = subtype.rsplit('+').next().unwrap_or(subtype);
    let sanitized: String = extension
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();

    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized.to_ascii_lowercase())
    }
}

async fn persist_binary_content(
    uri: &str,
    mime_type: Option<&str>,
    blob: &str,
) -> Result<(PathBuf, usize), ToolError> {
    let bytes = BASE64.decode(blob).map_err(|error| {
        ToolError::execution_failed(format!("解码 MCP 二进制资源失败: {error}"))
    })?;

    let dir = resource_storage_dir();
    fs::create_dir_all(&dir).await?;

    let mut file_name = format!("mcp-resource-{}", Uuid::new_v4());
    if let Some(extension) = sanitize_extension_from_mime_type(mime_type) {
        file_name.push('.');
        file_name.push_str(&extension);
    }

    let path = dir.join(file_name);
    fs::write(&path, &bytes).await?;

    tracing::debug!(
        uri = %uri,
        path = %path.display(),
        size = bytes.len(),
        "persisted MCP binary resource to temp file"
    );

    Ok((path, bytes.len()))
}

fn binary_saved_message(path: &Path, mime_type: Option<&str>, size: usize, uri: &str) -> String {
    match mime_type {
        Some(mime_type) => format!(
            "Binary content from {} was saved to {} (mime type: {}, {} bytes).",
            uri,
            path.display(),
            mime_type,
            size
        ),
        None => format!(
            "Binary content from {} was saved to {} ({} bytes).",
            uri,
            path.display(),
            size
        ),
    }
}

#[async_trait]
impl Tool for ListMcpResourcesTool {
    fn name(&self) -> &str {
        LIST_MCP_RESOURCES_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Lists available resources from configured MCP servers. Each resource includes a server field."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "Optional MCP server name to filter resources by"
                }
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ListMcpResourcesInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let cancellation_token = context.cancellation_token.clone().unwrap_or_default();

        let resources = self
            .extension_manager()?
            .list_resources_structured(input.server.as_deref(), cancellation_token)
            .await
            .map_err(map_extension_error)?
            .into_iter()
            .map(|(server, resource)| ListedMcpResource {
                uri: resource.uri.clone(),
                name: resource.name.clone(),
                mime_type: resource.mime_type.clone(),
                description: resource.description.clone(),
                server,
            })
            .collect::<Vec<_>>();

        let output = pretty_json(&resources)?;
        let metadata = serde_json::to_value(&resources).map_err(|error| {
            ToolError::execution_failed(format!("序列化资源元数据失败: {error}"))
        })?;

        Ok(ToolResult::success(output)
            .with_metadata("resources", metadata)
            .with_metadata("server", serde_json::json!(input.server)))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

#[async_trait]
impl Tool for ReadMcpResourceTool {
    fn name(&self) -> &str {
        READ_MCP_RESOURCE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Reads a specific resource from an MCP server by server name and resource URI."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "The MCP server name"
                },
                "uri": {
                    "type": "string",
                    "description": "The resource URI to read"
                }
            },
            "required": ["server", "uri"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ReadMcpResourceInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let cancellation_token = context.cancellation_token.clone().unwrap_or_default();

        let read_result = self
            .extension_manager()?
            .read_resource(&input.uri, &input.server, cancellation_token)
            .await
            .map_err(map_extension_error)?;

        let mut contents = Vec::new();
        for content in read_result.contents {
            match content {
                ResourceContents::TextResourceContents {
                    uri,
                    mime_type,
                    text,
                    ..
                } => {
                    contents.push(ReadMcpResourceContent {
                        uri,
                        mime_type,
                        text: Some(text),
                        blob_saved_to: None,
                    });
                }
                ResourceContents::BlobResourceContents {
                    uri,
                    mime_type,
                    blob,
                    ..
                } => {
                    let (path, size) =
                        persist_binary_content(&uri, mime_type.as_deref(), &blob).await?;
                    contents.push(ReadMcpResourceContent {
                        uri: uri.clone(),
                        mime_type: mime_type.clone(),
                        text: Some(binary_saved_message(
                            &path,
                            mime_type.as_deref(),
                            size,
                            &uri,
                        )),
                        blob_saved_to: Some(path.display().to_string()),
                    });
                }
            }
        }

        let output = ReadMcpResourceOutput { contents };
        let serialized = pretty_json(&output)?;
        let metadata = serde_json::to_value(&output).map_err(|error| {
            ToolError::execution_failed(format!("序列化资源内容元数据失败: {error}"))
        })?;

        Ok(ToolResult::success(serialized)
            .with_metadata("contents", metadata)
            .with_metadata("server", serde_json::json!(input.server))
            .with_metadata("uri", serde_json::json!(input.uri)))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

pub fn register_extension_resource_tools(
    registry: &mut ToolRegistry,
    extension_manager: Weak<ExtensionManager>,
) {
    registry.register(Box::new(ListMcpResourcesTool::new(
        extension_manager.clone(),
    )));
    registry.register(Box::new(ReadMcpResourceTool::new(extension_manager)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::registry::ToolRegistry;
    use std::sync::Arc;

    #[test]
    fn test_register_extension_resource_tools_registers_current_tools() {
        let extension_manager = Arc::new(ExtensionManager::default());
        let mut registry = ToolRegistry::new();

        register_extension_resource_tools(&mut registry, Arc::downgrade(&extension_manager));

        assert!(registry.contains(LIST_MCP_RESOURCES_TOOL_NAME));
        assert!(registry.contains(READ_MCP_RESOURCE_TOOL_NAME));
    }

    #[test]
    fn test_read_mcp_resource_tool_schema_requires_server_and_uri() {
        let tool = ReadMcpResourceTool::new(Weak::new());
        let schema = tool.input_schema();
        let required = schema
            .get("required")
            .and_then(|value| value.as_array())
            .expect("required array should exist");

        assert!(required.iter().any(|value| value == "server"));
        assert!(required.iter().any(|value| value == "uri"));
    }
}
