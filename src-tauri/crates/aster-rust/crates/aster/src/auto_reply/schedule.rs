//! Scheduler 集成模块
//!
//! 本模块实现自动回复系统与 Scheduler 的集成，支持定时触发自动回复。
//!
//! # 功能
//!
//! - 支持 Cron 表达式调度
//! - 支持一次性定时 (At) 调度
//! - 支持固定间隔 (Every) 调度
//! - 创建触发事件并传递上下文给 Agent
//!
//! # 需求映射
//!
//! - **Requirement 8.1**: 集成现有 Scheduler 模块
//! - **Requirement 8.2**: Schedule 触发时创建触发事件
//! - **Requirement 8.3**: 支持 Cron 表达式配置
//! - **Requirement 8.4**: 支持一次性 (At) 调度
//! - **Requirement 8.5**: 支持间隔 (Every) 调度
//! - **Requirement 8.6**: 传递 schedule 上下文给 Agent

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::auto_reply::message::{IncomingMessage, TriggerContext, TriggerResult};
use crate::auto_reply::registry::AutoReplyTrigger;
use crate::auto_reply::types::{ScheduleTriggerConfig, ScheduleType, TriggerConfig, TriggerType};

/// Schedule 触发事件
///
/// 当定时触发器触发时创建的事件，包含触发的上下文信息。
///
/// **Validates: Requirement 8.2**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleTriggerEvent {
    /// 触发器 ID
    pub trigger_id: String,
    /// 调度类型
    pub schedule_type: ScheduleType,
    /// 触发时间
    pub triggered_at: DateTime<Utc>,
    /// 下次触发时间（如果有）
    pub next_trigger_at: Option<DateTime<Utc>>,
}

/// Schedule 上下文
///
/// 传递给 Agent 的调度上下文信息。
///
/// **Validates: Requirement 8.6**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleContext {
    /// 触发器 ID
    pub trigger_id: String,
    /// 触发器名称
    pub trigger_name: String,
    /// 调度类型描述
    pub schedule_description: String,
    /// 触发时间
    pub triggered_at: DateTime<Utc>,
    /// 是否为首次触发
    pub is_first_trigger: bool,
    /// 上次触发时间（如果有）
    pub last_triggered_at: Option<DateTime<Utc>>,
    /// 附加元数据
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

/// 已注册的调度触发器状态
#[derive(Debug, Clone)]
struct RegisteredSchedule {
    /// 触发器配置
    trigger: AutoReplyTrigger,
    /// 调度配置
    schedule_config: ScheduleTriggerConfig,
    /// 下次触发时间
    next_trigger_at: Option<DateTime<Utc>>,
    /// 上次触发时间
    last_triggered_at: Option<DateTime<Utc>>,
    /// 是否已触发过
    has_triggered: bool,
}

/// Schedule 触发处理器
///
/// 管理定时触发器，支持 Cron、At、Every 三种调度类型。
///
/// # 功能
///
/// - 注册/注销调度触发器
/// - 计算下次触发时间
/// - 检查并触发到期的调度
/// - 创建触发事件和上下文
///
/// # 需求映射
///
/// - **Requirement 8.1**: 集成现有 Scheduler 模块
/// - **Requirement 8.2**: Schedule 触发时创建触发事件
/// - **Requirement 8.3**: 支持 Cron 表达式配置
/// - **Requirement 8.4**: 支持一次性 (At) 调度
/// - **Requirement 8.5**: 支持间隔 (Every) 调度
/// - **Requirement 8.6**: 传递 schedule 上下文给 Agent
pub struct ScheduleTriggerHandler {
    /// 已注册的调度触发器
    schedules: Arc<RwLock<HashMap<String, RegisteredSchedule>>>,
}

