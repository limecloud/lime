//! Connected browser/document sessions are adapters of the shared tool owner.

use super::mailbox::{self, Session};
use super::*;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use uuid::Uuid;

pub struct ExtensionAdapter {
    kind: ComputerUseAdapterKind,
    #[cfg(test)]
    directory: Option<PathBuf>,
    observed: Mutex<(u64, Vec<(PathBuf, ComputerUseSnapshot)>, bool)>,
}

impl ExtensionAdapter {
    pub fn new(kind: ComputerUseAdapterKind) -> Self {
        Self {
            kind,
            #[cfg(test)]
            directory: None,
            observed: Mutex::new((1, vec![], false)),
        }
    }

    fn directory(&self) -> ComputerUseResult<PathBuf> {
        #[cfg(test)]
        if let Some(directory) = &self.directory {
            return Ok(directory.clone());
        }
        mailbox::root()
    }

    fn sessions(&self) -> ComputerUseResult<Vec<(PathBuf, ComputerUseSnapshot)>> {
        let mut sessions = Vec::new();
        let name = match self.kind {
            ComputerUseAdapterKind::Chrome => "chrome",
            ComputerUseAdapterKind::Office => "office",
            _ => return Err(denied("Invalid extension adapter")),
        };
        for entry in fs::read_dir(self.directory()?)
            .map_err(|e| denied(e.to_string()))?
            .take(128)
        {
            let path = entry.map_err(|e| denied(e.to_string()))?.path();
            if !path
                .file_name()
                .and_then(|v| v.to_str())
                .is_some_and(mailbox::message_id)
            {
                continue;
            }
            super::broker::check_path(&path, true)?;
            let Ok(value) = mailbox::read(&path.join("state.json")) else {
                continue;
            };
            let Ok(session) = serde_json::from_value::<Session>(value) else {
                continue;
            };
            if session.protocol != 1
                || session.adapter != name
                || session.updated_at > mailbox::now()
                || mailbox::now().saturating_sub(session.updated_at) > mailbox::SESSION_TTL_MS
            {
                continue;
            }
            if session.snapshot.targets.len() > 128 {
                return Err(denied("Too many adapter targets"));
            }
            if session.snapshot.targets.iter().any(|t| {
                t.native_app.is_some()
                    || match (&t.identity, self.kind) {
                        (
                            ComputerUseTargetIdentity::Chrome { .. },
                            ComputerUseAdapterKind::Chrome,
                        ) => false,
                        (
                            ComputerUseTargetIdentity::Office { .. },
                            ComputerUseAdapterKind::Office,
                        ) => false,
                        _ => true,
                    }
            }) {
                return Err(denied("Adapter target kind mismatch"));
            }
            sessions.push((path, session.snapshot));
        }
        sessions.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(sessions)
    }

