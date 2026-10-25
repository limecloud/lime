//! Application destination requirements are administered outside user configuration.

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
        // Read-only public boundary: no model or turn is executed by this fixture.
        let server = AppServer::with_runtime(
            RuntimeCore::default()
                .with_app_config_path(self.config.clone())
                .with_requirements_path(self.policy.clone()),
        );
        call(
            &server,
            "initialize",
            json!({"clientInfo":{"name":"application-requirements-fixture","version":"1"}}),
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
async fn managed_application_network_is_a_live_typed_public_projection() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        json!({"requirements":null})
    );
    for (source, expected) in [
        ("[application]", Value::Null),
        (
            "[application.network]",
            json!({"network":{"enabled":true,"domains":{}},"storage":null}),
        ),
        (
            "[application.network]\nenabled = false",
            json!({"network":{"enabled":false,"domains":{}},"storage":null}),
        ),
        (
            "[application.network.domains]\n'EXAMPLE.com.' = 'allow'\n'blocked.example' = 'deny'",
            json!({"network":{"enabled":true,"domains":{"example.com":"allow","blocked.example":"deny"}},"storage":null}),
        ),
    ] {
        std::fs::write(&fixture.policy, source).unwrap();
        let response = call(&server, "configRequirements/read", json!({})).await;
        assert_eq!(
            response["requirements"]["application"], expected,
            "{source}"
        );
    }
}

#[tokio::test]
async fn user_config_and_rpc_cannot_forge_or_override_application_network_authority() {
    let fixture = Fixture::new();
    std::fs::write(
        &fixture.config,
        "server:\n  api_key: test-only\napplication:\n  network:\n    enabled: false\n",
    )
    .unwrap();
    let server = fixture.server().await;
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await,
        json!({"requirements":null})
    );
    std::fs::write(
        &fixture.policy,
        "[application.network.domains]\n'example.com' = 'deny'",
    )
    .unwrap();
    for params in [
        json!({"application":{"network":{"enabled":false}}}),
        json!({"path":fixture.config}),
        json!({"requirementsPath":fixture.config}),
    ] {
        let response = raw(&server, "configRequirements/read", params).await;
        assert_eq!(response["error"]["code"], -32602, "{response}");
    }
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await["requirements"]["application"]
            ["network"],
        json!({"enabled":true,"domains":{"example.com":"deny"}})
    );
}

#[tokio::test]
async fn malformed_or_unsupported_managed_policy_is_rejected_instead_of_reusing_a_cached_allow() {
    let fixture = Fixture::new();
    let server = fixture.server().await;
    std::fs::write(&fixture.policy, "[application.network]\nenabled = false").unwrap();
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await["requirements"]["application"]
            ["network"]["enabled"],
        false
    );
    for source in [
        "[application.network]\nenabled = 'false'",
        "[application.network.domains]\n'*.example.com' = 'allow'",
        "[application.network.domains]\n'example.com:443' = 'allow'",
        "[application.network.domains]\n'EXAMPLE.com' = 'allow'\n'example.com.' = 'deny'",
        "[application.storage]",
        "[application.storage]\ndefault_project_parent = '/tmp/projects'",
    ] {
        std::fs::write(&fixture.policy, source).unwrap();
        let response = raw(&server, "configRequirements/read", json!({})).await;
        assert!(response.get("error").is_some(), "{source}: {response}");
        assert!(response.get("result").is_none(), "{source}: {response}");
    }
    std::fs::write(&fixture.policy, "[application.network]").unwrap();
    assert_eq!(
        call(&server, "configRequirements/read", json!({})).await["requirements"]["application"]
            ["network"],
        json!({"enabled":true,"domains":{}})
    );
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
