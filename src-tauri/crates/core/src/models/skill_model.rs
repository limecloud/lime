use super::app_type::AppType;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const VIDEO_GENERATE_SKILL_DIRECTORY: &str = "video_generate";
pub const BROADCAST_GENERATE_SKILL_DIRECTORY: &str = "broadcast_generate";
pub const COVER_GENERATE_SKILL_DIRECTORY: &str = "cover_generate";
pub const MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY: &str = "modal_resource_search";
pub const IMAGE_GENERATE_SKILL_DIRECTORY: &str = "image_generate";
pub const LIBRARY_SKILL_DIRECTORY: &str = "library";
pub const URL_PARSE_SKILL_DIRECTORY: &str = "url_parse";
pub const RESEARCH_SKILL_DIRECTORY: &str = "research";
pub const TYPESETTING_SKILL_DIRECTORY: &str = "typesetting";
pub const SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY: &str = "social_post_with_cover";

pub const DEFAULT_PROXYCAST_SKILL_DIRECTORIES: [&str; 10] = [
    VIDEO_GENERATE_SKILL_DIRECTORY,
    BROADCAST_GENERATE_SKILL_DIRECTORY,
    COVER_GENERATE_SKILL_DIRECTORY,
    MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY,
    IMAGE_GENERATE_SKILL_DIRECTORY,
    LIBRARY_SKILL_DIRECTORY,
    URL_PARSE_SKILL_DIRECTORY,
    RESEARCH_SKILL_DIRECTORY,
    TYPESETTING_SKILL_DIRECTORY,
    SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY,
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillSourceKind {
    Builtin,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub key: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    #[serde(rename = "readmeUrl", skip_serializing_if = "Option::is_none")]
    pub readme_url: Option<String>,
    pub installed: bool,
    #[serde(rename = "sourceKind")]
    pub source_kind: SkillSourceKind,
    #[serde(rename = "repoOwner", skip_serializing_if = "Option::is_none")]
    pub repo_owner: Option<String>,
    #[serde(rename = "repoName", skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    #[serde(rename = "repoBranch", skip_serializing_if = "Option::is_none")]
    pub repo_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepo {
    pub owner: String,
    pub name: String,
    pub branch: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillState {
    pub installed: bool,
    pub installed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
}

impl Default for SkillRepo {
    fn default() -> Self {
        Self {
            owner: String::new(),
            name: String::new(),
            branch: "main".to_string(),
            enabled: true,
        }
    }
}

#[allow(dead_code)]
impl SkillRepo {
    pub fn new(owner: String, name: String, branch: String) -> Self {
        Self {
            owner,
            name,
            branch,
            enabled: true,
        }
    }

    pub fn github_url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }

    pub fn zip_url(&self) -> String {
        format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.zip",
            self.owner, self.name, self.branch
        )
    }
}

pub fn get_default_skill_repos() -> Vec<SkillRepo> {
    vec![
        // ProxyCast 官方仓库（排第一位）
        SkillRepo {
            owner: "proxycast".to_string(),
            name: "skills".to_string(),
            branch: "main".to_string(),
            enabled: true,
        },
        SkillRepo {
            owner: "ComposioHQ".to_string(),
            name: "awesome-claude-skills".to_string(),
            branch: "main".to_string(),
            enabled: true,
        },
        SkillRepo {
            owner: "anthropics".to_string(),
            name: "skills".to_string(),
            branch: "main".to_string(),
            enabled: true,
        },
        SkillRepo {
            owner: "cexll".to_string(),
            name: "myclaude".to_string(),
            branch: "master".to_string(),
            enabled: true,
        },
    ]
}

pub fn is_default_proxycast_skill(directory: &str) -> bool {
    DEFAULT_PROXYCAST_SKILL_DIRECTORIES.contains(&directory)
}

pub fn resolve_skill_source_kind(app_type: &AppType, directory: &str) -> SkillSourceKind {
    if matches!(app_type, AppType::ProxyCast) && is_default_proxycast_skill(directory) {
        SkillSourceKind::Builtin
    } else {
        SkillSourceKind::Other
    }
}

pub type SkillStates = HashMap<String, SkillState>;

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Feature: skills-platform-mvp, Property 1: Default Repositories Include ProxyCast Official
    /// Validates: Requirements 1.1, 1.2, 1.3
    #[test]
    fn test_default_repos_include_proxycast_official() {
        let repos = get_default_skill_repos();

        // 验证列表非空
        assert!(!repos.is_empty(), "默认仓库列表不应为空");

        // 验证第一个仓库是 ProxyCast 官方仓库
        let first_repo = &repos[0];
        assert_eq!(
            first_repo.owner, "proxycast",
            "第一个仓库的 owner 应为 proxycast"
        );
        assert_eq!(first_repo.name, "skills", "第一个仓库的 name 应为 skills");
        assert_eq!(first_repo.branch, "main", "第一个仓库的 branch 应为 main");
        assert!(first_repo.enabled, "ProxyCast 官方仓库应默认启用");
    }

    // Property 1: Default Repositories Include ProxyCast Official (Property-Based Test)
    // For any call to get_default_skill_repos(), the returned list SHALL contain
    // a SkillRepo with owner="proxycast", name="skills", branch="main", and enabled=true,
    // and this repo SHALL be the first item in the list.
    // Validates: Requirements 1.1, 1.2, 1.3
    proptest! {
        #[test]
        fn prop_default_repos_proxycast_first(_seed in 0u64..1000) {
            // 无论调用多少次，结果应该一致
            let repos = get_default_skill_repos();

            // Property: 列表非空
            prop_assert!(!repos.is_empty());

            // Property: 第一个仓库是 ProxyCast 官方仓库
            let first = &repos[0];
            prop_assert_eq!(&first.owner, "proxycast");
            prop_assert_eq!(&first.name, "skills");
            prop_assert_eq!(&first.branch, "main");
            prop_assert!(first.enabled);
        }
    }

    #[test]
    fn test_proxycast_repo_exists_in_list() {
        let repos = get_default_skill_repos();

        // 验证 ProxyCast 仓库存在于列表中
        let proxycast_repo = repos
            .iter()
            .find(|r| r.owner == "proxycast" && r.name == "skills");
        assert!(
            proxycast_repo.is_some(),
            "ProxyCast 官方仓库应存在于默认列表中"
        );

        let repo = proxycast_repo.unwrap();
        assert_eq!(repo.branch, "main");
        assert!(repo.enabled);
    }

    #[test]
    fn test_default_proxycast_skill_directories_include_embedded_defaults() {
        assert!(is_default_proxycast_skill(VIDEO_GENERATE_SKILL_DIRECTORY));
        assert!(is_default_proxycast_skill(
            SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY
        ));
        assert!(!is_default_proxycast_skill("custom-skill"));
    }

    #[test]
    fn test_resolve_skill_source_kind_only_marks_proxycast_defaults_as_builtin() {
        assert_eq!(
            resolve_skill_source_kind(&AppType::ProxyCast, VIDEO_GENERATE_SKILL_DIRECTORY),
            SkillSourceKind::Builtin
        );
        assert_eq!(
            resolve_skill_source_kind(&AppType::ProxyCast, "custom-skill"),
            SkillSourceKind::Other
        );
        assert_eq!(
            resolve_skill_source_kind(&AppType::Claude, VIDEO_GENERATE_SKILL_DIRECTORY),
            SkillSourceKind::Other
        );
    }
}
