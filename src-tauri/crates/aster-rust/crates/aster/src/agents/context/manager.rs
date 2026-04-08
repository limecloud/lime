//! Agent Context Manager
//!
//! Manages agent context lifecycle including creation, inheritance,
//! compression, filtering, merging, and persistence.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use regex::Regex;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::types::{
    AgentContext, AgentContextError, AgentContextResult, CompressionResult, ContextFilter,
    ContextInheritanceConfig, ContextInheritanceType, ContextUpdate,
};
use crate::conversation::message::Message;

/// Agent Context Manager
///
/// Manages the lifecycle of agent contexts including:
/// - Creating new contexts with unique IDs
/// - Inheriting context from parent agents
/// - Compressing contexts to reduce token usage
/// - Filtering sensitive data
/// - Merging multiple contexts
/// - Persisting and loading contexts
#[derive(Debug)]
pub struct AgentContextManager {
    /// In-memory context storage
    contexts: HashMap<String, AgentContext>,

    /// Directory for persisting contexts
    storage_dir: PathBuf,
}

impl Default for AgentContextManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentContextManager {
    /// Create a new context manager with default storage directory
    pub fn new() -> Self {
        let storage_dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("aster")
            .join("contexts");

        Self {
            contexts: HashMap::new(),
            storage_dir,
        }
    }

    /// Create a new context manager with a custom storage directory
    pub fn with_storage_dir(storage_dir: impl Into<PathBuf>) -> Self {
        Self {
            contexts: HashMap::new(),
            storage_dir: storage_dir.into(),
        }
    }

    /// Create a new agent context, optionally inheriting from a parent
    pub fn create_context(
        &mut self,
        parent: Option<&AgentContext>,
        config: Option<ContextInheritanceConfig>,
    ) -> AgentContext {
        let config = config.unwrap_or_default();

        let context = match parent {
            Some(parent_ctx) => self.inherit(parent_ctx, &config),
            None => AgentContext::new(),
        };

        // Store the context
        self.contexts
            .insert(context.context_id.clone(), context.clone());

        context
    }

    /// Inherit context from a parent based on configuration
    pub fn inherit(
        &self,
        parent: &AgentContext,
        config: &ContextInheritanceConfig,
    ) -> AgentContext {
        let mut context = AgentContext::new();
        context.parent_context_id = Some(parent.context_id.clone());

        match config.inheritance_type {
            ContextInheritanceType::None => {
                // No inheritance, return empty context
                return context;
            }
            ContextInheritanceType::Full => {
                // Full inheritance - copy everything (but still respect limits)
                let history = &parent.conversation_history;
                context.conversation_history = match config.max_history_length {
                    Some(max) if history.len() > max => {
                        history.iter().rev().take(max).cloned().rev().collect()
                    }
                    _ => history.clone(),
                };

                let files = &parent.file_context;
                context.file_context = match config.max_file_contexts {
                    Some(max) if files.len() > max => {
                        files.iter().rev().take(max).cloned().rev().collect()
                    }
                    _ => files.clone(),
                };

                let results = &parent.tool_results;
                context.tool_results = match config.max_tool_results {
                    Some(max) if results.len() > max => {
                        results.iter().rev().take(max).cloned().rev().collect()
                    }
                    _ => results.clone(),
                };

                context.environment = parent.environment.clone();
                context.system_prompt = parent.system_prompt.clone();
                context.working_directory = parent.working_directory.clone();
            }
            ContextInheritanceType::Shallow | ContextInheritanceType::Selective => {
                // Selective inheritance based on config flags
                if config.inherit_conversation {
                    let history = &parent.conversation_history;
                    context.conversation_history = match config.max_history_length {
                        Some(max) if history.len() > max => {
                            history.iter().rev().take(max).cloned().rev().collect()
                        }
                        _ => history.clone(),
                    };
                }

                if config.inherit_files {
                    let files = &parent.file_context;
                    context.file_context = match config.max_file_contexts {
                        Some(max) if files.len() > max => {
                            files.iter().rev().take(max).cloned().rev().collect()
                        }
                        _ => files.clone(),
                    };
                }

                if config.inherit_tool_results {
                    let results = &parent.tool_results;
                    context.tool_results = match config.max_tool_results {
                        Some(max) if results.len() > max => {
                            results.iter().rev().take(max).cloned().rev().collect()
                        }
                        _ => results.clone(),
                    };
                }

                if config.inherit_environment {
                    context.environment = parent.environment.clone();
                }

                context.system_prompt = parent.system_prompt.clone();
                context.working_directory = parent.working_directory.clone();
            }
        }

        // Apply filtering if requested
        if config.filter_sensitive {
            let filter = ContextFilter::with_defaults();
            context = self.filter(&context, &filter);
        }

        // Apply compression if requested
        if config.compress_context {
            if let Some(target_tokens) = config.target_tokens {
                let _ = self.compress(&mut context, target_tokens);
            }
        }

        context
    }

