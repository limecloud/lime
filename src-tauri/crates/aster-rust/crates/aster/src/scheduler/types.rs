//! 调度器类型定义
//!
//! 本模块定义调度器系统的核心类型，包括：
//! - `ScheduleType`: 调度类型枚举（At, Every, Cron）
//! - `CronPayload`: 任务载荷类型（SystemEvent, AgentTurn）
//! - `IsolationConfig`: 会话隔离配置
//! - `DeliveryConfig`: 结果投递配置
//! - `JobState`: 任务状态跟踪
//!
//! ## 设计参考
//!
//! 类型设计参考 OpenClaw 的 Cron/Scheduler 系统

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

// ============================================================================
// ScheduleType 枚举 (Task 1.2)
// ============================================================================

/// 调度类型枚举
///
/// 支持三种调度模式：
/// - `At`: 一次性定时执行
/// - `Every`: 固定间隔执行
/// - `Cron`: Cron 表达式调度
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ScheduleType {
    /// 一次性定时执行
    At {
        /// 执行时间戳（毫秒）
        #[serde(rename = "atMs")]
        at_ms: i64,
    },
    /// 固定间隔执行
    Every {
        /// 间隔时间（毫秒）
        #[serde(rename = "everyMs")]
        every_ms: u64,
        /// 锚点时间（毫秒），用于对齐执行时间
        #[serde(rename = "anchorMs", skip_serializing_if = "Option::is_none")]
        anchor_ms: Option<u64>,
    },
    /// Cron 表达式调度
    Cron {
        /// Cron 表达式（6 字段格式：秒 分 时 日 月 周）
        expr: String,
        /// 时区（IANA 格式，如 "Asia/Shanghai"）
        #[serde(skip_serializing_if = "Option::is_none")]
        tz: Option<String>,
    },
}

impl ScheduleType {
    /// 计算下次执行时间
    ///
    /// # 参数
    /// - `now`: 当前时间（UTC）
    ///
    /// # 返回值
    /// - `Some(DateTime<Utc>)`: 下次执行时间
    /// - `None`: 无下次执行（At 类型已过期）
    ///
    /// # 行为说明
    /// - **At 类型**: 如果 `at_ms > now` 返回执行时间，否则返回 `None`
    /// - **Every 类型**: 基于 anchor 和 interval 计算下一个执行点
    /// - **Cron 类型**: 使用 cron 表达式计算下次执行时间
    pub fn next_run_at(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        match self {
            ScheduleType::At { at_ms } => {
                let at_time = DateTime::from_timestamp_millis(*at_ms)?;
                if at_time > now {
                    Some(at_time)
                } else {
                    None
                }
            }
            ScheduleType::Every {
                every_ms,
                anchor_ms,
            } => {
                // 间隔必须大于 0
                if *every_ms == 0 {
                    return None;
                }

                let anchor = anchor_ms
                    .and_then(|ms| DateTime::from_timestamp_millis(ms as i64))
                    .unwrap_or(now);

                // 计算从锚点到现在经过的时间
                let elapsed_ms = (now - anchor).num_milliseconds();

                if elapsed_ms < 0 {
                    // 锚点在未来，下次执行就是锚点时间
                    Some(anchor)
                } else {
                    // 计算下一个执行点
                    let elapsed_u64 = elapsed_ms as u64;
                    let intervals_passed = elapsed_u64 / every_ms;
                    let next_offset_ms = (intervals_passed + 1) * every_ms;
                    Some(anchor + chrono::Duration::milliseconds(next_offset_ms as i64))
                }
            }
            ScheduleType::Cron { expr, tz } => Self::next_cron_run(expr, tz.as_deref(), now),
        }
    }

    /// 计算 Cron 表达式的下次执行时间
    ///
    /// # 参数
    /// - `expr`: Cron 表达式（6 字段格式）
    /// - `tz`: 可选时区（IANA 格式）
    /// - `now`: 当前时间（UTC）
    fn next_cron_run(expr: &str, tz: Option<&str>, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        // 解析 cron 表达式
        let schedule = Schedule::from_str(expr).ok()?;

        // 解析时区，默认使用 UTC
        let timezone: Tz = tz.and_then(|s| s.parse().ok()).unwrap_or(chrono_tz::UTC);

        // 将当前时间转换为指定时区
        let now_in_tz = now.with_timezone(&timezone);

        // 获取下一个执行时间
        schedule
            .after(&now_in_tz)
            .next()
            .map(|dt| dt.with_timezone(&Utc))
    }

    /// 从旧格式 cron 字符串迁移
    ///
    /// # 参数
    /// - `cron`: 旧格式的 cron 表达式
    ///
    /// # 返回值
    /// 返回 `ScheduleType::Cron`，时区默认为 `None`（使用系统本地时区）
    pub fn from_legacy_cron(cron: &str) -> Self {
        ScheduleType::Cron {
            expr: cron.to_string(),
            tz: None,
        }
    }

    /// 验证调度类型是否有效
    ///
    /// # 返回值
    /// - `Ok(())`: 验证通过
    /// - `Err(String)`: 验证失败，包含错误信息
    pub fn validate(&self) -> Result<(), String> {
        match self {
            ScheduleType::At { at_ms } => {
                if *at_ms <= 0 {
                    return Err("At schedule: at_ms must be positive".to_string());
                }
                Ok(())
            }
            ScheduleType::Every { every_ms, .. } => {
                if *every_ms == 0 {
                    return Err("Every schedule: every_ms must be greater than 0".to_string());
                }
                Ok(())
            }
            ScheduleType::Cron { expr, tz } => {
                // 验证 cron 表达式
                if Schedule::from_str(expr).is_err() {
                    return Err(format!("Invalid cron expression: {}", expr));
                }
                // 验证时区
                if let Some(tz_str) = tz {
                    if tz_str.parse::<Tz>().is_err() {
                        return Err(format!("Invalid timezone: {}", tz_str));
                    }
                }
                Ok(())
            }
        }
    }
}

// ============================================================================
// CronPayload 枚举 (Task 2.1)
// ============================================================================

/// 任务载荷类型
///
/// 定义调度任务执行的内容，支持两种类型：
/// - `SystemEvent`: 系统事件，简单文本消息
/// - `AgentTurn`: Agent 执行，支持丰富的配置选项
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::CronPayload;
///
/// // 创建系统事件
/// let event = CronPayload::SystemEvent {
///     text: "Daily backup completed".to_string(),
/// };
///
/// // 创建 Agent 执行任务
/// let agent_task = CronPayload::AgentTurn {
///     message: "Generate daily report".to_string(),
///     model: Some("gpt-4".to_string()),
///     thinking: Some("low".to_string()),
///     timeout_seconds: Some(300),
///     deliver: Some(true),
///     channel: Some("slack".to_string()),
///     to: Some("#reports".to_string()),
///     best_effort_deliver: Some(true),
/// };
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CronPayload {
    /// 系统事件（简单文本消息）
    ///
    /// 用于触发简单的系统通知或事件，不涉及 Agent 执行。
    SystemEvent {
        /// 事件文本
        text: String,
    },
    /// Agent 执行
    ///
    /// 触发 Agent 执行指定的任务，支持模型覆盖、思考级别、超时等配置。
    AgentTurn {
        /// 发送给 Agent 的消息
        message: String,
        /// 模型覆盖（provider/model 或别名）
        ///
        /// 例如: "openai/gpt-4", "claude-3-opus", "gpt-4"
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        /// 思考级别
        ///
        /// 控制 Agent 的思考深度，可选值如: "low", "medium", "high"
        #[serde(skip_serializing_if = "Option::is_none")]
        thinking: Option<String>,
        /// 超时时间（秒）
        ///
        /// Agent 执行的最大时间限制
        #[serde(rename = "timeoutSeconds", skip_serializing_if = "Option::is_none")]
        timeout_seconds: Option<u64>,
        /// 是否投递结果
        ///
        /// 控制是否将执行结果投递到指定渠道
        #[serde(skip_serializing_if = "Option::is_none")]
        deliver: Option<bool>,
        /// 投递渠道
        ///
        /// 结果投递的目标渠道，如 "slack", "telegram", "email"
        #[serde(skip_serializing_if = "Option::is_none")]
        channel: Option<String>,
        /// 投递目标
        ///
        /// 渠道内的具体目标，如 Slack 频道名、邮箱地址等
        #[serde(skip_serializing_if = "Option::is_none")]
        to: Option<String>,
        /// 是否尽力投递（失败不报错）
        ///
        /// 当设置为 true 时，投递失败不会导致任务失败
        #[serde(rename = "bestEffortDeliver", skip_serializing_if = "Option::is_none")]
        best_effort_deliver: Option<bool>,
    },
}

impl CronPayload {
    /// 获取任务的文本内容
    ///
    /// 返回任务的主要文本内容：
    /// - 对于 `SystemEvent`，返回事件文本
    /// - 对于 `AgentTurn`，返回发送给 Agent 的消息
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::CronPayload;
    ///
    /// let event = CronPayload::SystemEvent {
    ///     text: "Hello".to_string(),
    /// };
    /// assert_eq!(event.get_text(), "Hello");
    ///
    /// let task = CronPayload::AgentTurn {
    ///     message: "Generate report".to_string(),
    ///     model: None,
    ///     thinking: None,
    ///     timeout_seconds: None,
    ///     deliver: None,
    ///     channel: None,
    ///     to: None,
    ///     best_effort_deliver: None,
    /// };
    /// assert_eq!(task.get_text(), "Generate report");
    /// ```
    pub fn get_text(&self) -> &str {
        match self {
            CronPayload::SystemEvent { text } => text,
            CronPayload::AgentTurn { message, .. } => message,
        }
    }

    /// 从旧格式 Recipe 迁移
    ///
    /// 将旧格式的 prompt 字符串转换为 `AgentTurn` 载荷。
    /// 所有可选配置字段都设置为 `None`，使用默认行为。
    ///
    /// # 参数
    /// - `prompt`: 旧格式的 prompt 字符串
    ///
    /// # 返回值
    /// 返回 `CronPayload::AgentTurn`，message 设置为 prompt，其他字段为 None
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::CronPayload;
    ///
    /// let payload = CronPayload::from_legacy_recipe("Generate daily report");
    /// assert_eq!(payload.get_text(), "Generate daily report");
    ///
    /// match payload {
    ///     CronPayload::AgentTurn { model, thinking, timeout_seconds, .. } => {
    ///         assert!(model.is_none());
    ///         assert!(thinking.is_none());
    ///         assert!(timeout_seconds.is_none());
    ///     }
    ///     _ => panic!("Expected AgentTurn"),
    /// }
    /// ```
    pub fn from_legacy_recipe(prompt: &str) -> Self {
        CronPayload::AgentTurn {
            message: prompt.to_string(),
            model: None,
            thinking: None,
            timeout_seconds: None,
            deliver: None,
            channel: None,
            to: None,
            best_effort_deliver: None,
        }
    }

    /// 创建一个简单的系统事件
    ///
    /// # 参数
    /// - `text`: 事件文本
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::CronPayload;
    ///
    /// let event = CronPayload::system_event("Backup completed");
    /// assert_eq!(event.get_text(), "Backup completed");
    /// ```
    pub fn system_event(text: impl Into<String>) -> Self {
        CronPayload::SystemEvent { text: text.into() }
    }

    /// 创建一个简单的 Agent 执行任务
    ///
    /// # 参数
    /// - `message`: 发送给 Agent 的消息
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::CronPayload;
    ///
    /// let task = CronPayload::agent_turn("Generate report");
    /// assert_eq!(task.get_text(), "Generate report");
    /// ```
    pub fn agent_turn(message: impl Into<String>) -> Self {
        CronPayload::AgentTurn {
            message: message.into(),
            model: None,
            thinking: None,
            timeout_seconds: None,
            deliver: None,
            channel: None,
            to: None,
            best_effort_deliver: None,
        }
    }

    /// 检查是否为系统事件
    pub fn is_system_event(&self) -> bool {
        matches!(self, CronPayload::SystemEvent { .. })
    }

    /// 检查是否为 Agent 执行任务
    pub fn is_agent_turn(&self) -> bool {
        matches!(self, CronPayload::AgentTurn { .. })
    }

    /// 获取模型覆盖配置（仅对 AgentTurn 有效）
    pub fn get_model(&self) -> Option<&str> {
        match self {
            CronPayload::AgentTurn { model, .. } => model.as_deref(),
            _ => None,
        }
    }

    /// 获取思考级别配置（仅对 AgentTurn 有效）
    pub fn get_thinking(&self) -> Option<&str> {
        match self {
            CronPayload::AgentTurn { thinking, .. } => thinking.as_deref(),
            _ => None,
        }
    }

    /// 获取超时配置（仅对 AgentTurn 有效）
    pub fn get_timeout_seconds(&self) -> Option<u64> {
        match self {
            CronPayload::AgentTurn {
                timeout_seconds, ..
            } => *timeout_seconds,
            _ => None,
        }
    }
}

// ============================================================================
// PostToMainMode 枚举 (Task 2.2)
// ============================================================================

/// 结果回传模式
///
/// 控制隔离会话执行结果如何回传到主会话：
/// - `Summary`: 摘要模式，只发送简短的状态信息
/// - `Full`: 完整模式，发送完整的 Agent 输出（可能被截断）
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::PostToMainMode;
///
/// // 默认为 Summary 模式
/// let mode = PostToMainMode::default();
/// assert_eq!(mode, PostToMainMode::Summary);
///
/// // 使用 Full 模式获取完整输出
/// let full_mode = PostToMainMode::Full;
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PostToMainMode {
    /// 摘要模式：简短状态信息
    ///
    /// 只回传任务执行的状态摘要，如 "任务完成" 或 "任务失败: 错误信息"
    #[default]
    Summary,
    /// 完整模式：完整 Agent 输出
    ///
    /// 回传完整的 Agent 输出内容，如果超过 `post_to_main_max_chars` 限制则截断
    Full,
}

// ============================================================================
// IsolationConfig 结构体 (Task 2.2)
// ============================================================================

/// 默认最大字符数
///
/// 用于 `IsolationConfig::post_to_main_max_chars` 的默认值
fn default_max_chars() -> usize {
    8000
}

/// 会话隔离配置
///
/// 控制调度任务是否在隔离会话中执行，以及如何将执行结果回传到主会话。
///
/// # 设计目的
///
/// 隔离执行可以防止调度任务影响主会话的状态，同时允许将执行结果
/// 以摘要或完整形式回传给用户。
///
/// # 字段说明
///
/// - `enabled`: 是否启用隔离执行
/// - `post_to_main_prefix`: 回传消息的前缀，用于标识消息来源
/// - `post_to_main_mode`: 回传模式（摘要或完整）
/// - `post_to_main_max_chars`: 完整模式下的最大字符数限制
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::{IsolationConfig, PostToMainMode};
///
/// // 使用默认配置（禁用隔离）
/// let default_config = IsolationConfig::default();
/// assert!(!default_config.enabled);
///
/// // 启用隔离，使用摘要模式
/// let summary_config = IsolationConfig {
///     enabled: true,
///     post_to_main_prefix: Some("[定时任务]".to_string()),
///     post_to_main_mode: PostToMainMode::Summary,
///     post_to_main_max_chars: 8000,
/// };
///
/// // 启用隔离，使用完整模式
/// let full_config = IsolationConfig {
///     enabled: true,
///     post_to_main_prefix: Some("[报告]".to_string()),
///     post_to_main_mode: PostToMainMode::Full,
///     post_to_main_max_chars: 16000,
/// };
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IsolationConfig {
    /// 是否启用隔离
    ///
    /// 当设置为 `true` 时，任务将在独立的隔离会话中执行，
    /// 不会影响主会话的状态。
    #[serde(default)]
    pub enabled: bool,

    /// 回传消息前缀
    ///
    /// 可选的前缀字符串，用于标识回传消息的来源。
    /// 例如: "[定时任务]"、"[每日报告]"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_to_main_prefix: Option<String>,

    /// 回传模式
    ///
    /// 控制如何将执行结果回传到主会话：
    /// - `Summary`: 只发送简短的状态摘要
    /// - `Full`: 发送完整的 Agent 输出
    #[serde(default)]
    pub post_to_main_mode: PostToMainMode,

    /// 完整模式最大字符数
    ///
    /// 当 `post_to_main_mode` 为 `Full` 时，限制回传内容的最大字符数。
    /// 超过此限制的内容将被截断。默认值为 8000。
    #[serde(default = "default_max_chars")]
    pub post_to_main_max_chars: usize,
}

impl Default for IsolationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            post_to_main_prefix: None,
            post_to_main_mode: PostToMainMode::Summary,
            post_to_main_max_chars: default_max_chars(),
        }
    }
}

impl IsolationConfig {
    /// 创建一个启用隔离的配置（摘要模式）
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::IsolationConfig;
    ///
    /// let config = IsolationConfig::enabled_summary();
    /// assert!(config.enabled);
    /// ```
    pub fn enabled_summary() -> Self {
        Self {
            enabled: true,
            post_to_main_prefix: None,
            post_to_main_mode: PostToMainMode::Summary,
            post_to_main_max_chars: default_max_chars(),
        }
    }

    /// 创建一个启用隔离的配置（完整模式）
    ///
    /// # 参数
    /// - `max_chars`: 可选的最大字符数限制，默认为 8000
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::IsolationConfig;
    ///
    /// let config = IsolationConfig::enabled_full(Some(16000));
    /// assert!(config.enabled);
    /// ```
    pub fn enabled_full(max_chars: Option<usize>) -> Self {
        Self {
            enabled: true,
            post_to_main_prefix: None,
            post_to_main_mode: PostToMainMode::Full,
            post_to_main_max_chars: max_chars.unwrap_or_else(default_max_chars),
        }
    }

    /// 设置回传消息前缀
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::IsolationConfig;
    ///
    /// let config = IsolationConfig::enabled_summary()
    ///     .with_prefix("[定时任务]");
    /// assert_eq!(config.post_to_main_prefix, Some("[定时任务]".to_string()));
    /// ```
    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.post_to_main_prefix = Some(prefix.into());
        self
    }

    /// 截断输出内容到最大字符数
    ///
    /// 当 `post_to_main_mode` 为 `Full` 时，使用此方法截断过长的输出。
    ///
    /// # 参数
    /// - `output`: 原始输出内容
    ///
    /// # 返回值
    /// 截断后的输出内容（如果需要截断，会添加 "..." 后缀）
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::IsolationConfig;
    ///
    /// let config = IsolationConfig {
    ///     post_to_main_max_chars: 10,
    ///     ..Default::default()
    /// };
    ///
    /// let truncated = config.truncate_output("Hello, World!");
    /// assert_eq!(truncated, "Hello, Wor...");
    /// ```
    pub fn truncate_output(&self, output: &str) -> String {
        let char_count = output.chars().count();
        if char_count <= self.post_to_main_max_chars {
            output.to_string()
        } else {
            // 按字符边界截断，避免截断 UTF-8 字符
            let truncated: String = output.chars().take(self.post_to_main_max_chars).collect();
            format!("{}...", truncated)
        }
    }

    /// 格式化回传消息
    ///
    /// 根据配置格式化要回传到主会话的消息，包括添加前缀和截断。
    ///
    /// # 参数
    /// - `output`: 原始输出内容
    ///
    /// # 返回值
    /// 格式化后的消息
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::{IsolationConfig, PostToMainMode};
    ///
    /// let config = IsolationConfig {
    ///     enabled: true,
    ///     post_to_main_prefix: Some("[任务]".to_string()),
    ///     post_to_main_mode: PostToMainMode::Full,
    ///     post_to_main_max_chars: 100,
    /// };
    ///
    /// let message = config.format_message("任务执行完成");
    /// assert!(message.starts_with("[任务] "));
    /// ```
    pub fn format_message(&self, output: &str) -> String {
        let content = match self.post_to_main_mode {
            PostToMainMode::Summary => output.to_string(),
            PostToMainMode::Full => self.truncate_output(output),
        };

        match &self.post_to_main_prefix {
            Some(prefix) => format!("{} {}", prefix, content),
            None => content,
        }
    }
}

