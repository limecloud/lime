//! LSP Tool Implementation
//!
//! Provides Language Server Protocol integration for code intelligence features.
//! Supports go-to-definition, find-references, hover, completion, and diagnostics.
//!
//! Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;

/// Position in a text document (0-indexed)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    /// Line number (0-indexed)
    pub line: u32,
    /// Character offset (0-indexed)
    pub character: u32,
}

impl Position {
    /// Create a new position
    pub fn new(line: u32, character: u32) -> Self {
        Self { line, character }
    }
}

/// Range in a text document
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    /// Start position
    pub start: Position,
    /// End position
    pub end: Position,
}

impl Range {
    /// Create a new range
    pub fn new(start: Position, end: Position) -> Self {
        Self { start, end }
    }
}

/// Location in a document
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Location {
    /// File path
    pub path: PathBuf,
    /// Range in the file
    pub range: Range,
}

impl Location {
    /// Create a new location
    pub fn new(path: impl Into<PathBuf>, range: Range) -> Self {
        Self {
            path: path.into(),
            range,
        }
    }
}

/// Hover information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HoverInfo {
    /// The hover contents (markdown or plain text)
    pub contents: String,
    /// Optional range the hover applies to
    pub range: Option<Range>,
}

/// Completion item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
    /// The label of this completion item
    pub label: String,
    /// The kind of this completion item
    pub kind: Option<CompletionItemKind>,
    /// A human-readable string with additional information
    pub detail: Option<String>,
    /// A human-readable string that represents a doc-comment
    pub documentation: Option<String>,
    /// The text to insert when selecting this completion
    pub insert_text: Option<String>,
}

/// Completion item kind
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionItemKind {
    Text,
    Method,
    Function,
    Constructor,
    Field,
    Variable,
    Class,
    Interface,
    Module,
    Property,
    Unit,
    Value,
    Enum,
    Keyword,
    Snippet,
    Color,
    File,
    Reference,
    Folder,
    EnumMember,
    Constant,
    Struct,
    Event,
    Operator,
    TypeParameter,
}

/// Diagnostic severity
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

/// A diagnostic message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    /// The range at which the message applies
    pub range: Range,
    /// The diagnostic's severity
    pub severity: Option<DiagnosticSeverity>,
    /// The diagnostic's code
    pub code: Option<String>,
    /// A human-readable string describing the source of this diagnostic
    pub source: Option<String>,
    /// The diagnostic's message
    pub message: String,
}

/// LSP operation type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LspOperation {
    /// Go to definition
    Definition,
    /// Find references
    References,
    /// Get hover information
    Hover,
    /// Get completions
    Completion,
    /// Get diagnostics
    Diagnostics,
    /// Get document symbols
    DocumentSymbol,
    /// Search workspace symbols
    WorkspaceSymbol,
    /// Go to implementation
    Implementation,
    /// Prepare call hierarchy
    PrepareCallHierarchy,
    /// Get incoming calls
    IncomingCalls,
    /// Get outgoing calls
    OutgoingCalls,
}

/// Symbol kind for document/workspace symbols
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    File,
    Module,
    Namespace,
    Package,
    Class,
    Method,
    Property,
    Field,
    Constructor,
    Enum,
    Interface,
    Function,
    Variable,
    Constant,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Key,
    Null,
    EnumMember,
    Struct,
    Event,
    Operator,
    TypeParameter,
}

impl SymbolKind {
    /// Convert from LSP symbol kind number
    pub fn from_lsp(kind: u32) -> Self {
        match kind {
            1 => SymbolKind::File,
            2 => SymbolKind::Module,
            3 => SymbolKind::Namespace,
            4 => SymbolKind::Package,
            5 => SymbolKind::Class,
            6 => SymbolKind::Method,
            7 => SymbolKind::Property,
            8 => SymbolKind::Field,
            9 => SymbolKind::Constructor,
            10 => SymbolKind::Enum,
            11 => SymbolKind::Interface,
            12 => SymbolKind::Function,
            13 => SymbolKind::Variable,
            14 => SymbolKind::Constant,
            15 => SymbolKind::String,
            16 => SymbolKind::Number,
            17 => SymbolKind::Boolean,
            18 => SymbolKind::Array,
            19 => SymbolKind::Object,
            20 => SymbolKind::Key,
            21 => SymbolKind::Null,
            22 => SymbolKind::EnumMember,
            23 => SymbolKind::Struct,
            24 => SymbolKind::Event,
            25 => SymbolKind::Operator,
            26 => SymbolKind::TypeParameter,
            _ => SymbolKind::Variable,
        }
    }
}

/// Document symbol information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSymbol {
    /// The name of this symbol
    pub name: String,
    /// More detail for this symbol (e.g., signature)
    pub detail: Option<String>,
    /// The kind of this symbol
    pub kind: SymbolKind,
    /// The range enclosing this symbol
    pub range: Range,
    /// The range that should be selected when navigating to this symbol
    pub selection_range: Range,
    /// Children of this symbol (e.g., methods of a class)
    pub children: Vec<DocumentSymbol>,
}

/// Workspace symbol information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSymbol {
    /// The name of this symbol
    pub name: String,
    /// The kind of this symbol
    pub kind: SymbolKind,
    /// The location of this symbol
    pub location: Location,
    /// Container name (e.g., class name for methods)
    pub container_name: Option<String>,
}

/// Call hierarchy item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallHierarchyItem {
    /// The name of this item
    pub name: String,
    /// The kind of this item
    pub kind: SymbolKind,
    /// More detail for this item (e.g., signature)
    pub detail: Option<String>,
    /// The resource identifier of this item
    pub uri: String,
    /// The range enclosing this symbol
    pub range: Range,
    /// The range that should be selected when navigating to this item
    pub selection_range: Range,
}

