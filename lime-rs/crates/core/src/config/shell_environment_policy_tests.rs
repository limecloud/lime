use super::*;

#[test]
fn yaml_filters_are_case_insensitive_and_convert_to_runtime_policy() {
    let config: super::super::Config = serde_yaml::from_str(
        "shell_environment_policy:\n  inherit: none\n  ignore_default_excludes: false\n  filters:\n    'VISIBLE_*': include\n    '*secret*': exclude\n  set:\n    VISIBLE_VALUE: configured\n    VISIBLE_SECRET: hidden\n",
    ).unwrap();
    let policy: ShellEnvironmentPolicy = config.shell_environment_policy.into();
    let environment = agent_protocol::shell_environment::populate_env(
        [("INHERITED".into(), "parent".into())],
        &policy,
        None,
    );
    // 与 Codex 相同：显式 set 在 exclude 后应用，再由 include_only 筛选。
    assert_eq!(
        environment,
        HashMap::from([
            ("VISIBLE_VALUE".into(), "configured".into()),
            ("VISIBLE_SECRET".into(), "hidden".into()),
        ])
    );
}

#[test]
fn filter_conflicts_and_duplicate_case_are_rejected() {
    for raw in [
        "filters: { PATH: include }\nexclude: [HOME]\n",
        "filters: { PATH: include }\ninclude_only: [HOME]\n",
        "filters: { PATH: include, path: exclude }\n",
        "inherit: unsupported\n",
        "set: { VALUE: [invalid] }\n",
    ] {
        assert!(
            serde_yaml::from_str::<ShellEnvironmentPolicyToml>(raw).is_err(),
            "{raw}"
        );
    }
}

#[test]
fn policy_survives_yaml_save_reload_and_empty_policy_does_not_add_config_noise() {
    let mut config = super::super::Config::default();
    assert!(!serde_json::to_value(&config)
        .unwrap()
        .as_object()
        .unwrap()
        .contains_key("shell_environment_policy"));
    config.shell_environment_policy = serde_yaml::from_str("inherit: core\nset: { VALUE: 'a=b' }\nexclude: ['*TOKEN*']\nexperimental_use_profile: true\n").unwrap();
    let saved = serde_yaml::to_string(&config).unwrap();
    let restored: super::super::Config = serde_yaml::from_str(&saved).unwrap();
    assert_eq!(
        restored.shell_environment_policy,
        config.shell_environment_policy
    );
    let policy: ShellEnvironmentPolicy = restored.shell_environment_policy.into();
    assert!(policy.use_profile);
    assert_eq!(policy.inherit, ShellEnvironmentPolicyInherit::Core);
    assert_eq!(policy.r#set.get("VALUE").map(String::as_str), Some("a=b"));
}

#[test]
fn trusted_project_layers_merge_filters_case_insensitively_and_keep_user_sets() {
    use super::super::layers::{ConfigLayers, ProjectConfig, TrustLevel};
    let temporary = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(temporary.path()).unwrap();
    let nested = root.join("nested");
    std::fs::create_dir(root.join(".git")).unwrap();
    std::fs::create_dir(root.join(".lime")).unwrap();
    std::fs::create_dir_all(nested.join(".lime")).unwrap();
    std::fs::write(root.join(".lime/config.toml"), "[shell_environment_policy.filters]\nPATH = 'exclude'\nHOME = 'include'\n[shell_environment_policy.set]\nVALUE = 'project'\n").unwrap();
    std::fs::write(nested.join(".lime/config.toml"), "[shell_environment_policy.filters]\npath = 'include'\n[shell_environment_policy.set]\nNESTED = 'nested'\n").unwrap();
    let mut user = super::super::Config::default();
    user.shell_environment_policy = serde_json::from_value(serde_json::json!({
        "inherit":"none", "filters":{"Path":"include","KEEP":"include"},
        "set":{"VALUE":"user","KEEP":"user"}
    }))
    .unwrap();
    user.projects.insert(
        root.to_string_lossy().into_owned(),
        ProjectConfig {
            trust_level: Some(TrustLevel::Trusted),
        },
    );
    let layers = ConfigLayers::from_user_with_managed(user.clone(), Some(&nested), None).unwrap();
    let policy = layers.effective.shell_environment_policy;
    assert_eq!(policy.inherit, Some(ShellEnvironmentPolicyInherit::None));
    let filters = policy.filters.unwrap();
    assert_eq!(filters.len(), 3);
    assert_eq!(filters["path"], ShellEnvironmentPolicyFilter::Include);
    assert_eq!(
        policy.r#set.unwrap(),
        HashMap::from([
            ("VALUE".into(), "project".into()),
            ("KEEP".into(), "user".into()),
            ("NESTED".into(), "nested".into())
        ])
    );
    user.projects.clear();
    assert_eq!(
        ConfigLayers::from_user_with_managed(user.clone(), Some(&nested), None)
            .unwrap()
            .effective
            .shell_environment_policy,
        user.shell_environment_policy
    );
}

#[test]
fn invalid_policy_layer_is_rejected_before_a_higher_layer_can_hide_it() {
    use super::super::layers::merge_defaults;
    for invalid in [
        serde_json::json!({"filters":{"PATH":"include","path":"exclude"}}),
        serde_json::json!({"filters":{"PATH":"include"},"exclude":["HOME"]}),
        serde_json::json!({"inherit":"invalid"}),
    ] {
        let mut effective = serde_json::json!({});
        assert!(merge_defaults(
            &mut effective,
            &serde_json::json!({"shell_environment_policy":invalid})
        )
        .is_err());
    }
    let mut effective = serde_json::json!({"shell_environment_policy":{"exclude":["HOME"]}});
    merge_defaults(
        &mut effective,
        &serde_json::json!({"shell_environment_policy":{"filters":{"PATH":"include"}}}),
    )
    .unwrap();
    let policy: ShellEnvironmentPolicyToml =
        serde_json::from_value(effective["shell_environment_policy"].clone()).unwrap();
    assert!(policy.exclude.is_none());
    assert_eq!(policy.filters.unwrap().len(), 1);
}
