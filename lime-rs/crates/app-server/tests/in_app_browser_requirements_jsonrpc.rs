//! Managed in-app browser requirements use the existing public config boundary.

use app_server::{AppServer, RuntimeCore};
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile::TempDir;

struct Fixture {
    _temp: TempDir,
    config: PathBuf,
    policy: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        let config = temp.path().join("config.yaml");
        let policy = temp.path().join("requirements.toml");
        std::fs::write(&config, "server:\n  api_key: test-only\n").unwrap();
        Self {
            _temp: temp,
            config,
            policy,
        }
    }

    async fn server(&self) -> AppServer {
        // No turn is executed: the explicit test backend is outside this read-model contract.
        let runtime = RuntimeCore::default()
            .with_app_config_path(self.config.clone())
            .with_requirements_path(self.policy.clone());
        let server = AppServer::with_runtime(runtime);
        call(
            &server,
            "initialize",
            json!({"clientInfo":{"name":"in-app-browser-requirements-fixture","version":"1"}}),
        )
        .await;
        server
            .handle_json_line(&json!({"jsonrpc":"2.0","method":"initialized"}).to_string())
            .await
            .unwrap();
        server
    }
}

#[tokio::test]
async fn import_requirement_preserves_unset_and_explicit_values_on_public_read() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        json!({"requirements":null}),
    );
    for (source, expected) in [
        ("", json!({"requirements":null})),
        ("[in_app_browser]", json!({"requirements":null})),
        (
            "[in_app_browser]\nallow_external_browser_settings_import = false",
            projected(Some(false)),
        ),
        (
            "[in_app_browser]\nallow_external_browser_settings_import = true",
            projected(Some(true)),
        ),
        (
            "allowed_sandbox_modes = ['read-only']\n[in_app_browser]",
            json!({"requirements":{
                "allowedApprovalPolicies":null,
                "allowedSandboxModes":["read-only"],
                "allowedWebSearchModes":null,
                "inAppBrowser":{"allowExternalBrowserSettingsImport":null}
            }}),
        ),
    ] {
        std::fs::write(&fixture.policy, source).unwrap();
        assert_eq!(
            call(&server, "configRequirements/read", json!({})).await,
            expected,
            "managed source: {source}",
        );
    }
}

#[tokio::test]
async fn user_config_and_rpc_cannot_supply_or_override_managed_import_requirements() {
    let fixture = Fixture::new();
    std::fs::write(
        &fixture.config,
        "server:\n  api_key: test-only\nin_app_browser:\n  allow_external_browser_settings_import: true\n",
    )
    .unwrap();
    let server = fixture.server().await;
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        json!({"requirements":null}),
    );
    std::fs::write(
        &fixture.policy,
        "[in_app_browser]\nallow_external_browser_settings_import = false",
    )
    .unwrap();
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        projected(Some(false)),
    );
    for params in [
        json!({"inAppBrowser":{"allowExternalBrowserSettingsImport":true}}),
        json!({"path":fixture.config}),
    ] {
        let response = raw(&server, "configRequirements/read", params).await;
        assert_eq!(response["error"]["code"], -32602, "{response}");
    }
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        projected(Some(false)),
    );
}

#[tokio::test]
async fn malformed_managed_import_policy_fails_closed_and_can_be_repaired() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    for source in [
        "in_app_browser = false".to_owned(),
        "in_app_browser = []".to_owned(),
        "[in_app_browser]\nallow_external_browser_settings_import = 'false'".to_owned(),
        "[in_app_browser]\nallow_external_browser_settings_import = 1".to_owned(),
        "[in_app_browser]\nallow_external_browser_settings_import = []".to_owned(),
        "[in_app_browser]\nallow_external_browser_settings_import = {}".to_owned(),
    ] {
        std::fs::write(&fixture.policy, &source).unwrap();
        let response = raw(&server, "configRequirements/read", json!({})).await;
        assert!(response.get("error").is_some(), "{source}: {response}");
        assert!(response.get("result").is_none(), "{source}: {response}");
    }
    std::fs::write(
        &fixture.policy,
        "[in_app_browser]\nallow_external_browser_settings_import = true",
    )
    .unwrap();
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        projected(Some(true)),
    );
}

fn projected(value: Option<bool>) -> Value {
    json!({"requirements":{
        "allowedApprovalPolicies":null,
        "allowedSandboxModes":null,
        "allowedWebSearchModes":null,
        "inAppBrowser":{"allowExternalBrowserSettingsImport":value}
    }})
}

async fn call(server: &AppServer, method: &str, params: Value) -> Value {
    let response = raw(server, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response["result"].clone()
}

async fn raw(server: &AppServer, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|line| serde_json::from_str::<Value>(&line).unwrap())
        .find(|message| message["id"] == 1)
        .expect("public JSON-RPC response")
}
