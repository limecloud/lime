//! 遥测命令模块
//!
//! 提供请求日志、统计数据和 Token 追踪的 Tauri 命令。
//! 这些命令只暴露原始 `RequestLog` 与聚合统计，不负责定义 session / thread 的 current 状态真相；
//! 当前线程稳定状态应统一走 `agent_runtime_get_thread_read` 与 `agent_runtime_export_*` 主链。

use crate::telemetry::{
    ModelStats, ModelTokenStats, ProviderStats, ProviderTokenStats, RequestLog, RequestLogger,
    RequestStatus, StatsAggregator, StatsSummary, TimeRange, TokenStatsSummary, TokenTracker,
};
use crate::ProviderType;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// 遥测服务状态
///
/// 支持两种模式：
/// 1. 独立模式：使用自己的 StatsAggregator 和 TokenTracker 实例
/// 2. 共享模式：使用外部传入的共享实例（与 RequestProcessor 共享）
pub struct TelemetryState {
    pub logger: Arc<RequestLogger>,
    /// 统计聚合器（使用 RwLock 以支持与 RequestProcessor 共享）
    pub stats: Arc<RwLock<StatsAggregator>>,
    /// Token 追踪器（使用 RwLock 以支持与 RequestProcessor 共享）
    pub tokens: Arc<RwLock<TokenTracker>>,
}

impl TelemetryState {
    /// 创建独立的遥测状态（使用自己的实例）
    pub fn new() -> Result<Self, String> {
        let logger =
            RequestLogger::with_defaults().map_err(|e| format!("Failed to create logger: {e}"))?;

        Ok(Self {
            logger: Arc::new(logger),
            stats: Arc::new(RwLock::new(StatsAggregator::with_defaults())),
            tokens: Arc::new(RwLock::new(TokenTracker::with_defaults())),
        })
    }

    /// 创建共享的遥测状态（使用外部传入的实例）
    ///
    /// 这允许 TelemetryState 与 RequestProcessor 共享同一个 StatsAggregator、TokenTracker 和 RequestLogger，
    /// 使得请求处理过程中记录的统计数据能够在前端监控页面中显示。
    pub fn with_shared(
        stats: Arc<RwLock<StatsAggregator>>,
        tokens: Arc<RwLock<TokenTracker>>,
        logger: Option<Arc<RequestLogger>>,
    ) -> Result<Self, String> {
        let logger = match logger {
            Some(l) => l,
            None => Arc::new(
                RequestLogger::with_defaults()
                    .map_err(|e| format!("Failed to create logger: {e}"))?,
            ),
        };

        Ok(Self {
            logger,
            stats,
            tokens,
        })
    }
}

impl Default for TelemetryState {
    fn default() -> Self {
        Self::new().expect("Failed to create TelemetryState")
    }
}

// ========== 请求日志命令 ==========

/// 获取请求日志列表。
///
/// 这里只返回原始 `RequestLog` 浏览结果，便于排查 provider / model / status / token 等底层事实；
/// 不应把它当成 session / thread current 状态的唯一读取入口。
#[tauri::command]
pub async fn get_request_logs(
    state: tauri::State<'_, TelemetryState>,
    provider: Option<String>,
    model: Option<String>,
    status: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<RequestLog>, String> {
    let mut logs = state.logger.get_all();

    // 按 Provider 过滤
    if let Some(p) = provider {
        let provider_type: ProviderType = p.parse().map_err(|e: String| e)?;
        logs.retain(|l| l.provider == provider_type);
    }

    // 按模型过滤
    if let Some(m) = model {
        logs.retain(|l| l.model == m);
    }

    // 按状态过滤
    if let Some(s) = status {
        let req_status = match s.as_str() {
            "success" => RequestStatus::Success,
            "failed" => RequestStatus::Failed,
            "timeout" => RequestStatus::Timeout,
            "retrying" => RequestStatus::Retrying,
            "cancelled" => RequestStatus::Cancelled,
            _ => return Err(format!("Invalid status: {s}")),
        };
        logs.retain(|l| l.status == req_status);
    }

    // 按时间倒序排列
    logs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    // 限制数量
    if let Some(l) = limit {
        logs.truncate(l);
    }

    Ok(logs)
}

/// 获取单个请求日志详情。
///
/// 该命令只返回单条原始 request 记录，不承担 thread read、incident 或 evidence 事实源职责。
#[tauri::command]
pub async fn get_request_log_detail(
    state: tauri::State<'_, TelemetryState>,
    id: String,
) -> Result<Option<RequestLog>, String> {
    Ok(state.logger.get_by_id(&id))
}

/// 清空请求日志。
///
/// 这只影响原始 request log 浏览面，不应被解释为会话、线程或 evidence 历史被删除。
#[tauri::command]
pub async fn clear_request_logs(state: tauri::State<'_, TelemetryState>) -> Result<(), String> {
    state.logger.clear();
    Ok(())
}

// ========== 统计命令 ==========

/// 时间范围参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRangeParam {
    /// 开始时间 (ISO 8601 格式)
    pub start: Option<String>,
    /// 结束时间 (ISO 8601 格式)
    pub end: Option<String>,
    /// 或者使用预设范围: "1h", "24h", "7d", "30d"
    pub preset: Option<String>,
}

