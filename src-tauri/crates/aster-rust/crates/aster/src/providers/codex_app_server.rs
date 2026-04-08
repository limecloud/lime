//! Codex app-server 协议实现
//!
//! 该模块实现了与 Codex CLI 的 app-server 模式通信，
//! 支持会话持久化和上下文连贯。
//!
//! 协议基于 JSON-RPC 2.0 over stdio，主要方法：
//! - initialize: 初始化连接
//! - thread/start: 创建新会话
//! - thread/resume: 恢复已有会话
//! - turn/start: 发送用户消息
//! - turn/interrupt: 中断当前回合

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::errors::ProviderError;

/// JSON-RPC 请求 ID 生成器
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

fn next_request_id() -> u64 {
    REQUEST_ID.fetch_add(1, Ordering::SeqCst)
}

fn normalize_thread_start_sandbox_mode(sandbox_policy: &str) -> Option<&'static str> {
    match sandbox_policy.trim() {
        "read-only" => Some("readOnly"),
        "workspace-write" => Some("workspaceWrite"),
        "danger-full-access" => Some("dangerFullAccess"),
        _ => None,
    }
}

fn build_turn_start_sandbox_policy(sandbox_policy: &str) -> Option<Value> {
    normalize_thread_start_sandbox_mode(sandbox_policy).map(|policy_type| {
        json!({
            "type": policy_type
        })
    })
}

fn resolve_codex_runtime_policies() -> (String, String) {
    let turn_context = crate::session_context::current_turn_context();
    let approval_policy = turn_context
        .as_ref()
        .and_then(|context| context.approval_policy.clone())
        .unwrap_or_else(|| "never".to_string());
    let sandbox_policy = turn_context
        .as_ref()
        .and_then(|context| context.sandbox_policy.clone())
        .unwrap_or_else(|| "workspace-write".to_string());

    (approval_policy, sandbox_policy)
}

fn build_turn_start_params(
    thread_id: &str,
    input_text: &str,
    model: Option<&str>,
    effort: Option<&str>,
) -> Value {
    let (approval_policy, sandbox_policy) = resolve_codex_runtime_policies();
    let mut params = json!({
        "threadId": thread_id,
        "input": [
            { "type": "text", "text": input_text }
        ],
        "approvalPolicy": approval_policy
    });

    if let Some(sandbox_policy) = build_turn_start_sandbox_policy(&sandbox_policy) {
        params["sandboxPolicy"] = sandbox_policy;
    }

    if let Some(m) = model {
        params["model"] = json!(m);
    }
    if let Some(e) = effort {
        params["effort"] = json!(e);
    }
    if let Some(turn_context) = crate::session_context::current_turn_context() {
        if let Some(output_schema) = turn_context.output_schema {
            params["outputSchema"] = output_schema;
        }
    }

    params
}

/// Thread 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadInfo {
    pub id: String,
    pub preview: Option<String>,
    #[serde(rename = "modelProvider")]
    pub model_provider: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<i64>,
}

/// Turn 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnInfo {
    pub id: String,
    pub status: String,
    pub items: Vec<TurnItem>,
    pub error: Option<String>,
}

/// Turn 中的 Item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TurnItem {
    #[serde(rename = "agentMessage")]
    AgentMessage {
        id: String,
        text: Option<String>,
        #[serde(default)]
        complete: bool,
    },
    #[serde(rename = "reasoning")]
    Reasoning {
        id: String,
        #[serde(default)]
        summary: Vec<String>,
        #[serde(default)]
        content: Vec<String>,
        #[serde(default)]
        complete: bool,
    },
    #[serde(rename = "toolCall")]
    ToolCall {
        id: String,
        name: Option<String>,
        #[serde(default)]
        complete: bool,
    },
    #[serde(other)]
    Unknown,
}

/// app-server 事件类型
#[derive(Debug, Clone)]
pub enum AppServerEvent {
    /// 线程已启动
    ThreadStarted(ThreadInfo),
    /// Turn 已启动
    TurnStarted(TurnInfo),
    /// Item 开始
    ItemStarted { item_id: String, item_type: String },
    /// Agent 消息增量
    AgentMessageDelta { item_id: String, text: String },
    /// Reasoning 摘要分段开始
    ReasoningSummaryPartAdded { item_id: String, summary_index: i64 },
    /// Reasoning 可读摘要增量
    ReasoningSummaryTextDelta {
        item_id: String,
        text: String,
        summary_index: i64,
    },
    /// Reasoning 原始内容增量
    ReasoningTextDelta {
        item_id: String,
        text: String,
        content_index: i64,
    },
    /// Item 完成
    ItemCompleted { item_id: String },
    /// Turn 完成
    TurnCompleted(TurnInfo),
    /// 错误
    Error(String),
    /// 未知事件
    Unknown(Value),
}

