//! PDF 解析模块
//!

use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// PDF 最大文件大小 (32MB)
pub const PDF_MAX_SIZE: u64 = 33554432;

/// PDF 扩展名
pub static PDF_EXTENSIONS: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| HashSet::from(["pdf"]));

/// PDF 读取结果
#[derive(Debug, Clone)]
pub struct PdfReadResult {
    pub file_path: PathBuf,
    pub base64: String,
    pub original_size: u64,
}

/// 检查是否支持 PDF
pub fn is_pdf_supported() -> bool {
    std::env::var("ASTER_PDF_SUPPORT")
        .map(|v| v != "false")
        .unwrap_or(true)
}

/// 验证文件扩展名是否为 PDF
pub fn is_pdf_extension(ext: &str) -> bool {
    let normalized = ext.strip_prefix('.').unwrap_or(ext).to_lowercase();
    PDF_EXTENSIONS.contains(normalized.as_str())
}

/// 格式化字节大小
fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1048576 {
        format!("{:.2} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.2} MB", bytes as f64 / 1048576.0)
    }
}

/// 读取 PDF 文件并返回 base64
pub fn read_pdf_file(file_path: &Path) -> Result<PdfReadResult, String> {
    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let size = metadata.len();

    if size == 0 {
        return Err(format!("PDF file is empty: {}", file_path.display()));
    }

    if size > PDF_MAX_SIZE {
        return Err(format!(
            "PDF file size ({}) exceeds maximum allowed size ({}). PDF files must be less than 32MB.",
            format_bytes(size),
            format_bytes(PDF_MAX_SIZE)
        ));
    }

    let buffer = fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let base64 = STANDARD.encode(&buffer);

    Ok(PdfReadResult {
        file_path: file_path.to_path_buf(),
        base64,
        original_size: size,
    })
}

/// 验证 PDF 文件是否有效
pub fn validate_pdf_file(file_path: &Path) -> Result<(), String> {
    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let size = metadata.len();

    if size == 0 {
        return Err("PDF file is empty".to_string());
    }

    if size > PDF_MAX_SIZE {
        return Err(format!(
            "PDF file size ({}) exceeds maximum allowed size ({})",
            format_bytes(size),
            format_bytes(PDF_MAX_SIZE)
        ));
    }

    // 验证文件头（PDF 文件应以 %PDF- 开头）
    let buffer = fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    if buffer.len() >= 5 {
        let header = std::str::from_utf8(&buffer[..5]).unwrap_or("");
        if !header.starts_with("%PDF-") {
            return Err("File is not a valid PDF (invalid header)".to_string());
        }
    }

    Ok(())
}
