//! 参数限制验证模块
//!
//! 本模块实现了工具参数的限制验证功能，支持：
//! - 白名单限制 (Whitelist)
//! - 黑名单限制 (Blacklist)
//! - 模式匹配限制 (Pattern)
//! - 范围限制 (Range)
//! - 自定义验证器 (Validator)
//!
//! Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

use crate::permission::types::{ParameterRestriction, RestrictionType};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

/// 验证单个参数限制
///
/// # Arguments
/// * `restriction` - 参数限制规则
/// * `value` - 要验证的参数值
///
/// # Returns
/// 如果值满足限制则返回 `true`，否则返回 `false`
///
/// # Supported Restriction Types
/// - `Whitelist` - 值必须在允许列表中
/// - `Blacklist` - 值不能在禁止列表中
/// - `Pattern` - 值必须匹配正则表达式
/// - `Range` - 数值必须在指定范围内
/// - `Validator` - 使用自定义验证器函数
///
/// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
pub fn validate_restriction(restriction: &ParameterRestriction, value: &Value) -> bool {
    match restriction.restriction_type {
        RestrictionType::Whitelist => validate_whitelist(restriction, value),
        RestrictionType::Blacklist => validate_blacklist(restriction, value),
        RestrictionType::Pattern => validate_pattern(restriction, value),
        RestrictionType::Range => validate_range(restriction, value),
        RestrictionType::Validator => validate_custom(restriction, value),
    }
}

/// 验证白名单限制
///
/// 值必须在允许的值列表中
/// Requirements: 3.1
fn validate_whitelist(restriction: &ParameterRestriction, value: &Value) -> bool {
    match &restriction.values {
        Some(allowed_values) => allowed_values
            .iter()
            .any(|allowed| values_equal(value, allowed)),
        None => {
            // 没有指定白名单值，默认允许
            true
        }
    }
}

/// 验证黑名单限制
///
/// 值不能在禁止的值列表中
/// Requirements: 3.2
fn validate_blacklist(restriction: &ParameterRestriction, value: &Value) -> bool {
    match &restriction.values {
        Some(denied_values) => !denied_values
            .iter()
            .any(|denied| values_equal(value, denied)),
        None => {
            // 没有指定黑名单值，默认允许
            true
        }
    }
}

/// 验证模式匹配限制
///
/// 字符串值必须匹配指定的正则表达式
/// Requirements: 3.3
fn validate_pattern(restriction: &ParameterRestriction, value: &Value) -> bool {
    let pattern = match &restriction.pattern {
        Some(p) => p,
        None => return true, // 没有指定模式，默认允许
    };

    let value_str = match value {
        Value::String(s) => s.as_str(),
        Value::Number(n) => {
            // 数字转换为字符串进行匹配
            return match Regex::new(pattern) {
                Ok(re) => re.is_match(&n.to_string()),
                Err(_) => false,
            };
        }
        Value::Bool(b) => {
            return match Regex::new(pattern) {
                Ok(re) => re.is_match(&b.to_string()),
                Err(_) => false,
            };
        }
        _ => return false, // 非字符串/数字/布尔值无法进行模式匹配
    };

    match Regex::new(pattern) {
        Ok(re) => re.is_match(value_str),
        Err(_) => false, // 无效的正则表达式
    }
}

/// 验证范围限制
///
/// 数值必须在指定的 min/max 范围内
/// Requirements: 3.4
fn validate_range(restriction: &ParameterRestriction, value: &Value) -> bool {
    let num = match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse::<f64>().ok(),
        _ => None,
    };

    let num = match num {
        Some(n) => n,
        None => return false, // 无法转换为数值
    };

    // 检查最小值
    if let Some(min) = restriction.min {
        if num < min {
            return false;
        }
    }

    // 检查最大值
    if let Some(max) = restriction.max {
        if num > max {
            return false;
        }
    }

    true
}

/// 验证自定义验证器
///
/// 使用自定义函数进行验证
/// Requirements: 3.5
fn validate_custom(restriction: &ParameterRestriction, value: &Value) -> bool {
    match &restriction.validator {
        Some(validator) => validator(value),
        None => true, // 没有验证器，默认允许
    }
}