/// Codex app-server 连接管理器
pub struct CodexAppServerConnection {
    /// 子进程
    child: Child,
    /// stdin 写入器
    stdin: ChildStdin,
    /// stdout 读取器
    stdout_reader: BufReader<ChildStdout>,
    /// 当前 thread ID
    current_thread_id: Option<String>,
    /// 待处理的响应
    pending_responses: HashMap<u64, tokio::sync::oneshot::Sender<Result<Value, ProviderError>>>,
}

impl CodexAppServerConnection {
    /// 启动 app-server 进程
    pub fn spawn(command: &PathBuf, cwd: Option<&str>) -> Result<Self, ProviderError> {
        let mut cmd = Command::new(command);
        cmd.arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().map_err(|e| {
            ProviderError::RequestFailed(format!(
                "无法启动 Codex app-server: {}. 请确保已安装 Codex CLI (npm i -g @openai/codex)",
                e
            ))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ProviderError::RequestFailed("无法获取 app-server stdin".to_string()))?;

        let stdout = child.stdout.take().ok_or_else(|| {
            ProviderError::RequestFailed("无法获取 app-server stdout".to_string())
        })?;

        let stdout_reader = BufReader::new(stdout);

        Ok(Self {
            child,
            stdin,
            stdout_reader,
            current_thread_id: None,
            pending_responses: HashMap::new(),
        })
    }

    /// 发送 JSON-RPC 请求
    fn send_request(&mut self, method: &str, params: Value) -> Result<u64, ProviderError> {
        let id = next_request_id();
        let request = json!({
            "method": method,
            "id": id,
            "params": params
        });

        let request_str = serde_json::to_string(&request)
            .map_err(|e| ProviderError::RequestFailed(format!("序列化请求失败: {}", e)))?;

        writeln!(self.stdin, "{}", request_str)
            .map_err(|e| ProviderError::RequestFailed(format!("发送请求失败: {}", e)))?;

        self.stdin
            .flush()
            .map_err(|e| ProviderError::RequestFailed(format!("刷新 stdin 失败: {}", e)))?;

        tracing::debug!("发送请求: {} (id={})", method, id);
        Ok(id)
    }

    /// 发送通知（无需响应）
    fn send_notification(&mut self, method: &str, params: Value) -> Result<(), ProviderError> {
        let notification = json!({
            "method": method,
            "params": params
        });

        let notification_str = serde_json::to_string(&notification)
            .map_err(|e| ProviderError::RequestFailed(format!("序列化通知失败: {}", e)))?;

        writeln!(self.stdin, "{}", notification_str)
            .map_err(|e| ProviderError::RequestFailed(format!("发送通知失败: {}", e)))?;

        self.stdin
            .flush()
            .map_err(|e| ProviderError::RequestFailed(format!("刷新 stdin 失败: {}", e)))?;

        tracing::debug!("发送通知: {}", method);
        Ok(())
    }

    /// 读取一行响应
    fn read_line(&mut self) -> Result<String, ProviderError> {
        let mut line = String::new();
        self.stdout_reader
            .read_line(&mut line)
            .map_err(|e| ProviderError::RequestFailed(format!("读取响应失败: {}", e)))?;
        Ok(line.trim().to_string())
    }

    /// 解析 JSON-RPC 消息
    fn parse_message(&self, line: &str) -> Result<Value, ProviderError> {
        serde_json::from_str(line).map_err(|e| {
            ProviderError::RequestFailed(format!("解析 JSON 失败: {} (内容: {})", e, line))
        })
    }

    /// 初始化连接
    pub fn initialize(
        &mut self,
        client_name: &str,
        client_version: &str,
    ) -> Result<Value, ProviderError> {
        let params = json!({
            "clientInfo": {
                "name": client_name,
                "version": client_version
            }
        });

        let id = self.send_request("initialize", params)?;

        // 读取响应直到获得匹配的 result
        loop {
            let line = self.read_line()?;
            if line.is_empty() {
                continue;
            }

            let msg = self.parse_message(&line)?;

            // 检查是否是我们的响应
            if let Some(msg_id) = msg.get("id").and_then(|v| v.as_u64()) {
                if msg_id == id {
                    if let Some(error) = msg.get("error") {
                        return Err(ProviderError::RequestFailed(format!(
                            "initialize 失败: {}",
                            error
                        )));
                    }
                    let result = msg.get("result").cloned().unwrap_or(json!({}));

                    // 发送 initialized 通知
                    self.send_notification("initialized", json!({}))?;

                    return Ok(result);
                }
            }
        }
    }

    /// 启动新线程
    pub fn thread_start(
        &mut self,
        model: Option<&str>,
        cwd: Option<&str>,
        approval_policy: Option<&str>,
        sandbox: Option<&str>,
    ) -> Result<ThreadInfo, ProviderError> {
        let mut params = json!({});

        if let Some(m) = model {
            params["model"] = json!(m);
        }
        if let Some(dir) = cwd {
            params["cwd"] = json!(dir);
        }
        if let Some(policy) = approval_policy {
            params["approvalPolicy"] = json!(policy);
        }
        if let Some(sb) = sandbox {
            if let Some(sandbox_mode) = normalize_thread_start_sandbox_mode(sb) {
                params["sandbox"] = json!(sandbox_mode);
            }
        }

        let id = self.send_request("thread/start", params)?;

        // 读取响应
        loop {
            let line = self.read_line()?;
            if line.is_empty() {
                continue;
            }

            let msg = self.parse_message(&line)?;

            // 检查是否是我们的响应
            if let Some(msg_id) = msg.get("id").and_then(|v| v.as_u64()) {
                if msg_id == id {
                    if let Some(error) = msg.get("error") {
                        return Err(ProviderError::RequestFailed(format!(
                            "thread/start 失败: {}",
                            error
                        )));
                    }

                    let thread: ThreadInfo = serde_json::from_value(
                        msg.get("result")
                            .and_then(|r| r.get("thread"))
                            .cloned()
                            .unwrap_or(json!({})),
                    )
                    .map_err(|e| {
                        ProviderError::RequestFailed(format!("解析 thread 失败: {}", e))
                    })?;

                    self.current_thread_id = Some(thread.id.clone());
                    return Ok(thread);
                }
            }

            // 处理 thread/started 通知
            if msg.get("method").and_then(|v| v.as_str()) == Some("thread/started") {
                tracing::debug!("收到 thread/started 通知");
            }
        }
    }

    /// 恢复已有线程
    pub fn thread_resume(&mut self, thread_id: &str) -> Result<(), ProviderError> {
        let params = json!({
            "thread_id": thread_id
        });

        let id = self.send_request("thread/resume", params)?;

        // 读取响应
        loop {
            let line = self.read_line()?;
            if line.is_empty() {
                continue;
            }

            let msg = self.parse_message(&line)?;

            if let Some(msg_id) = msg.get("id").and_then(|v| v.as_u64()) {
                if msg_id == id {
                    if let Some(error) = msg.get("error") {
                        return Err(ProviderError::RequestFailed(format!(
                            "thread/resume 失败: {}",
                            error
                        )));
                    }

                    self.current_thread_id = Some(thread_id.to_string());
                    return Ok(());
                }
            }
        }
    }

    /// 获取当前 thread ID
    pub fn current_thread_id(&self) -> Option<&str> {
        self.current_thread_id.as_deref()
    }

    /// 启动一个 turn 并收集所有事件
    pub fn turn_start(
        &mut self,
        input_text: &str,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<(String, Vec<AppServerEvent>), ProviderError> {
        let thread_id = self.current_thread_id.clone().ok_or_else(|| {
            ProviderError::RequestFailed("没有活动的 thread，请先调用 thread_start".to_string())
        })?;

        let params = build_turn_start_params(&thread_id, input_text, model, effort);

        let id = self.send_request("turn/start", params)?;

        let mut events = Vec::new();
        let mut accumulated_text = String::new();
        let mut turn_completed = false;

        // 读取事件流直到 turn 完成
        while !turn_completed {
            let line = self.read_line()?;
            if line.is_empty() {
                continue;
            }

            let msg = self.parse_message(&line)?;

            // 检查是否是 turn/start 的响应
            if let Some(msg_id) = msg.get("id").and_then(|v| v.as_u64()) {
                if msg_id == id {
                    if let Some(error) = msg.get("error") {
                        return Err(ProviderError::RequestFailed(format!(
                            "turn/start 失败: {}",
                            error
                        )));
                    }
                    // turn/start 响应只是确认，继续读取事件
                    continue;
                }
            }

            // 处理通知事件
            if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
                let params = msg.get("params").cloned().unwrap_or(json!({}));
                let event = Self::parse_event(method, &params, &mut accumulated_text);

                match &event {
                    AppServerEvent::TurnCompleted(_) => {
                        turn_completed = true;
                    }
                    AppServerEvent::Error(e) => {
                        tracing::error!("收到错误事件: {}", e);
                    }
                    _ => {}
                }

                events.push(event);
            }
        }

        Ok((accumulated_text, events))
    }

    /// 解析事件
    fn parse_param_string(params: &Value, key: &str, default: &str) -> String {
        params
            .get(key)
            .and_then(|value| value.as_str())
            .unwrap_or(default)
            .to_string()
    }

    fn parse_param_i64(params: &Value, key: &str, default: i64) -> i64 {
        params
            .get(key)
            .and_then(|value| value.as_i64())
            .unwrap_or(default)
    }

    fn parse_item_field(params: &Value, key: &str, default: &str) -> String {
        params
            .get("item")
            .and_then(|item| item.get(key))
            .and_then(|value| value.as_str())
            .unwrap_or(default)
            .to_string()
    }

    fn parse_thread_info(params: &Value) -> ThreadInfo {
        serde_json::from_value(params.get("thread").cloned().unwrap_or(json!({}))).unwrap_or(
            ThreadInfo {
                id: "unknown".to_string(),
                preview: None,
                model_provider: None,
                created_at: None,
            },
        )
    }

    fn parse_turn_info(params: &Value, default_status: &str) -> TurnInfo {
        serde_json::from_value(params.get("turn").cloned().unwrap_or(json!({}))).unwrap_or(
            TurnInfo {
                id: "unknown".to_string(),
                status: default_status.to_string(),
                items: vec![],
                error: None,
            },
        )
    }

    fn parse_thread_started(params: &Value) -> AppServerEvent {
        AppServerEvent::ThreadStarted(Self::parse_thread_info(params))
    }

    fn parse_turn_started(params: &Value) -> AppServerEvent {
        AppServerEvent::TurnStarted(Self::parse_turn_info(params, "unknown"))
    }

    fn parse_item_started(params: &Value) -> AppServerEvent {
        AppServerEvent::ItemStarted {
            item_id: Self::parse_item_field(params, "id", "unknown"),
            item_type: Self::parse_item_field(params, "type", "unknown"),
        }
    }

    fn parse_agent_message_delta(params: &Value, accumulated_text: &mut String) -> AppServerEvent {
        let item_id = Self::parse_param_string(params, "itemId", "unknown");
        let text = Self::parse_param_string(params, "delta", "");
        accumulated_text.push_str(&text);
        AppServerEvent::AgentMessageDelta { item_id, text }
    }

    fn parse_reasoning_summary_part_added(params: &Value) -> AppServerEvent {
        AppServerEvent::ReasoningSummaryPartAdded {
            item_id: Self::parse_param_string(params, "itemId", "unknown"),
            summary_index: Self::parse_param_i64(params, "summaryIndex", 0),
        }
    }

    fn parse_reasoning_summary_text_delta(params: &Value) -> AppServerEvent {
        AppServerEvent::ReasoningSummaryTextDelta {
            item_id: Self::parse_param_string(params, "itemId", "unknown"),
            text: Self::parse_param_string(params, "delta", ""),
            summary_index: Self::parse_param_i64(params, "summaryIndex", 0),
        }
    }

    fn parse_reasoning_text_delta(params: &Value) -> AppServerEvent {
        AppServerEvent::ReasoningTextDelta {
            item_id: Self::parse_param_string(params, "itemId", "unknown"),
            text: Self::parse_param_string(params, "delta", ""),
            content_index: Self::parse_param_i64(params, "contentIndex", 0),
        }
    }

    fn parse_item_completed(params: &Value) -> AppServerEvent {
        AppServerEvent::ItemCompleted {
            item_id: Self::parse_item_field(params, "id", "unknown"),
        }
    }

    fn parse_turn_completed(params: &Value) -> AppServerEvent {
        AppServerEvent::TurnCompleted(Self::parse_turn_info(params, "completed"))
    }

    fn parse_error(params: &Value) -> AppServerEvent {
        AppServerEvent::Error(Self::parse_param_string(params, "message", "未知错误"))
    }

    fn parse_event(method: &str, params: &Value, accumulated_text: &mut String) -> AppServerEvent {
        match method {
            "thread/started" => Self::parse_thread_started(params),
            "turn/started" => Self::parse_turn_started(params),
            "item/started" => Self::parse_item_started(params),
            "item/agentMessage/delta" => Self::parse_agent_message_delta(params, accumulated_text),
            "item/reasoning/summaryPartAdded" => Self::parse_reasoning_summary_part_added(params),
            "item/reasoning/summaryTextDelta" | "item/reasoning/delta" => {
                Self::parse_reasoning_summary_text_delta(params)
            }
            "item/reasoning/textDelta" => Self::parse_reasoning_text_delta(params),
            "item/completed" => Self::parse_item_completed(params),
            "turn/completed" => Self::parse_turn_completed(params),
            "error" => Self::parse_error(params),
            _ => AppServerEvent::Unknown(params.clone()),
        }
    }

    /// 中断当前 turn
    pub fn turn_interrupt(&mut self) -> Result<(), ProviderError> {
        let thread_id = self
            .current_thread_id
            .clone()
            .ok_or_else(|| ProviderError::RequestFailed("没有活动的 thread".to_string()))?;

        let params = json!({
            "threadId": thread_id
        });

        self.send_notification("turn/interrupt", params)?;
        Ok(())
    }

    /// 关闭连接
    pub fn close(&mut self) -> Result<(), ProviderError> {
        // 尝试优雅关闭
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }

    /// 检查进程是否还在运行
    pub fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(Some(_)) => false, // 进程已退出
            Ok(None) => true,     // 进程仍在运行
            Err(_) => false,      // 出错，假设已退出
        }
    }
}