impl Default for ScheduleTriggerHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl ScheduleTriggerHandler {
    /// 创建新的 Schedule 触发处理器
    ///
    /// **Validates: Requirement 8.1**
    pub fn new() -> Self {
        Self {
            schedules: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 注册调度触发器
    ///
    /// # 参数
    /// - `trigger`: 自动回复触发器配置
    ///
    /// # 返回值
    /// - `Ok(())`: 注册成功
    /// - `Err(String)`: 注册失败（配置无效或类型不匹配）
    ///
    /// **Validates: Requirements 8.1, 8.3, 8.4, 8.5**
    pub async fn register(&self, trigger: AutoReplyTrigger) -> Result<(), String> {
        // 验证触发器类型
        if trigger.trigger_type != TriggerType::Schedule {
            return Err(format!("触发器 {} 不是 Schedule 类型", trigger.id));
        }

        // 提取调度配置
        let schedule_config = match &trigger.config {
            TriggerConfig::Schedule(config) => config.clone(),
            _ => {
                return Err(format!("触发器 {} 配置类型不匹配", trigger.id));
            }
        };

        // 验证调度配置
        self.validate_schedule_type(&schedule_config.schedule_type)?;

        // 计算下次触发时间
        let now = Utc::now();
        let next_trigger_at = self.calculate_next_trigger(&schedule_config.schedule_type, now);

        let registered = RegisteredSchedule {
            trigger,
            schedule_config,
            next_trigger_at,
            last_triggered_at: None,
            has_triggered: false,
        };

        let trigger_id = registered.trigger.id.clone();
        let mut schedules = self.schedules.write().await;
        schedules.insert(trigger_id.clone(), registered);

        tracing::info!("已注册调度触发器: {}", trigger_id);
        Ok(())
    }

    /// 注销调度触发器
    ///
    /// # 参数
    /// - `trigger_id`: 触发器 ID
    ///
    /// # 返回值
    /// - `Some(AutoReplyTrigger)`: 被移除的触发器
    /// - `None`: 触发器不存在
    pub async fn unregister(&self, trigger_id: &str) -> Option<AutoReplyTrigger> {
        let mut schedules = self.schedules.write().await;
        schedules.remove(trigger_id).map(|s| {
            tracing::info!("已注销调度触发器: {}", trigger_id);
            s.trigger
        })
    }

    /// 验证调度类型配置
    ///
    /// **Validates: Requirements 8.3, 8.4, 8.5**
    fn validate_schedule_type(&self, schedule_type: &ScheduleType) -> Result<(), String> {
        match schedule_type {
            ScheduleType::Cron { expr, timezone } => {
                // 验证 Cron 表达式 (Requirement 8.3)
                if expr.is_empty() {
                    return Err("Cron 表达式不能为空".to_string());
                }
                // 验证时区（如果提供）
                if let Some(tz) = timezone {
                    if tz.parse::<chrono_tz::Tz>().is_err() {
                        return Err(format!("无效的时区: {}", tz));
                    }
                }
                // 验证 cron 表达式格式
                if cron::Schedule::from_str(expr).is_err() {
                    return Err(format!("无效的 Cron 表达式: {}", expr));
                }
                Ok(())
            }
            ScheduleType::At { at_ms } => {
                // 验证一次性定时 (Requirement 8.4)
                if *at_ms <= 0 {
                    return Err("At 调度时间戳必须为正数".to_string());
                }
                Ok(())
            }
            ScheduleType::Every { every_ms } => {
                // 验证固定间隔 (Requirement 8.5)
                if *every_ms == 0 {
                    return Err("Every 间隔必须大于 0".to_string());
                }
                Ok(())
            }
        }
    }

    /// 计算下次触发时间
    ///
    /// **Validates: Requirements 8.3, 8.4, 8.5**
    fn calculate_next_trigger(
        &self,
        schedule_type: &ScheduleType,
        now: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        match schedule_type {
            ScheduleType::Cron { expr, timezone } => {
                // Cron 表达式调度 (Requirement 8.3)
                self.next_cron_trigger(expr, timezone.as_deref(), now)
            }
            ScheduleType::At { at_ms } => {
                // 一次性定时 (Requirement 8.4)
                let at_time = DateTime::from_timestamp_millis(*at_ms)?;
                if at_time > now {
                    Some(at_time)
                } else {
                    None // 已过期
                }
            }
            ScheduleType::Every { every_ms } => {
                // 固定间隔 (Requirement 8.5)
                if *every_ms == 0 {
                    return None;
                }
                let next = now + chrono::Duration::milliseconds(*every_ms as i64);
                Some(next)
            }
        }
    }

    /// 计算 Cron 表达式的下次触发时间
    ///
    /// **Validates: Requirement 8.3**
    fn next_cron_trigger(
        &self,
        expr: &str,
        timezone: Option<&str>,
        now: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        use cron::Schedule;
        use std::str::FromStr;

        let schedule = Schedule::from_str(expr).ok()?;
        let tz: chrono_tz::Tz = timezone
            .and_then(|s| s.parse().ok())
            .unwrap_or(chrono_tz::UTC);

        let now_in_tz = now.with_timezone(&tz);
        schedule
            .after(&now_in_tz)
            .next()
            .map(|dt| dt.with_timezone(&Utc))
    }

    /// 检查并获取到期的触发器
    ///
    /// 返回所有已到期需要触发的调度，并更新其状态。
    ///
    /// **Validates: Requirement 8.2**
    pub async fn check_and_fire(&self) -> Vec<ScheduleTriggerEvent> {
        let now = Utc::now();
        let mut events = Vec::new();
        let mut schedules = self.schedules.write().await;

        for (trigger_id, schedule) in schedules.iter_mut() {
            // 跳过禁用的触发器
            if !schedule.trigger.enabled {
                continue;
            }

            // 检查是否到期
            if let Some(next_at) = schedule.next_trigger_at {
                if next_at <= now {
                    // 创建触发事件 (Requirement 8.2)
                    let event = ScheduleTriggerEvent {
                        trigger_id: trigger_id.clone(),
                        schedule_type: schedule.schedule_config.schedule_type.clone(),
                        triggered_at: now,
                        next_trigger_at: None, // 稍后计算
                    };

                    // 更新状态
                    schedule.last_triggered_at = Some(now);
                    schedule.has_triggered = true;

                    // 计算下次触发时间
                    let next =
                        self.calculate_next_trigger(&schedule.schedule_config.schedule_type, now);
                    schedule.next_trigger_at = next;

                    let mut event = event;
                    event.next_trigger_at = next;
                    events.push(event);
                }
            }
        }

        events
    }

    /// 创建触发结果
    ///
    /// 根据触发事件创建 TriggerResult，用于与 AutoReplyManager 集成。
    ///
    /// **Validates: Requirements 8.2, 8.6**
    pub async fn create_trigger_result(
        &self,
        event: &ScheduleTriggerEvent,
    ) -> Option<TriggerResult> {
        let schedules = self.schedules.read().await;
        let schedule = schedules.get(&event.trigger_id)?;

        // 创建虚拟的入站消息（用于 Schedule 触发）
        let message = IncomingMessage {
            id: format!(
                "schedule-{}-{}",
                event.trigger_id,
                event.triggered_at.timestamp_millis()
            ),
            sender_id: "system".to_string(),
            sender_name: Some("Scheduler".to_string()),
            content: format!(
                "[定时触发] {} - {}",
                schedule.trigger.name,
                self.describe_schedule_type(&schedule.schedule_config.schedule_type)
            ),
            channel: "schedule".to_string(),
            group_id: None,
            is_direct_message: false,
            mentions_bot: false,
            timestamp: event.triggered_at,
            metadata: HashMap::new(),
        };

        // 创建触发上下文 (Requirement 8.6)
        let mut extra = HashMap::new();
        extra.insert(
            "schedule_type".to_string(),
            serde_json::to_value(&event.schedule_type).unwrap_or_default(),
        );
        if let Some(next) = event.next_trigger_at {
            extra.insert(
                "next_trigger_at".to_string(),
                serde_json::Value::String(next.to_rfc3339()),
            );
        }

        let context = TriggerContext {
            trigger_id: event.trigger_id.clone(),
            trigger_type: TriggerType::Schedule,
            message,
            match_details: None,
            triggered_at: event.triggered_at,
            extra,
        };

        Some(TriggerResult::Triggered {
            trigger: Box::new(schedule.trigger.clone()),
            context: Box::new(context),
        })
    }

    /// 创建 Schedule 上下文
    ///
    /// 创建传递给 Agent 的调度上下文信息。
    ///
    /// **Validates: Requirement 8.6**
    pub async fn create_schedule_context(
        &self,
        event: &ScheduleTriggerEvent,
    ) -> Option<ScheduleContext> {
        let schedules = self.schedules.read().await;
        let schedule = schedules.get(&event.trigger_id)?;

        Some(ScheduleContext {
            trigger_id: event.trigger_id.clone(),
            trigger_name: schedule.trigger.name.clone(),
            schedule_description: self
                .describe_schedule_type(&schedule.schedule_config.schedule_type),
            triggered_at: event.triggered_at,
            is_first_trigger: !schedule.has_triggered,
            last_triggered_at: schedule.last_triggered_at,
            metadata: HashMap::new(),
        })
    }

    /// 描述调度类型
    fn describe_schedule_type(&self, schedule_type: &ScheduleType) -> String {
        match schedule_type {
            ScheduleType::Cron { expr, timezone } => {
                let tz_info = timezone
                    .as_ref()
                    .map(|tz| format!(" ({})", tz))
                    .unwrap_or_default();
                format!("Cron: {}{}", expr, tz_info)
            }
            ScheduleType::At { at_ms } => {
                if let Some(dt) = DateTime::from_timestamp_millis(*at_ms) {
                    format!("一次性: {}", dt.format("%Y-%m-%d %H:%M:%S UTC"))
                } else {
                    format!("一次性: {}ms", at_ms)
                }
            }
            ScheduleType::Every { every_ms } => {
                let duration = format_duration(*every_ms);
                format!("每隔: {}", duration)
            }
        }
    }

    /// 获取所有已注册的调度触发器
    pub async fn list_schedules(&self) -> Vec<(String, ScheduleType, Option<DateTime<Utc>>)> {
        let schedules = self.schedules.read().await;
        schedules
            .iter()
            .map(|(id, s)| {
                (
                    id.clone(),
                    s.schedule_config.schedule_type.clone(),
                    s.next_trigger_at,
                )
            })
            .collect()
    }

    /// 获取指定触发器的下次触发时间
    pub async fn get_next_trigger_time(&self, trigger_id: &str) -> Option<DateTime<Utc>> {
        let schedules = self.schedules.read().await;
        schedules.get(trigger_id).and_then(|s| s.next_trigger_at)
    }

    /// 检查触发器是否已注册
    pub async fn is_registered(&self, trigger_id: &str) -> bool {
        let schedules = self.schedules.read().await;
        schedules.contains_key(trigger_id)
    }

    /// 获取已注册的触发器数量
    pub async fn count(&self) -> usize {
        let schedules = self.schedules.read().await;
        schedules.len()
    }
}

/// 格式化毫秒为可读的时间间隔
fn format_duration(ms: u64) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;

    if days > 0 {
        format!("{}天{}小时", days, hours % 24)
    } else if hours > 0 {
        format!("{}小时{}分钟", hours, minutes % 60)
    } else if minutes > 0 {
        format!("{}分钟{}秒", minutes, seconds % 60)
    } else if seconds > 0 {
        format!("{}秒", seconds)
    } else {
        format!("{}毫秒", ms)
    }
}

// 需要引入 std::str::FromStr（cron::Schedule 在方法内部使用）
use std::str::FromStr;

#[cfg(test)]
mod tests {
    use super::*;