/// 比较两个 JSON 值是否相等
fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(s1), Value::String(s2)) => s1 == s2,
        (Value::Number(n1), Value::Number(n2)) => {
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

/// 检查所有参数限制
///
/// # Arguments
/// * `restrictions` - 参数限制规则列表
/// * `params` - 工具参数键值对
///
/// # Returns
/// 如果所有参数都满足限制则返回 `Ok(())`，
/// 否则返回 `Err(Vec<String>)` 包含所有违规详情
///
/// # Behavior
/// - 检查所有必需参数是否存在
/// - 验证每个参数是否满足其对应的限制
/// - 收集所有违规信息并一次性返回
///
/// Requirements: 3.6
pub fn check_parameter_restrictions(
    restrictions: &[ParameterRestriction],
    params: &HashMap<String, Value>,
) -> Result<(), Vec<String>> {
    let mut violations = Vec::new();

    for restriction in restrictions {
        let param_name = &restriction.parameter;

        // 检查参数是否存在
        match params.get(param_name) {
            Some(value) => {
                // 参数存在，验证限制
                if !validate_restriction(restriction, value) {
                    let violation = format_violation(restriction, value);
                    violations.push(violation);
                }
            }
            None => {
                // 参数不存在
                if restriction.required {
                    violations.push(format!("Required parameter '{}' is missing", param_name));
                }
                // 非必需参数不存在时跳过验证
            }
        }
    }

    if violations.is_empty() {
        Ok(())
    } else {
        Err(violations)
    }
}

/// 格式化违规信息
fn format_violation(restriction: &ParameterRestriction, value: &Value) -> String {
    let param_name = &restriction.parameter;
    let value_str = format_value(value);

    match restriction.restriction_type {
        RestrictionType::Whitelist => {
            let allowed = restriction
                .values
                .as_ref()
                .map(|v| format_values(v))
                .unwrap_or_else(|| "[]".to_string());
            format!(
                "Parameter '{}' value {} is not in whitelist: {}",
                param_name, value_str, allowed
            )
        }
        RestrictionType::Blacklist => {
            format!(
                "Parameter '{}' value {} is in blacklist",
                param_name, value_str
            )
        }
        RestrictionType::Pattern => {
            let pattern = restriction.pattern.as_deref().unwrap_or("<none>");
            format!(
                "Parameter '{}' value {} does not match pattern: {}",
                param_name, value_str, pattern
            )
        }
        RestrictionType::Range => {
            let min_str = restriction
                .min
                .map(|m| m.to_string())
                .unwrap_or_else(|| "-∞".to_string());
            let max_str = restriction
                .max
                .map(|m| m.to_string())
                .unwrap_or_else(|| "+∞".to_string());
            format!(
                "Parameter '{}' value {} is out of range [{}, {}]",
                param_name, value_str, min_str, max_str
            )
        }
        RestrictionType::Validator => {
            let desc = restriction
                .description
                .as_deref()
                .unwrap_or("custom validation");
            format!(
                "Parameter '{}' value {} failed {}",
                param_name, value_str, desc
            )
        }
    }
}

/// 格式化单个值为字符串
fn format_value(value: &Value) -> String {
    match value {
        Value::String(s) => format!("\"{}\"", s),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(format_value).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Object(_) => "<object>".to_string(),
    }
}

/// 格式化值列表为字符串
fn format_values(values: &[Value]) -> String {
    let items: Vec<String> = values.iter().map(format_value).collect();
    format!("[{}]", items.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    // ========================================================================
    // validate_restriction 测试 - Whitelist
    // ========================================================================

    #[test]
    fn test_whitelist_string_allowed() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![
                Value::String("ls".to_string()),
                Value::String("cat".to_string()),
                Value::String("echo".to_string()),
            ]),
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("ls".to_string())
        ));
        assert!(validate_restriction(
            &restriction,
            &Value::String("cat".to_string())
        ));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("rm".to_string())
        ));
    }

    #[test]
    fn test_whitelist_number_allowed() {
        let restriction = ParameterRestriction {
            parameter: "port".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![
                serde_json::json!(80),
                serde_json::json!(443),
                serde_json::json!(8080),
            ]),
            ..Default::default()
        };

        assert!(validate_restriction(&restriction, &serde_json::json!(80)));
        assert!(validate_restriction(&restriction, &serde_json::json!(443)));
        assert!(!validate_restriction(&restriction, &serde_json::json!(22)));
    }

    #[test]
    fn test_whitelist_empty_allows_nothing() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![]),
            ..Default::default()
        };

        assert!(!validate_restriction(
            &restriction,
            &Value::String("ls".to_string())
        ));
    }

    #[test]
    fn test_whitelist_none_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: None,
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    // ========================================================================
    // validate_restriction 测试 - Blacklist
    // ========================================================================

    #[test]
    fn test_blacklist_string_denied() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Blacklist,
            values: Some(vec![
                Value::String("rm -rf".to_string()),
                Value::String("sudo".to_string()),
                Value::String("chmod 777".to_string()),
            ]),
            ..Default::default()
        };

        assert!(!validate_restriction(
            &restriction,
            &Value::String("rm -rf".to_string())
        ));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("sudo".to_string())
        ));
        assert!(validate_restriction(
            &restriction,
            &Value::String("ls".to_string())
        ));
    }

    #[test]
    fn test_blacklist_empty_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Blacklist,
            values: Some(vec![]),
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    #[test]
    fn test_blacklist_none_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Blacklist,
            values: None,
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    // ========================================================================
    // validate_restriction 测试 - Pattern
    // ========================================================================

    #[test]
    fn test_pattern_matches() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            pattern: Some(r"^/home/\w+/.*$".to_string()),
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("/home/user/file.txt".to_string())
        ));
        assert!(validate_restriction(
            &restriction,
            &Value::String("/home/admin/docs".to_string())
        ));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("/etc/passwd".to_string())
        ));
    }

    #[test]
    fn test_pattern_number_as_string() {
        let restriction = ParameterRestriction {
            parameter: "port".to_string(),
            restriction_type: RestrictionType::Pattern,
            pattern: Some(r"^\d{2,5}$".to_string()),
            ..Default::default()
        };

        assert!(validate_restriction(&restriction, &serde_json::json!(80)));
        assert!(validate_restriction(&restriction, &serde_json::json!(8080)));
        assert!(!validate_restriction(&restriction, &serde_json::json!(1)));
    }

    #[test]
    fn test_pattern_invalid_regex() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            pattern: Some(r"[invalid".to_string()),
            ..Default::default()
        };

        assert!(!validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    #[test]
    fn test_pattern_none_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            pattern: None,
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    // ========================================================================
    // validate_restriction 测试 - Range
    // ========================================================================

    #[test]
    fn test_range_within_bounds() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            min: Some(1.0),
            max: Some(100.0),
            ..Default::default()
        };

        assert!(validate_restriction(&restriction, &serde_json::json!(1)));
        assert!(validate_restriction(&restriction, &serde_json::json!(50)));
        assert!(validate_restriction(&restriction, &serde_json::json!(100)));
        assert!(!validate_restriction(&restriction, &serde_json::json!(0)));
        assert!(!validate_restriction(&restriction, &serde_json::json!(101)));
    }

    #[test]
    fn test_range_only_min() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            min: Some(0.0),
            max: None,
            ..Default::default()
        };

        assert!(validate_restriction(&restriction, &serde_json::json!(0)));
        assert!(validate_restriction(
            &restriction,
            &serde_json::json!(1000000)
        ));
        assert!(!validate_restriction(&restriction, &serde_json::json!(-1)));
    }

    #[test]
    fn test_range_only_max() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            min: None,
            max: Some(100.0),
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &serde_json::json!(-1000)
        ));
        assert!(validate_restriction(&restriction, &serde_json::json!(100)));
        assert!(!validate_restriction(&restriction, &serde_json::json!(101)));
    }

    #[test]
    fn test_range_string_number() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            min: Some(1.0),
            max: Some(100.0),
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("50".to_string())
        ));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("0".to_string())
        ));
    }

    #[test]
    fn test_range_non_numeric_fails() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            min: Some(1.0),
            max: Some(100.0),
            ..Default::default()
        };

        assert!(!validate_restriction(
            &restriction,
            &Value::String("not a number".to_string())
        ));
        assert!(!validate_restriction(&restriction, &Value::Bool(true)));
    }

    // ========================================================================
    // validate_restriction 测试 - Validator
    // ========================================================================

    #[test]
    fn test_custom_validator_pass() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Validator,
            validator: Some(Arc::new(|value: &Value| {
                if let Value::String(s) = value {
                    s.starts_with("/safe/")
                } else {
                    false
                }
            })),
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("/safe/file.txt".to_string())
        ));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("/unsafe/file.txt".to_string())
        ));
    }

    #[test]
    fn test_custom_validator_none_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Validator,
            validator: None,
            ..Default::default()
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    // ========================================================================
    // check_parameter_restrictions 测试
    // ========================================================================

    #[test]
    fn test_check_all_pass() {
        let restrictions = vec![
            ParameterRestriction {
                parameter: "command".to_string(),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![Value::String("ls".to_string())]),
                ..Default::default()
            },
            ParameterRestriction {
                parameter: "path".to_string(),
                restriction_type: RestrictionType::Pattern,
                pattern: Some(r"^/home/.*$".to_string()),
                ..Default::default()
            },
        ];

        let mut params = HashMap::new();
        params.insert("command".to_string(), Value::String("ls".to_string()));
        params.insert("path".to_string(), Value::String("/home/user".to_string()));

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_one_fails() {
        let restrictions = vec![
            ParameterRestriction {
                parameter: "command".to_string(),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![Value::String("ls".to_string())]),
                ..Default::default()
            },
            ParameterRestriction {
                parameter: "path".to_string(),
                restriction_type: RestrictionType::Pattern,
                pattern: Some(r"^/home/.*$".to_string()),
                ..Default::default()
            },
        ];

        let mut params = HashMap::new();
        params.insert("command".to_string(), Value::String("rm".to_string())); // Not allowed
        params.insert("path".to_string(), Value::String("/home/user".to_string()));

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_err());
        let violations = result.unwrap_err();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].contains("command"));
    }

    #[test]
    fn test_check_multiple_fail() {
        let restrictions = vec![
            ParameterRestriction {
                parameter: "command".to_string(),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![Value::String("ls".to_string())]),
                ..Default::default()
            },
            ParameterRestriction {
                parameter: "path".to_string(),
                restriction_type: RestrictionType::Pattern,
                pattern: Some(r"^/home/.*$".to_string()),
                ..Default::default()
            },
        ];

        let mut params = HashMap::new();
        params.insert("command".to_string(), Value::String("rm".to_string())); // Not allowed
        params.insert("path".to_string(), Value::String("/etc/passwd".to_string())); // Not allowed

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_err());
        let violations = result.unwrap_err();
        assert_eq!(violations.len(), 2);
    }

    #[test]
    fn test_check_required_missing() {
        let restrictions = vec![ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![Value::String("ls".to_string())]),
            required: true,
            ..Default::default()
        }];

        let params = HashMap::new(); // Empty params

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_err());
        let violations = result.unwrap_err();
        assert_eq!(violations.len(), 1);
        assert!(violations[0].contains("Required"));
        assert!(violations[0].contains("command"));
    }

    #[test]
    fn test_check_optional_missing() {
        let restrictions = vec![ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![Value::String("ls".to_string())]),
            required: false,
            ..Default::default()
        }];

        let params = HashMap::new(); // Empty params

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_empty_restrictions() {
        let restrictions: Vec<ParameterRestriction> = vec![];

        let mut params = HashMap::new();
        params.insert("anything".to_string(), Value::String("value".to_string()));

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_ok());
    }

    // ========================================================================
    // format_violation 测试
    // ========================================================================

    #[test]
    fn test_format_violation_whitelist() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![Value::String("ls".to_string())]),
            ..Default::default()
        };

        let violation = format_violation(&restriction, &Value::String("rm".to_string()));
        assert!(violation.contains("command"));
        assert!(violation.contains("whitelist"));
    }

    #[test]
    fn test_format_violation_blacklist() {
        let restriction = ParameterRestriction {
            parameter: "command".to_string(),
            restriction_type: RestrictionType::Blacklist,
            values: Some(vec![Value::String("rm".to_string())]),
            ..Default::default()
        };

        let violation = format_violation(&restriction, &Value::String("rm".to_string()));
        assert!(violation.contains("command"));
        assert!(violation.contains("blacklist"));
    }

    #[test]
    fn test_format_violation_pattern() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            pattern: Some(r"^/home/.*$".to_string()),
            ..Default::default()
        };

        let violation = format_violation(&restriction, &Value::String("/etc/passwd".to_string()));
        assert!(violation.contains("path"));
        assert!(violation.contains("pattern"));
    }

    #[test]
    fn test_format_violation_range() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            min: Some(1.0),
            max: Some(100.0),
            ..Default::default()
        };

        let violation = format_violation(&restriction, &serde_json::json!(0));
        assert!(violation.contains("count"));
        assert!(violation.contains("range"));
    }
}
