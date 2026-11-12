use super::{policy, SandboxBackend};
use app_server_protocol::protocol::v2::{
    AdditionalFileSystemPermissions, FileSystemAccessMode, FileSystemPath, FileSystemSpecialPath,
    GrantedPermissionProfile, SandboxPolicy,
};
use std::fmt;
use std::path::Path;

const MACOS_SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";
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

pub fn prepare_sandbox_command(
    request: SandboxCommandRequest<'_>,
) -> Result<Vec<String>, SandboxCommandError> {
    if request.command.is_empty() {
        return Err(SandboxCommandError::EmptyCommand);
    }
    if matches!(
        request.policy,
        SandboxPolicy::DangerFullAccess | SandboxPolicy::ExternalSandbox { .. }
    ) {
        return Err(SandboxCommandError::UnsupportedPolicy(
            super::sandbox_policy_label(request.policy).to_string(),
        ));
    }

    match request.backend {
        SandboxBackend::Seatbelt => {
            #[cfg(target_os = "macos")]
            {
                prepare_seatbelt_command(
                    request.command,
                    request.working_directory,
                    request.policy,
                    request.granted_permissions,
                )
            }
            #[cfg(not(target_os = "macos"))]
            {
                Err(SandboxCommandError::UnsupportedBackend(request.backend))
            }
        }
        SandboxBackend::LinuxSandbox => prepare_bubblewrap_command(
            request.command,
            request.working_directory,
            request.policy,
            request.granted_permissions,
        ),
        SandboxBackend::None | SandboxBackend::RestrictedToken => {
            Err(SandboxCommandError::UnsupportedBackend(request.backend))
        }
    }
}

#[cfg(target_os = "macos")]
fn prepare_seatbelt_command(
    command: Vec<String>,
    working_directory: &Path,
    policy: &SandboxPolicy,
    granted_permissions: Option<&GrantedPermissionProfile>,
) -> Result<Vec<String>, SandboxCommandError> {
    let file_system = domain_file_system_policy(policy, granted_permissions, working_directory)?;
    let network = if granted_network_enabled(policy, granted_permissions) {
        lime_permissions::NetworkSandboxPolicy::Enabled
    } else {
        lime_permissions::NetworkSandboxPolicy::Restricted
    };
    let args = super::seatbelt::create_seatbelt_command_args(
        super::seatbelt::CreateSeatbeltCommandArgsParams {
            command,
            file_system_sandbox_policy: &file_system,
            network_sandbox_policy: network,
            sandbox_policy_cwd: working_directory,
            extra_allow_unix_sockets: &[],
        },
    )
    .map_err(|error| SandboxCommandError::Seatbelt(error.to_string()))?;
    let mut wrapped = vec![MACOS_SANDBOX_EXEC.to_string()];
    wrapped.extend(args);
    Ok(wrapped)
}

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

