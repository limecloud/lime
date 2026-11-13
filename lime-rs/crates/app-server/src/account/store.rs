use super::cloud::{AuthConfig, Tokens};
use app_server_protocol::protocol::v2::{
    Account, AccountAuthorization, CloudCredentialStatus, CloudResource,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

const MAX_CREDENTIAL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Credential {
    pub tokens: Tokens,
    pub audience: String,
    pub scope: String,
    pub expires_at: i64,
    #[serde(default)]
    pub authorization_expires_at: Option<i64>,
    pub status: CloudCredentialStatus,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Authorization {
    pub public: AccountAuthorization,
    pub base_url: String,
    pub config: AuthConfig,
    pub parent_epoch: String,
    pub expected_identity: Option<String>,
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub redirect_uri: String,
    pub language: String,
    pub staged: Option<Credential>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct State {
    pub version: u8,
    pub epoch: String,
    pub account: Option<Account>,
    pub credentials: BTreeMap<CloudResource, Credential>,
    pub authorizations: BTreeMap<CloudResource, Authorization>,
    #[serde(default)]
    pub tool_login: Option<ToolLogin>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ToolLogin {
    pub id: String,
    pub base_url: String,
}

impl Default for State {
    fn default() -> Self {
        Self {
            version: 1,
            epoch: uuid::Uuid::new_v4().to_string(),
            account: None,
            credentials: BTreeMap::new(),
            authorizations: BTreeMap::new(),
            tool_login: None,
        }
    }
}

pub(super) fn load(path: &Path) -> Result<State, String> {
    if let Some(parent) = path.parent() {
        check_directory(parent)?;
    }
    reject_symlink(path)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(State::default()),
        Err(_) => return Err("account_store_unavailable".into()),
    };
    lime_infra::secure_file::ensure_owner_only_permissions(path)
        .map_err(|_| "account_store_unavailable")?;
    let mut bytes = Vec::new();
    file.take(MAX_CREDENTIAL_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "account_store_unavailable")?;
    if bytes.len() as u64 > MAX_CREDENTIAL_BYTES {
        return Err("account_store_invalid".into());
    }
    let state: State = serde_json::from_slice(&bytes).map_err(|_| "account_store_invalid")?;
    if state.version != 1 || state.epoch.is_empty() {
        return Err("account_store_invalid".into());
    }
    Ok(state)
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.file_type().is_symlink() || !info.is_file() => {
            Err("account_store_invalid".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("account_store_unavailable".into()),
    }
}

pub(super) fn save(path: &Path, state: &State) -> Result<(), String> {
    reject_symlink(path)?;
    let parent = path.parent().ok_or("account_store_unavailable")?;
    let bytes = serde_json::to_vec(state).map_err(|_| "account_store_invalid")?;
    if bytes.len() as u64 > MAX_CREDENTIAL_BYTES {
        return Err("account_store_full".into());
    }
    let mut pending =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "account_store_unavailable")?;
    // Apply the shared Unix/Windows private-file contract before writing secrets.
    lime_infra::secure_file::ensure_owner_only_permissions(pending.path())
        .map_err(|_| "account_store_unavailable")?;
    pending
        .write_all(&bytes)
        .and_then(|_| pending.as_file().sync_all())
        .map_err(|_| "account_store_unavailable")?;
    pending
        .persist(path)
        .map_err(|_| "account_store_unavailable")?;
    Ok(())
}

pub(super) fn update<T>(
    path: &Path,
    action: impl FnOnce(&mut State) -> Result<T, String>,
) -> Result<T, String> {
    with_lock(path, || {
        let mut state = load(path)?;
        let result = action(&mut state)?;
        save(path, &state)?;
        Ok(result)
    })
}

pub(super) fn reset(path: &Path) -> Result<(), String> {
    with_lock(path, || save(path, &State::default()))
}

pub(super) fn with_lock<T>(
    path: &Path,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let parent = path.parent().ok_or("account_store_unavailable")?;
    let lock = open_lock(&parent.join("account.lock"))?;
    fs2::FileExt::lock_exclusive(&lock).map_err(|_| "account_store_unavailable")?;
    // Network I/O never occurs while this lock is held. All mutations reload the
    // file, including those made by another Desktop/CLI process.
    action()
}

pub(super) fn try_lock(path: &Path) -> Result<Option<fs::File>, String> {
    let lock = open_lock(path)?;
    match fs2::FileExt::try_lock_exclusive(&lock) {
        Ok(()) => Ok(Some(lock)),
        Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            Ok(None)
        }
        Err(_) => Err("account_store_unavailable".into()),
    }
}

fn open_lock(path: &Path) -> Result<fs::File, String> {
    let parent = path.parent().ok_or("account_store_unavailable")?;
    private_directory(parent)?;
    reject_symlink(path)?;
    let mut options = fs::OpenOptions::new();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(path)
        .map_err(|_| "account_store_unavailable")?;
    lime_infra::secure_file::ensure_owner_only_permissions(path)
        .map_err(|_| "account_store_unavailable")?;
    Ok(lock)
}

pub(super) fn check_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.file_type().is_symlink() || !info.is_dir() => {
            Err("account_store_invalid".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("account_store_unavailable".into()),
    }
}

pub(super) fn private_directory(parent: &Path) -> Result<(), String> {
    check_directory(parent)?;
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(parent)
        .map_err(|_| "account_store_unavailable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|_| "account_store_unavailable")?;
    }
    #[cfg(windows)]
    lime_infra::secure_file::set_windows_secure_permissions(parent)
        .map_err(|_| "account_store_unavailable")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc, Barrier};
    use std::time::Duration;

    #[test]
    fn short_transaction_waits_for_an_existing_owner() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("account.json");
        update(&path, |_| Ok(())).unwrap();
        let held = try_lock(&root.path().join("account.lock"))
            .unwrap()
            .unwrap();
        assert!(try_lock(&root.path().join("account.lock"))
            .unwrap()
            .is_none());
        let (started, ready) = mpsc::channel();
        let (completed, result) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            completed
                .send(update(&path, |state| {
                    state.epoch = "committed-after-original-owner".into();
                    Ok(())
                }))
                .unwrap();
        });
        ready.recv_timeout(Duration::from_secs(5)).unwrap();
        let waiting = result.recv_timeout(Duration::from_millis(50));
        drop(held);
        assert!(matches!(waiting, Err(mpsc::RecvTimeoutError::Timeout)));
        result
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        worker.join().unwrap();
        assert_eq!(
            load(&root.path().join("account.json")).unwrap().epoch,
            "committed-after-original-owner"
        );
    }

    #[test]
    fn concurrent_transactions_reload_without_losing_updates() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("account.json");
        update(&path, |state| {
            state.epoch = "0".into();
            Ok(())
        })
        .unwrap();
        let barrier = Arc::new(Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    for _ in 0..8 {
                        update(&path, |state| {
                            state.epoch = (state.epoch.parse::<usize>().unwrap() + 1).to_string();
                            Ok(())
                        })
                        .unwrap();
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(load(&path).unwrap().epoch, "64");
        assert_eq!(
            update::<()>(&path, |_| Err("rejected".into())).unwrap_err(),
            "rejected"
        );
        update(&path, |_| Ok(())).unwrap();
    }
}
