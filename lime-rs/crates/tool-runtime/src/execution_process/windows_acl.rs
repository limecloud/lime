use super::windows_acl_plan::build_acl_plan;
#[cfg(test)]
use super::windows_acl_plan::reject_reparse_components;
use super::windows_acl_plan::AclPlan;
use super::*;
#[cfg(test)]
use app_server_protocol::protocol::v2::{
    AdditionalFileSystemPermissions, FileSystemAccessMode, FileSystemPath, FileSystemSandboxEntry,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS, EXPLICIT_ACCESS_W,
    SET_ACCESS, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    GetFileSecurityW, GetSecurityDescriptorControl, SetFileSecurityW, DACL_SECURITY_INFORMATION,
    PROTECTED_DACL_SECURITY_INFORMATION, SE_DACL_PROTECTED, UNPROTECTED_DACL_SECURITY_INFORMATION,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ALL_ACCESS, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE,
};

#[derive(Debug)]
pub(super) struct AclLease {
    paths: Vec<PathBuf>,
}

#[derive(Debug)]
struct DaclSnapshot {
    path: PathBuf,
    descriptor: Vec<u8>,
    protected: bool,
}

#[derive(Debug)]
struct SharedAclState {
    snapshot: DaclSnapshot,
    leases: usize,
}

fn acl_registry() -> &'static Mutex<HashMap<PathBuf, SharedAclState>> {
    static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, SharedAclState>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

impl AclLease {
    pub(super) fn acquire(
        sandbox_group_sid: &str,
        capability_sid: &str,
        plan: AclPlan,
    ) -> io::Result<Self> {
        let mut paths = plan
            .read_grants
            .iter()
            .chain(&plan.write_grants)
            .chain(&plan.write_denies)
            .chain(&plan.access_denies)
            .cloned()
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        let mut lease = Self { paths: Vec::new() };
        if let Err(error) = lease.reserve(&paths) {
            return Err(lease.rollback_after(error));
        }
        if let Err(error) = lease.apply(sandbox_group_sid, capability_sid, plan) {
            return Err(lease.rollback_after(error));
        }
        Ok(lease)
    }

    fn apply(
        &self,
        sandbox_group_sid: &str,
        capability_sid: &str,
        plan: AclPlan,
    ) -> io::Result<()> {
        // Serialize read-modify-write DACL updates with final snapshot restore.
        let _registry = acl_registry()
            .lock()
            .map_err(|_| io::Error::other("Windows sandbox ACL registry lock is poisoned"))?;
        for path in plan.read_grants {
            grant_access(
                &path,
                sandbox_group_sid,
                capability_sid,
                FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
            )?;
        }
        for path in plan.write_grants {
            grant_access(
                &path,
                sandbox_group_sid,
                capability_sid,
                FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE,
            )?;
        }
        for path in plan.write_denies {
            deny_write_access(&path, capability_sid)?;
        }
        for path in plan.access_denies {
            deny_access(&path, sandbox_group_sid, capability_sid)?;
        }
        Ok(())
    }

    fn reserve(&mut self, paths: &[PathBuf]) -> io::Result<()> {
        let mut registry = acl_registry()
            .lock()
            .map_err(|_| io::Error::other("Windows sandbox ACL registry lock is poisoned"))?;
        for path in paths {
            if let Some(state) = registry.get_mut(path) {
                state.leases = state.leases.checked_add(1).ok_or_else(|| {
                    io::Error::other(format!(
                        "Windows sandbox ACL lease count overflow for {}",
                        path.display()
                    ))
                })?;
            } else {
                registry.insert(
                    path.clone(),
                    SharedAclState {
                        snapshot: DaclSnapshot::capture(path)?,
                        leases: 1,
                    },
                );
            }
            self.paths.push(path.clone());
        }
        Ok(())
    }

