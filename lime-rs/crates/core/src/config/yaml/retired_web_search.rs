use serde_yaml::Value;

/// 退役 provider 表没有访问模式语义，移除后由现役配置默认值决定搜索权限。
pub(super) fn normalize(value: &mut Value) -> bool {
    let Some(root) = value.as_mapping_mut() else {
        return false;
    };
    let key = Value::String("web_search".to_string());
    let Some(settings) = root.get(&key).and_then(Value::as_mapping) else {
        return false;
    };
    if !settings.iter().all(|(key, value)| match key.as_str() {
        Some("engine" | "provider") => value.is_string(),
        Some("provider_priority") => value
            .as_sequence()
            .is_some_and(|items| items.iter().all(Value::is_string)),
        Some("multi_search") => value.is_mapping(),
        _ => false,
    }) {
        return false;
    }

    root.remove(&key);
    true
}

#[cfg(test)]
mod tests {
    use super::super::{load_config_from_path, ConfigManager};
    use agent_protocol::WebSearchMode;

    #[test]
    fn retired_web_search_table_does_not_block_startup() {
        let config = ConfigManager::parse_yaml(
            "web_search:\n  engine: google\n  provider: duckduckgo_instant\n  provider_priority: []\n  multi_search:\n    engines: []\nlanguage: ja-JP\n",
        )
        .expect("retired search provider settings must not block startup");

        assert_eq!(config.web_search, None);
        assert_eq!(config.language, "ja-JP");
    }

    #[test]
    fn retired_web_search_load_saves_current_shape_and_preserves_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.yaml");
        let original = "server:\n  api_key: user-owned-key\nlanguage: ko-KR\nweb_search:\n  engine: google\n  provider: duckduckgo_instant\n";
        std::fs::write(&path, original).unwrap();

        let config = load_config_from_path(&path).expect("load and normalize retired settings");
        assert_eq!(config.web_search, None);
        assert_eq!(config.language, "ko-KR");
        assert_eq!(config.server.api_key, "user-owned-key");
        let saved = std::fs::read_to_string(&path).unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(&saved).unwrap();
        assert!(value["web_search"].is_null());
        assert_eq!(
            std::fs::read_to_string(path.with_extension("yaml.backup")).unwrap(),
            original
        );

        assert_eq!(load_config_from_path(&path).unwrap(), config);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved);
        assert_eq!(
            std::fs::read_to_string(path.with_extension("yaml.backup")).unwrap(),
            original,
            "a second startup must not overwrite the original backup"
        );
    }

    #[test]
    fn retired_web_search_cleanup_preserves_current_modes_and_defaults() {
        for (value, expected) in [
            ("disabled", Some(WebSearchMode::Disabled)),
            ("cached", Some(WebSearchMode::Cached)),
            ("indexed", Some(WebSearchMode::Indexed)),
            ("live", Some(WebSearchMode::Live)),
            ("null", None),
        ] {
            let config = ConfigManager::parse_yaml(&format!("web_search: {value}\n")).unwrap();
            assert_eq!(config.web_search, expected);
            let saved = ConfigManager::to_yaml(&config).unwrap();
            assert_eq!(ConfigManager::parse_yaml(&saved).unwrap(), config);
        }
        for yaml in [
            "{}",
            "web_search: {}",
            "web_search:\n  provider_priority: []",
        ] {
            assert_eq!(ConfigManager::parse_yaml(yaml).unwrap().web_search, None);
        }
    }

    #[test]
    fn retired_web_search_cleanup_keeps_invalid_configuration_rejected() {
        for yaml in [
            "web_search: automatic",
            "web_search: true",
            "web_search: []",
            "web_search:\n  mode: live",
            "web_search:\n  engine: 12",
            "web_search:\n  provider_priority: [12]",
            "web_search:\n  multi_search: false",
            "web_search:\n  engine: google\n  typo: live",
            "web_search:\n  engine: google\nlanguage: []",
        ] {
            assert!(ConfigManager::parse_yaml(yaml).is_err(), "{yaml}");
        }
    }
}
