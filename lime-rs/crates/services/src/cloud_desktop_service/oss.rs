//! 已授权的本机 Alibaba 身份只向私有传输进程交付短期 STS；不导出长期/OAuth 凭据。

use super::*;
use std::io::Read;

mod rclone;
mod runtime;
mod runtime_client;

struct Credentials {
    access_key: String,
    secret_key: String,
    token: String,
    expires_at: i64,
}

impl CloudDesktopService {
    async fn oss_credentials(&self, profile: &str, region: &str) -> Result<Credentials, String> {
        self.oss_credentials_for_window(profile, region, 0).await
    }

    async fn oss_credentials_for_window(&self, profile: &str, region: &str, minimum_seconds: i64) -> Result<Credentials, String> {
        validate_region(region)?;
        let path = self
            .alibaba_config(profile)?
            .ok_or("OSS_BROWSER_CONNECTION_REQUIRED")?;
        self.execute_cli_with_credential_window("sts", None, region, profile, &["GetCallerIdentity".into()], Some(path.clone()), minimum_seconds)
            .await
            .map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        let mut bytes = Vec::new();
        private_open(&path, false)?
            .take(MAX_PROVIDER_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
        if bytes.len() as u64 > MAX_PROVIDER_BYTES {
            return Err("OSS_AUTHORIZATION_FAILED".into());
        }
        parse_credentials(&bytes, profile, chrono::Utc::now().timestamp())
    }

    pub(super) async fn list_oss_buckets(
        &self,
        profile: &str,
        region: &str,
    ) -> Result<Value, String> {
        let credentials = self.oss_credentials(profile, region).await?;
        let program = rclone::ensure(self).await?;
        list_buckets(transport_command(&program, region, credentials)?, region).await
    }

    pub(super) async fn transfer_oss_archive(
        &self,
        profile: &str,
        region: &str,
        bucket: &str,
        key: &str,
        local: &Path,
        upload: bool,
        digest: &str,
    ) -> Result<Value, String> {
        validate_bucket(bucket)?;
        // The archive owner performs the remaining contained-path, age and hash checks.
        if key.len() > 1024
            || key.contains(['\\', ':', '?', '#'])
            || key.chars().any(char::is_control)
            || key
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !key.ends_with(".age")
        {
            return Err("OSS_INVALID_OBJECT".into());
        }
        let credentials = self.oss_credentials(profile, region).await?;
        let program = rclone::ensure(self).await?;
        let command = transport_command(&program, region, credentials)?;
        let mut result = crate::cloud_archive_service::transfer_with_command(
            local,
            &format!("limeoss:{bucket}/{key}"),
            upload,
            digest,
            command,
        )
        .await
        .map_err(|_| "OSS_TRANSFER_FAILED_INSPECT_DESTINATION")?;
        let fields = result
            .as_object_mut()
            .ok_or("OSS_TRANSFER_FAILED_INSPECT_DESTINATION")?;
        fields.remove("remote");
        fields.insert("bucket".into(), bucket.into());
        fields.insert("objectKey".into(), key.into());
        fields.insert("regionId".into(), region.into());
        Ok(result)
    }
}

fn parse_credentials(bytes: &[u8], profile: &str, now: i64) -> Result<Credentials, String> {
    let config: Value = serde_json::from_slice(bytes).map_err(|_| "OSS_AUTHORIZATION_FAILED")?;
    let profiles = config["profiles"]
        .as_array()
        .ok_or("OSS_AUTHORIZATION_FAILED")?;
    let mut matches = profiles.iter().filter(|entry| entry["name"] == profile);
    let selected = matches.next().ok_or("OSS_AUTHORIZATION_FAILED")?;
    if matches.next().is_some()
        || selected["mode"] != "OAuth"
        || selected["sts_expiration"]
            .as_i64()
            .is_none_or(|expiry| expiry <= now + 30)
    {
        return Err("OSS_AUTHORIZATION_FAILED".into());
    }
    let field = |name: &str| {
        selected[name]
            .as_str()
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 16384
                    && value.bytes().all(|b| b.is_ascii_graphic())
            })
            .map(str::to_owned)
            .ok_or_else(|| "OSS_AUTHORIZATION_FAILED".to_owned())
    };
    Ok(Credentials {
        access_key: field("access_key_id")?,
        secret_key: field("access_key_secret")?,
        token: field("sts_token")?,
        expires_at: selected["sts_expiration"]
            .as_i64()
            .ok_or("OSS_AUTHORIZATION_FAILED")?,
    })
}