impl Drop for CodexAppServerConnection {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

/// 会话管理器 - 管理多个 Codex app-server 连接
pub struct CodexSessionManager {
    /// 命令路径
    command: PathBuf,
    /// 活动连接 (conversation_id -> connection)
    connections: Arc<Mutex<HashMap<String, CodexAppServerConnection>>>,
    /// 会话映射 (conversation_id -> thread_id)
    session_map: Arc<Mutex<HashMap<String, String>>>,
}

impl CodexSessionManager {
    /// 创建新的会话管理器
    pub fn new(command: PathBuf) -> Self {
        Self {
            command,
            connections: Arc::new(Mutex::new(HashMap::new())),
            session_map: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 获取或创建连接
    pub fn get_or_create_connection(
        &self,
        conversation_id: &str,
        cwd: Option<&str>,
        model: Option<&str>,
    ) -> Result<(), ProviderError> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|e| ProviderError::RequestFailed(format!("获取连接锁失败: {}", e)))?;

        // 检查是否已有连接
        if let Some(conn) = connections.get_mut(conversation_id) {
            if conn.is_alive() {
                return Ok(());
            }
            // 连接已死，移除
            connections.remove(conversation_id);
        }

        // 创建新连接
        let mut conn = CodexAppServerConnection::spawn(&self.command, cwd)?;

        // 初始化
        conn.initialize("aster", env!("CARGO_PKG_VERSION"))?;

        // 检查是否有已保存的 thread_id
        let session_map = self
            .session_map
            .lock()
            .map_err(|e| ProviderError::RequestFailed(format!("获取会话映射锁失败: {}", e)))?;

        if let Some(thread_id) = session_map.get(conversation_id) {
            // 尝试恢复会话
            match conn.thread_resume(thread_id) {
                Ok(_) => {
                    tracing::info!("恢复会话成功: {} -> {}", conversation_id, thread_id);
                }
                Err(e) => {
                    tracing::warn!("恢复会话失败，创建新会话: {}", e);
                    drop(session_map);
                    let (approval_policy, sandbox_policy) = resolve_codex_runtime_policies();
                    let thread = conn.thread_start(
                        model,
                        cwd,
                        Some(&approval_policy),
                        Some(&sandbox_policy),
                    )?;
                    let mut session_map = self.session_map.lock().map_err(|e| {
                        ProviderError::RequestFailed(format!("获取会话映射锁失败: {}", e))
                    })?;
                    session_map.insert(conversation_id.to_string(), thread.id);
                }
            }
        } else {
            drop(session_map);
            // 创建新会话
            let (approval_policy, sandbox_policy) = resolve_codex_runtime_policies();
            let thread =
                conn.thread_start(model, cwd, Some(&approval_policy), Some(&sandbox_policy))?;
            let mut session_map = self
                .session_map
                .lock()
                .map_err(|e| ProviderError::RequestFailed(format!("获取会话映射锁失败: {}", e)))?;
            session_map.insert(conversation_id.to_string(), thread.id);
            tracing::info!(
                "创建新会话: {} -> {}",
                conversation_id,
                session_map.get(conversation_id).unwrap()
            );
        }

        connections.insert(conversation_id.to_string(), conn);
        Ok(())
    }

