//! Session Fork/Branch Support
//!
//! Provides functionality for forking sessions and managing session branches,

use crate::session::{Session, SessionManager};
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Fork options for creating a new session branch
#[derive(Debug, Clone, Default)]
pub struct ForkOptions {
    /// Message index to fork from (default: 0, meaning all messages)
    pub from_message_index: Option<usize>,
    /// Name for the new forked session
    pub name: Option<String>,
    /// Whether to include messages after the fork point (default: true)
    pub include_future_messages: bool,
}

impl ForkOptions {
    pub fn new() -> Self {
        Self {
            from_message_index: None,
            name: None,
            include_future_messages: true,
        }
    }

    pub fn from_message_index(mut self, index: usize) -> Self {
        self.from_message_index = Some(index);
        self
    }

    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn include_future_messages(mut self, include: bool) -> Self {
        self.include_future_messages = include;
        self
    }
}

/// Merge options for combining sessions
#[derive(Debug, Clone, Default)]
pub struct MergeOptions {
    /// Merge strategy
    pub strategy: MergeStrategy,
    /// Metadata preservation strategy
    pub keep_metadata: MetadataStrategy,
}

/// Strategy for merging session messages
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    /// Append source messages to target
    #[default]
    Append,
    /// Interleave messages by timestamp
    Interleave,
    /// Replace target messages with source
    Replace,
}

/// Strategy for preserving metadata during merge
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataStrategy {
    /// Keep target session's metadata
    #[default]
    Target,
    /// Use source session's metadata
    Source,
    /// Merge metadata from both sessions
    Merge,
}

/// Fork metadata stored in extension_data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ForkMetadata {
    /// Parent session ID (if this is a fork)
    pub parent_id: Option<String>,
    /// Message index where fork occurred
    pub fork_point: Option<usize>,
    /// Child session IDs (branches)
    pub branches: Vec<String>,
    /// Fork name/description
    pub fork_name: Option<String>,
    /// Sessions merged into this one
    pub merged_from: Vec<String>,
}

impl ForkMetadata {
    pub const EXTENSION_NAME: &'static str = "fork";
    pub const VERSION: &'static str = "v0";

