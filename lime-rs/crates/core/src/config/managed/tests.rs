use super::*;
use crate::config::{layers::ConfigLayers, ApprovalPolicy, ModelVerbosity, SandboxMode};
use serde_json::json;
use std::cell::Cell;

fn config(source: &str) -> ManagedConfig {
    parse_config(&STANDARD.encode(source)).unwrap()
}

#[test]
fn forced_source_rejects_ordinary_defaults_and_revoked_authority() {
    let copied = Cell::new(false);
    assert_eq!(
        read_forced(
            || false,
            || {
                copied.set(true);
                Some("user")
            },
            |v| Some(v.into())
        )
        .unwrap(),
        None
    );
    assert!(!copied.get());
    let calls = Cell::new(0);
    assert_eq!(
        read_forced(
            || {
                calls.set(calls.get() + 1);
                calls.get() == 1
            },
            || Some("user fallback"),
            |v| Some(v.into())
        )
        .unwrap(),
        None
    );
    assert_eq!(calls.get(), 2);
    assert_eq!(
        read_forced(|| true, || Some("forced"), |v| Some(v.into())).unwrap(),
        Some("forced".into())
    );
    assert!(read_forced(|| true, || Some(42), |_| None).is_err());
    assert_eq!(
        read_forced::<i32>(|| true, || None, |_| None).unwrap(),
        None
    );
}

#[test]
fn invalid_managed_values_fail_closed() {
    for source in [
        "model_verbosity = 42",
        "model_verbosity = 'huge'",
        "user_admin = true",
        "sandbox_workspace_write = {unknown = true}",
        "[desktop]\nunknown = true",
        "[broken",
    ] {
        assert!(parse_config(&STANDARD.encode(source)).is_err(), "{source}");
    }
    for encoded in [
        "!bad!".into(),
        STANDARD.encode([0xff]),
        "x".repeat(MAX_SOURCE_BYTES * 2),
    ] {
        assert!(parse_config(&encoded).is_err());
    }
}

#[test]
fn administrator_overrides_project_and_user_without_mutating_raw_layers() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir(temp.path().join(".lime")).unwrap();
    std::fs::write(
        temp.path().join(".lime/config.toml"),
        "model_verbosity='medium'\nmodel_reasoning_summary='detailed'\n",
    )
    .unwrap();
    let user: Config = serde_json::from_value(json!({"model_verbosity":"low", "projects":{temp.path().to_str().unwrap():{"trust_level":"trusted"}}})).unwrap();
    let stack = ConfigLayers::from_user_with_managed(
        user,
        Some(temp.path()),
        Some(config("model_verbosity = 'high'")),
    )
    .unwrap();
    assert_eq!(stack.user.model_verbosity, Some(ModelVerbosity::Low));
    assert_eq!(stack.projects[0].config["model_verbosity"], "medium");
    assert_eq!(stack.effective.model_verbosity, Some(ModelVerbosity::High));
    assert_eq!(
        stack.effective.model_reasoning_summary,
        crate::config::ReasoningSummary::Detailed
    );
    let paths = config("[desktop]\nenabled-reasoning-efforts = []");
    for path in [
        vec!["desktop"],
        vec!["desktop", "enabled-reasoning-efforts"],
        vec!["desktop", "enabled-reasoning-efforts", "0"],
    ] {
        assert!(paths.contains_path(&path.iter().map(|v| v.to_string()).collect::<Vec<_>>()));
    }
    assert!(!paths.contains_path(&["desktop".into(), "other".into()]));
}

#[test]
fn requirements_precedence_and_legacy_constraints_share_the_same_source() {
    let system = ConfigRequirements::parse(
        "allowed_sandbox_modes=['danger-full-access']\nallowed_web_search_modes=['cached']",
    )
    .unwrap();
    let managed = config("approval_policy='never'\nsandbox_mode='read-only'");
    let combined = compose_requirements(Some(system.clone()), Some(&managed), None)
        .unwrap()
        .unwrap();
    assert_eq!(
        combined.allowed_approval_policies,
        Some(vec![ApprovalPolicy::Never])
    );
    assert_eq!(
        combined.allowed_sandbox_modes,
        Some(vec![SandboxMode::ReadOnly])
    );
    assert_eq!(
        combined.allowed_web_search_modes,
        system.allowed_web_search_modes
    );
    let explicit = ConfigRequirements::parse("allowed_approval_policies=['on-request']").unwrap();
    let combined = compose_requirements(Some(system), Some(&managed), Some(explicit))
        .unwrap()
        .unwrap();
    assert_eq!(
        combined.allowed_approval_policies,
        Some(vec![ApprovalPolicy::OnRequest])
    );
    assert!(combined
        .check_sandbox(SandboxMode::DangerFullAccess)
        .is_err());
    assert_eq!(compose_requirements(None, None, None).unwrap(), None);
}

#[cfg(target_os = "macos")]
#[test]
fn native_reader_uses_lime_domain_and_an_unmanaged_key_has_no_authority() {
    assert_eq!(PREFERENCES_DOMAIN, "com.limecloud.lime");
    assert_eq!(
        macos::read("__settings_managed_missing_test__").unwrap(),
        None
    );
}