/// Incoming call hierarchy item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallHierarchyIncomingCall {
    /// The item that makes the call
    pub from: CallHierarchyItem,
    /// The ranges at which the calls appear
    pub from_ranges: Vec<Range>,
}

/// Outgoing call hierarchy item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallHierarchyOutgoingCall {
    /// The item that is called
    pub to: CallHierarchyItem,
    /// The ranges at which the calls appear
    pub from_ranges: Vec<Range>,
}

/// Result of an LSP operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LspResult {
    /// Definition locations
    Definition { locations: Vec<Location> },
    /// Reference locations
    References { locations: Vec<Location> },
    /// Hover information
    Hover { info: Option<HoverInfo> },
    /// Completion items
    Completion { items: Vec<CompletionItem> },
    /// Diagnostics
    Diagnostics { diagnostics: Vec<Diagnostic> },
    /// Document symbols
    DocumentSymbol { symbols: Vec<DocumentSymbol> },
    /// Workspace symbols
    WorkspaceSymbol { symbols: Vec<WorkspaceSymbol> },
    /// Implementation locations
    Implementation { locations: Vec<Location> },
    /// Call hierarchy items
    CallHierarchy { items: Vec<CallHierarchyItem> },
    /// Incoming calls
    IncomingCalls {
        calls: Vec<CallHierarchyIncomingCall>,
    },
    /// Outgoing calls
    OutgoingCalls {
        calls: Vec<CallHierarchyOutgoingCall>,
    },
}

/// Callback type for LSP operations
///
/// The callback receives the operation type, file path, and position,
/// and returns the LSP result.
pub type LspCallback = Arc<
    dyn Fn(
            LspOperation,
            PathBuf,
            Option<Position>,
        ) -> Pin<Box<dyn Future<Output = Result<LspResult, String>> + Send>>
        + Send
        + Sync,
>;

/// LSP Tool for code intelligence
///
/// Provides access to Language Server Protocol features:
/// - Go to definition
/// - Find references
/// - Hover information
/// - Code completion
/// - Diagnostics
///
/// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
pub struct LspTool {
    /// Callback for LSP operations
    callback: Option<LspCallback>,
    /// Supported file extensions (empty means all)
    supported_extensions: Vec<String>,
}

impl Default for LspTool {
    fn default() -> Self {
        Self::new()
    }
}

impl LspTool {
    /// Create a new LspTool without a callback
    ///
    /// Note: Without a callback, the tool will return an error when executed.
    /// Use `with_callback` to set up the LSP handler.
    pub fn new() -> Self {
        Self {
            callback: None,
            supported_extensions: Vec::new(),
        }
    }

    /// Set the callback for LSP operations
    pub fn with_callback(mut self, callback: LspCallback) -> Self {
        self.callback = Some(callback);
        self
    }

    /// Set supported file extensions
    pub fn with_supported_extensions(mut self, extensions: Vec<String>) -> Self {
        self.supported_extensions = extensions;
        self
    }

    /// Check if a callback is configured
    pub fn has_callback(&self) -> bool {
        self.callback.is_some()
    }

