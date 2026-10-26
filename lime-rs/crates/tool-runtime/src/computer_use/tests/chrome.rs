use super::*;
use serde_json::json;

struct ChromeAdapter {
    snapshot: Mutex<ComputerUseSnapshot>,
    calls: Mutex<Vec<ComputerUseOwner>>,
    finished: Mutex<Vec<ComputerUseOwner>>,
}

#[async_trait]
impl ComputerUseAdapter for ChromeAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Chrome
    }
    fn finish_turn(&self, owner: &ComputerUseOwner) {
        self.finished.lock().unwrap().push(owner.clone());
    }
    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        Ok(self.snapshot.lock().unwrap().clone())
    }
    async fn setup(
        &self,
        params: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        Ok(ComputerUseSetupOutcome {
            accepted: true,
            approved_target: params.target.clone(),
            generation: self.snapshot.lock().unwrap().generation,
            ..Default::default()
        })
    }
    async fn execute(
        &self,
        lease: &ComputerUseLease,
        _: ComputerUseAction,
        _: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        self.calls.lock().unwrap().push(lease.owner.clone());
        Ok(json!({"status":"submitted"}))
    }
}

fn chrome_target(id: &str) -> ComputerUseTarget {
    serde_json::from_value(json!({
        "identity":{"type":"chrome","origin":"https://example.test","profileId":"profile","tabId":id,"url":"https://example.test/"},
        "nativeApp":null,"locked":false,"capabilities":["observe","navigate"]
    })).unwrap()
}

async fn fixture() -> (
    tempfile::TempDir,
    ComputerUseService,
    Arc<ChromeAdapter>,
    ComputerUseGrant,
) {
    let (directory, service) = isolated_service();
    let adapter = Arc::new(ChromeAdapter {
        snapshot: Mutex::new(ComputerUseSnapshot {
            generation: 1,
            readiness: ComputerUseReadiness::Ready,
            targets: vec![chrome_target("1")],
            reason: None,
            setup_steps: vec![],
        }),
        calls: Default::default(),
        finished: Default::default(),
    });
    let service = service.with_adapter(adapter.clone());
    service.bind_turn(owner()).unwrap();
    let grant = service
        .setup(
            "local-1",
            ComputerUseSetupParams {
                adapter: ComputerUseAdapterKind::Chrome,
                target: Some(chrome_target("1").identity),
                grant_scope: ComputerUseGrantScope::Session,
            },
            || Ok(allow()),
        )
        .await
        .unwrap()
        .grant
        .unwrap();
    (directory, service, adapter, grant)
}

#[tokio::test]
async fn added_tabs_keep_source_authority_without_inheriting_the_source_grant() {
    let (_dir, service, adapter, grant) = fixture().await;
    adapter
        .snapshot
        .lock()
        .unwrap()
        .targets
        .push(chrome_target("2"));
    let result = service
        .execute_for_turn(
            "thread-1",
            "turn-1",
            chrome_target("1").identity,
            ComputerUseAction::NameSession {
                name: "🧪 Task".into(),
            },
            || Ok(allow()),
        )
        .await;
    assert!(result.is_ok(), "{result:?}");
    assert!(service
        .execute_for_turn(
            "thread-1",
            "turn-1",
            chrome_target("2").identity,
            ComputerUseAction::Observe {
                max_depth: 2,
                max_nodes: 16
            },
            || Ok(allow())
        )
        .await
        .is_err());
    assert_eq!(
        service.grants_for_connection("local-1").unwrap(),
        vec![grant]
    );
    assert_eq!(*adapter.calls.lock().unwrap(), vec![owner()]);
}

#[tokio::test]
async fn reload_navigation_or_duplicate_targets_cannot_masquerade_as_additions() {
    for change in ["reload", "navigation", "duplicate", "capability", "removal"] {
        let (_dir, service, adapter, _grant) = fixture().await;
        {
            let mut snapshot = adapter.snapshot.lock().unwrap();
            snapshot.targets.push(chrome_target("2"));
            match change {
                "reload" => snapshot.generation += 1,
                "navigation" => {
                    if let ComputerUseTargetIdentity::Chrome { url, .. } =
                        &mut snapshot.targets[0].identity
                    {
                        *url = Some("https://example.test/changed".into());
                    }
                }
                "duplicate" => snapshot.targets.push(chrome_target("1")),
                "capability" => snapshot.targets[0].capabilities.clear(),
                "removal" => {
                    snapshot.targets.remove(0);
                }
                _ => unreachable!(),
            }
        }
        assert!(
            service
                .execute_for_turn(
                    "thread-1",
                    "turn-1",
                    chrome_target("1").identity,
                    ComputerUseAction::NameSession {
                        name: "Task".into()
                    },
                    || Ok(allow())
                )
                .await
                .is_err(),
            "{change}"
        );
        assert!(
            service.grants_for_connection("local-1").unwrap().is_empty(),
            "{change}"
        );
        assert!(adapter.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn destination_origin_denials_are_checked_before_creating_a_page() {
    let (_dir, service, adapter, _grant) = fixture().await;
    let policy = || {
        let mut policy = allow();
        policy.browser_admin = Some(
            serde_json::from_value(json!({"origins":{"https://blocked.test":{"access":"deny"}}}))
                .unwrap(),
        );
        Ok(policy)
    };
    // The policy update requires a fresh source grant, not implicit reapproval.
    service
        .setup(
            "local-1",
            ComputerUseSetupParams {
                adapter: ComputerUseAdapterKind::Chrome,
                target: Some(chrome_target("1").identity),
                grant_scope: ComputerUseGrantScope::Session,
            },
            policy,
        )
        .await
        .unwrap();
    let result = service
        .execute_for_turn(
            "thread-1",
            "turn-1",
            chrome_target("1").identity,
            ComputerUseAction::CreateTab {
                url: "https://blocked.test/private".into(),
            },
            policy,
        )
        .await;
    assert!(result.unwrap_err().0.contains("denied by policy"));
    assert!(adapter.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn terminal_and_disconnect_notify_only_trusted_bound_owners_once() {
    let (_dir, service, adapter, _grant) = fixture().await;
    service.cancel_turn("thread-1", "turn-1");
    service.cancel_turn("thread-1", "turn-1");
    let next = ComputerUseOwner {
        turn_id: "turn-2".into(),
        ..owner()
    };
    service.bind_turn(next.clone()).unwrap();
    service.disconnect("unrelated");
    service.disconnect("local-1");
    service.disconnect_all();
    assert_eq!(*adapter.finished.lock().unwrap(), vec![owner(), next]);
}
