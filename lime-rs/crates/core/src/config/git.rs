//! Git 工作流偏好，由 canonical 用户配置拥有。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestMergeMethod {
    #[default]
    Merge,
    Squash,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReviewDeliveryPreference {
    #[default]
    Inline,
    Detached,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct GitConfig {
    #[serde(deserialize_with = "deserialize_prefix")]
    pub branch_prefix: String,
    pub always_force_push: bool,
    pub create_draft_pull_requests: bool,
    pub pull_request_merge_method: PullRequestMergeMethod,
    pub review_delivery: ReviewDeliveryPreference,
    #[serde(deserialize_with = "deserialize_instructions")]
    pub commit_instructions: String,
    #[serde(deserialize_with = "deserialize_instructions")]
    pub pull_request_instructions: String,
}

impl Default for GitConfig {
    fn default() -> Self {
        Self {
            branch_prefix: "lime/".to_string(),
            always_force_push: false,
            create_draft_pull_requests: true,
            pull_request_merge_method: PullRequestMergeMethod::Merge,
            review_delivery: ReviewDeliveryPreference::Inline,
            commit_instructions: String::new(),
            pull_request_instructions: String::new(),
        }
    }
}

impl GitConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

fn deserialize_prefix<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let value = String::deserialize(d)?;
    if value.len() > 128
        || value.starts_with(['-', '/', '.'])
        || value.contains("..")
        || value.contains("@{")
        || value.contains("//")
        || value
            .split('/')
            .any(|part| part.ends_with(".lock") || part.ends_with('.'))
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control() || "~^:?*[\\".contains(ch))
    {
        return Err(serde::de::Error::custom("Invalid Git branch prefix"));
    }
    Ok(value)
}

fn deserialize_instructions<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let value = String::deserialize(d)?;
    if value.len() > 32 * 1024 || value.contains('\0') {
        return Err(serde::de::Error::custom(
            "Git instructions must be at most 32 KiB and contain no NUL",
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_and_explicit_empty_prefix_survive_yaml_round_trip() {
        let default: GitConfig = serde_json::from_value(json!({})).unwrap();
        assert!(default.is_default());
        assert_eq!(default.branch_prefix, "lime/");
        assert!(default.create_draft_pull_requests);
        assert!(!default.always_force_push);
        let config: GitConfig = serde_json::from_value(json!({
            "branch-prefix": "", "review-delivery": "detached",
            "pull-request-merge-method": "squash", "commit-instructions": "中文\n詳細"
        }))
        .unwrap();
        let restored: GitConfig =
            serde_yaml::from_str(&serde_yaml::to_string(&config).unwrap()).unwrap();
        assert_eq!(restored, config);
        assert_eq!(restored.branch_prefix, "");
    }

    #[test]
    fn rejects_invalid_preferences_without_normalizing_user_instructions() {
        for value in [
            json!({"branch-prefix": "-x/"}),
            json!({"branch-prefix": "a..b/"}),
            json!({"branch-prefix": "a.lock/"}),
            json!({"branch-prefix": "a b/"}),
            json!({"branch-prefix": "a\\b/"}),
            json!({"branch-prefix": "@{/"}),
            json!({"review-delivery": "background"}),
            json!({"always-force-push": "true"}),
            json!({"pull-request-merge-method": "rebase"}),
            json!({"unknown": true}),
            json!({"commit-instructions": "a".repeat(32769)}),
            json!({"pull-request-instructions": "a\0b"}),
        ] {
            assert!(serde_json::from_value::<GitConfig>(value).is_err());
        }
        let value = "  Literal instructions\n";
        let config: GitConfig =
            serde_json::from_value(json!({"commit-instructions": value})).unwrap();
        assert_eq!(config.commit_instructions, value);
    }
}
