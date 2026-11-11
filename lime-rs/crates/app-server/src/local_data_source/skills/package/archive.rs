use crate::local_data_source::skills::common::validate_skill_package_directory;
use app_server_protocol::SkillPackageLocalInspectResponse;
use app_server_protocol::SkillPackageLocalInstallResponse;
use app_server_protocol::SkillPackageLocalReplaceResponse;
use lime_services::skill_service::SkillService;
use serde_json::json;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::io::Cursor;
use std::io::Read;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use zip::ZipArchive;

mod export;
#[cfg(test)]
mod tests;

pub(crate) use export::export_local_skill_package_to_path;
pub(crate) use export::normalize_skill_package_output_path;

pub(super) const MAX_SKILL_PACKAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug)]
pub(crate) struct SkillZipPackageFile {
    path: PathBuf,
    content: Vec<u8>,
}

#[derive(Debug)]
pub(crate) struct SkillZipPackage {
    files: Vec<SkillZipPackageFile>,
    shared_zip_root: Option<String>,
    should_strip_directory: bool,
}

fn validate_skill_package_file_path(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Skill package file path is required".to_string());
    }
    if path.contains('\\') || path.starts_with('/') || path.contains("..") {
        return Err(format!("Invalid skill package file path: {path}"));
    }

    let mut normalized = PathBuf::new();
    let mut has_component = false;
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) => {
                has_component = true;
                normalized.push(value);
            }
            _ => return Err(format!("Invalid skill package file path: {path}")),
        }
    }
    if !has_component {
        return Err("Skill package file path is required".to_string());
    }
    Ok(normalized)
}

pub(super) fn path_to_skill_package_archive_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let text = value
                    .to_str()
                    .ok_or_else(|| "Skill package path must be valid UTF-8".to_string())?;
                parts.push(text.to_string());
            }
            _ => return Err(format!("Invalid skill package path: {}", path.display())),
        }
    }
    if parts.is_empty() {
        return Err("Skill package path is required".to_string());
    }
    Ok(parts.join("/"))
}

pub(super) fn is_ignorable_skill_package_export_entry(path: &Path) -> bool {
    path.file_name()
        .map(|value| value.to_string_lossy() == ".DS_Store")
        .unwrap_or(false)
}

fn normalize_zip_entry_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    let mut has_component = false;
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                has_component = true;
                normalized.push(value);
            }
            _ => return Err(format!("Invalid skill zip entry path: {}", path.display())),
        }
    }
    if !has_component {
        return Err("Skill zip entry path is required".to_string());
    }
    Ok(normalized)
}

fn is_ignorable_zip_entry(path: &Path) -> bool {
    let mut components = path.components();
    let Some(first) = components.next() else {
        return true;
    };
    if first.as_os_str().to_string_lossy() == "__MACOSX" {
        return true;
    }
    path.file_name()
        .map(|value| value.to_string_lossy() == ".DS_Store")
        .unwrap_or(false)
}

fn first_zip_component(path: &Path) -> Option<String> {
    path.components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
}

fn strip_first_zip_component(path: &Path) -> Result<PathBuf, String> {
    let mut stripped = PathBuf::new();
    let mut components = path.components();
    let _ = components.next();
    for component in components {
        match component {
            Component::Normal(value) => stripped.push(value),
            _ => return Err(format!("Invalid skill zip entry path: {}", path.display())),
        }
    }
    if stripped.as_os_str().is_empty() {
        return Err("Skill zip entry path is required".to_string());
    }
    Ok(stripped)
}

