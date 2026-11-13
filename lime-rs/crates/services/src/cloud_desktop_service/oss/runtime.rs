//! 公开运行包的专用临时分发；与用户 age 备份没有共享对象或清理范围。

use super::runtime_client::{Client, FAILED};
use super::*;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Distribution {
    schema_version: u8,
    profile: String,
    region_id: String,
    operation_id: String,
    version: String,
    archive_bytes: u64,
    archive_sha256: String,
    phase: String,
}

impl Distribution {
    fn bucket(&self) -> String {
        format!("lime-runtime-{}", self.operation_id.replace('-', ""))
    }
    fn key(&self) -> String {
        format!("runtime/{}.tar.gz", self.archive_sha256)
    }
    fn projection(&self) -> Value {
        json!({"operationId":self.operation_id, "phase":self.phase, "archiveBytes":self.archive_bytes, "archiveSha256":self.archive_sha256})
    }
    fn validate(&self, profile: &str, region: &str, operation: &str) -> Result<(), String> {
        if self.schema_version != 1
            || self.profile != profile
            || self.region_id != region
            || self.operation_id != operation
            || ![
                "prepared",
                "creating",
                "created",
                "configuring",
                "configured",
                "uploading",
                "ready",
                "cleaning",
                "cleaned",
            ]
            .contains(&self.phase.as_str())
        {
            return Err(FAILED.into());
        }
        validate_release(&self.version, self.archive_bytes, &self.archive_sha256)
    }
}

fn validate_release(version: &str, bytes: u64, digest: &str) -> Result<(), String> {
    if version.len() > 64
        || semver::Version::parse(version).is_err()
        || version.split('.').count() != 3
        || !version.bytes().all(|b| b.is_ascii_digit() || b == b'.')
        || bytes == 0
        || bytes > 1024 * 1024 * 1024
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("CLOUD_INSTALL_PACKAGE_INVALID".into());
    }
    Ok(())
}

impl CloudDesktopService {
    fn distribution_path(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
    ) -> Result<PathBuf, String> {
        validate_id(profile)?;
        validate_region(region)?;
        if uuid::Uuid::parse_str(operation).is_err()
            || operation.len() != 36
            || operation
                != uuid::Uuid::parse_str(operation)
                    .map_err(|_| FAILED)?
                    .hyphenated()
                    .to_string()
        {
            return Err(FAILED.into());
        }
        Ok(self
            .auth_directory("runtime-distribution")?
            .join(format!("{operation}.json")))
    }

    fn distribution_lock(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
    ) -> Result<receipts::OperationLock, String> {
        let path = self
            .distribution_path(profile, region, operation)?
            .with_extension("lock");
        let file = private_open(&path, false)?;
        file.try_lock_exclusive().map_err(|_| "OSS_RUNTIME_BUSY")?;
        Ok(receipts::OperationLock::new(file))
    }

    fn load_distribution(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
    ) -> Result<Distribution, String> {
        let path = self.distribution_path(profile, region, operation)?;
        if !path.try_exists().map_err(|_| FAILED)? {
            return Err(FAILED.into());
        }
        let mut bytes = Vec::new();
        private_open(&path, false)?
            .take(8193)
            .read_to_end(&mut bytes)
            .map_err(|_| FAILED)?;
        if bytes.len() > 8192 {
            return Err(FAILED.into());
        }
        let state: Distribution = serde_json::from_slice(&bytes).map_err(|_| FAILED)?;
        state.validate(profile, region, operation)?;
        Ok(state)
    }

