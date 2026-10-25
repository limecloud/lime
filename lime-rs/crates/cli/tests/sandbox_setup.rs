use std::process::{Command, Output};

fn setup_command(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_lime"))
        .args(["sandbox", "setup", "--elevated"])
        .args(args)
        .output()
        .expect("run Lime sandbox argument parser")
}

#[test]
fn managed_setup_requires_the_lime_home_argument() {
    let output = setup_command(&["--user", "DOMAIN\\alice"]);
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--lime-home <DIR>"), "{stderr}");
    assert!(!stderr.contains("--codex-home"), "{stderr}");
    assert!(!stderr.contains("only available on Windows"), "{stderr}");
}

#[test]
fn retired_home_argument_is_rejected_before_sandbox_setup() {
    let output = setup_command(&["--current-user", "--codex-home", "unused-retired-home"]);
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("unexpected argument '--codex-home'"),
        "{stderr}"
    );
    assert!(!stderr.contains("only available on Windows"), "{stderr}");
}
