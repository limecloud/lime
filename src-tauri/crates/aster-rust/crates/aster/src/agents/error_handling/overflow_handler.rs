//! Context Overflow Handler Module
//!
//! This module provides automatic handling of context length exceeded errors
//! by compacting the conversation and retrying the request.
//!
//! # Features
//!
//! - Automatic detection of context overflow errors
//! - Conversation compaction with retry
//! - Configurable retry limits
//! - Progressive pruning integration
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::agents::error_handling::OverflowHandler;
//!
//! let mut handler = OverflowHandler::new(2);
//!
//! if OverflowHandler::is_context_overflow(&error) {
//!     let (compacted, should_retry) = handler.handle_overflow(
//!         provider.as_ref(),
//!         &conversation,
//!         &session,
//!     ).await?;
//! }
//! ```

use crate::context_mgmt::compact_messages;
use crate::conversation::Conversation;
use crate::providers::base::{Provider, ProviderUsage};
use crate::providers::errors::ProviderError;
use crate::session::Session;
use anyhow::Result;
use tracing::{debug, info, warn};

/// Handler for context length exceeded errors.
///
/// Provides automatic compaction and retry functionality when
/// the context length limit is exceeded.
pub struct OverflowHandler {
    /// Whether compaction has been attempted in the current request cycle
    compaction_attempted: bool,

    /// Number of compaction attempts made
    compaction_attempts: u32,

    /// Maximum number of compaction retries allowed
    max_retries: u32,
}

impl Default for OverflowHandler {
    fn default() -> Self {
        Self::new(2)
    }
}

impl OverflowHandler {
    /// Create a new OverflowHandler with the specified max retries.
    ///
    /// # Arguments
    ///
    /// * `max_retries` - Maximum number of compaction retries allowed
    pub fn new(max_retries: u32) -> Self {
        Self {
            compaction_attempted: false,
            compaction_attempts: 0,
            max_retries,
        }
    }

    /// Check if an error is a context overflow error.
    ///
    /// # Arguments
    ///
    /// * `error` - The provider error to check
    ///
    /// # Returns
    ///
    /// `true` if the error is a context length exceeded error.
    pub fn is_context_overflow(error: &ProviderError) -> bool {
        matches!(error, ProviderError::ContextLengthExceeded(_))
    }

    /// Check if compaction has been attempted.
    pub fn compaction_attempted(&self) -> bool {
        self.compaction_attempted
    }

    /// Get the number of compaction attempts made.
    pub fn compaction_attempts(&self) -> u32 {
        self.compaction_attempts
    }

    /// Check if more retries are allowed.
    pub fn can_retry(&self) -> bool {
        self.compaction_attempts < self.max_retries
    }

    /// Record a compaction attempt without performing the compaction yet.
    pub fn note_compaction_attempt(&mut self) -> Result<()> {
        self.compaction_attempts += 1;
        self.compaction_attempted = true;

        info!(
            "Handling context overflow (attempt {}/{})",
            self.compaction_attempts, self.max_retries
        );

        if self.compaction_attempts > self.max_retries {
            warn!("Maximum compaction retries ({}) exceeded", self.max_retries);
            return Err(anyhow::anyhow!(
                "Context limit exceeded after {} compaction attempts. \
                 Try using a shorter message, a model with a larger context window, \
                 or start a new session.",
                self.max_retries
            ));
        }

        Ok(())
    }

    /// Reset the handler state for a new request cycle.
    pub fn reset(&mut self) {
        self.compaction_attempted = false;
        self.compaction_attempts = 0;
    }

    /// Handle a context overflow error by compacting the conversation.
    ///
    /// This method attempts to compact the conversation to reduce context size.
    /// If compaction succeeds, the caller should retry the request with the
    /// compacted conversation.
    ///
    /// # Arguments
    ///
    /// * `provider` - The provider to use for summarization during compaction
    /// * `conversation` - The current conversation to compact
    /// * `_session` - The current session (for future use)
    ///
    /// # Returns
    ///
    /// A tuple containing:
    /// - `Conversation`: The compacted conversation
    /// - `ProviderUsage`: Usage statistics from the compaction
    /// - `bool`: Whether the caller should retry the request
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Maximum retries have been exceeded
    /// - Compaction itself fails
    pub async fn handle_overflow(
        &mut self,
        provider: &dyn Provider,
        conversation: &Conversation,
        _session: &Session,
    ) -> Result<(Conversation, ProviderUsage, bool)> {
        self.note_compaction_attempt()?;

        debug!("Attempting conversation compaction");

        match compact_messages(provider, conversation, false).await {
            Ok((compacted_conversation, usage)) => {
                info!(
                    "Compaction successful, conversation reduced from {} to {} messages",
                    conversation.len(),
                    compacted_conversation.len()
                );
                Ok((compacted_conversation, usage, true))
            }
            Err(e) => {
                warn!("Compaction failed: {}", e);
                Err(anyhow::anyhow!("Failed to compact conversation: {}", e))
            }
        }
    }

