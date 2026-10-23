//! 托管工作树创建与自动清理偏好。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpstreamRefreshMode {
    #[default]
    Never,
    BestEffort,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct WorktreeConfig {
    #[serde(deserialize_with = "deserialize_root")]
    pub root: String,
    pub upstream_refresh_mode: UpstreamRefreshMode,
    pub auto_cleanup_enabled: bool,
    #[serde(deserialize_with = "deserialize_keep_count")]
    pub keep_count: u32,
}

impl Default for WorktreeConfig {
    fn default() -> Self {
        Self {
            root: String::new(),
            upstream_refresh_mode: UpstreamRefreshMode::Never,
            auto_cleanup_enabled: true,
            keep_count: 15,
        }
    }
}

fn deserialize_keep_count<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let value = u32::deserialize(d)?;
    if value == 0 {
        return Err(serde::de::Error::custom(
            "Worktree keep count must be positive",
        ));
    }
    Ok(value)
}

impl WorktreeConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    pub fn resolved_root(&self, app_data_root: &Path) -> PathBuf {
        if self.root.is_empty() {
            app_data_root.join("worktrees")
        } else {
            PathBuf::from(&self.root)
        }
    }
}

fn deserialize_root<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let value = String::deserialize(d)?;
    if value.len() > 4096
        || value.chars().any(char::is_control)
        || (!value.is_empty() && !Path::new(&value).is_absolute())
    {
        return Err(serde::de::Error::custom(
            "Worktree root must be empty or an absolute path without control characters",
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn root_and_refresh_round_trip_without_touching_the_filesystem() {
        let temp = tempfile::tempdir().unwrap();
        let custom = temp.path().join("Custom Worktrees");
        let config: WorktreeConfig = serde_json::from_value(json!({
            "root": custom,
            "upstream-refresh-mode": "best-effort"
        }))
        .unwrap();
        let restored: WorktreeConfig =
            serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
        assert_eq!(restored, config);
        assert_eq!(restored.resolved_root(temp.path()), custom);
        assert!(!custom.exists());
        assert_eq!(
            WorktreeConfig::default().resolved_root(temp.path()),
            temp.path().join("worktrees")
        );
    }

    #[test]
    fn invalid_roots_and_refresh_values_fail_closed() {
        for value in [
            json!({"root": "relative/path"}),
            json!({"root": "~/worktrees"}),
            json!({"root": "/bad\npath"}),
            json!({"root": false}),
            json!({"upstream-refresh-mode": "always"}),
            json!({"auto-cleanup-enabled": "true"}),
            json!({"keep-count": 0}),
            json!({"keep-count": -1}),
            json!({"keep-count": 1.5}),
            json!({"unknown": true}),
        ] {
            assert!(serde_json::from_value::<WorktreeConfig>(value).is_err());
        }
    }
}
