//! 加密用户文件归档。供应商磁盘快照保存整个 OS；此处只恢复显式选择的用户文件，
//! 不执行归档内容，不复活设备配对、输入 lease、云管理凭据或旧审批。

use age::{Decryptor, Encryptor};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;

const MANIFEST: &str = ".lime-cloud-manifest.json";
const MAX_FILES: usize = 100_000;
const MAX_ARCHIVE_BYTES: u64 = 100 * 1024 * 1024 * 1024;
pub const MAX_DOWNLOAD_SOURCE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const MAX_CLOUD_CIPHERTEXT_BYTES: u64 = MAX_DOWNLOAD_SOURCE_BYTES + 256 * 1024 * 1024;

mod transfer;
pub use transfer::transfer;
pub(crate) use transfer::transfer_with_command;
mod identity;
pub use identity::create_identity;
mod rewrap;
pub use rewrap::{rewrap_for_restore, CloudRestoreIdentity};

pub fn export(root: &Path, paths: &[String], output: &Path, recipient: &str, sensitive: bool, work_saved: bool) -> Result<Value, String> {
    export_bounded(root, paths, output, recipient, sensitive, work_saved, MAX_ARCHIVE_BYTES)
}

pub fn export_for_download(root: &Path, paths: &[String], output: &Path, recipient: &str, sensitive: bool, work_saved: bool) -> Result<Value, String> {
    export_bounded(root, paths, output, recipient, sensitive, work_saved, MAX_DOWNLOAD_SOURCE_BYTES)
}

