use super::{invalid_params, io_error};
use app_server_protocol::JsonRpcError;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub(super) fn ensure_local_host(host: Option<&str>) -> Result<(), JsonRpcError> {
    if host.is_some_and(|host| host != "local") {
        return Err(invalid_params(
            "Local environments are only available on the local host",
        ));
    }
    Ok(())
}

fn absolute_path(value: &str) -> Result<PathBuf, JsonRpcError> {
    let path = Path::new(value);
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(invalid_params(
            "Environment paths must be absolute and cannot contain '..'",
        ));
    }
    Ok(path.components().collect())
}

pub(super) fn workspace_root(value: &str) -> Result<PathBuf, JsonRpcError> {
    let path = absolute_path(value)?;
    if !fs::metadata(&path).map_err(io_error)?.is_dir() {
        return Err(invalid_params(
            "workspaceRoot must be an existing directory",
        ));
    }
    fs::canonicalize(path).map_err(io_error)
}

pub(super) fn config_path(value: &str) -> Result<PathBuf, JsonRpcError> {
    let path = absolute_path(value)?;
    let parent = path
        .parent()
        .ok_or_else(|| invalid_params("configPath has no parent"))?;
    if path.extension().is_none_or(|extension| extension != "toml")
        || parent.file_name().is_none_or(|name| name != "environments")
        || parent
            .parent()
            .and_then(Path::file_name)
            .is_none_or(|name| name != ".lime")
    {
        return Err(invalid_params(
            "configPath must be a .toml file in .lime/environments",
        ));
    }
    let project = parent
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| invalid_params("configPath has no project root"))?;
    let project = fs::canonicalize(project).map_err(io_error)?;
    if !project.is_dir() {
        return Err(invalid_params(
            "Environment project root must be a directory",
        ));
    }
    let path = project
        .join(".lime")
        .join("environments")
        .join(path.file_name().unwrap());
    check_environment_directory(path.parent().unwrap())?;
    check_file(&path)?;
    Ok(path)
}

fn check_directory(path: &Path) -> Result<(), JsonRpcError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => Ok(()),
        Ok(_) => Err(invalid_params(
            "Environment directories must not be symlinks or files",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

pub(super) fn check_environment_directory(path: &Path) -> Result<(), JsonRpcError> {
    if let Some(parent) = path.parent() {
        check_directory(parent)?;
    }
    check_directory(path)
}

pub(super) fn check_file(path: &Path) -> Result<(), JsonRpcError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => Ok(()),
        Ok(_) => Err(invalid_params(
            "Environment config must be a regular file, not a symlink",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

pub(super) fn create_environment_directory(path: &Path) -> Result<(), JsonRpcError> {
    let parent = path.parent().expect("validated .lime directory");
    for directory in [parent, path] {
        match fs::create_dir(directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(io_error(error)),
        }
        check_directory(directory)?;
    }
    Ok(())
}

pub(super) fn cwd_relative_to_git_root(path: &Path) -> String {
    let project = path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or(path);
    let git_root = project
        .ancestors()
        .find(|ancestor| ancestor.join(".git").exists());
    git_root
        .and_then(|root| project.strip_prefix(root).ok())
        .filter(|path| !path.as_os_str().is_empty())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| ".".into())
}
