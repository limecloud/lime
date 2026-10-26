//! Local HTTPS transport for the Excel add-in. It never creates agent turns.

use super::{denied, mailbox, ComputerUsePaths, ComputerUseResult};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

const ORIGIN: &str = "https://localhost:32147";
const HTML: &str = include_str!("../../../../../extensions/lime-excel/taskpane.html");
const JS: &str = include_str!("../../../../../extensions/lime-excel/taskpane.js");
const CSS: &str = include_str!("../../../../../extensions/lime-excel/taskpane.css");
const MANIFEST: &str = include_str!("../../../../../extensions/lime-excel/manifest.xml");
const INSTALL: &str = include_str!("../../../../../extensions/lime-excel/README.md");

#[cfg(test)]
#[path = "document_host_tests.rs"]
mod tests;

#[derive(Clone)]
struct Host {
    token: String,
    sessions: Arc<Mutex<HashMap<String, u64>>>,
    directory: PathBuf,
}

fn directory(paths: &ComputerUsePaths) -> ComputerUseResult<PathBuf> {
    let path = paths.root.join("excel");
    mailbox::private_directory(&path)?;
    Ok(path)
}

pub(super) async fn install(paths: &ComputerUsePaths) -> ComputerUseResult<()> {
    let root = directory(paths)?;
    let cert = root.join("localhost.pem");
    let key = root.join("localhost-key.pem");
    if !cert.exists() || !key.exists() {
        let generated =
            rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
                .map_err(|e| denied(e.to_string()))?;
        private_write(&cert, generated.cert.pem().as_bytes())?;
        private_write(&key, generated.key_pair.serialize_pem().as_bytes())?;
    }
    let token_path = root.join("pairing.json");
    if !token_path.exists() {
        mailbox::write(&token_path, &json!({"token":Uuid::new_v4().to_string()}))?;
    }
    let token = mailbox::read(&token_path)?["token"]
        .as_str()
        .filter(|v| mailbox::message_id(v))
        .ok_or_else(|| denied("Invalid document pairing key"))?
        .to_owned();
    let manifest = MANIFEST.replace("__SOURCE__", &format!("{ORIGIN}/taskpane.html#{token}"));
    let setup = root.join("setup");
    mailbox::private_directory(&setup)?;
    private_write(&setup.join("Lime.xml"), manifest.as_bytes())?;
    private_write(
        &setup.join("localhost.cer"),
        &fs::read(&cert).map_err(|e| denied(e.to_string()))?,
    )?;
    private_write(&setup.join("INSTALL.md"), INSTALL.as_bytes())?;
    if let Some(wef) = &paths.excel_sideload {
        // Only sideload when the actual application container already exists.
        if wef.ancestors().nth(2).is_some_and(|p| p.is_dir()) {
            fs::create_dir_all(&wef).map_err(|e| denied(e.to_string()))?;
            private_write(&wef.join("Lime.xml"), manifest.as_bytes())?;
        }
    }
    let executable = std::env::current_exe().map_err(|e| denied(e.to_string()))?;
    let mut command = std::process::Command::new(executable);
    command
        .arg("--computer-use-document-host")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| denied(e.to_string()))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    let certificate =
        reqwest::Certificate::from_pem(&fs::read(&cert).map_err(|e| denied(e.to_string()))?)
            .map_err(|e| denied(e.to_string()))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .add_root_certificate(certificate)
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .map_err(|e| denied(e.to_string()))?;
    for _ in 0..40 {
        if client
            .get(format!("{ORIGIN}/health"))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            super::installation::reveal(&setup)?;
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Err(denied(
        "Excel HTTPS host did not start; check the local port and certificate",
    ))
}

fn private_write(path: &std::path::Path, bytes: &[u8]) -> ComputerUseResult<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    if path.exists() {
        super::broker::check_path(path, false)?;
    }
    options
        .open(path)
        .and_then(|mut f| f.write_all(bytes))
        .map_err(|e| denied(e.to_string()))
}