pub(crate) fn read_skill_zip_package(bytes: &[u8]) -> Result<SkillZipPackage, String> {
    if bytes.is_empty() {
        return Err("Skill package is empty".to_string());
    }

    let cursor = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|error| format!("Invalid skill zip package: {error}"))?;
    let mut files = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read skill zip entry: {error}"))?;
        if file.is_dir() {
            continue;
        }
        let name = file
            .name()
            .map_err(|error| format!("Invalid skill zip entry name: {error}"))?
            .into_owned();
        if name.contains('\\') {
            return Err(format!("Invalid skill zip entry path: {name}"));
        }
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| format!("Invalid skill zip entry path: {name}"))?;
        let normalized = normalize_zip_entry_path(&enclosed)?;
        if is_ignorable_zip_entry(&normalized) {
            continue;
        }
        if file.size() > MAX_SKILL_PACKAGE_BYTES as u64 {
            return Err("Skill package file is too large".to_string());
        }

        let mut content = Vec::new();
        file.read_to_end(&mut content)
            .map_err(|error| format!("Failed to read skill zip entry {name}: {error}"))?;
        if content.len() > MAX_SKILL_PACKAGE_BYTES {
            return Err("Skill package file is too large".to_string());
        }
        files.push(SkillZipPackageFile {
            path: normalized,
            content,
        });
    }

    if files.is_empty() {
        return Err("Skill package contains no files".to_string());
    }

    let root_skill_md = Path::new("SKILL.md");
    let has_root_skill_md = files.iter().any(|file| file.path == root_skill_md);
    let shared_zip_root = files
        .first()
        .and_then(|file| first_zip_component(&file.path));
    let should_strip_directory = shared_zip_root
        .as_deref()
        .map(|root| {
            let nested_skill_md = Path::new(root).join("SKILL.md");
            !has_root_skill_md
                && files.iter().any(|file| file.path == nested_skill_md)
                && files
                    .iter()
                    .all(|file| first_zip_component(&file.path).as_deref() == Some(root))
        })
        .unwrap_or(false);

    Ok(SkillZipPackage {
        files,
        shared_zip_root,
        should_strip_directory,
    })
}

fn normalize_skill_zip_relative_path(
    path: &Path,
    should_strip_directory: bool,
) -> Result<PathBuf, String> {
    let relative_path = if should_strip_directory {
        strip_first_zip_component(path)?
    } else {
        path.to_path_buf()
    };
    let relative_path_text = relative_path
        .to_str()
        .ok_or_else(|| "Skill zip entry path must be valid UTF-8".to_string())?;
    validate_skill_package_file_path(relative_path_text)
}

fn skill_zip_path_to_display_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let text = value
                    .to_str()
                    .ok_or_else(|| "Skill zip entry path must be valid UTF-8".to_string())?;
                parts.push(text.to_string());
            }
            _ => return Err(format!("Invalid skill zip entry path: {}", path.display())),
        }
    }
    if parts.is_empty() {
        return Err("Skill zip entry path is required".to_string());
    }
    Ok(parts.join("/"))
}

fn build_skill_package_file_entries(package: &SkillZipPackage) -> Result<Vec<Value>, String> {
    let mut directories = BTreeSet::new();
    let mut files = Vec::new();

    for file in &package.files {
        let relative_path =
            normalize_skill_zip_relative_path(&file.path, package.should_strip_directory)?;
        let display_path = skill_zip_path_to_display_path(&relative_path)?;

        let mut current = PathBuf::new();
        let mut components = relative_path.components().peekable();
        while let Some(component) = components.next() {
            if components.peek().is_none() {
                break;
            }
            match component {
                Component::Normal(value) => {
                    current.push(value);
                    directories.insert(skill_zip_path_to_display_path(&current)?);
                }
                _ => {
                    return Err(format!(
                        "Invalid skill zip entry path: {}",
                        relative_path.display()
                    ));
                }
            }
        }

        files.push(json!({
            "path": display_path,
            "isDirectory": false,
            "size": file.content.len() as u64,
            "content": String::from_utf8(file.content.clone()).ok(),
        }));
    }

    let mut entries: Vec<Value> = directories
        .into_iter()
        .map(|path| {
            json!({
                "path": path,
                "isDirectory": true,
                "size": 0,
                "content": Value::Null,
            })
        })
        .collect();
    entries.extend(files);
    Ok(entries)
}

