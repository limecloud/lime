use std::fs;
use std::path::{Path, PathBuf};

use proxycast_core::models::{
    BROADCAST_GENERATE_SKILL_DIRECTORY, COVER_GENERATE_SKILL_DIRECTORY,
    IMAGE_GENERATE_SKILL_DIRECTORY, LIBRARY_SKILL_DIRECTORY, MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY,
    RESEARCH_SKILL_DIRECTORY, SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY, TYPESETTING_SKILL_DIRECTORY,
    URL_PARSE_SKILL_DIRECTORY, VIDEO_GENERATE_SKILL_DIRECTORY,
};

const VIDEO_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/video_generate/SKILL.md");

const BROADCAST_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/broadcast_generate/SKILL.md");

const COVER_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/cover_generate/SKILL.md");

const MODAL_RESOURCE_SEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/modal_resource_search/SKILL.md");

const IMAGE_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/image_generate/SKILL.md");

const LIBRARY_SKILL_CONTENT: &str = include_str!("../../resources/default-skills/library/SKILL.md");

const URL_PARSE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/url_parse/SKILL.md");

const RESEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/research/SKILL.md");

const TYPESETTING_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/typesetting/SKILL.md");

const SOCIAL_POST_WITH_COVER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/social_post_with_cover/SKILL.md");

fn default_skills() -> [(&'static str, &'static str); 10] {
    [
        (VIDEO_GENERATE_SKILL_DIRECTORY, VIDEO_GENERATE_SKILL_CONTENT),
        (
            BROADCAST_GENERATE_SKILL_DIRECTORY,
            BROADCAST_GENERATE_SKILL_CONTENT,
        ),
        (COVER_GENERATE_SKILL_DIRECTORY, COVER_GENERATE_SKILL_CONTENT),
        (
            MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY,
            MODAL_RESOURCE_SEARCH_SKILL_CONTENT,
        ),
        (IMAGE_GENERATE_SKILL_DIRECTORY, IMAGE_GENERATE_SKILL_CONTENT),
        (LIBRARY_SKILL_DIRECTORY, LIBRARY_SKILL_CONTENT),
        (URL_PARSE_SKILL_DIRECTORY, URL_PARSE_SKILL_CONTENT),
        (RESEARCH_SKILL_DIRECTORY, RESEARCH_SKILL_CONTENT),
        (TYPESETTING_SKILL_DIRECTORY, TYPESETTING_SKILL_CONTENT),
        (
            SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY,
            SOCIAL_POST_WITH_COVER_SKILL_CONTENT,
        ),
    ]
}

fn skills_root_from_home(home_dir: &Path) -> PathBuf {
    home_dir.join(".proxycast").join("skills")
}

/// 从 SKILL.md 内容中提取版本号，返回 (major, minor, patch)
fn parse_skill_version(content: &str) -> Option<(u32, u32, u32)> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("version:") {
            let version_str = trimmed.split_once(':')?.1.trim();
            let parts: Vec<&str> = version_str.split('.').collect();
            if parts.len() == 3 {
                let major = parts[0].trim().parse::<u32>().ok()?;
                let minor = parts[1].trim().parse::<u32>().ok()?;
                let patch = parts[2].trim().parse::<u32>().ok()?;
                return Some((major, minor, patch));
            }
        }
    }
    None
}

fn ensure_default_local_skills_in_home(home_dir: &Path) -> Result<Vec<String>, String> {
    let skills_root = skills_root_from_home(home_dir);
    fs::create_dir_all(&skills_root)
        .map_err(|e| format!("创建技能目录失败 {}: {e}", skills_root.display()))?;

    let mut installed = Vec::new();
    for (skill_name, skill_content) in default_skills() {
        let skill_dir = skills_root.join(skill_name);
        let skill_md_path = skill_dir.join("SKILL.md");
        if skill_md_path.exists() {
            // 比较版本号，若内置版本更新则自动升级
            let existing_content = fs::read_to_string(&skill_md_path).unwrap_or_default();
            let existing_version = parse_skill_version(&existing_content);
            let embedded_version = parse_skill_version(skill_content);
            match (existing_version, embedded_version) {
                (Some(ev), Some(bv)) if bv > ev => {
                    // 内置版本更新，覆盖升级
                    fs::write(&skill_md_path, skill_content).map_err(|e| {
                        format!("升级默认技能失败 {}: {e}", skill_md_path.display())
                    })?;
                    installed.push(skill_name.to_string());
                }
                _ => continue, // 版本相同或无法比较，跳过
            }
            continue;
        }

        fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("创建默认技能目录失败 {}: {e}", skill_dir.display()))?;
        fs::write(&skill_md_path, skill_content)
            .map_err(|e| format!("写入默认技能失败 {}: {e}", skill_md_path.display()))?;
        installed.push(skill_name.to_string());
    }
    Ok(installed)
}

