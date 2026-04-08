//! 遥测追踪器

use super::config::*;
use super::sanitizer::*;
use super::types::*;
use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::warn;

/// 遥测追踪器
pub struct TelemetryTracker {
    config: RwLock<TelemetryConfig>,
    anonymous_id: String,
    current_session: RwLock<Option<SessionMetrics>>,
    event_queue: RwLock<Vec<TelemetryEvent>>,
}

impl TelemetryTracker {
    /// 创建新的追踪器
    pub fn new() -> Self {
        let config = load_config();
        let anonymous_id = get_or_create_anonymous_id();

        // 确保目录存在
        let dir = get_telemetry_dir();
        if !dir.exists() {
            let _ = fs::create_dir_all(&dir);
        }

        Self {
            config: RwLock::new(config),
            anonymous_id,
            current_session: RwLock::new(None),
            event_queue: RwLock::new(Vec::new()),
        }
    }

    /// 检查是否启用
    pub fn is_enabled(&self) -> bool {
        self.config.read().enabled
    }

    /// 开始新会话
    pub fn start_session(&self, session_id: &str, model: &str) {
        if !self.is_enabled() {
            return;
        }

        let session = SessionMetrics {
            session_id: session_id.to_string(),
            start_time: current_timestamp(),
            model: model.to_string(),
            ..Default::default()
        };

        *self.current_session.write() = Some(session);
        self.track_event(
            "session_start",
            HashMap::from([("model".to_string(), serde_json::json!(model))]),
        );
    }

    /// 结束会话
    pub fn end_session(&self) {
        if !self.is_enabled() {
            return;
        }

        let mut session_guard = self.current_session.write();
        if let Some(ref mut session) = *session_guard {
            session.end_time = Some(current_timestamp());

            let duration = session.end_time.unwrap() - session.start_time;
            self.track_event(
                "session_end",
                HashMap::from([
                    ("duration".to_string(), serde_json::json!(duration)),
                    (
                        "message_count".to_string(),
                        serde_json::json!(session.message_count),
                    ),
                    (
                        "token_usage".to_string(),
                        serde_json::to_value(&session.token_usage).unwrap(),
                    ),
                    (
                        "estimated_cost".to_string(),
                        serde_json::json!(session.estimated_cost),
                    ),
                ]),
            );

            self.update_aggregate_metrics(session);
        }

        *session_guard = None;
    }

    /// 跟踪事件
    pub fn track_event(&self, event_type: &str, data: HashMap<String, serde_json::Value>) {
        if !self.is_enabled() {
            return;
        }

        let sanitized_data = sanitize_map(&data);
        let session_id = self
            .current_session
            .read()
            .as_ref()
            .map(|s| s.session_id.clone())
            .unwrap_or_else(|| "unknown".to_string());

        let event = TelemetryEvent {
            event_type: event_type.to_string(),
            timestamp: current_timestamp(),
            session_id,
            anonymous_id: self.anonymous_id.clone(),
            data: sanitized_data,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            platform: Some(std::env::consts::OS.to_string()),
        };

        // 追加到事件文件
        if let Err(e) = append_to_jsonl(&get_events_file(), &event) {
            warn!("Failed to write event: {}", e);
        }

        // 添加到队列
        let config = self.config.read();
        if config.batch_upload {
            let mut queue = self.event_queue.write();
            queue.push(event);
            if queue.len() > MAX_QUEUE_SIZE {
                queue.remove(0);
            }
        }
    }

    /// 跟踪消息
    pub fn track_message(&self, role: &str) {
        if !self.is_enabled() {
            return;
        }

        if let Some(ref mut session) = *self.current_session.write() {
            session.message_count += 1;
        }

        self.track_event(
            "message",
            HashMap::from([("role".to_string(), serde_json::json!(role))]),
        );
    }

    /// 跟踪工具调用
    pub fn track_tool_call(&self, tool_name: &str, success: bool, duration: u64) {
        if !self.is_enabled() {
            return;
        }

        if let Some(ref mut session) = *self.current_session.write() {
            *session.tool_calls.entry(tool_name.to_string()).or_insert(0) += 1;
            if !success {
                session.errors += 1;
            }
        }

        self.track_event(
            "tool_call",
            HashMap::from([
                ("tool_name".to_string(), serde_json::json!(tool_name)),
                ("success".to_string(), serde_json::json!(success)),
                ("duration".to_string(), serde_json::json!(duration)),
            ]),
        );

        if self.config.read().performance_tracking {
            self.track_performance(tool_name, duration, success, None);
        }
    }

