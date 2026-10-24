//! Canonical boolean feature keys; matches Codex's flattened FeaturesToml entries.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct FeaturesToml {
    #[serde(flatten)]
    pub entries: BTreeMap<String, bool>,
}

impl FeaturesToml {
    pub fn is_empty(&self) -> bool { self.entries.is_empty() }

    pub fn workspace_dependencies_enabled(&self) -> bool {
        // Codex features/src/lib.rs: Feature::WorkspaceDependencies is stable and defaults to true.
        self.entries.get("workspace_dependencies").copied().unwrap_or(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_boolean_feature_preserves_default_and_explicit_disable() {
        let default = FeaturesToml::default();
        assert!(default.workspace_dependencies_enabled());
        let disabled: FeaturesToml = serde_json::from_value(serde_json::json!({"workspace_dependencies":false})).unwrap();
        assert!(!disabled.workspace_dependencies_enabled());
        assert_eq!(serde_json::to_value(disabled).unwrap(), serde_json::json!({"workspace_dependencies":false}));
        assert!(serde_json::from_value::<FeaturesToml>(serde_json::json!({"workspace_dependencies":"false"})).is_err());
    }
}
