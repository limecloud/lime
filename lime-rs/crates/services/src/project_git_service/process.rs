//! Git 进程的超时、环境与输入共用一个执行边界。

use std::{
    ffi::OsString,
    path::Path,
    process::{Output, Stdio},
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

pub(super) async fn git_command_output_from(
    git: &Path,
    root: &Path,
    args: &[&str],
    command_timeout: Duration,
) -> Result<Output, String> {
    git_command_output_with(git, root, args, command_timeout, &[], None).await
}

pub(super) async fn git_command_output_with(
    git: &Path,
    root: &Path,
    args: &[&str],
    command_timeout: Duration,
    env: &[(OsString, OsString)],
    input: Option<&[u8]>,
) -> Result<Output, String> {
    let mut command = Command::new(git);
    command
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .envs(env.iter().map(|(key, value)| (key, value)))
        .args(args)
        .current_dir(root)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let execute = async {
        let mut child = command.spawn()?;
        let stdin = child.stdin.take();
        let write = async {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                stdin.write_all(input).await?;
                stdin.shutdown().await?;
            }
            Ok::<_, std::io::Error>(())
        };
        let (_, output) = tokio::try_join!(write, child.wait_with_output())?;
        Ok::<_, std::io::Error>(output)
    };
    match timeout(command_timeout, execute).await {
        Ok(result) => result.map_err(|error| format!("无法执行 git: {error}")),
        Err(_) => Err(format!("git 命令超时（{}ms）", command_timeout.as_millis())),
    }
}
