//! 工作树 setup 的 shell 环境差异；文件位置由 Git 的 --git-path 决定。

use super::super::{git_command_output_from, output_to_string, GIT_COMMAND_TIMEOUT};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "lime-shell-environment.json";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeShellEnvironment {
    version: u8,
    set: BTreeMap<String, String>,
    exclude: Vec<String>,
}

impl std::fmt::Debug for WorktreeShellEnvironment {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorktreeShellEnvironment")
            .field("version", &self.version)
            .field("set_count", &self.set.len())
            .field("exclude_count", &self.exclude.len())
            .finish()
    }
}

impl WorktreeShellEnvironment {
    pub fn set(&self) -> &BTreeMap<String, String> {
        &self.set
    }

    pub fn exclude(&self) -> &[String] {
        &self.exclude
    }

    pub fn from_captures(before: &str, after: &str) -> Option<Self> {
        Self::between(
            parse_capture(before),
            parse_capture(after),
            cfg!(target_os = "windows"),
        )
    }

    fn between(
        before: BTreeMap<String, String>,
        after: BTreeMap<String, String>,
        windows: bool,
    ) -> Option<Self> {
        let normalize = |entries: BTreeMap<String, String>| {
            entries
                .into_iter()
                .map(|(key, value)| (normalize_key(&key, windows), (key, value)))
                .collect::<BTreeMap<_, _>>()
        };
        let before = normalize(before);
        let after = normalize(after);
        let keys = before.keys().chain(after.keys()).collect::<BTreeSet<_>>();
        let mut set = BTreeMap::new();
        let mut exclude = Vec::new();
        for key in keys {
            let old = before.get(key);
            let new = after.get(key);
            let (name, _) = new.or(old).expect("key belongs to a capture");
            if ignored_key(key)
                || old.is_some_and(|(_, value)| value.contains(['\r', '\n']))
                || new.is_some_and(|(_, value)| value.contains(['\r', '\n']))
            {
                continue;
            }
            if let Some((_, value)) = new {
                if old.map(|(_, value)| value) != Some(value) {
                    set.insert(name.clone(), value.clone());
                }
            } else {
                exclude.push(name.clone());
            }
        }
        exclude.sort();
        (!set.is_empty() || !exclude.is_empty()).then_some(Self {
            version: 1,
            set,
            exclude,
        })
    }

    pub fn apply_to(&self, environment: &mut HashMap<String, String>) {
        self.apply_to_for_platform(environment, cfg!(target_os = "windows"));
    }

    fn apply_to_for_platform(&self, environment: &mut HashMap<String, String>, windows: bool) {
        let replaced = self
            .exclude
            .iter()
            .chain(self.set.keys())
            .map(|key| normalize_key(key, windows))
            .collect::<BTreeSet<_>>();
        environment.retain(|key, _| !replaced.contains(&normalize_key(key, windows)));
        environment.extend(self.set.clone());
    }
}

fn parse_capture(capture: &str) -> BTreeMap<String, String> {
    capture
        .trim_start_matches('\u{feff}')
        .split('\n')
        .filter_map(|line| {
            let (key, value) = line.strip_suffix('\r').unwrap_or(line).split_once('=')?;
            (!key.is_empty()).then(|| (key.to_string(), value.to_string()))
        })
        .collect()
}

fn normalize_key(key: &str, windows: bool) -> String {
    if windows {
        key.to_uppercase()
    } else {
        key.to_string()
    }
}

fn ignored_key(key: &str) -> bool {
    matches!(
        key,
        "LIME_SOURCE_TREE_PATH"
            | "LIME_WORKTREE_PATH"
            | "LIME_SETUP_EXIT_CODE"
            | "LIME_SHELL"
            | "OLDPWD"
            | "PWD"
            | "SHELLOPTS"
            | "SHLVL"
            | "_"
    ) || key.starts_with("BASH_FUNC_")
}

async fn config_path(cwd: &Path) -> Result<Option<PathBuf>, String> {
    let output = git_command_output_from(
        Path::new("git"),
        cwd,
        &["rev-parse", "--git-path", FILE_NAME],
        GIT_COMMAND_TIMEOUT,
    )
    .await?;
    if output.status.code() == Some(128) {
        return Ok(None);
    }
    let path = PathBuf::from(output_to_string(output)?.trim());
    Ok(Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    }))
}

pub async fn read_worktree_shell_environment(
    cwd: &Path,
) -> Result<Option<WorktreeShellEnvironment>, String> {
    let Some(path) = config_path(cwd).await? else {
        return Ok(None);
    };
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Failed to read worktree shell environment".into()),
    };
    let environment: WorktreeShellEnvironment = serde_json::from_str(&raw)
        .map_err(|_| "Invalid worktree shell environment config".to_string())?;
    if environment.version != 1 {
        return Err("Unsupported worktree shell environment version".into());
    }
    Ok(Some(environment))
}

pub async fn write_worktree_shell_environment(
    cwd: &Path,
    environment: &WorktreeShellEnvironment,
) -> Result<(), String> {
    let path = config_path(cwd)
        .await?
        .ok_or("No git repository found for worktree shell environment")?;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid git path")?)
        .map_err(|_| "Failed to prepare worktree shell environment".to_string())?;
    serde_json::to_writer_pretty(file.as_file_mut(), environment)
        .map_err(|_| "Failed to encode worktree shell environment".to_string())?;
    file.write_all(b"\n")
        .and_then(|_| file.as_file_mut().sync_all())
        .map_err(|_| "Failed to write worktree shell environment".to_string())?;
    file.persist(path)
        .map_err(|_| "Failed to save worktree shell environment".to_string())?;
    Ok(())
}

pub async fn remove_worktree_shell_environment(cwd: &Path) -> Result<(), String> {
    let Some(path) = config_path(cwd).await? else {
        return Ok(());
    };
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Failed to remove worktree shell environment".into()),
    }
}

#[cfg(test)]
mod tests;
