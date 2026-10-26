use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct ConsentAdapter {
    consent: bool,
    requests: Arc<AtomicUsize>,
}

#[async_trait]
impl ComputerUseAdapter for ConsentAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        ComputerUseAdapterKind::Native
    }
    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        TestAdapter.snapshot().await
    }
    async fn setup(
        &self,
        _: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        self.requests.fetch_add(1, Ordering::SeqCst);
        Ok(ComputerUseSetupOutcome {
            accepted: true,
            approved_target: self.consent.then(target),
            generation: 1,
            ..Default::default()
        })
    }
}

async fn server(root: &std::path::Path, consent: bool) -> (AppServer, Arc<AtomicUsize>) {
    let requests = Arc::new(AtomicUsize::new(0));
    let service = ComputerUseService::default()
        .with_control_directory(root.join("control"))
        .with_adapter(Arc::new(ConsentAdapter {
            consent,
            requests: requests.clone(),
        }));
    let server = AppServer::with_runtime(
        RuntimeCore::default()
            .with_app_config_path(root.join("config.yaml"))
            .with_requirements_path(root.join("requirements.toml"))
            .with_computer_use_service(service),
    );
    ok(
        &server,
        "initialize",
        json!({"clientInfo":{"name":"persistent-approval-fixture","version":"1"}}),
    )
    .await;
    server
        .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
        .await
        .unwrap();
    (server, requests)
}

fn config(root: &std::path::Path) {
    std::fs::write(root.join("config.yaml"), "# retain user comments\nserver:\n  api_key: test-only\ndefault_provider: custom-provider\nfeatures:\n  computer_use: true\n").unwrap();
}

#[tokio::test]
async fn persistent_approval_round_trips_restart_and_revokes_via_public_config() {
    let root = tempfile::tempdir().unwrap();
    config(root.path());
    let (first, prompts) = server(root.path(), true).await;
    let params = json!({"adapter":"native","target":target(),"grantScope":"persistent"});
    let approved = ok(&first, "computerUse/setup", params.clone()).await;
    assert_eq!(approved["grant"]["scope"], "persistent");
    assert_eq!(prompts.load(Ordering::SeqCst), 1);
    let saved = ok(&first, "config/read", json!({})).await;
    assert_eq!(
        saved["config"]["computer_use"]["macos"]["bundle_ids"],
        json!({"com.example.Editor":"allow"})
    );
    assert_eq!(saved["config"]["default_provider"], "custom-provider");
    assert!(saved["config"]["computer_use"]["default_app_access"].is_null());
    assert!(std::fs::read_to_string(root.path().join("config.yaml"))
        .unwrap()
        .contains("# retain user comments"));
    drop(first);

    let (restarted, prompts) = server(root.path(), false).await;
    let approved = ok(&restarted, "computerUse/setup", params.clone()).await;
    assert_eq!(approved["grant"]["scope"], "persistent");
    assert_eq!(prompts.load(Ordering::SeqCst), 0);
    ok(
        &restarted,
        "config/value/write",
        json!({"keyPath":"computer_use.macos.bundle_ids","value":{},"mergeStrategy":"replace"}),
    )
    .await;
    let status = ok(&restarted, "computerUse/status", json!({})).await;
    assert!(status["grants"]
        .as_array()
        .is_none_or(|grants| grants.is_empty()));
    let declined = ok(&restarted, "computerUse/setup", params).await;
    assert!(declined["grant"].is_null());
    assert_eq!(prompts.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn persistent_approval_never_saves_without_consent_or_against_admin_policy() {
    for case in ["no-consent", "admin-persistent", "admin-deny"] {
        let root = tempfile::tempdir().unwrap();
        config(root.path());
        if case != "no-consent" {
            std::fs::write(
                root.path().join("requirements.toml"),
                if case == "admin-deny" {
                    "[computer_use]\ndefault_app_access = 'deny'\n"
                } else {
                    "[computer_use]\nallow_persistent_approval = false\n"
                },
            )
            .unwrap();
        }
        let before = std::fs::read(root.path().join("config.yaml")).unwrap();
        let (server, _) = server(root.path(), case != "no-consent").await;
        let response = call(
            &server,
            "computerUse/setup",
            json!({"adapter":"native","target":target(),"grantScope":"persistent"}),
        )
        .await;
        assert!(
            response["error"].is_object() || response["result"]["grant"].is_null(),
            "{case}: {response}"
        );
        assert_eq!(
            std::fs::read(root.path().join("config.yaml")).unwrap(),
            before,
            "{case}"
        );
    }
}
