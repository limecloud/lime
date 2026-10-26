use super::*;
use lime_core::config::{ComputerUseConfigToml, ComputerUseRequirementsToml};
use lime_core::AllowDenyRequirementToml::{Allow, Deny};
use std::sync::{Arc, Mutex};

mod chrome;
mod native_snapshot;
mod persistent;
mod turn;

struct TestAdapter {
    snapshot: Mutex<ComputerUseSnapshot>,
    consent: bool,
    setup_count: std::sync::atomic::AtomicUsize,
    snapshot_count: std::sync::atomic::AtomicUsize,
}

impl TestAdapter {
    fn new(consent: bool) -> Self {
        Self {
            snapshot: Mutex::new(ComputerUseSnapshot {
                generation: 1,
                readiness: ComputerUseReadiness::Ready,
                targets: vec![ComputerUseTarget {
                    identity: target(),
                    revision: None,
                    native_app: Some(NativeAppIdentity::Macos {
                        bundle_id: "com.example.Editor".into(),
                    }),
                    capabilities: vec![
                        ComputerUseCapability::Observe,
                        ComputerUseCapability::Click,
                    ],
                    locked: false,
                }],
                reason: None,
                setup_steps: vec![],
            }),
            consent,
            setup_count: Default::default(),
            snapshot_count: Default::default(),
        }
    }
}

#[async_trait]
impl ComputerUseAdapter for TestAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }
    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        self.snapshot_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(self.snapshot.lock().unwrap().clone())
    }
    async fn setup(
        &self,
        _: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        self.setup_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(ComputerUseSetupOutcome {
            accepted: true,
            approved_target: self.consent.then(target),
            generation: 1,
            ..Default::default()
        })
    }
}