    fn save_distribution(&self, state: &mut Distribution, phase: &str) -> Result<(), String> {
        state.phase = phase.into();
        let path = self.distribution_path(&state.profile, &state.region_id, &state.operation_id)?;
        if path.try_exists().map_err(|_| FAILED)? {
            // Refuse replacement of an unsafe existing record.
            drop(private_open(&path, false)?);
        }
        let parent = path.parent().ok_or(FAILED)?;
        let mut pending = tempfile::NamedTempFile::new_in(parent).map_err(|_| FAILED)?;
        serde_json::to_writer(&mut pending, state).map_err(|_| FAILED)?;
        pending.as_file().sync_all().map_err(|_| FAILED)?;
        pending.persist(&path).map_err(|_| FAILED)?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| FAILED)?;
        Ok(())
    }

    async fn distribution_client(&self, state: &Distribution) -> Result<Client, String> {
        Client::new(
            self.oss_credentials_for_window(&state.profile, &state.region_id, 31 * 60)
                .await?,
            &state.region_id,
            &state.bucket(),
        )
    }

    pub(in crate::cloud_desktop_service) async fn prepare_runtime_distribution(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
        version: &str,
        bytes: u64,
        digest: &str,
    ) -> Result<Value, String> {
        validate_release(version, bytes, digest)?;
        let _lock = self.distribution_lock(profile, region, operation)?;
        let path = self.distribution_path(profile, region, operation)?;
        if path.try_exists().map_err(|_| FAILED)? {
            let state = self.load_distribution(profile, region, operation)?;
            if state.version != version
                || state.archive_bytes != bytes
                || state.archive_sha256 != digest
            {
                return Err(FAILED.into());
            }
            // A repeated submission only reconciles. It cannot resend an unknown
            // CreateBucket, lifecycle PUT or upload, even after process restart.
            return self.inspect_distribution(state).await;
        }
        let mut state = Distribution {
            schema_version: 1,
            profile: profile.into(),
            region_id: region.into(),
            operation_id: operation.into(),
            version: version.into(),
            archive_bytes: bytes,
            archive_sha256: digest.into(),
            phase: "prepared".into(),
        };
        let root = self
            .root
            .parent()
            .ok_or(FAILED)?
            .join("cloud-runtime-releases");
        for directory in [&root, &root.join(version)] {
            let info =
                fs::symlink_metadata(directory).map_err(|_| "CLOUD_INSTALL_PACKAGE_INVALID")?;
            if !info.is_dir() || info.file_type().is_symlink() {
                return Err("CLOUD_INSTALL_PACKAGE_INVALID".into());
            }
        }
        let file = root
            .join(version)
            .join(format!("lime-guest-linux-x64-{version}.tar.gz"));
        let expected = digest.to_owned();
        let (file, checksum) =
            tokio::task::spawn_blocking(move || checked_package(&file, bytes, &expected))
                .await
                .map_err(|_| FAILED)??;
        let client = self.distribution_client(&state).await?;
        // All local identity and source checks precede durable external intent.
        if client.bucket_exists().await? {
            return Err(FAILED.into());
        }
        self.save_distribution(&mut state, "creating")?;
        client.create().await?;
        self.save_distribution(&mut state, "created")?;
        self.save_distribution(&mut state, "configuring")?;
        client.configure_expiry().await?;
        self.save_distribution(&mut state, "configured")?;
        self.save_distribution(&mut state, "uploading")?;
        client
            .upload(&state.key(), file, bytes, &checksum, digest)
            .await?;
        if !client.verify_object(&state.key(), bytes, digest).await? {
            return Err(FAILED.into());
        }
        self.save_distribution(&mut state, "ready")?;
        Ok(state.projection())
    }

    async fn inspect_distribution(&self, mut state: Distribution) -> Result<Value, String> {
        if ["ready", "uploading"].contains(&state.phase.as_str()) {
            let client = self.distribution_client(&state).await?;
            client.verify_expiry().await?;
            let verified = if state.phase == "uploading" {
                client.verify_object(&state.key(), state.archive_bytes, &state.archive_sha256).await?
            } else {
                client.object_matches(&state.key(), state.archive_bytes, &state.archive_sha256).await?
            };
            if verified {
                self.save_distribution(&mut state, "ready")?;
            } else {
                return Err(FAILED.into());
            }
        }
        Ok(state.projection())
    }

    pub(in crate::cloud_desktop_service) async fn read_runtime_distribution(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
    ) -> Result<Value, String> {
        let _lock = self.distribution_lock(profile, region, operation)?;
        if fs::symlink_metadata(self.distribution_path(profile, region, operation)?)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            return Ok(json!({"operationId":operation,"phase":"absent"}));
        }
        self.inspect_distribution(self.load_distribution(profile, region, operation)?)
            .await
    }

    pub(in crate::cloud_desktop_service) async fn sign_runtime_distribution(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
    ) -> Result<Value, String> {
        let _lock = self.distribution_lock(profile, region, operation)?;
        let state = self.load_distribution(profile, region, operation)?;
        if state.phase != "ready" {
            return Err(FAILED.into());
        }
        let client = self.distribution_client(&state).await?;
        if !client
            .object_matches(&state.key(), state.archive_bytes, &state.archive_sha256)
            .await?
        {
            return Err(FAILED.into());
        }
        let (url, expires_at) = client.download_url(&state.key())?;
        Ok(
            json!({"operationId":operation, "downloadUrl":url, "expiresAt":expires_at * 1000,
            "archiveBytes":state.archive_bytes,"archiveSha256":state.archive_sha256}),
        )
    }

    pub(in crate::cloud_desktop_service) async fn cleanup_runtime_distribution(
        &self,
        profile: &str,
        region: &str,
        operation: &str,
    ) -> Result<Value, String> {
        let _lock = self.distribution_lock(profile, region, operation)?;
        if fs::symlink_metadata(self.distribution_path(profile, region, operation)?)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            return Ok(json!({"operationId":operation,"phase":"absent"}));
        }
        let mut state = self.load_distribution(profile, region, operation)?;
        if state.phase == "cleaned" {
            return Ok(state.projection());
        }
        let client = self.distribution_client(&state).await?;
        self.save_distribution(&mut state, "cleaning")?;
        client.cleanup(&state.key()).await?;
        self.save_distribution(&mut state, "cleaned")?;
        Ok(state.projection())
    }
}

fn checked_package(path: &Path, bytes: u64, digest: &str) -> Result<(File, String), String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "CLOUD_INSTALL_PACKAGE_INVALID")?;
    let info = file.metadata().map_err(|_| FAILED)?;
    if !info.is_file() || info.len() != bytes {
        return Err("CLOUD_INSTALL_PACKAGE_INVALID".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if info.nlink() != 1 || info.mode() & 0o077 != 0 || info.uid() != unsafe { libc::geteuid() }
        {
            return Err("CLOUD_INSTALL_PACKAGE_INVALID".into());
        }
    }
    let mut sha = Sha256::new();
    let mut md5 = md5::Context::new();
    let mut total = 0u64;
    let mut buffer = [0; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| FAILED)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > bytes {
            return Err("CLOUD_INSTALL_PACKAGE_INVALID".into());
        }
        sha.update(&buffer[..count]);
        md5.consume(&buffer[..count]);
    }
    if total != bytes || format!("{:x}", sha.finalize()) != digest {
        return Err("CLOUD_INSTALL_PACKAGE_INVALID".into());
    }
    file.rewind().map_err(|_| FAILED)?;
    Ok((
        file,
        base64::engine::general_purpose::STANDARD.encode(md5.compute().0),
    ))
}

#[cfg(test)]
mod tests;
