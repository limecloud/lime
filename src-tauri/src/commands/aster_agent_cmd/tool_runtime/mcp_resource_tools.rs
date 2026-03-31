use super::*;
use base64::Engine;
use std::fs;

pub(crate) struct ListMcpResourcesBridgeTool {
    mcp_manager: McpManagerState,
}

impl ListMcpResourcesBridgeTool {
    pub(crate) fn new(mcp_manager: McpManagerState) -> Self {
        Self { mcp_manager }
    }
}

#[async_trait]
impl Tool for ListMcpResourcesBridgeTool {
    fn name(&self) -> &str {
        LIST_MCP_RESOURCES_TOOL_NAME
    }

    fn description(&self) -> &str {
        "列出运行中 MCP server 暴露的资源，返回 uri、name、mimeType、description、server。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "可选，按 MCP server 名称过滤资源"
                }
            },
            "required": []
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(15))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let target_server = params
            .get("server")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        let manager = self.mcp_manager.lock().await;
        let running_servers = manager.get_running_servers().await;
        if let Some(server_name) = target_server.as_ref() {
            if !running_servers.iter().any(|item| item == server_name) {
                return Err(ToolError::execution_failed(format!(
                    "MCP server 不存在或未运行: {server_name}. 当前可用: {}",
                    running_servers.join(", ")
                )));
            }
        }

        let resources = manager
            .list_resources()
            .await
            .map_err(|error| ToolError::execution_failed(format!("列出 MCP 资源失败: {error}")))?;

        let output = resources
            .into_iter()
            .filter(|resource| {
                target_server
                    .as_ref()
                    .map(|server_name| resource.server_name == *server_name)
                    .unwrap_or(true)
            })
            .map(|resource| {
                serde_json::json!({
                    "uri": resource.uri,
                    "name": resource.name,
                    "mimeType": resource.mime_type,
                    "description": resource.description,
                    "server": resource.server_name
                })
            })
            .collect::<Vec<_>>();

        let text = serde_json::to_string_pretty(&output).map_err(|error| {
            ToolError::execution_failed(format!(
                "{LIST_MCP_RESOURCES_TOOL_NAME} 序列化失败: {error}"
            ))
        })?;

        Ok(ToolResult::success(text))
    }
}

pub(crate) struct ReadMcpResourceBridgeTool {
    mcp_manager: McpManagerState,
}

impl ReadMcpResourceBridgeTool {
    pub(crate) fn new(mcp_manager: McpManagerState) -> Self {
        Self { mcp_manager }
    }

    fn sanitize_path_segment(value: &str) -> String {
        let sanitized = value
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let trimmed = sanitized.trim_matches('_');
        if trimmed.is_empty() {
            "resource".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn persist_blob(
        server_name: &str,
        uri: &str,
        mime_type: Option<&str>,
        blob: &str,
    ) -> Result<String, ToolError> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(blob)
            .map_err(|error| {
                ToolError::execution_failed(format!("MCP 资源 blob 解码失败: {error}"))
            })?;
        let directory = std::env::temp_dir()
            .join("lime-mcp-resource-tool")
            .join(Self::sanitize_path_segment(server_name));
        fs::create_dir_all(&directory).map_err(|error| {
            ToolError::execution_failed(format!("创建 MCP 资源暂存目录失败: {error}"))
        })?;

        let extension = match mime_type {
            Some("application/json") => "json",
            Some("text/plain") => "txt",
            Some("text/markdown") => "md",
            Some("image/png") => "png",
            Some("image/jpeg") => "jpg",
            Some("image/webp") => "webp",
            Some("application/pdf") => "pdf",
            _ => "bin",
        };
        let file_name = format!(
            "{}-{}.{}",
            Self::sanitize_path_segment(uri),
            Uuid::new_v4(),
            extension
        );
        let file_path = directory.join(file_name);
        fs::write(&file_path, bytes).map_err(|error| {
            ToolError::execution_failed(format!("写入 MCP 资源临时文件失败: {error}"))
        })?;
        Ok(file_path.display().to_string())
    }
}

#[async_trait]
impl Tool for ReadMcpResourceBridgeTool {
    fn name(&self) -> &str {
        READ_MCP_RESOURCE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "按 MCP server 名称与资源 URI 读取单个资源内容。文本资源直接返回，二进制资源会保存到本地临时文件。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "MCP server 名称"
                },
                "uri": {
                    "type": "string",
                    "description": "资源 URI"
                }
            },
            "required": ["server", "uri"]
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(20))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let server_name = params
            .get("server")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolError::invalid_params("server 必填"))?;
        let uri = params
            .get("uri")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolError::invalid_params("uri 必填"))?;

        let manager = self.mcp_manager.lock().await;
        let running_servers = manager.get_running_servers().await;
        if !running_servers.iter().any(|item| item == server_name) {
            return Err(ToolError::execution_failed(format!(
                "MCP server 不存在或未运行: {server_name}. 当前可用: {}",
                running_servers.join(", ")
            )));
        }

        let resources = manager.list_resources().await.map_err(|error| {
            ToolError::execution_failed(format!("读取 MCP 资源索引失败: {error}"))
        })?;
        let resource_exists = resources
            .iter()
            .any(|resource| resource.server_name == server_name && resource.uri == uri);
        if !resource_exists {
            return Err(ToolError::execution_failed(format!(
                "MCP server {server_name} 未暴露资源: {uri}"
            )));
        }

        let resource = manager
            .read_resource(uri)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 MCP 资源失败: {error}")))?;

        let blob_saved_to = resource
            .blob
            .as_deref()
            .map(|blob| Self::persist_blob(server_name, uri, resource.mime_type.as_deref(), blob))
            .transpose()?;
        let text = if let Some(text) = resource.text {
            Some(text)
        } else {
            blob_saved_to
                .as_ref()
                .map(|path| format!("Binary resource saved to {path}"))
        };

        let payload = serde_json::json!({
            "contents": [{
                "uri": resource.uri,
                "mimeType": resource.mime_type,
                "text": text,
                "blobSavedTo": blob_saved_to
            }]
        });
        let output = serde_json::to_string_pretty(&payload).map_err(|error| {
            ToolError::execution_failed(format!(
                "{READ_MCP_RESOURCE_TOOL_NAME} 序列化失败: {error}"
            ))
        })?;
        Ok(ToolResult::success(output))
    }
}

pub(super) fn register_mcp_resource_tools_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    mcp_manager: McpManagerState,
) {
    if !registry.contains(LIST_MCP_RESOURCES_TOOL_NAME) {
        registry.register(Box::new(ListMcpResourcesBridgeTool::new(
            mcp_manager.clone(),
        )));
    }
    if !registry.contains(READ_MCP_RESOURCE_TOOL_NAME) {
        registry.register(Box::new(ReadMcpResourceBridgeTool::new(mcp_manager)));
    }
}

pub(crate) async fn ensure_mcp_resource_tools_registered(
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    let (registry_arc, _) = resolve_agent_registry(state).await?;
    let mut registry = registry_arc.write().await;
    register_mcp_resource_tools_to_registry(&mut registry, mcp_manager.clone());
    Ok(())
}
