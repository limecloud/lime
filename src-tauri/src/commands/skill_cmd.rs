use crate::agent::aster_state::AsterAgentState;
use crate::database::dao::skills::SkillDao;
use crate::database::DbConnection;
use crate::models::app_type::AppType;
use crate::models::skill_model::{Skill, SkillRepo, SkillState};
use chrono::Utc;
use proxycast_services::skill_service::SkillService;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::State;

/// 从指定目录扫描已安装的 Skills
///
/// 扫描给定目录，返回包含 SKILL.md 的子目录名列表。
/// 这是一个可测试的内部函数。
///
/// # Arguments
/// - `skills_dir`: Skills 目录路径
///
/// # Returns
/// - `Vec<String>`: 已安装的 Skill 目录名列表
pub fn scan_installed_skills(skills_dir: &Path) -> Vec<String> {
    if !skills_dir.exists() {
        return vec![];
    }

    let mut skills = Vec::new();

    if let Ok(entries) = std::fs::read_dir(skills_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let skill_md = entry.path().join("SKILL.md");
                if skill_md.exists() {
                    if let Some(name) = entry.file_name().to_str() {
                        skills.push(name.to_string());
                    }
                }
            }
        }
    }

    skills
}

fn get_skills_dir(app_type: &AppType) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let skills_dir = match app_type {
        AppType::Claude => home.join(".claude").join("skills"),
        AppType::Codex => home.join(".codex").join("skills"),
        AppType::Gemini => home.join(".gemini").join("skills"),
        AppType::ProxyCast => home.join(".proxycast").join("skills"),
    };

    Ok(skills_dir)
}

fn validate_skill_directory(directory: &str) -> Result<(), String> {
    if directory.trim().is_empty() {
        return Err("Skill directory is required".to_string());
    }

    if directory.contains("..") || directory.contains('/') || directory.contains('\\') {
        return Err("Invalid skill directory".to_string());
    }

    let mut components = Path::new(directory).components();
    let first = components
        .next()
        .ok_or_else(|| "Skill directory is required".to_string())?;

    if components.next().is_some() {
        return Err("Invalid skill directory".to_string());
    }

    match first {
        Component::Normal(_) => Ok(()),
        _ => Err("Invalid skill directory".to_string()),
    }
}

fn read_local_skill_content(skills_dir: &Path, directory: &str) -> Result<String, String> {
    validate_skill_directory(directory)?;

    if !skills_dir.exists() {
        return Err("Skills directory not found".to_string());
    }

    let canonical_skills_dir = skills_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve skills directory: {e}"))?;

    let skill_dir = skills_dir.join(directory);
    if !skill_dir.exists() {
        return Err(format!("Skill not found: {directory}"));
    }

    let canonical_skill_dir = skill_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve skill directory: {e}"))?;

    if !canonical_skill_dir.starts_with(&canonical_skills_dir) {
        return Err("Invalid skill directory path".to_string());
    }

    let skill_md_path = canonical_skill_dir.join("SKILL.md");
    if !skill_md_path.is_file() {
        return Err(format!("SKILL.md not found for skill: {directory}"));
    }

    std::fs::read_to_string(&skill_md_path).map_err(|e| format!("Failed to read SKILL.md: {e}"))
}

/// 获取已安装的 ProxyCast Skills 目录列表
///
/// 扫描 ~/.proxycast/skills/ 目录，返回包含 SKILL.md 的子目录名列表。
/// 这些 Skills 将被传递给 aster 用于 AI Agent 功能。
///
/// # Returns
/// - `Ok(Vec<String>)`: 已安装的 Skill 目录名列表
/// - `Err(String)`: 错误信息
#[tauri::command]
pub async fn get_installed_proxycast_skills() -> Result<Vec<String>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;
    let skills_dir = home.join(".proxycast").join("skills");
    Ok(scan_installed_skills(&skills_dir))
}

