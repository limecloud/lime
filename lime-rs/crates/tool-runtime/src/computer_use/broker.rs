//! Per-user OS lock shared by independently started Desktop and CLI App Servers.
//! Lime host adaptation. Only the explicit unlock-on-drop pattern is adapted from:
//! Codex revision 1885417cd45a8da5bfdeb7864a5380a7481d48f2,
//! codex-rs/app-server-daemon/src/backend/pid.rs::EmptyPidProbeLock (Apache-2.0).

use super::{denied, ComputerUseResult};
use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub(super) struct ControlBroker {
    directory: Option<PathBuf>,
}

impl ControlBroker {
    pub(super) fn at(directory: PathBuf) -> Self {
        Self {
            directory: Some(directory),
        }
    }

    pub(super) fn acquire(&self) -> ComputerUseResult<ControlLease> {
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| denied("Computer Use control directory was not supplied by the host"))?;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(io_error)?;
        check_path(&directory, true)?;
        #[cfg(target_os = "linux")]
        if fs::symlink_metadata(directory.join("human-control")).is_ok() {
            return Err(denied(
                "Human desktop control is active; explicitly return control to AI",
            ));
        }

        // Never unlink/replace this file: doing so would split the resource into two
        // independently lockable inodes while an old process is still using it.
        let path = directory.join("desktop.lock");
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                check_path(&path, false)?;
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&path)
                    .map_err(io_error)?
            }
            Err(error) => return Err(io_error(error)),
        };
        // fs2 uses flock on macOS and LockFileEx on Windows. A failed or unknown
        // locking implementation is an error, never an in-memory fallback.
        file.try_lock_exclusive().map_err(|error| {
            if error.kind() == fs2::lock_contended_error().kind() {
                denied("Computer Use desktop resource is busy in another App Server")
            } else {
                io_error(error)
            }
        })?;

        let mut lease = ControlLease {
            _file: file,
            fence: 0,
        };
        let file = &mut lease._file;
        let length = file.metadata().map_err(io_error)?.len();
        let previous = match length {
            0 => 0,
            8 => {
                let mut bytes = [0; 8];
                file.read_exact(&mut bytes).map_err(io_error)?;
                u64::from_be_bytes(bytes)
            }
            _ => return Err(denied("Computer Use desktop fence is corrupt")),
        };
        let fence = previous
            .checked_add(1)
            .ok_or_else(|| denied("Computer Use desktop fence is exhausted"))?;
        file.seek(SeekFrom::Start(0)).map_err(io_error)?;
        file.write_all(&fence.to_be_bytes()).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        lease.fence = fence;
        Ok(lease)
    }
}

fn io_error(error: std::io::Error) -> super::ComputerUseError {
    denied(format!("Computer Use desktop lock is unavailable: {error}"))
}

pub(super) fn check_path(path: &Path, directory: bool) -> ComputerUseResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(denied(
            "Computer Use desktop lock path is not a private regular path",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o077 != 0 || (!directory && metadata.nlink() != 1) {
            return Err(denied("Computer Use desktop lock path is not private"));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(denied("Computer Use desktop lock path is a reparse point"));
        }
    }
    Ok(())
}

#[derive(Debug)]
pub(super) struct ControlLease {
    // Dropping the last action/lease reference releases the OS lock. Cancellation
    // alone must not unlock a resource while an in-flight action still holds it.
    _file: File,
    pub(super) fence: u64,
}

impl Drop for ControlLease {
    fn drop(&mut self) {
        // Closing alone leaves the lock held by any concurrent fork. Release it
        // on every exit, including errors while reading or updating the fence.
        if let Err(error) = FileExt::unlock(&self._file) {
            tracing::warn!(%error, "failed to unlock Computer Use desktop resource");
        }
    }
}

#[cfg(test)]
#[path = "broker_tests.rs"]
mod tests;
