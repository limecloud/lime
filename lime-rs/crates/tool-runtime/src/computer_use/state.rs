use super::broker::{ControlBroker, ControlLease};
use super::*;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

mod snapshot;
mod turn;

const LEASE_LIFETIME: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct ComputerUseLease {
    pub response: ComputerUseLeaseAcquireResponse,
    pub owner: ComputerUseOwner,
    pub cancellation: CancellationToken,
    expires: Instant,
    control: Arc<ControlLease>,
}

impl ComputerUseLease {
    /// Host-internal fence for a helper action; never supplied by an RPC client.
    pub fn control_fence(&self) -> u64 {
        self.control.fence
    }
}

struct Grant {
    response: ComputerUseGrant,
    connection: String,
    session_consent: bool,
}

#[derive(Default)]
struct State {
    epoch: u64,
    policy: Option<ComputerUsePolicy>,
    snapshots: BTreeMap<ComputerUseAdapterKind, ComputerUseSnapshot>,
    grants: HashMap<String, Grant>,
    leases: HashMap<String, ComputerUseLease>,
    turn_connections: HashMap<(String, String), String>,
}

impl State {
    fn owners(&self) -> Vec<ComputerUseOwner> {
        let mut owners: Vec<_> = self
            .turn_connections
            .iter()
            .map(|((thread_id, turn_id), connection)| ComputerUseOwner {
                connection: connection.clone(),
                thread_id: thread_id.clone(),
                turn_id: turn_id.clone(),
            })
            .collect();
        for lease in self.leases.values() {
            if !owners.contains(&lease.owner) {
                owners.push(lease.owner.clone());
            }
        }
        owners
    }

    fn refresh(&mut self, policy: ComputerUseResult<ComputerUsePolicy>) -> ComputerUseResult<()> {
        match policy {
            Ok(policy) => {
                self.synchronize(policy);
                Ok(())
            }
            Err(error) => {
                self.invalidate();
                self.policy = None;
                Err(error)
            }
        }
    }
    fn invalidate(&mut self) {
        self.epoch = self
            .epoch
            .checked_add(1)
            .expect("Computer Use epoch exhausted");
        self.grants.clear();
        for (_, lease) in self.leases.drain() {
            lease.cancellation.cancel();
        }
    }

    fn synchronize(&mut self, policy: ComputerUsePolicy) {
        if self.policy.as_ref() != Some(&policy) {
            self.invalidate();
            self.policy = Some(policy);
        }
        self.leases.retain(|_, lease| {
            let live = lease.expires > Instant::now() && !lease.cancellation.is_cancelled();
            if !live {
                lease.cancellation.cancel();
            }
            live
        });
    }

    fn observe(
        &mut self,
        kind: ComputerUseAdapterKind,
        snapshot: ComputerUseSnapshot,
    ) -> ComputerUseResult<()> {
        if snapshot.generation == 0 {
            self.invalidate();
            return Err(denied("Adapter generation must be nonzero"));
        }
        if kind == ComputerUseAdapterKind::Native && !snapshot::unique_native_targets(&snapshot) {
            self.invalidate();
            return Err(denied(
                "Native snapshot target identities must be unique and complete",
            ));
        }
        if let Some(previous) = self.snapshots.get(&kind) {
            let previous_generation = previous.generation;
            if snapshot.generation < previous.generation {
                return Err(denied("Stale adapter generation"));
            }
            if previous == &snapshot {
                return Ok(());
            }
            if kind == ComputerUseAdapterKind::Chrome && chrome_target_addition(previous, &snapshot)
            {
                self.snapshots.insert(kind, snapshot);
                return Ok(());
            }
            if kind == ComputerUseAdapterKind::Native {
                if let Some(retained) = snapshot::retained_native_targets(previous, &snapshot) {
                    self.retain_native_authority(&retained);
                    self.snapshots.insert(kind, snapshot);
                    return Ok(());
                }
            }
            self.invalidate();
            if snapshot.generation == previous_generation {
                return Err(denied("Adapter changed without advancing its generation"));
            }
        }
        self.snapshots.insert(kind, snapshot);
        Ok(())
    }

