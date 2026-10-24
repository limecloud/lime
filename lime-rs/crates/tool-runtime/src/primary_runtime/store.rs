use super::manifest::Platform;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Installed {
    pub bundle_version: String,
    pub generation: String,
}

pub(super) fn read(root: &Path) -> io::Result<Option<Installed>> {
    let path = root.join("current.json");
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if bytes.len() > 4096 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "dependency receipt is too large",
        ));
    }
    let installed: Installed = serde_json::from_slice(&bytes)?;
    if uuid::Uuid::parse_str(&installed.generation).is_err() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid dependency generation",
        ));
    }
    Ok(Some(installed))
}

pub(super) fn generation(root: &Path, installed: &Installed) -> PathBuf {
    root.join("releases").join(&installed.generation)
}

pub(super) fn executable_paths(
    root: &Path,
    installed: &Installed,
    platform: &Platform,
) -> io::Result<Vec<PathBuf>> {
    let base = generation(root, installed).canonicalize()?;
    platform
        .artifacts
        .iter()
        .map(|artifact| {
            let path = base.join(&artifact.executable).canonicalize()?;
            if !path.starts_with(&base) || !path.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "dependency executable is outside its bundle",
                ));
            }
            Ok(path)
        })
        .collect()
}

pub(super) fn lock(root: &Path) -> io::Result<File> {
    fs::create_dir_all(root)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("install.lock"))?;
    fs2::FileExt::try_lock_exclusive(&file)?;
    Ok(file)
}

pub(super) fn activate(root: &Path, installed: &Installed) -> io::Result<()> {
    let temporary = root.join(format!(".current-{}.json", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec(installed)?)?;
        file.sync_all()?;
        fs::rename(&temporary, root.join("current.json"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
