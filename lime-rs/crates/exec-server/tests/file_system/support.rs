use std::fmt;
use std::sync::Arc;

use anyhow::Result;
use exec_server::Environment;
use exec_server::ExecServerRuntimeOptions;
use exec_server::ExecutorFileSystem;
use exec_server::FileSystemSandboxContext;
use exec_server::LocalFileSystem;
use exec_server::WindowsSandboxSelection;
use lime_utils_absolute_path::AbsolutePathBuf;
use lime_utils_path_uri::PathUri;
use protocol::models::PermissionProfile;
use protocol::permissions::FileSystemAccessMode;
use protocol::permissions::FileSystemPath;
use protocol::permissions::FileSystemSandboxEntry;
use protocol::permissions::FileSystemSandboxPolicy;
use protocol::permissions::FileSystemSpecialPath;
use protocol::permissions::NetworkSandboxPolicy;

use crate::common::exec_server::ExecServerHarness;
use crate::common::exec_server::TestLimeHelperPaths;
use crate::common::exec_server::exec_server;
use crate::common::exec_server::test_lime_helper_paths;

pub(crate) struct FileSystemContext {
    pub(crate) file_system: Arc<dyn ExecutorFileSystem>,
    _helper_paths: Option<TestLimeHelperPaths>,
    _server: Option<ExecServerHarness>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum FileSystemImplementation {
    Local,
    Remote,
}

impl fmt::Display for FileSystemImplementation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Local => formatter.write_str("local"),
            Self::Remote => formatter.write_str("remote"),
        }
    }
}

pub(crate) async fn create_file_system_context(
    implementation: FileSystemImplementation,
) -> Result<FileSystemContext> {
    match implementation {
        FileSystemImplementation::Local => {
            let helper_paths = test_lime_helper_paths()?;
            let runtime_paths = ExecServerRuntimeOptions::new(
                helper_paths.lime_exe.clone(),
                helper_paths.linux_sandbox_exe.clone(),
            )?;
            Ok(FileSystemContext {
                file_system: Arc::new(LocalFileSystem::with_runtime_paths(runtime_paths)),
                _helper_paths: Some(helper_paths),
                _server: None,
            })
        }
        FileSystemImplementation::Remote => {
            let server = exec_server().await?;
            let environment =
                Environment::create_for_tests(Some(server.websocket_url().to_string()))?;
            Ok(FileSystemContext {
                file_system: environment.get_filesystem(),
                _helper_paths: None,
                _server: Some(server),
            })
        }
    }
}

#[cfg(windows)]
pub(crate) fn is_unsupported_restricted_token_host<T>(result: &std::io::Result<T>) -> bool {
    result
        .as_ref()
        .err()
        .is_some_and(|err| err.to_string().contains("CreateRestrictedToken failed: 87"))
}

pub(crate) fn absolute_path(path: std::path::PathBuf) -> AbsolutePathBuf {
    assert!(
        path.is_absolute(),
        "path must be absolute: {}",
        path.display()
    );
    AbsolutePathBuf::try_from(path).expect("path should be absolute")
}

pub(crate) fn read_only_sandbox(readable_root: std::path::PathBuf) -> FileSystemSandboxContext {
    let readable_root = absolute_path(readable_root);
    let cwd = PathUri::from_abs_path(&readable_root);
    let entries = vec![FileSystemSandboxEntry {
        path: FileSystemPath::Path {
            path: readable_root.into(),
        },
        access: FileSystemAccessMode::Read,
        missing_path_behavior: None,
    }];
    sandbox_context(entries, cwd)
}

#[cfg(not(windows))]
pub(crate) fn workspace_write_sandbox(
    writable_root: std::path::PathBuf,
) -> FileSystemSandboxContext {
    let writable_root = absolute_path(writable_root);
    let cwd = PathUri::from_abs_path(&writable_root);
    let entries = vec![FileSystemSandboxEntry {
        path: FileSystemPath::Path {
            path: writable_root.into(),
        },
        access: FileSystemAccessMode::Write,
        missing_path_behavior: None,
    }];
    sandbox_context(entries, cwd)
}

#[cfg(windows)]
pub(crate) fn workspace_write_sandbox(
    writable_root: std::path::PathBuf,
) -> FileSystemSandboxContext {
    let writable_root = absolute_path(writable_root);
    // Keep the runtime policy aligned with the legacy workspace-write projection used by the
    // unelevated restricted-token preflight.
    let policy = FileSystemSandboxPolicy::restricted(vec![
        FileSystemSandboxEntry::new(
            FileSystemPath::Special {
                value: FileSystemSpecialPath::Root,
            },
            FileSystemAccessMode::Read,
        ),
        FileSystemSandboxEntry::new(
            FileSystemPath::Special {
                value: FileSystemSpecialPath::project_roots(/*subpath*/ None),
            },
            FileSystemAccessMode::Write,
        ),
    ]);
    let mut sandbox = FileSystemSandboxContext::from_permission_profile(
        PermissionProfile::from_runtime_permissions(&policy, NetworkSandboxPolicy::Restricted),
        PathUri::from_abs_path(&writable_root),
    );
    sandbox.windows_sandbox_selection = WindowsSandboxSelection::RestrictedToken;
    sandbox
}

fn sandbox_context(
    mut entries: Vec<FileSystemSandboxEntry>,
    cwd: PathUri,
) -> FileSystemSandboxContext {
    if cfg!(windows) {
        // Restricted-token sandboxing cannot enforce read restrictions, so leave the root
        // readable while exercising the requested write restrictions.
        entries.push(FileSystemSandboxEntry::new(
            FileSystemPath::Special {
                value: FileSystemSpecialPath::Root,
            },
            FileSystemAccessMode::Read,
        ));
    }
    let mut sandbox = FileSystemSandboxContext::from_permission_profile(
        PermissionProfile::from_runtime_permissions(
            &FileSystemSandboxPolicy::restricted(entries),
            NetworkSandboxPolicy::Restricted,
        ),
        cwd,
    );
    if cfg!(windows) {
        sandbox.windows_sandbox_selection = WindowsSandboxSelection::RestrictedToken;
    }
    sandbox
}
