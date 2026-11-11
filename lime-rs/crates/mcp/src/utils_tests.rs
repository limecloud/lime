use super::create_env_for_mcp_server;
use rmcp::transport::Transport as _;
use std::collections::HashMap;
use std::ffi::OsString;
use std::process::Command;
use std::sync::{Arc, Mutex};

#[cfg(target_os = "macos")]
const PROBE_LOADER_ENV_VARS: &[&str] = &["DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"];
#[cfg(target_os = "linux")]
const PROBE_LOADER_ENV_VARS: &[&str] = &["LD_LIBRARY_PATH"];
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
const PROBE_LOADER_ENV_VARS: &[&str] = &[];

struct ProbeDiagnostics(Arc<Mutex<String>>);

impl tracing::Subscriber for ProbeDiagnostics {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        metadata.target() == "lime_mcp::stdio_launcher"
    }

    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        use std::fmt::Write;
        let mut diagnostics = self.0.lock().unwrap();
        event.record(
            &mut |field: &tracing::field::Field, value: &dyn std::fmt::Debug| {
                writeln!(diagnostics, "{}={value:?}", field.name()).unwrap();
            },
        );
    }
}

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
    let diagnostics = Arc::new(Mutex::new(String::new()));
    tracing::subscriber::set_global_default(ProbeDiagnostics(diagnostics.clone())).unwrap();
    // Cargo 的完整 workspace 测试二进制可能动态链接本机原生库；仅为夹具显式继承 loader 路径。
    let env_vars = [
        "MCP_VISIBLE",
        "MCP_OVERRIDE",
        "NODE_REPL_AUTH_TOKEN",
        "MCP_MISSING",
    ]
    .into_iter()
    .chain(PROBE_LOADER_ENV_VARS.iter().copied())
    .map(str::to_owned)
    .collect();
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
            env_vars,
            cwd: None,
        },
        ..Default::default()
    };
    config.validate().unwrap();
    let crate::stdio_launcher::StdioLaunch {
        mut transport,
        process,
        stderr_task,
    } = crate::stdio_launcher::LocalStdioLauncher::launch("env-probe", &config).unwrap();
    let status = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        // 保留并读完 libtest stdout，避免先释放 transport 关闭读端导致子进程 Broken pipe。
        assert!(transport.receive().await.is_none());
        let mut child = transport.into_inner().unwrap();
        child.wait().await
    })
    .await
    .unwrap_or_else(|error| {
        panic!(
            "native probe did not exit: {error}; stderr: {}",
            diagnostics.lock().unwrap()
        )
    })
    .unwrap();
    if let Some(task) = stderr_task {
        task.await.unwrap();
    }
    assert!(
        status.success(),
        "native probe exited {status}; stderr: {}",
        diagnostics.lock().unwrap()
    );
    let actual: serde_json::Value =
        serde_json::from_slice(&std::fs::read(receipt).unwrap_or_else(|error| {
            panic!(
                "native probe receipt missing: {error}; stderr: {}",
                diagnostics.lock().unwrap()
            )
        }))
        .unwrap();
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
    drop(process);
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
