//! 自动化任务输出结果投递

use chrono::{Duration as ChronoDuration, Utc};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use proxycast_core::config::DeliveryConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::Duration as StdDuration;
use urlencoding::encode;

#[derive(Debug, Clone)]
pub struct DeliveryContext {
    pub attempt_id: String,
    pub run_id: Option<String>,
    pub job_id: String,
    pub execution_retry_count: u32,
}

#[derive(Debug)]
pub struct DeliveryResult {
    pub success: bool,
    pub message: String,
    pub channel: Option<String>,
    pub target: Option<String>,
    pub output_kind: String,
    pub output_schema: String,
    pub output_format: String,
    pub output_preview: String,
    pub delivery_attempt_id: String,
    pub run_id: Option<String>,
    pub execution_retry_count: u32,
    pub delivery_attempts: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskOutput {
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskResult {
    pub task: String,
    pub status: String,
    pub output: TaskOutput,
    pub duration_ms: i64,
    pub timestamp: String,
}

#[derive(Debug, Clone)]
struct RenderedOutput {
    format: String,
    schema: String,
    text: String,
    data: Option<Value>,
}

#[derive(Debug)]
struct DeliveryOutcome {
    result: DeliveryResult,
    retryable: bool,
}

#[derive(Debug, Clone)]
struct GoogleSheetsTarget {
    spreadsheet_id: String,
    sheet: String,
    credentials_file: String,
    include_header: bool,
    value_input_option: String,
}

#[derive(Debug)]
struct GoogleSheetsPreparedValues {
    values: Vec<Vec<String>>,
    data_rows: usize,
}

#[derive(Debug, Deserialize)]
struct GoogleServiceAccountCredentials {
    client_email: String,
    private_key: String,
    #[serde(default = "default_google_token_uri")]
    token_uri: String,
}

#[derive(Debug, Serialize)]
struct GoogleServiceAccountClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: i64,
    iat: i64,
}

#[derive(Debug, Deserialize)]
struct GoogleAccessTokenResponse {
    access_token: String,
}

#[derive(Debug, Serialize)]
struct GoogleSheetsAppendRequest {
    #[serde(rename = "majorDimension")]
    major_dimension: String,
    values: Vec<Vec<String>>,
}

const GOOGLE_SHEETS_SCOPE: &str = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_JWT_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const NETWORK_DELIVERY_MAX_ATTEMPTS: u32 = 3;

pub fn build_delivery_attempt_id(
    job_id: &str,
    started_at: &str,
    execution_retry_count: u32,
    run_id: Option<&str>,
) -> String {
    if let Some(run_id) = run_id.map(str::trim).filter(|value| !value.is_empty()) {
        return format!("dlv-{run_id}");
    }

    let mut hasher = Sha256::new();
    hasher.update(job_id.as_bytes());
    hasher.update(b":");
    hasher.update(started_at.as_bytes());
    hasher.update(b":");
    hasher.update(execution_retry_count.to_string().as_bytes());
    let digest = hasher.finalize();
    format!("dlv-{}", hex::encode(&digest[..16]))
}

pub async fn deliver_result(
    config: &DeliveryConfig,
    result: &TaskResult,
    context: &DeliveryContext,
) -> DeliveryResult {
    let rendered = render_output(config, result);
    if config.mode == "none" {
        return DeliveryResult {
            success: true,
            message: "输出投递已禁用".to_string(),
            channel: None,
            target: None,
            output_kind: result.output.kind.clone(),
            output_schema: rendered.schema,
            output_format: rendered.format,
            output_preview: preview_output_text(result.output.text.as_str()),
            delivery_attempt_id: context.attempt_id.clone(),
            run_id: context.run_id.clone(),
            execution_retry_count: context.execution_retry_count,
            delivery_attempts: 0,
        };
    }

    let channel = match config
        .channel
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => {
            let target = normalize_target(config.target.as_deref());
            return build_delivery_result(
                false,
                "未配置输出渠道".to_string(),
                None,
                target.as_deref(),
                result,
                &rendered,
                context,
            );
        }
    };
    let target = match config
        .target
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => {
            return build_delivery_result(
                false,
                "未配置输出目标".to_string(),
                Some(channel),
                None,
                result,
                &rendered,
                context,
            )
        }
    };

    let max_attempts = max_delivery_attempts(channel);
    for attempt_no in 1..=max_attempts {
        let mut outcome = match channel {
            "webhook" => deliver_webhook(target, result, &rendered, context).await,
            "telegram" => deliver_telegram(target, result, &rendered, context).await,
            "local_file" => deliver_local_file(target, result, &rendered, context),
            "google_sheets" => deliver_google_sheets(target, result, &rendered, context).await,
            _ => DeliveryOutcome {
                result: build_delivery_result(
                    false,
                    format!("不支持的通知渠道: {channel}"),
                    Some(channel),
                    Some(target),
                    result,
                    &rendered,
                    context,
                ),
                retryable: false,
            },
        };
        outcome.result.delivery_attempts = attempt_no;
        if outcome.result.success {
            if attempt_no > 1 {
                outcome.result.message =
                    format!("{}（第 {attempt_no} 次尝试成功）", outcome.result.message);
            }
            return outcome.result;
        }
        if !outcome.retryable || attempt_no >= max_attempts {
            if attempt_no > 1 {
                outcome.result.message =
                    format!("{}（共尝试 {attempt_no} 次）", outcome.result.message);
            }
            return outcome.result;
        }
        tokio::time::sleep(retry_backoff(attempt_no)).await;
    }

    build_delivery_result(
        false,
        "输出投递失败".to_string(),
        Some(channel),
        Some(target),
        result,
        &rendered,
        context,
    )
}