// ============================================================================
// DeliveryConfig 结构体 (Task 2.3)
// ============================================================================

/// 结果投递配置
///
/// 控制调度任务执行结果的投递行为，支持将结果发送到指定的渠道和目标。
///
/// # 设计目的
///
/// 投递配置允许用户将任务执行结果自动发送到外部渠道（如 Slack、Telegram、Email 等），
/// 实现任务完成通知或结果分发。
///
/// # 字段说明
///
/// - `enabled`: 是否启用投递功能
/// - `channel`: 投递渠道（如 "slack", "telegram", "email"）
/// - `to`: 渠道内的具体目标（如频道名、邮箱地址）
/// - `best_effort`: 是否尽力投递（失败时不报错）
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::DeliveryConfig;
///
/// // 使用默认配置（禁用投递）
/// let default_config = DeliveryConfig::default();
/// assert!(!default_config.enabled);
///
/// // 启用投递到 Slack
/// let slack_config = DeliveryConfig {
///     enabled: true,
///     channel: Some("slack".to_string()),
///     to: Some("#reports".to_string()),
///     best_effort: true,
/// };
///
/// // 启用投递到邮箱（严格模式）
/// let email_config = DeliveryConfig {
///     enabled: true,
///     channel: Some("email".to_string()),
///     to: Some("admin@example.com".to_string()),
///     best_effort: false,  // 投递失败会报错
/// };
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryConfig {
    /// 是否启用投递
    ///
    /// 当设置为 `true` 时，任务执行完成后会尝试将结果投递到指定渠道。
    /// 默认为 `false`。
    #[serde(default)]
    pub enabled: bool,

    /// 投递渠道
    ///
    /// 指定结果投递的目标渠道，如 "slack", "telegram", "email", "discord" 等。
    /// 具体支持的渠道取决于系统配置。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,

    /// 投递目标
    ///
    /// 渠道内的具体目标地址，格式取决于渠道类型：
    /// - Slack: 频道名（如 "#reports"）或用户 ID
    /// - Telegram: 聊天 ID 或用户名
    /// - Email: 邮箱地址
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,

    /// 是否尽力投递（失败不报错）
    ///
    /// 当设置为 `true` 时，投递失败只会记录警告日志，不会导致任务失败。
    /// 当设置为 `false` 时，投递失败会被报告为任务错误。
    /// 默认为 `true`。
    #[serde(default = "default_best_effort")]
    pub best_effort: bool,
}

/// 默认 best_effort 值
///
/// 用于 `DeliveryConfig::best_effort` 的默认值
fn default_best_effort() -> bool {
    true
}

impl Default for DeliveryConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            channel: None,
            to: None,
            best_effort: true,
        }
    }
}

impl DeliveryConfig {
    /// 创建一个启用投递的配置
    ///
    /// # 参数
    /// - `channel`: 投递渠道
    /// - `to`: 投递目标
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::DeliveryConfig;
    ///
    /// let config = DeliveryConfig::enabled("slack", "#reports");
    /// assert!(config.enabled);
    /// assert_eq!(config.channel, Some("slack".to_string()));
    /// assert_eq!(config.to, Some("#reports".to_string()));
    /// assert!(config.best_effort);  // 默认为 true
    /// ```
    pub fn enabled(channel: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            enabled: true,
            channel: Some(channel.into()),
            to: Some(to.into()),
            best_effort: true,
        }
    }

    /// 创建一个启用投递的配置（严格模式）
    ///
    /// 与 `enabled` 类似，但 `best_effort` 设置为 `false`，
    /// 投递失败会导致任务报错。
    ///
    /// # 参数
    /// - `channel`: 投递渠道
    /// - `to`: 投递目标
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::DeliveryConfig;
    ///
    /// let config = DeliveryConfig::enabled_strict("email", "admin@example.com");
    /// assert!(config.enabled);
    /// assert!(!config.best_effort);  // 严格模式
    /// ```
    pub fn enabled_strict(channel: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            enabled: true,
            channel: Some(channel.into()),
            to: Some(to.into()),
            best_effort: false,
        }
    }

    /// 设置为尽力投递模式
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::DeliveryConfig;
    ///
    /// let config = DeliveryConfig::enabled_strict("slack", "#reports")
    ///     .with_best_effort(true);
    /// assert!(config.best_effort);
    /// ```
    pub fn with_best_effort(mut self, best_effort: bool) -> Self {
        self.best_effort = best_effort;
        self
    }

    /// 检查配置是否有效
    ///
    /// 如果启用了投递，则必须指定渠道和目标。
    ///
    /// # 返回值
    /// - `Ok(())`: 配置有效
    /// - `Err(String)`: 配置无效，包含错误信息
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::DeliveryConfig;
    ///
    /// // 禁用投递时，配置总是有效的
    /// let disabled = DeliveryConfig::default();
    /// assert!(disabled.validate().is_ok());
    ///
    /// // 启用投递但缺少渠道
    /// let invalid = DeliveryConfig {
    ///     enabled: true,
    ///     channel: None,
    ///     to: Some("target".to_string()),
    ///     best_effort: true,
    /// };
    /// assert!(invalid.validate().is_err());
    /// ```
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        if self.channel.is_none() {
            return Err("DeliveryConfig: channel is required when enabled".to_string());
        }

        if self.to.is_none() {
            return Err("DeliveryConfig: to is required when enabled".to_string());
        }

        Ok(())
    }

    /// 检查是否应该投递
    ///
    /// 只有当 `enabled` 为 `true` 且配置有效时才应该投递。
    pub fn should_deliver(&self) -> bool {
        self.enabled && self.channel.is_some() && self.to.is_some()
    }
}

// ============================================================================
// JobStatus 枚举 (Task 4.1)
// ============================================================================

/// 任务执行状态
///
/// 表示调度任务上次执行的结果状态：
/// - `Ok`: 执行成功
/// - `Error`: 执行失败
/// - `Skipped`: 跳过执行（如任务被禁用或条件不满足）
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::JobStatus;
///
/// // 默认状态为 Ok
/// let status = JobStatus::default();
/// assert_eq!(status, JobStatus::Ok);
///
/// // 检查状态
/// let error_status = JobStatus::Error;
/// assert!(error_status.is_error());
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    /// 执行成功
    #[default]
    Ok,
    /// 执行失败
    Error,
    /// 跳过执行
    Skipped,
}

impl JobStatus {
    /// 检查是否为成功状态
    pub fn is_ok(&self) -> bool {
        matches!(self, JobStatus::Ok)
    }

    /// 检查是否为错误状态
    pub fn is_error(&self) -> bool {
        matches!(self, JobStatus::Error)
    }

    /// 检查是否为跳过状态
    pub fn is_skipped(&self) -> bool {
        matches!(self, JobStatus::Skipped)
    }
}

// ============================================================================
// JobState 结构体 (Task 4.1)
// ============================================================================

/// 任务状态
///
/// 跟踪调度任务的运行时状态，包括执行时间、状态和错误信息。
///
/// # 设计目的
///
/// JobState 用于监控和调试调度任务：
/// - 跟踪下次执行时间，便于预览调度计划
/// - 记录当前执行状态，检测长时间运行的任务
/// - 保存历史执行信息，用于故障排查和性能分析
///
/// # 字段说明
///
/// - `next_run_at_ms`: 下次计划执行时间（毫秒时间戳）
/// - `running_at_ms`: 当前执行开始时间（毫秒时间戳），任务运行时设置
/// - `last_run_at_ms`: 上次执行完成时间（毫秒时间戳）
/// - `last_status`: 上次执行结果状态
/// - `last_error`: 上次执行失败时的错误信息
/// - `last_duration_ms`: 上次执行耗时（毫秒）
///
/// # 需求映射
///
/// - **Requirement 7.1**: next_run_at_ms 跟踪下次执行时间
/// - **Requirement 7.2**: running_at_ms 跟踪当前执行开始时间
/// - **Requirement 7.3**: last_run_at_ms 跟踪上次执行时间
/// - **Requirement 7.4**: last_status 跟踪执行状态（Ok, Error, Skipped）
/// - **Requirement 7.5**: last_error 记录失败时的错误信息
/// - **Requirement 7.6**: last_duration_ms 记录执行耗时
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::{JobState, JobStatus};
///
/// // 创建默认状态（所有字段为 None）
/// let state = JobState::default();
/// assert!(state.next_run_at_ms.is_none());
/// assert!(!state.is_running());
///
/// // 创建带有执行历史的状态
/// let state = JobState {
///     next_run_at_ms: Some(1704153600000),
///     running_at_ms: None,
///     last_run_at_ms: Some(1704067200000),
///     last_status: Some(JobStatus::Ok),
///     last_error: None,
///     last_duration_ms: Some(1500),
/// };
/// assert!(state.last_status.as_ref().map_or(false, |s| s.is_ok()));
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct JobState {
    /// 下次执行时间（毫秒时间戳）
    ///
    /// 调度器计算的下次计划执行时间。
    /// 对于 At 类型任务，执行后此字段变为 None。
    ///
    /// **Validates: Requirement 7.1**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at_ms: Option<i64>,

    /// 当前执行开始时间（毫秒时间戳）
    ///
    /// 任务开始执行时设置，执行完成后清除。
    /// 可用于检测长时间运行或卡住的任务。
    ///
    /// **Validates: Requirement 7.2**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running_at_ms: Option<i64>,

    /// 上次执行时间（毫秒时间戳）
    ///
    /// 任务上次执行完成的时间（无论成功或失败）。
    ///
    /// **Validates: Requirement 7.3**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at_ms: Option<i64>,

    /// 上次执行状态
    ///
    /// 记录任务上次执行的结果：
    /// - `Ok`: 执行成功
    /// - `Error`: 执行失败
    /// - `Skipped`: 跳过执行
    ///
    /// **Validates: Requirement 7.4**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_status: Option<JobStatus>,

    /// 上次错误信息
    ///
    /// 当 `last_status` 为 `Error` 时，记录错误详情。
    /// 成功执行后此字段会被清除。
    ///
    /// **Validates: Requirement 7.5**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,

    /// 上次执行耗时（毫秒）
    ///
    /// 记录任务上次执行的持续时间，用于性能监控。
    ///
    /// **Validates: Requirement 7.6**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_duration_ms: Option<u64>,
}

impl JobState {
    /// 创建一个新的空状态
    ///
    /// 所有字段都初始化为 None。
    pub fn new() -> Self {
        Self::default()
    }

    /// 检查任务是否正在运行
    ///
    /// 如果 `running_at_ms` 有值，表示任务正在执行中。
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::JobState;
    ///
    /// let mut state = JobState::default();
    /// assert!(!state.is_running());
    ///
    /// state.running_at_ms = Some(1704067200000);
    /// assert!(state.is_running());
    /// ```
    pub fn is_running(&self) -> bool {
        self.running_at_ms.is_some()
    }

    /// 标记任务开始执行
    ///
    /// 设置 `running_at_ms` 为当前时间。
    ///
    /// # 参数
    /// - `now_ms`: 当前时间戳（毫秒）
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::JobState;
    /// use chrono::Utc;
    ///
    /// let mut state = JobState::default();
    /// let now_ms = Utc::now().timestamp_millis();
    /// state.mark_running(now_ms);
    ///
    /// assert!(state.is_running());
    /// assert_eq!(state.running_at_ms, Some(now_ms));
    /// ```
    pub fn mark_running(&mut self, now_ms: i64) {
        self.running_at_ms = Some(now_ms);
    }

    /// 标记任务执行成功
    ///
    /// 更新状态字段：
    /// - 清除 `running_at_ms`
    /// - 设置 `last_run_at_ms` 为当前时间
    /// - 设置 `last_status` 为 `Ok`
    /// - 清除 `last_error`
    /// - 设置 `last_duration_ms`
    ///
    /// # 参数
    /// - `now_ms`: 当前时间戳（毫秒）
    /// - `duration_ms`: 执行耗时（毫秒）
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::{JobState, JobStatus};
    ///
    /// let mut state = JobState::default();
    /// state.mark_running(1704067200000);
    /// state.mark_completed(1704067201500, 1500);
    ///
    /// assert!(!state.is_running());
    /// assert_eq!(state.last_status, Some(JobStatus::Ok));
    /// assert_eq!(state.last_duration_ms, Some(1500));
    /// assert!(state.last_error.is_none());
    /// ```
    pub fn mark_completed(&mut self, now_ms: i64, duration_ms: u64) {
        self.running_at_ms = None;
        self.last_run_at_ms = Some(now_ms);
        self.last_status = Some(JobStatus::Ok);
        self.last_error = None;
        self.last_duration_ms = Some(duration_ms);
    }

    /// 标记任务执行失败
    ///
    /// 更新状态字段：
    /// - 清除 `running_at_ms`
    /// - 设置 `last_run_at_ms` 为当前时间
    /// - 设置 `last_status` 为 `Error`
    /// - 设置 `last_error` 为错误信息
    /// - 设置 `last_duration_ms`
    ///
    /// # 参数
    /// - `now_ms`: 当前时间戳（毫秒）
    /// - `duration_ms`: 执行耗时（毫秒）
    /// - `error`: 错误信息
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::{JobState, JobStatus};
    ///
    /// let mut state = JobState::default();
    /// state.mark_running(1704067200000);
    /// state.mark_failed(1704067201500, 1500, "Connection timeout");
    ///
    /// assert!(!state.is_running());
    /// assert_eq!(state.last_status, Some(JobStatus::Error));
    /// assert_eq!(state.last_error, Some("Connection timeout".to_string()));
    /// ```
    pub fn mark_failed(&mut self, now_ms: i64, duration_ms: u64, error: impl Into<String>) {
        self.running_at_ms = None;
        self.last_run_at_ms = Some(now_ms);
        self.last_status = Some(JobStatus::Error);
        self.last_error = Some(error.into());
        self.last_duration_ms = Some(duration_ms);
    }

    /// 标记任务被跳过
    ///
    /// 更新状态字段：
    /// - 清除 `running_at_ms`
    /// - 设置 `last_run_at_ms` 为当前时间
    /// - 设置 `last_status` 为 `Skipped`
    /// - 清除 `last_error`
    /// - 设置 `last_duration_ms` 为 0
    ///
    /// # 参数
    /// - `now_ms`: 当前时间戳（毫秒）
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::{JobState, JobStatus};
    ///
    /// let mut state = JobState::default();
    /// state.mark_skipped(1704067200000);
    ///
    /// assert!(!state.is_running());
    /// assert_eq!(state.last_status, Some(JobStatus::Skipped));
    /// assert_eq!(state.last_duration_ms, Some(0));
    /// ```
    pub fn mark_skipped(&mut self, now_ms: i64) {
        self.running_at_ms = None;
        self.last_run_at_ms = Some(now_ms);
        self.last_status = Some(JobStatus::Skipped);
        self.last_error = None;
        self.last_duration_ms = Some(0);
    }

    /// 设置下次执行时间
    ///
    /// # 参数
    /// - `next_run_at_ms`: 下次执行时间戳（毫秒），None 表示无下次执行
    pub fn set_next_run(&mut self, next_run_at_ms: Option<i64>) {
        self.next_run_at_ms = next_run_at_ms;
    }

    /// 获取上次执行是否成功
    ///
    /// 如果 `last_status` 为 `Ok` 返回 true，否则返回 false。
    /// 如果从未执行过（`last_status` 为 None），返回 false。
    pub fn was_successful(&self) -> bool {
        self.last_status.as_ref().is_some_and(|s| s.is_ok())
    }

    /// 获取上次执行是否失败
    ///
    /// 如果 `last_status` 为 `Error` 返回 true，否则返回 false。
    pub fn was_failed(&self) -> bool {
        self.last_status.as_ref().is_some_and(|s| s.is_error())
    }

    /// 重置状态
    ///
    /// 清除所有运行时状态，保留 `next_run_at_ms`。
    pub fn reset(&mut self) {
        self.running_at_ms = None;
        self.last_run_at_ms = None;
        self.last_status = None;
        self.last_error = None;
        self.last_duration_ms = None;
    }
}

// ============================================================================
// SessionTarget 枚举 (Task 4.2)
// ============================================================================

/// 会话目标
///
/// 控制调度任务在哪个会话中执行：
/// - `Main`: 在主会话中执行
/// - `Isolated`: 在隔离会话中执行
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::SessionTarget;
///
/// // 默认为 Main
/// let target = SessionTarget::default();
/// assert_eq!(target, SessionTarget::Main);
///
/// // 使用隔离会话
/// let isolated = SessionTarget::Isolated;
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SessionTarget {
    /// 主会话：在主会话中执行任务
    #[default]
    Main,
    /// 隔离会话：在独立的隔离会话中执行任务
    Isolated,
}

impl SessionTarget {
    /// 检查是否为主会话
    pub fn is_main(&self) -> bool {
        matches!(self, SessionTarget::Main)
    }

    /// 检查是否为隔离会话
    pub fn is_isolated(&self) -> bool {
        matches!(self, SessionTarget::Isolated)
    }
}

// ============================================================================
// WakeMode 枚举 (Task 4.2)
// ============================================================================

/// 唤醒模式
///
/// 控制调度任务触发时的唤醒行为：
/// - `NextHeartbeat`: 等待下一次心跳时执行
/// - `Now`: 立即执行
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::WakeMode;
///
/// // 默认为 NextHeartbeat
/// let mode = WakeMode::default();
/// assert_eq!(mode, WakeMode::NextHeartbeat);
///
/// // 立即执行
/// let now = WakeMode::Now;
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WakeMode {
    /// 下次心跳：等待下一次心跳时执行任务
    #[default]
    NextHeartbeat,
    /// 立即执行：触发时立即执行任务
    Now,
}

impl WakeMode {
    /// 检查是否为下次心跳模式
    pub fn is_next_heartbeat(&self) -> bool {
        matches!(self, WakeMode::NextHeartbeat)
    }

    /// 检查是否为立即执行模式
    pub fn is_now(&self) -> bool {
        matches!(self, WakeMode::Now)
    }
}

// ============================================================================
// ScheduledJob 结构体 (Task 4.2)
// ============================================================================

/// 默认 enabled 值为 true
fn default_true() -> bool {
    true
}

