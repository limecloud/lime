//! Desktop 偏好；与其它 Surface 共享 App Server 用户配置层。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComposerEnterBehavior {
    Enter,
    CmdIfMultiline,
    CmdAlways,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfirmBeforeClose {
    Never,
    KeyboardOnly,
    Always,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LinkOpenTarget {
    InAppBrowser,
    ExternalBrowser,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalBrowserLinkShortcut {
    Unassigned,
    #[default]
    Primary,
    Alt,
    PrimaryShift,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
    Persistent,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct DesktopConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirm_before_close: Option<ConfirmBeforeClose>,
    #[serde(
        rename = "preventSleepWhileRunning",
        skip_serializing_if = "Option::is_none"
    )]
    pub prevent_sleep_while_running: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac_menu_bar_enabled: Option<bool>,
    #[serde(
        rename = "composerEnterBehavior",
        skip_serializing_if = "Option::is_none"
    )]
    pub composer_enter_behavior: Option<ComposerEnterBehavior>,
    /// 缺项继承命令默认值，空数组显式解除绑定。
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "deserialize_shortcuts"
    )]
    pub keyboard_shortcuts: BTreeMap<String, Vec<String>>,
    // 空值保留未显式配置的身份，不能被schema默认值覆盖。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_link_in_target_preference: Option<LinkOpenTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_local_url_in_target_preference: Option<LinkOpenTarget>,
    pub external_browser_link_shortcut: ExternalBrowserLinkShortcut,
    /// 未设置时使用界面默认值；这里只控制模型控件，不修改模型能力。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled_reasoning_efforts: Option<Vec<ReasoningEffort>>,
}

fn deserialize_shortcuts<'de, D>(deserializer: D) -> Result<BTreeMap<String, Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let shortcuts = BTreeMap::<String, Vec<String>>::deserialize(deserializer)?;
    for (id, bindings) in &shortcuts {
        if id.trim().is_empty() || bindings.iter().any(|binding| !valid_binding(binding)) {
            return Err(serde::de::Error::custom(
                "Invalid desktop keyboard shortcut",
            ));
        }
    }
    Ok(shortcuts)
}

fn valid_binding(binding: &str) -> bool {
    let compact = binding
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace(" +", "+")
        .replace("+ ", "+");
    !compact.is_empty() && compact.split_whitespace().all(valid_stroke)
}

fn valid_stroke(binding: &str) -> bool {
    let mut parts: Vec<_> = binding.split('+').map(str::trim).collect();
    let Some(key) = parts.pop() else {
        return false;
    };
    let key = key.to_ascii_lowercase();
    let named = [
        "space",
        "escape",
        "enter",
        "tab",
        "backspace",
        "delete",
        "insert",
        "home",
        "end",
        "pageup",
        "pagedown",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "plus",
    ];
    let function = key
        .strip_prefix('f')
        .and_then(|number| {
            number
                .parse::<u8>()
                .ok()
                .filter(|value| value.to_string() == number)
        })
        .is_some_and(|number| (1..=24).contains(&number));
    if !(key.len() == 1 && key.as_bytes()[0].is_ascii_graphic() && key != "+"
        || named.contains(&key.as_str())
        || function)
    {
        return false;
    }
    let mut seen = std::collections::BTreeSet::new();
    for modifier in parts {
        let modifier = modifier.to_ascii_lowercase();
        if !["commandorcontrol", "command", "control", "alt", "shift"].contains(&modifier.as_str())
            || !seen.insert(modifier)
        {
            return false;
        }
    }
    !(seen.contains("commandorcontrol") && (seen.contains("command") || seen.contains("control")))
}