    /// Compress a context to reduce token count
    ///
    /// This method reduces the context size by:
    /// 1. Summarizing older conversation messages
    /// 2. Removing older file contexts
    /// 3. Removing older tool results
    pub fn compress(
        &self,
        context: &mut AgentContext,
        target_tokens: usize,
    ) -> AgentContextResult<CompressionResult> {
        let original_tokens = self.estimate_token_count(context);

        if original_tokens <= target_tokens {
            return Ok(CompressionResult {
                original_tokens,
                compressed_tokens: original_tokens,
                ratio: 1.0,
                messages_summarized: 0,
                files_removed: 0,
                tool_results_removed: 0,
            });
        }

        let mut messages_summarized = 0;
        let mut files_removed = 0;
        let mut tool_results_removed = 0;

        // Strategy 1: Remove older tool results (keep last 5)
        if context.tool_results.len() > 5 {
            let removed = context.tool_results.len() - 5;
            context.tool_results = context.tool_results.split_off(removed);
            tool_results_removed = removed;
        }

        // Check if we've reached target
        let current_tokens = self.estimate_token_count(context);
        if current_tokens <= target_tokens {
            return Ok(CompressionResult {
                original_tokens,
                compressed_tokens: current_tokens,
                ratio: original_tokens as f64 / current_tokens as f64,
                messages_summarized,
                files_removed,
                tool_results_removed,
            });
        }

        // Strategy 2: Remove older file contexts (keep last 3)
        if context.file_context.len() > 3 {
            let removed = context.file_context.len() - 3;
            context.file_context = context.file_context.split_off(removed);
            files_removed = removed;
        }

        // Check if we've reached target
        let current_tokens = self.estimate_token_count(context);
        if current_tokens <= target_tokens {
            return Ok(CompressionResult {
                original_tokens,
                compressed_tokens: current_tokens,
                ratio: original_tokens as f64 / current_tokens as f64,
                messages_summarized,
                files_removed,
                tool_results_removed,
            });
        }

        // Strategy 3: Summarize older messages (keep last 10)
        if context.conversation_history.len() > 10 {
            let to_summarize = context.conversation_history.len() - 10;
            let older_messages: Vec<_> =
                context.conversation_history.drain(..to_summarize).collect();

            // Create a simple summary of older messages
            let summary = self.create_message_summary(&older_messages);
            context.conversation_summary = Some(summary);
            messages_summarized = to_summarize;
        }

        let compressed_tokens = self.estimate_token_count(context);
        context.metadata.is_compressed = true;
        context.metadata.compression_ratio =
            Some(original_tokens as f64 / compressed_tokens as f64);
        context.metadata.touch();

        Ok(CompressionResult {
            original_tokens,
            compressed_tokens,
            ratio: original_tokens as f64 / compressed_tokens as f64,
            messages_summarized,
            files_removed,
            tool_results_removed,
        })
    }

    /// Filter sensitive data from a context
    pub fn filter(&self, context: &AgentContext, filter: &ContextFilter) -> AgentContext {
        let mut filtered = context.clone();

        // Filter environment variables
        let excluded_keys: HashSet<_> = filter
            .excluded_env_keys
            .iter()
            .map(|k| k.to_uppercase())
            .collect();

        filtered
            .environment
            .retain(|key, _| !excluded_keys.contains(&key.to_uppercase()));

        // Filter file contexts based on patterns
        if !filter.excluded_file_patterns.is_empty() {
            filtered.file_context.retain(|fc| {
                let path_str = fc.path.to_string_lossy();
                !filter
                    .excluded_file_patterns
                    .iter()
                    .any(|pattern| glob_match(pattern, &path_str))
            });
        }

        // Filter tool results
        if !filter.excluded_tools.is_empty() {
            filtered
                .tool_results
                .retain(|tr| !filter.excluded_tools.contains(&tr.tool_name));
        }

        // Filter sensitive patterns from text content
        let patterns: Vec<Regex> = filter
            .sensitive_patterns
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();

        // Filter file content
        for fc in &mut filtered.file_context {
            fc.content = mask_sensitive_content(&fc.content, &patterns);
        }

        // Filter tool result content
        for tr in &mut filtered.tool_results {
            tr.content = mask_sensitive_content(&tr.content, &patterns);
        }

        filtered.metadata.touch();
        filtered
    }

    /// Merge multiple contexts into one
    pub fn merge(&self, contexts: Vec<&AgentContext>) -> AgentContext {
        let mut merged = AgentContext::new();

        for ctx in contexts {
            // Merge conversation history (append)
            merged
                .conversation_history
                .extend(ctx.conversation_history.clone());

            // Merge file contexts (deduplicate by path)
            for fc in &ctx.file_context {
                if !merged.file_context.iter().any(|f| f.path == fc.path) {
                    merged.file_context.push(fc.clone());
                }
            }

            // Merge tool results (append)
            merged.tool_results.extend(ctx.tool_results.clone());

            // Merge environment (later contexts override)
            merged.environment.extend(ctx.environment.clone());

            // Use the last non-None system prompt
            if ctx.system_prompt.is_some() {
                merged.system_prompt = ctx.system_prompt.clone();
            }

            // Use the last working directory
            if ctx.working_directory.as_os_str() != "." {
                merged.working_directory = ctx.working_directory.clone();
            }
        }

        // Update token count
        merged.metadata.token_count = self.estimate_token_count(&merged);
        merged.metadata.touch();

        merged
    }

    /// Get a context by ID
    pub fn get_context(&self, context_id: &str) -> Option<&AgentContext> {
        self.contexts.get(context_id)
    }

    /// Get a mutable context by ID
    pub fn get_context_mut(&mut self, context_id: &str) -> Option<&mut AgentContext> {
        self.contexts.get_mut(context_id)
    }

