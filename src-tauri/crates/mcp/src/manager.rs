//! MCP 客户端管理器
//!
//! 本模块提供 MCP 客户端的集中管理，包括：
//! - 服务器生命周期管理（启动、停止、重启）
//! - 客户端连接池管理
//! - 工具定义缓存
//! - Tauri 事件发送
//!
//! # 架构设计
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                  McpClientManager                        │
//! │  ┌─────────────────────────────────────────────────┐   │
//! │  │           clients (连接池)                        │   │
//! │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │   │
//! │  │  │ Client1 │  │ Client2 │  │ Client3 │         │   │
//! │  │  └─────────┘  └─────────┘  └─────────┘         │   │
//! │  └─────────────────────────────────────────────────┘   │
//! │  ┌─────────────────────────────────────────────────┐   │
//! │  │           tool_cache (工具缓存)                   │   │
//! │  │  缓存所有运行中服务器的工具定义                      │   │
//! │  └─────────────────────────────────────────────────┘   │
//! └─────────────────────────────────────────────────────────┘
//! ```

#![allow(dead_code)]

use lime_core::{tool_calling::ToolSurfaceMetadata, DynEmitter};
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use rmcp::transport::TokioChildProcess;
use rmcp::ServiceExt;

use crate::client::McpClientWrapper;
use crate::types::*;

const AUTO_DEFER_TOOL_COUNT_THRESHOLD: usize = 6;
const MCP_RUNTIME_TOOL_PREFIX: &str = "mcp__";

fn build_mcp_runtime_tool_name(server_name: &str, tool_name: &str) -> String {
    format!("{MCP_RUNTIME_TOOL_PREFIX}{server_name}__{tool_name}")
}

fn extract_mcp_runtime_inner_tool_name<'a>(
    server_name: &str,
    tool_name: &'a str,
) -> Option<&'a str> {
    let prefix = build_mcp_runtime_tool_name(server_name, "");
    tool_name
        .strip_prefix(prefix.as_str())
        .filter(|inner_name| !inner_name.is_empty())
}

fn parse_mcp_runtime_tool_name<'a>(
    tool_name: &str,
    server_names: impl Iterator<Item = &'a String>,
) -> Option<(String, String)> {
    server_names
        .filter_map(|server_name| {
            extract_mcp_runtime_inner_tool_name(server_name, tool_name)
                .map(|inner_name| (server_name.clone(), inner_name.to_string()))
        })
        .max_by_key(|(server_name, _)| server_name.len())
}

/// MCP 客户端管理器
///
/// 负责管理所有 MCP 服务器的连接和生命周期。
///
/// # 功能
///
/// - **连接池管理**: 维护所有运行中的 MCP 客户端连接
/// - **工具缓存**: 缓存工具定义以避免重复查询
/// - **事件通知**: 通过 Tauri 事件系统通知前端状态变化
///
/// # 线程安全
///
/// 所有内部状态都使用 `Arc<RwLock<_>>` 包装，支持并发访问。
///
/// # 示例
///
/// ```rust,ignore
/// let manager = McpClientManager::new(Some(app_handle));
///
/// // 启动服务器
/// manager.start_server("my-server", &config).await?;
///
/// // 获取工具列表
/// let tools = manager.list_tools().await?;
///
/// // 调用工具
/// let result = manager.call_tool("my-tool", args).await?;
///
/// // 停止服务器
/// manager.stop_server("my-server").await?;
/// ```
pub struct McpClientManager {
    /// 运行中的客户端 (server_name -> client)
    ///
    /// 使用 HashMap 存储所有活跃的 MCP 客户端连接。
    /// 键为服务器名称，值为客户端包装器。
    clients: Arc<RwLock<HashMap<String, McpClientWrapper>>>,

    /// 工具定义缓存
    ///
    /// 缓存所有运行中服务器的工具定义。
    /// 当服务器启动或停止时，缓存会被失效。
    /// 使用 Option 表示缓存状态：
    /// - None: 缓存无效，需要重新获取
    /// - Some(tools): 缓存有效
    tool_cache: Arc<RwLock<Option<Vec<McpToolDefinition>>>>,

    /// 事件发射器
    ///
    /// 用于向前端发送 MCP 相关事件，如：
    /// - mcp:server_started
    /// - mcp:server_stopped
    /// - mcp:server_error
    /// - mcp:tools_updated
    emitter: Option<DynEmitter>,
}

