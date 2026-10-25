use super::*;
use crate::config::{Config as ConfigToml, ConfigManager};

#[test]
fn computer_use_config_round_trips() {
    let config: ConfigToml = toml_edit::de::from_str(
        r#"
[computer_use]
default_app_access = "deny"

[computer_use.macos.bundle_ids]
"com.apple.Safari" = "allow"

[computer_use.windows.aumids]
"Microsoft.Paint_8wekyb3d8bbwe!App" = "deny"

[[computer_use.windows.exes]]
publisher_name = "CN=Google LLC"
product_name = "Google Chrome"
binary_name = "chrome.exe"
access = "allow"
"#,
    )
    .expect("computer use config should deserialize");

    let expected = ComputerUseConfigToml {
        default_app_access: Some(AllowDenyRequirementToml::Deny),
        macos: Some(ComputerUseMacosConfigToml {
            bundle_ids: Some(BTreeMap::from([(
                "com.apple.Safari".to_string(),
                AllowDenyRequirementToml::Allow,
            )])),
        }),
        windows: Some(ComputerUseWindowsConfigToml {
            aumids: Some(BTreeMap::from([(
                "Microsoft.Paint_8wekyb3d8bbwe!App".to_string(),
                AllowDenyRequirementToml::Deny,
            )])),
            exes: Some(vec![ComputerUseWindowsExeConfigToml {
                publisher_name: "CN=Google LLC".to_string(),
                product_name: "Google Chrome".to_string(),
                binary_name: Some("chrome.exe".to_string()),
                access: AllowDenyRequirementToml::Allow,
            }]),
        }),
    };
    assert_eq!(config.computer_use, Some(expected.clone()));

    let serialized =
        toml_edit::ser::to_string(&config).expect("computer use config should serialize");
    let reparsed: ConfigToml = toml_edit::de::from_str(&serialized)
        .expect("serialized computer use config should deserialize");
    assert_eq!(reparsed.computer_use, Some(expected));
}

#[test]
fn computer_use_persistence_preserves_lime_provider_and_theme_settings() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.yaml");
    let mut config = ConfigToml::default();
    config.default_provider = "custom-provider".into();
    config.computer_use = Some(ComputerUseConfigToml {
        default_app_access: Some(AllowDenyRequirementToml::Deny),
        macos: Some(ComputerUseMacosConfigToml {
            bundle_ids: Some(BTreeMap::from([(
                "com.example.Editor".into(),
                AllowDenyRequirementToml::Allow,
            )])),
        }),
        windows: None,
    });
    let original = config.clone();
    ConfigManager::with_config(config, path.clone())
        .save()
        .unwrap();
    let restored = ConfigManager::load(&path).unwrap();
    assert_eq!(restored.config(), &original);
}

#[test]
fn computer_use_rejects_unknown_or_malformed_policy_before_persistence() {
    use serde_json::json;
    for value in [
        json!(true),
        json!({"default_app_access": "ask"}),
        json!({"default_app_access": true}),
        json!({"always_allow": true}),
        json!({"macos": {"bundle_id": {"com.example.Editor": "allow"}}}),
        json!({"macos": {"bundle_ids": {"com.example.Editor": "ask"}}}),
        json!({"windows": {"exe": []}}),
        json!({"windows": {"aumids": {"Example!App": false}}}),
        json!({"windows": {"exes": {}}}),
        json!({"windows": {"exes": [{"publisher_name":"Example","product_name":"Editor","access":"allow","always_allow":true}]}}),
        json!({"windows": {"exes": [{"product_name":"Editor","access":"allow"}]}}),
    ] {
        assert!(serde_json::from_value::<ConfigToml>(json!({"computer_use": value})).is_err());
    }
}

#[test]
fn project_cannot_grant_computer_use_access() {
    let mut effective = serde_json::to_value(ConfigToml::default()).unwrap();
    crate::config::layers::merge_defaults(
        &mut effective,
        &serde_json::json!({
            "computer_use": {"default_app_access": "allow"}
        }),
    )
    .unwrap();
    assert!(effective.get("computer_use").is_none());
}
