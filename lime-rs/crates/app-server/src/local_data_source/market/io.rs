use super::*;
use serde::de::DeserializeOwned;
use std::io::{Read, Write};

pub(super) fn existing_directory(path: &Path) -> Result<(), String> {
    let info = std::fs::symlink_metadata(path).map_err(|_| "market_store_unavailable")?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err("invalid_market_directory".into());
    }
    Ok(())
}

pub(super) fn directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => existing_directory(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(path).map_err(|_| "market_store_unavailable")?;
            existing_directory(path)
        }
        Err(_) => Err("market_store_unavailable".into()),
    }
}

pub(super) fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let info = std::fs::symlink_metadata(path).map_err(|_| "market_record_unavailable")?;
    if !info.is_file() || info.file_type().is_symlink() || info.len() > 4 * 1024 * 1024 {
        return Err("invalid_market_record".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "market_record_unavailable")?
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "market_record_unavailable")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("invalid_market_record".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "invalid_market_record".into())
}

pub(super) fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid_market_record")?;
    existing_directory(parent)?;
    let bytes = serde_json::to_vec(value).map_err(|_| "invalid_market_record")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("invalid_market_record".into());
    }
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "market_store_unavailable")?;
    file.write_all(&bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "market_store_unavailable")?;
    file.persist(path).map_err(|_| "market_store_unavailable")?;
    Ok(())
}

pub(super) fn lock(root: &Path) -> Result<std::fs::File, String> {
    directory(root)?;
    let path = root.join(".mutation.lock");
    match std::fs::symlink_metadata(&path) {
        Ok(info) if !info.is_file() || info.file_type().is_symlink() => {
            return Err("invalid_market_lock".into())
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            return Err("market_store_unavailable".into())
        }
        _ => {}
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|_| "market_store_unavailable")?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|_| "market_installation_busy")?;
    Ok(file)
}
