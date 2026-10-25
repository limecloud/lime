//! Application destinations use managed precedence, independently of browser grants.

use super::*;
use crate::config::managed::compose_requirements;
use crate::config::requirements::ConfigRequirements;

fn parse(source: &str) -> ConfigRequirements {
    ConfigRequirements::parse(source).expect("valid application requirements")
}

#[test]
fn application_network_defaults_to_enabled_and_normalizes_domains() {
    assert!(parse("[application]").is_empty());
    let requirements = parse("[application.network]");
    assert!(!requirements.is_empty());
    let network = requirements.application.unwrap().network.unwrap();
    assert!(network.enabled);
    assert!(network.domains.is_empty());
    assert_eq!(
        parse("[application.network.domains]\n'EXAMPLE.com.' = 'deny'").application,
        parse("[application.network.domains]\n'example.com' = 'deny'").application,
    );
}

#[test]
fn application_network_uses_regular_toml_precedence() {
    let installation = "[application.network]\nenabled = false\n[application.network.domains]\n'shared.example' = 'deny'\n'installed.example' = 'allow'";
    for (high, enabled, shared) in [
        (
            "[application.network.domains]\n'SHARED.example.' = 'allow'",
            false,
            NetworkDomainPermissionToml::Allow,
        ),
        (
            "[application.network]\nenabled = true",
            true,
            NetworkDomainPermissionToml::Deny,
        ),
        (
            "[application.network]",
            false,
            NetworkDomainPermissionToml::Deny,
        ),
        ("[application]", false, NetworkDomainPermissionToml::Deny),
        ("", false, NetworkDomainPermissionToml::Deny),
    ] {
        let result = compose_requirements(Some(parse(installation)), None, Some(parse(high)))
            .unwrap()
            .unwrap();
        let network = result.application.unwrap().network.unwrap();
        assert_eq!(network.enabled, enabled, "high: {high}");
        assert_eq!(network.domains["shared.example"], shared, "high: {high}");
        assert_eq!(
            network.domains["installed.example"],
            NetworkDomainPermissionToml::Allow
        );
    }
}

#[test]
fn invalid_application_policy_cannot_be_hidden_by_a_higher_layer() {
    for source in [
        "[application.network]\nenabled = 'true'",
        "[application.network]\nallowed_domains = ['example.com']",
        "[application.network.domains]\n'example.com' = 'prompt'",
        "[application.network.domains]\n'*.example.com' = 'allow'",
        "[application.network.domains]\n'https://example.com' = 'allow'",
        "[application.network.domains]\n'example.com:443' = 'allow'",
        "[application.network.domains]\n'example..com' = 'allow'",
        "[application.network.domains]\n' example.com' = 'allow'",
        "[application.network.domains]\n'例子.com' = 'allow'",
        "[application.network.domains]\n'-example.com' = 'allow'",
        "[application.network.domains]\n'example-.com' = 'allow'",
        "[application.network.domains]\n'EXAMPLE.com' = 'allow'\n'example.com.' = 'deny'",
        "[application]\nunknown = false",
    ] {
        assert!(ConfigRequirements::parse(source).is_err(), "{source}");
    }
}

#[test]
fn application_storage_is_explicitly_rejected_until_its_owner_is_connected() {
    for source in [
        "[application.storage]",
        "[application.storage]\ndefault_project_parent = '/tmp/projects'",
        "[application.storage]\nprojectless_workspace_root = 'relative'",
    ] {
        assert!(ConfigRequirements::parse(source).is_err(), "{source}");
    }
}
