//! Multi-agent picker navigation and labeling state for the TUI app.
//!
//! This module mirrors Codex's `app/agent_navigation.rs` boundary. It owns only stable ordering,
//! labels, and liveness facts derived from App Server `Thread`/`SubAgentActivity` data. Thread
//! lifecycle and switching remain in `App` and `AppServerSession`.

use crate::multi_agents::{
    format_agent_picker_item_name, next_agent_shortcut, previous_agent_shortcut,
    AgentPickerThreadEntry, SubAgentActivityDisplay,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AgentNavigationDirection {
    Previous,
    Next,
}

#[derive(Debug, Default)]
pub(crate) struct AgentNavigationState {
    threads: std::collections::HashMap<String, AgentPickerThreadEntry>,
    order: Vec<String>,
    stopped_threads: std::collections::HashSet<String>,
    parent_owned_threads: std::collections::HashSet<String>,
}

#[allow(dead_code)]
impl AgentNavigationState {
    pub(crate) fn get(&self, thread_id: &str) -> Option<&AgentPickerThreadEntry> {
        self.threads.get(thread_id)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.threads.is_empty()
    }

    pub(crate) fn is_parent_owned(&self, thread_id: &str) -> bool {
        self.parent_owned_threads.contains(thread_id)
    }

    pub(crate) fn mark_parent_owned(&mut self, thread_id: impl Into<String>) {
        self.parent_owned_threads.insert(thread_id.into());
    }

    pub(crate) fn upsert(
        &mut self,
        thread_id: impl Into<String>,
        agent_nickname: Option<String>,
        agent_role: Option<String>,
        is_closed: bool,
    ) {
        let thread_id = thread_id.into();
        if !self.threads.contains_key(&thread_id) {
            self.order.push(thread_id.clone());
        }
        let (agent_path, is_running) = self
            .threads
            .get(&thread_id)
            .map(|entry| (entry.agent_path.clone(), entry.is_running))
            .unwrap_or((None, false));
        self.threads.insert(
            thread_id,
            AgentPickerThreadEntry {
                agent_nickname,
                agent_role,
                agent_path,
                is_running: is_running && !is_closed,
                is_closed,
            },
        );
    }

    pub(crate) fn record_sub_agent_activity(&mut self, activity: SubAgentActivityDisplay) {
        if !self.threads.contains_key(&activity.thread_id) {
            self.order.push(activity.thread_id.clone());
        }
        let entry = self
            .threads
            .entry(activity.thread_id.clone())
            .or_insert_with(|| AgentPickerThreadEntry {
                agent_nickname: None,
                agent_role: None,
                agent_path: None,
                is_running: false,
                is_closed: false,
            });
        entry.agent_path = Some(activity.agent_path);
        if activity.is_running_hint
            && !entry.is_closed
            && !self.stopped_threads.contains(&activity.thread_id)
        {
            entry.is_running = true;
        } else {
            entry.is_running = false;
            self.stopped_threads.insert(activity.thread_id);
        }
    }

    pub(crate) fn mark_running(&mut self, thread_id: &str) {
        if self
            .threads
            .get(thread_id)
            .is_some_and(|entry| entry.is_closed)
        {
            return;
        }
        self.stopped_threads.remove(thread_id);
        self.set_running(thread_id, true);
    }

    pub(crate) fn mark_stopped(&mut self, thread_id: &str) {
        self.stopped_threads.insert(thread_id.to_string());
        self.set_running(thread_id, false);
    }

    pub(crate) fn set_running(&mut self, thread_id: &str, is_running: bool) {
        if let Some(entry) = self.threads.get_mut(thread_id) {
            entry.is_running = is_running;
        }
    }

    pub(crate) fn set_agent_path(&mut self, thread_id: &str, agent_path: Option<String>) {
        if let Some(agent_path) = agent_path {
            if let Some(entry) = self.threads.get_mut(thread_id) {
                entry.agent_path = Some(agent_path);
            }
        }
    }

    pub(crate) fn mark_closed(&mut self, thread_id: &str) {
        if let Some(entry) = self.threads.get_mut(thread_id) {
            entry.is_closed = true;
            entry.is_running = false;
        } else {
            self.upsert(thread_id, None, None, true);
        }
    }

    pub(crate) fn clear(&mut self) {
        self.threads.clear();
        self.order.clear();
        self.stopped_threads.clear();
        self.parent_owned_threads.clear();
    }

    pub(crate) fn remove(&mut self, thread_id: &str) {
        self.threads.remove(thread_id);
        self.order.retain(|candidate| candidate != thread_id);
        self.stopped_threads.remove(thread_id);
        self.parent_owned_threads.remove(thread_id);
    }

    pub(crate) fn ordered_threads(&self) -> Vec<(&str, &AgentPickerThreadEntry)> {
        self.order
            .iter()
            .filter_map(|thread_id| {
                self.threads
                    .get(thread_id)
                    .map(|entry| (thread_id.as_str(), entry))
            })
            .collect()
    }

    pub(crate) fn ordered_path_backed_subagent_threads(
        &self,
        primary_thread_id: Option<&str>,
    ) -> Vec<(&str, &AgentPickerThreadEntry)> {
        self.ordered_threads()
            .into_iter()
            .filter(|(thread_id, entry)| {
                Some(*thread_id) != primary_thread_id
                    && entry
                        .agent_path
                        .as_deref()
                        .is_some_and(|path| !path.trim().is_empty())
            })
            .collect()
    }

    pub(crate) fn tracked_thread_ids(&self) -> Vec<String> {
        self.order
            .iter()
            .filter(|thread_id| self.threads.contains_key(*thread_id))
            .cloned()
            .collect()
    }

    pub(crate) fn adjacent_thread_id(
        &self,
        current_displayed_thread_id: Option<&str>,
        direction: AgentNavigationDirection,
    ) -> Option<String> {
        let ordered = self.tracked_thread_ids();
        if ordered.len() < 2 {
            return None;
        }
        let current = current_displayed_thread_id?;
        let index = ordered.iter().position(|thread_id| thread_id == current)?;
        let next = match direction {
            AgentNavigationDirection::Next => (index + 1) % ordered.len(),
            AgentNavigationDirection::Previous => index.checked_sub(1).unwrap_or(ordered.len() - 1),
        };
        Some(ordered[next].clone())
    }

    pub(crate) fn active_agent_label(
        &self,
        current_displayed_thread_id: Option<&str>,
        primary_thread_id: Option<&str>,
    ) -> Option<String> {
        if self.threads.len() <= 1 {
            return None;
        }
        let thread_id = current_displayed_thread_id?;
        let is_primary = primary_thread_id == Some(thread_id);
        Some(
            self.threads
                .get(thread_id)
                .map(|entry| {
                    if !is_primary {
                        if let Some(path) = entry
                            .agent_path
                            .as_deref()
                            .filter(|path| !path.trim().is_empty())
                        {
                            return format!("`{path}`");
                        }
                    }
                    format_agent_picker_item_name(
                        entry.agent_nickname.as_deref(),
                        entry.agent_role.as_deref(),
                        is_primary,
                    )
                })
                .unwrap_or_else(|| format_agent_picker_item_name(None, None, is_primary)),
        )
    }

    pub(crate) fn picker_subtitle(locale: crate::locale::Locale) -> String {
        use crossterm::event::KeyModifiers;
        locale.agent_picker_subtitle(
            &crate::keymap::shortcut_label(previous_agent_shortcut(), KeyModifiers::ALT),
            &crate::keymap::shortcut_label(next_agent_shortcut(), KeyModifiers::ALT),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn populated_state() -> (AgentNavigationState, String, String, String) {
        let mut state = AgentNavigationState::default();
        let main = "main".to_string();
        let first = "agent-1".to_string();
        let second = "agent-2".to_string();
        state.upsert(main.clone(), None, None, false);
        state.upsert(
            first.clone(),
            Some("Robie".into()),
            Some("explorer".into()),
            false,
        );
        state.upsert(
            second.clone(),
            Some("Bob".into()),
            Some("worker".into()),
            false,
        );
        (state, main, first, second)
    }

    #[test]
    fn upsert_preserves_first_seen_order() {
        let (mut state, main, first, second) = populated_state();
        state.upsert(
            first.clone(),
            Some("Robie".into()),
            Some("worker".into()),
            true,
        );
        assert_eq!(state.tracked_thread_ids(), vec![main, first, second]);
    }

    #[test]
    fn adjacent_thread_id_wraps_in_spawn_order() {
        let (state, main, first, second) = populated_state();
        assert_eq!(
            state.adjacent_thread_id(Some(second.as_str()), AgentNavigationDirection::Next),
            Some(main.clone())
        );
        assert_eq!(
            state.adjacent_thread_id(Some(main.as_str()), AgentNavigationDirection::Previous),
            Some(second.clone())
        );
        assert_eq!(
            state.adjacent_thread_id(Some(second.as_str()), AgentNavigationDirection::Previous),
            Some(first)
        );
    }

    #[test]
    fn active_agent_label_tracks_current_thread() {
        let (state, main, first, _) = populated_state();
        assert_eq!(
            state.active_agent_label(Some(first.as_str()), Some(main.as_str())),
            Some("Robie [explorer]".to_string())
        );
        assert_eq!(
            state.active_agent_label(Some(main.as_str()), Some(main.as_str())),
            Some("Main [default]".to_string())
        );
    }

    #[test]
    fn stopped_activity_does_not_revive_after_liveness_terminal_state() {
        let mut state = AgentNavigationState::default();
        state.record_sub_agent_activity(SubAgentActivityDisplay {
            thread_id: "agent-1".into(),
            agent_path: "/root/child".into(),
            is_running_hint: false,
        });
        state.record_sub_agent_activity(SubAgentActivityDisplay {
            thread_id: "agent-1".into(),
            agent_path: "/root/child".into(),
            is_running_hint: true,
        });
        assert!(!state.get("agent-1").expect("tracked").is_running);
    }

    #[test]
    fn picker_subtitle_mentions_codex_shortcuts() {
        let subtitle = AgentNavigationState::picker_subtitle(crate::locale::Locale::EnUs);
        assert!(subtitle.contains("⌥← previous"));
        assert!(subtitle.contains("⌥→ next"));
    }
}
