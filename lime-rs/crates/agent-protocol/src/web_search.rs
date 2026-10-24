use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Search access is separate from whether a turn must call the search tool.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum WebSearchMode {
    Disabled,
    #[default]
    Cached,
    Indexed,
    Live,
}

impl WebSearchMode {
    pub fn restrict_to(self, requested: Self) -> Self {
        match (self, requested) {
            (Self::Disabled, _) | (_, Self::Disabled) => Self::Disabled,
            (Self::Cached, _) | (_, Self::Cached) => Self::Cached,
            (Self::Indexed, _) | (_, Self::Indexed) => Self::Indexed,
            (Self::Live, Self::Live) => Self::Live,
        }
    }

    pub fn for_sandbox(sandbox: Option<&str>) -> Self {
        match sandbox {
            Some("danger-full-access") => Self::Live,
            _ => Self::Cached,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_access_can_only_be_restricted() {
        let modes = [
            WebSearchMode::Disabled,
            WebSearchMode::Cached,
            WebSearchMode::Indexed,
            WebSearchMode::Live,
        ];
        for (ceiling, mode) in modes.iter().enumerate() {
            for (requested, next) in modes.iter().enumerate() {
                assert_eq!(mode.restrict_to(*next), modes[ceiling.min(requested)]);
            }
        }
    }

    #[test]
    fn modes_have_exact_wire_values_and_reject_old_provider_tables() {
        for value in ["disabled", "cached", "indexed", "live"] {
            let mode: WebSearchMode = serde_json::from_value(serde_json::json!(value)).unwrap();
            assert_eq!(serde_json::to_value(mode).unwrap(), value);
        }
        assert!(
            serde_json::from_value::<WebSearchMode>(serde_json::json!({"engine":"google"}))
                .is_err()
        );
        assert_eq!(WebSearchMode::for_sandbox(None), WebSearchMode::Cached);
        assert_eq!(
            WebSearchMode::for_sandbox(Some("workspace-write")),
            WebSearchMode::Cached
        );
        assert_eq!(
            WebSearchMode::for_sandbox(Some("danger-full-access")),
            WebSearchMode::Live
        );
    }
}
