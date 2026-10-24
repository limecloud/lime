use super::InAppBrowserRequirementsToml;
use crate::config::managed::compose_requirements;
use crate::config::requirements::ConfigRequirements;
use crate::config::{ConfigError, SandboxMode};

const EMPTY: &str = "[in_app_browser]";
const ALLOW: &str = "[in_app_browser]\nallow_external_browser_settings_import = true";
const DENY: &str = "[in_app_browser]\nallow_external_browser_settings_import = false";

fn parse(contents: &str) -> ConfigRequirements {
    ConfigRequirements::parse(contents).expect("parse requirements")
}

fn compose(low: &str, high: &str) -> Result<Option<ConfigRequirements>, ConfigError> {
    compose_requirements(
        Some(ConfigRequirements::parse(low)?),
        None,
        Some(ConfigRequirements::parse(high)?),
    )
}

#[test]
fn import_requirement_preserves_unset_and_explicit_values() {
    for (contents, expected_table) in [
        ("", None),
        (EMPTY, Some(None)),
        (ALLOW, Some(Some(true))),
        (DENY, Some(Some(false))),
    ] {
        let requirements = parse(contents);
        assert_eq!(
            requirements,
            ConfigRequirements {
                in_app_browser: expected_table.map(|value| InAppBrowserRequirementsToml {
                    allow_external_browser_settings_import: value,
                }),
                ..Default::default()
            },
        );
        let configured = requirements
            .in_app_browser
            .as_ref()
            .and_then(|policy| policy.allow_external_browser_settings_import);
        assert_eq!(requirements.is_empty(), configured.is_none());
    }
}

#[test]
fn import_requirement_uses_normal_managed_toml_precedence() {
    for (low, high, expected) in [
        ("", EMPTY, None),
        (DENY, "", Some(DENY)),
        (DENY, EMPTY, Some(DENY)),
        (DENY, ALLOW, Some(ALLOW)),
        (ALLOW, DENY, Some(DENY)),
        (EMPTY, ALLOW, Some(ALLOW)),
    ] {
        assert_eq!(compose(low, high).unwrap(), expected.map(parse));
    }

    let low = format!("allowed_sandbox_modes = ['read-only']\n{DENY}");
    let combined = compose(&low, EMPTY).unwrap().unwrap();
    assert_eq!(
        combined.allowed_sandbox_modes,
        Some(vec![SandboxMode::ReadOnly])
    );
    assert_eq!(combined.in_app_browser, parse(DENY).in_app_browser);

    let combined = compose("allowed_sandbox_modes = ['read-only']", EMPTY)
        .unwrap()
        .unwrap();
    assert_eq!(combined.in_app_browser, parse(EMPTY).in_app_browser);
}

#[test]
fn invalid_import_requirement_is_rejected_even_when_overridden() {
    for invalid in ["\"false\"", "1", "[]", "{}"] {
        let contents =
            format!("[in_app_browser]\nallow_external_browser_settings_import = {invalid}");
        let error = compose(&contents, ALLOW)
            .expect_err("invalid managed layers must not be silently ignored");
        assert!(
            error
                .to_string()
                .contains("allow_external_browser_settings_import"),
            "{error}",
        );
    }
    for contents in ["in_app_browser = false", "in_app_browser = []"] {
        assert!(ConfigRequirements::parse(contents).is_err(), "{contents}");
    }
}
