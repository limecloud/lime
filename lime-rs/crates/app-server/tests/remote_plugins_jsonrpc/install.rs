use super::support::*;
use app_server::AppServer;
use flate2::{write::GzEncoder, Compression};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use tokio::io::AsyncWriteExt;

type ResponseGate = Arc<
    Mutex<
        Option<(
            tokio::sync::oneshot::Sender<()>,
            tokio::sync::oneshot::Receiver<()>,
        )>,
    >,
>;

pub(super) struct Issuer {
    pub(super) url: String,
    user: Arc<Mutex<String>>,
    pub(super) bundle: Arc<Mutex<Vec<u8>>>,
    pub(super) plugin: Arc<Mutex<Value>>,
    pub(super) requests: Arc<Mutex<Vec<String>>>,
    pub(super) mutation_reply: Arc<Mutex<Option<(u16, Value)>>>,
    task: tokio::task::JoinHandle<()>,
    gate: ResponseGate,
    pub(super) mutation_gate: ResponseGate,
    pub(super) remotely_installed: Arc<Mutex<bool>>,
    pub(super) installed_replies: Arc<Mutex<VecDeque<(u16, Value)>>>,
    pub(super) installed_gate: ResponseGate,
}

impl Drop for Issuer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn package(name: &str) -> Vec<u8> {
    let manifest = json!({"name":name,"version":"bundle-version","skills":"./skills"}).to_string();
    archive(&[
        (".lime-plugin/plugin.json", manifest.as_bytes()),
        (
            "skills/research/SKILL.md",
            b"---\nname: research\ndescription: Research fixture\n---\nResearch carefully"
                .as_slice(),
        ),
        (".mcp.json", br#"{"mcpServers":{"search":{"command":"node","args":["--version"]}}}"#.as_slice()),
        ("hooks/hooks.json", br#"{"hooks":{"PreToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":"echo plugin-fixture"}]}]}}"#.as_slice()),
    ])
}

pub(super) fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut archive = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
    for &(path, content) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive.append_data(&mut header, path, content).unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap()
}

pub(super) async fn issuer() -> Issuer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let user = Arc::new(Mutex::new("one".to_string()));
    let bundle = Arc::new(Mutex::new(package("research")));
    let plugin = Arc::new(Mutex::new(item("opaque~install", "research")));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let gate = Arc::new(Mutex::new(
        None::<(
            tokio::sync::oneshot::Sender<()>,
            tokio::sync::oneshot::Receiver<()>,
        )>,
    ));
    let state = (url.clone(), user.clone(), bundle.clone(), requests.clone());
    let mutation_reply = Arc::new(Mutex::new(None::<(u16, Value)>));
    let replies = mutation_reply.clone();
    let mutation_gate: ResponseGate = Arc::new(Mutex::new(None));
    let response_gate = mutation_gate.clone();
    let bundle_gate = gate.clone();
    let current_plugin = plugin.clone();
    let remotely_installed = Arc::new(Mutex::new(false));
    let installed_state = remotely_installed.clone();
    let installed_replies = Arc::new(Mutex::new(VecDeque::<(u16, Value)>::new()));
    let installed_responses = installed_replies.clone();
    let installed_gate: ResponseGate = Arc::new(Mutex::new(None));
    let snapshot_gate = installed_gate.clone();
    let task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let request = receive(&mut socket).await;
            let path = request
                .lines()
                .next()
                .unwrap()
                .split_whitespace()
                .nth(1)
                .unwrap();
            let mut status = 200;
            let (content_type, body) = if path.starts_with("/signed-bundle?") {
                assert!(!request.to_ascii_lowercase().contains("authorization:"));
                let held = bundle_gate.lock().unwrap().take();
                if let Some((started, release)) = held {
                    let _ = started.send(());
                    release.await.unwrap();
                }
                ("application/gzip", state.2.lock().unwrap().clone())
            } else {
                assert!(request.contains(TOKEN));
                let body = if path.ends_with("/session") {
                    session(&state.1.lock().unwrap())
                } else if path.contains("/install?") || path.ends_with("/uninstall") {
                    let held = response_gate.lock().unwrap().take();
                    if let Some((started, release)) = held {
                        let _ = started.send(());
                        release.await.unwrap();
                    }
                    if let Some((code, response)) = replies.lock().unwrap().clone() {
                        status = code;
                        response
                    } else {
                        *installed_state.lock().unwrap() = !path.ends_with("/uninstall");
                        json!({"id":current_plugin.lock().unwrap()["id"],"enabled":!path.ends_with("/uninstall")})
                    }
                } else if path.contains("/installed?") {
                    let held = snapshot_gate.lock().unwrap().take();
                    if let Some((started, release)) = held {
                        let _ = started.send(());
                        release.await.unwrap();
                    }
                    if let Some((code, response)) = installed_responses.lock().unwrap().pop_front()
                    {
                        status = code;
                        response
                    } else {
                        let mut plugin = current_plugin.lock().unwrap().clone();
                        plugin["release"]["bundle_download_url"] =
                            json!(format!("{}/signed-bundle?signature=private", state.0));
                        plugin["enabled"] = json!(true);
                        page(
                            if *installed_state.lock().unwrap() {
                                vec![plugin]
                            } else {
                                Vec::new()
                            },
                            None,
                        )
                    }
                } else {
                    let mut plugin = current_plugin.lock().unwrap().clone();
                    plugin["release"]["bundle_download_url"] =
                        json!(format!("{}/signed-bundle?signature=private", state.0));
                    if path.contains("/list?") {
                        page(vec![plugin], None)
                    } else {
                        plugin
                    }
                };
                ("application/json", body.to_string().into_bytes())
            };
            state.3.lock().unwrap().push(request);
            let header = format!("HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = socket.write_all(header.as_bytes()).await;
            let _ = socket.write_all(&body).await;
        }
    });
    Issuer {
        url,
        user,
        bundle,
        plugin,
        requests,
        mutation_reply,
        mutation_gate,
        remotely_installed,
        installed_replies,
        installed_gate,
        task,
        gate,
    }
}

