//! Windows restricted-token ACL plan.
//!
//! This module only computes paths; the Windows-only ACL application lives in
//! `windows_acl`. Keeping the plan free of Windows API calls lets the same
//! enforcement policy be exercised on any host.

use crate::sandbox::domain_file_system_policy;
use app_server_protocol::protocol::v2::FileSystemAccessMode;
use app_server_protocol::protocol::v2::FileSystemPath;
use app_server_protocol::protocol::v2::FileSystemSpecialPath;
use app_server_protocol::protocol::v2::GrantedPermissionProfile;
use app_server_protocol::protocol::v2::SandboxPolicy;
use lime_permissions::FileSystemPolicyProjection;
use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::path::PathBuf;

#[derive(Debug, Default)]
pub(super) struct AclPlan {
    pub(super) read_grants: Vec<PathBuf>,
    pub(super) write_grants: Vec<PathBuf>,
    pub(super) write_denies: Vec<PathBuf>,
    pub(super) access_denies: Vec<PathBuf>,
}

pub(super) fn build_acl_plan(
    cwd: &Path,
    policy: &SandboxPolicy,
    permissions: Option<&GrantedPermissionProfile>,
    environment: &HashMap<String, String>,
) -> io::Result<AclPlan> {
    let file_system = domain_file_system_policy(policy, None, cwd)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
    let resolved = file_system
        .resolve_for_enforcement(cwd, FileSystemPolicyProjection::PreserveMutableRoots)
        .map_err(|error| io::Error::new(error.kind(), error.to_string()))?;

    let mut read_grants = vec![canonical_existing(cwd)?];
    let mut write_grants = Vec::new();
    let mut write_denies = Vec::new();
    let mut access_denies = Vec::new();

    for root in &resolved.writable_roots {
        write_grants.push(canonical_absolute(root.root.as_path())?);
        for subpath in &root.read_only_subpaths {
            if subpath.as_path().exists() {
                write_denies.push(canonical_existing(subpath.as_path())?);
            }
        }
    }
    for path in &resolved.unreadable_roots {
        access_denies.push(canonical_absolute(path.as_path())?);
    }
    if let SandboxPolicy::WorkspaceWrite {
        exclude_tmpdir_env_var,
        ..
    } = policy
    {
        if !exclude_tmpdir_env_var {
            write_grants.extend(windows_temp_write_roots(environment)?);
        }
    }

    if let Some(file_system) = permissions.and_then(|profile| profile.file_system.as_ref()) {
        for path in file_system.write.as_deref().unwrap_or_default() {
            write_grants.push(canonical_absolute(Path::new(path))?);
        }
        for entry in file_system.entries.as_deref().unwrap_or_default() {
            let path = resolve_permission_path(&entry.path, cwd)?;
            let Some(path) = path else {
                continue;
            };
            match entry.access {
                FileSystemAccessMode::Read => {
                    read_grants.push(path.clone());
                    write_denies.push(path);
                }
                FileSystemAccessMode::Write => write_grants.push(path),
                FileSystemAccessMode::Deny => access_denies.push(path),
            }
        }
    }

    read_grants.sort();
    read_grants.dedup();
    write_grants.sort();
    write_grants.dedup();
    access_denies.sort();
    access_denies.dedup();
    write_grants.retain(|path| access_denies.binary_search(path).is_err());
    read_grants.retain(|path| write_grants.binary_search(path).is_err());
    read_grants.retain(|path| access_denies.binary_search(path).is_err());
    write_denies.sort();
    write_denies.dedup();
    write_denies.retain(|path| access_denies.binary_search(path).is_err());
    Ok(AclPlan {
        read_grants,
        write_grants,
        write_denies,
        access_denies,
    })
}

fn windows_temp_write_roots(environment: &HashMap<String, String>) -> io::Result<Vec<PathBuf>> {
    ["TEMP", "TMP"]
        .into_iter()
        .filter_map(|key| {
            environment
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(key))
                .map(|(_, value)| PathBuf::from(value.as_str()))
        })
        .filter(|path| path.is_absolute())
        .map(|path| canonical_existing(&path))
        .collect()
}

fn resolve_permission_path(path: &FileSystemPath, cwd: &Path) -> io::Result<Option<PathBuf>> {
    match path {
        FileSystemPath::Path { path } => canonical_absolute(Path::new(path)).map(Some),
        FileSystemPath::GlobPattern { .. } => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Windows restricted token sandbox does not support glob filesystem permissions",
        )),
        FileSystemPath::Special { value } => match value {
            FileSystemSpecialPath::ProjectRoots { subpath } => {
                let path = subpath
                    .as_deref()
                    .map(|subpath| cwd.join(subpath))
                    .unwrap_or_else(|| cwd.to_path_buf());
                canonical_existing(&path).map(Some)
            }
            FileSystemSpecialPath::Tmpdir => canonical_existing(&std::env::temp_dir()).map(Some),
            FileSystemSpecialPath::Unknown { path, subpath } => {
                let base = PathBuf::from(path);
                if !base.is_absolute() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "Windows sandbox permission path must be absolute",
                    ));
                }
                let path = subpath
                    .as_deref()
                    .map(|subpath| base.join(subpath))
                    .unwrap_or(base);
                canonical_existing(&path).map(Some)
            }
            FileSystemSpecialPath::Root | FileSystemSpecialPath::SlashTmp => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Unix filesystem special path is unsupported by the Windows sandbox",
            )),
            FileSystemSpecialPath::Minimal => Ok(None),
        },
    }
}

