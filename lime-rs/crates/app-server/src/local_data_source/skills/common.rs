use lime_core::app_paths;
use std::fs;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SkillPackageApp {
    Lime,
    Claude,
    Codex,
    Gemini,
}

pub(crate) fn parse_skill_package_app(value: &str) -> Result<SkillPackageApp, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "lime" => Ok(SkillPackageApp::Lime),
        "claude" => Ok(SkillPackageApp::Claude),
        "codex" => Ok(SkillPackageApp::Codex),
        "gemini" => Ok(SkillPackageApp::Gemini),
        _ => Err(format!("Unsupported skill package app: {}", value.trim())),
    }
}

pub(crate) fn skill_package_app_to_core_app(
    app: SkillPackageApp,
) -> lime_core::models::app_type::AppType {
    match app {
        SkillPackageApp::Lime => lime_core::models::app_type::AppType::Lime,
        SkillPackageApp::Claude => lime_core::models::app_type::AppType::Claude,
        SkillPackageApp::Codex => lime_core::models::app_type::AppType::Codex,
        SkillPackageApp::Gemini => lime_core::models::app_type::AppType::Gemini,
    }
}

pub(crate) fn skill_state_key(app: SkillPackageApp, directory: &str) -> String {
    format!("{}:{directory}", skill_package_app_key_prefix(app))
}

pub(crate) fn skill_package_app_root(app: SkillPackageApp) -> Result<PathBuf, String> {
    match app {
        SkillPackageApp::Lime => app_paths::resolve_skills_dir(),
        SkillPackageApp::Claude => home_skill_root(".claude"),
        SkillPackageApp::Codex => home_skill_root(".codex"),
        SkillPackageApp::Gemini => home_skill_root(".gemini"),
    }
}

pub(crate) fn skill_package_app_lookup_roots(app: SkillPackageApp) -> Result<Vec<PathBuf>, String> {
    match app {
        SkillPackageApp::Lime => app_paths::resolve_lime_skill_roots(),
        _ => Ok(vec![skill_package_app_root(app)?]),
    }
}

pub(crate) fn scan_installed_skill_directories_from_roots(skill_roots: &[PathBuf]) -> Vec<String> {
    let mut directories = Vec::new();
    for root in skill_roots {
        for directory in scan_installed_skill_directories(root) {
            if !directories.iter().any(|value| value == &directory) {
                directories.push(directory);
            }
        }
    }
    directories
}

pub(crate) fn validate_skill_package_directory(directory: &str) -> Result<(), String> {
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

pub(crate) fn resolve_skill_package_dir(
    skill_roots: &[PathBuf],
    directory: &str,
) -> Result<PathBuf, String> {
    validate_skill_package_directory(directory)?;

    for root in skill_roots {
        if let Some(skill_dir) = try_resolve_skill_package_dir(root, directory)? {
            return Ok(skill_dir);
        }
    }

    Err(format!("Skill not found: {directory}"))
}

fn skill_package_app_key_prefix(app: SkillPackageApp) -> &'static str {
    match app {
        SkillPackageApp::Lime => "lime",
        SkillPackageApp::Claude => "claude",
        SkillPackageApp::Codex => "codex",
        SkillPackageApp::Gemini => "gemini",
    }
}

fn home_skill_root(app_dir_name: &str) -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Failed to get home directory".to_string())
        .map(|home| home.join(app_dir_name).join("skills"))
}

fn scan_installed_skill_directories(skills_dir: &Path) -> Vec<String> {
    if !skills_dir.exists() {
        return Vec::new();
    }

    let mut directories = Vec::new();
    let Ok(entries) = fs::read_dir(skills_dir) else {
        return directories;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }
        if let Some(directory) = entry.file_name().to_str() {
            if !directories.iter().any(|value| value == directory) {
                directories.push(directory.to_string());
            }
        }
    }
    directories
}

fn try_resolve_skill_package_dir(
    skills_root: &Path,
    directory: &str,
) -> Result<Option<PathBuf>, String> {
    validate_skill_package_directory(directory)?;

    if !skills_root.exists() {
        return Ok(None);
    }

    let canonical_skills_root = skills_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve skills directory: {error}"))?;
    let skill_dir = skills_root.join(directory);
    if !skill_dir.exists() {
        return Ok(None);
    }

    let canonical_skill_dir = skill_dir
        .canonicalize()
        .map_err(|error| format!("Failed to resolve skill directory: {error}"))?;
    if !canonical_skill_dir.starts_with(&canonical_skills_root) {
        return Err("Invalid skill directory path".to_string());
    }
    if !canonical_skill_dir.join("SKILL.md").is_file() {
        return Ok(None);
    }

    Ok(Some(canonical_skill_dir))
}

#[cfg(test)]
mod tests {
    use super::{
        SkillPackageApp, parse_skill_package_app, skill_package_app_root, skill_state_key,
    };
    use std::path::Path;

    #[test]
    fn codex_skill_packages_use_codex_user_directory() {
        let app = parse_skill_package_app("codex").expect("Codex is a supported skill target");

        assert_eq!(app, SkillPackageApp::Codex);
        assert_eq!(skill_state_key(app, "example-skill"), "codex:example-skill");
        assert!(
            skill_package_app_root(app)
                .expect("Codex skill root")
                .ends_with(Path::new(".codex").join("skills"))
        );
    }
}
