//! AGENTS.md Parser
//!
//! This module provides functionality to parse AGENTS.md files and inject
//! their content into system prompts. It supports:
//!
//! - Searching for AGENTS.md in project root and .kiro directory
//! - Parsing markdown content and extracting instructions
//! - Extracting file references from markdown links
//! - Injecting parsed content into system prompts
//!
//! # Example
//!
//! ```ignore
//! use aster::context::agents_md_parser::AgentsMdParser;
//!
//! let config = AgentsMdParser::parse("/path/to/project").await?;
//! if let Some(config) = config {
//!     println!("Found AGENTS.md with {} file references", config.files.len());
//! }
//! ```

use crate::context::types::{AgentsMdConfig, ContextError};
use regex::Regex;
use std::path::{Path, PathBuf};
use tokio::fs;

/// AGENTS.md file names to search for
const AGENTS_MD_FILENAMES: &[&str] = &["AGENTS.md", "agents.md", "AGENT.md", "agent.md"];

/// Subdirectories to search for AGENTS.md
const AGENTS_MD_SUBDIRS: &[&str] = &[".kiro", ".claude", ".github"];

/// AGENTS.md parser for extracting project-specific instructions.
///
/// The parser searches for AGENTS.md files in standard locations and
/// extracts their content along with any file references found in
/// markdown links.
pub struct AgentsMdParser;

impl AgentsMdParser {
    /// Parse AGENTS.md file from the given directory.
    ///
    /// This method searches for AGENTS.md in:
    /// 1. Project root directory
    /// 2. .kiro subdirectory
    /// 3. .claude subdirectory
    /// 4. .github subdirectory
    ///
    /// # Arguments
    ///
    /// * `cwd` - The current working directory (project root)
    ///
    /// # Returns
    ///
    /// `Some(AgentsMdConfig)` if AGENTS.md is found, `None` otherwise
    ///
    /// # Errors
    ///
    /// Returns an error if file reading fails
    pub async fn parse(cwd: &Path) -> Result<Option<AgentsMdConfig>, ContextError> {
        let possible_paths = Self::get_possible_paths(cwd);

        for path in possible_paths {
            if path.exists() && path.is_file() {
                match fs::read_to_string(&path).await {
                    Ok(content) => {
                        let files = Self::extract_file_references(&content, cwd);
                        return Ok(Some(AgentsMdConfig::new(content, files)));
                    }
                    Err(e) => {
                        tracing::warn!("Failed to read AGENTS.md at {}: {}", path.display(), e);
                        // Continue searching other paths
                    }
                }
            }
        }

        Ok(None)
    }