    /// 发送消息并获取响应
    pub fn send_message(
        &self,
        conversation_id: &str,
        message: &str,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<(String, Vec<AppServerEvent>), ProviderError> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|e| ProviderError::RequestFailed(format!("获取连接锁失败: {}", e)))?;

        let conn = connections.get_mut(conversation_id).ok_or_else(|| {
            ProviderError::RequestFailed(format!("会话不存在: {}", conversation_id))
        })?;

        conn.turn_start(message, model, effort)
    }

    /// 获取会话的 thread_id
    pub fn get_thread_id(&self, conversation_id: &str) -> Option<String> {
        self.session_map
            .lock()
            .ok()
            .and_then(|map| map.get(conversation_id).cloned())
    }

    /// 关闭会话
    pub fn close_session(&self, conversation_id: &str) -> Result<(), ProviderError> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|e| ProviderError::RequestFailed(format!("获取连接锁失败: {}", e)))?;

        if let Some(mut conn) = connections.remove(conversation_id) {
            conn.close()?;
        }

        Ok(())
    }

    /// 关闭所有会话
    pub fn close_all(&self) -> Result<(), ProviderError> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|e| ProviderError::RequestFailed(format!("获取连接锁失败: {}", e)))?;

        for (_, mut conn) in connections.drain() {
            let _ = conn.close();
        }

        Ok(())
    }
}

