use crate::tools::base::Tool;
use crate::tools::context::{ToolContext, ToolResult};
use crate::tools::error::ToolError;
use async_trait::async_trait;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

pub const REMOTE_TRIGGER_TOOL_NAME: &str = "RemoteTrigger";
pub const REMOTE_TRIGGER_GATE_ENV: &str = "AGENT_TRIGGERS_REMOTE";
const REMOTE_TRIGGER_ACCESS_TOKEN_ENV: &str = "ASTER_REMOTE_TRIGGER_ACCESS_TOKEN";
const REMOTE_TRIGGER_ORG_UUID_ENV: &str = "ASTER_REMOTE_TRIGGER_ORGANIZATION_UUID";
const REMOTE_TRIGGER_BASE_API_URL_ENV: &str = "ASTER_REMOTE_TRIGGER_BASE_API_URL";
const REMOTE_TRIGGER_BETA_HEADER_ENV: &str = "ASTER_REMOTE_TRIGGER_BETA_HEADER";
const DEFAULT_REMOTE_TRIGGER_BASE_API_URL: &str = "https://api.anthropic.com";
const DEFAULT_REMOTE_TRIGGER_BETA_HEADER: &str = "ccr-triggers-2026-01-30";
const REMOTE_TRIGGER_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RemoteTriggerAction {
    List,
    Get,
    Create,
    Update,
    Run,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteTriggerInput {
    action: RemoteTriggerAction,
    #[serde(default)]
    trigger_id: Option<String>,
    #[serde(default)]
    body: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteTriggerRuntimeConfig {
    access_token: String,
    organization_uuid: String,
    base_api_url: String,
    beta_header: String,
}

pub struct RemoteTriggerTool {
    client: Client,
}

impl RemoteTriggerTool {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(REMOTE_TRIGGER_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client }
    }

    fn load_runtime_config() -> Result<RemoteTriggerRuntimeConfig, ToolError> {
        let access_token = read_required_env(REMOTE_TRIGGER_ACCESS_TOKEN_ENV)?;
        let organization_uuid = read_required_env(REMOTE_TRIGGER_ORG_UUID_ENV)?;
        let base_api_url = std::env::var(REMOTE_TRIGGER_BASE_API_URL_ENV)
            .unwrap_or_else(|_| DEFAULT_REMOTE_TRIGGER_BASE_API_URL.to_string());
        let beta_header = std::env::var(REMOTE_TRIGGER_BETA_HEADER_ENV)
            .unwrap_or_else(|_| DEFAULT_REMOTE_TRIGGER_BETA_HEADER.to_string());

        Ok(RemoteTriggerRuntimeConfig {
            access_token,
            organization_uuid,
            base_api_url: base_api_url.trim_end_matches('/').to_string(),
            beta_header,
        })
    }
}

impl Default for RemoteTriggerTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for RemoteTriggerTool {
    fn name(&self) -> &str {
        REMOTE_TRIGGER_TOOL_NAME
    }

    fn description(&self) -> &str {
        "管理远程定时触发器。认证在运行时内通过环境变量注入，请使用这个工具而不是手动拼接 HTTP 请求。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "get", "create", "update", "run"]
                },
                "trigger_id": {
                    "type": "string",
                    "pattern": "^[\\\\w-]+$",
                    "description": "get、update、run 必填"
                },
                "body": {
                    "type": "object",
                    "description": "create、update 使用的 JSON 请求体"
                }
            },
            "required": ["action"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: RemoteTriggerInput = serde_json::from_value(params).map_err(|error| {
            ToolError::invalid_params(format!("RemoteTrigger 参数无效: {error}"))
        })?;
        let config = Self::load_runtime_config()?;
        let request = build_remote_trigger_request(&self.client, &config, input)?;

        let response = request.send().await.map_err(|error| {
            ToolError::execution_failed(format!("RemoteTrigger 请求失败: {error}"))
        })?;
        let status = response.status().as_u16();
        let response_json = response.json::<Value>().await.map_err(|error| {
            ToolError::execution_failed(format!("RemoteTrigger 响应解析失败: {error}"))
        })?;
        let response_body = serde_json::to_string_pretty(&response_json)
            .unwrap_or_else(|_| response_json.to_string());

        Ok(
            ToolResult::success(format!("HTTP {status}\n{response_body}"))
                .with_metadata("status", json!(status))
                .with_metadata("json", json!(response_body)),
        )
    }
}

fn read_required_env(name: &str) -> Result<String, ToolError> {
    let value = std::env::var(name).map_err(|_| {
        ToolError::execution_failed(format!("RemoteTrigger 缺少运行时配置: {name}"))
    })?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ToolError::execution_failed(format!(
            "RemoteTrigger 运行时配置不能为空: {name}"
        )));
    }
    Ok(trimmed.to_string())
}