    fn rollback_after(&mut self, error: io::Error) -> io::Error {
        match self.rollback() {
            Ok(()) => error,
            Err(rollback_error) => io::Error::other(format!(
                "{error}; Windows sandbox ACL rollback also failed: {rollback_error}"
            )),
        }
    }

    fn rollback(&mut self) -> io::Result<()> {
        let mut failures = Vec::new();
        let mut registry = acl_registry()
            .lock()
            .map_err(|_| io::Error::other("Windows sandbox ACL registry lock is poisoned"))?;
        for path in self.paths.iter().rev() {
            let should_restore = match registry.get_mut(path) {
                Some(state) if state.leases > 0 => {
                    state.leases -= 1;
                    state.leases == 0
                }
                Some(_) => {
                    failures.push(format!(
                        "{}: ACL lease count is already zero",
                        path.display()
                    ));
                    false
                }
                None => {
                    failures.push(format!(
                        "{}: ACL lease registry entry is missing",
                        path.display()
                    ));
                    false
                }
            };
            if !should_restore {
                continue;
            }
            let restore_result = registry
                .get(path)
                .expect("ACL registry entry checked above")
                .snapshot
                .restore();
            match restore_result {
                Ok(()) => {
                    registry.remove(path);
                }
                Err(error) => failures.push(format!("{}: {error}", path.display())),
            }
        }
        self.paths.clear();
        if failures.is_empty() {
            Ok(())
        } else {
            Err(io::Error::other(failures.join("; ")))
        }
    }
}

impl Drop for AclLease {
    fn drop(&mut self) {
        if let Err(error) = self.rollback() {
            tracing::warn!(%error, "failed to restore Windows sandbox ACL lease");
        }
    }
}

impl DaclSnapshot {
    fn capture(path: &Path) -> io::Result<Self> {
        let path_w = to_wide(path.as_os_str());
        let mut needed = 0;
        let first = unsafe {
            GetFileSecurityW(
                path_w.as_ptr(),
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                0,
                &mut needed,
            )
        };
        if first != 0 || unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER || needed == 0 {
            return Err(last_os_error("GetFileSecurityW size"));
        }
        let mut descriptor = vec![0u8; needed as usize];
        if unsafe {
            GetFileSecurityW(
                path_w.as_ptr(),
                DACL_SECURITY_INFORMATION,
                descriptor.as_mut_ptr() as *mut c_void,
                needed,
                &mut needed,
            )
        } == 0
        {
            return Err(last_os_error("GetFileSecurityW"));
        }
        descriptor.truncate(needed as usize);
        let mut control = 0;
        let mut revision = 0;
        if unsafe {
            GetSecurityDescriptorControl(
                descriptor.as_mut_ptr() as *mut c_void,
                &mut control,
                &mut revision,
            )
        } == 0
        {
            return Err(last_os_error("GetSecurityDescriptorControl"));
        }
        Ok(Self {
            path: path.to_path_buf(),
            descriptor,
            protected: control & SE_DACL_PROTECTED != 0,
        })
    }

    fn restore(&self) -> io::Result<()> {
        let path_w = to_wide(self.path.as_os_str());
        let inheritance = if self.protected {
            PROTECTED_DACL_SECURITY_INFORMATION
        } else {
            UNPROTECTED_DACL_SECURITY_INFORMATION
        };
        if unsafe {
            SetFileSecurityW(
                path_w.as_ptr(),
                DACL_SECURITY_INFORMATION | inheritance,
                self.descriptor.as_ptr() as *mut c_void,
            )
        } == 0
        {
            Err(last_os_error("SetFileSecurityW"))
        } else {
            Ok(())
        }
    }
}

fn grant_access(
    path: &Path,
    sandbox_group_sid: &str,
    capability_sid: &str,
    permissions: u32,
) -> io::Result<()> {
    let group_sid = LocalSid::parse(sandbox_group_sid)?;
    let capability_sid = LocalSid::parse(capability_sid)?;
    set_acl_entries(
        path,
        &[
            explicit_access(group_sid.raw(), permissions, SET_ACCESS),
            explicit_access(capability_sid.raw(), permissions, SET_ACCESS),
        ],
    )
}

