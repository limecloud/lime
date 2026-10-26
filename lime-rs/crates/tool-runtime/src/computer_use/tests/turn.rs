use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct ActionAdapter {
    inner: TestAdapter,
    calls: AtomicUsize,
    interrupted: std::sync::atomic::AtomicBool,
    finished: Mutex<Vec<ComputerUseOwner>>,
    probe_gate: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
}

#[async_trait]
impl ComputerUseAdapter for ActionAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }
    fn finish_turn(&self, owner: &ComputerUseOwner) {
        self.finished.lock().unwrap().push(owner.clone());
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
        if self.interrupted.load(Ordering::SeqCst) {
            return Err(ComputerUseError::interrupted("User took control".into()));
        }
        Ok(serde_json::json!({"status":"submitted"}))
    }
}

fn fixture() -> (tempfile::TempDir, ComputerUseService, Arc<ActionAdapter>) {
    let (directory, service) = isolated_service();
    let adapter = Arc::new(ActionAdapter {
        inner: TestAdapter::new(true),
        calls: AtomicUsize::new(0),
        interrupted: Default::default(),
        finished: Default::default(),
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
async fn takeover_revokes_turn_admission_and_releases_control_for_explicit_new_turn() {
    let (_directory, service, adapter) = fixture();
    grant(&service).await;
    service.bind_turn(owner()).unwrap();
    adapter.interrupted.store(true, Ordering::SeqCst);
    assert!(service
        .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
        .await
        .unwrap_err()
        .is_interrupted());
    assert!(service
        .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
        .await
        .is_err());
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 1);
    let mut next = owner();
    next.turn_id = "explicit-resume".into();
    service.bind_turn(next).unwrap();
    adapter.interrupted.store(false, Ordering::SeqCst);
    assert!(service
        .execute_for_turn("thread-1", "explicit-resume", target(), observe(), || Ok(
            allow()
        ))
        .await
        .is_ok());
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 2);
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
    let mut next = owner();
    next.turn_id = "turn-2".into();
    assert_eq!(*adapter.finished.lock().unwrap(), vec![owner(), next]);
}

#[tokio::test]
async fn presentation_outlives_one_action_but_finishes_on_revocation_or_policy_change() {
    for policy_change in [false, true] {
        let (directory, service, adapter) = fixture();
        let grant = grant(&service).await;
        service.bind_turn(owner()).unwrap();
        service
            .execute_for_turn("thread-1", "turn-1", target(), observe(), || Ok(allow()))
            .await
            .unwrap();
        let available =
            super::super::broker::ControlBroker::at(directory.path().join("computer-use"))
                .acquire()
                .expect("presentation must not hold the OS input lease");
        drop(available);
        assert!(
            adapter.finished.lock().unwrap().is_empty(),
            "one tool result is not the task terminal"
        );
        if policy_change {
            service.policy_changed();
        } else {
            service.revoke("local-1", &grant.id).unwrap();
        }
        assert_eq!(
            *adapter.finished.lock().unwrap(),
            vec![owner()],
            "idle presentation must close immediately"
        );
    }
}

#[tokio::test]
async fn disconnect_closes_all_presentations_when_it_invalidates_global_authority() {
    let (_directory, service, adapter) = fixture();
    grant(&service).await;
    let first = owner();
    let second = ComputerUseOwner {
        connection: "connection-b".into(),
        thread_id: "thread-b".into(),
        turn_id: "turn-b".into(),
    };
    service.bind_turn(first.clone()).unwrap();
    service.bind_turn(second.clone()).unwrap();
    service.disconnect(&first.connection);
    let finished = adapter.finished.lock().unwrap();
    assert_eq!(finished.len(), 2);
    assert!(finished.contains(&first) && finished.contains(&second));
}
