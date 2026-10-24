use super::*;
use serde_json::json;

fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    let user = temp.path().join("config.yaml");
    (temp, root, user)
}

fn trust(user: &Path, root: &Path) {
    let mut config = Config::default();
    config.projects.insert(
        root.to_string_lossy().into_owned(),
        ProjectConfig {
            trust_level: Some(TrustLevel::Trusted),
        },
    );
    ConfigManager::with_config(config, user.to_path_buf())
        .save()
        .unwrap();
}

fn project(root: &Path, source: &str) -> PathBuf {
    let file = root.join(PROJECT_CONFIG_FOLDER).join(PROJECT_CONFIG_FILE);
    save_project(&file, source).unwrap();
    file
}

#[test]
fn layers_inherit_only_runtime_defaults_from_trusted_root_to_cwd() {
    let (_temp, root, user) = setup();
    trust(&user, &root);
    let child = root.join("child");
    std::fs::create_dir(&child).unwrap();
    project(&root, "approval_policy = 'never'\nmodel_verbosity = 'high'\nproxy_url = 'https://untrusted.invalid'\n[projects.evil]\ntrust_level = 'trusted'\n");
    project(&child, "model_verbosity = 'low'\nweb_search = 'disabled'\n");
    let stack = ConfigLayers::load(&user, Some(&child)).unwrap();
    assert_eq!(stack.projects.len(), 2);
    assert_eq!(
        stack.effective.approval_policy,
        super::super::ApprovalPolicy::Never
    );
    assert_eq!(
        serde_json::to_value(stack.effective.model_verbosity).unwrap(),
        "low"
    );
    assert_eq!(
        stack.effective.web_search,
        Some(agent_protocol::WebSearchMode::Disabled)
    );
    assert!(stack.effective.proxy_url.is_none());
    assert_eq!(stack.effective.projects, stack.user.projects);
    assert_eq!(
        stack.user.approval_policy,
        super::super::ApprovalPolicy::OnRequest
    );
}

#[test]
fn untrusted_layer_cannot_grant_itself_trust_or_change_defaults() {
    let (_temp, root, user) = setup();
    project(
        &root,
        "approval_policy = 'never'\n[projects.self]\ntrust_level = 'trusted'\n",
    );
    let stack = ConfigLayers::load(&user, Some(&root)).unwrap();
    assert!(stack.projects[0].disabled_reason.is_some());
    assert_eq!(
        stack.effective.approval_policy,
        super::super::ApprovalPolicy::OnRequest
    );
    trust(&user, &root);
    let mut config = ConfigManager::load(&user).unwrap().config().clone();
    let child = root.join("child");
    std::fs::create_dir(&child).unwrap();
    config.projects.insert(
        child.to_string_lossy().into_owned(),
        ProjectConfig {
            trust_level: Some(TrustLevel::Untrusted),
        },
    );
    ConfigManager::with_config(config, user.clone())
        .save()
        .unwrap();
    let stack = ConfigLayers::load(&user, Some(&child)).unwrap();
    assert!(stack
        .projects
        .iter()
        .all(|project| project.disabled_reason.is_some()));
}

#[test]
fn absent_directory_has_no_scope_and_existing_empty_directory_requires_trust() {
    let (_temp, root, user) = setup();
    assert!(ConfigLayers::load(&user, Some(&root))
        .unwrap()
        .projects
        .is_empty());
    assert!(!root.join(PROJECT_CONFIG_FOLDER).exists());
    std::fs::create_dir(root.join(PROJECT_CONFIG_FOLDER)).unwrap();
    assert!(ConfigLayers::load(&user, Some(&root)).unwrap().projects[0]
        .disabled_reason
        .is_some());
    trust(&user, &root);
    let stack = ConfigLayers::load(&user, Some(&root)).unwrap();
    assert!(stack.projects[0].disabled_reason.is_none());
    assert_eq!(stack.projects[0].config, json!({}));
    assert!(!root
        .join(PROJECT_CONFIG_FOLDER)
        .join(PROJECT_CONFIG_FILE)
        .exists());
}

