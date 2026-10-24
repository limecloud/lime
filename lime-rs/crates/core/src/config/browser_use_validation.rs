//! 保留上游配置结构；在现役配置入口严格校验未知字段和站点范围。

use super::BrowserUseConfigToml;
use serde::Deserialize;
use serde_json::Value;

pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<BrowserUseConfigToml>, D::Error> {
    let value = Option::<Value>::deserialize(deserializer)?;
    let Some(value) = value else { return Ok(None) };
    validate(&value).map_err(serde::de::Error::custom)?;
    serde_json::from_value(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}

fn fields(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid browser_use table")?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("unknown browser_use field".into());
    }
    Ok(())
}

fn validate(value: &Value) -> Result<(), String> {
    fields(
        value,
        &["allow_history_access", "default_origin_policy", "origins"],
    )?;
    let policy = |value: &Value| {
        fields(
            value,
            &["access", "downloads", "uploads", "full_cdp_access"],
        )
    };
    if let Some(default) = value.get("default_origin_policy").filter(|v| !v.is_null()) {
        policy(default)?;
    }
    if let Some(origins) = value.get("origins").filter(|v| !v.is_null()) {
        for (pattern, rule) in origins.as_object().ok_or("invalid browser_use origins")? {
            #[derive(Deserialize)]
            struct Origin(
                #[serde(deserialize_with = "super::browser::deserialize_site_pattern")] String,
            );
            let origin: Origin = serde_json::from_value(Value::String(pattern.clone()))
                .map_err(|_| "invalid browser_use origin")?;
            // 保留原键，多个规范化别名必须一起参与 deny 优先判定。
            let _ = origin.0;
            policy(rule)?;
        }
    }
    Ok(())
}
