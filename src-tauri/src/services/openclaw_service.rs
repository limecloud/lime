use crate::app::AppState;
use crate::database::dao::api_key_provider::{ApiKeyProvider, ApiProviderType};
use dirs::{data_dir, home_dir};
use lime_core::openclaw_install::{
    build_openclaw_cleanup_command as core_build_openclaw_cleanup_command,
    build_openclaw_install_command as core_build_openclaw_install_command,
    build_winget_install_command as core_build_winget_install_command,
    command_bin_dir_for as core_command_bin_dir_for,
    resolve_windows_dependency_install_plan as core_resolve_windows_dependency_install_plan,
    select_best_semver_candidate as core_select_best_semver_candidate,
    select_preferred_path_candidate as core_select_preferred_path_candidate,
    shell_command_escape_for as core_shell_command_escape_for,
    shell_command_invocation_prefix_for as core_shell_command_invocation_prefix_for,
    shell_npm_prefix_assignment_for as core_shell_npm_prefix_assignment_for,
    shell_path_assignment_for as core_shell_path_assignment_for,
    windows_manual_install_message as core_windows_manual_install_message,
    OpenClawInstallDependencyKind, ShellPlatform, WindowsDependencyInstallPlan,
};
use rand::{distributions::Alphanumeric, Rng};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::cmp::Ordering;
use std::collections::{HashSet, VecDeque};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::SystemTime;
use sysinfo::{Pid, Signal, System};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout, Duration};
#[cfg(target_os = "windows")]
use winapi::shared::minwindef::{DWORD, HKEY};
#[cfg(target_os = "windows")]
use winapi::shared::winerror::ERROR_SUCCESS;
#[cfg(target_os = "windows")]
use winapi::um::winreg::{RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

const DEFAULT_GATEWAY_PORT: u16 = 18790;
const OPENCLAW_INSTALL_EVENT: &str = "openclaw:install-progress";
const OPENCLAW_CONFIG_ENV: &str = "OPENCLAW_CONFIG_PATH";

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
const OPENCLAW_CN_PACKAGE: &str = "@qingchencloud/openclaw-zh@latest";
const OPENCLAW_DEFAULT_PACKAGE: &str = "openclaw@latest";
const NPM_MIRROR_CN: &str = "https://registry.npmmirror.com";
const NODE_MIN_VERSION: (u64, u64, u64) = (22, 12, 0);
const OPENCLAW_PROGRESS_LOG_LIMIT: usize = 400;
const OPENCLAW_INSTALLER_USER_AGENT: &str = "Lime-OpenClaw";
#[cfg(not(target_os = "windows"))]
const OPENCLAW_TEMP_CARGO_CHECK_DIR: &str = "/tmp/lime-cargo-check";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static OPENCLAW_PREFERRED_RUNTIME_BIN_DIR: OnceLock<StdMutex<Option<PathBuf>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryAvailabilityStatus {
    pub available: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeCheckResult {
    pub status: String,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub status: String,
    pub version: Option<String>,
    pub path: Option<String>,
    pub message: String,
    pub auto_install_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub node: DependencyStatus,
    pub git: DependencyStatus,
    pub openclaw: DependencyStatus,
    pub recommended_action: String,
    pub summary: String,
    #[serde(default)]
    pub diagnostics: EnvironmentDiagnostics,
    #[serde(default)]
    pub temp_artifacts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDiagnostics {
    pub npm_path: Option<String>,
    pub npm_global_prefix: Option<String>,
    pub openclaw_package_path: Option<String>,
    #[serde(default)]
    pub where_candidates: Vec<String>,
    #[serde(default)]
    pub supplemental_search_dirs: Vec<String>,
    #[serde(default)]
    pub supplemental_command_candidates: Vec<String>,
    #[serde(default)]
    pub git_where_candidates: Vec<String>,
    #[serde(default)]
    pub git_supplemental_search_dirs: Vec<String>,
    #[serde(default)]
    pub git_supplemental_command_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreview {
    pub title: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatusInfo {
    pub status: GatewayStatus,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GatewayStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthInfo {
    pub status: String,
    pub gateway_port: u16,
    pub uptime: Option<u64>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub channel: Option<String>,
    pub install_kind: Option<String>,
    pub package_manager: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawRuntimeCandidate {
    pub id: String,
    pub source: String,
    pub bin_dir: String,
    pub node_path: String,
    pub node_version: Option<String>,
    pub npm_path: Option<String>,
    pub npm_global_prefix: Option<String>,
    pub openclaw_path: Option<String>,
    pub openclaw_version: Option<String>,
    pub openclaw_package_path: Option<String>,
    pub is_active: bool,
    pub is_preferred: bool,
}

#[derive(Debug, Default, Clone)]
struct OpenClawUpdateExecutionContext {
    root: Option<PathBuf>,
    install_kind: Option<String>,
    package_manager: Option<String>,
}

#[derive(Debug, Clone)]
struct OpenClawDirectUpgradePlan {
    runtime_source: String,
    runtime_bin_dir: PathBuf,
    package_manager: String,
    package_spec: String,
    command_line: String,
}

#[derive(Debug, Clone)]
struct OpenClawDirectUpgradeResult {
    runtime_source: String,
    runtime_bin_dir: PathBuf,
    package_manager: String,
    package_spec: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ResolvedOpenClawCommand {
    Binary {
        binary_path: PathBuf,
    },
    NodeCli {
        node_path: PathBuf,
        cli_path: PathBuf,
        package_version: Option<String>,
    },
}

impl ResolvedOpenClawCommand {
    fn build_command_with_args<I, S>(&self, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let command_path = self.command_path();
        let command_path_string = command_path.to_string_lossy().to_string();
        let mut command = Command::new(command_path);
        apply_binary_runtime_path(&mut command, &command_path_string);

        if let Self::NodeCli { cli_path, .. } = self {
            command.arg(cli_path);
        }

        command.args(args);

        command
    }

    fn command_path(&self) -> &Path {
        match self {
            Self::Binary { binary_path } => binary_path.as_path(),
            Self::NodeCli { node_path, .. } => node_path.as_path(),
        }
    }

    fn install_path_display(&self) -> String {
        match self {
            Self::Binary { binary_path } => binary_path.display().to_string(),
            Self::NodeCli { cli_path, .. } => cli_path.display().to_string(),
        }
    }

    fn invocation_display(&self) -> String {
        match self {
            Self::Binary { binary_path } => binary_path.display().to_string(),
            Self::NodeCli {
                node_path,
                cli_path,
                ..
            } => {
                format!("{} {}", node_path.display(), cli_path.display())
            }
        }
    }

    fn preview_invocation(&self) -> String {
        match self {
            Self::Binary { binary_path } => shell_escape(binary_path.to_string_lossy().as_ref()),
            Self::NodeCli {
                node_path,
                cli_path,
                ..
            } => format!(
                "{} {}",
                shell_escape(node_path.to_string_lossy().as_ref()),
                shell_escape(cli_path.to_string_lossy().as_ref())
            ),
        }
    }

    fn fallback_version(&self) -> Option<String> {
        match self {
            Self::Binary { .. } => None,
            Self::NodeCli {
                package_version, ..
            } => package_version.clone(),
        }
    }

    fn dedupe_key(&self) -> String {
        match self {
            Self::Binary { binary_path } => format!("binary:{}", binary_path.display()),
            Self::NodeCli {
                node_path,
                cli_path,
                ..
            } => format!("node:{}:{}", node_path.display(), cli_path.display()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub message: String,
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncModelEntry {
    pub id: String,
    pub name: String,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DependencyKind {
    Node,
    Git,
}

impl DependencyKind {
    fn label(self) -> &'static str {
        match self {
            Self::Node => "Node.js",
            Self::Git => "Git",
        }
    }
}

#[derive(Debug, Clone)]
struct InstallerAsset {
    filename: String,
    download_url: String,
}

#[derive(Debug)]
pub struct OpenClawService {
    gateway_process: Option<Child>,
    gateway_status: GatewayStatus,
    gateway_port: u16,
    gateway_auth_token: String,
    gateway_started_at: Option<SystemTime>,
    progress_logs: VecDeque<InstallProgressEvent>,
}

impl Default for OpenClawService {
    fn default() -> Self {
        Self {
            gateway_process: None,
            gateway_status: GatewayStatus::Stopped,
            gateway_port: DEFAULT_GATEWAY_PORT,
            gateway_auth_token: String::new(),
            gateway_started_at: None,
            progress_logs: VecDeque::new(),
        }
    }
}

pub struct OpenClawServiceState(pub std::sync::Arc<Mutex<OpenClawService>>);

impl Default for OpenClawServiceState {
    fn default() -> Self {
        Self(std::sync::Arc::new(Mutex::new(OpenClawService::default())))
    }
}

impl OpenClawService {
    pub fn clear_progress_logs(&mut self) {
        self.progress_logs.clear();
    }

    pub fn get_progress_logs(&self) -> Vec<InstallProgressEvent> {
        self.progress_logs.iter().cloned().collect()
    }

    fn clear_gateway_runtime_state(&mut self) {
        self.gateway_process = None;
        self.gateway_started_at = None;
        self.gateway_status = GatewayStatus::Stopped;
    }

    pub async fn list_runtime_candidates(&self) -> Result<Vec<OpenClawRuntimeCandidate>, String> {
        list_openclaw_runtime_candidates().await
    }

    pub async fn set_preferred_runtime(
        &self,
        runtime_id: Option<&str>,
    ) -> Result<ActionResult, String> {
        let normalized = runtime_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);

        let Some(runtime_bin_dir) = normalized else {
            set_preferred_runtime_bin_dir(None);
            return Ok(ActionResult {
                success: true,
                message: "已切换为自动选择执行环境。".to_string(),
            });
        };

        let candidates = list_openclaw_runtime_candidates().await?;
        let runtime_id = runtime_bin_dir.display().to_string();
        let Some(candidate) = candidates.iter().find(|item| item.id == runtime_id) else {
            return Ok(ActionResult {
                success: false,
                message: "未找到指定的 OpenClaw 执行环境，请重新检测后再试。".to_string(),
            });
        };

        set_preferred_runtime_bin_dir(Some(runtime_bin_dir));
        Ok(ActionResult {
            success: true,
            message: format!(
                "已固定使用执行环境：{}{}。",
                candidate.source,
                candidate
                    .node_version
                    .as_deref()
                    .map(|version| format!(" · Node {version}"))
                    .unwrap_or_default()
            ),
        })
    }

    fn push_progress_log(&mut self, message: String, level: String) {
        if self.progress_logs.len() >= OPENCLAW_PROGRESS_LOG_LIMIT {
            self.progress_logs.pop_front();
        }
        self.progress_logs
            .push_back(InstallProgressEvent { message, level });
    }

    pub async fn get_command_preview(
        &mut self,
        app: &AppHandle,
        operation: &str,
        port: Option<u16>,
    ) -> Result<CommandPreview, String> {
        match operation {
            "install" => self.build_install_command_preview(app).await,
            "uninstall" => self.build_uninstall_command_preview().await,
            "restart" => self.build_restart_command_preview(port).await,
            "start" => self.build_start_command_preview(port).await,
            "stop" => self.build_stop_command_preview(port).await,
            _ => Err(format!("不支持的 OpenClaw 操作预览: {operation}")),
        }
    }

    pub async fn get_environment_status(&self) -> Result<EnvironmentStatus, String> {
        let node = inspect_node_dependency_status().await?;
        let git = inspect_git_dependency_status().await?;
        let openclaw = inspect_openclaw_dependency_status().await?;
        let diagnostics = collect_environment_diagnostics().await;

        Ok(build_environment_status(node, git, openclaw, diagnostics))
    }

    pub async fn check_installed(&self) -> Result<BinaryInstallStatus, String> {
        let openclaw = inspect_openclaw_dependency_status().await?;
        Ok(BinaryInstallStatus {
            installed: openclaw.status == "ok",
            path: openclaw.path,
        })
    }

    pub async fn check_git_available(&self) -> Result<BinaryAvailabilityStatus, String> {
        let git = inspect_git_dependency_status().await?;
        Ok(BinaryAvailabilityStatus {
            available: git.status == "ok",
            path: git.path,
        })
    }

    pub async fn check_node_version(&self) -> Result<NodeCheckResult, String> {
        let node = inspect_node_dependency_status().await?;
        Ok(NodeCheckResult {
            status: match node.status.as_str() {
                "missing" => "not_found".to_string(),
                other => other.to_string(),
            },
            version: node.version,
            path: node.path,
        })
    }

    pub fn get_node_download_url(&self) -> String {
        if cfg!(target_os = "windows") {
            "https://nodejs.org/en/download".to_string()
        } else if cfg!(target_os = "macos") {
            "https://nodejs.org/en/download".to_string()
        } else if cfg!(target_os = "linux") {
            "https://nodejs.org/en/download".to_string()
        } else {
            "https://nodejs.org/en/download".to_string()
        }
    }

    pub fn get_git_download_url(&self) -> String {
        if cfg!(target_os = "windows") {
            "https://git-scm.com/download/win".to_string()
        } else if cfg!(target_os = "macos") {
            "https://git-scm.com/download/mac".to_string()
        } else if cfg!(target_os = "linux") {
            "https://git-scm.com/download/linux".to_string()
        } else {
            "https://git-scm.com/downloads".to_string()
        }
    }

    pub async fn install(&mut self, app: &AppHandle) -> Result<ActionResult, String> {
        emit_install_progress(app, "开始准备 OpenClaw 环境。", "info");

        #[cfg(target_os = "windows")]
        {
            let node_status = self.inspect_dependency_status(DependencyKind::Node).await?;
            let git_status = self.inspect_dependency_status(DependencyKind::Git).await?;
            if let Some(result) = windows_install_block_result(&node_status, &git_status) {
                emit_install_progress(app, &result.message, "warn");
                return Ok(result);
            }
        }

        let node_result = self
            .ensure_dependency_ready(app, DependencyKind::Node)
            .await?;
        if !node_result.success {
            return Ok(node_result);
        }

        let git_result = self
            .ensure_dependency_ready(app, DependencyKind::Git)
            .await?;
        if !git_result.success {
            return Ok(git_result);
        }

        let (_, npm_path, npm_prefix, cleanup_command, install_command) =
            self.resolve_install_commands(app).await?;

        emit_install_progress(app, &format!("使用 npm: {npm_path}"), "info");
        if let Some(prefix) = npm_prefix {
            emit_install_progress(app, &format!("npm 全局前缀: {prefix}"), "info");
        }
        emit_install_progress(app, "安装前先清理已有 OpenClaw 全局包。", "info");
        let cleanup_result = run_shell_command_with_progress(app, &cleanup_command).await?;
        if !cleanup_result.success {
            emit_install_progress(
                app,
                &format!(
                    "清理旧版 OpenClaw 失败，继续尝试安装：{}",
                    cleanup_result.message
                ),
                "warn",
            );
        }

        emit_install_progress(app, &format!("执行安装命令: {install_command}"), "info");
        let result = run_shell_command_with_progress(app, &install_command).await?;
        if !result.success {
            return Ok(result);
        }

        let installed = self.check_installed().await?;
        if installed.installed {
            emit_install_progress(app, "已检测到 OpenClaw 可执行文件。", "info");
            return Ok(ActionResult {
                success: true,
                message: installed
                    .path
                    .map(|path| format!("OpenClaw 安装完成：{path}"))
                    .unwrap_or_else(|| "OpenClaw 安装完成。".to_string()),
            });
        }

        Ok(ActionResult {
            success: false,
            message:
                "安装命令执行完成，但仍未检测到 OpenClaw 可执行文件，请检查 npm 全局目录或权限设置。"
                    .to_string(),
        })
    }

    pub async fn install_dependency(
        &mut self,
        app: &AppHandle,
        kind: &str,
    ) -> Result<ActionResult, String> {
        let dependency = match kind {
            "node" => DependencyKind::Node,
            "git" => DependencyKind::Git,
            _ => return Err(format!("不支持的依赖类型: {kind}")),
        };

        #[cfg(target_os = "windows")]
        {
            let status = self.inspect_dependency_status(dependency).await?;
            if status.status == "ok" {
                emit_install_progress(
                    app,
                    &format!(
                        "{} 已就绪{}。",
                        dependency.label(),
                        status
                            .version
                            .as_deref()
                            .map(|version| format!(" · {version}"))
                            .unwrap_or_default()
                    ),
                    "info",
                );
                return Ok(ActionResult {
                    success: true,
                    message: format!("{} 已满足要求。", dependency.label()),
                });
            }

            let result = windows_dependency_action_result(dependency, &status);
            emit_install_progress(app, &result.message, "warn");
            return Ok(result);
        }

        #[cfg(not(target_os = "windows"))]
        {
            self.ensure_dependency_ready(app, dependency).await
        }
    }

    pub async fn cleanup_temp_artifacts(
        &mut self,
        app: Option<&AppHandle>,
    ) -> Result<ActionResult, String> {
        let mut removed = Vec::new();
        let mut failed = Vec::new();

        for target in collect_temp_artifact_paths(app) {
            if !target.exists() {
                continue;
            }

            let result = if target.is_dir() {
                std::fs::remove_dir_all(&target)
            } else {
                std::fs::remove_file(&target)
            };

            match result {
                Ok(_) => {
                    if let Some(app) = app {
                        emit_install_progress(
                            app,
                            &format!("已清理临时文件：{}", target.display()),
                            "info",
                        );
                    }
                    removed.push(target.display().to_string());
                }
                Err(error) => {
                    if let Some(app) = app {
                        emit_install_progress(
                            app,
                            &format!("清理临时文件失败({}): {error}", target.display()),
                            "warn",
                        );
                    }
                    failed.push(format!("{}: {error}", target.display()));
                }
            }
        }

        if failed.is_empty() {
            Ok(ActionResult {
                success: true,
                message: if removed.is_empty() {
                    "未发现需要清理的 OpenClaw 临时文件。".to_string()
                } else {
                    format!("已清理 {} 项临时文件。", removed.len())
                },
            })
        } else {
            Ok(ActionResult {
                success: false,
                message: format!("部分临时文件清理失败：{}", failed.join("；")),
            })
        }
    }

    pub async fn uninstall(&mut self, app: &AppHandle) -> Result<ActionResult, String> {
        if self.gateway_status == GatewayStatus::Running || self.gateway_process.is_some() {
            let _ = self.stop_gateway(None).await;
        }

        let (npm_path, npm_prefix, command) = self.resolve_uninstall_command().await?;

        emit_install_progress(app, &format!("使用 npm: {npm_path}"), "info");
        if let Some(prefix) = npm_prefix {
            emit_install_progress(app, &format!("npm 全局前缀: {prefix}"), "info");
        }
        emit_install_progress(app, &format!("执行卸载命令: {command}"), "info");
        run_shell_command_with_progress(app, &command).await
    }

    async fn ensure_dependency_ready(
        &mut self,
        app: &AppHandle,
        dependency: DependencyKind,
    ) -> Result<ActionResult, String> {
        let status = self.inspect_dependency_status(dependency).await?;
        if status.status == "ok" {
            emit_install_progress(
                app,
                &format!(
                    "{} 已就绪{}。",
                    dependency.label(),
                    status
                        .version
                        .as_deref()
                        .map(|version| format!(" · {version}"))
                        .unwrap_or_default()
                ),
                "info",
            );
            return Ok(ActionResult {
                success: true,
                message: format!("{} 已满足要求。", dependency.label()),
            });
        }

        emit_install_progress(
            app,
            &format!("{}，开始修复 {} 环境。", status.message, dependency.label()),
            "warn",
        );

        match dependency {
            DependencyKind::Node => self.install_node_runtime(app).await,
            DependencyKind::Git => self.install_git_runtime(app).await,
        }
    }

    async fn inspect_dependency_status(
        &self,
        dependency: DependencyKind,
    ) -> Result<DependencyStatus, String> {
        match dependency {
            DependencyKind::Node => inspect_node_dependency_status().await,
            DependencyKind::Git => inspect_git_dependency_status().await,
        }
    }

    async fn install_node_runtime(&mut self, app: &AppHandle) -> Result<ActionResult, String> {
        #[cfg(target_os = "windows")]
        {
            let winget_path = find_command_in_shell("winget").await?;
            match resolve_windows_dependency_install_plan(
                DependencyKind::Node,
                winget_path.is_some(),
            ) {
                WindowsDependencyInstallPlan::Winget { package_id } => {
                    let winget_path = winget_path.expect("winget path should exist");
                    emit_install_progress(
                        app,
                        "检测到 winget，准备通过 winget 安装 Node.js。",
                        "info",
                    );
                    let command = build_winget_install_command(&winget_path, package_id);
                    let result = run_shell_command_with_progress(app, &command).await?;
                    if !result.success {
                        return Ok(result);
                    }
                    return self
                        .verify_dependency_after_install(app, DependencyKind::Node)
                        .await;
                }
                WindowsDependencyInstallPlan::OfficialInstaller => {
                    emit_install_progress(
                        app,
                        "未检测到 winget，准备下载官方 Node.js 安装器。",
                        "warn",
                    );
                    let asset = resolve_node_installer_asset().await?;
                    let installer_path = download_installer_asset(app, &asset).await?;
                    launch_installer(&installer_path)?;
                    return self
                        .wait_for_dependency_ready(app, DependencyKind::Node, 900)
                        .await;
                }
                WindowsDependencyInstallPlan::ManualDownload => {
                    unreachable!("Node.js 在 Windows 上不应返回手动下载计划")
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            if let Some(brew_path) = find_command_in_shell("brew").await? {
                emit_install_progress(
                    app,
                    "检测到 Homebrew，准备通过 Homebrew 安装 Node.js。",
                    "info",
                );
                let brew_cmd = shell_command_escape(&brew_path);
                let path_env = shell_path_assignment(&brew_path);
                let command = format!(
                    "{path_env}{brew_cmd} install node || {path_env}{brew_cmd} upgrade node"
                );
                let result = run_shell_command_with_progress(app, &command).await?;
                if !result.success {
                    return Ok(result);
                }
                return self
                    .verify_dependency_after_install(app, DependencyKind::Node)
                    .await;
            }

            emit_install_progress(
                app,
                "未检测到 Homebrew，准备下载官方 Node.js 安装器。",
                "warn",
            );
            let asset = resolve_node_installer_asset().await?;
            let installer_path = download_installer_asset(app, &asset).await?;
            launch_installer(&installer_path)?;
            return self
                .wait_for_dependency_ready(app, DependencyKind::Node, 900)
                .await;
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let message = "当前平台暂不支持应用内自动安装 Node.js，请手动安装 Node.js 22+ 后重试。"
                .to_string();
            emit_install_progress(app, &message, "warn");
            Ok(ActionResult {
                success: false,
                message,
            })
        }
    }

    async fn install_git_runtime(&mut self, app: &AppHandle) -> Result<ActionResult, String> {
        #[cfg(target_os = "windows")]
        {
            let winget_path = find_command_in_shell("winget").await?;
            match resolve_windows_dependency_install_plan(
                DependencyKind::Git,
                winget_path.is_some(),
            ) {
                WindowsDependencyInstallPlan::Winget { package_id } => {
                    let winget_path = winget_path.expect("winget path should exist");
                    emit_install_progress(app, "检测到 winget，准备通过 winget 安装 Git。", "info");
                    let command = build_winget_install_command(&winget_path, package_id);
                    let result = run_shell_command_with_progress(app, &command).await?;
                    if !result.success {
                        return Ok(result);
                    }
                    return self
                        .verify_dependency_after_install(app, DependencyKind::Git)
                        .await;
                }
                WindowsDependencyInstallPlan::OfficialInstaller => {
                    unreachable!("Git 在 Windows 上不应返回官方安装器计划")
                }
                WindowsDependencyInstallPlan::ManualDownload => {
                    let message = windows_manual_install_message(DependencyKind::Git).to_string();
                    emit_install_progress(app, &message, "warn");
                    return Ok(ActionResult {
                        success: false,
                        message,
                    });
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            if let Some(brew_path) = find_command_in_shell("brew").await? {
                emit_install_progress(app, "检测到 Homebrew，准备通过 Homebrew 安装 Git。", "info");
                let brew_cmd = shell_command_escape(&brew_path);
                let path_env = shell_path_assignment(&brew_path);
                let command =
                    format!("{path_env}{brew_cmd} install git || {path_env}{brew_cmd} upgrade git");
                let result = run_shell_command_with_progress(app, &command).await?;
                if !result.success {
                    return Ok(result);
                }
                return self
                    .verify_dependency_after_install(app, DependencyKind::Git)
                    .await;
            }

            emit_install_progress(
                app,
                "未检测到 Homebrew，准备拉起 macOS Command Line Tools 安装器。",
                "warn",
            );
            let trigger_result = trigger_macos_command_line_tools_install().await?;
            emit_install_progress(app, &trigger_result, "info");
            return self
                .wait_for_dependency_ready(app, DependencyKind::Git, 1200)
                .await;
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let message = "当前平台暂不支持应用内自动安装 Git，请使用系统包管理器手动安装后重试。"
                .to_string();
            emit_install_progress(app, &message, "warn");
            Ok(ActionResult {
                success: false,
                message,
            })
        }
    }

    async fn verify_dependency_after_install(
        &self,
        app: &AppHandle,
        dependency: DependencyKind,
    ) -> Result<ActionResult, String> {
        // 在 Windows 上刷新 PATH 环境变量
        #[cfg(target_os = "windows")]
        {
            if let Err(e) = refresh_windows_path_from_registry() {
                emit_install_progress(app, &format!("刷新环境变量失败: {}", e), "warn");
            } else {
                emit_install_progress(app, "已刷新系统环境变量。", "info");
            }
        }

        let status = self.inspect_dependency_status(dependency).await?;
        if status.status == "ok" {
            emit_install_progress(
                app,
                &format!(
                    "{} 已准备完成{}。",
                    dependency.label(),
                    status
                        .version
                        .as_deref()
                        .map(|version| format!(" · {version}"))
                        .unwrap_or_default()
                ),
                "info",
            );
            return Ok(ActionResult {
                success: true,
                message: format!("{} 已安装完成。", dependency.label()),
            });
        }

        Ok(ActionResult {
            success: false,
            message: format!(
                "{} 安装完成后仍未通过校验：{}",
                dependency.label(),
                status.message
            ),
        })
    }

    async fn wait_for_dependency_ready(
        &self,
        app: &AppHandle,
        dependency: DependencyKind,
        timeout_secs: u64,
    ) -> Result<ActionResult, String> {
        emit_install_progress(
            app,
            &format!(
                "已拉起 {} 安装器，正在等待安装完成（最长 {} 秒）。",
                dependency.label(),
                timeout_secs
            ),
            "info",
        );

        let start = tokio::time::Instant::now();
        let mut last_notice_at = 0_u64;
        #[cfg(target_os = "windows")]
        let mut last_refresh_at = 0_u64;

        while start.elapsed() < Duration::from_secs(timeout_secs) {
            let elapsed = start.elapsed().as_secs();

            // 每 10 秒刷新一次 Windows PATH（因为用户可能在安装过程中）
            #[cfg(target_os = "windows")]
            if elapsed >= last_refresh_at + 10 {
                last_refresh_at = elapsed;
                let _ = refresh_windows_path_from_registry();
            }

            if elapsed >= last_notice_at + 15 {
                last_notice_at = elapsed;
                emit_install_progress(
                    app,
                    &format!("正在等待 {} 安装完成…", dependency.label()),
                    "info",
                );
            }

            sleep(Duration::from_secs(2)).await;
            let status = self.inspect_dependency_status(dependency).await?;
            if status.status == "ok" {
                emit_install_progress(
                    app,
                    &format!(
                        "{} 已检测通过{}。",
                        dependency.label(),
                        status
                            .version
                            .as_deref()
                            .map(|version| format!(" · {version}"))
                            .unwrap_or_default()
                    ),
                    "info",
                );
                return Ok(ActionResult {
                    success: true,
                    message: format!("{} 已安装完成。", dependency.label()),
                });
            }
        }

        Ok(ActionResult {
            success: false,
            message: format!(
                "等待 {} 安装完成超时，请完成安装后重新点击重试。",
                dependency.label()
            ),
        })
    }

    pub async fn start_gateway(
        &mut self,
        app: Option<&AppHandle>,
        port: Option<u16>,
    ) -> Result<ActionResult, String> {
        if let Some(next_port) = port {
            self.gateway_port = next_port.max(1);
        }

        if let Some(app) = app {
            emit_install_progress(
                app,
                &format!("准备启动 Gateway，目标端口 {}。", self.gateway_port),
                "info",
            );
        }

        self.ensure_runtime_config(None, None)?;
        self.refresh_process_state().await?;

        if self.gateway_status == GatewayStatus::Running {
            if let Some(app) = app {
                emit_install_progress(
                    app,
                    &format!("检测到 Gateway 已在端口 {} 运行。", self.gateway_port),
                    "info",
                );
            }
            return Ok(ActionResult {
                success: true,
                message: format!("Gateway 已在端口 {} 运行", self.gateway_port),
            });
        }

        let Some(openclaw_command) = resolve_openclaw_command().await? else {
            self.gateway_status = GatewayStatus::Error;
            if let Some(app) = app {
                emit_install_progress(app, "未检测到 OpenClaw 可执行文件，请先安装。", "error");
            }
            return Ok(ActionResult {
                success: false,
                message: "未检测到 OpenClaw 可执行文件，请先安装。".to_string(),
            });
        };

        self.gateway_status = GatewayStatus::Starting;

        let config_path = openclaw_lime_config_path();
        if let Some(app) = app {
            emit_install_progress(
                app,
                &format!("使用配置文件启动 Gateway: {}", config_path.display()),
                "info",
            );
        }
        let start_args = gateway_start_args(self.gateway_port, &self.gateway_auth_token);
        let mut command = openclaw_command.build_command_with_args(&start_args);
        command
            .env(OPENCLAW_CONFIG_ENV, &config_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| format!("启动 Gateway 失败: {e}"))?;

        let gateway_error_lines = Arc::new(StdMutex::new(Vec::<String>::new()));

        if let Some(stdout) = child.stdout.take() {
            let app = app.cloned();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::info!(target: "openclaw", "Gateway stdout: {}", line);
                    if let Some(app) = app.as_ref() {
                        emit_install_progress(app, &line, classify_progress_level(&line, "info"));
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let app = app.cloned();
            let gateway_error_lines = gateway_error_lines.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(target: "openclaw", "Gateway stderr: {}", line);
                    if let Ok(mut slot) = gateway_error_lines.lock() {
                        push_gateway_error_line(&mut slot, &line);
                    }
                    if let Some(app) = app.as_ref() {
                        emit_install_progress(app, &line, classify_progress_level(&line, "warn"));
                    }
                }
            });
        }

        self.gateway_process = Some(child);
        self.gateway_started_at = Some(SystemTime::now());

        if let Some(app) = app {
            emit_install_progress(app, "Gateway 进程已拉起，等待服务就绪。", "info");
        }

        let start_at = tokio::time::Instant::now();
        while start_at.elapsed() < Duration::from_secs(30) {
            sleep(Duration::from_millis(300)).await;
            self.refresh_process_state().await?;
            let gateway_error_lines = gateway_error_lines
                .lock()
                .ok()
                .map(|slot| slot.clone())
                .unwrap_or_default();

            if self.gateway_process.is_none() && self.gateway_status == GatewayStatus::Error {
                let message = format_gateway_start_failure_message(
                    select_gateway_start_failure_detail(&gateway_error_lines),
                );
                if let Some(app) = app {
                    emit_install_progress(app, &message, "error");
                }
                return Ok(ActionResult {
                    success: false,
                    message,
                });
            }

            if self.gateway_status == GatewayStatus::Running {
                if let Some(app) = app {
                    emit_install_progress(
                        app,
                        &format!("Gateway 启动成功，监听端口 {}。", self.gateway_port),
                        "info",
                    );
                }
                return Ok(ActionResult {
                    success: true,
                    message: format!("Gateway 已启动，端口 {}", self.gateway_port),
                });
            }

            if self.check_port_open().await {
                self.gateway_status = GatewayStatus::Running;
                if let Some(app) = app {
                    emit_install_progress(
                        app,
                        &format!("Gateway 探测成功，监听端口 {}。", self.gateway_port),
                        "info",
                    );
                }
                return Ok(ActionResult {
                    success: true,
                    message: format!("Gateway 已启动，端口 {}", self.gateway_port),
                });
            }
        }

        self.gateway_status = GatewayStatus::Error;
        let gateway_error_lines = gateway_error_lines
            .lock()
            .ok()
            .map(|slot| slot.clone())
            .unwrap_or_default();
        let message = format_gateway_start_failure_message(select_gateway_start_failure_detail(
            &gateway_error_lines,
        ));
        if let Some(app) = app {
            emit_install_progress(app, &message, "error");
        }
        Ok(ActionResult {
            success: false,
            message,
        })
    }

    pub async fn stop_gateway(&mut self, app: Option<&AppHandle>) -> Result<ActionResult, String> {
        if let Some(app) = app {
            emit_install_progress(app, "准备停止 Gateway。", "info");
        }

        self.restore_auth_token_from_config();

        if let Some(mut child) = self.gateway_process.take() {
            if let Some(app) = app {
                emit_install_progress(app, "正在终止当前托管的 Gateway 子进程。", "info");
            }
            let _ = child.kill().await;
            let _ = timeout(Duration::from_secs(3), child.wait()).await;
        }

        if self
            .wait_for_gateway_shutdown(Duration::from_secs(3))
            .await?
        {
            if let Some(app) = app {
                emit_install_progress(app, "Gateway 已停止。", "info");
            }
            return Ok(ActionResult {
                success: true,
                message: "Gateway 已停止。".to_string(),
            });
        }

        let stop_commands = self.collect_gateway_stop_commands().await?;
        if stop_commands.is_empty() {
            if let Some(app) = app {
                emit_install_progress(
                    app,
                    "未检测到可用的 OpenClaw 停止命令，将尝试按端口回收旧 Gateway。",
                    "warn",
                );
            }
        } else {
            for command_spec in &stop_commands {
                self.request_gateway_stop_via_command(command_spec, app)
                    .await;
                if self
                    .wait_for_gateway_shutdown(Duration::from_secs(4))
                    .await?
                {
                    if let Some(app) = app {
                        emit_install_progress(app, "Gateway 已停止。", "info");
                    }
                    return Ok(ActionResult {
                        success: true,
                        message: "Gateway 已停止。".to_string(),
                    });
                }
            }
        }

        let reclaimed_by_pid = self.force_stop_gateway_listener_processes(app).await?;
        if reclaimed_by_pid
            && self
                .wait_for_gateway_shutdown(Duration::from_secs(5))
                .await?
        {
            if let Some(app) = app {
                emit_install_progress(app, "Gateway 已停止。", "info");
            }
            return Ok(ActionResult {
                success: true,
                message: "Gateway 已停止。".to_string(),
            });
        }

        self.refresh_process_state().await?;
        let message = if self.check_port_open().await {
            format!(
                "Gateway 停止失败：端口 {} 仍被旧进程占用，升级已中止。请使用“立即重启生效”或结束旧 OpenClaw 进程后重试。",
                self.gateway_port
            )
        } else {
            "Gateway 停止流程已结束，但未能确认运行态完全退出，请重试。".to_string()
        };

        if let Some(app) = app {
            emit_install_progress(app, &message, "error");
        }

        Ok(ActionResult {
            success: false,
            message,
        })
    }

    pub async fn restart_gateway(&mut self, app: &AppHandle) -> Result<ActionResult, String> {
        emit_install_progress(app, "开始重启 Gateway。", "info");
        let stop_result = self.stop_gateway(Some(app)).await?;
        if !stop_result.success {
            return Ok(stop_result);
        }
        emit_install_progress(app, "Gateway 停止阶段结束，开始重新启动。", "info");
        self.start_gateway(Some(app), Some(self.gateway_port)).await
    }

    pub async fn get_status(&mut self) -> Result<GatewayStatusInfo, String> {
        self.refresh_process_state().await?;
        Ok(GatewayStatusInfo {
            status: self.gateway_status.clone(),
            port: self.gateway_port,
        })
    }

    pub async fn check_health(&mut self) -> Result<HealthInfo, String> {
        self.refresh_process_state().await?;

        self.restore_auth_token_from_config();

        let health_snapshot = self.fetch_authenticated_gateway_health_json().await;
        let healthy = self.gateway_status == GatewayStatus::Running
            && self.check_port_open().await
            && health_snapshot
                .as_ref()
                .and_then(|value| value.get("ok").and_then(Value::as_bool))
                .unwrap_or(false);
        let version = self.read_openclaw_version().await.ok().flatten();
        let uptime = self.gateway_started_at.and_then(|start| {
            SystemTime::now()
                .duration_since(start)
                .ok()
                .map(|elapsed| elapsed.as_secs())
        });

        Ok(HealthInfo {
            status: if healthy { "healthy" } else { "unhealthy" }.to_string(),
            gateway_port: self.gateway_port,
            uptime,
            version,
        })
    }

    pub async fn check_update(&self) -> Result<UpdateInfo, String> {
        let Some(openclaw_command) = resolve_openclaw_command().await? else {
            return Ok(UpdateInfo {
                has_update: false,
                current_version: None,
                latest_version: None,
                channel: None,
                install_kind: None,
                package_manager: None,
                message: Some("未检测到 OpenClaw 可执行文件，请先安装。".to_string()),
            });
        };

        let current_version = self
            .read_openclaw_version()
            .await?
            .and_then(|value| parse_openclaw_release_version(&value).or(Some(value)));

        let payload = match read_openclaw_update_status_payload(&openclaw_command).await {
            Ok(payload) => payload,
            Err(message) => {
                return Ok(UpdateInfo {
                    has_update: false,
                    current_version,
                    latest_version: None,
                    channel: None,
                    install_kind: None,
                    package_manager: None,
                    message: Some(message),
                });
            }
        };

        Ok(UpdateInfo {
            has_update: payload
                .pointer("/availability/available")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            current_version,
            latest_version: payload
                .pointer("/availability/latestVersion")
                .and_then(Value::as_str)
                .map(str::to_string),
            channel: payload
                .pointer("/channel/label")
                .or_else(|| payload.pointer("/channel/value"))
                .and_then(Value::as_str)
                .map(str::to_string),
            install_kind: payload
                .pointer("/update/installKind")
                .and_then(Value::as_str)
                .map(str::to_string),
            package_manager: payload
                .pointer("/update/packageManager")
                .and_then(Value::as_str)
                .map(str::to_string),
            message: payload
                .pointer("/update/registry/error")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    }

    pub async fn perform_update(&mut self, app: &AppHandle) -> Result<ActionResult, String> {
        emit_install_progress(app, "开始执行 OpenClaw 升级。", "info");

        let Some(openclaw_command) = resolve_openclaw_command().await? else {
            return Ok(ActionResult {
                success: false,
                message: "未检测到 OpenClaw 可执行文件，请先安装。".to_string(),
            });
        };
        let current_runtime_bin_dir = openclaw_command
            .command_path()
            .parent()
            .map(Path::to_path_buf);

        self.refresh_process_state().await?;
        let gateway_was_running = self.gateway_status == GatewayStatus::Running;
        if self.gateway_status == GatewayStatus::Running {
            emit_install_progress(
                app,
                "升级前先停止 Gateway，避免占用正在运行的 OpenClaw。",
                "info",
            );
            let stop_result = self.stop_gateway(Some(app)).await?;
            if !stop_result.success {
                return Ok(stop_result);
            }
        }

        if let Some(current_version) = self
            .read_openclaw_version()
            .await
            .ok()
            .flatten()
            .and_then(|value| parse_openclaw_release_version(&value).or(Some(value)))
        {
            emit_install_progress(
                app,
                &format!("当前版本 {current_version}，开始执行升级命令。"),
                "info",
            );
        }

        let update_status_payload =
            match read_openclaw_update_status_payload(&openclaw_command).await {
                Ok(payload) => payload,
                Err(message) => {
                    emit_install_progress(app, &message, "warn");
                    match attempt_direct_openclaw_package_upgrade(
                        app,
                        current_runtime_bin_dir.as_deref(),
                        None,
                        None,
                    )
                    .await
                    {
                        Ok(result) => {
                            set_preferred_runtime_bin_dir(Some(result.runtime_bin_dir.clone()));
                            emit_install_progress(
                                app,
                                &format!(
                                    "已自动切换后续执行环境到 {}。",
                                    result.runtime_bin_dir.display()
                                ),
                                "info",
                            );
                            return self
                                .finalize_successful_openclaw_update(
                                    app,
                                    gateway_was_running,
                                    Some(format!(
                                        "OpenClaw 已通过 {} 的 {} 全局升级完成（{}）。",
                                        result.runtime_source,
                                        result.package_manager,
                                        result.package_spec
                                    )),
                                )
                                .await;
                        }
                        Err(fallback_error) => {
                            emit_install_progress(app, &fallback_error, "error");
                            return Ok(ActionResult {
                                success: false,
                                message,
                            });
                        }
                    }
                }
            };
        let update_context = extract_openclaw_update_execution_context(&update_status_payload);
        if let Some(root) = update_context.root.as_ref().filter(|root| root.is_dir()) {
            emit_install_progress(
                app,
                &format!("已切换到 OpenClaw 安装根目录执行升级：{}", root.display()),
                "info",
            );
        }
        if let Some(install_kind) = update_context.install_kind.as_deref() {
            let package_manager = update_context
                .package_manager
                .as_deref()
                .unwrap_or("默认包管理器");
            emit_install_progress(
                app,
                &format!("检测到安装方式：{install_kind}（包管理器：{package_manager}）。"),
                "info",
            );
        }

        let mut command = openclaw_command.build_command_with_args(["update", "--yes", "--json"]);
        if let Some(root) = update_context.root.as_ref().filter(|root| root.is_dir()) {
            command.current_dir(root);
        }
        let output = command
            .env(OPENCLAW_CONFIG_ENV, openclaw_lime_config_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("执行 OpenClaw 升级失败: {e}"))?;

        let stdout_lines = command_output_lines(&output.stdout);
        for line in &stdout_lines {
            emit_install_progress(app, &line, classify_progress_level(&line, "info"));
        }
        let stderr_lines = command_output_lines(&output.stderr);
        for line in &stderr_lines {
            emit_install_progress(app, line, classify_progress_level(line, "warn"));
        }
        let stdout_payload = serde_json::from_slice::<Value>(&output.stdout).ok();

        if !output.status.success() {
            let failure_detail = select_openclaw_update_failure_detail(
                stdout_payload.as_ref(),
                &stderr_lines,
                &stdout_lines,
            );
            let message = format_openclaw_update_failure_message(failure_detail.as_deref());
            emit_install_progress(app, &message, "warn");

            match attempt_direct_openclaw_package_upgrade(
                app,
                current_runtime_bin_dir.as_deref(),
                update_context.root.as_deref(),
                update_context.package_manager.as_deref(),
            )
            .await
            {
                Ok(result) => {
                    set_preferred_runtime_bin_dir(Some(result.runtime_bin_dir.clone()));
                    emit_install_progress(
                        app,
                        &format!(
                            "已自动切换后续执行环境到 {}。",
                            result.runtime_bin_dir.display()
                        ),
                        "info",
                    );
                    return self
                        .finalize_successful_openclaw_update(
                            app,
                            gateway_was_running,
                            Some(format!(
                                "OpenClaw 已通过 {} 的 {} 全局升级完成（{}）。",
                                result.runtime_source, result.package_manager, result.package_spec
                            )),
                        )
                        .await;
                }
                Err(fallback_error) => {
                    emit_install_progress(app, &fallback_error, "error");
                    return Ok(ActionResult {
                        success: false,
                        message,
                    });
                }
            }
        }

        self.finalize_successful_openclaw_update(app, gateway_was_running, None)
            .await
    }

    async fn finalize_successful_openclaw_update(
        &mut self,
        app: &AppHandle,
        gateway_was_running: bool,
        success_message_override: Option<String>,
    ) -> Result<ActionResult, String> {
        self.refresh_process_state().await?;
        let updated_version = self
            .read_openclaw_version()
            .await
            .ok()
            .flatten()
            .and_then(|value| parse_openclaw_release_version(&value).or(Some(value)));

        if gateway_was_running {
            emit_install_progress(app, "升级前 Gateway 处于运行态，开始自动恢复服务。", "info");
            let restart_result = self
                .start_gateway(Some(app), Some(self.gateway_port))
                .await?;
            if !restart_result.success {
                return Ok(restart_result);
            }
        }

        let message = success_message_override.unwrap_or_else(|| {
            updated_version
                .as_ref()
                .map(|version| format!("OpenClaw 已升级完成，当前版本 {version}。"))
                .unwrap_or_else(|| "OpenClaw 已升级完成。".to_string())
        });
        emit_install_progress(app, &message, "info");
        Ok(ActionResult {
            success: true,
            message,
        })
    }

    pub fn get_dashboard_url(&mut self) -> String {
        self.restore_auth_token_from_config();
        let mut url = format!("http://127.0.0.1:{}", self.gateway_port);
        if !self.gateway_auth_token.is_empty() {
            url.push_str(&format!(
                "/#token={}",
                urlencoding::encode(&self.gateway_auth_token)
            ));
        }
        url
    }

    pub async fn get_channels(&mut self) -> Result<Vec<ChannelInfo>, String> {
        self.refresh_process_state().await?;
        if self.gateway_status != GatewayStatus::Running {
            return Ok(Vec::new());
        }

        self.restore_auth_token_from_config();

        let Some(body) = self.fetch_authenticated_gateway_health_json().await else {
            return Ok(Vec::new());
        };

        let channels_map = body
            .get("channels")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let labels = body
            .get("channelLabels")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let ordered_ids = body
            .get("channelOrder")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut ordered = Vec::new();
        for channel_id in ordered_ids.iter().filter_map(Value::as_str) {
            if let Some(entry) = channels_map.get(channel_id) {
                ordered.push(build_channel_info(
                    channel_id,
                    entry,
                    labels.get(channel_id),
                ));
            }
        }

        if ordered.is_empty() {
            ordered = channels_map
                .iter()
                .map(|(channel_id, entry)| {
                    build_channel_info(channel_id, entry, labels.get(channel_id))
                })
                .collect();
        }

        Ok(ordered)
    }

    pub fn sync_provider_config(
        &mut self,
        provider: &ApiKeyProvider,
        api_key: &str,
        primary_model_id: &str,
        models: &[SyncModelEntry],
    ) -> Result<ActionResult, String> {
        if api_key.trim().is_empty() && provider.provider_type != ApiProviderType::Ollama {
            return Ok(ActionResult {
                success: false,
                message: "该 Provider 没有可用的 API Key。".to_string(),
            });
        }

        let api_type = determine_api_type(provider.provider_type)?;
        let base_url = format_provider_base_url(provider)?;
        let provider_key = format!("lime-{}", provider.id);

        let normalized_models = if models.is_empty() {
            vec![SyncModelEntry {
                id: primary_model_id.to_string(),
                name: primary_model_id.to_string(),
                context_window: None,
            }]
        } else {
            let mut items = models.to_vec();
            if !items.iter().any(|item| item.id == primary_model_id) {
                items.insert(
                    0,
                    SyncModelEntry {
                        id: primary_model_id.to_string(),
                        name: primary_model_id.to_string(),
                        context_window: None,
                    },
                );
            }
            items
        };

        self.ensure_runtime_config(
            Some((
                &provider_key,
                json!({
                    "baseUrl": base_url,
                    "apiKey": api_key,
                    "api": api_type,
                    "models": normalized_models
                        .iter()
                        .map(sync_model_entry_to_config_value)
                        .collect::<Vec<_>>()
                }),
            )),
            Some(format!("{provider_key}/{primary_model_id}")),
        )?;

        Ok(ActionResult {
            success: true,
            message: format!("已同步 Provider“{}”到 OpenClaw。", provider.name),
        })
    }

    async fn wait_for_gateway_shutdown(&mut self, max_wait: Duration) -> Result<bool, String> {
        let start_at = tokio::time::Instant::now();
        while start_at.elapsed() < max_wait {
            self.refresh_process_state().await?;
            if !self.check_port_open().await {
                self.clear_gateway_runtime_state();
                return Ok(true);
            }
            sleep(Duration::from_millis(250)).await;
        }

        self.refresh_process_state().await?;
        if !self.check_port_open().await {
            self.clear_gateway_runtime_state();
            return Ok(true);
        }

        Ok(false)
    }

    async fn collect_gateway_stop_commands(&self) -> Result<Vec<ResolvedOpenClawCommand>, String> {
        let mut commands = Vec::new();

        if let Some(command) = resolve_openclaw_command().await? {
            commands.push(command);
        }

        let mut runtime_candidates = list_openclaw_runtime_candidates().await?;
        runtime_candidates.sort_by(compare_openclaw_runtime_candidates);
        commands.extend(
            runtime_candidates
                .iter()
                .filter_map(resolve_openclaw_command_from_runtime_candidate),
        );

        Ok(dedupe_openclaw_commands(commands))
    }

    async fn request_gateway_stop_via_command(
        &self,
        command_spec: &ResolvedOpenClawCommand,
        app: Option<&AppHandle>,
    ) {
        let binary_label = command_spec.invocation_display();
        if let Some(app) = app {
            emit_install_progress(
                app,
                &format!("尝试通过 {} 停止 Gateway。", binary_label),
                "info",
            );
        }

        let stop_args = vec![
            "gateway".to_string(),
            "stop".to_string(),
            "--url".to_string(),
            self.gateway_ws_url(),
            "--token".to_string(),
            self.gateway_auth_token.clone(),
        ];
        let mut command = command_spec.build_command_with_args(&stop_args);
        let output = timeout(
            Duration::from_secs(8),
            command
                .env(OPENCLAW_CONFIG_ENV, openclaw_lime_config_path())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match output {
            Ok(Ok(result)) => {
                for line in command_output_lines(&result.stdout) {
                    if let Some(app) = app {
                        emit_install_progress(app, &line, classify_progress_level(&line, "info"));
                    }
                }
                for line in command_output_lines(&result.stderr) {
                    if let Some(app) = app {
                        emit_install_progress(app, &line, classify_progress_level(&line, "warn"));
                    }
                }

                if let Some(app) = app {
                    if result.status.success() {
                        emit_install_progress(app, "已发送 Gateway 停止命令。", "info");
                    } else {
                        emit_install_progress(
                            app,
                            &format!("Gateway 停止命令返回异常状态: {:?}", result.status.code()),
                            "warn",
                        );
                    }
                }
            }
            Ok(Err(error)) => {
                if let Some(app) = app {
                    emit_install_progress(
                        app,
                        &format!("执行 Gateway 停止命令失败: {error}"),
                        "warn",
                    );
                }
            }
            Err(_) => {
                if let Some(app) = app {
                    emit_install_progress(
                        app,
                        "Gateway 停止命令超时，继续尝试自动回收旧进程。",
                        "warn",
                    );
                }
            }
        }
    }

    async fn force_stop_gateway_listener_processes(
        &mut self,
        app: Option<&AppHandle>,
    ) -> Result<bool, String> {
        let listener_pids = collect_listening_port_pids(self.gateway_port).await;
        if listener_pids.is_empty() {
            return Ok(false);
        }

        let mut system = System::new_all();
        system.refresh_all();

        let target_pids = collect_openclaw_process_family_pids(&system, &listener_pids);
        if target_pids.is_empty() {
            if let Some(app) = app {
                emit_install_progress(
                    app,
                    &format!(
                        "检测到端口 {} 仍被占用，但监听进程不是 OpenClaw，未执行自动终止。",
                        self.gateway_port
                    ),
                    "warn",
                );
            }
            return Ok(false);
        }

        if let Some(app) = app {
            emit_install_progress(
                app,
                &format!(
                    "检测到旧 Gateway 仍占用端口 {}，准备回收进程：{}。",
                    self.gateway_port,
                    target_pids
                        .iter()
                        .map(|pid| pid.as_u32().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                "warn",
            );
        }

        terminate_sysinfo_processes(&mut system, &target_pids).await;
        Ok(true)
    }

    async fn refresh_process_state(&mut self) -> Result<(), String> {
        let mut process_exited = false;

        if let Some(child) = self.gateway_process.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    tracing::info!(target: "openclaw", "Gateway 进程已退出: {}", status);
                    process_exited = true;
                }
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(target: "openclaw", "检查 Gateway 进程状态失败: {}", error);
                    process_exited = true;
                }
            }
        }

        if process_exited {
            self.gateway_process = None;
            self.gateway_started_at = None;
        }

        let openclaw_command = resolve_openclaw_command().await?;
        let running = self.check_port_open().await
            || self.check_gateway_status(openclaw_command.as_ref()).await?;

        self.gateway_status = if running {
            GatewayStatus::Running
        } else if self.gateway_status == GatewayStatus::Starting {
            GatewayStatus::Error
        } else {
            GatewayStatus::Stopped
        };

        if !running {
            self.gateway_process = None;
            self.gateway_started_at = None;
        }

        Ok(())
    }

    async fn check_port_open(&self) -> bool {
        timeout(
            Duration::from_secs(2),
            TcpStream::connect(("127.0.0.1", self.gateway_port)),
        )
        .await
        .map(|result| result.is_ok())
        .unwrap_or(false)
    }

    async fn check_gateway_status(
        &self,
        command_spec: Option<&ResolvedOpenClawCommand>,
    ) -> Result<bool, String> {
        let Some(command_spec) = command_spec else {
            return Ok(false);
        };

        let status_args = vec![
            "gateway".to_string(),
            "status".to_string(),
            "--url".to_string(),
            self.gateway_ws_url(),
            "--token".to_string(),
            self.gateway_auth_token.clone(),
        ];
        let mut command = command_spec.build_command_with_args(&status_args);
        let output = command
            .env(OPENCLAW_CONFIG_ENV, openclaw_lime_config_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout).to_lowercase();
                let stderr = String::from_utf8_lossy(&result.stderr).to_lowercase();
                Ok(result.status.success()
                    && (stdout.contains("listening")
                        || stdout.contains("running")
                        || stderr.contains("listening")))
            }
            Err(_) => Ok(false),
        }
    }

    async fn read_openclaw_version(&self) -> Result<Option<String>, String> {
        let Some(command_spec) = resolve_openclaw_command().await? else {
            return Ok(None);
        };

        read_openclaw_version_from_command(&command_spec).await
    }

    fn gateway_ws_url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.gateway_port)
    }

    fn restore_auth_token_from_config(&mut self) {
        if !self.gateway_auth_token.is_empty() {
            return;
        }

        match read_base_openclaw_config()
            .ok()
            .and_then(|config| extract_gateway_auth_token(&config))
        {
            Some(token) => {
                self.gateway_auth_token = token;
            }
            None => {
                tracing::warn!(
                    target: "openclaw",
                    "未能从 OpenClaw 配置恢复 gateway token，Dashboard 访问可能鉴权失败"
                );
            }
        }
    }

    async fn fetch_authenticated_gateway_health_json(&self) -> Option<Value> {
        if self.gateway_auth_token.is_empty() {
            return None;
        }

        let Some(command_spec) = resolve_openclaw_command().await.ok().flatten() else {
            return None;
        };

        let health_args = vec![
            "gateway".to_string(),
            "health".to_string(),
            "--url".to_string(),
            self.gateway_ws_url(),
            "--token".to_string(),
            self.gateway_auth_token.clone(),
            "--json".to_string(),
        ];
        let mut command = command_spec.build_command_with_args(&health_args);
        let output = command
            .env(OPENCLAW_CONFIG_ENV, openclaw_lime_config_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match output {
            Ok(output) if output.status.success() => {
                serde_json::from_slice::<Value>(&output.stdout)
                    .map_err(|error| {
                        tracing::warn!(
                            target: "openclaw",
                            "解析 Gateway 官方健康检查结果失败: {}",
                            error
                        );
                        error
                    })
                    .ok()
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                tracing::warn!(
                    target: "openclaw",
                    "Gateway 官方健康检查失败: {}",
                    stderr.trim()
                );
                None
            }
            Err(error) => {
                tracing::warn!(target: "openclaw", "执行 Gateway 官方健康检查失败: {}", error);
                None
            }
        }
    }

    fn ensure_runtime_config(
        &mut self,
        provider_entry: Option<(&str, Value)>,
        primary_model: Option<String>,
    ) -> Result<(), String> {
        let config_dir = openclaw_config_dir();
        std::fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {e}"))?;

        let lime_config_path = openclaw_lime_config_path();
        let mut config = read_base_openclaw_config()?;
        sanitize_runtime_config(&mut config);

        if self.gateway_auth_token.is_empty() {
            self.gateway_auth_token = generate_auth_token();
        }

        apply_gateway_runtime_defaults(&mut config, self.gateway_port, &self.gateway_auth_token);

        if let Some((provider_key, provider_value)) = provider_entry {
            set_json_path(
                &mut config,
                &["models", "mode"],
                Value::String("merge".to_string()),
            );
            set_json_path(
                &mut config,
                &["models", "providers", provider_key],
                provider_value,
            );
        }

        if let Some(primary) = primary_model {
            set_json_path(
                &mut config,
                &["agents", "defaults", "model", "primary"],
                Value::String(primary),
            );
        }

        let content =
            serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {e}"))?;
        std::fs::write(lime_config_path, content).map_err(|e| format!("写入配置失败: {e}"))?;
        Ok(())
    }

    async fn resolve_install_commands(
        &self,
        app: &AppHandle,
    ) -> Result<(String, String, Option<String>, String, String), String> {
        let npm_path = find_command_in_shell("npm")
            .await?
            .ok_or_else(|| "未检测到 npm，可先安装或修复 Node.js 环境。".to_string())?;
        let npm_prefix = detect_npm_global_prefix(&npm_path).await;
        let use_china_package = should_use_china_package(app).await;
        let package = if use_china_package {
            OPENCLAW_CN_PACKAGE
        } else {
            OPENCLAW_DEFAULT_PACKAGE
        };
        let shell_platform = current_shell_platform();
        let cleanup_command =
            build_openclaw_cleanup_command(shell_platform, &npm_path, npm_prefix.as_deref());
        let install_command = build_openclaw_install_command(
            shell_platform,
            &npm_path,
            npm_prefix.as_deref(),
            package,
            use_china_package.then_some(NPM_MIRROR_CN),
        );
        Ok((
            package.to_string(),
            npm_path,
            npm_prefix,
            cleanup_command,
            install_command,
        ))
    }

    async fn resolve_uninstall_command(&self) -> Result<(String, Option<String>, String), String> {
        let npm_path = find_command_in_shell("npm")
            .await?
            .ok_or_else(|| "未检测到 npm，可先安装或修复 Node.js 环境。".to_string())?;
        let npm_prefix = detect_npm_global_prefix(&npm_path).await;
        let command = build_openclaw_cleanup_command(
            current_shell_platform(),
            &npm_path,
            npm_prefix.as_deref(),
        );
        Ok((npm_path, npm_prefix, command))
    }

    async fn build_install_command_preview(
        &self,
        app: &AppHandle,
    ) -> Result<CommandPreview, String> {
        let (package, npm_path, npm_prefix, cleanup_command, install_command) =
            self.resolve_install_commands(app).await?;
        let prefix_note = npm_prefix
            .map(|prefix| format!("npm: {npm_path}\nprefix: {prefix}\n"))
            .unwrap_or_else(|| format!("npm: {npm_path}\n"));
        Ok(CommandPreview {
            title: format!("安装 {package}"),
            command: format!("{prefix_note}{cleanup_command}\n{install_command}"),
        })
    }

    async fn build_uninstall_command_preview(&self) -> Result<CommandPreview, String> {
        let (npm_path, npm_prefix, command) = self.resolve_uninstall_command().await?;
        let prefix_note = npm_prefix
            .map(|prefix| format!("npm: {npm_path}\nprefix: {prefix}\n"))
            .unwrap_or_else(|| format!("npm: {npm_path}\n"));
        Ok(CommandPreview {
            title: "卸载 OpenClaw".to_string(),
            command: format!("{prefix_note}{command}"),
        })
    }

    async fn build_start_command_preview(
        &mut self,
        port: Option<u16>,
    ) -> Result<CommandPreview, String> {
        if let Some(next_port) = port {
            self.gateway_port = next_port.max(1);
        }
        self.restore_auth_token_from_config();
        if self.gateway_auth_token.is_empty() {
            self.gateway_auth_token = generate_auth_token();
        }
        let openclaw_command = resolve_openclaw_command()
            .await?
            .ok_or_else(|| "未检测到 OpenClaw 可执行文件，请先安装。".to_string())?;
        let config_path = openclaw_lime_config_path();
        let command = gateway_start_args(self.gateway_port, &self.gateway_auth_token)
            .into_iter()
            .map(|arg| shell_escape(&arg))
            .collect::<Vec<_>>()
            .join(" ");
        Ok(CommandPreview {
            title: "启动 Gateway".to_string(),
            command: format!(
                "{}OPENCLAW_CONFIG_PATH={} {} {}",
                if cfg!(target_os = "windows") {
                    "set "
                } else {
                    ""
                },
                shell_escape(config_path.to_string_lossy().as_ref()),
                openclaw_command.preview_invocation(),
                command
            ),
        })
    }

    async fn build_stop_command_preview(
        &mut self,
        port: Option<u16>,
    ) -> Result<CommandPreview, String> {
        if let Some(next_port) = port {
            self.gateway_port = next_port.max(1);
        }
        self.restore_auth_token_from_config();
        let openclaw_command = resolve_openclaw_command()
            .await?
            .ok_or_else(|| "未检测到 OpenClaw 可执行文件，请先安装。".to_string())?;
        let config_path = openclaw_lime_config_path();
        Ok(CommandPreview {
            title: "停止 Gateway".to_string(),
            command: format!(
                "OPENCLAW_CONFIG_PATH={} {} gateway stop --url {} --token {}",
                shell_escape(config_path.to_string_lossy().as_ref()),
                openclaw_command.preview_invocation(),
                self.gateway_ws_url(),
                shell_escape(&self.gateway_auth_token)
            ),
        })
    }

    async fn build_restart_command_preview(
        &mut self,
        port: Option<u16>,
    ) -> Result<CommandPreview, String> {
        let stop = self.build_stop_command_preview(port).await?;
        let start = self.build_start_command_preview(port).await?;
        Ok(CommandPreview {
            title: "重启 Gateway".to_string(),
            command: format!("{}\n{}", stop.command, start.command),
        })
    }
}

pub fn openclaw_install_event_name() -> &'static str {
    OPENCLAW_INSTALL_EVENT
}

fn openclaw_config_dir() -> PathBuf {
    home_dir()
        .or_else(data_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".openclaw")
}

fn openclaw_original_config_path() -> PathBuf {
    openclaw_config_dir().join("openclaw.json")
}

fn openclaw_lime_config_path() -> PathBuf {
    openclaw_config_dir().join("openclaw.lime.json")
}

#[cfg(any(target_os = "windows", test))]
fn windows_dependency_setup_message(
    dependency: DependencyKind,
    status: &DependencyStatus,
) -> String {
    let guidance = match dependency {
        DependencyKind::Node => format!(
            "Windows 下请先从 nodejs.org 安装或升级 Node.js {}+，完成后点击“重新检测”，再安装 OpenClaw。",
            NODE_MIN_VERSION.0
        ),
        DependencyKind::Git => {
            "Windows 下请先从 git-scm.com 安装 Git（安装时请勾选加入 PATH），完成后点击“重新检测”，再安装 OpenClaw。"
                .to_string()
        }
    };

    format!("{} {}", status.message, guidance)
}

#[cfg(any(target_os = "windows", test))]
fn windows_dependency_action_result(
    dependency: DependencyKind,
    status: &DependencyStatus,
) -> ActionResult {
    ActionResult {
        success: false,
        message: windows_dependency_setup_message(dependency, status),
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_install_block_result(
    node_status: &DependencyStatus,
    git_status: &DependencyStatus,
) -> Option<ActionResult> {
    if node_status.status != "ok" {
        return Some(windows_dependency_action_result(
            DependencyKind::Node,
            node_status,
        ));
    }

    if git_status.status != "ok" {
        return Some(windows_dependency_action_result(
            DependencyKind::Git,
            git_status,
        ));
    }

    None
}

fn dependency_setup_summary(dependency: DependencyKind) -> String {
    if cfg!(target_os = "windows") {
        return match dependency {
            DependencyKind::Node => format!(
                "当前缺少可用的 Node.js {}+ 运行时，Windows 下请先手动安装 Node.js，完成后点击“重新检测”，再安装 OpenClaw。",
                NODE_MIN_VERSION.0
            ),
            DependencyKind::Git => {
                "当前缺少可用的 Git，Windows 下请先手动安装 Git（安装时请勾选加入 PATH），完成后点击“重新检测”，再安装 OpenClaw。"
                    .to_string()
            }
        };
    }

    if cfg!(target_os = "macos") {
        return match dependency {
            DependencyKind::Node => format!(
                "当前缺少可用的 Node.js {}+ 运行时，建议先一键安装或修复 Node.js。",
                format_semver(NODE_MIN_VERSION)
            ),
            DependencyKind::Git => "当前缺少可用的 Git，建议先一键安装或修复 Git。".to_string(),
        };
    }

    match dependency {
        DependencyKind::Node => format!(
            "当前缺少可用的 Node.js {}+ 运行时，请先手动安装后重新检测。",
            format_semver(NODE_MIN_VERSION)
        ),
        DependencyKind::Git => "当前缺少可用的 Git，请先手动安装后重新检测。".to_string(),
    }
}

fn openclaw_installer_download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app;
    let app_data_dir = lime_core::app_paths::preferred_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let dir = app_data_dir.join("downloads").join("openclaw-installers");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 OpenClaw 下载目录失败: {e}"))?;
    Ok(dir)
}

fn collect_temp_artifact_paths(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut targets = Vec::new();

    #[cfg(not(target_os = "windows"))]
    {
        targets.push(PathBuf::from(OPENCLAW_TEMP_CARGO_CHECK_DIR));
    }

    if let Some(app) = app {
        if let Ok(dir) = openclaw_installer_download_dir(app) {
            targets.push(dir);
        }
    }

    targets
}

fn build_environment_status(
    node: DependencyStatus,
    git: DependencyStatus,
    mut openclaw: DependencyStatus,
    diagnostics: EnvironmentDiagnostics,
) -> EnvironmentStatus {
    let node_ready = node.status == "ok";
    let git_ready = git.status == "ok";
    openclaw.auto_install_supported = node_ready && git_ready;

    let (recommended_action, summary) = if !node_ready {
        (
            "install_node".to_string(),
            dependency_setup_summary(DependencyKind::Node),
        )
    } else if !git_ready {
        (
            "install_git".to_string(),
            dependency_setup_summary(DependencyKind::Git),
        )
    } else if openclaw.status == "needs_reload" {
        (
            "refresh_openclaw_env".to_string(),
            "已检测到 OpenClaw 包，但命令尚未生效；请点击“重新检测”，必要时重启 Lime。".to_string(),
        )
    } else if openclaw.status != "ok" {
        (
            "install_openclaw".to_string(),
            "运行环境已就绪，可以继续一键安装 OpenClaw。".to_string(),
        )
    } else {
        (
            "ready".to_string(),
            "Node.js、Git 和 OpenClaw 均已就绪，可以继续配置与启动。".to_string(),
        )
    };

    EnvironmentStatus {
        node,
        git,
        openclaw,
        recommended_action,
        summary,
        diagnostics,
        temp_artifacts: collect_temp_artifact_paths(None)
            .into_iter()
            .filter(|path| path.exists())
            .map(|path| path.display().to_string())
            .collect(),
    }
}

async fn inspect_node_dependency_status() -> Result<DependencyStatus, String> {
    let Some(path) = find_command_in_shell("node").await? else {
        return Ok(DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: format!(
                "未检测到 Node.js，需要安装 {}+。",
                format_semver(NODE_MIN_VERSION)
            ),
            auto_install_supported: cfg!(target_os = "macos"),
        });
    };

    let version_text = read_command_version_text(&path, &["--version"]).await?;
    let Some(version) = parse_semver_from_text(&version_text) else {
        return Ok(DependencyStatus {
            status: "version_low".to_string(),
            version: Some(version_text.clone()),
            path: Some(path),
            message: format!(
                "检测到 Node.js，但无法识别版本：{version_text}。请安装 {}+。",
                format_semver(NODE_MIN_VERSION)
            ),
            auto_install_supported: cfg!(target_os = "macos"),
        });
    };

    let normalized = format_semver(version);
    if version >= NODE_MIN_VERSION {
        Ok(DependencyStatus {
            status: "ok".to_string(),
            version: Some(normalized.clone()),
            path: Some(path),
            message: format!("Node.js 已就绪：{normalized}"),
            auto_install_supported: cfg!(target_os = "macos"),
        })
    } else {
        Ok(DependencyStatus {
            status: "version_low".to_string(),
            version: Some(normalized.clone()),
            path: Some(path),
            message: format!(
                "Node.js 版本过低：{normalized}，需要 {}+。",
                format_semver(NODE_MIN_VERSION)
            ),
            auto_install_supported: cfg!(target_os = "macos"),
        })
    }
}

async fn inspect_git_dependency_status() -> Result<DependencyStatus, String> {
    let Some(path) = find_command_in_shell("git").await? else {
        return Ok(DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 Git。".to_string(),
            auto_install_supported: git_auto_install_supported().await?,
        });
    };

    let version_text = read_command_version_text(&path, &["--version"]).await?;
    let version = parse_semver_from_text(&version_text).map(format_semver);
    let detail = version.clone().unwrap_or(version_text);

    Ok(DependencyStatus {
        status: "ok".to_string(),
        version,
        path: Some(path),
        message: format!("Git 已就绪：{detail}"),
        auto_install_supported: git_auto_install_supported().await?,
    })
}

async fn inspect_openclaw_dependency_status() -> Result<DependencyStatus, String> {
    let Some(command) = resolve_openclaw_command().await? else {
        if let Some(status) = inspect_openclaw_package_reload_status().await? {
            return Ok(status);
        }

        return Ok(DependencyStatus {
            status: "missing".to_string(),
            version: None,
            path: None,
            message: "未检测到 OpenClaw，可在环境就绪后一键安装。".to_string(),
            auto_install_supported: false,
        });
    };

    let version_text = read_openclaw_version_from_command(&command)
        .await?
        .unwrap_or_default();
    Ok(DependencyStatus {
        status: "ok".to_string(),
        version: if version_text.is_empty() {
            None
        } else {
            Some(version_text.clone())
        },
        path: Some(command.install_path_display()),
        message: if matches!(command, ResolvedOpenClawCommand::NodeCli { .. }) {
            if version_text.is_empty() {
                "已检测到 OpenClaw 包，Lime 将通过当前 Node 运行时直接启动。".to_string()
            } else {
                format!("已检测到 OpenClaw 包，Lime 将通过当前 Node 运行时直接启动：{version_text}")
            }
        } else if version_text.is_empty() {
            "已检测到 OpenClaw。".to_string()
        } else {
            format!("已检测到 OpenClaw：{version_text}")
        },
        auto_install_supported: false,
    })
}

async fn inspect_openclaw_package_reload_status() -> Result<Option<DependencyStatus>, String> {
    let Some(npm_path) = find_command_in_standard_locations("npm").await? else {
        return Ok(None);
    };
    let Some(prefix) = detect_npm_global_prefix(&npm_path).await else {
        return Ok(None);
    };
    let Some(package) = find_installed_openclaw_package_details(&prefix) else {
        return Ok(None);
    };

    let version_suffix = package
        .version
        .as_deref()
        .map(|item| format!("（{item}）"))
        .unwrap_or_default();

    Ok(Some(DependencyStatus {
        status: "needs_reload".to_string(),
        version: package.version.clone(),
        path: Some(prefix.clone()),
        message: format!(
            "已在 npm 全局目录检测到 {}{}，但当前进程尚未解析到 openclaw 命令。请点击“重新检测”；若仍失败，请重启 Lime，或确认 {prefix} 已加入 PATH。", package.name, version_suffix
        ),
        auto_install_supported: false,
    }))
}

async fn git_auto_install_supported() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(true)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

async fn read_command_version_text(command_path: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(command_path);
    apply_binary_runtime_path(&mut command, command_path);
    for arg in args {
        command.arg(arg);
    }
    let output = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("执行命令失败({command_path}): {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        Ok(stdout)
    } else {
        Ok(stderr)
    }
}

async fn resolve_node_installer_asset() -> Result<InstallerAsset, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://nodejs.org/dist/index.json")
        .header("User-Agent", OPENCLAW_INSTALLER_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("请求 Node.js 版本列表失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "获取 Node.js 版本列表失败: HTTP {}",
            response.status()
        ));
    }

    let releases: Vec<Value> = response
        .json()
        .await
        .map_err(|e| format!("解析 Node.js 版本列表失败: {e}"))?;

    let select_version = |only_lts: bool| -> Option<String> {
        releases.iter().find_map(|release| {
            let version = release.get("version")?.as_str()?;
            let parsed = parse_semver(version)?;
            let is_lts = release
                .get("lts")
                .map(|value| match value {
                    Value::Bool(flag) => *flag,
                    Value::String(text) => !text.trim().is_empty() && text != "false",
                    _ => false,
                })
                .unwrap_or(false);
            if parsed >= NODE_MIN_VERSION && (!only_lts || is_lts) {
                Some(version.to_string())
            } else {
                None
            }
        })
    };

    let version = select_version(true)
        .or_else(|| select_version(false))
        .ok_or_else(|| "未找到满足要求的 Node.js 官方安装包版本。".to_string())?;

    #[cfg(target_os = "windows")]
    let filename = {
        #[cfg(target_arch = "aarch64")]
        {
            format!("node-{version}-arm64.msi")
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            format!("node-{version}-x64.msi")
        }
    };

    #[cfg(target_os = "macos")]
    let filename = format!("node-{version}.pkg");

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let filename = String::new();

    if filename.is_empty() {
        return Err("当前平台暂不支持自动下载官方 Node.js 安装器。".to_string());
    }

    Ok(InstallerAsset {
        download_url: format!("https://nodejs.org/dist/{version}/{filename}"),
        filename,
    })
}

async fn download_installer_asset(
    app: &AppHandle,
    asset: &InstallerAsset,
) -> Result<PathBuf, String> {
    let download_dir = openclaw_installer_download_dir(app)?;
    let installer_path = download_dir.join(&asset.filename);
    if installer_path.exists() {
        let _ = std::fs::remove_file(&installer_path);
    }

    emit_install_progress(
        app,
        &format!("开始下载安装器：{}", asset.download_url),
        "info",
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&asset.download_url)
        .header("User-Agent", OPENCLAW_INSTALLER_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("下载官方安装器失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("下载安装器失败: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取安装器文件失败: {e}"))?;
    std::fs::write(&installer_path, bytes)
        .map_err(|e| format!("保存安装器失败({}): {e}", installer_path.display()))?;

    emit_install_progress(
        app,
        &format!("安装器已保存到：{}", installer_path.display()),
        "info",
    );

    Ok(installer_path)
}

fn launch_installer(file_path: &Path) -> Result<(), String> {
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "exe" => {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new(file_path)
                    .spawn()
                    .map_err(|e| format!("启动安装程序失败: {e}"))?;
            }

            #[cfg(not(target_os = "windows"))]
            {
                return Err("EXE 安装器只能在 Windows 上运行。".to_string());
            }
        }
        "msi" => {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("msiexec")
                    .arg("/i")
                    .arg(file_path)
                    .spawn()
                    .map_err(|e| format!("启动 MSI 安装程序失败: {e}"))?;
            }

            #[cfg(not(target_os = "windows"))]
            {
                return Err("MSI 安装器只能在 Windows 上运行。".to_string());
            }
        }
        "pkg" | "dmg" => {
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open")
                    .arg(file_path)
                    .spawn()
                    .map_err(|e| format!("打开 macOS 安装器失败: {e}"))?;
            }

            #[cfg(not(target_os = "macos"))]
            {
                return Err("该安装器只能在 macOS 上运行。".to_string());
            }
        }
        _ => return Err(format!("不支持的安装器文件类型: {extension}")),
    }

    Ok(())
}

#[cfg(target_os = "macos")]
async fn trigger_macos_command_line_tools_install() -> Result<String, String> {
    let output = Command::new("/usr/bin/xcode-select")
        .arg("--install")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("拉起 macOS 开发者工具安装器失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = if !stderr.is_empty() { stderr } else { stdout };
    let lower = combined.to_ascii_lowercase();

    if output.status.success()
        || lower.contains("install requested")
        || lower.contains("already been requested")
    {
        return Ok("已拉起 macOS 开发者工具安装器。".to_string());
    }

    if lower.contains("already installed") {
        return Err(
            "系统提示 Command Line Tools 已安装，但当前仍未检测到 Git，请先执行系统更新或安装 Homebrew 后重试。"
                .to_string(),
        );
    }

    Err(format!("拉起 macOS 开发者工具安装器失败: {combined}"))
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
async fn trigger_macos_command_line_tools_install() -> Result<String, String> {
    Err("当前平台不支持拉起 macOS 开发者工具安装器。".to_string())
}

fn read_base_openclaw_config() -> Result<Value, String> {
    let lime_path = openclaw_lime_config_path();
    if lime_path.exists() {
        return read_json_file(&lime_path);
    }

    let original_path = openclaw_original_config_path();
    if original_path.exists() {
        return read_json_file(&original_path);
    }

    Ok(json!({}))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("读取配置文件失败({}): {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败({}): {e}", path.display()))
}

fn ensure_path_object<'a>(root: &'a mut Value, path: &[&str]) -> &'a mut Map<String, Value> {
    let mut current = root;
    for segment in path {
        let object = ensure_value_object(current);
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    ensure_value_object(current)
}

fn set_json_path(root: &mut Value, path: &[&str], value: Value) {
    if path.is_empty() {
        *root = value;
        return;
    }

    let parent = ensure_path_object(root, &path[..path.len() - 1]);
    parent.insert(path[path.len() - 1].to_string(), value);
}

fn sync_model_entry_to_config_value(model: &SyncModelEntry) -> Value {
    let mut entry = Map::new();
    entry.insert("id".to_string(), Value::String(model.id.clone()));
    entry.insert("name".to_string(), Value::String(model.name.clone()));
    if let Some(context_window) = model.context_window {
        entry.insert(
            "contextWindow".to_string(),
            Value::Number(context_window.into()),
        );
    }
    Value::Object(entry)
}

fn sanitize_runtime_config(config: &mut Value) {
    let Some(providers) = config
        .get_mut("models")
        .and_then(|models| models.get_mut("providers"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };

    for provider in providers.values_mut() {
        let Some(models) = provider.get_mut("models").and_then(Value::as_array_mut) else {
            continue;
        };

        for model in models {
            let Some(entry) = model.as_object_mut() else {
                continue;
            };

            if matches!(entry.get("contextWindow"), Some(Value::Null)) {
                entry.remove("contextWindow");
            }
        }
    }
}

fn apply_gateway_runtime_defaults(config: &mut Value, gateway_port: u16, gateway_auth_token: &str) {
    ensure_path_object(config, &["gateway"]);
    set_json_path(
        config,
        &["gateway", "mode"],
        Value::String("local".to_string()),
    );
    set_json_path(
        config,
        &["gateway", "bind"],
        Value::String("loopback".to_string()),
    );
    set_json_path(
        config,
        &["gateway", "port"],
        Value::Number(gateway_port.into()),
    );
    set_json_path(
        config,
        &["gateway", "auth", "mode"],
        Value::String("token".to_string()),
    );
    set_json_path(
        config,
        &["gateway", "auth", "token"],
        Value::String(gateway_auth_token.to_string()),
    );
    set_json_path(
        config,
        &["gateway", "remote", "token"],
        Value::String(gateway_auth_token.to_string()),
    );
}

fn gateway_start_args(gateway_port: u16, gateway_auth_token: &str) -> Vec<String> {
    vec![
        "gateway".to_string(),
        "--allow-unconfigured".to_string(),
        "--bind".to_string(),
        "loopback".to_string(),
        "--auth".to_string(),
        "token".to_string(),
        "--token".to_string(),
        gateway_auth_token.to_string(),
        "--port".to_string(),
        gateway_port.to_string(),
    ]
}

fn push_gateway_error_line(lines: &mut Vec<String>, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    if lines.len() >= 32 {
        lines.remove(0);
    }
    lines.push(trimmed.to_string());
}

fn select_gateway_start_failure_detail<'a>(lines: &'a [String]) -> Option<&'a str> {
    lines
        .iter()
        .filter_map(|line| {
            let trimmed = line.trim();
            let score = gateway_failure_line_score(trimmed);
            (score > 0).then_some((score, trimmed))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, line)| line)
}

fn gateway_failure_line_score(line: &str) -> u8 {
    if line.is_empty() {
        return 0;
    }

    let normalized = line.to_ascii_lowercase();
    if normalized.starts_with("run: openclaw doctor")
        || normalized == "config invalid"
        || normalized.starts_with("file:")
        || normalized == "problem:"
    {
        return 0;
    }

    if normalized.contains("invalid config") {
        return 100;
    }

    if normalized.contains("contextwindow") && normalized.contains("received null") {
        return 95;
    }

    if normalized.contains("address already in use")
        || normalized.contains("eaddrinuse")
        || normalized.contains("resolved to non-loopback host")
    {
        return 90;
    }

    if normalized.contains("missing config")
        || normalized.contains("gateway.mode=local")
        || normalized.contains("gateway.auth.mode")
    {
        return 85;
    }

    if normalized.starts_with("- ") {
        return 60;
    }

    20
}

fn command_output_lines(output: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(output)
        .lines()
        .map(sanitize_progress_line)
        .filter(|line| !line.is_empty())
        .collect()
}

fn normalize_process_probe_text(value: &str) -> String {
    value.replace('\\', "/").to_ascii_lowercase()
}

fn process_looks_like_openclaw_process(
    process_name: &str,
    exe_path: Option<&Path>,
    command_args: &[OsString],
) -> bool {
    let process_name = normalize_process_probe_text(process_name);
    let exe_path = exe_path
        .map(|path| normalize_process_probe_text(&path.display().to_string()))
        .unwrap_or_default();
    let command_line = normalize_process_probe_text(
        &command_args
            .iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" "),
    );

    process_name.contains("openclaw")
        || exe_path.contains("openclaw")
        || command_line.contains("openclaw")
}

fn collect_openclaw_process_family_pids(system: &System, listener_pids: &[u32]) -> Vec<Pid> {
    let mut target_pids = HashSet::new();

    for listener_pid in listener_pids {
        let pid = Pid::from_u32(*listener_pid);
        let Some(process) = system.process(pid) else {
            continue;
        };
        if !process_looks_like_openclaw_process(
            &process.name().to_string_lossy(),
            process.exe(),
            process.cmd(),
        ) {
            continue;
        }

        target_pids.insert(pid);
        let mut parent_pid = process.parent();
        while let Some(next_parent) = parent_pid {
            let Some(parent_process) = system.process(next_parent) else {
                break;
            };
            if !process_looks_like_openclaw_process(
                &parent_process.name().to_string_lossy(),
                parent_process.exe(),
                parent_process.cmd(),
            ) {
                break;
            }

            target_pids.insert(next_parent);
            parent_pid = parent_process.parent();
        }
    }

    let mut target_pids = target_pids.into_iter().collect::<Vec<_>>();
    target_pids.sort_by_key(|pid| pid.as_u32());
    target_pids
}

async fn terminate_sysinfo_processes(system: &mut System, target_pids: &[Pid]) {
    for pid in target_pids {
        if let Some(process) = system.process(*pid) {
            let terminated = process.kill_with(Signal::Term).unwrap_or(false);
            if !terminated {
                let _ = process.kill();
            }
        }
    }

    sleep(Duration::from_millis(900)).await;
    system.refresh_all();

    for pid in target_pids {
        if let Some(process) = system.process(*pid) {
            let _ = process.kill();
        }
    }
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn parse_lsof_listener_pids(output: &str) -> Vec<u32> {
    let mut pids = output
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect::<Vec<_>>();
    pids.sort_unstable();
    pids.dedup();
    pids
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_windows_netstat_listener_pids(output: &str, port: u16) -> Vec<u32> {
    let mut pids = output
        .lines()
        .filter_map(|line| {
            let columns = line.split_whitespace().collect::<Vec<_>>();
            if columns.len() < 5 {
                return None;
            }

            let local_address = columns.get(1).copied().unwrap_or_default();
            let state = columns.get(3).copied().unwrap_or_default();
            if !state.eq_ignore_ascii_case("LISTENING")
                || !local_address.ends_with(&format!(":{port}"))
            {
                return None;
            }

            columns.last().and_then(|value| value.parse::<u32>().ok())
        })
        .collect::<Vec<_>>();
    pids.sort_unstable();
    pids.dedup();
    pids
}

async fn collect_listening_port_pids(port: u16) -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        collect_listening_port_pids_windows(port).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        collect_listening_port_pids_unix(port).await
    }
}

#[cfg(not(target_os = "windows"))]
async fn collect_listening_port_pids_unix(port: u16) -> Vec<u32> {
    let mut command = Command::new("lsof");
    apply_windows_no_window(&mut command);
    let output = timeout(
        Duration::from_secs(3),
        command
            .arg("-nP")
            .arg(format!("-iTCP:{port}"))
            .arg("-sTCP:LISTEN")
            .arg("-t")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output(),
    )
    .await;

    match output {
        Ok(Ok(result)) if result.status.success() => {
            parse_lsof_listener_pids(&String::from_utf8_lossy(&result.stdout))
        }
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
async fn collect_listening_port_pids_windows(port: u16) -> Vec<u32> {
    let mut command = Command::new("netstat");
    apply_windows_no_window(&mut command);
    let output = timeout(
        Duration::from_secs(3),
        command
            .arg("-ano")
            .arg("-p")
            .arg("tcp")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output(),
    )
    .await;

    match output {
        Ok(Ok(result)) if result.status.success() => {
            parse_windows_netstat_listener_pids(&String::from_utf8_lossy(&result.stdout), port)
        }
        _ => Vec::new(),
    }
}

fn parse_openclaw_release_version(value: &str) -> Option<String> {
    static VERSION_RE: OnceLock<Regex> = OnceLock::new();
    VERSION_RE
        .get_or_init(|| Regex::new(r"(?i)openclaw\s+([0-9]+(?:\.[0-9]+)+)").expect("valid regex"))
        .captures(value)
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()))
}

async fn read_openclaw_update_status_payload(
    command_spec: &ResolvedOpenClawCommand,
) -> Result<Value, String> {
    let mut command = command_spec.build_command_with_args(["update", "status", "--json"]);
    let output = command
        .env(OPENCLAW_CONFIG_ENV, openclaw_lime_config_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("检查 OpenClaw 更新失败: {e}"))?;

    let stdout_lines = command_output_lines(&output.stdout);
    let stderr_lines = command_output_lines(&output.stderr);
    let payload = serde_json::from_slice::<Value>(&output.stdout).map_err(|error| {
        let detail = select_openclaw_update_failure_detail(None, &stderr_lines, &stdout_lines)
            .unwrap_or_else(|| format!("解析更新状态失败: {error}"));
        format_openclaw_update_failure_message(Some(detail.as_str()))
    })?;

    if !output.status.success() {
        let detail =
            select_openclaw_update_failure_detail(Some(&payload), &stderr_lines, &stdout_lines);
        return Err(format_openclaw_update_failure_message(detail.as_deref()));
    }

    Ok(payload)
}

fn extract_openclaw_update_execution_context(payload: &Value) -> OpenClawUpdateExecutionContext {
    OpenClawUpdateExecutionContext {
        root: payload
            .pointer("/update/root")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        install_kind: payload
            .pointer("/update/installKind")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        package_manager: payload
            .pointer("/update/packageManager")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    }
}

fn select_openclaw_update_failure_detail(
    payload: Option<&Value>,
    stderr_lines: &[String],
    stdout_lines: &[String],
) -> Option<String> {
    if let Some(payload) = payload {
        if let Some(reason) = payload.get("reason").and_then(Value::as_str) {
            let root_suffix = payload
                .get("root")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|root| format!(" ({root})"))
                .unwrap_or_default();
            return Some(format!("{reason}{root_suffix}"));
        }

        if let Some(message) = payload.get("message").and_then(Value::as_str) {
            let trimmed = message.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        if let Some(message) = payload
            .pointer("/update/registry/error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(message.to_string());
        }
    }

    stderr_lines
        .iter()
        .chain(stdout_lines.iter())
        .filter_map(|line| {
            let trimmed = line.trim();
            let score = openclaw_update_failure_line_score(trimmed);
            (score > 0).then_some((score, trimmed))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, line)| line.to_string())
}

fn openclaw_update_failure_line_score(line: &str) -> u8 {
    if line.is_empty() {
        return 0;
    }

    let normalized = line.to_ascii_lowercase();
    if normalized.starts_with("updating openclaw")
        || normalized.starts_with("update result")
        || normalized.starts_with("total time")
        || normalized.starts_with("root:")
    {
        return 0;
    }

    if normalized.contains("not-openclaw-root") {
        return 100;
    }

    if normalized.contains("node.js") && normalized.contains("required") {
        return 95;
    }

    if normalized.contains("fetch failed") || normalized.contains("network") {
        return 90;
    }

    if normalized.contains("pnpm") && normalized.contains("not found")
        || normalized.contains("npm") && normalized.contains("not found")
    {
        return 85;
    }

    if normalized.contains("already up to date") || normalized.contains("not modified") {
        return 80;
    }

    if normalized.starts_with("reason:") {
        return 70;
    }

    20
}

fn format_openclaw_update_failure_message(detail: Option<&str>) -> String {
    let Some(detail) = detail.map(str::trim).filter(|value| !value.is_empty()) else {
        return "OpenClaw 升级失败，请查看日志输出。".to_string();
    };

    let normalized = detail.to_ascii_lowercase();
    if normalized.contains("not-openclaw-root") {
        return "OpenClaw 升级失败：未在 OpenClaw 安装根目录执行更新。Lime 会优先切换到安装目录；如仍失败，请重新检测安装状态后重试。"
            .to_string();
    }

    if normalized.contains("node.js") && normalized.contains("required") {
        return format!(
            "OpenClaw 升级失败：当前用于执行 openclaw 的 Node.js 版本过低，需要 {}+。请切换到满足要求的 Node.js 后重试。",
            format_semver(NODE_MIN_VERSION)
        );
    }

    if normalized.contains("fetch failed") || normalized.contains("network") {
        return "OpenClaw 升级失败：当前无法访问更新源，请检查网络或代理设置后重试。".to_string();
    }

    if normalized.contains("not modified") || normalized.contains("already up to date") {
        return "OpenClaw 当前已经是最新版本，无需升级。".to_string();
    }

    if normalized.contains("pnpm") && normalized.contains("not found") {
        return "OpenClaw 升级失败：当前安装方式依赖 pnpm，但系统未找到 pnpm。请先修复 Node.js / pnpm 环境后重试。"
            .to_string();
    }

    if normalized.contains("npm") && normalized.contains("not found") {
        return "OpenClaw 升级失败：当前安装方式依赖 npm，但系统未找到 npm。请先修复 Node.js / npm 环境后重试。"
            .to_string();
    }

    format!("OpenClaw 升级失败：{detail}")
}

async fn attempt_direct_openclaw_package_upgrade(
    app: &AppHandle,
    runtime_bin_dir_hint: Option<&Path>,
    install_root_hint: Option<&Path>,
    package_manager_hint: Option<&str>,
) -> Result<OpenClawDirectUpgradeResult, String> {
    let mut runtime_candidates = list_openclaw_runtime_candidates().await?;
    runtime_candidates.sort_by(|left, right| {
        let left_matches_root = install_root_hint
            .map(|root| runtime_candidate_matches_install_root(left, root))
            .unwrap_or(false);
        let right_matches_root = install_root_hint
            .map(|root| runtime_candidate_matches_install_root(right, root))
            .unwrap_or(false);
        let left_matches_bin = runtime_bin_dir_hint
            .map(|hint| Path::new(&left.bin_dir) == hint)
            .unwrap_or(false);
        let right_matches_bin = runtime_bin_dir_hint
            .map(|hint| Path::new(&right.bin_dir) == hint)
            .unwrap_or(false);

        right_matches_root
            .cmp(&left_matches_root)
            .then_with(|| right_matches_bin.cmp(&left_matches_bin))
            .then_with(|| compare_openclaw_runtime_candidates(left, right))
    });
    let mut last_error = None;
    let mut attempted = 0usize;

    if let Some(install_root_hint) = install_root_hint {
        emit_install_progress(
            app,
            &format!(
                "官方 updater 报告的安装根目录为 {}，将优先匹配该安装来源执行兜底升级。",
                install_root_hint.display()
            ),
            "info",
        );
    }

    for candidate in runtime_candidates {
        let Some(plan) = resolve_direct_openclaw_upgrade_plan(
            app,
            &candidate,
            runtime_bin_dir_hint,
            install_root_hint,
            package_manager_hint,
        )
        .await?
        else {
            continue;
        };

        attempted += 1;
        emit_install_progress(
            app,
            &format!(
                "官方自更新未能完成，开始尝试全局包升级兜底：{} · {}。",
                plan.runtime_source, plan.package_manager
            ),
            "warn",
        );
        emit_install_progress(
            app,
            &format!("目标执行环境：{}", plan.runtime_bin_dir.display()),
            "info",
        );
        emit_install_progress(app, &format!("升级包：{}", plan.package_spec), "info");

        let result = run_shell_command_with_progress(app, &plan.command_line).await?;
        if result.success {
            emit_install_progress(
                app,
                &format!(
                    "已通过 {} 的 {} 全局安装方式完成兜底升级。",
                    plan.runtime_source, plan.package_manager
                ),
                "info",
            );
            return Ok(OpenClawDirectUpgradeResult {
                runtime_source: plan.runtime_source,
                runtime_bin_dir: plan.runtime_bin_dir,
                package_manager: plan.package_manager,
                package_spec: plan.package_spec,
            });
        }

        emit_install_progress(
            app,
            &format!(
                "全局包升级兜底失败：{} · {}。",
                plan.runtime_source, result.message
            ),
            "warn",
        );
        last_error = Some(result.message);
    }

    if attempted == 0 {
        return Err("未检测到可用于全局升级的 OpenClaw 安装来源。".to_string());
    }

    Err(last_error.unwrap_or_else(|| "已自动尝试全局升级兜底，但仍未成功。".to_string()))
}

async fn resolve_direct_openclaw_upgrade_plan(
    app: &AppHandle,
    candidate: &OpenClawRuntimeCandidate,
    runtime_bin_dir_hint: Option<&Path>,
    install_root_hint: Option<&Path>,
    package_manager_hint: Option<&str>,
) -> Result<Option<OpenClawDirectUpgradePlan>, String> {
    let runtime_bin_dir = PathBuf::from(&candidate.bin_dir);
    let runtime_matches_hint = runtime_bin_dir_hint
        .map(|hint| hint == runtime_bin_dir.as_path())
        .unwrap_or(false);
    let runtime_matches_install_root = install_root_hint
        .map(|root| runtime_candidate_matches_install_root(candidate, root))
        .unwrap_or(false);

    if runtime_bin_dir_hint.is_some()
        && !runtime_matches_hint
        && !runtime_matches_install_root
        && candidate.openclaw_path.is_none()
        && candidate.openclaw_package_path.is_none()
    {
        return Ok(None);
    }

    if candidate.openclaw_path.is_none() && candidate.openclaw_package_path.is_none() {
        return Ok(None);
    }

    let package_spec = resolve_openclaw_upgrade_package_spec(app, candidate).await?;
    let registry = package_registry_for_package_spec(&package_spec);
    let package_manager_hint = package_manager_hint
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let npm_path = candidate
        .npm_path
        .as_deref()
        .map(PathBuf::from)
        .or_else(|| find_command_in_bin_dir("npm", &runtime_bin_dir));
    let pnpm_path = find_command_in_bin_dir("pnpm", &runtime_bin_dir);
    let shell_platform = current_shell_platform();

    let (package_manager, command_line) = match package_manager_hint.as_deref() {
        Some("pnpm") => {
            if let Some(pnpm_path) = pnpm_path.as_ref().and_then(|path| path.to_str()) {
                (
                    "pnpm".to_string(),
                    build_openclaw_pnpm_install_command(
                        shell_platform,
                        pnpm_path,
                        &package_spec,
                        registry,
                    ),
                )
            } else if let Some(npm_path) = npm_path.as_ref().and_then(|path| path.to_str()) {
                (
                    "npm".to_string(),
                    build_openclaw_install_command(
                        shell_platform,
                        npm_path,
                        candidate.npm_global_prefix.as_deref(),
                        &package_spec,
                        registry,
                    ),
                )
            } else {
                return Ok(None);
            }
        }
        _ => {
            if let Some(npm_path) = npm_path.as_ref().and_then(|path| path.to_str()) {
                (
                    "npm".to_string(),
                    build_openclaw_install_command(
                        shell_platform,
                        npm_path,
                        candidate.npm_global_prefix.as_deref(),
                        &package_spec,
                        registry,
                    ),
                )
            } else if let Some(pnpm_path) = pnpm_path.as_ref().and_then(|path| path.to_str()) {
                (
                    "pnpm".to_string(),
                    build_openclaw_pnpm_install_command(
                        shell_platform,
                        pnpm_path,
                        &package_spec,
                        registry,
                    ),
                )
            } else {
                return Ok(None);
            }
        }
    };

    Ok(Some(OpenClawDirectUpgradePlan {
        runtime_source: candidate.source.clone(),
        runtime_bin_dir,
        package_manager,
        package_spec,
        command_line,
    }))
}

async fn resolve_openclaw_upgrade_package_spec(
    app: &AppHandle,
    candidate: &OpenClawRuntimeCandidate,
) -> Result<String, String> {
    if let Some(prefix) = candidate.npm_global_prefix.as_deref() {
        if let Some(package) = find_installed_openclaw_package_details(prefix) {
            return Ok(format!("{}@latest", package.name));
        }
    }

    if let Some(package_path) = candidate.openclaw_package_path.as_deref() {
        if let Some(package_name) = infer_openclaw_package_name_from_path(Path::new(package_path)) {
            return Ok(format!("{package_name}@latest"));
        }
    }

    Ok(if should_use_china_package(app).await {
        OPENCLAW_CN_PACKAGE.to_string()
    } else {
        OPENCLAW_DEFAULT_PACKAGE.to_string()
    })
}

fn infer_openclaw_package_name_from_path(path: &Path) -> Option<&'static str> {
    let normalized = path
        .display()
        .to_string()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if normalized.contains("@qingchencloud/openclaw-zh") {
        return Some("@qingchencloud/openclaw-zh");
    }
    if normalized.contains("/openclaw/package.json") {
        return Some("openclaw");
    }
    None
}

fn package_registry_for_package_spec(package_spec: &str) -> Option<&'static str> {
    package_spec
        .starts_with("@qingchencloud/openclaw-zh@")
        .then_some(NPM_MIRROR_CN)
}

fn runtime_candidate_matches_install_root(
    candidate: &OpenClawRuntimeCandidate,
    install_root_hint: &Path,
) -> bool {
    [
        Some(candidate.bin_dir.as_str()),
        Some(candidate.node_path.as_str()),
        candidate.npm_path.as_deref(),
        candidate.npm_global_prefix.as_deref(),
        candidate.openclaw_path.as_deref(),
        candidate.openclaw_package_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(PathBuf::from)
    .any(|path| path.starts_with(install_root_hint))
}

fn format_gateway_start_failure_message(detail: Option<&str>) -> String {
    let Some(detail) = detail.map(str::trim).filter(|value| !value.is_empty()) else {
        return "Gateway 启动超时，请检查配置或端口占用。".to_string();
    };

    let normalized = detail.to_ascii_lowercase();
    if normalized.contains("invalid config") || normalized.contains("config invalid") {
        if normalized.contains("contextwindow") && normalized.contains("received null") {
            return "Gateway 启动失败：当前 OpenClaw 配置包含空的 contextWindow 字段。Lime 已修正后续配置写入，请重新启动；如仍失败，请重新同步模型配置。"
                .to_string();
        }
        return "Gateway 启动失败：OpenClaw 配置文件无效，请重新同步模型配置后再试。".to_string();
    }

    if normalized.contains("missing config") || normalized.contains("gateway.mode=local") {
        return "Gateway 启动失败：OpenClaw 本地网关配置缺失，已自动补齐默认配置，请重试。"
            .to_string();
    }

    if normalized.contains("gateway.auth.mode") {
        return "Gateway 启动失败：缺少网关认证模式，已自动切换为 token 模式，请重试。".to_string();
    }

    if normalized.contains("address already in use") || normalized.contains("eaddrinuse") {
        return "Gateway 启动失败：目标端口已被占用，请更换端口或停止占用进程。".to_string();
    }

    if normalized.contains("resolved to non-loopback host") {
        return "Gateway 启动失败：当前环境无法绑定到本地回环地址 127.0.0.1，请检查本机网络或代理配置。".to_string();
    }

    if normalized.contains("allowedorigins") || normalized.contains("host-header origin fallback") {
        return "Gateway 启动失败：当前绑定方式需要配置 Control UI 允许来源，请检查 gateway.controlUi.allowedOrigins。".to_string();
    }

    if normalized.contains("doctor --fix") {
        return "Gateway 启动失败：OpenClaw 检测到本地环境或配置异常，请先在安装页执行“重新检测”或“修复环境”后再试。"
            .to_string();
    }

    format!("Gateway 启动失败：{detail}")
}

fn ensure_value_object(value: &mut Value) -> &mut Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value.as_object_mut().expect("value should be object")
}

fn build_channel_info(channel_id: &str, entry: &Value, label: Option<&Value>) -> ChannelInfo {
    ChannelInfo {
        id: channel_id.to_string(),
        name: entry
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| label.and_then(Value::as_str))
            .unwrap_or("未命名通道")
            .to_string(),
        channel_type: entry
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        status: entry
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
    }
}

