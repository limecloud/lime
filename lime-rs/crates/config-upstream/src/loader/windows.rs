use super::windows_lime_system_dir;
use std::path::Path;

/// Coarse compatibility result for the default Windows system-config namespace.
#[derive(Clone, Copy)]
pub enum WindowsSystemConfigNamespaceProbe {
    Missing,
    Expected,
    UnexpectedType,
    UnexpectedOwner,
    StandardUserMutationAcl,
    CheckError,
}

/// Observes the common user-preclaimed-directory shape without changing config loading.
/// This is not a trust decision: it only checks directory owner and broad
/// standard-user mutation ACLs.
pub fn probe_windows_system_config_namespace() -> WindowsSystemConfigNamespaceProbe {
    let lime_dir = windows_lime_system_dir();
    let has_system_file = match (
        lime_dir.join("config.toml").try_exists(),
        lime_dir.join("requirements.toml").try_exists(),
    ) {
        (Ok(true), _) | (_, Ok(true)) => true,
        (Ok(false), Ok(false)) => false,
        _ => return WindowsSystemConfigNamespaceProbe::CheckError,
    };
    if !has_system_file {
        return WindowsSystemConfigNamespaceProbe::Missing;
    }
    let Some(openai_dir) = lime_dir.parent() else {
        return WindowsSystemConfigNamespaceProbe::CheckError;
    };
    let result = probe_directory(
        openai_dir,
        windows_sandbox::path_has_standard_user_mutation_allow,
    );
    if !matches!(result, WindowsSystemConfigNamespaceProbe::Expected) {
        return result;
    }
    let result = probe_directory(
        lime_dir.as_path(),
        windows_sandbox::path_or_child_file_has_standard_user_mutation_allow,
    );
    if !matches!(result, WindowsSystemConfigNamespaceProbe::Expected) {
        return result;
    }
    WindowsSystemConfigNamespaceProbe::Expected
}

fn probe_directory(
    path: &Path,
    mutation_allow: fn(&Path) -> anyhow::Result<bool>,
) -> WindowsSystemConfigNamespaceProbe {
    if !path.is_dir() {
        return WindowsSystemConfigNamespaceProbe::UnexpectedType;
    }
    match windows_sandbox::path_has_trusted_system_owner(path) {
        Ok(true) => {}
        Ok(false) => return WindowsSystemConfigNamespaceProbe::UnexpectedOwner,
        Err(_) => return WindowsSystemConfigNamespaceProbe::CheckError,
    }
    match mutation_allow(path) {
        Ok(false) => WindowsSystemConfigNamespaceProbe::Expected,
        Ok(true) => WindowsSystemConfigNamespaceProbe::StandardUserMutationAcl,
        Err(_) => WindowsSystemConfigNamespaceProbe::CheckError,
    }
}
