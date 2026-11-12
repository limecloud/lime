//! 用户自己的 ECS Session Manager 通道；会话凭据与流内容不落盘、不投影。
//! Wire reference: aliyun/aliyun_assist_client@7f398b692b248dd91a64c8c2a98f476451ecb8e5
//! agent/session/plugin/{client,message,portforward}; Apache-2.0.

use super::*;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{watch, Mutex};
use tokio::task::{JoinHandle, JoinSet};

mod wire;
use wire::forward;

const IDLE: Duration = Duration::from_secs(15 * 60);
const MAX_TUNNELS: usize = 16;
const MAX_CONNECTIONS: usize = 8;
static TUNNELS: Lazy<Mutex<HashMap<String, Tunnel>>> = Lazy::new(|| Mutex::new(HashMap::new()));

struct Tunnel {
    port: u16,
    channel: CloudDesktopTunnelChannel,
    cancel: watch::Sender<bool>,
    state: Arc<State>,
    ready: watch::Receiver<Option<Result<(), String>>>,
    task: JoinHandle<()>,
}

#[derive(Default)]
struct State {
    active: AtomicUsize,
    waiting: AtomicUsize,
    failed: AtomicBool,
}

impl Tunnel {
    fn metadata(&self) -> Value {
        if !matches!(&*self.ready.borrow(), Some(Ok(()))) {
            return json!({"state":"closed", "channel":self.channel,
                "persistent":false, "desktopReady":false});
        }
        let endpoint = match self.channel {
            CloudDesktopTunnelChannel::AppServer => format!("ws://127.0.0.1:{}", self.port),
            CloudDesktopTunnelChannel::Desktop => {
                format!("http://127.0.0.1:{}/vnc.html", self.port)
            }
            CloudDesktopTunnelChannel::Installation => format!("https://127.0.0.1:{}", self.port),
        };
        json!({"state":"listening", "channel":self.channel, "endpoint":endpoint,
            "activeConnections":self.state.active.load(Ordering::Relaxed),
            "connectionFailed":self.state.failed.load(Ordering::Relaxed),
            "persistent":false, "desktopReady":false})
    }

    fn open_request(&self) -> OpenRequest {
        self.state.waiting.fetch_add(1, Ordering::Relaxed);
        OpenRequest {
            state: self.state.clone(),
            ready: self.ready.clone(),
            cancel: self.cancel.clone(),
        }
    }
}

/// 最后一个等待者取消时终止尚未完成的云请求，不遗留后台会话创建。
struct OpenRequest {
    state: Arc<State>,
    ready: watch::Receiver<Option<Result<(), String>>>,
    cancel: watch::Sender<bool>,
}

impl OpenRequest {
    async fn wait(&mut self) -> Result<(), String> {
        let mut cancelled = self.cancel.subscribe();
        loop {
            if *cancelled.borrow_and_update() {
                return Err("Desktop tunnel opening was cancelled".into());
            }
            if let Some(result) = self.ready.borrow_and_update().clone() {
                return result;
            }
            tokio::select! {
                biased;
                _ = cancelled.changed() => {},
                changed = self.ready.changed() => {
                    changed.map_err(|_| "Desktop tunnel opening ended")?;
                },
            }
        }
    }
}

impl Drop for OpenRequest {
    fn drop(&mut self) {
        if self.state.waiting.fetch_sub(1, Ordering::AcqRel) == 1
            && !matches!(&*self.ready.borrow(), Some(Ok(())))
        {
            let _ = self.cancel.send(true);
        }
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
    }
}

fn validate_target(resource: &CloudDesktopResource) -> Result<(), String> {
    validate_resource(resource)?;
    if resource.provider != CloudDesktopProvider::Ecs {
        return Err("Session Manager tunnels require an ECS resource".into());
    }
    Ok(())
}

fn key(root: &Path, resource: &CloudDesktopResource, channel: CloudDesktopTunnelChannel) -> String {
    let mut hash = Sha256::new();
    hash.update(root.as_os_str().as_encoded_bytes());
    hash.update([0]);
    hash.update(serde_json::to_vec(&(resource, channel)).expect("serialize typed tunnel identity"));
    format!("{:x}", hash.finalize())
}