fn extract_gateway_auth_token(config: &Value) -> Option<String> {
    config
        .get("gateway")
        .and_then(|gateway| {
            gateway
                .get("auth")
                .and_then(|auth| auth.get("token"))
                .or_else(|| gateway.get("remote").and_then(|remote| remote.get("token")))
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
}

fn determine_api_type(provider_type: ApiProviderType) -> Result<&'static str, String> {
    match provider_type {
        ApiProviderType::Anthropic | ApiProviderType::AnthropicCompatible => {
            Ok("anthropic-messages")
        }
        ApiProviderType::OpenaiResponse => Ok("openai-responses"),
        ApiProviderType::Openai
        | ApiProviderType::Codex
        | ApiProviderType::Gemini
        | ApiProviderType::Ollama
        | ApiProviderType::Fal
        | ApiProviderType::NewApi
        | ApiProviderType::Gateway => Ok("openai-completions"),
        ApiProviderType::AzureOpenai | ApiProviderType::Vertexai | ApiProviderType::AwsBedrock => {
            Err("当前暂不支持将该 Provider 同步到 OpenClaw。".to_string())
        }
    }
}

fn format_provider_base_url(provider: &ApiKeyProvider) -> Result<String, String> {
    let api_host = trim_trailing_slash(&provider.api_host);

    match provider.provider_type {
        ApiProviderType::Anthropic | ApiProviderType::AnthropicCompatible => Ok(api_host),
        ApiProviderType::Gemini => {
            if api_host.contains("generativelanguage.googleapis.com") {
                if api_host.ends_with("/v1beta/openai") {
                    Ok(api_host)
                } else {
                    Ok(format!("{api_host}/v1beta/openai"))
                }
            } else if has_api_version(&api_host) {
                Ok(api_host)
            } else {
                Ok(format!("{api_host}/v1"))
            }
        }
        ApiProviderType::Gateway => {
            if api_host.ends_with("/v1/ai") {
                Ok(api_host.trim_end_matches("/ai").to_string())
            } else if has_api_version(&api_host) {
                Ok(api_host)
            } else {
                Ok(format!("{api_host}/v1"))
            }
        }
        ApiProviderType::Openai
        | ApiProviderType::OpenaiResponse
        | ApiProviderType::Codex
        | ApiProviderType::Ollama
        | ApiProviderType::Fal
        | ApiProviderType::NewApi => {
            if has_api_version(&api_host) {
                Ok(api_host)
            } else {
                Ok(format!("{api_host}/v1"))
            }
        }
        ApiProviderType::AzureOpenai | ApiProviderType::Vertexai | ApiProviderType::AwsBedrock => {
            Err("当前暂不支持将该 Provider 同步到 OpenClaw。".to_string())
        }
    }
}

fn trim_trailing_slash(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn has_api_version(url: &str) -> bool {
    static VERSION_RE: OnceLock<Regex> = OnceLock::new();
    VERSION_RE
        .get_or_init(|| Regex::new(r"/v\d+(?:[./]|$)").expect("regex should compile"))
        .is_match(url)
}

fn generate_auth_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

async fn should_use_china_package(app: &AppHandle) -> bool {
    if let Some(app_state) = app.try_state::<AppState>() {
        let language = {
            let state = app_state.read().await;
            state.config.language.clone()
        };

        if language.starts_with("zh") {
            return true;
        }
    }

    let locale = std::env::var("LC_ALL")
        .ok()
        .or_else(|| std::env::var("LANG").ok())
        .unwrap_or_default()
        .to_lowercase();
    let timezone = std::env::var("TZ").unwrap_or_default().to_lowercase();
    locale.contains("zh_cn") || locale.contains("zh-hans") || timezone.contains("shanghai")
}

async fn detect_npm_global_prefix(npm_path: &str) -> Option<String> {
    let mut command = Command::new(npm_path);
    apply_binary_runtime_path(&mut command, npm_path);
    let output = command
        .arg("config")
        .arg("get")
        .arg("prefix")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prefix.is_empty() || prefix.eq_ignore_ascii_case("undefined") {
        None
    } else {
        Some(prefix)
    }
}

fn current_shell_platform() -> ShellPlatform {
    if cfg!(target_os = "windows") {
        ShellPlatform::Windows
    } else {
        ShellPlatform::Unix
    }
}

#[allow(dead_code)]
fn command_bin_dir_for(platform: ShellPlatform, binary_path: &str) -> Option<String> {
    core_command_bin_dir_for(platform, binary_path)
}

fn shell_command_escape_for(platform: ShellPlatform, value: &str) -> String {
    core_shell_command_escape_for(platform, value)
}

fn shell_command_invocation_prefix_for(platform: ShellPlatform, binary_path: &str) -> String {
    core_shell_command_invocation_prefix_for(platform, binary_path)
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn shell_command_escape(value: &str) -> String {
    shell_command_escape_for(current_shell_platform(), value)
}

#[allow(dead_code)]
fn shell_npm_prefix_assignment_for(platform: ShellPlatform, value: &str) -> String {
    core_shell_npm_prefix_assignment_for(platform, value)
}

fn shell_path_assignment_for(platform: ShellPlatform, binary_path: &str) -> String {
    core_shell_path_assignment_for(platform, binary_path)
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn shell_path_assignment(binary_path: &str) -> String {
    shell_path_assignment_for(current_shell_platform(), binary_path)
}

fn build_openclaw_cleanup_command(
    platform: ShellPlatform,
    npm_path: &str,
    npm_prefix: Option<&str>,
) -> String {
    core_build_openclaw_cleanup_command(platform, npm_path, npm_prefix)
}

fn build_openclaw_install_command(
    platform: ShellPlatform,
    npm_path: &str,
    npm_prefix: Option<&str>,
    package: &str,
    registry: Option<&str>,
) -> String {
    core_build_openclaw_install_command(platform, npm_path, npm_prefix, package, registry)
}

fn build_openclaw_pnpm_install_command(
    platform: ShellPlatform,
    pnpm_path: &str,
    package: &str,
    registry: Option<&str>,
) -> String {
    let mut command = format!(
        "{}{}{} add -g {}",
        shell_path_assignment_for(platform, pnpm_path),
        shell_command_invocation_prefix_for(platform, pnpm_path),
        shell_command_escape_for(platform, pnpm_path),
        shell_command_escape_for(platform, package),
    );

    if let Some(registry) = registry {
        command.push(' ');
        command.push_str("--registry=");
        command.push_str(&shell_command_escape_for(platform, registry));
    }

    command
}

#[allow(dead_code)]
fn resolve_windows_dependency_install_plan(
    dependency: DependencyKind,
    has_winget: bool,
) -> WindowsDependencyInstallPlan {
    core_resolve_windows_dependency_install_plan(
        match dependency {
            DependencyKind::Node => OpenClawInstallDependencyKind::Node,
            DependencyKind::Git => OpenClawInstallDependencyKind::Git,
        },
        has_winget,
    )
}

#[allow(dead_code)]
fn build_winget_install_command(winget_path: &str, package_id: &str) -> String {
    core_build_winget_install_command(winget_path, package_id)
}

#[allow(dead_code)]
fn windows_manual_install_message(dependency: DependencyKind) -> &'static str {
    core_windows_manual_install_message(match dependency {
        DependencyKind::Node => OpenClawInstallDependencyKind::Node,
        DependencyKind::Git => OpenClawInstallDependencyKind::Git,
    })
}

fn prepend_path(dir: &Path) -> Option<OsString> {
    let mut paths = vec![dir.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths).ok()
}

fn apply_binary_runtime_path(command: &mut Command, binary_path: &str) {
    apply_windows_no_window(command);

    let Some(bin_dir) = Path::new(binary_path).parent() else {
        return;
    };
    if let Some(path) = prepend_path(bin_dir) {
        command.env("PATH", path);
    }
}

fn apply_windows_no_window(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        _command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn preferred_runtime_bin_dir_store() -> &'static StdMutex<Option<PathBuf>> {
    OPENCLAW_PREFERRED_RUNTIME_BIN_DIR.get_or_init(|| StdMutex::new(None))
}

fn get_preferred_runtime_bin_dir() -> Option<PathBuf> {
    preferred_runtime_bin_dir_store()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

fn set_preferred_runtime_bin_dir(next: Option<PathBuf>) {
    let mut guard = preferred_runtime_bin_dir_store()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    *guard = next.filter(|path| !path.as_os_str().is_empty());
}

fn command_uses_node_runtime(command_name: &str) -> bool {
    matches!(command_name, "node" | "npm" | "npx" | "openclaw")
}

fn find_command_in_bin_dir(command_name: &str, bin_dir: &Path) -> Option<PathBuf> {
    select_preferred_path_candidate(find_all_commands_in_paths(
        command_name,
        &[bin_dir.to_path_buf()],
    ))
}

fn collect_existing_unique_dirs<I>(candidates: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = PathBuf>,
{
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();

    for dir in candidates {
        if dir.as_os_str().is_empty() || !dir.exists() {
            continue;
        }
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }

    dirs
}

async fn collect_preferred_runtime_command_dirs(
    command_name: &str,
    preferred_bin_dir: &Path,
) -> Result<Vec<PathBuf>, String> {
    let mut candidate_dirs = vec![preferred_bin_dir.to_path_buf()];

    if command_name == "openclaw" {
        if let Some(npm_path) = find_command_in_bin_dir("npm", preferred_bin_dir)
            .and_then(|path| path.to_str().map(str::to_string))
        {
            if let Some(prefix) = detect_npm_global_prefix(&npm_path).await {
                for dir in npm_global_command_dirs(&prefix) {
                    candidate_dirs.push(dir);
                }
            }
        }
    }

    Ok(collect_existing_unique_dirs(candidate_dirs))
}

async fn collect_preferred_runtime_command_candidates(
    command_name: &str,
) -> Result<Vec<PathBuf>, String> {
    if !command_uses_node_runtime(command_name) {
        return Ok(Vec::new());
    }

    let Some(preferred_bin_dir) = get_preferred_runtime_bin_dir() else {
        return Ok(Vec::new());
    };

    let search_dirs =
        collect_preferred_runtime_command_dirs(command_name, &preferred_bin_dir).await?;
    Ok(find_all_commands_in_paths(command_name, &search_dirs))
}

async fn find_command_in_shell(command_name: &str) -> Result<Option<String>, String> {
    let mut candidates = collect_standard_command_candidates(command_name).await?;

    if command_name == "openclaw" {
        candidates.extend(find_commands_via_npm_global_prefix(command_name).await?);
    }

    Ok(select_command_path(command_name, candidates)
        .await?
        .map(|path| path.to_string_lossy().to_string()))
}

async fn find_command_in_standard_locations(command_name: &str) -> Result<Option<String>, String> {
    Ok(select_command_path(
        command_name,
        collect_standard_command_candidates(command_name).await?,
    )
    .await?
    .map(|path| path.to_string_lossy().to_string()))
}

async fn collect_standard_command_candidates(command_name: &str) -> Result<Vec<PathBuf>, String> {
    collect_standard_command_candidates_with_preference(command_name, true).await
}

async fn collect_standard_command_candidates_without_preference(
    command_name: &str,
) -> Result<Vec<PathBuf>, String> {
    collect_standard_command_candidates_with_preference(command_name, false).await
}

async fn collect_standard_command_candidates_with_preference(
    command_name: &str,
    include_preferred_runtime: bool,
) -> Result<Vec<PathBuf>, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = refresh_windows_path_from_registry();
    }

    let mut candidates = Vec::new();

    if include_preferred_runtime {
        candidates.extend(collect_preferred_runtime_command_candidates(command_name).await?);
    }

    #[cfg(target_os = "windows")]
    {
        candidates.extend(find_commands_via_where(command_name).await?);
    }

    candidates.extend(find_all_commands_in_known_locations(command_name));

    Ok(candidates)
}

async fn select_command_path(
    command_name: &str,
    candidates: Vec<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    select_command_candidate(command_name, dedupe_paths(candidates)).await
}

#[cfg(target_os = "windows")]
async fn find_commands_via_where(command_name: &str) -> Result<Vec<PathBuf>, String> {
    let mut command = Command::new("cmd");
    apply_windows_no_window(&mut command);
    let output = command
        .arg("/C")
        .arg("where")
        .arg(command_name)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("查找命令失败: {e}"))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect())
}

async fn select_command_candidate(
    command_name: &str,
    candidates: Vec<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    if candidates.is_empty() {
        return Ok(None);
    }

    let has_preferred_runtime =
        command_uses_node_runtime(command_name) && get_preferred_runtime_bin_dir().is_some();
    if let Some(candidate) = select_preferred_runtime_candidate(command_name, &candidates).await? {
        return Ok(Some(candidate));
    }
    if has_preferred_runtime {
        return Ok(None);
    }

    if command_name == "node" {
        return select_best_node_candidate(candidates).await;
    }

    if matches!(command_name, "npm" | "npx" | "openclaw") {
        return select_node_runtime_candidate(candidates).await;
    }

    if command_name == "git" {
        return Ok(select_best_git_candidate(candidates));
    }

    Ok(candidates.into_iter().next())
}

fn select_best_git_candidate(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    select_preferred_path_candidate(candidates.clone()).or_else(|| candidates.into_iter().next())
}

async fn select_preferred_runtime_candidate(
    command_name: &str,
    candidates: &[PathBuf],
) -> Result<Option<PathBuf>, String> {
    if !command_uses_node_runtime(command_name) {
        return Ok(None);
    }

    let Some(preferred_bin_dir) = get_preferred_runtime_bin_dir() else {
        return Ok(None);
    };

    let preferred_dirs =
        collect_preferred_runtime_command_dirs(command_name, &preferred_bin_dir).await?;
    if preferred_dirs.is_empty() {
        return Ok(None);
    }

    Ok(select_preferred_path_candidate(
        candidates
            .iter()
            .filter(|candidate| {
                candidate
                    .parent()
                    .is_some_and(|parent| preferred_dirs.iter().any(|dir| dir.as_path() == parent))
            })
            .cloned()
            .collect(),
    ))
}

fn find_all_commands_in_known_locations(command_name: &str) -> Vec<PathBuf> {
    let search_dirs = collect_known_command_search_dirs(command_name);
    find_all_commands_in_paths(command_name, &search_dirs)
}

fn collect_known_command_search_dirs(_command_name: &str) -> Vec<PathBuf> {
    let mut search_dirs = Vec::new();

    if let Some(path_var) = std::env::var_os("PATH") {
        search_dirs.extend(std::env::split_paths(&path_var));
    }

    if let Some(home) = home_dir() {
        search_dirs.extend([
            home.join(".npm-global/bin"),
            home.join(".local/bin"),
            home.join(".bun/bin"),
            home.join(".volta/bin"),
            home.join(".asdf/shims"),
            home.join(".local/share/mise/shims"),
            home.join("Library/PhpWebStudy/env/node/bin"),
        ]);

        let nvm_versions = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(nvm_versions) {
            for entry in entries.flatten() {
                search_dirs.push(entry.path().join("bin"));
            }
        }

        let fnm_versions = home.join(".fnm/node-versions");
        if let Ok(entries) = std::fs::read_dir(fnm_versions) {
            for entry in entries.flatten() {
                search_dirs.push(entry.path().join("installation/bin"));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        search_dirs.extend(windows_known_command_dirs_from_env());
        if _command_name == "git" {
            search_dirs.extend(windows_known_git_command_dirs_from_env());
        }
    }

    if cfg!(target_os = "macos") {
        search_dirs.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]);
    }

    collect_existing_unique_dirs(search_dirs)
}

#[cfg(target_os = "windows")]
fn windows_known_command_dirs_from_env() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }

    if let Some(localappdata) = std::env::var_os("LOCALAPPDATA") {
        let localappdata = PathBuf::from(localappdata);
        dirs.push(localappdata.join("Programs").join("nodejs"));
        dirs.push(localappdata.join("Volta").join("bin"));
    }

    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        dirs.push(PathBuf::from(program_files).join("nodejs"));
    }

    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        dirs.push(PathBuf::from(program_files_x86).join("nodejs"));
    }

    if let Some(home) = home_dir() {
        dirs.push(home.join("AppData").join("Roaming").join("npm"));
        dirs.push(
            home.join("AppData")
                .join("Local")
                .join("Programs")
                .join("nodejs"),
        );
    }

    dirs
}

