use super::create_env_for_mcp_server;
use std::collections::HashMap;
use std::ffi::OsString;
use std::process::Command;

#[test]
fn passthrough_reaches_the_real_stdio_launcher_without_implicit_inheritance() {
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "utils::tests::passthrough_child", "--nocapture"])
        .env("MCP_TEST_CHILD", "1")
        .env("MCP_VISIBLE", " inherited value ")
        .env("MCP_OVERRIDE", "inherited")
        .env("MCP_UNSELECTED", "not forwarded")
        .env("NODE_REPL_AUTH_TOKEN", "not forwarded")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

#[tokio::test]
async fn passthrough_child() {
    if std::env::var("MCP_TEST_CHILD").as_deref() != Ok("1") {
        return;
    }
    let directory = tempfile::tempdir().unwrap();
    let receipt = directory.path().join("environment.json");
    let config = crate::types::McpServerConfig {
        transport: crate::types::McpServerTransport::Stdio {
            command: std::env::current_exe()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            args: vec![
                "--exact".into(),
                "utils::tests::native_probe".into(),
                "--nocapture".into(),
            ],
            env: HashMap::from([
                (
                    "MCP_TEST_OUTPUT".into(),
                    receipt.to_string_lossy().into_owned(),
                ),
                ("MCP_OVERRIDE".into(), " explicit value ".into()),
                ("node_repl_auth_token".into(), "not forwarded".into()),
            ]),
            env_vars: vec![
                "MCP_VISIBLE".into(),
                "MCP_OVERRIDE".into(),
                "NODE_REPL_AUTH_TOKEN".into(),
                "MCP_MISSING".into(),
            ],
            cwd: None,
        },
        ..Default::default()
    };
    config.validate().unwrap();
    let launched = crate::stdio_launcher::LocalStdioLauncher::launch("env-probe", &config).unwrap();
    for _ in 0..200 {
        if receipt.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let actual: serde_json::Value =
        serde_json::from_slice(&std::fs::read(receipt).unwrap()).unwrap();
    assert_eq!(actual["MCP_VISIBLE"], " inherited value ");
    assert_eq!(actual["MCP_OVERRIDE"], " explicit value ");
    for name in [
        "MCP_UNSELECTED",
        "MCP_MISSING",
        "NODE_REPL_AUTH_TOKEN",
        "node_repl_auth_token",
    ] {
        assert_eq!(actual[name], serde_json::Value::Null, "{name}");
    }
    drop(launched);
}

#[test]
fn native_probe() {
    let Some(path) = std::env::var_os("MCP_TEST_OUTPUT") else {
        return;
    };
    let selected: HashMap<&str, Option<String>> = [
        "MCP_VISIBLE",
        "MCP_OVERRIDE",
        "MCP_UNSELECTED",
        "MCP_MISSING",
        "NODE_REPL_AUTH_TOKEN",
        "node_repl_auth_token",
    ]
    .into_iter()
    .map(|name| (name, std::env::var(name).ok()))
    .collect();
    std::fs::write(path, serde_json::to_vec(&selected).unwrap()).unwrap();
}

#[test]
fn explicit_path_is_preserved_and_invalid_passthrough_names_fail_closed() {
    let overrides = HashMap::from([(OsString::from("PATH"), OsString::from("/explicit/path"))]);
    let environment = create_env_for_mcp_server(Some(overrides), &[]).unwrap();
    assert_eq!(
        environment.get(&OsString::from("PATH")),
        Some(&OsString::from("/explicit/path"))
    );
    for name in ["", "A=B", "A\0B"] {
        assert!(create_env_for_mcp_server(None, &[name.to_string()]).is_err());
    }
}