    /// 跟踪命令使用
    pub fn track_command(&self, command_name: &str, success: bool, duration: u64) {
        if !self.is_enabled() {
            return;
        }

        self.track_event(
            "command_use",
            HashMap::from([
                ("command_name".to_string(), serde_json::json!(command_name)),
                ("success".to_string(), serde_json::json!(success)),
                ("duration".to_string(), serde_json::json!(duration)),
            ]),
        );

        if self.config.read().performance_tracking {
            self.track_performance(
                &format!("command:{}", command_name),
                duration,
                success,
                None,
            );
        }
    }

    /// 跟踪 token 使用
    pub fn track_token_usage(&self, input: u64, output: u64, cost: f64) {
        if !self.is_enabled() {
            return;
        }

        if let Some(ref mut session) = *self.current_session.write() {
            session.token_usage.input += input;
            session.token_usage.output += output;
            session.token_usage.total += input + output;
            session.estimated_cost += cost;
        }

        self.track_event(
            "token_usage",
            HashMap::from([
                ("input".to_string(), serde_json::json!(input)),
                ("output".to_string(), serde_json::json!(output)),
                ("cost".to_string(), serde_json::json!(cost)),
            ]),
        );
    }

    /// 跟踪错误
    pub fn track_error(&self, error: &str, context: Option<HashMap<String, serde_json::Value>>) {
        if !self.is_enabled() {
            return;
        }

        if let Some(ref mut session) = *self.current_session.write() {
            session.errors += 1;
        }

        let mut data = HashMap::from([("error".to_string(), serde_json::json!(error))]);
        if let Some(ctx) = context {
            data.extend(ctx);
        }

        self.track_event("error", data);
    }

    /// 跟踪性能指标
    pub fn track_performance(
        &self,
        operation: &str,
        duration: u64,
        success: bool,
        metadata: Option<HashMap<String, serde_json::Value>>,
    ) {
        if !self.is_enabled() || !self.config.read().performance_tracking {
            return;
        }

        let sanitized_metadata = metadata.map(|m| sanitize_map(&m));

        let metric = PerformanceMetric {
            operation: operation.to_string(),
            duration,
            timestamp: current_timestamp(),
            success,
            metadata: sanitized_metadata,
        };

        if let Err(e) = append_to_jsonl(&get_performance_file(), &metric) {
            warn!("Failed to write performance metric: {}", e);
        }
    }

    /// 跟踪详细错误报告
    pub fn track_error_report(
        &self,
        error_type: &str,
        error_message: &str,
        stack: Option<String>,
        context: HashMap<String, serde_json::Value>,
    ) {
        if !self.is_enabled() || !self.config.read().error_reporting {
            return;
        }

        let sanitized_context = sanitize_map(&context);
        let session_id = self
            .current_session
            .read()
            .as_ref()
            .map(|s| s.session_id.clone())
            .unwrap_or_else(|| "unknown".to_string());

        let report = ErrorReport {
            error_type: error_type.to_string(),
            error_message: sanitize_string(error_message),
            stack: stack.map(|s| sanitize_string(&s)),
            context: sanitized_context,
            timestamp: current_timestamp(),
            session_id,
            anonymous_id: self.anonymous_id.clone(),
        };

        if let Err(e) = append_to_jsonl(&get_errors_file(), &report) {
            warn!("Failed to write error report: {}", e);
        }

        self.track_error(error_type, None);
    }

    /// 更新聚合指标
    fn update_aggregate_metrics(&self, session: &SessionMetrics) {
        let mut metrics = load_aggregate_metrics().unwrap_or_default();

        metrics.total_sessions += 1;
        metrics.total_messages += session.message_count;
        metrics.total_tokens += session.token_usage.total;
        metrics.total_cost += session.estimated_cost;
        metrics.total_errors += session.errors;

        for (tool, count) in &session.tool_calls {
            *metrics.tool_usage.entry(tool.clone()).or_insert(0) += count;
        }

        *metrics
            .model_usage
            .entry(session.model.clone())
            .or_insert(0) += 1;

        let duration = session.end_time.unwrap_or(current_timestamp()) - session.start_time;
        metrics.average_session_duration = (metrics.average_session_duration
            * (metrics.total_sessions - 1) as f64
            + duration as f64)
            / metrics.total_sessions as f64;

        metrics.last_updated = current_timestamp();

        if let Err(e) = save_aggregate_metrics(&metrics) {
            warn!("Failed to save aggregate metrics: {}", e);
        }
    }

    /// 获取聚合指标
    pub fn get_metrics(&self) -> Option<AggregateMetrics> {
        load_aggregate_metrics()
    }

    /// 获取当前会话指标
    pub fn get_current_session(&self) -> Option<SessionMetrics> {
        self.current_session.read().clone()
    }

