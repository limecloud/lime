use super::{cloud, operations::Operation, AccountManager};
use serde_json::Value;

/// Summaries are a separate read contract, never a completed local operation.
pub(super) fn summary_path(operation: &Operation) -> Result<String, String> {
    let prefix = match operation.path.as_str() {
        "/web/searches" | "/web/pages" => "/web/operations/",
        "/market/acquisitions" => "/market/operations/",
        path if path.starts_with("/market/acquisitions/")
            && (path.ends_with("/revocations") || path.ends_with("/download-tickets")) =>
        {
            "/market/operations/"
        }
        "/connection-requests" => "/connection-requests/operations/",
        path if path.starts_with("/connections/") && path.ends_with("/file-reads") => {
            "/connection-file-operations/operations/"
        }
        _ => return Err("operation_store_invalid".into()),
    };
    if operation.recovery_path != format!("{prefix}{}", operation.key) {
        return Err("operation_store_invalid".into());
    }
    Ok(format!("/recovery{}", operation.recovery_path))
}

impl AccountManager {
    pub(super) fn recovery_operation(&self, path: &str) -> Result<Operation, String> {
        let account = self
            .read(Default::default())?
            .account
            .ok_or("account_login_required")?;
        let key = path.rsplit('/').next().ok_or("cloud_request_invalid")?;
        let original = self
            .operation(&account, key)?
            .ok_or("operation_not_found")?;
        if summary_path(&original)? != path {
            return Err("operation_key_conflict".into());
        }
        Ok(original)
    }
}

pub(super) fn validate_summary(original: &Operation, body: &Value) -> Result<(), String> {
    let invalid = || "cloud_response_invalid".to_owned();
    let object = body.as_object().ok_or_else(invalid)?;
    let kind = match original.path.as_str() {
        "/web/searches" => "search",
        "/web/pages" => "page",
        "/connection-requests" => "connection_request",
        path if path.starts_with("/connections/") => "connection_file",
        _ => "market",
    };
    let allowed: &[&str] = match kind {
        "market" => &["command"],
        "search" | "page" => &["usage", "errorCode", "finishedAt"],
        "connection_request" => &["finishedAt", "expiresAt"],
        _ => &["usage", "errorCode", "finishedAt", "expiresAt"],
    };
    if object.keys().any(|key| {
        !["id", "kind", "status", "recoveryOnly", "createdAt"].contains(&key.as_str())
            && !allowed.contains(&key.as_str())
    }) || !body["id"].as_str().is_some_and(cloud::identifier)
        || body["kind"] != kind
        || body["recoveryOnly"] != true
    {
        return Err(invalid());
    }
    let time = |value: &Value| {
        value
            .as_str()
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
    };
    let created = time(&body["createdAt"]).ok_or_else(invalid)?;
    if ["finishedAt", "expiresAt"].iter().any(|key| {
        body.get(key)
            .is_some_and(|value| time(value).is_none_or(|at| at < created))
    }) || body.get("errorCode").is_some_and(|code| {
        !code.as_str().is_some_and(|code| {
            (2..=101).contains(&code.len())
                && code.as_bytes()[0].is_ascii_uppercase()
                && code
                    .bytes()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
        })
    }) {
        return Err(invalid());
    }
    let statuses: &[&str] = match kind {
        "market" => &["completed"],
        "connection_request" => &[
            "pending",
            "approved",
            "denied",
            "expired",
            "consumer_unavailable",
        ],
        "connection_file" => &[
            "running",
            "completed",
            "failed",
            "outcome_unknown",
            "result_expired",
        ],
        _ => &["running", "completed", "failed", "outcome_unknown"],
    };
    if !body["status"]
        .as_str()
        .is_some_and(|status| statuses.contains(&status))
    {
        return Err(invalid());
    }
    match kind {
        "market" => {
            let command = if original.path == "/market/acquisitions" {
                "acquisition.create"
            } else if original.path.ends_with("/revocations") {
                "acquisition.revoke"
            } else {
                "acquisition.download"
            };
            if body["command"] != command {
                return Err(invalid());
            }
        }
        "connection_request" => {
            if time(&body["expiresAt"]).is_none() {
                return Err(invalid());
            }
        }
        "search" | "page" | "connection_file" => {
            super::billing::validate_usage(
                &body["usage"],
                body["status"].as_str().unwrap_or_default(),
                &original.input,
            )?;
        }
        _ => {
            let usage = body["usage"].as_object().ok_or_else(invalid)?;
            if usage.len() != 3
                || body["usage"]["requests"].as_u64().is_none()
                || body["usage"]["responseBytes"].as_u64().is_none()
                || body["usage"]["billingStatus"] != "unpriced"
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
