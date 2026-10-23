use lime_core::models::model_registry::ModelCapabilities;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Default, Deserialize)]
pub(super) struct OutputMetadata {
    #[serde(default, alias = "supports_reasoning_summaries")]
    supports_reasoning_summary_parameter: Option<bool>,
    #[serde(default)]
    support_verbosity: Option<bool>,
}

impl OutputMetadata {
    pub(super) fn apply(&self, target: &mut ModelCapabilities, capabilities: Option<&Value>) {
        target.supports_reasoning_summaries = self
            .supports_reasoning_summary_parameter
            .or_else(|| {
                capabilities?
                    .get("supports_reasoning_summary_parameter")
                    .or_else(|| capabilities?.get("supports_reasoning_summaries"))?
                    .as_bool()
            })
            .unwrap_or(false);
        target.support_verbosity = self
            .support_verbosity
            .or_else(|| capabilities?.get("support_verbosity")?.as_bool())
            .unwrap_or(false);
    }
}

#[cfg(test)]
mod tests {
    use super::super::ModelRegistryService;

    #[test]
    fn catalog_output_support_requires_explicit_declarations() {
        let body = r#"{"data":[
            {"id":"supported","supports_reasoning_summary_parameter":true,"support_verbosity":true},
            {"id":"nested","capabilities":{"supports_reasoning_summaries":true,"support_verbosity":true}},
            {"id":"gpt-5-codex"},
            {"id":"disabled","support_verbosity":false,"capabilities":{"support_verbosity":true}}
        ]}"#;
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        let service = ModelRegistryService::new(std::sync::Arc::new(std::sync::Mutex::new(conn)));
        let models = ModelRegistryService::parse_openai_models_response(body)
            .unwrap()
            .into_iter()
            .map(|model| service.convert_api_model(model, "fixture", 0))
            .collect::<Vec<_>>();
        assert_eq!(models.len(), 4);
        for (model, expected) in models.iter().zip([true, true, false, false]) {
            assert_eq!(model.capabilities.support_verbosity, expected);
        }
        assert!(models[0].capabilities.supports_reasoning_summaries);
        assert!(models[1].capabilities.supports_reasoning_summaries);
        assert!(!models[2].capabilities.supports_reasoning_summaries);
    }
}
