//! Model-visible hook context, attributed by the executor that produced it.

use protocol::models::ContentItemMetadata;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookContext {
    pub text: String,
    pub metadata: ContentItemMetadata,
}

impl HookContext {
    pub fn harness(text: String) -> Self {
        Self {
            text,
            metadata: ContentItemMetadata::harness(),
        }
    }
}
