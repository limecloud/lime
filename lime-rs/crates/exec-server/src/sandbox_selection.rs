//! Translates Windows sandbox selection and validates explicit remote MXC requests.

use ::protocol::config_types::WindowsSandboxLevel;
use file_system::FileSystemSandboxContext;
use file_system::WindowsSandboxSelection;
use sandboxing::SandboxSelection;
use sandboxing::SandboxType;

pub(crate) fn validate_remote_mxc(info: &crate::EnvironmentInfo) -> std::io::Result<()> {
    if !info.capabilities.windows_mxc {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "exec-server does not support the requested MXC Windows sandbox; update the executor",
        ));
    }
    Ok(())
}

pub(crate) fn sandbox_selection(
    context: &FileSystemSandboxContext,
) -> (SandboxSelection, WindowsSandboxLevel) {
    let level = match context.windows_sandbox_selection {
        WindowsSandboxSelection::Disabled => WindowsSandboxLevel::Disabled,
        WindowsSandboxSelection::RestrictedToken => WindowsSandboxLevel::RestrictedToken,
        WindowsSandboxSelection::Elevated => WindowsSandboxLevel::Elevated,
        WindowsSandboxSelection::Mxc => {
            return (
                SandboxSelection::Explicit(SandboxType::WindowsMxc),
                WindowsSandboxLevel::Disabled,
            );
        }
    };
    (SandboxSelection::RequirePlatform, level)
}
