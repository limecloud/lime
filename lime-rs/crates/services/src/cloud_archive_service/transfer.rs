//! 只传输带可信导出摘要的 age 密文；本机暂存阻止校验后换源文件。

use super::*;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// Allow tar headers, compression framing and age overhead above the source limit.
const MAX_CIPHERTEXT_BYTES: u64 = MAX_ARCHIVE_BYTES + 1024 * 1024 * 1024;

pub async fn transfer(
    local: &Path,
    remote: &str,
    upload: bool,
    expected: &str,
) -> Result<Value, String> {
    transfer_with_program(local, remote, upload, expected, Path::new("rclone")).await
}

async fn transfer_with_program(
    local: &Path,
    remote: &str,
    upload: bool,
    expected: &str,
    program: &Path,
) -> Result<Value, String> {
    transfer_with_download_limit(
        local,
        remote,
        upload,
        expected,
        program,
        MAX_CIPHERTEXT_BYTES,
    )
    .await
}

async fn transfer_with_download_limit(
    local: &Path,
    remote: &str,
    upload: bool,
    expected: &str,
    program: &Path,
    download_limit: u64,
) -> Result<Value, String> {
    run_transfer(
        local,
        remote,
        upload,
        expected,
        tokio::process::Command::new(program),
        download_limit,
    )
    .await
}

pub(crate) async fn transfer_with_command(
    local: &Path,
    remote: &str,
    upload: bool,
    expected: &str,
    command: tokio::process::Command,
) -> Result<Value, String> {
    run_transfer(
        local,
        remote,
        upload,
        expected,
        command,
        MAX_CIPHERTEXT_BYTES,
    )
    .await
}

async fn run_transfer(
    local: &Path,
    remote: &str,
    upload: bool,
    expected: &str,
    mut command: tokio::process::Command,
    download_limit: u64,
) -> Result<Value, String> {
    let (profile, key) = remote
        .split_once(':')
        .ok_or("Expected a configured rclone remote:path")?;
    if profile.is_empty()
        || profile.starts_with('-')
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        || safe_relative(Path::new(key)).is_err()
        || !key.ends_with(".age")
        || !local.is_absolute()
        || local.extension().is_none_or(|ext| ext != "age")
    {
        return Err(
            "Only encrypted .age archives and contained rclone object paths are accepted".into(),
        );
    }
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Expected a trusted export SHA-256 before archive transfer".into());
    }
    if !upload && fs::symlink_metadata(local).is_ok() {
        return Err("Download destination must be a new file".into());
    }
    let parent = local
        .parent()
        .ok_or("Archive requires a parent directory")?;
    let pending = if upload {
        let local = local.to_owned();
        let parent = parent.to_owned();
        let expected = expected.to_owned();
        tokio::task::spawn_blocking(move || stage_upload(&local, &parent, &expected))
            .await
            .map_err(|_| "Archive staging worker failed")??
    } else {
        private_staging(parent)?
    };
    if upload {
        command
            .arg("copyto")
            .arg(pending.path())
            .arg(remote)
            // Staging already enforced the size cap. rclone rejects filter
            // flags like --max-size on single-file copyto.
            // A skipped existing key must not be reported as a new upload.
            .args(["--ignore-existing", "--error-on-no-transfer"])
            .stdout(Stdio::null());
    } else {
        // rclone copyto may write to a separate partial file. Keep all download
        // writes under our own byte limit and private staging handle instead.
        command.arg("cat").arg(remote).stdout(Stdio::piped());
    }
    command
        .args(["--retries", "1", "--low-level-retries", "1"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|_| "rclone is unavailable; configure a scoped S3/OSS remote locally")?;
    let status = tokio::time::timeout(Duration::from_secs(3600), async {
        if !upload {
            let mut stream = child
                .stdout
                .take()
                .ok_or("Cannot read encrypted download")?;
            let file = pending
                .reopen()
                .map_err(|_| "Cannot open archive staging")?;
            let mut file = tokio::fs::File::from_std(file);
            tokio::io::copy(&mut (&mut stream).take(download_limit), &mut file)
                .await
                .map_err(|_| "Cannot stage encrypted download")?;
            if stream
                .read(&mut [0])
                .await
                .map_err(|_| "Cannot read encrypted download")?
                != 0
            {
                // Stop the subprocess before returning so it cannot keep reading.
                let _ = child.kill().await;
                return Err("Encrypted download exceeds the archive transfer limit");
            }
            file.flush()
                .await
                .map_err(|_| "Cannot flush encrypted download")?;
            file.sync_all()
                .await
                .map_err(|_| "Cannot sync encrypted download")?;
        }
        child
            .wait()
            .await
            .map_err(|_| "Cannot observe archive transfer")
    })
    .await
    .map_err(|_| "Archive transfer timed out; remote outcome may be unknown")??;
    if !status.success() {
        return Err("Archive transfer failed; inspect the destination before retrying".into());
    }
    if !upload {
        let path = pending.path().to_owned();
        let expected = expected.to_owned();
        tokio::task::spawn_blocking(move || verify_ciphertext(&path, &expected))
            .await
            .map_err(|_| "Archive verification worker failed")??;
        lime_infra::secure_file::ensure_owner_only_permissions(pending.path())
            .map_err(|_| "Cannot protect encrypted download")?;
        pending
            .persist_noclobber(local)
            .map_err(|_| "Cannot publish encrypted download")?;
    }
    Ok(
        json!({ "localPath": local, "remote": remote, "uploaded": upload, "encrypted": true,
        "sha256": expected.to_ascii_lowercase(), "restoreVerified": false, "sourceRetained": true,
        "storageOrTransferMayBeCharged": true }),
    )
}

