//! Reasoning choices and shortcut steps share the server-owned catalog authority.

use super::ModelCatalog;
use app_server_protocol::protocol::v2::{Model, ReasoningEffortOption};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReasoningShortcutDirection {
    Lower,
    Raise,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReasoningStep {
    Change(String),
    Bound(String),
    Advanced,
}

pub(crate) fn is_advanced_reasoning(effort: &str) -> bool {
    matches!(effort, "max" | "ultra")
}

pub(crate) fn reasoning_options(model: &Model) -> Vec<ReasoningEffortOption> {
    let mut options = model.supported_reasoning_efforts.clone();
    if options.is_empty() && !model.default_reasoning_effort.trim().is_empty() {
        options.push(ReasoningEffortOption {
            reasoning_effort: model.default_reasoning_effort.clone(),
            description: String::new(),
        });
    }
    options.retain(|option| !option.reasoning_effort.trim().is_empty());
    // Preserve the advertised normal order; advanced choices always follow it, Max before Ultra.
    options.sort_by_key(|option| match option.reasoning_effort.as_str() {
        "max" => 1,
        "ultra" => 2,
        _ => 0,
    });
    options
}

impl ModelCatalog {
    pub(crate) fn reasoning_step(
        &self,
        model: Option<&str>,
        provider: Option<&str>,
        configured: Option<&str>,
        direction: ReasoningShortcutDirection,
    ) -> Option<ReasoningStep> {
        let model = model?;
        let mut matches = self.models.iter().filter(|entry| {
            entry.model == model && provider.is_none_or(|provider| entry.provider_id == provider)
        });
        let preset = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        let choices = reasoning_options(preset);
        let current = reasoning_anchor(&choices, configured, &preset.default_reasoning_effort)?;
        let next = match direction {
            ReasoningShortcutDirection::Lower => current.checked_sub(1),
            ReasoningShortcutDirection::Raise => Some(current + 1),
        }
        .and_then(|index| choices.get(index));
        let Some(next) = next else {
            return Some(ReasoningStep::Bound(
                choices[current].reasoning_effort.clone(),
            ));
        };
        if direction == ReasoningShortcutDirection::Raise && next.reasoning_effort == "ultra" {
            return Some(ReasoningStep::Advanced);
        }
        Some(ReasoningStep::Change(next.reasoning_effort.clone()))
    }
}

pub(crate) fn reasoning_anchor(
    choices: &[ReasoningEffortOption],
    configured: Option<&str>,
    default: &str,
) -> Option<usize> {
    let position = |effort: &str| {
        choices
            .iter()
            .position(|choice| choice.reasoning_effort == effort)
    };
    configured
        .and_then(position)
        .or_else(|| position(default))
        .or_else(|| (!choices.is_empty()).then_some(0))
}

#[cfg(test)]
#[path = "reasoning_tests.rs"]
mod tests;