    fn status(&self, kind: ComputerUseAdapterKind) -> ComputerUseAdapterStatus {
        let disabled = self.policy.as_ref().is_some_and(|p| !p.enabled(kind));
        let blocked = self
            .policy
            .as_ref()
            .is_some_and(|p| p.allow_browser_and_computer_use == Some(false));
        let snapshot = self.snapshots.get(&kind).filter(|_| !blocked && !disabled);
        ComputerUseAdapterStatus {
            adapter: kind,
            readiness: if self
                .policy
                .as_ref()
                .is_some_and(|p| p.allow_browser_and_computer_use == Some(false))
            {
                ComputerUseReadiness::Blocked
            } else if disabled {
                ComputerUseReadiness::Disabled
            } else {
                snapshot.map_or(ComputerUseReadiness::NotInstalled, |s| s.readiness)
            },
            targets: snapshot
                .into_iter()
                .flat_map(|s| &s.targets)
                .map(|target| target.identity.clone())
                .collect(),
            capabilities: snapshot
                .into_iter()
                .flat_map(|s| &s.targets)
                .flat_map(|t| &t.capabilities)
                .fold(Vec::new(), |mut all, capability| {
                    if !all.contains(capability) {
                        all.push(*capability);
                    }
                    all
                }),
            reason: if self
                .policy
                .as_ref()
                .is_some_and(|p| p.allow_browser_and_computer_use == Some(false))
            {
                Some("Computer Use is disabled by administrator policy".into())
            } else {
                snapshot.and_then(|s| s.reason.clone()).or_else(|| {
                    if disabled {
                        return Some("Computer Use is disabled in settings".into());
                    }
                    snapshot
                        .is_none()
                        .then(|| "No trusted adapter is installed".into())
                })
            },
            setup_steps: snapshot.map_or_else(Vec::new, |s| s.setup_steps.clone()),
            epoch: self.epoch,
        }
    }

    fn target(
        &self,
        kind: ComputerUseAdapterKind,
        identity: &ComputerUseTargetIdentity,
    ) -> ComputerUseResult<&ComputerUseTarget> {
        let snapshot = self
            .snapshots
            .get(&kind)
            .ok_or_else(|| denied("Adapter is not installed"))?;
        if snapshot.readiness != ComputerUseReadiness::Ready {
            return Err(denied("Adapter is not ready"));
        }
        snapshot
            .targets
            .iter()
            .find(|t| same_target(&t.identity, identity))
            .ok_or_else(|| denied("Target identity is not present in the trusted adapter"))
    }

    fn admit(
        &self,
        kind: ComputerUseAdapterKind,
        target: &ComputerUseTarget,
        scope: ComputerUseGrantScope,
        consent: bool,
    ) -> ComputerUseResult<()> {
        if kind == ComputerUseAdapterKind::Office && target.native_app.is_some() {
            return self
                .policy
                .as_ref()
                .ok_or_else(|| denied("Policy is not loaded"))?
                .check_office_native(target, scope, consent)
                .map_err(denied);
        }
        if kind != ComputerUseAdapterKind::Native {
            return self
                .policy
                .as_ref()
                .ok_or_else(|| denied("Policy is not loaded"))?
                .check_extension(&target.identity, scope, consent)
                .map_err(denied);
        }
        let identity = target
            .native_app
            .as_ref()
            .ok_or_else(|| denied("Verified native application identity is required"))?;
        if let (
            NativeAppIdentity::Macos { bundle_id },
            ComputerUseTargetIdentity::Native { app_id, .. },
        ) = (identity, &target.identity)
        {
            if bundle_id != app_id {
                return Err(denied("Native application identity mismatch"));
            }
        }
        self.policy
            .as_ref()
            .ok_or_else(|| denied("Policy is not loaded"))?
            .check(identity, target.locked, scope, consent)
            .map_err(denied)
    }
}

#[derive(Default)]
pub struct ComputerUseService {
    adapters: BTreeMap<ComputerUseAdapterKind, Arc<dyn ComputerUseAdapter>>,
    state: Arc<Mutex<State>>,
    broker: ControlBroker,
}

impl ComputerUseService {
    pub fn grants_for_connection(
        &self,
        connection: &str,
    ) -> ComputerUseResult<Vec<ComputerUseGrant>> {
        let mut grants = self
            .lock()?
            .grants
            .values()
            .filter(|grant| grant.connection == connection)
            .map(|grant| grant.response.clone())
            .collect::<Vec<_>>();
        grants.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(grants)
    }
    /// Composition is a trusted host operation; it is not exposed over JSON-RPC.
    pub fn with_adapter(mut self, adapter: Arc<dyn ComputerUseAdapter>) -> Self {
        self.adapters.insert(adapter.kind(), adapter);
        self
    }

    /// Trusted host/test composition only. Production hosts must share one per-user
    /// directory; this must not be derived from RPC, workspace or thread settings.
    pub fn with_control_directory(mut self, directory: PathBuf) -> Self {
        self.broker = ControlBroker::at(directory);
        self
    }

