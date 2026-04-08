//! Git 核心工具
//!
//! 提供 Git 状态检测、分支信息等基础功能

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Git 状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitStatus {
    /// 已追踪的修改文件
    pub tracked: Vec<String>,
    /// 未追踪的文件
    pub untracked: Vec<String>,
    /// 工作区是否干净
    pub is_clean: bool,
}

/// Git 完整信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    /// 当前提交哈希
    pub commit_hash: String,
    /// 当前分支名
    pub branch_name: String,
    /// 远程 URL
    pub remote_url: Option<String>,
    /// 工作区是否干净
    pub is_clean: bool,
    /// 已追踪的修改文件
    pub tracked_files: Vec<String>,
    /// 未追踪的文件
    pub untracked_files: Vec<String>,
    /// 默认分支
    pub default_branch: String,
    /// 最近的提交记录
    pub recent_commits: Vec<String>,
}

/// 推送状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PushStatus {
    /// 是否有上游分支
    pub has_upstream: bool,
    /// 是否需要推送
    pub needs_push: bool,
    /// 领先上游的提交数
    pub commits_ahead: u32,
    /// 相对默认分支的提交数
    pub commits_ahead_of_default: u32,
}

/// Git 工具类
pub struct GitUtils;

impl GitUtils {
    /// 执行 Git 命令
    fn exec_git(args: &[&str], cwd: &Path) -> Result<String, String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .map_err(|e| format!("执行 git 命令失败: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(format!("git {} 失败", args.join(" ")))
        }
    }

    /// 执行 Git 命令并返回是否成功
    fn exec_git_ok(args: &[&str], cwd: &Path) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// 检查是否在 Git 仓库中
pub fn is_git_repository(cwd: &Path) -> bool {
    GitUtils::exec_git_ok(&["rev-parse", "--is-inside-work-tree"], cwd)
}

/// 获取当前分支名
pub fn get_current_branch(cwd: &Path) -> Result<String, String> {
    GitUtils::exec_git(&["rev-parse", "--abbrev-ref", "HEAD"], cwd)
}

/// 获取默认分支名
pub fn get_default_branch(cwd: &Path) -> String {
    // 方法1: 从 origin/HEAD 获取
    if let Ok(head) = GitUtils::exec_git(&["symbolic-ref", "refs/remotes/origin/HEAD"], cwd) {
        if let Some(branch) = head.strip_prefix("refs/remotes/origin/") {
            return branch.to_string();
        }
    }

    // 方法2: 从远程分支列表查找
    if let Ok(branches) = GitUtils::exec_git(&["branch", "-r"], cwd) {
        for name in ["main", "master"] {
            if branches.contains(&format!("origin/{}", name)) {
                return name.to_string();
            }
        }
    }

    "main".to_string()
}

/// 获取远程 URL
pub fn get_remote_url(cwd: &Path, remote: &str) -> Option<String> {
    GitUtils::exec_git(&["remote", "get-url", remote], cwd).ok()
}

/// 获取当前提交哈希
pub fn get_current_commit(cwd: &Path) -> Result<String, String> {
    GitUtils::exec_git(&["rev-parse", "HEAD"], cwd)
}

/// 获取 Git 状态
pub fn get_git_status(cwd: &Path) -> Result<GitStatus, String> {
    let output = GitUtils::exec_git(&["status", "--porcelain"], cwd)?;

    let mut tracked = Vec::new();
    let mut untracked = Vec::new();

    for line in output.lines() {
        if line.is_empty() {
            continue;
        }

        let status = line.get(..2).unwrap_or("");
        let file = line.get(3..).unwrap_or("").trim().to_string();

        if status == "??" {
            untracked.push(file);
        } else if !file.is_empty() {
            tracked.push(file);
        }
    }

    let is_clean = tracked.is_empty() && untracked.is_empty();

    Ok(GitStatus {
        tracked,
        untracked,
        is_clean,
    })
}

/// 检查是否有上游分支
#[allow(dead_code)]
pub fn has_upstream(cwd: &Path) -> bool {
    GitUtils::exec_git_ok(&["rev-parse", "@{u}"], cwd)
}

/// 获取领先上游的提交数
#[allow(dead_code)]
pub fn get_commits_ahead(cwd: &Path) -> u32 {
    GitUtils::exec_git(&["rev-list", "--count", "@{u}..HEAD"], cwd)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

/// 获取最近的提交记录
pub fn get_recent_commits(cwd: &Path, count: u32) -> Vec<String> {
    GitUtils::exec_git(&["log", "--oneline", "-n", &count.to_string()], cwd)
        .ok()
        .map(|s| s.lines().map(|l| l.to_string()).collect())
        .unwrap_or_default()
}

/// 获取完整的 Git 信息
pub fn get_git_info(cwd: &Path) -> Option<GitInfo> {
    if !is_git_repository(cwd) {
        return None;
    }

    let commit_hash = get_current_commit(cwd).ok()?;
    let branch_name = get_current_branch(cwd).ok()?;
    let remote_url = get_remote_url(cwd, "origin");
    let status = get_git_status(cwd).ok()?;
    let default_branch = get_default_branch(cwd);
    let recent_commits = get_recent_commits(cwd, 5);

    Some(GitInfo {
        commit_hash,
        branch_name,
        remote_url,
        is_clean: status.is_clean,
        tracked_files: status.tracked,
        untracked_files: status.untracked,
        default_branch,
        recent_commits,
    })
}

/// 获取推送状态
#[allow(dead_code)]
pub fn get_push_status(cwd: &Path) -> PushStatus {
    let has_up = has_upstream(cwd);
    let commits_ahead = if has_up { get_commits_ahead(cwd) } else { 0 };

    // 获取相对默认分支的提交数
    let default_branch = get_default_branch(cwd);
    let commits_ahead_of_default = GitUtils::exec_git(
        &[
            "rev-list",
            "--count",
            &format!("origin/{}..HEAD", default_branch),
        ],
        cwd,
    )
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(0);

    PushStatus {
        has_upstream: has_up,
        needs_push: !has_up || commits_ahead > 0,
        commits_ahead,
        commits_ahead_of_default,
    }
}
