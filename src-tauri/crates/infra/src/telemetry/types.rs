//! 遥测类型定义
//!
//! 定义请求日志、统计数据等核心类型

use chrono::{DateTime, Utc};
use lime_core::ProviderType;
use serde::{Deserialize, Serialize};

/// 请求状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestStatus {
    /// 成功
    Success,
    /// 失败
    Failed,
    /// 超时
    Timeout,
    /// 重试中
    Retrying,
    /// 已取消
    Cancelled,
}

impl std::fmt::Display for RequestStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RequestStatus::Success => write!(f, "success"),
            RequestStatus::Failed => write!(f, "failed"),
            RequestStatus::Timeout => write!(f, "timeout"),
            RequestStatus::Retrying => write!(f, "retrying"),
            RequestStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// 请求日志条目
///
/// 记录每个 API 请求的详细信息，包括时间戳、Provider、模型、持续时间和状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    /// 唯一请求 ID
    pub id: String,
    /// Lime 会话 ID（如果有）
    pub session_id: Option<String>,
    /// Lime 线程 ID（如果有）
    pub thread_id: Option<String>,
    /// Lime 回合 ID（如果有）
    pub turn_id: Option<String>,
    /// 关联的 pending request ID（如果有）
    pub pending_request_id: Option<String>,
    /// 关联的 queued turn ID（如果有）
    pub queued_turn_id: Option<String>,
    /// 关联的 subagent session ID（如果有）
    pub subagent_session_id: Option<String>,
    /// 请求时间戳
    pub timestamp: DateTime<Utc>,
    /// Provider 类型
    pub provider: ProviderType,
    /// 请求的模型名称
    pub model: String,
    /// 请求持续时间（毫秒）
    pub duration_ms: u64,
    /// 请求状态
    pub status: RequestStatus,
    /// HTTP 状态码（如果有）
    pub http_status: Option<u16>,
    /// 输入 Token 数（如果可用）
    pub input_tokens: Option<u32>,
    /// 输出 Token 数（如果可用）
    pub output_tokens: Option<u32>,
    /// 总 Token 数（如果可用）
    pub total_tokens: Option<u32>,
    /// 错误信息（如果失败）
    pub error_message: Option<String>,
    /// 是否为流式请求
    pub is_streaming: bool,
    /// 使用的凭证 ID（如果有）
    pub credential_id: Option<String>,
    /// 重试次数
    pub retry_count: u32,
}

impl RequestLog {
    /// 创建新的请求日志
    pub fn new(id: String, provider: ProviderType, model: String, is_streaming: bool) -> Self {
        Self {
            id,
            session_id: None,
            thread_id: None,
            turn_id: None,
            pending_request_id: None,
            queued_turn_id: None,
            subagent_session_id: None,
            timestamp: Utc::now(),
            provider,
            model,
            duration_ms: 0,
            status: RequestStatus::Retrying,
            http_status: None,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            error_message: None,
            is_streaming,
            credential_id: None,
            retry_count: 0,
        }
    }

    /// 标记请求成功
    pub fn mark_success(&mut self, duration_ms: u64, http_status: u16) {
        self.status = RequestStatus::Success;
        self.duration_ms = duration_ms;
        self.http_status = Some(http_status);
    }

    /// 标记请求失败
    pub fn mark_failed(&mut self, duration_ms: u64, http_status: Option<u16>, error: String) {
        self.status = RequestStatus::Failed;
        self.duration_ms = duration_ms;
        self.http_status = http_status;
        self.error_message = Some(error);
    }

    /// 标记请求超时
    pub fn mark_timeout(&mut self, duration_ms: u64) {
        self.status = RequestStatus::Timeout;
        self.duration_ms = duration_ms;
        self.error_message = Some("Request timeout".to_string());
    }

    /// 标记请求取消
    pub fn mark_cancelled(&mut self, duration_ms: u64) {
        self.status = RequestStatus::Cancelled;
        self.duration_ms = duration_ms;
    }

    /// 设置 Token 使用信息
    pub fn set_tokens(&mut self, input: Option<u32>, output: Option<u32>) {
        self.input_tokens = input;
        self.output_tokens = output;
        self.total_tokens = match (input, output) {
            (Some(i), Some(o)) => Some(i + o),
            _ => None,
        };
    }