fn target() -> ComputerUseTargetIdentity {
    ComputerUseTargetIdentity::Native {
        app_id: "com.example.Editor".into(),
        process_id: Some(42),
        window_id: Some("12".into()),
        title: Some("Editor".into()),
    }
}
fn owner() -> ComputerUseOwner {
    ComputerUseOwner {
        connection: "local-1".into(),
        thread_id: "thread-1".into(),
        turn_id: "turn-1".into(),
    }
}
fn setup() -> ComputerUseSetupParams {
    ComputerUseSetupParams {
        adapter: ComputerUseAdapterKind::Native,
        target: Some(target()),
        grant_scope: ComputerUseGrantScope::Session,
    }
}
fn status() -> ComputerUseStatusParams {
    ComputerUseStatusParams {
        adapter: None,
        target: None,
    }
}
fn allow() -> ComputerUsePolicy {
    ComputerUsePolicy {
        user: Some(ComputerUseConfigToml {
            default_app_access: Some(Allow),
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn acquire(grant: &ComputerUseGrant) -> ComputerUseLeaseAcquireParams {
    ComputerUseLeaseAcquireParams {
        adapter: ComputerUseAdapterKind::Native,
        target: target(),
        thread_id: "thread-1".into(),
        turn_id: "turn-1".into(),
        capability: ComputerUseCapability::Click,
        grant_id: Some(grant.id.clone()),
    }
}
async fn grant(service: &ComputerUseService) -> ComputerUseGrant {
    service
        .setup("local-1", setup(), || Ok(allow()))
        .await
        .unwrap()
        .grant
        .unwrap()
}

fn isolated_service() -> (tempfile::TempDir, ComputerUseService) {
    let directory = tempfile::tempdir().unwrap();
    let service =
        ComputerUseService::default().with_control_directory(directory.path().join("computer-use"));
    (directory, service)
}

#[tokio::test]
async fn missing_driver_is_not_ready_and_never_grants() {
    let (_directory, service) = isolated_service();
    let statuses = service.status(status(), || Ok(allow())).await.unwrap();
    assert_eq!(statuses.adapters.len(), 3);
    assert!(statuses
        .adapters
        .iter()
        .all(|s| s.readiness == ComputerUseReadiness::NotInstalled));
    let result = service
        .setup("local-1", setup(), || Ok(allow()))
        .await
        .unwrap();
    assert!(!result.accepted && result.grant.is_none());
}

#[tokio::test]
async fn admin_disabled_prevents_setup_side_effects() {
    let adapter = Arc::new(TestAdapter::new(true));
    let (_directory, service) = isolated_service();
    let service = service.with_adapter(adapter.clone());
    let result = service
        .setup("local-1", setup(), || {
            Ok(ComputerUsePolicy {
                allow_browser_and_computer_use: Some(false),
                ..allow()
            })
        })
        .await
        .unwrap();
    assert_eq!(
        adapter
            .setup_count
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    assert_eq!(result.status.readiness, ComputerUseReadiness::Blocked);
    assert!(result.grant.is_none());
    let status = service
        .status(status(), || {
            Ok(ComputerUsePolicy {
                allow_browser_and_computer_use: Some(false),
                ..allow()
            })
        })
        .await
        .unwrap();
    assert!(status
        .adapters
        .iter()
        .all(|s| s.targets.is_empty() && s.capabilities.is_empty()));
    assert_eq!(
        adapter
            .snapshot_count
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn consent_is_required_and_cannot_override_admin_or_user_denials() {
    let (_directory, service) = isolated_service();
    let service = service.with_adapter(Arc::new(TestAdapter::new(false)));
    assert!(service
        .setup("local-1", setup(), || Ok(Default::default()))
        .await
        .unwrap()
        .grant
        .is_none());
    let (_directory, service) = isolated_service();
    let service = service.with_adapter(Arc::new(TestAdapter::new(true)));
    assert!(service
        .setup("local-1", setup(), || Ok(Default::default()))
        .await
        .unwrap()
        .grant
        .is_some());
    for policy in [
        ComputerUsePolicy {
            admin: Some(ComputerUseRequirementsToml {
                default_app_access: Some(Deny),
                ..Default::default()
            }),
            ..allow()
        },
        ComputerUsePolicy {
            user: Some(ComputerUseConfigToml {
                default_app_access: Some(Deny),
                ..Default::default()
            }),
            ..Default::default()
        },
    ] {
        assert!(service
            .setup("local-1", setup(), || Ok(policy.clone()))
            .await
            .unwrap()
            .grant
            .is_none());
    }
    let persistent = ComputerUseSetupParams {
        grant_scope: ComputerUseGrantScope::Persistent,
        ..setup()
    };
    assert!(service
        .setup("local-1", persistent, || Ok(Default::default()))
        .await
        .is_err());
}

#[tokio::test]
async fn lease_is_exclusive_owner_bound_and_revocation_cancels_inflight_work() {
    let (_directory, service) = isolated_service();
    let service = service.with_adapter(Arc::new(TestAdapter::new(false)));
    let grant = grant(&service).await;
    let acquired = service
        .acquire(owner(), acquire(&grant), || Ok(allow()))
        .await
        .unwrap();
    let lease = service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .unwrap();
    assert!(service
        .acquire(owner(), acquire(&grant), || Ok(allow()))
        .await
        .is_err());
    assert!(service.release("other-client", &acquired.lease_id).is_err());
    assert!(service.revoke("other-client", &grant.id).is_err());
    assert!(!lease.cancellation.is_cancelled());
    let revoked = service.revoke("local-1", &grant.id).unwrap();
    assert!(revoked.revoked && revoked.epoch > acquired.epoch);
    assert!(lease.cancellation.is_cancelled());
    assert!(service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .is_err());
    assert!(service
        .acquire(owner(), acquire(&grant), || Ok(allow()))
        .await
        .is_err());
}

#[tokio::test]
async fn policy_change_and_invalid_policy_cancel_old_leases() {
    for invalid in [false, true] {
        let (_directory, service) = isolated_service();
        let service = service.with_adapter(Arc::new(TestAdapter::new(false)));
        let grant = grant(&service).await;
        let acquired = service
            .acquire(owner(), acquire(&grant), || Ok(allow()))
            .await
            .unwrap();
        let lease = service
            .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
            .await
            .unwrap();
        let result = service
            .status(status(), || {
                if invalid {
                    Err(denied("Malformed administrator policy"))
                } else {
                    Ok(ComputerUsePolicy {
                        allow_browser_and_computer_use: Some(false),
                        ..allow()
                    })
                }
            })
            .await;
        assert_eq!(result.is_err(), invalid);
        assert!(lease.cancellation.is_cancelled());
    }
}

#[tokio::test]
async fn target_changes_and_disconnect_fence_old_consent_and_leases() {
    let adapter = Arc::new(TestAdapter::new(true));
    let (_directory, service) = isolated_service();
    let service = service.with_adapter(adapter.clone());
    let granted = grant(&service).await;
    let acquired = service
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .unwrap();
    let lease = service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .unwrap();
    adapter.snapshot.lock().unwrap().generation = 2;
    service.status(status(), || Ok(allow())).await.unwrap();
    assert!(lease.cancellation.is_cancelled());
    // The consent outcome belongs to generation 1, so generation 2 requires fresh consent.
    assert!(service
        .setup("local-1", setup(), || Ok(Default::default()))
        .await
        .unwrap()
        .grant
        .is_none());
    let granted = grant(&service).await;
    service.disconnect("local-1");
    assert!(service
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .is_err());
    adapter.snapshot.lock().unwrap().generation = 1;
    assert!(service.status(status(), || Ok(allow())).await.is_err());
}

#[tokio::test]
async fn separate_app_servers_wait_for_cancelled_inflight_action_to_finish() {
    let directory = tempfile::tempdir().unwrap();
    let service = || {
        ComputerUseService::default()
            .with_control_directory(directory.path().join("computer-use"))
            .with_adapter(Arc::new(TestAdapter::new(true)))
    };
    let first = service();
    let second = service();
    let first_grant = grant(&first).await;
    let second_grant = grant(&second).await;
    let acquired = first
        .acquire(owner(), acquire(&first_grant), || Ok(allow()))
        .await
        .unwrap();
    let inflight = first
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .unwrap();
    let old_fence = inflight.control_fence();
    assert!(second
        .acquire(owner(), acquire(&second_grant), || Ok(allow()))
        .await
        .unwrap_err()
        .0
        .contains("busy"));
    first.revoke("local-1", &first_grant.id).unwrap();
    assert!(inflight.cancellation.is_cancelled());
    // Revoke fences new work immediately, but cannot claim an OS action has
    // stopped until the action drops its validated lease reference.
    assert!(second
        .acquire(owner(), acquire(&second_grant), || Ok(allow()))
        .await
        .is_err());
    drop(inflight);
    let acquired = second
        .acquire(owner(), acquire(&second_grant), || Ok(allow()))
        .await
        .unwrap();
    let inflight = second
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .unwrap();
    assert!(inflight.control_fence() > old_fence);
    drop(second);
    assert!(inflight.cancellation.is_cancelled());
}

#[tokio::test]
async fn cancellation_releases_idle_control_without_another_rpc() {
    let (_directory, service) = isolated_service();
    let service = service.with_adapter(Arc::new(TestAdapter::new(true)));
    let granted = grant(&service).await;
    let acquired = service
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .unwrap();
    let lease = service
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || Ok(allow()))
        .await
        .unwrap();
    lease.cancellation.cancel();
    drop(lease);
    let observer = super::broker::ControlBroker::at(_directory.path().join("computer-use"));
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while observer.acquire().is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .unwrap();
}

#[tokio::test]
async fn dropped_action_future_keeps_control_until_adapter_confirms_stop() {
    struct SlowStop {
        inner: TestAdapter,
        started: tokio::sync::Notify,
        cancel_seen: tokio::sync::Notify,
        allow_stop: tokio::sync::Notify,
    }
    #[async_trait]
    impl ComputerUseAdapter for SlowStop {
        fn kind(&self) -> ComputerUseAdapterKind {
            ComputerUseAdapterKind::Native
        }
        async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
            self.inner.snapshot().await
        }
        async fn setup(
            &self,
            params: &ComputerUseSetupParams,
        ) -> ComputerUseResult<ComputerUseSetupOutcome> {
            self.inner.setup(params).await
        }
        async fn execute(
            &self,
            _: &ComputerUseLease,
            _: ComputerUseAction,
            cancel: tokio_util::sync::CancellationToken,
        ) -> ComputerUseResult<serde_json::Value> {
            self.started.notify_one();
            cancel.cancelled().await;
            self.cancel_seen.notify_one();
            self.allow_stop.notified().await;
            Err(denied("stopped with outcome_unknown"))
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let adapter = Arc::new(SlowStop {
        inner: TestAdapter::new(true),
        started: Default::default(),
        cancel_seen: Default::default(),
        allow_stop: Default::default(),
    });
    let first = Arc::new(
        ComputerUseService::default()
            .with_control_directory(directory.path().join("computer-use"))
            .with_adapter(adapter.clone()),
    );
    let second = ComputerUseService::default()
        .with_control_directory(directory.path().join("computer-use"))
        .with_adapter(Arc::new(TestAdapter::new(true)));
    let granted = grant(&first).await;
    let second_grant = grant(&second).await;
    let acquired = first
        .acquire(owner(), acquire(&granted), || Ok(allow()))
        .await
        .unwrap();
    assert!(first
        .execute(
            &owner(),
            &acquired.lease_id,
            acquired.epoch,
            ComputerUseAction::Screenshot {},
            || Ok(allow())
        )
        .await
        .is_err());
    let action_owner = first.clone();
    let task = tokio::spawn(async move {
        action_owner
            .execute(
                &owner(),
                &acquired.lease_id,
                acquired.epoch,
                ComputerUseAction::Click {
                    x: 1.0,
                    y: 1.0,
                    button: MouseButton::Left,
                    count: 1,
                },
                || Ok(allow()),
            )
            .await
    });
    adapter.started.notified().await;
    task.abort();
    let _ = task.await;
    adapter.cancel_seen.notified().await;
    first.revoke("local-1", &granted.id).unwrap();
    assert!(second
        .acquire(owner(), acquire(&second_grant), || Ok(allow()))
        .await
        .is_err());
    adapter.allow_stop.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if second
                .acquire(owner(), acquire(&second_grant), || Ok(allow()))
                .await
                .is_ok()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[test]
fn windows_identity_matching_and_admin_persistence_constraints() {
    use lime_core::config::{
        ComputerUseWindowsExeRequirementToml, ComputerUseWindowsRequirementsToml,
    };
    let identity = NativeAppIdentity::Windows {
        aumid: Some("Example!Editor".into()),
        publisher_name: "CN=Example".into(),
        product_name: "Editor".into(),
        binary_name: "EDITOR.EXE".into(),
    };
    let policy = ComputerUsePolicy {
        admin: Some(ComputerUseRequirementsToml {
            allow_persistent_approval: Some(false),
            windows: Some(ComputerUseWindowsRequirementsToml {
                aumids: Some([("Example!Editor".into(), Allow)].into()),
                exes: Some(vec![ComputerUseWindowsExeRequirementToml {
                    publisher_name: "CN=Example".into(),
                    product_name: "Editor".into(),
                    binary_name: Some("editor.exe".into()),
                    access: Deny,
                }]),
            }),
            ..Default::default()
        }),
        ..allow()
    };
    assert!(policy
        .check(&identity, false, ComputerUseGrantScope::Session, true)
        .is_err());
    assert!(policy
        .check(&identity, false, ComputerUseGrantScope::Persistent, true)
        .is_err());
    assert!(allow()
        .check(&identity, true, ComputerUseGrantScope::Session, true)
        .is_err());
    assert!(allow()
        .check(&identity, false, ComputerUseGrantScope::Session, false)
        .is_ok());
    let unknown_publisher = NativeAppIdentity::Windows {
        aumid: None,
        publisher_name: String::new(),
        product_name: "Editor".into(),
        binary_name: "editor.exe".into(),
    };
    assert!(allow()
        .check(
            &unknown_publisher,
            false,
            ComputerUseGrantScope::Session,
            true
        )
        .is_err());
}