    // ========== 辅助函数测试 ==========

    #[test]
    fn test_format_duration_milliseconds() {
        assert_eq!(format_duration(500), "500毫秒");
        assert_eq!(format_duration(999), "999毫秒");
    }

    #[test]
    fn test_format_duration_seconds() {
        assert_eq!(format_duration(1000), "1秒");
        assert_eq!(format_duration(30000), "30秒");
        assert_eq!(format_duration(59000), "59秒");
    }

    #[test]
    fn test_format_duration_minutes() {
        assert_eq!(format_duration(60000), "1分钟0秒");
        assert_eq!(format_duration(90000), "1分钟30秒");
        assert_eq!(format_duration(3600000 - 1000), "59分钟59秒");
    }

    #[test]
    fn test_format_duration_hours() {
        assert_eq!(format_duration(3600000), "1小时0分钟");
        assert_eq!(format_duration(5400000), "1小时30分钟");
    }

    #[test]
    fn test_format_duration_days() {
        assert_eq!(format_duration(86400000), "1天0小时");
        assert_eq!(format_duration(90000000), "1天1小时");
    }

    // ========== ScheduleTriggerHandler 测试 ==========

    fn create_cron_trigger(id: &str, expr: &str) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("Cron Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::Schedule,
            config: TriggerConfig::Schedule(ScheduleTriggerConfig {
                schedule_type: ScheduleType::Cron {
                    expr: expr.to_string(),
                    timezone: None,
                },
            }),
            priority: 10,
            response_template: None,
        }
    }

