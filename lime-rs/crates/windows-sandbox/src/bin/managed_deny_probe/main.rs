// Keep the ACL probe independent of test-harness startup, which writes LIME_HOME.
#[cfg(target_os = "windows")]
mod win;

#[cfg(target_os = "windows")]
fn main() {
    win::main();
}

#[cfg(not(target_os = "windows"))]
fn main() {
    panic!("lime-windows-managed-deny-probe is Windows-only");
}
