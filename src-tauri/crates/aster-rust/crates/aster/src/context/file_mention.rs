//! File Mention Resolver
//!
//! This module provides functionality to parse and resolve file mentions
//! in text using the @ syntax. It supports:
//!
//! - Parsing @filename patterns from text
//! - Resolving file paths relative to working directory
//! - Trying common extensions if not specified
//! - Reading and including file content in processed text
//!
//! # Example
//!
//! ```ignore
//! use aster::context::file_mention::FileMentionResolver;
//!
//! let resolver = FileMentionResolver::new("/path/to/project");
//! let result = resolver.resolve_mentions("Check @main.rs for details").await?;
//! ```

use crate::context::types::{ContextError, FileMentionResult, ResolvedFile};
use regex::Regex;
use std::path::{Path, PathBuf};
use tokio::fs;

/// Common file extensions to try when resolving mentions without extensions.
pub const COMMON_EXTENSIONS: &[&str] = &[".rs", ".ts", ".js", ".md", ".py", ".go", ".tsx", ".jsx"];

/// File mention resolver for parsing and resolving @ mentions in text.
///
/// The resolver parses @filename patterns from text and attempts to resolve
/// them to actual files in the working directory. If a file is found, its
/// content is included in the processed text.
pub struct FileMentionResolver {
    /// Working directory for resolving relative paths
    working_directory: PathBuf,
}

impl FileMentionResolver {
    /// Create a new FileMentionResolver with the given working directory.
    ///
    /// # Arguments
    ///
    /// * `working_directory` - The base directory for resolving relative file paths
    ///
    /// # Example
    ///
    /// ```ignore
    /// let resolver = FileMentionResolver::new("/path/to/project");
    /// ```
    pub fn new(working_directory: impl Into<PathBuf>) -> Self {
        Self {
            working_directory: working_directory.into(),
        }
    }

    /// Get the working directory.
    pub fn working_directory(&self) -> &Path {
        &self.working_directory
    }

    /// Parse @filename patterns from text.
    ///
    /// This method extracts all @mentions from the text. It supports:
    /// - Simple mentions: @filename.rs
    /// - Path mentions: @src/main.rs
    /// - Mentions without extensions: @main
    ///
    /// # Arguments
    ///
    /// * `text` - The text to parse for mentions
    ///
    /// # Returns
    ///
    /// A vector of mention strings (without the @ prefix)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let mentions = FileMentionResolver::parse_mentions("Check @main.rs and @utils");
    /// assert_eq!(mentions, vec!["main.rs", "utils"]);
    /// ```
    pub fn parse_mentions(text: &str) -> Vec<String> {
        // Pattern matches @followed by a valid file path
        // - Starts with @
        // - Followed by alphanumeric, underscore, hyphen, dot, or forward slash
        // - Must not be preceded by alphanumeric (to avoid email addresses)
        // - Must not be followed by certain characters that indicate it's not a file mention
        let pattern = Regex::new(r"(?:^|[^a-zA-Z0-9])@([a-zA-Z0-9_\-./]+[a-zA-Z0-9_\-])").unwrap();

        let mut mentions = Vec::new();
        for cap in pattern.captures_iter(text) {
            if let Some(mention) = cap.get(1) {
                let mention_str = mention.as_str().to_string();
                // Filter out obvious non-file patterns
                if !mention_str.contains("..") && !mention_str.starts_with('/') {
                    mentions.push(mention_str);
                }
            }
        }

        mentions
    }

    /// Try to resolve a file path, attempting common extensions if needed.
    ///
    /// This method attempts to find a file matching the mention:
    /// 1. First tries the exact path
    /// 2. If not found and no extension, tries common extensions
    ///
    /// # Arguments
    ///
    /// * `mention` - The file mention to resolve (without @ prefix)
    ///
    /// # Returns
    ///
    /// `Some(PathBuf)` if a matching file is found, `None` otherwise
    pub fn try_resolve_path(&self, mention: &str) -> Option<PathBuf> {
        let base_path = self.working_directory.join(mention);

        // First, try the exact path
        if base_path.exists() && base_path.is_file() {
            return Some(base_path);
        }

        // If the mention has no extension, try common extensions
        if Path::new(mention).extension().is_none() {
            for ext in COMMON_EXTENSIONS {
                let path_with_ext = self.working_directory.join(format!("{}{}", mention, ext));
                if path_with_ext.exists() && path_with_ext.is_file() {
                    return Some(path_with_ext);
                }
            }
        }

        None
    }