    fn create_at_trigger(id: &str, at_ms: i64) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("At Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::Schedule,
            config: TriggerConfig::Schedule(ScheduleTriggerConfig {
                schedule_type: ScheduleType::At { at_ms },
            }),
            priority: 10,
            response_template: None,
        }
    }

    fn create_every_trigger(id: &str, every_ms: u64) -> AutoReplyTrigger {
        AutoReplyTrigger {
            id: id.to_string(),
            name: format!("Every Trigger {}", id),
            enabled: true,
            trigger_type: TriggerType::Schedule,
            config: TriggerConfig::Schedule(ScheduleTriggerConfig {
                schedule_type: ScheduleType::Every { every_ms },
            }),
            priority: 10,
            response_template: None,
        }
    }

    #[tokio::test]
    async fn test_handler_new() {
        let handler = ScheduleTriggerHandler::new();
        assert_eq!(handler.count().await, 0);
    }

    #[tokio::test]
    async fn test_handler_default() {
        let handler = ScheduleTriggerHandler::default();
        assert_eq!(handler.count().await, 0);
    }

    /// **Validates: Requirement 8.3** - 支持 Cron 表达式配置
    #[tokio::test]
    async fn test_register_cron_trigger() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_cron_trigger("cron-1", "0 0 * * * *"); // 每小时

        let result = handler.register(trigger).await;
        assert!(result.is_ok());
        assert!(handler.is_registered("cron-1").await);
        assert_eq!(handler.count().await, 1);
    }

    /// **Validates: Requirement 8.4** - 支持一次性 (At) 调度
    #[tokio::test]
    async fn test_register_at_trigger() {
        let handler = ScheduleTriggerHandler::new();
        // 设置为未来时间
        let future_ms = Utc::now().timestamp_millis() + 3600000; // 1小时后
        let trigger = create_at_trigger("at-1", future_ms);

        let result = handler.register(trigger).await;
        assert!(result.is_ok());
        assert!(handler.is_registered("at-1").await);
    }

    /// **Validates: Requirement 8.5** - 支持间隔 (Every) 调度
    #[tokio::test]
    async fn test_register_every_trigger() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_every_trigger("every-1", 60000); // 每分钟

        let result = handler.register(trigger).await;
        assert!(result.is_ok());
        assert!(handler.is_registered("every-1").await);
    }

    #[tokio::test]
    async fn test_register_invalid_trigger_type() {
        let handler = ScheduleTriggerHandler::new();
        // 创建一个非 Schedule 类型的触发器
        let trigger = AutoReplyTrigger {
            id: "mention-1".to_string(),
            name: "Mention Trigger".to_string(),
            enabled: true,
            trigger_type: TriggerType::Mention,
            config: TriggerConfig::Mention,
            priority: 10,
            response_template: None,
        };

        let result = handler.register(trigger).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不是 Schedule 类型"));
    }

    #[tokio::test]
    async fn test_register_invalid_cron_expression() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_cron_trigger("invalid-cron", "invalid cron");

        let result = handler.register(trigger).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("无效的 Cron 表达式"));
    }

    #[tokio::test]
    async fn test_register_invalid_every_interval() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_every_trigger("invalid-every", 0);

        let result = handler.register(trigger).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("间隔必须大于 0"));
    }

    #[tokio::test]
    async fn test_unregister_existing_trigger() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_every_trigger("every-1", 60000);
        handler.register(trigger).await.unwrap();

        let removed = handler.unregister("every-1").await;
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, "every-1");
        assert!(!handler.is_registered("every-1").await);
    }

    #[tokio::test]
    async fn test_unregister_nonexistent_trigger() {
        let handler = ScheduleTriggerHandler::new();
        let removed = handler.unregister("nonexistent").await;
        assert!(removed.is_none());
    }

    #[tokio::test]
    async fn test_list_schedules() {
        let handler = ScheduleTriggerHandler::new();
        handler
            .register(create_cron_trigger("cron-1", "0 0 * * * *"))
            .await
            .unwrap();
        handler
            .register(create_every_trigger("every-1", 60000))
            .await
            .unwrap();

        let schedules = handler.list_schedules().await;
        assert_eq!(schedules.len(), 2);
    }

    #[tokio::test]
    async fn test_get_next_trigger_time() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_every_trigger("every-1", 60000);
        handler.register(trigger).await.unwrap();

        let next = handler.get_next_trigger_time("every-1").await;
        assert!(next.is_some());
    }

    /// **Validates: Requirement 8.2** - Schedule 触发时创建触发事件
    #[tokio::test]
    async fn test_check_and_fire_expired_at_trigger() {
        let handler = ScheduleTriggerHandler::new();
        // 创建一个已过期的 At 触发器（过去时间）
        let past_ms = Utc::now().timestamp_millis() - 1000; // 1秒前
        let trigger = create_at_trigger("at-past", past_ms);

        // 手动注册（绕过验证，因为正常注册会拒绝过期时间）
        {
            let mut schedules = handler.schedules.write().await;
            schedules.insert(
                "at-past".to_string(),
                RegisteredSchedule {
                    trigger,
                    schedule_config: ScheduleTriggerConfig {
                        schedule_type: ScheduleType::At { at_ms: past_ms },
                    },
                    next_trigger_at: Some(DateTime::from_timestamp_millis(past_ms).unwrap()),
                    last_triggered_at: None,
                    has_triggered: false,
                },
            );
        }

        let events = handler.check_and_fire().await;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].trigger_id, "at-past");
    }

    /// **Validates: Requirement 8.6** - 传递 schedule 上下文给 Agent
    #[tokio::test]
    async fn test_create_schedule_context() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_every_trigger("every-1", 60000);
        handler.register(trigger).await.unwrap();

        let event = ScheduleTriggerEvent {
            trigger_id: "every-1".to_string(),
            schedule_type: ScheduleType::Every { every_ms: 60000 },
            triggered_at: Utc::now(),
            next_trigger_at: None,
        };

        let context = handler.create_schedule_context(&event).await;
        assert!(context.is_some());
        let ctx = context.unwrap();
        assert_eq!(ctx.trigger_id, "every-1");
        assert!(ctx.schedule_description.contains("每隔"));
    }

    /// **Validates: Requirement 8.2** - 创建触发结果
    #[tokio::test]
    async fn test_create_trigger_result() {
        let handler = ScheduleTriggerHandler::new();
        let trigger = create_cron_trigger("cron-1", "0 0 * * * *");
        handler.register(trigger).await.unwrap();

        let event = ScheduleTriggerEvent {
            trigger_id: "cron-1".to_string(),
            schedule_type: ScheduleType::Cron {
                expr: "0 0 * * * *".to_string(),
                timezone: None,
            },
            triggered_at: Utc::now(),
            next_trigger_at: None,
        };

        let result = handler.create_trigger_result(&event).await;
        assert!(result.is_some());

        match result.unwrap() {
            TriggerResult::Triggered { trigger, context } => {
                assert_eq!(trigger.id, "cron-1");
                assert_eq!(context.trigger_type, TriggerType::Schedule);
                assert!(context.extra.contains_key("schedule_type"));
            }
            _ => panic!("Expected TriggerResult::Triggered"),
        }
    }

    // ========== ScheduleType 描述测试 ==========

    #[tokio::test]
    async fn test_describe_cron_schedule() {
        let handler = ScheduleTriggerHandler::new();
        let schedule_type = ScheduleType::Cron {
            expr: "0 0 * * * *".to_string(),
            timezone: Some("Asia/Shanghai".to_string()),
        };
        let desc = handler.describe_schedule_type(&schedule_type);
        assert!(desc.contains("Cron"));
        assert!(desc.contains("Asia/Shanghai"));
    }

    #[tokio::test]
    async fn test_describe_at_schedule() {
        let handler = ScheduleTriggerHandler::new();
        let at_ms = Utc::now().timestamp_millis();
        let schedule_type = ScheduleType::At { at_ms };
        let desc = handler.describe_schedule_type(&schedule_type);
        assert!(desc.contains("一次性"));
    }

    #[tokio::test]
    async fn test_describe_every_schedule() {
        let handler = ScheduleTriggerHandler::new();
        let schedule_type = ScheduleType::Every { every_ms: 3600000 };
        let desc = handler.describe_schedule_type(&schedule_type);
        assert!(desc.contains("每隔"));
        assert!(desc.contains("小时"));
    }

    // ========================================================================
    // Property 8: Schedule 配置类型支持 - 属性测试
    // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
    // **Validates: Requirements 8.3-8.5**
    // ========================================================================

    use proptest::prelude::*;

    /// 测试配置
    fn test_config() -> ProptestConfig {
        ProptestConfig::with_cases(100)
    }

    // ========== 生成器定义 ==========

    /// 生成有效的 Cron 表达式
    /// **Validates: Requirement 8.3**
    fn arb_valid_cron_expr() -> impl Strategy<Value = String> {
        // 生成有效的 cron 表达式（6 字段格式：秒 分 时 日 月 周）
        prop_oneof![
            Just("0 0 * * * *".to_string()),    // 每小时
            Just("0 */5 * * * *".to_string()),  // 每 5 分钟
            Just("0 0 0 * * *".to_string()),    // 每天午夜
            Just("0 0 12 * * *".to_string()),   // 每天中午
            Just("0 30 9 * * 1-5".to_string()), // 工作日 9:30
            Just("0 0 0 1 * *".to_string()),    // 每月 1 号
            Just("0 0 0 * * 0".to_string()),    // 每周日
            Just("0 0 */2 * * *".to_string()),  // 每 2 小时
        ]
    }

    /// 生成有效的时区
    fn arb_timezone() -> impl Strategy<Value = Option<String>> {
        prop_oneof![
            Just(None),
            Just(Some("UTC".to_string())),
            Just(Some("Asia/Shanghai".to_string())),
            Just(Some("America/New_York".to_string())),
            Just(Some("Europe/London".to_string())),
        ]
    }

    /// 生成 Cron 调度类型
    /// **Validates: Requirement 8.3**
    fn arb_cron_schedule() -> impl Strategy<Value = ScheduleType> {
        (arb_valid_cron_expr(), arb_timezone())
            .prop_map(|(expr, timezone)| ScheduleType::Cron { expr, timezone })
    }

    /// 生成 At 调度类型（一次性定时）
    /// **Validates: Requirement 8.4**
    fn arb_at_schedule() -> impl Strategy<Value = ScheduleType> {
        // 生成有效的时间戳（正数，未来时间）
        (1i64..=i64::MAX / 2).prop_map(|at_ms| ScheduleType::At { at_ms })
    }

    /// 生成 Every 调度类型（固定间隔）
    /// **Validates: Requirement 8.5**
    fn arb_every_schedule() -> impl Strategy<Value = ScheduleType> {
        // 生成有效的间隔（大于 0）
        (1u64..=u64::MAX / 2).prop_map(|every_ms| ScheduleType::Every { every_ms })
    }

    /// 生成任意有效的 ScheduleType
    /// **Validates: Requirements 8.3-8.5**
    fn arb_schedule_type() -> impl Strategy<Value = ScheduleType> {
        prop_oneof![arb_cron_schedule(), arb_at_schedule(), arb_every_schedule(),]
    }

    /// 生成 ScheduleTriggerConfig
    fn arb_schedule_trigger_config() -> impl Strategy<Value = ScheduleTriggerConfig> {
        arb_schedule_type().prop_map(|schedule_type| ScheduleTriggerConfig { schedule_type })
    }

    proptest! {
        #![proptest_config(test_config())]

        // ====================================================================
        // Property 8.1: ScheduleType 序列化 Round-Trip
        // **Validates: Requirements 8.3-8.5**
        // ====================================================================

        /// Property 8.1: ScheduleType 序列化后再反序列化应保持配置完整性
        ///
        /// *For any* ScheduleType 配置（Cron、At、Every），序列化和反序列化应保持配置完整性。
        #[test]
        fn prop_schedule_type_roundtrip(schedule_type in arb_schedule_type()) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirements 8.3-8.5**

            // 序列化为 JSON
            let json = serde_json::to_string(&schedule_type)
                .expect("ScheduleType 应该能序列化为 JSON");

            // 反序列化回 ScheduleType
            let parsed: ScheduleType = serde_json::from_str(&json)
                .expect("JSON 应该能反序列化回 ScheduleType");

            // 验证 round-trip 一致性
            prop_assert_eq!(
                schedule_type,
                parsed,
                "ScheduleType round-trip 应保持一致"
            );
        }

        // ====================================================================
        // Property 8.2: ScheduleTriggerConfig 序列化 Round-Trip
        // **Validates: Requirements 8.3-8.5**
        // ====================================================================

        /// Property 8.2: ScheduleTriggerConfig 序列化后再反序列化应保持配置完整性
        #[test]
        fn prop_schedule_trigger_config_roundtrip(
            config in arb_schedule_trigger_config()
        ) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirements 8.3-8.5**

            // 序列化为 JSON
            let json = serde_json::to_string(&config)
                .expect("ScheduleTriggerConfig 应该能序列化为 JSON");

            // 反序列化回 ScheduleTriggerConfig
            let parsed: ScheduleTriggerConfig = serde_json::from_str(&json)
                .expect("JSON 应该能反序列化回 ScheduleTriggerConfig");

            // 验证 round-trip 一致性
            prop_assert_eq!(
                config,
                parsed,
                "ScheduleTriggerConfig round-trip 应保持一致"
            );
        }

        // ====================================================================
        // Property 8.3: Cron 调度类型序列化格式
        // **Validates: Requirement 8.3**
        // ====================================================================

        /// Property 8.3: Cron 调度类型序列化应包含 kind 字段
        #[test]
        fn prop_cron_schedule_serialization_format(
            schedule_type in arb_cron_schedule()
        ) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirement 8.3**

            let json = serde_json::to_string(&schedule_type)
                .expect("Cron ScheduleType 应该能序列化");

            // 验证 JSON 包含 kind: "cron"
            prop_assert!(
                json.contains("\"kind\":\"cron\""),
                "Cron 调度类型 JSON 应包含 kind:cron，实际: {}",
                json
            );

            // 验证 JSON 包含 expr 字段
            prop_assert!(
                json.contains("\"expr\""),
                "Cron 调度类型 JSON 应包含 expr 字段，实际: {}",
                json
            );
        }

        // ====================================================================
        // Property 8.4: At 调度类型序列化格式
        // **Validates: Requirement 8.4**
        // ====================================================================

        /// Property 8.4: At 调度类型序列化应包含 kind 字段
        #[test]
        fn prop_at_schedule_serialization_format(schedule_type in arb_at_schedule()) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirement 8.4**

            let json = serde_json::to_string(&schedule_type)
                .expect("At ScheduleType 应该能序列化");

            // 验证 JSON 包含 kind: "at"
            prop_assert!(
                json.contains("\"kind\":\"at\""),
                "At 调度类型 JSON 应包含 kind:at，实际: {}",
                json
            );

            // 验证 JSON 包含 at_ms 字段
            prop_assert!(
                json.contains("\"at_ms\""),
                "At 调度类型 JSON 应包含 at_ms 字段，实际: {}",
                json
            );
        }

        // ====================================================================
        // Property 8.5: Every 调度类型序列化格式
        // **Validates: Requirement 8.5**
        // ====================================================================

        /// Property 8.5: Every 调度类型序列化应包含 kind 字段
        #[test]
        fn prop_every_schedule_serialization_format(
            schedule_type in arb_every_schedule()
        ) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirement 8.5**

            let json = serde_json::to_string(&schedule_type)
                .expect("Every ScheduleType 应该能序列化");

            // 验证 JSON 包含 kind: "every"
            prop_assert!(
                json.contains("\"kind\":\"every\""),
                "Every 调度类型 JSON 应包含 kind:every，实际: {}",
                json
            );

            // 验证 JSON 包含 every_ms 字段
            prop_assert!(
                json.contains("\"every_ms\""),
                "Every 调度类型 JSON 应包含 every_ms 字段，实际: {}",
                json
            );
        }

        // ====================================================================
        // Property 8.6: 调度类型字段值保持一致
        // **Validates: Requirements 8.3-8.5**
        // ====================================================================

        /// Property 8.6: Cron 调度类型字段值在 round-trip 后保持一致
        #[test]
        fn prop_cron_fields_preserved(
            expr in arb_valid_cron_expr(),
            timezone in arb_timezone()
        ) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirement 8.3**

            let original = ScheduleType::Cron {
                expr: expr.clone(),
                timezone: timezone.clone(),
            };

            let json = serde_json::to_string(&original).unwrap();
            let parsed: ScheduleType = serde_json::from_str(&json).unwrap();

            match parsed {
                ScheduleType::Cron {
                    expr: parsed_expr,
                    timezone: parsed_tz,
                } => {
                    prop_assert_eq!(expr, parsed_expr, "expr 字段应保持一致");
                    prop_assert_eq!(timezone, parsed_tz, "timezone 字段应保持一致");
                }
                _ => prop_assert!(false, "解析后应为 Cron 类型"),
            }
        }

        /// Property 8.7: At 调度类型字段值在 round-trip 后保持一致
        #[test]
        fn prop_at_fields_preserved(at_ms in 1i64..=i64::MAX / 2) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirement 8.4**

            let original = ScheduleType::At { at_ms };

            let json = serde_json::to_string(&original).unwrap();
            let parsed: ScheduleType = serde_json::from_str(&json).unwrap();

            match parsed {
                ScheduleType::At { at_ms: parsed_ms } => {
                    prop_assert_eq!(at_ms, parsed_ms, "at_ms 字段应保持一致");
                }
                _ => prop_assert!(false, "解析后应为 At 类型"),
            }
        }

        /// Property 8.8: Every 调度类型字段值在 round-trip 后保持一致
        #[test]
        fn prop_every_fields_preserved(every_ms in 1u64..=u64::MAX / 2) {
            // Feature: auto-reply-mechanism, Property 8: Schedule 配置类型支持
            // **Validates: Requirement 8.5**

            let original = ScheduleType::Every { every_ms };

            let json = serde_json::to_string(&original).unwrap();
            let parsed: ScheduleType = serde_json::from_str(&json).unwrap();

            match parsed {
                ScheduleType::Every { every_ms: parsed_ms } => {
                    prop_assert_eq!(every_ms, parsed_ms, "every_ms 字段应保持一致");
                }
                _ => prop_assert!(false, "解析后应为 Every 类型"),
            }
        }
    }
}
