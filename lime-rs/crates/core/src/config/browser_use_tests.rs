use super::*;
use crate::config::{BrowserConfig, Config, ConfigManager};
use serde_json::json;

#[test]
fn browser_use_origin_policies_round_trip() {
    let config: Config = serde_json::from_value(json!({
        "browser_use": {
            "allow_history_access": true,
            "default_origin_policy": {"access":"deny", "downloads":"allow", "uploads":"deny", "full_cdp_access":"allow"},
            "origins": {"https://example.com": {"access":"allow", "downloads":"deny", "uploads":"allow", "full_cdp_access":"deny"}}
        }
    })).unwrap();
    let expected = BrowserUseConfigToml {
        allow_history_access: Some(true),
        default_origin_policy: Some(BrowserUseOriginPolicyConfigToml {
            access: Some(AllowDenyRequirementToml::Deny),
            downloads: Some(AllowDenyRequirementToml::Allow),
            uploads: Some(AllowDenyRequirementToml::Deny),
            full_cdp_access: Some(AllowDenyRequirementToml::Allow),
        }),
        origins: Some(BTreeMap::from([(
            "https://example.com".into(),
            BrowserUseOriginPolicyConfigToml {
                access: Some(AllowDenyRequirementToml::Allow),
                downloads: Some(AllowDenyRequirementToml::Deny),
                uploads: Some(AllowDenyRequirementToml::Allow),
                full_cdp_access: Some(AllowDenyRequirementToml::Deny),
            },
        )])),
    };
    assert_eq!(config.browser_use, Some(expected.clone()));
    let yaml = serde_yaml::to_string(&config).unwrap();
    assert_eq!(
        serde_yaml::from_str::<Config>(&yaml).unwrap().browser_use,
        Some(expected)
    );
}

#[test]
fn browser_use_and_desktop_preferences_survive_restart_independently() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.yaml");
    let config: Config = serde_json::from_value(json!({
        "browser_use":{"allow_history_access":false,"origins":{"*.example.com":{"access":"deny"}}},
        "browser":{"iabHistoryApprovalMode":"neverAsk","approvalMode":"alwaysAsk","allowedOrigins":["https://EXAMPLE.COM/"],"fullCdpAccessEnabled":true}
    })).unwrap();
    ConfigManager::with_config(config.clone(), path.clone())
        .save()
        .unwrap();
    let restored = ConfigManager::load(&path).unwrap();
    assert_eq!(restored.config().browser_use, config.browser_use);
    assert_eq!(restored.config().browser, config.browser);
    assert_eq!(
        restored.config().browser.allowed_origins,
        ["https://example.com"]
    );
    let json = serde_json::to_value(restored.config()).unwrap();
    assert!(json["browser"].get("agent_permissions").is_none());
    assert!(json["browser"].get("history_access").is_none());
}

#[test]
fn browser_use_rejects_corrupt_or_unknown_policy() {
    for value in [
        json!({"default_origin_policy":{"access":"ask"}}),
        json!({"allow_history_access":"true"}),
        json!({"history_access":true}),
        json!({"default_origin_policy":{"download":"allow"}}),
        json!({"origins":{"https://user:secret@example.com":{"access":"allow"}}}),
        json!({"origins":{"example.com/private":{"access":"allow"}}}),
    ] {
        assert!(serde_json::from_value::<Config>(json!({"browser_use":value})).is_err());
    }
    for value in [
        json!({"history_access":"neverAsk"}),
        json!({"agent_permissions":{}}),
        json!({"approvalMode":"disabled"}),
        json!({"allowedOrigins":["https://example.com/private"]}),
    ] {
        assert!(serde_json::from_value::<BrowserConfig>(value).is_err());
    }
}
