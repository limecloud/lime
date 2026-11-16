//! Allocates Desktop-compatible worktree buckets and removes empty buckets.

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use uuid::Uuid;

pub(crate) fn allocate_worktree_root(root: &Path, repository_name: &OsStr) -> Result<PathBuf> {
    fs::create_dir_all(root)
        .with_context(|| format!("cannot create worktree root {}", root.display()))?;

    #[cfg(target_os = "macos")]
    {
        let marker = root.join(".metadata_never_index");
        fs::write(&marker, b"").with_context(|| {
            format!("cannot disable Spotlight indexing at {}", marker.display())
        })?;
    }

    for _ in 0..=u16::MAX {
        let identifier = Uuid::new_v4().simple().to_string();
        let bucket = root.join(&identifier[..4]);
        match fs::create_dir(&bucket) {
            Ok(()) => return Ok(bucket.join(repository_name)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("cannot create worktree bucket {}", bucket.display())
                });
            }
        }
    }

    bail!("all managed worktree identifiers are in use")
}

pub(crate) fn remove_empty_bucket(checkout: &Path) {
    if let Some(bucket) = checkout.parent() {
        let _ = fs::remove_dir(bucket);
    }
}
