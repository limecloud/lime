//! 图片分析工具
//!
//! 通用的图片分析工具，支持多种输入格式
//! - file_path: 本地文件路径
//! - imageSource: MCP 格式的图片源
//! - base64: 直接的 base64 编码数据

use async_trait::async_trait;
use base64::{prelude::BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::media::read_image_file_enhanced;
use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;

/// 默认最大 token 数（可通过配置覆盖）
pub const DEFAULT_MAX_TOKENS: usize = 25000;

/// 图片分析输入参数 - 支持多种格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeImageInput {
    /// 图片文件路径（兼容 imageSource 和 file_path 两种格式）
    pub file_path: String,
    /// 分析提示
    pub prompt: Option<String>,
}

/// 图片分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeImageResult {
    /// Base64 编码的图片数据
    pub base64: String,
    /// MIME 类型
    pub mime_type: String,
    /// 原始文件大小（字节）
    pub original_size: u64,
    /// 图片尺寸信息
    pub dimensions: Option<ImageDimensions>,
    /// Token 估算
    pub token_estimate: Option<usize>,
    /// 分析提示词（如果提供）
    pub prompt: Option<String>,
    /// 是否压缩过
    pub compressed: bool,
}

/// 图片尺寸信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageDimensions {
    /// 原始宽度
    pub original_width: Option<u32>,
    /// 原始高度
    pub original_height: Option<u32>,
    /// 显示宽度
    pub display_width: Option<u32>,
    /// 显示高度
    pub display_height: Option<u32>,
}

/// 图片分析工具
pub struct AnalyzeImageTool {
    /// 最大 token 数（可配置）
    max_tokens: usize,
}

impl Default for AnalyzeImageTool {
    fn default() -> Self {
        Self::new()
    }
}

