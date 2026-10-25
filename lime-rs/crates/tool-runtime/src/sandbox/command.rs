use super::{policy, SandboxBackend};
use app_server_protocol::protocol::v2::{
    AdditionalFileSystemPermissions, FileSystemAccessMode, FileSystemPath, FileSystemSpecialPath,
    GrantedPermissionProfile, SandboxPolicy,
};
use std::fmt;
use std::path::{Path, PathBuf};

const MACOS_SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";
const PROTECTED_METADATA_NAMES: [&str; 3] = [".git", ".lime", ".agents"];

const SEATBELT_BASE_POLICY: &str = r#"
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow file-read*)
(allow file-map-executable)
(allow file-write-data (literal "/dev/null"))
(allow file-read* file-write* (literal "/dev/null"))
(allow file-read* file-write* (subpath "/dev/fd"))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-sem)
(allow ipc-posix-shm-read*)
(allow ipc-posix-shm-write-create)
(allow ipc-posix-shm-write-data)
(allow ipc-posix-shm-write-unlink)
(allow user-preference-read)
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write* file-ioctl (regex #"^/dev/ttys[0-9]+"))
(allow network-outbound (literal "/private/var/run/syslog"))
"#;

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
        SandboxBackend::Seatbelt => Ok(prepare_seatbelt_command(
            request.command,
            request.working_directory,
            request.policy,
            request.granted_permissions,
        )),
        SandboxBackend::LinuxSandbox => Ok(prepare_bubblewrap_command(
            request.command,
            request.working_directory,
            request.policy,
            request.granted_permissions,
        )),
        SandboxBackend::None | SandboxBackend::RestrictedToken => {
            Err(SandboxCommandError::UnsupportedBackend(request.backend))
        }
    }
}

fn prepare_seatbelt_command(
    command: Vec<String>,
    working_directory: &Path,
    policy: &SandboxPolicy,
    granted_permissions: Option<&GrantedPermissionProfile>,
) -> Vec<String> {
    let mut profile = SEATBELT_BASE_POLICY.to_string();
    let mut parameters = Vec::new();
    for (index, root) in policy::writable_roots(policy, working_directory)
        .iter()
        .enumerate()
    {
        profile.push_str(&format!(
            "\n(allow file-write* (subpath (param \"WRITABLE_ROOT_{index}\")))\n"
        ));
        parameters.push(format!(
            "-DWRITABLE_ROOT_{index}={}",
            root.to_string_lossy()
        ));
        for name in PROTECTED_METADATA_NAMES {
            profile.push_str(&format!(
                "(deny file-write* (subpath (param \"PROTECTED_{index}_{name}\")))\n"
            ));
            parameters.push(format!(
                "-DPROTECTED_{index}_{name}={}",
                root.join(name).to_string_lossy()
            ));
        }
    }
    if policy::allows_network(policy) {
        profile.push_str("\n(allow network*)\n");
    }
    if let Some(permissions) = granted_permissions {
        append_seatbelt_permissions(&mut profile, permissions, working_directory);
    }

    let mut wrapped = vec![MACOS_SANDBOX_EXEC.to_string(), "-p".to_string(), profile];
    wrapped.extend(parameters);
    wrapped.push("--".to_string());
    wrapped.extend(command);
    wrapped
}

fn prepare_bubblewrap_command(
    command: Vec<String>,
    working_directory: &Path,
    policy: &SandboxPolicy,
    granted_permissions: Option<&GrantedPermissionProfile>,
) -> Vec<String> {
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
    if !policy::allows_network(policy)
        && !granted_permissions
            .and_then(|permissions| permissions.network.as_ref())
            .and_then(|network| network.enabled)
            .unwrap_or(false)
    {
        wrapped.insert(7, "--unshare-net".to_string());
    }
    for root in policy::writable_roots(policy, working_directory) {
        let path = root.to_string_lossy().into_owned();
        wrapped.extend(["--bind".to_string(), path.clone(), path]);
        for name in PROTECTED_METADATA_NAMES {
            let path = root.join(name);
            if path.exists() {
                let path = path.to_string_lossy().to_string();
                wrapped.extend(["--ro-bind".to_string(), path.clone(), path]);
            }
        }
    }
    if let Some(file_system) = granted_permissions.and_then(|value| value.file_system.as_ref()) {
        append_bubblewrap_permissions(&mut wrapped, file_system, working_directory);
    }
    wrapped.extend(["--chdir".to_string(), cwd, "--".to_string()]);
    wrapped.extend(command);
    wrapped
}

fn append_seatbelt_permissions(
    profile: &mut String,
    permissions: &GrantedPermissionProfile,
    working_directory: &Path,
) {
    if permissions
        .network
        .as_ref()
        .and_then(|network| network.enabled)
        .unwrap_or(false)
    {
        profile.push_str("\n(allow network*)\n");
    }
    let Some(file_system) = permissions.file_system.as_ref() else {
        return;
    };
    for path in file_system.read.as_deref().unwrap_or_default() {
        append_seatbelt_path(profile, Path::new(path), FileSystemAccessMode::Read);
    }
    for path in file_system.write.as_deref().unwrap_or_default() {
        append_seatbelt_path(profile, Path::new(path), FileSystemAccessMode::Write);
    }
    for entry in file_system.entries.as_deref().unwrap_or_default() {
        match &entry.path {
            FileSystemPath::Path { path } => {
                append_seatbelt_path(profile, Path::new(path), entry.access)
            }
            FileSystemPath::GlobPattern { pattern } => {
                append_seatbelt_pattern(profile, pattern, entry.access)
            }
            FileSystemPath::Special { value } => {
                if let Some(path) = special_path(value, working_directory) {
                    append_seatbelt_path(profile, &path, entry.access);
                }
            }
        }
    }
}

