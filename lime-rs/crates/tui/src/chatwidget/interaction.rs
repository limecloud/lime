//! Chat surface interaction helpers owned by `ChatWidget`.
//!
//! The terminal host still decides which `AppAction` to dispatch, but mutable presentation
//! state and generic dialog construction stay with the chat surface. Main reading interaction
//! belongs to the App-owned `TranscriptView`.

use std::path::PathBuf;

use crossterm::event::{Event, KeyEvent};

use super::transcript_export::ExportPickerAction;
use super::ChatWidget;
use crate::app::agent_picker::AgentPicker;
use crate::app::agent_picker::AgentPickerAction;
use crate::app::agents_overview::AgentsOverviewState;
use crate::app::agents_overview_view::AgentsOverviewAction;
use crate::keymap::{GlobalKeymapAction, KeymapMatch};
use crate::model_picker::{ModelPickerAction, ModelSelection};
use crate::pager_overlay::{PagerAction, PagerOverlay};
use crate::resume_picker::PickerAction;
use crate::resume_picker::PickerState;

#[derive(Debug)]
pub(crate) enum ExportPickerEvent {
    Consumed,
    Cancel,
    Copy,
    Save(Option<PathBuf>),
}

#[derive(Debug)]
pub(crate) enum ResumePickerEvent {
    Picker(PickerAction),
    Transcript(Option<PagerAction>),
}

#[derive(Debug)]
pub(crate) struct AgentsOverviewEvent {
    pub(crate) action: AgentsOverviewAction,
    pub(crate) selected_thread_id: Option<String>,
}

#[derive(Debug)]
pub(crate) enum ModelPickerEvent {
    None,
    Cancel,
    Select(Option<ModelSelection>),
}

impl ChatWidget {
    pub(crate) fn set_resume_picker(&mut self, picker: PickerState) {
        self.resume_picker = Some(picker);
    }

    pub(crate) fn clear_resume_picker(&mut self) {
        self.resume_picker = None;
    }

    pub(crate) fn resume_picker_mut(&mut self) -> Option<&mut PickerState> {
        self.resume_picker.as_mut()
    }

    pub(crate) fn set_agents_overview(&mut self, overview: AgentsOverviewState) {
        self.agents_overview = Some(overview);
    }

    pub(crate) fn clear_agents_overview(&mut self) {
        self.agents_overview = None;
    }

    pub(crate) fn clear_model_picker(&mut self) {
        self.model_picker = None;
    }

    pub(crate) fn set_agent_picker(&mut self, picker: AgentPicker) {
        self.agent_picker = Some(picker);
    }

    pub(crate) fn reset_global_key_chord(&mut self) {
        self.global_key_chord_matcher.reset();
    }

    pub(crate) fn dispatch_global_key(&mut self, key: KeyEvent) -> KeymapMatch<GlobalKeymapAction> {
        self.runtime_keymap
            .transcript()
            .dispatch_global(&mut self.global_key_chord_matcher, key)
    }

    pub(crate) fn dismiss_shortcut_overlay(&mut self) {
        self.bottom_pane.dismiss_shortcut_overlay();
    }

    pub(crate) fn open_approval_details_pager(&mut self, key: KeyEvent) -> bool {
        let Some((title, lines)) = self.bottom_pane.approval_details_for_key(key, self.locale)
        else {
            return false;
        };

        self.dismiss_pager_overlay();
        self.pager_overlay = Some(
            PagerOverlay::new(title, lines).with_keymap(self.runtime_keymap.transcript().clone()),
        );
        true
    }

    pub(crate) fn handle_pager_event(&mut self, event: &Event) -> Option<PagerAction> {
        let pager = self.pager_overlay.as_mut()?;
        let action = pager.handle_event(event);
        if action == PagerAction::Close {
            self.dismiss_pager_overlay();
        }
        Some(action)
    }

    pub(crate) fn handle_export_picker_event(
        &mut self,
        event: &Event,
    ) -> Option<ExportPickerEvent> {
        let picker = self.export_picker.as_mut()?;
        let outcome = match picker.handle_event(event) {
            ExportPickerAction::None => ExportPickerEvent::Consumed,
            ExportPickerAction::Cancel => ExportPickerEvent::Cancel,
            ExportPickerAction::Copy => ExportPickerEvent::Copy,
            ExportPickerAction::Save => ExportPickerEvent::Save(picker.selected_path()),
        };
        if !matches!(outcome, ExportPickerEvent::Consumed) {
            self.export_picker = None;
        }
        Some(outcome)
    }

    pub(crate) fn handle_resume_picker_event(
        &mut self,
        event: &Event,
    ) -> Option<ResumePickerEvent> {
        let picker = self.resume_picker.as_mut()?;
        if picker.transcript_pager_is_open() {
            return Some(ResumePickerEvent::Transcript(
                picker.handle_transcript_pager_event(event),
            ));
        }

        let action = picker.handle_event(event.clone());
        if action == PickerAction::Cancel {
            self.resume_picker = None;
        }
        Some(ResumePickerEvent::Picker(action))
    }