pub(super) fn collect_local_skill_detail_file_entries(
    root: &Path,
    current: &Path,
    directories: &mut BTreeSet<String>,
    files: &mut Vec<Value>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current)
        .map_err(|error| {
            format!(
                "Failed to read skill directory {}: {error}",
                current.display()
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read skill directory entry: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        if is_ignorable_skill_package_export_entry(&path) {
            continue;
        }

        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect skill file {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Local skill inspection does not support symlinks: {}",
                path.display()
            ));
        }
        let relative_path = path.strip_prefix(root).map_err(|error| {
            format!(
                "Failed to resolve skill file path {}: {error}",
                path.display()
            )
        })?;
        let display_path = path_to_skill_package_archive_path(relative_path)?;

        if metadata.is_dir() {
            directories.insert(display_path);
            collect_local_skill_detail_file_entries(root, &path, directories, files)?;
            continue;
        }

        if !metadata.is_file() {
            continue;
        }
        if metadata.len() > MAX_SKILL_PACKAGE_BYTES as u64 {
            return Err("Skill file is too large".to_string());
        }

        let content = fs::read(&path)
            .map_err(|error| format!("Failed to read skill file {}: {error}", path.display()))?;
        if content.len() > MAX_SKILL_PACKAGE_BYTES {
            return Err("Skill file is too large".to_string());
        }
        files.push(json!({
            "path": display_path,
            "isDirectory": false,
            "size": content.len() as u64,
            "content": String::from_utf8(content).ok(),
        }));
    }

    Ok(())
}

fn write_skill_zip_package_files(
    target_dir: &Path,
    package: &SkillZipPackage,
) -> Result<(), String> {
    let root_skill_md = Path::new("SKILL.md");
    let mut has_skill_md = false;

    for file in &package.files {
        let relative_path =
            normalize_skill_zip_relative_path(&file.path, package.should_strip_directory)?;
        if relative_path == root_skill_md {
            has_skill_md = true;
        }
        let destination = target_dir.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create skill file parent {}: {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(&destination, &file.content).map_err(|error| {
            format!(
                "Failed to write skill package file {}: {error}",
                destination.display()
            )
        })?;
    }

    if !has_skill_md {
        return Err("Skill package missing SKILL.md".to_string());
    }

    Ok(())
}

pub(super) fn resolve_skill_package_directory_name(
    package: &SkillZipPackage,
    fallback_name: &str,
) -> Result<String, String> {
    let directory = if package.should_strip_directory {
        package.shared_zip_root.as_deref().unwrap_or(fallback_name)
    } else {
        fallback_name
    }
    .trim();
    validate_skill_package_directory(directory)?;
    Ok(directory.to_string())
}

pub(super) fn resolve_local_skill_package_fallback_name(
    source_path: &Path,
) -> Result<String, String> {
    let fallback = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Failed to resolve skill package file name".to_string())?
        .trim();
    validate_skill_package_directory(fallback)?;
    Ok(fallback.to_string())
}

pub(super) fn read_local_skill_package_file(
    source_path: &Path,
) -> Result<(PathBuf, Vec<u8>), String> {
    let canonical_source = source_path.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve skill package source {}: {error}",
            source_path.display()
        )
    })?;
    if !canonical_source.is_file() {
        return Err("Skill package source path must be a file".to_string());
    }

    let metadata = fs::metadata(&canonical_source).map_err(|error| {
        format!(
            "Failed to read skill package metadata {}: {error}",
            canonical_source.display()
        )
    })?;
    if metadata.len() > MAX_SKILL_PACKAGE_BYTES as u64 {
        return Err("Skill package is too large".to_string());
    }

    let bytes = fs::read(&canonical_source).map_err(|error| {
        format!(
            "Failed to read skill package {}: {error}",
            canonical_source.display()
        )
    })?;
    if bytes.len() > MAX_SKILL_PACKAGE_BYTES {
        return Err("Skill package is too large".to_string());
    }

    Ok((canonical_source, bytes))
}