#[test]
fn precise_edits_preserve_comments_and_unknown_tables() {
    let source =
        "# project\nmodel_verbosity = 'high' # keep\n\n[unrelated]\nname = ' untouched '\n";
    let saved = edit_project(source, "model_verbosity", &json!("low")).unwrap();
    assert!(saved.starts_with("# project\n"));
    assert!(saved.contains("# keep\n\n[unrelated]\nname = ' untouched '\n"));
    assert_eq!(parse_project(&saved).unwrap()["model_verbosity"], "low");
    let reset = edit_project(&saved, "model_verbosity", &Value::Null).unwrap();
    assert!(parse_project(&reset)
        .unwrap()
        .get("model_verbosity")
        .is_none());
    assert!(reset.contains("[unrelated]\nname = ' untouched '\n"));
}

#[test]
fn nested_network_edits_keep_other_table_entries_and_reject_inline_tables() {
    let source = "[sandbox_workspace_write]\nnetwork_access = false # network\nother = 'keep'\n";
    let saved = edit_project(
        source,
        "sandbox_workspace_write.network_access",
        &json!(true),
    )
    .unwrap();
    assert!(saved.contains("true # network"));
    assert!(saved.contains("other = 'keep'"));
    assert!(edit_project(
        "sandbox_workspace_write = { network_access = false }\n",
        "sandbox_workspace_write.network_access",
        &json!(true)
    )
    .is_err());
    assert!(edit_project(source, "desktop.enabled-reasoning-efforts", &json!([])).is_err());
}

#[test]
fn malformed_enabled_project_is_reported_and_relative_cwd_is_rejected() {
    let (_temp, root, user) = setup();
    project(&root, "invalid = [");
    assert!(ConfigLayers::load(&user, Some(&root)).is_ok());
    trust(&user, &root);
    assert!(ConfigLayers::load(&user, Some(&root)).is_err());
    assert!(ConfigLayers::load(&user, Some(Path::new("relative"))).is_err());
}

#[test]
fn effective_layers_reuse_the_same_user_snapshot_despite_an_external_user_edit() {
    let (_temp, root, user) = setup();
    trust(&user, &root);
    project(&root, "model_verbosity = 'high'\n");
    let snapshot = ConfigManager::load(&user).unwrap().config().clone();
    ConfigManager::with_config(Config::default(), user.clone())
        .save()
        .unwrap();
    let frozen = ConfigLayers::from_user(snapshot, Some(&root)).unwrap();
    assert!(frozen.projects[0].disabled_reason.is_none());
    assert_eq!(
        serde_json::to_value(frozen.effective.model_verbosity).unwrap(),
        "high"
    );
    let fresh = ConfigLayers::load(&user, Some(&root)).unwrap();
    assert!(fresh.projects[0].disabled_reason.is_some());
    assert!(fresh.effective.model_verbosity.is_none());
}

#[cfg(unix)]
#[test]
fn native_path_alias_in_the_user_trust_map_matches_the_canonical_project() {
    let (temp, root, user) = setup();
    let alias = temp.path().join("repo-alias");
    std::os::unix::fs::symlink(&root, &alias).unwrap();
    trust(&user, &alias);
    project(&root, "web_search = 'disabled'\n");
    let stack = ConfigLayers::load(&user, Some(&alias)).unwrap();
    assert!(stack.projects[0].disabled_reason.is_none());
    assert_eq!(stack.projects[0].folder, root.join(PROJECT_CONFIG_FOLDER));
    assert_eq!(
        stack.effective.web_search,
        Some(agent_protocol::WebSearchMode::Disabled)
    );
}

#[cfg(unix)]
#[test]
fn symbolic_link_layer_is_neither_loaded_nor_writable() {
    let (temp, root, user) = setup();
    trust(&user, &root);
    let outside = temp.path().join("outside.toml");
    std::fs::write(&outside, "approval_policy = 'never'\n").unwrap();
    std::fs::create_dir(root.join(PROJECT_CONFIG_FOLDER)).unwrap();
    std::os::unix::fs::symlink(
        &outside,
        root.join(PROJECT_CONFIG_FOLDER).join(PROJECT_CONFIG_FILE),
    )
    .unwrap();
    let stack = ConfigLayers::load(&user, Some(&root)).unwrap();
    assert!(stack.projects[0]
        .disabled_reason
        .as_ref()
        .unwrap()
        .contains("symbolic"));
    assert_eq!(stack.effective.approval_policy, stack.user.approval_policy);
}