    pub(crate) fn handle_agents_overview_event(
        &mut self,
        event: &Event,
    ) -> Option<AgentsOverviewEvent> {
        let (action, selected_thread_id) = {
            let overview = self.agents_overview.as_mut()?;
            let action = overview.view.handle_event(event.clone());
            let selected_thread_id = matches!(action, AgentsOverviewAction::Select)
                .then(|| overview.view.selected_thread_id().map(str::to_owned))
                .flatten();
            (action, selected_thread_id)
        };
        if matches!(
            action,
            AgentsOverviewAction::Select | AgentsOverviewAction::Cancel
        ) {
            self.agents_overview = None;
            self.agent_picker = None;
        }
        Some(AgentsOverviewEvent {
            action,
            selected_thread_id,
        })
    }

    pub(crate) fn handle_model_picker_event(&mut self, event: &Event) -> Option<ModelPickerEvent> {
        let outcome = {
            let picker = self.model_picker.as_mut()?;
            match picker.handle_event(event.clone()) {
                ModelPickerAction::None => ModelPickerEvent::None,
                ModelPickerAction::Cancel => ModelPickerEvent::Cancel,
                ModelPickerAction::Select(index) => {
                    ModelPickerEvent::Select(picker.selected_model(index))
                }
            }
        };
        if !matches!(outcome, ModelPickerEvent::None) {
            self.model_picker = None;
        }
        Some(outcome)
    }

    pub(crate) fn open_confirm_prompt(
        &mut self,
        prompt: crate::app::confirm_prompt::ConfirmPrompt,
    ) {
        self.confirm_prompt = Some(prompt.with_keymap(self.runtime_keymap.list().clone()));
    }

    pub(crate) fn close_confirm_prompt(&mut self) {
        self.confirm_prompt = None;
    }

