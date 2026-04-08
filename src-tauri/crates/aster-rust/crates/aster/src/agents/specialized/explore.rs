//! Explore Agent
//!
//! Specialized agent for codebase exploration with
//! file search, code search, and structure analysis.
//!
//! This module implements Requirements 13.1-13.7 from the design document.

use glob::Pattern;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Result type alias for explore operations
pub type ExploreResult<T> = Result<T, ExploreError>;

/// Error types for explore operations
#[derive(Debug, Error)]
pub enum ExploreError {
    /// Invalid path
    #[error("Invalid path: {0}")]
    InvalidPath(String),

    /// File not found
    #[error("File not found: {0}")]
    FileNotFound(String),

    /// Pattern error
    #[error("Invalid pattern: {0}")]
    PatternError(String),

    /// I/O error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Search error
    #[error("Search error: {0}")]
    SearchError(String),

    /// Analysis error
    #[error("Analysis error: {0}")]
    AnalysisError(String),
}

/// Thoroughness level for exploration
/// Determines how deep and comprehensive the exploration will be
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThoroughnessLevel {
    /// Quick exploration - minimal depth, fast results
    Quick,

    /// Medium exploration - balanced depth and speed
    #[default]
    Medium,

    /// Very thorough exploration - maximum depth, comprehensive results
    VeryThorough,
}

impl ThoroughnessLevel {
    /// Get the maximum depth for directory traversal
    pub fn max_depth(&self) -> usize {
        match self {
            ThoroughnessLevel::Quick => 2,
            ThoroughnessLevel::Medium => 5,
            ThoroughnessLevel::VeryThorough => 10,
        }
    }

    /// Get the maximum number of files to process
    pub fn max_files(&self) -> usize {
        match self {
            ThoroughnessLevel::Quick => 50,
            ThoroughnessLevel::Medium => 200,
            ThoroughnessLevel::VeryThorough => 1000,
        }
    }

    /// Get the number of context lines for code search
    pub fn context_lines(&self) -> usize {
        match self {
            ThoroughnessLevel::Quick => 1,
            ThoroughnessLevel::Medium => 3,
            ThoroughnessLevel::VeryThorough => 5,
        }
    }

    /// Get the maximum content size to read per file (in bytes)
    pub fn max_content_size(&self) -> usize {
        match self {
            ThoroughnessLevel::Quick => 10_000,
            ThoroughnessLevel::Medium => 50_000,
            ThoroughnessLevel::VeryThorough => 200_000,
        }
    }
}

/// Options for explore operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreOptions {
    /// Thoroughness level for exploration
    pub thoroughness: ThoroughnessLevel,

    /// Search query or description
    pub query: String,

    /// Target path to explore (defaults to current directory)
    pub target_path: Option<PathBuf>,

    /// File patterns to match (glob patterns)
    pub patterns: Option<Vec<String>>,

    /// Maximum number of results to return
    pub max_results: Option<usize>,

    /// Whether to include hidden files
    pub include_hidden: bool,
}

impl Default for ExploreOptions {
    fn default() -> Self {
        Self {
            thoroughness: ThoroughnessLevel::Medium,
            query: String::new(),
            target_path: None,
            patterns: None,
            max_results: None,
            include_hidden: false,
        }
    }
}

impl ExploreOptions {
    /// Create new explore options with a query
    pub fn new(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            ..Default::default()
        }
    }

    /// Set the thoroughness level
    pub fn with_thoroughness(mut self, level: ThoroughnessLevel) -> Self {
        self.thoroughness = level;
        self
    }

    /// Set the target path
    pub fn with_target_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.target_path = Some(path.into());
        self
    }

    /// Set file patterns
    pub fn with_patterns(mut self, patterns: Vec<String>) -> Self {
        self.patterns = Some(patterns);
        self
    }

    /// Set maximum results
    pub fn with_max_results(mut self, max: usize) -> Self {
        self.max_results = Some(max);
        self
    }

    /// Include hidden files
    pub fn with_hidden(mut self, include: bool) -> Self {
        self.include_hidden = include;
        self
    }

    /// Get effective max results based on thoroughness
    pub fn effective_max_results(&self) -> usize {
        self.max_results
            .unwrap_or_else(|| self.thoroughness.max_files())
    }
}

/// A code snippet found during search
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSnippet {
    /// File path containing the snippet
    pub file_path: PathBuf,

    /// Line number where the match starts
    pub line_number: usize,

    /// The matched line content
    pub content: String,

    /// Context lines before the match
    pub context_before: Vec<String>,

    /// Context lines after the match
    pub context_after: Vec<String>,

    /// The search term that matched
    pub matched_term: String,
}

impl CodeSnippet {
    /// Create a new code snippet
    pub fn new(
        file_path: impl Into<PathBuf>,
        line_number: usize,
        content: impl Into<String>,
        matched_term: impl Into<String>,
    ) -> Self {
        Self {
            file_path: file_path.into(),
            line_number,
            content: content.into(),
            context_before: Vec::new(),
            context_after: Vec::new(),
            matched_term: matched_term.into(),
        }
    }

    /// Add context lines
    pub fn with_context(mut self, before: Vec<String>, after: Vec<String>) -> Self {
        self.context_before = before;
        self.context_after = after;
        self
    }
}