#[tokio::test]
async fn remote_install_discards_download_after_peer_logout_and_preserves_previous_package() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    assert!(install(&server).await.get("error").is_none());
    let base = temp
        .path()
        .join("agent/plugins/cache/workspace-directory/research");
    let before = std::fs::read(base.join(".lime-remote-plugin-install.json")).unwrap();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    *issuer.gate.lock().unwrap() = Some((started, released));
    let peer = super::support::server(temp.path()).await;
    let (result, ()) = tokio::join!(install(&server), async {
        ready.await.unwrap();
        rpc(&peer, "account/logout", None).await;
        release.send(()).unwrap();
    });
    assert!(result.get("error").is_some(), "{result}");
    assert_eq!(
        std::fs::read(base.join(".lime-remote-plugin-install.json")).unwrap(),
        before
    );
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
}

async fn install(server: &AppServer) -> Value {
    raw(server, "plugin/install", detail("opaque~install")).await
}

async fn installed(server: &AppServer) -> Value {
    rpc(server, "plugin/installed", Some(json!({}))).await
}

fn summary(response: &Value) -> &Value {
    &response["marketplaces"][0]["plugins"][0]
}

#[tokio::test]
async fn remote_tar_gz_install_persists_shared_provenance_and_cold_read_model_then_uninstalls() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    let result = install(&server).await;
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(
        result["result"],
        json!({"authPolicy":"ON_USE","appsNeedingAuth":[]})
    );
    let response = installed(&server).await;
    let plugin = summary(&response);
    assert_eq!(plugin["id"], "research@workspace-directory");
    assert_eq!(plugin["remotePluginId"], "opaque~install");
    assert_eq!(plugin["source"], json!({"type":"remote"}));
    assert_eq!(plugin["localVersion"], "1.2.3");
    assert_eq!(plugin["installed"], true);
    assert_eq!(plugin["enabled"], true);
    let listed = rpc(&server, "plugin/list", workspace()).await;
    assert_eq!(summary(&listed)["installed"], true);
    let details = rpc(&server, "plugin/read", detail("opaque~install")).await;
    assert_eq!(details["plugin"]["skills"][0]["name"], "research");
    assert_eq!(details["plugin"]["skills"][0]["path"], Value::Null);
    assert_eq!(
        details["plugin"]["onboardingSkill"],
        details["plugin"]["skills"][0]
    );
    assert_eq!(details["plugin"]["mcpServers"], json!(["search"]));
    assert_eq!(details["plugin"]["hooks"], json!([]));
    for enabled in [false, true] {
        rpc(
            &server,
            "config/batchWrite",
            Some(json!({"edits":[{
                "keyPath":"plugins.\"research@workspace-directory\".enabled", "value":enabled,
                "mergeStrategy":"replace"
            }]})),
        )
        .await;
        let detail = rpc(
            &server,
            "plugin/read",
            super::support::detail("opaque~install"),
        )
        .await;
        assert_eq!(detail["plugin"]["summary"]["enabled"], enabled);
        assert_eq!(detail["plugin"]["skills"][0]["enabled"], true);
        assert_eq!(detail["plugin"]["onboardingSkill"].is_null(), !enabled);
    }
    let metadata = std::fs::read(temp.path().join(
        "agent/plugins/cache/workspace-directory/research/.lime-remote-plugin-install.json",
    ))
    .unwrap();
    let metadata: Value = serde_json::from_slice(&metadata).unwrap();
    assert_eq!(metadata["schema_version"], 1);
    assert_eq!(metadata["remote_plugin_id"], "opaque~install");
    assert!(!metadata.to_string().contains(TOKEN));
    assert!(!metadata.to_string().contains("signature"));
    assert!(!metadata.to_string().contains(&issuer.url));
    let cold = super::support::server(temp.path()).await;
    assert_eq!(summary(&installed(&cold).await), plugin);
    rpc(
        &cold,
        "plugin/uninstall",
        Some(json!({"pluginId":"research@workspace-directory"})),
    )
    .await;
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
    assert!(issuer.requests.lock().unwrap().iter().any(|request| request.starts_with("GET /api/v1/public/tenants/tenant-one/client/ps/plugins/opaque~install?includeDownloadUrls=true ")));
}

