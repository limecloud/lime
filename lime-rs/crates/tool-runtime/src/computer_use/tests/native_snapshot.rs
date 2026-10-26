use super::*;

struct ConsentChurnAdapter {
    inner: TestAdapter,
    change: &'static str,
    confirmed: Mutex<bool>,
}

#[async_trait]
impl ComputerUseAdapter for ConsentChurnAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }
    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        if std::mem::take(&mut *self.confirmed.lock().unwrap()) {
            let other = other_target(&self.inner);
            let mut snapshot = self.inner.snapshot.lock().unwrap();
            snapshot.generation += 1;
            match self.change {
                "unrelated" => snapshot.targets.push(other),
                "revision" => snapshot.targets[0].revision = Some("1:3".into()),
                "helper_restart" => snapshot.targets[0].revision = Some("2:1".into()),
                "missing_revision" => snapshot.targets[0].revision = None,
                "disappearance" => snapshot.targets.clear(),
                "permission" => snapshot.readiness = ComputerUseReadiness::PermissionRequired,
                "locked" => snapshot.targets[0].locked = true,
                _ => unreachable!(),
            }
        }
        self.inner.snapshot().await
    }
    async fn setup(
        &self,
        _: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        let snapshot = self.inner.snapshot.lock().unwrap();
        let approved = &snapshot.targets[0];
        *self.confirmed.lock().unwrap() = true;
        Ok(ComputerUseSetupOutcome {
            accepted: true,
            approved_target: Some(approved.identity.clone()),
            approved_revision: approved.revision.clone(),
            generation: snapshot.generation,
        })
    }
}

#[tokio::test]
async fn native_consent_survives_only_unrelated_snapshot_changes() {
    for change in [
        "unrelated",
        "revision",
        "helper_restart",
        "missing_revision",
        "disappearance",
        "permission",
        "locked",
    ] {
        let adapter = ConsentChurnAdapter {
            inner: TestAdapter::new(true),
            change,
            confirmed: Mutex::new(false),
        };
        adapter.inner.snapshot.lock().unwrap().targets[0].revision = Some("1:1".into());
        let (_directory, service) = isolated_service();
        let service = service.with_adapter(Arc::new(adapter));
        let granted = service
            .setup("local-1", setup(), || Ok(ComputerUsePolicy::default()))
            .await
            .ok()
            .and_then(|result| result.grant);
        assert_eq!(
            granted.is_some(),
            change == "unrelated",
            "consent continuity: {change}"
        );
        if let Some(granted) = granted {
            assert_eq!(granted.target, target());
            assert!(service
                .acquire(owner(), acquire(&granted), || Ok(
                    ComputerUsePolicy::default()
                ))
                .await
                .is_ok());
        }
    }
}

#[test]
fn helper_json_cannot_supply_adapter_only_consent_proof() {
    assert!(
        serde_json::from_value::<ComputerUseSetupOutcome>(serde_json::json!({
            "accepted":true, "approvedTarget":null, "generation":1, "approvedRevision":"1:1"
        }))
        .is_err()
    );
}

fn other_target(adapter: &TestAdapter) -> ComputerUseTarget {
    let mut other = adapter.snapshot.lock().unwrap().targets[0].clone();
    if let ComputerUseTargetIdentity::Native {
        window_id, title, ..
    } = &mut other.identity
    {
        *window_id = Some("99".into());
        *title = Some("Unrelated window".into());
    }
    other.revision = Some("1:2".into());
    other
}

async fn fixture(
    with_other: bool,
) -> (
    tempfile::TempDir,
    ComputerUseService,
    Arc<TestAdapter>,
    ComputerUseGrant,
    ComputerUseLeaseAcquireResponse,
) {
    let adapter = Arc::new(TestAdapter::new(true));
    adapter.snapshot.lock().unwrap().targets[0].revision = Some("1:1".into());
    if with_other {
        let other = other_target(&adapter);
        adapter.snapshot.lock().unwrap().targets.push(other);
    }
    let (directory, service) = isolated_service();
    let service = service.with_adapter(adapter.clone());
    let granted = grant(&service).await;
    let acquired = service
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .unwrap();
    (directory, service, adapter, granted, acquired)
}

