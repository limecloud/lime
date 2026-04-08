//! 敏感数据清洗

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

/// 敏感数据正则模式
static SENSITIVE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // Email
        Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b").unwrap(),
        // IP address
        Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap(),
        // API keys (Anthropic style)
        Regex::new(r"\bsk-[a-zA-Z0-9]{32,}\b").unwrap(),
        // Home paths (Unix)
        Regex::new(r"/home/[a-zA-Z0-9_-]+").unwrap(),
        // Home paths (Mac)
        Regex::new(r"/Users/[a-zA-Z0-9_-]+").unwrap(),
        // Home paths (Windows)
        Regex::new(r"C:\\Users\\[a-zA-Z0-9_-]+").unwrap(),
    ]
});

/// 敏感字段名
const SENSITIVE_FIELDS: &[&str] = &[
    "password",
    "secret",
    "token",
    "key",
    "auth",
    "credential",
    "api_key",
    "apikey",
];

/// 清洗字符串中的敏感数据
pub fn sanitize_string(s: &str) -> String {
    let mut result = s.to_string();
    for pattern in SENSITIVE_PATTERNS.iter() {
        result = pattern.replace_all(&result, "[REDACTED]").to_string();
    }
    result
}

/// 检查字段名是否敏感
fn is_sensitive_field(key: &str) -> bool {
    let lower = key.to_lowercase();
    SENSITIVE_FIELDS.iter().any(|f| lower.contains(f))
}

/// 清洗 JSON 值中的敏感数据
pub fn sanitize_value(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(sanitize_string(s)),
        Value::Array(arr) => Value::Array(arr.iter().map(sanitize_value).collect()),
        Value::Object(obj) => {
            let mut result = serde_json::Map::new();
            for (key, val) in obj {
                if is_sensitive_field(key) {
                    result.insert(key.clone(), Value::String("[REDACTED]".to_string()));
                } else {
                    result.insert(key.clone(), sanitize_value(val));
                }
            }
            Value::Object(result)
        }
        other => other.clone(),
    }
}

/// 清洗 HashMap 中的敏感数据
pub fn sanitize_map(
    map: &std::collections::HashMap<String, Value>,
) -> std::collections::HashMap<String, Value> {
    map.iter()
        .map(|(k, v)| {
            if is_sensitive_field(k) {
                (k.clone(), Value::String("[REDACTED]".to_string()))
            } else {
                (k.clone(), sanitize_value(v))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_email() {
        let input = "Contact: user@example.com";
        let result = sanitize_string(input);
        assert!(result.contains("[REDACTED]"));
        assert!(!result.contains("user@example.com"));
    }

    #[test]
    fn test_sanitize_api_key() {
        let input = "Key: sk-abcdefghijklmnopqrstuvwxyz123456";
        let result = sanitize_string(input);
        assert!(result.contains("[REDACTED]"));
    }

    #[test]
    fn test_sanitize_sensitive_field() {
        let mut map = std::collections::HashMap::new();
        map.insert(
            "password".to_string(),
            Value::String("secret123".to_string()),
        );
        map.insert("name".to_string(), Value::String("John".to_string()));

        let result = sanitize_map(&map);
        assert_eq!(
            result.get("password"),
            Some(&Value::String("[REDACTED]".to_string()))
        );
        assert_eq!(result.get("name"), Some(&Value::String("John".to_string())));
    }
}