/// 获取本地已安装 Skill 的 SKILL.md 内容
///
/// 仅支持读取本地 Skills 目录下的文件，包含目录合法性与路径穿越防护。
///
/// # Arguments
/// - `app`: 应用类型（proxycast/claude/codex/gemini）
/// - `directory`: Skill 目录名
///
/// # Returns
/// - `Ok(String)`: SKILL.md 的文本内容
/// - `Err(String)`: 错误信息
#[tauri::command]
pub fn get_local_skill_content(app: String, directory: String) -> Result<String, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;
    let skills_dir = get_skills_dir(&app_type)?;
    read_local_skill_content(&skills_dir, &directory)
}

pub struct SkillServiceState(pub Arc<SkillService>);

fn get_skill_key(app_type: &AppType, directory: &str) -> String {
    format!("{}:{}", app_type.to_string().to_lowercase(), directory)
}

/// 解析指定应用的技能列表（供 dispatcher 等非 Tauri command 场景调用）
pub async fn resolve_skills_for_app(
    db: &DbConnection,
    skill_service: &Arc<SkillService>,
    app_type: &AppType,
    _refresh_remote: bool,
) -> Result<Vec<Skill>, String> {
    let (repos, installed_states) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let repos = SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())?;
        let installed_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;
        (repos, installed_states)
    };

    let skills = skill_service
        .list_skills(app_type, &repos, &installed_states)
        .await
        .map_err(|e| e.to_string())?;

    Ok(skills)
}

#[tauri::command]
pub async fn get_skills(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
) -> Result<Vec<Skill>, String> {
    get_skills_for_app(db, skill_service, "proxycast".to_string()).await
}

#[tauri::command]
pub async fn get_skills_for_app(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    app: String,
) -> Result<Vec<Skill>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    // 获取仓库列表和已安装状态（在 await 之前完成）
    let (repos, installed_states) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let repos = SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())?;
        let installed_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;
        (repos, installed_states)
    };

    // 获取技能列表
    let skills = skill_service
        .0
        .list_skills(&app_type, &repos, &installed_states)
        .await
        .map_err(|e| e.to_string())?;

    // 自动同步本地已安装的 skills 到数据库
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let existing_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;

        for skill in &skills {
            if skill.installed {
                let key = get_skill_key(&app_type, &skill.directory);
                if !existing_states.contains_key(&key) {
                    let state = SkillState {
                        installed: true,
                        installed_at: Utc::now(),
                    };
                    SkillDao::update_skill_state(&conn, &key, &state).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(skills)
}

#[tauri::command]
pub fn get_local_skills_for_app(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    app: String,
) -> Result<Vec<Skill>, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    let installed_states = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        SkillDao::get_skills(&conn).map_err(|e| e.to_string())?
    };

    skill_service
        .0
        .list_local_skills(&app_type, &installed_states)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_skill(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    directory: String,
) -> Result<bool, String> {
    install_skill_for_app(db, skill_service, "proxycast".to_string(), directory).await
}

#[tauri::command]
pub async fn install_skill_for_app(
    db: State<'_, DbConnection>,
    skill_service: State<'_, SkillServiceState>,
    app: String,
    directory: String,
) -> Result<bool, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    // 获取技能信息（在 await 之前完成）
    let (repos, installed_states) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let repos = SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())?;
        let installed_states = SkillDao::get_skills(&conn).map_err(|e| e.to_string())?;
        (repos, installed_states)
    };

    let skills = skill_service
        .0
        .list_skills(&app_type, &repos, &installed_states)
        .await
        .map_err(|e| e.to_string())?;

    let skill = skills
        .iter()
        .find(|s| s.directory == directory)
        .ok_or_else(|| format!("Skill not found: {directory}"))?;

    let repo_owner = skill
        .repo_owner
        .as_ref()
        .ok_or_else(|| "Missing repo owner".to_string())?
        .clone();
    let repo_name = skill
        .repo_name
        .as_ref()
        .ok_or_else(|| "Missing repo name".to_string())?
        .clone();
    let repo_branch = skill
        .repo_branch
        .as_ref()
        .ok_or_else(|| "Missing repo branch".to_string())?
        .clone();

    // 安装技能
    skill_service
        .0
        .install_skill(&app_type, &repo_owner, &repo_name, &repo_branch, &directory)
        .await
        .map_err(|e| e.to_string())?;

    // 更新数据库
    let key = get_skill_key(&app_type, &directory);
    let state = SkillState {
        installed: true,
        installed_at: Utc::now(),
    };

    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        SkillDao::update_skill_state(&conn, &key, &state).map_err(|e| e.to_string())?;
    }

    // 刷新 aster-rust 的 global_registry，使 AI 能够发现新安装的 Skill
    AsterAgentState::reload_proxycast_skills();

    Ok(true)
}