fn export_bounded(root: &Path, paths: &[String], output: &Path, recipient: &str, sensitive: bool, work_saved: bool, limit: u64) -> Result<Value, String> {
    if !work_saved || paths.is_empty() || paths.len() > 128 || !root.is_absolute() || !output.is_absolute() {
        return Err("Select files, save/quiesce applications and provide absolute paths before export".into());
    }
    let recipient = age::x25519::Recipient::from_str(recipient).map_err(|_| "Expected age X25519 public recipient; private keys are never accepted for export")?;
    let source_root = root.canonicalize().map_err(|_| "Archive source root is unavailable")?;
    let parent = output.parent().ok_or("Archive output requires a parent directory")?.canonicalize().map_err(|_| "Archive output directory is unavailable")?;
    if output.exists() || parent.starts_with(&source_root) || output.extension().is_none_or(|extension| extension != "age") {
        return Err("Archive output must be a new .age file outside the source root".into());
    }
    let mut entries = BTreeSet::new();
    let mut skipped = 0_u64;
    for value in paths {
        let relative = safe_relative(Path::new(value))?;
        if excluded(&root.join(&relative), sensitive) { skipped += 1; continue; }
        collect(&source_root, &relative, sensitive, &mut entries, &mut skipped)?;
    }
    if entries.is_empty() { return Err("No eligible regular files selected".into()); }
    let mut pending = tempfile::NamedTempFile::new_in(&parent).map_err(|_| "Cannot create encrypted archive")?;
    let encryptor = Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient)).map_err(|_| "Cannot initialize archive encryption")?;
    {
        let encrypted = encryptor.wrap_output(pending.as_file_mut()).map_err(|_| "Cannot initialize archive encryption")?;
        let compressed = zstd::stream::write::Encoder::new(encrypted, 3).map_err(|_| "Cannot initialize archive compression")?;
        let mut archive = tar::Builder::new(compressed);
        let manifest = serde_json::to_vec(&json!({ "schemaVersion": 1, "kind": "lime-user-files",
            "platform": std::env::consts::OS, "arch": std::env::consts::ARCH,
            "containsCredentials": sensitive, "skippedEntries": skipped, "restoreExecutesCode": false,
            "scope": "selected-user-files; OS and global tools require a disk snapshot or explicit reinstallation" })).map_err(|_| "Cannot encode archive manifest")?;
        let mut header = tar::Header::new_gnu();
        header.set_size(manifest.len() as u64); header.set_mode(0o600); header.set_cksum();
        archive.append_data(&mut header, MANIFEST, manifest.as_slice()).map_err(|_| "Cannot write encrypted archive manifest")?;
        let mut total = 0_u64;
        for relative in &entries {
            let source = source_root.join(relative);
            let before = fs::symlink_metadata(&source).map_err(|_| "Archive source changed")?;
            if !before.is_file() || before.file_type().is_symlink() { return Err("Archive source changed; retry after quiescing applications".into()); }
            let mut file = File::open(&source).map_err(|_| "Cannot read archive source")?;
            let opened = file.metadata().map_err(|_| "Cannot inspect archive source")?;
            #[cfg(unix)] { use std::os::unix::fs::MetadataExt; if before.ino() != opened.ino() || before.dev() != opened.dev() { return Err("Archive source was replaced".into()); } }
            total = total.checked_add(opened.len()).filter(|total| *total <= limit).ok_or("Selected files exceed archive limit")?;
            let mut prefix = [0_u8; 8192];
            let count = file.read(&mut prefix).map_err(|_| "Cannot inspect archive source")?;
            // Recovery identities must not enter a VM archive, regardless of filename.
            if prefix[..count].windows(b"AGE-SECRET-KEY-".len()).any(|window| window == b"AGE-SECRET-KEY-") {
                return Err("Archive selection contains an age recovery identity; move it to offline storage".into());
            }
            use std::io::Seek;
            file.rewind().map_err(|_| "Cannot read archive source")?;
            let mut header = tar::Header::new_gnu();
            header.set_size(opened.len());
            #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; header.set_mode(if opened.permissions().mode() & 0o100 != 0 { 0o700 } else { 0o600 }); }
            #[cfg(not(unix))] header.set_mode(0o600);
            header.set_cksum();
            archive.append_data(&mut header, relative, file.by_ref().take(opened.len())).map_err(|_| "Source changed or encrypted archive write failed")?;
            let after = file.metadata().map_err(|_| "Cannot inspect archive source")?;
            if after.len() != opened.len() || after.modified().ok() != opened.modified().ok() {
                return Err("Archive source changed; close applications before export".into());
            }
        }
        archive.into_inner().and_then(|encoder| encoder.finish()).and_then(|writer| writer.finish()).map_err(|_| "Encrypted archive finalization failed")?;
    }
    pending.as_file().sync_all().map_err(|_| "Cannot sync encrypted archive")?;
    let (sha256, bytes) = digest(pending.path())?;
    pending.persist_noclobber(output).map_err(|_| "Archive destination exists or cannot be saved")?;
    Ok(json!({ "path": output, "sha256": sha256, "bytes": bytes, "files": entries.len(),
        "skippedEntries": skipped, "encrypted": true, "containsCredentials": sensitive,
        "restoreVerified": false, "sourceRetained": true }))
}

fn collect(root: &Path, relative: &Path, sensitive: bool, entries: &mut BTreeSet<PathBuf>, skipped: &mut u64) -> Result<(), String> {
    let source = root.join(relative);
    if excluded(&source, sensitive) { *skipped += 1; return Ok(()); }
    let mut current = root.to_owned();
    for component in relative.components() {
        current.push(component);
        if fs::symlink_metadata(&current).map_err(|_| "Archive source is unavailable")?.file_type().is_symlink() {
            *skipped += 1; return Ok(());
        }
    }
    let metadata = fs::symlink_metadata(&source).map_err(|_| "Selected archive path is unavailable")?;
    if metadata.file_type().is_symlink() { *skipped += 1; return Ok(()); }
    if metadata.is_dir() {
        for entry in fs::read_dir(source).map_err(|_| "Cannot enumerate archive source")? {
            let entry = entry.map_err(|_| "Cannot enumerate archive source")?;
            collect(root, &relative.join(entry.file_name()), sensitive, entries, skipped)?;
        }
    } else if metadata.is_file() {
        entries.insert(relative.to_owned());
        if entries.len() > MAX_FILES { return Err("Too many selected archive files".into()); }
    } else { *skipped += 1; }
    Ok(())
}

