//! Startup warning and model-catalog helpers shaped after Codex's TUI owner.
//!
//! These helpers deliberately stay pure. Lime does not yet have Codex's local config database,
//! trust prompts, or startup event bus, so persistence and interactive prompt rendering remain
//! deferred until the corresponding App Server contract exists.

use super::App;
use app_server_protocol::protocol::v2::{
    McpServerStartupState, McpServerStatusUpdatedNotification, Model, SkillErrorInfo,
};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq, Hash)]
struct SkillLoadWarningKey {
    path: PathBuf,
    message: String,
}

/// Tracks active skill errors so a reconnect or catalog refresh does not repeat the same warning.
#[derive(Debug, Default)]
pub(crate) struct SkillLoadWarningState {
    active: HashSet<SkillLoadWarningKey>,
}

impl SkillLoadWarningState {
    pub(crate) fn clear(&mut self) {
        self.active.clear();
    }

    pub(crate) fn newly_active_errors(&mut self, errors: &[SkillErrorInfo]) -> Vec<SkillErrorInfo> {
        let previous = std::mem::take(&mut self.active);
        let mut current = HashSet::new();
        let mut newly_active = Vec::new();

        for error in errors {
            let key = SkillLoadWarningKey {
                path: error.path.clone(),
                message: error.message.clone(),
            };
            let was_active = previous.contains(&key);
            if current.insert(key) && !was_active {
                newly_active.push(error.clone());
            }
        }

        self.active = current;
        newly_active
    }
}

/// Tracks App Server MCP startup failures without turning transient diagnostics into transcript
/// entries. A ready notification clears the matching server, while other TUI status keeps priority
/// during an active turn.
#[derive(Debug, Default)]
pub(crate) struct McpStartupWarningState {
    active: BTreeMap<String, Option<String>>,
}

impl McpStartupWarningState {
    pub(crate) fn observe(&mut self, notification: &McpServerStatusUpdatedNotification) {
        match notification.status {
            McpServerStartupState::Failed | McpServerStartupState::Cancelled => {
                self.active.insert(
                    notification.name.clone(),
                    notification
                        .error
                        .clone()
                        .filter(|error| !error.trim().is_empty()),
                );
            }
            McpServerStartupState::Ready => {
                self.active.remove(&notification.name);
            }
            McpServerStartupState::Starting => {}
        }
    }

    pub(crate) fn status(&self) -> Option<String> {
        match self.active.len() {
            0 => None,
            1 => self.active.iter().next().map(|(name, error)| {
                error.as_deref().map_or_else(
                    || format!("MCP startup issue: {name}"),
                    |error| format!("MCP startup issue: {name}: {error}"),
                )
            }),
            count => Some(format!("MCP startup issues: {count}")),
        }
    }
}

pub(crate) fn emit_skill_load_warnings(app: &mut App, errors: &[SkillErrorInfo]) {
    if errors.is_empty() {
        return;
    }

    app.projection
        .add_warning_message(app.chat_widget.locale.skipped_skills_message(errors.len()));
    for error in errors {
        let path = error.path.display().to_string();
        app.projection.add_error_message(
            app.chat_widget
                .locale
                .skill_load_error_message(&path, &error.message),
        );
    }
}

fn model_upgrade_target(model: &Model) -> Option<&str> {
    model.upgrade.as_deref().or_else(|| {
        model
            .upgrade_info
            .as_ref()
            .map(|upgrade| upgrade.model.as_str())
    })
}

fn visible_model(model: &Model) -> bool {
    !model.hidden
}

/// Returns whether the current model should offer a migration to `target_model`.
pub(crate) fn should_show_model_migration_prompt(
    current_model: &str,
    target_model: &str,
    seen_migrations: &BTreeMap<String, String>,
    available_models: &[Model],
) -> bool {
    if current_model == target_model
        || seen_migrations
            .get(current_model)
            .is_some_and(|seen| seen == target_model)
    {
        return false;
    }

    if !available_models
        .iter()
        .any(|model| model.model == target_model && visible_model(model))
    {
        return false;
    }

    if available_models
        .iter()
        .any(|model| model.model == current_model && model_upgrade_target(model).is_some())
    {
        return true;
    }

    available_models
        .iter()
        .any(|model| model_upgrade_target(model) == Some(target_model))
}