/// Treat the supplier URL as a credential, including in errors. Never Debug-print it.
fn session_url(value: &Value) -> Result<url::Url, String> {
    let raw = value["WebSocketUrl"]
        .as_str()
        .filter(|s| s.len() <= 8192)
        .ok_or("Invalid Session Manager response")?;
    let id = value["SessionId"]
        .as_str()
        .ok_or("Missing Session Manager identity")?;
    validate_id(id)?;
    let mut url = url::Url::parse(raw).map_err(|_| "Invalid Session Manager endpoint")?;
    let host = url.host_str().unwrap_or("");
    if url.scheme() != "wss"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
        || !(host.ends_with(".aliyuncs.com") || host.ends_with(".aliyun.com"))
    {
        return Err("Untrusted Session Manager endpoint".into());
    }
    // The official client normalizes this API spelling before the handshake.
    let pairs: Vec<_> = url
        .query_pairs()
        .map(|(name, value)| {
            (
                if name == "sessionid" {
                    "sessionId".into()
                } else {
                    name.into_owned()
                },
                value.into_owned(),
            )
        })
        .collect();
    url.query_pairs_mut().clear().extend_pairs(pairs);
    Ok(url)
}

impl CloudDesktopService {
    pub(super) async fn open_ecs_tunnel(
        &self,
        resource: CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    ) -> Result<Value, String> {
        validate_target(&resource)?;
        if self.root.exists() {
            self.check_change_available(&resource, "openEcsTunnel")?;
        }
        let identity = key(&self.root, &resource, channel);
        // 先保留回环端口；全局表只串行化登记，不等待供应商网络。
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "Cannot bind a loopback desktop tunnel")?;
        let mut opening = {
            let mut tunnels = TUNNELS.lock().await;
            tunnels.retain(|_, tunnel| !tunnel.task.is_finished() && !*tunnel.cancel.borrow());
            if !tunnels.contains_key(&identity) {
                if tunnels.len() >= MAX_TUNNELS {
                    return Err("Close an existing desktop tunnel before opening another".into());
                }
                let service = self.clone();
                let session = async move { service.ecs_session_url(&resource, channel).await };
                tunnels.insert(
                    identity.clone(),
                    start_tunnel(listener, session, channel, IDLE)?,
                );
            }
            tunnels[&identity].open_request()
        };
        opening.wait().await?;
        let tunnels = TUNNELS.lock().await;
        let tunnel = tunnels
            .get(&identity)
            .filter(|tunnel| Arc::ptr_eq(&tunnel.state, &opening.state))
            .filter(|tunnel| !*tunnel.cancel.borrow() && !tunnel.task.is_finished())
            .ok_or("Desktop tunnel opening was cancelled")?;
        Ok(tunnel.metadata())
    }

    async fn ecs_session_url(
        &self,
        resource: &CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    ) -> Result<url::Url, String> {
        let observed = self.inspect(resource).await?;
        scheduled_release::require_no_deadline(&observed)?;
        if observed["status"] != "Running" || observed["operationBlocked"] != false {
            return Err("Session Manager requires an unlocked running ECS instance".into());
        }
        let remote_port = match channel {
            CloudDesktopTunnelChannel::AppServer => "8787",
            CloudDesktopTunnelChannel::Desktop => "6080",
            CloudDesktopTunnelChannel::Installation => "8787",
        };
        // Linux routes 127/8 locally. A second fixed loopback address lets the
        // temporary TLS service coexist with the persistent task service while
        // reusing its existing supplier security-group port requirement.
        let target = if channel == CloudDesktopTunnelChannel::Installation {
            "127.0.0.2"
        } else {
            "127.0.0.1"
        };
        let response = self
            .call(
                resource,
                &[
                    "StartTerminalSession".into(),
                    "--InstanceId.1".into(),
                    resource.resource_id.clone(),
                    "--PortNumber".into(),
                    remote_port.into(),
                    "--TargetServer".into(),
                    target.into(),
                    "--ConnectionType".into(),
                    "Internet".into(),
                    "--ClientToken".into(),
                    uuid::Uuid::new_v4().to_string(),
                ],
            )
            .await?;
        session_url(&response)
    }

    pub(super) async fn read_ecs_tunnel(
        &self,
        resource: &CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    ) -> Result<Value, String> {
        validate_target(resource)?;
        let mut tunnels = TUNNELS.lock().await;
        tunnels.retain(|_, tunnel| !tunnel.task.is_finished() && !*tunnel.cancel.borrow());
        Ok(tunnels
            .get(&key(&self.root, resource, channel))
            .map(Tunnel::metadata)
            .unwrap_or_else(|| json!({"state":"closed", "channel":channel, "persistent":false})))
    }

    pub(super) async fn close_ecs_tunnel(
        &self,
        resource: &CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    ) -> Result<Value, String> {
        validate_target(resource)?;
        let tunnel = TUNNELS
            .lock()
            .await
            .remove(&key(&self.root, resource, channel));
        if let Some(mut tunnel) = tunnel {
            let _ = tunnel.cancel.send(true);
            if tokio::time::timeout(Duration::from_secs(5), &mut tunnel.task)
                .await
                .is_err()
            {
                tunnel.task.abort();
                let _ = (&mut tunnel.task).await;
            }
        }
        Ok(json!({"state":"closed", "channel":channel, "persistent":false}))
    }
}