    /// 获取匿名 ID
    pub fn get_anonymous_id(&self) -> &str {
        &self.anonymous_id
    }

    /// 启用遥测
    pub fn enable(&self) {
        if is_telemetry_disabled() {
            warn!("Telemetry disabled via environment variable");
            return;
        }
        self.config.write().enabled = true;
        self.save_config();
    }

    /// 禁用遥测
    pub fn disable(&self) {
        self.config.write().enabled = false;
        self.save_config();
    }

    /// 启用错误报告
    pub fn enable_error_reporting(&self) {
        self.config.write().error_reporting = true;
        self.save_config();
    }

    /// 禁用错误报告
    pub fn disable_error_reporting(&self) {
        self.config.write().error_reporting = false;
        self.save_config();
    }

    /// 启用性能追踪
    pub fn enable_performance_tracking(&self) {
        self.config.write().performance_tracking = true;
        self.save_config();
    }

    /// 禁用性能追踪
    pub fn disable_performance_tracking(&self) {
        self.config.write().performance_tracking = false;
        self.save_config();
    }

    /// 保存配置
    fn save_config(&self) {
        let config = self.config.read().clone();
        if let Err(e) = save_telemetry_config(&config) {
            warn!("Failed to save telemetry config: {}", e);
        }
    }

    /// 清除所有遥测数据
    pub fn clear_data(&self) {
        let files = [
            get_metrics_file(),
            get_events_file(),
            get_errors_file(),
            get_performance_file(),
            get_queue_file(),
        ];

        for file in &files {
            if file.exists() {
                let _ = fs::remove_file(file);
            }
        }
    }
}

impl Default for TelemetryTracker {
    fn default() -> Self {
        Self::new()
    }
}

// 辅助函数

/// 获取当前时间戳（毫秒）
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 获取或创建匿名 ID
fn get_or_create_anonymous_id() -> String {
    let id_file = get_anonymous_id_file();

    if id_file.exists() {
        if let Ok(id) = fs::read_to_string(&id_file) {
            return id.trim().to_string();
        }
    }

    // 生成新的匿名 ID
    let machine_info = format!(
        "{}|{}|{}|{}",
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_default(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );

    let mut hasher = Sha256::new();
    hasher.update(machine_info.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let id = format!("anon_{}", hash.get(..32).unwrap_or(&hash));

    // 确保目录存在
    if let Some(parent) = id_file.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let _ = fs::write(&id_file, &id);
    id
}

/// 加载配置
fn load_config() -> TelemetryConfig {
    let config_file = get_config_file();
    if config_file.exists() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    TelemetryConfig::default()
}

/// 保存配置
fn save_telemetry_config(config: &TelemetryConfig) -> Result<(), String> {
    let config_file = get_config_file();
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&config_file, content).map_err(|e| e.to_string())
}

/// 追加到 JSONL 文件
fn append_to_jsonl<T: serde::Serialize>(path: &std::path::Path, data: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;

    let json = serde_json::to_string(data).map_err(|e| e.to_string())?;
    writeln!(file, "{}", json).map_err(|e| e.to_string())?;

    // 限制文件大小
    trim_jsonl_file(path, MAX_EVENTS);

    Ok(())
}

/// 限制 JSONL 文件行数
fn trim_jsonl_file(path: &std::path::Path, max_lines: usize) {
    if !path.exists() {
        return;
    }

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

    if lines.len() > max_lines {
        let trimmed: Vec<&str> = lines
            .iter()
            .skip(lines.len() - max_lines)
            .map(|s| s.as_str())
            .collect();
        let _ = fs::write(path, trimmed.join("\n") + "\n");
    }
}

/// 加载聚合指标
fn load_aggregate_metrics() -> Option<AggregateMetrics> {
    let metrics_file = get_metrics_file();
    if metrics_file.exists() {
        if let Ok(content) = fs::read_to_string(&metrics_file) {
            if let Ok(metrics) = serde_json::from_str(&content) {
                return Some(metrics);
            }
        }
    }
    None
}

/// 保存聚合指标
fn save_aggregate_metrics(metrics: &AggregateMetrics) -> Result<(), String> {
    let metrics_file = get_metrics_file();
    if let Some(parent) = metrics_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(metrics).map_err(|e| e.to_string())?;
    fs::write(&metrics_file, content).map_err(|e| e.to_string())
}

/// 全局追踪器
static GLOBAL_TRACKER: once_cell::sync::Lazy<Arc<TelemetryTracker>> =
    once_cell::sync::Lazy::new(|| Arc::new(TelemetryTracker::new()));

/// 获取全局追踪器
pub fn global_tracker() -> Arc<TelemetryTracker> {
    GLOBAL_TRACKER.clone()
}
