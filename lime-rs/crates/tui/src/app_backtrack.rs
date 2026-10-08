//! Codex-shaped previous-prompt browsing. Canonical history and mutation remain in App Server.

mod io;
pub(crate) use io::BacktrackPage;
#[cfg(test)]
mod stdio_tests;
#[cfg(test)]
mod tests;

use std::collections::HashSet;

use app_server_protocol::protocol::v2::{ThreadRevertResponse, UserInput};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use tokio::task::JoinHandle;

use crate::app::{App, AppAction};
use crate::app_event::BacktrackEvent;
use crate::app_event_sender::AppEventSender;
use crate::app_server_session::AppServerSession;
use crate::bottom_pane::BottomPane;
use crate::keymap::{GlobalKeymapAction, KeymapMatch};
use crate::transcript_view::TranscriptBookmark;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BacktrackSelection {
    pub(crate) thread_id: String,
    pub(crate) turn_id: String,
    pub(crate) item_id: String,
    pub(crate) prompt: Vec<UserInput>,
}

#[derive(Debug)]
struct BrowsingOrigin {
    pager_bookmark: Option<TranscriptBookmark>,
    main_scroll: usize,
}

#[derive(Debug, Default)]
pub(crate) struct BacktrackState {
    pub(crate) primed: bool,
    pub(crate) base_id: Option<String>,
    pub(crate) overlay_preview_active: bool,
    choices: Vec<BacktrackSelection>,
    nth_user_message: usize,
    cursor: Option<String>,
    seen_cursors: HashSet<String>,
    loading: bool,
    load_needed: bool,
    select_next_page: bool,
    failed: bool,
    origin: Option<BrowsingOrigin>,
    generation: u64,
    load_task: Option<JoinHandle<()>>,
    pending_revert: Option<BacktrackSelection>,
    revert_sent: bool,
}

impl Drop for BacktrackState {
    fn drop(&mut self) {
        if let Some(task) = self.load_task.take() {
            task.abort();
        }
    }
}

impl App {
    pub(crate) fn reset_backtrack_state(&mut self) {
        let generation = self.backtrack.generation.wrapping_add(1);
        self.backtrack = BacktrackState::default();
        self.backtrack.generation = generation;
        self.chat_widget.bottom_pane.show_esc_backtrack_hint(false);
        if let Some(pager) = self.chat_widget.pager_overlay.as_mut() {
            pager.clear_browsing();
        }
    }

    pub(crate) fn backtrack_revert_pending(&self) -> bool {
        self.backtrack.pending_revert.is_some()
    }

    pub(crate) fn handle_backtrack_main_key(&mut self, key: KeyEvent) -> Option<AppAction> {
        if self.backtrack_revert_pending() {
            if key.kind == KeyEventKind::Press
                && key.modifiers == KeyModifiers::CONTROL
                && key.code == KeyCode::Char('c')
            {
                return Some(AppAction::Quit);
            }
            return Some(AppAction::None);
        }
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if key.code == KeyCode::Esc && key.modifiers.is_empty() && self.retry_history_replacement()
        {
            return Some(AppAction::None);
        }
        let pane = &self.chat_widget.bottom_pane;
        let eligible = key.code == KeyCode::Esc
            && key.modifiers.is_empty()
            && self.thread_id.is_some()
            && self.projection.active_turn_id().is_none()
            && !self.history_replacement.is_pending()
            && (self.chat_widget.scrollback_has_older_history()
                || self
                    .projection
                    .entries()
                    .iter()
                    .any(|entry| entry.kind == crate::projection::EntryKind::User))
            && self.chat_widget.transcript_scroll == 0
            && pane.can_backtrack();
        if !eligible {
            if self.backtrack.primed {
                self.reset_backtrack_state();
            }
            return None;
        }
        if !self.can_accept_direct_input() {
            return Some(AppAction::None);
        }
        if self.thread_history_mode
            != app_server_protocol::protocol::v2::ThreadHistoryMode::Paginated
        {
            self.projection
                .set_status(self.chat_widget.locale.backtrack_unavailable());
            return Some(AppAction::None);
        }
        if self.backtrack.primed && self.backtrack.base_id == self.thread_id {
            self.open_backtrack_preview();
        } else {
            self.backtrack.primed = true;
            self.backtrack.base_id = self.thread_id.clone();
            self.backtrack.origin = Some(BrowsingOrigin {
                pager_bookmark: None,
                main_scroll: self.chat_widget.transcript_scroll,
            });
            self.chat_widget.bottom_pane.show_esc_backtrack_hint(true);
        }
        Some(AppAction::None)
    }