pub fn ensure_default_local_skills() -> Result<Vec<String>, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取用户 Home 目录".to_string())?;
    ensure_default_local_skills_in_home(&home_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_install_default_skill_when_missing() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let installed = ensure_default_local_skills_in_home(temp.path()).expect("install");
        assert!(installed.contains(&SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY.to_string()));

        let skill_md_path = temp
            .path()
            .join(".proxycast")
            .join("skills")
            .join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY)
            .join("SKILL.md");
        assert!(skill_md_path.exists());
    }

    #[test]
    fn should_not_overwrite_existing_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skill_dir = temp
            .path()
            .join(".proxycast")
            .join("skills")
            .join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_md_path = skill_dir.join("SKILL.md");
        // 无版本号的自定义内容不应被覆盖
        let existing_content = "custom skill content";
        fs::write(&skill_md_path, existing_content).expect("write custom skill");

        let installed = ensure_default_local_skills_in_home(temp.path()).expect("install");
        assert!(
            !installed.contains(&SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY.to_string()),
            "无版本信息的已存在 skill 不应被重新安装"
        );

        let current_content = fs::read_to_string(&skill_md_path).expect("read skill");
        assert_eq!(current_content, existing_content);
    }

    #[test]
    fn should_upgrade_skill_when_newer_version_available() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skill_dir = temp
            .path()
            .join(".proxycast")
            .join("skills")
            .join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_md_path = skill_dir.join("SKILL.md");
        // 旧版本内容
        let old_content = "---\nname: social_post_with_cover\nversion: 1.0.0\n---\nold content";
        fs::write(&skill_md_path, old_content).expect("write old skill");

        let installed = ensure_default_local_skills_in_home(temp.path()).expect("install");
        assert!(
            installed.contains(&SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY.to_string()),
            "内置版本更新时应自动升级"
        );

        let current_content = fs::read_to_string(&skill_md_path).expect("read skill");
        assert_ne!(current_content, old_content, "旧版本内容应被替换");
        assert!(
            current_content.contains("steps-json"),
            "升级后应包含 steps-json 字段"
        );
    }

    #[test]
    fn should_parse_skill_version() {
        assert_eq!(
            parse_skill_version("---\nversion: 1.3.0\n---\n"),
            Some((1, 3, 0))
        );
        assert_eq!(
            parse_skill_version("---\nname: test\nversion: 2.10.5\n---\n"),
            Some((2, 10, 5))
        );
        assert_eq!(parse_skill_version("no version here"), None);
    }

    #[test]
    fn should_embed_social_image_tool_contract_in_default_skill() {
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT
            .contains("allowed-tools: social_generate_cover_image, search_query"));
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT.contains("**配图说明**"));
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT.contains("状态：{成功/失败}"));
    }

    #[test]
    fn should_embed_core_default_skills() {
        assert!(VIDEO_GENERATE_SKILL_CONTENT.contains("name: video_generate"));
        assert!(BROADCAST_GENERATE_SKILL_CONTENT.contains("name: broadcast_generate"));
        assert!(COVER_GENERATE_SKILL_CONTENT.contains("name: cover_generate"));
        assert!(MODAL_RESOURCE_SEARCH_SKILL_CONTENT.contains("name: modal_resource_search"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT.contains("name: image_generate"));
        assert!(LIBRARY_SKILL_CONTENT.contains("name: library"));
        assert!(URL_PARSE_SKILL_CONTENT.contains("name: url_parse"));
        assert!(RESEARCH_SKILL_CONTENT.contains("name: research"));
        assert!(TYPESETTING_SKILL_CONTENT.contains("name: typesetting"));
    }
}
