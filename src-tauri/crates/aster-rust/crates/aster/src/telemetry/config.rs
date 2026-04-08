//! 遥测配置

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 默认上报间隔（毫秒）
pub const DEFAULT_UPLOAD_INTERVAL: u64 = 3600000; // 1 hour

/// 默认批量大小
pub const DEFAULT_BATCH_SIZE: usize = 100;

/// 最大事件数
pub const MAX_EVENTS: usize = 10000;

/// 最大队列大小
pub const MAX_QUEUE_SIZE: usize = 1000;

/// 遥测配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryConfig {
    /// 是否启用
    pub enabled: bool,
    /// 是否启用错误报告
    pub error_reporting: bool,
    /// 是否启用性能追踪
    pub performance_tracking: bool,
    /// 是否启用批量上报
    pub batch_upload: bool,
    /// 上报间隔（毫秒）
    pub upload_interval: u64,
    /// 批量大小
    pub max_batch_size: usize,
    /// 上报端点
    #[serde(default)]
    pub endpoint: Option<String>,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            enabled: !is_telemetry_disabled(),
            error_reporting: false,
            performance_tracking: true,
            batch_upload: false,
            upload_interval: DEFAULT_UPLOAD_INTERVAL,
            max_batch_size: DEFAULT_BATCH_SIZE,
            endpoint: None,
        }
    }
}

/// 检查环境变量是否禁用遥测
pub fn is_telemetry_disabled() -> bool {
    std::env::var("ASTER_DISABLE_TELEMETRY")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false)
        || std::env::var("DISABLE_TELEMETRY")
            .map(|v| v == "1" || v == "true")
            .unwrap_or(false)
}

/// 获取遥测目录
pub fn get_telemetry_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("telemetry")
}

/// 获取指标文件路径
pub fn get_metrics_file() -> PathBuf {
    get_telemetry_dir().join("metrics.json")
}

/// 获取事件文件路径
pub fn get_events_file() -> PathBuf {
    get_telemetry_dir().join("events.jsonl")
}

/// 获取错误文件路径
pub fn get_errors_file() -> PathBuf {
    get_telemetry_dir().join("errors.jsonl")
}

/// 获取性能文件路径
pub fn get_performance_file() -> PathBuf {
    get_telemetry_dir().join("performance.jsonl")
}

/// 获取队列文件路径
pub fn get_queue_file() -> PathBuf {
    get_telemetry_dir().join("queue.jsonl")
}

/// 获取匿名 ID 文件路径
pub fn get_anonymous_id_file() -> PathBuf {
    get_telemetry_dir().join("anonymous_id")
}

/// 获取配置文件路径
pub fn get_config_file() -> PathBuf {
    get_telemetry_dir().join("config.json")
}
