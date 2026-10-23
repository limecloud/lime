use serde::{Deserialize, Serialize};

/// 新聊天的输出详细程度；未设置时沿用模型默认值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelVerbosity {
    Low,
    Medium,
    High,
}

/// 推理摘要策略；不改变模型的推理能力或推理强度。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningSummary {
    #[default]
    Auto,
    Concise,
    Detailed,
    None,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use serde_json::json;

    #[test]
    fn output_defaults_roundtrip_and_reject_invalid_values() {
        let config: Config = serde_json::from_value(json!({
            "model_verbosity": "high", "model_reasoning_summary": "detailed"
        }))
        .unwrap();
        assert_eq!(config.model_verbosity, Some(ModelVerbosity::High));
        assert_eq!(config.model_reasoning_summary, ReasoningSummary::Detailed);
        let value = serde_json::to_value(config).unwrap();
        assert_eq!(value["model_verbosity"], "high");
        assert_eq!(value["model_reasoning_summary"], "detailed");
        let defaults: Config = serde_json::from_value(json!({})).unwrap();
        assert_eq!(defaults.model_verbosity, None);
        assert_eq!(defaults.model_reasoning_summary, ReasoningSummary::Auto);
        for invalid in [
            json!({"model_verbosity": "verbose"}),
            json!({"model_verbosity": 1}),
            json!({"model_reasoning_summary": "full"}),
            json!({"model_reasoning_summary": false}),
        ] {
            assert!(serde_json::from_value::<Config>(invalid).is_err());
        }
        let cleared: Config = serde_json::from_value(json!({"model_verbosity": null})).unwrap();
        assert_eq!(cleared.model_verbosity, None);
    }
}
