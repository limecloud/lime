use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{
    METHOD_CONFIG_BATCH_WRITE, METHOD_CONFIG_READ, METHOD_CONFIG_VALUE_WRITE,
};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED, PROTOCOL_VERSION};
use lime_core::config::ConfigManager;
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn config_control_plane_uses_the_single_desktop_yaml_layer() {
    let temp = TempDir::new().expect("config temp");
    let config_path = temp.path().join("config.yaml");
    std::fs::write(
        &config_path,
        concat!(
            "server:\n  api_key: config-test-key\n",
            "language: zh-CN\n",
            "tui:\n",
            "  keymap:\n",
            "    global:\n",
            "      find_transcript: ctrl-x f\n",
            "    list:\n",
            "      accept: f9\n",
            "      cancel: esc\n",
            "    editor:\n",
            "      move_left: [F9, Control-Q h]\n",
            "      delete_backward: []\n",
            "    vim_normal:\n",
            "      undo: [F12, z u]\n",
            "    vim_operator:\n",
            "      motion_word_forward: Control-Q w\n",
            "    vim_text_object:\n",
            "      parentheses: []\n",
            "    vim_search:\n",
            "      forward: z /\n",
        ),
    )
    .expect("write config");
    let previous = std::env::var_os("LIME_CONFIG_PATH");
    let _restore = scopeguard::guard(previous, |value| {
        if let Some(value) = value {
            std::env::set_var("LIME_CONFIG_PATH", value);
        } else {
            std::env::remove_var("LIME_CONFIG_PATH");
        }
    });
    std::env::set_var("LIME_CONFIG_PATH", &config_path);

    let server = AppServer::with_runtime(RuntimeCore::with_backend(Arc::new(MockBackend)));
    initialize(&server).await;

    let read = request(
        &server,
        2,
        METHOD_CONFIG_READ,
        json!({"includeLayers": true}),
    )
    .await;
    assert_eq!(read["result"]["config"]["language"], "zh-CN");
    assert_eq!(read["result"]["config"]["show_raw_agent_reasoning"], false);
    assert_eq!(read["result"]["config"]["hide_agent_reasoning"], false);
    assert!(
        serde_json::from_value::<lime_core::config::TuiConfig>(
            read["result"]["config"]["tui"].clone()
        )
        .unwrap()
        .animations
    );
    assert_eq!(
        read["result"]["config"]["tui"]["keymap"]["global"]["find_transcript"],
        "ctrl-x f"
    );
    assert_eq!(
        read["result"]["config"]["tui"]["keymap"]["list"]["accept"],
        "f9"
    );
    assert_eq!(
        read["result"]["config"]["tui"]["keymap"]["editor"],
        json!({
            "move_left": ["f9", "ctrl-q h"], "delete_backward": []
        })
    );
    assert_eq!(
        read["result"]["layers"][0]["name"],
        json!({
            "type": "user",
            "file": config_path.to_string_lossy(),
            "profile": null
        })
    );
    let version = read["result"]["layers"][0]["version"]
        .as_str()
        .expect("config version")
        .to_string();
    assert_eq!(read["result"]["origins"]["language"]["version"], version);

    let batch = request(
        &server,
        3,
        METHOD_CONFIG_BATCH_WRITE,
        json!({
            "edits": [{
                "keyPath": "show_raw_agent_reasoning",
                "value": true,
                "mergeStrategy": "replace"
            }, {
                "keyPath": "hide_agent_reasoning",
                "value": true,
                "mergeStrategy": "replace"
            }, {
                "keyPath": "language",
                "value": "en-US",
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.keymap.list.cancel",
                "value": "ctrl-x q",
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.keymap.editor.kill_whole_line",
                "value": "ctrl-q k",
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.keymap.vim_normal.redo",
                "value": "z r",
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.status_line",
                "value": ["session-id", "model-with-reasoning", "current-dir"],
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.animations",
                "value": false,
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.status_line_use_colors",
                "value": false,
                "mergeStrategy": "replace"
            }, {
                "keyPath": "tui.terminal_title",
                "value": ["project-name", "activity", "thread-title"],
                "mergeStrategy": "replace"
            }],
            "expectedVersion": version,
            "reloadUserConfig": true
        }),
    )
    .await;
    assert_eq!(batch["result"]["status"], "ok");
    assert_eq!(
        batch["result"]["filePath"],
        json!(config_path.to_string_lossy())
    );
    let next_version = batch["result"]["version"]
        .as_str()
        .expect("next version")
        .to_string();

    let vim_read = request(&server, 30, METHOD_CONFIG_READ, json!({})).await;
    assert_eq!(vim_read["result"]["config"]["tui"]["animations"], false);
    assert_eq!(
        vim_read["result"]["config"]["show_raw_agent_reasoning"],
        true
    );
    assert_eq!(
        vim_read["result"]["config"]["tui"]["terminal_title"],
        json!(["project-name", "activity", "thread-title"])
    );
    assert_eq!(
        vim_read["result"]["config"]["tui"]["status_line"],
        json!(["session-id", "model-with-reasoning", "current-dir"])
    );
    assert_eq!(
        vim_read["result"]["config"]["tui"]["status_line_use_colors"],
        false
    );
    for (context, expected) in [
        ("vim_normal", json!({"undo": ["f12", "z u"], "redo": "z r"})),
        ("vim_operator", json!({"motion_word_forward": "ctrl-q w"})),
        ("vim_text_object", json!({"parentheses": []})),
        ("vim_search", json!({"forward": "z /"})),
    ] {
        assert_eq!(
            vim_read["result"]["config"]["tui"]["keymap"][context],
            expected
        );
    }

    let value_write = request(
        &server,
        4,
        METHOD_CONFIG_VALUE_WRITE,
        json!({
            "keyPath": "minimize_to_tray",
            "value": true,
            "mergeStrategy": "replace",
            "expectedVersion": next_version
        }),
    )
    .await;
    assert_eq!(value_write["result"]["status"], "ok");
    let persisted = ConfigManager::load(&config_path).expect("load persisted config");
    assert!(persisted.config().show_raw_agent_reasoning);
    assert!(persisted.config().hide_agent_reasoning);
    assert_eq!(
        persisted.config().tui.status_line.as_deref(),
        Some(
            [
                "session-id".to_string(),
                "model-with-reasoning".to_string(),
                "current-dir".to_string()
            ]
            .as_slice()
        )
    );
    assert!(!persisted.config().tui.status_line_use_colors);
    assert!(!persisted.config().tui.animations);
    assert_eq!(
        persisted.config().tui.terminal_title,
        Some(vec![
            "project-name".into(),
            "activity".into(),
            "thread-title".into()
        ])
    );
    assert_eq!(
        serde_json::to_value(&persisted.config().tui.keymap.editor).unwrap(),
        json!({
            "move_left": ["f9", "ctrl-q h"], "delete_backward": [], "kill_whole_line": "ctrl-q k"
        })
    );
    assert_eq!(persisted.config().language, "en-US");
    assert!(persisted.config().minimize_to_tray);
    assert_eq!(
        persisted
            .config()
            .tui
            .keymap
            .list
            .cancel
            .as_ref()
            .unwrap()
            .specs()[0]
            .as_str(),
        "ctrl-x q"
    );
    assert_eq!(
        persisted
            .config()
            .tui
            .keymap
            .global
            .find_transcript
            .as_ref()
            .expect("persisted TUI Find binding")
            .specs()[0]
            .as_str(),
        "ctrl-x f"
    );

    let stale = request_error(
        &server,
        5,
        METHOD_CONFIG_VALUE_WRITE,
        json!({
            "keyPath": "language",
            "value": "ja-JP",
            "mergeStrategy": "replace",
            "expectedVersion": "stale-version"
        }),
    )
    .await;
    assert_eq!(stale["error"]["code"], -32600);
    assert_eq!(
        stale["error"]["data"]["config_write_error_code"],
        "configVersionConflict"
    );

    let foreign_path = request_error(
        &server,
        6,
        METHOD_CONFIG_VALUE_WRITE,
        json!({
            "keyPath": "language",
            "value": "ko-KR",
            "mergeStrategy": "replace",
            "filePath": temp.path().join("other.yaml").to_string_lossy()
        }),
    )
    .await;
    assert_eq!(
        foreign_path["error"]["data"]["config_write_error_code"],
        "configLayerReadonly"
    );

    let unknown_key = request_error(
        &server,
        7,
        METHOD_CONFIG_VALUE_WRITE,
        json!({
            "keyPath": "unknown_product_config",
            "value": true,
            "mergeStrategy": "replace"
        }),
    )
    .await;
    assert_eq!(
        unknown_key["error"]["data"]["config_write_error_code"],
        "configSchemaUnknownKey"
    );

    let project_layer = request_error(
        &server,
        8,
        METHOD_CONFIG_READ,
        json!({"cwd": temp.path().to_string_lossy()}),
    )
    .await;
    assert_eq!(project_layer["error"]["code"], -32602);

    for (id, key_path, value) in [
        (9, "tui.keymap.editor.move_lft", json!("f10")),
        (10, "tui.keymap.editor.move_left", json!("ctrl-q h j")),
        (12, "tui.keymap.vim_normal.undoo", json!("f12")),
        (
            13,
            "tui.keymap.vim_operator.motion_word_forward",
            json!("g g g"),
        ),
        (14, "tui.keymap.vim_text_object.parenthesis", json!("f12")),
        (15, "tui.keymap.vim_search.forward", json!("f25")),
        (16, "tui.status_line", json!([1])),
        (17, "tui.status_line_use_colors", json!("false")),
        (18, "tui.terminal_title", json!([1])),
        (19, "tui.terminal_title", json!("activity")),
        (20, "show_raw_agent_reasoning", json!("true")),
        (21, "show_raw_agent_reasoning", json!(1)),
        (22, "hide_agent_reasoning", json!("true")),
        (23, "hide_agent_reasoning", json!(1)),
        (24, "tui.animations", json!("false")),
        (26, "tui.animations", json!(1)),
    ] {
        let invalid = request_error(
            &server,
            id,
            METHOD_CONFIG_VALUE_WRITE,
            json!({
                "keyPath": key_path, "value": value, "mergeStrategy": "replace"
            }),
        )
        .await;
        assert_eq!(
            invalid["error"]["data"]["config_write_error_code"], "configValidationError",
            "invalid TUI config: {invalid}"
        );
    }
    // Public config writes use null to remove an override, unlike a literal null in core YAML.
    let reset = request(
        &server,
        25,
        METHOD_CONFIG_VALUE_WRITE,
        json!({
            "keyPath": "tui.animations", "value": null, "mergeStrategy": "replace"
        }),
    )
    .await;
    assert_eq!(reset["result"]["status"], "ok");
    let reset_read = request(&server, 27, METHOD_CONFIG_READ, json!({})).await;
    assert!(
        serde_json::from_value::<lime_core::config::TuiConfig>(
            reset_read["result"]["config"]["tui"].clone()
        )
        .unwrap()
        .animations
    );
    assert!(
        ConfigManager::load(&config_path)
            .unwrap()
            .config()
            .tui
            .animations
    );
    let disabled = request(
        &server,
        28,
        METHOD_CONFIG_VALUE_WRITE,
        json!({
            "keyPath": "tui.animations", "value": false, "mergeStrategy": "replace"
        }),
    )
    .await;
    assert_eq!(disabled["result"]["status"], "ok");
    let final_read = request(&server, 11, METHOD_CONFIG_READ, json!({})).await;
    assert_eq!(final_read["result"]["config"]["tui"]["animations"], false);
    assert_eq!(final_read["result"]["config"]["hide_agent_reasoning"], true);
    assert_eq!(
        final_read["result"]["config"]["show_raw_agent_reasoning"],
        true
    );
    assert_eq!(
        final_read["result"]["config"]["tui"]["terminal_title"],
        json!(["project-name", "activity", "thread-title"])
    );
    assert_eq!(
        final_read["result"]["config"]["tui"]["status_line"],
        json!(["session-id", "model-with-reasoning", "current-dir"])
    );
    assert_eq!(
        final_read["result"]["config"]["tui"]["status_line_use_colors"],
        false
    );
    assert_eq!(
        final_read["result"]["config"]["tui"]["keymap"]["editor"],
        json!({
            "move_left": ["f9", "ctrl-q h"], "delete_backward": [], "kill_whole_line": "ctrl-q k"
        }),
        "invalid writes must not mutate persisted editor config"
    );
    assert_eq!(
        final_read["result"]["config"]["tui"]["keymap"]["vim_normal"],
        json!({"undo": ["f12", "z u"], "redo": "z r"}),
        "invalid Vim writes must not mutate persisted config"
    );
    let cleared = request(
        &server,
        31,
        METHOD_CONFIG_BATCH_WRITE,
        json!({
            "edits": [
                {"keyPath": "tui.terminal_title", "value": [], "mergeStrategy": "replace"},
                {"keyPath": "show_raw_agent_reasoning", "value": null, "mergeStrategy": "replace"},
                {"keyPath": "hide_agent_reasoning", "value": null, "mergeStrategy": "replace"}
            ],
            "reloadUserConfig": true
        }),
    )
    .await;
    assert_eq!(cleared["result"]["status"], "ok");
    assert_eq!(
        ConfigManager::load(&config_path)
            .unwrap()
            .config()
            .tui
            .terminal_title,
        Some(vec![])
    );
    let empty_read = request(&server, 32, METHOD_CONFIG_READ, json!({})).await;
    assert_eq!(
        empty_read["result"]["config"]["show_raw_agent_reasoning"], false,
        "null removes the key and restores the shared default; it is not a literal bool value"
    );
    assert_eq!(
        empty_read["result"]["config"]["tui"]["terminal_title"],
        json!([])
    );
}

async fn initialize(server: &AppServer) {
    let response = request(
        server,
        1,
        METHOD_INITIALIZE,
        json!({
            "clientInfo": {"name": "config-jsonrpc-test", "version": "1.0.0"}
        }),
    )
    .await;
    assert_eq!(
        response["result"]["serverInfo"]["protocolVersion"],
        PROTOCOL_VERSION
    );
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}}).to_string(),
        )
        .await
        .expect("initialized notification");
    assert!(lines.is_empty());
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let response = request_error(server, id, method, params).await;
    if let Some(error) = response.get("error") {
        panic!("{method} failed: {error}");
    }
    response
}

async fn request_error(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let lines = server
        .handle_json_line(
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string(),
        )
        .await
        .expect("handle JSON-RPC request");
    lines
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).expect("decode response"))
        .find(|message| message.get("id") == Some(&json!(id)))
        .unwrap_or_else(|| panic!("{method} should return matching response: {lines:#?}"))
}
