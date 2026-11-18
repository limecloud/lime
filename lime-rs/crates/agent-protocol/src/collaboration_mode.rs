use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Initial collaboration mode for a turn or session.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModeKind {
    Plan,
    #[default]
    Default,
}

/// Collaboration mode settings copied from the Codex protocol shape.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct CollaborationModeSettings {
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub developer_instructions: Option<String>,
}

/// Collaboration mode for a session or turn.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub struct CollaborationMode {
    pub mode: ModeKind,
    pub settings: CollaborationModeSettings,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collaboration_mode_uses_host_wire_shape() {
        let mode: CollaborationMode = serde_json::from_value(json!({
            "mode": "plan",
            "settings": {
                "model": "gpt-5-codex",
                "reasoning_effort": "high",
                "developer_instructions": null
            }
        }))
        .expect("typed collaboration mode");

        assert_eq!(mode.mode, ModeKind::Plan);
        assert_eq!(
            serde_json::to_value(mode).expect("serialize collaboration mode"),
            json!({
                "mode": "plan",
                "settings": {
                    "model": "gpt-5-codex",
                    "reasoning_effort": "high",
                    "developer_instructions": null
                }
            })
        );
    }
}
