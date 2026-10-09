//! Catalog setup and cold-read evidence use the same public stdio App Server as the TUI.

use super::*;
use crate::app_server_session::AppServerSession;
use app_server_client::StdioTransportConfig;
use app_server_protocol::protocol::v2::{ModelListParams, ModelListResponse, METHOD_MODEL_LIST};
use app_server_protocol::{METHOD_MODEL_PROVIDER_CREATE, METHOD_MODEL_PROVIDER_UPDATE};
use serde_json::{json, Value};

const MODEL: &str = "gate-reasoner";

fn config(app_server: &Path, cwd: &Path) -> StdioTransportConfig {
    StdioTransportConfig {
        app_server_bin: app_server.into(),
        args: vec![
            "--stdio".into(),
            "--backend".into(),
            "unavailable".into(),
            "--data-dir".into(),
            cwd.join("data").into_os_string(),
            "--app-data-dir".into(),
            cwd.join("app-data").into_os_string(),
        ],
    }
}

pub(super) fn seed_catalog(app_server: &Path, cwd: &Path) -> String {
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
        let session = AppServerSession::connect(config(app_server, cwd)).await.expect("catalog seed stdio initialize");
        let handle = session.request_handle();
        let created: Value = handle.request(METHOD_MODEL_PROVIDER_CREATE, json!({
            "name": "PTY reasoning catalog", "providerType": "ollama", "apiHost": "http://127.0.0.1:1"
        })).await.expect("create isolated keyless catalog provider");
        let provider_id = created["provider"]["id"].as_str().expect("canonical provider id").to_string();
        let _: Value = handle.request(METHOD_MODEL_PROVIDER_UPDATE, json!({
            "providerId": provider_id, "enabled": true,
            "models": [{
                "id": MODEL, "displayName": "Gate Reasoner",
                "capability": {
                    "taskFamilies": ["chat", "reasoning"], "inputModalities": ["text"],
                    "outputModalities": ["text"], "runtimeFeatures": ["streaming", "tool_calling"],
                    "capabilities": {
                        "vision": false, "tools": true, "streaming": true,
                        "jsonMode": false, "functionCalling": true, "reasoning": true,
                        "reasoningEffort": {"supported": true, "levels": ["low", "medium", "high", "max", "ultra"], "default": "medium"}
                    }
                }
            }]
        })).await.expect("declare isolated catalog effort capabilities");
        let catalog: ModelListResponse = handle.request(METHOD_MODEL_LIST, ModelListParams::default()).await.expect("read actual model/list");
        let model = catalog.data.iter().find(|model| model.model == MODEL && model.provider_id == provider_id).expect("seeded model must be in the real catalog");
        assert_eq!(model.default_reasoning_effort, "medium");
        assert_eq!(model.supported_reasoning_efforts.iter().map(|option| option.reasoning_effort.as_str()).collect::<Vec<_>>(), ["low", "medium", "high", "max", "ultra"]);
        session.shutdown().await.expect("close catalog seed sidecar");
        provider_id
    })
}

fn open(writer: &mut impl Write, output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    writer
        .write_all(b"\x1b[200~/model\x1b[201~\x05\r")
        .expect("open model and effort picker");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Select Model and Effort",
        Duration::from_secs(10),
    );
    wait_for_screen_marker(
        output_rx,
        output,
        "f9 select · ctrl+x q back",
        Duration::from_secs(10),
    );
    write_typed_text(writer, b"gate");
    wait_for_screen_marker(output_rx, output, "Gate Reasoner", Duration::from_secs(10));
    writer
        .write_all(b"\x1b[20~")
        .expect("configured F9 enters model effort submenu");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Select Reasoning Level",
        Duration::from_secs(10),
    );
    wait_for_screen_marker(
        output_rx,
        output,
        "› 2. Medium (default)",
        Duration::from_secs(10),
    );
}

pub(super) fn exercise_nested_selection(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    open(writer, output_rx, output);
    writer
        .write_all(b"\x04\x1b[20~")
        .expect("configured Ctrl-D pages to More reasoning without closing or applying settings");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Advanced Reasoning",
        Duration::from_secs(10),
    );
    wait_for_screen_marker(output_rx, output, "1. Max", Duration::from_secs(10));
    wait_for_screen_marker(output_rx, output, "2. Ultra", Duration::from_secs(10));
    writer
        .write_all(b"\x18q")
        .expect("configured cancel chord returns to effort parent");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "› 4. More reasoning…",
        Duration::from_secs(10),
    );
    writer
        .write_all(b"\x18q")
        .expect("return to filtered model parent");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "model query and highlighted identity restored after child cancel",
        |screen| {
            screen.contains("Select Model and Effort")
                && screen.contains("gate")
                && screen.contains("› 1. Gate Reasoner")
        },
    );
    writer
        .write_all(b"\x18q")
        .expect("cancel model selection without a settings action");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "composer restored after nested model cancel",
        |screen| {
            !screen.contains("Select Model and Effort")
                && screen.contains("Ask Lime to do anything")
        },
    );
    open(writer, output_rx, output);
    writer.write_all(b"j\x1b[20~").expect(
        "plain effort navigation and configured F9 accept model/provider/high in one selection",
    );
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "accepted model and effort returned to the composer",
        |screen| !screen.contains("Select Reasoning Level") && screen.contains("settings updated"),
    );
    writer
        .write_all(b"\x1b[200~/status\x1b[201~\x05\r")
        .expect("inspect accepted settings through the status surface");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "accepted model and effort visible in status",
        |screen| screen.contains(MODEL) && screen.contains("high"),
    );
    writer
        .write_all(b"q")
        .expect("close accepted settings status");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
}

pub(super) fn assert_cold_settings(
    app_server: &Path,
    cwd: &Path,
    node_bin: &Path,
    backend: &Path,
    ledger: &Path,
    provider: &str,
    scenario: &str,
) {
    let entries = std::fs::read_to_string(ledger).expect("canonical backend ledger");
    let starts = entries
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["scenario"] == scenario && entry["kind"] == "turnStart")
        .collect::<Vec<_>>();
    assert_eq!(
        starts.len(),
        1,
        "nested picker navigation must not submit a canonical turn"
    );
    let thread_id = starts[0]["threadId"].as_str().unwrap();
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let mut config = config(app_server, cwd);
            config.args[2] = "external".into();
            config.args.extend([
                "--backend-command".into(),
                node_bin.as_os_str().to_os_string(),
                "--backend-arg".into(),
                backend.as_os_str().to_os_string(),
                "--backend-arg".into(),
                ledger.as_os_str().to_os_string(),
            ]);
            let mut session = AppServerSession::connect(config)
                .await
                .expect("cold settings stdio initialize");
            let resumed = session
                .resume_thread(thread_id.into())
                .await
                .expect("cold canonical thread/resume");
            assert_eq!(resumed.thread.id, thread_id);
            assert_eq!(resumed.model, MODEL);
            assert_eq!(resumed.model_provider, provider);
            assert_eq!(resumed.reasoning_effort.as_deref(), Some("high"));
            session
                .shutdown()
                .await
                .expect("close cold settings sidecar");
        });
}