    /// Get fork metadata from session extension data
    pub fn from_session(session: &Session) -> Option<Self> {
        session
            .extension_data
            .get_extension_state(Self::EXTENSION_NAME, Self::VERSION)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// Save fork metadata to session extension data
    pub fn to_extension_data(
        &self,
        extension_data: &mut crate::session::ExtensionData,
    ) -> Result<()> {
        let value = serde_json::to_value(self)?;
        extension_data.set_extension_state(Self::EXTENSION_NAME, Self::VERSION, value);
        Ok(())
    }
}

/// Fork a session to create a new branch
pub async fn fork_session(source_session_id: &str, options: ForkOptions) -> Result<Session> {
    let source_session = SessionManager::get_session(source_session_id, true).await?;

    let from_index = options.from_message_index.unwrap_or(0);
    let new_name = options
        .name
        .unwrap_or_else(|| format!("{} (fork)", source_session.name));

    // Create new session
    let new_session = SessionManager::create_session(
        source_session.working_dir.clone(),
        new_name.clone(),
        source_session.session_type,
    )
    .await?;

    // Copy messages based on options
    if let Some(conversation) = &source_session.conversation {
        let messages = conversation.messages();
        let messages_to_copy = if options.include_future_messages {
            messages
                .iter()
                .skip(from_index)
                .cloned()
                .collect::<Vec<_>>()
        } else {
            messages
                .iter()
                .take(from_index)
                .cloned()
                .collect::<Vec<_>>()
        };

        if !messages_to_copy.is_empty() {
            let new_conversation =
                crate::conversation::Conversation::new_unvalidated(messages_to_copy);
            SessionManager::replace_conversation(&new_session.id, &new_conversation).await?;
        }
    }

    // Set fork metadata on new session
    let fork_metadata = ForkMetadata {
        parent_id: Some(source_session_id.to_string()),
        fork_point: Some(from_index),
        fork_name: Some(new_name),
        ..Default::default()
    };

    let mut new_extension_data = new_session.extension_data.clone();
    fork_metadata.to_extension_data(&mut new_extension_data)?;

    SessionManager::update_session(&new_session.id)
        .extension_data(new_extension_data)
        .apply()
        .await?;

    // Update source session's branches list
    let mut source_fork_metadata = ForkMetadata::from_session(&source_session).unwrap_or_default();
    source_fork_metadata.branches.push(new_session.id.clone());

    let mut source_extension_data = source_session.extension_data.clone();
    source_fork_metadata.to_extension_data(&mut source_extension_data)?;

    SessionManager::update_session(source_session_id)
        .extension_data(source_extension_data)
        .apply()
        .await?;

    SessionManager::get_session(&new_session.id, true).await
}

/// Merge one session into another
pub async fn merge_sessions(
    target_session_id: &str,
    source_session_id: &str,
    options: MergeOptions,
) -> Result<Session> {
    let target_session = SessionManager::get_session(target_session_id, true).await?;
    let source_session = SessionManager::get_session(source_session_id, true).await?;

    let target_messages = target_session
        .conversation
        .as_ref()
        .map(|c| c.messages().to_vec())
        .unwrap_or_default();

    let source_messages = source_session
        .conversation
        .as_ref()
        .map(|c| c.messages().to_vec())
        .unwrap_or_default();

    // Merge messages based on strategy
    let merged_messages = match options.strategy {
        MergeStrategy::Append => {
            let mut messages = target_messages;
            messages.extend(source_messages);
            messages
        }
        MergeStrategy::Interleave => {
            let mut messages = target_messages;
            messages.extend(source_messages);
            messages.sort_by_key(|m| m.created);
            messages
        }
        MergeStrategy::Replace => source_messages,
    };

    // Update conversation
    if !merged_messages.is_empty() {
        let merged_conversation =
            crate::conversation::Conversation::new_unvalidated(merged_messages);
        SessionManager::replace_conversation(target_session_id, &merged_conversation).await?;
    }

    // Update metadata based on strategy
    let mut update_builder = SessionManager::update_session(target_session_id);

    match options.keep_metadata {
        MetadataStrategy::Source => {
            update_builder = update_builder
                .total_tokens(source_session.total_tokens)
                .input_tokens(source_session.input_tokens)
                .output_tokens(source_session.output_tokens);
        }
        MetadataStrategy::Merge => {
            let merged_total = target_session
                .total_tokens
                .unwrap_or(0)
                .saturating_add(source_session.total_tokens.unwrap_or(0));
            let merged_input = target_session
                .input_tokens
                .unwrap_or(0)
                .saturating_add(source_session.input_tokens.unwrap_or(0));
            let merged_output = target_session
                .output_tokens
                .unwrap_or(0)
                .saturating_add(source_session.output_tokens.unwrap_or(0));

            update_builder = update_builder
                .total_tokens(Some(merged_total))
                .input_tokens(Some(merged_input))
                .output_tokens(Some(merged_output));
        }
        MetadataStrategy::Target => {
            // Keep target metadata, no changes needed
        }
    }

    // Record merge in fork metadata
    let mut fork_metadata = ForkMetadata::from_session(&target_session).unwrap_or_default();
    fork_metadata
        .merged_from
        .push(source_session_id.to_string());

    let mut extension_data = target_session.extension_data.clone();
    fork_metadata.to_extension_data(&mut extension_data)?;

    update_builder
        .extension_data(extension_data)
        .apply()
        .await?;

    SessionManager::get_session(target_session_id, true).await
}

/// Get the branch tree for a session
pub async fn get_session_branch_tree(session_id: &str) -> Result<SessionBranchTree> {
    let session = SessionManager::get_session(session_id, false).await?;
    let fork_metadata = ForkMetadata::from_session(&session).unwrap_or_default();

    let parent = if let Some(parent_id) = &fork_metadata.parent_id {
        SessionManager::get_session(parent_id, false).await.ok()
    } else {
        None
    };

    let mut branches = Vec::new();
    for branch_id in &fork_metadata.branches {
        if let Ok(branch) = SessionManager::get_session(branch_id, false).await {
            branches.push(branch);
        }
    }

    Ok(SessionBranchTree {
        session,
        parent,
        branches,
    })
}

/// Session branch tree structure
#[derive(Debug)]
pub struct SessionBranchTree {
    pub session: Session,
    pub parent: Option<Session>,
    pub branches: Vec<Session>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fork_options_builder() {
        let options = ForkOptions::new()
            .from_message_index(5)
            .name("Test Fork")
            .include_future_messages(false);

        assert_eq!(options.from_message_index, Some(5));
        assert_eq!(options.name, Some("Test Fork".to_string()));
        assert!(!options.include_future_messages);
    }

    #[test]
    fn test_fork_metadata_serialization() {
        let metadata = ForkMetadata {
            parent_id: Some("parent_123".to_string()),
            fork_point: Some(10),
            branches: vec!["branch_1".to_string(), "branch_2".to_string()],
            fork_name: Some("My Fork".to_string()),
            merged_from: vec!["merged_1".to_string()],
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let deserialized: ForkMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.parent_id, metadata.parent_id);
        assert_eq!(deserialized.fork_point, metadata.fork_point);
        assert_eq!(deserialized.branches.len(), 2);
    }
}
