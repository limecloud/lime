//! Notebook Edit Tool Implementation
//!
//! 此模块实现了 `NotebookEditTool`，用于编辑 Jupyter Notebook 单元格：
//! - 支持 replace, insert, delete 三种编辑模式
//! - 自动清理单元格输出（code 类型）
//! - Jupyter notebook 格式验证
//! - 增强的错误处理和路径验证
//! - 保留单元格元数据
//!
//! Requirements: 基于当前工具面的 notebook 编辑语义实现

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;

/// Jupyter Notebook 单元格
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookCell {
    /// 单元格 ID（可选，nbformat 4.5+ 支持）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// 单元格类型
    pub cell_type: String,
    /// 源代码内容
    pub source: serde_json::Value,
    /// 单元格元数据
    #[serde(default)]
    pub metadata: serde_json::Value,
    /// 输出（仅 code 单元格）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outputs: Option<Vec<serde_json::Value>>,
    /// 执行计数（仅 code 单元格）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_count: Option<serde_json::Value>,
}

/// Jupyter Notebook 内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookContent {
    /// 单元格列表
    pub cells: Vec<NotebookCell>,
    /// Notebook 元数据
    pub metadata: serde_json::Value,
    /// Notebook 格式版本
    pub nbformat: u32,
    /// Notebook 格式次版本
    pub nbformat_minor: u32,
}

/// NotebookEdit 工具输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookEditInput {
    /// Notebook 文件的绝对路径
    pub notebook_path: String,
    /// 要编辑的单元格 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_id: Option<String>,
    /// 新的源代码内容
    pub new_source: String,
    /// 单元格类型（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_type: Option<String>,
    /// 编辑模式
    #[serde(default = "default_edit_mode")]
    pub edit_mode: String,
}

fn default_edit_mode() -> String {
    "replace".to_string()
}

/// Notebook Edit Tool for editing Jupyter notebook cells
///
/// 提供 Jupyter Notebook 单元格编辑功能：
/// - 替换单元格内容（replace 模式）
/// - 插入新单元格（insert 模式）
/// - 删除单元格（delete 模式）
/// - 自动清理 code 单元格输出
/// - 格式验证和错误处理
#[derive(Debug)]
pub struct NotebookEditTool {
    /// 工具名称
    name: String,
}

impl Default for NotebookEditTool {
    fn default() -> Self {
        Self::new()
    }
}

impl NotebookEditTool {
    /// Create a new NotebookEditTool
    pub fn new() -> Self {
        Self {
            name: "NotebookEdit".to_string(),
        }
    }

    /// 验证 Jupyter notebook 格式
    fn validate_notebook_format(&self, notebook: &serde_json::Value) -> Result<(), String> {
        // 检查必需字段
        let cells = notebook
            .get("cells")
            .and_then(|c| c.as_array())
            .ok_or("Invalid notebook structure: missing or invalid cells array")?;

        let nbformat = notebook
            .get("nbformat")
            .and_then(|n| n.as_u64())
            .ok_or("Invalid notebook structure: missing or invalid nbformat")?;

        let nbformat_minor = notebook
            .get("nbformat_minor")
            .and_then(|n| n.as_u64())
            .ok_or("Invalid notebook structure: missing or invalid nbformat_minor")?;

        // 验证 nbformat 版本（支持 v4.x）
        if nbformat < 4 {
            return Err(format!(
                "Unsupported notebook format version: {}.{} (only v4.x is supported)",
                nbformat, nbformat_minor
            ));
        }

        // 验证 metadata
        if !notebook.get("metadata").is_some_and(|m| m.is_object()) {
            return Err("Invalid notebook structure: missing or invalid metadata".to_string());
        }

        // 验证每个单元格的基本结构
        for (i, cell) in cells.iter().enumerate() {
            let cell_type = cell
                .get("cell_type")
                .and_then(|t| t.as_str())
                .ok_or_else(|| {
                    format!("Invalid cell at index {}: missing or invalid cell_type", i)
                })?;

            if !["code", "markdown", "raw"].contains(&cell_type) {
                return Err(format!(
                    "Invalid cell at index {}: unknown cell_type '{}'",
                    i, cell_type
                ));
            }

            if cell.get("source").is_none() {
                return Err(format!("Invalid cell at index {}: missing source", i));
            }
        }

        Ok(())
    }