impl AnalyzeImageTool {
    /// 创建新的 AnalyzeImageTool
    pub fn new() -> Self {
        Self {
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }

    /// 设置最大 token 限制
    pub fn with_max_tokens(mut self, max_tokens: usize) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// 检测 MIME 类型
    fn detect_mime_type(&self, data: &[u8]) -> String {
        // 简单的 MIME 类型检测
        if data.len() < 4 {
            return "image/jpeg".to_string();
        }

        let magic = &data[..4];

        // PNG
        if magic == [0x89, 0x50, 0x4E, 0x47] {
            return "image/png".to_string();
        }
        // JPEG
        if magic[..3] == [0xFF, 0xD8, 0xFF] {
            return "image/jpeg".to_string();
        }
        // GIF
        if magic == [0x47, 0x49, 0x46, 0x38] {
            return "image/gif".to_string();
        }
        // WebP
        if magic == [0x52, 0x49, 0x46, 0x46] {
            return "image/webp".to_string();
        }

        // 默认
        "image/jpeg".to_string()
    }

    /// 解析图片源
    /// 支持 file://, base64:, 和本地路径
    async fn parse_image_source(
        &self,
        source: &str,
        context: &ToolContext,
    ) -> Result<(Vec<u8>, String), ToolError> {
        // base64: 格式
        if source.starts_with("base64:") {
            let base64_data = source.trim_start_matches("base64:");
            return match BASE64_STANDARD.decode(base64_data) {
                Ok(data) => {
                    let mime_type = self.detect_mime_type(&data);
                    Ok((data.to_vec(), mime_type))
                }
                Err(e) => Err(ToolError::invalid_params(format!(
                    "Invalid base64 data: {}",
                    e
                ))),
            };
        }

        // file:// 或本地路径
        let path = if source.starts_with("file://") {
            PathBuf::from(source.trim_start_matches("file://"))
        } else {
            // 本地路径（相对或绝对）
            let p = PathBuf::from(source);
            if p.is_absolute() {
                p
            } else {
                context.working_directory.join(&p)
            }
        };

        // 读取文件
        std::fs::read(&path)
            .map_err(|e| ToolError::execution_failed(format!("Failed to read image: {}", e)))
            .map(|data| {
                let mime_type = self.detect_mime_type(&data);
                (data, mime_type)
            })
    }

    /// 分析图片文件
    async fn analyze_image_file(
        &self,
        file_path: &Path,
        _context: &ToolContext,
    ) -> Result<AnalyzeImageResult, ToolError> {
        // 检查文件是否存在
        if !file_path.exists() {
            return Err(ToolError::execution_failed(format!(
                "Image file not found: {}",
                file_path.display()
            )));
        }

        // 使用 enhanced image processing 读取图片
        let image_result = read_image_file_enhanced(file_path)
            .map_err(|e| ToolError::execution_failed(format!("Failed to read image: {}", e)))?;

        // 估算 token
        let token_estimate = crate::media::estimate_image_tokens(&image_result.base64);

        // 检查 token 数
        if token_estimate as usize > self.max_tokens {
            return Err(ToolError::execution_failed(format!(
                "Image token count too high: ~{} tokens (max: {} tokens).\n\n\
                 Please compress the image to reduce its size. Recommended:\n\
                 - Reduce dimensions to 400x400 or smaller\n\
                 - Use JPEG quality 20-30%\n\
                 - Crop unnecessary areas\n\
                 Current: {} KB",
                token_estimate,
                self.max_tokens,
                image_result.original_size / 1024
            )));
        }

        Ok(AnalyzeImageResult {
            base64: image_result.base64,
            mime_type: image_result.mime_type,
            original_size: image_result.original_size,
            dimensions: image_result.dimensions.map(|d| ImageDimensions {
                original_width: d.original_width,
                original_height: d.original_height,
                display_width: d.display_width,
                display_height: d.display_height,
            }),
            token_estimate: Some(token_estimate as usize),
            prompt: None,
            compressed: false,
        })
    }

    /// 格式化输出
    fn format_output(&self, result: &AnalyzeImageResult) -> String {
        let mut parts = Vec::new();

        parts.push("📷 Image Analysis".to_string());
        parts.push(format!("Type: {}", result.mime_type));
        parts.push(format!("Size: {} KB", result.original_size / 1024));

        if let Some(ref dims) = result.dimensions {
            if let (Some(w), Some(h)) = (dims.original_width, dims.original_height) {
                parts.push(format!("Dimensions: {}x{}", w, h));
            }
        }

        if let Some(tokens) = result.token_estimate {
            parts.push(format!("Tokens: ~{}", tokens));
        }

        parts.push(format!("Compressed: {}", result.compressed));
        parts.push(format!("Data: {} chars", result.base64.len()));

        parts.join("\n")
    }
}

#[async_trait]
impl Tool for AnalyzeImageTool {
    fn name(&self) -> &str {
        "analyze_image"
    }

    fn description(&self) -> &str {
        "Analyze images by reading and converting them to AI-compatible format. Supports local files and base64 data."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Image file path or imageSource (file:///path, base64:data, or local path)"
                },
                "prompt": {
                    "type": "string",
                    "description": "Optional analysis prompt or question"
                }
            }
        })
    }

    async fn check_permissions(
        &self,
        _input: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // 解析输入参数
        let input: AnalyzeImageInput = serde_json::from_value(input)
            .map_err(|e| ToolError::invalid_params(format!("Invalid input: {}", e)))?;

        // 处理 file_path（支持 imageSource 和 file_path 两种格式）
        let (data, mime_type) = self.parse_image_source(&input.file_path, context).await?;

        // 估算 token
        let base64 = BASE64_STANDARD.encode(&data);
        let token_estimate = crate::media::estimate_image_tokens(&base64);

        // 检查 token 数
        if token_estimate as usize > self.max_tokens {
            return Err(ToolError::execution_failed(format!(
                "Image token count too high: ~{} tokens (max: {} tokens).\n\n\
                 Please use a smaller image.",
                token_estimate, self.max_tokens
            )));
        }

        // 构建结果
        let result = AnalyzeImageResult {
            base64,
            mime_type,
            original_size: data.len() as u64,
            dimensions: None,
            token_estimate: Some(token_estimate as usize),
            prompt: input.prompt,
            compressed: false,
        };

        let output = self.format_output(&result);

        Ok(ToolResult {
            success: true,
            output: Some(output),
            error: None,
            metadata: std::collections::HashMap::new(),
        })
    }
}