    /// Parse AGENTS.md file synchronously (blocking).
    ///
    /// This is a convenience method for contexts where async is not available.
    ///
    /// # Arguments
    ///
    /// * `cwd` - The current working directory (project root)
    ///
    /// # Returns
    ///
    /// `Some(AgentsMdConfig)` if AGENTS.md is found, `None` otherwise
    pub fn parse_sync(cwd: &Path) -> Result<Option<AgentsMdConfig>, ContextError> {
        let possible_paths = Self::get_possible_paths(cwd);

        for path in possible_paths {
            if path.exists() && path.is_file() {
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        let files = Self::extract_file_references(&content, cwd);
                        return Ok(Some(AgentsMdConfig::new(content, files)));
                    }
                    Err(e) => {
                        tracing::warn!("Failed to read AGENTS.md at {}: {}", path.display(), e);
                    }
                }
            }
        }

        Ok(None)
    }

    /// Get all possible paths where AGENTS.md might be located.
    ///
    /// Returns paths in priority order:
    /// 1. Root directory AGENTS.md variants
    /// 2. Subdirectory AGENTS.md variants (.kiro, .claude, .github)
    ///
    /// # Arguments
    ///
    /// * `cwd` - The current working directory (project root)
    ///
    /// # Returns
    ///
    /// A vector of possible paths to check
    pub fn get_possible_paths(cwd: &Path) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        // First, check root directory
        for filename in AGENTS_MD_FILENAMES {
            paths.push(cwd.join(filename));
        }

        // Then check subdirectories
        for subdir in AGENTS_MD_SUBDIRS {
            for filename in AGENTS_MD_FILENAMES {
                paths.push(cwd.join(subdir).join(filename));
            }
        }

        paths
    }

    /// Extract file references from markdown content.
    ///
    /// This method extracts file paths from:
    /// - Markdown links: [text](path/to/file)
    /// - Code block file references: ```language:path/to/file
    /// - Explicit file mentions: `path/to/file`
    ///
    /// # Arguments
    ///
    /// * `text` - The markdown content to parse
    /// * `cwd` - The current working directory for resolving relative paths
    ///
    /// # Returns
    ///
    /// A vector of resolved file paths
    pub fn extract_file_references(text: &str, cwd: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();

        // Pattern 1: Markdown links [text](path)
        // Matches: [any text](relative/path/to/file.ext)
        let link_pattern = Regex::new(r"\[([^\]]*)\]\(([^)]+)\)").unwrap();
        for cap in link_pattern.captures_iter(text) {
            if let Some(path_match) = cap.get(2) {
                let path_str = path_match.as_str();
                // Filter out URLs and anchors
                if !path_str.starts_with("http")
                    && !path_str.starts_with('#')
                    && !path_str.starts_with("mailto:")
                {
                    let path = Self::resolve_path(path_str, cwd);
                    if path.exists() && !files.contains(&path) {
                        files.push(path);
                    }
                }
            }
        }

        // Pattern 2: Code block with file path ```language:path/to/file
        let code_block_pattern = Regex::new(r"```\w+:([^\s`]+)").unwrap();
        for cap in code_block_pattern.captures_iter(text) {
            if let Some(path_match) = cap.get(1) {
                let path = Self::resolve_path(path_match.as_str(), cwd);
                if path.exists() && !files.contains(&path) {
                    files.push(path);
                }
            }
        }

        // Pattern 3: Inline code file references `path/to/file.ext`
        // Only match paths that look like file paths (contain / or have extension)
        let inline_code_pattern = Regex::new(r"`([^`]+\.[a-zA-Z0-9]+)`").unwrap();
        for cap in inline_code_pattern.captures_iter(text) {
            if let Some(path_match) = cap.get(1) {
                let path_str = path_match.as_str();
                // Filter out code snippets and commands
                if !path_str.contains(' ')
                    && !path_str.starts_with('-')
                    && !path_str.starts_with('$')
                {
                    let path = Self::resolve_path(path_str, cwd);
                    if path.exists() && !files.contains(&path) {
                        files.push(path);
                    }
                }
            }
        }

        files
    }

    /// Resolve a path string relative to the working directory.
    ///
    /// Handles both absolute and relative paths.
    fn resolve_path(path_str: &str, cwd: &Path) -> PathBuf {
        let path = Path::new(path_str);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            cwd.join(path)
        }
    }

    /// Inject AGENTS.md content into a system prompt.
    ///
    /// This method:
    /// 1. Searches for AGENTS.md in the project
    /// 2. If found, appends its content to the system prompt
    /// 3. Returns the modified system prompt
    ///
    /// # Arguments
    ///
    /// * `system_prompt` - The original system prompt
    /// * `cwd` - The current working directory (project root)
    ///
    /// # Returns
    ///
    /// The system prompt with AGENTS.md content injected (if found)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let enhanced_prompt = AgentsMdParser::inject_to_system_prompt(
    ///     "You are a helpful assistant.",
    ///     Path::new("/path/to/project")
    /// ).await?;
    /// ```
    pub async fn inject_to_system_prompt(
        system_prompt: &str,
        cwd: &Path,
    ) -> Result<String, ContextError> {
        match Self::parse(cwd).await? {
            Some(config) => {
                let injected = format!(
                    "{}\n\n## Project Instructions (from AGENTS.md)\n\n{}",
                    system_prompt, config.content
                );
                Ok(injected)
            }
            None => Ok(system_prompt.to_string()),
        }
    }

    /// Inject AGENTS.md content into a system prompt synchronously.
    ///
    /// This is a convenience method for contexts where async is not available.
    pub fn inject_to_system_prompt_sync(
        system_prompt: &str,
        cwd: &Path,
    ) -> Result<String, ContextError> {
        match Self::parse_sync(cwd)? {
            Some(config) => {
                let injected = format!(
                    "{}\n\n## Project Instructions (from AGENTS.md)\n\n{}",
                    system_prompt, config.content
                );
                Ok(injected)
            }
            None => Ok(system_prompt.to_string()),
        }
    }

    /// Check if AGENTS.md exists in the given directory.
    ///
    /// # Arguments
    ///
    /// * `cwd` - The current working directory (project root)
    ///
    /// # Returns
    ///
    /// `true` if AGENTS.md exists, `false` otherwise
    pub fn exists(cwd: &Path) -> bool {
        Self::get_possible_paths(cwd)
            .iter()
            .any(|p| p.exists() && p.is_file())
    }

    /// Find the first existing AGENTS.md path.
    ///
    /// # Arguments
    ///
    /// * `cwd` - The current working directory (project root)
    ///
    /// # Returns
    ///
    /// `Some(PathBuf)` if found, `None` otherwise
    pub fn find_path(cwd: &Path) -> Option<PathBuf> {
        Self::get_possible_paths(cwd)
            .into_iter()
            .find(|p| p.exists() && p.is_file())
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
    fn test_get_possible_paths() {
        let cwd = Path::new("/test/project");
        let paths = AgentsMdParser::get_possible_paths(cwd);

        // Should include root directory variants
        assert!(paths.contains(&PathBuf::from("/test/project/AGENTS.md")));
        assert!(paths.contains(&PathBuf::from("/test/project/agents.md")));

        // Should include .kiro subdirectory
        assert!(paths.contains(&PathBuf::from("/test/project/.kiro/AGENTS.md")));

        // Should include .claude subdirectory
        assert!(paths.contains(&PathBuf::from("/test/project/.claude/AGENTS.md")));

        // Should include .github subdirectory
        assert!(paths.contains(&PathBuf::from("/test/project/.github/AGENTS.md")));
    }

    #[test]
    fn test_extract_file_references_markdown_links() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("src/main.rs");
        fs::create_dir_all(temp_dir.path().join("src")).unwrap();
        fs::write(&file_path, "fn main() {}").unwrap();

        let content = "Check [main file](src/main.rs) for details";
        let files = AgentsMdParser::extract_file_references(content, temp_dir.path());

        assert_eq!(files.len(), 1);
        assert_eq!(files[0], file_path);
    }

    #[test]
    fn test_extract_file_references_ignores_urls() {
        let temp_dir = TempDir::new().unwrap();
        let content = "See [docs](https://example.com) and [anchor](#section)";
        let files = AgentsMdParser::extract_file_references(content, temp_dir.path());

        assert!(files.is_empty());
    }

    #[test]
    fn test_extract_file_references_inline_code() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("config.json");
        fs::write(&file_path, "{}").unwrap();

        let content = "Edit `config.json` to configure";
        let files = AgentsMdParser::extract_file_references(content, temp_dir.path());

        assert_eq!(files.len(), 1);
        assert_eq!(files[0], file_path);
    }

    #[test]
    fn test_extract_file_references_no_duplicates() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("main.rs");
        fs::write(&file_path, "fn main() {}").unwrap();

        let content = "See [main](main.rs) and also `main.rs` for details";
        let files = AgentsMdParser::extract_file_references(content, temp_dir.path());

        assert_eq!(files.len(), 1);
    }

    #[test]
    fn test_extract_file_references_nonexistent_files() {
        let temp_dir = TempDir::new().unwrap();
        let content = "See [missing](nonexistent.rs) file";
        let files = AgentsMdParser::extract_file_references(content, temp_dir.path());

        assert!(files.is_empty());
    }

    #[tokio::test]
    async fn test_parse_root_agents_md() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("AGENTS.md");
        let content = "# Project Instructions\n\nBuild with `cargo build`";
        fs::write(&agents_path, content).unwrap();

        let result = AgentsMdParser::parse(temp_dir.path()).await.unwrap();

        assert!(result.is_some());
        let config = result.unwrap();
        assert_eq!(config.content, content);
    }

    #[tokio::test]
    async fn test_parse_kiro_agents_md() {
        let temp_dir = TempDir::new().unwrap();
        let kiro_dir = temp_dir.path().join(".kiro");
        fs::create_dir(&kiro_dir).unwrap();
        let agents_path = kiro_dir.join("AGENTS.md");
        let content = "# Kiro Instructions";
        fs::write(&agents_path, content).unwrap();

        let result = AgentsMdParser::parse(temp_dir.path()).await.unwrap();

        assert!(result.is_some());
        let config = result.unwrap();
        assert_eq!(config.content, content);
    }

    #[tokio::test]
    async fn test_parse_prefers_root_over_subdir() {
        let temp_dir = TempDir::new().unwrap();

        // Create root AGENTS.md
        let root_agents = temp_dir.path().join("AGENTS.md");
        fs::write(&root_agents, "Root instructions").unwrap();

        // Create .kiro/AGENTS.md
        let kiro_dir = temp_dir.path().join(".kiro");
        fs::create_dir(&kiro_dir).unwrap();
        let kiro_agents = kiro_dir.join("AGENTS.md");
        fs::write(&kiro_agents, "Kiro instructions").unwrap();

        let result = AgentsMdParser::parse(temp_dir.path()).await.unwrap();

        assert!(result.is_some());
        let config = result.unwrap();
        // Should prefer root directory
        assert_eq!(config.content, "Root instructions");
    }

    #[tokio::test]
    async fn test_parse_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let result = AgentsMdParser::parse(temp_dir.path()).await.unwrap();

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_parse_with_file_references() {
        let temp_dir = TempDir::new().unwrap();

        // Create a referenced file
        let src_dir = temp_dir.path().join("src");
        fs::create_dir(&src_dir).unwrap();
        let main_rs = src_dir.join("main.rs");
        fs::write(&main_rs, "fn main() {}").unwrap();

        // Create AGENTS.md with reference
        let agents_path = temp_dir.path().join("AGENTS.md");
        let content = "# Instructions\n\nSee [main](src/main.rs) for entry point";
        fs::write(&agents_path, content).unwrap();

        let result = AgentsMdParser::parse(temp_dir.path()).await.unwrap();

        assert!(result.is_some());
        let config = result.unwrap();
        assert_eq!(config.files.len(), 1);
        assert_eq!(config.files[0], main_rs);
    }

    #[test]
    fn test_parse_sync() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("AGENTS.md");
        let content = "# Sync Test";
        fs::write(&agents_path, content).unwrap();

        let result = AgentsMdParser::parse_sync(temp_dir.path()).unwrap();

        assert!(result.is_some());
        assert_eq!(result.unwrap().content, content);
    }

    #[tokio::test]
    async fn test_inject_to_system_prompt_with_agents() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("AGENTS.md");
        let agents_content = "Build with cargo";
        fs::write(&agents_path, agents_content).unwrap();

        let system_prompt = "You are a helpful assistant.";
        let result = AgentsMdParser::inject_to_system_prompt(system_prompt, temp_dir.path())
            .await
            .unwrap();

        assert!(result.contains(system_prompt));
        assert!(result.contains(agents_content));
        assert!(result.contains("Project Instructions"));
    }

    #[tokio::test]
    async fn test_inject_to_system_prompt_without_agents() {
        let temp_dir = TempDir::new().unwrap();
        let system_prompt = "You are a helpful assistant.";

        let result = AgentsMdParser::inject_to_system_prompt(system_prompt, temp_dir.path())
            .await
            .unwrap();

        assert_eq!(result, system_prompt);
    }

    #[test]
    fn test_inject_to_system_prompt_sync() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_path, "Sync instructions").unwrap();

        let system_prompt = "Base prompt";
        let result =
            AgentsMdParser::inject_to_system_prompt_sync(system_prompt, temp_dir.path()).unwrap();

        assert!(result.contains(system_prompt));
        assert!(result.contains("Sync instructions"));
    }

    #[test]
    fn test_exists() {
        let temp_dir = TempDir::new().unwrap();

        // Initially should not exist
        assert!(!AgentsMdParser::exists(temp_dir.path()));

        // Create AGENTS.md
        let agents_path = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_path, "test").unwrap();

        // Now should exist
        assert!(AgentsMdParser::exists(temp_dir.path()));
    }

    #[test]
    fn test_find_path() {
        let temp_dir = TempDir::new().unwrap();

        // Initially should not find
        assert!(AgentsMdParser::find_path(temp_dir.path()).is_none());

        // Create AGENTS.md
        let agents_path = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_path, "test").unwrap();

        // Now should find
        let found = AgentsMdParser::find_path(temp_dir.path());
        assert!(found.is_some());
        assert_eq!(found.unwrap(), agents_path);
    }

    #[test]
    fn test_lowercase_agents_md() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("agents.md");
        fs::write(&agents_path, "lowercase").unwrap();

        let result = AgentsMdParser::parse_sync(temp_dir.path()).unwrap();

        assert!(result.is_some());
        assert_eq!(result.unwrap().content, "lowercase");
    }

    #[test]
    fn test_claude_subdir() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        fs::create_dir(&claude_dir).unwrap();
        let agents_path = claude_dir.join("AGENTS.md");
        fs::write(&agents_path, "claude instructions").unwrap();

        let result = AgentsMdParser::parse_sync(temp_dir.path()).unwrap();

        assert!(result.is_some());
        assert_eq!(result.unwrap().content, "claude instructions");
    }
}
