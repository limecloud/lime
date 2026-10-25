//! 保留上游配置类型，在 Lime 持久化入口拒绝未知授权字段。

use super::ComputerUseConfigToml;
use serde::Deserialize;
use serde_json::Value;

pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<ComputerUseConfigToml>, D::Error> {
    let value = Option::<Value>::deserialize(deserializer)?;
    let Some(value) = value else { return Ok(None) };
    validate(&value).map_err(serde::de::Error::custom)?;
    serde_json::from_value(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}

fn fields(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid computer_use table")?;
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("unknown computer_use field: {key}"));
    }
    Ok(())
}

fn validate(value: &Value) -> Result<(), String> {
    fields(value, &["default_app_access", "macos", "windows"])?;
    if let Some(macos) = value.get("macos").filter(|v| !v.is_null()) {
        fields(macos, &["bundle_ids"])?;
    }
    if let Some(windows) = value.get("windows").filter(|v| !v.is_null()) {
        fields(windows, &["aumids", "exes"])?;
        if let Some(exes) = windows.get("exes").filter(|v| !v.is_null()) {
            for exe in exes.as_array().ok_or("invalid computer_use exes")? {
                fields(
                    exe,
                    &["publisher_name", "product_name", "binary_name", "access"],
                )?;
            }
        }
    }
    Ok(())
}
