use aster::session::SessionRuntimeSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeProjectionSnapshot {
    pub session_id: String,
    pub has_runtime_snapshot: bool,
    pub thread_count: usize,
    pub primary_thread_id: Option<String>,
    pub turn_count: usize,
    pub item_count: usize,
    pub latest_turn_id: Option<String>,
}

impl RuntimeProjectionSnapshot {
    pub fn from_snapshot(
        session_id: impl Into<String>,
        snapshot: Option<&SessionRuntimeSnapshot>,
    ) -> Self {
        let session_id = session_id.into();
        let Some(snapshot) = snapshot else {
            return Self {
                session_id,
                has_runtime_snapshot: false,
                thread_count: 0,
                primary_thread_id: None,
                turn_count: 0,
                item_count: 0,
                latest_turn_id: None,
            };
        };

        let thread_count = snapshot.threads.len();
        let primary_thread_id = snapshot
            .threads
            .first()
            .map(|thread| thread.thread.id.clone());
        let turn_count = snapshot
            .threads
            .iter()
            .map(|thread| thread.turns.len())
            .sum();
        let item_count = snapshot
            .threads
            .iter()
            .map(|thread| thread.items.len())
            .sum();
        let latest_turn_id = snapshot
            .threads
            .iter()
            .flat_map(|thread| thread.turns.iter())
            .max_by(|left, right| {
                left.updated_at
                    .cmp(&right.updated_at)
                    .then_with(|| left.created_at.cmp(&right.created_at))
                    .then_with(|| left.id.cmp(&right.id))
            })
            .map(|turn| turn.id.clone());

        Self {
            session_id,
            has_runtime_snapshot: true,
            thread_count,
            primary_thread_id,
            turn_count,
            item_count,
            latest_turn_id,
        }
    }

    pub fn primary_thread_id(&self) -> Option<&str> {
        self.primary_thread_id.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeProjectionSnapshot;
    use aster::session::{
        SessionRuntimeSnapshot, ThreadRuntime, ThreadRuntimeSnapshot, TurnRuntime, TurnStatus,
    };
    use chrono::{Duration, Utc};

    #[test]
    fn test_runtime_projection_snapshot_reads_primary_thread_and_latest_turn() {
        let now = Utc::now();
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-1".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-1",
                    std::path::PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![
                    TurnRuntime {
                        id: "turn-old".to_string(),
                        session_id: "session-1".to_string(),
                        thread_id: "thread-1".to_string(),
                        status: TurnStatus::Running,
                        input_text: Some("old".to_string()),
                        error_message: None,
                        context_override: None,
                        output_schema_runtime: None,
                        created_at: now - Duration::minutes(2),
                        started_at: Some(now - Duration::minutes(2)),
                        completed_at: None,
                        updated_at: now - Duration::minutes(1),
                    },
                    TurnRuntime {
                        id: "turn-new".to_string(),
                        session_id: "session-1".to_string(),
                        thread_id: "thread-1".to_string(),
                        status: TurnStatus::Completed,
                        input_text: Some("new".to_string()),
                        error_message: None,
                        context_override: None,
                        output_schema_runtime: None,
                        created_at: now - Duration::seconds(30),
                        started_at: Some(now - Duration::seconds(30)),
                        completed_at: Some(now - Duration::seconds(10)),
                        updated_at: now,
                    },
                ],
                items: Vec::new(),
            }],
        };

        let projection = RuntimeProjectionSnapshot::from_snapshot("session-1", Some(&snapshot));

        assert!(projection.has_runtime_snapshot);
        assert_eq!(projection.primary_thread_id(), Some("thread-1"));
        assert_eq!(projection.thread_count, 1);
        assert_eq!(projection.turn_count, 2);
        assert_eq!(projection.item_count, 0);
        assert_eq!(projection.latest_turn_id.as_deref(), Some("turn-new"));
    }

    #[test]
    fn test_runtime_projection_snapshot_handles_missing_snapshot() {
        let projection = RuntimeProjectionSnapshot::from_snapshot("session-2", None);

        assert!(!projection.has_runtime_snapshot);
        assert_eq!(projection.primary_thread_id(), None);
        assert_eq!(projection.turn_count, 0);
    }
}