#[cfg(any(target_os = "windows", test))]
fn windows_git_install_dir_variants(root: PathBuf) -> Vec<PathBuf> {
    vec![
        root.join("cmd"),
        root.join("bin"),
        root.join("mingw64").join("bin"),
    ]
}

#[cfg(target_os = "windows")]
fn windows_known_git_command_dirs_from_env() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        dirs.extend(windows_git_install_dir_variants(
            PathBuf::from(program_files).join("Git"),
        ));
    }

    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        dirs.extend(windows_git_install_dir_variants(
            PathBuf::from(program_files_x86).join("Git"),
        ));
    }

    if let Some(localappdata) = std::env::var_os("LOCALAPPDATA") {
        dirs.extend(windows_git_install_dir_variants(
            PathBuf::from(localappdata).join("Programs").join("Git"),
        ));
    }

    if let Some(home) = home_dir() {
        dirs.extend(windows_git_install_dir_variants(
            home.join("scoop").join("apps").join("git").join("current"),
        ));
    }

    dirs
}

fn find_all_commands_in_paths(command_name: &str, search_dirs: &[PathBuf]) -> Vec<PathBuf> {
    find_all_commands_in_paths_for(current_shell_platform(), command_name, search_dirs)
}

fn find_all_commands_in_paths_for(
    platform: ShellPlatform,
    command_name: &str,
    search_dirs: &[PathBuf],
) -> Vec<PathBuf> {
    let candidates = match platform {
        ShellPlatform::Windows => vec![
            format!("{command_name}.exe"),
            format!("{command_name}.cmd"),
            format!("{command_name}.bat"),
            command_name.to_string(),
        ],
        ShellPlatform::Unix => vec![command_name.to_string()],
    };

    let mut matches = Vec::new();
    let mut seen = HashSet::new();
    for dir in search_dirs {
        for candidate in &candidates {
            let path = dir.join(candidate);
            if path.is_file() && seen.insert(path.clone()) {
                matches.push(path);
            }
        }
    }

    matches
}

