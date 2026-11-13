//! Real CLI processes against an explicit stdio App Server fixture.
//! OAuth itself is covered separately with the native HTTPS MCP fixture.
#![cfg(unix)]

use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
use std::process::{Command, Output};

fn command(
    scenario: &str,
    locale: &str,
    action: &str,
) -> (tempfile::TempDir, std::path::PathBuf, Command) {
    let root = tempfile::tempdir().expect("isolated CLI fixture");
    let server = root.path().join("app-server");
    std::fs::write(&server, include_str!("mcp_oauth/server.py")).unwrap();
    std::fs::set_permissions(&server, std::fs::Permissions::from_mode(0o700)).unwrap();
    let log = root.path().join("requests.jsonl");
    std::fs::write(root.path().join("config.yaml"), "{}\n").unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_lime"));
    command
        .args(["mcp", action, "market:research", "--app-server"])
        .arg(server)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("LIME_HOME", root.path().join("home"))
        .env("LIME_CONFIG_PATH", root.path().join("config.yaml"))
        .env("LIME_CREDENTIALS_STORE", "file")
        .env("LIME_LOCALE", locale)
        .env("LIME_MCP_CLI_TEST_SCENARIO", scenario)
        .env("LIME_MCP_CLI_TEST_LOG", &log)
        .env(
            "LIME_MCP_CLI_TEST_PROTOCOL",
            app_server_protocol::PROTOCOL_VERSION,
        );
    if action == "login" {
        command.args(["--no-browser", "--scopes", "research:read"]);
    }
    (root, log, command)
}

fn run(scenario: &str, locale: &str, action: &str) -> (Output, Vec<Value>) {
    let (_root, log, command) = command(scenario, locale, action);
    let output = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let mut command = tokio::process::Command::from(command);
            command.kill_on_drop(true);
            tokio::time::timeout(std::time::Duration::from_secs(30), command.output())
                .await
                .expect("CLI must reach a terminal result")
                .expect("run CLI process")
        });
    let requests = std::fs::read_to_string(log)
        .expect("fixture requests")
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    (output, requests)
}

#[test]
fn login_retains_early_completion_and_uses_the_current_locale() {
    for (locale, label) in [
        ("zh-CN", "已登录"),
        ("zh-TW", "已登入"),
        ("en-US", "Signed in"),
        ("ja-JP", "ログイン済み"),
        ("ko-KR", "로그인됨"),
    ] {
        let (output, requests) = run("success", locale, "login");
        assert!(output.status.success(), "{locale}: {output:?}");
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            format!("market:research: {label}")
        );
        assert!(String::from_utf8_lossy(&output.stderr)
            .contains("https://mcp.example.invalid/authorize"));
        assert_eq!(
            requests
                .iter()
                .filter(|r| r["method"] == "mcpServer/oauth/login")
                .count(),
            1,
            "authorization must not be retried"
        );
    }
}

#[test]
fn login_failure_does_not_report_success_or_print_untrusted_provider_errors() {
    let (output, _) = run("failed", "zh-CN", "login");
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("失败"), "{stderr}");
    assert!(!stderr.contains("untrusted-provider-token"), "{stderr}");
}

#[test]
fn login_ignores_completions_for_another_name_attempt_or_thread() {
    let (output, _) = run("unrelated", "en-US", "login");
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
}

#[test]
fn login_requires_a_correlatable_attempt() {
    let (output, _) = run("missing_id", "en-US", "login");
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
}

#[test]
fn login_disconnect_is_a_failure() {
    let (output, _) = run("disconnected", "en-US", "login");
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
}

#[test]
fn logout_resolves_market_servers_through_the_same_owner() {
    for (locale, label) in [
        ("zh-CN", "未登录"),
        ("zh-TW", "未登入"),
        ("en-US", "Signed out"),
        ("ja-JP", "未ログイン"),
        ("ko-KR", "로그아웃됨"),
    ] {
        let (output, requests) = run("logout", locale, "logout");
        assert!(output.status.success(), "{locale}: {output:?}");
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            format!("market:research: {label}")
        );
        let methods: Vec<_> = requests
            .iter()
            .filter_map(|r| r["method"].as_str())
            .collect();
        assert_eq!(
            methods,
            ["initialize", "initialized", "mcpServer/oauth/logout"]
        );
    }
}

#[test]
fn logout_preserves_owner_validation_failures() {
    let (output, _) = run("logout_rejected", "en-US", "logout");
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
}

#[tokio::test]
async fn interrupt_stops_authorization_waiting_in_the_current_locale() {
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, BufReader};

    for (locale, label) in [
        ("zh-CN", "已停止等待授权"),
        ("zh-TW", "已停止等待授權"),
        ("en-US", "Stopped waiting for authorization"),
        ("ja-JP", "認証の待機を停止しました"),
        ("ko-KR", "인증 대기를 중지했습니다"),
    ] {
        let (_root, log, command) = command("pending", locale, "login");
        let mut child = tokio::process::Command::from(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(child.stderr.take().unwrap()).lines();
        let first = tokio::time::timeout(Duration::from_secs(30), lines.next_line())
            .await
            .expect("authorization URL")
            .unwrap()
            .unwrap();
        assert!(
            first.contains("https://mcp.example.invalid/authorize"),
            "{first}"
        );
        assert!(Command::new("kill")
            .args(["-INT", &child.id().unwrap().to_string()])
            .status()
            .unwrap()
            .success());
        let output = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
            .await
            .expect("interrupted CLI must terminate")
            .unwrap();
        assert!(!output.status.success(), "{locale}: {output:?}");
        assert!(output.stdout.is_empty(), "{locale}: {output:?}");
        let mut stderr = String::new();
        while let Some(line) = lines.next_line().await.unwrap() {
            stderr.push_str(&line);
        }
        assert!(stderr.contains(label), "{locale}: {stderr}");
        let login_count = std::fs::read_to_string(log)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|request| request["method"] == "mcpServer/oauth/login")
            .count();
        assert_eq!(login_count, 1, "interruption must not retry authorization");
    }
}
