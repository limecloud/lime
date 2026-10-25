//! Computer Use configuration uses the shared public config control plane.

use app_server::{AppServer, RuntimeCore};
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;

struct Fixture {
    _temp: TempDir,
    config: PathBuf,
    requirements: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        let config = temp.path().join("config.yaml");
        let requirements = temp.path().join("requirements.toml");
        std::fs::write(
            &config,
            "server:\n  api_key: test-only\ndefault_provider: custom-model-provider\n",
        )
        .unwrap();
        Self {
            _temp: temp,
            config,
            requirements,
        }
    }

    async fn server(&self) -> AppServer {
        let server = AppServer::with_runtime(
            RuntimeCore::default()
                .with_app_config_path(self.config.clone())
                .with_requirements_path(self.requirements.clone()),
        );
        result(
            &server,
            "initialize",
            json!({"clientInfo":{"name":"computer-use-config-fixture","version":"1"}}),
        )
        .await;
        server
            .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
            .await
            .unwrap();
        server
    }
}

async fn raw(server: &AppServer, method: &str, params: Value) -> Value {
    let response = server
        .handle_json_line(
            &json!({
                "jsonrpc":"2.0", "id":1, "method":method, "params":params
            })
            .to_string(),
        )
        .await
        .unwrap();
    response
        .into_iter()
        .map(|line| serde_json::from_str::<Value>(&line).unwrap())
        .find(|value| value.get("id") == Some(&json!(1)))
        .expect("response for request 1")
}

async fn result(server: &AppServer, method: &str, params: Value) -> Value {
    let response = raw(server, method, params).await;
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

#[tokio::test]
async fn application_policies_round_trip_restart_and_revoke_through_shared_config() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    let before = result(&server, "config/read", json!({"includeLayers":true})).await;
    let policy = json!({
        "default_app_access":"deny",
        "macos":{"bundle_ids":{"com.example.Editor":"allow"}},
        "windows":{
            "aumids":{"Example!App":"deny"},
            "exes":[{"publisher_name":"CN=Example","product_name":"Editor","binary_name":"editor.exe","access":"allow"}]
        }
    });
    result(
        &server,
        "config/batchWrite",
        json!({
            "expectedVersion":before["layers"][0]["version"],
            "edits":[{"keyPath":"computer_use","value":policy,"mergeStrategy":"replace"}]
        }),
    )
    .await;
    drop(server);
    let server = fixture.server().await;
    let after = result(&server, "config/read", json!({})).await;
    assert_eq!(after["config"]["computer_use"], policy);
    assert_eq!(after["config"]["default_provider"], "custom-model-provider");
    result(&server, "config/value/write", json!({
        "keyPath":"computer_use.macos.bundle_ids", "value":{"com.example.Editor":"deny"}, "mergeStrategy":"replace"
    })).await;
    let revoked = result(&server, "config/read", json!({})).await;
    assert_eq!(
        revoked["config"]["computer_use"]["macos"]["bundle_ids"]["com.example.Editor"],
        "deny"
    );
    result(
        &server,
        "config/value/write",
        json!({
            "keyPath":"computer_use", "value":null, "mergeStrategy":"replace"
        }),
    )
    .await;
    assert!(result(&server, "config/read", json!({})).await["config"]
        .get("computer_use")
        .is_none());
}

#[tokio::test]
async fn malformed_policy_and_cas_conflicts_never_partially_update_the_file() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    let before = std::fs::read(&fixture.config).unwrap();
    for policy in [
        json!({"default_app_access":"ask"}),
        json!({"always_allow":true}),
        json!({"macos":{"bundle_id":{"com.example.Editor":"allow"}}}),
        json!({"windows":{"exes":[{"publisher_name":"Example","product_name":"Editor","access":"allow","unexpected":true}]}}),
    ] {
        let response = raw(
            &server,
            "config/batchWrite",
            json!({"edits":[
                {"keyPath":"default_provider","value":"must-not-persist","mergeStrategy":"replace"},
                {"keyPath":"computer_use","value":policy,"mergeStrategy":"replace"}
            ]}),
        )
        .await;
        assert!(response.get("error").is_some(), "{response}");
        assert_eq!(std::fs::read(&fixture.config).unwrap(), before);
    }
    let response = raw(
        &server,
        "config/value/write",
        json!({
            "expectedVersion":"stale-version", "keyPath":"computer_use",
            "value":{"default_app_access":"allow"},"mergeStrategy":"replace"
        }),
    )
    .await;
    assert!(response.get("error").is_some(), "{response}");
    assert_eq!(std::fs::read(&fixture.config).unwrap(), before);
}