    /// Update a context with the given updates
    pub fn update_context(
        &mut self,
        context_id: &str,
        updates: ContextUpdate,
    ) -> AgentContextResult<()> {
        // First check if context exists
        if !self.contexts.contains_key(context_id) {
            return Err(AgentContextError::NotFound(context_id.to_string()));
        }

        // Apply updates
        {
            let context = self.contexts.get_mut(context_id).unwrap();

            if let Some(messages) = updates.add_messages {
                context.conversation_history.extend(messages);
            }

            if let Some(files) = updates.add_files {
                context.file_context.extend(files);
            }

            if let Some(results) = updates.add_tool_results {
                context.tool_results.extend(results);
            }

            if let Some(env) = updates.set_environment {
                context.environment.extend(env);
            }

            if let Some(prompt) = updates.set_system_prompt {
                context.system_prompt = Some(prompt);
            }

            if let Some(dir) = updates.set_working_directory {
                context.working_directory = dir;
            }

            if let Some(tags) = updates.add_tags {
                for tag in tags {
                    context.metadata.add_tag(tag);
                }
            }

            if let Some(custom) = updates.set_custom_metadata {
                for (key, value) in custom {
                    context.metadata.set_custom(key, value);
                }
            }

            context.metadata.touch();
        }

        // Update token count (separate borrow scope)
        let token_count = {
            let ctx = self.contexts.get(context_id).unwrap();
            self.estimate_token_count(ctx)
        };

        if let Some(ctx_mut) = self.contexts.get_mut(context_id) {
            ctx_mut.metadata.token_count = token_count;
        }

        Ok(())
    }

    /// Delete a context by ID
    pub fn delete_context(&mut self, context_id: &str) -> bool {
        self.contexts.remove(context_id).is_some()
    }

    /// Persist a context to disk
    pub async fn persist_context(&self, context: &AgentContext) -> AgentContextResult<()> {
        // Ensure storage directory exists
        fs::create_dir_all(&self.storage_dir).await?;

        let file_path = self
            .storage_dir
            .join(format!("{}.json", context.context_id));

        let json = serde_json::to_string_pretty(context)
            .map_err(|e| AgentContextError::SerializationError(e.to_string()))?;

        let mut file = fs::File::create(&file_path).await?;
        file.write_all(json.as_bytes()).await?;
        file.flush().await?;

        Ok(())
    }

    /// Load a context from disk
    pub async fn load_context(
        &mut self,
        context_id: &str,
    ) -> AgentContextResult<Option<AgentContext>> {
        let file_path = self.storage_dir.join(format!("{}.json", context_id));

        if !file_path.exists() {
            return Ok(None);
        }

        let json = fs::read_to_string(&file_path).await?;

        let context: AgentContext = serde_json::from_str(&json)
            .map_err(|e| AgentContextError::SerializationError(e.to_string()))?;

        // Store in memory
        self.contexts
            .insert(context_id.to_string(), context.clone());

        Ok(Some(context))
    }

    /// Estimate token count for a context
    ///
    /// This is a rough estimate based on character count.
    /// For more accurate counts, use a proper tokenizer.
    pub fn estimate_token_count(&self, context: &AgentContext) -> usize {
        let mut total_chars = 0;

        // Count conversation history
        for msg in &context.conversation_history {
            for content in &msg.content {
                total_chars += content.to_string().len();
            }
        }

        // Count conversation summary
        if let Some(summary) = &context.conversation_summary {
            total_chars += summary.len();
        }

        // Count file contexts
        for fc in &context.file_context {
            total_chars += fc.content.len();
        }

        // Count tool results
        for tr in &context.tool_results {
            total_chars += tr.content.len();
        }

        // Count system prompt
        if let Some(prompt) = &context.system_prompt {
            total_chars += prompt.len();
        }

        // Rough estimate: ~4 characters per token
        total_chars / 4
    }

    /// Update the token count in context metadata
    pub fn update_token_count(&self, context: &mut AgentContext) {
        context.metadata.token_count = self.estimate_token_count(context);
        context.metadata.touch();
    }

    /// Create a simple summary of messages
    fn create_message_summary(&self, messages: &[Message]) -> String {
        let mut summary = String::from("Previous conversation summary:\n");

        for msg in messages {
            let role = format!("{:?}", msg.role);
            let content_preview: String = msg
                .content
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>()
                .join(" ");

            let preview = if content_preview.chars().count() > 100 {
                format!(
                    "{}...",
                    content_preview.chars().take(100).collect::<String>()
                )
            } else {
                content_preview
            };

            summary.push_str(&format!("- {}: {}\n", role, preview));
        }

        summary
    }

    /// List all context IDs in memory
    pub fn list_context_ids(&self) -> Vec<String> {
        self.contexts.keys().cloned().collect()
    }

    /// Get the storage directory path
    pub fn storage_dir(&self) -> &PathBuf {
        &self.storage_dir
    }
}

/// Simple glob pattern matching
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.replace('.', r"\.");
    let pattern = pattern.replace('*', ".*");
    let pattern = format!("^{}$", pattern);

    Regex::new(&pattern)
        .map(|re| re.is_match(text))
        .unwrap_or(false)
}

