//! Chat surface interaction helpers owned by `ChatWidget`.
//!
//! The terminal host still decides which `AppAction` to dispatch, but mutable presentation
//! state and pager construction stay with the chat surface. This keeps interaction routing from
//! becoming a second transcript owner in `App`.

use std::path::PathBuf;

use crossterm::event::{Event, KeyEvent, MouseEvent};

use super::ChatWidget;
use crate::app::agent_picker::AgentPicker;
use crate::app::agent_picker::AgentPickerAction;
use crate::app::agents_overview::AgentsOverviewState;
use crate::app::agents_overview_view::AgentsOverviewAction;
use crate::app::transcript_export::ExportPickerAction;
use crate::keymap::{GlobalKeymapAction, KeymapMatch};
use crate::model_picker::{ModelPickerAction, ModelSelection};
use crate::pager_overlay::{PagerAction, PagerOverlay};
use crate::resume_picker::PickerAction;
use crate::resume_picker::PickerState;
use crate::transcript_view::{SearchAction, TranscriptFollowAction, TranscriptSelectionAction};

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

    pub(crate) fn begin_transcript_search(&mut self) {
        self.transcript_search
            .begin(self.transcript_scroll, /*restore_on_close*/ true);
        self.transcript_follow_control.clear();
    }

    pub(crate) fn end_interaction_drag(&mut self) {
        self.transcript_selection.end_drag();
        if let Some(pager) = self.pager_overlay.as_ref() {
            pager.end_transcript_drag();
        }
        if let Some(picker) = self.resume_picker.as_ref() {
            picker.end_transcript_drag();
        }
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

    pub(crate) fn route_modal_transcript_wheel(
        &mut self,
        event: &Event,
    ) -> Option<TranscriptSelectionAction> {
        let Event::Mouse(mouse) = event else {
            return None;
        };
        if !matches!(
            mouse.kind,
            crossterm::event::MouseEventKind::ScrollUp
                | crossterm::event::MouseEventKind::ScrollDown
        ) {
            return None;
        }

        match self.transcript_selection.handle_event(event) {
            Some(TranscriptSelectionAction::Scroll { rows }) => {
                if self.transcript_selection.is_active() {
                    self.transcript_selection.scroll_rows(rows);
                    Some(TranscriptSelectionAction::Consumed)
                } else {
                    Some(TranscriptSelectionAction::Scroll { rows })
                }
            }
            Some(action) => Some(action),
            None => None,
        }
    }

    pub(crate) fn handle_main_transcript_selection(
        &mut self,
        event: &Event,
    ) -> Option<TranscriptSelectionAction> {
        let had_selection = self.transcript_selection.is_active();
        let action = self.transcript_selection.handle_event(event)?;
        if had_selection && !self.transcript_selection.is_active() {
            self.finish_transcript_selection(false);
        }
        Some(action)
    }

    pub(crate) fn finish_main_transcript_selection_if_active(&mut self) {
        if self.transcript_selection.is_active() {
            self.finish_transcript_selection(false);
        }
    }

    pub(crate) fn scroll_main_selection(&mut self, rows: isize) -> bool {
        if !self.transcript_selection.is_active() {
            return false;
        }
        self.transcript_selection.scroll_rows(rows);
        true
    }

    pub(crate) fn reveal_main_selection_row(&mut self, row: usize) {
        self.transcript_selection.reveal_row(row);
    }

    pub(crate) fn handle_pager_event(&mut self, event: &Event) -> Option<PagerAction> {
        let pager = self.pager_overlay.as_mut()?;
        let action = pager.handle_event(event);
        if action == PagerAction::Close {
            self.dismiss_pager_overlay();
        }
        Some(action)
    }

    pub(crate) fn handle_transcript_search_event(&mut self, event: &Event) -> Option<SearchAction> {
        if !self.transcript_search.is_active() {
            return None;
        }
        let action = self
            .transcript_search
            .handle_event(event, self.scrollback_has_older_history);
        if let SearchAction::Closed {
            restore_scroll: Some(scroll),
        } = action
        {
            self.transcript_scroll = scroll;
        }
        Some(action)
    }

    pub(crate) fn handle_transcript_follow_mouse(
        &mut self,
        mouse: MouseEvent,
    ) -> Option<TranscriptFollowAction> {
        let action = self.transcript_follow_control.handle_mouse(mouse)?;
        if action == TranscriptFollowAction::ReturnToLatest {
            self.scroll_bottom();
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
