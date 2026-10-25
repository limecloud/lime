use crate::stdio_process::StdioProcessHandle;
use crate::types::McpServerConfig;
use crate::utils::create_env_for_mcp_server;
use rmcp::transport::TokioChildProcess;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::{info, warn};

pub(crate) struct StdioLaunch {
    pub(crate) transport: TokioChildProcess,
    pub(crate) process: StdioProcessHandle,
    pub(crate) stderr_task: Option<tokio::task::JoinHandle<()>>,
}

/// 本地 stdio MCP 的唯一进程创建边界。
pub(crate) struct LocalStdioLauncher;

impl LocalStdioLauncher {
    pub(crate) fn launch(
        server_name: &str,
        config: &McpServerConfig,
    ) -> std::io::Result<StdioLaunch> {
        let mut command = Command::new(config.command());
        command
            .args(config.args())
            .kill_on_drop(true)
            .env_clear()
            .envs(create_env_for_mcp_server(
                Some(
                    config
                        .env()
                        .iter()
                        .map(|(name, value)| (name.into(), value.into()))
                        .collect(),
                ),
                config.env_vars(),
            )?);

        if let Some(cwd) = config.sanitized_cwd() {
            command.current_dir(cwd);
        }

        #[cfg(unix)]
        command.process_group(0);

        let (transport, stderr) = TokioChildProcess::builder(command)
            .stderr(Stdio::piped())
            .spawn()?;
        let process = StdioProcessHandle::local(server_name, transport.id());
        let stderr_task = stderr.map(|stderr| spawn_stderr_logger(server_name.to_string(), stderr));

        Ok(StdioLaunch {
            transport,
            process,
            stderr_task,
        })
    }
}

fn spawn_stderr_logger(
    server_name: String,
    mut stderr: tokio::process::ChildStderr,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut lines = BufReader::new(&mut stderr).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => info!(server_name, line, "MCP server stderr"),
                Ok(None) => break,
                Err(error) => {
                    warn!(server_name, error = %error, "Failed to read MCP server stderr");
                    break;
                }
            }
        }
    })
}