fn canonical_absolute(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Windows sandbox permission path must be absolute: {}",
                path.display()
            ),
        ));
    }
    canonical_existing(path)
}

fn canonical_existing(path: &Path) -> io::Result<PathBuf> {
    reject_reparse_components(path)?;
    std::fs::canonicalize(path).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "Windows sandbox path is invalid ({}): {error}",
                path.display()
            ),
        )
    })
}

pub(super) fn reject_reparse_components(path: &Path) -> io::Result<()> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let metadata = std::fs::symlink_metadata(ancestor).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "Windows sandbox cannot inspect path component {}: {error}",
                    ancestor.display()
                ),
            )
        })?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::MetadataExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
            if metadata.file_type().is_symlink()
                || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "Windows sandbox refuses reparse point component: {}",
                        ancestor.display()
                    ),
                ));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if metadata.file_type().is_symlink() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "Windows sandbox refuses reparse point component: {}",
                        ancestor.display()
                    ),
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_policy() -> SandboxPolicy {
        SandboxPolicy::WorkspaceWrite {
            writable_roots: Vec::new(),
            network_access: false,
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
        }
    }

    #[test]
    fn workspace_write_grants_workspace_and_denies_protected_metadata() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = temp.path().canonicalize().expect("canonical temp dir");
        let workspace = base.join("workspace");
        std::fs::create_dir_all(workspace.join(".git")).expect("create .git");
        std::fs::create_dir_all(workspace.join(".lime")).expect("create .lime");
        std::fs::write(workspace.join("file.txt"), "x").expect("write file");

        let environment = HashMap::new();
        let plan =
            build_acl_plan(&workspace, &workspace_policy(), None, &environment).expect("acl plan");

        assert!(plan
            .write_grants
            .contains(&std::fs::canonicalize(&workspace).unwrap()));
        assert!(plan
            .write_denies
            .contains(&std::fs::canonicalize(workspace.join(".git")).unwrap()));
        assert!(plan
            .write_denies
            .contains(&std::fs::canonicalize(workspace.join(".lime")).unwrap()));
        assert!(!plan
            .write_denies
            .contains(&std::fs::canonicalize(workspace.join("file.txt")).unwrap()));
    }

    #[test]
    fn read_only_policy_grants_no_writes() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = temp.path().canonicalize().expect("canonical temp dir");
        let workspace = base.join("workspace");
        std::fs::create_dir_all(&workspace).expect("create workspace");

        let policy = SandboxPolicy::ReadOnly {
            network_access: false,
        };
        let plan = build_acl_plan(&workspace, &policy, None, &HashMap::new()).expect("acl plan");

        assert!(plan.write_grants.is_empty());
        assert!(plan
            .read_grants
            .contains(&std::fs::canonicalize(&workspace).unwrap()));
    }

    #[test]
    fn temp_write_roots_follow_the_env_and_exclude_flag() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = temp.path().canonicalize().expect("canonical temp dir");
        let workspace = base.join("workspace");
        let env_temp = base.join("env-temp");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        std::fs::create_dir_all(workspace.join(".git")).expect("create .git");
        std::fs::create_dir_all(workspace.join(".lime")).expect("create .lime");
        std::fs::create_dir_all(workspace.join(".agents")).expect("create .agents");
        std::fs::create_dir_all(&env_temp).expect("create env temp");

        let environment = HashMap::from([(
            "TEMP".to_string(),
            env_temp.to_string_lossy().into_owned(),
        )]);
        let included = build_acl_plan(
            &workspace,
            &SandboxPolicy::WorkspaceWrite {
                writable_roots: Vec::new(),
                network_access: false,
                exclude_tmpdir_env_var: false,
                exclude_slash_tmp: true,
            },
            None,
            &environment,
        )
        .expect("acl plan");
        assert!(included
            .write_grants
            .contains(&std::fs::canonicalize(&env_temp).unwrap()));

        let excluded = build_acl_plan(
            &workspace,
            &workspace_policy(),
            None,
            &environment,
        )
        .expect("acl plan");
        assert!(!excluded
            .write_grants
            .contains(&std::fs::canonicalize(&env_temp).unwrap()));
    }

    #[test]
    fn deny_entries_become_access_denies() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = temp.path().canonicalize().expect("canonical temp dir");
        let workspace = base.join("workspace");
        let denied = base.join("denied");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        std::fs::create_dir_all(workspace.join(".git")).expect("create .git");
        std::fs::create_dir_all(workspace.join(".lime")).expect("create .lime");
        std::fs::create_dir_all(workspace.join(".agents")).expect("create .agents");
        std::fs::create_dir_all(&denied).expect("create denied");

        let permissions = GrantedPermissionProfile {
            network: None,
            file_system: Some(
                serde_json::from_value(serde_json::json!({
                    "entries": [{
                        "path": {"type": "path", "path": denied.to_string_lossy()},
                        "access": "deny"
                    }]
                }))
                .expect("permissions"),
            ),
        };
        let plan = build_acl_plan(
            &workspace,
            &workspace_policy(),
            Some(&permissions),
            &HashMap::new(),
        )
        .expect("acl plan");

        assert!(plan
            .access_denies
            .contains(&std::fs::canonicalize(&denied).unwrap()));
    }
}
