//! Opt-in native market -> HTTPS MCP acceptance. Identity, catalog, browser and
//! model are explicit fixtures; TLS verification and the MCP runtime are real.
#[path = "account_jsonrpc/issuer.rs"]
mod issuer;
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use support::json_lines_transport::TransportClient;

fn artifact(f: &issuer::Fixture, mode: &str) -> Value {
    let scopes = if mode == "oauth2" {
        r#""research:read""#
    } else {
        ""
    };
    // Field order is the published Cloud manifest contract, including [] scopes.
    let manifest = format!(
        r#"{{"schema_version":1,"kind":"mcp","name":"research","version":"1.0.0","title":{{"source":"Research"}},"description":{{"source":"Search research"}},"license":"MIT","hosts":[{{"id":"lime","min_version":"1.0.0","capabilities":["mcp"]}}],"files":[],"mcp":{{"transport":"http","endpoint":"https://market-mcp.test.invalid/{mode}/mcp","auth":{{"type":"{mode}","scopes":[{scopes}]}},"tools":["search"]}}}}"#
    );
    let bytes = hex::decode("504b0506000000000000000000000000000000000000").unwrap();
    let release = json!({
        "id":format!("rel_{mode}"),"itemId":format!("item_{mode}"),
        "manifest":serde_json::from_str::<Value>(&manifest).unwrap(),
        "manifestSha256":hex::encode(Sha256::digest(manifest.as_bytes())),
        "archiveSha256":hex::encode(Sha256::digest(&bytes)),"archiveSize":bytes.len(),
        "status":"approved","revision":1
    });
    let item = json!({
        "id":release["itemId"],"publisherApplicationId":"publisher","environment":"sandbox",
        "kind":"mcp","name":"research","publishedReleaseId":release["id"],"revision":1,
        "release":release,"compatibility":{"status":"supported","reasons":[]}
    });
    for (path, body) in [
        (format!("/market/items/item_{mode}"), item.clone()),
        (format!("/market/releases/rel_{mode}"), release.clone()),
        (
            "/market/acquisitions".into(),
            json!({"id":"acquired","releaseId":release["id"],"status":"active","revision":1}),
        ),
        (
            "/market/acquisitions/acquired/download-tickets".into(),
            json!({
                "sha256":release["archiveSha256"],"size":bytes.len(),"download":{
                    "url":format!("{}/bundle",f.base),"method":"GET","headers":{},
                    "expiresAt":(chrono::Utc::now()+chrono::Duration::minutes(5)).to_rfc3339()
                }
            }),
        ),
    ] {
        f.respond(&format!("/api/v1/client{path}"), 200, body);
    }
    f.state
        .lock()
        .unwrap()
        .responses
        .insert("/bundle".into(), (200, bytes));
    item
}

async fn login(peer: &mut TransportClient, f: &issuer::Fixture, resource: &str) {
    let started = peer
        .request_ok(
            2,
            "account/login/start",
            json!({"type":"cloud","resource":resource,"language":"zh-CN"}),
        )
        .await;
    f.callback(started["result"]["authUrl"].as_str().unwrap())
        .await;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let read = peer.request_ok(3, "account/read", json!({})).await;
            let authorization = read["result"]["authorizations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"] == started["result"]["authorization"]["id"])
                .unwrap();
            match authorization["status"].as_str() {
                Some("completed") => break,
                Some("pending" | "exchanging") => tokio::task::yield_now().await,
                state => panic!("native {resource} authorization: {state:?}"),
            }
        }
    })
    .await
    .expect("native authorization must complete");
}

async fn status(peer: &mut TransportClient, name: &str) -> Value {
    let read = peer.request_ok(4, "mcpServerStatus/list", json!({})).await;
    read["result"]["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == name)
        .unwrap()
        .clone()
}

async fn thread(peer: &mut TransportClient, root: &Path) -> String {
    let read = peer
        .request_ok(
            10,
            "thread/start",
            json!({
                "cwd":root,"modelProvider":"http-mcp-model","model":Wire::Chat.model(),
                "config":{"approval_policy":"never"}
            }),
        )
        .await;
    let thread = read["result"]["thread"]["id"].as_str().unwrap().to_owned();
    let turn = peer
        .request_ok(
            11,
            "turn/start",
            json!({"threadId":thread,"input":[
                {"type":"text","text":"Prepare the research tools."}
            ]}),
        )
        .await;
    peer.wait_for_turn_completed(&thread, turn["result"]["turn"]["id"].as_str().unwrap())
        .await;
    thread
}

async fn call(peer: &mut TransportClient, thread: &str, name: &str, query: &str) -> Value {
    peer.request(
        12,
        "mcpServer/tool/call",
        json!({
            "threadId":thread,"server":name,"tool":"search","arguments":{"query":query}
        }),
    )
    .await
}

fn assert_call(read: &Value, query: &str) {
    assert!(
        read.get("error").is_none(),
        "HTTP MCP call failed: {read:#}"
    );
    assert_eq!(
        read["result"]["content"][0]["text"],
        format!("research:{query}")
    );
    assert_ne!(read["result"]["isError"], true);
}

async fn authorize(authorization_url: &str, proxy: &str) {
    let url = reqwest::Url::parse(authorization_url).unwrap();
    let query: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["scope"], "research:read");
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(!query.contains_key("client_secret"));
    let response = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::https(proxy).unwrap())
        .build()
        .unwrap()
        .get(url)
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success(), "OAuth callback failed");
}

