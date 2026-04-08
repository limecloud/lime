//! GitHub PR 管理
//!
//! 提供 PR 信息获取、评论、创建等功能

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// PR 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRInfo {
    /// 标题
    pub title: String,
    /// 描述
    pub body: String,
    /// 作者
    pub author: String,
    /// 状态
    pub state: String,
    /// 新增行数
    pub additions: u32,
    /// 删除行数
    pub deletions: u32,
    /// 变更文件数
    pub changed_files: u32,
}

/// PR 评论
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRComment {
    /// 作者
    pub author: String,
    /// 内容
    pub body: String,
    /// 创建时间
    pub created_at: String,
}

/// 获取 PR 信息
pub async fn get_pr_info(pr_number: u32) -> Option<PRInfo> {
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--json",
            "title,body,author,state,additions,deletions,changedFiles",
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    #[derive(Deserialize)]
    struct GhPRInfo {
        title: String,
        body: Option<String>,
        author: Option<GhAuthor>,
        state: String,
        additions: u32,
        deletions: u32,
        #[serde(rename = "changedFiles")]
        changed_files: u32,
    }

    #[derive(Deserialize)]
    struct GhAuthor {
        login: String,
    }

    let data: GhPRInfo = serde_json::from_str(&stdout).ok()?;

    Some(PRInfo {
        title: data.title,
        body: data.body.unwrap_or_default(),
        author: data
            .author
            .map(|a| a.login)
            .unwrap_or_else(|| "unknown".to_string()),
        state: data.state,
        additions: data.additions,
        deletions: data.deletions,
        changed_files: data.changed_files,
    })
}

/// 获取 PR 评论
pub async fn get_pr_comments(pr_number: u32) -> Vec<PRComment> {
    let output = Command::new("gh")
        .args(["pr", "view", &pr_number.to_string(), "--json", "comments"])
        .output()
        .await;

    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    #[derive(Deserialize)]
    struct GhComments {
        comments: Vec<GhComment>,
    }

    #[derive(Deserialize)]
    struct GhComment {
        author: Option<GhAuthor>,
        body: String,
        #[serde(rename = "createdAt")]
        created_at: String,
    }

    #[derive(Deserialize)]
    struct GhAuthor {
        login: String,
    }

    let data: GhComments = match serde_json::from_str(&stdout) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };

    data.comments
        .into_iter()
        .map(|c| PRComment {
            author: c
                .author
                .map(|a| a.login)
                .unwrap_or_else(|| "unknown".to_string()),
            body: c.body,
            created_at: c.created_at,
        })
        .collect()
}

/// 添加 PR 评论
pub async fn add_pr_comment(pr_number: u32, body: &str) -> bool {
    let output = Command::new("gh")
        .args(["pr", "comment", &pr_number.to_string(), "--body", body])
        .output()
        .await;

    output.map(|o| o.status.success()).unwrap_or(false)
}

/// 创建 PR 选项
#[derive(Debug, Clone, Default)]
pub struct CreatePROptions {
    /// 标题
    pub title: String,
    /// 描述
    pub body: String,
    /// 基础分支
    pub base: Option<String>,
    /// 头分支
    pub head: Option<String>,
    /// 是否为草稿
    pub draft: bool,
}

/// 创建 PR 结果
#[derive(Debug, Clone)]
pub struct CreatePRResult {
    /// 是否成功
    pub success: bool,
    /// PR URL
    pub url: Option<String>,
    /// 错误信息
    pub error: Option<String>,
}

/// 创建 PR
pub async fn create_pr(options: CreatePROptions) -> CreatePRResult {
    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--title".to_string(),
        options.title,
        "--body".to_string(),
        options.body,
    ];

    if let Some(base) = options.base {
        args.push("--base".to_string());
        args.push(base);
    }

    if let Some(head) = options.head {
        args.push("--head".to_string());
        args.push(head);
    }

    if options.draft {
        args.push("--draft".to_string());
    }

    let output = Command::new("gh").args(&args).output().await;

    match output {
        Ok(o) if o.status.success() => {
            let url = String::from_utf8_lossy(&o.stdout).trim().to_string();
            CreatePRResult {
                success: true,
                url: Some(url),
                error: None,
            }
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            CreatePRResult {
                success: false,
                url: None,
                error: Some(stderr),
            }
        }
        Err(e) => CreatePRResult {
            success: false,
            url: None,
            error: Some(format!("执行 gh 命令失败: {}", e)),
        },
    }
}
