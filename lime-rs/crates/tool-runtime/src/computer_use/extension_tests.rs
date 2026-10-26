use super::*;
use crate::computer_use::extension_host::exchange;
use crate::computer_use::mailbox;
use tokio_util::sync::CancellationToken;

fn fixture() -> (tempfile::TempDir, ExtensionAdapter, PathBuf, Value) {
    let temp = tempfile::tempdir().unwrap();
    let paths = ComputerUsePaths {
        root: temp.path().to_owned(),
        chrome_manifest: temp.path().join("native-host.json"),
        excel_sideload: None,
    };
    let root = paths.sessions().join(Uuid::new_v4().to_string());
    for path in [&root, &root.join("requests"), &root.join("responses")] {
        mailbox::private_directory(path).unwrap();
    }
    let adapter = ExtensionAdapter::new(ComputerUseAdapterKind::Chrome, paths);
    let message = json!({"snapshot":{"generation":1,"readiness":"ready","targets":[{"identity":{"type":"chrome","origin":"https://example.test","profileId":"profile-a","tabId":"1","url":"https://example.test/"},"nativeApp":null,"locked":false,"capabilities":["observe","type"]}],"reason":null,"setupSteps":[]},"responses":[]});
    exchange(&root, message.clone(), "chrome").unwrap();
    (temp, adapter, root, message)
}

#[tokio::test]
async fn readiness_uses_the_host_supplied_installation_and_mailbox() {
    let (temp, adapter, root, message) = fixture();
    fs::remove_dir_all(&root).unwrap();
    let absent = adapter.snapshot().await.unwrap();
    assert_eq!(absent.readiness, ComputerUseReadiness::NotInstalled);
    fs::write(temp.path().join("native-host.json"), b"{}").unwrap();
    let installed = adapter.snapshot().await.unwrap();
    assert_eq!(installed.readiness, ComputerUseReadiness::Disconnected);
    assert!(installed.generation > absent.generation);
    for path in [&root, &root.join("requests"), &root.join("responses")] {
        mailbox::private_directory(path).unwrap();
    }
    exchange(&root, message, "chrome").unwrap();
    let connected = adapter.snapshot().await.unwrap();
    assert_eq!(connected.readiness, ComputerUseReadiness::Ready);
    assert_eq!(connected.targets.len(), 1);
    assert!(connected.generation > installed.generation);
}

#[tokio::test]
async fn navigation_disconnect_and_expired_heartbeat_advance_authority() {
    let (_temp, adapter, root, mut message) = fixture();
    let first = adapter.snapshot().await.unwrap();
    assert_eq!(first.readiness, ComputerUseReadiness::Ready);
    message["snapshot"]["generation"] = json!(2);
    message["snapshot"]["targets"][0]["identity"]["url"] = json!("https://example.test/next");
    exchange(&root, message, "chrome").unwrap();
    let second = adapter.snapshot().await.unwrap();
    assert!(second.generation > first.generation);
    let mut state = mailbox::read(&root.join("state.json")).unwrap();
    state["updatedAt"] = json!(mailbox::now() - mailbox::SESSION_TTL_MS - 1);
    mailbox::write(&root.join("state.json"), &state).unwrap();
    let disconnected = adapter.snapshot().await.unwrap();
    assert_ne!(disconnected.readiness, ComputerUseReadiness::Ready);
    assert!(disconnected.targets.is_empty());
    assert!(disconnected.generation > second.generation);
}

#[tokio::test]
async fn canceled_request_keeps_waiting_until_the_peer_acknowledges() {
    let (_temp, adapter, root, message) = fixture();
    let target = adapter.snapshot().await.unwrap().targets.remove(0).identity;
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let task =
        tokio::spawn(async move { adapter.request(&target, "execute", json!({}), token).await });
    let command = loop {
        let reply = exchange(&root, message.clone(), "chrome").unwrap();
        if let Some(command) = reply["commands"].as_array().unwrap().first() {
            break command.clone();
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    cancel.cancel();
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert!(!task.is_finished());
    let reply = exchange(&root, message.clone(), "chrome").unwrap();
    assert_eq!(reply["cancels"][0], command["id"]);
    let mut response = message;
    response["responses"] = json!([{"id":command["id"],"error":"canceled"}]);
    exchange(&root, response, "chrome").unwrap();
    assert!(task.await.unwrap().is_err());
}

#[test]
fn host_rejects_wrong_adapter_and_path_traversal_response() {
    let (_temp, _adapter, root, mut message) = fixture();
    assert!(exchange(&root, message.clone(), "office").is_err());
    message["responses"] = json!([{"id":"../../escape","result":{}}]);
    assert!(exchange(&root, message, "chrome").is_err());
}

#[test]
fn browser_denials_and_independent_switches_cannot_be_overridden_by_consent() {
    let (_temp, _adapter, _root, message) = fixture();
    let target =
        serde_json::from_value(message["snapshot"]["targets"][0]["identity"].clone()).unwrap();
    let policy = ComputerUsePolicy {
        native_enabled: Some(false),
        chrome_enabled: Some(true),
        ..Default::default()
    };
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_ok());
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Session, false)
        .is_err());
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Persistent, true)
        .is_err());
    let mut denied = policy;
    denied.browser = Some(
        serde_json::from_value(json!({"origins":{"https://example.test":{"access":"deny"}}}))
            .unwrap(),
    );
    assert!(denied
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_err());
    denied.browser = None;
    denied.chrome_enabled = Some(false);
    assert!(denied
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_err());
}

