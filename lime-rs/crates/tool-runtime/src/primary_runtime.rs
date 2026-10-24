//! Bundled tool installation and diagnostics. Hosts inject the per-user storage root.
mod bundle_archive;
mod install;
mod manifest;
mod store;

use app_server_protocol::protocol::v2::{
    DiagnoseDependenciesResponse, PrimaryRuntimeInstallPhase, PrimaryRuntimeInstallProgress,
};
use manifest::Release;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug)]
pub struct PrimaryRuntimeService {
    root: PathBuf,
    release: Arc<Release>,
    state: Arc<Mutex<State>>,
    client: reqwest::Client,
}

#[derive(Default, Debug)]
struct State {
    update: Option<PrimaryRuntimeInstallProgress>,
    cancel: Option<CancellationToken>,
}

impl PrimaryRuntimeService {
    pub fn new(root: PathBuf) -> io::Result<Self> {
        Self::with_release(root, Release::current())
    }

    fn with_release(root: PathBuf, release: Release) -> io::Result<Self> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Lime/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(io::Error::other)?;
        Ok(Self {
            root,
            release: Arc::new(release),
            state: Arc::default(),
            client,
        })
    }

    /// Passive reads inspect receipts and paths; only explicit diagnostics execute binaries.
    pub async fn diagnose_dependencies(
        &self,
        enabled: bool,
        probe_executables: bool,
    ) -> DiagnoseDependenciesResponse {
        let mut result = DiagnoseDependenciesResponse {
            supported: self.release.platform().is_some(),
            enabled,
            installed: false,
            bundle_version: None,
            expected_version: self.release.version.clone(),
            problems: Vec::new(),
            update: self.state.lock().expect("dependency state").update.clone(),
        };
        let Some(platform) = self.release.platform() else {
            result.problems.push("unsupported-platform".into());
            return result;
        };
        let installed = match store::read(&self.root) {
            Ok(Some(installed)) => installed,
            Ok(None) => {
                result.problems.push("not-installed".into());
                return result;
            }
            Err(_) => {
                result.problems.push("invalid-receipt".into());
                return result;
            }
        };
        result.bundle_version = Some(installed.bundle_version.clone());
        if installed.bundle_version != self.release.version {
            result.problems.push("update-required".into());
            return result;
        }
        let paths = match store::executable_paths(&self.root, &installed, platform) {
            Ok(paths) => paths,
            Err(_) => {
                result.problems.push("missing-executable".into());
                return result;
            }
        };
        if probe_executables {
            for (artifact, path) in platform.artifacts.iter().zip(paths) {
                if probe(&path, &artifact.version).await.is_err() {
                    result
                        .problems
                        .push(format!("{}-probe-failed", artifact.name));
                }
            }
        }
        result.installed = result.problems.is_empty();
        result
    }

    pub fn run_update_now(&self) -> io::Result<PrimaryRuntimeInstallProgress> {
        self.install(false)
    }

    pub fn reset_dependencies(&self) -> io::Result<PrimaryRuntimeInstallProgress> {
        self.install(true)
    }

    pub fn install(&self, reinstall: bool) -> io::Result<PrimaryRuntimeInstallProgress> {
        let platform = self.release.platform().cloned().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "unsupported dependency platform",
            )
        })?;
        let mut state = self.state.lock().expect("dependency state");
        if let Some(update) = state
            .update
            .as_ref()
            .filter(|update| update.phase.is_active())
        {
            return Ok(update.clone());
        }
        let lock = store::lock(&self.root)?;
        let id = uuid::Uuid::new_v4().to_string();
        let current = store::read(&self.root).ok().flatten();
        let already_current = !reinstall
            && current.as_ref().is_some_and(|installed| {
                installed.bundle_version == self.release.version
                    && store::executable_paths(&self.root, installed, &platform).is_ok()
            });
        let update = PrimaryRuntimeInstallProgress {
            id: id.clone(),
            phase: if already_current {
                PrimaryRuntimeInstallPhase::Ready
            } else {
                PrimaryRuntimeInstallPhase::Downloading
            },
            downloaded_bytes: 0,
            total_bytes: None,
            error: None,
        };
        state.update = Some(update.clone());
        if already_current {
            return Ok(update);
        }
        let cancel = CancellationToken::new();
        state.cancel = Some(cancel.clone());
        let manager = self.clone();
        tokio::spawn(async move {
            let result = manager.perform_install(&id, &platform, &cancel).await;
            let mut state = manager.state.lock().expect("dependency state");
            // A terminal snapshot also guarantees that another process can acquire the install lock.
            drop(lock);
            if let Some(update) = state.update.as_mut().filter(|update| update.id == id) {
                match result {
                    Ok(()) => update.phase = PrimaryRuntimeInstallPhase::Ready,
                    Err(_) if cancel.is_cancelled() => {
                        update.phase = PrimaryRuntimeInstallPhase::Canceled
                    }
                    Err(error) => {
                        update.phase = PrimaryRuntimeInstallPhase::Error;
                        // Diagnostics use stable error categories, never private transport details.
                        update.error = Some(error.kind().to_string());
                    }
                }
                state.cancel = None;
            }
        });
        Ok(update)
    }

    pub fn cancel_install(&self, id: &str) -> bool {
        let state = self.state.lock().expect("dependency state");
        if state
            .update
            .as_ref()
            .is_some_and(|update| update.id == id && update.phase.is_active())
        {
            if let Some(cancel) = &state.cancel {
                cancel.cancel();
                return true;
            }
        }
        false
    }

    /// Add only the installed bundle to a new local child environment, never the process PATH.
    pub fn expose(&self, environment: &mut HashMap<String, String>) -> io::Result<bool> {
        let Some(platform) = self.release.platform() else {
            return Ok(false);
        };
        let Some(installed) = store::read(&self.root)? else {
            return Ok(false);
        };
        if installed.bundle_version != self.release.version {
            return Ok(false);
        }
        store::executable_paths(&self.root, &installed, platform)?;
        let base = store::generation(&self.root, &installed);
        let key = environment
            .keys()
            .find(|key| {
                if cfg!(windows) {
                    key.eq_ignore_ascii_case("PATH")
                } else {
                    key.as_str() == "PATH"
                }
            })
            .cloned()
            .unwrap_or_else(|| "PATH".into());
        let prior = environment
            .get(&key)
            .map(std::ffi::OsString::from)
            .or_else(|| std::env::var_os("PATH"))
            .unwrap_or_default();
        let paths = platform
            .artifacts
            .iter()
            .map(|artifact| base.join(&artifact.bin))
            .chain(std::env::split_paths(&prior));
        environment.insert(
            key,
            std::env::join_paths(paths)
                .map_err(io::Error::other)?
                .to_string_lossy()
                .into_owned(),
        );
        Ok(true)
    }

    fn progress(
        &self,
        id: &str,
        phase: PrimaryRuntimeInstallPhase,
        bytes: u64,
        total: Option<u64>,
    ) {
        let mut state = self.state.lock().expect("dependency state");
        if let Some(update) = state.update.as_mut().filter(|update| update.id == id) {
            update.phase = phase;
            update.downloaded_bytes = bytes;
            update.total_bytes = total;
        }
    }
}

async fn probe(path: &Path, expected: &str) -> io::Result<()> {
    use std::process::Stdio;
    let mut child = tokio::process::Command::from(crate::subprocess::background_command(path))
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdout = child.stdout.take().expect("probe stdout").take(4096);
    let mut stderr = child.stderr.take().expect("probe stderr").take(4096);
    let operation = async {
        let mut out = Vec::new();
        let mut err = Vec::new();
        let (outcome, error, status) = tokio::join!(
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err),
            child.wait()
        );
        outcome?;
        error?;
        let version = String::from_utf8_lossy(&out).trim().to_string();
        let version = if version.is_empty() {
            String::from_utf8_lossy(&err).trim().to_string()
        } else {
            version
        };
        if !status?.success()
            || ![format!("v{expected}"), format!("Python {expected}")].contains(&version)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "dependency version probe failed",
            ));
        }
        Ok(())
    };
    tokio::time::timeout(std::time::Duration::from_secs(10), operation)
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "dependency probe timed out"))?
}

#[cfg(test)]
mod tests;