    fn lock(&self) -> ComputerUseResult<std::sync::MutexGuard<'_, State>> {
        self.state
            .lock()
            .map_err(|_| denied("Computer Use state is unavailable"))
    }

    async fn probe(&self, kind: ComputerUseAdapterKind) -> ComputerUseResult<()> {
        if let Some(adapter) = self.adapters.get(&kind) {
            match adapter.snapshot().await {
                Ok(snapshot) => self.lock()?.observe(kind, snapshot)?,
                Err(error) => {
                    let mut state = self.lock()?;
                    state.invalidate();
                    state.snapshots.remove(&kind);
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    pub async fn status(
        &self,
        params: ComputerUseStatusParams,
        load: impl Fn() -> ComputerUseResult<ComputerUsePolicy> + Send,
    ) -> ComputerUseResult<ComputerUseStatusResponse> {
        let kinds = params.adapter.map_or_else(
            || {
                vec![
                    ComputerUseAdapterKind::Native,
                    ComputerUseAdapterKind::Chrome,
                    ComputerUseAdapterKind::Office,
                ]
            },
            |kind| vec![kind],
        );
        {
            let mut state = self.lock()?;
            state.refresh(load())?;
            if state
                .policy
                .as_ref()
                .is_some_and(|p| p.allow_browser_and_computer_use == Some(false))
            {
                return Ok(ComputerUseStatusResponse {
                    grants: Vec::new(),
                    epoch: state.epoch,
                    adapters: kinds.iter().map(|kind| state.status(*kind)).collect(),
                });
            }
        }
        for kind in &kinds {
            if self.lock()?.status(*kind).readiness == ComputerUseReadiness::Disabled {
                continue;
            }
            self.probe(*kind).await?;
        }
        let mut state = self.lock()?;
        state.refresh(load())?;
        let adapters = kinds
            .into_iter()
            .map(|kind| {
                let mut status = state.status(kind);
                if let Some(target) = &params.target {
                    status
                        .targets
                        .retain(|candidate| same_target(candidate, target));
                }
                status
            })
            .collect();
        Ok(ComputerUseStatusResponse {
            grants: Vec::new(),
            epoch: state.epoch,
            adapters,
        })
    }

    pub async fn setup(
        &self,
        connection: &str,
        params: ComputerUseSetupParams,
        policy: impl ComputerUsePolicyStore,
    ) -> ComputerUseResult<ComputerUseSetupResponse> {
        // Check global authority before triggering installation or permission UI.
        {
            let mut state = self.lock()?;
            state.refresh(policy.load())?;
            if state
                .policy
                .as_ref()
                .unwrap()
                .allow_browser_and_computer_use
                == Some(false)
                || !state.policy.as_ref().unwrap().enabled(params.adapter)
            {
                return Ok(ComputerUseSetupResponse {
                    accepted: false,
                    status: state.status(params.adapter),
                    grant: None,
                });
            }
        }
        let preapproved = if let Some(requested) = &params.target {
            self.probe(params.adapter).await?;
            let mut state = self.lock()?;
            state.refresh(policy.load())?;
            state.target(params.adapter, requested).is_ok_and(|target| {
                state
                    .admit(params.adapter, target, params.grant_scope, false)
                    .is_ok()
            })
        } else {
            false
        };
        let outcome = if preapproved {
            ComputerUseSetupOutcome {
                accepted: true,
                ..Default::default()
            }
        } else {
            match self.adapters.get(&params.adapter) {
                Some(adapter) => adapter.setup(&params).await?,
                None => ComputerUseSetupOutcome::default(),
            }
        };
        self.probe(params.adapter).await?;
        let mut state = self.lock()?;
        state.refresh(policy.load())?;
        let mut status = state.status(params.adapter);
        let Some(requested) = &params.target else {
            return Ok(ComputerUseSetupResponse {
                accepted: outcome.accepted,
                status,
                grant: None,
            });
        };
        if !outcome.accepted || status.readiness != ComputerUseReadiness::Ready {
            return Ok(ComputerUseSetupResponse {
                accepted: outcome.accepted,
                status,
                grant: None,
            });
        }
        let target = state.target(params.adapter, requested)?.clone();
        let consent = (if let Some(revision) = &outcome.approved_revision {
            // A native consent snapshot may differ only in unrelated windows.
            // Session-stamped target revisions retire on any protected change.
            outcome.generation > 0
                && outcome.generation <= state.snapshots[&params.adapter].generation
                && target.revision.as_ref() == Some(revision)
        } else {
            state.snapshots[&params.adapter].generation == outcome.generation
        }) && outcome
            .approved_target
            .as_ref()
            .is_some_and(|approved| same_target(approved, &target.identity));
        if params.grant_scope == ComputerUseGrantScope::Persistent && consent {
            state.admit(
                params.adapter,
                &target,
                ComputerUseGrantScope::Session,
                true,
            )?;
            state
                .policy
                .as_ref()
                .unwrap()
                .with_persistent_approval(params.adapter, &target)
                .map_err(denied)?;
            // The host reloads and rechecks policy under the existing config lock.
            // No durable rule or grant may be created by an RPC-provided identity.
            policy.save_approval(params.adapter, &target)?;
            state.refresh(policy.load())?;
            status = state.status(params.adapter);
        }
        if let Err(error) = state.admit(params.adapter, &target, params.grant_scope, consent) {
            status.reason = Some(error.0);
            return Ok(ComputerUseSetupResponse {
                accepted: outcome.accepted,
                status,
                grant: None,
            });
        }
        if target.capabilities.is_empty() {
            return Err(denied("Target exposes no capabilities"));
        }
        let grant = ComputerUseGrant {
            id: Uuid::new_v4().to_string(),
            adapter: params.adapter,
            scope: params.grant_scope,
            target: target.identity.clone(),
            capabilities: target.capabilities.clone(),
            epoch: state.epoch,
        };
        state.grants.insert(
            grant.id.clone(),
            Grant {
                response: grant.clone(),
                connection: connection.into(),
                session_consent: consent,
            },
        );
        Ok(ComputerUseSetupResponse {
            accepted: outcome.accepted,
            status,
            grant: Some(grant),
        })
    }

    pub async fn acquire(
        &self,
        owner: ComputerUseOwner,
        params: ComputerUseLeaseAcquireParams,
        load: impl Fn() -> ComputerUseResult<ComputerUsePolicy> + Send,
    ) -> ComputerUseResult<ComputerUseLeaseAcquireResponse> {
        if owner.thread_id.is_empty()
            || owner.turn_id.is_empty()
            || owner.thread_id != params.thread_id
            || owner.turn_id != params.turn_id
        {
            return Err(denied("Lease requires a live thread and turn"));
        }
        self.probe(params.adapter).await?;
        let mut state = self.lock()?;
        state.refresh(load())?;
        let grant = params
            .grant_id
            .as_ref()
            .and_then(|id| state.grants.get(id))
            .ok_or_else(|| denied("An active grant is required"))?;
        if grant.connection != owner.connection
            || grant.response.epoch != state.epoch
            || grant.response.adapter != params.adapter
            || !same_target(&grant.response.target, &params.target)
            || !grant.response.capabilities.contains(&params.capability)
        {
            return Err(denied(
                "Grant does not cover this owner, target or capability",
            ));
        }
        let target = state.target(params.adapter, &params.target)?;
        state.admit(
            params.adapter,
            target,
            grant.response.scope,
            grant.session_consent,
        )?;
        if !target.capabilities.contains(&params.capability) {
            return Err(denied("Capability is not supported by this target"));
        }
        // Native input and screenshots share one resource across App Servers.
        if state
            .leases
            .values()
            .any(|lease| lease.response.adapter == params.adapter)
        {
            return Err(denied("Computer Use resource is busy"));
        }
        let control = Arc::new(self.broker.acquire()?);
        let response = ComputerUseLeaseAcquireResponse {
            lease_id: Uuid::new_v4().to_string(),
            adapter: params.adapter,
            target: target.identity.clone(),
            capability: params.capability,
            epoch: state.epoch,
        };
        let cancellation = CancellationToken::new();
        let expiry_cancellation = cancellation.clone();
        let expiry_state = Arc::downgrade(&self.state);
        let expiry_id = response.lease_id.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(LEASE_LIFETIME) => expiry_cancellation.cancel(),
                _ = expiry_cancellation.cancelled() => {}
            }
            if let Some(state) = expiry_state.upgrade() {
                if let Ok(mut state) = state.lock() {
                    state.leases.remove(&expiry_id);
                }
            }
        });
        state.leases.insert(
            response.lease_id.clone(),
            ComputerUseLease {
                response: response.clone(),
                owner,
                cancellation,
                expires: Instant::now() + LEASE_LIFETIME,
                control,
            },
        );
        Ok(response)
    }

    /// Every adapter action must revalidate immediately before performing side effects.
    pub async fn validate_lease(
        &self,
        owner: &ComputerUseOwner,
        id: &str,
        epoch: u64,
        load: impl Fn() -> ComputerUseResult<ComputerUsePolicy> + Send,
    ) -> ComputerUseResult<ComputerUseLease> {
        let kind = self
            .lock()?
            .leases
            .get(id)
            .map(|lease| lease.response.adapter)
            .ok_or_else(|| denied("Lease is not active"))?;
        self.probe(kind).await?;
        let mut state = self.lock()?;
        state.refresh(load())?;
        let lease = state
            .leases
            .get(id)
            .ok_or_else(|| denied("Lease is not active"))?;
        if &lease.owner != owner || lease.response.epoch != epoch || state.epoch != epoch {
            return Err(denied("Lease owner or fencing epoch does not match"));
        }
        Ok(lease.clone())
    }

    pub async fn execute(
        &self,
        owner: &ComputerUseOwner,
        id: &str,
        epoch: u64,
        action: ComputerUseAction,
        load: impl Fn() -> ComputerUseResult<ComputerUsePolicy> + Send,
    ) -> ComputerUseResult<serde_json::Value> {
        action.validate()?;
        let lease = self.validate_lease(owner, id, epoch, load).await?;
        if lease.response.capability != action.capability() {
            return Err(denied("Lease capability does not cover this action"));
        }
        if action.capability() == ComputerUseCapability::Navigate {
            if lease.response.adapter != ComputerUseAdapterKind::Chrome {
                return Err(denied("Browser task actions require the Chrome adapter"));
            }
            if let ComputerUseAction::CreateTab { url } = &action {
                let mut destination = lease.response.target.clone();
                if let ComputerUseTargetIdentity::Chrome {
                    origin,
                    url: target_url,
                    ..
                } = &mut destination
                {
                    let parsed = url::Url::parse(url).map_err(|_| denied("Invalid browser URL"))?;
                    *origin = parsed.origin().ascii_serialization();
                    *target_url = Some(url.clone());
                }
                self.lock()?
                    .policy
                    .as_ref()
                    .ok_or_else(|| denied("Policy is not loaded"))?
                    .check_extension(&destination, ComputerUseGrantScope::Session, true)
                    .map_err(denied)?;
            }
        }
        let adapter = self
            .adapters
            .get(&lease.response.adapter)
            .cloned()
            .ok_or_else(|| denied("Adapter is not installed"))?;
        let action_cancel = lease.cancellation.child_token();
        let cancel_on_drop = action_cancel.clone().drop_guard();
        // Keep the OS lock in an owned task if the tool/request future is dropped.
        // NativeHost kills and reaps the helper on cancellation before this task
        // drops the last in-flight lease reference and hands the desktop over.
        let task = tokio::spawn(async move {
            let result = if action_cancel.is_cancelled() {
                Err(denied("Computer Use action canceled"))
            } else {
                adapter.execute(&lease, action, action_cancel).await
            };
            drop(lease);
            result
        });
        let result = task
            .await
            .map_err(|_| denied("Computer Use action task failed; outcome unknown"))?;
        drop(cancel_on_drop);
        result
    }

    pub fn release(
        &self,
        connection: &str,
        id: &str,
    ) -> ComputerUseResult<ComputerUseLeaseReleaseResponse> {
        let mut state = self.lock()?;
        if state
            .leases
            .get(id)
            .is_some_and(|lease| lease.owner.connection != connection)
        {
            return Err(denied("Lease belongs to another connection"));
        }
        let lease = state.leases.remove(id);
        if let Some(lease) = &lease {
            lease.cancellation.cancel();
        }
        Ok(ComputerUseLeaseReleaseResponse {
            released: lease.is_some(),
            epoch: state.epoch,
        })
    }

    pub fn revoke(
        &self,
        connection: &str,
        id: &str,
    ) -> ComputerUseResult<ComputerUseRevokeResponse> {
        let mut state = self.lock()?;
        if state
            .grants
            .get(id)
            .is_some_and(|grant| grant.connection != connection)
        {
            return Err(denied("Grant belongs to another connection"));
        }
        let revoked = state.grants.contains_key(id);
        let owners = if revoked { state.owners() } else { vec![] };
        if revoked {
            state.invalidate();
        }
        let response = ComputerUseRevokeResponse {
            revoked,
            epoch: state.epoch,
        };
        drop(state);
        self.finish_turns(owners);
        Ok(response)
    }

    pub fn policy_changed(&self) {
        let mut owners = Vec::new();
        if let Ok(mut state) = self.state.lock() {
            owners = state.owners();
            state.invalidate();
            state.policy = None;
        }
        self.finish_turns(owners);
    }
}

impl Drop for ComputerUseService {
    fn drop(&mut self) {
        self.disconnect_all();
    }
}
