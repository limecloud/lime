use super::*;
use tempfile::TempDir;

#[test]
fn missing_policy_is_distinct_from_an_empty_present_policy() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("requirements.toml");
    assert_eq!(ConfigRequirements::read(&path).unwrap(), None);
    std::fs::write(&path, "").unwrap();
    assert_eq!(
        ConfigRequirements::read(&path).unwrap(),
        Some(ConfigRequirements::default())
    );
}

#[test]
fn malformed_and_unsupported_policies_fail_closed() {
    for source in [
        "allowed_approval_policies = []",
        "allowed_sandbox_modes = []",
        "allowed_sandbox_modes = ['full']",
        "allowed_web_search_modes = ['auto']",
        "allowed_approval_policies = true",
        "unknown_policy = true",
    ] {
        assert!(ConfigRequirements::parse(source).is_err(), "{source}");
    }
}

#[test]
fn restrictions_reject_explicit_values_and_preserve_disabled_search() {
    let requirements = ConfigRequirements::parse(
        "allowed_approval_policies = ['on-request']\nallowed_sandbox_modes = ['read-only']\nallowed_web_search_modes = ['cached']"
    ).unwrap();
    assert!(requirements.check_approval(ApprovalPolicy::Never).is_err());
    assert!(requirements
        .check_sandbox(SandboxMode::DangerFullAccess)
        .is_err());
    assert!(requirements.check_web_search(WebSearchMode::Live).is_err());
    assert!(requirements
        .check_web_search(WebSearchMode::Disabled)
        .is_ok());
    assert!(requirements.check_web_search(WebSearchMode::Cached).is_ok());
    let mut config = Config {
        approval_policy: ApprovalPolicy::Never,
        sandbox_mode: SandboxMode::DangerFullAccess,
        web_search: Some(WebSearchMode::Live),
        ..Config::default()
    };
    requirements.constrain_defaults(&mut config);
    assert_eq!(config.approval_policy, ApprovalPolicy::OnRequest);
    assert_eq!(config.sandbox_mode, SandboxMode::ReadOnly);
    assert_eq!(config.web_search, Some(WebSearchMode::Disabled));
}

#[test]
fn reread_observes_replacement_and_invalid_policy_without_stale_cache() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("requirements.toml");
    std::fs::write(&path, "allowed_sandbox_modes = ['workspace-write']").unwrap();
    assert!(ConfigRequirements::read(&path)
        .unwrap()
        .unwrap()
        .check_sandbox(SandboxMode::WorkspaceWrite)
        .is_ok());
    std::fs::write(&path, "allowed_sandbox_modes = ['read-only']").unwrap();
    assert!(ConfigRequirements::read(&path)
        .unwrap()
        .unwrap()
        .check_sandbox(SandboxMode::WorkspaceWrite)
        .is_err());
    std::fs::write(&path, "allowed_sandbox_modes = []").unwrap();
    assert!(ConfigRequirements::read(&path).is_err());
}
