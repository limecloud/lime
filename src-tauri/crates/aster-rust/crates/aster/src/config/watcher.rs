//! 配置监控增强模块
//!
//! 提供配置验证、原子性更新和防抖功能

use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

/// 配置验证 trait
pub trait ConfigValidator: Send + Sync {
    /// 验证配置
    ///
    /// 返回 Ok(()) 表示验证通过，Err 包含错误列表
    fn validate(&self, config: &Value) -> Result<(), Vec<String>>;
}

/// 默认验证器（总是通过）
pub struct NoopValidator;

impl ConfigValidator for NoopValidator {
    fn validate(&self, _config: &Value) -> Result<(), Vec<String>> {
        Ok(())
    }
}

/// Schema 验证器
///
/// 检查必需字段是否存在
pub struct RequiredFieldsValidator {
    required_fields: Vec<String>,
}

impl RequiredFieldsValidator {
    pub fn new(fields: Vec<String>) -> Self {
        Self {
            required_fields: fields,
        }
    }
}

impl ConfigValidator for RequiredFieldsValidator {
    fn validate(&self, config: &Value) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        if let Value::Object(map) = config {
            for field in &self.required_fields {
                if !map.contains_key(field) {
                    errors.push(format!("缺少必需字段: {field}"));
                }
            }
        } else {
            errors.push("配置必须是 JSON 对象".to_string());
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

/// 组合验证器
pub struct CompositeValidator {
    validators: Vec<Box<dyn ConfigValidator>>,
}

impl CompositeValidator {
    pub fn new() -> Self {
        Self {
            validators: Vec::new(),
        }
    }

    pub fn with_validator(mut self, validator: Box<dyn ConfigValidator>) -> Self {
        self.validators.push(validator);
        self
    }
}

impl Default for CompositeValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl ConfigValidator for CompositeValidator {
    fn validate(&self, config: &Value) -> Result<(), Vec<String>> {
        let mut all_errors = Vec::new();
        for validator in &self.validators {
            if let Err(errors) = validator.validate(config) {
                all_errors.extend(errors);
            }
        }
        if all_errors.is_empty() {
            Ok(())
        } else {
            Err(all_errors)
        }
    }
}

/// 原子配置更新器
///
/// 提供验证 -> 更新 -> 回滚的原子性配置更新
pub struct AtomicConfigUpdate<T: Clone + Serialize> {
    /// 当前配置
    current: Arc<RwLock<T>>,
    /// 验证器
    validator: Box<dyn ConfigValidator>,
}

/// 更新结果
#[derive(Debug)]
pub enum UpdateResult {
    /// 更新成功
    Success,
    /// 验证失败
    ValidationFailed(Vec<String>),
    /// 序列化失败
    SerializationFailed(String),
}

impl<T: Clone + Serialize> AtomicConfigUpdate<T> {
    /// 创建新的原子更新器
    pub fn new(config: Arc<RwLock<T>>, validator: Box<dyn ConfigValidator>) -> Self {
        Self {
            current: config,
            validator,
        }
    }

    /// 尝试更新配置
    ///
    /// 流程：序列化新配置 -> 验证 -> 原子替换
    /// 验证失败时保持旧配置不变
    pub fn try_update(&self, new_config: T) -> UpdateResult {
        // 序列化为 JSON 进行验证
        let json_value = match serde_json::to_value(&new_config) {
            Ok(v) => v,
            Err(e) => return UpdateResult::SerializationFailed(e.to_string()),
        };

        // 验证
        if let Err(errors) = self.validator.validate(&json_value) {
            tracing::warn!("[ConfigUpdate] 配置验证失败: {:?}", errors);
            return UpdateResult::ValidationFailed(errors);
        }

        // 原子替换
        let mut current = self.current.write();
        *current = new_config;

        tracing::info!("[ConfigUpdate] 配置更新成功");
        UpdateResult::Success
    }

    /// 获取当前配置的克隆
    pub fn current(&self) -> T {
        self.current.read().clone()
    }
}

/// 防抖配置变更通知器
///
/// 在配置文件频繁变更时，只在最后一次变更后的指定延迟后触发回调
pub struct DebouncedNotifier {
    /// 防抖延迟
    debounce: Duration,
    /// 最后一次变更时间
    last_change: Arc<RwLock<Option<std::time::Instant>>>,
    /// 是否有待处理的通知
    pending: Arc<RwLock<bool>>,
}

impl DebouncedNotifier {
    /// 创建新的防抖通知器
    pub fn new(debounce: Duration) -> Self {
        Self {
            debounce,
            last_change: Arc::new(RwLock::new(None)),
            pending: Arc::new(RwLock::new(false)),
        }
    }

    /// 记录变更
    pub fn notify_change(&self) {
        *self.last_change.write() = Some(std::time::Instant::now());
        *self.pending.write() = true;
    }

    /// 检查是否应该触发回调
    ///
    /// 如果距离最后一次变更已超过防抖延迟，返回 true 并重置状态
    pub fn should_fire(&self) -> bool {
        let pending = *self.pending.read();
        if !pending {
            return false;
        }

        let last = *self.last_change.read();
        match last {
            Some(t) if t.elapsed() >= self.debounce => {
                *self.pending.write() = false;
                true
            }
            _ => false,
        }
    }

    /// 获取防抖延迟
    pub fn debounce_duration(&self) -> Duration {
        self.debounce
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_noop_validator_always_passes() {
        let validator = NoopValidator;
        let config = json!({"any": "value"});
        assert!(validator.validate(&config).is_ok());
    }

    #[test]
    fn test_required_fields_validator_passes() {
        let validator = RequiredFieldsValidator::new(vec!["name".into(), "port".into()]);
        let config = json!({"name": "test", "port": 8080});
        assert!(validator.validate(&config).is_ok());
    }

    #[test]
    fn test_required_fields_validator_fails() {
        let validator = RequiredFieldsValidator::new(vec!["name".into(), "port".into()]);
        let config = json!({"name": "test"});
        let err = validator.validate(&config).unwrap_err();
        assert_eq!(err.len(), 1);
        assert!(err[0].contains("port"));
    }

    #[test]
    fn test_required_fields_validator_non_object() {
        let validator = RequiredFieldsValidator::new(vec!["name".into()]);
        let config = json!("not an object");
        let err = validator.validate(&config).unwrap_err();
        assert!(err[0].contains("JSON 对象"));
    }

    #[test]
    fn test_composite_validator_all_pass() {
        let composite = CompositeValidator::new()
            .with_validator(Box::new(NoopValidator))
            .with_validator(Box::new(RequiredFieldsValidator::new(vec!["name".into()])));
        let config = json!({"name": "test"});
        assert!(composite.validate(&config).is_ok());
    }

    #[test]
    fn test_composite_validator_some_fail() {
        let composite = CompositeValidator::new()
            .with_validator(Box::new(RequiredFieldsValidator::new(vec!["a".into()])))
            .with_validator(Box::new(RequiredFieldsValidator::new(vec!["b".into()])));
        let config = json!({"c": 1});
        let err = composite.validate(&config).unwrap_err();
        assert_eq!(err.len(), 2);
    }

    #[test]
    fn test_atomic_update_success() {
        let config = Arc::new(RwLock::new(json!({"name": "old"})));
        let validator = Box::new(RequiredFieldsValidator::new(vec!["name".into()]));
        let updater = AtomicConfigUpdate::new(config.clone(), validator);

        let result = updater.try_update(json!({"name": "new"}));
        assert!(matches!(result, UpdateResult::Success));
        assert_eq!(updater.current(), json!({"name": "new"}));
    }

    #[test]
    fn test_atomic_update_validation_failure() {
        let config = Arc::new(RwLock::new(json!({"name": "old"})));
        let validator = Box::new(RequiredFieldsValidator::new(vec!["name".into()]));
        let updater = AtomicConfigUpdate::new(config.clone(), validator);

        let result = updater.try_update(json!({"port": 8080}));
        assert!(matches!(result, UpdateResult::ValidationFailed(_)));
        // 验证失败时保持旧配置
        assert_eq!(updater.current(), json!({"name": "old"}));
    }

    #[test]
    fn test_debounced_notifier_initial_state() {
        let notifier = DebouncedNotifier::new(Duration::from_millis(100));
        assert!(!notifier.should_fire());
    }

    #[test]
    fn test_debounced_notifier_fires_after_delay() {
        let notifier = DebouncedNotifier::new(Duration::from_millis(10));
        notifier.notify_change();

        // 立即检查不应触发
        // (在极快的机器上可能会通过，所以只测试延迟后的情况)
        std::thread::sleep(Duration::from_millis(20));
        assert!(notifier.should_fire());

        // 触发后不应再次触发
        assert!(!notifier.should_fire());
    }
}
