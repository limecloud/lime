//! Lime-native collaboration mode discovery and selection helpers.

use agent_protocol::{CollaborationMode, CollaborationModeSettings, ModeKind};
use app_server_protocol::protocol::v2::CollaborationModeMask;

use crate::model_catalog::ModelCatalog;

fn filtered_presets(model_catalog: &ModelCatalog) -> Vec<CollaborationModeMask> {
    model_catalog
        .collaboration_modes
        .clone()
        .into_iter()
        .filter(|mask| mask.mode.is_some())
        .collect()
}

pub(crate) fn default_mask(model_catalog: &ModelCatalog) -> Option<CollaborationModeMask> {
    let presets = filtered_presets(model_catalog);
    presets
        .iter()
        .find(|mask| mask.mode == Some(ModeKind::Default))
        .cloned()
        .or_else(|| presets.into_iter().next())
}

pub(crate) fn mask_for_kind(
    model_catalog: &ModelCatalog,
    kind: ModeKind,
) -> Option<CollaborationModeMask> {
    filtered_presets(model_catalog)
        .into_iter()
        .find(|mask| mask.mode == Some(kind))
}

/// Cycle to the next server-advertised collaboration mode in list order.
pub(crate) fn next_mask(
    model_catalog: &ModelCatalog,
    current: Option<&CollaborationModeMask>,
) -> Option<CollaborationModeMask> {
    let presets = filtered_presets(model_catalog);
    if presets.is_empty() {
        return None;
    }
    let current_mode = current.and_then(|mask| mask.mode);
    let next_index = presets
        .iter()
        .position(|mask| mask.mode == current_mode)
        .map_or(0, |index| (index + 1) % presets.len());
    presets.get(next_index).cloned()
}

pub(crate) fn default_mode_mask(model_catalog: &ModelCatalog) -> Option<CollaborationModeMask> {
    mask_for_kind(model_catalog, ModeKind::Default)
}

pub(crate) fn plan_mask(model_catalog: &ModelCatalog) -> Option<CollaborationModeMask> {
    mask_for_kind(model_catalog, ModeKind::Plan)
}

pub(crate) fn to_mode(
    mask: &CollaborationModeMask,
    fallback_model: Option<&str>,
    fallback_effort: Option<&str>,
) -> Option<CollaborationMode> {
    let mode = mask.mode?;
    let model = mask.model.as_deref().or(fallback_model)?.to_string();
    let reasoning_effort = match &mask.reasoning_effort {
        Some(effort) => effort.clone(),
        None => fallback_effort.map(str::to_string),
    };
    Some(CollaborationMode {
        mode,
        settings: CollaborationModeSettings {
            model,
            reasoning_effort,
            developer_instructions: None,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mask(name: &str, mode: ModeKind, model: Option<&str>) -> CollaborationModeMask {
        CollaborationModeMask {
            name: name.to_string(),
            mode: Some(mode),
            model: model.map(str::to_string),
            reasoning_effort: Some(Some("high".to_string())),
        }
    }

    #[test]
    fn mode_selection_prefers_default_and_cycles_in_server_order() {
        let catalog = ModelCatalog::default().with_collaboration_modes(vec![
            mask("plan", ModeKind::Plan, Some("planner")),
            mask("default", ModeKind::Default, Some("default")),
        ]);

        assert_eq!(default_mask(&catalog).unwrap().name, "default");
        assert_eq!(default_mode_mask(&catalog).unwrap().name, "default");
        assert_eq!(plan_mask(&catalog).unwrap().name, "plan");
        assert_eq!(
            next_mask(&catalog, Some(&mask("plan", ModeKind::Plan, None)))
                .unwrap()
                .name,
            "default"
        );
    }

    #[test]
    fn to_mode_uses_mask_values_and_fallbacks() {
        let plan = mask("plan", ModeKind::Plan, None);
        let mode = to_mode(&plan, Some("fallback-model"), Some("medium")).expect("mode");
        assert_eq!(mode.mode, ModeKind::Plan);
        assert_eq!(mode.settings.model, "fallback-model");
        assert_eq!(mode.settings.reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn to_mode_preserves_an_explicit_effort_clear() {
        let mask = CollaborationModeMask {
            name: "default".to_string(),
            mode: Some(ModeKind::Default),
            model: None,
            reasoning_effort: Some(None),
        };
        let mode = to_mode(&mask, Some("fallback-model"), Some("high")).expect("mode");
        assert_eq!(mode.settings.reasoning_effort, None);
    }

    #[test]
    fn empty_catalog_has_no_mode() {
        let catalog = ModelCatalog::default();
        assert!(default_mask(&catalog).is_none());
        assert!(next_mask(&catalog, None).is_none());
    }
}
