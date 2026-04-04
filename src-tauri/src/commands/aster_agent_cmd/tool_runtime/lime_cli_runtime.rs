use super::*;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use tauri::Manager;

const LIME_CLI_PATH_ENV: &str = "LIME_CLI_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
enum LimeCliInvocation {
    Binary(PathBuf),
    Cargo { manifest_path: PathBuf },
}

#[derive(Debug, Default)]
struct LimeCliDiscoveryContext {
    env_override: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    current_exe: Option<PathBuf>,
    current_dir: Option<PathBuf>,
    path_var: Option<OsString>,
}

pub(crate) fn prefix_shell_command_with_lime_cli(
    command: &str,
    app_handle: Option<&AppHandle>,
) -> String {
    let Some(invocation) = resolve_lime_cli_invocation(app_handle) else {
        return command.to_string();
    };

    match invocation {
        LimeCliInvocation::Binary(path) => prefix_command_with_binary(command, &path),
        LimeCliInvocation::Cargo { manifest_path } => {
            prefix_command_with_cargo_fallback(command, &manifest_path)
        }
    }
}

fn resolve_lime_cli_invocation(app_handle: Option<&AppHandle>) -> Option<LimeCliInvocation> {
    let current_dir = std::env::current_dir().ok();
    let context = LimeCliDiscoveryContext {
        env_override: std::env::var_os(LIME_CLI_PATH_ENV)
            .map(PathBuf::from)
            .map(|path| resolve_relative_path(path, current_dir.as_deref())),
        resource_dir: app_handle.and_then(|handle| handle.path().resource_dir().ok()),
        current_exe: std::env::current_exe().ok(),
        current_dir,
        path_var: std::env::var_os("PATH"),
    };
    resolve_lime_cli_invocation_from_context(&context)
}

fn resolve_lime_cli_invocation_from_context(
    context: &LimeCliDiscoveryContext,
) -> Option<LimeCliInvocation> {
    for candidate in binary_candidates(context) {
        if is_existing_file(&candidate) {
            return Some(LimeCliInvocation::Binary(candidate));
        }
    }

    resolve_cargo_invocation(context)
}

fn binary_candidates(context: &LimeCliDiscoveryContext) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path) = context.env_override.as_ref() {
        push_unique_path(&mut candidates, path.clone());
    }

    if let Some(resource_dir) = context.resource_dir.as_ref() {
        for relative in [
            PathBuf::from("resources")
                .join("bin")
                .join(binary_file_name()),
            PathBuf::from("bin").join(binary_file_name()),
        ] {
            push_unique_path(&mut candidates, resource_dir.join(relative));
        }
    }

    if let Some(current_exe) = context.current_exe.as_ref() {
        if let Some(parent) = current_exe.parent() {
            push_unique_path(&mut candidates, parent.join(binary_file_name()));
        }
    }

    if let Some(current_dir) = context.current_dir.as_ref() {
        for relative in [
            PathBuf::from("src-tauri")
                .join("target")
                .join("debug")
                .join(binary_file_name()),
            PathBuf::from("src-tauri")
                .join("target")
                .join("release")
                .join(binary_file_name()),
            PathBuf::from("target")
                .join("debug")
                .join(binary_file_name()),
            PathBuf::from("target")
                .join("release")
                .join(binary_file_name()),
            PathBuf::from("src-tauri")
                .join("resources")
                .join("bin")
                .join(binary_file_name()),
            PathBuf::from("resources")
                .join("bin")
                .join(binary_file_name()),
        ] {
            push_unique_path(&mut candidates, current_dir.join(relative));
        }
    }

    if let Some(path_var) = context.path_var.as_ref() {
        for entry in std::env::split_paths(path_var) {
            push_unique_path(&mut candidates, entry.join(binary_file_name()));
        }
    }

    candidates
}

fn resolve_cargo_invocation(context: &LimeCliDiscoveryContext) -> Option<LimeCliInvocation> {
    if !cargo_available(context.path_var.as_ref()) {
        return None;
    }

    for manifest_path in cargo_manifest_candidates(context) {
        if is_existing_file(&manifest_path) {
            return Some(LimeCliInvocation::Cargo { manifest_path });
        }
    }

    None
}

fn cargo_manifest_candidates(context: &LimeCliDiscoveryContext) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(current_dir) = context.current_dir.as_ref() {
        for relative in [
            PathBuf::from("src-tauri").join("Cargo.toml"),
            PathBuf::from("Cargo.toml"),
        ] {
            push_unique_path(&mut candidates, current_dir.join(relative));
        }
    }

    candidates
}

fn cargo_available(path_var: Option<&OsString>) -> bool {
    if let Some(cargo_env) = std::env::var_os("CARGO") {
        let cargo_path = PathBuf::from(cargo_env);
        if is_existing_file(&cargo_path) {
            return true;
        }
    }

    let Some(path_var) = path_var else {
        return false;
    };

    std::env::split_paths(path_var)
        .map(|entry| entry.join(cargo_binary_name()))
        .any(|candidate| is_existing_file(&candidate))
}

