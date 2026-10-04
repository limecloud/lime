//! Codex-shaped Agents Overview state and canonical thread projection.

use super::agents_overview_view::{AgentsOverviewGroup, AgentsOverviewRow, AgentsOverviewView};
use crate::app_server_session::AppServerSession;
use crate::keymap::{AgentsKeymap, ListKeymap};
use anyhow::{anyhow, Result};
use app_server_protocol::protocol::v2::ServerNotification;
use app_server_protocol::protocol::v2::{Thread, TurnStatus, UserInput};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

#[derive(Debug, Default)]
pub(crate) struct AgentsOverviewState {
    pub(crate) threads: Vec<Thread>,
    /// A refresh requested while another refresh is in flight is coalesced.
    pub(crate) refresh_pending: bool,
    /// Notifications received during a refresh, keyed by thread and replayed afterward.
    pub(crate) refresh_notifications: HashMap<String, Vec<ServerNotification>>,
    /// The sole live interaction state; derived rows are never mirrored into another view.
    pub(crate) view: AgentsOverviewView,
    pub(crate) refreshing: bool,
    pub(crate) refresh_generation: u64,
    pub(crate) next_cursor: Option<String>,
    pub(crate) seen_cursors: HashSet<String>,
    pub(crate) loading_more: bool,
    pub(crate) load_more_failed: bool,
}

impl AgentsOverviewState {
    #[cfg(test)]
    pub(crate) fn new(primary_thread_id: Option<&str>) -> Self {
        Self::new_with_keymap(
            primary_thread_id,
            AgentsKeymap::default(),
            ListKeymap::default(),
        )
    }

    pub(crate) fn new_with_keymap(
        primary_thread_id: Option<&str>,
        keymap: AgentsKeymap,
        list_keymap: ListKeymap,
    ) -> Self {
        let view =
            AgentsOverviewView::new_with_keymap(Vec::new(), primary_thread_id, keymap, list_keymap);
        Self {
            threads: Vec::new(),
            refresh_pending: false,
            refresh_notifications: HashMap::new(),
            view,
            refreshing: false,
            refresh_generation: 0,
            next_cursor: None,
            seen_cursors: HashSet::new(),
            loading_more: false,
            load_more_failed: false,
        }
    }

    pub(crate) fn begin_refresh(&mut self) -> u64 {
        if self.refreshing {
            self.refresh_pending = true;
            return self.refresh_generation;
        }
        self.refresh_generation = self.refresh_generation.wrapping_add(1);
        self.refreshing = true;
        self.next_cursor = None;
        self.seen_cursors.clear();
        self.loading_more = false;
        self.load_more_failed = false;
        self.refresh_generation
    }

    pub(crate) fn begin_load_more(&mut self) -> Option<String> {
        if self.refreshing || self.loading_more {
            return None;
        }
        let cursor = self.next_cursor.clone()?;
        self.seen_cursors.insert(cursor.clone());
        self.loading_more = true;
        self.load_more_failed = false;
        self.sync_pagination();
        Some(cursor)
    }

    #[allow(dead_code)]
    pub(crate) fn replace_threads(
        &mut self,
        threads: Vec<Thread>,
        primary_thread_id: Option<&str>,
    ) {
        self.replace_threads_page(threads, primary_thread_id, None);
    }

    pub(crate) fn replace_threads_page(
        &mut self,
        threads: Vec<Thread>,
        primary_thread_id: Option<&str>,
        next_cursor: Option<String>,
    ) {
        // App Server's recent index is a seed, not an eviction list. Keep locally observed
        // sessions until an explicit archive/delete notification removes them.
        let mut by_id = self
            .threads
            .drain(..)
            .map(|thread| (thread.id.clone(), thread))
            .collect::<HashMap<_, _>>();
        for thread in threads {
            by_id.insert(thread.id.clone(), thread);
        }
        self.threads = by_id.into_values().collect();
        let rows = build_rows(&self.threads, primary_thread_id);
        self.view.update_rows(rows);
        self.refreshing = false;
        self.next_cursor = next_cursor;
        self.seen_cursors.clear();
        self.loading_more = false;
        self.load_more_failed = false;
        self.sync_pagination();
    }

    #[cfg(test)]
    pub(crate) fn apply_refresh(
        &mut self,
        generation: u64,
        threads: Vec<Thread>,
        primary_thread_id: Option<&str>,
    ) -> bool {
        self.apply_refresh_page(generation, threads, None, primary_thread_id)
    }

    pub(crate) fn apply_refresh_page(
        &mut self,
        generation: u64,
        threads: Vec<Thread>,
        next_cursor: Option<String>,
        primary_thread_id: Option<&str>,
    ) -> bool {
        if generation != self.refresh_generation {
            return false;
        }
        self.replace_threads_page(threads, primary_thread_id, next_cursor);
        true
    }