#[tokio::test]
async fn remote_install_failure_keeps_previous_cache_and_other_accounts_cannot_read_or_remove_it() {
    let temp = TempDir::new().unwrap();
    let issuer = issuer().await;
    let server = server(temp.path()).await;
    rpc(&server, "account/login/start", Some(login(&issuer.url))).await;
    assert!(install(&server).await.get("error").is_none());
    let before = installed(&server).await;
    for bytes in [b"PK\x03\x04not gzip".to_vec(), package("different-name")] {
        *issuer.bundle.lock().unwrap() = bytes;
        assert!(install(&server).await.get("error").is_some());
        assert_eq!(installed(&server).await, before);
    }
    let peer = super::support::server(temp.path()).await;
    rpc(&peer, "account/logout", None).await;
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
    *issuer.user.lock().unwrap() = "two".into();
    rpc(&peer, "account/login/start", Some(login(&issuer.url))).await;
    assert_eq!(installed(&server).await["marketplaces"], json!([]));
    assert!(raw(
        &peer,
        "plugin/uninstall",
        Some(json!({"pluginId":"research@workspace-directory"}))
    )
    .await
    .get("error")
    .is_some());
    *issuer.user.lock().unwrap() = "one".into();
    rpc(&peer, "account/login/start", Some(login(&issuer.url))).await;
    assert_eq!(installed(&server).await, before);
}