pub(super) fn inspect_skill_zip_package(
    fallback_name: &str,
    bytes: &[u8],
) -> Result<SkillPackageLocalInspectResponse, String> {
    let package = read_skill_zip_package(bytes)?;
    let directory = resolve_skill_package_directory_name(&package, fallback_name)?;
    let files = build_skill_package_file_entries(&package)?;
    let temp_dir = tempfile::TempDir::new()
        .map_err(|error| format!("Failed to create skill package preview: {error}"))?;
    let target_dir = temp_dir.path().join(&directory);
    fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "Failed to create skill package preview directory {}: {error}",
            target_dir.display()
        )
    })?;
    write_skill_zip_package_files(&target_dir, &package)?;
    let inspection = SkillService::inspect_skill_dir(&target_dir)
        .map_err(|error| format!("Skill package failed inspection: {error}"))?;

    Ok(SkillPackageLocalInspectResponse {
        directory,
        inspection: serde_json::to_value(inspection)
            .map_err(|error| format!("Failed to serialize skill inspection: {error}"))?,
        files,
    })
}

pub(crate) fn install_skill_zip_package_into_root(
    skills_root: &Path,
    skill_name: &str,
    package: SkillZipPackage,
) -> Result<SkillPackageLocalInstallResponse, String> {
    let directory = skill_name.trim();
    validate_skill_package_directory(directory)?;

    fs::create_dir_all(skills_root).map_err(|error| {
        format!(
            "Failed to create skills root {}: {error}",
            skills_root.display()
        )
    })?;
    let target_dir = skills_root.join(directory);
    if target_dir.exists() {
        return Err(format!("Skill directory already exists: {directory}"));
    }
    fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "Failed to create skill directory {}: {error}",
            target_dir.display()
        )
    })?;

    if let Err(error) = write_skill_zip_package_files(&target_dir, &package) {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(error);
    }

    match SkillService::inspect_skill_dir(&target_dir) {
        Ok(inspection) if inspection.standard_compliance.validation_errors.is_empty() => {
            Ok(SkillPackageLocalInstallResponse {
                directory: directory.to_string(),
                inspection: serde_json::to_value(inspection)
                    .map_err(|error| format!("Failed to serialize skill inspection: {error}"))?,
            })
        }
        Ok(inspection) => {
            let _ = fs::remove_dir_all(&target_dir);
            Err(format!(
                "Installed skill package is not Agent Skills compliant: {}",
                inspection.standard_compliance.validation_errors.join("; ")
            ))
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&target_dir);
            Err(format!(
                "Installed skill package failed inspection: {error}"
            ))
        }
    }
}

pub(super) fn install_skill_zip_package_into_staged_dir(
    target_dir: &Path,
    directory: &str,
    package: SkillZipPackage,
) -> Result<SkillPackageLocalReplaceResponse, String> {
    validate_skill_package_directory(directory)?;

    fs::create_dir_all(target_dir).map_err(|error| {
        format!(
            "Failed to create replacement skill directory {}: {error}",
            target_dir.display()
        )
    })?;

    if let Err(error) = write_skill_zip_package_files(target_dir, &package) {
        let _ = fs::remove_dir_all(target_dir);
        return Err(error);
    }

    match SkillService::inspect_skill_dir(target_dir) {
        Ok(inspection) if inspection.standard_compliance.validation_errors.is_empty() => {
            Ok(SkillPackageLocalReplaceResponse {
                directory: directory.to_string(),
                inspection: serde_json::to_value(inspection)
                    .map_err(|error| format!("Failed to serialize skill inspection: {error}"))?,
            })
        }
        Ok(inspection) => {
            let _ = fs::remove_dir_all(target_dir);
            Err(format!(
                "Replacement skill is not Agent Skills compliant: {}",
                inspection.standard_compliance.validation_errors.join("; ")
            ))
        }
        Err(error) => {
            let _ = fs::remove_dir_all(target_dir);
            Err(format!("Replacement skill failed inspection: {error}"))
        }
    }
}
