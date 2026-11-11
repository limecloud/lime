use super::is_ignorable_skill_package_export_entry;
use super::path_to_skill_package_archive_path;
use super::MAX_SKILL_PACKAGE_BYTES;
use crate::local_data_source::skills::common::resolve_skill_package_dir;
use crate::local_data_source::skills::common::validate_skill_package_directory;
use app_server_protocol::SkillPackageExportResponse;
use lime_services::skill_service::SkillService;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

const SKILL_PACKAGE_EXTENSIONS: &[&str] = &["skill", "skills"];

#[derive(Debug, Clone)]
struct SkillPackageExportFile {
    source_path: PathBuf,
    archive_path: String,
}

fn is_skill_package_extension(extension: &str) -> bool {
    SKILL_PACKAGE_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
}

pub(crate) fn normalize_skill_package_output_path(target_path: &str) -> Result<PathBuf, String> {
    let target_path = target_path.trim();
    if target_path.is_empty() {
        return Err("Skill package export path is required".to_string());
    }

    let path = PathBuf::from(target_path);
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return Err("Skill package export path must end with .skill or .skills".to_string());
    };
    if !is_skill_package_extension(extension) {
        return Err("Skill package export path must end with .skill or .skills".to_string());
    }

    Ok(path)
}

fn collect_skill_package_export_files(
    root_dir: &Path,
    current_dir: &Path,
    directory: &str,
    files: &mut Vec<SkillPackageExportFile>,
    total_size: &mut u64,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current_dir)
        .map_err(|error| {
            format!(
                "Failed to read skill directory {}: {error}",
                current_dir.display()
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
            .map_err(|error| format!("Failed to read skill file {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Skill package export does not support symlinks: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_skill_package_export_files(root_dir, &path, directory, files, total_size)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(format!(
                "Unsupported skill package export entry: {}",
                path.display()
            ));
        }

        let next_total = total_size
            .checked_add(metadata.len())
            .ok_or_else(|| "Skill package is too large".to_string())?;
        if next_total > MAX_SKILL_PACKAGE_BYTES as u64 {
            return Err("Skill package is too large".to_string());
        }
        *total_size = next_total;

        let relative_path = path.strip_prefix(root_dir).map_err(|error| {
            format!(
                "Failed to resolve skill package relative path {}: {error}",
                path.display()
            )
        })?;
        let archive_path =
            path_to_skill_package_archive_path(&Path::new(directory).join(relative_path))?;
        files.push(SkillPackageExportFile {
            source_path: path,
            archive_path,
        });
    }

    Ok(())
}

fn ensure_skill_package_export_target_allowed(
    skill_dir: &Path,
    target_path: &Path,
) -> Result<(), String> {
    let Some(parent) = target_path.parent() else {
        return Ok(());
    };
    if parent.as_os_str().is_empty() {
        return Ok(());
    }

    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create skill package export directory {}: {error}",
            parent.display()
        )
    })?;

    let canonical_parent = parent.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve skill package export directory {}: {error}",
            parent.display()
        )
    })?;
    if canonical_parent.starts_with(skill_dir) {
        return Err("Skill package export path cannot be inside the Skill directory".to_string());
    }
    Ok(())
}

pub(crate) fn export_local_skill_package_to_path(
    skill_roots: &[PathBuf],
    directory: &str,
    target_path: &Path,
) -> Result<SkillPackageExportResponse, String> {
    validate_skill_package_directory(directory)?;
    let skill_dir = resolve_skill_package_dir(skill_roots, directory)?;
    let inspection = SkillService::inspect_skill_dir(&skill_dir)
        .map_err(|error| format!("Skill failed inspection before export: {error}"))?;
    if !inspection.standard_compliance.validation_errors.is_empty() {
        return Err(format!(
            "Skill is not Agent Skills compliant: {}",
            inspection.standard_compliance.validation_errors.join("; ")
        ));
    }

    ensure_skill_package_export_target_allowed(&skill_dir, target_path)?;

    let mut files = Vec::new();
    let mut total_size = 0;
    collect_skill_package_export_files(
        &skill_dir,
        &skill_dir,
        directory,
        &mut files,
        &mut total_size,
    )?;
    if files.is_empty() {
        return Err("Skill package export contains no files".to_string());
    }

    let export_file = fs::File::create(target_path).map_err(|error| {
        format!(
            "Failed to create skill package export {}: {error}",
            target_path.display()
        )
    })?;
    let mut writer = ZipWriter::new(export_file);
    let file_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for file in &files {
        writer
            .start_file(&file.archive_path, file_options)
            .map_err(|error| {
                format!(
                    "Failed to write skill package entry {}: {error}",
                    file.archive_path
                )
            })?;
        let mut source_file = fs::File::open(&file.source_path).map_err(|error| {
            format!(
                "Failed to open skill package file {}: {error}",
                file.source_path.display()
            )
        })?;
        io::copy(&mut source_file, &mut writer).map_err(|error| {
            format!(
                "Failed to compress skill package file {}: {error}",
                file.source_path.display()
            )
        })?;
    }

    writer.finish().map_err(|error| {
        let _ = fs::remove_file(target_path);
        format!(
            "Failed to finish skill package export {}: {error}",
            target_path.display()
        )
    })?;
    let bytes_written = fs::metadata(target_path)
        .map(|metadata| metadata.len())
        .unwrap_or(total_size);

    Ok(SkillPackageExportResponse {
        directory: directory.to_string(),
        output_path: target_path.to_string_lossy().to_string(),
        file_count: files.len() as u64,
        bytes_written,
    })
}