fn deny_access(path: &Path, sandbox_group_sid: &str, capability_sid: &str) -> io::Result<()> {
    let group_sid = LocalSid::parse(sandbox_group_sid)?;
    let capability_sid = LocalSid::parse(capability_sid)?;
    set_acl_entries(
        path,
        &[
            explicit_access(group_sid.raw(), FILE_ALL_ACCESS, DENY_ACCESS),
            explicit_access(capability_sid.raw(), FILE_ALL_ACCESS, DENY_ACCESS),
        ],
    )
}

fn deny_write_access(path: &Path, capability_sid: &str) -> io::Result<()> {
    let capability_sid = LocalSid::parse(capability_sid)?;
    set_acl_entries(
        path,
        &[explicit_access(
            capability_sid.raw(),
            FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD,
            DENY_ACCESS,
        )],
    )
}

fn explicit_access(sid: *mut c_void, permissions: u32, mode: i32) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: permissions,
        grfAccessMode: mode,
        grfInheritance: 0x3, // CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid as *mut u16,
        },
    }
}

fn set_acl_entries(path: &Path, entries: &[EXPLICIT_ACCESS_W]) -> io::Result<()> {
    let path_w = to_wide(path.as_os_str());
    let mut security_descriptor = ptr::null_mut();
    let mut dacl = ptr::null_mut();
    let result = unsafe {
        GetNamedSecurityInfoW(
            path_w.as_ptr(),
            1, // SE_FILE_OBJECT
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut security_descriptor,
        )
    };
    if result != ERROR_SUCCESS {
        return Err(io::Error::other(format!(
            "GetNamedSecurityInfoW failed for {}: {result}",
            path.display()
        )));
    }

    let mut new_dacl = ptr::null_mut();
    let result =
        unsafe { SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), dacl, &mut new_dacl) };
    if result != ERROR_SUCCESS {
        unsafe {
            if !security_descriptor.is_null() {
                LocalFree(security_descriptor as HLOCAL);
            }
        }
        return Err(io::Error::other(format!(
            "SetEntriesInAclW failed for {}: {result}",
            path.display()
        )));
    }

    let result = unsafe {
        SetNamedSecurityInfoW(
            path_w.as_ptr() as *mut u16,
            1, // SE_FILE_OBJECT
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            new_dacl,
            ptr::null_mut(),
        )
    };
    unsafe {
        if !new_dacl.is_null() {
            LocalFree(new_dacl as HLOCAL);
        }
        if !security_descriptor.is_null() {
            LocalFree(security_descriptor as HLOCAL);
        }
    }
    if result != ERROR_SUCCESS {
        return Err(io::Error::other(format!(
            "SetNamedSecurityInfoW failed for {}: {result}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_acl_plan_grants_workspace_and_denies_metadata() {
        let root = tempfile::tempdir().expect("workspace");
        std::fs::create_dir(root.path().join(".git")).expect("git metadata");
        let plan = build_acl_plan(
            root.path(),
            &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            None,
            &HashMap::new(),
        )
        .expect("ACL plan");

        assert_eq!(
            plan.write_grants,
            vec![std::fs::canonicalize(root.path()).unwrap()]
        );
        assert!(plan.read_grants.is_empty());
        assert_eq!(
            plan.write_denies,
            vec![std::fs::canonicalize(root.path().join(".git")).unwrap()]
        );
        assert!(plan.access_denies.is_empty());
    }

    #[test]
    fn read_only_acl_plan_grants_workspace_read_access() {
        let root = tempfile::tempdir().expect("workspace");
        let plan = build_acl_plan(
            root.path(),
            &SandboxPolicy::ReadOnly {
                network_access: false,
            },
            None,
            &HashMap::new(),
        )
        .expect("ACL plan");

        assert_eq!(
            plan.read_grants,
            vec![std::fs::canonicalize(root.path()).unwrap()]
        );
        assert!(plan.write_grants.is_empty());
        assert!(plan.write_denies.is_empty());
        assert!(plan.access_denies.is_empty());
    }

    #[test]
    fn explicit_read_and_deny_entries_create_distinct_carveouts() {
        let root = tempfile::tempdir().expect("workspace");
        let read_only = root.path().join("read-only");
        let denied = root.path().join("denied");
        std::fs::create_dir(&read_only).expect("read-only path");
        std::fs::create_dir(&denied).expect("denied path");
        let permissions = GrantedPermissionProfile {
            network: None,
            file_system: Some(AdditionalFileSystemPermissions {
                read: None,
                write: None,
                glob_scan_max_depth: None,
                entries: Some(vec![
                    FileSystemSandboxEntry {
                        path: FileSystemPath::Path {
                            path: read_only.to_string_lossy().to_string(),
                        },
                        access: FileSystemAccessMode::Read,
                    },
                    FileSystemSandboxEntry {
                        path: FileSystemPath::Path {
                            path: denied.to_string_lossy().to_string(),
                        },
                        access: FileSystemAccessMode::Deny,
                    },
                ]),
            }),
        };
        let plan = build_acl_plan(
            root.path(),
            &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            Some(&permissions),
            &HashMap::new(),
        )
        .expect("ACL plan");

        assert!(plan
            .read_grants
            .contains(&std::fs::canonicalize(&read_only).unwrap()));
        assert!(plan
            .write_denies
            .contains(&std::fs::canonicalize(&read_only).unwrap()));
        assert!(plan
            .access_denies
            .contains(&std::fs::canonicalize(&denied).unwrap()));
    }

    #[test]
    fn ordinary_existing_paths_are_not_reparse_points() {
        let root = tempfile::tempdir().expect("workspace");
        reject_reparse_components(root.path()).expect("ordinary path should be accepted");
    }

    #[test]
    fn workspace_acl_plan_keeps_nested_workspace_and_windows_temp_roots() {
        let root = tempfile::tempdir().expect("fixture root");
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).expect("workspace directory");
        let environment = HashMap::from([
            (
                "Temp".to_string(),
                root.path().to_string_lossy().into_owned(),
            ),
            (
                "TMP".to_string(),
                root.path().to_string_lossy().into_owned(),
            ),
        ]);

        let plan = build_acl_plan(
            &workspace,
            &crate::sandbox::sandbox_policy_from_label(Some("workspace-write")).unwrap(),
            None,
            &environment,
        )
        .expect("ACL plan");

        assert_eq!(
            plan.write_grants,
            vec![
                std::fs::canonicalize(root.path()).unwrap(),
                std::fs::canonicalize(&workspace).unwrap(),
            ]
        );
    }

    #[test]
    fn memory_acl_policy_excludes_parent_temp_grants() {
        let root = tempfile::tempdir().unwrap();
        let memory = root.path().join("memory");
        let extra = root.path().join("extra");
        std::fs::create_dir(&memory).unwrap();
        std::fs::create_dir(&extra).unwrap();
        let policy = SandboxPolicy::WorkspaceWrite {
            writable_roots: vec![extra.clone().try_into().unwrap()],
            network_access: false,
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: true,
        };
        let environment = HashMap::from([(
            "TEMP".to_string(),
            root.path().to_string_lossy().into_owned(),
        )]);
        let plan = build_acl_plan(&memory, &policy, None, &environment).unwrap();
        let mut expected = vec![
            std::fs::canonicalize(memory).unwrap(),
            std::fs::canonicalize(extra).unwrap(),
        ];
        expected.sort();
        assert_eq!(plan.write_grants, expected);
    }
}
