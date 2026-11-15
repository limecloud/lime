//! 读取单个文件的逐行 Git blame。
//!
//! `git blame --line-porcelain` 每行都会重复提交元数据，解析时按“头部 +
//! 元数据 + TAB 内容”的状态机读取，避免依赖固定字段顺序之外的实现细节。

use super::process::git_command_output_from;
use super::{read_status, required_root_path};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Output;
use std::time::Duration;

/// blame 命令自身的预算。
const GIT_BLAME_TIMEOUT: Duration = Duration::from_secs(30);
/// 跟踪状态与文件检查属于快速预检，单独使用更短的预算。
const GIT_BLAME_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_BLAME_PATH_CHARS: usize = 4_096;
const BINARY_SNIFF_BYTES: usize = 8_000;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBlame {
    pub root_path: String,
    pub repository_root: Option<String>,
    pub lines: Vec<ProjectGitBlameLine>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBlameLine {
    pub line_number: u32,
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_time: String,
    pub summary: String,
    pub content: String,
}

/// 读取 `root_path` 下相对路径 `path` 的逐行 blame。
pub async fn read_blame(root_path: &str, path: &str) -> Result<ProjectGitBlame, String> {
    let root = required_root_path(root_path)?;
    let path = validate_blame_path(path)?;
    let status = read_status(root_path).await?;
    if !status.has_git_repository {
        return Err("当前工作区不是 Git 仓库".to_string());
    }

    let absolute_path = root.join(&path);
    let metadata = tokio::fs::metadata(&absolute_path)
        .await
        .map_err(|_| format!("文件不存在: {path}"))?;
    if !metadata.is_file() {
        return Err(format!("不是文件: {path}"));
    }

    let tracked = git_command_output_from(
        Path::new("git"),
        &root,
        &["ls-files", "--error-unmatch", "--", &path],
        GIT_BLAME_PREFLIGHT_TIMEOUT,
    )
    .await?;
    if !tracked.status.success() {
        return Err(format!("文件未纳入 Git 跟踪: {path}"));
    }

    let bytes = tokio::fs::read(&absolute_path)
        .await
        .map_err(|_| format!("文件不存在: {path}"))?;
    if bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0) {
        return Err(format!("二进制文件不支持 Git blame: {path}"));
    }

    let lines = run_blame(Path::new("git"), &root, &path, GIT_BLAME_TIMEOUT).await?;
    Ok(ProjectGitBlame {
        root_path: status.root_path,
        repository_root: status.repository_root,
        lines,
    })
}

/// 校验并规范化仓库内相对文件路径。
///
/// 拒绝绝对路径、Windows 盘符/UNC 路径、`..`、`.git`、空路径段和控制字符；
/// 反斜杠统一按路径分隔符处理。
pub fn validate_blame_path(raw: &str) -> Result<String, String> {
    let path = raw.trim();
    if path.is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    if path.chars().count() > MAX_BLAME_PATH_CHARS {
        return Err("文件路径过长".to_string());
    }
    if path.chars().any(char::is_control) {
        return Err("文件路径包含控制字符".to_string());
    }
    let bytes = path.as_bytes();
    if path.starts_with('/')
        || path.starts_with('\\')
        || path.starts_with('~')
        || is_windows_absolute_path(path)
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return Err("文件路径必须是仓库内相对路径".to_string());
    }

    let normalized = path.replace('\\', "/");
    if normalized.split('/').any(|segment| segment.is_empty()) {
        return Err("文件路径格式无效".to_string());
    }
    if normalized
        .split('/')
        .any(|segment| segment == "." || segment == ".." || segment.eq_ignore_ascii_case(".git"))
    {
        return Err("文件路径格式无效".to_string());
    }
    Ok(normalized)
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

async fn run_blame(
    git: &Path,
    root: &Path,
    path: &str,
    timeout: Duration,
) -> Result<Vec<ProjectGitBlameLine>, String> {
    let output = git_command_output_from(
        git,
        root,
        &["blame", "--line-porcelain", "--", path],
        timeout,
    )
    .await?;
    if !output.status.success() {
        return Err(git_error(output));
    }
    parse_line_porcelain(&String::from_utf8_lossy(&output.stdout))
}

fn git_error(output: Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        format!("git blame 失败: {}", output.status)
    } else {
        stderr
    }
}

#[derive(Debug)]
struct PendingBlameLine {
    line_number: u32,
    sha: String,
    author: String,
    author_time: String,
    summary: String,
}

impl PendingBlameLine {
    fn finish(self, content: &str) -> ProjectGitBlameLine {
        ProjectGitBlameLine {
            line_number: self.line_number,
            short_sha: self.sha.chars().take(7).collect(),
            sha: self.sha,
            author: self.author,
            author_time: self.author_time,
            summary: self.summary,
            content: content.to_string(),
        }
    }
}

fn parse_line_porcelain(output: &str) -> Result<Vec<ProjectGitBlameLine>, String> {
    let mut result = Vec::new();
    let mut pending: Option<PendingBlameLine> = None;

    for raw_line in output.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if let Some((sha, line_number)) = parse_header(line) {
            if pending.is_some() {
                return Err("git blame 输出不完整".to_string());
            }
            pending = Some(PendingBlameLine {
                line_number,
                sha,
                author: String::new(),
                author_time: String::new(),
                summary: String::new(),
            });
            continue;
        }

        if let Some(content) = line.strip_prefix('\t') {
            let Some(finished) = pending.take() else {
                continue;
            };
            result.push(finished.finish(content));
            continue;
        }
        let Some(current) = pending.as_mut() else {
            continue;
        };
        if let Some(author) = line.strip_prefix("author ") {
            current.author = author.to_string();
        } else if let Some(author_time) = line.strip_prefix("author-time ") {
            current.author_time = format_author_time(author_time);
        } else if let Some(summary) = line.strip_prefix("summary ") {
            current.summary = summary.to_string();
        }
    }

    if pending.is_some() {
        return Err("git blame 输出不完整".to_string());
    }
    Ok(result)
}

fn parse_header(line: &str) -> Option<(String, u32)> {
    let mut parts = line.split(' ');
    let sha = parts.next()?;
    let sha = sha.strip_prefix('^').unwrap_or(sha);
    if !matches!(sha.len(), 40 | 64) || !sha.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    let _original_line = parts.next()?.parse::<u32>().ok()?;
    let line_number = parts.next()?.parse::<u32>().ok()?;
    Some((sha.to_string(), line_number))
}

fn format_author_time(raw: &str) -> String {
    let raw = raw.trim();
    raw.parse::<i64>()
        .ok()
        .and_then(|seconds| DateTime::<Utc>::from_timestamp(seconds, 0))
        .map(|time| time.to_rfc3339_opts(SecondsFormat::Secs, true))
        .unwrap_or_else(|| raw.to_string())
}

#[cfg(test)]
mod tests;
