//! Thread-scoped model, provider, permission and collaboration settings.
//!
//! Settings are mirrored from the App Server session into the active TUI projection. This module
//! owns local normalization and Codex-shaped collaboration mode selection; persistence remains in
//! `AppServerSession`.

use super::*;
use crate::collaboration_modes;
use crate::model_catalog::ModelCatalog;
use crate::model_picker::ModelPicker;
use crate::settings::{cycle_setting, PERMISSION_PROFILES};

impl App {
    pub(crate) fn set_model_catalog(
        &mut self,
        models: Vec<app_server_protocol::protocol::v2::Model>,
    ) {
        self.chat_widget.model_catalog = ModelCatalog::new(models)
            .with_collaboration_modes(self.chat_widget.model_catalog.collaboration_modes.clone());
        self.sync_default_collaboration_mode();
    }

    pub(crate) fn set_settings(
        &mut self,
        model: Option<String>,
        model_provider: Option<String>,
        reasoning_effort: Option<String>,
        permissions: Option<String>,
    ) {
        self.chat_widget.model = model;
        self.chat_widget.model_provider = model_provider;
        self.chat_widget.reasoning_effort = reasoning_effort;
        self.chat_widget.permissions = permissions;
        if let Some(collaboration_mode) = self.chat_widget.collaboration_mode.as_mut() {
            if let Some(model) = self.chat_widget.model.as_deref() {
                collaboration_mode.settings.model = model.to_string();
            }
            if let Some(effort) = self.chat_widget.reasoning_effort.as_ref() {
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
        self.chat_widget.permission_profiles = next;
    }

    pub(crate) fn cycle_permission_profile(&self, current: Option<&str>, direction: i8) -> String {
        if self.chat_widget.permission_profiles.is_empty() {
            return cycle_setting(&PERMISSION_PROFILES, current, direction);
        }
        cycle_setting(&self.chat_widget.permission_profiles, current, direction)
    }

    pub(crate) fn open_model_picker(
        &mut self,
        models: Vec<app_server_protocol::protocol::v2::Model>,
    ) {
        self.set_model_catalog(models);
        let models = self
            .chat_widget
            .model_catalog
            .try_list_models()
            .unwrap_or_default();
        self.chat_widget.model_picker = Some(
            ModelPicker::new(models)
                .with_keymap(self.runtime_keymap.list().clone())
                .with_current(
                    self.chat_widget.model.as_deref(),
                    self.chat_widget.model_provider.as_deref(),
                )
                .with_current_effort(self.chat_widget.reasoning_effort.as_deref()),
        );
    }

    pub(crate) fn set_collaboration_modes(
        &mut self,
        collaboration_modes: Vec<app_server_protocol::protocol::v2::CollaborationModeMask>,
    ) {
        self.chat_widget.model_catalog.collaboration_modes = collaboration_modes;
        self.sync_default_collaboration_mode();
    }

    fn sync_default_collaboration_mode(&mut self) {
        if self.chat_widget.collaboration_mode.is_some() {
            return;
        }
        let mask = collaboration_modes::default_mode_mask(&self.chat_widget.model_catalog)
            .or_else(|| collaboration_modes::default_mask(&self.chat_widget.model_catalog));
        self.chat_widget.collaboration_mode = mask.and_then(|mask| {
            collaboration_modes::to_mode(
                &mask,
                self.chat_widget.model.as_deref(),
                self.chat_widget.reasoning_effort.as_deref(),
            )
        });
    }

    pub(crate) fn next_collaboration_mode(&self) -> Option<agent_protocol::CollaborationMode> {
        let current_mask = self.chat_widget.collaboration_mode.as_ref().map(|mode| {
            app_server_protocol::protocol::v2::CollaborationModeMask {
                name: String::new(),
                mode: Some(mode.mode),
                model: Some(mode.settings.model.clone()),
                reasoning_effort: Some(mode.settings.reasoning_effort.clone()),
            }
        });
        let mask =
            collaboration_modes::next_mask(&self.chat_widget.model_catalog, current_mask.as_ref())?;
        collaboration_modes::to_mode(
            &mask,
            self.chat_widget.model.as_deref(),
            self.chat_widget.reasoning_effort.as_deref(),
        )
    }

    pub(crate) fn plan_mode(&self) -> Option<agent_protocol::CollaborationMode> {
        let mask = collaboration_modes::plan_mask(&self.chat_widget.model_catalog)?;
        collaboration_modes::to_mode(
            &mask,
            self.chat_widget.model.as_deref(),
            self.chat_widget.reasoning_effort.as_deref(),
        )
    }
}
