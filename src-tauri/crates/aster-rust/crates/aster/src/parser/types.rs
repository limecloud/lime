//! Parser Types
//!
//! 代码解析相关的类型定义

use serde::{Deserialize, Serialize};

/// LSP 位置
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LspPosition {
    /// 行号 (0-indexed)
    pub line: u32,
    /// 列号 (0-indexed)
    pub character: u32,
}

/// LSP 范围
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LspRange {
    /// 起始位置
    pub start: LspPosition,
    /// 结束位置
    pub end: LspPosition,
}

/// LSP 位置信息
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LspLocation {
    /// 文件 URI
    pub uri: String,
    /// 范围
    pub range: LspRange,
}

/// LSP 符号类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[repr(u8)]
pub enum LspSymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    #[default]
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
}

/// LSP 文档符号
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspDocumentSymbol {
    /// 符号名称
    pub name: String,
    /// 详细信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// 符号类型
    pub kind: LspSymbolKind,
    /// 符号范围
    pub range: LspRange,
    /// 选择范围
    pub selection_range: LspRange,
    /// 子符号
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<LspDocumentSymbol>>,
}

/// LSP 符号信息 (旧版格式)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspSymbolInformation {
    /// 符号名称
    pub name: String,
    /// 符号类型
    pub kind: LspSymbolKind,
    /// 位置
    pub location: LspLocation,
    /// 容器名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_name: Option<String>,
}

/// 语法错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyntaxError {
    /// 错误消息
    pub message: String,
    /// 行号
    pub line: u32,
    /// 列号
    pub column: u32,
    /// 严重程度
    pub severity: ErrorSeverity,
}

/// 错误严重程度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorSeverity {
    Error,
    Warning,
}

/// 代码折叠区域
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoldingRange {
    /// 起始行
    pub start_line: u32,
    /// 结束行
    pub end_line: u32,
    /// 折叠类型
    pub kind: FoldingKind,
}

/// 折叠类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FoldingKind {
    Comment,
    Imports,
    Region,
    Block,
}

/// 语言配置
#[derive(Debug, Clone)]
pub struct LanguageConfig {
    /// 文件扩展名
    pub extensions: Vec<String>,
    /// 语言 ID
    pub language_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lsp_position() {
        let pos = LspPosition {
            line: 10,
            character: 5,
        };
        assert_eq!(pos.line, 10);
        assert_eq!(pos.character, 5);
    }

    #[test]
    fn test_lsp_range() {
        let range = LspRange {
            start: LspPosition {
                line: 0,
                character: 0,
            },
            end: LspPosition {
                line: 10,
                character: 20,
            },
        };
        assert_eq!(range.start.line, 0);
        assert_eq!(range.end.line, 10);
    }

    #[test]
    fn test_lsp_symbol_kind_default() {
        assert_eq!(LspSymbolKind::default(), LspSymbolKind::Variable);
    }

    #[test]
    fn test_folding_range() {
        let range = FoldingRange {
            start_line: 1,
            end_line: 10,
            kind: FoldingKind::Block,
        };
        assert_eq!(range.start_line, 1);
        assert_eq!(range.kind, FoldingKind::Block);
    }
}