async fn find_commands_via_npm_global_prefix(command_name: &str) -> Result<Vec<PathBuf>, String> {
    let Some(npm_path) = find_command_in_standard_locations("npm").await? else {
        return Ok(Vec::new());
    };
    let Some(prefix) = detect_npm_global_prefix(&npm_path).await else {
        return Ok(Vec::new());
    };

    Ok(find_all_commands_in_paths(
        command_name,
        &npm_global_command_dirs(&prefix),
    ))
}

fn npm_global_command_dirs(prefix: &str) -> Vec<PathBuf> {
    npm_global_command_dirs_for(current_shell_platform(), prefix)
}

fn npm_global_command_dirs_for(platform: ShellPlatform, prefix: &str) -> Vec<PathBuf> {
    let prefix_path = PathBuf::from(prefix);

    match platform {
        ShellPlatform::Windows => vec![prefix_path],
        ShellPlatform::Unix => vec![prefix_path.join("bin"), prefix_path],
    }
}

fn npm_global_node_modules_dirs_for(platform: ShellPlatform, prefix: &str) -> Vec<PathBuf> {
    let prefix_path = PathBuf::from(prefix);

    match platform {
        ShellPlatform::Windows => vec![prefix_path.join("node_modules")],
        ShellPlatform::Unix => vec![
            prefix_path.join("lib").join("node_modules"),
            prefix_path.join("node_modules"),
        ],
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InstalledOpenClawPackage {
    name: &'static str,
    version: Option<String>,
    path: PathBuf,
}

#[cfg(test)]
fn find_installed_openclaw_package(prefix: &str) -> Option<(&'static str, Option<String>)> {
    find_installed_openclaw_package_details(prefix).map(|package| (package.name, package.version))
}

fn find_installed_openclaw_package_details(prefix: &str) -> Option<InstalledOpenClawPackage> {
    for node_modules_dir in npm_global_node_modules_dirs_for(current_shell_platform(), prefix) {
        let openclaw_manifest = node_modules_dir.join("openclaw").join("package.json");
        if openclaw_manifest.is_file() {
            return Some(InstalledOpenClawPackage {
                name: "openclaw",
                version: read_package_version(&openclaw_manifest),
                path: openclaw_manifest,
            });
        }

        let zh_manifest = node_modules_dir
            .join("@qingchencloud")
            .join("openclaw-zh")
            .join("package.json");
        if zh_manifest.is_file() {
            return Some(InstalledOpenClawPackage {
                name: "@qingchencloud/openclaw-zh",
                version: read_package_version(&zh_manifest),
                path: zh_manifest,
            });
        }
    }

    None
}

fn read_package_version(manifest_path: &Path) -> Option<String> {
    #[derive(Deserialize)]
    struct PackageManifest {
        version: Option<String>,
    }

    let content = std::fs::read_to_string(manifest_path).ok()?;
    let manifest = serde_json::from_str::<PackageManifest>(&content).ok()?;
    manifest.version.filter(|item| !item.trim().is_empty())
}

fn resolve_openclaw_cli_entry_from_package_manifest(manifest_path: &Path) -> Option<PathBuf> {
    let package_root = manifest_path.parent()?;
    let content = std::fs::read_to_string(manifest_path).ok()?;
    let manifest = serde_json::from_str::<Value>(&content).ok()?;

    let mut candidates = Vec::new();

    if let Some(bin_value) = manifest.get("bin") {
        let bin_entry = match bin_value {
            Value::String(value) => Some(value.as_str()),
            Value::Object(entries) => entries
                .get("openclaw")
                .and_then(Value::as_str)
                .or_else(|| entries.values().find_map(Value::as_str)),
            _ => None,
        };

        if let Some(entry) = bin_entry {
            candidates.push(package_root.join(entry));
        }
    }

    candidates.push(package_root.join("dist").join("index.js"));
    candidates.push(package_root.join("dist").join("index.mjs"));
    candidates.push(package_root.join("dist").join("entry.js"));
    candidates.push(package_root.join("dist").join("entry.mjs"));

    candidates.into_iter().find(|path| path.is_file())
}

fn prefers_node_cli_for_openclaw_path(platform: ShellPlatform, openclaw_path: &Path) -> bool {
    matches!(platform, ShellPlatform::Windows)
        && openclaw_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "cmd" | "bat"))
            .unwrap_or(false)
}

