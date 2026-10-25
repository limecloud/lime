use app_server::{AppServer, MockBackend, RuntimeCore};
use app_server_protocol::protocol::v2::{METHOD_CONFIG_BATCH_WRITE, METHOD_CONFIG_READ};
use app_server_protocol::{METHOD_INITIALIZE, METHOD_INITIALIZED};
use lime_core::config::ConfigManager;
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tempfile::TempDir;

#[tokio::test]
async fn composer_enter_behavior_persists_across_cold_loads_and_rejects_invalid_batches() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("config.yaml");
    std::fs::write(&path, "language: en-US\ntui:\n  animations: false\n").unwrap();
    let mut server = create_server(&path).await;
    let read = request(&server, 2, METHOD_CONFIG_READ, json!({})).await;
    assert!(read["result"]["config"]["desktop"]
        .get("composerEnterBehavior")
        .is_none());

    for mode in ["enter", "cmdIfMultiline", "cmdAlways"] {
        let saved = request(&server, 3, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
            {"keyPath": "desktop.composerEnterBehavior", "value": mode, "mergeStrategy": "replace"},
            {"keyPath": "desktop.open-link-in-target-preference", "value": "external-browser", "mergeStrategy": "replace"},
            {"keyPath": "endpoint_providers.lime", "value": "fixture-provider", "mergeStrategy": "replace"}
        ]})).await;
        assert_eq!(saved["result"]["status"], "ok");
        drop(server);
        server = create_server(&path).await;
        let read = request(&server, 4, METHOD_CONFIG_READ, json!({})).await;
        let config = &read["result"]["config"];
        assert_eq!(config["desktop"]["composerEnterBehavior"], mode);
        assert_eq!(
            config["desktop"]["open-link-in-target-preference"],
            "external-browser"
        );
        assert_eq!(config["tui"]["animations"], false);
        assert_eq!(config["language"], "en-US");
        assert_eq!(config["endpoint_providers"]["lime"], "fixture-provider");
        let typed = ConfigManager::load(&path).unwrap();
        assert_eq!(
            typed
                .config()
                .endpoint_providers
                .get_provider("lime")
                .unwrap(),
            "fixture-provider"
        );

        let bytes = std::fs::read(&path).unwrap();
        for invalid in [
            json!("unknown"),
            json!(false),
            json!([]),
            json!("cmd-always"),
        ] {
            let rejected = raw_request(&server, 5, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
                {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
                {"keyPath": "desktop.composerEnterBehavior", "value": invalid, "mergeStrategy": "replace"}
            ]})).await;
            assert!(rejected.get("error").is_some(), "{rejected}");
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
}

#[tokio::test]
async fn menu_bar_preference_persists_across_cold_loads_and_rejects_invalid_batches() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("config.yaml");
    std::fs::write(&path, "language: en-US\ntui:\n  animations: false\n").unwrap();
    let mut server = create_server(&path).await;
    let read = request(&server, 2, METHOD_CONFIG_READ, json!({})).await;
    assert!(read["result"]["config"]["desktop"]
        .get("mac-menu-bar-enabled")
        .is_none());

    for enabled in [false, true] {
        let saved = request(&server, 3, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
            {"keyPath": "desktop.mac-menu-bar-enabled", "value": enabled, "mergeStrategy": "replace"},
            {"keyPath": "desktop.composerEnterBehavior", "value": "cmdAlways", "mergeStrategy": "replace"},
            {"keyPath": "endpoint_providers.lime", "value": "fixture-provider", "mergeStrategy": "replace"}
        ]})).await;
        assert_eq!(saved["result"]["status"], "ok");
        drop(server);
        server = create_server(&path).await;
        let read = request(&server, 4, METHOD_CONFIG_READ, json!({})).await;
        let config = &read["result"]["config"];
        assert_eq!(config["desktop"]["mac-menu-bar-enabled"], enabled);
        assert_eq!(config["desktop"]["composerEnterBehavior"], "cmdAlways");
        assert_eq!(config["endpoint_providers"]["lime"], "fixture-provider");
        assert_eq!(config["tui"]["animations"], false);
        assert_eq!(config["language"], "en-US");
        assert_eq!(
            ConfigManager::load(&path)
                .unwrap()
                .config()
                .desktop
                .mac_menu_bar_enabled,
            Some(enabled)
        );

        let bytes = std::fs::read(&path).unwrap();
        for invalid in [json!("false"), json!(0), json!([]), json!({})] {
            let rejected = raw_request(&server, 5, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
                {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
                {"keyPath": "desktop.mac-menu-bar-enabled", "value": invalid, "mergeStrategy": "replace"}
            ]})).await;
            assert!(rejected.get("error").is_some(), "{rejected}");
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
}

