use super::*;

pub(super) fn unique_native_targets(snapshot: &ComputerUseSnapshot) -> bool {
    snapshot.targets.iter().enumerate().all(|(index, target)| {
        matches!(target.identity, ComputerUseTargetIdentity::Native { .. })
            && same_target(&target.identity, &target.identity)
            && !snapshot.targets[..index]
                .iter()
                .any(|previous| same_target(&previous.identity, &target.identity))
    })
}

fn native_session(snapshot: &ComputerUseSnapshot) -> Option<u64> {
    let mut session = None;
    for target in &snapshot.targets {
        let (owner, revision) = target.revision.as_deref()?.split_once(':')?;
        let owner = owner.parse::<u64>().ok().filter(|value| *value > 0)?;
        revision.parse::<u64>().ok().filter(|value| *value > 0)?;
        if session.is_some_and(|previous| previous != owner) {
            return None;
        }
        session = Some(owner);
    }
    session
}

pub(super) fn retained_native_targets(
    previous: &ComputerUseSnapshot,
    next: &ComputerUseSnapshot,
) -> Option<Vec<ComputerUseTargetIdentity>> {
    if next.generation <= previous.generation
        || previous.readiness != ComputerUseReadiness::Ready
        || next.readiness != ComputerUseReadiness::Ready
        || previous.reason != next.reason
        || previous.setup_steps != next.setup_steps
        || native_session(previous)? != native_session(next)?
    {
        return None;
    }
    let retained: Vec<_> = previous
        .targets
        .iter()
        .filter(|target| next.targets.contains(target))
        .map(|target| target.identity.clone())
        .collect();
    (!retained.is_empty()).then_some(retained)
}

impl State {
    pub(super) fn retain_native_authority(&mut self, targets: &[ComputerUseTargetIdentity]) {
        let retained = |identity: &ComputerUseTargetIdentity| {
            targets.iter().any(|target| same_target(target, identity))
        };
        self.grants.retain(|_, grant| {
            grant.response.adapter != ComputerUseAdapterKind::Native
                || retained(&grant.response.target)
        });
        self.leases.retain(|_, lease| {
            if lease.response.adapter != ComputerUseAdapterKind::Native
                || retained(&lease.response.target)
            {
                return true;
            }
            lease.cancellation.cancel();
            false
        });
    }
}