fn resolve_openclaw_command_from_runtime_candidate_for(
    platform: ShellPlatform,
    candidate: &OpenClawRuntimeCandidate,
) -> Option<ResolvedOpenClawCommand> {
    let openclaw_path = candidate
        .openclaw_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_file());

    if let Some(openclaw_path) = openclaw_path.as_ref() {
        if !prefers_node_cli_for_openclaw_path(platform, openclaw_path) {
            return Some(ResolvedOpenClawCommand::Binary {
                binary_path: openclaw_path.clone(),
            });
        }
    }

    let node_path = PathBuf::from(candidate.node_path.as_str());
    let manifest_path = candidate
        .openclaw_package_path
        .as_deref()
        .map(PathBuf::from);

    if node_path.is_file() {
        if let Some(manifest_path) = manifest_path {
            if let Some(cli_path) = resolve_openclaw_cli_entry_from_package_manifest(&manifest_path)
            {
                return Some(ResolvedOpenClawCommand::NodeCli {
                    node_path,
                    cli_path,
                    package_version: read_package_version(&manifest_path),
                });
            }
        }
    }

    openclaw_path.map(|binary_path| ResolvedOpenClawCommand::Binary { binary_path })
}

fn resolve_openclaw_command_from_runtime_candidate(
    candidate: &OpenClawRuntimeCandidate,
) -> Option<ResolvedOpenClawCommand> {
    resolve_openclaw_command_from_runtime_candidate_for(current_shell_platform(), candidate)
}