/// 调度任务
///
/// 完整的调度任务定义，包含任务标识、调度配置、执行配置和运行时状态。
///
/// # 设计目的
///
/// ScheduledJob 是调度系统的核心数据结构，用于：
/// - 定义任务的调度时间和方式
/// - 配置任务的执行行为（隔离、投递等）
/// - 跟踪任务的运行时状态
/// - 支持向后兼容旧格式任务
///
/// # 字段说明
///
/// ## 基本信息
/// - `id`: 任务唯一标识符
/// - `agent_id`: 关联的 Agent ID（可选）
/// - `name`: 人类可读的任务名称
/// - `description`: 任务描述（可选）
///
/// ## 控制标志
/// - `enabled`: 是否启用任务
/// - `delete_after_run`: 执行后是否删除（一次性任务）
///
/// ## 时间戳
/// - `created_at_ms`: 创建时间（毫秒）
/// - `updated_at_ms`: 更新时间（毫秒）
///
/// ## 调度配置
/// - `schedule`: 调度类型（At, Every, Cron）
/// - `session_target`: 会话目标（Main, Isolated）
/// - `wake_mode`: 唤醒模式（NextHeartbeat, Now）
///
/// ## 执行配置
/// - `payload`: 任务载荷（SystemEvent, AgentTurn）
/// - `isolation`: 隔离配置（可选）
/// - `delivery`: 投递配置（可选）
///
/// ## 运行时状态
/// - `state`: 任务状态跟踪
///
/// ## 向后兼容字段
/// - `source`: 旧格式 Recipe 源文件路径
/// - `cron`: 旧格式 Cron 表达式
///
/// # 需求映射
///
/// - **Requirement 6.1**: name 字段用于人类可读标识
/// - **Requirement 6.2**: description 字段为可选描述
/// - **Requirement 6.3**: enabled 标志控制任务激活
/// - **Requirement 6.4**: delete_after_run 标志用于一次性任务
/// - **Requirement 6.5**: schedule 字段为 ScheduleType 类型
/// - **Requirement 6.6**: payload 字段为 CronPayload 类型
/// - **Requirement 6.7**: isolation 字段为可选 IsolationConfig
/// - **Requirement 6.8**: state 字段为 JobState 类型
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::types::{
///     ScheduledJob, ScheduleType, CronPayload, SessionTarget, WakeMode, JobState
/// };
/// use chrono::Utc;
///
/// let job = ScheduledJob {
///     id: "daily-report".to_string(),
///     agent_id: None,
///     name: "Daily Report".to_string(),
///     description: Some("Generate daily status report".to_string()),
///     enabled: true,
///     delete_after_run: false,
///     created_at_ms: Utc::now().timestamp_millis(),
///     updated_at_ms: Utc::now().timestamp_millis(),
///     schedule: ScheduleType::Cron {
///         expr: "0 0 9 * * *".to_string(),
///         tz: Some("Asia/Shanghai".to_string()),
///     },
///     session_target: SessionTarget::Isolated,
///     wake_mode: WakeMode::Now,
///     payload: CronPayload::agent_turn("Generate today's status report"),
///     isolation: None,
///     delivery: None,
///     state: JobState::default(),
///     source: None,
///     cron: None,
/// };
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledJob {
    /// 任务 ID
    ///
    /// 任务的唯一标识符，用于引用和管理任务。
    pub id: String,

    /// Agent ID（可选）
    ///
    /// 关联的 Agent 标识符，用于指定任务由哪个 Agent 执行。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,

    /// 任务名称
    ///
    /// 人类可读的任务名称，用于显示和识别。
    ///
    /// **Validates: Requirement 6.1**
    pub name: String,

    /// 任务描述
    ///
    /// 可选的任务描述，提供更详细的任务说明。
    ///
    /// **Validates: Requirement 6.2**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 是否启用
    ///
    /// 控制任务是否激活。禁用的任务不会被调度执行。
    /// 默认为 true。
    ///
    /// **Validates: Requirement 6.3**
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// 执行后删除（一次性任务）
    ///
    /// 当设置为 true 时，任务执行完成后会自动从任务列表中删除。
    /// 适用于一次性定时任务。默认为 false。
    ///
    /// **Validates: Requirement 6.4**
    #[serde(default)]
    pub delete_after_run: bool,

    /// 创建时间（毫秒时间戳）
    pub created_at_ms: i64,

    /// 更新时间（毫秒时间戳）
    pub updated_at_ms: i64,

    /// 调度类型
    ///
    /// 定义任务的调度方式：At（一次性）、Every（固定间隔）、Cron（表达式）。
    ///
    /// **Validates: Requirement 6.5**
    pub schedule: ScheduleType,

    /// 会话目标
    ///
    /// 控制任务在主会话还是隔离会话中执行。默认为 Main。
    #[serde(default)]
    pub session_target: SessionTarget,

    /// 唤醒模式
    ///
    /// 控制任务触发时的唤醒行为。默认为 NextHeartbeat。
    #[serde(default)]
    pub wake_mode: WakeMode,

    /// 任务载荷
    ///
    /// 定义任务执行的内容：SystemEvent（系统事件）或 AgentTurn（Agent 执行）。
    ///
    /// **Validates: Requirement 6.6**
    pub payload: CronPayload,

    /// 隔离配置
    ///
    /// 可选的会话隔离配置，控制任务是否在隔离会话中执行以及结果回传方式。
    ///
    /// **Validates: Requirement 6.7**
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isolation: Option<IsolationConfig>,

    /// 投递配置
    ///
    /// 可选的结果投递配置，控制任务执行结果的投递目标和方式。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery: Option<DeliveryConfig>,

    /// 任务状态
    ///
    /// 运行时状态跟踪，包括执行时间、状态和错误信息。
    ///
    /// **Validates: Requirement 6.8**
    #[serde(default)]
    pub state: JobState,

    // === 向后兼容字段 ===
    /// 旧格式：Recipe 源文件路径
    ///
    /// 用于向后兼容旧格式任务，存储原始 Recipe 文件路径。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,

    /// 旧格式：Cron 表达式
    ///
    /// 用于向后兼容旧格式任务，存储原始 Cron 表达式。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
}

impl ScheduledJob {
    /// 创建一个新的调度任务
    ///
    /// # 参数
    /// - `id`: 任务 ID
    /// - `name`: 任务名称
    /// - `schedule`: 调度类型
    /// - `payload`: 任务载荷
    ///
    /// # 示例
    ///
    /// ```rust
    /// use aster::scheduler::types::{ScheduledJob, ScheduleType, CronPayload};
    ///
    /// let job = ScheduledJob::new(
    ///     "my-task",
    ///     "My Task",
    ///     ScheduleType::Cron {
    ///         expr: "0 0 9 * * *".to_string(),
    ///         tz: None,
    ///     },
    ///     CronPayload::agent_turn("Do something"),
    /// );
    /// ```
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        schedule: ScheduleType,
        payload: CronPayload,
    ) -> Self {
        let now_ms = Utc::now().timestamp_millis();
        Self {
            id: id.into(),
            agent_id: None,
            name: name.into(),
            description: None,
            enabled: true,
            delete_after_run: false,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            schedule,
            session_target: SessionTarget::default(),
            wake_mode: WakeMode::default(),
            payload,
            isolation: None,
            delivery: None,
            state: JobState::default(),
            source: None,
            cron: None,
        }
    }

    /// 设置任务描述
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// 设置 Agent ID
    pub fn with_agent_id(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    /// 设置为一次性任务（执行后删除）
    pub fn with_delete_after_run(mut self, delete: bool) -> Self {
        self.delete_after_run = delete;
        self
    }

    /// 设置会话目标
    pub fn with_session_target(mut self, target: SessionTarget) -> Self {
        self.session_target = target;
        self
    }

    /// 设置唤醒模式
    pub fn with_wake_mode(mut self, mode: WakeMode) -> Self {
        self.wake_mode = mode;
        self
    }

    /// 设置隔离配置
    pub fn with_isolation(mut self, isolation: IsolationConfig) -> Self {
        self.isolation = Some(isolation);
        self
    }

    /// 设置投递配置
    pub fn with_delivery(mut self, delivery: DeliveryConfig) -> Self {
        self.delivery = Some(delivery);
        self
    }

    /// 禁用任务
    pub fn disable(&mut self) {
        self.enabled = false;
        self.updated_at_ms = Utc::now().timestamp_millis();
    }

    /// 启用任务
    pub fn enable(&mut self) {
        self.enabled = true;
        self.updated_at_ms = Utc::now().timestamp_millis();
    }

    /// 检查任务是否启用
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// 检查是否为一次性任务
    pub fn is_one_time(&self) -> bool {
        self.delete_after_run || matches!(self.schedule, ScheduleType::At { .. })
    }

    /// 检查任务是否正在运行
    pub fn is_running(&self) -> bool {
        self.state.is_running()
    }

    /// 获取下次执行时间
    pub fn next_run_at(&self) -> Option<DateTime<Utc>> {
        if !self.enabled {
            return None;
        }
        self.schedule.next_run_at(Utc::now())
    }

    /// 更新下次执行时间
    pub fn update_next_run(&mut self) {
        let next = self.schedule.next_run_at(Utc::now());
        self.state
            .set_next_run(next.map(|dt| dt.timestamp_millis()));
        self.updated_at_ms = Utc::now().timestamp_millis();
    }

    /// 标记任务开始执行
    pub fn mark_running(&mut self) {
        let now_ms = Utc::now().timestamp_millis();
        self.state.mark_running(now_ms);
        self.updated_at_ms = now_ms;
    }

    /// 标记任务执行成功
    pub fn mark_completed(&mut self, duration_ms: u64) {
        let now_ms = Utc::now().timestamp_millis();
        self.state.mark_completed(now_ms, duration_ms);
        self.update_next_run();
    }

    /// 标记任务执行失败
    pub fn mark_failed(&mut self, duration_ms: u64, error: impl Into<String>) {
        let now_ms = Utc::now().timestamp_millis();
        self.state.mark_failed(now_ms, duration_ms, error);
        self.update_next_run();
    }

    /// 标记任务被跳过
    pub fn mark_skipped(&mut self) {
        let now_ms = Utc::now().timestamp_millis();
        self.state.mark_skipped(now_ms);
        self.update_next_run();
    }

    /// 验证任务配置是否有效
    ///
    /// # 返回值
    /// - `Ok(())`: 配置有效
    /// - `Err(String)`: 配置无效，包含错误信息
    pub fn validate(&self) -> Result<(), String> {
        // 验证 ID
        if self.id.is_empty() {
            return Err("Job ID cannot be empty".to_string());
        }

        // 验证名称
        if self.name.is_empty() {
            return Err("Job name cannot be empty".to_string());
        }

        // 验证调度类型
        self.schedule.validate()?;

        // 验证投递配置
        if let Some(ref delivery) = self.delivery {
            delivery.validate()?;
        }

        Ok(())
    }

    /// 从旧格式迁移
    ///
    /// 将旧格式的任务（只有 cron 和 source）转换为新格式。
    ///
    /// # 参数
    /// - `id`: 任务 ID
    /// - `cron_expr`: Cron 表达式
    /// - `source_path`: Recipe 源文件路径
    /// - `paused`: 是否暂停
    /// - `last_run`: 上次执行时间
    pub fn from_legacy(
        id: impl Into<String>,
        cron_expr: &str,
        source_path: &str,
        paused: bool,
        last_run: Option<DateTime<Utc>>,
    ) -> Self {
        let id_str = id.into();
        let now_ms = Utc::now().timestamp_millis();

        Self {
            id: id_str.clone(),
            agent_id: None,
            name: id_str, // 使用 ID 作为名称
            description: None,
            enabled: !paused,
            delete_after_run: false,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            schedule: ScheduleType::from_legacy_cron(cron_expr),
            session_target: SessionTarget::Main,
            wake_mode: WakeMode::Now,
            payload: CronPayload::from_legacy_recipe(source_path),
            isolation: None,
            delivery: None,
            state: JobState {
                last_run_at_ms: last_run.map(|dt| dt.timestamp_millis()),
                ..Default::default()
            },
            source: Some(source_path.to_string()),
            cron: Some(cron_expr.to_string()),
        }
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Timelike};

    // ------------------------------------------------------------------------
    // ScheduleType::At 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_at_future_time() {
        let now = Utc::now();
        let future_ms = (now + chrono::Duration::hours(1)).timestamp_millis();
        let schedule = ScheduleType::At { at_ms: future_ms };

        let next = schedule.next_run_at(now);
        assert!(next.is_some());
        assert_eq!(next.unwrap().timestamp_millis(), future_ms);
    }

    #[test]
    fn test_at_past_time() {
        let now = Utc::now();
        let past_ms = (now - chrono::Duration::hours(1)).timestamp_millis();
        let schedule = ScheduleType::At { at_ms: past_ms };

        let next = schedule.next_run_at(now);
        assert!(next.is_none());
    }

    #[test]
    fn test_at_exact_now() {
        let now = Utc::now();
        let now_ms = now.timestamp_millis();
        let schedule = ScheduleType::At { at_ms: now_ms };

        // 精确等于当前时间应该返回 None（不是严格大于）
        let next = schedule.next_run_at(now);
        assert!(next.is_none());
    }

    // ------------------------------------------------------------------------
    // ScheduleType::Every 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_every_without_anchor() {
        let now = Utc::now();
        let every_ms = 60_000; // 1 分钟
        let schedule = ScheduleType::Every {
            every_ms,
            anchor_ms: None,
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_some());
        let next_time = next.unwrap();
        // 下次执行应该在 now + every_ms
        assert!(next_time > now);
        assert!((next_time - now).num_milliseconds() <= every_ms as i64);
    }

    #[test]
    fn test_every_with_past_anchor() {
        let now = Utc::now();
        let anchor = now - chrono::Duration::minutes(5);
        let every_ms = 60_000; // 1 分钟
        let schedule = ScheduleType::Every {
            every_ms,
            anchor_ms: Some(anchor.timestamp_millis() as u64),
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_some());
        let next_time = next.unwrap();
        // 下次执行应该在未来
        assert!(next_time > now);
    }

    #[test]
    fn test_every_with_future_anchor() {
        let now = Utc::now();
        let anchor = now + chrono::Duration::minutes(5);
        let every_ms = 60_000; // 1 分钟
        let schedule = ScheduleType::Every {
            every_ms,
            anchor_ms: Some(anchor.timestamp_millis() as u64),
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_some());
        // 锚点在未来，下次执行就是锚点时间
        assert_eq!(next.unwrap().timestamp_millis(), anchor.timestamp_millis());
    }

    #[test]
    fn test_every_zero_interval() {
        let now = Utc::now();
        let schedule = ScheduleType::Every {
            every_ms: 0,
            anchor_ms: None,
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_none());
    }

    // ------------------------------------------------------------------------
    // ScheduleType::Cron 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_cron_basic() {
        let now = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 0).unwrap();
        // 每分钟执行
        let schedule = ScheduleType::Cron {
            expr: "0 * * * * *".to_string(),
            tz: None,
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_some());
        let next_time = next.unwrap();
        // 下次执行应该在 10:31:00
        assert_eq!(next_time.minute(), 31);
        assert_eq!(next_time.second(), 0);
    }

    #[test]
    fn test_cron_with_timezone() {
        let now = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 0).unwrap();
        // 每天 9:00 执行（上海时间）
        let schedule = ScheduleType::Cron {
            expr: "0 0 9 * * *".to_string(),
            tz: Some("Asia/Shanghai".to_string()),
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_some());
    }

    #[test]
    fn test_cron_invalid_expression() {
        let now = Utc::now();
        let schedule = ScheduleType::Cron {
            expr: "invalid cron".to_string(),
            tz: None,
        };

        let next = schedule.next_run_at(now);
        assert!(next.is_none());
    }

    // ------------------------------------------------------------------------
    // from_legacy_cron 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_from_legacy_cron() {
        let legacy_cron = "0 0 9 * * *";
        let schedule = ScheduleType::from_legacy_cron(legacy_cron);

        match schedule {
            ScheduleType::Cron { expr, tz } => {
                assert_eq!(expr, legacy_cron);
                assert!(tz.is_none());
            }
            _ => panic!("Expected Cron variant"),
        }
    }

    // ------------------------------------------------------------------------
    // validate 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_validate_at_valid() {
        let schedule = ScheduleType::At {
            at_ms: 1704067200000,
        };
        assert!(schedule.validate().is_ok());
    }

    #[test]
    fn test_validate_at_invalid() {
        let schedule = ScheduleType::At { at_ms: 0 };
        assert!(schedule.validate().is_err());
    }

    #[test]
    fn test_validate_every_valid() {
        let schedule = ScheduleType::Every {
            every_ms: 60000,
            anchor_ms: None,
        };
        assert!(schedule.validate().is_ok());
    }

    #[test]
    fn test_validate_every_invalid() {
        let schedule = ScheduleType::Every {
            every_ms: 0,
            anchor_ms: None,
        };
        assert!(schedule.validate().is_err());
    }

    #[test]
    fn test_validate_cron_valid() {
        let schedule = ScheduleType::Cron {
            expr: "0 0 9 * * *".to_string(),
            tz: Some("Asia/Shanghai".to_string()),
        };
        assert!(schedule.validate().is_ok());
    }

    #[test]
    fn test_validate_cron_invalid_expr() {
        let schedule = ScheduleType::Cron {
            expr: "invalid".to_string(),
            tz: None,
        };
        assert!(schedule.validate().is_err());
    }

    #[test]
    fn test_validate_cron_invalid_tz() {
        let schedule = ScheduleType::Cron {
            expr: "0 0 9 * * *".to_string(),
            tz: Some("Invalid/Timezone".to_string()),
        };
        assert!(schedule.validate().is_err());
    }

    // ------------------------------------------------------------------------
    // 序列化/反序列化测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_serialize_at() {
        let schedule = ScheduleType::At {
            at_ms: 1704067200000,
        };
        let json = serde_json::to_string(&schedule).unwrap();
        assert!(json.contains("\"kind\":\"at\""));
        assert!(json.contains("\"atMs\":1704067200000"));
    }

    #[test]
    fn test_serialize_every() {
        let schedule = ScheduleType::Every {
            every_ms: 60000,
            anchor_ms: Some(1704067200000),
        };
        let json = serde_json::to_string(&schedule).unwrap();
        assert!(json.contains("\"kind\":\"every\""));
        assert!(json.contains("\"everyMs\":60000"));
        assert!(json.contains("\"anchorMs\":1704067200000"));
    }

    #[test]
    fn test_serialize_every_without_anchor() {
        let schedule = ScheduleType::Every {
            every_ms: 60000,
            anchor_ms: None,
        };
        let json = serde_json::to_string(&schedule).unwrap();
        // anchor_ms 为 None 时不应该出现在 JSON 中
        assert!(!json.contains("anchorMs"));
    }

    #[test]
    fn test_serialize_cron() {
        let schedule = ScheduleType::Cron {
            expr: "0 0 9 * * *".to_string(),
            tz: Some("Asia/Shanghai".to_string()),
        };
        let json = serde_json::to_string(&schedule).unwrap();
        assert!(json.contains("\"kind\":\"cron\""));
        assert!(json.contains("\"expr\":\"0 0 9 * * *\""));
        assert!(json.contains("\"tz\":\"Asia/Shanghai\""));
    }

    #[test]
    fn test_deserialize_at() {
        let json = r#"{"kind":"at","atMs":1704067200000}"#;
        let schedule: ScheduleType = serde_json::from_str(json).unwrap();
        match schedule {
            ScheduleType::At { at_ms } => assert_eq!(at_ms, 1704067200000),
            _ => panic!("Expected At variant"),
        }
    }

    #[test]
    fn test_deserialize_every() {
        let json = r#"{"kind":"every","everyMs":60000,"anchorMs":1704067200000}"#;
        let schedule: ScheduleType = serde_json::from_str(json).unwrap();
        match schedule {
            ScheduleType::Every {
                every_ms,
                anchor_ms,
            } => {
                assert_eq!(every_ms, 60000);
                assert_eq!(anchor_ms, Some(1704067200000));
            }
            _ => panic!("Expected Every variant"),
        }
    }

    #[test]
    fn test_deserialize_cron() {
        let json = r#"{"kind":"cron","expr":"0 0 9 * * *","tz":"Asia/Shanghai"}"#;
        let schedule: ScheduleType = serde_json::from_str(json).unwrap();
        match schedule {
            ScheduleType::Cron { expr, tz } => {
                assert_eq!(expr, "0 0 9 * * *");
                assert_eq!(tz, Some("Asia/Shanghai".to_string()));
            }
            _ => panic!("Expected Cron variant"),
        }
    }

    #[test]
    fn test_roundtrip_serialization() {
        let schedules = vec![
            ScheduleType::At {
                at_ms: 1704067200000,
            },
            ScheduleType::Every {
                every_ms: 60000,
                anchor_ms: Some(1704067200000),
            },
            ScheduleType::Every {
                every_ms: 3600000,
                anchor_ms: None,
            },
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: Some("Asia/Shanghai".to_string()),
            },
            ScheduleType::Cron {
                expr: "0 */5 * * * *".to_string(),
                tz: None,
            },
        ];

        for schedule in schedules {
            let json = serde_json::to_string(&schedule).unwrap();
            let deserialized: ScheduleType = serde_json::from_str(&json).unwrap();
            assert_eq!(schedule, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // CronPayload 测试 (Task 2.1)
    // ------------------------------------------------------------------------

    #[test]
    fn test_system_event_creation() {
        let payload = CronPayload::SystemEvent {
            text: "Test event".to_string(),
        };
        assert_eq!(payload.get_text(), "Test event");
        assert!(payload.is_system_event());
        assert!(!payload.is_agent_turn());
    }

    #[test]
    fn test_agent_turn_creation() {
        let payload = CronPayload::AgentTurn {
            message: "Generate report".to_string(),
            model: Some("gpt-4".to_string()),
            thinking: Some("high".to_string()),
            timeout_seconds: Some(300),
            deliver: Some(true),
            channel: Some("slack".to_string()),
            to: Some("#reports".to_string()),
            best_effort_deliver: Some(true),
        };
        assert_eq!(payload.get_text(), "Generate report");
        assert!(!payload.is_system_event());
        assert!(payload.is_agent_turn());
        assert_eq!(payload.get_model(), Some("gpt-4"));
        assert_eq!(payload.get_thinking(), Some("high"));
        assert_eq!(payload.get_timeout_seconds(), Some(300));
    }

    #[test]
    fn test_agent_turn_minimal() {
        let payload = CronPayload::AgentTurn {
            message: "Simple task".to_string(),
            model: None,
            thinking: None,
            timeout_seconds: None,
            deliver: None,
            channel: None,
            to: None,
            best_effort_deliver: None,
        };
        assert_eq!(payload.get_text(), "Simple task");
        assert!(payload.get_model().is_none());
        assert!(payload.get_thinking().is_none());
        assert!(payload.get_timeout_seconds().is_none());
    }

    #[test]
    fn test_get_text_system_event() {
        let payload = CronPayload::SystemEvent {
            text: "Hello World".to_string(),
        };
        assert_eq!(payload.get_text(), "Hello World");
    }

    #[test]
    fn test_get_text_agent_turn() {
        let payload = CronPayload::AgentTurn {
            message: "Do something".to_string(),
            model: None,
            thinking: None,
            timeout_seconds: None,
            deliver: None,
            channel: None,
            to: None,
            best_effort_deliver: None,
        };
        assert_eq!(payload.get_text(), "Do something");
    }

    #[test]
    fn test_from_legacy_recipe() {
        let payload = CronPayload::from_legacy_recipe("Generate daily report");

        match payload {
            CronPayload::AgentTurn {
                message,
                model,
                thinking,
                timeout_seconds,
                deliver,
                channel,
                to,
                best_effort_deliver,
            } => {
                assert_eq!(message, "Generate daily report");
                assert!(model.is_none());
                assert!(thinking.is_none());
                assert!(timeout_seconds.is_none());
                assert!(deliver.is_none());
                assert!(channel.is_none());
                assert!(to.is_none());
                assert!(best_effort_deliver.is_none());
            }
            _ => panic!("Expected AgentTurn variant"),
        }
    }

    #[test]
    fn test_system_event_helper() {
        let payload = CronPayload::system_event("Test message");
        assert!(payload.is_system_event());
        assert_eq!(payload.get_text(), "Test message");
    }

    #[test]
    fn test_agent_turn_helper() {
        let payload = CronPayload::agent_turn("Test task");
        assert!(payload.is_agent_turn());
        assert_eq!(payload.get_text(), "Test task");
    }

    #[test]
    fn test_system_event_get_model_returns_none() {
        let payload = CronPayload::SystemEvent {
            text: "Event".to_string(),
        };
        assert!(payload.get_model().is_none());
        assert!(payload.get_thinking().is_none());
        assert!(payload.get_timeout_seconds().is_none());
    }

    // ------------------------------------------------------------------------
    // CronPayload 序列化/反序列化测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_serialize_system_event() {
        let payload = CronPayload::SystemEvent {
            text: "Test event".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"kind\":\"systemEvent\""));
        assert!(json.contains("\"text\":\"Test event\""));
    }

    #[test]
    fn test_serialize_agent_turn_full() {
        let payload = CronPayload::AgentTurn {
            message: "Generate report".to_string(),
            model: Some("gpt-4".to_string()),
            thinking: Some("high".to_string()),
            timeout_seconds: Some(300),
            deliver: Some(true),
            channel: Some("slack".to_string()),
            to: Some("#reports".to_string()),
            best_effort_deliver: Some(true),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"kind\":\"agentTurn\""));
        assert!(json.contains("\"message\":\"Generate report\""));
        assert!(json.contains("\"model\":\"gpt-4\""));
        assert!(json.contains("\"thinking\":\"high\""));
        assert!(json.contains("\"timeoutSeconds\":300"));
        assert!(json.contains("\"deliver\":true"));
        assert!(json.contains("\"channel\":\"slack\""));
        assert!(json.contains("\"to\":\"#reports\""));
        assert!(json.contains("\"bestEffortDeliver\":true"));
    }

    #[test]
    fn test_serialize_agent_turn_minimal() {
        let payload = CronPayload::AgentTurn {
            message: "Simple task".to_string(),
            model: None,
            thinking: None,
            timeout_seconds: None,
            deliver: None,
            channel: None,
            to: None,
            best_effort_deliver: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"kind\":\"agentTurn\""));
        assert!(json.contains("\"message\":\"Simple task\""));
        // None 字段不应该出现在 JSON 中
        assert!(!json.contains("\"model\""));
        assert!(!json.contains("\"thinking\""));
        assert!(!json.contains("\"timeoutSeconds\""));
        assert!(!json.contains("\"deliver\""));
        assert!(!json.contains("\"channel\""));
        assert!(!json.contains("\"to\""));
        assert!(!json.contains("\"bestEffortDeliver\""));
    }

    #[test]
    fn test_deserialize_system_event() {
        let json = r#"{"kind":"systemEvent","text":"Test event"}"#;
        let payload: CronPayload = serde_json::from_str(json).unwrap();
        match payload {
            CronPayload::SystemEvent { text } => {
                assert_eq!(text, "Test event");
            }
            _ => panic!("Expected SystemEvent variant"),
        }
    }

    #[test]
    fn test_deserialize_agent_turn_full() {
        let json = r#"{
            "kind": "agentTurn",
            "message": "Generate report",
            "model": "gpt-4",
            "thinking": "high",
            "timeoutSeconds": 300,
            "deliver": true,
            "channel": "slack",
            "to": "reports-channel",
            "bestEffortDeliver": true
        }"#;
        let payload: CronPayload = serde_json::from_str(json).unwrap();
        match payload {
            CronPayload::AgentTurn {
                message,
                model,
                thinking,
                timeout_seconds,
                deliver,
                channel,
                to,
                best_effort_deliver,
            } => {
                assert_eq!(message, "Generate report");
                assert_eq!(model, Some("gpt-4".to_string()));
                assert_eq!(thinking, Some("high".to_string()));
                assert_eq!(timeout_seconds, Some(300));
                assert_eq!(deliver, Some(true));
                assert_eq!(channel, Some("slack".to_string()));
                assert_eq!(to, Some("reports-channel".to_string()));
                assert_eq!(best_effort_deliver, Some(true));
            }
            _ => panic!("Expected AgentTurn variant"),
        }
    }

    #[test]
    fn test_deserialize_agent_turn_minimal() {
        let json = r#"{"kind":"agentTurn","message":"Simple task"}"#;
        let payload: CronPayload = serde_json::from_str(json).unwrap();
        match payload {
            CronPayload::AgentTurn {
                message,
                model,
                thinking,
                timeout_seconds,
                deliver,
                channel,
                to,
                best_effort_deliver,
            } => {
                assert_eq!(message, "Simple task");
                assert!(model.is_none());
                assert!(thinking.is_none());
                assert!(timeout_seconds.is_none());
                assert!(deliver.is_none());
                assert!(channel.is_none());
                assert!(to.is_none());
                assert!(best_effort_deliver.is_none());
            }
            _ => panic!("Expected AgentTurn variant"),
        }
    }

    #[test]
    fn test_cron_payload_roundtrip() {
        let payloads = vec![
            CronPayload::SystemEvent {
                text: "Test event".to_string(),
            },
            CronPayload::AgentTurn {
                message: "Generate report".to_string(),
                model: Some("gpt-4".to_string()),
                thinking: Some("high".to_string()),
                timeout_seconds: Some(300),
                deliver: Some(true),
                channel: Some("slack".to_string()),
                to: Some("#reports".to_string()),
                best_effort_deliver: Some(true),
            },
            CronPayload::AgentTurn {
                message: "Simple task".to_string(),
                model: None,
                thinking: None,
                timeout_seconds: None,
                deliver: None,
                channel: None,
                to: None,
                best_effort_deliver: None,
            },
            CronPayload::AgentTurn {
                message: "Partial config".to_string(),
                model: Some("claude-3".to_string()),
                thinking: None,
                timeout_seconds: Some(600),
                deliver: None,
                channel: None,
                to: None,
                best_effort_deliver: None,
            },
        ];

        for payload in payloads {
            let json = serde_json::to_string(&payload).unwrap();
            let deserialized: CronPayload = serde_json::from_str(&json).unwrap();
            assert_eq!(payload, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // PostToMainMode 测试 (Task 2.2)
    // ------------------------------------------------------------------------

    #[test]
    fn test_post_to_main_mode_default() {
        let mode = PostToMainMode::default();
        assert_eq!(mode, PostToMainMode::Summary);
    }

    #[test]
    fn test_post_to_main_mode_variants() {
        let summary = PostToMainMode::Summary;
        let full = PostToMainMode::Full;

        assert_ne!(summary, full);
    }

    #[test]
    fn test_post_to_main_mode_serialize_summary() {
        let mode = PostToMainMode::Summary;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, "\"summary\"");
    }

    #[test]
    fn test_post_to_main_mode_serialize_full() {
        let mode = PostToMainMode::Full;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, "\"full\"");
    }

    #[test]
    fn test_post_to_main_mode_deserialize_summary() {
        let json = "\"summary\"";
        let mode: PostToMainMode = serde_json::from_str(json).unwrap();
        assert_eq!(mode, PostToMainMode::Summary);
    }

    #[test]
    fn test_post_to_main_mode_deserialize_full() {
        let json = "\"full\"";
        let mode: PostToMainMode = serde_json::from_str(json).unwrap();
        assert_eq!(mode, PostToMainMode::Full);
    }

    #[test]
    fn test_post_to_main_mode_roundtrip() {
        let modes = vec![PostToMainMode::Summary, PostToMainMode::Full];

        for mode in modes {
            let json = serde_json::to_string(&mode).unwrap();
            let deserialized: PostToMainMode = serde_json::from_str(&json).unwrap();
            assert_eq!(mode, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // IsolationConfig 测试 (Task 2.2)
    // ------------------------------------------------------------------------

    #[test]
    fn test_isolation_config_default() {
        let config = IsolationConfig::default();

        assert!(!config.enabled);
        assert!(config.post_to_main_prefix.is_none());
        assert_eq!(config.post_to_main_mode, PostToMainMode::Summary);
        assert_eq!(config.post_to_main_max_chars, 8000);
    }

    #[test]
    fn test_isolation_config_enabled_summary() {
        let config = IsolationConfig::enabled_summary();

        assert!(config.enabled);
        assert!(config.post_to_main_prefix.is_none());
        assert_eq!(config.post_to_main_mode, PostToMainMode::Summary);
        assert_eq!(config.post_to_main_max_chars, 8000);
    }

    #[test]
    fn test_isolation_config_enabled_full() {
        let config = IsolationConfig::enabled_full(Some(16000));

        assert!(config.enabled);
        assert!(config.post_to_main_prefix.is_none());
        assert_eq!(config.post_to_main_mode, PostToMainMode::Full);
        assert_eq!(config.post_to_main_max_chars, 16000);
    }

    #[test]
    fn test_isolation_config_enabled_full_default_max_chars() {
        let config = IsolationConfig::enabled_full(None);

        assert!(config.enabled);
        assert_eq!(config.post_to_main_max_chars, 8000);
    }

    #[test]
    fn test_isolation_config_with_prefix() {
        let config = IsolationConfig::enabled_summary().with_prefix("[定时任务]");

        assert_eq!(config.post_to_main_prefix, Some("[定时任务]".to_string()));
    }

    #[test]
    fn test_isolation_config_truncate_output_short() {
        let config = IsolationConfig {
            post_to_main_max_chars: 100,
            ..Default::default()
        };

        let output = "Hello, World!";
        let truncated = config.truncate_output(output);

        assert_eq!(truncated, output);
    }

    #[test]
    fn test_isolation_config_truncate_output_long() {
        let config = IsolationConfig {
            post_to_main_max_chars: 10,
            ..Default::default()
        };

        let output = "Hello, World! This is a long message.";
        let truncated = config.truncate_output(output);

        assert_eq!(truncated, "Hello, Wor...");
    }

    #[test]
    fn test_isolation_config_truncate_output_exact() {
        let config = IsolationConfig {
            post_to_main_max_chars: 13,
            ..Default::default()
        };

        let output = "Hello, World!";
        let truncated = config.truncate_output(output);

        // 刚好等于限制，不截断
        assert_eq!(truncated, output);
    }

    #[test]
    fn test_isolation_config_truncate_output_unicode() {
        let config = IsolationConfig {
            post_to_main_max_chars: 5,
            ..Default::default()
        };

        let output = "你好世界！这是测试";
        let truncated = config.truncate_output(output);

        // 应该按字符截断，不会截断 UTF-8 字符
        assert_eq!(truncated, "你好世界！...");
    }

    #[test]
    fn test_isolation_config_format_message_summary_no_prefix() {
        let config = IsolationConfig {
            enabled: true,
            post_to_main_prefix: None,
            post_to_main_mode: PostToMainMode::Summary,
            post_to_main_max_chars: 8000,
        };

        let message = config.format_message("任务完成");
        assert_eq!(message, "任务完成");
    }

    #[test]
    fn test_isolation_config_format_message_summary_with_prefix() {
        let config = IsolationConfig {
            enabled: true,
            post_to_main_prefix: Some("[任务]".to_string()),
            post_to_main_mode: PostToMainMode::Summary,
            post_to_main_max_chars: 8000,
        };

        let message = config.format_message("任务完成");
        assert_eq!(message, "[任务] 任务完成");
    }

    #[test]
    fn test_isolation_config_format_message_full_no_truncate() {
        let config = IsolationConfig {
            enabled: true,
            post_to_main_prefix: None,
            post_to_main_mode: PostToMainMode::Full,
            post_to_main_max_chars: 100,
        };

        let message = config.format_message("短消息");
        assert_eq!(message, "短消息");
    }

    #[test]
    fn test_isolation_config_format_message_full_with_truncate() {
        let config = IsolationConfig {
            enabled: true,
            post_to_main_prefix: Some("[报告]".to_string()),
            post_to_main_mode: PostToMainMode::Full,
            post_to_main_max_chars: 5,
        };

        let message = config.format_message("这是一个很长的消息");
        assert_eq!(message, "[报告] 这是一个很...");
    }

    // ------------------------------------------------------------------------
    // IsolationConfig 序列化/反序列化测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_isolation_config_serialize_default() {
        let config = IsolationConfig::default();
        let json = serde_json::to_string(&config).unwrap();

        // enabled 默认为 false，但 serde(default) 会序列化
        assert!(json.contains("\"enabled\":false"));
        // post_to_main_prefix 为 None，不应该出现
        assert!(!json.contains("postToMainPrefix"));
        // post_to_main_mode 默认为 Summary
        assert!(json.contains("\"postToMainMode\":\"summary\""));
        // post_to_main_max_chars 默认为 8000
        assert!(json.contains("\"postToMainMaxChars\":8000"));
    }

    #[test]
    fn test_isolation_config_serialize_full() {
        let config = IsolationConfig {
            enabled: true,
            post_to_main_prefix: Some("[任务]".to_string()),
            post_to_main_mode: PostToMainMode::Full,
            post_to_main_max_chars: 16000,
        };
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"postToMainPrefix\":\"[任务]\""));
        assert!(json.contains("\"postToMainMode\":\"full\""));
        assert!(json.contains("\"postToMainMaxChars\":16000"));
    }

    #[test]
    fn test_isolation_config_deserialize_minimal() {
        // 只有必需字段，其他使用默认值
        let json = r#"{}"#;
        let config: IsolationConfig = serde_json::from_str(json).unwrap();

        assert!(!config.enabled);
        assert!(config.post_to_main_prefix.is_none());
        assert_eq!(config.post_to_main_mode, PostToMainMode::Summary);
        assert_eq!(config.post_to_main_max_chars, 8000);
    }

    #[test]
    fn test_isolation_config_deserialize_full() {
        let json = r#"{
            "enabled": true,
            "postToMainPrefix": "[报告]",
            "postToMainMode": "full",
            "postToMainMaxChars": 12000
        }"#;
        let config: IsolationConfig = serde_json::from_str(json).unwrap();

        assert!(config.enabled);
        assert_eq!(config.post_to_main_prefix, Some("[报告]".to_string()));
        assert_eq!(config.post_to_main_mode, PostToMainMode::Full);
        assert_eq!(config.post_to_main_max_chars, 12000);
    }

    #[test]
    fn test_isolation_config_deserialize_partial() {
        // 只设置部分字段
        let json = r#"{
            "enabled": true,
            "postToMainMode": "full"
        }"#;
        let config: IsolationConfig = serde_json::from_str(json).unwrap();

        assert!(config.enabled);
        assert!(config.post_to_main_prefix.is_none());
        assert_eq!(config.post_to_main_mode, PostToMainMode::Full);
        assert_eq!(config.post_to_main_max_chars, 8000); // 使用默认值
    }

    #[test]
    fn test_isolation_config_roundtrip() {
        let configs = vec![
            IsolationConfig::default(),
            IsolationConfig::enabled_summary(),
            IsolationConfig::enabled_full(Some(16000)),
            IsolationConfig {
                enabled: true,
                post_to_main_prefix: Some("[任务]".to_string()),
                post_to_main_mode: PostToMainMode::Full,
                post_to_main_max_chars: 12000,
            },
            IsolationConfig {
                enabled: false,
                post_to_main_prefix: Some("前缀".to_string()),
                post_to_main_mode: PostToMainMode::Summary,
                post_to_main_max_chars: 5000,
            },
        ];

        for config in configs {
            let json = serde_json::to_string(&config).unwrap();
            let deserialized: IsolationConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(config, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // DeliveryConfig 测试 (Task 2.3)
    // ------------------------------------------------------------------------

    #[test]
    fn test_delivery_config_default() {
        let config = DeliveryConfig::default();

        assert!(!config.enabled);
        assert!(config.channel.is_none());
        assert!(config.to.is_none());
        assert!(config.best_effort);
    }

    #[test]
    fn test_delivery_config_enabled() {
        let config = DeliveryConfig::enabled("slack", "#reports");

        assert!(config.enabled);
        assert_eq!(config.channel, Some("slack".to_string()));
        assert_eq!(config.to, Some("#reports".to_string()));
        assert!(config.best_effort);
    }

    #[test]
    fn test_delivery_config_enabled_strict() {
        let config = DeliveryConfig::enabled_strict("email", "admin@example.com");

        assert!(config.enabled);
        assert_eq!(config.channel, Some("email".to_string()));
        assert_eq!(config.to, Some("admin@example.com".to_string()));
        assert!(!config.best_effort);
    }

    #[test]
    fn test_delivery_config_with_best_effort() {
        let config = DeliveryConfig::enabled_strict("slack", "#reports").with_best_effort(true);

        assert!(config.best_effort);
    }

    #[test]
    fn test_delivery_config_validate_disabled() {
        let config = DeliveryConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_delivery_config_validate_enabled_valid() {
        let config = DeliveryConfig::enabled("slack", "#reports");
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_delivery_config_validate_enabled_no_channel() {
        let config = DeliveryConfig {
            enabled: true,
            channel: None,
            to: Some("target".to_string()),
            best_effort: true,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_delivery_config_validate_enabled_no_to() {
        let config = DeliveryConfig {
            enabled: true,
            channel: Some("slack".to_string()),
            to: None,
            best_effort: true,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_delivery_config_should_deliver() {
        // 禁用时不投递
        let disabled = DeliveryConfig::default();
        assert!(!disabled.should_deliver());

        // 启用且配置完整时投递
        let enabled = DeliveryConfig::enabled("slack", "#reports");
        assert!(enabled.should_deliver());

        // 启用但缺少配置时不投递
        let incomplete = DeliveryConfig {
            enabled: true,
            channel: None,
            to: None,
            best_effort: true,
        };
        assert!(!incomplete.should_deliver());
    }

    // ------------------------------------------------------------------------
    // DeliveryConfig 序列化/反序列化测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_delivery_config_serialize_default() {
        let config = DeliveryConfig::default();
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"enabled\":false"));
        assert!(json.contains("\"bestEffort\":true"));
        // channel 和 to 为 None，不应该出现
        assert!(!json.contains("\"channel\""));
        assert!(!json.contains("\"to\""));
    }

    #[test]
    fn test_delivery_config_serialize_full() {
        let config = DeliveryConfig {
            enabled: true,
            channel: Some("slack".to_string()),
            to: Some("#reports".to_string()),
            best_effort: false,
        };
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"channel\":\"slack\""));
        assert!(json.contains("\"to\":\"#reports\""));
        assert!(json.contains("\"bestEffort\":false"));
    }

    #[test]
    fn test_delivery_config_deserialize_minimal() {
        let json = r#"{}"#;
        let config: DeliveryConfig = serde_json::from_str(json).unwrap();

        assert!(!config.enabled);
        assert!(config.channel.is_none());
        assert!(config.to.is_none());
        assert!(config.best_effort);
    }

    #[test]
    fn test_delivery_config_deserialize_full() {
        let json = r#"{
            "enabled": true,
            "channel": "telegram",
            "to": "@user",
            "bestEffort": false
        }"#;
        let config: DeliveryConfig = serde_json::from_str(json).unwrap();

        assert!(config.enabled);
        assert_eq!(config.channel, Some("telegram".to_string()));
        assert_eq!(config.to, Some("@user".to_string()));
        assert!(!config.best_effort);
    }

    #[test]
    fn test_delivery_config_deserialize_partial() {
        let json = r#"{
            "enabled": true,
            "channel": "email"
        }"#;
        let config: DeliveryConfig = serde_json::from_str(json).unwrap();

        assert!(config.enabled);
        assert_eq!(config.channel, Some("email".to_string()));
        assert!(config.to.is_none());
        assert!(config.best_effort); // 使用默认值
    }

    #[test]
    fn test_delivery_config_roundtrip() {
        let configs = vec![
            DeliveryConfig::default(),
            DeliveryConfig::enabled("slack", "#general"),
            DeliveryConfig::enabled_strict("email", "admin@example.com"),
            DeliveryConfig {
                enabled: true,
                channel: Some("telegram".to_string()),
                to: Some("@user".to_string()),
                best_effort: true,
            },
            DeliveryConfig {
                enabled: false,
                channel: Some("discord".to_string()),
                to: Some("#channel".to_string()),
                best_effort: false,
            },
        ];

        for config in configs {
            let json = serde_json::to_string(&config).unwrap();
            let deserialized: DeliveryConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(config, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // JobStatus 测试 (Task 4.1)
    // ------------------------------------------------------------------------

    #[test]
    fn test_job_status_default() {
        let status = JobStatus::default();
        assert_eq!(status, JobStatus::Ok);
    }

    #[test]
    fn test_job_status_variants() {
        let ok = JobStatus::Ok;
        let error = JobStatus::Error;
        let skipped = JobStatus::Skipped;

        assert!(ok.is_ok());
        assert!(!ok.is_error());
        assert!(!ok.is_skipped());

        assert!(!error.is_ok());
        assert!(error.is_error());
        assert!(!error.is_skipped());

        assert!(!skipped.is_ok());
        assert!(!skipped.is_error());
        assert!(skipped.is_skipped());
    }

    #[test]
    fn test_job_status_serialize() {
        assert_eq!(serde_json::to_string(&JobStatus::Ok).unwrap(), "\"ok\"");
        assert_eq!(
            serde_json::to_string(&JobStatus::Error).unwrap(),
            "\"error\""
        );
        assert_eq!(
            serde_json::to_string(&JobStatus::Skipped).unwrap(),
            "\"skipped\""
        );
    }

    #[test]
    fn test_job_status_deserialize() {
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"ok\"").unwrap(),
            JobStatus::Ok
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"error\"").unwrap(),
            JobStatus::Error
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"skipped\"").unwrap(),
            JobStatus::Skipped
        );
    }

    #[test]
    fn test_job_status_roundtrip() {
        let statuses = vec![JobStatus::Ok, JobStatus::Error, JobStatus::Skipped];

        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let deserialized: JobStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // JobState 测试 (Task 4.1)
    // ------------------------------------------------------------------------

    #[test]
    fn test_job_state_default() {
        let state = JobState::default();

        assert!(state.next_run_at_ms.is_none());
        assert!(state.running_at_ms.is_none());
        assert!(state.last_run_at_ms.is_none());
        assert!(state.last_status.is_none());
        assert!(state.last_error.is_none());
        assert!(state.last_duration_ms.is_none());
    }

    #[test]
    fn test_job_state_new() {
        let state = JobState::new();
        assert_eq!(state, JobState::default());
    }

    #[test]
    fn test_job_state_is_running() {
        let mut state = JobState::default();
        assert!(!state.is_running());

        state.running_at_ms = Some(1704067200000);
        assert!(state.is_running());

        state.running_at_ms = None;
        assert!(!state.is_running());
    }

    #[test]
    fn test_job_state_mark_running() {
        let mut state = JobState::default();
        let now_ms = 1704067200000;

        state.mark_running(now_ms);

        assert!(state.is_running());
        assert_eq!(state.running_at_ms, Some(now_ms));
    }

    #[test]
    fn test_job_state_mark_completed() {
        let mut state = JobState::default();
        let start_ms = 1704067200000;
        let end_ms = 1704067201500;
        let duration_ms = 1500;

        state.mark_running(start_ms);
        state.mark_completed(end_ms, duration_ms);

        assert!(!state.is_running());
        assert_eq!(state.last_run_at_ms, Some(end_ms));
        assert_eq!(state.last_status, Some(JobStatus::Ok));
        assert!(state.last_error.is_none());
        assert_eq!(state.last_duration_ms, Some(duration_ms));
    }

    #[test]
    fn test_job_state_mark_failed() {
        let mut state = JobState::default();
        let start_ms = 1704067200000;
        let end_ms = 1704067201500;
        let duration_ms = 1500;
        let error_msg = "Connection timeout";

        state.mark_running(start_ms);
        state.mark_failed(end_ms, duration_ms, error_msg);

        assert!(!state.is_running());
        assert_eq!(state.last_run_at_ms, Some(end_ms));
        assert_eq!(state.last_status, Some(JobStatus::Error));
        assert_eq!(state.last_error, Some(error_msg.to_string()));
        assert_eq!(state.last_duration_ms, Some(duration_ms));
    }

    #[test]
    fn test_job_state_mark_skipped() {
        let mut state = JobState::default();
        let now_ms = 1704067200000;

        state.mark_skipped(now_ms);

        assert!(!state.is_running());
        assert_eq!(state.last_run_at_ms, Some(now_ms));
        assert_eq!(state.last_status, Some(JobStatus::Skipped));
        assert!(state.last_error.is_none());
        assert_eq!(state.last_duration_ms, Some(0));
    }

    #[test]
    fn test_job_state_set_next_run() {
        let mut state = JobState::default();

        state.set_next_run(Some(1704153600000));
        assert_eq!(state.next_run_at_ms, Some(1704153600000));

        state.set_next_run(None);
        assert!(state.next_run_at_ms.is_none());
    }

    #[test]
    fn test_job_state_was_successful() {
        let mut state = JobState::default();

        // 从未执行过
        assert!(!state.was_successful());

        // 执行成功
        state.last_status = Some(JobStatus::Ok);
        assert!(state.was_successful());

        // 执行失败
        state.last_status = Some(JobStatus::Error);
        assert!(!state.was_successful());

        // 跳过执行
        state.last_status = Some(JobStatus::Skipped);
        assert!(!state.was_successful());
    }

    #[test]
    fn test_job_state_was_failed() {
        let mut state = JobState::default();

        // 从未执行过
        assert!(!state.was_failed());

        // 执行成功
        state.last_status = Some(JobStatus::Ok);
        assert!(!state.was_failed());

        // 执行失败
        state.last_status = Some(JobStatus::Error);
        assert!(state.was_failed());

        // 跳过执行
        state.last_status = Some(JobStatus::Skipped);
        assert!(!state.was_failed());
    }

    #[test]
    fn test_job_state_reset() {
        let mut state = JobState {
            next_run_at_ms: Some(1704153600000),
            running_at_ms: Some(1704067200000),
            last_run_at_ms: Some(1704067200000),
            last_status: Some(JobStatus::Ok),
            last_error: Some("old error".to_string()),
            last_duration_ms: Some(1500),
        };

        state.reset();

        // next_run_at_ms 应该保留
        assert_eq!(state.next_run_at_ms, Some(1704153600000));
        // 其他字段应该被清除
        assert!(state.running_at_ms.is_none());
        assert!(state.last_run_at_ms.is_none());
        assert!(state.last_status.is_none());
        assert!(state.last_error.is_none());
        assert!(state.last_duration_ms.is_none());
    }

    // ------------------------------------------------------------------------
    // JobState 序列化/反序列化测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_job_state_serialize_default() {
        let state = JobState::default();
        let json = serde_json::to_string(&state).unwrap();

        // 所有字段都是 None，应该序列化为空对象
        assert_eq!(json, "{}");
    }

    #[test]
    fn test_job_state_serialize_full() {
        let state = JobState {
            next_run_at_ms: Some(1704153600000),
            running_at_ms: Some(1704067200000),
            last_run_at_ms: Some(1704067200000),
            last_status: Some(JobStatus::Ok),
            last_error: Some("test error".to_string()),
            last_duration_ms: Some(1500),
        };
        let json = serde_json::to_string(&state).unwrap();

        assert!(json.contains("\"nextRunAtMs\":1704153600000"));
        assert!(json.contains("\"runningAtMs\":1704067200000"));
        assert!(json.contains("\"lastRunAtMs\":1704067200000"));
        assert!(json.contains("\"lastStatus\":\"ok\""));
        assert!(json.contains("\"lastError\":\"test error\""));
        assert!(json.contains("\"lastDurationMs\":1500"));
    }

    #[test]
    fn test_job_state_serialize_partial() {
        let state = JobState {
            next_run_at_ms: Some(1704153600000),
            running_at_ms: None,
            last_run_at_ms: Some(1704067200000),
            last_status: Some(JobStatus::Error),
            last_error: Some("Connection failed".to_string()),
            last_duration_ms: None,
        };
        let json = serde_json::to_string(&state).unwrap();

        assert!(json.contains("\"nextRunAtMs\":1704153600000"));
        assert!(!json.contains("\"runningAtMs\""));
        assert!(json.contains("\"lastRunAtMs\":1704067200000"));
        assert!(json.contains("\"lastStatus\":\"error\""));
        assert!(json.contains("\"lastError\":\"Connection failed\""));
        assert!(!json.contains("\"lastDurationMs\""));
    }

    #[test]
    fn test_job_state_deserialize_empty() {
        let json = r#"{}"#;
        let state: JobState = serde_json::from_str(json).unwrap();

        assert_eq!(state, JobState::default());
    }

    #[test]
    fn test_job_state_deserialize_full() {
        let json = r#"{
            "nextRunAtMs": 1704153600000,
            "runningAtMs": 1704067200000,
            "lastRunAtMs": 1704067200000,
            "lastStatus": "ok",
            "lastError": "test error",
            "lastDurationMs": 1500
        }"#;
        let state: JobState = serde_json::from_str(json).unwrap();

        assert_eq!(state.next_run_at_ms, Some(1704153600000));
        assert_eq!(state.running_at_ms, Some(1704067200000));
        assert_eq!(state.last_run_at_ms, Some(1704067200000));
        assert_eq!(state.last_status, Some(JobStatus::Ok));
        assert_eq!(state.last_error, Some("test error".to_string()));
        assert_eq!(state.last_duration_ms, Some(1500));
    }

    #[test]
    fn test_job_state_deserialize_partial() {
        let json = r#"{
            "lastRunAtMs": 1704067200000,
            "lastStatus": "error",
            "lastError": "Timeout"
        }"#;
        let state: JobState = serde_json::from_str(json).unwrap();

        assert!(state.next_run_at_ms.is_none());
        assert!(state.running_at_ms.is_none());
        assert_eq!(state.last_run_at_ms, Some(1704067200000));
        assert_eq!(state.last_status, Some(JobStatus::Error));
        assert_eq!(state.last_error, Some("Timeout".to_string()));
        assert!(state.last_duration_ms.is_none());
    }

    #[test]
    fn test_job_state_roundtrip() {
        let states = vec![
            JobState::default(),
            JobState {
                next_run_at_ms: Some(1704153600000),
                running_at_ms: None,
                last_run_at_ms: None,
                last_status: None,
                last_error: None,
                last_duration_ms: None,
            },
            JobState {
                next_run_at_ms: Some(1704153600000),
                running_at_ms: Some(1704067200000),
                last_run_at_ms: Some(1704067200000),
                last_status: Some(JobStatus::Ok),
                last_error: None,
                last_duration_ms: Some(1500),
            },
            JobState {
                next_run_at_ms: None,
                running_at_ms: None,
                last_run_at_ms: Some(1704067200000),
                last_status: Some(JobStatus::Error),
                last_error: Some("Connection failed".to_string()),
                last_duration_ms: Some(500),
            },
            JobState {
                next_run_at_ms: Some(1704153600000),
                running_at_ms: None,
                last_run_at_ms: Some(1704067200000),
                last_status: Some(JobStatus::Skipped),
                last_error: None,
                last_duration_ms: Some(0),
            },
        ];

        for state in states {
            let json = serde_json::to_string(&state).unwrap();
            let deserialized: JobState = serde_json::from_str(&json).unwrap();
            assert_eq!(state, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // JobState 状态转换测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_job_state_lifecycle_success() {
        let mut state = JobState::default();
        let start_ms = 1704067200000;
        let end_ms = 1704067201500;
        let next_run_ms = 1704153600000;

        // 设置下次执行时间
        state.set_next_run(Some(next_run_ms));
        assert_eq!(state.next_run_at_ms, Some(next_run_ms));

        // 开始执行
        state.mark_running(start_ms);
        assert!(state.is_running());
        assert_eq!(state.running_at_ms, Some(start_ms));

        // 执行成功
        state.mark_completed(end_ms, 1500);
        assert!(!state.is_running());
        assert!(state.was_successful());
        assert_eq!(state.last_duration_ms, Some(1500));
    }

    #[test]
    fn test_job_state_lifecycle_failure() {
        let mut state = JobState::default();
        let start_ms = 1704067200000;
        let end_ms = 1704067201500;

        // 开始执行
        state.mark_running(start_ms);
        assert!(state.is_running());

        // 执行失败
        state.mark_failed(end_ms, 1500, "Database connection failed");
        assert!(!state.is_running());
        assert!(state.was_failed());
        assert_eq!(
            state.last_error,
            Some("Database connection failed".to_string())
        );
    }

    #[test]
    fn test_job_state_clear_error_on_success() {
        let mut state = JobState {
            next_run_at_ms: None,
            running_at_ms: None,
            last_run_at_ms: Some(1704067200000),
            last_status: Some(JobStatus::Error),
            last_error: Some("Previous error".to_string()),
            last_duration_ms: Some(500),
        };

        // 新的成功执行应该清除错误
        state.mark_completed(1704153600000, 1000);

        assert_eq!(state.last_status, Some(JobStatus::Ok));
        assert!(state.last_error.is_none());
    }

    // ------------------------------------------------------------------------
    // SessionTarget 测试 (Task 4.2)
    // ------------------------------------------------------------------------

    #[test]
    fn test_session_target_default() {
        let target = SessionTarget::default();
        assert_eq!(target, SessionTarget::Main);
    }

    #[test]
    fn test_session_target_variants() {
        let main = SessionTarget::Main;
        let isolated = SessionTarget::Isolated;

        assert!(main.is_main());
        assert!(!main.is_isolated());

        assert!(!isolated.is_main());
        assert!(isolated.is_isolated());
    }

    #[test]
    fn test_session_target_serialize() {
        assert_eq!(
            serde_json::to_string(&SessionTarget::Main).unwrap(),
            "\"main\""
        );
        assert_eq!(
            serde_json::to_string(&SessionTarget::Isolated).unwrap(),
            "\"isolated\""
        );
    }

    #[test]
    fn test_session_target_deserialize() {
        assert_eq!(
            serde_json::from_str::<SessionTarget>("\"main\"").unwrap(),
            SessionTarget::Main
        );
        assert_eq!(
            serde_json::from_str::<SessionTarget>("\"isolated\"").unwrap(),
            SessionTarget::Isolated
        );
    }

    #[test]
    fn test_session_target_roundtrip() {
        let targets = vec![SessionTarget::Main, SessionTarget::Isolated];

        for target in targets {
            let json = serde_json::to_string(&target).unwrap();
            let deserialized: SessionTarget = serde_json::from_str(&json).unwrap();
            assert_eq!(target, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // WakeMode 测试 (Task 4.2)
    // ------------------------------------------------------------------------

    #[test]
    fn test_wake_mode_default() {
        let mode = WakeMode::default();
        assert_eq!(mode, WakeMode::NextHeartbeat);
    }

    #[test]
    fn test_wake_mode_variants() {
        let next_heartbeat = WakeMode::NextHeartbeat;
        let now = WakeMode::Now;

        assert!(next_heartbeat.is_next_heartbeat());
        assert!(!next_heartbeat.is_now());

        assert!(!now.is_next_heartbeat());
        assert!(now.is_now());
    }

    #[test]
    fn test_wake_mode_serialize() {
        assert_eq!(
            serde_json::to_string(&WakeMode::NextHeartbeat).unwrap(),
            "\"nextHeartbeat\""
        );
        assert_eq!(serde_json::to_string(&WakeMode::Now).unwrap(), "\"now\"");
    }

    #[test]
    fn test_wake_mode_deserialize() {
        assert_eq!(
            serde_json::from_str::<WakeMode>("\"nextHeartbeat\"").unwrap(),
            WakeMode::NextHeartbeat
        );
        assert_eq!(
            serde_json::from_str::<WakeMode>("\"now\"").unwrap(),
            WakeMode::Now
        );
    }

    #[test]
    fn test_wake_mode_roundtrip() {
        let modes = vec![WakeMode::NextHeartbeat, WakeMode::Now];

        for mode in modes {
            let json = serde_json::to_string(&mode).unwrap();
            let deserialized: WakeMode = serde_json::from_str(&json).unwrap();
            assert_eq!(mode, deserialized);
        }
    }

    // ------------------------------------------------------------------------
    // ScheduledJob 测试 (Task 4.2)
    // ------------------------------------------------------------------------

    #[test]
    fn test_scheduled_job_new() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        assert_eq!(job.id, "test-job");
        assert_eq!(job.name, "Test Job");
        assert!(job.enabled);
        assert!(!job.delete_after_run);
        assert!(job.agent_id.is_none());
        assert!(job.description.is_none());
        assert_eq!(job.session_target, SessionTarget::Main);
        assert_eq!(job.wake_mode, WakeMode::NextHeartbeat);
        assert!(job.isolation.is_none());
        assert!(job.delivery.is_none());
        assert!(job.source.is_none());
        assert!(job.cron.is_none());
    }

    #[test]
    fn test_scheduled_job_builder_methods() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::At {
                at_ms: 1704153600000,
            },
            CronPayload::system_event("Test event"),
        )
        .with_description("A test job")
        .with_agent_id("agent-1")
        .with_delete_after_run(true)
        .with_session_target(SessionTarget::Isolated)
        .with_wake_mode(WakeMode::Now)
        .with_isolation(IsolationConfig::enabled_summary())
        .with_delivery(DeliveryConfig::enabled("slack", "#test"));

        assert_eq!(job.description, Some("A test job".to_string()));
        assert_eq!(job.agent_id, Some("agent-1".to_string()));
        assert!(job.delete_after_run);
        assert_eq!(job.session_target, SessionTarget::Isolated);
        assert_eq!(job.wake_mode, WakeMode::Now);
        assert!(job.isolation.is_some());
        assert!(job.delivery.is_some());
    }

    #[test]
    fn test_scheduled_job_enable_disable() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        assert!(job.is_enabled());

        job.disable();
        assert!(!job.is_enabled());

        job.enable();
        assert!(job.is_enabled());
    }

    #[test]
    fn test_scheduled_job_is_one_time() {
        // At 类型任务是一次性的
        let at_job = ScheduledJob::new(
            "at-job",
            "At Job",
            ScheduleType::At {
                at_ms: 1704153600000,
            },
            CronPayload::system_event("Test"),
        );
        assert!(at_job.is_one_time());

        // Cron 类型任务不是一次性的
        let cron_job = ScheduledJob::new(
            "cron-job",
            "Cron Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::system_event("Test"),
        );
        assert!(!cron_job.is_one_time());

        // 设置 delete_after_run 的任务是一次性的
        let delete_job = ScheduledJob::new(
            "delete-job",
            "Delete Job",
            ScheduleType::Every {
                every_ms: 60000,
                anchor_ms: None,
            },
            CronPayload::system_event("Test"),
        )
        .with_delete_after_run(true);
        assert!(delete_job.is_one_time());
    }

    #[test]
    fn test_scheduled_job_validate_valid() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        assert!(job.validate().is_ok());
    }

    #[test]
    fn test_scheduled_job_validate_empty_id() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );
        job.id = "".to_string();

        assert!(job.validate().is_err());
    }

    #[test]
    fn test_scheduled_job_validate_empty_name() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );
        job.name = "".to_string();

        assert!(job.validate().is_err());
    }

    #[test]
    fn test_scheduled_job_validate_invalid_schedule() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "invalid cron".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        assert!(job.validate().is_err());
    }

    #[test]
    fn test_scheduled_job_validate_invalid_delivery() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        )
        .with_delivery(DeliveryConfig {
            enabled: true,
            channel: None, // 缺少 channel
            to: Some("target".to_string()),
            best_effort: true,
        });

        assert!(job.validate().is_err());
    }

    #[test]
    fn test_scheduled_job_from_legacy() {
        let job = ScheduledJob::from_legacy(
            "legacy-job",
            "0 0 9 * * *",
            "/path/to/recipe.md",
            false,
            Some(Utc::now()),
        );

        assert_eq!(job.id, "legacy-job");
        assert_eq!(job.name, "legacy-job"); // 使用 ID 作为名称
        assert!(job.enabled);
        assert_eq!(job.source, Some("/path/to/recipe.md".to_string()));
        assert_eq!(job.cron, Some("0 0 9 * * *".to_string()));
        assert!(job.state.last_run_at_ms.is_some());

        // 验证调度类型
        match &job.schedule {
            ScheduleType::Cron { expr, tz } => {
                assert_eq!(expr, "0 0 9 * * *");
                assert!(tz.is_none());
            }
            _ => panic!("Expected Cron schedule"),
        }

        // 验证载荷
        assert!(job.payload.is_agent_turn());
        assert_eq!(job.payload.get_text(), "/path/to/recipe.md");
    }

    #[test]
    fn test_scheduled_job_from_legacy_paused() {
        let job = ScheduledJob::from_legacy(
            "paused-job",
            "0 0 9 * * *",
            "/path/to/recipe.md",
            true, // paused
            None,
        );

        assert!(!job.enabled); // paused 转换为 !enabled
    }

    #[test]
    fn test_scheduled_job_mark_running() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        assert!(!job.is_running());

        job.mark_running();

        assert!(job.is_running());
    }

    #[test]
    fn test_scheduled_job_mark_completed() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        job.mark_running();
        job.mark_completed(1500);

        assert!(!job.is_running());
        assert!(job.state.was_successful());
        assert_eq!(job.state.last_duration_ms, Some(1500));
    }

    #[test]
    fn test_scheduled_job_mark_failed() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        job.mark_running();
        job.mark_failed(1500, "Connection timeout");

        assert!(!job.is_running());
        assert!(job.state.was_failed());
        assert_eq!(job.state.last_error, Some("Connection timeout".to_string()));
    }

    #[test]
    fn test_scheduled_job_mark_skipped() {
        let mut job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        job.mark_skipped();

        assert!(!job.is_running());
        assert_eq!(job.state.last_status, Some(JobStatus::Skipped));
    }

    // ------------------------------------------------------------------------
    // ScheduledJob 序列化/反序列化测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_scheduled_job_serialize_minimal() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            CronPayload::agent_turn("Do something"),
        );

        let json = serde_json::to_string(&job).unwrap();

        assert!(json.contains("\"id\":\"test-job\""));
        assert!(json.contains("\"name\":\"Test Job\""));
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"deleteAfterRun\":false"));
        assert!(json.contains("\"sessionTarget\":\"main\""));
        assert!(json.contains("\"wakeMode\":\"nextHeartbeat\""));
        // 可选字段不应该出现（使用精确匹配避免与 schedule.kind:"cron" 混淆）
        assert!(!json.contains("\"agentId\""));
        assert!(!json.contains("\"description\""));
        assert!(!json.contains("\"isolation\""));
        assert!(!json.contains("\"delivery\""));
        assert!(!json.contains("\"source\""));
        // 注意：schedule 中有 "kind":"cron"，所以检查顶层 cron 字段需要更精确
        // 顶层 cron 字段格式为 "cron":"..." 而不是 "kind":"cron"
        assert!(!json.contains("\"cron\":\"0 0 9")); // 顶层 cron 字段
    }

    #[test]
    fn test_scheduled_job_serialize_full() {
        let job = ScheduledJob::new(
            "test-job",
            "Test Job",
            ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: Some("Asia/Shanghai".to_string()),
            },
            CronPayload::AgentTurn {
                message: "Generate report".to_string(),
                model: Some("gpt-4".to_string()),
                thinking: Some("high".to_string()),
                timeout_seconds: Some(300),
                deliver: None,
                channel: None,
                to: None,
                best_effort_deliver: None,
            },
        )
        .with_description("A test job")
        .with_agent_id("agent-1")
        .with_delete_after_run(true)
        .with_session_target(SessionTarget::Isolated)
        .with_wake_mode(WakeMode::Now)
        .with_isolation(IsolationConfig::enabled_full(Some(16000)))
        .with_delivery(DeliveryConfig::enabled("slack", "#reports"));

        let json = serde_json::to_string(&job).unwrap();

        assert!(json.contains("\"id\":\"test-job\""));
        assert!(json.contains("\"agentId\":\"agent-1\""));
        assert!(json.contains("\"name\":\"Test Job\""));
        assert!(json.contains("\"description\":\"A test job\""));
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"deleteAfterRun\":true"));
        assert!(json.contains("\"sessionTarget\":\"isolated\""));
        assert!(json.contains("\"wakeMode\":\"now\""));
        assert!(json.contains("\"isolation\""));
        assert!(json.contains("\"delivery\""));
    }

    #[test]
    fn test_scheduled_job_deserialize_minimal() {
        let json = r#"{
            "id": "test-job",
            "name": "Test Job",
            "createdAtMs": 1704067200000,
            "updatedAtMs": 1704067200000,
            "schedule": {
                "kind": "cron",
                "expr": "0 0 9 * * *"
            },
            "payload": {
                "kind": "agentTurn",
                "message": "Do something"
            }
        }"#;

        let job: ScheduledJob = serde_json::from_str(json).unwrap();

        assert_eq!(job.id, "test-job");
        assert_eq!(job.name, "Test Job");
        assert!(job.enabled); // 默认值
        assert!(!job.delete_after_run); // 默认值
        assert_eq!(job.session_target, SessionTarget::Main); // 默认值
        assert_eq!(job.wake_mode, WakeMode::NextHeartbeat); // 默认值
        assert!(job.agent_id.is_none());
        assert!(job.description.is_none());
        assert!(job.isolation.is_none());
        assert!(job.delivery.is_none());
    }

    #[test]
    fn test_scheduled_job_deserialize_full() {
        let json = r##"{
            "id": "test-job",
            "agentId": "agent-1",
            "name": "Test Job",
            "description": "A test job",
            "enabled": false,
            "deleteAfterRun": true,
            "createdAtMs": 1704067200000,
            "updatedAtMs": 1704067200000,
            "schedule": {
                "kind": "cron",
                "expr": "0 0 9 * * *",
                "tz": "Asia/Shanghai"
            },
            "sessionTarget": "isolated",
            "wakeMode": "now",
            "payload": {
                "kind": "agentTurn",
                "message": "Generate report",
                "model": "gpt-4"
            },
            "isolation": {
                "enabled": true,
                "postToMainMode": "full",
                "postToMainMaxChars": 16000
            },
            "delivery": {
                "enabled": true,
                "channel": "slack",
                "to": "#reports",
                "bestEffort": true
            },
            "state": {
                "lastRunAtMs": 1704067200000,
                "lastStatus": "ok"
            },
            "source": "/path/to/recipe.md",
            "cron": "0 0 9 * * *"
        }"##;

        let job: ScheduledJob = serde_json::from_str(json).unwrap();

        assert_eq!(job.id, "test-job");
        assert_eq!(job.agent_id, Some("agent-1".to_string()));
        assert_eq!(job.name, "Test Job");
        assert_eq!(job.description, Some("A test job".to_string()));
        assert!(!job.enabled);
        assert!(job.delete_after_run);
        assert_eq!(job.session_target, SessionTarget::Isolated);
        assert_eq!(job.wake_mode, WakeMode::Now);
        assert!(job.isolation.is_some());
        assert!(job.delivery.is_some());
        assert_eq!(job.source, Some("/path/to/recipe.md".to_string()));
        assert_eq!(job.cron, Some("0 0 9 * * *".to_string()));
        assert_eq!(job.state.last_status, Some(JobStatus::Ok));
    }

    #[test]
    fn test_scheduled_job_roundtrip() {
        let jobs = vec![
            // 最小配置
            ScheduledJob::new(
                "minimal-job",
                "Minimal Job",
                ScheduleType::Cron {
                    expr: "0 0 9 * * *".to_string(),
                    tz: None,
                },
                CronPayload::system_event("Test"),
            ),
            // At 类型任务
            ScheduledJob::new(
                "at-job",
                "At Job",
                ScheduleType::At {
                    at_ms: 1704153600000,
                },
                CronPayload::agent_turn("One-time task"),
            )
            .with_delete_after_run(true),
            // Every 类型任务
            ScheduledJob::new(
                "every-job",
                "Every Job",
                ScheduleType::Every {
                    every_ms: 3600000,
                    anchor_ms: Some(1704067200000),
                },
                CronPayload::agent_turn("Hourly task"),
            ),
            // 完整配置
            ScheduledJob::new(
                "full-job",
                "Full Job",
                ScheduleType::Cron {
                    expr: "0 0 9 * * *".to_string(),
                    tz: Some("Asia/Shanghai".to_string()),
                },
                CronPayload::AgentTurn {
                    message: "Generate report".to_string(),
                    model: Some("gpt-4".to_string()),
                    thinking: Some("high".to_string()),
                    timeout_seconds: Some(300),
                    deliver: Some(true),
                    channel: Some("slack".to_string()),
                    to: Some("#reports".to_string()),
                    best_effort_deliver: Some(true),
                },
            )
            .with_description("A full job")
            .with_agent_id("agent-1")
            .with_session_target(SessionTarget::Isolated)
            .with_wake_mode(WakeMode::Now)
            .with_isolation(IsolationConfig::enabled_full(Some(16000)))
            .with_delivery(DeliveryConfig::enabled("slack", "#reports")),
            // 旧格式迁移
            ScheduledJob::from_legacy(
                "legacy-job",
                "0 0 9 * * *",
                "/path/to/recipe.md",
                false,
                None,
            ),
        ];

        for job in jobs {
            let json = serde_json::to_string(&job).unwrap();
            let deserialized: ScheduledJob = serde_json::from_str(&json).unwrap();
            assert_eq!(job, deserialized, "Job {} should survive roundtrip", job.id);
        }
    }
}