#[tauri::command]
pub fn uninstall_skill(db: State<'_, DbConnection>, directory: String) -> Result<bool, String> {
    uninstall_skill_for_app(db, "proxycast".to_string(), directory)
}

#[tauri::command]
pub fn uninstall_skill_for_app(
    db: State<'_, DbConnection>,
    app: String,
    directory: String,
) -> Result<bool, String> {
    let app_type: AppType = app.parse().map_err(|e: String| e)?;

    // 卸载技能
    SkillService::uninstall_skill(&app_type, &directory).map_err(|e| e.to_string())?;

    // 更新数据库
    let key = get_skill_key(&app_type, &directory);
    let state = SkillState {
        installed: false,
        installed_at: Utc::now(),
    };

    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::update_skill_state(&conn, &key, &state).map_err(|e| e.to_string())?;

    // 刷新 aster-rust 的 global_registry，移除已卸载的 Skill
    AsterAgentState::reload_proxycast_skills();

    Ok(true)
}

#[tauri::command]
pub fn get_skill_repos(db: State<'_, DbConnection>) -> Result<Vec<SkillRepo>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::get_skill_repos(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_skill_repo(db: State<'_, DbConnection>, repo: SkillRepo) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::save_skill_repo(&conn, &repo).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn remove_skill_repo(
    db: State<'_, DbConnection>,
    owner: String,
    name: String,
) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    SkillDao::delete_skill_repo(&conn, &owner, &name).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn refresh_skill_cache(skill_service: State<'_, SkillServiceState>) -> Result<bool, String> {
    skill_service.0.refresh_cache();
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::HashSet;
    use tempfile::TempDir;

    /// 生成有效的 Skill 目录名（字母数字和连字符）
    fn skill_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,20}".prop_filter("non-empty", |s| !s.is_empty())
    }

    /// 生成 Skill 目录名列表
    fn skill_names_strategy() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec(skill_name_strategy(), 0..10).prop_filter("unique names", |names| {
            let set: HashSet<_> = names.iter().collect();
            set.len() == names.len()
        })
    }

    /// 创建测试用的 Skills 目录结构
    fn create_test_skills_dir(temp_dir: &TempDir, skill_names: &[String]) {
        let skills_dir = temp_dir.path();

        for name in skill_names {
            let skill_path = skills_dir.join(name);
            std::fs::create_dir_all(&skill_path).unwrap();
            let skill_md_path = skill_path.join("SKILL.md");
            std::fs::write(&skill_md_path, "# Test Skill\n").unwrap();
        }
    }

    // **Feature: skills-platform-mvp, Property 2: Installed Skills Discovery**
    // **Validates: Requirements 2.1, 2.2, 2.3**
    //
    // *For any* valid ~/.proxycast/skills/ directory containing subdirectories
    // with SKILL.md files, calling `scan_installed_skills()` SHALL return a list
    // containing exactly those subdirectory names.
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn prop_installed_skills_discovery(skill_names in skill_names_strategy()) {
            // Arrange: 创建临时目录和 Skills 结构
            let temp_dir = TempDir::new().unwrap();
            create_test_skills_dir(&temp_dir, &skill_names);

            // Act: 扫描已安装的 Skills
            let discovered = scan_installed_skills(temp_dir.path());

            // Assert: 发现的 Skills 应该与创建的完全匹配
            let expected_set: HashSet<_> = skill_names.iter().cloned().collect();
            let discovered_set: HashSet<_> = discovered.iter().cloned().collect();

            prop_assert_eq!(
                expected_set,
                discovered_set,
                "Discovered skills should match created skills exactly"
            );
        }

        #[test]
        fn prop_empty_dir_returns_empty_list(skill_names in skill_names_strategy()) {
            // Arrange: 创建临时目录但不创建任何 Skills
            let temp_dir = TempDir::new().unwrap();

            // 创建目录但不添加 SKILL.md
            for name in &skill_names {
                let skill_path = temp_dir.path().join(name);
                std::fs::create_dir_all(&skill_path).unwrap();
                // 不创建 SKILL.md 文件
            }

            // Act: 扫描已安装的 Skills
            let discovered = scan_installed_skills(temp_dir.path());

            // Assert: 没有 SKILL.md 的目录不应该被发现
            prop_assert!(
                discovered.is_empty(),
                "Directories without SKILL.md should not be discovered"
            );
        }

        #[test]
        fn prop_nonexistent_dir_returns_empty_list(_dummy in 0..1i32) {
            // Arrange: 使用不存在的目录路径
            let nonexistent_path = std::path::Path::new("/nonexistent/path/to/skills");

            // Act: 扫描不存在的目录
            let discovered = scan_installed_skills(nonexistent_path);

            // Assert: 不存在的目录应该返回空列表
            prop_assert!(
                discovered.is_empty(),
                "Non-existent directory should return empty list"
            );
        }
    }

    #[test]
    fn test_scan_installed_skills_with_mixed_content() {
        // Arrange: 创建包含混合内容的目录
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path();

        // 创建有效的 Skill 目录（有 SKILL.md）
        let valid_skill = skills_dir.join("valid-skill");
        std::fs::create_dir_all(&valid_skill).unwrap();
        std::fs::write(valid_skill.join("SKILL.md"), "# Valid Skill").unwrap();

        // 创建无效的目录（没有 SKILL.md）
        let invalid_skill = skills_dir.join("invalid-skill");
        std::fs::create_dir_all(&invalid_skill).unwrap();

        // 创建文件（不是目录）
        std::fs::write(skills_dir.join("not-a-directory.txt"), "test").unwrap();

        // Act
        let discovered = scan_installed_skills(skills_dir);

        // Assert: 只有有效的 Skill 应该被发现
        assert_eq!(discovered.len(), 1);
        assert!(discovered.contains(&"valid-skill".to_string()));
    }

    #[test]
    fn test_read_local_skill_content_success() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        let skill_dir = skills_dir.join("demo-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Demo Skill\ncontent").unwrap();

        let content = read_local_skill_content(&skills_dir, "demo-skill").unwrap();
        assert!(content.contains("# Demo Skill"));
        assert!(content.contains("content"));
    }

    #[test]
    fn test_read_local_skill_content_rejects_traversal() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let err = read_local_skill_content(&skills_dir, "../outside").unwrap_err();
        assert!(err.contains("Invalid skill directory"));
    }

    #[test]
    fn test_read_local_skill_content_missing_skill_md() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        let skill_dir = skills_dir.join("no-skill-md");
        std::fs::create_dir_all(&skill_dir).unwrap();

        let err = read_local_skill_content(&skills_dir, "no-skill-md").unwrap_err();
        assert!(err.contains("SKILL.md not found"));
    }

    #[cfg(unix)]
    #[test]
    fn test_read_local_skill_content_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path().join("skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let outside_dir = temp_dir.path().join("outside-skill");
        std::fs::create_dir_all(&outside_dir).unwrap();
        std::fs::write(outside_dir.join("SKILL.md"), "# Outside").unwrap();

        let symlink_dir = skills_dir.join("escape-skill");
        symlink(&outside_dir, &symlink_dir).unwrap();

        let err = read_local_skill_content(&skills_dir, "escape-skill").unwrap_err();
        assert!(err.contains("Invalid skill directory path"));
    }
}