fn runtime_candidate_matches_openclaw_path(
    candidate: &OpenClawRuntimeCandidate,
    openclaw_path: &Path,
) -> bool {
    candidate
        .openclaw_path
        .as_deref()
        .map(Path::new)
        .is_some_and(|candidate_path| candidate_path == openclaw_path)
        || openclaw_path
            .parent()
            .is_some_and(|parent| Path::new(&candidate.bin_dir) == parent)
        || candidate
            .npm_global_prefix
            .as_deref()
            .map(Path::new)
            .is_some_and(|prefix| openclaw_path.starts_with(prefix))
}

fn dedupe_openclaw_commands(
    commands: Vec<ResolvedOpenClawCommand>,
) -> Vec<ResolvedOpenClawCommand> {
    let mut deduped = Vec::with_capacity(commands.len());
    let mut seen = HashSet::new();
    for command in commands {
        if seen.insert(command.dedupe_key()) {
            deduped.push(command);
        }
    }
    deduped
}

fn dedupe_paths(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::with_capacity(candidates.len());
    let mut seen = HashSet::new();
    for candidate in candidates {
        if seen.insert(candidate.clone()) {
            deduped.push(candidate);
        }
    }
    deduped
}

async fn resolve_openclaw_command() -> Result<Option<ResolvedOpenClawCommand>, String> {
    let shell_platform = current_shell_platform();
    let shell_binary = find_command_in_shell("openclaw").await?.map(PathBuf::from);
    let mut runtime_candidates = list_openclaw_runtime_candidates().await?;
    runtime_candidates.sort_by(compare_openclaw_runtime_candidates);

    if let Some(shell_binary) = shell_binary.as_ref() {
        if !prefers_node_cli_for_openclaw_path(shell_platform, shell_binary) {
            return Ok(Some(ResolvedOpenClawCommand::Binary {
                binary_path: shell_binary.clone(),
            }));
        }

        if let Some(command) = runtime_candidates
            .iter()
            .filter(|candidate| runtime_candidate_matches_openclaw_path(candidate, shell_binary))
            .find_map(|candidate| {
                resolve_openclaw_command_from_runtime_candidate_for(shell_platform, candidate)
            })
        {
            return Ok(Some(command));
        }
    }

    if let Some(command) = runtime_candidates.iter().find_map(|candidate| {
        resolve_openclaw_command_from_runtime_candidate_for(shell_platform, candidate)
    }) {
        return Ok(Some(command));
    }

    Ok(shell_binary.map(|binary_path| ResolvedOpenClawCommand::Binary { binary_path }))
}

async fn read_openclaw_version_from_command(
    command_spec: &ResolvedOpenClawCommand,
) -> Result<Option<String>, String> {
    if let Some(version) = command_spec.fallback_version() {
        return Ok(Some(version));
    }

    let output = command_spec
        .build_command_with_args(["--version"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("读取 OpenClaw 版本失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Ok(None)
    } else {
        Ok(Some(stdout))
    }
}

async fn list_openclaw_runtime_candidates() -> Result<Vec<OpenClawRuntimeCandidate>, String> {
    let node_candidates =
        dedupe_paths(collect_standard_command_candidates_without_preference("node").await?);
    let preferred_bin_dir = get_preferred_runtime_bin_dir().filter(|dir| dir.is_dir());
    let auto_selected_node = select_best_node_candidate(node_candidates.clone()).await?;
    let active_bin_dir = preferred_bin_dir.clone().or_else(|| {
        auto_selected_node
            .as_ref()
            .and_then(|path| path.parent().map(Path::to_path_buf))
    });

    let mut runtimes = Vec::new();
    let mut seen_bin_dirs = HashSet::new();
    for node_path in node_candidates {
        let Some(bin_dir) = node_path.parent().map(Path::to_path_buf) else {
            continue;
        };
        if !seen_bin_dirs.insert(bin_dir.clone()) {
            continue;
        }

        runtimes.push(
            inspect_openclaw_runtime_candidate(
                &bin_dir,
                preferred_bin_dir.as_deref(),
                active_bin_dir.as_deref(),
            )
            .await,
        );
    }

    runtimes.sort_by(compare_openclaw_runtime_candidates);
    Ok(runtimes)
}

async fn inspect_openclaw_runtime_candidate(
    bin_dir: &Path,
    preferred_bin_dir: Option<&Path>,
    active_bin_dir: Option<&Path>,
) -> OpenClawRuntimeCandidate {
    let node_path = find_command_in_bin_dir("node", bin_dir).unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        let node_name = "node.exe";
        #[cfg(not(target_os = "windows"))]
        let node_name = "node";

        bin_dir.join(node_name)
    });

    let npm_path = find_command_in_bin_dir("npm", bin_dir);
    let npm_path_string = npm_path.as_ref().map(|path| path.display().to_string());
    let npm_global_prefix = match npm_path_string.as_deref() {
        Some(path) => detect_npm_global_prefix(path).await,
        None => None,
    };
    let openclaw_path = resolve_runtime_openclaw_path(bin_dir, npm_global_prefix.as_deref());
    let openclaw_package_path = npm_global_prefix
        .as_deref()
        .and_then(find_installed_openclaw_package_details)
        .map(|package| package.path.display().to_string());

    OpenClawRuntimeCandidate {
        id: bin_dir.display().to_string(),
        source: infer_openclaw_runtime_source(bin_dir),
        bin_dir: bin_dir.display().to_string(),
        node_path: node_path.display().to_string(),
        node_version: read_display_version_text(&node_path).await,
        npm_path: npm_path_string,
        npm_global_prefix,
        openclaw_path: openclaw_path
            .as_ref()
            .map(|path| path.display().to_string()),
        openclaw_version: match openclaw_path.as_deref() {
            Some(path) => read_display_version_text(path).await,
            None => None,
        },
        openclaw_package_path,
        is_active: active_bin_dir.is_some_and(|path| path == bin_dir),
        is_preferred: preferred_bin_dir.is_some_and(|path| path == bin_dir),
    }
}

fn resolve_runtime_openclaw_path(
    bin_dir: &Path,
    npm_global_prefix: Option<&str>,
) -> Option<PathBuf> {
    find_command_in_bin_dir("openclaw", bin_dir).or_else(|| {
        npm_global_prefix.and_then(|prefix| {
            select_preferred_path_candidate(find_all_commands_in_paths(
                "openclaw",
                &npm_global_command_dirs(prefix),
            ))
        })
    })
}

async fn read_display_version_text(binary_path: &Path) -> Option<String> {
    let path = binary_path.to_str()?;
    let version_text = read_command_version_text(path, &["--version"]).await.ok()?;
    let version_text = version_text.trim();
    if version_text.is_empty() {
        return None;
    }

    Some(
        parse_semver_from_text(version_text)
            .map(format_semver)
            .unwrap_or_else(|| version_text.to_string()),
    )
}

fn infer_openclaw_runtime_source(bin_dir: &Path) -> String {
    let normalized = bin_dir
        .display()
        .to_string()
        .replace('\\', "/")
        .to_lowercase();

    if normalized.contains("/.nvm/") {
        return "nvm".to_string();
    }
    if normalized.contains("/phpwebstudy/") {
        return "PhpWebStudy".to_string();
    }
    if normalized.contains("/.volta/") {
        return "Volta".to_string();
    }
    if normalized.contains("/.fnm/") {
        return "fnm".to_string();
    }
    if normalized.contains("/.asdf/") {
        return "asdf".to_string();
    }
    if normalized.contains("/mise/") {
        return "mise".to_string();
    }
    if normalized.contains("/opt/homebrew/") {
        return "Homebrew".to_string();
    }
    if normalized.ends_with("/usr/local/bin")
        || normalized.ends_with("/usr/bin")
        || normalized.ends_with("/bin")
        || normalized.contains("/program files/nodejs")
        || normalized.contains("/program files (x86)/nodejs")
    {
        return "系统".to_string();
    }

    "PATH".to_string()
}

fn compare_openclaw_runtime_candidates(
    left: &OpenClawRuntimeCandidate,
    right: &OpenClawRuntimeCandidate,
) -> Ordering {
    right
        .is_active
        .cmp(&left.is_active)
        .then_with(|| right.is_preferred.cmp(&left.is_preferred))
        .then_with(|| {
            right
                .openclaw_path
                .is_some()
                .cmp(&left.openclaw_path.is_some())
        })
        .then_with(|| {
            compare_optional_semver_desc(
                left.node_version.as_deref(),
                right.node_version.as_deref(),
            )
        })
        .then_with(|| left.bin_dir.cmp(&right.bin_dir))
}

fn compare_optional_semver_desc(left: Option<&str>, right: Option<&str>) -> Ordering {
    match (
        left.and_then(parse_semver_from_text),
        right.and_then(parse_semver_from_text),
    ) {
        (Some(left), Some(right)) => right.cmp(&left),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

async fn collect_environment_diagnostics() -> EnvironmentDiagnostics {
    let npm_path = find_command_in_standard_locations("npm")
        .await
        .ok()
        .flatten();
    let npm_global_prefix = match npm_path.as_deref() {
        Some(path) => detect_npm_global_prefix(path).await,
        None => None,
    };

    #[cfg(target_os = "windows")]
    let where_candidates = find_commands_via_where("openclaw")
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.display().to_string())
        .collect();

    #[cfg(not(target_os = "windows"))]
    let where_candidates = Vec::new();

    let supplemental_search_dirs =
        collect_supplemental_openclaw_search_dirs(npm_global_prefix.as_deref());
    let supplemental_command_candidates =
        find_all_commands_in_paths("openclaw", &supplemental_search_dirs)
            .into_iter()
            .map(|path| path.display().to_string())
            .collect();
    let openclaw_package_path = npm_global_prefix
        .as_deref()
        .and_then(find_installed_openclaw_package_details)
        .map(|package| package.path.display().to_string());

    #[cfg(target_os = "windows")]
    let git_where_candidates = find_commands_via_where("git")
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.display().to_string())
        .collect();

    #[cfg(not(target_os = "windows"))]
    let git_where_candidates = Vec::new();

    let git_supplemental_search_dirs = collect_supplemental_git_search_dirs();
    let git_supplemental_command_candidates =
        find_all_commands_in_paths("git", &git_supplemental_search_dirs)
            .into_iter()
            .map(|path| path.display().to_string())
            .collect();

    EnvironmentDiagnostics {
        npm_path,
        npm_global_prefix,
        openclaw_package_path,
        where_candidates,
        supplemental_search_dirs: supplemental_search_dirs
            .into_iter()
            .map(|path| path.display().to_string())
            .collect(),
        supplemental_command_candidates,
        git_where_candidates,
        git_supplemental_search_dirs: git_supplemental_search_dirs
            .into_iter()
            .map(|path| path.display().to_string())
            .collect(),
        git_supplemental_command_candidates,
    }
}

