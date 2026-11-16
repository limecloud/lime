use super::{SandboxBackend, policy};
use app_server_protocol::protocol::v2::{
    AdditionalFileSystemPermissions, FileSystemAccessMode, FileSystemPath, FileSystemSpecialPath,
    GrantedPermissionProfile, SandboxPolicy,
};
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub struct SandboxCommandRequest<'a> {
    pub backend: SandboxBackend,
    pub policy: &'a SandboxPolicy,
    pub command: Vec<String>,
    pub working_directory: &'a Path,
    pub granted_permissions: Option<&'a GrantedPermissionProfile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxCommandError {
    EmptyCommand,
    UnsupportedBackend(SandboxBackend),
    UnsupportedPolicy(String),
    InvalidPath(String),
    Policy(String),
    Seatbelt(String),
}

impl fmt::Display for SandboxCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyCommand => formatter.write_str("sandbox command must not be empty"),
            Self::UnsupportedBackend(backend) => {
                write!(
                    formatter,
                    "sandbox backend '{}' is unavailable",
                    backend.label()
                )
            }
            Self::UnsupportedPolicy(policy) => {
                write!(formatter, "sandbox policy '{policy}' is unsupported")
            }
            Self::InvalidPath(path) => write!(formatter, "sandbox path '{path}' is invalid"),
            Self::Policy(message) => write!(formatter, "sandbox policy failed: {message}"),
            Self::Seatbelt(message) => write!(formatter, "seatbelt policy failed: {message}"),
        }
    }
}

impl std::error::Error for SandboxCommandError {}

pub(crate) fn domain_file_system_policy(
    policy: &SandboxPolicy,
    granted_permissions: Option<&GrantedPermissionProfile>,
    working_directory: &Path,
) -> Result<lime_permissions::FileSystemSandboxPolicy, SandboxCommandError> {
    let domain_policy = domain_sandbox_policy(policy)?;
    let mut file_system = lime_permissions::FileSystemSandboxPolicy::from(&domain_policy);
    if let Some(permissions) = granted_permissions.and_then(|value| value.file_system.as_ref()) {
        file_system
            .entries
            .extend(domain_file_system_entries(permissions, working_directory)?);
        if let Some(depth) = permissions.glob_scan_max_depth {
            file_system.glob_scan_max_depth = Some(depth);
        }
    }
    Ok(file_system)
}

fn domain_sandbox_policy(
    policy: &SandboxPolicy,
) -> Result<lime_permissions::SandboxPolicy, SandboxCommandError> {
    Ok(match policy {
        SandboxPolicy::DangerFullAccess => lime_permissions::SandboxPolicy::DangerFullAccess,
        SandboxPolicy::ReadOnly { network_access } => lime_permissions::SandboxPolicy::ReadOnly {
            network_access: *network_access,
        },
        SandboxPolicy::ExternalSandbox { network_access } => {
            lime_permissions::SandboxPolicy::ExternalSandbox {
                network_access: match network_access {
                    app_server_protocol::protocol::v2::NetworkAccess::Enabled => {
                        lime_permissions::NetworkAccess::Enabled
                    }
                    app_server_protocol::protocol::v2::NetworkAccess::Restricted => {
                        lime_permissions::NetworkAccess::Restricted
                    }
                },
            }
        }
        SandboxPolicy::WorkspaceWrite {
            writable_roots,
            network_access,
            exclude_tmpdir_env_var,
            exclude_slash_tmp,
        } => lime_permissions::SandboxPolicy::WorkspaceWrite {
            writable_roots: writable_roots
                .iter()
                .map(|root| {
                    lime_utils_absolute_path::AbsolutePathBuf::from_absolute_path(root.as_ref())
                        .map_err(|error| SandboxCommandError::InvalidPath(error.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?,
            network_access: *network_access,
            exclude_tmpdir_env_var: *exclude_tmpdir_env_var,
            exclude_slash_tmp: *exclude_slash_tmp,
        },
    })
}

fn granted_network_enabled(
    policy: &SandboxPolicy,
    granted_permissions: Option<&GrantedPermissionProfile>,
) -> bool {
    policy::allows_network(policy)
        || granted_permissions
            .and_then(|permissions| permissions.network.as_ref())
            .and_then(|network| network.enabled)
            .unwrap_or(false)
}

fn domain_file_system_entries(
    permissions: &AdditionalFileSystemPermissions,
    cwd: &Path,
) -> Result<Vec<lime_permissions::FileSystemSandboxEntry>, SandboxCommandError> {
    let mut entries = Vec::new();
    for path in permissions.read.as_deref().unwrap_or_default() {
        entries.push(domain_entry(
            &FileSystemPath::Path { path: path.clone() },
            FileSystemAccessMode::Read,
            cwd,
        )?);
    }
    for path in permissions.write.as_deref().unwrap_or_default() {
        entries.push(domain_entry(
            &FileSystemPath::Path { path: path.clone() },
            FileSystemAccessMode::Write,
            cwd,
        )?);
    }
    for entry in permissions.entries.as_deref().unwrap_or_default() {
        entries.push(domain_entry(&entry.path, entry.access, cwd)?);
    }
    Ok(entries)
}

fn domain_entry(
    path: &FileSystemPath,
    access: FileSystemAccessMode,
    cwd: &Path,
) -> Result<lime_permissions::FileSystemSandboxEntry, SandboxCommandError> {
    let path = match path {
        FileSystemPath::Path { path } => {
            let absolute = Path::new(path);
            let absolute = if absolute.is_absolute() {
                absolute.to_path_buf()
            } else {
                cwd.join(absolute)
            };
            let absolute = lime_utils_absolute_path::AbsolutePathBuf::from_absolute_path(absolute)
                .map_err(|error| SandboxCommandError::InvalidPath(error.to_string()))?;
            lime_permissions::FileSystemPath::Path {
                path: lime_utils_path_uri::PathUri::from_abs_path(&absolute),
            }
        }
        FileSystemPath::GlobPattern { pattern } => lime_permissions::FileSystemPath::GlobPattern {
            pattern: pattern.clone(),
        },
        FileSystemPath::Special { value } => lime_permissions::FileSystemPath::Special {
            value: domain_special_path(value),
        },
    };
    Ok(lime_permissions::FileSystemSandboxEntry::new(
        path,
        match access {
            FileSystemAccessMode::Read => lime_permissions::FileSystemAccessMode::Read,
            FileSystemAccessMode::Write => lime_permissions::FileSystemAccessMode::Write,
            FileSystemAccessMode::Deny => lime_permissions::FileSystemAccessMode::Deny,
        },
    ))
}

fn domain_special_path(value: &FileSystemSpecialPath) -> lime_permissions::FileSystemSpecialPath {
    match value {
        FileSystemSpecialPath::Root => lime_permissions::FileSystemSpecialPath::Root,
        FileSystemSpecialPath::Minimal => lime_permissions::FileSystemSpecialPath::Minimal,
        FileSystemSpecialPath::ProjectRoots { subpath } => {
            lime_permissions::FileSystemSpecialPath::ProjectRoots {
                subpath: subpath.clone(),
            }
        }
        FileSystemSpecialPath::Tmpdir => lime_permissions::FileSystemSpecialPath::Tmpdir,
        FileSystemSpecialPath::SlashTmp => lime_permissions::FileSystemSpecialPath::SlashTmp,
        FileSystemSpecialPath::Unknown { path, subpath } => {
            lime_permissions::FileSystemSpecialPath::Unknown {
                path: path.clone(),
                subpath: subpath.clone(),
            }
        }
    }
}