fn render_output(config: &DeliveryConfig, result: &TaskResult) -> RenderedOutput {
    let format = normalize_output_format(config.output_format.as_str());
    let schema = normalize_output_schema(config.output_schema.as_deref(), result);
    let data = Some(build_output_data(&schema, result));

    if format == "json" {
        let text = data
            .as_ref()
            .and_then(|value| serde_json::to_string_pretty(value).ok())
            .unwrap_or_else(|| result.output.text.clone());
        return RenderedOutput {
            format,
            schema,
            text,
            data,
        };
    }

    RenderedOutput {
        format,
        schema: schema.clone(),
        text: data
            .as_ref()
            .map(|value| render_text_output(&schema, result, value))
            .unwrap_or_else(|| result.output.text.clone()),
        data,
    }
}

fn normalize_output_format(value: &str) -> String {
    match value.trim() {
        "json" => "json".to_string(),
        _ => "text".to_string(),
    }
}

fn normalize_output_schema(value: Option<&str>, result: &TaskResult) -> String {
    match value.map(str::trim) {
        Some("json") => "json".to_string(),
        Some("table") => "table".to_string(),
        Some("csv") => "csv".to_string(),
        Some("links") => "links".to_string(),
        Some("text") => "text".to_string(),
        _ => infer_output_schema(result),
    }
}

fn normalize_target(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
}

fn default_google_token_uri() -> String {
    "https://oauth2.googleapis.com/token".to_string()
}

fn max_delivery_attempts(channel: &str) -> u32 {
    match channel {
        "webhook" | "google_sheets" => NETWORK_DELIVERY_MAX_ATTEMPTS,
        _ => 1,
    }
}

fn retry_backoff(attempt_no: u32) -> StdDuration {
    match attempt_no {
        1 => StdDuration::from_millis(400),
        2 => StdDuration::from_millis(1200),
        _ => StdDuration::from_millis(2000),
    }
}

fn infer_output_schema(result: &TaskResult) -> String {
    match result.output.kind.trim() {
        "json" => "json".to_string(),
        "table" => "table".to_string(),
        "csv" => "csv".to_string(),
        "links" => "links".to_string(),
        "text" => "text".to_string(),
        _ if result.output.data.is_some() => "json".to_string(),
        _ => "text".to_string(),
    }
}

fn build_output_data(schema: &str, result: &TaskResult) -> Value {
    if let Some(data) = result.output.data.clone() {
        return data;
    }

    match schema {
        "links" => json!({
            "items": extract_links_from_text(result.output.text.as_str()),
        }),
        "table" => single_column_table_payload("summary", result.output.text.as_str()),
        "csv" => {
            let columns = vec!["summary".to_string()];
            let rows = vec![vec![result.output.text.clone()]];
            json!({
                "columns": columns,
                "rows": rows,
                "csv": render_csv_lines(&["summary".to_string()], &[vec![result.output.text.clone()]]),
            })
        }
        "json" => default_output_data(schema, result),
        _ => json!({
            "text": result.output.text.clone(),
        }),
    }
}

fn default_output_data(schema: &str, result: &TaskResult) -> Value {
    json!({
        "schema": schema,
        "task": result.task.clone(),
        "status": result.status.clone(),
        "duration_ms": result.duration_ms,
        "timestamp": result.timestamp.clone(),
        "output": {
            "kind": result.output.kind.clone(),
            "text": result.output.text.clone(),
            "data": result.output.data.clone(),
        }
    })
}

fn render_text_output(schema: &str, result: &TaskResult, data: &Value) -> String {
    match schema {
        "table" => render_table_text(data).unwrap_or_else(|| result.output.text.clone()),
        "csv" => render_csv_text(data).unwrap_or_else(|| result.output.text.clone()),
        "links" => render_links_text(data).unwrap_or_else(|| result.output.text.clone()),
        _ => result.output.text.clone(),
    }
}

fn single_column_table_payload(column: &str, value: &str) -> Value {
    json!({
        "columns": [column],
        "rows": [[value]],
    })
}

fn extract_links_from_text(text: &str) -> Vec<Value> {
    text.split_whitespace()
        .filter(|item| item.starts_with("https://") || item.starts_with("http://"))
        .map(|url| json!({ "url": url }))
        .collect()
}