fn resolve_relative_path(path: PathBuf, base_dir: Option<&Path>) -> PathBuf {
    if path.is_absolute() {
        return path;
    }

    base_dir.map(|base| base.join(path.clone())).unwrap_or(path)
}

fn push_unique_path(target: &mut Vec<PathBuf>, path: PathBuf) {
    if target.iter().any(|existing| existing == &path) {
        return;
    }
    target.push(path);
}

fn is_existing_file(path: &Path) -> bool {
    path.is_file()
}

fn prefix_command_with_binary(command: &str, binary_path: &Path) -> String {
    let binary_str = binary_path.to_string_lossy().to_string();
    let binary_dir = binary_path
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        let binary = escape_powershell_string(&binary_str);
        let dir = escape_powershell_string(&binary_dir);
        return format!(
            "function global:lime {{ & '{binary}' @args }}\n$env:{LIME_CLI_PATH_ENV} = '{binary}'\n$env:PATH = '{dir};' + $env:PATH\n{command}"
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        let binary = shell_escape(&binary_str);
        let dir = shell_escape(&binary_dir);
        format!(
            "lime() {{ {binary} \"$@\"; }}\nexport {LIME_CLI_PATH_ENV}={binary}\nexport PATH={dir}:\"$PATH\"\n{command}"
        )
    }
}

fn prefix_command_with_cargo_fallback(command: &str, manifest_path: &Path) -> String {
    let manifest = manifest_path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        let manifest = escape_powershell_string(&manifest);
        return format!(
            "function global:lime {{ & cargo run --quiet --manifest-path '{manifest}' -p lime-cli -- @args }}\n{command}"
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        let manifest = shell_escape(&manifest);
        format!(
            "lime() {{ cargo run --quiet --manifest-path {manifest} -p lime-cli -- \"$@\"; }}\n{command}"
        )
    }
}

#[cfg(target_os = "windows")]
fn binary_file_name() -> &'static str {
    "lime.exe"
}

#[cfg(not(target_os = "windows"))]
fn binary_file_name() -> &'static str {
    "lime"
}

#[cfg(target_os = "windows")]
fn cargo_binary_name() -> &'static str {
    "cargo.exe"
}

#[cfg(not(target_os = "windows"))]
fn cargo_binary_name() -> &'static str {
    "cargo"
}

#[cfg(not(target_os = "windows"))]
fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "windows")]
fn escape_powershell_string(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_lime_cli_invocation_prefers_explicit_binary_override() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let binary_path = temp_dir.path().join(binary_file_name());
        std::fs::write(&binary_path, b"binary").expect("write binary");

        let context = LimeCliDiscoveryContext {
            env_override: Some(binary_path.clone()),
            ..Default::default()
        };

        let invocation = resolve_lime_cli_invocation_from_context(&context).expect("invocation");
        assert_eq!(invocation, LimeCliInvocation::Binary(binary_path));
    }

    #[test]
    fn resolve_lime_cli_invocation_falls_back_to_dev_cargo_manifest() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let src_tauri_dir = temp_dir.path().join("src-tauri");
        std::fs::create_dir_all(&src_tauri_dir).expect("create src-tauri dir");
        let manifest_path = src_tauri_dir.join("Cargo.toml");
        std::fs::write(&manifest_path, b"[workspace]\n").expect("write manifest");

        let cargo_dir = temp_dir.path().join("bin");
        std::fs::create_dir_all(&cargo_dir).expect("create cargo dir");
        let cargo_path = cargo_dir.join(cargo_binary_name());
        std::fs::write(&cargo_path, b"cargo").expect("write cargo binary");

        let context = LimeCliDiscoveryContext {
            current_dir: Some(temp_dir.path().to_path_buf()),
            path_var: Some(std::env::join_paths([cargo_dir]).expect("join paths")),
            ..Default::default()
        };

        let invocation = resolve_lime_cli_invocation_from_context(&context).expect("invocation");
        assert_eq!(invocation, LimeCliInvocation::Cargo { manifest_path });
    }

    #[test]
    fn prefix_shell_command_with_cargo_fallback_defines_lime_function() {
        let command = prefix_command_with_cargo_fallback(
            "lime media image generate --prompt demo",
            Path::new("/tmp/src-tauri/Cargo.toml"),
        );

        #[cfg(target_os = "windows")]
        assert!(command.contains("function global:lime"));

        #[cfg(not(target_os = "windows"))]
        assert!(command.contains("lime()"));

        assert!(command.contains("cargo run --quiet"));
        assert!(command.contains("lime media image generate --prompt demo"));
    }
}