    async fn request(
        &self,
        target: &ComputerUseTargetIdentity,
        method: &str,
        params: Value,
        cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<Value> {
        let sessions = self.sessions()?;
        let matches = sessions
            .iter()
            .filter(|(_, s)| s.targets.iter().any(|t| same_target(&t.identity, target)))
            .collect::<Vec<_>>();
        let [(root, snapshot)] = matches.as_slice() else {
            return Err(denied("Connected target is missing or ambiguous"));
        };
        let id = Uuid::new_v4().to_string();
        let deadline = mailbox::now() + if method == "setup" { 60_000 } else { 15_000 };
        let path = root.join("requests").join(format!("{id}.json"));
        let reply = root.join("responses").join(format!("{id}.json"));
        mailbox::write(
            &path,
            &json!({"id":id,"method":method,"target":target,"generation":snapshot.generation,"deadline":deadline,"params":params}),
        )?;
        let _cleanup = RequestCleanup {
            root: (*root).clone(),
            id: id.clone(),
        };
        let mut canceled = false;
        loop {
            if cancel.is_cancelled() || mailbox::now() >= deadline {
                if !canceled {
                    // Keep the in-flight lease until the peer acknowledges cancellation
                    // or the bounded command deadline and heartbeat have both expired.
                    mailbox::write(
                        &root.join("requests").join(format!("{id}.cancel")),
                        &json!({"id":id}),
                    )?;
                    canceled = true;
                }
                if mailbox::now() >= deadline + mailbox::SESSION_TTL_MS {
                    return Err(denied("Adapter operation canceled or timed out; outcome_unknown; observe before retrying"));
                }
            }
            if let Ok(response) = mailbox::read(&reply) {
                if let Some(error) = response["error"].as_str() {
                    return Err(denied(error));
                }
                if canceled {
                    return Err(denied(
                        "Adapter operation canceled; outcome_unknown; observe before retrying",
                    ));
                }
                return Ok(response["result"].clone());
            }
            let current = self.sessions()?;
            if !current.iter().any(|(p, s)| {
                p == root
                    && s.generation == snapshot.generation
                    && s.targets.iter().any(|t| same_target(&t.identity, target))
            }) {
                return Err(denied(
                    "Adapter target changed or disconnected; outcome_unknown",
                ));
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }
}

#[cfg(test)]
#[path = "extension_tests.rs"]
mod tests;

#[async_trait]
impl ComputerUseAdapter for ExtensionAdapter {
    fn kind(&self) -> ComputerUseAdapterKind {
        self.kind
    }
    async fn snapshot(&self) -> ComputerUseResult<ComputerUseSnapshot> {
        let sessions = self.sessions()?;
        let installed = self.kind != ComputerUseAdapterKind::Chrome
            || super::installation::chrome_manifest()?.is_file();
        let mut observed = self
            .observed
            .lock()
            .map_err(|_| denied("Adapter observation unavailable"))?;
        if observed.1 != sessions || observed.2 != installed {
            let additions_only = self.kind == ComputerUseAdapterKind::Chrome
                && observed.2 == installed
                && observed.1.len() == sessions.len()
                && observed
                    .1
                    .iter()
                    .zip(&sessions)
                    .all(|((old_path, old), (path, next))| {
                        old_path == path && (old == next || chrome_target_addition(old, next))
                    });
            if !additions_only {
                observed.0 = observed
                    .0
                    .checked_add(1)
                    .ok_or_else(|| denied("Adapter generation exhausted"))?;
            }
            observed.1 = sessions;
            observed.2 = installed;
        }
        let connected = !observed.1.is_empty();
        let targets = observed
            .1
            .iter()
            .flat_map(|(_, s)| s.targets.clone())
            .collect();
        Ok(ComputerUseSnapshot {
            generation: observed.0,
            readiness: if connected {
                ComputerUseReadiness::Ready
            } else if !installed {
                ComputerUseReadiness::NotInstalled
            } else {
                ComputerUseReadiness::Disconnected
            },
            targets,
            reason: (!connected).then(|| "Open and connect the Lime extension or add-in".into()),
            setup_steps: if connected {
                vec![]
            } else {
                vec!["connect_extension".into()]
            },
        })
    }
    fn finish_turn(&self, owner: &ComputerUseOwner) {
        if self.kind != ComputerUseAdapterKind::Chrome {
            return;
        }
        let send = || -> ComputerUseResult<()> {
            for (root, _) in self.sessions()? {
                let id = Uuid::new_v4().to_string();
                mailbox::write(
                    &root.join("requests").join(format!("{id}.json")),
                    &json!({
                        "id":id,"method":"endTurn","oneWay":true,"deadline":mailbox::now() + 60_000,
                        "params":{"owner":{"connection":owner.connection,"sessionId":owner.thread_id,"turnId":owner.turn_id}}
                    }),
                )?;
            }
            Ok(())
        };
        if let Err(error) = send() {
            tracing::warn!(%error, "Chrome task cleanup notification failed");
        }
    }
    async fn setup(
        &self,
        params: &ComputerUseSetupParams,
    ) -> ComputerUseResult<ComputerUseSetupOutcome> {
        let Some(target) = &params.target else {
            if self.kind == ComputerUseAdapterKind::Chrome {
                super::installation::install_chrome_host()?;
                super::installation::reveal_chrome()?;
            }
            if self.kind == ComputerUseAdapterKind::Office {
                super::document_host::install().await?;
            }
            return Ok(ComputerUseSetupOutcome {
                accepted: true,
                ..Default::default()
            });
        };
        let reply = self
            .request(
                target,
                "setup",
                json!({}),
                tokio_util::sync::CancellationToken::new(),
            )
            .await?;
        let snapshot = self.snapshot().await?;
        let accepted = reply["accepted"].as_bool() == Some(true);
        Ok(ComputerUseSetupOutcome {
            accepted,
            approved_target: accepted.then(|| target.clone()),
            generation: snapshot.generation,
        })
    }
    async fn execute(
        &self,
        lease: &ComputerUseLease,
        action: ComputerUseAction,
        cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<Value> {
        self.request(
            &lease.response.target,
            "execute",
            json!({"operation":action,"fence":lease.control_fence(),"owner":{
                "connection":lease.owner.connection,"sessionId":lease.owner.thread_id,"turnId":lease.owner.turn_id
            }}),
            cancel,
        )
        .await
    }
}

struct RequestCleanup {
    root: PathBuf,
    id: String,
}
impl Drop for RequestCleanup {
    fn drop(&mut self) {
        for path in [
            self.root.join("requests").join(format!("{}.json", self.id)),
            self.root
                .join("requests")
                .join(format!("{}.pending", self.id)),
            self.root
                .join("requests")
                .join(format!("{}.cancel", self.id)),
            self.root
                .join("responses")
                .join(format!("{}.json", self.id)),
        ] {
            let _ = fs::remove_file(path);
        }
    }
}