    /// 查找单元格索引
    fn find_cell_index(&self, cells: &[serde_json::Value], cell_id: &str) -> i32 {
        // 首先尝试按 ID 精确匹配
        for (i, cell) in cells.iter().enumerate() {
            if let Some(id) = cell.get("id").and_then(|id| id.as_str()) {
                if id == cell_id {
                    return i as i32;
                }
            }
        }

        // 尝试解析为数字索引
        if let Ok(num_index) = cell_id.parse::<i32>() {
            // 支持负数索引（从末尾开始）
            if num_index < 0 {
                let positive_index = cells.len() as i32 + num_index;
                if positive_index >= 0 && positive_index < cells.len() as i32 {
                    return positive_index;
                }
            } else if num_index >= 0 && (num_index as usize) < cells.len() {
                return num_index;
            }
        }

        -1
    }

    /// 清除单元格输出
    fn clear_cell_outputs(&self, cell: &mut serde_json::Value) {
        if let Some(cell_type) = cell.get("cell_type").and_then(|t| t.as_str()) {
            if cell_type == "code" {
                cell.as_object_mut()
                    .unwrap()
                    .insert("outputs".to_string(), serde_json::json!([]));
                cell.as_object_mut()
                    .unwrap()
                    .insert("execution_count".to_string(), serde_json::Value::Null);
            } else {
                // 对于非 code 单元格，移除 outputs 和 execution_count 字段
                if let Some(obj) = cell.as_object_mut() {
                    obj.remove("outputs");
                    obj.remove("execution_count");
                }
            }
        }
    }

    /// 生成唯一的单元格 ID
    fn generate_cell_id(&self) -> String {
        use rand::Rng;
        const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        let mut rng = rand::thread_rng();
        (0..8)
            .map(|_| {
                let idx = rng.gen_range(0..CHARS.len());
                CHARS[idx] as char
            })
            .collect()
    }
}

#[async_trait]
impl Tool for NotebookEditTool {
    /// Returns the tool name
    fn name(&self) -> &str {
        &self.name
    }

    /// Returns the tool description
    fn description(&self) -> &str {
        "Replace the contents of a specific cell in a Jupyter notebook. \
         Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. \
         Jupyter notebooks are interactive documents that combine code, text, and visualizations, \
         commonly used for data analysis and scientific computing. \
         The notebook_path parameter must be an absolute path, not a relative path. \
         The cell_id can be a cell ID or numeric index (0-indexed). \
         Use edit_mode=insert to add a new cell at the index specified by cell_id. \
         Use edit_mode=delete to delete the cell at the index specified by cell_id."
    }