    fn open_backtrack_preview(&mut self) {
        if self.chat_widget.pager_overlay.is_none() {
            self.chat_widget.open_transcript_pager();
        }
        self.backtrack.overlay_preview_active = true;
        self.backtrack.load_needed = true;
        self.chat_widget.bottom_pane.show_esc_backtrack_hint(false);
        self.sync_backtrack_presentation();
    }

    pub(crate) fn handle_backtrack_overlay_event(&mut self, event: &Event) -> Option<AppAction> {
        let pager = self.chat_widget.pager_overlay.as_ref()?;
        if !pager.is_transcript() || pager.has_active_interaction() {
            return None;
        }
        let Event::Key(key) = event else {
            return None;
        };
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if !self.backtrack.overlay_preview_active {
            if key.code != KeyCode::Esc
                || !key.modifiers.is_empty()
                || self.thread_id.is_none()
                || !self.chat_widget.bottom_pane.can_backtrack()
                || self.projection.active_turn_id().is_some()
                || !self.can_accept_direct_input()
            {
                return None;
            }
            self.reset_backtrack_state();
            self.backtrack.base_id = self.thread_id.clone();
            if self.thread_history_mode
                != app_server_protocol::protocol::v2::ThreadHistoryMode::Paginated
            {
                self.projection
                    .set_status(self.chat_widget.locale.backtrack_unavailable());
                return Some(AppAction::None);
            }
            self.backtrack.origin = Some(BrowsingOrigin {
                pager_bookmark: self
                    .chat_widget
                    .pager_overlay
                    .as_ref()
                    .map(|pager| pager.bookmark()),
                main_scroll: self.chat_widget.transcript_scroll,
            });
            self.open_backtrack_preview();
            return Some(AppAction::None);
        }
        if key.code == KeyCode::Esc && key.modifiers.is_empty() {
            self.cancel_backtrack();
            return Some(AppAction::None);
        }
        match self.chat_widget.dispatch_global_key(*key) {
            KeymapMatch::Completed(GlobalKeymapAction::OpenTranscript) => {
                if let Some(pager) = self.chat_widget.pager_overlay.as_mut() {
                    pager.toggle_browsing_details();
                }
                return Some(AppAction::None);
            }
            KeymapMatch::Pending | KeymapMatch::Cancelled => return Some(AppAction::None),
            _ => {}
        }
        if !key.modifiers.is_empty() {
            return None;
        }
        match key.code {
            KeyCode::Left | KeyCode::Char('h') => {
                if !self.backtrack.loading {
                    if self.backtrack.nth_user_message + 1 < self.backtrack.choices.len() {
                        self.backtrack.nth_user_message += 1;
                    } else if self.backtrack.cursor.is_some() || self.backtrack.failed {
                        self.backtrack.load_needed = true;
                        self.backtrack.select_next_page = true;
                    }
                }
            }
            KeyCode::Right | KeyCode::Char('l') => {
                self.backtrack.nth_user_message = self.backtrack.nth_user_message.saturating_sub(1);
                self.backtrack.select_next_page = false;
            }
            KeyCode::Enter if !self.backtrack.loading => {
                if let Some(selection) = self
                    .backtrack
                    .choices
                    .get(self.backtrack.nth_user_message)
                    .cloned()
                {
                    if self.thread_id.as_deref() == Some(&selection.thread_id)
                        && self.projection.active_turn_id().is_none()
                        && self.chat_widget.bottom_pane.composer_is_empty()
                    {
                        self.backtrack.pending_revert = Some(selection);
                        self.chat_widget.dismiss_pager_overlay();
                        self.projection
                            .set_status(self.chat_widget.locale.backtrack_reverting());
                    }
                }
            }
            _ => return None,
        }
        self.sync_backtrack_presentation();
        Some(AppAction::None)
    }