async fn cli_oauth(
    action: &str,
    name: &str,
    binary: &str,
    root: &Path,
    environment: &[(String, String)],
    proxy: &str,
) {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut command = tokio::process::Command::new(std::env::var("LIME_HTTP_MCP_CLI").unwrap());
    command
        .args(["mcp", action, name, "--app-server", binary])
        .env("LIME_CONFIG_PATH", root.join("config.yaml"))
        .env("LIME_LOCALE", "en-US")
        .envs(environment.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for arg in [
        "--app-data-dir".into(),
        root.join("app").into_os_string(),
        "--data-dir".into(),
        root.join("agent").into_os_string(),
    ] {
        command.arg("--app-server-arg").arg(arg);
    }
    if action == "login" {
        command.arg("--no-browser");
    }
    let mut child = command.spawn().expect("start actual MCP CLI");
    let mut lines = BufReader::new(child.stderr.take().unwrap()).lines();
    if action == "login" {
        let authorization_url = tokio::time::timeout(Duration::from_secs(30), async {
            while let Some(line) = lines.next_line().await.unwrap() {
                if let Some(url) = line.strip_prefix("Complete sign-in in your browser: ") {
                    return url.to_owned();
                }
            }
            panic!("CLI closed before returning its authorization URL");
        })
        .await
        .expect("CLI authorization URL");
        assert!(
            child.try_wait().unwrap().is_none(),
            "login must wait for the callback"
        );
        authorize(&authorization_url, proxy).await;
    }
    let drain = tokio::spawn(async move {
        let mut count = 0;
        while lines.next_line().await.unwrap().is_some() {
            count += 1;
        }
        count
    });
    let output = tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
        .await
        .expect("CLI authorization must terminate")
        .unwrap();
    drain.await.unwrap();
    assert!(
        output.status.success(),
        "MCP CLI {action} failed: {output:?}"
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    let expected = if action == "login" {
        "Signed in"
    } else {
        "Signed out"
    };
    assert_eq!(stdout.trim(), format!("{name}: {expected}"));
    std::fs::write(root.join(format!("cli-{action}.stdout")), stdout).unwrap();
}

async fn exercise(mode: &str, use_cli: bool) {
    let binary = std::env::var("LIME_HTTP_MCP_APP_SERVER").unwrap();
    let proxy = std::env::var("LIME_HTTP_MCP_PROXY").unwrap();
    let evidence = std::env::var("LIME_HTTP_MCP_EVIDENCE").unwrap();
    let root = Path::new(&evidence).join(if use_cli { "cli" } else { mode });
    std::fs::create_dir_all(&root).unwrap();
    let f = issuer::Fixture::start().await;
    let item = artifact(&f, mode);
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), |_| None).await;
    let roots = app_server::StorageRoots::initialize(root.join("app"), root.join("agent")).unwrap();
    let db = lime_core::database::init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            "http-mcp-model",
            Wire::Chat.model(),
            Wire::Chat.provider_type(),
            &model.url,
            Wire::Chat.credential(),
        )],
        false,
    );
    drop(db);
    std::fs::write(
        root.join("config.yaml"),
        json!({"cloud":{"base_url":f.base}}).to_string(),
    )
    .unwrap();
    let mut environment = vec![
        ("HTTPS_PROXY".into(), proxy.clone()),
        ("https_proxy".into(), proxy.clone()),
        ("NO_PROXY".into(), "127.0.0.1,localhost,::1".into()),
        ("no_proxy".into(), "127.0.0.1,localhost,::1".into()),
    ];
    let mut peer =
        TransportClient::start_stdio_with_env(Path::new(&binary), &root, "missing", &environment)
            .await;
    for resource in ["default", "market"] {
        login(&mut peer, &f, resource).await;
    }
    let installed = peer.request_ok(5, "market/install", json!({
        "kind":"mcp","itemId":item["id"],"installAttemptId":"http-mcp-install",
        "release":{"id":item["release"]["id"],"manifestSha256":item["release"]["manifestSha256"],"archiveSha256":item["release"]["archiveSha256"]}
    })).await;
    let name = installed["result"]["resource"]["installation"]["mcpServerName"]
        .as_str()
        .unwrap()
        .to_owned();
    let missing = peer
        .request(6, "mcpServer/start", json!({"name":name}))
        .await;
    assert!(
        missing.get("error").is_some(),
        "missing {mode} credentials must fail: {missing}"
    );

    if mode == "bearer" {
        peer.shutdown().await;
        environment.push((
            format!("LIME_MCP_{}_TOKEN", name.to_ascii_uppercase()),
            "fixture-bearer-token".into(),
        ));
        peer = TransportClient::start_stdio_with_env(
            Path::new(&binary),
            &root,
            "authorized",
            &environment,
        )
        .await;
    } else if use_cli {
        peer.shutdown().await;
        cli_oauth("login", &name, &binary, &root, &environment, &proxy).await;
        peer = TransportClient::start_stdio_with_env(
            Path::new(&binary),
            &root,
            "after-cli-login",
            &environment,
        )
        .await;
        assert_eq!(status(&mut peer, &name).await["authStatus"], "oAuth");
    } else {
        assert_eq!(status(&mut peer, &name).await["authStatus"], "notLoggedIn");
        let existing_thread = thread(&mut peer, &root).await;
        assert!(call(&mut peer, &existing_thread, &name, "before-login")
            .await
            .get("error")
            .is_some());
        let started = peer
            .request_ok(7, "mcpServer/oauth/login", json!({"name":name}))
            .await;
        let authorization_url = started["result"]["authorizationUrl"].as_str().unwrap();
        authorize(authorization_url, &proxy).await;
        let completed = peer
            .wait_for_notification("mcpServer/oauthLogin/completed")
            .await;
        assert_eq!(completed["params"]["loginId"], started["result"]["loginId"]);
        assert_eq!(
            completed["params"]["success"], true,
            "OAuth login failed: {completed}"
        );
        assert_eq!(status(&mut peer, &name).await["authStatus"], "oAuth");
        assert_call(
            &call(&mut peer, &existing_thread, &name, "after-login").await,
            "after-login",
        );
    }
    peer.request_ok(8, "mcpServer/start", json!({"name":name}))
        .await;
    let first_thread = thread(&mut peer, &root).await;
    assert_call(
        &call(&mut peer, &first_thread, &name, "first").await,
        "first",
    );
    peer.shutdown().await;

    let mut cold =
        TransportClient::start_stdio_with_env(Path::new(&binary), &root, "cold", &environment)
            .await;
    let mut cold_thread = thread(&mut cold, &root).await;
    assert_call(&call(&mut cold, &cold_thread, &name, "cold").await, "cold");
    if mode == "oauth2" {
        cold.request_ok(8, "mcpServer/start", json!({"name":name}))
            .await;
        assert_eq!(status(&mut cold, &name).await["runtimeStatus"], "connected");
        if use_cli {
            cold.shutdown().await;
            cli_oauth("logout", &name, &binary, &root, &environment, &proxy).await;
            cold = TransportClient::start_stdio_with_env(
                Path::new(&binary),
                &root,
                "after-cli-logout",
                &environment,
            )
            .await;
            cold_thread = thread(&mut cold, &root).await;
        } else {
            let removed = cold
                .request_ok(9, "mcpServer/oauth/logout", json!({"name":name}))
                .await;
            assert_eq!(removed["result"]["removed"], true);
        }
        assert_eq!(status(&mut cold, &name).await["authStatus"], "notLoggedIn");
        assert_eq!(
            status(&mut cold, &name).await["runtimeStatus"],
            "notStarted"
        );
        let denied = call(&mut cold, &cold_thread, &name, "after-logout").await;
        assert!(
            denied.get("error").is_some(),
            "OAuth logout must prevent further authenticated calls (CLI={use_cli}): {denied}"
        );
    }
    cold.request_ok(
        15,
        "market/enabled/set",
        json!({"kind":"mcp","itemId":item["id"],"enabled":false}),
    )
    .await;
    assert!(call(&mut cold, &cold_thread, &name, "disabled")
        .await
        .get("error")
        .is_some());
    cold.shutdown().await;
    assert_eq!(f.count("/market/acquisitions"), 1);
    assert_eq!(f.count("/download-tickets"), 1);
}

#[tokio::test]
#[ignore = "requires a trusted HTTPS MCP fixture, restricted CONNECT proxy and frozen native artifact"]
async fn installed_market_http_bearer_uses_runtime_and_cold_start() {
    exercise("bearer", false).await;
}

#[tokio::test]
#[ignore = "requires a trusted HTTPS MCP fixture, restricted CONNECT proxy and frozen native artifact"]
async fn installed_market_http_oauth_uses_runtime_cold_start_and_logout() {
    exercise("oauth2", false).await;
}

#[tokio::test]
#[ignore = "requires a trusted HTTPS MCP fixture, restricted CONNECT proxy and frozen native artifacts"]
async fn installed_market_http_oauth_cli_completes_and_clears_credentials() {
    exercise("oauth2", true).await;
}
