//! Thread settings and collaboration-mode projection for `ChatWidget`.
//!
//! App Server remains the canonical settings authority. This module only owns the ChatWidget
//! snapshot and the Codex-shaped model/collaboration derivation used by the TUI surface.

use super::ChatWidget;
use crate::app_server_session::ThreadSettingsPatch;
use crate::collaboration_modes;
use crate::model_catalog::ModelCatalog;
use crate::model_picker::ModelPicker;
use crate::settings::{cycle_setting, PERMISSION_PROFILES};

impl ChatWidget {
    pub(crate) fn settings_patch(&self) -> ThreadSettingsPatch {
        ThreadSettingsPatch::new(
            self.model.clone(),
            self.model_provider.clone(),
            self.reasoning_effort.clone(),
            self.permissions.clone(),
        )
    }

    pub(crate) fn apply_model_selection(
        &mut self,
        model: String,
        provider: Option<String>,
        effort: Option<String>,
    ) {
        self.set_settings(
            Some(model),
            provider,
            effort.or_else(|| self.reasoning_effort.clone()),
            self.permissions.clone(),
        );
    }

    pub(crate) fn apply_effort(&mut self, effort: String) {
        self.set_settings(
            self.model.clone(),
            self.model_provider.clone(),
            Some(effort),
            self.permissions.clone(),
        );
    }

    pub(crate) fn apply_permissions(&mut self, permissions: String) {
        self.set_settings(
            self.model.clone(),
            self.model_provider.clone(),
            self.reasoning_effort.clone(),
            Some(permissions),
        );
    }

    pub(crate) fn apply_collaboration_mode(
        &mut self,
        collaboration_mode: agent_protocol::CollaborationMode,
    ) {
        self.set_settings(
            Some(collaboration_mode.settings.model.clone()),
            self.model_provider.clone(),
            collaboration_mode.settings.reasoning_effort.clone(),
            self.permissions.clone(),
        );
        self.set_collaboration_mode(collaboration_mode);
    }

    pub(crate) fn set_model_catalog(
        &mut self,
        models: Vec<app_server_protocol::protocol::v2::Model>,
    ) {
        self.model_catalog = ModelCatalog::new(models)
            .with_collaboration_modes(self.model_catalog.collaboration_modes.clone());
        self.sync_default_collaboration_mode();
    }

    pub(crate) fn set_settings(
        &mut self,
        model: Option<String>,
        model_provider: Option<String>,
        reasoning_effort: Option<String>,
        permissions: Option<String>,
    ) {
        self.model = model;
        self.model_provider = model_provider;
        self.reasoning_effort = reasoning_effort;
        self.permissions = permissions;
        if let Some(collaboration_mode) = self.collaboration_mode.as_mut() {
            if let Some(model) = self.model.as_deref() {
                collaboration_mode.settings.model = model.to_string();
            }
            if let Some(effort) = self.reasoning_effort.as_ref() {
                collaboration_mode.settings.reasoning_effort = Some(effort.clone());
            }
        }
        self.sync_default_collaboration_mode();
    }

    pub(crate) fn set_permission_profiles(&mut self, profiles: impl IntoIterator<Item = String>) {
        let mut next = Vec::new();
        for profile in profiles {
            let profile = profile.trim();
            if profile.is_empty() || next.iter().any(|value| value == profile) {
                continue;
            }
            next.push(profile.to_string());
        }
        self.permission_profiles = next;
    }

    pub(crate) fn cycle_permission_profile(&self, current: Option<&str>, direction: i8) -> String {
        if self.permission_profiles.is_empty() {
            return cycle_setting(&PERMISSION_PROFILES, current, direction);
        }
        cycle_setting(&self.permission_profiles, current, direction)
    }

    pub(crate) fn open_model_picker(
        &mut self,
        models: Vec<app_server_protocol::protocol::v2::Model>,
    ) {
        self.set_model_catalog(models);
        let models = self.model_catalog.try_list_models().unwrap_or_default();
        self.model_picker = Some(
            ModelPicker::new(models)
                .with_keymap(self.runtime_keymap.list().clone())
                .with_current(self.model.as_deref(), self.model_provider.as_deref())
                .with_current_effort(self.reasoning_effort.as_deref()),
        );
    }

    pub(crate) fn set_collaboration_modes(
        &mut self,
        collaboration_modes: Vec<app_server_protocol::protocol::v2::CollaborationModeMask>,
    ) {
        self.model_catalog.collaboration_modes = collaboration_modes;
        self.sync_default_collaboration_mode();
    }

    pub(crate) fn set_collaboration_mode(
        &mut self,
        collaboration_mode: agent_protocol::CollaborationMode,
    ) {
        self.collaboration_mode = Some(collaboration_mode);
    }

    fn sync_default_collaboration_mode(&mut self) {
        if self.collaboration_mode.is_some() {
            return;
        }
        let mask = collaboration_modes::default_mode_mask(&self.model_catalog)
            .or_else(|| collaboration_modes::default_mask(&self.model_catalog));
        self.collaboration_mode = mask.and_then(|mask| {
            collaboration_modes::to_mode(
                &mask,
                self.model.as_deref(),
                self.reasoning_effort.as_deref(),
            )
        });
    }

    pub(crate) fn next_collaboration_mode(&self) -> Option<agent_protocol::CollaborationMode> {
        let current_mask = self.collaboration_mode.as_ref().map(|mode| {
            app_server_protocol::protocol::v2::CollaborationModeMask {
                name: String::new(),
                mode: Some(mode.mode),
                model: Some(mode.settings.model.clone()),
                reasoning_effort: Some(mode.settings.reasoning_effort.clone()),
            }
        });
        let mask = collaboration_modes::next_mask(&self.model_catalog, current_mask.as_ref())?;
        collaboration_modes::to_mode(
            &mask,
            self.model.as_deref(),
            self.reasoning_effort.as_deref(),
        )
    }

    pub(crate) fn plan_mode(&self) -> Option<agent_protocol::CollaborationMode> {
        let mask = collaboration_modes::plan_mask(&self.model_catalog)?;
        collaboration_modes::to_mode(
            &mask,
            self.model.as_deref(),
            self.reasoning_effort.as_deref(),
        )
    }
}