    /// Check if a file extension is supported
    pub fn is_extension_supported(&self, path: &Path) -> bool {
        if self.supported_extensions.is_empty() {
            return true;
        }
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                self.supported_extensions
                    .iter()
                    .any(|supported| supported.eq_ignore_ascii_case(ext))
            })
            .unwrap_or(false)
    }

    /// Execute an LSP operation
    pub async fn execute_operation(
        &self,
        operation: LspOperation,
        path: &Path,
        position: Option<Position>,
    ) -> Result<LspResult, ToolError> {
        let callback = self
            .callback
            .as_ref()
            .ok_or_else(|| ToolError::execution_failed("LSP server is not available"))?;

        callback(operation, path.to_path_buf(), position)
            .await
            .map_err(ToolError::execution_failed)
    }

    /// Go to definition
    ///
    /// Requirements: 7.1
    pub async fn goto_definition(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<Location>, ToolError> {
        match self
            .execute_operation(LspOperation::Definition, path, Some(position))
            .await?
        {
            LspResult::Definition { locations } => Ok(locations),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Find references
    ///
    /// Requirements: 7.2
    pub async fn find_references(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<Location>, ToolError> {
        match self
            .execute_operation(LspOperation::References, path, Some(position))
            .await?
        {
            LspResult::References { locations } => Ok(locations),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Get hover information
    ///
    /// Requirements: 7.3
    pub async fn hover(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Option<HoverInfo>, ToolError> {
        match self
            .execute_operation(LspOperation::Hover, path, Some(position))
            .await?
        {
            LspResult::Hover { info } => Ok(info),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Get completions
    ///
    /// Requirements: 7.4
    pub async fn completions(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<CompletionItem>, ToolError> {
        match self
            .execute_operation(LspOperation::Completion, path, Some(position))
            .await?
        {
            LspResult::Completion { items } => Ok(items),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Get diagnostics
    ///
    /// Requirements: 7.5
    pub async fn diagnostics(&self, path: &Path) -> Result<Vec<Diagnostic>, ToolError> {
        match self
            .execute_operation(LspOperation::Diagnostics, path, None)
            .await?
        {
            LspResult::Diagnostics { diagnostics } => Ok(diagnostics),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Get document symbols
    ///
    /// Requirements: 7.6
    pub async fn document_symbols(&self, path: &Path) -> Result<Vec<DocumentSymbol>, ToolError> {
        match self
            .execute_operation(LspOperation::DocumentSymbol, path, None)
            .await?
        {
            LspResult::DocumentSymbol { symbols } => Ok(symbols),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Search workspace symbols
    ///
    /// Requirements: 7.7
    pub async fn workspace_symbols(&self, path: &Path) -> Result<Vec<WorkspaceSymbol>, ToolError> {
        match self
            .execute_operation(LspOperation::WorkspaceSymbol, path, None)
            .await?
        {
            LspResult::WorkspaceSymbol { symbols } => Ok(symbols),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Go to implementation
    ///
    /// Requirements: 7.8
    pub async fn goto_implementation(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<Location>, ToolError> {
        match self
            .execute_operation(LspOperation::Implementation, path, Some(position))
            .await?
        {
            LspResult::Implementation { locations } => Ok(locations),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Prepare call hierarchy
    ///
    /// Requirements: 7.9
    pub async fn prepare_call_hierarchy(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<CallHierarchyItem>, ToolError> {
        match self
            .execute_operation(LspOperation::PrepareCallHierarchy, path, Some(position))
            .await?
        {
            LspResult::CallHierarchy { items } => Ok(items),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Get incoming calls
    ///
    /// Requirements: 7.10
    pub async fn incoming_calls(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<CallHierarchyIncomingCall>, ToolError> {
        match self
            .execute_operation(LspOperation::IncomingCalls, path, Some(position))
            .await?
        {
            LspResult::IncomingCalls { calls } => Ok(calls),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }

    /// Get outgoing calls
    ///
    /// Requirements: 7.11
    pub async fn outgoing_calls(
        &self,
        path: &Path,
        position: Position,
    ) -> Result<Vec<CallHierarchyOutgoingCall>, ToolError> {
        match self
            .execute_operation(LspOperation::OutgoingCalls, path, Some(position))
            .await?
        {
            LspResult::OutgoingCalls { calls } => Ok(calls),
            _ => Err(ToolError::execution_failed("Unexpected LSP result type")),
        }
    }
}

#[async_trait]
impl Tool for LspTool {
    fn name(&self) -> &str {
        "LSP"
    }

    fn description(&self) -> &str {
        "Access Language Server Protocol features for code intelligence. \
         Supports go-to-definition, find-references, hover information, \
         code completion, and diagnostics retrieval."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": [
                        "definition", "references", "hover", "completion", "diagnostics",
                        "document_symbol", "workspace_symbol", "implementation",
                        "prepare_call_hierarchy", "incoming_calls", "outgoing_calls"
                    ],
                    "description": "The LSP operation to perform"
                },
                "path": {
                    "type": "string",
                    "description": "Path to the file"
                },
                "line": {
                    "type": "integer",
                    "description": "Line number (0-indexed, required for position-based operations)"
                },
                "character": {
                    "type": "integer",
                    "description": "Character offset (0-indexed, required for position-based operations)"
                }
            },
            "required": ["operation", "path"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Parse operation
        let operation_str = params
            .get("operation")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: operation"))?;

        let operation = match operation_str {
            "definition" => LspOperation::Definition,
            "references" => LspOperation::References,
            "hover" => LspOperation::Hover,
            "completion" => LspOperation::Completion,
            "diagnostics" => LspOperation::Diagnostics,
            "document_symbol" => LspOperation::DocumentSymbol,
            "workspace_symbol" => LspOperation::WorkspaceSymbol,
            "implementation" => LspOperation::Implementation,
            "prepare_call_hierarchy" => LspOperation::PrepareCallHierarchy,
            "incoming_calls" => LspOperation::IncomingCalls,
            "outgoing_calls" => LspOperation::OutgoingCalls,
            _ => return Err(ToolError::invalid_params(format!(
                "Invalid operation: {}. Must be one of: definition, references, hover, completion, diagnostics, \
                 document_symbol, workspace_symbol, implementation, prepare_call_hierarchy, incoming_calls, outgoing_calls",
                operation_str
            ))),
        };

        // Parse path
        let path_str = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: path"))?;

        let path = if Path::new(path_str).is_absolute() {
            PathBuf::from(path_str)
        } else {
            context.working_directory.join(path_str)
        };

        // Check file extension support
        if !self.is_extension_supported(&path) {
            return Err(ToolError::invalid_params(format!(
                "File extension not supported: {}",
                path.display()
            )));
        }

        // Parse position (required for most operations)
        let needs_position = !matches!(
            operation,
            LspOperation::Diagnostics
                | LspOperation::DocumentSymbol
                | LspOperation::WorkspaceSymbol
        );

        let position = if needs_position {
            let line = params.get("line").and_then(|v| v.as_u64()).ok_or_else(|| {
                ToolError::invalid_params(
                    "Missing required parameter: line (required for this operation)",
                )
            })? as u32;

            let character = params
                .get("character")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| {
                    ToolError::invalid_params(
                        "Missing required parameter: character (required for this operation)",
                    )
                })? as u32;

            Some(Position::new(line, character))
        } else {
            None
        };

        // Execute the operation
        let result = self.execute_operation(operation, &path, position).await?;

        // Format the output
        let output = format_lsp_result(&result, &path);

        Ok(ToolResult::success(output)
            .with_metadata("operation", serde_json::json!(operation_str))
            .with_metadata("path", serde_json::json!(path.display().to_string()))
            .with_metadata("result", serde_json::to_value(&result).unwrap_or_default()))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // LSP operations are read-only, so they're always allowed
        PermissionCheckResult::allow()
    }
}

/// Format LSP result for human-readable output
fn format_lsp_result(result: &LspResult, query_path: &Path) -> String {
    match result {
        LspResult::Definition { locations } => {
            if locations.is_empty() {
                "No definition found".to_string()
            } else {
                let mut output = format!("Found {} definition(s):\n", locations.len());
                for loc in locations {
                    output.push_str(&format!(
                        "  {}:{}:{}\n",
                        loc.path.display(),
                        loc.range.start.line + 1,
                        loc.range.start.character + 1
                    ));
                }
                output
            }
        }
        LspResult::References { locations } => {
            if locations.is_empty() {
                "No references found".to_string()
            } else {
                let mut output = format!("Found {} reference(s):\n", locations.len());
                for loc in locations {
                    output.push_str(&format!(
                        "  {}:{}:{}\n",
                        loc.path.display(),
                        loc.range.start.line + 1,
                        loc.range.start.character + 1
                    ));
                }
                output
            }
        }
        LspResult::Hover { info } => match info {
            Some(hover) => {
                let mut output = "Hover information:\n".to_string();
                output.push_str(&hover.contents);
                output
            }
            None => "No hover information available".to_string(),
        },
        LspResult::Completion { items } => {
            if items.is_empty() {
                "No completions available".to_string()
            } else {
                let mut output = format!("Found {} completion(s):\n", items.len());
                for item in items.iter().take(20) {
                    let kind_str = item.kind.map(|k| format!(" ({:?})", k)).unwrap_or_default();
                    output.push_str(&format!("  {}{}\n", item.label, kind_str));
                    if let Some(detail) = &item.detail {
                        output.push_str(&format!("    {}\n", detail));
                    }
                }
                if items.len() > 20 {
                    output.push_str(&format!("  ... and {} more\n", items.len() - 20));
                }
                output
            }
        }
        LspResult::Diagnostics { diagnostics } => {
            if diagnostics.is_empty() {
                format!("No diagnostics for {}", query_path.display())
            } else {
                let mut output = format!(
                    "Found {} diagnostic(s) in {}:\n",
                    diagnostics.len(),
                    query_path.display()
                );
                for diag in diagnostics {
                    let severity = diag
                        .severity
                        .map(|s| format!("{:?}", s))
                        .unwrap_or_else(|| "Unknown".to_string());
                    output.push_str(&format!(
                        "  [{}] {}:{}: {}\n",
                        severity,
                        diag.range.start.line + 1,
                        diag.range.start.character + 1,
                        diag.message
                    ));
                }
                output
            }
        }
        LspResult::DocumentSymbol { symbols } => {
            if symbols.is_empty() {
                "No symbols found in document".to_string()
            } else {
                let count = count_document_symbols(symbols);
                let mut output = format!("Found {} symbol(s) in document:\n", count);
                format_document_symbols(&mut output, symbols, 0);
                output
            }
        }
        LspResult::WorkspaceSymbol { symbols } => {
            if symbols.is_empty() {
                "No symbols found in workspace".to_string()
            } else {
                let mut output = format!("Found {} symbol(s) in workspace:\n", symbols.len());
                for sym in symbols {
                    let container = sym
                        .container_name
                        .as_ref()
                        .map(|c| format!(" in {}", c))
                        .unwrap_or_default();
                    output.push_str(&format!(
                        "  {} ({:?}) - {}:{}:{}{}\n",
                        sym.name,
                        sym.kind,
                        sym.location.path.display(),
                        sym.location.range.start.line + 1,
                        sym.location.range.start.character + 1,
                        container
                    ));
                }
                output
            }
        }
        LspResult::Implementation { locations } => {
            if locations.is_empty() {
                "No implementation found".to_string()
            } else {
                let mut output = format!("Found {} implementation(s):\n", locations.len());
                for loc in locations {
                    output.push_str(&format!(
                        "  {}:{}:{}\n",
                        loc.path.display(),
                        loc.range.start.line + 1,
                        loc.range.start.character + 1
                    ));
                }
                output
            }
        }
        LspResult::CallHierarchy { items } => {
            if items.is_empty() {
                "No call hierarchy item found at this position".to_string()
            } else {
                let mut output = format!("Found {} call hierarchy item(s):\n", items.len());
                for item in items {
                    let detail = item
                        .detail
                        .as_ref()
                        .map(|d| format!(" [{}]", d))
                        .unwrap_or_default();
                    output.push_str(&format!(
                        "  {} ({:?}) - {}:{}:{}{}\n",
                        item.name,
                        item.kind,
                        item.uri,
                        item.range.start.line + 1,
                        item.range.start.character + 1,
                        detail
                    ));
                }
                output
            }
        }
        LspResult::IncomingCalls { calls } => {
            if calls.is_empty() {
                "No incoming calls found (nothing calls this function)".to_string()
            } else {
                let mut output = format!("Found {} caller(s):\n", calls.len());
                for call in calls {
                    let ranges: Vec<String> = call
                        .from_ranges
                        .iter()
                        .map(|r| format!("{}:{}", r.start.line + 1, r.start.character + 1))
                        .collect();
                    let ranges_str = if ranges.is_empty() {
                        String::new()
                    } else {
                        format!(" [calls at: {}]", ranges.join(", "))
                    };
                    output.push_str(&format!(
                        "  {} ({:?}) - {}:{}:{}{}\n",
                        call.from.name,
                        call.from.kind,
                        call.from.uri,
                        call.from.range.start.line + 1,
                        call.from.range.start.character + 1,
                        ranges_str
                    ));
                }
                output
            }
        }
        LspResult::OutgoingCalls { calls } => {
            if calls.is_empty() {
                "No outgoing calls found (this function calls nothing)".to_string()
            } else {
                let mut output = format!("Found {} callee(s):\n", calls.len());
                for call in calls {
                    let ranges: Vec<String> = call
                        .from_ranges
                        .iter()
                        .map(|r| format!("{}:{}", r.start.line + 1, r.start.character + 1))
                        .collect();
                    let ranges_str = if ranges.is_empty() {
                        String::new()
                    } else {
                        format!(" [called from: {}]", ranges.join(", "))
                    };
                    output.push_str(&format!(
                        "  {} ({:?}) - {}:{}:{}{}\n",
                        call.to.name,
                        call.to.kind,
                        call.to.uri,
                        call.to.range.start.line + 1,
                        call.to.range.start.character + 1,
                        ranges_str
                    ));
                }
                output
            }
        }
    }
}

/// Count document symbols recursively
fn count_document_symbols(symbols: &[DocumentSymbol]) -> usize {
    let mut count = symbols.len();
    for sym in symbols {
        count += count_document_symbols(&sym.children);
    }
    count
}

/// Format document symbols with indentation
fn format_document_symbols(output: &mut String, symbols: &[DocumentSymbol], indent: usize) {
    let prefix = "  ".repeat(indent + 1);
    for sym in symbols {
        let detail = sym
            .detail
            .as_ref()
            .map(|d| format!(" - {}", d))
            .unwrap_or_default();
        output.push_str(&format!(
            "{}{} ({:?}) - Line {}{}\n",
            prefix,
            sym.name,
            sym.kind,
            sym.range.start.line + 1,
            detail
        ));
        if !sym.children.is_empty() {
            format_document_symbols(output, &sym.children, indent + 1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a mock callback that returns definition locations
    fn mock_definition_callback(locations: Vec<Location>) -> LspCallback {
        Arc::new(move |op, _path, _pos| {
            let locs = locations.clone();
            Box::pin(async move {
                match op {
                    LspOperation::Definition => Ok(LspResult::Definition { locations: locs }),
                    _ => Err("Unexpected operation".to_string()),
                }
            })
        })
    }

    /// Create a mock callback that returns references
    fn mock_references_callback(locations: Vec<Location>) -> LspCallback {
        Arc::new(move |op, _path, _pos| {
            let locs = locations.clone();
            Box::pin(async move {
                match op {
                    LspOperation::References => Ok(LspResult::References { locations: locs }),
                    _ => Err("Unexpected operation".to_string()),
                }
            })
        })
    }

    /// Create a mock callback that returns hover info
    fn mock_hover_callback(info: Option<HoverInfo>) -> LspCallback {
        Arc::new(move |op, _path, _pos| {
            let hover_info = info.clone();
            Box::pin(async move {
                match op {
                    LspOperation::Hover => Ok(LspResult::Hover { info: hover_info }),
                    _ => Err("Unexpected operation".to_string()),
                }
            })
        })
    }

    /// Create a mock callback that returns completions
    fn mock_completion_callback(items: Vec<CompletionItem>) -> LspCallback {
        Arc::new(move |op, _path, _pos| {
            let completion_items = items.clone();
            Box::pin(async move {
                match op {
                    LspOperation::Completion => Ok(LspResult::Completion {
                        items: completion_items,
                    }),
                    _ => Err("Unexpected operation".to_string()),
                }
            })
        })
    }

    /// Create a mock callback that returns diagnostics
    fn mock_diagnostics_callback(diagnostics: Vec<Diagnostic>) -> LspCallback {
        Arc::new(move |op, _path, _pos| {
            let diags = diagnostics.clone();
            Box::pin(async move {
                match op {
                    LspOperation::Diagnostics => Ok(LspResult::Diagnostics { diagnostics: diags }),
                    _ => Err("Unexpected operation".to_string()),
                }
            })
        })
    }

    /// Create a mock callback that returns an error
    fn mock_error_callback(error: &str) -> LspCallback {
        let err = error.to_string();
        Arc::new(move |_op, _path, _pos| {
            let e = err.clone();
            Box::pin(async move { Err(e) })
        })
    }

    /// Create a mock callback that handles all operations
    fn mock_all_operations_callback() -> LspCallback {
        Arc::new(|op, path, pos| {
            Box::pin(async move {
                match op {
                    LspOperation::Definition => Ok(LspResult::Definition {
                        locations: vec![Location::new(
                            path,
                            Range::new(Position::new(10, 5), Position::new(10, 15)),
                        )],
                    }),
                    LspOperation::References => Ok(LspResult::References {
                        locations: vec![
                            Location::new(
                                path.clone(),
                                Range::new(Position::new(10, 5), Position::new(10, 15)),
                            ),
                            Location::new(
                                path,
                                Range::new(Position::new(20, 10), Position::new(20, 20)),
                            ),
                        ],
                    }),
                    LspOperation::Hover => Ok(LspResult::Hover {
                        info: Some(HoverInfo {
                            contents: "fn example() -> String".to_string(),
                            range: pos
                                .map(|p| Range::new(p, Position::new(p.line, p.character + 7))),
                        }),
                    }),
                    LspOperation::Completion => Ok(LspResult::Completion {
                        items: vec![CompletionItem {
                            label: "example".to_string(),
                            kind: Some(CompletionItemKind::Function),
                            detail: Some("fn example() -> String".to_string()),
                            documentation: Some("An example function".to_string()),
                            insert_text: Some("example()".to_string()),
                        }],
                    }),
                    LspOperation::Diagnostics => Ok(LspResult::Diagnostics {
                        diagnostics: vec![Diagnostic {
                            range: Range::new(Position::new(5, 0), Position::new(5, 10)),
                            severity: Some(DiagnosticSeverity::Error),
                            code: Some("E0001".to_string()),
                            source: Some("rustc".to_string()),
                            message: "unused variable".to_string(),
                        }],
                    }),
                    LspOperation::DocumentSymbol => Ok(LspResult::DocumentSymbol {
                        symbols: vec![DocumentSymbol {
                            name: "main".to_string(),
                            detail: Some("fn main()".to_string()),
                            kind: SymbolKind::Function,
                            range: Range::new(Position::new(0, 0), Position::new(10, 1)),
                            selection_range: Range::new(Position::new(0, 3), Position::new(0, 7)),
                            children: vec![],
                        }],
                    }),
                    LspOperation::WorkspaceSymbol => Ok(LspResult::WorkspaceSymbol {
                        symbols: vec![WorkspaceSymbol {
                            name: "MyStruct".to_string(),
                            kind: SymbolKind::Struct,
                            location: Location::new(
                                path,
                                Range::new(Position::new(5, 0), Position::new(15, 1)),
                            ),
                            container_name: Some("module".to_string()),
                        }],
                    }),
                    LspOperation::Implementation => Ok(LspResult::Implementation {
                        locations: vec![Location::new(
                            path,
                            Range::new(Position::new(20, 0), Position::new(30, 1)),
                        )],
                    }),
                    LspOperation::PrepareCallHierarchy => Ok(LspResult::CallHierarchy {
                        items: vec![CallHierarchyItem {
                            name: "process".to_string(),
                            kind: SymbolKind::Function,
                            detail: Some("fn process()".to_string()),
                            uri: path.to_string_lossy().to_string(),
                            range: Range::new(Position::new(10, 0), Position::new(20, 1)),
                            selection_range: Range::new(
                                Position::new(10, 3),
                                Position::new(10, 10),
                            ),
                        }],
                    }),
                    LspOperation::IncomingCalls => Ok(LspResult::IncomingCalls {
                        calls: vec![CallHierarchyIncomingCall {
                            from: CallHierarchyItem {
                                name: "caller".to_string(),
                                kind: SymbolKind::Function,
                                detail: None,
                                uri: path.to_string_lossy().to_string(),
                                range: Range::new(Position::new(30, 0), Position::new(40, 1)),
                                selection_range: Range::new(
                                    Position::new(30, 3),
                                    Position::new(30, 9),
                                ),
                            },
                            from_ranges: vec![Range::new(
                                Position::new(35, 4),
                                Position::new(35, 11),
                            )],
                        }],
                    }),
                    LspOperation::OutgoingCalls => Ok(LspResult::OutgoingCalls {
                        calls: vec![CallHierarchyOutgoingCall {
                            to: CallHierarchyItem {
                                name: "callee".to_string(),
                                kind: SymbolKind::Function,
                                detail: None,
                                uri: path.to_string_lossy().to_string(),
                                range: Range::new(Position::new(50, 0), Position::new(60, 1)),
                                selection_range: Range::new(
                                    Position::new(50, 3),
                                    Position::new(50, 9),
                                ),
                            },
                            from_ranges: vec![Range::new(
                                Position::new(15, 4),
                                Position::new(15, 10),
                            )],
                        }],
                    }),
                }
            })
        })
    }

    #[test]
    fn test_position_new() {
        let pos = Position::new(10, 5);
        assert_eq!(pos.line, 10);
        assert_eq!(pos.character, 5);
    }

    #[test]
    fn test_range_new() {
        let range = Range::new(Position::new(1, 0), Position::new(1, 10));
        assert_eq!(range.start.line, 1);
        assert_eq!(range.end.character, 10);
    }

    #[test]
    fn test_location_new() {
        let loc = Location::new(
            "/path/to/file.rs",
            Range::new(Position::new(0, 0), Position::new(0, 5)),
        );
        assert_eq!(loc.path, PathBuf::from("/path/to/file.rs"));
    }

    #[test]
    fn test_lsp_tool_new() {
        let tool = LspTool::new();
        assert!(!tool.has_callback());
        assert!(tool.supported_extensions.is_empty());
    }

    #[test]
    fn test_lsp_tool_with_callback() {
        let callback = mock_definition_callback(vec![]);
        let tool = LspTool::new().with_callback(callback);
        assert!(tool.has_callback());
    }

    #[test]
    fn test_lsp_tool_with_supported_extensions() {
        let tool =
            LspTool::new().with_supported_extensions(vec!["rs".to_string(), "py".to_string()]);
        assert_eq!(tool.supported_extensions.len(), 2);
    }

    #[test]
    fn test_is_extension_supported_empty() {
        let tool = LspTool::new();
        assert!(tool.is_extension_supported(Path::new("file.rs")));
        assert!(tool.is_extension_supported(Path::new("file.py")));
        assert!(tool.is_extension_supported(Path::new("file")));
    }

    #[test]
    fn test_is_extension_supported_filtered() {
        let tool =
            LspTool::new().with_supported_extensions(vec!["rs".to_string(), "py".to_string()]);
        assert!(tool.is_extension_supported(Path::new("file.rs")));
        assert!(tool.is_extension_supported(Path::new("file.RS")));
        assert!(tool.is_extension_supported(Path::new("file.py")));
        assert!(!tool.is_extension_supported(Path::new("file.js")));
        assert!(!tool.is_extension_supported(Path::new("file")));
    }

    #[tokio::test]
    async fn test_goto_definition_success() {
        let locations = vec![Location::new(
            "/path/to/file.rs",
            Range::new(Position::new(10, 0), Position::new(10, 10)),
        )];
        let callback = mock_definition_callback(locations.clone());
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .goto_definition(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, PathBuf::from("/path/to/file.rs"));
    }

    #[tokio::test]
    async fn test_goto_definition_empty() {
        let callback = mock_definition_callback(vec![]);
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .goto_definition(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();

        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn test_find_references_success() {
        let locations = vec![
            Location::new(
                "/path/to/file.rs",
                Range::new(Position::new(10, 0), Position::new(10, 10)),
            ),
            Location::new(
                "/path/to/other.rs",
                Range::new(Position::new(20, 5), Position::new(20, 15)),
            ),
        ];
        let callback = mock_references_callback(locations);
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .find_references(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();

        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn test_hover_success() {
        let info = HoverInfo {
            contents: "fn example() -> String".to_string(),
            range: Some(Range::new(Position::new(5, 0), Position::new(5, 7))),
        };
        let callback = mock_hover_callback(Some(info));
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .hover(Path::new("/path/to/file.rs"), Position::new(5, 3))
            .await
            .unwrap();

        assert!(result.is_some());
        assert!(result.unwrap().contents.contains("example"));
    }

    #[tokio::test]
    async fn test_hover_none() {
        let callback = mock_hover_callback(None);
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .hover(Path::new("/path/to/file.rs"), Position::new(5, 3))
            .await
            .unwrap();

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_completions_success() {
        let items = vec![
            CompletionItem {
                label: "example".to_string(),
                kind: Some(CompletionItemKind::Function),
                detail: Some("fn example()".to_string()),
                documentation: None,
                insert_text: Some("example()".to_string()),
            },
            CompletionItem {
                label: "example2".to_string(),
                kind: Some(CompletionItemKind::Variable),
                detail: None,
                documentation: None,
                insert_text: None,
            },
        ];
        let callback = mock_completion_callback(items);
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .completions(Path::new("/path/to/file.rs"), Position::new(5, 3))
            .await
            .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].label, "example");
    }

    #[tokio::test]
    async fn test_diagnostics_success() {
        let diagnostics = vec![Diagnostic {
            range: Range::new(Position::new(5, 0), Position::new(5, 10)),
            severity: Some(DiagnosticSeverity::Error),
            code: Some("E0001".to_string()),
            source: Some("rustc".to_string()),
            message: "unused variable".to_string(),
        }];
        let callback = mock_diagnostics_callback(diagnostics);
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .diagnostics(Path::new("/path/to/file.rs"))
            .await
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].message, "unused variable");
    }

    #[tokio::test]
    async fn test_lsp_without_callback() {
        let tool = LspTool::new();
        let result = tool
            .goto_definition(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn test_lsp_callback_error() {
        let callback = mock_error_callback("LSP server crashed");
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .goto_definition(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ToolError::ExecutionFailed(_)));
    }

    #[tokio::test]
    async fn test_lsp_tool_trait_name() {
        let tool = LspTool::new();
        assert_eq!(tool.name(), "LSP");
    }

    #[tokio::test]
    async fn test_lsp_tool_trait_description() {
        let tool = LspTool::new();
        assert!(tool.description().contains("Language Server Protocol"));
    }

    #[tokio::test]
    async fn test_lsp_tool_trait_input_schema() {
        let tool = LspTool::new();
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["operation"].is_object());
        assert!(schema["properties"]["path"].is_object());
        assert!(schema["properties"]["line"].is_object());
        assert!(schema["properties"]["character"].is_object());
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_definition() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "definition",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("definition"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_references() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "references",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("reference"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_hover() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "hover",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("Hover"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_completion() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "completion",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("completion"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_diagnostics() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "diagnostics",
            "path": "file.rs"
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("diagnostic"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_missing_operation() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "path": "file.rs"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_invalid_operation() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "invalid",
            "path": "file.rs"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_missing_position() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "definition",
            "path": "file.rs"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_unsupported_extension() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new()
            .with_callback(callback)
            .with_supported_extensions(vec!["rs".to_string()]);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "diagnostics",
            "path": "file.py"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_lsp_tool_check_permissions() {
        let tool = LspTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"operation": "definition", "path": "file.rs"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[test]
    fn test_format_lsp_result_definition_empty() {
        let result = LspResult::Definition { locations: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No definition found"));
    }

    #[test]
    fn test_format_lsp_result_definition_found() {
        let result = LspResult::Definition {
            locations: vec![Location::new(
                "/path/to/file.rs",
                Range::new(Position::new(10, 5), Position::new(10, 15)),
            )],
        };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("1 definition"));
        assert!(output.contains("11:6")); // 1-indexed
    }

    #[test]
    fn test_format_lsp_result_hover_none() {
        let result = LspResult::Hover { info: None };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No hover information"));
    }

    #[test]
    fn test_format_lsp_result_diagnostics_empty() {
        let result = LspResult::Diagnostics {
            diagnostics: vec![],
        };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No diagnostics"));
    }

    #[test]
    fn test_completion_item_kind_serialization() {
        let kind = CompletionItemKind::Function;
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, "\"function\"");
    }

    #[test]
    fn test_diagnostic_severity_serialization() {
        let severity = DiagnosticSeverity::Error;
        let json = serde_json::to_string(&severity).unwrap();
        assert_eq!(json, "\"error\"");
    }

    #[test]
    fn test_lsp_operation_serialization() {
        let op = LspOperation::Definition;
        let json = serde_json::to_string(&op).unwrap();
        assert_eq!(json, "\"definition\"");
    }

    #[test]
    fn test_lsp_result_serialization() {
        let result = LspResult::Definition {
            locations: vec![Location::new(
                "/path/to/file.rs",
                Range::new(Position::new(0, 0), Position::new(0, 5)),
            )],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("definition"));
        assert!(json.contains("locations"));
    }

    // Tests for new operations

    #[test]
    fn test_symbol_kind_from_lsp() {
        assert_eq!(SymbolKind::from_lsp(1), SymbolKind::File);
        assert_eq!(SymbolKind::from_lsp(5), SymbolKind::Class);
        assert_eq!(SymbolKind::from_lsp(12), SymbolKind::Function);
        assert_eq!(SymbolKind::from_lsp(999), SymbolKind::Variable);
    }

    #[tokio::test]
    async fn test_document_symbols_success() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .document_symbols(Path::new("/path/to/file.rs"))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "main");
    }

    #[tokio::test]
    async fn test_workspace_symbols_success() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .workspace_symbols(Path::new("/path/to/file.rs"))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "MyStruct");
    }

    #[tokio::test]
    async fn test_goto_implementation_success() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .goto_implementation(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
    }

    #[tokio::test]
    async fn test_prepare_call_hierarchy_success() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .prepare_call_hierarchy(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "process");
    }

    #[tokio::test]
    async fn test_incoming_calls_success() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .incoming_calls(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].from.name, "caller");
    }

    #[tokio::test]
    async fn test_outgoing_calls_success() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);

        let result = tool
            .outgoing_calls(Path::new("/path/to/file.rs"), Position::new(5, 10))
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].to.name, "callee");
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_document_symbol() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "document_symbol",
            "path": "file.rs"
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("symbol"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_workspace_symbol() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "workspace_symbol",
            "path": "file.rs"
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("symbol"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_implementation() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "implementation",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("implementation"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_prepare_call_hierarchy() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "prepare_call_hierarchy",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("call hierarchy"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_incoming_calls() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "incoming_calls",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("caller"));
    }

    #[tokio::test]
    async fn test_lsp_tool_execute_outgoing_calls() {
        let callback = mock_all_operations_callback();
        let tool = LspTool::new().with_callback(callback);
        let context = ToolContext::new(PathBuf::from("/tmp"));

        let params = serde_json::json!({
            "operation": "outgoing_calls",
            "path": "file.rs",
            "line": 5,
            "character": 10
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.unwrap().contains("callee"));
    }

    #[test]
    fn test_format_lsp_result_document_symbol_empty() {
        let result = LspResult::DocumentSymbol { symbols: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No symbols found"));
    }

    #[test]
    fn test_format_lsp_result_document_symbol_found() {
        let result = LspResult::DocumentSymbol {
            symbols: vec![DocumentSymbol {
                name: "test_fn".to_string(),
                detail: Some("fn test_fn()".to_string()),
                kind: SymbolKind::Function,
                range: Range::new(Position::new(0, 0), Position::new(5, 1)),
                selection_range: Range::new(Position::new(0, 3), Position::new(0, 10)),
                children: vec![],
            }],
        };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("1 symbol"));
        assert!(output.contains("test_fn"));
    }

    #[test]
    fn test_format_lsp_result_workspace_symbol_empty() {
        let result = LspResult::WorkspaceSymbol { symbols: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No symbols found"));
    }

    #[test]
    fn test_format_lsp_result_implementation_empty() {
        let result = LspResult::Implementation { locations: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No implementation found"));
    }

    #[test]
    fn test_format_lsp_result_call_hierarchy_empty() {
        let result = LspResult::CallHierarchy { items: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No call hierarchy item"));
    }

    #[test]
    fn test_format_lsp_result_incoming_calls_empty() {
        let result = LspResult::IncomingCalls { calls: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No incoming calls"));
    }

    #[test]
    fn test_format_lsp_result_outgoing_calls_empty() {
        let result = LspResult::OutgoingCalls { calls: vec![] };
        let output = format_lsp_result(&result, Path::new("file.rs"));
        assert!(output.contains("No outgoing calls"));
    }

    #[test]
    fn test_symbol_kind_serialization() {
        let kind = SymbolKind::Function;
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, "\"function\"");
    }

    #[test]
    fn test_document_symbol_serialization() {
        let sym = DocumentSymbol {
            name: "test".to_string(),
            detail: None,
            kind: SymbolKind::Function,
            range: Range::new(Position::new(0, 0), Position::new(1, 0)),
            selection_range: Range::new(Position::new(0, 0), Position::new(0, 4)),
            children: vec![],
        };
        let json = serde_json::to_string(&sym).unwrap();
        assert!(json.contains("test"));
        assert!(json.contains("function"));
    }

    #[test]
    fn test_call_hierarchy_item_serialization() {
        let item = CallHierarchyItem {
            name: "process".to_string(),
            kind: SymbolKind::Function,
            detail: Some("fn process()".to_string()),
            uri: "file:///path/to/file.rs".to_string(),
            range: Range::new(Position::new(0, 0), Position::new(10, 1)),
            selection_range: Range::new(Position::new(0, 3), Position::new(0, 10)),
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("process"));
        assert!(json.contains("uri"));
    }

    #[test]
    fn test_new_lsp_operation_serialization() {
        assert_eq!(
            serde_json::to_string(&LspOperation::DocumentSymbol).unwrap(),
            "\"document_symbol\""
        );
        assert_eq!(
            serde_json::to_string(&LspOperation::WorkspaceSymbol).unwrap(),
            "\"workspace_symbol\""
        );
        assert_eq!(
            serde_json::to_string(&LspOperation::Implementation).unwrap(),
            "\"implementation\""
        );
        assert_eq!(
            serde_json::to_string(&LspOperation::PrepareCallHierarchy).unwrap(),
            "\"prepare_call_hierarchy\""
        );
        assert_eq!(
            serde_json::to_string(&LspOperation::IncomingCalls).unwrap(),
            "\"incoming_calls\""
        );
        assert_eq!(
            serde_json::to_string(&LspOperation::OutgoingCalls).unwrap(),
            "\"outgoing_calls\""
        );
    }
}
