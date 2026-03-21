//! 运行时 AGENTS 模板生成服务
//!
//! 为 Lime 应用运行时会话显式生成 `.lime/AGENTS.md` 模板。

use lime_core::app_paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeAgentsTemplateTarget {
    Global,
    Workspace,
    WorkspaceLocal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeAgentsTemplateScaffoldStatus {
    Created,
    Exists,
    Overwritten,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceGitignoreEnsureStatus {
    Created,
    Added,
    Exists,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAgentsTemplateScaffoldResult {
    pub target: RuntimeAgentsTemplateTarget,
    pub path: String,
    pub status: RuntimeAgentsTemplateScaffoldStatus,
    pub created_parent_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitignoreEnsureResult {
    pub path: String,
    pub entry: String,
    pub status: WorkspaceGitignoreEnsureStatus,
}

pub fn scaffold_runtime_agents_template(
    target: RuntimeAgentsTemplateTarget,
    working_dir: Option<&Path>,
    overwrite: bool,
) -> Result<RuntimeAgentsTemplateScaffoldResult, String> {
    let path = resolve_runtime_agents_template_path(target, working_dir)?;
    scaffold_runtime_agents_template_at_path(target, &path, overwrite)
}

pub fn ensure_workspace_local_agents_gitignore(
    working_dir: &Path,
) -> Result<WorkspaceGitignoreEnsureResult, String> {
    let gitignore_path = working_dir.join(".gitignore");
    ensure_gitignore_entry(&gitignore_path, ".lime/AGENTS.local.md")
}

fn resolve_runtime_agents_template_path(
    target: RuntimeAgentsTemplateTarget,
    working_dir: Option<&Path>,
) -> Result<PathBuf, String> {
    match target {
        RuntimeAgentsTemplateTarget::Global => Ok(app_paths::best_effort_user_memory_path()),
        RuntimeAgentsTemplateTarget::Workspace => {
            let working_dir =
                working_dir.ok_or_else(|| "生成 Workspace 模板时缺少 working_dir".to_string())?;
            Ok(working_dir.join(".lime").join("AGENTS.md"))
        }
        RuntimeAgentsTemplateTarget::WorkspaceLocal => {
            let working_dir = working_dir
                .ok_or_else(|| "生成 Workspace 本机模板时缺少 working_dir".to_string())?;
            Ok(working_dir.join(".lime").join("AGENTS.local.md"))
        }
    }
}

fn scaffold_runtime_agents_template_at_path(
    target: RuntimeAgentsTemplateTarget,
    path: &Path,
    overwrite: bool,
) -> Result<RuntimeAgentsTemplateScaffoldResult, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法解析模板目录: {}", path.display()))?;
    let created_parent_dir = !parent.exists();
    fs::create_dir_all(parent)
        .map_err(|e| format!("创建模板目录失败 {}: {e}", parent.display()))?;

    if path.exists() && path.is_dir() {
        return Err(format!("模板路径指向目录而不是文件: {}", path.display()));
    }

    let existed = path.exists();
    if existed && !overwrite {
        return Ok(RuntimeAgentsTemplateScaffoldResult {
            target,
            path: path.to_string_lossy().to_string(),
            status: RuntimeAgentsTemplateScaffoldStatus::Exists,
            created_parent_dir,
        });
    }

    fs::write(path, template_content_for_target(target))
        .map_err(|e| format!("写入模板失败 {}: {e}", path.display()))?;

    Ok(RuntimeAgentsTemplateScaffoldResult {
        target,
        path: path.to_string_lossy().to_string(),
        status: if existed {
            RuntimeAgentsTemplateScaffoldStatus::Overwritten
        } else {
            RuntimeAgentsTemplateScaffoldStatus::Created
        },
        created_parent_dir,
    })
}

fn ensure_gitignore_entry(
    gitignore_path: &Path,
    entry: &str,
) -> Result<WorkspaceGitignoreEnsureResult, String> {
    if gitignore_path.exists() && gitignore_path.is_dir() {
        return Err(format!(
            ".gitignore 路径指向目录而不是文件: {}",
            gitignore_path.display()
        ));
    }

    let entry = entry.trim();
    if entry.is_empty() {
        return Err("gitignore 条目不能为空".to_string());
    }

    if !gitignore_path.exists() {
        fs::write(gitignore_path, format!("{entry}\n"))
            .map_err(|e| format!("创建 .gitignore 失败 {}: {e}", gitignore_path.display()))?;
        return Ok(WorkspaceGitignoreEnsureResult {
            path: gitignore_path.to_string_lossy().to_string(),
            entry: entry.to_string(),
            status: WorkspaceGitignoreEnsureStatus::Created,
        });
    }

    let existing = fs::read_to_string(gitignore_path)
        .map_err(|e| format!("读取 .gitignore 失败 {}: {e}", gitignore_path.display()))?;
    if existing.lines().any(|line| line.trim() == entry) {
        return Ok(WorkspaceGitignoreEnsureResult {
            path: gitignore_path.to_string_lossy().to_string(),
            entry: entry.to_string(),
            status: WorkspaceGitignoreEnsureStatus::Exists,
        });
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(entry);
    next.push('\n');
    fs::write(gitignore_path, next)
        .map_err(|e| format!("更新 .gitignore 失败 {}: {e}", gitignore_path.display()))?;

    Ok(WorkspaceGitignoreEnsureResult {
        path: gitignore_path.to_string_lossy().to_string(),
        entry: entry.to_string(),
        status: WorkspaceGitignoreEnsureStatus::Added,
    })
}

fn template_content_for_target(target: RuntimeAgentsTemplateTarget) -> &'static str {
    match target {
        RuntimeAgentsTemplateTarget::Global => GLOBAL_RUNTIME_AGENTS_TEMPLATE,
        RuntimeAgentsTemplateTarget::Workspace => WORKSPACE_RUNTIME_AGENTS_TEMPLATE,
        RuntimeAgentsTemplateTarget::WorkspaceLocal => WORKSPACE_LOCAL_RUNTIME_AGENTS_TEMPLATE,
    }
}

const GLOBAL_RUNTIME_AGENTS_TEMPLATE: &str = r#"# 我的全局 Lime 运行时规则

## 回复习惯

- 默认使用中文简体
- 先给结论，再给关键步骤
- 没必要时保持简洁，不要过度展开

## 工程偏好

- 优先选择 KISS 方案
- 优先修根因，不做表面补丁
- 先说明影响范围，再做改动

## 代码风格

- 尽量沿用现有项目风格
- 避免无关重构
- 没有明确收益时，不新增抽象层
"#;

const WORKSPACE_RUNTIME_AGENTS_TEMPLATE: &str = r#"# 当前工作区运行时规则

## 项目背景

- 这里填写当前项目的技术栈与上下文
- 这里填写默认输出语言或文档语言

## 修改原则

- 先读后写
- 只改当前任务直接相关内容
- 保持现有目录结构和命名习惯

## 验证要求

- 前端改动后优先跑相关前端测试
- Rust 改动后优先跑相关单测
- 若无法完整验证，需要明确说明未验证部分

## 禁止事项

- 不要提交临时排障脚本
- 不要修改无关配置
- 不要默认执行 git commit 或 push
"#;

const WORKSPACE_LOCAL_RUNTIME_AGENTS_TEMPLATE: &str = r#"# 本机私有补充

## 本机偏好

- 优先使用本机已安装的工具链
- 涉及大体量编译时，先跑定向测试

## 私有约束

- 这里填写只在当前机器生效的补充规则
- 如不希望提交到仓库，请将本文件加入 .gitignore
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn should_create_workspace_template_file() {
        let tmp = TempDir::new().expect("create temp dir");
        let path = tmp.path().join(".lime").join("AGENTS.md");

        let result = scaffold_runtime_agents_template_at_path(
            RuntimeAgentsTemplateTarget::Workspace,
            &path,
            false,
        )
        .expect("scaffold should succeed");

        assert_eq!(result.status, RuntimeAgentsTemplateScaffoldStatus::Created);
        assert!(path.exists());
        let content = fs::read_to_string(&path).expect("read template");
        assert!(content.contains("当前工作区运行时规则"));
    }

    #[test]
    fn should_not_overwrite_existing_file_by_default() {
        let tmp = TempDir::new().expect("create temp dir");
        let path = tmp.path().join(".lime").join("AGENTS.md");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(&path, "custom content").expect("write custom");

        let result = scaffold_runtime_agents_template_at_path(
            RuntimeAgentsTemplateTarget::Workspace,
            &path,
            false,
        )
        .expect("scaffold should succeed");

        assert_eq!(result.status, RuntimeAgentsTemplateScaffoldStatus::Exists);
        let content = fs::read_to_string(&path).expect("read file");
        assert_eq!(content, "custom content");
    }

    #[test]
    fn should_overwrite_existing_file_when_requested() {
        let tmp = TempDir::new().expect("create temp dir");
        let path = tmp.path().join(".lime").join("AGENTS.local.md");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(&path, "custom content").expect("write custom");

        let result = scaffold_runtime_agents_template_at_path(
            RuntimeAgentsTemplateTarget::WorkspaceLocal,
            &path,
            true,
        )
        .expect("scaffold should succeed");

        assert_eq!(
            result.status,
            RuntimeAgentsTemplateScaffoldStatus::Overwritten
        );
        let content = fs::read_to_string(&path).expect("read file");
        assert!(content.contains("本机私有补充"));
    }

    #[test]
    fn should_create_gitignore_when_missing() {
        let tmp = TempDir::new().expect("create temp dir");

        let result = ensure_workspace_local_agents_gitignore(tmp.path())
            .expect("ensure gitignore should succeed");

        assert_eq!(result.status, WorkspaceGitignoreEnsureStatus::Created);
        let content = fs::read_to_string(tmp.path().join(".gitignore")).expect("read gitignore");
        assert_eq!(content, ".lime/AGENTS.local.md\n");
    }

    #[test]
    fn should_append_gitignore_entry_once() {
        let tmp = TempDir::new().expect("create temp dir");
        let gitignore_path = tmp.path().join(".gitignore");
        fs::write(&gitignore_path, "node_modules\n").expect("write gitignore");

        let first = ensure_workspace_local_agents_gitignore(tmp.path())
            .expect("first ensure should succeed");
        let second = ensure_workspace_local_agents_gitignore(tmp.path())
            .expect("second ensure should succeed");

        assert_eq!(first.status, WorkspaceGitignoreEnsureStatus::Added);
        assert_eq!(second.status, WorkspaceGitignoreEnsureStatus::Exists);
        let content = fs::read_to_string(gitignore_path).expect("read gitignore");
        assert_eq!(content.matches(".lime/AGENTS.local.md").count(), 1);
    }
}