fn private_staging(parent: &Path) -> Result<tempfile::NamedTempFile, String> {
    let file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Cannot stage encrypted archive")?;
    lime_infra::secure_file::ensure_owner_only_permissions(file.path())
        .map_err(|_| "Cannot protect archive staging")?;
    Ok(file)
}

fn stage_upload(
    local: &Path,
    parent: &Path,
    expected: &str,
) -> Result<tempfile::NamedTempFile, String> {
    let metadata = fs::symlink_metadata(local).map_err(|_| "Cannot inspect encrypted archive")?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_CIPHERTEXT_BYTES
    {
        return Err("Archive upload requires a bounded regular ciphertext file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let input = options
        .open(local)
        .map_err(|_| "Cannot open encrypted archive")?;
    if !input
        .metadata()
        .map_err(|_| "Cannot inspect encrypted archive")?
        .is_file()
    {
        return Err("Archive upload requires a regular file".into());
    }
    let mut pending = private_staging(parent)?;
    let bytes = io::copy(
        &mut input.take(MAX_CIPHERTEXT_BYTES + 1),
        pending.as_file_mut(),
    )
    .map_err(|_| "Cannot stage encrypted archive")?;
    if bytes > MAX_CIPHERTEXT_BYTES {
        return Err("Encrypted archive exceeds transfer limit".into());
    }
    pending
        .as_file()
        .sync_all()
        .map_err(|_| "Cannot sync encrypted staging")?;
    verify_ciphertext(pending.path(), expected)?;
    Ok(pending)
}

fn verify_ciphertext(path: &Path, expected: &str) -> Result<(), String> {
    if fs::metadata(path)
        .map_err(|_| "Cannot inspect encrypted archive")?
        .len()
        > MAX_CIPHERTEXT_BYTES
    {
        return Err("Encrypted archive exceeds transfer limit".into());
    }
    check_digest(path, expected)?;
    // A filename and hash alone cannot distinguish accidentally renamed plaintext.
    // Header validation needs no recovery identity. Full age authentication remains
    // the restore operation's responsibility and is never claimed by transfer.
    let file = File::open(path).map_err(|_| "Cannot inspect encrypted archive")?;
    Decryptor::new(io::BufReader::new(file.take(65536)))
        .map_err(|_| "Archive is not a valid age ciphertext header")?;
    Ok(())
}

#[cfg(test)]
mod tests;
