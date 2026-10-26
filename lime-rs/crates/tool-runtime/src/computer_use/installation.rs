use super::{denied, ComputerUsePaths, ComputerUseResult};

pub const NATIVE_HOST: &str = "com.limecloud.lime.computer_use";

pub(super) fn install_chrome_host(paths: &ComputerUsePaths) -> ComputerUseResult<()> {
    let extension = paths.root.join("chrome");
    super::mailbox::private_directory(&extension)?;
    macro_rules! asset {
        ($path:literal) => {
            (
                $path,
                include_bytes!(concat!("../../../../../extensions/lime-chrome/", $path)).as_slice(),
            )
        };
    }
    for (name, bytes) in [
        asset!("manifest.json"),
        asset!("computer-use.js"),
        asset!("tab-groups.js"),
        asset!("browser-session.js"),
        asset!("computer-use.html"),
        asset!("computer-use.css"),
        asset!("computer-use-popup.js"),
        asset!("icons/icon16.png"),
        asset!("icons/icon32.png"),
        asset!("icons/icon48.png"),
        asset!("icons/icon128.png"),
        asset!("_locales/en/messages.json"),
        asset!("_locales/zh_CN/messages.json"),
        asset!("_locales/zh_TW/messages.json"),
        asset!("_locales/ja/messages.json"),
        asset!("_locales/ko/messages.json"),
    ] {
        let destination = extension.join(name);
        super::mailbox::private_directory(destination.parent().unwrap())?;
        super::mailbox::write_bytes(&destination, bytes)?;
    }
    let path = &paths.chrome_manifest;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| denied(e.to_string()))?;
    let executable = std::env::current_exe().map_err(|e| denied(e.to_string()))?;
    super::mailbox::write(
        &path,
        &serde_json::json!({
            "name":NATIVE_HOST,"description":"Lime Computer Use","path":executable,
            "type":"stdio","allowed_origins":[super::CHROME_EXTENSION_ORIGIN]
        }),
    )?;
    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("reg.exe")
            .args([
                "ADD",
                &format!("HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\{NATIVE_HOST}"),
                "/ve",
                "/t",
                "REG_SZ",
                "/d",
            ])
            .arg(&path)
            .arg("/f")
            .status()
            .map_err(|e| denied(e.to_string()))?;
        if !status.success() {
            return Err(denied("Chrome native host registration failed"));
        }
    }
    Ok(())
}

pub(super) fn reveal(path: &std::path::Path) -> ComputerUseResult<()> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open")
        .arg(path)
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer.exe").arg(path).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(path).spawn();
    result
        .map(|mut child| {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        })
        .map_err(|e| denied(e.to_string()))
}