    /// 设置凭证 ID
    pub fn set_credential_id(&mut self, id: String) {
        self.credential_id = Some(id);
    }

    /// 增加重试次数
    pub fn increment_retry(&mut self) {
        self.retry_count += 1;
    }

    /// 检查请求是否成功
    pub fn is_success(&self) -> bool {
        self.status == RequestStatus::Success
    }
}

/// 时间范围
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TimeRange {
    /// 开始时间
    pub start: DateTime<Utc>,
    /// 结束时间
    pub end: DateTime<Utc>,
}

impl TimeRange {
    /// 创建新的时间范围
    pub fn new(start: DateTime<Utc>, end: DateTime<Utc>) -> Self {
        Self { start, end }
    }

    /// 创建最近 N 小时的时间范围
    pub fn last_hours(hours: i64) -> Self {
        let end = Utc::now();
        let start = end - chrono::Duration::hours(hours);
        Self { start, end }
    }

    /// 创建最近 N 天的时间范围
    pub fn last_days(days: i64) -> Self {
        let end = Utc::now();
        let start = end - chrono::Duration::days(days);
        Self { start, end }
    }

    /// 检查时间戳是否在范围内
    pub fn contains(&self, timestamp: &DateTime<Utc>) -> bool {
        *timestamp >= self.start && *timestamp <= self.end
    }
}

/// 统计摘要
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatsSummary {
    /// 总请求数
    pub total_requests: u64,
    /// 成功请求数
    pub successful_requests: u64,
    /// 失败请求数
    pub failed_requests: u64,
    /// 超时请求数
    pub timeout_requests: u64,
    /// 成功率（0.0 - 1.0）
    pub success_rate: f64,
    /// 平均延迟（毫秒）
    pub avg_latency_ms: f64,
    /// 最小延迟（毫秒）
    pub min_latency_ms: Option<u64>,
    /// 最大延迟（毫秒）
    pub max_latency_ms: Option<u64>,
    /// 总输入 Token 数
    pub total_input_tokens: u64,
    /// 总输出 Token 数
    pub total_output_tokens: u64,
    /// 总 Token 数
    pub total_tokens: u64,
}

impl StatsSummary {
    /// 从日志列表计算统计摘要
    pub fn from_logs(logs: &[RequestLog]) -> Self {
        if logs.is_empty() {
            return Self::default();
        }

        let total_requests = logs.len() as u64;
        let successful_requests = logs.iter().filter(|l| l.is_success()).count() as u64;
        let failed_requests = logs
            .iter()
            .filter(|l| l.status == RequestStatus::Failed)
            .count() as u64;
        let timeout_requests = logs
            .iter()
            .filter(|l| l.status == RequestStatus::Timeout)
            .count() as u64;

        let success_rate = if total_requests > 0 {
            successful_requests as f64 / total_requests as f64
        } else {
            0.0
        };

        let latencies: Vec<u64> = logs.iter().map(|l| l.duration_ms).collect();
        let avg_latency_ms = if !latencies.is_empty() {
            latencies.iter().sum::<u64>() as f64 / latencies.len() as f64
        } else {
            0.0
        };

        let min_latency_ms = latencies.iter().min().copied();
        let max_latency_ms = latencies.iter().max().copied();

        let total_input_tokens: u64 = logs
            .iter()
            .filter_map(|l| l.input_tokens)
            .map(|t| t as u64)
            .sum();
        let total_output_tokens: u64 = logs
            .iter()
            .filter_map(|l| l.output_tokens)
            .map(|t| t as u64)
            .sum();
        let total_tokens = total_input_tokens + total_output_tokens;

        Self {
            total_requests,
            successful_requests,
            failed_requests,
            timeout_requests,
            success_rate,
            avg_latency_ms,
            min_latency_ms,
            max_latency_ms,
            total_input_tokens,
            total_output_tokens,
            total_tokens,
        }
    }
}

/// Provider 统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderStats {
    /// Provider 类型
    pub provider: Option<ProviderType>,
    /// 统计摘要
    #[serde(flatten)]
    pub summary: StatsSummary,
}

impl ProviderStats {
    /// 从日志列表计算 Provider 统计
    pub fn from_logs(provider: ProviderType, logs: &[RequestLog]) -> Self {
        Self {
            provider: Some(provider),
            summary: StatsSummary::from_logs(logs),
        }
    }
}