fn validate_region(region: &str) -> Result<(), String> {
    validate_id(region).map_err(|_| "OSS_INVALID_REGION")?;
    if region.len() > 40
        || !region.contains('-')
        || !region
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("OSS_INVALID_REGION".into());
    }
    Ok(())
}

fn validate_bucket(bucket: &str) -> Result<(), String> {
    if !(3..=63).contains(&bucket.len())
        || !bucket.as_bytes()[0].is_ascii_alphanumeric()
        || !bucket.as_bytes()[bucket.len() - 1].is_ascii_alphanumeric()
        || !bucket
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("OSS_INVALID_BUCKET".into());
    }
    Ok(())
}

fn transport_command(
    program: &Path,
    region: &str,
    credentials: Credentials,
) -> Result<Command, String> {
    validate_region(region)?;
    let mut command = Command::new(program);
    // Only transport necessities survive. User rclone/AWS settings cannot redirect
    // the scoped identity, endpoint, headers, logs or credential resolution.
    command
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            matches!(
                key.to_str(),
                Some(
                    "PATH"
                        | "SystemRoot"
                        | "SYSTEMROOT"
                        | "WINDIR"
                        | "TEMP"
                        | "TMP"
                        | "TMPDIR"
                        | "LANG"
                        | "LC_ALL"
                        | "HTTPS_PROXY"
                        | "HTTP_PROXY"
                        | "NO_PROXY"
                        | "https_proxy"
                        | "http_proxy"
                        | "no_proxy"
                        | "SSL_CERT_FILE"
                        | "SSL_CERT_DIR"
                )
            )
        }));
    command
        .args([
            "--config",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
            "--log-level",
            "ERROR",
            "--contimeout",
            "15s",
            "--timeout",
            "60s",
        ])
        .env("RCLONE_CONFIG_LIMEOSS_TYPE", "s3")
        .env("RCLONE_CONFIG_LIMEOSS_PROVIDER", "Alibaba")
        .env("RCLONE_CONFIG_LIMEOSS_ENV_AUTH", "false")
        .env(
            "RCLONE_CONFIG_LIMEOSS_ACCESS_KEY_ID",
            credentials.access_key,
        )
        .env(
            "RCLONE_CONFIG_LIMEOSS_SECRET_ACCESS_KEY",
            credentials.secret_key,
        )
        .env("RCLONE_CONFIG_LIMEOSS_SESSION_TOKEN", credentials.token)
        .env("RCLONE_CONFIG_LIMEOSS_REGION", region)
        .env(
            "RCLONE_CONFIG_LIMEOSS_ENDPOINT",
            format!("https://oss-{region}.aliyuncs.com"),
        )
        .env("RCLONE_CONFIG_LIMEOSS_FORCE_PATH_STYLE", "false")
        .env("RCLONE_CONFIG_LIMEOSS_NO_CHECK_BUCKET", "true")
        .env("RCLONE_CONFIG_LIMEOSS_ACL", "private")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    Ok(command)
}

async fn list_buckets(mut command: Command, region: &str) -> Result<Value, String> {
    command
        .args([
            "lsjson",
            "limeoss:",
            "--dirs-only",
            "--retries",
            "1",
            "--low-level-retries",
            "1",
        ])
        .stdout(Stdio::piped());
    let mut child = command.spawn().map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
    let stdout = child.stdout.take().ok_or("OSS_LIST_FAILED")?;
    tokio::time::timeout(Duration::from_secs(90), async {
        let mut bytes = Vec::new();
        stdout
            .take(MAX_PROVIDER_BYTES + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "OSS_LIST_FAILED")?;
        if bytes.len() as u64 > MAX_PROVIDER_BYTES
            || !child.wait().await.map_err(|_| "OSS_LIST_FAILED")?.success()
        {
            return Err("OSS_LIST_FAILED".into());
        }
        let items: Vec<Value> = serde_json::from_slice(&bytes).map_err(|_| "OSS_LIST_FAILED")?;
        let mut names = std::collections::BTreeSet::new();
        for item in items {
            let name = item["Name"].as_str().ok_or("OSS_LIST_FAILED")?;
            if item["IsDir"] != true || validate_bucket(name).is_err() || item["Path"] != name {
                return Err("OSS_LIST_FAILED".into());
            }
            names.insert(name.to_owned());
        }
        Ok(json!({"buckets": names, "regionId": region}))
    })
    .await
    .map_err(|_| "OSS_LIST_FAILED")?
}

#[cfg(all(test, unix))]
mod tests;
