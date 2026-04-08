//! GitHub Actions 工作流管理
//!
//! 提供工作流模板和设置功能

use std::path::Path;
use tokio::process::Command;

/// GitHub Actions 工作流模板
pub const CLAUDE_CODE_WORKFLOW: &str = r#"name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  claude-review:
    runs-on: ubuntu-latest
    if: |
      github.event_name == 'pull_request' ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude'))

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Claude Code Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          echo "Claude Code Review placeholder"
"#;

/// GitHub CLI 状态
#[derive(Debug, Clone)]
pub struct GitHubCLIStatus {
    /// 是否已安装
    pub installed: bool,
    /// 是否已认证
    pub authenticated: bool,
}

/// 检查 GitHub CLI 是否可用
pub async fn check_github_cli() -> GitHubCLIStatus {
    let output = Command::new("gh").args(["auth", "status"]).output().await;

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}{}", stdout, stderr);

            if output.status.success() || combined.contains("Logged in") {
                GitHubCLIStatus {
                    installed: true,
                    authenticated: true,
                }
            } else if combined.contains("gh auth login") {
                GitHubCLIStatus {
                    installed: true,
                    authenticated: false,
                }
            } else {
                GitHubCLIStatus {
                    installed: false,
                    authenticated: false,
                }
            }
        }
        Err(_) => GitHubCLIStatus {
            installed: false,
            authenticated: false,
        },
    }
}

/// 设置 GitHub Actions 工作流结果
#[derive(Debug, Clone)]
pub struct SetupWorkflowResult {
    /// 是否成功
    pub success: bool,
    /// 消息
    pub message: String,
    /// 工作流文件路径
    pub workflow_path: Option<String>,
}

/// 设置 GitHub Actions 工作流
pub async fn setup_github_workflow(project_dir: &Path) -> SetupWorkflowResult {
    let workflows_dir = project_dir.join(".github").join("workflows");
    let workflow_path = workflows_dir.join("claude-code.yml");

    // 检查是否是 git 仓库
    let git_dir = project_dir.join(".git");
    if !git_dir.exists() {
        return SetupWorkflowResult {
            success: false,
            message: "不是 git 仓库，请先运行 git init".to_string(),
            workflow_path: None,
        };
    }

    // 创建目录
    if !workflows_dir.exists() {
        if let Err(e) = tokio::fs::create_dir_all(&workflows_dir).await {
            return SetupWorkflowResult {
                success: false,
                message: format!("创建目录失败: {}", e),
                workflow_path: None,
            };
        }
    }

    // 检查是否已存在
    if workflow_path.exists() {
        return SetupWorkflowResult {
            success: false,
            message: "GitHub 工作流已存在".to_string(),
            workflow_path: Some(workflow_path.to_string_lossy().to_string()),
        };
    }

    // 写入工作流文件
    if let Err(e) = tokio::fs::write(&workflow_path, CLAUDE_CODE_WORKFLOW).await {
        return SetupWorkflowResult {
            success: false,
            message: format!("写入工作流文件失败: {}", e),
            workflow_path: None,
        };
    }

    SetupWorkflowResult {
        success: true,
        message: "GitHub Actions 工作流创建成功！".to_string(),
        workflow_path: Some(workflow_path.to_string_lossy().to_string()),
    }
}
