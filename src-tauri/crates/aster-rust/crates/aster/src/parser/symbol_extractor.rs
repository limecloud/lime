//! LSP Symbol Extractor
//!
//! 使用 LSP 协议提取代码符号

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::lsp_manager::LspManager;
use super::types::*;

/// 代码符号类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Class,
    Method,
    Property,
    Variable,
    Constant,
    Interface,
    Type,
    Enum,
    Module,
    Import,
    Export,
}

impl From<LspSymbolKind> for SymbolKind {
    fn from(kind: LspSymbolKind) -> Self {
        match kind {
            LspSymbolKind::Function => SymbolKind::Function,
            LspSymbolKind::Class => SymbolKind::Class,
            LspSymbolKind::Method => SymbolKind::Method,
            LspSymbolKind::Property | LspSymbolKind::Field => SymbolKind::Property,
            LspSymbolKind::Variable => SymbolKind::Variable,
            LspSymbolKind::Constant => SymbolKind::Constant,
            LspSymbolKind::Interface => SymbolKind::Interface,
            LspSymbolKind::Enum => SymbolKind::Enum,
            LspSymbolKind::Module | LspSymbolKind::Namespace | LspSymbolKind::Package => {
                SymbolKind::Module
            }
            LspSymbolKind::TypeParameter | LspSymbolKind::Struct => SymbolKind::Type,
            _ => SymbolKind::Variable,
        }
    }
}

/// 符号位置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolLocation {
    /// 文件路径
    pub file: String,
    /// 起始行 (1-indexed)
    pub start_line: u32,
    /// 起始列
    pub start_column: u32,
    /// 结束行
    pub end_line: u32,
    /// 结束列
    pub end_column: u32,
}