#[tokio::test]
async fn prevent_sleep_persists_across_cold_loads_and_rejects_invalid_batches() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("config.yaml");
    std::fs::write(&path, "language: en-US\n").unwrap();
    let mut server = create_server(&path).await;
    let read = request(&server, 2, METHOD_CONFIG_READ, json!({})).await;
    assert!(read["result"]["config"]["desktop"]
        .get("preventSleepWhileRunning")
        .is_none());
    for enabled in [true, false] {
        let saved = request(&server, 3, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
            {"keyPath": "desktop.preventSleepWhileRunning", "value": enabled, "mergeStrategy": "replace"},
            {"keyPath": "desktop.composerEnterBehavior", "value": "cmdAlways", "mergeStrategy": "replace"}
        ]})).await;
        assert_eq!(saved["result"]["status"], "ok");
        drop(server);
        server = create_server(&path).await;
        let read = request(&server, 4, METHOD_CONFIG_READ, json!({})).await;
        assert_eq!(
            read["result"]["config"]["desktop"]["preventSleepWhileRunning"],
            enabled
        );
        assert_eq!(
            read["result"]["config"]["desktop"]["composerEnterBehavior"],
            "cmdAlways"
        );
        assert_eq!(
            ConfigManager::load(&path)
                .unwrap()
                .config()
                .desktop
                .prevent_sleep_while_running,
            Some(enabled)
        );
        let bytes = std::fs::read(&path).unwrap();
        for invalid in [json!("false"), json!(0), json!([]), json!({})] {
            let rejected = raw_request(&server, 5, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
                {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
                {"keyPath": "desktop.preventSleepWhileRunning", "value": invalid, "mergeStrategy": "replace"}
            ]})).await;
            assert!(rejected.get("error").is_some(), "{rejected}");
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
}

#[tokio::test]
async fn close_confirmation_persists_and_rejects_invalid_batches_atomically() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("config.yaml");
    std::fs::write(&path, "language: en-US\n").unwrap();
    let mut server = create_server(&path).await;
    let read = request(&server, 2, METHOD_CONFIG_READ, json!({})).await;
    assert!(read["result"]["config"]["desktop"]
        .get("confirm-before-close")
        .is_none());
    for mode in ["never", "keyboardOnly", "always"] {
        let saved = request(&server, 3, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
            {"keyPath": "desktop.confirm-before-close", "value": mode, "mergeStrategy": "replace"},
            {"keyPath": "desktop.composerEnterBehavior", "value": "cmdAlways", "mergeStrategy": "replace"}
        ]})).await;
        assert_eq!(saved["result"]["status"], "ok");
        drop(server);
        server = create_server(&path).await;
        let read = request(&server, 4, METHOD_CONFIG_READ, json!({})).await;
        assert_eq!(
            read["result"]["config"]["desktop"]["confirm-before-close"],
            mode
        );
        assert_eq!(
            read["result"]["config"]["desktop"]["composerEnterBehavior"],
            "cmdAlways"
        );
        assert_eq!(read["result"]["config"]["language"], "en-US");
        let typed = ConfigManager::load(&path).unwrap();
        assert_eq!(
            serde_json::to_value(typed.config().desktop.confirm_before_close).unwrap(),
            mode
        );
        let bytes = std::fs::read(&path).unwrap();
        for invalid in [
            json!("keyboard-only"),
            json!(true),
            json!(0),
            json!([]),
            json!({}),
        ] {
            let rejected = raw_request(&server, 5, METHOD_CONFIG_BATCH_WRITE, json!({"edits": [
                {"keyPath": "language", "value": "ja-JP", "mergeStrategy": "replace"},
                {"keyPath": "desktop.confirm-before-close", "value": invalid, "mergeStrategy": "replace"}
            ]})).await;
            assert!(rejected.get("error").is_some(), "{rejected}");
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
}

async fn create_server(path: &Path) -> AppServer {
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend)).with_app_config_path(path.to_owned()),
    );
    request(
        &server,
        1,
        METHOD_INITIALIZE,
        json!({
            "clientInfo": {"name": "desktop-preferences-test", "version": "1"}
        }),
    )
    .await;
    assert!(server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0", "method": METHOD_INITIALIZED, "params": {}
            })
            .to_string()
        )
        .await
        .unwrap()
        .is_empty());
    server
}

async fn request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    let response = raw_request(server, id, method, params).await;
    assert!(response.get("error").is_none(), "{method}: {response}");
    response
}

async fn raw_request(server: &AppServer, id: u64, method: &str, params: Value) -> Value {
    server
        .handle_json_line(
            &json!({
                "jsonrpc": "2.0", "id": id, "method": method, "params": params
            })
            .to_string(),
        )
        .await
        .unwrap()
        .iter()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|value| value["id"] == id)
        .unwrap()
}
