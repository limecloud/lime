//! Model and nested effort labels feed the shared borderless list presentation.

use super::*;
use crate::bottom_pane::list_selection_view::{self, ListSelectionView};
use crate::bottom_pane::selection_row_layout::SelectionRow;
use ratatui::style::Stylize;
use ratatui::text::Line;

fn model_rows(picker: &ModelPicker, locale: Locale) -> Vec<(String, Option<String>)> {
    let indices = picker.visible_indices();
    let names = indices
        .iter()
        .enumerate()
        .map(|(visible, index)| {
            let model = &picker.models[*index];
            let flag = if Some(*index) == picker.current {
                Some(locale.picker_current_label())
            } else if model.is_default {
                Some(locale.picker_default_label())
            } else {
                None
            };
            let suffix = flag.map(|flag| format!(" ({flag})")).unwrap_or_default();
            format!("{}. {}{suffix}", visible + 1, model.display_name)
        })
        .collect::<Vec<_>>();
    indices
        .into_iter()
        .zip(names)
        .map(|(index, name)| {
            let model = &picker.models[index];
            let description = if model.description.is_empty() {
                format!("[{}]", model.provider_id)
            } else {
                format!("[{}] {}", model.provider_id, model.description)
            };
            (name, Some(description))
        })
        .collect()
}

fn view(picker: &ModelPicker, locale: Locale) -> ListSelectionView<'_> {
    let entries = if let Some(menu) = &picker.effort_menu {
        menu.rows(picker, locale)
    } else {
        model_rows(picker, locale)
    };
    ListSelectionView {
        footer: None,
        title: picker
            .effort_menu
            .as_ref()
            .map(|menu| locale.reasoning_picker_title(menu.advanced))
            .unwrap_or_else(|| locale.model_picker_title()),
        subtitle: Line::from(
            picker
                .effort_menu
                .as_ref()
                .map(|menu| picker.models[menu.model_index].display_name.clone())
                .unwrap_or_else(|| locale.model_picker_search_hint().to_string()),
        )
        .dim(),
        query: picker.effort_menu.is_none().then(|| picker.query()),
        entries: entries
            .into_iter()
            .map(|(name, description)| SelectionRow::new(name, description, Vec::new()))
            .collect(),
        selected: picker.selected_row(),
        empty_text: locale.picker_empty(),
        keymap: &picker.list_keymap,
        locale,
    }
}

pub(crate) fn desired_height(picker: &ModelPicker, locale: Locale, width: u16) -> u16 {
    list_selection_view::desired_height(&view(picker, locale), width)
}

pub(super) fn render(frame: &mut Frame<'_>, area: Rect, picker: &ModelPicker, locale: Locale) {
    picker.page_rows.set(list_selection_view::render(
        frame,
        area,
        &view(picker, locale),
    ));
}

#[cfg(test)]
#[path = "render_tests.rs"]
mod tests;
