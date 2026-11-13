use super::wire::{self, Release};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

mod directory;
pub(crate) use directory::verify_directory;

/// Cloud publishes ZIP archives with exact, manifest-bound paths and contents.
pub(crate) fn extract(file: &Path, release: &Release) -> Result<tempfile::TempDir, String> {
    release.validate().map_err(|e| e.to_string())?;
    let mut source = fs::File::open(file).map_err(|_| invalid())?;
    if source.metadata().map_err(|_| invalid())?.len() != release.archive_size {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut source)
        .take(wire::MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() as u64 != release.archive_size
        || hex::encode(Sha256::digest(&bytes)) != release.archive_sha256
    {
        return Err(invalid());
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| invalid())?;
    archive
        .validate_header_consistency()
        .map_err(|_| invalid())?;
    let expected = release
        .manifest
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    if archive.len() != expected.len() || archive.len() > wire::MAX_FILES {
        return Err(invalid());
    }
    let output = tempfile::Builder::new()
        .prefix("lime-market-")
        .tempdir()
        .map_err(|_| invalid())?;
    let mut seen = BTreeSet::new();
    let mut expanded = 0u64;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|_| invalid())?;
        let name = file.name().map_err(|_| invalid())?.into_owned();
        let expected = expected.get(name.as_str()).ok_or_else(invalid)?;
        let mode = file.unix_mode().unwrap_or(0o600);
        if !wire::safe_path(&name)
            || !seen.insert(name.to_lowercase())
            || file.encrypted()
            || !file.is_file()
            || !matches!(mode & 0o170000, 0 | 0o100000)
            || !matches!(
                file.compression(),
                zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
            )
            || file.size() != expected.size
        {
            return Err(invalid());
        }
        expanded = expanded.checked_add(expected.size).ok_or_else(invalid)?;
        if expanded > wire::MAX_EXPANDED_BYTES {
            return Err(invalid());
        }
        let path = output.path().join(&name);
        fs::create_dir_all(path.parent().ok_or_else(invalid)?).map_err(|_| invalid())?;
        let mut destination = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| invalid())?;
        let mut hash = Sha256::new();
        let mut total = 0u64;
        let mut block = [0u8; 8192];
        loop {
            // The extra byte verifies both the declared size and the ZIP CRC.
            let read = (&mut file)
                .take(expected.size.saturating_sub(total).saturating_add(1))
                .read(&mut block)
                .map_err(|_| invalid())?;
            if read == 0 {
                break;
            }
            total = total.checked_add(read as u64).ok_or_else(invalid)?;
            if total > expected.size {
                return Err(invalid());
            }
            hash.update(&block[..read]);
            destination
                .write_all(&block[..read])
                .map_err(|_| invalid())?;
        }
        if total != expected.size || hex::encode(hash.finalize()) != expected.sha256 {
            return Err(invalid());
        }
        destination.flush().map_err(|_| invalid())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode((mode & 0o777) | 0o600))
                .map_err(|_| invalid())?;
        }
    }
    Ok(output)
}

fn invalid() -> String {
    "invalid shared market archive".into()
}

#[cfg(test)]
mod tests;
