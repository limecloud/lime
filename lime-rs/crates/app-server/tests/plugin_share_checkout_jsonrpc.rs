use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

#[allow(dead_code)]
#[path = "remote_plugins_jsonrpc/support.rs"]
mod support;
use support::{item, login, page, raw, rpc, server_with_home, session, TOKEN};
#[allow(dead_code)]
#[path = "plugin_share_jsonrpc/http.rs"]
mod http;
use http::{finish, fixture, Reply};

fn shared() -> Value {
    let mut value = item("opaque~1", "research");
    value["discoverability"] = json!("PRIVATE");
    value["creator_account_user_id"] = json!("one");
    value["share_principals"] =
        json!([{"principal_type":"user","principal_id":"one","role":"owner","name":"Owner"}]);
    value["release"]["bundle_download_url"] = json!("$ORIGIN/download?signature=checkout-secret");
    value
}

fn bundle(name: &str) -> Vec<u8> {
    let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    let mut archive = tar::Builder::new(encoder);
    for (path, content) in [
        (
            ".lime-plugin/plugin.json",
            json!({"name":name}).to_string(),
        ),
        (".hidden", "package bytes".into()),
    ] {
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        archive
            .append_data(&mut header, path, content.as_bytes())
            .unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap()
}

fn home(root: &Path) -> PathBuf {
    let home = root.join("home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::canonicalize(home).unwrap()
}

fn checkout_params() -> Option<Value> {
    Some(json!({"remotePluginId":"opaque~1"}))
}

#[tokio::test]
async fn checkout_rpc_cold_reuses_edits_and_saves_same_remote_id_without_installing() {
    let temp = TempDir::new().unwrap();
    let home = home(temp.path());
    let app = server_with_home(temp.path(), Some(home.clone())).await;
    let mut newer = shared();
    newer["release"]["version"] = json!("2.0.0");
    let (url, task) = fixture(vec![
        Reply::json(session("one")), Reply::json(shared()), Reply::binary(bundle("research")),
        Reply::json(newer),
        Reply::json(json!({"file_id":"file-1","etag":"etag-1","upload_url":"$ORIGIN/upload?cap=upload-secret"})),
        Reply::empty(201),
        Reply::json(json!({"plugin_id":"opaque~1","share_url":"$ORIGIN/share/opaque~1"})),
        Reply::json(page(vec![shared()], None)), Reply::json(page(vec![], None)),
    ]).await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let result = rpc(&app, "plugin/share/checkout", checkout_params()).await;
    let path = home.join("plugins/research");
    let marketplace = home.join(".agents/plugins/marketplace.json");
    assert_eq!(
        result,
        json!({"remotePluginId":"opaque~1","pluginId":"research@lime-curated","pluginName":"research",
        "pluginPath":path,"marketplaceName":"lime-curated","marketplacePath":marketplace,"remoteVersion":"1.2.3"})
    );
    assert!(!result.to_string().contains("checkout-secret"));
    assert_eq!(
        std::fs::read_to_string(path.join(".hidden")).unwrap(),
        "package bytes"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(path.join(".hidden"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
    }
    let detail = rpc(
        &app,
        "plugin/read",
        Some(json!({"marketplacePath":marketplace,"pluginName":"research"})),
    )
    .await;
    assert_eq!(detail["plugin"]["summary"]["installed"], false);
    assert!(!temp.path().join("plugins/cache").exists());
    std::fs::write(path.join(".hidden"), "user edits").unwrap();
    let cold = server_with_home(temp.path(), Some(home)).await;
    let repeated = rpc(&cold, "plugin/share/checkout", checkout_params()).await;
    assert_eq!(repeated["remoteVersion"], "2.0.0");
    assert_eq!(repeated["pluginPath"], result["pluginPath"]);
    assert_eq!(
        std::fs::read_to_string(path.join(".hidden")).unwrap(),
        "user edits"
    );
    rpc(
        &cold,
        "plugin/share/save",
        Some(json!({"pluginPath":path,"remotePluginId":"opaque~1"})),
    )
    .await;
    let listed = rpc(&cold, "plugin/share/list", Some(json!({}))).await;
    assert_eq!(listed["data"][0]["localPluginPath"], result["pluginPath"]);
    assert_eq!(listed["data"][0]["plugin"]["installed"], false);
    let requests = finish(task).await;
    for index in [1, 3] {
        assert!(requests[index].headers.starts_with("GET /api/v1/public/tenants/tenant-one/client/ps/plugins/opaque~1?includeDownloadUrls=true "));
    }
    assert!(requests[2]
        .headers
        .starts_with("GET /download?signature=checkout-secret "));
    assert!(requests[5]
        .headers
        .starts_with("PUT /upload?cap=upload-secret "));
    for index in [2, 5] {
        let headers = requests[index].headers.to_lowercase();
        assert!(
            !headers.contains("authorization:")
                && !headers.contains("cookie:")
                && !headers.contains(TOKEN)
        );
    }
    let upload: Value = serde_json::from_slice(&requests[4].body).unwrap();
    assert_eq!(upload["plugin_id"], "opaque~1");
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(requests[5].body.as_slice()));
    let edited = tar.entries().unwrap().find_map(|entry| {
        let mut entry = entry.unwrap();
        if entry.path().unwrap() != Path::new(".hidden") {
            return None;
        }
        let mut text = String::new();
        entry.read_to_string(&mut text).unwrap();
        Some(text)
    });
    assert_eq!(edited.as_deref(), Some("user edits"));
    assert!(requests
        .iter()
        .all(|request| !request.headers.contains("/install ")
            && !request.headers.contains("/uninstall ")));
}

#[tokio::test]
async fn checkout_rpc_requires_authorized_shared_workspace_identity() {
    let mut cases = Vec::new();
    for scope in ["GLOBAL", "USER"] {
        let mut value = shared();
        value["scope"] = json!(scope);
        cases.push(value);
    }
    let mut listed = shared();
    listed["discoverability"] = json!("LISTED");
    cases.push(listed);
    let mut missing = shared();
    missing.as_object_mut().unwrap().remove("share_principals");
    cases.push(missing);
    let mut missing = shared();
    missing
        .as_object_mut()
        .unwrap()
        .remove("creator_account_user_id");
    cases.push(missing);
    let mut wrong = shared();
    wrong["id"] = json!("another-id");
    cases.push(wrong);
    for detail in cases {
        let temp = TempDir::new().unwrap();
        let home = home(temp.path());
        let app = server_with_home(temp.path(), Some(home.clone())).await;
        assert!(
            raw(&app, "plugin/share/checkout", checkout_params()).await["error"]["message"]
                .as_str()
                .unwrap()
                .contains("authentication required")
        );
        let (url, task) = fixture(vec![Reply::json(session("one")), Reply::json(detail)]).await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        assert!(raw(&app, "plugin/share/checkout", checkout_params()).await["error"].is_object());
        assert!(!home.join("plugins/research").exists());
        assert!(!home.join(".agents/plugins/marketplace.json").exists());
        assert_eq!(finish(task).await.len(), 2);
    }
}

#[tokio::test]
async fn checkout_rpc_protects_existing_directory_and_refuses_foreign_or_missing_bundle_url() {
    for scenario in [
        "existing",
        "bad-url",
        "missing-url",
        "missing-version",
        "home-unavailable",
    ] {
        let temp = TempDir::new().unwrap();
        let home = home(temp.path());
        let app = server_with_home(
            temp.path(),
            (scenario != "home-unavailable").then(|| home.clone()),
        )
        .await;
        let mut detail = shared();
        if scenario == "existing" {
            std::fs::create_dir_all(home.join("plugins/research")).unwrap();
            std::fs::write(home.join("plugins/research/keep"), "user bytes").unwrap();
        }
        if scenario == "bad-url" {
            detail["release"]["bundle_download_url"] =
                json!("http://another.invalid/download?signature=checkout-secret");
        }
        if scenario == "missing-url" {
            detail["release"]["bundle_download_url"] = Value::Null;
        }
        if scenario == "missing-version" {
            detail["release"]["version"] = Value::Null;
        }
        let (url, task) = fixture(vec![Reply::json(session("one")), Reply::json(detail)]).await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        let response = raw(&app, "plugin/share/checkout", checkout_params()).await;
        assert!(response["error"].is_object(), "{scenario}: {response}");
        assert!(!response.to_string().contains("checkout-secret"));
        assert!(!home.join(".agents/plugins/marketplace.json").exists());
        if scenario == "existing" {
            assert_eq!(
                std::fs::read_to_string(home.join("plugins/research/keep")).unwrap(),
                "user bytes"
            );
        }
        assert_eq!(finish(task).await.len(), 2);
    }
}

#[tokio::test]
async fn checkout_rpc_does_not_register_invalid_or_failed_downloads_or_malformed_marketplace() {
    let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugin-archive");
    for (name, response) in [
        ("corrupt", Reply::binary(b"invalid gzip".to_vec())),
        (
            "link",
            Reply::binary(std::fs::read(fixture_root.join("symlink.tar.gz")).unwrap()),
        ),
        ("wrong-name", Reply::binary(bundle("different"))),
        (
            "http-denied",
            Reply::status(403, json!({"message":"checkout-secret"})),
        ),
        ("marketplace", Reply::binary(bundle("research"))),
    ] {
        let temp = TempDir::new().unwrap();
        let home = home(temp.path());
        let app = server_with_home(temp.path(), Some(home.clone())).await;
        let marketplace = home.join(".agents/plugins/marketplace.json");
        if name == "marketplace" {
            std::fs::create_dir_all(marketplace.parent().unwrap()).unwrap();
            std::fs::write(&marketplace, "not JSON").unwrap();
        }
        let (url, task) = fixture(vec![
            Reply::json(session("one")),
            Reply::json(shared()),
            response,
        ])
        .await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        let result = raw(&app, "plugin/share/checkout", checkout_params()).await;
        assert!(result["error"].is_object(), "{name}: {result}");
        assert!(!result.to_string().contains("checkout-secret"));
        assert!(!home.join("plugins/research").exists());
        if name == "marketplace" {
            assert_eq!(std::fs::read_to_string(marketplace).unwrap(), "not JSON");
        } else {
            assert!(!marketplace.exists());
        }
        assert_eq!(finish(task).await.len(), 3);
    }
}

#[tokio::test]
async fn checkout_rpc_serializes_two_servers_and_downloads_only_once() {
    let temp = TempDir::new().unwrap();
    let home = home(temp.path());
    let app = server_with_home(temp.path(), Some(home.clone())).await;
    let peer = server_with_home(temp.path(), Some(home.clone())).await;
    let (url, task) = fixture(vec![
        Reply::json(session("one")),
        Reply::json(shared()),
        Reply::binary(bundle("research")),
        Reply::json(shared()),
    ])
    .await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let (first, second) = tokio::join!(
        rpc(&app, "plugin/share/checkout", checkout_params()),
        rpc(&peer, "plugin/share/checkout", checkout_params())
    );
    assert_eq!(first, second);
    assert_eq!(
        std::fs::read_to_string(home.join("plugins/research/.hidden")).unwrap(),
        "package bytes"
    );
    let requests = finish(task).await;
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.headers.starts_with("GET /download?"))
            .count(),
        1
    );
}

#[tokio::test]
async fn checkout_rpc_checks_shared_account_after_download_before_registering() {
    use std::sync::Arc;
    use tokio::io::AsyncWriteExt;
    let temp = TempDir::new().unwrap();
    let home = home(temp.path());
    let app = Arc::new(server_with_home(temp.path(), Some(home.clone())).await);
    let peer = server_with_home(temp.path(), Some(home.clone())).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let origin = url.clone();
    let (entered, pending_download) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        http::receive(&mut socket).await;
        support::respond(&mut socket, session("one")).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        http::receive(&mut socket).await;
        let mut detail = shared();
        detail["release"]["bundle_download_url"] =
            json!(format!("{origin}/download?signature=checkout-secret"));
        support::respond(&mut socket, detail).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = http::receive(&mut socket).await;
        assert!(!request.headers.to_lowercase().contains("authorization:"));
        entered.send(()).unwrap();
        released.await.unwrap();
        let bytes = bundle("research");
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    bytes.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        socket.write_all(&bytes).await.unwrap();
    });
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let querying = app.clone();
    let pending =
        tokio::spawn(
            async move { raw(&querying, "plugin/share/checkout", checkout_params()).await },
        );
    tokio::time::timeout(std::time::Duration::from_secs(10), pending_download)
        .await
        .unwrap()
        .unwrap();
    rpc(&peer, "account/logout", None).await;
    release.send(()).unwrap();
    let result = pending.await.unwrap();
    assert!(result["error"]["message"]
        .as_str()
        .unwrap()
        .contains("account changed"));
    assert!(!result.to_string().contains("checkout-secret"));
    assert!(!home.join("plugins/research").exists());
    assert!(!home.join(".agents/plugins/marketplace.json").exists());
    task.await.unwrap();
}