#[test]
fn range_actions_reject_unbounded_or_ambiguous_writes() {
    for operation in [
        json!({"action":"range_write","sheet":"Sheet1","address":"A1","values":[[{"formula":"=1"}]]}),
        json!({"action":"range_write","sheet":"Sheet1","address":"A1","values":[["=1"]]}),
        json!({"action":"range_write","sheet":"Sheet1","address":"A1","values":[[1],[2,3]]}),
        json!({"action":"range_read","sheet":"Sheet1","address":"A:A"}),
    ] {
        let action: ComputerUseAction = serde_json::from_value(operation).unwrap();
        assert!(action.validate().is_err());
    }
    let action: ComputerUseAction = serde_json::from_value(
        json!({"action":"formula_write","sheet":"Sheet1","address":"B1","formulas":[["=A1*2"]]}),
    )
    .unwrap();
    assert!(action.validate().is_ok());
}

#[test]
fn browser_patterns_honor_scheme_port_wildcards_and_specific_overrides() {
    let (_temp, _adapter, _root, message) = fixture();
    let mut target: ComputerUseTargetIdentity =
        serde_json::from_value(message["snapshot"]["targets"][0]["identity"].clone()).unwrap();
    let mut policy = ComputerUsePolicy {
        browser: Some(
            serde_json::from_value(
                json!({"origins":{"HTTPS://EXAMPLE.TEST:443/*":{"access":"deny"}}}),
            )
            .unwrap(),
        ),
        ..Default::default()
    };
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_err());
    policy.browser = Some(serde_json::from_value(json!({"default_origin_policy":{"access":"deny"},"origins":{"example.test":{"access":"allow"}}})).unwrap());
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_ok());
    if let ComputerUseTargetIdentity::Chrome { origin, .. } = &mut target {
        *origin = "https://sub.example.test".into();
    }
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_err());
    policy.browser_admin = Some(
        serde_json::from_value(json!({"origins":{"https://*.example.test":{"access":"deny"}}}))
            .unwrap(),
    );
    policy.browser = None;
    assert!(policy
        .check_extension(&target, ComputerUseGrantScope::Session, true)
        .is_err());
}

#[tokio::test]
async fn chrome_addition_keeps_generation_but_reload_alongside_addition_advances_it() {
    let (_temp, adapter, root, mut message) = fixture();
    let first = adapter.snapshot().await.unwrap();
    let mut extra = message["snapshot"]["targets"][0].clone();
    extra["identity"]["tabId"] = json!("2");
    message["snapshot"]["targets"]
        .as_array_mut()
        .unwrap()
        .push(extra.clone());
    exchange(&root, message.clone(), "chrome").unwrap();
    let added = adapter.snapshot().await.unwrap();
    assert_eq!(added.generation, first.generation);
    assert_eq!(added.targets.len(), 2);
    extra["identity"]["tabId"] = json!("3");
    message["snapshot"]["targets"]
        .as_array_mut()
        .unwrap()
        .push(extra);
    message["snapshot"]["generation"] = json!(2);
    exchange(&root, message, "chrome").unwrap();
    assert!(adapter.snapshot().await.unwrap().generation > added.generation);
}

#[test]
fn terminal_notifications_use_one_way_mailbox_without_leaving_response_files() {
    let (_temp, adapter, root, mut message) = fixture();
    let owner = ComputerUseOwner {
        connection: "host".into(),
        thread_id: "thread".into(),
        turn_id: "turn".into(),
    };
    adapter.finish_turn(&owner);
    let reply = exchange(&root, message.clone(), "chrome").unwrap();
    let commands = reply["commands"].as_array().unwrap();
    assert_eq!(commands.len(), 1);
    let command = &commands[0];
    assert_eq!(command["method"], "endTurn");
    assert_eq!(
        command["params"]["owner"],
        json!({"connection":"host","sessionId":"thread","turnId":"turn"})
    );
    message["responses"] = json!([{"id":command["id"],"error":"temporary Chrome failure"}]);
    let retry = exchange(&root, message.clone(), "chrome").unwrap();
    assert_eq!(retry["commands"][0]["id"], command["id"]);
    message["responses"] = json!([{"id":command["id"],"result":{"status":"finalized"}}]);
    exchange(&root, message, "chrome").unwrap();
    assert_eq!(fs::read_dir(root.join("requests")).unwrap().count(), 0);
    assert_eq!(fs::read_dir(root.join("responses")).unwrap().count(), 0);
}
