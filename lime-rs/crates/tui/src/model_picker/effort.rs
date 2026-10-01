//! Nested selection keeps model/provider identity in the catalog until explicit acceptance.

use super::*;
use crate::model_catalog::{is_advanced_reasoning, reasoning_anchor, reasoning_options};
use app_server_protocol::protocol::v2::ReasoningEffortOption;

#[derive(Debug)]
pub(super) struct EffortMenu {
    pub(super) model_index: usize,
    options: Vec<ReasoningEffortOption>,
    selected: usize,
    root_selected: usize,
    pub(super) advanced: bool,
}

impl EffortMenu {
    fn choices(&self) -> Vec<Option<usize>> {
        let mut choices = self
            .options
            .iter()
            .enumerate()
            .filter(|(_, option)| is_advanced_reasoning(&option.reasoning_effort) == self.advanced)
            .map(|(index, _)| Some(index))
            .collect::<Vec<_>>();
        if !self.advanced
            && self
                .options
                .iter()
                .any(|option| is_advanced_reasoning(&option.reasoning_effort))
        {
            choices.push(None);
        }
        choices
    }

    pub(super) fn value(&self, index: usize) -> Option<&ReasoningEffortOption> {
        self.choices()
            .get(index)
            .copied()
            .flatten()
            .and_then(|index| self.options.get(index))
    }

    fn highlight(&self, effort: Option<&str>) -> usize {
        self.choices()
            .iter()
            .position(|choice| match choice {
                Some(index) => effort == Some(self.options[*index].reasoning_effort.as_str()),
                None => effort.is_some_and(is_advanced_reasoning),
            })
            .unwrap_or(0)
    }

    pub(super) fn rows(
        &self,
        picker: &ModelPicker,
        locale: Locale,
    ) -> Vec<(String, Option<String>)> {
        let model = &picker.models[self.model_index];
        self.choices()
            .iter()
            .enumerate()
            .map(|(row, choice)| {
                let Some(index) = choice else {
                    let current = Some(self.model_index) == picker.current
                        && picker
                            .current_effort
                            .as_deref()
                            .is_some_and(is_advanced_reasoning);
                    let label = locale.more_reasoning_label();
                    let suffix = if current {
                        format!(" ({})", locale.picker_current_label())
                    } else {
                        String::new()
                    };
                    return (format!("{}. {label}{suffix}", row + 1), None);
                };
                let option = &self.options[*index];
                let current = Some(self.model_index) == picker.current
                    && picker.current_effort.as_deref() == Some(option.reasoning_effort.as_str());
                let mut flags = Vec::new();
                if option.reasoning_effort == model.default_reasoning_effort {
                    flags.push(locale.picker_default_label());
                }
                if current {
                    flags.push(locale.picker_current_label());
                }
                let suffix = if flags.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", flags.join(", "))
                };
                let label = locale.reasoning_effort_label(&option.reasoning_effort);
                (
                    format!("{}. {label}{suffix}", row + 1),
                    (!option.description.is_empty()).then(|| option.description.clone()),
                )
            })
            .collect()
    }
}

impl ModelPicker {
    pub(crate) fn with_current_effort(mut self, effort: Option<&str>) -> Self {
        self.current_effort = effort.map(str::to_owned);
        self
    }

    pub(super) fn selected_row(&self) -> usize {
        self.effort_menu
            .as_ref()
            .map_or(self.selected, |menu| menu.selected)
    }

    pub(super) fn set_selected_row(&mut self, selected: usize) {
        if let Some(menu) = self.effort_menu.as_mut() {
            menu.selected = selected;
        } else {
            self.selected = selected;
        }
    }

    pub(super) fn row_count(&self) -> usize {
        self.effort_menu
            .as_ref()
            .map_or_else(|| self.visible_indices().len(), |menu| menu.choices().len())
    }

    pub(super) fn accept(&mut self) -> ModelPickerAction {
        if let Some(menu) = self.effort_menu.as_mut() {
            if menu.choices().get(menu.selected) == Some(&None) {
                menu.root_selected = menu.selected;
                menu.advanced = true;
                let current = (Some(menu.model_index) == self.current)
                    .then_some(self.current_effort.as_deref())
                    .flatten();
                menu.selected = menu.highlight(current);
                return ModelPickerAction::None;
            }
        } else {
            let Some(model_index) = self.visible_indices().get(self.selected).copied() else {
                return ModelPickerAction::None;
            };
            let model = &self.models[model_index];
            let options = reasoning_options(model);
            if options.len() > 1
                || options
                    .iter()
                    .any(|option| is_advanced_reasoning(&option.reasoning_effort))
            {
                let mut menu = EffortMenu {
                    model_index,
                    options,
                    selected: 0,
                    root_selected: 0,
                    advanced: false,
                };
                let preferred = (Some(model_index) == self.current)
                    .then_some(self.current_effort.as_deref())
                    .flatten();
                let anchor =
                    reasoning_anchor(&menu.options, preferred, &model.default_reasoning_effort);
                menu.selected = menu
                    .highlight(anchor.map(|index| menu.options[index].reasoning_effort.as_str()));
                self.effort_menu = Some(menu);
                return ModelPickerAction::None;
            }
        }
        let selected = self.selected_row();
        self.selected_model(selected)
            .map_or(ModelPickerAction::None, |_| {
                ModelPickerAction::Select(selected)
            })
    }

    pub(super) fn back(&mut self) -> ModelPickerAction {
        if let Some(menu) = self.effort_menu.as_mut() {
            if menu.advanced {
                menu.advanced = false;
                menu.selected = menu.root_selected;
            } else {
                self.effort_menu = None;
            }
            ModelPickerAction::None
        } else {
            ModelPickerAction::Cancel
        }
    }
}