fn append_seatbelt_path(profile: &mut String, path: &Path, access: FileSystemAccessMode) {
    let escaped = regex::escape(&path.to_string_lossy());
    append_seatbelt_regex(profile, &format!("^{escaped}(/.*)?$"), access);
}

fn append_seatbelt_pattern(profile: &mut String, pattern: &str, access: FileSystemAccessMode) {
    append_seatbelt_regex(profile, &glob_pattern_regex(pattern), access);
}

fn append_seatbelt_regex(profile: &mut String, pattern: &str, access: FileSystemAccessMode) {
    let operation = match access {
        FileSystemAccessMode::Read => "allow file-read*",
        FileSystemAccessMode::Write => "allow file-read* file-write*",
        FileSystemAccessMode::Deny => "deny file-read* file-write*",
    };
    profile.push_str(&format!("\n({operation} (regex #\"{pattern}\"))\n"));
}

fn glob_pattern_regex(pattern: &str) -> String {
    let mut regex = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                regex.push_str(".*");
            }
            '*' => regex.push_str("[^/]*"),
            '?' => regex.push_str("[^/]"),
            character => regex.push_str(&regex::escape(&character.to_string())),
        }
    }
    regex.push('$');
    regex
}

fn append_bubblewrap_permissions(
    wrapped: &mut Vec<String>,
    file_system: &AdditionalFileSystemPermissions,
    working_directory: &Path,
) {
    for path in file_system.read.as_deref().unwrap_or_default() {
        append_bubblewrap_path(wrapped, Path::new(path), false);
    }
    for path in file_system.write.as_deref().unwrap_or_default() {
        append_bubblewrap_path(wrapped, Path::new(path), true);
    }
    for entry in file_system.entries.as_deref().unwrap_or_default() {
        let path = match &entry.path {
            FileSystemPath::Path { path } => Some(PathBuf::from(path)),
            FileSystemPath::Special { value } => special_path(value, working_directory),
            FileSystemPath::GlobPattern { .. } => None,
        };
        if let Some(path) = path {
            match entry.access {
                FileSystemAccessMode::Read => append_bubblewrap_path(wrapped, &path, false),
                FileSystemAccessMode::Write => append_bubblewrap_path(wrapped, &path, true),
                FileSystemAccessMode::Deny => {}
            }
        }
    }
}

fn append_bubblewrap_path(wrapped: &mut Vec<String>, path: &Path, writable: bool) {
    if !path.exists() {
        return;
    }
    let path = path.to_string_lossy().into_owned();
    wrapped.extend([
        if writable { "--bind" } else { "--ro-bind" }.to_string(),
        path.clone(),
        path,
    ]);
}

fn special_path(value: &FileSystemSpecialPath, working_directory: &Path) -> Option<PathBuf> {
    match value {
        FileSystemSpecialPath::Root => Some(PathBuf::from("/")),
        FileSystemSpecialPath::ProjectRoots { subpath } => Some(
            subpath
                .as_deref()
                .map(|subpath| working_directory.join(subpath))
                .unwrap_or_else(|| working_directory.to_path_buf()),
        ),
        FileSystemSpecialPath::Tmpdir => Some(std::env::temp_dir()),
        FileSystemSpecialPath::SlashTmp => Some(PathBuf::from("/tmp")),
        FileSystemSpecialPath::Unknown { path, subpath } => {
            let path = PathBuf::from(path);
            path.is_absolute().then(|| {
                subpath
                    .as_deref()
                    .map(|subpath| path.join(subpath))
                    .unwrap_or(path)
            })
        }
        FileSystemSpecialPath::Minimal => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::AdditionalNetworkPermissions;

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
        assert!(command[2].contains("(allow file-write* (subpath (param \"WRITABLE_ROOT_"));
        let protected = format!(
            "={}",
            std::fs::canonicalize(workspace.path())
                .unwrap()
                .join(".git")
                .display()
        );
        assert!(command
            .iter()
            .any(|argument| argument.ends_with(&protected)));
        let delimiter = command
            .iter()
            .position(|argument| argument == "--")
            .unwrap();
        assert_eq!(&command[delimiter + 1..], ["sh", "-c", "pwd"]);
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

        assert!(command[2].contains("(allow network*)"));
        assert!(command[2].contains("allow file-read* file-write*"));
        assert!(command[2].contains("^/tmp/shared\\-output(/.*)?$"));
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
        let binds = command
            .windows(3)
            .filter(|args| args[0] == "--bind")
            .map(|args| PathBuf::from(&args[1]))
            .collect::<Vec<_>>();
        let mut expected = vec![
            std::fs::canonicalize(memory.path()).unwrap(),
            std::fs::canonicalize(extra.path()).unwrap(),
        ];
        expected.sort();
        assert_eq!(binds, expected);
        assert!(command.iter().any(|arg| arg == "--unshare-net"));
    }
}