    pub(crate) fn apply_load_more(
        &mut self,
        threads: Vec<Thread>,
        next_cursor: Option<String>,
        primary_thread_id: Option<&str>,
    ) {
        let mut by_id = self
            .threads
            .drain(..)
            .map(|thread| (thread.id.clone(), thread))
            .collect::<HashMap<_, _>>();
        for thread in threads {
            by_id.insert(thread.id.clone(), thread);
        }
        self.threads = by_id.into_values().collect();
        self.next_cursor = next_cursor;
        self.loading_more = false;
        self.load_more_failed = false;
        self.view
            .update_rows(build_rows(&self.threads, primary_thread_id));
        self.sync_pagination();
    }

    pub(crate) fn fail_load_more(&mut self) {
        self.loading_more = false;
        self.load_more_failed = true;
        self.sync_pagination();
    }

    pub(crate) fn next_cursor_is_repeated(&self, cursor: Option<&str>) -> bool {
        cursor.is_some_and(|cursor| self.seen_cursors.contains(cursor))
    }

    pub(crate) fn sync_pagination(&mut self) {
        self.view.set_pagination(
            self.next_cursor.is_some(),
            self.loading_more,
            self.load_more_failed,
        );
    }

    pub(crate) fn take_refresh_pending(&mut self) -> bool {
        std::mem::take(&mut self.refresh_pending)
    }
}

pub(crate) fn build_rows(
    threads: &[Thread],
    primary_thread_id: Option<&str>,
) -> Vec<AgentsOverviewRow> {
    let mut by_id = HashMap::new();
    for thread in threads.iter().filter(|thread| !thread.ephemeral) {
        by_id.insert(thread.id.clone(), thread);
    }
    let mut children: HashMap<&str, Vec<&Thread>> = HashMap::new();
    for thread in by_id.values() {
        if let Some(parent) = thread.parent_thread_id.as_deref() {
            children.entry(parent).or_default().push(thread);
        }
    }
    let mut rows = by_id
        .values()
        .filter(|thread| thread.parent_thread_id.is_none())
        .map(|thread| AgentsOverviewRow {
            thread: (*thread).clone(),
            group: agents_overview_group(thread, &children),
            is_current: primary_thread_id == Some(thread.id.as_str()),
        })
        .collect::<Vec<_>>();
    if rows.is_empty() {
        rows = by_id
            .values()
            .map(|thread| AgentsOverviewRow {
                thread: (*thread).clone(),
                group: AgentsOverviewGroup::for_status(&thread.status),
                is_current: primary_thread_id == Some(thread.id.as_str()),
            })
            .collect();
    }
    rows.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then_with(|| right.thread.updated_at.cmp(&left.thread.updated_at))
            .then_with(|| left.thread.id.cmp(&right.thread.id))
    });
    rows
}

pub(crate) fn agents_overview_group(
    thread: &Thread,
    children: &HashMap<&str, Vec<&Thread>>,
) -> AgentsOverviewGroup {
    children.get(thread.id.as_str()).into_iter().flatten().fold(
        AgentsOverviewGroup::for_status(&thread.status),
        |group, child| group.min(agents_overview_group(child, children)),
    )
}

impl super::App {
    pub(crate) fn open_agents_overview(&mut self) {
        let primary = self.primary_thread_id.as_deref();
        let overview = AgentsOverviewState::new_with_keymap(
            primary,
            self.chat_widget.runtime_keymap.agents().clone(),
            self.chat_widget.runtime_keymap.list().clone(),
        );
        self.chat_widget.set_agents_overview(overview);
    }

    /// Start a background task through the current App Server session.
    pub(crate) async fn dispatch_agents_overview_task(
        &self,
        app_server: &AppServerSession,
        prompt: String,
        cwd: Option<PathBuf>,
    ) -> Result<(String, String)> {
        let thread = app_server
            .start_thread_with_session_start_source(
                cwd.unwrap_or_else(|| self.cwd.clone()),
                self.chat_widget.model.clone(),
                self.chat_widget.model_provider.clone(),
                None,
            )
            .await?;
        let thread_id = thread.thread.id.clone();
        let turn_id = self
            .submit_agents_overview_prompt(app_server, thread_id.clone(), prompt)
            .await?;
        Ok((thread_id, turn_id))
    }

    pub(crate) async fn submit_agents_overview_prompt(
        &self,
        app_server: &AppServerSession,
        thread_id: String,
        prompt: String,
    ) -> Result<String> {
        if prompt.trim().is_empty() {
            return Err(anyhow!("background task prompt must not be empty"));
        }
        app_server
            .turn_start(
                thread_id,
                vec![UserInput::Text {
                    text: prompt,
                    text_elements: Vec::new(),
                }],
            )
            .await
    }

    pub(crate) async fn stop_agents_overview_thread(
        &self,
        app_server: &AppServerSession,
        thread_id: String,
    ) -> Result<Option<String>> {
        let thread = app_server.thread_read(thread_id.clone(), true).await?;
        let turn_id = thread
            .thread
            .turns
            .into_iter()
            .rev()
            .find(|turn| turn.status == TurnStatus::InProgress)
            .map(|turn| turn.id);
        let Some(turn_id) = turn_id else {
            return Ok(None);
        };
        app_server
            .turn_interrupt(thread_id, turn_id.clone())
            .await?;
        Ok(Some(turn_id))
    }
}

#[cfg(test)]
#[path = "agents_overview_tests.rs"]
mod tests;
