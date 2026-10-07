//! Terminal-title projection and setup, using the same canonical facts as the passive footer.

use super::{App, AppAction};
use crate::app_server_session::AppServerSession;
use crate::bottom_pane::multi_select_picker::MultiSelectAction;
use crate::bottom_pane::title_setup::{title_text_for_items, DEFAULT_TERMINAL_TITLE_ITEMS};
use app_server_protocol::protocol::v2::{ConfigEdit, MergeStrategy};
use crossterm::event::Event;
use serde_json::json;
use std::time::Instant;

const TERMINAL_TITLE_SPINNER_FRAMES: [&str; 10] =
    ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

impl App {
    pub(crate) fn terminal_title_text(&self, now: Instant) -> Option<String> {
        let items = self
            .chat_widget
            .terminal_title_setup
            .as_ref()
            .map(|picker| picker.selected_ids())
            .unwrap_or_else(|| {
                self.chat_widget
                    .tui_config
                    .terminal_title
                    .clone()
                    .unwrap_or_else(|| DEFAULT_TERMINAL_TITLE_ITEMS.map(str::to_string).to_vec())
            });
        let elapsed = self.active_turn_elapsed(now);
        let blocked = self.chat_widget.bottom_pane.is_active();
        let activity = if blocked {
            Some(
                if elapsed.is_some_and(|elapsed| elapsed.as_secs() % 2 == 1) {
                    "[ . ]"
                } else {
                    "[ ! ]"
                },
            )
        } else {
            elapsed.map(|elapsed| {
                let frame =
                    (elapsed.as_millis() / 100) % TERMINAL_TITLE_SPINNER_FRAMES.len() as u128;
                TERMINAL_TITLE_SPINNER_FRAMES[frame as usize]
            })
        };
        title_text_for_items(
            &items,
            &self.status_surface_data(),
            activity,
            blocked,
            self.chat_widget.locale,
        )
    }

    pub(super) fn handle_terminal_title_setup_event(&mut self, event: &Event) -> Option<AppAction> {
        let picker = self.chat_widget.terminal_title_setup.as_mut()?;
        let result = match picker.handle_event(event) {
            MultiSelectAction::None => return Some(AppAction::None),
            MultiSelectAction::Cancel => AppAction::None,
            MultiSelectAction::Confirm => AppAction::TerminalTitleSetup {
                items: picker.selected_ids(),
            },
        };
        self.chat_widget.terminal_title_setup = None;
        Some(result)
    }

    pub(super) async fn save_terminal_title(
        &mut self,
        session: &AppServerSession,
        items: Vec<String>,
    ) {
        let result = self
            .write_tui_preferences(
                session,
                vec![ConfigEdit {
                    key_path: "tui.terminal_title".to_string(),
                    value: json!(items),
                    merge_strategy: MergeStrategy::Replace,
                }],
            )
            .await;
        match result {
            Ok(version) => {
                self.chat_widget.tui_config.terminal_title = Some(items);
                self.chat_widget.config_version = Some(version);
                self.projection
                    .set_status(self.chat_widget.locale.terminal_title_saved());
            }
            Err(error) => self.projection.set_status(
                self.chat_widget
                    .locale
                    .terminal_title_save_failed(&format!("{error:#}")),
            ),
        }
    }
}

#[cfg(test)]
#[path = "terminal_title_tests.rs"]
mod tests;