impl McpClientManager {
    /// 创建新的管理器实例
    ///
    /// # Arguments
    ///
    /// * `emitter` - 事件发射器，用于发送事件到前端。
    ///   如果为 None，则不会发送事件。
    ///
    /// # Returns
    ///
    /// 返回初始化的 McpClientManager 实例，连接池和缓存均为空。
    pub fn new(emitter: Option<DynEmitter>) -> Self {
        info!("创建 MCP 客户端管理器");
        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            tool_cache: Arc::new(RwLock::new(None)),
            emitter,
        }
    }

    /// 设置事件发射器
    pub fn set_emitter(&mut self, emitter: DynEmitter) {
        self.emitter = Some(emitter);
    }

    // ========================================================================
    // 连接池管理方法
    // ========================================================================

    /// 获取客户端连接池的只读引用
    ///
    /// 用于需要遍历所有客户端的场景。
    pub fn clients(&self) -> Arc<RwLock<HashMap<String, McpClientWrapper>>> {
        self.clients.clone()
    }

    /// 获取指定服务器的客户端（检查是否存在）
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    ///
    /// # Returns
    ///
    /// 如果服务器正在运行，返回 true；否则返回 false。
    ///
    /// 注意：由于 McpClientWrapper 包含不可克隆的字段（如 tokio::process::Child），
    /// 我们不能直接返回客户端的克隆。如需操作客户端，请使用 clients() 获取连接池引用。
    pub async fn has_client(&self, name: &str) -> bool {
        let clients = self.clients.read().await;
        clients.contains_key(name)
    }

    /// 获取指定服务器的配置（如果存在）
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    ///
    /// # Returns
    ///
    /// 如果服务器正在运行，返回 Some(配置的克隆)；
    /// 否则返回 None。
    pub async fn get_client_config(&self, name: &str) -> Option<McpServerConfig> {
        let clients = self.clients.read().await;
        clients.get(name).map(|c| c.config.clone())
    }

    /// 获取指定服务器的能力信息（如果存在）
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    ///
    /// # Returns
    ///
    /// 如果服务器正在运行且有能力信息，返回 Some(能力信息的克隆)；
    /// 否则返回 None。
    pub async fn get_client_capabilities(&self, name: &str) -> Option<McpServerCapabilities> {
        let clients = self.clients.read().await;
        clients.get(name).and_then(|c| c.server_info.clone())
    }

    /// 添加客户端到连接池
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    /// * `client` - 客户端包装器
    ///
    /// # Returns
    ///
    /// 如果服务器已存在，返回错误；否则添加成功。
    pub async fn add_client(&self, name: String, client: McpClientWrapper) -> Result<(), McpError> {
        let mut clients = self.clients.write().await;
        if clients.contains_key(&name) {
            return Err(McpError::ServerAlreadyRunning(name));
        }
        debug!(server_name = %name, "添加客户端到连接池");
        clients.insert(name, client);
        Ok(())
    }

    /// 从连接池移除客户端
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    ///
    /// # Returns
    ///
    /// 如果服务器存在，返回移除的客户端包装器；
    /// 否则返回 None。
    pub async fn remove_client(&self, name: &str) -> Option<McpClientWrapper> {
        let mut clients = self.clients.write().await;
        let removed = clients.remove(name);
        if removed.is_some() {
            debug!(server_name = %name, "从连接池移除客户端");
        }
        removed
    }

    /// 获取所有运行中的服务器名称
    ///
    /// # Returns
    ///
    /// 返回所有运行中服务器的名称列表。
    pub async fn get_running_servers(&self) -> Vec<String> {
        let clients = self.clients.read().await;
        clients.keys().cloned().collect()
    }

    /// 获取运行中的服务器数量
    pub async fn running_server_count(&self) -> usize {
        let clients = self.clients.read().await;
        clients.len()
    }

    // ========================================================================
    // 缓存管理方法
    // ========================================================================

    /// 失效工具缓存
    ///
    /// 当服务器启动或停止时调用此方法，
    /// 确保下次获取工具列表时会重新查询所有服务器。
    pub async fn invalidate_tool_cache(&self) {
        let mut cache = self.tool_cache.write().await;
        if cache.is_some() {
            debug!("失效工具缓存");
        }
        *cache = None;
    }

    /// 检查工具缓存是否有效
    pub async fn is_tool_cache_valid(&self) -> bool {
        let cache = self.tool_cache.read().await;
        cache.is_some()
    }

    /// 获取缓存的工具列表（如果有效）
    ///
    /// # Returns
    ///
    /// 如果缓存有效，返回 Some(工具列表)；
    /// 否则返回 None。
    pub async fn get_cached_tools(&self) -> Option<Vec<McpToolDefinition>> {
        let cache = self.tool_cache.read().await;
        cache.clone()
    }

    /// 更新工具缓存
    ///
    /// # Arguments
    ///
    /// * `tools` - 新的工具列表
    pub async fn update_tool_cache(&self, tools: Vec<McpToolDefinition>) {
        let mut cache = self.tool_cache.write().await;
        debug!(tool_count = tools.len(), "更新工具缓存");
        *cache = Some(tools);
    }

    // ========================================================================
    // 事件发送方法
    // ========================================================================

    /// 发送 Tauri 事件到前端
    ///
    /// # Arguments
    ///
    /// * `event` - 事件名称
    /// * `payload` - 事件数据
    pub fn emit_event<T: serde::Serialize + Clone>(&self, event: &str, payload: T) {
        if let Some(ref emitter) = self.emitter {
            if let Ok(value) = serde_json::to_value(&payload) {
                if let Err(e) = emitter.emit_event(event, &value) {
                    warn!(
                        event = %event,
                        error = %e,
                        "发送事件失败"
                    );
                } else {
                    debug!(event = %event, "发送事件");
                }
            }
        }
    }

    /// 发送服务器启动事件
    pub fn emit_server_started(
        &self,
        server_name: &str,
        server_info: Option<McpServerCapabilities>,
    ) {
        info!(server_name = %server_name, "MCP 服务器已启动");
        self.emit_event(
            "mcp:server_started",
            McpServerStartedPayload {
                server_name: server_name.to_string(),
                server_info,
            },
        );
    }

    /// 发送服务器停止事件
    pub fn emit_server_stopped(&self, server_name: &str) {
        info!(server_name = %server_name, "MCP 服务器已停止");
        self.emit_event(
            "mcp:server_stopped",
            McpServerStoppedPayload {
                server_name: server_name.to_string(),
            },
        );
    }

    /// 发送服务器错误事件
    pub fn emit_server_error(&self, server_name: &str, error: &str) {
        warn!(server_name = %server_name, error = %error, "MCP 服务器错误");
        self.emit_event(
            "mcp:server_error",
            McpServerErrorPayload {
                server_name: server_name.to_string(),
                error: error.to_string(),
            },
        );
    }

    /// 发送工具列表更新事件
    pub fn emit_tools_updated(&self, tools: Vec<McpToolDefinition>) {
        debug!(tool_count = tools.len(), "工具列表已更新");
        self.emit_event("mcp:tools_updated", McpToolsUpdatedPayload { tools });
    }

    // ========================================================================
    // 服务器生命周期管理方法
    // ========================================================================

    /// 启动 MCP 服务器
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    /// * `config` - 服务器配置
    ///
    /// # Returns
    ///
    /// 成功返回 Ok(())，失败返回错误。
    ///
    /// # 实现步骤（Task 4.2）
    ///
    /// 1. 检查服务器是否已运行
    /// 2. 启动子进程
    /// 3. 建立 stdio 连接
    /// 4. 初始化 MCP 客户端
    /// 5. 失效工具缓存
    /// 6. 发送 mcp:server_started 事件
    pub async fn start_server(&self, name: &str, config: &McpServerConfig) -> Result<(), McpError> {
        info!(server_name = %name, command = %config.command, "启动 MCP 服务器");

        // 1. 检查服务器是否已运行
        if self.is_server_running(name).await {
            return Err(McpError::ServerAlreadyRunning(name.to_string()));
        }

        // 2. 构建命令
        let mut command = Command::new(&config.command);
        command.args(&config.args);

        // 设置环境变量
        for (key, value) in &config.env {
            command.env(key, value);
        }

        // macOS GUI 应用的 PATH 通常不完整，需要补充常见的命令路径
        // 确保 npx/node/uvx 等命令可被找到
        if !config.env.contains_key("PATH") {
            let current_path = std::env::var("PATH").unwrap_or_default();
            let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
            let extra_paths = [
                format!("{home}/.nvm/versions/node/*/bin"),
                format!("{home}/.local/bin"),
                format!("{home}/.cargo/bin"),
                format!("{home}/Library/pnpm"),
                format!("{home}/.bun/bin"),
                "/usr/local/bin".to_string(),
                "/opt/homebrew/bin".to_string(),
                "/opt/homebrew/sbin".to_string(),
            ];
            // 用 glob 展开 nvm 路径，取最新版本
            let mut resolved_paths: Vec<String> = Vec::new();
            for p in &extra_paths {
                if p.contains('*') {
                    if let Ok(entries) = glob::glob(p) {
                        let mut matched: Vec<String> = entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.to_string_lossy().to_string())
                            .collect();
                        matched.sort();
                        if let Some(last) = matched.last() {
                            resolved_paths.push(last.clone());
                        }
                    }
                } else if std::path::Path::new(p).exists() {
                    resolved_paths.push(p.clone());
                }
            }
            if !resolved_paths.is_empty() {
                let merged = if current_path.is_empty() {
                    resolved_paths.join(":")
                } else {
                    format!("{}:{}", resolved_paths.join(":"), current_path)
                };
                command.env("PATH", &merged);
                debug!(server_name = %name, "补充 PATH: {}", merged);
            }
        }

        // 设置工作目录（清洗 `\0` 和无效空白）
        if let Some(cwd) = config.sanitized_cwd() {
            command.current_dir(cwd);
        }

        // Unix 系统设置进程组（使子进程独立于父进程组）
        #[cfg(unix)]
        command.process_group(0);

        // 3. 启动子进程并建立 stdio 连接
        let spawn_result = TokioChildProcess::builder(command)
            .stderr(Stdio::piped())
            .spawn();

        let (transport, mut stderr_opt) = match spawn_result {
            Ok(result) => result,
            Err(e) => {
                let error_msg = format!("无法启动服务器进程: {e}");
                error!(server_name = %name, error = %e, "启动 MCP 服务器进程失败");
                self.emit_server_error(name, &error_msg);
                return Err(McpError::ProcessSpawnFailed(error_msg));
            }
        };

        // 启动 stderr 读取任务（用于错误诊断）
        let stderr_task = stderr_opt.take().map(|mut stderr| {
            tokio::spawn(async move {
                let mut all_stderr = Vec::new();
                let _ = stderr.read_to_end(&mut all_stderr).await;
                String::from_utf8_lossy(&all_stderr).into_owned()
            })
        });

        // 4. 初始化 MCP 客户端
        let client_handler =
            crate::client::LimeMcpClient::new(name.to_string(), self.emitter.clone());

        // 连接超时：至少 60 秒，避免 npx 首次下载时超时
        let timeout_secs = std::cmp::max(config.timeout, 60);
        let timeout = Duration::from_secs(timeout_secs);
        let connect_result = tokio::time::timeout(timeout, client_handler.serve(transport)).await;

        let running_service = match connect_result {
            Ok(Ok(service)) => service,
            Ok(Err(e)) => {
                // 获取 stderr 内容用于诊断
                let stderr_content = if let Some(task) = stderr_task {
                    task.await.unwrap_or_default()
                } else {
                    String::new()
                };

                let error_msg = if stderr_content.is_empty() {
                    format!("MCP 连接失败: {e}")
                } else {
                    format!("MCP 连接失败: {e}. Stderr: {stderr_content}")
                };

                error!(
                    server_name = %name,
                    error = %e,
                    stderr = %stderr_content,
                    "MCP 客户端初始化失败"
                );
                self.emit_server_error(name, &error_msg);
                return Err(McpError::ConnectionFailed(error_msg));
            }
            Err(_) => {
                let error_msg = format!("MCP 连接超时（{timeout_secs}秒）");
                error!(server_name = %name, timeout = timeout_secs, "MCP 连接超时");
                self.emit_server_error(name, &error_msg);
                return Err(McpError::Timeout);
            }
        };

        // 获取服务器信息
        let server_info = running_service
            .peer_info()
            .map(|info| McpServerCapabilities {
                name: info.server_info.name.clone(),
                version: info.server_info.version.clone(),
                supports_tools: info
                    .capabilities
                    .tools
                    .as_ref()
                    .map(|_| true)
                    .unwrap_or(false),
                supports_prompts: info
                    .capabilities
                    .prompts
                    .as_ref()
                    .map(|_| true)
                    .unwrap_or(false),
                supports_resources: info
                    .capabilities
                    .resources
                    .as_ref()
                    .map(|_| true)
                    .unwrap_or(false),
            });

        // 创建客户端包装器
        let mut wrapper = crate::client::McpClientWrapper::new(
            name.to_string(),
            config.clone(),
            self.emitter.clone(),
        );
        if let Some(ref info) = server_info {
            wrapper.set_server_info(info.clone());
        }
        wrapper.set_running_service(running_service);

        // 添加到连接池
        self.add_client(name.to_string(), wrapper).await?;

        // 5. 失效工具缓存
        self.invalidate_tool_cache().await;

        // 6. 发送 mcp:server_started 事件
        self.emit_server_started(name, server_info);

        info!(server_name = %name, "MCP 服务器启动成功");
        Ok(())
    }

    /// 停止 MCP 服务器
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    ///
    /// # Returns
    ///
    /// 成功返回 Ok(())，失败返回错误。
    /// 如果服务器未运行，也返回 Ok()（幂等操作）。
    ///
    /// # 实现步骤（Task 4.2）
    ///
    /// 1. 检查服务器是否在运行
    /// 2. 终止子进程
    /// 3. 清理客户端连接
    /// 4. 失效工具缓存
    /// 5. 发送 mcp:server_stopped 事件
    pub async fn stop_server(&self, name: &str) -> Result<(), McpError> {
        info!(server_name = %name, "停止 MCP 服务器");

        // 1. 检查服务器是否在运行
        if !self.is_server_running(name).await {
            debug!(server_name = %name, "服务器未运行，跳过停止操作");
            return Ok(()); // 幂等操作
        }

        // 2. 从连接池移除客户端
        let mut wrapper = match self.remove_client(name).await {
            Some(w) => w,
            None => {
                debug!(server_name = %name, "客户端已被移除");
                return Ok(());
            }
        };

        // 3. 取消 rmcp 服务（如果存在）
        if let Some(ref service) = wrapper.running_service {
            let cancellation_token = service.cancellation_token();
            cancellation_token.cancel();
            debug!(server_name = %name, "已取消 MCP 服务");
        }

        // 4. 终止子进程
        if let Err(e) = wrapper.kill_process().await {
            warn!(
                server_name = %name,
                error = %e,
                "终止子进程时出错（可能已退出）"
            );
            // 不返回错误，因为进程可能已经退出
        }

        // 5. 失效工具缓存
        self.invalidate_tool_cache().await;

        // 6. 发送 mcp:server_stopped 事件
        self.emit_server_stopped(name);

        info!(server_name = %name, "MCP 服务器已停止");
        Ok(())
    }

    /// 检查服务器是否在运行
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    ///
    /// # Returns
    ///
    /// 如果服务器正在运行返回 true，否则返回 false。
    pub async fn is_server_running(&self, name: &str) -> bool {
        let clients = self.clients.read().await;
        clients.contains_key(name)
    }

    /// 重启 MCP 服务器
    ///
    /// 先停止服务器，然后重新启动。
    ///
    /// # Arguments
    ///
    /// * `name` - 服务器名称
    /// * `config` - 服务器配置
    ///
    /// # Returns
    ///
    /// 成功返回 Ok(())，失败返回错误。
    pub async fn restart_server(
        &self,
        name: &str,
        config: &McpServerConfig,
    ) -> Result<(), McpError> {
        // 先停止（忽略未运行的错误）
        let _ = self.stop_server(name).await;
        // 再启动
        self.start_server(name, config).await
    }

    // ========================================================================
    // 工具管理方法
    // ========================================================================

    /// 获取所有工具定义
    ///
    /// 从所有运行中的服务器获取工具定义，并使用缓存优化性能。
    ///
    /// # Returns
    ///
    /// 返回所有可用工具的定义列表。
    ///
    /// # 实现步骤（Task 4.3）
    ///
    /// 1. 检查缓存是否有效
    /// 2. 如果缓存有效，直接返回缓存
    /// 3. 从所有运行中的服务器获取工具
    /// 4. 解决名称冲突（添加服务器前缀）
    /// 5. 更新缓存
    /// 6. 发送 mcp:tools_updated 事件
    /// 7. 返回工具列表
    pub async fn list_tools(&self) -> Result<Vec<McpToolDefinition>, McpError> {
        // 1. 检查缓存是否有效
        if let Some(cached_tools) = self.get_cached_tools().await {
            debug!(tool_count = cached_tools.len(), "返回缓存的工具列表");
            return Ok(cached_tools);
        }

        // 2. 从所有运行中的服务器获取工具
        let mut all_tools: Vec<McpToolDefinition> = Vec::new();
        let clients = self.clients.read().await;

        for (server_name, wrapper) in clients.iter() {
            // 检查服务器是否支持工具
            if let Some(ref info) = wrapper.server_info {
                if !info.supports_tools {
                    debug!(server_name = %server_name, "服务器不支持工具，跳过");
                    continue;
                }
            }

            // 获取 rmcp 服务
            let service = match wrapper.running_service() {
                Some(s) => s,
                None => {
                    warn!(server_name = %server_name, "服务器无运行服务，跳过");
                    continue;
                }
            };

            // 调用 list_tools（使用 list_all_tools 获取所有工具）
            match service.list_all_tools().await {
                Ok(tools) => {
                    debug!(
                        server_name = %server_name,
                        tool_count = tools.len(),
                        "获取服务器工具列表成功"
                    );
                    for tool in tools {
                        let input_schema = serde_json::Value::Object((*tool.input_schema).clone());
                        let metadata =
                            Self::extract_tool_metadata(tool.name.as_ref(), &input_schema);
                        all_tools.push(McpToolDefinition {
                            name: tool.name.to_string(),
                            description: tool
                                .description
                                .clone()
                                .map(|s| s.to_string())
                                .unwrap_or_default(),
                            input_schema,
                            server_name: server_name.clone(),
                            deferred_loading: metadata.deferred_loading,
                            always_visible: metadata.always_visible,
                            allowed_callers: metadata.allowed_callers,
                            input_examples: (!metadata.input_examples.is_empty())
                                .then_some(metadata.input_examples),
                            tags: metadata.tags,
                        });
                    }
                }
                Err(e) => {
                    warn!(
                        server_name = %server_name,
                        error = %e,
                        "获取服务器工具列表失败"
                    );
                    // 继续处理其他服务器，不中断
                }
            }
        }
        drop(clients);

        // 3. 收口到 MCP current runtime 名称
        let resolved_tools =
            Self::apply_default_loading_policy(Self::apply_runtime_tool_names(all_tools));

        // 4. 更新缓存
        self.update_tool_cache(resolved_tools.clone()).await;

        // 5. 发送 mcp:tools_updated 事件
        self.emit_tools_updated(resolved_tools.clone());

        info!(tool_count = resolved_tools.len(), "工具列表已更新");
        Ok(resolved_tools)
    }

    /// 根据上下文过滤工具列表
    ///
    /// - `caller`: 调用方（assistant/code_execution/tool_search）
    /// - `include_deferred`: 是否包含延迟加载工具
    pub async fn list_tools_for_context(
        &self,
        caller: Option<&str>,
        include_deferred: bool,
    ) -> Result<Vec<McpToolDefinition>, McpError> {
        let tools = self.list_tools().await?;

        let filtered = tools
            .into_iter()
            .filter(|tool| {
                let metadata = ToolSurfaceMetadata {
                    deferred_loading: tool.deferred_loading,
                    always_visible: tool.always_visible,
                    allowed_callers: tool.allowed_callers.clone(),
                    tags: tool.tags.clone(),
                    input_examples: tool.input_examples.clone().unwrap_or_default(),
                };

                if !lime_core::tool_calling::tool_visible_in_context(&metadata, include_deferred) {
                    return false;
                }
                lime_core::tool_calling::tool_matches_caller(&metadata, caller)
            })
            .collect();

        Ok(filtered)
    }

    /// 搜索工具
    ///
    /// 搜索默认包含 deferred 工具，便于模型通过 tool_search 检索按需加载。
    pub async fn search_tools(
        &self,
        query: &str,
        limit: usize,
        caller: Option<&str>,
    ) -> Result<Vec<McpToolDefinition>, McpError> {
        let query = query.trim().to_ascii_lowercase();
        let limit = limit.clamp(1, 100);
        let mut tools = self.list_tools_for_context(caller, true).await?;

        // 空查询：优先 always_visible，再按名称排序返回前 N
        if query.is_empty() {
            tools.sort_by(|a, b| {
                let a_visible = a.always_visible.unwrap_or(false);
                let b_visible = b.always_visible.unwrap_or(false);
                b_visible
                    .cmp(&a_visible)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });
            tools.truncate(limit);
            return Ok(tools);
        }

        let mut scored: Vec<(i32, McpToolDefinition)> = tools
            .into_iter()
            .filter_map(|tool| {
                let score = Self::score_tool_match(&tool, &query);
                (score > 0).then_some((score, tool))
            })
            .collect();

        scored.sort_by(|(score_a, tool_a), (score_b, tool_b)| {
            score_b
                .cmp(score_a)
                .then_with(|| tool_a.name.to_lowercase().cmp(&tool_b.name.to_lowercase()))
        });

        let mut result = scored
            .into_iter()
            .take(limit)
            .map(|(_, tool)| tool)
            .collect::<Vec<_>>();
        result.truncate(limit);
        Ok(result)
    }

    fn extract_tool_metadata(
        tool_name: &str,
        input_schema: &serde_json::Value,
    ) -> ToolSurfaceMetadata {
        lime_core::tool_calling::extract_tool_surface_metadata(tool_name, input_schema)
    }

    fn score_tool_match(tool: &McpToolDefinition, query: &str) -> i32 {
        let tags = tool.tags.as_deref().unwrap_or(&[]);
        let inner_tool_name = extract_mcp_runtime_inner_tool_name(&tool.server_name, &tool.name)
            .unwrap_or(&tool.name);
        let score = [
            lime_core::tool_calling::score_tool_match(&tool.name, &tool.description, tags, query),
            lime_core::tool_calling::score_tool_match(
                inner_tool_name,
                &tool.description,
                tags,
                query,
            ),
        ]
        .into_iter()
        .max()
        .unwrap_or(0);

        if tool.always_visible.unwrap_or(false) {
            return score + 5;
        }

        score
    }

    fn apply_default_loading_policy(tools: Vec<McpToolDefinition>) -> Vec<McpToolDefinition> {
        let mut server_tool_counts: HashMap<String, usize> = HashMap::new();
        for tool in &tools {
            *server_tool_counts
                .entry(tool.server_name.clone())
                .or_insert(0) += 1;
        }

        tools
            .into_iter()
            .map(|mut tool| {
                if tool.deferred_loading.is_none() {
                    let should_auto_defer = server_tool_counts
                        .get(&tool.server_name)
                        .copied()
                        .unwrap_or_default()
                        > AUTO_DEFER_TOOL_COUNT_THRESHOLD
                        && !tool.always_visible.unwrap_or(false);
                    tool.deferred_loading = Some(should_auto_defer);
                }
                tool
            })
            .collect()
    }

    /// 将 MCP 工具名统一收口到当前 runtime 命名。
    ///
    /// # Arguments
    ///
    /// * `tools` - 原始工具列表
    ///
    /// # Returns
    ///
    /// 返回统一后的工具列表，名称始终为 `mcp__<server>__<tool>`。
    fn apply_runtime_tool_names(tools: Vec<McpToolDefinition>) -> Vec<McpToolDefinition> {
        tools
            .into_iter()
            .map(|mut tool| {
                let original_name = tool.name.clone();
                tool.name = build_mcp_runtime_tool_name(&tool.server_name, &original_name);
                tool
            })
            .collect()
    }

    /// 调用工具
    ///
    /// # Arguments
    ///
    /// * `tool_name` - 工具名称，格式为 `mcp__<server>__<tool>`
    /// * `arguments` - 工具参数
    ///
    /// # Returns
    ///
    /// 返回工具调用结果。
    ///
    /// # 实现步骤（Task 4.3）
    ///
    /// 1. 解析工具名称，确定目标服务器
    /// 2. 路由到正确的客户端
    /// 3. 执行工具调用
    /// 4. 转换结果为 McpToolResult
    /// 5. 返回结果
    pub async fn call_tool_with_caller(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
        caller: Option<&str>,
    ) -> Result<McpToolResult, McpError> {
        let caller = caller
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase());

        if let Some(caller) = caller {
            let tools = self.list_tools().await?;
            if let Some(tool) = tools.iter().find(|t| t.name == tool_name) {
                if let Some(allowed) = tool.allowed_callers.as_ref() {
                    let allowed_set: HashSet<String> = allowed
                        .iter()
                        .map(|v| v.trim().to_ascii_lowercase())
                        .filter(|v| !v.is_empty())
                        .collect();
                    if !allowed_set.is_empty() && !allowed_set.contains(&caller) {
                        return Err(McpError::ToolCallFailed(format!(
                            "调用方 '{}' 无权调用工具 '{}'",
                            caller, tool_name
                        )));
                    }
                }
            }
        }

        self.call_tool(tool_name, arguments).await
    }

    /// # 实现步骤（Task 4.3）
    ///
    /// 1. 解析工具名称，确定目标服务器
    /// 2. 路由到正确的客户端
    /// 3. 执行工具调用
    /// 4. 转换结果为 McpToolResult
    /// 5. 返回结果
    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, McpError> {
        info!(tool_name = %tool_name, "调用 MCP 工具");

        // 1. 解析工具名称，确定目标服务器和实际工具名
        let (server_name, actual_tool_name) = self.resolve_tool_target(tool_name).await?;

        debug!(
            tool_name = %tool_name,
            server_name = %server_name,
            actual_tool_name = %actual_tool_name,
            "解析工具目标"
        );

        // 2. 获取目标服务器的客户端
        let clients = self.clients.read().await;
        let wrapper = clients
            .get(&server_name)
            .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;

        let service = wrapper
            .running_service()
            .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;

        // 3. 构建工具调用参数
        let args = match arguments {
            serde_json::Value::Object(map) => Some(map),
            serde_json::Value::Null => None,
            _ => {
                return Err(McpError::ToolCallFailed(
                    "参数必须是 JSON 对象或 null".to_string(),
                ));
            }
        };

        let call_param = rmcp::model::CallToolRequestParam {
            name: actual_tool_name.clone().into(),
            arguments: args,
        };

        // 4. 执行工具调用
        let result = service.call_tool(call_param).await.map_err(|e| {
            error!(
                tool_name = %actual_tool_name,
                server_name = %server_name,
                error = %e,
                "工具调用失败"
            );
            McpError::ToolCallFailed(format!("{e}"))
        })?;

        // 5. 转换结果为 McpToolResult
        let mcp_result = Self::convert_call_tool_result(result);

        info!(
            tool_name = %actual_tool_name,
            server_name = %server_name,
            is_error = mcp_result.is_error,
            "工具调用完成"
        );

        Ok(mcp_result)
    }

    /// 解析工具目标（服务器名称和实际工具名）
    ///
    /// # Arguments
    ///
    /// * `tool_name` - 工具名称，格式为 `mcp__<server>__<tool>`
    ///
    /// # Returns
    ///
    /// 返回 (服务器名称, 实际工具名) 元组。
    ///
    /// # 解析逻辑
    ///
    /// 1. 按 `mcp__<server>__<tool>` 解析运行时工具名
    /// 2. 使用最长 server 名匹配，避免 server 名中包含 `__` 时误切割
    /// 3. 解析失败则视为未知 current 工具名
    async fn resolve_tool_target(&self, tool_name: &str) -> Result<(String, String), McpError> {
        let clients = self.clients.read().await;

        if let Some((server_name, actual_tool_name)) =
            parse_mcp_runtime_tool_name(tool_name, clients.keys())
        {
            return Ok((server_name, actual_tool_name));
        }

        // 工具未找到
        Err(McpError::ToolNotFound(tool_name.to_string()))
    }

    /// 转换 rmcp CallToolResult 为 McpToolResult
    fn convert_call_tool_result(result: rmcp::model::CallToolResult) -> McpToolResult {
        let content: Vec<McpContent> = result
            .content
            .into_iter()
            .map(Self::convert_content)
            .collect();

        McpToolResult {
            content,
            is_error: result.is_error.unwrap_or(false),
        }
    }

    /// 转换 rmcp Content 为 McpContent
    fn convert_content(content: rmcp::model::Content) -> McpContent {
        // Content 是 Annotated<RawContent>，需要访问内部的 raw 字段
        match content.raw {
            rmcp::model::RawContent::Text(text_content) => McpContent::Text {
                text: text_content.text,
            },
            rmcp::model::RawContent::Image(image_content) => McpContent::Image {
                data: image_content.data,
                mime_type: image_content.mime_type,
            },
            rmcp::model::RawContent::Resource(resource_content) => {
                let (uri, text, blob) = match resource_content.resource {
                    rmcp::model::ResourceContents::TextResourceContents { uri, text, .. } => {
                        (uri, Some(text), None)
                    }
                    rmcp::model::ResourceContents::BlobResourceContents { uri, blob, .. } => {
                        (uri, None, Some(blob))
                    }
                };
                McpContent::Resource { uri, text, blob }
            }
            rmcp::model::RawContent::Audio(audio_content) => {
                // 将音频内容作为 Image 类型处理（因为 McpContent 没有 Audio 变体）
                McpContent::Image {
                    data: audio_content.data,
                    mime_type: audio_content.mime_type,
                }
            }
            rmcp::model::RawContent::ResourceLink(resource_link) => McpContent::Resource {
                uri: resource_link.uri.clone(),
                text: Some(resource_link.name.clone()),
                blob: None,
            },
        }
    }

    // ========================================================================
    // 提示词管理方法
    // ========================================================================

    /// 获取所有提示词
    ///
    /// 从所有运行中的服务器获取提示词定义。
    ///
    /// # Returns
    ///
    /// 返回所有可用提示词的定义列表。
    ///
    /// # 实现步骤（Task 4.4）
    ///
    /// 1. 遍历所有运行中的服务器
    /// 2. 检查服务器是否支持提示词
    /// 3. 调用 list_all_prompts 获取提示词列表
    /// 4. 转换为 McpPromptDefinition 格式
    /// 5. 返回合并后的提示词列表
    pub async fn list_prompts(&self) -> Result<Vec<McpPromptDefinition>, McpError> {
        info!("获取所有 MCP 提示词");

        let mut all_prompts: Vec<McpPromptDefinition> = Vec::new();
        let clients = self.clients.read().await;

        for (server_name, wrapper) in clients.iter() {
            // 检查服务器是否支持提示词
            if let Some(ref info) = wrapper.server_info {
                if !info.supports_prompts {
                    debug!(server_name = %server_name, "服务器不支持提示词，跳过");
                    continue;
                }
            }

            // 获取 rmcp 服务
            let service = match wrapper.running_service() {
                Some(s) => s,
                None => {
                    warn!(server_name = %server_name, "服务器无运行服务，跳过");
                    continue;
                }
            };

            // 调用 list_all_prompts 获取所有提示词
            match service.list_all_prompts().await {
                Ok(prompts) => {
                    debug!(
                        server_name = %server_name,
                        prompt_count = prompts.len(),
                        "获取服务器提示词列表成功"
                    );
                    for prompt in prompts {
                        all_prompts.push(Self::convert_prompt_to_definition(
                            prompt,
                            server_name.clone(),
                        ));
                    }
                }
                Err(e) => {
                    warn!(
                        server_name = %server_name,
                        error = %e,
                        "获取服务器提示词列表失败"
                    );
                    // 继续处理其他服务器，不中断
                }
            }
        }

        info!(prompt_count = all_prompts.len(), "提示词列表已获取");
        Ok(all_prompts)
    }

    /// 将 rmcp Prompt 转换为 McpPromptDefinition
    fn convert_prompt_to_definition(
        prompt: rmcp::model::Prompt,
        server_name: String,
    ) -> McpPromptDefinition {
        let arguments = prompt
            .arguments
            .unwrap_or_default()
            .into_iter()
            .map(|arg| McpPromptArgument {
                name: arg.name,
                description: arg.description,
                required: arg.required.unwrap_or(false),
            })
            .collect();

        McpPromptDefinition {
            name: prompt.name.to_string(),
            description: prompt.description.map(|s| s.to_string()),
            arguments,
            server_name,
        }
    }

    /// 获取提示词内容
    ///
    /// # Arguments
    ///
    /// * `name` - 提示词名称（可能包含服务器前缀，格式为 "server_promptname"）
    /// * `arguments` - 提示词参数
    ///
    /// # Returns
    ///
    /// 返回提示词内容，包含描述和消息列表。
    ///
    /// # 实现步骤（Task 4.4）
    ///
    /// 1. 解析提示词名称，确定目标服务器
    /// 2. 验证必需参数是否提供
    /// 3. 调用服务器的 get_prompt 方法
    /// 4. 转换结果为 McpPromptResult
    /// 5. 返回结果
    pub async fn get_prompt(
        &self,
        name: &str,
        arguments: serde_json::Map<String, serde_json::Value>,
    ) -> Result<McpPromptResult, McpError> {
        info!(prompt_name = %name, "获取 MCP 提示词内容");

        // 1. 解析提示词名称，确定目标服务器和实际提示词名
        let (server_name, actual_prompt_name) = self.resolve_prompt_target(name).await?;

        debug!(
            prompt_name = %name,
            server_name = %server_name,
            actual_prompt_name = %actual_prompt_name,
            "解析提示词目标"
        );

        // 2. 获取目标服务器的客户端
        let clients = self.clients.read().await;
        let wrapper = clients
            .get(&server_name)
            .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;

        let service = wrapper
            .running_service()
            .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;

        // 3. 构建 get_prompt 请求参数
        let args: Option<serde_json::Map<String, serde_json::Value>> = if arguments.is_empty() {
            None
        } else {
            Some(arguments)
        };

        let get_prompt_param = rmcp::model::GetPromptRequestParam {
            name: actual_prompt_name.clone(),
            arguments: args,
        };

        // 4. 调用 get_prompt
        let result = service.get_prompt(get_prompt_param).await.map_err(|e| {
            error!(
                prompt_name = %actual_prompt_name,
                server_name = %server_name,
                error = %e,
                "获取提示词失败"
            );
            McpError::ToolCallFailed(format!("获取提示词失败: {e}"))
        })?;

        // 5. 转换结果为 McpPromptResult
        let mcp_result = Self::convert_get_prompt_result(result);

        info!(
            prompt_name = %actual_prompt_name,
            server_name = %server_name,
            message_count = mcp_result.messages.len(),
            "提示词获取完成"
        );

        Ok(mcp_result)
    }

    /// 解析提示词目标（服务器名称和实际提示词名）
    ///
    /// # Arguments
    ///
    /// * `prompt_name` - 提示词名称（可能包含服务器前缀，格式为 "server_promptname"）
    ///
    /// # Returns
    ///
    /// 返回 (服务器名称, 实际提示词名) 元组。
    async fn resolve_prompt_target(&self, prompt_name: &str) -> Result<(String, String), McpError> {
        let clients = self.clients.read().await;

        // 尝试解析带前缀的提示词名（格式：server_promptname）
        if let Some(underscore_pos) = prompt_name.find('_') {
            let potential_server = &prompt_name[..underscore_pos];
            let potential_prompt = &prompt_name[underscore_pos + 1..];

            // 检查是否存在该服务器
            if clients.contains_key(potential_server) && !potential_prompt.is_empty() {
                return Ok((potential_server.to_string(), potential_prompt.to_string()));
            }
        }

        // 没有前缀或前缀不匹配，在所有服务器中查找该提示词
        for (server_name, wrapper) in clients.iter() {
            if let Some(service) = wrapper.running_service() {
                // 尝试获取提示词列表并查找
                if let Ok(prompts) = service.list_all_prompts().await {
                    if prompts.iter().any(|p| p.name.as_str() == prompt_name) {
                        return Ok((server_name.clone(), prompt_name.to_string()));
                    }
                }
            }
        }

        // 提示词未找到
        Err(McpError::ToolNotFound(format!(
            "提示词不存在: {prompt_name}"
        )))
    }

    /// 转换 rmcp GetPromptResult 为 McpPromptResult
    fn convert_get_prompt_result(result: rmcp::model::GetPromptResult) -> McpPromptResult {
        let messages: Vec<McpPromptMessage> = result
            .messages
            .into_iter()
            .map(Self::convert_prompt_message)
            .collect();

        McpPromptResult {
            description: result.description.map(|s| s.to_string()),
            messages,
        }
    }

    /// 转换 rmcp PromptMessage 为 McpPromptMessage
    fn convert_prompt_message(msg: rmcp::model::PromptMessage) -> McpPromptMessage {
        let role = match msg.role {
            rmcp::model::PromptMessageRole::User => "user".to_string(),
            rmcp::model::PromptMessageRole::Assistant => "assistant".to_string(),
        };

        let content = Self::convert_prompt_message_content(msg.content);

        McpPromptMessage { role, content }
    }

    /// 转换 rmcp PromptMessageContent 为 McpContent
    fn convert_prompt_message_content(content: rmcp::model::PromptMessageContent) -> McpContent {
        match content {
            rmcp::model::PromptMessageContent::Text { text } => McpContent::Text { text },
            rmcp::model::PromptMessageContent::Image { image } => McpContent::Image {
                data: image.data.clone(),
                mime_type: image.mime_type.clone(),
            },
            rmcp::model::PromptMessageContent::Resource { resource } => {
                let (uri, text, blob) = match &resource.resource {
                    rmcp::model::ResourceContents::TextResourceContents { uri, text, .. } => {
                        (uri.clone(), Some(text.clone()), None)
                    }
                    rmcp::model::ResourceContents::BlobResourceContents { uri, blob, .. } => {
                        (uri.clone(), None, Some(blob.clone()))
                    }
                };
                McpContent::Resource { uri, text, blob }
            }
            rmcp::model::PromptMessageContent::ResourceLink { link } => McpContent::Resource {
                uri: link.uri.clone(),
                text: Some(link.name.clone()),
                blob: None,
            },
        }
    }

    // ========================================================================
    // 资源管理方法
    // ========================================================================

    /// 获取所有资源
    ///
    /// 从所有运行中的服务器获取资源定义。
    ///
    /// # Returns
    ///
    /// 返回所有可用资源的定义列表。
    ///
    /// # 实现步骤（Task 4.5）
    ///
    /// 1. 遍历所有运行中的服务器
    /// 2. 检查服务器是否支持资源
    /// 3. 调用 list_all_resources 获取资源列表
    /// 4. 转换为 McpResourceDefinition 格式
    /// 5. 返回合并后的资源列表
    pub async fn list_resources(&self) -> Result<Vec<McpResourceDefinition>, McpError> {
        info!("获取所有 MCP 资源");

        let mut all_resources: Vec<McpResourceDefinition> = Vec::new();
        let clients = self.clients.read().await;

        for (server_name, wrapper) in clients.iter() {
            // 检查服务器是否支持资源
            if let Some(ref info) = wrapper.server_info {
                if !info.supports_resources {
                    debug!(server_name = %server_name, "服务器不支持资源，跳过");
                    continue;
                }
            }

            // 获取 rmcp 服务
            let service = match wrapper.running_service() {
                Some(s) => s,
                None => {
                    warn!(server_name = %server_name, "服务器无运行服务，跳过");
                    continue;
                }
            };

            // 调用 list_all_resources 获取所有资源
            match service.list_all_resources().await {
                Ok(resources) => {
                    debug!(
                        server_name = %server_name,
                        resource_count = resources.len(),
                        "获取服务器资源列表成功"
                    );
                    for resource in resources {
                        all_resources.push(Self::convert_resource_to_definition(
                            resource,
                            server_name.clone(),
                        ));
                    }
                }
                Err(e) => {
                    warn!(
                        server_name = %server_name,
                        error = %e,
                        "获取服务器资源列表失败"
                    );
                    // 继续处理其他服务器，不中断
                }
            }
        }

        info!(resource_count = all_resources.len(), "资源列表已获取");
        Ok(all_resources)
    }

    /// 将 rmcp Resource 转换为 McpResourceDefinition
    fn convert_resource_to_definition(
        resource: rmcp::model::Resource,
        server_name: String,
    ) -> McpResourceDefinition {
        McpResourceDefinition {
            uri: resource.uri.clone(),
            name: resource.name.clone(),
            description: resource.description.clone(),
            mime_type: resource.mime_type.clone(),
            server_name,
        }
    }

    /// 读取资源内容
    ///
    /// # Arguments
    ///
    /// * `uri` - 资源 URI
    ///
    /// # Returns
    ///
    /// 返回资源内容。
    ///
    /// # 实现步骤（Task 4.5）
    ///
    /// 1. 解析资源 URI，确定目标服务器
    /// 2. 调用服务器的 read_resource 方法
    /// 3. 转换结果为 McpResourceContent
    /// 4. 返回结果
    pub async fn read_resource(&self, uri: &str) -> Result<McpResourceContent, McpError> {
        info!(uri = %uri, "读取 MCP 资源");

        // 1. 解析资源 URI，确定目标服务器
        let (server_name, _) = self.resolve_resource_target(uri).await?;

        debug!(
            uri = %uri,
            server_name = %server_name,
            "解析资源目标"
        );

        // 2. 获取目标服务器的客户端
        let clients = self.clients.read().await;
        let wrapper = clients
            .get(&server_name)
            .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;

        let service = wrapper
            .running_service()
            .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;

        // 3. 构建 read_resource 请求参数
        let read_param = rmcp::model::ReadResourceRequestParam {
            uri: uri.to_string(),
        };

        // 4. 调用 read_resource
        let result = service.read_resource(read_param).await.map_err(|e| {
            error!(
                uri = %uri,
                server_name = %server_name,
                error = %e,
                "读取资源失败"
            );
            McpError::ToolCallFailed(format!("读取资源失败: {e}"))
        })?;

        // 5. 转换结果为 McpResourceContent
        let mcp_result = Self::convert_read_resource_result(uri, result);

        info!(
            uri = %uri,
            server_name = %server_name,
            "资源读取完成"
        );

        Ok(mcp_result)
    }

    /// 解析资源目标（服务器名称）
    ///
    /// # Arguments
    ///
    /// * `uri` - 资源 URI
    ///
    /// # Returns
    ///
    /// 返回 (服务器名称, 资源 URI) 元组。
    ///
    /// # 解析逻辑
    ///
    /// 遍历所有运行中的服务器，查找提供该资源的服务器。
    async fn resolve_resource_target(&self, uri: &str) -> Result<(String, String), McpError> {
        let clients = self.clients.read().await;

        // 在所有服务器中查找该资源
        for (server_name, wrapper) in clients.iter() {
            // 检查服务器是否支持资源
            if let Some(ref info) = wrapper.server_info {
                if !info.supports_resources {
                    continue;
                }
            }

            if let Some(service) = wrapper.running_service() {
                // 尝试获取资源列表并查找
                if let Ok(resources) = service.list_all_resources().await {
                    if resources.iter().any(|r| r.uri == uri) {
                        return Ok((server_name.clone(), uri.to_string()));
                    }
                }
            }
        }

        // 资源未找到
        Err(McpError::ToolNotFound(format!("资源不存在: {uri}")))
    }

    /// 转换 rmcp ReadResourceResult 为 McpResourceContent
    fn convert_read_resource_result(
        uri: &str,
        result: rmcp::model::ReadResourceResult,
    ) -> McpResourceContent {
        // 获取第一个内容（通常只有一个）
        if let Some(content) = result.contents.into_iter().next() {
            match content {
                rmcp::model::ResourceContents::TextResourceContents {
                    uri: content_uri,
                    mime_type,
                    text,
                    ..
                } => McpResourceContent {
                    uri: content_uri,
                    mime_type,
                    text: Some(text),
                    blob: None,
                },
                rmcp::model::ResourceContents::BlobResourceContents {
                    uri: content_uri,
                    mime_type,
                    blob,
                    ..
                } => McpResourceContent {
                    uri: content_uri,
                    mime_type,
                    text: None,
                    blob: Some(blob),
                },
            }
        } else {
            // 如果没有内容，返回空的资源内容
            McpResourceContent {
                uri: uri.to_string(),
                mime_type: None,
                text: None,
                blob: None,
            }
        }
    }
}

