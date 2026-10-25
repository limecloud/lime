use super::install::{archive, issuer, Issuer};
use super::support::*;
use app_server::AppServer;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

const GLOBAL: &str = "openai-curated-remote";
const SCHEMA: &str = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

async fn setup(scope: &str) -> (TempDir, Issuer, AppServer) {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    issuer.plugin.lock().unwrap()["scope"] = json!(scope);
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    (temp, issuer, server)
}

async fn install(server: &AppServer, marketplace: &str) -> Value {
    raw(
        server,
        "plugin/install",
        Some(json!({"pluginName":"opaque~install","remoteMarketplaceName":marketplace})),
    )
    .await
}

fn root(temp: &Path, marketplace: &str) -> PathBuf {
    temp.join(format!("agent/plugins/cache/{marketplace}/research/1.2.3"))
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

async fn app_ids(server: &AppServer) -> Vec<String> {
    rpc(server, "app/list", Some(json!({}))).await["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|app| app["id"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn global_preparation_overwrites_native_version_and_preserves_complete_apps_document() {
    let (temp, issuer, server) = setup("GLOBAL").await;
    let manifest = json!({"name":"research","version":42,"apps":"./nested/connectors.json",
        "future":{"nested":["preserved",true]}});
    let apps = json!({"apps":{"Research":{"id":"app-1","category":"Research",
        "future":{"nested":[1,2]}}},"future":["top-level",null]});
    issuer.plugin.lock().unwrap()["release"]["app_manifest"] = apps.clone();
    *issuer.bundle.lock().unwrap() = archive(&[
        (".lime-plugin/plugin.json", manifest.to_string().as_bytes()),
        (".app.json", br#"{"apps":{"old":{"id":"old"}}}"#),
    ]);
    let result = install(&server, GLOBAL).await;
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(result["result"]["appsNeedingAuth"][0]["id"], "app-1");
    let root = root(temp.path(), GLOBAL);
    let mut expected = manifest;
    expected["version"] = json!("1.2.3");
    assert_eq!(read_json(&root.join(".lime-plugin/plugin.json")), expected);
    assert_eq!(read_json(&root.join("nested/connectors.json")), apps);
    assert!(std::fs::read(root.join("nested/connectors.json"))
        .unwrap()
        .ends_with(b"\n"));
    assert_eq!(
        read_json(&root.join(".app.json"))["apps"]["old"]["id"],
        "old"
    );
    assert_eq!(app_ids(&server).await, ["app-1"]);
    let cold = super::support::server(temp.path()).await;
    assert_eq!(app_ids(&cold).await, ["app-1"]);
}

#[tokio::test]
async fn global_preparation_keeps_portable_manifest_bytes_and_resolves_inline_or_overlay_apps() {
    for inline in [true, false] {
        let (temp, issuer, server) = setup("GLOBAL").await;
        let mut manifest = json!({"$schema":SCHEMA,"name":"research","version":"portable-original",
            "future":{"keep":"original bytes"}});
        let extension = json!({"apps":"./custom/apps.json"});
        if inline {
            manifest["extensions"] = json!({"com.lime":extension});
        } else {
            manifest.as_object_mut().unwrap().remove("version");
        }
        let original = format!("{}\n\n", serde_json::to_string_pretty(&manifest).unwrap());
        let overlay = extension.to_string();
        let mut files = vec![("plugin.json", original.as_bytes())];
        if !inline {
            files.push((".lime-plugin/plugin.json", overlay.as_bytes()));
        }
        *issuer.bundle.lock().unwrap() = archive(&files);
        let result = install(&server, GLOBAL).await;
        assert!(result.get("error").is_none(), "inline={inline}: {result}");
        let root = root(temp.path(), GLOBAL);
        assert_eq!(
            std::fs::read(root.join("plugin.json")).unwrap(),
            original.as_bytes()
        );
        if !inline {
            assert_eq!(
                std::fs::read(root.join(".lime-plugin/plugin.json")).unwrap(),
                overlay.as_bytes()
            );
        }
        assert_eq!(
            read_json(&root.join("custom/apps.json"))["apps"]["Research"]["id"],
            "app-1"
        );
        assert!(result["result"]["appsNeedingAuth"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(app_ids(&server).await.is_empty());
    }
}

#[tokio::test]
async fn global_preparation_distinguishes_missing_null_and_explicit_empty_apps() {
    for replacement in [
        None,
        Some(Value::Null),
        Some(json!({})),
        Some(json!({"apps":{}})),
    ] {
        let (temp, issuer, server) = setup("GLOBAL").await;
        let bundled = br#"{"apps":{"Bundled":{"id":"bundled-app"}},"future":true}"#;
        *issuer.bundle.lock().unwrap() = archive(&[
            (".lime-plugin/plugin.json", br#"{"name":"research"}"#),
            (".app.json", bundled),
        ]);
        {
            let mut plugin = issuer.plugin.lock().unwrap();
            let release = &mut plugin["release"];
            release.as_object_mut().unwrap().remove("app_manifest");
            if let Some(value) = &replacement {
                release["app_manifest"] = value.clone();
            }
        }
        let result = install(&server, GLOBAL).await;
        assert!(
            result.get("error").is_none(),
            "replacement={replacement:?}: {result}"
        );
        let path = root(temp.path(), GLOBAL).join(".app.json");
        if let Some(value) = replacement.filter(|value| !value.is_null()) {
            assert_eq!(read_json(&path), value);
            assert!(app_ids(&server).await.is_empty());
        } else {
            assert_eq!(std::fs::read(path).unwrap(), bundled);
            assert_eq!(app_ids(&server).await, ["bundled-app"]);
        }
    }
}

#[tokio::test]
async fn non_global_preparation_preserves_bundled_version_and_apps() {
    for (scope, marketplace) in [
        ("USER", "created-by-me-remote"),
        ("WORKSPACE", "workspace-directory"),
    ] {
        let (temp, issuer, server) = setup(scope).await;
        let manifest = br#"{"name":"research","version":"bundled","apps":"./nested/apps.json"}"#;
        let apps = br#"{"apps":{"Bundled":{"id":"bundled-app"}},"unknown":true}"#;
        *issuer.bundle.lock().unwrap() = archive(&[
            (".lime-plugin/plugin.json", manifest),
            ("nested/apps.json", apps),
        ]);
        let result = install(&server, marketplace).await;
        assert!(result.get("error").is_none(), "{scope}: {result}");
        let root = root(temp.path(), marketplace);
        assert_eq!(
            std::fs::read(root.join(".lime-plugin/plugin.json")).unwrap(),
            manifest
        );
        assert_eq!(std::fs::read(root.join("nested/apps.json")).unwrap(), apps);
        assert_eq!(app_ids(&server).await, ["bundled-app"]);
        let installed = rpc(&server, "plugin/installed", Some(json!({}))).await;
        assert_eq!(
            installed["marketplaces"][0]["plugins"][0]["localVersion"],
            "1.2.3"
        );
    }
}

#[tokio::test]
async fn global_preparation_ignores_escaping_apps_paths_and_uses_default() {
    for apps_path in [
        "../outside.json",
        "./../outside.json",
        "./nested/../../outside.json",
        "./C:/outside.json",
        "./nested/file:stream",
        "./\\outside.json",
        "./nested\\..\\outside.json",
    ] {
        let (temp, issuer, server) = setup("GLOBAL").await;
        let manifest = json!({"name":"research","apps":apps_path});
        *issuer.bundle.lock().unwrap() =
            archive(&[(".lime-plugin/plugin.json", manifest.to_string().as_bytes())]);
        let result = install(&server, GLOBAL).await;
        assert!(result.get("error").is_none(), "{apps_path}: {result}");
        assert_eq!(
            read_json(&root(temp.path(), GLOBAL).join(".app.json"))["apps"]["Research"]["id"],
            "app-1"
        );
        assert_eq!(app_ids(&server).await, ["app-1"]);
        assert!(!temp.path().join("outside.json").exists());
    }
}

#[tokio::test]
async fn global_preparation_failure_preserves_previous_cache_config_and_apps() {
    let (temp, issuer, server) = setup("GLOBAL").await;
    assert!(install(&server, GLOBAL).await.get("error").is_none());
    let before = rpc(&server, "plugin/installed", Some(json!({}))).await;
    let path = root(temp.path(), GLOBAL).join(".lime-plugin/plugin.json");
    let manifest_before = std::fs::read(&path).unwrap();
    for files in [
        vec![(".lime-plugin/plugin.json", br#"{"name":"research","apps":"./blocked/apps.json"}"#.as_slice()), ("blocked", b"file".as_slice())],
        vec![(".lime-plugin/plugin.json", br#"{"name":"research","apps":"./.lime-plugin/plugin.json"}"#.as_slice())],
        vec![("plugin.json", br#"{"$schema":"https://agent-plugins.org/schemas/9.0.0/plugin.schema.json","name":"research"}"#.as_slice())],
    ] {
        *issuer.bundle.lock().unwrap() = archive(&files);
        let result = install(&server, GLOBAL).await;
        assert!(result.get("error").is_some(), "{result}");
        assert_eq!(rpc(&server, "plugin/installed", Some(json!({}))).await, before);
        assert_eq!(std::fs::read(&path).unwrap(), manifest_before);
        assert_eq!(app_ids(&server).await, ["app-1"]);
    }
}

#[tokio::test]
async fn global_preparation_real_stdio_peers_consume_same_version_apps_and_uninstall() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    issuer.plugin.lock().unwrap()["scope"] = json!("GLOBAL");
    let binary = super::stdio::fixed_binary();
    let mut first = super::stdio::Peer::start(temp.path(), &binary).await;
    first
        .rpc("account/login/start", Some(login(&issuer.url)))
        .await;
    let result = first
        .rpc(
            "plugin/install",
            Some(json!({
                "pluginName":"opaque~install","remoteMarketplaceName":GLOBAL
            })),
        )
        .await;
    assert_eq!(result["appsNeedingAuth"][0]["id"], "app-1");
    let mut peer = super::stdio::Peer::start(temp.path(), &binary).await;
    let installed = peer.rpc("plugin/installed", Some(json!({}))).await;
    assert_eq!(
        installed["marketplaces"][0]["plugins"][0]["localVersion"],
        "1.2.3"
    );
    assert_eq!(
        peer.rpc("app/list", Some(json!({}))).await["data"][0]["id"],
        "app-1"
    );
    assert_eq!(
        read_json(&root(temp.path(), GLOBAL).join(".lime-plugin/plugin.json"))["version"],
        "1.2.3"
    );
    peer.rpc(
        "plugin/uninstall",
        Some(json!({"pluginId":"research@openai-curated-remote"})),
    )
    .await;
    assert_eq!(
        first.rpc("app/list", Some(json!({}))).await["data"],
        json!([])
    );
    assert_eq!(
        first.rpc("plugin/installed", Some(json!({}))).await["marketplaces"],
        json!([])
    );
    peer.close().await;
    first.close().await;
}
