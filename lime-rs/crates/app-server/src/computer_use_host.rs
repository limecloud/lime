//! Binary composition shared by runtime, Chrome Native Messaging and Office.

use tool_runtime::computer_use::ComputerUsePaths;

pub(super) fn paths() -> anyhow::Result<ComputerUsePaths> {
    // Never use the database/config/workspace overrides for the desktop lock
    // or mailbox. Independently launched hosts must agree on the same paths.
    let root = super::resolve_platform_app_data_root()?.join("computer-use");
    let manifest = format!("{}.json", tool_runtime::computer_use::NATIVE_HOST);
    #[cfg(target_os = "macos")]
    let chrome_manifest = dirs::data_dir()
        .ok_or_else(|| anyhow::anyhow!("User application data directory unavailable"))?
        .join("Google/Chrome/NativeMessagingHosts")
        .join(manifest);
    #[cfg(target_os = "windows")]
    let chrome_manifest = root.join(manifest);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let chrome_manifest = dirs::config_dir()
        .ok_or_else(|| anyhow::anyhow!("User config directory unavailable"))?
        .join("google-chrome/NativeMessagingHosts")
        .join(manifest);
    #[cfg(target_os = "macos")]
    let excel_sideload = Some(
        dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("User home directory unavailable"))?
            .join("Library/Containers/com.microsoft.Excel/Data/Documents/wef"),
    );
    #[cfg(not(target_os = "macos"))]
    let excel_sideload = None;
    Ok(ComputerUsePaths {
        root,
        chrome_manifest,
        excel_sideload,
    })
}
