//! Trusted platform adapter. Helper restarts always invalidate prior consent.

use super::native_host::NativeHost;
use super::*;
use serde::Deserialize;
use serde_json::json;
use std::sync::Mutex;

pub struct NativeAdapter {
    host: NativeHost,
    state: Mutex<SnapshotState>,
}

#[derive(Default)]
struct SnapshotState {
    generation: u64,
    last: Option<(u64, ComputerUseSnapshot)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetupReply {
    outcome: ComputerUseSetupOutcome,
    snapshot: ComputerUseSnapshot,
}

impl Default for NativeAdapter {
    fn default() -> Self {
        Self {
            host: NativeHost::new(),
            state: Mutex::new(SnapshotState::default()),
        }
    }
}

impl NativeAdapter {
    fn observe(
        &self,
        session: u64,
        mut snapshot: ComputerUseSnapshot,
    ) -> ComputerUseResult<ComputerUseSnapshot> {
        if snapshot.generation == 0 {
            return Err(denied("Native helper generation must be nonzero"));
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| denied("Native adapter state unavailable"))?;
        if let Some((previous_session, previous)) = &state.last {
            if *previous_session == session
                && (snapshot.generation < previous.generation
                    || (snapshot.generation == previous.generation && snapshot != *previous))
            {
                return Err(denied(
                    "Native helper snapshot generation is stale or inconsistent",
                ));
            }
        }
        let next = (session, snapshot.clone());
        if state.last.as_ref() != Some(&next) {
            state.generation = state
                .generation
                .checked_add(1)
                .ok_or_else(|| denied("Native adapter generation exhausted"))?;
            state.last = Some(next);
        }
        snapshot.generation = state.generation;
        Ok(snapshot)
    }

    fn missing(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        self.observe(
            0,
            ComputerUseSnapshot {
                generation: 1,
                readiness: ComputerUseReadiness::NotInstalled,
                targets: vec![],
                reason: Some(
                    "The manifested native helper is not installed with this App Server".into(),
                ),
                setup_steps: vec!["install_native_helper".into()],
            },
        )
    }
}

#[async_trait]
impl ComputerUseAdapter for NativeAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }

    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        match self.host.invoke("computerUse.snapshot", json!({})).await? {
            Some((session, result)) => self.observe(
                session,
                serde_json::from_value(result).map_err(|e| denied(e.to_string()))?,
            ),
            None => self.missing(),
        }
    }

    async fn setup(
        &self,
        params: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        let Some((session, result)) = self
            .host
            .invoke(
                "computerUse.setup",
                serde_json::to_value(params).map_err(|e| denied(e.to_string()))?,
            )
            .await?
        else {
            return Ok(ComputerUseSetupOutcome::default());
        };
        let reply: SetupReply =
            serde_json::from_value(result).map_err(|e| denied(e.to_string()))?;
        if reply.outcome.generation != reply.snapshot.generation {
            return Err(denied(
                "Native consent belongs to a different snapshot generation",
            ));
        }
        let snapshot = self.observe(session, reply.snapshot)?;
        Ok(ComputerUseSetupOutcome {
            generation: snapshot.generation,
            ..reply.outcome
        })
    }

    async fn execute(
        &self,
        lease: &ComputerUseLease,
        action: ComputerUseAction,
        cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        let (session, generation) = {
            let state = self
                .state
                .lock()
                .map_err(|_| denied("Native adapter state unavailable"))?;
            state
                .last
                .as_ref()
                .map(|(session, snapshot)| (*session, snapshot.generation))
                .ok_or_else(|| denied("Native helper snapshot is not available"))?
        };
        let Some((response_session, value)) = self
            .host
            .invoke_cancel(
                "computerUse.execute",
                json!({
                    "target":lease.response.target,
                    "generation":generation,
                    "fence":lease.control_fence(),
                    "operation":action,
                }),
                cancel,
                Some(session),
            )
            .await?
        else {
            return Err(denied("Native helper is not installed"));
        };
        if response_session != session {
            return Err(denied("Native helper restarted before action execution"));
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_restart_advances_generation_and_stale_or_changed_snapshot_is_rejected() {
        let adapter = NativeAdapter::default();
        let raw = ComputerUseSnapshot {
            generation: 1,
            readiness: ComputerUseReadiness::PermissionRequired,
            targets: vec![],
            reason: Some("permission_required".into()),
            setup_steps: vec![],
        };
        let first = adapter.observe(1, raw.clone()).unwrap();
        assert_eq!(adapter.observe(1, raw.clone()).unwrap(), first);
        let mut changed = raw.clone();
        changed.reason = None;
        assert!(adapter.observe(1, changed).is_err());
        let mut newer = raw.clone();
        newer.generation = 2;
        let second = adapter.observe(1, newer).unwrap();
        assert!(second.generation > first.generation);
        assert!(adapter.observe(1, raw.clone()).is_err());
        let restarted = adapter.observe(2, raw).unwrap();
        assert!(restarted.generation > second.generation);
    }
}
