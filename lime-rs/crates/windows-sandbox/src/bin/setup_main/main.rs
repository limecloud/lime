#[cfg(target_os = "windows")]
fn main() -> anyhow::Result<()> {
    windows_sandbox::setup_helper_main()
}

#[cfg(not(target_os = "windows"))]
fn main() {
    panic!("lime-windows-sandbox-setup is Windows-only");
}
