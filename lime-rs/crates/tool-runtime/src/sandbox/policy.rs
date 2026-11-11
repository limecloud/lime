use super::{parse_requested_sandbox_policy, RequestedSandboxPolicy, SandboxCommandError};
use app_server_protocol::protocol::v2::{
    AdditionalNetworkPermissions, GrantedPermissionProfile, NetworkAccess, SandboxPolicy,
};
use std::path::{Path, PathBuf};

/// Convert the existing turn configuration at its process boundary; command/exec uses typed wire.
pub fn sandbox_policy_from_label(
    value: Option<&str>,
) -> Result<SandboxPolicy, SandboxCommandError> {
    match value
        .map(|value| {
            parse_requested_sandbox_policy(Some(value))
                .ok_or_else(|| SandboxCommandError::UnsupportedPolicy(value.to_string()))
        })
        .transpose()?
        .unwrap_or(RequestedSandboxPolicy::WorkspaceWrite)
    {
        RequestedSandboxPolicy::ReadOnly => Ok(SandboxPolicy::ReadOnly {
            network_access: false,
        }),
        RequestedSandboxPolicy::WorkspaceWrite => Ok(SandboxPolicy::WorkspaceWrite {
            writable_roots: Vec::new(),
            network_access: false,
            exclude_tmpdir_env_var: false,
            exclude_slash_tmp: false,
        }),
        RequestedSandboxPolicy::DangerFullAccess => Ok(SandboxPolicy::DangerFullAccess),
    }
}

pub fn sandbox_policy_label(policy: &SandboxPolicy) -> &'static str {
    match policy {
        SandboxPolicy::ReadOnly { .. } => "read-only",
        SandboxPolicy::WorkspaceWrite { .. } => "workspace-write",
        SandboxPolicy::DangerFullAccess => "danger-full-access",
        SandboxPolicy::ExternalSandbox { .. } => "external-sandbox",
    }
}

pub(crate) fn allows_network(policy: &SandboxPolicy) -> bool {
    match policy {
        SandboxPolicy::ReadOnly { network_access }
        | SandboxPolicy::WorkspaceWrite { network_access, .. } => *network_access,
        SandboxPolicy::DangerFullAccess => true,
        SandboxPolicy::ExternalSandbox { network_access } => {
            *network_access == NetworkAccess::Enabled
        }
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn writable_roots(policy: &SandboxPolicy, cwd: &Path) -> Vec<PathBuf> {
    writable_roots_with_tmpdir(policy, cwd, std::env::var_os("TMPDIR").map(PathBuf::from))
}

pub(crate) fn effective_permissions(
    policy: &SandboxPolicy,
    permissions: Option<GrantedPermissionProfile>,
) -> Option<GrantedPermissionProfile> {
    let mut permissions = permissions;
    if allows_network(policy) {
        permissions.get_or_insert_with(Default::default).network =
            Some(AdditionalNetworkPermissions {
                enabled: Some(true),
            });
    }
    permissions
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn writable_roots_with_tmpdir(
    policy: &SandboxPolicy,
    cwd: &Path,
    tmpdir: Option<PathBuf>,
) -> Vec<PathBuf> {
    let SandboxPolicy::WorkspaceWrite {
        writable_roots,
        exclude_tmpdir_env_var,
        exclude_slash_tmp,
        ..
    } = policy
    else {
        return Vec::new();
    };
    let mut roots = writable_roots
        .iter()
        .map(|root| root.as_ref().to_path_buf())
        .collect::<Vec<_>>();
    roots.push(cwd.to_path_buf());
    if cfg!(unix) && !exclude_slash_tmp && Path::new("/tmp").is_dir() {
        roots.push(PathBuf::from("/tmp"));
    }
    if !exclude_tmpdir_env_var {
        if let Some(tmpdir) = tmpdir.filter(|path| path.is_absolute()) {
            roots.push(tmpdir);
        }
    }
    for root in &mut roots {
        if let Ok(canonical) = std::fs::canonicalize(&root) {
            *root = canonical;
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exclusions_remove_only_implicit_roots() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().join("memory");
        let extra = root.path().join("explicit");
        let tmp = root.path().join("tmp");
        let policy = SandboxPolicy::WorkspaceWrite {
            writable_roots: vec![extra.clone().try_into().unwrap()],
            network_access: false,
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
        };
        let mut expected = vec![cwd.clone(), extra];
        expected.sort();
        assert_eq!(
            writable_roots_with_tmpdir(&policy, &cwd, Some(tmp)),
            expected
        );
        assert!(writable_roots_with_tmpdir(
            &SandboxPolicy::ReadOnly {
                network_access: false
            },
            &cwd,
            Some(root.path().to_path_buf())
        )
        .is_empty());
    }

    #[test]
    fn tmpdir_can_be_excluded_independently_of_slash_tmp() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().join("workspace");
        let tmp = root.path().join("tmpdir");
        let mut policy = sandbox_policy_from_label(Some("workspace-write")).unwrap();
        let roots = writable_roots_with_tmpdir(&policy, &cwd, Some(tmp.clone()));
        assert!(roots.contains(&tmp));
        if let SandboxPolicy::WorkspaceWrite {
            exclude_tmpdir_env_var,
            ..
        } = &mut policy
        {
            *exclude_tmpdir_env_var = true;
        }
        let roots = writable_roots_with_tmpdir(&policy, &cwd, Some(tmp.clone()));
        assert!(!roots.contains(&tmp));
        if cfg!(unix) && Path::new("/tmp").is_dir() {
            assert!(roots.contains(&std::fs::canonicalize("/tmp").unwrap()));
        }
        assert!(sandbox_policy_from_label(Some("unknown")).is_err());
    }
}