fn collect_supplemental_openclaw_search_dirs(npm_global_prefix: Option<&str>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        dirs.extend(windows_known_command_dirs_from_env());
    }

    if let Some(prefix) = npm_global_prefix {
        dirs.extend(npm_global_command_dirs(prefix));
    }

    collect_existing_unique_dirs(dirs)
}

fn collect_supplemental_git_search_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return collect_existing_unique_dirs(windows_known_git_command_dirs_from_env());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

async fn select_best_node_candidate(candidates: Vec<PathBuf>) -> Result<Option<PathBuf>, String> {
    let mut versioned = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let openclaw_signal = match candidate.parent() {
            Some(bin_dir) => inspect_node_runtime_openclaw_signal(bin_dir).await,
            None => 0,
        };
        let version = read_binary_semver(&candidate).await;
        versioned.push((candidate, openclaw_signal, version));
    }
    Ok(select_best_node_runtime_candidate(versioned))
}

async fn select_node_runtime_candidate(
    candidates: Vec<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let mut runtime_ranked = Vec::with_capacity(candidates.len());
    for candidate in &candidates {
        let openclaw_signal = match candidate.parent() {
            Some(bin_dir) => inspect_node_runtime_openclaw_signal(bin_dir).await,
            None => 0,
        };
        let version = match sibling_node_path(candidate) {
            Some(node_path) => read_binary_semver(&node_path).await,
            None => None,
        };
        runtime_ranked.push((candidate.clone(), openclaw_signal, version));
    }

    if let Some(candidate) = select_best_node_runtime_candidate(runtime_ranked.clone()) {
        let candidate_signal = runtime_ranked
            .iter()
            .find(|(path, _, _)| path == &candidate)
            .map(|(_, signal, _)| *signal)
            .unwrap_or(0);
        if candidate_signal > 0 {
            return Ok(Some(candidate));
        }
    }

    let preferred_node =
        select_best_node_candidate(find_all_commands_in_known_locations("node")).await?;
    if let Some(preferred_bin_dir) = preferred_node.as_deref().and_then(Path::parent) {
        if let Some(candidate) = select_preferred_path_candidate(
            candidates
                .iter()
                .filter(|candidate| candidate.parent() == Some(preferred_bin_dir))
                .cloned()
                .collect(),
        ) {
            return Ok(Some(candidate));
        }
    }

    Ok(
        select_best_node_runtime_candidate(runtime_ranked)
            .or_else(|| candidates.into_iter().next()),
    )
}

async fn inspect_node_runtime_openclaw_signal(bin_dir: &Path) -> u8 {
    if find_command_in_bin_dir("openclaw", bin_dir).is_some() {
        return 3;
    }

    let Some(npm_path) =
        find_command_in_bin_dir("npm", bin_dir).and_then(|path| path.to_str().map(str::to_string))
    else {
        return 0;
    };

    let Some(prefix) = detect_npm_global_prefix(&npm_path).await else {
        return 0;
    };

    if select_preferred_path_candidate(find_all_commands_in_paths(
        "openclaw",
        &npm_global_command_dirs(&prefix),
    ))
    .is_some()
    {
        return 3;
    }

    if find_installed_openclaw_package_details(&prefix).is_some() {
        return 2;
    }

    0
}

fn select_best_node_runtime_candidate(
    candidates: Vec<(PathBuf, u8, Option<(u64, u64, u64)>)>,
) -> Option<PathBuf> {
    candidates
        .into_iter()
        .max_by(
            |(left_path, left_signal, left_version), (right_path, right_signal, right_version)| {
                left_signal
                    .cmp(right_signal)
                    .then_with(|| left_version.cmp(right_version))
                    .then_with(|| {
                        let preferred = select_preferred_path_candidate(vec![
                            left_path.clone(),
                            right_path.clone(),
                        ]);
                        match preferred.as_ref() {
                            Some(path) if path == left_path => std::cmp::Ordering::Greater,
                            Some(path) if path == right_path => std::cmp::Ordering::Less,
                            _ => std::cmp::Ordering::Equal,
                        }
                    })
            },
        )
        .map(|(path, _, _)| path)
}

fn sibling_node_path(command_path: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let node_name = "node.exe";

    #[cfg(not(target_os = "windows"))]
    let node_name = "node";

    let node_path = command_path.parent()?.join(node_name);
    node_path.is_file().then_some(node_path)
}

async fn read_binary_semver(path: &Path) -> Option<(u64, u64, u64)> {
    let mut command = Command::new(path);
    apply_windows_no_window(&mut command);
    let output = command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_semver(stdout.trim()).or_else(|| parse_semver(stderr.trim()))
}

#[cfg_attr(not(test), allow(dead_code))]
fn select_best_semver_candidate(
    candidates: Vec<(PathBuf, Option<(u64, u64, u64)>)>,
) -> Option<PathBuf> {
    core_select_best_semver_candidate(candidates, NODE_MIN_VERSION)
}

fn select_preferred_path_candidate(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    core_select_preferred_path_candidate(candidates)
}

async fn run_shell_command_with_progress(
    app: &AppHandle,
    command_line: &str,
) -> Result<ActionResult, String> {
    let mut child = spawn_shell_command(command_line)?;

    let stdout_task = child.stdout.take().map(|stdout| {
        let app = app.clone();
        tokio::spawn(async move {
            stream_reader_to_progress(app, stdout, "info").await;
        })
    });

    let stderr_task = child.stderr.take().map(|stderr| {
        let app = app.clone();
        tokio::spawn(async move {
            stream_reader_to_progress(app, stderr, "error").await;
        })
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("执行命令失败: {e}"))?;

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    if status.success() {
        emit_install_progress(app, "命令执行成功。", "info");
        Ok(ActionResult {
            success: true,
            message: "操作成功完成。".to_string(),
        })
    } else {
        emit_install_progress(
            app,
            &format!("命令执行失败，退出码: {:?}", status.code()),
            "error",
        );
        Ok(ActionResult {
            success: false,
            message: format!("命令执行失败，退出码: {:?}", status.code()),
        })
    }
}

fn spawn_shell_command(command_line: &str) -> Result<Child, String> {
    let mut command = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(command_line);
        cmd
    } else if cfg!(target_os = "macos") {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = Command::new("script");
        cmd.arg("-q")
            .arg("/dev/null")
            .arg(shell)
            .arg("-lc")
            .arg(command_line);
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut cmd = Command::new(shell);
        cmd.arg("-lc").arg(command_line);
        cmd
    };

    apply_windows_no_window(&mut command);

    command
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .env("FORCE_COLOR", "0")
        .env("npm_config_color", "false")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.spawn().map_err(|e| format!("启动命令失败: {e}"))
}

async fn stream_reader_to_progress<R>(app: AppHandle, mut reader: R, default_level: &'static str)
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0_u8; 2048];
    let mut pending = String::new();

    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(size) => {
                pending.push_str(&String::from_utf8_lossy(&buffer[..size]));
                flush_progress_chunks(&app, &mut pending, default_level);
            }
            Err(error) => {
                emit_install_progress(&app, &format!("读取命令输出失败: {error}"), "warn");
                break;
            }
        }
    }

    let tail = pending.trim();
    if !tail.is_empty() {
        emit_install_progress(&app, tail, classify_progress_level(tail, default_level));
    }
}

fn flush_progress_chunks(app: &AppHandle, pending: &mut String, default_level: &'static str) {
    loop {
        let next_break = pending.find(['\n', '\r']);
        let Some(index) = next_break else {
            break;
        };

        let mut line = pending[..index].trim().to_string();
        let mut consume_len = index + 1;
        while pending
            .get(consume_len..consume_len + 1)
            .is_some_and(|ch| ch == "\n" || ch == "\r")
        {
            consume_len += 1;
        }

        pending.drain(..consume_len);

        if line.is_empty() {
            continue;
        }

        line = sanitize_progress_line(&line);
        if line.is_empty() {
            continue;
        }

        emit_install_progress(app, &line, classify_progress_level(&line, default_level));
    }

    if pending.len() > 4096 {
        let line = sanitize_progress_line(pending.trim());
        if !line.is_empty() {
            emit_install_progress(app, &line, classify_progress_level(&line, default_level));
        }
        pending.clear();
    }
}

fn sanitize_progress_line(value: &str) -> String {
    value
        .replace('\u{1b}', "")
        .replace("[?25h", "")
        .replace("[?25l", "")
        .trim()
        .to_string()
}

fn classify_progress_level(message: &str, default_level: &'static str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("error") || lower.contains("fatal") {
        "error"
    } else if lower.contains("warn") || lower.contains("warning") {
        "warn"
    } else {
        default_level
    }
}

fn emit_install_progress(app: &AppHandle, message: &str, level: &str) {
    if let Some(service_state) = app.try_state::<OpenClawServiceState>() {
        if let Ok(mut service) = service_state.0.try_lock() {
            service.push_progress_log(message.to_string(), level.to_string());
        }
    }

    let payload = InstallProgressEvent {
        message: message.to_string(),
        level: level.to_string(),
    };
    let _ = app.emit(OPENCLAW_INSTALL_EVENT, payload);
}

