//! 官方 CLI 负责刷新令牌；这里只使不足任务窗口的本机缓存失效并串行化配置读写。

use super::*;

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) async fn lease_cli_configuration(
        &self,
        path: &Path,
        profile: &str,
        minimum_seconds: i64,
    ) -> Result<receipts::OperationLock, String> {
        let file = private_open(&path.with_extension("credential.lock"), false)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => break,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if tokio::time::Instant::now() >= deadline {
                        return Err("Alibaba credential configuration is busy; inspect the original operation".into());
                    }
                    // Wait before spawning the CLI. No cloud request or mutation is replayed.
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(_) => return Err("Cannot lock Alibaba credential configuration".into()),
            }
        }
        let lease = receipts::OperationLock::new(file);
        if minimum_seconds == 0 {
            return Ok(lease);
        }
        if !(1..=7200).contains(&minimum_seconds)
            || self.alibaba_config(profile)?.as_deref() != Some(path)
        {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        let mut bytes = Vec::new();
        private_open(path, false)?
            .take(MAX_PROVIDER_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        if bytes.len() as u64 > MAX_PROVIDER_BYTES {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        let mut config: Value =
            serde_json::from_slice(&bytes).map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        let profiles = config["profiles"]
            .as_array_mut()
            .ok_or("OSS_AUTHORIZATION_FAILED")?;
        if profiles
            .iter()
            .filter(|entry| entry["name"] == profile)
            .count()
            != 1
        {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        let selected = profiles
            .iter_mut()
            .find(|entry| entry["name"] == profile)
            .ok_or("OSS_AUTHORIZATION_FAILED")?;
        if selected["mode"] != "OAuth" {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        let now = chrono::Utc::now().timestamp();
        if selected["sts_expiration"]
            .as_i64()
            .is_some_and(|expiry| expiry > now + minimum_seconds)
        {
            return Ok(lease);
        }
        // aliyun-cli v3.5.2 config/profile.go refreshes only after cached STS
        // expiry. Invalidate cached lifetimes, retaining all OAuth identity data;
        // the original official CLI refreshes and atomically persists its result.
        selected["sts_expiration"] = json!(0);
        if selected["oauth_access_token_expire"]
            .as_i64()
            .is_none_or(|expiry| expiry <= now + minimum_seconds)
        {
            if selected["oauth_refresh_token"]
                .as_str()
                .is_none_or(str::is_empty)
            {
                return Err("OSS_AUTHORIZATION_FAILED".into());
            }
            selected["oauth_access_token_expire"] = json!(0);
        }
        let parent = path.parent().ok_or("OSS_AUTHORIZATION_FAILED")?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        serde_json::to_writer(&mut temporary, &config).map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        temporary
            .persist(path)
            .map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        Ok(lease)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn insufficient_lifetime_invalidates_only_cached_expirations_under_the_shared_lock() {
        let directory = tempfile::tempdir().unwrap();
        let service = CloudDesktopService {
            root: directory.path().join("cloud"),
            cli: "unused".into(),
        };
        let profile = format!("lime-oauth-{}", uuid::Uuid::new_v4().simple());
        let root = service.auth_directory(&profile).unwrap();
        let path = root.join("aliyun.json");
        let now = chrono::Utc::now().timestamp();
        let original = json!({"profiles":[{"name":profile,"mode":"OAuth","sts_expiration":now+120,
            "oauth_access_token_expire":now+120,"oauth_refresh_token":"synthetic-refresh","oauth_access_token":"synthetic-access","sts_token":"synthetic-sts"}],"current":profile});
        for (path, value) in [
            (
                root.join("connection.json"),
                json!({"profile":profile,"regionId":"cn-hangzhou","status":"connected","errorCode":null}),
            ),
            (path.clone(), original.clone()),
        ] {
            let mut file = private_open(&path, true).unwrap();
            serde_json::to_writer(&mut file, &value).unwrap();
        }
        let lock = service
            .lease_cli_configuration(&path, &profile, 1860)
            .await
            .unwrap();
        assert!(tokio::time::timeout(
            Duration::from_millis(100),
            service.lease_cli_configuration(&path, &profile, 0)
        )
        .await
        .is_err());
        let observed: Value = serde_json::from_reader(private_open(&path, false).unwrap()).unwrap();
        let mut expected = original;
        expected["profiles"][0]["sts_expiration"] = json!(0);
        expected["profiles"][0]["oauth_access_token_expire"] = json!(0);
        assert_eq!(observed, expected);
        drop(lock);
        assert!(service
            .lease_cli_configuration(&path, &profile, 0)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn waiting_configuration_lease_acquires_only_after_the_holder_releases() {
        let directory = tempfile::tempdir().unwrap();
        let service = CloudDesktopService {
            root: directory.path().join("cloud"),
            cli: "unused".into(),
        };
        let path = directory.path().join("aliyun.json");
        let holder = service
            .lease_cli_configuration(&path, "fixture", 0)
            .await
            .unwrap();
        let waiting = service.lease_cli_configuration(&path, "fixture", 0);
        tokio::pin!(waiting);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut waiting)
                .await
                .is_err()
        );
        drop(holder);
        let acquired = tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .unwrap()
            .unwrap();
        drop(acquired);
    }

    #[tokio::test]
    async fn configuration_io_failure_is_not_reported_as_refresh_contention() {
        let directory = tempfile::tempdir().unwrap();
        let service = CloudDesktopService {
            root: directory.path().join("cloud"),
            cli: "unused".into(),
        };
        let path = directory.path().join("missing/aliyun.json");
        let error = match tokio::time::timeout(
            Duration::from_secs(1),
            service.lease_cli_configuration(&path, "fixture", 0),
        )
        .await
        .unwrap()
        {
            Err(error) => error,
            Ok(_) => panic!("missing directory must fail"),
        };
        assert!(!error.contains("busy") && !error.contains("refreshed"));
    }
}
