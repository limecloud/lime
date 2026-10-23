//! User instruction files share their path resolver with the prompt loader.
use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::{InstructionsReadResponse, InstructionsWriteParams};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_BYTES: usize = 32 * 1024;
static INSTRUCTIONS_LOCK: Mutex<()> = Mutex::new(());

impl RuntimeCore {
    fn user_instructions_path(&self) -> Result<PathBuf, RuntimeCoreError> {
        self.instructions_path.clone().map(Ok).unwrap_or_else(|| {
            lime_core::app_paths::resolve_user_instructions_path()
                .map_err(RuntimeCoreError::Backend)
        })
    }

    pub fn read_instructions(&self) -> Result<InstructionsReadResponse, RuntimeCoreError> {
        let _guard = INSTRUCTIONS_LOCK
            .lock()
            .map_err(|_| backend("instruction file lock poisoned"))?;
        read(&self.user_instructions_path()?)
    }

    pub fn write_instructions(
        &self,
        params: InstructionsWriteParams,
    ) -> Result<InstructionsReadResponse, RuntimeCoreError> {
        if params.contents.len() > MAX_BYTES {
            return Err(RuntimeCoreError::InvalidRequest(
                "instructions exceed 32 KiB".into(),
            ));
        }
        let _guard = INSTRUCTIONS_LOCK
            .lock()
            .map_err(|_| backend("instruction file lock poisoned"))?;
        let path = self.user_instructions_path()?;
        let current = read(&path)?;
        if current.revision != params.expected_revision {
            return Err(RuntimeCoreError::InvalidRequest(
                "instructions changed; reload before saving".into(),
            ));
        }
        // Follow an existing link so saving never replaces the user's symlink.
        let destination = if fs::symlink_metadata(&path)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            fs::canonicalize(&path).map_err(io_error)?
        } else {
            path.clone()
        };
        let parent = destination
            .parent()
            .ok_or_else(|| backend("instructions parent is unavailable"))?;
        fs::create_dir_all(parent).map_err(io_error)?;
        let mut pending = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
        if let Ok(metadata) = fs::metadata(&destination) {
            pending
                .as_file()
                .set_permissions(metadata.permissions())
                .map_err(io_error)?;
        }
        pending
            .write_all(params.contents.as_bytes())
            .map_err(io_error)?;
        pending.as_file().sync_all().map_err(io_error)?;
        // Recheck immediately before replacement; concurrent editor writes remain visible.
        if read(&path)?.revision != params.expected_revision {
            return Err(RuntimeCoreError::InvalidRequest(
                "instructions changed; reload before saving".into(),
            ));
        }
        pending
            .persist(&destination)
            .map_err(|error| io_error(error.error))?;
        read(&path)
    }
}

fn read(path: &Path) -> Result<InstructionsReadResponse, RuntimeCoreError> {
    let bytes = fs::File::open(path).and_then(|file| {
        let mut bytes = Vec::new();
        file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    let contents = match bytes {
        Ok(bytes) if bytes.len() > MAX_BYTES => return Err(backend("instructions exceed 32 KiB")),
        Ok(bytes) => String::from_utf8(bytes).map_err(|_| backend("instructions are not UTF-8"))?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(io_error(error)),
    };
    let mut digest = Sha256::new();
    digest.update(path.to_string_lossy().as_bytes());
    digest.update([0]);
    digest.update(contents.as_bytes());
    digest.update([u8::from(path.exists())]);
    Ok(InstructionsReadResponse {
        path: path.to_string_lossy().into_owned(),
        contents,
        revision: format!("{:x}", digest.finalize()),
        has_override: fs::metadata(path.with_file_name("AGENTS.override.md"))
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0),
    })
}

fn backend(message: &str) -> RuntimeCoreError {
    RuntimeCoreError::Backend(message.to_string())
}

fn io_error(error: io::Error) -> RuntimeCoreError {
    backend(&format!("instruction file operation failed: {error}"))
}