/// Statistics from exploration
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExploreStats {
    /// Total files scanned
    pub files_scanned: usize,

    /// Total directories traversed
    pub directories_traversed: usize,

    /// Total matches found
    pub matches_found: usize,

    /// Total bytes read
    pub bytes_read: usize,

    /// Duration in milliseconds
    pub duration_ms: u64,

    /// Files by extension
    pub files_by_extension: HashMap<String, usize>,
}

impl ExploreStats {
    /// Create new stats
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a file scan
    pub fn record_file(&mut self, extension: Option<&str>, bytes: usize) {
        self.files_scanned += 1;
        self.bytes_read += bytes;
        if let Some(ext) = extension {
            *self.files_by_extension.entry(ext.to_string()).or_insert(0) += 1;
        }
    }

    /// Record a directory
    pub fn record_directory(&mut self) {
        self.directories_traversed += 1;
    }

    /// Record matches
    pub fn record_matches(&mut self, count: usize) {
        self.matches_found += count;
    }
}

/// Result of an exploration operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreResultData {
    /// Files found during exploration
    pub files: Vec<PathBuf>,

    /// Code snippets found during search
    pub code_snippets: Vec<CodeSnippet>,

    /// Summary of the exploration
    pub summary: String,

    /// Suggestions for further exploration
    pub suggestions: Vec<String>,

    /// Statistics from the exploration
    pub stats: ExploreStats,
}

impl Default for ExploreResultData {
    fn default() -> Self {
        Self {
            files: Vec::new(),
            code_snippets: Vec::new(),
            summary: String::new(),
            suggestions: Vec::new(),
            stats: ExploreStats::new(),
        }
    }
}

impl ExploreResultData {
    /// Create a new explore result
    pub fn new() -> Self {
        Self::default()
    }

    /// Add files to the result
    pub fn with_files(mut self, files: Vec<PathBuf>) -> Self {
        self.files = files;
        self
    }

    /// Add code snippets
    pub fn with_snippets(mut self, snippets: Vec<CodeSnippet>) -> Self {
        self.code_snippets = snippets;
        self
    }

    /// Set the summary
    pub fn with_summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = summary.into();
        self
    }

    /// Add suggestions
    pub fn with_suggestions(mut self, suggestions: Vec<String>) -> Self {
        self.suggestions = suggestions;
        self
    }

    /// Set statistics
    pub fn with_stats(mut self, stats: ExploreStats) -> Self {
        self.stats = stats;
        self
    }
}

/// Structure analysis result for a file
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructureAnalysis {
    /// File path
    pub file_path: PathBuf,

    /// Detected language
    pub language: Option<String>,

    /// Exported items (functions, classes, etc.)
    pub exports: Vec<String>,

    /// Imported modules/packages
    pub imports: Vec<String>,

    /// Class definitions
    pub classes: Vec<String>,

    /// Function definitions
    pub functions: Vec<String>,

    /// Interface/trait definitions
    pub interfaces: Vec<String>,

    /// Type definitions
    pub types: Vec<String>,

    /// Constants
    pub constants: Vec<String>,
}

impl StructureAnalysis {
    /// Create a new structure analysis
    pub fn new(file_path: impl Into<PathBuf>) -> Self {
        Self {
            file_path: file_path.into(),
            ..Default::default()
        }
    }

    /// Set the language
    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.language = Some(language.into());
        self
    }

    /// Check if the analysis found any structure
    pub fn has_structure(&self) -> bool {
        !self.exports.is_empty()
            || !self.imports.is_empty()
            || !self.classes.is_empty()
            || !self.functions.is_empty()
            || !self.interfaces.is_empty()
            || !self.types.is_empty()
            || !self.constants.is_empty()
    }

    /// Get total number of items found
    pub fn total_items(&self) -> usize {
        self.exports.len()
            + self.imports.len()
            + self.classes.len()
            + self.functions.len()
            + self.interfaces.len()
            + self.types.len()
            + self.constants.len()
    }
}

/// Explore Agent for codebase exploration
///
/// Provides functionality for:
/// - File pattern search
/// - Code content search
/// - Structure analysis
/// - Summary generation
pub struct ExploreAgent {
    options: ExploreOptions,
}

impl ExploreAgent {
    /// Create a new explore agent with options
    pub fn new(options: ExploreOptions) -> Self {
        Self { options }
    }

    /// Get the options
    pub fn options(&self) -> &ExploreOptions {
        &self.options
    }

    /// Get the effective target path
    fn target_path(&self) -> PathBuf {
        self.options
            .target_path
            .clone()
            .unwrap_or_else(|| PathBuf::from("."))
    }

    /// Check if a path should be included based on hidden file settings
    fn should_include_path(&self, path: &Path) -> bool {
        if self.options.include_hidden {
            return true;
        }

        // Only check the file/directory name itself, not the full path
        // This allows temp directories like /var/folders/.../T/... to work
        if let Some(name) = path.file_name() {
            if let Some(name_str) = name.to_str() {
                if name_str.starts_with('.') {
                    return false;
                }
            }
        }
        true
    }

