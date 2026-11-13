use crate::account::cloud;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

pub(super) const CONTRACT: &str = "google-docs.read.v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Approval {
    pub id: String,
    pub consent_version: String,
    pub connector: String,
    pub actions: Vec<String>,
    pub file_ids: Vec<String>,
    pub requested_expires_at: DateTime<Utc>,
    pub status: String,
    pub revision: u64,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub grant_id: Option<String>,
    pub grant_revision: Option<u64>,
    pub connection_id: Option<String>,
    pub approved_expires_at: Option<DateTime<Utc>>,
    pub decided_at: Option<DateTime<Utc>>,
    pub approval_url: Option<String>,
}

impl Approval {
    pub fn parse(
        body: Value,
        file: &str,
        expires: &DateTime<Utc>,
        environment: &str,
    ) -> Result<Self, String> {
        let value: Self =
            serde_json::from_value(body).map_err(|_| "connection_response_invalid")?;
        let absent = value.grant_id.is_none()
            && value.grant_revision.is_none()
            && value.connection_id.is_none()
            && value.approved_expires_at.is_none();
        let status_valid = match value.status.as_str() {
            "pending" => {
                absent
                    && value.decided_at.is_none()
                    && value.revision == 1
                    && value
                        .approval_url
                        .as_deref()
                        .is_some_and(|url| approval_url(url, &value.id, environment))
            }
            "approved" => {
                value.revision == 2
                    && value.approval_url.is_none()
                    && value.grant_id.as_deref().is_some_and(cloud::identifier)
                    && value
                        .connection_id
                        .as_deref()
                        .is_some_and(cloud::identifier)
                    && value.grant_revision == Some(1)
                    && value
                        .decided_at
                        .zip(value.approved_expires_at)
                        .is_some_and(|(at, until)| {
                            at >= value.created_at
                                && until > at
                                && until <= value.requested_expires_at
                        })
            }
            "denied" => {
                absent
                    && value.revision == 2
                    && value.decided_at.is_some()
                    && value.approval_url.is_none()
            }
            "expired" | "consumer_unavailable" => {
                absent
                    && value.revision == 1
                    && value.decided_at.is_none()
                    && value.approval_url.is_none()
            }
            _ => false,
        };
        if !cloud::identifier(&value.id)
            || value.consent_version != "connection-selected-files.v1"
            || value.connector != "google-drive"
            || value.actions != ["drive.files.read"]
            || value.file_ids != [file]
            || value.requested_expires_at != *expires
            || value.expires_at <= value.created_at
            || value.expires_at > *expires
            || value.requested_expires_at <= value.created_at
            || !status_valid
        {
            return Err("connection_response_invalid".into());
        }
        Ok(value)
    }
}

