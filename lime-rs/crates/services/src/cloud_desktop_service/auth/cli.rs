//! 按需安装固定版本官方 CLI 到 Lime 私有目录，不修改 PATH 或全局配置。

use super::*;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek};

const VERSION: &str = "3.5.2";
const MAX_ARCHIVE: u64 = 150 * 1024 * 1024;
const MAX_EXECUTABLE: u64 = 300 * 1024 * 1024;

pub(in crate::cloud_desktop_service) fn installed_path(root: &Path) -> PathBuf {
    root.join("auth")
        .join("tools")
        .join(VERSION)
        .join(if cfg!(windows) {
            "aliyun.exe"
        } else {
            "aliyun"
        })
}

pub(in crate::cloud_desktop_service) fn program(service: &CloudDesktopService) -> PathBuf {
    let installed = installed_path(&service.root);
    if installed.is_file() {
        installed
    } else {
        service.cli.clone()
    }
}

fn release() -> Result<(&'static str, &'static str), String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok((
            "macosx-3.5.2-arm64.tgz",
            "076e14de5450e4d61c59a54957e72529a644e8e4309b6ff5118d01db2c4aca6f",
        )),
        ("macos", "x86_64") => Ok((
            "macosx-3.5.2-amd64.tgz",
            "5f03795a4a4dc5febeed8bc508090649f9d877afea894cacef96197a8e5b6788",
        )),
        ("linux", "x86_64") => Ok((
            "linux-3.5.2-amd64.tgz",
            "8058cb91fa0e2d46a7c5fd47e44ab6a465be8477b28595d408dcc03a0ed5bd4e",
        )),
        ("linux", "aarch64") => Ok((
            "linux-3.5.2-arm64.tgz",
            "e2e0b5e6089b2b56822a2a373249227b83fe5ef4a20a134bbf803869299f8926",
        )),
        ("windows", "x86_64") => Ok((
            "windows-3.5.2-amd64.zip",
            "d563dbc9edd7335e4600f69b0ef4d85b7979739258495542c48ba47b190ed608",
        )),
        _ => Err("Unsupported Alibaba CLI platform".into()),
    }
}

pub(in crate::cloud_desktop_service) async fn ensure_available(
    service: &CloudDesktopService,
) -> Result<PathBuf, String> {
    // Existing user installations and explicit test fixtures remain usable. The
    // version probe cannot read credentials or print configuration.
    let binary = program(service);
    let mut command = Command::new(&binary);
    command
        .arg("version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(5), command.output()).await {
        if output.status.success() && output.stdout.len() <= 256 {
            let version = String::from_utf8_lossy(&output.stdout);
            if semver::Version::parse(version.trim().trim_start_matches('v'))
                .is_ok_and(|version| version >= semver::Version::new(3, 5, 2))
            {
                return Ok(binary);
            }
        }
    }
    let (asset, digest) = release()?;
    service.auth_directory("tools")?;
    let directory = service.root.join("auth/tools").join(VERSION);
    CloudDesktopService {
        root: directory.clone(),
        cli: service.cli.clone(),
    }
    .ensure_root()?;
    let mut archive =
        tempfile::tempfile_in(&directory).map_err(|_| "Cannot stage Alibaba CLI download")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|_| "Cannot initialize Alibaba CLI download")?;
    let url = format!(
        "https://github.com/aliyun/aliyun-cli/releases/download/v{VERSION}/aliyun-cli-{asset}"
    );
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| "Official Alibaba CLI download failed")?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_ARCHIVE)
    {
        return Err("Alibaba CLI archive too large".into());
    }
    let mut hash = Sha256::new();
    let mut total = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Alibaba CLI download interrupted")?
    {
        total += chunk.len() as u64;
        if total > MAX_ARCHIVE {
            return Err("Alibaba CLI archive too large".into());
        }
        hash.update(&chunk);
        archive
            .write_all(&chunk)
            .map_err(|_| "Cannot stage Alibaba CLI archive")?;
    }
    if format!("{:x}", hash.finalize()) != digest {
        return Err("Alibaba CLI archive checksum mismatch".into());
    }
    archive
        .rewind()
        .map_err(|_| "Cannot read Alibaba CLI archive")?;
    let destination = installed_path(&service.root);
    tokio::task::spawn_blocking(move || {
        install_archive(archive, &destination, asset.ends_with(".zip"))
    })
    .await
    .map_err(|_| "Alibaba CLI installation worker failed")??;
    Ok(installed_path(&service.root))
}

fn copy_executable(mut input: impl Read, size: u64, output: &mut File) -> Result<(), String> {
    if size == 0 || size > MAX_EXECUTABLE {
        return Err("Invalid Alibaba CLI executable size".into());
    }
    let copied = std::io::copy(&mut input.by_ref().take(size + 1), output)
        .map_err(|_| "Cannot extract Alibaba CLI executable")?;
    if copied != size {
        return Err("Incomplete Alibaba CLI executable".into());
    }
    Ok(())
}

