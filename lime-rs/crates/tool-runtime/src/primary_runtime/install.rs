use super::{
    bundle_archive,
    manifest::{Artifact, Platform},
    probe, store, PrimaryRuntimeService,
};
use app_server_protocol::protocol::v2::PrimaryRuntimeInstallPhase;
use sha2::{Digest, Sha256};
use std::io;
use std::path::Path;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const MAX_ARCHIVE_BYTES: u64 = 384 * 1024 * 1024;

impl PrimaryRuntimeService {
    pub(super) async fn perform_install(
        &self,
        id: &str,
        platform: &Platform,
        cancel: &CancellationToken,
    ) -> io::Result<()> {
        let stage = self.root.join(format!(".staging-{id}"));
        let bundle = stage.join("bundle");
        tokio::fs::create_dir_all(&bundle).await?;
        let result = self
            .install_into(id, &stage, &bundle, platform, cancel)
            .await;
        // Only the operation's own temporary directory is removed; activated generations remain immutable.
        let _ = tokio::fs::remove_dir_all(stage).await;
        result
    }

    async fn install_into(
        &self,
        id: &str,
        stage: &Path,
        bundle: &Path,
        platform: &Platform,
        cancel: &CancellationToken,
    ) -> io::Result<()> {
        let mut downloaded = 0_u64;
        for artifact in &platform.artifacts {
            check_cancel(cancel)?;
            let archive_path = stage.join(format!("{}.archive", artifact.name));
            downloaded = self
                .download(id, artifact, &archive_path, downloaded, cancel)
                .await?;
            self.progress(
                id,
                PrimaryRuntimeInstallPhase::Extracting,
                downloaded,
                Some(downloaded),
            );
            let (path, destination, artifact, token) = (
                archive_path.clone(),
                bundle.to_owned(),
                artifact.clone(),
                cancel.clone(),
            );
            tokio::task::spawn_blocking(move || {
                bundle_archive::extract(&path, &destination, &artifact, &token)
            })
            .await
            .map_err(io::Error::other)??;
            tokio::fs::remove_file(archive_path).await?;
        }
        check_cancel(cancel)?;
        self.progress(
            id,
            PrimaryRuntimeInstallPhase::Validating,
            downloaded,
            Some(downloaded),
        );
        for artifact in &platform.artifacts {
            let path = bundle.join(&artifact.executable).canonicalize()?;
            if !path.starts_with(bundle.canonicalize()?) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "dependency executable escapes bundle",
                ));
            }
            tokio::select! {
                result = probe(&path, &artifact.version) => result?,
                _ = cancel.cancelled() => return check_cancel(cancel),
            }
        }
        self.progress(
            id,
            PrimaryRuntimeInstallPhase::Configuring,
            downloaded,
            Some(downloaded),
        );
        let installed = store::Installed {
            bundle_version: self.release.version.clone(),
            generation: id.to_string(),
        };
        let target = store::generation(&self.root, &installed);
        std::fs::create_dir_all(target.parent().expect("release directory"))?;
        // Serialize cancellation against activation: a successful cancel cannot race a committed pointer.
        let mut state = self.state.lock().expect("dependency state");
        check_cancel(cancel)?;
        std::fs::rename(bundle, &target)?;
        store::activate(&self.root, &installed)?;
        // Activation is committed; the outer operation publishes Ready after releasing its file lock.
        state.cancel = None;
        drop(state);
        Ok(())
    }

    async fn download(
        &self,
        id: &str,
        artifact: &Artifact,
        path: &Path,
        previous: u64,
        cancel: &CancellationToken,
    ) -> io::Result<u64> {
        self.progress(id, PrimaryRuntimeInstallPhase::Downloading, previous, None);
        let response = tokio::select! {
            response = self.client.get(&artifact.url).send() => response.map_err(io::Error::other)?.error_for_status().map_err(io::Error::other)?,
            _ = cancel.cancelled() => return check_cancel(cancel).map(|_| previous),
        };
        if response
            .content_length()
            .is_some_and(|size| size > MAX_ARCHIVE_BYTES)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "dependency archive is too large",
            ));
        }
        let total = response
            .content_length()
            .map(|size| previous.saturating_add(size));
        let mut response = response;
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .await?;
        let mut hash = Sha256::new();
        let mut received = 0_u64;
        loop {
            let chunk = tokio::select! {
                chunk = response.chunk() => chunk.map_err(io::Error::other)?,
                _ = cancel.cancelled() => return check_cancel(cancel).map(|_| previous),
            };
            let Some(chunk) = chunk else {
                break;
            };
            received = received.saturating_add(chunk.len() as u64);
            if received > MAX_ARCHIVE_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "dependency archive is too large",
                ));
            }
            file.write_all(&chunk).await?;
            hash.update(&chunk);
            self.progress(
                id,
                PrimaryRuntimeInstallPhase::Downloading,
                previous + received,
                total,
            );
        }
        file.sync_all().await?;
        drop(file);
        self.progress(
            id,
            PrimaryRuntimeInstallPhase::Verifying,
            previous + received,
            total,
        );
        check_cancel(cancel)?;
        if hex::encode(hash.finalize()) != artifact.sha256 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "dependency archive checksum mismatch",
            ));
        }
        Ok(previous + received)
    }
}

fn check_cancel(cancel: &CancellationToken) -> io::Result<()> {
    if cancel.is_cancelled() {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "dependency download canceled",
        ))
    } else {
        Ok(())
    }
}
