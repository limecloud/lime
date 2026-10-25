use std::fs;
use std::process::Command;

use serde_json::json;
use tempfile::TempDir;

fn lime_command() -> Command {
    Command::new(env!("CARGO_BIN_EXE_lime"))
}

#[test]
fn execpolicy_check_matches_expected_json() -> Result<(), Box<dyn std::error::Error>> {
    let lime_home = TempDir::new()?;
    let policy_path = lime_home.path().join("rules").join("policy.rules");
    fs::create_dir_all(
        policy_path
            .parent()
            .expect("policy path should have a parent"),
    )?;
    fs::write(
        &policy_path,
        r#"
prefix_rule(
    pattern = ["git", "push"],
    decision = "forbidden",
)
"#,
    )?;

    let output = lime_command()
        .env("LIME_HOME", lime_home.path())
        .args([
            "execpolicy",
            "check",
            "--rules",
            policy_path
                .to_str()
                .expect("policy path should be valid UTF-8"),
            "git",
            "push",
            "origin",
            "main",
        ])
        .output()?;

    assert!(output.status.success());
    let result: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(
        result,
        json!({
            "decision": "forbidden",
            "matchedRules": [
                {
                    "prefixRuleMatch": {
                        "matchedPrefix": ["git", "push"],
                        "decision": "forbidden"
                    }
                }
            ]
        })
    );

    Ok(())
}

#[test]
fn execpolicy_check_includes_justification_when_present() -> Result<(), Box<dyn std::error::Error>>
{
    let lime_home = TempDir::new()?;
    let policy_path = lime_home.path().join("rules").join("policy.rules");
    fs::create_dir_all(
        policy_path
            .parent()
            .expect("policy path should have a parent"),
    )?;
    fs::write(
        &policy_path,
        r#"
prefix_rule(
    pattern = ["git", "push"],
    decision = "forbidden",
    justification = "pushing is blocked in this repo",
)
"#,
    )?;

    let output = lime_command()
        .env("LIME_HOME", lime_home.path())
        .args([
            "execpolicy",
            "check",
            "--rules",
            policy_path
                .to_str()
                .expect("policy path should be valid UTF-8"),
            "git",
            "push",
            "origin",
            "main",
        ])
        .output()?;

    assert!(output.status.success());
    let result: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(
        result,
        json!({
            "decision": "forbidden",
            "matchedRules": [
                {
                    "prefixRuleMatch": {
                        "matchedPrefix": ["git", "push"],
                        "decision": "forbidden",
                        "justification": "pushing is blocked in this repo"
                    }
                }
            ]
        })
    );

    Ok(())
}

#[test]
fn execpolicy_check_resolves_only_allowlisted_host_executables(
) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = TempDir::new()?;
    let executable_name = if cfg!(windows) { "git.exe" } else { "git" };
    let allowed_program = workspace.path().join("allowed").join(executable_name);
    let unlisted_program = workspace.path().join("unlisted").join(executable_name);
    let policy_path = workspace.path().join("host.rules");
    fs::write(
        &policy_path,
        format!(
            "prefix_rule(pattern = [\"git\", \"push\"], decision = \"forbidden\")\n\
             host_executable(name = \"git\", paths = [{}])\n",
            serde_json::to_string(&allowed_program)?,
        ),
    )?;

    for (program, expected) in [
        (
            &allowed_program,
            json!({
                "decision": "forbidden",
                "matchedRules": [{
                    "prefixRuleMatch": {
                        "matchedPrefix": ["git", "push"],
                        "decision": "forbidden",
                        "resolvedProgram": allowed_program,
                    }
                }]
            }),
        ),
        (&unlisted_program, json!({ "matchedRules": [] })),
    ] {
        let output = lime_command()
            .args(["execpolicy", "check", "--rules"])
            .arg(&policy_path)
            .arg("--resolve-host-executables")
            .arg(program)
            .arg("push")
            .output()?;
        assert!(
            output.status.success(),
            "program={} status={} stderr={}",
            program.display(),
            output.status,
            String::from_utf8_lossy(&output.stderr),
        );
        let actual: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        assert_eq!(actual, expected, "program={}", program.display());
    }
    Ok(())
}
