use super::*;

#[test]
fn last_uses_updated_desc_unarchived_provider_and_cwd_without_private_storage() {
    let args = ResumeArgs {
        connection: Default::default(),
        session_id: None,
        last: true,
        all: false,
        prompt: None,
        images: Vec::new(),
    };
    let params = resume_list_params(&args, Path::new("/project"), Some("provider"));
    assert_eq!(params.sort_key, Some(ThreadSortKey::UpdatedAt));
    assert_eq!(params.sort_direction, Some(SortDirection::Desc));
    assert_eq!(params.archived, Some(false));
    assert_eq!(
        params.cwd,
        Some(ThreadListCwdFilter::One("/project".into()))
    );
    assert_eq!(params.model_providers, Some(vec!["provider".into()]));
    assert!(!params.use_state_db_only);
}

#[test]
fn all_removes_cwd_and_title_lookup_is_not_limited_by_the_active_provider() {
    let args = ResumeArgs {
        connection: Default::default(),
        session_id: Some("Exact title".into()),
        last: false,
        all: true,
        prompt: None,
        images: Vec::new(),
    };
    let params = resume_list_params(&args, Path::new("/project"), Some("provider"));
    assert_eq!(params.cwd, None);
    assert_eq!(params.model_providers, None);
    assert_eq!(params.search_term.as_deref(), Some("Exact title"));
}

#[test]
fn fork_overrides_model_environment_and_permission_group_at_the_canonical_boundary() {
    let mut connection = ConnectionArgs {
        model: Some("model".into()),
        provider: Some("provider".into()),
        permissions: Some(":workspace".into()),
        ..Default::default()
    };
    let params = fork_params("source".into(), &connection, Path::new("/target")).unwrap();
    assert_eq!(params.thread_id, "source");
    assert_eq!(params.cwd.as_deref(), Some("/target"));
    assert_eq!(params.runtime_workspace_roots, Some(vec!["/target".into()]));
    assert_eq!(params.model.as_deref(), Some("model"));
    assert_eq!(params.model_provider.as_deref(), Some("provider"));
    assert_eq!(params.permissions.as_deref(), Some(":workspace"));
    assert_eq!(params.sandbox, None);
    assert!(params.exclude_turns && params.defer_goal_continuation);
    assert!(!params.ephemeral);
    connection.permissions = None;
    connection.approve_for_me = true;
    let params = fork_params("source".into(), &connection, Path::new("/target")).unwrap();
    assert_eq!(params.sandbox, Some(serde_json::json!("workspace-write")));
    assert_eq!(
        params.approval_policy,
        Some(serde_json::json!("on-request"))
    );
    assert_eq!(params.permissions, None);
}
