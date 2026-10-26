// Adapted from Codex 970111f6cb62cc02fe36a82ea7d71b37a2889c97, Apache-2.0.
use std::collections::HashMap;
use std::process::Command;

use super::*;

#[test]
fn policy_applies_excludes_then_set_then_include_without_restoring_launch_context() {
    let vars = [
        ("KEEP", "inherited"),
        ("REMOVE", "inherited"),
        ("API_KEY", "inherited-key"),
        ("OUTSIDE", "outside"),
        ("NODE_REPL_AUTH_TOKEN", "launch-only"),
    ]
    .map(|(key, value)| (key.to_string(), value.to_string()));
    let policy = ShellEnvironmentPolicy {
        ignore_default_excludes: false,
        exclude: vec![EnvironmentVariablePattern::new_case_insensitive("remove")],
        r#set: HashMap::from([
            ("KEEP".into(), "configured".into()),
            ("REMOVE".into(), "explicitly-restored".into()),
            ("NODE_REPL_AUTH_TOKEN".into(), "still-launch-only".into()),
        ]),
        include_only: vec![
            EnvironmentVariablePattern::new_case_insensitive("keep"),
            EnvironmentVariablePattern::new_case_insensitive("remove"),
            EnvironmentVariablePattern::new_case_insensitive("*TOKEN*"),
        ],
        ..Default::default()
    };
    assert_eq!(
        populate_env(vars, &policy, Some("thread-policy")),
        HashMap::from([
            ("KEEP".into(), "configured".into()),
            ("REMOVE".into(), "explicitly-restored".into()),
            ("LIME_THREAD_ID".into(), "thread-policy".into()),
        ])
    );
}

#[test]
fn none_inheritance_keeps_only_explicit_allowed_values() {
    let policy = ShellEnvironmentPolicy {
        inherit: ShellEnvironmentPolicyInherit::None,
        r#set: HashMap::from([("EXPLICIT".into(), "value".into())]),
        ..Default::default()
    };
    assert_eq!(
        populate_env([("PATH".into(), "parent".into())], &policy, None),
        policy.r#set
    );
}

#[test]
fn all_and_core_inheritance_match_codex_defaults() {
    let vars = [
        ("PATH".into(), "path".into()),
        ("CUSTOM_KEY".into(), "value".into()),
    ];
    assert_eq!(
        populate_env(vars.clone(), &ShellEnvironmentPolicy::default(), None),
        HashMap::from(vars.clone())
    );
    let core = ShellEnvironmentPolicy {
        inherit: ShellEnvironmentPolicyInherit::Core,
        ..Default::default()
    };
    assert_eq!(
        populate_env(vars, &core, None),
        HashMap::from([("PATH".into(), "path".into())])
    );
}

const CHILD_MODE_ENV_VAR: &str = "LIME_SHELL_ENVIRONMENT_SCRUBBER_TEST_MODE";
const TEST_NAME: &str =
    "shell_environment::tests::command_scrubber_removes_names_from_real_child_environment";

#[test]
fn tool_call_id_replaces_platform_equivalent_names() {
    let representable = format!("exec-雪-{}", "x".repeat(512));
    for (call_id, expected_call) in [
        (None, None),
        (Some(""), Some("")),
        (Some("invalid\0call"), None),
        (Some("current-call"), Some("current-call")),
        (Some(representable.as_str()), Some(representable.as_str())),
    ] {
        let mut env = HashMap::from([
            ("LIME_TOOL_CALL_ID".to_string(), "stale-call".to_string()),
            (
                "Lime_Tool_Call_Id".to_string(),
                "mixed-case-call".to_string(),
            ),
            (
                "lime_tool_call_id".to_string(),
                "lowercase-call".to_string(),
            ),
            ("OTHER".to_string(), "unchanged".to_string()),
        ]);

        set_tool_call_id_env_var(&mut env, call_id);

        let mut expected = HashMap::from([("OTHER".to_string(), "unchanged".to_string())]);
        #[cfg(not(windows))]
        expected.extend([
            (
                "Lime_Tool_Call_Id".to_string(),
                "mixed-case-call".to_string(),
            ),
            (
                "lime_tool_call_id".to_string(),
                "lowercase-call".to_string(),
            ),
        ]);
        if let Some(expected_call) = expected_call {
            expected.insert("LIME_TOOL_CALL_ID".to_string(), expected_call.to_string());
        }
        assert_eq!(env, expected, "call_id: {call_id:?}");
    }
}

