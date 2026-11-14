//! Side-conversation bookkeeping: a forked thread that returns to its parent.
//!
//! The TUI keeps the relationship in memory only; after a restart the fork is an ordinary
//! thread. This owner stays pure so navigation and the slash command share one source.

use std::collections::BTreeMap;
use std::collections::HashMap;

use crate::projection::TranscriptEntry;

#[derive(Debug, Clone)]
pub(crate) struct SideParentSnapshot {
    pub(crate) title: String,
    pub(crate) entries: Vec<TranscriptEntry>,
}

#[derive(Debug, Default)]
pub(crate) struct SideState {
    parents: HashMap<String, String>,
    parent_snapshot: Option<SideParentSnapshot>,
}

impl SideState {
    pub(crate) fn parent_of(&self, thread_id: &str) -> Option<&str> {
        self.parents.get(thread_id).map(String::as_str)
    }

    pub(crate) fn is_side_thread(&self, thread_id: &str) -> bool {
        self.parents.contains_key(thread_id)
    }

    pub(crate) fn has_open_side(&self, parent_thread_id: &str) -> bool {
        self.parents
            .values()
            .any(|parent| parent == parent_thread_id)
    }

    pub(crate) fn open(&mut self, side_thread_id: String, parent_thread_id: String) {
        self.parents.insert(side_thread_id, parent_thread_id);
    }

    pub(crate) fn set_parent_snapshot(&mut self, snapshot: SideParentSnapshot) {
        self.parent_snapshot = Some(snapshot);
    }

    pub(crate) fn parent_snapshot(&self) -> Option<&SideParentSnapshot> {
        self.parent_snapshot.as_ref()
    }

    pub(crate) fn clear_parent_snapshot(&mut self) {
        self.parent_snapshot = None;
    }

    pub(crate) fn close(&mut self, side_thread_id: &str) -> Option<String> {
        self.parent_snapshot = None;
        self.parents.remove(side_thread_id)
    }

    pub(crate) fn len(&self) -> usize {
        self.parents.len()
    }

    pub(crate) fn load(&mut self, mappings: BTreeMap<String, String>) {
        self.parents = mappings.into_iter().collect();
    }

    pub(crate) fn mappings(&self) -> BTreeMap<String, String> {
        self.parents
            .iter()
            .map(|(side, parent)| (side.clone(), parent.clone()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_one_side_per_parent_and_closes_back_to_it() {
        let mut state = SideState::default();
        state.open("side-1".to_string(), "main".to_string());
        assert!(state.is_side_thread("side-1"));
        assert_eq!(state.parent_of("side-1"), Some("main"));
        assert!(state.has_open_side("main"));
        assert!(!state.has_open_side("side-1"));
        assert_eq!(state.close("side-1").as_deref(), Some("main"));
        assert_eq!(state.len(), 0);
        assert!(!state.is_side_thread("side-1"));
    }

    #[test]
    fn loads_and_exports_persisted_mappings() {
        let mappings = BTreeMap::from([
            ("side-1".to_string(), "main".to_string()),
            ("side-2".to_string(), "other".to_string()),
        ]);
        let mut state = SideState::default();
        state.load(mappings.clone());
        assert_eq!(state.len(), 2);
        assert_eq!(state.mappings(), mappings);
    }

    #[test]
    fn snapshot_is_scoped_to_the_open_side_conversation() {
        let mut state = SideState::default();
        state.open("side-1".to_string(), "main".to_string());
        assert!(state.parent_snapshot().is_none());
        state.set_parent_snapshot(SideParentSnapshot {
            title: "Main".to_string(),
            entries: Vec::new(),
        });
        assert_eq!(
            state
                .parent_snapshot()
                .map(|snapshot| snapshot.title.as_str()),
            Some("Main")
        );
        state.close("side-1");
        assert!(state.parent_snapshot().is_none());
    }
}
