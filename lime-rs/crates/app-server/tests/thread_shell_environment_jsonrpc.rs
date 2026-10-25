#![cfg(unix)]

mod support;

use app_server::{AppServer, EventLogWriter, RuntimeCore};
use lime_core::config::{Config, ConfigManager};
use lime_services::project_git_service::{
    write_worktree_shell_environment, WorktreeShellEnvironment,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use support::{json_lines_transport::TransportClient, provider_fixture::ProviderFixture};
use tempfile::TempDir;

const PROVIDER: &str = "shell-policy-provider";
const MODEL: &str = "shell-policy-model";
const COMMAND: &str = "printf '%s|%s|%s|%s|%s|%s|%s' \"$VALUE\" \"${HOME-missing}\" \"$GLOBAL\" \"$EXPLICIT\" \"$LIME_THREAD_ID\" \"$LIME_TOOL_CALL_ID\" \"$PWD\"";

fn runtime(temp: &TempDir, url: &str) -> RuntimeCore {
    support::runtime_core_with_chat_provider_at(temp, PROVIDER, MODEL, url)
        .with_event_log_writer(Arc::new(
            EventLogWriter::new(temp.path().join("events")).unwrap(),
        ))
        .with_app_config_path(temp.path().join("config.yaml"))
}

fn save_config(temp: &TempDir, global: &str) {
    let mut config = Config::default();
    config.default_permissions = Some(":danger-full-access".into());
    config.shell_environment_policy = serde_json::from_value(json!({
        "inherit":"none", "set":{"VALUE":"configured","HOME":"configured-home","GLOBAL":global}
    }))
    .unwrap();
    ConfigManager::with_config(config, temp.path().join("config.yaml"))
        .save()
        .unwrap();
}

fn git(root: &Path, args: &[&str]) {
    let result = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn checkouts(temp: &TempDir) -> [PathBuf; 3] {
    let root = std::fs::canonicalize(temp.path()).unwrap();
    let source = root.join("source");
    std::fs::create_dir(&source).unwrap();
    git(&source, &["init", "--template=", "--initial-branch=main"]);
    std::fs::write(source.join("README.md"), "fixture").unwrap();
    git(&source, &["add", "."]);
    git(
        &source,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Fixture",
        ],
    );
    let one = root.join("one");
    let two = root.join("two");
    for path in [&one, &two] {
        git(
            &source,
            &[
                "worktree",
                "add",
                "--detach",
                path.to_str().unwrap(),
                "HEAD",
            ],
        );
        std::fs::create_dir(path.join("nested")).unwrap();
    }
    [source, one.join("nested"), two.join("nested")]
}

async fn write_diff(path: &Path, value: &str) {
    let diff =
        WorktreeShellEnvironment::from_captures("HOME=before\n", &format!("VALUE={value}\n"))
            .unwrap();
    write_worktree_shell_environment(path, &diff).await.unwrap();
}

async fn start(client: &mut TransportClient, id: u64, cwd: &Path, config: Value) -> String {
    let response = client
        .request_ok(
            id,
            "thread/start",
            json!({
                "model":MODEL, "modelProvider":PROVIDER, "cwd":cwd, "historyMode":"paginated",
                "approvalPolicy":"never", "sandbox":"danger-full-access", "config":config
            }),
        )
        .await;
    response["result"]["thread"]["id"].as_str().unwrap().into()
}

async fn run_tool(client: &mut TransportClient, id: u64, thread: &str, prompt: &str) -> Value {
    let response = client
        .request_ok(
            id,
            "turn/start",
            json!({
                "threadId":thread, "input":[{"type":"text","text":prompt}], "model":MODEL,
                "approvalPolicy":"never", "sandboxPolicy":"danger-full-access"
            }),
        )
        .await;
    let turn = response["result"]["turn"]["id"].as_str().unwrap();
    client.wait_for_turn_completed(thread, turn).await;
    client
        .request_ok(
            id + 1,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await
}

fn latest_command(read: &Value) -> &Value {
    read["result"]["thread"]["turns"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["type"] == "commandExecution")
        .expect("canonical command item")
}

fn assert_output(read: &Value, thread: &str, cwd: &Path, turn: usize, values: [&str; 4]) {
    let command = latest_command(read);
    assert_eq!(command["status"], "completed", "{read:#}");
    assert_eq!(command["exitCode"], 0, "{command:#}");
    assert_eq!(
        command["aggregatedOutput"],
        format!(
            "{}|{}|{}|{}|{thread}|policy-exec-call-{turn}|{}",
            values[0],
            values[1],
            values[2],
            values[3],
            cwd.display()
        ),
        "{command:#}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn thread_policy_reaches_real_provider_tool_and_refreshes_after_cold_runtime_resume() {
    let temp = TempDir::new().unwrap();
    let [source, one, two] = checkouts(&temp);
    save_config(&temp, "global-one");
    write_diff(&one, "setup-one").await;
    write_diff(&two, "setup-two").await;
    let provider = ProviderFixture::start(
        MODEL,
        json!({"cmd":COMMAND,"shell":"/bin/sh","login":false}),
        "policy-exec-call",
    )
    .await;
    let mut first = TransportClient::start(
        AppServer::with_runtime(runtime(&temp, &provider.base_url)),
        "shell-policy-first",
    )
    .await;
    let overrides =
        json!({"shell_environment_policy":{"set":{"VALUE":"request","EXPLICIT":"request-one"}}});
    let thread = start(&mut first, 2, &one, overrides.clone()).await;
    let initial = run_tool(&mut first, 3, &thread, "first command").await;
    assert_output(
        &initial,
        &thread,
        &one,
        1,
        ["setup-one", "missing", "global-one", "request-one"],
    );
    let first_item = latest_command(&initial).clone();
    let other = start(&mut first, 5, &two, overrides.clone()).await;
    let other_read = run_tool(&mut first, 6, &other, "other checkout").await;
    assert_output(
        &other_read,
        &other,
        &two,
        1,
        ["setup-two", "missing", "global-one", "request-one"],
    );
    let source_thread = start(&mut first, 8, &source, overrides).await;
    let source_read = run_tool(&mut first, 9, &source_thread, "source checkout").await;
    assert_output(
        &source_read,
        &source_thread,
        &source,
        1,
        ["request", "configured-home", "global-one", "request-one"],
    );
    first.shutdown().await;

    save_config(&temp, "global-two");
    write_diff(&one, "setup-new").await;
    let mut resumed = TransportClient::start(
        AppServer::with_runtime(runtime(&temp, &provider.base_url)),
        "shell-policy-cold-runtime",
    )
    .await;
    let snapshot = resumed
        .request_ok(
            2,
            "thread/resume",
            json!({"threadId":thread,"excludeTurns":true}),
        )
        .await;
    assert_eq!(snapshot["result"]["thread"]["id"], thread);
    let read = resumed
        .request_ok(
            3,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    assert_eq!(
        latest_command(&read),
        &first_item,
        "resume preserves canonical history"
    );
    let second = run_tool(&mut resumed, 4, &thread, "second command").await;
    assert_output(
        &second,
        &thread,
        &one,
        2,
        ["setup-new", "missing", "global-two", "request-one"],
    );
    resumed.request_ok(6, "thread/resume", json!({"threadId":thread,"excludeTurns":true,"config":{"shell_environment_policy.set.EXPLICIT":"request-two"}})).await;
    let third = run_tool(&mut resumed, 7, &thread, "third command").await;
    assert_output(
        &third,
        &thread,
        &one,
        3,
        ["setup-new", "missing", "global-two", "request-two"],
    );
    assert_eq!(
        third["result"]["thread"]["turns"].as_array().unwrap().len(),
        3
    );
    assert!(
        provider
            .requests()
            .iter()
            .flat_map(|request| request["messages"].as_array())
            .flatten()
            .any(|message| message["role"] == "tool"
                && message["content"]
                    .as_str()
                    .is_some_and(|text| text.contains("setup-new|missing|global-two|request-two"))),
        "actual process output returns to the provider"
    );
    resumed.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn invalid_start_or_resume_policy_is_rejected_without_sampling_or_mutating_the_thread() {
    let temp = TempDir::new().unwrap();
    save_config(&temp, "configured");
    let provider = ProviderFixture::start(
        MODEL,
        json!({"cmd":"printf must-not-run","login":false}),
        "invalid-policy",
    )
    .await;
    let mut client = TransportClient::start(
        AppServer::with_runtime(runtime(&temp, &provider.base_url)),
        "shell-policy-invalid",
    )
    .await;
    for (index, config) in [
        json!({"shell_environment_policy":{"inherit":"invalid"}}),
        json!({"shell_environment_policy.filters":{"PATH":"include","path":"exclude"}}),
        json!({"shell_environment_policy":{"filters":{"PATH":"include"},"exclude":["HOME"]}}),
    ]
    .into_iter()
    .enumerate()
    {
        let response = client
            .request(
                2 + index as u64,
                "thread/start",
                json!({"model":MODEL,"modelProvider":PROVIDER,"cwd":temp.path(),"config":config}),
            )
            .await;
        assert_eq!(response["error"]["code"], -32602, "{response:#}");
    }
    let thread = start(
        &mut client,
        5,
        temp.path(),
        json!({"shell_environment_policy.set.EXPLICIT":"preserved"}),
    )
    .await;
    let before = client
        .request_ok(6, "thread/read", json!({"threadId":thread}))
        .await;
    assert_eq!(
        before["result"]["thread"]["extra"]["shellEnvironmentPolicy"]["set"]["EXPLICIT"],
        "preserved"
    );
    let rejected = client
        .request(
            7,
            "thread/resume",
            json!({"threadId":thread,"excludeTurns":true,"config":{"shell_environment_policy":{"inherit":"invalid"}}}),
        )
        .await;
    assert_eq!(rejected["error"]["code"], -32602, "{rejected:#}");
    let unsupported = client
        .request(
            9,
            "thread/resume",
            json!({"threadId":thread,"excludeTurns":true,"config":{"model_verbosity":"high"}}),
        )
        .await;
    assert_eq!(unsupported["error"]["code"], -32600, "{unsupported:#}");
    let after = client
        .request_ok(8, "thread/read", json!({"threadId":thread}))
        .await;
    assert_eq!(
        after["result"]["thread"]["extra"]["shellEnvironmentPolicy"],
        before["result"]["thread"]["extra"]["shellEnvironmentPolicy"]
    );
    assert!(
        provider.requests().is_empty(),
        "invalid policies never sample a provider"
    );
    client.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn actual_stdio_processes_restore_policy_and_canonical_history_after_normal_exit() {
    use lime_core::database::{dao::api_key_provider::ApiProviderType, init_database_at_path};
    let temp = TempDir::new().unwrap();
    let [_, one, two] = checkouts(&temp);
    save_config(&temp, "stdio-one");
    write_diff(&one, "setup-one").await;
    write_diff(&two, "setup-two").await;
    let provider = ProviderFixture::start(
        MODEL,
        json!({"cmd":COMMAND,"shell":"/bin/sh","login":false}),
        "policy-exec-call",
    )
    .await;
    let roots =
        app_server::StorageRoots::initialize(temp.path().join("app"), temp.path().join("agent"))
            .unwrap();
    let db = init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            PROVIDER,
            MODEL,
            ApiProviderType::Openai,
            &provider.base_url,
            "test-key",
        )],
        false,
    );
    drop(db);
    let program = Path::new(env!("CARGO_BIN_EXE_app-server"));
    let mut first =
        TransportClient::start_stdio(program, temp.path(), "shell-policy-stdio-first").await;
    let thread = start(
        &mut first,
        2,
        &one,
        json!({"shell_environment_policy.set.EXPLICIT":"persisted"}),
    )
    .await;
    let initial = run_tool(&mut first, 3, &thread, "first stdio command").await;
    assert_output(
        &initial,
        &thread,
        &one,
        1,
        ["setup-one", "missing", "stdio-one", "persisted"],
    );
    let first_item = latest_command(&initial).clone();
    let other = start(
        &mut first,
        5,
        &two,
        json!({"shell_environment_policy.set.EXPLICIT":"other"}),
    )
    .await;
    let other_read = run_tool(&mut first, 6, &other, "other stdio checkout").await;
    assert_output(
        &other_read,
        &other,
        &two,
        1,
        ["setup-two", "missing", "stdio-one", "other"],
    );
    first.shutdown().await;

    save_config(&temp, "stdio-two");
    write_diff(&one, "setup-refreshed").await;
    let mut second =
        TransportClient::start_stdio(program, temp.path(), "shell-policy-stdio-second").await;
    second
        .request_ok(
            2,
            "thread/resume",
            json!({"threadId":thread,"excludeTurns":true}),
        )
        .await;
    let restored = second
        .request_ok(
            3,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    assert_eq!(latest_command(&restored), &first_item);
    let read = run_tool(&mut second, 4, &thread, "second stdio command").await;
    assert_output(
        &read,
        &thread,
        &one,
        2,
        ["setup-refreshed", "missing", "stdio-two", "persisted"],
    );
    let second_item = latest_command(&read).clone();
    second.shutdown().await;

    let mut third =
        TransportClient::start_stdio(program, temp.path(), "shell-policy-stdio-third").await;
    third
        .request_ok(
            2,
            "thread/resume",
            json!({"threadId":thread,"excludeTurns":true}),
        )
        .await;
    let restored = third
        .request_ok(
            3,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    assert_eq!(latest_command(&restored), &second_item);
    third.request_ok(4, "thread/shellCommand", json!({
        "threadId":thread,
        "command":"printf '%s|%s|%s|%s' \"$VALUE\" \"$GLOBAL\" \"$EXPLICIT\" \"$LIME_THREAD_ID\""
    })).await;
    third.wait_for_thread_completed(&thread).await;
    let shell = third
        .request_ok(
            5,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    let command = latest_command(&shell);
    assert_eq!(command["exitCode"], 0, "{command:#}");
    assert_eq!(
        command["aggregatedOutput"],
        format!("setup-refreshed|stdio-two|persisted|{thread}")
    );
    third.shutdown().await;
}
