//! Lime 运行时 AGENTS 指令加载
//!
//! 仅用于 Lime 应用运行时会话：
//! - 全局：`~/.lime/AGENTS.md`
//! - 工作区：`<workspace>/.lime/AGENTS.md`

use lime_core::app_paths;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const RUNTIME_AGENTS_PROMPT_MARKER: &str = "【Lime Runtime AGENTS 指令】";

pub fn merge_system_prompt_with_runtime_agents(
    base_prompt: Option<String>,
    working_dir: Option<&Path>,
) -> Option<String> {
    let runtime_prompt = build_runtime_agents_prompt(working_dir);
    match (base_prompt, runtime_prompt) {
        (Some(base), Some(runtime)) => {
            if base.contains(RUNTIME_AGENTS_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(runtime)
            } else {
                Some(format!("{base}\n\n{runtime}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(runtime)) => Some(runtime),
        (None, None) => None,
    }
}

pub fn build_runtime_agents_prompt(working_dir: Option<&Path>) -> Option<String> {
    let global_path = app_paths::best_effort_user_memory_path();
    let workspace_path = working_dir.map(|dir| dir.join(".lime").join("AGENTS.md"));
    build_runtime_agents_prompt_with_paths(Some(global_path.as_path()), workspace_path.as_deref())
}

fn build_runtime_agents_prompt_with_paths(
    global_path: Option<&Path>,
    workspace_path: Option<&Path>,
) -> Option<String> {
    let mut sections = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();

    if let Some((path, content)) = load_runtime_agents_layer(global_path, &mut seen) {
        sections.push(format!(
            "### 全局运行时指令 ({})\n{}",
            path.display(),
            content
        ));
    }

    if let Some((path, content)) = load_runtime_agents_layer(workspace_path, &mut seen) {
        sections.push(format!(
            "### Workspace 运行时指令 ({})\n{}",
            path.display(),
            content
        ));
    }

    if sections.is_empty() {
        None
    } else {
        Some(format!(
            "{RUNTIME_AGENTS_PROMPT_MARKER}\n以下内容来自 Lime 运行时 AGENTS 文件，请优先遵循：\n\n{}",
            sections.join("\n\n")
        ))
    }
}

fn load_runtime_agents_layer(
    path: Option<&Path>,
    seen: &mut HashSet<PathBuf>,
) -> Option<(PathBuf, String)> {
    let path = path?;
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !seen.insert(normalized.clone()) || !normalized.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&normalized).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some((normalized, trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn should_build_prompt_with_global_and_workspace_layers() {
        let tmp = TempDir::new().expect("create temp dir");
        let global_path = tmp.path().join("global").join("AGENTS.md");
        let workspace_path = tmp.path().join("workspace").join(".lime").join("AGENTS.md");
        fs::create_dir_all(global_path.parent().expect("global parent")).expect("create global");
        fs::create_dir_all(workspace_path.parent().expect("workspace parent"))
            .expect("create workspace");
        fs::write(&global_path, "- 全局偏好").expect("write global agents");
        fs::write(&workspace_path, "- 工作区偏好").expect("write workspace agents");

        let prompt = build_runtime_agents_prompt_with_paths(
            Some(global_path.as_path()),
            Some(workspace_path.as_path()),
        )
        .expect("prompt should exist");

        assert!(prompt.contains(RUNTIME_AGENTS_PROMPT_MARKER));
        assert!(prompt.contains("全局偏好"));
        assert!(prompt.contains("工作区偏好"));
    }

    #[test]
    fn should_skip_duplicate_paths() {
        let tmp = TempDir::new().expect("create temp dir");
        let path = tmp.path().join("shared").join("AGENTS.md");
        fs::create_dir_all(path.parent().expect("shared parent")).expect("create dir");
        fs::write(&path, "- 同一路径").expect("write agents");

        let prompt =
            build_runtime_agents_prompt_with_paths(Some(path.as_path()), Some(path.as_path()))
                .expect("prompt should exist");

        assert_eq!(prompt.matches("### ").count(), 1);
    }

    #[test]
    fn merge_should_append_runtime_agents_once() {
        let merged = merge_system_prompt_with_runtime_agents(
            Some(format!("{RUNTIME_AGENTS_PROMPT_MARKER}\n已有内容")),
            None,
        )
        .expect("merged prompt");

        assert_eq!(merged.matches(RUNTIME_AGENTS_PROMPT_MARKER).count(), 1);
    }
}
