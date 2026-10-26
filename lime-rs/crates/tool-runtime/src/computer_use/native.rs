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
    pub(super) async fn setup_wps(&self) -> ComputerUseResult<ComputerUseSetupOutcome> {
        // Private adapter intent, never accepted from public/model JSON. Opening
        // an application does not approve a target or create an input grant.
        let outcome = self
            .setup_params(json!({
                "adapter": "native", "target": null, "grantScope": "session",
                "application": "WPS"
            }))
            .await?;
        if outcome.approved_target.is_some() || outcome.approved_revision.is_some() {
            return Err(denied("Opening WPS cannot approve an application window"));
        }
        Ok(outcome)
    }

    async fn setup_params(
        &self,
        params: serde_json::Value,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        let Some((session, result)) = self.host.invoke("computerUse.setup", params).await? else {
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
        let approved_revision = reply.outcome.approved_target.as_ref().and_then(|approved| {
            snapshot
                .targets
                .iter()
                .find(|target| same_target(&target.identity, approved))
                .and_then(|target| target.revision.clone())
        });
        Ok(ComputerUseSetupOutcome {
            generation: snapshot.generation,
            approved_revision,
            ..reply.outcome
        })
    }

    pub(super) fn session_id(&self) -> ComputerUseResult<u64> {
        self.state
            .lock()
            .map_err(|_| denied("Native adapter state unavailable"))?
            .last
            .as_ref()
            .map(|(session, _)| *session)
            .ok_or_else(|| denied("Native helper session is unavailable"))
    }

    pub(super) async fn execute_target(
        &self,
        target: &ComputerUseTargetIdentity,
        owner: &ComputerUseOwner,
        fence: u64,
        action: ComputerUseAction,
        cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        let (session, generation) = {
            let state = self
                .state
                .lock()
                .map_err(|_| denied("Native adapter state unavailable"))?;
            let (session, snapshot) = state
                .last
                .as_ref()
                .ok_or_else(|| denied("Native helper snapshot is not available"))?;
            if !snapshot
                .targets
                .iter()
                .any(|entry| same_target(&entry.identity, target))
            {
                return Err(denied("Native action target is not present"));
            }
            (*session, snapshot.generation)
        };
        let Some((response_session, value)) = self.host.invoke_cancel(
            "computerUse.execute",
            json!({"target": target, "owner": owner, "generation": generation, "fence": fence, "operation": action}),
            cancel,
            Some(session),
        ).await? else {
            return Err(denied("Native helper is not installed"));
        };
        if response_session != session {
            return Err(denied("Native helper restarted before action execution"));
        }
        Ok(value)
    }

    fn observe(
        &self,
        session: u64,
        mut snapshot: ComputerUseSnapshot,
    ) -> ComputerUseResult<ComputerUseSnapshot> {
        if snapshot.generation == 0 {
            return Err(denied("Native helper generation must be nonzero"));
        }
        for target in &snapshot.targets {
            if let Some(revision) = &target.revision {
                if session == 0
                    || revision
                        .parse::<u64>()
                        .ok()
                        .filter(|value| *value > 0)
                        .is_none()
                {
                    return Err(denied("Native helper target revision is invalid"));
                }
            }
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
        // Session identity is supplied by NativeHost, never by helper/model JSON.
        for target in &mut snapshot.targets {
            if let Some(revision) = target.revision.as_mut() {
                *revision = format!("{session}:{}", revision.parse::<u64>().unwrap());
            }
        }
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

    fn finish_turn(&self, owner: &ComputerUseOwner) {
        if let Ok(session) = self.session_id() {
            let _ = self.host.finish_turn(owner, session);
        }
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
        self.setup_params(serde_json::to_value(params).map_err(|e| denied(e.to_string()))?)
            .await
    }

    async fn execute(
        &self,
        lease: &ComputerUseLease,
        action: ComputerUseAction,
        cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        self.execute_target(
            &lease.response.target,
            &lease.owner,
            lease.control_fence(),
            action,
            cancel,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn private_wps_launch_and_explicit_window_consent_use_the_same_manifested_host() {
        let snapshot = ready_snapshot("7");
        let target = snapshot.targets[0].identity.clone();
        let launch = json!({"snapshot": snapshot, "outcome": {
            "accepted":true, "approvedTarget":null, "generation":1
        }});
        let mut consent = launch.clone();
        consent["outcome"]["approvedTarget"] = json!(target);
        let helper = format!(
            r##"#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line" > "$0.last-request"
  rest=${{line#*'"id":"'}}
  id=${{rest%%'"'*}}
  case "$line" in
    *'"application":"WPS"'*) result='{launch}' ;;
    *) result='{consent}' ;;
  esac
  printf '{{"id":"%s","ok":true,"result":%s}}\n' "$id" "$result"
done
"##
        );
        let (_temp, _, resource) =
            super::super::native_resources::tests::fixture(helper.as_bytes());
        let receipt = std::path::PathBuf::from(format!("{}.last-request", resource.path.display()));
        let adapter = NativeAdapter {
            host: NativeHost::with_resource(resource),
            state: Mutex::new(SnapshotState::default()),
        };
        let launch = adapter.setup_wps().await.unwrap();
        assert!(launch.accepted);
        assert!(launch.approved_target.is_none());
        assert!(launch.approved_revision.is_none());
        let actual: serde_json::Value =
            serde_json::from_slice(&std::fs::read(receipt).unwrap()).unwrap();
        assert_eq!(actual["method"], "computerUse.setup");
        assert_eq!(
            actual["params"],
            json!({
                "adapter":"native", "target":null, "grantScope":"session", "application":"WPS"
            })
        );
        assert!(
            serde_json::from_value::<ComputerUseSetupParams>(actual["params"].clone()).is_err(),
            "private launch authority must not be accepted by public/model JSON"
        );
        let session = adapter.session_id().unwrap();
        let consent = adapter
            .setup(&ComputerUseSetupParams {
                adapter: ComputerUseAdapterKind::Native,
                target: Some(target.clone()),
                grant_scope: ComputerUseGrantScope::Session,
            })
            .await
            .unwrap();
        assert!(consent.accepted);
        assert_eq!(consent.approved_target, Some(target));
        assert_eq!(consent.approved_revision, Some(format!("{session}:7")));
        assert_eq!(adapter.session_id().unwrap(), session);
    }

    fn ready_snapshot(revision: &str) -> ComputerUseSnapshot {
        ComputerUseSnapshot {
            generation: 1,
            readiness: ComputerUseReadiness::Ready,
            targets: vec![ComputerUseTarget {
                identity: ComputerUseTargetIdentity::Native {
                    app_id: "com.example.Editor".into(),
                    process_id: Some(42),
                    window_id: Some("12".into()),
                    title: Some("Editor".into()),
                },
                revision: Some(revision.into()),
                native_app: Some(NativeAppIdentity::Macos {
                    bundle_id: "com.example.Editor".into(),
                }),
                capabilities: vec![ComputerUseCapability::Observe],
                locked: false,
            }],
            reason: None,
            setup_steps: vec![],
        }
    }

    #[test]
    fn target_revision_is_bound_to_the_trusted_helper_session() {
        let adapter = NativeAdapter::default();
        let raw = ready_snapshot("7");
        let first = adapter.observe(41, raw.clone()).unwrap();
        assert_eq!(first.targets[0].revision.as_deref(), Some("41:7"));
        assert_eq!(adapter.observe(41, raw.clone()).unwrap(), first);
        assert_eq!(adapter.state.lock().unwrap().last, Some((41, raw.clone())));

        let restarted = adapter.observe(42, raw.clone()).unwrap();
        assert!(restarted.generation > first.generation);
        assert_eq!(restarted.targets[0].revision.as_deref(), Some("42:7"));
        assert_eq!(adapter.state.lock().unwrap().last, Some((42, raw)));
    }

    #[test]
    fn invalid_helper_revision_cannot_update_adapter_state_or_inject_a_session() {
        let adapter = NativeAdapter::default();
        let first = adapter.observe(41, ready_snapshot("7")).unwrap();
        for revision in ["", "0", "-1", "41:7", "18446744073709551616", "7.0"] {
            let mut invalid = ready_snapshot(revision);
            invalid.generation = 2;
            assert!(adapter.observe(41, invalid).is_err(), "{revision}");
            assert_eq!(adapter.observe(41, ready_snapshot("7")).unwrap(), first);
        }
        assert!(adapter.observe(0, ready_snapshot("7")).is_err());
        assert_eq!(adapter.observe(41, ready_snapshot("7")).unwrap(), first);
    }

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