pub(super) fn approval_url(value: &str, id: &str, environment: &str) -> bool {
    if value.len() > 4096
        || !cloud::identifier(id)
        || !matches!(environment, "sandbox" | "production")
    {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path() == format!("/connections/requests/{id}")
        && url.query() == Some(format!("environment={environment}").as_str())
}

pub(super) fn file_result(
    mut body: Value,
    approval: &Approval,
    file: &str,
    limit: usize,
    input: &Value,
) -> Result<Value, String> {
    let invalid = || "connection_response_invalid".to_owned();
    let time = |value: &Value| {
        value
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
    };
    let created = time(&body["createdAt"]).ok_or_else(invalid)?;
    if !body["id"].as_str().is_some_and(cloud::identifier)
        || body["action"] != "drive.files.read"
        || body["contractRevision"] != CONTRACT
        || body["fileId"] != file
        || body["grantId"].as_str() != approval.grant_id.as_deref()
        || body["connectionId"].as_str() != approval.connection_id.as_deref()
        || body["usage"]["requests"].as_u64().is_none()
        || body["usage"]["responseBytes"].as_u64().is_none()
    {
        return Err(invalid());
    }
    match body["status"].as_str() {
        Some("completed") => {
            let result = &body["result"];
            let finished = time(&body["finishedAt"]).ok_or_else(invalid)?;
            let until = time(&body["resultExpiresAt"]).ok_or_else(invalid)?;
            let version = result["file"]["version"].as_str().ok_or_else(invalid)?;
            if body.get("errorCode").is_some()
                || finished < created
                || until <= finished
                || until > finished + chrono::Duration::hours(24)
                || result["file"]["id"] != file
                || result["file"]["mediaType"] != "application/vnd.google-apps.document"
                || result["file"]["canDownload"] != true
                || !result["file"]["name"]
                    .as_str()
                    .is_some_and(|name| (1..=4096).contains(&name.chars().count()))
                || version.is_empty()
                || version.len() > 40
                || version.starts_with('0')
                || !version.bytes().all(|c| c.is_ascii_digit())
                || time(&result["file"]["modifiedAt"]).is_none()
                || time(&result["retrievedAt"]).is_none()
                || !result["text"]
                    .as_str()
                    .is_some_and(|text| text.chars().count() <= limit)
                || result["url"] != format!("https://docs.google.com/document/d/{file}/edit")
                || !result["truncated"].is_boolean()
            {
                return Err(invalid());
            }
        }
        Some("running") => {
            if ["result", "errorCode", "finishedAt", "resultExpiresAt"]
                .iter()
                .any(|key| body.get(key).is_some())
            {
                return Err(invalid());
            }
        }
        Some("failed" | "outcome_unknown" | "result_expired") => {
            if body.get("result").is_some()
                || !body["errorCode"].as_str().is_some_and(|s| {
                    !s.is_empty()
                        && s.len() <= 128
                        && s.bytes()
                            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
                })
            {
                return Err(invalid());
            }
            if body
                .get("finishedAt")
                .is_some_and(|at| time(at).is_none_or(|at| at < created))
                || body["status"] == "failed"
                    && (time(&body["finishedAt"]).is_none()
                        || body.get("resultExpiresAt").is_some())
                || body["status"] == "outcome_unknown" && body.get("resultExpiresAt").is_some()
                || body["status"] == "result_expired"
                    && (body["errorCode"] != "INTEGRATION_RESULT_EXPIRED"
                        || time(&body["finishedAt"]).is_none()
                        || !time(&body["resultExpiresAt"])
                            .zip(time(&body["finishedAt"]))
                            .is_some_and(|(until, at)| {
                                until > at && until <= at + chrono::Duration::hours(24)
                            }))
            {
                return Err(invalid());
            }
        }
        _ => return Err(invalid()),
    }
    // Publish only the formal fields, including nested data.
    let mut usage = serde_json::json!({"requests":body["usage"]["requests"],"responseBytes":body["usage"]["responseBytes"],"billingStatus":body["usage"]["billingStatus"]});
    if let Some(billing) = body["usage"].get("billing") {
        usage["billing"] = billing.clone();
    }
    crate::account::billing::validate_usage(
        &usage,
        body["status"].as_str().ok_or_else(invalid)?,
        input,
    )
    .map_err(|_| invalid())?;
    body["usage"] = usage;
    if body["status"] == "completed" {
        let result = &body["result"];
        body["result"] = serde_json::json!({
            "file":{"id":result["file"]["id"],"name":result["file"]["name"],"mediaType":result["file"]["mediaType"],"version":result["file"]["version"],"modifiedAt":result["file"]["modifiedAt"],"canDownload":result["file"]["canDownload"]},
            "text":result["text"],"url":result["url"],"retrievedAt":result["retrievedAt"],"truncated":result["truncated"]});
    }
    let object = body.as_object_mut().ok_or_else(invalid)?;
    object.retain(|key, _| {
        [
            "id",
            "action",
            "contractRevision",
            "connectionId",
            "grantId",
            "fileId",
            "status",
            "usage",
            "createdAt",
            "result",
            "errorCode",
            "finishedAt",
            "resultExpiresAt",
        ]
        .contains(&key.as_str())
    });
    Ok(body)
}
