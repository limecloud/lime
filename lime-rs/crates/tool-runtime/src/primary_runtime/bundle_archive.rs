use super::manifest::{Archive, Artifact};
use std::fs::File;
use std::io;
use std::path::{Component, Path, PathBuf};
use tokio_util::sync::CancellationToken;

const MAX_ENTRIES: usize = 100_000;
const MAX_UNPACKED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn contained(path: &Path, root: &str) -> bool {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => (),
            Component::ParentDir if normalized.pop() => (),
            _ => return false,
        }
    }
    normalized.starts_with(root)
}

pub(super) fn extract(
    source: &Path,
    destination: &Path,
    artifact: &Artifact,
    cancel: &CancellationToken,
) -> io::Result<()> {
    let mut bytes = 0_u64;
    match artifact.archive {
        Archive::TarGz => {
            let decoder = flate2::read::GzDecoder::new(File::open(source)?);
            let mut archive = tar::Archive::new(decoder);
            archive.set_preserve_permissions(false);
            for (index, entry) in archive.entries()?.enumerate() {
                check_limit(index, &mut bytes, 0, cancel)?;
                let mut entry = entry?;
                let path = entry.path()?.into_owned();
                if !contained(&path, &artifact.root) {
                    return Err(invalid("dependency archive path escapes its root"));
                }
                let kind = entry.header().entry_type();
                if !(kind.is_file() || kind.is_dir() || kind.is_symlink() || kind.is_hard_link()) {
                    return Err(invalid("unsupported dependency archive entry"));
                }
                if let Some(link) = entry.link_name()? {
                    let target = if kind.is_symlink() {
                        path.parent().unwrap_or(Path::new("")).join(link)
                    } else {
                        link.into_owned()
                    };
                    if !contained(&target, &artifact.root) {
                        return Err(invalid("dependency archive link escapes its root"));
                    }
                }
                check_limit(index, &mut bytes, entry.size(), cancel)?;
                if !entry.unpack_in(destination)? {
                    return Err(invalid("dependency archive path was rejected"));
                }
            }
        }
        Archive::Zip => {
            let mut archive = zip::ZipArchive::new(File::open(source)?)?;
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index)?;
                check_limit(index, &mut bytes, entry.size(), cancel)?;
                let path = entry
                    .enclosed_name()
                    .ok_or_else(|| invalid("invalid dependency zip path"))?;
                if !contained(path, &artifact.root)
                    || entry
                        .unix_mode()
                        .is_some_and(|mode| mode & 0o170000 == 0o120000)
                {
                    return Err(invalid("dependency zip entry escapes its root"));
                }
                let target = destination.join(path);
                if entry.is_dir() {
                    std::fs::create_dir_all(target)?;
                } else {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::io::copy(&mut entry, &mut File::create(target)?)?;
                }
            }
        }
    }
    Ok(())
}

fn check_limit(
    index: usize,
    total: &mut u64,
    size: u64,
    cancel: &CancellationToken,
) -> io::Result<()> {
    if cancel.is_cancelled() {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "dependency download canceled",
        ));
    }
    *total = total.saturating_add(size);
    if index >= MAX_ENTRIES || *total > MAX_UNPACKED_BYTES {
        return Err(invalid("dependency archive exceeds its unpacked limit"));
    }
    Ok(())
}
