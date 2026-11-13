//! 供应商诊断只保留白名单元数据；类型化错误码不从展示文本反推。

use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
#[error("{diagnostic}")]
pub(in crate::cloud_desktop_service) struct CliError {
    pub(in crate::cloud_desktop_service) provider_code: Option<String>,
    diagnostic: String,
}

#[derive(Default, Deserialize)]
struct ProviderMetadata {
    #[serde(rename = "ErrorCode", alias = "Code", alias = "error_code")]
    code: Option<String>,
    #[serde(rename = "RequestId", alias = "request_id")]
    request_id: Option<String>,
}

fn line_field(text: &str, keys: &[&str]) -> Option<String> {
    let mut values = text.lines().filter_map(|line| {
        keys.iter()
            .find_map(|key| line.trim().strip_prefix(&format!("{key}:")))
            .map(str::trim)
    });
    let value = values.next()?;
    // Repeated or conflicting aliases cannot prove a supplier success code.
    if values.next().is_some() {
        return None;
    }
    Some(value.to_owned())
}

fn safe_field(value: Option<String>) -> Option<String> {
    value.filter(|value| {
        !value.is_empty()
            && value.len() <= 96
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    })
}

impl CliError {
    pub(in crate::cloud_desktop_service) fn provider(stderr: &[u8]) -> Self {
        let text = String::from_utf8_lossy(stderr);
        let metadata = if text.trim_start().starts_with('{') {
            // Struct deserialization rejects duplicate keys and aliases; Value
            // would silently retain the final value of a repeated JSON key.
            serde_json::from_slice::<ProviderMetadata>(stderr).unwrap_or_default()
        } else {
            ProviderMetadata {
                code: line_field(&text, &["ErrorCode", "Code", "error_code"]),
                request_id: line_field(&text, &["RequestId", "request_id"]),
            }
        };
        let provider_code = safe_field(metadata.code);
        let request_id = safe_field(metadata.request_id);
        let mut fields = Vec::new();
        if let Some(code) = &provider_code {
            fields.push(format!("ErrorCode={code}"));
        }
        if let Some(id) = request_id {
            fields.push(format!("RequestId={id}"));
        }
        let suffix = if fields.is_empty() {
            String::new()
        } else {
            format!(" ({})", fields.join(", "))
        };
        Self {
            provider_code,
            diagnostic: format!("Cloud request failed{suffix}; inspect resource and operation receipt before retrying"),
        }
    }
}

impl From<String> for CliError {
    fn from(diagnostic: String) -> Self {
        Self {
            provider_code: None,
            diagnostic,
        }
    }
}

impl From<&str> for CliError {
    fn from(diagnostic: &str) -> Self {
        diagnostic.to_owned().into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_json_fields_and_aliases_cannot_confirm_a_provider_code() {
        for stderr in [
            r#"{"Code":"Denied","Code":"DryRunOperation"}"#,
            r#"{"Code":"DryRunOperation","error_code":"DryRunOperation"}"#,
            r#"{"Code":"DryRunOperation","RequestId":"one","request_id":"two"}"#,
            r#"{"Code":"DryRunOperation","RequestId":true}"#,
            "ErrorCode: DryRunOperation\nCode: DryRunOperation",
        ] {
            assert_eq!(
                CliError::provider(stderr.as_bytes()).provider_code,
                None,
                "{stderr}"
            );
        }
    }

    #[test]
    fn local_errors_cannot_be_mistaken_for_supplier_success_codes() {
        let error = CliError::from("DryRunOperation");
        assert_eq!(error.provider_code, None);
        assert_eq!(error.to_string(), "DryRunOperation");
    }
}