pub(crate) fn target_preset_for_upgrade<'a>(
    available_models: &'a [Model],
    target_model: &str,
) -> Option<&'a Model> {
    available_models
        .iter()
        .find(|model| model.model == target_model && visible_model(model))
}

/// Apply the model and default effort selected by a migration prompt.
pub(crate) fn apply_accepted_model_migration(
    model: &mut Option<String>,
    effort: &mut Option<String>,
    target_model: impl Into<String>,
    target_default_effort: impl Into<String>,
) {
    *model = Some(target_model.into());
    *effort = Some(target_default_effort.into());
}

pub(crate) const MODEL_AVAILABILITY_NUX_MAX_SHOW_COUNT: u32 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StartupTooltipOverride {
    pub(crate) model_slug: String,
    pub(crate) message: String,
}

pub(crate) fn select_model_availability_nux(
    available_models: &[Model],
    shown_count: &BTreeMap<String, u32>,
) -> Option<StartupTooltipOverride> {
    let model = available_models
        .iter()
        .find(|model| model.availability_nux.is_some())?;
    let message = model.availability_nux.as_ref()?.message.clone();
    let shown_count = shown_count.get(&model.model).copied().unwrap_or_default();
    (shown_count < MODEL_AVAILABILITY_NUX_MAX_SHOW_COUNT).then(|| StartupTooltipOverride {
        model_slug: model.model.clone(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::EntryKind;
    use app_server_protocol::protocol::v2::{InputModality, ModelAvailabilityNux};
    use app_server_protocol::CapabilitySnapshot;

    fn model(id: &str, hidden: bool) -> Model {
        Model {
            id: id.to_string(),
            provider_id: "fixture".to_string(),
            model: id.to_string(),
            upgrade: None,
            upgrade_info: None,
            availability_nux: None,
            display_name: id.to_string(),
            description: String::new(),
            hidden,
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
            is_default: false,
        }
    }

    #[test]
    fn model_migration_prompt_only_shows_for_visible_upgrade_target() {
        let mut current = model("old", false);
        current.upgrade = Some("new".to_string());
        let models = vec![current, model("new", false)];
        assert!(should_show_model_migration_prompt(
            "old",
            "new",
            &BTreeMap::new(),
            &models
        ));

        let mut hidden_target = model("new", true);
        hidden_target.hidden = true;
        assert!(!should_show_model_migration_prompt(
            "old",
            "new",
            &BTreeMap::new(),
            &[models[0].clone(), hidden_target]
        ));
    }

    #[test]
    fn model_migration_prompt_respects_seen_target_and_self_target() {
        let mut current = model("old", false);
        current.upgrade = Some("new".to_string());
        let models = vec![current, model("new", false)];
        let mut seen = BTreeMap::new();
        seen.insert("old".to_string(), "new".to_string());
        assert!(!should_show_model_migration_prompt(
            "old", "new", &seen, &models
        ));
        assert!(!should_show_model_migration_prompt(
            "new",
            "new",
            &BTreeMap::new(),
            &models
        ));
    }

    #[test]
    fn select_model_availability_nux_picks_only_eligible_model() {
        let mut target = model("target", false);
        target.availability_nux = Some(ModelAvailabilityNux {
            message: "target available".to_string(),
        });
        assert_eq!(
            select_model_availability_nux(&[model("plain", false), target], &BTreeMap::new()),
            Some(StartupTooltipOverride {
                model_slug: "target".to_string(),
                message: "target available".to_string(),
            })
        );
    }

    #[test]
    fn select_model_availability_nux_uses_existing_model_order_as_priority() {
        let mut first = model("first", false);
        first.availability_nux = Some(ModelAvailabilityNux {
            message: "first available".to_string(),
        });
        let mut second = model("second", false);
        second.availability_nux = Some(ModelAvailabilityNux {
            message: "second available".to_string(),
        });
        assert_eq!(
            select_model_availability_nux(&[first, second], &BTreeMap::new()),
            Some(StartupTooltipOverride {
                model_slug: "first".to_string(),
                message: "first available".to_string(),
            })
        );
    }

    #[test]
    fn select_model_availability_nux_does_not_fall_back_to_older_announcement() {
        let mut first = model("first", false);
        first.availability_nux = Some(ModelAvailabilityNux {
            message: "first available".to_string(),
        });
        let mut second = model("second", false);
        second.availability_nux = Some(ModelAvailabilityNux {
            message: "second available".to_string(),
        });
        let mut shown = BTreeMap::new();
        shown.insert("first".to_string(), MODEL_AVAILABILITY_NUX_MAX_SHOW_COUNT);
        assert_eq!(
            select_model_availability_nux(&[first, second], &shown),
            None
        );
    }

    #[test]
    fn select_model_availability_nux_returns_none_when_all_models_are_exhausted() {
        let mut target = model("target", false);
        target.availability_nux = Some(ModelAvailabilityNux {
            message: "target available".to_string(),
        });
        let shown = BTreeMap::from([("target".to_string(), MODEL_AVAILABILITY_NUX_MAX_SHOW_COUNT)]);
        assert_eq!(select_model_availability_nux(&[target], &shown), None);
    }

    #[test]
    fn skill_load_warning_state_suppresses_repeated_active_errors() {
        let mut state = SkillLoadWarningState::default();
        let error = SkillErrorInfo {
            path: PathBuf::from("/repo/.agents/skills/example/SKILL.md"),
            message: "invalid description".to_string(),
        };
        assert_eq!(
            state.newly_active_errors(std::slice::from_ref(&error)),
            vec![error.clone()]
        );
        assert!(state
            .newly_active_errors(std::slice::from_ref(&error))
            .is_empty());
        assert_eq!(
            state.newly_active_errors(&[error.clone(), error.clone()]),
            Vec::<SkillErrorInfo>::new()
        );
        state.clear();
        assert_eq!(
            state.newly_active_errors(std::slice::from_ref(&error)),
            vec![error]
        );
    }

    #[test]
    fn mcp_startup_warning_state_clears_only_the_ready_server() {
        let mut state = McpStartupWarningState::default();
        state.observe(&McpServerStatusUpdatedNotification {
            thread_id: None,
            name: "docs".to_string(),
            status: McpServerStartupState::Failed,
            error: Some("offline".to_string()),
            failure_reason: None,
        });
        state.observe(&McpServerStatusUpdatedNotification {
            thread_id: None,
            name: "calendar".to_string(),
            status: McpServerStartupState::Cancelled,
            error: None,
            failure_reason: None,
        });
        assert_eq!(state.status(), Some("MCP startup issues: 2".to_string()));

        state.observe(&McpServerStatusUpdatedNotification {
            thread_id: None,
            name: "docs".to_string(),
            status: McpServerStartupState::Ready,
            error: None,
            failure_reason: None,
        });
        assert_eq!(
            state.status(),
            Some("MCP startup issue: calendar".to_string())
        );
    }

    #[test]
    fn emit_skill_load_warnings_projects_summary_and_details() {
        let mut app = App::default();
        let errors = vec![SkillErrorInfo {
            path: PathBuf::from("/repo/.agents/skills/example/SKILL.md"),
            message: "invalid description".to_string(),
        }];
        emit_skill_load_warnings(&mut app, &errors);
        let messages = app
            .projection
            .entries()
            .iter()
            .map(|entry| entry.text.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            messages,
            vec![
                "Skipped loading 1 skill(s) due to invalid SKILL.md files.",
                "/repo/.agents/skills/example/SKILL.md: invalid description",
            ]
        );
        assert_eq!(app.projection.entries()[0].kind, EntryKind::Warning);
        assert_eq!(app.projection.entries()[1].kind, EntryKind::Error);
    }

    #[test]
    fn accepted_model_migration_updates_model_and_effort() {
        let mut model = Some("old".to_string());
        let mut effort = Some("low".to_string());
        apply_accepted_model_migration(&mut model, &mut effort, "new", "high");
        assert_eq!(model.as_deref(), Some("new"));
        assert_eq!(effort.as_deref(), Some("high"));
    }
}
