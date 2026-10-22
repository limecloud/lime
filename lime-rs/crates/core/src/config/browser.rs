//! 内置浏览器偏好；Host 与 Agent 使用同一 App Server 配置层。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserHistoryAccess {
    #[default]
    AlwaysAsk,
    NeverAsk,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserAnnotationScreenshot {
    #[default]
    Always,
    Necessary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserPermission {
    #[default]
    Ask,
    Allow,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrowserPermissions {
    pub browse: BrowserPermission,
    pub download: BrowserPermission,
    pub upload: BrowserPermission,
    pub debug: BrowserPermission,
    pub site_tools: BrowserPermission,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserSitePermissions {
    #[serde(deserialize_with = "deserialize_site_pattern")]
    pub pattern: String,
    pub permissions: BrowserPermissions,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrowserAgentPermissions {
    pub default: BrowserPermissions,
    #[serde(deserialize_with = "deserialize_site_permissions")]
    pub sites: Vec<BrowserSitePermissions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrowserConfig {
    pub enabled: bool,
    pub show_full_url: bool,
    pub annotation_screenshot: BrowserAnnotationScreenshot,
    pub download_directory: Option<String>,
    pub ask_download_location: bool,
    pub history_access: BrowserHistoryAccess,
    pub site_tools_enabled: bool,
    pub full_cdp_access: bool,
    pub agent_permissions: BrowserAgentPermissions,
}

impl Default for BrowserConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            show_full_url: false,
            annotation_screenshot: BrowserAnnotationScreenshot::Always,
            download_directory: None,
            ask_download_location: false,
            history_access: BrowserHistoryAccess::AlwaysAsk,
            site_tools_enabled: true,
            full_cdp_access: false,
            agent_permissions: BrowserAgentPermissions::default(),
        }
    }
}

impl BrowserConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

fn deserialize_site_pattern<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?.trim().to_lowercase();
    if value.is_empty() || value.chars().any(char::is_whitespace) || value.contains(['?', '#', '@'])
    {
        return Err(serde::de::Error::custom("invalid browser site pattern"));
    }
    let has_scheme = value.starts_with("http://") || value.starts_with("https://");
    let host_part = value
        .split_once("://")
        .map_or(value.as_str(), |(_, host)| host);
    let wildcard = host_part.starts_with("*.");
    let probe = if wildcard {
        value.replacen("*.", "wildcard.", 1)
    } else {
        value.clone()
    };
    let url = url::Url::parse(&if has_scheme {
        probe
    } else {
        format!("https://{probe}")
    })
    .map_err(|_| serde::de::Error::custom("invalid browser site pattern"))?;
    let host = url
        .host_str()
        .ok_or_else(|| serde::de::Error::custom("invalid browser site pattern"))?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "/" | "/*")
        || host.contains('*')
        || (!host.contains('.') && !host.contains(':') && host != "localhost")
        || (wildcard && host == "wildcard.localhost")
    {
        return Err(serde::de::Error::custom("invalid browser site pattern"));
    }
    let normalized_host = if wildcard {
        host.replacen("wildcard.", "*.", 1)
    } else {
        host.to_string()
    };
    let explicit_port = value
        .trim_end_matches("/*")
        .trim_end_matches('/')
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok());
    let port = if has_scheme {
        url.port()
    } else {
        explicit_port
    };
    let authority = port.map_or(normalized_host.clone(), |port| {
        format!("{normalized_host}:{port}")
    });
    Ok(if has_scheme {
        format!("{}://{authority}", url.scheme())
    } else {
        authority
    })
}

fn deserialize_site_permissions<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<BrowserSitePermissions>, D::Error> {
    let sites = Vec::<BrowserSitePermissions>::deserialize(deserializer)?;
    let mut patterns = std::collections::BTreeSet::new();
    if sites
        .iter()
        .any(|site| !patterns.insert(site.pattern.clone()))
    {
        return Err(serde::de::Error::custom("duplicate browser site pattern"));
    }
    Ok(sites)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn browser_defaults_do_not_grant_sensitive_agent_access() {
        let config: BrowserConfig = serde_json::from_value(json!({})).unwrap();
        assert!(config.enabled);
        assert!(config.site_tools_enabled);
        assert!(!config.full_cdp_access);
        assert_eq!(config.history_access, BrowserHistoryAccess::AlwaysAsk);
        assert_eq!(
            config.agent_permissions.default.download,
            BrowserPermission::Ask
        );
        assert_eq!(config.download_directory, None);
        assert!(config.is_default());
    }

    #[test]
    fn browser_preferences_round_trip_through_user_yaml() {
        let config: BrowserConfig = serde_json::from_value(json!({
            "show_full_url": true,
            "history_access": "disabled",
            "annotation_screenshot": "necessary",
            "ask_download_location": true,
            "download_directory": "/downloads",
            "agent_permissions": {
                "default": {"browse": "deny"},
                "sites": [{"pattern": "https://example.com", "permissions": {"browse": "allow"}}]
            }
        }))
        .unwrap();
        let yaml = serde_yaml::to_string(&config).unwrap();
        assert_eq!(
            serde_yaml::from_str::<BrowserConfig>(&yaml).unwrap(),
            config
        );
        assert_eq!(
            config.agent_permissions.default.download,
            BrowserPermission::Ask
        );
    }

    #[test]
    fn browser_preferences_reject_unknown_or_invalid_values() {
        for value in [
            json!({"enabled": "true"}),
            json!({"history_access": "allow"}),
            json!({"annotation_screenshot": "never"}),
            json!({"agent_permissions": {"default": {"download": "always"}}}),
            json!({"unsafe_cdp": true}),
            json!({"agent_permissions": {"sites": [{"pattern": "https://foo*.example.com", "permissions": {}}]}}),
            json!({"agent_permissions": {"sites": [{"pattern": "https://user:secret@example.com", "permissions": {}}]}}),
            json!({"agent_permissions": {"sites": [{"pattern": "https://example.com/private", "permissions": {}}]}}),
            json!({"agent_permissions": {"sites": [{"pattern": "https://example.com", "permissions": {}}, {"pattern": "HTTPS://EXAMPLE.COM/", "permissions": {}}]}}),
        ] {
            assert!(serde_json::from_value::<BrowserConfig>(value).is_err());
        }
    }

    #[test]
    fn browser_site_patterns_preserve_explicit_ports_and_ipv6() {
        for (pattern, expected) in [
            ("example.com:443", "example.com:443"),
            ("EXAMPLE.COM:80/", "example.com:80"),
            ("http://[::1]:3000", "http://[::1]:3000"),
            ("https://*.EXAMPLE.COM/", "https://*.example.com"),
        ] {
            let site: BrowserSitePermissions = serde_json::from_value(json!({
                "pattern": pattern, "permissions": {}
            }))
            .unwrap();
            assert_eq!(site.pattern, expected);
        }
    }

    #[test]
    fn browser_preferences_survive_the_current_config_manager_disk_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let mut config = crate::config::Config::default();
        config.browser.show_full_url = true;
        config.browser.history_access = BrowserHistoryAccess::Disabled;
        config.browser.agent_permissions.default.download = BrowserPermission::Deny;
        config.browser.download_directory = Some(
            directory
                .path()
                .join("downloads")
                .to_string_lossy()
                .into_owned(),
        );
        crate::config::ConfigManager::with_config(config.clone(), path.clone())
            .save()
            .unwrap();
        let restored = crate::config::ConfigManager::load(&path).unwrap();
        assert_eq!(restored.config().browser, config.browser);
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("history_access: disabled"));
    }
}
