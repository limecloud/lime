use crate::session::memory::{
    detect_category, normalize_text, summarize_abstract, summarize_overview, MemoryCategory,
};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub(crate) struct MemoryCandidate {
    pub(crate) category: MemoryCategory,
    pub(crate) abstract_text: String,
    pub(crate) overview_text: String,
    pub(crate) content_text: String,
    pub(crate) content_hash: String,
}

pub(crate) fn build_memory_candidate(role: &str, text: &str) -> Option<MemoryCandidate> {
    let normalized = normalize_text(text);
    if normalized.len() < 16 {
        return None;
    }

    let content_text = text.trim().to_string();
    if content_text.is_empty() {
        return None;
    }

    Some(MemoryCandidate {
        category: detect_category(role, &normalized),
        abstract_text: summarize_abstract(&content_text),
        overview_text: summarize_overview(&content_text),
        content_hash: hash_text(&normalized),
        content_text,
    })
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}