fn install_archive(archive: File, destination: &Path, zip: bool) -> Result<(), String> {
    let mut executable = tempfile::NamedTempFile::new_in(
        destination
            .parent()
            .ok_or("Invalid CLI installation path")?,
    )
    .map_err(|_| "Cannot stage Alibaba CLI executable")?;
    let name = if zip { "aliyun.exe" } else { "aliyun" };
    let mut found = false;
    if zip {
        let mut archive =
            zip::ZipArchive::new(archive).map_err(|_| "Invalid Alibaba CLI ZIP archive")?;
        if archive.len() > 100 {
            return Err("Invalid Alibaba CLI archive entries".into());
        }
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|_| "Invalid Alibaba CLI archive entry")?;
            if entry
                .name()
                .map_err(|_| "Invalid Alibaba CLI executable path")?
                .as_ref()
                != name
            {
                continue;
            }
            if found
                || !entry.is_file()
                || entry
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Invalid Alibaba CLI executable entry".into());
            }
            let size = entry.size();
            copy_executable(entry, size, executable.as_file_mut())?;
            found = true;
        }
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive));
        let mut total = 0u64;
        for (index, entry) in archive
            .entries()
            .map_err(|_| "Invalid Alibaba CLI archive")?
            .enumerate()
        {
            if index >= 100 {
                return Err("Invalid Alibaba CLI archive entries".into());
            }
            let entry = entry.map_err(|_| "Invalid Alibaba CLI archive entry")?;
            total = total
                .checked_add(entry.size())
                .filter(|size| *size <= MAX_EXECUTABLE)
                .ok_or("Alibaba CLI extracted archive too large")?;
            if entry
                .path()
                .map_err(|_| "Invalid Alibaba CLI executable path")?
                .as_ref()
                != Path::new(name)
            {
                continue;
            }
            if found || !entry.header().entry_type().is_file() {
                return Err("Invalid Alibaba CLI executable entry".into());
            }
            let size = entry.size();
            copy_executable(entry, size, executable.as_file_mut())?;
            found = true;
        }
    }
    if !found {
        return Err("Alibaba CLI executable missing from official archive".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        executable
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot make Alibaba CLI executable")?;
    }
    executable
        .as_file()
        .sync_all()
        .map_err(|_| "Cannot sync Alibaba CLI executable")?;
    executable
        .persist(destination)
        .map_err(|_| "Cannot publish Alibaba CLI executable")?;
    Ok(())
}

impl CloudDesktopService {
    // Shared process boundary. Only the authorization owner may pass an OAuth-complete
    // private profile before connectivity verification; ordinary callers require connected.
    pub(in crate::cloud_desktop_service) async fn execute_cli(
        &self,
        product: &str,
        version: Option<&str>,
        region: &str,
        profile: &str,
        args: &[String],
        config: Option<PathBuf>,
    ) -> Result<Value, String> {
        let mut command = Command::new(program(self));
        command.arg(product).args(args);
        if let Some(config) = config {
            command.arg("--config-path").arg(config);
            command
                .env_remove("ALIBABA_CLOUD_IGNORE_PROFILE")
                .env_remove("ALIBABACLOUD_IGNORE_PROFILE");
        }
        if let Some(version) = version {
            command.args(["--version", version, "--force"]);
        }
        // STS GetCallerIdentity has no API RegionId parameter.
        if product != "sts" {
            command.args(["--RegionId", region]);
        }
        command
            // OAuth profiles can omit their default region. The CLI validates
            // its global region before forwarding the API's RegionId parameter.
            .args(["--region", region, "--profile", profile])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| "Alibaba CLI unavailable; reconnect in Lime to prepare authorization")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Cannot read Alibaba CLI response")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Cannot read Alibaba CLI status")?;
        let result = tokio::time::timeout(Duration::from_secs(45), async {
            let mut bytes = Vec::new();
            let mut errors = Vec::new();
            let mut stdout = stdout.take(MAX_PROVIDER_BYTES + 1);
            let mut stderr = stderr.take(16385);
            tokio::try_join!(
                stdout.read_to_end(&mut bytes),
                stderr.read_to_end(&mut errors),
            )
            .map_err(|_| "Cannot read cloud response".to_owned())?;
            if bytes.len() as u64 > MAX_PROVIDER_BYTES || errors.len() > 16384 {
                return Err("Cloud response exceeds size limit".to_owned());
            }
            let status = child
                .wait()
                .await
                .map_err(|_| "Cannot wait for cloud response".to_owned())?;
            if !status.success() {
                return Err(provider_diagnostic(&errors));
            }
            serde_json::from_slice(&bytes).map_err(|_| "Invalid cloud response".to_owned())
        })
        .await
        .map_err(|_| "Cloud request timed out; outcome may be unknown")?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(path: &str, link: bool) -> File {
        let mut file = tempfile::tempfile().unwrap();
        {
            let encoder = flate2::write::GzEncoder::new(&mut file, flate2::Compression::fast());
            let mut archive = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_mode(0o755);
            if link {
                header.set_entry_type(tar::EntryType::Symlink);
                header.set_link_name("outside").unwrap();
                header.set_size(0);
                header.set_cksum();
                archive.append_data(&mut header, path, &b""[..]).unwrap();
            } else {
                header.set_size(3);
                header.set_cksum();
                archive.append_data(&mut header, path, &b"bin"[..]).unwrap();
            }
            archive.into_inner().unwrap().finish().unwrap();
        }
        file.rewind().unwrap();
        file
    }

    #[test]
    fn installer_extracts_only_regular_root_executable_and_publishes_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("aliyun");
        for (path, link) in [("subdir/aliyun", false), ("aliyun", true)] {
            assert!(install_archive(archive(path, link), &destination, false).is_err());
            assert!(!destination.exists());
        }
        install_archive(archive("aliyun", false), &destination, false).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"bin");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(destination).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }
}
