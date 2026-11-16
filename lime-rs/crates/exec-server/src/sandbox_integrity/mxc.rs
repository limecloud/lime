//! Discover MXC dependencies separately from resolving configured policy rules.

use super::dependencies::Dependency;
use super::dependencies::lime_and_launcher_dependencies;
use ::protocol::permissions::FileSystemSandboxPolicy;
use lime_utils_absolute_path::AbsolutePathBuf;
use sandboxing::SandboxExecRequest;
use sandboxing::SandboxType;
use std::io;

pub(super) const SANDBOX_TYPE: SandboxType = SandboxType::WindowsMxc;
pub(super) const NAME: &str = "windows_mxc";

pub(super) fn critical_dependencies(
    request: &SandboxExecRequest,
    _policy: &FileSystemSandboxPolicy,
    _cwd: &AbsolutePathBuf,
) -> io::Result<Vec<Dependency>> {
    Ok(lime_and_launcher_dependencies(request))
}

pub(super) fn prepare_policy(
    request: &SandboxExecRequest,
    policy: FileSystemSandboxPolicy,
    cwd: &AbsolutePathBuf,
) -> io::Result<FileSystemSandboxPolicy> {
    let command_cwd = request.cwd.to_abs_path()?;
    mxc_sandbox::prepare_file_system_policy(policy, &request.env, cwd, command_cwd.as_path())
        .map_err(io::Error::other)
}
