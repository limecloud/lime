use serde::{Deserialize, Serialize};

use crate::session_store::PersistedSessionMetadata;

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let text = value?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionStateSnapshot {
    pub session_id: String,
    pub exists: bool,
    pub system_prompt: Option<String>,
    pub working_dir: Option<String>,
    pub execution_strategy: Option<String>,
}

impl SessionStateSnapshot {
    pub fn from_persisted_metadata(
        session_id: impl Into<String>,
        metadata: Option<PersistedSessionMetadata>,
    ) -> Self {
        match metadata {
            Some(metadata) => Self {
                session_id: session_id.into(),
                exists: true,
                system_prompt: normalize_optional_text(metadata.system_prompt),
                working_dir: normalize_optional_text(metadata.working_dir),
                execution_strategy: normalize_optional_text(metadata.execution_strategy),
            },
            None => Self {
                session_id: session_id.into(),
                exists: false,
                system_prompt: None,
                working_dir: None,
                execution_strategy: None,
            },
        }
    }

    pub fn has_persisted_session(&self) -> bool {
        self.exists
    }

    pub fn system_prompt(&self) -> Option<&str> {
        self.system_prompt.as_deref()
    }

    pub fn working_dir(&self) -> Option<&str> {
        self.working_dir.as_deref()
    }

    pub fn execution_strategy(&self) -> Option<&str> {
        self.execution_strategy.as_deref()
    }

    pub fn needs_working_dir_update(&self, working_dir: &str) -> bool {
        let Some(current) = self.working_dir() else {
            return false;
        };
        let target = working_dir.trim();
        !target.is_empty() && current != target
    }

    pub fn with_working_dir(mut self, working_dir: Option<String>) -> Self {
        self.working_dir = normalize_optional_text(working_dir);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::SessionStateSnapshot;
    use crate::session_store::PersistedSessionMetadata;

    #[test]
    fn test_session_state_snapshot_normalizes_persisted_metadata() {
        let snapshot = SessionStateSnapshot::from_persisted_metadata(
            "session-1",
            Some(PersistedSessionMetadata {
                system_prompt: Some("  你是助手  ".to_string()),
                working_dir: Some(" /tmp/workspace ".to_string()),
                execution_strategy: Some(" react ".to_string()),
            }),
        );

        assert!(snapshot.has_persisted_session());
        assert_eq!(snapshot.system_prompt(), Some("你是助手"));
        assert_eq!(snapshot.working_dir(), Some("/tmp/workspace"));
        assert_eq!(snapshot.execution_strategy(), Some("react"));
    }

    #[test]
    fn test_session_state_snapshot_detects_working_dir_update() {
        let snapshot = SessionStateSnapshot::from_persisted_metadata(
            "session-2",
            Some(PersistedSessionMetadata {
                system_prompt: None,
                working_dir: Some("/tmp/origin".to_string()),
                execution_strategy: None,
            }),
        );

        assert!(snapshot.needs_working_dir_update("/tmp/next"));
        assert!(!snapshot.needs_working_dir_update("/tmp/origin"));

        let updated = snapshot.with_working_dir(Some("/tmp/next".to_string()));
        assert_eq!(updated.working_dir(), Some("/tmp/next"));
    }
}