fn parse_semver(value: &str) -> Option<(u64, u64, u64)> {
    let sanitized = value.trim().trim_start_matches('v');
    let core = sanitized.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn parse_semver_from_text(value: &str) -> Option<(u64, u64, u64)> {
    parse_semver(value).or_else(|| {
        value
            .split(|ch: char| ch.is_whitespace() || ch == ',' || ch == '(' || ch == ')')
            .find_map(parse_semver)
    })
}

fn format_semver(version: (u64, u64, u64)) -> String {
    format!("{}.{}.{}", version.0, version.1, version.2)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_gateway_runtime_defaults, build_environment_status, build_openclaw_cleanup_command,
        build_openclaw_install_command, build_openclaw_pnpm_install_command,
        build_winget_install_command, command_bin_dir_for, determine_api_type,
        extract_gateway_auth_token, find_installed_openclaw_package,
        format_gateway_start_failure_message, format_openclaw_update_failure_message,
        format_provider_base_url, gateway_start_args, has_api_version,
        infer_openclaw_package_name_from_path, npm_global_command_dirs_for,
        npm_global_node_modules_dirs_for, package_registry_for_package_spec,
        parse_semver_from_text, resolve_openclaw_cli_entry_from_package_manifest,
        resolve_openclaw_command_from_runtime_candidate,
        resolve_openclaw_command_from_runtime_candidate_for,
        resolve_windows_dependency_install_plan, runtime_candidate_matches_install_root,
        sanitize_runtime_config, select_best_git_candidate, select_best_semver_candidate,
        select_gateway_start_failure_detail, select_openclaw_update_failure_detail,
        select_preferred_path_candidate, shell_command_escape_for,
        shell_command_invocation_prefix_for, shell_npm_prefix_assignment_for,
        shell_path_assignment_for, trim_trailing_slash, windows_dependency_action_result,
        windows_dependency_setup_message, windows_git_install_dir_variants,
        windows_install_block_result, windows_manual_install_message, DependencyKind,
        DependencyStatus, EnvironmentDiagnostics, OpenClawRuntimeCandidate,
        ResolvedOpenClawCommand, ShellPlatform, WindowsDependencyInstallPlan, NPM_MIRROR_CN,
        OPENCLAW_CN_PACKAGE, OPENCLAW_DEFAULT_PACKAGE,
    };
    use crate::database::dao::api_key_provider::{ApiKeyProvider, ApiProviderType, ProviderGroup};
    use chrono::Utc;
    use serde_json::{json, Value};
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn build_provider(provider_type: ApiProviderType, api_host: &str) -> ApiKeyProvider {
        ApiKeyProvider {
            id: "provider-1".to_string(),
            name: "Provider 1".to_string(),
            provider_type,
            api_host: api_host.to_string(),
            is_system: false,
            group: ProviderGroup::Custom,
            enabled: true,
            sort_order: 0,
            api_version: None,
            project: None,
            location: None,
            region: None,
            custom_models: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn build_unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "lime-openclaw-{prefix}-{}-{nanos}",
            std::process::id()
        ))
    }

    #[test]
    fn trims_trailing_slash() {
        assert_eq!(
            trim_trailing_slash("https://api.openai.com/"),
            "https://api.openai.com"
        );
    }

    #[test]
    fn detects_version_segment() {
        assert!(has_api_version("https://api.openai.com/v1"));
        assert!(!has_api_version("https://api.openai.com"));
    }

    #[test]
    fn maps_api_type_correctly() {
        assert_eq!(
            determine_api_type(ApiProviderType::Openai).unwrap(),
            "openai-completions"
        );
        assert_eq!(
            determine_api_type(ApiProviderType::OpenaiResponse).unwrap(),
            "openai-responses"
        );
        assert_eq!(
            determine_api_type(ApiProviderType::Anthropic).unwrap(),
            "anthropic-messages"
        );
    }

    #[test]
    fn formats_openai_url() {
        let provider = build_provider(ApiProviderType::Openai, "https://api.openai.com");
        assert_eq!(
            format_provider_base_url(&provider).unwrap(),
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn keeps_existing_version_url() {
        let provider = build_provider(ApiProviderType::Openai, "https://example.com/v2");
        assert_eq!(
            format_provider_base_url(&provider).unwrap(),
            "https://example.com/v2"
        );
    }

    #[test]
    fn formats_gemini_url() {
        let provider = build_provider(
            ApiProviderType::Gemini,
            "https://generativelanguage.googleapis.com",
        );
        assert_eq!(
            format_provider_base_url(&provider).unwrap(),
            "https://generativelanguage.googleapis.com/v1beta/openai"
        );
    }

    #[test]
    fn formats_gateway_url() {
        let provider = build_provider(
            ApiProviderType::Gateway,
            "https://gateway.example.com/v1/ai",
        );
        assert_eq!(
            format_provider_base_url(&provider).unwrap(),
            "https://gateway.example.com/v1"
        );
    }

    #[test]
    fn rejects_unsupported_provider_types() {
        let provider = build_provider(ApiProviderType::AzureOpenai, "https://example.com");
        assert!(format_provider_base_url(&provider).is_err());
    }

    #[test]
    fn extracts_gateway_auth_token_from_config() {
        let config = json!({
            "gateway": {
                "auth": {
                    "token": "lime-token"
                }
            }
        });

        assert_eq!(
            extract_gateway_auth_token(&config).as_deref(),
            Some("lime-token")
        );
    }

    #[test]
    fn ignores_empty_gateway_auth_token() {
        let config = json!({
            "gateway": {
                "auth": {
                    "token": "   "
                }
            }
        });

        assert_eq!(extract_gateway_auth_token(&config), None);
    }

    #[test]
    fn applies_gateway_runtime_defaults_for_current_openclaw() {
        let mut config = json!({});

        apply_gateway_runtime_defaults(&mut config, 18790, "lime-token");

        assert_eq!(
            config.pointer("/gateway/mode").and_then(Value::as_str),
            Some("local")
        );
        assert_eq!(
            config.pointer("/gateway/bind").and_then(Value::as_str),
            Some("loopback")
        );
        assert_eq!(
            config.pointer("/gateway/auth/mode").and_then(Value::as_str),
            Some("token")
        );
        assert_eq!(
            config
                .pointer("/gateway/auth/token")
                .and_then(Value::as_str),
            Some("lime-token")
        );
        assert_eq!(
            config
                .pointer("/gateway/remote/token")
                .and_then(Value::as_str),
            Some("lime-token")
        );
        assert_eq!(
            config.pointer("/gateway/port").and_then(Value::as_u64),
            Some(18_790)
        );
    }

    #[test]
    fn gateway_start_args_include_new_runtime_guards() {
        assert_eq!(
            gateway_start_args(18790, "lime-token"),
            vec![
                "gateway",
                "--allow-unconfigured",
                "--bind",
                "loopback",
                "--auth",
                "token",
                "--token",
                "lime-token",
                "--port",
                "18790",
            ]
        );
    }

    #[test]
    fn parses_lsof_listener_pid_output() {
        assert_eq!(
            super::parse_lsof_listener_pids("1201\n1202\nbad\n1201\n"),
            vec![1201, 1202]
        );
    }

    #[test]
    fn parses_windows_netstat_listener_pid_output() {
        let output = "\
  TCP    127.0.0.1:18790      0.0.0.0:0      LISTENING      31234\n\
  TCP    [::]:18790           [::]:0         LISTENING      31235\n\
  TCP    127.0.0.1:18791      0.0.0.0:0      LISTENING      39999\n";

        assert_eq!(
            super::parse_windows_netstat_listener_pids(output, 18790),
            vec![31234, 31235]
        );
    }

    #[test]
    fn detects_openclaw_process_from_node_command_line() {
        let args = vec![
            OsString::from("/Users/demo/.nvm/versions/node/v23.4.0/bin/.openclaw-a1b2c3/openclaw"),
            OsString::from("gateway"),
            OsString::from("--port"),
            OsString::from("18790"),
        ];
        let node_path = PathBuf::from("/Users/demo/.nvm/versions/node/v23.4.0/bin/node");

        assert!(super::process_looks_like_openclaw_process(
            "node",
            Some(node_path.as_path()),
            &args,
        ));
    }

    #[test]
    fn ignores_unrelated_listener_process() {
        let args = vec![
            OsString::from("/usr/local/bin/python3"),
            OsString::from("-m"),
            OsString::from("http.server"),
            OsString::from("18790"),
        ];
        let python_path = PathBuf::from("/usr/local/bin/python3");

        assert!(!super::process_looks_like_openclaw_process(
            "python3",
            Some(python_path.as_path()),
            &args,
        ));
    }

    #[test]
    fn formats_gateway_start_failure_for_missing_config() {
        assert_eq!(
            format_gateway_start_failure_message(Some(
                "Missing config. Run `openclaw setup` or set gateway.mode=local."
            )),
            "Gateway 启动失败：OpenClaw 本地网关配置缺失，已自动补齐默认配置，请重试。"
        );
    }

    #[test]
    fn formats_gateway_start_failure_for_loopback_bind_error() {
        assert_eq!(
            format_gateway_start_failure_message(Some(
                "gateway bind=loopback resolved to non-loopback host 0.0.0.0"
            )),
            "Gateway 启动失败：当前环境无法绑定到本地回环地址 127.0.0.1，请检查本机网络或代理配置。"
        );
    }

    #[test]
    fn sanitizes_null_context_window_from_runtime_config() {
        let mut config = json!({
            "models": {
                "providers": {
                    "lime-openai": {
                        "models": [
                            {
                                "id": "gpt-5",
                                "name": "GPT-5",
                                "contextWindow": null
                            },
                            {
                                "id": "gpt-5-mini",
                                "name": "GPT-5 mini",
                                "contextWindow": 400000
                            }
                        ]
                    }
                }
            }
        });

        sanitize_runtime_config(&mut config);

        assert!(config
            .pointer("/models/providers/lime-openai/models/0/contextWindow")
            .is_none());
        assert_eq!(
            config
                .pointer("/models/providers/lime-openai/models/1/contextWindow")
                .and_then(Value::as_u64),
            Some(400_000)
        );
    }

    #[test]
    fn selects_specific_gateway_failure_detail_over_doctor_hint() {
        let lines = vec![
            "Config invalid".to_string(),
            "Run: openclaw doctor --fix".to_string(),
            "Invalid config at /Users/demo/.openclaw/openclaw.lime.json:\\n- models.providers.lime-openai.models.0.contextWindow: Invalid input: expected number, received null".to_string(),
        ];

        assert_eq!(
            select_gateway_start_failure_detail(&lines),
            Some(
                "Invalid config at /Users/demo/.openclaw/openclaw.lime.json:\\n- models.providers.lime-openai.models.0.contextWindow: Invalid input: expected number, received null"
            )
        );
    }

    #[test]
    fn formats_gateway_start_failure_for_invalid_context_window_config() {
        assert_eq!(
            format_gateway_start_failure_message(Some(
                "Invalid config at /Users/demo/.openclaw/openclaw.lime.json:\\n- models.providers.lime-openai.models.0.contextWindow: Invalid input: expected number, received null"
            )),
            "Gateway 启动失败：当前 OpenClaw 配置包含空的 contextWindow 字段。Lime 已修正后续配置写入，请重新启动；如仍失败，请重新同步模型配置。"
        );
    }

    #[test]
    fn selects_update_failure_reason_from_json_payload() {
        let payload = json!({
            "status": "error",
            "reason": "not-openclaw-root",
            "root": "/Users/demo/.nvm"
        });

        assert_eq!(
            select_openclaw_update_failure_detail(Some(&payload), &[], &[]),
            Some("not-openclaw-root (/Users/demo/.nvm)".to_string())
        );
    }

    #[test]
    fn formats_openclaw_update_failure_for_invalid_root() {
        assert_eq!(
            format_openclaw_update_failure_message(Some(
                "not-openclaw-root (/Users/demo/.nvm)"
            )),
            "OpenClaw 升级失败：未在 OpenClaw 安装根目录执行更新。Lime 会优先切换到安装目录；如仍失败，请重新检测安装状态后重试。"
        );
    }

    #[test]
    fn formats_openclaw_update_failure_for_node_version_requirement() {
        assert_eq!(
            format_openclaw_update_failure_message(Some(
                "openclaw: Node.js v22.12+ is required (current: v18.20.2)."
            )),
            "OpenClaw 升级失败：当前用于执行 openclaw 的 Node.js 版本过低，需要 22.12.0+。请切换到满足要求的 Node.js 后重试。"
        );
    }

    #[test]
    fn parses_semver_from_git_version_text() {
        assert_eq!(
            parse_semver_from_text("git version 2.39.5 (Apple Git-154)"),
            Some((2, 39, 5))
        );
    }

    #[test]
    fn environment_status_prioritizes_missing_node() {
        let env = build_environment_status(
            DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "missing node".to_string(),
                auto_install_supported: true,
            },
            DependencyStatus {
                status: "ok".to_string(),
                version: Some("2.43.0".to_string()),
                path: Some("/usr/bin/git".to_string()),
                message: "git ok".to_string(),
                auto_install_supported: true,
            },
            DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "openclaw missing".to_string(),
                auto_install_supported: false,
            },
            EnvironmentDiagnostics::default(),
        );

        assert_eq!(env.recommended_action, "install_node");
        assert_eq!(env.openclaw.auto_install_supported, false);
    }

    #[test]
    fn environment_status_uses_reload_summary_when_openclaw_command_not_ready() {
        let env = build_environment_status(
            DependencyStatus {
                status: "ok".to_string(),
                version: Some("22.12.0".to_string()),
                path: Some("/usr/local/bin/node".to_string()),
                message: "node ok".to_string(),
                auto_install_supported: true,
            },
            DependencyStatus {
                status: "ok".to_string(),
                version: Some("2.44.0".to_string()),
                path: Some("/usr/bin/git".to_string()),
                message: "git ok".to_string(),
                auto_install_supported: true,
            },
            DependencyStatus {
                status: "needs_reload".to_string(),
                version: Some("0.3.0".to_string()),
                path: Some("/mock/prefix".to_string()),
                message: "reload openclaw".to_string(),
                auto_install_supported: false,
            },
            EnvironmentDiagnostics::default(),
        );

        assert_eq!(env.recommended_action, "refresh_openclaw_env");
        assert!(env.summary.contains("重新检测"));
    }

    #[test]
    fn semver_selection_prefers_windows_launcher_over_bare_file_when_versions_equal() {
        let preferred = select_best_semver_candidate(vec![
            (PathBuf::from(r"C:\nvm4w\nodejs\openclaw"), Some((23, 1, 0))),
            (
                PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"),
                Some((23, 1, 0)),
            ),
        ]);

        assert_eq!(
            preferred,
            Some(PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"))
        );
    }

    #[test]
    fn windows_command_bin_dir_supports_backslash_paths() {
        assert_eq!(
            command_bin_dir_for(ShellPlatform::Windows, r"C:\Program Files\nodejs\npm.cmd"),
            Some(r"C:\Program Files\nodejs".to_string())
        );
    }

    #[test]
    fn windows_shell_command_escape_keeps_cmd_compatible_quotes() {
        assert_eq!(
            shell_command_escape_for(ShellPlatform::Windows, r#"C:\Program Files\nodejs\npm.cmd"#),
            r#""C:\Program Files\nodejs\npm.cmd""#
        );
        assert_eq!(
            shell_command_escape_for(ShellPlatform::Windows, "C:\\demo\\na\"me\\npm.cmd"),
            r#""C:\demo\na""me\npm.cmd""#
        );
    }

    #[test]
    fn windows_shell_npm_prefix_assignment_uses_set_syntax() {
        assert_eq!(
            shell_npm_prefix_assignment_for(
                ShellPlatform::Windows,
                r"C:\Users\demo\AppData\Roaming\npm"
            ),
            r#"set "NPM_CONFIG_PREFIX=C:\Users\demo\AppData\Roaming\npm" && "#
        );
    }

    #[test]
    fn windows_shell_path_assignment_prepends_binary_directory() {
        assert_eq!(
            shell_path_assignment_for(ShellPlatform::Windows, r"C:\Program Files\nodejs\npm.cmd"),
            r#"set "PATH=C:\Program Files\nodejs;%PATH%" && "#
        );
    }

    #[test]
    fn windows_cmd_scripts_use_call_invocation_prefix() {
        assert_eq!(
            shell_command_invocation_prefix_for(
                ShellPlatform::Windows,
                r"C:\Program Files\nodejs\npm.cmd"
            ),
            "call "
        );
        assert!(shell_command_invocation_prefix_for(
            ShellPlatform::Windows,
            r"C:\Users\demo\AppData\Local\Microsoft\WindowsApps\winget.exe"
        )
        .is_empty());
    }

    #[test]
    fn windows_cleanup_command_uses_cmd_compatible_syntax_without_true_fallback() {
        let command = build_openclaw_cleanup_command(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd",
            Some(r"C:\Users\demo\AppData\Roaming\npm"),
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "set \"NPM_CONFIG_PREFIX=C:\\Users\\demo\\AppData\\Roaming\\npm\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" uninstall -g openclaw @qingchencloud/openclaw-zh"
            )
        );
        assert!(!command.contains("|| true"));
    }

    #[test]
    fn windows_install_command_adds_registry_when_using_china_package() {
        let command = build_openclaw_install_command(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd",
            Some(r"C:\Users\demo\AppData\Roaming\npm"),
            OPENCLAW_CN_PACKAGE,
            Some(NPM_MIRROR_CN),
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "set \"NPM_CONFIG_PREFIX=C:\\Users\\demo\\AppData\\Roaming\\npm\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" install -g @qingchencloud/openclaw-zh@latest ",
                "--registry=https://registry.npmmirror.com"
            )
        );
    }

    #[test]
    fn windows_install_command_omits_registry_for_default_package() {
        let command = build_openclaw_install_command(
            ShellPlatform::Windows,
            r"C:\Program Files\nodejs\npm.cmd",
            None,
            OPENCLAW_DEFAULT_PACKAGE,
            None,
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Program Files\\nodejs;%PATH%\" && ",
                "call \"C:\\Program Files\\nodejs\\npm.cmd\" install -g openclaw@latest"
            )
        );
        assert!(!command.contains("--registry="));
    }

    #[test]
    fn windows_pnpm_install_command_uses_global_add_syntax() {
        let command = build_openclaw_pnpm_install_command(
            ShellPlatform::Windows,
            r"C:\Users\demo\AppData\Local\pnpm\pnpm.cmd",
            "@qingchencloud/openclaw-zh@latest",
            Some(NPM_MIRROR_CN),
        );

        assert_eq!(
            command,
            concat!(
                "set \"PATH=C:\\Users\\demo\\AppData\\Local\\pnpm;%PATH%\" && ",
                "call \"C:\\Users\\demo\\AppData\\Local\\pnpm\\pnpm.cmd\" add -g \"@qingchencloud/openclaw-zh@latest\" ",
                "--registry=\"https://registry.npmmirror.com\""
            )
        );
    }

    #[test]
    fn infers_openclaw_package_name_from_manifest_path() {
        assert_eq!(
            infer_openclaw_package_name_from_path(
                PathBuf::from(
                    "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/openclaw/package.json",
                )
                .as_path()
            ),
            Some("openclaw")
        );
        assert_eq!(
            infer_openclaw_package_name_from_path(PathBuf::from(
                "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json",
            )
            .as_path()),
            Some("@qingchencloud/openclaw-zh")
        );
    }

    #[test]
    fn china_package_upgrade_uses_npmmirror_registry() {
        assert_eq!(
            package_registry_for_package_spec("@qingchencloud/openclaw-zh@latest"),
            Some(NPM_MIRROR_CN)
        );
        assert_eq!(package_registry_for_package_spec("openclaw@latest"), None);
    }

    #[test]
    fn runtime_candidate_prefers_install_root_match_over_current_binary_hint() {
        let candidate = OpenClawRuntimeCandidate {
            id: "/Users/demo/.nvm/versions/node/v23.4.0/bin".to_string(),
            source: "nvm".to_string(),
            bin_dir: "/Users/demo/.nvm/versions/node/v23.4.0/bin".to_string(),
            node_path: "/Users/demo/.nvm/versions/node/v23.4.0/bin/node".to_string(),
            node_version: Some("23.4.0".to_string()),
            npm_path: Some("/Users/demo/.nvm/versions/node/v23.4.0/bin/npm".to_string()),
            npm_global_prefix: Some("/Users/demo/.nvm/versions/node/v23.4.0".to_string()),
            openclaw_path: Some("/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw".to_string()),
            openclaw_version: Some("2026.3.8".to_string()),
            openclaw_package_path: Some(
                "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json"
                    .to_string(),
            ),
            is_active: false,
            is_preferred: false,
        };

        assert!(runtime_candidate_matches_install_root(
            &candidate,
            PathBuf::from("/Users/demo/.nvm").as_path()
        ));
        assert!(!runtime_candidate_matches_install_root(
            &candidate,
            PathBuf::from("/Users/demo/Library/PhpWebStudy").as_path()
        ));
    }

    #[test]
    fn preferred_path_candidate_prioritizes_windows_executable_extensions() {
        let preferred = select_preferred_path_candidate(vec![
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw"),
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.bat"),
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.cmd"),
            PathBuf::from(r"C:\nvm4w\nodejs\openclaw.exe"),
        ]);

        assert_eq!(
            preferred,
            Some(PathBuf::from(r"C:\nvm4w\nodejs\openclaw.exe"))
        );
    }

    #[test]
    fn git_candidate_selection_prefers_executable_extension() {
        let preferred = select_best_git_candidate(vec![
            PathBuf::from(r"C:\Program Files\Git\cmd\git.cmd"),
            PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"),
        ]);

        assert_eq!(
            preferred,
            Some(PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"))
        );
    }

    #[test]
    fn windows_git_install_dir_variants_cover_common_layouts() {
        let git_root = build_unique_temp_dir("git-layout-root");
        let cmd_dir = git_root.join("cmd");
        let bin_dir = git_root.join("bin");
        fs::create_dir_all(&cmd_dir).unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(cmd_dir.join("git.exe"), "").unwrap();
        fs::write(bin_dir.join("git.cmd"), "").unwrap();

        let matches = super::find_all_commands_in_paths_for(
            ShellPlatform::Windows,
            "git",
            &windows_git_install_dir_variants(git_root.clone()),
        );

        let _ = fs::remove_dir_all(&git_root);

        assert_eq!(
            matches,
            vec![cmd_dir.join("git.exe"), bin_dir.join("git.cmd")]
        );
    }

    #[test]
    fn windows_npm_global_command_dirs_use_prefix_root() {
        assert_eq!(
            npm_global_command_dirs_for(
                ShellPlatform::Windows,
                r"C:\Users\demo\AppData\Roaming\npm"
            ),
            vec![PathBuf::from(r"C:\Users\demo\AppData\Roaming\npm")]
        );
    }

    #[test]
    fn unix_npm_global_command_dirs_include_bin_directory() {
        assert_eq!(
            npm_global_command_dirs_for(ShellPlatform::Unix, "/Users/demo/.npm-global"),
            vec![
                PathBuf::from("/Users/demo/.npm-global/bin"),
                PathBuf::from("/Users/demo/.npm-global")
            ]
        );
    }

    #[test]
    fn windows_npm_global_node_modules_dirs_use_prefix_node_modules() {
        assert_eq!(
            npm_global_node_modules_dirs_for(
                ShellPlatform::Windows,
                r"C:\Users\demo\AppData\Roaming\npm"
            ),
            vec![PathBuf::from(r"C:\Users\demo\AppData\Roaming\npm").join("node_modules")]
        );
    }

    #[test]
    fn finds_openclaw_package_from_global_npm_prefix() {
        let temp_dir =
            std::env::temp_dir().join(format!("lime-openclaw-test-{}", std::process::id()));
        let package_dir = temp_dir.join("node_modules").join("openclaw");
        fs::create_dir_all(&package_dir).unwrap();
        fs::write(
            package_dir.join("package.json"),
            r#"{"name":"openclaw","version":"0.4.1"}"#,
        )
        .unwrap();

        let detected = find_installed_openclaw_package(temp_dir.to_str().unwrap());

        fs::remove_dir_all(&temp_dir).unwrap();

        assert_eq!(detected, Some(("openclaw", Some("0.4.1".to_string()))));
    }

    #[test]
    fn resolves_openclaw_cli_entry_from_dist_index_when_bin_target_missing() {
        let temp_dir = build_unique_temp_dir("cli-entry");
        let package_dir = temp_dir
            .join("node_modules")
            .join("@qingchencloud/openclaw-zh");
        let dist_dir = package_dir.join("dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(
            package_dir.join("package.json"),
            r#"{
                "name":"@qingchencloud/openclaw-zh",
                "version":"2026.3.13-zh.1",
                "bin":{"openclaw":"openclaw.mjs"}
            }"#,
        )
        .unwrap();
        fs::write(dist_dir.join("index.js"), "console.log('openclaw');").unwrap();

        let resolved =
            resolve_openclaw_cli_entry_from_package_manifest(&package_dir.join("package.json"));

        let _ = fs::remove_dir_all(&temp_dir);

        assert_eq!(resolved, Some(package_dir.join("dist").join("index.js")));
    }

    #[test]
    fn resolves_openclaw_command_from_runtime_candidate_as_node_cli() {
        let temp_dir = build_unique_temp_dir("runtime-candidate");
        let node_bin_dir = temp_dir.join("bin");
        let package_dir = temp_dir
            .join("node_modules")
            .join("@qingchencloud/openclaw-zh");
        let dist_dir = package_dir.join("dist");
        fs::create_dir_all(&node_bin_dir).unwrap();
        fs::create_dir_all(&dist_dir).unwrap();

        let node_path = node_bin_dir.join("node");
        fs::write(&node_path, "").unwrap();
        fs::write(
            package_dir.join("package.json"),
            r#"{
                "name":"@qingchencloud/openclaw-zh",
                "version":"2026.3.13-zh.1",
                "bin":{"openclaw":"openclaw.mjs"}
            }"#,
        )
        .unwrap();
        fs::write(dist_dir.join("index.js"), "console.log('openclaw');").unwrap();

        let candidate = OpenClawRuntimeCandidate {
            id: temp_dir.display().to_string(),
            source: "nvm".to_string(),
            bin_dir: node_bin_dir.display().to_string(),
            node_path: node_path.display().to_string(),
            node_version: Some("23.4.0".to_string()),
            npm_path: None,
            npm_global_prefix: None,
            openclaw_path: None,
            openclaw_version: Some("2026.3.13-zh.1".to_string()),
            openclaw_package_path: Some(package_dir.join("package.json").display().to_string()),
            is_active: true,
            is_preferred: true,
        };

        let resolved = resolve_openclaw_command_from_runtime_candidate(&candidate);

        let _ = fs::remove_dir_all(&temp_dir);

        assert_eq!(
            resolved,
            Some(ResolvedOpenClawCommand::NodeCli {
                node_path,
                cli_path: package_dir.join("dist").join("index.js"),
                package_version: Some("2026.3.13-zh.1".to_string()),
            })
        );
    }

    #[test]
    fn windows_runtime_candidate_prefers_node_cli_over_cmd_shim() {
        let temp_dir = build_unique_temp_dir("runtime-candidate-windows-shim");
        let node_bin_dir = temp_dir.join("nodejs");
        let package_dir = temp_dir
            .join("node_modules")
            .join("@qingchencloud")
            .join("openclaw-zh");
        let dist_dir = package_dir.join("dist");
        fs::create_dir_all(&node_bin_dir).unwrap();
        fs::create_dir_all(&dist_dir).unwrap();

        let node_path = node_bin_dir.join("node.exe");
        let openclaw_cmd = node_bin_dir.join("openclaw.cmd");
        fs::write(&node_path, "").unwrap();
        fs::write(&openclaw_cmd, "@echo off").unwrap();
        fs::write(
            package_dir.join("package.json"),
            r#"{
                "name":"@qingchencloud/openclaw-zh",
                "version":"2026.3.13-zh.1",
                "bin":{"openclaw":"openclaw.mjs"}
            }"#,
        )
        .unwrap();
        fs::write(dist_dir.join("index.js"), "console.log('openclaw');").unwrap();

        let candidate = OpenClawRuntimeCandidate {
            id: temp_dir.display().to_string(),
            source: "system".to_string(),
            bin_dir: node_bin_dir.display().to_string(),
            node_path: node_path.display().to_string(),
            node_version: Some("23.4.0".to_string()),
            npm_path: Some(node_bin_dir.join("npm.cmd").display().to_string()),
            npm_global_prefix: Some(temp_dir.display().to_string()),
            openclaw_path: Some(openclaw_cmd.display().to_string()),
            openclaw_version: Some("2026.3.13-zh.1".to_string()),
            openclaw_package_path: Some(package_dir.join("package.json").display().to_string()),
            is_active: true,
            is_preferred: true,
        };

        let resolved =
            resolve_openclaw_command_from_runtime_candidate_for(ShellPlatform::Windows, &candidate);

        let _ = fs::remove_dir_all(&temp_dir);

        assert_eq!(
            resolved,
            Some(ResolvedOpenClawCommand::NodeCli {
                node_path,
                cli_path: package_dir.join("dist").join("index.js"),
                package_version: Some("2026.3.13-zh.1".to_string()),
            })
        );
    }

    #[test]
    fn windows_node_prefers_winget_when_available() {
        assert_eq!(
            resolve_windows_dependency_install_plan(DependencyKind::Node, true),
            WindowsDependencyInstallPlan::Winget {
                package_id: "OpenJS.NodeJS.LTS"
            }
        );
    }

    #[test]
    fn windows_node_falls_back_to_official_installer_without_winget() {
        assert_eq!(
            resolve_windows_dependency_install_plan(DependencyKind::Node, false),
            WindowsDependencyInstallPlan::OfficialInstaller
        );
    }

    #[test]
    fn windows_git_prefers_winget_when_available() {
        assert_eq!(
            resolve_windows_dependency_install_plan(DependencyKind::Git, true),
            WindowsDependencyInstallPlan::Winget {
                package_id: "Git.Git"
            }
        );
    }

    #[test]
    fn windows_git_requires_manual_download_without_winget() {
        assert_eq!(
            resolve_windows_dependency_install_plan(DependencyKind::Git, false),
            WindowsDependencyInstallPlan::ManualDownload
        );
        assert_eq!(
            windows_manual_install_message(DependencyKind::Git),
            "当前系统缺少 winget，暂时无法一键安装 Git，请点击“手动下载 Git”完成安装后重试。"
        );
    }

    #[test]
    fn windows_git_setup_message_points_to_manual_download() {
        let message = windows_dependency_setup_message(
            DependencyKind::Git,
            &DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "未检测到 Git。".to_string(),
                auto_install_supported: false,
            },
        );

        assert!(message.contains("git-scm.com"));
        assert!(message.contains("加入 PATH"));
    }

    #[test]
    fn windows_node_setup_message_points_to_nodejs_download() {
        let message = windows_dependency_setup_message(
            DependencyKind::Node,
            &DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "未检测到 Node.js，需要安装 22.12.0+。".to_string(),
                auto_install_supported: false,
            },
        );

        assert!(message.contains("nodejs.org"));
        assert!(message.contains("Node.js 22+"));
    }

    #[test]
    fn windows_dependency_action_result_returns_failure_message() {
        let result = windows_dependency_action_result(
            DependencyKind::Git,
            &DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "未检测到 Git。".to_string(),
                auto_install_supported: false,
            },
        );

        assert!(!result.success);
        assert!(result.message.contains("git-scm.com"));
    }

    #[test]
    fn windows_install_block_result_prioritizes_node_before_git() {
        let result = windows_install_block_result(
            &DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "未检测到 Node.js，需要安装 22.12.0+。".to_string(),
                auto_install_supported: false,
            },
            &DependencyStatus {
                status: "missing".to_string(),
                version: None,
                path: None,
                message: "未检测到 Git。".to_string(),
                auto_install_supported: false,
            },
        )
        .expect("应返回 Windows 阻断结果");

        assert!(!result.success);
        assert!(result.message.contains("nodejs.org"));
        assert!(!result.message.contains("git-scm.com"));
    }

    #[test]
    fn windows_install_block_result_returns_none_when_dependencies_ready() {
        let result = windows_install_block_result(
            &DependencyStatus {
                status: "ok".to_string(),
                version: Some("22.12.0".to_string()),
                path: Some("C:\\Program Files\\nodejs\\node.exe".to_string()),
                message: "Node.js 已就绪：22.12.0".to_string(),
                auto_install_supported: false,
            },
            &DependencyStatus {
                status: "ok".to_string(),
                version: Some("2.44.0".to_string()),
                path: Some("C:\\Program Files\\Git\\cmd\\git.exe".to_string()),
                message: "Git 已就绪：2.44.0".to_string(),
                auto_install_supported: false,
            },
        );

        assert!(result.is_none());
    }

    #[test]
    fn winget_install_command_uses_expected_windows_flags() {
        assert_eq!(
            build_winget_install_command(
                r"C:\Users\demo\AppData\Local\Microsoft\WindowsApps\winget.exe",
                "OpenJS.NodeJS.LTS"
            ),
            concat!(
                "set \"PATH=C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps;%PATH%\" && ",
                "\"C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\" install ",
                "--id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements"
            )
        );
    }
}

/// 从 Windows 注册表读取最新的 PATH 环境变量并刷新当前进程
#[cfg(target_os = "windows")]
fn refresh_windows_path_from_registry() -> Result<(), String> {
    unsafe {
        let mut combined_path = String::new();

        // 读取系统 PATH (HKEY_LOCAL_MACHINE)
        if let Ok(system_path) = read_registry_path(HKEY_LOCAL_MACHINE) {
            combined_path.push_str(&system_path);
        }

        // 读取用户 PATH (HKEY_CURRENT_USER)
        if let Ok(user_path) = read_registry_path(HKEY_CURRENT_USER) {
            if !combined_path.is_empty() {
                combined_path.push(';');
            }
            combined_path.push_str(&user_path);
        }

        if !combined_path.is_empty() {
            std::env::set_var("PATH", combined_path);
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn read_registry_path(root_key: HKEY) -> Result<String, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    let subkey: Vec<u16> = OsStr::new("Environment")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let value_name: Vec<u16> = OsStr::new("Path")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut key: HKEY = ptr::null_mut();
    let result = RegOpenKeyExW(
        root_key,
        subkey.as_ptr(),
        0,
        winapi::um::winnt::KEY_READ,
        &mut key,
    );

    if result != ERROR_SUCCESS as i32 {
        return Err(format!("无法打开注册表键: {}", result));
    }

    let mut buffer_size: DWORD = 0;
    let result = RegQueryValueExW(
        key,
        value_name.as_ptr(),
        ptr::null_mut(),
        ptr::null_mut(),
        ptr::null_mut(),
        &mut buffer_size,
    );

    if result != ERROR_SUCCESS as i32 {
        winapi::um::winreg::RegCloseKey(key);
        return Err(format!("无法查询注册表值大小: {}", result));
    }

    let mut buffer: Vec<u16> = vec![0; (buffer_size / 2) as usize + 1];
    let result = RegQueryValueExW(
        key,
        value_name.as_ptr(),
        ptr::null_mut(),
        ptr::null_mut(),
        buffer.as_mut_ptr() as *mut u8,
        &mut buffer_size,
    );

    winapi::um::winreg::RegCloseKey(key);

    if result != ERROR_SUCCESS as i32 {
        return Err(format!("无法读取注册表值: {}", result));
    }

    // 移除尾部的 null 字符
    if let Some(null_pos) = buffer.iter().position(|&c| c == 0) {
        buffer.truncate(null_pos);
    }

    Ok(String::from_utf16_lossy(&buffer))
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn refresh_windows_path_from_registry() -> Result<(), String> {
    Ok(())
}