/// 模型统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelStats {
    /// 模型名称
    pub model: String,
    /// 统计摘要
    #[serde(flatten)]
    pub summary: StatsSummary,
}

impl ModelStats {
    /// 从日志列表计算模型统计
    pub fn from_logs(model: String, logs: &[RequestLog]) -> Self {
        Self {
            model,
            summary: StatsSummary::from_logs(logs),
        }
    }
}

#[cfg(test)]
mod type_tests {
    use super::*;

    #[test]
    fn test_request_log_new() {
        let log = RequestLog::new(
            "test-id".to_string(),
            ProviderType::Kiro,
            "claude-sonnet".to_string(),
            false,
        );

        assert_eq!(log.id, "test-id");
        assert_eq!(log.provider, ProviderType::Kiro);
        assert_eq!(log.model, "claude-sonnet");
        assert!(!log.is_streaming);
        assert_eq!(log.status, RequestStatus::Retrying);
        assert_eq!(log.retry_count, 0);
    }

    #[test]
    fn test_request_log_mark_success() {
        let mut log = RequestLog::new(
            "test-id".to_string(),
            ProviderType::Kiro,
            "claude-sonnet".to_string(),
            false,
        );

        log.mark_success(150, 200);

        assert_eq!(log.status, RequestStatus::Success);
        assert_eq!(log.duration_ms, 150);
        assert_eq!(log.http_status, Some(200));
        assert!(log.is_success());
    }

    #[test]
    fn test_request_log_mark_failed() {
        let mut log = RequestLog::new(
            "test-id".to_string(),
            ProviderType::Gemini,
            "gemini-pro".to_string(),
            true,
        );

        log.mark_failed(500, Some(500), "Internal error".to_string());

        assert_eq!(log.status, RequestStatus::Failed);
        assert_eq!(log.duration_ms, 500);
        assert_eq!(log.http_status, Some(500));
        assert_eq!(log.error_message, Some("Internal error".to_string()));
        assert!(!log.is_success());
    }

    #[test]
    fn test_request_log_set_tokens() {
        let mut log = RequestLog::new(
            "test-id".to_string(),
            ProviderType::Kiro,
            "claude-sonnet".to_string(),
            false,
        );

        log.set_tokens(Some(100), Some(50));

        assert_eq!(log.input_tokens, Some(100));
        assert_eq!(log.output_tokens, Some(50));
        assert_eq!(log.total_tokens, Some(150));
    }

    #[test]
    fn test_time_range_contains() {
        let now = Utc::now();
        let range = TimeRange::new(
            now - chrono::Duration::hours(1),
            now + chrono::Duration::seconds(1), // Add buffer for test timing
        );
        let past = now - chrono::Duration::minutes(30);
        let future = now + chrono::Duration::hours(2);

        assert!(range.contains(&now));
        assert!(range.contains(&past));
        assert!(!range.contains(&future));
    }

    #[test]
    fn test_stats_summary_from_logs() {
        let logs = vec![
            {
                let mut log = RequestLog::new(
                    "1".to_string(),
                    ProviderType::Kiro,
                    "model".to_string(),
                    false,
                );
                log.mark_success(100, 200);
                log.set_tokens(Some(50), Some(25));
                log
            },
            {
                let mut log = RequestLog::new(
                    "2".to_string(),
                    ProviderType::Kiro,
                    "model".to_string(),
                    false,
                );
                log.mark_success(200, 200);
                log.set_tokens(Some(100), Some(50));
                log
            },
            {
                let mut log = RequestLog::new(
                    "3".to_string(),
                    ProviderType::Kiro,
                    "model".to_string(),
                    false,
                );
                log.mark_failed(300, Some(500), "error".to_string());
                log
            },
        ];

        let summary = StatsSummary::from_logs(&logs);

        assert_eq!(summary.total_requests, 3);
        assert_eq!(summary.successful_requests, 2);
        assert_eq!(summary.failed_requests, 1);
        assert!((summary.success_rate - 0.666).abs() < 0.01);
        assert_eq!(summary.min_latency_ms, Some(100));
        assert_eq!(summary.max_latency_ms, Some(300));
        assert_eq!(summary.total_input_tokens, 150);
        assert_eq!(summary.total_output_tokens, 75);
    }
}