#[test]
fn non_inheritable_environment_is_removed_after_policy_overrides() {
    let vars = [
        ("SAFE".to_string(), "inherited".to_string()),
        (
            "codex_guardian_decisions_api_key".into(),
            "synthetic-inherited-key".into(),
        ),
        ("node_repl_auth_token".into(), "inherited-token".into()),
        (
            "openai_federation_rule_id".to_string(),
            "inherited-rule".to_string(),
        ),
        (
            "OPENAI_WORKLOAD_IDENTITY_CONTEXT".to_string(),
            r#"{"instance_id":"box-one"}"#.to_string(),
        ),
        (
            "lime_exec_server_noise_auth_token".to_string(),
            "inherited-noise-token".to_string(),
        ),
    ];
    let policy = ShellEnvironmentPolicy {
        inherit: ShellEnvironmentPolicyInherit::All,
        ignore_default_excludes: true,
        r#set: HashMap::from([
            ("SAFE".to_string(), "override".to_string()),
            (
                "CODEX_GUARDIAN_DECISIONS_API_KEY".into(),
                "synthetic-override-key".into(),
            ),
            ("Node_Repl_Auth_Token".into(), "configured-token".into()),
            (
                "OpenAI_Identity_Token_File".to_string(),
                "/run/identity-token".to_string(),
            ),
            (
                "Lime_Exec_Server_Noise_Auth_Token".to_string(),
                "configured-noise-token".to_string(),
            ),
        ]),
        ..Default::default()
    };

    assert_eq!(
        populate_env(vars, &policy, /*thread_id*/ None),
        HashMap::from([("SAFE".to_string(), "override".to_string())])
    );
}

#[test]
fn command_scrubber_removes_names_from_real_child_environment() {
    if std::env::var_os(CHILD_MODE_ENV_VAR).is_none() {
        let output = Command::new(std::env::current_exe().expect("locate current test binary"))
            .args([TEST_NAME, "--exact", "--nocapture"])
            .env(CHILD_MODE_ENV_VAR, "1")
            .env(
                "Codex_Guardian_Decisions_Api_Key",
                "synthetic-inherited-key",
            )
            .env("Node_Repl_Auth_Token", "inherited-token")
            .env("OpenAI_Federation_Rule_Id", "inherited-rule")
            .env(
                "OpenAI_Workload_Identity_Context",
                r#"{"instance_id":"box-one"}"#,
            )
            .env("Lime_Exec_Server_Noise_Auth_Token", "inherited-noise-token")
            .output()
            .expect("run inherited-environment test process");
        assert!(
            output.status.success(),
            "child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        return;
    }

    let mut command = environment_command();
    command
        .env("NODE_REPL_AUTH_TOKEN", "configured-token")
        .env("openai_identity_token_file", "/run/identity-token")
        .env(
            LIME_EXEC_SERVER_NOISE_AUTH_TOKEN_ENV_VAR,
            "configured-noise-token",
        )
        .env("CODEX_GUARDIAN_DECISIONS_API_KEY", "synthetic-override-key")
        .env("SAFE", "value");
    scrub_non_inheritable_env_vars(&mut command);
    let output = command.output().expect("read child environment");
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let restricted_names = stdout
        .lines()
        .filter_map(|line| line.split_once('=').map(|(name, _)| name))
        .filter(|name| is_non_inheritable_env_var(name))
        .collect::<Vec<_>>();
    assert_eq!(restricted_names, Vec::<&str>::new());
}

#[cfg(windows)]
fn environment_command() -> Command {
    let mut command = Command::new("cmd.exe");
    command.args(["/D", "/C", "set"]);
    command
}

#[cfg(not(windows))]
fn environment_command() -> Command {
    Command::new("env")
}
