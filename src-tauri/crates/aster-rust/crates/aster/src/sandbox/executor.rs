//! 沙箱执行器
//!
//! 提供统一的沙箱执行接口，自动选择最佳沙箱类型

use super::config::{SandboxConfig, SandboxType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutorResult {
    /// 退出码
    pub exit_code: i32,
    /// 标准输出
    pub stdout: String,
    /// 标准错误
    pub stderr: String,
    /// 是否在沙箱中执行
    pub sandboxed: bool,
    /// 沙箱类型
    pub sandbox_type: SandboxType,
    /// 执行时长（毫秒）
    pub duration: Option<u64>,
}

/// 执行选项
#[derive(Debug, Clone)]
pub struct ExecutorOptions {
    /// 命令
    pub command: String,
    /// 参数
    pub args: Vec<String>,
    /// 超时时间（毫秒）
    pub timeout: Option<u64>,
    /// 环境变量
    pub env: HashMap<String, String>,
    /// 工作目录
    pub working_dir: Option<String>,
}

/// 沙箱能力
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxCapabilities {
    /// Bubblewrap 可用
    pub bubblewrap: bool,
    /// Seatbelt 可用 (macOS)
    pub seatbelt: bool,
    /// Docker 可用
    pub docker: bool,
    /// 资源限制可用
    pub resource_limits: bool,
}

/// 在沙箱中执行命令
pub async fn execute_in_sandbox(
    command: &str,
    args: &[String],
    config: &SandboxConfig,
) -> anyhow::Result<ExecutorResult> {
    let start_time = std::time::Instant::now();

    // 禁用沙箱或类型为 None
    if !config.enabled || config.sandbox_type == SandboxType::None {
        return execute_unsandboxed(command, args, config).await;
    }

    // 根据沙箱类型执行
    let result = match config.sandbox_type {
        SandboxType::Docker => execute_in_docker(command, args, config).await,
        SandboxType::Bubblewrap => {
            #[cfg(target_os = "linux")]
            {
                execute_in_bubblewrap(command, args, config).await
            }
            #[cfg(not(target_os = "linux"))]
            {
                tracing::warn!("Bubblewrap 仅在 Linux 上可用，回退到无沙箱执行");
                execute_unsandboxed(command, args, config).await
            }
        }
        SandboxType::Seatbelt => {
            #[cfg(target_os = "macos")]
            {
                execute_in_seatbelt(command, args, config).await
            }
            #[cfg(not(target_os = "macos"))]
            {
                tracing::warn!("Seatbelt 仅在 macOS 上可用，回退到无沙箱执行");
                execute_unsandboxed(command, args, config).await
            }
        }
        SandboxType::Firejail => {
            #[cfg(target_os = "linux")]
            {
                execute_in_firejail(command, args, config).await
            }
            #[cfg(not(target_os = "linux"))]
            {
                tracing::warn!("Firejail 仅在 Linux 上可用，回退到无沙箱执行");
                execute_unsandboxed(command, args, config).await
            }
        }
        SandboxType::None => execute_unsandboxed(command, args, config).await,
    };

    result.map(|mut r| {
        r.duration = Some(start_time.elapsed().as_millis() as u64);
        r
    })
}

/// 无沙箱执行
async fn execute_unsandboxed(
    command: &str,
    args: &[String],
    config: &SandboxConfig,
) -> anyhow::Result<ExecutorResult> {
    let mut cmd = Command::new(command);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

    // 设置环境变量
    for (key, value) in &config.environment_variables {
        cmd.env(key, value);
    }

    let timeout = config
        .resource_limits
        .as_ref()
        .and_then(|l| l.max_execution_time)
        .map(Duration::from_millis);

    let output = if let Some(timeout) = timeout {
        tokio::time::timeout(timeout, cmd.output()).await??
    } else {
        cmd.output().await?
    };

    Ok(ExecutorResult {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        sandboxed: false,
        sandbox_type: SandboxType::None,
        duration: None,
    })
}

/// Docker 沙箱执行
async fn execute_in_docker(
    command: &str,
    args: &[String],
    config: &SandboxConfig,
) -> anyhow::Result<ExecutorResult> {
    let docker_config = config.docker.as_ref();
    let image = docker_config
        .and_then(|d| d.image.as_ref())
        .map(|s| s.as_str())
        .unwrap_or("alpine:latest");

    let mut docker_args = vec!["run", "--rm"];

    // 资源限制
    if let Some(ref limits) = config.resource_limits {
        if let Some(max_memory) = limits.max_memory {
            let mem_str = format!("{}m", max_memory / 1024 / 1024);
            docker_args.push("-m");
            docker_args.push(Box::leak(mem_str.into_boxed_str()));
        }
    }

    // 网络
    if !config.network_access {
        docker_args.push("--network=none");
    }

    docker_args.push(image);
    docker_args.push(command);
    for arg in args {
        docker_args.push(arg);
    }

    let mut cmd = Command::new("docker");
    cmd.args(&docker_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await?;

    Ok(ExecutorResult {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        sandboxed: true,
        sandbox_type: SandboxType::Docker,
        duration: None,
    })
}

/// Bubblewrap 沙箱执行 (Linux)
#[cfg(target_os = "linux")]
async fn execute_in_bubblewrap(
    command: &str,
    args: &[String],
    config: &SandboxConfig,
) -> anyhow::Result<ExecutorResult> {
    let mut bwrap_args = vec!["--unshare-all".to_string()];

    // 只读路径
    for path in &config.read_only_paths {
        bwrap_args.push("--ro-bind".to_string());
        bwrap_args.push(path.to_string_lossy().to_string());
        bwrap_args.push(path.to_string_lossy().to_string());
    }

    // 可写路径
    for path in &config.writable_paths {
        bwrap_args.push("--bind".to_string());
        bwrap_args.push(path.to_string_lossy().to_string());
        bwrap_args.push(path.to_string_lossy().to_string());
    }

    // /dev 访问
    if config.allow_dev_access {
        bwrap_args.push("--dev".to_string());
        bwrap_args.push("/dev".to_string());
    }

    // /proc 访问
    if config.allow_proc_access {
        bwrap_args.push("--proc".to_string());
        bwrap_args.push("/proc".to_string());
    }

    // 随父进程退出
    if config.die_with_parent {
        bwrap_args.push("--die-with-parent".to_string());
    }

    // 新会话
    if config.new_session {
        bwrap_args.push("--new-session".to_string());
    }

    bwrap_args.push("--".to_string());
    bwrap_args.push(command.to_string());
    bwrap_args.extend(args.iter().cloned());

    let mut cmd = Command::new("bwrap");
    cmd.args(&bwrap_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await?;

    Ok(ExecutorResult {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        sandboxed: true,
        sandbox_type: SandboxType::Bubblewrap,
        duration: None,
    })
}

/// Seatbelt 沙箱执行 (macOS)
#[cfg(target_os = "macos")]
async fn execute_in_seatbelt(
    command: &str,
    args: &[String],
    config: &SandboxConfig,
) -> anyhow::Result<ExecutorResult> {
    // 构建 sandbox profile
    let mut profile = String::from("(version 1)\n(deny default)\n");

    // 允许执行
    profile.push_str("(allow process-exec)\n");

    // 只读路径
    for path in &config.read_only_paths {
        profile.push_str(&format!(
            "(allow file-read* (subpath \"{}\"))\n",
            path.display()
        ));
    }

    // 可写路径
    for path in &config.writable_paths {
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{}\"))\n",
            path.display()
        ));
    }

    // 网络访问
    if config.network_access {
        profile.push_str("(allow network*)\n");
    }

    let mut cmd = Command::new("sandbox-exec");
    cmd.args(["-p", &profile, command])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await?;

    Ok(ExecutorResult {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        sandboxed: true,
        sandbox_type: SandboxType::Seatbelt,
        duration: None,
    })
}

/// Firejail 沙箱执行 (Linux)
#[cfg(target_os = "linux")]
async fn execute_in_firejail(
    command: &str,
    args: &[String],
    config: &SandboxConfig,
) -> anyhow::Result<ExecutorResult> {
    let mut firejail_args = vec!["--quiet".to_string()];

    // 网络隔离
    if !config.network_access {
        firejail_args.push("--net=none".to_string());
    }

    // 私有 /tmp
    firejail_args.push("--private-tmp".to_string());

    // 只读路径
    for path in &config.read_only_paths {
        firejail_args.push(format!("--read-only={}", path.display()));
    }

    firejail_args.push("--".to_string());
    firejail_args.push(command.to_string());
    firejail_args.extend(args.iter().cloned());

    let mut cmd = Command::new("firejail");
    cmd.args(&firejail_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await?;

    Ok(ExecutorResult {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        sandboxed: true,
        sandbox_type: SandboxType::Firejail,
        duration: None,
    })
}

/// 检测最佳沙箱类型
pub fn detect_best_sandbox() -> SandboxType {
    #[cfg(target_os = "linux")]
    {
        // 检查 bwrap
        if std::process::Command::new("which")
            .arg("bwrap")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return SandboxType::Bubblewrap;
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS 默认有 sandbox-exec
        if std::process::Command::new("which")
            .arg("sandbox-exec")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return SandboxType::Seatbelt;
        }
    }

    // 检查 Docker
    if std::process::Command::new("docker")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return SandboxType::Docker;
    }

    SandboxType::None
}