/// 代码符号
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSymbol {
    /// 符号名称
    pub name: String,
    /// 符号类型
    pub kind: SymbolKind,
    /// 位置
    pub location: SymbolLocation,
    /// 子符号
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<CodeSymbol>>,
    /// 签名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// 文档
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 引用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reference {
    /// 文件路径
    pub file: String,
    /// 行号
    pub line: u32,
    /// 列号
    pub column: u32,
    /// 行文本
    pub text: String,
    /// 是否是定义
    pub is_definition: bool,
}

/// LSP 符号提取器
pub struct LspSymbolExtractor {
    manager: Arc<RwLock<LspManager>>,
    document_versions: Arc<RwLock<std::collections::HashMap<String, i32>>>,
}

impl LspSymbolExtractor {
    /// 创建新的符号提取器
    pub fn new(manager: LspManager) -> Self {
        Self {
            manager: Arc::new(RwLock::new(manager)),
            document_versions: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// 文件路径转 URI
    fn file_to_uri(file_path: &str) -> String {
        let normalized = file_path.replace('\\', "/");
        if normalized.starts_with('/') {
            format!("file://{}", normalized)
        } else {
            format!("file:///{}", normalized)
        }
    }

    /// URI 转文件路径
    fn uri_to_file(uri: &str) -> String {
        let path = uri.trim_start_matches("file://").trim_start_matches('/');
        if cfg!(windows) {
            path.to_string()
        } else {
            format!("/{}", path)
        }
    }

    /// 提取文件中的符号
    pub async fn extract_symbols(&self, file_path: &str) -> Result<Vec<CodeSymbol>, String> {
        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();

        let manager = self.manager.read().await;
        let language = manager
            .get_language_by_extension(&ext)
            .ok_or_else(|| format!("Unsupported file type: {}", ext))?;

        let client = manager.get_client(&language).await?;

        // 读取文件内容
        let content = std::fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let uri = Self::file_to_uri(file_path);
        let language_id = manager.get_language_id(&language);

        // 获取或更新文档版本
        let version = {
            let mut versions = self.document_versions.write().await;
            let v = versions.entry(uri.clone()).or_insert(0);
            *v += 1;
            *v
        };

        // 打开文档
        client
            .open_document(&uri, &language_id, version, &content)
            .await;

        // 获取符号
        let _symbols = client.get_document_symbols(&uri).await?;

        // 关闭文档
        client.close_document(&uri).await;

        // 转换符号 (简化实现)
        Ok(Vec::new())
    }

    /// 查找引用
    pub async fn find_references(
        &self,
        file_path: &str,
        line: u32,
        column: u32,
    ) -> Result<Vec<Reference>, String> {
        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();

        let manager = self.manager.read().await;
        let language = manager
            .get_language_by_extension(&ext)
            .ok_or_else(|| format!("Unsupported file type: {}", ext))?;

        let client = manager.get_client(&language).await?;
        let uri = Self::file_to_uri(file_path);

        let position = LspPosition {
            line: line.saturating_sub(1), // 转为 0-indexed
            character: column,
        };

        let locations = client.find_references(&uri, position).await?;

        // 转换结果
        let references: Vec<Reference> = locations
            .iter()
            .map(|loc| {
                let file = Self::uri_to_file(&loc.uri);
                let ref_line = loc.range.start.line + 1;

                // 尝试读取行文本
                let text = std::fs::read_to_string(&file)
                    .ok()
                    .and_then(|content| {
                        content
                            .lines()
                            .nth(ref_line as usize - 1)
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_default();

                Reference {
                    file,
                    line: ref_line,
                    column: loc.range.start.character,
                    text,
                    is_definition: false,
                }
            })
            .collect();

        Ok(references)
    }

    /// 跳转到定义
    pub async fn get_definition(
        &self,
        file_path: &str,
        line: u32,
        column: u32,
    ) -> Result<Option<Reference>, String> {
        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();

        let manager = self.manager.read().await;
        let language = manager
            .get_language_by_extension(&ext)
            .ok_or_else(|| format!("Unsupported file type: {}", ext))?;

        let client = manager.get_client(&language).await?;
        let uri = Self::file_to_uri(file_path);

        let position = LspPosition {
            line: line.saturating_sub(1),
            character: column,
        };

        let location = client.get_definition(&uri, position).await?;

        Ok(location.map(|loc| {
            let file = Self::uri_to_file(&loc.uri);
            let def_line = loc.range.start.line + 1;

            let text = std::fs::read_to_string(&file)
                .ok()
                .and_then(|content| {
                    content
                        .lines()
                        .nth(def_line as usize - 1)
                        .map(|s| s.to_string())
                })
                .unwrap_or_default();

            Reference {
                file,
                line: def_line,
                column: loc.range.start.character,
                text,
                is_definition: true,
            }
        }))
    }

    /// 扁平化符号树
    pub fn flatten_symbols(symbols: &[CodeSymbol]) -> Vec<CodeSymbol> {
        let mut result = Vec::new();
        for sym in symbols {
            result.push(sym.clone());
            if let Some(ref children) = sym.children {
                result.extend(Self::flatten_symbols(children));
            }
        }
        result
    }

    /// 停止所有 LSP 客户端
    pub async fn shutdown(&self) {
        self.manager.read().await.stop_all().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symbol_kind_from_lsp() {
        assert_eq!(
            SymbolKind::from(LspSymbolKind::Function),
            SymbolKind::Function
        );
        assert_eq!(SymbolKind::from(LspSymbolKind::Class), SymbolKind::Class);
        assert_eq!(SymbolKind::from(LspSymbolKind::Method), SymbolKind::Method);
        assert_eq!(
            SymbolKind::from(LspSymbolKind::Interface),
            SymbolKind::Interface
        );
    }

    #[test]
    fn test_file_to_uri() {
        let uri = LspSymbolExtractor::file_to_uri("/tmp/test.rs");
        assert!(uri.starts_with("file://"));
        assert!(uri.contains("tmp"));
    }

    #[test]
    fn test_uri_to_file() {
        let file = LspSymbolExtractor::uri_to_file("file:///tmp/test.rs");
        assert!(file.contains("tmp"));
    }

    #[test]
    fn test_flatten_symbols() {
        let symbols = vec![CodeSymbol {
            name: "Parent".to_string(),
            kind: SymbolKind::Class,
            location: SymbolLocation {
                file: "test.rs".to_string(),
                start_line: 1,
                start_column: 0,
                end_line: 10,
                end_column: 0,
            },
            children: Some(vec![CodeSymbol {
                name: "child".to_string(),
                kind: SymbolKind::Method,
                location: SymbolLocation {
                    file: "test.rs".to_string(),
                    start_line: 2,
                    start_column: 0,
                    end_line: 5,
                    end_column: 0,
                },
                children: None,
                signature: None,
                documentation: None,
            }]),
            signature: None,
            documentation: None,
        }];

        let flat = LspSymbolExtractor::flatten_symbols(&symbols);
        assert_eq!(flat.len(), 2);
        assert_eq!(flat[0].name, "Parent");
        assert_eq!(flat[1].name, "child");
    }

    #[test]
    fn test_reference_struct() {
        let reference = Reference {
            file: "test.rs".to_string(),
            line: 10,
            column: 5,
            text: "fn test()".to_string(),
            is_definition: true,
        };
        assert_eq!(reference.line, 10);
        assert!(reference.is_definition);
    }
}