fn excluded(path: &Path, sensitive: bool) -> bool {
    let names: Vec<_> = path.components().filter_map(|component| component.as_os_str().to_str()).collect();
    if names.iter().any(|name| [".aliyun", ".aws", ".azure", ".age", ".lime", "computer-use", "cloud-desktops", "credentials", "node_modules", ".cache", "__pycache__"].contains(name)) { return true; }
    if names.windows(2).any(|pair| [[".config", "gcloud"], [".config", "rclone"], [".config", "lime"], ["share", "lime"]].contains(&[pair[0], pair[1]])) { return true; }
    let leaf = names.last().copied().unwrap_or("");
    leaf == MANIFEST || leaf == "encryption-key.v1" || (!sensitive && (names.iter().any(|name| [".ssh", ".gnupg", ".vnc", "tigervnc", "keyrings", "google-chrome", "chromium", "gh", "railway", ".railway", "cloudflare", ".wrangler"].contains(name))
        || leaf.starts_with(".env") || [".npmrc", ".netrc", ".pypirc", ".git-credentials", "Cookies", "Login Data"].contains(&leaf)
        || [".pem", ".key", ".p12", ".pfx"].iter().any(|suffix| leaf.ends_with(suffix))))
}

fn safe_relative(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || path.components().any(|part| !matches!(part, Component::Normal(_)))
        || path.to_str().is_none_or(|value| value.contains(['\\', ':', '\0']) || value.len() > 4096) {
        return Err("Archive paths must be relative, portable and contained".into());
    }
    Ok(path.to_owned())
}

pub fn restore(archive_path: &Path, identity_file: &Path, destination: &Path, expected_sha256: &str, max_bytes: u64) -> Result<Value, String> {
    restore_with_identity(archive_path, &rewrap::read_identity(identity_file)?, destination, expected_sha256, max_bytes, rewrap::MAX_LOCAL_CIPHERTEXT_BYTES)
}