fn prepare_bubblewrap_command(
    command: Vec<String>,
    working_directory: &Path,
    policy: &SandboxPolicy,
    granted_permissions: Option<&GrantedPermissionProfile>,
) -> Result<Vec<String>, SandboxCommandError> {
    let file_system = domain_file_system_policy(policy, granted_permissions, working_directory)?;
    let resolved = file_system
        .resolve_for_enforcement(
            working_directory,
            lime_permissions::FileSystemPolicyProjection::PreserveMutableRoots,
        )
        .map_err(|error| SandboxCommandError::Policy(error.to_string()))?;
    let cwd = working_directory.to_string_lossy().to_string();
    let mut wrapped = vec![
        "bwrap".to_string(),
        "--die-with-parent".to_string(),
        "--new-session".to_string(),
        "--unshare-user".to_string(),
        "--unshare-pid".to_string(),
        "--unshare-uts".to_string(),
        "--unshare-ipc".to_string(),
        "--ro-bind".to_string(),
        "/".to_string(),
        "/".to_string(),
        "--dev-bind".to_string(),
        "/dev".to_string(),
        "/dev".to_string(),
        "--proc".to_string(),
        "/proc".to_string(),
    ];
    if !granted_network_enabled(policy, granted_permissions) {
        wrapped.push("--unshare-net".to_string());
    }
    for writable_root in &resolved.writable_roots {
        let path = writable_root.root.to_string_lossy().into_owned();
        wrapped.extend(["--bind".to_string(), path.clone(), path]);
        for read_only in &writable_root.read_only_subpaths {
            if !read_only.as_path().exists() {
                continue;
            }
            let path = read_only.to_string_lossy().into_owned();
            wrapped.extend(["--ro-bind".to_string(), path.clone(), path]);
        }
    }
    wrapped.extend(["--chdir".to_string(), cwd, "--".to_string()]);
    wrapped.extend(command);
    Ok(wrapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::AdditionalNetworkPermissions;
    use std::path::PathBuf;

    #[test]
    fn seatbelt_workspace_write_wraps_command_and_protects_metadata() {
        let workspace = tempfile::tempdir().unwrap();
        let command = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::Seatbelt,
            policy: &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            command: vec!["sh".to_string(), "-c".to_string(), "pwd".to_string()],
            working_directory: workspace.path(),
            granted_permissions: None,
        })
        .expect("seatbelt command");

        assert_eq!(command[0], MACOS_SANDBOX_EXEC);
        assert_eq!(command[1], "-p");
        let policy = &command[2];
        assert!(policy.contains("(deny default)"));
        assert!(policy.contains("(allow file-write*"));
        assert!(policy.contains("WRITABLE_ROOT_0"));
        // Protected workspace metadata stays denied even under a writable root.
        assert!(policy.contains("PROTECTED_METADATA"));
        assert!(command.iter().any(|argument| {
            argument.starts_with("-D")
                && argument.contains("PROTECTED_METADATA")
                && argument.ends_with(".git")
        }));
        let workspace_root = std::fs::canonicalize(workspace.path()).unwrap();
        assert!(command.iter().any(|argument| {
            argument
                .strip_prefix("-DWRITABLE_ROOT_0=")
                .is_some_and(|value| Path::new(value) == workspace_root)
        }));
        let delimiter = command
            .iter()
            .position(|argument| argument == "--")
            .unwrap();
        assert_eq!(&command[delimiter + 1..], ["sh", "-c", "pwd"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_policy_allows_workspace_write_and_denies_outside_write() {
        let workspace = tempfile::tempdir().unwrap();
        let workspace = std::fs::canonicalize(workspace.path()).unwrap();
        // TMPDIR is a workspace-write default root on macOS, so the denied
        // target must live outside the temporary directory entirely.
        let outside = dirs::home_dir()
            .expect("home dir")
            .join(format!(".lime-sandbox-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).expect("outside directory");
        let outside = std::fs::canonicalize(&outside).unwrap();
        let inside_file = workspace.join("inside.txt");
        let outside_file = outside.join("outside.txt");
        let script = format!(
            "echo ok > {}; echo bad > {}; true",
            inside_file.display(),
            outside_file.display()
        );
        let policy = crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap();
        let command = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::Seatbelt,
            policy: &policy,
            command: vec!["/bin/sh".to_string(), "-c".to_string(), script],
            working_directory: &workspace,
            granted_permissions: None,
        })
        .expect("seatbelt command");
        let status = std::process::Command::new(&command[0])
            .args(&command[1..])
            .status()
            .expect("run sandboxed command");
        assert!(status.success(), "sandboxed shell should complete");
        assert!(inside_file.exists(), "workspace write must succeed");
        assert!(
            !outside_file.exists(),
            "write outside workspace must be denied"
        );
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn bubblewrap_read_only_does_not_bind_workspace_writable() {
        let command = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::LinuxSandbox,
            policy: &crate::sandbox::sandbox_policy_from_label(Some("read-only")).unwrap(),
            command: vec!["pwd".to_string()],
            working_directory: Path::new("/workspace"),
            granted_permissions: None,
        })
        .expect("bubblewrap command");

        assert_eq!(command[0], "bwrap");
        assert!(command
            .windows(2)
            .any(|args| args == ["--chdir", "/workspace"]));
        assert!(!command
            .windows(3)
            .any(|args| args == ["--bind", "/workspace", "/workspace"]));
        assert!(!command.windows(3).any(|args| args[0] == "--bind"));
    }

    #[test]
    fn restricted_token_backend_fails_closed_without_runner() {
        let error = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::RestrictedToken,
            policy: &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            command: vec!["cmd.exe".to_string()],
            working_directory: Path::new("C:/workspace"),
            granted_permissions: None,
        })
        .expect_err("restricted token must not fall back to unsandboxed execution");

        assert_eq!(
            error,
            SandboxCommandError::UnsupportedBackend(SandboxBackend::RestrictedToken)
        );
    }

    #[test]
    fn seatbelt_lowers_granted_network_and_write_permissions() {
        let permissions = GrantedPermissionProfile {
            network: Some(AdditionalNetworkPermissions {
                enabled: Some(true),
            }),
            file_system: Some(AdditionalFileSystemPermissions {
                read: None,
                write: Some(vec!["/tmp/shared-output".to_string()]),
                glob_scan_max_depth: None,
                entries: None,
            }),
        };
        let command = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::Seatbelt,
            policy: &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            command: vec!["pwd".to_string()],
            working_directory: Path::new("/tmp/workspace"),
            granted_permissions: Some(&permissions),
        })
        .expect("seatbelt command");

        assert!(command[2].contains("(allow network-outbound)"));
        assert!(command[2].contains("(allow file-write*"));
        assert!(command.iter().any(|argument| {
            argument.starts_with("-DWRITABLE_ROOT_") && argument.ends_with("/tmp/shared-output")
        }));
    }

    #[test]
    fn bubblewrap_keeps_network_isolated_until_explicitly_granted() {
        let root = tempfile::tempdir().expect("sandbox root");
        let writable = root.path().join("shared-output");
        std::fs::create_dir(&writable).expect("writable directory");
        let permissions = GrantedPermissionProfile {
            network: Some(AdditionalNetworkPermissions {
                enabled: Some(true),
            }),
            file_system: Some(AdditionalFileSystemPermissions {
                read: None,
                write: Some(vec![writable.to_string_lossy().into_owned()]),
                glob_scan_max_depth: None,
                entries: None,
            }),
        };
        let granted = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::LinuxSandbox,
            policy: &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            command: vec!["pwd".to_string()],
            working_directory: root.path(),
            granted_permissions: Some(&permissions),
        })
        .expect("granted bubblewrap command");
        assert!(!granted.iter().any(|argument| argument == "--unshare-net"));
        let writable = std::fs::canonicalize(&writable).expect("canonical writable");
        let writable = writable.to_string_lossy();
        assert!(granted.windows(3).any(|arguments| {
            arguments[0] == "--bind"
                && arguments[1] == writable.as_ref()
                && arguments[2] == writable.as_ref()
        }));

        let isolated = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::LinuxSandbox,
            policy: &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            command: vec!["pwd".to_string()],
            working_directory: root.path(),
            granted_permissions: None,
        })
        .expect("isolated bubblewrap command");
        assert!(isolated.iter().any(|argument| argument == "--unshare-net"));
    }

    #[test]
    fn bubblewrap_memory_scope_has_no_implicit_temporary_write_bind() {
        let memory = tempfile::tempdir().unwrap();
        let extra = tempfile::tempdir().unwrap();
        let policy = SandboxPolicy::WorkspaceWrite {
            writable_roots: vec![extra.path().to_path_buf().try_into().unwrap()],
            network_access: false,
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
        };
        let command = prepare_sandbox_command(SandboxCommandRequest {
            backend: SandboxBackend::LinuxSandbox,
            policy: &policy,
            command: vec!["pwd".to_string()],
            working_directory: memory.path(),
            granted_permissions: None,
        })
        .unwrap();
        let mut binds = command
            .windows(3)
            .filter(|args| args[0] == "--bind")
            .map(|args| PathBuf::from(&args[1]))
            .collect::<Vec<_>>();
        binds.sort();
        let mut expected = vec![
            std::fs::canonicalize(memory.path()).unwrap(),
            std::fs::canonicalize(extra.path()).unwrap(),
        ];
        expected.sort();
        assert_eq!(binds, expected);
        assert!(command.iter().any(|arg| arg == "--unshare-net"));
    }
}
