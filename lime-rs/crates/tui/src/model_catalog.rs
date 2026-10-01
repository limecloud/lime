//! Server-owned model and collaboration mode catalog used by the TUI.

use app_server_protocol::protocol::v2::{CollaborationModeMask, Model};
use std::convert::Infallible;

mod reasoning;
pub(crate) use reasoning::{
    is_advanced_reasoning, reasoning_anchor, reasoning_options, ReasoningShortcutDirection,
    ReasoningStep,
};

/// A snapshot of the model picker inputs returned by App Server.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ModelCatalog {
    pub(crate) models: Vec<Model>,
    pub(crate) collaboration_modes: Vec<CollaborationModeMask>,
}

impl ModelCatalog {
    pub(crate) fn new(models: Vec<Model>) -> Self {
        Self {
            models,
            collaboration_modes: Vec::new(),
        }
    }

    pub(crate) fn with_collaboration_modes(
        mut self,
        collaboration_modes: Vec<CollaborationModeMask>,
    ) -> Self {
        self.collaboration_modes = collaboration_modes;
        self
    }

    pub(crate) fn try_list_models(&self) -> Result<Vec<Model>, Infallible> {
        Ok(self.models.clone())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::InputModality;
    use app_server_protocol::CapabilitySnapshot;

    pub(crate) fn model(id: &str, provider: &str, is_default: bool) -> Model {
        Model {
            id: id.to_string(),
            provider_id: provider.to_string(),
            model: id.to_string(),
            upgrade: None,
            upgrade_info: None,
            availability_nux: None,
            display_name: id.to_string(),
            description: String::new(),
            hidden: false,
            supported_reasoning_efforts: Vec::new(),
            default_reasoning_effort: "medium".to_string(),
            input_modalities: vec![InputModality::Text],
            capability_snapshot: CapabilitySnapshot::default(),
            context_window: None,
            max_output_tokens: None,
            supports_personality: false,
            multi_agent_version: None,
            additional_speed_tiers: Vec::new(),
            service_tiers: Vec::new(),
            default_service_tier: None,
            is_default,
        }
    }

    #[test]
    fn model_catalog_preserves_server_order() {
        let catalog = ModelCatalog::new(vec![
            model("fast", "fixture", false),
            model("default", "fixture", true),
        ]);

        assert_eq!(catalog.try_list_models().unwrap(), catalog.models);
    }
}