    fn cancel_backtrack(&mut self) {
        let origin = self.backtrack.origin.take();
        self.reset_backtrack_state();
        if let Some(origin) = origin {
            self.chat_widget.transcript_scroll = origin.main_scroll;
            if let Some(bookmark) = origin.pager_bookmark {
                if let Some(pager) = self.chat_widget.pager_overlay.as_ref() {
                    pager.restore_bookmark(bookmark);
                }
            } else {
                self.chat_widget.dismiss_pager_overlay();
            }
        }
    }

    fn sync_backtrack_presentation(&mut self) {
        if !self.backtrack.overlay_preview_active {
            return;
        }
        let locale = self.chat_widget.locale;
        let footers = if self.backtrack.loading || self.backtrack.load_needed {
            vec![locale.backtrack_loading().to_string(), "esc".to_string()]
        } else if self.backtrack.failed {
            vec![
                locale.backtrack_retry_footer().to_string(),
                "← · esc".to_string(),
            ]
        } else {
            locale.backtrack_footers(
                self.chat_widget
                    .runtime_keymap
                    .transcript()
                    .open_transcript_hint()
                    .as_deref(),
            )
        };
        let id = self
            .backtrack
            .choices
            .get(self.backtrack.nth_user_message)
            .map(|choice| choice.item_id.clone());
        if let Some(pager) = self.chat_widget.pager_overlay.as_mut() {
            pager.set_browsing_prompt(id, footers);
        }
    }

    pub(crate) fn poll_backtrack_io(
        &mut self,
        session: &mut AppServerSession,
        tx: &AppEventSender,
    ) {
        if self.backtrack.load_needed && !self.backtrack.loading {
            if let Some(thread_id) = self
                .backtrack
                .base_id
                .clone()
                .filter(|id| self.thread_id.as_ref() == Some(id))
            {
                self.backtrack.load_needed = false;
                self.backtrack.loading = true;
                self.backtrack.failed = false;
                self.backtrack.load_task = Some(io::spawn_history_load(
                    session.request_handle(),
                    tx.clone(),
                    thread_id,
                    self.backtrack.generation,
                    self.backtrack.cursor.clone(),
                ));
            }
        }
        if let Some(selection) = self
            .backtrack
            .pending_revert
            .clone()
            .filter(|_| !self.backtrack.revert_sent)
        {
            self.backtrack.revert_sent = true;
            io::spawn_revert(
                session.request_handle(),
                tx.clone(),
                self.backtrack.generation,
                selection,
            );
        }
        self.poll_history_replacement(session, tx);
    }

    pub(crate) fn handle_backtrack_event(&mut self, event: BacktrackEvent) {
        match event {
            BacktrackEvent::HistoryLoaded {
                thread_id,
                generation,
                cursor,
                result,
            } => {
                if self.thread_id.as_deref() != Some(&thread_id)
                    || generation != self.backtrack.generation
                    || !self.backtrack.loading
                    || self.backtrack.cursor != cursor
                {
                    return;
                }
                self.backtrack.loading = false;
                self.backtrack.load_task = None;
                match result {
                    Ok(page) => self.apply_backtrack_page(&thread_id, page),
                    Err(error) => {
                        self.backtrack.failed = true;
                        self.projection
                            .set_status(self.chat_widget.locale.backtrack_failed(&error));
                    }
                }
                self.sync_backtrack_presentation();
            }
            BacktrackEvent::Reverted {
                thread_id,
                generation,
                result,
            } => {
                if generation != self.backtrack.generation
                    || self.thread_id.as_deref() != Some(&thread_id)
                {
                    return;
                }
                let Some(selection) = self.backtrack.pending_revert.take() else {
                    return;
                };
                self.complete_backtrack_revert(selection, result.map(|response| *response));
            }
        }
    }

