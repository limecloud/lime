use super::*;
use crate::config::{managed::compose_requirements, AllowDenyRequirementToml, RequestHeaderToml};

#[test]
fn browser_requirements_reject_invalid_scope_and_unknown_admin_fields() {
    for source in [
        "[browser_use]\nallow_webmcp = 'false'",
        "[browser_use]\nunknown = true",
        "[browser_use.origins.'https://example.com/path']\naccess = 'deny'",
        "[browser_use.default_origin_policy]\naccess = 'ask'",
        "[browser_use.default_origin_policy]\naccess_approval_lifetime = 'session'",
        "[browser_use.origins.'example.com']\nfull_cdp_acess = 'deny'",
    ] {
        assert!(ConfigRequirements::parse(source).is_err(), "{source}");
    }
}

#[test]
fn browser_policy_composes_per_field_without_erasing_system_restrictions() {
    let low = ConfigRequirements::parse(
        r#"
        allow_browser_and_computer_use = false
        [browser_use]
        allow_history_access = false
        [browser_use.default_origin_policy]
        uploads = 'deny'
        persistent_approval = false
        [browser_use.origins.'*.example.com']
        access = 'deny'
        downloads = 'deny'
    "#,
    )
    .unwrap();
    let high = ConfigRequirements::parse(
        r#"
        [browser_use]
        allow_webmcp = false
        [browser_use.default_origin_policy]
        access_approval_lifetime = 'turn'
        [browser_use.origins.'*.example.com']
        downloads = 'allow'
    "#,
    )
    .unwrap();
    let result = compose_requirements(Some(low), None, Some(high))
        .unwrap()
        .unwrap();
    assert_eq!(result.allow_browser_and_computer_use, Some(false));
    let browser = result.browser_use.unwrap();
    assert_eq!(browser.allow_history_access, Some(false));
    assert_eq!(browser.allow_webmcp, Some(false));
    let default = browser.default_origin_policy.unwrap();
    assert_eq!(default.uploads, Some(AllowDenyRequirementToml::Deny));
    assert_eq!(default.persistent_approval, Some(false));
    assert_eq!(
        default.access_approval_lifetime,
        Some(super::super::BrowserUseAccessApprovalLifetimeToml::Turn)
    );
    let site = &browser.origins.unwrap()["*.example.com"];
    assert_eq!(site.access, Some(AllowDenyRequirementToml::Deny));
    assert_eq!(site.downloads, Some(AllowDenyRequirementToml::Allow));
}

#[test]
fn empty_browser_tables_do_not_establish_an_administrator_constraint() {
    for source in [
        "[browser_use]",
        "[browser_use.default_origin_policy]",
        "[browser_use.origins.'example.com']",
    ] {
        assert!(ConfigRequirements::parse(source).unwrap().is_empty());
    }
    assert!(
        !ConfigRequirements::parse("allow_browser_and_computer_use = true")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn extension_header_debug_cannot_disclose_its_value() {
    let value = RequestHeaderToml {
        name: "Authorization".into(),
        value: "private-enterprise-token".into(),
    };
    let output = format!("{value:?}");
    assert!(output.contains("[REDACTED]"));
    assert!(!output.contains(&value.value));
}
