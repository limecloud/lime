//! Codex-shaped title selection; preview and managed OSC consume the same real facts.

use super::multi_select_picker::{
    MultiSelectAction, MultiSelectItem, MultiSelectPicker, MultiSelectPickerView,
};
use super::status_line_setup::StatusLineItem;
use super::status_surface_preview::StatusSurfacePreviewData;
use crate::keymap::ListKeymap;
use crate::locale::Locale;
use crate::terminal_title::sanitize_terminal_title;
use crossterm::event::Event;
use lime_core::config::TuiConfig;
use ratatui::{layout::Rect, text::Line, Frame};
use std::path::Path;
use unicode_segmentation::UnicodeSegmentation;

pub(crate) const DEFAULT_TERMINAL_TITLE_ITEMS: [&str; 3] =
    ["activity", "thread-name", "project-name"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TerminalTitleItem {
    AppName,
    Project,
    CurrentDir,
    Spinner,
    Status,
    ThreadName,
    Thread,
    SessionId,
    Model,
    ModelWithReasoning,
    Reasoning,
    TaskProgress,
}

impl TerminalTitleItem {
    pub(crate) const ALL: [Self; 12] = [
        Self::AppName,
        Self::Project,
        Self::CurrentDir,
        Self::Spinner,
        Self::Status,
        Self::ThreadName,
        Self::Thread,
        Self::SessionId,
        Self::Model,
        Self::ModelWithReasoning,
        Self::Reasoning,
        Self::TaskProgress,
    ];
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::AppName => "app-name",
            Self::Project => "project-name",
            Self::CurrentDir => "current-dir",
            Self::Spinner => "activity",
            Self::Status => "run-state",
            Self::ThreadName => "thread-name",
            Self::Thread => "thread-title",
            Self::SessionId => "thread-id",
            Self::Model => "model",
            Self::ModelWithReasoning => "model-with-reasoning",
            Self::Reasoning => "reasoning",
            Self::TaskProgress => "task-progress",
        }
    }
    pub(crate) fn from_id(id: &str) -> Option<Self> {
        match id {
            "project" => Some(Self::Project),
            "spinner" => Some(Self::Spinner),
            "status" => Some(Self::Status),
            "thread" => Some(Self::Thread),
            "session-id" => Some(Self::SessionId),
            "model-name" => Some(Self::Model),
            _ => Self::ALL.into_iter().find(|item| item.id() == id),
        }
    }

    pub(crate) fn status_item(self) -> Option<StatusLineItem> {
        match self {
            Self::CurrentDir => Some(StatusLineItem::CurrentDir),
            Self::Status => Some(StatusLineItem::Status),
            Self::ThreadName => Some(StatusLineItem::ThreadName),
            Self::SessionId => Some(StatusLineItem::SessionId),
            Self::Model => Some(StatusLineItem::ModelName),
            Self::ModelWithReasoning => Some(StatusLineItem::ModelWithReasoning),
            Self::Reasoning => Some(StatusLineItem::Reasoning),
            Self::TaskProgress => Some(StatusLineItem::TaskProgress),
            _ => None,
        }
    }
    fn separator_from_previous(self, previous: Option<Self>) -> &'static str {
        match previous {
            None => "",
            Some(previous) if previous == Self::Spinner || self == Self::Spinner => " ",
            Some(_) => " | ",
        }
    }
}