impl Drop for CodexSessionManager {
    fn drop(&mut self) {
        let _ = self.close_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::TurnContextOverride;

    #[test]
    fn test_request_id_generation() {
        let id1 = next_request_id();
        let id2 = next_request_id();
        assert!(id2 > id1);
    }

    #[test]
    fn test_thread_info_deserialize() {
        let json = r#"{
            "id": "thr_123",
            "preview": "Test thread",
            "modelProvider": "openai",
            "createdAt": 1730910000
        }"#;

        let thread: ThreadInfo = serde_json::from_str(json).unwrap();
        assert_eq!(thread.id, "thr_123");
        assert_eq!(thread.preview, Some("Test thread".to_string()));
        assert_eq!(thread.model_provider, Some("openai".to_string()));
    }

    #[test]
    fn test_turn_info_deserialize() {
        let json = r#"{
            "id": "turn_456",
            "status": "inProgress",
            "items": [],
            "error": null
        }"#;

        let turn: TurnInfo = serde_json::from_str(json).unwrap();
        assert_eq!(turn.id, "turn_456");
        assert_eq!(turn.status, "inProgress");
        assert!(turn.items.is_empty());
        assert!(turn.error.is_none());
    }

    #[test]
    fn test_turn_info_deserialize_reasoning_item_with_summary_and_content() {
        let json = r#"{
            "id": "turn_789",
            "status": "completed",
            "items": [
                {
                    "type": "reasoning",
                    "id": "reasoning-1",
                    "summary": ["先判断任务类型", "再决定是否联网"],
                    "content": ["raw reasoning block"],
                    "complete": true
                }
            ],
            "error": null
        }"#;

        let turn: TurnInfo = serde_json::from_str(json).unwrap();
        assert_eq!(turn.items.len(), 1);
        assert!(matches!(
            &turn.items[0],
            TurnItem::Reasoning {
                id,
                summary,
                content,
                complete
            } if id == "reasoning-1"
                && summary == &vec!["先判断任务类型".to_string(), "再决定是否联网".to_string()]
                && content == &vec!["raw reasoning block".to_string()]
                && *complete
        ));
    }

    #[test]
    fn test_parse_event_supports_reasoning_summary_and_raw_deltas() {
        let mut accumulated_text = String::new();

        let summary_part_added = CodexAppServerConnection::parse_event(
            "item/reasoning/summaryPartAdded",
            &json!({
                "itemId": "reasoning-1",
                "summaryIndex": 2
            }),
            &mut accumulated_text,
        );
        assert!(matches!(
            summary_part_added,
            AppServerEvent::ReasoningSummaryPartAdded {
                item_id,
                summary_index
            } if item_id == "reasoning-1" && summary_index == 2
        ));

        let summary_delta = CodexAppServerConnection::parse_event(
            "item/reasoning/summaryTextDelta",
            &json!({
                "itemId": "reasoning-1",
                "summaryIndex": 2,
                "delta": "先判断任务类型"
            }),
            &mut accumulated_text,
        );
        assert!(matches!(
            summary_delta,
            AppServerEvent::ReasoningSummaryTextDelta {
                item_id,
                text,
                summary_index
            } if item_id == "reasoning-1"
                && text == "先判断任务类型"
                && summary_index == 2
        ));

        let raw_delta = CodexAppServerConnection::parse_event(
            "item/reasoning/textDelta",
            &json!({
                "itemId": "reasoning-1",
                "contentIndex": 1,
                "delta": "raw reasoning block"
            }),
            &mut accumulated_text,
        );
        assert!(matches!(
            raw_delta,
            AppServerEvent::ReasoningTextDelta {
                item_id,
                text,
                content_index
            } if item_id == "reasoning-1"
                && text == "raw reasoning block"
                && content_index == 1
        ));
    }

    #[test]
    fn test_parse_event_keeps_legacy_reasoning_delta_compatible() {
        let mut accumulated_text = String::new();
        let event = CodexAppServerConnection::parse_event(
            "item/reasoning/delta",
            &json!({
                "itemId": "reasoning-legacy",
                "delta": "旧版摘要事件"
            }),
            &mut accumulated_text,
        );

        assert!(matches!(
            event,
            AppServerEvent::ReasoningSummaryTextDelta {
                item_id,
                text,
                summary_index
            } if item_id == "reasoning-legacy"
                && text == "旧版摘要事件"
                && summary_index == 0
        ));
    }

    #[test]
    fn test_build_turn_start_params_uses_default_runtime_policies() {
        let params =
            build_turn_start_params("thread-1", "hello", Some("gpt-5.3-codex"), Some("high"));

        assert_eq!(params["threadId"], json!("thread-1"));
        assert_eq!(params["approvalPolicy"], json!("never"));
        assert_eq!(params["sandboxPolicy"]["type"], json!("workspaceWrite"));
        assert_eq!(params["model"], json!("gpt-5.3-codex"));
        assert_eq!(params["effort"], json!("high"));
        assert_eq!(params["input"][0]["type"], json!("text"));
        assert_eq!(params["input"][0]["text"], json!("hello"));
    }

    #[tokio::test]
    async fn test_build_turn_start_params_includes_output_schema_from_turn_context() {
        let turn_context = TurnContextOverride {
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "answer": { "type": "string" }
                }
            })),
            ..TurnContextOverride::default()
        };

        crate::session_context::with_turn_context(Some(turn_context), async {
            let params =
                build_turn_start_params("thread-1", "hello", Some("gpt-5.3-codex"), Some("high"));

            assert_eq!(params["outputSchema"]["type"], json!("object"));
            assert_eq!(
                params["outputSchema"]["properties"]["answer"]["type"],
                json!("string")
            );
        })
        .await;
    }

    #[tokio::test]
    async fn test_build_turn_start_params_reads_runtime_access_policies_from_turn_context() {
        let turn_context = TurnContextOverride {
            approval_policy: Some("on-request".to_string()),
            sandbox_policy: Some("read-only".to_string()),
            ..TurnContextOverride::default()
        };

        crate::session_context::with_turn_context(Some(turn_context), async {
            let params =
                build_turn_start_params("thread-1", "hello", Some("gpt-5.3-codex"), Some("high"));

            assert_eq!(params["approvalPolicy"], json!("on-request"));
            assert_eq!(params["sandboxPolicy"]["type"], json!("readOnly"));
        })
        .await;
    }
}
