//! Resolve only a helper shipped with this App Server. No PATH/env/renderer override.

use super::{denied, ComputerUseResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};

const MANIFEST: &str = "desktop-resources.manifest.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
pub(super) struct NativeResource {
    pub path: PathBuf,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    application_id: String,
    version: String,
    platform: String,
    arch: String,
    resources: Vec<Resource>,
}

#[derive(Deserialize)]
struct Resource {
    id: String,
    path: PathBuf,
    sha256: String,
}

impl NativeResource {
    pub(super) fn discover() -> ComputerUseResult<Option<Self>> {
        if !cfg!(any(target_os = "macos", target_os = "windows")) {
            return Ok(None);
        }
        let executable = std::env::current_exe().map_err(|e| denied(e.to_string()))?;
        for root in executable.ancestors().skip(1).take(4) {
            if root.join(MANIFEST).is_file() {
                return Self::from_root(root, &executable).map(Some);
            }
        }
        Ok(None)
    }

    pub(super) fn from_root(root: &Path, executable: &Path) -> ComputerUseResult<Self> {
        let manifest_path = root.join(MANIFEST);
        if fs::metadata(&manifest_path)
            .map_err(|e| denied(e.to_string()))?
            .len()
            > MAX_MANIFEST_BYTES
        {
            return Err(denied("Native resource manifest is too large"));
        }
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(manifest_path).map_err(|e| denied(e.to_string()))?)
                .map_err(|e| denied(format!("Invalid native resource manifest: {e}")))?;
        let (platform, arch, id) = platform_identity();
        if manifest.schema_version != 1
            || manifest.application_id != "com.limecloud.lime"
            || manifest.version != env!("CARGO_PKG_VERSION")
            || manifest.platform != platform
            || manifest.arch != arch
        {
            return Err(denied(
                "Native resource manifest identity/version does not match this host",
            ));
        }
        let canonical_root = root.canonicalize().map_err(|e| denied(e.to_string()))?;
        let entry = |id: &str| -> ComputerUseResult<&Resource> {
            let entries: Vec<_> = manifest.resources.iter().filter(|r| r.id == id).collect();
            match entries.as_slice() {
                [entry] => Ok(*entry),
                _ => Err(denied(format!(
                    "Native resource manifest requires one {id}"
                ))),
            }
        };
        let resolve = |resource: &Resource| -> ComputerUseResult<Self> {
            if resource.path.as_os_str().is_empty()
                || resource
                    .path
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
            {
                return Err(denied(
                    "Native resource path must be relative and contained",
                ));
            }
            let path = canonical_root
                .join(&resource.path)
                .canonicalize()
                .map_err(|e| denied(e.to_string()))?;
            if !path.starts_with(&canonical_root) {
                return Err(denied("Native resource escapes the product root"));
            }
            let resource = Self {
                path,
                sha256: resource.sha256.clone(),
            };
            resource.verify()?;
            Ok(resource)
        };
        let app_server = resolve(entry("app-server")?)?;
        if app_server.path
            != executable
                .canonicalize()
                .map_err(|e| denied(e.to_string()))?
        {
            return Err(denied(
                "Native resource manifest belongs to another App Server",
            ));
        }
        resolve(entry(id)?)
    }

    pub(super) fn verify(&self) -> ComputerUseResult<()> {
        if !self.path.is_file() || self.sha256.len() != 64 {
            return Err(denied("Native helper is not a manifested regular file"));
        }
        let bytes = fs::read(&self.path).map_err(|e| denied(e.to_string()))?;
        if hex::encode(Sha256::digest(bytes)) != self.sha256 {
            return Err(denied("Native helper integrity verification failed"));
        }
        Ok(())
    }
}

fn platform_identity() -> (&'static str, &'static str, &'static str) {
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let id = if cfg!(target_os = "windows") {
        "windows-native-host"
    } else {
        "macos-native-host"
    };
    (platform, arch, id)
}

#[cfg(test)]
#[path = "native_resources_tests.rs"]
pub(super) mod tests;