#[tokio::test]
async fn managed_computer_policy_is_live_separate_and_uses_upstream_wire() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    result(&server, "config/value/write", json!({
        "keyPath":"computer_use", "value":{"default_app_access":"allow"}, "mergeStrategy":"replace"
    })).await;
    assert_eq!(
        result(&server, "configRequirements/read", json!({})).await["requirements"],
        Value::Null
    );
    std::fs::write(
        &fixture.requirements,
        r#"
        allow_browser_and_computer_use = false
        [computer_use]
        allow_locked_computer_use = false
        allow_persistent_approval = false
        default_app_access = 'deny'
        [computer_use.macos.bundle_ids]
        'com.example.Editor' = 'deny'
        [computer_use.windows.aumids]
        'Example!App' = 'deny'
        [[computer_use.windows.exes]]
        publisher_name = 'CN=Example'
        product_name = 'Editor'
        binary_name = 'editor.exe'
        access = 'deny'
    "#,
    )
    .unwrap();
    let managed = result(&server, "configRequirements/read", json!({})).await;
    assert_eq!(managed["requirements"]["allowBrowserAndComputerUse"], false);
    assert_eq!(
        managed["requirements"]["computerUse"],
        json!({
            "allowLockedComputerUse":false, "allowPersistentApproval":false, "defaultAppAccess":"deny",
            "macos":{"bundleIds":{"com.example.Editor":"deny"}},
            "windows":{"aumids":{"Example!App":"deny"},"exes":[{
                "publisherName":"CN=Example", "productName":"Editor", "binaryName":"editor.exe", "access":"deny"
            }]}
        })
    );
    // User preferences remain distinct from authoritative administrator requirements.
    assert_eq!(
        result(&server, "config/read", json!({})).await["config"]["computer_use"]
            ["default_app_access"],
        "allow"
    );
    std::fs::write(
        &fixture.requirements,
        "[computer_use]\nallow_persistent_approval = true",
    )
    .unwrap();
    assert_eq!(
        result(&server, "configRequirements/read", json!({})).await["requirements"]["computerUse"]
            ["allowPersistentApproval"],
        true
    );
}

#[tokio::test]
async fn invalid_managed_policy_cannot_be_forged_or_silently_ignored() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    for source in [
        "[computer_use]\nallow_persistent_approval = 'false'",
        "[computer_use]\nallow_unknown = true",
        "[computer_use.macos]\nbundle_id = {}",
    ] {
        std::fs::write(&fixture.requirements, source).unwrap();
        assert!(raw(&server, "configRequirements/read", json!({}))
            .await
            .get("error")
            .is_some());
    }
    std::fs::write(
        &fixture.requirements,
        "[computer_use]\nallow_persistent_approval = false",
    )
    .unwrap();
    assert!(raw(
        &server,
        "configRequirements/read",
        json!({"computerUse":{"allowPersistentApproval":true}})
    )
    .await
    .get("error")
    .is_some());
    assert!(raw(&server, "config/value/write", json!({
        "keyPath":"computer_use.allow_persistent_approval", "value":true, "mergeStrategy":"replace"
    })).await.get("error").is_some());
    assert_eq!(
        result(&server, "configRequirements/read", json!({})).await["requirements"]["computerUse"]
            ["allowPersistentApproval"],
        false
    );
}