    /// Check if a file matches the configured patterns
    fn matches_patterns(&self, path: &Path) -> bool {
        let patterns = match &self.options.patterns {
            Some(p) if !p.is_empty() => p,
            _ => return true, // No patterns means match all
        };

        let path_str = path.to_string_lossy();
        for pattern in patterns {
            // Try matching the full path
            if let Ok(glob) = Pattern::new(pattern) {
                if glob.matches(&path_str) {
                    return true;
                }
            }
            // Also try matching just the filename
            if let Some(filename) = path.file_name() {
                let filename_str = filename.to_string_lossy();
                if let Ok(glob) = Pattern::new(pattern) {
                    if glob.matches(&filename_str) {
                        return true;
                    }
                }
                // Handle simple extension patterns like "*.rs"
                if pattern.starts_with("*.") {
                    let ext = pattern.get(2..).unwrap_or("");
                    if let Some(file_ext) = path.extension() {
                        if file_ext.to_string_lossy() == ext {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    /// Perform exploration based on configured options
    pub async fn explore(&self) -> ExploreResult<ExploreResultData> {
        let start = std::time::Instant::now();
        let mut stats = ExploreStats::new();
        let mut files = Vec::new();
        let mut code_snippets = Vec::new();

        let target = self.target_path();
        if !target.exists() {
            return Err(ExploreError::InvalidPath(format!(
                "Target path does not exist: {}",
                target.display()
            )));
        }

        // Find files matching patterns
        let found_files = self.find_files_internal(&target, &mut stats)?;
        let max_results = self.options.effective_max_results();

        for file_path in found_files.into_iter().take(max_results) {
            files.push(file_path.clone());

            // If there's a query, search for it in the file
            if !self.options.query.is_empty() {
                if let Ok(snippets) = self.search_in_file(&file_path, &self.options.query) {
                    stats.record_matches(snippets.len());
                    code_snippets.extend(snippets);
                }
            }
        }

        stats.duration_ms = start.elapsed().as_millis() as u64;

        // Generate summary and suggestions
        let summary = self.generate_summary(&files, &code_snippets, &stats);
        let suggestions = self.generate_suggestions(&files, &code_snippets);

        Ok(ExploreResultData::new()
            .with_files(files)
            .with_snippets(code_snippets)
            .with_summary(summary)
            .with_suggestions(suggestions)
            .with_stats(stats))
    }

    /// Find files matching the configured patterns
    pub async fn find_files(&self, pattern: &str) -> ExploreResult<Vec<PathBuf>> {
        let mut stats = ExploreStats::new();
        let target = self.target_path();

        if !target.exists() {
            return Err(ExploreError::InvalidPath(format!(
                "Target path does not exist: {}",
                target.display()
            )));
        }

        // Create a temporary options with the pattern
        let temp_options = ExploreOptions {
            patterns: Some(vec![pattern.to_string()]),
            ..self.options.clone()
        };

        let temp_agent = ExploreAgent::new(temp_options);
        let files = temp_agent.find_files_internal(&target, &mut stats)?;

        let max_results = self.options.effective_max_results();
        Ok(files.into_iter().take(max_results).collect())
    }

    /// Internal file finding with stats tracking
    fn find_files_internal(
        &self,
        path: &Path,
        stats: &mut ExploreStats,
    ) -> ExploreResult<Vec<PathBuf>> {
        let mut files = Vec::new();
        let max_depth = self.options.thoroughness.max_depth();
        let max_files = self.options.effective_max_results();

        // Start with is_root=true to not filter the target path itself
        self.find_files_recursive(path, 0, max_depth, max_files, &mut files, stats, true)?;
        Ok(files)
    }

    #[allow(clippy::too_many_arguments)]
    fn find_files_recursive(
        &self,
        path: &Path,
        current_depth: usize,
        max_depth: usize,
        max_files: usize,
        files: &mut Vec<PathBuf>,
        stats: &mut ExploreStats,
        is_root: bool,
    ) -> ExploreResult<()> {
        if current_depth > max_depth || files.len() >= max_files {
            return Ok(());
        }

        if path.is_file() {
            if self.should_include_path(path) && self.matches_patterns(path) {
                let ext = path.extension().and_then(|e| e.to_str());
                let size = path.metadata().map(|m| m.len() as usize).unwrap_or(0);
                stats.record_file(ext, size);
                files.push(path.to_path_buf());
            }
            return Ok(());
        }

        if path.is_dir() {
            // Don't filter the root target path, only subdirectories
            if !is_root && !self.should_include_path(path) {
                return Ok(());
            }

            stats.record_directory();

            let entries = std::fs::read_dir(path)?;
            for entry in entries.flatten() {
                if files.len() >= max_files {
                    break;
                }
                self.find_files_recursive(
                    &entry.path(),
                    current_depth + 1,
                    max_depth,
                    max_files,
                    files,
                    stats,
                    false, // Children are not root
                )?;
            }
        }

        Ok(())
    }

    /// Search for code content in files
    pub async fn search_code(&self, keyword: &str) -> ExploreResult<Vec<CodeSnippet>> {
        let mut stats = ExploreStats::new();
        let target = self.target_path();

        if !target.exists() {
            return Err(ExploreError::InvalidPath(format!(
                "Target path does not exist: {}",
                target.display()
            )));
        }

        let files = self.find_files_internal(&target, &mut stats)?;
        let mut snippets = Vec::new();
        let max_results = self.options.effective_max_results();

        for file_path in files {
            if snippets.len() >= max_results {
                break;
            }

            if let Ok(file_snippets) = self.search_in_file(&file_path, keyword) {
                for snippet in file_snippets {
                    if snippets.len() >= max_results {
                        break;
                    }
                    snippets.push(snippet);
                }
            }
        }

        Ok(snippets)
    }

    /// Search for a keyword in a single file
    fn search_in_file(&self, path: &Path, keyword: &str) -> ExploreResult<Vec<CodeSnippet>> {
        let max_size = self.options.thoroughness.max_content_size();
        let context_lines = self.options.thoroughness.context_lines();

        let content = std::fs::read_to_string(path).map_err(|e| {
            ExploreError::Io(std::io::Error::new(
                e.kind(),
                format!("{}: {}", path.display(), e),
            ))
        })?;

        // Skip files that are too large
        if content.len() > max_size {
            return Ok(Vec::new());
        }

        let lines: Vec<&str> = content.lines().collect();
        let keyword_lower = keyword.to_lowercase();
        let mut snippets = Vec::new();

        for (idx, line) in lines.iter().enumerate() {
            if line.to_lowercase().contains(&keyword_lower) {
                let line_number = idx + 1;

                // Get context lines
                let start = idx.saturating_sub(context_lines);
                let end = (idx + context_lines + 1).min(lines.len());

                let context_before: Vec<String> =
                    lines[start..idx].iter().map(|s| s.to_string()).collect();
                let context_after: Vec<String> = lines[(idx + 1)..end]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();

                let snippet = CodeSnippet::new(path, line_number, *line, keyword)
                    .with_context(context_before, context_after);

                snippets.push(snippet);
            }
        }

        Ok(snippets)
    }

    /// Analyze the structure of a file
    pub fn analyze_structure(&self, file_path: &Path) -> ExploreResult<StructureAnalysis> {
        if !file_path.exists() {
            return Err(ExploreError::FileNotFound(file_path.display().to_string()));
        }

        if !file_path.is_file() {
            return Err(ExploreError::InvalidPath(format!(
                "Not a file: {}",
                file_path.display()
            )));
        }

        let content = std::fs::read_to_string(file_path)?;
        let language = self.detect_language(file_path);

        let mut analysis = StructureAnalysis::new(file_path);
        if let Some(lang) = &language {
            analysis = analysis.with_language(lang);
        }

        // Parse based on language
        match language.as_deref() {
            Some("rust") => self.analyze_rust(&content, &mut analysis),
            Some("python") => self.analyze_python(&content, &mut analysis),
            Some("javascript") | Some("typescript") => self.analyze_js_ts(&content, &mut analysis),
            Some("go") => self.analyze_go(&content, &mut analysis),
            _ => self.analyze_generic(&content, &mut analysis),
        }

        Ok(analysis)
    }

    /// Detect the programming language from file extension
    fn detect_language(&self, path: &Path) -> Option<String> {
        let ext = path.extension()?.to_str()?;
        match ext.to_lowercase().as_str() {
            "rs" => Some("rust".to_string()),
            "py" => Some("python".to_string()),
            "js" | "mjs" | "cjs" => Some("javascript".to_string()),
            "ts" | "tsx" => Some("typescript".to_string()),
            "go" => Some("go".to_string()),
            "java" => Some("java".to_string()),
            "c" | "h" => Some("c".to_string()),
            "cpp" | "cc" | "cxx" | "hpp" => Some("cpp".to_string()),
            "rb" => Some("ruby".to_string()),
            "php" => Some("php".to_string()),
            "swift" => Some("swift".to_string()),
            "kt" | "kts" => Some("kotlin".to_string()),
            "scala" => Some("scala".to_string()),
            "cs" => Some("csharp".to_string()),
            _ => None,
        }
    }

    /// Analyze Rust source code
    fn analyze_rust(&self, content: &str, analysis: &mut StructureAnalysis) {
        for line in content.lines() {
            let trimmed = line.trim();

            // Imports (use statements)
            if trimmed.starts_with("use ") {
                if let Some(import) = trimmed
                    .strip_prefix("use ")
                    .and_then(|s| s.strip_suffix(';'))
                {
                    analysis.imports.push(import.to_string());
                }
            }

            // Public exports
            if trimmed.starts_with("pub ") {
                if let Some(rest) = trimmed.strip_prefix("pub ") {
                    if rest.starts_with("fn ") {
                        if let Some(name) = self.extract_fn_name(rest) {
                            analysis.exports.push(name.clone());
                            analysis.functions.push(name);
                        }
                    } else if rest.starts_with("struct ") {
                        if let Some(name) = self.extract_type_name(rest, "struct ") {
                            analysis.exports.push(name.clone());
                            analysis.types.push(name);
                        }
                    } else if rest.starts_with("enum ") {
                        if let Some(name) = self.extract_type_name(rest, "enum ") {
                            analysis.exports.push(name.clone());
                            analysis.types.push(name);
                        }
                    } else if rest.starts_with("trait ") {
                        if let Some(name) = self.extract_type_name(rest, "trait ") {
                            analysis.exports.push(name.clone());
                            analysis.interfaces.push(name);
                        }
                    } else if rest.starts_with("const ") {
                        if let Some(name) = self.extract_const_name(rest) {
                            analysis.exports.push(name.clone());
                            analysis.constants.push(name);
                        }
                    }
                }
            }

            // Non-public items
            if trimmed.starts_with("fn ") && !trimmed.starts_with("fn main") {
                if let Some(name) = self.extract_fn_name(trimmed) {
                    if !analysis.functions.contains(&name) {
                        analysis.functions.push(name);
                    }
                }
            }

            if trimmed.starts_with("struct ") {
                if let Some(name) = self.extract_type_name(trimmed, "struct ") {
                    if !analysis.types.contains(&name) {
                        analysis.types.push(name);
                    }
                }
            }

            if trimmed.starts_with("impl ") {
                if let Some(name) = self.extract_impl_name(trimmed) {
                    if !analysis.classes.contains(&name) {
                        analysis.classes.push(name);
                    }
                }
            }
        }
    }

    /// Analyze Python source code
    fn analyze_python(&self, content: &str, analysis: &mut StructureAnalysis) {
        for line in content.lines() {
            let trimmed = line.trim();

            // Imports
            if trimmed.starts_with("import ") || trimmed.starts_with("from ") {
                analysis.imports.push(trimmed.to_string());
            }

            // Classes
            if trimmed.starts_with("class ") {
                if let Some(name) = self.extract_python_class_name(trimmed) {
                    analysis.classes.push(name.clone());
                    // Python classes are typically exported
                    if !name.starts_with('_') {
                        analysis.exports.push(name);
                    }
                }
            }

            // Functions (top-level, not indented)
            if line.starts_with("def ") {
                if let Some(name) = self.extract_python_fn_name(trimmed) {
                    analysis.functions.push(name.clone());
                    if !name.starts_with('_') {
                        analysis.exports.push(name);
                    }
                }
            }

            // Constants (uppercase at module level)
            if !line.starts_with(' ') && !line.starts_with('\t') {
                if let Some((name, _)) = trimmed.split_once('=') {
                    let name = name.trim();
                    if name.chars().all(|c| c.is_uppercase() || c == '_') && !name.is_empty() {
                        analysis.constants.push(name.to_string());
                    }
                }
            }
        }
    }

    /// Analyze JavaScript/TypeScript source code
    fn analyze_js_ts(&self, content: &str, analysis: &mut StructureAnalysis) {
        for line in content.lines() {
            let trimmed = line.trim();

            // Imports
            if trimmed.starts_with("import ") {
                analysis.imports.push(trimmed.to_string());
            }

            // Exports
            if trimmed.starts_with("export ") {
                let rest = trimmed.strip_prefix("export ").unwrap_or("");

                if rest.starts_with("default ") {
                    analysis.exports.push("default".to_string());
                } else if rest.starts_with("function ") {
                    if let Some(name) = self.extract_js_fn_name(rest) {
                        analysis.exports.push(name.clone());
                        analysis.functions.push(name);
                    }
                } else if rest.starts_with("class ") {
                    if let Some(name) = self.extract_js_class_name(rest) {
                        analysis.exports.push(name.clone());
                        analysis.classes.push(name);
                    }
                } else if rest.starts_with("interface ") {
                    if let Some(name) = self.extract_type_name(rest, "interface ") {
                        analysis.exports.push(name.clone());
                        analysis.interfaces.push(name);
                    }
                } else if rest.starts_with("type ") {
                    if let Some(name) = self.extract_type_name(rest, "type ") {
                        analysis.exports.push(name.clone());
                        analysis.types.push(name);
                    }
                } else if rest.starts_with("const ") {
                    if let Some(name) = self.extract_js_const_name(rest) {
                        analysis.exports.push(name.clone());
                        analysis.constants.push(name);
                    }
                }
            }

            // Non-exported items
            if trimmed.starts_with("function ") {
                if let Some(name) = self.extract_js_fn_name(trimmed) {
                    if !analysis.functions.contains(&name) {
                        analysis.functions.push(name);
                    }
                }
            }

            if trimmed.starts_with("class ") {
                if let Some(name) = self.extract_js_class_name(trimmed) {
                    if !analysis.classes.contains(&name) {
                        analysis.classes.push(name);
                    }
                }
            }

            if trimmed.starts_with("interface ") {
                if let Some(name) = self.extract_type_name(trimmed, "interface ") {
                    if !analysis.interfaces.contains(&name) {
                        analysis.interfaces.push(name);
                    }
                }
            }
        }
    }

    /// Analyze Go source code
    fn analyze_go(&self, content: &str, analysis: &mut StructureAnalysis) {
        for line in content.lines() {
            let trimmed = line.trim();

            // Imports
            if trimmed.starts_with("import ") || trimmed.starts_with("import (") {
                analysis.imports.push(trimmed.to_string());
            }

            // Functions
            if trimmed.starts_with("func ") {
                if let Some(name) = self.extract_go_fn_name(trimmed) {
                    analysis.functions.push(name.clone());
                    // Exported if starts with uppercase
                    if name
                        .chars()
                        .next()
                        .map(|c| c.is_uppercase())
                        .unwrap_or(false)
                    {
                        analysis.exports.push(name);
                    }
                }
            }

            // Types
            if trimmed.starts_with("type ") {
                if let Some(name) = self.extract_go_type_name(trimmed) {
                    if trimmed.contains(" struct ") {
                        analysis.types.push(name.clone());
                    } else if trimmed.contains(" interface ") {
                        analysis.interfaces.push(name.clone());
                    } else {
                        analysis.types.push(name.clone());
                    }
                    // Exported if starts with uppercase
                    if name
                        .chars()
                        .next()
                        .map(|c| c.is_uppercase())
                        .unwrap_or(false)
                    {
                        analysis.exports.push(name);
                    }
                }
            }

            // Constants
            if trimmed.starts_with("const ") {
                if let Some(name) = self.extract_go_const_name(trimmed) {
                    analysis.constants.push(name.clone());
                    if name
                        .chars()
                        .next()
                        .map(|c| c.is_uppercase())
                        .unwrap_or(false)
                    {
                        analysis.exports.push(name);
                    }
                }
            }
        }
    }

    /// Generic analysis for unknown languages
    fn analyze_generic(&self, content: &str, analysis: &mut StructureAnalysis) {
        for line in content.lines() {
            let trimmed = line.trim();

            // Look for common patterns
            if trimmed.contains("import ") || trimmed.contains("require(") {
                analysis.imports.push(trimmed.to_string());
            }

            if trimmed.contains("function ") || trimmed.contains("def ") || trimmed.contains("fn ")
            {
                analysis.functions.push(trimmed.to_string());
            }

            if trimmed.contains("class ") {
                analysis.classes.push(trimmed.to_string());
            }
        }
    }

    // Helper methods for name extraction

    fn extract_fn_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("fn ")?.trim();
        let name_end = rest.find(|c: char| c == '(' || c == '<' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_type_name(&self, line: &str, prefix: &str) -> Option<String> {
        let rest = line.strip_prefix(prefix)?.trim();
        let name_end =
            rest.find(|c: char| c == '{' || c == '<' || c == '(' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_const_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("const ")?.trim();
        let name_end = rest.find(|c: char| c == ':' || c == '=' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_impl_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("impl")?.trim();
        // Skip generic parameters
        let rest = if rest.starts_with('<') {
            let end = rest.find('>')?;
            rest.get(end + 1..)?.trim()
        } else {
            rest
        };
        let name_end = rest.find(|c: char| c == '{' || c == '<' || c.is_whitespace())?;
        let name = rest.get(..name_end)?.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    fn extract_python_class_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("class ")?.trim();
        let name_end = rest.find(|c: char| c == '(' || c == ':' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_python_fn_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("def ")?.trim();
        let name_end = rest.find('(')?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_js_fn_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("function ")?.trim();
        let name_end = rest.find(|c: char| c == '(' || c == '<' || c.is_whitespace())?;
        let name = rest.get(..name_end)?.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    fn extract_js_class_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("class ")?.trim();
        let name_end = rest.find(|c: char| c == '{' || c == '<' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_js_const_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("const ")?.trim();
        let name_end = rest.find(|c: char| c == '=' || c == ':' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_go_fn_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("func ")?.trim();
        // Handle method receivers: func (r *Receiver) Name()
        let rest = if rest.starts_with('(') {
            let end = rest.find(')')?;
            rest.get(end + 1..)?.trim()
        } else {
            rest
        };
        let name_end = rest.find(|c: char| c == '(' || c == '<' || c.is_whitespace())?;
        let name = rest.get(..name_end)?.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    fn extract_go_type_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("type ")?.trim();
        let name_end = rest.find(|c: char| c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    fn extract_go_const_name(&self, line: &str) -> Option<String> {
        let rest = line.strip_prefix("const ")?.trim();
        let name_end = rest.find(|c: char| c == '=' || c.is_whitespace())?;
        Some(rest.get(..name_end)?.to_string())
    }

    /// Generate a summary of the exploration results
    fn generate_summary(
        &self,
        files: &[PathBuf],
        snippets: &[CodeSnippet],
        stats: &ExploreStats,
    ) -> String {
        let mut summary = String::new();

        summary.push_str(&format!(
            "Exploration completed in {}ms\n",
            stats.duration_ms
        ));
        summary.push_str(&format!(
            "Scanned {} files across {} directories\n",
            stats.files_scanned, stats.directories_traversed
        ));

        if !files.is_empty() {
            summary.push_str(&format!("Found {} matching files\n", files.len()));
        }

        if !snippets.is_empty() {
            summary.push_str(&format!(
                "Found {} code matches for '{}'\n",
                snippets.len(),
                self.options.query
            ));
        }

        // File type breakdown
        if !stats.files_by_extension.is_empty() {
            summary.push_str("\nFile types:\n");
            let mut extensions: Vec<_> = stats.files_by_extension.iter().collect();
            extensions.sort_by(|a, b| b.1.cmp(a.1));
            for (ext, count) in extensions.iter().take(5) {
                summary.push_str(&format!("  .{}: {} files\n", ext, count));
            }
        }

        summary
    }

    /// Generate suggestions based on exploration results
    fn generate_suggestions(&self, files: &[PathBuf], snippets: &[CodeSnippet]) -> Vec<String> {
        let mut suggestions = Vec::new();

        if files.is_empty() && snippets.is_empty() {
            suggestions.push("No results found. Try broadening your search patterns.".to_string());
            suggestions.push("Consider using wildcards like *.rs or **/*.py".to_string());
        }

        if files.len() >= self.options.effective_max_results() {
            suggestions.push(format!(
                "Results limited to {}. Use more specific patterns to narrow down.",
                self.options.effective_max_results()
            ));
        }

        if !self.options.query.is_empty() && snippets.is_empty() && !files.is_empty() {
            suggestions.push(format!(
                "No code matches for '{}'. The term might not exist in the matched files.",
                self.options.query
            ));
        }

        if self.options.thoroughness == ThoroughnessLevel::Quick && files.len() > 40 {
            suggestions.push(
                "Consider using 'medium' or 'very_thorough' for more comprehensive results."
                    .to_string(),
            );
        }

        suggestions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_files(dir: &Path) -> std::io::Result<()> {
        // Create Rust file
        fs::write(
            dir.join("main.rs"),
            r#"use std::io;

pub fn hello() {
    println!("Hello");
}

pub struct MyStruct {
    field: i32,
}

impl MyStruct {
    pub fn new() -> Self {
        Self { field: 0 }
    }
}

pub const MAX_SIZE: usize = 100;
"#,
        )?;

        // Create Python file
        fs::write(
            dir.join("script.py"),
            r#"import os
from pathlib import Path

MAX_COUNT = 10

class MyClass:
    def __init__(self):
        pass

def main():
    print("Hello")
"#,
        )?;

        // Create TypeScript file
        fs::write(
            dir.join("app.ts"),
            r#"import { Component } from 'react';

export interface User {
    name: string;
}

export class App {
    constructor() {}
}

export function render() {
    return null;
}

export const VERSION = "1.0.0";
"#,
        )?;

        // Create subdirectory with files
        let subdir = dir.join("src");
        fs::create_dir_all(&subdir)?;
        fs::write(subdir.join("lib.rs"), "pub mod utils;\n")?;

        Ok(())
    }

    #[test]
    fn test_thoroughness_level_defaults() {
        assert_eq!(ThoroughnessLevel::Quick.max_depth(), 2);
        assert_eq!(ThoroughnessLevel::Medium.max_depth(), 5);
        assert_eq!(ThoroughnessLevel::VeryThorough.max_depth(), 10);

        assert_eq!(ThoroughnessLevel::Quick.max_files(), 50);
        assert_eq!(ThoroughnessLevel::Medium.max_files(), 200);
        assert_eq!(ThoroughnessLevel::VeryThorough.max_files(), 1000);
    }

    #[test]
    fn test_explore_options_builder() {
        let options = ExploreOptions::new("test query")
            .with_thoroughness(ThoroughnessLevel::VeryThorough)
            .with_max_results(10)
            .with_hidden(true);

        assert_eq!(options.query, "test query");
        assert_eq!(options.thoroughness, ThoroughnessLevel::VeryThorough);
        assert_eq!(options.max_results, Some(10));
        assert!(options.include_hidden);
    }

    #[test]
    fn test_code_snippet_creation() {
        let snippet = CodeSnippet::new("/path/file.rs", 10, "let x = 1;", "let").with_context(
            vec!["// comment".to_string()],
            vec!["let y = 2;".to_string()],
        );

        assert_eq!(snippet.line_number, 10);
        assert_eq!(snippet.content, "let x = 1;");
        assert_eq!(snippet.matched_term, "let");
        assert_eq!(snippet.context_before.len(), 1);
        assert_eq!(snippet.context_after.len(), 1);
    }

    #[test]
    fn test_explore_stats() {
        let mut stats = ExploreStats::new();
        stats.record_file(Some("rs"), 1000);
        stats.record_file(Some("rs"), 500);
        stats.record_file(Some("py"), 200);
        stats.record_directory();
        stats.record_matches(5);

        assert_eq!(stats.files_scanned, 3);
        assert_eq!(stats.bytes_read, 1700);
        assert_eq!(stats.directories_traversed, 1);
        assert_eq!(stats.matches_found, 5);
        assert_eq!(stats.files_by_extension.get("rs"), Some(&2));
        assert_eq!(stats.files_by_extension.get("py"), Some(&1));
    }

    #[test]
    fn test_structure_analysis() {
        let mut analysis = StructureAnalysis::new("/path/file.rs").with_language("rust");

        assert!(!analysis.has_structure());
        assert_eq!(analysis.total_items(), 0);

        analysis.functions.push("test_fn".to_string());
        analysis.classes.push("TestClass".to_string());

        assert!(analysis.has_structure());
        assert_eq!(analysis.total_items(), 2);
    }

    #[tokio::test]
    async fn test_find_files_with_pattern() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(temp_dir.path()).unwrap();

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path())
            .with_patterns(vec!["*.rs".to_string()]);

        let agent = ExploreAgent::new(options);
        let result = agent.explore().await.unwrap();

        assert!(!result.files.is_empty(), "Should find .rs files");
        assert!(result
            .files
            .iter()
            .all(|f| f.extension().map(|e| e == "rs").unwrap_or(false)));
    }

    #[tokio::test]
    async fn test_explore_with_query() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(temp_dir.path()).unwrap();

        let options = ExploreOptions::new("Hello").with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let result = agent.explore().await.unwrap();

        assert!(!result.files.is_empty(), "Should find files");
        assert!(
            !result.code_snippets.is_empty(),
            "Should find code snippets containing 'Hello'"
        );
        assert!(!result.summary.is_empty());
    }

    #[tokio::test]
    async fn test_search_code() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(temp_dir.path()).unwrap();

        let options = ExploreOptions::new("").with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let snippets = agent.search_code("pub fn").await.unwrap();

        assert!(!snippets.is_empty(), "Should find 'pub fn' in Rust files");
        assert!(snippets.iter().all(|s| s.content.contains("pub fn")));
    }

    #[test]
    fn test_analyze_structure_rust() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(temp_dir.path()).unwrap();

        let options = ExploreOptions::new("").with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent
            .analyze_structure(&temp_dir.path().join("main.rs"))
            .unwrap();

        assert_eq!(analysis.language, Some("rust".to_string()));
        assert!(analysis.imports.iter().any(|i| i.contains("std::io")));
        assert!(analysis.functions.iter().any(|f| f == "hello"));
        assert!(analysis.types.iter().any(|t| t == "MyStruct"));
        assert!(analysis.classes.iter().any(|c| c == "MyStruct"));
        assert!(analysis.constants.iter().any(|c| c == "MAX_SIZE"));
    }

    #[test]
    fn test_analyze_structure_python() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(temp_dir.path()).unwrap();

        let options = ExploreOptions::new("").with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent
            .analyze_structure(&temp_dir.path().join("script.py"))
            .unwrap();

        assert_eq!(analysis.language, Some("python".to_string()));
        assert!(!analysis.imports.is_empty());
        assert!(analysis.classes.iter().any(|c| c == "MyClass"));
        assert!(analysis.functions.iter().any(|f| f == "main"));
    }

    #[test]
    fn test_analyze_structure_typescript() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(temp_dir.path()).unwrap();

        let options = ExploreOptions::new("").with_target_path(temp_dir.path());

        let agent = ExploreAgent::new(options);
        let analysis = agent
            .analyze_structure(&temp_dir.path().join("app.ts"))
            .unwrap();

        assert_eq!(analysis.language, Some("typescript".to_string()));
        assert!(analysis.interfaces.iter().any(|i| i == "User"));
        assert!(analysis.classes.iter().any(|c| c == "App"));
        assert!(analysis.functions.iter().any(|f| f == "render"));
        assert!(analysis.constants.iter().any(|c| c == "VERSION"));
    }

    #[test]
    fn test_hidden_file_filtering() {
        let temp_dir = TempDir::new().unwrap();
        let hidden_dir = temp_dir.path().join(".hidden");
        fs::create_dir_all(&hidden_dir).unwrap();
        fs::write(hidden_dir.join("secret.rs"), "// secret").unwrap();
        fs::write(temp_dir.path().join("visible.rs"), "// visible").unwrap();

        // Without hidden files
        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path())
            .with_hidden(false);

        let agent = ExploreAgent::new(options);
        let mut stats = ExploreStats::new();
        let files = agent
            .find_files_internal(temp_dir.path(), &mut stats)
            .unwrap();

        assert!(files
            .iter()
            .all(|f| !f.to_string_lossy().contains(".hidden")));

        // With hidden files
        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path())
            .with_hidden(true);

        let agent = ExploreAgent::new(options);
        let mut stats = ExploreStats::new();
        let files = agent
            .find_files_internal(temp_dir.path(), &mut stats)
            .unwrap();

        assert!(files
            .iter()
            .any(|f| f.to_string_lossy().contains(".hidden")));
    }

    #[tokio::test]
    async fn test_max_results_limit() {
        let temp_dir = TempDir::new().unwrap();

        // Create many files
        for i in 0..20 {
            fs::write(temp_dir.path().join(format!("file{}.rs", i)), "// content").unwrap();
        }

        let options = ExploreOptions::new("")
            .with_target_path(temp_dir.path())
            .with_max_results(5);

        let agent = ExploreAgent::new(options);
        let result = agent.explore().await.unwrap();

        assert!(result.files.len() <= 5);
    }

    #[test]
    fn test_explore_nonexistent_path() {
        let options =
            ExploreOptions::new("").with_target_path("/nonexistent/path/that/does/not/exist");

        let agent = ExploreAgent::new(options);
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(agent.explore());

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ExploreError::InvalidPath(_)));
    }

    #[test]
    fn test_analyze_nonexistent_file() {
        let options = ExploreOptions::new("");
        let agent = ExploreAgent::new(options);

        let result = agent.analyze_structure(Path::new("/nonexistent/file.rs"));
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ExploreError::FileNotFound(_)));
    }
}
