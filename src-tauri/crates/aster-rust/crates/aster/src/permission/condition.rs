//! 条件评估模块
//!
//! 本模块实现了权限条件的评估功能，支持：
//! - 上下文字段获取
//! - 多种条件运算符评估
//! - 多条件 AND 逻辑组合
//!
//! Requirements: 4.1, 4.2, 4.3, 4.4, 4.5

use crate::permission::types::{
    ConditionOperator, ConditionType, PermissionCondition, PermissionContext,
};
use regex::Regex;
use serde_json::Value;

/// 从权限上下文中获取指定字段的值
///
/// # Arguments
/// * `context` - 权限上下文
/// * `field` - 要获取的字段名
///
/// # Returns
/// 如果字段存在则返回 `Some(Value)`，否则返回 `None`
///
/// # Supported Fields
/// - `working_directory` - 当前工作目录路径
/// - `session_id` - 会话 ID
/// - `timestamp` - 时间戳
/// - `user` - 用户标识
/// - `environment.<key>` - 环境变量
/// - `metadata.<key>` - 元数据字段
///
/// Requirements: 4.1
pub fn get_context_field(context: &PermissionContext, field: &str) -> Option<Value> {
    match field {
        "working_directory" => Some(Value::String(
            context.working_directory.to_string_lossy().to_string(),
        )),
        "session_id" => Some(Value::String(context.session_id.clone())),
        "timestamp" => Some(Value::Number(context.timestamp.into())),
        "user" => context.user.as_ref().map(|u| Value::String(u.clone())),
        _ => {
            // 处理嵌套字段，如 environment.PATH 或 metadata.custom_field
            if let Some(env_key) = field.strip_prefix("environment.") {
                context
                    .environment
                    .get(env_key)
                    .map(|v| Value::String(v.clone()))
            } else if let Some(meta_key) = field.strip_prefix("metadata.") {
                context.metadata.get(meta_key).cloned()
            } else {
                None
            }
        }
    }
}

/// 评估单个权限条件
///
/// # Arguments
/// * `condition` - 要评估的权限条件
/// * `context` - 权限上下文
///
/// # Returns
/// 如果条件满足则返回 `true`，否则返回 `false`
///
/// # Supported Operators
/// - `Equals` - 值相等
/// - `NotEquals` - 值不相等
/// - `Contains` - 字符串包含
/// - `NotContains` - 字符串不包含
/// - `Matches` - 正则表达式匹配
/// - `NotMatches` - 正则表达式不匹配
/// - `Range` - 数值范围内
/// - `In` - 值在列表中
/// - `NotIn` - 值不在列表中
/// - `Custom` - 自定义验证器
///
/// Requirements: 4.2
pub fn evaluate_condition(condition: &PermissionCondition, context: &PermissionContext) -> bool {
    // 如果是自定义条件类型且有验证器，直接使用验证器
    if condition.condition_type == ConditionType::Custom {
        if let Some(ref validator) = condition.validator {
            return validator(context);
        }
        // 没有验证器的自定义条件默认返回 false
        return false;
    }

    // 如果运算符是 Custom，使用验证器
    if condition.operator == ConditionOperator::Custom {
        if let Some(ref validator) = condition.validator {
            return validator(context);
        }
        return false;
    }

    // 获取要比较的字段值
    let field_value = match &condition.field {
        Some(field) => get_context_field(context, field),
        None => {
            // 没有指定字段时，根据条件类型选择默认字段
            match condition.condition_type {
                ConditionType::Context => get_context_field(context, "working_directory"),
                ConditionType::Time => get_context_field(context, "timestamp"),
                ConditionType::User => get_context_field(context, "user"),
                ConditionType::Session => get_context_field(context, "session_id"),
                ConditionType::Custom => None,
            }
        }
    };

    // 如果字段不存在，条件不满足
    let field_value = match field_value {
        Some(v) => v,
        None => return false,
    };

    // 根据运算符评估条件
    evaluate_operator(&condition.operator, &field_value, &condition.value)
}