/// Activity comes from the existing turn clock; None means idle, never a simulated preview.
pub(crate) fn title_text_for_items(
    ids: &[String],
    data: &StatusSurfacePreviewData,
    activity: Option<&str>,
    action_required: bool,
    locale: Locale,
) -> Option<String> {
    let mut items = Vec::new();
    for item in ids.iter().filter_map(|id| TerminalTitleItem::from_id(id)) {
        if !items.contains(&item) {
            items.push(item);
        }
    }
    let blocked = action_required && items.contains(&TerminalTitleItem::Spinner);
    let mut title = String::new();
    if blocked {
        title = format!(
            "{} {}",
            activity.unwrap_or("[ ! ]"),
            locale.action_required_label()
        );
    }
    let mut previous = None;
    for item in items {
        if blocked && matches!(item, TerminalTitleItem::Spinner | TerminalTitleItem::Status) {
            continue;
        }
        let value = match item {
            TerminalTitleItem::AppName => Some("lime".to_string()),
            TerminalTitleItem::Project => data.current_dir.as_deref().map(|cwd| {
                Path::new(cwd)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| cwd.to_string())
            }),
            TerminalTitleItem::Spinner => activity.map(str::to_string),
            TerminalTitleItem::Thread => data
                .value_for(StatusLineItem::ThreadName, locale)
                .filter(|name| !sanitize_terminal_title(name).is_empty())
                .or_else(|| data.value_for(StatusLineItem::SessionId, locale)),
            _ => item
                .status_item()
                .and_then(|item| data.value_for(item, locale)),
        };
        let Some(value) = value
            .map(|value| sanitize_terminal_title(&value))
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let limit = match item {
            TerminalTitleItem::Project => 24,
            TerminalTitleItem::Thread | TerminalTitleItem::ThreadName => 48,
            _ => 32,
        };
        let value = truncate_title_part(value, limit);
        title.push_str(if blocked {
            " "
        } else {
            item.separator_from_previous(previous)
        });
        title.push_str(&value);
        previous = Some(item);
    }
    (!title.is_empty()).then_some(sanitize_terminal_title(&title))
}

fn truncate_title_part(value: String, max_chars: usize) -> String {
    let mut graphemes = value.graphemes(true);
    let head: String = graphemes.by_ref().take(max_chars).collect();
    if graphemes.next().is_none() {
        return head;
    }
    let mut head = head.graphemes(true).take(max_chars - 3).collect::<String>();
    head.push_str("...");
    head
}

#[derive(Debug)]
pub(crate) struct TerminalTitleSetupView {
    picker: MultiSelectPicker,
}

impl TerminalTitleSetupView {
    pub(crate) fn new(config: &TuiConfig, keymap: ListKeymap, locale: Locale) -> Self {
        let enabled = config
            .terminal_title
            .clone()
            .unwrap_or_else(|| DEFAULT_TERMINAL_TITLE_ITEMS.map(str::to_string).to_vec());
        let mut order = Vec::new();
        for item in enabled
            .iter()
            .filter_map(|id| TerminalTitleItem::from_id(id))
            .chain(TerminalTitleItem::ALL)
        {
            if !order.contains(&item) {
                order.push(item);
            }
        }
        let items = order
            .into_iter()
            .map(|item| MultiSelectItem {
                id: item.id().to_string(),
                name: locale.terminal_title_item_name(item).to_string(),
                description: locale.terminal_title_item_description(item).to_string(),
                enabled: enabled
                    .iter()
                    .any(|id| TerminalTitleItem::from_id(id) == Some(item)),
                orderable: true,
            })
            .collect();
        Self {
            picker: MultiSelectPicker::new(items, keymap),
        }
    }
    pub(crate) fn selected_ids(&self) -> Vec<String> {
        self.picker.selected_ids()
    }
    pub(crate) fn handle_event(&mut self, event: &Event) -> MultiSelectAction {
        self.picker.handle_event(event)
    }
    fn presentation(locale: Locale) -> MultiSelectPickerView {
        MultiSelectPickerView {
            title: locale.terminal_title_setup_title(),
            subtitle: locale.terminal_title_search_hint(),
            locale,
        }
    }
    pub(crate) fn desired_height(&self, locale: Locale, width: u16) -> u16 {
        self.picker
            .desired_height(&Self::presentation(locale), width)
    }
    pub(crate) fn render(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        locale: Locale,
        preview: Option<String>,
    ) {
        self.picker.render(
            frame,
            area,
            &Self::presentation(locale),
            Line::from(preview.unwrap_or_default()),
        );
    }
}

#[cfg(test)]
#[path = "title_setup_tests.rs"]
mod tests;
