//! 固定发布的私有传输工具；不执行 PATH 中未经本入口校验的二进制。

use super::super::*;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek};

const VERSION: &str = "1.73.3";
const MAX_ARCHIVE: u64 = 150 * 1024 * 1024;
const MAX_EXECUTABLE: u64 = 300 * 1024 * 1024;

fn release() -> Result<(&'static str, &'static str), String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok((
            "osx-arm64",
            "ef046e9facd10d1fb39d0ef865d7fab9b5c6ca1597ac7c9167f3aa0c7747393f",
        )),
        ("macos", "x86_64") => Ok((
            "osx-amd64",
            "aaf209187baf40a4f6b732104121f81eedc0264aaa91186952ec3e78b82025b1",
        )),
        ("linux", "x86_64") => Ok((
            "linux-amd64",
            "70278c22b98c7d02aed01828b70053904dbce4c8a1a15d7781d836c6fdb036ea",
        )),
        ("linux", "aarch64") => Ok((
            "linux-arm64",
            "ed2a638b4cb15abe4f01d6d9c015f3a1cb41aa7a17c96db2725542c61f353b8e",
        )),
        ("windows", "x86_64") => Ok((
            "windows-amd64",
            "1c51142576194d124ffa9654f45bab972530da22a3a339509bf9bed399f9dea3",
        )),
        _ => Err("OSS_TOOL_UNSUPPORTED".into()),
    }
}

pub(super) async fn ensure(service: &CloudDesktopService) -> Result<PathBuf, String> {
    let (platform, digest) = release()?;
    for path in ["tools", "tools/rclone"] {
        service.auth_directory(path)?;
    }
    let directory = service.auth_directory(&format!("tools/rclone/{VERSION}"))?;
    let lock = private_open(&directory.join("install.lock"), false)?;
    lock.try_lock_exclusive()
        .map_err(|_| "OSS_TOOL_PREPARING")?;
    let archive_path = directory.join("release.zip");
    if !archive_path
        .try_exists()
        .map_err(|_| "OSS_TOOL_UNAVAILABLE")?
    {
        let mut pending =
            tempfile::NamedTempFile::new_in(&directory).map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        let url =
            format!("https://downloads.rclone.org/v{VERSION}/rclone-v{VERSION}-{platform}.zip");
        let mut response = client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| "OSS_TOOL_DOWNLOAD_FAILED")?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_ARCHIVE)
        {
            return Err("OSS_TOOL_INVALID".into());
        }
        let mut total = 0u64;
        let mut hash = Sha256::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "OSS_TOOL_DOWNLOAD_FAILED")?
        {
            total += chunk.len() as u64;
            if total > MAX_ARCHIVE {
                return Err("OSS_TOOL_INVALID".into());
            }
            hash.update(&chunk);
            pending
                .write_all(&chunk)
                .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        }
        if format!("{:x}", hash.finalize()) != digest {
            return Err("OSS_TOOL_INVALID".into());
        }
        pending
            .as_file()
            .sync_all()
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        lime_infra::secure_file::ensure_owner_only_permissions(pending.path())
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        pending
            .persist_noclobber(&archive_path)
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
    }
    // Verify both the cached release and executable on every use. No mutable
    // digest receipt can bless a replacement executable.
    tokio::task::spawn_blocking(move || {
        let _lease = receipts::OperationLock::new(lock);
        install(&directory, platform, digest)
    })
    .await
    .map_err(|_| "OSS_TOOL_UNAVAILABLE")?
}

fn hash_file(file: &mut File, limit: u64) -> Result<String, String> {
    let size = file.metadata().map_err(|_| "OSS_TOOL_INVALID")?.len();
    if size == 0 || size > limit {
        return Err("OSS_TOOL_INVALID".into());
    }
    file.rewind().map_err(|_| "OSS_TOOL_INVALID")?;
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "OSS_TOOL_INVALID")?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > limit {
            return Err("OSS_TOOL_INVALID".into());
        }
        hash.update(&buffer[..count]);
    }
    if bytes != size {
        return Err("OSS_TOOL_INVALID".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn install(directory: &Path, platform: &str, digest: &str) -> Result<PathBuf, String> {
    let mut archive = private_open(&directory.join("release.zip"), false)?;
    if hash_file(&mut archive, MAX_ARCHIVE)? != digest {
        return Err("OSS_TOOL_INVALID".into());
    }
    archive.rewind().map_err(|_| "OSS_TOOL_INVALID")?;
    let mut zip = zip::ZipArchive::new(archive).map_err(|_| "OSS_TOOL_INVALID")?;
    let name = if platform.starts_with("windows-") {
        "rclone.exe"
    } else {
        "rclone"
    };
    let mut entry = zip
        .by_name(&format!("rclone-v{VERSION}-{platform}/{name}"))
        .map_err(|_| "OSS_TOOL_INVALID")?;
    if !entry.is_file()
        || entry.size() == 0
        || entry.size() > MAX_EXECUTABLE
        || entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
    {
        return Err("OSS_TOOL_INVALID".into());
    }
    let size = entry.size();
    let mut pending =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
    if std::io::copy(
        &mut (&mut entry).take(MAX_EXECUTABLE + 1),
        pending.as_file_mut(),
    )
    .map_err(|_| "OSS_TOOL_INVALID")?
        != size
    {
        return Err("OSS_TOOL_INVALID".into());
    }
    let expected = hash_file(pending.as_file_mut(), MAX_EXECUTABLE)?;
    let target = directory.join(name);
    if fs::symlink_metadata(&target).is_ok() {
        let mut existing = private_open(&target, false)?;
        if hash_file(&mut existing, MAX_EXECUTABLE)? != expected {
            return Err("OSS_TOOL_INVALID".into());
        }
    } else {
        lime_infra::secure_file::ensure_owner_only_permissions(pending.path())
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(pending.path(), fs::Permissions::from_mode(0o700))
                .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        }
        pending
            .as_file()
            .sync_all()
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
        pending
            .persist_noclobber(&target)
            .map_err(|_| "OSS_TOOL_UNAVAILABLE")?;
    }
    Ok(target)
}

#[cfg(test)]
mod tests;