/// 根据运算符评估两个值
fn evaluate_operator(
    operator: &ConditionOperator,
    field_value: &Value,
    condition_value: &Value,
) -> bool {
    match operator {
        ConditionOperator::Equals => values_equal(field_value, condition_value),
        ConditionOperator::NotEquals => !values_equal(field_value, condition_value),
        ConditionOperator::Contains => string_contains(field_value, condition_value),
        ConditionOperator::NotContains => !string_contains(field_value, condition_value),
        ConditionOperator::Matches => regex_matches(field_value, condition_value),
        ConditionOperator::NotMatches => !regex_matches(field_value, condition_value),
        ConditionOperator::Range => value_in_range(field_value, condition_value),
        ConditionOperator::In => value_in_list(field_value, condition_value),
        ConditionOperator::NotIn => !value_in_list(field_value, condition_value),
        ConditionOperator::Custom => false, // 已在上面处理
    }
}

/// 比较两个 JSON 值是否相等
fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(s1), Value::String(s2)) => s1 == s2,
        (Value::Number(n1), Value::Number(n2)) => {
            // 比较数值，考虑浮点数精度
            if let (Some(f1), Some(f2)) = (n1.as_f64(), n2.as_f64()) {
                (f1 - f2).abs() < f64::EPSILON
            } else if let (Some(i1), Some(i2)) = (n1.as_i64(), n2.as_i64()) {
                i1 == i2
            } else {
                false
            }
        }
        (Value::Bool(b1), Value::Bool(b2)) => b1 == b2,
        (Value::Null, Value::Null) => true,
        // 字符串与数字的比较
        (Value::String(s), Value::Number(n)) | (Value::Number(n), Value::String(s)) => {
            if let Ok(parsed) = s.parse::<f64>() {
                if let Some(num) = n.as_f64() {
                    return (parsed - num).abs() < f64::EPSILON;
                }
            }
            false
        }
        _ => a == b,
    }
}

/// 检查字符串是否包含子串
fn string_contains(field_value: &Value, pattern: &Value) -> bool {
    let field_str = match field_value {
        Value::String(s) => s.as_str(),
        _ => return false,
    };

    let pattern_str = match pattern {
        Value::String(s) => s.as_str(),
        _ => return false,
    };

    field_str.contains(pattern_str)
}

/// 检查字符串是否匹配正则表达式
fn regex_matches(field_value: &Value, pattern: &Value) -> bool {
    let field_str = match field_value {
        Value::String(s) => s.as_str(),
        _ => return false,
    };

    let pattern_str = match pattern {
        Value::String(s) => s.as_str(),
        _ => return false,
    };

    match Regex::new(pattern_str) {
        Ok(re) => re.is_match(field_str),
        Err(_) => false,
    }
}

/// 检查数值是否在范围内
///
/// 期望 condition_value 是一个包含 "min" 和/或 "max" 字段的对象
fn value_in_range(field_value: &Value, range: &Value) -> bool {
    let num = match field_value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse::<f64>().ok(),
        _ => None,
    };

    let num = match num {
        Some(n) => n,
        None => return false,
    };

    let range_obj = match range {
        Value::Object(obj) => obj,
        _ => return false,
    };

    let min_ok = match range_obj.get("min") {
        Some(Value::Number(n)) => n.as_f64().map(|min| num >= min).unwrap_or(true),
        None => true,
        _ => false,
    };

    let max_ok = match range_obj.get("max") {
        Some(Value::Number(n)) => n.as_f64().map(|max| num <= max).unwrap_or(true),
        None => true,
        _ => false,
    };

    min_ok && max_ok
}

/// 检查值是否在列表中
fn value_in_list(field_value: &Value, list: &Value) -> bool {
    let arr = match list {
        Value::Array(arr) => arr,
        _ => return false,
    };

    arr.iter().any(|item| values_equal(field_value, item))
}