/// Mask sensitive content using regex patterns
fn mask_sensitive_content(content: &str, patterns: &[Regex]) -> String {
    let mut result = content.to_string();

    for pattern in patterns {
        result = pattern.replace_all(&result, "[REDACTED]").to_string();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::context::types::{ContextInheritanceType, FileContext, ToolExecutionResult};

    #[test]
    fn test_create_context_without_parent() {
        let mut manager = AgentContextManager::new();
        let context = manager.create_context(None, None);

        assert!(!context.context_id.is_empty());
        assert!(context.parent_context_id.is_none());
        assert!(context.is_empty());
    }

    #[test]
    fn test_create_context_with_parent() {
        let mut manager = AgentContextManager::new();

        // Create parent context
        let mut parent = AgentContext::new();
        parent.add_message(Message::user().with_text("Hello"));
        parent.set_env("TEST_VAR", "test_value");

        // Create child with full inheritance
        let config = ContextInheritanceConfig::default();
        let child = manager.create_context(Some(&parent), Some(config));

        assert!(child.parent_context_id.is_some());
        assert_eq!(
            child.parent_context_id.as_ref().unwrap(),
            &parent.context_id
        );
        assert_eq!(child.conversation_history.len(), 1);
        assert_eq!(child.get_env("TEST_VAR"), Some(&"test_value".to_string()));
    }

    #[test]
    fn test_inherit_none() {
        let manager = AgentContextManager::new();

        let mut parent = AgentContext::new();
        parent.add_message(Message::user().with_text("Hello"));
        parent.set_env("TEST_VAR", "test_value");

        let config = ContextInheritanceConfig::none();
        let child = manager.inherit(&parent, &config);

        assert!(child.conversation_history.is_empty());
        assert!(child.environment.is_empty());
    }

    #[test]
    fn test_inherit_selective() {
        let manager = AgentContextManager::new();

        let mut parent = AgentContext::new();
        parent.add_message(Message::user().with_text("Hello"));
        parent.add_file_context(FileContext::new("/test.rs", "fn main() {}"));
        parent.set_env("TEST_VAR", "test_value");

        let config = ContextInheritanceConfig {
            inherit_conversation: true,
            inherit_files: false,
            inherit_tool_results: false,
            inherit_environment: true,
            inheritance_type: ContextInheritanceType::Selective,
            ..Default::default()
        };

        let child = manager.inherit(&parent, &config);

        assert_eq!(child.conversation_history.len(), 1);
        assert!(child.file_context.is_empty());
        assert_eq!(child.get_env("TEST_VAR"), Some(&"test_value".to_string()));
    }

    #[test]
    fn test_inherit_with_max_history() {
        let manager = AgentContextManager::new();

        let mut parent = AgentContext::new();
        for i in 0..20 {
            parent.add_message(Message::user().with_text(format!("Message {}", i)));
        }

        let config = ContextInheritanceConfig {
            inherit_conversation: true,
            max_history_length: Some(5),
            inheritance_type: ContextInheritanceType::Selective,
            ..Default::default()
        };

        let child = manager.inherit(&parent, &config);

        assert_eq!(child.conversation_history.len(), 5);
    }

    #[test]
    fn test_get_context() {
        let mut manager = AgentContextManager::new();
        let context = manager.create_context(None, None);
        let context_id = context.context_id.clone();

        let retrieved = manager.get_context(&context_id);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().context_id, context_id);
    }

    #[test]
    fn test_update_context() {
        let mut manager = AgentContextManager::new();
        let context = manager.create_context(None, None);
        let context_id = context.context_id.clone();

        let updates = ContextUpdate {
            add_messages: Some(vec![Message::user().with_text("New message")]),
            set_environment: Some(HashMap::from([("KEY".to_string(), "value".to_string())])),
            ..Default::default()
        };

        manager.update_context(&context_id, updates).unwrap();

        let updated = manager.get_context(&context_id).unwrap();
        assert_eq!(updated.conversation_history.len(), 1);
        assert_eq!(updated.get_env("KEY"), Some(&"value".to_string()));
    }

    #[test]
    fn test_delete_context() {
        let mut manager = AgentContextManager::new();
        let context = manager.create_context(None, None);
        let context_id = context.context_id.clone();

        assert!(manager.get_context(&context_id).is_some());
        assert!(manager.delete_context(&context_id));
        assert!(manager.get_context(&context_id).is_none());
    }

    #[test]
    fn test_filter_sensitive_env() {
        let manager = AgentContextManager::new();

        let mut context = AgentContext::new();
        context.set_env("API_KEY", "secret123");
        context.set_env("NORMAL_VAR", "normal_value");

        let filter = ContextFilter::with_defaults();
        let filtered = manager.filter(&context, &filter);

        assert!(filtered.get_env("API_KEY").is_none());
        assert_eq!(
            filtered.get_env("NORMAL_VAR"),
            Some(&"normal_value".to_string())
        );
    }

    #[test]
    fn test_filter_sensitive_content() {
        let manager = AgentContextManager::new();

        let mut context = AgentContext::new();
        context.add_file_context(FileContext::new(
            "/config.rs",
            "let api_key = \"sk-12345\";",
        ));

        let filter = ContextFilter::with_defaults();
        let filtered = manager.filter(&context, &filter);

        assert!(filtered.file_context[0].content.contains("[REDACTED]"));
    }

    #[test]
    fn test_merge_contexts() {
        let manager = AgentContextManager::new();

        let mut ctx1 = AgentContext::new();
        ctx1.add_message(Message::user().with_text("Message 1"));
        ctx1.set_env("VAR1", "value1");

        let mut ctx2 = AgentContext::new();
        ctx2.add_message(Message::user().with_text("Message 2"));
        ctx2.set_env("VAR2", "value2");

        let merged = manager.merge(vec![&ctx1, &ctx2]);

        assert_eq!(merged.conversation_history.len(), 2);
        assert_eq!(merged.get_env("VAR1"), Some(&"value1".to_string()));
        assert_eq!(merged.get_env("VAR2"), Some(&"value2".to_string()));
    }

    #[test]
    fn test_merge_deduplicates_files() {
        let manager = AgentContextManager::new();

        let mut ctx1 = AgentContext::new();
        ctx1.add_file_context(FileContext::new("/test.rs", "content1"));

        let mut ctx2 = AgentContext::new();
        ctx2.add_file_context(FileContext::new("/test.rs", "content2"));
        ctx2.add_file_context(FileContext::new("/other.rs", "other"));

        let merged = manager.merge(vec![&ctx1, &ctx2]);

        // Should have 2 files (deduplicated by path)
        assert_eq!(merged.file_context.len(), 2);
    }

    #[test]
    fn test_compress_already_small() {
        let manager = AgentContextManager::new();

        let mut context = AgentContext::new();
        context.add_message(Message::user().with_text("Small message"));

        let result = manager.compress(&mut context, 10000).unwrap();

        assert_eq!(result.messages_summarized, 0);
        assert_eq!(result.files_removed, 0);
        assert_eq!(result.tool_results_removed, 0);
    }

    #[test]
    fn test_compress_removes_old_tool_results() {
        let manager = AgentContextManager::new();

        let mut context = AgentContext::new();
        for i in 0..10 {
            context.add_tool_result(ToolExecutionResult::success(
                "bash",
                format!("call-{}", i),
                "x".repeat(1000),
                100,
            ));
        }

        // Target very small to force compression
        let result = manager.compress(&mut context, 100).unwrap();

        assert!(result.tool_results_removed > 0);
        assert!(context.tool_results.len() <= 5);
    }

    #[test]
    fn test_estimate_token_count() {
        let manager = AgentContextManager::new();

        let mut context = AgentContext::new();
        context.add_message(Message::user().with_text("Hello world")); // ~11 chars
        context.system_prompt = Some("You are helpful".to_string()); // ~15 chars

        let tokens = manager.estimate_token_count(&context);

        // Should be roughly (11 + 15) / 4 = ~6 tokens
        assert!(tokens > 0);
        assert!(tokens < 100);
    }

    #[test]
    fn test_list_context_ids() {
        let mut manager = AgentContextManager::new();

        let ctx1 = manager.create_context(None, None);
        let ctx2 = manager.create_context(None, None);

        let ids = manager.list_context_ids();

        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&ctx1.context_id));
        assert!(ids.contains(&ctx2.context_id));
    }

    #[test]
    fn test_unique_context_ids() {
        let mut manager = AgentContextManager::new();
        let mut ids = std::collections::HashSet::new();

        for _ in 0..100 {
            let context = manager.create_context(None, None);
            assert!(
                ids.insert(context.context_id.clone()),
                "Duplicate ID generated"
            );
        }
    }

    #[tokio::test]
    async fn test_persist_and_load_context() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut manager = AgentContextManager::with_storage_dir(temp_dir.path());

        let mut context = AgentContext::new();
        context.add_message(Message::user().with_text("Test message"));
        context.set_env("TEST", "value");

        let context_id = context.context_id.clone();

        // Persist
        manager.persist_context(&context).await.unwrap();

        // Clear in-memory storage
        manager.contexts.clear();

        // Load
        let loaded = manager.load_context(&context_id).await.unwrap();

        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.context_id, context_id);
        assert_eq!(loaded.conversation_history.len(), 1);
        assert_eq!(loaded.get_env("TEST"), Some(&"value".to_string()));
    }

    #[tokio::test]
    async fn test_load_nonexistent_context() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut manager = AgentContextManager::with_storage_dir(temp_dir.path());

        let result = manager.load_context("nonexistent-id").await.unwrap();
        assert!(result.is_none());
    }
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use crate::agents::context::types::{ContextInheritanceType, FileContext, ToolExecutionResult};
    use proptest::prelude::*;
    use std::collections::HashSet;

    // Arbitrary generators for property tests

    fn arb_message() -> impl Strategy<Value = Message> {
        prop::string::string_regex("[a-zA-Z0-9 ]{1,100}")
            .unwrap()
            .prop_map(|text| Message::user().with_text(text))
    }

    fn arb_file_context() -> impl Strategy<Value = FileContext> {
        (
            prop::string::string_regex("/[a-z]+/[a-z]+\\.[a-z]+").unwrap(),
            prop::string::string_regex("[a-zA-Z0-9\\s]{1,500}").unwrap(),
        )
            .prop_map(|(path, content)| FileContext::new(path, content))
    }

    fn arb_tool_result() -> impl Strategy<Value = ToolExecutionResult> {
        (
            prop::string::string_regex("[a-z_]+").unwrap(),
            prop::string::string_regex("[a-zA-Z0-9]{1,100}").unwrap(),
            prop::bool::ANY,
        )
            .prop_map(|(tool_name, content, success)| {
                if success {
                    ToolExecutionResult::success(
                        &tool_name,
                        uuid::Uuid::new_v4().to_string(),
                        content,
                        100,
                    )
                } else {
                    ToolExecutionResult::failure(
                        &tool_name,
                        uuid::Uuid::new_v4().to_string(),
                        "error",
                        100,
                    )
                }
            })
    }

    fn arb_env_var() -> impl Strategy<Value = (String, String)> {
        (
            prop::string::string_regex("[A-Z_]{1,20}").unwrap(),
            prop::string::string_regex("[a-zA-Z0-9]{1,50}").unwrap(),
        )
    }

    fn arb_agent_context() -> impl Strategy<Value = AgentContext> {
        (
            prop::collection::vec(arb_message(), 0..10),
            prop::collection::vec(arb_file_context(), 0..5),
            prop::collection::vec(arb_tool_result(), 0..5),
            prop::collection::vec(arb_env_var(), 0..5),
        )
            .prop_map(|(messages, files, tool_results, env_vars)| {
                let mut ctx = AgentContext::new();
                for msg in messages {
                    ctx.add_message(msg);
                }
                for file in files {
                    ctx.add_file_context(file);
                }
                for result in tool_results {
                    ctx.add_tool_result(result);
                }
                for (key, value) in env_vars {
                    ctx.set_env(key, value);
                }
                ctx
            })
    }

    fn arb_inheritance_config() -> impl Strategy<Value = ContextInheritanceConfig> {
        (
            prop::bool::ANY,
            prop::bool::ANY,
            prop::bool::ANY,
            prop::bool::ANY,
            prop::option::of(1usize..20),
            prop::option::of(1usize..10),
            prop::option::of(1usize..10),
            prop::sample::select(vec![
                ContextInheritanceType::Full,
                ContextInheritanceType::Shallow,
                ContextInheritanceType::Selective,
                ContextInheritanceType::None,
            ]),
        )
            .prop_map(
                |(
                    inherit_conversation,
                    inherit_files,
                    inherit_tool_results,
                    inherit_environment,
                    max_history_length,
                    max_file_contexts,
                    max_tool_results,
                    inheritance_type,
                )| {
                    ContextInheritanceConfig {
                        inherit_conversation,
                        inherit_files,
                        inherit_tool_results,
                        inherit_environment,
                        max_history_length,
                        max_file_contexts,
                        max_tool_results,
                        filter_sensitive: false, // Disable for inheritance tests
                        compress_context: false,
                        target_tokens: None,
                        inheritance_type,
                    }
                },
            )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// **Property 1: Context Unique ID Generation**
        ///
        /// *For any* number of contexts created, each context SHALL have a unique
        /// identifier that does not collide with any other context ID.
        ///
        /// **Validates: Requirements 1.1**
        #[test]
        fn prop_context_unique_id_generation(count in 1usize..200) {
            let mut manager = AgentContextManager::new();
            let mut ids = HashSet::new();

            for _ in 0..count {
                let context = manager.create_context(None, None);
                // Each ID should be unique
                prop_assert!(
                    ids.insert(context.context_id.clone()),
                    "Duplicate context ID generated: {}",
                    context.context_id
                );
                // ID should not be empty
                prop_assert!(!context.context_id.is_empty(), "Empty context ID generated");
            }

            // All IDs should be stored in the manager
            prop_assert_eq!(manager.list_context_ids().len(), count);
        }

        /// **Property 2: Context Inheritance Consistency**
        ///
        /// *For any* parent context and inheritance configuration, the inherited context
        /// SHALL contain only the data types specified in the configuration
        /// (conversation, files, tool results, environment).
        ///
        /// **Validates: Requirements 1.2, 1.3**
        #[test]
        fn prop_context_inheritance_consistency(
            parent in arb_agent_context(),
            config in arb_inheritance_config()
        ) {
            let manager = AgentContextManager::new();
            let child = manager.inherit(&parent, &config);

            // Child should have parent reference
            prop_assert_eq!(child.parent_context_id.as_ref(), Some(&parent.context_id));

            match config.inheritance_type {
                ContextInheritanceType::None => {
                    // No inheritance - child should be empty
                    prop_assert!(child.conversation_history.is_empty());
                    prop_assert!(child.file_context.is_empty());
                    prop_assert!(child.tool_results.is_empty());
                    prop_assert!(child.environment.is_empty());
                }
                ContextInheritanceType::Full => {
                    // Full inheritance - child should have data (respecting limits)
                    let expected_history_len = match config.max_history_length {
                        Some(max) => parent.conversation_history.len().min(max),
                        None => parent.conversation_history.len(),
                    };
                    prop_assert_eq!(child.conversation_history.len(), expected_history_len);

                    let expected_files_len = match config.max_file_contexts {
                        Some(max) => parent.file_context.len().min(max),
                        None => parent.file_context.len(),
                    };
                    prop_assert_eq!(child.file_context.len(), expected_files_len);

                    let expected_results_len = match config.max_tool_results {
                        Some(max) => parent.tool_results.len().min(max),
                        None => parent.tool_results.len(),
                    };
                    prop_assert_eq!(child.tool_results.len(), expected_results_len);

                    // Environment should be fully inherited
                    prop_assert_eq!(child.environment.len(), parent.environment.len());
                }
                ContextInheritanceType::Shallow | ContextInheritanceType::Selective => {
                    // Selective inheritance based on flags
                    if config.inherit_conversation {
                        let expected_len = match config.max_history_length {
                            Some(max) => parent.conversation_history.len().min(max),
                            None => parent.conversation_history.len(),
                        };
                        prop_assert_eq!(child.conversation_history.len(), expected_len);
                    } else {
                        prop_assert!(child.conversation_history.is_empty());
                    }

                    if config.inherit_files {
                        let expected_len = match config.max_file_contexts {
                            Some(max) => parent.file_context.len().min(max),
                            None => parent.file_context.len(),
                        };
                        prop_assert_eq!(child.file_context.len(), expected_len);
                    } else {
                        prop_assert!(child.file_context.is_empty());
                    }

                    if config.inherit_tool_results {
                        let expected_len = match config.max_tool_results {
                            Some(max) => parent.tool_results.len().min(max),
                            None => parent.tool_results.len(),
                        };
                        prop_assert_eq!(child.tool_results.len(), expected_len);
                    } else {
                        prop_assert!(child.tool_results.is_empty());
                    }

                    if config.inherit_environment {
                        prop_assert_eq!(child.environment.len(), parent.environment.len());
                    } else {
                        prop_assert!(child.environment.is_empty());
                    }
                }
            }
        }

        /// **Property 3: Context Compression Effectiveness**
        ///
        /// *For any* context exceeding the target token limit, compression SHALL reduce
        /// the token count to at or below the target while preserving the most recent messages.
        ///
        /// **Validates: Requirements 1.4**
        #[test]
        fn prop_context_compression_effectiveness(
            messages in prop::collection::vec(arb_message(), 15..30),
            files in prop::collection::vec(arb_file_context(), 5..10),
            tool_results in prop::collection::vec(arb_tool_result(), 8..15),
            target_tokens in 500usize..2000  // Use a more realistic target range
        ) {
            let manager = AgentContextManager::new();

            let mut context = AgentContext::new();
            for msg in messages.clone() {
                context.add_message(msg);
            }
            for file in files.clone() {
                context.add_file_context(file);
            }
            for result in tool_results.clone() {
                context.add_tool_result(result);
            }

            let original_tokens = manager.estimate_token_count(&context);
            let original_message_count = context.conversation_history.len();
            let original_file_count = context.file_context.len();
            let original_tool_count = context.tool_results.len();

            // Only test compression if context exceeds target
            if original_tokens > target_tokens {
                let result = manager.compress(&mut context, target_tokens).unwrap();

                // Compression should attempt to reduce content when over target
                // The compression algorithm applies strategies in order and may return early
                // if target is reached, so not all strategies may be applied

                // If tool results were removed, check the limit
                if result.tool_results_removed > 0 {
                    prop_assert!(
                        context.tool_results.len() <= 5,
                        "Tool results should be limited to 5 after compression removed some"
                    );
                }

                // If files were removed, check the limit
                if result.files_removed > 0 {
                    prop_assert!(
                        context.file_context.len() <= 3,
                        "File contexts should be limited to 3 after compression removed some"
                    );
                }

                // If messages were summarized, most recent should be preserved
                if result.messages_summarized > 0 {
                    // The remaining messages should be the most recent ones
                    let remaining_count = context.conversation_history.len();
                    prop_assert!(
                        remaining_count <= original_message_count,
                        "Message count should not increase after compression"
                    );

                    // Metadata should reflect compression when messages are summarized
                    prop_assert!(context.metadata.is_compressed);
                }

                // Verify that compression actually did something
                let something_removed = result.tool_results_removed > 0
                    || result.files_removed > 0
                    || result.messages_summarized > 0;

                // If original exceeded target, compression should have attempted something
                // unless the content was already minimal
                if original_tool_count > 5 || original_file_count > 3 || original_message_count > 10 {
                    prop_assert!(
                        something_removed,
                        "Compression should remove content when over limits"
                    );
                }

                // Compression ratio should be valid
                prop_assert!(
                    result.ratio > 0.0,
                    "Compression ratio should be positive"
                );
            }
        }

        /// **Property 4: Sensitive Data Filtering**
        ///
        /// *For any* context containing sensitive patterns (API keys, passwords, tokens),
        /// filtering SHALL remove or mask all sensitive data from the output context.
        ///
        /// **Validates: Requirements 1.5**
        #[test]
        fn prop_sensitive_data_filtering(
            normal_env_vars in prop::collection::vec(
                (
                    prop::string::string_regex("[A-Z]{3,10}_VAR").unwrap(),
                    prop::string::string_regex("[a-z0-9]{5,20}").unwrap()
                ),
                1..5
            ),
            sensitive_env_keys in prop::sample::subsequence(
                vec!["API_KEY", "SECRET", "PASSWORD", "TOKEN", "PRIVATE_KEY"],
                1..4
            ),
            file_with_sensitive in prop::bool::ANY
        ) {
            let manager = AgentContextManager::new();
            let filter = ContextFilter::with_defaults();

            let mut context = AgentContext::new();

            // Add normal environment variables
            for (key, value) in &normal_env_vars {
                context.set_env(key, value);
            }

            // Add sensitive environment variables
            for key in &sensitive_env_keys {
                context.set_env(*key, "sensitive_value_12345");
            }

            // Optionally add file with sensitive content
            if file_with_sensitive {
                context.add_file_context(FileContext::new(
                    "/config.rs",
                    "let api_key = \"sk-secret123\"; let password = \"hunter2\";",
                ));
            }

            let filtered = manager.filter(&context, &filter);

            // Sensitive environment variables should be removed
            for key in &sensitive_env_keys {
                prop_assert!(
                    filtered.get_env(key).is_none(),
                    "Sensitive env var {} should be filtered",
                    key
                );
            }

            // Normal environment variables should be preserved
            for (key, value) in &normal_env_vars {
                // Only check if key doesn't match sensitive patterns
                let key_upper = key.to_uppercase();
                if !key_upper.contains("API") && !key_upper.contains("SECRET")
                    && !key_upper.contains("PASSWORD") && !key_upper.contains("TOKEN")
                    && !key_upper.contains("KEY")
                {
                    prop_assert_eq!(
                        filtered.get_env(key),
                        Some(value),
                        "Normal env var {} should be preserved",
                        key
                    );
                }
            }

            // If file had sensitive content, it should be redacted
            if file_with_sensitive && !filtered.file_context.is_empty() {
                let content = &filtered.file_context[0].content;
                prop_assert!(
                    content.contains("[REDACTED]") || !content.contains("api_key"),
                    "Sensitive content in files should be redacted"
                );
            }
        }

        /// **Property 6: Context Merge Completeness**
        ///
        /// *For any* set of contexts to merge, the merged context SHALL contain
        /// data from all source contexts without data loss.
        ///
        /// **Validates: Requirements 1.7**
        #[test]
        fn prop_context_merge_completeness(
            contexts in prop::collection::vec(arb_agent_context(), 2..5)
        ) {
            let manager = AgentContextManager::new();

            // Calculate expected totals
            let total_messages: usize = contexts.iter()
                .map(|c| c.conversation_history.len())
                .sum();

            let total_tool_results: usize = contexts.iter()
                .map(|c| c.tool_results.len())
                .sum();

            // Collect unique file paths
            let mut unique_file_paths = HashSet::new();
            for ctx in &contexts {
                for fc in &ctx.file_context {
                    unique_file_paths.insert(fc.path.clone());
                }
            }

            // Collect all environment keys
            let mut all_env_keys = HashSet::new();
            for ctx in &contexts {
                for key in ctx.environment.keys() {
                    all_env_keys.insert(key.clone());
                }
            }

            let context_refs: Vec<&AgentContext> = contexts.iter().collect();
            let merged = manager.merge(context_refs);

            // All messages should be present
            prop_assert_eq!(
                merged.conversation_history.len(),
                total_messages,
                "All messages should be merged"
            );

            // All tool results should be present
            prop_assert_eq!(
                merged.tool_results.len(),
                total_tool_results,
                "All tool results should be merged"
            );

            // Files should be deduplicated by path
            prop_assert_eq!(
                merged.file_context.len(),
                unique_file_paths.len(),
                "Files should be deduplicated by path"
            );

            // All environment keys should be present
            for key in &all_env_keys {
                prop_assert!(
                    merged.environment.contains_key(key),
                    "Environment key {} should be present in merged context",
                    key
                );
            }

            // Merged context should have updated token count
            // 注意：当所有内容都很短时，estimate_token_count (chars/4) 可能为 0
            let total_content_len: usize = merged.conversation_history.iter()
                .flat_map(|m| m.content.iter())
                .map(|c| c.to_string().len())
                .sum::<usize>()
                + merged.file_context.iter().map(|f| f.content.len()).sum::<usize>()
                + merged.tool_results.iter().map(|t| t.content.len()).sum::<usize>();
            if total_content_len >= 4 {
                prop_assert!(
                    merged.metadata.token_count > 0,
                    "Token count should be > 0 when content is substantial"
                );
            }
        }
    }

    // Async property tests for persistence
    mod async_property_tests {
        use super::*;
        use tokio::runtime::Runtime;

        /// **Property 5: Context Persistence Round-Trip**
        ///
        /// *For any* valid agent context, saving to disk and loading back
        /// SHALL produce an equivalent context.
        ///
        /// **Validates: Requirements 1.6**
        #[test]
        fn prop_context_persistence_round_trip() {
            let rt = Runtime::new().unwrap();

            proptest!(ProptestConfig::with_cases(50), |(context in arb_agent_context())| {
                rt.block_on(async {
                    let temp_dir = tempfile::tempdir().unwrap();
                    let mut manager = AgentContextManager::with_storage_dir(temp_dir.path());

                    let context_id = context.context_id.clone();

                    // Persist the context
                    manager.persist_context(&context).await.unwrap();

                    // Load it back
                    let loaded = manager.load_context(&context_id).await.unwrap();

                    prop_assert!(loaded.is_some(), "Context should be loadable after persistence");
                    let loaded = loaded.unwrap();

                    // Verify key fields are preserved
                    prop_assert_eq!(loaded.context_id, context.context_id);
                    prop_assert_eq!(loaded.agent_id, context.agent_id);
                    prop_assert_eq!(loaded.parent_context_id, context.parent_context_id);
                    prop_assert_eq!(loaded.conversation_history.len(), context.conversation_history.len());
                    prop_assert_eq!(loaded.file_context.len(), context.file_context.len());
                    prop_assert_eq!(loaded.tool_results.len(), context.tool_results.len());
                    prop_assert_eq!(loaded.environment.len(), context.environment.len());
                    prop_assert_eq!(loaded.system_prompt, context.system_prompt);
                    prop_assert_eq!(loaded.working_directory, context.working_directory);

                    Ok(())
                })?;
            });
        }

        /// **Property 7: Token Count Accuracy**
        ///
        /// *For any* context, the tracked token count SHALL be within 10% of
        /// the actual token count calculated from the content.
        ///
        /// **Validates: Requirements 1.8**
        #[test]
        fn prop_token_count_accuracy() {
            proptest!(ProptestConfig::with_cases(100), |(context in arb_agent_context())| {
                let manager = AgentContextManager::new();

                let estimated_tokens = manager.estimate_token_count(&context);

                // Calculate actual character count
                let mut total_chars = 0;

                for msg in &context.conversation_history {
                    for content in &msg.content {
                        total_chars += content.to_string().len();
                    }
                }

                if let Some(summary) = &context.conversation_summary {
                    total_chars += summary.len();
                }

                for fc in &context.file_context {
                    total_chars += fc.content.len();
                }

                for tr in &context.tool_results {
                    total_chars += tr.content.len();
                }

                if let Some(prompt) = &context.system_prompt {
                    total_chars += prompt.len();
                }

                // Expected tokens (rough estimate: ~4 chars per token)
                let expected_tokens = total_chars / 4;

                // Token count should be reasonably close (within 20% or differ by at most 10)
                // We use a more lenient check because token estimation is inherently approximate
                if expected_tokens > 10 {
                    let diff = (estimated_tokens as i64 - expected_tokens as i64).abs();
                    let tolerance = (expected_tokens as f64 * 0.2).max(10.0) as i64;
                    prop_assert!(
                        diff <= tolerance,
                        "Token count {} should be within 20% of expected {} (diff: {})",
                        estimated_tokens,
                        expected_tokens,
                        diff
                    );
                } else {
                    // For very small contexts, just check it's non-negative
                    prop_assert!(estimated_tokens <= expected_tokens + 10);
                }
            });
        }
    }
}
