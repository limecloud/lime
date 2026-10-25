use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct ActionAdapter {
    inner: TestAdapter,
    calls: AtomicUsize,
    probe_gate: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
}

#[async_trait]
impl ComputerUseAdapter for ActionAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }
    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        let gate = self.probe_gate.lock().unwrap().take();
        if let Some((entered, release)) = gate {
            entered.notify_one();
            release.notified().await;
        }
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
        _: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(serde_json::json!({"status":"submitted"}))
    }
}

fn fixture() -> (tempfile::TempDir, ComputerUseService, Arc<ActionAdapter>) {
    let (directory, service) = isolated_service();
    let adapter = Arc::new(ActionAdapter {
        inner: TestAdapter::new(true),
        calls: AtomicUsize::new(0),
        probe_gate: Mutex::new(None),
    });
    (directory, service.with_adapter(adapter.clone()), adapter)
}

#[tokio::test]
async fn cancellation_during_probe_cannot_leave_an_automatic_lease_or_execute_input() {
    let (_directory, service, adapter) = fixture();
    grant(&service).await;
    service.bind_turn(owner()).unwrap();
    let service = Arc::new(service);
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *adapter.probe_gate.lock().unwrap() = Some((entered.clone(), release.clone()));
    let task = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
                .await
        }
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    service.cancel_turn("thread-1", "turn-1");
    release.notify_one();
    assert!(task.await.unwrap().is_err());
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 0);
    let mut next = owner();
    next.turn_id = "turn-2".into();
    service.bind_turn(next).unwrap();
    assert!(
        service
            .execute_for_turn("thread-1", "turn-2", target(), observe(), || Ok(allow()))
            .await
            .is_ok(),
        "the canceled admission must release its OS lease"
    );
}

fn observe() -> ComputerUseAction {
    ComputerUseAction::Observe {
        max_depth: 2,
        max_nodes: 32,
    }
}

#[tokio::test]
async fn automatic_lease_requires_the_bound_connections_existing_grant() {
    let (_directory, service, adapter) = fixture();
    grant(&service).await;
    assert!(service
        .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
        .await
        .is_err());
    let mut other = owner();
    other.connection = "another-connection".into();
    service.bind_turn(other).unwrap();
    assert!(
        service.bind_turn(owner()).is_err(),
        "turn authority must not be rebound"
    );
    assert!(service
        .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
        .await
        .is_err());
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn automatic_lease_releases_each_action_and_revocation_prevents_more_input() {
    let (_directory, service, adapter) = fixture();
    service.bind_turn(owner()).unwrap();
    assert!(
        service
            .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
            .await
            .is_err(),
        "no implicit setup or consent"
    );
    let grant = grant(&service).await;
    for action in [
        observe(),
        ComputerUseAction::Click {
            x: 1.0,
            y: 2.0,
            button: MouseButton::Left,
            count: 1,
        },
        observe(),
    ] {
        assert_eq!(
            service
                .execute_for_turn("thread-1", "turn-1", target(), action, || Ok(allow()))
                .await
                .unwrap()["status"],
            "submitted"
        );
    }
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 3);
    service.revoke("local-1", &grant.id).unwrap();
    assert!(service
        .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
        .await
        .is_err());
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn terminal_turn_and_disconnect_remove_automatic_action_authority() {
    let (_directory, service, adapter) = fixture();
    grant(&service).await;
    service.bind_turn(owner()).unwrap();
    service.cancel_turn("thread-1", "turn-1");
    assert!(service
        .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
        .await
        .is_err());
    let mut next = owner();
    next.turn_id = "turn-2".into();
    service.bind_turn(next).unwrap();
    service.disconnect("local-1");
    assert!(service
        .execute_for_turn("thread-1", "turn-2", target(), observe(), || Ok(allow()))
        .await
        .is_err());
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 0);
}