fn normalize_trigger_id(
    raw: Option<String>,
    action: &RemoteTriggerAction,
) -> Result<Option<String>, ToolError> {
    match action {
        RemoteTriggerAction::List | RemoteTriggerAction::Create => Ok(None),
        RemoteTriggerAction::Get | RemoteTriggerAction::Update | RemoteTriggerAction::Run => {
            let trigger_id = raw
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    ToolError::invalid_params(format!("{:?} requires trigger_id", action))
                })?;
            if !is_valid_trigger_id(&trigger_id) {
                return Err(ToolError::invalid_params(
                    "trigger_id 只能包含字母、数字、下划线和中划线",
                ));
            }
            Ok(Some(trigger_id))
        }
    }
}

fn is_valid_trigger_id(value: &str) -> bool {
    value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn build_remote_trigger_request(
    client: &Client,
    config: &RemoteTriggerRuntimeConfig,
    input: RemoteTriggerInput,
) -> Result<reqwest::RequestBuilder, ToolError> {
    let RemoteTriggerInput {
        action,
        trigger_id,
        body,
    } = input;
    let trigger_id = normalize_trigger_id(trigger_id, &action)?;
    let base = format!("{}/v1/code/triggers", config.base_api_url);
    let mut request = client
        .request(
            match action {
                RemoteTriggerAction::List | RemoteTriggerAction::Get => reqwest::Method::GET,
                RemoteTriggerAction::Create
                | RemoteTriggerAction::Update
                | RemoteTriggerAction::Run => reqwest::Method::POST,
            },
            match action {
                RemoteTriggerAction::List => base,
                RemoteTriggerAction::Get => format!("{base}/{}", trigger_id.as_deref().unwrap()),
                RemoteTriggerAction::Create => base,
                RemoteTriggerAction::Update => {
                    format!("{base}/{}", trigger_id.as_deref().unwrap())
                }
                RemoteTriggerAction::Run => {
                    format!("{base}/{}/run", trigger_id.as_deref().unwrap())
                }
            },
        )
        .header(AUTHORIZATION, format!("Bearer {}", config.access_token))
        .header(CONTENT_TYPE, "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", config.beta_header.clone())
        .header("x-organization-uuid", config.organization_uuid.clone());

    match action {
        RemoteTriggerAction::Create | RemoteTriggerAction::Update => {
            let body =
                body.ok_or_else(|| ToolError::invalid_params(format!("{action:?} requires body")))?;
            if !body.is_object() {
                return Err(ToolError::invalid_params(
                    "body 必须是 JSON 对象".to_string(),
                ));
            }
            request = request.json(&body);
        }
        RemoteTriggerAction::Run => {
            request = request.json(&json!({}));
        }
        RemoteTriggerAction::List | RemoteTriggerAction::Get => {}
    }

    Ok(request.timeout(Duration::from_secs(REMOTE_TRIGGER_TIMEOUT_SECS)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn normalize_trigger_id_requires_value_for_mutating_actions() {
        let error = normalize_trigger_id(None, &RemoteTriggerAction::Run).unwrap_err();
        assert!(error.to_string().contains("requires trigger_id"));
    }

    #[test]
    fn build_remote_trigger_request_requires_body_for_update() {
        let config = RemoteTriggerRuntimeConfig {
            access_token: "token".to_string(),
            organization_uuid: "org-1".to_string(),
            base_api_url: "https://example.com".to_string(),
            beta_header: "beta".to_string(),
        };
        let error = build_remote_trigger_request(
            &Client::new(),
            &config,
            RemoteTriggerInput {
                action: RemoteTriggerAction::Update,
                trigger_id: Some("trigger-1".to_string()),
                body: None,
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("requires body"));
    }

    #[tokio::test]
    #[serial]
    async fn remote_trigger_execute_calls_runtime_api_and_serializes_response() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/code/triggers/trigger-1/run"))
            .and(header("authorization", "Bearer token-1"))
            .and(header("x-organization-uuid", "org-1"))
            .respond_with(ResponseTemplate::new(202).set_body_json(json!({
                "id": "trigger-1",
                "status": "queued"
            })))
            .mount(&server)
            .await;
        std::env::set_var(REMOTE_TRIGGER_ACCESS_TOKEN_ENV, "token-1");
        std::env::set_var(REMOTE_TRIGGER_ORG_UUID_ENV, "org-1");
        std::env::set_var(REMOTE_TRIGGER_BASE_API_URL_ENV, server.uri());
        std::env::set_var(REMOTE_TRIGGER_BETA_HEADER_ENV, "beta-1");

        let result = RemoteTriggerTool::new()
            .execute(
                json!({
                    "action": "run",
                    "trigger_id": "trigger-1"
                }),
                &ToolContext::new(std::path::PathBuf::from(".")),
            )
            .await
            .unwrap();

        std::env::remove_var(REMOTE_TRIGGER_ACCESS_TOKEN_ENV);
        std::env::remove_var(REMOTE_TRIGGER_ORG_UUID_ENV);
        std::env::remove_var(REMOTE_TRIGGER_BASE_API_URL_ENV);
        std::env::remove_var(REMOTE_TRIGGER_BETA_HEADER_ENV);

        assert_eq!(result.metadata.get("status"), Some(&json!(202)));
        let output = result.output.as_deref().unwrap_or_default();
        assert!(output.contains("HTTP 202"));
        assert!(output.contains("\"status\": \"queued\""));
    }
}
