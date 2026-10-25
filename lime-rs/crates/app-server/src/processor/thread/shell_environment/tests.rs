use super::*;
use agent_protocol::config_types::ShellEnvironmentPolicy;
use serde_json::json;

#[test]
fn nested_and_dotted_overrides_preserve_literal_variable_names_and_precedence() {
    let previous = HashMap::from([
        (
            "shell_environment_policy".into(),
            json!({"inherit":"none", "set":{"KEEP":"previous","REPLACE":"old"}}),
        ),
        (
            "shell_environment_policy.ignore_default_excludes".into(),
            json!(false),
        ),
    ]);
    let current = HashMap::from([
        (
            "shell_environment_policy".into(),
            json!({"inherit":"core","set":{"REPLACE":"nested"}}),
        ),
        (
            "shell_environment_policy.set".into(),
            json!({"REPLACE":"dotted"}),
        ),
        (
            "shell_environment_policy.set.LITERAL.NAME".into(),
            json!("equals=value"),
        ),
    ]);
    let policy = merged_shell_environment_overrides(Some(&previous), Some(&current)).unwrap();
    assert_eq!(
        policy.inherit,
        Some(agent_protocol::config_types::ShellEnvironmentPolicyInherit::Core)
    );
    assert_eq!(policy.ignore_default_excludes, Some(false));
    assert_eq!(
        policy.r#set.unwrap(),
        HashMap::from([
            ("KEEP".into(), "previous".into()),
            ("REPLACE".into(), "dotted".into()),
            ("LITERAL.NAME".into(), "equals=value".into()),
        ])
    );
}

#[test]
fn resume_accepts_only_supported_shell_policy_config_overrides() {
    for key in [
        "shell_environment_policy",
        "shell_environment_policy.inherit",
        "shell_environment_policy.filters.PATH",
        "shell_environment_policy.set.LITERAL.NAME",
    ] {
        assert!(is_shell_environment_policy_override(key), "{key}");
    }
    for key in [
        "model",
        "features",
        "shell_environment_policy_typo",
        "shell_environment_policy.unknown",
    ] {
        assert!(!is_shell_environment_policy_override(key), "{key}");
    }
}

#[test]
fn filter_tables_merge_ignoring_case_and_invalid_policies_fail_before_execution() {
    let previous = HashMap::from([(
        "shell_environment_policy.filters".into(),
        json!({"PATH":"include","*TOKEN*":"exclude"}),
    )]);
    let current = HashMap::from([(
        "shell_environment_policy.filters.path".into(),
        json!("exclude"),
    )]);
    let policy = merged_shell_environment_overrides(Some(&previous), Some(&current)).unwrap();
    assert_eq!(policy.filters.unwrap().len(), 2);
    for value in [
        json!(false),
        json!({"inherit":"invalid"}),
        json!({"set":{"VALUE":3}}),
        json!({"filters":{"PATH":"include"},"exclude":["HOME"]}),
    ] {
        assert!(merged_shell_environment_overrides(
            None,
            Some(&HashMap::from([("shell_environment_policy".into(), value)]))
        )
        .is_err());
    }
}

#[test]
fn nested_and_dotted_filter_overrides_merge_without_case_collisions() {
    let values = HashMap::from([
        (
            "shell_environment_policy".into(),
            json!({"filters":{"PATH":"include","KEEP":"include"}}),
        ),
        (
            "shell_environment_policy.filters".into(),
            json!({"Path":"exclude","HOME":"include"}),
        ),
        (
            "shell_environment_policy.filters.pAtH".into(),
            json!("include"),
        ),
    ]);
    let filters = merged_shell_environment_overrides(None, Some(&values))
        .unwrap()
        .filters
        .unwrap();
    assert_eq!(filters.len(), 3);
    assert_eq!(
        filters["path"],
        agent_protocol::config_types::ShellEnvironmentPolicyFilter::Include
    );
    for values in [
        HashMap::from([(
            "shell_environment_policy.filters".into(),
            json!({"PATH":"include","path":"exclude"}),
        )]),
        HashMap::from([
            (
                "shell_environment_policy.filters.PATH".into(),
                json!("include"),
            ),
            (
                "shell_environment_policy.filters.path".into(),
                json!("exclude"),
            ),
        ]),
    ] {
        assert!(merged_shell_environment_overrides(None, Some(&values)).is_err());
    }
}

#[tokio::test]
async fn worktree_diff_overrides_configured_set_and_preserves_include_filters() {
    let temporary = tempfile::tempdir().unwrap();
    assert!(std::process::Command::new("git")
        .args(["init", "--template="])
        .arg(temporary.path())
        .output()
        .unwrap()
        .status
        .success());
    let diff = lime_services::project_git_service::WorktreeShellEnvironment::from_captures(
        "REMOVE=old\n",
        "VALUE=setup\n",
    )
    .unwrap();
    lime_services::project_git_service::write_worktree_shell_environment(temporary.path(), &diff)
        .await
        .unwrap();
    let mut config = Config::default();
    config.shell_environment_policy = serde_json::from_value(json!({"set":{"VALUE":"configured","REMOVE":"configured"},"filters":{"VALUE":"include","KEEP":"include","REMOVE":"include"}})).unwrap();
    let policy: ShellEnvironmentPolicy =
        read_shell_environment_policy(&config, temporary.path(), None, None)
            .await
            .unwrap()
            .into();
    let environment = agent_protocol::shell_environment::populate_env(
        [
            ("REMOVE".into(), "inherited".into()),
            ("KEEP".into(), "inherited".into()),
        ],
        &policy,
        None,
    );
    assert_eq!(
        environment,
        HashMap::from([
            ("VALUE".into(), "setup".into()),
            ("KEEP".into(), "inherited".into())
        ])
    );
}

#[tokio::test]
async fn non_git_directory_uses_configured_policy_without_creating_metadata() {
    let temporary = tempfile::tempdir().unwrap();
    let mut config = Config::default();
    config.shell_environment_policy =
        serde_json::from_value(json!({"inherit":"none","set":{"VALUE":"configured"}})).unwrap();
    assert_eq!(
        read_shell_environment_policy(&config, temporary.path(), None, None)
            .await
            .unwrap(),
        config.shell_environment_policy
    );
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
}