/// 检查多个条件是否全部满足（AND 逻辑）
///
/// # Arguments
/// * `conditions` - 条件列表
/// * `context` - 权限上下文
///
/// # Returns
/// 如果所有条件都满足则返回 `true`，否则返回 `false`
/// 空条件列表返回 `true`
///
/// Requirements: 4.3
pub fn check_conditions(conditions: &[PermissionCondition], context: &PermissionContext) -> bool {
    // 空条件列表视为无条件，返回 true
    if conditions.is_empty() {
        return true;
    }

    // 所有条件必须为 true（AND 逻辑）
    conditions
        .iter()
        .all(|condition| evaluate_condition(condition, context))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    fn create_test_context() -> PermissionContext {
        let mut environment = HashMap::new();
        environment.insert("PATH".to_string(), "/usr/bin:/bin".to_string());
        environment.insert("HOME".to_string(), "/home/user".to_string());

        let mut metadata = HashMap::new();
        metadata.insert("role".to_string(), Value::String("admin".to_string()));
        metadata.insert("level".to_string(), Value::Number(5.into()));

        PermissionContext {
            working_directory: PathBuf::from("/home/user/project"),
            session_id: "session-123".to_string(),
            timestamp: 1700000000,
            user: Some("testuser".to_string()),
            environment,
            metadata,
        }
    }

    // get_context_field 测试
    #[test]
    fn test_get_context_field_working_directory() {
        let context = create_test_context();
        let value = get_context_field(&context, "working_directory");
        assert_eq!(value, Some(Value::String("/home/user/project".to_string())));
    }

    #[test]
    fn test_get_context_field_session_id() {
        let context = create_test_context();
        let value = get_context_field(&context, "session_id");
        assert_eq!(value, Some(Value::String("session-123".to_string())));
    }

    #[test]
    fn test_get_context_field_timestamp() {
        let context = create_test_context();
        let value = get_context_field(&context, "timestamp");
        assert_eq!(value, Some(Value::Number(1700000000.into())));
    }

    #[test]
    fn test_get_context_field_user() {
        let context = create_test_context();
        let value = get_context_field(&context, "user");
        assert_eq!(value, Some(Value::String("testuser".to_string())));
    }

    #[test]
    fn test_get_context_field_user_none() {
        let mut context = create_test_context();
        context.user = None;
        let value = get_context_field(&context, "user");
        assert_eq!(value, None);
    }

    #[test]
    fn test_get_context_field_environment() {
        let context = create_test_context();
        let value = get_context_field(&context, "environment.PATH");
        assert_eq!(value, Some(Value::String("/usr/bin:/bin".to_string())));
    }

    #[test]
    fn test_get_context_field_environment_missing() {
        let context = create_test_context();
        let value = get_context_field(&context, "environment.NONEXISTENT");
        assert_eq!(value, None);
    }

    #[test]
    fn test_get_context_field_metadata() {
        let context = create_test_context();
        let value = get_context_field(&context, "metadata.role");
        assert_eq!(value, Some(Value::String("admin".to_string())));
    }

    #[test]
    fn test_get_context_field_metadata_number() {
        let context = create_test_context();
        let value = get_context_field(&context, "metadata.level");
        assert_eq!(value, Some(Value::Number(5.into())));
    }

    #[test]
    fn test_get_context_field_unknown() {
        let context = create_test_context();
        let value = get_context_field(&context, "unknown_field");
        assert_eq!(value, None);
    }

    // evaluate_condition 测试 - Equals 运算符
    #[test]
    fn test_evaluate_condition_equals_string() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::Equals,
            value: Value::String("session-123".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_equals_string_fail() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::Equals,
            value: Value::String("other-session".to_string()),
            validator: None,
            description: None,
        };
        assert!(!evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_not_equals() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::NotEquals,
            value: Value::String("other-session".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    // Contains 运算符测试
    #[test]
    fn test_evaluate_condition_contains() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: Value::String("project".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_not_contains() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::NotContains,
            value: Value::String("dangerous".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    // Matches 运算符测试
    #[test]
    fn test_evaluate_condition_matches() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Matches,
            value: Value::String(r"^/home/\w+/project$".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_not_matches() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::NotMatches,
            value: Value::String(r"^/tmp/.*".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    // Range 运算符测试
    #[test]
    fn test_evaluate_condition_range() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: Some("timestamp".to_string()),
            operator: ConditionOperator::Range,
            value: serde_json::json!({"min": 1600000000, "max": 1800000000}),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_range_out_of_bounds() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: Some("timestamp".to_string()),
            operator: ConditionOperator::Range,
            value: serde_json::json!({"min": 1800000000, "max": 1900000000}),
            validator: None,
            description: None,
        };
        assert!(!evaluate_condition(&condition, &context));
    }

    // In 运算符测试
    #[test]
    fn test_evaluate_condition_in() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::User,
            field: Some("user".to_string()),
            operator: ConditionOperator::In,
            value: serde_json::json!(["admin", "testuser", "developer"]),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_not_in() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::User,
            field: Some("user".to_string()),
            operator: ConditionOperator::NotIn,
            value: serde_json::json!(["blocked_user", "banned_user"]),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    // Custom 运算符测试
    #[test]
    fn test_evaluate_condition_custom_validator() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Custom,
            field: None,
            operator: ConditionOperator::Custom,
            value: Value::Null,
            validator: Some(Arc::new(|ctx: &PermissionContext| {
                ctx.user.as_ref().map(|u| u == "testuser").unwrap_or(false)
            })),
            description: Some("Custom user check".to_string()),
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_custom_no_validator() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Custom,
            field: None,
            operator: ConditionOperator::Custom,
            value: Value::Null,
            validator: None,
            description: None,
        };
        assert!(!evaluate_condition(&condition, &context));
    }

    // 默认字段测试
    #[test]
    fn test_evaluate_condition_default_field_context() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: None, // 使用默认字段 working_directory
            operator: ConditionOperator::Contains,
            value: Value::String("project".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    #[test]
    fn test_evaluate_condition_default_field_time() {
        let context = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: None, // 使用默认字段 timestamp
            operator: ConditionOperator::Range,
            value: serde_json::json!({"min": 1600000000, "max": 1800000000}),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&condition, &context));
    }

    // check_conditions 测试
    #[test]
    fn test_check_conditions_empty() {
        let context = create_test_context();
        assert!(check_conditions(&[], &context));
    }

    #[test]
    fn test_check_conditions_single_pass() {
        let context = create_test_context();
        let conditions = vec![PermissionCondition {
            condition_type: ConditionType::User,
            field: Some("user".to_string()),
            operator: ConditionOperator::Equals,
            value: Value::String("testuser".to_string()),
            validator: None,
            description: None,
        }];
        assert!(check_conditions(&conditions, &context));
    }

    #[test]
    fn test_check_conditions_single_fail() {
        let context = create_test_context();
        let conditions = vec![PermissionCondition {
            condition_type: ConditionType::User,
            field: Some("user".to_string()),
            operator: ConditionOperator::Equals,
            value: Value::String("otheruser".to_string()),
            validator: None,
            description: None,
        }];
        assert!(!check_conditions(&conditions, &context));
    }

    #[test]
    fn test_check_conditions_multiple_all_pass() {
        let context = create_test_context();
        let conditions = vec![
            PermissionCondition {
                condition_type: ConditionType::User,
                field: Some("user".to_string()),
                operator: ConditionOperator::Equals,
                value: Value::String("testuser".to_string()),
                validator: None,
                description: None,
            },
            PermissionCondition {
                condition_type: ConditionType::Context,
                field: Some("working_directory".to_string()),
                operator: ConditionOperator::Contains,
                value: Value::String("project".to_string()),
                validator: None,
                description: None,
            },
        ];
        assert!(check_conditions(&conditions, &context));
    }

    #[test]
    fn test_check_conditions_multiple_one_fail() {
        let context = create_test_context();
        let conditions = vec![
            PermissionCondition {
                condition_type: ConditionType::User,
                field: Some("user".to_string()),
                operator: ConditionOperator::Equals,
                value: Value::String("testuser".to_string()),
                validator: None,
                description: None,
            },
            PermissionCondition {
                condition_type: ConditionType::Context,
                field: Some("working_directory".to_string()),
                operator: ConditionOperator::Contains,
                value: Value::String("dangerous".to_string()),
                validator: None,
                description: None,
            },
        ];
        assert!(!check_conditions(&conditions, &context));
    }

    #[test]
    fn test_check_conditions_missing_field() {
        let context = create_test_context();
        let conditions = vec![PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("nonexistent_field".to_string()),
            operator: ConditionOperator::Equals,
            value: Value::String("value".to_string()),
            validator: None,
            description: None,
        }];
        assert!(!check_conditions(&conditions, &context));
    }
}
