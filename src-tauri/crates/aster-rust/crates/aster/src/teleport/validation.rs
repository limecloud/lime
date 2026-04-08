//! Teleport 仓库验证
//!
//! 确保远程会话在正确的 Git 仓库中运行

use super::types::{RepoValidationResult, RepoValidationStatus};
use tokio::process::Command;

/// 获取当前 Git 仓库远程 URL
pub async fn get_current_repo_url() -> Option<String> {
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if url.is_empty() {
            None
        } else {
            Some(url)
        }
    } else {
        None
    }
}

/// 规范化仓库 URL
pub fn normalize_repo_url(url: &str) -> String {
    let mut normalized = url.trim().to_string();

    // 移除 .git 后缀
    if normalized.ends_with(".git") {
        normalized = normalized
            .get(..normalized.len().saturating_sub(4))
            .unwrap_or(&normalized)
            .to_string();
    }

    // 转换 SSH 格式为 HTTPS
    if let Some(captures) = normalized.strip_prefix("git@") {
        if let Some((host, path)) = captures.split_once(':') {
            normalized = format!("https://{}/{}", host, path);
        }
    }

    // 移除尾部斜杠
    if normalized.ends_with('/') {
        normalized.pop();
    }

    normalized.to_lowercase()
}

/// 比较两个仓库 URL 是否相同
pub fn compare_repo_urls(url1: &str, url2: &str) -> bool {
    normalize_repo_url(url1) == normalize_repo_url(url2)
}

/// 验证会话仓库是否匹配当前仓库
pub async fn validate_session_repository(session_repo: Option<&str>) -> RepoValidationResult {
    // 如果会话没有仓库信息，不需要验证
    let Some(session_repo) = session_repo else {
        return RepoValidationResult {
            status: RepoValidationStatus::NoValidation,
            session_repo: None,
            current_repo: None,
            error_message: None,
        };
    };

    // 获取当前仓库
    let current_repo = match get_current_repo_url().await {
        Some(repo) => repo,
        None => {
            return RepoValidationResult {
                status: RepoValidationStatus::Error,
                session_repo: Some(session_repo.to_string()),
                current_repo: None,
                error_message: Some("当前目录不是 git 仓库".to_string()),
            };
        }
    };

    // 比较仓库
    if compare_repo_urls(session_repo, &current_repo) {
        RepoValidationResult {
            status: RepoValidationStatus::Match,
            session_repo: Some(session_repo.to_string()),
            current_repo: Some(current_repo),
            error_message: None,
        }
    } else {
        RepoValidationResult {
            status: RepoValidationStatus::Mismatch,
            session_repo: Some(session_repo.to_string()),
            current_repo: Some(current_repo),
            error_message: None,
        }
    }
}

/// 获取当前分支名
pub async fn get_current_branch() -> Option<String> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if branch.is_empty() {
            None
        } else {
            Some(branch)
        }
    } else {
        None
    }
}

/// 检查工作目录是否干净
pub async fn is_working_directory_clean() -> bool {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_repo_url_https() {
        let url = "https://github.com/user/repo.git";
        assert_eq!(normalize_repo_url(url), "https://github.com/user/repo");
    }

    #[test]
    fn test_normalize_repo_url_ssh() {
        let url = "git@github.com:user/repo.git";
        assert_eq!(normalize_repo_url(url), "https://github.com/user/repo");
    }

    #[test]
    fn test_normalize_repo_url_trailing_slash() {
        let url = "https://github.com/user/repo/";
        assert_eq!(normalize_repo_url(url), "https://github.com/user/repo");
    }

    #[test]
    fn test_normalize_repo_url_lowercase() {
        let url = "https://GitHub.com/User/Repo";
        assert_eq!(normalize_repo_url(url), "https://github.com/user/repo");
    }

    #[test]
    fn test_compare_repo_urls_same() {
        assert!(compare_repo_urls(
            "https://github.com/user/repo",
            "https://github.com/user/repo"
        ));
    }

    #[test]
    fn test_compare_repo_urls_different_format() {
        assert!(compare_repo_urls(
            "git@github.com:user/repo.git",
            "https://github.com/user/repo"
        ));
    }

    #[test]
    fn test_compare_repo_urls_different() {
        assert!(!compare_repo_urls(
            "https://github.com/user/repo1",
            "https://github.com/user/repo2"
        ));
    }

    #[tokio::test]
    async fn test_validate_session_repository_no_validation() {
        let result = validate_session_repository(None).await;
        assert_eq!(result.status, RepoValidationStatus::NoValidation);
    }

    #[tokio::test]
    async fn test_get_current_repo_url() {
        // 在 git 仓库中应该返回 Some
        let url = get_current_repo_url().await;
        // 可能有也可能没有，取决于运行环境
        println!("Current repo URL: {:?}", url);
    }

    #[tokio::test]
    async fn test_get_current_branch() {
        let branch = get_current_branch().await;
        println!("Current branch: {:?}", branch);
    }

    #[tokio::test]
    async fn test_is_working_directory_clean() {
        let clean = is_working_directory_clean().await;
        println!("Working directory clean: {}", clean);
    }
}