    /// Returns the JSON Schema for input parameters
    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "notebook_path": {
                    "type": "string",
                    "description": "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)"
                },
                "cell_id": {
                    "type": "string",
                    "description": "The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified."
                },
                "new_source": {
                    "type": "string",
                    "description": "The new source for the cell"
                },
                "cell_type": {
                    "type": "string",
                    "enum": ["code", "markdown"],
                    "description": "The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required."
                },
                "edit_mode": {
                    "type": "string",
                    "enum": ["replace", "insert", "delete"],
                    "description": "The type of edit to make (replace, insert, delete). Defaults to replace."
                }
            },
            "required": ["notebook_path", "new_source"]
        })
    }

    /// Execute the notebook edit command
    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Extract input parameters
        let input: NotebookEditInput = serde_json::from_value(params)
            .map_err(|e| ToolError::invalid_params(format!("Invalid input format: {}", e)))?;

        let notebook_path = PathBuf::from(&input.notebook_path);
        let edit_mode = input.edit_mode.as_str();

        // 验证路径是否为绝对路径
        if !notebook_path.is_absolute() {
            return Ok(ToolResult::error(format!(
                "notebook_path must be an absolute path, got: {}",
                input.notebook_path
            )));
        }

        // 检查文件是否存在
        if !notebook_path.exists() {
            return Ok(ToolResult::error(format!(
                "Notebook file not found: {}",
                notebook_path.display()
            )));
        }

        // 检查是否是文件（不是目录）
        let metadata = fs::metadata(&notebook_path).map_err(|e| {
            ToolError::execution_failed(format!("Failed to read file metadata: {}", e))
        })?;

        if !metadata.is_file() {
            return Ok(ToolResult::error(format!(
                "Path is not a file: {}",
                notebook_path.display()
            )));
        }

        // 检查文件扩展名
        if notebook_path.extension().is_none_or(|ext| ext != "ipynb") {
            return Ok(ToolResult::error(format!(
                "File must be a Jupyter notebook (.ipynb), got: {}",
                notebook_path
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
            )));
        }

        // 读取并解析 notebook
        let content = fs::read_to_string(&notebook_path).map_err(|e| {
            ToolError::execution_failed(format!("Failed to read notebook file: {}", e))
        })?;

        let mut notebook: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
            ToolError::execution_failed(format!("Failed to parse notebook JSON: {}", e))
        })?;

        // 验证 notebook 格式
        if let Err(error) = self.validate_notebook_format(&notebook) {
            return Ok(ToolResult::error(error));
        }

        // 提前获取 nbformat 信息，避免借用冲突
        let nbformat = notebook
            .get("nbformat")
            .and_then(|n| n.as_u64())
            .unwrap_or(4);
        let nbformat_minor = notebook
            .get("nbformat_minor")
            .and_then(|n| n.as_u64())
            .unwrap_or(0);

        // 获取单元格数组
        let cells = notebook
            .get_mut("cells")
            .and_then(|c| c.as_array_mut())
            .ok_or_else(|| {
                ToolError::execution_failed("Invalid notebook format: missing cells".to_string())
            })?;

        // 找到目标单元格索引
        let mut cell_index: i32 = 0;
        if let Some(cell_id) = &input.cell_id {
            cell_index = self.find_cell_index(cells, cell_id);

            // 如果按 ID 找不到，对于非 insert 模式报错
            if cell_index == -1 {
                if edit_mode == "insert" {
                    // insert 模式下找不到 cell_id，也应该报错
                    return Ok(ToolResult::error(format!(
                        "Cell with ID \"{}\" not found in notebook.",
                        cell_id
                    )));
                } else if edit_mode == "replace" {
                    // replace 模式下，如果是数字索引且超出范围，转为 insert 到末尾
                    if let Ok(num_index) = cell_id.parse::<usize>() {
                        cell_index = num_index as i32;
                    } else {
                        return Ok(ToolResult::error(format!(
                            "Cell not found with ID: {}. Available cells: {}",
                            cell_id,
                            cells.len()
                        )));
                    }
                } else {
                    return Ok(ToolResult::error(format!(
                        "Cell not found with ID: {}. Available cells: {}",
                        cell_id,
                        cells.len()
                    )));
                }
            }

            // insert 模式：在找到的单元格之后插入
            if edit_mode == "insert" && cell_index != -1 {
                cell_index += 1;
            }
        }

        // delete 模式必须指定 cell_id
        if edit_mode == "delete" && input.cell_id.is_none() {
            return Ok(ToolResult::error(
                "cell_id is required for delete mode".to_string(),
            ));
        }

        // 执行编辑操作
        let result_message = match edit_mode {
            "replace" => {
                let cell_index = cell_index as usize;

                // 特殊处理：如果索引超出范围，自动转为 insert
                if cell_index >= cells.len() {
                    let final_cell_type = input.cell_type.as_deref().unwrap_or("code");
                    let mut new_cell = serde_json::json!({
                        "cell_type": final_cell_type,
                        "source": input.new_source,
                        "metadata": {}
                    });

                    // 初始化 code 单元格的输出
                    if final_cell_type == "code" {
                        new_cell
                            .as_object_mut()
                            .unwrap()
                            .insert("outputs".to_string(), serde_json::json!([]));
                        new_cell
                            .as_object_mut()
                            .unwrap()
                            .insert("execution_count".to_string(), serde_json::Value::Null);
                    }

                    // 只在 nbformat 4.5+ 生成 ID
                    if nbformat > 4 || (nbformat == 4 && nbformat_minor >= 5) {
                        new_cell
                            .as_object_mut()
                            .unwrap()
                            .insert("id".to_string(), serde_json::json!(self.generate_cell_id()));
                    }

                    cells.push(new_cell);
                    format!(
                        "Inserted new {} cell at position {} (converted from replace)",
                        final_cell_type, cell_index
                    )
                } else {
                    let cell = &mut cells[cell_index];
                    let old_type = cell
                        .get("cell_type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    // 更新源代码
                    cell.as_object_mut()
                        .unwrap()
                        .insert("source".to_string(), serde_json::json!(input.new_source));

                    // 如果指定了 cell_type，更新类型
                    if let Some(new_type) = &input.cell_type {
                        cell.as_object_mut()
                            .unwrap()
                            .insert("cell_type".to_string(), serde_json::json!(new_type));
                    }

                    // 清除输出（对于 code 单元格）
                    self.clear_cell_outputs(cell);

                    let current_type = cell
                        .get("cell_type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    if old_type != current_type {
                        format!(
                            "Replaced cell {} (changed type from {} to {})",
                            cell_index, old_type, current_type
                        )
                    } else {
                        format!("Replaced cell {}", cell_index)
                    }
                }
            }
            "insert" => {
                let cell_index = cell_index as usize;
                let final_cell_type = input.cell_type.as_deref().unwrap_or("code");

                let mut new_cell = serde_json::json!({
                    "cell_type": final_cell_type,
                    "source": input.new_source,
                    "metadata": {}
                });

                // 初始化 code 单元格的输出
                if final_cell_type == "code" {
                    new_cell
                        .as_object_mut()
                        .unwrap()
                        .insert("outputs".to_string(), serde_json::json!([]));
                    new_cell
                        .as_object_mut()
                        .unwrap()
                        .insert("execution_count".to_string(), serde_json::Value::Null);
                }

                // 只在 nbformat 4.5+ 生成 ID
                if nbformat > 4 || (nbformat == 4 && nbformat_minor >= 5) {
                    new_cell
                        .as_object_mut()
                        .unwrap()
                        .insert("id".to_string(), serde_json::json!(self.generate_cell_id()));
                }

                // 插入新单元格
                if cell_index <= cells.len() {
                    cells.insert(cell_index, new_cell);
                } else {
                    cells.push(new_cell);
                }

                format!(
                    "Inserted new {} cell at position {}",
                    final_cell_type, cell_index
                )
            }
            "delete" => {
                let cell_index = cell_index as usize;
                if cell_index >= cells.len() {
                    return Ok(ToolResult::error(format!(
                        "Cell index out of range: {} (total cells: {})",
                        cell_index,
                        cells.len()
                    )));
                }

                let deleted_type = cells[cell_index]
                    .get("cell_type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                cells.remove(cell_index);

                format!(
                    "Deleted {} cell at position {} ({} cells remaining)",
                    deleted_type,
                    cell_index,
                    cells.len()
                )
            }
            _ => {
                return Ok(ToolResult::error(format!(
                    "Invalid edit_mode: {}. Must be 'replace', 'insert', or 'delete'",
                    edit_mode
                )));
            }
        };

        // 写回文件（使用美化的 JSON 格式，缩进 1 空格）
        let formatted_json = serde_json::to_string_pretty(&notebook).map_err(|e| {
            ToolError::execution_failed(format!("Failed to serialize notebook: {}", e))
        })?;

        // 手动调整缩进为 1 空格（serde_json::to_string_pretty 使用 2 空格）
        let formatted_json = formatted_json
            .lines()
            .map(|line| {
                let leading_spaces = line.len() - line.trim_start().len();
                let adjusted_spaces = leading_spaces / 2; // 从 2 空格缩进改为 1 空格
                format!("{}{}", " ".repeat(adjusted_spaces), line.trim_start())
            })
            .collect::<Vec<_>>()
            .join("\n");

        fs::write(&notebook_path, format!("{}\n", formatted_json)).map_err(|e| {
            ToolError::execution_failed(format!("Failed to write notebook file: {}", e))
        })?;

        let filename = notebook_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        Ok(ToolResult::success(format!(
            "{} in {}",
            result_message, filename
        )))
    }

    /// Check permissions before execution
    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // Validate input format
        match serde_json::from_value::<NotebookEditInput>(params.clone()) {
            Ok(input) => {
                let notebook_path = PathBuf::from(&input.notebook_path);

                // Check if path is absolute
                if !notebook_path.is_absolute() {
                    return PermissionCheckResult::deny(format!(
                        "notebook_path must be an absolute path, got: {}",
                        input.notebook_path
                    ));
                }

                // Check if it's a notebook file
                if notebook_path.extension().is_none_or(|ext| ext != "ipynb") {
                    return PermissionCheckResult::deny(format!(
                        "File must be a Jupyter notebook (.ipynb), got: {}",
                        notebook_path
                            .extension()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ));
                }

                // Validate edit_mode
                if !["replace", "insert", "delete"].contains(&input.edit_mode.as_str()) {
                    return PermissionCheckResult::deny(format!(
                        "Invalid edit_mode: {}. Must be 'replace', 'insert', or 'delete'",
                        input.edit_mode
                    ));
                }

                // delete 模式必须指定 cell_id
                if input.edit_mode == "delete" && input.cell_id.is_none() {
                    return PermissionCheckResult::deny(
                        "cell_id is required for delete mode".to_string(),
                    );
                }

                PermissionCheckResult::allow()
            }
            Err(e) => PermissionCheckResult::deny(format!("Invalid input format: {}", e)),
        }
    }

    /// Get tool options
    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0) // Don't retry notebook operations
            .with_base_timeout(std::time::Duration::from_secs(30)) // Longer timeout for file operations
            .with_dynamic_timeout(false)
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user")
    }

    fn create_test_notebook() -> serde_json::Value {
        serde_json::json!({
            "cells": [
                {
                    "id": "cell-1",
                    "cell_type": "code",
                    "source": "print('Hello, World!')",
                    "metadata": {},
                    "outputs": [],
                    "execution_count": null
                },
                {
                    "id": "cell-2",
                    "cell_type": "markdown",
                    "source": "# Test Markdown",
                    "metadata": {}
                }
            ],
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3"
                }
            },
            "nbformat": 4,
            "nbformat_minor": 5
        })
    }

    #[test]
    fn test_tool_name() {
        let tool = NotebookEditTool::new();
        assert_eq!(tool.name(), "NotebookEdit");
    }

    #[test]
    fn test_tool_description() {
        let tool = NotebookEditTool::new();
        assert!(!tool.description().is_empty());
        assert!(tool.description().contains("Jupyter notebook"));
        assert!(tool.description().contains("cell"));
    }

    #[test]
    fn test_tool_input_schema() {
        let tool = NotebookEditTool::new();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["notebook_path"].is_object());
        assert!(schema["properties"]["new_source"].is_object());
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("notebook_path")));
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("new_source")));
    }

    #[test]
    fn test_tool_options() {
        let tool = NotebookEditTool::new();
        let options = tool.options();
        assert_eq!(options.max_retries, 0);
        assert_eq!(options.base_timeout, std::time::Duration::from_secs(30));
        assert!(!options.enable_dynamic_timeout);
    }

    #[test]
    fn test_validate_notebook_format_valid() {
        let tool = NotebookEditTool::new();
        let notebook = create_test_notebook();
        assert!(tool.validate_notebook_format(&notebook).is_ok());
    }

    #[test]
    fn test_validate_notebook_format_missing_cells() {
        let tool = NotebookEditTool::new();
        let notebook = serde_json::json!({
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5
        });
        let result = tool.validate_notebook_format(&notebook);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing or invalid cells"));
    }

    #[test]
    fn test_validate_notebook_format_invalid_nbformat() {
        let tool = NotebookEditTool::new();
        let notebook = serde_json::json!({
            "cells": [],
            "metadata": {},
            "nbformat": 3,
            "nbformat_minor": 0
        });
        let result = tool.validate_notebook_format(&notebook);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Unsupported notebook format version"));
    }

    #[test]
    fn test_validate_notebook_format_invalid_cell_type() {
        let tool = NotebookEditTool::new();
        let notebook = serde_json::json!({
            "cells": [
                {
                    "cell_type": "invalid_type",
                    "source": "test"
                }
            ],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5
        });
        let result = tool.validate_notebook_format(&notebook);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown cell_type"));
    }

    #[test]
    fn test_find_cell_index_by_id() {
        let tool = NotebookEditTool::new();
        let notebook = create_test_notebook();
        let cells = notebook.get("cells").unwrap().as_array().unwrap();

        assert_eq!(tool.find_cell_index(cells, "cell-1"), 0);
        assert_eq!(tool.find_cell_index(cells, "cell-2"), 1);
        assert_eq!(tool.find_cell_index(cells, "nonexistent"), -1);
    }

    #[test]
    fn test_find_cell_index_by_number() {
        let tool = NotebookEditTool::new();
        let notebook = create_test_notebook();
        let cells = notebook.get("cells").unwrap().as_array().unwrap();

        assert_eq!(tool.find_cell_index(cells, "0"), 0);
        assert_eq!(tool.find_cell_index(cells, "1"), 1);
        assert_eq!(tool.find_cell_index(cells, "2"), -1); // Out of range
        assert_eq!(tool.find_cell_index(cells, "-1"), 1); // Last cell
        assert_eq!(tool.find_cell_index(cells, "-2"), 0); // Second to last
    }

    #[test]
    fn test_clear_cell_outputs() {
        let tool = NotebookEditTool::new();
        let mut cell = serde_json::json!({
            "cell_type": "code",
            "source": "print('test')",
            "outputs": [{"output_type": "stream", "text": "test"}],
            "execution_count": 5
        });

        tool.clear_cell_outputs(&mut cell);

        assert_eq!(cell["outputs"], serde_json::json!([]));
        assert_eq!(cell["execution_count"], serde_json::Value::Null);
    }

    #[test]
    fn test_clear_cell_outputs_markdown() {
        let tool = NotebookEditTool::new();
        let mut cell = serde_json::json!({
            "cell_type": "markdown",
            "source": "# Test"
        });

        tool.clear_cell_outputs(&mut cell);

        // Markdown cells should not have outputs added
        assert!(!cell.as_object().unwrap().contains_key("outputs"));
        assert!(!cell.as_object().unwrap().contains_key("execution_count"));
    }

    #[test]
    fn test_generate_cell_id() {
        let tool = NotebookEditTool::new();
        let id1 = tool.generate_cell_id();
        let id2 = tool.generate_cell_id();

        assert_eq!(id1.len(), 8);
        assert_eq!(id2.len(), 8);
        assert_ne!(id1, id2); // Should be different

        // Should only contain lowercase letters and numbers
        for c in id1.chars() {
            assert!(c.is_ascii_lowercase() || c.is_ascii_digit());
        }
    }

    // Permission Check Tests

    #[tokio::test]
    async fn test_check_permissions_valid_input() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "notebook_path": "/tmp/test.ipynb",
            "new_source": "print('hello')",
            "edit_mode": "replace"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_check_permissions_relative_path() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "notebook_path": "test.ipynb",
            "new_source": "print('hello')"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
        assert!(result.message.unwrap().contains("must be an absolute path"));
    }

    #[tokio::test]
    async fn test_check_permissions_not_notebook() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "notebook_path": "/tmp/test.py",
            "new_source": "print('hello')"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
        assert!(result
            .message
            .unwrap()
            .contains("must be a Jupyter notebook"));
    }

    #[tokio::test]
    async fn test_check_permissions_invalid_edit_mode() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "notebook_path": "/tmp/test.ipynb",
            "new_source": "print('hello')",
            "edit_mode": "invalid"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
        assert!(result.message.unwrap().contains("Invalid edit_mode"));
    }

    #[tokio::test]
    async fn test_check_permissions_delete_without_cell_id() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "notebook_path": "/tmp/test.ipynb",
            "new_source": "print('hello')",
            "edit_mode": "delete"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
        assert!(result
            .message
            .unwrap()
            .contains("cell_id is required for delete mode"));
    }

    #[tokio::test]
    async fn test_check_permissions_invalid_format() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"invalid": "format"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
        assert!(result.message.unwrap().contains("Invalid input format"));
    }

    // Execution Tests

    #[tokio::test]
    async fn test_execute_file_not_found() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "notebook_path": "/tmp/nonexistent.ipynb",
            "new_source": "print('hello')"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_error());
        assert!(tool_result
            .error
            .unwrap()
            .contains("Notebook file not found"));
    }

    #[tokio::test]
    async fn test_execute_not_a_file() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path().join("test.ipynb");
        fs::create_dir(&dir_path).unwrap();

        let params = serde_json::json!({
            "notebook_path": dir_path.to_string_lossy(),
            "new_source": "print('hello')"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_error());
        assert!(tool_result.error.unwrap().contains("Path is not a file"));
    }

    #[tokio::test]
    async fn test_execute_invalid_json() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");
        fs::write(&file_path, "invalid json").unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "new_source": "print('hello')"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Failed to parse notebook JSON"));
    }

    #[tokio::test]
    async fn test_execute_replace_cell() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");

        let notebook = create_test_notebook();
        fs::write(&file_path, serde_json::to_string(&notebook).unwrap()).unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "cell_id": "cell-1",
            "new_source": "print('Hello, Rust!')",
            "edit_mode": "replace"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result.output.unwrap().contains("Replaced cell 0"));

        // Verify the file was updated
        let updated_content = fs::read_to_string(&file_path).unwrap();
        let updated_notebook: serde_json::Value = serde_json::from_str(&updated_content).unwrap();
        let cells = updated_notebook["cells"].as_array().unwrap();
        assert_eq!(cells[0]["source"], "print('Hello, Rust!')");
        assert_eq!(cells[0]["outputs"], serde_json::json!([]));
        assert_eq!(cells[0]["execution_count"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn test_execute_insert_cell() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");

        let notebook = create_test_notebook();
        fs::write(&file_path, serde_json::to_string(&notebook).unwrap()).unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "cell_id": "cell-1",
            "new_source": "# New markdown cell",
            "cell_type": "markdown",
            "edit_mode": "insert"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result
            .output
            .unwrap()
            .contains("Inserted new markdown cell at position 1"));

        // Verify the file was updated
        let updated_content = fs::read_to_string(&file_path).unwrap();
        let updated_notebook: serde_json::Value = serde_json::from_str(&updated_content).unwrap();
        let cells = updated_notebook["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 3); // Original 2 + 1 inserted
        assert_eq!(cells[1]["source"], "# New markdown cell");
        assert_eq!(cells[1]["cell_type"], "markdown");
    }

    #[tokio::test]
    async fn test_execute_delete_cell() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");

        let notebook = create_test_notebook();
        fs::write(&file_path, serde_json::to_string(&notebook).unwrap()).unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "cell_id": "cell-1",
            "new_source": "", // Not used for delete
            "edit_mode": "delete"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result
            .output
            .unwrap()
            .contains("Deleted code cell at position 0"));

        // Verify the file was updated
        let updated_content = fs::read_to_string(&file_path).unwrap();
        let updated_notebook: serde_json::Value = serde_json::from_str(&updated_content).unwrap();
        let cells = updated_notebook["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 1); // Original 2 - 1 deleted
        assert_eq!(cells[0]["id"], "cell-2"); // cell-2 should remain
    }

    #[tokio::test]
    async fn test_execute_cell_not_found() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");

        let notebook = create_test_notebook();
        fs::write(&file_path, serde_json::to_string(&notebook).unwrap()).unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "cell_id": "nonexistent",
            "new_source": "print('hello')",
            "edit_mode": "replace"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_error());
        assert!(tool_result
            .error
            .unwrap()
            .contains("Cell not found with ID: nonexistent"));
    }

    #[tokio::test]
    async fn test_execute_replace_out_of_range_converts_to_insert() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");

        let notebook = create_test_notebook();
        fs::write(&file_path, serde_json::to_string(&notebook).unwrap()).unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "cell_id": "5", // Out of range index
            "new_source": "print('new cell')",
            "edit_mode": "replace"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result
            .output
            .unwrap()
            .contains("Inserted new code cell"));

        // Verify the file was updated
        let updated_content = fs::read_to_string(&file_path).unwrap();
        let updated_notebook: serde_json::Value = serde_json::from_str(&updated_content).unwrap();
        let cells = updated_notebook["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 3); // Original 2 + 1 inserted
        assert_eq!(cells[2]["source"], "print('new cell')");
        assert_eq!(cells[2]["cell_type"], "code");
    }

    #[tokio::test]
    async fn test_execute_invalid_input_format() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"invalid": "format"});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_execute_change_cell_type() {
        let tool = NotebookEditTool::new();
        let context = create_test_context();
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.ipynb");

        let notebook = create_test_notebook();
        fs::write(&file_path, serde_json::to_string(&notebook).unwrap()).unwrap();

        let params = serde_json::json!({
            "notebook_path": file_path.to_string_lossy(),
            "cell_id": "cell-1",
            "new_source": "# Now a markdown cell",
            "cell_type": "markdown",
            "edit_mode": "replace"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result
            .output
            .unwrap()
            .contains("changed type from code to markdown"));

        // Verify the file was updated
        let updated_content = fs::read_to_string(&file_path).unwrap();
        let updated_notebook: serde_json::Value = serde_json::from_str(&updated_content).unwrap();
        let cells = updated_notebook["cells"].as_array().unwrap();
        assert_eq!(cells[0]["source"], "# Now a markdown cell");
        assert_eq!(cells[0]["cell_type"], "markdown");
        // Should not have outputs or execution_count for markdown
        assert!(!cells[0].as_object().unwrap().contains_key("outputs"));
        assert!(!cells[0]
            .as_object()
            .unwrap()
            .contains_key("execution_count"));
    }
}