// ============================================================================
// 属性测试 (Property-Based Tests)
// ============================================================================

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    // ------------------------------------------------------------------------
    // 测试数据生成器
    // ------------------------------------------------------------------------

    /// 生成有效的时间戳（毫秒）
    /// 范围：2020-01-01 到 2030-12-31
    fn arb_timestamp_ms() -> impl Strategy<Value = i64> {
        // 2020-01-01 00:00:00 UTC = 1577836800000
        // 2030-12-31 23:59:59 UTC = 1924991999000
        1577836800000i64..1924991999000i64
    }

    /// 生成有效的间隔时间（毫秒）
    /// 范围：1ms 到 1 天
    fn arb_interval_ms() -> impl Strategy<Value = u64> {
        1u64..86_400_000u64
    }

    /// 生成可选的锚点时间
    fn arb_anchor_ms() -> impl Strategy<Value = Option<u64>> {
        prop_oneof![
            Just(None),
            arb_timestamp_ms().prop_map(|ts| Some(ts as u64)),
        ]
    }

    /// 生成有效的 cron 表达式
    /// 使用预定义的有效表达式列表
    fn arb_valid_cron_expr() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("0 * * * * *".to_string()),    // 每分钟
            Just("0 0 * * * *".to_string()),    // 每小时
            Just("0 0 0 * * *".to_string()),    // 每天
            Just("0 0 9 * * *".to_string()),    // 每天 9:00
            Just("0 30 8 * * *".to_string()),   // 每天 8:30
            Just("0 0 0 * * 1".to_string()),    // 每周一
            Just("0 0 0 1 * *".to_string()),    // 每月 1 号
            Just("0 */5 * * * *".to_string()),  // 每 5 分钟
            Just("0 0 */2 * * *".to_string()),  // 每 2 小时
            Just("30 15 10 * * *".to_string()), // 每天 10:15:30
        ]
    }

    /// 生成有效的时区
    fn arb_valid_timezone() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("UTC".to_string())),
            Just(Some("Asia/Shanghai".to_string())),
            Just(Some("America/New_York".to_string())),
            Just(Some("Europe/London".to_string())),
            Just(Some("Asia/Tokyo".to_string())),
        ]
    }

    /// 生成 ScheduleType::At
    fn arb_schedule_at() -> impl Strategy<Value = ScheduleType> {
        arb_timestamp_ms().prop_map(|at_ms| ScheduleType::At { at_ms })
    }

    /// 生成 ScheduleType::Every
    fn arb_schedule_every() -> impl Strategy<Value = ScheduleType> {
        (arb_interval_ms(), arb_anchor_ms()).prop_map(|(every_ms, anchor_ms)| ScheduleType::Every {
            every_ms,
            anchor_ms,
        })
    }

    /// 生成 ScheduleType::Cron
    fn arb_schedule_cron() -> impl Strategy<Value = ScheduleType> {
        (arb_valid_cron_expr(), arb_valid_timezone())
            .prop_map(|(expr, tz)| ScheduleType::Cron { expr, tz })
    }

    /// 生成任意 ScheduleType
    fn arb_schedule_type() -> impl Strategy<Value = ScheduleType> {
        prop_oneof![arb_schedule_at(), arb_schedule_every(), arb_schedule_cron(),]
    }

    // ------------------------------------------------------------------------
    // Property 1: ScheduleType next_run_at 计算正确性
    // **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 2.2, 2.4**
    // ------------------------------------------------------------------------

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 1.1: At 类型 - 未来时间返回该时间
        ///
        /// **Validates: Requirements 1.1**
        ///
        /// 对于任意 At 类型调度，如果 at_ms > now，则 next_run_at 应返回 at_ms
        #[test]
        fn prop_at_future_returns_at_time(
            at_ms in arb_timestamp_ms(),
            now_offset in 1i64..86_400_000i64  // 1ms 到 1 天的偏移
        ) {
            // 确保 now < at_ms
            let now_ms = at_ms - now_offset;
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();
            let schedule = ScheduleType::At { at_ms };

            let next = schedule.next_run_at(now);

            prop_assert!(next.is_some(), "At schedule with future time should return Some");
            prop_assert_eq!(
                next.unwrap().timestamp_millis(),
                at_ms,
                "At schedule should return exact at_ms time"
            );
        }

        /// Property 1.2: At 类型 - 过去时间返回 None
        ///
        /// **Validates: Requirements 1.1**
        ///
        /// 对于任意 At 类型调度，如果 at_ms <= now，则 next_run_at 应返回 None
        #[test]
        fn prop_at_past_returns_none(
            at_ms in arb_timestamp_ms(),
            now_offset in 0i64..86_400_000i64  // 0 到 1 天的偏移
        ) {
            // 确保 now >= at_ms
            let now_ms = at_ms + now_offset;
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();
            let schedule = ScheduleType::At { at_ms };

            let next = schedule.next_run_at(now);

            prop_assert!(
                next.is_none(),
                "At schedule with past or current time should return None"
            );
        }

        /// Property 1.3: Every 类型 - 返回值总是在未来
        ///
        /// **Validates: Requirements 1.2, 1.5**
        ///
        /// 对于任意 Every 类型调度，next_run_at 返回的时间应该总是大于 now
        #[test]
        fn prop_every_returns_future_time(
            every_ms in arb_interval_ms(),
            anchor_ms in arb_anchor_ms(),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();
            let schedule = ScheduleType::Every { every_ms, anchor_ms };

            let next = schedule.next_run_at(now);

            prop_assert!(next.is_some(), "Every schedule should always return Some");
            prop_assert!(
                next.unwrap() > now,
                "Every schedule should return a future time"
            );
        }

        /// Property 1.4: Every 类型 - 返回值与锚点对齐
        ///
        /// **Validates: Requirements 1.2, 1.5**
        ///
        /// 对于任意 Every 类型调度，返回的时间应该是锚点时间加上间隔的整数倍
        #[test]
        fn prop_every_aligned_with_anchor(
            every_ms in arb_interval_ms(),
            anchor_ms_val in arb_timestamp_ms().prop_map(|ts| ts as u64),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();
            let anchor_ms = Some(anchor_ms_val);
            let schedule = ScheduleType::Every { every_ms, anchor_ms };

            let next = schedule.next_run_at(now);

            prop_assert!(next.is_some(), "Every schedule should always return Some");

            let next_ms = next.unwrap().timestamp_millis();
            let anchor = anchor_ms_val as i64;

            // 验证 (next_ms - anchor) 是 every_ms 的整数倍
            let diff = next_ms - anchor;
            if diff >= 0 {
                prop_assert_eq!(
                    diff % (every_ms as i64),
                    0,
                    "Next run time should be aligned with anchor by interval"
                );
            }
            // 如果 diff < 0，说明 next_ms 就是 anchor（锚点在未来的情况）
        }

        /// Property 1.5: Every 类型 - 返回值在一个间隔内
        ///
        /// **Validates: Requirements 1.2, 1.5**
        ///
        /// 对于任意 Every 类型调度，返回的时间与 now 的差值应该不超过一个间隔
        #[test]
        fn prop_every_within_one_interval(
            every_ms in arb_interval_ms(),
            anchor_ms in arb_anchor_ms(),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();
            let schedule = ScheduleType::Every { every_ms, anchor_ms };

            let next = schedule.next_run_at(now);

            prop_assert!(next.is_some(), "Every schedule should always return Some");

            let next_time = next.unwrap();
            let diff_ms = (next_time - now).num_milliseconds();

            // 下次执行时间应该在 (0, every_ms] 范围内
            // 但如果锚点在未来，可能会更远
            if let Some(anchor) = anchor_ms {
                let anchor_time = DateTime::from_timestamp_millis(anchor as i64).unwrap();
                if anchor_time > now {
                    // 锚点在未来，next 应该等于锚点
                    prop_assert_eq!(
                        next_time.timestamp_millis(),
                        anchor as i64,
                        "When anchor is in future, next should be anchor"
                    );
                } else {
                    // 锚点在过去，diff 应该在 (0, every_ms] 范围内
                    prop_assert!(
                        diff_ms > 0 && diff_ms <= every_ms as i64,
                        "Next run should be within one interval from now"
                    );
                }
            } else {
                // 无锚点，diff 应该在 (0, every_ms] 范围内
                prop_assert!(
                    diff_ms > 0 && diff_ms <= every_ms as i64,
                    "Next run should be within one interval from now"
                );
            }
        }

        /// Property 1.6: Cron 类型 - 返回值总是在未来
        ///
        /// **Validates: Requirements 1.3, 2.2, 2.4**
        ///
        /// 对于任意有效的 Cron 类型调度，next_run_at 返回的时间应该总是大于 now
        #[test]
        fn prop_cron_returns_future_time(
            expr in arb_valid_cron_expr(),
            tz in arb_valid_timezone(),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();
            let schedule = ScheduleType::Cron { expr, tz };

            let next = schedule.next_run_at(now);

            prop_assert!(next.is_some(), "Valid Cron schedule should return Some");
            prop_assert!(
                next.unwrap() > now,
                "Cron schedule should return a future time"
            );
        }

        /// Property 1.7: Cron 类型 - 时区一致性
        ///
        /// **Validates: Requirements 2.2, 2.4**
        ///
        /// 对于相同的 cron 表达式，不同时区应该返回不同的 UTC 时间
        /// （除非恰好对齐）
        #[test]
        fn prop_cron_timezone_affects_result(
            expr in arb_valid_cron_expr(),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();

            let schedule_utc = ScheduleType::Cron {
                expr: expr.clone(),
                tz: Some("UTC".to_string()),
            };
            let schedule_shanghai = ScheduleType::Cron {
                expr: expr.clone(),
                tz: Some("Asia/Shanghai".to_string()),
            };

            let next_utc = schedule_utc.next_run_at(now);
            let next_shanghai = schedule_shanghai.next_run_at(now);

            prop_assert!(next_utc.is_some(), "UTC Cron should return Some");
            prop_assert!(next_shanghai.is_some(), "Shanghai Cron should return Some");

            // 两个时区的结果都应该在未来
            prop_assert!(next_utc.unwrap() > now);
            prop_assert!(next_shanghai.unwrap() > now);

            // 注意：我们不断言两个时间不同，因为在某些情况下它们可能相同
            // 但我们验证两者都是有效的未来时间
        }

        /// Property 1.8: 序列化往返一致性
        ///
        /// **Validates: Requirements 1.1, 1.2, 1.3**
        ///
        /// 对于任意 ScheduleType，序列化后再反序列化应该得到相同的值
        #[test]
        fn prop_schedule_type_roundtrip(schedule in arb_schedule_type()) {
            let json = serde_json::to_string(&schedule).unwrap();
            let deserialized: ScheduleType = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                schedule,
                deserialized,
                "ScheduleType should survive JSON roundtrip"
            );
        }

        /// Property 1.9: next_run_at 幂等性
        ///
        /// **Validates: Requirements 1.1, 1.2, 1.3**
        ///
        /// 对于相同的 ScheduleType 和 now，多次调用 next_run_at 应该返回相同的结果
        #[test]
        fn prop_next_run_at_idempotent(
            schedule in arb_schedule_type(),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();

            let result1 = schedule.next_run_at(now);
            let result2 = schedule.next_run_at(now);

            prop_assert_eq!(
                result1,
                result2,
                "next_run_at should be idempotent"
            );
        }

        /// Property 1.10: validate 与 next_run_at 一致性
        ///
        /// **Validates: Requirements 1.1, 1.2, 1.3**
        ///
        /// 如果 validate() 返回 Ok，则 next_run_at 应该能正常工作
        /// （对于 At 类型，可能返回 None 如果时间已过）
        #[test]
        fn prop_valid_schedule_works(
            schedule in arb_schedule_type(),
            now_ms in arb_timestamp_ms()
        ) {
            let now = DateTime::from_timestamp_millis(now_ms).unwrap();

            // 所有生成的 schedule 都应该是有效的
            let validation = schedule.validate();
            prop_assert!(
                validation.is_ok(),
                "Generated schedule should be valid: {:?}",
                validation
            );

            // next_run_at 不应该 panic
            let _ = schedule.next_run_at(now);
        }

        /// Property 2: Cron 表达式验证
        ///
        /// **Validates: Requirements 1.6, 2.5**
        ///
        /// *For any* cron 表达式字符串，验证函数应正确识别有效和无效的表达式
        #[test]
        fn prop_invalid_cron_expr_fails_validation(
            invalid_expr in "[a-z]{1,20}"
        ) {
            let schedule = ScheduleType::Cron {
                expr: invalid_expr,
                tz: None,
            };

            // 随机字符串不应该是有效的 cron 表达式
            let result = schedule.validate();
            prop_assert!(
                result.is_err(),
                "Random string should not be valid cron expression"
            );
        }

        /// Property 2.2: 无效时区验证
        ///
        /// **Validates: Requirements 2.5**
        #[test]
        fn prop_invalid_timezone_fails_validation(
            invalid_tz in "[A-Z]{1,10}/[A-Z]{1,10}"
        ) {
            let schedule = ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: Some(invalid_tz),
            };

            // 随机时区字符串不应该是有效的
            let result = schedule.validate();
            prop_assert!(
                result.is_err(),
                "Random timezone should not be valid"
            );
        }
    }

    // ------------------------------------------------------------------------
    // CronPayload 属性测试 (Task 2.1)
    // ------------------------------------------------------------------------

    /// 生成任意非空字符串
    fn arb_non_empty_string() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9 _-]{1,100}"
            .prop_map(|s| s.trim().to_string())
            .prop_filter("non-empty string", |s| !s.is_empty())
    }

    /// 生成可选的模型名称
    fn arb_model() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("gpt-4".to_string())),
            Just(Some("gpt-3.5-turbo".to_string())),
            Just(Some("claude-3-opus".to_string())),
            Just(Some("claude-3-sonnet".to_string())),
            Just(Some("openai/gpt-4".to_string())),
            Just(Some("anthropic/claude-3".to_string())),
        ]
    }

    /// 生成可选的思考级别
    fn arb_thinking() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("low".to_string())),
            Just(Some("medium".to_string())),
            Just(Some("high".to_string())),
        ]
    }

    /// 生成可选的超时时间
    fn arb_timeout() -> impl Strategy<Value = Option<u64>> {
        prop_oneof![Just(None), (1u64..3600u64).prop_map(Some),]
    }

    /// 生成可选的布尔值
    fn arb_optional_bool() -> impl Strategy<Value = Option<bool>> {
        prop_oneof![Just(None), Just(Some(true)), Just(Some(false)),]
    }

    /// 生成可选的渠道名称
    fn arb_channel() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("slack".to_string())),
            Just(Some("telegram".to_string())),
            Just(Some("email".to_string())),
            Just(Some("discord".to_string())),
        ]
    }

    /// 生成可选的目标
    fn arb_to() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("#general".to_string())),
            Just(Some("#reports".to_string())),
            Just(Some("user@example.com".to_string())),
            Just(Some("@user".to_string())),
        ]
    }

    /// 生成 CronPayload::SystemEvent
    fn arb_system_event() -> impl Strategy<Value = CronPayload> {
        arb_non_empty_string().prop_map(|text| CronPayload::SystemEvent { text })
    }

    /// 生成 CronPayload::AgentTurn
    fn arb_agent_turn() -> impl Strategy<Value = CronPayload> {
        (
            arb_non_empty_string(),
            arb_model(),
            arb_thinking(),
            arb_timeout(),
            arb_optional_bool(),
            arb_channel(),
            arb_to(),
            arb_optional_bool(),
        )
            .prop_map(
                |(
                    message,
                    model,
                    thinking,
                    timeout_seconds,
                    deliver,
                    channel,
                    to,
                    best_effort_deliver,
                )| {
                    CronPayload::AgentTurn {
                        message,
                        model,
                        thinking,
                        timeout_seconds,
                        deliver,
                        channel,
                        to,
                        best_effort_deliver,
                    }
                },
            )
    }

    /// 生成任意 CronPayload
    fn arb_cron_payload() -> impl Strategy<Value = CronPayload> {
        prop_oneof![arb_system_event(), arb_agent_turn(),]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 3: CronPayload 序列化往返
        ///
        /// **Validates: Requirements 3.6**
        ///
        /// *For any* 有效的 CronPayload 值，序列化为 JSON 后再反序列化应产生等价的值。
        ///
        /// 测试策略：
        /// - 使用 `arb_cron_payload()` 生成器生成任意 CronPayload（SystemEvent 或 AgentTurn）
        /// - 序列化为 JSON 字符串
        /// - 反序列化回 CronPayload
        /// - 验证原始值与反序列化后的值相等
        #[test]
        fn prop_cron_payload_roundtrip(payload in arb_cron_payload()) {
            let json = serde_json::to_string(&payload).unwrap();
            let deserialized: CronPayload = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                payload,
                deserialized,
                "CronPayload should survive JSON roundtrip"
            );
        }

        /// Property 2.2: get_text 返回正确的文本
        ///
        /// **Validates: Requirements 3.1, 3.2**
        ///
        /// 对于任意 CronPayload，get_text() 应该返回正确的文本内容
        #[test]
        fn prop_get_text_returns_correct_text(payload in arb_cron_payload()) {
            let text = payload.get_text();

            match &payload {
                CronPayload::SystemEvent { text: expected } => {
                    prop_assert_eq!(text, expected.as_str());
                }
                CronPayload::AgentTurn { message, .. } => {
                    prop_assert_eq!(text, message.as_str());
                }
            }
        }

        /// Property 2.3: is_system_event 和 is_agent_turn 互斥
        ///
        /// **Validates: Requirements 3.1, 3.2**
        ///
        /// 对于任意 CronPayload，is_system_event() 和 is_agent_turn() 应该互斥
        #[test]
        fn prop_type_checks_mutually_exclusive(payload in arb_cron_payload()) {
            let is_event = payload.is_system_event();
            let is_turn = payload.is_agent_turn();

            prop_assert!(
                is_event != is_turn,
                "is_system_event and is_agent_turn should be mutually exclusive"
            );
        }

        /// Property 2.4: SystemEvent 的 get_model/get_thinking/get_timeout 返回 None
        ///
        /// **Validates: Requirements 3.1**
        ///
        /// 对于 SystemEvent，Agent 相关的 getter 应该返回 None
        #[test]
        fn prop_system_event_agent_getters_return_none(text in arb_non_empty_string()) {
            let payload = CronPayload::SystemEvent { text };

            prop_assert!(payload.get_model().is_none());
            prop_assert!(payload.get_thinking().is_none());
            prop_assert!(payload.get_timeout_seconds().is_none());
        }

        /// Property 2.5: AgentTurn 的 getter 返回正确的值
        ///
        /// **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
        ///
        /// 对于 AgentTurn，getter 应该返回正确的配置值
        #[test]
        fn prop_agent_turn_getters_return_correct_values(
            message in arb_non_empty_string(),
            model in arb_model(),
            thinking in arb_thinking(),
            timeout_seconds in arb_timeout()
        ) {
            let payload = CronPayload::AgentTurn {
                message,
                model: model.clone(),
                thinking: thinking.clone(),
                timeout_seconds,
                deliver: None,
                channel: None,
                to: None,
                best_effort_deliver: None,
            };

            prop_assert_eq!(payload.get_model(), model.as_deref());
            prop_assert_eq!(payload.get_thinking(), thinking.as_deref());
            prop_assert_eq!(payload.get_timeout_seconds(), timeout_seconds);
        }

        /// Property 2.6: from_legacy_recipe 创建正确的 AgentTurn
        ///
        /// **Validates: Requirements 3.2**
        ///
        /// from_legacy_recipe 应该创建一个 AgentTurn，message 等于输入，其他字段为 None
        #[test]
        fn prop_from_legacy_recipe_creates_agent_turn(prompt in arb_non_empty_string()) {
            let payload = CronPayload::from_legacy_recipe(&prompt);

            prop_assert!(payload.is_agent_turn());
            prop_assert_eq!(payload.get_text(), prompt.as_str());
            prop_assert!(payload.get_model().is_none());
            prop_assert!(payload.get_thinking().is_none());
            prop_assert!(payload.get_timeout_seconds().is_none());
        }

        /// Property 2.7: system_event 辅助函数创建正确的 SystemEvent
        ///
        /// **Validates: Requirements 3.1**
        #[test]
        fn prop_system_event_helper_creates_correct_payload(text in arb_non_empty_string()) {
            let payload = CronPayload::system_event(&text);

            prop_assert!(payload.is_system_event());
            prop_assert_eq!(payload.get_text(), text.as_str());
        }

        /// Property 2.8: agent_turn 辅助函数创建正确的 AgentTurn
        ///
        /// **Validates: Requirements 3.2**
        #[test]
        fn prop_agent_turn_helper_creates_correct_payload(message in arb_non_empty_string()) {
            let payload = CronPayload::agent_turn(&message);

            prop_assert!(payload.is_agent_turn());
            prop_assert_eq!(payload.get_text(), message.as_str());
            prop_assert!(payload.get_model().is_none());
            prop_assert!(payload.get_thinking().is_none());
            prop_assert!(payload.get_timeout_seconds().is_none());
        }
    }

    // ------------------------------------------------------------------------
    // IsolationConfig 属性测试 (Task 2.2)
    // ------------------------------------------------------------------------

    /// 生成可选的前缀字符串
    fn arb_prefix() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("[任务]".to_string())),
            Just(Some("[报告]".to_string())),
            Just(Some("[定时]".to_string())),
            Just(Some("Scheduled:".to_string())),
        ]
    }

    /// 生成 PostToMainMode
    fn arb_post_to_main_mode() -> impl Strategy<Value = PostToMainMode> {
        prop_oneof![Just(PostToMainMode::Summary), Just(PostToMainMode::Full),]
    }

    /// 生成有效的 max_chars 值
    fn arb_max_chars() -> impl Strategy<Value = usize> {
        1usize..100_000usize
    }

    /// 生成 IsolationConfig
    fn arb_isolation_config() -> impl Strategy<Value = IsolationConfig> {
        (
            proptest::bool::ANY,
            arb_prefix(),
            arb_post_to_main_mode(),
            arb_max_chars(),
        )
            .prop_map(|(enabled, prefix, mode, max_chars)| IsolationConfig {
                enabled,
                post_to_main_prefix: prefix,
                post_to_main_mode: mode,
                post_to_main_max_chars: max_chars,
            })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 3.1: IsolationConfig 序列化往返一致性
        ///
        /// **Validates: Requirements 4.1, 4.2, 4.3**
        ///
        /// 对于任意 IsolationConfig，序列化为 JSON 后再反序列化应该得到相同的值
        #[test]
        fn prop_isolation_config_roundtrip(config in arb_isolation_config()) {
            let json = serde_json::to_string(&config).unwrap();
            let deserialized: IsolationConfig = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                config,
                deserialized,
                "IsolationConfig should survive JSON roundtrip"
            );
        }

        /// Property 3.2: PostToMainMode 序列化往返一致性
        ///
        /// **Validates: Requirements 4.2**
        ///
        /// 对于任意 PostToMainMode，序列化为 JSON 后再反序列化应该得到相同的值
        #[test]
        fn prop_post_to_main_mode_roundtrip(mode in arb_post_to_main_mode()) {
            let json = serde_json::to_string(&mode).unwrap();
            let deserialized: PostToMainMode = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                mode,
                deserialized,
                "PostToMainMode should survive JSON roundtrip"
            );
        }

        /// Property 3.3: truncate_output 不超过 max_chars
        ///
        /// **Validates: Requirements 4.3**
        ///
        /// 对于任意输出和配置，truncate_output 返回的字符数不应超过 max_chars + 3（省略号）
        #[test]
        fn prop_truncate_output_respects_max_chars(
            max_chars in 1usize..1000usize,
            output in ".*"
        ) {
            let config = IsolationConfig {
                post_to_main_max_chars: max_chars,
                ..Default::default()
            };

            let truncated = config.truncate_output(&output);
            let output_char_count = output.chars().count();
            let truncated_char_count = truncated.chars().count();

            // 如果原始输出的字符数不超过限制，应该保持原样
            if output_char_count <= max_chars {
                prop_assert_eq!(
                    truncated,
                    output,
                    "Output within limit should not be truncated"
                );
            } else {
                // 截断后的字符数应该是 max_chars + 3（"..."）
                prop_assert_eq!(
                    truncated_char_count,
                    max_chars + 3,
                    "Truncated output should be max_chars + 3 (for '...')"
                );
                prop_assert!(
                    truncated.ends_with("..."),
                    "Truncated output should end with '...'"
                );
            }
        }

        /// Property 3.4: format_message 包含前缀（如果设置）
        ///
        /// **Validates: Requirements 4.2**
        ///
        /// 如果设置了前缀，format_message 的输出应该以前缀开头
        #[test]
        fn prop_format_message_includes_prefix(
            prefix in arb_prefix(),
            mode in arb_post_to_main_mode(),
            output in arb_non_empty_string()
        ) {
            let config = IsolationConfig {
                enabled: true,
                post_to_main_prefix: prefix.clone(),
                post_to_main_mode: mode,
                post_to_main_max_chars: 10000,
            };

            let message = config.format_message(&output);

            if let Some(p) = prefix {
                prop_assert!(
                    message.starts_with(&p),
                    "Message should start with prefix"
                );
            } else {
                // 无前缀时，消息应该直接是输出内容（可能被截断）
                prop_assert!(
                    message == output || message.ends_with("..."),
                    "Message without prefix should be output or truncated output"
                );
            }
        }

        /// Property 3.5: enabled_summary 创建正确的配置
        ///
        /// **Validates: Requirements 4.1, 4.2**
        #[test]
        fn prop_enabled_summary_creates_correct_config(_dummy in Just(())) {
            let config = IsolationConfig::enabled_summary();

            prop_assert!(config.enabled);
            prop_assert!(config.post_to_main_prefix.is_none());
            prop_assert_eq!(config.post_to_main_mode, PostToMainMode::Summary);
            prop_assert_eq!(config.post_to_main_max_chars, 8000);
        }

        /// Property 3.6: enabled_full 创建正确的配置
        ///
        /// **Validates: Requirements 4.1, 4.2, 4.3**
        #[test]
        fn prop_enabled_full_creates_correct_config(max_chars in proptest::option::of(arb_max_chars())) {
            let config = IsolationConfig::enabled_full(max_chars);

            prop_assert!(config.enabled);
            prop_assert!(config.post_to_main_prefix.is_none());
            prop_assert_eq!(config.post_to_main_mode, PostToMainMode::Full);

            match max_chars {
                Some(mc) => prop_assert_eq!(config.post_to_main_max_chars, mc),
                None => prop_assert_eq!(config.post_to_main_max_chars, 8000),
            }
        }

        /// Property 3.7: with_prefix 设置正确的前缀
        ///
        /// **Validates: Requirements 4.2**
        #[test]
        fn prop_with_prefix_sets_correct_prefix(prefix in arb_non_empty_string()) {
            let config = IsolationConfig::enabled_summary()
                .with_prefix(&prefix);

            prop_assert_eq!(config.post_to_main_prefix, Some(prefix));
        }

        /// Property 3.8: Default trait 实现正确
        ///
        /// **Validates: Requirements 4.1, 4.2, 4.3**
        #[test]
        fn prop_default_is_correct(_dummy in Just(())) {
            let config = IsolationConfig::default();

            prop_assert!(!config.enabled);
            prop_assert!(config.post_to_main_prefix.is_none());
            prop_assert_eq!(config.post_to_main_mode, PostToMainMode::Summary);
            prop_assert_eq!(config.post_to_main_max_chars, 8000);
        }
    }

    // ------------------------------------------------------------------------
    // DeliveryConfig 属性测试 (Task 2.3)
    // ------------------------------------------------------------------------

    /// 生成可选的渠道名称（用于属性测试）
    fn arb_delivery_channel() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("slack".to_string())),
            Just(Some("telegram".to_string())),
            Just(Some("email".to_string())),
            Just(Some("discord".to_string())),
            Just(Some("webhook".to_string())),
        ]
    }

    /// 生成可选的投递目标（用于属性测试）
    fn arb_delivery_to() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("#general".to_string())),
            Just(Some("#reports".to_string())),
            Just(Some("@user".to_string())),
            Just(Some("admin@example.com".to_string())),
            Just(Some("https://webhook.example.com".to_string())),
        ]
    }

    /// 生成 DeliveryConfig
    fn arb_delivery_config() -> impl Strategy<Value = DeliveryConfig> {
        (
            proptest::bool::ANY,
            arb_delivery_channel(),
            arb_delivery_to(),
            proptest::bool::ANY,
        )
            .prop_map(|(enabled, channel, to, best_effort)| DeliveryConfig {
                enabled,
                channel,
                to,
                best_effort,
            })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 4.1: DeliveryConfig 序列化往返一致性
        ///
        /// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
        ///
        /// 对于任意 DeliveryConfig，序列化为 JSON 后再反序列化应该得到相同的值
        #[test]
        fn prop_delivery_config_roundtrip(config in arb_delivery_config()) {
            let json = serde_json::to_string(&config).unwrap();
            let deserialized: DeliveryConfig = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                config,
                deserialized,
                "DeliveryConfig should survive JSON roundtrip"
            );
        }

        /// Property 4.2: validate 对禁用配置总是返回 Ok
        ///
        /// **Validates: Requirements 5.1**
        ///
        /// 当 enabled 为 false 时，validate 应该总是返回 Ok
        #[test]
        fn prop_validate_disabled_always_ok(
            channel in arb_delivery_channel(),
            to in arb_delivery_to(),
            best_effort in proptest::bool::ANY
        ) {
            let config = DeliveryConfig {
                enabled: false,
                channel,
                to,
                best_effort,
            };

            prop_assert!(
                config.validate().is_ok(),
                "Disabled DeliveryConfig should always be valid"
            );
        }

        /// Property 4.3: validate 对启用且完整的配置返回 Ok
        ///
        /// **Validates: Requirements 5.1, 5.2, 5.3**
        ///
        /// 当 enabled 为 true 且 channel 和 to 都有值时，validate 应该返回 Ok
        #[test]
        fn prop_validate_enabled_complete_ok(
            channel in "[a-z]+",
            to in "[a-zA-Z0-9@#._-]+",
            best_effort in proptest::bool::ANY
        ) {
            let config = DeliveryConfig {
                enabled: true,
                channel: Some(channel),
                to: Some(to),
                best_effort,
            };

            prop_assert!(
                config.validate().is_ok(),
                "Enabled DeliveryConfig with channel and to should be valid"
            );
        }

        /// Property 4.4: validate 对启用但缺少 channel 的配置返回 Err
        ///
        /// **Validates: Requirements 5.2**
        ///
        /// 当 enabled 为 true 但 channel 为 None 时，validate 应该返回 Err
        #[test]
        fn prop_validate_enabled_no_channel_err(
            to in arb_delivery_to(),
            best_effort in proptest::bool::ANY
        ) {
            let config = DeliveryConfig {
                enabled: true,
                channel: None,
                to,
                best_effort,
            };

            prop_assert!(
                config.validate().is_err(),
                "Enabled DeliveryConfig without channel should be invalid"
            );
        }

        /// Property 4.5: validate 对启用但缺少 to 的配置返回 Err
        ///
        /// **Validates: Requirements 5.3**
        ///
        /// 当 enabled 为 true 但 to 为 None 时，validate 应该返回 Err
        #[test]
        fn prop_validate_enabled_no_to_err(
            channel in arb_delivery_channel().prop_filter("has channel", |c| c.is_some()),
            best_effort in proptest::bool::ANY
        ) {
            let config = DeliveryConfig {
                enabled: true,
                channel,
                to: None,
                best_effort,
            };

            prop_assert!(
                config.validate().is_err(),
                "Enabled DeliveryConfig without to should be invalid"
            );
        }

        /// Property 4.6: should_deliver 与 enabled 和配置完整性一致
        ///
        /// **Validates: Requirements 5.1, 5.2, 5.3**
        ///
        /// should_deliver 应该在 enabled 为 true 且 channel 和 to 都有值时返回 true
        #[test]
        fn prop_should_deliver_consistency(config in arb_delivery_config()) {
            let should = config.should_deliver();
            let expected = config.enabled && config.channel.is_some() && config.to.is_some();

            prop_assert_eq!(
                should,
                expected,
                "should_deliver should match enabled && channel.is_some() && to.is_some()"
            );
        }

        /// Property 4.7: enabled 辅助函数创建正确的配置
        ///
        /// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
        #[test]
        fn prop_enabled_helper_creates_correct_config(
            channel in "[a-z]+",
            to in "[a-zA-Z0-9@#._-]+"
        ) {
            let config = DeliveryConfig::enabled(&channel, &to);

            prop_assert!(config.enabled);
            prop_assert_eq!(config.channel, Some(channel));
            prop_assert_eq!(config.to, Some(to));
            prop_assert!(config.best_effort);
        }

        /// Property 4.8: enabled_strict 辅助函数创建正确的配置
        ///
        /// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
        #[test]
        fn prop_enabled_strict_helper_creates_correct_config(
            channel in "[a-z]+",
            to in "[a-zA-Z0-9@#._-]+"
        ) {
            let config = DeliveryConfig::enabled_strict(&channel, &to);

            prop_assert!(config.enabled);
            prop_assert_eq!(config.channel, Some(channel));
            prop_assert_eq!(config.to, Some(to));
            prop_assert!(!config.best_effort);
        }

        /// Property 4.9: with_best_effort 设置正确的值
        ///
        /// **Validates: Requirements 5.4**
        #[test]
        fn prop_with_best_effort_sets_correct_value(
            config in arb_delivery_config(),
            best_effort in proptest::bool::ANY
        ) {
            let modified = config.clone().with_best_effort(best_effort);

            prop_assert_eq!(modified.best_effort, best_effort);
            // 其他字段应该保持不变
            prop_assert_eq!(modified.enabled, config.enabled);
            prop_assert_eq!(modified.channel, config.channel);
            prop_assert_eq!(modified.to, config.to);
        }

        /// Property 4.10: Default trait 实现正确
        ///
        /// **Validates: Requirements 5.1, 5.4**
        #[test]
        fn prop_delivery_default_is_correct(_dummy in Just(())) {
            let config = DeliveryConfig::default();

            prop_assert!(!config.enabled);
            prop_assert!(config.channel.is_none());
            prop_assert!(config.to.is_none());
            prop_assert!(config.best_effort);
        }
    }

    // ------------------------------------------------------------------------
    // SessionTarget 属性测试 (Task 4.2)
    // ------------------------------------------------------------------------

    /// 生成 SessionTarget
    fn arb_session_target() -> impl Strategy<Value = SessionTarget> {
        prop_oneof![Just(SessionTarget::Main), Just(SessionTarget::Isolated),]
    }

    // ------------------------------------------------------------------------
    // WakeMode 属性测试 (Task 4.2)
    // ------------------------------------------------------------------------

    /// 生成 WakeMode
    fn arb_wake_mode() -> impl Strategy<Value = WakeMode> {
        prop_oneof![Just(WakeMode::NextHeartbeat), Just(WakeMode::Now),]
    }

    // ------------------------------------------------------------------------
    // ScheduledJob 属性测试 (Task 4.2)
    // ------------------------------------------------------------------------

    /// 生成有效的任务 ID
    fn arb_job_id() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,30}".prop_filter("non-empty id", |s| !s.is_empty())
    }

    /// 生成有效的任务名称
    fn arb_job_name() -> impl Strategy<Value = String> {
        "[A-Za-z][A-Za-z0-9 _-]{0,50}".prop_filter("non-empty name", |s| !s.is_empty())
    }

    /// 生成可选的描述
    fn arb_description() -> impl Strategy<Value = Option<String>> {
        prop_oneof![Just(None), arb_non_empty_string().prop_map(Some),]
    }

    /// 生成可选的 Agent ID
    fn arb_agent_id() -> impl Strategy<Value = Option<String>> {
        prop_oneof![Just(None), arb_job_id().prop_map(Some),]
    }

    /// 生成可选的 IsolationConfig
    fn arb_optional_isolation() -> impl Strategy<Value = Option<IsolationConfig>> {
        prop_oneof![Just(None), arb_isolation_config().prop_map(Some),]
    }

    /// 生成可选的 DeliveryConfig（有效配置）
    fn arb_optional_delivery() -> impl Strategy<Value = Option<DeliveryConfig>> {
        prop_oneof![
            Just(None),
            Just(Some(DeliveryConfig::default())),
            Just(Some(DeliveryConfig::enabled("slack", "#general"))),
            Just(Some(DeliveryConfig::enabled_strict(
                "email",
                "admin@example.com"
            ))),
        ]
    }

    /// 生成可选的旧格式字段
    fn arb_legacy_source() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("/path/to/recipe.md".to_string())),
            Just(Some("recipes/daily.md".to_string())),
        ]
    }

    /// 生成可选的旧格式 cron
    fn arb_legacy_cron() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("0 0 9 * * *".to_string())),
            Just(Some("0 */5 * * * *".to_string())),
        ]
    }

    /// 生成 ScheduledJob
    ///
    /// 使用嵌套元组来避免 proptest 的 12 元素限制
    fn arb_scheduled_job() -> impl Strategy<Value = ScheduledJob> {
        // 第一组：基本信息
        let basic = (
            arb_job_id(),
            arb_agent_id(),
            arb_job_name(),
            arb_description(),
            proptest::bool::ANY, // enabled
            proptest::bool::ANY, // delete_after_run
        );

        // 第二组：时间和调度
        let timing = (
            arb_timestamp_ms(), // created_at_ms
            arb_timestamp_ms(), // updated_at_ms
            arb_schedule_type(),
            arb_session_target(),
            arb_wake_mode(),
        );

        // 第三组：载荷和配置
        let config = (
            arb_cron_payload(),
            arb_optional_isolation(),
            arb_optional_delivery(),
            arb_legacy_source(),
            arb_legacy_cron(),
        );

        (basic, timing, config).prop_map(
            |(
                (id, agent_id, name, description, enabled, delete_after_run),
                (created_at_ms, updated_at_ms, schedule, session_target, wake_mode),
                (payload, isolation, delivery, source, cron),
            )| {
                ScheduledJob {
                    id,
                    agent_id,
                    name,
                    description,
                    enabled,
                    delete_after_run,
                    created_at_ms,
                    updated_at_ms,
                    schedule,
                    session_target,
                    wake_mode,
                    payload,
                    isolation,
                    delivery,
                    state: JobState::default(),
                    source,
                    cron,
                }
            },
        )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 4: ScheduledJob 序列化往返
        ///
        /// **Validates: Requirements 6.9, 6.10**
        ///
        /// *For any* 有效的 ScheduledJob 值，序列化为 JSON 后再反序列化应产生等价的值。
        #[test]
        fn prop_scheduled_job_roundtrip(job in arb_scheduled_job()) {
            let json = serde_json::to_string(&job).unwrap();
            let deserialized: ScheduledJob = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                job,
                deserialized,
                "ScheduledJob should survive JSON roundtrip"
            );
        }

        /// Property 5.1: SessionTarget 序列化往返一致性
        ///
        /// **Validates: Requirements 6.5**
        #[test]
        fn prop_session_target_roundtrip(target in arb_session_target()) {
            let json = serde_json::to_string(&target).unwrap();
            let deserialized: SessionTarget = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                target,
                deserialized,
                "SessionTarget should survive JSON roundtrip"
            );
        }

        /// Property 5.2: WakeMode 序列化往返一致性
        ///
        /// **Validates: Requirements 6.5**
        #[test]
        fn prop_wake_mode_roundtrip(mode in arb_wake_mode()) {
            let json = serde_json::to_string(&mode).unwrap();
            let deserialized: WakeMode = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(
                mode,
                deserialized,
                "WakeMode should survive JSON roundtrip"
            );
        }

        /// Property 5.3: SessionTarget is_main 和 is_isolated 互斥
        ///
        /// **Validates: Requirements 6.5**
        #[test]
        fn prop_session_target_mutually_exclusive(target in arb_session_target()) {
            let is_main = target.is_main();
            let is_isolated = target.is_isolated();

            prop_assert!(
                is_main != is_isolated,
                "is_main and is_isolated should be mutually exclusive"
            );
        }

        /// Property 5.4: WakeMode is_next_heartbeat 和 is_now 互斥
        ///
        /// **Validates: Requirements 6.5**
        #[test]
        fn prop_wake_mode_mutually_exclusive(mode in arb_wake_mode()) {
            let is_next_heartbeat = mode.is_next_heartbeat();
            let is_now = mode.is_now();

            prop_assert!(
                is_next_heartbeat != is_now,
                "is_next_heartbeat and is_now should be mutually exclusive"
            );
        }

        /// Property 5.5: ScheduledJob.new 创建有效的任务
        ///
        /// **Validates: Requirements 6.1, 6.3, 6.5, 6.6**
        #[test]
        fn prop_scheduled_job_new_creates_valid_job(
            id in arb_job_id(),
            name in arb_job_name(),
            schedule in arb_schedule_type(),
            payload in arb_cron_payload()
        ) {
            let job = ScheduledJob::new(&id, &name, schedule.clone(), payload.clone());

            prop_assert_eq!(job.id, id);
            prop_assert_eq!(job.name, name);
            prop_assert!(job.enabled);
            prop_assert!(!job.delete_after_run);
            prop_assert_eq!(job.session_target, SessionTarget::Main);
            prop_assert_eq!(job.wake_mode, WakeMode::NextHeartbeat);
            prop_assert!(job.agent_id.is_none());
            prop_assert!(job.description.is_none());
            prop_assert!(job.isolation.is_none());
            prop_assert!(job.delivery.is_none());
            prop_assert!(job.source.is_none());
            prop_assert!(job.cron.is_none());
        }

        /// Property 5.6: enable/disable 正确切换状态
        ///
        /// **Validates: Requirements 6.3**
        #[test]
        fn prop_enable_disable_toggles_state(job in arb_scheduled_job()) {
            let mut job = job;

            job.disable();
            prop_assert!(!job.is_enabled());

            job.enable();
            prop_assert!(job.is_enabled());
        }

        /// Property 5.7: is_one_time 对 At 类型和 delete_after_run 返回 true
        ///
        /// **Validates: Requirements 6.4**
        #[test]
        fn prop_is_one_time_correct(
            id in arb_job_id(),
            name in arb_job_name(),
            payload in arb_cron_payload()
        ) {
            // At 类型任务是一次性的
            let at_job = ScheduledJob::new(
                &id,
                &name,
                ScheduleType::At { at_ms: 1704153600000 },
                payload.clone(),
            );
            prop_assert!(at_job.is_one_time());

            // 设置 delete_after_run 的任务是一次性的
            let delete_job = ScheduledJob::new(
                &id,
                &name,
                ScheduleType::Every {
                    every_ms: 60000,
                    anchor_ms: None,
                },
                payload.clone(),
            )
            .with_delete_after_run(true);
            prop_assert!(delete_job.is_one_time());

            // 普通 Cron 任务不是一次性的
            let cron_job = ScheduledJob::new(
                &id,
                &name,
                ScheduleType::Cron {
                    expr: "0 0 9 * * *".to_string(),
                    tz: None,
                },
                payload,
            );
            prop_assert!(!cron_job.is_one_time());
        }

        /// Property 5.8: mark_running/mark_completed 正确更新状态
        ///
        /// **Validates: Requirements 6.8**
        #[test]
        fn prop_mark_running_completed_updates_state(
            id in arb_job_id(),
            name in arb_job_name(),
            duration_ms in 0u64..10000u64
        ) {
            let mut job = ScheduledJob::new(
                &id,
                &name,
                ScheduleType::Cron {
                    expr: "0 0 9 * * *".to_string(),
                    tz: None,
                },
                CronPayload::system_event("Test"),
            );

            prop_assert!(!job.is_running());

            job.mark_running();
            prop_assert!(job.is_running());

            job.mark_completed(duration_ms);
            prop_assert!(!job.is_running());
            prop_assert!(job.state.was_successful());
            prop_assert_eq!(job.state.last_duration_ms, Some(duration_ms));
        }

        /// Property 5.9: mark_failed 正确记录错误
        ///
        /// **Validates: Requirements 6.8**
        #[test]
        fn prop_mark_failed_records_error(
            id in arb_job_id(),
            name in arb_job_name(),
            duration_ms in 0u64..10000u64,
            error in arb_non_empty_string()
        ) {
            let mut job = ScheduledJob::new(
                &id,
                &name,
                ScheduleType::Cron {
                    expr: "0 0 9 * * *".to_string(),
                    tz: None,
                },
                CronPayload::system_event("Test"),
            );

            job.mark_running();
            job.mark_failed(duration_ms, &error);

            prop_assert!(!job.is_running());
            prop_assert!(job.state.was_failed());
            prop_assert_eq!(job.state.last_error, Some(error));
        }

        /// Property 5.10: from_legacy 正确迁移旧格式
        ///
        /// **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
        #[test]
        fn prop_from_legacy_migrates_correctly(
            id in arb_job_id(),
            cron_expr in arb_valid_cron_expr(),
            source_path in arb_non_empty_string(),
            paused in proptest::bool::ANY
        ) {
            let job = ScheduledJob::from_legacy(
                &id,
                &cron_expr,
                &source_path,
                paused,
                None,
            );

            // ID 保持不变
            prop_assert_eq!(&job.id, &id);
            // 名称使用 ID
            prop_assert_eq!(&job.name, &job.id);
            // enabled 与 paused 相反
            prop_assert_eq!(job.enabled, !paused);
            // 保留旧格式字段
            prop_assert_eq!(job.source, Some(source_path.clone()));
            prop_assert_eq!(job.cron, Some(cron_expr.clone()));
            // 调度类型为 Cron
            match &job.schedule {
                ScheduleType::Cron { expr, tz } => {
                    prop_assert_eq!(expr, &cron_expr);
                    prop_assert!(tz.is_none());
                }
                _ => prop_assert!(false, "Expected Cron schedule"),
            }
            // 载荷为 AgentTurn
            prop_assert!(job.payload.is_agent_turn());
            prop_assert_eq!(job.payload.get_text(), source_path);
        }
    }
}
