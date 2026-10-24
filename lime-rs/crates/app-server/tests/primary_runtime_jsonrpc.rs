use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{
    METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL, METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES,
    METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES, METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW,
};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use serde_json::{json, Value};
use std::sync::Arc;

async fn request(server: &AppServer, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await
        .expect("JSON-RPC transport");
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|message| message["id"] == 1)
        .unwrap_or_else(|| panic!("{method} returned no response: {lines:?}"))
}

async fn initialize(server: &AppServer) {
    let result = request(
        server,
        METHOD_INITIALIZE,
        json!({"clientInfo":{"name":"primary-runtime-test","version":"1"}}),
    )
    .await;
    assert!(result.get("error").is_none(), "{result}");
    server
        .handle_json_line(
            &json!({"jsonrpc":"2.0","method":METHOD_INITIALIZED,"params":{}}).to_string(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn passive_diagnostics_and_stale_cancel_do_not_create_or_install_tools() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("dependencies");
    let config = temp.path().join("config.yaml");
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(config.clone())
            .with_primary_runtime_root(root.clone())
            .unwrap(),
    );
    for (method, params) in [
        (METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES, json!({})),
        (METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW, json!({})),
        (METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES, json!({})),
        (METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL, json!({"id":"stale"})),
    ] {
        let response = request(&server, method, params).await;
        assert!(
            response.get("error").is_some(),
            "uninitialized {method}: {response}"
        );
    }
    initialize(&server).await;
    let result = request(
        &server,
        METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES,
        json!({}),
    )
    .await;
    let data = &result["result"];
    assert_eq!(data["enabled"], true, "{result}");
    assert_eq!(data["installed"], false, "{result}");
    assert_eq!(data["bundleVersion"], Value::Null, "{result}");
    assert_eq!(data["update"], Value::Null, "{result}");
    assert!(!data["expectedVersion"].as_str().unwrap().is_empty());
    let stale = request(
        &server,
        METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL,
        json!({"id":"stale"}),
    )
    .await;
    assert_eq!(stale["result"], json!({"canceled":false}));
    assert!(
        !root.exists(),
        "passive diagnostics/cancel must not create storage"
    );
    assert!(!config.exists(), "passive reads must not persist defaults");
}

#[tokio::test]
async fn disabled_configuration_and_invalid_public_params_cannot_start_installation() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("dependencies");
    let config = temp.path().join("config.yaml");
    std::fs::write(&config, "features:\n  workspace_dependencies: false\n").unwrap();
    let before = std::fs::read(&config).unwrap();
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_app_config_path(config.clone())
            .with_primary_runtime_root(root.clone())
            .unwrap(),
    );
    initialize(&server).await;
    for method in [
        METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW,
        METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES,
    ] {
        let response = request(&server, method, json!({})).await;
        assert_eq!(response["error"]["code"], -32600, "{method}: {response}");
        assert_eq!(
            response["error"]["message"],
            "workspace dependencies are disabled"
        );
    }
    for (method, params) in [
        (
            METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES,
            json!({"path":"/elsewhere"}),
        ),
        (
            METHOD_PRIMARY_RUNTIME_RUN_UPDATE_NOW,
            json!({"url":"https://unused.invalid"}),
        ),
        (
            METHOD_PRIMARY_RUNTIME_RESET_DEPENDENCIES,
            json!({"sha256":"provided"}),
        ),
        (METHOD_PRIMARY_RUNTIME_CANCEL_INSTALL, json!({})),
    ] {
        let response = request(&server, method, params).await;
        assert_eq!(response["error"]["code"], -32602, "{method}: {response}");
    }
    assert!(!root.exists(), "rejected installs must not create storage");
    assert_eq!(std::fs::read(&config).unwrap(), before);
    let result = request(
        &server,
        METHOD_PRIMARY_RUNTIME_DIAGNOSE_DEPENDENCIES,
        json!({"probeExecutables":true}),
    )
    .await;
    assert_eq!(result["result"]["enabled"], false);
    assert_eq!(result["result"]["installed"], false);
}

#[cfg(unix)]
#[tokio::test]
async fn command_exec_consumes_installed_bundle_and_respects_disabled_configuration() {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    async fn rpc(
        input: &mut tokio::process::ChildStdin,
        lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
        method: &str,
        params: Value,
    ) -> Value {
        input
            .write_all(format!("{}\n", json!({"id":1,"method":method,"params":params})).as_bytes())
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            loop {
                let message: Value = serde_json::from_str(
                    &lines.next_line().await.unwrap().expect("stdio response"),
                )
                .unwrap();
                if message["id"] == 1 {
                    return message;
                }
            }
        })
        .await
        .expect("bounded RPC response")
    }

    // Controlled executables exercise the command boundary without downloading releases.
    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("app");
    let root = app.join("runtimes");
    let config = temp.path().join("config.yaml");
    let generation = uuid::Uuid::new_v4().to_string();
    let release: Value = serde_json::from_str(include_str!(
        "../../tool-runtime/src/primary_runtime/release.json"
    ))
    .unwrap();
    let platform = release["platforms"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| {
            entry["os"] == std::env::consts::OS && entry["arch"] == std::env::consts::ARCH
        })
        .expect("supported fixture platform");
    let base = root.join("releases").join(&generation);
    for artifact in platform["artifacts"].as_array().unwrap() {
        let executable = base.join(artifact["executable"].as_str().unwrap());
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "#!/bin/sh\nprintf 'fixture-bundle-tool\\n'\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        root.join("current.json"),
        json!({
            "bundleVersion": release["version"], "generation": generation,
        })
        .to_string(),
    )
    .unwrap();
    let host = temp.path().join("host-bin");
    std::fs::create_dir_all(&host).unwrap();
    let host_node = host.join("node");
    std::fs::write(&host_node, "#!/bin/sh\nprintf 'fixture-host-tool\\n'\n").unwrap();
    std::fs::set_permissions(&host_node, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_app-server"))
        .args(["--stdio", "--backend", "unavailable", "--app-data-dir"])
        .arg(&app)
        .arg("--data-dir")
        .arg(temp.path().join("agent"))
        .env("LIME_CONFIG_PATH", &config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let initialized = rpc(
        &mut input,
        &mut lines,
        "initialize",
        json!({
            "clientInfo":{"name":"dependency-command-test","version":"1"}
        }),
    )
    .await;
    assert!(initialized.get("error").is_none(), "{initialized}");
    input
        .write_all(b"{\"method\":\"initialized\"}\n")
        .await
        .unwrap();
    for (enabled, expected) in [
        (true, "fixture-bundle-tool\n"),
        (false, "fixture-host-tool\n"),
    ] {
        std::fs::write(
            &config,
            format!("features:\n  workspace_dependencies: {enabled}\n"),
        )
        .unwrap();
        let response = rpc(
            &mut input,
            &mut lines,
            "command/exec",
            json!({
                "command": ["node"], "cwd": temp.path(),
                "env": {"PATH": host}, "timeoutMs": 5000,
            }),
        )
        .await;
        assert!(response.get("error").is_none(), "{response}");
        assert_eq!(response["result"]["exitCode"], 0, "{response}");
        assert_eq!(
            response["result"]["stdout"], expected,
            "enabled={enabled}: {response}"
        );
    }
    drop(input);
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(15), child.wait())
            .await
            .unwrap()
            .unwrap()
            .success()
    );
}
