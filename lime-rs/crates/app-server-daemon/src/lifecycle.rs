use crate::BackendKind;
use serde::Serialize;
use std::fs;
use std::fs::File;
use std::io;
use std::path::Path;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleCommand {
    Start,
    Restart,
    Stop,
    Version,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleStatus {
    AlreadyRunning,
    Started,
    Restarted,
    Stopped,
    NotRunning,
    Running,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleOutput {
    pub status: LifecycleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<BackendKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub app_server_path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_server_version: Option<String>,
    pub listen_url: String,
    pub state_dir: PathBuf,
    pub local_socket_supported: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaemonStatePaths {
    pub state_dir: PathBuf,
    pub settings_file: PathBuf,
    pub pid_file: PathBuf,
    pub update_pid_file: PathBuf,
    pub operation_lock_file: PathBuf,
    pub stderr_log_file: PathBuf,
}

#[derive(Debug)]
pub struct OperationLock {
    path: PathBuf,
    _file: File,
}

impl OperationLock {
    pub fn acquire(path: impl Into<PathBuf>) -> Result<Self, OperationLockError> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(OperationLockError::CreateDir)?;
        }
        let file = File::options()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| match error.kind() {
                io::ErrorKind::AlreadyExists => OperationLockError::AlreadyLocked(path.clone()),
                _ => OperationLockError::Acquire(error),
            })?;
        Ok(Self { path, _file: file })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for OperationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug)]
pub enum OperationLockError {
    CreateDir(io::Error),
    Acquire(io::Error),
    AlreadyLocked(PathBuf),
}

impl std::fmt::Display for OperationLockError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CreateDir(error) => {
                write!(
                    formatter,
                    "failed to create app-server daemon lock directory: {error}"
                )
            }
            Self::Acquire(error) => write!(
                formatter,
                "failed to acquire app-server daemon lock: {error}"
            ),
            Self::AlreadyLocked(path) => write!(
                formatter,
                "app-server daemon lifecycle is already locked at {}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for OperationLockError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::CreateDir(error) | Self::Acquire(error) => Some(error),
            Self::AlreadyLocked(_) => None,
        }
    }
}

impl DaemonStatePaths {
    pub fn new(base_dir: &Path) -> Self {
        let state_dir = base_dir.join(crate::STATE_DIR_NAME);
        Self {
            settings_file: state_dir.join(crate::SETTINGS_FILE_NAME),
            pid_file: state_dir.join(crate::PID_FILE_NAME),
            update_pid_file: state_dir.join(crate::UPDATE_PID_FILE_NAME),
            operation_lock_file: state_dir.join(crate::OPERATION_LOCK_FILE_NAME),
            stderr_log_file: state_dir.join(crate::STDERR_LOG_FILE_NAME),
            state_dir,
        }
    }
}

pub fn unsupported_lifecycle_output(
    binary_path: impl Into<PathBuf>,
    listen_url: impl Into<String>,
    state_dir: impl Into<PathBuf>,
) -> LifecycleOutput {
    LifecycleOutput {
        status: LifecycleStatus::Unsupported,
        backend: None,
        pid: None,
        app_server_path: binary_path.into(),
        app_server_version: None,
        listen_url: listen_url.into(),
        state_dir: state_dir.into(),
        local_socket_supported: false,
    }
}

pub fn acquire_operation_lock(
    path: impl Into<PathBuf>,
) -> Result<OperationLock, OperationLockError> {
    OperationLock::acquire(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn state_paths_follow_codex_daemon_layout_without_lime_home() {
        let paths = DaemonStatePaths::new(Path::new("/base"));

        assert_eq!(
            paths.state_dir,
            PathBuf::from("/base").join("app-server-daemon")
        );
        assert_eq!(
            paths.settings_file,
            PathBuf::from("/base")
                .join("app-server-daemon")
                .join("settings.json")
        );
        assert_eq!(
            paths.operation_lock_file,
            PathBuf::from("/base")
                .join("app-server-daemon")
                .join("daemon.lock")
        );
    }

    #[test]
    fn lifecycle_output_uses_lime_names_not_codex_names() {
        let output =
            unsupported_lifecycle_output("/bin/app-server", "stdio://", "/state/app-server-daemon");
        let value = serde_json::to_value(output).expect("json");

        assert_eq!(
            value,
            json!({
                "status": "unsupported",
                "appServerPath": "/bin/app-server",
                "listenUrl": "stdio://",
                "stateDir": "/state/app-server-daemon",
                "localSocketSupported": false
            })
        );
        assert!(value.get("managedCodexPath").is_none());
    }

    #[test]
    fn operation_lock_serializes_lifecycle_actions_and_releases_on_drop() {
        let path = temp_lock_path("daemon.lock");

        {
            let lock = acquire_operation_lock(path.clone()).expect("acquire lock");
            assert_eq!(lock.path(), path.as_path());
            let error = acquire_operation_lock(path.clone()).expect_err("already locked");
            assert!(matches!(error, OperationLockError::AlreadyLocked(_)));
        }

        let lock = acquire_operation_lock(path.clone()).expect("reacquire lock");
        drop(lock);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(path.parent().expect("temp root"));
    }

    fn temp_lock_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("app-server-daemon-lock-{nanos}"))
            .join(name)
    }
}