fn restore_with_identity(archive_path: &Path, identity: &age::x25519::Identity, destination: &Path, expected_sha256: &str, max_bytes: u64, ciphertext_limit: u64) -> Result<Value, String> {
    if !destination.is_absolute() || fs::symlink_metadata(destination).is_ok() || max_bytes == 0 || max_bytes > MAX_ARCHIVE_BYTES {
        return Err("Restore requires a new absolute destination and a bounded byte limit".into());
    }
    let mut source = rewrap::ciphertext_reader(archive_path, ciphertext_limit)?;
    let decryptor = Decryptor::new(&mut source).map_err(|_| "Invalid encrypted archive")?;
    let reader = decryptor.decrypt(std::iter::once(identity as &dyn age::Identity)).map_err(|_| "Cannot decrypt archive with the selected identity")?;
    let mut decoder = zstd::stream::read::Decoder::new(reader).map_err(|_| "Invalid compressed archive")?;
    decoder.window_log_max(27).map_err(|_| "Cannot bound archive decoder")?;
    let parent = destination.parent().ok_or("Restore destination requires a parent")?.canonicalize().map_err(|_| "Restore parent is unavailable")?;
    let staging = tempfile::Builder::new().prefix(".lime-restore-").tempdir_in(&parent).map_err(|_| "Cannot create private restore staging")?;
    let mut archive = tar::Archive::new(decoder);
    let mut seen = BTreeSet::new();
    let mut total = 0_u64;
    let mut manifest = None;
    for entry in archive.entries().map_err(|_| "Invalid archive entries")? {
        let mut entry = entry.map_err(|_| "Invalid archive entry")?;
        let path = safe_relative(&entry.path().map_err(|_| "Invalid archive path")?)?;
        let kind = entry.header().entry_type();
        if !kind.is_file() || !seen.insert(path.clone()) || seen.len() > MAX_FILES + 1 { return Err("Archive links, devices, directories, duplicate paths or excessive entries are not accepted".into()); }
        let size = entry.size();
        total = total.checked_add(size).filter(|total| *total <= max_bytes).ok_or("Archive exceeds the restore byte limit")?;
        if path == Path::new(MANIFEST) {
            if manifest.is_some() || seen.len() != 1 || size > 65536 { return Err("Invalid archive manifest".into()); }
            let value: Value = serde_json::from_reader(entry.by_ref()).map_err(|_| "Invalid archive manifest")?;
            if value["schemaVersion"] != 1 || value["kind"] != "lime-user-files" { return Err("Unsupported archive identity".into()); }
            manifest = Some(value);
            continue;
        }
        if manifest.is_none() || excluded(&path, true) { return Err("Archive attempts to restore excluded control state".into()); }
        let target = staging.path().join(&path);
        fs::create_dir_all(target.parent().unwrap()).map_err(|_| "Cannot create restore directory")?;
        let mut options = OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&target).map_err(|_| "Cannot create restored file")?;
        let copied = io::copy(&mut entry, &mut file).map_err(|_| "Archive authentication or extraction failed")?;
        if copied != size { return Err("Truncated archive entry".into()); }
        // Restore only the owner's executable bit. Never restore setuid/setgid,
        // group/world permissions, ownership or execute the restored content.
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            let mode = entry.header().mode().map_err(|_| "Invalid archive file mode")?;
            file.set_permissions(fs::Permissions::from_mode(if mode & 0o100 != 0 { 0o700 } else { 0o600 }))
                .map_err(|_| "Cannot set restored file permissions")?;
        }
        file.sync_all().map_err(|_| "Cannot sync restored file")?;
    }
    // tar EOF alone does not authenticate the age stream's final chunk. Drain it
    // before publishing anything; cap hidden trailing decompressed data too.
    let mut decoder = archive.into_inner();
    let trailing = io::copy(&mut decoder.by_ref().take(1024 * 1024 + 1), &mut io::sink()).map_err(|_| "Archive authentication failed")?;
    if trailing > 1024 * 1024 || manifest.is_none() { return Err("Invalid trailing archive data or missing manifest".into()); }
    drop(decoder);
    rewrap::verify_read(source, expected_sha256)?;
    let leaf = destination.file_name().ok_or("Invalid restore destination")?;
    publish_restore(staging.path(), &parent.join(leaf)).map_err(|_| "Cannot publish restored files to a new directory")?;
    Ok(json!({ "destination": destination, "files": seen.len() - 1, "bytes": total,
        "manifest": manifest, "controlStateRestored": false, "requiresApplicationValidation": true }))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn publish_restore(staged: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let staged = CString::new(staged.as_os_str().as_bytes())?;
    let destination = CString::new(destination.as_os_str().as_bytes())?;
    // The paths remain alive for the syscall. Both flags reject replacement atomically.
    #[cfg(target_os = "linux")]
    let result = unsafe { libc::renameat2(libc::AT_FDCWD, staged.as_ptr(), libc::AT_FDCWD, destination.as_ptr(), libc::RENAME_NOREPLACE as _) };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renameatx_np(libc::AT_FDCWD, staged.as_ptr(), libc::AT_FDCWD, destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

#[cfg(windows)]
fn publish_restore(staged: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winbase::MoveFileExW;
    let to_wide = |path: &Path| -> io::Result<Vec<u16>> {
        let mut value: Vec<_> = path.as_os_str().encode_wide().collect();
        if value.contains(&0) { return Err(io::ErrorKind::InvalidInput.into()); }
        value.push(0);
        Ok(value)
    };
    let staged = to_wide(staged)?;
    let destination = to_wide(destination)?;
    // Both pointers are NUL-terminated and live through the call. No replacement flag.
    if unsafe { MoveFileExW(staged.as_ptr(), destination.as_ptr(), 0) } != 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn publish_restore(_staged: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::ErrorKind::Unsupported.into())
}

fn digest(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|_| "Cannot read encrypted archive")?;
    let mut sha = Sha256::new(); let mut total = 0_u64; let mut buffer = [0_u8; 65536];
    loop { let count = file.read(&mut buffer).map_err(|_| "Cannot hash archive")?; if count == 0 { break; } total += count as u64; sha.update(&buffer[..count]); }
    Ok((format!("{:x}", sha.finalize()), total))
}

fn check_digest(path: &Path, expected: &str) -> Result<(), String> {
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) || digest(path)?.0 != expected.to_ascii_lowercase() {
        return Err("Archive digest does not match the trusted export receipt".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