    /// Resolve all @ mentions in text and read file contents.
    ///
    /// This method:
    /// 1. Parses all @mentions from the text
    /// 2. Attempts to resolve each mention to a file
    /// 3. Reads the content of found files
    /// 4. Returns processed text with file contents and list of resolved files
    ///
    /// If a file is not found, the mention is left unchanged in the text.
    ///
    /// # Arguments
    ///
    /// * `text` - The text containing @ mentions
    ///
    /// # Returns
    ///
    /// A `FileMentionResult` containing the processed text and resolved files
    ///
    /// # Errors
    ///
    /// Returns an error if file reading fails for a resolved file
    pub async fn resolve_mentions(&self, text: &str) -> Result<FileMentionResult, ContextError> {
        let mentions = Self::parse_mentions(text);
        let mut resolved_files = Vec::new();
        let mut processed_text = text.to_string();

        for mention in mentions {
            if let Some(path) = self.try_resolve_path(&mention) {
                match fs::read_to_string(&path).await {
                    Ok(content) => {
                        // Create the file reference block to insert
                        let file_block = format!(
                            "\n\n<file path=\"{}\">\n{}\n</file>\n",
                            path.display(),
                            content
                        );

                        // Replace the @mention with the file content
                        let mention_pattern = format!("@{}", mention);
                        processed_text = processed_text.replace(&mention_pattern, &file_block);

                        resolved_files.push(ResolvedFile::new(path, content));
                    }
                    Err(e) => {
                        // Log the error but continue processing other mentions
                        tracing::warn!(
                            "Failed to read file {} for mention @{}: {}",
                            path.display(),
                            mention,
                            e
                        );
                        // Leave the mention unchanged
                    }
                }
            }
            // If file not found, leave the mention unchanged (per requirement 7.5)
        }

        Ok(FileMentionResult::new(processed_text, resolved_files))
    }

