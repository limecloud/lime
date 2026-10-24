//! 工作树的环境选择使用 Git 的 worktree 配置作用域。

use super::super::{git_command_output_from, output_to_string, GIT_COMMAND_TIMEOUT};
use std::path::Path;

const CONFIG_KEY: &str = "codex.localEnvironmentConfigPath";

pub async fn save_local_environment_config_path(
    worktree: &Path,
    config_path: Option<&str>,
) -> Result<(), String> {
    let config = worktree_config(worktree).await?;
    output_to_string(
        git_command_output_from(
            Path::new("git"),
            worktree,
            &[
                "config",
                "--file",
                &config,
                CONFIG_KEY,
                config_path.unwrap_or("__none__"),
            ],
            GIT_COMMAND_TIMEOUT,
        )
        .await?,
    )?;
    Ok(())
}

pub async fn read_local_environment_config_path(worktree: &Path) -> Result<Option<String>, String> {
    let config = worktree_config(worktree).await?;
    let output = git_command_output_from(
        Path::new("git"),
        worktree,
        &["config", "--file", &config, "--get", CONFIG_KEY],
        GIT_COMMAND_TIMEOUT,
    )
    .await?;
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    let value = output_to_string(output)?;
    let value = value.trim();
    Ok((!value.is_empty() && value != "__none__").then(|| value.to_owned()))
}

async fn worktree_config(worktree: &Path) -> Result<String, String> {
    // 显式使用Git返回的工作树配置文件，不启用会改变源仓语义的共享扩展。
    output_to_string(
        git_command_output_from(
            Path::new("git"),
            worktree,
            &["rev-parse", "--git-path", "config.worktree"],
            GIT_COMMAND_TIMEOUT,
        )
        .await?,
    )
    .map(|path| path.trim().to_owned())
}
