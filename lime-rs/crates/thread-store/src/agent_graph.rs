// Adapted from upstream agent-graph-store/store.rs and types.rs
// (5c19155cbd93bfa099016e7487259f61669823ff), Apache-2.0; see repository NOTICE.

use std::future::Future;
use std::pin::Pin;

use agent_protocol::ThreadId;
use serde::{Deserialize, Serialize};

use crate::ThreadStoreResult;

/// Lifecycle status attached to a directional thread-spawn edge.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadSpawnEdgeStatus {
    /// The child spawn is durable but not yet usable or visible.
    Pending,
    /// The child thread is still live or resumable as an open spawned agent.
    Open,
    /// The child thread has been closed from the parent/child graph's perspective.
    Closed,
}

/// Direct incoming spawn edge for a child thread.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadSpawnParent {
    pub parent_thread_id: ThreadId,
    pub status: ThreadSpawnEdgeStatus,
}

/// Future returned by [`AgentGraphStore`] operations.
pub type AgentGraphStoreFuture<'a, T> =
    Pin<Box<dyn Future<Output = ThreadStoreResult<T>> + Send + 'a>>;

/// Storage-neutral boundary for persisted thread-spawn parent/child topology.
///
/// Implementations return stable ordering for list methods so runtime callers can merge durable
/// graph state with live state without introducing nondeterministic output.
pub trait AgentGraphStore: Send + Sync {
    /// Reserves a durable, hidden spawn intent before creating the child Thread.
    ///
    /// The child session id is retained only while the edge is pending so crash recovery can
    /// remove every partial store even when the canonical Thread was never created.
    fn create_pending_thread_spawn_edge(
        &self,
        parent_thread_id: ThreadId,
        child_thread_id: ThreadId,
        child_session_id: String,
    ) -> AgentGraphStoreFuture<'_, ()>;

    /// Atomically publishes a fully materialized pending child as Open.
    fn commit_pending_thread_spawn_edge(
        &self,
        child_thread_id: ThreadId,
        child_session_id: String,
    ) -> AgentGraphStoreFuture<'_, bool>;

    /// Insert or replace the directional parent/child edge for a spawned thread.
    ///
    /// `child_thread_id` has at most one persisted parent. Re-inserting the same child updates both
    /// the parent and status to match the supplied values. Self edges and reparenting that would
    /// introduce a cycle fail without changing the existing graph.
    fn upsert_thread_spawn_edge(
        &self,
        parent_thread_id: ThreadId,
        child_thread_id: ThreadId,
        status: ThreadSpawnEdgeStatus,
    ) -> AgentGraphStoreFuture<'_, ()>;

    /// Update the lifecycle status of a spawned thread's incoming edge.
    ///
    /// Missing children are treated as a successful no-op.
    fn set_thread_spawn_edge_status(
        &self,
        child_thread_id: ThreadId,
        status: ThreadSpawnEdgeStatus,
    ) -> AgentGraphStoreFuture<'_, ()>;

    /// Deletes an incoming child edge during spawn compensation.
    fn delete_thread_spawn_edge(&self, child_thread_id: ThreadId) -> AgentGraphStoreFuture<'_, ()>;

    /// Read the direct incoming spawn edge for a child thread.
    fn read_thread_spawn_parent(
        &self,
        child_thread_id: ThreadId,
    ) -> AgentGraphStoreFuture<'_, Option<ThreadSpawnParent>>;

    /// List direct spawned children of a parent thread ordered by thread id.
    fn list_thread_spawn_children(
        &self,
        parent_thread_id: ThreadId,
        status_filter: Option<ThreadSpawnEdgeStatus>,
    ) -> AgentGraphStoreFuture<'_, Vec<ThreadId>>;

    /// List descendants breadth-first by depth, then by thread id.
    ///
    /// `status_filter` applies to every traversed edge. Descendants below a non-matching edge are
    /// therefore excluded even when their own incoming edge matches.
    fn list_thread_spawn_descendants(
        &self,
        root_thread_id: ThreadId,
        status_filter: Option<ThreadSpawnEdgeStatus>,
    ) -> AgentGraphStoreFuture<'_, Vec<ThreadId>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_graph_status_serializes_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&ThreadSpawnEdgeStatus::Pending)
                .expect("serialize pending status"),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&ThreadSpawnEdgeStatus::Open).expect("serialize open status"),
            "\"open\""
        );
        assert_eq!(
            serde_json::to_string(&ThreadSpawnEdgeStatus::Closed).expect("serialize closed status"),
            "\"closed\""
        );
        assert_eq!(
            serde_json::from_str::<ThreadSpawnEdgeStatus>("\"pending\"")
                .expect("deserialize pending status"),
            ThreadSpawnEdgeStatus::Pending
        );
        assert_eq!(
            serde_json::from_str::<ThreadSpawnEdgeStatus>("\"open\"")
                .expect("deserialize open status"),
            ThreadSpawnEdgeStatus::Open
        );
        assert_eq!(
            serde_json::from_str::<ThreadSpawnEdgeStatus>("\"closed\"")
                .expect("deserialize closed status"),
            ThreadSpawnEdgeStatus::Closed
        );
    }

    #[allow(dead_code)]
    fn assert_agent_graph_object_safe(store: &dyn AgentGraphStore) {
        let _ = store;
    }
}