impl DesktopConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn close_confirmation_preserves_unset_and_round_trips_three_modes() {
        let default: DesktopConfig = serde_json::from_value(json!({})).unwrap();
        assert!(default.confirm_before_close.is_none());
        assert!(serde_json::to_value(default)
            .unwrap()
            .get("confirm-before-close")
            .is_none());
        for mode in ["never", "keyboardOnly", "always"] {
            let config: DesktopConfig =
                serde_json::from_value(json!({"confirm-before-close": mode})).unwrap();
            let restored: DesktopConfig =
                serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
            assert_eq!(config, restored);
            assert_eq!(
                serde_json::to_value(restored).unwrap()["confirm-before-close"],
                mode
            );
        }
        for invalid in [
            json!("keyboard-only"),
            json!(true),
            json!(1),
            json!([]),
            json!({}),
        ] {
            assert!(serde_json::from_value::<DesktopConfig>(
                json!({"confirm-before-close": invalid})
            )
            .is_err());
        }
    }

    #[test]
    fn prevent_sleep_preserves_unset_and_round_trips_both_states() {
        let default: DesktopConfig = serde_json::from_value(json!({})).unwrap();
        assert!(default.prevent_sleep_while_running.is_none());
        assert!(serde_json::to_value(default)
            .unwrap()
            .get("preventSleepWhileRunning")
            .is_none());
        for enabled in [true, false] {
            let config: DesktopConfig =
                serde_json::from_value(json!({"preventSleepWhileRunning": enabled})).unwrap();
            let restored: DesktopConfig =
                serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
            assert_eq!(config, restored);
            assert_eq!(restored.prevent_sleep_while_running, Some(enabled));
        }
        for invalid in [json!("false"), json!(0), json!([]), json!({})] {
            assert!(serde_json::from_value::<DesktopConfig>(
                json!({"preventSleepWhileRunning": invalid})
            )
            .is_err());
        }
    }

    #[test]
    fn menu_bar_preference_preserves_unset_and_round_trips_both_states() {
        let default: DesktopConfig = serde_json::from_value(json!({})).unwrap();
        assert!(default.mac_menu_bar_enabled.is_none());
        assert!(serde_json::to_value(default)
            .unwrap()
            .get("mac-menu-bar-enabled")
            .is_none());
        for enabled in [true, false] {
            let config: DesktopConfig =
                serde_json::from_value(json!({"mac-menu-bar-enabled": enabled})).unwrap();
            let restored: DesktopConfig =
                serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
            assert_eq!(restored.mac_menu_bar_enabled, Some(enabled));
            assert_eq!(config, restored);
        }
        for invalid in [json!("false"), json!(0), json!([]), json!({})] {
            assert!(serde_json::from_value::<DesktopConfig>(
                json!({"mac-menu-bar-enabled": invalid})
            )
            .is_err());
        }
    }

    #[test]
    fn composer_enter_behavior_preserves_unset_and_round_trips_three_modes() {
        let default: DesktopConfig = serde_json::from_value(json!({})).unwrap();
        assert!(default.composer_enter_behavior.is_none());
        assert!(serde_json::to_value(default)
            .unwrap()
            .get("composerEnterBehavior")
            .is_none());
        for mode in ["enter", "cmdIfMultiline", "cmdAlways"] {
            let config: DesktopConfig =
                serde_json::from_value(json!({"composerEnterBehavior": mode})).unwrap();
            let restored: DesktopConfig =
                serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
            assert_eq!(config, restored);
            assert_eq!(
                serde_json::to_value(restored).unwrap()["composerEnterBehavior"],
                mode
            );
        }
        for invalid in [
            json!("newline"),
            json!("unknown"),
            json!(true),
            json!(1),
            json!([]),
        ] {
            assert!(serde_json::from_value::<DesktopConfig>(
                json!({"composerEnterBehavior": invalid})
            )
            .is_err());
        }
    }

    #[test]
    fn desktop_link_preferences_preserve_unconfigured_identity() {
        let config: DesktopConfig = serde_json::from_value(json!({})).unwrap();
        assert!(config.is_default());
        assert_eq!(config.open_link_in_target_preference, None);
        assert_eq!(config.open_local_url_in_target_preference, None);
        assert_eq!(
            config.external_browser_link_shortcut,
            ExternalBrowserLinkShortcut::Primary
        );
        assert_eq!(
            serde_json::to_value(config).unwrap(),
            json!({
                "external-browser-link-shortcut": "primary"
            })
        );
    }

    #[test]
    fn desktop_link_preferences_round_trip_without_coupling_destinations() {
        for web in ["in-app-browser", "external-browser"] {
            for local in ["in-app-browser", "external-browser"] {
                for shortcut in ["unassigned", "primary", "alt", "primary-shift"] {
                    let value = json!({
                        "open-link-in-target-preference": web,
                        "open-local-url-in-target-preference": local,
                        "external-browser-link-shortcut": shortcut
                    });
                    let config: DesktopConfig = serde_json::from_value(value.clone()).unwrap();
                    let yaml = serde_yaml::to_string(&config).unwrap();
                    let restored: DesktopConfig = serde_yaml::from_str(&yaml).unwrap();
                    assert_eq!(serde_json::to_value(restored).unwrap(), value);
                }
            }
        }
    }

    #[test]
    fn desktop_link_preferences_reject_unknown_or_invalid_settings() {
        for value in [
            json!({"open-link-in-target-preference": "browser"}),
            json!({"open-local-url-in-target-preference": true}),
            json!({"external-browser-link-shortcut": "control"}),
            json!({"external-browser-link-shortcut": null}),
            json!({"unknown-link-preference": "in-app-browser"}),
        ] {
            assert!(
                serde_json::from_value::<DesktopConfig>(value.clone()).is_err(),
                "{value}"
            );
        }
    }

    #[test]
    fn keyboard_shortcuts_round_trip_preserves_unbound_and_defaults() {
        let value = json!({"keyboard-shortcuts": {
            "searchSettings": ["CommandOrControl+Shift+F", "Alt+F2", "G G", "Control+K Control+S"],
            "showKeyboardShortcuts": []
        }});
        let config: DesktopConfig = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            config.keyboard_shortcuts["showKeyboardShortcuts"],
            Vec::<String>::new()
        );
        assert!(!config.keyboard_shortcuts.contains_key("saveDocument"));
        let restored: DesktopConfig =
            serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
        assert_eq!(config, restored);
        assert_eq!(
            serde_json::to_value(restored).unwrap()["keyboard-shortcuts"],
            value["keyboard-shortcuts"]
        );
    }

    #[test]
    fn keyboard_shortcuts_reject_invalid_shapes_and_key_combinations() {
        for value in [
            json!({"": ["Control+K"]}),
            json!({"search": null}),
            json!({"search": [""]}),
            json!({"search": ["Hyper+K"]}),
            json!({"search": ["Control+Control+K"]}),
            json!({"search": ["CommandOrControl+Control+K"]}),
            json!({"search": ["F25"]}),
            json!({"search": ["F01"]}),
            json!({"search": ["Control+K Hyper+S"]}),
            json!({"search": ["G Control"]}),
        ] {
            assert!(
                serde_json::from_value::<DesktopConfig>(json!({"keyboard-shortcuts": value}))
                    .is_err()
            );
        }
    }

    #[test]
    fn keyboard_shortcuts_validate_every_stroke_without_using_tui_chord_limits() {
        for binding in ["G G", "G Control+S", "Control + K Control + S", "A B C"] {
            assert!(valid_binding(binding), "{binding}");
        }
        for binding in ["", "G Hyper+S", "G Control+Control+S", "G Control", "G +"] {
            assert!(!valid_binding(binding), "{binding}");
        }
    }

    #[test]
    fn reasoning_preferences_preserve_unconfigured_and_explicit_empty() {
        for value in [
            json!([]),
            json!(["low", "medium", "high", "xhigh", "ultra", "persistent"]),
            json!(["none", "minimal", "max"]),
        ] {
            let config: DesktopConfig = serde_json::from_value(json!({
                "enabled-reasoning-efforts": value
            }))
            .unwrap();
            let restored: DesktopConfig =
                serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
            assert_eq!(config, restored);
            assert_eq!(
                serde_json::to_value(restored).unwrap()["enabled-reasoning-efforts"],
                value
            );
        }
        let default = DesktopConfig::default();
        assert!(default.enabled_reasoning_efforts.is_none());
        assert!(serde_json::to_value(default)
            .unwrap()
            .get("enabled-reasoning-efforts")
            .is_none());
        for invalid in [json!(true), json!("ultra"), json!(["unknown"]), json!([1])] {
            assert!(serde_json::from_value::<DesktopConfig>(json!({
                "enabled-reasoning-efforts": invalid
            }))
            .is_err());
        }
    }
}