/// 获取沙箱能力
pub fn get_sandbox_capabilities() -> SandboxCapabilities {
    let mut caps = SandboxCapabilities {
        bubblewrap: false,
        seatbelt: false,
        docker: false,
        resource_limits: false,
    };

    #[cfg(target_os = "linux")]
    {
        caps.bubblewrap = std::process::Command::new("which")
            .arg("bwrap")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        caps.resource_limits = true;
    }

    #[cfg(target_os = "macos")]
    {
        caps.seatbelt = std::process::Command::new("which")
            .arg("sandbox-exec")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        caps.resource_limits = true;
    }

    caps.docker = std::process::Command::new("docker")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    caps
}

/// 沙箱执行器
pub struct SandboxExecutor {
    config: SandboxConfig,
}

impl SandboxExecutor {
    /// 创建新的执行器
    pub fn new(config: SandboxConfig) -> Self {
        Self { config }
    }

    /// 执行命令
    pub async fn execute(&self, command: &str, args: &[String]) -> anyhow::Result<ExecutorResult> {
        execute_in_sandbox(command, args, &self.config).await
    }

    /// 顺序执行多个命令
    pub async fn execute_sequence(
        &self,
        commands: &[(String, Vec<String>)],
    ) -> anyhow::Result<Vec<ExecutorResult>> {
        let mut results = Vec::new();

        for (command, args) in commands {
            let result = self.execute(command, args).await?;
            let failed = result.exit_code != 0;
            results.push(result);

            if failed {
                break;
            }
        }

        Ok(results)
    }

    /// 并行执行多个命令
    pub async fn execute_parallel(
        &self,
        commands: &[(String, Vec<String>)],
    ) -> anyhow::Result<Vec<ExecutorResult>> {
        let futures: Vec<_> = commands
            .iter()
            .map(|(cmd, args)| self.execute(cmd, args))
            .collect();

        let results = futures::future::try_join_all(futures).await?;
        Ok(results)
    }

    /// 更新配置
    pub fn update_config(&mut self, config: SandboxConfig) {
        self.config = config;
    }

    /// 获取当前配置
    pub fn get_config(&self) -> &SandboxConfig {
        &self.config
    }
}
