use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Default)]
struct Store {
    policy: Mutex<ComputerUsePolicy>,
    writes: AtomicUsize,
    fail: bool,
}

impl ComputerUsePolicyStore for &Store {
    fn load(&self) -> ComputerUseResult<ComputerUsePolicy> {
        Ok(self.policy.lock().unwrap().clone())
    }
    fn save_approval(
        &self,
        adapter: ComputerUseAdapterKind,
        target: &ComputerUseTarget,
    ) -> ComputerUseResult<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(denied("disk full"));
        }
        let mut policy = self.policy.lock().unwrap();
        *policy = policy
            .with_persistent_approval(adapter, target)
            .map_err(denied)?;
        Ok(())
    }
}

fn persistent() -> ComputerUseSetupParams {
    ComputerUseSetupParams {
        grant_scope: ComputerUseGrantScope::Persistent,
        ..setup()
    }
}

#[tokio::test]
async fn explicit_approval_survives_service_restart_and_removal_invalidates_control() {
    let store = Store::default();
    let (_dir, service) = isolated_service();
    let adapter = Arc::new(TestAdapter::new(true));
    let service = service.with_adapter(adapter.clone());
    let first = service
        .setup("local-1", persistent(), &store)
        .await
        .unwrap()
        .grant
        .unwrap();
    assert_eq!(first.scope, ComputerUseGrantScope::Persistent);
    let user = (&store).load().unwrap().user.unwrap();
    assert_eq!(user.default_app_access, None);
    assert_eq!(
        user.macos.unwrap().bundle_ids.unwrap(),
        std::collections::BTreeMap::from([("com.example.Editor".into(), Allow)])
    );
    assert_eq!(adapter.setup_count.load(Ordering::SeqCst), 1);
    drop(service);

    let (_dir, restarted) = isolated_service();
    let adapter = Arc::new(TestAdapter::new(false));
    let restarted = restarted.with_adapter(adapter.clone());
    let grant = restarted
        .setup("local-1", persistent(), &store)
        .await
        .unwrap()
        .grant
        .unwrap();
    assert_eq!(adapter.setup_count.load(Ordering::SeqCst), 0);
    assert_eq!(store.writes.load(Ordering::SeqCst), 1);
    let acquired = restarted
        .acquire(owner(), acquire(&grant), || (&store).load())
        .await
        .unwrap();
    let lease = restarted
        .validate_lease(&owner(), &acquired.lease_id, acquired.epoch, || {
            (&store).load()
        })
        .await
        .unwrap();
    store.policy.lock().unwrap().user = None;
    restarted
        .status(status(), || (&store).load())
        .await
        .unwrap();
    assert!(lease.cancellation.is_cancelled());
    assert!(restarted
        .acquire(owner(), acquire(&grant), || (&store).load())
        .await
        .is_err());
    assert!(restarted
        .setup("local-1", setup(), &store)
        .await
        .unwrap()
        .grant
        .is_none());
    assert_eq!(adapter.setup_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn persistence_requires_fresh_consent_and_successful_policy_checked_storage() {
    for case in [
        "no-consent",
        "stale",
        "user-deny",
        "admin-deny",
        "admin-persistent",
        "write-failed",
    ] {
        let store = Store {
            fail: case == "write-failed",
            ..Default::default()
        };
        {
            let mut policy = store.policy.lock().unwrap();
            match case {
                "user-deny" => {
                    policy.user = Some(ComputerUseConfigToml {
                        default_app_access: Some(Deny),
                        ..Default::default()
                    })
                }
                "admin-deny" => {
                    policy.admin = Some(ComputerUseRequirementsToml {
                        default_app_access: Some(Deny),
                        ..Default::default()
                    })
                }
                "admin-persistent" => {
                    policy.admin = Some(ComputerUseRequirementsToml {
                        allow_persistent_approval: Some(false),
                        ..Default::default()
                    })
                }
                _ => {}
            }
        }
        let before = (&store).load().unwrap();
        let (_dir, service) = isolated_service();
        let adapter = Arc::new(TestAdapter::new(case != "no-consent"));
        if case == "stale" {
            adapter.snapshot.lock().unwrap().generation = 2;
        }
        let result = service
            .with_adapter(adapter)
            .setup("local-1", persistent(), &store)
            .await;
        assert!(
            result.is_err() || result.as_ref().unwrap().grant.is_none(),
            "{case}: {result:?}"
        );
        assert_eq!((&store).load().unwrap(), before, "{case}");
        assert_eq!(
            store.writes.load(Ordering::SeqCst),
            usize::from(case == "write-failed"),
            "{case}"
        );
    }
}

#[test]
fn windows_rules_are_exact_and_wps_uses_its_independent_switch() {
    let mut app = TestAdapter::new(true)
        .snapshot
        .into_inner()
        .unwrap()
        .targets
        .remove(0);
    for aumid in [Some("Example!Editor".to_owned()), None] {
        app.native_app = Some(NativeAppIdentity::Windows {
            aumid: aumid.clone(),
            publisher_name: "CN=Example".into(),
            product_name: "Editor".into(),
            binary_name: "editor.exe".into(),
        });
        let policy = ComputerUsePolicy::default()
            .with_persistent_approval(ComputerUseAdapterKind::Native, &app)
            .unwrap();
        let windows = policy.user.unwrap().windows.unwrap();
        if let Some(aumid) = aumid {
            assert_eq!(
                windows.aumids.unwrap(),
                std::collections::BTreeMap::from([(aumid, Allow)])
            );
            assert!(windows.exes.is_none());
        } else {
            let rules = windows.exes.unwrap();
            assert_eq!(rules.len(), 1);
            assert_eq!(
                (
                    &rules[0].publisher_name[..],
                    &rules[0].product_name[..],
                    rules[0].binary_name.as_deref()
                ),
                ("CN=Example", "Editor", Some("editor.exe"))
            );
        }
    }
    app.native_app = Some(NativeAppIdentity::Macos {
        bundle_id: "com.kingsoft.wpsoffice.mac".into(),
    });
    app.identity = ComputerUseTargetIdentity::Office {
        host: "WPS".into(),
        session_id: "1".into(),
        workbook_id: "1".into(),
        workbook_name: None,
    };
    let policy = ComputerUsePolicy {
        native_enabled: Some(false),
        office_enabled: Some(true),
        ..Default::default()
    };
    let saved = policy
        .with_persistent_approval(ComputerUseAdapterKind::Office, &app)
        .unwrap();
    assert_eq!(saved.native_enabled, Some(false));
    assert!(saved
        .check_office_native(&app, ComputerUseGrantScope::Persistent, false)
        .is_ok());
    assert!(policy
        .with_persistent_approval(ComputerUseAdapterKind::Chrome, &app)
        .is_err());
}