#[tokio::test]
async fn unrelated_windows_do_not_revoke_a_continuous_approved_target() {
    let (_directory, service, adapter, granted, acquired) = fixture(false).await;
    let other = other_target(&adapter);
    {
        let mut snapshot = adapter.snapshot.lock().unwrap();
        snapshot.generation += 1;
        snapshot.targets.push(other.clone());
    }
    let lease = service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .expect("unrelated added window must not revoke the approved target");
    assert!(!lease.cancellation.is_cancelled());
    assert_eq!(
        service.grants_for_connection("local-1").unwrap(),
        vec![granted.clone()]
    );
    assert!(
        service
            .acquire(
                owner(),
                ComputerUseLeaseAcquireParams {
                    target: other.identity,
                    ..acquire(&granted)
                },
                || Ok(allow())
            )
            .await
            .is_err(),
        "a new window must not inherit consent"
    );
    {
        let mut snapshot = adapter.snapshot.lock().unwrap();
        snapshot.generation += 1;
        snapshot.targets.pop();
    }
    assert!(service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .is_ok());
    assert!(!lease.cancellation.is_cancelled());
}

#[tokio::test]
async fn protected_target_changes_and_unsafe_snapshots_cancel_old_authority() {
    for change in [
        "revision",
        "document",
        "identity",
        "capability",
        "locked",
        "removal",
        "helper_restart",
        "permission",
        "duplicate",
        "missing_revision",
        "same_generation",
        "zero_generation",
    ] {
        let (_directory, service, adapter, _grant, acquired) = fixture(false).await;
        let lease = service
            .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
            .await
            .unwrap();
        let other = other_target(&adapter);
        {
            let mut snapshot = adapter.snapshot.lock().unwrap();
            snapshot.generation += 1;
            snapshot.targets.push(other);
            match change {
                "revision" => snapshot.targets[0].revision = Some("1:3".into()),
                "document" => {
                    if let ComputerUseTargetIdentity::Native { title, .. } =
                        &mut snapshot.targets[0].identity
                    {
                        *title = Some("Different document".into());
                    }
                }
                "identity" => {
                    snapshot.targets[0].native_app = Some(NativeAppIdentity::Macos {
                        bundle_id: "other.application".into(),
                    })
                }
                "capability" => snapshot.targets[0].capabilities.clear(),
                "locked" => snapshot.targets[0].locked = true,
                "removal" => {
                    snapshot.targets.remove(0);
                }
                "helper_restart" => {
                    for (index, target) in snapshot.targets.iter_mut().enumerate() {
                        target.revision = Some(format!("2:{}", index + 1));
                    }
                }
                "permission" => snapshot.readiness = ComputerUseReadiness::PermissionRequired,
                "duplicate" => {
                    let duplicate = snapshot.targets[0].clone();
                    snapshot.targets.push(duplicate);
                }
                "missing_revision" => snapshot.targets[0].revision = None,
                "same_generation" => snapshot.generation -= 1,
                "zero_generation" => snapshot.generation = 0,
                _ => unreachable!(),
            }
        }
        assert!(
            service
                .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
                .await
                .is_err(),
            "{change}"
        );
        assert!(lease.cancellation.is_cancelled(), "{change}");
        assert!(
            service.grants_for_connection("local-1").unwrap().is_empty(),
            "{change}"
        );
    }
}

#[tokio::test]
async fn a_disappeared_target_cannot_recover_its_old_grant_when_it_returns() {
    let (_directory, service, adapter, granted, acquired) = fixture(false).await;
    let original = adapter.snapshot.lock().unwrap().targets[0].clone();
    let other = other_target(&adapter);
    {
        let mut snapshot = adapter.snapshot.lock().unwrap();
        snapshot.generation += 1;
        snapshot.targets = vec![other];
    }
    service.status(status(), || Ok(allow())).await.unwrap();
    {
        let mut snapshot = adapter.snapshot.lock().unwrap();
        snapshot.generation += 1;
        snapshot.targets.push(original);
    }
    assert!(service
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .is_err());
    assert!(service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .is_err());
}

#[tokio::test]
async fn only_the_changed_windows_grants_are_removed() {
    let (_directory, service, adapter, first_grant, acquired) = fixture(true).await;
    let other = other_target(&adapter);
    let second_grant = service
        .setup(
            "local-1",
            ComputerUseSetupParams {
                target: Some(other.identity.clone()),
                ..setup()
            },
            || Ok(allow()),
        )
        .await
        .unwrap()
        .grant
        .unwrap();
    {
        let mut snapshot = adapter.snapshot.lock().unwrap();
        snapshot.generation += 1;
        snapshot.targets[1].revision = Some("1:3".into());
    }
    let retained = service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .unwrap();
    assert!(!retained.cancellation.is_cancelled());
    assert_eq!(
        service.grants_for_connection("local-1").unwrap(),
        vec![first_grant]
    );
    service.release("local-1", &acquired.lease_id).unwrap();
    drop(retained);
    assert!(service
        .acquire(
            owner(),
            ComputerUseLeaseAcquireParams {
                target: other.identity,
                grant_id: Some(second_grant.id.clone()),
                ..acquire(&second_grant)
            },
            || Ok(allow())
        )
        .await
        .is_err());
}
