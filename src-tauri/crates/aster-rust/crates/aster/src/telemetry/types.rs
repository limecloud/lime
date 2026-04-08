//! 遥测类型定义

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 遥测事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    /// 事件类型
    #[serde(rename = "type")]
    pub event_type: String,
    /// 时间戳（毫秒）
    pub timestamp: u64,
    /// 会话 ID
    pub session_id: String,
    /// 匿名 ID
    pub anonymous_id: String,
    /// 事件数据
    pub data: HashMap<String, serde_json::Value>,
    /// 版本
    #[serde(default)]
    pub version: Option<String>,
    /// 平台
    #[serde(default)]
    pub platform: Option<String>,
}

/// 会话指标
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionMetrics {
    /// 会话 ID
    pub session_id: String,
    /// 开始时间（毫秒）
    pub start_time: u64,
    /// 结束时间（毫秒）
    #[serde(default)]
    pub end_time: Option<u64>,
    /// 消息数量
    pub message_count: u64,
    /// 工具调用统计
    pub tool_calls: HashMap<String, u64>,
    /// Token 使用
    pub token_usage: TokenUsage,
    /// 估算成本
    pub estimated_cost: f64,
    /// 模型
    pub model: String,
    /// 错误数量
    pub errors: u64,
}

/// Token 使用统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    /// 输入 token
    pub input: u64,
    /// 输出 token
    pub output: u64,
    /// 总 token
    pub total: u64,
}

/// 聚合指标
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AggregateMetrics {
    /// 总会话数
    pub total_sessions: u64,
    /// 总消息数
    pub total_messages: u64,
    /// 总 token 数
    pub total_tokens: u64,
    /// 总成本
    pub total_cost: f64,
    /// 工具使用统计
    pub tool_usage: HashMap<String, u64>,
    /// 命令使用统计
    pub command_usage: HashMap<String, u64>,
    /// 模型使用统计
    pub model_usage: HashMap<String, u64>,
    /// 平均会话时长（毫秒）
    pub average_session_duration: f64,
    /// 总错误数
    pub total_errors: u64,
    /// 错误类型统计
    pub error_types: HashMap<String, u64>,
    /// 最后更新时间
    pub last_updated: u64,
}

/// 性能指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetric {
    /// 操作名称
    pub operation: String,
    /// 持续时间（毫秒）
    pub duration: u64,
    /// 时间戳
    pub timestamp: u64,
    /// 是否成功
    pub success: bool,
    /// 元数据
    #[serde(default)]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// 错误报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorReport {
    /// 错误类型
    pub error_type: String,
    /// 错误消息
    pub error_message: String,
    /// 堆栈跟踪
    #[serde(default)]
    pub stack: Option<String>,
    /// 上下文
    pub context: HashMap<String, serde_json::Value>,
    /// 时间戳
    pub timestamp: u64,
    /// 会话 ID
    pub session_id: String,
    /// 匿名 ID
    pub anonymous_id: String,
}

/// 性能统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PerformanceStats {
    /// 按操作分组的统计
    pub by_operation: HashMap<String, OperationStats>,
    /// 总体统计
    pub overall: OverallStats,
}

/// 操作统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OperationStats {
    /// 调用次数
    pub count: u64,
    /// 平均持续时间
    pub avg_duration: f64,
    /// 成功率
    pub success_rate: f64,
}

/// 总体统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OverallStats {
    /// 总操作数
    pub total_operations: u64,
    /// 平均持续时间
    pub avg_duration: f64,
    /// 成功率
    pub success_rate: f64,
}

/// 错误统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ErrorStats {
    /// 按类型分组
    pub by_type: HashMap<String, u64>,
    /// 总数
    pub total: u64,
    /// 最近的错误
    pub recent: Vec<ErrorReport>,
}
