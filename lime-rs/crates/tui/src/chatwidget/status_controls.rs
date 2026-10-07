//! Client presentation preferences; persistence belongs to the shared App Server config owner.

use super::ChatWidget;
use crate::bottom_pane::status_line_setup::{StatusLineSetupView, DEFAULT_STATUS_LINE_ITEMS};
use crate::bottom_pane::title_setup::TerminalTitleSetupView;

impl ChatWidget {
    pub(crate) fn set_status_thread_name(&mut self, thread_id: String, name: Option<String>) {
        if let Some(name) = name {
            self.thread_names.insert(thread_id, name);
        } else {
            self.thread_names.remove(&thread_id);
        }
    }
    pub(crate) fn show_status_line_setup(&mut self) {
        self.terminal_title_setup = None;
        self.status_line_setup = Some(StatusLineSetupView::new(
            &self.tui_config,
            self.runtime_keymap.list().clone(),
            self.locale,
        ));
    }

    pub(crate) fn show_terminal_title_setup(&mut self) {
        self.status_line_setup = None;
        self.terminal_title_setup = Some(TerminalTitleSetupView::new(
            &self.tui_config,
            self.runtime_keymap.list().clone(),
            self.locale,
        ));
    }

    pub(crate) fn status_line_items(&self) -> Vec<String> {
        self.tui_config
            .status_line
            .clone()
            .unwrap_or_else(|| DEFAULT_STATUS_LINE_ITEMS.map(str::to_string).to_vec())
    }

    pub(crate) fn setup_status_line(
        &mut self,
        items: Vec<String>,
        use_colors: bool,
        version: String,
    ) {
        self.tui_config.status_line = Some(items);
        self.tui_config.status_line_use_colors = use_colors;
        self.config_version = Some(version);
    }
}