pub async fn run_document_host(paths: ComputerUsePaths) -> Result<(), String> {
    run(paths).await.map_err(|e| e.0)
}
async fn run(paths: ComputerUsePaths) -> ComputerUseResult<()> {
    use fs2::FileExt;
    let root = directory(&paths)?;
    let lock_path = root.join("host.lock");
    if !lock_path.exists() {
        private_write(&lock_path, b"")?;
    }
    super::broker::check_path(&lock_path, false)?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|e| denied(e.to_string()))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(());
    }
    let token = mailbox::read(&root.join("pairing.json"))?["token"]
        .as_str()
        .filter(|v| mailbox::message_id(v))
        .ok_or_else(|| denied("Invalid document pairing key"))?
        .to_owned();
    super::broker::check_path(&root.join("localhost.pem"), false)?;
    super::broker::check_path(&root.join("localhost-key.pem"), false)?;
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(
        root.join("localhost.pem"),
        root.join("localhost-key.pem"),
    )
    .await
    .map_err(|e| denied(e.to_string()))?;
    let sessions = paths.sessions();
    mailbox::private_directory(&sessions)?;
    let state = Host {
        token,
        sessions: Default::default(),
        directory: sessions,
    };
    let router = Router::new()
        .route("/health", get(|| async { Json(json!({"protocol":1})) }))
        .route("/taskpane.html", get(|| async { Html(HTML) }))
        .route(
            "/taskpane.js",
            get(|| async { ([(header::CONTENT_TYPE, "application/javascript")], JS) }),
        )
        .route(
            "/taskpane.css",
            get(|| async { ([(header::CONTENT_TYPE, "text/css")], CSS) }),
        )
        .route("/api/connect", post(connect))
        .route("/api/poll", post(poll))
        .route("/api/disconnect", post(disconnect))
        .layer(DefaultBodyLimit::max(mailbox::MAX_BYTES as usize))
        .with_state(state);
    axum_server::bind_rustls(([127, 0, 0, 1], 32147).into(), tls)
        .serve(router.into_make_service())
        .await
        .map_err(|e| denied(e.to_string()))?;
    drop(lock);
    Ok(())
}

fn authorized(host: &Host, headers: &HeaderMap) -> bool {
    headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) == Some(ORIGIN)
        && headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            == Some(&format!("Bearer {}", host.token))
}
async fn connect(State(host): State<Host>, headers: HeaderMap) -> axum::response::Response {
    if !authorized(&host, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let result = (|| -> ComputerUseResult<Value> {
        let id = Uuid::new_v4().to_string();
        let root = host.directory.join(&id);
        for directory in [&root, &root.join("requests"), &root.join("responses")] {
            mailbox::private_directory(directory)?;
        }
        let mut sessions = host
            .sessions
            .lock()
            .map_err(|_| denied("Document session unavailable"))?;
        let now = mailbox::now();
        sessions.retain(|session, updated| {
            if now.saturating_sub(*updated) <= 60_000 {
                return true;
            }
            let _ = fs::remove_dir_all(host.directory.join(session));
            false
        });
        if sessions.len() >= 64 {
            return Err(denied("Too many document sessions"));
        }
        sessions.insert(id.clone(), now);
        Ok(json!({"sessionId":id,"protocol":1}))
    })();
    respond(result)
}
async fn poll(
    State(host): State<Host>,
    headers: HeaderMap,
    Json(message): Json<Value>,
) -> axum::response::Response {
    if !authorized(&host, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let result = (|| -> ComputerUseResult<Value> {
        let id = message["sessionId"]
            .as_str()
            .filter(|v| mailbox::message_id(v))
            .ok_or_else(|| denied("Invalid document session"))?;
        let mut sessions = host
            .sessions
            .lock()
            .map_err(|_| denied("Document session unavailable"))?;
        let last = sessions
            .get_mut(id)
            .ok_or_else(|| denied("Document session is not connected"))?;
        if mailbox::now().saturating_sub(*last) > 60_000 {
            return Err(denied("Document session expired"));
        }
        *last = mailbox::now();
        let targets = message["snapshot"]["targets"]
            .as_array()
            .ok_or_else(|| denied("Missing document targets"))?;
        if targets.len() != 1
            || targets[0]["identity"]["sessionId"] != id
            || targets[0]["identity"]["host"] != "Excel"
        {
            return Err(denied("Document identity mismatch"));
        }
        super::extension_host::exchange(&host.directory.join(id), message, "office")
    })();
    respond(result)
}
fn respond(result: ComputerUseResult<Value>) -> axum::response::Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"error":error.0}))).into_response(),
    }
}

async fn disconnect(
    State(host): State<Host>,
    headers: HeaderMap,
    Json(message): Json<Value>,
) -> axum::response::Response {
    if !authorized(&host, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let result = (|| -> ComputerUseResult<Value> {
        let id = message["sessionId"]
            .as_str()
            .filter(|id| mailbox::message_id(id))
            .ok_or_else(|| denied("Invalid document session"))?;
        if host
            .sessions
            .lock()
            .map_err(|_| denied("Document session unavailable"))?
            .remove(id)
            .is_some()
        {
            fs::remove_dir_all(host.directory.join(id)).map_err(|e| denied(e.to_string()))?;
        }
        Ok(json!({"disconnected":true}))
    })();
    respond(result)
}