/// Tauri 状态包装器
pub type McpManagerState = Arc<tokio::sync::Mutex<McpClientManager>>;

/// 创建 MCP 管理器状态
pub fn create_mcp_manager_state(emitter: Option<DynEmitter>) -> McpManagerState {
    Arc::new(tokio::sync::Mutex::new(McpClientManager::new(emitter)))
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 创建测试用的服务器配置
    fn create_test_config() -> McpServerConfig {
        McpServerConfig {
            command: "test-command".to_string(),
            args: vec!["--arg1".to_string(), "--arg2".to_string()],
            env: HashMap::new(),
            cwd: None,
            timeout: 30,
        }
    }

    /// 创建测试用的客户端包装器
    fn create_test_client(name: &str) -> McpClientWrapper {
        McpClientWrapper::new(name.to_string(), create_test_config(), None)
    }

    fn create_test_tool(name: &str, description: &str, server_name: &str) -> McpToolDefinition {
        McpToolDefinition {
            name: name.to_string(),
            description: description.to_string(),
            input_schema: serde_json::json!({}),
            server_name: server_name.to_string(),
            deferred_loading: None,
            always_visible: None,
            allowed_callers: None,
            input_examples: None,
            tags: None,
        }
    }

    #[test]
    fn test_manager_creation() {
        let manager = McpClientManager::new(None);
        // 验证初始状态
        assert!(manager.emitter.is_none());
    }

    #[tokio::test]
    async fn test_initial_state() {
        let manager = McpClientManager::new(None);

        // 验证连接池为空
        assert_eq!(manager.running_server_count().await, 0);
        assert!(manager.get_running_servers().await.is_empty());

        // 验证缓存无效
        assert!(!manager.is_tool_cache_valid().await);
        assert!(manager.get_cached_tools().await.is_none());
    }

    #[tokio::test]
    async fn test_add_client() {
        let manager = McpClientManager::new(None);
        let client = create_test_client("test-server");

        // 添加客户端
        let result = manager.add_client("test-server".to_string(), client).await;
        assert!(result.is_ok());

        // 验证客户端已添加
        assert!(manager.is_server_running("test-server").await);
        assert_eq!(manager.running_server_count().await, 1);
    }

    #[tokio::test]
    async fn test_add_duplicate_client() {
        let manager = McpClientManager::new(None);
        let client1 = create_test_client("test-server");
        let client2 = create_test_client("test-server");

        // 添加第一个客户端
        manager
            .add_client("test-server".to_string(), client1)
            .await
            .unwrap();

        // 尝试添加重复的客户端
        let result = manager.add_client("test-server".to_string(), client2).await;
        assert!(result.is_err());

        // 验证错误类型
        match result {
            Err(McpError::ServerAlreadyRunning(name)) => {
                assert_eq!(name, "test-server");
            }
            _ => panic!("Expected ServerAlreadyRunning error"),
        }
    }

    #[tokio::test]
    async fn test_remove_client() {
        let manager = McpClientManager::new(None);
        let client = create_test_client("test-server");

        // 添加客户端
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 移除客户端
        let removed = manager.remove_client("test-server").await;
        assert!(removed.is_some());

        // 验证客户端已移除
        assert!(!manager.is_server_running("test-server").await);
        assert_eq!(manager.running_server_count().await, 0);
    }

    #[tokio::test]
    async fn test_remove_nonexistent_client() {
        let manager = McpClientManager::new(None);

        // 尝试移除不存在的客户端
        let removed = manager.remove_client("nonexistent").await;
        assert!(removed.is_none());
    }

    #[tokio::test]
    async fn test_has_client_and_get_config() {
        let manager = McpClientManager::new(None);
        let client = create_test_client("test-server");

        // 添加客户端
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 检查客户端是否存在
        assert!(manager.has_client("test-server").await);
        assert!(!manager.has_client("nonexistent").await);

        // 获取客户端配置
        let config = manager.get_client_config("test-server").await;
        assert!(config.is_some());
        assert_eq!(config.unwrap().command, "test-command");

        // 获取不存在的客户端配置
        let nonexistent_config = manager.get_client_config("nonexistent").await;
        assert!(nonexistent_config.is_none());
    }

    #[tokio::test]
    async fn test_get_running_servers() {
        let manager = McpClientManager::new(None);

        // 添加多个客户端
        manager
            .add_client("server1".to_string(), create_test_client("server1"))
            .await
            .unwrap();
        manager
            .add_client("server2".to_string(), create_test_client("server2"))
            .await
            .unwrap();
        manager
            .add_client("server3".to_string(), create_test_client("server3"))
            .await
            .unwrap();

        // 获取运行中的服务器列表
        let servers = manager.get_running_servers().await;
        assert_eq!(servers.len(), 3);
        assert!(servers.contains(&"server1".to_string()));
        assert!(servers.contains(&"server2".to_string()));
        assert!(servers.contains(&"server3".to_string()));
    }

    #[tokio::test]
    async fn test_tool_cache_operations() {
        let manager = McpClientManager::new(None);

        // 初始状态：缓存无效
        assert!(!manager.is_tool_cache_valid().await);
        assert!(manager.get_cached_tools().await.is_none());

        // 更新缓存
        let tools = vec![
            create_test_tool("tool1", "Test tool 1", "server1"),
            create_test_tool("tool2", "Test tool 2", "server1"),
        ];
        manager.update_tool_cache(tools.clone()).await;

        // 验证缓存有效
        assert!(manager.is_tool_cache_valid().await);
        let cached = manager.get_cached_tools().await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().len(), 2);

        // 失效缓存
        manager.invalidate_tool_cache().await;

        // 验证缓存已失效
        assert!(!manager.is_tool_cache_valid().await);
        assert!(manager.get_cached_tools().await.is_none());
    }

    #[tokio::test]
    async fn test_is_server_running() {
        let manager = McpClientManager::new(None);

        // 初始状态：没有服务器运行
        assert!(!manager.is_server_running("test-server").await);

        // 添加客户端
        manager
            .add_client("test-server".to_string(), create_test_client("test-server"))
            .await
            .unwrap();

        // 验证服务器正在运行
        assert!(manager.is_server_running("test-server").await);

        // 移除客户端
        manager.remove_client("test-server").await;

        // 验证服务器不再运行
        assert!(!manager.is_server_running("test-server").await);
    }

    #[test]
    fn test_create_mcp_manager_state() {
        let state = create_mcp_manager_state(None);
        // 验证状态已创建
        assert!(Arc::strong_count(&state) >= 1);
    }

    #[test]
    fn test_extract_tool_metadata_from_schema_extension() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {},
            "x-lime": {
                "deferred_loading": true,
                "always_visible": false,
                "allowed_callers": ["assistant", "code_execution"],
                "input_examples": [{"q": "rust"}],
                "tags": ["search", "docs"]
            }
        });
        let meta = McpClientManager::extract_tool_metadata("docs_search", &schema);
        assert_eq!(meta.deferred_loading, Some(true));
        assert_eq!(meta.always_visible, Some(false));
        assert_eq!(
            meta.allowed_callers.unwrap_or_default(),
            vec!["assistant".to_string(), "code_execution".to_string()]
        );
        assert_eq!(meta.input_examples.len(), 1);
        assert_eq!(
            meta.tags.unwrap_or_default(),
            vec!["search".to_string(), "docs".to_string()]
        );
    }

    // ========================================================================
    // 服务器生命周期测试
    // ========================================================================

    #[tokio::test]
    async fn test_start_server_already_running() {
        let manager = McpClientManager::new(None);

        // 先添加一个客户端模拟已运行的服务器
        let client = create_test_client("test-server");
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 尝试启动已运行的服务器
        let config = create_test_config();
        let result = manager.start_server("test-server", &config).await;

        // 应该返回 ServerAlreadyRunning 错误
        assert!(result.is_err());
        match result {
            Err(McpError::ServerAlreadyRunning(name)) => {
                assert_eq!(name, "test-server");
            }
            _ => panic!("Expected ServerAlreadyRunning error"),
        }
    }

    #[tokio::test]
    async fn test_start_server_invalid_command() {
        let manager = McpClientManager::new(None);

        // 使用不存在的命令
        let config = McpServerConfig {
            command: "/nonexistent/command/that/does/not/exist".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
            timeout: 5,
        };

        let result = manager.start_server("test-server", &config).await;

        // 应该返回 ProcessSpawnFailed 错误
        assert!(result.is_err());
        match result {
            Err(McpError::ProcessSpawnFailed(_)) => {}
            Err(e) => panic!("Expected ProcessSpawnFailed error, got: {:?}", e),
            Ok(_) => panic!("Expected error, but got Ok"),
        }
    }

    #[tokio::test]
    async fn test_stop_server_not_running() {
        let manager = McpClientManager::new(None);

        // 停止未运行的服务器（幂等操作，应该成功）
        let result = manager.stop_server("nonexistent-server").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_stop_server_removes_from_pool() {
        let manager = McpClientManager::new(None);

        // 添加一个客户端
        let client = create_test_client("test-server");
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 验证服务器在运行
        assert!(manager.is_server_running("test-server").await);

        // 停止服务器
        let result = manager.stop_server("test-server").await;
        assert!(result.is_ok());

        // 验证服务器已停止
        assert!(!manager.is_server_running("test-server").await);
    }

    #[tokio::test]
    async fn test_stop_server_invalidates_cache() {
        let manager = McpClientManager::new(None);

        // 添加一个客户端
        let client = create_test_client("test-server");
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 设置工具缓存
        let tools = vec![create_test_tool("tool1", "Test tool", "test-server")];
        manager.update_tool_cache(tools).await;
        assert!(manager.is_tool_cache_valid().await);

        // 停止服务器
        manager.stop_server("test-server").await.unwrap();

        // 验证缓存已失效
        assert!(!manager.is_tool_cache_valid().await);
    }

    #[tokio::test]
    async fn test_restart_server_stops_then_starts() {
        let manager = McpClientManager::new(None);

        // 添加一个客户端模拟已运行的服务器
        let client = create_test_client("test-server");
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 使用无效命令重启（会失败在启动阶段）
        let config = McpServerConfig {
            command: "/nonexistent/command".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
            timeout: 5,
        };

        // 重启应该先停止成功，然后启动失败
        let result = manager.restart_server("test-server", &config).await;
        assert!(result.is_err());

        // 验证服务器已被停止（即使启动失败）
        assert!(!manager.is_server_running("test-server").await);
    }

    // ========================================================================
    // 工具名称冲突解决测试（Task 4.3）
    // ========================================================================

    #[test]
    fn test_apply_runtime_tool_names_prefixes_all_tools() {
        let tools = vec![
            create_test_tool("tool1", "Tool 1", "server1"),
            create_test_tool("tool2", "Tool 2", "server2"),
        ];

        let resolved = McpClientManager::apply_runtime_tool_names(tools);

        assert_eq!(resolved.len(), 2);
        assert!(resolved.iter().any(|t| t.name == "mcp__server1__tool1"));
        assert!(resolved.iter().any(|t| t.name == "mcp__server2__tool2"));
    }

    #[test]
    fn test_apply_runtime_tool_names_keeps_distinct_servers_for_same_tool() {
        let tools = vec![
            create_test_tool("read_file", "Read file from server1", "server1"),
            create_test_tool("read_file", "Read file from server2", "server2"),
            create_test_tool("unique_tool", "Unique tool", "server1"),
        ];

        let resolved = McpClientManager::apply_runtime_tool_names(tools);

        assert_eq!(resolved.len(), 3);
        assert!(resolved.iter().any(|t| t.name == "mcp__server1__read_file"));
        assert!(resolved.iter().any(|t| t.name == "mcp__server2__read_file"));
        assert!(resolved
            .iter()
            .any(|t| t.name == "mcp__server1__unique_tool"));
    }

    #[test]
    fn test_apply_runtime_tool_names_supports_multiple_same_name_tools() {
        let tools = vec![
            create_test_tool("tool_a", "Tool A from server1", "server1"),
            create_test_tool("tool_a", "Tool A from server2", "server2"),
            create_test_tool("tool_a", "Tool A from server3", "server3"),
        ];

        let resolved = McpClientManager::apply_runtime_tool_names(tools);

        assert_eq!(resolved.len(), 3);
        assert!(resolved.iter().any(|t| t.name == "mcp__server1__tool_a"));
        assert!(resolved.iter().any(|t| t.name == "mcp__server2__tool_a"));
        assert!(resolved.iter().any(|t| t.name == "mcp__server3__tool_a"));
    }

    #[test]
    fn test_apply_runtime_tool_names_empty_list() {
        let tools: Vec<McpToolDefinition> = vec![];
        let resolved = McpClientManager::apply_runtime_tool_names(tools);
        assert!(resolved.is_empty());
    }

    #[test]
    fn test_apply_default_loading_policy_auto_defers_large_server_tools() {
        let tools = (0..7)
            .map(|index| McpToolDefinition {
                name: format!("tool_{index}"),
                description: format!("tool {index}"),
                input_schema: serde_json::json!({}),
                server_name: "large-server".to_string(),
                deferred_loading: None,
                always_visible: if index == 0 { Some(true) } else { None },
                allowed_callers: None,
                input_examples: None,
                tags: None,
            })
            .collect::<Vec<_>>();

        let resolved = McpClientManager::apply_default_loading_policy(tools);
        assert_eq!(resolved.len(), 7);
        assert_eq!(resolved[0].deferred_loading, Some(false));
        assert!(resolved
            .iter()
            .skip(1)
            .all(|tool| tool.deferred_loading == Some(true)));
    }

    #[test]
    fn test_apply_runtime_tool_names_preserves_metadata_fields() {
        let mut tool_a = create_test_tool("search", "Search docs", "server1");
        tool_a.deferred_loading = Some(true);
        tool_a.always_visible = Some(true);
        tool_a.allowed_callers = Some(vec!["assistant".to_string()]);
        tool_a.tags = Some(vec!["docs".to_string()]);
        tool_a.input_examples = Some(vec![serde_json::json!({ "query": "rust" })]);

        let mut tool_b = create_test_tool("search", "Search issues", "server2");
        tool_b.deferred_loading = Some(false);
        tool_b.always_visible = Some(false);
        tool_b.allowed_callers = Some(vec!["code_execution".to_string()]);
        tool_b.tags = Some(vec!["issues".to_string()]);
        tool_b.input_examples = Some(vec![serde_json::json!({ "query": "bug" })]);

        let resolved = McpClientManager::apply_runtime_tool_names(vec![tool_a, tool_b]);
        let server1 = resolved
            .iter()
            .find(|tool| tool.name == "mcp__server1__search")
            .expect("server1 tool should be renamed");
        let server2 = resolved
            .iter()
            .find(|tool| tool.name == "mcp__server2__search")
            .expect("server2 tool should be renamed");

        assert_eq!(server1.deferred_loading, Some(true));
        assert_eq!(server1.always_visible, Some(true));
        assert_eq!(server1.allowed_callers, Some(vec!["assistant".to_string()]));
        assert_eq!(server1.tags, Some(vec!["docs".to_string()]));
        assert_eq!(
            server1.input_examples,
            Some(vec![serde_json::json!({ "query": "rust" })])
        );

        assert_eq!(server2.deferred_loading, Some(false));
        assert_eq!(server2.always_visible, Some(false));
        assert_eq!(
            server2.allowed_callers,
            Some(vec!["code_execution".to_string()])
        );
        assert_eq!(server2.tags, Some(vec!["issues".to_string()]));
        assert_eq!(
            server2.input_examples,
            Some(vec![serde_json::json!({ "query": "bug" })])
        );
    }

    #[test]
    fn test_apply_default_loading_policy_respects_threshold_boundary_and_explicit_values() {
        let threshold_tools = (0..AUTO_DEFER_TOOL_COUNT_THRESHOLD)
            .map(|index| McpToolDefinition {
                name: format!("threshold_{index}"),
                description: format!("threshold {index}"),
                input_schema: serde_json::json!({}),
                server_name: "threshold-server".to_string(),
                deferred_loading: None,
                always_visible: None,
                allowed_callers: None,
                input_examples: None,
                tags: None,
            })
            .collect::<Vec<_>>();

        let mut large_tools = (0..5)
            .map(|index| McpToolDefinition {
                name: format!("auto_{index}"),
                description: format!("auto {index}"),
                input_schema: serde_json::json!({}),
                server_name: "large-server".to_string(),
                deferred_loading: None,
                always_visible: None,
                allowed_callers: None,
                input_examples: None,
                tags: None,
            })
            .collect::<Vec<_>>();

        large_tools.push(McpToolDefinition {
            name: "explicit_false".to_string(),
            description: "explicit false".to_string(),
            input_schema: serde_json::json!({}),
            server_name: "large-server".to_string(),
            deferred_loading: Some(false),
            always_visible: None,
            allowed_callers: None,
            input_examples: None,
            tags: None,
        });
        large_tools.push(McpToolDefinition {
            name: "explicit_true".to_string(),
            description: "explicit true".to_string(),
            input_schema: serde_json::json!({}),
            server_name: "large-server".to_string(),
            deferred_loading: Some(true),
            always_visible: None,
            allowed_callers: None,
            input_examples: None,
            tags: None,
        });

        let mut all_tools = threshold_tools;
        all_tools.extend(large_tools);

        let resolved = McpClientManager::apply_default_loading_policy(all_tools);

        assert!(resolved
            .iter()
            .filter(|tool| tool.server_name == "threshold-server")
            .all(|tool| tool.deferred_loading == Some(false)));

        let explicit_false = resolved
            .iter()
            .find(|tool| tool.name == "explicit_false")
            .expect("explicit false tool should exist");
        assert_eq!(explicit_false.deferred_loading, Some(false));

        let explicit_true = resolved
            .iter()
            .find(|tool| tool.name == "explicit_true")
            .expect("explicit true tool should exist");
        assert_eq!(explicit_true.deferred_loading, Some(true));

        assert!(resolved
            .iter()
            .filter(|tool| tool.server_name == "large-server" && tool.name.starts_with("auto_"))
            .all(|tool| tool.deferred_loading == Some(true)));
    }

    // ========================================================================
    // 工具列表缓存测试（Task 4.3）
    // ========================================================================

    #[tokio::test]
    async fn test_list_tools_returns_cached_when_valid() {
        let manager = McpClientManager::new(None);

        // 预先设置缓存
        let cached_tools = vec![create_test_tool(
            "mcp__cached_server__cached_tool",
            "Cached tool",
            "cached_server",
        )];
        manager.update_tool_cache(cached_tools.clone()).await;

        // 调用 list_tools 应该返回缓存的工具
        let result = manager.list_tools().await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "mcp__cached_server__cached_tool");
    }

    #[tokio::test]
    async fn test_list_tools_for_context_filters_deferred_and_caller() {
        let manager = McpClientManager::new(None);
        manager
            .update_tool_cache(vec![
                create_test_tool("mcp__s1__always_tool", "always", "s1"),
                McpToolDefinition {
                    name: "mcp__s1__hidden_tool".to_string(),
                    description: "hidden".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(true),
                    always_visible: Some(false),
                    allowed_callers: Some(vec!["code_execution".to_string()]),
                    input_examples: None,
                    tags: None,
                },
                McpToolDefinition {
                    name: "mcp__s1__visible_deferred".to_string(),
                    description: "visible deferred".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(true),
                    always_visible: Some(true),
                    allowed_callers: Some(vec!["assistant".to_string()]),
                    input_examples: None,
                    tags: None,
                },
            ])
            .await;

        let assistant_tools = manager
            .list_tools_for_context(Some("assistant"), false)
            .await
            .unwrap();
        assert!(assistant_tools
            .iter()
            .any(|t| t.name == "mcp__s1__always_tool"));
        assert!(assistant_tools
            .iter()
            .any(|t| t.name == "mcp__s1__visible_deferred"));
        assert!(!assistant_tools
            .iter()
            .any(|t| t.name == "mcp__s1__hidden_tool"));

        let code_exec_tools = manager
            .list_tools_for_context(Some("code_execution"), true)
            .await
            .unwrap();
        assert!(code_exec_tools
            .iter()
            .any(|t| t.name == "mcp__s1__hidden_tool"));
    }

    #[tokio::test]
    async fn test_search_tools_prioritizes_exact_match() {
        let manager = McpClientManager::new(None);
        manager
            .update_tool_cache(vec![
                McpToolDefinition {
                    name: "mcp__s1__weather".to_string(),
                    description: "Get weather".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(true),
                    always_visible: Some(false),
                    allowed_callers: None,
                    input_examples: None,
                    tags: Some(vec!["forecast".to_string()]),
                },
                McpToolDefinition {
                    name: "mcp__s1__get_weather".to_string(),
                    description: "weather by city".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(true),
                    always_visible: Some(false),
                    allowed_callers: None,
                    input_examples: None,
                    tags: Some(vec!["weather".to_string()]),
                },
            ])
            .await;

        let tools = manager
            .search_tools("weather", 5, Some("assistant"))
            .await
            .unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "mcp__s1__weather");
    }

    #[tokio::test]
    async fn test_search_tools_empty_query_prioritizes_always_visible_then_name() {
        let manager = McpClientManager::new(None);
        manager
            .update_tool_cache(vec![
                McpToolDefinition {
                    name: "mcp__s1__alpha".to_string(),
                    description: "alpha".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(false),
                    always_visible: Some(false),
                    allowed_callers: None,
                    input_examples: None,
                    tags: None,
                },
                McpToolDefinition {
                    name: "mcp__s1__zeta".to_string(),
                    description: "zeta".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(true),
                    always_visible: Some(true),
                    allowed_callers: None,
                    input_examples: None,
                    tags: None,
                },
                McpToolDefinition {
                    name: "mcp__s1__beta".to_string(),
                    description: "beta".to_string(),
                    input_schema: serde_json::json!({}),
                    server_name: "s1".to_string(),
                    deferred_loading: Some(false),
                    always_visible: Some(true),
                    allowed_callers: None,
                    input_examples: None,
                    tags: None,
                },
            ])
            .await;

        let tools = manager
            .search_tools("", 2, Some("assistant"))
            .await
            .expect("empty query search should succeed");

        assert_eq!(tools.len(), 2);
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            vec!["mcp__s1__beta", "mcp__s1__zeta"]
        );
    }

    #[tokio::test]
    async fn test_call_tool_with_caller_rejects_unauthorized_caller() {
        let manager = McpClientManager::new(None);
        manager
            .update_tool_cache(vec![McpToolDefinition {
                name: "mcp__s1__restricted".to_string(),
                description: "Restricted tool".to_string(),
                input_schema: serde_json::json!({}),
                server_name: "s1".to_string(),
                deferred_loading: None,
                always_visible: None,
                allowed_callers: Some(vec!["code_execution".to_string()]),
                input_examples: None,
                tags: None,
            }])
            .await;

        let result = manager
            .call_tool_with_caller(
                "mcp__s1__restricted",
                serde_json::json!({}),
                Some("assistant"),
            )
            .await;
        assert!(result.is_err());
        match result {
            Err(McpError::ToolCallFailed(message)) => {
                assert!(message.contains("无权调用"));
            }
            _ => panic!("Expected ToolCallFailed"),
        }
    }

    #[tokio::test]
    async fn test_list_tools_returns_empty_when_no_servers() {
        let manager = McpClientManager::new(None);

        // 没有运行的服务器时，应该返回空列表
        let result = manager.list_tools().await.unwrap();
        assert!(result.is_empty());
    }

    // ========================================================================
    // 工具调用测试（Task 4.3）
    // ========================================================================

    #[tokio::test]
    async fn test_call_tool_not_found() {
        let manager = McpClientManager::new(None);

        // 调用不存在的工具
        let result = manager
            .call_tool("mcp__missing__nonexistent_tool", serde_json::json!({}))
            .await;

        // 应该返回 ToolNotFound 错误
        assert!(result.is_err());
        match result {
            Err(McpError::ToolNotFound(name)) => {
                assert_eq!(name, "mcp__missing__nonexistent_tool");
            }
            _ => panic!("Expected ToolNotFound error"),
        }
    }

    #[tokio::test]
    async fn test_call_tool_invalid_arguments() {
        let manager = McpClientManager::new(None);

        // 添加一个客户端
        let client = create_test_client("test-server");
        manager
            .add_client("test-server".to_string(), client)
            .await
            .unwrap();

        // 使用非对象参数调用工具
        let result = manager
            .call_tool("mcp__test-server__some_tool", serde_json::json!("invalid"))
            .await;

        // 应该返回错误（参数必须是对象或 null）
        assert!(result.is_err());
    }

    // ========================================================================
    // 内容转换测试（Task 4.3）
    // ========================================================================

    #[test]
    fn test_convert_content_text() {
        let content = rmcp::model::Content::text("Hello, World!");
        let mcp_content = McpClientManager::convert_content(content);

        match mcp_content {
            McpContent::Text { text } => {
                assert_eq!(text, "Hello, World!");
            }
            _ => panic!("Expected Text content"),
        }
    }

    #[test]
    fn test_convert_content_image() {
        let content = rmcp::model::Content::image("base64data", "image/png");
        let mcp_content = McpClientManager::convert_content(content);

        match mcp_content {
            McpContent::Image { data, mime_type } => {
                assert_eq!(data, "base64data");
                assert_eq!(mime_type, "image/png");
            }
            _ => panic!("Expected Image content"),
        }
    }

    // ========================================================================
    // 提示词管理测试（Task 4.4）
    // ========================================================================

    #[tokio::test]
    async fn test_list_prompts_returns_empty_when_no_servers() {
        let manager = McpClientManager::new(None);

        // 没有运行的服务器时，应该返回空列表
        let result = manager.list_prompts().await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn test_get_prompt_not_found() {
        let manager = McpClientManager::new(None);

        // 获取不存在的提示词
        let result = manager
            .get_prompt("nonexistent_prompt", serde_json::Map::new())
            .await;

        // 应该返回错误
        assert!(result.is_err());
        match result {
            Err(McpError::ToolNotFound(msg)) => {
                assert!(msg.contains("nonexistent_prompt"));
            }
            _ => panic!("Expected ToolNotFound error"),
        }
    }

    #[test]
    fn test_convert_prompt_to_definition() {
        // 创建一个 rmcp Prompt
        let prompt = rmcp::model::Prompt {
            name: "test_prompt".into(),
            title: Some("Test Prompt Title".into()),
            description: Some("A test prompt description".into()),
            arguments: Some(vec![
                rmcp::model::PromptArgument {
                    name: "arg1".to_string(),
                    title: None,
                    description: Some("First argument".to_string()),
                    required: Some(true),
                },
                rmcp::model::PromptArgument {
                    name: "arg2".to_string(),
                    title: None,
                    description: Some("Second argument".to_string()),
                    required: Some(false),
                },
            ]),
            icons: None,
            meta: None,
        };

        // 转换为 McpPromptDefinition
        let definition =
            McpClientManager::convert_prompt_to_definition(prompt, "test_server".to_string());

        // 验证转换结果
        assert_eq!(definition.name, "test_prompt");
        assert_eq!(
            definition.description,
            Some("A test prompt description".to_string())
        );
        assert_eq!(definition.server_name, "test_server");
        assert_eq!(definition.arguments.len(), 2);

        // 验证第一个参数
        assert_eq!(definition.arguments[0].name, "arg1");
        assert_eq!(
            definition.arguments[0].description,
            Some("First argument".to_string())
        );
        assert!(definition.arguments[0].required);

        // 验证第二个参数
        assert_eq!(definition.arguments[1].name, "arg2");
        assert_eq!(
            definition.arguments[1].description,
            Some("Second argument".to_string())
        );
        assert!(!definition.arguments[1].required);
    }

    #[test]
    fn test_convert_prompt_to_definition_no_arguments() {
        // 创建一个没有参数的 rmcp Prompt
        let prompt = rmcp::model::Prompt {
            name: "simple_prompt".into(),
            title: None,
            description: None,
            arguments: None,
            icons: None,
            meta: None,
        };

        // 转换为 McpPromptDefinition
        let definition =
            McpClientManager::convert_prompt_to_definition(prompt, "server1".to_string());

        // 验证转换结果
        assert_eq!(definition.name, "simple_prompt");
        assert!(definition.description.is_none());
        assert_eq!(definition.server_name, "server1");
        assert!(definition.arguments.is_empty());
    }

    #[test]
    fn test_convert_prompt_message_user() {
        // 创建一个用户消息
        let msg = rmcp::model::PromptMessage::new_text(
            rmcp::model::PromptMessageRole::User,
            "Hello, assistant!",
        );

        // 转换为 McpPromptMessage
        let mcp_msg = McpClientManager::convert_prompt_message(msg);

        // 验证转换结果
        assert_eq!(mcp_msg.role, "user");
        match mcp_msg.content {
            McpContent::Text { text } => {
                assert_eq!(text, "Hello, assistant!");
            }
            _ => panic!("Expected Text content"),
        }
    }

    #[test]
    fn test_convert_prompt_message_assistant() {
        // 创建一个助手消息
        let msg = rmcp::model::PromptMessage::new_text(
            rmcp::model::PromptMessageRole::Assistant,
            "Hello, user!",
        );

        // 转换为 McpPromptMessage
        let mcp_msg = McpClientManager::convert_prompt_message(msg);

        // 验证转换结果
        assert_eq!(mcp_msg.role, "assistant");
        match mcp_msg.content {
            McpContent::Text { text } => {
                assert_eq!(text, "Hello, user!");
            }
            _ => panic!("Expected Text content"),
        }
    }

    #[test]
    fn test_convert_prompt_message_content_text() {
        // 创建文本内容
        let content = rmcp::model::PromptMessageContent::Text {
            text: "Test text content".to_string(),
        };

        // 转换为 McpContent
        let mcp_content = McpClientManager::convert_prompt_message_content(content);

        // 验证转换结果
        match mcp_content {
            McpContent::Text { text } => {
                assert_eq!(text, "Test text content");
            }
            _ => panic!("Expected Text content"),
        }
    }

    #[test]
    fn test_convert_get_prompt_result() {
        // 创建 GetPromptResult
        let result = rmcp::model::GetPromptResult {
            description: Some("Test prompt result".into()),
            messages: vec![
                rmcp::model::PromptMessage::new_text(
                    rmcp::model::PromptMessageRole::User,
                    "User message",
                ),
                rmcp::model::PromptMessage::new_text(
                    rmcp::model::PromptMessageRole::Assistant,
                    "Assistant response",
                ),
            ],
        };

        // 转换为 McpPromptResult
        let mcp_result = McpClientManager::convert_get_prompt_result(result);

        // 验证转换结果
        assert_eq!(
            mcp_result.description,
            Some("Test prompt result".to_string())
        );
        assert_eq!(mcp_result.messages.len(), 2);
        assert_eq!(mcp_result.messages[0].role, "user");
        assert_eq!(mcp_result.messages[1].role, "assistant");
    }

    // ========================================================================
    // 资源管理测试（Task 4.5）
    // ========================================================================

    #[tokio::test]
    async fn test_list_resources_returns_empty_when_no_servers() {
        let manager = McpClientManager::new(None);

        // 没有运行的服务器时，应该返回空列表
        let result = manager.list_resources().await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn test_read_resource_not_found() {
        let manager = McpClientManager::new(None);

        // 读取不存在的资源
        let result = manager.read_resource("file:///nonexistent/resource").await;

        // 应该返回错误
        assert!(result.is_err());
        match result {
            Err(McpError::ToolNotFound(msg)) => {
                assert!(msg.contains("资源不存在"));
            }
            _ => panic!("Expected ToolNotFound error"),
        }
    }

    #[test]
    fn test_convert_resource_to_definition() {
        use rmcp::model::{AnnotateAble, RawResource};

        // 创建一个 rmcp Resource
        let raw_resource = RawResource {
            uri: "file:///test/resource.txt".to_string(),
            name: "resource.txt".to_string(),
            title: Some("Test Resource".to_string()),
            description: Some("A test resource".to_string()),
            mime_type: Some("text/plain".to_string()),
            size: Some(1024),
            icons: None,
            meta: None,
        };
        let resource = raw_resource.no_annotation();

        // 转换为 McpResourceDefinition
        let definition =
            McpClientManager::convert_resource_to_definition(resource, "test_server".to_string());

        // 验证转换结果
        assert_eq!(definition.uri, "file:///test/resource.txt");
        assert_eq!(definition.name, "resource.txt");
        assert_eq!(definition.description, Some("A test resource".to_string()));
        assert_eq!(definition.mime_type, Some("text/plain".to_string()));
        assert_eq!(definition.server_name, "test_server");
    }

    #[test]
    fn test_convert_resource_to_definition_minimal() {
        use rmcp::model::{AnnotateAble, RawResource};

        // 创建一个最小的 rmcp Resource（只有必需字段）
        let raw_resource =
            RawResource::new("file:///minimal.txt".to_string(), "minimal.txt".to_string());
        let resource = raw_resource.no_annotation();

        // 转换为 McpResourceDefinition
        let definition =
            McpClientManager::convert_resource_to_definition(resource, "server1".to_string());

        // 验证转换结果
        assert_eq!(definition.uri, "file:///minimal.txt");
        assert_eq!(definition.name, "minimal.txt");
        assert!(definition.description.is_none());
        assert!(definition.mime_type.is_none());
        assert_eq!(definition.server_name, "server1");
    }

    #[test]
    fn test_convert_read_resource_result_text() {
        // 创建文本资源内容
        let result = rmcp::model::ReadResourceResult {
            contents: vec![rmcp::model::ResourceContents::text(
                "Hello, World!",
                "file:///test.txt",
            )],
        };

        // 转换为 McpResourceContent
        let mcp_content =
            McpClientManager::convert_read_resource_result("file:///test.txt", result);

        // 验证转换结果
        assert_eq!(mcp_content.uri, "file:///test.txt");
        assert_eq!(mcp_content.mime_type, Some("text".to_string()));
        assert_eq!(mcp_content.text, Some("Hello, World!".to_string()));
        assert!(mcp_content.blob.is_none());
    }

    #[test]
    fn test_convert_read_resource_result_blob() {
        // 创建二进制资源内容
        let result = rmcp::model::ReadResourceResult {
            contents: vec![rmcp::model::ResourceContents::BlobResourceContents {
                uri: "file:///test.bin".to_string(),
                mime_type: Some("application/octet-stream".to_string()),
                blob: "base64encodeddata".to_string(),
                meta: None,
            }],
        };

        // 转换为 McpResourceContent
        let mcp_content =
            McpClientManager::convert_read_resource_result("file:///test.bin", result);

        // 验证转换结果
        assert_eq!(mcp_content.uri, "file:///test.bin");
        assert_eq!(
            mcp_content.mime_type,
            Some("application/octet-stream".to_string())
        );
        assert!(mcp_content.text.is_none());
        assert_eq!(mcp_content.blob, Some("base64encodeddata".to_string()));
    }

    #[test]
    fn test_convert_read_resource_result_empty() {
        // 创建空的资源结果
        let result = rmcp::model::ReadResourceResult { contents: vec![] };

        // 转换为 McpResourceContent
        let mcp_content =
            McpClientManager::convert_read_resource_result("file:///empty.txt", result);

        // 验证转换结果（应该返回空内容）
        assert_eq!(mcp_content.uri, "file:///empty.txt");
        assert!(mcp_content.mime_type.is_none());
        assert!(mcp_content.text.is_none());
        assert!(mcp_content.blob.is_none());
    }
}