    /// Handle overflow with progressive pruning.
    ///
    /// This method first attempts progressive pruning before falling back
    /// to full compaction.
    ///
    /// # Arguments
    ///
    /// * `provider` - The provider to use for summarization
    /// * `conversation` - The current conversation
    /// * `session` - The current session
    /// * `pruning_config` - Configuration for progressive pruning
    ///
    /// # Returns
    ///
    /// Same as `handle_overflow`.
    pub async fn handle_overflow_with_pruning(
        &mut self,
        provider: &dyn Provider,
        conversation: &Conversation,
        session: &Session,
        pruning_config: &crate::context::types::PruningConfig,
    ) -> Result<(Conversation, ProviderUsage, bool)> {
        use crate::context::pruner::ProgressivePruner;
        use crate::providers::base::Usage;

        // First try progressive pruning at hard_clear level
        let pruned_messages = ProgressivePruner::prune_messages(
            conversation.messages(),
            pruning_config.hard_clear_ratio + 0.1, // Force hard clear level
            pruning_config,
        );

        let pruned_conversation = Conversation::new_unvalidated(pruned_messages);

        // Check if pruning reduced the size significantly
        let original_len: usize = conversation
            .messages()
            .iter()
            .map(|m| m.as_concat_text().len())
            .sum();
        let pruned_len: usize = pruned_conversation
            .messages()
            .iter()
            .map(|m| m.as_concat_text().len())
            .sum();

        if pruned_len < original_len * 8 / 10 {
            // Pruning reduced size by at least 20%
            info!(
                "Progressive pruning reduced context from {} to {} chars",
                original_len, pruned_len
            );
            return Ok((
                pruned_conversation,
                ProviderUsage::new("pruning".to_string(), Usage::default()),
                true,
            ));
        }

        // Fall back to full compaction
        debug!("Progressive pruning insufficient, falling back to compaction");
        self.handle_overflow(provider, conversation, session).await
    }
}

/// Result of an overflow handling operation.
#[derive(Debug)]
pub struct OverflowResult {
    /// The compacted conversation
    pub conversation: Conversation,
    /// Usage statistics from compaction
    pub usage: ProviderUsage,
    /// Whether the request should be retried
    pub should_retry: bool,
    /// Number of compaction attempts made
    pub attempts: u32,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_context_overflow() {
        let overflow_error = ProviderError::ContextLengthExceeded("Context too long".to_string());
        let other_error = ProviderError::ServerError("Server error".to_string());

        assert!(OverflowHandler::is_context_overflow(&overflow_error));
        assert!(!OverflowHandler::is_context_overflow(&other_error));
    }

    #[test]
    fn test_overflow_handler_new() {
        let handler = OverflowHandler::new(3);
        assert_eq!(handler.max_retries, 3);
        assert!(!handler.compaction_attempted);
        assert_eq!(handler.compaction_attempts, 0);
    }

    #[test]
    fn test_overflow_handler_default() {
        let handler = OverflowHandler::default();
        assert_eq!(handler.max_retries, 2);
    }

    #[test]
    fn test_can_retry() {
        let mut handler = OverflowHandler::new(2);

        assert!(handler.can_retry());

        handler.compaction_attempts = 1;
        assert!(handler.can_retry());

        handler.compaction_attempts = 2;
        assert!(!handler.can_retry());
    }

    #[test]
    fn test_reset() {
        let mut handler = OverflowHandler::new(2);
        handler.compaction_attempted = true;
        handler.compaction_attempts = 2;

        handler.reset();

        assert!(!handler.compaction_attempted);
        assert_eq!(handler.compaction_attempts, 0);
    }

    #[test]
    fn test_compaction_attempted() {
        let mut handler = OverflowHandler::new(2);
        assert!(!handler.compaction_attempted());

        handler.compaction_attempted = true;
        assert!(handler.compaction_attempted());
    }
}