    fn apply_backtrack_page(&mut self, thread_id: &str, page: io::BacktrackPage) {
        if page.page.next_cursor.as_ref().is_some_and(|next| {
            self.backtrack.cursor.as_ref() == Some(next)
                || self.backtrack.seen_cursors.contains(next)
        }) {
            self.backtrack.failed = true;
            self.projection.set_status(
                self.chat_widget
                    .locale
                    .backtrack_failed(self.chat_widget.locale.backtrack_cursor_failed()),
            );
            return;
        }
        let previous_count = self.backtrack.choices.len();
        let hidden = crate::history_filter::hidden_user_message_ids(&page.context);
        for turn in &page.page.data {
            // A steer cannot be reverted independently: thread/revert removes the whole Turn.
            // Full items are required to prove this is its first user message.
            if turn.items_view != app_server_protocol::protocol::v2::TurnItemsView::Full
                || turn.status == app_server_protocol::protocol::v2::TurnStatus::InProgress
            {
                continue;
            }
            for item in &turn.items {
                if let app_server_protocol::protocol::v2::ThreadItem::UserMessage {
                    id,
                    content,
                    ..
                } = item
                {
                    if !hidden.contains(id)
                        && BottomPane::can_restore_user_inputs(content)
                        && !self
                            .backtrack
                            .choices
                            .iter()
                            .any(|choice| &choice.item_id == id)
                    {
                        self.backtrack.choices.push(BacktrackSelection {
                            thread_id: thread_id.to_string(),
                            turn_id: turn.id.clone(),
                            item_id: id.clone(),
                            prompt: content.clone(),
                        });
                    }
                    break;
                }
            }
        }
        self.prepend_initial_history_page(crate::app_server_session::InitialHistoryPage {
            items: page
                .page
                .data
                .iter()
                .rev()
                .flat_map(|turn| turn.items.iter().cloned())
                .collect(),
            turns: page.context,
        });
        self.backtrack.cursor = page
            .page
            .next_cursor
            .filter(|cursor| self.backtrack.seen_cursors.insert(cursor.clone()));
        if self.backtrack.select_next_page
            && previous_count > 0
            && self.backtrack.choices.len() > previous_count
        {
            self.backtrack.nth_user_message = previous_count;
        }
        self.backtrack.select_next_page = false;
        if self.backtrack.choices.is_empty() {
            if self.backtrack.cursor.is_some() {
                self.backtrack.load_needed = true;
            } else {
                self.cancel_backtrack();
                self.projection
                    .set_status(self.chat_widget.locale.backtrack_empty());
            }
        }
    }

    fn complete_backtrack_revert(
        &mut self,
        selection: BacktrackSelection,
        result: Result<ThreadRevertResponse, String>,
    ) {
        match result {
            Ok(response) if response.thread.id == selection.thread_id => {
                self.reset_backtrack_state();
                self.chat_widget
                    .bottom_pane
                    .restore_user_inputs(&selection.prompt);
                if !self.history_replacement.is_pending() {
                    self.request_history_replacement();
                }
            }
            result => {
                self.reset_backtrack_state();
                self.chat_widget
                    .bottom_pane
                    .restore_user_inputs(&selection.prompt);
                let error = result.err().unwrap_or_else(|| {
                    self.chat_widget
                        .locale
                        .backtrack_identity_failed()
                        .to_string()
                });
                self.projection
                    .set_status(self.chat_widget.locale.backtrack_failed(&error));
            }
        }
    }
}