fn render_links_text(data: &Value) -> Option<String> {
    let items = data
        .get("items")
        .or_else(|| data.get("links"))
        .unwrap_or(data);
    let values = match items {
        Value::Array(values) => values,
        Value::String(value) => return Some(value.clone()),
        _ => return None,
    };

    let lines: Vec<String> = values
        .iter()
        .filter_map(|item| match item {
            Value::String(url) => Some(url.clone()),
            Value::Object(object) => {
                let url = object.get("url").and_then(Value::as_str)?;
                let title = object
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                Some(match title {
                    Some(title) => format!("{title} - {url}"),
                    None => url.to_string(),
                })
            }
            _ => None,
        })
        .collect();

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn render_table_text(data: &Value) -> Option<String> {
    let (columns, rows) = extract_table_payload(data)?;
    if columns.is_empty() {
        return None;
    }

    let header = format!(
        "| {} |",
        columns
            .iter()
            .map(|value| escape_table_cell(value))
            .collect::<Vec<_>>()
            .join(" | ")
    );
    let separator = format!(
        "| {} |",
        columns
            .iter()
            .map(|_| "---")
            .collect::<Vec<_>>()
            .join(" | ")
    );
    let body = rows.into_iter().map(|row| {
        format!(
            "| {} |",
            row.into_iter()
                .map(|value| escape_table_cell(&value))
                .collect::<Vec<_>>()
                .join(" | ")
        )
    });

    Some(
        std::iter::once(header)
            .chain(std::iter::once(separator))
            .chain(body)
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn render_csv_text(data: &Value) -> Option<String> {
    if let Some(csv) = data.get("csv").and_then(Value::as_str) {
        return Some(csv.to_string());
    }
    let (columns, rows) = extract_table_payload(data)?;
    if columns.is_empty() {
        return None;
    }
    Some(render_csv_lines(&columns, &rows))
}

fn extract_table_payload(data: &Value) -> Option<(Vec<String>, Vec<Vec<String>>)> {
    let object = data.as_object()?;
    let rows = object.get("rows")?.as_array()?;
    let mut columns = object
        .get("columns")
        .and_then(Value::as_array)
        .map(|values| values.iter().map(json_value_to_string).collect::<Vec<_>>())
        .unwrap_or_default();

    if columns.is_empty() {
        columns = rows
            .iter()
            .find_map(|row| row.as_object())
            .map(|row| row.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
    }

    let rendered_rows = rows
        .iter()
        .map(|row| match row {
            Value::Array(items) => items.iter().map(json_value_to_string).collect::<Vec<_>>(),
            Value::Object(items) => columns
                .iter()
                .map(|column| {
                    items
                        .get(column)
                        .map(json_value_to_string)
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>(),
            _ => vec![json_value_to_string(row)],
        })
        .collect::<Vec<_>>();

    Some((columns, rendered_rows))
}

fn render_csv_lines(columns: &[String], rows: &[Vec<String>]) -> String {
    std::iter::once(
        columns
            .iter()
            .map(|value| escape_csv_cell(value))
            .collect::<Vec<_>>()
            .join(","),
    )
    .chain(rows.iter().map(|row| {
        row.iter()
            .map(|value| escape_csv_cell(value))
            .collect::<Vec<_>>()
            .join(",")
    }))
    .collect::<Vec<_>>()
    .join("\n")
}

fn escape_csv_cell(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    if escaped.contains(',')
        || escaped.contains('\n')
        || escaped.contains('\r')
        || escaped.contains('"')
    {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}

fn escape_table_cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', "<br/>")
}

fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(item) => item.clone(),
        Value::Bool(item) => item.to_string(),
        Value::Number(item) => item.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn parse_google_sheets_target(target: &str) -> Result<GoogleSheetsTarget, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("Google Sheets 目标不能为空".to_string());
    }

    let mut params = std::collections::BTreeMap::<String, String>::new();
    for segment in trimmed.split(';') {
        let item = segment.trim();
        if item.is_empty() {
            continue;
        }
        let (key, value) = item
            .split_once('=')
            .ok_or_else(|| format!("Google Sheets 目标格式错误，缺少 key=value: {item}"))?;
        let normalized_key = key.trim().to_ascii_lowercase();
        let normalized_value = value.trim().to_string();
        if normalized_key.is_empty() || normalized_value.is_empty() {
            return Err(format!("Google Sheets 目标格式错误，字段不能为空: {item}"));
        }
        params.insert(normalized_key, normalized_value);
    }

    if params.is_empty() {
        return Err("Google Sheets 目标不能为空".to_string());
    }

    let spreadsheet_id =
        take_required_google_sheets_param(&mut params, "spreadsheet_id", "spreadsheet_id")?;
    let sheet = take_required_google_sheets_param(&mut params, "sheet", "sheet")?;
    let credentials_file =
        take_required_google_sheets_param(&mut params, "credentials_file", "credentials_file")?;
    let include_header = match params.remove("include_header") {
        Some(value) => parse_google_sheets_bool_flag(&value)
            .ok_or_else(|| format!("Google Sheets include_header 不支持的值: {value}"))?,
        None => false,
    };
    let value_input_option = match params.remove("value_input_option") {
        Some(value) => match value.trim().to_ascii_uppercase().as_str() {
            "RAW" => "RAW".to_string(),
            "USER_ENTERED" => "USER_ENTERED".to_string(),
            _ => {
                return Err(format!(
                    "Google Sheets value_input_option 不支持的值: {value}"
                ))
            }
        },
        None => "RAW".to_string(),
    };

    if let Some(extra_key) = params.keys().next() {
        return Err(format!("Google Sheets 目标包含未知字段: {extra_key}"));
    }

    Ok(GoogleSheetsTarget {
        spreadsheet_id,
        sheet,
        credentials_file,
        include_header,
        value_input_option,
    })
}

fn take_required_google_sheets_param(
    params: &mut std::collections::BTreeMap<String, String>,
    key: &str,
    label: &str,
) -> Result<String, String> {
    params
        .remove(key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Google Sheets 目标缺少 {label}"))
}

fn parse_google_sheets_bool_flag(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Some(true),
        "false" | "0" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn google_sheets_metadata_headers() -> Vec<String> {
    vec![
        "delivery_attempt_id".to_string(),
        "run_id".to_string(),
        "job_id".to_string(),
        "execution_retry_count".to_string(),
        "timestamp".to_string(),
        "task".to_string(),
        "status".to_string(),
        "duration_ms".to_string(),
    ]
}

fn google_sheets_metadata_prefix(result: &TaskResult, context: &DeliveryContext) -> Vec<String> {
    vec![
        context.attempt_id.clone(),
        context.run_id.clone().unwrap_or_default(),
        context.job_id.clone(),
        context.execution_retry_count.to_string(),
        result.timestamp.clone(),
        result.task.clone(),
        result.status.clone(),
        result.duration_ms.to_string(),
    ]
}

fn build_google_sheets_values(
    target: &GoogleSheetsTarget,
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> GoogleSheetsPreparedValues {
    let prepared = match rendered.schema.as_str() {
        "table" | "csv" => rendered
            .data
            .as_ref()
            .and_then(|data| build_google_sheets_tabular_values(result, data, context)),
        "links" => rendered
            .data
            .as_ref()
            .and_then(|data| build_google_sheets_link_values(result, data, context)),
        "json" => Some(build_google_sheets_json_values(result, rendered, context)),
        _ => Some(build_google_sheets_text_values(result, rendered, context)),
    }
    .unwrap_or_else(|| build_google_sheets_text_values(result, rendered, context));

    if !target.include_header {
        return prepared;
    }

    let mut values = Vec::with_capacity(prepared.values.len() + 1);
    values.push(match rendered.schema.as_str() {
        "table" | "csv" => build_google_sheets_tabular_headers(rendered.data.as_ref()),
        "links" => build_google_sheets_links_headers(),
        "json" => build_google_sheets_json_headers(),
        _ => build_google_sheets_text_headers(),
    });
    values.extend(prepared.values);

    GoogleSheetsPreparedValues {
        values,
        data_rows: prepared.data_rows,
    }
}

fn build_google_sheets_text_headers() -> Vec<String> {
    let mut headers = google_sheets_metadata_headers();
    headers.push("summary".to_string());
    headers
}

fn build_google_sheets_json_headers() -> Vec<String> {
    let mut headers = google_sheets_metadata_headers();
    headers.push("json".to_string());
    headers
}

fn build_google_sheets_links_headers() -> Vec<String> {
    let mut headers = google_sheets_metadata_headers();
    headers.extend(["url".to_string(), "title".to_string(), "text".to_string()]);
    headers
}

fn build_google_sheets_tabular_headers(data: Option<&Value>) -> Vec<String> {
    let mut headers = google_sheets_metadata_headers();
    if let Some((columns, _)) = data.and_then(extract_table_payload) {
        headers.extend(columns);
        return headers;
    }
    headers.push("summary".to_string());
    headers
}

fn build_google_sheets_text_values(
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> GoogleSheetsPreparedValues {
    let mut row = google_sheets_metadata_prefix(result, context);
    row.push(rendered.text.clone());
    GoogleSheetsPreparedValues {
        values: vec![row],
        data_rows: 1,
    }
}

fn build_google_sheets_json_values(
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> GoogleSheetsPreparedValues {
    let mut row = google_sheets_metadata_prefix(result, context);
    let json_text = rendered
        .data
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok())
        .unwrap_or_else(|| rendered.text.clone());
    row.push(json_text);
    GoogleSheetsPreparedValues {
        values: vec![row],
        data_rows: 1,
    }
}

fn build_google_sheets_tabular_values(
    result: &TaskResult,
    data: &Value,
    context: &DeliveryContext,
) -> Option<GoogleSheetsPreparedValues> {
    let (columns, rows) = extract_table_payload(data)?;
    if columns.is_empty() || rows.is_empty() {
        return None;
    }

    let values = rows
        .into_iter()
        .map(|row| {
            let mut record = google_sheets_metadata_prefix(result, context);
            record.extend(row);
            record
        })
        .collect::<Vec<_>>();

    Some(GoogleSheetsPreparedValues {
        data_rows: values.len(),
        values,
    })
}

fn build_google_sheets_link_values(
    result: &TaskResult,
    data: &Value,
    context: &DeliveryContext,
) -> Option<GoogleSheetsPreparedValues> {
    let items = data
        .get("items")
        .or_else(|| data.get("links"))
        .unwrap_or(data);
    let rows = match items {
        Value::Array(values) => values
            .iter()
            .filter_map(|item| {
                let (url, title, text) = match item {
                    Value::String(url) => (url.clone(), String::new(), String::new()),
                    Value::Object(object) => (
                        object
                            .get("url")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        object
                            .get("title")
                            .or_else(|| object.get("label"))
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        object
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    ),
                    _ => return None,
                };
                if url.trim().is_empty() {
                    return None;
                }
                let mut row = google_sheets_metadata_prefix(result, context);
                row.extend([url, title, text]);
                Some(row)
            })
            .collect::<Vec<_>>(),
        Value::String(url) if !url.trim().is_empty() => {
            let mut row = google_sheets_metadata_prefix(result, context);
            row.extend([url.to_string(), String::new(), String::new()]);
            vec![row]
        }
        _ => Vec::new(),
    };

    if rows.is_empty() {
        None
    } else {
        Some(GoogleSheetsPreparedValues {
            data_rows: rows.len(),
            values: rows,
        })
    }
}

fn load_google_service_account(
    credentials_file: &str,
) -> Result<GoogleServiceAccountCredentials, String> {
    let path = Path::new(credentials_file.trim());
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 Google service account 文件失败: {error}"))?;
    serde_json::from_str::<GoogleServiceAccountCredentials>(&content)
        .map_err(|error| format!("解析 Google service account 文件失败: {error}"))
}

fn build_google_service_account_assertion(
    credentials: &GoogleServiceAccountCredentials,
) -> Result<String, String> {
    let now = Utc::now();
    let claims = GoogleServiceAccountClaims {
        iss: credentials.client_email.clone(),
        scope: GOOGLE_SHEETS_SCOPE.to_string(),
        aud: credentials.token_uri.clone(),
        exp: (now + ChronoDuration::minutes(55)).timestamp(),
        iat: now.timestamp(),
    };
    let mut header = Header::new(Algorithm::RS256);
    header.typ = Some("JWT".to_string());
    let key = EncodingKey::from_rsa_pem(credentials.private_key.as_bytes())
        .map_err(|error| format!("解析 Google service account 私钥失败: {error}"))?;
    jsonwebtoken::encode(&header, &claims, &key)
        .map_err(|error| format!("生成 Google service account 断言失败: {error}"))
}

async fn fetch_google_access_token(
    credentials: &GoogleServiceAccountCredentials,
) -> Result<String, String> {
    let assertion = build_google_service_account_assertion(credentials)?;
    let client = reqwest::Client::new();
    let response = client
        .post(&credentials.token_uri)
        .form(&[
            ("grant_type", GOOGLE_JWT_GRANT_TYPE),
            ("assertion", assertion.as_str()),
        ])
        .timeout(StdDuration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("请求 Google access token 失败: {error}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Google access token 接口返回错误: {status} {}",
            trim_response_body(body.as_str())
        ));
    }

    let payload: GoogleAccessTokenResponse = serde_json::from_str(&body)
        .map_err(|error| format!("解析 Google access token 响应失败: {error}"))?;
    if payload.access_token.trim().is_empty() {
        return Err("Google access token 为空".to_string());
    }
    Ok(payload.access_token)
}

fn build_google_sheets_append_url(target: &GoogleSheetsTarget) -> String {
    let range = encode(format!("{}!A1", target.sheet).as_str()).into_owned();
    format!(
        "https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}:append?valueInputOption={}&insertDataOption=INSERT_ROWS",
        target.spreadsheet_id,
        range,
        target.value_input_option
    )
}

fn trim_response_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut preview = preview_output_text(trimmed);
    preview.truncate(preview.trim_end().len());
    preview
}

fn preview_output_text(text: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 1200;
    let mut preview = String::new();
    let mut truncated = false;

    for (index, ch) in text.chars().enumerate() {
        if index >= MAX_PREVIEW_CHARS {
            truncated = true;
            break;
        }
        preview.push(ch);
    }

    if truncated {
        preview.push_str("\n...(输出已截断)");
    }

    preview
}

fn build_delivery_result(
    success: bool,
    message: String,
    channel: Option<&str>,
    target: Option<&str>,
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> DeliveryResult {
    DeliveryResult {
        success,
        message,
        channel: channel.map(str::to_string),
        target: target.map(str::to_string),
        output_kind: result.output.kind.clone(),
        output_schema: rendered.schema.clone(),
        output_format: rendered.format.clone(),
        output_preview: preview_output_text(rendered.text.as_str()),
        delivery_attempt_id: context.attempt_id.clone(),
        run_id: context.run_id.clone(),
        execution_retry_count: context.execution_retry_count,
        delivery_attempts: 0,
    }
}

async fn deliver_webhook(
    url: &str,
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> DeliveryOutcome {
    #[derive(Debug, Serialize)]
    struct WebhookPayload {
        event: String,
        job_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<String>,
        delivery_attempt_id: String,
        execution_retry_count: u32,
        task: String,
        status: String,
        output: String,
        output_kind: String,
        output_schema: String,
        output_format: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_data: Option<Value>,
        duration_ms: i64,
        timestamp: String,
    }

    let payload = WebhookPayload {
        event: "automation_job_complete".to_string(),
        job_id: context.job_id.clone(),
        run_id: context.run_id.clone(),
        delivery_attempt_id: context.attempt_id.clone(),
        execution_retry_count: context.execution_retry_count,
        task: result.task.clone(),
        status: result.status.clone(),
        output: rendered.text.clone(),
        output_kind: result.output.kind.clone(),
        output_schema: rendered.schema.clone(),
        output_format: rendered.format.clone(),
        output_data: rendered.data.clone(),
        duration_ms: result.duration_ms,
        timestamp: result.timestamp.clone(),
    };

    let client = reqwest::Client::new();
    match client
        .post(url)
        .header("Idempotency-Key", context.attempt_id.as_str())
        .header(
            "X-Proxycast-Delivery-Attempt-Id",
            context.attempt_id.as_str(),
        )
        .json(&payload)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => DeliveryOutcome {
            result: build_delivery_result(
                true,
                "Webhook 输出已发送".to_string(),
                Some("webhook"),
                Some(url),
                result,
                rendered,
                context,
            ),
            retryable: false,
        },
        Ok(response) => {
            let status = response.status();
            DeliveryOutcome {
                result: build_delivery_result(
                    false,
                    format!("Webhook 返回错误: {status}"),
                    Some("webhook"),
                    Some(url),
                    result,
                    rendered,
                    context,
                ),
                retryable: status.is_server_error()
                    || status == reqwest::StatusCode::TOO_MANY_REQUESTS,
            }
        }
        Err(error) => DeliveryOutcome {
            result: build_delivery_result(
                false,
                format!("Webhook 请求失败: {error}"),
                Some("webhook"),
                Some(url),
                result,
                rendered,
                context,
            ),
            retryable: true,
        },
    }
}

async fn deliver_google_sheets(
    target: &str,
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> DeliveryOutcome {
    let parsed_target = match parse_google_sheets_target(target) {
        Ok(parsed_target) => parsed_target,
        Err(message) => {
            return DeliveryOutcome {
                result: build_delivery_result(
                    false,
                    message,
                    Some("google_sheets"),
                    Some(target),
                    result,
                    rendered,
                    context,
                ),
                retryable: false,
            }
        }
    };

    let credentials = match load_google_service_account(parsed_target.credentials_file.as_str()) {
        Ok(credentials) => credentials,
        Err(message) => {
            return DeliveryOutcome {
                result: build_delivery_result(
                    false,
                    message,
                    Some("google_sheets"),
                    Some(target),
                    result,
                    rendered,
                    context,
                ),
                retryable: false,
            }
        }
    };
    let access_token = match fetch_google_access_token(&credentials).await {
        Ok(access_token) => access_token,
        Err(message) => {
            return DeliveryOutcome {
                result: build_delivery_result(
                    false,
                    message,
                    Some("google_sheets"),
                    Some(target),
                    result,
                    rendered,
                    context,
                ),
                retryable: true,
            }
        }
    };
    let prepared = build_google_sheets_values(&parsed_target, result, rendered, context);
    let payload = GoogleSheetsAppendRequest {
        major_dimension: "ROWS".to_string(),
        values: prepared.values,
    };
    let url = build_google_sheets_append_url(&parsed_target);
    let client = reqwest::Client::new();
    match client
        .post(&url)
        .bearer_auth(access_token)
        .json(&payload)
        .timeout(StdDuration::from_secs(30))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => DeliveryOutcome {
            result: build_delivery_result(
                true,
                format!("Google Sheets 已追加 {} 行", prepared.data_rows),
                Some("google_sheets"),
                Some(target),
                result,
                rendered,
                context,
            ),
            retryable: false,
        },
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let retryable = body.contains("\"code\": 429")
                || body.contains("\"code\":429")
                || body.contains("rateLimitExceeded")
                || body.contains("internalError");
            DeliveryOutcome {
                result: build_delivery_result(
                    false,
                    format!(
                        "Google Sheets API 错误: {}",
                        trim_response_body(body.as_str())
                    ),
                    Some("google_sheets"),
                    Some(target),
                    result,
                    rendered,
                    context,
                ),
                retryable: retryable
                    || status.is_server_error()
                    || status == reqwest::StatusCode::TOO_MANY_REQUESTS,
            }
        }
        Err(error) => DeliveryOutcome {
            result: build_delivery_result(
                false,
                format!("Google Sheets 请求失败: {error}"),
                Some("google_sheets"),
                Some(target),
                result,
                rendered,
                context,
            ),
            retryable: true,
        },
    }
}

fn deliver_local_file(
    target: &str,
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> DeliveryOutcome {
    let path = Path::new(target.trim());
    if target.trim().is_empty() {
        return DeliveryOutcome {
            result: DeliveryResult {
                success: false,
                message: "本地文件目标不能为空".to_string(),
                channel: Some("local_file".to_string()),
                target: None,
                output_kind: result.output.kind.clone(),
                output_schema: rendered.schema.clone(),
                output_format: rendered.format.clone(),
                output_preview: preview_output_text(rendered.text.as_str()),
                delivery_attempt_id: context.attempt_id.clone(),
                run_id: context.run_id.clone(),
                execution_retry_count: context.execution_retry_count,
                delivery_attempts: 0,
            },
            retryable: false,
        };
    }

    if let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) {
        if let Err(error) = fs::create_dir_all(parent) {
            return DeliveryOutcome {
                result: DeliveryResult {
                    success: false,
                    message: format!("创建输出目录失败: {error}"),
                    channel: Some("local_file".to_string()),
                    target: Some(target.trim().to_string()),
                    output_kind: result.output.kind.clone(),
                    output_schema: rendered.schema.clone(),
                    output_format: rendered.format.clone(),
                    output_preview: preview_output_text(rendered.text.as_str()),
                    delivery_attempt_id: context.attempt_id.clone(),
                    run_id: context.run_id.clone(),
                    execution_retry_count: context.execution_retry_count,
                    delivery_attempts: 0,
                },
                retryable: false,
            };
        }
    }

    match fs::write(path, rendered.text.as_bytes()) {
        Ok(()) => DeliveryOutcome {
            result: DeliveryResult {
                success: true,
                message: format!("输出已写入 {}", path.display()),
                channel: Some("local_file".to_string()),
                target: Some(target.trim().to_string()),
                output_kind: result.output.kind.clone(),
                output_schema: rendered.schema.clone(),
                output_format: rendered.format.clone(),
                output_preview: preview_output_text(rendered.text.as_str()),
                delivery_attempt_id: context.attempt_id.clone(),
                run_id: context.run_id.clone(),
                execution_retry_count: context.execution_retry_count,
                delivery_attempts: 0,
            },
            retryable: false,
        },
        Err(error) => DeliveryOutcome {
            result: DeliveryResult {
                success: false,
                message: format!("写入本地文件失败: {error}"),
                channel: Some("local_file".to_string()),
                target: Some(target.trim().to_string()),
                output_kind: result.output.kind.clone(),
                output_schema: rendered.schema.clone(),
                output_format: rendered.format.clone(),
                output_preview: preview_output_text(rendered.text.as_str()),
                delivery_attempt_id: context.attempt_id.clone(),
                run_id: context.run_id.clone(),
                execution_retry_count: context.execution_retry_count,
                delivery_attempts: 0,
            },
            retryable: false,
        },
    }
}

async fn deliver_telegram(
    target: &str,
    result: &TaskResult,
    rendered: &RenderedOutput,
    context: &DeliveryContext,
) -> DeliveryOutcome {
    #[derive(Debug, Serialize)]
    struct TelegramPayload {
        chat_id: String,
        text: String,
        parse_mode: String,
    }

    let parts: Vec<&str> = target.splitn(2, ':').collect();
    if parts.len() != 2 {
        return DeliveryOutcome {
            result: build_delivery_result(
                false,
                "Telegram 目标格式错误，应为 bot_token:chat_id".to_string(),
                Some("telegram"),
                Some(target),
                result,
                rendered,
                context,
            ),
            retryable: false,
        };
    }

    let bot_token = parts[0];
    let chat_id = parts[1];
    let status_emoji = match result.status.as_str() {
        "success" => "✅",
        "error" => "❌",
        "timeout" => "⏰",
        _ => "📋",
    };
    let message = format!(
        "{} *自动化任务完成*\n\n*任务*: {}\n*状态*: {}\n*耗时*: {}ms\n\n```\n{}\n```",
        status_emoji,
        escape_markdown(&result.task),
        result.status,
        result.duration_ms,
        escape_markdown(&rendered.text),
    );
    let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");
    let payload = TelegramPayload {
        chat_id: chat_id.to_string(),
        text: message,
        parse_mode: "MarkdownV2".to_string(),
    };

    let client = reqwest::Client::new();
    match client
        .post(&url)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => DeliveryOutcome {
            result: build_delivery_result(
                true,
                "Telegram 通知已发送".to_string(),
                Some("telegram"),
                Some(target),
                result,
                rendered,
                context,
            ),
            retryable: false,
        },
        Ok(response) => DeliveryOutcome {
            result: build_delivery_result(
                false,
                format!(
                    "Telegram API 错误: {}",
                    response.text().await.unwrap_or_default()
                ),
                Some("telegram"),
                Some(target),
                result,
                rendered,
                context,
            ),
            retryable: false,
        },
        Err(error) => DeliveryOutcome {
            result: build_delivery_result(
                false,
                format!("Telegram 请求失败: {error}"),
                Some("telegram"),
                Some(target),
                result,
                rendered,
                context,
            ),
            retryable: false,
        },
    }
}

fn escape_markdown(text: &str) -> String {
    let special_chars = [
        '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!',
    ];
    let mut result = String::with_capacity(text.len() * 2);
    for ch in text.chars() {
        if special_chars.contains(&ch) {
            result.push('\\');
        }
        result.push(ch);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_context() -> DeliveryContext {
        DeliveryContext {
            attempt_id: "dlv-run-1".to_string(),
            run_id: Some("run-1".to_string()),
            job_id: "job-1".to_string(),
            execution_retry_count: 1,
        }
    }

    fn sample_result() -> TaskResult {
        TaskResult {
            task: "浏览器巡检".to_string(),
            status: "success".to_string(),
            output: TaskOutput {
                kind: "json".to_string(),
                text: "浏览器任务已启动".to_string(),
                data: Some(json!({
                    "kind": "browser_session",
                    "session_id": "session-1",
                    "target_url": "https://seller.example.com/dashboard"
                })),
            },
            duration_ms: 1200,
            timestamp: "2026-03-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn render_output_should_pretty_print_json_payload() {
        let rendered = render_output(
            &DeliveryConfig {
                mode: "announce".to_string(),
                channel: Some("webhook".to_string()),
                target: Some("https://example.com/webhook".to_string()),
                best_effort: true,
                output_schema: None,
                output_format: "json".to_string(),
            },
            &sample_result(),
        );

        assert_eq!(rendered.format, "json");
        assert_eq!(rendered.schema, "json");
        assert!(rendered.text.contains("\"session_id\": \"session-1\""));
        assert!(rendered.data.is_some());
    }

    #[test]
    fn render_output_should_render_csv_schema_as_plain_text() {
        let rendered = render_output(
            &DeliveryConfig {
                mode: "announce".to_string(),
                channel: Some("local_file".to_string()),
                target: Some("/tmp/automation-output.csv".to_string()),
                best_effort: true,
                output_schema: Some("csv".to_string()),
                output_format: "text".to_string(),
            },
            &TaskResult {
                task: "导出任务".to_string(),
                status: "success".to_string(),
                output: TaskOutput {
                    kind: "table".to_string(),
                    text: "导出完成".to_string(),
                    data: Some(json!({
                        "columns": ["url", "status"],
                        "rows": [
                            ["https://example.com/a", "ok"],
                            ["https://example.com/b", "retry"]
                        ],
                    })),
                },
                duration_ms: 500,
                timestamp: "2026-03-16T00:00:00Z".to_string(),
            },
        );

        assert_eq!(rendered.schema, "csv");
        assert_eq!(
            rendered.text,
            "url,status\nhttps://example.com/a,ok\nhttps://example.com/b,retry"
        );
    }

    #[test]
    fn parse_google_sheets_target_should_support_key_value_pairs() {
        let parsed = parse_google_sheets_target(
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/proxycast/service-account.json;include_header=true;value_input_option=USER_ENTERED",
        )
        .expect("应成功解析 Google Sheets 目标");

        assert_eq!(parsed.spreadsheet_id, "sheet-1");
        assert_eq!(parsed.sheet, "巡检结果");
        assert_eq!(parsed.credentials_file, "C:/proxycast/service-account.json");
        assert!(parsed.include_header);
        assert_eq!(parsed.value_input_option, "USER_ENTERED");
    }

    #[test]
    fn build_google_sheets_values_should_prefix_metadata_for_tabular_output() {
        let rendered = render_output(
            &DeliveryConfig {
                mode: "announce".to_string(),
                channel: Some("google_sheets".to_string()),
                target: Some("spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=/tmp/service-account.json;include_header=true".to_string()),
                best_effort: true,
                output_schema: Some("table".to_string()),
                output_format: "json".to_string(),
            },
            &TaskResult {
                task: "导出任务".to_string(),
                status: "success".to_string(),
                output: TaskOutput {
                    kind: "table".to_string(),
                    text: "导出完成".to_string(),
                    data: Some(json!({
                        "columns": ["url", "status"],
                        "rows": [
                            ["https://example.com/a", "ok"],
                            ["https://example.com/b", "retry"]
                        ],
                    })),
                },
                duration_ms: 500,
                timestamp: "2026-03-16T00:00:00Z".to_string(),
            },
        );
        let target = parse_google_sheets_target(
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=/tmp/service-account.json;include_header=true",
        )
        .expect("应成功解析 Google Sheets 目标");
        let prepared = build_google_sheets_values(
            &target,
            &TaskResult {
                task: "导出任务".to_string(),
                status: "success".to_string(),
                output: TaskOutput {
                    kind: "table".to_string(),
                    text: "导出完成".to_string(),
                    data: Some(json!({
                        "columns": ["url", "status"],
                        "rows": [
                            ["https://example.com/a", "ok"],
                            ["https://example.com/b", "retry"]
                        ],
                    })),
                },
                duration_ms: 500,
                timestamp: "2026-03-16T00:00:00Z".to_string(),
            },
            &rendered,
            &sample_context(),
        );

        assert_eq!(
            prepared.values.first(),
            Some(&vec![
                "delivery_attempt_id".to_string(),
                "run_id".to_string(),
                "job_id".to_string(),
                "execution_retry_count".to_string(),
                "timestamp".to_string(),
                "task".to_string(),
                "status".to_string(),
                "duration_ms".to_string(),
                "url".to_string(),
                "status".to_string(),
            ])
        );
        assert_eq!(prepared.data_rows, 2);
        assert_eq!(
            prepared.values.get(1),
            Some(&vec![
                "dlv-run-1".to_string(),
                "run-1".to_string(),
                "job-1".to_string(),
                "1".to_string(),
                "2026-03-16T00:00:00Z".to_string(),
                "导出任务".to_string(),
                "success".to_string(),
                "500".to_string(),
                "https://example.com/a".to_string(),
                "ok".to_string(),
            ])
        );
    }

    #[tokio::test]
    async fn deliver_result_should_reject_invalid_google_sheets_target() {
        let delivery = deliver_result(
            &DeliveryConfig {
                mode: "announce".to_string(),
                channel: Some("google_sheets".to_string()),
                target: Some(
                    "spreadsheet_id=sheet-1;credentials_file=/tmp/service-account.json".to_string(),
                ),
                best_effort: true,
                output_schema: Some("json".to_string()),
                output_format: "json".to_string(),
            },
            &sample_result(),
            &sample_context(),
        )
        .await;

        assert!(!delivery.success);
        assert_eq!(delivery.channel.as_deref(), Some("google_sheets"));
        assert!(delivery.message.contains("缺少 sheet"));
        assert_eq!(delivery.delivery_attempt_id, "dlv-run-1");
        assert_eq!(delivery.execution_retry_count, 1);
        assert_eq!(delivery.delivery_attempts, 1);
    }

    #[test]
    fn deliver_local_file_should_write_rendered_output() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间异常")
            .as_nanos();
        let output_path = std::env::temp_dir()
            .join("proxycast-delivery-tests")
            .join(format!("automation-output-{unique}.json"));
        let rendered = render_output(
            &DeliveryConfig {
                mode: "announce".to_string(),
                channel: Some("local_file".to_string()),
                target: Some(output_path.to_string_lossy().to_string()),
                best_effort: true,
                output_schema: Some("json".to_string()),
                output_format: "json".to_string(),
            },
            &sample_result(),
        );

        let sample = sample_result();
        let delivery = deliver_local_file(
            output_path.to_string_lossy().as_ref(),
            &sample,
            &rendered,
            &sample_context(),
        )
        .result;
        let content = fs::read_to_string(&output_path).expect("读取输出文件失败");

        assert!(delivery.success);
        assert_eq!(delivery.channel.as_deref(), Some("local_file"));
        assert_eq!(delivery.output_schema, "json");
        assert_eq!(delivery.delivery_attempt_id, "dlv-run-1");
        assert!(content.contains("\"target_url\": \"https://seller.example.com/dashboard\""));

        let _ = fs::remove_file(&output_path);
    }

    #[test]
    fn build_delivery_attempt_id_should_fall_back_to_deterministic_hash() {
        let first = build_delivery_attempt_id("job-1", "2026-03-16T00:00:00Z", 2, None);
        let second = build_delivery_attempt_id("job-1", "2026-03-16T00:00:00Z", 2, None);

        assert_eq!(first, second);
        assert!(first.starts_with("dlv-"));
    }
}
