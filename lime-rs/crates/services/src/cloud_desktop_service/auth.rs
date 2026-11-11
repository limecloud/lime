//! 官方 CLI 管理 OAuth 和令牌刷新；Lime 仅持久化连接元数据。

use super::*;
use serde::{Deserialize, Serialize};
use std::io::Read;

pub(super) mod cli;
const PROFILE_PREFIX: &str = "lime-oauth-";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connection {
    profile: String,
    region_id: String,
    status: String,
    error_code: Option<String>,
}

impl CloudDesktopService {
    fn auth_directory(&self, path: &str) -> Result<PathBuf, String> {
        self.ensure_root()?;
        let root = self.root.join("auth");
        CloudDesktopService {
            root: root.clone(),
            cli: self.cli.clone(),
        }
        .ensure_root()?;
        let directory = root.join(path);
        CloudDesktopService {
            root: directory.clone(),
            cli: self.cli.clone(),
        }
        .ensure_root()?;
        Ok(directory)
    }

    fn auth_lock(&self) -> Result<File, String> {
        private_open(&self.auth_directory("")?.join("connection.lock"), false)
    }

    fn read_connection_file(&self, path: &Path) -> Result<Option<Connection>, String> {
        if !path
            .try_exists()
            .map_err(|_| "Cannot inspect Alibaba connection")?
        {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        private_open(path, false)?
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read Alibaba connection")?;
        if bytes.len() > 4096 {
            return Err("Invalid Alibaba connection metadata".into());
        }
        let state: Connection =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid Alibaba connection metadata")?;
        validate_profile(&state.profile)?;
        validate_id(&state.region_id)?;
        if !["preparing", "authorizing", "connected", "failed"].contains(&state.status.as_str()) {
            return Err("Invalid Alibaba connection status".into());
        }
        Ok(Some(state))
    }

    fn write_connection_file(&self, path: &Path, state: &Connection) -> Result<(), String> {
        let mut file =
            tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid connection path")?)
                .map_err(|_| "Cannot create Alibaba connection metadata")?;
        serde_json::to_writer(&mut file, state)
            .map_err(|_| "Cannot encode Alibaba connection metadata")?;
        file.as_file()
            .sync_all()
            .map_err(|_| "Cannot sync Alibaba connection metadata")?;
        file.persist(path)
            .map_err(|_| "Cannot persist Alibaba connection metadata")?;
        Ok(())
    }

    pub(super) fn read_alibaba_connection(&self) -> Result<Value, String> {
        let lock = self.auth_lock()?;
        let Some(mut state) =
            self.read_connection_file(&self.auth_directory("")?.join("active.json"))?
        else {
            return Ok(json!({"status":"disconnected"}));
        };
        if ["preparing", "authorizing"].contains(&state.status.as_str())
            && lock.try_lock_exclusive().is_ok()
        {
            // The process holding the lease exited. Never revive a browser login
            // automatically after restart or confuse it with a purchase receipt.
            FileExt::unlock(&lock).map_err(|_| "Cannot unlock Alibaba connection")?;
            state.status = "failed".into();
            state.error_code = Some("interrupted".into());
        }
        if state.status == "connected" {
            self.alibaba_config(&state.profile)?;
        }
        serde_json::to_value(state).map_err(|_| "Cannot project Alibaba connection".into())
    }

    pub(super) fn connect_alibaba(&self, region: &str) -> Result<Value, String> {
        validate_id(region)?;
        let lock = self.auth_lock()?;
        if lock.try_lock_exclusive().is_err() {
            return self.read_alibaba_connection();
        }
        let state = Connection {
            profile: format!("{PROFILE_PREFIX}{}", uuid::Uuid::new_v4().simple()),
            region_id: region.into(),
            status: "preparing".into(),
            error_code: None,
        };
        self.auth_directory(&state.profile)?;
        self.write_connection_file(&self.auth_directory("")?.join("active.json"), &state)?;
        let result =
            serde_json::to_value(&state).map_err(|_| "Cannot project Alibaba connection")?;
        let service = self.clone();
        tokio::spawn(async move {
            let _lease = receipts::OperationLock::new(lock);
            service.authorize_alibaba(state).await;
        });
        Ok(result)
    }

    async fn authorize_alibaba(&self, mut state: Connection) {
        let result = self.run_alibaba_authorization(&mut state).await;
        state.status = if result.is_ok() {
            "connected"
        } else {
            "failed"
        }
        .into();
        state.error_code = result.err();
        if let Ok(directory) = self.auth_directory(&state.profile) {
            let _ = self.write_connection_file(&directory.join("connection.json"), &state);
        }
        if let Ok(directory) = self.auth_directory("") {
            let _ = self.write_connection_file(&directory.join("active.json"), &state);
        }
    }

    async fn run_alibaba_authorization(&self, state: &mut Connection) -> Result<(), String> {
        let binary = cli::ensure_available(self)
            .await
            .map_err(|_| "cliUnavailable".to_owned())?;
        let config = self.auth_directory(&state.profile)?.join("aliyun.json");
        // Create a private empty configuration, never inherit ~/.aliyun/config.json.
        let mut file = private_open(&config, true)?;
        file.write_all(b"{\"current\":\"\",\"profiles\":[]}")
            .map_err(|_| "configurationFailed".to_owned())?;
        file.sync_all()
            .map_err(|_| "configurationFailed".to_owned())?;
        state.status = "authorizing".into();
        self.write_connection_file(&self.auth_directory("")?.join("active.json"), state)?;
        let mut command = Command::new(binary);
        command
            .args([
                "configure",
                "--mode",
                "OAuth",
                "--oauth-site-type",
                "CN",
                "--profile",
                &state.profile,
            ])
            .arg("--config-path")
            .arg(&config)
            // EOF accepts the CLI's public region/language defaults. All cloud
            // calls specify both --region and RegionId. No callback URL enters Lime.
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let status = tokio::time::timeout(OAUTH_TIMEOUT, command.status())
            .await
            .map_err(|_| "authorizationTimedOut".to_owned())?
            .map_err(|_| "authorizationFailed".to_owned())?;
        if !status.success() {
            return Err("authorizationFailed".into());
        }
        private_open(&config, false)?;
        Ok(())
    }

    pub(super) fn alibaba_config(&self, profile: &str) -> Result<Option<PathBuf>, String> {
        if !profile.starts_with(PROFILE_PREFIX) {
            return Ok(None);
        }
        validate_profile(profile)?;
        let directory = self.auth_directory(profile)?;
        let state = self
            .read_connection_file(&directory.join("connection.json"))?
            .filter(|state| state.status == "connected" && state.profile == profile)
            .ok_or("Alibaba account requires browser authorization")?;
        let config = directory.join("aliyun.json");
        if !config
            .try_exists()
            .map_err(|_| "Cannot inspect Alibaba configuration")?
        {
            return Err("Alibaba account requires browser authorization".into());
        }
        private_open(&config, false)?;
        drop(state);
        Ok(Some(config))
    }
}

fn validate_profile(profile: &str) -> Result<(), String> {
    let suffix = profile
        .strip_prefix(PROFILE_PREFIX)
        .ok_or("Invalid managed Alibaba profile")?;
    if suffix.len() != 32 || !suffix.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid managed Alibaba profile".into());
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests;