impl TimeRangeParam {
    fn to_time_range(&self) -> Result<Option<TimeRange>, String> {
        if let Some(preset) = &self.preset {
            let range = match preset.as_str() {
                "1h" => TimeRange::last_hours(1),
                "24h" => TimeRange::last_hours(24),
                "7d" => TimeRange::last_days(7),
                "30d" => TimeRange::last_days(30),
                _ => return Err(format!("Invalid preset: {preset}")),
            };
            return Ok(Some(range));
        }

        match (&self.start, &self.end) {
            (Some(s), Some(e)) => {
                let start = DateTime::parse_from_rfc3339(s)
                    .map_err(|e| format!("Invalid start time: {e}"))?
                    .with_timezone(&Utc);
                let end = DateTime::parse_from_rfc3339(e)
                    .map_err(|e| format!("Invalid end time: {e}"))?
                    .with_timezone(&Utc);
                Ok(Some(TimeRange::new(start, end)))
            }
            _ => Ok(None),
        }
    }
}

/// 获取统计摘要
#[tauri::command]
pub async fn get_stats_summary(
    state: tauri::State<'_, TelemetryState>,
    time_range: Option<TimeRangeParam>,
) -> Result<StatsSummary, String> {
    let range = time_range.map(|r| r.to_time_range()).transpose()?.flatten();
    let stats = state.stats.read();
    Ok(stats.summary(range))
}

/// 按 Provider 分组统计
#[tauri::command]
pub async fn get_stats_by_provider(
    state: tauri::State<'_, TelemetryState>,
    time_range: Option<TimeRangeParam>,
) -> Result<HashMap<String, ProviderStats>, String> {
    let range = time_range.map(|r| r.to_time_range()).transpose()?.flatten();
    let stats_guard = state.stats.read();
    let stats = stats_guard.by_provider(range);

    // 转换 key 为 String
    Ok(stats.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// 按模型分组统计
#[tauri::command]
pub async fn get_stats_by_model(
    state: tauri::State<'_, TelemetryState>,
    time_range: Option<TimeRangeParam>,
) -> Result<HashMap<String, ModelStats>, String> {
    let range = time_range.map(|r| r.to_time_range()).transpose()?.flatten();
    let stats = state.stats.read();
    Ok(stats.by_model(range))
}

// ========== Token 统计命令 ==========

/// 获取 Token 统计摘要
#[tauri::command]
pub async fn get_token_summary(
    state: tauri::State<'_, TelemetryState>,
    time_range: Option<TimeRangeParam>,
) -> Result<TokenStatsSummary, String> {
    let (start, end) = match time_range {
        Some(r) => {
            let range = r.to_time_range()?;
            match range {
                Some(tr) => (Some(tr.start), Some(tr.end)),
                None => (None, None),
            }
        }
        None => (None, None),
    };
    let tokens = state.tokens.read();
    Ok(tokens.summary(start, end))
}

/// 按 Provider 分组 Token 统计
#[tauri::command]
pub async fn get_token_stats_by_provider(
    state: tauri::State<'_, TelemetryState>,
    time_range: Option<TimeRangeParam>,
) -> Result<HashMap<String, ProviderTokenStats>, String> {
    let (start, end) = match time_range {
        Some(r) => {
            let range = r.to_time_range()?;
            match range {
                Some(tr) => (Some(tr.start), Some(tr.end)),
                None => (None, None),
            }
        }
        None => (None, None),
    };
    let tokens = state.tokens.read();
    let stats = tokens.by_provider(start, end);

    Ok(stats.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// 按模型分组 Token 统计
#[tauri::command]
pub async fn get_token_stats_by_model(
    state: tauri::State<'_, TelemetryState>,
    time_range: Option<TimeRangeParam>,
) -> Result<HashMap<String, ModelTokenStats>, String> {
    let (start, end) = match time_range {
        Some(r) => {
            let range = r.to_time_range()?;
            match range {
                Some(tr) => (Some(tr.start), Some(tr.end)),
                None => (None, None),
            }
        }
        None => (None, None),
    };
    let tokens = state.tokens.read();
    Ok(tokens.by_model(start, end))
}

/// 按天汇总 Token 统计
#[tauri::command]
pub async fn get_token_stats_by_day(
    state: tauri::State<'_, TelemetryState>,
    days: Option<i64>,
) -> Result<Vec<crate::telemetry::PeriodTokenStats>, String> {
    let tokens = state.tokens.read();
    Ok(tokens.by_day(days.unwrap_or(7)))
}
