//! Codex-shaped status-line selection. Preview and the passive footer share real facts.

use super::multi_select_picker::{
    MultiSelectAction, MultiSelectItem, MultiSelectPicker, MultiSelectPickerView,
};
use super::status_surface_preview::StatusSurfacePreviewData;
use crate::keymap::ListKeymap;
use crate::locale::Locale;
use crossterm::event::Event;
use lime_core::config::TuiConfig;
use ratatui::{layout::Rect, Frame};

#[cfg(test)]
#[path = "status_line_setup_tests.rs"]
mod tests;

pub(crate) const DEFAULT_STATUS_LINE_ITEMS: [&str; 3] =
    ["model-with-reasoning", "current-dir", "thread-name"];
const COLORS_ID: &str = "use-theme-colors";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StatusLineItem {
    ModelName,
    ModelWithReasoning,
    Reasoning,
    CurrentDir,
    Status,
    Permissions,
    SessionId,
    ThreadName,
    RawOutput,
    TaskProgress,
    UsedTokens,
    TotalInputTokens,
    TotalOutputTokens,
    ContextWindowSize,
    ContextRemaining,
    ContextUsed,
}

impl StatusLineItem {
    pub(crate) const ALL: [Self; 16] = [
        Self::ModelName,
        Self::ModelWithReasoning,
        Self::Reasoning,
        Self::CurrentDir,
        Self::Status,
        Self::Permissions,
        Self::SessionId,
        Self::ThreadName,
        Self::RawOutput,
        Self::TaskProgress,
        Self::UsedTokens,
        Self::TotalInputTokens,
        Self::TotalOutputTokens,
        Self::ContextWindowSize,
        Self::ContextRemaining,
        Self::ContextUsed,
    ];
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::ModelName => "model",
            Self::ModelWithReasoning => "model-with-reasoning",
            Self::Reasoning => "reasoning",
            Self::CurrentDir => "current-dir",
            Self::Status => "run-state",
            Self::Permissions => "permissions",
            Self::SessionId => "thread-id",
            Self::ThreadName => "thread-name",
            Self::RawOutput => "raw-output",
            Self::TaskProgress => "task-progress",
            Self::UsedTokens => "used-tokens",
            Self::TotalInputTokens => "total-input-tokens",
            Self::TotalOutputTokens => "total-output-tokens",
            Self::ContextWindowSize => "context-window-size",
            Self::ContextRemaining => "context-remaining",
            Self::ContextUsed => "context-used",
        }
    }
    pub(crate) fn from_id(id: &str) -> Option<Self> {
        match id {
            "model-name" => return Some(Self::ModelName),
            "status" => return Some(Self::Status),
            "session-id" => return Some(Self::SessionId),
            "context-usage" => return Some(Self::ContextUsed),
            _ => {}
        }
        Self::ALL.into_iter().find(|item| item.id() == id)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StatusLineSetupAction {
    None,
    Cancel,
    Confirm {
        items: Vec<String>,
        use_colors: bool,
    },
}

#[derive(Debug)]
pub(crate) struct StatusLineSetupView {
    picker: MultiSelectPicker,
}

impl StatusLineSetupView {
    pub(crate) fn new(config: &TuiConfig, keymap: ListKeymap, locale: Locale) -> Self {
        let enabled = config
            .status_line
            .clone()
            .unwrap_or_else(|| DEFAULT_STATUS_LINE_ITEMS.map(str::to_string).to_vec());
        let mut order = Vec::new();
        for item in enabled.iter().filter_map(|id| StatusLineItem::from_id(id)) {
            if !order.contains(&item) {
                order.push(item);
            }
        }
        for item in StatusLineItem::ALL {
            if !order.contains(&item) {
                order.push(item);
            }
        }
        let mut items = order
            .into_iter()
            .map(|item| MultiSelectItem {
                id: item.id().to_string(),
                name: locale.status_line_item_name(item).to_string(),
                description: locale.status_line_item_description(item).to_string(),
                enabled: enabled
                    .iter()
                    .any(|id| StatusLineItem::from_id(id) == Some(item)),
                orderable: true,
            })
            .collect::<Vec<_>>();
        items.push(MultiSelectItem {
            id: COLORS_ID.to_string(),
            name: locale.status_line_colors_label().to_string(),
            description: String::new(),
            enabled: config.status_line_use_colors,
            orderable: false,
        });
        Self {
            picker: MultiSelectPicker::new(items, keymap),
        }
    }

    fn selection(&self) -> (Vec<String>, bool) {
        let mut ids = self.picker.selected_ids();
        let colors = ids.iter().any(|id| id == COLORS_ID);
        ids.retain(|id| id != COLORS_ID);
        (ids, colors)
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> StatusLineSetupAction {
        match self.picker.handle_event(event) {
            MultiSelectAction::None => StatusLineSetupAction::None,
            MultiSelectAction::Cancel => StatusLineSetupAction::Cancel,
            MultiSelectAction::Confirm => {
                let (items, use_colors) = self.selection();
                StatusLineSetupAction::Confirm { items, use_colors }
            }
        }
    }

    fn presentation(locale: Locale) -> MultiSelectPickerView {
        MultiSelectPickerView {
            title: locale.status_line_title(),
            subtitle: locale.status_line_search_hint(),
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
        data: &StatusSurfacePreviewData,
    ) {
        let (items, colors) = self.selection();
        self.picker.render(
            frame,
            area,
            &Self::presentation(locale),
            data.line(&items, colors, locale).unwrap_or_default(),
        );
    }
}