    pub(crate) fn open_config_menu(&mut self) {
        self.config_menu = Some(
            crate::app::config_menu::ConfigMenu::new()
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn config_menu_open(&self) -> bool {
        self.config_menu.is_some()
    }

    pub(crate) fn close_config_menu(&mut self) {
        self.config_menu = None;
    }

    pub(crate) fn handle_config_menu_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::config_menu::ConfigMenuAction> {
        let action = {
            let menu = self.config_menu.as_mut()?;
            menu.handle_event(event.clone())
        };
        if !matches!(action, crate::app::config_menu::ConfigMenuAction::None) {
            self.config_menu = None;
        }
        Some(action)
    }

    pub(crate) fn open_keymap_editor(&mut self, entries: Vec<crate::keymap::KeymapEntry>) {
        self.keymap_editor = Some(
            crate::app::keymap_editor::KeymapEditor::new(entries)
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn keymap_editor_open(&self) -> bool {
        self.keymap_editor.is_some()
    }

    pub(crate) fn close_keymap_editor(&mut self) {
        self.keymap_editor = None;
    }

    pub(crate) fn handle_keymap_editor_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::keymap_editor::KeymapEditorAction> {
        let action = {
            let editor = self.keymap_editor.as_mut()?;
            editor.handle_event(event.clone())
        };
        if !matches!(action, crate::app::keymap_editor::KeymapEditorAction::None) {
            self.keymap_editor = None;
        }
        Some(action)
    }

    pub(crate) fn open_process_list(&mut self, list: crate::app::process_list::ProcessList) {
        self.process_list = Some(list.with_keymap(self.runtime_keymap.list().clone()));
    }

    pub(crate) fn process_list_open(&self) -> bool {
        self.process_list.is_some()
    }

    pub(crate) fn close_process_list(&mut self) {
        self.process_list = None;
    }

    pub(crate) fn handle_process_list_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::process_list::ProcessListAction> {
        let action = {
            let list = self.process_list.as_mut()?;
            list.handle_event(event.clone())
        };
        if !matches!(action, crate::app::process_list::ProcessListAction::None) {
            self.process_list = None;
        }
        Some(action)
    }

    pub(crate) fn open_hooks_browser(
        &mut self,
        events: Vec<crate::app::hooks_browser::HookEventView>,
    ) {
        self.hooks_browser = Some(
            crate::app::hooks_browser::HooksBrowser::new(events)
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn hooks_browser_open(&self) -> bool {
        self.hooks_browser.is_some()
    }

    pub(crate) fn close_hooks_browser(&mut self) {
        self.hooks_browser = None;
    }

    pub(crate) fn handle_hooks_browser_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::hooks_browser::HooksBrowserAction> {
        let browser = self.hooks_browser.as_mut()?;
        Some(browser.handle_event(event.clone()))
    }

    pub(crate) fn open_memories_settings(&mut self, mode: Option<bool>) {
        self.memories_settings = Some(
            crate::app::memories_settings::MemoriesSettings::new(mode)
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn memories_settings_open(&self) -> bool {
        self.memories_settings.is_some()
    }

    pub(crate) fn close_memories_settings(&mut self) {
        self.memories_settings = None;
    }

    pub(crate) fn handle_memories_settings_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::memories_settings::MemoriesSettingsAction> {
        let action = {
            let settings = self.memories_settings.as_mut()?;
            settings.handle_event(event.clone())
        };
        if !matches!(
            action,
            crate::app::memories_settings::MemoriesSettingsAction::None
        ) {
            self.memories_settings = None;
        }
        Some(action)
    }

    pub(crate) fn open_skills_toggle(
        &mut self,
        entries: Vec<crate::app::skills_toggle::SkillToggleEntry>,
    ) {
        self.skills_toggle = Some(
            crate::app::skills_toggle::SkillsToggle::new(entries)
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn skills_toggle_open(&self) -> bool {
        self.skills_toggle.is_some()
    }

    pub(crate) fn close_skills_toggle(&mut self) {
        self.skills_toggle = None;
    }

    pub(crate) fn handle_skills_toggle_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::skills_toggle::SkillsToggleAction> {
        let action = {
            let toggle = self.skills_toggle.as_mut()?;
            toggle.handle_event(event.clone())
        };
        if !matches!(action, crate::app::skills_toggle::SkillsToggleAction::None) {
            self.skills_toggle = None;
        }
        Some(action)
    }

    pub(crate) fn open_plugin_picker(&mut self, picker: crate::app::plugin_picker::PluginPicker) {
        self.plugin_picker = Some(picker.with_keymap(self.runtime_keymap.list().clone()));
    }

    pub(crate) fn plugin_picker_open(&self) -> bool {
        self.plugin_picker.is_some()
    }

    pub(crate) fn close_plugin_picker(&mut self) {
        self.plugin_picker = None;
    }

    pub(crate) fn handle_plugin_picker_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::plugin_picker::PluginPickerAction> {
        let action = {
            let picker = self.plugin_picker.as_mut()?;
            picker.handle_event(event.clone())
        };
        if !matches!(action, crate::app::plugin_picker::PluginPickerAction::None) {
            self.plugin_picker = None;
        }
        Some(action)
    }

    pub(crate) fn open_permissions_picker(&mut self) {
        self.permissions_picker = Some(
            crate::app::permissions_picker::PermissionsPicker::new(
                self.permission_profiles.clone(),
                self.permissions.as_deref(),
            )
            .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn permissions_picker_open(&self) -> bool {
        self.permissions_picker.is_some()
    }

    pub(crate) fn handle_permissions_picker_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::permissions_picker::PermissionsPickerAction> {
        let action = {
            let picker = self.permissions_picker.as_mut()?;
            picker.handle_event(event.clone())
        };
        if !matches!(
            action,
            crate::app::permissions_picker::PermissionsPickerAction::None
        ) {
            self.permissions_picker = None;
        }
        Some(action)
    }

    pub(crate) fn open_effort_picker(&mut self) {
        self.effort_picker = Some(
            crate::app::effort_picker::EffortPicker::new(self.reasoning_effort.as_deref())
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn effort_picker_open(&self) -> bool {
        self.effort_picker.is_some()
    }

    pub(crate) fn handle_effort_picker_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::effort_picker::EffortPickerAction> {
        let action = {
            let picker = self.effort_picker.as_mut()?;
            picker.handle_event(event.clone())
        };
        if !matches!(action, crate::app::effort_picker::EffortPickerAction::None) {
            self.effort_picker = None;
        }
        Some(action)
    }

    pub(crate) fn open_review_picker(&mut self) {
        self.review_picker = Some(
            crate::app::review_picker::ReviewPicker::new()
                .with_keymap(self.runtime_keymap.list().clone()),
        );
    }

    pub(crate) fn review_picker_open(&self) -> bool {
        self.review_picker.is_some()
    }

    pub(crate) fn handle_review_picker_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::review_picker::ReviewPickerAction> {
        let action = {
            let picker = self.review_picker.as_mut()?;
            picker.handle_event(event.clone())
        };
        if !matches!(action, crate::app::review_picker::ReviewPickerAction::None) {
            self.review_picker = None;
        }
        Some(action)
    }

    pub(crate) fn confirm_prompt_open(&self) -> bool {
        self.confirm_prompt.is_some()
    }

    pub(crate) fn confirm_kind(&self) -> Option<crate::app::confirm_prompt::ConfirmKind> {
        self.confirm_prompt.as_ref().map(|prompt| prompt.kind())
    }

    pub(crate) fn handle_confirm_prompt_event(
        &mut self,
        event: &Event,
    ) -> Option<crate::app::confirm_prompt::ConfirmPromptAction> {
        let action = {
            let prompt = self.confirm_prompt.as_mut()?;
            prompt.handle_event(event.clone())
        };
        if !matches!(
            action,
            crate::app::confirm_prompt::ConfirmPromptAction::None
        ) {
            self.confirm_prompt = None;
        }
        Some(action)
    }

    pub(crate) fn handle_agent_picker_event(&mut self, event: &Event) -> Option<AgentPickerAction> {
        let action = {
            let picker = self.agent_picker.as_mut()?;
            picker.handle_event(event.clone())
        };
        if matches!(
            action,
            AgentPickerAction::Select(_) | AgentPickerAction::Cancel
        ) {
            self.agent_picker = None;
        }
        Some(action)
    }
}