#[cfg(test)]
fn start_listener(
    listener: TcpListener,
    url: url::Url,
    channel: CloudDesktopTunnelChannel,
    idle: Duration,
) -> Result<Tunnel, String> {
    start_tunnel(listener, async move { Ok(url) }, channel, idle)
}

fn start_tunnel(
    listener: TcpListener,
    session: impl std::future::Future<Output = Result<url::Url, String>> + Send + 'static,
    channel: CloudDesktopTunnelChannel,
    idle: Duration,
) -> Result<Tunnel, String> {
    let port = listener
        .local_addr()
        .map_err(|_| "Cannot read loopback tunnel address")?
        .port();
    let (cancel, mut cancelled) = watch::channel(false);
    let (prepared, ready) = watch::channel(None);
    let state = Arc::new(State::default());
    let worker_state = state.clone();
    let task = tokio::spawn(async move {
        let result = tokio::select! {
            biased;
            _ = cancelled.changed() => return,
            result = session => result,
        };
        let url = match result {
            Ok(url) => url,
            Err(error) => {
                let _ = prepared.send(Some(Err(error)));
                return;
            }
        };
        let _ = prepared.send(Some(Ok(())));
        let mut connections = JoinSet::new();
        let idle_timer = tokio::time::sleep(idle);
        tokio::pin!(idle_timer);
        loop {
            tokio::select! {
                biased;
                _ = cancelled.changed() => break,
                _ = &mut idle_timer, if connections.is_empty() => break,
                Some(_) = connections.join_next(), if !connections.is_empty() => {
                    worker_state.active.store(connections.len(), Ordering::Relaxed);
                    if connections.is_empty() { idle_timer.as_mut().reset(tokio::time::Instant::now() + idle); }
                }
                accepted = listener.accept() => {
                    let Ok((socket, address)) = accepted else { break; };
                    if !address.ip().is_loopback() || connections.len() >= MAX_CONNECTIONS { continue; }
                    let url = url.clone();
                    let state = worker_state.clone();
                    connections.spawn(async move {
                        if let Err(reason) = forward(socket, url).await {
                            // Forwarding errors are fixed local diagnostics; never log
                            // the supplier URL, handshake error or byte stream here.
                            tracing::warn!(reason, "ECS Session Manager forwarding ended");
                            state.failed.store(true, Ordering::Relaxed);
                        }
                    });
                    worker_state.active.store(connections.len(), Ordering::Relaxed);
                }
            }
        }
        // Cancellation owns all byte streams. No detached writer survives closure.
        connections.shutdown().await;
        worker_state.active.store(0, Ordering::Relaxed);
    });
    Ok(Tunnel {
        port,
        channel,
        cancel,
        state,
        ready,
        task,
    })
}

#[cfg(test)]
mod tests;