    /// Resolve mentions synchronously (blocking).
    ///
    /// This is a convenience method for contexts where async is not available.
    /// It uses blocking file I/O.
    ///
    /// # Arguments
    ///
    /// * `text` - The text containing @ mentions
    ///
    /// # Returns
    ///
    /// A `FileMentionResult` containing the processed text and resolved files
    pub fn resolve_mentions_sync(&self, text: &str) -> Result<FileMentionResult, ContextError> {
        let mentions = Self::parse_mentions(text);
        let mut resolved_files = Vec::new();
        let mut processed_text = text.to_string();

        for mention in mentions {
            if let Some(path) = self.try_resolve_path(&mention) {
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        // Create the file reference block to insert
                        let file_block = format!(
                            "\n\n<file path=\"{}\">\n{}\n</file>\n",
                            path.display(),
                            content
                        );

                        // Replace the @mention with the file content
                        let mention_pattern = format!("@{}", mention);
                        processed_text = processed_text.replace(&mention_pattern, &file_block);

                        resolved_files.push(ResolvedFile::new(path, content));
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to read file {} for mention @{}: {}",
                            path.display(),
                            mention,
                            e
                        );
                    }
                }
            }
        }

        Ok(FileMentionResult::new(processed_text, resolved_files))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_parse_mentions_simple() {
        let text = "Check @main.rs for details";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert_eq!(mentions, vec!["main.rs"]);
    }

    #[test]
    fn test_parse_mentions_multiple() {
        let text = "Look at @main.rs and @utils.rs for the implementation";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert_eq!(mentions, vec!["main.rs", "utils.rs"]);
    }

    #[test]
    fn test_parse_mentions_with_path() {
        let text = "Check @src/lib.rs and @tests/test_main.rs";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert_eq!(mentions, vec!["src/lib.rs", "tests/test_main.rs"]);
    }

    #[test]
    fn test_parse_mentions_without_extension() {
        let text = "See @README and @main for more info";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert_eq!(mentions, vec!["README", "main"]);
    }

    #[test]
    fn test_parse_mentions_at_start() {
        let text = "@config.rs contains the settings";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert_eq!(mentions, vec!["config.rs"]);
    }

    #[test]
    fn test_parse_mentions_ignores_email() {
        let text = "Contact user@example.com for help";
        let mentions = FileMentionResolver::parse_mentions(text);
        // Should not match email addresses
        assert!(mentions.is_empty() || !mentions.contains(&"example.com".to_string()));
    }

    #[test]
    fn test_parse_mentions_with_hyphen_underscore() {
        let text = "Check @my-file.rs and @my_other_file.ts";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert_eq!(mentions, vec!["my-file.rs", "my_other_file.ts"]);
    }

    #[test]
    fn test_parse_mentions_empty_text() {
        let text = "";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert!(mentions.is_empty());
    }

    #[test]
    fn test_parse_mentions_no_mentions() {
        let text = "This text has no file mentions";
        let mentions = FileMentionResolver::parse_mentions(text);
        assert!(mentions.is_empty());
    }

    #[test]
    fn test_try_resolve_path_exact() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.rs");
        fs::write(&file_path, "fn main() {}").unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let resolved = resolver.try_resolve_path("test.rs");

        assert!(resolved.is_some());
        assert_eq!(resolved.unwrap(), file_path);
    }

    #[test]
    fn test_try_resolve_path_with_extension_fallback() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("main.rs");
        fs::write(&file_path, "fn main() {}").unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let resolved = resolver.try_resolve_path("main");

        assert!(resolved.is_some());
        assert_eq!(resolved.unwrap(), file_path);
    }

    #[test]
    fn test_try_resolve_path_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let resolver = FileMentionResolver::new(temp_dir.path());
        let resolved = resolver.try_resolve_path("nonexistent.rs");

        assert!(resolved.is_none());
    }

    #[test]
    fn test_try_resolve_path_subdirectory() {
        let temp_dir = TempDir::new().unwrap();
        let sub_dir = temp_dir.path().join("src");
        fs::create_dir(&sub_dir).unwrap();
        let file_path = sub_dir.join("lib.rs");
        fs::write(&file_path, "pub mod test;").unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let resolved = resolver.try_resolve_path("src/lib.rs");

        assert!(resolved.is_some());
        assert_eq!(resolved.unwrap(), file_path);
    }

    #[tokio::test]
    async fn test_resolve_mentions_single_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.rs");
        let content = "fn main() { println!(\"Hello\"); }";
        fs::write(&file_path, content).unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let result = resolver
            .resolve_mentions("Check @test.rs for details")
            .await
            .unwrap();

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].content, content);
        assert!(result.processed_text.contains(content));
        assert!(!result.processed_text.contains("@test.rs"));
    }

    #[tokio::test]
    async fn test_resolve_mentions_file_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let resolver = FileMentionResolver::new(temp_dir.path());
        let original_text = "Check @nonexistent.rs for details";
        let result = resolver.resolve_mentions(original_text).await.unwrap();

        // Mention should be left unchanged
        assert!(result.processed_text.contains("@nonexistent.rs"));
        assert!(result.files.is_empty());
    }

    #[tokio::test]
    async fn test_resolve_mentions_multiple_files() {
        let temp_dir = TempDir::new().unwrap();

        let file1_path = temp_dir.path().join("main.rs");
        fs::write(&file1_path, "fn main() {}").unwrap();

        let file2_path = temp_dir.path().join("lib.rs");
        fs::write(&file2_path, "pub mod utils;").unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let result = resolver
            .resolve_mentions("See @main.rs and @lib.rs")
            .await
            .unwrap();

        assert_eq!(result.files.len(), 2);
        assert!(result.processed_text.contains("fn main() {}"));
        assert!(result.processed_text.contains("pub mod utils;"));
    }

    #[tokio::test]
    async fn test_resolve_mentions_mixed_found_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("exists.rs");
        fs::write(&file_path, "// exists").unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let result = resolver
            .resolve_mentions("Check @exists.rs and @missing.rs")
            .await
            .unwrap();

        assert_eq!(result.files.len(), 1);
        assert!(result.processed_text.contains("// exists"));
        assert!(result.processed_text.contains("@missing.rs"));
    }

    #[test]
    fn test_resolve_mentions_sync() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("sync_test.rs");
        let content = "// sync test content";
        fs::write(&file_path, content).unwrap();

        let resolver = FileMentionResolver::new(temp_dir.path());
        let result = resolver
            .resolve_mentions_sync("Check @sync_test.rs")
            .unwrap();

        assert_eq!(result.files.len(), 1);
        assert!(result.processed_text.contains(content));
    }

    #[test]
    fn test_working_directory_getter() {
        let path = PathBuf::from("/test/path");
        let resolver = FileMentionResolver::new(&path);
        assert_eq!(resolver.working_directory(), &path);
    }
}
